If you add `--profile ttk-tests`, Docker Compose starts one extra one-shot container: `ttk-tests`.

That container waits for the core services **and** `ttk-provisioning` to finish successfully, then runs:

```bash
npm run cli -- \
  -u http://mojaloop-testing-toolkit:5050 \
  -i collections/tests \
  -e environments/default-env.json \
  --labels std \
  --report-target file://reports/ttk-func-tests-report.html
```

For `--labels std`, `collections/tests/master.json` selects exactly this file:

[p2p.json](/home/abdul-rahim/mojaloop/ml-core-test-harness/docker/ml-testing-toolkit/test-cases/collections/tests/p2p.json)

So the P2P test sends **4 main APIs**:

1. Register the payee party in ALS

```http
POST http://account-lookup-service:4002/participants/MSISDN/27713803912
FSPIOP-Source: payeefsp
Content-Type: application/vnd.interoperability.participants+json;version=2.0
Accept: application/vnd.interoperability.participants+json;version=2.0

{
  "fspId": "payeefsp",
  "currency": "XXX"
}
```

2. Lookup the payee party

```http
GET http://account-lookup-service:4002/parties/MSISDN/27713803912
FSPIOP-Source: testingtoolkitdfsp
Content-Type: application/vnd.interoperability.parties+json;version=2.0
Accept: application/vnd.interoperability.parties+json;version=2.0
```

It expects an async callback containing the party info.

3. Send quote request

```http
POST http://quoting-service:3002/quotes
FSPIOP-Source: testingtoolkitdfsp
FSPIOP-Destination: payeefsp
Content-Type: application/vnd.interoperability.quotes+json;version=2.0
Accept: application/vnd.interoperability.quotes+json;version=2.0
```

Body includes generated `quoteId`, `transactionId`, payer `testingtoolkitdfsp`, payee from the party lookup, amount `100 XXX`, and transaction type `TRANSFER / PAYER / CONSUMER`.

It expects a quote callback with `transferAmount`, `expiration`, `ilpPacket`, and `condition`.

4. Send transfer prepare

```http
POST http://ml-api-adapter:3000/transfers
FSPIOP-Source: testingtoolkitdfsp
Content-Type: application/vnd.interoperability.transfers+json;version=2.0
Accept: application/vnd.interoperability.transfers+json;version=2.0
```

Body is built from the quote response:

```json
{
  "transferId": "<quote transactionId>",
  "payerFsp": "testingtoolkitdfsp",
  "payeeFsp": "payeefsp",
  "amount": "<quote transferAmount>",
  "expiration": "<quote expiration>",
  "ilpPacket": "<quote ilpPacket>",
  "condition": "<quote condition>"
}
```

It expects a transfer callback with:

```json
{
  "transferState": "COMMITTED"
}
```

So in plain English: `ttk-tests` runs the happy-path P2P flow: **register party in ALS -> discover party -> request quote -> prepare/commit transfer**, then writes the functional test report to:

`ml-core-test-harness/reports/ttk-func-tests-report.html`
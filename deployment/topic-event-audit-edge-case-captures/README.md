# `topic-event-audit` edge-case captures

Real records captured from `topic-event-audit` on the local ISO 20022 + FX Mojaloop deployment on
`10.0.150.69` (kind cluster `mojaloop-fx`, namespace `demo`, chart `v17.2.0`), 10 September 2026.

**These exist to answer item 3.5 of `topic_event_audit_Environment_Configuration.md`**, which asks for
a capture "covering error, abort, reject and timeout variants" — the set held so far being golden-path
only. The reference pack of five real DRPP production/UAT transactions in
`DRPP_Kafka_E2E_Pack 2/DRPP_Kafka_E2E_Pack/` is golden-path only for exactly that reason.

Each directory holds a `raw_messages.json` array, mirroring the DRPP pack's own layout. One caveat
carried over from plan §9.12: these were pulled with `kafka-console-consumer.sh`, which prints only the
record **value**, so they lack the outer Kafka envelope (`partitionID`, `offset`, `timestamp`, `key`)
that Redpanda Console's export adds to the DRPP pack. The record bodies themselves are directly
comparable.

## The captures

| Directory | Scenario | FSPIOP error delivered |
|---|---|---|
| `01_payer_insufficient_liquidity_4001` | Prepare against an unfunded settlement account | `4001` Payer FSP insufficient liquidity |
| `02_transfer_committed_happy_path` | prepare → fulfil → COMMITTED | — (success) |
| `03_ilp_condition_mismatch_3100` | Fulfil with a fulfilment that doesn't hash to the condition | `3100` Generic validation error |
| `04_payee_abort_5000` | Payee sends `PUT /transfers/{ID}/error` | `5000` Generic payee error |
| `05_ndc_breach_4200` | Funded participant, net debit cap exceeded | `4200` Payer limit error |
| `06_transfer_timeout_3303` | Prepared, never fulfilled, swept by the timeout handler | `3303` Transfer expired |
| `07_fx_quote_expired_request_accepted` | `POST /fxQuotes` with an already-past expiration | none for expiry — **accepted `202`** |
| `08_fx_quote_late_response_accepted` | `PUT /fxQuotes/{ID}` 40s past expiration | none for expiry — **accepted `200`** |

## Operations these add over the DRPP golden-path pack

Six `operation` tag values appear in these captures that appear nowhere in the five DRPP reference
transactions — which is precisely the gap item 3.5 describes:

- `abortTransfer` (payee abort)
- `abortTransferValidation` (ILP condition mismatch)
- `timeoutReserved` (transfer timeout)
- `putFxQuotesErrorByID` (FX quote error callback)
- `getTransferByID` (transfer state query)
- plus error-callback **egress** records that carry *no* `operation` tag at all — see below.

## Three things that matter for FRMS message mapping

1. **Liquidity and limit failures are not distinguishable by `operation`.** Both `4001` and `4200`
   produce only `prepareTransfer` records, identical in tag structure to a successful prepare. The
   only thing that separates a rejected prepare from an accepted one is the error payload on the
   subsequent egress record. Anything keying off `operation` alone will silently treat these as
   successful prepares.
2. **FX-quote error egress records carry no correlation identifiers.** The `PUT /fxQuotes/{ID}/error`
   egress record has no `operation`, no `conversionId`, no `conversionRequestId`,
   no `determiningTransferId` and no `transactionId` — only the generic tag set plus
   `transactionType: fxquote` and `transactionAction: put`. The only way to correlate it back to its
   transaction is by parsing the conversion request id out of the `httpUrl` tag, or out of the payload.
3. **No expiry event is ever emitted on the quoting leg.** See scenarios 07 and 08 — quoting-service
   does not enforce quote or FX-quote expiry at all, so no "expired quote" record will ever appear on
   this topic. Expiry is enforced only on the transfer leg, by central-ledger's timeout handler, and
   surfaces as `timeoutReserved` / `3303` (scenario 06).

## Shape match against the real DRPP records

The transfer-leg records match the DRPP reference **key for key**:

- `prepareTransfer` / `ml-api-adapter-service` — `auditType, contentType, destination, httpMethod,
  operation, serviceName, source, tracestate, transactionAction, transactionId, transactionType,
  transferId`
- `prepareTransfer` / `ml-notification-handler` — the same, plus `binId, httpUrl, processedAsBatch`

Both are identical to the corresponding DRPP records. This extends plan §9.12's finding (which
compared a `postFxQuotes` and a `getPartiesByTypeAndID` record) to the transfer legs.

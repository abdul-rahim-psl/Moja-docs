<!-- SPDX-License-Identifier: Apache-2.0 -->

# MLA → PPA Event Envelopes — Five Real Transactions

The exact Event Envelope JSON bodies MLA POSTs to PPA, captured verbatim for all five transactions in `__tests__/fixtures/DRPP_Kafka_E2E_Pack` (cch-mla). Each is a real DRPP Kafka capture (11–13 August 2026), fed through the real local MLA over a real Redpanda broker — not synthesized, not from `ppa-stub`.

## Index

- [How this was captured](#how-this-was-captured)
- [Result: none of the five reached TMS](#result-none-of-the-five-reached-tms)
- [Transaction 1 — `01_MWK_to_ZMW_PRIMARY`](#transaction-1--01_mwk_to_zmw_primary-mwk--zmw-via-test-fxp2) (MWK → ZMW via `test-fxp2`) — each has FXQUOTE/QUOTE/FXTRANSFER/TRANSFER request + callback
- [Transaction 2 — `02_ZMW_to_MWK`](#transaction-2--02_zmw_to_mwk-zmw--mwk-via-test-fxp) (ZMW → MWK via `test-fxp`)
- [Transaction 3 — `03_ZMW_to_MWK_alt`](#transaction-3--03_zmw_to_mwk_alt-zmw--mwk-via-test-fxp) (ZMW → MWK via `test-fxp`)
- [Transaction 4 — `04_ZMW_to_EGP_partition_split`](#transaction-4--04_zmw_to_egp_partition_split-zmw--egp-via-test-fxp) (ZMW → EGP via `test-fxp`, genuine cross-partition out-of-order delivery)
- [Transaction 5 — `05_ZMW_to_KES`](#transaction-5--05_zmw_to_kes-zmw--kes-via-test-fxp) (ZMW → KES via `test-fxp`)
- [Summary for the PPA side](#summary-for-the-ppa-side)

## How this was captured

A transparent capturing reverse-proxy stood in for PPA for one replay session: it recorded each request body byte-for-byte, forwarded it unchanged to the real running PPA, and relayed PPA's real response back to MLA. PPA's behaviour was not altered — this only observes what MLA actually sends. MLA's `PPA_BASE_URL` was pointed at the proxy for the capture, then restored to point at real PPA (`http://localhost:3000`) immediately after.

Each of the five fixtures was fed with:

```
npx ts-node --project tools/tsconfig.json -r dotenv/config tools/capture-feeder/index.ts \
  --file __tests__/fixtures/DRPP_Kafka_E2E_Pack/<fixture>/raw_messages.json
```

Party identity fields (`partyIdentifier`, `complexName`) appear PII-tokenized (`tkn_...`) — this is MLA's own US-PII-01/02 tokenization applied before the envelope reaches PPA, not redaction applied for this document.

## Result: none of the five reached TMS

All 40 envelopes (8 per transaction × 5) were delivered to PPA successfully — confirmed both by PPA's own logs referencing every envelope `id` below, and independently by the exact same captured envelope bodies replayed a second time producing an identical failure pattern. But for all five transactions, **every message PPA translated and attempted to send to Tazama TMS failed PPA's own local schema validation and was dead-lettered — TMS's container logs show zero `/v1/evaluate/iso20022/*` requests across the entire test.**

The failure is identical across all five, regardless of corridor:

| Message | Always missing |
| --- | --- |
| `pain.001.001.11` | `Purp`, `RmtInf` |
| `pain.013.001.09` | `Purp` |
| `pacs.008.001.10` | `RmtInf`, `GrpHdr.SttlmInf`, `ChrgBr` |
| `pacs.002.001.12` | never built — its upstream pacs.008 never sent, so it has no identity to resolve against (PPA's own R-04 "never synthesize" rule) |

Root cause: every transaction in this capture set carries `transactionType: {scenario: "TRANSFER", initiatorType: "BUSINESS"}`. PPA's `resolvePurposeCode` (`translation-helpers.ts`) has exactly one confirmed `Purp.Cd` mapping — `TRANSFER`/`CONSUMER` → `MP2P` — so `Purp` is omitted for every transaction here, and PPA's pinned Tazama schema requires it. `RmtInf`, `GrpHdr.SttlmInf` and `ChrgBr` fail for the same shape of reason: fields only populated when present in the source event, which this real capture data does not carry.

PPA's own log line per transaction, verbatim:

```
pain.001.001.11 for <quoteId> failed local validation - dead-lettered, not sent: data/CstmrCdtTrfInitn/PmtInf/CdtTrfTxInf must have required property 'Purp'; data/CstmrCdtTrfInitn/PmtInf/CdtTrfTxInf must have required property 'RmtInf'
pain.013.001.09 for <quoteId> failed local validation - dead-lettered, not sent: data/CdtrPmtActvtnReq/PmtInf/CdtTrfTxInf must have required property 'Purp'
pacs.008.001.10 for <transferId> failed local validation - dead-lettered, not sent: data/FIToFICstmrCdtTrf must have required property 'RmtInf'; data/FIToFICstmrCdtTrf/GrpHdr must have required property 'SttlmInf'; data/FIToFICstmrCdtTrf/CdtTrfTxInf must have required property 'ChrgBr'; data/FIToFICstmrCdtTrf/CdtTrfTxInf must have required property 'Purp'
pacs.002 trigger for <transferId> (transferId <transferId>) has no resolvable pacs.008 identity anywhere - dead-lettered, not sent (R-04)
```

Confirmed independently via PPA's `/metrics` endpoint — `ppa_local_validation_failed_total` incremented by exactly one per message type per transaction, and TMS's own container logs recorded no `/v1/evaluate` hits at all.

---

## Transaction 1 — `01_MWK_to_ZMW_PRIMARY` (MWK → ZMW via `test-fxp2`)

Single partition (2) in the source capture. `transferId: 01KZRP0E6JT2BX5EA20AQPTX6F`, `quoteId: 01KZRP0MH81MYFTW7PH0S9SYF2`.

### FXQUOTE request

```json
{
  "msgType": "request",
  "eventType": "FXQUOTE",
  "id": "01KZRP0HNJ2QSF9FENZW49X262",
  "correlationId": "a47a943b-6f1b-482c-8b5b-dde369dae3bc",
  "fspiop-source": "test-mwk-dfsp",
  "fspiop-destination": "test-fxp2",
  "body": {
    "conversionRequestId": "01KZRP0HNJ2QSF9FENZW49X262",
    "conversionTerms": {
      "amountType": "SEND",
      "conversionId": "01KZRP0HNKXGN9Y5NNWGGATF9M",
      "counterPartyFsp": "test-fxp2",
      "determiningTransferId": "01KZRP0E6JT2BX5EA20AQPTX6F",
      "expiration": "2026-08-11T15:11:46.450Z",
      "initiatingFsp": "test-mwk-dfsp",
      "sourceAmount": { "amount": "100", "currency": "MWK" },
      "targetAmount": { "amount": "0", "currency": "ZMW" }
    }
  },
  "timestamp": "2026-09-28T06:35:31.930Z"
}
```

### FXQUOTE callback

```json
{
  "msgType": "callback",
  "eventType": "FXQUOTE",
  "id": "01KZRP0HNJ2QSF9FENZW49X262",
  "correlationId": "24d73dbb-4ddf-4c39-847c-e1cc0a9183a5",
  "fspiop-source": "test-fxp2",
  "fspiop-destination": "test-mwk-dfsp",
  "body": {
    "condition": "jt_eYYgfwvrTbTEuWRZMs-4AQWU8c2kBMNxA-Kq2rWk",
    "conversionTerms": {
      "amountType": "SEND",
      "conversionId": "01KZRP0HNKXGN9Y5NNWGGATF9M",
      "counterPartyFsp": "test-fxp2",
      "determiningTransferId": "01KZRP0E6JT2BX5EA20AQPTX6F",
      "expiration": "2026-08-11T15:11:46.450Z",
      "initiatingFsp": "test-mwk-dfsp",
      "sourceAmount": { "amount": "100", "currency": "MWK" },
      "targetAmount": { "amount": "2", "currency": "ZMW" }
    }
  },
  "timestamp": "2026-09-28T06:35:31.971Z"
}
```

### QUOTE request

```json
{
  "msgType": "request",
  "eventType": "QUOTE",
  "id": "01KZRP0MH81MYFTW7PH0S9SYF2",
  "correlationId": "cf637a82-fce6-4348-9347-29352241e71c",
  "fspiop-source": "test-mwk-dfsp",
  "fspiop-destination": "test-zmw-dfsp",
  "body": {
    "amount": { "amount": "2", "currency": "ZMW" },
    "amountType": "SEND",
    "expiration": "2026-08-11T15:11:49.385Z",
    "payee": {
      "partyIdInfo": {
        "fspId": "test-zmw-dfsp",
        "partyIdType": "MSISDN",
        "partyIdentifier": "tkn_3780fabacf92b24f7caf059f87f727029d137fade7cff138cb4744751626e693"
      },
      "personalInfo": { "complexName": "tkn_117907d917c2dce47a3f9c7b8f69d124213ca429f90b189da036f0ea13b22a8a" }
    },
    "payer": {
      "name": "tkn_05f845ef2d08fe43e35d3b94d84faa3838c4a9ff6c615a5dd452f6b662a444af",
      "partyIdInfo": {
        "fspId": "test-mwk-dfsp",
        "partyIdType": "MSISDN",
        "partyIdentifier": "tkn_2b19a3d60f8b9eddc86503d280d3eca0108a8e1e0fb87772b5db028ee5d81166"
      },
      "personalInfo": { "complexName": "tkn_46781e456787840410c5101577115570c1b9f62146d6e56aab002f973f1e690d" }
    },
    "quoteId": "01KZRP0MH81MYFTW7PH0S9SYF2",
    "transactionId": "01KZRP0E6JT2BX5EA20AQPTX6F",
    "transactionType": { "initiator": "PAYER", "initiatorType": "BUSINESS", "scenario": "TRANSFER" }
  },
  "timestamp": "2026-09-28T06:35:31.992Z"
}
```

### QUOTE callback

```json
{
  "msgType": "callback",
  "eventType": "QUOTE",
  "id": "01KZRP0MH81MYFTW7PH0S9SYF2",
  "correlationId": "c78356ef-8568-41c9-ba3a-b64a3cb92e8d",
  "fspiop-source": "test-zmw-dfsp",
  "fspiop-destination": "test-mwk-dfsp",
  "body": {
    "condition": "nhem1zJqimhGKAGB6ghoH2j43tBAcUz-KGEgDm_NUZU",
    "expiration": "2026-08-11T15:11:53.350Z",
    "ilpPacket": "DIID2gAAAAAAAADIMjAyNjA4MTExNTExNTMzNTCeF6bXMmqKaEYoAYHqCGgfaPje0EBxTP4oYSAOb81RlQpnLm1vamFsb29wggOTZXlKeGRXOTBaVWxrSWpvaU1ERkxXbEpRTUUxSU9ERk5XVVpVVnpkUVNEQlRPVk5aUmpJaUxDSjBjbUZ1YzJGamRHbHZia2xrSWpvaU1ERkxXbEpRTUVVMlNsUXlRbGcxUlVFeU1FRlJVRlJZTmtZaUxDSjBjbUZ1YzJGamRHbHZibFI1Y0dVaU9uc2ljMk5sYm1GeWFXOGlPaUpVVWtGT1UwWkZVaUlzSW1sdWFYUnBZWFJ2Y2lJNklsQkJXVVZTSWl3aWFXNXBkR2xoZEc5eVZIbHdaU0k2SWtKVlUwbE9SVk5USW4wc0luQmhlV1ZsSWpwN0luQmhjblI1U1dSSmJtWnZJanA3SW5CaGNuUjVTV1JVZVhCbElqb2lUVk5KVTBST0lpd2ljR0Z5ZEhsSlpHVnVkR2xtYVdWeUlqb2lLekkyTURrM05qQXdNVEl6TkNJc0ltWnpjRWxrSWpvaWRHVnpkQzE2YlhjdFpHWnpjQ0o5TENKd1pYSnpiMjVoYkVsdVptOGlPbnNpWTI5dGNHeGxlRTVoYldVaU9uc2labWx5YzNST1lXMWxJam9pUTJocGEyOXVaR2tpTENKc1lYTjBUbUZ0WlNJNklrSmhibVJoSW4xOWZTd2ljR0Y1WlhJaU9uc2ljR0Z5ZEhsSlpFbHVabThpT25zaWNHRnlkSGxKWkZSNWNHVWlPaUpOVTBsVFJFNGlMQ0p3WVhKMGVVbGtaVzUwYVdacFpYSWlPaUlyTWpZMU9EZ3hNak0wTlRZM0lpd2labk53U1dRaU9pSjBaWE4wTFcxM2F5MWtabk53SW4wc0ltNWhiV1VpT2lKRWFYTndiR0Y1TFZSbGMzUWlMQ0p3WlhKemIyNWhiRWx1Wm04aU9uc2lZMjl0Y0d4bGVFNWhiV1VpT25zaVptbHljM1JPWVcxbElqb2lSbWx5YzNSdVlXMWxMVlJsYzNRaUxDSnRhV1JrYkdWT1lXMWxJam9pVFdsa1pHeGxibUZ0WlMxVVpYTjBJaXdpYkdGemRFNWhiV1VpT2lKTVlYTjBibUZ0WlMxVVpYTjBJbjE5ZlN3aVpYaHdhWEpoZEdsdmJpSTZJakl3TWpZdE1EZ3RNVEZVTVRVNk1URTZOVE11TXpVd1dpSXNJbUZ0YjNWdWRDSTZleUpoYlc5MWJuUWlPaUl5SWl3aVkzVnljbVZ1WTNraU9pSmFUVmNpZlgw",
    "payeeFspFee": { "amount": "0", "currency": "ZMW" },
    "payeeReceiveAmount": { "amount": "2", "currency": "ZMW" },
    "transferAmount": { "amount": "2", "currency": "ZMW" }
  },
  "timestamp": "2026-09-28T06:35:32.008Z"
}
```

### FXTRANSFER request

```json
{
  "msgType": "request",
  "eventType": "FXTRANSFER",
  "id": "01KZRP0HNKXGN9Y5NNWGGATF9M",
  "correlationId": "b3a0bb36-faa3-4cf8-ba9b-0f220888e2f2",
  "fspiop-source": "test-mwk-dfsp",
  "fspiop-destination": "test-fxp2",
  "body": {
    "commitRequestId": "01KZRP0HNKXGN9Y5NNWGGATF9M",
    "condition": "jt_eYYgfwvrTbTEuWRZMs-4AQWU8c2kBMNxA-Kq2rWk",
    "counterPartyFsp": "test-fxp2",
    "determiningTransferId": "01KZRP0E6JT2BX5EA20AQPTX6F",
    "expiration": "2026-08-11T15:11:55.489Z",
    "initiatingFsp": "test-mwk-dfsp",
    "sourceAmount": { "amount": "100", "currency": "MWK" },
    "targetAmount": { "amount": "2", "currency": "ZMW" }
  },
  "timestamp": "2026-09-28T06:35:32.022Z"
}
```

### FXTRANSFER callback

```json
{
  "msgType": "callback",
  "eventType": "FXTRANSFER",
  "id": "01KZRP0HNKXGN9Y5NNWGGATF9M",
  "correlationId": "5f2a0cc6-29c8-4a64-a7e2-fb62462b023c",
  "fspiop-source": "test-fxp2",
  "fspiop-destination": "test-mwk-dfsp",
  "body": {
    "GrpHdr": { "CreDtTm": "2026-08-11T15:11:00.257Z", "MsgId": "01KZRP0Z51AT4RQKAT4B16GG9H" },
    "TxInfAndSts": {
      "ExctnConf": "cL7G6l80HyIbgyyT_7k4nJDAG3090usHYlsCZMArt6Q",
      "PrcgDt": { "DtTm": "2026-08-11T15:11:00.132Z" },
      "TxSts": "RESV"
    }
  },
  "timestamp": "2026-09-28T06:35:32.030Z"
}
```

### TRANSFER request

```json
{
  "msgType": "request",
  "eventType": "TRANSFER",
  "id": "01KZRP0E6JT2BX5EA20AQPTX6F",
  "correlationId": "0ce2cae9-5365-4b33-8c09-df31b1d4d8bd",
  "fspiop-source": "test-mwk-dfsp",
  "fspiop-destination": "test-zmw-dfsp",
  "body": {
    "amount": { "amount": "2", "currency": "ZMW" },
    "condition": "nhem1zJqimhGKAGB6ghoH2j43tBAcUz-KGEgDm_NUZU",
    "expiration": "2026-08-11T15:12:05.107Z",
    "ilpPacket": "DIID2gAAAAAAAADIMjAyNjA4MTExNTExNTMzNTCeF6bXMmqKaEYoAYHqCGgfaPje0EBxTP4oYSAOb81RlQpnLm1vamFsb29wggOTZXlKeGRXOTBaVWxrSWpvaU1ERkxXbEpRTUUxSU9ERk5XVVpVVnpkUVNEQlRPVk5aUmpJaUxDSjBjbUZ1YzJGamRHbHZia2xrSWpvaU1ERkxXbEpRTUVVMlNsUXlRbGcxUlVFeU1FRlJVRlJZTmtZaUxDSjBjbUZ1YzJGamRHbHZibFI1Y0dVaU9uc2ljMk5sYm1GeWFXOGlPaUpVVWtGT1UwWkZVaUlzSW1sdWFYUnBZWFJ2Y2lJNklsQkJXVVZTSWl3aWFXNXBkR2xoZEc5eVZIbHdaU0k2SWtKVlUwbE9SVk5USW4wc0luQmhlV1ZsSWpwN0luQmhjblI1U1dSSmJtWnZJanA3SW5CaGNuUjVTV1JVZVhCbElqb2lUVk5KVTBST0lpd2ljR0Z5ZEhsSlpHVnVkR2xtYVdWeUlqb2lLekkyTURrM05qQXdNVEl6TkNJc0ltWnpjRWxrSWpvaWRHVnpkQzE2YlhjdFpHWnpjQ0o5TENKd1pYSnpiMjVoYkVsdVptOGlPbnNpWTI5dGNHeGxlRTVoYldVaU9uc2labWx5YzNST1lXMWxJam9pUTJocGEyOXVaR2tpTENKc1lYTjBUbUZ0WlNJNklrSmhibVJoSW4xOWZTd2ljR0Y1WlhJaU9uc2ljR0Z5ZEhsSlpFbHVabThpT25zaWNHRnlkSGxKWkZSNWNHVWlPaUpOVTBsVFJFNGlMQ0p3WVhKMGVVbGtaVzUwYVdacFpYSWlPaUlyTWpZMU9EZ3hNak0wTlRZM0lpd2labk53U1dRaU9pSjBaWE4wTFcxM2F5MWtabk53SW4wc0ltNWhiV1VpT2lKRWFYTndiR0Y1TFZSbGMzUWlMQ0p3WlhKemIyNWhiRWx1Wm04aU9uc2lZMjl0Y0d4bGVFNWhiV1VpT25zaVptbHljM1JPWVcxbElqb2lSbWx5YzNSdVlXMWxMVlJsYzNRaUxDSnRhV1JrYkdWT1lXMWxJam9pVFdsa1pHeGxibUZ0WlMxVVpYTjBJaXdpYkdGemRFNWhiV1VpT2lKTVlYTjBibUZ0WlMxVVpYTjBJbjE5ZlN3aVpYaHdhWEpoZEdsdmJpSTZJakl3TWpZdE1EZ3RNVEZVTVRVNk1URTZOVE11TXpVd1dpSXNJbUZ0YjNWdWRDSTZleUpoYlc5MWJuUWlPaUl5SWl3aVkzVnljbVZ1WTNraU9pSmFUVmNpZlgw",
    "payeeFsp": "test-zmw-dfsp",
    "payerFsp": "test-mwk-dfsp",
    "transferId": "01KZRP0E6JT2BX5EA20AQPTX6F"
  },
  "timestamp": "2026-09-28T06:35:32.039Z"
}
```

### TRANSFER callback

```json
{
  "msgType": "callback",
  "eventType": "TRANSFER",
  "id": "01KZRP0E6JT2BX5EA20AQPTX6F",
  "correlationId": "e672a885-fc1e-47fd-8bd3-df63ab9d58c4",
  "fspiop-source": "test-zmw-dfsp",
  "fspiop-destination": "test-mwk-dfsp",
  "body": {
    "GrpHdr": { "CreDtTm": "2026-08-11T15:11:09.747Z", "MsgId": "01KZRP18DJKTVKPP5PZJ6B0AKN" },
    "TxInfAndSts": {
      "ExctnConf": "IcI5ePHLWnhG-xP4gfqsFPhr9RmhoDQ9IolOanPtP34",
      "PrcgDt": { "DtTm": "2026-08-11T15:11:09.654Z" },
      "TxSts": "COMM"
    }
  },
  "timestamp": "2026-09-28T06:35:32.052Z"
}
```

**PPA outcome:** pain.001, pain.013 and pacs.008 all dead-lettered on local validation (missing `Purp`/`RmtInf`/`SttlmInf`/`ChrgBr`); pacs.002 never built (no resolvable pacs.008 identity). Nothing reached TMS.

---

## Transaction 2 — `02_ZMW_to_MWK` (ZMW → MWK via `test-fxp`)

Single partition (11). `transferId: 01KZRNZPZ369TMTP3XMCMYZNFJ`, `quoteId: 01KZRP01M662KSB04CFM68K3AF`.

### FXQUOTE request

```json
{
  "msgType": "request",
  "eventType": "FXQUOTE",
  "id": "01KZRNZWJRRG7WDXM37JN8TS1Z",
  "correlationId": "336af198-a6a4-423f-9ea4-6dd1baf39e37",
  "fspiop-source": "test-zmw-dfsp",
  "fspiop-destination": "test-fxp",
  "body": {
    "conversionRequestId": "01KZRNZWJRRG7WDXM37JN8TS1Z",
    "conversionTerms": {
      "amountType": "SEND",
      "conversionId": "01KZRNZWJRRG7WDXM37JN8TS20",
      "counterPartyFsp": "test-fxp",
      "determiningTransferId": "01KZRNZPZ369TMTP3XMCMYZNFJ",
      "expiration": "2026-08-11T15:11:24.856Z",
      "initiatingFsp": "test-zmw-dfsp",
      "sourceAmount": { "amount": "10", "currency": "ZMW" },
      "targetAmount": { "amount": "0", "currency": "MWK" }
    }
  },
  "timestamp": "2026-09-28T06:35:31.929Z"
}
```

### FXQUOTE callback

```json
{
  "msgType": "callback",
  "eventType": "FXQUOTE",
  "id": "01KZRNZWJRRG7WDXM37JN8TS1Z",
  "correlationId": "123afb61-0680-4ef5-9a32-c2d1391632d7",
  "fspiop-source": "test-fxp",
  "fspiop-destination": "test-zmw-dfsp",
  "body": {
    "condition": "GSNJS4WIDNizY23nteBOma4ucgyn0qW2Gnrnc-Wgh9c",
    "conversionTerms": {
      "amountType": "SEND",
      "conversionId": "01KZRNZWJRRG7WDXM37JN8TS20",
      "counterPartyFsp": "test-fxp",
      "determiningTransferId": "01KZRNZPZ369TMTP3XMCMYZNFJ",
      "expiration": "2026-08-11T15:11:24.856Z",
      "initiatingFsp": "test-zmw-dfsp",
      "sourceAmount": { "amount": "10", "currency": "ZMW" },
      "targetAmount": { "amount": "514", "currency": "MWK" }
    }
  },
  "timestamp": "2026-09-28T06:35:31.969Z"
}
```

### QUOTE request

```json
{
  "msgType": "request",
  "eventType": "QUOTE",
  "id": "01KZRP01M662KSB04CFM68K3AF",
  "correlationId": "43fe4068-c034-4006-b79b-40f496c13e50",
  "fspiop-source": "test-zmw-dfsp",
  "fspiop-destination": "test-mwk-dfsp",
  "body": {
    "amount": { "amount": "514", "currency": "MWK" },
    "amountType": "SEND",
    "expiration": "2026-08-11T15:11:30.022Z",
    "payee": {
      "partyIdInfo": {
        "fspId": "test-mwk-dfsp",
        "partyIdType": "MSISDN",
        "partyIdentifier": "tkn_2b19a3d60f8b9eddc86503d280d3eca0108a8e1e0fb87772b5db028ee5d81166"
      },
      "personalInfo": { "complexName": "tkn_117907d917c2dce47a3f9c7b8f69d124213ca429f90b189da036f0ea13b22a8a" }
    },
    "payer": {
      "name": "tkn_05f845ef2d08fe43e35d3b94d84faa3838c4a9ff6c615a5dd452f6b662a444af",
      "partyIdInfo": {
        "fspId": "test-zmw-dfsp",
        "partyIdType": "MSISDN",
        "partyIdentifier": "tkn_3780fabacf92b24f7caf059f87f727029d137fade7cff138cb4744751626e693"
      },
      "personalInfo": { "complexName": "tkn_46781e456787840410c5101577115570c1b9f62146d6e56aab002f973f1e690d" }
    },
    "quoteId": "01KZRP01M662KSB04CFM68K3AF",
    "transactionId": "01KZRNZPZ369TMTP3XMCMYZNFJ",
    "transactionType": { "initiator": "PAYER", "initiatorType": "BUSINESS", "scenario": "TRANSFER" }
  },
  "timestamp": "2026-09-28T06:35:31.986Z"
}
```

### QUOTE callback

```json
{
  "msgType": "callback",
  "eventType": "QUOTE",
  "id": "01KZRP01M662KSB04CFM68K3AF",
  "correlationId": "1ef3664e-daab-4b87-a821-61b741a93876",
  "fspiop-source": "test-mwk-dfsp",
  "fspiop-destination": "test-zmw-dfsp",
  "body": {
    "condition": "MvFg0eTU0j3ieTjQqUdyRgXjpH6pEGFsvl9o8F4yAyE",
    "expiration": "2026-08-11T15:11:34.816Z",
    "ilpPacket": "DIID3QAAAAAAAMjIMjAyNjA4MTExNTExMzQ4MTYy8WDR5NTSPeJ5ONCpR3JGBeOkfqkQYWy-X2jwXjIDIQpnLm1vamFsb29wggOWZXlKeGRXOTBaVWxrSWpvaU1ERkxXbEpRTURGTk5qWXlTMU5DTURSRFJrMDJPRXN6UVVZaUxDSjBjbUZ1YzJGamRHbHZia2xrSWpvaU1ERkxXbEpPV2xCYU16WTVWRTFVVUROWVRVTk5XVnBPUmtvaUxDSjBjbUZ1YzJGamRHbHZibFI1Y0dVaU9uc2ljMk5sYm1GeWFXOGlPaUpVVWtGT1UwWkZVaUlzSW1sdWFYUnBZWFJ2Y2lJNklsQkJXVVZTSWl3aWFXNXBkR2xoZEc5eVZIbHdaU0k2SWtKVlUwbE9SVk5USW4wc0luQmhlV1ZsSWpwN0luQmhjblI1U1dSSmJtWnZJanA3SW5CaGNuUjVTV1JVZVhCbElqb2lUVk5KVTBST0lpd2ljR0Z5ZEhsSlpHVnVkR2xtYVdWeUlqb2lLekkyTlRnNE1USXpORFUyTnlJc0ltWnpjRWxrSWpvaWRHVnpkQzF0ZDJzdFpHWnpjQ0o5TENKd1pYSnpiMjVoYkVsdVptOGlPbnNpWTI5dGNHeGxlRTVoYldVaU9uc2labWx5YzNST1lXMWxJam9pUTJocGEyOXVaR2tpTENKc1lYTjBUbUZ0WlNJNklrSmhibVJoSW4xOWZTd2ljR0Y1WlhJaU9uc2ljR0Z5ZEhsSlpFbHVabThpT25zaWNHRnlkSGxKWkZSNWNHVWlPaUpOVTBsVFJFNGlMQ0p3WVhKMGVVbGtaVzUwYVdacFpYSWlPaUlyTWpZd09UYzJNREF4TWpNMElpd2labk53U1dRaU9pSjBaWE4wTFhwdGR5MWtabk53SW4wc0ltNWhiV1VpT2lKRWFYTndiR0Y1TFZSbGMzUWlMQ0p3WlhKemIyNWhiRWx1Wm04aU9uc2lZMjl0Y0d4bGVFNWhiV1VpT25zaVptbHljM1JPWVcxbElqb2lSbWx5YzNSdVlXMWxMVlJsYzNRaUxDSnRhV1JrYkdWT1lXMWxJam9pVFdsa1pHeGxibUZ0WlMxVVpYTjBJaXdpYkdGemRFNWhiV1VpT2lKTVlYTjBibUZ0WlMxVVpYTjBJbjE5ZlN3aVpYaHdhWEpoZEdsdmJpSTZJakl3TWpZdE1EZ3RNVEZVTVRVNk1URTZNelF1T0RFMldpSXNJbUZ0YjNWdWRDSTZleUpoYlc5MWJuUWlPaUkxTVRRaUxDSmpkWEp5Wlc1amVTSTZJazFYU3lKOWZR",
    "payeeFspFee": { "amount": "0", "currency": "MWK" },
    "payeeReceiveAmount": { "amount": "514", "currency": "MWK" },
    "transferAmount": { "amount": "514", "currency": "MWK" }
  },
  "timestamp": "2026-09-28T06:35:31.998Z"
}
```

### FXTRANSFER request

```json
{
  "msgType": "request",
  "eventType": "FXTRANSFER",
  "id": "01KZRNZWJRRG7WDXM37JN8TS20",
  "correlationId": "4bd15b2e-6e8d-4fa5-8d0e-6ef4ee35fc0c",
  "fspiop-source": "test-zmw-dfsp",
  "fspiop-destination": "test-fxp",
  "body": {
    "commitRequestId": "01KZRNZWJRRG7WDXM37JN8TS20",
    "condition": "GSNJS4WIDNizY23nteBOma4ucgyn0qW2Gnrnc-Wgh9c",
    "counterPartyFsp": "test-fxp",
    "determiningTransferId": "01KZRNZPZ369TMTP3XMCMYZNFJ",
    "expiration": "2026-08-11T15:11:37.872Z",
    "initiatingFsp": "test-zmw-dfsp",
    "sourceAmount": { "amount": "10", "currency": "ZMW" },
    "targetAmount": { "amount": "514", "currency": "MWK" }
  },
  "timestamp": "2026-09-28T06:35:32.013Z"
}
```

### FXTRANSFER callback

```json
{
  "msgType": "callback",
  "eventType": "FXTRANSFER",
  "id": "01KZRNZWJRRG7WDXM37JN8TS20",
  "correlationId": "f119d21d-f7ac-4ffe-aaaa-ff7aceaf8f9b",
  "fspiop-source": "test-fxp",
  "fspiop-destination": "test-zmw-dfsp",
  "body": {
    "GrpHdr": { "CreDtTm": "2026-08-11T15:10:42.452Z", "MsgId": "01KZRP0DRMG4M1W68XR47BDK7V" },
    "TxInfAndSts": {
      "ExctnConf": "1Pi75UWJW6CGsGIKtK1ehd5T465GI9IIle5lOm9QTtQ",
      "PrcgDt": { "DtTm": "2026-08-11T15:10:42.440Z" },
      "TxSts": "RESV"
    }
  },
  "timestamp": "2026-09-28T06:35:32.024Z"
}
```

### TRANSFER request

```json
{
  "msgType": "request",
  "eventType": "TRANSFER",
  "id": "01KZRNZPZ369TMTP3XMCMYZNFJ",
  "correlationId": "7d61f142-b5c7-497a-a2ee-c1e0b9d97848",
  "fspiop-source": "test-zmw-dfsp",
  "fspiop-destination": "test-mwk-dfsp",
  "body": {
    "amount": { "amount": "514", "currency": "MWK" },
    "condition": "MvFg0eTU0j3ieTjQqUdyRgXjpH6pEGFsvl9o8F4yAyE",
    "expiration": "2026-08-11T15:11:47.684Z",
    "ilpPacket": "DIID3QAAAAAAAMjIMjAyNjA4MTExNTExMzQ4MTYy8WDR5NTSPeJ5ONCpR3JGBeOkfqkQYWy-X2jwXjIDIQpnLm1vamFsb29wggOWZXlKeGRXOTBaVWxrSWpvaU1ERkxXbEpRTURGTk5qWXlTMU5DTURSRFJrMDJPRXN6UVVZaUxDSjBjbUZ1YzJGamRHbHZia2xrSWpvaU1ERkxXbEpPV2xCYU16WTVWRTFVVUROWVRVTk5XVnBPUmtvaUxDSjBjbUZ1YzJGamRHbHZibFI1Y0dVaU9uc2ljMk5sYm1GeWFXOGlPaUpVVWtGT1UwWkZVaUlzSW1sdWFYUnBZWFJ2Y2lJNklsQkJXVVZTSWl3aWFXNXBkR2xoZEc5eVZIbHdaU0k2SWtKVlUwbE9SVk5USW4wc0luQmhlV1ZsSWpwN0luQmhjblI1U1dSSmJtWnZJanA3SW5CaGNuUjVTV1JVZVhCbElqb2lUVk5KVTBST0lpd2ljR0Z5ZEhsSlpHVnVkR2xtYVdWeUlqb2lLekkyTlRnNE1USXpORFUyTnlJc0ltWnpjRWxrSWpvaWRHVnpkQzF0ZDJzdFpHWnpjQ0o5TENKd1pYSnpiMjVoYkVsdVptOGlPbnNpWTI5dGNHeGxlRTVoYldVaU9uc2labWx5YzNST1lXMWxJam9pUTJocGEyOXVaR2tpTENKc1lYTjBUbUZ0WlNJNklrSmhibVJoSW4xOWZTd2ljR0Y1WlhJaU9uc2ljR0Z5ZEhsSlpFbHVabThpT25zaWNHRnlkSGxKWkZSNWNHVWlPaUpOVTBsVFJFNGlMQ0p3WVhKMGVVbGtaVzUwYVdacFpYSWlPaUlyTWpZd09UYzJNREF4TWpNMElpd2labk53U1dRaU9pSjBaWE4wTFhwdGR5MWtabk53SW4wc0ltNWhiV1VpT2lKRWFYTndiR0Y1TFZSbGMzUWlMQ0p3WlhKemIyNWhiRWx1Wm04aU9uc2lZMjl0Y0d4bGVFNWhiV1VpT25zaVptbHljM1JPWVcxbElqb2lSbWx5YzNSdVlXMWxMVlJsYzNRaUxDSnRhV1JrYkdWT1lXMWxJam9pVFdsa1pHeGxibUZ0WlMxVVpYTjBJaXdpYkdGemRFNWhiV1VpT2lKTVlYTjBibUZ0WlMxVVpYTjBJbjE5ZlN3aVpYaHdhWEpoZEdsdmJpSTZJakl3TWpZdE1EZ3RNVEZVTVRVNk1URTZNelF1T0RFMldpSXNJbUZ0YjNWdWRDSTZleUpoYlc5MWJuUWlPaUkxTVRRaUxDSmpkWEp5Wlc1amVTSTZJazFYU3lKOWZR",
    "payeeFsp": "test-mwk-dfsp",
    "payerFsp": "test-zmw-dfsp",
    "transferId": "01KZRNZPZ369TMTP3XMCMYZNFJ"
  },
  "timestamp": "2026-09-28T06:35:32.030Z"
}
```

### TRANSFER callback

```json
{
  "msgType": "callback",
  "eventType": "TRANSFER",
  "id": "01KZRNZPZ369TMTP3XMCMYZNFJ",
  "correlationId": "6c6a337b-4db0-4d76-8125-03c1ab79d796",
  "fspiop-source": "test-mwk-dfsp",
  "fspiop-destination": "test-zmw-dfsp",
  "body": {
    "GrpHdr": { "CreDtTm": "2026-08-11T15:10:55.457Z", "MsgId": "01KZRP0TF0HVAFRNYWJBKP2T1R" },
    "TxInfAndSts": {
      "ExctnConf": "iBLTtCBCYfxz6wHLyjul9apEFI5Yw3KuO8H7boib6ao",
      "PrcgDt": { "DtTm": "2026-08-11T15:10:55.445Z" },
      "TxSts": "COMM"
    }
  },
  "timestamp": "2026-09-28T06:35:32.039Z"
}
```

**PPA outcome:** identical to Transaction 1 — pain.001/pain.013/pacs.008 dead-lettered, pacs.002 never built. Nothing reached TMS.

---

## Transaction 3 — `03_ZMW_to_MWK_alt` (ZMW → MWK via `test-fxp`)

Single partition (7). `transferId: 01KZRPBHPY9E8B8SPAF5CYFC3C`, `quoteId: 01KZRPBS1ZVBKJ7JK80PQNJHM9`.

### FXQUOTE request

```json
{
  "msgType": "request",
  "eventType": "FXQUOTE",
  "id": "01KZRPBP2TYGND6CDHM7FPH33V",
  "correlationId": "9afb1704-64ae-4a52-9390-4c1c241f2cea",
  "fspiop-source": "test-zmw-dfsp",
  "fspiop-destination": "test-fxp",
  "body": {
    "conversionRequestId": "01KZRPBP2TYGND6CDHM7FPH33V",
    "conversionTerms": {
      "amountType": "SEND",
      "conversionId": "01KZRPBP2TYGND6CDHM7FPH33W",
      "counterPartyFsp": "test-fxp",
      "determiningTransferId": "01KZRPBHPY9E8B8SPAF5CYFC3C",
      "expiration": "2026-08-11T15:17:51.418Z",
      "initiatingFsp": "test-zmw-dfsp",
      "sourceAmount": { "amount": "10", "currency": "ZMW" },
      "targetAmount": { "amount": "0", "currency": "MWK" }
    }
  },
  "timestamp": "2026-09-28T06:35:31.928Z"
}
```

### FXQUOTE callback

```json
{
  "msgType": "callback",
  "eventType": "FXQUOTE",
  "id": "01KZRPBP2TYGND6CDHM7FPH33V",
  "correlationId": "5ebb7fba-9b42-476d-97a6-25bc3f45c6ca",
  "fspiop-source": "test-fxp",
  "fspiop-destination": "test-zmw-dfsp",
  "body": {
    "condition": "gb1LRvyKnkKv5f_s_uXhdc5dtRaJ-69RWWqdvch_C2A",
    "conversionTerms": {
      "amountType": "SEND",
      "conversionId": "01KZRPBP2TYGND6CDHM7FPH33W",
      "counterPartyFsp": "test-fxp",
      "determiningTransferId": "01KZRPBHPY9E8B8SPAF5CYFC3C",
      "expiration": "2026-08-11T15:17:51.418Z",
      "initiatingFsp": "test-zmw-dfsp",
      "sourceAmount": { "amount": "10", "currency": "ZMW" },
      "targetAmount": { "amount": "514", "currency": "MWK" }
    }
  },
  "timestamp": "2026-09-28T06:35:31.971Z"
}
```

### QUOTE request

```json
{
  "msgType": "request",
  "eventType": "QUOTE",
  "id": "01KZRPBS1ZVBKJ7JK80PQNJHM9",
  "correlationId": "dd0a79b8-57da-4af9-9759-2f4eda673f88",
  "fspiop-source": "test-zmw-dfsp",
  "fspiop-destination": "test-mwk-dfsp",
  "body": {
    "amount": { "amount": "514", "currency": "MWK" },
    "amountType": "SEND",
    "expiration": "2026-08-11T15:17:54.463Z",
    "payee": {
      "partyIdInfo": {
        "fspId": "test-mwk-dfsp",
        "partyIdType": "MSISDN",
        "partyIdentifier": "tkn_2b19a3d60f8b9eddc86503d280d3eca0108a8e1e0fb87772b5db028ee5d81166"
      },
      "personalInfo": { "complexName": "tkn_117907d917c2dce47a3f9c7b8f69d124213ca429f90b189da036f0ea13b22a8a" }
    },
    "payer": {
      "name": "tkn_05f845ef2d08fe43e35d3b94d84faa3838c4a9ff6c615a5dd452f6b662a444af",
      "partyIdInfo": {
        "fspId": "test-zmw-dfsp",
        "partyIdType": "MSISDN",
        "partyIdentifier": "tkn_3780fabacf92b24f7caf059f87f727029d137fade7cff138cb4744751626e693"
      },
      "personalInfo": { "complexName": "tkn_46781e456787840410c5101577115570c1b9f62146d6e56aab002f973f1e690d" }
    },
    "quoteId": "01KZRPBS1ZVBKJ7JK80PQNJHM9",
    "transactionId": "01KZRPBHPY9E8B8SPAF5CYFC3C",
    "transactionType": { "initiator": "PAYER", "initiatorType": "BUSINESS", "scenario": "TRANSFER" }
  },
  "timestamp": "2026-09-28T06:35:31.989Z"
}
```

### QUOTE callback

```json
{
  "msgType": "callback",
  "eventType": "QUOTE",
  "id": "01KZRPBS1ZVBKJ7JK80PQNJHM9",
  "correlationId": "de16decd-a2b2-4fd7-9ed5-0f62cf3c0ab7",
  "fspiop-source": "test-mwk-dfsp",
  "fspiop-destination": "test-zmw-dfsp",
  "body": {
    "condition": "CPqD2tcFGaFgvmOHm0sTVw5vSYzkDbJDgKCS5N3zldY",
    "expiration": "2026-08-11T15:17:56.406Z",
    "ilpPacket": "DIID3QAAAAAAAMjIMjAyNjA4MTExNTE3NTY0MDYI-oPa1wUZoWC-Y4ebSxNXDm9JjOQNskOAoJLk3fOV1gpnLm1vamFsb29wggOWZXlKeGRXOTBaVWxrSWpvaU1ERkxXbEpRUWxNeFdsWkNTMG8zU2tzNE1GQlJUa3BJVFRraUxDSjBjbUZ1YzJGamRHbHZia2xrSWpvaU1ERkxXbEpRUWtoUVdUbEZPRUk0VTFCQlJqVkRXVVpETTBNaUxDSjBjbUZ1YzJGamRHbHZibFI1Y0dVaU9uc2ljMk5sYm1GeWFXOGlPaUpVVWtGT1UwWkZVaUlzSW1sdWFYUnBZWFJ2Y2lJNklsQkJXVVZTSWl3aWFXNXBkR2xoZEc5eVZIbHdaU0k2SWtKVlUwbE9SVk5USW4wc0luQmhlV1ZsSWpwN0luQmhjblI1U1dSSmJtWnZJanA3SW5CaGNuUjVTV1JVZVhCbElqb2lUVk5KVTBST0lpd2ljR0Z5ZEhsSlpHVnVkR2xtYVdWeUlqb2lLekkyTlRnNE1USXpORFUyTnlJc0ltWnpjRWxrSWpvaWRHVnpkQzF0ZDJzdFpHWnpjQ0o5TENKd1pYSnpiMjVoYkVsdVptOGlPbnNpWTI5dGNHeGxlRTVoYldVaU9uc2labWx5YzNST1lXMWxJam9pUTJocGEyOXVaR2tpTENKc1lYTjBUbUZ0WlNJNklrSmhibVJoSW4xOWZTd2ljR0Y1WlhJaU9uc2ljR0Z5ZEhsSlpFbHVabThpT25zaWNHRnlkSGxKWkZSNWNHVWlPaUpOVTBsVFJFNGlMQ0p3WVhKMGVVbGtaVzUwYVdacFpYSWlPaUlyTWpZd09UYzJNREF4TWpNMElpd2labk53U1dRaU9pSjBaWE4wTFhwdGR5MWtabk53SW4wc0ltNWhiV1VpT2lKRWFYTndiR0Y1TFZSbGMzUWlMQ0p3WlhKemIyNWhiRWx1Wm04aU9uc2lZMjl0Y0d4bGVFNWhiV1VpT25zaVptbHljM1JPWVcxbElqb2lSbWx5YzNSdVlXMWxMVlJsYzNRaUxDSnRhV1JrYkdWT1lXMWxJam9pVFdsa1pHeGxibUZ0WlMxVVpYTjBJaXdpYkdGemRFNWhiV1VpT2lKTVlYTjBibUZ0WlMxVVpYTjBJbjE5ZlN3aVpYaHdhWEpoZEdsdmJpSTZJakl3TWpZdE1EZ3RNVEZVTVRVNk1UYzZOVFl1TkRBMldpSXNJbUZ0YjNWdWRDSTZleUpoYlc5MWJuUWlPaUkxTVRRaUxDSmpkWEp5Wlc1amVTSTZJazFYU3lKOWZR",
    "payeeFspFee": { "amount": "0", "currency": "MWK" },
    "payeeReceiveAmount": { "amount": "514", "currency": "MWK" },
    "transferAmount": { "amount": "514", "currency": "MWK" }
  },
  "timestamp": "2026-09-28T06:35:32.002Z"
}
```

### FXTRANSFER request

```json
{
  "msgType": "request",
  "eventType": "FXTRANSFER",
  "id": "01KZRPBP2TYGND6CDHM7FPH33W",
  "correlationId": "63e1592a-0e29-4f25-a804-338b7fc4a371",
  "fspiop-source": "test-zmw-dfsp",
  "fspiop-destination": "test-fxp",
  "body": {
    "commitRequestId": "01KZRPBP2TYGND6CDHM7FPH33W",
    "condition": "gb1LRvyKnkKv5f_s_uXhdc5dtRaJ-69RWWqdvch_C2A",
    "counterPartyFsp": "test-fxp",
    "determiningTransferId": "01KZRPBHPY9E8B8SPAF5CYFC3C",
    "expiration": "2026-08-11T15:17:58.357Z",
    "initiatingFsp": "test-zmw-dfsp",
    "sourceAmount": { "amount": "10", "currency": "ZMW" },
    "targetAmount": { "amount": "514", "currency": "MWK" }
  },
  "timestamp": "2026-09-28T06:35:32.018Z"
}
```

### FXTRANSFER callback

```json
{
  "msgType": "callback",
  "eventType": "FXTRANSFER",
  "id": "01KZRPBP2TYGND6CDHM7FPH33W",
  "correlationId": "2f67eb5f-f456-4a10-b548-7f8c8c97741d",
  "fspiop-source": "test-fxp",
  "fspiop-destination": "test-zmw-dfsp",
  "body": {
    "GrpHdr": { "CreDtTm": "2026-08-11T15:17:04.502Z", "MsgId": "01KZRPC2VPNG7S66ZG4JVHZXAC" },
    "TxInfAndSts": {
      "ExctnConf": "2Y_M-y7Yd57fOa0obeVcsvQ2v88ZCq7zaRqlCGy5Vaw",
      "PrcgDt": { "DtTm": "2026-08-11T15:17:04.491Z" },
      "TxSts": "RESV"
    }
  },
  "timestamp": "2026-09-28T06:35:32.027Z"
}
```

### TRANSFER request

```json
{
  "msgType": "request",
  "eventType": "TRANSFER",
  "id": "01KZRPBHPY9E8B8SPAF5CYFC3C",
  "correlationId": "dae4a96d-b4f1-4c58-8b5c-4290f3f2c3b4",
  "fspiop-source": "test-zmw-dfsp",
  "fspiop-destination": "test-mwk-dfsp",
  "body": {
    "amount": { "amount": "514", "currency": "MWK" },
    "condition": "CPqD2tcFGaFgvmOHm0sTVw5vSYzkDbJDgKCS5N3zldY",
    "expiration": "2026-08-11T15:18:09.054Z",
    "ilpPacket": "DIID3QAAAAAAAMjIMjAyNjA4MTExNTE3NTY0MDYI-oPa1wUZoWC-Y4ebSxNXDm9JjOQNskOAoJLk3fOV1gpnLm1vamFsb29wggOWZXlKeGRXOTBaVWxrSWpvaU1ERkxXbEpRUWxNeFdsWkNTMG8zU2tzNE1GQlJUa3BJVFRraUxDSjBjbUZ1YzJGamRHbHZia2xrSWpvaU1ERkxXbEpRUWtoUVdUbEZPRUk0VTFCQlJqVkRXVVpETTBNaUxDSjBjbUZ1YzJGamRHbHZibFI1Y0dVaU9uc2ljMk5sYm1GeWFXOGlPaUpVVWtGT1UwWkZVaUlzSW1sdWFYUnBZWFJ2Y2lJNklsQkJXVVZTSWl3aWFXNXBkR2xoZEc5eVZIbHdaU0k2SWtKVlUwbE9SVk5USW4wc0luQmhlV1ZsSWpwN0luQmhjblI1U1dSSmJtWnZJanA3SW5CaGNuUjVTV1JVZVhCbElqb2lUVk5KVTBST0lpd2ljR0Z5ZEhsSlpHVnVkR2xtYVdWeUlqb2lLekkyTlRnNE1USXpORFUyTnlJc0ltWnpjRWxrSWpvaWRHVnpkQzF0ZDJzdFpHWnpjQ0o5TENKd1pYSnpiMjVoYkVsdVptOGlPbnNpWTI5dGNHeGxlRTVoYldVaU9uc2labWx5YzNST1lXMWxJam9pUTJocGEyOXVaR2tpTENKc1lYTjBUbUZ0WlNJNklrSmhibVJoSW4xOWZTd2ljR0Y1WlhJaU9uc2ljR0Z5ZEhsSlpFbHVabThpT25zaWNHRnlkSGxKWkZSNWNHVWlPaUpOVTBsVFJFNGlMQ0p3WVhKMGVVbGtaVzUwYVdacFpYSWlPaUlyTWpZd09UYzJNREF4TWpNMElpd2labk53U1dRaU9pSjBaWE4wTFhwdGR5MWtabk53SW4wc0ltNWhiV1VpT2lKRWFYTndiR0Y1TFZSbGMzUWlMQ0p3WlhKemIyNWhiRWx1Wm04aU9uc2lZMjl0Y0d4bGVFNWhiV1VpT25zaVptbHljM1JPWVcxbElqb2lSbWx5YzNSdVlXMWxMVlJsYzNRaUxDSnRhV1JrYkdWT1lXMWxJam9pVFdsa1pHeGxibUZ0WlMxVVpYTjBJaXdpYkdGemRFNWhiV1VpT2lKTVlYTjBibUZ0WlMxVVpYTjBJbjE5ZlN3aVpYaHdhWEpoZEdsdmJpSTZJakl3TWpZdE1EZ3RNVEZVTVRVNk1UYzZOVFl1TkRBMldpSXNJbUZ0YjNWdWRDSTZleUpoYlc5MWJuUWlPaUkxTVRRaUxDSmpkWEp5Wlc1amVTSTZJazFYU3lKOWZR",
    "payeeFsp": "test-mwk-dfsp",
    "payerFsp": "test-zmw-dfsp",
    "transferId": "01KZRPBHPY9E8B8SPAF5CYFC3C"
  },
  "timestamp": "2026-09-28T06:35:32.034Z"
}
```

### TRANSFER callback

```json
{
  "msgType": "callback",
  "eventType": "TRANSFER",
  "id": "01KZRPBHPY9E8B8SPAF5CYFC3C",
  "correlationId": "f8a70ebb-90bc-43de-98eb-62516305e248",
  "fspiop-source": "test-mwk-dfsp",
  "fspiop-destination": "test-zmw-dfsp",
  "body": {
    "GrpHdr": { "CreDtTm": "2026-08-11T15:17:16.853Z", "MsgId": "01KZRPCEXNGX3ME3GFYPYVNBP5" },
    "TxInfAndSts": {
      "ExctnConf": "CYVFK9aKQ9wpXih7J9P1toQm6IciQeSkNYpnpPNM_4U",
      "PrcgDt": { "DtTm": "2026-08-11T15:17:16.830Z" },
      "TxSts": "COMM"
    }
  },
  "timestamp": "2026-09-28T06:35:32.047Z"
}
```

**PPA outcome:** identical to Transactions 1–2. Nothing reached TMS.

---

## Transaction 4 — `04_ZMW_to_EGP_partition_split` (ZMW → EGP via `test-fxp`)

Split across partitions **7 and 10** in the source capture — the payee-side settlement leg (fulfil) arrives under a different `traceId` than the rest of the transaction and can hash to a different partition, so it can genuinely be delivered out of order. That is reproduced here: the TRANSFER **callback** (below) actually arrived at MLA/PPA *before* its own TRANSFER **request**, timestamps `06:35:31.933Z` vs. `06:35:32.107Z`. `transferId: 01KZRPCPGMYAD5YJKN33FWFRD2`, `quoteId: 01KZRPCY74VHKR5BQXKDDAQ3N8`.

### FXQUOTE request

```json
{
  "msgType": "request",
  "eventType": "FXQUOTE",
  "id": "01KZRPCV2ATD1ZATJKSE2RV3QG",
  "correlationId": "cd03d6b8-d07c-4bb9-bf85-61510b6eaae5",
  "fspiop-source": "test-zmw-dfsp",
  "fspiop-destination": "test-fxp",
  "body": {
    "conversionRequestId": "01KZRPCV2ATD1ZATJKSE2RV3QG",
    "conversionTerms": {
      "amountType": "SEND",
      "conversionId": "01KZRPCV2ATD1ZATJKSE2RV3QH",
      "counterPartyFsp": "test-fxp",
      "determiningTransferId": "01KZRPCPGMYAD5YJKN33FWFRD2",
      "expiration": "2026-08-11T15:18:29.290Z",
      "initiatingFsp": "test-zmw-dfsp",
      "sourceAmount": { "amount": "10", "currency": "ZMW" },
      "targetAmount": { "amount": "0", "currency": "EGP" }
    }
  },
  "timestamp": "2026-09-28T06:35:32.057Z"
}
```

### FXQUOTE callback

```json
{
  "msgType": "callback",
  "eventType": "FXQUOTE",
  "id": "01KZRPCV2ATD1ZATJKSE2RV3QG",
  "correlationId": "f4c5407b-ca0e-4d3a-915c-aa84aa883b11",
  "fspiop-source": "test-fxp",
  "fspiop-destination": "test-zmw-dfsp",
  "body": {
    "condition": "HanuZGWbUc9WBpfUWskIkckWrk2AeS0wcdQ17TsmJfo",
    "conversionTerms": {
      "amountType": "SEND",
      "conversionId": "01KZRPCV2ATD1ZATJKSE2RV3QH",
      "counterPartyFsp": "test-fxp",
      "determiningTransferId": "01KZRPCPGMYAD5YJKN33FWFRD2",
      "expiration": "2026-08-11T15:18:29.290Z",
      "initiatingFsp": "test-zmw-dfsp",
      "sourceAmount": { "amount": "10", "currency": "ZMW" },
      "targetAmount": { "amount": "15", "currency": "EGP" }
    }
  },
  "timestamp": "2026-09-28T06:35:32.063Z"
}
```

### QUOTE request

```json
{
  "msgType": "request",
  "eventType": "QUOTE",
  "id": "01KZRPCY74VHKR5BQXKDDAQ3N8",
  "correlationId": "21b9242e-4f78-493f-b6a6-ecee1f8666ab",
  "fspiop-source": "test-zmw-dfsp",
  "fspiop-destination": "test-egp-dfsp",
  "body": {
    "amount": { "amount": "15", "currency": "EGP" },
    "amountType": "SEND",
    "expiration": "2026-08-11T15:18:32.516Z",
    "payee": {
      "partyIdInfo": {
        "fspId": "test-egp-dfsp",
        "partyIdType": "MSISDN",
        "partyIdentifier": "tkn_deae1b8f945ef19923b29ccf79a7f8c3261df3db857a621acb538d7592eb2d0d"
      },
      "personalInfo": { "complexName": "tkn_117907d917c2dce47a3f9c7b8f69d124213ca429f90b189da036f0ea13b22a8a" }
    },
    "payer": {
      "name": "tkn_05f845ef2d08fe43e35d3b94d84faa3838c4a9ff6c615a5dd452f6b662a444af",
      "partyIdInfo": {
        "fspId": "test-zmw-dfsp",
        "partyIdType": "MSISDN",
        "partyIdentifier": "tkn_3780fabacf92b24f7caf059f87f727029d137fade7cff138cb4744751626e693"
      },
      "personalInfo": { "complexName": "tkn_46781e456787840410c5101577115570c1b9f62146d6e56aab002f973f1e690d" }
    },
    "quoteId": "01KZRPCY74VHKR5BQXKDDAQ3N8",
    "transactionId": "01KZRPCPGMYAD5YJKN33FWFRD2",
    "transactionType": { "initiator": "PAYER", "initiatorType": "BUSINESS", "scenario": "TRANSFER" }
  },
  "timestamp": "2026-09-28T06:35:32.071Z"
}
```

### QUOTE callback

```json
{
  "msgType": "callback",
  "eventType": "QUOTE",
  "id": "01KZRPCY74VHKR5BQXKDDAQ3N8",
  "correlationId": "b5969eb2-8b83-48e7-b4ee-38581781c52e",
  "fspiop-source": "test-egp-dfsp",
  "fspiop-destination": "test-zmw-dfsp",
  "body": {
    "condition": "IhjNYRAh7XexP985_w7aawSYsXi9VO_hL8dYxfmWdNo",
    "expiration": "2026-08-11T15:18:34.732Z",
    "ilpPacket": "DIID2wAAAAAAAAXcMjAyNjA4MTExNTE4MzQ3MzIiGM1hECHtd7E_3zn_DtprBJixeL1U7-Evx1jF-ZZ02gpnLm1vamFsb29wggOUZXlKeGRXOTBaVWxrSWpvaU1ERkxXbEpRUTFrM05GWklTMUkxUWxGWVMwUkVRVkV6VGpnaUxDSjBjbUZ1YzJGamRHbHZia2xrSWpvaU1ERkxXbEpRUTFCSFRWbEJSRFZaU2t0T016TkdWMFpTUkRJaUxDSjBjbUZ1YzJGamRHbHZibFI1Y0dVaU9uc2ljMk5sYm1GeWFXOGlPaUpVVWtGT1UwWkZVaUlzSW1sdWFYUnBZWFJ2Y2lJNklsQkJXVVZTSWl3aWFXNXBkR2xoZEc5eVZIbHdaU0k2SWtKVlUwbE9SVk5USW4wc0luQmhlV1ZsSWpwN0luQmhjblI1U1dSSmJtWnZJanA3SW5CaGNuUjVTV1JVZVhCbElqb2lUVk5KVTBST0lpd2ljR0Z5ZEhsSlpHVnVkR2xtYVdWeUlqb2lLekl3TVRBeE1qTTBOVFkzT0NJc0ltWnpjRWxrSWpvaWRHVnpkQzFsWjNBdFpHWnpjQ0o5TENKd1pYSnpiMjVoYkVsdVptOGlPbnNpWTI5dGNHeGxlRTVoYldVaU9uc2labWx5YzNST1lXMWxJam9pUTJocGEyOXVaR2tpTENKc1lYTjBUbUZ0WlNJNklrSmhibVJoSW4xOWZTd2ljR0Y1WlhJaU9uc2ljR0Z5ZEhsSlpFbHVabThpT25zaWNHRnlkSGxKWkZSNWNHVWlPaUpOVTBsVFJFNGlMQ0p3WVhKMGVVbGtaVzUwYVdacFpYSWlPaUlyTWpZd09UYzJNREF4TWpNMElpd2labk53U1dRaU9pSjBaWE4wTFhwdGR5MWtabk53SW4wc0ltNWhiV1VpT2lKRWFYTndiR0Y1TFZSbGMzUWlMQ0p3WlhKemIyNWhiRWx1Wm04aU9uc2lZMjl0Y0d4bGVFNWhiV1VpT25zaVptbHljM1JPWVcxbElqb2lSbWx5YzNSdVlXMWxMVlJsYzNRaUxDSnRhV1JrYkdWT1lXMWxJam9pVFdsa1pHeGxibUZ0WlMxVVpYTjBJaXdpYkdGemRFNWhiV1VpT2lKTVlYTjBibUZ0WlMxVVpYTjBJbjE5ZlN3aVpYaHdhWEpoZEdsdmJpSTZJakl3TWpZdE1EZ3RNVEZVTVRVNk1UZzZNelF1TnpNeVdpSXNJbUZ0YjNWdWRDSTZleUpoYlc5MWJuUWlPaUl4TlNJc0ltTjFjbkpsYm1ONUlqb2lSVWRRSW4xOQ",
    "payeeFspFee": { "amount": "0", "currency": "EGP" },
    "payeeReceiveAmount": { "amount": "15", "currency": "EGP" },
    "transferAmount": { "amount": "15", "currency": "EGP" }
  },
  "timestamp": "2026-09-28T06:35:32.078Z"
}
```

### FXTRANSFER request

```json
{
  "msgType": "request",
  "eventType": "FXTRANSFER",
  "id": "01KZRPCV2ATD1ZATJKSE2RV3QH",
  "correlationId": "e12ab57d-b035-4093-a948-170cd48deb38",
  "fspiop-source": "test-zmw-dfsp",
  "fspiop-destination": "test-fxp",
  "body": {
    "commitRequestId": "01KZRPCV2ATD1ZATJKSE2RV3QH",
    "condition": "HanuZGWbUc9WBpfUWskIkckWrk2AeS0wcdQ17TsmJfo",
    "counterPartyFsp": "test-fxp",
    "determiningTransferId": "01KZRPCPGMYAD5YJKN33FWFRD2",
    "expiration": "2026-08-11T15:18:38.459Z",
    "initiatingFsp": "test-zmw-dfsp",
    "sourceAmount": { "amount": "10", "currency": "ZMW" },
    "targetAmount": { "amount": "15", "currency": "EGP" }
  },
  "timestamp": "2026-09-28T06:35:32.088Z"
}
```

### FXTRANSFER callback

```json
{
  "msgType": "callback",
  "eventType": "FXTRANSFER",
  "id": "01KZRPCV2ATD1ZATJKSE2RV3QH",
  "correlationId": "6544449b-4933-47ac-823d-eae035ed2f9d",
  "fspiop-source": "test-fxp",
  "fspiop-destination": "test-zmw-dfsp",
  "body": {
    "GrpHdr": { "CreDtTm": "2026-08-11T15:17:43.269Z", "MsgId": "01KZRPD8Q586ZHGEJS61ZNY00F" },
    "TxInfAndSts": {
      "ExctnConf": "UuL_EDT6q6tXdECKlqEdkuATTSeAvNmJna4BLY94FOQ",
      "PrcgDt": { "DtTm": "2026-08-11T15:17:43.254Z" },
      "TxSts": "RESV"
    }
  },
  "timestamp": "2026-09-28T06:35:32.098Z"
}
```

### TRANSFER request

```json
{
  "msgType": "request",
  "eventType": "TRANSFER",
  "id": "01KZRPCPGMYAD5YJKN33FWFRD2",
  "correlationId": "3439c43b-0573-4025-b5d5-6baec211f859",
  "fspiop-source": "test-zmw-dfsp",
  "fspiop-destination": "test-egp-dfsp",
  "body": {
    "amount": { "amount": "15", "currency": "EGP" },
    "condition": "IhjNYRAh7XexP985_w7aawSYsXi9VO_hL8dYxfmWdNo",
    "expiration": "2026-08-11T15:18:49.235Z",
    "ilpPacket": "DIID2wAAAAAAAAXcMjAyNjA4MTExNTE4MzQ3MzIiGM1hECHtd7E_3zn_DtprBJixeL1U7-Evx1jF-ZZ02gpnLm1vamFsb29wggOUZXlKeGRXOTBaVWxrSWpvaU1ERkxXbEpRUTFrM05GWklTMUkxUWxGWVMwUkVRVkV6VGpnaUxDSjBjbUZ1YzJGamRHbHZia2xrSWpvaU1ERkxXbEpRUTFCSFRWbEJSRFZaU2t0T016TkdWMFpTUkRJaUxDSjBjbUZ1YzJGamRHbHZibFI1Y0dVaU9uc2ljMk5sYm1GeWFXOGlPaUpVVWtGT1UwWkZVaUlzSW1sdWFYUnBZWFJ2Y2lJNklsQkJXVVZTSWl3aWFXNXBkR2xoZEc5eVZIbHdaU0k2SWtKVlUwbE9SVk5USW4wc0luQmhlV1ZsSWpwN0luQmhjblI1U1dSSmJtWnZJanA3SW5CaGNuUjVTV1JVZVhCbElqb2lUVk5KVTBST0lpd2ljR0Z5ZEhsSlpHVnVkR2xtYVdWeUlqb2lLekl3TVRBeE1qTTBOVFkzT0NJc0ltWnpjRWxrSWpvaWRHVnpkQzFsWjNBdFpHWnpjQ0o5TENKd1pYSnpiMjVoYkVsdVptOGlPbnNpWTI5dGNHeGxlRTVoYldVaU9uc2labWx5YzNST1lXMWxJam9pUTJocGEyOXVaR2tpTENKc1lYTjBUbUZ0WlNJNklrSmhibVJoSW4xOWZTd2ljR0Y1WlhJaU9uc2ljR0Z5ZEhsSlpFbHVabThpT25zaWNHRnlkSGxKWkZSNWNHVWlPaUpOVTBsVFJFNGlMQ0p3WVhKMGVVbGtaVzUwYVdacFpYSWlPaUlyTWpZd09UYzJNREF4TWpNMElpd2labk53U1dRaU9pSjBaWE4wTFhwdGR5MWtabk53SW4wc0ltNWhiV1VpT2lKRWFYTndiR0Y1TFZSbGMzUWlMQ0p3WlhKemIyNWhiRWx1Wm04aU9uc2lZMjl0Y0d4bGVFNWhiV1VpT25zaVptbHljM1JPWVcxbElqb2lSbWx5YzNSdVlXMWxMVlJsYzNRaUxDSnRhV1JrYkdWT1lXMWxJam9pVFdsa1pHeGxibUZ0WlMxVVpYTjBJaXdpYkdGemRFNWhiV1VpT2lKTVlYTjBibUZ0WlMxVVpYTjBJbjE5ZlN3aVpYaHdhWEpoZEdsdmJpSTZJakl3TWpZdE1EZ3RNVEZVTVRVNk1UZzZNelF1TnpNeVdpSXNJbUZ0YjNWdWRDSTZleUpoYlc5MWJuUWlPaUl4TlNJc0ltTjFjbkpsYm1ONUlqb2lSVWRRSW4xOQ",
    "payeeFsp": "test-egp-dfsp",
    "payerFsp": "test-zmw-dfsp",
    "transferId": "01KZRPCPGMYAD5YJKN33FWFRD2"
  },
  "timestamp": "2026-09-28T06:35:32.106Z"
}
```

### TRANSFER callback

**Arrived before the request above** (out-of-order across partitions 7/10 — the documented real split):

```json
{
  "msgType": "callback",
  "eventType": "TRANSFER",
  "id": "01KZRPCPGMYAD5YJKN33FWFRD2",
  "correlationId": "3ad445ed-292c-472e-b191-bb196e644f29",
  "fspiop-source": "test-egp-dfsp",
  "fspiop-destination": "test-zmw-dfsp",
  "body": {
    "GrpHdr": { "CreDtTm": "2026-08-11T15:17:56.272Z", "MsgId": "01KZRPDNDG2M630Z9DGJ8QDKKY" },
    "TxInfAndSts": {
      "ExctnConf": "BukNSGTwyogv4m2a8ul3o6bDetyQm5m2_0ii4vgNDTo",
      "PrcgDt": { "DtTm": "2026-08-11T15:17:56.258Z" },
      "TxSts": "COMM"
    }
  },
  "timestamp": "2026-09-28T06:35:31.923Z"
}
```

**PPA outcome:** identical to Transactions 1–3. Nothing reached TMS.

---

## Transaction 5 — `05_ZMW_to_KES` (ZMW → KES via `test-fxp`)

Single partition (9). `transferId: 01KZW6Q4D9VZ028XH118MTX6HR`, `quoteId: 01KZW6QK08F4QYWXMH44A70AFY`. Note this transaction's QUOTE request carries no `payer.name` and no `payee.personalInfo` — a real, naturally-occurring variant, not an injected fault.

### FXQUOTE request

```json
{
  "msgType": "request",
  "eventType": "FXQUOTE",
  "id": "01KZW6QAF2YYYT7CBREGFX8PYB",
  "correlationId": "085a291b-0dc9-45b8-8534-14527767953e",
  "fspiop-source": "test-zmw-dfsp",
  "fspiop-destination": "test-fxp",
  "body": {
    "conversionRequestId": "01KZW6QAF2YYYT7CBREGFX8PYB",
    "conversionTerms": {
      "amountType": "SEND",
      "conversionId": "01KZW6QAF2YYYT7CBREGFX8PYC",
      "counterPartyFsp": "test-fxp",
      "determiningTransferId": "01KZW6Q4D9VZ028XH118MTX6HR",
      "expiration": "2026-08-13T00:01:33.250Z",
      "initiatingFsp": "test-zmw-dfsp",
      "sourceAmount": { "amount": "90", "currency": "ZMW" },
      "targetAmount": { "amount": "0", "currency": "KES" }
    }
  },
  "timestamp": "2026-09-28T06:35:33.330Z"
}
```

### FXQUOTE callback

```json
{
  "msgType": "callback",
  "eventType": "FXQUOTE",
  "id": "01KZW6QAF2YYYT7CBREGFX8PYB",
  "correlationId": "05764f25-9ead-4e07-a6ff-5508e7be10dd",
  "fspiop-source": "test-fxp",
  "fspiop-destination": "test-zmw-dfsp",
  "body": {
    "condition": "6km7L-moLe97ly73YVo5rNsuXiRe0qXsiEAQfv1SbeU",
    "conversionTerms": {
      "amountType": "SEND",
      "conversionId": "01KZW6QAF2YYYT7CBREGFX8PYC",
      "counterPartyFsp": "test-fxp",
      "determiningTransferId": "01KZW6Q4D9VZ028XH118MTX6HR",
      "expiration": "2026-08-13T00:01:33.250Z",
      "initiatingFsp": "test-zmw-dfsp",
      "sourceAmount": { "amount": "90", "currency": "ZMW" },
      "targetAmount": { "amount": "575", "currency": "KES" }
    }
  },
  "timestamp": "2026-09-28T06:35:33.338Z"
}
```

### QUOTE request

```json
{
  "msgType": "request",
  "eventType": "QUOTE",
  "id": "01KZW6QK08F4QYWXMH44A70AFY",
  "correlationId": "ede521c1-8f95-45f5-b4c3-e28ec7ca74b2",
  "fspiop-source": "test-zmw-dfsp",
  "fspiop-destination": "test-kes-dfsp",
  "body": {
    "amount": { "amount": "575", "currency": "KES" },
    "amountType": "SEND",
    "expiration": "2026-08-13T00:01:41.992Z",
    "payee": {
      "partyIdInfo": {
        "fspId": "test-kes-dfsp",
        "partyIdType": "MSISDN",
        "partyIdentifier": "tkn_00335978f3612925739846217d882fc34a5352d9150d95eb2d5bf1c0e9c24ea0"
      },
      "personalInfo": { "complexName": "tkn_117907d917c2dce47a3f9c7b8f69d124213ca429f90b189da036f0ea13b22a8a" }
    },
    "payer": {
      "partyIdInfo": {
        "fspId": "test-zmw-dfsp",
        "partyIdType": "MSISDN",
        "partyIdentifier": "tkn_e808efcb5690f7bc6acf3629334c840ac6bc5b77f1fa28dc74fa1c46ca325aa7"
      }
    },
    "quoteId": "01KZW6QK08F4QYWXMH44A70AFY",
    "transactionId": "01KZW6Q4D9VZ028XH118MTX6HR",
    "transactionType": { "initiator": "PAYER", "initiatorType": "BUSINESS", "scenario": "TRANSFER" }
  },
  "timestamp": "2026-09-28T06:35:33.348Z"
}
```

### QUOTE callback

```json
{
  "msgType": "callback",
  "eventType": "QUOTE",
  "id": "01KZW6QK08F4QYWXMH44A70AFY",
  "correlationId": "095b3843-713f-49f0-ae6e-251ba8bf809b",
  "fspiop-source": "test-kes-dfsp",
  "fspiop-destination": "test-zmw-dfsp",
  "body": {
    "condition": "NRO2t0c-h76fkE8D6jNKx4itPBGdgNPxE-gDb-Kj4E8",
    "expiration": "2026-08-13T00:01:52.090Z",
    "ilpPacket": "DIIDEwAAAAAAAOCcMjAyNjA4MTMwMDAxNTIwOTA1E7a3Rz6Hvp-QTwPqM0rHiK08EZ2A0_ET6ANv4qPgTwpnLm1vamFsb29wggLMZXlKeGRXOTBaVWxrSWpvaU1ERkxXbGMyVVVzd09FWTBVVmxYV0UxSU5EUkJOekJCUmxraUxDSjBjbUZ1YzJGamRHbHZia2xrSWpvaU1ERkxXbGMyVVRSRU9WWmFNREk0V0VneE1UaE5WRmcyU0ZJaUxDSjBjbUZ1YzJGamRHbHZibFI1Y0dVaU9uc2ljMk5sYm1GeWFXOGlPaUpVVWtGT1UwWkZVaUlzSW1sdWFYUnBZWFJ2Y2lJNklsQkJXVVZTSWl3aWFXNXBkR2xoZEc5eVZIbHdaU0k2SWtKVlUwbE9SVk5USW4wc0luQmhlV1ZsSWpwN0luQmhjblI1U1dSSmJtWnZJanA3SW5CaGNuUjVTV1JVZVhCbElqb2lUVk5KVTBST0lpd2ljR0Z5ZEhsSlpHVnVkR2xtYVdWeUlqb2lNalUwTnpFd01ERWlMQ0ptYzNCSlpDSTZJblJsYzNRdGEyVnpMV1JtYzNBaWZTd2ljR1Z5YzI5dVlXeEpibVp2SWpwN0ltTnZiWEJzWlhoT1lXMWxJanA3SW1acGNuTjBUbUZ0WlNJNklrTm9hV3R2Ym1ScElpd2liR0Z6ZEU1aGJXVWlPaUpDWVc1a1lTSjlmWDBzSW5CaGVXVnlJanA3SW5CaGNuUjVTV1JKYm1adklqcDdJbkJoY25SNVNXUlVlWEJsSWpvaVRWTkpVMFJPSWl3aWNHRnlkSGxKWkdWdWRHbG1hV1Z5SWpvaU1qWXdPVEF4TURBeUlpd2labk53U1dRaU9pSjBaWE4wTFhwdGR5MWtabk53SW4xOUxDSmxlSEJwY21GMGFXOXVJam9pTWpBeU5pMHdPQzB4TTFRd01Eb3dNVG8xTWk0d09UQmFJaXdpWVcxdmRXNTBJanA3SW1GdGIzVnVkQ0k2SWpVM05TSXNJbU4xY25KbGJtTjVJam9pUzBWVEluMTk",
    "payeeFspFee": { "amount": "0", "currency": "KES" },
    "payeeReceiveAmount": { "amount": "575", "currency": "KES" },
    "transferAmount": { "amount": "575", "currency": "KES" }
  },
  "timestamp": "2026-09-28T06:35:33.356Z"
}
```

### FXTRANSFER request

```json
{
  "msgType": "request",
  "eventType": "FXTRANSFER",
  "id": "01KZW6QAF2YYYT7CBREGFX8PYC",
  "correlationId": "3758f135-3dd7-47a9-9575-6503608b5209",
  "fspiop-source": "test-zmw-dfsp",
  "fspiop-destination": "test-fxp",
  "body": {
    "commitRequestId": "01KZW6QAF2YYYT7CBREGFX8PYC",
    "condition": "6km7L-moLe97ly73YVo5rNsuXiRe0qXsiEAQfv1SbeU",
    "counterPartyFsp": "test-fxp",
    "determiningTransferId": "01KZW6Q4D9VZ028XH118MTX6HR",
    "expiration": "2026-08-13T00:01:58.023Z",
    "initiatingFsp": "test-zmw-dfsp",
    "sourceAmount": { "amount": "90", "currency": "ZMW" },
    "targetAmount": { "amount": "575", "currency": "KES" }
  },
  "timestamp": "2026-09-28T06:35:33.363Z"
}
```

### FXTRANSFER callback

```json
{
  "msgType": "callback",
  "eventType": "FXTRANSFER",
  "id": "01KZW6QAF2YYYT7CBREGFX8PYC",
  "correlationId": "2933012f-13b5-4536-b119-f227a8e08357",
  "fspiop-source": "test-fxp",
  "fspiop-destination": "test-zmw-dfsp",
  "body": {
    "GrpHdr": { "CreDtTm": "2026-08-13T00:01:11.588Z", "MsgId": "01KZW6RFX4J4W2SFR5WQ9BQJ9A" },
    "TxInfAndSts": {
      "ExctnConf": "YbnYCuZh2YvfIISqDnSMbVNphjBzt-iefnB2t53OPP0",
      "PrcgDt": { "DtTm": "2026-08-13T00:01:11.578Z" },
      "TxSts": "RESV"
    }
  },
  "timestamp": "2026-09-28T06:35:33.368Z"
}
```

### TRANSFER request

```json
{
  "msgType": "request",
  "eventType": "TRANSFER",
  "id": "01KZW6Q4D9VZ028XH118MTX6HR",
  "correlationId": "c44ad4a7-85c0-4f73-ae0e-0c822f8d7c7e",
  "fspiop-source": "test-zmw-dfsp",
  "fspiop-destination": "test-kes-dfsp",
  "body": {
    "amount": { "amount": "575", "currency": "KES" },
    "condition": "NRO2t0c-h76fkE8D6jNKx4itPBGdgNPxE-gDb-Kj4E8",
    "expiration": "2026-08-13T00:02:20.463Z",
    "ilpPacket": "DIIDEwAAAAAAAOCcMjAyNjA4MTMwMDAxNTIwOTA1E7a3Rz6Hvp-QTwPqM0rHiK08EZ2A0_ET6ANv4qPgTwpnLm1vamFsb29wggLMZXlKeGRXOTBaVWxrSWpvaU1ERkxXbGMyVVVzd09FWTBVVmxYV0UxSU5EUkJOekJCUmxraUxDSjBjbUZ1YzJGamRHbHZia2xrSWpvaU1ERkxXbGMyVVRSRU9WWmFNREk0V0VneE1UaE5WRmcyU0ZJaUxDSjBjbUZ1YzJGamRHbHZibFI1Y0dVaU9uc2ljMk5sYm1GeWFXOGlPaUpVVWtGT1UwWkZVaUlzSW1sdWFYUnBZWFJ2Y2lJNklsQkJXVVZTSWl3aWFXNXBkR2xoZEc5eVZIbHdaU0k2SWtKVlUwbE9SVk5USW4wc0luQmhlV1ZsSWpwN0luQmhjblI1U1dSSmJtWnZJanA3SW5CaGNuUjVTV1JVZVhCbElqb2lUVk5KVTBST0lpd2ljR0Z5ZEhsSlpHVnVkR2xtYVdWeUlqb2lNalUwTnpFd01ERWlMQ0ptYzNCSlpDSTZJblJsYzNRdGEyVnpMV1JtYzNBaWZTd2ljR1Z5YzI5dVlXeEpibVp2SWpwN0ltTnZiWEJzWlhoT1lXMWxJanA3SW1acGNuTjBUbUZ0WlNJNklrTm9hV3R2Ym1ScElpd2liR0Z6ZEU1aGJXVWlPaUpDWVc1a1lTSjlmWDBzSW5CaGVXVnlJanA3SW5CaGNuUjVTV1JKYm1adklqcDdJbkJoY25SNVNXUlVlWEJsSWpvaVRWTkpVMFJPSWl3aWNHRnlkSGxKWkdWdWRHbG1hV1Z5SWpvaU1qWXdPVEF4TURBeUlpd2labk53U1dRaU9pSjBaWE4wTFhwdGR5MWtabk53SW4xOUxDSmxlSEJwY21GMGFXOXVJam9pTWpBeU5pMHdPQzB4TTFRd01Eb3dNVG8xTWk0d09UQmFJaXdpWVcxdmRXNTBJanA3SW1GdGIzVnVkQ0k2SWpVM05TSXNJbU4xY25KbGJtTjVJam9pUzBWVEluMTk",
    "payeeFsp": "test-kes-dfsp",
    "payerFsp": "test-zmw-dfsp",
    "transferId": "01KZW6Q4D9VZ028XH118MTX6HR"
  },
  "timestamp": "2026-09-28T06:35:33.372Z"
}
```

### TRANSFER callback

```json
{
  "msgType": "callback",
  "eventType": "TRANSFER",
  "id": "01KZW6Q4D9VZ028XH118MTX6HR",
  "correlationId": "3b600de5-bf38-465a-8ce9-25d1179c1253",
  "fspiop-source": "test-kes-dfsp",
  "fspiop-destination": "test-zmw-dfsp",
  "body": {
    "GrpHdr": { "CreDtTm": "2026-08-13T00:01:37.378Z", "MsgId": "01KZW6S932FPE0922YWB73AKTF" },
    "TxInfAndSts": {
      "ExctnConf": "SoYVdj7xJTAkUjRsWycjyEd2bcNKyT8xMuF83d61ZUw",
      "PrcgDt": { "DtTm": "2026-08-13T00:01:37.363Z" },
      "TxSts": "COMM"
    }
  },
  "timestamp": "2026-09-28T06:35:33.379Z"
}
```

**PPA outcome:** identical to Transactions 1–4. Nothing reached TMS.

---

## Summary for the PPA side

Every envelope above is exactly what MLA sends — no reshaping, no fields added or removed. All 20 (5 transactions × 4 event types × request/callback) were accepted and processed by PPA. The point of failure is entirely inside PPA's own translation → local-schema-validation step, before PPA ever attempts to call TMS:

- `resolvePurposeCode` (`translation-helpers.ts`) has only one confirmed `{scenario, initiatorType} → Purp.Cd` mapping: `TRANSFER`/`CONSUMER` → `MP2P`. None of these five real transactions match it (`transactionType.initiatorType` is `BUSINESS`, not `CONSUMER`, throughout the fixture set), so `Purp` is omitted every time — and PPA's own pinned Tazama schema requires it on both pain.001 and pain.013.
- `pacs.008` additionally needs `RmtInf`, `GrpHdr.SttlmInf` and `ChrgBr`, none of which any of these five envelopes' bodies carry a source for today.
- Because pacs.008 never sends, `handlePacs002` has no resolvable identity to build the terminal pacs.002 against, so it dead-letters too (by design — R-04 forbids synthesizing one).

This reproduced identically across two independent feeds of all five fixtures (40 envelopes each), so it is not corridor-specific, not a partition-ordering artifact, and not a one-off.

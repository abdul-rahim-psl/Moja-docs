# Sam Kummary email — rejection/timeout sample data (2026-09-16)

Follow-up to `docs/meetings/9-sept.md` §Q3 (`plan.md` §14 Q3): Sam Kummary (Technical Director, Mojaloop Foundation) committed to supplying two simulated examples — a payee-DFSP rejection and a switch-generated timeout failure — since neither exists in the original captures.

## The email, verbatim

> Hi,
>
> Here's a result file for an inter-scheme + iso 20022 test run that I just did on one of the test environments I have access to: https://mojaloop-oss-qa-results.s3.us-west-2.amazonaws.com/ttk-tests/reports/TTK-Assertion-Report-gp_tests-2026-09-15T19%3A01%3A46.968Z.html
>
> You can go to the details option at the top and then navigate to various tests and also get the various payloads that you need (you may ignore the failures for now, those are unrelated to the current exercise).
>
> For example, here's a callback body for an FX transfer (fulfil side) failure:
>
>     {
>       "GrpHdr": {
>         "MsgId": "01M2K6SNWTQK046VC0T3GMMDGP",
>         "CreDtTm": "2026-09-15T18:55:46.074Z"
>       },
>       "TxInfAndSts": {
>         "PrcgDt": {
>           "DtTm": "2026-09-15T18:55:45.000Z"
>         },
>         "TxSts": "ABOR"
>       }
>     }
>
> Thank you,
> Sam
>
> Sam Kummary | Technical Director | Mojaloop Foundation

## What the linked report actually contains

The report is a TTK (Testing Toolkit) assertion report covering a large, general test run (`gp_tests`), most of it unrelated to this exercise as Sam noted. Three findings from reading it directly, not from the one pasted excerpt:

### 1. The pasted callback is a plain transfer rejection, not an FX transfer

The pasted body belongs to test case `payee-abort-v1_1` — labelled in the report as `p2p_money_transfer_patch_notifications: payee receives PATCH Notification with ABORTED status after sending invalid fulfilment`. No `fxQuote`/`fxTransfer` step appears anywhere in that test's chain; Sam's characterization of it as an "FX transfer (fulfil side) failure" does not match the report's own contents.

**This is the payee-DFSP-rejection sample** Q3 asked for. Mechanism observed:

- Payee DFSP sends `PUT /transfers/{transferId}/error`:
  ```json
  {
    "errorInformation": {
      "errorCode": "5101",
      "errorDescription": "Payee transaction limit reached",
      "extensionList": { "extension": [{ "key": "errorDetail", "value": "This is an abort extension" }] }
    }
  }
  ```
- The hub relays this to the original sender as (test step `payee-abort-v1_1-Check-trans-status-ABORTED`, `fspiop-source: Hub`, genuinely JWS-signed):
  ```json
  {
    "GrpHdr": { "MsgId": "01M2K6SNWTQK046VC0T3GMMDGP", "CreDtTm": "2026-09-15T18:55:46.074Z" },
    "TxInfAndSts": { "PrcgDt": { "DtTm": "2026-09-15T18:55:45.000Z" }, "TxSts": "ABOR" }
  }
  ```

This is the exact body Sam pasted — it is the `commitTransfer`-shaped envelope (`GrpHdr`/`TxInfAndSts.TxSts`), **not** the `StsRsnInf`-only rejection shape `cross-reference.md` §F11 describes. `TxSts: "ABOR"` is a third wire value alongside `COMM`/`RESV`, confirmed by scanning the full report: every `TxSts` occurrence in the entire file (86 occurrences of the `TxInfAndSts` object) resolves to one of exactly three values — `COMM`, `RESV`, `ABOR` — and `RJCT` never appears as a raw wire value anywhere, consistent with F11's finding that `RJCT` is derived structurally, never read off the wire.

### 2. A genuine switch-timeout sample is also present, separately from the one Sam pasted

Test case `payer-transfer-timeout`: the switch waits ~14.1s for the payee's fulfil, then times out and generates its own error. Relayed to both payer and payee as:
```json
{
  "GrpHdr": { "MsgId": "01M2K6T3PBQ92Y78QHWZZZGTM5", "CreDtTm": "2026-09-15T18:56:00.203Z" },
  "TxInfAndSts": {
    "StsRsnInf": { "Rsn": { "Prtry": "3303" }, "AddtlInf": "Transfer expired" }
  }
}
```
Transformed (FSPIOP) form delivered to the DFSP: `{ "errorInformation": { "errorCode": "3303", "errorDescription": "Transfer expired" } }`.

This matches the `StsRsnInf`-only shape (§F11) exactly — `StsRsnInf.{Rsn.Prtry, AddtlInf}` present, no `TxSts` field. First real, non-fixture evidence for a shape previously assumed from the FSD/POC only.

### 3. No FX-side rejection or timeout sample exists in this report

Checked every FX-labelled folder present (`e2e-fxp-aborted-state-1..4`, `e2e-fxp-timeout-1..4`, `fx-transfer-err-*`, `pos-fxtransfer-fail-*`): the `e2e-fxp-*` cases run through an SDK abstraction (`moja-e2e-sim1-sdk`) and only ever expose `currentState` values like `WAITING_FOR_PARTY_ACCEPTANCE` — never the raw `GrpHdr`/`TxInfAndSts` audit-topic shape. The others (`fx-transfer-err-POST-fxTransfers`, `pos-fxtransfer-fail-POST-fxTransfers-that-receives`) return `202 Accepted` with no failure callback body visible in the report. Every one of the 11 `ABOR` occurrences in the report traces back to a plain-transfer test case (`payee-abort-v1_1`, `payee-invalid-fulfill`, `payee-invalid-ts`, `positive`, `negative`, `fundsout-rsrv-abort`, `p2p-patch-aborted`, `p2p-put`, `p2p-patch`) — none FX.

## Net status

| Ask (from `plan.md` §14 Q3) | Status |
| --- | --- |
| Payee-DFSP rejection sample | **Received** — `payee-abort-v1_1`, above. Surfaces a real gap: `TxSts: "ABOR"` is unhandled by the current `TxSts` translation table (`cross-reference.md` §F10 only covers `COMM`→`ACSC`, `RESV`→`ACSP`) and by `isTransferRejection`'s shape-check (keys off `StsRsnInf`, which this record does not carry). |
| Switch-generated timeout sample | **Received** — `payer-transfer-timeout`, above. Matches the already-assumed §F11 shape exactly; no code gap. |
| Rejected FX transfer sample | **Still open** — not present in this report despite the cover email's framing. |

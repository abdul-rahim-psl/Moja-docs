# pain.013.001.09 — field-by-field mapping

**Trigger:** `PUT /quotes` (msg 11), enriched from cached `POST /quotes` (msg 10), `PUT /parties` (msg 03) and `PUT /fxQuotes` (msgs 06/07).
Contract: `tms-service/src/schemas/pain.013.json` (ajv). Endpoint: `POST /v1/evaluate/iso20022/pain.013.001.09` — **registered only when `QUOTING=true`**.
Validated output: [`samples/tazama_pain013.json`](samples/tazama_pain013.json) — **passes, nothing stripped**.

Legend as in [`01_pain001_mapping.md`](01_pain001_mapping.md).

---

## Structural differences from pain.001

Both messages carry the same party and account blocks. The differences that matter:

| | pain.001 | pain.013 |
|---|---|---|
| Root | `CstmrCdtTrfInitn` | `CdtrPmtActvtnReq` |
| `PmtInf.XpryDt` | absent | **required** (`DtTm`) |
| `ReqdExctnDt` | `Dt` **and** `DtTm` required | only `DtTm` required |
| `CdtTrfTxInf.RmtInf` | required | **not present** |
| `Amt.EqvtAmt.XchgRateInf` | present | **absent** — a rate sent here is silently stripped |
| `CdtTrfTxInf.SplmtryData…Doc` | `Dbtr`/`Cdtr` name parts, `DbtrFinSvcsPrvdrFees`, `Xprtn` | `PyeeRcvAmt`, `PyeeFinSvcsPrvdrFee`, `PyeeFinSvcsPrvdrComssn` |
| Root `SplmtryData…InitgPty` | `InitrTp` **and** `Glctn` | only `Glctn` |

## Root and `GrpHdr`

| Tazama field | Req | Source msg | Locator | Prov. | Rule | Golden-path value |
|---|---|---|---|---|---|---|
| `TxTp` | — | — | — | Created | Constant | `"pain.013.001.09"` |
| `TenantId` | **forbidden** | — | — | — | Must NOT be sent | *(absent)* |
| `GrpHdr.MsgId` | ✔ | 11 | `ext[GrpHdr.MsgId]` | Copied | Scheme-supplied; generate only if absent | `"01K7EV9XM2F00J5V4PZQTKFE38"` |
| `GrpHdr.CreDtTm` | ✔ | 11 | `ext[GrpHdr.CreDtTm]` | Copied | | `"2025-10-13T13:14:08.386Z"` |
| `GrpHdr.NbOfTxs` | ✔ | 11 | `ext[GrpHdr.NbOfTxs]` | Calculated | Parse `"1"` → `1` | `1` |
| `GrpHdr.InitgPty.*` | ✔ | cache (10) | — | Inferred | Full party block, mirroring `Dbtr` | *(= Dbtr)* |

> Unlike pain.001, the quote callback **does** supply `GrpHdr.MsgId` and `CreDtTm` in its `extensionList`, so both are copied rather than generated.

## `CdtrPmtActvtnReq.PmtInf`

| Tazama field | Req | Source msg | Locator | Prov. | Rule | Golden-path value |
|---|---|---|---|---|---|---|
| `PmtInfId` | ✔ | cache (10) | `body.quoteId` | Copied | The `quoteId` — same value as on the pain.001 | `01K7EV9X2K4F8J90ZWMRHDNCZN` |
| `PmtMtd` | ✔ | — | — | Defaulted | | `"TRA"` |
| `ReqdAdvcTp.DbtAdvc.Cd` / `.Prtry` | ✔ | — | — | Defaulted | | `"ADWD"` / `"Advice with transaction details"` |
| `ReqdExctnDt.DtTm` | ✔ | 11 | `ext[GrpHdr.CreDtTm]` | Copied | Only `DtTm` is required here | `"2025-10-13T13:14:08.386Z"` |
| **`XpryDt.DtTm`** | ✔ | 11 | `body.expiration` | Copied | ⚠️ **Required on pain.013 only** — the quote's validity deadline | `"2025-10-13T13:15:08.384Z"` |
| `Dbtr.*`, `DbtrAcct.*`, `DbtrAgt.*` | ✔ | cache (10) | — | Copied | Identical to the pain.001 blocks | *(as pain.001)* |

## `CdtrPmtActvtnReq.PmtInf.CdtTrfTxInf`

| Tazama field | Req | Source msg | Locator | Prov. | Rule | Golden-path value |
|---|---|---|---|---|---|---|
| `PmtId.EndToEndId` | ✔ | cache (10) | `body.transactionId` | Copied | No `InstrId` element exists | `01K7EV9TNQ1VKX84N0GSQH6MDD` |
| `PmtTpInf.CtgyPurp.Prtry` | ✔ | cache (10) | `body.transactionType` | Calculated | | `"TRANSFER CONSUMER"` |
| `Amt.InstdAmt.Amt.Amt/.Ccy` | ✔ | 07 | `conversionTerms.sourceAmount` | Calculated | Source amount, consistent with pain.001 and pacs.008 | `60` / `"MWK"` |
| `Amt.EqvtAmt.Amt.Amt/.Ccy` | ✔ | 07 | `conversionTerms.targetAmount` | Calculated | | `1` / `"ZMW"` |
| `Amt.EqvtAmt.CcyOfTrf` | ✔ | 07 | | Copied | | `"ZMW"` |
| `Amt.EqvtAmt.XchgRateInf` | — | — | — | — | ⚠️ **Element does not exist** — the rate is carried on pain.001 and pacs.008 only | *(omitted)* |
| **`ChrgBr`** | ✔ | 11 | `ext[CdtTrfTxInf.ChrgBr]` | Copied | ⚠️ **Available here**, unlike on pain.001 | `"CRED"` |
| `CdtrAgt…MmbId` | ✔ | 11 | `ext[…CdtrAgt.FinInstnId.Othr.Id]` | Copied | Path reshaped to `ClrSysMmbId.MmbId` | `"test-zmw-dfsp"` |
| `Cdtr.*`, `CdtrAcct.*` | ✔ | 03 / cache (10) | — | Copied | Payee name from `PUT /parties`; identifiers from the quote | `"Chikondi Banda"` / `"16665551001"` |
| `Purp.Cd` | ✔ | cache (10) | `body.transactionType` | Calculated | | `"MP2P"` |
| `RgltryRptg.Dtls.Tp` / `.Cd` | ✔ | — | — | Defaulted | | `"BALANCE OF PAYMENTS"` / `"100"` |

## `CdtTrfTxInf.SplmtryData.Envlp.Doc` — the payee-side amounts

All three are required, and all three map directly from the quote callback.

| Tazama field | Req | Source msg | Locator | Prov. | Golden-path value |
|---|---|---|---|---|---|
| `PyeeRcvAmt.Amt.Amt/.Ccy` | ✔ | 11 | `body.payeeReceiveAmount` | Calculated | `1` / `"ZMW"` |
| `PyeeFinSvcsPrvdrFee.Amt.Amt/.Ccy` | ✔ | 11 | `body.payeeFspFee` | Calculated | `0` / `"ZMW"` |
| `PyeeFinSvcsPrvdrComssn.Amt.Amt/.Ccy` | ✔ | 11 | `body.payeeFspCommission` | Calculated | `0` / `"ZMW"` — absent in this flow, defaulted to zero |

> This block is the reason the quote callback is worth mapping at all: `payeeReceiveAmount`, `payeeFspFee` and `payeeFspCommission` have no home anywhere in the pacs.008, so without pain.013 the payee-side economics of the transaction never reach Tazama.

## Root `SplmtryData.Envlp.Doc.InitgPty`

| Tazama field | Req | Source | Prov. | Golden-path value |
|---|---|---|---|---|
| `Glctn.Lat` / `.Long` | ✔ | — | Defaulted | `"0"` / `"0"` |

> `InitrTp` is **not** required here, unlike on pain.001.

## Direction note

`handlePain013` sets `source: creditorAcctId` and `destination: debtorAcctId` — the reverse of pain.001 and pacs.008. This reflects the **message** direction (pain.013 is a *CreditorPaymentActivationRequest*, and Mojaloop's `PUT /quotes` flows payee → payer), not the money direction.

**Do not swap `Dbtr` and `Cdtr` to compensate.** Tazama derives source and destination itself from the account blocks; swapping them would double-invert the resulting graph edge. `Dbtr` stays the payer and `Cdtr` stays the payee, exactly as on pain.001.

## Verification

```
tazama_pain013.json  vs  src/schemas/pain.013.json   VALID: true
  STRIPPED by removeAdditional: (nothing)
```

| Negative control | Result |
|---|---|
| Without `PmtInf.XpryDt` | **FAIL** — required |
| Without `SplmtryData…PyeeRcvAmt` | **FAIL** — required |
| With `Amt.EqvtAmt.XchgRateInf` | **PASS, silently stripped** — confirms the element does not exist |

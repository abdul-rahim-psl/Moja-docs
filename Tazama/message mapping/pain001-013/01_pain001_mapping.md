# pain.001.001.11 — field-by-field mapping

**Trigger:** `POST /quotes` (msg 10), enriched from cached `PUT /fxQuotes` (msgs 06/07).
Contract: `tms-service/src/schemas/pain.001.json` (ajv). Endpoint: `POST /v1/evaluate/iso20022/pain.001.001.11` — **registered only when `QUOTING=true`**.
Validated output: [`samples/tazama_pain001.json`](samples/tazama_pain001.json) — **passes, nothing stripped**.

> **Precedence.** Where this mapping and `CCH_FSD_MessageIngestion.md` V4.0 (Final) differ, **the FSD is the authority**. This document is built from the DRPP-GP-01 golden path, which is an FSPIOP *wire* capture — it shows what flowed between DFSPs over HTTPS, not what lands on the Kafka topics the MLA actually subscribes to. Two consequences are reflected below: `PUT /parties` (msg 03) is not a source for this pipeline, and `GrpHdr.MsgId` is PPA-generated regardless of what the wire supplies.

**Legend** — *Provenance*: `Copied` · `Calculated` · `Inferred` · `Created` · `Defaulted`. *Locator*: `body` · `hdr` · `ext[key]` · `—` (no source).

---

## Root

| Tazama field | Type | Req | Source msg | Locator | Prov. | Rule | Golden-path value |
|---|---|---|---|---|---|---|---|
| `TxTp` | string | — | — | — | Created | Constant; schema default fills it if omitted | `"pain.001.001.11"` |
| `TenantId` | — | **forbidden** | — | — | — | ⚠️ **Must NOT be sent** — TMS injects it from the JWT | *(absent)* |

## `CstmrCdtTrfInitn.GrpHdr`

| Tazama field | Type | Req | Source msg | Locator | Prov. | Rule | Golden-path value |
|---|---|---|---|---|---|---|---|
| `MsgId` | string | ✔ | — | — | Created | New ULID. `POST /quotes` supplies no `GrpHdr.MsgId` | `01K7EV9X8QW2M4T6Y8B1D3F5H7` |
| `CreDtTm` | string | ✔ | — | — | Created | PPA construction timestamp | `2025-10-13T13:14:07.900Z` |
| `NbOfTxs` | number | ✔ | — | — | Calculated | Always 1 | `1` |
| `InitgPty.*` | | ✔ | 10 | `body.payer` | Inferred | **Mirror of `PmtInf.Dbtr`** while `transactionType.initiator = PAYER` | *(= Dbtr)* |

> `GrpHdr.InitgPty` is required and carries the **full** party block (`Nm`, `Id.PrvtId.DtAndPlcOfBirth`, `Othr`, `CtctDtls`) — not just a name.

## `CstmrCdtTrfInitn.PmtInf`

| Tazama field | Type | Req | Source msg | Locator | Prov. | Rule | Golden-path value |
|---|---|---|---|---|---|---|---|
| `PmtInfId` | string | ✔ | 10 | `body.quoteId` | Copied | ⚠️ **The `quoteId` lives here**, not in `PmtId` | `01K7EV9X2K4F8J90ZWMRHDNCZN` |
| `PmtMtd` | string | ✔ | — | — | Defaulted | Tazama convention | `"TRA"` |
| `ReqdAdvcTp.DbtAdvc.Cd` | string | ✔ | — | — | Defaulted | Tazama convention | `"ADWD"` |
| `ReqdAdvcTp.DbtAdvc.Prtry` | string | ✔ | — | — | Defaulted | Tazama convention | `"Advice with transaction details"` |
| `ReqdExctnDt.Dt` | string | ✔ | 10 | `body.expiration` | Calculated | Date part of the quote expiry | `"2025-10-13"` |
| `ReqdExctnDt.DtTm` | string | ✔ | 10 | `body.expiration` | Copied | | `"2025-10-13T13:14:07.827Z"` |
| `Dbtr.Nm` | string | ✔ | 10 | `body.payer.personalInfo.complexName` | Calculated | Join `firstName middleName lastName` | `"Firstname-Test Middlename-Test Lastname-Test"` |
| `Dbtr…BirthDt` | string | ✔ | 10 | `body.payer.personalInfo.dateOfBirth` | Copied | | `"1984-01-01"` |
| `Dbtr…CityOfBirth` / `CtryOfBirth` | string | ✔ | — | — | Defaulted | | `"Unknown"` / `"ZZ"` |
| `Dbtr…PrvtId.Othr[0].Id` | string | ✔ | 10 | `body.payer.partyIdInfo.partyIdentifier` | Copied | ⚠️ **Array** | `"16665551002"` |
| `Dbtr…Othr[0].SchmeNm.Prtry` | string | ✔ | 10 | `body.payer.partyIdInfo.partyIdType` | Copied | | `"MSISDN"` |
| `Dbtr.CtctDtls.MobNb` | string | ✔ | 10 | `body.payer.partyIdInfo.partyIdentifier` | Inferred | Raw MSISDN — no country-code inference | `"16665551002"` |
| `DbtrAcct.Id.Othr[0].*` | | ✔ | 10 | `body.payer.partyIdInfo` | Inferred | MSISDN as account id | `"16665551002"` / `"MSISDN"` |
| `DbtrAcct.Nm` | string | ✔ | 10 | `body.payer.name` | Copied | **Display** name here | `"Display-Test"` |
| `DbtrAgt…ClrSysMmbId.MmbId` | string | ✔ | 10 | `body.payer.partyIdInfo.fspId` | Copied | | `"test-mwk-dfsp"` |

## `CstmrCdtTrfInitn.PmtInf.CdtTrfTxInf`

| Tazama field | Type | Req | Source msg | Locator | Prov. | Rule | Golden-path value |
|---|---|---|---|---|---|---|---|
| `PmtId.EndToEndId` | string | ✔ | 10 | `body.transactionId` | Copied | ⚠️ `PmtId` has **no `InstrId`** — an `InstrId` sent here is silently stripped | `01K7EV9TNQ1VKX84N0GSQH6MDD` |
| `PmtTpInf.CtgyPurp.Prtry` | string | ✔ | 10 | `body.transactionType` | Calculated | `scenario` + `initiatorType` | `"TRANSFER CONSUMER"` |
| `Amt.InstdAmt.Amt.Amt/.Ccy` | num/str | ✔ | 07 | `body.conversionTerms.sourceAmount` | Calculated | **Source amount** — matches the pacs.008 `InstdAmt` so the chain is consistent | `60` / `"MWK"` |
| `Amt.EqvtAmt.Amt.Amt/.Ccy` | num/str | ✔ | 07 | `body.conversionTerms.targetAmount` | Calculated | Converted amount | `1` / `"ZMW"` |
| `Amt.EqvtAmt.CcyOfTrf` | string | ✔ | 07 | `body.conversionTerms.targetAmount.currency` | Copied | Currency of transfer | `"ZMW"` |
| `Amt.EqvtAmt.XchgRateInf.UnitCcy` | string | — | 06/07 | | Calculated | Source currency | `"MWK"` |
| `Amt.EqvtAmt.XchgRateInf.XchgRate` | number | — | 06/07 | | Calculated | `InstdAmt ÷ EqvtAmt` | `60` |
| `ChrgBr` | string | ✔ | — | — | Defaulted | ⚠️ **Not knowable at this point** — see below | `"SLEV"` |
| `CdtrAgt…ClrSysMmbId.MmbId` | string | ✔ | 10 | `body.payee.partyIdInfo.fspId` | Copied | | `"test-zmw-dfsp"` |
| `Cdtr.Nm` | string | ✔ | 10 | `body.payee.partyIdInfo.partyIdentifier` | Inferred | ⚠️ **Degrades to the payee MSISDN** — no payee name reaches this pipeline; see gap below | `"16665551001"` |
| `Cdtr…BirthDt` | string | ✔ | — | — | Defaulted | ⚠️ No source anywhere | `"1900-01-01"` |
| `Cdtr…CityOfBirth` / `CtryOfBirth` | string | ✔ | — | — | Defaulted | | `"Unknown"` / `"ZZ"` |
| `Cdtr…Othr[0].Id` / `SchmeNm.Prtry` | string | ✔ | 10 | `body.payee.partyIdInfo` | Copied | | `"16665551001"` / `"MSISDN"` |
| `Cdtr.CtctDtls.MobNb` | string | ✔ | 10 | `body.payee.partyIdInfo.partyIdentifier` | Inferred | | `"16665551001"` |
| `CdtrAcct.Id.Othr[0].*` | | ✔ | 10 | `body.payee.partyIdInfo` | Inferred | | `"16665551001"` / `"MSISDN"` |
| `CdtrAcct.Nm` | string | ✔ | 10 | `body.payee.partyIdInfo.partyIdentifier` | Inferred | Same MSISDN fallback as `Cdtr.Nm` | `"16665551001"` |
| `Purp.Cd` | string | ✔ | 10 | `body.transactionType` | Calculated | `TRANSFER` + `CONSUMER` → `MP2P` | `"MP2P"` |
| `RgltryRptg.Dtls.Tp` / `.Cd` | string | ✔ | — | — | Defaulted | No source | `"BALANCE OF PAYMENTS"` / `"100"` |
| `RmtInf.Ustrd` | string | ✔ | 10 | `body.note` | Copied | | `"test"` |

## `CdtTrfTxInf.SplmtryData.Envlp.Doc` — all required

This is where the quote's richest personal data lands.

| Tazama field | Req | Source msg | Locator | Prov. | Golden-path value |
|---|---|---|---|---|---|
| `Dbtr.FrstNm` | ✔ | 10 | `body.payer.personalInfo.complexName.firstName` | Copied | `"Firstname-Test"` |
| `Dbtr.MddlNm` | ✔ | 10 | `…complexName.middleName` | Copied | `"Middlename-Test"` |
| `Dbtr.LastNm` | ✔ | 10 | `…complexName.lastName` | Copied | `"Lastname-Test"` |
| `Dbtr.MrchntClssfctnCd` | ✔ | — | — | Defaulted | `"BLANK"` |
| `Cdtr.FrstNm` / `MddlNm` / `LastNm` | ✔ | — | — | Defaulted | ⚠️ No payee name components exist — `"BLANK"` |
| `Cdtr.MrchntClssfctnCd` | ✔ | 10 | `body.payee.merchantClassificationCode` | Copied | `"123"` |
| `DbtrFinSvcsPrvdrFees.Ccy` / `.Amt` | ✔ | — | — | Defaulted | No payer-side fee in the flow — `"ZMW"` / `0` |
| `Xprtn` | ✔ | 10 | `body.expiration` | Copied | `"2025-10-13T13:15:07.827Z"` |

## `CstmrCdtTrfInitn.SplmtryData.Envlp.Doc.InitgPty`

| Tazama field | Req | Source | Prov. | Golden-path value |
|---|---|---|---|---|
| `InitrTp` | ✔ | 10 `body.transactionType.initiatorType` | Copied | `"CONSUMER"` |
| `Glctn.Lat` / `.Long` | ✔ | — | Defaulted | ⚠️ No geolocation in Mojaloop — `"0"` / `"0"` |

> ⚠️ `handlePain001` reads `Glctn.Lat`/`.Long` directly into Tazama's transaction details. A constant `0,0` is stored as a **real coordinate**, not as missing data.

---

## Two sourcing constraints

**1. `ChrgBr` is required but not yet known.** The charge bearer is stated only by the payee, in the `PUT /quotes` callback (`ext[CdtTrfTxInf.ChrgBr]` = `CRED`), which arrives *after* pain.001 is emitted. Every other enrichment source precedes its trigger; this one follows it, and nothing re-emits a pain.001. **Rule: default to `SLEV` on pain.001 and carry the payee-stated value on pain.013.** The two messages may legitimately differ on this field.

**2. The payee name reaches this pipeline from nowhere.** `Cdtr.Nm` is required. The `payee` object in `POST /quotes` carries `partyIdInfo` and `merchantClassificationCode` only — the FSPIOP quote schema has no element for payee personal information, so this is a property of the protocol, not of this capture.

`PUT /parties` (msg 03) is **not** an alternative source. ALS is HTTPS end-to-end and never publishes to Kafka (FSD §6.4.4, §11 — confirmed with CCH), so no party-lookup event reaches the MLA at all. This is not a capture the project deferred; it is one that does not exist for this pipeline. `Cdtr.Nm` and `CdtrAcct.Nm` therefore degrade to the payee MSISDN on pain.001, pain.013 and pacs.008 alike, and the resulting message must be flagged degraded in the audit log — a required name field carrying an identifier is structurally valid and indistinguishable from a real one at the TMS door.

**FSD Open Item #4** tracks confirming a payee display-name field inside the quote messages with the Mojaloop Implementation Partner. Until it closes, anything in Tazama performing name-based screening or entity resolution on the creditor side receives an MSISDN.

## Verification

```
tazama_pain001.json  vs  src/schemas/pain.001.json   VALID: true
  STRIPPED by removeAdditional: (nothing)
```

| Negative control | Result |
|---|---|
| With `TenantId` | **FAIL** — `must NOT be valid` |
| Without `CdtTrfTxInf.SplmtryData` | **FAIL** — required |
| Without `Amt.EqvtAmt` | **FAIL** — required |
| With `PmtId.InstrId` | **PASS, silently stripped** — confirms `PmtId` holds only `EndToEndId` |

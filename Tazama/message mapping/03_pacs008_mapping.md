# pacs.008.001.10 — field-by-field mapping

**Replaces §6.5 row 3.** Trigger: **msg 16** `POST /transfers` (PREPARE), enriched from cached msgs 03 / 06 / 07 / 10 / 11.
Contract: `tms-service/src/schemas/pacs.008.json` (ajv). Endpoint: `POST /v1/evaluate/iso20022/pacs.008.001.10`.
Validated output: [`samples/tazama_pacs008.json`](samples/tazama_pacs008.json) — **passes**.

**Legend** — *Provenance*: `Copied` (verbatim) · `Calculated` (derived) · `Inferred` (deduced) · `Created` (PPA-generated) · `Defaulted` (constant, no source).
*Locator*: `body` · `hdr` · `ext[key]` · `ilp` (decoded ILP packet) · `—` (no source).

---

## Root

| Tazama field | Type | Req | Source msg | Locator | Prov. | Rule | Golden-path value |
|---|---|---|---|---|---|---|---|
| `TxTp` | string | — | — | — | Created | Constant. Schema default fills it if omitted | `"pacs.008.001.10"` |
| `TenantId` | — | **forbidden** | — | — | — | ⚠️ **Must NOT be sent.** TMS injects it from the JWT | *(absent)* |

## `FIToFICstmrCdtTrf.GrpHdr`

| Tazama field | Type | Req | Source msg | Locator | Prov. | Rule | Golden-path value |
|---|---|---|---|---|---|---|---|
| `MsgId` | string | ✔ | — | — | Created | New ULID. Msg 16 supplies no `GrpHdr.MsgId` (**D9**) | `01K7EV9ZQ4X8N2R5T7V9W1Y3Z6` |
| `CreDtTm` | string | ✔ | — | — | Created | PPA construction timestamp, ISO 8601 UTC | `2025-10-13T13:14:10.612Z` |
| `NbOfTxs` | **number** | ✔ | 11 | `ext[GrpHdr.NbOfTxs]` | Calculated | Always 1 (Mojaloop is single-transaction). **Parse to number** — Mojaloop sends `"1"` | `1` |
| `SttlmInf.SttlmMtd` | string | ✔ | 11 | `ext[GrpHdr.SttlmInf.SttlmMtd]` | Copied | Falls back to `"CLRG"` | `"CLRG"` |

## `FIToFICstmrCdtTrf.CdtTrfTxInf`

### Identifiers and amounts

| Tazama field | Type | Req | Source msg | Locator | Prov. | Rule | Golden-path value |
|---|---|---|---|---|---|---|---|
| `PmtId.InstrId` | string | ✔ | 16 | `body.transferId` | Copied | **D2** — this instruction's id | `01K7EV9TNQ1VKX84N0GSQH6MDD` |
| `PmtId.EndToEndId` | string | ✔ | 16 | `ilp.transactionId` | Copied | **D2** — end-to-end correlator | `01K7EV9TNQ1VKX84N0GSQH6MDD` |
| `IntrBkSttlmAmt.Amt.Amt` | number | ✔ | 16 | `body.amount.amount` | Calculated | **String → number.** Settled amount, customer leg | `1` |
| `IntrBkSttlmAmt.Amt.Ccy` | string | ✔ | 16 | `body.amount.currency` | Copied | | `"ZMW"` |
| `InstdAmt.Amt.Amt` | number | ✔ | 07 | `body.conversionTerms.sourceAmount.amount` | Calculated | **D1** — source amount the payer was instructed to send. String → number | `60` |
| `InstdAmt.Amt.Ccy` | string | ✔ | 07 | `body.conversionTerms.sourceAmount.currency` | Copied | | `"MWK"` |
| `XchgRate` | **string** | — | 06/07 | `body.conversionTerms.*` | Calculated | `InstdAmt.Amt ÷ IntrBkSttlmAmt.Amt` (**D1**). ⚠️ Schema says `string`, TS says `number` — **G5** | `"60"` |
| `ChrgBr` | string | ✔ | 11 | `ext[CdtTrfTxInf.ChrgBr]` | Copied | Fallback `"SLEV"` | `"CRED"` |

> **Non-obvious:** `InstdAmt` and `IntrBkSttlmAmt` are in **different currencies** (MWK vs ZMW). That is correct and is the whole point of D1 — the pair plus `XchgRate` is what makes the cross-border conversion visible to Tazama in a single transaction.

### Charges

| Tazama field | Type | Req | Source msg | Locator | Prov. | Rule | Golden-path value |
|---|---|---|---|---|---|---|---|
| `ChrgsInf.Amt.Amt` | number | ✔ | 11 | `body.payeeFspFee.amount` | Calculated | String → number; `0` if absent | `0` |
| `ChrgsInf.Amt.Ccy` | string | ✔ | 11 | `body.payeeFspFee.currency` | Copied | | `"ZMW"` |
| `ChrgsInf.Agt.…ClrSysMmbId.MmbId` | string | ✔ | 11 | `ext[CdtTrfTxInf.ChrgsInf.Agt.FinInstnId.Othr.Id]` | Copied | ⚠️ **Path reshape** — Mojaloop `FinInstnId.Othr.Id` → Tazama `FinInstnId.ClrSysMmbId.MmbId` | `"test-zmw-dfsp"` |

> ⚠️ `ChrgsInf` is a **single object** here. In pacs.002 it is an **array**. The FX spread is *not* a charge under **D1** — it is expressed via `XchgRate`.

### Parties

`InitgPty` = the payer, because `transactionType.initiator = "PAYER"`. If a scheme ever sends `initiator: "PAYEE"`, `InitgPty` must follow the payee.

| Tazama field | Type | Req | Source msg | Locator | Prov. | Rule | Golden-path value |
|---|---|---|---|---|---|---|---|
| `InitgPty.*` | | ✔ | 10 | | Inferred | **Mirror of `Dbtr`** while `initiator = PAYER` | *(= Dbtr)* |
| `Dbtr.Nm` | string | ✔ | 10 | `body.payer.personalInfo.complexName` | Calculated | **D10** — join `firstName middleName lastName`; fall back to `payer.name` | `"Firstname-Test Middlename-Test Lastname-Test"` |
| `Dbtr…DtAndPlcOfBirth.BirthDt` | string | ✔ | 10 | `body.payer.personalInfo.dateOfBirth` | Copied | `YYYY-MM-DD` | `"1984-01-01"` |
| `Dbtr…DtAndPlcOfBirth.CityOfBirth` | string | ✔ | — | — | Defaulted | **D6** | `"Unknown"` |
| `Dbtr…DtAndPlcOfBirth.CtryOfBirth` | string | ✔ | — | — | Defaulted | **D6** | `"ZZ"` |
| `Dbtr…PrvtId.Othr[0].Id` | string | ✔ | 10 | `body.payer.partyIdInfo.partyIdentifier` | Copied | ⚠️ **Array**, not object | `"16665551002"` |
| `Dbtr…PrvtId.Othr[0].SchmeNm.Prtry` | string | ✔ | 10 | `body.payer.partyIdInfo.partyIdType` | Copied | | `"MSISDN"` |
| `Dbtr.CtctDtls.MobNb` | string | ✔ | 10 | `body.payer.partyIdInfo.partyIdentifier` | Inferred | Raw MSISDN — **no country-code inference** (**G4**) | `"16665551002"` |
| `Cdtr.Nm` | string | ✔ | **03** | `body.party.name` | Copied | **Only source in the whole flow** | `"Chikondi Banda"` |
| `Cdtr…DtAndPlcOfBirth.BirthDt` | string | ✔ | — | — | Defaulted | ⚠️ **No source anywhere — G1** | `"1900-01-01"` |
| `Cdtr…DtAndPlcOfBirth.CityOfBirth` | string | ✔ | — | — | Defaulted | | `"Unknown"` |
| `Cdtr…DtAndPlcOfBirth.CtryOfBirth` | string | ✔ | — | — | Defaulted | | `"ZZ"` |
| `Cdtr…PrvtId.Othr[0].Id` | string | ✔ | 16 | `ext[CdtTrfTxInf.Cdtr.Id.PrvtId.Othr.Id]` | Copied | Corroborated by `ilp.payee` | `"16665551001"` |
| `Cdtr…PrvtId.Othr[0].SchmeNm.Prtry` | string | ✔ | 16 | `ext[…Othr.SchmeNm.Prtry]` | Copied | | `"MSISDN"` |
| `Cdtr.CtctDtls.MobNb` | string | ✔ | 16 | `ext[…Othr.Id]` | Inferred | **G4** | `"16665551001"` |

### Accounts

Mojaloop has no account construct — the party identifier doubles as the account identifier. See [`../../ppa/party identifier/`](../../ppa/party%20identifier/) for the wider treatment.

| Tazama field | Type | Req | Source msg | Locator | Prov. | Rule | Golden-path value |
|---|---|---|---|---|---|---|---|
| `DbtrAcct.Id.Othr[0].Id` | string | ✔ | 10 | `body.payer.partyIdInfo.partyIdentifier` | Inferred | MSISDN as account id | `"16665551002"` |
| `DbtrAcct.Id.Othr[0].SchmeNm.Prtry` | string | ✔ | 10 | `body.payer.partyIdInfo.partyIdType` | Copied | | `"MSISDN"` |
| `DbtrAcct.Nm` | string | ✔ | 10 | `body.payer.name` | Copied | **Display** name here (**D10**) | `"Display-Test"` |
| `CdtrAcct.Id.Othr[0].Id` | string | ✔ | 16 | `ext[…Cdtr…Othr.Id]` | Inferred | | `"16665551001"` |
| `CdtrAcct.Id.Othr[0].SchmeNm.Prtry` | string | ✔ | 16 | `ext[…SchmeNm.Prtry]` | Copied | | `"MSISDN"` |
| `CdtrAcct.Nm` | string | ✔ | 03 | `body.party.name` | Copied | | `"Chikondi Banda"` |

### Agents

⚠️ **Path reshape on all four:** Mojaloop `FinInstnId.Othr.Id` → Tazama `FinInstnId.ClrSysMmbId.MmbId`.

| Tazama field | Type | Req | Source msg | Locator | Prov. | Rule | Golden-path value |
|---|---|---|---|---|---|---|---|
| `DbtrAgt…ClrSysMmbId.MmbId` | string | ✔ | 16 | `body.payerFsp` | Copied | Payer DFSP | `"test-mwk-dfsp"` |
| `CdtrAgt…ClrSysMmbId.MmbId` | string | ✔ | 16 | `body.payeeFsp` | Copied | Payee DFSP | `"test-zmw-dfsp"` |

### Purpose

| Tazama field | Type | Req | Source msg | Locator | Prov. | Rule | Golden-path value |
|---|---|---|---|---|---|---|---|
| `Purp.Cd` | string | ✔ | 10 | `body.transactionType` | Calculated | Table below. **D8**: body wins over ILP packet | `"MP2P"` |

| `scenario` | `initiatorType` | `Purp.Cd` |
|---|---|---|
| `TRANSFER` | `CONSUMER` | `MP2P` — mobile P2P |
| `TRANSFER` | `BUSINESS` | `MP2B` |
| `DEPOSIT` / `WITHDRAWAL` / `PAYMENT` / `REFUND` | any | **TBD** — not exercised by the golden path; do not guess |

> The ILP packet claims `initiatorType: BUSINESS`, the quote body `CONSUMER`. **D8** takes the body → `MP2P`.

## Siblings of `CdtTrfTxInf` — all required

| Tazama field | Type | Req | Source msg | Locator | Prov. | Rule | Golden-path value |
|---|---|---|---|---|---|---|---|
| `RgltryRptg.Dtls.Tp` | string | ✔ | — | — | Defaulted | ⚠️ **G2** — no source | `"BALANCE OF PAYMENTS"` |
| `RgltryRptg.Dtls.Cd` | string | ✔ | — | — | Defaulted | ⚠️ **G2** | `"100"` |
| `RmtInf.Ustrd` | string | ✔ | 10 | `body.note` | Copied | `""` if absent | `"test"` |
| `SplmtryData.Envlp.Doc.Xprtn` | string | ✔ | 16 | `body.expiration` | Copied | Transfer expiry | `"2025-10-13T13:15:10.546Z"` |
| `SplmtryData…InitgPty.Glctn.Lat` | string | ✔ | — | — | Defaulted | ⚠️ **G3** — no geolocation in Mojaloop | `"0"` |
| `SplmtryData…InitgPty.Glctn.Long` | string | ✔ | — | — | Defaulted | ⚠️ **G3** | `"0"` |

> These three objects are **required** by the real ajv schema. FSD v1.1's samples omit all of them — such a message is rejected.

---

## Deliberately not mapped

| Mojaloop field | Why |
|---|---|
| `ilpPacket` | **Decoded and consumed** as a source (**D5**) — never carried as a blob |
| `condition`, `fulfilment` | No field exists. `removeAdditional: 'all'` **silently deletes** them (**D5**) |
| `payeeReceiveAmount` | Equals `transferAmount` here; no distinct Tazama field |
| `commitRequestId`, `conversionId` | FX-leg identifiers — not a separate transaction under **D1** |
| `extensionList` (residual keys) | Consumed selectively above; no passthrough exists |

## Verification

```
tazama_pacs008.json  vs  src/schemas/pacs.008.json   VALID: true
  STRIPPED by removeAdditional: (nothing)
```

Negative controls:

| Test | Result |
|---|---|
| With `TenantId` | **FAIL** — `must NOT be valid` |
| Without `RgltryRptg` | **FAIL** — `must have required property 'RgltryRptg'` |
| With `VrfctnOfTerms` (FSD v1.1 shape) | **PASS, but silently stripped** — worst case: looks fine, data gone |
| `NbOfTxs: "1"` (string) | PASS — coerced to `1`. Safety net, not a licence |

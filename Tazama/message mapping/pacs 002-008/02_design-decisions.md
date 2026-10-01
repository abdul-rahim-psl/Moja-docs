# Design decisions — Mojaloop → Tazama pacs.008 / pacs.002

Signed off 2026-07-30: **D1** (one transaction per payment), **D3** (emit on prepare), **scope** (§6.5 rows 3, 4, 6, 7).
D2, D4–D10 resolved below during implementation; each records evidence.

---

## ⚠️ Ground-truth correction — `swagger.yaml` is NOT the validator

The executive plan stated that `tms-service/swagger.yaml` is what TMS validates against. **That is wrong**, and it changed several conclusions. Verified in `tms-service/src/clients/fastify.ts`:

```js
import messageSchemaPacs008 from '../schemas/pacs.008.json';
const ajv = new Ajv({ removeAdditional: 'all', useDefaults: true,
                      coerceTypes: 'array', strictTuples: false, strict: false });
fastify.setValidatorCompiler(({ schema }) => ajv.compile(schema));
```

**The authoritative contract is `tms-service/src/schemas/pacs.008.json` and `pacs.002.json`, enforced by ajv.** `swagger.yaml` is documentation only, and it is **stale** — it disagrees with the real schema on `Othr` (object vs array), and Tazama's own `frms-coe-lib` sample fails it in 4 places while passing the real schema.

Everything below is verified against the **real** schemas with **ajv configured exactly as TMS configures it**.

### What the real schemas enforce — and what they don't

| | Real ajv schema | swagger.yaml (stale) |
|---|---|---|
| `Othr` | **array** | object |
| `TenantId` | **forbidden** (`"not": {"required":["TenantId"]}`) | absent |
| `TxSts` | plain string — **no enum** | 15-value enum |
| `Ccy` | plain string — **no enum** | closed currency list |
| maxLength / patterns | **none anywhere** | 35-char limits, `MobNb` pattern |
| `RgltryRptg`/`RmtInf`/`SplmtryData` | **required** | not required |
| `XchgRate` | present, `type: string` | absent entirely |

The real schema is **purely structural** — types and required-ness only. No value-level validation at all.

### Three ajv behaviours that dominate the design

| Option | Effect | Consequence |
|---|---|---|
| `removeAdditional: 'all'` | Any property not declared in the schema is **silently deleted** | There is no extension mechanism. Anything not in the schema is lost without error. |
| `coerceTypes: 'array'` | Strings coerced to declared types | `NbOfTxs: "1"` → `1`; `Amt: "1"` → `1`. Safety net, not a licence — we emit correct types. |
| `useDefaults: true` | Schema defaults filled in | `TxTp` defaults to `pacs.008.001.10` / `pacs.002.001.12` if omitted. |

**The `removeAdditional` finding is the most consequential in this whole exercise.** Test evidence:

```
PASS  pacs008 with VrfctnOfTerms (FSD v1_1 shape)
        VrfctnOfTerms survived? false
```

The FSD v1.1 design — carrying the ILP packet in `VrfctnOfTerms` — **returns HTTP 200 and silently discards the data**. No error, no log, no rejection. It would have looked like it was working.

---

## D1 — One Tazama transaction per payment ✅ signed off

**Decision:** one pacs.008 + one pacs.002 for the whole cross-border payment. The FX leg is folded into the amounts, not modelled as a separate transaction.

- `InstdAmt` = **MWK 60** — what the payer was instructed to send (source currency)
- `IntrBkSttlmAmt` = **ZMW 1** — what actually settled on the customer leg
- `XchgRate` = **60**

**Rate direction verified** against Tazama's own `DataCache` documentation, which gives `instdAmt 17.01 ZAR`, `intrBkSttlmAmt 0.97 USD`, `xchgRate 17.536082` — and 17.01 ÷ 0.97 = 17.536082. So:

> **`XchgRate` = `InstdAmt.Amt` ÷ `IntrBkSttlmAmt.Amt`** → 60 ÷ 1 = 60

The FXP (`test-fxp`) never appears as a party. Modelling it per-leg would inject a synthetic entity and an extra `transactionRelationship` edge into Tazama's graph on every cross-border payment, inflating counterparty counts and corrupting velocity scoring.

**Consequence — D7:** §6.5 row 6 (FX final-state → pacs.002) is **removed**. There is no second pacs.002.

## D2 — Identifier strategy ✅

| Field | Value | Source |
|---|---|---|
| `PmtId.EndToEndId` | `transactionId` | the end-to-end correlator, stable across all four Tazama messages |
| `PmtId.InstrId` | `transferId` | the identifier of this specific instruction/leg |
| `OrgnlEndToEndId` | = the pacs.008's `EndToEndId` | joins pacs.002 → pacs.008 |
| `OrgnlInstrId` | = the pacs.008's `InstrId` | " |

In the golden path `transactionId` and `transferId` are **the same ULID** (`01K7EV9TNQ1VKX84N0GSQH6MDD`) — Mojaloop reuses one id for both at the transfer stage. They are kept as distinct mapping rules because they diverge for the quote-stage messages (pain.001/013, out of scope here) where `InstrId` = `quoteId`.

`PmtId.TxId` — used throughout FSD v1.1 — **does not exist** in Tazama's schema and would be silently stripped by `removeAdditional`.

## D3 — Emit pacs.008 on prepare ✅ signed off

- **pacs.008** built on **msg 16** (`POST /transfers`), enriched from cached msgs 03/10/11 (+06/07 for FX amounts)
- **pacs.002** built on **msg 17** (`PUT /transfers` fulfil)

Preserves the ~1-second pre-settlement evaluation window. Degrades gracefully: msg 16 alone (with its decoded ILP packet) supplies both parties, both agents, and the transaction type, so a pacs.008 is still constructible if the quote stage was missed — see `01_message-relevance.md`.

## D4 — `TxSts` translation ✅ (rationale corrected)

**Correction:** the executive plan claimed sending `COMMITTED` causes a hard rejection. It does not — verified:

```
PASS  pacs002 TxSts="COMMITTED" (raw Mojaloop)
```

`TxSts` is an unconstrained string in the real schema. The translation is still required, but for a different and arguably more dangerous reason: **an untranslated value passes validation and is stored**, then silently fails every downstream rule or typology that tests for ISO status codes. A rejection would at least be visible.

| Mojaloop value | Source | ISO `TxSts` | Meaning |
|---|---|---|---|
| `COMMITTED` | `transferState`, msg 17 | **`ACSC`** | AcceptedSettlementCompleted — funds moved |
| `ABORTED` | `transferState` | **`RJCT`** | Rejected |
| `RESERVED` | `transferState`/`conversionState` | **`ACSP`** | AcceptedSettlementInProcess — reserved, not final |
| error callback | any resource | **`RJCT`** | Rejected |

`ACSC` over `ACCC` for `COMMITTED`: `ACCC` (AcceptedSettlementCompletedCreditorAccount) asserts the funds reached the *creditor's account*, which Mojaloop's `COMMITTED` does not evidence — it confirms settlement between DFSPs. `ACSC` is the accurate claim.

## D5 — ILP packet consumed; condition/fulfilment dropped ✅

- **`ilpPacket`** — decoded and decomposed into `Dbtr`, `Cdtr`, `PmtId`, `Purp`. It is a **data source**, never carried as a blob.
- **`condition` / `fulfilment`** — dropped from the Tazama payload; retained in the PPA audit log.

Not a preference: `VrfctnOfTerms`, `IlpV4PrepPacket` and `Condition` are absent from the real schema, so `removeAdditional: 'all'` deletes them silently (evidence above). There is **no** extension point in Tazama's ingestion contract. Carrying them requires a schema change in `tms-service`, which is a change request on Tazama, not a mapping decision.

**Decode procedure:** `base64url → ILP v4 packet → extract embedded base64url JSON blob → parse`. Must have an explicit error path — a decode failure must **not** silently yield a pacs.008 with defaulted parties, because the result would validate and look correct.

## D6 — Defaulting policy ✅

Every field the schema requires but Mojaloop never supplies is filled from a documented constant and tagged `Defaulted` in the mapping tables, so gaps are auditable rather than invisible.

| Field | Value | Note |
|---|---|---|
| `CityOfBirth` | `"Unknown"` | Tazama's own convention |
| `CtryOfBirth` | `"ZZ"` | ISO 3166 user-assigned "unknown" |
| `Cdtr…BirthDt` | `"1900-01-01"` | ⚠️ **sentinel — see gap G1** |
| `RgltryRptg.Dtls` | `Tp: "BALANCE OF PAYMENTS"`, `Cd: "100"` | ⚠️ **gap G2** |
| `SplmtryData…Glctn` | `Lat: "0"`, `Long: "0"` | ⚠️ **gap G3** |

## D8 — Precedence when sources disagree ✅

The ILP packet says `initiatorType: BUSINESS`; msg 10's quote body says `CONSUMER`, for the same transaction.

**Rule: the FSPIOP message body wins over the decoded ILP packet.** The packet is constructed by the payee DFSP and may carry its own defaults; the quote body is the payer DFSP's first-party assertion. Applied to `Purp.Cd`, this yields `CONSUMER` → `MP2P`.

Precedence order for every field: **body → extensionList → decoded ilpPacket → default**.

## D9 — ~~`GrpHdr.MsgId` / `CreDtTm`: copy when supplied~~ **SUPERSEDED by FSD §6.5.4**

> ⛔ **This decision was not adopted.** It proposed revising the FSD; the FSD went the other way and reasserted its rule with a stronger justification. **The rule in force is: `GrpHdr.MsgId` and `GrpHdr.CreDtTm` are PPA-generated on every outbound message, with no exception** — on pacs.002 and pain.013 as much as on pacs.008. Retained here because the observation behind it is factually correct and the reasoning is worth preserving.

**What this decision proposed.** FSD v1.1 stated these are "generated by the PPA itself on every outbound message — they are not mapped from Mojaloop inputs". The golden path appeared to contradict it: msg 17's `extensionList` supplies both.

```json
{"key": "GrpHdr.MsgId",   "value": "01K7EVA0DTXE0B1GCTZ744Y2PD"}
{"key": "GrpHdr.CreDtTm", "value": "2025-10-13T13:14:11.258Z"}
```

Proposed rule: use the scheme-supplied value when present, generate otherwise — preserving traceability between the Tazama message and the Mojaloop message that produced it.

**Why it was superseded.** The observation is correct — the wire does supply both — but the conclusion does not follow, for two reasons the capture cannot show:

1. **Uniqueness.** A scheme-supplied `MsgId` puts uniqueness outside PPA's control and repeats if the source re-sends the same event. TMS enforces `UNIQUE(MsgId, TenantId)`, so a repeat is rejected or collides. PPA must own the value to guarantee it.
2. **Retry safety.** FSD §6.3 step 8 requires a retry to resend the *exact* message built at first assembly, with the same pinned `MsgId`. A generate-or-copy rule makes the field's origin depend on the source event, complicating the pin.

Traceability — the property this decision was protecting — is carried instead by the Event Envelope's `correlationId` (FSD §5.4), which is MLA-generated per event and propagated through PPA, ValKey, the audit log, the DLQ and the outbound TMS call. That is a purpose-built trace handle; `MsgId` is an identity constraint, and the two should not be conflated.

FSD §6.4.1 records pain.013's `MsgId` as one of exactly two deliberate deviations from the field-mapping reference — this decision is the other side of that record.

**In force:** both pacs.002 and pacs.008 **generate**; pain.001 and pain.013 **generate**. No message copies.

## D10 — `Dbtr.Nm` uses the legal name, not the display name 🆕

Msg 10 offers both: `name: "Display-Test"` and `personalInfo.complexName` = `Firstname-Test / Middlename-Test / Lastname-Test`.

**Rule: `Nm` = `complexName` joined (first middle last) when present; fall back to `name`.** `DbtrAcct.Nm` keeps the display name.

This **diverges from Mojaloop's own extensionList mapping**, which sets `CdtTrfTxInf.Dbtr.Name` = `"Display-Test"`. Chosen deliberately: Tazama performs entity resolution and name-based screening, where a display handle is close to useless and the legal name is the signal. Flagged for CCH confirmation.

---

## Open gaps — no Mojaloop source exists

These are **required** by the real schema and cannot be sourced. They are defaulted, and every default is a small lie in the data.

| # | Field | Impact | Recommendation |
|---|---|---|---|
| **G1** | `Cdtr…DtAndPlcOfBirth.BirthDt` — payee date of birth appears **nowhere** in the flow | Every payee in every transaction shares the sentinel `1900-01-01`. Any rule or entity-resolution step keying on DOB will treat all payees as coincident | Request CCH carry payee DOB in the `PUT /parties` `extensionList`; until then, ensure no active rule keys on `Cdtr` DOB |
| **G2** | `RgltryRptg.Dtls` — balance-of-payments reporting | Genuinely meaningful for a **cross-border** corridor, and constant-filled today | Request a scheme-level BoP purpose code from CCH per corridor |
| **G3** | `SplmtryData…Glctn.Lat/Long` — payer geolocation | Constant `0,0` disables any geo-velocity or impossible-travel typology | Request via `extensionList` if CCH captures it at initiation |
| **G4** | `CtctDtls.MobNb` format | Tazama's samples and the stale swagger use `+CC-NNNNNNN`; Mojaloop gives bare `16665551002`. The real schema enforces **no pattern**, so raw passes | Emit raw. Splitting into country code + subscriber requires inventing a country-code table — we do not infer |
| **G5** | `XchgRate` typed `string` in schema, `number` in the `Pacs008` TS interface | ajv coerces to string; a rule processor typed `number` receives `"60"` at runtime | Raise with Tazama — schema/interface mismatch, not ours to fix |
| **G6** | `TenantId` mandatory in the TS interface but **forbidden** on ingestion | The PPA must not send it. TMS injects it from the JWT (`validateTenantMiddleware.ts`) | Ensure the PPA's Tazama-scoped token carries the correct tenant claim — the tenant travels in the **token**, not the payload |

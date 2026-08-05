# continue.md — Mojaloop → Tazama message mapping: session record

**Session date:** 2026-08-03
**Purpose:** complete record of the analysis, decisions and deliverables from this working session, so the work can be resumed cold.
**Scope covered:** FSD §6.3–§6.5, §7, §8; the pacs.008/pacs.002 mapping; the pain.001/pain.013 mapping.

---

## 1. Where things stand

**All four ISO 20022 messages Tazama ingests are now mapped and schema-validated** against Tazama's live ajv schemas, built from one real cross-border transaction:

```
tazama_pacs008.json  →  pacs.008.json   VALID   STRIPPED: (nothing)
tazama_pacs002.json  →  pacs.002.json   VALID   STRIPPED: (nothing)
tazama_pain001.json  →  pain.001.json   VALID   STRIPPED: (nothing)
tazama_pain013.json  →  pain.013.json   VALID   STRIPPED: (nothing)
```

Plus 15 negative controls across the two workstreams confirming individual claims.

`STRIPPED: (nothing)` matters as much as `VALID: true` — see insight #2.

**Canonical FSD: `message_ingestion_FSDs/CCH_FSD_MessageIngestion_v1_2.md`.**
v1_1 is the prior working copy; v3.0 (in `docs/FSD/msg_ingestion/`) is a separate lineage that was reviewed by the team but is not what we work against.

---

## 2. The reference transaction

Everything is verified against one flow — DRPP Golden Path `DRPP-GP-01 Send Money (Source Currency, Multiple FXPs)`, in `docs/Sample flow E2E/`.

| | |
|---|---|
| Trace id | `67629f2771f9ca3e58ae98d2b525ff82` |
| transferId / transactionId | `01K7EV9TNQ1VKX84N0GSQH6MDD` |
| quoteId | `01K7EV9X2K4F8J90ZWMRHDNCZN` |
| conversionRequestId | `01K7EV9VS1V41WTE9SC7JCGFZN` |
| conversionId / commitRequestId | `01K7EV9VS1V41WTE9SC7JCGFZP` |
| Payer → Payee | `test-mwk-dfsp` (MSISDN 16665551002) → `test-zmw-dfsp` (MSISDN 16665551001) |
| FXP | `test-fxp` |
| Amount | **MWK 60 → ZMW 1**, SEND / source currency; payeeFspFee ZMW 0 |
| Duration | 2025-10-13T13:14:05.367Z → 13:14:11.252Z (5.9 s) |
| Payer identity | `Display-Test`; complexName `Firstname-Test / Middlename-Test / Lastname-Test`; DOB 1984-01-01 |
| Payee identity | `Chikondi Banda` — **appears only in `PUT /parties`** |

**Critical caveat:** this is an **FSPIOP wire capture**, not a Kafka capture. See open gap #1 in §8.

---

## 3. Every document read

### Mojaloop side
| Path | What it gave us |
|---|---|
| `docs/Sample flow E2E/README.md` | Flow structure, two-layer explanation (SDK-outbound vs FSPIOP) |
| `docs/Sample flow E2E/01_outbound_post_transfers_request.json` | SDK-layer initiation; `homeTransactionId`, payer block |
| `…/03_fspiop_parties_put_callback.json` | **Payee name — sole source in the entire flow** |
| `…/06_fspiop_fxQuotes_post_request.json` | `sourceAmount` MWK 60, `determiningTransferId` |
| `…/07_fspiop_fxQuotes_put_callback.json` | Agreed `targetAmount` ZMW 1 → exchange rate |
| `…/10_fspiop_quotes_post_request.json` | Payer DOB + complexName, `transactionType`, `note` |
| `…/11_fspiop_quotes_put_callback.json` | `ChrgBr: CRED`, fees, `SttlmMtd`, `originalIso20022QuoteResponse` |
| `…/14_fspiop_fxTransfers_post_request.json` | `commitRequestId` — correlation only |
| `…/15_fspiop_fxTransfers_put_callback.json` | `conversionState: RESERVED` — not emitted |
| `…/16_fspiop_transfers_post_prepare_request.json` | **pacs.008 trigger**; ILP packet decoded here |
| `…/17_fspiop_transfers_put_fulfil_callback.json` | **pacs.002 trigger**; `transferState`, headers |
| `docs/Tazama/message_ingestion_FSDs/CCH_FSD_MessageIngestion_v1_1.md` | The document being corrected |
| `docs/FSD/msg_ingestion/CCH_FSD_MessageIngestion_v3.0.md` | Separate lineage; touched then **fully reverted** |

### Tazama side — the authoritative sources
| Path | What it gave us |
|---|---|
| **`tms-service/src/schemas/pacs.008.json`** | **The real pacs.008 contract** (ajv) |
| **`tms-service/src/schemas/pacs.002.json`** | **The real pacs.002 contract** |
| **`tms-service/src/schemas/pain.001.json`** | **The real pain.001 contract** |
| **`tms-service/src/schemas/pain.013.json`** | **The real pain.013 contract** |
| `tms-service/src/clients/fastify.ts` | ajv options — `removeAdditional`, `coerceTypes`, `useDefaults` |
| `tms-service/src/router.ts` | Endpoint paths; the `QUOTING` route gate |
| `tms-service/src/utils/schema-utils.ts` | Schema binding, auth pre-handlers |
| `tms-service/src/middleware/validateTenantMiddleware.ts` | `TenantId` injected from JWT |
| **`tms-service/src/logic.service.ts`** | **DataCache construction, entity creation, id format** |
| `tms-service/src/config.ts`, `.env.template`, `API_SPEC.md`, `README.md` | `QUOTING` default = `false` |
| `tms-service/swagger.yaml` | **Stale documentation — NOT the validator** |
| `frms-coe-lib/src/interfaces/Pacs.008.001.10.ts`, `Pacs.002.001.12.ts` | TS interfaces (post-ingestion shape) |
| `frms-coe-lib/src/interfaces/rule/DataCache.ts` | DataCache field list |
| `frms-coe-lib/src/tests/data/pacs008.ts`, `pacs002.ts`, `pain001.ts` | Tazama's own conventions (`Unknown`/`ZZ`, `TRA`, `ADWD`) |
| `tazama/docs/Knowledge-Articles/iso20022-and-tazama.md` | Original mapping doctrine; provenance vocabulary |
| `tazama/docs/Product/transaction-monitoring-service-api.md` | Endpoint list, DataCache description |

Pinned commits: `frms-coe-lib @ ee348d3a` (2026-05-12), `tms-service @ f18317f1` (2026-03-25).

---

## 4. Design decisions

| # | Decision | Status |
|---|---|---|
| **D1** | **One Tazama transaction per payment**, not per settlement leg. `InstdAmt` = MWK 60 (source), `IntrBkSttlmAmt` = ZMW 1 (settled), `XchgRate` = 60. FXP never appears as a party | ✅ signed off |
| **D2** | **Identifier strategy.** `EndToEndId` = `transactionId` on all four messages. Stage id: `PmtId.InstrId` = `transferId` on pacs.008/002; **`PmtInf.PmtInfId` = `quoteId`** on pain.001/013 (pain `PmtId` has no `InstrId`) | ✅ verified |
| **D3** | **Emit pacs.008 on the transfer PREPARE**, not on prepare+fulfil pairing. Preserves the ~1s pre-settlement evaluation window | ✅ signed off |
| **D4** | **`TxSts` translation:** `COMMITTED`→`ACSC`, `ABORTED`→`RJCT`, `RESERVED`→`ACSP`, error→`RJCT`. `ACSC` not `ACCC` (the latter asserts funds reached the creditor's account) | ✅ |
| **D5** | **Decode and consume the ILP packet** as a data source; **drop** `condition`/`fulfilment` to the audit log (no schema field exists) | ✅ |
| **D6** | **Defaulting policy** for unsourced required fields, tagged `Defaulted`: `CityOfBirth`=`Unknown`, `CtryOfBirth`=`ZZ`, payee `BirthDt`=`1900-01-01`, `RgltryRptg`=`BALANCE OF PAYMENTS`/`100`, `Glctn`=`0`/`0` | ✅ |
| **D7** | **FX final-state row removed** — consequence of D1 | ✅ |
| **D8** | **Precedence when sources disagree:** body → extensionList → decoded ILP → default. (ILP says `initiatorType: BUSINESS`, quote body says `CONSUMER` → `CONSUMER` wins) | ✅ |
| **D9** | **`GrpHdr.MsgId`/`CreDtTm`:** copy the scheme-supplied value from `extensionList` when present, generate otherwise. pacs.002 and pain.013 copy; pacs.008 and pain.001 generate | ✅ |
| **D10** | **`Dbtr.Nm` uses the legal name** (complexName joined), not the display handle. `DbtrAcct.Nm` keeps the display name. Diverges from Mojaloop's own extensionList mapping, chosen for entity resolution / name screening | ✅ |
| **D11** | **`ChrgBr` on pain.001 defaults to `SLEV`**; the payee-stated value (`CRED`) is carried on pain.013. The two may legitimately differ | ✅ |

---

## 5. The insights that shaped everything

### 1. `swagger.yaml` is not the validator
TMS validates with **ajv against `src/schemas/*.json`** (`fastify.ts`). `swagger.yaml` is documentation and is **stale** — it declares `Othr` as an object where the real schema requires an **array**. Proof: **Tazama's own `frms-coe-lib` pacs.008 sample fails Tazama's own swagger** in 4 places, and passes the real schema.

### 2. `removeAdditional: 'all'` — the single most consequential constraint
Any property not in the schema is **silently deleted**. HTTP 200, no error, no log. Verified:
```
PASS  pacs008 with VrfctnOfTerms (FSD v1.1 shape)
        VrfctnOfTerms survived? false
```
**An incorrect mapping does not fail loudly — it succeeds quietly and loses data.** Every mapping check must assert both `VALID: true` **and** `STRIPPED: (nothing)`.

### 3. `TenantId` must NOT be sent
Both schemas declare `"not": {"required": ["TenantId"]}`. TMS injects it from the **JWT** (`validateTenantMiddleware.ts`). The TS interfaces mark it mandatory — they describe the *post-ingestion* message. Sending it causes rejection.

### 4. `TxSts` has no enum in the real schema
`"COMMITTED"` **passes** validation and is stored — then silently fails every downstream rule testing for ISO codes. Translation is a correctness duty, not a validation one. (An earlier assumption that this was a hard rejection came from the stale swagger.)

### 5. The ILP packet is a data source, not opaque material
`base64url → ILP v4 → embedded base64url JSON` decodes to a structured object carrying **both parties' identifiers and fspIds, the payer's name, `transactionType`, and the `quoteId`↔`transactionId` link**. This is what makes emit-on-prepare (D3) viable. `condition`/`fulfilment` are the genuinely opaque parts.

### 6. `XchgRate` direction, confirmed from Tazama's own docs
`XchgRate = InstdAmt.Amt ÷ IntrBkSttlmAmt.Amt`. Verified against Tazama's DataCache example: `17.01 ZAR ÷ 0.97 USD = 17.536082`. Here: 60 ÷ 1 = 60.

### 7. `QUOTING` is a single coupled switch
- `router.ts:19` — with `QUOTING=false` the pain.001/013 routes are **not registered**; calls return 404.
- `logic.service.ts:354` — with `QUOTING=true` pacs.008 **stops** creating `entities` and `account_holder` edges, expecting pain.001 to.

No intermediate state. **The quote-stage mapping must land before or together with flipping it, never after.** Default is `false`.

### 8. What `logic.service.ts` actually does
- pain.001/pain.013 populate **only 4 DataCache fields** (`cdtrId`, `dbtrId`, `cdtrAcctId`, `dbtrAcctId`) — no amounts.
- **pacs.008 is the sole source of DataCache amounts and the only handler that writes to Redis.**
- pacs.002 reads that key, falling back to `rebuildCache()` from the stored pacs.008.
- Id construction, pinned: `dbtrId = Othr[0].Id + SchmeNm.Prtry`; `dbtrAcctId = Othr[0].Id + SchmeNm.Prtry + Agt…MmbId`. Confirms `Othr[0]` — the array-vs-object question was load-bearing.

### 9. pain `PmtId` has only `EndToEndId`
No `InstrId` element — one added there is **silently stripped** (verified). The `quoteId` goes in `PmtInf.PmtInfId`. This corrected an error in the first draft of v1_2's §6.4.3/§6.5.2/§6.5.6.

### 10. pain.013 has no `XchgRateInf`
The exchange rate can be carried on pain.001 and pacs.008 only. A rate sent on pain.013 is silently stripped (verified).

### 11. The quote stage carries data the transfer stage cannot
- pain.001 `SplmtryData…Doc.Dbtr.FrstNm/MddlNm/LastNm` — the payer's name components. No equivalent on pacs.008.
- pain.013 `SplmtryData…Doc.PyeeRcvAmt`, `PyeeFinSvcsPrvdrFee`, `PyeeFinSvcsPrvdrComssn` — the payee-side economics. **No home in pacs.008 at all.**

### 12. `ChrgBr` is a forward dependency
Required on pain.001, but only stated in the `PUT /quotes` callback that *follows* it. Every other enrichment source precedes its trigger. Nothing re-emits a pain.001 → hence D11.

### 13. The payee name gap is structural, not a capture accident
The `payee` object in `POST /quotes` carries `partyIdInfo` and `merchantClassificationCode` only. **The FSPIOP quote schema has no element for payee personal information.** The sole source is `PUT /parties`. This blocks `Cdtr.Nm` on pain.001, pain.013 **and** pacs.008.

### 14. Only four TMS endpoints exist
`pain.001`, `pain.013`, `pacs.008`, `pacs.002`. The `pacs.081/082/091/092` labels are not ISO 20022 message types at all; `pacs.009` is real but Tazama has no route for it. Any mapping row naming those is unroutable — a premise error, not a field-path error.

### 15. Correlation is trigger + enrichment, not request/callback pairing
Pairing holds for the quote stage but breaks for the transfer stage. A pacs.008 needs data from 5 messages. Applying strict pairing produces **schema-valid but silently degraded** messages.

---

## 6. Open gaps (G-series, `pacs 002-008/02_design-decisions.md`)

| # | Gap | Impact |
|---|---|---|
| **G1** | **Payee date of birth** — appears nowhere in the flow | Every payee shares sentinel `1900-01-01` |
| **G2** | **`RgltryRptg`** BoP code — constant-filled | Meaningful for a cross-border corridor |
| **G3** | **Payer geolocation** — constant `0,0`. `handlePain001` reads it straight into transaction details, so it lands as a *real coordinate*, not as missing data | Disables geo-velocity typologies |
| **G4** | **`MobNb` format** — Tazama samples use `+CC-NNNN`, Mojaloop gives bare MSISDN. Real schema enforces no pattern | Emit raw; don't invent country codes |
| **G5** | **`XchgRate`** typed `string` in schema, `number` in TS interface | ajv coerces to string; a rule typed `number` gets `"60"` |
| **G6** | **`TenantId`** mandatory in TS, forbidden on ingestion | Tenant travels in the token |

---

## 7. Open questions

### pacs.002 trigger source (FSD §6.4.7)
Central Ledger notification vs FSPIOP fulfil callback. The mapping uses the fulfil callback because the golden path is a **wire capture with no Kafka events**. Deciding question: **does the notification carry `fspiop-source`/`fspiop-destination`?** `InstgAgt`/`InstdAgt` are required and come from those headers. Needs a Kafka capture.

### pain-stage questions (`pain001-013/findings.md` Q1–Q6)
Q1–Q4 answered from source. **Q5** — confirm `QUOTING` on the target deployment. **Q6** — FX-quote-before-quote ordering is structurally guaranteed for SEND/source-currency but unverified for RECEIVE flows; needs a non-SEND capture.

### FSD open items added
**#10** `QUOTING` setting · **#11** payee name source · **#12** raw Kafka capture.

---

## 8. The two structural gaps (`pacs 002-008/07_...`)

### Gap 1 — wire capture vs Kafka
Everything is mapped from HTTP/wire captures; the MLA consumes **Kafka**. Supporting evidence that content carries over: FSD §5.3 step 4 has the MLA extracting `FSPIOP-Source`/`Destination` (HTTP header names) from Kafka messages, and §4.6 says transfer payloads arrive base64-encoded and decode to the same fields. **But no raw Kafka message has ever been seen.**

**Standing rule:** check any mapping decision against *"is this on a Kafka topic the MLA subscribes to (§4.4)"*, not *"does this appear in the sample flow"*.

### Gap 2 — the discovery leg
FSD §11 excludes ALS/discovery capture on the premise that quote-stage data covers it. **That premise is false** (insight #13). There is no Kafka topic for `/parties` in §4.4. Options: reinstate discovery capture, accept a defaulted `Cdtr.Nm`, or find another source (none identified). **Not yet decided.**

Closing Gap 1 will not resolve Gap 2 — that needs a scope decision, not a capture.

---

## 9. Deliverables produced

```
docs/Tazama/
├── continue.md                                   ← this file
├── message_ingestion_FSDs/
│   ├── CCH_FSD_MessageIngestion_v1_1.md          (working copy)
│   └── CCH_FSD_MessageIngestion_v1_2.md          ← CANONICAL
└── message mapping/
    ├── 00_background-iso20022-and-tazama.md      (extract of Tazama's article)
    ├── iso20022-and-tazama.md                    (verbatim Tazama source)
    ├── pacs 002-008/
    │   ├── 01_message-relevance.md               7 of 18 messages consumed, and why
    │   ├── 02_design-decisions.md                D1–D10, gaps G1–G6  ← AUTHORITATIVE
    │   ├── 03_pacs008_mapping.md                 field-by-field
    │   ├── 04_pacs002_mapping.md                 field-by-field + error callbacks
    │   ├── 05_worked-example.md                  end-to-end walkthrough
    │   ├── 06_correlation-model-reconciliation.md  §6.4 rewrite record
    │   ├── 07_open-gaps-wire-vs-kafka-and-discovery.md
    │   ├── plan.md / executive plan.md / executive_summary.md
    │   └── samples/  (2 payloads + ajv-check.js + ajv-negative-tests.js)
    └── pain001-013/
        ├── findings.md                           logic.service.ts analysis, Q1–Q6
        ├── 01_pain001_mapping.md                 field-by-field
        ├── 02_pain013_mapping.md                 field-by-field
        ├── executive_summary.md
        └── samples/  (2 payloads + ajv-check.js + ajv-negative-tests.js)
```

### FSD sections rewritten (v1_1 → carried into v1_2)
§3.3 stage table · §4.4 topic labels · §6.1 · §6.3 pipeline (steps 5–7, 9) · **§6.4 fully rewritten** (7 subsections) · **§6.5 fully rewritten** (8 subsections) · **§7 regenerated** with real corridor messages · **§8 rewritten** (domestic flow removed) · §9.1 · §11 · §12 · Annexes A and B.

### v1_2-specific changes
Removed the three unroutable rows from §6.5.2; added pain.001/pain.013 rows; FX stages reclassified as enrichment/correlation with `(none)` output; added §6.5.6 (identifier strategy) and §6.5.7 (`QUOTING` gate + two sourcing constraints).

---

## 10. Corrections made during the session

Recorded because each one was caught by verification rather than review, and the same failure mode could recur.

| Claim | Correction | Caught by |
|---|---|---|
| "The transfer prepare has no payer/payee identity" | It has both, via `extensionList` **and** the decoded ILP packet | User challenge |
| "`swagger.yaml` is the validation gate" | ajv against `src/schemas/*.json`; swagger is stale | Reading `fastify.ts` |
| "`TxSts: COMMITTED` is a hard rejection" | It passes and is stored — worse, because it fails silently downstream | Negative control |
| "DataCache is built from the first message, so pain.001 would poison the amounts" | pain handlers set only 4 id fields; pacs.008 is the sole amount source | User pointing to `logic.service.ts` |
| "`quoteId` → `PmtId.InstrId` on pain.001/013" | pain `PmtId` has only `EndToEndId`; `quoteId` → `PmtInf.PmtInfId` | Negative control |
| Editing v3.0 without being asked | Reverted in full; scope is v1_1/v1_2 only | User instruction |
| Out-of-scope rows rewritten rather than left intact | Restored verbatim, bracketed note appended only | User instruction |

---

## 11. Working conventions established

- **Verify, don't assert.** Every claim traces to a schema, a decoded payload, or a re-runnable validator invocation.
- **Assert both `VALID: true` and `STRIPPED: (nothing)`** — see insight #2.
- **Provenance vocabulary** (from Tazama's own doctrine): `Copied` · `Calculated` · `Inferred` · `Created` · `Defaulted`.
- **Formal documents never reference their own revision history.** No "earlier drafts…", "this revision", "regenerated to replace". State facts directly. Distinctions are properties of the content ("not yet verified against Tazama's live schema"), not comparisons to a prior version. Contradictions *between systems* are legitimate content and stay.
- **Out-of-scope content is left byte-identical**, with at most a bracketed note.
- **v1_2 is the only FSD edited.** Anything outside it gets raised, not edited.

---

## 12. Suggested next steps

1. **Confirm `QUOTING`** on the target Tazama deployment (Open Item #10) — decides whether the pain pair ships now or later.
2. **Request a raw Kafka capture** (Open Item #12) — resolves Gap 1 *and* the pacs.002 trigger question together.
3. **Decide the payee-name question** (Open Item #11) — reinstate discovery capture, or accept a defaulted `Cdtr.Nm` across three message types.
4. **Request a RECEIVE-amount / target-currency capture** — the golden path is SEND-only; Q6 and several ordering assumptions rest on it.
5. **Raise with Tazama:** `swagger.yaml` is stale; `XchgRate` type mismatch (G5); adding `StsRsnInf` to pacs.002 would let rejection reasons reach the rules engine.
6. **Optionally extend §7** of v1_2 with the two validated pain payloads (currently held in `pain001-013/samples/`).

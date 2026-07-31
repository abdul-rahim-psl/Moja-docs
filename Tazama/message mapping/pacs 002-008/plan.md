# Plan — Mojaloop → Tazama ISO 20022 field mapping (pacs.008 / pacs.002)

> ## ⚠️ SUPERSEDED IN PART — read [`02_design-decisions.md`](02_design-decisions.md) first
>
> This plan was written before implementation. Two of its premises turned out to be **wrong**:
>
> 1. **`tms-service/swagger.yaml` is NOT the validator.** TMS validates with **ajv** against `src/schemas/pacs.008.json` / `pacs.002.json`. `swagger.yaml` is stale documentation. Every constraint cited below from the swagger (`TxSts` enum, currency enum, 35-char limits, `MobNb` pattern) **is not enforced**.
> 2. **`TxSts: "COMMITTED"` is not a hard rejection.** It is accepted and stored — which is worse. Translation is still required, for correctness rather than validation.
>
> The plan's *method* held. Its *findings* are corrected in `02_design-decisions.md`, which is authoritative.

**Status:** superseded in part — implementation complete
**Date:** 2026-07-30
**Scope:** rewrite of §6.5 of `CCH_FSD_MessageIngestion_v1_1.md`, limited to the rows whose *ISO 20022 Output (Tazama)* is **pacs.008** or **pacs.002**
**Input flow:** DRPP Golden Path `DRPP-GP-01 Send Money (Source Currency, Multiple FXPs)`, trace `67629f2771f9ca3e58ae98d2b525ff82`

---

## 0. Scope confirmation (one thing to settle before we start)

The brief says "3rd, 4th, 5th and 6th row". Counting data rows in the §6.5 table, the rows whose **output** is pacs.008 or pacs.002 are actually **3, 4, 6 and 7**:

| # | Event Pair (Mojaloop) | Output | In scope? |
|---|---|---|---|
| 1 | pacs.081 + pacs.082 (quotes) | pacs.081 + pacs.082 | no |
| 2 | pacs.091 + pacs.092 (fxQuotes) | pacs.091 + pacs.092 | no |
| **3** | **pacs.008 request + callback** | **pacs.008** | **yes** |
| **4** | **Final-state notification (dedup)** | **pacs.002** | **yes** |
| 5 | pacs.009 request + callback (fxTransfers) | pacs.009 | no — output is pacs.009 |
| **6** | **Final-state notification, FX (dedup)** | **pacs.002** | **yes** |
| **7** | **Any error callback (any resource)** | **pacs.002** | **yes** |

We proceed on the stated rule (output column = pacs.008/pacs.002) → **rows 3, 4, 6, 7**. Row 5 is excluded because its output is pacs.009. Flagging in case row 5 was actually intended and row 7 was not.

Also worth noting up front: the "pacs.081/082/091/092" labels in the current table are **not real ISO 20022 message types**. They are placeholders for Mojaloop's `/quotes` and `/fxQuotes`. Tazama maps quotes to **pain.001 / pain.013** (per `iso20022-and-tazama.md` and the TMS API's four endpoints). Even though rows 1–2 are out of scope, we should note this so the table isn't internally inconsistent.

---

## 1. Ground truth we will map against (pinned)

Everything is verified against source, not against the FSD's prose:

| Source | Path | Pin |
|---|---|---|
| Tazama pacs.008 TS interface | `tazama/frms-coe-lib/src/interfaces/Pacs.008.001.10.ts` | `ee348d3a` (2026-05-12) |
| Tazama pacs.002 TS interface | `tazama/frms-coe-lib/src/interfaces/Pacs.002.001.12.ts` | `ee348d3a` |
| Tazama sample payloads | `tazama/frms-coe-lib/src/tests/data/pacs008.ts`, `pacs002.ts` | `ee348d3a` |
| **TMS validation schema (authoritative)** | `tazama/tms-service/swagger.yaml` → `ISO20022Pacs008`, `ISO20022Pacs002` | `f18317f1` (2026-03-25) |
| Mojaloop golden path | `mojaloop/docs/Sample flow E2E/*.json` (18 messages) | as captured 2025-10-13 |
| Tazama mapping doctrine | `tazama/docs/Knowledge-Articles/iso20022-and-tazama.md` | — |
| TMS ingestion behaviour | `tazama/docs/Product/transaction-monitoring-service-api.md` | — |

**The `swagger.yaml` is the gate.** TMS validates every incoming message against it before Data Preparation runs. A mapping that satisfies the TS interface but violates the swagger will be rejected at the door. Where the two disagree, we map to the swagger and note the divergence.

---

## 2. Findings from the review that shape the approach

These are the things that make this more than a column-to-column exercise. Each becomes a decision or a section in the output.

### 2.1 The Mojaloop bodies are **not** ISO 20022 — the ISO data lives in `extensionList`

Despite `content-type: application/vnd.interoperability.iso20022.transfers+json;version=2.0`, every FSPIOP body in the capture is **FSPIOP-shaped JSON**. The switch's ISO mapping is carried as key/value pairs in `extensionList.extension[]`, e.g. in msg 16:

```
"CdtTrfTxInf.Cdtr.Id.PrvtId.Othr.Id"   : "16665551001"
"CdtTrfTxInf.CdtrAgt.FinInstnId.Othr.Id": "test-zmw-dfsp"
```

and msg 11 additionally carries a complete `originalIso20022QuoteResponse` object.

Two consequences:
- The `extensionList` gives us **Mojaloop's own opinion** of the ISO path for each value. We should use it as corroboration, but **it is not Tazama's shape** — Mojaloop uses `FinInstnId.Othr.Id` where Tazama requires `FinInstnId.ClrSysMmbId.MmbId`, and `IntrBkSttlmAmt.Ccy` + `ActiveCurrencyAndAmount` where Tazama requires `IntrBkSttlmAmt.Amt.Amt` + `.Amt.Ccy`.
- Each mapping row needs a **source-locator** column that distinguishes body field / header / extensionList key, because they are three different extraction paths in code.

### 2.2 The transfer prepare is largely self-sufficient — but only once you decode the ILP packet

Row 3 currently reads "pacs.008 (request) + pacs.008 (callback) → pacs.008". The pairing is wrong (§2.3), but the *request* side is richer than the FSPIOP body suggests. Msg 16 carries identity in **three** layers:

1. **Body:** `transferId`, `payerFsp`, `payeeFsp`, `amount` (ZMW 1), `expiration`, `condition`
2. **`extensionList`:** payee MSISDN `16665551001`, `SchmeNm.Prtry = MSISDN`, `CdtrAgt = test-zmw-dfsp` — already expressed as ISO paths
3. **Decoded `ilpPacket`** — base64url, decodes to a structured transaction object:

```json
{ "quoteId": "01K7EV9X2K4F8J90ZWMRHDNCZN",
  "transactionId": "01K7EV9TNQ1VKX84N0GSQH6MDD",
  "transactionType": { "scenario": "TRANSFER", "initiator": "PAYER", "initiatorType": "BUSINESS" },
  "payee": { "partyIdInfo": { "partyIdType": "MSISDN", "partyIdentifier": "16665551001", "fspId": "test-zmw-dfsp" } },
  "payer": { "partyIdInfo": { "partyIdType": "MSISDN", "partyIdentifier": "16665551002", "fspId": "test-mwk-dfsp" },
             "name": "Display-Test" },
  "expiration": "2025-10-13T13:15:08.384Z",
  "amount": { "amount": "1", "currency": "ZMW" } }
```

So from **msg 16 alone** we get both parties' MSISDNs and fspIds, the payer's display name, `transactionType` (→ `Purp.Cd`), and the `quoteId`↔`transactionId` link. Tazama's `iso20022-and-tazama.md` warns that "the transfers messages do not currently contain any identifying information for either the Payer or the Payee" — that holds for the *bare FSPIOP body*, but not for this ISO-profile capture once the extensionList and ILP packet are read.

What msg 16 genuinely **cannot** supply — the enrichment that still requires cached earlier messages:

| Needed for | Only available in |
|---|---|
| Payee **name** ("Chikondi Banda") | **msg 03** `PUT /parties` — nowhere else in the flow |
| Payer **dateOfBirth** (1984-01-01), complexName (first/middle/last) | **msg 10** `POST /quotes` |
| `ChrgBr` (=`CRED`), `ChrgsInf.Agt`, payee fee | **msg 11** `PUT /quotes` extensionList |
| `RmtInf.Ustrd` source (`note` = "test") | **msg 10** |
| Source amount MWK 60 → `InstdAmt`, `XchgRate` | **msg 06/07** `fxQuotes` (also msg 14) |
| Final status, `completedTimestamp` | **msg 17** `PUT /transfers` |

Row 3 is therefore still a **multi-message accumulation**, but msg 16 is the anchor rather than one of five equal parts. Knock-on for §6.4's correlation design, which we will note but not edit (out of scope).

**Discrepancy to resolve:** the ILP packet says `initiatorType: BUSINESS`; msg 10's body says `initiatorType: CONSUMER` — same transaction. This feeds `Purp.Cd`, so the mapping needs an explicit precedence rule (proposal: prefer the quote body, since the ILP packet is constructed by the payee DFSP and may carry its own defaults). Add as **D8**.

### 2.3 Waiting for the callback destroys the pre-transaction evaluation window

Row 3 pairs the transfer request with its callback before emitting. In the golden path, msg 16 → msg 17 is **~1 second**. If the PPA only emits pacs.008 after the fulfil arrives, Tazama is evaluating a payment that has already settled.

Tazama's own model is the opposite: `pacs.008` = the transfer **request**, `pacs.002` = the transfer **response**. Proposed re-specification:

- **pacs.008** ← emitted on **msg 16** (prepare), enriched from cached msgs 03 + 10 + 11 (+ 06/07 for the FX amounts)
- **pacs.002** ← emitted on **msg 17** (fulfil)

§2.2 strengthens this: because msg 16's decoded ILP packet already yields both parties, both fspIds, the payer display name and the transaction type, the quote-stage cache is **enrichment, not a hard dependency**. A pacs.008 can be assembled at prepare time even if the quote messages were missed (degraded — defaulted payee name and payer DOB), which also makes the design resilient to Mojaloop deployments that skip the quotes process entirely — a scenario Tazama's own docs call out.

This is a substantive correction to rows 3 and 4 and needs sign-off before we write the field tables.

### 2.4 `TxSts` is a closed enum — `COMMITTED` will be rejected

The swagger constrains `TxSts` to:
`ACCC, ACCP, ACFC, ACSC, ACSP, ACTC, ACWC, ACWP, BLCK, CANC, PATC, PDNG, PRES, RCVD, RJCT`

The current doc (§6.5 rows 4 and 6, and the §7.1 sample) maps `transferState`/`conversionState` **straight through** — `"TxSts": "COMMITTED"`. That is a hard validation failure. We need a translation table:

| Mojaloop | Where | Proposed ISO `TxSts` |
|---|---|---|
| `COMMITTED` | transferState, msg 17 | `ACSC` (settlement completed) |
| `RESERVED` | conversionState, msg 15 | `PDNG` or `ACSP` |
| `ABORTED` | transferState | `RJCT` |
| error callback | any | `RJCT` |

Values above are the proposal; each needs to be argued against the ISO definitions, not just asserted.

### 2.5 The two-leg problem — how many Tazama transactions is this?

The flow has two settlement legs: the **FX leg** (MWK 60 → ZMW 1, payer DFSP ↔ FXP) and the **customer leg** (ZMW 1, payer DFSP → payee DFSP). Options:

- **(a) One pacs.008 + one pacs.002 for the whole transaction.** `InstdAmt` = MWK 60 (what the payer was instructed to send), `IntrBkSttlmAmt` = ZMW 1 (what settled), `XchgRate` = 60. The FXP is FX plumbing, not a party to the customer transaction.
- **(b) Two of each, one per leg.** Creates an FXP "entity" and an extra `transactionRelationship` edge in the Tazama graph for every cross-border payment.

**Recommendation: (a).** Tazama's graph model builds entities/accounts/relationships per message (per `transaction-monitoring-service-api.md`); option (b) would inflate counterparty counts and corrupt velocity/typology scoring with synthetic FXP nodes. Option (a) also uses `InstdAmt` / `IntrBkSttlmAmt` / `XchgRate` exactly as the `DataCache` intends them.

Consequence: **row 6 (FX final-state → pacs.002) probably disappears**, folded into row 4. This decision must be made before the field tables are written, because it determines whether row 6 exists at all.

### 2.6 Identifier strategy is the highest-stakes decision

Tazama joins its four-message chain on `PmtId.InstrId` / `PmtId.EndToEndId` (pacs.008) ↔ `OrgnlInstrId` / `OrgnlEndToEndId` (pacs.002). Get this wrong and the pacs.002 never links to its pacs.008, and the DataCache/graph enrichment silently fails.

Candidate ids in the flow: `transferId` = `transactionId` = `01K7EV9TNQ1VKX84N0GSQH6MDD`, `quoteId` = `01K7EV9X2K4F8J90ZWMRHDNCZN`, `conversionRequestId`, `commitRequestId`, `homeTransactionId`.

**Proposal:** `EndToEndId` = `transactionId`/`transferId` (stable across all four Tazama messages including the pain.001/013 pair from quotes); `InstrId` = the per-stage id (`quoteId` for the quote pair, `transferId` for the transfer pair). To be argued explicitly in the mapping doc. Note the current §6.5 maps `transferId → TxId` — **`TxId` does not exist** in Tazama's `PmtId`.

### 2.7 Type and shape traps to catch (each becomes a row-level note)

Verified against `swagger.yaml`:

1. **Amounts are strings in Mojaloop** (`"amount": "60"`), **numbers in Tazama** (`type: number`). Parse + precision/rounding rule needed.
2. **`NbOfTxs` is an integer** in Tazama; Mojaloop's extensionList carries `"GrpHdr.NbOfTxs": "1"` (string). §7.1's sample uses `"1"` — wrong type.
3. **`ChrgsInf` is an object in pacs.008 but an array in pacs.002.** Easy to get wrong.
4. **`ChrgBr` is exactly 4 chars.** Golden path gives `CRED` (msg 11 extensionList); Tazama's sample uses `DEBT`. Take it from Mojaloop, don't hardcode.
5. **`Ccy` is a closed enum** — verified that both **MWK and ZMW are present**. No blocker, but any new corridor currency must be checked.
6. **`BirthDt` / `AccptncDtTm` are `Date` in TS but `format: date` / `date-time` strings in swagger.** Wire format = ISO string. State the convention.
7. **`MsgId`, `InstrId`, `EndToEndId` are maxLength 35.** ULIDs are 26 — fine, but any concatenation scheme (e.g. leg suffixes) must respect the limit.
8. **`InstgAgt` / `InstdAgt` direction reverses** relative to `DbtrAgt` / `CdtrAgt` — on msg 17 the source is `test-zmw-dfsp`. Sourced from `fspiop-source` / `fspiop-destination` **headers**, so the MLA envelope (§5.4) must preserve headers. To verify.
9. **`TxTp` and `TenantId`** are mandatory top-level fields in both TS interfaces but **absent from the swagger body schema**. Need to establish who populates them (PPA vs TMS) — verification item.
10. **Swagger vs TS divergence:** swagger requires only `GrpHdr` under `FIToFICstmrCdtTrf`; the TS interface makes `CdtTrfTxInf`, `RgltryRptg`, `RmtInf`, `SplmtryData` all non-optional. So TMS would *accept* a message that downstream rule processors are typed to reject. **We map to the stricter TS interface** and note it.

### 2.8 The ILP packet is a data source, not a passenger — but the crypto material has nowhere to go

Two different things get conflated in the current §6.5 and §7, and they need opposite treatment:

- **The `ilpPacket`** is **not** opaque. It decodes to the structured transaction object in §2.2 and is one of our richest sources for msg 16. It is **consumed and decomposed** into `Dbtr`, `Cdtr`, `PmtId`, `Purp` etc. — it is never carried across as a blob.
- **`condition` and `fulfilment`** *are* opaque cryptographic material with no financial-crime signal.

`VrfctnOfTerms`, `IlpV4PrepPacket` and `Condition` — used throughout the current §6.5 and §7 — **do not exist** anywhere in Tazama's pacs.008 or pacs.002 (the FSD already flags this; confirmed against both the TS interfaces and the swagger). `SplmtryData.Envlp.Doc` is narrowly typed (`Xprtn` + `InitgPty.Glctn` only) and TMS validates it, so there is no legal home for them.

**Proposal (D5, restated):** decode and consume the ILP packet as a mapping source; **drop** `condition`/`fulfilment` from the Tazama payload and retain them in the PPA audit log only. Extending Tazama's schema to carry them is a change request on Tazama, not a mapping decision. Needs sign-off.

**Implementation note for the field tables:** ILP decoding is `base64url → ILP v4 packet → extract the embedded base64url JSON blob → parse`. It is a real decode step with real failure modes (malformed packet, schema drift), so it needs an error path — a decode failure must not silently produce a pacs.008 with missing parties.

### 2.9 Fields with no Mojaloop source — the defaulting policy

Swagger *requires* these but Mojaloop never supplies them:

| Field | Note |
|---|---|
| `Dbtr`/`Cdtr`/`InitgPty` → `DtAndPlcOfBirth.CityOfBirth`, `.CtryOfBirth` | Tazama's own sample uses `'Unknown'` / `'ZZ'` |
| `Cdtr.Id.PrvtId.DtAndPlcOfBirth.BirthDt` | Payee DOB is **never** in the flow — payer's is (msg 10) |
| `Purp.Cd` | Derive from `transactionType.scenario`/`initiator`/`initiatorType`; Tazama's sample uses `MP2P` |
| `RgltryRptg.Dtls`, `RmtInf.Ustrd`, `SplmtryData` | `RmtInf.Ustrd` can take the quote `note` ("test") |
| `Cdtr.CtctDtls.MobNb` | Derivable from the payee MSISDN |

We adopt **Tazama's own provenance vocabulary** from `iso20022-and-tazama.md` for every row: **Copied / Calculated / Inferred / Created / Defaulted**. This makes the gaps auditable rather than invisible, and matches how Tazama documented their original mapping spreadsheet.

### 2.10 What the golden path cannot tell us

One happy path only: `SEND` / source-currency / single successful FXP / `COMMITTED`. It contains **no error callback**, so **row 7** must be derived from the FSPIOP spec (`errorInformation.errorCode` / `.errorDescription`), not from the sample. Also absent: `RECEIVE` amountType, `ABORTED`, multi-FXP, and target-currency-quoted flows. These become explicitly-stated coverage limitations, not silent assumptions.

---

## 3. Method

### Phase 1 — Source selection (deliverable: `01_message-relevance.md`)
1. Classify all 18 messages by layer. The 8 `outbound_*` messages are the **SDK Scheme Adapter private API** between the payer DFSP's back office and its own SDK — they are *not* on the wire and *not* on the switch's Kafka topics that the MLA subscribes to (FSD §5.2). **They cannot be sources.** State this explicitly; it is the primary selection criterion, and it costs us `homeTransactionId` and the payer identity block in msg 01 (though msg 10 carries the same identity).
2. Produce a relevance matrix: 18 rows × {layer, in/out of scope, which Tazama output it feeds, what unique data it uniquely contributes}. Decode every `ilpPacket` in the flow first — msgs 11 and 16 carry the same packet, and it must be treated as message content, not a blob, before relevance can be judged.
3. Confirm the switch-side assumption against the MLA's actual Kafka topic list in FSD §5.2 — if the MLA taps somewhere else, this conclusion changes.

### Phase 2 — Decisions (deliverable: `02_design-decisions.md`)
Resolve, with rationale, before any field table is written:
- D1 one-transaction vs per-leg (§2.5)
- D2 identifier strategy for `InstrId` / `EndToEndId` (§2.6)
- D3 emit-on-prepare vs emit-on-pair (§2.3)
- D4 `TxSts` translation table (§2.4)
- D5 decode/consume the ILP packet; drop `condition`/`fulfilment` (§2.8)
- D6 defaulting policy for unsourced mandatory fields (§2.9)
- D7 does row 6 survive D1?
- D8 precedence when the ILP packet and the quote body disagree — e.g. `initiatorType` `BUSINESS` vs `CONSUMER` (§2.2)

### Phase 3 — Field tables (deliverables: `03_pacs008_mapping.md`, `04_pacs002_mapping.md`)
Every leaf field of the Tazama schema gets a row — **including fields with no source**, so gaps are visible:

| Tazama ISO path | Type / constraint | Req'd (swagger / TS) | Mojaloop source | Locator | Provenance | Transformation | Golden-path value | Confidence |
|---|---|---|---|---|---|---|---|---|

- *Locator* = `body` / `header` / `extensionList[key]` / **`ilpPacket(decoded)`** / `originalIso20022QuoteResponse`
- *Provenance* = Copied / Calculated / Inferred / Created / Defaulted
- *Confidence* = Verified (in golden path) / Spec-derived / Assumed — needs confirmation
- Driven **top-down from the Tazama schema**, not bottom-up from Mojaloop, so nothing mandatory is missed.

Row 7 (error → pacs.002) is a short separate section, marked spec-derived.

### Phase 4 — Prove it (deliverable: `05_worked-example.md` + `/samples/*.json`)
1. Hand-assemble the **actual** pacs.008 and pacs.002 from the golden path's real values (MWK 60 → ZMW 1, Chikondi Banda, `01K7EV9TNQ1VKX84N0GSQH6MDD`, …).
2. **Validate them programmatically** against `tms-service/swagger.yaml` (`ISO20022Pacs008` / `ISO20022Pacs002`) with a throwaway script. A mapping that passes the real validator is proven, not asserted. Iterate until clean.
3. Also type-check against the TS interfaces (the stricter of the two).

### Phase 5 — Patch the FSD
Rewrite §6.5 rows 3, 4, 6, 7 (and the notes beneath) to match, replacing the "corrected mapping lives in `Mojaloop_Tazama_ConversionMapping_v0_1.md`" pointer — **that document does not exist anywhere in the repo**; the reference is dangling. Point it at this folder instead. Fix §7.1's sample as a knock-on where it contradicts (`FIToFIPmtStsRpt`, `OrgnlTxId`, `ExctnConf`, `PrcgDt`, string `NbOfTxs`, `"TxSts": "COMMITTED"`) — flagging rather than editing if §7 is deemed out of scope.

---

## 4. Deliverables

```
docs/Tazama/message mapping/
├── plan.md                     ← this file
├── 01_message-relevance.md     ← which of the 18 messages we consume, and why
├── 02_design-decisions.md      ← D1–D7 resolved, with rationale
├── 03_pacs008_mapping.md       ← full field-by-field table
├── 04_pacs002_mapping.md       ← full field-by-field table
├── 05_worked-example.md        ← golden-path values end to end
└── samples/
    ├── tazama_pacs008.json     ← schema-validated
    └── tazama_pacs002.json     ← schema-validated
```

Then a patch to `CCH_FSD_MessageIngestion_v1_1.md` §6.5.

---

## 5. Open questions

Blocking Phase 2:
1. **Scope** — rows 3, 4, 6, 7 (the pacs.008/pacs.002 rule), or was row 5 intended? (§0)
2. **D1** — one Tazama transaction per end-to-end payment, or one per settlement leg? (§2.5)
3. **D3** — is pacs.008 emitted on prepare (preserving Tazama's pre-settlement evaluation window), or only after the fulfil pairs? (§2.3)

Non-blocking, to verify while Phase 1 runs:
4. Does the MLA envelope (§5.4) preserve FSPIOP **headers**? `InstgAgt`/`InstdAgt` depend on `fspiop-source`/`fspiop-destination`. (§2.7 #8)
5. Who populates `TxTp` and `TenantId` — the PPA or TMS? (§2.7 #9)
6. Is `DataCache` PPA-supplied or built by TMS Data Preparation? (`transaction-monitoring-service-api.md` says Data Prep builds it — so the PPA should *not* send it.)
7. Which channel does the MLA use for final state — the Central Ledger notification topic, or the transfer-fulfil topic? Both carry the same fact; §6.5 rows 4/6 assume the former, the golden path shows the latter. (§2.3)
8. Is there prior art in `tazama-lf/payment-platform-adapter` (referenced by Tazama's TMS API doc) we should align with rather than diverge from?

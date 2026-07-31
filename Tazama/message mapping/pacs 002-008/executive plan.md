# Executive Summary — Mojaloop → Tazama pacs.008 / pacs.002 mapping

> ## ⚠️ PRE-IMPLEMENTATION — signed off, then partly overtaken by findings
>
> D1, D3 and scope were approved from this document and implementation is complete. Two claims below were **wrong** and are corrected in [`02_design-decisions.md`](02_design-decisions.md):
>
> - The validator is **ajv against `src/schemas/*.json`**, not `swagger.yaml` (stale documentation).
> - `TxSts: "COMMITTED"` **passes** validation rather than being rejected — it is silently stored and then fails downstream rules.
>
> For the outcome, read [`executive_summary.md`](executive_summary.md).

**For sign-off** · 2026-07-30 · detail in [`plan.md`](plan.md)

---

## The ask

Rewrite §6.5 of `CCH_FSD_MessageIngestion_v1_1.md` — the ISO 20022 message-mapping table — for the four rows whose Tazama output is **pacs.008** or **pacs.002**, and back it with a verified field-by-field mapping from the DRPP cross-border golden path.

**We need sign-off on three decisions (D1, D3, and scope) before field-level work starts.** Everything else can proceed in parallel.

---

## Bottom line

§6.5 needs a **rewrite, not a correction**. We reviewed the 18-message golden path against Tazama's actual TS interfaces *and* against `tms-service/swagger.yaml` — the schema TMS validates every inbound message against. Three of the four in-scope rows would **fail validation or produce unusable data** as currently specified:

| Current §6.5 says | Reality | Impact |
|---|---|---|
| `transferState → TxSts` (rows 4, 6) | `TxSts` is a **closed enum**; `COMMITTED` is not a member | **Hard rejection at the TMS door** |
| pacs.008 = transfer request **+ callback** (row 3) | Prepare→fulfil is ~1 second | Tazama evaluates payments that have **already settled** |
| `transferId → PmtId.TxId` | `TxId` **does not exist** in Tazama's `PmtId` | pacs.002 never links to its pacs.008; graph enrichment silently fails |
| ILP packet is opaque, carried in `VrfctnOfTerms` | `VrfctnOfTerms` doesn't exist; the packet is a **primary data source** | Richest identity source in the flow is being discarded |

The good news: the data is nearly all there. The transfer prepare's ILP packet decodes to a structured object carrying both parties' identifiers, both fspIds, the payer's name and the transaction type — so a valid pacs.008 can be assembled **at prepare time**, preserving Tazama's pre-settlement evaluation window.

---

## Decisions requiring sign-off

Recommendations are ours; approving as-is is a valid response.

| # | Decision | Recommendation | Why |
|---|---|---|---|
| **D1** 🔴 | One Tazama transaction per payment, or one per settlement leg? | **One per payment.** `InstdAmt` = MWK 60, `IntrBkSttlmAmt` = ZMW 1, `XchgRate` = 60 | Per-leg injects synthetic FXP entities into Tazama's graph, corrupting counterparty counts and velocity scoring on every cross-border payment |
| **D3** 🔴 | Emit pacs.008 on prepare, or wait for the pair? | **On prepare (msg 16); pacs.002 on fulfil (msg 17)** | Matches Tazama's own request/response model and preserves the ~1s pre-settlement window. Also degrades gracefully where quotes are skipped |
| **Scope** 🔴 | Rows 3, 4, 6, 7 — confirm? | **Proceed with 3, 4, 6, 7** | These are the rows whose *output* is pacs.008/pacs.002. The brief said "3,4,5,6"; row 5's output is pacs.009. Flagging in case row 5 was intended |
| D2 | Which Mojaloop id becomes `InstrId` vs `EndToEndId`? | `EndToEndId` = `transactionId`; `InstrId` = per-stage id | Highest-stakes field pair — Tazama joins its whole 4-message chain on it |
| D4 | `TxSts` translation table | `COMMITTED→ACSC`, `RESERVED→PDNG`, `ABORTED→RJCT`, error→`RJCT` | Enum is closed; each value to be argued against ISO definitions |
| D5 | ILP packet / condition / fulfilment | **Decode and consume** the packet; **drop** condition + fulfilment to audit log | Packet is structured data; condition/fulfilment are opaque crypto with no crime signal and no legal home in the schema |
| D6 | Defaulting policy for mandatory fields Mojaloop never sends (payee DOB, city/country of birth, `Purp.Cd`) | Tazama's own convention — `'Unknown'` / `'ZZ'`, tagged with provenance | Makes gaps auditable rather than invisible |
| D7 | Does row 6 (FX final-state → pacs.002) survive? | **No — folds into row 4** if D1 is approved | Consequence of D1 |
| D8 | ILP packet vs quote body disagree (`initiatorType`: `BUSINESS` vs `CONSUMER`) | Prefer the quote body | Real inconsistency found in the capture; affects `Purp.Cd` |

🔴 = blocking

---

## Approach

Mapping is driven **top-down from the Tazama schema**, so no mandatory field is missed, and every row records where the value came from (`body` / `header` / `extensionList` / decoded `ilpPacket`), its provenance (Copied / Calculated / Inferred / Created / Defaulted — Tazama's own vocabulary), and confidence.

**Proof, not assertion:** we assemble the real pacs.008 and pacs.002 from the golden path's actual values and **validate them programmatically against `tms-service/swagger.yaml`**, iterating until clean. Sign-off is on a mapping the real validator accepts.

All sources pinned: `frms-coe-lib @ ee348d3a`, `tms-service @ f18317f1`.

**Sequence:** Phase 1 source selection → **Phase 2 decisions (gated on D1/D3/scope)** → Phase 3 field tables → Phase 4 schema-validated worked example → Phase 5 patch §6.5. Phase 1 and the non-blocking verifications can start immediately.

---

## Deliverables

```
docs/Tazama/message mapping/
├── 01_message-relevance.md    which of the 18 messages we consume, and why
├── 02_design-decisions.md     D1–D8 resolved, with rationale
├── 03_pacs008_mapping.md      full field-by-field table
├── 04_pacs002_mapping.md      full field-by-field table
├── 05_worked-example.md       golden-path values end to end
└── samples/*.json             schema-validated output
```

Plus a patch to `CCH_FSD_MessageIngestion_v1_1.md` §6.5.

---

## Risks and limits

- **Single happy path.** The capture is one `SEND` / source-currency / successful flow. It contains **no error callback**, so **row 7 will be spec-derived, not sample-verified**. No `RECEIVE`, `ABORTED`, or multi-FXP coverage either. These become stated limitations, not silent assumptions.
- **Dangling reference.** §6.5 points to `Mojaloop_Tazama_ConversionMapping_v0_1.md` as holding the corrected mapping. **That file does not exist anywhere in the repo.** This work replaces it.
- **§7's worked examples contradict §6.5** on the same points (`FIToFIPmtStsRpt`, `OrgnlTxId`, `ExctnConf`, string `NbOfTxs`). Currently out of scope — flag or fix, your call.
- **Swagger and TypeScript disagree** on what's mandatory. TMS would *accept* messages that downstream rule processors are typed to reject. We map to the stricter of the two.
- **Open verifications (non-blocking):** does the MLA envelope preserve FSPIOP headers (`InstgAgt`/`InstdAgt` depend on them)? Who populates `TxTp`/`TenantId`? Should we align with the existing `tazama-lf/payment-platform-adapter` rather than diverge?

---

## Sign-off

- [ ] **Scope** — rows 3, 4, 6, 7 confirmed
- [ ] **D1** — one Tazama transaction per payment
- [ ] **D3** — pacs.008 emitted on prepare
- [ ] D2, D4–D8 — recommendations accepted, or comments below

Any of these can be overridden — they change the field tables, not the approach.

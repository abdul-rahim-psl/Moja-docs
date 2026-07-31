# Correlation-model reconciliation — FSD §6.3/§6.4 vs the mapping docs

Records a review-driven correction to `CCH_FSD_MessageIngestion_v1_1.md` made after this mapping work (`01`–`05`) was already verified. Kept separate from `02_design-decisions.md` because it corrects the **FSD**, not the mapping — the mapping docs were the ones found to be right.

---

## The feedback

A team review of the completed pacs.008/pacs.002 mapping raised a contradiction:

> FSD v3.0 (elsewhere reviewed) defines transfer-stage messages as single-pair correlations only: pacs.008 = PREPARE + FULFIL only; pacs.002 (final-state) = Central Ledger notification alone, "no cache lookup needed." The mapping docs don't follow that — pacs.008 pulls `Dbtr`, `Purp.Cd`, `RmtInf`, `InstdAmt`, `XchgRate`, `ChrgsInf`, `SttlmMtd` from the quote/FX-quote stages; pacs.002 pulls `ChrgsInf` from the quote callback and sources `TxSts`/`AccptncDtTm`/agent fields from the fulfil callback rather than the notification, which needs a cache lookup the FSD says shouldn't be necessary.

**Ask:** reconcile FSD §6.4/§6.5 with the mapping docs before implementation — decide whether transfer-stage messages may enrich from earlier stages, and if so formalize which fields come from where; or pull the mapping docs back to a strict single-pair model.

The review was against a different copy of the FSD (v3.0, in `docs/FSD/msg_ingestion/`). **v1_1 is canonical** — the document this whole workstream works against — so the reconciliation target was v1_1's own §6.3/§6.4, which carried the same pair-only framing.

## Verdict

The feedback was **correct on the substance, overstated on the mechanism**.

**Correct:** the contradiction was real. §6.5 had been rewritten and verified (`03`, `04`) against Tazama's live ajv schemas, but §6.3/§6.4 still described a strict request+callback pairing model, and I had explicitly scoped that mismatch out as "a knock-on we'll note but not edit" when writing §6.5 — the wrong call. The FSD needed to change, not the mapping docs, because the mapping docs are the ones proven against a passing schema-validated sample.

**Overstated:** the claim that a strict-pair pipeline "can't produce a valid pacs.008/pacs.002 (missing required fields like RgltryRptg, Dbtr, ChrgsInf)." It can — `RgltryRptg` is PPA-defaulted either way, `Dbtr` is obtainable from the prepare's decoded ILP packet alone, and `ChrgsInf: []` validates. The real failure mode is worse than "can't produce a valid message": a strict-pair pipeline produces a **schema-valid but silently degraded** one — HTTP 200, a display handle instead of a legal name, a sentinel date of birth, the wrong currency amount, no exchange rate — indistinguishable from a complete message at the TMS door.

## What changed

### `CCH_FSD_MessageIngestion_v1_1.md`

**§6.4, retitled and rewritten** — *Correlation - Matching Request and Callback Events* → *Correlation - Assembling a Complete Message*. Replaced the single pair-correlation model with a **trigger event vs. enrichment event** model, in seven subsections:

| § | Content |
|---|---|
| 6.4.1 | Two kinds of event, and which Mojaloop messages are which for the transfer stage |
| 6.4.2 | What each Mojaloop event carries (retained from the original, with the ILP packet's real richness noted) |
| 6.4.3 | **Cross-stage enrichment, formalized** — the field-to-stage provenance table the feedback asked for, plus a degraded-operation fallback table |
| 6.4.4 | Cache keys and lifetime, including the party-lookup MSISDN-keying exception |
| 6.4.5 | Identifier resolution — why pacs.002 needs a small, bounded lookup even though it isn't a full enrichment read |
| 6.4.6 | Missing events and TTL expiry, split by stage now that pacs.008 fires before the fulfil |
| 6.4.7 | **Open decision** — the pacs.002 trigger source (see below) |

**§6.3 pipeline corrected** — steps 5–6 described "first or second event in the pair… combine the two"; rewritten around trigger/enrichment. Step 7 claimed `NbOfTxs`/`SttlmMtd` are PPA-generated; corrected — they're sourced from Mojaloop, per `03_pacs008_mapping.md`.

**A real bug found in the process:** step 9 said to clear the cached transaction on TMS success. Since pacs.008 now sends before pacs.002, that would delete the state pacs.002 needs to resolve its identifiers (§6.4.5) — a bug the strict-pair model couldn't have surfaced, since under that model there was only ever one send per transaction leg. Corrected: state persists until the terminal message, or TTL expiry.

**Table of contents and cross-references** updated to match the new §6.4 title and subsection numbers.

### `04_pacs002_mapping.md`

Added a warning note under the header identifying the pacs.002 trigger source as an **open decision**, not a settled design choice:

> The FSD names the Central Ledger notification as the final-state trigger; this mapping uses the FSPIOP fulfil callback for an evidential reason, not a design one — the golden path is an FSPIOP wire capture with no Kafka events, so the notification was never available to map from.

## The one thing left genuinely open

The feedback's cache-lookup point had two parts. Only one is resolved:

- **"No cache lookup needed" was wrong regardless of trigger** — ✅ resolved. §6.4.5: `PmtId.EndToEndId` (pacs.008) is the ILP packet's `transactionId`; the final-state event carries `transferId`. FSPIOP models them as distinct fields — identical by coincidence in the golden path, not by guarantee. So the PPA must cache `transferId → {InstrId, EndToEndId}` when it sends the pacs.008, and pacs.002 does a small identifier-only lookup against it, regardless of which event triggers it.
- **Whether the trigger should be the Central Ledger notification instead of the fulfil callback** — ⚠️ still open (§6.4.7). Turns on one question: does the notification carry `fspiop-source`/`fspiop-destination`? `InstgAgt`/`InstdAgt` are required and currently sourced from those headers on the fulfil callback. If the notification carries them too, it's preferable — the authoritative settlement record. If not, the fulfil callback is the only viable trigger. **Needs a Kafka-side capture from CCH to settle**; not answerable from the FSPIOP wire capture this mapping was built from.

## Scope note

The v3.0 copy of the FSD (`docs/FSD/msg_ingestion/CCH_FSD_MessageIngestion_v3.0.md`) was touched during this reconciliation and then **fully reverted** — work is scoped to v1_1 only, per standing instruction. v3.0 still carries the same pair-only §6.4 framing this section corrected; it was not in scope to fix there.

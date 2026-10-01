<!-- SPDX-License-Identifier: Apache-2.0 -->

# Rejected / Error-Path Events — Findings and Implementation Plan <!-- omit in toc -->

**Source:** `/home/abdul-rahim/mojaloop/DRPP_Kafka_E2E_Pack 2/raw_export_500.json/raw_export_500.json` — 500 records, a contiguous ~41–42 record window read from **each of 12 Kafka partitions** of `topic-event-audit` (the widest, most representative slice of the topic captured so far).

**Why this document exists:** `MLA-PPA-Technical-Design.md` §6 and `plan-outline.md` § *Blocked work* both record the same standing gap — *"No error, abort, or rejection captured. All five transactions in `DRPP_Kafka_E2E_Pack` settle successfully... every error-handling row remains built against the specification alone."* This new export changes that. It contains real error-path records. This document states exactly what they show, exactly why the pipeline as built today silently drops every one of them, and a concrete plan to close the gap.

**Summary of Phases A–F, in plain terms — all six are now built and live-verified:**

**Phase A — Stop silently dropping the rejection (MLA).**

*Problem:* A real transfer rejection reuses the same operation tag as a harmless duplicate record, so the MLA was throwing it away identically to normal noise — a real rejection was vanishing before it ever left the MLA.

*Work:* Added a shape-based check (does the body carry a rejection reason?) so the MLA can tell the two apart, and classified the rejection as the payment's final event instead of a routine request.

**Phase B — Give the rejection a proper carrier (Envelope contract).**

*Problem:* Once detected, the rejection reason (code + description) had nowhere clean to travel from the MLA to the PPA.

*Work:* Added an optional `error` field to the shared envelope format (both sides), so the reason is carried explicitly instead of making the PPA re-inspect the raw message.

**Phase C — Turn it into a correct Tazama message (PPA).**

*Problem:* Even if the rejection reached the PPA, it would crash the normal message-builder (which expects a status field this shape doesn't have), and the existing status-translation logic would have quietly mislabeled the rejection as "still pending."

*Work:* Built a dedicated path that produces a proper `pacs.002` message marked "rejected," logs the reason in the audit trail, and skips the normal builder entirely for this case.

**Phase D — Party-lookup rejections (no work needed).**

*Problem:* A separate, smaller rejection type (a failed party lookup) also needed a decision.

*Work:* None required — it was already correctly ignored as out-of-scope by Phase A's change. Confirmed, not built.

**Phase E — Prove it all actually works (Live verification).**

*Problem:* Everything above was only proven in tests, not against the real system.

*Work:* Ran it against a live Tazama server and confirmed the rejection message is accepted and correctly marked, it doesn't interfere with anything sent earlier for that same payment, and the fix holds up even on a much bigger, more realistic batch of data.

**Phase F — Make the third rejection type visible (FX-quote rejections).**

*Problem:* A third rejection type (an FX quote failing very early) has no message to send at all — but it was disappearing with zero record that it ever happened.

*Work:* Added a simple counter so this case is now visibly tracked instead of silently vanishing, even though no message is sent for it.

**Read this alongside:** `MLA-PPA-Technical-Design.md` §2.2a (canonical-record selection), §3.3 (trigger/enrichment classification), §3.5 (message mapping, `toTxSts`), §3.7 (missing/out-of-order events), §6 (open items). Section numbers below refer to that document unless stated otherwise.

- [1. Headline finding](#1-headline-finding)
- [2. What this capture actually contains](#2-what-this-capture-actually-contains)
- [3. What it still does not contain](#3-what-it-still-does-not-contain)
- [4. Why today's code silently drops all three shapes](#4-why-todays-code-silently-drops-all-three-shapes)
- [5. The plan](#5-the-plan)
- [6. Open design questions — need a decision, not an assumption](#6-open-design-questions--need-a-decision-not-an-assumption)
- [7. Fixture and test plan](#7-fixture-and-test-plan)
- [8. Documentation to update once implemented](#8-documentation-to-update-once-implemented)

---

## 1. Headline finding

Real rejection data exists in this capture, but it does **not** look like what the FSD assumed (`errorInformation`/`errorCode`, an FSPIOP `ABORTED`/ISO `RJCT` status string). It looks like a third, distinct shape: a `TxInfAndSts.StsRsnInf` block (`Rsn.Prtry` + `AddtlInf`) with **no status field at all**, delivered on a `PUT .../error` URL. Critically, one of the three occurrences of this shape **reuses an existing `operation` tag value** (`prepareTransfer`) rather than introducing a new one — which means it collides with logic already written to discard that operation's non-canonical half.

**Concretely: the MLA and PPA, as they stand today, silently discard every one of the three rejection shapes found in this file.** Two are discarded correctly by accident (out-of-scope operations). One — a genuine transfer-level rejection — is discarded by a real defect: it is misidentified as the harmless duplicate `egress` record that `isCanonicalRecord` exists to filter out, and is dropped identically to it. No log line distinguishes the two cases today.

---

## 2. What this capture actually contains

Three distinct rejection shapes, none previously seen in `DRPP_Kafka_E2E_Pack`'s five folders:

| # | What rejected | Count | `operation` tag | Detection signal | Identifiers present | Payload shape |
| --- | --- | --- | --- | --- | --- | --- |
| A | **FX quote request** | 19 | *(absent — no `operation` tag at all)* | `httpUrl` ends `/fxQuotes/{id}/error`, `transactionType: "fxquote"` | `transactionId`, `conversionId`, `determiningTransferId` — all directly in tags, no chaining needed | `TxInfAndSts.StsRsnInf.{Rsn.Prtry, AddtlInf}`. No `TxSts`, no `transferState`. |
| B | **Transfer prepare** | 2 | `prepareTransfer` (**same value the successful path uses**) | `httpUrl` ends `/transfers/{id}/error`; `action: "egress"` — a normal duplicate egress has `httpUrl` ending bare `.../transfers`, no id, no `/error` | `transactionId`, `transferId` — directly in tags | Identical shape to row A: `TxInfAndSts.StsRsnInf.{Rsn.Prtry, AddtlInf}`. |
| C | **Party lookup** | 50 | `putPartiesErrorByTypeAndID` | Distinct operation name; `httpPath` ends `/parties/{type}/{id}/error` | None — no `transactionId` anywhere in tags, same as the non-error party-lookup operations | ISO `Assgnmt`/`Rpt.Rsn.Cd` shape, structurally different again from A/B. |

Every occurrence carries `fspiop-source`/`fspiop-destination` and a real `fspiop-signature` — envelope construction has what it needs identifier-wise for rows A and B; row C has neither an anchor nor a use for one, consistent with party lookup already being out of scope by default (§3.3).

**Row B is the one that matters most.** It is a genuine, confirmed **transfer-level rejection** — exactly the case the FSD's `pacs.002`/`TxSts: RJCT` row (§3.3) was written for, and exactly the case both Technical Design §6 and `plan-outline.md` have carried as "unverified, blocked on COMESA" since the project began. Traced end to end for one transaction (`01KZRQ3V28992E9BJQ8PAGHPC0`): `postFxQuotes` → `putFxQuotesByID` → `postQuotes` → `prepareFxTransfer` → `prepareTransfer` (`start`, a normal FSPIOP prepare request — `pacs.008` still fires exactly as designed) → `prepareTransfer` (`egress`, **this time not the harmless duplicate but `PUT /transfers/{id}/error`, reason `4200` / "Payer limit error"**) — and the chain simply ends there. No `fulfilTransfer`, no `notifyFxTransfer`, no `commitTransfer` follow. This `egress` record **is** the transaction's terminal state.

Only three distinct reason codes appear across all 71 error records (`1001` "Destination communication error - Network error" ×19 on FX quotes and ×1 on a party error, `3204` ×49 on party lookups, `4200` "Payer limit error" ×2 on transfer prepares) — enough to prove the shape, not enough to claim broad reason-code coverage.

---

## 3. What it still does not contain

Stated plainly so this file isn't mistaken for closing the whole gap:

- **No FSPIOP-style `errorInformation`/`errorCode` object**, and no ISO `TxSts` value of `RJCT`/`ABORTED` on the wire anywhere. The FSD's assumed error vocabulary (§3.5's `TX_STS_TRANSLATION` table) is not what production actually sends for a rejection — the signal is structural (`StsRsnInf` present, normal fields absent), not a string to translate.
- **No fulfil-side rejection.** Every `fulfilTransfer`/`fulfilFxTransfer` record in this export is a normal, successful record. Whether a transfer can be rejected *after* fulfil (as opposed to at prepare, row B above) is still unconfirmed.
- **No FX-transfer-level rejection** (`prepareFxTransfer`/`reserveFxTransfer` never carry an `/error` URL in this export).
- **Reason-code diversity is minimal** — three codes total, one of which (`4200`) only ever appears twice, both for the same underlying cause. This is enough to validate the mechanism, not enough to claim the mapping is exhaustive.
- **All 19 row-A transactions die before `postQuotes` ever fires** (confirmed by timestamp ordering — FX quote precedes the primary quote in this flow, §2). No `pain.001` is ever built for any of them. This changes what "handling" row A even means — see §6.

None of this blocks building the plan below; it bounds what "done" can honestly claim once it's built.

---

## 4. Why today's code silently drops all three shapes

Traced directly against the shipped code, not inferred:

| Shape | Where it dies | Why |
| --- | --- | --- |
| **Row B (transfer reject) — the real defect** | `mla/src/services/logic.service.ts:92-104` (`CANONICAL_ACTION_BY_OPERATION`) and `:130-131` (`isCanonicalRecord`) | `CANONICAL_ACTION_BY_OPERATION['prepareTransfer'] === 'start'`. The rejection record has `action: 'egress'`. `isCanonicalRecord` returns `false`, `handleMessage` logs it as *"the non-canonical half of a double-written step... not an error"* and silently advances the offset. **A genuine, signed, correctly-addressed rejection is discarded using the exact code path built to discard a harmless duplicate.** No log line anywhere distinguishes the two. |
| **Row A (FX quote reject)** | Same `isCanonicalRecord` check | The record has no `operation` tag at all, so `CANONICAL_ACTION_BY_OPERATION[undefined]` is `undefined`, which never equals `'egress'` — discarded as "non-canonical" for a technically-correct-by-accident reason. |
| **Row C (party lookup reject)** | `EVENT_TYPE_BY_OPERATION` (`mla/src/services/logic.service.ts:106-115`) has no `putPartiesErrorByTypeAndID` entry | Falls through `handleMessage`'s second check (`:422-431`, "canonical for its operation but out of scope") — correctly discarded, but not *deliberately* listed the way `putPartiesByTypeAndID` is (with its own explanatory comment at `:101-103`). |

**And even if row B reached the PPA today**, translation would still fail:

- `asFinalStatePayload` (`ppa/src/services/logic.service.ts:172-183`) does `const txSts = txInfAndSts?.TxSts; if (typeof txSts !== 'string') throw new Error('translate: final-state body is missing TxInfAndSts.TxSts')`. The real rejection body has `TxInfAndSts.StsRsnInf`, never `TxInfAndSts.TxSts` — this throws immediately, every time. Under `processEnvelope`'s pipeline, a translate failure is a permanent defect: logged, not sent, not retried (Architecture Diagrams, node `O1`).
- Even patched past that throw, `toTxSts` (`ppa/src/services/iso20022.ts:46-56`, `TX_STS_TRANSLATION`) is a **value lookup** keyed on strings like `COMMITTED`/`ABORTED`/`COMM`/`RESV`. A rejection with no status string at all falls through to the `?? 'PDNG'` default — producing a `pacs.002` claiming the payment is still **pending**, the opposite of what happened.
- `toPacs002` (`ppa/src/services/iso20022.ts:477-495`) has no field for `StsRsnInf.Rsn.Prtry`/`AddtlInf` — nowhere for the reason code to go, not even into the audit log. (Technical Design §3.5 already documents that Tazama's own schema has no `StsRsnInf` element and the reason must live in the PPA's own audit log only — but no code path currently extracts it into anything.)
- `isDuplicateFinalStateNotification` (`ppa/src/services/logic.service.ts:651-656`) reads `envelope.body.TxInfAndSts?.TxSts` directly for its dedup key. On a rejection body this evaluates to `''` — untested against the monotonicity guard's actual behaviour on an empty string.

---

## 5. The plan

Six phases. A–D are the minimum to stop silently dropping row B and produce a correct `pacs.002`/`RJCT`; E–F are the verification this project's own discipline requires before calling it done; row A and row C are addressed as design decisions in §6, not blind implementation.

### Phase A — MLA: stop discarding the rejection, classify it as what it is

1. **Make canonical-record selection shape-aware, not just operation-name-aware, for `prepareTransfer`.** The cleanest fix that doesn't disturb the existing table for every other operation: before consulting `CANONICAL_ACTION_BY_OPERATION`, check whether an `egress` record's `httpUrl` (or, more robustly, the payload shape — `content.payload.TxInfAndSts?.StsRsnInf` present and `TxSts`/normal transfer fields absent) marks it as an error variant. If so, treat it as canonical **regardless** of what the table says for `prepareTransfer`'s normal case — it is a different logical event wearing the same `operation` tag.
2. **Prefer the structural signal over the URL string.** `httpUrl` is convenient and present on every observed case, but it's a string built by an upstream service — treat it as corroborating evidence, not the primary check, the same caution the codebase already applies to `transactionType` (§2.2a: *"disagrees between the start and egress of the same step and cannot be trusted"*). The presence of `TxInfAndSts.StsRsnInf` combined with the absence of the operation's normal required fields is the more durable signal.
3. **Classify the detected rejection as a new, explicit case** — not folded silently into the existing `TRANSFER`/`request` classification. Introduce a `msgType` (or a boolean flag on the envelope, e.g. `isError: true` plus a structured `error: { code, description }`) so the PPA doesn't have to re-detect the shape itself from the raw body. Recommendation: extend the Event Envelope with an optional `error?: { code: string; description: string }` field, populated by the MLA when it detects this shape, left `undefined` otherwise. This keeps `eventType`/`msgType`'s existing vocabulary untouched and gives the PPA a typed, pre-parsed signal instead of asking it to sniff `TxInfAndSts.StsRsnInf` again downstream.
4. **Add `putPartiesErrorByTypeAndID` to `CANONICAL_ACTION_BY_OPERATION` explicitly**, matching the existing `putPartiesByTypeAndID` entry's own comment style (`:101-103`) — same outcome (skipped, out of scope), but now a deliberate, documented decision rather than an accidental fallthrough.
5. **Anchor resolution needs no new chaining.** Both row A and row B carry `transactionId`/`transferId` directly in tags — `resolveAnchorId`'s existing direct-tag path handles both without touching `quoteIdToAnchor`/`fxTransferIdToAnchor`.

### Phase B — Event Envelope contract change

Add the optional `error` field described above to the envelope schema on **both** sides (`mla/src/interfaces/event-envelope.ts` and `ppa/src/interfaces/event-envelope.ts` — remember these are deliberately two independent copies of the same contract, per Technical Design §2.3's "defined separately... so either side can version its own view"). Update `ppa/src/schemas/event-envelope.json` (the ajv schema every ingress route validates against) to accept the new optional field without requiring it, so this is additive and non-breaking for every existing envelope shape.

### Phase C — PPA: classify, translate, and audit the rejection correctly

1. **`classify()`** (`ppa/src/services/logic.service.ts:79`): a `TRANSFER` envelope carrying `error` should classify as `EventRole.Trigger` — matching the FSD's existing "Any error callback → Trigger → `pacs.002.001.12` (`TxSts: RJCT`)" row (Technical Design §3.3) — but must **not** attempt `asFinalStatePayload`'s normal-shape parsing. Add a dedicated `asRejectedTransferPayload` (or extend `FinalStatePayload` with an optional `error` field) so the presence of `envelope.error` short-circuits straight to a known `TxSts: 'RJCT'` rather than trying to read a `TxSts` string that was never there.
2. **`toTxSts`** stays exactly as it is for every value it already handles — do not add a `StsRsnInf`-keyed row to `TX_STS_TRANSLATION`, since there is no value to key on. The rejection path should call `toPacs002` with an already-resolved `TxSts: 'RJCT'`, bypassing `toTxSts` entirely, the same way the function already treats status translation as "a correctness duty, not a validation one" (§3.5) — the correct duty here is recognising *absence of a status* as the reject signal, not adding a phantom vocabulary entry that will never match real input.
3. **`toPacs002`**: thread the reason through to the one place Technical Design §3.5 already says it belongs — the audit log, not the Tazama message (Tazama's schema has no `StsRsnInf` element, confirmed in the same section). Add an optional parameter (or fold into `FinalStatePayload`) purely so `auditLog`'s existing masked-summary path can record `{ reasonCode, reasonDescription }` for this outcome. No change to the wire message beyond `TxSts: 'RJCT'`.
4. **`isDuplicateFinalStateNotification`**: verify explicitly (test, not assumption) that a dedup key built from `txSts: ''` behaves correctly against the monotonicity guard — specifically, that a genuine reject is never treated as "already a duplicate of nothing," and that a real duplicate of a reject *is* still caught.
5. **Local ajv schema validation** (`tazama-schema.validator.ts`, §3.2 step 7): confirm the pinned `tms-service` `pacs.002.001.12` schema actually accepts `TxSts: "RJCT"` with the placeholder/degraded fields this path will otherwise carry (`ChrgsInf`, `AccptncDtTm`, etc.) — this is exactly the class of gap the pin has already caught twice before (`RgltryRptg`, `SplmtryData`) and should be checked before assuming it, not after.

### Phase D — Row C (party lookup reject)

No pipeline change needed beyond Phase A step 4 above — this stays out of scope by default, consistent with party lookup generally (§3.3, open item C1). Revisit only if/when party-lookup enrichment itself is reinstated.

### Phase E — Live verification, not just unit tests

Following this project's own established discipline (six prior real bugs were all found by running the code, none by unit tests alone — `continue - after Tier 4.md` §5): once Phases A–C compile,

1. Run `demo:replay` (`mla/src/scripts/demo-replay.ts`) against `raw_export_500.json` directly — it already accepts a raw file path (proven against `raw_topic_slice_partition2.json`, Technical Design §7.10). Confirm the transfer-reject record for `01KZRQ3V28992E9BJQ8PAGHPC0` is now dispatched, not skipped, and that its sibling `prepareTransfer`(`start`) still correctly produces a normal `pacs.008` beforehand — the rejection must not suppress the pre-settlement message that already fired.
2. Confirm the resulting `pacs.002` is accepted (`200`) by the real local `tazama-tms-1`, with `TxSts: "RJCT"`, not silently coerced or stripped by TMS's own `removeAdditional: 'all'` behaviour (§3.2 step 7's whole reason for existing).
3. Confirm `GET /admin/audit/<anchor>` shows the reject reason (`4200`/"Payer limit error") recorded against this payment, and that `GET /metrics` gains a distinct counter for this outcome (mirroring the existing `discarded.domestic` / `translation.degraded` pattern in `metrics.service.ts`) rather than being invisible inside a generic "sent" bucket.
4. Because this export spans 12 partitions in one contiguous read — wider than any prior fixture — also use it to re-confirm the anchor-chaining maps (`quoteIdToAnchor`, `fxTransferIdToAnchor`) hold correctly at this scale, the same class of check `partition2-slice.test.ts` did for a single partition (Technical Design §7.10).

### Phase F — Metrics and alerting for the discard cases (Row A)

Even if §6's decision on row A is "log only, no Tazama message" (the recommended default — see below), it should not be a silent discard indistinguishable from a normal skipped record. Add a distinct metric (e.g. `discarded.fxQuoteRejected`) so a reviewer looking at `/metrics` can see these payments existed and died, the same visibility `discarded.domestic` already gives the domestic-transfer discard path (§0.5.4 of the main document).

---

## 6. Open design questions — need a decision, not an assumption

**Q1. What should happen for row A (FX quote rejected before `postQuotes` ever fires)?**
Every row-A transaction in this capture dies before any trigger has fired — no `pain.001` was ever built, so there is nothing in Tazama's graph to terminate with a `pacs.002`. Two honest options:
- **(Recommended) Log and count only, no Tazama message.** Symmetric to how a domestic transfer is discarded before assembly (§0.5.4) — nothing was ever submitted, so nothing needs to be un-submitted. Covered by Phase F's metric.
- **Alternative:** synthesize a minimal audit-only record even though nothing goes to Tazama, for COMESA-side reporting outside this pipeline's scope. Only worth doing if someone downstream actually needs "attempted but never reached Tazama" visibility — confirm before building it.

This capture only shows FX quote failing *before* the primary quote. If a production deployment can have the primary quote succeed first (`pain.001` sent) and *then* the FX quote fail, the correct behaviour is different — a `pacs.002`/`RJCT` genuinely would be needed to close out a payment Tazama already has a `pain.001` for. **Confirm with COMESA/Mojoloop whether this ordering is fixed or coincidental to this test data**, mirroring the same kind of confirmation `plan-outline.md` already tracks for the `start`/`egress` canonical-table stability (§ *Blocked work*, "gates the POC" row 1).

**Q2. Is `httpUrl` ending in `/error` a reliable, permanent discriminator, or an artifact of this test environment's URL scheme?**
Recommendation in Phase A is to treat the payload shape (`StsRsnInf` present, normal fields absent) as primary and the URL as corroborating — the same "table lookup, not payload sniffing, but verified by corroborating evidence" pattern the canonical-record table itself already uses (§2.2a: *"corroborated independently by signature presence... not asserted independently of it"*). Confirm this holds if/when more error captures arrive.

**Q3. Should the envelope carry a structured `error` field (Phase B), or should the PPA re-derive the same signal itself from `body`?**
Recommendation is the structured field — it matches this project's existing philosophy of resolving ambiguity as far upstream as possible (e.g. anchor-identifier resolution living entirely in the MLA, §2.3) rather than making every downstream consumer re-implement the same shape-detection logic.

**Q4. Does `reserveFxTransfer`/`prepareFxTransfer` have an equivalent `/error` variant that just didn't happen to appear in this 500-record window?**
Unknown. Given how directly rows A and B were found by widening the capture window, it's plausible a larger or different window would surface it. Worth explicitly asking for in the next data request, the same way `plan-outline.md` § *Open questions for the COMESA / Mojoloop team* already asks for error-path captures generally.

---

## 7. Fixture and test plan

Following the project's established convention — fixtures are real captures, never hand-written (`continue - after all 4 msgs.md` §7):

1. **Extract a minimal, checked-in fixture** covering exactly the sequence for `01KZRQ3V28992E9BJQ8PAGHPC0` (the full 10-record chain ending in the transfer rejection) into `mla/__tests__/fixtures/`, the same way `01_MWK_to_ZMW_PRIMARY` was curated from the original pack. Do the same for one representative row-A sequence (`postFxQuotes` ×2 + the FX-quote-error record) and, if row C is wired in per Phase A step 4, one `putPartiesErrorByTypeAndID` record.
2. **Also keep `raw_export_500.json` referenceable in full** (alongside `raw_topic_slice_partition2.json`) as a `demo:replay`/`demo:loadtest` input — its 12-partition breadth makes it a better stress case for anchor-chaining and canonical-selection correctness at scale than any single-partition slice.
3. **New unit tests, mirroring the project's existing pattern of one test file per concern:**
   - MLA: `isCanonicalRecord` / classification — a `prepareTransfer`/`egress`/`error`-shaped record is now selected, not skipped; a normal `prepareTransfer`/`egress` duplicate is still correctly skipped (regression guard against re-breaking the happy path while fixing this).
   - PPA: `classify()` routes an `error`-flagged `TRANSFER` envelope to `Trigger`.
   - PPA: the new reject-path payload parser produces `TxSts: 'RJCT'` without touching `toTxSts`'s existing table.
   - PPA: `toPacs002` / `auditLog` — the reason code and description land in the audit entry, never in the outbound Tazama message.
   - PPA: `isDuplicateFinalStateNotification` against an empty-string `txSts` — confirm the monotonicity guard's behaviour explicitly rather than leaving it implicit.
4. **Live-verify per Phase E** before calling any of the above done — consistent with every other piece of this project's build history.

---

## 8. Documentation to update once implemented

Once Phases A–D are built and Phase E's live verification passes, update — do not leave this plan as the only record:

- **`MLA-PPA-Technical-Design.md`**: §2.2a's canonical-record table (add the row-B error variant and its detection rule), §3.3's classification table (mark the error-callback row as built and verified, not spec-only), §3.5 (document the actual on-the-wire shape — `StsRsnInf`, not `errorInformation`/`TxSts` — replacing the assumption), §6 (move the "no error, abort, or rejection captured" open item to resolved, with the caveats from §3 of this document carried over rather than dropped), §7 (add a new §7.x live-validation entry in the same style as §7.1–§7.13).
- **`plan-outline.md`**: § *Blocked work* → move this item from "still open" to closed, with the same honesty this project has applied to every other closed item (state what was proven, and restate §3's residual gaps — no fulfil-side reject, minimal reason-code diversity — rather than overclaiming). § *Capture analysis* → add `raw_export_500.json` alongside the existing capture-pack description (§ *How this pack differs*, per its existing table format). § *Open questions for the COMESA / Mojoloop team* → resolve the error-path question, add Q1/Q4 from §6 above as the new open questions.
- **The newest `continue/` handoff doc**: a fresh one at whatever milestone this work closes at, following the project's own rule of writing a new handoff at a real milestone rather than patching an old one that says "Tier 4 was the last tier."

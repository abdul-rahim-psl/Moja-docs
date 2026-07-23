# Review: CCH-PL-FSD-MSGING-001 v1.0 (cover) / "v1.1" (footer) — Message Ingestion FSD

**Reviewed against:** `docs/FSD/CCH_FSD_MessageIngestion_v3.0.md` (Behjet Ansari, Paysys Labs).

**Method:** Read the FSD section by section, then cross-checked every factual claim — Kafka topic names, payload encoding, correlation keys, ISO 20022 field mappings, TMS behaviour — against this repo's own live-verified investigation: `docs/Kafka/kafka-topics-quote-transfer.md`, `docs/ppa/ppa-progress.md`, `ppa-prototype/` (a working consumer actually run against `ml-core-test-harness` and a real Tazama TMS instance), and the `docs/user stories/cchfrms-33` / `cchfrms-38` / `party identifier` investigation trail. Where the document conflicts with something this repo has actually run and captured, that's noted explicitly; where it's consistent, that's also noted, since a critical review that only lists problems is as misleading as one that lists none.

This is the second review in this repo (see `review-fsd.md`, written against v2.0). Most of that review's findings are **fixed** in this version — noted below, not re-litigated at length.

---

## Headline: this document is a major, evidenced improvement over v2.0

Nine of the ten findings and the version-history footnotes in the prior review are addressed directly, several by name:

- Finding #1 (Kafka topic model): §4.4 now gives the correct per-action topic list, matches `docs/Kafka/kafka-topics-quote-transfer.md` table-for-table, and even keeps a superset (bulk-quote/admin) explicitly out of scope rather than silently dropping it.
- Finding #2 (base64 vs. plain JSON split): now §4.6, correctly separated from encryption, matches the live-confirmed behaviour in `kafka-topics-quote-transfer.md`'s "Transfer message envelope" section almost verbatim.
- Finding #3 (`topic-notification-event` fan-out): §4.1, §4.3, §6.3 step 3, §6.4 now name a dedicated Notification Filter/Dedup component and an idempotency key (`transferId` + state). This is the right shape of fix — see open concern below on ownership.
- Finding #8 (central-ledger missing from context/glossary): fixed — central-ledger is now in the glossary, the context diagram (§3.2), the component table (§4.1), and is explicitly credited as the notification producer with a corrective footnote in §3.3.
- Finding #10 (PPA error table wrongly claiming Kafka-offset ownership): fixed — §6.7's ValKey-down row is now phrased as "Events queue in Kafka... Kafka offset is not committed," consistent with MLA owning the offset (§4.3's failure-isolation section is explicit about this boundary).
- Finding #6 (`PARTY` eventType gap): resolved by scope reduction, not by fixing the omission — §11 now excludes party/discovery capture entirely, so the inconsistency is moot rather than patched.
- Finding #9 (throughput/concurrency question): substantively engaged — §9 is a new, honest section that states assumptions as TBC rather than leaving them unstated, and §9.4 explicitly raises per-partition consumer sizing.

This version also does something the prior one didn't: it self-corrects against the actual Tazama target schema (§6.5's note on `Pacs.008.001.10.ts`/`Pacs.002.001.12.ts`) and flags its own sample messages as conceptual/illustrative pending that correction. That's a stronger scientific posture than most FSDs at this stage — worth calling out as a strength, not just noting in passing.

The remaining findings below are concentrated in three places: (1) claims that go further than what's actually been verified in this repo, (2) one place where the document's own internal correction is followed inconsistently, and (3) a structural gap — the single most consequential integration finding in this repo's history (the customer/account identity problem) has no visible trace in this FSD at all.

---

## Critical Findings

### 1. The document doesn't mention the customer/account identity gap — the single biggest finding in this repo's own PPA work

This is the most significant gap between the FSD and the established knowledge base. `docs/user stories/cchfrms-38/fspiop-to-iso20022-gaps.md` (Gap 1) and `docs/ppa/party identifier/` document, at length, that:

- A Mojaloop **transfer** message (`pacs.008`/`pacs.009` request or callback) carries only **FSP-level** identifiers (`payerFsp`/`payeeFsp`) — never customer name, date of birth, or account number.
- Real party/account identity (`PartyIdInfo` — MSISDN, ACCOUNT_ID, or IBAN — plus name and date of birth) exists **one stage earlier**, on the **quote** message, and is lost by the time a transfer event fires.
- This was assessed as "the single biggest known gap in the integration" (`executive-summary.md`) precisely because Tazama's fraud/AML rules that reason about *who* is transacting have nothing but bank-level identifiers to work with unless this is fixed.
- A fix ("Option A": cache quote party data keyed by `transactionId`/`quoteId`, join it to the matching transfer by the shared id) was **designed, built, and tested** (46 passing test cases) against real captured traffic, and is sitting in `ppa-prototype/src/tazama/enrichment.js` right now.

The FSD's §6.5 mapping table and §7 worked examples map `payer`/`payee` identity as if it flows straight from the quote pair into the ISO output (`payer/payee → Dbtr/Cdtr`), which is only true for the **quote-side** `pacs.081`/`pacs.082` message. It says nothing about the fact that the **transfer-side** `pacs.008` output (§7.1's own worked example) has no source data for `Dbtr`/`Cdtr`/`DbtrAcct`/`CdtrAcct` name/DOB/account fields at all — its own sample payload only ever populates `DbtrAgt`/`CdtrAgt` (participant-level), never party-level fields, silently sidestepping the gap rather than naming it.

§10.3 (Data Protection) discusses tokenizing/encrypting "party names, MSISDNs, account/party identifiers" as if they routinely flow through the pipeline on the transfer side — but per this repo's own investigation, on the transfer topics they **don't exist at all** unless the quote-to-transfer join described above is built. As written, §10.3 could mislead an implementer into thinking the transfer-side PPA already receives this PII and just needs to protect it, when the real prerequisite is a not-yet-specified enrichment step to make that data available in the first place.

**Recommend:** add an explicit subsection (probably in §6, alongside §6.4/§6.5) documenting that transfer-stage messages carry no customer/account identity, that the quote stage does, and — since this repo already has a working, tested design for exactly this join — either adopt it by reference or make an explicit decision to exclude customer-identity enrichment from Phase 1 scope (which would in turn simplify §10.3's PII discussion, since there'd be materially less PII in the transfer-side pipeline than a first read suggests).

### 2. §6.5's corrected target-schema note is right, but the rest of the document isn't updated to match — internal inconsistency

§6.5's footnote (added in this version) is a strong, specific correction: it names exact wrong-vs-right field paths against the real `Pacs.008.001.10.ts`/`Pacs.002.001.12.ts` interfaces (e.g. `IntrBkSttlmAmt.Ccy`/`.value` should be `.Amt.Amt`/`.Amt.Ccy`; `VrfctnOfTerms`/`IlpV4PrepPacket`/`Condition` don't exist in the real interface at all; `FIToFIPmtStsRpt` should be `FIToFIPmtSts`). This matches exactly what `ppa-prototype/docs/fields.md` and `cchfrms-38-plan.md`'s field-mapping table found by testing against a live TMS.

But §7's worked examples — the ones a reader is most likely to copy as a template — still use the **uncorrected** shapes the footnote just said were wrong: `IntrBkSttlmAmt: { Ccy, value }` (§7.1, should be `Amt.Amt`/`Amt.Ccy`), `VrfctnOfTerms.IlpV4PrepPacket`/`Condition` (§7.1 and §7.2, don't exist in the real interface per the same footnote), and `FIToFIPmtStsRpt` (§7.1's pacs.002 sample, should be `FIToFIPmtSts`). The footnote itself says as much ("This table and §7's samples remain conceptual/illustrative only until updated") — so this isn't an oversight so much as a flagged, deliberate gap. Still, it's a document that will be read by implementers who skim; recommend either watermarking §7's JSON blocks themselves (not just the prose above them) as "illustrative — do not implement against this shape," or holding v3.0 until §7 is corrected, since a reviewer or implementer skimming straight to the worked examples (the most concrete, most copy-pasteable part of the document) will get the wrong schema.

This repo's own evidence goes further than the footnote does: `cchfrms-38-plan.md`'s field-mapping table (sourced from testing against `tazama-lf/tms-service`'s actual AJV schemas) additionally found that **`ilpPacket`/`condition`/`fulfilment` have nowhere to go at all** in the pacs.008.001.10/pacs.002.001.12 schema versions TMS actually validates against — not just a wrong field path, but no field, full stop (`fspiop-to-iso20022-gaps.md` Gap 3). The FSD's §6.5 footnote says `VrfctnOfTerms`/`IlpV4PrepPacket`/`Condition` "don't exist anywhere in the real interface" and that "there's no field currently mapped to carry the ILP packet at all" — which is consistent with this finding — but doesn't go on to say this is a genuine schema-version ceiling (would require TMS to validate against a newer pacs.008/pacs.002 version to ever carry this data), not just a mapping-table typo to fix. Worth folding in, since it changes the recommended fix from "correct the table" to "raise with Tazama whether the schema version can be upgraded."

### 3. Notification Filter/Dedup ownership is still unresolved, and it's on the pipeline's critical path

§4.1 lists Notification Filter/Dedup as **New** with an open ownership question (MLA-side vs. PPA-side), and §12 Open Item #7 tracks it. This is honestly flagged, not hidden — good. But it's worth being more pointed about the cost of leaving it open: per this repo's own measurement (`kafka-topics-quote-transfer.md`, "Message counts observed"), `topic-notification-event` fired **37 times in one golden-path run versus 8 each on prepare/fulfil** — roughly 4-5x the volume of the other transfer topics. Without this component built and correctly scoped, the PPA's §6.3 step 3 dedup logic has no upstream filter to rely on and would need to absorb that entire multiplier itself, which changes both the sizing assumptions in §9 (a component whose input volume is itself unconfirmed) and the pipeline's actual failure surface (§4.3 already flags this as a "drop vs. pass-through" decision with no default chosen). Recommend Open Item #7 carry an explicit note of the ~4-5x multiplier as the quantified stake, so it doesn't read as a low-priority naming/ownership question when it's actually gating both a correctness property (no duplicate pacs.002s reaching TMS) and a sizing input.

### 4. FX transfer topic names (`topic-fx-transfer-*`) are marked open, correctly — but so is the FX quote/transfer flow's realism more broadly, understated

§4.4 and Open Item #9 correctly flag that FX transfer topic names haven't been confirmed. That's honest. But it's worth being explicit that **no part of the FX flow — quote or transfer — has been exercised live** anywhere in this repo's knowledge base. `ppa-progress.md`'s "Unknowns/Assumptions" section states plainly: "FX quote/transfer, bulk quote/transfer, and error-path (`errorInformation`) message shapes were not observed live in this run... only inferred from code." The FSD's §7.2 worked example for `pacs.009` is presented with the same concreteness (full sample JSON, "Resulting Tazama ISO 20022 output") as §7.1's domestic example, which **was** captured from live traffic — a reader has no way to tell from the document alone that one is empirically grounded and the other is invented from the spec, not run. Recommend explicitly labeling §7.2 (and any other FX-derived content) as un-verified/theoretical, distinct from §7.1's live-verified status, so the difference in confidence is visible where the content lives, not just in Open Items.

---

## Significant Findings

### 5. §4.4's note that FX transfer topics "follow the same per-action pattern" is stated as fact, not inferred

§4.4: "FX transfer topics (`topic-fx-transfer-*` equivalents) follow the same per-action pattern and remain to be confirmed for Phase 1 scope." The phrasing implies the *naming pattern* is confirmed and only the *exact names* are open — but per `kafka-topics-quote-transfer.md`, the FX **quote** topics (`topic-fx-quotes-post`/`-put`) were confirmed live against a running broker; the FX **transfer** topics were not observed at all, live or in code (`ml-api-adapter`'s config, per that same doc, only shows `topic-transfer-{prepare,fulfil,get}` — no FX transfer topics are visible in the file list that document worked from). The "follows the same pattern" claim is a reasonable inference from Mojaloop's naming convention, but it's presented with the same confidence as topics that were actually confirmed live two sentences earlier in the same section. Recommend distinguishing "confirmed live" from "inferred by convention, not yet observed" language-for-language in §4.4, not just at the Open Items level.

### 6. §9's performance numbers are appropriately marked TBC, but the one number that could be grounded today isn't cross-checked against this repo's own measurements

§9.1 defers sustained TPS to CCH (reasonable — that's a business input this repo can't supply). But §9.2's latency budget (Kafka publish → MLA consume < 100ms, MLA→PPA POST+ack < 100ms, etc.) and the "up to 4 messages/transaction (P2P domestic)" / "up to 6 (cross-border)" figures in §9.1 are structural claims, not business ones — and this repo has directly relevant counter-evidence for the first: `topic-notification-event` alone produced 37 messages against 8 each on the other topics in one run (Finding #3 above). That doesn't invalidate the "up to 4/6 messages per transaction" figures (those are almost certainly counting logical ISO messages sent to TMS, not raw Kafka messages consumed), but the document doesn't distinguish "messages sent to Tazama" from "Kafka messages MLA must consume and de-duplicate," and the latter number is meaningfully higher for the notification path specifically. Worth a one-line clarification in §9.1 so the TPS-sizing conversation at the JAD workshop (Open Item #3) isn't implicitly assuming MLA's Kafka-side consumption volume equals PPA's TMS-side send volume.

### 7. §4.6 and Annex B are correct on the encoding split, but Annex B doesn't carry forward the "why" that makes it easy to get wrong later

Annex B correctly notes `pacs.008` (transfer request) "arrives as a base64-encoded `data:` URI, decode before use (§4.6)" — good, matches `kafka-topics-quote-transfer.md` exactly, including the specific `data:application/vnd.interoperability.transfers+json;version=2.0;base64,...` URI shape that document captured live. One thing worth pulling forward from that source document that the FSD doesn't mention: the **fulfil-side** payload (`pacs.008` callback / `topic-transfer-fulfil`) carries **no `transferId` in its decoded payload at all** — only `completedTimestamp`, `transferState`, `fulfilment` (confirmed in `ppa-prototype/docs/fields.md` and the "party identifier" detailed design, §2). The FSD's §6.4 correlation table implies the callback event is keyed the same way as the request (`transferId` for transfers, listed as the shared cache key), but per live capture, the *callback message body itself* doesn't carry that id — the PPA can only recover it from the **envelope's** `id` field (populated by the MLA from context, not from the fulfil payload). This is a subtle but real distinction for anyone implementing the correlation logic from §6.4 alone: the envelope, not the body, is the only source of the join key on the fulfil side. Worth a one-line clarification in §6.4 or Annex B.

---

## Minor / Hygiene

- **Version metadata is still inconsistent, the same class of issue flagged in the v2.0 review.** The cover table says "Version: v1.0," the Version History table's only row is "v1.0," but the running footer says "v1.1" and the Kafka-topic-model note in §4.4 and the ISO-mapping footnote in §6.5 both describe corrections that read like they belong to a second pass over an existing v1.0 (not a from-scratch v1.0). If this is meant to be the v1.1 the footer claims, the Version History table is missing its own second row (what changed between v1.0 and v1.1) — the exact same category of gap the prior review's "Minor/Hygiene" section flagged for v2.0's date mismatch. Recommend reconciling before this goes out for review, since a reviewer's first move is often to check what changed since last time, and right now that answer isn't in the document itself.
- **§3.3's footnote about the final-state notification is good practice, worth replicating elsewhere.** The inline correction ("corrected from the prior version of this document") is a useful pattern for a document under active revision — but it's only used once. §4.4's topic-model correction and §6.5's schema correction describe similarly significant corrections without the same explicit "this changed from the prior version, here's why" framing. Applying it consistently would make the document easier for a reviewer who's tracking it across versions (exactly the exercise this review is doing).
- **§9's "External reference" benchmark (~1,000 TPS) is a reasonable sanity-check figure but has no citation.** Given the rest of the document is careful to cite sources (`ml-schema-transformer-lib`, the ISO 20022 Market Practice Document, both footnoted), this uncited figure stands out. If it's from Mojoloop Foundation published benchmarking, worth a footnote for consistency with the document's own citation standard.

---

## What's Handled Well

- The self-correcting posture — flagging the prior version's topic-model error, the prior version's wrong notification-producer attribution, and now the wrong target-ISO-schema shapes — is a real strength. Most FSDs don't audit their own prior claims against implementation reality this explicitly.
- §4.3 (Failure Isolation Boundaries) is a genuinely useful new section — the PPA ack-before-durability gap it names (event has "no way back" if PPA crashes after acking but before completing the pipeline) is a real, well-reasoned architectural risk, correctly distinguished from the ValKey hard-stop case right below it.
- §9 as a whole is a good-faith attempt to give TTL/sizing/backpressure decisions a starting point in the absence of a formal NFR document, rather than leaving performance entirely unaddressed until one exists.
- The base64-vs-decryption split in §4.6 is exactly right and matches this repo's independent finding precisely — including the detail that quote payloads don't need this step at all.
- §7's worked examples for the domestic P2P case, modulo Finding #2's schema-shape issue, are a good format — before/after JSON plus a prose walkthrough is more useful to an implementer than the field-mapping table alone, and this repo's own `ppa-prototype/docs/fields.md` independently arrived at the same "annotate every field with its real source" approach.

---

## Open Items — Cross-Check Against What's Already Known

Of the 9 items in §12:

- **#1 (cache TTL), #3 (TPS), #4 (hosting), #6 (timeout values)** are business/ops inputs this repo's investigation can't resolve — correctly left open.
- **#2 (JWS enabled on DRPP?)** — genuinely unknown from this repo's evidence; the local test harness doesn't demonstrate JWS enforcement either way.
- **#5 (COMESA-specific extension fields)** — correctly still open; as the prior review noted, the captured payloads in this repo are from a generic test harness, not COMESA's actual deployment, so this repo's evidence can't close this item.
- **#7 (notification dedup ownership)** — see Finding #3 above: still open, but should carry the ~4-5x volume-multiplier finding as a concrete stake, not just an ownership question.
- **#8 (real corridor sample messages)** — correctly open; also worth noting this repo's samples, while real captured Kafka traffic, are from a generic Mojaloop test harness (`ml-core-test-harness`), not a COMESA-specific deployment — the same caveat the prior review raised for extension fields applies here too.
- **#9 (FX topic names)** — correctly open; see Finding #4 for the broader point that the entire FX flow, not just its topic names, is unverified.
- **Missing from this list but should be added:** the customer/account identity gap (Finding #1) isn't tracked as an Open Item at all, despite being the most consequential unresolved question in this repo's own PPA investigation. If Phase 1 is meant to exclude customer-identity enrichment, that should be an explicit scope decision in §11, not an absence.

---

## Suggested Questions for the JAD Workshop

1. Is customer/account-level identity (from the quote stage) required for Tazama's fraud rules to be meaningful on the transfer-side messages, or is amount/velocity/status sufficient for Phase 1? This determines whether the quote→transfer enrichment join (already designed and tested in this repo — `docs/ppa/party identifier/`) should be adopted, and it isn't currently an Open Item at all (Finding #1).
2. Given `topic-notification-event`'s ~4-5x volume multiplier relative to the other transfer topics, does the Notification Filter/Dedup component (§4.1, Open Item #7) sit MLA-side (filtering before the multiplier reaches PPA) or PPA-side (absorbing it directly)? This affects both the ownership question already asked and the TPS sizing conversation in Open Item #3.
3. Is TMS's schema version (`pacs.008.001.10`/`pacs.002.001.12`) fixed for this integration, or could it be upgraded to a version that has somewhere to carry `ilpPacket`/`condition`/`fulfilment`? Per this repo's investigation, the current version structurally cannot carry ILP proof-of-transfer data at all (Finding #2) — if that data ever matters to a fraud rule, this is a hard ceiling, not a mapping-table fix.
4. Should §7's worked examples be corrected to match §6.5's already-identified real target schema before this document is circulated further, given they're the most likely part of the document to be used as an implementation template as-is?

---

## References Used for Grounding

- `docs/Kafka/kafka-topics-quote-transfer.md` — live-verified Kafka topic names, partition counts, payload shapes (quote vs. transfer encoding), message-volume counts including the `topic-notification-event` multiplier.
- `docs/ppa/ppa-progress.md` — plain-language status of the PPA prototype, confirmed-vs-assumed breakdown.
- `ppa-prototype/docs/fields.md`, `ppa-prototype/docs/how does it work.md` — field-by-field real-vs-placeholder breakdown of the actual pacs.008/pacs.002 messages sent to a live TMS, and the prototype's internal processing flow.
- `docs/user stories/cchfrms-38/cchfrms-38-plan.md`, `docs/user stories/cchfrms-38/fspiop-to-iso20022-gaps.md` — field-mapping gap analysis verified against TMS's actual AJV schemas (not just the upstream mapping doc), including the schema-version ceiling on ILP data.
- `docs/ppa/party identifier/executive-summary.md`, `detailed-design.md`, `real account numbers.md` — the customer/account identity gap: root cause, verified correlation key, implemented and tested fix ("Option A" quote→transfer join).
- `docs/FSD/review-fsd.md` — this repo's prior review, against v2.0, used to confirm which findings this version fixed and which remain.

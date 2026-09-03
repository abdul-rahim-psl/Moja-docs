# US-MLA-03 — Decode Base64-Encoded Transfer Payloads: Executive Summary

**Epic:** EPIC-1 — Kafka Subscription & Audit-Topic Ingestion
**Status:** complete — exit criterion met live, recorded in `plan.md` §16
**Date:** 2026-09-02/03

---

## What this story set out to achieve

Resolve every classified record (US-MLA-02's output) to the actual FSPIOP body PPA's downstream field mappings need, and give the pipeline its last skip reason: a record that cannot be read at all — not a decode failure, since D6 removes the decode step this story's own title describes. This is also where the whole Phase 2 pipeline's boundary parse lives: the point where a raw Kafka message value first becomes a typed record or a named, distinct reason it could not.

The story's own title and Acceptance Criteria describe a mandatory base64 `data:`-URI decode. **D6** (`plan.md` §3.1) replaces that with selecting whichever field already carries the FSPIOP form. Correcting `story.md` to match is the Business Analyst's action, already communicated — this work builds against `plan.md` §3.1's decision, not the superseded story text.

## The reasoning behind the decisions that were not obvious

**One fallback expression, `transformedPayload ?? payload`, is correct for every event type without ever branching on `eventType` — because the two record families disagree about which field holds which form, not about whether a fallback is needed.** Quote-family records carry Mojaloop's own ISO 20022 form in `content.payload` and the FSPIOP form in `content.transformedPayload`; transfer-family records carry the FSPIOP form directly in `content.payload` and have no `transformedPayload` at all. Decoding `content.dataUri` instead — the story's literal instruction — would yield *Mojaloop's* ISO 20022 (`IntrBkSttlmAmt.ActiveCurrencyAndAmount`, `FinInstnId.Othr.Id`), not the FSPIOP shapes every downstream PPA field-mapping table sources from; following the story and the PPA field tables both literally would have been internally inconsistent. `dataUri` is present on only 46 of 500 records in any case — D6 treats decoding it as available-on-demand, not built now, since nothing in this pipeline names a concrete need for it yet.

**Returning `undefined`, not `{}`, for a missing body is a deliberate divergence from the POC itself, made because the POC's own choice hides exactly the failure this pipeline needs to see.** An empty object silently forwards as "success with nothing in it"; `undefined` is what lets the pipeline distinguish a genuinely empty envelope from a canonical, classified record with nothing to send — a case never observed in any capture to date, but one this design makes visible rather than silently swallowed if it ever occurs.

**The boundary parse checks exactly the fields every later stage already dereferences unguarded, and no more.** `parseAuditRecord`'s structural shape check — `metadata.event.action` present and one of `start`/`egress`, `metadata.trace.tags` present as an object — exists because a record missing `metadata.trace.tags`, for instance, is valid JSON that would otherwise crash three layers downstream with a raw `TypeError`, not surface as a clean "unreadable" outcome at the one point it should be caught. Fields nothing downstream yet reads (`content.headers`, `id`, `type`) are deliberately not validated here — that would be checking something for Phase 3's benefit before Phase 3 exists to need it.

## What was proven live, versus assumed

`live`, through the same two full pipeline runs as US-MLA-01/02 (`plan.md` §5's exit-criterion section): every one of the 500 records fed across both runs produced a defined outcome with no unhandled exception, and every forwarded record carried a correctly-selected, non-empty body — the defensive "canonical, classified, no body" path has never been hit in any real capture, matching `plan.md` §1.1's own observation that every canonical record carries one. The parser's success and failure paths are verified directly against real captures and deliberately malformed inputs, including the exact corruption shape `capture-feeder --corrupt` produces — a pure boundary-parse function, so no broker interaction applies to it on its own (engineering-rules.md §10.3).

## What was deliberately left out

No `data:`-URI decode implementation — D6 treats it as available-on-demand; nothing downstream names a concrete need for it, so building it now would be exactly the speculative abstraction `engineering-rules.md` §4 rules out. No validation of fields Phase 3 will need (`fspiop-source`/`-destination`, envelope `id` material) — those belong to US-MLA-04's own boundary check when that story exists to need them.

## What this exposed that outlives it

**A test failure is sometimes the fastest way to discover a fixture assumption was wrong, not a sign the code is wrong.** An early version of this story's tests assumed `prepareFxTransfer` carries `ilpPacket` the way `prepareTransfer` does; it does not — `ilpPacket` is TRANSFER-only. The test failed on its first run, not on inspection, and the fix was to parameterize the expected hallmark field per operation rather than assume both event types share one. Left as a reminder that a failing test written *before* the implementation is trusted is doing exactly its job.

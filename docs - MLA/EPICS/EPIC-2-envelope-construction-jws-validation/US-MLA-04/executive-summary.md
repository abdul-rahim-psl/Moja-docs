# US-MLA-04 — Construct a Standard Event Envelope: Executive Summary

**Epic:** EPIC-2 — Envelope Construction & JWS Validation
**Status:** complete — exit criterion met live, recorded in `plan.md` §16
**Date:** 2026-09-03

---

## What this story set out to achieve

Turn Phase 2's own output — a resolved `eventType` and a selected FSPIOP-form `body`, nothing more — into the real `EventEnvelope` PPA is meant to receive: `msgType`, `id`, `correlationId`, `fspiop-source`/`-destination`, `body`, `timestamp`, and D7's `error` field, assembled from the classified record itself, with a completeness check that fails closed rather than forwarding a partial envelope. This is the first story in the whole project whose output is something PPA can actually be handed.

The story's own acceptance criteria assume the `id` scheme is already known. It was not, going in — D3 (`plan.md` §3.1) was the one fork of the seven still open when this story started, and it gated envelope construction directly: `EventEnvelope.id` cannot be assigned a real value without knowing which scheme it follows. This story built against the recommended default (Option A, per-`eventType`) while that cross-team conversation was pending, kept visibly provisional in code and docs throughout, and closed once D3 was resolved with PPA's owners during this same phase — Option A, final. See "The reasoning" below for what that scheme actually required once built.

## The reasoning behind the decisions that were not obvious

**D3's resolution reduced this story's scope rather than adding to it.** The per-`eventType` scheme needs no cross-record chaining state — every canonical record already carries its own stage-local identifier directly in tags (`plan.md` §3.2 verified this with zero exceptions across all 500 captured records before this story started). The POC's alternative (a single leg-wide anchor, forced onto every stage of a payment) exists *only* because the POC promoted that anchor to `id` in the first place, which is what required its two in-process chaining maps and their associated bugs. Choosing Option A meant this story never had to write that state at all, not that it had to be removed later.

**One exception in the tag-availability evidence surfaced only while writing the extraction code, not while reading the table.** `plan.md` §3.2's own count for `putFxQuotesByID` — "14 of 28, exactly the start count" — reads as "present on the canonical `start` record." Checked directly against every real pair in `raw_export_500.json`, the opposite is true: the tag sits on the discarded `egress` half, and the canonical `start` half carries none at all. The fix is not a special case bolted onto the extraction logic — it's the same signal the classification table's own "Resource path" column already names: the id is recoverable from the trailing segment of `tags.httpPath`, confirmed to equal the sibling `egress` record's tag for all 14 pairs, zero exceptions. `plan.md` §3.2 is corrected to carry this footnote rather than leaving the gap for the next reader to rediscover.

**`content.headers` and `tags` were quietly typed as always-present before this story, which is exactly the kind of lie `audit-record.interface.ts`'s own existing comment on `operation` warns against.** This story's own acceptance criteria require detecting a genuinely missing `fspiop-source`/`fspiop-destination` — a check that `Record<string, string>` makes untypeable, because the compiler treats every lookup as guaranteed to succeed. Both types were widened to admit `undefined` (and the specific tags this story reads — `httpMethod`, `httpPath`, and the four id fields — named explicitly, matching the existing `operation?` pattern) so the completeness check is honestly type-checked rather than relying on a runtime check TypeScript itself would otherwise flag as impossible.

**`msgType` is derived from `tags.httpMethod` directly, not from a new lookup table keyed on `operation`.** `operation` already carries two responsibilities (D1's canonical selection, D2's classification); a third table on the same field for `msgType` would be state derived from state, when a direct, unambiguous signal already exists — confirmed present and unambiguous (never mixed case within one record) on all 116 canonical records checked.

## What was proven live, versus assumed

The full exit criterion (`plan.md` §6), against a real Redpanda broker and a real `ppa-stub`, not a mock. All 41 records of the partition-2 slice, fed unmodified through a real, running MLA instance, produced a defined outcome with zero unhandled exceptions — including, for the first time, envelope construction actually running rather than stopping at Phase 2's boundary. Separately, a locally re-signed record produced a real `EventEnvelope` via the actual `buildEnvelopeFromKafkaValue` pipeline (not a hand-built test fixture), which was then POSTed over genuine mTLS to a live `ppa-stub` and accepted — HTTP `200`, `{"status":"accepted"}`, confirmed byte-for-byte in `ppa-stub`'s own `received.jsonl`. This is a stronger claim than "the schema validates it in-process": a second, independent implementation of the same schema (`ppa-stub/validator.ts`) accepted it too.

## What was deliberately left out

No delivery to PPA as MLA's own production behaviour — the mTLS POST proven above was a one-shot verification call built for this story's own exit criterion, not the retry/circuit-breaker/offset-gated client US-MLA-06/07 will build in Phase 5. No envelope versioning (R-23) — still unaddressed, exactly as the story's own Assumptions section says. No speculative base64 `dataUri` decode path — D6 already settled that as available-on-demand, not built, and this story had no concrete need to revisit it.

## What this exposed that outlives it

**A tag-availability table verified by counting occurrences, without checking which half of a double-written record carried them, can still hide a real gap.** `plan.md` §3.2's aggregate count for `putFxQuotesByID` was numerically correct and substantively misleading — it matched "the start count" by coincidence of arithmetic (14 starts, 14 tagged egress records), not because the tag was actually on the starts. The lesson generalises past this one operation: an aggregate count over a double-written topic is not the same claim as "present on the record a downstream stage will actually select," and this codebase's own D1 canonical-selection logic is precisely the kind of stage that count needs to be checked against, not just totalled.

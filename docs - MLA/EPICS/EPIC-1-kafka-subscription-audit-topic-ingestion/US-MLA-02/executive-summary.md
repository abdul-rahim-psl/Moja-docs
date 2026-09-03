# US-MLA-02 — Distinguish Event Types Within the Audit Topic Stream: Executive Summary

**Epic:** EPIC-1 — Kafka Subscription & Audit-Topic Ingestion
**Status:** complete — exit criterion met live, recorded in `plan.md` §16
**Date:** 2026-09-02/03

---

## What this story set out to achieve

Resolve every canonical record (US-MLA-01's output) to exactly one of QUOTE, FXQUOTE, TRANSFER, FXTRANSFER, or an explicitly-named skip — party-lookup (out of scope) or unclassifiable (a genuine gap, worth an operator's attention). This story is also where two of the seven cross-cutting decisions the whole build depends on get resolved in code: **D2** (what signal classification reads) and **D5** (which record is the TRANSFER leg's terminal trigger).

## The reasoning behind the decisions that were not obvious

**`operation` alone, not method+resource with an `operation` fallback, because method+resource cannot make the one distinction D1's table needs.** The story's own Assumptions section proposes method+resource as primary, with `operation` as corroboration. But `fulfilFxTransfer` (start-only, canonical) and `reserveFxTransfer` (egress-only, canonical) are both `PUT /fxTransfers/{id}` — indistinguishable by method+resource alone, and distinguishing exactly this pair is what D1's canonical-selection table exists to do one step upstream. Building classification's primary signal on a basis that can't make that distinction would have meant the two decisions disagreeing with each other by construction.

**The `commitTransfer` double-row ambiguity that looked like an unresolved conflict in `cross-reference.md` §3.2 is resolved by what the tag actually says, not by picking a side.** The classification table's own two rows both mention `commitTransfer` — once as TRANSFER's terminal leg (**D5**), once as FXTRANSFER's commit leg. Reading the real captures directly settles it: FXTRANSFER's commit leg's genuine `operation` tag is `notifyFxTransfer`, never `commitTransfer`. And `notifyFxTransfer` is already non-canonical under D1, so it never reaches this function's table lookup at all, regardless of which side of the ambiguity someone might have guessed. This is verified directly in the test suite, not just argued in a comment.

**FX-quote rejection detection has to run *before* canonical selection, and the code says so at its own source, not only here.** A rejected FX quote carries no `operation` tag at all — the field D1's table keys on. Checking canonical selection first would make every one of the 19 real FX-quote-rejection records silently read as an ordinary non-canonical skip, indistinguishable in the logs from a harmless duplicate egress record — exactly the ambiguity `rejected-events.md` §6 Q1 says must not happen. `isFxQuoteRejection` therefore has to be checked first, and `canonical-record.service.ts`'s own module comment states that ordering requirement at the point a future caller would otherwise get it wrong.

## What was proven live, versus assumed

`live`, through the same two full pipeline runs as US-MLA-01 and US-MLA-03 (`plan.md` §5's exit-criterion section) as well as directly against real captures for the classification and rejection predicates themselves (pure functions, so no broker interaction applies to them per engineering-rules.md §10.3). Across the two live runs: every classified record landed in the correct bucket with zero misclassifications — 15 forwarded across all four event types in the 41-record run, 121 forwarded across all four event types plus 19 FX-quote-rejections correctly counted distinctly in the full 500-record run — and zero `unclassifiable` hits in any real capture encountered to date.

## What was deliberately left out

No fallback to method+resource at all, even as corroboration — D2 settles on `operation` alone; adding an unused corroboration path now would be speculative machinery with nothing exercising it. No handling for a rejected transfer *fulfil* or a rejected FX transfer — neither has ever been captured, so every branch for them would be specification-only, and building branches with no evidence behind them is exactly what `engineering-rules.md` §4 rules out.

## What this exposed that outlives it

**A table that looks ambiguous on paper can be provably unambiguous once you check what the wire actually says — and it's worth writing the test that proves it, not just the comment that asserts it.** The `commitTransfer` double-row was flagged as an open question in `cross-reference.md`; resolving it took one grep against real capture data, and the resulting test (`notifyFxTransfer` classifies correctly, and a synthetic `commitTransfer`-tagged FXTRANSFER-shaped record is never reached because D1 already excluded it) is what keeps the resolution honest rather than assumed.

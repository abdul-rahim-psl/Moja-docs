# EPIC-1 — Kafka Subscription & Audit-Topic Ingestion: Executive Summary

**Phase:** 2 (`plan.md` §5)
**Status:** complete — exit criterion met live, recorded in `plan.md` §16
**Date:** 2026-09-02/03

---

## What this epic delivered, as a whole

Its three stories — US-MLA-01 (subscribe, filter, select canonical records), US-MLA-02 (classify event type, detect FX-quote rejections), US-MLA-03 (select the payload, handle unreadable records) — are documented individually in their own folders. This document covers what only exists once all three are assembled: a single, real, live-verified ingestion pipeline. Each story's own file register lists the service it owns; this one lists the files that wire those three services into one handler and prove the assembly works end to end.

## The purpose

**To turn three independently-tested pure functions into one running consumer that can be pointed at a real broker and trusted with real payment events, and to prove that trust live rather than assume it follows automatically from the parts being individually correct.**

`src/services/ingestion.service.ts`'s `processRecord` is the pipeline in one function, top to bottom: parse → FX-quote-rejection check → canonical selection → classification → payload selection → forwarded or a named skip reason. The ordering is load-bearing, not stylistic, and both constraints that make it so are documented at their own source rather than only in this summary — FX-quote rejection must run before canonical selection (it has no `operation` tag and would otherwise silently read as an ordinary skip), and classification must run after canonical selection (it assumes a record has already been selected as the one to act on). `src/services/ingestion-consumer.service.ts`'s `createIngestionHandler` is the thin I/O wrapper around that pure decision: log the outcome, distinctly per reason, then advance the offset unconditionally — this phase's own scope, not the system's final rule (Phase 5's N1, "commit only on PPA HTTP 200", governs once delivery exists to retry or pause for).

## The reasoning behind the decisions that were not obvious

**The offset advances unconditionally here, forwarded or skipped alike, and that is stated as this phase's own scope rather than a preview of the final behaviour.** Nothing in Phase 2 yet has a reason to hold a record back — there is no dispatch to retry or pause for, because Phase 5 (delivery) does not exist yet. `createIngestionHandler`'s own signature is exactly where this changes: Phase 5 replaces the unconditional `advance` with the retry/pause state machine US-MLA-07 requires.

**`SkipReason` is a five-way named union, not a bare `undefined`, because the entire discriminated-union discipline this pipeline follows exists to make every one of those five reasons individually visible in the logs and, eventually, in metrics (Phase 6).** Collapsing `unreadable`, `fx-quote-rejected`, `egress`, `party-lookup` and `unclassifiable` into one bare skip would have made the exact failure class that hurt the POC twice — a record silently stops being forwarded and nothing errors — possible again, one layer up from where each individual service already avoids it.

**A structural invariant, discovered while writing the integration tests rather than designed in advance: nothing canonical can ever fail classification.** `CANONICAL_ACTION_BY_OPERATION`'s operations are a strict subset of `EVENT_TYPE_BY_OPERATION` ∪ `PARTY_LOOKUP_OPERATIONS` — so `'unclassifiable'` is structurally unreachable through `processRecord` on any input the canonical-selection stage has already accepted. Two tests were initially written as if a canonical record could classify as `'unclassifiable'`; both were wrong, caught by writing the case out and checking it against the actual tables rather than assuming a five-way union needs five reachable examples. The corrected tests instead prove the invariant directly (one via the real pipeline, showing `'egress'` where a wrong assumption expected `'unclassifiable'`; one via `jest.spyOn` on `processRecord` itself, so the consumer wrapper's own defensive switch-case still gets direct coverage for a path the real pipeline cannot currently produce).

## What was proven live, versus assumed

Every claim in this epic's three `plan.md` §16 entries was exercised against a real, running Redpanda, not asserted from the design. The full assembled handler — the real built service, `node build/index.js`, not a test harness standing in for it — consumed the 41-record partition-2 slice under a fresh consumer group with every one of the 41 accounted for (23 `egress`, 3 `party-lookup`, 15 forwarded across all four event types), then was `kill -SIGKILL`'d and restarted under the identical group with zero reprocessing of already-advanced records. That proof was then strengthened: a second run fed the full 500-record export with one partition deliberately held back, and the MLA was killed while `capture-feeder` was still genuinely, provably mid-feed — the restarted instance picked up exactly and only the one partition with anything still outstanding, with zero duplication and zero loss across the combined 500-record tally. A decision-level golden file (`tools/golden/run-ingestion-golden.ts`) now checks `processRecord`'s own output against a checked-in baseline independently of any broker, and its recorded tally for the partition-2 slice matches the live handler run number for number — cross-confirmation that the golden target itself is trustworthy. Full numbers for all of the above: `plan.md` §5's exit-criterion section.

## What was deliberately left out

No envelope construction, no JWS validation, no PPA client — `processRecord` stops exactly where Phase 2 stops: at a selected payload and a resolved `eventType`, ready for Phase 3. No delivery-outcome-aware offset handling — every record's offset advances the same way regardless of outcome, because nothing downstream exists yet whose failure would need it held back. No dedicated alert channel — an `unreadable` outcome logs at `error` level as the honest interim equivalent of "log, alert" until Phase 6 builds one; this is not claimed as a wired alert.

## What this exposed that outlives it

**A restart proof and a *mid-feed* restart proof are genuinely different claims, and only one of them is what the exit criterion's own wording asks for.** The first live-verification run killed the MLA only after the feeder had already finished producing — valid, but not literally "mid-feed." Re-running with `--delay-partition` to hold one partition back long enough to guarantee the feeder's own log had not yet reported completion at kill time turned an adequate proof into an exact one, and did so more cheaply than it might sound: no new tooling was needed, only a scenario flag `capture-feeder` already had, used for a purpose slightly different from the one it was originally built for (deterministic out-of-order arrival, not deliberately-extended in-flight state).

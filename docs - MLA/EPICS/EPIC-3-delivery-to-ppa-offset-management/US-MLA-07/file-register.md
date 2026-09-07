# US-MLA-07 — File Register

Shared integration files (`ingestion-consumer.service.ts`'s own delivery-gate call site, `src/index.ts`'s wiring, `PpaConfig`'s retry/breaker/reprobe fields) are listed once, at the epic level — `EPICS/EPIC-3-delivery-to-ppa-offset-management/file-register.md` — rather than repeated here. `retry-backoff.service.ts` (`computeBackoffMs`) already existed, built for gate item #1 (`plan.md` §7.1 #1); this story reuses it unchanged and is not listed again below.

| File | Why it was added / what it does |
| --- | --- |
| `src/services/circuit-breaker.service.ts` | `CircuitBreaker` — a pure, generic consecutive-failure state machine (`recordFailure`/`recordSuccess`, `FailureTransition`/`SuccessTransition`), generalized out of what was previously the PII-only `PiiCircuitBreaker` (on inspection, zero PII-specific logic existed inside the class itself). Now the shared primitive both the PII secret's process-wide instance and this story's own per-partition wrapper are built on. |
| `src/services/ppa-circuit-breaker.service.ts` | `PpaCircuitBreaker` — one independent `CircuitBreaker` instance per partition, created lazily the first time a partition is seen and never evicted (the topic's own partition count is small and fixed). Deliberately not process-wide, unlike the PII secret's breaker — see this story's own executive summary for the full reasoning. |
| `__tests__/circuit-breaker.service.test.ts` | 7 tests on the shared primitive (renamed from `pii-circuit-breaker.service.test.ts`, `PiiCircuitBreaker` → `CircuitBreaker` throughout, behaviour unchanged): does not trip below threshold, trips exactly once at threshold, stays tripped without re-reporting, a threshold of 1 trips immediately, `recordSuccess` resets and reports `justRecovered` only when it had actually tripped, a reset breaker needs a full new run to trip again. |
| `__tests__/ppa-circuit-breaker.service.test.ts` | 4 tests specific to the per-partition wrapper: two partitions counted independently (one tripping never affects the other), a partition-scoped counter created lazily starting at zero, `recordSuccess` resetting only the given partition, and `recordSuccess` on a never-seen partition being a no-op rather than an error. |

## The retry/park/breaker mechanism itself

Lives inside `ingestion-consumer.service.ts` (epic-level file, full description there) rather than its own module — `runPpaRetryBurst` (the blocking retry sequence), `isPpaTransient` (the three-way transient/permanent/success classifier), `logPpaPermanentRejection` (the 4xx full-envelope log), `describePpaFailure` and `parkAndReprobePpa` (the park/reprobe cycle) are all this story's own additions to that file, alongside US-MLA-06's own delivery-gate call site.

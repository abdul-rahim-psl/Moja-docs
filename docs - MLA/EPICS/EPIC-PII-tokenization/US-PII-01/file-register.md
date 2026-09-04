# US-PII-01 — File Register

Shared integration files (`envelope-pipeline.service.ts`'s wiring, `ingestion-consumer.service.ts`'s further extension) are listed once, at the epic level — `EPICS/EPIC-PII-tokenization/file-register.md` — rather than repeated here. Files owned jointly with US-PII-02 (the secret client, the readiness coupling) are listed in that story's own register.

| File | Why it was added / what it does |
| --- | --- |
| `src/services/tokenization.service.ts` | `tokenizeBody` and the field-classification table (`TOKENIZE_PATHS_BY_EVENT_TYPE`) this story's own AC names — QUOTE (three paths), FXQUOTE (two, "where present"), no row for TRANSFER/FXTRANSFER. The path-walking mechanism (`getAtPath`/`setAtPath`) that lets the table stay data, not a `switch`. |
| `__tests__/tokenization.service.test.ts` | 20 tests: every QUOTE/FXQUOTE field in the table, the payee-legal-name exclusion, the amount-never-touched regression per event type, determinism, no caller-body mutation, the secret-unavailable path, and TRANSFER/FXTRANSFER never consulting the secret store at all. 100%/95.65%/100%/100% own coverage. |

## Gate item #1 (fail-mode reclassification, `plan.md` §7.1 #1)

| File | Why it was added / what it does |
| --- | --- |
| `src/services/retry-backoff.service.ts` | `computeBackoffMs` — full-jitter exponential backoff for the retry burst: a value drawn uniformly under a 1×/2×/4× ceiling per attempt, matching the story's "exponential backoff (1s/2s/4s) plus genuinely random jitter" AC. `random` is an injected parameter (default `Math.random`) so the genuinely-random property is testable deterministically. |
| `__tests__/retry-backoff.service.test.ts` | 7 tests: the ceiling arithmetic per attempt, linear scaling with an injected `random`, the default-to-`Math.random` path, and the specific `engineering-rules.md` §7 standard — 20 real samples asserted non-uniform, not merely "a delay occurred." 100%/100%/100%/100% own coverage. |
| `src/services/pii-circuit-breaker.service.ts` | `PiiCircuitBreaker` — a single, process-wide consecutive-failure counter (`recordFailure`/`recordSuccess`, each returning the transition so the caller decides what to log, not this class). Deliberately not per-partition — see the file's own comment for why a shared counter is the correct model for this specific failure domain. |
| `__tests__/pii-circuit-breaker.service.test.ts` | 7 tests: trips exactly at threshold, `justTripped` fires exactly once per run and never repeats on further failures, `recordSuccess` resets and reports `justRecovered` only when the breaker had actually tripped, a reset breaker needs a full new run to trip again. 100%/100%/100%/100% own coverage. |

## Live-verification tooling

| File | Why it was added / what it does |
| --- | --- |
| `tools/verify-tokenization/run.ts` (+ `npm run verify:tokenization`) | This story's own live exit-criterion tool (`plan.md` §7), checked in rather than a one-off manual step (`engineering-rules.md` §11). Runs the real, composed `buildEnvelopeFromKafkaValue` against real capture records through the real client classes `npm run dev` itself uses, then POSTs the resulting envelope over real mTLS to a running `ppa-stub` — proving tokens, determinism across independent runs, a clear amount, and an untouched TRANSFER body, all against something genuinely running, not a mock. |

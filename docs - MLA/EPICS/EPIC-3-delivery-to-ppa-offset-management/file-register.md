# EPIC-3 — File Register

The files that assemble the epic's two stories into one live pipeline. Each story's own file register (`US-MLA-06/`, `US-MLA-07/`) lists the service files it owns individually.

## The assembled pipeline

| File | Why it was added / what it does |
| --- | --- |
| `src/services/ingestion-consumer.service.ts` | `createIngestionHandler`'s own three-way classification of a `forwarded` outcome's PPA delivery: `success` advances (US-MLA-06); a still-transient result is retried in place via `runPpaRetryBurst`, and on exhaustion handed to `parkAndReprobePpa` — parking the event, pausing the partition, feeding the per-partition `PpaCircuitBreaker` (US-MLA-07); a `client-error` (4xx) is logged in full via `logPpaPermanentRejection` and advances immediately, never retried, never pausing (US-MLA-07). `logTripIfJust` was generalized to take its own message string so the PII secret's process-wide breaker and PPA's per-partition one can share one escalation-logging function while wording the alert differently (one names no partition, since it affects all equally; the other names the specific partition that tripped). |
| `src/index.ts` | Builds `HttpsPpaClient` and `PpaCircuitBreaker` at the composition root and injects both into `createIngestionHandler`, alongside the renamed `CircuitBreaker` (formerly `PiiCircuitBreaker`) for the PII secret's own process-wide instance. |
| `src/interfaces/config.interface.ts`, `src/services/config.service.ts`, `.env`/`.env.template` | `PpaConfig` gains `circuitBreakerThreshold` (`PPA_CIRCUIT_BREAKER_THRESHOLD`, default 5, `plan.md` §8.1 #2's decided default) alongside its already-present `timeoutMs`/`maxRetries`/`retryBaseMs`/`reprobeIntervalMs` fields — the last four existed from scaffolding but were unused by any real mechanism until this epic wired them in. |
| `__tests__/ingestion-consumer.service.test.ts` | Extended substantially: the PPA delivery gate (success advances, client-error logs the full envelope and advances, four transient outcomes park with the reason preserved in the alert), the retry burst (jitter-backed retries, a retry turning permanent stopping the burst immediately, a client-error never retried from the first attempt), and a dedicated park/reprobe/breaker suite mirroring the PII secret's own (a parked event recovering as a success, recovering as a client-error — the PPA-specific three-way reprobe resolution, a failed offset-advance-on-recovery retried on the next tick, an unhandled exception inside a reprobe caught without stopping the loop, the breaker trip logged exactly once, and two partitions' own breakers proven independent). 36 tests in this file alone; 306 across the full suite, 100%/98.01%/100%/100% aggregate. |
| `__tests__/config.service.test.ts` | Extended: `PPA_CIRCUIT_BREAKER_THRESHOLD`'s default and override, alongside the pre-existing PPA fields' own coverage. |

## Live-verification tooling

| File | Why it was added / what it does |
| --- | --- |
| `tools/ppa-stub/routes.ts`, `state.ts`, `types.ts` | Unchanged by this epic — Phase 1's own fault-injection control plane (`POST /control {mode, afterN, forMs}`, modes `ok`/`503`/`500`/`4xx`/`timeout`/`flaky`) was already exactly what this epic's own live verification needed: no new stub capability had to be built to prove any of US-MLA-06/07's acceptance criteria. |
| `tools/ppa-stub/scripts/generate-certs.sh` | Unchanged — the same local CA/server/client cert generation used since Phase 1; this epic's TLS-handshake-failure proof used a separate, genuinely unrelated throwaway CA generated ad hoc for that one live run, not a checked-in artefact. |

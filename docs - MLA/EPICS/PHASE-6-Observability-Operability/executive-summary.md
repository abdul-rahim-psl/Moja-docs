# Phase 6 — Observability and Operability: Executive Summary

**Phase:** 6 (`docs - MLA/plan.md` §9)
**Implements:** MLA's own share of `cch-crosscutting-user-stories.md` — US-MON-01 (monitoring), and the MLA-side clause of US-PERF-01 (ack-latency instrumentation, not the load-test budget itself)
**Status:** complete — exit criterion met live, recorded in `docs - MLA/plan.md` §16 (US-MON-01, US-PERF-01)
**Date:** 2026-09-08

---

## What this phase is, and why it carries no `story.md`

Like Phase 0 and Phase 1 (harness), this phase implements no single numbered MLA/PII story and carries no `story.md`. It exists because `cch-crosscutting-user-stories.md` — the fifth source document, added [2026-09-07] — is not yet split into `EPICS/` per-story the way `cch-mla-user-stories.md`/`cch-pii-user-stories.md` are (`strategy.md` §2.4). What this phase builds against is `plan.md` §9's own four-item checklist, itself derived from US-MON-01's seven acceptance criteria and US-PERF-01's own literal ack-latency definition, both reproduced in `core-knowledge.md` §9/§11/§13.2 and `engineering-rules.md` §9.

## The purpose

**To make every operator question `engineering-rules.md` §9 names answerable from telemetry alone, and to turn every "alert raised" comment written across Phases 2–5 into a claim that is actually true.**

Four concrete aims, all now met:

1. **Structured logging** — `correlationId`, `eventType`, and a granular pipeline step on every line, not folded into message text.
2. **Metrics for every operator question** — throughput, drops (deliberate and not), degradation, back-pressure, stuck state, and budget, each as a real Prometheus series.
3. **A metric for every decision the code makes silently** — no dropped/degraded/skipped path without a counter, regardless of log level.
4. **Alert paths for the five named conditions** — missing/invalid signature, a PPA 4xx, retry exhaustion, a breaker trip, a PII tokenization failure — each genuinely raised, not just logged.

## What was built

Items 1–3 were built and live-verified earlier in this phase (2026-09-08, same day); this document's own new contribution is item 4 and the phase's exit criterion:

- **`src/interfaces/alert.interface.ts`** — the `Alert` port. Five named methods (`raiseSecurityAlert`, `raiseRejectionAlert`, `raiseRetryExhaustionAlert`, `raiseBreakerTripAlert`, `raiseTokenizationFailureAlert`), mirroring `Logger`/`Metrics`'s own established shape rather than a generic `raise(type, severity, message)` dispatch — each method's severity is fixed by the method itself, not left to a caller to get right.
- **`src/clients/alert.client.ts`** — `WebhookAlertClient`, the port's only implementation and the sole importer of `fetch` for this purpose. Two sinks: the metrics-based one (`Metrics.incrementAlert`, always active) and an optional webhook (`AlertConfig.webhookUrl`, fire-and-forget, `AbortController`-bounded, never throwing into the pipeline on delivery failure).
- **`src/services/ingestion-outcome-logging.service.ts`** — a new sibling module to `ingestion-consumer.service.ts`, holding the "how a resolved outcome is logged, metered and alerted" leaf dispatch (`logIngestionSkip`, `logEnvelopeSkip`, `logPpaPermanentRejection`, `describePpaFailure`, `logTripIfJust`, `logResolvedOutcome`, the `LogDeps` type) that this item's own wiring pushed past ESLint's `max-lines` gate on the original file. A pure relocation — the retry/park/breaker orchestration that decides an outcome in the first place stays in `ingestion-consumer.service.ts`.
- **`AlertConfig`** (`src/interfaces/config.interface.ts`, loaded in `src/services/config.service.ts`) — `webhookUrl` (optional, unset by default) and `webhookTimeoutMs`. `ALERT_WEBHOOK_URL`/`ALERT_WEBHOOK_TIMEOUT_MS` in `.env.template`.
- **`mla_alerts_total{type,severity}`** (`src/clients/metrics.client.ts`) — the new counter every `Alert.raise*` call increments, the metrics-based sink's own concrete series.
- Five call sites wired in `src/services/ingestion-outcome-logging.service.ts` and `src/services/ingestion-consumer.service.ts`: the two signature-failure cases in `logEnvelopeSkip`, `logPpaPermanentRejection`, the two initial-park log lines (PII and PPA), and `logTripIfJust`'s own `justTripped` gate (called from both breakers' burst and reprobe paths) — plus the tokenization-failure call site inline in `createIngestionHandler`'s own `attemptAndRecord`.

`docs - MLA/EPICS/PHASE-6-Observability-Operability/file-register.md` lists every file this phase added or changed, across all four checklist items.

## The reasoning behind the decisions that were not obvious

**Two sinks, deliberately, not one.** R-37 (alerting destination/routing) was, and remains, genuinely undecided with CCH — the destination (PagerDuty/Slack/email) and the routing mechanism (e.g. Grafana Alertmanager) are not this codebase's to guess. `plan.md` §9's own Blocked note set the posture: build against Prometheus-compatible metrics, leave the sink configurable. A metrics-only implementation would have made "the sink is configurable" a stated intention with only one option ever built; the webhook sink — small, and genuinely optional via `AlertConfig.webhookUrl` — is what makes that claim actually true, and is what a concrete destination can be wired into the moment CCH answers R-37, without a design change.

**The metrics-based sink is not a placeholder — it is the standard shape a Prometheus/Alertmanager stack expects.** CCH's own confirmed stack (Prometheus/Grafana/Loki/Tempo/Mimir, IDD §10) alerts by evaluating a rule against a metric series (e.g. `increase(mla_alerts_total{type="signature"}[5m]) > 0`), not by an application pushing a notification. `mla_alerts_total{type,severity}` is that series, live and provable today, needing no destination decided to exist.

**Severity is a two-tier reading of `engineering-rules.md` §6.2's "parked vs dead" language**, generalised to MLA's own shape even though MLA has no DLQ (`core-knowledge.md` §9's own table: MLA's analogue is parked-entry count and retry-exhaustion count, not a DLQ depth). `informational` for a retry-exhaustion park and a tokenization-attempt failure (a degrading signal, not yet systemic); `failure` for a breaker trip (the systemic escalation), a security event, and a permanent rejection. Not verbatim from any acceptance criterion — flagged here as an interpretation, not buried silently in the code alone.

**Tokenization-failure alerts fire on every attempt, mirroring `Metrics.incrementTokenizationFailure`'s own cadence, deliberately.** During a sustained PII-secret outage this fires repeatedly — by design. The rate is what an operator alerts on (`engineering-rules.md` §9's own "degraded-message rate, tokenization-failure rate"), and grouping a repeatedly-firing condition into one notification is Alertmanager's own job once wired, not something this codebase should duplicate by rate-limiting its own signal.

**`logPpaPermanentRejection`'s alert payload deliberately carries less than its log line.** US-MLA-07's AC requires the *log* to carry the full rejected envelope, for an operator to investigate; the alert payload carries only the identifying fields (`correlationId`, `eventType`, `serviceOperation`) — N7's "no raw PII in any log, metric, DLQ entry, or error message" extended, by this phase's own reasoning, to anything an external alert sink receives, since a webhook destination is not this codebase's own trust boundary the way an internal log stream is.

**The file split (`ingestion-outcome-logging.service.ts`) is a genuine SRP boundary, not line-count avoidance dressed up as one.** `engineering-rules.md` §5's own heuristic — "if it does not fit on a screen, it is probably doing two things" — is enforced mechanically by ESLint's `max-lines` (450, comments and blank lines excluded), and this item's own alert wiring pushed the original file past it. The boundary drawn is the one the file's own existing structure already implied: retry/park/breaker *orchestration*, which decides what happened, stays in `ingestion-consumer.service.ts`; *logging that decision* — which line, which metric, which alert — moved to the new module. No behaviour changed; every call site now imports what it used to define locally.

## What was proven live, versus assumed

Every one of the five alert conditions was exercised independently against the real harness (Redpanda + `ppa-stub`, genuinely re-signed real captured records, real mTLS), not asserted only in a unit test:

- **Security (signature)** — real captured records with a mismatched or unregistered-DFSP signature raised `mla_alerts_total{type="signature",severity="failure"}` (14 in one run, 116 across the exit-criterion run below).
- **Rejection** — a genuinely re-signed, tokenized `postQuotes` envelope delivered to `ppa-stub` forced into `4xx` raised `{type="rejection",severity="failure"}` (1); the log line carried the full envelope, the alert payload confirmed to carry only identifying fields.
- **Retry exhaustion + breaker trip (PPA)** — `ppa-stub` forced into `503` with `PPA_CIRCUIT_BREAKER_THRESHOLD=1`/`PPA_MAX_RETRIES=0` raised both `{type="retry-exhaustion",severity="informational"}` and `{type="breaker-trip",severity="failure"}` on the very first delivery attempt; the parked record was later observed delivering automatically once the fault cleared, with no process restart — the same restart-free recovery Phase 5 first proved, now also instrumented and alerted.
- **Retry exhaustion + breaker trip (PII) + tokenization failure** — the PII secret file removed at startup (`FilePiiSecretClient` has no hot-reload, the same named limitation carried since Phase 4) raised `{type="tokenization-failure",severity="informational"}` (one per attempt) and, at `PII_CIRCUIT_BREAKER_THRESHOLD=1`, `{type="retry-exhaustion",severity="informational"}` and `{type="breaker-trip",severity="failure"}` for the PII secret's own separately-scoped, process-wide breaker.

**The phase's own exit criterion was run and met live.** A full 500-record feed (`__tests__/fixtures/raw_export_500/raw_export_500.json`) against a fresh MLA instance and a real `ppa-stub` in clean-pass-through mode produced a `/metrics` snapshot in which every one of the 500 records lands in exactly one counted bucket: `mla_skipped_total{reason="egress"} 273` + `{reason="party-lookup"} 92` + `{reason="fx-quote-rejected"} 19` + `mla_rejected_total{reason="invalid-signature"} 116` = **500**. `mla_consumer_lag` settled to `0` on all twelve partitions, confirming full consumption; no partition was left paused; zero unhandled exceptions across the run; `mla_alerts_total{type="signature",severity="failure"} 116` matched every counted rejection exactly. (No `forwarded`/breaker/tokenization signals in this specific run — expected, not a gap: real DFSP keys remain unavailable, §13.1/§14 Q1, so every one of the 500 real captured signatures fails against the locally generated test keys; those buckets are each separately proven live above, against genuinely re-signed records, since the 500-record capture itself structurally cannot produce them.)

**354 tests, 100%/98.06%/100%/100% coverage, zero lint errors, prettier clean.** 12 new tests in `alert.client.test.ts` proving both sinks in isolation (the metrics counter, the webhook's success/non-2xx/rejected/timeout paths, an `Error` and a non-`Error` rejection reason both covered); `metrics.client.test.ts` and `config.service.test.ts` each extended by one test; `ingestion-consumer.service.test.ts` extended so every one of the five alert call sites asserts the exact `alert.raise*` call and payload, plus a negative assertion that a structural skip and a key-source outage raise no alert method at all.

## What was deliberately left out

**R-37 (alerting destination/routing) itself is not resolved by this phase, and was never going to be.** The webhook sink exists and is proven live; no concrete destination is wired by default, and Alertmanager-side routing rules (mapping a `mla_alerts_total` series to a paging decision) are entirely outside this codebase's own scope — CCH's decision, tracked at `plan.md` §13.1/§14 Q9, gating nothing this phase built.

**The 200ms p95 ack-latency budget itself is not confirmed** — only its instrumentation is. `mla_ack_latency_ms` observes every genuine PPA `success`, including a parked-then-recovered record's own latency; a single re-signed record's own round trip landing well under budget is not evidence about p95 under sustained/peak load. That load test — 25 TPS/30min, 125 TPS/5min, step-down — is explicitly Phase 7's own exit criterion (`plan.md` §10), not this phase's.

**ValKey memory-pressure alerting and TMS token-refresh health** (the rest of US-MON-01's own seven-signal spec) are PPA-scoped and not started; PPA implementation has not begun. **US-AUD-01** (audit-log content/masking) and **US-SEC-01** (inter-service mTLS, already built between MLA and PPA since Phase 5 but not itself a Phase 6 deliverable) are likewise out of this phase's own scope.

## What this exposed that outlives it

**`FilePiiSecretClient` has no hot-reload — confirmed, live, as a real operational constraint, not just a design comment.** Live-verifying the tokenization-failure alert required a process restart with the secret genuinely absent; moving the secret file away with the process already running had no effect on the already-loaded in-memory secret. This is the same limitation gate item #2 (`plan.md` §7.1 #2, §13.1) has carried since Phase 4 — this phase's own live verification is a second, independent confirmation of it, not a new finding, and does not change gate item #2's own open status.

**ESLint's `max-lines` gate caught a genuine, growing SRP violation mechanically, exactly as designed.** `ingestion-consumer.service.ts` had absorbed four phases' worth of orchestration and leaf-dispatch logic without ever being split; this phase's own alert wiring was what finally pushed it over the gate, at which point the natural boundary — decide vs. log/meter/alert — was already visible in the file's own existing comments describing its own two halves. The gate did its job: it forced the split at the moment the file's own responsibilities had genuinely grown past one screen, rather than letting the file grow indefinitely on the theory that "it still passes tests."

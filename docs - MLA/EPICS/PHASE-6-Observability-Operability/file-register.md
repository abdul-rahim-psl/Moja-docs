# Phase 6 — Observability and Operability: File Register

Every file this phase added or changed, across all four checklist items (`plan.md` §9), grouped by area. Files touched by more than one item are listed once, under the area they most belong to, with a note where relevant.

## Item 1 — Structured logging (`correlationId`/`eventType`/pipeline step on every line)

| File | Why it was added / what it does |
| --- | --- |
| `src/interfaces/logger.interface.ts` | `Logger`'s port signature changed from a bare `serviceOperation` string to a `LogContext` object (`correlationId?`/`eventType?`/`serviceOperation?`), so every call site can attach whichever fields it knows. |
| `src/clients/logger.client.ts` | Spreads `LogContext` onto pino's own merging argument verbatim — the one place a structured field becomes a real indexed field rather than text interpolated into the message. |
| `src/services/envelope-pipeline.service.ts` | Threads `eventType` onto six skip reasons `EnvelopePipelineOutcome`'s `skipped` branch was silently dropping it on, even though classification had already resolved it — a real plumbing gap this retrofit found and closed. |
| `src/clients/pii-secret.client.ts`, `src/clients/ppa.client.ts`, `src/clients/public-key-store.client.ts` | Every `logger.debug`/`.warn`/`.error` call site updated from a bare string to a `LogContext` object, matching the new port signature. |
| `__tests__/logger.client.test.ts`, `__tests__/envelope-pipeline.service.test.ts` | Extended to prove the new structured fields land correctly, including the `eventType`-on-skip-reasons fix. |

## Items 2 & 3 — Metrics for every operator question, and for every silent decision

| File | Why it was added / what it does |
| --- | --- |
| `src/interfaces/metrics.interface.ts` | The `Metrics` port — ten named signal methods (`incrementSkip`, `incrementRejection`, `incrementTokenizationFailure`, `incrementForwarded`, `incrementDeliveryOutcome`, `setPiiBreakerState`, `setPpaBreakerState`, `setPartitionPaused`, `setConsumerLag`, `observeAckLatencyMs`) plus `render`, mirroring `Logger`'s own shape. Later extended in this same phase (item 4, below) with an eleventh signal method, `incrementAlert`. |
| `src/clients/metrics.client.ts` | `PromClientMetrics`, the port's only implementation and the sole importer of `prom-client`. Registers all ten named series plus `collectDefaultMetrics`'s own process/event-loop signals; serves Prometheus text-exposition format via `render()`. |
| `src/clients/kafka.client.ts` | Wired to the `Metrics` port for `mla_partition_paused` (on every `pause`/`resume`) and `mla_consumer_lag` (polled per partition via a separate broker admin connection, on `KafkaConfig.lagPollIntervalMs`, against the consumer group's own **committed** offset, not in-memory fetch position). |
| `src/clients/fastify.client.ts` | Serves `/metrics` (Prometheus text-exposition, `text/plain; version=0.0.4`) alongside the existing `/health/live`/`/health/ready` routes. |
| `src/services/config.service.ts`, `src/interfaces/config.interface.ts` | `KafkaConfig.lagPollIntervalMs` added, with its own decided default. (Both files also carry item 4's `AlertConfig` addition, below.) |
| `__tests__/metrics.client.test.ts` | The one suite that exercises real `prom-client`, not a fake — every named series proven present, correctly labelled, and correctly valued. |
| `__tests__/kafka.client.test.ts`, `__tests__/fastify.client.test.ts` | Extended for the new pause/lag gauges and the `/metrics` route respectively. |
| `src/services/ingestion-consumer.service.ts` | Every `Metrics` call site wired into the pipeline's own decision points — see item 4's own row below for this phase's later, larger change to the same file. |

**A real defect items 2/3 found and fixed, not merely instrumented around:** wiring `mla_forwarded_total` exposed that a record recovering from a PII-secret park advanced the Kafka offset and logged "Forwarded" without ever calling `ppaClient.deliver` — fixed by factoring delivery/retry/park into one shared `resolveOutcome`, used by both a fresh record and a PII-recovered one (see `plan.md` §16's US-MON-01 entry and this file's own item-4 row for `ingestion-consumer.service.ts`, where the fix itself lives).

## Item 4 — Alert paths for the five named conditions (this session)

| File | Why it was added / what it does |
| --- | --- |
| `src/interfaces/alert.interface.ts` | **New.** The `Alert` port — five named methods (`raiseSecurityAlert`, `raiseRejectionAlert`, `raiseRetryExhaustionAlert`, `raiseBreakerTripAlert`, `raiseTokenizationFailureAlert`), each with a fixed severity, mirroring `Logger`/`Metrics`'s own established shape. |
| `src/clients/alert.client.ts` | **New.** `WebhookAlertClient`, the port's only implementation and the sole importer of `fetch` for this purpose. Two sinks per `raise*` call: `Metrics.incrementAlert` (always) and an optional webhook POST (only when `AlertConfig.webhookUrl` is set), fire-and-forget, `AbortController`-bounded, never throwing into the caller. |
| `src/services/ingestion-outcome-logging.service.ts` | **New.** The "how a resolved outcome is logged, metered, alerted" leaf dispatch, split out of `ingestion-consumer.service.ts` once this item's own wiring pushed that file past ESLint's `max-lines` gate — a pure relocation. Holds `LogDeps`, `logTripIfJust`, `logIngestionSkip`, `logEnvelopeSkip`, `logPpaPermanentRejection`, `describePpaFailure`, `logResolvedOutcome`. |
| `src/services/ingestion-consumer.service.ts` | The retry/park/breaker *orchestration* stays here. Changed in this item to: import the relocated logging-dispatch functions; thread `alert: Alert` through `IngestionHandlerDeps`, `ParkParams`, `PpaParkParams`, and every call site that already carried `logger`/`metrics`; call `alert.raiseSecurityAlert` (both signature-failure cases), `alert.raiseRejectionAlert` (`logPpaPermanentRejection`, now in the new module), `alert.raiseRetryExhaustionAlert` (both initial-park log lines, PII and PPA), `alert.raiseBreakerTripAlert` (`logTripIfJust`'s own `justTripped` gate, now in the new module), and `alert.raiseTokenizationFailureAlert` (inline in `attemptAndRecord`, on every attempt that hits an unavailable secret). |
| `src/interfaces/metrics.interface.ts`, `src/clients/metrics.client.ts` | `incrementAlert(type, severity)` added — the eleventh named method, and `mla_alerts_total{type,severity}` the concrete series it registers. Typed as plain strings, not `AlertSeverity`, deliberately, to keep `Metrics` uncoupled from `Alert`'s own type. |
| `src/interfaces/config.interface.ts` | `AlertConfig` (`webhookUrl?`, `webhookTimeoutMs`) added to `Configuration`. |
| `src/services/config.service.ts` | `loadAlert` — `ALERT_WEBHOOK_URL` (optional, no default — unset means the metrics sink alone is active, a complete configuration) and `ALERT_WEBHOOK_TIMEOUT_MS` (default 3000ms). |
| `.env.template` | Documents `ALERT_WEBHOOK_URL` (commented out — no destination decided, R-37) and `ALERT_WEBHOOK_TIMEOUT_MS`. |
| `src/index.ts` | Composition root: constructs `WebhookAlertClient` once, alongside every other client, and injects it into `createIngestionHandler`. |
| `__tests__/alert.client.test.ts` | **New.** 12 tests: every `raise*` method's own metrics-counter mapping; the webhook sink inactive with no URL configured; a successful POST's exact payload shape; a non-2xx response logging a warn; a rejected fetch logging a warn (both an `Error` and a non-`Error` rejection reason); the timeout/`AbortController` path, using fake timers to prove the abort actually fires. |
| `__tests__/metrics.client.test.ts`, `__tests__/config.service.test.ts` | Extended by one test each — `incrementAlert`'s own series, and the alert config's own default/override. |
| `__tests__/ingestion-consumer.service.test.ts` | Extended throughout: a `buildAlert()` fake (mirroring `buildLogger`/`buildMetrics`) added to every `createIngestionHandler`/`buildForwardingHandler` call site; the five alert-raising tests now assert the exact `alert.raise*` call and payload (message, `correlationId`, `eventType`, `serviceOperation`), not just that the plumbing compiles; a negative assertion added to the structural-skip test (`egress`/`party-lookup`) confirming no alert method fires on those, per `engineering-rules.md` §9's "structural skips do not alert" rule. |
| `__tests__/fastify.client.test.ts`, `__tests__/kafka.client.test.ts` | Their own local `buildMetrics()` fakes extended with `incrementAlert: jest.fn()` once the port grew the method, so both suites keep typechecking against `Metrics`. |

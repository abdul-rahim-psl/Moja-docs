<!-- SPDX-License-Identifier: Apache-2.0 -->

# QA Review — Findings (`cch-mla`, 2026-09-11) <!-- omit in toc -->

**Scope:** every file under `cch-mla/src/`, plus `jest.config.ts`, `package.json`, `.gitlab-ci.yml`, `Dockerfile`, `.gitignore`. Read from the perspective of a senior QA engineer against the requirements in `core-knowledge.md`, the binding rules in `engineering-rules.md`, and the story text in `EPICS/`. PPA is out of scope — it is a separate engineer's component in its own repository. (At review time this document said PPA "is not yet built"; that was never this docs folder's to claim, and it is not true — PPA is built, deployed, reachable, and its source is available locally at `cch-ppa`. The scope boundary is unchanged.)

**State of the suite at review time:** 25 suites, 367 tests, all green; 100% statements/functions/lines, 98.06% branches (gate is 96). Every finding below is therefore a defect the suite does not detect — in several cases because a test pins the defective behaviour as correct. The companion document, [`qa-review-remediation.md`](qa-review-remediation.md), proposes a fix for each numbered item.

**Verification method.** Each finding was confirmed against the source and, where marked *verified*, by running the real code (ts-node against `src/`) or by scanning the checked-in captures (`__tests__/fixtures/raw_export_500/raw_export_500.json`, 500 records, 114 canonical; `raw_topic_slice_partition2.json`). Claims about library behaviour were checked against the installed `node_modules` (kafkajs 2.2.4, Node v22.21.1).

- [Severity scale](#severity-scale)
- [Critical](#critical)
- [High](#high)
- [Medium](#medium)
- [Low](#low)
- [Test-suite gaps](#test-suite-gaps)
- [Findings index](#findings-index)

---

## Severity scale

| Severity | Meaning here |
| --- | --- |
| **Critical** | Silent, irreversible loss or corruption of payment events, or a security control that does not do what it claims, reachable under conditions the spec itself says to expect. |
| **High** | A non-negotiable (`engineering-rules.md` §1) or a story acceptance criterion is not met in a way that affects production behaviour; or an operational failure mode with no signal. |
| **Medium** | Wrong under a realistic but narrower condition, or a correctness/robustness gap with a bounded blast radius. |
| **Low** | Latent (shielded by another layer today), cosmetic, or a documentation/comment mismatch in a load-bearing comment. |

---

## Critical

### F-01 — A public-key-store outage permanently discards every event, offset advanced, no alert

**Where.** [`ingestion-outcome-logging.service.ts:159-166`](../../../cch-mla/src/services/ingestion-outcome-logging.service.ts) (`case 'key-source-unavailable'`), reached from [`ingestion-consumer.service.ts:321-322`](../../../cch-mla/src/services/ingestion-consumer.service.ts) (`logResolvedOutcome` then `kafka.advance`). Pinned by [`__tests__/ingestion-consumer.service.test.ts:409-421`](../../../cch-mla/__tests__/ingestion-consumer.service.test.ts): `expect(kafka.advance).toHaveBeenCalled()` and every `alert.raise*` `not.toHaveBeenCalled()`.

**What happens.** `verifyJws` returns `key-unavailable` when `FilePublicKeyStoreClient.reload()` last failed (directory unreadable, unmounted, permissions revoked). The pipeline maps that to the skip reason `key-source-unavailable`, which the consumer treats as a **permanent** rejection: `mla_rejected_total{reason="key-source-unavailable"}` is incremented, an `error` line is logged, the offset is committed, and — deliberately, per the code comment and the test — no `Alert` method is called.

**Why it matters.** The key directory is a local file dependency exactly like the PII secret. The PII secret's unavailability is (correctly) transient: retry burst → park → breaker → offset withheld → alert. The key store's unavailability is treated as if the event itself were bad. A five-minute outage at the sustained 25 TPS drops ~7,500 events from the fraud pipeline with nothing but a log line and a counter. The audit topic's 7-day retention is useless as a recovery buffer because the offset has already moved past them. This breaks N10 (a drop path with no alert) and inverts the intent of core-knowledge.md §3.3's requirement that a key-source outage be *distinguishable* from an invalid signature — the distinction exists so the outage is *not* treated as a per-event failure. `/health/ready` ([`health.service.ts`](../../../cch-mla/src/services/health.service.ts)) also ignores key-store load state, so the replica keeps advertising ready throughout.

**Verified:** by reading the pinned test and the dispatch code; no runtime probe needed.

### F-02 — `extractId`'s `httpPath` fallback fabricates `id` values for POST-leg records

**Where.** [`envelope-builder.service.ts:55-64`](../../../cch-mla/src/services/envelope-builder.service.ts) — `idFromHttpPathFallback` and `extractId`.

**What happens.** The fallback exists for `putFxQuotesByID`, whose canonical `start` record lacks a `conversionRequestId` tag but carries `/fxQuotes/{id}` in `tags.httpPath`. The fallback is not scoped to that operation: it runs for **any** event type whenever the primary tag is absent, and takes the last `/`-segment of whatever `httpPath` holds.

**Verified** by running `extractId` directly:

| Record | `httpPath` | Primary tag | Resulting `id` |
| --- | --- | --- | --- |
| `postQuotes` | `/quotes` | absent | `"quotes"` |
| `postFxQuotes` | `/fxQuotes` | absent | `"fxQuotes"` |
| `putQuotesByID` error callback | `/quotes/{id}/error` | absent | `"error"` |
| `prepareTransfer` | *(no `httpPath` tag on this operation in any capture)* | absent | `undefined` → `incomplete-envelope` (correct, by accident of the tag being missing) |

A `"quotes"` id passes the envelope schema (`minLength: 1`) and is forwarded. PPA's idempotency key is `{id}:{isoMessageType}` (core-knowledge.md §6.4), so after the first such envelope, **every subsequent quote request would be silently discarded as a duplicate of `quotes:pain.001.001.11`** — no error, no metric on the MLA side.

**Why it matters.** core-knowledge.md §5: `id` is "read straight off the event, never generated". This generates one. The captures at hand never trigger the defect (only `putFxQuotesByID` lacks its tag — 14 of 114 canonical records), but FSD Open Item #7 (core-knowledge.md §13.1) states that tag survival in CCH production is **unconfirmed**. The one condition the spec flags as uncertain is the one that turns this fallback into silent data loss.

### F-03 — Every security-relevant setting has a silent default pointing at repo test material

**Where.** [`config.service.ts:136-167`](../../../cch-mla/src/services/config.service.ts) — `loadPpa`, `loadJws`, `loadPii`.

**What happens.** With no environment variable set, the service starts with: `JWS_PUBLIC_KEY_DIR=tools/dfsp-keys/store` (locally generated test DFSP keys), `PII_SECRET_PATH=tools/pii-secret/generated/local.secret` (a locally generated tokenization secret nobody governs), `PPA_CLIENT_CERT_PATH`/`PPA_CLIENT_KEY_PATH`/`PPA_CA_CERT_PATH` under `tools/ppa-stub/certs/`, and `PPA_BASE_URL=https://localhost:4443`. None of these throws.

**Why it matters.** `engineering-rules.md` §8: "**Never default a security-relevant setting.**" and N6. A production deployment that omits `PII_SECRET_PATH` would, if the harness file were present in the image, tokenize with a secret that was never issued or rotated by CCH; omit `JWS_PUBLIC_KEY_DIR` and signatures are verified against test keys. In the more likely case that the files are *absent* in production, the failure is a `DOWN` readiness (PII) or `key-source-unavailable` on every record (JWS — which per F-01 advances the offset) rather than a refusal to start. Either way the rule is that this must be a fatal config error at boot. The files themselves are correctly git-ignored (verified: `git ls-files` returns none of them), which limits the blast radius but does not fix the defaults.

---

## High

### F-04 — JWS verification ignores the protected header's bound claims

**Where.** [`jws-verification.service.ts:127-135`](../../../cch-mla/src/services/jws-verification.service.ts); documented as intentional in [`jws.interface.ts:530`](../../../cch-mla/src/interfaces/jws.interface.ts) ("Only `alg` is read; the rest are carried for completeness/debugging, never re-derived from them").

**What happens.** The decoded protected header carries `FSPIOP-Source`, `FSPIOP-Destination`, `FSPIOP-URI`, `FSPIOP-HTTP-Method` and `Date` (verified on all 129 signed canonical records across both raw captures). Only `alg` is checked. The signature is verified over `protectedHeader || '.' || base64url(body)`, so those claims *are* signed — but nothing compares them to the transport headers and tags the pipeline actually acts on (`content.headers['fspiop-source']`, `['fspiop-destination']`, `tags.httpMethod`, `tags.httpPath`).

**Why it matters.** The FSPIOP signature binds a body to a specific source, destination, URI and method precisely so a signed body cannot be replayed under different transport metadata. As written, a body genuinely signed by DFSP A for `PUT /quotes/X` to DFSP B verifies when re-presented with `fspiop-destination: C`, or with `httpMethod: POST` (which flips `msgType` to `request`). Every field the envelope carries other than `body` — `msgType`, `fspiop-source`, `fspiop-destination`, and `id` via the tags — is taken from **unsigned** input. `core-knowledge.md` §10 describes JWS as *the* control on the DFSP → MLA boundary; it currently authenticates the body only.

**Capture evidence for the fix's safety** (all 129 signed canonical records): `FSPIOP-Source` equals the transport header 129/129; `FSPIOP-Destination` 129/129; `FSPIOP-HTTP-Method` equals `tags.httpMethod` case-insensitively 129/129 (the header is upper-case, the tag lower-case — 100/129 differ in case only, 0 differ otherwise); `FSPIOP-URI` equals `tags.httpPath` in 104/104 records where the tag exists (`prepareTransfer` and `prepareFxTransfer` carry no `httpPath` tag at all).

### F-05 — The PPA circuit breaker is decorative: tripping changes no behaviour

**Where.** [`ingestion-consumer.service.ts:653-739`](../../../cch-mla/src/services/ingestion-consumer.service.ts) (`parkAndReprobePpa`); the same shape in `parkAndReprobe` (PII) at lines 517-605.

**What happens.** `kafka.pause(partition)` is called unconditionally the first time a retry burst exhausts, before the breaker has counted anything. `breaker.recordFailure()` is then called once per park and once per failed reprobe; when it crosses the threshold, the only effects are `logTripIfJust` (a log line and `raiseBreakerTripAlert`) and `metrics.setPpaBreakerState(partition, true)`. Every reprobe, tripped or not, is a full `deliver(envelope)` — a real POST that burns `timeoutMs` (default 2 s) against a PPA that is known to be down.

**Why it matters.** `core-knowledge.md` §3.5 specifies two coordinated stages: (a) retry budget exhausted → alert, pause the offset *on that event*, keep retrying it; (b) N consecutive failures → breaker trips → **"stop attempting the paused event directly"**, pause the partition, and **re-probe PPA health** on an interval, resuming from the paused event once a probe succeeds. The code implements (a) with the partition pause that belongs to (b), and never implements (b)'s "stop attempting directly / probe health" at all. The consequence is not data loss — the offset is correctly withheld — but the mechanism an operator reads on `mla_ppa_breaker_state` has no operational meaning, and `PPA_CIRCUIT_BREAKER_THRESHOLD` is a no-op knob. The `Todos` of US-MLA-07 that name breaker trip and resume as test cases are satisfied by tests that assert log lines and gauges, not behaviour.

### F-06 — Key-store hot reload reads partial files; a routine key rotation becomes permanent drops

**Where.** [`public-key-store.client.ts:41-43, 54-72`](../../../cch-mla/src/clients/public-key-store.client.ts).

**What happens.** `fs.watch` fires on every filesystem event, including the first write of a file that is still being written, with no debounce. `reload()` reads every `.pem` synchronously and **replaces the whole map** on success. During a multi-file rotation (or a single `cp` of a large PEM) the map transiently contains a truncated PEM, or lacks a DFSP whose old file was removed before the new one landed. Neither condition sets `loadError`, so `getKey` reports `found` (truncated) or `not-found`.

**Why it matters.** A truncated key makes `crypto.verify` throw → `invalid-signature`. A missing entry → `not-found` → `invalid-signature`. Both are **permanent** in this pipeline: offset advanced, `SECURITY:` log line, `raiseSecurityAlert`. A routine key rollout therefore drops genuine traffic and pages security. The class comment claims a reload failure "does not clear the last-known-good key set" — true for a *thrown* failure, not for a *successful* read of a bad or incomplete directory. The existing watch test (`adding a key after construction is picked up`) covers only the happy path.

### F-07 — Numeric configuration is unbounded

**Where.** [`config.service.ts:53-62`](../../../cch-mla/src/services/config.service.ts) — `readNumber` checks `Number.isFinite` only. Only `PORT` is range-checked.

**What happens / why it matters.** All of the following are accepted at boot:

| Value | Effect |
| --- | --- |
| `PPA_TIMEOUT_MS=0` | every delivery aborts immediately → every event parks |
| `PII_REPROBE_INTERVAL_MS=0`, `PPA_REPROBE_INTERVAL_MS=0` | `setTimeout(…, 0)` reprobe loop — a tight loop of POSTs against PPA |
| `KAFKA_LAG_POLL_INTERVAL_MS=0` | `setInterval(…, 0)` against the broker admin API |
| `PPA_MAX_RETRIES=-1` | retries silently disabled |
| `PPA_MAX_RETRIES=10`, `PPA_RETRY_BASE_MS=5000` | blocking burst ceiling `5000 × (2¹⁰ − 1)` ms ≈ 85 min inside `eachMessage` — far past kafkajs's default 30 s `sessionTimeout` → the broker evicts the consumer → rebalance → the same record is redelivered to another instance which does the same thing |
| `PPA_CIRCUIT_BREAKER_THRESHOLD=0` | breaker trips on the first failure |
| `ALERT_WEBHOOK_TIMEOUT_MS=-5` | `setTimeout` treats it as 0 → every webhook aborted |

`engineering-rules.md` §8: "Fail fast on invalid config. Validate at startup and refuse to start on a missing or malformed value."

### F-08 — Blocking retry bursts stall every partition on the instance

**Where.** [`kafka.client.ts:139-152`](../../../cch-mla/src/clients/kafka.client.ts) (`consumer.run` with no `partitionsConsumedConcurrently`) together with [`ingestion-consumer.service.ts:438-450`](../../../cch-mla/src/services/ingestion-consumer.service.ts) (`runPpaRetryBurst`) and lines 370-388 (`runRetryBurst`).

**What happens.** kafkajs's default `partitionsConsumedConcurrently` is 1, so the `await` inside `eachMessage` blocks the whole consumer, not just the partition whose record is retrying. One transient PPA failure on partition 0 costs up to ~7 s of retry backoff (default ceilings 1/2/4 s) during which partitions 1…N receive nothing.

**Why it matters.** At the 125 TPS peak that is ~875 events of added lag per incident, attributed to corridors that experienced no failure, against a 200 ms p95 ack budget (US-PERF-01). The code comments describe blocking as "safe and far simpler"; it is safe with respect to the session timeout under default config (see F-07 for when it is not), but it couples unrelated partitions' latency, which the per-partition breaker design explicitly set out to avoid.

### F-09 — `uncaughtException` is logged and swallowed

**Where.** [`index.ts:199-201`](../../../cch-mla/src/index.ts).

**What happens.** The handler logs and returns. The process continues in whatever state the exception left it — a half-run reprobe, a consumer whose fetch loop threw, an open TLS socket with no listener.

**Why it matters.** Node's documented contract for `uncaughtException` is "perform synchronous cleanup and exit"; continuing is explicitly unsupported. `engineering-rules.md` §6.1 classifies "the service cannot function" as Fatal: "Refuse to start. Do not run degraded." In an orchestrated deployment the correct behaviour is `process.exit(1)` so the orchestrator restarts a clean instance; as written, `/health/live` stays UP on an instance that may have stopped consuming (see F-10, F-12).

### F-10 — Reprobe chains have no watchdog; one escaped exception pauses a partition forever, silently

**Where.** [`ingestion-consumer.service.ts:551-604`](../../../cch-mla/src/services/ingestion-consumer.service.ts) (`parkAndReprobe`) and 711-738 (`parkAndReprobePpa`).

**What happens.** Each reprobe tick is `setTimeout(() => { reprobe(); }, …)` — a floating promise. Inside `reprobe`, the `try/catch` covers the attempt, but the **re-arming `setTimeout` is outside and after** the `try/catch`. If anything in the `catch` branch throws (e.g. `logger.error` on a broken transport), or if `kafka.pause()`/`kafka.resume()` throws on the synchronous path before the first tick is armed, the chain ends. The partition stays paused with `mla_partition_paused{partition}=1` and nothing else: no timer, no alert, no retry, no bounded park duration that escalates.

**Also in this function:** the comment at [lines 501-509](../../../cch-mla/src/services/ingestion-consumer.service.ts) states "The PII breaker is reset and the partition resumed *before* handing off" to `resolveOutcome`, and describes a "brief resume-then-repause" artefact. The code at lines 575-582 calls `resolveOutcome` **first** and resumes **after**, only if `settled` is true. The comment describes an earlier shape; it is a load-bearing comment (it explains the one-reprobe-loop-per-partition invariant) and it is wrong.

**Why it matters.** `engineering-rules.md` §9: "Is anything stuck?" must be answerable from telemetry. A paused partition with a live reprobe loop and a paused partition with a dead one look identical on every metric.

---

## Medium

### F-11 — Detached park timers survive `shutdown()`; shutdown exits 0 on failure

**Where.** [`index.ts:173-182, 184-194`](../../../cch-mla/src/index.ts).

`shutdown` disconnects Kafka, closes the key-store watcher and the HTTP server. It has no handle on the reprobe timers created by `parkAndReprobe`/`parkAndReprobePpa`, so they continue to fire against a disconnected consumer (`advance`/`resume` throw, are logged, and re-arm) until `process.exit`. Nothing is `unref()`'d. Harmless today only because `process.exit(EXIT_CODE_OK)` follows immediately — and it exits 0 even when `shutdown` caught and swallowed an error, so an orchestrator cannot tell a clean stop from a failed one.

### F-12 — `KafkaClient.isConnected()` never becomes `false` on a broker disconnect

**Where.** [`kafka.client.ts:67, 98-125`](../../../cch-mla/src/clients/kafka.client.ts).

`connected` is set `true` in `connect()` and `false` only in `disconnect()`. kafkajs emits `consumer.events.DISCONNECT`, `CONNECT` and `CRASH` (verified in `kafkajs/types/index.d.ts`); none is subscribed. During a broker outage `/health/ready` reports `kafka: 'UP'`, contradicting the `connectKafka` comment ("reports `/health/ready` DOWN so the orchestrator keeps it out of rotation").

### F-13 — `PPA_BASE_URL`'s path component is silently dropped

**Where.** [`ppa.client.ts:52-54, 67, 83-91`](../../../cch-mla/src/clients/ppa.client.ts).

Only `url.hostname` and `url.port` are retained; `path` is `resolvePpaEndpoint(eventType)` alone. `PPA_BASE_URL=https://ppa.internal/mla/v1` posts to `/QUOTES`, not `/mla/v1/QUOTES`. Behind any ingress that routes on a path prefix this is a 404 → `client-error` → **permanent** rejection, offset advanced, for every event. Also: when `baseUrl` has no explicit port, `url.port` is `''`; Node falls back to 443 because `''` is falsy — correct by accident rather than by intent.

### F-14 — TLS parameters are implicit; mTLS certificates are read once

**Where.** [`ppa.client.ts:56-60, 83-91`](../../../cch-mla/src/clients/ppa.client.ts).

The request options carry `key`/`cert`/`ca` only: no `minVersion: 'TLSv1.2'`, no explicit `rejectUnauthorized: true`, no `Agent`. TLS 1.2+ holds today only because Node ≥ 12 defaults `minVersion` to TLSv1.2 — the requirement (US-SEC-01, core-knowledge.md §10, §11) is that it be *enforced*, and N6 that it not be an unstated dependency on a runtime default. Without a keep-alive `Agent`, each `deliver` opens a new TCP+TLS connection — a full handshake per event at 125 TPS, against a 200 ms p95 budget. Certificates are `readFileSync` in the constructor, so rotation requires a restart; US-SEC-01 requires rotation "without a service restart (hot-reload or rolling restart, confirmed with CCH before implementation)" — the confirmation is outstanding, but nothing in the code is shaped to accommodate either answer.

### F-15 — A PPA 4xx logs the full envelope, including cleartext PII on transfer bodies

**Where.** [`ingestion-outcome-logging.service.ts:204`](../../../cch-mla/src/services/ingestion-outcome-logging.service.ts).

TRANSFER/FXTRANSFER bodies are never tokenized (the ILP exemption, core-knowledge.md §4.1), so `body.ilpPacket` — which encodes payer/payee identity and display name — is written verbatim to the log, along with any other body field. US-MLA-07's AC says "log the full envelope as an error"; N7 says "No raw PII in any log, metric, DLQ entry, or error message." The two conflict and the code follows the story. **This is a CCH decision, not engineering's** (`CLAUDE.md`, "External decisions"): the story author must reconcile N7 with the AC. The remediation document proposes a masked interim.

### F-16 — Alert webhook fan-out is unbounded

**Where.** [`alert.client.ts:79-102`](../../../cch-mla/src/clients/alert.client.ts).

Each `raise*` call issues one `fetch`, with no concurrency cap, coalescing, or back-pressure. A sustained condition that alerts per record — a signature failure across a DFSP, a PII secret outage (`raiseTokenizationFailureAlert` fires on *every attempt*, including each retry) — at 125 TPS opens ≥125 outbound HTTP calls per second toward a destination this code does not control, each held up to `webhookTimeoutMs` (3 s). That is ≥375 concurrent sockets in steady state, and the alert path becomes the thing degrading the pipeline it reports on.

### F-17 — A recovered parked event is re-delivered if the offset commit fails

**Where.** [`ingestion-consumer.service.ts:680-694`](../../../cch-mla/src/services/ingestion-consumer.service.ts) (`resolvePartition`).

When PPA has returned 200 and `kafka.advance()` then throws, the code re-arms `reprobe()`, which calls `deliver(envelope)` again — a second POST of an envelope PPA already durably accepted. PPA's `{id}:{isoMessageType}` idempotency should absorb the duplicate, but the durability contract does not require MLA to *generate* duplicates it could avoid; the commit should be retried on its own. The comment ("retries the commit along with everything else") understates that "everything else" is a network call to a third party.

### F-18 — Response body buffered without a cap; non-2xx/4xx/5xx statuses are retried indefinitely

**Where.** [`ppa.client.ts:122-129, 164-169`](../../../cch-mla/src/clients/ppa.client.ts).

`chunks` accumulates the whole response with no size limit. `classifyHttpStatus` maps 1xx/2xx-not-200/3xx to `server-error` (documented as deliberate), so a misconfigured proxy returning 301 parks the partition and reprobes forever with no distinct signal — a redirect is not something a retry can ever resolve.

---

## Low

### F-19 — Prototype-chain lookups in plain-object tables

**Where.** [`event-classification.service.ts:25, 81`](../../../cch-mla/src/services/event-classification.service.ts), [`canonical-record.service.ts:51, 141`](../../../cch-mla/src/services/canonical-record.service.ts), [`jws-verification.service.ts:92`](../../../cch-mla/src/services/jws-verification.service.ts) (`alg in ALGORITHM_TO_NODE_NAME`).

**Verified:** `classifyEventType` with `operation: "constructor"` returns `{ outcome: 'classified', eventType: [Function: Object] }`; `"toString"` likewise. In the full pipeline this is shielded today because `isCanonicalRecord` runs first and `CANONICAL_ACTION_BY_OPERATION['constructor']` (a function) `!== 'start'`, so the record skips as `egress`. The shield is accidental: the same lookup pattern is used in the shield. `alg: "constructor"` in a protected header reaches `crypto.verify` with a function as the algorithm name, throws, and is caught as `invalid-signature` — safe, but by exception path rather than by design.

### F-20 — Full-jitter backoff has a lower bound of 0 ms

**Where.** [`retry-backoff.service.ts:42-45`](../../../cch-mla/src/services/retry-backoff.service.ts).

`random() * ceiling` can return ~0, so all three retries can complete within milliseconds, giving a brief PPA blip no time to clear before the event parks. Documented as deliberate ("full jitter"); the usual production shape has a floor.

### F-21 — Metric help text contradicts the implementation

**Where.** [`metrics.client.ts:95`](../../../cch-mla/src/clients/metrics.client.ts) says `mla_consumer_lag` is "the broker high-water mark minus the last offset this instance has processed"; [`kafka.client.ts:43-55`](../../../cch-mla/src/clients/kafka.client.ts) says — correctly, and at length — that it is against the *committed* offset, deliberately. The help string is what an operator reads in Grafana.

### F-22 — `raiseTokenizationFailureAlert` is `informational`

**Where.** [`alert.client.ts:60-62`](../../../cch-mla/src/clients/alert.client.ts).

core-knowledge.md §4.3: the tokenization-failure signal is "the *only* signal that PII is reaching PPA unprotected" under a pass-through fail-mode. Fail-closed is what is built, so nothing leaks — but a sustained tokenization failure is a systemic condition (every QUOTE/FXQUOTE is parking) and is the same class as a breaker trip, which is `failure`.

---

## Test-suite gaps

The suite's 100% line coverage coexists with every finding above because the following are not tested:

| Gap | Finding |
| --- | --- |
| No test asserts a key-store outage is *retried* or *parked*; the only consumer-level test asserts it is *advanced past* with no alert. | F-01 |
| No test feeds a POST-leg record (`postQuotes`, `postFxQuotes`) with its id tag removed through `extractId`/`buildEnvelope` and asserts `incomplete`. | F-02 |
| No test loads configuration with the security-relevant variables unset and asserts a throw. | F-03 |
| No JWS test presents a protected header whose `FSPIOP-Source`/`-Destination`/`-HTTP-Method`/`-URI` disagree with the transport headers/tags. | F-04 |
| No test asserts anything *behavioural* differs between "parked, breaker closed" and "parked, breaker tripped". | F-05 |
| No test writes a truncated `.pem` mid-watch, or removes a key file, and asserts the resulting `getKey` outcome; no test covers two rapid successive watch events. | F-06 |
| No test passes zero, negative, or session-timeout-exceeding values through `loadConfiguration`. | F-07 |
| No test asserts `consumer.run` is called with a `partitionsConsumedConcurrently` value. | F-08 |
| No test asserts reprobe timers are cancelled by shutdown, or that a paused partition without an active reprobe is detectable. | F-10, F-11 |
| No test drives a kafkajs `DISCONNECT`/`CRASH` event and asserts readiness flips. | F-12 |
| `HttpsPpaClient` tests do not cover a `PPA_BASE_URL` with a path, `minVersion`, `rejectUnauthorized`, or connection reuse. | F-13, F-14 |
| No test asserts the 4xx log line is free of `ilpPacket`/PII for a TRANSFER envelope. | F-15 |
| No test raises N alerts concurrently and asserts a bound on in-flight webhook calls. | F-16 |
| No test makes `advance` throw after a successful reprobe delivery and asserts `deliver` is **not** called again. | F-17 |
| No test presents `operation: "constructor"` / `alg: "constructor"`. | F-19 |

---

## Findings index

**The checkbox is crossed only when a finding is both fixed *and* live-verified** (`engineering-rules.md` §11 — a passing unit suite alone does not earn the check). A finding that is fixed and unit-tested but not yet live-verified stays unchecked, with its state noted in the "Status" column rather than implied by the box.

| # | Done | Severity | One line | Status |
| --- | --- | --- | --- | --- |
| F-01 | [x] | Critical | Key-store outage → every event permanently dropped, offset advanced, no alert | **Fixed and live-verified**, both parts. Unit suite: 394 tests green, 100% statements/functions/lines, 98.15% branches, zero lint errors. Live-verified twice: (1) `FilePublicKeyStoreClient`'s watch-retry follow-on (a key directory missing at process start now self-heals - `/health/ready` flipped `jwsKeyStore: DOWN`→`UP` within one retry interval when the directory appeared mid-run, no restart). (2) The retry/park/breaker mechanism itself, against the real harness (Redpanda + `ppa-stub`, `npm run dev` unmodified): `chmod 000` on the live `JWS_PUBLIC_KEY_DIR` mid-feed of a real signed capture caused the next record to retry, then park and pause its partition (`mla_partition_paused{partition="2"}=1`, `mla_consumer_lag{partition="2"}=17`, `raiseRetryExhaustionAlert` fired, zero envelopes reached `ppa-stub`, nothing counted in `mla_rejected_total`); restoring permissions let the next reprobe tick recover the parked record, resume the partition, and deliver every subsequent record with no gap (`mla_partition_paused=0`, `mla_consumer_lag{partition="2"}=0`, 8/8 envelopes at `ppa-stub` matching `mla_forwarded_total`). The remediation doc's proposed scenario-library addition for this (`chmod 000`/restore, beside the PII-outage shape) has not yet been written into `tools/scenario-library/scenarios.ts` - this run was ad hoc, not a repeatable scenario. **Partly moot [2026-09-23]:** the key-store half was deleted with MLA's JWS validation (`e2e-testing/remove-JWS.md`); the transient retry/park/breaker machinery it introduced still carries the PII secret domain. |
| F-02 | [x] | Critical | `httpPath` fallback generates `id: "quotes"`/`"fxQuotes"`/`"error"` | Fixed. Live-verified: the real `extractId` re-run against all 116 canonical, classified records in `raw_export_500.json` — zero regressions — plus `npm run golden:ingestion:all` unaffected. |
| F-03 | [x] | Critical | Security-relevant config defaults to repo test keys/secret/certs | **Fixed and live-verified.** Unit-tested (100% coverage on `config.service.ts`). Live run against the real process (`npx ts-node -r dotenv/config src/index.ts`, no harness needed - this is boot-time validation before anything else runs): with `.env` renamed away, the process logged `"Required environment variable PPA_BASE_URL is not set"` under `"Invalid configuration - refusing to start"` and exited 1; with five of the six required variables set and only `PII_SECRET_PATH` left out, it correctly still refused, naming that one specifically - proving all six are enforced, not just the first checked; with `.env` restored, it booted cleanly (`/health/ready` all `UP`) and shut down cleanly on `SIGTERM`. One deliberate scope deviation from the remediation doc, not yet flagged elsewhere: the six variables landed as "no default" only, not "no default + `fs.accessSync` existence/readability check" - the existence check was dropped because `FilePiiSecretClient`/`FilePublicKeyStoreClient` already have a considered non-throwing design for a missing *file* (path set, file absent), and a hard boot check on path existence would fight that design. What's live-verified is exactly the finding's own claim: an *unset* security-relevant variable is now a fatal boot error, not a silent fallback to repo test material. |
| F-04 | [x] | High | JWS protected-header claims (source/destination/URI/method) never checked | **Fixed and live-verified.** `jws-verification.service.ts` now checks `FSPIOP-Source`/`FSPIOP-Destination` against the transport headers and `FSPIOP-HTTP-Method`/`FSPIOP-URI` against `tags.httpMethod`/`tags.httpPath` (case-insensitive method; URI/method skipped only where the record itself carries no tag to check against), before the cryptographic verify. `Date` deliberately left unchecked (replay-window policy is a separate story). Unit-tested: 21/21 in `jws-verification.service.test.ts` (new "bound claims" describe block - one test per claim mismatch, the case-insensitive path, and the no-`httpPath`-tag path), full suite 400 tests green, 100%/98.2% coverage, zero lint errors. Fixing this also required updating two test helpers and one tool (`tools/capture-feeder/resign.ts`) that built a protected header with only `alg`+`FSPIOP-Source` - each now bakes in all four claims from the record's own transport data, the same way a genuine DFSP signature would. Live-verified three ways: `npm run golden:ingestion:all` (all 7 captures, unaffected - golden doesn't call `verifyJws`); **`npm run scenario:all` - all 15 scenarios passed, unattended, from a cold start** (the most thorough regression available: exercises the fixed `resign.ts` across ~1000+ re-signed records total, including the `mla-restart`/`two-mla-instances` infra scenarios); `npm run verify:tokenization` end-to-end against a real running `ppa-stub` over real mTLS (all 4 checks passed - tokens, determinism, clear amount, ILP exemption). That last run also surfaced and fixed a real, unrelated regression from F-01's watch-retry fix: `tools/verify-tokenization/run.ts` still constructed `FilePublicKeyStoreClient` with its old two-argument signature (never type-checked by the root `tsconfig.json`, only `tools/tsconfig.json` - now confirmed clean with `npx tsc --noEmit -p tools/tsconfig.json`). **Moot [2026-09-23]:** the code this fixed was deleted with MLA's JWS validation (`e2e-testing/remove-JWS.md`); the fix stays in git history. |
| F-05 | [x] | High | PPA (and PII) breaker trip has no behavioural effect; no health probe | **Fixed and live-verified for PPA** - the remediation doc's own concrete fix, which is PPA-specific. `parkAndReprobePpa`'s reprobe ticks now check the breaker's own tripped state (tracked locally, updated on every failure): below threshold, a tick retries the parked event directly as before; at/above threshold, a tick calls a new `PpaClient.probeReady()` (`GET /health/ready`) first and only spends a real envelope POST on a tick whose probe succeeded. A probe failure counts toward the same consecutive-failure count a delivery failure would; a probe success is not itself a recovery. Building this correctly required a real design correction, not just plumbing: `probeReady()` cannot reuse `deliver`'s mTLS identity/port - core-knowledge.md §6.2 requires mTLS only on the four POST endpoints, and both GET health endpoints are unauthenticated on their own ingress (confirmed by `tools/ppa-stub`'s own two-listener split, and caught live as a 404 on the first verification attempt). New `PPA_HEALTH_BASE_URL` config (defaults to `PPA_BASE_URL`; harness points it at `ppa-stub`'s control port) lets `probeReady` reach the right place without a client cert, over `http:` or `https:` as configured. Unit-tested (3 new dedicated tests for the probe gate itself, plus `probeReady` coverage in `ppa.client.test.ts`), full suite 413 tests green, 100%/98.05% coverage, zero lint errors. Live-verified against the real harness: tripped the breaker with a sustained `ppa-stub` 503, confirmed **every reprobe tick was `GET /health/ready` on the control port (0 business-endpoint POSTs) for the entire tripped window**; clearing the fault, the next tick's successful probe was immediately followed by a real delivery attempt, "PPA recovered" logged, the breaker reset, the partition resumed, and the rest of the backlog drained with no loss. **Scope decision [2026-09-14, user]:** the finding's own "Where" line also names `parkAndReprobe` (PII/JWS) as having the identical shape (tripped changes no reprobe behaviour there either), but the remediation doc's actual fix section only builds a mechanism for PPA - there is no local-file equivalent of "a cheap health GET vs an expensive POST" for a PII secret or DFSP key file, since re-checking either already is the cheapest available operation. Raised to the user and **closed as-is**: F-05 is scoped to what the remediation doc specifies (PPA), the PII/JWS shape is a noted gap rather than a blocking follow-up, and no further mechanism was invented for it. |
| F-06 | [x] | High | Key-store hot reload reads partial/absent files → permanent `invalid-signature` | **Fixed and live-verified.** `public-key-store.client.ts`'s `reload()` now runs every `.pem` through `crypto.createPublicKey` before it can enter the map: a truncated or otherwise malformed file aborts the *whole* reload, leaving the previous good map in place and reporting `unavailable` (transient, self-heals on the next successful reload) instead of a key that would make `crypto.verify` throw `invalid-signature` permanently. `fs.watch` events are debounced (new `JWS_RELOAD_DEBOUNCE_MS`, default 250ms) so a multi-file rotation's burst of filesystem events coalesces into one reload after the writes settle. A key's disappearance is accepted immediately (a genuine de-registration must be possible) but logged at `warn` with the DFSP id, so an operator can tell a rotation/removal apart from an attack. Unit-tested: 6 new tests in `public-key-store.client.test.ts` (debounce coalescing counted via reload-log calls; a real truncated-PEM mid-rotation asserted `unavailable` then recovery to `found`; a garbage `.pem` asserted `unavailable` naming the offending filename, then recovery once removed; a genuine removal asserted `not-found` plus the `warn` log; `close()` cancelling a debounce timer still pending from a just-fired watch event) — all against genuine RSA keys generated with `crypto.generateKeyPairSync`, not placeholder strings, since every `.pem` now passes through real validation. Full suite 418 tests green (up from 413), 100%/98.09% coverage, zero lint errors, `npx tsc --noEmit` clean on both the root and `tools/tsconfig.json`. **Two deliberate scope decisions from the remediation doc, not yet flagged elsewhere:** (1) skipped storing parsed `crypto.KeyObject`s in place of PEM strings (the remediation doc's item 4) — it is a hot-path perf optimisation, not required for the defect's correctness fix, and would have forced the `PublicKeyStore` port's shape to change across three unrelated test files (`envelope-pipeline.service.test.ts`, `jws-verification.service.test.ts`, `ingestion-consumer.service.test.ts`) that each build their own fake store directly against `publicKeyPem: string`; (2) took the remediation doc's own explicitly-offered "simpler alternative" for a disappearing key (accept immediately, log a `warn`) rather than the fuller hold-the-previous-map-one-more-interval-and-recheck mechanism, since the doc names both as acceptable. **Live-verified against the real running process** (`npm run dev`, no Kafka needed — key-store loading is independent of it): truncated an in-use, real DFSP key file (`test-mwk-dfsp.pem`, halved mid-byte) while the process ran — `/health/ready`'s `jwsKeyStore` flipped `UP`→`DOWN` within one debounce interval, with the exact expected log line (`"test-mwk-dfsp.pem" is not a valid PEM public key: error:1E08010C:DECODER routines::unsupported`); restoring the original bytes flipped it back to `UP` with no restart. Separately, deleting a real key file live kept `jwsKeyStore` at `UP` (a removal is not an outage) while logging the designed `warn` line naming the DFSP. Deleting three key files in the same instant produced exactly three `warn` lines at the identical timestamp — the debounce coalescing a removal burst into one reload tick, live, not just in the unit test. The key-store directory was restored byte-for-byte to its original 22 files afterward (git-ignored test material, diffed against backups to confirm). **Broad regression: `npm run scenario:all` — all 15 scenarios passed, unattended, from a cold start** (this change touches JWS key loading broadly, not just its own unit tests, per this workstream's standing convention). **Unrelated observation, not chased as part of this fix:** after printing its final summary, the `scenario:all` process did not exit on its own and had to be stopped manually (its own child `ppa-stub` was left running and required a separate `kill`) — plausibly the same shape as F-11's "detached timers survive shutdown," since F-11 is not started; noted here rather than investigated, as it is not part of F-06's scope. **Moot [2026-09-23]:** the code this fixed was deleted with MLA's JWS validation (`e2e-testing/remove-JWS.md`); the fix stays in git history. |
| F-07 | [x] | High | Numeric config accepts 0, negatives, and session-timeout-exceeding bursts | **Fixed and live-verified.** `config.service.ts`'s `readNumber` takes an optional `NumberBounds` (`min`/`max`/`integer`); every previously-unbounded variable now carries one of six shared bound objects, applied per the remediation table: `PPA_TIMEOUT_MS` (100–60000), `PPA_MAX_RETRIES`/`PII_MAX_RETRIES`/`JWS_MAX_RETRIES` (0–10), `PPA_RETRY_BASE_MS`/`PII_RETRY_BASE_MS`/`JWS_RETRY_BASE_MS` (10–30000), `*_CIRCUIT_BREAKER_THRESHOLD` ×3 (1–1000), `*_REPROBE_INTERVAL_MS` ×3 + `KAFKA_LAG_POLL_INTERVAL_MS` + `JWS_RELOAD_DEBOUNCE_MS` (100–3,600,000), `ALERT_WEBHOOK_TIMEOUT_MS` (100–30000). `readPort` now goes through the same bounded `readNumber` rather than its own ad hoc check, with an identical error message. **One extension beyond the remediation table, not yet flagged elsewhere:** `JWS_WATCH_RETRY_INTERVAL_MS` (added by F-01, after this table was written) is bounded under the same "never a tight loop against a live dependency" reasoning as its siblings — a variable the reviewer could not have named, not a deviation from what was named. **The cross-field invariant is also built**: a new `KAFKA_SESSION_TIMEOUT_MS` config (default 30000, kafkajs's own default made explicit, bounds 6000–3,600,000) is threaded into `KafkaClient`'s `consumer({ sessionTimeout })`; `assertRetryBurstsFitSessionTimeout` computes `ppaBurstMaxMs`/`piiBurstMaxMs`/`jwsBurstMaxMs` from the exact mechanics verified in `ingestion-consumer.service.ts` (`runTransientRetryBurst`/`runPpaRetryBurst`) and refuses to boot if either the PII+PPA or the JWS+PPA worst case would exceed it, naming the exact millisecond figures and which variables to change. Unit-tested: a 26-case table-driven test per bound violation (naming the variable and its bound, including the finding's own named examples — `PPA_MAX_RETRIES=-1`, `ALERT_WEBHOOK_TIMEOUT_MS=-5`, `KAFKA_LAG_POLL_INTERVAL_MS=0`), inclusive min/max-boundary tests, and four dedicated tests for the session-timeout invariant (PII+PPA over budget, JWS+PPA over budget, the same combination resolving once `KAFKA_SESSION_TIMEOUT_MS` is raised, and the shipped defaults fitting comfortably as-is). Two pre-existing test fixtures needed updating for the new required `sessionTimeoutMs` field / the new invariant (`kafka.client.test.ts`'s `KafkaConfig` fixture; `config.service.test.ts`'s own unrelated "every supplied value" test, whose arbitrary combination of large retry values happened to exceed the default session timeout — fixed by supplying `KAFKA_SESSION_TIMEOUT_MS` large enough, not by changing the values the test was actually checking). Full suite 452 tests green (up from 418), 100%/97.93% coverage, zero lint errors, `npx tsc --noEmit` clean on both the root and `tools/tsconfig.json`. **Live-verified against the real running process** (no harness needed — this is boot-time validation of pure input, the same shape as F-03's own live check): the shipped `.env` still boots clean with no config error; `PPA_MAX_RETRIES=-1` refuses to start with the exact named bound (`"Environment variable PPA_MAX_RETRIES must be an integer between 0 and 10, got \"-1\""`, exit 1); `PII_MAX_RETRIES=5 PII_RETRY_BASE_MS=2000` (PPA left at its defaults) refuses to start naming the exact computed figures (`77000ms`, `PII burst 62000ms + PPA burst 15000ms`, `KAFKA_SESSION_TIMEOUT_MS (30000ms)`) matching the unit test's own arithmetic exactly; adding `KAFKA_SESSION_TIMEOUT_MS=90000` to that same combination lets the identical process boot and start listening. Broad regression: **`npm run scenario:all` — all 15 scenarios passed, unattended, from a cold start** (config loading is foundational to every scenario booting at all). |
| F-08 | [x] | High | Retry bursts block all partitions (`partitionsConsumedConcurrently` = 1) | **Fixed and live-verified.** Two independent changes, both as the remediation doc specified: (1) new `KAFKA_PARTITIONS_CONSUMED_CONCURRENTLY` config, threaded into `KafkaClient.run()`'s real `consumer.run({ partitionsConsumedConcurrently })` — kafkajs's own default of 1 serialises every partition behind whichever one is currently bursting; (2) `ConsumedMessage` now carries kafkajs's own per-call `heartbeat`, called after every backoff delay inside both blocking bursts (`runTransientRetryBurst` for JWS/PII, `runPpaRetryBurst` for PPA), so a longer-than-usual burst no longer depends solely on F-07's session-timeout margin to avoid a broker-side eviction. **One correction to the remediation doc's own stated basis, not yet flagged elsewhere:** its suggested default (4) was justified by "the scenario library's own 3-partition topic" — checked against `docker-compose.dev.yml` and `tools/scenario-library/harness.ts`'s own `PARTITIONS` constant while building this, and the real local harness topic is provisioned at 12 partitions (deliberately: the highest `partitionID` across the 500-record export, plus one), not 3. The default landed at 12 instead, so it actually delivers full concurrency against the harness it is meant to match. Unit-tested: `kafka.client.test.ts` asserts `consumer.run` is called with the configured value and that the real kafkajs `heartbeat` passed into `eachMessage` is reachable (not a dead reference) through `ConsumedMessage.heartbeat`; `ingestion-consumer.service.test.ts` asserts heartbeat is called exactly once per retry (never on the initial, un-retried attempt) in both the PPA burst and the PII local-dependency burst. Full suite 458 tests green (up from 452), 100%/97.93% coverage, zero lint errors, `npx tsc --noEmit` clean on both the root and `tools/tsconfig.json`. **Live-verified against the real harness, twice, for a direct before/after comparison**: fed the identical 3 real re-signed records (one each on partitions 0/1/2) against a persistent `ppa-stub` 500, twice. With `KAFKA_PARTITIONS_CONSUMED_CONCURRENTLY=1` forced (the old default's shape): the three partitions parked **sequentially**, each only starting once the previous partition's entire burst had finished — 0s, +5.56s, +9.00s. With the new default (12): all three parked **concurrently** — 0s, +1.00s, +2.74s, overlapping bursts rather than queued ones. Same records, same fault, same harness — only the setting changed, and the wall-clock spread dropped by more than 3x, exactly the coupling this finding describes. |
| F-09 | [x] | High | `uncaughtException` swallowed; process continues in undefined state | **Fixed and live-verified (dev build).** `index.ts`'s `uncaughtException` handler now logs and calls `process.exit(1)` instead of returning; `unhandledRejection` does the same - the remediation doc's own stated condition for keeping it log-only ("only if F-10 and F-11 are done") did not hold at the time this was fixed, and F-10 (below) has since closed the one realistic source (the reprobe loop's floating promises) by construction, so this remains correct. `index.ts` is deliberately excluded from coverage (`jest.config.ts`) and has no test file, per the remediation doc's own note - verified by review plus a live run. **Live-verified** (`KAFKA_ENABLED=false npm run dev`, no harness needed): a temporary synthetic `setTimeout(() => { throw new Error(...) })` confirmed `uncaughtException` logs and exits 1; a temporary synthetic `Promise.reject(...)` confirmed `unhandledRejection` does the same; both temporary hooks were removed afterward, leaving only the two-handler diff. Full suite unaffected: 458 tests green, 100%/97.93% coverage, zero lint errors, `npx tsc --noEmit` clean on both the root and `tools/tsconfig.json`. |
| F-10 | [x] | High | Reprobe chain can die silently; partition paused forever; stale load-bearing comment | **Fixed and live-verified.** Both `parkAndReprobeTransient` (JWS/PII) and `parkAndReprobePpa`'s own `reprobe` functions now re-arm their next tick from a `finally` block, gated by a `done` flag set only on genuine settlement - a `logger.error` that itself throws inside the `catch` (wrapped in its own inner try/catch, "nothing left to log with") no longer skips re-scheduling, closing the escape hatch the finding named. A new `ParkRegistry` (`src/services/park-registry.service.ts`) is process-local bookkeeping of every currently-parked partition - registered wherever `kafka.pause` is called, ticked at the start of every reprobe attempt, deregistered wherever `kafka.resume` is called - injected into `IngestionHandlerDeps` the same way the breakers are. A new `park-watchdog.service.ts` runs independently on an interval derived from `max(reprobeIntervalMs) × 3`, checking every registered park's own staleness against that same `× 3` figure; a stale tick raises a new `Alert.raiseParkStalledAlert` (severity `failure`) and calls the registry's `retrigger`, which re-invokes the real reprobe closure directly - guarded against piling a second attempt on top of one still in flight via a `ticking` flag. A new `mla_park_age_seconds{partition}` gauge (`Metrics.setParkAgeSeconds`/`clearParkAgeSeconds`) makes a long park visible as a growing number, removed once the partition resumes. The stale comment (previously claiming "the partition resumed *before* handing off") is corrected to describe the code as it is: `resolveTransient` runs first, and the partition is resumed only if it settled there. Unit-tested: 2 new dedicated files (`park-registry.service.test.ts`, `park-watchdog.service.test.ts`, 100% coverage each) plus 4 new tests in `ingestion-consumer.service.test.ts` - a throwing-logger-inside-a-throwing-tick test for each of the two reprobe functions (proving the chain survives both throws and still ticks again), and an end-to-end test for each proving `ParkRegistry` tracks the real park (`kind`, partition) and that `retrigger` genuinely re-invokes the real, still-parked loop. Full suite 483 tests green (up from 458), 100%/98.03% coverage, zero lint errors, `npx tsc --noEmit` clean on both the root and `tools/tsconfig.json`. **Live-verified against the real harness** (Redpanda + `ppa-stub`, `npm run dev` unmodified): held `ppa-stub` at a persistent 503 via `/control`, fed one real re-signed record, confirmed the real park (`"parking event, pausing partition 11"`) and `mla_park_age_seconds{partition="11"}` appearing in `/metrics`; watched it advance from `9.661` to `39.661` across a real 30s watchdog cycle (`PPA_REPROBE_INTERVAL_MS=10000` × 3) with **zero false `raiseParkStalledAlert`** despite the loop's own 10s reprobe cadence being well inside that window - proving the watchdog does not fire against a legitimately busy, still-ticking loop, the same property the remediation doc's SIGSTOP scenario was written to prove. Clearing the fault (`/control/reset`) produced the expected recovery on the next tick: `"PPA recovered"`, `"Forwarded QUOTE"`, `"Resumed partition 11"`, `mla_partition_paused{partition="11"}` back to `0`, and the `mla_park_age_seconds{partition="11"}` series removed from `/metrics` entirely (confirming `clearParkAgeSeconds`'s `Gauge.remove`). `SIGTERM` during teardown exited cleanly; harness and `ppa-stub` torn down with `docker ps` confirmed clean afterward. **Not separately reproduced live:** a genuinely dead reprobe chain (the specific escaped-exception shape) and the watchdog's own `retrigger` firing from a real stale detection - both are exercised deterministically with fake timers in the new unit tests instead, since reproducing them against the real harness would require injecting a fault the codebase has no legitimate way to trigger from outside (the point of the fix). |
| F-11 | [x] | Medium | Park timers survive shutdown; shutdown exits 0 on error | **Fixed and live-verified.** `ParkRegistry` now tracks each partition's live reprobe `setTimeout` handle (`registerTimer`) and can cancel every one of them (`cancelAll`); `shutdown()` calls `cancelAll()` before `kafka.disconnect()` and rethrows on failure instead of swallowing it, so `registerSignalHandlers`'s `.catch` can exit non-zero. Full write-up: `plan.md` §16's [2026-09-23] entry. |
| F-12 | [ ] | Medium | `isConnected()` never flips on broker disconnect; readiness lies | Not started |
| F-13 | [ ] | Medium | `PPA_BASE_URL` path prefix dropped | Not started |
| F-14 | [ ] | Medium | No explicit TLS min version / `rejectUnauthorized` / keep-alive agent; certs not reloadable | Not started |
| F-15 | [ ] | Medium | 4xx log writes cleartext ILP/PII (story AC vs N7 — CCH decision) | Not started |
| F-16 | [ ] | Medium | Alert webhook fan-out unbounded | Not started |
| F-17 | [ ] | Medium | Commit failure after successful reprobe re-POSTs the envelope | Not started |
| F-18 | [ ] | Medium | Unbounded response buffer; 3xx retried forever with no distinct signal | Not started |
| F-19 | [ ] | Low | Prototype-chain table lookups (`constructor`, `toString`, `in`) | Not started |
| F-20 | [ ] | Low | Backoff floor is 0 ms | Not started |
| F-21 | [ ] | Low | `mla_consumer_lag` help text wrong | Not started |
| F-22 | [ ] | Low | Tokenization-failure alert severity | Not started |

---

*End of Document*

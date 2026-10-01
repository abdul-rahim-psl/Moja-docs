<!-- SPDX-License-Identifier: Apache-2.0 -->

# QA Review — Remediation Proposals (`cch-mla`, 2026-09-11) <!-- omit in toc -->

**Companion to** [`qa-review-findings.md`](qa-review-findings.md). One section per finding, same numbering (F-01 … F-22). Each section states: the fix, why that fix and not the obvious alternative, the test that must fail before the fix and pass after it (`engineering-rules.md` §10.3, "write the failing test first"), what must be live-verified against the harness (§11), and any decision that is not engineering's to make (`CLAUDE.md`, "External decisions").

**What was checked before writing this.** Every library call proposed below was confirmed against the installed dependency, not recalled from memory: kafkajs 2.2.4's consumer event names (`consumer.events.CONNECT` / `DISCONNECT` / `CRASH` / `GROUP_JOIN`), its `partitionsConsumedConcurrently` run option, the `heartbeat` and `pause` callbacks it passes into `eachMessage`, and that its runner heartbeats only *between* messages ([`kafkajs/src/consumer/runner.js`](../../../cch-mla/node_modules/kafkajs/src/consumer/runner.js) lines 225-262); Node v22's `https.Agent` accepting TLS options; `crypto.createPublicKey` throwing on a malformed PEM. Capture evidence cited for F-02 and F-04 was produced by scanning the checked-in fixtures directly.

**Suggested order.** F-03 and F-07 (config) first — they are small, independent, and several later fixes add config that should go through the same validation. Then F-01, F-02, F-04 (the Critical/High correctness items, each a contained change with a sharp test). Then F-05/F-08/F-10/F-11 together — they all touch `ingestion-consumer.service.ts`'s park/reprobe machinery and are easier to reason about as one refactor. The rest in any order.

- [F-01 — Key-store outage: transient, not permanent](#f-01--key-store-outage-transient-not-permanent)
- [F-02 — Scope the `httpPath` id fallback](#f-02--scope-the-httppath-id-fallback)
- [F-03 — No defaults for security-relevant configuration](#f-03--no-defaults-for-security-relevant-configuration)
- [F-04 — Enforce the JWS protected-header claims](#f-04--enforce-the-jws-protected-header-claims)
- [F-05 — Make the breaker trip mean something](#f-05--make-the-breaker-trip-mean-something)
- [F-06 — Safe key-store reload](#f-06--safe-key-store-reload)
- [F-07 — Bound every numeric setting](#f-07--bound-every-numeric-setting)
- [F-08 — Stop one partition's retry from stalling the others](#f-08--stop-one-partitions-retry-from-stalling-the-others)
- [F-09 — Exit on `uncaughtException`](#f-09--exit-on-uncaughtexception)
- [F-10 — Reprobe chains that cannot die silently](#f-10--reprobe-chains-that-cannot-die-silently)
- [F-11 — Cancel parks on shutdown; exit non-zero on failure](#f-11--cancel-parks-on-shutdown-exit-non-zero-on-failure)
- [F-12 — Track the real consumer connection state](#f-12--track-the-real-consumer-connection-state)
- [F-13 — Honour `PPA_BASE_URL`'s path](#f-13--honour-ppa_base_urls-path)
- [F-14 — Explicit TLS, connection reuse, reloadable certificates](#f-14--explicit-tls-connection-reuse-reloadable-certificates)
- [F-15 — PII in the 4xx log line](#f-15--pii-in-the-4xx-log-line)
- [F-16 — Bound the alert webhook](#f-16--bound-the-alert-webhook)
- [F-17 — Retry the commit, not the delivery](#f-17--retry-the-commit-not-the-delivery)
- [F-18 — Cap the response body; make 3xx distinct](#f-18--cap-the-response-body-make-3xx-distinct)
- [F-19 — Own-property lookups](#f-19--own-property-lookups)
- [F-20 — A floor under the jitter](#f-20--a-floor-under-the-jitter)
- [F-21 — Fix the metric help text](#f-21--fix-the-metric-help-text)
- [F-22 — Tokenization-failure alert severity](#f-22--tokenization-failure-alert-severity)
- [Documentation that changes with these fixes](#documentation-that-changes-with-these-fixes)

---

## F-01 — Key-store outage: transient, not permanent

### The fix

Treat `key-source-unavailable` exactly as `pii-secret-unavailable` is treated today: retry burst → park → breaker → offset withheld → alert on park and on trip. Both are "a local file dependency this replica needs is temporarily unavailable"; neither says anything about the event.

Concretely, in [`ingestion-consumer.service.ts`](../../../cch-mla/src/services/ingestion-consumer.service.ts):

1. Generalise the PII-specific machinery into a **local-dependency transient path** parameterised by a *domain* rather than duplicating `runRetryBurst`/`parkAndReprobe` a second time:

   ```ts
   interface TransientSkipDomain {
     readonly reason: 'pii-secret-unavailable' | 'key-source-unavailable';
     readonly breaker: CircuitBreaker;               // one process-wide instance per domain
     readonly retry: Pick<PiiConfig, 'maxRetries' | 'retryBaseMs' | 'circuitBreakerThreshold' | 'reprobeIntervalMs'>;
     readonly setBreakerState: (open: boolean) => void;   // metrics.setPiiBreakerState | metrics.setJwsKeyStoreBreakerState
     readonly onAttemptFailed: (context: LogContext, at: string) => void; // PII: incrementTokenizationFailure + raiseTokenizationFailureAlert; JWS: incrementKeyStoreUnavailable + raiseKeyStoreUnavailableAlert
     readonly describe: string;                      // 'PII secret store' | 'DFSP public-key store'
     readonly serviceOperation: 'ingestion.pii' | 'ingestion.jws';
   }
   ```

   `isPiiUnavailable` becomes `matchesDomain(outcome, domain)`; `runRetryBurst`/`parkAndReprobe` take a `TransientSkipDomain` and read everything domain-specific from it. The handler resolves the domain from the outcome's `reason` and runs the same code for both.

2. Add a second `CircuitBreaker` in [`index.ts`](../../../cch-mla/src/index.ts) (`jwsKeyStoreBreaker`), a `JwsConfig` block mirroring `PiiConfig`'s four retry fields (`JWS_MAX_RETRIES`, `JWS_RETRY_BASE_MS`, `JWS_CIRCUIT_BREAKER_THRESHOLD`, `JWS_REPROBE_INTERVAL_MS`), a `mla_jws_keystore_breaker_state` gauge and a `mla_keystore_unavailable_total` counter in [`metrics.client.ts`](../../../cch-mla/src/clients/metrics.client.ts), and an `Alert.raiseKeyStoreUnavailableAlert` (severity `failure` — every event on every partition is affected, which is the systemic tier, not the per-record one).

3. Remove `key-source-unavailable` from `metrics.incrementRejection` / `logEnvelopeSkip` in [`ingestion-outcome-logging.service.ts`](../../../cch-mla/src/services/ingestion-outcome-logging.service.ts) — it is no longer a rejection — the same way `pii-secret-unavailable` was removed from that dispatcher.

4. Fold key-store load state into readiness: `FilePublicKeyStoreClient` exposes `isLoaded(): boolean` (`this.loadError === undefined`); [`health.service.ts`](../../../cch-mla/src/services/health.service.ts) gains a `jwsKeyStore: 'UP' | 'DOWN'` field on `ReadinessReport` that pulls `status` to `DOWN` the way `piiSecret` does. This is instance-local (a directory this replica reads), so it passes the §8 readiness rule for the same reason the PII secret does.

### Why this and not the alternatives

- *"Keep it permanent but add an alert"* — still discards events the audit topic could have replayed. The alert would tell an operator that events are gone, not save them.
- *"Refuse to start if the directory is missing at boot"* — right for boot (and F-03 gets there), but the defect is a *mid-run* outage, which no boot check addresses.
- *"Reuse the PII breaker instance"* — the two dependencies fail independently; sharing a counter would let a key-store outage trip the "PII" breaker and confuse every gauge and alert built on it.

### Failing test first

In `ingestion-consumer.service.test.ts`, replace the test at lines 409-421 with one that mocks `verifyJws` to return `key-unavailable` persistently and asserts: `kafka.advance` **not** called; `kafka.pause(partition)` called; `alert.raiseRetryExhaustionAlert` called after the burst; after the mock flips to `valid` and one reprobe tick elapses (fake timers), `ppaClient.deliver` called, `kafka.advance` called, `kafka.resume` called. Add a parallel to the existing PII breaker-trip test for the new breaker. In `health.service.test.ts`: `jwsKeyStore: 'DOWN'` ⇒ `status: 'DOWN'`.

### Live verification

Scenario library: start the stack, `chmod 000 tools/dfsp-keys/store` mid-feed, observe `mla_partition_paused=1` on every active partition and zero advance in `mla_consumer_lag`; restore permissions; observe resume and the full record count arriving at `ppa-stub` with no gap. This is the same shape as the existing PII-outage scenario and should be added to `tools/scenario-library/scenarios.ts` beside it.

---

## F-02 — Scope the `httpPath` id fallback

### The fix

In [`envelope-builder.service.ts`](../../../cch-mla/src/services/envelope-builder.service.ts), the fallback fires only for the one operation whose canonical record is known to need it, and only when the path has the shape that operation's path actually has:

```ts
/** The one canonical record whose id lives in httpPath, not a tag - 14/14 in raw_export_500 (see comment above). */
const HTTP_PATH_ID_FALLBACK_OPERATION = 'putFxQuotesByID';
/** `/fxQuotes/{conversionRequestId}` - exactly two segments, the second being the id. */
const FX_QUOTE_CALLBACK_PATH = /^\/fxQuotes\/([^/]+)$/;

const idFromHttpPathFallback = (record: AuditRecordBody): string | undefined => {
  const { operation, httpPath } = record.metadata.trace.tags;
  if (operation !== HTTP_PATH_ID_FALLBACK_OPERATION || httpPath === undefined) return undefined;
  return FX_QUOTE_CALLBACK_PATH.exec(httpPath)?.[1];
};
```

Any other operation missing its primary tag now fails construction as `incomplete-envelope` ("missing id") — which is what US-MLA-04's AC says should happen, and which the existing `logEnvelopeSkip` already logs at `error` and counts.

### Why this and not the alternatives

- *"Blocklist the resource names (`quotes`, `transfers`, `error` …)"* — enumerates what is wrong instead of what is right; the next unforeseen path shape gets through. An allowlist of one operation and one regex is the smallest correct rule.
- *"Drop the fallback and require the tag"* — would break every `putFxQuotesByID` record in the captures (14/114), which genuinely lack the tag.

### Failing test first

In `envelope-builder.service.test.ts`: take the real `postQuotes` and `postFxQuotes` fixtures, delete `tags.quoteId`/`tags.conversionRequestId`, assert `buildEnvelope` returns `incomplete` with `detail` containing `missing id`. Take the real `putQuotesByID` fixture, delete `tags.quoteId`, set `httpPath` to `/quotes/{id}/error`, assert `incomplete`. Keep the existing `putFxQuotesByID` fallback test green. Add one with `httpPath: '/fxQuotes/'` (trailing slash, empty id) asserting `incomplete`.

### Live verification

`npm run golden:ingestion:all` must still pass with identical goldens — this fix changes no decision on any record in the captures, and the golden run is the proof.

### Note for the plan

`plan.md` §3.2's tag-availability table already needs the correcting footnote the current code comment describes; this is the moment to write it, and to add a row to `plan.md` §14 (questions for COMESA) asking CCH to confirm the four id tags survive in production (FSD Open Item #7).

---

## F-03 — No defaults for security-relevant configuration

### The fix

In [`config.service.ts`](../../../cch-mla/src/services/config.service.ts), make these `readRequiredString`, unconditionally: `PPA_BASE_URL`, `PPA_CLIENT_CERT_PATH`, `PPA_CLIENT_KEY_PATH`, `PPA_CA_CERT_PATH`, `JWS_PUBLIC_KEY_DIR`, `PII_SECRET_PATH`. Additionally validate at load time that each path **exists and is readable** (`fs.accessSync(path, R_OK)`) and that `JWS_PUBLIC_KEY_DIR` is a directory — so a wrong path is a boot failure, not a `key-source-unavailable` on the first record. (`FilePiiSecretClient`'s "a load failure does not throw, readiness reports DOWN" behaviour is kept for the *content* of the secret; the *path* being wrong is a config error and fails fast.)

The local harness is unaffected: `.env` (git-ignored) already sets all six, and `.env.template` already lists them. Move the current default strings into `.env.template` as the documented harness values, with a comment that they are harness paths.

### Why this and not the alternatives

- *"Require only when `NODE_ENV=production`"* — `NODE_ENV` itself defaults to `dev` in this file, so a deployment that forgets `NODE_ENV` also gets the test keys. The rule in §8 is unconditional for a reason.
- *"Keep the defaults but log a warning"* — a warning is exactly the "silent default" the rule forbids, one log level up.

### Failing test first

In `config.service.test.ts`: `loadConfiguration({})` (and with only the Kafka block set) throws naming each of the six variables in turn; a set-but-nonexistent path throws with the path in the message; the existing "defaults" assertions for these six are deleted.

### Live verification

`npm run dev` with `.env` present starts; with `.env` renamed, refuses to start with the named variable in the bootstrap log line. `docker build` + `docker run` with no env: exits 1 with the same message (the Dockerfile copies no `.env`, so this is the production shape).

---

## F-04 — Enforce the JWS protected-header claims

### The fix

In [`jws-verification.service.ts`](../../../cch-mla/src/services/jws-verification.service.ts), after `decodeProtectedHeader` and the `alg` check, and **before** the cryptographic verify (a claim mismatch is cheaper to reject than a signature), add:

```ts
/** Mojaloop's FSPIOP JWS binds these into the protected header so a signature is valid for *this* request, not merely this body. Confirmed present on 129/129 signed canonical records (qa-review-findings.md F-04). */
const checkBoundClaims = (record: AuditRecordBody, header: ProtectedHeader): string | undefined => {
  const { headers } = record.content;
  const { httpMethod, httpPath } = record.metadata.trace.tags;
  if (header['FSPIOP-Source'] !== headers['fspiop-source']) return 'protectedHeader FSPIOP-Source does not match fspiop-source header';
  if (header['FSPIOP-Destination'] !== headers['fspiop-destination']) return 'protectedHeader FSPIOP-Destination does not match fspiop-destination header';
  // Header is upper-case, tag is lower-case on 100/129 records - compare case-insensitively, never by exact string.
  if (httpMethod !== undefined && String(header['FSPIOP-HTTP-Method']).toLowerCase() !== httpMethod.toLowerCase())
    return 'protectedHeader FSPIOP-HTTP-Method does not match tags.httpMethod';
  // prepareTransfer / prepareFxTransfer carry no httpPath tag at all (0/25) - the URI claim is checked only where the tag exists (104/104 match there).
  if (httpPath !== undefined && header['FSPIOP-URI'] !== httpPath) return 'protectedHeader FSPIOP-URI does not match tags.httpPath';
  return undefined;
};
```

A mismatch returns `{ outcome: 'invalid-signature', reason }` — the same permanent, security-alerted path a bad signature takes, which is correct: a signature that verifies over claims that contradict the transport metadata is evidence of substitution, not of an outage.

`ProtectedHeader` in [`jws.interface.ts`](../../../cch-mla/src/interfaces/jws.interface.ts) gains the four named optional fields and its comment drops "never re-derived from them".

**`Date` is deliberately not checked.** Replay-window enforcement needs a clock-skew policy and a per-DFSP nonce/window store that the stories do not specify; it is a separate story to raise, not something to fold into this fix.

### Why this and not the alternatives

- *"Compare `FSPIOP-URI` against a resource derived from `operation`"* for the records with no `httpPath` — invents a mapping the captures do not give us. Checking where the tag exists and skipping where it does not is honest about what can be verified.
- *"Only check `FSPIOP-Source`"* — Source alone does not stop a destination or method swap, and method is what `msgType` is derived from.

### Failing test first

In `jws-verification.service.test.ts`, the existing helper builds a protected header with `alg` and `FSPIOP-Source` only ([line 56](../../../cch-mla/__tests__/jws-verification.service.test.ts)) — extend it to emit all five claims from the record, then add one test per claim that mutates the *transport* side (header/tag) after signing and asserts `invalid-signature` with the specific reason. Add the case-insensitive method test (`PUT` vs `put` ⇒ valid) and the no-`httpPath` test (claim present, tag absent ⇒ valid).

### Live verification

`npm run golden:ingestion:all` and the full `npm run scenario:all` must pass unchanged — `capture-feeder --resign` re-signs with the real protected-header claims, so if the check is wrong about the capture shape, the golden run says so. Also run `tools/verify-tokenization/run.ts` end to end, since it exercises re-signed records through the live pipeline.

---

## F-05 — Make the breaker trip mean something

### The fix

Implement `core-knowledge.md` §3.5's two stages as two distinct reprobe behaviours in `parkAndReprobePpa` (and, via the F-01 generalisation, in the local-dependency park too):

| Breaker state | What a reprobe tick does | Rationale |
| --- | --- | --- |
| **Closed** (park, `consecutiveFailures < threshold`) | `deliver(envelope)` — retry the parked event directly, as now | "pause the offset on that event ... keep periodically retrying the same paused event" |
| **Tripped** | `ppaClient.probeReady()` — `GET /health/ready`. Only on a 200 does the tick then `deliver(envelope)`. | "stop attempting the paused event directly ... re-probe PPA health on a configurable interval; resume ... once a probe succeeds" |

Add `probeReady(): Promise<boolean>` to the `PpaClient` port ([`ppa.interface.ts`](../../../cch-mla/src/interfaces/ppa.interface.ts)) and implement it in `HttpsPpaClient` with the same `AbortController` timeout and the same mTLS options as `deliver` (US-PPA-01 defines `/health/ready` on PPA; `ppa-stub` already serves it at [`tools/ppa-stub/routes.ts:76`](../../../cch-mla/tools/ppa-stub/routes.ts)). A probe failure counts as a breaker failure (keeps `tripped`), a probe success is *not* itself a breaker success — only the subsequent successful `deliver` is, so `justRecovered` still fires on real recovery.

This gives `PPA_CIRCUIT_BREAKER_THRESHOLD` and `mla_ppa_breaker_state` their intended meaning: below threshold, MLA keeps knocking with the real envelope; at threshold it stops sending payment payloads at a PPA it knows is down and waits for the health endpoint instead.

### Why this and not the alternatives

- *"Trip ⇒ pause, otherwise ⇒ don't pause"* (i.e. keep retrying the parked event *without* pausing the partition below threshold) — cannot work: once `eachMessage` returns, kafkajs will fetch the next record on that partition, and there is no way to hold the offset on record N while processing N+1 without breaking N1's ordering guarantee. The partition pause on first park is necessary; what was missing is stage two's *behaviour*, not stage one's pause.
- *"Use the envelope as the health probe"* (status quo) — each tick costs a full `timeoutMs` (2 s) POST of payment data at a service known to be down, per parked partition.

### Failing test first

In `ingestion-consumer.service.test.ts`: with `circuitBreakerThreshold: 2`, drive two parks on one partition; assert that subsequent reprobe ticks call `ppaClient.probeReady` and **not** `ppaClient.deliver` until `probeReady` resolves `true`, then `deliver` once, then `advance` and `resume`. Assert that below threshold, ticks call `deliver` and never `probeReady`.

### Live verification

The existing persistent-503 scenario: after `PPA_CIRCUIT_BREAKER_THRESHOLD` failures, `ppa-stub`'s `received.jsonl` must show **no further POSTs** while its `/control` holds it in 503, and `/health/ready` hits at `reprobeIntervalMs` cadence instead; clear the fault, observe one POST, one advance, `mla_ppa_breaker_state` → 0.

---

## F-06 — Safe key-store reload

### The fix

In [`public-key-store.client.ts`](../../../cch-mla/src/clients/public-key-store.client.ts):

1. **Debounce** the watch callback (e.g. 250 ms, config `JWS_RELOAD_DEBOUNCE_MS` under F-07's validation) so a burst of filesystem events produces one reload after the writes settle.
2. **Validate every PEM before swapping the map in**: `crypto.createPublicKey(pem)` throws on a truncated or malformed key. A directory with *any* unparsable `.pem` is a failed reload: log which file, keep the previous map, and set `loadError` — i.e. the store reports `unavailable` (which after F-01 is transient) rather than `found` with a key that will make `crypto.verify` throw.
3. **Treat disappearance as unavailability during a grace window**: keep `previousKeys`; if a reload succeeds but a DFSP present in `previousKeys` is now absent, do not immediately serve `not-found` for it — hold the previous map for one debounce interval more and reload again. If it is still absent, accept the removal (a genuine de-registration must be possible). Simpler alternative that is also acceptable: accept removals immediately but log them at `warn` with the DFSP id, so an operator can correlate a `SECURITY: invalid FSPIOP-Signature ... no registered public key for DFSP "x"` burst with a key removal.
4. Store parsed `KeyObject`s, not PEM strings — `crypto.verify` accepts a `KeyObject`, which avoids re-parsing the PEM on every event (a small hot-path win) and makes (2) free.

### Why this and not the alternatives

- *"Poll the directory on an interval instead of `fs.watch`"* — polling has the same partial-read problem and adds latency; the fix is validation and debounce, not the notification mechanism.
- *"Atomic directory swap by convention (write to `.tmp`, rename)"* — right operational advice for whoever mounts the keys, and worth documenting, but the service must be correct when the convention is not followed. Kubernetes Secret mounts *do* swap atomically via a `..data` symlink; a plain volume or `kubectl cp` does not.

### Failing test first

In `public-key-store.client.test.ts` (which already exercises the real `fs.watch`): write half of a valid PEM, assert `getKey` still returns the previous key (or `unavailable`), complete the write, assert `found` with the new key; write three files in quick succession and assert `reload` ran once; write a garbage `.pem` and assert `unavailable` with the filename in `reason`, and that the other DFSPs' keys are still served after the file is removed.

### Live verification

With the feeder running: `cp` a 4 KiB PEM into the store directory under `pv -L 1k` (1 KiB/s) and confirm zero `SECURITY:` lines and zero `mla_rejected_total{reason="invalid-signature"}` increments during the copy.

---

## F-07 — Bound every numeric setting

### The fix

Replace `readNumber(env, name, fallback)` with `readNumber(env, name, fallback, { min, max, integer })` and apply bounds:

| Variable | Bounds | Reason |
| --- | --- | --- |
| `PPA_TIMEOUT_MS` | integer, 100 … 60 000 | below 100 ms nothing completes a TLS handshake; above 60 s the burst arithmetic below cannot hold |
| `PPA_MAX_RETRIES`, `PII_MAX_RETRIES`, `JWS_MAX_RETRIES` | integer, 0 … 10 | 0 is a legitimate "park immediately"; > 10 makes the ceiling sum meaningless |
| `PPA_RETRY_BASE_MS`, `PII_RETRY_BASE_MS`, `JWS_RETRY_BASE_MS` | integer, 10 … 30 000 | |
| `*_CIRCUIT_BREAKER_THRESHOLD` | integer, 1 … 1 000 | 0 would trip on the first failure, making stage one (F-05) unreachable |
| `*_REPROBE_INTERVAL_MS`, `KAFKA_LAG_POLL_INTERVAL_MS`, `JWS_RELOAD_DEBOUNCE_MS` | integer, 100 … 3 600 000 | never a tight loop |
| `ALERT_WEBHOOK_TIMEOUT_MS` | integer, 100 … 30 000 | |

And **one cross-field invariant**, because it is the one that evicts the consumer from the group: the worst-case blocking time inside `eachMessage` must stay under the session timeout with margin. With full jitter the burst ceiling is the sum of the ceilings plus one full timeout per attempt:

```
ppaBurstMaxMs = retryBaseMs × (2^maxRetries − 1) + (maxRetries + 1) × timeoutMs
piiBurstMaxMs = piiRetryBaseMs × (2^piiMaxRetries − 1)          (no I/O per attempt)
jwsBurstMaxMs = jwsRetryBaseMs × (2^jwsMaxRetries − 1)
```

Under today's defaults: PPA 1000×7 + 4×2000 = 15 000 ms; PII 7 000 ms; and one record can incur a PII (or JWS) burst *and then* a PPA burst sequentially: 22 000 ms against kafkajs's default 30 000 ms `sessionTimeout`. That is an 8 s margin nobody chose. The F-08 fix (heartbeating inside the burst) removes the eviction risk properly; until then, `loadConfiguration` should compute `piiBurstMaxMs + ppaBurstMaxMs` (and the JWS variant) and refuse values whose sum exceeds a `KAFKA_SESSION_TIMEOUT_MS` setting (default 30 000, made explicit and passed to `kafka.consumer({ sessionTimeout })`).

### Failing test first

One table-driven test in `config.service.test.ts`: for each variable, `min − 1`, `max + 1`, `"1.5"` where integer is required, and `"-1"` each throw with the variable name and the bound in the message; `min` and `max` themselves load. One test for the burst invariant with values that sum past the session timeout.

### Live verification

None needed beyond the suite — this is boot-time validation of pure input. Confirm `npm run dev` still boots with the current `.env`.

---

## F-08 — Stop one partition's retry from stalling the others

### The fix

Two independent changes, both in [`kafka.client.ts`](../../../cch-mla/src/clients/kafka.client.ts) and the handler:

1. **Consume partitions concurrently.** `consumer.run({ autoCommit: false, partitionsConsumedConcurrently, eachMessage })` with a new `KAFKA_PARTITIONS_CONSUMED_CONCURRENTLY` setting (integer, 1 … 64; default: the number of partitions the topic is expected to have — the scenario library uses a 3-partition topic, so 4 is a reasonable default and CCH supplies the production value alongside the group id). kafkajs still processes one message at a time *per partition*, so per-partition ordering — which the offset contract depends on — is unchanged. The handler's shared state is already safe for this: `PpaCircuitBreaker` is a per-partition map; the PII/JWS breakers are single-threaded counters mutated synchronously; `kafka.pause/resume/advance` are per-partition. What is *not* automatically safe is F-10's park registry, which must be keyed by partition — it is, by construction.

2. **Heartbeat during a burst.** kafkajs passes `heartbeat: () => Promise<void>` into `eachMessage` (verified: `runner.js` line 235). Surface it on `ConsumedMessage` as `heartbeat: () => Promise<void>` and call it inside `runRetryBurst` / `runPpaRetryBurst` after each `delay`. kafkajs's own `heartbeat()` is rate-limited to `heartbeatInterval` (default 3 000 ms) internally, so calling it every iteration is cheap. This removes the F-07 cross-field invariant's role as the only thing standing between a long burst and a group eviction.

### Why this and not the alternatives

- *"Move the burst off `eachMessage` entirely and park immediately"* — makes every transient blip a park + partition pause + alert. The burst's purpose is to absorb sub-second blips silently; keeping it, but heartbeating through it and letting other partitions proceed, preserves that.
- *"`partitionsConsumedConcurrently` = number of partitions, hardcoded"* — N6. The topic's partition count is CCH's to state (R-18's territory).

### Failing test first

`kafka.client.test.ts`: assert `consumer.run` is called with `partitionsConsumedConcurrently` from config. `ingestion-consumer.service.test.ts`: with a `deliver` that fails transiently once, assert `message.heartbeat` was called at least once during the burst.

### Live verification

Load test (`tools/load-test/run.ts`) at 125 TPS with `ppa-stub` injecting a single 5xx on partition 0: `mla_consumer_lag{partition="1"}` and `{partition="2"}` must not rise during partition 0's burst. Compare against the current build, where they do.

---

## F-09 — Exit on `uncaughtException`

### The fix

In [`index.ts`](../../../cch-mla/src/index.ts):

```ts
process.on('uncaughtException', (err) => {
  service.logger.error('uncaughtException - exiting; the orchestrator restarts a clean instance', err, { serviceOperation: 'process' });
  // Best-effort flush; never await anything that could itself throw here.
  process.exit(EXIT_CODE_ERROR);
});
```

`unhandledRejection` can stay log-only *only if* F-10 and F-11 are done (they remove the floating promises that are the realistic source); otherwise it should exit too. pino's default destination is synchronous for `stdout` (`pino.destination` with `sync: true` is the default for fd 1), so the line is written before `exit` returns.

### Failing test first

`index.ts` is excluded from coverage and has no test file; this is a two-line change verified by review. If a bootstrap test is ever added, it asserts `process.exit(1)` is called from the handler.

### Live verification

Send the running process a synthetic uncaught throw (a one-line `node -e` against a debug hook is overkill — `kill -USR1` will not do it; the honest verification is a temporary `setTimeout(() => { throw new Error('x') })` in a dev build, observing exit code 1 and the orchestrator restart). Say plainly in the `plan.md` entry that this was verified in a dev build only.

---

## F-10 — Reprobe chains that cannot die silently

### The fix

Three changes in [`ingestion-consumer.service.ts`](../../../cch-mla/src/services/ingestion-consumer.service.ts):

1. **Re-arm in `finally`.** Both `reprobe` functions move their trailing `setTimeout(...)` into a `finally` block so no exception path can skip it, and the `catch` itself is wrapped so a throwing logger cannot escape:

   ```ts
   const reprobe = async (): Promise<void> => {
     let done = false;
     try { /* attempt; on settle set done = true and return */ }
     catch (err) { try { logger.error(...) } catch { /* nothing left to log with */ } }
     finally { if (!done && !signal.aborted) schedule(reprobe); }
   };
   ```

   (The empty inner `catch` is the one place §6.2's "never swallow" is deliberately overridden, with the reason in the comment: the logger is the thing that failed.)

2. **A park registry.** A `ParkRegistry` (constructed at the composition root, injected in `IngestionHandlerDeps`) holds `Map<partition, { kind: 'pii' | 'jws' | 'ppa'; correlationId; parkedAt; lastTickAt; timer }>`. `parkAndReprobe*` registers on entry, updates `lastTickAt` every tick, and deregisters on settle. This is process-local operational bookkeeping about this instance's own paused partitions — the same category as the breakers, not the cross-replica state §7 forbids.

3. **A watchdog.** `KafkaClient` (or a small `ParkWatchdog` started from `index.ts`) runs every `max(reprobeIntervalMs) × 3`: for every partition with `mla_partition_paused=1` — the registry knows them — if `now − lastTickAt > reprobeIntervalMs × 3`, raise `alert.raiseParkStalledAlert` (`failure`) and re-arm the tick. Also expose `mla_park_age_seconds{partition}` so a long park is visible as a growing number, not a flat 1.

4. **Fix the comment** at lines 501-509 to describe the code as it is: `resolveOutcome` runs first; the partition is resumed only if it settled; the resume-then-repause artefact no longer exists.

### Failing test first

With fake timers: make `logger.error` throw on the reprobe's failure path and assert the next tick is still scheduled. Register a park, advance the clock past `3 × reprobeIntervalMs` without ticking, assert `raiseParkStalledAlert` fires and a tick runs.

### Live verification

Chaos scenario: `SIGSTOP` `ppa-stub` (so deliveries time out rather than fail fast) for `> 3 × reprobeIntervalMs`, `SIGCONT`, and confirm recovery; then inject a thrown error from the fake logger in a dev build and confirm the watchdog alert and the re-armed tick appear.

---

## F-11 — Cancel parks on shutdown; exit non-zero on failure

### The fix

1. `createIngestionHandler` takes an `AbortSignal` in `IngestionHandlerDeps` (`index.ts` owns the `AbortController`). Every `schedule(reprobe)` is `const t = setTimeout(...); signal.addEventListener('abort', () => clearTimeout(t), { once: true })`, and the F-10 `finally` checks `signal.aborted` before re-arming. The F-10 registry gives `shutdown` the list to cancel if a signal is not preferred.
2. `shutdown` order becomes: abort parks → `kafka.disconnect()` (kafkajs waits for in-flight `eachMessage`) → `keyStore.close()` → `server.close()`. A parked record's offset is uncommitted by design, so cancelling its reprobe loses nothing — the next instance redelivers it.
3. `shutdown` rethrows after logging, so `registerSignalHandlers`' `.catch` exits with `EXIT_CODE_ERROR`; today the `try/catch` inside `shutdown` guarantees the `.then` branch and exit 0.
4. `setInterval` for lag polling and any watchdog: `.unref()` so a test harness or a stuck shutdown cannot be kept alive by them.

### Failing test first

`ingestion-consumer.service.test.ts`: park a record, abort the signal, advance fake timers past several intervals, assert `deliver` is not called again and `jest.getTimerCount()` is 0.

### Live verification

`SIGTERM` the running service while a partition is parked: log shows the park cancelled, exit code 0; kill `ppa-stub` first so `disconnect` throws, `SIGTERM` again, exit code 1.

---

## F-12 — Track the real consumer connection state

### The fix

In `KafkaClient`'s constructor:

```ts
const { CONNECT, DISCONNECT, CRASH, GROUP_JOIN } = this.consumer.events;
this.consumer.on(CONNECT, () => { this.connected = true; });
this.consumer.on(DISCONNECT, () => { this.connected = false; });
this.consumer.on(CRASH, ({ payload }) => {
  this.connected = false;
  this.logger.error('Kafka consumer crashed', payload.error, { serviceOperation: 'KafkaClient.crash' });
  // payload.restart === false means kafkajs has given up (non-retriable) - that is Fatal (§6.1): exit and let the orchestrator restart.
});
this.consumer.on(GROUP_JOIN, ({ payload }) => this.logger.log(`Joined group ${payload.groupId} as ${payload.memberId}`, ...));
```

(Event names verified in `kafkajs/types/index.d.ts` lines 902-910.) `connect()`/`disconnect()` stop setting the flag themselves. `GROUP_JOIN` also gives the watchdog (F-10) the signal it needs to **clear stale parks after a rebalance**: a partition this instance no longer owns must have its park cancelled, since its reprobe would otherwise commit an offset on a partition another instance is now consuming. `payload.memberAssignment` lists the current assignment.

### Failing test first

`kafka.client.test.ts` already builds a fake kafkajs consumer; extend it with an `on`/`emit` and assert `isConnected()` flips on `DISCONNECT` and back on `CONNECT`; assert a `GROUP_JOIN` without partition 2 in the assignment cancels a park registered on partition 2.

### Live verification

The existing two-instance rebalance scenario: park a partition on instance A, start instance B, confirm A's park is cancelled on `GROUP_JOIN` if the partition moved, and that B redelivers it (`ppa-stub` sees exactly one 200 for that `correlationId`'s `id`/`msgType`). Then `docker stop` the broker for 10 s and confirm `/health/ready` reports `kafka: DOWN` during it.

---

## F-13 — Honour `PPA_BASE_URL`'s path

### The fix

In `HttpsPpaClient`'s constructor, keep `this.basePath = url.pathname.replace(/\/+$/, '')` and in `deliver` (and F-05's `probeReady`) use `path: \`${this.basePath}${resolvePpaEndpoint(eventType)}\``. Reject a `baseUrl` with a query string or fragment at config-load time (`url.search !== '' || url.hash !== ''` ⇒ throw). Set `port: url.port === '' ? undefined : Number(url.port)` so the default-443 behaviour is explicit rather than a falsy-string accident.

### Failing test first

`ppa.client.test.ts` already runs a real TLS server; add a case with `baseUrl: 'https://localhost:<port>/mla/v1'` and assert the server receives `/mla/v1/QUOTES`. Config test: `PPA_BASE_URL=https://x/?a=b` throws.

### Live verification

Run `ppa-stub` behind any local reverse proxy with a prefix (Caddy/nginx one-liner) and confirm delivery — or, more simply, add a `--prefix` flag to `ppa-stub` and use it in one scenario.

---

## F-14 — Explicit TLS, connection reuse, reloadable certificates

### The fix

1. **One `https.Agent`, built in the constructor**, carrying the TLS material and policy, and reused by every request:

   ```ts
   this.agent = new https.Agent({
     keepAlive: true,
     maxSockets: config.maxSockets,          // new PPA_MAX_SOCKETS, integer 1…256, default 32
     key, cert, ca,
     minVersion: 'TLSv1.2',                  // US-SEC-01 / core-knowledge §10: enforced, not inherited from Node's default
     rejectUnauthorized: true,               // explicit, not inherited
   });
   ```

   and `https.request({ agent: this.agent, host, port, path, method, headers, signal })`. This removes the per-event TLS handshake (the dominant cost against the 200 ms p95 at 125 TPS) and makes the TLS policy visible in code. Keep the socket-level `'connect'` tracking for `classifyTransportError`; with keep-alive, a reused socket has already connected, so `tcpConnected` should be initialised from `socket.connecting === false` rather than only from the `'connect'` event.

2. **Certificate rotation without restart.** US-SEC-01 says the mechanism (hot-reload vs rolling restart) is to be *confirmed with CCH before implementation* — that confirmation is outstanding and is the external decision here. Build against the reversible default: watch the three cert paths (debounced, validated with `tls.createSecureContext` before use, exactly as F-06 validates PEMs) and on change construct a **new** `Agent`, swap `this.agent`, and `destroy()` the old one after its in-flight requests drain. If CCH answers "rolling restart", the watcher is deleted; nothing else changes.

3. **Certificate expiry metric** (US-SEC-01's 30-day warning): parse `notAfter` from the client cert with `new crypto.X509Certificate(cert)` at load and expose `mla_client_cert_expiry_seconds`; the alert rule belongs to the Prometheus stack (R-37), not to this code.

### Failing test first

`ppa.client.test.ts`: the test TLS server sets `maxVersion: 'TLSv1.1'` and the client must fail with `tls-handshake-failure`; two sequential `deliver` calls reuse one socket (assert the server's `'connection'` count is 1); replacing the client cert on disk with one the test CA did not sign flips the next delivery to `tls-handshake-failure` without reconstructing the client.

### Live verification

Load test before/after at 125 TPS: `mla_ack_latency_ms` p95 must drop measurably (record both numbers in the `plan.md` entry). Rotate `ppa-stub`'s CA-signed client cert mid-feed and confirm zero delivery failures.

### External decision to surface

Hot-reload vs rolling-restart for mTLS material — CCH, per US-SEC-01. Does not block building against the hot-reload default; blocks calling US-SEC-01's MLA share closed.

---

## F-15 — PII in the 4xx log line

### The decision that is not engineering's

US-MLA-07's AC ("log the full envelope as an error") and N7 ("no raw PII in any log") conflict for every TRANSFER/FXTRANSFER envelope, because the ILP packet is exempt from tokenization by design (core-knowledge.md §4.1). **The story author / CCH must reconcile them.** Two honest options to put to them: (a) N7 wins — the log carries a masked envelope and the operator retrieves the full rejected body from PPA's own write-ahead record (PPA persists before responding, so a 4xx it returned is a 4xx it has the body for — US-PPA-02); (b) the AC wins — the log carries the full envelope and the log store is designated a PII-bearing system with the retention and access controls that implies (US-AUD-01's masking rules would then apply to *MLA's* logs too, which they currently do not).

### The interim to build against (reversible, option (a))

A pure `maskEnvelopeForLog(envelope): unknown` in `services/`, used only by `logPpaPermanentRejection`:

- `body.ilpPacket` → `"<redacted ilpPacket, N chars>"`.
- Any `personalInfo` object → `"<redacted personalInfo>"`; any `partyIdInfo.partyIdentifier` value that does not start with `tkn_` → `"<redacted partyIdentifier>"`; `dateOfBirth` → redacted. (Note for the story author: the tokenization table leaves `payee.personalInfo.complexName` and both parties' `dateOfBirth` in cleartext on QUOTE envelopes, so even tokenized envelopes carry PII to PPA — that is built to the table as written, and is a separate observation for the PII story's owner.)
- Everything else — identifiers, amounts, currencies, fees, FSP ids, headers, `error` — logged verbatim, since that is what an operator needs to diagnose a 4xx.
- Log `sha256(JSON.stringify(envelope))` alongside, so the masked line can be matched to PPA's stored record byte-for-byte if needed.

Controlled by `LOG_REJECTED_ENVELOPE_MODE=masked|full` (default `masked`), so option (b) is a config flip if CCH chooses it, and the decision is visible in config rather than buried in code.

### Failing test first

`ingestion-outcome-logging.service.test.ts` (new file — this module currently has no test of its own; it is covered via the consumer tests): a real TRANSFER fixture through `logPpaPermanentRejection`, assert the logged string does not contain the fixture's `ilpPacket` value and does contain its `transferId` and `amount`.

---

## F-16 — Bound the alert webhook

### The fix

In `WebhookAlertClient`:

1. **In-flight cap**: `maxInFlight` (new `ALERT_WEBHOOK_MAX_IN_FLIGHT`, integer 1 … 100, default 8). When at the cap, the alert is **not** sent; `mla_alerts_dropped_total{type}` is incremented and one `warn` line is logged per `type` per minute (not per drop). The metrics-based sink (`mla_alerts_total`) is unaffected — it is the primary path and is what Alertmanager rules against; the webhook is a secondary courtesy path and losing a burst of it must never cost the pipeline anything.
2. **Coalescing for per-attempt alerts**: `raiseTokenizationFailureAlert` (and F-01's key-store equivalent) fire per *attempt*. Coalesce per `type` within `ALERT_WEBHOOK_COALESCE_MS` (default 10 000): the first occurrence goes out immediately, subsequent ones within the window increment a counter, and one summary (`"… ×N in the last 10 s"`) goes out at window end. Security and rejection alerts are per-record events and are *not* coalesced — each is individually actionable.

### Failing test first

`alert.client.test.ts`: with a `fetch` mock that never resolves, raise 20 alerts, assert 8 `fetch` calls and `incrementAlertDropped` called 12 times; resolve them, raise one more, assert a 9th call. Raise 50 tokenization-failure alerts inside the window with fake timers, assert 1 immediate `fetch` and 1 summary at window end.

---

## F-17 — Retry the commit, not the delivery

### The fix

In `resolvePartition`, on `advance()` throwing, schedule a **commit-only** retry (`retryAdvance`) on the same interval, and do not call `deliver` again. Bound it: after `PPA_COMMIT_RETRY_MAX` (default 10) failures, raise `raiseCommitFailureAlert` (`failure`) and keep retrying — never give up on a commit for a delivered record, and never advance past it, because the alternative is the F-12 rebalance case where another instance redelivers (harmless to PPA thanks to idempotency, but a duplicate MLA could have avoided). The same commit-only retry applies to `resolveOutcome`'s `advance` calls, which today let the exception propagate to the top-level `catch`, where the record is logged as "unhandled" and — because `eachMessage` returned normally — kafkajs moves on and the *next* record's commit silently covers this one. That is correct by accident (offsets are cumulative) and should be made explicit with a comment where the top-level `catch` handles an advance failure.

### Failing test first

Make `kafka.advance` reject once after a successful reprobe delivery; assert `deliver` call count stays at its pre-commit value and `advance` is called again on the next tick.

---

## F-18 — Cap the response body; make 3xx distinct

### The fix

- `deliver` stops reading after `PPA_MAX_RESPONSE_BYTES` (default 64 KiB); anything beyond is discarded and the classification proceeds on status alone. PPA's contract is a status code and at most a short JSON error body; MLA never needs more.
- Add `{ outcome: 'unexpected-status'; status; body }` to `PpaDeliveryResult` for anything not 200 / 4xx / 5xx. It stays in `isPpaTransient` (a 3xx from a misconfigured proxy still must not advance the offset) but `describePpaFailure` names it ("PPA returned unexpected HTTP 301 — a redirect or informational status MLA does not follow; check the PPA address / ingress") so the park alert says what is actually wrong. `mla_ppa_delivery_outcomes_total{outcome="unexpected-status"}` gives it its own series.

### Failing test first

`ppa.client.test.ts`: server responds 301 → `unexpected-status`; server streams 1 MiB → result classified, memory-bounded (assert `chunks` total ≤ cap via a spy on the response iterator, or simply that the call returns promptly).

---

## F-19 — Own-property lookups

### The fix

Replace the three plain-object tables indexed by untrusted strings with `ReadonlyMap`s:

```ts
const EVENT_TYPE_BY_OPERATION: ReadonlyMap<string, EventType> = new Map([...]);
const eventType = operation === undefined ? undefined : EVENT_TYPE_BY_OPERATION.get(operation);
```

Same for `CANONICAL_ACTION_BY_OPERATION`; and `isJwsAlgorithm` becomes `Object.hasOwn(ALGORITHM_TO_NODE_NAME, alg)`. `PARTY_LOOKUP_OPERATIONS` is already a `Set`. The tables keyed by the closed `EventType` union (`ID_TAG_BY_EVENT_TYPE`, `PPA_ENDPOINT_BY_EVENT_TYPE`, `TOKENIZE_PATHS_BY_EVENT_TYPE`) are safe as they are — their index is never an untrusted string.

### Failing test first

`event-classification.service.test.ts`: `operation: 'constructor'` and `'toString'` ⇒ `unclassifiable`. `canonical-record.service.test.ts`: `operation: 'constructor', action: 'start'` ⇒ not canonical (it already is, by accident — the test pins it). `jws-verification.service.test.ts`: `alg: 'constructor'` ⇒ `invalid-signature` with the *unsupported alg* reason, not the *verification threw* reason.

---

## F-20 — A floor under the jitter

### The fix

Decorrelated-jitter shape with an explicit floor, keeping the story's 1 s/2 s/4 s ceilings:

```ts
export const computeBackoffMs = (attempt, config, random = Math.random): number => {
  const ceiling = config.baseMs * EXPONENT_BASE ** (attempt - 1);
  const floor = ceiling * JITTER_FLOOR_FRACTION;   // 0.25 - "at least a quarter of this attempt's ceiling"
  return floor + random() * (ceiling - floor);
};
```

Attempt 1 draws in [250, 1000] ms, attempt 2 in [500, 2000], attempt 3 in [1000, 4000]; the sum is at least 1.75 s, which is enough for a PPA pod restart to be visible. The `random` injection point stays, so the existing determinism tests only need their expected values updated.

### Failing test first

`retry-backoff.service.test.ts`: `random = () => 0` returns `0.25 × ceiling`, not 0.

---

## F-21 — Fix the metric help text

### The fix

`metrics.client.ts:95`: "Consumer lag per partition: the broker high-water mark minus this consumer group's **committed** offset — deliberately not this instance's in-memory fetch position, so lag reflects what is durably acknowledged (see kafka.client.ts)." One line; no test.

---

## F-22 — Tokenization-failure alert severity

### The fix

Leave the per-attempt `raiseTokenizationFailureAlert` at `informational` (it is, correctly, a rate signal), but make the **park** that follows a tokenization retry-burst exhaustion raise at `failure`, not `informational` — today `raiseRetryExhaustionAlert` is `informational` for both the PII and the PPA park. Cleanest: `raiseRetryExhaustionAlert(message, context, severity)` with the PII/JWS callers passing `failure` (every QUOTE/FXQUOTE on this replica is now blocked — systemic) and the PPA caller passing `informational` (one partition's delivery is parked — live recovery). Update the `Alert` port comment and `alert.client.test.ts`'s severity assertions.

---

## Documentation that changes with these fixes

Per `engineering-rules.md` §12 and `CLAUDE.md`, each of the following is updated in the same commit as the code it describes:

| Document | Change |
| --- | --- |
| `plan.md` §16 | One entry per fix (or per batch, where F-05/F-08/F-10/F-11 land together), stating what was proven live versus unit-tested, in the entry format §16 gives. |
| `plan.md` §3.2 | Correcting footnote on `putFxQuotesByID`'s tag placement (F-02). |
| `plan.md` §14 | New question for COMESA/CCH: confirm the four id tags and `httpPath` survive in production (F-02, FSD Open Item #7). |
| `plan.md` §7.1 / §13 | Two new external decisions: mTLS rotation mechanism (F-14, US-SEC-01) and the 4xx-log PII conflict (F-15). |
| `core-knowledge.md` §3.3 | State that a key-source outage is *transient* (retry/park/breaker), and that the protected header's bound claims are enforced (F-01, F-04). Where this disagrees with US-MLA-05's text, the story wins and the story author is asked — record it as a finding, not a silent edit. |
| `core-knowledge.md` §3.5 | The two-stage breaker as built: park-and-retry below threshold, health-probe at/above (F-05). |
| `engineering-rules.md` §6.1 | Add "key store unavailable" to the Transient examples beside "TLS handshake failure". |
| `.env.template` | The six formerly-defaulted security paths become required, documented as harness values (F-03); every new variable introduced above (`JWS_*` retry block, `KAFKA_PARTITIONS_CONSUMED_CONCURRENTLY`, `KAFKA_SESSION_TIMEOUT_MS`, `PPA_MAX_SOCKETS`, `PPA_MAX_RESPONSE_BYTES`, `PPA_COMMIT_RETRY_MAX`, `ALERT_WEBHOOK_MAX_IN_FLIGHT`, `ALERT_WEBHOOK_COALESCE_MS`, `LOG_REJECTED_ENVELOPE_MODE`, `JWS_RELOAD_DEBOUNCE_MS`) with its bounds. |
| `EPICS/…/file-register.md` | Rows for every file each fix adds or changes, per `CLAUDE.md`'s convention. |
| `README.md` status section | Sweep for stale "current state" claims, per `CLAUDE.md`'s rule, once the batch closes. |

---

*End of Document*

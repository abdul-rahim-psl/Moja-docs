<!-- SPDX-License-Identifier: Apache-2.0 -->

# QA Sweep 2 — Findings (`cch-mla`, 2026-09-24) <!-- omit in toc -->

**Scope:** every file under `cch-mla/src/`, plus `deploy/kubernetes/`, `Dockerfile`, `eslint.config.mjs` and the test-suite layout. This sweep assumes the first review's register ([`qa-review-findings.md`](qa-review-findings.md), F-01 … F-22) as already known. It reports only what that register does not already contain, from the same senior-QA viewpoint and against the same authorities (`core-knowledge.md`, `engineering-rules.md`, the story text in `EPICS/`). Finding numbers continue from F-23 so every finding ID stays unique across the whole workstream. PPA is out of scope except where MLA's own behaviour depends on how the real `cch-ppa` is built. Those points were read from its source, and each is cited where it matters.

**Baseline at review time:** branch `paysys-remaining-bugs-f11-onwards` at `020a2be` (F-16), clean working tree. 27 suites, 483 tests, all green; zero lint errors. The suite being green is again no evidence about anything below: none of these findings is covered by a test.

**Verification method.** Every finding was confirmed against the source. Findings marked **verified-live** were reproduced by running the real code:

- a real MLA process against the harness Redpanda, isolated under a throwaway consumer group so no other consumer was rebalanced;
- the real `HttpsPpaClient` against a TLS listener configured exactly as `cch-ppa/src/clients/fastify.ts` configures PPA's;
- the real pipeline functions over all 500 records of `raw_export_500.json`.

Library claims were checked against the installed `node_modules` (kafkajs 2.2.4, Node v22.21.1). Every probe artefact was removed afterwards: the processes were stopped and the one auto-created topic was deleted.

- [Correctness first — the rule every fix is held to](#correctness-first--the-rule-every-fix-is-held-to)
- [Severity scale](#severity-scale)
- [Summary](#summary)
- [Critical](#critical)
- [High](#high)
- [Medium](#medium)
- [Low](#low)
- [Code quality and refactoring](#code-quality-and-refactoring)
- [Decisions that are not engineering's](#decisions-that-are-not-engineerings)
- [Test-suite gaps](#test-suite-gaps)
- [Findings index](#findings-index)

---

## Correctness first — the rule every fix is held to

> **No fix in this document may break the core business flow. Not partially, not temporarily, not "only on an edge case", not "only until the next finding lands". A fix that breaks the core flow is worse than the bug it fixes, and is not done, however well it fixes that bug.**

Every finding below is real, and several are serious. None of them is serious enough to justify a regression in what MLA exists to do. MLA currently moves every payment event from the DRPP audit topic to PPA correctly, and that has been proven live, end to end, against the real PPA. That working flow is the asset. Each fix is a change to it, and each change is a risk to it. This section applies to every finding (F-23 … F-42) and every refactor (Q-01 … Q-07) in this document, without exception.

### What "the core flow" means

Every one of these must hold after every fix exactly as it holds today:

1. **Consumption.** MLA consumes `topic-event-audit` under its configured group, and only that topic.
2. **Selection.** Exactly the canonical record of each operation is acted on. The 500-record capture produces exactly 116 forwarded envelopes and exactly the same skip buckets as today (the tally in F-40).
3. **Classification.** Each forwarded record gets the same `eventType` and `msgType` it gets today.
4. **Tokenization.** Every field in the Fields-to-Tokenize table is tokenized, with the same token value for the same input and key. Nothing outside the table changes, and nothing ILP-bound is touched.
5. **Envelope.** Every envelope is schema-valid, and carries the same `id`, `fspiop-source`, `fspiop-destination`, `body` and `error` it carries today.
6. **Delivery.** Each envelope is POSTed to the same PPA endpoint, and the real PPA accepts it with HTTP 200.
7. **Offset discipline.** An offset is committed only after PPA's HTTP 200, or after a deliberate, counted, alerted permanent rejection. Never on a transient failure, and never for a record that was not delivered.
8. **No silent loss.** Every consumed record ends in exactly one outcome: forwarded, skipped, rejected or parked. A parked record is eventually delivered, and none is dropped.
9. **Recovery.** A PPA outage parks and later resumes without a restart, with nothing lost and nothing reordered within a partition.

### The gate every fix must pass

A fix is done only when it passes all of the following, **run before the change as a baseline and again after it, with the results compared rather than merely observed green**:

| # | Check | Command / source | What must be true after the fix |
| --- | --- | --- | --- |
| 1 | Unit suite, coverage and lint | `npm test`, `npm run lint`, `npx tsc --noEmit`, `npx tsc --noEmit -p tools/tsconfig.json` | All green; coverage ≥ 96%; zero lint errors; the `tools/` type-check clean too (F-04's lesson: `tools/` is not covered by the root `tsc`) |
| 2 | Ingestion golden files | `npm run golden:ingestion:all` | Identical output to the baseline. Any diff is a behaviour change, and must be exactly the one the finding intends |
| 3 | Full capture replay | The real `buildEnvelopeFromKafkaValue` over all 500 records of `raw_export_500.json` | Same 116 forwarded, same skip buckets, same `id`/`eventType`/`msgType` per record, and same token values unless the finding deliberately changes them (F-33, F-28) |
| 4 | Live corridor against the real local PPA | `e2e-testing/locally-up.md`, then `npm run feeder` | All 8 canonical records (2 each QUOTE/FXQUOTE/TRANSFER/FXTRANSFER) accepted with HTTP 200; offsets committed; zero rejections; PPA's own write-ahead store holds all 8 |
| 5 | Fault scenarios | `npm run scenario:all` | All scenarios pass from a cold start; in particular PPA-outage park and recover, and restart with nothing lost or duplicated |
| 6 | The finding's own failure case | The finding's own reproduction in this document | Now behaves correctly, proven the same way it was proven broken (live where it was verified-live) |

Order of work, every time: **baseline first** (checks 1–5 on the untouched code), then **the failing test** for the finding (`engineering-rules.md` §10.3), then the fix, then **the full gate again**. A fix that fails any check is reverted or reworked. It is never merged with "that check is unrelated" as the explanation, unless that has been proven by running the same check on the baseline.

### Rules that follow from this

- **Scope is the finding, and nothing beside it.** A fix changes only what its finding describes. Cleanup noticed along the way goes on this list as its own item, not into the same change.
- **A deliberate change to the core flow is named, not discovered.** Two fixes here change what PPA receives, by design: F-33 (every `complexName` token value) and F-28 (more fields tokenized). Each must state in advance exactly which output changes, show that the replay in check 3 differs in exactly that and in nothing else, and land before go-live, while no production token history exists to break.
- **Refactors change no behaviour at all.** Q-01 … Q-07 must pass checks 2, 3 and 4 with **zero** diff. A refactor that needs a golden file re-recorded is not a refactor.
- **A fix must not take away a recovery that works today.** F-24 and F-25 add process exits, and F-29 cancels loops. Each must be shown not to fire on any condition that currently heals by itself, above all kafkajs's own restart after a *retriable* crash, which F-12 proved live.
- **Validation added at a boundary must accept everything valid today.** F-26, F-30, F-31 and F-35 add checks that can refuse to start or refuse a record. Each must be run against every configuration in actual use (the `10.0.150.69` rig, the local stack, the harness `.env`, the CCH manifests) and against all 500 captured records, before it is trusted not to reject something legitimate.
- **Unsure means stop.** If a fix's effect on the core flow cannot be demonstrated with this gate, it is not built until it can be. Ask, do not assume.

### Core-flow risk per fix

Each fix below carries a specific way it could break the flow. The guard is the check that must catch it.

| Finding | What the fix touches | The specific way it could break the core flow | Guarded by |
| --- | --- | --- | --- |
| F-23 | The health-probe TLS agent | Giving the probe the client cert must not change the *delivery* agent, or break a deployment whose health URL is plain `http:` | Checks 4 and 5; plus a probe test against both an mTLS listener and a plain one |
| F-24 | Startup and crash handling | An exit on a *retriable* crash would turn kafkajs's working self-restart into a pod restart loop | Check 5; plus a live broker bounce (F-12's own reproduction) that must still recover with no process exit |
| F-25 | Secret loading at boot | Refusing to start on a secret that is valid today (for example the harness secret, or CCH's once issued) stops everything | Check 4 with the real harness secret; the rule is agreed before build (see Decisions) |
| F-26 | Secret content validation | A minimum length or format rule that rejects a secret already in use changes every token or stops the pod | Run against every secret in use; check 3's token values must be unchanged for the harness secret |
| F-27 | Kafka connection options | New TLS/SASL config must leave a plaintext connection exactly as it is when none is configured | Checks 4 and 5 with no new config set |
| F-28 | The tokenize table | **Deliberate output change.** Must tokenize exactly the new rows and nothing else | Check 3: the diff is exactly the new fields, and tokens for the existing fields are unchanged |
| F-29 | Park loops on rebalance | Cancelling a loop for a partition this instance *still* owns strands a parked record | Check 5 (two-instance rebalance scenario); plus a test that a still-assigned partition's loop survives a rebalance |
| F-30 | Parser shape check; the top-level `catch` | A stricter parser that rejects a record forwarded today is silent data loss | Check 3: all 116 still forwarded, buckets unchanged |
| F-31 | `allowAutoTopicCreation`, startup topic check, lag | The existence check must succeed against the real topic on every broker in use | Checks 4 and 5 |
| F-32 | Watchdog `retrigger`, loop generations | Suppressing a *genuinely* stalled loop's re-arm would re-create F-10 | Check 5; plus the existing F-10 watchdog tests unchanged and green |
| F-33 | `complexName` canonicalization | **Deliberate output change.** Must change `complexName` tokens only, and leave MSISDN tokens bit-identical | Check 3: diff limited to `complexName` token values |
| F-34 / F-17 | Commit retry after recovery | A commit-only retry must still never commit a record PPA has not accepted | Check 5; plus a test that `advance` failure retries the commit without a second `deliver` |
| F-35 | URL/flag cross-check at boot | Must accept every configuration currently in use, `10.0.150.69`'s `http:` + `PPA_MTLS_DISABLED=true` included | Boot each real configuration |
| F-36 | Error classification | Relabelling must not change which outcomes are retried: both labels are transient today and must stay so | Check 5; retry and park behaviour unchanged |
| F-37 … F-42 | Log text, shutdown order, comments, metric labels, types, manifests | F-40 changes a metric label, so dashboards and alert rules using `reason="egress"` must be checked; F-42 must not stop the pod starting | Check 1; boot on the harness with the new manifest fields |
| Q-01 … Q-07 | Structure only | Any behaviour change at all | Checks 2, 3, 4 with **zero** diff |

---

## Severity scale

This sweep uses the same scale as [`qa-review-findings.md`](qa-review-findings.md#severity-scale). One application of it needs stating: **a condition that halts the fraud pipeline permanently after an event the spec says to expect, and needs a human to notice and restart it, is rated Critical.** The audit topic's 7-day retention turns an unnoticed halt into irreversible loss, so a halt with no automatic way out is a data-loss path on a timer.

---

## Summary

| Severity | Count | Headline |
| --- | --- | --- |
| Critical | 1 | Once a PPA breaker trips against the real (mTLS) PPA, that partition never resumes (F-23) |
| High | 5 | Kafka startup failure is never retried (F-24); PII secret failure at boot is unrecoverable and still takes partitions (F-25); secret content never validated, so an empty key is accepted (F-26); Kafka connection has no TLS/SASL (F-27); PII outside the tokenize table reaches PPA in cleartext (F-28) |
| Medium | 8 | No rebalance handling (F-29); unmetered drop path in the handler (F-30); typo'd topic auto-created and reported healthy (F-31); watchdog can spawn duplicate reprobe loops (F-32); `complexName` tokens depend on key order (F-33); the F-17 record misdescribes the code (F-34); URL scheme not cross-checked against `PPA_MTLS_DISABLED` (F-35); every post-connect error labelled a TLS handshake failure (F-36) |
| Low | 6 | PII fragments in JSON parse errors (F-37); shutdown cancels timers before draining handlers (F-38); internal finding IDs in `src/` (F-39); party lookups counted as `egress` (F-40); stale type/comment claims (F-41); pod security context absent (F-42) |
| Code quality | 7 | Q-01 … Q-07 — dependency threading, duplicated reprobe loops, a one-domain abstraction, a circular import, non-exhaustive dispatch, an 1,800-line test file, operator-facing text |

**Where to start.** F-23, F-24 and F-25 share one theme: each is a way for MLA to stop consuming for good while its liveness probe keeps reporting it healthy. No self-healing path covers any of them. F-23's fix is a few lines, and it must land before mTLS is switched on anywhere. Whatever is picked first, it is built and verified under [Correctness first](#correctness-first--the-rule-every-fix-is-held-to): the core flow is proven intact before the fix is called done.

---

## Critical

### F-23 — The PPA health probe can never succeed against the real PPA, so a tripped partition never resumes

**Status [2026-09-24]: parked, not built.** Previewed in chat per `CLAUDE.md`'s QA-finding cadence;
before go-ahead was given, the PPA-side engineer stated he is removing mTLS from PPA's health
endpoint specifically. If that lands, the premise below (the real PPA requiring a client cert on
its health routes) may no longer hold, and MLA's fix may be unnecessary or narrower than described.
Parked pending sight of the actual `cch-ppa` commit - see `plan.md` §16's F-23 entry for the full
reasoning and what to check once it lands. Do not build against this section until then.

**Where.** [`ppa.client.ts:76-79, 145-173`](../../../cch-mla/src/clients/ppa.client.ts) (the `healthAgent`, built with `ca` only and no client cert, and `probeReady`), gated at [`ingestion-consumer.service.ts:610`](../../../cch-mla/src/services/ingestion-consumer.service.ts) (`const canAttemptDelivery = !tripped || (await probeReady())`). The default comes from [`config.service.ts:173`](../../../cch-mla/src/services/config.service.ts): `PPA_HEALTH_BASE_URL` falls back to `PPA_BASE_URL`. The CCH manifests ([`deploy/kubernetes/01-configmap.yaml`](../../../cch-mla/deploy/kubernetes/01-configmap.yaml), `02-env-configmap.yaml`) do not set `PPA_HEALTH_BASE_URL`.

**What happens.** F-05's fix gated every reprobe of a tripped breaker on `probeReady()`: a real delivery is attempted only after a probe succeeds. That design assumed `core-knowledge.md` §6.2's statement that PPA's health endpoints are "unauthenticated, on their own ingress", which `tools/ppa-stub` implements with a plain control port and a separate mTLS business port. **The real PPA is built differently.** [`cch-ppa/src/router.ts:74-75`](../../../cch-ppa/src/router.ts) registers `/health/live` and `/health/ready` on the same Fastify instance as `/QUOTES` … `/FXTRANSFERS`. [`cch-ppa/src/clients/fastify.ts:100-109`](../../../cch-ppa/src/clients/fastify.ts) serves that instance over TLS with `requestCert: true, rejectUnauthorized: true`. By design, MLA's probe presents no client certificate. Every probe therefore fails the TLS handshake, the `catch` turns it into `false`, and the reprobe records another breaker failure.

Once a partition's breaker trips (5 consecutive failures by default, about 50 s of PPA outage after the first park), that partition never attempts delivery again, **even after PPA has fully recovered**. With one replica consuming all twelve partitions, a PPA outage of about a minute freezes every partition that saw traffic. The park watchdog stays quiet, because the loop is ticking normally. The breaker-trip alert fired once at the start and nothing fires afterwards, so "PPA is back but MLA is still paused" produces no signal.

**Why this has not been seen.** Every environment tested so far runs `PPA_MTLS_DISABLED=true`: the `10.0.150.69` rig, the local `cch-ppa` stack, and the 8/8 corridor runs. With mTLS disabled, the health agent is the same plain `http.Agent` as delivery, so the probe works. The harness `ppa-stub` has a separate plain health port, which masks it too. The defect appears the day mTLS is switched on, which is the production configuration.

**Verified-live** against a TLS listener with PPA's exact options (`requestCert`, `rejectUnauthorized`, `minVersion: 'TLSv1.2'`, one listener for health and business routes), using the harness CA and client certs:

```
deliver() to the healthy mTLS PPA -> {"outcome":"success"}
probeReady() attempt 1 against the same, healthy PPA -> false
probeReady() attempt 2 against the same, healthy PPA -> false
probeReady() attempt 3 against the same, healthy PPA -> false
```

**Fix direction.** When the health URL is `https:`, have the health agent present the same client key and cert as delivery. An mTLS-terminating ingress gateway (George's proposed architecture, `deployment/certificate-setup-proposal.md`) is equally likely to require a client cert on every path, so presenting the cert is the robust choice whatever sits in front of PPA. Add a test that the probe succeeds against a listener with `requestCert: true`. Correct `core-knowledge.md` §6.2 to match what PPA actually implements. Keep `PPA_HEALTH_BASE_URL` for deployments that do expose a plain health port.

---

## High

### F-24 — A Kafka failure at startup is terminal: never retried, liveness stays UP, and in one shape readiness reports UP too

**Where.** [`index.ts:99-126`](../../../cch-mla/src/index.ts) (`connectKafka`), [`kafka.client.ts:52-56, 74-85`](../../../cch-mla/src/clients/kafka.client.ts), [`health.service.ts:14`](../../../cch-mla/src/services/health.service.ts) (`buildLiveness` is always `UP`).

**What happens.** `connectKafka` calls `connect()`, `subscribe()` and `run()` once inside a single `try`. The `catch` logs one line and returns. Nothing ever calls them again. The comment above the function says a startup outage "is transient, not fatal" and that readiness will be DOWN "so the orchestrator keeps it out of rotation". Neither holds up:

1. **Broker unreachable at boot**, for example Kafka pods still starting, a cluster-wide restart, or the CCH network path or allow-list not yet open. kafkajs exhausts its own connection retries and throws. MLA never consumes until a person restarts the pod. Readiness is `DOWN` forever and liveness is `UP` forever. Kubernetes restarts on liveness, not readiness, so it never restarts the pod. "Out of rotation" means nothing for a service with no inbound traffic.
2. **A failure after `consumer.connect()` succeeds**, meaning `admin.connect()`, or `subscribe()` failing on topic authorization or metadata. kafkajs has already emitted `CONNECT`, so `connected = true` and **readiness reports `UP`** while nothing is subscribed or running. The lag gauge reads 0 on a fresh group (see F-31), so the instance looks entirely healthy.
3. **A non-retriable crash later**, for example `GROUP_AUTHORIZATION_FAILED` while CCH's dedicated consumer group ACL is still being set up. kafkajs's `onCrash` (`node_modules/kafkajs/src/consumer/index.js:267-301`) restarts only on retriable errors, so the consumer stays dead. Readiness goes `DOWN` (F-12's fix), liveness stays `UP`, and no alert fires.

**Verified-live (shape 1).** MLA was started with `KAFKA_BROKERS` pointing at a closed port. After its single `Kafka consumer failed to connect/subscribe/run at startup` line, a TCP proxy was opened on that port to the real harness broker. **Sixty seconds later, with the broker reachable, readiness was still `{"status":"DOWN","kafka":"DOWN"}`, `/health/live` returned 200, and "Kafka consumer connected" had been logged zero times.**

**Why it matters.** `engineering-rules.md` §6.1 names a transient dependency as something to recover from, not a reason to run degraded forever. The single-replica CCH deployment has no second instance to take over. The most likely first-day failure in CCH's environment is MLA starting before its network path or ACL is in place. That exact case turns into a permanent, unalerted halt.

**Fix direction.** Choose one of two approaches and make it explicit. (a) Exit non-zero on a startup Kafka failure and on a `CRASH` event with `restart: false`, so the orchestrator restarts the pod, with CrashLoopBackOff as the visible signal. (b) Retry connect, subscribe and run on a backoff and have `/health/live` fail once the consumer is dead. (a) is smaller and matches the F-09 precedent (`uncaughtException` exits). Either way, set `connected` only once `run()` has succeeded, not on `CONNECT`.

### F-25 — The PII secret is read once, so the PII park/reprobe path can never recover, and a pod without its secret still takes partitions

**Where.** [`pii-secret.client.ts:13-23`](../../../cch-mla/src/clients/pii-secret.client.ts) (the result is fixed at construction), the whole PII park path in [`ingestion-consumer.service.ts:82-106, 207-321, 377-494`](../../../cch-mla/src/services/ingestion-consumer.service.ts), and [`deploy/kubernetes/README.md:59-61`](../../../cch-mla/deploy/kubernetes/README.md).

**What happens.** `FilePiiSecretClient` resolves `available` or `unavailable` once, in its constructor, and returns that same answer for the life of the process. Two consequences follow:

- **The only runtime path to `pii-secret-unavailable` is "unavailable at boot", and from there no reprobe can ever succeed.** The retry burst, the park, the process-wide breaker and the reprobe loop all run, and they can never change the outcome. `plan.md` §16's own [2026-09-04] entry says this. It deferred "recovery without a restart" to gate item #2, secret rotation, which would have added a reload. Gate item #2 was then resolved [2026-09-18/22] as "no rotation, long-lived key, no build". The deferral's premise disappeared, and the reprobe loop has been structurally unable to heal since.
- **Readiness `DOWN` does not stop a Kafka consumer.** The deploy README says "the pod will not reach `Ready` until the `cch-mla-pii-secret` secret also exists". That is true, and it is also irrelevant. A not-Ready pod still joins the consumer group, takes partitions, parks each one on its first QUOTE or FXQUOTE, and holds them forever. Readiness gates only inbound HTTP, and MLA has none. Kubernetes will not start a pod whose secret *volume* is missing. So the realistic trigger is a secret that exists but whose data key is not named `secret` (`PII_SECRET_PATH=/secrets/pii-secret/secret`), or that is unreadable.
- **The rolling-update case is the damaging one.** A new pod whose secret fails to load never becomes Ready, so the rollout stalls with old and new pods both running. The group rebalance hands roughly half the partitions to the new pod, and it freezes them. The healthy old pod cannot take them back, because the new pod still owns them.

**Why it matters.** The code and its comments promise self-recovery that cannot happen. The failure also blocks TRANSFER/FXTRANSFER traffic on the same partitions, even though that traffic needs no secret at all. The only way out is a manual restart that nothing prompts.

**Fix direction.** Treat an unavailable PII secret as fatal at boot: refuse to start, as `engineering-rules.md` §6.1 prescribes for "the service cannot function". Still fail-closed and still no drop, which is COMESA's gate item #1 answer ("fail the transaction and retry"). The retrying now happens through the orchestrator's restart instead of an in-process loop that cannot succeed. **Confirm with the user that this reading of gate item #1 is acceptable before building it** (see [Decisions](#decisions-that-are-not-engineerings)). If it is, most of the PII transient machinery becomes dead code and can be deleted (Q-03).

### F-26 — The PII secret's content is never validated: an empty file becomes an unkeyed hash, and a trailing newline silently changes every token

**Where.** [`pii-secret.client.ts:15-17`](../../../cch-mla/src/clients/pii-secret.client.ts), [`tokenization.service.ts:26-27`](../../../cch-mla/src/services/tokenization.service.ts), and the deploy README (no stated secret format).

**What happens.** Any readable file is accepted as the secret, byte for byte:

- **An empty file** (for example a Kubernetes secret created with an empty value) loads as `available` with a 0-byte key. `HMAC-SHA256` under an empty key is a fixed, public function, so every token can be recomputed by anyone with an MSISDN list. That is exactly the "plain hash with no key" US-PII-02 forbids. Readiness reports `piiSecret: UP`.
- **Trailing whitespace** is part of the key. A secret created with `echo` or a YAML block scalar gets a trailing `\n`, and one created with `--from-file` of a raw file does not. The two produce entirely different tokens for the same MSISDN. Nothing warns. Tazama's velocity and matching rules then treat one subscriber as two, which quietly breaks the determinism guarantee gate item #2 was reversed to protect.

**Verified-live:**

```
empty secret file -> available length 0
token with empty key: tkn_823f8e36…da62e2
attacker recompute  : tkn_823f8e36…da62e2      (identical)
same secret +/- trailing newline -> same token? false
```

**Fix direction.** Reject a secret below a minimum length at boot, for example 32 bytes (the harness generator writes 32 random bytes). Define the format in the deploy README and apply it in code, either "raw bytes, used exactly" or "base64 text, decoded, with surrounding whitespace trimmed". Log a non-reversible fingerprint of the loaded key (for example the first 8 hex characters of `sha256(secret)`) at boot, so two environments' keys can be compared without exposing either.

### F-27 — The Kafka connection supports neither TLS nor SASL, and the question has never been asked

**Where.** [`kafka.client.ts:48-51`](../../../cch-mla/src/clients/kafka.client.ts) (`new Kafka({ clientId, brokers })`), [`config.interface.ts`](../../../cch-mla/src/interfaces/config.interface.ts) (`KafkaConfig` has no `ssl` or `sasl`). A search of the knowledge base for SASL or Kafka TLS finds nothing.

**What happens.** MLA can connect only to a plaintext, unauthenticated listener. The audit topic carries the raw, **pre-tokenization** event, with MSISDNs, names and ILP packets. If CCH's DRPP brokers require TLS or SASL, which is common for a production payment switch, MLA cannot connect at all, and the failure then follows F-24's never-retried path. If they do not, raw PII crosses the network unencrypted between the brokers and MLA. Either answer changes what has to ship.

**Why it matters.** This decides whether MLA can connect in production at all, and it appears in no open-questions list (`plan.md` §14, `questions for comesa.md`, `deployment/MLA-deployment-kubernetes.md` §11). **It is CCH's to answer, not engineering's.** See [Decisions](#decisions-that-are-not-engineerings).

**Fix direction.** Ask CCH now. Meanwhile, add optional `KAFKA_SSL_*` / `KAFKA_SASL_*` config: CA, client cert and key, SASL mechanism and credentials, read from mounted secret files, never defaulted, and validated at boot like the PPA cert paths. That makes the answer a configuration change rather than a code change. Refuse to start if SASL credentials are configured while TLS is off.

### F-28 — Party PII outside the tokenize table reaches PPA and TMS in cleartext on QUOTE events

**Where.** [`tokenization.service.ts:30-43`](../../../cch-mla/src/services/tokenization.service.ts) (`TOKENIZE_PATHS_BY_EVENT_TYPE`), against `user stories/cch-pii-user-stories.md`'s Fields-to-Tokenize table.

**What happens.** The code implements the spec table exactly. The table does not cover everything the real messages carry. Measured against `raw_export_500.json` and FSPIOP's `Party` shape:

| Field | Event | In the table? | Reaches PPA as |
| --- | --- | --- | --- |
| `payer.name` (display name) | QUOTE request | No | **Cleartext** — present on 8 of the 10 captured quote requests (`"Display-Test"`) |
| `payer.personalInfo.dateOfBirth` | QUOTE request | No | **Cleartext** where present |
| `payee.personalInfo.complexName` | QUOTE request | No | **Cleartext** — already flagged to CCH, `core-knowledge.md` §13.3 |
| `payee.name` | QUOTE request | No | **Cleartext** where present |
| `ilpPacket` (encodes the whole transaction, payer and payee identity included) | QUOTE **callback** (`putQuotesByID`) | No. The exemption row covers only *Transfer prepare* | **Cleartext** — present on all 9 captured quote callbacks |

**Verified-live** by running `buildEnvelopeFromKafkaValue` on a captured `postQuotes` record: `payer.name` and `personalInfo.dateOfBirth` come out unchanged. F-15's log masking already hides every one of these fields in MLA's own logs, so this is about what PPA and TMS store, not what MLA logs.

**Why it matters.** The design intent (US-PII-01's Description) is that "PPA and everything downstream never see raw PII", except the ILP fields explicitly exempted. The quote callback's ILP packet is cryptographically bound in exactly the same way as the transfer's (the payee DFSP builds it together with `condition`), so it plausibly belongs under the same exemption. That is still for the story author to write down, not for engineering to assume.

**Fix direction.** This is a spec gap, not a code defect, so it is **CCH's and the story author's decision** (see [Decisions](#decisions-that-are-not-engineerings)). Take the table above to them as one question alongside the pending `complexName` question. Each row the table gains is then one line of data in `TOKENIZE_PATHS_BY_EVENT_TYPE`.

---

## Medium

### F-29 — No rebalance handling: parked partitions keep being reprobed, committed and reported by an instance that no longer owns them

**Where.** [`kafka.client.ts`](../../../cch-mla/src/clients/kafka.client.ts) (no `GROUP_JOIN` subscription and no revocation hook), the park loops in `ingestion-consumer.service.ts`, and [`park-registry.service.ts`](../../../cch-mla/src/services/park-registry.service.ts).

**What happens.** A reprobe loop holds its record in a closure and runs until it resolves, whatever the group assignment does. On a rebalance (every Kubernetes rolling update, every scale-up or scale-down, every pod restart):

- The new owner fetches the partition from the committed offset, which is the parked record, and delivers it too. **Duplicate POST** (absorbed by PPA's idempotency).
- The old owner's loop later delivers and calls `commitOffsets` for a partition it no longer owns. The broker checks generation and member ID, not partition ownership, so the commit is accepted. **The committed offset can move backwards** below the new owner's progress, and the next restart replays the gap. That means more duplicates, not loss, because the old owner's commit only covers a record it actually delivered.
- kafkajs keeps paused state across reassignment: `subscriptionState.js` stores it separately from the assignment and `assign()` never clears it (verified in source). If the partition later comes back while the old loop is still running, it stays paused behind that loop.
- `mla_partition_paused{partition}`, `mla_park_age_seconds{partition}`, `mla_ppa_breaker_state{partition}` and the park watchdog keep reporting, and alerting on, a partition this instance no longer consumes. An operator looking at the old pod sees "partition 7 paused 40 minutes" while another pod consumes it normally.
- A detached reprobe that re-enters `runPpaRetryBurst` calls `message.heartbeat` from an `eachMessage` payload that finished long ago.

**Fix direction.** Subscribe to `consumer.events.GROUP_JOIN`. Its payload carries the new `memberAssignment`. For every parked partition no longer assigned, cancel its loop, deregister it, and clear its per-partition gauges. Put a generation token on each loop so a callback from a cancelled loop does nothing, including its `advance`.

### F-30 — The handler's top-level `catch` is an unmetered drop path, reachable today through an unvalidated `content.headers`

**Where.** [`ingestion-consumer.service.ts:132-138`](../../../cch-mla/src/services/ingestion-consumer.service.ts), [`audit-record-parser.service.ts:11-23`](../../../cch-mla/src/services/audit-record-parser.service.ts), [`envelope-builder.service.ts:87`](../../../cch-mla/src/services/envelope-builder.service.ts).

**What happens.** Anything that throws inside the handler is logged once as `Unhandled failure processing partition …`. It gets no metric bucket, no alert, and no commit, and `eachMessage` returns normally. kafkajs resolves the offset in memory and moves on, and the *next* record's commit covers this one cumulatively. **The record is dropped with no count and no alert.** Phase 6's exit criterion, "every record accounted for in exactly one bucket", does not hold on this path. Concrete ways in:

- The parser's own contract says it validates "only the paths downstream code dereferences unguarded". It does not validate `content.headers`, which `buildEnvelope` dereferences unguarded. **Verified-live:** a canonical `postQuotes` with `headers` removed throws `Cannot read properties of undefined (reading 'fspiop-source')` out of `buildEnvelopeFromKafkaValue`. Every captured record has `headers`, so this is input hardening, not a live defect. It is the same class of input the parser exists to reject.
- A `heartbeat()` inside a retry burst throws `REBALANCE_IN_PROGRESS` during a rebalance. That is swallowed here instead of reaching kafkajs's runner. It is benign in effect, because kafkajs's own post-message heartbeat rethrows it, but it is counted nowhere.
- A `kafka.advance` failure on the first-attempt path (the deferred F-17).

**Fix direction.** Add `content.headers` (must be an object) to `hasAuditRecordShape`. In the top-level `catch`, increment a dedicated `mla_rejected_total{reason="unhandled"}` (or a separate counter) and raise an alert, so the path is at least counted. Let kafkajs rebalance errors (`isRebalancing`) propagate instead of swallowing them.

### F-31 — A typo'd `KAFKA_AUDIT_TOPIC` silently creates and consumes an empty topic, and every signal reports healthy

**Where.** [`kafka.client.ts:52-56`](../../../cch-mla/src/clients/kafka.client.ts) (`allowAutoTopicCreation` left at kafkajs's default, `true`), [`kafka.client.ts:162-167`](../../../cch-mla/src/clients/kafka.client.ts) (lag is `0` when the group has no committed offset and `fromBeginning` is false).

**What happens.** Brokers default to `auto.create.topics.enable=true` (Apache Kafka's own default, and the harness Redpanda's setting). Subscribing to a misspelled topic creates it, and MLA then waits on an empty topic forever with nothing to show for it. **Verified-live** with `KAFKA_AUDIT_TOPIC=qa-sweep-topic-event-audti`: the log showed `Kafka consumer connected`, then `Subscribed to qa-sweep-topic-event-audti`; readiness was `{"status":"UP","kafka":"UP","piiSecret":"UP"}`; `mla_consumer_lag{partition="0"} 0`; and the broker gained a new one-partition topic, which was deleted afterwards. `KAFKA_AUDIT_TOPIC` is required config precisely because it must not be guessed, yet the most likely mistake with it is invisible.

**Fix direction.** Set `allowAutoTopicCreation: false` on the consumer. At startup, check that the topic exists through the admin client already created, and treat a missing topic as a startup failure (F-24). While the group has no committed offset, report lag as `high - low` rather than `0`, so "never consumed anything" cannot look the same as "fully caught up".

### F-32 — The park watchdog can raise false stall alerts and start a second, concurrent reprobe loop on the same partition

**Where.** [`park-registry.service.ts:44-50, 75-84`](../../../cch-mla/src/services/park-registry.service.ts), [`park-watchdog.service.ts:30-32`](../../../cch-mla/src/services/park-watchdog.service.ts), and the timer callbacks at `ingestion-consumer.service.ts:471-474, 638-641`.

**What happens.** Three things combine:

1. Staleness is measured from `lastTickAt`, which is set at the **start** of an attempt. After a long attempt, "time since last tick" already includes the whole attempt before the next timer has even been armed.
2. `retrigger` runs the loop's `reprobe()` immediately, but **does not cancel the pending timer**. That timer later fires its own `reprobe()`, and the `ticking` guard applies only to `retrigger`, not to timer-fired calls.
3. `registerTimer` replaces the stored handle, so the first chain's timer becomes unreachable, including by `cancelAll()` at shutdown.

The result: two independent chains on one partition, each re-arming forever. They can deliver the same envelope concurrently, and both then run `resolvePartition`, so `mla_forwarded_total` is incremented twice and "Forwarded" is logged twice. Each further false positive adds another chain. The trigger is an attempt lasting more than about two reprobe intervals. Defaults do not reach it (10 s interval, attempts of 4 s or less). The config bounds allow it, though: `PPA_TIMEOUT_MS=60000` with `PPA_REPROBE_INTERVAL_MS=10000` gives attempts of up to about 120 s, and no cross-field check prevents that.

**Fix direction.** Measure staleness from the later of tick start and tick end. Have `retrigger` clear `pendingTimer` before invoking. Give each loop a generation number that stale callbacks check (the same mechanism F-29 needs). Add a boot-time check that `2 × PPA_TIMEOUT_MS` fits inside the watchdog threshold.

### F-33 — `complexName` tokens depend on JSON key order, so the same name can produce different tokens

**Where.** [`tokenization.service.ts:23`](../../../cch-mla/src/services/tokenization.service.ts) (`canonicalize = … JSON.stringify(value)`).

**What happens.** A structured value is hashed as its `JSON.stringify` output, which follows the key order of the incoming JSON. Different DFSP implementations serialize `{firstName, middleName, lastName}` in different orders. **Verified-live:** the same name with keys in two orders produced two different tokens. US-PII-01's acceptance criterion is "the same input value always produces the same token". Semantically the input is the same, and the token is not.

**Fix direction.** Canonicalize objects with keys sorted recursively before hashing. This changes existing `complexName` tokens, so do it before go-live, while no production token history exists. Separately, and as a question for CCH rather than a code change: should MSISDNs be normalised (E.164 `+` prefix, whitespace) before hashing? Today `+260976001234` and `260976001234` tokenize differently.

### F-34 — The F-17 progress-log entry describes the recovery path's commit retry incorrectly

**Where.** `plan.md` §16, "F-17 — investigated, deliberately deferred (not built)" [2026-09-24], against [`ingestion-consumer.service.ts:561-573`](../../../cch-mla/src/services/ingestion-consumer.service.ts).

**What happens.** The entry says the parked/reprobe recovery path "already wraps `advance()` in its own try/catch and, on failure, schedules a commit-only retry timer directly - it does not call `deliver()` again". It does not. `resolvePartition`'s `catch` arms `setTimeout(() => { reprobe(); })`, and `reprobe()` (lines 605-627) calls `probeReady()` and `deliver(envelope)` again. That re-delivery is what the original F-17 text in `qa-review-findings.md` described. The PII recovery path re-delivers too: an `advance` throw inside `resolveTransient` → `resolveOutcome` escapes to that reprobe's `catch`, the `finally` re-arms, and the next tick calls `deliver`. `logResolvedOutcome` has already incremented `mla_forwarded_total` by then, so the recovered record is counted twice.

**Why it matters.** The deferral decision itself still stands, because PPA's `{id}:{isoMessageType}` idempotency absorbs the duplicate on both paths. But the permanent record says one path is already correct when neither is. Whoever picks F-17 up later would scope half the fix they actually need.

**Fix direction.** Correct the `plan.md` §16 F-17 entry so both paths are described as re-delivering. When F-17 is built, fix both paths with one commit-only retry helper. Q-02's shared reprobe loop is the natural home for it.

### F-35 — The URL scheme is never cross-checked against `PPA_MTLS_DISABLED`, and one mismatch reproduces F-23's permanent stall

**Where.** [`ppa.client.ts:60-80, 107, 161`](../../../cch-mla/src/clients/ppa.client.ts), [`config.service.ts:167-190`](../../../cch-mla/src/services/config.service.ts).

**What happens.** Delivery chooses `http.request` or `https.request` from the `PPA_MTLS_DISABLED` flag and ignores `PPA_BASE_URL`'s own scheme. The health probe chooses from the health URL's scheme but reuses the flag-selected agent. Nothing checks that the two agree:

- `PPA_MTLS_DISABLED=true` with an `https://` health URL makes `https.request` receive an `http.Agent` and throw `Protocol "https:" not supported`. The throw is caught, the probe returns `false`, and a tripped breaker never recovers, which is F-23's outcome by a different route. **Verified-live** (`probeReady = false`, with that exact underlying error).
- `PPA_MTLS_DISABLED=true` with an `https://` base URL sends plaintext HTTP to a TLS port. Every delivery then fails as a transport error and is retried forever.
- `PPA_MTLS_DISABLED=false` with an `http://` base URL starts a TLS handshake against a plaintext port.

**Fix direction.** Refuse to start on any mismatch: `https:` URLs if and only if mTLS is enabled, for both URLs. Five lines in `loadPpa`, each with its own test.

### F-36 — Every transport error after TCP connect is labelled `tls-handshake-failure`, including on plain HTTP

**Where.** [`ppa.client.ts:194-195`](../../../cch-mla/src/clients/ppa.client.ts) (`classifyTransportError`).

**What happens.** Any error after the socket connects counts as a TLS handshake failure. That includes a mid-response `ECONNRESET`, a reset on a reused keep-alive socket (much more common since F-14 introduced pooling), and every error under `PPA_MTLS_DISABLED=true`, where no TLS exists at all. The alert text reads `PPA TLS handshake failed: socket hang up` and `mla_ppa_delivery_outcomes_total{outcome="tls-handshake-failure"}` rises. The whole point of the separate label (Phase 5's live-verified distinction) was to send an operator to look at certificates. Here it sends them to certificates for a network reset.

**Fix direction.** Record `secureConnect` separately from `connect`. Classify as a handshake failure only when TCP connected, TLS was in use, and `secureConnect` never fired. Otherwise classify as `network-error`.

---

## Low

### F-37 — JSON parse error messages echo input text, so PII fragments reach the error log

**Where.** [`audit-record-parser.service.ts:39`](../../../cch-mla/src/services/audit-record-parser.service.ts) → [`ingestion-outcome-logging.service.ts:39`](../../../cch-mla/src/services/ingestion-outcome-logging.service.ts). Node 22's V8 includes a short excerpt of the input in `SyntaxError` messages. **Verified:** `Unexpected token '+', ..."entifier":+260976001"... is not valid JSON`. That string is logged at `error` level for an unreadable record, which breaks N7 for a partial MSISDN. Fix: log the error position, not `err.message`.

### F-38 — Shutdown cancels park timers before draining in-flight handlers

**Where.** [`index.ts:154-156`](../../../cch-mla/src/index.ts). `parkRegistry.cancelAll()` runs before `kafka.disconnect()`, and kafkajs waits for in-flight `eachMessage` calls during disconnect. A handler still in a retry burst can therefore park *after* `cancelAll`, registering a live timer during shutdown. `process.exit` masks this today. Fix: call `cancelAll()` after `disconnect()`.

### F-39 — Internal finding references remain in `src/`, including in one Prometheus help string

**Where.** [`index.ts:47`](../../../cch-mla/src/index.ts), [`config.service.ts:22, 87, 192`](../../../cch-mla/src/services/config.service.ts), [`park-registry.service.ts:22`](../../../cch-mla/src/services/park-registry.service.ts), [`metrics.client.ts:89`](../../../cch-mla/src/clients/metrics.client.ts). These reference `qa-review-findings.md F-03` / `F-07` / `F-10`, which breaks `engineering-rules.md` §5's rule against citing finding numbers in code. They are left over from the F-01 … F-10 era, which predates the rule. The one in `mla_park_age_seconds`'s help text ships to every Grafana user. Fix: rewrite each to state its durable engineering reason.

### F-40 — Party-lookup traffic is counted as `egress`, not `party-lookup`

**Where.** [`canonical-record.service.ts:11-24`](../../../cch-mla/src/services/canonical-record.service.ts). `getPartiesByTypeAndID` has no canonical row, so it fails canonical selection before classification. In the 500-record capture, 149 records (30%) land in `mla_skipped_total{reason="egress"}` rather than `party-lookup`. The skip is correct; the metric attribution is not. An operator reading "30% egress" would investigate a non-issue. Fix: check party-lookup operations before canonical selection, or add `getPartiesByTypeAndID` rows.

### F-41 — Type and comment claims that the captures contradict

- [`audit-record.interface.ts`](../../../cch-mla/src/interfaces/audit-record.interface.ts) types every tag as `string | undefined`. Real captures carry `processedAsBatch: true`, a boolean, on five operations (59 of 500 records). It is harmless today because nothing reads that tag, but the type claims a guarantee the parser never checks: a non-string `quoteId` is rejected only by the defensive schema check, as `invalid-envelope-schema`.
- [`audit-record-parser.service.ts:29`](../../../cch-mla/src/services/audit-record-parser.service.ts) says the base64 step lives in `payload-selection.service.ts`. There is no base64 step anywhere: transfer records already carry the decoded FSPIOP body in `payload`, which the captures confirm. The comment sends the next engineer looking for code that does not exist.

### F-42 — The pod runs without a security context

**Where.** [`deploy/kubernetes/03-mla-deployment.yaml`](../../../cch-mla/deploy/kubernetes/03-mla-deployment.yaml). There is no `securityContext`: no `runAsNonRoot`, `readOnlyRootFilesystem`, `allowPrivilegeEscalation: false`, or `capabilities.drop: [ALL]`. The distroless `nonroot` image covers the user in practice, but a CCH cluster enforcing the `restricted` Pod Security Standard rejects the pod outright. Fix: add those four fields; MLA writes nothing to disk, so `readOnlyRootFilesystem: true` is safe.

---

## Code quality and refactoring

These are not defects. Each one removes friction that exists in the code today, which is the bar `engineering-rules.md` §3 sets for a pattern to earn its place. They are ordered by payoff.

### Q-01 — `ingestion-consumer.service.ts` threads the same twelve dependencies through five hand-written shapes

The file is 661 lines. It passes `max-lines` only because that rule skips comments. The same dependency set (`kafka`, `logger`, `metrics`, `alert`, `deliver`, `probeReady`, `ppaRetry`, `ppaBreaker`, `parkRegistry`, …) is declared five times: `IngestionHandlerDeps`, `TransientResolutionContext`, `TransientParkParams`, `PpaParkParams`, and `resolveOutcome`'s inline type. It is then copied field by field at four call sites (for example lines 116-131, 281-299, 305-319 and 428-443). Roughly 90 lines are pure plumbing. Adding a dependency means editing nine places, and forgetting one is a compile error only when a type happens to be narrow enough.

**Recommendation.** Build one `PipelineDeps` object once per handler, and pass it along with a per-record `RecordContext` (which already exists). Every function then takes `(outcome, record, deps)`. No behaviour change. This alone should bring the file under 500 lines.

### Q-02 — The two reprobe loops are one mechanism written twice

`parkAndReprobeTransient` (lines 377-494) and `parkAndReprobePpa` (519-661) repeat the same skeleton: log, alert and pause; `register`; arm the first timer; then `tickStart`, a `try`, a guarded `catch` log, and a `finally` that runs `tickEnd`, re-arms and calls `registerTimer`. Only the attempt body differs. F-32's fix, F-29's generation token and F-34's commit-only retry each have to be written twice today, and each can drift.

**Recommendation.** Extract `startReprobeLoop(partition, { kind, intervalMs, correlationId }, attemptOnce: () => Promise<'resolved' | 'retry'>)` into its own module (for example `reprobe-loop.service.ts`) that owns the timer, the registry bookkeeping and the error guard. Both park functions shrink to their attempt bodies. This is also the natural place to fix F-29, F-32 and F-34 once.

### Q-03 — `TransientDependencyDomain` generalizes over exactly one domain

The domain abstraction was built for JWS key-store and PII-secret outages together. With JWS removed, `domains` is always a one-element array, `isDomainUnavailable` is generic over a single literal type, and `resolveTransient` loops over one entry. If F-25 is fixed by failing fast at boot, the whole PII park path can be deleted: `runTransientRetryBurst`, `parkAndReprobeTransient`, `resolveTransient`, the process-wide `CircuitBreaker` instance, `mla_pii_breaker_state`, the four `PII_*` retry settings, and the PII half of `assertRetryBurstsFitSessionTimeout`. That is about 200 lines. If F-25 is fixed some other way, at least collapse the abstraction back to direct PII code.

### Q-04 — A circular import between the consumer and its logging module

`ingestion-outcome-logging.service.ts` imports the `PpaTransientResult` type from `ingestion-consumer.service.ts`, which imports functions back from it. It is type-only, so it is harmless at runtime, but the layering is backwards: a leaf module depends on its orchestrator. **Recommendation:** move `PpaTransientResult` and `PpaResolvedResult` into `interfaces/ppa.interface.ts` beside `PpaDeliveryResult`.

### Q-05 — Skip and rejection dispatch is not exhaustive by construction

`PHASE_2_SKIP_REASONS` ([`ingestion-outcome-logging.service.ts:146`](../../../cch-mla/src/services/ingestion-outcome-logging.service.ts)) is a hand-maintained string set, not tied to the `SkipReason` type, and it is named after a project phase. `logEnvelopeSkip`'s `default` branch labels any unlisted reason "Envelope failed schema validation". A new skip reason added to `SkipReason` but not to the set would compile and be logged as a schema failure. **Recommendation:** derive both the type and the set from one `as const` array, and give both switches a `never`-typed exhaustiveness check.

### Q-06 — One 1,821-line test file covers the whole consumer

`__tests__/ingestion-consumer.service.test.ts` (47 tests) is nearly three times the size of the file it tests. With Q-01/Q-02, split it by concern: first-attempt delivery; PPA park, reprobe and breaker; PII park; the reprobe loop itself (once extracted); watchdog interplay. Each suite's setup then carries only its own fakes.

### Q-07 — Operator-facing text carries internal vocabulary, and comments run past the §5 length cap

Prometheus help strings are read in Grafana by people who have never seen this repository. Several reference internal artefacts: "This codebase reading of US-MON-01", "Phase 6 alert paths", "(see circuit-breaker.service.ts)", "(qa-review-findings.md F-10)". Separately, many doc comments exceed `engineering-rules.md` §5's 1-2 line cap, for example `ParkRegistry.register` and `registerTimer`, and the `NumberBounds` constants in `config.service.ts`. **Recommendation:** one pass that rewrites help strings in plain operator terms (what the number means and when to worry), and trims comments to one reason each.

---

## Decisions that are not engineering's

Per `CLAUDE.md` ("External decisions — build anyway, but never bury them"). Each can be built against a reversible default; none can be closed silently.

| Finding | Decision | Belongs to | Blocks | Recommended default meanwhile |
| --- | --- | --- | --- | --- |
| F-27 | Does the DRPP Kafka cluster require TLS and/or SASL for MLA's consumer, and with what credentials? | CCH infrastructure / techops (via George) | **Go-live**, and possibly MLA's first connection in CCH's cluster | Build optional TLS/SASL config, off unless configured, validated at boot |
| F-28 | Tokenize `payer.name`, `payee.name`, `dateOfBirth`, `payee.personalInfo.complexName`? Does the ILP exemption extend to the quote callback's `ilpPacket`? | CCH / the PII story author | Closure of US-PII-01's "downstream never sees raw PII" intent | Unchanged code (it matches the current table). Raise as one question with the pending `complexName` item |
| F-33 (second half) | Should MSISDNs be normalised before hashing? | CCH / story author | Token determinism across DFSPs | No normalisation (current behaviour) |
| F-25 | Is "refuse to start without a valid secret" an acceptable realization of COMESA's gate item #1 ("fail the transaction and retry")? | The user, and then COMESA if the user considers it a change | Only the choice of F-25's fix | Fail fast at boot. Still fail-closed, and nothing is dropped |
| F-23 | Will the real PPA, or the ingress in front of it, ever expose an unauthenticated health endpoint? | The PPA engineer / CCH | Nothing. F-23's fix works either way | Present the client cert on the probe |

---

## Test-suite gaps

| Gap | Finding |
| --- | --- |
| No test runs `probeReady` against a listener that requires a client certificate. The only probe tests use a plain or cert-less server. | F-23 |
| No test covers a `connect`, `subscribe` or `run` failure followed by the broker becoming available, or a `CRASH` with `restart: false`. | F-24 |
| No test builds the service with an unreadable secret and asserts the process refuses to start. The existing tests assert only readiness `DOWN`. | F-25 |
| No test loads an empty, short or whitespace-padded secret file. | F-26 |
| No test tokenizes a `postQuotes` body carrying `payer.name` or `dateOfBirth`, or a quote callback's `ilpPacket`. | F-28 |
| No test simulates a partition revoked while it is parked. | F-29 |
| No test feeds a record whose `content.headers` is absent, and no test asserts the top-level `catch` increments anything. | F-30 |
| No test asserts `allowAutoTopicCreation: false`, or checks the lag value for a group with no committed offset. | F-31 |
| No test fires `retrigger` while a timer is pending and asserts a single chain survives. | F-32 |
| No test tokenizes the same `complexName` with two key orders. | F-33 |
| No test makes `advance` throw on the PII recovery path and asserts `deliver` is not called again. | F-34 |
| No test combines `PPA_MTLS_DISABLED` with an `https://` URL. | F-35 |
| No test resets a pooled keep-alive socket and checks the classification, and no plain-HTTP transport error is tested. | F-36 |

---

## Findings index

| # | Severity | One line | Status |
| --- | --- | --- | --- |
| F-23 | Critical | Health probe sends no client cert, and real PPA serves health behind mTLS, so a tripped partition never resumes | Parked [2026-09-24] — pending upstream PPA change to health-endpoint mTLS; see `plan.md` §16 |
| F-24 | High | Kafka connect/subscribe/run failure at startup is never retried; liveness always UP | Open — verified-live |
| F-25 | High | PII secret read once, so the PII reprobe can never heal, and a pod without its secret still takes partitions | Open — decision on fix shape (see Decisions) |
| F-26 | High | Empty secret accepted (unkeyed hash); trailing newline silently changes every token | Open — verified-live |
| F-27 | High | Kafka connection has no TLS/SASL support; never asked of CCH | Open — **CCH decision** |
| F-28 | High | `payer.name`, `dateOfBirth`, quote-callback `ilpPacket` and others reach PPA in cleartext | Open — **CCH / story-author decision** |
| F-29 | Medium | No rebalance handling: stale reprobe loops, duplicate delivery, backward commits, stale metrics | Open |
| F-30 | Medium | Top-level `catch` drops records unmetered; `content.headers` not validated | Open — verified-live |
| F-31 | Medium | Typo'd topic is auto-created and reported healthy (lag 0, ready UP) | Open — verified-live |
| F-32 | Medium | Watchdog `retrigger` leaves the pending timer, which can create two concurrent reprobe loops | Open |
| F-33 | Medium | `complexName` token depends on JSON key order | Open — verified-live |
| F-34 | Medium | `plan.md` §16's F-17 entry says the recovery path retries only the commit; it re-delivers | Open — documentation |
| F-35 | Medium | URL scheme not cross-checked against `PPA_MTLS_DISABLED`; one mismatch reproduces F-23 | Open — verified-live |
| F-36 | Medium | Every post-connect transport error labelled `tls-handshake-failure`, even on plain HTTP | Open |
| F-37 | Low | V8 parse errors echo input, so partial MSISDNs reach the error log | Open — verified-live |
| F-38 | Low | `cancelAll()` runs before handlers drain on shutdown | Open |
| F-39 | Low | Finding IDs left in `src/` comments and one metric help string | Open |
| F-40 | Low | `getPartiesByTypeAndID` counted as `egress` (30% of captured traffic) | Open — verified-live |
| F-41 | Low | Tag type claims strings only (`processedAsBatch` is boolean); comment points at a base64 step that doesn't exist | Open |
| F-42 | Low | No pod `securityContext`, so the pod is rejected under a `restricted` Pod Security Standard | Open |
| Q-01 … Q-07 | Quality | Dependency threading, duplicated reprobe loop, one-domain abstraction, circular import, non-exhaustive dispatch, 1,821-line test file, operator-facing text | Open |

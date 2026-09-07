<!-- SPDX-License-Identifier: Apache-2.0 -->

# Continue — Before Phase 5 <!-- omit in toc -->

**What this document is.** A session handoff. It marks the point where Phase 4's PII tokenization mechanism is built and live-verified, gate item #1 (the fail-mode wiring) is also built and live-verified, and Phase 5's delivery, offsets, and resilience ([`plan.md`](../plan.md) §8) is now the active work. Read this in full before touching anything; it is short by design.

**What this document is not.** It is not the record of Phase 4's own formal closure — that still waits on gate item #2 (secret rotation), tracked in §2 below. **Update [2026-09-04]: the earlier version of this section read §2 as a hard gate on starting Phase 5 — that sequencing decision has been reversed.** There never was a technical dependency between the two (Phase 5's own offset-advance rule is gated on PPA's HTTP response; gate item #2 is gated on the PII secret's availability and its rotation — unrelated branches), and the user has now confirmed Phase 5 is prioritized over gate item #2 rather than sequenced after it. §2 stays as a tracked open item — raise it with COMESA when convenient — not as a blocker to anything in this document.

**When this is superseded.** The moment Phase 5's exit criterion is met and the corresponding `docs - MLA/plan.md` §16 progress-log entries land, this document's "what's next" job is done. It stays as the record of where things stood; a later `continue -` doc (Phase 6's, most likely) takes over for what's next.

- [1. Sixty-second orientation](#1-sixty-second-orientation)
- [2. Gate item #2 — still open, tracked, no longer blocking](#2-gate-item-2--still-open-tracked-no-longer-blocking)
- [3. What is already decided — do not re-litigate](#3-what-is-already-decided--do-not-re-litigate)
- [4. What is NOT yet decided — raise these, do not guess](#4-what-is-not-yet-decided--raise-these-do-not-guess)
- [5. The Phase 5 checklist](#5-the-phase-5-checklist)
- [6. The harness, as it stands](#6-the-harness-as-it-stands)
- [7. The exit criterion — read this before calling anything done](#7-the-exit-criterion--read-this-before-calling-anything-done)
- [8. What comes immediately after](#8-what-comes-immediately-after)
- [9. Traps worth knowing before you start](#9-traps-worth-knowing-before-you-start)

---

## 1. Sixty-second orientation

Phase 4 closed live on 2026-09-04 — [`plan.md`](../plan.md) §16's US-PII-01/US-PII-02 entries, and [`docs - MLA/EPICS/EPIC-PII-tokenization/`](../EPICS/EPIC-PII-tokenization/) for the full writeup — **but not formally**: gate item #2 (secret rotation, §2 below) is still open and gates Phase 4's own formal closure, though it no longer gates starting the next phase. What exists now, on top of Phase 3's envelope construction and JWS validation: real PII tokenization (`src/services/tokenization.service.ts`, `src/clients/pii-secret.client.ts`), composed into `envelope-pipeline.service.ts`'s `buildEnvelopeFromKafkaValue` as core-knowledge.md §3.2's step 6, strictly between JWS validation (step 5) and envelope construction (step 7) — and, as of gate item #1's own build, a tokenization failure retries, parks, and feeds a circuit breaker rather than skipping permanently (`ingestion-consumer.service.ts`, `retry-backoff.service.ts`, `pii-circuit-breaker.service.ts`; `plan.md` §16's newest US-PII-01 entry).

**Every record MLA processes now either becomes a schema-valid, tokenized `EventEnvelope`, or is rejected/skipped for a distinct, correctly-classified reason — but nothing is delivered anywhere as MLA's own production behaviour.** `ingestion-consumer.service.ts` still only logs the outcome and advances the offset unconditionally for every reason except `pii-secret-unavailable` (its own module comment says so directly: "Phase 2/3's own scope, not the system's final rule" — gate item #1 is the one deliberate exception, built ahead of Phase 5 at CCH's own request). Phase 3's and Phase 4's own live-verification runs each proved their envelope reaches `ppa-stub` correctly, but each did so with a one-shot mTLS POST (Phase 3) or a checked-in verification tool (`tools/verify-tokenization/run.ts`, Phase 4) built for that phase's own exit criterion — **neither is the production delivery client**. Phase 5 (US-MLA-06, US-MLA-07) is what builds that client for real: retry, circuit breaking, and — the one rule that changes everything downstream of it — gating the Kafka offset on PPA's actual HTTP response, not advancing it unconditionally the way every phase before this one has. **Phase 5 is this session's next work.**

Read in this order:

1. [`cch-mla/CLAUDE.md`](../../../cch-mla/CLAUDE.md) — if this is a new session.
2. **§2 below** — gate item #2 (secret rotation) is still open, but no longer blocks starting or continuing Phase 5. Worth a skim so it isn't lost, not a prerequisite to act on before proceeding.
3. [`../strategy.md`](../strategy.md) — the map. Follow its routing table; do not read the whole knowledge base. **"Working on retry, breakers, or back-pressure"** → `core-knowledge.md` §9 → `US-MLA-07` + `US-PPA-13` → `engineering-rules.md` §6.1.
4. [`../knowledge-base-stories/core-knowledge.md`](../knowledge-base-stories/core-knowledge.md) §3.4–3.5 in full (delivery's routing table, the offset-gated handoff, the retry/circuit-breaker state machine) and §9 (the end-to-end durability/failure/back-pressure chain — this phase is where MLA's half of that chain becomes real for the first time).
5. [`../plan.md`](../plan.md) §8 — the actual Phase 5 checklist, which this document walks through but does not replace.

---

## 2. Gate item #2 — still open, tracked, no longer blocking

**User decision [2026-09-04, superseding the earlier version of this section]: Phase 5 is prioritized over gate item #2.** There is no technical dependency between them — Phase 5's own offset-advance rule is gated on PPA's HTTP response; gate item #2 is gated on the PII secret's rotation, an unrelated branch (see "Not a technical dependency" below, unchanged) — and the sequencing choice that used to tie them together is lifted. **Item #1 is done** (below). **Item #2 remains genuinely open** and still gates Phase 4's own formal closure, but building Phase 5 no longer waits on it. Raise it with COMESA when convenient; do not block on it.

COMESA has answered both of Phase 4's own open engineering decisions. Full detail: `plan.md` §7.1 #1/#2 (the answers, verbatim, with the reasoning) and §13.1 (the blocked-work row, updated to reflect this).

**#1 — Fail-mode: "if tokenization fails, fail the transaction and retry." DONE [2026-09-04].** This confirms fail-*closed* (the event must never forward unprotected — agrees with what was built) and calls for **transient** handling (retry, offset not advancing, feeds the breaker) — implemented, replacing the **permanent** handling (skip once, log, no retry) the mechanism originally shipped with. Built exactly as recommended here: mirrors the MLA→PPA shape (3×, 1s/2s/4s backoff plus genuine jitter, park+breaker at N=5, all four independently configurable — `PII_MAX_RETRIES`/`PII_RETRY_BASE_MS`/`PII_CIRCUIT_BREAKER_THRESHOLD`/`PII_REPROBE_INTERVAL_MS`). New: `retry-backoff.service.ts`, `pii-circuit-breaker.service.ts`, `ingestion-consumer.service.ts` rebuilt around a blocking retry burst handing off to a detached, `kafka.pause()`-backed reprobe loop. 262 tests, 100%/97.91%/100%/100%. **Live-verified precisely, not overclaimed:** against the real harness, with the secret genuinely removed, a re-signed real record retried, parked, paused its partition, and tripped the breaker exactly as designed — confirmed by kafkajs's own "Pausing fetching" log and zero further activity on that partition. The reprobe-recovers-*without-a-restart* path is unit-verified only (`FilePiiSecretClient` caches its answer once at construction — item #2's own territory to change that): what's live-proven instead is the recovery path that actually exists today — restoring the secret and restarting redelivered the exact same parked record (`Forwarded QUOTE ... at partition 2 offset 433`) with nothing lost or duplicated. Full narrative: `plan.md` §16's new US-PII-01 entry (dated the same day as the original, appended per §16's own rule, not an edit to it).

**#2 — Secret rotation: "we should version… try the existing key, then have a failure route which looks for and applies new keys." Still open — not touched by #1's work above.** Confirms versioned keys over drain-first, directly. Adds a mechanism shape not yet built: the hot path keeps using the current active key unchanged (no change needed to `FilePiiSecretClient`'s existing design there), plus a separate, reactive path that checks for and picks up a newer key once one exists. **Genuinely unresolved and worth asking back, not guessing:** MLA's tokenizer only ever writes tokens — it has no natural "verification failed, try another key" signal the way a correlation/matching system would — so what concretely triggers "the failure route" (a timer, an explicit reload signal, something else) is not yet clear from the answer as given. Raise this before building, don't guess a trigger and code to the guess.

**When #2 is done:** write the closing `plan.md` §16 entry for US-PII-02 (a *new* entry, per §16's own append-only rule — never edit the existing one), and mark Phase 4 formally done in `plan.md` §1's status table and `strategy.md` §1. No longer tied to when Phase 5 starts — that already happened.

**Not a technical dependency, stated plainly so it isn't mistaken for one:** Phase 5's own offset-advance rule is gated on PPA's HTTP response; gate item #2 is gated on the PII secret's rotation. Nothing in Phase 5's own build requires it to exist first — which is exactly why the sequencing choice above could be reversed without touching anything technical.

**Why this is still written here, in the *next* phase's own handoff, not left to sit quietly in a superseded document:** `docs - MLA/strategy.md` §2.5's own convention is that only the newest `continue -` doc is read for "what's next" — an older one is read only when tracing history. Carrying gate item #2 forward here — as a tracked open item, not a footnote — is what keeps it from being lost even though it no longer blocks anything in this document.

---

## 3. What is already decided — do not re-litigate

- **The offset-gating rule this phase exists to build is N1, non-negotiable:** commit the Kafka offset only on PPA's HTTP 200. Every phase before this one has advanced the offset unconditionally, as an honest reflection of having nothing to gate it on yet (`ingestion-consumer.service.ts`'s own module comment says this plainly) — this phase is what replaces that unconditional `advance` with the real rule.
- **The routing table is settled** (core-knowledge.md §3.4): one endpoint per event type — `/QUOTES`, `/FXQUOTES`, `/TRANSFERS`, `/FXTRANSFERS` — both legs (request/callback) share it, distinguished inside the envelope by `msgType`, never by URL or method. The FSD's fifth endpoint, `/TRANSFERS/NOTIFICATIONS`, does not apply (§12.1) — there is no such event on the wire.
- **All calls over mutual TLS, addressed via a single stable service name, never individual replica addresses.**
- **Retry and circuit breaking are two coordinated mechanisms, not one** — the POC collapsed these and had no MLA-side threshold at all (`plan.md` §12's divergence register). PPA 5xx/timeout retries up to 3 times with exponential backoff (1s/2s/4s) plus genuinely random jitter; retry exhaustion pauses the offset on that event and keeps retrying it periodically (a transient case, per FSD §5.6), distinct from the circuit breaker tripping after N consecutive failures, which pauses the whole affected partition and re-probes on a timer.
- **A TLS handshake failure is deliberately treated as transient (5xx-equivalent)**, fed into the same retry/breaker path, with the underlying reason preserved in the alert so a certificate rollout blip stays distinguishable from a genuine misconfiguration.
- **A 4xx is permanent** — log the full envelope as an error, alert, advance the offset. Retrying a malformed envelope will not fix it. **User-confirmed [2026-09-04]** to build against this documented default rather than wait on FSD Open Item #8's own resolution — `plan.md` §8.1 #3.
- **No DLQ exists on the MLA side.** The consumer offset plus the audit topic's 7-day retention *is* the recovery mechanism for paused partitions — this is a settled design choice, not a gap to fill in this phase.
- **Jitter must be genuinely random**, not fixed — fixed jitter is the exact failure mode (synchronized replica retry storms) it exists to prevent.
- **MLA→PPA per-call timeout: 2000 ms** (`PPA_TIMEOUT_MS`), replacing the scaffolding-era 5000 ms placeholder. FSD Open Item #1 is still formally unagreed with CCH/Paysys, but this is a decided default to build against, not an open blank — full reasoning in `plan.md` §8.1 #1. Configured independently of the retry/backoff budget, per the story's own AC.
- **Circuit-breaker trip threshold N: 5** consecutive failures. The story only ever asked for "configurable" — this is the decided default value, reasoning in `plan.md` §8.1 #2, not a number to re-derive.

---

## 4. What is NOT yet decided — raise these, do not guess

Per [`plan.md`](../plan.md) §13.2 (filed as "gates production, not the work ahead" — none of these block building or live-verifying this phase's mechanism, the same posture Phase 4's own open items took). **Only one item remains genuinely open here** — the timeout value and the breaker threshold were both decided (moved to §3 above, `plan.md` §8.1) rather than left as blanks, and the offset-advance policy was confirmed to build against its documented default:

- **Dedicated Kafka consumer group ID is not yet issued** (R-18) — unchanged from every prior phase's own note: a reused DRPP-internal group name is the one misconfiguration in this system capable of affecting live payments. **User-confirmed [2026-09-04]: deployment-only, no build action** — the placeholder `cch-mla-ingestion` remains local-only; this needs a real, issued value before any real deployment, not before writing this phase's code.

**§2's two items are not "not yet decided" — both are decided, by COMESA.** Listed there, not here: item #1 is done, and item #2 (still open) no longer gates this phase's work, only Phase 4's own formal closure.

---

## 5. The Phase 5 checklist

This is [`plan.md`](../plan.md) §8, US-MLA-06 and US-MLA-07. Nothing on it is built yet.

- [x] **Endpoint selection by `eventType` per D4** — the routing table above, read from the envelope's own `eventType` field, never re-derived from anything else. *Built, tested, live-verified — `src/services/ppa-routing.service.ts`'s `resolvePpaEndpoint`. Not yet called from the consumer's own delivery path.*
- [x] **mTLS client configuration**; stable service-name addressing, never individual replica addresses. *Built, tested, live-verified — `src/clients/ppa.client.ts`'s `HttpsPpaClient`, the `PpaClient` port. Live-verified against a real running `ppa-stub`: a correct cert (success), a genuinely untrusted cert (tls-handshake-failure), an unreachable host (network-error), a 4xx, and a 5xx via fault injection — each produced the correctly classified outcome. Worth reading before touching this file again: the TLS-handshake classification went through two wrong designs before landing on the right one, each ruled out by this exact live check, not by inspection — see `ppa.client.ts`'s own comment on `classifyTransportError`. Not yet wired into `ingestion-consumer.service.ts` — no offset-gating, retry, timeout, or breaker logic consumes this client yet.*
- [ ] **Per-call timeout, configured independently of the retry budget.**
- [ ] **Offset advances only on HTTP 200.** This is the load-bearing change this phase makes — replacing `ingestion-consumer.service.ts`'s current unconditional `kafka.advance(...)` with a call gated on the delivery client's own response.
- [ ] **5xx / timeout / TLS-handshake failure ⇒ retry ×3, exponential backoff (1s/2s/4s) with genuinely random jitter, offset not advancing.**
- [ ] **TLS handshake failure treated as transient, with the underlying reason preserved in the alert.**
- [ ] **4xx ⇒ log the full envelope, alert, advance. Permanent, never retried.**
- [ ] **Retry exhaustion and circuit breaking as two coordinated mechanisms.** Exhaustion parks the event and keeps retrying it on a timer; those failures accumulate toward a configurable N; at N the breaker trips and pauses the whole affected partition, re-probing on a timer.
- [ ] **Every pause paired with a re-probe that can resume it.** A partition paused with no path back is the exact bug the POC's own breaker existed to fix (`plan.md` §12).

**Exit criterion — live.** Against `ppa-stub`: a 503 leaves the offset unadvanced and the event is redelivered on recovery; three 5xx responses produce three backed-off retries with visibly different jitter; N consecutive failures trip the breaker and pause consumption; restoring the stub resumes from the paused event with nothing lost or duplicated; a 4xx advances immediately; a TLS handshake failure retries and its alert names the handshake, not a generic 5xx.

---

## 6. The harness, as it stands

Unchanged in shape from Phase 3/4 — nothing about this phase requires new harness tooling, only a new client on top of what already runs. One addition since Phase 4: the PII secret must exist for the pipeline to forward anything at all (fail-closed default).

```bash
cd cch-mla
npm run harness:up             # Redpanda up, topic-event-audit at 12 partitions (may already be running - check docker ps first)
npm run certs:generate         # local CA + server + client certs, if not already generated
npm run keys:generate -- <dfspId>   # a local RSA keypair for JWS, if not already generated (Phase 3)
npm run pii-secret:generate    # a local PII tokenization secret, if not already generated (Phase 4)
npm run ppa-stub                # in one terminal - mTLS business endpoints + plain-HTTP control/health
npm run feeder -- --file __tests__/fixtures/DRPP_Kafka_E2E_Pack/raw_topic_slice_partition2.json
```

**Set `PPA_STUB_MTLS_PORT`/`PPA_STUB_HOST` env vars, or the default `localhost:4443`, when pointing this phase's own delivery client at `ppa-stub`** — `tools/verify-tokenization/run.ts` already does exactly this and is a working reference for the mTLS client configuration this phase needs to build for real, inside `src/`, not just as a verification tool.

The one-machine-specific note carried forward again: the snap-packaged `docker compose` (space) plugin and even plain `docker exec`/`docker ps --format` can fail silently or return nothing when run from this environment's process tree. The standalone `docker-compose` (hyphen) binary at `~/.local/bin/docker-compose` is unaffected and is what actually starts/stops the harness; prefer host-side scripts (`capture-feeder`, `tools/golden`, `tools/verify-tokenization`) that connect to the broker's exposed port over any `docker exec` for anything that needs to inspect the running container. **The harness broker port is `19092`, not the default `9092`** `.env.template` ships as `KAFKA_BROKERS`'s comment-adjacent default — set `.env`'s `KAFKA_BROKERS=localhost:19092` explicitly, confirmed live this session after the default silently pointed at the wrong port.

---

## 7. The exit criterion — read this before calling anything done

From [`plan.md`](../plan.md) §8, verbatim:

> Against `ppa-stub`: a 503 leaves the offset unadvanced and the event is redelivered on recovery; three 5xx responses produce three backed-off retries with visibly different jitter; N consecutive failures trip the breaker and pause consumption; restoring the stub resumes from the paused event with nothing lost or duplicated; a 4xx advances immediately; a TLS handshake failure retries and its alert names the handshake, not a generic 5xx.

Concretely, extending Phase 4's own live-verification pattern:

```
npm run harness:up
npm run ppa-stub
npm run feeder -- --file __tests__/fixtures/DRPP_Kafka_E2E_Pack/raw_topic_slice_partition2.json
# start the MLA against the real topic; for a forwarded record, confirm:
# - a 503 from ppa-stub (via POST /control) leaves the offset paused and the
#   event redelivered once the stub returns to `ok`
# - three consecutive 5xx responses produce three retries with visibly
#   different backoff/jitter timing, not a fixed interval
# - N consecutive failures trip the breaker; consumption on that partition
#   pauses; restoring ppa-stub health resumes it with nothing duplicated
# - a 4xx advances the offset immediately, logs the envelope, alerts
# - a simulated TLS handshake failure (a wrong/expired client cert) retries
#   and its alert names the handshake specifically, not a generic 5xx
```

**When this is genuinely done:**

1. Add the corresponding entries to [`plan.md`](../plan.md) §16 — one per story (US-MLA-06, US-MLA-07) — what was built, what was verified live versus assumed, what diverged, what is left open.
2. Write `docs - MLA/EPICS/EPIC-3-delivery-to-ppa-offset-management/US-MLA-06/` and `.../US-MLA-07/` — each its own `executive-summary.md` and `file-register.md` — plus the epic-level rollup once both stories close, per `CLAUDE.md`'s "Epic and story documentation" rule.
3. Run the staleness sweep `CLAUDE.md`'s documentation register requires — `strategy.md` §1, `plan.md` §1's status table, and `cch-mla/README.md`'s status section all currently say Phase 5 is next; that stops being true the moment this phase's exit criterion is met. **Also check whether gate item #2 (§2 above) has landed by then** — if it has, close out Phase 4's formal status in the same sweep rather than leaving it stranded in a now-doubly-superseded document.
4. Leave it all in the working tree for the user to commit — `CLAUDE.md`'s "Commits" rule.
5. Move to [`plan.md`](../plan.md) §9, Phase 6 — observability and operability (metrics, alert wiring — including the tokenization-failure metric Phase 4 only ever built as an interim log line).

---

## 8. What comes immediately after

- **Phase 6** (observability and operability) is what gives this phase's own retry/breaker state, and Phase 4's tokenization-failure log line, real metrics and wired alerting — this phase only needs to produce the *signal* (a distinguishable log line, a countable outcome), not route it anywhere production-grade yet, the same interim posture every phase before it has taken.
- **This phase's delivery client is what Phase 3's and Phase 4's own one-shot mTLS proofs were each standing in for.** Both were genuine, live, checked-in-or-documented verification — never claimed as more than that — and this phase is what replaces the need for either to be repeated by hand.
- **Gate item #2 (secret rotation) runs alongside this phase, not before it, by user decision [2026-09-04].** It is an unrelated change to an unrelated branch — this phase's own offset-advance rule is gated on PPA's HTTP response; item #2 is gated on the PII secret's rotation. Nothing about Phase 5's own design depends on it either way.

---

## 9. Traps worth knowing before you start

- **Do not let "offset advances only on HTTP 200" quietly become "offset advances on any 2xx" or "offset advances unless the call throws."** The story's own language is exact, and every phase before this one has advanced unconditionally specifically because nothing existed to gate it on — this phase is the one place that unconditional behaviour must actually stop.
- **The circuit breaker and retry exhaustion are two mechanisms, not one, and conflating them is the exact defect the POC shipped** (`plan.md` §12's divergence register names this explicitly). Retry exhaustion is a per-event, transient state that keeps retrying; the breaker is a per-partition, systemic state that stops trying and waits for a re-probe. Losing the distinction between the two is losing the reason this phase exists.
- **A TLS handshake failure must retry with its own diagnosable reason, never silently folded into a generic 5xx alert** — the FSD's own reasoning (R-22) is that a handshake failure could be a rollout blip or a genuine misconfiguration, and an operator needs to tell which from the alert alone, not from re-deriving it.
- **Jitter must be genuinely random, tested as such.** A fixed or pseudo-fixed jitter passes a superficial read of the retry logic while reintroducing the exact synchronized-retry-storm failure mode jitter exists to prevent — write a test that actually samples multiple retry delays and confirms they differ, not one that only confirms a delay occurred.
- **`tools/verify-tokenization/run.ts` is a verification tool, not a template to copy into `src/`.** It deliberately reaches for the real client classes and the real pipeline function from outside `src/`, over a real network call, exactly because that is what a verification tool should do — but the actual delivery client this phase builds belongs inside `src/`, behind a `PpaClient` port (`engineering-rules.md` §2.3), injected at the composition root, with retry/breaker state that survives across calls in a way a one-shot script never needs to model.

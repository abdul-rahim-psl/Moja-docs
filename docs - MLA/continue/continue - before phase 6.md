<!-- SPDX-License-Identifier: Apache-2.0 -->

# Continue — Before Phase 6 <!-- omit in toc -->

**What this document is.** A session handoff. It marks the point where Phase 5's delivery, offsets, and resilience mechanism is fully built, tested, and live-verified end to end — every clause of its own exit criterion met, including the one that matters most: a tripped circuit breaker recovering an entire parked partition automatically, with no process restart. Phase 6's observability and operability work ([`plan.md`](../plan.md) §9) is now the active work. Read this in full before touching anything; it is short by design.

**What this document is not.** It is not the record of Phase 5's own closure — that is `plan.md` §16's US-MLA-06/US-MLA-07 entries and [`docs - MLA/EPICS/EPIC-3-delivery-to-ppa-offset-management/`](../EPICS/EPIC-3-delivery-to-ppa-offset-management/), both already written and current. Nor is it Phase 4's own closure — gate item #2 (secret rotation) is still open and tracked in §2 below, carried forward again, unrelated to anything in this document.

**When this is superseded.** The moment Phase 6's exit criterion is met and the corresponding `docs - MLA/plan.md` §16 progress-log entry lands, this document's "what's next" job is done. It stays as the record of where things stood; a later `continue -` doc (Phase 7's, most likely) takes over for what's next.

- [1. Sixty-second orientation](#1-sixty-second-orientation)
- [2. Gate item #2 — still open, tracked, still not blocking](#2-gate-item-2--still-open-tracked-still-not-blocking)
- [3. What is already decided — do not re-litigate](#3-what-is-already-decided--do-not-re-litigate)
- [4. What is NOT yet decided — raise these, do not guess](#4-what-is-not-yet-decided--raise-these-do-not-guess)
- [5. The Phase 6 checklist](#5-the-phase-6-checklist)
- [6. The harness, as it stands](#6-the-harness-as-it-stands)
- [7. The exit criterion — read this before calling anything done](#7-the-exit-criterion--read-this-before-calling-anything-done)
- [8. What comes immediately after](#8-what-comes-immediately-after)
- [9. Traps worth knowing before you start](#9-traps-worth-knowing-before-you-start)

---

## 1. Sixty-second orientation

Phase 5 closed live on 2026-09-07 — [`plan.md`](../plan.md) §16's US-MLA-06/US-MLA-07 entries, and [`docs - MLA/EPICS/EPIC-3-delivery-to-ppa-offset-management/`](../EPICS/EPIC-3-delivery-to-ppa-offset-management/) for the full writeup. What exists now, on top of Phases 0–4's ingestion, envelope construction, JWS validation, and PII tokenization: real delivery to PPA (`src/clients/ppa.client.ts`'s `HttpsPpaClient`), routed by `eventType` (`ppa-routing.service.ts`), with a per-call timeout independent of the retry budget, composed into `ingestion-consumer.service.ts`'s three-way classification of every `forwarded` outcome's delivery result — `success` advances the Kafka offset (N1, finally the *whole* rule, not the interim uniform-pause placeholder every earlier session of this phase built); a permanent `client-error` (4xx) logs the full envelope and advances immediately, never retried; a transient result (5xx, timeout, TLS-handshake failure, and — a reasoned, flagged default — a bare network error) retries with genuine jitter, and on exhaustion parks the event behind a **per-partition** circuit breaker (`PpaCircuitBreaker`, deliberately not process-wide like the PII secret's own breaker — `circuit-breaker.service.ts`'s comment has the full reasoning) that re-probes on a timer and resumes entirely on its own.

**Every stage of MLA's own pipeline now has a real, live-verified answer for every record it sees — and, for the first time, that answer includes what happens after PPA is asked to take it.** Nothing about this is claimed as more than what was actually run: the automatic, restart-free breaker recovery is the one live proof in this whole project so far that a *systemic* PPA outage heals itself without operator intervention, and it happened, live, once, on real captured data.

**What Phase 6 is not starting from a blank slate on, and what it is.** `pino` structured logging has been in place since Phase 0; every log line already carries a `serviceOperation` field naming the pipeline step. **Resolved [2026-09-08] — §5's first checklist item:** `correlationId` and `eventType` are now their own structured fields, live-verified against the real harness, not merely interpolated into message text; `serviceOperation` on the ingestion path is now five granular pipeline-step values instead of one blanket string. **Still genuinely open:** ack latency is not measured anywhere — there is no clock started at consumption and stopped at commit or delivery. None of this is a surprise buried in the code; it was stated plainly here because `plan.md` §15's own sequencing note warned it would be far more expensive to retrofit than to build in from the start, and the retrofit is exactly what §5's first item now records as done.

Read in this order:

1. [`cch-mla/CLAUDE.md`](../../../cch-mla/CLAUDE.md) — if this is a new session.
2. **§2 below** — gate item #2 (secret rotation) is still open, tracked again here so it is not lost, but does not block anything in this document.
3. [`../strategy.md`](../strategy.md) — the map. Follow its routing table; do not read the whole knowledge base.
4. [`../knowledge-base-stories/core-knowledge.md`](../knowledge-base-stories/core-knowledge.md) §9 (the end-to-end durability/failure/back-pressure chain — every signal Phase 6 must make visible is already named there) and `engineering-rules.md` §9 (the observability question list and its four binding rules — this is the phase's own spec, more than the terse plan.md §9 checklist is).
5. [`../plan.md`](../plan.md) §9 — the actual Phase 6 checklist, which this document walks through but does not replace. `cch-crosscutting-user-stories.md` (US-AUD-01, US-MON-01/R-37, US-MON-02, US-PERF-01/02, US-SEC-01) — named absent by `plan.md` §13.1 when this document was first written — **was obtained [2026-09-07] and is now cross-referenced into `core-knowledge.md`.** It confirms the observability stack (Prometheus/Grafana/Loki/Tempo/Mimir, IDD §10); only R-37 (alerting destination/routing) remains genuinely open, and only that gates this phase's formal closure now, not the whole document's absence.

---

## 2. Gate item #2 — still open, tracked, still not blocking

Unchanged from `continue - before phase 5.md` §2, carried forward again so it is not lost: **COMESA confirmed versioned keys over drain-first for PII secret rotation, but the trigger mechanism for "a failure route which looks for and applies new keys" is genuinely ambiguous** — MLA's tokenizer only ever writes tokens, with no natural "verification failed, try another key" signal the way a correlation/matching system would. Raise this with COMESA when convenient; do not guess a trigger and build against the guess.

**Not a technical dependency on Phase 6 either, for the same reason it was not one on Phase 5:** this item is gated on the PII secret's own rotation; nothing in Phase 6's observability work depends on it, and nothing in Phase 6 helps resolve it. When it closes, write the closing `plan.md` §16 entry for US-PII-02 (a *new* entry, append-only) and mark Phase 4 formally done in `plan.md` §1's status table and `strategy.md` §1 — in whichever phase's own session happens to be running when COMESA answers, not necessarily this one.

---

## 3. What is already decided — do not re-litigate

Everything Phase 5 settled stays settled; Phase 6 does not reopen any of it. Worth restating only the pieces Phase 6's own observability work will most directly touch:

- **`core-knowledge.md` §9's six operator questions are the spec, not a suggestion**: is the pipeline moving (throughput, consumer lag per event type); is anything being dropped, deliberately (skip counters by reason); are we degrading (degraded-message rate, tokenization-failure rate); are we backed up (503 rate, breaker state as a metric **on both breakers** — PII's process-wide one and PPA's per-partition one now both genuinely exist); is anything stuck (DLQ depth — there is none on the MLA side by design, so this is parked-entry count and retry-exhaustion count instead); are we within budget (ack latency p95 against 200ms).
- **A metric for every decision the code makes silently** (`engineering-rules.md` §9) — a domestic transfer, an `egress` record, a party-lookup skip each produce no alert *by design*; their counters are the only visibility that exists for them, and Phase 6 is what makes that visibility real rather than assumed.
- **A log line is not an alert and an alert is not a log line.** Every `SECURITY`-marked log (missing/invalid JWS), every permanent-rejection log (a 4xx's full envelope), and every breaker-trip log built across Phases 2–5 is the honest interim equivalent of "alert raised" — stated as such in each phase's own code comments — and Phase 6 is what makes that claim literally true instead of aspirational.
- **PII's breaker is process-wide; PPA's is per-partition — a settled, reasoned divergence, not an inconsistency to fix.** Phase 6's own breaker-state metric needs to reflect this: one gauge for the PII breaker, one gauge *per partition* for the PPA breaker, not a single flattened "is the breaker open" boolean that would misrepresent PPA's own scope.
- **Alerting destinations are undecided (R-37)** and this is a known, named blocker (`plan.md` §9's own "Blocked" note, §13.1's row) — build the alert *paths*, leave the sink configurable, exactly the same posture Phase 5 took toward its own undecided timeout value (build against a stated, reversible default).

---

## 4. What is NOT yet decided — raise these, do not guess

- ~~`cch-crosscutting-user-stories.md` is referenced throughout the requirements but the document itself is absent~~ **Resolved [2026-09-07] — obtained and cross-referenced into `core-knowledge.md`.** It is the source for US-AUD-01 (audit-log PII masking, PPA-side — not this phase's build), US-MON-01 (monitoring — a seven-signal spec, more specific than `plan.md` §9's own terse checklist: per-partition consumer lag, a separately-alerted paused-offset-rate metric, degraded-message rate, breaker state at both hops, Prometheus-compatible endpoints), US-MON-02 (readiness scoping — confirms what was already built correctly, instance-local only, per `engineering-rules.md` §8), and US-PERF-01/02 (the ≤200ms MLA / ≤500ms PPA p95 latency budgets, ValKey sizing). **No longer gates Phase 6 in full** — only R-37 (below) still gates formal closure.
- **Alerting destinations themselves (R-37, confirmed High severity)** — Slack, PagerDuty, email, a webhook, something else entirely, plus the routing mechanism connecting a condition to it (e.g. Grafana Alertmanager). **Still genuinely open** — build the paths against a configurable sink; do not guess a destination and wire it in as if decided. A SIEM/log-aggregation platform (IDD Open Item #8) is a separate, also-open question, relevant to audit-log output rather than metrics.
- ~~What "real" observability infrastructure looks like in the target environment~~ **Resolved [2026-09-07] — confirmed, not open.** Prometheus, Grafana, Loki, Tempo, Mimir (IDD §10, a 28 July infrastructure discussion). CCH owns the metrics-collection agents; this build's job is to expose Prometheus-compatible endpoints — `prom-client` is the natural library choice, not a guess.

---

## 5. The Phase 6 checklist

This is [`plan.md`](../plan.md) §9. One item below is now built, tested, and live-verified; the rest are not yet started.

- [x] **Structured logging (`pino`) with `correlationId`, `eventType` and pipeline step on every line.** *Built, tested, live-verified [2026-09-08].* The `Logger` port (`logger.interface.ts`) now takes a `LogContext` object (`correlationId`/`eventType`/`serviceOperation`) instead of a bare `serviceOperation` string, spread verbatim onto pino's own merging argument (`logger.client.ts`) — every call site across the codebase updated, not just `ingestion-consumer.service.ts`. Two real gaps this retrofit found and fixed, not just plumbed around:
  - **`eventType` was silently dropped on six of `envelope-pipeline.service.ts`'s own skip reasons** (`missing-signature`, `invalid-signature`, `key-source-unavailable`, `pii-secret-unavailable`, `incomplete-envelope`, `invalid-envelope-schema`) even though classification had already resolved it by the time any of them fire — a plumbing gap, not a genuine unknown, now threaded through as an optional field on `EnvelopePipelineOutcome`'s `skipped` branch (deliberately still absent for Phase 2's own five reasons — `unreadable`/`fx-quote-rejected`/`egress`/`party-lookup`/`unclassifiable` — since classification never resolves one for those).
  - **A latent type bug in `ingestion-consumer.service.ts`**: `PiiUnavailableOutcome` was declared as `Extract<SkippedOutcome, { reason: 'pii-secret-unavailable' }>`, which silently resolved to `never` (`SkippedOutcome` is a single object type whose `reason` field is a union, not itself a discriminated union `Extract` can distribute over) — invisible until this phase's own `.eventType` access on the narrowed type surfaced it as a compile error. Fixed via intersection (`SkippedOutcome & { reason: '...' }`), which narrows correctly.
  - `ingestion-consumer.service.ts`'s own single blanket `serviceOperation: 'ingestion'` (every line, no distinction) is now five granular values matching the pipeline's own stages: `ingestion.classification`, `ingestion.jws`, `ingestion.envelope`, `ingestion.pii`, `ingestion.ppa-delivery`, plus `ingestion.unhandled` for the top-level catch (which also now attaches `correlationId`, hoisted above the `try` for exactly this).
  - 308 tests, 100%/98.01%/100%/100% coverage, zero lint errors. **Live-verified** against the real harness (Redpanda + `ppa-stub`, `raw_topic_slice_partition2.json`, LOG_LEVEL=debug/info both checked): every one of the 41 records accounted for (26 `ingestion.classification` skips with `correlationId` and correctly **no** `eventType`, 15 `ingestion.jws` failures with **both** `correlationId` and `eventType` populated — e.g. `{"correlationId":"...","eventType":"FXQUOTE","serviceOperation":"ingestion.jws","msg":"SECURITY: invalid FSPIOP-Signature..."}`, confirming the exact gap this item closes, live, on real captured data, not just in a unit test.
- [ ] Metrics for every question an operator must answer without a debugger: throughput and **per-partition** consumer lag, plus a **paused-offset-rate** metric alerted separately from lag (US-MON-01 — the two indicate different failure modes); skip counters **by reason** (`egress`, party-lookup, unclassifiable, FX-quote-rejected, unreadable); rejection counters (missing/invalid signature, key-source outage, 4xx); tokenization failures; retry and breaker state (both breakers, per §3 above); delivery outcomes (success/client-error/server-error/timeout/tls-handshake-failure/network-error — `PpaDeliveryResult`'s own six-way union already gives this its exact shape); ack latency against the 200ms p95 budget (US-PERF-01, now confirmed, not gated — §4 above), exposed on a Prometheus-compatible endpoint (the confirmed stack, §4 above).
- [ ] **A metric for every decision the code makes silently.** Anything dropped without an alert must still be counted — otherwise a wrongly-dropped record is indistinguishable from a correctly-dropped one.
- [ ] Alert paths wired for: missing/invalid signature, 4xx, retry exhaustion, breaker trip, tokenization failure. **Sink configurable, destination undecided** (§4 above).

**Exit criterion.** A full 500-record feed (`raw_export_500.json` — already in hand, `plan.md` §1.1) produces a metrics snapshot in which every record is accounted for in exactly one bucket, and the buckets sum to 500.

---

## 6. The harness, as it stands

Unchanged in shape from Phase 5 — nothing about this phase requires new harness tooling to *produce* the signals it needs to observe; `ppa-stub`'s own fault-injection control plane (`POST /control {mode, afterN, forMs}`) already drives every failure class this phase's metrics/alerts need to be proven against.

```bash
cd cch-mla
npm run harness:up             # Redpanda up, topic-event-audit at 12 partitions (may already be running - check docker ps first)
npm run certs:generate         # local CA + server + client certs, if not already generated
npm run keys:generate -- <dfspId>   # a local RSA keypair for JWS, if not already generated (Phase 3)
npm run pii-secret:generate    # a local PII tokenization secret, if not already generated (Phase 4)
npm run ppa-stub                # in one terminal - mTLS business endpoints + plain-HTTP control/health
npm run feeder -- --file __tests__/fixtures/DRPP_Kafka_E2E_Pack/raw_export_500.json   # the 500-record exit-criterion feed
```

The two one-machine-specific notes carried forward again: the snap-packaged `docker compose` (space) plugin can fail silently in this environment — the standalone `docker-compose` (hyphen) binary at `~/.local/bin/docker-compose` is what actually starts/stops the harness. **The harness broker port is `19092`, not the default `9092`** — `.env`'s `KAFKA_BROKERS=localhost:19092` must be set explicitly.

---

## 7. The exit criterion — read this before calling anything done

From [`plan.md`](../plan.md) §9, verbatim:

> A full 500-record feed produces a metrics snapshot in which every record is accounted for in exactly one bucket, and the buckets sum to 500.

Concretely, extending Phase 5's own live-verification pattern:

```
npm run harness:up
npm run ppa-stub
npm run feeder -- --file __tests__/fixtures/DRPP_Kafka_E2E_Pack/raw_export_500.json
# start the MLA against the real topic; once the feed is fully consumed, pull the
# metrics snapshot and confirm:
# - every one of the 500 records landed in exactly one counted bucket (forwarded,
#   or one of the named skip/rejection/failure reasons) - none missing, none double-counted
# - a deliberately injected fault (a 503 burst via ppa-stub's /control, a stripped
#   signature, a missing PII secret) increments the correct counter and, once wired,
#   fires the correct alert path
# - every log line emitted during the run carries correlationId and eventType,
#   not just serviceOperation
# - ack latency is measured and reported, even if the p95 budget itself
#   (US-PERF-01) is still unconfirmed
```

**When this is genuinely done:**

1. Add the corresponding entry to [`plan.md`](../plan.md) §16 for this phase's own story/stories once `cch-crosscutting-user-stories.md` names them properly (§4 above) — what was built, what was verified live versus assumed, what diverged, what is left open.
2. Write `docs - MLA/EPICS/` documentation for whatever epic this phase's stories land under, per `CLAUDE.md`'s "Epic and story documentation" rule — `executive-summary.md` and `file-register.md`, at both the story and epic level.
3. Run the staleness sweep `CLAUDE.md`'s documentation register requires — `strategy.md` §1, `plan.md` §1's status table, and `cch-mla/README.md`'s status section all currently say Phase 6 is next; that stops being true the moment this phase's exit criterion is met. **Also check whether gate item #2 (§2 above) has landed by then** — if it has, close out Phase 4's formal status in the same sweep rather than leaving it stranded in a now-doubly-superseded document.
4. Leave it all in the working tree for the user to commit — `CLAUDE.md`'s "Commits" rule.
5. Move to [`plan.md`](../plan.md) §10, Phase 7 — hardening and validation.

---

## 8. What comes immediately after

- **Phase 7** (hardening and validation, `plan.md` §10) is what this phase's own metrics make provable at scale/under load — the 200ms p95 ack-latency budget this phase measures is Phase 7's own territory to validate against sustained traffic, not just a single 500-record feed.
- **This phase's alert paths are what every "alert raised" comment across Phases 2–5's own code has been standing in for.** Each was genuine, honest interim behaviour — never claimed as more than a structured log line — and this phase is what replaces the need for any of them to be taken on faith.
- **Gate item #2 (secret rotation) runs alongside this phase too, exactly as it ran alongside Phase 5** — an unrelated branch, still open, still not gating anything here.

---

## 9. Traps worth knowing before you start

- ~~Do not let "structured logging already exists" read as "this checklist item is already done."~~ **Resolved [2026-09-08] — §5's first checklist item.** `correlationId` and `eventType` are now their own structured field on every log line that can know them, live-verified against the real harness, not assumed. The trap this bullet warned about no longer applies to this specific item — it stays here, struck through, only as the record of what to check before trusting a similar-looking claim about a *different* checklist item below.
- **A metric and an alert are not the same claim, and conflating them is the exact anti-pattern `engineering-rules.md` §9 names.** A structural skip (`egress`, party-lookup) needs a *counter*, never an alert — the alert paths this checklist asks for are for the five named failure classes only (missing/invalid signature, 4xx, retry exhaustion, breaker trip, tokenization failure), not for every counted event.
- **"Breaker state as a metric on both breakers" means two genuinely different shapes, not one.** PII's breaker is one process-wide boolean/gauge; PPA's is one gauge *per partition* (`PpaCircuitBreaker`'s own per-partition `Map`). A metric design that flattens PPA's own breaker state into a single value the way PII's naturally is would misrepresent exactly the scope distinction Phase 5 spent real reasoning establishing — see `circuit-breaker.service.ts`'s own comment before designing this metric.
- **Ack latency has no clock anywhere yet.** This is new instrumentation, not a value already computed and merely unexposed — do not assume a `Date.now()` call already exists near the consumer's own entry point; it does not (verified by grep, §1 above).
- ~~`cch-crosscutting-user-stories.md`'s absence blocks this phase in full, per `plan.md` §13.1~~ **Resolved [2026-09-07] — obtained.** Its US-MON-01 acceptance criteria are meaningfully more specific than `plan.md` §9's own terse four bullets (per-partition lag, a separate paused-offset-rate metric, breaker state at both hops, a Prometheus-compatible endpoint) — build against the story's own ACs (reproduced in §5 above and in `core-knowledge.md` §11/§13.2), not just the checklist's terse wording. **Only R-37 (alerting destination/routing) still gates this phase's formal closure** — the document's absence itself no longer does.

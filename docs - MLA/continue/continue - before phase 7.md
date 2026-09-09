<!-- SPDX-License-Identifier: Apache-2.0 -->

# Continue — Before Phase 7 <!-- omit in toc -->

**What this document is.** A session handoff. It marks the point where Phase 6's observability and operability work is fully built, tested, and live-verified end to end — every clause of its own exit criterion met, including a full 500-record feed accounted for in exactly one bucket, summing to 500, and all five named alert conditions raised independently against the real harness. Phase 7's hardening and validation ([`plan.md`](../plan.md) §10) is now the active work. Read this in full before touching anything; it is short by design.

**What this document is not.** It is not the record of Phase 6's own closure — that is `plan.md` §16's US-MON-01/US-PERF-01 entries and [`docs - MLA/EPICS/PHASE-6-Observability-Operability/`](../EPICS/PHASE-6-Observability-Operability/), both already written and current. Nor is it Phase 4's own closure — gate item #2 (secret rotation) is still open and tracked in §2 below, carried forward again, unrelated to anything in this document.

**When this is superseded.** The moment Phase 7's exit criterion is met and the corresponding `docs - MLA/plan.md` §16 progress-log entry lands, this document's "what's next" job is done. It stays as the record of where things stood; a later `continue -` doc (Phase 8's, most likely) takes over for what's next.

- [1. Sixty-second orientation](#1-sixty-second-orientation)
- [2. Gate item #2 — still open, tracked, still not blocking](#2-gate-item-2--still-open-tracked-still-not-blocking)
- [3. What is already decided — do not re-litigate](#3-what-is-already-decided--do-not-re-litigate)
- [4. What is NOT yet decided — raise these, do not guess](#4-what-is-not-yet-decided--raise-these-do-not-guess)
- [5. The Phase 7 checklist](#5-the-phase-7-checklist)
- [6. The harness, as it stands](#6-the-harness-as-it-stands)
- [7. The exit criterion — read this before calling anything done](#7-the-exit-criterion--read-this-before-calling-anything-done)
- [8. What comes immediately after](#8-what-comes-immediately-after)
- [9. Traps worth knowing before you start](#9-traps-worth-knowing-before-you-start)

---

## 1. Sixty-second orientation

Phase 6 closed live on 2026-09-08 — [`plan.md`](../plan.md) §16's US-MON-01/US-PERF-01 entries, and [`docs - MLA/EPICS/PHASE-6-Observability-Operability/`](../EPICS/PHASE-6-Observability-Operability/) for the full writeup. What exists now, on top of Phases 0–5's ingestion, envelope construction, JWS validation, PII tokenization, and delivery/resilience: structured logs carrying `correlationId`/`eventType`/pipeline step on every line; ten Prometheus-compatible metrics answering every operator question `core-knowledge.md` §9 and `engineering-rules.md` §9 name; and alert paths wired at all five named conditions (missing/invalid signature, a PPA 4xx, retry exhaustion, a breaker trip, a PII tokenization failure) — each raising both a metrics-based signal (`mla_alerts_total{type,severity}`, always active) and an optional configurable webhook, never a guessed destination.

**Every stage of MLA's own pipeline now has a real, live-verified answer for every record it sees — and, for the first time, every one of those answers is also genuinely observable and alertable, not just logged.** Nothing about this is claimed as more than what was actually run: all five alert conditions fired independently against a real broker and a real `ppa-stub`, on genuinely re-signed records, and the phase's own 500-record exit criterion was run live — every record landed in exactly one counted bucket, summing to 500.

**What Phase 7 is not starting from a blank slate on, and what it is.** The clock, the metric and the alert now exist for every decision the pipeline makes; what does not yet exist is proof any of it holds up under sustained or peak load, under real concurrency (two replicas), or under chaos (a mid-dispatch kill, a broker restart, a flapping stub). Phase 6's own `mla_ack_latency_ms` histogram is what Phase 7's load test will read; nothing about it needs to be rebuilt, only exercised at volume for the first time.

Read in this order:

1. [`cch-mla/CLAUDE.md`](../../../cch-mla/CLAUDE.md) — if this is a new session.
2. **§2 below** — gate item #2 (secret rotation) is still open, tracked again here so it is not lost, but does not block anything in this document.
3. [`../strategy.md`](../strategy.md) — the map. Follow its routing table; do not read the whole knowledge base.
4. [`../knowledge-base-stories/core-knowledge.md`](../knowledge-base-stories/core-knowledge.md) §9/§11 (the durability/failure/back-pressure chain and the NFRs — the 25/125 TPS baseline and the 200ms/500ms p95 budgets Phase 7 must confirm are already named there) and `engineering-rules.md` §10–§11 (the testing standard and the live-verification rule — this phase is almost entirely live verification, more than any phase before it).
5. [`../plan.md`](../plan.md) §10 — the actual Phase 7 checklist, which this document walks through but does not replace.

---

## 2. Gate item #2 — still open, tracked, still not blocking

Unchanged from `continue - before phase 6.md` §2, carried forward again so it is not lost: **COMESA confirmed versioned keys over drain-first for PII secret rotation, but the trigger mechanism for "a failure route which looks for and applies new keys" is genuinely ambiguous** — MLA's tokenizer only ever writes tokens, with no natural "verification failed, try another key" signal the way a correlation/matching system would. Raise this with COMESA when convenient; do not guess a trigger and build against the guess.

**Not a technical dependency on Phase 7 either, for the same reason it was not one on Phases 5 or 6:** this item is gated on the PII secret's own rotation; nothing in Phase 7's hardening/validation work depends on it, and nothing in Phase 7 helps resolve it. When it closes, write the closing `plan.md` §16 entry for US-PII-02 (a *new* entry, append-only) and mark Phase 4 formally done in `plan.md` §1's status table and `strategy.md` §1 — in whichever phase's own session happens to be running when COMESA answers, not necessarily this one.

**A second, unrelated open item is also carried forward: R-37 (alerting destination/routing), still open with CCH.** Phase 6 built and live-verified a genuinely configurable alert sink (a metrics-based one, always active, plus an optional webhook) against this exact open decision, per `CLAUDE.md`'s "External decisions" rule — the mechanism is done; only the real destination is still CCH's to name. Nothing in Phase 7 depends on R-37 either.

---

## 3. What is already decided — do not re-litigate

Everything Phases 5 and 6 settled stays settled; Phase 7 does not reopen any of it. Worth restating only the pieces Phase 7's own hardening work will most directly touch:

- **The load-test targets are named, not Phase 7's to invent**: 25 TPS sustained (30 minutes), 125 TPS peak (5 minutes), a step-down from peak to sustained with no event loss, MLA's own ack latency ≤200ms p95 throughout (US-PERF-01). The 25/125 TPS baseline itself is a working assumption pending CCH sign-off (R-10, Medium, `cch-crosscutting-user-stories.md`) — Phase 7 tests against it as stated, and flags the result honestly if the baseline itself is later revised, rather than treating the number as beyond question.
- **`mla_ack_latency_ms` already exists and is already correct** (Phase 6, `plan.md` §9) — a histogram observing every genuine PPA `success`, including a parked-then-recovered record's own latency. Phase 7's own job is reading it under load, not building a new clock.
- **Two MLA instances in one consumer group is explicitly named** (`plan.md` §10's own checklist, and `tools/scenario-library`'s `two-mla-instances` scenario, marked "not runnable yet" — this phase is what makes it runnable). `engineering-rules.md` §7's own concurrency rules (no in-process mutable state that outlives one record, no in-memory dedup/cache as a correctness mechanism) were built in from Phase 2 onward specifically so this phase would not need to retrofit them.
- **Chaos scenarios are already named, not Phase 7's to invent**: `broker-restart` (a `tools/scenario-library` scenario already runnable), `mla-restart` and `two-mla-instances` (both marked "not runnable yet" — Phase 7 is what makes them runnable), plus stub flapping (`ppa-stub`'s own `flaky` fault mode, already built in Phase 1).
- **Coverage and lint gates are already enforced locally** (`coverageThreshold: 96`, zero lint errors) — `plan.md` §10's own checklist item ("Coverage and lint gates enforced in CI") is about wiring the same gates into CI, not inventing a new bar.

---

## 4. What is NOT yet decided — raise these, do not guess

- **The 25/125 TPS baseline's own confirmation status (R-10, Medium)** — IDD v2.0 states it is a working assumption pending CCH sign-off, not a confirmed figure; the FSD-derived version US-PERF-01 cites is superseded. Build and run the load test against the stated numbers regardless (the same posture Phase 3 took toward D3 before it resolved, and Phase 5 took toward the timeout default) — but do not report a pass/fail against this baseline as if the baseline itself were beyond question.
- **Alerting destination/routing (R-37, High, still open with CCH)** — unrelated to Phase 7's own scope, carried forward from §2 above so it is not lost, not something Phase 7 needs to resolve or build around further.
- **PII secret rotation's trigger mechanism (gate item #2, §2 above)** — same posture, unrelated to Phase 7.

---

## 5. The Phase 7 checklist

This is [`plan.md`](../plan.md) §10. Nothing on it has started as of this document.

- [x] Full-capture regression: all five folders, the partition-2 slice, and the 500-record export, each against its golden file, in CI. *Built and locally verified [2026-09-09] — see `plan.md` §10 for the full entry; the CI job is wired but not yet observed running on a GitLab runner.* All seven captures now have a decision-level golden (only the partition-2 slice did before), driven from a checked-in registry (`tools/golden/captures.ts`) via one command with one exit code (`npm run golden:ingestion:all`, CI job `regression`). The six new goldens were cross-checked against Phase 6's live numbers before recording — `raw_export_500` reproduces 273/92/19/116 = 500 exactly — and the mechanism was proven able to **fail** (a flipped decision and a record-count divergence each produce exit 1), not merely to pass. Cold-start-safe: passes with an entirely empty environment, needing no broker, stub, certs, keys or secret.
- [x] **Run the suite in default parallel mode.** *Verified [2026-09-09] - see `plan.md` §10 for the full entry.* Six consecutive green runs in default parallel mode (24 suites, 354 tests, no flakes). One real finding, fixed: `npm test`'s `--forceExit` (inherited from Phase 0 scaffolding, not added for a real leak) was masking handle leaks; removed after proving the suite exits cleanly on its own under `timeout 300`.
- [ ] Sustained load via `--loop`, measured against 25 TPS sustained / 125 TPS peak, with ack latency against the 200 ms p95 budget — including tokenization overhead, which US-PII-01 requires be confirmed under load rather than assumed.
- [ ] Two MLA instances against 12 partitions — group rebalance, no double-processing, no gaps.
- [ ] Chaos: broker restart mid-feed; MLA `SIGKILL` mid-dispatch; stub flapping.
- [x] Coverage and lint gates enforced in CI. *Verified [2026-09-09] — see `plan.md` §10 for the full entry; the pipeline has still not been observed running on a GitLab runner.* Both gates predate this phase (Phase 0), so this was a verification: all three were proven to genuinely **reject** — the coverage gate fails the job with 354/354 tests still green (98.06% branches against a 99% threshold, exit 1), ESLint exits non-zero on one error while warnings correctly do not fail it, and `prettier --check` exits non-zero on a misformatted file. Added this phase: the `regression` job, and a 15-minute `timeout` on `test` so that — with `--forceExit` now gone — a future leaked handle fails loudly instead of hanging. Confirmed every file the `regression` job needs is committed, not just present on disk (seven fixtures including the 7.4 MB export, ten goldens, `ts-node` as a devDependency).

**Exit criterion.** Every scenario in the Phase 1 library passes, unattended, in CI, from a cold start.

---

## 6. The harness, as it stands

Unchanged in shape from Phase 6 — nothing about this phase requires new harness tooling to *drive* load or chaos; `tools/capture-feeder`'s own `--loop`/`--speed` flags and `tools/scenario-library`'s own named scenarios already cover most of §5's checklist. What is likely new: a CI pipeline stage that actually runs the full scenario library unattended (§5's own exit criterion), and whatever `two-mla-instances`/`mla-restart` need to go from "not runnable yet" to runnable.

```bash
cd cch-mla
npm run harness:up             # Redpanda up, topic-event-audit at 12 partitions (may already be running - check docker ps first)
npm run certs:generate         # local CA + server + client certs, if not already generated
npm run keys:generate -- <dfspId>   # a local RSA keypair for JWS, if not already generated (Phase 3)
npm run pii-secret:generate    # a local PII tokenization secret, if not already generated (Phase 4)
npm run ppa-stub                # in one terminal - mTLS business endpoints + plain-HTTP control/health
npm run scenario -- --list      # every named scenario this phase's checklist maps to directly
```

The two one-machine-specific notes carried forward again: the snap-packaged `docker compose` (space) plugin can fail silently in this environment — the standalone `docker-compose` (hyphen) binary at `~/.local/bin/docker-compose` is what actually starts/stops the harness. **The harness broker port is `19092`, not the default `9092`** — `.env`'s `KAFKA_BROKERS=localhost:19092` must be set explicitly.

---

## 7. The exit criterion — read this before calling anything done

From [`plan.md`](../plan.md) §10, verbatim:

> Every scenario in the Phase 1 library passes, unattended, in CI, from a cold start.

Concretely:

```
npm run harness:up
npm run ppa-stub
# every scenario tools/scenario-library/scenarios.ts names, run without a human
# watching for it to succeed, in a CI job that starts from nothing (no prior
# state, no manually-generated certs/keys/secret already sitting on disk)
```

**When this is genuinely done:**

1. Add the corresponding entry to [`plan.md`](../plan.md) §16 for this phase's own story/stories — likely US-PERF-01's own load-test clause finally confirmed (superseding this document's own "unconfirmed" framing of it), plus whatever named acceptance criteria the chaos/concurrency checklist items map to. What was built, what was proven live versus assumed, what diverged, what is left open.
2. Write `docs - MLA/EPICS/` documentation for this phase — `executive-summary.md` and `file-register.md`, per `CLAUDE.md`'s "Epic and story documentation" rule, following `PHASE-6-Observability-Operability/`'s own precedent (no `story.md`, since this phase does not map 1:1 to a single numbered story either).
3. Run the staleness sweep `CLAUDE.md`'s documentation register requires — `strategy.md` §1, `plan.md` §1's status table, and `cch-mla/README.md`'s status section all currently say Phase 7 is next; that stops being true the moment this phase's exit criterion is met. **Also check whether gate item #2 (§2 above) or R-37 has landed by then** — if either has, close out its own tracking in the same sweep rather than leaving it stranded in a now-doubly-superseded document.
4. Leave it all in the working tree for the user to commit — `CLAUDE.md`'s "Commits" rule.
5. Move to [`plan.md`](../plan.md) §11, Phase 8 — the COMESA environment.

---

## 8. What comes immediately after

- **Phase 8** (the COMESA environment, `plan.md` §11) is what every phase since Phase 1 has been building toward proving against something other than a local harness — a real DRPP topic, real DFSP signatures, a real Mojoloop Partner relationship. It has no date; COMESA has promised it, not scheduled it.
- **This phase's own load/chaos results are what turn US-PERF-01's still-unconfirmed p95 budget into a confirmed one** (or into a documented miss, which is just as valuable a result — `engineering-rules.md` §11's own "say plainly when something could not be verified" applies equally to "verified and it failed").
- **Gate item #2 (secret rotation) and R-37 (alerting routing) both run alongside this phase too, exactly as they ran alongside Phase 6** — two unrelated branches, still open, still not gating anything here.

---

## 9. Traps worth knowing before you start

- **A load test that passes once is not the same claim as a load test that passes under CI's own cold-start conditions, repeatably.** `engineering-rules.md` §11's own distinction ("verified live against X" versus "unit-tested with a mock") applies here too — a single manual `--loop` run hitting the TPS target once is a real data point, not the phase's own exit criterion, which specifically requires CI, unattended, from a cold start.
- **`--runInBand` passing is not evidence the suite is concurrency-safe** — `engineering-rules.md` §10.3 and §14 both name this explicitly as an anti-pattern, and the POC's own history (a real concurrency bug that reproduced only under parallel workers) is exactly why this phase's own checklist calls it out by name rather than assuming Jest's default is already proof enough.
- **`two-mla-instances` and `mla-restart` are marked "not runnable yet" in `tools/scenario-library/scenarios.ts` for a reason** — whatever currently blocks them (check the scenario's own `runnableNow` flag and its neighbouring code) needs to be understood before assuming they can simply be invoked. Do not mark either "done" by running something adjacent to what the scenario actually names.
- **The 25/125 TPS baseline is a working assumption, not a confirmed one (R-10)** — a load test that meets the number is real evidence the pipeline performs at the *stated* baseline; it is not evidence the baseline itself is correct. State the result against the number as given, and flag R-10's own open status alongside it, rather than letting a passing test silently upgrade the baseline's own confirmation status.
- **Ack latency's own clock and histogram already exist (Phase 6) — this phase reads them, it does not rebuild them.** If a load test's own results look wrong, check the load-generation and observation methodology first; `mla_ack_latency_ms`'s own mechanism was live-verified against real records in Phase 6 and is not itself a new suspect.

<!-- SPDX-License-Identifier: Apache-2.0 -->

# Phase 7 — Hardening and Validation: Executive Summary <!-- omit in toc -->

**Status: development complete, CI pending.** Every one of `plan.md` §10's six checklist bullets is built and live-verified, and `npm run scenario:all` runs all fifteen named scenarios unattended from a cold start and passes. The phase is **not closed**: its exit criterion also requires "in CI", and that clause is blocked on a runner constraint recorded below. This document is written now, at development-complete, rather than held until the phase closes, so the reasoning is captured by the session that did the work rather than reconstructed later.

## What this phase is, and why it carries no `story.md`

Like `EPIC-0-Scaffolding/`, `PHASE-1-Harness/` and `PHASE-6-Observability-Operability/`, this folder implements a *phase* of work rather than a story-shaped slice of `cch-mla-user-stories.md`. Phase 7 validates what Phases 2–6 built; it maps onto US-PERF-01's load-test clause and US-PII-01's "confirm tokenization overhead under load" requirement, but there is no single numbered story whose acceptance criteria it satisfies.

## The purpose

Every phase before this one proved that a mechanism *works*. None proved it holds up — under sustained or peak load, under real concurrency, or under things breaking mid-flight. Phase 6 gave every decision in the pipeline a clock, a metric and an alert; Phase 7's job was to read them at volume and under stress, and to make the whole scenario library runnable without a human.

It was also, deliberately, the phase most made of live verification. `engineering-rules.md` §11 outranks paper design everywhere, but here it is essentially the whole content: there is no way to reason your way to a p95 or a rebalance outcome.

## What was built

**Two instruments, both checked in as product rather than scratch scripts** (§11: "verification tools are checked-in code").

- **`tools/load-test/`** — `metrics-snapshot.ts` parses Prometheus text and answers the budget question; `run.ts` (`npm run loadtest`) observes a window and reports a verdict. It is **observation-only by design**: it reads Phase 6's own `mla_ack_latency_ms` rather than timing anything itself, because a second tool-side stopwatch would measure the harness instead of the service, and the two would eventually disagree with no way to say which was right.
- **`tools/scenario-library/`** — `harness.ts` (cold-start bootstrap and process lifecycle) and `run-all.ts` (`npm run scenario:all`).

**The scenario library gained the thing it never had: a definition of "passes".** Before this, `npm run scenario -- <name>` only ever *set up* a condition — produced records, or POSTed a fault mode — and returned 0 regardless of what happened downstream; the three `infra` scenarios printed prose and executed nothing. A human read logs and judged. No scenario could pass or fail in any checkable sense, which meant the exit criterion was not merely unmet but unmeetable as written. Each scenario now carries a `ScenarioExpectation`, and `mla-restart` and `two-mla-instances` moved from `runnableNow: false` to true — all fifteen are now runnable.

## The reasoning behind the decisions that were not obvious

**The p95 claim is exact, not interpolated.** The usual way to read a quantile from a Prometheus histogram, `histogram_quantile`, interpolates linearly *within* the bucket the quantile falls in — inventing precision the histogram does not carry. That is unnecessary here: `ACK_LATENCY_BUCKETS_MS` places a boundary exactly on 200, US-PERF-01's own budget, so "is p95 ≤ 200 ms" reduces to the exact counting question "are at least 95% of samples in the `le=200` bucket". The tool refuses a verdict outright when no bucket sits at or below the budget, rather than silently approximating against a coarser one.

**Expectations are floors, not exact equalities — with one deliberate exception.** Pinning exact per-reason counts would tie the suite to one capture's contents and turn any fixture refresh into a wall of false failures. The floors pin the *behaviour* each scenario exists to prove. `accountsForAll` is exact because it is the one genuinely exact property, and the most valuable single assertion available: every record fed lands in exactly one counted bucket. That is what catches a record silently ceasing to be processed — the failure class that hurt the POC twice (`environment-simulation.md` §3.3). Its denominator comes from the feeder's own `Fed N record(s)` output rather than a constant, because `--drop` makes the count depend on capture contents.

**Loss is measured against the broker, never the feeder.** For `broker-restart`, comparing the consumer group's `LOG-END-OFFSET` delta against MLA's own counters is what distinguishes "the feeder failed to produce" from "MLA lost a record". A feeder-side count cannot separate the two, and would credit MLA for records that never arrived.

**Load generation and measurement stay separate tools.** One observation window can span a 125 TPS burst followed by a 25 TPS tail without the measuring tool knowing how the feed was driven — which is what makes the step-down shape expressible at all.

## What was proven live, versus assumed

**Proven live**, against a real Redpanda broker, a real `ppa-stub` over real mTLS, on genuinely re-signed records: 25 TPS sustained for 30 minutes (10440/10440 ack samples within the 200 ms budget, consumer lag 0 at all fifteen samples); 125 TPS peak for 5 minutes (8702/8702 within budget); a 125→25 step-down with 6,000 fed and exactly 6,000 accounted for; group rebalance with the delivered envelope set identical to a single-instance baseline; broker restart, MLA `SIGKILL` mid-dispatch, and stub flapping each losing nothing; and all fifteen scenarios passing unattended from a cold start.

**Both instruments were verified able to fail, not merely to pass.** The load tool refuses a verdict below `--min-samples` and exits 1 rather than reporting a vacuous pass on three samples; an impossible floor injected into a scenario produced a named `FAIL` and exit 1, then was reverted. A suite that has only ever passed is not evidence that its assertions do anything.

**Assumed, and stated as such.** Throughput figures are local and say nothing about production infrastructure (`environment-simulation.md` §4). The 25/125 TPS baseline is itself a working assumption pending CCH sign-off (**R-10**) — meeting it is evidence the pipeline performs at the *stated* baseline, not that the baseline is right. Zero duplicates were observed across every chaos run, and this is deliberately **not** claimed as exactly-once: MLA is at-least-once by design (N1 — the offset advances only on a PPA 200), so redelivery after an ungraceful kill is *correct*; those kills simply landed outside the window between delivery and offset commit.

## What was deliberately left out

`scenario:all` is **not** wired into `.gitlab-ci.yml`. The runner cannot host a broker (below), so adding it now would contribute a second failing job and no information. The stronger cold-start claim — a throwaway container carrying none of this machine's state — is scoped to a parallel session and not yet run.

## What this exposed that outlives it

**The envelope identity key is `id` + `msgType`, not `id`.** Found by measurement, not reasoning: the 500-record export yields 116 envelopes over only **75 distinct `id`s**, because D3 makes `id` a per-`eventType` business identifier shared by a leg's request and its callback, which D4's two-value `msgType` separates. Deduplicating on `id` alone would have discarded 41 legitimate callbacks **with no error raised anywhere** — the silent-failure shape `strategy.md` §7 warns is this system's most dangerous. The design was already correct (§6.4's idempotency key is the compound `{id}:{isoMessageType}`); what was missing was the *reason*, stated where someone would find it before "simplifying" that key. It is now in `core-knowledge.md` §5.

**`.gitlab-ci.yml` has been wrong since Phase 0, and only running it revealed that.** It has specified `image: node:22-bullseye` since 2026-09-01, but the runner is a **`shell` executor**, where `image:` is inert and `services:` is unsupported; the host runs **Node < 16** against `engines: >=22.17`. Every phase since Phase 0 closed on local evidence, so nothing tested the assumption. This is the clearest possible argument for the exit criterion's "in CI" clause existing at all: five months of green local runs concealed a CI configuration that could never have worked.

**Two observation traps, both of which produced a false reading before being caught.** After an instance dies its partitions stay assigned to the dead member until the session timeout expires, and the survivor's own `/metrics` cannot see them — a per-instance lag poll reported "drained" with 153 records stranded. Poll the broker-side `rpk group describe` `TOTAL-LAG`. And `kill <npm pid>` leaves the `ts-node` child reparented and running, which silently contaminated a step-down measurement with a second feeder; feeds now run under `setsid` process groups. Both are recorded in the scenario notes.

**Process identity must be by owned port, never by name pattern.** `pgrep -f 'build/index.js' | head -1` selected a Tazama container process, not the MLA — this machine runs ~41 unrelated `build/index.js` processes. The `SIGKILL` failed only because it was in another namespace. `harness.ts` never searches for a process by name; it holds the handle to everything it starts.

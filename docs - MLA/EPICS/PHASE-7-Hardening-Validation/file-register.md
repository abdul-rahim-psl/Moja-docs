<!-- SPDX-License-Identifier: Apache-2.0 -->

# Phase 7 — Hardening and Validation: File Register <!-- omit in toc -->

Every file this phase added or changed, grouped by the checklist item (`plan.md` §10) it belongs to. Files touched by more than one item are listed once, under the item they most belong to.

## Item 2 — Run the suite in default parallel mode

| File | Why it was added / what it does |
| --- | --- |
| `package.json` | `--forceExit` removed from the `test` script. It dated to Phase 0 scaffolding (commit `491bfcd`), added before any test existed that *could* leak a handle — not in response to one. The flag masks leaked handles, the exact defect class a hardening phase exists to surface. Removed only after proving it masked nothing: the suite exits cleanly on its own, exit 0 in 16–21s under `timeout 300`, across three runs. A future leaked timer now fails loudly rather than passing silently (N10). |

## Item 3 — Sustained load, 25/125 TPS, against the 200 ms p95 budget

| File | Why it was added / what it does |
| --- | --- |
| `tools/load-test/metrics-snapshot.ts` | Parses MLA's `/metrics` and answers the budget question. Holds `meetsBudget`, which makes the p95 claim **exact rather than interpolated**: `ACK_LATENCY_BUCKETS_MS` has a boundary on exactly 200 ms, so "is p95 ≤ 200" reduces to counting the `le=200` bucket, with no `histogram_quantile` estimation. Refuses a verdict when no bucket sits at or below the budget rather than approximating against a coarser one. `sumFamily`/`sumByLabel` are exported so the scenario runner asserts against the *same* parser rather than a second, divergent one. |
| `tools/load-test/run.ts` | The observation loop (`npm run loadtest`). Samples `/metrics` across a window and reports achieved throughput, ack-latency verdict, peak/final consumer lag and delivery failures, writing a JSON report and exiting 0/1. **Deliberately measures only — it never generates load**, so one window can span a peak burst followed by a sustained tail without knowing how the feed was driven. Refuses a verdict below `--min-samples` rather than reporting a vacuous pass. |
| `__tests__/load-test-metrics.test.ts` | 13 tests pinning the budget logic — the boundary at exactly 95%, a genuinely breaching distribution, the refusal to approximate, the empty-histogram divide-by-zero guard, and the label/`+Inf` parsing. These are the **failure** cases a real broker cannot be made to produce on demand; without them a green load run would prove nothing about the instrument. `tools/` sits outside `collectCoverageFrom`, so they add correctness, not coverage percentage. |
| `tools/capture-feeder/resign.ts` | Adds `isResignable` — a predicate asked *before* calling `resignPayload`, never by catching what it throws (§6.2). `--resign` was built in Phase 3 for naming two or three indices by hand, where an unsignable record is a typo worth aborting on; a full-capture re-sign (`--resign 0-499`) hits 214 records that genuinely cannot be signed (148 with no body, every one an `egress` record; 66 with no `fspiop-source`), none of which ever reaches JWS verification. |
| `tools/capture-feeder/apply-scenarios.ts` | Applies `isResignable` and returns a `resignSkipped` count alongside the items, so a skipped re-sign is **reported rather than silently absorbed** (N10) — a re-sign that quietly did nothing would leave an operator believing a record was verifiable when it was not. Counted per source record, so a `--duplicate`d record is not double-counted. |
| `tools/capture-feeder/index.ts` | Prints the `--resign` skip count and the reason those records are safely skippable. |
| `tools/scenario-library/run.ts` | Updated for `applyScenarios`'s new return shape. |

## Items 4 & 5 — Two MLA instances; chaos (broker restart, MLA SIGKILL, stub flapping)

| File | Why it was added / what it does |
| --- | --- |
| `tools/scenario-library/scenarios.ts` | `mla-restart` and `two-mla-instances` move to `runnableNow: true` — **the flags were stale, not tracking a real dependency**: the blocker each named ("needs the real MLA consumer group") was satisfied when Phase 2 closed. `broker-restart`'s deferred clause ("full proof needs the real consumer") is discharged. Each note now records the verified procedure and the traps that produced a false reading first: identity is `id` + `msgType` (not `id`); poll broker-side `TOTAL-LAG`, not per-instance `/metrics`, after killing an instance; identify the MLA by owned port, never `pgrep -f 'build/index.js'` (~41 unrelated Tazama processes match it). |

## The exit criterion — every scenario passes, unattended, from a cold start

| File | Why it was added / what it does |
| --- | --- |
| `tools/scenario-library/harness.ts` | Cold-start control. Generates the mTLS certs, all 19 DFSP keypairs and the PII secret when absent, brings up Redpanda, creates the 12-partition topic, and starts/stops `ppa-stub` and MLA — none of which a fresh checkout has, and each of which is a way the suite could pass locally and fail elsewhere. Every endpoint is **env-derived** (`KAFKA_BROKERS`, `PPA_STUB_CONTROL_URL`, `PORT`), never hardcoded to localhost, so the same command runs unchanged against a differently-shaped environment. `waitQuiescent` requires **three consecutive** zero lag readings, because a single `lag=0` can be read in the gap before the consumer notices a feed — the false "drained" that produced a wrong result during item #4. Processes are killed by **held handle**, never a name lookup. |
| `tools/scenario-library/run-all.ts` | The orchestrator (`npm run scenario:all`): cold-starts, runs all fifteen scenarios with real assertions, tears down, and exits 0/1 with a per-scenario PASS/FAIL table. **Every scenario runs before anything exits** — bailing on the first failure would hide the state of the other fourteen. The three `infra` scenarios get bespoke assertions (broker-restart measures loss against the broker's own end-offset; the other two compare delivered envelope sets on the `id` + `msgType` key). Its header states plainly what a pass here does **not** claim: "unattended, from a cold start" on the machine it ran on, never "in CI". |
| `tools/scenario-library/scenarios.ts` | Gains `ScenarioExpectation` — the pass condition as data, which the library previously had no notion of at all. Floors rather than exact equalities, so a fixture refresh does not produce a wall of false failures; `accountsForAll` is the one exact assertion, because "every record fed lands in exactly one counted bucket" is what catches a record silently ceasing to be processed. Its denominator comes from the feeder's own `Fed N record(s)` output, not a constant. |
| `package.json` | Registers `loadtest` and `scenario:all`. |

## Documentation

| File | Why it was added / what it does |
| --- | --- |
| `docs - MLA/knowledge-base-stories/core-knowledge.md` | §5 gains an explicit statement that **`id` does not identify an envelope on its own — `id` + `msgType` does**, with why `correlationId` cannot substitute (minted per processing attempt) and why §6.4's idempotency key is compound. The design was already correct; the *reason* was undocumented, and the naive simplification would discard 41 of 116 legitimate callbacks with no error raised. |
| `docs - MLA/plan.md` | §10's six bullets annotated with what was actually run; the exit criterion carries a per-clause status; §16 gains the Phase 7 progress-log entry. |
| `docs - MLA/continue/continue - before phase 7.md` | Checklist, §1 orientation, §5 preamble and §7 exit criterion all updated — §5 previously still read "Nothing on it has started as of this document" while the checklist below it showed six completed items. |
| `docs - MLA/EPICS/PHASE-7-Hardening-Validation/` | This folder — `executive-summary.md` (the why, and what the phase exposed that outlives it) and `file-register.md` (this file). |

## Not changed, deliberately

| File | Why not |
| --- | --- |
| `.gitlab-ci.yml` | Owned by the parallel session working items #1/#6. `scenario:all` is **not** wired in: the runner is a `shell` executor with no `services:` support and cannot host a broker, so adding the job now would contribute a second failing job and no information. |

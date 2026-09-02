# EPIC-0 — Scaffolding: Executive Summary

**Phase:** 0 (`docs/plan.md` §3.3)
**Status:** complete — exit criterion met live, recorded in `docs/plan.md` §16
**Date:** 2026-09-01

---

## What this epic is, and why it is numbered 0

Every other epic in this folder implements a user story. This one implements none. It exists because the first line of `US-MLA-01` cannot be written honestly until there is a project to write it into — one that compiles, lints, tests, starts, reports its own health, and shuts down without losing work.

Phase 0 precedes even Phase 1's test harness, and both precede the first story. That ordering is deliberate: the standing rule of this project is that *a design is a hypothesis until it has been run*, and running anything requires something runnable to exist first.

There is no `story.md` here because there is no story. What follows takes its place.

## The purpose

**To convert a complete paper design into a running skeleton whose quality gates are mechanical rather than remembered.**

Three concrete aims, each of which is cheap now and expensive later:

1. **Make the standards enforceable before there is code to exempt.** A coverage floor and a lint gate introduced after a codebase exists are negotiated against every module that fails them. Introduced against an empty codebase, they are simply the shape of the project. This is why both gates were wired in this phase rather than a later one.
2. **Fix the architecture's direction of dependency while it costs nothing.** The four-layer structure is trivial to establish across ten files and painful to retrofit across a hundred. Establishing it now means every subsequent story is written into a structure that already answers where its code goes.
3. **Give every later phase somewhere to stand.** Phase 1's harness needs a service to feed. Phase 2's ingestion needs a consumer lifecycle to attach to. Phase 4's tokenization needs a readiness signal to fail. Each of those was left a defined, tested seam rather than an open question.

## What was built

A TypeScript + Fastify service at the repository root, following the Tazama `tms-service` / `event-director` conventions the project is committed to, with its tooling carried forward from the live-verified predecessor at `poc-mla-ppa/mla/` rather than reinvented.

The four layers, with every dependency pointing inward and every client constructed once at the composition root:

- **`interfaces/`** — the contracts: configuration, health, the Kafka port, the logging port. Types and constants only, no behaviour.
- **`services/`** — the logic, as pure functions: configuration resolved and validated from the environment, and health reporting derived from instance-local state.
- **`clients/`** — the I/O adapters: the sole `pino` importer, a Kafka connection client, and the Fastify server exposing the two health endpoints.
- **`index.ts`** — the composition root: reads configuration, builds the clients, injects them, starts, and shuts down on a signal.

`docs/EPICS/EPIC-0-Scaffolding/file-register.md` lists every file and the reason it exists.

## The reasoning behind the decisions that were not obvious

**Configuration fails at boot, not at first use — and Kafka settings are required only when the consumer is enabled.** A service that starts happily and then discovers at its first message that it has no group id has converted a configuration error into a runtime incident. Requiring the Kafka values conditionally is what makes this real: defaulting a broker list is harmless while nothing connects, and dangerous the moment something does. The consumer group id in particular is the one setting in this system capable of affecting live payments if wrong (R-18) — a guessed default for it is not a convenience.

**Readiness reports instance-local state only, and never probes the PPA.** A downstream dependency that gates readiness turns one dependency's outage into every replica being pulled from rotation simultaneously. PPA being unavailable is back-pressure, and back-pressure is handled by retry and a circuit breaker in Phase 5 — not by an instance declaring itself unfit.

**`KAFKA_ENABLED=false` is the default.** The service must be startable, probeable and testable by someone who has no broker, which includes every CI runner and every new engineer on their first afternoon. A consumer deliberately switched off reports `DISABLED` and stays ready; a consumer switched *on* but disconnected reports `DOWN` and returns 503. The distinction is the point.

**The coverage gate sits at 96, not 95.** The stated standard is *above* 95%, so the gate is one point higher and exactly 95.0% fails. It lives in the Jest config rather than only in CI so that the suite fails on a developer's machine at the same bar the pipeline enforces.

**A Kafka client exists here at all** only because readiness has to report consumer state. It connects, disconnects and reports whether it is connected. It cannot subscribe, consume or commit — that is `US-MLA-01`, where the offset contract those operations protect is introduced alongside them rather than ahead of them.

## What was proven, and how

Everything claimed here was run, not reasoned about. The full transcript is in `docs/plan.md` §16; in summary: a clean install, a zero-error build, a lint pass with zero errors *and* zero warnings, and 43 tests across 5 suites at 100% coverage in default parallel mode. The service was started with no configuration file and no broker and answered both probes; it was sent `SIGTERM`, logged its shutdown, exited 0 and released its port with no forced kill. It was started again against an unreachable broker and correctly reported live-but-not-ready. It was started twice more with a missing required variable and with a malformed one, and refused to start both times, naming the variable.

## The defect this phase found in its own gate

The Jest configuration inherited from the predecessor reports coverage only for files a test actually imported. A source file with **no** tests at all was therefore invisible to the threshold rather than failing it — the gate would have reported green in precisely the situation it exists to catch.

Adding `collectCoverageFrom: ['src/**/*.ts']` makes every source file count whether or not a test loads it. The fix was then verified the only way a gate can honestly be verified: by removing a test suite and confirming the run fails. It does — coverage falls to 54.82% and the process exits 1.

This is worth recording beyond its own fix. The gate was not broken by carelessness; it was inherited from a project where it had never mattered, because that project set no threshold. **A quality mechanism nobody has watched fail is a hypothesis, exactly like any other design.**

## What is deliberately not here

No pipeline logic of any kind — no canonical-record selection, no classification, no envelope construction. No test harness; that is Phase 1, and it is built before the pipeline on purpose. No PII tokenization, no JWS verification, no mTLS.

Two decisions remain open and were not resolved by this work, because neither is this team's alone to settle: **D3**, the envelope `id` scheme, which changes PPA's correlation keys; and **D5**, which record is the final-state trigger, which determines the status vocabulary the downstream translation must cover. Neither blocks scaffolding. Both block the story work that follows.

## Where this leaves the project

The next work is Phase 1 — `capture-feeder` and `ppa-stub` against a local Redpanda (`docs/plan.md` §4, designed in full in `docs/environment-simulation.md`). The first user story, `US-MLA-01`, follows that.

One item from this phase carries forward unverified: the GitLab CI pipeline is written but has never executed on a runner. Its first push is its first real test.

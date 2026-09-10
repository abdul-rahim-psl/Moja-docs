<!-- SPDX-License-Identifier: Apache-2.0 -->

# Continue — Before Phase 8 <!-- omit in toc -->

**What this document is.** A session handoff, written at the point where Phase 7's engineering is complete and live-verified in full — load, concurrency and chaos all proven against a real broker, and all fifteen named scenarios passing unattended from a cold start. Read this in full before touching anything; it is short by design.

**Read this part before anything else: Phase 7 is not closed, and Phase 8 cannot start.** Unlike every previous `continue -` document, this one does not hand you a phase you can begin. Two things are true at once:

- **Phase 7's exit criterion has one clause outstanding — "in CI"** — blocked on a GitLab runner constraint that is infrastructure's to resolve, not engineering's (§2 below). That is the *immediate* work, and it is small.
- **Phase 8 is blocked in its entirety and stays blocked** until COMESA provisions an environment. It has no date. `plan.md` §11's own opening sentence is "Everything here is **blocked** and stays blocked."

So this document scopes Phase 8 so the work is ready the day the environment arrives, and it tracks the three open external items in the meantime. It does not pretend there is a phase to pick up today.

**What this document is not.** It is not the record of Phase 7's own work — that is `plan.md` §16's Phase 7 entry and [`docs - MLA/EPICS/PHASE-7-Hardening-Validation/`](../EPICS/PHASE-7-Hardening-Validation/), both already written and current.

**When this is superseded.** When the COMESA environment arrives and Phase 8 genuinely begins, or when a later phase's own `continue -` document takes over.

- [1. Sixty-second orientation](#1-sixty-second-orientation)
- [2. The immediate work — closing Phase 7's CI clause](#2-the-immediate-work--closing-phase-7s-ci-clause)
- [3. The three external items, all still open](#3-the-three-external-items-all-still-open)
- [4. What is already decided — do not re-litigate](#4-what-is-already-decided--do-not-re-litigate)
- [5. The Phase 8 checklist](#5-the-phase-8-checklist)
- [6. The harness, as it stands](#6-the-harness-as-it-stands)
- [7. The exit criterion — and why Phase 8 has no local one](#7-the-exit-criterion--and-why-phase-8-has-no-local-one)
- [8. Traps worth knowing before you start](#8-traps-worth-knowing-before-you-start)

---

## 1. Sixty-second orientation

Phases 0–6 are built, live-verified and closed. **Phase 7 is development-complete and live-verified but not formally closed** — `plan.md` §16's Phase 7 entry and [`EPICS/PHASE-7-Hardening-Validation/`](../EPICS/PHASE-7-Hardening-Validation/) for the full writeup.

What exists now, on top of Phases 0–6's ingestion, envelope construction, JWS validation, PII tokenization, delivery/resilience and observability: **the whole pipeline has been exercised at volume and under stress, and every claim is live-proven.** 25 TPS sustained for thirty minutes and 125 TPS peak for five, with every ack-latency sample inside the 200 ms p95 budget and consumer lag never leaving zero; a 125→25 TPS step-down with 6,000 records fed and exactly 6,000 accounted for; two MLA instances rebalancing across twelve partitions and delivering exactly the single-instance baseline set, no double-processing and no gaps; and chaos — broker restart mid-feed, an MLA `SIGKILL` mid-dispatch, a flapping downstream — each losing nothing. `npm run scenario:all` runs **all fifteen named scenarios unattended from a cold start** and passes, generating its own certs, keys, secret, broker and topic.

**Every stage of MLA's pipeline now has a live-verified answer for every record it sees, at production-baseline load, under real concurrency, and through real failures — and the whole scenario library runs without a human.** Nothing here is claimed as more than what was actually run: all of it on one laptop, against a local Redpanda and a local `ppa-stub`, on records re-signed with locally generated keys.

**What Phase 8 is, and why nothing local can substitute for it.** Every empirical claim this project holds comes from captures taken 11–13 August 2026 in one environment, and every cryptographic claim rests on signatures we generated ourselves. Phase 8 is where that stops being true: a real DRPP topic, real DFSP signatures, a real Mojaloop Partner relationship, a real PPA. `environment-simulation.md` §4 lists exactly what the harness *cannot* prove, and that list is Phase 8's agenda.

Read in this order:

1. [`cch-mla/CLAUDE.md`](../../../cch-mla/CLAUDE.md) — if this is a new session.
2. **§2 below** — the one piece of work that can actually be done now.
3. [`../strategy.md`](../strategy.md) — the map. Follow its routing table; do not read the whole knowledge base.
4. [`../plan.md`](../plan.md) §11 (the Phase 8 checklist), §13 (blocked work) and §14 (the open questions for COMESA).
5. [`../environment-simulation.md`](../environment-simulation.md) §4 — what the harness cannot prove. This is the shortest statement of why Phase 8 exists.

---

## 2. The immediate work — closing Phase 7's CI clause

**This is the only engineering work available today, and it is not blocked on COMESA.**

Phase 7's exit criterion is *"every scenario in the Phase 1 library passes, unattended, in CI, from a cold start."* Three of those four clauses are met and live-verified. The fourth is not, for a reason established empirically rather than guessed:

The branch was pushed [2026-09-09] and GitLab created **the project's first-ever pipeline (#44134)**. It ran, and `build` failed in about seven seconds. Two facts came out of the job log, both pre-existing and neither caused by Phase 7:

1. **The runner is a `shell` executor**, not Docker (`Using Shell (bash) executor...`, runner `GitlabRunner-shell`). `image: node:22-bullseye` is therefore **inert** — a shell executor runs on the host with whatever is installed there — and **`services:` is unsupported**, so a Redpanda service container is not available and the broker-dependent scenarios cannot run in CI as things stand.
2. **The runner host runs Node < 16.** `npm ci` failed with `npm ERR! Cannot read property 'ajv' of undefined`; the singular *"property"* phrasing predates Node 16, where V8 changed the message. Against `engines: >=22.17` and a `lockfileVersion: 3` lock file that npm 6 cannot parse, it died two seconds in.

**The repository is not at fault**, and this was checked rather than assumed: `tsc --project tsconfig.json` exits 0, the build's `include` is `./src/**/*` only, the lock file is present and consistent, and the public npm registry is reachable.

**Resolution is infrastructure's, in this order of preference:**

- **(b) Register a Docker-executor runner.** `.gitlab-ci.yml` has assumed one since Phase 0, and it is the only route that puts the broker-dependent scenarios into CI properly.
- **(a) Install Node ≥ 22.17 on the existing shell host** (or `nvm`/`asdf` selected in `before_script`). Smallest change; should turn `build`, `lint`, `test` and `regression` green immediately — still no broker.
- **(c) Stay on shell and drive Docker directly from the job**, viable only if that host has Docker and the `gitlab-runner` user can reach the socket.

**`scenario:all` is deliberately not wired into `.gitlab-ci.yml`** until this is settled; adding it now would contribute a second failing job and no information.

**The honest framing to preserve:** do not close Phase 7 on the strength of a local `scenario:all` pass, and do not soften the criterion to match what is reachable. If the runner cannot ever host a broker, the correct outcome is the criterion met **with a stated exception** naming which scenarios are CI-excluded and why — not a quietly redefined criterion. That `.gitlab-ci.yml` was wrong for five months and only running it revealed that is the whole argument for the clause existing.

---

## 3. The three external items, all still open

All three were forwarded to Behjet (the BA who routes to COMESA/CCH) on 2026-09-08. **CCH is the COMESA Clearing House — the same party, not two.** None gates any work that can be done today.

| Item | What is open | Why it matters |
| --- | --- | --- |
| **Gate item #2** — PII secret rotation trigger (`plan.md` §7.1 #2) | COMESA confirmed versioned keys over drain-first, but "a failure route which looks for and applies new keys" names a trigger with no counterpart in MLA: the tokenizer only ever *writes* tokens, never checks one, so there is no verification-failure signal to hang it on. Ask back precisely; do not guess a trigger and build against the guess. | **The last thing keeping Phase 4 formally open.** |
| **R-10** — the 25/125 TPS baseline | IDD v2.0 states it as a working assumption pending CCH sign-off. Phase 7 tested against the stated figures and met them with roughly 100× latency headroom, but **a passing test does not upgrade the baseline's own confirmation status**. | Phase 8's production-representative load test is measured against whatever this settles at. |
| **R-37** — alerting destination/routing | The mechanism is built and live-verified against a configurable sink (metrics-based, always on, plus an optional webhook). Only the real destination is CCH's to name. | Phase 8 wires the real destination. |

**A separate, unrelated meeting on 2026-09-09** (`docs/meetings/9-sept.md`) resolved four of the five `plan.md` §14 open-question items sent to COMESA/the Mojaloop Foundation earlier — DFSP keys (progressed, not yet delivered), the canonical-record table's stability (fully confirmed as by-design), the rejected-fulfil/rejected-FX-transfer samples (confirmed absent, samples pending from Sam), and the FX-quote-ordering question (fully resolved — the observed pattern is the only one DRPP's design can produce). Full detail in `plan.md` §13.1 and §14, not repeated here since none of it touches the three items above or Phase 7/8's own status.

---

## 4. What is already decided — do not re-litigate

Everything Phases 0–7 settled stays settled. Worth restating only what Phase 8 will most directly touch:

- **D1–D7 are all settled** (`plan.md` §3.1), including D3 (per-`eventType` envelope `id`, agreed with PPA's owners) and D5 (`commitTransfer`/`egress` as the final-state trigger, ISO `TxSts` vocabulary). Phase 8 re-verifies them against live traffic; it does not reopen them.
- **The envelope identity key is `id` + `msgType`, not `id`** (`core-knowledge.md` §5). Established by measurement in Phase 7: the 500-record export yields 116 envelopes over only 75 distinct `id`s. Anything in Phase 8 that deduplicates, correlates or reconciles envelopes uses the compound key — deduplicating on `id` alone silently discards a legitimate callback per leg, with no error raised anywhere.
- **The canonical-record table holds with zero exceptions across the 500-record `raw_export_500.json` export** — the sole capture window we have; the 141-record `DRPP_Kafka_E2E_Pack` set is a confirmed subset of it, not independent corroboration (`plan.md` §14 Q2). CCH and the Mojaloop Foundation confirmed at the 2026-09-09 meeting (`docs/meetings/9-sept.md`) that the underlying `start`/`egress` asymmetry is by design across all environments — that is exactly why re-verifying it against live traffic is still a Phase 8 checklist item, now to confirm a stated design fact rather than to test an unconfirmed capture artefact.
- **MLA is at-least-once by design** (N1 — the offset advances only on a PPA 200). Phase 7 observed zero duplicates across every chaos run, and deliberately did **not** claim exactly-once. Do not let a Phase 8 observation of a duplicate be read as a regression: redelivery after an ungraceful failure is *correct*.
- **The scenario library is the regression suite**, and all fifteen scenarios are runnable (`npm run scenario:all`). Phase 8 adds environment-specific verification; it does not replace this.

---

## 5. The Phase 8 checklist

This is [`plan.md`](../plan.md) §11, verbatim in scope. **Everything on it is blocked and stays blocked** until the environment exists.

- [ ] Confirm the topic name, partition count and retention in the target environment. `topic-event-audit` and 7-day retention are both inherited assumptions — the captures evidence neither.
- [ ] Confirm `operation`, `Content-Type` and `FSPIOP-HTTP-Method` survive identically in CCH's production feed (FSD Open Item #7 for *their* environment, regardless of what our captures show).
- [ ] **Re-verify the canonical-record table against live traffic.** It holds with zero exceptions across every capture we have, but that is one capture window, not a Mojaloop guarantee.
- [ ] Obtain a dedicated consumer group ID from CCH.
- [ ] Verify a genuine DFSP signature with real keys.
- [ ] Real mTLS against the real PPA; the deployment's certificate provisioning.
- [ ] End-to-end against the real PPA, including the durable-ack semantics the stub cannot evidence.
- [ ] Load test on production-representative infrastructure.
- [ ] Kubernetes manifests, APM, the real metrics backend, alert destinations.

**Re-verification is not optional.** Every empirical claim in `plan.md` comes from captures taken 11–13 August 2026 in one environment. Treat them as strong evidence, never as a contract.

---

## 6. The harness, as it stands

Unchanged in shape, and now fully self-starting. The whole library runs in one command:

```bash
cd cch-mla
npm run scenario:all        # cold-starts everything, runs all 15 scenarios, exits 0/1
```

That generates the mTLS certs, all nineteen DFSP keypairs and the PII secret if absent, brings up Redpanda and the 12-partition topic, compiles, starts `ppa-stub` and MLA, asserts, and tears down. The individual tools remain available for focused work:

```bash
npm run harness:up          # Redpanda, topic-event-audit at 12 partitions
npm run ppa-stub            # mTLS business endpoints + plain-HTTP control/health
npm run feeder -- --file <capture> --resign 0-499 --tps 25 [--loop]
npm run loadtest -- --duration 1800 --label sustained-25tps
npm run scenario -- --list  # every named scenario
npm run golden:ingestion:all
```

Three machine-specific notes carried forward, each of which cost real time to find:

- The snap-packaged `docker compose` (space) plugin can fail silently here — the standalone `docker-compose` (hyphen) at `~/.local/bin/docker-compose` is what actually works. `harness.ts` already prefers it.
- **The broker port is `19092`, not the default `9092`** — `.env`'s `KAFKA_BROKERS=localhost:19092` must be set.
- **This machine runs ~41 unrelated `build/index.js` processes** from the local Tazama stack. Identify the MLA by the port it owns (`ss -lptnH 'sport = :3001'`) or by `/proc/<pid>/cwd`, **never** by `pgrep -f 'build/index.js'` — that selects a Tazama container process, and a `SIGKILL` against it failed only because it was in another namespace.

---

## 7. The exit criterion — and why Phase 8 has no local one

`plan.md` §11 states no single exit criterion, and that is deliberate rather than an omission: Phase 8's completion is defined by the environment, not by us. The nearest thing to a criterion is that **every empirical claim this project currently rests on has been re-verified against live traffic, and every "unverified pending real keys / a real PPA / production infrastructure" caveat in `plan.md` §16 has been discharged or restated as a confirmed fact.**

**When Phase 8 work genuinely closes**, follow the same routine every phase has:

1. Add the `plan.md` §16 entry — what was built, what was proven live *versus* assumed, what diverged, what is left open. `Verified` is the field nobody may soften.
2. Write the `EPICS/` documents for it — `executive-summary.md` and `file-register.md`, per `CLAUDE.md`.
3. Run the staleness sweep — `strategy.md` §1, `plan.md` §1's status table, and `cch-mla/README.md`'s status section. All three now say Phase 7 is development-complete and Phase 8 is blocked; that stops being true the moment the environment arrives.
4. **Check whether gate item #2, R-10 or R-37 has landed by then**, and close out each in the same sweep rather than leaving it stranded.
5. Leave it in the working tree for the user to commit — `CLAUDE.md`'s "Commits" rule. Claude never commits and never pushes.

---

## 8. Traps worth knowing before you start

- **Phase 8 is not "the last 10%".** Everything before it was verified against data we controlled and signatures we generated. The first genuine DFSP signature, the first real PPA `200`, and the first production-representative load test are each capable of invalidating something currently recorded as settled. Budget for findings, not for a formality.
- **A passing Phase 7 load test is not a production performance claim.** `environment-simulation.md` §4 says it plainly: throughput numbers are local. 25/125 TPS was met on one laptop against a local broker and a stub that does nothing but validate and record. The real PPA does durable write-ahead persistence before acknowledging, which the stub explicitly cannot evidence.
- **R-10 means the baseline itself is unconfirmed.** Report Phase 8's load results against the number *as given*, and flag R-10's status alongside, rather than letting a passing test silently promote a working assumption to a requirement.
- **Do not let "in CI" quietly disappear.** It is Phase 7's, not Phase 8's, and it is one infrastructure change away. The temptation once Phase 8 starts will be to treat a five-month-old unrun pipeline as acceptable. It was wrong from the day it was written, and only running it revealed that.
- **`core-knowledge.md` §5's identity rule is load-bearing for anything that reconciles envelopes.** `id` + `msgType`. Not `id`. Not `correlationId` — that is minted per processing *attempt*, so a genuinely duplicated record produces two distinct values and is invisible to it.
- **The consumer group ID is still the one misconfiguration capable of affecting live payments** (R-18). A reused DRPP-internal group name can steal partition assignments from a live payment-path handler. It must be a dedicated group, obtained from CCH — checklist item four above, and not a detail to leave to deployment day.

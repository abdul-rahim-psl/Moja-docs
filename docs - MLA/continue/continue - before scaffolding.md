<!-- SPDX-License-Identifier: Apache-2.0 -->

# Continue — Before Scaffolding <!-- omit in toc -->

**What this document is.** A session handoff, kept as the historical record of the point where design and planning were complete and Phase 0's scaffolding checklist ([`plan.md`](../plan.md) §3.3) was the next work.

**This document is superseded.** Scaffolding's exit criterion was met and the first [`plan.md`](../plan.md) §16 progress-log entry landed on 2026-09-01 — see that entry, and [`docs - MLA/EPICS/EPIC-0-Scaffolding/`](../EPICS/EPIC-0-Scaffolding/), for what actually happened. Per `strategy.md` §4's precedence rule, **`plan.md` is the ground truth on status; this file is not.** Its "what's next" job is done. **No newer `continue -` doc has been written yet** — the next one (covering Phase 1, the harness) is owed at the start of the session that picks that up. Until it exists, read this document only to trace history, and go to [`plan.md`](../plan.md) §4 for what Phase 1 actually requires.

- [1. Sixty-second orientation](#1-sixty-second-orientation)
- [2. What is already decided — do not re-litigate](#2-what-is-already-decided--do-not-re-litigate)
- [3. What is NOT yet decided — do not scaffold around a guess](#3-what-is-not-yet-decided--do-not-scaffold-around-a-guess)
- [4. The scaffolding checklist](#4-the-scaffolding-checklist)
- [5. Concrete values to carry over from the POC](#5-concrete-values-to-carry-over-from-the-poc)
- [6. The exit criterion — read this before calling anything done](#6-the-exit-criterion--read-this-before-calling-anything-done)
- [7. What comes immediately after](#7-what-comes-immediately-after)
- [8. Traps worth knowing before you start](#8-traps-worth-knowing-before-you-start)

---

## 1. Sixty-second orientation

This repository builds the **Mojaloop Adaptor (MLA)** and its PII tokenization step for CCH FRMS — production code, not a POC. Requirements, engineering policy, a full comparison against an earlier live-verified proof of concept, and a phased build plan are all written and internally consistent. **`cch-mla/CLAUDE.md` at the repository root is the working contract for any session here — read it before this document if you haven't.**

Read in this order:

1. [`cch-mla/CLAUDE.md`](../../../cch-mla/CLAUDE.md) — the working rules, "How a story gets built", the indexing rule.
2. [`../strategy.md`](../strategy.md) — the map. Do not read the whole knowledge base; follow its routing table.
3. **This document** — where things stand right now, specifically.
4. [`../plan.md`](../plan.md) §3.3 — the actual scaffolding checklist, which this document walks through but does not replace.

**Current state:** zero lines of application code. `docs - MLA/` holds the complete knowledge base (strategy, core-knowledge, engineering-rules, cross-reference, environment-simulation, plan, the four source user-story documents, and `docs - MLA/EPICS/` with all nine MLA/PII stories broken out one folder per epic). Everything in `docs - MLA/` was cross-checked for internal alignment in the immediately preceding session; nine misalignments were found and fixed, and the coverage bar was explicitly settled at **above 95%** (`coverageThreshold: 96`).

---

## 2. What is already decided — do not re-litigate

Seven forks between the story documents and the earlier POC are recorded in [`../knowledge-base-stories/cross-reference.md`](../knowledge-base-stories/cross-reference.md) §1 and restated with a recommendation in [`../plan.md`](../plan.md) §3.1. **Six are settled** — build against these, do not reopen them:

| # | Decision | What we build |
| --- | --- | --- |
| **D1** | Canonical-record selection | The POC's **per-operation table**, plus a payload shape-check for `prepareTransfer` (distinguishes a real transfer rejection from its harmless duplicate `egress`). **Not** US-MLA-01's blanket "ingest only `start`" — that rule silently drops every transfer rejection and three `egress`-only operations. |
| **D2** | Classification signal | **`operation` alone**, corroborated by (not derived from) HTTP method/resource and signature presence. |
| **D4** | `msgType` cardinality | **Two values** (`request`/`callback`), **no** `/TRANSFERS/NOTIFICATIONS` fifth route. |
| **D5** | Final-state trigger | **`commitTransfer`** (`egress`), ISO `TxSts` vocabulary (`COMM`/`RESV`) authoritative — matches the POC. |
| **D6** | Payload selection | **Select the FSPIOP form** (`content.transformedPayload` / `content.payload`). Treat base64 `dataUri` decoding as available-on-demand, not mandatory — decoding it yields *Mojaloop's* ISO 20022, not the FSPIOP shapes the field tables map from. |
| **D7** | Envelope `error` field | **Add it** — `error?: { code, description }`, populated only when a rejection shape is detected. Without it PPA has no defined way to recognise a rejection. |

None of these decisions block scaffolding — they matter from Phase 2 onward. They're listed here so scaffolding doesn't accidentally bake in the wrong assumption (e.g. a fifth Fastify route stubbed for D4's rejected model).

---

## 3. What is NOT yet decided — do not scaffold around a guess

One fork is **genuinely open** and needs input from outside this codebase — [`plan.md`](../plan.md) §13.1 tracks it as gating work now, not production:

- **D3 — the envelope `id` scheme.** Per-`eventType` (the stories' model, and the one new tag-availability evidence in `plan.md` §3.2 now favours — every canonical record carries its own stage-local id directly, so no chaining is needed) versus the POC's single leg-wide anchor. **This is a cross-team decision** — it changes what PPA's correlation keys look like, and PPA is a different component. Do not build `buildEnvelope` until this is settled.

**It does not block scaffolding.** It blocks Epic 1/2 story work — `US-MLA-02` needs it resolved to shape `id` extraction correctly. If a session reaches story work with it still open, raise it — do not guess and proceed.

(D5 — which record is the final-state `pacs.002` trigger — is **settled**: `commitTransfer` [`egress`], ISO `TxSts` vocabulary. See §2 above and `plan.md` §3.1.)

---

## 4. The scaffolding checklist ✅ done — [`plan.md`](../plan.md) §16, Phase 0 entry, 2026-09-01

This is [`plan.md`](../plan.md) §3.3, walked through with the reasoning inline. Work through it in order; each item cites the rule it exists to satisfy.

**Every item below is built and live-verified.** The checkmarks here are a mirror of [`plan.md`](../plan.md) §3.3, not a second source of truth — if the two ever disagree, `plan.md` is correct (`strategy.md` §4's precedence rule) and this file is stale and needs fixing, not the other way round. Full detail on what was built, what was tested, and what was verified live: [`plan.md`](../plan.md) §16's Phase 0 entry, and the epic-level writeup at [`docs - MLA/EPICS/EPIC-0-Scaffolding/`](../EPICS/EPIC-0-Scaffolding/).

- [x] **TypeScript + Fastify project**, following Tazama's `tms-service` / `event-director` conventions — layout, npm script names, `tsconfig`, ESLint flat config, Prettier, SPDX headers, `.env.template`, `Dockerfile`. §5 below has the exact values to carry over from the POC rather than reinvent.
- [x] **Typed configuration, validated at boot.** A missing required variable fails the process at startup, never at first use. `engineering-rules.md` §8: "Fail fast on invalid config."
- [x] **`LoggerService`-shaped wrapper over `pino`**, so `@tazama-lf/frms-coe-lib` can be swapped in later as a one-file change. Do not import `pino` directly anywhere outside this wrapper.
- [x] **`/health/live` and `/health/ready`.** Readiness is **instance-local only** — Kafka connection status now, and (from Phase 4) tokenization-secret load status later. **Never probes PPA** — `engineering-rules.md` §8: a shared downstream dependency must never gate readiness, or one PPA blip pulls every healthy MLA replica out of rotation.
- [x] **Jest wired with `coverageThreshold: 96`** on branches, functions, lines and statements — in the Jest config itself, not just documented as a target, so the suite fails locally at the same bar CI enforces. Confirmed: **the bar is above 95%, so exactly 95.0% must fail.**
- [x] **Lint gate at zero errors.** Both coverage and lint gates wired into CI **in this phase**, before there is any code to be tempted to exempt. **CI platform: GitLab CI** (`.gitlab-ci.yml` at the repo root) — matches this repository's actual remote (`open-frms/cch-frms/cch-mla`, self-hosted GitLab). This was undocumented anywhere in the knowledge base until settled in this session; the POC has no CI config to carry forward, so there was nothing to inherit. **Written but unproven on an actual runner — left open in `plan.md` §16.**
- [x] **`KAFKA_ENABLED=false` by default** — the service must start, serve its HTTP surface, and pass health checks with no broker present.
- [x] **The four-layer structure** — [`engineering-rules.md`](../engineering-rules.md) §2.1:
  ```
  interfaces/   types, envelope and message contracts, no behaviour
       ▲
  services/     business logic — pure where it can be, orchestration where it must be
       ▲
  clients/      I/O adapters — Kafka, ValKey, HTTP, the write-ahead store
       ▲
  index / app   composition root: reads config, builds clients, injects, starts
  ```
  Dependencies point inward only. `services/` never imports from `index`. `clients/` never imports from `services/`. Clients are constructed **once**, at the composition root, and injected — no service reaches for a module-level singleton. `interfaces/` holds types and constants only, no behaviour.

**Explicitly not part of this checklist — do not start it yet:**

- Any pipeline logic (`isCanonicalRecord`, `classifyEventType`, `buildEnvelope`, …) — that's Phase 2 onward, and D3 must be settled first for the parts it touches (D5 is already settled — `commitTransfer`, ISO vocabulary).
- The `capture-feeder` / `ppa-stub` test harness — that's [`plan.md`](../plan.md) §4, Phase 1, and comes **immediately after** scaffolding, not as part of it. Full design: [`environment-simulation.md`](../environment-simulation.md).
- PII tokenization, JWS verification, mTLS — all later phases.

---

## 5. Concrete values to carry over from the POC

The POC ([`/home/abdul-rahim/mojaloop/poc-mla-ppa/mla/`](/home/abdul-rahim/mojaloop/poc-mla-ppa/mla/)) is a **structural precedent** ([`cch-mla/README.md`](../../../cch-mla/README.md)), and its scaffolding-level choices carry forward as-is — this is tooling and convention, not business logic, so none of it is subject to the cross-reference.md divergence analysis. Read its files directly rather than retyping them from memory; the values below are what to expect there, not a substitute for reading them.

| What | Where in the POC | Carries forward |
| --- | --- | --- |
| `package.json` scripts (`build`, `start`, `dev`, `lint`, `fix`, `test`) | `mla/package.json` | As-is. Add `demo:*` scripts only once the harness (Phase 1) exists — not now. |
| `tsconfig.json` | `mla/tsconfig.json` | As-is — `target: ES2022`, `module: NodeNext`, `strict: true`, `rootDir: src`, `outDir: build`. |
| `eslint.config.mjs` | `mla/eslint.config.mjs` | As-is — flat config, `eslint-config-love`, `@stylistic`, `@eslint-community/eslint-comments`, Prettier integration via `eslint-config-prettier/flat`. |
| `jest.config.ts` | `mla/jest.config.ts` | As-is **except** `coverageThreshold: 96` (the POC ran with no enforced threshold — this project enforces one mechanically from day one). `coveragePathIgnorePatterns` should still exclude `src/interfaces`, `__tests__`, `src/index.ts`. |
| `Dockerfile` | `mla/Dockerfile` | As-is — multi-stage, `node:22-bullseye` build / `distroless/nodejs22-debian12:nonroot` run, `USER nonroot`. |
| `.env.template` | `mla/.env.template` | As-is for the shape; **audit every value against the current knowledge base before copying**, especially `KAFKA_AUDIT_TOPIC` (the POC marks its own default `mojaloop-audit` as stale — the confirmed real topic is `topic-event-audit`, per `core-knowledge.md` §2.1) and `KAFKA_GROUP_ID` (must be genuinely dedicated — R-18). |
| `src/logger.ts` | `mla/src/logger.ts` | As-is — the `LoggerService`-shaped `pino` wrapper. |
| Dependencies | `mla/package.json` `dependencies` | `fastify`, `kafkajs`, `pino`, `ulid`, `dotenv`, `tslib`, `undici` — same set. Add nothing speculative; every new dependency should map to a concrete Phase 2+ need (a JWS library for Phase 3, a keyed-hash primitive for Phase 4). |

**Do not carry forward:** the POC's `src/interfaces/event-envelope.ts` contents (the `id` scheme is D3, still open; the third `msgType` value the POC relies on is tied to D5, now settled to match the POC — see §2–§3), and `src/services/logic.service.ts` in full (that's the pipeline itself, Phase 2+, not scaffolding).

---

## 6. The exit criterion — met, [2026-09-01]

From [`plan.md`](../plan.md) §3.3, verbatim:

> The service installs, builds, lints clean, passes an empty suite, starts, serves both health endpoints, and shuts down cleanly on `SIGTERM`. D1–D7 are recorded as decisions with rationale, in this file.

Run for real, on the machine that built it — not reasoned about:

```
npm install    # clean — 602 packages, 0 vulnerabilities
npm run build  # tsc, zero errors
npm run lint   # zero errors, zero warnings
npm test       # 43 tests, 5 suites, 100% coverage, default parallel mode
node build/index.js                 # starts with no .env and no broker
curl localhost:3001/health/live     # 200 {"status":"UP","service":"cch-mla"}
curl localhost:3001/health/ready    # 200 {"status":"UP","kafka":"DISABLED"}
```
`SIGTERM` logged `Received SIGTERM, shutting down`, the process exited 0, and the port was released — no forced kill. (Signal `npm start`'s child directly if reproducing this: npm itself does not forward `SIGTERM` to node, so signalling the `npm` process leaves the child orphaned holding the port. This is an artifact of the `npm` wrapper, not the shutdown handler — the `Dockerfile` runs `node build/index.js` directly, with node as PID 1, which is what actually receives `SIGTERM` in any real deployment.)

Two extra checks beyond the literal criterion, because the checklist above implies them: started with `KAFKA_ENABLED=true` against an unreachable broker, `/health/live` stayed 200 while `/health/ready` correctly went 503 `{"status":"DOWN","kafka":"DOWN"}`. Started with a required Kafka variable missing, and separately with `LOG_LEVEL=chatty`: both refused to start, exit 1, naming the offending variable.

**D1–D7 were already recorded** (`plan.md` §3.1, restated in §2–§3 above) before this phase started. Full transcript, what diverged and why, and what's left open: [`plan.md`](../plan.md) §16's Phase 0 entry and [`docs - MLA/EPICS/EPIC-0-Scaffolding/`](../EPICS/EPIC-0-Scaffolding/).

**What closed this out:**

1. The first entry was added to [`plan.md`](../plan.md) §16 — what was built, what was verified live, what diverged, what's left open.
2. `docs - MLA/EPICS/EPIC-0-Scaffolding/executive-summary.md` and `file-register.md` were written, per `CLAUDE.md`'s "Epic and story documentation" rule.
3. Left in the working tree for the user to commit — `CLAUDE.md`'s "Commits" rule: Claude never runs `git commit`.
4. Next: [`plan.md`](../plan.md) §4, Phase 1 — the `capture-feeder` / `ppa-stub` harness. **Do not skip ahead to pipeline code before the harness exists** — that inversion is deliberate (`plan.md` §15, sequencing point 1) and is what gives every subsequent phase a live exit criterion from its first line of code.

---

## 7. What comes immediately after

Not this session's job, but worth knowing so scaffolding decisions don't foreclose it:

- **Phase 1** builds `tools/capture-feeder` and `tools/ppa-stub` against a local Redpanda — see [`environment-simulation.md`](../environment-simulation.md) in full before writing either.
- **Phase 2** (first real pipeline story, `US-MLA-01`) needs D3 settled for its `id`-scheme parts. If it's still open when Phase 2 starts, that's a raise-it-now situation, not a build-around-it one.

---

## 8. Traps worth knowing before you start

- **Do not resolve D3 yourself.** It's flagged in `plan.md` §13.1 as needing input from outside this codebase (PPA's owners). A session under time pressure picking an answer to "keep moving" is exactly the failure mode `plan.md` §3.1 exists to prevent. (D5 is already settled — `commitTransfer`, ISO vocabulary — so it no longer applies here.)
- **The POC's `.env.template` has at least one confirmed-stale default** (`KAFKA_AUDIT_TOPIC=mojaloop-audit`). Copying it verbatim without checking `core-knowledge.md` §2.1 reintroduces a known error.
- **`coverageThreshold: 96`, not 95.** This was explicitly decided in the immediately preceding session (the user chose "above 95%" over "95% floor") and propagated through `engineering-rules.md`, `README.md`, `CLAUDE.md` and `plan.md`. Do not default to the more common 95 out of habit.
- **`docs - MLA/EPICS/` is the spec to build against, not `core-knowledge.md`.** `core-knowledge.md` is explicitly capture-blind (see its own header warning) — it reproduces what the four story documents say even where the captures contradict them. For the actual per-story acceptance criteria, read the `story.md` under `docs - MLA/EPICS/`.
- **Nothing here is a substitute for `strategy.md`.** This document orients one session at one moment. `strategy.md` is the durable index and outranks this document the instant they'd disagree.

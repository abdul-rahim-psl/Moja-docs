<!-- SPDX-License-Identifier: Apache-2.0 -->

# Continue — Before Harness <!-- omit in toc -->

**What this document is.** A session handoff. It marks the point where Phase 0's scaffolding is complete and **Phase 1's harness checklist** ([`plan.md`](../plan.md) §4) is the next work. Read this in full before touching anything; it is short by design.

**When this is superseded.** The moment the harness's exit criterion is met and the corresponding `docs - MLA/plan.md` §16 progress-log entry lands, this document's "what's next" job is done. It stays as the record of where things stood; a later `continue -` doc (Phase 2's, most likely) takes over for what's next.

- [1. Sixty-second orientation](#1-sixty-second-orientation)
- [2. What is already decided — do not re-litigate](#2-what-is-already-decided--do-not-re-litigate)
- [3. What is NOT yet decided — do not build the harness around a guess](#3-what-is-not-yet-decided--do-not-build-the-harness-around-a-guess)
- [4. The harness checklist](#4-the-harness-checklist)
- [5. Environment facts specific to this machine](#5-environment-facts-specific-to-this-machine)
- [6. The exit criterion — read this before calling anything done](#6-the-exit-criterion--read-this-before-calling-anything-done)
- [7. What comes immediately after](#7-what-comes-immediately-after)
- [8. Traps worth knowing before you start](#8-traps-worth-knowing-before-you-start)

---

## 1. Sixty-second orientation

Phase 0 closed live on 2026-09-01 — [`plan.md`](../plan.md) §16's first entry, and [`docs - MLA/EPICS/EPIC-0-Scaffolding/`](../EPICS/EPIC-0-Scaffolding/) for the full writeup. What exists now: a TypeScript + Fastify skeleton at the repository root, the four-layer structure (`interfaces/`, `services/`, `clients/`, composition root), typed and validated configuration, `/health/live` + `/health/ready`, structured logging, a Kafka *connection* client (connect/disconnect/`isConnected` only — no subscription, no consumption), 43 tests at 100% coverage against a mechanically-enforced 96% gate, and a GitLab CI pipeline (written, never yet run on a runner).

**No pipeline logic exists.** Nothing reads a Kafka record, classifies an event, builds an envelope, or talks to a PPA. That is the point of this phase: before any of it is written, [`plan.md`](../plan.md) §15 sequencing point 1 requires the verification instrument to exist first, so every subsequent phase has a **live** exit criterion from its first line of code, rather than reconstructing a verification script per session from prose — which is exactly what slowed the POC down.

Read in this order:

1. [`cch-mla/CLAUDE.md`](../../../cch-mla/CLAUDE.md) — if this is a new session, in particular the "Epic and story documentation" and "Commits" sections, both added since Phase 0.
2. [`../strategy.md`](../strategy.md) — the map. Follow its routing table; do not read the whole knowledge base.
3. [`../environment-simulation.md`](../environment-simulation.md) — **in full.** This is the harness's design authority: `capture-feeder`'s faithfulness rules and scenario flags, `ppa-stub`'s contract, golden-file regression, and §4's honest list of what none of this can prove. This document does not repeat that design; it only walks the checklist with the reasoning inline.
4. **This document** — where things stand right now, specifically.
5. [`../plan.md`](../plan.md) §4 — the actual harness checklist, which this document walks through but does not replace.

---

## 2. What is already decided — do not re-litigate

[`plan.md`](../plan.md) §3.1 records all seven; six are now settled and none of them is this phase's to reopen:

| # | Decision | What we build |
| --- | --- | --- |
| **D1** | Canonical-record selection | The POC's per-operation table, plus a payload shape-check for `prepareTransfer`. |
| **D2** | Classification signal | `operation` alone, corroborated by (not derived from) HTTP method/resource and signature presence. |
| **D4** | `msgType` cardinality | Two values (`request`/`callback`), no `/TRANSFERS/NOTIFICATIONS` fifth route. |
| **D5** | Final-state trigger | `commitTransfer` (`egress`), ISO `TxSts` vocabulary (`COMM`/`RESV`) authoritative — matches the POC. |
| **D6** | Payload selection | The FSPIOP form (`content.transformedPayload` / `content.payload`), not mandatory base64 decoding. |
| **D7** | Envelope `error` field | Present, populated only when a rejection shape is detected. |

**None of these bear on the harness directly** — `capture-feeder` and `ppa-stub` are both classification-agnostic by design (`environment-simulation.md` §3.2: the stub "must never translate, correlate, or accumulate state"). They matter to this phase only insofar as the scenario library and golden files should be named and shaped in a way that won't need renaming once Phase 2 classification lands.

---

## 3. What is NOT yet decided — do not build the harness around a guess

**D3** (the envelope `id` scheme — per-`eventType` vs. one leg-wide anchor) is still open, still a cross-team decision, and still not this team's to resolve unilaterally (`plan.md` §13.1). **D5** (which record is the final-state trigger) is settled — `commitTransfer` (`egress`), ISO `TxSts` vocabulary — and no longer belongs in this section; see §2 above.

**D3 does not block the harness**, for the same reason it didn't block scaffolding: `capture-feeder` produces raw Kafka records exactly as captured, and `ppa-stub` validates structural envelope shape, not the semantics of what `id` means. **It will block Phase 2** the moment classification needs to decide what a record's `id` actually is.

**One clarification worth stating plainly, because the phase's checklist could otherwise read as contradicting §3.1.** [`environment-simulation.md`](../environment-simulation.md) §3.2 requires `ppa-stub` to validate incoming envelopes against an ajv schema, and [`plan.md`](../plan.md) §6 (Phase 3) separately lists "envelope ajv schema, shared verbatim with `ppa-stub`" as a Phase 3 deliverable. These are not in conflict, but the sequencing needs to be explicit or a future session will wonder why Phase 3's item already looks satisfied:

- The envelope's **structural shape** — field names, types, which are required — does not depend on D3 or D5. D3 only changes what the `id` field *means*; it is a string either way. D4 and D7, which do affect shape, are already settled.
- **Build the ajv schema once, now, in this phase**, as the artefact `ppa-stub` needs to do its job. A sensible location: `src/interfaces/event-envelope.schema.json` alongside a TypeScript `EventEnvelope` interface in the same folder — `interfaces/` is exactly where a contract with no behaviour belongs (`engineering-rules.md` §2.1).
- **`tools/ppa-stub` imports that file directly**, rather than duplicating it. `engineering-rules.md` §2.2's "duplicate the envelope type across MLA and PPA" rule is about the real MLA↔PPA boundary — two different repositories, two different trust boundaries. `ppa-stub` lives inside this repository, so there is no boundary to protect by duplicating.
- **Phase 3 then reuses this file rather than recreating it** — its own checklist item is satisfied by wiring the real envelope builder to validate against what already exists, not by writing a second schema.
- No POC precedent exists for this file. The POC's `ajv` usage validates the *ISO 20022 output* against Tazama's schema (`tazama-schema.validator.ts`, PPA-side); its envelope was checked structurally in application code, never against a standalone JSON Schema. This is new work with no template to carry forward.

---

## 4. The harness checklist

This is [`plan.md`](../plan.md) §4, walked through with the reasoning inline. Work through it in order; each item cites the rule or document it exists to satisfy. Full design for every item: [`environment-simulation.md`](../environment-simulation.md) §3.

- [ ] **`docker-compose.dev.yml`** — single-node Redpanda, with `topic-event-audit` created at **12 partitions** (`environment-simulation.md` §3.1: max `partitionID` across the 500-record export, plus one, is 12 — this is not a round-number guess). Docker is confirmed working on this machine (§5 below) — nothing blocks starting here.
- [ ] **`tools/capture-feeder/`** — reads a capture file and produces each record onto the topic. The faithfulness rules in `environment-simulation.md` §3.1 are non-negotiable, not implementation taste: explicit per-message `partition` (never key-hashing — hashing would scatter `04_ZMW_to_EGP_partition_split`'s real cross-partition evidence), per-partition offset order preserved, absolute offsets **not** reproduced (Kafka assigns them; nothing downstream depends on the absolute value), the original `key.payload` carried through, headers flattened onto the message, and the original `timestamp` preserved. Every scenario flag (`--speed`, `--only`, `--delay-partition`, `--duplicate`, `--drop`, `--corrupt`, `--strip-signature`, `--loop`) maps to an acceptance criterion with no other route to coverage — none is speculative, so none is optional.
- [ ] **`tools/ppa-stub/`** — a test double, never a re-implementation (`environment-simulation.md` §3.2: "must never translate, correlate, or accumulate state"). Exposes `/QUOTES`, `/FXQUOTES`, `/TRANSFERS`, `/FXTRANSFERS`, `/health/live`, `/health/ready`; validates every envelope against the ajv schema built in this phase (§3 above) and returns 400 on drift; records every envelope received, in order, to JSONL; injects faults on command via `POST /control {mode, afterN, forMs}` — without this, US-MLA-06/07 are untestable, there is no other way to drive retry-with-backoff, offset-not-advancing, breaker trip, or re-probe/resume; and speaks mTLS against a local self-signed CA, so the handshake-failure-as-transient path (US-MLA-06, R-22) is exercised locally rather than deferred to deployment.
- [ ] **`tools/` README** — documents how to run each scenario, and states plainly that **offsets are not reproduced, ordering is** (`environment-simulation.md` §3.1) — this is the one property someone will assume is faithful and needs to be told explicitly is not.
- [ ] **Curated unit fixtures, lifted verbatim from real captures — never hand-written.** Cover every classification case, the partition-split transaction, the transfer rejection, the FX-quote rejection, and the party-lookup records. `engineering-rules.md` §10.3: a hand-written fixture encodes what you believe the wire looks like; only a capture encodes what it is — this is how the `start`/`egress` double-write and the non-transaction-scoped `traceId` were both discovered in the first place.
- [ ] **Golden-file regression**, with goldens for `01_MWK_to_ZMW_PRIMARY`, `raw_topic_slice_partition2.json`, and the full 500-record export. Targets the exact failure class that hurt the POC twice — `reserveFxTransfer` silently dropped on every settlement leg, and a real rejection discarded through the duplicate-skip path. Neither produced an error; no test caught either; a golden file would have caught both on the next run (`environment-simulation.md` §3.3).
- [ ] **A named scenario library**, each mapping to an acceptance criterion: happy path · partition split · transfer rejection · FX-quote rejection · duplicate record · dropped record · corrupt record · missing signature · PPA 503 · PPA 4xx · PPA timeout · PPA flaky · broker restart · MLA restart · two MLA instances.

**Explicitly not part of this checklist — do not start it yet:**

- Any pipeline logic that reads a real record's *meaning* — canonical selection, classification, envelope construction. That is Phase 2 onward, and D3 still gates the `id`-scheme parts of it (D5, the final-state trigger, is settled — `commitTransfer`, ISO vocabulary — and no longer gates anything here).
- The MLA's own consumption logic (`autoCommit: false`, explicit advance/pause/resume). Phase 0 built connection-lifecycle only; subscribing and reading records is US-MLA-01, Phase 2.
- PII tokenization, JWS verification, real mTLS against a real PPA. All later phases.

---

## 5. Environment facts specific to this machine

Verified directly this session, not assumed — worth recording so the next session doesn't re-discover them.

- **The full capture pack is on disk**, outside this repository: `/home/abdul-rahim/mojaloop/DRPP_Kafka_E2E_Pack 2/` — the five corridor folders (`01_MWK_to_ZMW_PRIMARY` … `05_ZMW_to_KES`, 20 records each), `raw_topic_slice_partition2.json` (41 records), and `raw_export_500.json/raw_export_500.json` (500 records, 12 partitions), ~13MB total.
- **Decision made this session: commit the captures into the repository**, matching the POC's own precedent (`poc-mla-ppa/mla/__tests__/fixtures/`) rather than referencing them from an external path. This was raised explicitly rather than defaulted, because the records carry realistic PII-shaped fields (MSISDNs, legal names, bearer tokens) and the FSD's Zambia Data Protection Act question (Open Item #6) is still open (`plan.md` §13.2) — that item gates *production* handling, not this decision, but it was worth surfacing rather than assuming. **Copy the pack into `__tests__/fixtures/` (or an equivalent checked-in location) as part of building `capture-feeder`**, verbatim, per `engineering-rules.md` §10.3.
- **Docker is available and working** (`docker ps` succeeds; the `docker` group is in this user's `groups`). `docker compose` (the plugin form, not standalone `docker-compose`) should be confirmed when `docker-compose.dev.yml` is first written.
- **A stopped, unrelated Mojaloop stack exists on this machine** — `ml-core-test-harness`, the standard Mojaloop reference testing-toolkit compose project (`central-ledger`, `quoting-service`, `account-lookup-service`, `ml-api-adapter`, several `testfsp*`/`payerfsp`/`payeefsp` SDK adapters, Redis, Mongo), all containers currently `Exited`, on a docker network named `mojaloop-net`. **This is not COMESA's DRPP** — it is generic reference test infrastructure, unconnected to the real capture data. It is stopped, so it is not currently a port conflict, but if someone starts it while this phase's Redpanda stack is running, be aware of the ports it claims: `3000`, `3001`, `3002` (`ml-api-adapter`, `central-ledger`, `quoting-service`) and `27017`/`6379`-family (Mongo/Redis). None of these collide with Redpanda's own defaults (`9092`, `9644`, `8081`, `8082`) or with this service's own `PORT=3001` — **except** `central-ledger` also defaults to `3001`, the same as this service's own default port. Pick a different `PORT` for local harness runs if both stacks are ever up together, rather than relying on only one being started at a time.
- **A separate, apparently-live Tazama TMS stack was observed running** (`tazama-tms-1` on host port `5000`, `tazama-admin-service-1` on `5100`, plus relay containers) — unrelated to this phase, noted only so its ports (`5000`, `5100`) are known to be spoken for if this project ever needs a real local TMS to dispatch against (Phase 8 territory, not this phase).

---

## 6. The exit criterion — read this before calling anything done

From [`plan.md`](../plan.md) §4, verbatim:

> `capture-feeder` produces `raw_export_500.json` onto the local topic with all 500 records landing on their original partition numbers in their original per-partition order, verified by reading the topic back and diffing against the source. `ppa-stub` accepts, validates and records a hand-crafted envelope, and returns each injectable fault on command.

Concretely, before this phase is called done:

```
docker compose -f docker-compose.dev.yml up -d      # Redpanda comes up, topic-event-audit exists at 12 partitions
npm run feeder -- --file __tests__/fixtures/raw_export_500.json   # (script name illustrative — see tools/ README once written)
# read the topic back with a plain consumer and diff per-partition order against the source file
npm run ppa-stub                                     # starts, serves /health/live and /health/ready
curl -X POST https://localhost:<STUB_PORT>/control -d '{"mode":"503"}'   # stub now returns 503
# POST one hand-crafted, schema-valid envelope -> 200, appears in the JSONL output
# POST one hand-crafted, schema-invalid envelope -> 400
```

Then run the full scenario library once, unattended, and confirm the golden-file diff is clean for all three named goldens.

**When this is genuinely done:**

1. Add the corresponding entry to [`plan.md`](../plan.md) §16, in the same format as the Phase 0 entry — what was built, what was verified live versus assumed (in particular: which of `environment-simulation.md` §4's stated limits still hold exactly as written, since this phase is what builds the thing those limits are about), what diverged, what is left open.
2. Write `docs - MLA/EPICS/EPIC-1-Harness/executive-summary.md` and `file-register.md` (or wherever this phase's epic folder ends up living — it has the same "precedes a story, carries no `story.md`" shape as `EPIC-0-Scaffolding`), per `CLAUDE.md`'s "Epic and story documentation" rule.
3. Leave it all in the working tree for the user to commit — `CLAUDE.md`'s "Commits" rule.
4. Move to [`plan.md`](../plan.md) §5, Phase 2 — ingestion (US-MLA-01/02/03). **Do not start classification or envelope logic before the harness is genuinely live** — that inversion is exactly what `plan.md` §15 sequencing point 1 exists to prevent.

---

## 7. What comes immediately after

Not this phase's job, but worth knowing so harness decisions don't foreclose it:

- **Phase 2** (`US-MLA-01`–`03`) needs `capture-feeder` to feed `raw_topic_slice_partition2.json` at minimum, and the harness's restart/reconnect scenarios to prove offset-resume-on-restart — something the POC's `demo:replay` could never demonstrate (`environment-simulation.md` §2).
- **Phase 3** (`US-MLA-04`/`05`) reuses the ajv schema built in this phase (§3 above) rather than rebuilding it, and needs `ppa-stub`'s mTLS path already working.
- **Phase 5** (`US-MLA-06`/`07`) is "the phase the harness was built for" (`plan.md` §8) — every fault-injection mode `ppa-stub` supports gets exercised there. If a fault mode turns out to be missing when Phase 5 starts, that is this phase's gap to have caught, not Phase 5's to work around.

---

## 8. Traps worth knowing before you start

- **Do not resolve D3 to make the scenario library or golden files easier to name.** Name them after the raw data (`01_MWK_to_ZMW_PRIMARY`, `partition2-slice`, `export-500`), not after a classification scheme that doesn't exist yet. (D5 is separately settled — `commitTransfer`, ISO vocabulary — but that doesn't license naming anything after it either; the harness stays classification-agnostic regardless of which decisions have landed.)
- **`ppa-stub` must never become a second implementation of PPA.** The moment it starts correlating across envelopes, accumulating ValKey-shaped state, or translating to ISO 20022, it has stopped being a test double and started being an unverified reimplementation of a different component in a different trust boundary. If a scenario seems to need that, the scenario is wrong, not the stub.
- **The captures-in-repo decision (§5 above) is specific to this dev/test pack.** It says nothing about whether production capture data, once the COMESA environment exists (Phase 8), should ever be committed anywhere. Do not generalise this session's call beyond what it actually decided.
- **`central-ledger`'s default port (`3001`) collides with this service's own default `PORT`.** Harmless while the `ml-core-test-harness` stack stays stopped; worth an explicit `PORT` override in `docker-compose.dev.yml` or `.env` if it's ever started alongside this project's own local run.
- **The GitLab CI pipeline from Phase 0 has never run on a runner.** If this phase adds a Docker-in-Docker step (to run Redpanda inside CI for the golden-file regression), that is the first real test of `.gitlab-ci.yml` as well as of the harness — expect to debug both together, not just the harness.
- **`environment-simulation.md` §4 is not decoration.** Restate its limits honestly in this phase's own `plan.md` §16 entry rather than letting a clean local run imply more than it proves — real DFSP signatures, PPA's actual durability guarantee, representative throughput and multi-node rebalance stay unproven regardless of how clean this phase's own exit criterion run looks.

<!-- SPDX-License-Identifier: Apache-2.0 -->

# Plan — CCH MLA (and its PII tokenization) <!-- omit in toc -->

**What this document is.** The build plan for `cch-mla`, in phases, with an exit criterion per phase and an honest register of what is blocked. It is written to be *edited as work happens* — the POC's own [`plan-outline.md`](../docs-poc-mla-ppa/plan-outline.md) proved that a plan which records what broke, why, and what was actually proven live is worth more than one that only records intent. This file inherits that job.

**What it is not.** It is not a restatement of the requirements ([`core-knowledge.md`](knowledge-base-stories/core-knowledge.md)), not the engineering policy ([`engineering-rules.md`](engineering-rules.md)), and not the POC comparison ([`cross-reference.md`](knowledge-base-stories/cross-reference.md)). It sequences the work those three describe.

**The standing rule this plan is built around:** *a design is a hypothesis until it has been run.* Six real bugs in the POC's shipped code were found by running it against real data; none were found by unit tests alone. Every phase below therefore has a **live exit criterion**, not a test-coverage one.

- [1. Where we are](#1-where-we-are)
- [2. The environment problem — and the answer](#2-the-environment-problem--and-the-answer)
- [3. Phase 0 — Decisions, then scaffolding](#3-phase-0--decisions-then-scaffolding)
- [4. Phase 1 — The harness: simulate the topic](#4-phase-1--the-harness-simulate-the-topic)
- [5. Phase 2 — Ingestion path](#5-phase-2--ingestion-path)
- [6. Phase 3 — Envelope construction and JWS validation](#6-phase-3--envelope-construction-and-jws-validation)
- [7. Phase 4 — PII tokenization](#7-phase-4--pii-tokenization)
- [8. Phase 5 — Delivery, offsets, and resilience](#8-phase-5--delivery-offsets-and-resilience)
- [9. Phase 6 — Observability and operability](#9-phase-6--observability-and-operability)
- [10. Phase 7 — Hardening and validation](#10-phase-7--hardening-and-validation)
- [11. Phase 8 — The COMESA environment](#11-phase-8--the-comesa-environment)
- [12. Divergence register — where we depart from the POC](#12-divergence-register--where-we-depart-from-the-poc)
- [13. Blocked work](#13-blocked-work)
- [14. Open questions for COMESA / the Mojaloop Partner](#14-open-questions-for-comesa--the-mojaloop-partner)
- [15. Suggested sequencing](#15-suggested-sequencing)
- [16. Progress log](#16-progress-log)

---

## 1. Where we are

**Phases 0 through 6 are built and live-verified; Phase 7 is development-complete and live-verified but not formally closed (its "in CI" clause is blocked on a runner constraint — see its row below and §10); Phase 4's mechanism is built and live-verified too, though that phase is likewise not formally closed. Phase 8 is partially under way — no longer blocked in its entirety — and is where the current work sits; see its row below, §11, and §16's five Phase 8 (partial) entries.** A TypeScript + Fastify skeleton exists at [`cch-mla`](/home/abdul-rahim/mojaloop/cch-mla) — the four-layer structure, typed and validated configuration, `/health/live` + `/health/ready`, structured logging, a real ingestion pipeline, real envelope construction, real JWS verification, real PII tokenization, **real delivery to PPA with the full offset/retry/breaker/reprobe mechanism live**: every forwarded record either reaches PPA and advances the offset on HTTP 200, is logged in full and advanced immediately on a permanent 4xx, or is retried with genuine jitter and — on exhaustion — parked behind a per-partition circuit breaker that re-probes and resumes entirely on its own, no restart required, and now **full observability and operability**: structured logs carrying `correlationId`/`eventType`/pipeline step on every line, ten Prometheus-compatible metrics answering every operator question `core-knowledge.md` §9 and `engineering-rules.md` §9 name, and alert paths wired at all five named conditions (missing/invalid signature, a PPA 4xx, retry exhaustion, a breaker trip, a PII tokenization failure), each raising both a metrics-based signal (always active) and an optional configurable webhook. Every record either becomes a schema-valid, tokenized `EventEnvelope` that a live `ppa-stub` accepts over mTLS, or is rejected/skipped for a named, correctly-classified reason — including a genuinely re-signed record verifying and forwarding with prefixed tokens in every listed field, a tampered one failing, a stripped signature failing distinctly, a key-source outage failing distinctly from an invalid signature, and a missing PII secret failing distinctly again, all proven against a real broker and a real `ppa-stub`, not a mock. 493 tests at 100%/97.74%/100%/100% coverage against a mechanically-enforced 96% gate, and a GitLab CI pipeline. Full detail: §16's Phase 0–6 entries, `EPICS/EPIC-0-Scaffolding/`, `EPICS/PHASE-1-Harness/`, `EPICS/EPIC-1-kafka-subscription-audit-topic-ingestion/`, `EPICS/EPIC-2-envelope-construction-jws-validation/`, `EPICS/EPIC-PII-tokenization/`, `EPICS/EPIC-3-delivery-to-ppa-offset-management/` and `EPICS/PHASE-6-Observability-Operability/`. **Gate item #1 (`continue/continue - before phase 5.md` §2) is done** — a PII secret failure is now transient (retry, park, breaker), live-verified against the real harness §16's own US-PII-01 entry. **Gate item #2 (§7.1 #2, §13.1) — secret rotation — is also resolved [2026-09-18, spec confirmed 2026-09-22]: no rotation, a long-lived key, needing no build. Phase 4 is formally closed [2026-09-22]** — both gates that blocked closure are answered, §16's own closure entry has the full record. **Phase 5 (delivery, offsets, resilience, §8) is done** — its exit criterion (§8) is fully met live, §16's US-MLA-06/US-MLA-07 entries have the complete narrative. **Phase 6 (observability and operability, §9) is now done** — its exit criterion (§9), the full 500-record feed accounted for in exactly one bucket summing to 500, is fully met live, §16's US-MON-01/US-PERF-01 entries have the complete narrative; only R-37 (alerting destination/routing) stays open with CCH, gating nothing this codebase controls. **Since [2026-09-11], two workstreams have run on top of all of this and are not reflected in the phase rows above:** a QA review of `cch-mla/src/` producing 22 findings (`bugs/qa-review-findings.md`), of which **F-01 through F-10 — every Critical and High — are fixed and live-verified** while F-11 through F-22 (Medium/Low) are not started, on the `paysys-QA-F11-onwards` branch; and **Phase 8's partial start** (§11, §16). The newest handoff is `continue/continue - before phase 8.md`, whose account of Phase 7 holds but whose "Phase 8 is blocked in its entirety" framing does not — §16 is the ground truth, per `strategy.md` §4:

| Asset | State |
| --- | --- |
| Requirements — five user-story documents (`cch-crosscutting-user-stories.md` added [2026-09-07]), MLA's and PII's stories broken out per story under `docs - MLA/EPICS/` | Complete; several findings still open (R-04 Critical, R-37 High, R-18, R-23, R-29, R-31) |
| Synthesized model — [`core-knowledge.md`](knowledge-base-stories/core-knowledge.md) | Complete |
| Engineering policy — [`engineering-rules.md`](engineering-rules.md) | Complete and binding |
| POC comparison — [`cross-reference.md`](knowledge-base-stories/cross-reference.md) | Complete; **all seven forks settled (§3.1)** — D3 (the last of them) resolved with PPA's owners as Option A, the per-`eventType` scheme |
| A live-verified predecessor — `poc-mla-ppa` and its documentation set | Complete, and the single most valuable input we have |
| Real capture data — `DRPP_Kafka_E2E_Pack 2/` | In hand (see §1.1); committed into `cch-mla` at `__tests__/fixtures/` as Phase 1 fixtures, verbatim (`continue/continue - before harness.md` §5) |
| **Phase 0 — scaffolding** | **Done**, [2026-09-01] — §16 |
| **Phase 1 — the harness** | **Done**, [2026-09-02] — §16. `capture-feeder`, `ppa-stub`, golden-file regression, curated fixtures and the named scenario library all exist and are live-verified. |
| **Phase 2 — ingestion path** | **Done**, [2026-09-02/03] — §16 (US-MLA-01/02/03), §5. Kafka consumer, canonical selection, classification, FX-quote-rejection detection, payload selection and the unreadable-record path are all built, wired into one live handler, and verified against a real broker — including a decision-level golden file and a genuine mid-feed kill/restart. |
| **Phase 3 — envelope construction and JWS validation** | **Done**, [2026-09-03] — §16 (US-MLA-04/05), §6. Envelope construction, ajv schema enforcement, and real RS256/384/512 JWS verification (file-backed, hot-reloadable key store) are all built, wired into one live handler, and verified against a real broker and a real `ppa-stub` — including a genuinely re-signed record, a tampered one, a stripped signature, and a simulated key-source outage, each producing a distinct, correctly-classified outcome. D3 (the envelope `id` scheme) resolved with PPA's owners as Option A during this phase. **JWS verification subsequently removed [2026-09-23]** on branch `paysys-remove-JWS`, built and live-verified; both closure-blocking sign-offs confirmed the same day — §16's [2026-09-23] entries. |
| **Phase 4 — PII tokenization** | **Formally closed [2026-09-22]** — mechanism built, tested, and live-verified [2026-09-04]; gate item #1 (fail-mode) built, tested, and live-verified [2026-09-04]; gate item #2 (secret rotation) resolved [2026-09-18, spec confirmed 2026-09-22], no rotation, a long-lived key, needing no build — §16 (US-PII-01/02, their follow-up entries, and the closure entry itself), §7. Two items remain open but gate go-live, not this closure (§13.2): what "protected" must mean legally, and named secret ownership. |
| **Phase 5 — delivery, offsets, and resilience** | **Done**, [2026-09-07] — §16 (US-MLA-06/07), §8. Delivery client, per-call timeout, the full three-way offset gate (success/permanent/transient), retry with genuine jitter, a per-partition circuit breaker, and automatic reprobe recovery are all built, tested, and live-verified against a real broker and a real `ppa-stub` — including a persistent-503 breaker trip and its own automatic, restart-free recovery, a genuine TLS-handshake failure, and a 4xx logging the full (tokenized) envelope and advancing immediately. Every clause of the phase's own exit criterion (§8) is live-proven. |
| **Phase 6 — observability and operability** | **Done**, [2026-09-08] — §16 (US-MON-01/US-PERF-01), §9. Structured logging, ten Prometheus-compatible metrics, and alert paths at all five named conditions (each with a metrics-based sink, always active, plus an optional configurable webhook) are all built, tested, and live-verified against a real broker and a real `ppa-stub` — including every alert condition firing independently on genuinely re-signed records, and the phase's own exit criterion (a full 500-record feed accounted for in exactly one bucket, summing to 500) met live. Only R-37 (alerting destination/routing) stays open with CCH, gating nothing this codebase controls; MLA's own ack-latency p95 *budget* (as opposed to its instrumentation, built here) is Phase 7's own load-test claim to confirm. |
| **Phase 7 — hardening and validation** | **Development complete and live-verified, [2026-09-09]; the phase is NOT closed** — §16, §10. All six checklist bullets done: load (25 TPS sustained x 30 min and 125 TPS peak, 10440/10440 and 8702/8702 ack samples within the 200 ms budget, consumer lag 0 throughout, and a 125->25 step-down with 6,000 fed = 6,000 accounted), two-instance rebalance (delivered set identical to a single-instance baseline, no duplicates, no gaps), chaos (broker restart, MLA `SIGKILL` mid-dispatch, stub flapping — nothing lost in any), and `npm run scenario:all` running all 15 named scenarios unattended from a cold start. **Open on the exit criterion's "in CI" clause**: the project's first-ever pipeline (#44134) ran [2026-09-09] and failed at `build` — the runner is a `shell` executor (so `image:` is inert and `services:` unsupported, meaning no broker in CI) on a host running Node < 16 against `engines: >=22.17`. Infrastructure's to resolve, not engineering's. |
| **Phase 8 — the COMESA environment** | **Partially under way, [2026-09-15] and [2026-09-17] — no longer blocked in its entirety on this side, but CCH's own cluster deployment has not yet been attempted** — §16's six Phase 8 (partial) entries, §11. Done, this side: real Kubernetes manifests handed to CCH techops [2026-09-15]; the registry pivot to **GHCR** (`psl-izyane-cch-frms/cch-mla`, digest-pinned) as the path CCH actually pulls from; the **first live delivery to the real PPA** at `10.0.115.186:3000` — 8 of 8 canonical envelopes (2 each QUOTE/FXQUOTE/TRANSFER/FXTRANSFER) accepted with HTTP 200, via the new dev-only `PPA_MTLS_DISABLED` bypass, which is a real standing gap while it is on; PPA's own source located locally at `cch-ppa`; and MLA shipped to a **Paysys-side test deployment** at `10.0.150.69` (namespace `mla`, on the Mojaloop demo cluster — this is our own rig, not CCH's cluster), consuming traffic fed onto its Kafka topic via `npm run feeder`, not organic live traffic. **On CCH's own cluster: their techops team has the manifest package via George Murage (CCH's technical lead and point of contact, not techops himself) [2026-09-15] but had not yet run `kubectl apply` as of the [2026-09-17] check-in** — `docs/meetings and emails/17-sept-checkin-for-pending-items.md`, §16's own entry for it. **Blocked, this side's own test rig**: no network path from the deployed MLA at `10.0.150.69` to the real PPA — §13.1; this does not gate CCH's separate deployment. Also open per the 09-17 check-in: an Infotex call (outbound IP, mTLS cert routing) not yet scheduled. The rest of §11's checklist (real DFSP signatures, a dedicated consumer group, production-representative load) stays blocked on the environment. |
| **QA review of `cch-mla/src/`** | **22 findings [2026-09-11]; F-01 … F-10 — every Critical and High — fixed and live-verified**, merged to `main` via `epic-QA`. **F-11 … F-22 (Medium/Low) not started**, on the `paysys-QA-F11-onwards` branch. Per-finding status in `bugs/qa-review-findings.md`'s own index, which is current. |
| **A running DRPP environment** | **Still not provisioned by COMESA; no date.** Note this is distinct from the Mojaloop *demo* cluster the deployed MLA at `10.0.150.69` already consumes from, and from the real PPA instance, both of which do exist. |

The POC is the reason this project does not start from zero. It ran the whole MLA→PPA→TMS path against real captured data, a real ValKey and a real Tazama TMS, and it found real defects doing so. Where the POC and the current user stories disagree, that disagreement is *evidence versus specification* and has to be resolved deliberately — §12.

### 1.1 What the captures actually are

Verified directly against the files, not taken from the documentation:

| Artefact | Contents |
| --- | --- |
| `DRPP_Kafka_E2E_Pack/01…05/raw_messages.json` | Five complete transactions, 20 records each, one per folder. All five settle `COMM`. **`04_ZMW_to_EGP_partition_split` spans partitions 7 and 10** — the confirmed out-of-order case. |
| `DRPP_Kafka_E2E_Pack/raw_topic_slice_partition2.json` | 41 records, a contiguous unfiltered read of partition 2 (offsets 76316–76356), holding three transactions. The realistic ingestion shape. |
| `raw_export_500.json/raw_export_500.json` | **500 records across 12 partitions (0–11), ~41–42 each.** 44 distinct `transactionId` tags, **52 distinct Kafka keys** — more keys than transactions, confirming the key is not transaction-scoped. 286 of 500 records carry `fspiop-signature`. **21 records carry `TxInfAndSts.StsRsnInf`** — the rejection shape (19 FX-quote + 2 transfer-prepare), matching `rejected-events.md` exactly. Timestamps span ~58 hours. |

**Every record is a Redpanda Console export:** `{ partitionID, offset, timestamp, compression, isTransactional, headers, key: {payload, rawPayload, encoding}, value: {payload, rawPayload, encoding} }`. The business envelope is `value.payload` — `{ content, id, metadata, type }`.

**Field presence across the 500-record export:** `content.headers` on all 500; `content.payload` on 352; `content.transformedPayload` on **68**; `content.dataUri` on **46**. The 148 records with no `content.payload` are the party-lookup `GET`s, which have no body. This matters for the decode decision in §12.

---

## 2. The environment problem — and the answer

**Full detail: [`environment-simulation.md`](environment-simulation.md).** That document is the authority on the harness — its design, its faithfulness rules, and the limits of what it can prove. Its §6 is a self-contained executive explanation. This section states only the decision and why it gates everything else.

**The problem.** COMESA is to provide an environment running the cross-border FX flow with the infrastructure behind it. We do not have it and have no date. Everything the MLA does begins at a Kafka topic we cannot currently read.

**Why the obvious answer is wrong.** The POC solved the same gap with `demo:replay` — a CLI that calls the compiled pipeline functions directly against a capture file. It was genuinely valuable; its first run found a real bug. But it **bypasses Kafka entirely**: it never connects to a broker, never commits an offset, and prints `dispatchToPpa`'s ADVANCE/PAUSE decision rather than acting on it. It therefore cannot prove offset resume on restart, offset held during a broker outage, restart-without-loss, offset-not-advancing during retries, breaker pause/re-probe/resume, or genuine cross-partition out-of-order arrival — **roughly half of MLA's durability contract, and most of US-MLA-07.** A mock consumer closes nothing: the behaviours in question *are* Kafka's, so a mock only asserts our own assumptions back at us.

**The decision.** Run a real broker locally — Redpanda in Docker, `topic-event-audit` with 12 partitions — and replay the captures onto it faithfully. Three checked-in components, built as Phase 1 (§4) **before** the pipeline, so every later phase has a real exit criterion from day one:

| Component | Does |
| --- | --- |
| **`capture-feeder`** | Produces capture records onto the topic with **explicit per-message partition assignment** — never key-hashing, which would scatter records and destroy the only real cross-partition evidence we have. Scenario flags (`--delay-partition`, `--duplicate`, `--drop`, `--corrupt`, `--strip-signature`, `--loop`) each exercise an acceptance criterion with no other route to coverage. |
| **`ppa-stub`** | A test double, never a re-implementation. Validates every envelope against the shared ajv schema, records them to JSONL, **injects faults on command**, and speaks mTLS against a local CA. Without fault injection, US-MLA-06/07 are untestable. |
| **Golden-file regression** | Diffs the stub's JSONL against a checked-in golden. Targets the exact failure class that hurt the POC twice — a record silently stops being forwarded and nothing errors. |

**What it still cannot prove** — carried into every phase's exit criterion so none overclaims: genuine DFSP signatures (we hold 286 real ones and none of the public keys), PPA's durable-ack guarantee, representative throughput, and multi-node rebalance behaviour. Full list and reasoning: [`environment-simulation.md`](environment-simulation.md) §4.

---

## 3. Phase 0 — Decisions, then scaffolding

### 3.1 Decisions that must land before any pipeline code ⬜

[`cross-reference.md`](knowledge-base-stories/cross-reference.md) §1 records seven forks; **four of them bear on the MLA** (its #1, #4, #5 and #6 — the other three are PPA-side). Three further MLA decisions come from elsewhere in that document. All seven below **must be settled first**, because each changes the shape of code in Phases 2–5. Building against the wrong side of any of these is rework, not iteration.

| Decision | Source |
| --- | --- |
| D1, D3, D4, D6 | `cross-reference.md` §1, forks #1, #4, #5, #6 |
| D2 | `cross-reference.md` §3.2 (classification signal) |
| D5 | `cross-reference.md` §2, F12 (which record is the `pacs.002` trigger) |
| D7 | `cross-reference.md` §5.3 (the envelope has nowhere to carry a rejection) |

**Story mapping.** Every decision below belongs to exactly one MLA story — the one whose acceptance criteria it directly rewrites — plus, where relevant, the downstream stories (MLA or PPA) whose behaviour depends on it. Read the "Owning story" column as *"go here first when this is settled"* and "Also affects" as *"update these too, or flag them to their owner."*

| # | Decision | Owning story | Also affects | Recommendation | Why it cannot wait |
| --- | --- | --- | --- | --- | --- |
| **D1** | **Canonical-record rule** — blanket "ingest only `start`" versus the POC's per-operation table. | **US-MLA-01** — Subscribe to the Mojaloop Audit Topic. Its own acceptance criteria state the `start`-only rule verbatim; this decision rewrites that criterion. | **US-MLA-02** (Distinguish Event Types) — canonical selection runs immediately before classification, in the same pass. | **Adopt the POC's table**, plus a payload shape-check for `prepareTransfer`. Then get US-MLA-01 corrected. | The story's rule drops `commitTransfer`, `reserveFxTransfer`, `notifyFxTransfer` (all `egress`-only) **and every transfer rejection** (`prepareTransfer`/`egress`). This is the first thing built in Phase 2 and everything downstream depends on it. |
| **D2** | **Classification signal** — HTTP method + resource, or `operation`. | **US-MLA-02** — Distinguish Event Types Within the Audit Topic Stream. Its own Assumptions section is the one that proposes method+resource as primary. | **US-MLA-01** (feeds D1's canonical-selection table); **US-MLA-04** (the classification signal is also what `msgType` is derived from). | **`operation`**, corroborated by (not derived from) method/resource and signature presence. | Method+resource cannot separate `fulfilFxTransfer` (start-only) from `reserveFxTransfer` (egress-only) — both are `PUT /fxTransfers/{id}` — which is precisely the discrimination D1's table needs. |
| **D3** | **Envelope `id` scheme** — per-`eventType` (stories) or one leg-wide anchor (POC). | **US-MLA-04** — Construct a Standard Event Envelope. Its `id` acceptance criterion is the one this decision confirms or overturns. | **US-PPA-04** and **US-PPA-06** (in `cch-ppa-user-stories.md`) — PPA's per-stage idempotency and correlation-cache keys are built directly on whichever scheme wins here. | **Settled: per-`eventType`, per US-MLA-04** (Option A) — see §3.2 for the evidence. Agreed directly with PPA's owners; PPA accepts the cross-stage join this moves onto it. | Determines whether the MLA needs cross-record chaining state at all — resolved with no chaining state needed. |
| **D4** | **`msgType` cardinality and the fifth route.** | **US-MLA-04** (the `msgType` field itself) and **US-MLA-06** — Deliver Envelopes to PPA via Per-Action Endpoints (the `/TRANSFERS/NOTIFICATIONS` route lives in its Routing Table). | **US-MLA-02** (classification is what `msgType` is derived from); PPA's ingestion routes (`cch-ppa-user-stories.md`, US-PPA-01) mirror whichever route set MLA settles on. | **Two values, no `/TRANSFERS/NOTIFICATIONS`**, per the stories. | With the notification-dedup component removed and no independently-published Central Ledger event on the topic, a third value describes something that does not exist. It was load-bearing control flow in the POC — D5, settled below, is the replacement discriminator. |
| **D5** | **Which record is the final-state trigger** — `fulfilTransfer` (`start`, stories) or `commitTransfer` (`egress`, POC). | **US-MLA-02** — its own Classification Table is the one that names `fulfilTransfer`/`commitTransfer` as the TRANSFER row this decision picks between. | **US-MLA-04** (which HTTP-method signal derives `msgType` for this leg); **US-PPA-11** (in `cch-ppa-user-stories.md`) — the `pacs.002` translation and its `TxSts` table are built on whichever record and vocabulary wins here. | **Settled: `commitTransfer` (`egress`), ISO `TxSts` vocabulary (`COMM`/`RESV`) authoritative** — matches the POC. Then get US-MLA-02 corrected to name `commitTransfer`, not `fulfilTransfer`, as the TRANSFER row's terminal record. | They carry **different status vocabularies** — `fulfilTransfer` the FSPIOP `transferState`, `commitTransfer` the ISO `TxSts: "COMM"`/`"RESV"`. With `commitTransfer` as the trigger, the `TxSts` translation table is built against the ISO vocabulary, not FSPIOP's; an untranslated value would otherwise be silently accepted downstream (F10). |
| **D6** | **Payload selection** — mandatory base64 decode or select the FSPIOP form (POC). | **US-MLA-03** — Decode Base64-Encoded Transfer Payloads. Its own acceptance criteria state the mandatory-decode rule this decision rewrites. | **US-PPA-08/09/10/11** (in `cch-ppa-user-stories.md`) — every ISO field-mapping table sources from the FSPIOP form; decoding `dataUri` instead would break all four at once. | **Select the FSPIOP form**; treat decoding as available-on-demand. | Decoding `content.dataUri` yields *Mojaloop's* ISO 20022 (`IntrBkSttlmAmt.ActiveCurrencyAndAmount`, `FinInstnId.Othr.Id`) — not the FSPIOP shapes every downstream field table maps from. Following US-MLA-03 and the PPA field tables literally is internally inconsistent. Note `dataUri` is present on only 46 of 500 records. |
| **D7** | **Envelope `error` field** — add it, or make PPA re-sniff the body. | **US-MLA-04** — the envelope's field set is exactly what this decision extends. | **US-PPA-05** (in `cch-ppa-user-stories.md`) — "any error callback → `pacs.002`/RJCT" has no defined detection mechanism without it; **US-PPA-11** — the rejected-`pacs.002` builder reads this field directly. | **Add it**, as the POC did. | Without it, US-PPA-05's "any error callback → `pacs.002`/RJCT" has no defined detection mechanism, and the PPA re-implements shape-detection the MLA already did. |

**On "get the story corrected."** Several rows above, and §12's divergence register, say a story needs correcting against its decision. That correction is the BA's action on the source document (`docs - MLA/user stories/`, `docs - MLA/EPICS/…/story.md`) — already communicated to them as of this phase — not an engineering task, and not a precondition for building Phase 2. This table, not the story text, is what engineering builds against; where the two disagree, the row above wins until the story document is updated independently.

**At a glance, by story:**

| Story | Decision(s) it owns |
| --- | --- |
| US-MLA-01 | D1 |
| US-MLA-02 | D2, D5 |
| US-MLA-03 | D6 |
| US-MLA-04 | D3, D4, D7 |
| US-MLA-05 | none |
| US-MLA-06 | D4 (shared with US-MLA-04) |
| US-MLA-07 | none |
| US-PII-01, US-PII-02 | none |

### 3.2 New evidence bearing on D3

The `id`-scheme fork was recorded in `cross-reference.md` as a balanced trade-off. Verifying the tag contents across all 500 records changes that balance, and the finding is worth stating explicitly because it argues **against** the POC:

**Tag availability by operation, counted directly:**

| `operation` | Story's `id` field for its `eventType` | Present in tags? |
| --- | --- | --- |
| `postQuotes` | `quoteId` (QUOTE) | **20 / 20** ✅ |
| `putQuotesByID` | `quoteId` (QUOTE) | **18 / 18** ✅ — and it carries *no* `transactionId` at all |
| `postFxQuotes` | `conversionRequestId` (FXQUOTE) | 35 of 68 — **but exactly the `start` count**, i.e. present on every `start` record ✅ |
| `putFxQuotesByID` | `conversionRequestId` (FXQUOTE) | 14 of 28 — again exactly the `start` count ✅ |
| `prepareTransfer` | `transferId` (TRANSFER) | **19 / 19** ✅ |
| `fulfilTransfer` | `transferId` (TRANSFER) | **14 / 14** ✅ |
| `commitTransfer` | `transferId` (TRANSFER) | **14 / 14** ✅ |
| `prepareFxTransfer` | `commitRequestId` (FXTRANSFER) | **22 / 22** ✅ |
| `fulfilFxTransfer` | `commitRequestId` (FXTRANSFER) | **11 / 11** ✅ — carries no `transactionId` |
| `reserveFxTransfer` | `commitRequestId` (FXTRANSFER) | **11 / 11** ✅ — carries no `transactionId` |

**Two conclusions:**

1. **The stories' per-type scheme needs no chaining anywhere.** Every canonical record carries its own stage-local identifier directly in tags. The POC's two bounded in-process chaining maps (`quoteIdToAnchor`, `fxTransferIdToAnchor`) exist *only* because the POC promoted the anchor to `id` — and the anchor is precisely the field missing from `putQuotesByID`, `fulfilFxTransfer` and `reserveFxTransfer`. **The POC's deviation created the problem it then had to solve.** Removing it removes per-instance state that would otherwise have to be moved into a shared store before MLA could scale horizontally.
2. **`conversionRequestId` is a `start`-only tag.** Safe under both D1 candidates, since FX-quote canonical records are `start` either way — but it means an FX-quote `egress` record can never satisfy US-MLA-04's completeness check. Worth a test, not a redesign.

**The honest cost:** the per-type scheme moves the cross-stage join to PPA, which must link a `quoteId`-keyed entry to its `transactionId`-keyed one. That link is available — the `postQuotes` body carries both — but it is work PPA now owns. **D3 was not this team's to decide unilaterally, and has since been settled directly with PPA's owners: Option A (per-`eventType`), as recommended above. PPA accepts the cross-stage join.**

### 3.3 Scaffolding ✅

- [x] TypeScript + Fastify project following Tazama's `tms-service` / `event-director` conventions — layout, npm script names, `tsconfig`, ESLint flat config, Prettier, SPDX headers, `.env.template`, `Dockerfile`.
- [x] Typed configuration loaded and **validated at boot**; a missing required variable fails the process at startup, never at first use.
- [x] `LoggerService`-shaped wrapper over `pino`, so `@tazama-lf/frms-coe-lib` can be swapped in as a one-file change.
- [x] `/health/live`; `/health/ready` scoped to **instance-local state only** — Kafka connection status and (from Phase 4) tokenization-secret load. Never probes PPA.
- [x] Jest with `coverageThreshold` set to **96% on branches, functions, lines and statements** (the bar is *above* 95%, so 95.0% must fail) in the Jest config itself, so the suite fails locally at the same bar CI enforces — the floor is mechanical, never a promise someone has to remember. Lint gate at zero errors. Both wired into CI in this phase, before there is any code to be tempted to exempt. **CI platform: GitLab CI (`.gitlab-ci.yml`, repo root)** — matches this repository's actual remote (`open-frms/cch-frms/cch-mla`, self-hosted GitLab); undocumented elsewhere in this knowledge base until this line, and the POC has no CI config to carry forward.
- [x] Runs with `KAFKA_ENABLED=false` so the service starts without a broker.
- [x] The four-layer structure from [`engineering-rules.md`](engineering-rules.md) §2.1 — `interfaces/`, `services/`, `clients/`, composition root — with clients injected, never module-level singletons reached for.

**Exit criterion.** The service installs, builds, lints clean, passes an empty suite, starts, serves both health endpoints, and shuts down cleanly on `SIGTERM`. D1–D7 are recorded as decisions with rationale, in this file.

---

## 4. Phase 1 — The harness: simulate the topic

Built **before** the pipeline, because every subsequent phase's exit criterion depends on it.

- [x] `docker-compose.dev.yml` — single-node Redpanda; `topic-event-audit` created with **12 partitions**.
- [x] `tools/capture-feeder/` — [`environment-simulation.md`](environment-simulation.md) §3.1, with explicit partition assignment and every scenario flag.
- [x] `tools/ppa-stub/` — [`environment-simulation.md`](environment-simulation.md) §3.2, with envelope schema validation, JSONL recording, the fault-injection control endpoint, and mTLS against a local CA.
- [x] `tools/` README documenting how to run each scenario, and stating plainly that **offsets are not reproduced, ordering is** ([`environment-simulation.md`](environment-simulation.md) §3.1).
- [x] Curated unit fixtures lifted **verbatim** from real captures — never hand-written — covering every classification case, the partition-split transaction, the transfer rejection, the FX-quote rejection, and the party-lookup records.
- [x] Golden-file regression harness ([`environment-simulation.md`](environment-simulation.md) §3.3), with goldens for: `01_MWK_to_ZMW_PRIMARY`, `raw_topic_slice_partition2.json`, and the full 500-record export.
- [x] A named scenario library, each mapping to acceptance criteria: happy path · partition split · transfer rejection · FX-quote rejection · duplicate record · dropped record · corrupt record · missing signature · PPA 503 · PPA 4xx · PPA timeout · PPA flaky · broker restart · MLA restart · two MLA instances.

**Exit criterion — met live, [2026-09-02].** `capture-feeder` produced `raw_export_500.json` onto the local topic with all 500 records landing on their original partition numbers in their original per-partition order, verified by reading the topic back and diffing against the source (0 mismatches across all 12 partitions). `ppa-stub` accepted, validated and recorded a hand-crafted envelope (200, appended to JSONL), rejected a schema-invalid one (400), and returned every injectable fault on command. Full detail: §16.

---

## 5. Phase 2 — Ingestion path

US-MLA-01, US-MLA-02, US-MLA-03. Delivers: a record consumed from a real broker, correctly selected and classified.

- [x] Kafka consumer with **`autoCommit: false`** — the offset contract is never delegated to the client library. Explicit `advance` / `pause` / `resume`. **Done, live-verified [2026-09-02].** `KafkaClient` (`src/clients/kafka.client.ts`) extended with `subscribe`, `run`, `advance`, `pause`, `resume`; `run` always calls `consumer.run({ autoCommit: false, ... })`. `advance` does the Kafka "commit is one past the consumed offset" arithmetic in `BigInt` so a caller can never get the off-by-one wrong. 54 Jest tests (was 43), 100% coverage. Live against the real Redpanda harness: a fresh consumer group consumed all 41 records of `raw_topic_slice_partition2.json`, advanced only the first; a second process under the same group, on rejoin, did **not** redeliver the advanced record and redelivered every other un-advanced one — proving resume-from-committed-offset end to end, not just against a mock. `pause`/`resume` verified live too: consumption froze at exactly 3 records while paused (confirmed unchanged after a further 2s), resumed to completion once `resume` was called.
- [x] Dedicated consumer group ID, externally configured, with the partition-stealing rationale documented at the config site (closes R-18 from the POC's own precedent). The externally-configured, R-18-commented `groupId` has existed since Phase 0 (§3.3); this checklist item's remaining half — the group *actually joining* the topic — is what the item above just built and live-verified. The real group ID is still CCH's to issue (§13.2 unchanged).
- [x] Canonical-record selection per **D1** — a table, plus the `prepareTransfer` payload shape-check (`TxInfAndSts.StsRsnInf` present and normal transfer fields absent) that distinguishes a real rejection from a harmless duplicate. **The shape is the primary signal; the `/error` URL suffix is corroborating evidence only** — a URL string is composed by an upstream service and can change without notice. **Done [2026-09-02].** `src/services/canonical-record.service.ts` (+ `src/interfaces/audit-record.interface.ts` for the record shape) — `CANONICAL_ACTION_BY_OPERATION` and `isCanonicalRecord` ported deliberately from the POC's live-verified `logic.service.ts` (plan.md §12 V1's rule: port the "Same" rows, don't reimplement from story text), not the superseded story text. `isTransferRejection` checks `TxInfAndSts.StsRsnInf` present **and** the hallmark normal-transfer field `ilpPacket` absent, and never reads `content.url` — the shape is the only signal the code itself can act on, corroboration is left as a fact in the comment, not a second code path. 29 new tests (83 total, was 54), 100% coverage, every row of the table plus the party-lookup and no-`operation`-tag edge cases, all against real captures (`classification-cases.json`, `transfer-rejections.json`, and corridor `01_MWK_to_ZMW_PRIMARY` for the one case those two curated fixtures don't carry — `prepareTransfer`'s harmless, non-rejected `egress` duplicate). One synthetic case (both shapes at once) is clearly labeled as testing the predicate's own logic, not a real capture — no such record has ever been observed. Pure-function unit; no broker interaction, so no live-Redpanda run applies here (unlike the Phase 2 checklist's first item) — verified against real capture data instead, per engineering-rules.md §10.3.
- [x] Event classification per **D2**. Party-lookup operations recognised and explicitly skipped, with their own comment — never an accidental fallthrough. **Done [2026-09-02].** `src/services/event-classification.service.ts` — `EVENT_TYPE_BY_OPERATION` (operation alone, no method+resource fallback, per D2 against the story's own proposal) plus a three-way `ClassificationResult` (`classified` / `party-lookup` / `unclassifiable`) so party lookup can never collapse into the same `undefined` a genuine classification gap would produce. Resolves the classification table's apparent `commitTransfer` double-row ambiguity (cross-reference.md §3.2) in code: the FXTRANSFER-side commit leg's real `operation` tag is `notifyFxTransfer`, never `commitTransfer`, and `notifyFxTransfer` is non-canonical (D1) so it never reaches this function regardless — tested directly. 19 new tests (102 total, was 83), 100% coverage, every table row plus all three party-lookup operations, the no-`operation`-tag FX-quote-rejection shape, and a rejected `prepareTransfer` (still classifies TRANSFER - rejection affects `msgType`/`error` in Phase 3, not `eventType`). Verified against real captures per engineering-rules.md §10.3; pure function, no broker interaction.
- [x] FX-quote rejection detection (no `operation` tag + `StsRsnInf` present) — recognised, counted distinctly, not forwarded, per `rejected-events.md` §6 Q1's recommended default. **It must not be indistinguishable from an ordinary skipped duplicate in the logs.** **Done [2026-09-02].** `isFxQuoteRejection` added to `src/services/canonical-record.service.ts`, reusing `isTransferRejection`'s shape-check with the no-`operation`-tag discriminator (matches the POC's `isFxQuoteRejection` exactly). **Not yet wired into an actual handler** — this is a pure predicate, same as `isCanonicalRecord`/`isTransferRejection`; the "counted distinctly / not indistinguishable in logs" half of this item is a property of the per-message handler that assembles all of Phase 2's pieces, which doesn't exist yet (no `metrics`/handler module in `cch-mla` as of this entry — that assembly is the integration work still ahead once the checklist's remaining items are built). Documented explicitly in the module comment: **a caller must check `isFxQuoteRejection` before `isCanonicalRecord`**, because the record has no `operation` tag and therefore always reads as "not canonical" to the table lookup — checking canonical-selection first would swallow it into the generic skip path this item exists to avoid. 5 new tests (107 total, was 102), 100% coverage, all 19 curated FX-quote-rejection records plus the negative cases (a transfer rejection, which has the same shape but a defined `operation`, must not be double-counted as an FX-quote rejection). Verified against real captures; pure function, no broker interaction.
- [x] Payload selection per **D6**. **Done [2026-09-02].** `src/services/payload-selection.service.ts` — `selectPayload` returns `content.transformedPayload ?? content.payload`, ported deliberately from the POC's `buildEnvelope`. One fallback expression is correct for every event type without branching on `eventType`: quote-family records carry the FSPIOP form in `transformedPayload` (their own `content.payload` is Mojaloop's *own* ISO form — confirmed by inspecting a real `postQuotes` record's two bodies side by side, `CdtTrfTxInf`/`GrpHdr` vs `payer`/`payee`/`quoteId`); transfer-family records carry the FSPIOP form directly in `content.payload` and have no `transformedPayload` at all. No `data:` URI decode is implemented — D6 treats it as available-on-demand, and nothing in this pipeline names a concrete need for it yet, so building it now would be exactly the speculative abstraction engineering-rules.md §4 rules out. **Diverges from the POC on one point:** returns `undefined`, not `{}`, when neither field is present, so an empty body is distinguishable from a genuinely empty envelope rather than silently forwarded — feeds directly into the item below. 8 new tests (123 total, was 107 after fixing one incorrect test assertion), 100% statements/lines/functions, 99.27%+ branches (above the 96% gate), all against real captures.
- [x] Unreadable-record path: log, alert, advance the offset. Never retried. **Done [2026-09-02].** `src/services/audit-record-parser.service.ts` — `parseAuditRecord` is the boundary parse (engineering-rules.md §5): raw Kafka value → typed `AuditRecordBody` or a named `unreadable` outcome with a reason (empty value, malformed JSON, or a structurally-invalid record — missing/malformed `metadata.event.action` or `metadata.trace.tags`, the exact fields every later stage already dereferences unguarded). Ported from the POC's `parseAuditMessage`, extended with the structural shape check the POC only ran informally — a record missing `metadata.trace.tags` is valid JSON that would otherwise crash three layers downstream with a raw `TypeError`, not surface as a clean, named "unreadable" outcome at the point it should be caught. 8 new tests, real capture used for the success case, deliberately-malformed inputs (including the exact corruption shape `capture-feeder --corrupt` produces) for the failure paths. **What this item does not yet do: the log, alert, and offset-advance are not wired** — this is the same "pure predicate, not yet a handler" position as every other Phase 2 checklist item from #3 onward (see the note on item 5, and §7's "What comes immediately after" note added at the close of this phase). `parseAuditRecord`'s `reason` field exists specifically so the eventual handler has something concrete to log/alert with, rather than a bare boolean.

**Integration — done, live-verified [2026-09-02].** `src/services/ingestion.service.ts` (`processRecord` — the pure pipeline, parse → FX-quote-rejection check → canonical selection → classification → payload selection, one function top to bottom per engineering-rules.md §2.4) and `src/services/ingestion-consumer.service.ts` (`createIngestionHandler` — the I/O wrapper: logs the outcome, distinctly per reason, then advances the offset unconditionally, since nothing in Phase 2 yet has a reason to pause). Wired into `src/index.ts`'s `connectKafka`: connect → subscribe → `run(createIngestionHandler(...))`. 17 new tests (140 total, was 123), 100% statements/lines/functions, 98.76%+ branches.

**Live-verified against the real harness**, not just mocks: started the real built service (`node build/index.js`) against the local Redpanda with a fresh consumer group, fed `raw_topic_slice_partition2.json` (41 records) — **every one of the 41 was accounted for**: 23 `egress`, 3 `party-lookup`, 15 forwarded (5 FXQUOTE, 4 FXTRANSFER, 4 TRANSFER, 2 QUOTE), zero errors, zero unhandled exceptions. `kill -SIGKILL`'d the process, restarted it under the identical consumer group: **zero reprocessing** of the 41 already-advanced records (confirmed — no ingestion log lines emitted before new data arrived), then fed a fresh corridor (20 records) and confirmed the restarted instance consumed and correctly categorized every one of those too. This is the same resume-from-committed-offset guarantee step 1 proved at the `KafkaClient` layer, now re-proven through the real per-record handler that sits on top of it.

**Golden-file comparison — done, live-verified [2026-09-03].** `tools/golden/run-ingestion-golden.ts` (+ `npm run golden:ingestion` / `golden:ingestion:record`) is the decision-level companion to Phase 1's topic-fidelity golden: it feeds a capture straight through `processRecord` (no broker — the function is pure, and Kafka mechanics are proven separately, immediately below) and diffs the per-record outcome (`forwarded`+`eventType`+a body digest, or `skipped`+`reason`) against a checked-in baseline, per partition, position by position — the same failure class Phase 1's golden targets (a record silently stops being forwarded and nothing errors), applied to this phase's own logic rather than the topic's. Recorded against `raw_topic_slice_partition2.json` (`tools/golden/goldens/ingestion_raw_topic_slice_partition2.golden.json`, 41 decisions, 1 partition); a second, independent run diffed clean (`PASS`). The recorded tally — 23 `egress`, 3 `party-lookup`, 5 FXQUOTE, 4 FXTRANSFER, 4 TRANSFER, 2 QUOTE forwarded — matches the live per-record handler run below **exactly**, number for number, which is itself independent cross-confirmation that the golden target is trustworthy, not just self-consistent.

**Restart mid-feed — done, live-verified [2026-09-03], superseding the "restart after the feed completed" run above.** The run above killed the MLA only after `capture-feeder` had already finished producing — a valid resume proof, but not literally what the exit criterion's wording asks for. Re-run properly: `capture-feeder` fed the full 500-record `raw_export_500.json` onto a scratch topic with `--delay-partition 5=20000ms` (holding partition 5's 42 records back 20s), so the feeder was still genuinely mid-feed — confirmed by its own log not yet showing "Fed 500 record(s)" — when the MLA was `kill -9`'d 8 seconds in. At that instant the MLA had already consumed and advanced all 458 records already produced across the other 11 partitions; partition 5 had not been sent at all yet. Restarted under the identical consumer group: the new process picked up **exactly and only** partition 5 (offsets 0–41, all 42, contiguous, no gaps) — the one partition that had nothing committed for it — and nothing else, because everything else was already committed. Combined tally across both runs: 500 of 500 accounted for (19 FX-quote-rejected, 273 `egress`, 92 `party-lookup`, 49 FXQUOTE, 22 FXTRANSFER, 26 TRANSFER, 19 QUOTE forwarded), **zero** duplicate `partition+offset` pairs across the two runs' logs, **zero** unreadable/unclassifiable. This is strictly stronger evidence than the original run: it proves both halves of the guarantee separately and unambiguously — records advanced before the kill are never reprocessed, and records that did not even exist on the topic yet at kill time are picked up correctly once they arrive after restart.

**Exit criterion — live, fully met.** With Redpanda running, `capture-feeder` feeds `raw_topic_slice_partition2.json`; the MLA consumes from the real topic and, for every record, either forwards it or skips it with a *distinct, correct reason* — **proven above.** Restarting the MLA mid-feed resumes from the committed offset with no loss and no duplication — **proven above, against a genuine in-progress feed.** The golden file matches — **proven above**, and now checked in for regression.

---

## 6. Phase 3 — Envelope construction and JWS validation

US-MLA-04, US-MLA-05.

**The JWS half of this phase was removed from the implementation [2026-09-23]** (`e2e-testing/remove-JWS.md`; §16's [2026-09-23] entry). The checklist below records what Phase 3 built and verified at the time; the envelope-construction half is unchanged.

- [x] Envelope builder per **D3** (settled — Option A, per-`eventType`), **D4** and **D7**. `correlationId` freshly generated per event, **never** the Kafka message key. *(`src/services/envelope-builder.service.ts` — built, unit-tested, live-verified.)*
- [x] Completeness check: missing `msgType`, `eventType`, `id`, `fspiop-source` or `fspiop-destination` ⇒ log, advance, do not forward. *(Same file — a distinctly-named `incomplete-envelope` outcome. Built, unit-tested, live-verified.)*
- [x] Envelope ajv schema, shared verbatim with `ppa-stub` so the contract is enforced from both ends. *(`src/services/envelope-schema-validator.service.ts`, called from the pipeline after `buildEnvelope`. Built, unit-tested; live-verified as the defensive backstop it is — never observed to actually reject anything, by design, since `buildEnvelope`'s own check already enforces everything the schema requires.)*
- [x] **Real cryptographic JWS verification** — RS256/384/512, against the sending DFSP's registered public key, on every canonical record, no exemptions. *(`src/services/jws-verification.service.ts`, Node's built-in `crypto.verify`. Built, unit-tested, live-verified against locally re-signed fixtures. Genuine COMESA/DFSP signature verification stays blocked — §13.1/§14 Q1 — exactly as flagged below.)*
- [x] Configurable key store; adding a DFSP key must not require a restart. *(`src/clients/public-key-store.client.ts`, a file-backed store hot-reloaded via `fs.watch`. Built, unit-tested, live-verified — a key generated mid-session via `npm run keys:generate` was picked up by a running MLA process with no restart.)*
- [x] A **key-source outage must be distinguishable from a genuine signature failure.** Otherwise an outage manifests as "every event has an invalid signature" — the failure mode US-MLA-05 explicitly calls out. *(A distinct `key-source-unavailable` outcome/skip reason, logged without the `SECURITY` marker `invalid-signature` gets. Built, unit-tested, live-verified: pointing `JWS_PUBLIC_KEY_DIR` at a nonexistent directory made even a genuinely-valid re-signed record fail as `key-source-unavailable`, never as `invalid-signature`.)*
- [x] Missing / invalid signature ⇒ security log, advance the offset. Not retried. *(`SECURITY`-marked error log, offset advances unconditionally per Phase 2's existing behaviour. Live-verified for both missing and invalid. No real alert channel exists yet — Phase 6 — so "alert raised" is met by this `SECURITY`-marked log, not a wired alert; accepted as this phase's interim state rather than left blocking.)*

**D3 resolved.** Per-`eventType` (Option A) is the final scheme, agreed directly with PPA's owners — not a provisional default any more. `envelope-builder.service.ts`'s own comments have been updated accordingly.

**New evidence found while building the id-extraction step, correcting §3.2 above:** that table counts `conversionRequestId` present on "exactly the start count" for `putFxQuotesByID` and reads that as present on the canonical (`start`) record. Checked directly against every `putFxQuotesByID` pair in `raw_export_500.json` (14 of 14): the tag is present on the **`egress`** half, not the canonical `start` half D1 selects — the opposite of what the count alone implies. The canonical `start` record still carries the value, as the trailing segment of `tags.httpPath` (`/fxQuotes/{id}`) — confirmed to equal the sibling `egress` record's `conversionRequestId` for all 14 pairs, zero exceptions. `envelope-builder.service.ts`'s `extractId` implements this fallback; see its own doc comment.

**On the missing keys** ([`environment-simulation.md`](environment-simulation.md) §4, and §13 below): built and verified against locally re-signed fixtures — real capture bodies, signed with a keypair generated by `tools/dfsp-keys` (`npm run keys:generate`), registered live via `FilePublicKeyStoreClient`, verified with `verifyJws`. This proves the mechanism honestly. **Verification against a genuine COMESA signature stays open** — no real DFSP key is available — and every one of the 15 canonical signed records in the partition-2 slice was correctly rejected as `invalid-signature` in the baseline live run for exactly that reason.

**Exit criterion — live. Met.** Every one of the 41 records in the partition-2 slice, fed unmodified through a real MLA instance against a real broker, produced either a schema-valid envelope or a named skip reason (23 `egress`, 3 `party-lookup`, 15 `SECURITY: invalid FSPIOP-Signature` — zero unhandled). Separately: a `--resign`-ed record produced `Forwarded FXQUOTE`, and that exact envelope was POSTed over real mTLS to a live `ppa-stub` and accepted (`200`, recorded in `received.jsonl`); the same record with `--tamper-body` added failed as `invalid-signature`; `--strip-signature` failed as the distinctly-worded `missing-signature`; and pointing `JWS_PUBLIC_KEY_DIR` at a nonexistent directory produced `key-source-unavailable` for every signed record, including the one that would otherwise have verified. Full narrative belongs in §16's US-MLA-04/05 entries (pending).

---

## 7. Phase 4 — PII tokenization

US-PII-01, US-PII-02. **This has no POC precedent** — the POC's `pii-mask.service.ts` masks what reaches *logs and the audit store*, on the *PPA* side, and leaves the payload sent onward untouched by design. This phase transforms the payload itself, inside the MLA. Do not mistake one for the other.

- [x] Field classification per the Fields-to-Tokenize table, per event type. *Built, tested against real captures (`tokenization.service.ts`, `TOKENIZE_PATHS_BY_EVENT_TYPE`), live-verified — a real `postQuotes` record forwarded through both the real Kafka broker/consumer and a standalone direct-pipeline run carries `tkn_...` in `payer`/`payee.partyIdInfo.partyIdentifier` and `payer.personalInfo.complexName`; payee legal name and every other field confirmed untouched.*
- [x] **ILP-carried fields explicitly exempt** — cryptographically bound into the transfer's `condition`; rewriting them breaks the payment. *Built as a structural allowlist (no TRANSFER/FXTRANSFER row exists at all, not a per-field exclusion) — confirmed directly against real `prepareTransfer`/`prepareFxTransfer` captures (no `partyIdInfo`/`personalInfo` field present in either body; PII lives only inside the never-decoded `ilpPacket`). Live-verified: a real TRANSFER record's body reached `ppa-stub` byte-identical, same object reference, secret store never even consulted.*
- [x] Transaction amounts never tokenized, in any message — Tazama's threshold and velocity rules need them in clear. *Structurally guaranteed by the same allowlist (amount fields are never named in the table, so no code path can touch them even coincidentally) — regression-tested per event type, live-verified (`amount` reached `ppa-stub` unchanged in the live QUOTE run).*
- [x] Keyed hashing (never a bare hash — the MSISDN space is small enough to enumerate), deterministic, with a **recognizable token prefix**. *HMAC-SHA256, `tkn_` prefix (`tokenization.service.ts`). Tested against a manually-computed digest (proves keyed, not bare) and for determinism; live-verified — two fully independent runs (fresh process, secret file re-read from disk) of the same real record produced the identical token.*
- [x] Secret loaded once at startup from a mounted location; never fetched per event. **If it fails to load, the service does not report ready** — never runs unprotected while advertising health. *Built (`pii-secret.client.ts`, `health.service.ts`), tested, live-verified both directions — with the secret file removed, a genuinely running instance's `/health/ready` reported `{"status":"DOWN",...,"piiSecret":"DOWN"}` (Kafka still `UP`, proving the two signals are independent); restoring the file and restarting returned `piiSecret: "UP"`.*
- [x] **The ordering test.** A test that fails if tokenization is moved ahead of signature validation. This is a hard requirement, not a convention: the DFSP signed the event as sent, so validating against a tokenized payload fails every time. *Built as a two-sided proof in `envelope-pipeline.service.test.ts`: a genuinely-signed real record both verifies *and* ends up tokenized (proves the real bytes reached `verifyJws` before tokenization ran), and a bad signature never even reaches the secret store (a store that throws if consulted proves it). Live-verified the same property against the real broker: a `--resign`-ed real record produced `Forwarded QUOTE` through the genuine Kafka-driven pipeline.*
- [x] Tokenization-failure metric and alert, distinct from any other failure counter. *Deferred to Phase 6 at the time this story was built (the interim structured-log line was the placeholder) — now built and live-verified there: `mla_tokenization_failures_total` (metric) and the `tokenization-failure` alert type (`raiseTokenizationFailureAlert`, `plan.md` §9's own exit-criterion entry, closed [2026-09-08]).*

**Exit criterion — live. Met**, against the fail-closed default (`plan.md` §7.1 #1). A real capture record (`postQuotes`, re-signed) flowed through the full pipeline via a genuinely running MLA instance against the real harness broker (`Forwarded QUOTE`, live log); a dedicated checked-in tool (`tools/verify-tokenization/run.ts`, `npm run verify:tokenization`) independently proved, over real mTLS against a real `ppa-stub`: prefixed tokens in every listed QUOTE field, the identical token across two independent runs, the amount reaching `ppa-stub` in clear, and a TRANSFER record's body reaching `ppa-stub` with zero fields altered. Reordering the pipeline's two calls breaks the ordering test. Full narrative: §16's US-PII-01/US-PII-02 entries and `EPICS/EPIC-PII-tokenization/`.

**Update [2026-09-04, gate item #1]:** the fail-mode wiring described above (skip once, log, advance) is what this exit criterion was met against - COMESA has since answered (§7.1 #1, verbatim) and the wiring now built matches that answer instead: a `pii-secret-unavailable` outcome is transient (retry, park, feed a breaker, offset withheld), not permanent. Built, tested, and live-verified - §16's own new US-PII-01 entry (dated the same day, appended after the original per §16's append-only rule) carries the full narrative; nothing above is edited to match it in place, per the documentation register's "no revision history in prose" rule read together with §16's own append-only rule for *this specific section*, which is a progress log by design.

**Open before go-live (does not gate this phase's own closure, per §7.2/§13.2):** what "protected" must legally mean, and named ownership of the secret. Both are CCH decisions — §13.

**Phase 4 is formally closed [2026-09-22].** Both decisions that §7.2 named as the actual bar for closure are answered: gate item #1 (fail-mode) was built, tested, and live-verified [2026-09-04]; gate item #2 (secret rotation) is resolved [2026-09-18, spec confirmed 2026-09-22] — COMESA reversed its earlier "versioned keys" direction to a long-lived, non-rotating key (rotation would break Tazama's own fraud-rule matching on the same MSISDN/bank-account values across transaction history), needing no build, since `FilePiiSecretClient`'s existing design already matches it. The one exit-criterion checklist item this story itself left as built-only-as-an-interim-log (the tokenization-failure metric/alert, above) was subsequently built and live-verified as part of Phase 6's own closure [2026-09-08] — carried forward here rather than re-verified, since it was already proven live under that phase's own exit criterion. `EPICS/EPIC-PII-tokenization/` executive-summary/file-register documents are updated and current as of this closure — see §16's new closure entry for the full record. **What remains open (§13.2, "gates production, not the work ahead"): what "protected" must mean legally, and named ownership of the secret — CCH decisions that gate go-live, not this phase's completion.**

### 7.1 The four open decisions — recommendations

Raised with the COMESA/CCH team via the BA team, in parallel with building the mechanism.

| # | Decision | Who | Blocks starting Phase 4? | Recommendation | **COMESA's answer** |
|---|---|---|---|---|---|
| 1 | **Fail-mode** — block the event or pass it through unprotected if tokenization fails | CCH | No — but §13.1 lists it as gating *calling Phase 4 complete*. | **Build fail-closed (block) as the default, take it to CCH as the recommendation, not an open blank.** Treat a per-event tokenization failure as a permanent failure in the same four-way classification MLA already uses — log as a security event, alert, advance the offset without forwarding to PPA. This is exactly the posture Phase 3 already took for JWS failures ("advance the offset without retrying"), so it's not a new category, just a consistent extension. Pass-through-unprotected means raw MSISDNs/names leave the Mojoloop boundary into a regulated cross-border pipeline *before* Legal has even settled whether that's lawful (#3 below is still open) — that's an asymmetric risk: fail-closed costs a paused event you can replay from the 7-day-retention topic; fail-open costs a PII disclosure you cannot un-send. Make it a config flag either way, so CCH's eventual answer is a flip, not a rebuild. | **Received [2026-09-04]: "If tokenization fails, fail the transaction and retry."** Confirms fail-*closed* (agrees the event must never forward unprotected) but names **transient, not permanent** — engineering-rules.md §6.1's *other* category, the one PPA 5xx/timeout already uses (retry, offset not advancing, feeds the breaker), not the one this phase actually built (`pii-secret-unavailable` is currently classified **permanent** — skip, log, no retry). **This is a real code change, not a wiring flip**: the current implementation does not yet match this answer. Retry count/backoff and post-exhaustion behaviour for *this specific* retry were not specified — recommend mirroring the existing MLA→PPA shape (3×, 1s/2s/4s, park+breaker at N) for consistency rather than inventing a second, distinct retry policy, but this should be confirmed with COMESA, not assumed. **Implemented [2026-09-04]** — mirroring the recommended MLA→PPA shape exactly (3 retries, 1s/2s/4s backoff, breaker N=5, all independently configurable), built, tested, and live-verified against the real harness. `plan.md` §16's original US-PII-01 entry stays exactly as written (append-only); a new, later entry (same section, dated the same day) documents this change in full. |
| 2 | **Secret rotation strategy** — version old+new tokens, or drain in-flight correlation before rotating | CCH | No — only one active secret is needed to build the tokenizer itself. | **Recommend versioned keys, not drain-first, and say so when raising it.** Drain-first assumes a clean point where nothing is mid-correlation — but the system already has parking-before-TTL-expiry and out-of-order arrival by design, so a guaranteed-clean drain point may never actually exist, and "wait for full drain" on an always-on switch component is an availability risk for no good reason. Versioning is the standard shape for keyed-hash rotation (same idea as a JWT `kid`): keep the current key plus however many prior keys are still inside the max correlation/parking TTL, tag each token's existing recognizable prefix with a key-version marker, always tokenize new values with the current key, and accept a match against any still-active version. Retire a key once it's older than the longest correlation window it could still be needed for. No downtime, no silent correlation misses. | **Reversed [2026-09-18], `docs/meetings and emails/tokenization-feedback.md`.** COMESA's [2026-09-04] answer (below, kept for the record) initially confirmed versioned keys — but George Murage then identified that the same MSISDN/bank-account values tokenization protects are also matched by Tazama's own fraud rules across transaction history, so rotating the key would break every rule that relies on matching a source/destination identifier across an interval. **Both sides confirmed a long-lived, non-rotating key instead**: "we have decided to not rotate the key" (Murage); "we agree with the long-lived key approach. It is what we'll require" (Ansari). A concrete spec followed [2026-09-22]: HMAC-SHA-256, a 256-bit (32-byte) base64-encoded key, held in a Kubernetes Secret named `cch-mla-pii-secret` — confirmed acceptable the same day. **No rotation mechanism is now needed** — `FilePiiSecretClient`'s existing single-active-key, restart-to-change design already matches this shape exactly; nothing to build. Full narrative: `plan.md` §16's own entry, "US-PII-02 — gate item #2 reversed" [2026-09-22]. **Superseded answer, kept for context only:** "We don't want to be holding the system up while it drains, so we should version. But we should also code for success: try the existing key, then have a failure route which looks for and applies new keys." [2026-09-04] — this named a mechanism shape (a reactive pickup path, trigger genuinely ambiguous) that no longer applies now that rotation itself is off the table. |
| 3 | **What "protected" must mean legally** — reversible-by-lookup vs. reversible-only-with-the-secret | CCH Legal | No — mechanism is built and live-verified against a locally-generated secret regardless of the answer. | **Flag a conceptual gap in the question before Legal answers it, don't just relay it as-is.** US-PII-02 already commits to *keyed hashing*, and a keyed hash is one-way by construction — it can verify a candidate value matches, but the secret does not let you invert a token back to the original value. So "reversible-only-with-the-secret" isn't actually an available option for what's already been designed; the real choice is "non-reversible" (what a hash gives you today) vs. "a genuinely reversible mechanism" (which means a separate secure token→value lookup store, or swapping the primitive to reversible encryption — a materially different build, not a flag on this one). Build to the committed design — non-reversible, verify-only — and don't speculatively build a lookup store (same "don't build it speculatively" principle already applied to the ILP decoder). Take the question to Legal framed precisely: *if an authorized investigation needs to look up an original MSISDN from a token, that capability does not exist in the current design and would be new, separate infrastructure* — so Legal isn't unknowingly signing off on a lookup capability that was never actually built. | Still open. |
| 4 | **Named ownership of the production secret** — who holds it, who rotates it, on what schedule | CCH | No — same as #3; §13.2 files it under "gates production, not the work ahead." | **No technical basis to name a team, but recommend the pattern: whoever already owns Phase 3's MLA-side credential material (the mTLS client certs, the DFSP public-key mounting) should own this too, rather than standing up a separate ownership track for one more secret.** It's the same operational shape — mounted at startup, rotated on a schedule, never fetched per event, gates readiness on load failure — so splitting ownership across two teams for materially the same kind of artifact just adds a coordination seam with no corresponding benefit. Raise this as a recommendation to confirm, not a blank to fill. | Still open. |

One pattern across all four: #1 and #2 have real engineering defaults to build against today, revised only if CCH's answer differs; #3 and #4 are genuinely theirs to decide, but in both cases the sharpest move is handing them a more precise question than the one currently on paper, not just forwarding it unchanged. **#1 is answered and implemented, tested, and live-verified [2026-09-04, gate item #1 — §16's new US-PII-01 entry]. #2 is answered and closed [2026-09-18, spec confirmed 2026-09-22] — the direction reversed from the recommendation (no rotation, a long-lived key) and needs no build, since `FilePiiSecretClient`'s existing shape already matches it — §16's "US-PII-02 — gate item #2 reversed" entry has the full narrative.**

### 7.2 Does this block finishing Phase 4?

Three of the four don't block finishing Phase 4 at all — the fail-mode one is the actual blocker, and only for calling the phase formally done, not for building it.

There are really three different bars here, and each question sits at a different one:

**Can we build and live-verify the mechanism?** Yes, all four, with zero answers needed. Nothing about the tokenizer, the ordering test, the readiness coupling, or the failure metric depends on any of these questions — we build against a locally-generated secret and a single active key, same posture Phase 3 already took toward genuine DFSP keys.

**Can we formally close Phase 4** (the §16 entry, the exit criterion, the epic docs)? This is where it splits:

- *Rotation strategy, the legal meaning of "protected," secret ownership* — none of these gate closing the phase. §13.2 files all three under "gates production, not the work ahead" — they matter before this goes live in COMESA, but the phase itself can be built, tested, and closed out without them. State plainly in the phase writeup that they're still open.
- *The fail-mode decision* — this one's different. §13.1 says it explicitly: "PII fail-mode undecided → Phase 4 cannot be called complete." The reason is specific, not just caution: the final wiring — does a tokenization failure advance the offset and forward a degraded envelope, or skip and alert — is a real branch in the code, and shipping the fail-closed default silently, without saying it's provisional, would misrepresent what is being claimed as "done." Everything up to that wiring decision can be built and live-verified — the mechanism itself doesn't care which way it's wired, it's a one-line branch — so almost the entire phase proceeds. Only the very last step, and the honesty of the exit-criterion writeup, waits on CCH.

**Practically:** Phase 4 can reach roughly built-and-verified-in-full — mechanism built, tested, live-verified against the fail-closed default — without hearing back from anyone. What cannot happen honestly is stamping it *complete* and moving to Phase 5 while that one wiring decision is still open; instead it gets recorded as "built and verified against the recommended default, wiring decision pending CCH." Not a hard stop on the work — a hard stop on saying it's finished.

**Update [2026-09-04]: CCH has now answered — §7.1 #1 — "fail the transaction and retry."** This changes the *nature* of what's still open, not the closure status: the wiring decision itself is no longer a blank, but the code does not yet implement it (the built default is a permanent skip; the answer calls for a transient retry, engineering-rules.md §6.1's other category). Phase 4 remains not formally closed — not because CCH hasn't spoken, but because the codebase hasn't caught up to what they said yet. This is a smaller gap than before (an answered question with a pending code change, not an open question), but it is still a gap, and this document says so rather than treating "CCH answered" as equivalent to "the phase is done."

**Update [2026-09-04, same day, gate item #1 done]: the codebase has now caught up.** `pii-secret-unavailable` is transient (retry, park, feed a breaker) per COMESA's answer, built, tested above the coverage gate, and live-verified against the real harness — §16's new US-PII-01 entry has the full narrative. Phase 4 is *still* not formally closed: gate item #2 (secret rotation, §7.1 #2) remains genuinely open — COMESA answered the headline question (versioned keys) but the answer's own mechanism ("a failure route which looks for and applies new keys") names a trigger that does not map cleanly onto a tokenizer that only ever writes tokens and never checks one, and that ambiguity needs asking back, not guessing at. One CCH decision away from formal closure, same as before this update — just a different one.

---

## 8. Phase 5 — Delivery, offsets, and resilience

US-MLA-06, US-MLA-07. This is the phase the harness was built for.

- [x] Endpoint selection by `eventType` per **D4**. *Built, tested, live-verified — `ppa-routing.service.ts`'s `resolvePpaEndpoint`, a pure `Record<EventType, string>` table (exhaustive by construction over the closed `EventType` union). Now wired into the consumer, via `HttpsPpaClient.deliver`'s own use of it — this checklist's own "offset advances only on HTTP 200" item, below.*
- [x] mTLS client configuration; stable service-name addressing, never individual replicas. *Built, tested, live-verified — `HttpsPpaClient` (`ppa.client.ts`), the `PpaClient` port's only implementation. Certs and `baseUrl` read once at construction, never per-call; addresses PPA via one parsed host/port, never a replica address. Classifies the raw response into `success`/`client-error`/`server-error`/`tls-handshake-failure`/`network-error`/`timeout`. Live-verified against a real, running `ppa-stub`, all four real outcomes plus the unreachable-host case, including a genuinely rejected client cert against a real `rejectUnauthorized: true` server — this specific live run is what found and corrected a real defect in the TLS-handshake-failure classification itself (see `ppa.client.ts`'s own comment on `classifyTransportError`: a text/code heuristic, then a naive "did secureConnect fire" heuristic, were each tried and each live-disproven before the shipped TCP-connected-only signal). Retry and offset-gating are **not** built in this class — separate checklist items, deliberately; both are `ingestion-consumer.service.ts`'s own job, below.*
- [x] Per-call timeout, configured **independently** of the retry budget. *Built, tested, live-verified — `HttpsPpaClient.deliver` races an `AbortController`-driven `setTimeout(this.timeoutMs)` against the request (armed across both the wait for headers and the body drain), classifying a breach as its own `{ outcome: 'timeout', timeoutMs }` result rather than folding it into `server-error`/`network-error` — the same "preserve the underlying reason" treatment `tls-handshake-failure` already gets (engineering-rules.md §6.2), distinguished from a real transport failure by tracking the timer's own firing directly (`stage.timedOut`), not by parsing `err`'s code/message. `PpaConfig.timeoutMs` was already independent of `maxRetries`/`retryBaseMs`. **Live-verified** against a real, running `ppa-stub` set to hang forever (`POST /control {mode:"timeout"}`): four real HTTPS requests landed roughly 2000ms apart before each retry's own backoff, confirming the 2000ms budget is enforced per call, not accumulated across the burst.*
- [x] **Offset advances only on HTTP 200.** Nothing else. *Built, tested, live-verified — `createIngestionHandler` (`ingestion-consumer.service.ts`) calls the injected `PpaClient.deliver` for every `forwarded` outcome and advances the offset only on `{ outcome: 'success' }`. A transient result is retried in place first (below); a permanent result (4xx) logs the full envelope and advances immediately, never retried; a still-transient result once the retry burst is exhausted parks the event and hands off to a per-partition breaker/reprobe cycle (below) — the full three-way classification `core-knowledge.md` §3.5's own table describes, all of it built. `HttpsPpaClient` is constructed and injected at the composition root (`index.ts`). **Live-verified against a real, running `ppa-stub` and a real broker**, re-signed real records over several fault-injection rounds (timeout, persistent 503, 4xx, a genuinely untrusted client cert): every non-200, non-permanent outcome left the offset unadvanced and the partition paused (`kafkajs`'s own "Pausing fetching" log each time). Two independent recovery paths proven live: a full restart against a still-paused partition redelivered the exact same parked offset (proven twice, before the reprobe mechanism below existed); once the reprobe mechanism was built, restoring `ppa-stub` health **resumed the same parked partition automatically, with no restart at all** (full detail in the retry/breaker items below) — nothing lost or duplicated either way.*
- [x] 5xx / timeout / TLS-handshake failure ⇒ retry ×3, exponential backoff **with genuinely random jitter**, offset not advancing. *Built, tested, live-verified — `runPpaRetryBurst` (`ingestion-consumer.service.ts`), mirroring the PII secret's own `runRetryBurst` (`plan.md` §7.1 #1) in the other direction: up to `PpaConfig.maxRetries` further attempts (default 3) beyond the one already made, backoff via the same `computeBackoffMs` under 1s/2s/4s ceilings plus genuine jitter (`retry-backoff.service.ts`, unchanged), offset withheld throughout. **`network-error` is retried in this same bucket too, alongside the three the story names explicitly** — a reasoned default, not a guess: nothing in the story or engineering-rules.md §6.1 calls a bare connection failure permanent, and treating PPA being completely unreachable as *more* final than a mere 5xx would be the exact silent-data-loss failure mode this mechanism exists to prevent. Flagged here to raise back to CCH/COMESA if a future FSD revision says otherwise, not buried in behaviour. The loop re-checks transience every attempt, not just a counter, so a retry that itself turns permanent stops the burst immediately rather than spending remaining attempts on it. **Live-verified twice, against real HTTP round-trips to `ppa-stub`:** a hung connection produced 4 real requests with visibly different waits between them (2739ms, 3943ms, 2772ms, each comfortably inside its own 1s/2s/4s-plus-timeout ceiling); a persistent 503 produced 4 real requests with visibly different, much smaller backoff-only gaps (864ms, 1417ms, 1508ms, each under its own 1s/2s/4s ceiling) — proving the jitter is genuinely sampled per attempt, live, not merely unit-tested with a mocked clock.*
- [x] TLS handshake failure treated as transient, **with the underlying reason preserved in the alert** so a certificate misconfiguration stays distinguishable from ordinary unavailability. *Built, tested, live-verified — a `tls-handshake-failure` result is retried by the same `runPpaRetryBurst` as a 5xx (R-22, US-MLA-06's own AC), and `describePpaFailure`'s own `tls-handshake-failure` branch names the handshake and its reason specifically, never folded into a generic 5xx message, wherever the park/reprobe alert wording uses it. **Live-verified with a genuinely untrusted client cert** (a throwaway, unrelated self-signed CA, not the harness's own) presented to the real, running `ppa-stub` (`rejectUnauthorized: true`): the connection reset with "socket hang up" exactly as `classifyTransportError`'s own comment predicts, was retried through the full burst, and the resulting alert named the handshake specifically, never a generic "HTTP 5xx." Restoring the correct client cert and restarting redelivered and forwarded the same parked record cleanly.*
- [x] 4xx ⇒ log the full envelope, alert, advance. Permanent. *Built, tested, live-verified — `logPpaPermanentRejection` (`ingestion-consumer.service.ts`) logs the full serialized envelope (not just its id/eventType — US-MLA-07's own AC wording), and the caller advances the offset immediately, never pausing, never retrying (`isPpaTransient` excludes `client-error` from `runPpaRetryBurst`'s own loop). Reached identically whether the very first delivery attempt is a 4xx or a retry turns permanent mid-burst. **Live-verified**: a real 4xx from `ppa-stub` produced exactly one delivery attempt and `PPA rejected the envelope at partition 2 offset 497 with HTTP 400 - permanent, advancing. Envelope: {...}` — the full envelope in the log line, including its tokenized fields (`tkn_...` prefixes visible, live confirmation Phase 4's tokenization survives this path unchanged) — with no pause and no retry.*
- [x] **Retry exhaustion and circuit breaking as two coordinated mechanisms, not one.** Exhaustion parks the event and keeps retrying it; those failures accumulate toward a **configurable N**; at N the breaker trips and pauses the partition, re-probing on a timer. *The POC collapsed these into one and had no threshold on the MLA side at all* — §12. *Built, tested, live-verified — `parkAndReprobePpa` (`ingestion-consumer.service.ts`) parks the event and pauses the partition on burst exhaustion, feeding `PpaCircuitBreaker` (`ppa-circuit-breaker.service.ts`) — **one independent counter per partition**, not process-wide like the PII secret's own breaker (a reasoned scope decision, `plan.md` §16's US-MLA-07 entry has the full argument; flagged to confirm with CCH/COMESA, not silently assumed). The shared counting primitive (`CircuitBreaker`, `circuit-breaker.service.ts`) was generalized out of the PII-only class that previously existed, rather than duplicating a verbatim state machine for PPA. **Live-verified**: a persistent 503 against a real running instance produced the park alert, then, after four further failed reprobes, exactly one `Circuit breaker tripped for partition 2: 5 consecutive PPA delivery failures` (confirmed not repeated across further continued failure) and kafkajs's own `Paused partition 2`.*
- [x] Every pause paired with a re-probe that can resume it. A partition paused with no path back is the bug the POC's own breaker existed to fix. *Built, tested, live-verified — `parkAndReprobePpa`'s own detached reprobe loop, on `PPA_REPROBE_INTERVAL_MS`, resolves a reprobe three ways (success, a `client-error` surfacing now that PPA is reachable again — itself proof of connectivity, so it resumes and resets the breaker exactly like a success does — or still transient); an offset-advance failure on a recovered reprobe retries the commit on the next tick rather than a bespoke policy; an unhandled exception inside one reprobe tick is caught, logged, and does not stop the loop. **Live-verified, and this is the one this whole mechanism exists to prove**: restoring `ppa-stub` to healthy after a tripped breaker — **with no process restart at all** — produced, on the very next reprobe tick, `PPA recovered at partition 2 offset 498 - circuit breaker reset, resuming partition 2`, `Forwarded QUOTE (id=01KZRP0MH81MYFTW7PH0S9SYF2) at partition 2 offset 498`, and kafkajs's own `Resumed partition 2` — the exact parked record, nothing lost or duplicated, recovered entirely on its own. Per-partition isolation (one partition's own trip never affecting another) is unit-verified only — the one real capture fixture in this repo is entirely partition 2, so a live multi-partition run would need fabricated data; judged not worth trading the "use real captures" discipline for, given the isolation logic itself is a simple, pure per-partition `Map`.*

**Exit criterion — live. Met [2026-09-07].** Against `ppa-stub`: a 503 leaves the offset unadvanced and the event is redelivered on recovery ✓ (proven both ways — restart-based before the reprobe mechanism existed, then automatic once it did); three 5xx responses produce three backed-off retries with visibly different jitter ✓ (864ms/1417ms/1508ms, live); N consecutive failures trip the breaker and pause consumption ✓ (5 consecutive, live, logged exactly once); restoring the stub resumes from the paused event with nothing lost or duplicated ✓ (live, with no process restart); a 4xx advances immediately ✓ (live, full envelope logged); a TLS handshake failure retries and its alert names the handshake, not a generic 5xx ✓ (live, genuinely untrusted cert). Full narrative: `plan.md` §16's US-MLA-06/US-MLA-07 entries.

### 8.1 Pre-work decisions

Four items were flagged before starting this phase's build. None are CCH/COMESA decisions this time — three are engineering defaults, decided here rather than left as open blanks, and the fourth is a deployment-only concern with no build action attached. Recorded so they can be raised against later if anyone questions the values, not because any of them blocks starting.

| # | Decision | Decided value | Reasoning |
| --- | --- | --- | --- |
| 1 | **MLA→PPA per-call timeout** (`PPA_TIMEOUT_MS`, FSD Open Item #1 — still formally unagreed with CCH/Paysys) | **2000 ms**, replacing the scaffolding-era placeholder default of 5000 ms | An mTLS call between two adaptor services on what is presumably the same internal network deserves a timeout bounded well under a second-scale user-facing budget, not a generous public-internet allowance. 2s absorbs a GC pause or a brief blip without masking a genuinely hung connection, and keeps the worst-case latency of a full 3-attempt retry sequence (2s timeout × up to 3 attempts, plus 1s/2s/4s backoff between them ≈ 13s worst case) in a range that is slow but not absurd — the current 5000 ms default would push that same worst case past 25s. Still fully configurable (N6); this changes the *default*, not the mechanism, and is a one-line flip if CCH/Paysys agree a different value once asked. |
| 2 | **Circuit-breaker trip threshold N** (consecutive failures before the breaker trips and pauses the partition) | **5** | The story only ever says "configurable," implying no number was ever meant to be load-bearing on its own. 3 is twitchy — a short, ordinary run of transient blips (a deploy, a brief network hiccup) could trip the breaker over noise, not a genuine outage. 10 is slow — ten consecutive fully-exhausted events (each already having absorbed 3 retries of its own) means real, sustained unavailability goes undetected for a long time before the protection this mechanism exists for actually engages. 5 sits between the two: enough consecutive failures to be confident this isn't noise, not so many that detection lags meaningfully behind a real outage. Configurable, per the story; this is the default. |
| 3 | **Offset-advance-on-permanent-failure policy** (FSD Open Item #8 — still formally unagreed) | **Build to the documented default: a permanent failure (4xx, malformed envelope) advances the offset, never retried.** User-confirmed [2026-09-04]. | Matches the story text exactly and the same posture already applied everywhere else in this codebase (a permanent failure is, by definition, one retrying cannot fix). The 7-day audit-topic retention is the safety net if this default ever proves wrong for a specific case — the same backstop already relied on for every other permanent-failure path in Phases 2–4. |
| 4 | **Dedicated Kafka consumer group ID** (R-18 — the one misconfiguration in this system capable of affecting live payments) | **No action — deployment-only, not a build concern.** User-confirmed [2026-09-04]. | The placeholder (`cch-mla-ingestion`) is harmless for local/harness work; a real, dedicated ID has to be issued by CCH before any real deployment, not before writing this phase's code. Recorded here so it stays visible rather than forgotten between now and whenever deployment planning actually starts. |

---

## 9. Phase 6 — Observability and operability

- [x] Structured logging (`pino`) with `correlationId`, `eventType` and pipeline step on every line. *Built, tested, live-verified [2026-09-08].* `Logger`'s port signature (`logger.interface.ts`) now takes a `LogContext` (`correlationId`/`eventType`/`serviceOperation`) instead of a bare string, spread onto pino's merging argument (`logger.client.ts`); every call site in the codebase updated. `ingestion-consumer.service.ts`'s own blanket `serviceOperation: 'ingestion'` is now five granular pipeline-step values (`ingestion.classification`/`.jws`/`.envelope`/`.pii`/`.ppa-delivery`/`.unhandled`). Two real defects this retrofit found and fixed, not merely plumbed around: (1) `envelope-pipeline.service.ts` was silently dropping `eventType` on six of its own skip reasons even though classification had already resolved it — a plumbing gap, now closed via an optional `eventType` field on `EnvelopePipelineOutcome`'s `skipped` branch (deliberately still absent for Phase 2's own five reasons, where it is genuinely unknown); (2) `PiiUnavailableOutcome`'s `Extract<SkippedOutcome, {reason:'pii-secret-unavailable'}>` silently resolved to `never` (`Extract` does not distribute over a single object type whose field is a union, only over a real union of shapes) — latent since nothing previously read a property off the narrowed type; surfaced as a compile error by this phase's own `.eventType` access, fixed via intersection instead. 308 tests, 100%/98.01%/100%/100% coverage, zero lint errors. **Live-verified** against the real harness (Redpanda + `ppa-stub`, `raw_topic_slice_partition2.json`, both LOG_LEVEL info/debug): all 41 records accounted for — 26 `ingestion.classification` skips (correlationId present, eventType correctly absent) and 15 `ingestion.jws` failures (both correlationId **and** eventType populated, e.g. `eventType":"FXQUOTE"` on a live `SECURITY: invalid FSPIOP-Signature` line) — the exact gap this item closes, proven on real captured data. Full narrative: `continue/continue - before phase 6.md` §5.
- [x] Metrics for every question an operator must answer without a debugger. *Built, tested, live-verified [2026-09-08].* `prom-client` (chosen explicitly over its pre-1.0, low-adoption designated successor `@prometheus-io/client`) behind a named-method `Metrics` port (`metrics.interface.ts`, mirroring `Logger`'s own shape) and adapter (`clients/metrics.client.ts`, the sole importer). All ten signals live: `mla_skipped_total{reason}`, `mla_rejected_total{reason}`, `mla_tokenization_failures_total`, `mla_forwarded_total{event_type}`, `mla_ppa_delivery_outcomes_total{outcome}` (per HTTP round trip, retries included), `mla_pii_breaker_state` (one gauge) and `mla_ppa_breaker_state{partition}` (one **per partition** — the two breakers' real, deliberately different shapes), `mla_partition_paused{partition}` (this codebase's own stated reading of US-MON-01's undefined "paused-offset-rate" term), `mla_consumer_lag{partition}` (broker high-water mark minus this consumer group's own **committed** offset, polled via a separate admin connection — deliberately not in-memory fetch position, since N1 lets that run ahead of what is durably processed), `mla_ack_latency_ms` (histogram, US-PERF-01's literal Kafka-consume-to-PPA-200 definition). `/metrics` (`fastify.client.ts`) serves Prometheus text-exposition format alongside `collectDefaultMetrics`. 339 tests, 100%/97.97%/100%/100% coverage, zero lint errors. **A real, live-consequence bug found and fixed while wiring `mla_forwarded_total`**: a record recovering from a PII-secret park previously advanced the offset and logged "Forwarded" **without ever calling `ppaClient.deliver`** — silently skipping PPA delivery entirely on that one recovery path, undetected because no test asserted `deliver` was called there. Fixed by factoring delivery/retry/park into one shared `resolveOutcome` used by both a fresh record and a PII-recovered one, plus a second fix (only resume the partition once `resolveOutcome` confirms the record actually settled, not before) for a related pause/resume race the first fix's own naive version would have introduced. **Live-verified** (Redpanda + `ppa-stub`, a genuinely re-signed real record, real mTLS): PII secret removed → record parks, breaker trips (`eventType":"QUOTE"` on both log lines); secret restored, restart under the identical group (the one PII-recovery path actually exercisable live — `FilePiiSecretClient` has no hot-reload, the same named limitation gate item #2 has carried since Phase 4) → the recovered record **genuinely reached `ppa-stub` over real mTLS** (`received.jsonl` gained it). `/metrics` immediately after: `mla_forwarded_total{event_type="QUOTE"} 1`, `mla_ppa_delivery_outcomes_total{outcome="success"} 1`, `mla_ack_latency_ms_sum 34` (well inside budget), `mla_rejected_total{reason="invalid-signature"} 6`, `mla_skipped_total` correct by reason, `mla_pii_breaker_state 0`, real `mla_consumer_lag{partition="N"} 0` for all twelve partitions from the live broker's own admin API. Full narrative: `continue/continue - before phase 6.md` §5.
- [x] **A metric for every decision the code makes silently.** *Verified complete as a byproduct of the item above, [2026-09-08] — not separate work.* Every MLA-side skip/rejection reason `core-knowledge.md` §9's own table names now has exactly one counter, unconditionally, including the debug-level structural skips (`egress`/`party-lookup`) never logged above debug. Swept for gaps deliberately; none found.
- [x] Alert paths wired for: missing/invalid signature, 4xx, retry exhaustion, breaker trip, tokenization failure. *Built, tested, live-verified [2026-09-08].* An `Alert` port (`alert.interface.ts`, five named methods — `raiseSecurityAlert`/`raiseRejectionAlert`/`raiseRetryExhaustionAlert`/`raiseBreakerTripAlert`/`raiseTokenizationFailureAlert` — mirroring `Logger`/`Metrics`'s own established shape, not a generic `raise(type, severity, message)` dispatch) and its adapter (`clients/alert.client.ts`, `WebhookAlertClient`, the sole importer of `fetch` for this purpose). **Two sinks, both real, R-37's own routing/destination question left genuinely open rather than guessed:** a metrics-based sink (`mla_alerts_total{type,severity}`, always active — the standard shape a Prometheus/Alertmanager rule watches directly, needing no destination decided to exist) and an optional webhook sink (`AlertConfig.webhookUrl`, unset by default, fire-and-forget with an `AbortController`-bounded timeout, never throwing into the pipeline on delivery failure). Severity follows `engineering-rules.md` §6.2's "parked vs dead" distinction: `informational` for a retry-exhaustion park and a tokenization-failure attempt (a degrading signal), `failure` for a security event, a permanent rejection, and a breaker trip (the systemic escalation) — `logTripIfJust` raises the breaker-trip alert on the exact same `justTripped` gate its log line already used, never repeated on a still-tripped reprobe. Wired at exactly the five points `ingestion-consumer.service.ts`'s own module comment previously marked "not claimed as a wired alert"; `key-source-unavailable` deliberately raises none of these, unchanged from before — an infrastructure fault, not a security event or one of the five named conditions. **A genuine SRP split, not just line-count avoidance:** the "how a resolved outcome is logged/metered/alerted" dispatch (`logIngestionSkip`, `logEnvelopeSkip`, `logPpaPermanentRejection`, `describePpaFailure`, `logTripIfJust`, `logResolvedOutcome`, `LogDeps`) moved to a new sibling module, `services/ingestion-outcome-logging.service.ts`, once this item's own wiring pushed `ingestion-consumer.service.ts` past ESLint's `max-lines` gate — a pure relocation (no behaviour change), separating that leaf dispatch from the retry/park/breaker *orchestration* that decides the outcome in the first place, which stays in `ingestion-consumer.service.ts`. 354 tests (12 new in `alert.client.test.ts`, the rest extending existing suites with real `alert.raise*` assertions rather than only wiring a fake through), 100%/98.06%/100%/100% coverage, zero lint errors. **Live-verified**, all five conditions, against the real harness (Redpanda + `ppa-stub`, genuinely re-signed real records, real mTLS) — not asserted only in a unit test: a stripped/mismatched signature raised `mla_alerts_total{type="signature",severity="failure"}` (14, then 116 across the exit-criterion run below); a genuinely re-signed `postQuotes` record tokenized and delivered to `ppa-stub` in forced `4xx` mode raised `{type="rejection",severity="failure"}` (1), the log line and the alert payload both present, the alert payload deliberately carrying only identifying fields, never the full envelope the log line carries (N7 extended to the alert sink); `ppa-stub` forced to `503` with `PPA_CIRCUIT_BREAKER_THRESHOLD=1`/`PPA_MAX_RETRIES=0` raised both `{type="retry-exhaustion",severity="informational"}` and `{type="breaker-trip",severity="failure"}` on the very first delivery attempt, and the parked record was later observed delivering automatically once the fault was cleared — no restart, the same restart-free recovery Phase 5 first proved; the PII secret file removed at startup (`FilePiiSecretClient` has no hot-reload, the same named limitation carried since Phase 4) raised `{type="tokenization-failure",severity="informational"}` (4, one per attempt) and, at `PII_CIRCUIT_BREAKER_THRESHOLD=1`, `{type="breaker-trip",severity="failure"}` for the PII secret's own process-wide breaker — a genuinely different scope from the PPA breaker's per-partition one, both now provably wired.

**Exit criterion — met live, [2026-09-08].** A full 500-record feed (`raw_export_500/raw_export_500.json`) against a fresh MLA instance and a real `ppa-stub` in clean-pass-through mode produced a `/metrics` snapshot in which every one of the 500 records lands in exactly one counted bucket: `mla_skipped_total{reason="egress"} 273` + `{reason="party-lookup"} 92` + `{reason="fx-quote-rejected"} 19` + `mla_rejected_total{reason="invalid-signature"} 116` = **500**, `mla_consumer_lag` at `0` on all twelve partitions confirming full consumption, no partition left paused, and zero unhandled exceptions across the run. `mla_alerts_total{type="signature",severity="failure"} 116` confirms the alert path fired in lock-step with every counted rejection. (No `forwarded`/tokenization/breaker signals in this specific run — expected: real DFSP keys remain unavailable per `plan.md` §13.1/§14 Q1, so every one of the 500 real captured signatures fails verification against the locally generated test keys; the `forwarded`/rejection/retry-exhaustion/breaker-trip/tokenization-failure buckets are each separately proven live above, against genuinely re-signed records, since the 500-record capture itself cannot produce them.)

---

## 10. Phase 7 — Hardening and validation

- [x] Full-capture regression: all five folders, the partition-2 slice, and the 500-record export, each against its golden file, in CI. *Built and locally verified [2026-09-09]; the CI job is wired but has not yet been observed running on a GitLab runner — that clause stays unproven until it does.* All seven captures now hold a decision-level golden (`tools/golden/goldens/ingestion_*.golden.json`); previously only the partition-2 slice did. A checked-in registry, `tools/golden/captures.ts`, names the seven with the significance of each (mirroring `tools/scenario-library/scenarios.ts`'s established shape), and `run-ingestion-golden.ts --all` (npm script `golden:ingestion:all`, CI job `regression`) verifies every one in a single command with a single exit code, reporting **all** failures rather than bailing on the first — a sweep that stopped at the first regression would hide the other six. The comparison logic moved into `tools/golden/ingestion-golden.ts` so the single-capture CLI and the `--all` sweep cannot drift apart on what "matches the golden" means. **The six new goldens were cross-checked against Phase 6's own live-verified numbers before being recorded, not snapshotted blind**: `raw_export_500` computes 273 `egress` + 92 `party-lookup` + 19 `fx-quote-rejected` + 116 forwarded = 500, exactly reproducing §9's live exit-criterion tally (those 116 being precisely the records that then failed JWS as `invalid-signature`), and the partition-2 slice computes 26 classification skips + 15 forwarded, matching that phase's live run record-for-record — independent confirmation that the pure `processRecord` path and the live broker path agree decision-for-decision. **The mechanism was verified able to fail, not merely to pass:** one flipped decision in a golden produced a `REGRESSION` report naming the expected/actual pair and exit 1 while the other six still ran, and a simulated record-count divergence tripped the registry's own `recordCount` guard — the tripwire that exists because a golden alone cannot catch a truncated fixture, since re-recording would simply bake the smaller file in as the new truth. Verified cold-start-safe: the sweep passes with an entirely empty environment and with `dotenv` pointed at a missing file, because every decision it compares runs inside `processRecord`, a pure function with no I/O — so the job needs no broker, stub, certs, keys or secret, only `npm ci`.
- [x] **Run the suite in default parallel mode.** *Verified [2026-09-09].* The suite was already parallel-by-default (`npm test` sets no `--runInBand`); this item was a verification, not a build. **Six consecutive green runs** in Jest's default parallel mode (11 workers on 12 cores) - 24 suites, 354 tests, 100%/98.06%/100%/100%, zero flakes, zero order-dependent failures. **One real finding, fixed:** `npm test` carried `--forceExit`, inherited from Phase 0 scaffolding (commit `491bfcd`, 2026-09-01 - added before any test existed that *could* leak a handle, not in response to one). `--forceExit` masks leaked handles, the exact defect class this phase exists to surface, and Jest's own closing line ("Have you considered using `--detectOpenHandles`") was being printed on every run. Removed after proving it was masking nothing: the suite exits **cleanly on its own**, exit code 0 in 16-21s under `timeout 300`, across three separate runs - a genuine leak would have held the event loop open until the timeout killed it at 300s (exit 124). The flag is now gone, so a *future* leaked timer or unclosed connection fails loudly in CI instead of passing silently (N10). Lint re-confirmed at zero errors (85 warnings, acceptable per `engineering-rules.md` §5).
- [x] Sustained load via `--loop`, measured against 25 TPS sustained / 125 TPS peak, with ack latency against the 200 ms p95 budget — including tokenization overhead, which US-PII-01 requires be confirmed under load rather than assumed. *Built, tested, live-verified [2026-09-09].* Every clause of US-PERF-01's own load-test shape — sustained, peak, and the step-down — is now met live against a real broker, a real `ppa-stub` over real mTLS, on genuinely re-signed records. Built `tools/load-test/` (`metrics-snapshot.ts` + `run.ts`, npm script `loadtest`) — a checked-in measurement tool per `engineering-rules.md` §11, deliberately **observation-only**: it reads Phase 6's own `mla_ack_latency_ms` rather than timing anything itself, since a second tool-side stopwatch would measure the harness instead of the service. **The p95 claim is exact, not interpolated**: `ACK_LATENCY_BUCKETS_MS` places a boundary exactly on 200ms, so "is p95 <= 200ms" reduces to the counting question "are >=95% of samples in the le=200 bucket", answerable from raw counts with no `histogram_quantile` estimation. The runs: **25 TPS sustained x 30 min** — 45,002 records, achieved 25.00/s, 10,440 ack samples, **10440/10440 (100%) within the 200ms budget**, mean 2.05ms, **consumer lag measured 0 at every one of the fifteen 120-second samples across the full half hour** (the failure this clause exists to catch is lag creeping up under sustained load; it never moved), zero delivery failures; **125 TPS peak x 5 min** — 37,504 records, achieved 125.00/s, 8,702 ack samples, 8702/8702 (100%) within 200ms, mean 1.80ms, consumer lag 0 throughout, zero delivery failures; **step-down 125->25 TPS** — fed 6,000, accounted for exactly 6,000 (forwarded 1,392 = 12x116), 1392/1392 within budget, **zero event loss across the rate transition**; plus a 2-minute 25 TPS validation (25.00/s achieved, 696/696 within budget). **Two defects found by running it, both fixed.** (1) `--resign` over a range aborted the whole feed: `resignPayload` throws on any record with no signable body — correct for Phase 3's hand-named indices, fatal for `--resign 0-499`. Added an `isResignable` predicate asked *before* calling rather than via `catch` (§6.2), with the skip count reported rather than swallowed (N10); it reports 214 skipped on the 500-record capture, matching static analysis exactly (148 no-body, every one an `egress` record, + 66 no-`fspiop-source`) — none of which ever reaches JWS, so nothing is lost. (2) Re-signing a whole capture needs signing keys for all 19 DFSP ids present, not just the 11 on forwarding records; the missing 10 were generated. The missing-key error was deliberately **not** softened — it names its own fix and a missing key is a genuine operator mistake, unlike a structurally unsignable record. **One methodology error, caught and corrected rather than reported:** the first step-down run reported 27,877 records accounted for against 6,000 fed, and 6,469 forwarded — more than were fed, which is impossible. Cause: `kill <npm pid>` leaves the `ts-node` child reparented and running, so the peak run's feeder was still producing 125 TPS through the step-down window (175s x 125 = 21,875 + 6,000 = 27,875, against 27,877 observed). That run was discarded, the harness verified clean, and the step-down re-run; feeds now run under `setsid` process groups. The peak run itself was unaffected — it started verified-clean and achieved exactly 125.00/s. 13 new tests (`__tests__/load-test-metrics.test.ts`) pin the budget logic including the breach cases a real broker cannot be made to produce on demand, and the tool was verified **able to fail**: with no load it refuses a verdict and exits 1 rather than reporting a vacuous pass. Suite now 367 tests / 25 suites, coverage unchanged at 100%/98.06%/100%/100%, zero lint errors.
- [x] Two MLA instances against 12 partitions — group rebalance, no double-processing, no gaps. *Built, tested, live-verified [2026-09-09].* Two compiled MLA instances (`PORT=3001`/`PORT=3002`, one `KAFKA_GROUP_ID`) against the real 12-partition topic. **Rebalance:** `rpk group describe` read `STATE Stable, MEMBERS 2` with the twelve partitions split 6/6 by the `RoundRobinAssigner` (one member the even partitions, the other the odd). **No double-processing / no gaps:** a single-instance run of the 500-record export was recorded as a baseline, then `ppa-stub` was reset (`/control/reset` clears the fault mode *and* the recorder) and the same capture fed **once** - never `--loop`, which would re-emit identical envelopes and destroy the identity check. The two-instance run produced exactly 116 envelopes matching the baseline set with **no duplicate keys, no gaps, and nothing unexpected**, split A=66 / B=50 - both instances did real work, so the test cannot pass with one instance idle. **The identity key is `id` + `msgType`, established empirically rather than assumed, and the assumption it replaced was wrong.** The 500-record export yields 116 envelopes over only **75 distinct `id`s**: D3 makes `id` a per-`eventType` business identifier shared by a leg's request and its callback, which D4's two-value `msgType` separates. Deduplicating on `id` alone would have reported 41 false duplicates. `correlationId` cannot serve as the key either - it is minted per processing *attempt*, so a genuinely double-processed record yields two distinct values rather than a detectable duplicate. **Also verified under a mid-feed rebalance**, which is the case that actually risks loss: instance B was `SIGKILL`ed at t=8s of a 20s feed, and all 116 keys still arrived - **no gaps, nothing lost**. Zero duplicates were observed, but that is **not** claimed as a guarantee: MLA is at-least-once by design (N1 - commit only on PPA 200), so a redelivery after an ungraceful kill would be *correct*, and this kill simply landed outside the window between delivery and offset commit. **One observation trap worth recording, because it produced a false reading first:** after an instance dies, its partitions stay assigned to the dead member until the group session timeout expires (~15s here), and the surviving instance's own `/metrics` cannot see them - a per-instance lag poll reported "drained" with 153 records still stranded and only 63 of 116 envelopes delivered. Poll the broker-side `rpk group describe` `TOTAL-LAG` instead; it showed `members=2 lag=153` -> `members=1 lag=0` across the rebalance, after which all 116 arrived. `tools/scenario-library/scenarios.ts`'s `two-mla-instances` is now `runnableNow: true` with the verified procedure recorded in its note - **the flag was stale, not tracking a real dependency**: the blocker it was marked against ("needs the real MLA consumer group") was satisfied when Phase 2 closed. Suite unchanged at 367 tests / 25 suites, 100%/98.06%/100%/100%, zero lint errors.
- [x] Chaos: broker restart mid-feed; MLA `SIGKILL` mid-dispatch; stub flapping. *Built, tested, live-verified [2026-09-09].* All three run live against a real broker, a real `ppa-stub` over mTLS, on genuinely re-signed records; each measured against a single-instance baseline on the `id` + `msgType` key (§5). **Broker restart mid-feed:** `docker restart cch-mla-redpanda` at t=8s of a 20s feed. The producer reconnected and completed all 500; **MLA reconnected entirely on its own** (health returned `kafka: UP`, no intervention, no restart); and the records MLA accounted for over the run equalled the topic end-offset delta exactly - **500 produced, 500 accounted for, nothing lost**. Loss is measured against the *broker* (consumer-group `LOG-END-OFFSET` delta vs the MLA forwarded/skipped/rejected counters) rather than against the feeder, which is what distinguishes "the feeder failed to produce" from "MLA lost a record". **MLA `SIGKILL` mid-dispatch:** killed at t=8s with only **28 of 116** envelopes delivered; after restart **all 116 arrived, no gaps** - genuine resume-from-committed-offset rather than a clean re-run. **Stub flapping:** `ppa-stub` in `flaky` mode (~50% 500s) across a full 500-record feed produced **102 transient `server-error` outcomes and 6 retry-exhaustion alerts**, parking records and pausing partitions 8 and 9. Clearing the fault (`POST /control {mode:ok}` - deliberately *not* `/control/reset`, which also wipes the recorder and would have destroyed the evidence) recovered every parked record **automatically, with no restart**: 90 -> 114 -> **116 delivered, lag 0** within 30s, the same restart-free breaker recovery Phase 5 first proved, now under sustained fault injection. Final state: 116/116 delivered, **no gaps**, no partition left paused. **Zero duplicates were observed in all three, and that is deliberately not claimed as exactly-once.** MLA is at-least-once by design (N1 - the offset advances only on a PPA 200), so a redelivery after an ungraceful kill or a mid-flight failure is *correct* behaviour; these kills simply landed outside the window between delivery and offset commit. Claiming otherwise from three runs would be exactly the overclaim §11 forbids. **A near-miss worth recording:** `pgrep -f 'build/index.js' | head -1` selected **a Tazama container process**, not the MLA - this machine runs ~41 unrelated `build/index.js` processes from the local Tazama stack, and the `SIGKILL` failed only because it was in another namespace. Identify the MLA by the port it owns (`ss -lptnH 'sport = :3001'`) or by `/proc/<pid>/cwd`, never by a pattern match. Recorded in the `mla-restart` scenario note so it is not repeated. `tools/scenario-library/scenarios.ts` now records the verified procedure for `broker-restart` and `mla-restart`, and **`mla-restart` moves to `runnableNow: true` - the last scenario in the library still marked otherwise. All 15 named scenarios are now runnable.**
- [x] Coverage and lint gates enforced in CI. *Verified [2026-09-09]; the pipeline itself has still not been observed running on a GitLab runner, so "enforced in CI" is proven at the level of the gate mechanisms and the job definitions, not of an observed red pipeline.* Both gates have existed since Phase 0 (`.gitlab-ci.yml`'s `lint` and `test` jobs, `coverageThreshold: 96` in `jest.config.ts`), so this item was a verification rather than a build — and the verification is the point, since a gate nobody has watched fail is indistinguishable from a gate that cannot fail. **All three were proven to genuinely reject, not merely to pass:** the coverage gate fails the job while every test still passes (holding the suite at its real 98.06% branch coverage against a 99% threshold produced `Coverage for branches (98.06%) does not meet "global" threshold (99%)`, 354/354 tests green, exit 1 — coverage is an independent gate, not a report attached to the test result); ESLint exits non-zero on a single error-level violation, with warnings correctly *not* failing it (`engineering-rules.md` §5's stated bar); and `prettier --check` exits non-zero on a badly formatted file, confirming `npm run lint`'s second half is load-bearing rather than decorative. Two additions this phase: the new `regression` job (the capture sweep above), and an explicit 15-minute `timeout` on the `test` job — the latter specifically because `--forceExit` was removed, so a future leaked handle now surfaces as a bounded, loud CI failure instead of an unbounded hang (N10). Everything the `regression` job depends on was confirmed committed rather than merely present on disk — all seven capture fixtures (including the 7.4 MB 500-record export), all ten golden files, and `ts-node` as a devDependency `npm ci` installs — the class of gap that passes locally and fails only in CI. `.gitlab-ci.yml` parses as valid YAML with four jobs across two stages.

**Exit criterion.** Every scenario in the Phase 1 library passes, unattended, in CI, from a cold start.

**Status [2026-09-09] — three of the four clauses met; "in CI" is not, and the phase is therefore NOT closed. That last clause is one `git push` away from being testable — see below.**

`npm run scenario:all` (`tools/scenario-library/run-all.ts`) runs **all 15 named scenarios and every one passes**, with one exit code and no human in the loop: `All 15 scenarios passed, unattended, from a cold start.`

- **"Every scenario ... passes" — met.** This clause was previously unmeetable in principle, not merely unmet: the library had **no notion of pass or fail**. `npm run scenario -- <name>` only ever *set up* a condition (produced records, or POSTed a fault mode) and returned 0 regardless of what happened downstream, with a human expected to read logs and judge; the three `infra` scenarios printed prose and executed nothing. Each scenario now carries a `ScenarioExpectation` — stated as **floors rather than exact equalities**, so refreshing a fixture does not produce a wall of false failures, with one deliberate exception: `accountsForAll` is exact, because "every record fed lands in exactly one counted bucket" is the assertion that actually catches a record silently ceasing to be processed (`environment-simulation.md` §3.3). The three `infra` scenarios get bespoke assertions instead (broker-restart measures loss against the *broker's* own end-offset, not the feeder's claim; mla-restart and two-mla-instances compare the delivered envelope set on the `id` + `msgType` key, per §5).
- **"Unattended" — met.** One command, one exit code, no interactive step. **Verified able to fail, not merely to pass**: an impossible floor injected into one scenario (`unreadable >= 9999`) produced `FAIL ... skipped{unreadable} = 1, expected at least 9999` and **exit 1**, then was reverted. A suite that has only ever passed is not evidence that its assertions do anything.
- **"From a cold start" — met on this machine.** `harness.ts` generates the mTLS certs, all 19 DFSP keypairs and the PII secret when absent, brings up Redpanda and creates the 12-partition topic, compiles the service, and starts `ppa-stub` and MLA itself — none of which a fresh checkout has. Every endpoint is env-derived (`KAFKA_BROKERS`, `PPA_STUB_CONTROL_URL`, `PORT`) rather than hardcoded to localhost, so the same command runs against a differently-shaped environment unchanged. **The stronger form of this claim — a throwaway container carrying none of this machine's state — is not yet run.**
- **"In CI" — NOT met. The cause is that nothing has been pushed, not that CI infrastructure is missing.** Established directly [2026-09-09] from the project's own CI/CD settings and its Git state, not inferred: the GitLab instance has **11 instance runners available**, and the project has **zero pipelines, ever**. Those two facts are reconciled by a third: **no ref the server holds has ever contained a `.gitlab-ci.yml`.** `origin/main`, `origin/epic-1` and `origin/rahim-init` all date from 2026-08-31/09-01, before Phase 0's scaffolding commit introduced the CI config, and none of the 34 commits carrying Phases 2-7 is reachable from any pushed ref (`git branch -r --contains HEAD` is empty; the working branch `epic-observability` has no upstream). GitLab creates a pipeline when it *receives* a commit containing CI config; it has never received one, so there has been nothing to run and no runner was ever the constraint.

  **What this clause now waits on: a push, which is the user's action and not Claude's** (`CLAUDE.md`, "Claude never commits" — `git push` included). Once `epic-observability` reaches the server, a pipeline should be created and picked up by one of the instance runners. **One genuine unknown survives that push**: whether those instance runners permit `services:` containers, Docker-in-Docker or a mounted Docker socket, and localhost port binding. `lint` and `test` need none of that and should pass immediately; the `regression` job needs none either (`processRecord` is pure). But `scenario:all` needs a broker, and `broker-restart` additionally needs to `docker restart` it — so if those runners are restricted, the broker-dependent scenarios may have to be marked CI-excluded with the reason recorded, and the criterion met with a stated exception rather than in full. That is a question the first pipeline answers empirically; it is not worth guessing at beforehand.

  The same gap is what leaves the CI clauses of §10's items #1 and #6 unproven.

  **Resolved to a concrete, named blocker [2026-09-09], after the push.** The branch was pushed and GitLab created the project's **first-ever pipeline (#44134, commit `6e4ccfec`)**. It queued for 8 seconds, was picked up by an instance runner, and ran — so runners exist, are enabled for this project, and execute jobs. `build` failed in ~7s and the `verify` stage never started. The job log settles both questions this plan previously could not answer:

  1. **The runner is a `shell` executor, not Docker** (`Preparing the "shell" executor` / `Using Shell (bash) executor...`, runner `GitlabRunner-shell`). **`image: node:22-bullseye` is therefore inert** — a shell executor runs directly on the host with whatever is installed there. `.gitlab-ci.yml` has assumed a Docker executor since Phase 0 [2026-09-01] and nothing revealed it, because no pipeline had ever run.
  2. **The runner host runs Node < 16.** `npm ci` failed with `npm ERR! Cannot read property 'ajv' of undefined`. The singular *"property"* phrasing dates it: V8 changed that message to *"Cannot read properties of undefined (reading 'ajv')"* in Node 16, so any host printing the old form predates it. Against `engines: >=22.17` and a `lockfileVersion: 3` lock file that npm 6 cannot parse, `npm ci` died two seconds in. **Not a network fault, not a repository fault** — verified locally: `tsc --project tsconfig.json` exits 0, the main build's `include` is `./src/**/*` only (so neither `tools/` nor `__tests__/` reaches it), the lock file is present and consistent, and this machine reaches `registry.npmjs.org`.

  **Consequence for the broker-dependent scenarios: a `shell` executor supports no `services:` at all**, so a Redpanda service container is not available on this runner. Whether that host has Docker installed and whether the `gitlab-runner` user may use its socket cannot be determined from this machine.

  **The remaining decision is infrastructure's, not engineering's** — the three options, in the order engineering would recommend them: **(b)** register a Docker-executor runner, which makes `image:` and `services:` behave as this config already assumes and is the only route that puts the broker-dependent scenarios in CI properly; **(a)** install Node >= 22.17 on the existing shell-runner host (or `nvm`/`asdf` selected in `before_script`), the smallest change, which should turn `build`/`lint`/`test`/`regression` green immediately while still leaving no broker; **(c)** stay on shell and drive Docker directly from the job, viable only if that host has Docker and the runner user can reach the socket. `scenario:all` is deliberately **not** wired into `.gitlab-ci.yml` until this is settled — adding it now would only contribute a second failing job.

**What that means for closing Phase 7:** the engineering is complete and every behavioural claim the phase makes is live-verified. The phase stays open on one external dependency — a CI runner — exactly as Phase 4 stays open on gate item #2. Do not record Phase 7 as done on the strength of a local `scenario:all` pass; record it as "every scenario passes, unattended, from a cold start; CI execution pending a runner."

---

## 11. Phase 8 — The COMESA environment

**This section is no longer blocked in its entirety — but two things must not be conflated.** It was written when it was, and that framing held until [2026-09-15]. What changed: the deployment-shaped work — manifests, registry, image delivery — turned out not to need COMESA's environment at all, so it went ahead on Paysys's own infrastructure. A **real PPA instance** and a **Paysys-side test MLA deployment consuming real Mojaloop demo-cluster traffic (`10.0.150.69`, not CCH's cluster)** both now exist. Six §16 entries dated [2026-09-15] and [2026-09-17] record that work — including the 09-17 one that corrects a reading these entries invite: **none of this is CCH's own cluster deployment.** The manifest package was handed to CCH via George Murage (CCH's technical lead and our point of contact, not part of techops himself) [2026-09-15]; George confirmed the notes are clear to CCH's techops team, and as of the [2026-09-17] check-in they had not yet run `kubectl apply` (`docs/meetings and emails/17-sept-checkin-for-pending-items.md`). **What remains blocked is everything that genuinely requires COMESA's own environment or CCH's own action**: CCH actually deploying, real DFSP signatures, a dedicated consumer group ID, the production feed's own header behaviour, and production-representative load. Each bullet below now says which of the three it is. (Separately, per the 2026-09-09 meeting, Paysyslabs itself is moving off the Core Test Harness onto a Kubernetes-based deployment per Sam's earlier recommendation — an empty cluster is already configured locally, and running live traffic through it is the team's own next step. That is our own infrastructure work, not COMESA's environment, and does not unblock this section, but it bears directly on the Kubernetes-manifests bullet below.)

- [ ] **CCH's own cluster deployment — manifest package handed over [2026-09-15], not yet applied.** CCH's techops team has the full package (manifests, namespace file, ConfigMap files) via George Murage (CCH's technical lead and point of contact, not techops himself), who confirmed the notes are clear; as of the [2026-09-17] check-in, `kubectl apply` had not yet been run (`docs/meetings and emails/17-sept-checkin-for-pending-items.md`). Distinct from the Paysys-side test deployment at `10.0.150.69`, which is not CCH's cluster and does not count toward this bullet.
- [ ] Confirm the topic name, partition count and retention in the target environment. `topic-event-audit` and 7-day retention are both inherited assumptions — the captures evidence neither.
- [ ] Confirm `operation`, `Content-Type` and `FSPIOP-HTTP-Method` survive identically in CCH's production feed (FSD Open Item #7 for *their* environment, regardless of what our captures show).
- [ ] **Re-verify the canonical-record table against live traffic.** CCH and the Mojaloop Foundation confirmed at the 2026-09-09 meeting (`docs/meetings and emails/9-sept.md`; §14 Q2) that the per-operation `start`/`egress` asymmetry is by design across all environments — this item now confirms that stated design fact against live traffic, rather than testing an unconfirmed capture artefact.
- [ ] Obtain a dedicated consumer group ID from CCH. **Blocked on CCH** — and still the one MLA misconfiguration capable of affecting live payments (R-18). Not a deployment-day detail.
- [ ] Verify a genuine DFSP signature with real keys. **Blocked on the keys** — progressed at the 2026-09-09 meeting but not delivered (§13.1, §14 Q1). Note also that `JWS_VALIDATION_DISABLED` exists as a scoped testing bypass [2026-09-15] and must be confirmed **off** before any live traffic is treated as evidence for this bullet — its value on the deployed cluster at `10.0.150.69` is not recorded anywhere in this knowledge base and should be checked, not assumed.
- [ ] Real mTLS against the real PPA; the deployment's certificate provisioning. **Regressed rather than advanced, and deliberately so.** The real PPA instance is plain HTTP on `:3000` with no mTLS port found on any of six checked candidates, so MLA gained a dev-only `PPA_MTLS_DISABLED` bypass by user decision [2026-09-17]. While that flag is on, MLA↔PPA traffic is unauthenticated and unencrypted — **a real, standing gap, not a mechanism that turns itself off.** This bullet now also covers turning it back off.
- [~] End-to-end against the real PPA, including the durable-ack semantics the stub cannot evidence. **Half done [2026-09-17].** MLA's own side is proven: a full happy-path corridor fed through the real instance, all 8 canonical envelopes accepted with HTTP 200, every fed record accounted for (`e2e-testing/checklist.md` §§1–2, §16's own entry). **The durable-ack half is not** — nothing about PPA's own processing after its HTTP 200 (write-ahead persist, translation, correlation, TMS dispatch) has been confirmed. `e2e-testing/checklist.md` §3 breaks that remainder into checkable items; most are now answerable by reading `cch-ppa`'s source or standing up its local compose stack, neither of which has been done.
- [ ] Load test on production-representative infrastructure. **Still blocked on the environment** — Phase 7's figures are local, on one laptop, and R-10 means the 25/125 TPS baseline is itself unconfirmed.
- [x] **Kubernetes manifests.** Done [2026-09-15] — real manifests built for CCH techops and shipped, with the registry pivoted to **GHCR** (`psl-izyane-cch-frms/cch-mla`, digest-pinned), and MLA deployed and running at `10.0.150.69` (namespace `mla`).
- [ ] **APM.** Not done. No APM tooling wired against the deployed instance.
- [ ] **The real metrics backend.** Not done. `/metrics` exposes Prometheus-format data (Phase 6); nothing in this knowledge base records a Prometheus/Grafana/Mimir instance actually scraping the deployed MLA.
- [ ] **Alert destinations.** Not done — R-37, still CCH's to name. The mechanism (a metrics-based signal, always active, plus an optional configurable webhook) is built and live-verified; only the real destination is open.

**One blocker is live and is not COMESA's environment:** there is no network path from the deployed MLA at `10.0.150.69` to the real PPA at `10.0.115.186:3000` — verified from three vantage points [2026-09-17]. §13.1 tracks it. No MLA-side change is needed once it reopens.

**Re-verification is not optional.** Every empirical claim in this plan comes from captures taken 11–13 August 2026 in one environment. Treat them as strong evidence, never as a contract.

---

## 12. Divergence register — where we depart from the POC

The POC was live-verified. Where we do something different, the burden of proof is on us. Each row below states what changes and what specifically must be re-proven.

| # | Area | POC (live-verified) | cch-mla | Why, and what must be re-proven |
| --- | --- | --- | --- | --- |
| **V1** | Canonical selection | Per-operation table + `prepareTransfer` shape-check | **Same** (D1) — the story is corrected, not followed | No divergence. Carry the POC's table forward intact, including the rejection shape-check. Re-prove only that our implementation matches, via the golden file. |
| **V2** | Classification | `operation` alone | **Same** (D2) | No divergence. |
| **V3** | Envelope `id` | Leg-wide anchor + two chaining maps | **Per-`eventType`** (D3, settled — Option A) | Divergence, and it *removes* code. Chaining disappears entirely (§3.2). **Confirmed with PPA's owners** that they accept the cross-stage join this moves onto them. Live-verified in Phase 3 (§16): every forwarded record in the partition-2 slice produced a non-empty `id`, including the one confirmed exception (`putFxQuotesByID`'s `httpPath` fallback) — the POC's chaining bugs were exactly this class of failure, and this scheme carries no chaining state to have that bug in. |
| **V4** | `msgType` | 3 values + `/TRANSFERS/NOTIFICATIONS` | **2 values, 4 routes** (D4) | Divergence. The POC used `msgType === notification` as load-bearing control flow. **Must re-prove:** the final-state record still routes correctly and is still distinguishable from a prepare, now that D5 (below) supplies the replacement discriminator. |
| **V5** | Final-state trigger | `commitTransfer` (`egress`-only) | **Same** (D5, settled) | No divergence. `commitTransfer`, ISO `TxSts` vocabulary (`COMM`/`RESV`), adopted as the trigger and status source. **Must re-prove:** the translation table covers `COMM`/`RESV` correctly, and `commitTransfer` is reliably distinguishable from `prepareTransfer`'s rejection shape (F11) so `RJCT` is never derived from a lookup. Get US-MLA-02 corrected — it still names `fulfilTransfer` as the trigger. |
| **V6** | Payload | FSPIOP form; decode unused | **Same** (D6) | No divergence, but the *story* diverges. Get US-MLA-03 corrected rather than quietly ignoring it. |
| **V7** | JWS | Header presence only | **No verification [2026-09-23]** — cryptographic verification was built (Phase 3), then removed | Converges on the POC, and goes one step further: not even a header-presence check. The switch validates every signature before the topic (`e2e-testing/remove-JWS.md` §1). **Re-proven [2026-09-23]:** a corridor with invalid and with stripped signatures forwarded all 8 envelopes, byte-identical to the signed baseline (§16). Pending story-author sign-off on US-MLA-05. |
| **V8** | PII | PPA-side masking of logs/audit only | **MLA-side tokenization of the payload** | **Entirely new work — no POC precedent.** Different service, different scope, different data transformed. The POC contributes only the confirmation that the ILP exemption is real. |
| **V9** | Retry / breaker | Retry exhaustion trips the breaker immediately; no threshold on the MLA side | **Two coordinated mechanisms with a configurable N** | Divergence toward the story. The POC's PPA→TMS breaker *did* have a threshold; the MLA side simply never got one. **Must re-prove:** the paused-event state and the breaker trip are separately observable. |
| **V10** | `correlationId` | ULID | **UUID** per US-MLA-04 | Cosmetic; nothing depends on the format. Pick one and stop discussing it. |
| **V11** | Envelope `error` field | Present | **Present** (D7) | No divergence, but the *stories* omit it. Feed back to the story author alongside R-04. |
| **V12** | Rejection handling | Transfer-prepare rejection built and live-verified; FX-quote rejection counted, not forwarded | **Same** | Carry forward. The stories' "any error callback → RJCT" model does not match the confirmed wire shape and would be wrong for all 19 observed FX-quote rejections. |
| **V13** | Kafka exercise | `demo:replay` — bypasses the broker | **Real broker via `capture-feeder`** | Pure addition, and the main reason this project can prove things the POC could not — [`environment-simulation.md`](environment-simulation.md) §2. |
| **V14** | Party lookup | Present on the topic; skipped by default; reinstatement tracked as an open design item | **Same** | The stories state ALS "never publishes to Kafka… confirmed", which is wrong. Behaviour is unaffected; correct the story. |

**The rule for this table:** if a row says "Same", we are inheriting live-verified behaviour and should port it deliberately, reading the POC's code and its rationale — not reimplement from the story text and hope we converge. If a row says divergence, the exit criterion for its phase must name the re-proof.

---

## 13. Blocked work

### 13.1 Gates work now

| Item | Gates | Owner |
| --- | --- | --- |
| ~~**DFSP public keys / JWKS endpoint unavailable.**~~ **Dissolved [2026-09-23]** — MLA no longer validates signatures (§16's [2026-09-23] entries), so it needs no keys; US-MLA-05's removal is confirmed by all parties. Original row, kept per this table's convention: We hold 286 real signatures and cannot verify one. **Progressed [2026-09-09 meeting w/ Mojaloop Foundation + CCH — `docs/meetings and emails/9-sept.md`]:** George confirmed the 19 DFSP ids in the export resolve to 8 DFSPs, 2 FXPs and 9 regional hubs (one per country), and is liaising with Infotex to obtain and share their public keys, and to check whether Infotex exposes a JWKS endpoint. Separately, Sam confirmed **Mojaloop Connection Manager (MCM) manages DFSP key distribution automatically during onboarding** — MLA should interface with MCM rather than maintain its own synced key store, a design question `core-knowledge.md` §13.3 and `cross-reference.md` §9.2 had both left open; Sam to share an MCM onboarding video. Michael separately clarified `GET /parties` requests are intentionally unsigned (the sender does not yet know the recipient at issue time) — consistent with, and now explaining, why every `party-lookup` record in the captures carries no signature. **Still open:** no keys, JWKS endpoint or onboarding video in hand yet. | Phase 3's genuine-signature verification. The *mechanism* is unblocked via re-signed fixtures; **the MCM-interface question is a new architectural item for whenever real integration begins.** | CCH / Mojaloop Partner (Infotex keys, MCM video) |
| ~~PII fail-mode — answered [2026-09-04], not yet implemented.~~ **Resolved [2026-09-04] — gate item #1.** COMESA's answer ("fail the transaction and retry") is now implemented, tested, and live-verified — §16's new US-PII-01 entry, §7.1 #1's table cell. Kept here, struck through, rather than deleted, so this table's own history stays legible. | ~~Phase 4 cannot be called complete until the code matches the answer~~ — no longer gates anything | — |
| ~~PII secret rotation — headline answered [2026-09-04], trigger mechanism unresolved — gate item #2.~~ **Resolved [2026-09-18], spec confirmed [2026-09-22] — `docs/meetings and emails/tokenization-feedback.md`.** The [2026-09-04] "versioned keys" direction is superseded: George Murage identified that rotating the key would break Tazama's own fraud rules, which match the same MSISDN/bank-account values tokenization protects, across transaction history. **Both sides confirmed a long-lived, non-rotating key instead** — no rotation mechanism needed; `FilePiiSecretClient`'s existing single-active-key design already matches it. A concrete spec followed: HMAC-SHA-256, 256-bit base64 key, Kubernetes Secret named `cch-mla-pii-secret`. Full narrative: `plan.md` §16's "US-PII-02 — gate item #2 reversed" entry, §7.1 #2's table cell. Kept here, struck through, per this table's own convention for resolved rows. | ~~Phase 4's formal closure only~~ — no longer gates anything | — |
| ~~`cch-crosscutting-user-stories.md` is referenced throughout but absent~~ **Resolved [2026-09-07] — obtained**, home of US-AUD-01, US-MON-01, US-MON-02, US-PERF-01/02, US-SEC-01. Confirms the observability stack (Prometheus/Grafana/Loki/Tempo/Mimir, IDD §10). | ~~No longer gates Phase 6 in full~~ **Resolved [2026-09-08] — Phase 6 is formally closed** (§16's US-MON-01/US-PERF-01 entries); alert paths were built against a configurable sink (a metrics-based one, always active, plus an optional webhook) per `CLAUDE.md`'s own "External decisions" rule — an open destination decision does not block a mechanism built and live-verified against a stated, reversible default. **R-37 itself (alerting destination/routing) remains open, tracked below** — it gates only the real destination eventually being wired, not this codebase's own closure. | CCH (R-37's routing decision) |
| **R-04 (Critical) has no acceptance criteria** — the "never synthesize" prohibitions. MLA-side equivalent: never fabricate an envelope for an event that did not arrive. | Phase 2/3 acceptance criteria | Story author — liftable from the POC's behaviour |
| ~~No network path from the deployed MLA (`10.0.150.69`, namespace `mla` — a Paysys-side test deployment on the Mojaloop demo cluster, not CCH's own) to the real PPA (`10.0.115.186:3000`) — discovered [2026-09-17].~~ **Resolved [2026-09-21] — connectivity confirmed restored.** MLA was already correctly deployed and configured throughout (`PPA_MTLS_DISABLED=true`, `PPA_BASE_URL`/`PPA_HEALTH_BASE_URL` both pointed at the real PPA); nothing on its side ever needed fixing. Re-checked from the same three vantage points that found the break: this machine → PPA (`curl` → HTTP 200), `10.0.150.69` host → PPA (`curl` → HTTP 200, no longer times out), and — the one that actually matters — the `cch-mla` pod's own network namespace → PPA, via the same ephemeral-debug-container technique used to find the break (`redis:5.0.4-alpine`, `wget`) → `{"ready":true,"checks":{"writeAheadStore":true}}`, no timeout. All three green. **`/health/ready` on the pod itself also confirms `kafka: UP` with `mla_consumer_lag{partition="0"}=0`** — fully caught up, not stuck behind a backlog. **Root cause, per the user [2026-09-21]:** `10.0.150.69` and `10.0.115.186` sit on different subnets within the data centre; an infra person resolved the routing gap between them directly. **Confirmed genuinely working, not just reachable [2026-09-21]:** a real corridor (`01_MWK_to_ZMW_PRIMARY`, re-signed) fed onto the real `topic-event-audit` produced all 8 canonical envelopes forwarded and accepted by the real PPA with HTTP 200 — §16's own entry for it. Kept here, struck through, per this table's own convention for resolved rows. | ~~Live-traffic delivery from the deployed MLA to the real PPA~~ — no longer gates delivery, confirmed working end to end; **`e2e-testing/checklist.md` §3's `[remote-instance]` items still need the PPA engineer/further discovery regardless of connectivity, per that section's own closing note** | — |
| **CCH's own cluster deployment has not been attempted** — the manifest package (manifests, namespace file, ConfigMap files) was handed to CCH via George Murage [2026-09-15] (CCH's technical lead and our point of contact — techops is the team that actually runs `kubectl`, not George himself); as of the [2026-09-17] check-in George had reviewed it, found the notes clear, and techops had not yet applied it (`docs/meetings and emails/17-sept-checkin-for-pending-items.md`). Flagged as a risk if not closed by end of that week; not yet confirmed either way since. | Every §11 checklist item that requires CCH's cluster to actually exist and run MLA — real DFSP signatures, the production feed's own header behaviour, the dedicated consumer group, everything downstream of "MLA is actually ingesting CCH's real Kafka topic" | George Murage / CCH techops |
| **Infotex call not yet scheduled** — needed to close two items: whether MLA's outbound IP is public (so Infotex can allow-list Paysyslabs), and whether the mTLS certificate is embedded in MLA directly or routed via a dedicated egress gateway. Bears on `MLA-deployment-kubernetes.md` §11 Q4/Q5 (the PPA endpoint address, mTLS gateway). Oscar (Infotex) has accepted the GitHub invite and is copied on relevant threads. | The PPA endpoint address and mTLS gateway provisioning — both already tracked as open in `MLA-deployment-kubernetes.md` §11 | George (to schedule) / Infotex |

### 13.2 Gates production, not the work ahead

| Item | Gates | Owner |
| --- | --- | --- |
| **COMESA environment not provisioned** | Phase 8 in full | CCH / COMESA |
| MLA→PPA timeout values not agreed (FSD Open Item #1) | The placeholder in `.env.template`; fine as a placeholder throughout | CCH + Paysys |
| Dedicated consumer group ID not issued (R-18) | Real deployment. **The one MLA misconfiguration capable of affecting live payments** — a reused DRPP-internal group name can steal partition assignments from a live payment-path handler. | CCH |
| Offset-advance-on-permanent-failure policy unconfirmed (FSD Open Item #8) | Whether Phase 5's 4xx row advances or pauses (the signature-failure row no longer exists, §16 [2026-09-23]). Implemented as "advance"; the open part is whether that is *right*. | CCH + Paysys |
| Zambia Data Protection Act applicability (FSD Open Item #6) | Retention and what "protected" must mean legally | CCH Legal |
| PII secret ownership unassigned (rotation itself is resolved — no rotation, a long-lived key, §13.1 — this row is ownership of that long-lived secret only) | Production operation of Phase 4 | CCH |
| Event Envelope versioning unspecified (R-23) | A future breaking change to the contract | Story author + IID owner |

---

## 14. Open questions for COMESA / the Mojaloop Partner

Ordered by how much they change what we build. The first four are the ones to put in the next data request.

1. ~~**Can we have the DFSP public keys, or a JWKS endpoint?**~~ **Dissolved [2026-09-23]** — MLA no longer validates signatures (§16). Original question: Without them, JWS verification cannot be proven against real traffic — only against fixtures we sign ourselves. This is the single highest-value unblock available. **Answered in part [2026-09-09 meeting, `docs/meetings and emails/9-sept.md`]** — see §13.1's DFSP-keys row for the full outcome (key inventory confirmed, Infotex retrieval and an MCM onboarding video pending). **Gates Phase 3** (§13.1) until the keys/JWKS/video actually arrive.
2. ~~Is the per-operation canonical-record shape a stable contract, or an artefact of this capture window?~~ **Resolved [2026-09-09 meeting]** — Michael (Mojaloop Foundation) confirmed `egress` is the safe, authoritative record in general, and George (CCH) confirmed the per-operation `start`/`egress` asymmetry — including the three `egress`-only operations — **is by design across all environments, not an artefact of the two shared captures.** George explained the three `egress`-only operations concretely: `commitTransfer` is the switch's own message (may indicate a timed-out transfer, still DFSP-signed if nothing went wrong), `reserveFxTransfer` is the FXP committing to honour a conversion only if the payment succeeds, and `notifyFxTransfer` is the switch telling the FXP the payment completed so the conversion can be booked. He also corrected the evidentiary basis itself: **the 141-record `DRPP_Kafka_E2E_Pack` set is a subset of the 500-record `raw_export_500.json` export, not a second independent capture window** — confirmed directly against the checked-in fixtures (every one of its 121 distinct `partitionID`:`offset` pairs appears in the 500-record export). So "641 records across two independent captures" was never accurate; the real evidentiary base is the single 500-record export, and the per-operation table's authority now rests on CCH/Mojaloop Foundation's design confirmation, not on cross-capture corroboration. **Re-verifying against live traffic remains a Phase 8 checklist item** (§11) — now to confirm a stated design fact in production, rather than to test an unconfirmed capture artefact. **New follow-up, not yet received:** George is to share his own annotated event table covering the ~52% of the 500-record export ours does not yet cover.
3. **Can we get a rejected transfer *fulfil*, and a rejected FX transfer?** **Answered [2026-09-09 meeting]** — George confirmed neither scenario exists in the current captures and both must be simulated. Sam is to supply two examples from Mojaloop's own test environment: a payee-DFSP rejection (e.g., a customer account suspended between approval and execution) and a switch-generated timeout failure (an unreasonably short timeout set deliberately to trigger it). **Partially answered [2026-09-16, Sam Kummary email + linked TTK report — `docs/meetings and emails/sam-email-2026-09-16-rejection-samples.md`]:**
   - **Payee-DFSP rejection — received.** Test `payee-abort-v1_1` in the linked report: a `PUT /transfers/{id}/error` (`errorCode: 5101`, "Payee transaction limit reached") is relayed to the original sender as `{GrpHdr, TxInfAndSts: {PrcgDt, TxSts: "ABOR"}}` — the same envelope shape as `commitTransfer`'s `COMM`/`RESV`, not the `StsRsnInf`-only shape §F11 describes. **This exposes a real gap, not just a data point**: `TxSts: "ABOR"` has no row in the `TxSts` translation table (cross-reference.md §F10 covers only `COMM`/`RESV`) and no branch in `isTransferRejection` (which keys off `StsRsnInf`, absent here) — per F10's own warning, an untranslated value silently falls through to Tazama's `PDNG` default today. **New, unscheduled item for Phase 2/3 classification and the `TxSts` translation table.**
   - **Switch-generated timeout — received, and matches design.** Test `payer-transfer-timeout` in the same report: a ~14.1s switch timeout relayed as `{GrpHdr, TxInfAndSts: {StsRsnInf: {Rsn.Prtry: "3303"}, AddtlInf: "Transfer expired"}}` — the `StsRsnInf`-only shape §F11 already assumed, now confirmed against real (simulated-environment) data rather than spec text alone. No code gap.
   - **Rejected FX transfer — still open.** Every FX-labelled folder in the report (`e2e-fxp-aborted-state-*`, `e2e-fxp-timeout-*`, `fx-transfer-err-*`, `pos-fxtransfer-fail-*`) either runs through an SDK abstraction that never exposes the raw `GrpHdr`/`TxInfAndSts` shape, or returns `202 Accepted` with no failure callback visible. Sam's cover email describes the pasted `ABOR` sample as "an FX transfer (fulfil side) failure," but it is in fact the plain-transfer case above — no genuine FX-side rejection/timeout sample has been supplied yet.
   
   **Affects Phase 2–3 test coverage** — the untested branches sit in classification and envelope construction; the `ABOR` gap now also affects the Phase 2 `TxSts` translation table specifically.
4. ~~Can an FX quote fail *after* its payment's `pain.001` has been sent, or only before the primary quote — the only ordering observed?~~ **Resolved [2026-09-09 meeting]** — Michael confirmed this ordering is technically possible in Mojaloop generally but **cannot occur in DRPP specifically**: DRPP only allows currency conversion via the payer DFSP, so a payee-DFSP-requested conversion that the FXP rejects forces the payee DFSP to also reject the underlying transfer — an FX-quote rejection followed by an approved post-quote would itself be a significant system failure, not a normal outcome. **The discard-and-count behaviour already built is therefore permanently correct in DRPP** — not merely the only pattern observed to date, but the only pattern DRPP's own design can produce. Bears on Phase 2's FX-quote rejection handling; the resulting correlation behaviour is PPA-side.
5. **Is `topic-event-audit` the final topic name**, and what are the retention and partition count in the target environment? The FSD assumes 7 days; no capture evidences retention either way. **Phase 8** (§11 — the local Phase 1 topic name/partition count are derived directly from capture evidence, not from this answer).
6. **Is the settlement-leg partition split expected behaviour or a symptom?** **Partially answered [2026-09-09 meeting]** — Michael explained the actual cause of today's out-of-order arrival: settlement windows currently change via a **manual operation**, and a plan already exists to replace that with deterministic assignment (each transfer assigned to a settlement batch by its payee-DFSP approval time); Sam will keep Paysyslabs posted once it ships. So today's cross-partition out-of-order arrival is a **current symptom of a manual process with a planned fix, not a permanent design condition** — the opposite of the possibility this question originally weighed. **The partition-key mechanism itself is still open**: Sam confirmed it is a Kafka/runtime config detail rather than application code, inspectable via the Redpanda/Kafka UI, and is to look it up and share it. It determines whether out-of-order arrival is a permanent design condition or a defect someone will fix. **Bears on Phase 2's out-of-order handling** (the harness itself, Phase 1, only needs to replay the split faithfully, not explain it).
7. **Is `dateOfBirth` genuinely unavailable on this topic**, or absent only from these test parties? Zero occurrences across every capture; downstream `pacs.008` mapping depends on it. **PPA-side (`pacs.008` translation) — not a numbered cch-mla phase.**
8. **Is `binId` / `processedAsBatch` (present on 59 of 500 records) relevant to us?** Neither the FSD, the stories, nor the POC models batch processing on this topic. Probably out of scope — worth one question rather than an assumption. **If relevant at all, Phase 2** (ingestion/classification scope).
9. **Alerting destination/routing** (PagerDuty / Slack / email, and the mechanism connecting a condition to it — e.g. Grafana Alertmanager) — R-37, High, from `cch-crosscutting-user-stories.md`'s own Actions table (its own action #5, owner "CCH + FSD author"). The observability *stack* is already confirmed (Prometheus/Grafana/Loki/Tempo/Mimir, IDD §10) and is not itself a question. A SIEM/log-aggregation platform (IDD Open Item #8) is a separate, related question, relevant to audit-log output rather than metrics. **No longer gates Phase 6's formal closure** — Phase 6 closed [2026-09-08] with alert paths built against a configurable sink (§9, §13.1, §16's US-MON-01 entry); this question gates only which real destination is eventually wired into that sink.
10. **Is the hub the only ingress/egress into the system, such that MLA's own JWS validation is redundant?** **Outcome [2026-09-23]: validation removed from MLA outright** — built and live-verified on `paysys-remove-JWS` (§16), `JWS_VALIDATION_DISABLED` removed with it; closure pending story-author and rules-owner/CCH sign-off; Michael's question back still unanswered. Original entry: Distinct from item 1 above (obtaining the keys) — this asks whether validation is needed *at all*, so `JWS_VALIDATION_DISABLED` could become a standing default rather than a scoped testing bypass, while item 1 stays unresolved. **Partially answered [2026-09-21] — Michael (Mojaloop Foundation), via Mutale.** Verbatim: *"Nothing will get on to the Kafka topic unless it has already been validated by the switch, and the Kafka topic is in the same system boundary as the validation process. I'm not sure what would be gained by PaySys performing another validation. What kind of use case are they planning to guard against?"* **Confirms the trust-boundary premise** — the hub-only-ingress half of the question is now answered directly, not assumed, and **in production, MLA's own consumer process sits inside that same boundary**, so a different-trust-zone argument for keeping validation on does not apply here. **Does not itself authorize disabling validation** — `george-reply-2026-09-15.md` item 2's original ask stays **not accepted as a permanent change** (`MLA-deployment-kubernetes.md` §6), and Michael has asked a fair follow-up of his own: what failure mode MLA's re-validation guards against, given the switch already validates. The one candidate answer that survives is narrower than originally drafted here: JWS verification is tamper-evidence for the specific switch-to-Kafka hop, which trust-boundary confirmation alone does not rule out corruption or truncation on. **Whether that narrower point is worth sending back to Michael is the user's call, not yet actioned** — weaker ground than a same-boundary/different-trust-zone argument would have been. §16's [2026-09-21] "Michael's reply" entry has the full narrative. **Gates nothing today** — `JWS_VALIDATION_DISABLED` remains exactly what it was built as (§13.1's DFSP-keys row, `plan.md` §16's 2026-09-15 entry): a scoped, reversible, loudly-observable testing-only bypass, default off.

**Not on this list:** which record is the final-state trigger. That is D5, settled internally as `commitTransfer` with the ISO `TxSts` vocabulary (`COMM`/`RESV`) — §3.1 — so it is not a question for COMESA.

---

## 15. Suggested sequencing

The order that reaches something genuinely verifiable soonest:

0. **Settle D1–D7** (§3.1). Cheap now, expensive later. D3 needs other people, so raise it first and build the parts that do not depend on it while waiting.
1. **Build the harness before the pipeline** (Phase 1). It inverts the POC's order deliberately: the POC built the pipeline and reconstructed a verification script per session from prose, and its documentation says so repeatedly. Building the instrument first means every subsequent phase has a real exit criterion from day one.
2. **Narrow vertical slice next** — one event type, from a real broker, through classification and envelope construction, to `ppa-stub`, with the offset advancing only on `200`. Resist widening until that slice is genuinely live.
3. **Widen to all four event types**, then the rejection paths. Add the golden file the moment the first slice works, not after.
4. **Then JWS, then PII** — in that order, because the ordering constraint between them is a hard requirement and building them in the wrong order invites getting it backwards.
5. **Then resilience** (Phase 5). It is last among the functional phases only because it needs the fault-injecting stub *and* a working pipeline to break.
6. **Operability and load** (Phases 6–7) alongside, not after — metrics and `correlationId` propagation are far cheaper to add from the first line of real code than to retrofit.

Three things to do early because they are cheap now and expensive to retrofit — all three are lessons the POC records paying for:

- **Propagate `correlationId` from the first line of real code.**
- **Build every fixture from real captures. Never hand-write one.** A hand-written fixture encodes what you believe the wire looks like; only a capture encodes what it is.
- **Check the tools in.** `capture-feeder` and `ppa-stub` are product, not scratch. Every scratch script this project's predecessor threw away had to be rebuilt from a paragraph of prose.

---

## 16. Progress log

**What this section is.** The record of what has actually been built, story by story. §3–§11 say what we intend to do; this says what happened. A story is not done until it has an entry here — that is the rule in `CLAUDE.md`, and it is the reason this document is worth more than a plan written once.

**Entries are append-only and newest-last.** Never edit an old entry to make it look better in hindsight; if something recorded here turns out to be wrong, add a later entry saying so. Nothing here is revision history in prose — each entry states what was true at the point the story closed.

### The entry format

Copy this block per story. Every field is required; `Verified` is the one nobody may soften.

```
### US-XXX-NN — <story title>                                   [YYYY-MM-DD]

**Built**       What exists now, and the files it lives in.
**Tests**       Count, coverage %, and which of engineering-rules.md §10.2's
                categories are covered — table rows, failure paths, ordering
                constraints, idempotency, concurrency, degraded paths, races.
**Verified**    `live — <exactly what was exercised, against what>`
                or `unit only — <stated plainly, with what remains unproven>`.
                Never write the first when only the second is true (§11).
**Diverged**    From the story text, the POC, or both — and why.
                Cross-reference the divergence register (§12) row, or add one.
**Left open**   Anything unfinished, with a reference. "Nothing" is a valid
                answer and must be written, not left blank.
```

**On `Verified`.** `engineering-rules.md` §11 is the rule this field exists to enforce: *"Verified live against a real ValKey with 3 concurrent replicas"* and *"Unit-tested with a mocked cache"* are different claims, and the second is never written as the first. Where live verification was impossible — no environment for mTLS, Keycloak or Kubernetes — say so plainly and mark the item unverified. A story can close as `unit only`; it cannot close as `live` on a hope.

### Entries

### Phase 0 — Scaffolding                                       [2026-09-01]

Not a story (`docs - MLA/EPICS/` has no folder for it), but recorded here under the
same discipline: scaffolding precedes US-MLA-01 and its exit criterion is live.

**Built**       TypeScript + Fastify project at the repository root, on the
                POC's tooling: `package.json` (scripts as-is, minus `demo:*`),
                `tsconfig.json`, `eslint.config.mjs`, `.prettierrc.json`,
                `.prettierignore`, `.editorconfig`, `.dockerignore`,
                `Dockerfile`, `.gitignore` — all carried forward unchanged —
                plus `jest.config.ts` with `coverageThreshold: 96`,
                an audited `.env.template`, and `.gitlab-ci.yml`.
                The four-layer structure, clients injected at the composition
                root: `src/interfaces/` (`config`, `health`, `kafka`, `logger`
                — types only), `src/services/` (`config.service.ts` typed and
                validated at boot, `health.service.ts` pure), `src/clients/`
                (`logger.client.ts` the sole `pino` importer,
                `kafka.client.ts` connection-only, `fastify.client.ts` serving
                `/health/live` and `/health/ready`), and `src/index.ts` as the
                composition root with `SIGTERM`/`SIGINT` shutdown.

**Tests**       43 tests across 5 suites, 100% statements/branches/functions/
                lines on every measured file, in default parallel mode.
                Categories (`engineering-rules.md` §10.2): every table row —
                each `KafkaReadiness` state and each config reader; every
                failure path — missing required variable, non-numeric number,
                non-boolean boolean, out-of-range and non-integer port,
                unrecognised log level, empty broker list, broker connect
                rejection; degraded path — readiness DOWN yielding 503.
                No ordering, idempotency, concurrency or race tests: this phase
                introduces no ordering constraint, no shared state and no
                replay path to test.

**Verified**    `live — all of it, on this machine.` `npm install` clean (602
                packages, 0 vulnerabilities); `npm run build` zero errors;
                `npm run lint` zero errors and zero warnings; `npm test` 43
                passing at the 96 gate. Started `node build/index.js` with no
                `.env` and no broker: `/health/live` → 200
                `{"status":"UP"}`, `/health/ready` → 200
                `{"status":"UP","kafka":"DISABLED"}`; `SIGTERM` logged
                `Received SIGTERM, shutting down`, exited 0, released the port,
                no forced kill. Started again with `KAFKA_ENABLED=true` against
                an unreachable broker: `/health/live` → 200 while
                `/health/ready` → 503 `{"status":"DOWN","kafka":"DOWN"}`.
                Started twice more with `KAFKA_GROUP_ID` absent and with
                `LOG_LEVEL=chatty`: both refused to start, exit 1, naming the
                variable. The coverage gate was itself exercised — removing one
                suite drops coverage to 54.82% and fails the run, exit 1.
                **Not verified:** `.gitlab-ci.yml` has never run on a runner.

**Diverged**    From `jest.config.ts` as carried forward: added
                `collectCoverageFrom: ['src/**/*.ts']`. Without it the v8
                provider reports only files a test imported, so a source file
                with *no* tests is invisible to the threshold instead of
                failing it — the gate was unenforceable in precisely the case
                N8 exists for. Found by testing the gate rather than trusting
                it.
                From the dependency set in `continue - before scaffolding.md`
                §5: `ulid` dropped — §12 V10 settles `correlationId` as a UUID
                per US-MLA-04, so `ulid` has no consumer; `undici` deferred to
                Phase 5, which is where the first HTTP client appears; the
                POC's `@fastify/cors` omitted, as a probe-only HTTP surface
                needs no CORS. All three follow §5's own "add nothing
                speculative"; each is one `npm install` when its phase arrives.
                From the POC's `.env.template`: `KAFKA_AUDIT_TOPIC` corrected
                from the stale `mojaloop-audit` to `topic-event-audit`
                (`core-knowledge.md` §2.1), and `FUNCTION_NAME`/
                `KAFKA_CLIENT_ID` renamed to `cch-mla`.
                From the POC's `config.ts`: Kafka settings are *required* when
                `KAFKA_ENABLED=true` rather than always defaulted, so an
                enabled consumer can never silently run against a guessed
                broker list or a guessed R-18 group id. `PRIMARY_TOPICS` and
                `BASE64_SOURCE_TOPICS` not carried forward — both are D6
                pipeline concerns, not scaffolding.
                A Kafka *connection* client exists this early only because
                readiness must report consumer state (§3.3). It cannot
                subscribe, consume or commit; US-MLA-01 extends it.

**Left open**   D3 and D5 remain open and unchanged — neither is scaffolding's
                to settle (§13.1).
                `.gitlab-ci.yml` is written but unproven; its first real
                verification is the first push to a runner.
                `npm start` does not forward `SIGTERM` to node — npm exits 143
                and orphans the child, which keeps the port bound. The handler
                is correct and was verified against `node build/index.js`
                directly, which is what the `Dockerfile` runs (distroless
                `CMD ["build/index.js"]`, node as PID 1). Worth knowing before
                anyone concludes from `npm start` that shutdown is broken.
                `ts-jest` warns `TS151002` (hybrid module kind without
                `isolatedModules`) on every run — cosmetic, inherited with the
                POC's `tsconfig.json`, left as-is rather than diverging from a
                carried-forward file for a warning.

### Phase 1 — The harness                                       [2026-09-02]

Not a story (`docs - MLA/EPICS/` has no folder for one) — the harness
precedes every story from US-MLA-01 onward, the same shape as Phase 0
(`EPICS/EPIC-0-Scaffolding/`). Full design authority:
[`environment-simulation.md`](environment-simulation.md); session detail:
`continue/continue - before harness.md`.

**Built**       `docker-compose.dev.yml` (single-node Redpanda,
                `topic-event-audit` at 12 partitions, healthcheck-gated
                topic-init). `tools/capture-feeder/` — faithful replay with
                explicit per-message partition assignment, per-partition
                order preserved, every scenario flag from §4's checklist
                (`--speed burst|real|Nx`, `--only`, `--delay-partition`,
                `--duplicate`, `--drop`, `--corrupt`, `--strip-signature`,
                `--loop`). `tools/ppa-stub/` — two listeners: mTLS business
                endpoints (`/QUOTES`, `/FXQUOTES`, `/TRANSFERS`,
                `/FXTRANSFERS`) validating against a shared ajv schema and
                recording accepted envelopes to JSONL, plus a plain-HTTP
                control/health listener (`/control`, `/control/reset`,
                `/health/live`, `/health/ready`) supporting fault modes
                `ok|503|500|4xx|timeout|flaky` with `afterN`/`forMs`.
                `src/interfaces/event-envelope.interface.ts` and
                `event-envelope.schema.json` — the Event Envelope's
                structural shape (core-knowledge.md §5), imported directly
                by `ppa-stub` rather than duplicated (`continue - before
                harness.md` §3; engineering-rules.md §2.2 does not apply
                inside one repository). `tools/golden/` — produces a capture
                onto a scratch topic, reads it back, and diffs per-partition
                against the source; goldens recorded for
                `01_MWK_to_ZMW_PRIMARY`, `raw_topic_slice_partition2`, and
                `raw_export_500` (`tools/golden/goldens/*.golden.json`).
                `tools/scenario-library/` — all fifteen named scenarios from
                §4's checklist as data, with an executor for every one the
                harness alone can run. `tools/curate-fixtures/extract.ts` —
                regenerates `__tests__/fixtures/curated/` (23 classification
                cases, 2 transfer rejections, all 19 FX-quote rejections, 5
                party-lookup records, each with a provenance file). The full
                capture pack committed verbatim to `__tests__/fixtures/`
                (`continue - before harness.md` §5's decision). `tools/README.md`
                documents every tool and flag.

**Tests**       No `__tests__/*.test.ts` suite - this phase built
                infrastructure the pipeline will be tested *against*
                (Phase 2 onward), not pipeline code itself; `jest.config.ts`'s
                `collectCoverageFrom` is `src/**/*.ts` only, so the 96%
                gate is untouched (still 100%, 43 tests, confirmed after
                this phase's changes). Every tool was instead proven by
                actually running it - see **Verified** below, which is the
                applicable standard for verification infrastructure
                (engineering-rules.md §11: "verification tools are
                checked-in code... nobody writes a throwaway script to
                verify the same thing twice").

**Verified**    `live — all of it, on this machine`, against a real
                single-node Redpanda (`docker-compose.dev.yml`, confirmed at
                12 partitions via `rpk topic describe`). `capture-feeder`
                fed `raw_export_500.json` (500 records, 12 partitions) onto
                `topic-event-audit`; reading the topic back and diffing
                against the source (`tools/golden`'s canonicalizer,
                per-partition, sha256 of each record's value) showed **0
                mismatches across all 12 partitions** - partition
                assignment, per-partition order, key, headers and timestamp
                all exactly preserved. All three named goldens
                (`01_MWK_to_ZMW_PRIMARY`, `raw_topic_slice_partition2`,
                `raw_export_500`) recorded live and then re-verified clean
                in a second, independent run (`npm run golden`). The
                golden-diff mechanism was itself proven to fail correctly -
                pointing a mismatched capture at an existing golden produced
                a 500-mismatch report and a non-zero exit code.
                `ppa-stub` exercised end to end: `/health/live` and
                `/health/ready` both 200; `POST /control {"mode":"503"}`
                then a real mTLS-authenticated `POST /TRANSFERS` returned
                503; a hand-crafted schema-valid envelope returned 200 and
                appeared in `output/received.jsonl`; a schema-invalid one
                (missing `fspiop-destination`) returned 400 with the ajv
                error detail; `4xx` with a custom `code`, and `afterN`
                (first two calls clean, the third faulted) both behaved
                exactly as configured. **mTLS is genuinely enforced, not
                decorative** - a request with no client certificate failed
                at the TLS layer itself (`tlsv13 alert certificate
                required`), never reaching the route handler. The scenario
                library was exercised directly: `duplicate-record` fed 42
                items for a 41-record source (the duplicate present);
                `corrupt-record` and `missing-signature` each tagged the
                correct single record in their console output; `ppa-503`
                correctly set the running stub's fault state over HTTP.
                `npm run lint` (zero errors, 48 warnings - all
                `no-magic-numbers`, acceptable per engineering-rules.md §5)
                and `npx tsc --noEmit` (both `tsconfig.json` and
                `tools/tsconfig.json`) both clean. `npm test` unaffected -
                43 passing, 100% coverage, confirming this phase's changes
                do not touch the Phase 0 surface.
                **Not verified:** the `mla-restart` and `two-mla-instances`
                scenarios need the real MLA consumer (Phase 2 onward) and
                are documented as procedures, not run. `broker-restart`'s
                feeder/producer-reconnect mechanics are runnable now; full
                proof of MLA's own offset-resume-on-restart needs Phase 2's
                consumer. `.gitlab-ci.yml` has still never run on a runner -
                this phase adds nothing that changes that.

**Diverged**    From `environment-simulation.md` §3.3's literal description
                ("feed a capture → collect the stub's JSONL → diff against a
                golden") - **the golden-file mechanism built and exercised
                this phase diffs a Kafka topic read-back against the source
                capture, not a `ppa-stub` JSONL against a golden.** Phase 1
                has no envelope-construction logic (D3/D4/D7 exist as
                decisions, not code), so there is nothing to POST to
                `ppa-stub` from a real pipeline yet - building one to
                manufacture something to diff would be exactly the
                "pipeline logic that reads a real record's meaning" this
                phase's checklist explicitly excludes. What was built proves
                the property this phase's own exit criterion actually
                names ("verified by reading the topic back and diffing
                against the source") and generalises directly: from Phase 2
                onward, `ppa-stub`'s own JSONL becomes the natural
                extension of the same `tools/golden` machinery, once there
                is a real envelope builder to produce it.
                **This machine's `docker compose` (the snap CLI plugin)
                fails silently** - every subcommand exits non-zero with no
                output, traced via `journalctl -k` to an AppArmor `DENIED`
                on the abstract Unix socket the plugin uses to talk back to
                the CLI (`snap.docker.docker` `bind` `DENIED`). Worked
                around with a standalone `docker-compose` v2 binary (talks
                to the daemon directly, unaffected); `docker-compose.dev.yml`
                itself is unchanged and portable - this is a local
                machine quirk, recorded in `tools/README.md` §1, not a
                project dependency change.
                `tools/tsconfig.json` sets `noUncheckedIndexedAccess: true`,
                which the root `tsconfig.json` does not - tools/ is a
                separate project by design (`continue - before harness.md`
                §4), and the stricter setting is what makes several
                deliberate `undefined` guards in the CLI parsers and the
                golden differ meaningful rather than lint-flagged as
                unreachable.

**Left open**   D3 remains open, unchanged - not this phase's to settle
                (§13.1). Envelope construction, classification and
                canonical selection remain unbuilt, exactly as this phase's
                checklist required. The captures-in-repo decision recorded
                last phase is now actually executed: `__tests__/fixtures/`
                holds the full pack, ~9.5MB, committed verbatim.
                `environment-simulation.md` §4's limits all still hold
                exactly as written: no genuine DFSP signature can be
                verified (no public keys), `ppa-stub`'s 200 asserts contract
                validity only, not a durability guarantee; throughput and
                rebalance realism are both still unproven claims for later
                phases.

### US-MLA-01 — Subscribe to the Mojaloop Audit Topic         [2026-09-02/03]

Full checklist detail and the live-verification narrative: `plan.md` §5
(Phase 2), items 1–3. Epic documentation:
`EPICS/EPIC-1-kafka-subscription-audit-topic-ingestion/US-MLA-01/`.

**Built**       Kafka consumer extended to a real subscriber:
                `src/interfaces/kafka.interface.ts` (`ConsumedMessage`,
                `MessageHandler`, `KafkaConnection.subscribe/run/advance/
                pause/resume`) and `src/clients/kafka.client.ts`
                (implementation - `run` always calls `consumer.run({
                autoCommit: false, ... })`; `advance` does the Kafka
                "commit is one past the consumed offset" arithmetic in
                `BigInt`). The dedicated, externally-configured,
                R-18-commented `groupId` has existed since Phase 0; this
                story is what makes the group actually join the topic.
                Canonical-record selection per **D1**:
                `src/services/canonical-record.service.ts` +
                `src/interfaces/audit-record.interface.ts` -
                `CANONICAL_ACTION_BY_OPERATION` and `isCanonicalRecord`,
                ported deliberately from the POC's live-verified
                `logic.service.ts` (§12 V1's rule), plus the
                `prepareTransfer` payload shape-check
                (`isTransferRejection`: `TxInfAndSts.StsRsnInf` present and
                the hallmark field `ilpPacket` absent - the shape is the
                only signal read; the `/error` URL is corroboration, never
                a code path).

**Tests**       83 tests across the two files (54 for `kafka.client.ts`,
                29 for `canonical-record.service.ts`), 100% coverage.
                Categories: every `KafkaClient` method's failure/edge path
                (legacy no-headers messages, array-header edge cases,
                pause/resume, BigInt offset arithmetic); every row of
                `CANONICAL_ACTION_BY_OPERATION`, the party-lookup and
                no-`operation`-tag edge cases, and one synthetic
                both-shapes-at-once case clearly labelled as testing the
                predicate's own AND-logic, not a real capture.

**Verified**    `live` - two distinct proofs, both against a real
                Redpanda, not a mock. (1) The `KafkaClient` primitive
                alone: a fresh consumer group consumed all 41 records of
                `raw_topic_slice_partition2.json`, advanced only the
                first; a second process under the same group, on rejoin,
                did not redeliver the advanced record and redelivered
                every un-advanced one; `pause`/`resume` froze consumption
                at exactly 3 records and resumed to completion on command.
                (2) The full offset-resume guarantee re-proven through the
                real per-record handler, including a genuine mid-feed
                `SIGKILL` while `capture-feeder` was still actively
                producing - full detail and numbers in §5's exit-criterion
                section above. Canonical selection verified against real
                captures (`classification-cases.json`,
                `transfer-rejections.json`, corridor
                `01_MWK_to_ZMW_PRIMARY`) - a pure function, so no broker
                interaction applies to it directly (engineering-rules.md
                §10.3).

**Diverged**    **D1** - the POC's per-operation table plus the
                `prepareTransfer` shape-check, not the story's blanket
                "ingest only `start`" rule (§12 V1). The story's own
                Acceptance Criteria state the superseded rule verbatim;
                per §3.1's note, correcting `story.md` is the BA's action
                - already communicated to them - not an engineering task,
                and this table is what was built against.

**Left open**   The real, CCH-issued consumer group ID (Todo 1; §13.2,
                unchanged - gates production, not this story). Confirming
                the audit-topic feed mechanism with the Mojaloop Partner
                (Todo 5, Open Item #7) - unchanged, Phase 8 (§11). The
                broker-reconnect/backoff path (Method step 5) relies on
                kafkajs's own built-in logic and is proven live for a
                clean process kill/restart; a genuine mid-stream broker
                *outage* (as opposed to an MLA restart) is the still-only
                procedure-documented `broker-restart` scenario
                (`tools/scenario-library/`, Phase 1 §16) - its MLA-side
                half remains unexercised.

### US-MLA-02 — Distinguish Event Types Within the Audit Topic Stream
                                                               [2026-09-02/03]

Full checklist detail: `plan.md` §5, items 4–5. Epic documentation:
`EPICS/EPIC-1-kafka-subscription-audit-topic-ingestion/US-MLA-02/`.

**Built**       `src/services/event-classification.service.ts` -
                `EVENT_TYPE_BY_OPERATION` (operation alone, per **D2**,
                against the story's own method+resource-fallback
                proposal), `PARTY_LOOKUP_OPERATIONS`, and a three-way
                `ClassificationResult` (`classified` / `party-lookup` /
                `unclassifiable`) so party lookup can never collapse into
                the same bare skip a genuine classification gap would
                produce. Resolves the classification table's
                `commitTransfer` double-row ambiguity (cross-reference.md
                §3.2) per **D5**: the FXTRANSFER-side commit leg's real
                `operation` tag is `notifyFxTransfer`, never
                `commitTransfer`, and `notifyFxTransfer` is non-canonical
                (D1) so it never reaches this function regardless -
                verified directly, not just argued. FX-quote-rejection
                detection (`isFxQuoteRejection`,
                `canonical-record.service.ts`) - no `operation` tag plus
                `StsRsnInf` present, reusing `isTransferRejection`'s
                shape-check with the no-tag discriminator; the module
                comment documents that a caller **must** check this before
                canonical selection, since the record would otherwise
                silently read as an ordinary non-canonical skip.

**Tests**       24 new tests (19 for classification, 5 for
                `isFxQuoteRejection`), 100% coverage. Every table row
                (including FXTRANSFER's three-leg lifecycle), all three
                party-lookup operations, the no-`operation`-tag edge case,
                a rejected `prepareTransfer` (still classifies TRANSFER -
                rejection affects `msgType`/`error` in Phase 3, not
                `eventType`), all 19 curated FX-quote-rejection records,
                and the negative case (a transfer rejection must not
                double-count as an FX-quote rejection).

**Verified**    `live`, through the full per-record handler (§5's
                exit-criterion section) as well as against real captures
                directly (engineering-rules.md §10.3 - pure functions, no
                broker interaction of their own). Across the two live
                runs: every classified record landed in the correct
                bucket with zero misclassifications (15 forwarded across
                4 event types in the 41-record run; 121 forwarded across 4
                event types plus 19 FX-quote-rejections correctly counted
                distinctly in the full 500-record run), zero
                `unclassifiable` hits in any real capture to date.

**Diverged**    **D2** - `operation` alone as the classification signal,
                not the story's own method+resource-fallback proposal (§12
                V2 - matches the POC, no divergence from it). **D5** -
                `commitTransfer`/`egress` is the TRANSFER trigger, not
                `fulfilTransfer`/`start` as the story states, with the ISO
                `TxSts` vocabulary (`COMM`/`RESV`) authoritative (§12 V5 -
                matches the POC). Both are story corrections owed to the
                BA (§3.1's note), not engineering changes made here.

**Left open**   Whether `operation`/`Content-Type`/`FSPIOP-HTTP-Method`
                survive identically in CCH's production feed - Open Item
                #7, Phase 8 (§11, §14 Q6). Whether the per-operation
                canonical shape classification depends on is a stable
                contract beyond this capture window, or an artefact of it
                - §14 Q2, re-verified in Phase 8. A rejected transfer
                *fulfil* and a rejected FX transfer have never been
                captured - every classification branch for them is
                specification-only (§14 Q3).

### US-MLA-03 — Decode Base64-Encoded Transfer Payloads       [2026-09-02/03]

Full checklist detail: `plan.md` §5, items 6–7. Epic documentation:
`EPICS/EPIC-1-kafka-subscription-audit-topic-ingestion/US-MLA-03/`.

**Built**       `src/services/payload-selection.service.ts` -
                `selectPayload` returns `content.transformedPayload ??
                content.payload`, per **D6**, ported deliberately from the
                POC's `buildEnvelope` - one fallback expression, correct
                for every event type without branching on `eventType`.
                `src/services/audit-record-parser.service.ts` -
                `parseAuditRecord`, the boundary parse
                (engineering-rules.md §5): raw Kafka value → typed
                `AuditRecordBody` or a named `unreadable` outcome with a
                reason (empty value, malformed JSON, or a structurally
                invalid record - missing/malformed
                `metadata.event.action`/`metadata.trace.tags`), ported
                from the POC's `parseAuditMessage` and extended with the
                structural shape check the POC only ran informally.

**Tests**       16 new tests (8 for payload selection, 8 for the parser),
                100% statements/lines/functions, 99.27%+ / 95.45%+ branches
                respectively (both above the 96% global gate). Payload
                selection: quote-family selecting `transformedPayload`,
                transfer-family selecting `payload` directly, the
                party-lookup no-body case, and the fixed hallmark-field
                bug (`prepareFxTransfer` does not carry `ilpPacket`, only
                TRANSFER does - caught by a failing test, not inspection).
                Parser: null value, malformed JSON (including the exact
                shape `capture-feeder --corrupt` produces), non-object
                JSON, missing `content`/`metadata`, invalid action, missing
                `tags`, and a real-capture round-trip success case.

**Verified**    `live`, through the full per-record handler (§5's
                exit-criterion section): every one of the 500 records fed
                across the two live runs produced a defined outcome with
                no unhandled exception; every forwarded record carried a
                correctly-selected, non-empty body (the defensive "no
                body" path was never hit in any real capture, matching
                §1.1's observation that every canonical record carries
                one). The parser's own success/failure paths are verified
                against real captures and deliberately malformed inputs -
                a pure boundary-parse function, so no broker interaction
                applies to it directly (engineering-rules.md §10.3).

**Diverged**    **D6** - select the FSPIOP form
                (`transformedPayload`/`payload`); decoding
                `content.dataUri` is treated as available-on-demand, not
                built, since nothing in this pipeline names a concrete
                need for it yet (building it now would be the speculative
                abstraction engineering-rules.md §4 rules out). This
                supersedes the story's Acceptance Criteria and Method
                wholesale (§12 V6 - matches the POC, no divergence from
                it; "the *story* diverges. Get US-MLA-03 corrected rather
                than quietly ignoring it"). `selectPayload` returns
                `undefined`, not `{}` as the POC did, when neither field is
                present - a deliberate divergence from the POC itself, so
                an empty body is distinguishable rather than silently
                forwarded. The story's "malformed base64" test case (Todo
                2) does not apply under D6 - there is no decode step left
                to fail; "malformed JSON" / "structurally invalid record"
                is the equivalent failure mode, and `audit-record-parser
                .service.ts` covers it directly.

**Left open**   Nothing story-specific. The phase-level gaps this story's
                completion exposed - the golden-file comparison and a
                genuine mid-feed restart proof - are both closed; see §5's
                exit-criterion section above.

### US-MLA-04 — Construct a Standard Event Envelope           [2026-09-03]

Full checklist detail and the live-verification narrative: `plan.md` §6
(Phase 3), items 1-3. Epic documentation:
`EPICS/EPIC-2-envelope-construction-jws-validation/US-MLA-04/`.

**Built**       `src/services/envelope-builder.service.ts` -
                `deriveMsgType` (POST -> `request`, PUT/PATCH -> `callback`,
                read from `tags.httpMethod`, never re-derived from
                `operation`), `extractId` (**D3**, settled this story as
                Option A - per-`eventType`, straight off
                `quoteId`/`conversionRequestId`/`transferId`/
                `commitRequestId` - with a confirmed fallback for the one
                exception found while building it: `putFxQuotesByID`'s
                canonical `start` record carries no `conversionRequestId`
                tag at all, only its discarded `egress` twin does; the value
                is recovered from the trailing segment of `tags.httpPath`,
                verified against all 14 real pairs in `raw_export_500.json`,
                zero exceptions - this corrects `plan.md` §3.2's own table,
                which counted the tag present without checking which half
                carried it), and `buildEnvelope` (assembly plus the
                completeness check, **D7**'s `error` field populated from
                `TxInfAndSts.StsRsnInf.Rsn.Prtry`/`.AddtlInf` on the one
                rejection shape that ever reaches this story -
                `isTransferRejection`, reused from `canonical-record.service.ts`
                rather than reimplemented). `src/services/envelope-schema-
                validator.service.ts` wires the ajv schema
                (`event-envelope.schema.json`) verbatim shared with
                `ppa-stub`, as a defensive backstop after `buildEnvelope`'s
                own check. `src/services/envelope-pipeline.service.ts`
                composes Phase 2's `processRecord` with this story's
                `buildEnvelope` (and US-MLA-05's `verifyJws`, ordered
                before it per core-knowledge.md §3.2) into one
                `buildEnvelopeFromKafkaValue`, extending Phase 2's
                five-reason `SkipReason` with `incomplete-envelope` and
                `invalid-envelope-schema`. `src/interfaces/audit-record.interface.ts`'s
                `tags` type gained explicit named optional fields
                (`httpMethod`, `httpPath`, `quoteId`, `conversionRequestId`,
                `transferId`, `commitRequestId`) and `content.headers`
                widened to `Record<string, string | undefined>` - both
                were silently typed as always-present before this story,
                which would have let a real "missing fspiop-source" case
                pass TypeScript's own check unnoticed.

**Tests**       36 tests: 28 in `envelope-builder.service.test.ts` (every
                event type's `msgType`/`id` extraction including the
                `putFxQuotesByID` fallback and its own synthetic
                missing-tag/empty-segment edge cases, both `msgType`
                values, all four missing-field rejections, the `error`
                field populated from the real `transfer-rejections.json`
                fixture versus left undefined on an ordinary transfer), 8
                in `envelope-pipeline.service.test.ts` shared with
                US-MLA-05 (composition and ordering: a Phase 2 skip
                short-circuits before JWS or envelope construction run; an
                incomplete envelope from a genuinely stripped real record,
                not a mocked outcome; the schema-validation backstop forced
                via a spy since `buildEnvelope`'s own check makes it
                otherwise unreachable). 100% statements/functions/lines,
                97.05%/100% branches respectively on the two files' own
                numbers; the full suite clears the 96% gate on every metric
                (100/96.36/100/100 aggregate).

**Verified**    `live` - the full Phase 3 exit criterion (`plan.md` §6),
                against a real Redpanda broker and a real `ppa-stub`, not a
                mock. All 41 records of `raw_topic_slice_partition2.json`,
                fed unmodified through a real MLA instance
                (`KAFKA_ENABLED=true`), produced a defined outcome with
                zero unhandled exceptions: 23 `egress` skips, 3
                `party-lookup` skips, 15 `SECURITY: invalid FSPIOP-Signature`
                rejections (expected - no real DFSP key is held; see
                US-MLA-05). Separately, a genuinely re-signed record
                (`tools/dfsp-keys` + `capture-feeder --resign`) produced
                `Forwarded FXQUOTE`, and the exact envelope built by the
                real `buildEnvelopeFromKafkaValue` pipeline was POSTed over
                real mTLS to a live `ppa-stub` and accepted - HTTP `200`,
                `{"status":"accepted"}`, confirmed byte-for-byte in
                `received.jsonl`. This is the first story whose output PPA
                can actually receive.

**Diverged**    **D3** - resolved during this story as **Option A**
                (per-`eventType`, matching US-MLA-04's own text), agreed
                directly with PPA's owners; PPA accepts the cross-stage
                join this moves onto it (§3.1, §3.2 - no longer
                provisional). §12 V3 updated accordingly. The
                `putFxQuotesByID` httpPath-fallback finding above is new
                evidence beyond §3.2's own table, not a divergence from a
                decision, but is recorded here since it changes what
                "read straight off the event" means for that one operation.

**Left open**   Envelope versioning (R-23) - still unaddressed, per
                US-MLA-04's own Assumptions and core-knowledge.md §5.
                Delivery to PPA is not this story's job (Phase 5) - the
                mTLS POST proven live above is a one-shot verification call
                made for this story's own exit criterion, not the retry/
                circuit-breaker/offset-gated delivery client US-MLA-06/07
                will build.

### US-MLA-05 — Validate JWS Signatures on DFSP-Originated Events [2026-09-03]

Full checklist detail and the live-verification narrative: `plan.md` §6
(Phase 3), items 4-7. Epic documentation:
`EPICS/EPIC-2-envelope-construction-jws-validation/US-MLA-05/`.

**Built**       `src/interfaces/jws.interface.ts` - the real wire shape
                (`FspiopSignatureHeader`: `{signature, protectedHeader}`,
                both base64url, confirmed against all 286 signed records in
                `raw_export_500.json` - not a three-part compact JWS
                string) and the three-outcome `PublicKeyStore` port
                (`found`/`not-found`/`unavailable` - the third is what
                makes a key-source outage distinguishable from a genuine
                signature failure). `src/clients/public-key-store.client.ts`
                - `FilePublicKeyStoreClient`, a file-backed store hot-
                reloaded via `fs.watch` so a new `<dfspId>.pem` is live
                with no restart; a broken store reports `unavailable` for
                every DFSP rather than clearing its last-known-good keys
                silently. `src/services/jws-verification.service.ts` -
                `verifyJws`, real RS256/384/512 verification via Node's
                built-in `crypto.verify` (no JOSE/JWS library added - none
                existed, none was needed). Verifies against
                `JSON.stringify(selectPayload(record))` - the same `body`
                the envelope carries, not `content.payload` (confirmed a
                different, Mojaloop-internal ISO shape for quote-family
                records) - reasoned and empirically checked in the module's
                own comment (see **Left open** below for what that check did
                and did not prove). `tools/dfsp-keys/generate-keys.ts` (+
                `npm run keys:generate`) and `tools/capture-feeder/resign.ts`
                (+ `--resign`/`--tamper-body`) are the local-keypair
                mechanism `plan.md` §6 names as the only honest way to
                exercise this story without real DFSP keys.

**Tests**       29 tests own to this story: 15 in
                `jws-verification.service.test.ts` (genuinely generated
                RSA keypairs and real `crypto.sign`/`crypto.verify` - all
                three algorithms, tampered body, wrong key, missing/
                malformed/shape-invalid header, key-outage vs. not-found
                vs. unsupported-alg, a malformed key making `crypto.verify`
                throw), 6 in `public-key-store.client.test.ts` (against a
                real temporary directory, not a mocked filesystem,
                including the actual `fs.watch` hot-reload), plus 5 new
                cases added to `ingestion-consumer.service.test.ts`
                (`SECURITY`-marked logs for missing/invalid signature, a
                plain non-`SECURITY` log for a key-source outage, and the
                two envelope-construction cases shared with US-MLA-04)
                and the signature-specific half of the 8 tests in
                `envelope-pipeline.service.test.ts` (missing-signature and
                key-outage short-circuiting before envelope construction
                runs). 100% statements/functions/lines on every new file;
                96.87-100% branches per file, 96.36% branches aggregate
                across the whole suite - clears the 96% gate.

**Verified**    `live` - real cryptographic verification against a real,
                generated RSA keypair, not a fake or a mock. In addition to
                US-MLA-04's live run: (1) a locally re-signed record
                verified (`Forwarded FXQUOTE`); (2) the same record with
                `--tamper-body` added failed as `SECURITY: invalid
                FSPIOP-Signature - signature does not match body/key`
                (confirmed unambiguously via an isolated one-off script
                before the aggregate live-run log, since the live log's
                15 real signed records sharing the same registered test
                key produce the identical failure text for the mundane
                reason of key mismatch, not tampering - both are correctly
                the same failure class, but that means the live log alone
                cannot isolate which one line was the deliberate tamper);
                (3) `--strip-signature` failed as the distinctly-worded
                `SECURITY: missing FSPIOP-Signature`, never conflated with
                "invalid"; (4) restarting MLA with `JWS_PUBLIC_KEY_DIR`
                pointed at a nonexistent directory made every one of the
                15 canonical signed records - including a resigned one
                that would otherwise have verified - fail as
                `Public-key store unavailable` (no `SECURITY` marker),
                never as "invalid signature."

**Diverged**    None from the story text on substance. Confirms cross-
                reference.md §12 V7 (pure addition - the POC only ever
                checked header *presence*, never performed real
                cryptographic verification; no POC code existed to port).

**Left open**   **Genuine verification against a real COMESA/DFSP
                signature stays blocked** (`plan.md` §13.1/§14 Q1) - this
                story proves the mechanism correct against fixtures this
                codebase signs itself, never against a real DFSP signature.
                The byte-exactness question this handoff's own §8 named as
                the first trap is checked, not fully closed: `JSON.stringify
                (selectPayload(record))` was confirmed to round-trip
                byte-identically for the one sampled record checked
                directly (`value.rawPayload` decoded to a string identical
                to `JSON.stringify(value.payload)`), which shows the audit
                pipeline itself only ever held a parsed-then-restringified
                body - but this does **not** prove a genuine DFSP's
                original request bytes would restringify identically
                (key order, whitespace, number formatting could all differ
                in ways this codebase cannot detect without the original
                bytes). This is exactly why item (1) above stays blocked
                pending COMESA. Where this story's security alert actually
                routes to is undecided (US-MON-01, R-37) - met here by a
                `SECURITY`-marked structured log, the honest interim
                equivalent, not a wired alert (Phase 6). DFSP public key
                storage/rotation policy (FSD §10.1) and how MLA keeps its
                key set current in production (pushed/synced store vs. a
                live lookup service) remain CCH/Mojoloop Partner questions,
                unaffected by this story choosing the file-backed
                implementation for the harness.

### US-PII-01 — Classify and Tokenize Party Identity Fields Within MLA [2026-09-04]

Full checklist detail and the live-verification narrative: `plan.md` §7
(Phase 4). Epic documentation:
`EPICS/EPIC-PII-tokenization/US-PII-01/`.

> **STATUS: NOT CLOSED.** The mechanism below is built, tested above the
> coverage gate, and live-verified against the fail-closed default. This
> entry exists to track that work honestly, not to claim the story is
> done: `plan.md` §13.1 names the reason directly - "PII fail-mode
> undecided -> Phase 4 cannot be called complete" - and that CCH decision
> is still open. See **Left open** below. Recorded now, ahead of closure,
> because `CLAUDE.md`'s "External decisions" rule requires the mechanism's
> real state to be visible the moment it exists, not held back until a
> decision that is not engineering's to make finally lands.

**Built**       `src/services/tokenization.service.ts` - `tokenizeBody`,
                walking `TOKENIZE_PATHS_BY_EVENT_TYPE` (core-knowledge.md
                §4.1's Fields-to-Tokenize table, as data): three paths for
                QUOTE (`payer`/`payee.partyIdInfo.partyIdentifier`,
                `payer.personalInfo.complexName`), two for FXQUOTE (the
                same two `partyIdInfo` paths, "where present"), and
                **no row at all** for TRANSFER/FXTRANSFER - confirmed
                against real captures, not assumed: every
                `prepareTransfer`/`prepareFxTransfer` `start` record
                checked directly carries only FSP ids, amounts, `condition`
                and the undecoded `ilpPacket`, never a `partyIdInfo` or
                `personalInfo` field. An allowlist, never a blocklist, so
                a field not named (an amount, `ilpPacket`, `condition`) is
                structurally unreachable by the walker - not excluded by a
                check that could itself be wrong. Wired into
                `envelope-pipeline.service.ts` as core-knowledge.md §3.2's
                step 6, strictly between `verifyJws` (step 5) and
                `buildEnvelope` (step 7) - N3.

**Tests**       20 in `tokenization.service.test.ts` (100%/95.65%/100%/100%
                own coverage; the one uncovered branch is `setAtPath`'s
                empty-path guard, unreachable at runtime by construction,
                required only so `tools/tsconfig.json`'s
                `noUncheckedIndexedAccess` type-checks the destructure -
                see the function's own comment), covering every QUOTE/
                FXQUOTE field the table lists, the payee-legal-name
                exclusion (deliberate, not an oversight - absent from the
                table), the amount-never-touched regression case per event
                type, determinism, no mutation of the caller's body, the
                secret-unavailable path, and both TRANSFER/FXTRANSFER
                event types passing through with the secret store never
                even consulted. Plus 4 new cases in
                `envelope-pipeline.service.test.ts` (the ordering proof,
                its inverse, the `pii-secret-unavailable` skip, and a real
                TRANSFER record's body reaching the envelope byte-for-byte
                unchanged). Full suite: 243 tests, 100%/97.69%/100%/100%
                aggregate, above the 96% gate.

**Verified**    `live` - a `postQuotes` record, re-signed
                (`capture-feeder --resign`), fed onto the real harness
                broker and consumed by a genuinely running MLA instance
                (`KAFKA_ENABLED=true`), logged `Forwarded QUOTE` - proving
                the real Kafka-driven pipeline, not a direct function call,
                exercises classification, JWS verification and
                tokenization in the correct order. Separately, a new
                checked-in tool (`tools/verify-tokenization/run.ts`,
                `npm run verify:tokenization`) ran the same real pipeline
                function against real captures and POSTed the resulting
                envelopes over real mTLS to a real `ppa-stub`: confirmed
                `tkn_`-prefixed tokens in every listed QUOTE field
                (recorded in `received.jsonl`), the identical token on a
                second, fully independent run (fresh process, secret file
                re-read from disk), the amount reaching `ppa-stub`
                unchanged, and a real TRANSFER record's body reaching
                `ppa-stub` with zero fields altered.

**Diverged**    Nothing from the story text. One finding beyond what either
                document claims: `cch-pii-user-stories.md`'s "where
                present" hedge on FXQUOTE's `partyIdInfo` fields is
                empirically never present - checked directly against all
                96 FXQUOTE records (`postFxQuotes`/`putFxQuotesByID`, both
                legs) across `raw_export_500.json`, zero matches. The code
                still handles the field generically (an absent path is
                never a failure), so this costs nothing and is correct if
                a future capture ever proves the finding wrong - recorded
                here as new evidence, not acted on by removing the path.

**Left open**   **The fail-mode decision (block vs. pass-through-
                unprotected on a tokenization failure) - a CCH decision,
                not engineering's, and per `plan.md` §13.1 the one thing
                that gates calling this story complete.** Built and
                live-verified against the recommended fail-closed default
                (`plan.md` §7.1 #1): a `pii-secret-unavailable` outcome
                skips the event, logs it, and never forwards raw PII. If
                CCH answers differently, this is a one-line change to
                `envelope-pipeline.service.ts`'s single branch on
                `tokenized.outcome`, not a rebuild. **This entry stays open
                until that answer lands and is recorded here** - a later
                entry (not an edit to this one, per this section's own
                append-only rule) will state the final decision and close
                the story. Also open, but explicitly not blocking this
                story's own completion once the fail-mode answer lands
                (US-PII-02's own entry, below, carries these in full):
                secret rotation strategy, what "protected" must mean
                legally, and named ownership of the production secret.

### US-PII-02 — Tokenization Construction and Secret Handling [2026-09-04]

Full checklist detail and the live-verification narrative: `plan.md` §7
(Phase 4). Epic documentation:
`EPICS/EPIC-PII-tokenization/US-PII-02/`.

> **STATUS: NOT CLOSED.** Same reason as US-PII-01 above - the mechanism
> is built and live-verified; the fail-mode decision this story's own
> readiness-gating behaviour depends on being *acted on* correctly is
> still CCH's to make.

**Built**       `src/interfaces/pii.interface.ts` - the `PiiSecretStore`
                port (`getSecret(): 'available' | 'unavailable'`, mirroring
                `PublicKeyStore`'s two-outcome shape for the same reason:
                a caller must distinguish "genuinely failed to load" from
                any other falsy state, since that distinction is what
                gates `/health/ready`). `src/clients/pii-secret.client.ts`
                - `FilePiiSecretClient`, reads one mounted file once at
                construction and stores the resolved
                `PiiSecretLookupResult` as a single value (not two separate
                optional fields needing a defensive, provably-unreachable
                fallback to satisfy the type checker - engineering-rules.md
                §5's "no dead code", found and fixed while building this).
                Deliberately does not `fs.watch` the file, unlike the
                public-key store - US-PII-02's own AC asks only for
                "loaded once at startup", and rotation strategy is
                undecided (see **Left open**); hot-reloading a single
                active secret ahead of that decision would silently pick
                "no overlap window" as the rotation shape without anyone
                deciding it. `tokenizeValue` (`tokenization.service.ts`) -
                HMAC-SHA256 keyed hash, `tkn_` prefix, no key-version tag
                (rotation is undecided; a versioning scheme is `plan.md`
                §7.1 #2's recommendation for *when* CCH decides, not
                something to pre-build). `health.service.ts` -
                `resolvePiiSecretReadiness`/`buildReadiness` extended with
                a `piiSecret: 'UP' | 'DOWN'` field, folded into overall
                `status` (no `DISABLED` branch, unlike Kafka - this story
                names no opt-out). `tools/pii-secret/generate-secret.ts` +
                `npm run pii-secret:generate` - the local secret-generation
                mechanism, mirroring `tools/dfsp-keys/generate-keys.ts`'s
                role for JWS.

**Tests**       5 in `pii-secret.client.test.ts`
                (100%/80%/100%/100% own coverage; the one uncovered branch
                - a non-`Error` throw from `node:fs` - is defensive only:
                Node's `fs` always throws a genuine `Error`, and forcing
                the non-`Error` case requires mocking the `node:fs`
                specifier itself, which both `jest.spyOn` and `jest.mock`
                fail to do cleanly for this exact module in this project's
                Jest/ts-jest setup - the same accepted, documented gap
                `public-key-store.client.ts`'s identical ternary already
                carries). Plus the `tokenizeValue` unit tests counted under
                US-PII-01, and 4 new cases in `health.service.test.ts` /
                1 in `fastify.client.test.ts` proving `piiSecret: DOWN`
                pulls overall `status` to `DOWN` independently of Kafka's
                own state, both directions.

**Verified**    `live` - with the secret file removed and a genuinely
                running MLA instance restarted, `/health/ready` returned
                `{"status":"DOWN","kafka":"UP","piiSecret":"DOWN"}` -
                Kafka staying `UP` while overall `status` still goes
                `DOWN` proves the two signals gate independently, not that
                one happens to mask the other. Restoring the file and
                restarting returned `piiSecret:"UP"`. Determinism (same
                secret, same input, same token) verified across two fully
                independent process runs via `tools/verify-tokenization`,
                not merely within one test process.

**Diverged**    Nothing from the story text. Two design choices worth
                recording as reasoned deviations from the most literal
                reading of engineering-rules.md, not divergences from the
                story: (1) `FilePiiSecretClient`'s "does not report ready"
                behaviour reads engineering-rules.md §8 ("if a secret
                fails to load, the service does not report ready") as the
                specific rule for this case, not §6.1's general
                Fatal-example table (which lists "secret missing at
                startup" under "refuse to start") - US-PII-02's own AC and
                core-knowledge.md §4.2 are unambiguous that a readiness
                signal, not process exit, is the required behaviour; (2)
                `ingestion-consumer.service.ts`'s five pre-existing
                `?? 'unknown reason'` fallbacks (Phase 3) were removed
                alongside this story's own new one, once checked and found
                genuinely dead - every one of the six skip reasons that
                interpolate `detail` is provably always populated by its
                own construction site. A pre-existing-code touch, done
                for the coverage gate but justified independently as real
                dead-code removal, not a game against the number.

**Left open**   **Same CCH fail-mode decision as US-PII-01's own entry -
                one decision, tracked once there, referenced here rather
                than duplicated.** Specific to this story, all three
                explicitly *not* blocking this story's own completion once
                the fail-mode answer lands (`plan.md` §7.1 #2-#4, §13.2 -
                "gates production, not the work ahead"): **secret rotation
                strategy** (versioned keys recommended, not built - no
                rotation mechanism exists beyond "restart with a new
                file"); **what "protected" must mean legally** (a keyed
                hash is one-way by construction - it verifies, it does not
                let anyone, even holding the secret, recover an original
                value from a token; if CCH Legal needs genuine reversibility
                for an authorized lookup, that is separate, unbuilt
                infrastructure, not a property of what exists - flagged
                precisely for this reason in `plan.md` §7.1 #3); **named
                ownership of the production secret** (recommended to follow
                whoever already owns the JWS certificate material, not yet
                confirmed).

### US-PII-01 — Fail-mode reclassified to transient, per COMESA (gate item #1) [2026-09-04]

A new, later entry per this section's own append-only rule - the US-PII-01
entry above stays exactly as written; this records what changed since. Full
context: `plan.md` §7.1 #1 (COMESA's answer, verbatim) and
`continue/continue - before phase 5.md` §2 (the gate this closes half of).
Epic documentation: `EPICS/EPIC-PII-tokenization/US-PII-01/` (updated
alongside this entry, not superseded by it).

> **STATUS: gate item #1 done; US-PII-01 itself still not formally closed.**
> COMESA answered [2026-09-04]: "if tokenization fails, fail the transaction
> and retry" - transient, not the permanent skip the story originally built
> against. That is now implemented, tested, and live-verified. **US-PII-02's
> own open item (secret rotation, gate item #2) is untouched by this entry**
> - nothing below changes `FilePiiSecretClient`'s hot-path behaviour or adds
> a reload mechanism. **Gate item #2 is itself now resolved [2026-09-18,
> spec confirmed 2026-09-22]** - no rotation, a long-lived key, needing no
> build - see US-PII-02's own "gate item #2 reversed" entry. Both gates that
> `continue - before phase 5.md` §2 named are now answered; whether that
> makes Phase 4 ready for formal closure (the exit-criterion writeup, the
> epic docs) is a step still to be done, not yet done by this note.

**Built**       `pii-secret-unavailable` moved from `engineering-rules.md`
                §6.1's *permanent* row to its *transient* row, mirroring the
                MLA→PPA shape `plan.md` §8.1 #2 recommends, per COMESA's own
                "for consistency" instruction - built ahead of Phase 5's own
                delivery client, which does not exist yet. The pure
                classification in `envelope-pipeline.service.ts` is
                **unchanged** - it still returns `pii-secret-unavailable`
                exactly as before; only the caller's handling of that
                outcome changed. New: `src/services/retry-backoff.service.ts`
                (`computeBackoffMs` - full-jitter exponential backoff, a
                value drawn uniformly under a 1×/2×/4× ceiling per attempt,
                an injectable `random` for deterministic tests) and
                `src/services/pii-circuit-breaker.service.ts`
                (`PiiCircuitBreaker` - a single, **process-wide** consecutive-
                failure counter, deliberately not per-partition: the PII
                secret is one in-process resource every partition's
                tokenization reads identically, unlike PPA's genuinely
                per-call HTTP dependency, so a shared counter reflects what
                is actually failing rather than having several partitions
                independently re-derive the same fact). `ingestion-consumer.
                service.ts` rebuilt around this: a blocking, in-`eachMessage`
                retry burst (initial attempt + `PII_MAX_RETRIES` further
                attempts, default 3, exponential-plus-jitter backoff under
                1s/2s/4s ceilings) that, on exhaustion, hands off to a
                **detached** `parkAndReprobe` - `kafka.pause()`s the
                partition and returns from `eachMessage` *without awaiting*
                a background `setTimeout`-driven reprobe loop, deliberately,
                so kafkajs's own heartbeat is never starved by an outage of
                unknown length (blocking `eachMessage` itself indefinitely
                risks the broker timing the consumer out of the group). The
                reprobe loop never relies on Kafka redelivering the parked
                message - kafkajs's own fetch position moves past a message
                the moment `eachMessage` returns, commit or not - so it holds
                the message's own data in closure and calls `kafka.advance`
                itself once tokenization succeeds, then `kafka.resume`s the
                partition. Four new config fields on `PiiConfig`
                (`PII_MAX_RETRIES`/`PII_RETRY_BASE_MS`/
                `PII_CIRCUIT_BREAKER_THRESHOLD`/`PII_REPROBE_INTERVAL_MS`),
                defaulted to mirror `PpaConfig`'s own values (3, 1000, 5,
                10000) but configured independently (N6) - a different
                failure domain, may need different tuning once COMESA gives
                real values for either. One breaker instance built once at
                the composition root (`index.ts`) and injected, same
                discipline as `keyStore`/`secretStore`.

**Tests**       28 new tests across three files:
                `retry-backoff.service.test.ts` (7 - the ceiling arithmetic
                per attempt, linear scaling with an injected `random`, and
                the specific engineering-rules.md §7 standard - "write a
                test that actually samples multiple retry delays and
                confirms they differ" - 20 real `Math.random()` samples
                asserted non-uniform, not merely "a delay occurred");
                `pii-circuit-breaker.service.test.ts` (7 - trips exactly at
                threshold, `justTripped` fires exactly once per run,
                `recordSuccess` resets and reports `justRecovered` only when
                it had actually tripped); `ingestion-consumer.service.test.ts`
                (7 new PII-specific cases added to the existing 11, all
                updated for the new deps-object signature - recovers
                mid-burst with no parking; parks and pauses on exhaustion
                without tripping below threshold; trips exactly once at
                threshold and never re-logs the trip on further failures; a
                parked event recovers on a later reprobe, advances its own
                offset, resumes the partition, resets the breaker; a failed
                offset-advance on a recovered reprobe is retried on the next
                tick rather than resuming early; an unhandled exception
                inside one reprobe tick is caught, logged, and does not stop
                the loop). Every PII-retry test pins `Math.random` to 0 so
                the burst's own jittered delay never lands ambiguously close
                to the (independently asserted) reprobe boundary - genuine
                jitter is `retry-backoff.service.test.ts`'s own, separate
                claim. Full suite: 262 tests, 100%/97.91%/100%/100%
                aggregate, above the 96% gate; every new file at
                100%/100%/100%/100% on its own.

**Verified**    `live` - against the real harness broker
                (`cch-mla-redpanda`), with the PII secret file genuinely
                removed and a real, running MLA instance
                (`KAFKA_ENABLED=true`). A `postQuotes` record re-signed with
                local test keys (`capture-feeder --resign`) was fed onto
                partition 2; the running instance logged the retry burst
                completing silently, then `PII secret store still
                unavailable after retrying at partition 2 offset 433 -
                parking event, pausing partition 2 until it recovers`,
                immediately followed by `Circuit breaker tripped: 1
                consecutive PII secret failures...` (threshold set to 1 for
                this run) and kafkajs's own `Pausing fetching from 1
                topics` confirmation - the partition then produced zero
                further activity for the remainder of the run, proving the
                pause genuinely stopped consumption rather than merely
                skipping the one event. **The reprobe-recovers-without-a-
                restart path is unit-verified only, stated precisely, not
                claimed live**: `FilePiiSecretClient` resolves its
                `PiiSecretLookupResult` once, at construction, and caches it
                for the process's life (`pii-secret.client.ts`'s own class
                comment) - a real reload mechanism is gate item #2's scope,
                not this one's, so no live implementation can make a
                reprobe against the *current* secret client ever succeed
                without a restart. What *is* live-verified instead, and is
                the recovery path that actually exists today: restoring the
                secret file and restarting the process redelivered the
                exact same parked record - `Forwarded QUOTE
                (id=01KZRP0MH81MYFTW7PH0S9SYF2) at partition 2 offset 433`
                was the very first line logged after reconnecting, proving
                the parked offset was genuinely never committed and nothing
                was lost or duplicated across the restart.

**Diverged**    Nothing from COMESA's answer on the headline question (fail-
                closed, transient, retry). One thing the answer did not
                specify, decided here per the recommendation already on
                record in `plan.md` §7.1 #1: retry count/backoff/breaker
                threshold mirror the MLA→PPA shape's own recommended
                defaults (3, 1s/2s/4s, N=5) rather than inventing a second,
                distinct policy - confirmed with COMESA as a recommendation,
                not assumed silently.

**Left open**   **Gate item #2 (secret rotation, `plan.md` §7.1 #2) -
                untouched by this entry**, tracked in full in US-PII-02's own
                entry above; Phase 4 stays not-formally-closed until it also
                lands. Within this entry's own scope: the reprobe loop's
                "recovery without a restart" path is architecturally correct
                (proven by unit tests against a `PiiSecretStore` double whose
                answer changes mid-run) but cannot be exercised live until
                gate item #2 gives `FilePiiSecretClient` (or its successor)
                a way to change its answer without a process restart -
                recorded here so a future reader does not mistake the
                current restart-based recovery for the reprobe loop actually
                having healed anything. `#3`/`#4` from `plan.md` §7.1
                (legal meaning of "protected", secret ownership) remain
                exactly as US-PII-02's own entry states them - untouched by
                this change.

### US-PII-02 — gate item #2 reversed: no rotation, long-lived key [2026-09-22]

**Update, appended per §16's append-only rule - the entry above stays exactly
                as written.** Source: `docs/meetings and emails/tokenization-
                feedback.md`, the same thread §7.1 #2's table row already
                cites, continued to its actual conclusion.

**Reversed**    Gate item #2's headline direction is no longer "versioned
                keys" - COMESA's [2026-09-04] answer on that is superseded.
                George Murage (Altiora, on CCH's side) identified the reason
                the original recommendation missed: the same MSISDN/bank-
                account values that tokenization protects are also matched
                by Tazama's own fraud-evaluation rules across a transaction
                history. Rotating the key would change the hash of the same
                input value, breaking every rule that relies on matching a
                source/destination MSISDN or bank account across an interval
                - key rotation and correlation-across-time are fundamentally
                incompatible for a keyed hash used this way, not merely a
                detail to sequence around. **Confirmed by both sides
                [2026-09-18]:** "we have decided to not rotate the key" and
                Behjet Ansari (Paysys), "we agree with the long-lived key
                approach. It is what we'll require." The mechanism-shape
                question §7.1 #2's row calls "genuinely ambiguous" (what
                triggers a key-pickup) is moot - there is no rotation for
                anything to trigger.

**New**         A concrete secret spec, from George [2026-09-22], confirmed
                by Behjet the same day: HMAC-SHA-256 (matching
                `pii-secret.client.ts`'s existing construction), a 256-bit
                (32-byte) key, base64-encoded, held in a Kubernetes Secret
                named `cch-mla-pii-secret`. This is CCH actually building
                the secret to this spec now ("we are working on this
                requirement... please confirm... so that we can proceed"),
                not yet a confirmation that MLA's own deployment consumes a
                secret under that exact name - the deployment manifests
                (`deployment/`) should be checked against it before this is
                called closed.

**Effect on the build**  No rotation mechanism is now correct to build -
                `FilePiiSecretClient`'s single-active-key, restart-to-change
                design (US-PII-02's own entry above) was already exactly
                this shape, built ahead of the decision per `CLAUDE.md`'s
                "External decisions" rule. Nothing in the shipped mechanism
                needs to change; what changes is the *documentation* -
                every place that still frames rotation as "confirmed
                direction, unresolved trigger" now overstates what's open.
                `#3`/`#4` from `plan.md` §7.1 (legal meaning of "protected",
                secret ownership) are untouched by this update.

**Left open**   Whether the deployed/deployment-manifest secret name and
                encoding match `cch-mla-pii-secret`'s spec exactly - a
                deployment-config check, not an engineering build item.
                **Checked and closed [2026-09-22]:**
                `deployment/MLA-deployment-kubernetes.md`'s own manifest
                already uses `secretName: cch-mla-pii-secret` at both the
                volume definition and the `pii-secret` volume mount -
                written before this spec was confirmed, as a placeholder
                name, and happens to match it exactly. Nothing to change.

### EPIC-PII-tokenization — Phase 4 formally closed [2026-09-22]

Both of the two decisions that ever gated this phase's formal closure
                (`plan.md` §7.2's own bar - see US-PII-01 and US-PII-02's
                entries above, and their two follow-up entries, for the
                full build/verification narrative of each) are now
                answered: gate item #1 (fail-mode) built, tested, live-
                verified [2026-09-04]; gate item #2 (secret rotation)
                resolved [2026-09-18, spec confirmed 2026-09-22], no build
                required. This entry records the closure decision itself,
                not new engineering.

**Built**       Nothing new - this entry closes the phase, it does not
                add to it. `plan.md` §7's exit-criterion checklist has one
                item updated in place from `[~]` to `[x]`
                (tokenization-failure metric/alert), correcting a stale
                notation rather than describing new work: that item was
                already built and live-verified under Phase 6's own exit
                criterion [2026-09-08], `mla_tokenization_failures_total`
                and the `tokenization-failure` alert type
                (`raiseTokenizationFailureAlert`) - Phase 4's own checklist
                simply hadn't been updated to say so once Phase 6 closed.

**Verified**    Nothing new to verify live - every exit-criterion claim
                this closure rests on was already live-verified in its own
                story's or phase's entry (US-PII-01, US-PII-02, and Phase
                6's US-MON-01 entry for the metric/alert item). Closure is
                a documentation act confirming those live results together
                satisfy `plan.md` §7.2's stated bar, not a new live-
                verification run.

**Diverged**    Nothing from what either gate item's answer required.

**Left open**   **Two items, both filed under §13.2 ("gates production,
                not the work ahead") and explicitly not part of this
                phase's own closure bar per §7.2**: what "protected" must
                mean legally (CCH Legal), and named ownership of the
                production secret (CCH). Neither blocks this closure;
                both must be resolved before COMESA go-live.

### US-MLA-06 — Deliver Envelopes to PPA via Per-Action Endpoints [2026-09-07]

**Built**       `HttpsPpaClient` (`src/clients/ppa.client.ts`), the `PpaClient`
                port's only implementation, and its composition into
                `ingestion-consumer.service.ts`. Endpoint selection by
                `eventType` (`ppa-routing.service.ts`'s `resolvePpaEndpoint`,
                a pure, exhaustive `Record<EventType, string>` table) — both
                legs of a routing pair share one endpoint, distinguished by
                `msgType` inside the envelope, never by URL/method. mTLS via
                a single parsed host/port (never a replica address); certs
                read once at construction. A per-call timeout
                (`PPA_TIMEOUT_MS`, default 2000ms) races an
                `AbortController`-driven `setTimeout` against the whole call
                (headers and body drain both), producing its own `{ outcome:
                'timeout', timeoutMs }` result rather than folding a breach
                into `server-error`/`network-error`. **The offset now
                advances only on HTTP 200** (N1) — `createIngestionHandler`
                calls `ppaClient.deliver` for every `forwarded` outcome and
                gates `kafka.advance` on its result; every other outcome is
                US-MLA-07's own scope (below).

**Tests**       22 tests directly on this client/routing pair
                (`ppa.client.test.ts` 18, `ppa-routing.service.test.ts` 4),
                plus the offset-gate itself covered within
                `ingestion-consumer.service.test.ts`'s own 36. Categories:
                every table row (all four routing entries; `success`/
                `client-error`/`server-error`/`tls-handshake-failure`/
                `network-error`/`timeout`, six outcomes total); failure
                paths (TCP-never-connects vs. TCP-connects-then-resets,
                timeout mid-headers and mid-body-drain, an unexpected status
                defensively folded to `server-error`); degraded paths (the
                offset withheld on every non-success). Full suite: 306
                tests, 100%/98.01%/100%/100% aggregate, above the 96% gate;
                `ppa.client.ts` and `ingestion-consumer.service.ts` both at
                100% statements/lines.

**Verified**    `live` — against a real, running `ppa-stub` (`rejectUnauthorized:
                true`) and a real broker, across two sessions. mTLS/routing/
                classification: a correct cert (success), a genuinely
                untrusted cert from an unrelated throwaway CA
                (`tls-handshake-failure`, surfacing as a bare "socket hang
                up" — the live run that found and corrected a real defect in
                the classification itself, see `ppa.client.ts`'s own comment
                on `classifyTransportError`), an unreachable host
                (`network-error`), a 4xx, a 5xx via fault injection — each
                produced the correctly classified outcome. Per-call timeout:
                `ppa-stub` set to hang forever (`POST /control
                {mode:"timeout"}`) produced real HTTPS requests landing
                ~2000ms apart, before each retry's own backoff. Offset gate:
                across timeout, persistent 503, 4xx, and untrusted-cert
                fault-injection rounds with re-signed real captured records,
                every non-200 outcome left the offset unadvanced; **a full
                MLA restart against a still-paused partition redelivered the
                exact same parked offset**, twice, which then advanced
                cleanly with nothing lost once the fault cleared — proving
                the withheld commit is genuine, not merely a skipped call.

**Diverged**    Nothing from the story text. `network-error` reaching the
                same retry path as the story's own named transient
                categories is US-MLA-07's own divergence, recorded there.

**Left open**   Nothing within this story's own scope — FSD Open Item #1
                (the timeout value) remains formally unagreed with CCH/
                Paysys; `plan.md` §8.1 #1's decided default (2000ms) is what
                was built and live-verified against.

### US-MLA-07 — Retry and Circuit-Break on PPA Failures         [2026-09-07]

**Built**       The full retry/park/breaker/reprobe mechanism in
                `ingestion-consumer.service.ts`, composed with US-MLA-06's
                client above. **5xx/timeout/TLS-handshake failure ⇒ retry**
                (`runPpaRetryBurst`): up to `PPA_MAX_RETRIES` further
                attempts (default 3), exponential backoff plus genuine
                jitter under 1s/2s/4s ceilings (`computeBackoffMs`, shared
                with the PII secret's own burst), offset withheld
                throughout; the loop re-checks transience every attempt, so
                a retry that itself turns permanent stops the burst
                immediately. **4xx ⇒ permanent**: logs the full envelope
                (`logPpaPermanentRejection`) and advances immediately, never
                retried, never pausing a partition for a malformed envelope
                that can never be fixed by retrying. **Retry exhaustion
                parks the event and pauses the partition**
                (`parkAndReprobePpa`), handed off to a detached reprobe loop
                on `PPA_REPROBE_INTERVAL_MS` — mirroring the PII secret's own
                `parkAndReprobe` (gate item #1) with one deliberate scope
                difference: **the circuit breaker (`PpaCircuitBreaker`,
                `ppa-circuit-breaker.service.ts`) counts consecutive
                failures per partition, not process-wide** — a PPA-side
                issue can genuinely be localized to what one corridor's own
                envelopes trigger, unlike the PII secret's single, uniformly
                -shared resource (`circuit-breaker.service.ts`'s own comment
                has the full reasoning for both scopes; this is a reasoned
                engineering interpretation, not stated verbatim as an
                acceptance criterion — flagged here to raise back to CCH/
                COMESA rather than buried in behaviour). A reprobe resolves
                three ways, not two: success, a `client-error` surfacing now
                that PPA is reachable again (logged and advanced exactly as
                if it had happened on the first attempt — a 4xx is itself
                proof of connectivity, so it resumes the partition and
                resets the breaker too), or still transient. The shared
                counting primitive itself (`CircuitBreaker`,
                `circuit-breaker.service.ts`) was generalized out of what
                was previously `PiiCircuitBreaker` — a verbatim-duplicate
                state machine would otherwise have existed twice; the PII
                secret's own composition root now injects one process-wide
                `CircuitBreaker` instance, `PpaCircuitBreaker` wraps one
                per-partition instance of the same class.

**Tests**       55 tests directly on this mechanism
                (`ingestion-consumer.service.test.ts`'s own 36 covering the
                retry burst, the delivery gate, and park/reprobe/breaker
                together; `circuit-breaker.service.test.ts` 7;
                `ppa-circuit-breaker.service.test.ts` 4;
                `retry-backoff.service.test.ts` 7 — jitter genuinely
                varying, sampled directly, not just "a delay occurred").
                Categories: every table row (5xx/timeout/TLS-handshake
                transient, 4xx permanent, retry-exhaustion parked, N-th
                failure trips, tripped-and-resuming); failure paths (a
                retry turning permanent stops the burst; a reprobe's own
                offset-advance failing retries the commit next tick, not a
                bespoke policy; an unhandled exception inside one reprobe
                tick is caught, logged, and does not stop the loop);
                ordering (the breaker trip logs exactly once, never
                re-logged on later failures); concurrency/isolation (two
                partitions' own breakers proven independent — one tripping
                never pauses or otherwise affects the other, unit-tested via
                `PpaCircuitBreaker`'s own per-partition map and exercised
                end-to-end through two parallel handler calls). Full suite:
                306 tests, 100%/98.01%/100%/100% aggregate;
                `ingestion-consumer.service.ts`, `circuit-breaker.service.ts`
                and `ppa-circuit-breaker.service.ts` each at
                100%/100%/100%/100% on their own.

**Verified**    `live` — against the real harness broker and a real, running
                `ppa-stub`, with re-signed real captured records, in the same
                sessions as US-MLA-06 above. **Retry with jitter, twice
                independently**: a hung connection produced 4 real requests
                spaced 2739ms/3943ms/2772ms apart; a persistent 503 produced
                4 real requests spaced 864ms/1417ms/1508ms apart — each gap
                comfortably inside its own 1s/2s/4s ceiling and visibly
                different from the others, live, not a mocked clock.
                **4xx**: a real 4xx produced exactly one delivery attempt —
                no retry — and the resulting alert carried the serialized
                envelope in full, including its tokenized fields (`tkn_...`
                prefixes visible in the logged JSON, live confirmation that
                Phase 4's tokenization survives this path unchanged) — and
                advanced immediately, no pause. **TLS handshake failure
                retried like a 5xx, reason preserved** (R-22): a genuinely
                untrusted client cert produced "socket hang up", retried
                through the full burst, and the alert read "PPA TLS
                handshake failed at ...: socket hang up" — never a generic
                5xx. **Breaker trip and automatic recovery, the whole point
                of this story, proven without a restart**: a persistent 503
                against a real running instance (`PPA_CIRCUIT_BREAKER_THRESHOLD=5`,
                `PPA_REPROBE_INTERVAL_MS` shortened to 3000ms for the run)
                produced `PPA returned HTTP 503 at partition 2 offset 498
                after retrying - parking event, pausing partition 2 until it
                recovers`, then, after four further failed reprobes, exactly
                one `Circuit breaker tripped for partition 2: 5 consecutive
                PPA delivery failures` (confirmed not repeated across a
                further 3s of continued failure) and kafkajs's own `Paused
                partition 2`. Restoring `ppa-stub` to healthy — **with no
                process restart** — produced, on the very next reprobe tick,
                `PPA recovered at partition 2 offset 498 - circuit breaker
                reset, resuming partition 2`, `Forwarded QUOTE
                (id=01KZRP0MH81MYFTW7PH0S9SYF2) at partition 2 offset 498`,
                and kafkajs's own `Resumed partition 2` — the exact parked
                record, nothing lost or duplicated, recovered entirely on
                its own. This is the qualitative difference from every
                US-MLA-06 recovery proof above (each of which needed a
                restart) and from gate item #1's own PII reprobe (which
                *could not* be live-verified without a restart, since
                `FilePiiSecretClient` caches its answer for the process's
                life) — PPA's reprobe genuinely heals without one, live,
                proven. **Per-partition isolation** (one partition's own
                trip never pausing or otherwise affecting another) is
                unit-verified only, not live: the only real capture fixture
                in this repo (`raw_topic_slice_partition2.json`) is entirely
                partition 2, so a live multi-partition run would need
                fabricated, non-captured data — judged not worth trading the
                "use real captures" discipline for, given the isolation
                logic itself (`PpaCircuitBreaker`'s own per-partition `Map`)
                is simple, pure, and already exercised end-to-end through
                two parallel real handler calls in the unit suite.

**Diverged**    **`network-error` (PPA host wholly unreachable — connection
                refused, DNS failure) is retried in the same transient
                bucket as the three categories the story names explicitly
                (5xx, timeout, TLS-handshake failure)**, not treated as
                permanent. Reasoned, not guessed: nothing in the story text
                or `engineering-rules.md` §6.1 calls a bare connection
                failure permanent, and treating "PPA is completely
                unreachable" as *more* final than an ordinary 503 would mean
                advancing the offset the moment PPA goes fully down — silent
                data loss, worse than any classified outcome the stories do
                name, and the exact failure mode this whole mechanism exists
                to prevent. Worth raising back to CCH/COMESA if a future FSD
                revision says otherwise. **The circuit breaker's scope is
                per-partition, not process-wide** — see `Built` above; this
                is an interpretation of `core-knowledge.md` §3.5's "pause
                consumption on the affected partition(s)" wording (plural,
                selective) rather than a verbatim requirement, consistent
                with the reasoning already on record in this codebase for
                why the PII secret's own breaker is process-wide instead
                (`circuit-breaker.service.ts`'s comment, written before this
                story existed). Flagged, not buried — worth confirming with
                COMESA once there is someone to ask.

**Left open**   The offset-advance-on-permanent-failure policy (FSD Open
                Item #8) is what this story built against
                (`plan.md` §8.1 #3's decided default) — still formally
                unagreed with CCH. Circuit-breaker threshold (N=5,
                `plan.md` §8.1 #2) and the timeout value (FSD Open Item #1,
                `plan.md` §8.1 #1) are both decided defaults, not confirmed
                values. Per-partition breaker isolation is unit-verified
                only (see `Verified` above). Phase 6 (`plan.md` §9) is what
                turns every structured log line built across this whole
                phase into a real metric and a wired alert — nothing here
                claims more than an interim log line where the story itself
                says "alert."

---

### US-MON-01 — Monitor Consumer Lag, Circuit Breaker State, and Degraded Message Rate    [2026-09-08]

**Built**       MLA's own share of US-MON-01's seven acceptance criteria (`cch-crosscutting-user-stories.md`,
                Epic 11) — the rest (ValKey memory pressure, TMS token-refresh health) are PPA-scoped, not
                built here. `Metrics` port (`src/interfaces/metrics.interface.ts`) + `PromClientMetrics`
                adapter (`src/clients/metrics.client.ts`, the sole `prom-client` importer): per-partition
                consumer lag (`mla_consumer_lag`, broker high-water mark minus this consumer group's own
                **committed** offset, polled via a separate admin connection); a paused-offset-rate reading
                (`mla_partition_paused`, a 0/1 state gauge per partition — the AC's own term is undefined, so
                this codebase's own interpretation is flagged in the metric's own `help` string, not silently
                guessed); the degraded-message rate's own building block (`mla_tokenization_failures_total`,
                the only source of "degrading" MLA can report — MLA has no other degraded-fallback path);
                breaker state at both hops as two genuinely different shapes (`mla_pii_breaker_state`, one
                process-wide gauge; `mla_ppa_breaker_state{partition}`, one gauge per partition — see
                `circuit-breaker.service.ts`'s own comment on why the two breakers are scoped differently, not
                flattened into one boolean); a Prometheus-compatible `/metrics` endpoint
                (`src/clients/fastify.client.ts`). **Alerting** (the AC's own "and alerted" clause, on every
                signal above): an `Alert` port (`src/interfaces/alert.interface.ts`) and adapter
                (`src/clients/alert.client.ts`, `WebhookAlertClient`) wired at the five conditions
                `plan.md` §9's own checklist names — missing/invalid signature, a PPA 4xx, retry exhaustion
                (PII or PPA), a breaker trip (PII or PPA), and a PII tokenization-attempt failure — each
                incrementing `mla_alerts_total{type,severity}` (always) and, when `AlertConfig.webhookUrl` is
                configured, POSTing to a configurable webhook (never a hardcoded destination, per N6).
                `ingestion-consumer.service.ts`'s own "how a resolved outcome is logged/metered/alerted" leaf
                dispatch was split into a new sibling module, `services/ingestion-outcome-logging.service.ts`,
                once this item's own wiring pushed the file past ESLint's `max-lines` gate — a pure
                relocation, not a behaviour change.

**Tests**       354 tests total (up from 339 at the start of this story), 100%/98.06%/100%/100% coverage,
                zero lint errors. New: `alert.client.test.ts` (12 tests — both sinks in isolation, the
                metrics-based one always active, the webhook one config-gated, its timeout/abort path, its
                non-2xx and rejected-fetch failure paths, an `Error` and a non-`Error` rejection reason both
                covered). Extended: `metrics.client.test.ts` (`incrementAlert` by type/severity),
                `config.service.test.ts` (the alert config's own default and override), and
                `ingestion-consumer.service.test.ts` (every one of the five alert call sites now asserts the
                exact `alert.raise*` call and payload, not just that the plumbing compiles — including a
                negative assertion that a structural skip (`egress`/`party-lookup`) and a key-source outage
                raise **no** alert method at all, `engineering-rules.md` §9's own "structural skips do not
                alert" rule).

**Verified**    `live` — against the real harness (Redpanda + `ppa-stub`, genuinely re-signed real captured
                records, real mTLS), every one of the five alert conditions fired independently with real
                evidence, not asserted only in a unit test: a stripped/mismatched signature raised
                `mla_alerts_total{type="signature",severity="failure"}`; a genuinely re-signed, tokenized
                `postQuotes` envelope delivered to `ppa-stub` forced into `4xx` raised
                `{type="rejection",severity="failure"}`, with the alert payload confirmed to carry only
                identifying fields, never the full envelope the log line beside it carries; `ppa-stub` forced
                into `503` (`PPA_CIRCUIT_BREAKER_THRESHOLD=1`/`PPA_MAX_RETRIES=0`) raised both
                `{type="retry-exhaustion",severity="informational"}` and
                `{type="breaker-trip",severity="failure"}` on the first attempt, and the parked record was
                later observed delivering automatically once the fault cleared, no restart — the same
                restart-free recovery Phase 5 first proved, now also instrumented; the PII secret file removed
                at startup raised `{type="tokenization-failure",severity="informational"}` (one per attempt)
                and, at `PII_CIRCUIT_BREAKER_THRESHOLD=1`, `{type="breaker-trip",severity="failure"}` for the
                PII secret's own separately-scoped, process-wide breaker. **The phase's own exit criterion was
                also run and met live**: a full 500-record feed (`raw_export_500/raw_export_500.json`) against
                a fresh instance produced a `/metrics` snapshot in which every one of the 500 records landed in
                exactly one counted bucket — `mla_skipped_total{reason="egress"} 273` +
                `{reason="party-lookup"} 92` + `{reason="fx-quote-rejected"} 19` +
                `mla_rejected_total{reason="invalid-signature"} 116` = 500 — `mla_consumer_lag` at 0 on all
                twelve partitions confirming full consumption, and `mla_alerts_total{type="signature"} 116`
                matching every counted rejection exactly.

**Diverged**    **The alert sink is genuinely two-part, not the single destination R-37 would eventually
                name.** The AC's own "and alerted" is satisfied today by a metrics-based sink
                (`mla_alerts_total{type,severity}`) that a Prometheus/Alertmanager rule can watch directly —
                the standard shape for that stack (IDD §10) — plus an optional, config-gated webhook for a
                concrete destination decided ahead of Alertmanager rules being authored. Neither guesses at
                R-37's own still-open answer (PagerDuty/Slack/email, and the routing mechanism); building
                both, rather than only the metrics path, is what makes "the sink is configurable" a real claim
                (`plan.md` §9's own Blocked note) instead of a stated intention with only one option ever
                implemented. **Severity is a two-tier reading of `engineering-rules.md` §6.2's "parked vs
                dead" language**, generalised to MLA's own shape even though MLA has no DLQ
                (`core-knowledge.md` §9's own table: MLA's analogue is parked-entry count and
                retry-exhaustion count) — `informational` for a park and a tokenization-attempt failure,
                `failure` for a breaker trip, a security event, and a permanent rejection. Not verbatim from
                any AC; a defensible interpretation, flagged here rather than buried in the code alone.

**Left open**   **R-37 (alerting destination/routing, High) is still open with CCH** — this story's own
                webhook sink exists and is proven live, but no concrete destination is wired by default, and
                Alertmanager-side routing rules (which map a `mla_alerts_total` series to a paging decision)
                are entirely outside this codebase's scope. ValKey memory-pressure alerting and TMS
                token-refresh health are PPA-scoped, not built here (`cch-crosscutting-user-stories.md`'s own
                US-MON-01 AC list spans both components). The degraded-message-rate signal itself is
                MLA-thin — MLA has exactly one degrading condition to report
                (`mla_tokenization_failures_total`); the richer PPA-side degraded-field-fallback rate
                (`core-knowledge.md`'s own degraded table) is PPA's own build, not started.

---

### US-PERF-01 — Meet Latency Targets at Sustained and Peak TPS (MLA's own ack-latency instrumentation only)    [2026-09-08]

**Built**       The AC's own literal MLA-side definition — "MLA end-to-end ack latency (Kafka consume → PPA
                HTTP 200 received) ≤ 200 ms at p95 under sustained load" — split cleanly into two separate
                claims this entry does not conflate. **The clock itself: built, tested, live-verified.**
                `receivedAt = Date.now()` is captured at the top of `createIngestionHandler`
                (`ingestion-consumer.service.ts`), before this phase's own work there existed no clock started
                at consumption at all (`continue - before phase 6.md` §1's own named gap). `observeAckLatencyMs`
                (`Metrics` port) is called on every path that reaches a genuine PPA `success` — a fresh
                record's own `resolveOutcome`, and a PII- or PPA-parked record's own recovery path
                (`parkAndReprobePpa`'s `resolvePartition`) — so a parked-then-recovered record's own latency
                is still observed, however long the park lasted, not silently dropped. `mla_ack_latency_ms`
                (`clients/metrics.client.ts`) is a histogram with buckets dense around the 200ms budget
                (10ms–30s), so a p95 breach is visible in a specific bucket, not lost in a coarse one. **The
                200ms p95 budget itself: not confirmed** — that is a sustained-load claim (`plan.md` §9's own
                "MLA ack latency p95 against the 200 ms target" operator question), and this story built the
                instrumentation the claim will be checked against, not the check itself.

**Tests**       Covered as part of US-MON-01's own 354-test/100%-98.06%-100%-100% suite above — no separate
                test file; `observeAckLatencyMs`'s own call sites are exercised by the same
                `ingestion-consumer.service.test.ts` cases that already prove `resolveOutcome`'s three-way
                classification and both park/recover paths.

**Verified**    `live` — a genuinely re-signed record's real ack latency was observed and reported
                (`mla_ack_latency_ms_sum`) during this story's own live verification runs (see US-MON-01's
                entry above); the 500-record exit-criterion run's own `mla_ack_latency_ms_sum`/`_count` were
                both `0`, correctly — no record in that specific run ever reached a genuine PPA delivery,
                since real DFSP signatures do not verify against the locally generated test keys (§13.1/§14
                Q1), so nothing crossed this histogram's own observation point. **`unit only` for the budget
                itself** — a single-record round trip landing well under 200ms is not evidence about p95 under
                the 25 TPS sustained / 125 TPS peak load `US-PERF-01`'s own AC actually specifies; that
                requires the sustained/peak/step-down load test the AC names, explicitly Phase 7's own work
                (`plan.md` §10; `continue - before phase 6.md` §8's own "what Phase 7 is what this phase's
                metrics make provable at scale" framing).

**Diverged**    None from the story text for the instrumentation itself. The load-test shape the AC also
                specifies (25 TPS/30min, 125 TPS/5min, step-down) is out of this story's own scope by design,
                not a divergence — `plan.md` §15's own sequencing places load validation in Phase 7.

**Left open**   The 200ms p95 budget is unconfirmed at any load beyond a single record — Phase 7's own exit
                criterion. The 25/125 TPS baseline itself is a working assumption pending CCH sign-off
                (R-10, Medium, `cch-crosscutting-user-stories.md`), unrelated to what this story built.
                PPA's own 500ms p95 budget (US-PERF-01's other clause) and ValKey sizing (US-PERF-02) are
                PPA-scoped, not started.

---

*This document is updated as work happens — what was built, what broke, the root cause, the fix, and what was proven live versus assumed.*

### Phase 7 — Hardening and validation (dev complete, CI pending)      [2026-09-09]

**Built**       All six of §10's checklist bullets, plus the two tools the phase needed and did not have.
                `tools/load-test/` — `metrics-snapshot.ts` (Prometheus text parsing; exact bucket-counting
                p95) and `run.ts` (npm script `loadtest`), an **observation-only** instrument that reads
                Phase 6's own `mla_ack_latency_ms` rather than timing anything itself, because a second
                tool-side stopwatch would measure the harness instead of the service.
                `tools/scenario-library/` — `harness.ts` (cold-start bootstrap: mTLS certs, all 19 DFSP
                keypairs, the PII secret, broker, 12-partition topic, compile, process lifecycle) and
                `run-all.ts` (npm script `scenario:all`), which supplies the thing the library never had:
                **a definition of "passes"**. Each scenario now carries a `ScenarioExpectation` — floors
                rather than exact equalities, except `accountsForAll`, which is exact. `capture-feeder`
                gained `isResignable` so `--resign` over a range no longer aborts the whole feed.
                `mla-restart` and `two-mla-instances` moved to `runnableNow: true`; **all 15 scenarios in
                the library are now runnable**, none deferred.

**Tests**       367 tests / 25 suites, 100%/98.06%/100%/100% against the mechanically-enforced 96 gate,
                zero lint errors. 13 new (`__tests__/load-test-metrics.test.ts`) pin the budget logic:
                boundary cases at exactly 95%, a genuinely breaching distribution, the refusal to
                approximate when no bucket sits at or below the budget, and the empty-histogram
                divide-by-zero guard — the failure paths a real broker cannot be made to produce on
                demand. `engineering-rules.md` §10.2 categories covered here: failure paths and races
                (chaos), concurrency (two instances), regression checks (goldens). `tools/` sits outside
                `collectCoverageFrom`, so these add correctness, not coverage percentage.

**Verified**    `live` — against a real Redpanda broker, a real `ppa-stub` over real mTLS, on genuinely
                re-signed records, on this machine. **Load:** 25 TPS sustained x 30 min (45,002 records,
                10,440 ack samples, 10440/10440 within the 200ms budget, consumer lag 0 at all fifteen
                120-second samples); 125 TPS peak x 5 min (37,504 records, 8702/8702 within budget, lag 0);
                step-down 125->25 with 6,000 fed and exactly 6,000 accounted for, zero event loss.
                **Concurrency:** rebalance to `MEMBERS 2` with partitions split 6/6, the delivered envelope
                set identical to a single-instance baseline (no duplicates, no gaps), A=66/B=50 so neither
                instance was idle. **Chaos:** broker restart mid-feed (500 produced = 500 accounted, MLA
                reconnected unaided); MLA `SIGKILL` mid-dispatch (28 of 116 delivered at the kill, all 116
                after restart, no gaps); stub flapping (102 transient failures, 6 retry exhaustions, two
                partitions paused, full automatic recovery to 116/116 with no restart).
                **Unattended, from a cold start:** `npm run scenario:all` runs all 15 scenarios and passes.
                Both new instruments were verified **able to fail**, not merely to pass — the load tool
                refuses a verdict below `--min-samples` and exits 1; an impossible floor injected into a
                scenario produced a named FAIL and exit 1, then was reverted.
                **`in CI` is NOT verified** — see "Left open". Nothing here is claimed as CI evidence.

**Diverged**    No new divergence from §12. Two corrections to this plan's own prior assumptions, both
                found by running rather than reasoning. (1) **The envelope identity key is `id` + `msgType`,
                not `id`** — the 500-record export yields 116 envelopes over only 75 distinct `id`s, since
                D3 makes `id` a per-`eventType` business identifier shared by a leg's request and its
                callback. Deduplicating on `id` alone would have reported 41 false duplicates. This is now
                stated in `core-knowledge.md` §5, and it is why §6.4's idempotency key is the compound
                `{id}:{isoMessageType}`. (2) **`runnableNow: false` on `mla-restart`/`two-mla-instances`
                was stale, not a real dependency** — the blocker each named ("needs the real MLA consumer")
                was satisfied when Phase 2 closed.

**Left open**   **The exit criterion's "in CI" clause — the phase is NOT closed.** The branch was pushed
                [2026-09-09] and GitLab created the project's first-ever pipeline (#44134, commit
                `6e4ccfec`); it ran and failed at `build`. Two facts, both pre-existing and neither caused
                by this phase: the runner is a **`shell` executor**, so `image: node:22-bullseye` is inert
                and there is **no `services:` support** (hence no broker in CI); and the runner host runs
                **Node < 16** against `engines: >=22.17` and a `lockfileVersion: 3` lock file. The repository
                is not at fault — `tsc` exits 0, the build's `include` is `./src/**/*` only, the lock file
                is consistent. Resolution is infrastructure's: register a Docker-executor runner (the only
                route that puts broker-dependent scenarios in CI), or install Node >= 22.17 on the shell
                host (turns `build`/`lint`/`test`/`regression` green, still no broker). `scenario:all` is
                deliberately not wired into `.gitlab-ci.yml` until that is settled.
                Also open, unchanged and unrelated: **gate item #2** (PII secret rotation trigger, §7.1 #2),
                **R-10** (the 25/125 TPS baseline is a working assumption pending CCH sign-off — this phase
                tested against the stated figures and does not upgrade their confirmation status), and
                **R-37** (alerting destination). The stronger cold-start claim — a throwaway container
                carrying none of this machine's state — is scoped to the other session and not yet run.

### Phase 8 (partial) — Registry, image push, real Kubernetes manifests for CCH   [2026-09-15]

Not a story; the closest analogue per `CLAUDE.md`'s "How a story gets built" §5 and §10's own
instruction. Infrastructure work adjacent to §11's COMESA-environment checklist, moved ahead of the rest
of that section by CCH techops' explicit `kubectl apply -f` ask (`docs - MLA/deployment/MLA-deployment-kubernetes.md`
§1) and grounded in the 2026-09-14 meeting with George (`docs/meetings and emails/14-sept-deployment-meeting.md`),
which answered most of that document's §11 open questions live.

**Built**       Registry decision (GitLab Container Registry, `10.0.70.91:5005/open-frms/cch-frms/cch-mla`
                — zero new infrastructure, matches George's "URL + auth token" ask). The real `cch-mla`
                image, built from `paysys-QA-F11-onwards` @ `a0437cd` (F-01–F-10, all live-verified —
                every Critical- and High-severity finding from `bugs/qa-review-findings.md`; F-11 onwards,
                Medium and Low severity, stays on the `paysys-QA-F11-onwards` TODO, not in this image),
                pushed as `:a0437cd` and `:latest`. A `read_registry` deploy token (`comesa-mla-deploy`)
                minted for CCH, held out of any committed file. The real manifest set —
                `cch-mla/deploy/kubernetes/{00-namespace,01-configmap,02-mla-deployment}.yaml` plus a
                `README.md` runbook — distinct from both the illustrative §9 skeleton in
                `MLA-deployment-kubernetes.md` and the dry run's manifests, **relocated 2026-09-15** from
                `cch-mla/deploy/kubernetes-dryrun/` to `docs - MLA/deployment/kubernetes-dryrun/`: `cch-mla` is
                the official, production repo and should carry only genuine deployment deliverables for
                CCH, never local validation artifacts. An interim
                mTLS CA and MLA client identity for the MLA→PPA hop, generated as the stated, reversible
                default while George investigates a shared cert-manager between the DRPP/Paysyslabs trust
                boundaries. `MLA-deployment-kubernetes.md` updated throughout (§3, §5, §6, §8, §11, §12) to
                record which of its six open questions are now settled, partially settled, or still open;
                `comesa-mla-deployment-reply-email.md` marked superseded (not sent — the meeting covered
                the same ground live).

**Tests**       None — this is deployment/infrastructure work, not application code. No source under
                `src/` changed.

**Verified**    `live` — the image was pulled back from the registry with the newly-minted deploy token
                and matched digest (`sha256:1e995f6de...868b`), confirming the push and the token's read
                access both genuinely work, not just that the API calls returned 200. **Not verified**:
                none of `cch-mla/deploy/kubernetes/` has been `kubectl apply`'d anywhere — no cluster, real
                or dry-run, has seen these specific manifests yet. That remains true until CCH applies them
                or another local dry run repeats it.

**Diverged**    None from §12's register — no application behavior changed.

**Left open**   `KAFKA_BROKERS` (CCH fills in directly — they already know the value, we only owed the
                variable name) and `PPA_BASE_URL` (VPN IPs not yet exchanged) remain placeholders in
                `01-configmap.yaml`. `KAFKA_GROUP_ID` is resolved — `paysys_cch_mla`, confirmed clash-free
                (R-18). `cch-mla-jws-keys` and `cch-mla-pii-secret` are not
                created — both genuinely blocked (real DFSP keys via CCH/Infotex; the PII rotation-trigger
                answer, gate item #2, `plan.md` §7.1 #2) and not something this work unblocks. mTLS is
                built against an interim default only; PPA's own side still needs configuring to trust it,
                which is outside this repo. Metrics/health scraping deliberately deferred per the meeting.
                §11 Q1 (plain manifests vs. Helm) was never explicitly answered by CCH; proceeding on the
                plain-manifests assumption. No CI job pushes the image automatically yet — today's push was
                manual, matching `local-deployment.md`'s own proven fully-manual mechanism.

### Phase 8 (partial) — George's reply, JWS_VALIDATION_DISABLED, ConfigMap split, digest pinning   [2026-09-15]

Same day, continuing the entry above. George Murage (CCH) replied in writing to
`MLA-deployment-kubernetes.md` §11's open questions plus two attached documents (source preserved:
`docs - MLA/deployment/george-reply-2026-09-15.md`, `connectivity-options.md`, `certificate-setup-proposal.md`).
Four decisions resulted — full detail in `MLA-deployment-kubernetes.md`'s own 15 September update, not
repeated here.

**Built**       `JWS_VALIDATION_DISABLED` (`src/interfaces/config.interface.ts`,
                `src/services/config.service.ts`, default `false`) — a testing-only bypass George proposed
                as a permanent removal of MLA's own signature verification; **not accepted as permanent**
                (engineering-rules.md's non-negotiables, and F-04 specifically hardened bound-claims
                checking), built instead as a scoped, reversible, loudly-observable default per
                `CLAUDE.md`'s external-decisions rule. `envelope-pipeline.service.ts` skips `verifyJws`
                entirely when set; a new `mla_jws_validation_bypassed` gauge
                (`metrics.interface.ts`/`metrics.client.ts`) and a boot-time `WARN` log
                (`src/index.ts`) make it impossible to run silently. `.env.template` documents it with a
                loud comment. Separately: the real Kubernetes ConfigMap is now split —
                `cch-mla/deploy/kubernetes/01-configmap.yaml` (static, Paysys-owned) and a new
                `02-env-configmap.yaml` (environment-specific, CCH-owned — `KAFKA_BROKERS`/`PPA_BASE_URL`
                only) — per George's own proposed delivery mechanism. The Deployment
                (`03-mla-deployment.yaml`, renumbered) now references both ConfigMaps via two `envFrom`
                entries, and pins the image by immutable digest
                (`sha256:1e995f6de223a58257f623b96792e15eef56d06f1f73e9e71c49b6d65fbe868b`) rather than the
                mutable `:a0437cd` tag, per George's own recommendation (point 4).

**Tests**       9 new/changed: 3 in `config.service.test.ts` (default false, explicit true, folded into
                the existing full-snapshot and supplied-values tests), 1 in `envelope-pipeline.service.test.ts`
                (a record with no signature at all still forwards when the bypass is set), 1 in
                `metrics.client.test.ts` (the new gauge, default 0, set to 1). The remaining changes are
                mechanical dependency-threading across `ingestion-consumer.service.test.ts` (36 call
                sites) and five other test files' `Metrics` mocks, not new behavior under test. Full suite:
                487 tests, 100%/97.86%/100%/100% against the 96% gate, zero lint errors, `npx tsc --noEmit`
                clean on both the root and `tools/tsconfig.json`.

**Verified**    `live` — booted the real process twice, no harness needed (boot-time config/metrics
                behavior, not Kafka-dependent). `JWS_VALIDATION_DISABLED=true`: boot log carried the exact
                designed `WARN` line, `/metrics` showed `mla_jws_validation_bypassed 1`. Default
                (unset): no warning logged, `/metrics` showed `mla_jws_validation_bypassed 0`,
                `/health/ready` stayed `UP`. **Not verified**: the bypass's effect on a real Kafka-consumed,
                genuinely-unsigned record end to end through the full consumer loop — the unit test above
                covers the pipeline function directly; a full-harness run (Redpanda + `ppa-stub`) was not
                repeated for this specific change. The ConfigMap split and digest pin have not been
                `kubectl apply`'d anywhere, same open item as the parent entry above.

**Diverged**    None from §12's register.

**Left open**   Same items as the parent entry above (`KAFKA_BROKERS`, `PPA_BASE_URL`, JWS keys, PII
                secret, PPA-side CA trust), plus: the ingress-gateway architecture accepted from George's
                proposal is new Paysys-side infrastructure, not yet built — the interim CA remains in use
                until it lands. `JWS_VALIDATION_DISABLED` must be confirmed off (`false`) before any real
                traffic is trusted; nothing in this repo enforces that beyond the default itself and the
                loud observability built around it. **User decision [2026-09-15]: no written reply to
                George is needed** — the only remaining action is handing over registry access directly
                (see the entry below), not a formal response to his four points.

### Phase 8 (partial) — Registry pivot: GHCR is the real delivery path, not GitLab   [2026-09-15]

Same day, continuing the two entries above. **User decision**: the GitLab Container Registry push
(`10.0.70.91:5005/open-frms/cch-frms/cch-mla`) is retroactively scoped to internal testing only — the
registry CCH actually pulls from is **GitHub Container Registry**, under a new org repo
`psl-izyane-cch-frms/cch-mla`.

**Built**       Created `psl-izyane-cch-frms/cch-mla` (private GitHub repo, empty — not a source mirror
                yet). Retagged and pushed the identical local image (same `a0437cd` build) to
                `ghcr.io/psl-izyane-cch-frms/cch-mla:a0437cd` and `:latest`. Updated
                `cch-mla/deploy/kubernetes/03-mla-deployment.yaml`'s digest-pinned `image:` field from the
                GitLab reference to the GHCR one (digest unchanged). Updated
                `cch-mla/deploy/kubernetes/README.md`'s Registry Access section and the `imagePullSecret`
                creation command (`--docker-server=ghcr.io`, collaborator PAT instead of a deploy token).
                `MLA-deployment-kubernetes.md` §6/§11 Q2/point 4 updated to record GHCR as the real path
                and GitLab as superseded-to-testing-only.

**Tests**       None — registry/infrastructure change, no application code touched.

**Verified**    `live` — pushed digest (`sha256:1e995f6de223a58257f623b96792e15eef56d06f1f73e9e71c49b6d65fbe868b`)
                matches the GitLab push's digest exactly, confirming byte-identical content, not a
                re-derived build. Package confirmed created under the org (`visibility: private`,
                3 versions) via the GitHub API. **Access model verified end to end, user-run**: invited
                the PPA developer (internal, a deliberate test account, not George) via the package's own
                "Manage access" → "Invite teams or people" (Read role) — not repository collaboration,
                which the assistant had initially and incorrectly suggested was necessary; the correct
                control is package-direct. The invited account genuinely `docker pull`'d the image using
                their own PAT — confirmed working before handing access to George.

**Diverged**    None from §12's register. One correction to this session's own earlier guidance: assumed
                repo-connection + repo-collaborator inheritance was required (no public API for it,
                reported as a manual step); the user found the actual control (package-level "Manage
                access") first, which is simpler and doesn't expose the private source repo.

**Left open**   George himself has not yet been invited — the verified pull was a deliberate internal
                test account, not George. Same mechanism (package "Manage access" → Invite, Read role)
                applies; nothing else needs to change once he's added.

### Phase 8 (partial) — First live delivery to the real PPA; GHCR access for INFITX; e2e-testing checklist   [2026-09-17]

Three threads, same day. Not a story - infrastructure/integration work adjacent to §11, per `CLAUDE.md`'s
"How a story gets built" §5/§10 instruction, same as the two entries above.

**Context.** Checking whether MLA has a Swagger link (it doesn't - no REST business API, only
`/health/*`/`/metrics`) surfaced that the real PPA - built separately by another engineer, in a repo this
knowledge base has no visibility into - is live and reachable at `http://10.0.115.186:3000`, confirmed via
its own `/health/ready` and OpenAPI doc (`strategy.md` §1 has the full confirmation). **User instruction
[2026-09-17]: the real PPA, not `ppa-stub`, is the intended test target** - `docs - MLA/e2e-testing/checklist.md`
(added the same day) was restructured around this after being written first against `ppa-stub`.

**Built**       `docs - MLA/e2e-testing/checklist.md` - an 18-section functional happy-path checklist
                walking MLA's whole pipeline stage by stage (ingestion → canonical selection →
                classification → decode → JWS → PII tokenization → envelope/schema → delivery → offset
                commit), registered per the indexing rule in `strategy.md` §2.7/§3. A real architecture gap
                surfaced immediately on trying to point MLA at the real PPA: `HttpsPpaClient.deliver()`
                (`src/clients/ppa.client.ts`) unconditionally used `https.request` with a mandatory client
                cert/key/CA read at construction - no plain-HTTP path existed, and the real PPA is plain
                HTTP on :3000 with no mTLS port found on any of six checked candidates (443/3443/4443/8443/
                3001/4000). Raised to the user rather than guessed at or silently worked around
                (`CLAUDE.md`'s external-decisions rule); **user chose: add a dev-only plain-HTTP bypass,
                mirroring the existing `JWS_VALIDATION_DISABLED` pattern.** Built as `PPA_MTLS_DISABLED`
                (default `false`) - `config.interface.ts`/`config.service.ts` (the three cert-path fields
                become optional only when this is explicitly `true`, never silently), `ppa.client.ts`
                (`deliver()` now branches `http.request`/`https.request` on the flag; `tlsOptions` is
                `undefined` and no cert file is ever read when bypassed; `probeReady()`'s existing
                protocol-detection guarded against the now-optional `tlsOptions`), a new
                `mla_ppa_mtls_bypassed` gauge (`metrics.interface.ts`/`metrics.client.ts`, same shape as
                `mla_jws_validation_bypassed`) and a boot-time `WARN` log (`index.ts`), and `.env.template`
                documented with the same loud-bypass framing as its JWS sibling.

**Tests**       17 new/changed: 3 in `ppa.client.test.ts` (never reads cert material when bypassed; delivers
                over plain HTTP with no TLS options; classifies the plain-HTTP response identically to a
                real mTLS one), 2 in `config.service.test.ts` (defaults to `false`; an explicit `true` no
                longer requires the three cert paths, which resolve to `''`), 1 in `metrics.client.test.ts`
                (the new gauge, default 0, set to 1), plus the `PPA_MTLS_DISABLED`/`mtlsDisabled` field
                threaded into the existing full-snapshot and "every supplied value" config tests and into
                five other test files' `Metrics` mocks (mechanical, not new behaviour under test). Full
                suite: 493 tests, 100%/97.74%/100%/100% against the 96% gate, zero lint errors (0 errors /
                225 pre-existing warnings, none new), `npx tsc --noEmit` clean on both the root and
                `tools/tsconfig.json`.

**Verified**    `live` - against the real running process, pointed at the real PPA, not a mock or `ppa-stub`.
                Booted with `PPA_BASE_URL=http://10.0.115.186:3000`, `PPA_MTLS_DISABLED=true`: the designed
                `WARN` line fired, `/health/ready` was `{"status":"UP","kafka":"UP","piiSecret":"UP",
                "jwsKeyStore":"UP"}`, `/metrics` showed `mla_ppa_mtls_bypassed{service="cch-mla"} 1`. Fed the
                happy-path corridor `01_MWK_to_ZMW_PRIMARY` re-signed (`--resign 0-19`, 6 of 20 structurally
                unsignable and skipped by the tool itself, as expected): **all 8 canonical records - 2 each
                of QUOTE/FXQUOTE/TRANSFER/FXTRANSFER - were forwarded and accepted by the real PPA with HTTP
                200** (`mla_forwarded_total` by type, `mla_ppa_delivery_outcomes_total{outcome="success"}=8`,
                zero of any other outcome). `mla_skipped_total` (`egress=11`, `party-lookup=1`) plus the 8
                forwarded accounts for all 20 fed records exactly. `mla_tokenization_failures_total=0`,
                `mla_consumer_lag=0` on all 12 partitions once settled. Full narrative and the exact config
                used: `e2e-testing/checklist.md` §19. **What this does not prove**: mTLS itself (bypassed by
                design for this run) or anything about PPA's own processing after its HTTP 200 (translation,
                correlation, TMS dispatch) - this checklist has no visibility into the real PPA's store or
                logs, unlike the `ppa-stub` path's `received.jsonl`.

**Diverged**    New divergence, not in §12's register because it is infrastructure, not application
                behaviour: MLA now has a second security-bypass flag (`PPA_MTLS_DISABLED`) alongside
                `JWS_VALIDATION_DISABLED`. Both are testing-only, default off, loudly observable, and
                neither is production-safe - **`PPA_MTLS_DISABLED=true` is a real, standing gap while it's
                on** (unauthenticated, unencrypted MLA↔PPA traffic), not a mechanism that turns itself off;
                nothing in this repo enforces disabling it again.

**Also done, same day:** CCH provided two GitHub usernames for the INFITX deployment team - Khaled Saidi
(`KhaledSaiidi`) and Oscar Cobar (`orcr`) - to be granted GHCR Read access on `psl-izyane-cch-frms/cch-mla`
(§6's own access model, the Phase 8 entry above). The user is inviting both manually; not something this
session performed. Recorded in `docs - MLA/deployment/MLA-deployment-kubernetes.md` §6/§12.

**Left open**   Whether `PPA_MTLS_DISABLED=true` stays the working mode or the PPA side eventually adds real
                mTLS is not this repo's decision. Nothing about PPA's own processing of the 8 delivered
                envelopes has been confirmed - ask the PPA engineer. The real FX-side rejection sample and
                the `TxSts: "ABOR"` gap (§14 Q3) remain untouched by this entry. `KhaledSaiidi`/`orcr`'s
                GHCR invites are not yet confirmed sent.

### Phase 8 (partial) — PPA's source found locally; e2e-testing checklist §3 rewritten around it   [2026-09-17]

Same thread, later the same day. **User-reported fact**: PPA's source repository, `cch-ppa`, is available
locally at `/home/abdul-rahim/mojaloop/cch-ppa` (same self-hosted GitLab org as `cch-mla`:
`open-frms/cch-frms/cch-ppa`). This corrects the entry above and every earlier claim in this knowledge
base that `docs - MLA` has "zero visibility" into PPA's code - that was only ever true before this was
pointed out. `CLAUDE.md` and `strategy.md` §1 updated to say so plainly rather than carry the stale claim.

**Built**       Nothing in `cch-mla` - this entry is documentation-only, correcting the knowledge base and
                `e2e-testing/checklist.md` §3 (PPA correctness definition of done, added earlier the same
                day) to reflect the discovery. §3's tag system was rewritten: `[PPA-engineer]` (implying
                every check needs the other engineer's cooperation) replaced with `[code-level]` (answerable
                by reading `cch-ppa`'s source directly), `[local-stack]` (answerable by standing up
                `cch-ppa`'s own `docker-compose.yml` - PPA + Postgres (its write-ahead store) + ValKey
                (its correlation cache), fully self-contained, confirmed present in the repo), and
                `[remote-instance]`/`[Tazama]` kept for what genuinely still needs the deployed instance or
                a confirmed downstream Tazama target. Most of §3's ten subsections were reclassified from
                "needs the PPA engineer" to "achievable this session, not yet done."

**Tests**       None - documentation only.

**Verified**    `live`, partially - confirmed the repo exists at the stated path, its git remote matches
                `cch-mla`'s own org, and its `docker-compose.yml` genuinely defines a PPA + Postgres +
                ValkKey stack with mTLS certs and a separate operator port. Its `git log` was read to name
                specific commits implementing idempotency, classification/correlation, domestic/cross-border
                discrimination, ISO translation, ajv/TMS schema validation, and DLQ replay (the last one
                flagged `(unreviewed)` in its own commit message). **Not verified**: the local stack has not
                been stood up, nothing has been run against it, and no line of `cch-ppa`'s actual translation
                or idempotency logic has been read yet - this entry records the *capability* the discovery
                unlocks, not a completed verification of any of §3's items.

**Diverged**    None from §12's register - documentation/process only, no application behaviour anywhere
                changed.

**Left open**   Every item in `e2e-testing/checklist.md` §3 is still unchecked. The recommended next step,
                per that section's own closing note, is standing up `cch-ppa`'s local compose stack and
                re-running §1's corridor against it. Two things stay out of reach even then: what the
                *specific* already-completed 8-envelope run (the entry above) did on the *remote*
                `10.0.115.186:3000` instance, and where that remote instance's own TMS target actually
                points - both still need the PPA engineer or further discovery, not a source read.

### Phase 8 (partial) — MLA shipped to the deployed cluster against the real PPA; connectivity blocker found   [2026-09-17]

Same thread, later the same day. Infrastructure work, not a story - `CLAUDE.md`'s "How a story gets built"
§5/§10 instruction, same basis as the three Phase 8 entries above.

**Context.** A separately-deployed MLA already exists on its own machine (`10.0.150.69`, SSH key
`~/.ssh/mojaloop_fx_10_0_150_69`, namespace `mla`), consuming traffic fed onto its Kafka topic via
`npm run feeder` on the Mojaloop demo cluster (not organic live traffic) - but configured to deliver to a
co-located `ppa-stub`, not the real PPA this session's other two Phase 8 entries targeted.

**Built**       Nothing new in `cch-mla` itself - this entry ships the `PPA_MTLS_DISABLED` fix (the entry
                two above) to that already-running deployment. Image rebuilt, shipped with no registry
                (that host has no internet): `docker save | ssh | docker load`, then
                `kind load docker-image ... --name mojaloop-fx`. `cch-mla-config` ConfigMap patched -
                `PPA_BASE_URL`/`PPA_HEALTH_BASE_URL` -> `http://10.0.115.186:3000`,
                `PPA_MTLS_DISABLED=true` - and the deployment rolled to the new image.

**Tests**       None - deployment and diagnostic work only, no application code changed in this entry.

**Verified**    `live`, in two parts. **First, the deployment itself**: new pod `1/1 Running`, boot log
                carried the designed `PPA_MTLS_DISABLED=true` `WARN` line, `/health/ready` all `UP` - and
                delivery to the real PPA was briefly confirmed working from this same deployment earlier the
                same session. **Second, connectivity then broke, and was checked from three vantage points**
                once noticed: this machine reaches `10.0.115.186:3000` fine (`curl` -> HTTP 200,
                `{"ready":true,...}`, re-confirmed on a later re-check with an identical result);
                `10.0.150.69` times out (`curl: (28) Connection timed out after 5001 milliseconds`;
                `ip route get 10.0.115.186` resolves via its own gateway, `10.0.150.1 dev ens192`, not
                through any VPN this session controls); the `cch-mla` pod itself also times out - its image
                has no `curl`/`wget`/`node` to test with directly (a minimal runtime image), so an ephemeral
                debug container was attached to the pod's network namespace via
                `kubectl debug ... --target=cch-mla`. The obvious debug image (`nicolaka/netshoot`) could
                not be pulled - that node has no internet access, confirmed by watching it retry and time out
                against `registry-1.docker.io` for two minutes straight - so `redis:5.0.4-alpine` was used
                instead, already cached locally on the node from earlier work; its BusyBox `wget` was enough:
                `wget: download timed out`, same failure as the host.

**Diverged**    None from §12's register - infrastructure/deployment only, no application behaviour changed.

**Left open**   **The connectivity gap itself - tracked as a blocker in §13.1, not resolved here.** No code
                or config change is needed on MLA's side once the network path reopens; it will resume
                delivering automatically, no restart required. The recommended check once it does:
                `kubectl -n mla logs -l app=cch-mla --tail=30` on `10.0.150.69` for `Forwarded ...` lines and
                non-`parked` delivery outcomes - real traffic, not a re-run of §1's synthetic 8-envelope feed.
                Beyond that, per `e2e-testing/checklist.md` §3's own open items: confirm PPA's own processing
                (not just its HTTP 200), and separately check whether the delivered messages actually reach
                the local Tazama TMS stack correctly correlated.

### Phase 8 (partial) — 17-Sept check-in: CCH deployment not yet attempted; Infotex call needed for two items   [2026-09-17]

Documentation-only, from `docs/meetings and emails/17-sept-checkin-for-pending-items.md` (a status/pending-items
meeting, not a technical thread — no code, config or manifest decision came out of it). Read together with
the three Phase 8 entries above; this is where the knowledge base's own account and CCH's actual cluster
status were checked against each other and found to disagree on one point.

**The correction this entry makes.** Every Phase 8 entry so far in this log describes work done on this
side — manifests built, image pushed to GHCR, a live delivery proven against the real PPA — plus a
**separate, Paysys-owned test deployment** at `10.0.150.69` (namespace `mla`, on the Mojaloop *demo*
cluster, not CCH's own). It would be easy to read that activity as CCH's deployment being under way. It
is not. **CCH's techops team has not yet attempted `kubectl apply` on their own cluster** — the full
manifest/namespace/ConfigMap package reached them on 2026-09-15 (`MLA-deployment-kubernetes.md`'s own 15
September update), via George Murage — CCH's technical lead and our point of contact, not techops himself,
though the meeting record has him speaking for that team's next step. As of this 09-17 check-in George
confirmed the notes are clear on techops' side and reported no questions for now; `kubectl apply` had
*not yet been run*. Behjet (BA) flagged the gap as a risk, called manageable if closed by end of week.
**`10.0.150.69` remains what it always was — this side's own test rig, useful for proving the mechanism,
not evidence of anything on CCH's cluster.**

**What else came out of it, mapped onto what this knowledge base already tracks:**

- **Two items need a call with Infotex** (spelled "Infitecs" in the raw meeting note; same party named
  throughout `docs/meetings and emails/9-sept.md` and `MLA-deployment-kubernetes.md` §11 as the source of the DFSP
  JWS public keys) — not new items, but a new blocker on *closing* two already-open ones: whether MLA's
  outbound IP is public (so Paysyslabs can be allow-listed on Infotex's side), and whether the mTLS
  certificate is embedded in MLA directly or routed via a dedicated egress gateway. Both bear on
  `MLA-deployment-kubernetes.md` §11 Q4/Q5 (the PPA endpoint address and mTLS provisioning — "architecture
  resolved 2026-09-15, addresses/gateway not yet built"); the call itself is not yet scheduled. Oscar
  (Infotex) has accepted the GitHub invite and is copied on relevant threads.
- **JWS validation.** George still needs to confirm with the Mojaloop Foundation (Michael/Sam) that the
  hub is the only ingress into MLA, before his own proposal to disable MLA's signature validation
  (`george-reply-2026-09-15.md` item 2, already recorded as **not accepted as a permanent change** —
  `MLA-deployment-kubernetes.md` §11's 15 September update, `JWS_VALIDATION_DISABLED` built as a scoped,
  reversible testing-only bypass instead) can be treated as settled either way. Mutale is sending that
  query to Michael directly. **No change to what is already on record** — this is progress on an already-
  tracked open item, not a new one.
- **PII secret.** George believes it relates to the tokenization discussion and asked Behjet to resend
  context separately; the user (Abdul Rahim) is to clarify and share on Slack. This is gate item #2
  (§7.1 #2, §13.1) continuing to move through CCH's side — no new information about the rotation-trigger
  mechanism itself came out of this meeting.
- **GitHub/GHCR access — closed.** GitHub IDs provided, Oscar added, token generation and testing in
  progress. Matches the entry two above (`KhaledSaiidi`/`orcr` invited); this meeting confirms the
  invites were acted on rather than left pending.

### Phase 8 (partial) — Interim mTLS CA on `10.0.150.69` found to be the wrong material; regenerated and corrected   [2026-09-21]

George's 2026-09-20 follow-up (`docs/docs - MLA/deployment/george-reply-2026-09-20.md`) confirmed TLS
1.2/1.3 and any OpenSSL cipher suite, confirmed whitelisting as the connectivity mechanism, and proposed a
CSR-based exchange for the mTLS PKI material so `client.key` never crosses the boundary — `ca.crt` and
`client.crt` were the two files actually needed from Paysys to start that exchange.

**What went wrong.** `MLA-deployment-kubernetes.md` §8 item 1 records a dedicated interim Interconnect CA
as generated 2026-09-15. Retrieving that material from the live `cch-mla-ppa-mtls` secret (`mla`
namespace, `10.0.150.69`) to actually send it to George found it was not that CA at all — it was
`cch-mla-harness-ca` (`O=cch-mla dev harness`, issued 2026-09-14), the same self-signed CA
`cch-mla/tools/ppa-stub/certs/` uses for local test-harness runs against `ppa-stub`. The dedicated
Interconnect CA the documentation described either was never actually generated, or was generated and
never made it into the deployed secret — either way, the secret held the wrong material. **Caught before
anything was sent externally** — no correction owed to George, since nothing had reached him yet.

**Fix.** A correctly scoped, dedicated CA was generated (`O=Paysys, CN=cch-mla-ppa-interconnect-ca`,
10-year root; MLA's client cert at `CN=cch-mla-client`, signed by that root, ~825-day validity). The live
`cch-mla-ppa-mtls` secret was deleted and recreated from the new `ca.crt`/`client.crt`/`client.key` the
same day. `ca.crt` and `client.crt` (never `client.key`) were sent to George the same day, as the two
non-sensitive files his 09-20 email asked for.

**Verified**   `live` — confirmed via SSH onto `10.0.150.69` (key `~/.ssh/mojaloop_fx_10_0_150_69`) that
                the secret existed, extracted and inspected both the old and new `ca.crt`/`client.crt`
                with `openssl x509 -noout -subject -issuer -dates` before and after, confirming the wrong
                subject/issuer on the original and the correct one on the replacement. Secret deletion and
                recreation both confirmed via `kubectl get secret` before/after. Temporary cert files
                copied to the remote box's `/tmp` for the `kubectl create secret --from-file` step were
                deleted immediately after the secret was created, in the same command chain.

**No traffic impact.** `PPA_MTLS_DISABLED=true` is still active on this deployment (`MLA-deployment-
kubernetes.md` §7) — MLA is not currently using this secret's contents for any live connection to the real
PPA, so the wrong material was never actually exercised and no pod restart was needed or performed. This
was a documentation/provisioning correction, not an incident.

**Left open**   Same items already tracked: George's CSR-based exchange (§8 item 1) is the next step,
                pending his review of the corrected `ca.crt`/`client.crt`; the PPA hostname/IP re-check
                (§11 Q4) is still with Paysys's network team; the ingress-gateway architecture is still not
                built. `client.key`/the CA's own private key are held locally (this session's scratchpad,
                not committed to any repository) pending the secret's role being superseded by the gateway
                architecture.

**Docs updated**   `MLA-deployment-kubernetes.md` §8 item 1, §11 Q5, and its top-of-file 21-September
                dated update block; `cch-mla/deploy/kubernetes/README.md`'s "Certificate Provisioning"
                section.

**Built**       Nothing in `cch-mla` — documentation only.

**Tests**       None.

**Verified**    `live`, by report — this entry records what was said in the meeting, not something checked
                independently against CCH's cluster (this knowledge base has no access to it). The one
                claim worth flagging as unconfirmed rather than restated as fact: whether George's
                deployment attempt happens by end of week, as Behjet's risk framing assumed, is not
                something this session can verify — it is CCH's own timeline.

**Diverged**    None — no application or infrastructure behaviour changed; this entry corrects the
                knowledge base's own status claims, not the system.

**Left open**   The Infotex call (outbound IP, cert embedding vs. egress gateway) is not yet scheduled.
                Whether George has since attempted deployment is not known to this session — the next
                check should ask directly rather than assume either outcome. `strategy.md` §1 and `plan.md`
                §1's status table are updated by this same sweep to stop implying CCH-side deployment has
                happened.

### Phase 8 (partial) — PPA stood up locally, in progress   [2026-09-21]

**Context.** The cross-machine connectivity blocker (§13.1) between the deployed MLA (`10.0.150.69`) and
the real PPA (`10.0.115.186:3000`) has no resolution date. Rather than wait on it, E2E work is moving to a
local stand-up of both services on this machine — `e2e-testing/locally-up.md`, added [2026-09-21]. This
entry records the first half of that: PPA is up and live-verified; MLA and the corridor feed are not yet
done, so this phase of work is itself still in progress, not closed.

**Built**       Nothing in `cch-ppa` or `cch-mla` — no application code touched. Local environment setup
                only: `cch-ppa/.env` from its template, and a throwaway dev mTLS cert set generated into
                `cch-ppa/certs/` (CA, server/client pair, and a separate operator CA/server/client set) —
                gitignored, not committed, documented in `e2e-testing/locally-up.md` §3.

**Real gap found and fixed, not previously known.** `locally-up.md`'s own first draft assumed
`DOCS_INSECURE_HTTP=true` made certificates unnecessary for a local PPA boot. That's wrong: PPA's
operator-replay listener (`initializeOperatorServer`) starts before the ingress listener and reads its
mTLS cert files unconditionally, regardless of that flag — with no `certs/` directory, PPA crash-loops on
every boot attempt (`ENOENT ... ppa-operator-server.crt`). `cch-ppa` ships no cert-generation script of
its own. Fixed by generating a full throwaway set matching every path `.env.template` defaults to. Two
further local-only snags surfaced and were fixed in sequence: `docker compose up` had already
auto-created `cch-ppa/certs/` as `root:root` (from an earlier attempt, before the host directory existed —
Docker creates the missing bind-mount path itself, as root) — required `sudo chown` back to the invoking
user before certs could be written; and the generated `.key` files defaulted to mode `600`, unreadable by
the container's distroless `nonroot` user — fixed with `chmod 644`. Full detail:
`e2e-testing/locally-up.md` §6.1.

**Verified**    `live` — `docker ps -a` showed `cch-ppa-ppa-1 Up`, `cch-ppa-postgres-1 Up ... (healthy)`,
                `cch-ppa-valkey-1 Up ... (healthy)`; PPA's boot log carried
                `Operator server listening on 0.0.0.0:3010`, `Metrics server listening on 0.0.0.0:9464`,
                the designed `DOCS_INSECURE_HTTP is set - serving plain HTTP with NO mTLS on any route.
                Dev only.` WARN, and `Fastify listening on 0.0.0.0:3000`; `curl http://localhost:3000/
                health/ready` returned `{"ready":true,"checks":{"writeAheadStore":true}}` — the same
                shape confirmed against the remote instance on 2026-09-17.

**Tests**       None — this is environment stand-up, not application code; no test suite runs here.

**Diverged**    None from the design. Diverged from this document's own first draft of the *procedure*,
                corrected in place in `e2e-testing/locally-up.md` §3/§6.1 rather than left standing.

**Left open**   MLA is not yet stood up locally, and no corridor has been fed through either service —
                `e2e-testing/locally-up.md` §2's MLA and feed/verify checklist sections are still
                unchecked. TMS dispatch is separately out of scope for this pass (§6.2): the local
                `tazama-tms-1` stack is running, but the Tazama `auth-service`/Keycloak instance PPA's
                bearer-token chain depends on is not. This phase is not done by the §13 definition until
                MLA is up, the corridor is fed, and the checklist's feed/verify boxes are live-verified.

### Phase 8 (partial) — MLA stood up locally, corridor fed twice, PPA's own store inspected directly for the first time   [2026-09-21]

**Context.** Continuation of the entry above. MLA is now also up locally, pointed at the locally-run PPA
instead of the unreachable remote one, and a full corridor was fed through both — twice, the second time
specifically to catch ValKey state within its TTL window after the first attempt missed it. This is the
first time `e2e-testing/checklist.md` §3's `[local-stack]` items have actually been checked against real
Postgres/ValKey state rather than only read from source.

**Built**       Nothing in `cch-mla` or `cch-ppa` — no application code touched. `cch-mla/.env`'s
                `PPA_BASE_URL`/`PPA_HEALTH_BASE_URL` repointed from the remote `10.0.115.186:3000`
                (2026-09-17's value) to the local `http://localhost:3000`; everything else in that file
                (Kafka, PII secret, PPA_MTLS_DISABLED) was already correct from the 2026-09-17 run and
                needed no change. Keys (`tools/dfsp-keys`) and the PII secret
                (`tools/pii-secret/generated/local.secret`) already existed from prior sessions and were
                verified present rather than regenerated.

**Verified**    `live` — `npm run harness:up` brought the existing (stopped) Redpanda containers back up;
                `topic-event-audit` confirmed at 12 partitions directly (`rpk topic describe`). MLA booted
                clean: `/health/ready` → `{"status":"UP","service":"cch-mla","kafka":"UP","piiSecret":"UP",
                "jwsKeyStore":"UP"}`, boot log carrying the designed `PPA_MTLS_DISABLED=true` WARN. Fed
                `01_MWK_to_ZMW_PRIMARY/raw_messages.json` (20 records, `--resign 0-19`): all 8 canonical
                envelopes forwarded and accepted (`mla_forwarded_total`: 2 each of
                QUOTE/FXQUOTE/TRANSFER/FXTRANSFER; `mla_ppa_delivery_outcomes_total{outcome="success"}=8`,
                no other outcome; `mla_skipped_total` egress=11 + party-lookup=1 + 8 forwarded = 20, every
                record accounted for; `mla_tokenization_failures_total=0`; consumer lag 0 on all 12
                partitions after settling) — the same shape as the 2026-09-17 remote-PPA run, now against
                the local one.

**PPA's own store inspected directly for the first time** (`e2e-testing/checklist.md` §3.1, §3.4, §3.7,
                §3.10 — previously `[local-stack]`/not yet done): `write_ahead` held all 8 rows.
                `FXQUOTE`/`FXTRANSFER` both `status='completed'`. **`QUOTE` (`pain.001`/`pain.013`) and
                `TRANSFER`'s `pacs.008` leg both `status='failed'` with `LOCAL_VALIDATION_FAILED`** —
                missing required ISO fields (`PmtMtd`, `ReqdAdvcTp`, `RmtInf`, `ChrgBr`, `Purp`, and
                others) — this is `cch-ppa/README.md`'s own already-documented gap (those three message
                types' field mapping is not yet schema-complete), now confirmed live for the first time
                rather than only known from reading the source; **not a defect introduced by this session's
                setup.** `TRANSFER`'s `pacs.002` leg then failed with `IDENTITY_UNRESOLVED` ("refusing to
                synthesize a pacs.002 (R-04)") — a correct downstream consequence of `pacs.008` never
                reaching the step that writes its identifier mapping, itself a positive confirmation that
                the R-04 "never synthesize" protection works as designed under a real failure, not a
                fabricated test case. `ValKey`'s `correlation:<transferId>` hash (after a second feed,
                checked promptly this time — the first check came back empty purely because the default
                300s correlation TTL had already lapsed by the time it ran, 13 minutes after the first
                feed) held every merged field for the transaction (`quote`, `quoteCallback`, `fxQuote`,
                `fxQuoteCallback`, `fxTransfer`, `pain001Pin`, `pain013Pin`, `pacs008Pin`, correctly no
                `pacs002Pin`), with `quote-id-map:<quoteId>`/`fxtransfer-id-map:<fxTransferId>` as separate
                lookup indices — a more informative keying scheme than `checklist.md` §3.4 had assumed
                (`conversionRequestId`/`commitRequestId` directly), corrected there. PII fields inside the
                cached `quote` (`payee`/`payer`/`personalInfo`) all carried `tkn_...` prefixes, confirming
                tokenization intact at this layer. The same tokenization was independently confirmed inside
                a dead-lettered (`status='failed'`) row's own `envelope` column directly in Postgres,
                closing `checklist.md` §3.10's DLQ-tokenization item.

**Tests**       None — environment stand-up and live verification, not application code.

**Diverged**    None from the design. `e2e-testing/checklist.md` §3.4's assumed ValKey key names were
                corrected to match what the code actually uses, in the same pass.

**Left open**   Everything downstream of TMS dispatch (`checklist.md` §3.6 Tazama-side confirmation, §3.8,
                §3.9) is not exercisable as things stand — no message from today's four types reached TMS,
                since three of the four failed local validation first and the fourth (`pacs.002`) had
                nothing to resolve against. This is blocked on the same pre-existing schema-completeness
                gap `cch-ppa/README.md` already names, not on local-stack access. The deliberate
                fault-injection variants (§3.1's outage case, §3.2's malformed-envelope case, §3.3's
                duplicate-redelivery case, §3.5's domestic/race cases) and the remaining code-level reads
                are still open, listed in full in `checklist.md`'s own updated "Definition of done for this
                section". TMS dispatch's own missing local `auth-service`/Keycloak dependency
                (`locally-up.md` §6.2) is unrelated to and does not block any of the above.

### Phase 8 (partial) — Michael's reply on the JWS-validation-disable question; confirms the premise, does not grant the ask   [2026-09-21]

**Context.** Mutale put the JWS-validation-disable question to Michael (Mojaloop Foundation) directly, per
the 09-17 check-in's tracking (§16's own "17-Sept check-in" entry above): whether the hub is the only
ingress/egress into the system, so that Paysys can safely turn `JWS_VALIDATION_DISABLED` on as more than a
scoped testing bypass while the DFSP-key/MCM question (§13.1's DFSP-keys row) remains unresolved. The
question stated explicitly that DRPP already validates every message, so the concern was never "could an
invalid signature slip through" — it was whether Kafka's audit topic could be reached by anything other
than the hub.

**Michael's reply, verbatim:** "Nothing will get on to the Kafka topic unless it has already been
validated by the switch, and the Kafka topic is in the same system boundary as the validation process. I'm
not sure what would be gained by PaySys performing another validation. What kind of use case are they
planning to guard against?"

**What this confirms.** The specific premise asked about — that the hub is the only ingress/egress and the
audit topic sits inside the same trust boundary as the switch's own validation — is now confirmed directly
by the Mojaloop Foundation, not merely assumed from architecture diagrams. This is new, load-bearing
evidence for the "no other ingress" half of the original question.

**What it does not do.** Michael's reply answers the trust-boundary question but does not itself authorize
disabling JWS validation, and asks a fair question back — what failure mode MLA's own re-validation is
meant to catch, given the switch already validated. **In production, MLA's consumer process and the
DRPP/Kafka boundary Michael describes are the same boundary** — so a network-reachability or
different-trust-zone argument for keeping validation on does not hold here. The one candidate answer that
survives is narrower: JWS verification is tamper-evidence for the specific hop between the switch writing
to Kafka and MLA reading from it — a corrupted or truncated record on that hop is still something
validation would catch that trust-boundary confirmation alone does not rule out. A reused or misconfigured
consumer group stealing partition assignment (R-18) is a related but distinct concern — it is about
consumer-group identity, not signature validity, and JWS verification would not by itself catch it. Neither
point was in the question sent to Michael, so neither has been rejected — they simply have not been asked
yet, and whether it is worth raising a narrower tamper-evidence argument, given how directly Michael's
question already undercuts the broader one, is the user's call.

**No change to what is already on record.** `george-reply-2026-09-15.md` item 2's proposal to disable JWS
validation permanently is still **not accepted as a permanent change** (`MLA-deployment-kubernetes.md` §6's
2026-09-15 update) — `engineering-rules.md` treats DFSP signature verification as a non-negotiable, and
F-04 of the QA workstream specifically hardened it. `JWS_VALIDATION_DISABLED` remains what it was built as:
a scoped, reversible, loudly-observable testing-only bypass (`plan.md` §16's own 2026-09-15 entry), not a
mechanism this reply authorizes turning on as a standing default. Michael's answer moves the underlying
question forward — the trust-boundary premise is now confirmed rather than assumed — but the actual ask
(permanently disabling MLA's own validation) is still open, now with a follow-up question of Michael's own
attached to it. Tracked in §13.1 and `questions for comesa.md` Q1; the DFSP-keys/MCM item there is the real
fix regardless of how this sub-question resolves.

**Left open**   Whether to send Michael the narrower tamper-evidence argument above is a decision for the
                user, not yet actioned — weaker ground than this entry first stated, now that the
                trust-boundary argument for keeping validation on is confirmed not to apply in production.
                No engineering change follows from this reply either way — `JWS_VALIDATION_DISABLED` stays
                exactly what it already was.

### Phase 8 (partial) — Connectivity blocker (§13.1, discovered 2026-09-17) re-checked and confirmed resolved   [2026-09-21]

**Context.** The network path from the deployed MLA (`10.0.150.69`) to the real remote PPA
(`10.0.115.186:3000`) — tracked as a blocked-work item in §13.1 since 2026-09-17 — was re-checked at the
user's request, from the same three vantage points that originally found it broken.

**Built**       Nothing — diagnostic re-check only, no code or config touched. Distinct from, and unrelated
                to, the same-day local-stack work in the two entries above (that work exists because the
                remote PPA was unreachable at the time; it stands on its own regardless of this entry's
                outcome).

**Tests**       None.

**Verified**    `live`, all three vantage points green this time: this machine → PPA (`curl` → HTTP 200,
                `{"ready":true,...}`); the `10.0.150.69` host → PPA (`curl` → HTTP 200, `ip route get` still
                resolves via its own gateway `10.0.150.1 dev ens192` — same route as before, now simply
                working); and, the one that actually matters, **the `cch-mla` pod's own network namespace**
                → PPA, via the identical ephemeral-debug-container technique used to find the original break
                (`kubectl debug ... --image=redis:5.0.4-alpine --target=cch-mla`, `wget`, since the pod's own
                minimal image has no HTTP client) → `{"ready":true,"checks":{"writeAheadStore":true}}`, no
                timeout. The pod's own `/health/ready` (reached via `kubectl port-forward` to its `:3001`)
                additionally confirmed `kafka: UP` with `mla_consumer_lag{partition="0"}=0` — fully caught
                up with the broker, not stuck behind a backlog.

**Also checked, and worth recording precisely**: `mla_forwarded_total`/`mla_ppa_delivery_outcomes_total`/
                `mla_skipped_total` all carried **zero data — no series at all**, not merely zero-valued.
                The pod's own logs confirmed why: nothing logged since `2026-09-17T12:02:14Z`, immediately
                after its post-boot Kafka rebalance settled — no Kafka record has landed on partition 0
                since. This is the demo cluster being quiet, not a stuck consumer (lag=0 rules that out) and
                not the connectivity gap recurring (the direct pod→PPA probe above succeeded independently
                of any Kafka traffic). Flagged explicitly because "zero delivery activity" could otherwise be
                misread as the blocker persisting.

**Diverged**    None — no application or infrastructure behaviour changed; this entry closes a diagnostic
                loop, not a build.

**Root cause, per the user [2026-09-21]:** `10.0.150.69` and `10.0.115.186` sit on different subnets within
                the data centre; an infra person resolved the routing gap between them directly — not
                something visible from either host's own shell, consistent with what the three-vantage-point
                diagnosis on 2026-09-17 and this entry's re-check both already pointed at.

**Left open**   §13.1's row is now struck through as resolved, root cause known. The recommended next check,
                now that the path is open: `kubectl -n mla logs -l app=cch-mla --tail=30 -f` on
                `10.0.150.69`, watching for the first `Forwarded ...` line once a fed corridor (via `npm run feeder`)
                actually arrives — that will be the first live delivery to the real remote PPA since
                2026-09-17's original run. Everything else queued behind this (confirming PPA's own processing of
                delivered records beyond its HTTP 200, and whether they reach the local Tazama TMS stack
                correlated correctly) is unchanged from the entry two above and from
                `e2e-testing/checklist.md` §3's own open items.

### Phase 8 (partial) — Root cause of the connectivity blocker confirmed; first real corridor fed live to the real remote PPA since the fix   [2026-09-21]

**Context.** Two threads, same day, immediately following the entry above. First, the user supplied the
root cause the previous entry had explicitly flagged as unknown. Second, rather than wait for organic Kafka
traffic on `topic-event-audit` (idle since 2026-09-17, per that same entry), a real corridor was deliberately
fed onto the real topic on `10.0.150.69`'s own cluster, to get a genuine live delivery to the real remote
PPA on record rather than continuing to wait.

**Root cause, per the user.** `10.0.150.69` and `10.0.115.186` sit on different subnets within the data
centre; an infra person resolved the routing gap between them directly. Not independently verifiable from
either host's own shell — recorded as reported, consistent with everything the three-vantage-point diagnosis
on both 2026-09-17 and 2026-09-21 already pointed at (a routing/firewall gap between the two subnets, not
anything wrong with MLA itself). §13.1's row updated with this in place of "not yet determined."

**Built**       Nothing in `cch-mla` — no application code touched. Two ephemeral local artifacts, both
                torn down at the end of this entry's own work rather than left running: a `kubectl
                port-forward -n demo svc/kafka 9092:9092 --address=127.0.0.1` on `10.0.150.69` itself
                (re-tunneling the in-cluster Kafka service to the host's own loopback), and a local SSH
                tunnel (`ssh -L 9092:127.0.0.1:9092 ...`) chaining that through to this machine. Two
                `/etc/hosts` entries were required for the Kafka protocol's own reconnect behaviour, not
                just the initial bootstrap - `kafka.demo.svc.cluster.local` (the Service, used for the
                bootstrap connection) and, since the broker's actual `advertised.listeners`
                (`kafka-controller-0.kafka-controller-headless.demo.svc.cluster.local:9092`, confirmed
                directly from the pod's own `server.properties`) names a different, per-broker FQDN that
                the client reconnects to immediately after fetching metadata,
                `kafka-controller-0.kafka-controller-headless.demo.svc.cluster.local` too - both mapped to
                `127.0.0.1`. The second entry already existed from an earlier session's own dry run
                (`deployment/local-deployment.md` §7); only the first needed adding this time, with the
                user running the one `sudo tee -a /etc/hosts` line directly (this session has no
                passwordless sudo). One genuine hiccup along the way: the *first* attempt at the remote
                port-forward silently died (confirmed by a direct `/dev/tcp` probe against `127.0.0.1:9092`
                on `10.0.150.69` itself returning "Connection refused") - most likely killed by an earlier
                `pkill -f "port-forward svc/kafka"` issued in the same command whose own SSH session then
                got cut short by the harness's command classifier before confirming success (the same
                unpredictable-blocking behaviour `continue - before phase 8.md` already warned about).
                Diagnosed via the ECONNRESET pattern kafkajs reported (TCP accept succeeds locally, then
                resets - consistent with SSH accepting the local socket and immediately failing to relay to
                a dead remote target) and fixed by simply restarting the remote port-forward.

**Tests**       None - live traffic generation and diagnostic work, no application code changed.

**Verified**    `live`, in full, via `cch-mla`'s own `tools/capture-feeder`
                (`__tests__/fixtures/DRPP_Kafka_E2E_Pack/01_MWK_to_ZMW_PRIMARY/raw_messages.json`, 20
                records, `--resign 0-19`, `KAFKA_BROKERS=kafka.demo.svc.cluster.local:9092` overridden for
                this one invocation only - the shared `cch-mla/.env`'s own `KAFKA_BROKERS` was left pointed
                at today's separate local-stack harness, untouched). Before feeding, the four DFSP ids the
                corridor needs (`test-mwk-dfsp`, `test-zmw-dfsp`, `test-fxp2`, `hub-region-stg`) were
                confirmed already present in `10.0.150.69`'s own `cch-mla-jws-keys` secret, and their public
                keys checksummed (`openssl md5`) against this machine's own `tools/dfsp-keys/store/*.pem` -
                exact matches on all four, confirming the locally-held private keys
                (`tools/dfsp-keys/private/`) would produce signatures the deployed MLA's own key store could
                verify, before spending any Kafka traffic on a mismatch. Fed cleanly once both fixes above
                landed: **all 8 canonical records - 2 each of QUOTE/FXQUOTE/TRANSFER/FXTRANSFER - forwarded
                and accepted by the real PPA at `10.0.115.186:3000` with HTTP 200**, watched live via a
                `Monitor` tail of the pod's own logs as each `Forwarded <EVENTTYPE> (id=...)` line landed in
                real time, then confirmed against `/metrics`: `mla_forwarded_total` 2 per event type (8
                total), `mla_ppa_delivery_outcomes_total{outcome="success"}=8` with no other outcome,
                `mla_skipped_total` `egress=11`+`party-lookup=1`, `11+1+8=20` - every fed record accounted
                for exactly once, `mla_tokenization_failures_total=0`, `mla_consumer_lag{partition="0"}=0`
                once settled. Same shape as the original 2026-09-17 run and today's local-stack run (the
                entry three above) - now specifically against the real remote PPA, over the real network
                path, for the first time since the connectivity break.

**Diverged**    None from §12's register - live-traffic generation against an already-built pipeline, no
                application behaviour changed.

**Left open**   Exactly what `e2e-testing/checklist.md` §3 already names: PPA's own processing of these 8
                envelopes beyond its HTTP 200 (translation, correlation, TMS dispatch) has no visibility
                from this side - `[remote-instance]` items still need the PPA engineer or further discovery.
                Given today's separate local-stack finding (the entry three above) that 3 of these 4 message
                types currently fail PPA's own local ISO-field validation, the same outcome should be
                assumed here too unless/until checked directly - an HTTP 200 from the remote instance proves
                durable persist (`core-knowledge.md` §6.1 step 2), nothing past it. The ephemeral tunnel
                infrastructure (port-forwards, SSH tunnel) built for this entry was left running rather than
                torn down, in case immediately re-feeding or re-checking is wanted next - not a
                standing/committed piece of infrastructure, and safe to kill at will.

### Phase 8 (partial) — SSH access to the real remote PPA obtained; its own write-ahead store inspected directly, closing the last `[remote-instance]` gap   [2026-09-21]

**Context.** Immediately following the entry above. The user obtained SSH credentials
(`abdul.rahim@10.0.115.186`, initially password-based) for the real PPA host itself - infrastructure this
knowledge base previously had zero access to, distinct from `10.0.150.69` (MLA's own host). Password auth
was switched to a dedicated key pair (`~/.ssh/ppa_10_0_115_186`, `ssh-copy-id`) so the session could
connect non-interactively going forward, the same way it already does for `10.0.150.69`. Documented
separately, briefly, in `learning/PKI/ssh-keypair-for-ppa-access.md` (why password auth can't be scripted,
what `ssh-keygen`/`ssh-copy-id` each do, the parallel to the CSR exchange in the sibling PKI doc).

**Built**       Nothing in `cch-mla`/`cch-ppa` - a dedicated SSH key pair only
                (`~/.ssh/ppa_10_0_115_186{,.pub}`), and the one learning doc above.

**Tests**       None.

**Verified**    `live`, via `docker ps` (this account has `sudo`, password-gated, no NOPASSWD) on
                `10.0.115.186`: **`cch-ppa-ppa-1`** (the real PPA process, port 3000, up 6 days) with its
                own **`cch-ppa-postgres-1`** (port 5432) and **`cch-ppa-valkey-1`** (port 6379) - and,
                genuinely surprising, a **separate, co-located local Tazama TMS stack on the same box**
                (`tazama-keycloak`, `tazama-postgres` on 5433, `tazama-valkey` on 6380, `tazama-nats`, up 4
                days) - not yet confirmed to be what PPA actually dispatches to, but a real candidate for
                the "where does the real instance's TMS target point" question that has been open since
                the first Phase 8 entries. Two attempts at reading the `cch-ppa-ppa-1` container's own env
                (for its TMS/NATS config) were **blocked by the harness's own safety classifier**
                (`Credential Materialization`, then `Production Reads`) - correctly cautious, since a full
                env dump on unfamiliar infrastructure can carry secrets; not pursued further this entry,
                left for the user to check directly if wanted. Pivoted instead to `cch-ppa-ppa-1`'s own
                Prometheus endpoint (`:9464/metrics`, no `sudo` needed) and, since the harness would not run
                further `sudo` reads unattended on this newly-accessed host, the user ran the remaining
                `psql`/`docker exec` commands directly and relayed the output back verbatim.

**PPA's own processing of the 8 envelopes from the entry above, confirmed byte-for-byte for the first time
                on the specific remote instance §1's original run actually targeted** (closing
                `e2e-testing/checklist.md` §3.1's and §3.10's `[remote-instance]` rows): `:9464/metrics`
                showed `ppa_local_validation_failed_total` = 2 each for `pain.001.001.11`/
                `pain.013.001.09`/`pacs.008.001.10`, `ppa_dlq_write_total{code="LOCAL_VALIDATION_FAILED"}=6`,
                `ppa_dlq_write_total{code="IDENTITY_UNRESOLVED"}=2`, `ppa_tms_circuit_breaker_state=0`
                (healthy, simply never invoked). Cross-checked directly in Postgres
                (`docker exec cch-ppa-postgres-1 psql -U ppa -d ppa`, real credentials found via
                `POSTGRES_USER`/`POSTGRES_DB` on the container - not `postgres`/`postgres` as first guessed):
                **all 8 rows present in `write_ahead`**, `(id, msg_type)` as the primary key, row-for-row
                matching the metrics exactly - `FXQUOTE`/`FXTRANSFER` (request+callback each)
                `status='completed'`; `QUOTE` request/callback (`pain.001`/`pain.013`) and `TRANSFER`
                request (`pacs.008`) `status='failed'`, `error.code='LOCAL_VALIDATION_FAILED'`, with the
                exact missing-field lists (`RmtInf`, `SttlmInf`, `ChrgBr`, `Purp`, `PmtMtd`, `ReqdAdvcTp`,
                `Dbtr`/`Cdtr`/`DbtrAcct`/`CdtrAcct`, and others) matching `cch-ppa/README.md`'s own
                documented gap and today's separate local-stack finding exactly; `TRANSFER`'s `pacs.002`
                `status='failed'`, `error.code='IDENTITY_UNRESOLVED'`, `"No cached or parked pacs.008
                identifier mapping found ... refusing to synthesize a pacs.002 (R-04)"` - the R-04
                protection working as designed, now proven on the real instance, not only the local stack.
                `created_at` on every row is `2026-09-17` (the original run); `updated_at` is today - the
                identical corridor re-fed today (the entry above) updated the same 8 rows rather than
                duplicating them, consistent with the `(id, msg_type)` primary key, though this alone
                doesn't distinguish "recognized as duplicate and skipped" from "re-validated and got the
                same result" - `processed_pairs` (seen in `\dt`'s table list, presumably the actual
                idempotency ledger) was not inspected this entry to settle which.

**A genuine new finding, not previously tracked anywhere**: inspecting the QUOTE request row's own
                `envelope` column closely, `payer.personalInfo.complexName` and both parties'
                `partyIdInfo.partyIdentifier` carry `tkn_...` prefixes as expected, but
                **`payee.personalInfo.complexName` sits raw and untokenized** -
                `{"lastName": "Banda", "firstName": "Chikondi"}` - in the same envelope, now persisted in a
                real (if test) deployed instance's own DLQ. **Confirmed this is a spec gap, not an
                engineering defect**: `core-knowledge.md` §4.1 and `cch-pii-user-stories.md`'s own
                Fields-to-Tokenize table list only "Payer legal name" for Quote request - there is no
                "Payee legal name" row at all, so MLA is tokenizing exactly what's specified. Every other
                exempt field in that table carries an explicit reason (the three ILP-packet rows all cite
                the cryptographic-binding constraint); this one has no stated rationale, and a real name is
                PII regardless of which party it belongs to. Checked against `core-knowledge.md` §13's open
                register and `qa-review-findings.md` - the existing "payee name" items (R-12, FSD Open Item
                #4) are a different problem entirely (payee display name having no *source* for ISO
                translation, not this tokenization asymmetry). **Flagged to the user directly, same session**
                per `CLAUDE.md`'s external-decisions rule - this is CCH's/the story author's call on whether
                the Fields-to-Tokenize table itself needs a "Payee legal name" row added, not something
                engineering can decide unilaterally.

**Diverged**    None from §12's register - a requirements-gap finding, not an application behaviour change.

**Left open**   Whether payee's `personalInfo.complexName` should be tokenized is now an explicit open
                question for CCH/the story author, not yet answered. The co-located `tazama-*` stack's
                relationship to PPA's actual TMS dispatch target is still unconfirmed - the two blocked
                `sudo` env-read attempts would likely have answered this directly; either re-attempt with
                the user relaying output, or ask the PPA engineer, whichever is faster. `processed_pairs`
                (the likely real idempotency ledger) was not inspected. Everything downstream of TMS
                dispatch (`checklist.md` §3.6's Tazama-side confirmation, §3.8, §3.9) remains blocked on the
                same pre-existing schema-completeness gap as the local-stack run, now confirmed identical on
                the remote instance too - not a remote-access problem any more, a `cch-ppa` code gap.

### MLA JWS validation removed (US-MLA-05 out of scope, N3 retired) — built and live-verified, closure pending sign-off   [2026-09-23]

**Built**       MLA no longer validates DFSP JWS signatures. Branch `paysys-remove-JWS`, cut
                from `paysys-E2E-testing`, left uncommitted for the user.
                Deleted: `jws-verification.service.ts`, `public-key-store.client.ts`,
                `jws.interface.ts`, their two test suites, `tools/capture-feeder/resign.ts`,
                `tools/dfsp-keys/` and `npm run keys:generate`.
                Edited: the envelope pipeline (tokenize directly after classification),
                the consumer (the PII secret is now the only transient local-dependency
                domain), config (all nine `JWS_*` variables gone, including
                `JWS_VALIDATION_DISABLED`), readiness (Kafka + PII secret only), metrics
                (`mla_keystore_unavailable_total`, `mla_jws_breaker_state`,
                `mla_jws_validation_bypassed` gone), alerts (`raiseSecurityAlert` and
                `raiseKeyStoreUnavailableAlert` gone), `ParkKind`, the composition root, the
                feeder (`--resign`, `--strip-signature`, `--tamper-body` gone), the scenario
                library (`missing-signature` scenario deleted), `verify-tokenization`,
                `.env.template`, `.dockerignore`, the K8s ConfigMap and Deployment (the
                `cch-mla-jws-keys` volume, mount and env ref gone), and both READMEs.
                The Event Envelope contract is untouched.
**Tests**       25 suites / 427 tests (from 27 / 493), 100% statements, 97.86% branches
                (from 97.74%), 0 lint errors (warnings 225 -> 216). **The N3 ordering test is
                deleted, not skipped** — with no validation step there is nothing for it to
                order against (`engineering-rules.md` N3, now retired). New assertions: a
                record with no `fspiop-signature` header, and one with a tampered header,
                forward envelopes identical to one carrying the captured header; the consumer
                delivers and advances an unsigned record with no rejection or error; readiness
                reports exactly two inputs; stale and malformed `JWS_*` variables are ignored at
                boot. Two F-10 tests from the deleted key-store block had no PII counterpart and
                were ported to the PII domain rather than lost.
**Verified**    `live — local stack (Redpanda, local PPA + Postgres + ValKey), before and after.`
                Baseline, pre-removal: the re-signed `01_MWK_to_ZMW_PRIMARY` corridor forwarded
                8/8 with 8 PPA successes and 11 egress + 1 party-lookup skipped; the same corridor
                as captured was **rejected 8/8** (`mla_rejected_total{reason="invalid-signature"}=8`,
                8 `signature` alerts).
                After removal, with the stale `JWS_*` variables still in `.env`: `/health/ready`
                returned `{"status":"UP","service":"cch-mla","kafka":"UP","piiSecret":"UP"}` with
                no JWS series in `/metrics`. The as-captured corridor forwarded **8/8, 8 PPA
                successes**, 11 + 1 structural skips, 0 rejections, 0 alerts, 0 tokenization
                failures, lag 0. The corridor with `fspiop-signature` stripped from all 14
                records that carried it gave the same result.
                **All 8 envelopes in PPA's `write_ahead` table after the removal are identical to
                those from the signed baseline**, apart from the per-run `correlationId` and
                `timestamp`.
                Boot checks: no `JWS_*` variables, and `JWS_PUBLIC_KEY_DIR` at a nonexistent path
                with `JWS_VALIDATION_DISABLED=garbage`, both reached ready with no errors.
                `npm run golden:ingestion:all` passed 7/7, and the 27 golden and fixture files are
                byte-identical (SHA-256) to before. `verify:tokenization` passed 4/4 over real mTLS.
                `scenario:all` passed 14/14 from a cold start (15/15 before; the difference is the
                deleted `missing-signature` scenario). The compiled `build/` contains no JWS code.
**Diverged**    From US-MLA-05 and US-PII-01's validate-before-tokenize requirement — both still in
                the source stories, which were not edited. §12 V7 now converges on the POC.
                From `e2e-testing/remove-JWS.md`: the harness's signing tools were removed rather
                than kept, by the user's decision; the fixtures were kept byte-identical as the
                plan said. That document's §11 lists every departure.
**Left open**   **Formal closure is blocked on two sign-offs that are not engineering's:** removing
                US-MLA-05 from scope (story author / CCH) and retiring N3 (the rules owner / CCH).
                Also pending: the residual-risk acceptance (CCH), the reduced US-MON-01 signal set
                (CCH monitoring owner; the JWS panels on any dashboard will read "no data"), and
                whether to answer Michael's question back (the user).
                **Deployment precondition:** `deploy/kubernetes/03-mla-deployment.yaml` still pins
                the pre-removal image (`a0437cd`), which refuses to boot without
                `JWS_PUBLIC_KEY_DIR`. Build and push a post-removal image and bump the digest
                before applying these manifests. Delete the `cch-mla-jws-keys` Secret on
                `10.0.150.69` only after the new image is confirmed there.
                Not exercised here: the deployed instance on `10.0.150.69` (local only, by the
                user's choice).

### MLA JWS removal — committed, sign-offs confirmed, post-removal image built and pushed   [2026-09-23]

**Built**       The previous entry's work is now committed to `cch-mla` as four commits on
                `paysys-remove-JWS` (not pushed to the branch's remote): source/tests, harness
                tooling, env template/K8s manifests, README. A new image was built from the
                branch tip (`1e7610e`) and pushed to `ghcr.io/psl-izyane-cch-frms/cch-mla` as
                `:1e7610e` and `:paysys-remove-JWS`. `03-mla-deployment.yaml`'s pinned digest is
                updated from the pre-removal `a0437cd`/`sha256:1e99…` to
                `sha256:0907…` (tag `1e7610e`); `deploy/kubernetes/README.md`'s image row updated
                to match.
**Tests**       No new automated tests — this entry is a commit/build/push/pin action, not new
                logic. The previous entry's 25 suites / 427 tests, 100% statements / 97.86%
                branches stand unchanged.
**Verified**    `live — the pushed image, standalone, against a real generated PII secret (no
                Kafka, no PPA).` `docker run` with `KAFKA_ENABLED=false`, a real
                `PII_SECRET_PATH`, and no `JWS_*` variables at all: `/health/ready` returned
                `{"status":"UP","service":"cch-mla","kafka":"DISABLED","piiSecret":"UP"}` — no
                `jwsKeyStore` field — and `/metrics` carried zero JWS/keystore series. The image's
                registry digest was confirmed directly against GHCR's `Docker-Content-Digest`
                response header, not read from a local cache, before being written into the
                manifest.
**Diverged**    Nothing new from the previous entry.
**Left open**   **Both sign-offs from the previous entry are now confirmed [2026-09-23], per the
                user: removing US-MLA-05 from scope and retiring N3 are both agreed by all
                parties.** Michael's question back is also considered answered: his point that
                nothing reaches MLA without the switch having already validated it was accepted
                as sufficient; no reply is being sent. This closes the two items that blocked
                formal closure per the previous entry's own bar (`plan.md` §7.2-style: only the
                monitoring-signal reduction and the residual-risk acceptance, both CCH's, remain).
                **Not yet done at the time of this entry:** the four commits were not yet pushed to
                the remote; the manifests referencing the new digest had not been applied to CCH's
                cluster (10.0.150.69 or any other); the `cch-mla-jws-keys` Secret had not been
                deleted anywhere. **Superseded by the next entry** on the push/merge point — the
                commits were pushed and merged to `main` before the next entry's session started.

### George Murage emailed — JWS removal only, ahead of the QA-bugfix combined ship   [2026-09-23]

**Built**       No code change. `cch-mla`'s JWS-removal commits (`21d7851`…`7b2a92e`) are confirmed
                merged to `main` and pushed to `origin/main` — the previous entry's "not yet done"
                push item is resolved. A new working branch, `paysys-remaining-bugs-f11-onwards`, is
                cut from this `main` for the F-11+ QA fixes; `paysys-QA-F11-onwards` is left as-is
                (stale, 5 commits behind `main`, superseded by the new branch).
**Sent**        The user emailed George Murage (CCH's technical lead) directly, without waiting for
                the F-11+ bugfix work to finish — a deliberate change from the plan recorded in the
                previous entry and in `e2e-testing/next-steps.md`'s original framing, which expected
                one combined email covering both the JWS removal and the QA bugfixes. Full text:
                `docs/meetings and emails/george-email-2026-09-23-jws-removal.md`. Content: the JWS
                removal, the trust-boundary rationale, that a new image (`ghcr.io/psl-izyane-cch-frms/cch-mla`,
                tag `1e7610e`, the same digest already pinned in `03-mla-deployment.yaml`) is pushed
                to GHCR and needs no action beyond CCH's already-pending `kubectl apply`, that the
                `cch-mla-jws-keys` Secret is no longer required, and that Kafka/PPA/PII config is
                unchanged. States the image was tested standalone before pushing (per the previous
                entries' live verification).
**Verified**    Not applicable — a sent email, not a code or infrastructure change.
**Diverged**    From the plan as understood at onboarding (`next-steps.md`, the earlier `plan.md`
                entries): the JWS-removal news is now sent to CCH on its own, ahead of the F-11+ QA
                fixes rather than combined with them. **The QA bugfixes will still ship as a second,
                later image** — built once F-11 onwards are done, pushed to both `10.0.150.69` and
                GHCR (re-pinning `03-mla-deployment.yaml`'s digest again), with its own follow-up
                communication to George at that point. This is a sequencing change only: the
                combined-image intent for the *bugfixes themselves* (one image for F-11 through F-22,
                not one per fix) is unchanged.
**Left open**   The manifest `kubectl apply` on CCH's cluster is still unconfirmed either way (last
                check-in [2026-09-17], §13.1). The `10.0.150.69` test-rig deployment has not been
                updated with the JWS-removal image — it was deliberately left on the pre-removal
                image, by the user's earlier choice (previous entries), and is now also the target
                the F-11+ combined image will ship to once ready. F-11 (park timers/shutdown exit
                code) is built, tested and live-verified this session — see the F-11 entry below;
                F-12 onwards are not yet started.

### F-11 — Detached park timers survive `shutdown()`; shutdown exits 0 on failure   [2026-09-23]

**Built**       On `paysys-remaining-bugs-f11-onwards` (cut from `main` post-JWS-removal). Before
                any change, a correctness baseline was established and recorded: 25/25 suites,
                427/427 tests, 100% statements, 97.86% branches, clean build, and a live corridor
                (local Redpanda + `cch-ppa` + Postgres + ValKey) delivering 8/8 canonical envelopes
                with 0 rejections — matching the state recorded in the entries above exactly.
                `park-registry.service.ts`: `ParkState` gained an optional `pendingTimer` field; two
                new methods, `registerTimer(partition, timer)` (called by a reprobe loop right after
                scheduling its next `setTimeout`, replacing any previous handle for that partition)
                and `cancelAll()` (clears every tracked timer via `clearTimeout` and empties the
                registry). `ingestion-consumer.service.ts`: all four `setTimeout` call sites across
                `parkAndReprobeTransient` and `parkAndReprobePpa` (the initial schedule and the
                re-arm in each `finally`, plus the commit-retry timer in `resolvePartition`'s
                advance-failure path) now call `parkRegistry.registerTimer` with the handle. `index.ts`:
                `shutdown()` calls `service.parkRegistry.cancelAll()` before `kafka.disconnect()` (a
                parked record's offset is uncommitted by design, so cancelling its reprobe loses
                nothing — the next instance redelivers it); the `try/catch` that previously swallowed
                every shutdown error now rethrows after logging, so `registerSignalHandlers`'s
                `.catch` branch fires and exits `EXIT_CODE_ERROR` instead of always reaching `.then`'s
                `EXIT_CODE_OK`. `bootstrap()`'s auto-run call is guarded behind
                `require.main === module` and `shutdown`/`Service` are exported, so a test can import
                the module and exercise `shutdown` directly without the import itself booting a real
                Kafka connection and HTTP listener as a side effect.
**Tests**       12 new: 6 in `park-registry.service.test.ts` (`registerTimer` on an unregistered
                partition is a no-op; `cancelAll` clears every pending timer, fake-timer-advanced
                1000ms with zero callbacks firing and `jest.getTimerCount()` at 0; `cancelAll` on an
                empty registry is a no-op; the single-slot overwrite behaviour of `registerTimer`
                documented explicitly). 6 new in a new `index.test.ts` (previously no test file
                existed for `index.ts` at all): shutdown's step ordering (watchdog stop → cancelAll →
                kafka.disconnect → server.close); a registered park's timer is confirmed not to fire
                after `shutdown` returns; cleanup runs with no kafka/watchdog configured; a
                `kafka.disconnect` failure is logged **and rethrown** rather than swallowed; the same
                for a `server.close` failure; park timers are still cancelled even when a later step
                throws. Full suite after: 26/26 suites (up from 25), 437/437 tests (up from 427),
                100% statements/functions/lines, 97.88% branches (up from 97.86%, still above the 96%
                gate), 0 lint errors (216 warnings, unchanged from baseline — all pre-existing magic-
                number warnings), Prettier clean.
**Verified**    `live — local stack (Redpanda, local PPA + Postgres + ValKey)`, before and after, plus
                a dedicated shutdown probe. Before: baseline corridor as above. After the fix: rebuilt
                clean (`tsc`, 0 errors); booted MLA, `/health/ready` unchanged
                (`{"status":"UP","kafka":"UP","piiSecret":"UP"}`); stopped `cch-ppa` to force a
                transient failure, fed the corridor, confirmed the park via
                `mla_partition_paused{partition="2"}=1` and a climbing `mla_park_age_seconds`;
                `SIGTERM`'d mid-park — the process logged "Received SIGTERM, shutting down", exited
                within ~3.5s (Kafka's own graceful in-flight wait), exit code confirmed `0` via a
                shell wrapper capturing `$?` directly (not `wait`, which returned a false `127` on a
                detached background job), and produced zero "Unhandled failure reprobing" log lines in
                the shutdown window. A plain clean shutdown with no park active was separately
                confirmed at exit code `0`. The rethrow-on-failure branch could not be forced live —
                kafkajs's real `disconnect()` resolves even against a broker stopped moments earlier
                (verified by stopping `cch-mla-redpanda` before `SIGTERM`: still exited `0`, correctly,
                since `disconnect` did not actually throw) — that branch is proven by the mocked unit
                tests instead, which is the more deterministic proof for it regardless. Restored PPA
                and Redpanda afterward; confirmed no stray MLA processes remained.
**Diverged**    From `qa-review-remediation.md`'s F-11 proposal: its plan assumed an `AbortSignal`
                threaded through `IngestionHandlerDeps` as the primary mechanism, with "the F-10
                registry gives shutdown the list to cancel if a signal is not preferred" as a
                fallback. Since F-10's `ParkRegistry` already existed and already owns every park's
                lifecycle, the registry-owns-the-timers fallback was built directly rather than adding
                a parallel `AbortSignal` plumbing path — smaller surface, same guarantee. The
                remediation's suggestion to fold F-05/F-08/F-10/F-11 into one combined refactor was not
                followed, per the user's explicit one-finding-per-prompt cadence for this workstream;
                F-10 was already done (merged via `epic-QA`) and F-11 is scoped to exactly what its own
                finding describes.
**Left open**   Nothing specific to F-11. `qa-review-findings.md`'s F-12 is next.

### F-12 — `KafkaClient.isConnected()` never becomes `false` on a broker disconnect   [2026-09-23]

**Built**       On `paysys-remaining-bugs-f11-onwards`. Correctness baseline re-confirmed before
                starting: 26/26 suites, 437/437 tests, 100% statements, 97.88% branches, clean
                build, `git status` clean (F-11's changes were already committed as `c7b319d` by the
                user between prompts). `kafka.client.ts`'s
                constructor now subscribes to kafkajs's own `consumer.events.CONNECT`/`DISCONNECT`/
                `CRASH` (event names and payload shapes confirmed directly against
                `node_modules/kafkajs/types/index.d.ts` lines 907-910, 960-964, matching
                `qa-review-remediation.md`'s own citation exactly): `CONNECT` sets `connected = true`,
                `DISCONNECT` sets it `false`, `CRASH` sets it `false` and logs the real
                `payload.error` via a new `KafkaClient.crash` log line. `connect()`/`disconnect()` no
                longer set the flag themselves - it now reflects kafkajs's own reported state, not
                just this class's own method-call boundaries. `GROUP_JOIN`-triggered stale-park
                clearing (the remediation doc's adjacent suggestion) was deliberately **not** built -
                out of scope for this finding, per the user's one-issue-per-prompt cadence; flagged
                as a possible separate follow-up if wanted.
**Tests**       6 new/changed in `kafka.client.test.ts`. The mock consumer gained a real, minimal
                event-emitter shape (`events` + `on`, backed by a module-level listener map cleared
                in `beforeEach`) rather than the previous plain jest.fn() stand-in, since
                `kafka.client.ts` now genuinely registers and later invokes these listeners. Two
                existing tests ("reports connected once...", "reports disconnected after
                disconnecting") were rewritten to emit the real `CONNECT`/`DISCONNECT` events rather
                than asserting on `connect()`/`disconnect()` alone - the old assertions no longer
                held once the flag stopped being set at those call sites. Four new: `isConnected()`
                stays `false` immediately after `connect()` resolves, only flipping once `CONNECT` is
                actually emitted; a broker-initiated `DISCONNECT` mid-session flips `isConnected()`
                to `false` with neither `connect()` nor `disconnect()` called again; `CRASH` flips it
                `false` and logs `payload.error` distinctly from a clean disconnect; listeners are
                registered exactly once, at construction, not once per `connect()` call. Full suite:
                26/26 suites, 440/440 tests (up from 437), 100% statements/functions/lines, 97.89%
                branches (up from 97.88%, above the 96% gate), 0 lint errors (216 warnings,
                unchanged), Prettier clean, `kafka.client.ts` itself 100% covered.
**Verified**    `live — local stack (Redpanda, local PPA + Postgres + ValKey)`. Booted MLA;
                `/health/ready` showed `kafka: "UP"` as before. Fed the corridor to confirm no
                regression: 8/8 delivered (cumulative counters incremented cleanly). **Then
                `docker stop cch-mla-redpanda` while MLA stayed running and connected** - the real
                bug this closes: `/health/ready` flipped to `{"status":"DOWN","kafka":"DOWN",...}`
                within the same poll interval and **stayed `DOWN` across six consecutive 5-second
                checks** for the full outage, with the log showing repeated genuine `"Kafka consumer
                crashed"` lines from the new `CRASH` handler as kafkajs's own reconnect attempts
                failed. Pre-fix, this same outage would have left `/health/ready` reporting
                `kafka: "UP"` throughout, per the finding's own claim - confirmed by inspection of the
                old code (no listener existed to flip it). **Restored the broker** -
                `/health/ready` returned to `UP` within seconds with no MLA restart, on kafkajs's own
                auto-reconnect firing `CONNECT`. Fed the corridor again post-recovery: 8 more
                delivered cleanly (cumulative counters incremented correctly, no loss, no
                duplication). `SIGTERM`'d afterward - exited cleanly, exit code 0, confirming F-11's
                shutdown fix and F-12's connection tracking do not interact badly with each other.
                Confirmed no stray MLA processes and the stack healthy afterward.
**Diverged**    Nothing from the remediation doc's core proposal. The doc's adjacent
                `GROUP_JOIN`-clears-stale-parks suggestion was read and understood but not built (see
                **Built**, above) - a deliberate scope decision for this prompt, not an oversight.
**Left open**   Nothing specific to F-12. Whether `GROUP_JOIN`-triggered stale-park clearing is worth
                building as its own follow-up is an open question for the user, not decided here.
                `qa-review-findings.md`'s F-13 is next.

### F-13 — `PPA_BASE_URL`'s path component is silently dropped   [2026-09-24]

**Built**       On `paysys-remaining-bugs-f11-onwards`. Correctness baseline re-confirmed before
                starting: 26/26 suites, 440/440 tests, 100% statements, 97.89% branches, clean
                build, `git status` clean (F-12 already committed as `8d13be8` by the user). A new
                module-level `pathPrefix(url: URL): string` in `ppa.client.ts` rejects a URL whose
                `search`/`hash` is non-empty (fatal at construction, matching the existing
                boot-time-refusal pattern for other invalid config) and returns `''` for a bare
                root path (`/`) or the path otherwise, trailing slashes stripped. `HttpsPpaClient`'s
                constructor calls it for both `baseUrl` and `healthBaseUrl` (independently - a
                proxy in front of PPA's business endpoints need not share the same prefix as one
                in front of its health endpoint) and stores `basePath`/`healthBasePath`. `deliver()`
                now builds its request path as `this.basePath + resolvePpaEndpoint(eventType)`
                instead of the routed path alone; `probeReady()` builds
                `` `${this.healthBasePath}/health/ready` `` the same way. Port handling
                (`url.port`) was left as-is - not part of this finding's own claim, and already
                behaves correctly for every case the existing test suite and this session's live
                checks cover.
**Tests**       8 new in `ppa.client.test.ts`, all inside a new `describe('a path prefix on
                PPA_BASE_URL', ...)` block: a prefix is prepended to the routed endpoint path; a
                trailing slash on the prefix is stripped rather than producing a doubled slash; no
                prefix at all (the existing, default shape) still produces the bare routed path,
                unchanged; the health-probe path gets its own independently-configured prefix; a
                `baseUrl` or `healthBaseUrl` carrying `?a=b` or `#fragment` throws at construction,
                before any request is attempted (table-driven, both suffixes, both URLs - 4 cases).
                All 31 pre-existing tests in the file passed unmodified against the new code -
                confirms the no-prefix, no-query-string default shape used everywhere else in the
                suite was never touched by this change. Full suite: 26/26 suites, 448/448 tests (up
                from 440), 100% statements/functions/lines, 97.92% branches (up from 97.89%, above
                the 96% gate), 0 lint errors (216 warnings, unchanged), Prettier clean,
                `ppa.client.ts` itself 100% statements/lines, 95.45% branches (the two uncovered
                branches are pre-existing `finally`-block paths unrelated to this change).
**Verified**    `live — local stack (Redpanda, local PPA + Postgres + ValKey; the stack had exited
                between sessions and was restarted clean first)`. **Regression check with the
                default, unprefixed `PPA_BASE_URL` (the real production shape today)**: booted MLA,
                fed the standard 20-record corridor, 8/8 canonical envelopes forwarded with 8/8 PPA
                success and 0 rejections - identical to every prior session's baseline. Confirmed via
                PPA's own log that requests reached `processEnvelope` (proving the request landed on
                the correct path server-side, not merely that MLA believed it succeeded). Clean
                `SIGTERM` shutdown, exit code 0. **Positive proof of the fix**: wrote a small
                Node.js HTTP proxy (`/tmp/.../scratchpad/prefix-proxy.js`, not part of the
                repository) listening on `:3500`, stripping a `/mla/v1` prefix and forwarding to
                the real PPA on `:3000` - confirmed directly that an unprefixed request against the
                proxy 404s and a prefixed one reaches PPA's real `/health/ready`. Booted MLA with
                `PPA_BASE_URL=http://localhost:3500/mla/v1` and the matching `PPA_HEALTH_BASE_URL`
                - booted clean, fed the same 20-record corridor through the proxy, **8/8 forwarded,
                8/8 PPA success, 0 rejections** - real HTTP traffic through a real path-prefixed
                listener, not a mock. Directly confirmed the counterfactual: the same proxy's
                unprefixed `/QUOTES` route independently returns 404, which is exactly what every
                one of those 8 deliveries would have hit before this fix. Clean shutdown afterward,
                exit code 0. **The fatal-refusal path**: ran the compiled entrypoint directly (not
                through the test suite) with `PPA_BASE_URL` carrying `?debug=true` - logged
                `"Invalid configuration - refusing to start"` naming the exact offending URL, real
                process exit code confirmed `1`. Proxy and MLA processes stopped afterward; stack
                confirmed healthy and no stray MLA processes remained.
**Diverged**    Nothing from the remediation doc's own proposed fix, beyond the port-explicitness
                item noted above (left out, not in scope for this finding's own claim).
**Left open**   Nothing specific to F-13. `qa-review-findings.md`'s F-14 is next.

### F-14 — Explicit TLS policy and connection reuse (scope: agent reuse + explicit TLS policy only)   [2026-09-24]

**Built**       On `paysys-remaining-bugs-f11-onwards`. Correctness baseline re-confirmed before
                starting: 26/26 suites, 448/448 tests, 100% statements, 97.92% branches, clean
                build, `git status` clean (F-13 already committed as `56e3f66` by the user). **Scope
                decision, made with the user before starting:** the remediation doc's own three-part
                proposal (connection reuse, hot-reload-without-restart, an expiry metric) was
                narrowed to the first part alone. Certificate hot-reload was left out because
                US-SEC-01 explicitly leaves the rotation *mechanism* (hot-reload vs. rolling restart)
                as CCH's decision, not yet confirmed - building it now would solve a problem nobody
                has confirmed needs solving that way. The expiry metric was treated as a separate,
                smaller nice-to-have, also left out. `HttpsPpaClient` now builds its connection
                agents once, at construction: one `https.Agent` (mTLS enabled) or `http.Agent` (mtls
                disabled) for delivery, reused by every `deliver()` call instead of a fresh TLS
                handshake per request; a second, independent agent for the health probe, since it
                never presents a client certificate even when delivery does. Both agents carry
                `keepAlive: true` and a new, bounded `maxSockets` (`PPA_MAX_SOCKETS`, default 32,
                bounds 1-256, wired through `config.interface.ts`/`config.service.ts` the same way
                every other PPA numeric setting is). The mTLS agent also carries `minVersion:
                'TLSv1.2'` and `rejectUnauthorized: true` explicitly, rather than left to Node's own
                defaults. `deliver()`/`probeReady()` now pass `agent: this.agent` /
                `agent: this.healthAgent` instead of spreading TLS material onto each call's own
                request options. **A related correctness fix, not itself the finding's headline
                claim but necessary once sockets are reused**: `classifyTransportError`'s TCP-
                connected detection previously relied solely on the `'connect'` event, which a
                keep-alive socket handed back from the pool never fires again (it already
                connected on a prior request) - a mid-request failure on a reused socket would have
                been misclassified as `network-error` (never connected) instead of
                `tls-handshake-failure`. Fixed by checking `socket.connecting` at the moment the
                `'socket'` event fires: already `false` means already connected, so `tcpConnected` is
                set immediately rather than waiting on an event that will not come again.
                `.env.template` and `deploy/kubernetes/01-configmap.yaml` both gained
                `PPA_MAX_SOCKETS=32` alongside the existing PPA settings.
**Tests**       11 new: 5 in `ppa.client.test.ts` (a new `describe('connection reuse and TLS
                policy', ...)` block) - the agent is constructed once with `keepAlive`, the
                configured ceiling, `minVersion: 'TLSv1.2'`, `rejectUnauthorized: true`; the same
                agent instance is reused across two sequential `deliver()` calls, not rebuilt per
                call; no key/cert/ca appear on the per-call request options any more, only on the
                agent; a reused (`connecting: false`) socket that fails mid-request classifies as
                `tls-handshake-failure`, not `network-error`; `mtlsDisabled` builds a plain
                `http.Agent` with no TLS policy, shared by both delivery and the health probe. The
                existing `FakeSocket` test double gained a `connecting` field, defaulting to `true`
                like a real freshly-dialled socket and flipped to `false` at the same point Node's
                own socket does (right when `'connect'` fires) - this also corrected a latent gap in
                every *existing* socket-lifecycle test, which had never actually exercised the
                "still connecting" branch of the new check (a socket double with `connecting`
                `undefined` is falsy either way) until this update gave the double a real value to
                flip. One pre-existing test (asserting `options.ca` directly on the per-call request
                options) was updated to assert on the agent's own construction options instead - the
                behaviour it checks (server verification, no client cert, on the health probe) is
                unchanged, only where that data now lives. 5 new in `config.service.test.ts`:
                `PPA_MAX_SOCKETS` bound rejection (0, 257, a non-integer), its default (32) appearing
                in the full-object equality check, and an explicit-value assertion in the
                "every supplied value" test. All 39 pre-existing tests across both files passed
                unmodified beyond the one call-site update above. Full suite: 26/26 suites, 456/456
                tests (up from 448), 100% statements/functions/lines, 97.93% branches (up from
                97.92%, above the 96% gate), 0 lint errors (216 warnings, unchanged), Prettier clean,
                `ppa.client.ts` 100% statements/lines, `config.service.ts` 100% statements/lines.
**Verified**    `live — local stack (Redpanda, local PPA + Postgres + ValKey)`. **Regression with the
                real, unmodified `.env`** (mTLS disabled locally, `PPA_MAX_SOCKETS` unset - the
                default-config path): booted clean, fed the standard corridor twice in a row (16
                total deliveries across the two runs) - 8, then 16 cumulative, forwarded/success,
                0 rejections. **Direct proof of connection reuse**: `ss -tnp` against PPA's port
                showed exactly **3 established connections** after the first corridor and still
                exactly 3 after the second, sixteen deliveries total sharing the same small pool
                rather than opening (and leaving open) one socket per request. **The health-probe
                path, separately**: stopped PPA to force a park and a breaker trip, restored it, and
                confirmed the full backlog recovered and drained (`mla_partition_paused` back to 0,
                every parked and subsequent record forwarded) - proving `probeReady()`'s own,
                independently-constructed agent still worked correctly through a real recovery cycle.
                Clean `SIGTERM` shutdown afterward, exit code 0. **The fatal-refusal path**: ran the
                compiled entrypoint directly with `PPA_MAX_SOCKETS=0` - logged the exact bound
                message, real process exit code confirmed `1`. Real mTLS handshakes (the `https.Agent`
                branch with `minVersion`/`rejectUnauthorized`) were not separately exercised live -
                this deployment target runs `PPA_MTLS_DISABLED=true` locally by design, same as every
                prior session in this workstream, since the local PPA does not terminate mTLS; that
                branch's correctness rests on the 5 dedicated unit tests instead, which assert the
                exact agent-construction options directly. No stray MLA processes remained afterward;
                stack confirmed healthy.
**Diverged**    Scoped to agent reuse and explicit TLS policy only, per the decision recorded under
                **Built** above - certificate hot-reload and the expiry metric are both left for
                later, gated on US-SEC-01's outstanding rotation-mechanism decision (the former) or
                simply out of scope for this pass (the latter).
**Left open**   Certificate hot-reload without restart - genuinely blocked on CCH confirming the
                rotation mechanism (US-SEC-01), not on anything this session could resolve. The
                expiry metric (`mla_client_cert_expiry_seconds`) is a small, independent follow-up,
                not picked up here. `qa-review-findings.md`'s F-15 is next.

### F-15 — A PPA 4xx logs the full envelope, including cleartext PII on transfer bodies   [2026-09-24]

**Built**       On `paysys-remaining-bugs-f11-onwards`. Correctness baseline re-confirmed before
                starting: 26/26 suites, 456/456 tests, 100% statements, 97.93% branches, clean
                build, `git status` clean (F-14 already committed as `1230af0` by the user).
                **The decision the finding itself flags as not engineering's** - US-MLA-07's own AC
                text ("log the full envelope as an error") conflicting with N7 ("no raw PII in any
                log") - was put to the user directly. **User's ruling: the AC wording stays
                unchanged; fix the logging behaviour.** The remediation doc's own proposal included
                a `LOG_REJECTED_ENVELOPE_MODE=masked|full` config toggle so CCH could later flip
                back to full logging; also put to the user and **declined** - masked logging is now
                the fixed, non-configurable behaviour, no new config surface added. A new
                `maskEnvelopeForLog(envelope): EventEnvelope` in `ingestion-outcome-logging.service.ts`
                returns a shallow copy of the envelope with: `body.ilpPacket` replaced with
                `'<redacted ilpPacket>'` (the ILP packet is exempt from tokenization by design -
                cryptographically bound into the transfer - so it reaches this function in
                cleartext and is masked here instead); `payer`/`payee`'s `personalInfo` replaced
                with `'<redacted personalInfo>'` whole (covers the legal name and, per
                `core-knowledge.md` §4.1's own table, the date of birth - neither of which the
                tokenization table covers even on an already-"tokenized" QUOTE); `partyIdInfo.
                partyIdentifier` replaced with `'<redacted partyIdentifier>'` **unless** it already
                carries the `tkn_` prefix (an already-tokenized value is safe to log verbatim, and
                distinguishing the two means a TRANSFER/FXTRANSFER body - never tokenized at all -
                and a QUOTE/FXQUOTE body - tokenized before this ever runs - both come out correctly
                masked without the function needing to know which event type it was given). Every
                other body field - amounts, currencies, fees, ids, headers, `error` - passes through
                untouched, since that is what an operator needs to diagnose a 4xx.
                `logPpaPermanentRejection` now logs `maskEnvelopeForLog(envelope)` instead of the raw
                envelope; the original object is never mutated, so `deliver()`'s own already-sent
                real body is unaffected - this only touches what reaches the log line.
**Tests**       20 new: a new, dedicated `ingestion-outcome-logging.service.test.ts` (the module had
                no test file of its own before this - previously exercised only indirectly via the
                consumer tests), 11 tests covering `maskEnvelopeForLog` directly (a raw identifier
                redacted, an already-tokenized one left alone; `personalInfo` redacted whole,
                including a name and DOB that must not survive into the masked JSON; the ILP packet
                redacted; every non-PII field untouched; the original envelope proven unmutated; a
                body with no payer/payee/ilpPacket at all passes through as a no-op; a
                payer/payee/partyIdInfo present but not an object - a malformed record - passes
                through rather than throwing) and 2 covering `logPpaPermanentRejection`'s own
                integration of it (the logged line excludes the raw identifier and includes the
                masked marker; the rejection metric and alert are unaffected, the alert still
                carrying no part of the body). 1 existing test in `ingestion-consumer.service.test.ts`
                (the real end-to-end 4xx path, through the genuine pipeline) strengthened rather
                than just kept passing: it now captures the real envelope actually handed to
                `ppaClient.deliver`, and asserts that if that envelope carries `personalInfo` or an
                un-tokenized `partyIdentifier`, the corresponding masked marker appears in the log
                line and the raw value does not. Full suite: 27/27 suites (up from 26, the new test
                file), 467/467 tests (up from 456), 100% statements/functions/lines, 98.02% branches
                (up from 97.93%, above the 96% gate), 0 lint errors (216 warnings, unchanged),
                Prettier clean, `ingestion-outcome-logging.service.ts` itself 100% across every
                metric including branches.
**Verified**    `live — local stack (Redpanda, local PPA + Postgres + ValKey)` for the regression,
                plus a direct run of the real compiled build artifact for the fix itself. **Regression**:
                booted MLA against the real, unmodified `.env`, fed the standard corridor - 8/8
                forwarded, 8/8 PPA success, 0 rejections, identical to every prior baseline in this
                workstream. Clean `SIGTERM` shutdown, exit code 0. **The fix, against the compiled
                `build/services/ingestion-outcome-logging.service.js`, not just the TS source**: ran
                `maskEnvelopeForLog` directly against a realistically-shaped QUOTE envelope carrying
                a real-looking MSISDN, legal name, and date of birth - the masked output contained
                none of the three cleartext values, while the (non-PII) amount field remained
                visible, and the original object handed in was confirmed unmutated afterward. Ran
                `logPpaPermanentRejection` directly against a realistically-shaped TRANSFER envelope
                carrying a real-looking ILP packet string and a real transfer id - the exact log
                line that would be written for a genuine 4xx was printed and inspected: the ILP
                packet value did not appear anywhere in it, while the transfer id (needed for
                diagnosis) did. **Not separately reproduced against a genuine live PPA 400 response**:
                forcing a real permanent rejection through the whole real pipeline against the real
                local PPA was judged lower-value than directly exercising the compiled masking logic
                against realistic data, since the masking function itself is pure and its correctness
                does not depend on how the 4xx was actually produced - the strengthened integration
                test in `ingestion-consumer.service.test.ts` already proves the wiring through the
                real envelope-building/tokenization pipeline, with only the final HTTP outcome
                mocked. No stray MLA processes remained afterward; stack confirmed healthy.
**Diverged**    From the remediation doc's own proposal: no `LOG_REJECTED_ENVELOPE_MODE` config
                toggle was built - the user declined it and made masked logging the fixed behaviour
                instead of a reversible default. Everything else in the interim it proposed (the
                exact set of masked fields, the token-prefix check, leaving everything else
                verbatim) was built as specified. The doc's own suggestion to also log
                `sha256(JSON.stringify(envelope))` alongside the masked line, so an operator could
                match it byte-for-byte to PPA's stored write-ahead record, was **not** built - not
                requested, and PPA's own write-ahead record is keyed and retrievable by
                `correlationId`/`id` already logged, which was judged sufficient.
**Left open**   Nothing specific to F-15. The AC-vs-N7 conflict itself is now resolved by the user's
                ruling (AC wording unchanged, behaviour fixed) - not left open. `qa-review-findings.md`'s
                F-16 is next.

### F-16 — Alert webhook fan-out unbounded - fixed and live-verified   [2026-09-24]

**Discussed**   Before starting the build, the user asked whether dropping a new alert once the
                in-flight cap is reached is actually the right trade-off versus queuing it.
                **Decision: drop, not queue.** Reasoning discussed and agreed: `ALERT_WEBHOOK_URL` is
                a secondary, best-effort notification path, never the system of record for whether an
                alert fired - the metrics-based sink (`mla_alerts_total{type,severity}`, always
                incremented unconditionally) is what a real alerting rule (Alertmanager, PagerDuty,
                whatever CCH eventually wires up per R-37) actually watches. So the real choice is
                "drop a webhook POST" vs. "queue a webhook POST," not "lose the alert" vs. "keep it" -
                the alert itself is never lost. Queuing was rejected: unbounded memory growth during
                exactly the moment things are already going wrong (a burst of failures); queued alerts
                arrive late and out of order relative to when they happened; and queuing couples the
                pipeline's own health to the webhook destination's health, the exact coupling this
                codebase's breakers and health-probe split (F-05) have deliberately avoided everywhere
                else. Dropping keeps that coupling severed. **A second decision, also put to the user
                directly**: whether the cap applies uniformly to every alert type, or whether
                per-attempt alerts that fire repeatedly during an outage (tokenization-failure) should
                be coalesced separately from one-off per-record alerts (breaker-trip, rejection) that
                each lose a distinct fact if dropped. **Chosen: coalesce per-attempt alerts
                separately** - the remediation doc's own proposed shape.
**Built**       `WebhookAlertClient` (`alert.client.ts`) gained an in-flight cap
                (`ALERT_WEBHOOK_MAX_IN_FLIGHT`, new config, default 8): beyond it, a new alert is
                dropped, not queued - `mla_alerts_dropped_total{type}` (new counter) increments and a
                `warn` logs at most once per type per minute (not once per drop, so a burst that fills
                the cap doesn't also flood the log it's reporting to). `mla_alerts_total` is
                unaffected either way. Separately, only `tokenization-failure` (the sole alert type
                that fires once per attempt, including every retry) is coalesced within a window
                (`ALERT_WEBHOOK_COALESCE_MS`, new config, default 10s): the first occurrence sends
                immediately, every further occurrence within the window increments a count instead of
                calling `fetch`, and one summary POST (`"... x N in the last Ns"`) fires at window end
                only if anything was actually folded. The other four alert types are one-off,
                per-record facts and are never coalesced - each still sends immediately, subject only
                to the shared in-flight cap.
**Tests**       16 new (483/483 total, up from 467): the in-flight cap dropping once full and freeing
                a slot once a request resolves, the drop log's once-per-type-per-minute rate limit,
                the cap being shared across alert types (one type's burst can cause another type to
                drop), the coalesce window sending the first occurrence immediately, folding
                subsequent occurrences into one summary at window end, opening a fresh window once the
                prior one flushes, not sending a summary when nothing arrived during the window, and
                confirming non-coalesced types still send immediately even during another type's
                window. `alert.client.ts` and `config.service.ts` both 100% including branches; full
                suite 100% statements/functions/lines, 98.08% branches (above the 96% gate), 0 lint
                errors, Prettier clean.
**Verified**    `live - local stack (Redpanda, local PPA + Postgres + ValKey)`, against real
                backpressure, not just mocked timers. **Regression**: standard 8-record corridor fed
                with the new alert client wired in and a fast local webhook sink listening - 8/8
                forwarded and accepted exactly as every prior baseline, `mla_alerts_dropped_total`
                absent entirely (zero drops) under normal load with the default cap of 8. **The fix
                itself**: forced a real `pii-secret-unavailable` condition (moved the PII secret file
                away, restarted MLA so the outage was the process's actual boot-time state, not a
                mock), pointed `ALERT_WEBHOOK_URL` at a real local HTTP sink deliberately delayed 8s
                per response, set the in-flight cap to 2 and the coalesce window to 5s, then fed a
                corridor. The sink's own captured requests showed exactly the designed shape: the
                first `tokenization-failure` POST sent immediately, the next three folded into one
                `"... x3 in the last 5s"` summary, and real drops recorded
                (`mla_alerts_dropped_total`) on both `tokenization-failure` and a `retry-exhaustion`
                alert once the slow sink saturated the cap - with the exact rate-limited drop-warning
                line appearing in the real process log. Clean `SIGTERM` shutdown confirmed on every
                boot in this session; PII secret and `.env` restored to their pre-session state
                afterward.
**Left open**   Nothing specific to F-16. `qa-review-findings.md`'s F-17 is next - investigated this
                session and deliberately deferred rather than built; see the entry immediately below.

### F-17 — investigated, deliberately deferred (not built)   [2026-09-24]

**The finding, precisely.** `ingestion-consumer.service.ts` has two distinct places that call
`kafka.advance()` after a successful PPA delivery, and only one of them already handles a commit
failure correctly:

- **The parked/reprobe recovery path** (`resolvePartition`, ~line 561) **already wraps `advance()` in
  its own try/catch** and, on failure, schedules a commit-only retry timer directly - it does not
  call `deliver()` again. This half of the finding is already correct, apparently as a side effect of
  earlier work in this workstream, not something this session built.
- **The first-attempt path** (`resolveOutcome`, ~line 201) does not. When a fresh record (not a
  recovering park) gets PPA's HTTP 200 on the very first try, the code falls through to a bare
  `await kafka.advance(...)` with no try/catch. If that throws, the exception is not caught here or
  anywhere between this call and the top-level `catch` in the `eachMessage` handler (~line 132), which
  only logs "Unhandled failure processing partition..." and swallows it - no retry of the commit
  happens at all. Because `eachMessage` then returns normally, kafkajs advances to the next message on
  that partition, and cumulative offset commits happen to cover the failed one *if* another message
  arrives soon on the same partition - correct by accident, not by design. If nothing else arrives, the
  offset stays uncommitted until the next consumer restart or rebalance, at which point that partition
  resumes from the last committed offset, re-reads the same record, and re-delivers it to PPA a second
  time - the actual duplicate-POST scenario, triggered by a restart/rebalance racing a commit failure,
  not by anything routine.
**The fix, not yet built.** Give the first-attempt path the same shape `resolvePartition` already
has: wrap the line-201 `advance()` in try/catch, and on failure retry only the commit on a timer -
never call `deliver()` again, since the record is already durably accepted by PPA and there is
nothing left to retry there. Open design question if/when this is picked up: bounded retry (e.g. a
`PPA_COMMIT_RETRY_MAX`, then alert/park) versus retrying indefinitely, since giving up on committing
an already-delivered record is arguably never correct.
**Decision: park, do not build now** [2026-09-24, user]. Explicit reasoning: PPA's own
`{id}:{isoMessageType}` idempotency check already absorbs a duplicate POST of an envelope it has
already durably accepted - so today's gap produces a harmless duplicate delivery in a narrow,
uncommon window (a commit failure that also loses the race against the next message's own commit,
compounded by a restart/rebalance before that happens), not data loss or a wrong outcome. This is a
hygiene/efficiency fix (an avoidable duplicate PPA call, and an offset the broker leaves briefly
uncommitted), not a correctness gap PPA doesn't already cover. Documented here in full so the reasoning
and the exact fix are on record; not scheduled, not abandoned.
**Left open**   No code written. Whichever finding the user picks up next in this workstream should
                get its own preview per `CLAUDE.md`'s "How a QA finding gets built".

### F-23 — investigated, previewed, then parked pending an upstream PPA change   [2026-09-24]

**The finding, precisely.** `qa-sweep-2-findings.md`'s only Critical: MLA's PPA health probe
(`ppa.client.ts:76-79`, `healthAgent`) presents no client certificate, but the real `cch-ppa`
(`cch-ppa/src/clients/fastify.ts:100-109`, confirmed by reading that source) serves
`/health/live` and `/health/ready` on the same TLS listener as its business routes, with
`requestCert: true, rejectUnauthorized: true`. Once a PPA circuit breaker trips, every reprobe
health check fails the TLS handshake, so the breaker can never untrip and that partition never
resumes delivery - even after PPA has fully recovered. Masked today because every environment
tested so far runs `PPA_MTLS_DISABLED=true`. Full detail, verified-live reproduction and fix
direction (present the same client cert the delivery agent already loads) are in
`qa-sweep-2-findings.md`'s F-23 section; not repeated here.
**Decision: park, do not build now** [2026-09-24, user]. The finding was previewed in chat per
`CLAUDE.md`'s "How a QA finding gets built" cadence, and go-ahead had not yet been given when the
PPA-side engineer stated he is removing mTLS from PPA's health endpoint specifically. If that
lands, the mismatch this finding describes (MLA assuming an unauthenticated health path, the real
PPA requiring a cert on every path including health) reverts to matching the original
`core-knowledge.md` §6.2 assumption, and MLA's current code may need no fix at all - or a narrower
one, depending on exactly how the PPA change is shaped (a separate plain listener vs. the same
listener with `requestCert: false` for health routes only). Building MLA's side first, against the
assumption the PPA change hasn't landed, risks a change that has to be re-done or reverted once the
real PPA commit is visible. No test or code was written for F-23 in this session.
**Left open**   Waiting on the user to point this workstream at the actual `cch-ppa` commit once
                pushed. At that point: read the real listener/route config directly (not the
                stated intention), and decide whether F-23 is moot, needs a narrower fix (e.g.
                wiring `PPA_HEALTH_BASE_URL` correctly for a split listener), or whether presenting
                the client cert unconditionally is still the safer default regardless - the
                Decisions table in `qa-sweep-2-findings.md` already notes an mTLS-terminating
                ingress gateway (`deployment/certificate-setup-proposal.md`) could require a cert
                on every path even if PPA's own health route stops requiring one. Also worth
                checking whether the PPA change reopens F-35 (URL scheme never cross-checked
                against `PPA_MTLS_DISABLED`) in a new shape, if health and delivery end up on
                different schemes. F-24 was proposed as the next finding to pick up in the
                meantime, being High severity and fully self-contained with no external dependency;
                not yet started.

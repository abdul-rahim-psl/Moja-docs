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

**Phases 0 through 6 are built and live-verified; Phase 7 is development-complete and live-verified but not formally closed (its "in CI" clause is blocked on a runner constraint — see its row below and §10); Phase 4's mechanism is built and live-verified too, though that phase is likewise not formally closed.** A TypeScript + Fastify skeleton exists at [`cch-mla`](/home/abdul-rahim/mojaloop/cch-mla) — the four-layer structure, typed and validated configuration, `/health/live` + `/health/ready`, structured logging, a real ingestion pipeline, real envelope construction, real JWS verification, real PII tokenization, **real delivery to PPA with the full offset/retry/breaker/reprobe mechanism live**: every forwarded record either reaches PPA and advances the offset on HTTP 200, is logged in full and advanced immediately on a permanent 4xx, or is retried with genuine jitter and — on exhaustion — parked behind a per-partition circuit breaker that re-probes and resumes entirely on its own, no restart required, and now **full observability and operability**: structured logs carrying `correlationId`/`eventType`/pipeline step on every line, ten Prometheus-compatible metrics answering every operator question `core-knowledge.md` §9 and `engineering-rules.md` §9 name, and alert paths wired at all five named conditions (missing/invalid signature, a PPA 4xx, retry exhaustion, a breaker trip, a PII tokenization failure), each raising both a metrics-based signal (always active) and an optional configurable webhook. Every record either becomes a schema-valid, tokenized `EventEnvelope` that a live `ppa-stub` accepts over mTLS, or is rejected/skipped for a named, correctly-classified reason — including a genuinely re-signed record verifying and forwarding with prefixed tokens in every listed field, a tampered one failing, a stripped signature failing distinctly, a key-source outage failing distinctly from an invalid signature, and a missing PII secret failing distinctly again, all proven against a real broker and a real `ppa-stub`, not a mock. 354 tests at 100%/98.06%/100%/100% coverage against a mechanically-enforced 96% gate, and a GitLab CI pipeline. Full detail: §16's Phase 0–6 entries, `EPICS/EPIC-0-Scaffolding/`, `EPICS/PHASE-1-Harness/`, `EPICS/EPIC-1-kafka-subscription-audit-topic-ingestion/`, `EPICS/EPIC-2-envelope-construction-jws-validation/`, `EPICS/EPIC-PII-tokenization/`, `EPICS/EPIC-3-delivery-to-ppa-offset-management/` and `EPICS/PHASE-6-Observability-Operability/`. **Gate item #1 (`continue/continue - before phase 5.md` §2) is done** — a PII secret failure is now transient (retry, park, breaker), live-verified against the real harness §16's own US-PII-01 entry. **Phase 4 stays open on gate item #2 (§7.1 #2, §13.1) — secret rotation — not on any remaining engineering for item #1; unaffected by Phase 5 or 6 closing.** **Phase 5 (delivery, offsets, resilience, §8) is done** — its exit criterion (§8) is fully met live, §16's US-MLA-06/US-MLA-07 entries have the complete narrative. **Phase 6 (observability and operability, §9) is now done** — its exit criterion (§9), the full 500-record feed accounted for in exactly one bucket summing to 500, is fully met live, §16's US-MON-01/US-PERF-01 entries have the complete narrative; only R-37 (alerting destination/routing) stays open with CCH, gating nothing this codebase controls. See `continue/continue - before phase 6.md`, superseded by a Phase 7 handoff once written:

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
| **Phase 3 — envelope construction and JWS validation** | **Done**, [2026-09-03] — §16 (US-MLA-04/05), §6. Envelope construction, ajv schema enforcement, and real RS256/384/512 JWS verification (file-backed, hot-reloadable key store) are all built, wired into one live handler, and verified against a real broker and a real `ppa-stub` — including a genuinely re-signed record, a tampered one, a stripped signature, and a simulated key-source outage, each producing a distinct, correctly-classified outcome. D3 (the envelope `id` scheme) resolved with PPA's owners as Option A during this phase. |
| **Phase 4 — PII tokenization** | **Mechanism built, tested, and live-verified, [2026-09-04]; gate item #1 (fail-mode) also built, tested, and live-verified, [2026-09-04]** — §16 (US-PII-01/02, plus US-PII-01's follow-up entry), §7. **Not formally closed** — gate item #2 (secret rotation, §7.1 #2, §13.1) is CCH's trigger question to answer, and engineering's mechanism to then build; everything else is done. |
| **Phase 5 — delivery, offsets, and resilience** | **Done**, [2026-09-07] — §16 (US-MLA-06/07), §8. Delivery client, per-call timeout, the full three-way offset gate (success/permanent/transient), retry with genuine jitter, a per-partition circuit breaker, and automatic reprobe recovery are all built, tested, and live-verified against a real broker and a real `ppa-stub` — including a persistent-503 breaker trip and its own automatic, restart-free recovery, a genuine TLS-handshake failure, and a 4xx logging the full (tokenized) envelope and advancing immediately. Every clause of the phase's own exit criterion (§8) is live-proven. |
| **Phase 6 — observability and operability** | **Done**, [2026-09-08] — §16 (US-MON-01/US-PERF-01), §9. Structured logging, ten Prometheus-compatible metrics, and alert paths at all five named conditions (each with a metrics-based sink, always active, plus an optional configurable webhook) are all built, tested, and live-verified against a real broker and a real `ppa-stub` — including every alert condition firing independently on genuinely re-signed records, and the phase's own exit criterion (a full 500-record feed accounted for in exactly one bucket, summing to 500) met live. Only R-37 (alerting destination/routing) stays open with CCH, gating nothing this codebase controls; MLA's own ack-latency p95 *budget* (as opposed to its instrumentation, built here) is Phase 7's own load-test claim to confirm. |
| **Phase 7 — hardening and validation** | **Development complete and live-verified, [2026-09-09]; the phase is NOT closed** — §16, §10. All six checklist bullets done: load (25 TPS sustained x 30 min and 125 TPS peak, 10440/10440 and 8702/8702 ack samples within the 200 ms budget, consumer lag 0 throughout, and a 125->25 step-down with 6,000 fed = 6,000 accounted), two-instance rebalance (delivered set identical to a single-instance baseline, no duplicates, no gaps), chaos (broker restart, MLA `SIGKILL` mid-dispatch, stub flapping — nothing lost in any), and `npm run scenario:all` running all 15 named scenarios unattended from a cold start. **Open on the exit criterion's "in CI" clause**: the project's first-ever pipeline (#44134) ran [2026-09-09] and failed at `build` — the runner is a `shell` executor (so `image:` is inert and `services:` unsupported, meaning no broker in CI) on a host running Node < 16 against `engines: >=22.17`. Infrastructure's to resolve, not engineering's. |
| **A running DRPP environment** | **Not available.** Promised by COMESA; no date. |

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
- [~] Tokenization-failure metric and alert, distinct from any other failure counter. *Built only as the interim structured-log line (`ingestion-consumer.service.ts`'s `pii-secret-unavailable` case) — the same "log now, Phase 6 wires the real metric/alert channel" posture Phase 3 already established for its own `SECURITY` logs, not a gap specific to this story. No dedicated failure-rate metric exists yet.*

**Exit criterion — live. Met**, against the fail-closed default (`plan.md` §7.1 #1). A real capture record (`postQuotes`, re-signed) flowed through the full pipeline via a genuinely running MLA instance against the real harness broker (`Forwarded QUOTE`, live log); a dedicated checked-in tool (`tools/verify-tokenization/run.ts`, `npm run verify:tokenization`) independently proved, over real mTLS against a real `ppa-stub`: prefixed tokens in every listed QUOTE field, the identical token across two independent runs, the amount reaching `ppa-stub` in clear, and a TRANSFER record's body reaching `ppa-stub` with zero fields altered. Reordering the pipeline's two calls breaks the ordering test. Full narrative: §16's US-PII-01/US-PII-02 entries and `EPICS/EPIC-PII-tokenization/`.

**Update [2026-09-04, gate item #1]:** the fail-mode wiring described above (skip once, log, advance) is what this exit criterion was met against - COMESA has since answered (§7.1 #1, verbatim) and the wiring now built matches that answer instead: a `pii-secret-unavailable` outcome is transient (retry, park, feed a breaker, offset withheld), not permanent. Built, tested, and live-verified - §16's own new US-PII-01 entry (dated the same day, appended after the original per §16's append-only rule) carries the full narrative; nothing above is edited to match it in place, per the documentation register's "no revision history in prose" rule read together with §16's own append-only rule for *this specific section*, which is a progress log by design.

**Open before go-live:** the rotation strategy (gate item #2, still open), what "protected" must legally mean, and named ownership of the secret. All three are CCH decisions — §13.

**Status as of the mechanism's build: not formally closed, per §7.2.** Everything above is built, tested above the coverage gate, and live-verified. Gate item #1 (fail-mode) is now also built, tested, and live-verified, and no longer gates anything. What is *not* yet true: gate item #2 (secret rotation) has an answered headline direction (versioned keys) but an unresolved trigger mechanism (§7.1 #2's own note) and is not yet built - `EPICS/EPIC-PII-tokenization/` executive-summary/file-register documents are written and current as of gate item #1, but the story itself stays not-formally-closed until item #2 also lands, per `CLAUDE.md`'s "External decisions" rule and this section's own §7.2.

### 7.1 The four open decisions — recommendations

Raised with the COMESA/CCH team via the BA team, in parallel with building the mechanism.

| # | Decision | Who | Blocks starting Phase 4? | Recommendation | **COMESA's answer** |
|---|---|---|---|---|---|
| 1 | **Fail-mode** — block the event or pass it through unprotected if tokenization fails | CCH | No — but §13.1 lists it as gating *calling Phase 4 complete*. | **Build fail-closed (block) as the default, take it to CCH as the recommendation, not an open blank.** Treat a per-event tokenization failure as a permanent failure in the same four-way classification MLA already uses — log as a security event, alert, advance the offset without forwarding to PPA. This is exactly the posture Phase 3 already took for JWS failures ("advance the offset without retrying"), so it's not a new category, just a consistent extension. Pass-through-unprotected means raw MSISDNs/names leave the Mojoloop boundary into a regulated cross-border pipeline *before* Legal has even settled whether that's lawful (#3 below is still open) — that's an asymmetric risk: fail-closed costs a paused event you can replay from the 7-day-retention topic; fail-open costs a PII disclosure you cannot un-send. Make it a config flag either way, so CCH's eventual answer is a flip, not a rebuild. | **Received [2026-09-04]: "If tokenization fails, fail the transaction and retry."** Confirms fail-*closed* (agrees the event must never forward unprotected) but names **transient, not permanent** — engineering-rules.md §6.1's *other* category, the one PPA 5xx/timeout already uses (retry, offset not advancing, feeds the breaker), not the one this phase actually built (`pii-secret-unavailable` is currently classified **permanent** — skip, log, no retry). **This is a real code change, not a wiring flip**: the current implementation does not yet match this answer. Retry count/backoff and post-exhaustion behaviour for *this specific* retry were not specified — recommend mirroring the existing MLA→PPA shape (3×, 1s/2s/4s, park+breaker at N) for consistency rather than inventing a second, distinct retry policy, but this should be confirmed with COMESA, not assumed. **Implemented [2026-09-04]** — mirroring the recommended MLA→PPA shape exactly (3 retries, 1s/2s/4s backoff, breaker N=5, all independently configurable), built, tested, and live-verified against the real harness. `plan.md` §16's original US-PII-01 entry stays exactly as written (append-only); a new, later entry (same section, dated the same day) documents this change in full. |
| 2 | **Secret rotation strategy** — version old+new tokens, or drain in-flight correlation before rotating | CCH | No — only one active secret is needed to build the tokenizer itself. | **Recommend versioned keys, not drain-first, and say so when raising it.** Drain-first assumes a clean point where nothing is mid-correlation — but the system already has parking-before-TTL-expiry and out-of-order arrival by design, so a guaranteed-clean drain point may never actually exist, and "wait for full drain" on an always-on switch component is an availability risk for no good reason. Versioning is the standard shape for keyed-hash rotation (same idea as a JWT `kid`): keep the current key plus however many prior keys are still inside the max correlation/parking TTL, tag each token's existing recognizable prefix with a key-version marker, always tokenize new values with the current key, and accept a match against any still-active version. Retire a key once it's older than the longest correlation window it could still be needed for. No downtime, no silent correlation misses. | **Received [2026-09-04]: "We don't want to be holding the system up while it drains, so we should version. But we should also code for success: try the existing key, then have a failure route which looks for and applies new keys."** Confirms our own recommendation on the headline question — versioned, not drain-first — directly. The second sentence adds a mechanism shape we had not built (nor needed to, since rotation was explicitly out of scope for this phase): the hot path keeps using the currently-loaded active key unchanged (matches `FilePiiSecretClient`'s existing design exactly — no change needed there), and a **separate, reactive path** checks for and picks up a newer key once one becomes available, rather than either this codebase's current fully-static load ("restart to rotate") or the JWS key store's proactive `fs.watch`. **Genuinely ambiguous, worth confirming rather than assuming:** MLA's tokenizer has no natural "verification failure" signal the way a correlation/matching system would (it only ever writes tokens, never checks one against a key) — so what concretely triggers "the failure route" here (a periodic re-check, an explicit reload signal, something else) is not yet clear from the answer as given, and should be asked back precisely rather than guessed at. **Not implemented in this session** — no rotation mechanism exists yet (`plan.md` §16's US-PII-02 entry, "Left open"), and this answer is what the eventual build will follow once the trigger question above is resolved. |
| 3 | **What "protected" must mean legally** — reversible-by-lookup vs. reversible-only-with-the-secret | CCH Legal | No — mechanism is built and live-verified against a locally-generated secret regardless of the answer. | **Flag a conceptual gap in the question before Legal answers it, don't just relay it as-is.** US-PII-02 already commits to *keyed hashing*, and a keyed hash is one-way by construction — it can verify a candidate value matches, but the secret does not let you invert a token back to the original value. So "reversible-only-with-the-secret" isn't actually an available option for what's already been designed; the real choice is "non-reversible" (what a hash gives you today) vs. "a genuinely reversible mechanism" (which means a separate secure token→value lookup store, or swapping the primitive to reversible encryption — a materially different build, not a flag on this one). Build to the committed design — non-reversible, verify-only — and don't speculatively build a lookup store (same "don't build it speculatively" principle already applied to the ILP decoder). Take the question to Legal framed precisely: *if an authorized investigation needs to look up an original MSISDN from a token, that capability does not exist in the current design and would be new, separate infrastructure* — so Legal isn't unknowingly signing off on a lookup capability that was never actually built. | Still open. |
| 4 | **Named ownership of the production secret** — who holds it, who rotates it, on what schedule | CCH | No — same as #3; §13.2 files it under "gates production, not the work ahead." | **No technical basis to name a team, but recommend the pattern: whoever already owns Phase 3's MLA-side credential material (the mTLS client certs, the DFSP public-key mounting) should own this too, rather than standing up a separate ownership track for one more secret.** It's the same operational shape — mounted at startup, rotated on a schedule, never fetched per event, gates readiness on load failure — so splitting ownership across two teams for materially the same kind of artifact just adds a coordination seam with no corresponding benefit. Raise this as a recommendation to confirm, not a blank to fill. | Still open. |

One pattern across all four: #1 and #2 have real engineering defaults to build against today, revised only if CCH's answer differs; #3 and #4 are genuinely theirs to decide, but in both cases the sharpest move is handing them a more precise question than the one currently on paper, not just forwarding it unchanged. **#1 and #2 have now answered — and both confirm the recommended direction while adding detail the recommendation did not anticipate. #1 is now implemented, tested, and live-verified [2026-09-04, gate item #1 — §16's new US-PII-01 entry]. #2 remains unimplemented — its trigger mechanism is still genuinely ambiguous (see the table row above) and needs confirming with COMESA before building, not guessing.**

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

Everything here is **blocked** and stays blocked. Listed so that when the environment arrives, the work is already scoped. (Separately, per the 2026-09-09 meeting, Paysyslabs itself is moving off the Core Test Harness onto a Kubernetes-based deployment per Sam's earlier recommendation — an empty cluster is already configured locally, and running live traffic through it is the team's own next step. That is our own infrastructure work, not COMESA's environment, and does not unblock this section, but it bears directly on the Kubernetes-manifests bullet below.)

- [ ] Confirm the topic name, partition count and retention in the target environment. `topic-event-audit` and 7-day retention are both inherited assumptions — the captures evidence neither.
- [ ] Confirm `operation`, `Content-Type` and `FSPIOP-HTTP-Method` survive identically in CCH's production feed (FSD Open Item #7 for *their* environment, regardless of what our captures show).
- [ ] **Re-verify the canonical-record table against live traffic.** CCH and the Mojaloop Foundation confirmed at the 2026-09-09 meeting (`docs/meetings/9-sept.md`; §14 Q2) that the per-operation `start`/`egress` asymmetry is by design across all environments — this item now confirms that stated design fact against live traffic, rather than testing an unconfirmed capture artefact.
- [ ] Obtain a dedicated consumer group ID from CCH.
- [ ] Verify a genuine DFSP signature with real keys.
- [ ] Real mTLS against the real PPA; the deployment's certificate provisioning.
- [ ] End-to-end against the real PPA, including the durable-ack semantics the stub cannot evidence.
- [ ] Load test on production-representative infrastructure.
- [ ] Kubernetes manifests, APM, the real metrics backend, alert destinations.

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
| **V7** | JWS | Header presence only | **Real cryptographic verification** | Pure addition. **Blocked** on real keys for a genuine-signature test; the mechanism is provable with re-signed fixtures. |
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
| **DFSP public keys / JWKS endpoint unavailable.** We hold 286 real signatures and cannot verify one. **Progressed [2026-09-09 meeting w/ Mojaloop Foundation + CCH — `docs/meetings/9-sept.md`]:** George confirmed the 19 DFSP ids in the export resolve to 8 DFSPs, 2 FXPs and 9 regional hubs (one per country), and is liaising with Infotex to obtain and share their public keys, and to check whether Infotex exposes a JWKS endpoint. Separately, Sam confirmed **Mojaloop Connection Manager (MCM) manages DFSP key distribution automatically during onboarding** — MLA should interface with MCM rather than maintain its own synced key store, a design question `core-knowledge.md` §13.3 and `cross-reference.md` §9.2 had both left open; Sam to share an MCM onboarding video. Michael separately clarified `GET /parties` requests are intentionally unsigned (the sender does not yet know the recipient at issue time) — consistent with, and now explaining, why every `party-lookup` record in the captures carries no signature. **Still open:** no keys, JWKS endpoint or onboarding video in hand yet. | Phase 3's genuine-signature verification. The *mechanism* is unblocked via re-signed fixtures; **the MCM-interface question is a new architectural item for whenever real integration begins.** | CCH / Mojaloop Partner (Infotex keys, MCM video) |
| ~~PII fail-mode — answered [2026-09-04], not yet implemented.~~ **Resolved [2026-09-04] — gate item #1.** COMESA's answer ("fail the transaction and retry") is now implemented, tested, and live-verified — §16's new US-PII-01 entry, §7.1 #1's table cell. Kept here, struck through, rather than deleted, so this table's own history stays legible. | ~~Phase 4 cannot be called complete until the code matches the answer~~ — no longer gates anything | — |
| **PII secret rotation — headline answered [2026-09-04], trigger mechanism unresolved — gate item #2.** COMESA confirmed versioned keys over drain-first, but "a failure route which looks for and applies new keys" names a trigger that does not map cleanly onto a tokenizer that only ever writes tokens, never checks one — §7.1 #2's table cell has the precise ambiguity. **User decision [2026-09-04, `continue - before phase 5.md` §2]: no technical dependency on Phase 5's own build — confirmed, then Phase 5 was prioritized ahead of this item rather than sequenced after it (superseding an earlier same-day decision that had tied the two together).** | Phase 4's formal closure only — no longer gates starting Phase 5 | CCH (the trigger question) then Engineering (the build) |
| ~~`cch-crosscutting-user-stories.md` is referenced throughout but absent~~ **Resolved [2026-09-07] — obtained**, home of US-AUD-01, US-MON-01, US-MON-02, US-PERF-01/02, US-SEC-01. Confirms the observability stack (Prometheus/Grafana/Loki/Tempo/Mimir, IDD §10). | ~~No longer gates Phase 6 in full~~ **Resolved [2026-09-08] — Phase 6 is formally closed** (§16's US-MON-01/US-PERF-01 entries); alert paths were built against a configurable sink (a metrics-based one, always active, plus an optional webhook) per `CLAUDE.md`'s own "External decisions" rule — an open destination decision does not block a mechanism built and live-verified against a stated, reversible default. **R-37 itself (alerting destination/routing) remains open, tracked below** — it gates only the real destination eventually being wired, not this codebase's own closure. | CCH (R-37's routing decision) |
| **R-04 (Critical) has no acceptance criteria** — the "never synthesize" prohibitions. MLA-side equivalent: never fabricate an envelope for an event that did not arrive. | Phase 2/3 acceptance criteria | Story author — liftable from the POC's behaviour |

### 13.2 Gates production, not the work ahead

| Item | Gates | Owner |
| --- | --- | --- |
| **COMESA environment not provisioned** | Phase 8 in full | CCH / COMESA |
| MLA→PPA timeout values not agreed (FSD Open Item #1) | The placeholder in `.env.template`; fine as a placeholder throughout | CCH + Paysys |
| Dedicated consumer group ID not issued (R-18) | Real deployment. **The one MLA misconfiguration capable of affecting live payments** — a reused DRPP-internal group name can steal partition assignments from a live payment-path handler. | CCH |
| Offset-advance-on-permanent-failure policy unconfirmed (FSD Open Item #8) | Whether Phase 5's 4xx and signature-failure rows advance or pause. Implemented as "advance"; the open part is whether that is *right*. | CCH + Paysys |
| Zambia Data Protection Act applicability (FSD Open Item #6) | Retention and what "protected" must mean legally | CCH Legal |
| PII secret ownership unassigned (rotation's own trigger mechanism moved to §13.1 — it now gates more than production) | Production operation of Phase 4 | CCH |
| Event Envelope versioning unspecified (R-23) | A future breaking change to the contract | Story author + IID owner |

---

## 14. Open questions for COMESA / the Mojaloop Partner

Ordered by how much they change what we build. The first four are the ones to put in the next data request.

1. **Can we have the DFSP public keys, or a JWKS endpoint?** Without them, JWS verification cannot be proven against real traffic — only against fixtures we sign ourselves. This is the single highest-value unblock available. **Answered in part [2026-09-09 meeting, `docs/meetings/9-sept.md`]** — see §13.1's DFSP-keys row for the full outcome (key inventory confirmed, Infotex retrieval and an MCM onboarding video pending). **Gates Phase 3** (§13.1) until the keys/JWKS/video actually arrive.
2. ~~Is the per-operation canonical-record shape a stable contract, or an artefact of this capture window?~~ **Resolved [2026-09-09 meeting]** — Michael (Mojaloop Foundation) confirmed `egress` is the safe, authoritative record in general, and George (CCH) confirmed the per-operation `start`/`egress` asymmetry — including the three `egress`-only operations — **is by design across all environments, not an artefact of the two shared captures.** George explained the three `egress`-only operations concretely: `commitTransfer` is the switch's own message (may indicate a timed-out transfer, still DFSP-signed if nothing went wrong), `reserveFxTransfer` is the FXP committing to honour a conversion only if the payment succeeds, and `notifyFxTransfer` is the switch telling the FXP the payment completed so the conversion can be booked. He also corrected the evidentiary basis itself: **the 141-record `DRPP_Kafka_E2E_Pack` set is a subset of the 500-record `raw_export_500.json` export, not a second independent capture window** — confirmed directly against the checked-in fixtures (every one of its 121 distinct `partitionID`:`offset` pairs appears in the 500-record export). So "641 records across two independent captures" was never accurate; the real evidentiary base is the single 500-record export, and the per-operation table's authority now rests on CCH/Mojaloop Foundation's design confirmation, not on cross-capture corroboration. **Re-verifying against live traffic remains a Phase 8 checklist item** (§11) — now to confirm a stated design fact in production, rather than to test an unconfirmed capture artefact. **New follow-up, not yet received:** George is to share his own annotated event table covering the ~52% of the 500-record export ours does not yet cover.
3. **Can we get a rejected transfer *fulfil*, and a rejected FX transfer?** **Answered [2026-09-09 meeting]** — George confirmed neither scenario exists in the current captures and both must be simulated. Sam is to supply two examples from Mojaloop's own test environment: a payee-DFSP rejection (e.g., a customer account suspended between approval and execution) and a switch-generated timeout failure (an unreasonably short timeout set deliberately to trigger it). **Partially answered [2026-09-16, Sam Kummary email + linked TTK report — `docs/meetings/sam-email-2026-09-16-rejection-samples.md`]:**
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
> a reload mechanism. Phase 4 remains not formally closed until item #2 also
> lands, per `continue - before phase 5.md` §2's own framing.

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
of that section by CCH techops' explicit `kubectl apply -f` ask (`docs/deployment/MLA-deployment-kubernetes.md`
§1) and grounded in the 2026-09-14 meeting with George (`docs/meetings/14-sept-deployment-meeting.md`),
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
                `cch-mla/deploy/kubernetes-dryrun/` to `docs/deployment/kubernetes-dryrun/`: `cch-mla` is
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
`docs/deployment/george-reply-2026-09-15.md`, `connectivity-options.md`, `certificate-setup-proposal.md`).
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
session performed. Recorded in `docs/deployment/MLA-deployment-kubernetes.md` §6/§12.

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

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

**Phase 0 is built and live-verified.** A TypeScript + Fastify skeleton exists at [`cch-mla`](/home/abdul-rahim/mojaloop/cch-mla) — the four-layer structure, typed and validated configuration, `/health/live` + `/health/ready`, structured logging, a Kafka connection client, 43 tests at 100% coverage against a mechanically-enforced 96% gate, and a GitLab CI pipeline. Full detail: §16's Phase 0 entry and `EPICS/EPIC-0-Scaffolding/`. **No pipeline logic exists yet** — nothing reads a Kafka record, classifies an event, builds an envelope, or talks to a PPA; that starts at Phase 2, and Phase 1 (the harness, §4) is next:

| Asset | State |
| --- | --- |
| Requirements — four user-story documents, broken out per story under `docs - MLA/EPICS/` | Complete; several findings still open (R-04 Critical, R-18, R-23, R-29, R-31) |
| Synthesized model — [`core-knowledge.md`](knowledge-base-stories/core-knowledge.md) | Complete |
| Engineering policy — [`engineering-rules.md`](engineering-rules.md) | Complete and binding |
| POC comparison — [`cross-reference.md`](knowledge-base-stories/cross-reference.md) | Complete; **five of seven forks settled (§3.1) — D3 and D5 still need a decision** |
| A live-verified predecessor — `poc-mla-ppa` and its documentation set | Complete, and the single most valuable input we have |
| Real capture data — `DRPP_Kafka_E2E_Pack 2/` | In hand (see §1.1); decision made to commit it into `cch-mla` as Phase 1 fixtures (`continue/continue - before harness.md` §5) |
| **Phase 0 — scaffolding** | **Done**, [2026-09-01] — §16 |
| **Phase 1 — the harness** | **Not started.** Next work — §4, and `continue/continue - before harness.md` |
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
| **D3** | **Envelope `id` scheme** — per-`eventType` (stories) or one leg-wide anchor (POC). | **US-MLA-04** — Construct a Standard Event Envelope. Its `id` acceptance criterion is the one this decision confirms or overturns. | **US-PPA-04** and **US-PPA-06** (in `cch-ppa-user-stories.md`) — PPA's per-stage idempotency and correlation-cache keys are built directly on whichever scheme wins here. | **Per-`eventType`, per US-MLA-04** — see §3.2, which is new evidence, not a restatement. | Determines whether the MLA needs cross-record chaining state at all. Also a **cross-team decision**: it moves work onto PPA, so PPA's owners must agree. |
| **D4** | **`msgType` cardinality and the fifth route.** | **US-MLA-04** (the `msgType` field itself) and **US-MLA-06** — Deliver Envelopes to PPA via Per-Action Endpoints (the `/TRANSFERS/NOTIFICATIONS` route lives in its Routing Table). | **US-MLA-02** (classification is what `msgType` is derived from); PPA's ingestion routes (`cch-ppa-user-stories.md`, US-PPA-01) mirror whichever route set MLA settles on. | **Two values, no `/TRANSFERS/NOTIFICATIONS`**, per the stories. | With the notification-dedup component removed and no independently-published Central Ledger event on the topic, a third value describes something that does not exist. But it is load-bearing control flow in the POC — settle D5 (which record is the `pacs.002` trigger) at the same time. |
| **D5** | **Which record is the final-state trigger** — `fulfilTransfer` (`start`, stories) or `commitTransfer` (`egress`, POC). | **US-MLA-02** — its own Classification Table is the one that names `fulfilTransfer`/`commitTransfer` as the TRANSFER row this decision picks between. | **US-MLA-04** (which HTTP-method signal derives `msgType` for this leg); **US-PPA-11** (in `cch-ppa-user-stories.md`) — the `pacs.002` translation and its `TxSts` table are built on whichever record and vocabulary wins here. | Needs COMESA input; both yield exactly one trigger. | They carry **different status vocabularies** — `fulfilTransfer` the FSPIOP `transferState`, `commitTransfer` the ISO `TxSts: "COMM"`. The `TxSts` translation table must match whichever is chosen, and an untranslated value is silently accepted downstream. |
| **D6** | **Payload selection** — mandatory base64 decode or select the FSPIOP form (POC). | **US-MLA-03** — Decode Base64-Encoded Transfer Payloads. Its own acceptance criteria state the mandatory-decode rule this decision rewrites. | **US-PPA-08/09/10/11** (in `cch-ppa-user-stories.md`) — every ISO field-mapping table sources from the FSPIOP form; decoding `dataUri` instead would break all four at once. | **Select the FSPIOP form**; treat decoding as available-on-demand. | Decoding `content.dataUri` yields *Mojaloop's* ISO 20022 (`IntrBkSttlmAmt.ActiveCurrencyAndAmount`, `FinInstnId.Othr.Id`) — not the FSPIOP shapes every downstream field table maps from. Following US-MLA-03 and the PPA field tables literally is internally inconsistent. Note `dataUri` is present on only 46 of 500 records. |
| **D7** | **Envelope `error` field** — add it, or make PPA re-sniff the body. | **US-MLA-04** — the envelope's field set is exactly what this decision extends. | **US-PPA-05** (in `cch-ppa-user-stories.md`) — "any error callback → `pacs.002`/RJCT" has no defined detection mechanism without it; **US-PPA-11** — the rejected-`pacs.002` builder reads this field directly. | **Add it**, as the POC did. | Without it, US-PPA-05's "any error callback → `pacs.002`/RJCT" has no defined detection mechanism, and the PPA re-implements shape-detection the MLA already did. |

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

**The honest cost:** the per-type scheme moves the cross-stage join to PPA, which must link a `quoteId`-keyed entry to its `transactionId`-keyed one. That link is available — the `postQuotes` body carries both — but it is work PPA now owns. **D3 cannot be decided unilaterally by this team.**

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

- [ ] `docker-compose.dev.yml` — single-node Redpanda; `topic-event-audit` created with **12 partitions**.
- [ ] `tools/capture-feeder/` — [`environment-simulation.md`](environment-simulation.md) §3.1, with explicit partition assignment and every scenario flag.
- [ ] `tools/ppa-stub/` — [`environment-simulation.md`](environment-simulation.md) §3.2, with envelope schema validation, JSONL recording, the fault-injection control endpoint, and mTLS against a local CA.
- [ ] `tools/` README documenting how to run each scenario, and stating plainly that **offsets are not reproduced, ordering is** ([`environment-simulation.md`](environment-simulation.md) §3.1).
- [ ] Curated unit fixtures lifted **verbatim** from real captures — never hand-written — covering every classification case, the partition-split transaction, the transfer rejection, the FX-quote rejection, and the party-lookup records.
- [ ] Golden-file regression harness ([`environment-simulation.md`](environment-simulation.md) §3.3), with goldens for: `01_MWK_to_ZMW_PRIMARY`, `raw_topic_slice_partition2.json`, and the full 500-record export.
- [ ] A named scenario library, each mapping to acceptance criteria: happy path · partition split · transfer rejection · FX-quote rejection · duplicate record · dropped record · corrupt record · missing signature · PPA 503 · PPA 4xx · PPA timeout · PPA flaky · broker restart · MLA restart · two MLA instances.

**Exit criterion.** `capture-feeder` produces `raw_export_500.json` onto the local topic with all 500 records landing on their original partition numbers in their original per-partition order, verified by reading the topic back and diffing against the source. `ppa-stub` accepts, validates and records a hand-crafted envelope, and returns each injectable fault on command.

---

## 5. Phase 2 — Ingestion path

US-MLA-01, US-MLA-02, US-MLA-03. Delivers: a record consumed from a real broker, correctly selected and classified.

- [ ] Kafka consumer with **`autoCommit: false`** — the offset contract is never delegated to the client library. Explicit `advance` / `pause` / `resume`.
- [ ] Dedicated consumer group ID, externally configured, with the partition-stealing rationale documented at the config site (closes R-18 from the POC's own precedent).
- [ ] Canonical-record selection per **D1** — a table, plus the `prepareTransfer` payload shape-check (`TxInfAndSts.StsRsnInf` present and normal transfer fields absent) that distinguishes a real rejection from a harmless duplicate. **The shape is the primary signal; the `/error` URL suffix is corroborating evidence only** — a URL string is composed by an upstream service and can change without notice.
- [ ] Event classification per **D2**. Party-lookup operations recognised and explicitly skipped, with their own comment — never an accidental fallthrough.
- [ ] FX-quote rejection detection (no `operation` tag + `StsRsnInf` present) — recognised, counted distinctly, not forwarded, per `rejected-events.md` §6 Q1's recommended default. **It must not be indistinguishable from an ordinary skipped duplicate in the logs.**
- [ ] Payload selection per **D6**.
- [ ] Unreadable-record path: log, alert, advance the offset. Never retried.

**Exit criterion — live.** With Redpanda running, `capture-feeder` feeds `raw_topic_slice_partition2.json`; the MLA consumes from the real topic and, for every record, either forwards it or skips it with a *distinct, correct reason*. The golden file matches. Restarting the MLA mid-feed resumes from the committed offset with no loss and no duplication — **provable now, and not provable at all under the POC's tooling.**

---

## 6. Phase 3 — Envelope construction and JWS validation

US-MLA-04, US-MLA-05.

- [ ] Envelope builder per **D3**, **D4** and **D7**. `correlationId` freshly generated per event, **never** the Kafka message key.
- [ ] Completeness check: missing `msgType`, `eventType`, `id`, `fspiop-source` or `fspiop-destination` ⇒ log, advance, do not forward.
- [ ] Envelope ajv schema, shared verbatim with `ppa-stub` so the contract is enforced from both ends.
- [ ] **Real cryptographic JWS verification** — RS256/384/512, against the sending DFSP's registered public key, on every canonical record, no exemptions.
- [ ] Configurable key store; adding a DFSP key must not require a restart.
- [ ] A **key-source outage must be distinguishable from a genuine signature failure.** Otherwise an outage manifests as "every event has an invalid signature" — the failure mode US-MLA-05 explicitly calls out.
- [ ] Missing / invalid signature ⇒ security log, alert, advance the offset. Not retried.

**On the missing keys** ([`environment-simulation.md`](environment-simulation.md) §4, and §13 below): build against locally re-signed fixtures — take real capture bodies, sign with a generated keypair, register that key, verify. This proves the mechanism honestly. **Verification against a genuine COMESA signature stays open, and the phase's status must say so rather than implying full coverage.**

**Exit criterion — live.** Every record in the partition-2 slice produces a schema-valid envelope accepted by `ppa-stub`, or is rejected for a stated reason. A locally re-signed record verifies; the same record with a tampered body fails and raises the security alert; a stripped signature fails distinctly from an unreachable key source.

---

## 7. Phase 4 — PII tokenization

US-PII-01, US-PII-02. **This has no POC precedent** — the POC's `pii-mask.service.ts` masks what reaches *logs and the audit store*, on the *PPA* side, and leaves the payload sent onward untouched by design. This phase transforms the payload itself, inside the MLA. Do not mistake one for the other.

- [ ] Field classification per the Fields-to-Tokenize table, per event type.
- [ ] **ILP-carried fields explicitly exempt** — cryptographically bound into the transfer's `condition`; rewriting them breaks the payment.
- [ ] Transaction amounts never tokenized, in any message — Tazama's threshold and velocity rules need them in clear.
- [ ] Keyed hashing (never a bare hash — the MSISDN space is small enough to enumerate), deterministic, with a **recognizable token prefix**.
- [ ] Secret loaded once at startup from a mounted location; never fetched per event. **If it fails to load, the service does not report ready** — never runs unprotected while advertising health.
- [ ] **The ordering test.** A test that fails if tokenization is moved ahead of signature validation. This is a hard requirement, not a convention: the DFSP signed the event as sent, so validating against a tokenized payload fails every time.
- [ ] Tokenization-failure metric and alert, distinct from any other failure counter.

**Exit criterion — live.** A real capture record flows through the full pipeline; the envelope reaching `ppa-stub` carries prefixed tokens in every listed field, cleartext in every ILP-carried and amount field, and the same input produces the same token across runs. Reordering the pipeline breaks the suite.

**Open before go-live:** the fail-mode decision (block or pass through), the rotation strategy, what "protected" must legally mean, and named ownership of the secret. All four are CCH decisions — §13.

---

## 8. Phase 5 — Delivery, offsets, and resilience

US-MLA-06, US-MLA-07. This is the phase the harness was built for.

- [ ] Endpoint selection by `eventType` per **D4**.
- [ ] mTLS client configuration; stable service-name addressing, never individual replicas.
- [ ] Per-call timeout, configured **independently** of the retry budget.
- [ ] **Offset advances only on HTTP 200.** Nothing else.
- [ ] 5xx / timeout / TLS-handshake failure ⇒ retry ×3, exponential backoff **with genuinely random jitter**, offset not advancing.
- [ ] TLS handshake failure treated as transient, **with the underlying reason preserved in the alert** so a certificate misconfiguration stays distinguishable from ordinary unavailability.
- [ ] 4xx ⇒ log the full envelope, alert, advance. Permanent.
- [ ] **Retry exhaustion and circuit breaking as two coordinated mechanisms, not one.** Exhaustion parks the event and keeps retrying it; those failures accumulate toward a **configurable N**; at N the breaker trips and pauses the partition, re-probing on a timer. *The POC collapsed these into one and had no threshold on the MLA side at all* — §12.
- [ ] Every pause paired with a re-probe that can resume it. A partition paused with no path back is the bug the POC's own breaker existed to fix.

**Exit criterion — live.** Against `ppa-stub`: a 503 leaves the offset unadvanced and the event is redelivered on recovery; three 5xx responses produce three backed-off retries with visibly different jitter; N consecutive failures trip the breaker and pause consumption; restoring the stub resumes from the paused event with nothing lost or duplicated; a 4xx advances immediately; a TLS handshake failure retries and its alert names the handshake, not a generic 5xx.

---

## 9. Phase 6 — Observability and operability

- [ ] Structured logging (`pino`) with `correlationId`, `eventType` and pipeline step on every line — from the first line of real code, not retrofitted.
- [ ] Metrics for every question an operator must answer without a debugger: throughput and consumer lag; skip counters **by reason** (`egress`, party-lookup, unclassifiable, FX-quote-rejected); rejection counters; signature failures; tokenization failures; retry and breaker state; delivery outcomes; ack latency against the 200 ms p95 budget.
- [ ] **A metric for every decision the code makes silently.** Anything dropped without an alert must still be counted — otherwise a wrongly-dropped record is indistinguishable from a correctly-dropped one.
- [ ] Alert paths wired for: missing/invalid signature, 4xx, retry exhaustion, breaker trip, tokenization failure.

**Blocked:** alerting *destinations* are undecided (R-37, in the missing crosscutting document). Build the paths; leave the sink configurable.

**Exit criterion.** A full 500-record feed produces a metrics snapshot in which every record is accounted for in exactly one bucket, and the buckets sum to 500.

---

## 10. Phase 7 — Hardening and validation

- [ ] Full-capture regression: all five folders, the partition-2 slice, and the 500-record export, each against its golden file, in CI.
- [ ] **Run the suite in default parallel mode.** At least one real concurrency bug in the POC reproduced only under parallel workers and passed cleanly every time under `--runInBand`.
- [ ] Sustained load via `--loop`, measured against 25 TPS sustained / 125 TPS peak, with ack latency against the 200 ms p95 budget — including tokenization overhead, which US-PII-01 requires be confirmed under load rather than assumed.
- [ ] Two MLA instances against 12 partitions — group rebalance, no double-processing, no gaps.
- [ ] Chaos: broker restart mid-feed; MLA `SIGKILL` mid-dispatch; stub flapping.
- [ ] Coverage and lint gates enforced in CI.

**Exit criterion.** Every scenario in the Phase 1 library passes, unattended, in CI, from a cold start.

---

## 11. Phase 8 — The COMESA environment

Everything here is **blocked** and stays blocked. Listed so that when the environment arrives, the work is already scoped.

- [ ] Confirm the topic name, partition count and retention in the target environment. `topic-event-audit` and 7-day retention are both inherited assumptions — the captures evidence neither.
- [ ] Confirm `operation`, `Content-Type` and `FSPIOP-HTTP-Method` survive identically in CCH's production feed (FSD Open Item #7 for *their* environment, regardless of what our captures show).
- [ ] **Re-verify the canonical-record table against live traffic.** It holds with zero exceptions across every capture we have, but that is one capture window, not a Mojaloop guarantee.
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
| **V3** | Envelope `id` | Leg-wide anchor + two chaining maps | **Per-`eventType`** (D3) | Divergence, and it *removes* code. Chaining disappears entirely (§3.2). **Must re-prove:** every canonical record yields a non-empty `id` across the full 500-record export — the POC's chaining bugs were exactly this class. **Must confirm with PPA's owners** that they accept the join. |
| **V4** | `msgType` | 3 values + `/TRANSFERS/NOTIFICATIONS` | **2 values, 4 routes** (D4) | Divergence. The POC used `msgType === notification` as load-bearing control flow. **Must re-prove:** the final-state record still routes correctly and is still distinguishable from a prepare — tied to D5. |
| **V5** | Final-state trigger | `commitTransfer` (`egress`-only) | **Undecided** (D5) | **Open.** The two carry different status vocabularies. Whichever is chosen, the downstream translation table must match. Do not let this drift. |
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
| **D3 — the `id` scheme is a cross-team decision.** MLA cannot unilaterally choose a scheme that changes PPA's correlation keys. | Phase 3, and PPA's own Phase 2 equivalent | Paysys — MLA + PPA together |
| **D5 — which record is the final-state trigger**, and therefore which status vocabulary the translation table must cover. | Phase 2 classification, Phase 3 envelope, and PPA's `pacs.002` | Paysys + Mojaloop Partner |
| **DFSP public keys / JWKS endpoint unavailable.** We hold 286 real signatures and cannot verify one. | Phase 3's genuine-signature verification. The *mechanism* is unblocked via re-signed fixtures. | CCH / Mojaloop Partner |
| **PII fail-mode undecided** — block the event, or pass it through unprotected? | Phase 4 cannot be called complete | CCH |
| **`cch-crosscutting-user-stories.md` is referenced throughout but absent** — US-AUD-01, US-MON-01 (and R-37's alerting destinations), US-MON-02, US-PERF-01 (the 200 ms budget). | Phase 6 in full; the latency budget in Phase 7 | Story author |
| **R-04 (Critical) has no acceptance criteria** — the "never synthesize" prohibitions. MLA-side equivalent: never fabricate an envelope for an event that did not arrive. | Phase 2/3 acceptance criteria | Story author — liftable from the POC's behaviour |

### 13.2 Gates production, not the work ahead

| Item | Gates | Owner |
| --- | --- | --- |
| **COMESA environment not provisioned** | Phase 8 in full | CCH / COMESA |
| MLA→PPA timeout values not agreed (FSD Open Item #1) | The placeholder in `.env.template`; fine as a placeholder throughout | CCH + Paysys |
| Dedicated consumer group ID not issued (R-18) | Real deployment. **The one MLA misconfiguration capable of affecting live payments** — a reused DRPP-internal group name can steal partition assignments from a live payment-path handler. | CCH |
| Offset-advance-on-permanent-failure policy unconfirmed (FSD Open Item #8) | Whether Phase 5's 4xx and signature-failure rows advance or pause. Implemented as "advance"; the open part is whether that is *right*. | CCH + Paysys |
| Zambia Data Protection Act applicability (FSD Open Item #6) | Retention and what "protected" must mean legally | CCH Legal |
| PII secret ownership and rotation strategy unassigned | Production operation of Phase 4 | CCH |
| Event Envelope versioning unspecified (R-23) | A future breaking change to the contract | Story author + IID owner |

---

## 14. Open questions for COMESA / the Mojaloop Partner

Ordered by how much they change what we build. The first four are the ones to put in the next data request.

1. **Can we have the DFSP public keys, or a JWKS endpoint?** Without them, JWS verification cannot be proven against real traffic — only against fixtures we sign ourselves. This is the single highest-value unblock available. **Gates Phase 3** (§13.1).
2. **Is the per-operation canonical-record shape a stable contract**, or an artefact of this capture window? Zero exceptions across **641 records** and two independent captures (141 in `DRPP_Kafka_E2E_Pack` — five 20-record transactions plus the 41-record partition-2 slice — and 500 in `raw_export_500.json`), corroborated by signature presence. But that is still two capture windows, not a Mojaloop guarantee. **Built against in Phase 2; re-verified against live traffic in Phase 8** (§11).
3. **Which record should be treated as the final-state trigger** — `fulfilTransfer` or `commitTransfer` — and is the ISO (`COMM`/`RESV`) or FSPIOP (`COMMITTED`/`RESERVED`) vocabulary authoritative? (D5.) **Gates Phase 2 classification and Phase 3 envelope construction** (§13.1).
4. **Can we get a rejected transfer *fulfil*, and a rejected FX transfer?** Neither has ever been captured. Every branch for them is specification-only. Widening the capture window is what surfaced the three rejection shapes we do have. **Affects Phase 2–3 test coverage** — the untested branches sit in classification and envelope construction.
5. **Can an FX quote fail *after* its payment's `pain.001` has been sent**, or only before the primary quote — the only ordering observed? This changes the correct behaviour entirely: if the primary quote can already be in Tazama's graph, a discard-and-count is wrong. **Bears on Phase 2's FX-quote rejection handling**; the resulting correlation behaviour is PPA-side.
6. **Is `topic-event-audit` the final topic name**, and what are the retention and partition count in the target environment? The FSD assumes 7 days; no capture evidences retention either way. **Phase 8** (§11 — the local Phase 1 topic name/partition count are derived directly from capture evidence, not from this answer).
7. **Is the settlement-leg partition split expected behaviour or a symptom?** It determines whether out-of-order arrival is a permanent design condition or a defect someone will fix. **Bears on Phase 2's out-of-order handling** (the harness itself, Phase 1, only needs to replay the split faithfully, not explain it).
8. **Is `dateOfBirth` genuinely unavailable on this topic**, or absent only from these test parties? Zero occurrences across every capture; downstream `pacs.008` mapping depends on it. **PPA-side (`pacs.008` translation) — not a numbered cch-mla phase.**
9. **Is `binId` / `processedAsBatch` (present on 59 of 500 records) relevant to us?** Neither the FSD, the stories, nor the POC models batch processing on this topic. Probably out of scope — worth one question rather than an assumption. **If relevant at all, Phase 2** (ingestion/classification scope).

---

## 15. Suggested sequencing

The order that reaches something genuinely verifiable soonest:

0. **Settle D1–D7** (§3.1). Cheap now, expensive later. D3 and D5 need other people, so raise them first and build the parts that do not depend on them while waiting.
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

---

*This document is updated as work happens — what was built, what broke, the root cause, the fix, and what was proven live versus assumed.*

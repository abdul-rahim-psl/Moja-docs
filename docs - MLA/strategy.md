<!-- SPDX-License-Identifier: Apache-2.0 -->

# Knowledge Base Strategy — CCH MLA / PPA <!-- omit in toc -->

**Purpose:** this document is the entry point for any new chat session or new engineer working on `cch-mla`. It maps every document in the knowledge base and in the source-material folder, states what each contributes, gives a reading route matched to the task at hand, and records which source wins when two disagree. **Read this first, then read only what §3 points at.**

- [1. Sixty-second orientation](#1-sixty-second-orientation)
- [2. The document map](#2-the-document-map)
- [3. Reading routes by task](#3-reading-routes-by-task)
- [4. Precedence — which source wins](#4-precedence--which-source-wins)
- [5. The indexing rule](#5-the-indexing-rule)
- [6. Beyond this folder](#6-beyond-this-folder)
- [7. Traps worth knowing before you start](#7-traps-worth-knowing-before-you-start)

---

## 1. Sixty-second orientation

`cch-mla` implements two services that carry payment events out of COMESA's DRPP (a Mojaloop-based switch) and into Tazama's fraud-detection pipeline as ISO 20022 messages.

- **MLA (Mojaloop Adaptor)** sits inside the Mojaloop network boundary. It consumes one Kafka audit topic, keeps only `start` records, classifies each event into one of four types, base64-decodes transfer bodies, validates the DFSP's JWS signature, tokenizes PII, wraps the result in an **Event Envelope**, and POSTs it to PPA over mTLS. It commits its Kafka offset **only** on PPA's HTTP 200.
- **PPA (Payment Platform Adaptor)** sits inside the Tazama boundary. It persists each envelope to a write-ahead store before acknowledging, then asynchronously validates, deduplicates, accumulates correlation state in ValKey, translates to ISO 20022, validates against a pinned local schema, and dispatches to Tazama's TMS API.

One cross-border payment produces exactly **four** Tazama messages: `pain.001` (quote request), `pain.013` (quote callback), `pacs.008` (transfer prepare), `pacs.002` (final state or rejection). The FX legs produce no message of their own — they are cached and fold into those four.

**Current state:** Phases 0 through 3 are built and live-verified in [`cch-mla`](/home/abdul-rahim/mojaloop/cch-mla) — the separate repository this knowledge base governs; nothing under `docs - MLA/` runs code. Phase 4's mechanism is built and live-verified too, though the phase is not yet formally closed. A real ingestion pipeline exists, and on top of it, real envelope construction, real JWS verification, and real PII tokenization: the MLA consumes from a real Kafka broker, classifies each event, verifies the DFSP's signature, tokenizes party-identity fields, and builds a schema-valid `EventEnvelope` — every decision live-verified end to end, including a genuinely re-signed record being accepted by a live `ppa-stub` over mTLS with prefixed tokens in every listed field, a tampered one failing, a stripped signature failing distinctly, a key-source outage failing distinctly from an invalid signature, and a missing PII secret failing distinctly again. **Phase 4 (PII tokenization, `US-PII-01`/`02`) stays open on one CCH decision — the fail-mode wiring (`plan.md` §7.1 #1, §13.1) — not on any remaining engineering. Phase 5 (delivery to PPA) is next** and does not depend on that answer. See `plan.md` §1 and §16 for what has actually been built, and `continue/` for the current session handoff. The four user-story documents have been through a consolidated review; several critical findings are resolved and a smaller set — including one Critical (**R-04**, the two "never synthesize" prohibitions) — remains open. See `core-knowledge.md` §13.

---

## 2. The document map

### 2.1 Knowledge base — what the system is and how we build it

`strategy.md` and `engineering-rules.md` sit directly under `docs - MLA/`; `core-knowledge.md` and `cross-reference.md` sit under `docs - MLA/knowledge-base-stories/`.

| File | Path | Significance — what it contributes |
| --- | --- | --- |
| **`strategy.md`** | `docs - MLA/strategy.md` | This document. The map, the reading routes, the precedence rules, and the indexing rule. Start here; then follow §3 rather than reading everything. |
| **`core-knowledge.md`** | `docs - MLA/knowledge-base-stories/core-knowledge.md` | **The consolidated implementation authority for *what the system must do*.** Synthesizes all four user-story documents into one coherent model: the event model and audit-topic ground truth, MLA's pipeline and processing order, PII tokenization, the Event Envelope contract, PPA's nine-step pipeline, the full ISO 20022 field-mapping reference for all four messages, the correlation and three-tier durability model, the end-to-end failure and back-pressure chain, the security model, the NFRs, what was decided or removed, and the complete open register. Carries no material from outside the four source documents. **§13 (open register) and §14 (gaps in the document set) are the two sections to check before starting any new piece of work.** ~715 lines. |
| **`engineering-rules.md`** | `docs - MLA/engineering-rules.md` | **The authority for *how* we build it.** Ten non-negotiables, the layering and ports-and-adapters architecture, SOLID calibrated to this codebase with each principle's stopping point stated, where to decouple and where explicitly not to, code style, the four-way failure classification, concurrency and state rules, config and secret handling, the observability question list, the testing standard (95% Jest plus what must be tested by category), the live-verification rule that outranks paper design, traceability, definition of done, and an anti-pattern list drawn from failure modes the story documents actually record. ~370 lines. |
| **`cross-reference.md`** | `docs - MLA/knowledge-base-stories/cross-reference.md` | **The POC-versus-stories comparison, and the register of where capture evidence contradicts a stated assumption.** Compares what was built and live-verified in `poc-mla-ppa` against what the four user-story documents now specify, at the level of business logic and flow rather than implementation. Opens with the seven forks that need a decision before code is written, then §2 — **the highest-value section** — tabulates fourteen points where the POC's captures contradict something a story states as settled fact. Follows with area-by-area comparison (ingestion, the identifier model, the envelope, the PPA pipeline, ISO translation, durability and the error path, security), then what the stories should absorb from the POC (§10), what the POC never built (§11), and a component-by-component reuse verdict (§12). **Read §1 and §2 before planning any implementation work; §12 before touching any POC module.** ~555 lines. |

### 2.2 Source material — the requirements themselves (`docs - MLA/user stories/`)

The four documents `core-knowledge.md` is built from. **They remain the authority; `core-knowledge.md` is a synthesis of them, not a replacement.**

| File | Significance |
| --- | --- |
| **`cch-mla-user-stories.md`** | **MLA's stories, Epics 1–3 — US-MLA-01 through 07.** Kafka subscription and the `start`/`egress` filter, the full event classification table, base64 decoding, Event Envelope construction, JWS validation, delivery to PPA with the routing table and offset-commit gate, and the retry/circuit-breaker state machine. Closes with its own review-findings table (R-02, R-03, R-08, R-18, R-22, R-23, R-31, R-06) and an actions table with named owners. ~320 lines. |
| **`cch-ppa-user-stories.md`** | **PPA's stories, Epics 6–10 — US-PPA-01 through 17** (US-PPA-14 merged into 04). The largest and most detailed source: mTLS ingress and health-check scoping, write-ahead persist, envelope validation, the generic atomic idempotency check, trigger/cache classification, ValKey correlation accumulation, the domestic/cross-border discriminator, all four ISO translations with normative field sourcing, pinned-schema validation, TMS dispatch and its circuit breaker, the DLQ, pre-expiry parking, and out-of-order handling. Closes with the largest findings table (R-01, R-04, R-05, R-30 Critical; R-29 High; R-11/12/13/28/32 Medium; a Low tail) and 13 actions. ~610 lines. |
| **`cch-pii-user-stories.md`** | **PII tokenization — US-PII-01, US-PII-02.** The fields-to-tokenize table with the ILP-packet exemption and its cryptographic rationale, the keyed-hash token construction, secret handling and startup loading, readiness coupling, and the **validate-signature-before-tokenize** ordering requirement. States the Fastify + TypeScript stack and the 95% Jest coverage standard applied across all components. ~94 lines. |
| **`cch-notification-dedup-user-stories.md`** | **The removed component — US-DEDUP-01, Epic 4. REMOVED FROM THE DESIGN, not deprioritized.** Retained as the historical record and, more importantly, as **the evidence document**: the Kafka finding that `fulfilTransfer` and `commitTransfer` are the same relayed FSPIOP callback, which is what closes FSD Open Items #2 and #5 and cascades into the four-value `eventType` enum, the two-value `msgType`, the dropped `/TRANSFERS/NOTIFICATIONS` endpoint, and the removal of every JWS exemption. Closes R-06, R-07, R-09, R-24, R-25, R-26, R-27. ~61 lines. **Read this before questioning why any of those four decisions are what they are.** |

### 2.3 Planning and process — how the work is sequenced and verified

| File | Significance |
| --- | --- |
| **`plan.md`** | **The build plan, in phases, with an exit criterion per phase, and the progress log.** Opens with what the captures actually contain (verified directly against the files, not quoted), then §2's one-page statement of the environment decision and why it gates everything else — the harness design itself lives in `environment-simulation.md`. Phases 0–8 run decisions → harness → ingestion → envelope/JWS → PII → delivery/resilience → observability → hardening → the COMESA environment, each with a **live** exit criterion rather than a coverage one. Closes with the **divergence register** (§12, V1–V14 — what we do differently from the live-verified POC and what must be re-proven), blocked work split by what gates now versus production, the open questions for COMESA, the sequencing, and **§16's progress log — the record of what has actually been built.** **§3.1's D1–D7 must be settled before any pipeline code is written; §3.2 carries tag-availability evidence that changes the `id`-scheme decision.** ~390 lines. |
| **`environment-simulation.md`** | **The authority on how we test without a DRPP environment — and the record of why the cheap option was rejected.** Opens with the answer as originally stated, verbatim: the POC's `demo:replay` bypasses Kafka entirely, so roughly half of MLA's durability contract is unprovable under it; the fix is a real local Redpanda fed from the captures. Carries the full harness design — `capture-feeder`'s faithfulness rules (explicit per-message partition assignment, per-partition ordering, why absolute offsets are not reproduced) and its scenario flags, the fault-injecting `ppa-stub`, and golden-file regression — then §4's honest list of what the harness still cannot prove. **§6 is a self-contained executive explanation** in plain terms for a non-engineering audience: the situation, the two obvious options and why both are wrong, what it costs and buys, the limits, and the ask. ~205 lines. |

### 2.4 Working units — `docs - MLA/EPICS/`

| Folder | Significance |
| --- | --- |
| **`docs - MLA/EPICS/`** | **The nine MLA and PII stories, re-split one folder per epic and one `story.md` per story** — the same material as §2.2's `cch-mla-user-stories.md` and `cch-pii-user-stories.md`, reorganised into the unit build work is actually picked up in. Four story epics: **EPIC-1** Kafka subscription & audit-topic ingestion (US-MLA-01–03), **EPIC-2** envelope construction & JWS validation (US-MLA-04–05), **EPIC-3** delivery to PPA & offset management (US-MLA-06–07), **EPIC-PII** tokenization (US-PII-01–02). Each `story.md` carries that story's Description, Acceptance Criteria, Method, Assumptions and Todos verbatim — the `Todos` list doubles as the test checklist. **This is the spec you build against; `core-knowledge.md` is the model around it and `plan.md` §15 is the order.** 35–59 lines each. **`EPIC-0-Scaffolding/` is the exception — it implements no story and carries no `story.md`**, because Phase 0 precedes the first one. It holds **`executive-summary.md`** (what the scaffolding is for, the reasoning behind each non-obvious decision, what was proven live, and the coverage-gate defect the phase found in its own tooling — ~74 lines) and **`file-register.md`** (every file the phase added, with the reason it exists — the fastest route to "what is this file for?" without reading the file — ~71 lines). |

### 2.5 Session handoffs — `docs - MLA/continue/`

Written at milestones, each superseding its predecessor for **"what's next"** while earlier ones stay untouched as their own record — the same convention the POC's own `continue/` chain used. Only the newest is current for what to do next; read an older one only when tracing history.

| File | Marks the point where… |
| --- | --- |
| **`continue - before scaffolding.md`** | **Superseded — historical record only.** Written when design and planning were complete and zero application code existed. Walks Phase 0's scaffolding checklist (`plan.md` §3.3) with the reasoning inline, restates which of D1–D7 are settled (build against them) versus genuinely open (do not guess — raise them), and states scaffolding's exit criterion concretely. That criterion was met and recorded in `plan.md` §16 on 2026-09-01 — read that entry and [`docs - MLA/EPICS/EPIC-0-Scaffolding/`](EPICS/EPIC-0-Scaffolding/) for what actually happened, not this file. |
| **`continue - before harness.md`** | **Superseded — historical record only.** Written when Phase 0 was complete and Phase 1's harness checklist (`plan.md` §4) was the next work. That checklist was met live and recorded in `plan.md` §16 on 2026-09-02 — read that entry and [`docs - MLA/EPICS/PHASE-1-Harness/`](EPICS/PHASE-1-Harness/) for what actually happened, not this file. |
| **`continue - before phase 2.md`** | **Superseded — historical record only.** Written when Phase 1 was complete and Phase 2's ingestion path (`plan.md` §5, US-MLA-01–03) was the next work. That checklist was met live and recorded in `plan.md` §16 on 2026-09-02/03 — read those entries and [`docs - MLA/EPICS/EPIC-1-kafka-subscription-audit-topic-ingestion/`](EPICS/EPIC-1-kafka-subscription-audit-topic-ingestion/) for what actually happened, not this file. |
| **`continue - before phase 3.md`** | **Superseded — historical record only.** Written when Phase 2 was complete and Phase 3's envelope construction and JWS validation (`plan.md` §6, US-MLA-04/05) was the next work; named D3 (the envelope `id` scheme) as gating the phase and flagged the JWS byte-exactness risk. That checklist was met live and recorded in `plan.md` §16 on 2026-09-03 — read those entries and [`docs - MLA/EPICS/EPIC-2-envelope-construction-jws-validation/`](EPICS/EPIC-2-envelope-construction-jws-validation/) for what actually happened, not this file. D3 was resolved during the phase, with PPA's owners, as Option A. |
| **`continue - before phase 4.md`** | **Superseded — historical record only.** Written when Phase 3 was complete and Phase 4's PII tokenization (`plan.md` §7, US-PII-01/02) was the next work. That checklist's mechanism was met live on 2026-09-04, recorded in `plan.md` §16 and `EPICS/EPIC-PII-tokenization/` — read those, not this file, for what actually happened. **The phase itself stays open**: the PII fail-mode decision this document named as the one thing Phase 4 could not close alone (block vs. pass-through-unprotected on a tokenization failure) is still open with CCH; see `plan.md` §7.1 #1 and §16's US-PII-01 entry for the live tracking, not this superseded document. |
| **`continue - before phase 5.md`** | **Current.** Phase 4's mechanism (PII tokenization) is built and live-verified, not yet formally closed (CCH's fail-mode decision, tracked in `plan.md` §16); **Phase 5's delivery, offsets and resilience** (`plan.md` §8, US-MLA-06/07) is the next work and does not depend on that decision. Walks that checklist with the reasoning inline, and carries forward the still-open Phase 4 item so a fresh session does not lose it. |

---

## 3. Reading routes by task

Match the task to a route. Reading beyond the route is usually wasted context.

| If the task is… | Read, in this order |
| --- | --- |
| **Orienting for the first time** | `strategy.md` §1 → `core-knowledge.md` §1–§2 → `engineering-rules.md` §1 |
| **Starting any build work at all** | `plan.md` §3.1 (the D1–D7 decisions) → the phase you are in → `plan.md` §12 (divergence register) |
| **Setting up a local dev environment, or testing without a broker** | `environment-simulation.md` in full → `plan.md` §4 (Phase 1's checklist) |
| **Explaining the testing approach to a stakeholder, or justifying the harness** | `environment-simulation.md` §6 (executive) → §2 (what `demo:replay` cannot prove) |
| **Deciding what to ask COMESA for** | `plan.md` §14 → §13 (blocked work) |
| **Planning implementation, or estimating any story** | `cross-reference.md` §1 (the seven forks) → §2 (contradicted facts) → §11 (what was never built) |
| **Reusing or porting anything from the POC** | `cross-reference.md` §12 (reuse verdict) → the matching area section → the POC module itself |
| **Questioning why the POC did something differently** | `cross-reference.md` §2 → the area section → `../docs-poc-mla-ppa/MLA-PPA-Technical-Design.md` (outside this repository) for the full derivation |
| **Writing any code at all** | `engineering-rules.md` in full (once) → `core-knowledge.md` for the section the change touches → the source story it implements |
| **Implementing an MLA story** | `core-knowledge.md` §2–§3 → the story in `cch-mla-user-stories.md` → `engineering-rules.md` §6–§7, §10 |
| **Implementing PII tokenization** | `core-knowledge.md` §4 + §3.2 (ordering) → `cch-pii-user-stories.md` in full → `engineering-rules.md` §8 |
| **Implementing a PPA pipeline step** | `core-knowledge.md` §6 → the story in `cch-ppa-user-stories.md` → `engineering-rules.md` §7 (concurrency) |
| **Implementing an ISO 20022 translation** | `core-knowledge.md` §7 (the field tables **and** §7.5's `removeAdditional` trap) → US-PPA-08/09/10/11 → US-PPA-12 |
| **Working on durability, DLQ, parking or replay** | `core-knowledge.md` §8–§9 → US-PPA-02, 15, 16, 17 |
| **Working on retry, breakers, or back-pressure** | `core-knowledge.md` §9 → US-MLA-07 + US-PPA-13 → `engineering-rules.md` §6.1 |
| **Understanding why a decision is what it is** | `core-knowledge.md` §12 → `cch-notification-dedup-user-stories.md` → the relevant findings table |
| **Finding out what is open or blocked** | `core-knowledge.md` §13 in full → the Actions table at the end of the relevant story document |
| **Deciding whether an abstraction is worth it** | `engineering-rules.md` §3–§4, then §14 |
| **Writing tests** | `engineering-rules.md` §10–§11 → the story's own Todos list (each story enumerates its required test cases) |
| **Reporting status to a stakeholder** | `strategy.md` §1 → `core-knowledge.md` §12–§13 |
| **Building a story, start to finish** | `CLAUDE.md` ("How a story gets built") → the story's own file in `docs - MLA/EPICS/` → the route below matching what it touches → `plan.md` §16 to record it |
| **Understanding the project skeleton — what exists and why** | `docs - MLA/EPICS/EPIC-0-Scaffolding/executive-summary.md` → `plan.md` §16's Phase 0 entry |
| **Working out what a given project file is for** | `docs - MLA/EPICS/EPIC-0-Scaffolding/file-register.md` |
| **Picking up the next story** | `plan.md` §15 (sequencing) → §16 (what is already done) → that story's `docs - MLA/EPICS/…/story.md` |
| **Starting a session with no idea where things stand** | `docs - MLA/continue/` — read the **newest** file only |
| **Finding out what has actually been built** | `plan.md` §16 (progress log) — what closed, what was proven live versus assumed |
| **Adding a document to this knowledge base** | §5 below, then match the register of the closest existing document |

---

## 4. Precedence — which source wins

Three precedence rules operate. Conflating them causes errors.

**On what the audit topic actually contains:**

```
DRPP_Kafka_E2E_Pack captures  >  the FSD  >  the IID / IDD
```

The captures are ground truth — they are what MLA actually reads, not what the FSD predicted it would read. This is what settled the notification-dedup removal, the four-value `eventType` enum, the `start`/`egress` double-write, the asymmetric `operation` naming, and the fact that Mojaloop's `traceId` is not transaction-scoped.

**On business logic the captures do not touch** (correlation, trigger/enrichment classification, translation rules): **the FSD is the component-level authority.** Where the FSD contradicts *itself* — as on `pacs.002`'s `GrpHdr.MsgId` provenance (R-11) — the stories follow the more specific clause and the fix is owed to the FSD.

**Within this repository:**

- **The four user-story documents are the requirements authority.** They define what must be built.
- **`core-knowledge.md` is the consolidated implementation authority** — the working reference. It is a synthesis, so **where it disagrees with a story document, the story document wins and `core-knowledge.md` is corrected in the same commit.**
- **`engineering-rules.md` is the authority on how code is written**, and its §11 (live verification) outranks any paper design, including `core-knowledge.md`, when they conflict.
- **`cross-reference.md` is the authority on the POC relationship**, and on which side of a story/POC disagreement holds the evidence. It does not override a story document — where it says a story is wrong, that is a **finding to action**, not a change already made. Its §2 rows are the ones to raise with the story author.
- **`plan.md` is the authority on sequencing and on what is blocked** — what gets built when, each phase's exit criterion, and which decisions are outstanding. It is a living document: it records what was built, what broke, and what was proven live versus assumed, and is updated as work happens rather than written once. Where it states an empirical fact about the captures, that fact was verified against the files directly and supersedes a story's assumption — see its §12.
- **The newest `docs - MLA/continue/` file is the authority on what to do right now**, in this session, at this moment — it does not override `plan.md` or `strategy.md`, it orients a reader into them. When it and `plan.md` disagree on status, `plan.md` §16 (the progress log) is the ground truth; the `continue` doc is corrected or superseded, not `plan.md`.
- **`environment-simulation.md` is the authority on the local test harness** — its design, its faithfulness rules, and the limits of what it can prove. `plan.md` §2 states the decision in one page and points here; §4 sequences building it as Phase 1.
- **A review finding marked Resolved supersedes the story text it corrected**; a finding marked Open does not. Read both the finding table and the Actions table — their statuses are not always in step.

---

## 5. The indexing rule

> **Every document added to `docs - MLA` (`mojaloop/docs/docs - MLA`, not anything under `cch-mla/`) is registered in this file's §2 in the same commit that creates it — never later.**

The entry must state:

1. **The filename**, bolded, as it appears on disk.
2. **What it contributes that nothing else does** — its distinct significance, not a restatement of its title.
3. **Which sections a reader is most likely to need**, when the document is long enough that reading it end to end is wasteful.
4. **Its approximate length**, so a reader can budget context.

Then add it to **§3's routing table** against whatever task it serves. A document nobody is routed to is a document nobody reads.

The same rule applies to `docs - MLA/user stories/`: a new source document is registered in §2.2 with its epic/story range and its findings, in the commit that adds it.

**This rule is mirrored in `CLAUDE.md` at the repository root**, so it applies automatically to any session working here.

---

## 6. Beyond this folder

| Resource | Where | Significance |
| --- | --- | --- |
| **`CLAUDE.md`** | repository root | Working rules for any agent session in this repo, including the indexing rule above. |
| **The FSD** | external — `CCH_FSD_MessageIngestion` | Component-level authority on business logic. **Not in this repository.** Every FSD claim in the knowledge base is a *reported* claim. |
| **The IID / IDD** | external | Cross-boundary contracts. Carries the consumer-group warning (§5.1) and the envelope-versioning contract (§5.2). **Not in this repository.** |
| **`DRPP_Kafka_E2E_Pack`** | external | Five corridor captures plus an interleaved partition slice from `topic-event-audit`. **Ground truth for the topic model.** Not in this repository — obtain it before writing any fixture. |
| **`Message_NotificationDedup_OpenItems_Resolution.md`** | external | The full evidence behind the notification-dedup removal and the closure of FSD Open Items #2 and #5. |
| **`cch-crosscutting-user-stories.md`** | **referenced but absent** | Cited as the home of US-AUD-01 (audit-log PII masking), US-MON-01 (monitoring, and the R-37 alerting-destination gap), US-MON-02 (readiness scoping), and US-PERF-01 (≤200 ms p95). **Several acceptance criteria depend on it. Obtain it.** |
| **`poc-mla-ppa`** | `/home/abdul-rahim/mojaloop/poc-mla-ppa/` — **outside this repository** | A prior proof of concept of the same two-service pipeline, with its own documentation set under `../docs-poc-mla-ppa/` (outside this repository). Useful precedent for stack, layout and live-verification tooling. **It is a POC, not a normative source — do not treat its decisions as requirements here.** |

---

## 7. Traps worth knowing before you start

- **`core-knowledge.md` is a synthesis of exactly four documents and nothing else.** It deliberately excludes the FSD, the IID, and the captures except as cited claims. When a fifth document arrives, it is cross-referenced in — not assumed to already be reflected.
- **Two of the four source documents are large** (`cch-ppa-user-stories.md` at 610 lines, `cch-mla-user-stories.md` at 320). Grep for the story ID, then read that range.
- **`cch-notification-dedup-user-stories.md` looks like a dead document and is not.** It carries the Kafka evidence that four separate live design decisions rest on. Read it before re-opening any of them.
- **US-PPA-14 does not exist** — merged into US-PPA-04 (R-28). **Epic 5 is unaccounted for** in the available documents.
- **A "Resolved" finding and its "Open" action can coexist**, and do. Check both tables.
- **The single highest-consequence rule in the spec — "never synthesize a `pacs.002` or a `pain.013`" — still has no acceptance criteria** (R-04, Critical). Do not assume the stories cover it; they say plainly that they do not.
- **The most dangerous failures in this system are silent**: a mismatched `OrgnlEndToEndId` (TMS accepts, never links), an untranslated `TxSts` (accepted, breaks every rule), a stripped unknown field (false HTTP 200), a trigger event not cached (every `pacs.008` degraded). **None of these produce an error.** Design and test for them specifically.
- **The consumer group ID is the one misconfiguration in this system capable of affecting live payments** (R-18) — a reused DRPP-internal group name can steal partition assignments from a live payment-path handler. It must be a dedicated group.
- **Two ordering constraints are load-bearing:** validate the JWS signature *before* tokenizing, and never advance an offset before durable acknowledgement. Both are enforced by tests, not by convention.

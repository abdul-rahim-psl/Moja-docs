<!-- SPDX-License-Identifier: Apache-2.0 -->

# Onboarding Strategy — MLA & PPA POC <!-- omit in toc -->

**Purpose:** this document is the entry point for a new chat session working on `poc-mla-ppa`. It maps every document in this folder, states what each one contributes, gives a reading order matched to the task at hand, and records the precedence rules that decide which source wins when two disagree. Read this first, then read only what the routing table below points at — the full documentation set is roughly 350 KB and does not fit comfortably in one context window.

- [1. Sixty-second orientation](#1-sixty-second-orientation)
- [2. The document map](#2-the-document-map)
- [3. Reading routes by task](#3-reading-routes-by-task)
- [4. Precedence — which source wins](#4-precedence--which-source-wins)
- [5. The `continue/` chain](#5-the-continue-chain)
- [6. Beyond this folder — code, captures, and normative sources](#6-beyond-this-folder--code-captures-and-normative-sources)
- [7. Conventions to carry forward](#7-conventions-to-carry-forward)
- [8. Traps worth knowing before you start](#8-traps-worth-knowing-before-you-start)

---

## 1. Sixty-second orientation

`poc-mla-ppa` is a proof of concept for two services that carry payment events from the COMESA DRPP (a Mojaloop-based switch) into Tazama's fraud-detection pipeline.

- **MLA (Mojaloop Adaptor)** sits inside the Mojaloop network boundary, consumes one Kafka topic (`topic-event-audit`), and forwards each event to the PPA as an **Event Envelope**. It performs no correlation, enrichment or translation, so it never holds a Tazama-scoped credential.
- **PPA (Payment Platform Adaptor)** sits inside the Tazama network boundary, accumulates each payment's state in ValKey, translates to ISO 20022, and submits to Tazama's TMS API.

One cross-border payment lands on Kafka as roughly nine asynchronous events. The pipeline assembles them into exactly four messages: `pain.001` (quote request), `pain.013` (quote callback), `pacs.008` (transfer prepare), `pacs.002` (final settlement or error). The FX quote and FX transfer legs fold into those four rather than producing messages of their own.

**Current state:** every tier of planned work is closed and live-verified against a real local Tazama TMS and ValKey. 230 automated tests (54 MLA + 176 PPA), 0 lint errors. The transfer-prepare rejection — once the project's one standing blocked item (error-path translation, blocked on COMESA supplying rejected-transaction captures) — is now built and live-verified too, resolved not by COMESA but by a second, wider capture surfacing real rejection data on its own; see `rejected-events.md`. Genuinely still open: no fulfil-side or FX-transfer-level rejection has ever been captured. A short list of deployment-stage work (mTLS, the Keycloak token chain, Kubernetes manifests, full PII tokenization) remains deliberately out of scope with no local environment to validate it against.

---

## 2. The document map

**Documentation root (full working set):** `/home/abdul-rahim/mojaloop/docs/docs-poc-mla-ppa/`

A deliberate three-document subset also lives in the code repository at `poc-mla-ppa/docs/` — see §6 and §8.

| File | Path | Significance — what it contributes |
| --- | --- | --- |
| **`strategy.md`** | `docs/docs-poc-mla-ppa/strategy.md` | This document. The map and the reading routes. Start here, then follow §3 rather than reading everything. |
| **`mojaloop-adaptor-and-payment-platform-adaptor.md`** | `docs/docs-poc-mla-ppa/mojaloop-adaptor-and-payment-platform-adaptor.md` | **The product-facing narrative, written in Tazama's own service-documentation format.** Walks the pipeline as numbered steps 0.1 → 0.6 (the range this component claims ahead of the TMS API's step 1), each step stating what it does, why it is shaped that way, and what is true today versus specified but unbuilt. This is the document to hand to someone outside the project, and the one whose step numbering everything else refers back to. ~275 lines. |
| **`MLA-PPA-Technical-Design.md`** | `docs/docs-poc-mla-ppa/MLA-PPA-Technical-Design.md` | **The authoritative implementation-facing spec, and the largest single source of truth.** Interfaces, record shapes, cache keying, the canonical-record table, failure-handling matrices, the trigger/enrichment model, degraded-operation fallbacks, out-of-order handling, POC scope (§5), open items carried from the FSD (§6), and a full live-validation record (§7.1–§7.13). **Section references in code comments (`§2.2a`, `§3.2`, …) point here.** ~620 lines / 88 KB — read by section, not end to end. |
| **`plan-outline.md`** | `docs/docs-poc-mla-ppa/plan-outline.md` | **The live status tracker and build log.** Narrates every session's work in order: what was built, what broke, the root cause, the fix, and exactly what was proven live versus assumed. Also holds the full **capture analysis** (what `topic-event-audit` actually carries, sections A–D), the phase checklists (Phase 0–7), the blocked-work register split by POC-gating versus production-gating, suggested sequencing, and the open questions for the COMESA/Mojaloop team. The place to look for *why* something is the way it is. ~1,630 lines / 107 KB — the largest file; read the "Current status" section and then only the phase or capture subsection you need. |
| **`MLA-PPA-Architecture-Diagrams.md`** | `docs/docs-poc-mla-ppa/MLA-PPA-Architecture-Diagrams.md` | **The visual companion, at three zoom levels.** Diagram 1: system and trust-boundary topology, colour-coded (blue = the two services, purple = durable/stateful surfaces, orange = self-healing guards). Diagram 2: one real cross-border payment sequenced end to end, matching a live-verified run. Diagram 3: `processEnvelope`'s internal decision pipeline including the recovery paths. Closes with a "core parts at a glance" table mapping each concept to the file that implements it — **the fastest orientation map for a first-time reader of the codebase.** ~330 lines. |
| **`MLA-PPA-Executive-Summary.md`** | `docs/docs-poc-mla-ppa/MLA-PPA-Executive-Summary.md` | **The stakeholder-facing summary.** States the problem, the two-service split and its rationale, why the shape is what it is, and a built/not-built table with each claim's verification status. Explicitly names what the POC does not deliver rather than leaving it implicit. Use for framing and for accurate scope language; not a source for implementation detail. ~145 lines. |
| **`Executive-Summary-Presentation.md`** | `docs/docs-poc-mla-ppa/Executive-Summary-Presentation.md` | **The presentation script.** The same story as the executive summary, pitched at an audience already familiar with the cross-border FX flow, with speaker notes cueing each feature to a specific node and colour in Diagram 1. Includes a Mermaid sequence diagram of the nine-event Mojaloop flow. Use when preparing a walkthrough or demo narrative. ~150 lines. |
| **`summarized steps - poc.md`** | `docs/docs-poc-mla-ppa/summarized steps - poc.md` | **Plain-language walkthrough of steps 0.1 → 0.6**, one entry per step (including sub-steps 0.2.1–0.2.4 and 0.5.1–0.5.7), each framed as "the problem it solves / what actually happens". Deliberately jargon-light. The fastest way to load the end-to-end mental model, and the right register to match when explaining any step to a reader. ~125 lines. |
| **`FAQ.md`** | `docs/docs-poc-mla-ppa/FAQ.md` | **Answers to questions raised while reading the main document**, each linked back to the step it concerns: canonical-record selection, anchor-identifier chaining for `putQuotesByID`/`reserveFxTransfer`, how ValKey accumulation is keyed, what "each piece of information in its own slot" means mechanically, and how a settlement event can genuinely arrive before its own prepare. Grows as new questions are answered. Check here before re-deriving an explanation. ~86 lines. |
| **`rejected-events.md`** | `docs/docs-poc-mla-ppa/rejected-events.md` | **Findings and a six-phase plan for the rejection/error path** — the one item `MLA-PPA-Technical-Design.md` and `plan-outline.md` had long carried as blocked. Written against a second, wider capture (`raw_export_500.json`, 500 records across 12 partitions) that surfaced three real rejection shapes the original five-transaction pack never could. Opens with a plain-language Problem/Work summary of Phases A–F — **all six are now built and live-verified**, though §5's own phase write-ups still read in the original planning voice, not rewritten after the fact. For what actually changed in the MLA/PPA code, read Technical Design §7.14 and `plan-outline.md`'s matching "Current status" entry, both added afterward to align with this document. `rejected-events.md` itself stays the standing reference for what remains genuinely open — no fulfil-side or FX-transfer-level rejection has ever been captured, and minimal reason-code diversity — and for the open design questions in §6. ~200 lines. |
| **`images/network-boundaries.png`** | `docs/docs-poc-mla-ppa/images/network-boundaries.png` | The boundary diagram embedded by the main document and the executive summary: audit topic → MLA → (boundary) → PPA → ValKey / write-ahead store → TMS. |
| **`continue/` (6 files)** | `docs/docs-poc-mla-ppa/continue/` | **Session handoff documents, one per milestone.** Each records where the work stood, what is next, the local dev environment, and the conventions in force. They form a supersession chain — see §5. Only the newest is current for "what's next"; the earlier ones are retained for their own historical record. |

---

## 3. Reading routes by task

Match the task to a route. Reading beyond the route is usually wasted context.

| If the task is… | Read, in this order |
| --- | --- |
| **Explaining any step of the pipeline to the user** | `summarized steps - poc.md` → `FAQ.md` → the matching step in `mojaloop-adaptor-and-payment-platform-adaptor.md` |
| **Answering "how does X actually work" at code level** | `MLA-PPA-Architecture-Diagrams.md` ("core parts at a glance" table) → the named section of `MLA-PPA-Technical-Design.md` → the actual source file |
| **Writing or changing code** | The newest `continue/` doc (§0 cadence, §4 environment, conventions) → `MLA-PPA-Technical-Design.md` for the section the change touches → `plan-outline.md`'s "Current status" for what was already tried |
| **Understanding why a design decision was made** | `plan-outline.md` (capture analysis A–D, and the "Current status" narrative) → `MLA-PPA-Technical-Design.md`'s divergence tables at the top |
| **Reporting status, or writing anything stakeholder-facing** | `MLA-PPA-Executive-Summary.md` → `Executive-Summary-Presentation.md` → newest `continue/` doc §1 |
| **Finding out what is open, blocked, or deferred** | `plan-outline.md` § *Blocked work* → `MLA-PPA-Technical-Design.md` §6 → newest `continue/` doc §2–§3 |
| **Understanding what the audit topic really contains** | `plan-outline.md` § *Capture analysis* (A–D) → `MLA-PPA-Technical-Design.md` §2.1–§2.2a |
| **Reproducing or extending a live verification** | `MLA-PPA-Technical-Design.md` §7.1–§7.14 → newest `continue/` doc §4 (environment + the two checked-in tools) |
| **Working on the rejection/error path, or extending it further** | `rejected-events.md` in full (the plan, and §6's still-open questions) → `MLA-PPA-Technical-Design.md` §2.2a/§3.3/§3.5/§7.14 for what's actually built |
| **Writing a new document in this set** | This document §7 (conventions) → the closest existing document, to match register |

---

## 4. Precedence — which source wins

Three separate precedence rules operate, and conflating them causes errors.

**On what the audit topic contains (the ingress/topic model):**

```
DRPP_Kafka_E2E_Pack captures  >  CCH_FSD_MessageIngestion_v4.0  >  Integration_and_Interface_Document_v4.0
```

The captures are ground truth — they are what the MLA actually reads, not what the FSD predicted it would read. The Technical Design's table *Where the captures override the FSD's topic model* enumerates every point where they differ (topic name, envelope shape, event classification, the `start`/`egress` double-write, base64 optionality, party lookup being present, payee display name, the `pacs.002` trigger, absent date of birth, the extended `TxSts` vocabulary).

**On business logic the captures do not touch** (correlation, trigger/enrichment classification, translation rules): the **FSD** is the component-level authority, and this POC follows it. One live disagreement with the IID remains unresolved — `msgType` values (`request`/`callback`/`notification` per the FSD, versus the original HTTP method per the IID). This POC follows the FSD.

**Within this documentation set:**

- `MLA-PPA-Technical-Design.md` is the implementation authority. Code comments cite its section numbers.
- `mojaloop-adaptor-and-payment-platform-adaptor.md` is the product-facing statement of the same system; its step numbering (0.1–0.6) is the shared vocabulary.
- `plan-outline.md` is the status and history authority — what was built when, what broke, what was proven live.
- The newest `continue/` doc is the authority on *what to do next* and on session working style.
- `rejected-events.md` is the detailed authority on the rejection/error path specifically — Technical Design and plan-outline summarise its findings and record what got built, but `rejected-events.md` itself holds the full analysis, the phase-by-phase reasoning, and the open design questions (§6). Read it directly rather than relying on the other two documents' summaries when extending this path.

---

## 5. The `continue/` chain

Handoff documents were written at milestones, each superseding its predecessor for "what's next" while the earlier ones stay untouched as their own record. In chronological order:

| # | File | Marks the point where… |
| --- | --- | --- |
| 1 | `continue - after phase 1.md` | Phase 1 (MLA) complete; the narrow vertical slice verified live. Retains the original Phase 1 detail and capture-analysis framing. |
| 2 | `continue - after all 4 msgs.md` | All four message types built, locally schema-validated, and live-verified. Also carries the fullest **conventions** section (§7) of any handoff doc. |
| 3 | `continue - after live verification.md` | Durability, persist-and-retrieve and out-of-order handling live-verified. **Introduces the Tier 1–4 framing** the later docs use. |
| 4 | `continue - after Tier 3 item 1.md` | Tiers 1–2 closed; the replay tool built and the `reserveFxTransfer` anchor gap found and fixed. First doc to state the **one-item-at-a-time cadence** explicitly. |
| 5 | `continue - from Tier 4.md` | Tier 3 fully closed, Tier 4 item 1 (audit log store) done. (Titled "after Tier 3" internally.) |
| 6 | **`continue - after Tier 4.md`** | **Current.** Every tier closed. Holds the running tally of six real bugs found by live verification, the one still-blocked item, the explicitly-excluded deployment work, the environment/tooling commands, and the carry-forward lesson on latent timing bugs. |

**Read #6 for current state and working style. Read #2 §7 for conventions.** The rest only when tracing history.

---

## 6. Beyond this folder — code, captures, and normative sources

| Resource | Path | Significance |
| --- | --- | --- |
| **POC source repository** | `/home/abdul-rahim/mojaloop/poc-mla-ppa/` | Two independent projects, `mla/` and `ppa/`, each with its own `package.json`, build and tests. Layout and conventions follow Tazama's own core services. |
| **In-repo documentation subset** | `poc-mla-ppa/docs/` | **Deliberately three documents, not the full set**: `mojaloop-adaptor-and-payment-platform-adaptor.md`, `MLA-PPA-Technical-Design.md`, `MLA-PPA-Architecture-Diagrams.md` — the implementation-facing trio that cross-reference each other and travel with the code. Status tracking, executive framing, handoff notes and reader explainers stay in the working set and are intentionally absent here. |
| **MLA pipeline logic** | `poc-mla-ppa/mla/src/services/logic.service.ts` | Canonical-record selection, event classification, anchor-identifier resolution and its two chaining maps, envelope construction, PPA dispatch and offset policy. |
| **PPA pipeline logic** | `poc-mla-ppa/ppa/src/services/logic.service.ts` | `processEnvelope` — the ten-step pipeline. Every business rule funnels through here. |
| **Correlation state** | `poc-mla-ppa/ppa/src/clients/cache.ts` | The ValKey hash model and the atomic Lua merge/restore scripts. |
| **Translation** | `poc-mla-ppa/ppa/src/services/iso20022.ts` | FX-leg folding, `TxSts` vocabulary translation, degraded-field fallbacks, all four message builders. |
| **Durability** | `poc-mla-ppa/ppa/src/clients/write-ahead.store.ts`, `ppa/src/services/park-sweep.service.ts` | Persist-before-ack, notification dedup, park/retrieve, and the near-expiry sweep. |
| **Verification tools** | `poc-mla-ppa/mla/src/scripts/demo-replay.ts`, `demo-loadtest.ts` | Checked-in, not scratch scripts. Replay a real capture through the compiled pipeline, or sustain concurrent load against it. Use these instead of writing a new script. |
| **Capture pack** | `/home/abdul-rahim/mojaloop/DRPP_Kafka_E2E_Pack 2/DRPP_Kafka_E2E_Pack/` | Ground truth for the audit topic. Five per-transaction folders plus `raw_topic_slice_partition2.json`, a contiguous unfiltered partition read. `04_ZMW_to_EGP_partition_split` is the confirmed out-of-order case. All five transactions settle successfully — no rejection data here; see the wider capture below for that. |
| **Wider capture — the rejection data** | `/home/abdul-rahim/mojaloop/DRPP_Kafka_E2E_Pack 2/raw_export_500.json/raw_export_500.json` | 500 records across **12 partitions** of `topic-event-audit` — the widest slice captured to date, and the first to contain real rejection data (a transfer-prepare reject, an FX-quote reject, a party-lookup reject). Full analysis in `rejected-events.md`. |
| **Regression fixture** | `poc-mla-ppa/mla/__tests__/fixtures/raw_topic_slice_partition2.json` | The interleaved slice, checked in — exercises the anchor-chaining maps across more than one transaction sharing a process lifetime, at 3-transaction scale. |
| **Regression fixture — wide-scale + rejections** | `poc-mla-ppa/mla/__tests__/fixtures/audit-records.json` (records 10–14), `wide-export-500.test.ts` | Curated real rejection records (transfer-prepare reject, party-lookup reject, FX-quote reject) plus a full-file regression test re-confirming the anchor-chaining maps at the wider capture's 44-transaction, 12-partition scale. |
| **Normative sources** | External to this repo | `CCH_FSD_MessageIngestion_v4.0.md` (CCH-PL-FSD-MSGING-001) for component internals; `Integration_and_Interface_Document_v4.0.md` for cross-boundary contracts. Neither is in this folder; both are quoted and reconciled throughout the Technical Design. |
| **Earlier prototype** | `/home/abdul-rahim/mojaloop/ppa-prototype/` | The single-process predecessor that first proved the ingestion path end to end. Its TMS-verified `pacs.008` transform is the reference the current translation was restored from when a live TMS rejected a missing field block. |

**Local stack** (confirm with `docker ps`): `tazama-tms-1` on `localhost:5000`, `tazama-valkey-1` on `localhost:16379`, compose project name `tazama`. MLA runs on `:3001`, PPA on `:3002`.

---

## 7. Conventions to carry forward

- **One action item at a time.** Finish what was asked, report it, and stop — do not chain the next obvious item into the same turn. This cadence was set explicitly and has held across every session.
- **Formal documents state facts directly.** No narration of what earlier drafts said. `plan-outline.md` is the deliberate exception: it is an explicitly-styled live status tracker that narrates each session's findings, and flattening its voice to match the Technical Design would fight its purpose.
- **Fixtures come from real captures, never hand-written.**
- **Section references in code comments point at `MLA-PPA-Technical-Design.md`.** Keep the pattern when adding code.
- **When a design decision changes, update the document, not just the code.**
- **Lint bar: 0 errors, warnings acceptable.** `processEnvelope`'s cyclomatic complexity is re-extracted into helpers whenever new branching pushes it past 15 — extraction is the established fix here, never an `eslint-disable`.
- **Run the test suite in default parallel mode before trusting it.** At least one real concurrency bug reproduced only under parallel workers and passed cleanly every time under `--runInBand`.
- **Prove it live, with volume.** Six real bugs in shipped code were found by running the code, none by unit tests alone — each one at a point where multiple components interacted or where timing mattered. A clean live-verification run proves a component works under the conditions it was exercised with; it does not prove no latent timing assumption remains inside it.
- **Trace multi-envelope scenarios by hand before trusting mocked unit tests** when the thing under test is an interaction across several async stages.

---

## 8. Traps worth knowing before you start

- **Two documentation directories exist, and the split is deliberate.** `/home/abdul-rahim/mojaloop/docs/docs-poc-mla-ppa/` is the full working set. `/home/abdul-rahim/mojaloop/poc-mla-ppa/docs/` carries three documents **by design** — the implementation-facing set that ships alongside the code (see §6). It is not an incomplete mirror and does not want syncing: do not copy the status, executive, handoff or explainer documents into the repository.
- **Two large files will truncate on a single read.** `plan-outline.md` (~1,630 lines) and `MLA-PPA-Technical-Design.md` (~620 lines, 88 KB) both exceed a single read window. Grep for the heading first, then read that range.
- **Do not re-derive what is already written down.** Every handoff document says this explicitly. The build history, the root cause of each bug, and exactly what was and was not proven live are already recorded in `plan-outline.md` and Technical Design §7.
- **`plan-outline.md` and the older `continue/` docs contain superseded "what's next" lists.** Only the newest handoff doc is current on next steps.
- **The Kafka message key is a trace id, not a transaction id.** It is not a correlation identifier, and a payment's settlement leg can be re-emitted under a fresh one — which is what makes cross-partition out-of-order arrival a real, captured condition rather than a defensive allowance.
- **Wipe `data/write-ahead/` and `data/audit-log/` before a live check, not only after.** Several test fixtures deliberately reuse the same real anchor id the live captures use, and tests that do not override the root directory write into the same default paths a live run reads from.
- **The error path is no longer entirely unverified — but don't overclaim what's covered.** `DRPP_Kafka_E2E_Pack`'s five transactions are still all-successful, but a second, wider capture surfaced real rejection data, and the transfer-prepare rejection is now built and live-verified (`rejected-events.md`, Technical Design §7.14). No fulfil-side rejection or FX-transfer-level rejection has ever been captured, though — do not start speculative work against either of those two shapes; nobody has observed them yet.

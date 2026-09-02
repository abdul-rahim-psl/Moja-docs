<!-- SPDX-License-Identifier: Apache-2.0 -->

# Continue — Before Phase 2 <!-- omit in toc -->

**What this document is.** A session handoff. It marks the point where Phase 1's harness is complete and **Phase 2's ingestion path** ([`plan.md`](../plan.md) §5) is the next work. Read this in full before touching anything; it is short by design.

**When this is superseded.** The moment Phase 2's exit criterion is met and the corresponding `docs - MLA/plan.md` §16 progress-log entry lands, this document's "what's next" job is done. It stays as the record of where things stood; a later `continue -` doc (Phase 3's, most likely) takes over for what's next.

- [1. Sixty-second orientation](#1-sixty-second-orientation)
- [2. What is already decided — do not re-litigate](#2-what-is-already-decided--do-not-re-litigate)
- [3. What is NOT yet decided — do not build ingestion around a guess](#3-what-is-not-yet-decided--do-not-build-ingestion-around-a-guess)
- [4. The Phase 2 checklist](#4-the-phase-2-checklist)
- [5. The harness, as it stands](#5-the-harness-as-it-stands)
- [6. The exit criterion — read this before calling anything done](#6-the-exit-criterion--read-this-before-calling-anything-done)
- [7. What comes immediately after](#7-what-comes-immediately-after)
- [8. Traps worth knowing before you start](#8-traps-worth-knowing-before-you-start)

---

## 1. Sixty-second orientation

Phase 1 closed live on 2026-09-02 — [`plan.md`](../plan.md) §16's second entry, and [`docs - MLA/EPICS/PHASE-1-Harness/`](../EPICS/PHASE-1-Harness/) for the full writeup. What exists now, on top of Phase 0's skeleton: a real local Redpanda (`docker-compose.dev.yml`, `topic-event-audit` at 12 partitions), `capture-feeder` (faithful replay with every scenario flag), `ppa-stub` (a fault-injecting mTLS test double), golden-file regression (three goldens recorded and live-verified), a fifteen-scenario library, and curated fixtures — all under `tools/`, all checked in, all live-verified on this machine.

**No pipeline logic exists yet.** Nothing reads a Kafka record, classifies an event, selects a canonical form, or talks to PPA. That is what Phase 2 (US-MLA-01 through 03) builds, and it is the first phase whose exit criterion exercises real MLA code against the harness rather than the harness alone.

Read in this order:

1. [`cch-mla/CLAUDE.md`](../../../cch-mla/CLAUDE.md) — if this is a new session.
2. [`../strategy.md`](../strategy.md) — the map. Follow its routing table; do not read the whole knowledge base. In particular, for this phase: **"Implementing an MLA story"** → `core-knowledge.md` §2–§3 → the story in `cch-mla-user-stories.md` → `engineering-rules.md` §6–§7, §10.
3. [`../knowledge-base-stories/core-knowledge.md`](../knowledge-base-stories/core-knowledge.md) §2 — the event model: the classification table, the `start`/`egress` double-write, the identifier facts that must not be conflated.
4. **This document** — where things stand right now, specifically.
5. [`../plan.md`](../plan.md) §5 — the actual Phase 2 checklist, which this document walks through but does not replace. §3.1 for D1/D2/D6, the three decisions this phase builds against.

---

## 2. What is already decided — do not re-litigate

[`plan.md`](../plan.md) §3.1 records all seven; unchanged since Phase 0 and Phase 1 — neither touched a decision, and this phase is not free to either, except by getting the owning story corrected as each decision's row already directs:

| # | Decision | This phase's stake |
| --- | --- | --- |
| **D1** | Canonical-record selection — the POC's per-operation table, plus a `prepareTransfer` payload shape-check. | **Owned by this phase.** The first thing built — everything downstream depends on it. |
| **D2** | Classification signal — `operation`, corroborated by (not derived from) method/resource and signature presence. | **Owned by this phase.** |
| **D4** | Two `msgType` values, no `/TRANSFERS/NOTIFICATIONS`. | Not yet reachable — `msgType` is assembled in Phase 3, not derived here, though the same `operation`-based signal this phase reads is what Phase 3 will reuse. |
| **D5** | `commitTransfer` (`egress`), ISO `TxSts` vocabulary authoritative. | Read by this phase's classification table (the TRANSFER row), not evaluated by it — the `TxSts` translation itself is PPA-side. |
| **D6** | Payload selection — the FSPIOP form, not mandatory base64 decode. | **Owned by this phase** (US-MLA-03). |

**None of these are this phase's to reopen.** Where a decision's row says a story needs correcting (D1 → US-MLA-01, D6 → US-MLA-03), that correction is part of closing this phase's stories, not a separate task.

---

## 3. What is NOT yet decided — do not build ingestion around a guess

**D3** (the envelope `id` scheme) remains open, still a cross-team decision, still not this team's to resolve unilaterally (`plan.md` §13.1). **It does not gate this phase.** D3 only changes what the `id` field *means* once the envelope is built in Phase 3; canonical selection, classification, and payload selection in Phase 2 never construct or read an `id` field. Do not let it delay starting here.

---

## 4. The Phase 2 checklist

This is [`plan.md`](../plan.md) §5. Work through it in order.

- [x] **Kafka consumer with `autoCommit: false`** — the offset contract is never delegated to the client library. Explicit `advance` / `pause` / `resume`, extending `KafkaClient` (`src/clients/kafka.client.ts`), which today is connection-lifecycle only (Phase 0 scope, deliberately). **Done, live-verified [2026-09-02]** — `subscribe`/`run`/`advance`/`pause`/`resume` added; 54 Jest tests, 100% coverage; proven against the real Redpanda harness (resume-from-committed-offset across two processes under the same group, and pause/resume freezing then releasing consumption). Full detail: `plan.md` §5 and §16.
- [x] **Dedicated consumer group ID**, externally configured, with the partition-stealing rationale (R-18) documented at the config site — `KafkaConfig.groupId` already exists (Phase 0); this phase is where it first actually joins a group. **Done** — the group join happened as part of the item above; the real group ID is still CCH's to issue (`plan.md` §13.2, unchanged).
- [x] **Canonical-record selection per D1** — a table, plus the `prepareTransfer` payload shape-check (`TxInfAndSts.StsRsnInf` present, normal transfer fields absent) that distinguishes a real rejection from a harmless duplicate. The shape is the primary signal; any `/error` URL suffix is corroborating evidence only. **Done [2026-09-02]** — `src/services/canonical-record.service.ts`, ported deliberately from the POC's `logic.service.ts` rather than the (now-superseded) story text. 29 new Jest tests against real captures, 100% coverage. Full detail: `plan.md` §5 and §16.
- [x] **Event classification per D2.** Party-lookup operations recognised and explicitly skipped, with their own comment — never an accidental fallthrough. **Done [2026-09-02]** — `src/services/event-classification.service.ts`, a three-way result (`classified`/`party-lookup`/`unclassifiable`) rather than a bare `EventType | undefined`. 19 new Jest tests against real captures, 100% coverage. Full detail: `plan.md` §5 and §16.
- [x] **FX-quote rejection detection** (no `operation` tag + `StsRsnInf` present) — recognised, counted distinctly, not forwarded. Must not be indistinguishable from an ordinary skipped duplicate in the logs. **Done [2026-09-02]** — `isFxQuoteRejection` in `src/services/canonical-record.service.ts`. Still a bare predicate, not yet wired into a handler that actually counts/logs it distinctly (no per-message handler exists yet); the module comment documents that a future caller must check it **before** `isCanonicalRecord`, or it silently reads as an ordinary non-canonical skip. 5 new Jest tests against real captures, 100% coverage. Full detail: `plan.md` §5 and §16.
- [ ] **Payload selection per D6.**
- [ ] **Unreadable-record path**: log, alert, advance the offset. Never retried.

**Test it against `tools/curate-fixtures`'s output as well as against the harness.** `__tests__/fixtures/curated/classification-cases.json` already has one record per (`operation`, `start`/`egress`) pair with a provenance file — engineering-rules.md §10.2's "every table row" requirement for the classification table is close to a direct match against that fixture. `transfer-rejections.json` and `fxquote-rejections.json` are the two rejection paths, ready to test against directly.

---

## 5. The harness, as it stands

Everything Phase 2 needs already exists and is live-verified (`docs - MLA/EPICS/PHASE-1-Harness/executive-summary.md`):

```bash
cd cch-mla
npm run harness:up             # Redpanda up, topic-event-audit at 12 partitions
npm run feeder -- --file __tests__/fixtures/DRPP_Kafka_E2E_Pack/raw_topic_slice_partition2.json
```

`ppa-stub` is not this phase's concern — Phase 2 stops at classification and payload selection, before envelope construction or delivery. Bring it up only when testing ahead into Phase 3 territory.

**One machine-specific note, carried forward:** the snap-packaged `docker compose` (space) plugin fails silently when run from a process tree rooted in the VS Code snap — including every command Claude Code's Bash tool runs — traced to AppArmor denying both inheritance of a file descriptor from the `code` snap and the abstract socket bind the CLI uses to talk to the compose plugin. A plain terminal shell, not spawned under VS Code, is unaffected. Use the standalone `docker-compose` (hyphen) binary — `tools/README.md` §1 has the one-line install and the full diagnosis. This is a fact about invocation nested under the VS Code snap on this machine, not the project.

---

## 6. The exit criterion — read this before calling anything done

From [`plan.md`](../plan.md) §5, verbatim:

> With Redpanda running, `capture-feeder` feeds `raw_topic_slice_partition2.json`; the MLA consumes from the real topic and, for every record, either forwards it or skips it with a *distinct, correct reason*. The golden file matches. Restarting the MLA mid-feed resumes from the committed offset with no loss and no duplication — **provable now, and not provable at all under the POC's tooling.**

Concretely:

```
npm run harness:up
npm run feeder -- --file __tests__/fixtures/DRPP_Kafka_E2E_Pack/raw_topic_slice_partition2.json
# start the MLA against the real topic; confirm every one of the 41 records is
# accounted for - forwarded, or skipped with a named, distinct reason
# (egress / party-lookup / unclassifiable / FX-quote-rejected)
# kill -SIGKILL the MLA mid-feed, restart it, confirm it resumes from the
# committed offset - nothing re-processed, nothing lost
```

**When this is genuinely done:**

1. Add the corresponding entry to [`plan.md`](../plan.md) §16 — what was built, what was verified live versus assumed, what diverged, what is left open. **Correcting US-MLA-01's canonical-selection rule and US-MLA-03's decode rule against D1/D6 is not this project's task** — the story documents are the BA's, the outdated-vs-D1/D6 gap has already been communicated to them, and `plan.md` §3.1's decision table is the durable record engineering builds against regardless of when (or whether) the story text itself is edited upstream.
2. Write `docs - MLA/EPICS/EPIC-1-kafka-subscription-audit-topic-ingestion/US-MLA-01/`, `.../US-MLA-02/`, `.../US-MLA-03/` — each its own `executive-summary.md` and `file-register.md`, per `CLAUDE.md`'s "Epic and story documentation" rule. Unlike Phase 0/1, this phase *does* implement stories, so it follows the normal per-story shape, not the epic-level exception.
3. Leave it all in the working tree for the user to commit — `CLAUDE.md`'s "Commits" rule.
4. Move to [`plan.md`](../plan.md) §6, Phase 3 — envelope construction and JWS validation (US-MLA-04/05).

---

## 7. What comes immediately after

- **Phase 3** (`US-MLA-04`/`05`) builds the envelope on top of whatever this phase selects and classifies, and needs D3 settled before its `id` field can be finished — raise D3 with PPA's owners now if it has not already been raised, so it is not this phase's blocker later.
- **Phase 4** (PII) needs this phase's payload selection (D6) to have produced the FSPIOP-form body PII tokenization operates on.
- **Phase 5** exercises every `ppa-stub` fault mode this harness already supports — nothing new needed there when it arrives.

---

## 8. Traps worth knowing before you start

- **Do not build a second implementation of classification inside a test.** `tools/capture-feeder` and `tools/golden` are deliberately classification-agnostic (`environment-simulation.md` §3.2's rule for `ppa-stub` applies in spirit here too) — the classification table belongs in `src/services/`, once, not reimplemented in a test harness to check itself.
- **The curated fixtures' `.provenance.json` files are there so a failing test can be traced back to the exact original record** — partition, offset, and its position in the source export. Use them; do not re-derive that information by hand.
- **`tools/golden`'s existing goldens diff the *topic*, not envelopes.** They do not become invalid or need updating for this phase's classification/canonical-selection logic — that logic runs after the point the golden mechanism measures. A genuinely new golden target (the classified/selected output) is a reasonable thing to add in this phase or the next, not a gap in what already exists.
- **The consumer group ID is the one misconfiguration capable of affecting live payments** (R-18, `strategy.md` §7). Get this right in code and in the config-site comment even though the real group ID (issued by CCH) is still a placeholder.

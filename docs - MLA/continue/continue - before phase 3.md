<!-- SPDX-License-Identifier: Apache-2.0 -->

# Continue — Before Phase 3 <!-- omit in toc -->

**What this document is.** A session handoff. It marks the point where Phase 2's ingestion path is complete and **Phase 3's envelope construction and JWS validation** ([`plan.md`](../plan.md) §6) is the next work. Read this in full before touching anything; it is short by design.

**When this is superseded.** The moment Phase 3's exit criterion is met and the corresponding `docs - MLA/plan.md` §16 progress-log entries land, this document's "what's next" job is done. It stays as the record of where things stood; a later `continue -` doc (Phase 4's, most likely) takes over for what's next.

- [1. Sixty-second orientation](#1-sixty-second-orientation)
- [2. What is already decided — do not re-litigate](#2-what-is-already-decided--do-not-re-litigate)
- [3. D3 — resolved during this phase](#3-d3--resolved-during-this-phase)
- [4. The Phase 3 checklist](#4-the-phase-3-checklist)
- [5. The harness, as it stands](#5-the-harness-as-it-stands)
- [6. The exit criterion — read this before calling anything done](#6-the-exit-criterion--read-this-before-calling-anything-done)
- [7. What comes immediately after](#7-what-comes-immediately-after)
- [8. Traps worth knowing before you start](#8-traps-worth-knowing-before-you-start)

---

## 1. Sixty-second orientation

Phase 2 closed live on 2026-09-02/03 — [`plan.md`](../plan.md) §16's three US-MLA-01/02/03 entries, and [`docs - MLA/EPICS/EPIC-1-kafka-subscription-audit-topic-ingestion/`](../EPICS/EPIC-1-kafka-subscription-audit-topic-ingestion/) for the full writeup. What exists now, on top of Phase 0's skeleton and Phase 1's harness: a real ingestion pipeline. `processRecord` (`src/services/ingestion.service.ts`) takes a raw Kafka message value and produces either a **forwarded** decision — a resolved `eventType` plus a selected FSPIOP-form body — or a **skipped** decision with one of five distinct, correctly-attributed reasons. `createIngestionHandler` (`src/services/ingestion-consumer.service.ts`) wires that into a real, live-verified consumer: correct offset semantics proven against a real broker, including a genuine mid-feed `SIGKILL`/restart with zero loss and zero duplication, and a decision-level golden file checked in for regression.

**No envelope exists yet, and nothing yet talks to PPA.** `processRecord` stops exactly where Phase 2 stops: at a selected payload and a resolved `eventType`. Phase 3 (US-MLA-04, US-MLA-05) is what turns that into a real `EventEnvelope` and cryptographically verifies the DFSP's signature before anything is allowed through. It is the first phase whose exit criterion produces something PPA can actually receive.

Read in this order:

1. [`cch-mla/CLAUDE.md`](../../../cch-mla/CLAUDE.md) — if this is a new session.
2. [`../strategy.md`](../strategy.md) — the map. Follow its routing table; do not read the whole knowledge base. For this phase: **"Implementing an MLA story"** → `core-knowledge.md` §2–§3 → the story in `cch-mla-user-stories.md` → `engineering-rules.md` §6–§7, §10.
3. [`../knowledge-base-stories/core-knowledge.md`](../knowledge-base-stories/core-knowledge.md) §3.2 (the processing-order diagram — steps 5 and 6 are this phase's own ordering constraint), §3.3 (JWS validation) and §5 (the Event Envelope contract).
4. **This document** — where things stand right now, specifically.
5. [`../plan.md`](../plan.md) §6 — the actual Phase 3 checklist, which this document walks through but does not replace. §3.1 for D3/D4/D7, the three decisions this phase builds against.

---

## 2. What is already decided — do not re-litigate

[`plan.md`](../plan.md) §3.1 records all seven; six are settled. Building Phase 3 against anything other than the row below is rework, not iteration:

| # | Decision | This phase's stake |
| --- | --- | --- |
| **D4** | Two `msgType` values (`request`/`callback`), no `/TRANSFERS/NOTIFICATIONS` third route. | **Owned by this phase.** `src/interfaces/event-envelope.interface.ts`'s `MsgType` already reflects it (built in Phase 1, so `ppa-stub` had a real schema to validate against) — this phase is where a real value gets assigned, not where the type is decided. |
| **D5** | `commitTransfer` (`egress`), ISO `TxSts` vocabulary authoritative. | Read, not re-decided — Phase 2's classification already resolved the TRANSFER row using it. Nothing in this phase revisits it. |
| **D6** | Payload selection — the FSPIOP form, not mandatory base64 decode. | **Already built (Phase 2).** `selectPayload`'s output is this phase's `body` input — already the FSPIOP form, already decoded where a decode ever applied. Nothing further to do here. |
| **D7** | Envelope `error` field — add it, populated only on a detected rejection shape. | **Owned by this phase.** `EventEnvelope.error` already exists in the interface (Phase 1); this phase is where it actually gets populated, sourced from Phase 2's `isFxQuoteRejection`/`isTransferRejection` predicates rather than reimplemented. |

`src/interfaces/event-envelope.interface.ts` and `src/interfaces/event-envelope.schema.json` **already exist**, built in Phase 1 specifically so `ppa-stub` had something real to validate against (`EPICS/PHASE-1-Harness/executive-summary.md`). Phase 3 reuses both rather than rebuilding them — the envelope's *structural* shape does not depend on D3 below (D3 only changes what `id` *means*), which is exactly why building them early was safe.

---

## 3. D3 — resolved during this phase

**D3** (the envelope `id` scheme) is settled: **Option A, the per-`eventType` business identifier** (`quoteId`/`conversionRequestId`/`transferId`/`commitRequestId` per `plan.md` §3.2's table), agreed directly with PPA's owners. The alternative — a single leg-wide anchor value with cross-record chaining state, the way the POC built it — is not taken forward. PPA accepts the cross-stage join this moves onto it (linking a `quoteId`-keyed entry to its `transactionId`-keyed one).

This was built against as the recommended default while the cross-team conversation was pending (`plan.md` §3.2 verified tag availability across all 500 captured records — every canonical record carries its own stage-local identifier directly in tags, with zero exceptions), kept visibly provisional in code and docs throughout, and is now final rather than provisional. `envelope-builder.service.ts`'s own comments have been updated to say so.

---

## 4. The Phase 3 checklist

This is [`plan.md`](../plan.md) §6, US-MLA-04 and US-MLA-05. **Code for all seven items below exists as of this session** — none of it is unit-tested or live-verified yet; treat every `[x]` here as "written and wired," not "done" (`plan.md` §6's own progress note carries the same status).

- [x] **Envelope builder per D3, D4 and D7.** `correlationId` freshly generated per event (UUID, `plan.md` §12 V10 — never the Kafka message key, which is not transaction-scoped in the real captures per `plan.md` §1.1). Reuses `EventEnvelope`/`event-envelope.schema.json` (already exist) and Phase 2's `IngestionOutcome.eventType`/`body` as direct inputs — this is largely assembly, not new field design. *(`src/services/envelope-builder.service.ts`.)*
- [x] **Completeness check:** missing `msgType`, `eventType`, `id`, `fspiop-source` or `fspiop-destination` ⇒ log, advance the offset, do not forward. A sixth, distinctly-named `SkipReason`-shaped outcome, following the discriminated-union discipline Phase 2 already established — never a bare `undefined` collapsing this into another reason. *(Built as `incomplete-envelope`, one of four new reasons `envelope-pipeline.service.ts`'s `EnvelopeSkipReason` adds on top of Phase 2's five.)*
- [x] **Envelope ajv schema enforcement**, shared verbatim with `ppa-stub` — the schema file already exists and `ppa-stub` already validates against it (Phase 1); this item is wiring the same validation (or trusting it structurally by construction) on the MLA side too, so a malformed envelope is caught before the network call, not only after. *(`src/services/envelope-schema-validator.service.ts`, called after `buildEnvelope` as a defensive backstop.)*
- [x] **Real cryptographic JWS verification** — RS256/384/512, against the sending DFSP's registered public key, on every canonical record, no exemptions (core-knowledge.md §3.3 — there is no genuinely switch-generated event on this topic to exempt). **Read §8's first trap before starting this item** — there is a real, concrete open question about whether the bytes available to verify against are the bytes that were actually signed. *(`src/services/jws-verification.service.ts`, Node's built-in `crypto.verify` — see its module comment for the byte-exactness investigation done while building it, summarised in §8's updated first bullet below.)*
- [x] **Configurable key store**; adding a DFSP key must not require a restart. *(`src/clients/public-key-store.client.ts` — file-backed, `fs.watch`-driven hot reload.)*
- [x] **A key-source outage must be distinguishable from a genuine signature failure.** Otherwise an outage manifests as "every event has an invalid signature" (US-MLA-05's own named failure mode) — a distinct failure classification, not a shared one (engineering-rules.md §6.1's four-way split: this is Transient, a signature failure is Permanent). *(Built — `PublicKeyLookupResult`'s three-way outcome, surfaced as the distinct `key-source-unavailable` skip reason, logged without the `SECURITY` marker.)*
- [x] **Missing / invalid signature ⇒ security log, alert, advance the offset.** Not retried — same shape as Phase 2's `unreadable` path, one layer further in. *(Logging was wired in this phase — `SECURITY`-marked error log, offset advances unconditionally — and this box was left unchecked pending a real alert channel. **Closed [2026-09-08]:** Phase 6's fourth checklist item built one, and `logEnvelopeSkip`'s `missing-signature`/`invalid-signature` cases now raise `alert.raiseSecurityAlert` alongside the same log line, live-verified against the real harness. The last clause of this item is no longer interim — see `plan.md` §9 and §16's US-MON-01 entry.)*

**What's left before the exit criterion below can be attempted:** unit tests for every file named above, `tools/dfsp-keys` (local keypair generation) plus a `capture-feeder` `--resign`/`--tamper-body` scenario, then the live run itself.

**On the missing keys** (`environment-simulation.md` §4, `plan.md` §13.1): build and verify the mechanism against **locally re-signed fixtures** — take real capture bodies, sign them with a generated keypair, register that key, verify. This proves the verifier is correct. **Genuine verification against a real COMESA/DFSP signature stays blocked** (`plan.md` §14 Q1 — the highest-value open question to put to COMESA) and the phase's status must say so plainly rather than imply full coverage. No JWS library or verification code exists anywhere to port forward — the POC only ever checked *header presence*, never performed real cryptographic verification (`plan.md` §12 V7) — so this is genuinely new work, not an adaptation of anything already live-verified.

---

## 5. The harness, as it stands

Everything Phase 2 needed still applies; Phase 3 additionally needs `ppa-stub`, which Phase 2 correctly left alone:

```bash
cd cch-mla
npm run harness:up             # Redpanda up, topic-event-audit at 12 partitions
npm run certs:generate         # local CA + server + client certs, if not already generated
npm run ppa-stub                # in one terminal - mTLS business endpoints + plain-HTTP control/health
npm run feeder -- --file __tests__/fixtures/DRPP_Kafka_E2E_Pack/raw_topic_slice_partition2.json
```

Certs already exist under `tools/ppa-stub/certs/` on this machine from Phase 1's own live verification — `npm run certs:generate` is idempotent if they're stale or missing, not a first-time-only step.

`tools/golden`'s two mechanisms are both relevant now, for different halves of this phase: `run-golden.ts` still only proves topic fidelity (unrelated to envelopes) and needs no changes; `run-ingestion-golden.ts` (built during Phase 2's closeout) proves Phase 2's own decisions are stable and is a template — not a requirement — for the kind of decision-level golden this phase's envelope output would deserve once it exists (e.g. diffing `ppa-stub`'s own JSONL against a checked-in golden, which is exactly the extension `EPICS/PHASE-1-Harness/executive-summary.md` already named as the natural next step once a real envelope builder exists).

**One machine-specific note, carried forward again:** the snap-packaged `docker compose` (space) plugin fails silently when run from a process tree rooted in the VS Code snap — including every command Claude Code's Bash tool runs. Use the standalone `docker-compose` (hyphen) binary instead; `tools/README.md` §1 has the one-line install. A plain terminal shell, not spawned under VS Code, is unaffected. This machine already has the standalone binary installed at `~/.local/bin/docker-compose` as of this session.

---

## 6. The exit criterion — read this before calling anything done

From [`plan.md`](../plan.md) §6, verbatim:

> Every record in the partition-2 slice produces a schema-valid envelope accepted by `ppa-stub`, or is rejected for a stated reason. A locally re-signed record verifies; the same record with a tampered body fails and raises the security alert; a stripped signature fails distinctly from an unreachable key source.

Concretely:

```
npm run harness:up
npm run ppa-stub
npm run feeder -- --file __tests__/fixtures/DRPP_Kafka_E2E_Pack/raw_topic_slice_partition2.json
# start the MLA against the real topic; confirm every one of the 41 records
# either produces a schema-valid envelope that ppa-stub accepts (200), or is
# rejected with a named, distinct reason (incomplete envelope / missing
# signature / invalid signature / key-source outage)
# separately: take a locally re-signed fixture, confirm it verifies; tamper
# its body and confirm verification fails and raises the security alert;
# strip its signature and confirm that fails distinctly from simulating an
# unreachable key source
```

**When this is genuinely done:**

1. Add the corresponding entries to [`plan.md`](../plan.md) §16 — one per story (US-MLA-04, US-MLA-05) — what was built, what was verified live versus assumed, what diverged, what is left open. State D3's resolution plainly, whichever way it lands, rather than letting it stay implicit in the code.
2. Write `docs - MLA/EPICS/EPIC-2-envelope-construction-jws-validation/US-MLA-04/` and `.../US-MLA-05/` — each its own `executive-summary.md` and `file-register.md` — plus the epic-level rollup once both stories close, per `CLAUDE.md`'s "Epic and story documentation" rule.
3. Run the staleness sweep `CLAUDE.md`'s documentation register requires — `strategy.md` §1, `plan.md` §1's status table, and `cch-mla/README.md`'s status section all currently say Phase 3 is next; that stops being true the moment this phase's exit criterion is met.
4. Leave it all in the working tree for the user to commit — `CLAUDE.md`'s "Commits" rule.
5. Move to [`plan.md`](../plan.md) §7, Phase 4 — PII tokenization (US-PII-01/02).

---

## 7. What comes immediately after

- **Phase 4** (PII) tokenizes the envelope's `body` this phase builds — and it has a hard ordering dependency on this phase specifically: JWS validation must run before tokenization, always, because the DFSP signed the event as originally sent (core-knowledge.md §3.2). This phase's own JWS step is literally the thing Phase 4 must never be reordered ahead of.
- **Phase 5** (delivery, offsets, resilience) is what actually POSTs this phase's envelope to PPA and gates the offset on the response — this phase stops at "schema-valid envelope, `ppa-stub` accepts it," not at a durable delivery guarantee.
- **D3 is resolved (Option A, per-`eventType`) and is also PPA's problem now** — `plan.md` §3.1 names `US-PPA-04`/`US-PPA-06` as directly built on this scheme. PPA's own session/team should build against it as settled, not re-open it.

---

## 8. Traps worth knowing before you start

- **The most consequential open question in this phase, found while preparing this handoff, not yet investigated: does re-serializing `content.payload`/`content.transformedPayload` reproduce the exact bytes the DFSP actually signed?** A real captured record's `content.payload` is stored as an *already-parsed* JSON object (confirmed directly against `__tests__/fixtures/DRPP_Kafka_E2E_Pack/01_MWK_to_ZMW_PRIMARY/raw_messages.json` — `typeof content.payload === 'object'`, not a string), not the original raw request bytes. RS256/384/512 JWS verification is byte-exact — any difference in key order or whitespace from a `JSON.stringify` round trip will fail verification even against the correct key and an untampered body. Core-knowledge.md's own Open Item #3 ("does the `FSPIOP-Signature` header survive the DFSP → switch → Kafka chain") is adjacent to this but not the same question — the header surviving as a string is already confirmed (286 of 500 real records carry it, per `plan.md` §1.1); whether the *body bytes* it was computed over are still reconstructable is not. **Check this first, empirically, against the 286 real signed records already in hand, before writing the verifier** — it determines whether `audit-record-parser.service.ts` needs to be extended to preserve a raw substring specifically for signature verification, or whether the parsed form is already sufficient.
- **"Validate before classify" versus "classify before validate" is not actually ambiguous for this codebase, even though core-knowledge.md §3.2 flags it as undecided between the two source documents.** Phase 2 already classifies every record before Phase 3 ever runs — that phase boundary already resolved the question in practice; do not re-litigate it as if this phase had a real choice to make.
- **D3 is resolved** — Option A, per-`eventType`, agreed directly with PPA's owners (§3 above). Build and document against it as settled.
- **No JWS library is installed yet** (`package.json` currently has none of `jose`, `jsonwebtoken`, or similar) **and there is no POC precedent to port** — the POC never performed real cryptographic verification. Node's built-in `crypto` module can verify RS256/384/512 directly with no dependency; a dedicated JWS/JOSE library trades a dependency for RFC 7515 compact-serialization handling. This is a real implementation choice for this phase, not a carried-forward decision.
- **`ppa-stub`'s mTLS is genuinely enforced** (Phase 1, live-verified) — a request with no client certificate fails at the TLS layer itself, before the route handler runs. Budget for real cert plumbing when wiring MLA's own delivery client against it, even though actual delivery is Phase 5's job, not this phase's.

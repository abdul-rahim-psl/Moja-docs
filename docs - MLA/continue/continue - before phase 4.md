<!-- SPDX-License-Identifier: Apache-2.0 -->

# Continue — Before Phase 4 <!-- omit in toc -->

**What this document is.** A session handoff. It marks the point where Phase 3's envelope construction and JWS validation are complete and **Phase 4's PII tokenization** ([`plan.md`](../plan.md) §7) is the next work. Read this in full before touching anything; it is short by design.

**When this is superseded.** The moment Phase 4's exit criterion is met and the corresponding `docs - MLA/plan.md` §16 progress-log entries land, this document's "what's next" job is done. It stays as the record of where things stood; a later `continue -` doc (Phase 5's, most likely) takes over for what's next.

- [1. Sixty-second orientation](#1-sixty-second-orientation)
- [2. What is already decided — do not re-litigate](#2-what-is-already-decided--do-not-re-litigate)
- [3. What is NOT yet decided — raise these, do not guess](#3-what-is-not-yet-decided--raise-these-do-not-guess)
- [4. The Phase 4 checklist](#4-the-phase-4-checklist)
- [5. The harness, as it stands](#5-the-harness-as-it-stands)
- [6. The exit criterion — read this before calling anything done](#6-the-exit-criterion--read-this-before-calling-anything-done)
- [7. What comes immediately after](#7-what-comes-immediately-after)
- [8. Traps worth knowing before you start](#8-traps-worth-knowing-before-you-start)

---

## 1. Sixty-second orientation

Phase 3 closed live on 2026-09-03 — [`plan.md`](../plan.md) §16's US-MLA-04/US-MLA-05 entries, and [`docs - MLA/EPICS/EPIC-2-envelope-construction-jws-validation/`](../EPICS/EPIC-2-envelope-construction-jws-validation/) for the full writeup. What exists now, on top of Phase 2's ingestion pipeline: real envelope construction (`src/services/envelope-builder.service.ts`) and real RS256/384/512 JWS verification (`src/services/jws-verification.service.ts`, `src/clients/public-key-store.client.ts`), composed by `src/services/envelope-pipeline.service.ts`'s `buildEnvelopeFromKafkaValue` into the pipeline core-knowledge.md §3.2 describes through step 5 (JWS) and step 7 (envelope) — step 6, PII tokenization, is the one gap this phase fills. Every record in the partition-2 slice, live, either produces a schema-valid `EventEnvelope` a real `ppa-stub` accepts over mTLS, or is rejected for a distinct, correctly-classified reason.

**Nothing tokenizes PII yet, and no PPA delivery client exists.** `buildEnvelope`'s `body` field is the FSPIOP-form payload exactly as selected in Phase 2 — MSISDNs and legal names still travel in cleartext through envelope construction and (in the one-shot verification POST proven live for Phase 3's own exit criterion) into `ppa-stub`. Phase 4 (US-PII-01, US-PII-02) is what protects that data before it ever reaches PPA. Phase 5 (delivery, offsets, resilience) is separate and still not started — Phase 4 does not need it, and should not be blocked waiting for it.

Read in this order:

1. [`cch-mla/CLAUDE.md`](../../../cch-mla/CLAUDE.md) — if this is a new session.
2. [`../strategy.md`](../strategy.md) — the map. Follow its routing table; do not read the whole knowledge base. For this phase: **"Implementing PII tokenization"** → `core-knowledge.md` §4 + §3.2 (ordering) → `cch-pii-user-stories.md` in full → `engineering-rules.md` §8.
3. [`../knowledge-base-stories/core-knowledge.md`](../knowledge-base-stories/core-knowledge.md) §4 in full (the fields-to-tokenize table, token construction, and the consequences worth holding in mind — secret rotation, the forensic audit topic predating tokenization, the ILP exemption's cryptographic rationale) and §3.2's processing-order diagram (step 6 sits strictly after step 5, which this phase inherits already built and already enforced by `envelope-pipeline.service.ts`'s own composition order).
4. **This document** — where things stand right now, specifically.
5. [`../plan.md`](../plan.md) §7 — the actual Phase 4 checklist, which this document walks through but does not replace. §13.1 for the PII fail-mode decision this phase cannot close alone.

---

## 2. What is already decided — do not re-litigate

- **The ordering constraint is inherited, already built, and already tested — this phase does not re-prove it, only respects it.** `envelope-pipeline.service.ts`'s `buildEnvelopeFromKafkaValue` calls `verifyJws` before `buildEnvelope`; tokenization's own step (core-knowledge.md §3.2, step 6) sits between those two. Insert tokenization *after* the `verifyJws` call and *before* the `buildEnvelope` call — never reorder either of those two calls to make room for it.
- **What gets tokenized is settled** (core-knowledge.md §4.1): payer/payee MSISDN and payer legal name in QUOTE and FXQUOTE bodies — plain JSON, no ILP packet. **What does not** is equally settled: any MSISDN or name inside a *decoded ILP packet* (cryptographically bound into `condition`; rewriting it breaks the transfer) and every transaction amount, in any message, at any stage (Tazama's threshold/velocity rules need them in clear).
- **This is MLA-side payload transformation, not PPA-side log masking, and the two are not the same feature.** The POC's `pii-mask.service.ts` masks what reaches *logs and the audit store*, on the *PPA* side, and leaves the payload sent onward untouched by design. This phase transforms the payload itself, inside the MLA, before it ever leaves the Mojaloop boundary. There is no POC precedent to port for what this phase actually builds.
- **Token construction is keyed hashing, deterministic, with a recognizable prefix** — never a bare unkeyed hash (the MSISDN space is small enough to enumerate and match without one).
- **The secret is loaded once at startup, never fetched per event, and its absence must fail readiness, not run unprotected while reporting healthy** — the same pattern this codebase already applies to the public-key store's own failure mode (Phase 3), extended here to gate `/health/ready` specifically, which Phase 3's JWS work deliberately did not do (its own checklist never asked for it).

---

## 3. What is NOT yet decided — raise these, do not guess

Per [`plan.md`](../plan.md) §7's own "Open before go-live" and §13.1:

- **The fail-mode decision: block the event, or pass it through unprotected, if tokenization itself fails?** This is explicitly a CCH decision, not an engineering call. It is also the one decision that changes what this phase's own exit criterion can honestly claim: if the answer is "pass through," a tokenization-failure-rate metric (already required regardless) becomes the *only* signal that PII is reaching PPA unprotected, and that fact should be stated plainly in whatever this phase's own `plan.md` §16 entry says, not left implicit.
- **Secret rotation strategy is undecided** (core-knowledge.md §4.3): rotating the secret changes every token produced afterward for the same input, and anything already correlated under the old secret — in-flight cached state, a parked entry awaiting a late event — stops matching. Version old-and-new, or drain in-flight correlation first? Neither is chosen. This does not block building the tokenizer itself (which needs exactly one active secret at a time), but it does mean rotation is not this phase's to implement end-to-end — flag it rather than silently picking one shape.
- **What "protected" must mean legally** (Zambia Data Protection Act applicability, FSD Open Item #6) and **named ownership of the production secret** are both CCH Legal / CCH questions, not engineering ones. Neither blocks the mechanism being built and live-verified against a locally-generated secret, the same posture Phase 3 took toward genuine DFSP keys.

**The action this handoff exists to name plainly: raise the fail-mode decision with CCH now, in parallel with building the mechanism**, exactly the way Phase 3 raised D3 while building against its own recommended default. Building the tokenizer, the ordering test, and the failure-rate metric does not require the fail-mode answer yet; only the final wiring decision (does a tokenization failure advance the offset and forward a degraded envelope, or skip and alert) needs it, and that should stay visibly provisional until CCH answers, not silently resolved one way.

---

## 4. The Phase 4 checklist

This is [`plan.md`](../plan.md) §7, US-PII-01 and US-PII-02. **Built, tested, and live-verified against the fail-closed default — see `plan.md` §7 for the annotated checklist and the exit criterion's live evidence.** Not yet formally closed: the fail-mode wiring stays provisional until CCH answers (§7.1 #1 there), so no `plan.md` §16 entry or `EPICS/EPIC-PII-tokenization/` write-up exists yet.

- [x] **Field classification per the Fields-to-Tokenize table, per event type** (core-knowledge.md §4.1). QUOTE and FXQUOTE bodies only — TRANSFER/FXTRANSFER bodies carry PII exclusively inside the ILP packet, which is exempt (below), so there is nothing to tokenize in those two event types' bodies at all; **confirmed against real captures, not assumed**: zero `partyIdInfo`/`personalInfo` fields in any real `prepareTransfer`/`prepareFxTransfer` body checked, and zero `partyIdInfo` in any of 96 real FXQUOTE records.
- [x] **ILP-carried fields explicitly exempt.** The exemption is the *whole* decoded ILP packet, not a per-field allowlist inside it — cryptographically bound into `condition`; rewriting any of it breaks the transfer. No ILP decoder was built — `tokenization.service.ts`'s field table is a structural allowlist, so `putQuotesByID`'s own `ilpPacket` field (confirmed present on a real QUOTE-classified record) is never touched without needing to know it exists.
- [x] **Transaction amounts never tokenized, in any message.** A regression case, not just a positive one: proven structurally (amounts are never in the allowlist) and by test, per event type, plus live (amount reached `ppa-stub` unchanged).
- [x] **Keyed hashing (never a bare hash), deterministic, with a recognizable token prefix.** HMAC-SHA256, `tkn_` prefix. Live-verified deterministic across two independent process runs.
- [x] **Secret loaded once at startup from a mounted location; readiness reflects load success.** Mirrors the public-key store's own startup-load pattern (Phase 3) but, unlike that store, actually gates `/health/ready` — live-verified both directions (secret missing → `piiSecret: DOWN`, overall `status: DOWN`; secret present → `UP`).
- [x] **The ordering test:** a test that fails if tokenization is moved ahead of signature validation. Written against the real composed pipeline (`envelope-pipeline.service.ts`) as a two-sided proof, not a hand-rolled call sequence — live-verified via a real broker-driven `Forwarded QUOTE`.
- [~] **Tokenization-failure metric and alert, distinct from any other failure counter** — named explicitly in `plan.md` §7 because, per the open fail-mode question above, this may end up being the *only* visible signal that PII reached PPA unprotected. **Built only as an interim structured log line** (same posture as Phase 3's own `SECURITY` logs) — no dedicated metric or wired alert exists; that is Phase 6.

**Exit criterion — live. Met**, against the fail-closed default. See `plan.md` §7's own exit-criterion paragraph for the full live evidence (a real broker-driven `Forwarded QUOTE`, plus `tools/verify-tokenization/run.ts` proving tokens/determinism/clear-amount/untouched-TRANSFER over real mTLS against a real `ppa-stub`).

---

## 5. The harness, as it stands

Unchanged from Phase 3 — nothing about this phase requires new harness tooling, only new services on top of what already runs:

```bash
cd cch-mla
npm run harness:up             # Redpanda up, topic-event-audit at 12 partitions (may already be running - check docker ps first)
npm run certs:generate         # local CA + server + client certs, if not already generated
npm run keys:generate -- <dfspId>   # a local RSA keypair for JWS, if not already generated (Phase 3)
npm run ppa-stub                # in one terminal - mTLS business endpoints + plain-HTTP control/health
npm run feeder -- --file __tests__/fixtures/DRPP_Kafka_E2E_Pack/raw_topic_slice_partition2.json
```

The one-machine-specific note carried forward again: the snap-packaged `docker compose` (space) plugin and even plain `docker exec`/`docker ps --format` can fail silently or return nothing when run from this environment's process tree — confirmed again during Phase 3's own live verification (`docker exec` returned exit 1 with zero output on a trivial `echo`). The standalone `docker-compose` (hyphen) binary at `~/.local/bin/docker-compose` is unaffected and is what actually starts/stops the harness; prefer host-side scripts (`capture-feeder`, `tools/golden`) that connect to the broker's exposed port over any `docker exec` for anything that needs to inspect the running container.

---

## 6. The exit criterion — read this before calling anything done

From [`plan.md`](../plan.md) §7, verbatim:

> A real capture record flows through the full pipeline; the envelope reaching `ppa-stub` carries prefixed tokens in every listed field, cleartext in every ILP-carried and amount field, and the same input produces the same token across runs. Reordering the pipeline breaks the suite.

Concretely, extending Phase 3's own live-verification pattern:

```
npm run harness:up
npm run ppa-stub
npm run feeder -- --file __tests__/fixtures/DRPP_Kafka_E2E_Pack/raw_topic_slice_partition2.json
# start the MLA against the real topic; for a forwarded QUOTE/FXQUOTE record,
# confirm the envelope ppa-stub received carries a recognizably-prefixed
# token in place of the MSISDN/name fields, the same token for the same
# input on a repeat feed, and the amount field untouched
# separately: confirm a TRANSFER/FXTRANSFER record's body is unaffected by
# this phase entirely (no ILP-carried field is ever touched)
# separately: run the ordering test and confirm it genuinely fails if
# tokenization is moved ahead of verifyJws in envelope-pipeline.service.ts
```

**When this is genuinely done:**

1. Add the corresponding entries to [`plan.md`](../plan.md) §16 — one per story (US-PII-01, US-PII-02) — what was built, what was verified live versus assumed, what diverged, what is left open. State the fail-mode decision's status plainly, whichever way it lands or if it is still open when this phase closes.
2. Write `docs - MLA/EPICS/EPIC-PII-tokenization/US-PII-01/` and `.../US-PII-02/` — each its own `executive-summary.md` and `file-register.md` — plus the epic-level rollup once both stories close, per `CLAUDE.md`'s "Epic and story documentation" rule.
3. Run the staleness sweep `CLAUDE.md`'s documentation register requires — `strategy.md` §1, `plan.md` §1's status table, and `cch-mla/README.md`'s status section all currently say Phase 4 is next; that stops being true the moment this phase's exit criterion is met.
4. Leave it all in the working tree for the user to commit — `CLAUDE.md`'s "Commits" rule.
5. Move to [`plan.md`](../plan.md) §8, Phase 5 — delivery, offsets, and resilience (US-MLA-06/07).

---

## 7. What comes immediately after

- **Phase 5** (delivery, offsets, resilience) is what actually builds a production PPA delivery client and gates the Kafka offset on its HTTP response — Phase 3's own mTLS POST to `ppa-stub` was a one-shot live-verification call built for that phase's exit criterion, not this client. Phase 4's tokenized envelope is exactly what that client will send.
- **The tokenization-failure metric this phase builds is Phase 6's first real consumer** — observability work (Phase 6) wires metrics and alerting properly; this phase only needs to emit the signal, not route it anywhere production-grade yet, the same interim posture Phase 3 took toward its own `SECURITY`-marked logs.
- **The fail-mode decision, whichever way it lands, changes Phase 6's own alerting priority** — if PII can pass through unprotected on tokenization failure, that failure-rate metric moves from "nice to have" to "the only signal that exists," and Phase 6 should build its alerting with that in mind rather than discovering it late.

---

## 8. Traps worth knowing before you start

- **Do not build an ILP decoder for this phase.** The exemption is total — nothing inside a decoded ILP packet is tokenized — which means this phase needs to *recognize* that a body carries an ILP packet (TRANSFER/FXTRANSFER), not decode one. `payload-selection.service.ts`'s existing `selectPayload` already returns the FSPIOP form without decoding `dataUri`; this phase's field classification should key off `eventType`/the body's own shape, never off decoding something D6 deliberately left available-on-demand.
- **The ordering test must exercise the real composed pipeline, not a mock of it.** `engineering-rules.md`'s own testing standard (§10.2) requires a test that fails if the two steps are reordered — write it against `envelope-pipeline.service.ts`'s actual function, so a future edit that accidentally swaps the call order is caught by running the suite, not by a reviewer reading the diff carefully.
- **Readiness coupling is new, not a copy-paste of the public-key store's pattern.** Phase 3's `FilePublicKeyStoreClient` deliberately does *not* gate `/health/ready` — nothing in US-MLA-05's checklist asked for it, and JWS verification failing per-record is not the same class of problem as "the whole service should not be in rotation." PII's secret is different: US-PII-01/02 explicitly requires readiness to reflect secret-load success, so `health.service.ts` needs a genuinely new signal, not a re-use of the Kafka-connected/disabled shape it already has.
- **A hand-written "PII fixture" is exactly the kind of fixture `engineering-rules.md` §10.3 warns against.** Real captures already contain real (test) MSISDNs and names in `postQuotes`/`postFxQuotes` bodies — use those directly, the same way every other phase's tests have, rather than inventing a synthetic body shape for this phase alone.

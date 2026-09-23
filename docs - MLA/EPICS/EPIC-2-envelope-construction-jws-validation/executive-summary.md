# EPIC-2 — Envelope Construction & JWS Validation: Executive Summary

**Phase:** 3 (`plan.md` §6)
**Status:** complete — exit criterion met live, recorded in `plan.md` §16
**Date:** 2026-09-03

---

## What this epic delivered, as a whole

Its two stories — US-MLA-04 (build the `EventEnvelope`) and US-MLA-05 (verify the DFSP's JWS signature) — are documented individually in their own folders. This document covers what only exists once both are assembled: a real, live-verified pipeline that takes Phase 2's own output (a resolved `eventType`, a selected body) and produces either a schema-valid, cryptographically-authenticated envelope PPA can receive, or a named, correctly-classified reason it cannot. This is the phase whose exit criterion first produces something PPA can actually be handed.

## The purpose

**To turn two independently-correct pieces — a signature check, and an envelope assembler — into one pipeline where the ordering between them is enforced by the code's own structure, not by convention, and to close the one cross-team decision (D3) that had been left open since before Phase 0.**

`src/services/envelope-pipeline.service.ts`'s `buildEnvelopeFromKafkaValue` composes Phase 2's `processRecord` with `verifyJws` and `buildEnvelope`, in that order — matching core-knowledge.md §3.2's own diagram, where JWS validation (step 5) precedes envelope construction (step 7). This is not an arbitrary implementation choice: validating a signature against an already-tokenized or already-transformed payload fails every time, and while Phase 4's tokenization does not exist yet, the pipeline's own shape is already the one Phase 4 must never be reordered ahead of.

## The reasoning behind the decisions that were not obvious

**D3 was resolved during this phase, not before it, and the code says so plainly rather than pretending it was always settled.** Every piece of this epic that touches `id` was built against the recommended default (Option A) while the cross-team conversation with PPA's owners was still open, with the provisional status stated directly in `envelope-builder.service.ts`'s own comments and in `plan.md`/`continue - before phase 3.md`. Once PPA's owners agreed, those same comments and the plan documents were updated in place — the code did not have to change, because the recommendation and the final decision were the same scheme, but the *certainty* the documents claim did change, and that distinction is worth preserving rather than collapsing into "we always knew this."

**Neither story could close by unit test alone, and the two needed different kinds of live proof.** US-MLA-04's claim ("PPA can receive this") is only real if an independent second implementation of the schema (`ppa-stub`) agrees the envelope is valid — proven by an actual mTLS POST and a `200`, not by re-running the same ajv instance against itself. US-MLA-05's claim ("this signature is genuinely verified") is only real against genuinely generated cryptographic material — proven by generating a real RSA keypair and observing `crypto.verify` accept and reject correctly, not by asserting a mocked verifier returns what the test expects.

**The pipeline extends Phase 2's `SkipReason` rather than editing it.** `ingestion.service.ts`'s own comment is explicit that its five reasons are "five, and only five" for that phase's scope; this epic's four new reasons (`missing-signature`, `invalid-signature`, `key-source-unavailable`, `incomplete-envelope`, plus a defensive `invalid-envelope-schema`) live in a superset type at this epic's own layer, so Phase 2's already-closed contract and its own tests are never touched by work two phases removed from it.

## What was proven live, versus assumed

Every claim in this epic's two `plan.md` §16 entries was exercised against a real, running Redpanda and a real, running `ppa-stub`, not asserted from the design. The baseline run — all 41 records of the partition-2 slice, unmodified, through a real MLA instance — produced a defined, correctly-classified outcome for every record with zero unhandled exceptions (23 `egress`, 3 `party-lookup`, 15 `SECURITY: invalid FSPIOP-Signature` — the last expected, since no real DFSP key is held). On top of that baseline, four further live runs each isolated one exit-criterion clause: a re-signed record verifying and being accepted by `ppa-stub` over real mTLS; the same record tampered afterward failing distinctly; a stripped signature failing distinctly from an invalid one; and a simulated key-source outage failing distinctly from both. Full numbers and exact log lines: `plan.md` §16's US-MLA-04/US-MLA-05 entries.

## What was deliberately left out

No delivery to PPA as MLA's own production behaviour — Phase 5 (US-MLA-06/07) owns the retry/circuit-breaker/offset-gated client; this epic's own mTLS proof was a one-shot verification call, not that client. No PII tokenization — Phase 4, and this epic's own JWS-before-envelope ordering is exactly the constraint Phase 4 must respect. No genuine verification against a real COMESA/DFSP signature — stays blocked pending real keys, stated plainly rather than implied covered by the mechanism being proven correct against fixtures this codebase signs itself.

## What this exposed that outlives it

**A tag-availability table verified by counting occurrences alone, without checking which half of a double-written record actually carries the count, reads as more settled than it is.** `plan.md` §3.2's own evidence for D3 was directionally right — every canonical record does carry a usable identifier — but its literal claim about *which* half of `putFxQuotesByID` carried the tag was backwards, caught only by building the extraction logic against the real fixture rather than trusting the aggregate count. The fix generalises: an aggregate count over a topic with a confirmed double-write pattern (§2.2) is a different claim from "present on the record a specific downstream stage selects," and the two should be checked separately whenever a decision leans on the first to imply the second.

## Subsequently removed from scope [2026-09-23]

MLA's JWS validation — this story's deliverable — was removed from the implementation on 2026-09-23, on `cch-mla` branch `paysys-remove-JWS`. The Mojaloop Foundation confirmed on 2026-09-21 that nothing reaches `topic-event-audit` without the switch having already validated its signature, and that the topic sits inside the same trust boundary as MLA's consumer, so a second validation in MLA guards nothing the switch does not. The removal is built and live-verified; **removing US-MLA-05 from scope still needs the story author's sign-off**, and retiring `engineering-rules.md` N3 needs the rules owner's and CCH's. Reasoning and inventory: `e2e-testing/remove-JWS.md`; what was verified: `plan.md` §16's [2026-09-23] entry. This epic's folder name is unchanged so existing cross-references stay valid.

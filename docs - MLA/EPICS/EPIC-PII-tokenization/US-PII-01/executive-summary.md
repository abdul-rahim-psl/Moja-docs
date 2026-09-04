# US-PII-01 — Classify and Tokenize Party Identity Fields Within MLA: Executive Summary

**Epic:** EPIC-PII — PII Tokenization
**Status:** mechanism built, tested, and live-verified — **not formally closed**. `plan.md` §13.1: "PII fail-mode undecided → Phase 4 cannot be called complete." That is a CCH decision, not an engineering one, and it is still open. See "What is deliberately not closed, and why" below.
**Date:** 2026-09-04

---

## What this story set out to achieve

Tokenize party identity fields — payer/payee MSISDN, payer legal name — inside MLA's own processing, before the event is packaged into an envelope, so PPA and everything downstream never sees raw PII. No POC precedent existed to port: the POC's `pii-mask.service.ts` masks what reaches *logs*, on the *PPA* side, and leaves the payload sent onward untouched by design. This story transforms the payload itself, inside MLA, before it ever leaves the Mojaloop boundary — a different feature with the same name-shaped neighbour, not an adaptation of one.

## The reasoning behind the decisions that were not obvious

**Field classification is an explicit allowlist of paths, never a blocklist.** `TOKENIZE_PATHS_BY_EVENT_TYPE` names exactly which paths get touched per event type; a path not named — an amount, `condition`, `ilpPacket` — is structurally unreachable by the walker. This is what makes "transaction amounts are never tokenized" true by construction rather than by a check that could itself be wrong, and it is why `putQuotesByID`'s own `ilpPacket` field (confirmed present on a real QUOTE-classified capture — a fact worth naming, since QUOTE is not the event type the ILP exemption's own prose is framed around) never needed a special case: the walker was never told about it, so it was never at risk.

**TRANSFER and FXTRANSFER carry no table row at all — confirmed against real captures, not assumed, per the continue-doc's own explicit instruction to check this rather than take it on faith.** Every `prepareTransfer`/`prepareFxTransfer` `start` record examined directly carries only FSP ids, amounts, `condition`, and the undecoded `ilpPacket` — never a `partyIdInfo` or `personalInfo` field. Every PII field for these two event types lives inside the *decoded* ILP packet, which this pipeline has never decoded (D6) and does not start decoding now — building a decoder to service one field-classification edge case would be exactly the speculative abstraction `engineering-rules.md` §4 rules out.

**FXQUOTE's "where present" hedge in the story text is, empirically, never present.** Checked directly against all 96 FXQUOTE records (`postFxQuotes`/`putFxQuotesByID`, both legs) across `raw_export_500.json` — zero carry a `partyIdInfo` field. The code still handles the case generically rather than removing it, because the cost of keeping it is zero (an absent path is never treated as a failure) and the empirical finding is a fact about the capture window, not a guarantee about every future one.

**Payee legal name is deliberately not tokenized, and this is stated rather than left to look like an oversight.** The real `postQuotes` body carries `payee.personalInfo.complexName` alongside the payer's, but `core-knowledge.md` §4.1's table lists only "Payer legal name." Built to the table exactly, not to the more visually symmetric choice a reader might expect.

**A structured value (`complexName`, an object) is tokenized as one unit, not field-by-field**, because the Fields-to-Tokenize table names `personalInfo.complexName` itself as the field, not its sub-fields individually. Serializing it before hashing carries the same key-order caveat `jws-verification.service.ts` already documents and accepts for its own `JSON.stringify(body)` use — the same class of risk, met with the same posture, not a new one invented for this story.

## What was proven live, versus assumed

A `postQuotes` record, re-signed against a locally generated keypair, fed onto the real harness broker and consumed by a genuinely running MLA instance produced `Forwarded QUOTE` in its live log — the real, Kafka-driven pipeline, not a direct function call in a test process, exercising classification, JWS verification, and tokenization together in the correct order. Separately, a new checked-in tool (`tools/verify-tokenization/run.ts`) drove the same real pipeline function against real captures and posted the resulting envelopes over genuine mTLS to a real `ppa-stub`: `tkn_`-prefixed tokens confirmed in every listed QUOTE field and recorded in `received.jsonl`, the identical token produced on a second, fully independent process run (secret file re-read from disk, not carried in memory), the amount reaching `ppa-stub` unchanged, and a real TRANSFER record's body reaching `ppa-stub` with zero fields altered.

## What is deliberately not closed, and why

**The fail-mode decision — block the event or pass it through unprotected if tokenization fails — is CCH's to make, and it is still open.** Everything above was built and live-verified against the recommended fail-closed default: a `pii-secret-unavailable` outcome skips the event, logs it, and never forwards raw PII. This is a real, working, tested branch — not a placeholder — but `plan.md` §13.1 names this decision, specifically, as the one thing that gates calling this story complete, and no amount of further engineering closes it. `plan.md` §16's own entry for this story carries a `Left open` field that will only be resolved by a later entry, once CCH answers — not by editing this one.

## What this exposed that outlives it

**Two genuinely dead defensive branches were found and removed while building this story — not left in "just in case."** `pii-secret.client.ts`'s original two-field design (`secret`/`loadError`) needed a fallback for a state the constructor's own control flow could never produce; storing the already-resolved lookup result as one value instead removed the branch entirely rather than writing a test to force it. The same finding, once made, generalised: five pre-existing `?? 'unknown reason'` fallbacks in `ingestion-consumer.service.ts` (Phase 3's own code) were provably dead by the same reasoning — every skip reason that interpolates `detail` is always populated by its own construction site — and were removed alongside this story's new one, for consistency, with the evidence cited in the same commit rather than left as five untouched instances beside one cleaned-up sixth.

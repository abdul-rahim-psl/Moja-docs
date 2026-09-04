# EPIC-PII — PII Tokenization: Executive Summary

**Phase:** 4 (`plan.md` §7)
**Status:** mechanism built, tested, and live-verified — **not formally closed**. Both stories' own `plan.md` §16 entries and executive summaries carry the same status for the same reason: `plan.md` §13.1 — "PII fail-mode undecided → Phase 4 cannot be called complete" — is a CCH decision, still open. This document is written now, ahead of that closure, at the user's explicit direction, precisely so the epic's real state is tracked rather than left invisible until a decision that is not engineering's to make finally lands.
**Date:** 2026-09-04

---

## What this epic delivered, as a whole

Its two stories — US-PII-01 (classify and tokenize the party-identity fields) and US-PII-02 (the keyed-hash construction and secret handling) — are documented individually in their own folders. This document covers what only exists once both are assembled: a real, live-verified pipeline stage that sits exactly where `core-knowledge.md` §3.2 puts it — strictly after JWS validation, strictly before envelope construction — and that turns a genuine capture record's payer/payee MSISDN and payer legal name into deterministic, keyed-hash tokens before the envelope ever leaves MLA, while leaving amounts and every ILP-carried field in clear. This is the phase that closes the last gap in the original design intent: PPA and everything downstream have never seen raw PII in this codebase's own pipeline, and now neither has anything captured by `topic-event-audit` after this step runs.

## The purpose

**To insert one new, ordering-critical pipeline step into an already-live pipeline without disturbing the ordering guarantee Phase 3 already built and tested — and to do so honestly, including about what building it does and does not settle.**

`tokenizeBody` sits in `envelope-pipeline.service.ts` between the existing `verifyJws` and `buildEnvelope` calls, and the ordering constraint between JWS validation and tokenization (N3: "validate the JWS signature before mutating the payload") is enforced by a two-sided test proof, not by convention: a genuinely-signed real record both verifies *and* ends up tokenized (proving `verifyJws` saw the real bytes before tokenization ran), and a bad signature never even reaches the secret store (proving tokenization is never attempted first). Both halves were also proven against the real Kafka-driven pipeline, not only inside a Jest process.

## The reasoning behind the decisions that were not obvious

**Field classification is an allowlist, not a blocklist — this is what makes several of the epic's hardest guarantees true by construction rather than by discipline.** A field never named in `TOKENIZE_PATHS_BY_EVENT_TYPE` (an amount, `condition`, `ilpPacket`) cannot be touched, coincidentally or otherwise, because the walker was never told about it. This is why TRANSFER/FXTRANSFER need no ILP decoder to stay exempt, why `putQuotesByID`'s own `ilpPacket` field (present on a real QUOTE-classified capture) was never a special case, and why the amount-regression tests exist to *confirm* a structural guarantee rather than to defend a fragile one.

**Two genuinely dead defensive branches were found and removed while building this epic, one of them in Phase 3's own already-closed code.** `pii-secret.client.ts`'s design was simplified from two optional fields to one resolved value, removing an unreachable branch rather than testing around it; the same reasoning, applied consistently, found that five pre-existing `?? 'unknown reason'` fallbacks in `ingestion-consumer.service.ts` were equally dead and removed them alongside this epic's own new one. Both are recorded, with evidence, in the stories' own executive summaries — real cleanup surfaced by building this epic, not scope creep.

**Every "not yet decided" item this epic surfaces was resolved the same way: build against a stated, reversible default, and say so plainly rather than let it look settled.** The fail-mode default (block, not pass-through) mirrors exactly how Phase 3 built against its own recommended default for D3 while that conversation was still open. This is now a standing rule in `CLAUDE.md` ("External decisions — build anyway, but never bury them"), and this epic is the first one built entirely under it.

## What was proven live, versus assumed

A `postQuotes` record, re-signed, fed onto the real harness broker and consumed by a genuinely running MLA instance produced `Forwarded QUOTE` — the real, Kafka-driven pipeline, not a direct function call. A new checked-in tool, `tools/verify-tokenization/run.ts`, independently proved over real mTLS against a real `ppa-stub`: prefixed tokens in every listed QUOTE field, the identical token across two fully independent process runs (secret file re-read from disk each time), the amount reaching `ppa-stub` unchanged, and a real TRANSFER record's body reaching `ppa-stub` with zero fields altered. Readiness gating was proven both directions against a genuinely running instance — secret removed, `/health/ready` reported `piiSecret: DOWN` with `status: DOWN` while Kafka stayed `UP`; secret restored, back to fully `UP`. Full detail and exact log lines: both stories' `plan.md` §16 entries.

## What was deliberately left out

**No PPA delivery client** — Phase 5 (US-MLA-06/07) owns that; this epic's own mTLS proof is a verification tool, not that client, exactly as Phase 3's own one-shot proof was not. **No real metric or wired alert for tokenization failures** — only the interim structured log line exists, the same posture Phase 3 already established for its own `SECURITY` logs; Phase 6 wires real observability. **No key-rotation mechanism** — a single active secret, restart-to-rotate, deliberately, pending CCH's rotation-strategy decision. **No reversible lookup capability** — the construction is a one-way keyed hash; if CCH Legal needs genuine reversibility, that is unbuilt, separate infrastructure, flagged rather than assumed.

## What is deliberately not closed, and why — the one item that matters most

**The fail-mode decision.** Both stories are built, tested above the coverage gate, and live-verified against the recommended fail-closed default. Neither can be marked complete by this project's own definition of done until CCH answers whether a tokenization failure should block the event (as built) or pass it through unprotected — `plan.md` §13.1 names this explicitly, and it is the one open item that is not a matter of more engineering. `plan.md` §16's entries for both stories carry this in their own `Left open` fields and will be updated — by a new, later entry, never by editing these ones — once CCH's answer lands. The next phase (Phase 5, delivery and resilience) does not depend on this answer and is not blocked by it; see the handoff document for what starts next.

## What this exposed that outlives it

**Building "protect PII" and "prove the mechanism live" as two separate obligations, rather than treating a green test suite as sufficient, is what caught a real bug in this epic's own test-writing.** A JS default-parameter gotcha (`buildSecretStore(secret = PII_SECRET)` silently substituting the real secret when a caller passed `buildSecretStore(undefined)` to build the *unavailable* case) would have shipped a test suite that looked green while asserting the wrong thing, discovered only because the test's own assertion — expecting a `skipped` outcome — instead observed a `forwarded` one. The fix generalises: a helper whose entire purpose is to construct the *absence* of a value should never accept that absence via a defaulted parameter, since JavaScript's own default-parameter semantics treat an explicit `undefined` argument identically to an omitted one.

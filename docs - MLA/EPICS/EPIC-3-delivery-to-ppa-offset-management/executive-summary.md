# EPIC-3 — MLA: Delivery to PPA & Offset Management: Executive Summary

**Phase:** 5 (`plan.md` §8)
**Status:** complete — exit criterion met live, recorded in `plan.md` §16
**Date:** 2026-09-07

---

## What this epic delivered, as a whole

Its two stories — US-MLA-06 (deliver to PPA, gate the offset on HTTP 200) and US-MLA-07 (retry, break, and re-probe on failure) — are documented individually in their own folders. This document covers what only exists once both are assembled: the whole durability chain `core-knowledge.md` §9 states as the design's own reason for being — *an event that is not durably recorded never has its offset advanced* — made real, end to end, for the first time. Every phase before this one advanced the Kafka offset unconditionally, honestly, because nothing existed yet to gate it on; this epic is what replaces that unconditional advance with the real rule, in full: gated on PPA's actual response, retried with genuine jitter when that response is transient, advanced immediately when it is permanent, and — when neither resolves in time — parked behind a circuit breaker that always has a path back to resuming on its own.

## The purpose

**To turn "commit only on PPA HTTP 200" from a documented intention into the one place in this codebase where that intention can no longer quietly become "commit unless the call throws" or "commit on any 2xx."** `ingestion-consumer.service.ts`'s own three-way classification — a `forwarded` outcome's delivery result is exactly one of `success`/`client-error`(permanent)/transient — is the structural guarantee: there is no fourth path through the code that reaches an offset advance without going through one of those three, and each of the three has exactly one place it is decided.

## The reasoning behind the decisions that were not obvious

**This epic's own exit criterion could not be met by either story alone, and both sessions' own documentation says so rather than claiming otherwise at each story's own close.** US-MLA-06's offset gate needed US-MLA-07's retry/breaker/reprobe mechanism to become more than an interim uniform pause; US-MLA-07's retry/breaker mechanism needed US-MLA-06's classified delivery result to have anything to retry in the first place. The two stories' own `plan.md` §16 entries both record this plainly — closing together, in the same set of sessions, is the honest shape of this particular epic, not a process shortcut.

**Live verification was staged deliberately, in increments smaller than "the whole phase," on user feedback given mid-build: catch a mistake early, before more logic gets built on top of it.** Earlier phases in this project mostly verified once, at story close. This epic instead live-checked each coherent slice of behaviour as soon as it existed — the mTLS client alone, then the offset gate alone, then the retry burst alone, then the full breaker/reprobe cycle — rather than batching every checklist item and running one consolidated proof at the end. The payoff showed up directly: a genuinely wrong TLS-handshake classification (twice) was caught and fixed *during* US-MLA-06's own live run, before US-MLA-07's retry logic was built on top of a design that would have needed re-verifying afterward.

**`network-error`'s inclusion in the transient/retried bucket, and the circuit breaker's per-partition (not process-wide) scope, are both reasoned engineering interpretations, not verbatim requirements — and both are flagged explicitly, in three separate places (`plan.md` §8's checklist, the `plan.md` §16 entries, and the story-level executive summaries), specifically so a future reader does not mistake either for a settled fact.** Neither blocked building; both are worth confirming with CCH/COMESA the next time there is someone to ask.

## What was proven live, versus assumed

Every claim in this epic's two `plan.md` §16 entries was exercised against a real, running Redpanda broker and a real, running `ppa-stub`, with re-signed real captured records — not asserted from the design. Beyond each story's own individually-listed proofs, one run stands out as the epic's own capstone: a persistent 503 tripped a real per-partition circuit breaker at its configured threshold, and restoring `ppa-stub` health — with the MLA process never restarted — recovered the exact parked record automatically, offset advanced, partition resumed, nothing lost or duplicated. That is the whole durability chain this epic exists to build, observed working end to end, live, in one continuous run. Full numbers and exact log lines: `plan.md` §16's US-MLA-06/US-MLA-07 entries.

## What was deliberately left out

Per-partition circuit-breaker isolation across genuinely different partitions is unit-verified only, not live — the one real capture fixture in this repo is entirely partition 2. Phase 6 (observability) is what turns every structured log line this epic produces into a real metric and a wired alert. Two decided defaults (the circuit-breaker threshold N=5, and the offset-advance-on-permanent-failure policy) remain formally unconfirmed with CCH, built against and stated as defaults, never as settled answers.

## What this exposed that outlives it

**Reusing a precedent's *shape* is usually right; reusing its *scope* without re-checking the reasoning behind it is a different, riskier move, even within one codebase, even one epic apart.** The PII secret's own retry/park/breaker mechanism (gate item #1) was this epic's explicit, named template, and the retry-burst and reprobe shapes transferred cleanly. Its process-wide breaker scope did not — PPA's own failure domain is a per-call HTTP dependency that can be genuinely localized in a way the PII secret's single shared resource cannot — and the value in building this epic second was having a comparably serious second case to test that first design's own reasoning against, rather than assuming a working precedent settles every future instance of a similar-looking problem.

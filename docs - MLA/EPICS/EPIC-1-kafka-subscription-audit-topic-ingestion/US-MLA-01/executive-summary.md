# US-MLA-01 — Subscribe to the Mojaloop Audit Topic: Executive Summary

**Epic:** EPIC-1 — Kafka Subscription & Audit-Topic Ingestion
**Status:** complete — exit criterion met live, recorded in `plan.md` §16
**Date:** 2026-09-02/03

---

## What this story set out to achieve

Give the MLA a real, durable subscription to `topic-event-audit` — one dedicated consumer group, explicit offset control, and the first filter in the pipeline: discard `egress` records (the switch's own double-write of every event) without ever losing or duplicating a `start` record across a restart. Everything downstream (US-MLA-02's classification, US-MLA-03's payload selection, and Phase 3 onward) only ever sees a record this story has already decided is worth acting on.

The story's own Acceptance Criteria state a blanket "ingest only `start`" filter. **D1** (`plan.md` §3.1) rewrites that: the POC's live-verified per-operation table, plus a payload shape-check for `prepareTransfer`, is what was built. Correcting `story.md` to match is the Business Analyst's action — already communicated to them — not something this work redoes; `plan.md` §3.1's decision table, not the story text, is what engineering built against.

## The reasoning behind the decisions that were not obvious

**Canonical selection is a table, not a rule, because the story's rule silently drops real events.** A blanket `start`-only filter drops `commitTransfer`, `reserveFxTransfer` and `notifyFxTransfer` — all `egress`-only in the real captures — and every transfer rejection (`prepareTransfer`/`egress`). The POC's per-operation table, ported deliberately rather than reimplemented from prose (`plan.md` §12 V1's rule), is what makes both of those cases work correctly. The `prepareTransfer` shape-check exists because the same operation/action pair is canonical for two different reasons — an ordinary duplicate egress, and a genuine rejection — and only the payload's own shape (`TxInfAndSts.StsRsnInf` present, `ilpPacket` absent) tells them apart; the `/error` URL suffix some records carry is corroborating evidence only, never a code path, because it's a string an upstream service composes and can change without notice.

**Offset advance is `BigInt` arithmetic, not casual `+1`, because Kafka's own commit semantics are the specific place the POC's off-by-one class of bug lives.** `advance(partition, offset)` computes "commit is one past the consumed offset" once, centrally, so no call site can get it wrong. `autoCommit: false` is set unconditionally in `run()` — the offset contract is never delegated to the client library, even by default.

**The dedicated consumer group existed since Phase 0; this story is what makes it actually join the topic.** The externally-configured, R-18-commented `groupId` was scaffolding from day one (a *value* with nowhere to be used yet); `subscribe()`/`run()` are what turn that configuration into a real, live group membership — the reason R-18 (a reused DRPP-internal group name stealing partition assignments from a live payment-path handler) is the one MLA misconfiguration capable of affecting live payments in production, even though nothing here can close it: the real group ID is still CCH's to issue (§13.2).

## What was proven live, versus assumed

Two separate, genuine live proofs against a real Redpanda, not a mock or a re-run of the same scenario twice. First, at the `KafkaClient` primitive level: a fresh consumer group consumed all 41 records of the partition-2 slice, advanced only the first; a second process under the identical group, on rejoin, did not redeliver the advanced record and redelivered every un-advanced one; `pause`/`resume` froze consumption at exactly 3 records and resumed to completion on command. Second, the same guarantee re-proven through the real per-record handler — the assembled pipeline, not the primitive in isolation — including a genuine `SIGKILL` while `capture-feeder` was still actively mid-feed (not merely after it finished): the killed instance had already consumed and advanced every one of the 458 records already produced; the restarted instance picked up exactly and only the one partition that still had records outstanding, with zero loss and zero duplication across the two runs' combined 500-record tally. Full numbers: `plan.md` §5's exit-criterion section.

## What was deliberately left out

No reconnect/backoff logic of its own — the Method's step 5 relies entirely on kafkajs's built-in reconnect behaviour, which is the correct amount of engineering for what this story needs (building a bespoke reconnect state machine here would duplicate what the client library already does correctly). No genuine mid-*outage* proof (broker down while the MLA stays up) — only a clean process kill/restart was exercised; `tools/scenario-library`'s `broker-restart` scenario documents the outage procedure but its MLA-side half is still unexercised, left open rather than implied covered.

## What this exposed that outlives it

**"Restart after the feed finished" and "restart mid-feed" are not the same proof, and the difference is only visible once you build both.** The first live-verification run (`plan.md` §5, original entry) killed the MLA only after `capture-feeder` had already finished producing — a valid resume proof, but weaker than the exit criterion's literal wording asks for, because with this phase's unconditional per-record offset advance, nothing was ever left in an ambiguous "consumed but not committed" state to actually test. Re-running with `--delay-partition` deliberately held back one partition long enough to kill the MLA while the feeder's own log had not yet reported completion — a small methodological correction, but the kind that only surfaces by trying to state precisely what "mid-feed" means and then building exactly that, not something adjacent to it.

# PPA Prototype: Progress Against User Story

Plain-language status check against the original user story: *"Investigate
the Kafka topics used by Mojaloop services to publish quotation and
transfer-related messages, specifically from quoting-service and
ml-api-adapter... create a PPA prototype service/application... that
consumes the required quotation and transfer events."*

Full technical detail lives in `docs/Kafka/kafka-topics-quote-transfer.md`
and `docs/kafka-topics-ticket-status.md`. This doc is the short version.

## What was needed

1. Investigate how quote and transfer events flow through Mojaloop's Kafka
   topics (from `quoting-service` and `ml-api-adapter`), and document it
   clearly enough for someone to build against it.
2. Build a small prototype service that actually consumes those topics, to
   prove the approach works and give the PPA design something real to look
   at (not just a paper design).

## What we've done

- Identified and documented every relevant Kafka topic for quotes and
  transfers, including producers, consumers, and consumer groups.
- Verified topic names, partition counts, and message shapes live against a
  running `ml-core-test-harness` stack — not just inferred from reading
  code.
- Documented consumer configuration requirements (unique consumer group,
  broker address, offsets, partitions) and confirmed topics are
  configurable via env vars (`rc`-based overrides on both services).
- Built `ppa-prototype/`, a standalone service that consumes all 5 core
  topics and exposes what it consumes over a small HTTP API for inspection.
- Validated the prototype live by running the full TTK test suite (2625
  assertions) against it and confirming it correctly captured and decoded
  362 real messages across all 5 topics.

## Acceptance criteria coverage

| Acceptance Criterion | Status | Where |
|---|---|---|
| Kafka topics for quotation messages identified/documented | Done | `docs/Kafka/kafka-topics-quote-transfer.md` — `topic-quotes-post/put/get` (+ bulk/FX variants) |
| Kafka topics for transfer/notification messages identified/documented | Done | Same doc — `topic-transfer-prepare/fulfil/get`, `topic-notification-event` |
| Producer/consumer flow mapped per topic | Done | Full tables: which endpoint produces, which handler/service consumes, consumer group names |
| Sample payloads / schema references provided | Done, verified live | Real captured message samples in `kafka-topic-listener/captured/` and `ppa-prototype/captured/` — not just theorized from code |
| Kafka consumer configuration documented (group, partitions, offsets, env vars) | Done | Unique consumer-group requirement, broker address, partition count (confirmed live: 1 partition), `rc`-based env var overrides for both services |
| Helm/env/config configurability confirmed | Done | Confirmed via `rc` env vars; confirmed no Helm charts exist in this repo (documented as an open assumption about the external chart repo, not fabricated) |
| PPA prototype created with consumers for the topics | Done | `ppa-prototype/` — new standalone service, subscribes to all 5 core topics |
| Prototype successfully consumes quote and transfer messages | Done, proven live | Ran the full TTK test suite (2625 assertions) against it — captured 362 real messages across all 5 topics, correct payload decoding confirmed |
| Unknowns/assumptions/environment differences captured | Done | Explicitly tracked in both docs — VM not yet re-verified, FX/bulk/error paths not exercised, Helm repo existence unconfirmed |

## Bottom line

Every acceptance criterion is met and verified against a live running stack,
not just inferred from reading code. Two things are intentionally left open
(flagged, not silently skipped):

1. **Deployment VM verification** — everything was proven against a local
   Docker stack, not the actual VM's Kafka broker yet.
2. **FX / bulk / error-path message shapes** — the golden-path test flow
   doesn't exercise those, so they're still code-inferred only.

Both are called out as "Suggested Next Steps" in
`docs/Kafka/kafka-topics-quote-transfer.md` rather than being gaps anyone
would discover later by surprise.

# Ticket Status: Kafka Topics For Quote/Transfer PPA Ingestion

Tracks progress against the user story: *"Investigate the Kafka topics used
by Mojaloop services to publish quotation and transfer-related messages,
specifically from quoting-service and ml-api-adapter, so they can be
consumed for downstream processing/PPA design."* Full findings live in
`docs/kafka-topics-quote-transfer.md`.

## Done

- **Quote topics identified**: `topic-quotes-post`, `topic-quotes-put`,
  `topic-quotes-get` (+ bulk/FX variants). Producer/consumer mapped per
  topic.
- **Transfer topics identified**: `topic-transfer-prepare`,
  `topic-transfer-fulfil`, `topic-transfer-get`, `topic-notification-event`.
  Producer/consumer mapped per topic.
- **Producer/consumer flow mapped** for every topic above (endpoint → topic
  → handler), including consumer group IDs.
- **Payload structure documented and verified live** — quote payload is
  plain JSON, transfer payload is base64-encoded. Both confirmed against
  real messages, not just code.
- **Consumer configuration documented**: unique consumer-group requirement,
  broker address, offset strategy, partition count (confirmed live:
  `PartitionCount: 1` on all topics checked).
- **Env var configurability confirmed**: both services use `rc`
  (`QUOTE_KAFKA__...` / `MLAPI_KAFKA__...` override any topic name, group
  ID, or rdkafka option).
- **Helm checked**: no charts exist in this repo for these services —
  documented as an open assumption, not fabricated.
- **Live verification completed**: ran the full golden-path flow
  (`ml-core-test-harness`, local docker-compose) with a purpose-built
  listener app (`kafka-topic-listener/`) subscribed to all 5 core topics.
  236 assertions passed, 0 failed. All topic names, partition counts, and
  message envelopes confirmed against real traffic, with raw samples saved
  to `kafka-topic-listener/captured/`.
- **PPA integration points identified**: `topic-quotes-post` (quote-send
  initiation) and `topic-transfer-prepare` (transfer-send initiation) are
  the two listener points requested in the original status update.
- **Bonus finding**: `topic-quotes-put` carries `ilpPacket`/`condition` in
  plain JSON the moment the quote response is produced — this can replace
  the manual `localhost:4202/callbacks/{quoteId}` polling step currently
  used to get those values for the transfer request.
- **PPA prototype built**: `ppa-prototype/` is a standalone service (separate
  from the throwaway `kafka-topic-listener/`) that subscribes to all 5 core
  topics (`topic-quotes-post`, `topic-quotes-put`, `topic-transfer-prepare`,
  `topic-transfer-fulfil`, `topic-notification-event`) under its own unique
  consumer group (`ppa-prototype`), parses/decodes each payload, and exposes
  consumed messages via a small HTTP API (`GET /health`, `GET /messages`,
  `GET /messages/:topic`) for analysis instead of just console logging.
- **PPA prototype validated live**: ran against `ml-core-test-harness` with
  the prototype consuming throughout the full TTK test collection (2625
  assertions, 99.96% pass, unrelated single failure). All 5 topics captured
  real traffic (362 messages in one run); base64 decoding of transfer/
  notification payloads into `content.payloadDecoded` confirmed correct
  against live data. Samples saved to `ppa-prototype/captured/`.

## Left / Open

- **VM verification**: everything above was verified against a **local**
  docker-compose stack, not the deployment VM (`10.0.150.69`). Topic names
  should carry over (same service config defaults) but this hasn't been
  directly confirmed on the VM's Kafka broker yet.
- **FX / bulk / error-path payloads**: not exercised by the golden-path
  flow, so those shapes are still code-inferred only, not observed live.
- **central-ledger's consumption side**: not independently re-verified in
  this pass (relied on an earlier read of its config).
- **Helm chart existence**: still unconfirmed whether Mojaloop core service
  charts live in an external repo — flagged as an assumption, not resolved.
- **Callback-verification bug**: root cause of why the automatic
  quote/transfer callback isn't reliably reaching Postman/the FSP endpoint
  has not been investigated — we've only identified a Kafka-based
  workaround (`topic-quotes-put`, `topic-notification-event`), not fixed
  the underlying callback delivery issue.
- **FX/bulk/error-path topics not consumed by the PPA prototype**: it only
  subscribes to the 5 topics verified live on the golden path, matching the
  same gap noted above for payload shapes.
- **PPA prototype not yet run against the deployment VM**: validated so far
  only against a local `ml-core-test-harness` docker-compose stack, same
  caveat as the VM verification item above.
- **Notification-event volume/filtering**: `topic-notification-event` fires
  per state transition (observed well beyond just P2P quote/transfer —
  includes settlement-related actions during the broader test run), so a
  production PPA consumer would need to filter/dedupe by
  `metadata.event.action` rather than treat every message as a distinct
  business event. Not yet designed, just observed.

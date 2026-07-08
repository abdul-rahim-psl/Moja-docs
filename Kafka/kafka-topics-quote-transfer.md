# Mojaloop Kafka Topics For Quote And Transfer Flows

This document inventories the Kafka topics that carry quote and transfer
messages between `quoting-service`, `ml-api-adapter`, and `central-ledger`, for
downstream consumption by a PPA (payment processing adapter) prototype. It is a
companion to `docs/fsp-ingestion-endpoints.md` and
`docs/fsp-ingestion-flow-guide.md`, which cover the HTTP ingress/callback side
of the same flows.

## Evidence Sources

- `quoting-service/config/default.json`
- `quoting-service/src/api/quotes.js`, `src/api/quotes/{id}.js`, `src/api/bulkQuotes*.js`
- `quoting-service/src/lib/dto.js`
- `quoting-service/src/handlers/index.js`, `src/handlers/createConsumers.js`, `src/handlers/QuotingHandler.js`
- `quoting-service/src/lib/config.js`
- `ml-api-adapter/config/default.json`
- `ml-api-adapter/src/domain/transfer/index.js`, `src/domain/transfer/dto.js`
- `ml-api-adapter/src/handlers/notification/index.js`, `src/handlers/notification/dto.js`
- `ml-api-adapter/src/lib/config.js`
- `quoting-service/package.json`, `ml-api-adapter/package.json` (`rc` dependency)
- `ml-core-test-harness/docker-compose.yml`, `ml-core-test-harness/k8s-mojaloop-perf-tuning/*.yaml`

## Topic Naming Convention

Both services build topic names via a shared template mechanism from
`@mojaloop/central-services-shared`:

```
GENERAL_TOPIC_TEMPLATE.TEMPLATE = "topic-{{functionality}}-{{action}}"
```

`quoting-service` mostly hardcodes the resolved topic string directly per
endpoint in `config/default.json` rather than resolving the template at
runtime; `ml-api-adapter` resolves it via
`Kafka.createGeneralTopicConf(template, functionality, action)` (e.g.
`functionality=transfer, action=prepare` → `topic-transfer-prepare`).

## Quote Flow Topics (quoting-service)

quoting-service both produces to and consumes from its own topics — this is
the standard Mojaloop "HTTP request → produce to Kafka → own async handler
consumes and forwards/calls out" pattern. There are no separate
notification/error topics for quotes; errors ride on the same `PUT` topic via
`payload.errorInformation`.

| Topic | Produced by (endpoint) | Consumed by | Consumer group |
| --- | --- | --- | --- |
| `topic-quotes-post` | `POST /quotes` — `src/api/quotes.js:114-117` | `QuotingHandler.handlePostQuotes` → `model.handleQuoteRequest` | `group-quotes-handler-post` |
| `topic-quotes-put` | `PUT /quotes/{ID}` and quote error callback — `src/api/quotes/{id}.js` | `QuotingHandler.handlePutQuotes` → `handleQuoteUpdate` / `handleQuoteError` (if `payload.errorInformation`) | `group-quotes-handler-put` |
| `topic-quotes-get` | `GET /quotes/{ID}` — `src/api/quotes/{id}.js` | `handleGetQuotes` → `model.handleQuoteGet` | `group-quotes-handler-get` |
| `topic-bulkquotes-post` | `POST /bulkQuotes` — `src/api/bulkQuotes.js` | `handlePostBulkQuotes` → `handleBulkQuoteRequest` | `group-bulk-quotes-handler-post` |
| `topic-bulkquotes-put` | `PUT /bulkQuotes/{ID}` — `src/api/bulkQuotes/{id}.js` | `handlePutBulkQuotes` → `handleBulkQuoteUpdate` / `handleBulkQuoteError` | `group-bulk-quotes-handler-put` |
| `topic-bulkquotes-get` | `GET /bulkQuotes/{ID}` — `src/api/bulkQuotes/{id}.js` | `handleGetBulkQuotes` → `handleBulkQuoteGet` | `group-bulk-quotes-handler-get` |
| `topic-fx-quotes-post` | `POST /fxQuotes` (FX branch of `quotes.js`) | `handlePostFxQuotes` → `handleFxQuoteRequest` | `group-fx-quotes-handler-post` |
| `topic-fx-quotes-put` | `PUT /fxQuotes/{ID}` (FX branch of `quotes/{id}.js`) | `handlePutFxQuotes` → `handleFxQuoteUpdate` / `handleFxQuoteError` | `group-fx-quotes-handler-put` |
| `topic-fx-quotes-get` | `GET /fxQuotes/{ID}` (FX branch) | `handleGetFxQuotes` → `handleFxQuoteGet` | `group-fx-quotes-handler-get` |

**For PPA consumption of "Quote Send" initiation: subscribe to `topic-quotes-post`.**
This fires the instant a `POST /quotes` request lands on quoting-service.

Common rdkafka config (all quote topics): `metadata.broker.list: localhost:9092`
(local default); consumers use `auto.offset.reset: earliest`, `mode: 2`,
`batchSize: 1`; producers use `request.required.acks: all`,
`partitioner: murmur2_random`. Wiring: `src/handlers/createConsumers.js`
iterates `kafkaConfig.CONSUMER` and registers a handler per topic;
`src/handlers/QuotingHandler.js` dispatches by `msg.topic`.

### Quote message envelope

Built by `messageFromRequestDto` in `src/lib/dto.js`:

```json
{
  "type": "quote | bulkQuote | fxQuote",
  "from": "<headers['fspiop-source']>",
  "to": "<headers['fspiop-destination']>",
  "id": "<quoteId | bulkQuoteId | conversionRequestId>",
  "content": {
    "requestId": "...",
    "headers": { "...": "..." },
    "payload": { "...": "FSPIOP quote payload, see docs/fsp-ingestion-endpoints.md" },
    "uriParams": { "id": "..." },
    "spanContext": { "...": "..." },
    "context": { "isIsoApi": false }
  },
  "metadata": {
    "event": {
      "id": "<uuid>",
      "type": "quote",
      "action": "post | put | get",
      "state": { "status": "success", "code": 0, "description": "action successful" }
    }
  }
}
```

## Transfer Flow Topics (ml-api-adapter / central-ledger)

`ml-api-adapter` is a producer-only participant for transfer prepare/fulfil —
central-ledger is the consumer on those topics (not present in this
inventory's file list, but referenced for completeness since it's the known
downstream consumer per the wider Mojaloop architecture). No dedicated
error/abort/position topics exist for transfers in `ml-api-adapter`'s config —
aborts/rejects reuse `topic-transfer-fulfil` with a different `action` value
inside the message.

| Topic | Produced by | Consumed by | Consumer group |
| --- | --- | --- | --- |
| `topic-transfer-prepare` | `POST /transfers` → `src/domain/transfer/index.js` `prepare()` → `dto.producerConfigDto(Action.TRANSFER, Action.PREPARE)` | central-ledger (prepare handler) | n/a — producer only in this service |
| `topic-transfer-fulfil` | `PUT /transfers/{ID}` → `index.js` `fulfil()`, and error path `transferError()` (action inside message becomes `commit`/`reserve`/`reject`/`abort`) | central-ledger | n/a — producer only in this service |
| `topic-transfer-get` | `GET /transfers/{ID}` → `index.js` `getTransferById()` | central-ledger | n/a — producer only in this service |
| `topic-notification-event` | central-ledger (notification handler, after processing prepare/fulfil/position) | `src/handlers/notification/index.js` `startConsumer()` → resolves destination FSP endpoint → sends outbound `PUT`/`PATCH` callback | `ml-group-notification-event` |

**For PPA consumption of "Transfer Send" initiation: subscribe to `topic-transfer-prepare`.**
This fires the instant a `POST /transfers` request lands on ml-api-adapter.

**Note on the open callback-verification issue:** `topic-notification-event` is
where central-ledger publishes the result that `ml-api-adapter` turns into the
FSP-facing HTTP callback. A PPA listener on this topic can observe
quote/transfer success or failure directly from Kafka, independent of whether
the downstream HTTP callback delivery succeeds — this is a viable path to
de-risk the callback-verification gap noted separately, once the two primary
listeners are working.

### Transfer message envelope

Built in `src/domain/transfer/dto.js`, consumed/reassembled in
`src/handlers/notification/dto.js` (`notificationMessageDto()`):

```json
{
  "from": "<payerFsp | headers['fspiop-source']>",
  "to": "<payeeFsp | headers['fspiop-destination']>",
  "id": "<transferId | commitRequestId>",
  "content": {
    "headers": { "...": "..." },
    "payload": "data:application/vnd...;base64,<base64-encoded FSPIOP transfer payload>",
    "uriParams": { "id": "<transferId>" },
    "context": { "originalRequestId": "...", "originalRequestPayload": "..." }
  },
  "metadata": {
    "event": {
      "id": "<uuid>",
      "type": "prepare | fulfil | notification",
      "action": "prepare | commit | reserve | reject | abort | event | fx_prepare | ...",
      "createdAt": "<ISO date>",
      "state": { "status": "success", "code": 0, "description": "action successful" }
    }
  }
}
```

The transfer `content.payload` is base64-encoded (`data:` URI), unlike the
quote payload which is a plain JSON object — a consumer needs
`StreamingProtocol.decodePayload` (or equivalent base64+JSON decode) to read
it. This is the one structural difference a PPA parser needs to branch on
between the two topics.

## Consumer Configuration Required For A New PPA Listener

- **Consumer group ID**: must be a *new, unique* group id for each PPA
  listener (e.g. `ppa-quote-post-listener`, `ppa-transfer-prepare-listener`).
  Do not reuse `group-quotes-handler-post` or any existing service consumer
  group — joining an existing group steals partitions from that service's
  running consumers and will break quoting-service/central-ledger.
- **Broker address**: `metadata.broker.list`, local default
  `localhost:9092`; must be resolved to whatever broker address/port is
  exposed on the deployment VM for the ml-core-test-harness stack.
- **Offset behavior**: existing consumers use `auto.offset.reset: earliest`.
  A PPA prototype doing live tailing would more likely want `latest` to avoid
  replaying the full topic history on each restart — decide based on whether
  historical backfill is wanted.
- **Partitions**: no explicit partition count found in `config/default.json`
  for either service (broker-default topic creation); a single-partition
  consumer with `mode: 2, batchSize: 1` (as used by existing handlers) is
  sufficient for prototype purposes since message ordering isn't sharded.

## Configurability: Env Vars And Helm

Both services use the `rc` npm module (`quoting-service/package.json`,
`ml-api-adapter/package.json`) to layer environment variable overrides on top
of `config/default.json`:

- `quoting-service/src/lib/config.js`: `require('rc')('QUOTE', require('../../config/default.json'))`
- `ml-api-adapter/src/lib/config.js`: `require('rc')('MLAPI', require('../../config/default.json'))`

`rc` uses the app-name prefix plus double-underscore (`__`) as the nesting
delimiter. Any Kafka topic name, consumer group id, or rdkafka option is
overridable this way, e.g.:

```
QUOTE_KAFKA__PRODUCER__QUOTE__POST__topic=custom-topic-name
MLAPI_KAFKA__PRODUCER__TRANSFER__PREPARE__topic=custom-topic-name
MLAPI_KAFKA__CONSUMER__NOTIFICATION__EVENT__config__rdkafkaConf__group.id=custom-group
```

or by pointing at an entirely separate file via `QUOTE_CONFIG=/path/to/file.json`
/ `MLAPI_CONFIG=/path/to/file.json`.

**No Helm charts are checked into this repository** for quoting-service or
ml-api-adapter — `find` across the repo tree for `values.yaml`/`Chart.yaml`
returned nothing relevant (only unrelated ArgoCD/Helm artifacts under
`ml-core-test-harness/k8s-mojaloop-perf-tuning/`, which belong to a Redpanda
chart and a test-harness Helm release, not the core services). Core Mojaloop
service charts are known to live in an external chart repository in the wider
Mojaloop ecosystem, not present in this checkout — this could not be
independently confirmed from local content and should be treated as an
assumption, not a verified fact.

In practice, `ml-core-test-harness/docker-compose.yml` and the individual
services' own `docker-compose.yml` files only set broker-level
`KAFKA_CFG_*` variables (for the `bitnamilegacy/kafka` container itself); they
do not exercise the `QUOTE_KAFKA__...` / `MLAPI_KAFKA__...` override path.
The deployed test harness currently runs on `config/default.json` topic names
as-is, so the topic names in the tables above should match what's live on the
VM unless someone has applied an override.

## Verification Log (Live Run)

Verified by running the full golden-path flow against a local
`ml-core-test-harness` stack (`docker compose --profile all-services
--profile ttk-provisioning-gp --profile ttk-tests-gp up -d`, Kafka port
`9092` uncommented/exposed to host) with the `kafka-topic-listener` prototype
app (`../kafka-topic-listener/`) connected before the test run started. Full
raw samples for each topic are saved in
`../kafka-topic-listener/captured/<topic-name>.sample.txt`.

- **Test run result**: TTK golden-path collection completed with
  `236 passed, 12 skipped, 0 failed` (P2P money transfer flow), including
  explicit quote-send, transfer-prepare, and fulfil-reserved assertions.
- **Topic names confirmed directly against the live broker** via
  `docker exec kafka /opt/bitnami/kafka/bin/kafka-topics.sh --bootstrap-server
  localhost:9092 --list` — every topic name in the tables above exists
  exactly as documented (`topic-quotes-post`, `topic-quotes-put`,
  `topic-quotes-get`, `topic-bulkquotes-{post,put,get}`,
  `topic-fx-quotes-{post,put,get}`, `topic-transfer-prepare`,
  `topic-transfer-fulfil`, `topic-transfer-get`, `topic-transfer-position`,
  `topic-transfer-position-batch`, `topic-notification-event`,
  `topic-admin-transfer`). This resolves the earlier "topic names are
  inferred from config, not confirmed live" gap.
- **Partition count confirmed**: `kafka-topics.sh --describe --topic
  topic-quotes-post` → `PartitionCount: 1, ReplicationFactor: 1`. Same single-
  partition, single-replica layout applies across these topics in this
  deployment (bitnami Kafka with `KAFKA_AUTO_CREATE_TOPICS_ENABLE: true` and
  no explicit partition count set anywhere in service config, as suspected).
  This resolves the earlier "partition count is assumed, not measured"
  unknown.
- **Message counts observed** during one golden-path run: 8 messages each on
  `topic-quotes-post`, `topic-quotes-put`, `topic-transfer-prepare`,
  `topic-transfer-fulfil`; 37 on `topic-notification-event` (notification
  fires more often — once per state transition, not just once per
  request/response pair).
- **Quote message envelope confirmed** — a real `topic-quotes-post` message
  matched the documented shape exactly: plain JSON `content.payload` with
  `quoteId`, `transactionId`, `payer`, `payee`, full FSPIOP headers in
  `content.headers`, `from`/`to` populated from `fspiop-source`/
  `fspiop-destination`.
- **Transfer message envelope confirmed** — a real `topic-transfer-prepare`
  message had `content.payload` as a `data:application/vnd.interoperability.
  transfers+json;version=2.0;base64,<...>` string. The listener's base64
  auto-decode correctly produced `content.payloadDecoded` with `transferId`,
  `payerFsp`, `payeeFsp`, `amount`, `expiration`, `ilpPacket`, `condition` —
  confirming the "quote payload is plain JSON, transfer payload is base64"
  distinction documented above is correct, not just theorized from code.
- **`metadata.event` shape confirmed** on live messages: `type: "prepare"`,
  `action: "prepare"`, `state: { status: "success", code: 0, description:
  "action successful" }`, plus a `trace` block (span/trace IDs, W3C
  tracestate) not previously documented from code alone — present on both
  quote and transfer topics, useful if the PPA wants to correlate messages
  across topics by `traceId`.

## PPA Prototype

`../ppa-prototype/` is the actual PPA consumer service built from this
investigation (distinct from `../kafka-topic-listener/`, which was throwaway
tooling used only to verify the findings above). It subscribes to all 5 core
topics under its own unique consumer group (`ppa-prototype`), decodes each
payload per the rules documented above, and exposes consumed messages via a
small HTTP API (`GET /health`, `GET /messages`, `GET /messages/:topic`)
rather than only console logging.

Validated the same way as this document: run against a live
`ml-core-test-harness` stack while the full TTK test collection executed
(2625 assertions, 99.96% pass). All 5 topics captured real traffic (362
messages in one run), and base64 decoding of transfer/notification payloads
was confirmed correct against live data, not just the earlier golden-path
sample. See `../ppa-prototype/README.md` and `../ppa-prototype/captured/`
for details and fresh samples.

One additional finding from this broader test run: `topic-notification-event`
fires for settlement-related actions too (not just quote/transfer state
transitions), confirming the "fires per state transition" note above extends
beyond the P2P golden path — a production PPA consumer should filter/dedupe
by `metadata.event.action` rather than treat every message as a distinct
business event.

## Unknowns / Assumptions (Remaining)

- central-ledger's own topic-consumption config (`central-ledger/config/default.json`)
  was reviewed in an earlier pass and is consistent with this table, but was
  not re-read fresh in this document or independently observed as a
  consumer in the live run above (the listener observes production onto the
  topic, not central-ledger's own consumption of it).
- This verification ran against a **local** docker-compose stack, not the
  deployment VM (`10.0.150.69`). Topic names/shapes should carry over since
  they come from the same service config defaults, but the VM's Kafka
  broker address/port has still not been directly confirmed — see Suggested
  Next Steps.
- Whether Mojaloop core service Helm charts exist in an external repo could
  not be confirmed from this checkout; still flagged as an assumption.
- FX quote/transfer, bulk quote/transfer, and error-path (`errorInformation`)
  message shapes were not observed live in this run (the golden-path P2P
  flow doesn't exercise them) — only inferred from code as before.

## Suggested Next Steps

1. Confirm the Kafka broker address/port exposed on the deployment VM
   (alongside the admin-ui's `10.0.150.69:9660`) for the ml-core-test-harness
   stack, and re-run the PPA prototype against it to confirm parity with the
   local results above.
2. Exercise FX and bulk flows (and a forced error case) through the harness
   to capture and document those payload shapes with the same rigor, then
   extend `../ppa-prototype/` to consume them if still in scope.
3. Design `metadata.event.action` filtering/dedup logic in the PPA prototype
   for `topic-notification-event`, now that its broader firing pattern
   (including settlement actions) has been observed live.
4. Investigate the root cause of the callback-verification gap; the
   `topic-quotes-put` / `topic-notification-event` consumers in the PPA
   prototype are a proven Kafka-based workaround but not a fix.

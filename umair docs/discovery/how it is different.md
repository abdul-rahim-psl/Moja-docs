# How `mla-ppa-kafka-topics-and-discovery-plan.md` differs from `ppa-prototype`

Direct question: we already have `ppa-prototype` — what new thing does the discovery plan
doc actually add?

## What `ppa-prototype` already does

`ppa-prototype` only consumes quote and transfer topics — it has zero party/discovery
capability. Its "Topics consumed" table (`ppa-prototype/README.md`) lists exactly 5
topics:

- `topic-quotes-post`
- `topic-quotes-put`
- `topic-transfer-prepare`
- `topic-transfer-fulfil`
- `topic-notification-event`

There is no ALS/party consumer, and structurally there can't be one yet, because no such
topic exists. ALS publishes party lookups over HTTP only — confirmed by zero Kafka
references anywhere in `account-lookup-service/config/default.json` or
`account-lookup-service/package.json`.

## What the discovery plan doc adds that's genuinely new

1. **A brand-new architectural component.** A reverse proxy + collector sitting in front
   of ALS, which doesn't exist anywhere in the codebase or prior docs. `ppa-prototype` is
   a pure Kafka consumer — it assumes the topics it reads already exist. This doc is about
   *manufacturing* topics that don't exist by intercepting HTTP traffic ALS never puts on
   Kafka.
2. **Two new topics** (`topic-parties-get`, `topic-parties-put`) that no service in this
   repo produces today — not proposed or referenced anywhere else in the knowledge base.
3. **A new message envelope** for those topics, invented for this doc. Per `review.md` in
   this folder, it isn't yet reconciled with the `content`/`metadata.event` shape
   `ppa-prototype` already parses for quotes and transfers.
4. **A hard constraint that ALS core code must stay untouched**, which is why a proxy is
   needed instead of just adding a Kafka producer inside ALS. This constraint doesn't
   apply to the existing quote/transfer work, since `quoting-service` and `ml-api-adapter`
   already produce to Kafka natively — there was nothing to work around.

## Bottom line

`ppa-prototype` proved out consumption of *existing* topics. The discovery plan doc
proposes how to *create* a topic that doesn't exist, for the one FSPIOP flow (party
discovery) Mojaloop's core services never put on Kafka in the first place. It's a new
problem class, not a restatement of what's already built.

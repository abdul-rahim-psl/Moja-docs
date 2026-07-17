# Review: mla-ppa-kafka-topics-and-discovery-plan.md

Compared against the existing knowledge base: `docs/Kafka/kafka-topics-quote-transfer.md`
(live-verified against a running broker), `docs/kafka-topics-ticket-status.md`,
`docs/ppa/ppa-progress.md`, `docs/FSD/review-fsd.md`, `docs/fsp-ingestion/fsp-ingestion-endpoints.md`,
and the `account-lookup-service` source/config in this repo.

## 1. What's OK and aligned with our knowledge

- **Quote topic names and roles** (`topic-quotes-post`, `topic-quotes-put`, `topic-quotes-get`,
  plus `topic-bulkquotes-*` and `topic-fx-quotes-*`) match the live-verified table in
  `docs/Kafka/kafka-topics-quote-transfer.md` exactly, including which are required vs. optional.
- **Transfer topic names and roles** (`topic-transfer-prepare`, `topic-transfer-fulfil`,
  `topic-transfer-get`, `topic-notification-event`, plus `topic-transfer-position(-batch)` and
  `topic-admin-transfer`) also match the live-verified table exactly.
- **`topic-notification-event` is correctly attributed to central-ledger, not `ml-api-adapter`.**
  This matches the knowledge base and is one of the specific gaps the FSD review
  (`docs/FSD/review-fsd.md`, Finding #8) flagged as *missing* elsewhere — this doc gets it right.
- **Payload encoding split is correct**: quote payloads are plain JSON, transfer payloads are a
  base64-encoded `data:` URI that must be decoded to get `transferId`, `amount`, `condition`,
  `payerFsp`, `payeeFsp`. This is verified live in the knowledge base, not just inferred from code.
- **"Per-action topics, not one topic per service" framing is correct** and matches the central
  correction the FSD review made against the FSD's Section 4.2 model (Finding #1).
- **Consumer group guidance is correct and consistent**: use a new, unique consumer group for
  MLA/PPA and never join `group-quotes-handler-post` or `ml-group-notification-event` — this
  matches the explicit warning in `docs/Kafka/kafka-topics-quote-transfer.md` ("Consumer
  Configuration Required For A New PPA Listener").
- **Flagging `topic-notification-event` as needing filtering/deduplication is correct and
  important.** This matches a Critical Finding in the FSD review (#3) and an open item in the
  ticket-status doc — the knowledge base measured 37 notification messages vs. 8 each on
  prepare/fulfil in one golden-path run, so "may produce multiple messages per transaction" is,
  if anything, understated.
- **ALS discovery being HTTP/callback-based, not Kafka-based, is correct and independently
  verifiable.** `account-lookup-service/config/default.json` and `package.json` have no Kafka
  references at all, and the party HTTP paths listed in the doc (`GET /parties/{Type}/{ID}`,
  `PUT /parties/{Type}/{ID}`, `PUT /parties/{Type}/{ID}/error`, plus the `{SubId}` variants) match
  `docs/fsp-ingestion/fsp-ingestion-endpoints.md` and the actual route files under
  `account-lookup-service/src/api/parties/`.
- **The design goal of leaving ALS, Oracle, and Central Ledger unchanged** is consistent with the
  "must not require ALS code changes" framing used throughout this doc, and is a reasonable
  constraint given no existing knowledge-base doc proposes touching core service code.
- **Recommending a new discovery-only topic pattern (`topic-parties-get` / `topic-parties-put`)
  that mirrors the existing per-action convention** is consistent with how quotes/transfers are
  already named, and directly answers Critical Finding #6 in the FSD review, which noted `PARTY`
  is missing from the FSD's `eventType` enum despite being required for `/PARTIES` routing.

## 2. What needs to change

- **"Optional" framing for `topic-transfer-get` conflicts with the knowledge base's stronger
  claim.** `docs/Kafka/kafka-topics-quote-transfer.md` lists `topic-transfer-get` as produced by
  `GET /transfers/{ID}` with central-ledger as consumer, same status class as prepare/fulfil in
  the table — this doc downgrades it to "Optional. Not part of the normal prepare/fulfil pair,"
  which is true operationally but should cite that basis rather than imply it's unconfirmed.
  Minor wording fix, not a factual error.
- **No reference to the live verification already done.** Everything in
  `docs/Kafka/kafka-topics-quote-transfer.md` was confirmed against a running broker
  (`kafka-topics.sh --list`/`--describe`), a live golden-path test run, and a working PPA
  prototype (`ppa-prototype/`). This doc presents the quote/transfer topic tables as if newly
  "identified," without citing that they are already live-verified and that a working consumer
  (`ppa-prototype/`) already exists. Add a citation/reference section pointing to
  `docs/Kafka/kafka-topics-quote-transfer.md`, `docs/kafka-topics-ticket-status.md`, and
  `docs/ppa/ppa-progress.md` so this doesn't read as a duplicate, independent investigation.
- **"Minimum MLA Subscription Set" omits `topic-transfer-get` and the FX/bulk topics without
  saying why, and doesn't reconcile with the FSD review's finding that the real subscription
  list is 15+ topics, not 5.** The FSD review (Finding #1) explicitly criticizes the FSD for
  under-counting the topic list; this doc's 5-topic "minimum set" is a reasonable phased-rollout
  scope decision, but should say explicitly that FX/bulk/`-get`/position/admin topics are
  deliberately out of Phase 1 scope (matching the "Open Items" already tracked in
  `docs/kafka-topics-ticket-status.md`), rather than silently dropping them.
- **The proposed discovery envelope's correlation ID scheme needs to be reconciled with the
  existing quote/transfer envelope shape.** The knowledge base's confirmed message envelope
  (`docs/Kafka/kafka-topics-quote-transfer.md`, "Quote message envelope" / "Transfer message
  envelope") uses `type`, `from`, `to`, `id`, `content`, `metadata.event` as the top-level shape,
  produced by the same `@mojaloop/central-services-shared` template mechanism. The new discovery
  envelope in this doc (`msgType`, `eventType`, `id`, `path`, `fspiop-source`,
  `fspiop-destination`, `body`, `timestamp`) is a different, custom shape with no `metadata.event`
  or `content` wrapper. Since one of this doc's own design goals is to "keep MLA consistent with
  the FSD's Kafka-consumption model," the discovery envelope should either be reshaped to match
  the existing `content`/`metadata.event` structure the MLA already has to parse for quotes and
  transfers, or the doc should explicitly justify why party-discovery events get a bespoke shape
  instead — as written this is an unflagged inconsistency, not a stated design decision.
  - Also `PARTY` is proposed as the `eventType` value, but the FSD review's Finding #6 shows the
    FSD's `eventType` enum needs `PARTY` added to align with the existing `QUOTE`/`FXQUOTE`/
    `TRANSFER`/`FXTRANSFER` values used on the other topics — this doc should note that its choice
    of `PARTY` is intended to close that specific FSD gap, since it currently reads as an
    independent naming choice rather than a fix tied to a known issue.
- **No mention of the base64/JSON payload-encoding distinction for the new discovery topics.**
  The example events in this doc show `body` as plain JSON in both directions. That's consistent
  with quote payloads (plain JSON) but the doc never states whether that choice was deliberate —
  given the transfer topic uses a base64 `data:` URI for exactly the field this doc calls `body`,
  worth an explicit line saying discovery payloads will always be plain JSON (proxy-generated, not
  passed through from an ALS base64 wire format) so a future implementer doesn't assume they need
  to decode it.
- **Collector-failure / blocking behavior note needs to reference the existing FSD error-handling
  model instead of introducing a new one.** This doc's Design Notes say "Collector failure should
  not block ALS discovery unless the business explicitly requires blocking fraud checks" — this is
  a reasonable default, but `docs/FSD/review-fsd.md` (Finding #7) already flags an open question
  about whether a downstream 4xx advances the Kafka offset for MLA's *existing* consumers. The new
  discovery collector introduces the same class of question one layer earlier (proxy → Kafka, not
  Kafka → MLA), and this doc should say explicitly whether a failed publish to
  `topic-parties-get`/`-put` is fire-and-forget (never blocks the proxied ALS response) or can ever
  apply backpressure, rather than leaving it as a business-decision hand-wave.
- **Open Items list should be merged with, not kept separate from, the existing open-items
  tracking.** `docs/kafka-topics-ticket-status.md` and `docs/FSD/review-fsd.md` already track
  overlapping open items (FX/bulk scope, `topic-notification-event` filtering ownership, VM broker
  address). This doc restates several of the same open items (#1 broker address, #2 FX scope, #3
  notification filtering) independently rather than cross-referencing the existing tracking docs,
  which risks the two lists drifting out of sync. Recommend this doc explicitly link back to
  `docs/kafka-topics-ticket-status.md`'s "Left / Open" section and the FSD review's "Suggested
  Questions for the JAD Workshop" rather than duplicating them fresh.
- **No claim in this doc has been live-verified yet** (unlike the quote/transfer knowledge base,
  which was checked against a running broker and a working prototype). The entire "Proposed ALS
  Discovery Capture Architecture" section is a design proposal, not a measured fact — the doc
  should say so explicitly (e.g., "Status: proposed, not yet implemented or tested") so it isn't
  read with the same confidence level as the quote/transfer tables it sits next to.

# Next Steps: ALS Discovery Capture

Direction: we've moved from "investigate and document what exists" (quotes/transfers,
live-verified) to "design and build the missing piece" — ALS discovery isn't natively
on Kafka, so `mla-ppa-kafka-topics-and-discovery-plan.md` proposes a proxy/collector to
capture it. That proposal hasn't been through the same live-verification rigor as the
quote/transfer work yet (see `review.md` in this folder). Next step is to prototype it
the same way `kafka-topic-listener`/`ppa-prototype` proved out the quote/transfer topics,
before it goes back into another FSD revision.

## Implementation order

1. **Reshape the envelope first** (cheap, avoids rework) — align the discovery event to
   the existing `content`/`metadata.event` structure (confirmed in
   `docs/Kafka/kafka-topics-quote-transfer.md`) instead of the bespoke `msgType`/`path`
   shape currently proposed, so PPA doesn't need two separate parsers.
2. **Stand up the reverse proxy** in front of ALS in the local `ml-core-test-harness`
   compose stack: forward every request untouched to the real ALS, mirror
   `GET/PUT /parties/...` traffic to a collector.
3. **Collector publishes to `topic-parties-get`/`topic-parties-put`** on the same local
   Kafka broker already used for quote/transfer verification.
4. **Run the TTK golden-path party-lookup flow** (`parties.json`) through it and confirm
   on the live broker: topic exists, message lands, envelope matches shape, and —
   critically — the proxied ALS response to the real client is byte-identical to the
   unproxied case. This is the "must not require ALS code changes" constraint, and it's
   currently unverified.
5. **Extend `ppa-prototype/`** (not a new service) to also consume the two new topics, so
   party discovery shows up next to quote/transfer in the same `/messages` API.
6. **Update `mla-ppa-kafka-topics-and-discovery-plan.md`** with a "Verification Log"
   section mirroring the one in `docs/Kafka/kafka-topics-quote-transfer.md`, so it earns
   the same confidence level as the rest of the knowledge base.

Status: not started. Revisit this list before beginning implementation.

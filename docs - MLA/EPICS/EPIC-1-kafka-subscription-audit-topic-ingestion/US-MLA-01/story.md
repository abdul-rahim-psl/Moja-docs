# US-MLA-01 — Subscribe to the Mojaloop Audit Topic

**Epic:** Epic 1 — MLA: Kafka Subscription & Audit Topic Ingestion
**Source:** `docs/user stories/cch-mla-user-stories.md`

---

## Description

The MLA must consume all payment events (FX quote, quote, FX transfer, transfer — including the transfer's fulfil/final-state leg) from a single, dedicated Mojaloop audit topic — not from Mojaloop's per-action primary topics directly. This is the sole Kafka ingress point for the pipeline. There are four event types on this topic: the final-state/fulfil event is not a separate category — it's the same `PUT /transfers` fulfil callback, DFSP-signed like any other TRANSFER event (`cch-notification-dedup-user-stories.md` has the supporting evidence).

## Acceptance Criteria

- MLA maintains exactly one consumer group subscription targeting the Mojaloop audit topic.
- MLA does not subscribe to any of the per-action primary topics (`topic-quotes-post`, `topic-transfer-prepare`, etc.) directly.
- Each logical event is written to the audit topic twice — once as `metadata.event.action: start` (captured when the switch receives it) and once as `egress` (captured when the switch relays it onward) — carrying identical business content. MLA ingests only `start` records; `egress` records are recognized and discarded as a structural skip, not logged as an error. This is what keeps MLA from processing every event twice.
- On startup, MLA reads from its last committed offset; it does not reset to the beginning of the topic or to the end.
- If the Kafka broker is temporarily unreachable, MLA reconnects automatically using the Kafka client's built-in reconnect logic without operator intervention; the consumer offset stays paused during the outage.
- MLA can be restarted without data loss; events that arrived during the downtime are consumed from the last committed offset on reconnect.

## Method

1. **Configure** — the consumer group ID, broker addresses, and audit-topic name are read from external configuration at startup.
2. **Resolve offset** — on startup, MLA asks Kafka for its last committed offset on the audit topic and resumes from there.
3. **Subscribe** — MLA subscribes to the audit topic's partitions under its consumer group.
4. **Filter on action** — for each record consumed, check `metadata.event.action`. If it is `egress`, discard it immediately (offset still advances normally) and read the next record. Only `start` records continue on to classification (US-MLA-02).
5. **Handle disconnects** — if the broker connection drops, MLA relies on the Kafka client's built-in reconnect/backoff behaviour; the offset is not advanced while disconnected.
6. **Resume** — once reconnected, consumption continues from the last committed offset, so nothing produced during the outage is missed.

## Assumptions

- The Mojaloop audit topic exists on the existing Kafka infrastructure (no new Kafka instance is provisioned for this).
- The audit topic has a 7-day retention policy, which is the agreed recovery window.
- The exact mechanism feeding the audit topic from per-action topics (mirroring vs. in-process publishing) is Open Item #7 in the FSD and is owned by the Mojaloop Partner / CCH. MLA's consumer contract does not depend on the feed mechanism — only on the topic existing and being readable.
- Consumer group ID is configured externally (environment variable or config file), not hardcoded. **See R-18 below — this needs to be a *dedicated* group, not just externally configured.**
- The `start` record for every event type MLA routes on already carries the full payload and headers needed for classification and envelope construction — confirmed against `DRPP_Kafka_E2E_Pack` (5 corridors, zero exceptions). MLA does not need to wait for or merge in anything from the matching `egress` record.

## Todos

1. Get CCH to issue a **dedicated** consumer group ID for this service — a reused DRPP-internal group name risks stealing partition assignments from a live payment-path handler (R-18).
2. Implement the `start`/`egress` filter as the first step after decoding a record off the topic, ahead of classification.
3. Implement offset-resume-on-restart logic and the reconnect/backoff handling.
4. Write tests (Jest, 95% coverage target) covering: `egress` records are discarded without being forwarded, cold start from last committed offset, broker disconnect/reconnect without offset advance, and restart-without-data-loss.
5. Confirm the audit-topic feed mechanism and its guarantees with the Mojoloop Partner (Open Item #7).

# User Stories — Message Ingestion (MLA / PPA)
**Headlines Summary**
Source: CCH_UserStories_MessageIngestion_v1.0.md

---

## Epic 1 — MLA: Kafka Subscription & Audit Topic Ingestion

### US-MLA-01 — Subscribe to the Mojaloop Audit Topic
The MLA must consume all payment events (FX quote, quote, FX transfer, transfer, final-state notification) from a single, dedicated Mojaloop audit topic — not from Mojaloop's per-action primary topics directly. This is the sole Kafka ingress point for the pipeline.

*Acceptance criteria (brief):* MLA subscribes only to the audit topic via one consumer group, resumes from its last committed offset on startup/restart, and reconnects automatically on broker outages without losing data.

### US-MLA-02 — Distinguish Event Types Within the Audit Topic Stream
Because the audit topic carries all event types in a single unified stream, the MLA must classify each consumed message by event type (QUOTE, FXQUOTE, TRANSFER, FXTRANSFER, notification) based on payload shape, not topic name, before routing it to the correct PPA endpoint.

*Acceptance criteria (brief):* Each event type is routed to its correct PPA endpoint (including the FX vs. domestic transfer discriminator), unclassifiable events are skipped with offset advanced and no forwarding, and classification logic is unit-tested against all five types.

### US-MLA-03 — Decode Base64-Encoded Transfer Payloads
Transfer and FX-transfer topic payloads arrive inside the audit topic as base64-encoded `data:` URIs. The MLA must decode these before field extraction or envelope construction. Quote payloads arrive as plain JSON and do not need this step.

*Acceptance criteria (brief):* Transfer/FX-transfer payloads are base64-decoded before processing while quote payloads are read as-is; payloads that fail decoding or aren't valid JSON afterward are treated as unreadable and not forwarded.

---

## Epic 2 — MLA: Envelope Construction & JWS Validation

### US-MLA-04 — Construct a Standard Event Envelope
For every successfully classified and decoded event, MLA wraps the message in a typed Event Envelope before sending it to PPA. The envelope is the contract between MLA and PPA; PPA never reads raw Kafka payloads.

*Acceptance criteria (brief):* Every envelope carries `msgType`, `eventType`, a type-keyed `id`, a unique `correlationId`, source/destination headers, decoded `body`, and `timestamp`; events missing required fields fail envelope construction and are not forwarded.

### US-MLA-05 — Validate JWS Signatures on DFSP-Originated Events
MLA must validate the `FSPIOP-Signature` header (RS256/384/512) on every DFSP-originated event before forwarding it to PPA. Events with a missing or invalid signature are rejected and an operations security alert is raised. The Central Ledger final-state notification is explicitly exempt — it is switch-generated, not DFSP-originated.

*Acceptance criteria (brief):* All DFSP-originated events must pass signature validation against the sending DFSP's registered public key, with missing/invalid signatures rejected and alerted as permanent failures; the Central Ledger notification bypasses this check entirely.

---

## Epic 3 — MLA: Delivery to PPA & Offset Management

### US-MLA-06 — Deliver Envelopes to PPA via Per-Action Endpoints
MLA POSTs each constructed envelope to the appropriate PPA endpoint over mutual TLS. It must not advance the Kafka offset until PPA acknowledges receipt with HTTP 200. This offset-gated handoff is what makes the pipeline's durability guarantee real.

*Acceptance criteria (brief):* Envelopes are routed to the correct PPA endpoint over mTLS, and the Kafka offset only advances after an HTTP 200 receipt acknowledgment — never on any other response or without waiting for PPA to fully finish processing.

### US-MLA-07 — Retry and Circuit-Break on PPA Failures
When PPA returns a 5xx or times out, MLA retries with exponential backoff and jitter before escalating. When PPA returns a 4xx (invalid envelope), MLA logs and advances the offset without retrying. On sustained consecutive failures, the circuit breaker trips and MLA pauses partition consumption rather than continuing to retry against a known-down PPA.

*Acceptance criteria (brief):* 5xx/timeouts trigger up to 3 retries with backoff and jitter; 4xx responses log and advance the offset without retry; and sustained failures trip a circuit breaker that pauses partition consumption until a health probe confirms recovery.

---

## Epic 4 — Notification Filter / Dedup Component

### US-DEDUP-01 — Filter and Deduplicate Central Ledger Final-State Notifications
The Notification Filter/Dedup component sits between the Mojaloop audit topic and MLA. It identifies final-state notification events within the unified audit stream and suppresses duplicate notifications for the same `transferId` before they reach MLA. All other event types pass through unmodified.

*Acceptance criteria (brief):* The first notification per `transferId` is forwarded and duplicates (including conflicting terminal states) are dropped using a durable idempotency store; if the component is unavailable, events pass through unfiltered and PPA's own dedup check acts as the backstop.

---

## Epic 5 — PII Protection Component

### US-PII-01 — Tokenize Party Identity Fields Before MLA Consumption
A dedicated PII protection component sits between the Mojaloop audit topic and MLA. It applies deterministic, keyed tokenization (HMAC with a vault-held secret) to party identity fields (MSISDNs, party names) that are not carried inside the ILP packet, before MLA ever consumes the event. This is not a decrypt/re-encrypt step — it is a one-way substitution at ingress.

*Acceptance criteria (brief):* MSISDN and party-name fields outside the ILP packet are deterministically tokenized using a vault-keyed HMAC (never a bare hash), while ILP-carried fields and transaction amounts remain in cleartext; the component's fail-mode (block vs. pass-through) and key/vault ownership must be confirmed before build.

---

## Epic 6 — PPA: Ingress API & Write-Ahead Persist

### US-PPA-01 — Expose Per-Action Inbound Endpoints Over Mutual TLS
PPA exposes five POST endpoints, one per event type, plus health check endpoints. All are served exclusively over mutual TLS — a connection without a recognised MLA client certificate is rejected at the TLS layer before any application logic runs.

*Acceptance criteria (brief):* All five POST endpoints plus `/health/live` and `/health/ready` exist, and all POST endpoints require a valid MLA client certificate rejected at the TLS layer if missing; PPA returns HTTP 200 only after the write-ahead persist succeeds.

### US-PPA-02 — Write-Ahead Persist Before Acknowledging MLA
Before returning HTTP 200 to MLA, PPA must verify that both ValKey and its own durable write-ahead store are reachable, then write the envelope to the write-ahead store. This is what keeps the event durable if PPA crashes between the ack and completing the processing pipeline.

*Acceptance criteria (brief):* PPA returns 503 if ValKey or the write-ahead store is unreachable or the write fails, and only returns HTTP 200 once the envelope has been durably written; a 503 correctly stops MLA from advancing its offset.

---

## Epic 7 — PPA: Processing Pipeline

### US-PPA-03 — Validate the Incoming Envelope
After acknowledging MLA (step 2), PPA validates the envelope contents asynchronously. An invalid envelope is dead-lettered to the DLQ; it is not forwarded to TMS.

*Acceptance criteria (brief):* Envelopes are checked for required, non-empty fields (`msgType`, `eventType`, `id`, `fspiop-source`, `body`) and a recognised `eventType`; any failure is dead-lettered with the specific failed check logged, and no TMS message is emitted.

### US-PPA-04 — Deduplicate Central Ledger Notification Events
For events received at `/TRANSFERS/NOTIFICATIONS`, PPA applies its own idempotency check as a backstop against duplicates that may have passed through the upstream Notification Filter/Dedup component (see US-DEDUP-01). This check uses PPA's durable write-ahead store, not ValKey.

*Acceptance criteria (brief):* Duplicate notifications (including conflicting terminal states) for the same `transferId` are silently dropped using PPA's durable write-ahead store as the dedup source, applying only to notification events.

### US-PPA-05 — Classify Each Event as Trigger or Enrichment
Every validated event is classified as either a **trigger** (produces exactly one outbound Tazama message) or an **enrichment** (contributes data to the correlation cache only, produces no TMS message). The classification is deterministic based on event type and `msgType`.

*Acceptance criteria (brief):* Each event type/msgType combination maps deterministically to trigger or enrichment per the classification table, is unit-tested for every case including error callbacks, and unclassifiable combinations are logged and dead-lettered.

### US-PPA-06 — Accumulate Enrichment into the Correlation Cache
For enrichment events, PPA merges the event's data into the shared transaction-state entry in ValKey, keyed by the appropriate transaction/quote/conversion ID. This must be an atomic read-modify-write because multiple PPA replicas may process related events concurrently.

*Acceptance criteria (brief):* Enrichment merges into ValKey use an atomic read-modify-write (not a plain read-then-write) keyed appropriately per event type, carry explicit TTLs, and are retained until the transaction's terminal message is sent.

### US-PPA-07 — Discriminate Domestic vs. Cross-Border Transfers
For TRANSFER and FXTRANSFER trigger events, PPA must determine whether the payment is cross-border (in scope, Phase 1) or domestic (out of scope, Phase 1) before assembling a Tazama message. A transfer with no correlated FX-quote state and no FX linkage field (`determiningTransferId`) is domestic and must be discarded silently.

*Acceptance criteria (brief):* Transfers with no cached FX-quote state and no `determiningTransferId` are classified domestic and silently discarded (only a counter metric increments); transfers with either signal proceed to translation as cross-border.

---

## Epic 8 — PPA: ISO 20022 Translation

### US-PPA-08 — Translate Quote Request to pain.001.001.11
When a Quote request (`POST /quotes`) arrives as a trigger, PPA assembles a `pain.001.001.11` message for Tazama. The message is built from the quote request payload plus already-cached FX-quote enrichment (if present). This is one of four messages sent per cross-border payment.

*Acceptance criteria (brief):* pain.001 is assembled from the quote request plus any cached FX-quote enrichment with defined field mappings (including the MSISDN fallback for `Cdtr.Nm`), validated against the pinned Tazama schema before sending, and dead-lettered on local validation failure.

### US-PPA-09 — Translate Quote Callback to pain.013.001.09
When a Quote callback (`PUT /quotes`) arrives as a trigger, PPA assembles a `pain.013.001.09` message. This is the second of the four per-payment Tazama messages. It fires independently of pain.001 — PPA does not wait for any pairing.

*Acceptance criteria (brief):* pain.013 is assembled from the callback with `GrpHdr.MsgId` always PPA-generated (never copied from the wire), locally schema-validated before send, and fires independently without waiting for pain.001.

### US-PPA-10 — Translate Transfer Prepare to pacs.008.001.10
When a Transfer prepare (`POST /transfers`) arrives as a trigger, PPA assembles a `pacs.008.001.10` message from the prepare event plus cached enrichment from up to five prior messages (FX quote request/callback, quote request/callback, party data). This is the third per-payment Tazama message. The prepare event alone triggers the pacs.008 — PPA does not wait for the fulfil.

*Acceptance criteria (brief):* pacs.008 is assembled from the prepare event plus cached enrichment per the defined field-mapping table, applies degraded fallbacks and sentinel constants where enrichment is missing, and writes `transferId → {InstrId, EndToEndId}` to correlation state for later pacs.002 resolution.

### US-PPA-11 — Translate Final-State Event to pacs.002.001.12
When the fulfil callback (`PUT /transfers`) or Central Ledger notification arrives as a trigger, PPA assembles a `pacs.002.001.12` message. This is the fourth per-payment Tazama message. For error callbacks (any resource), PPA also emits pacs.002 with `TxSts: RJCT`.

*Acceptance criteria (brief):* pacs.002 translates `transferState` to the correct ISO `TxSts` (using ACSC, not ACCC, for COMMITTED) and resolves `OrgnlInstrId`/`OrgnlEndToEndId` from cached state written at pacs.008 time so it exactly matches the corresponding pacs.008; error callbacks emit RJCT with empty `ChrgsInf`.

---

## Epic 9 — PPA: Schema Validation, TMS Dispatch & Dedup

### US-PPA-12 — Validate Assembled Message Against Pinned Local Schema Before Send
Before sending any message to TMS, PPA validates the assembled message against a pinned local copy of Tazama's ajv schema for that message type. This catches field-level drift from the pinned `tms-service` version before `removeAdditional: 'all'` on TMS silently strips the offending fields and returns a false HTTP 200.

*Acceptance criteria (brief):* Every assembled message is validated against a version-controlled, pinned local schema copy before the TMS POST is issued; a local validation failure is logged, alerted, and dead-lettered rather than sent to TMS.

### US-PPA-13 — Send Validated Messages to Tazama TMS
PPA dispatches each validated message to the correct version-pinned Tazama TMS endpoint using HTTPS with mutual TLS plus a Keycloak-issued bearer token. Delivery is at-least-once; retries reuse the same pinned message, never a rebuild.

*Acceptance criteria (brief):* Calls go to the version-pinned endpoint over HTTPS with both mTLS and a bearer token present; 5xx/timeouts retry up to 3 times reusing the exact same pinned message, 4xx dead-letters without retry, and success clears ValKey state only once the transaction's terminal message has been sent.

### US-PPA-14 — Prevent Duplicate TMS Submissions with a Sent-Message Dedup Set
To prevent inserting duplicate transaction history into Tazama's graph (e.g. from PPA crash-and-replay), PPA maintains a short-TTL sent-message set in ValKey, keyed by `id + isoMessageType`. A send only proceeds if the key does not already exist (atomic check-and-set).

*Acceptance criteria (brief):* An atomic ValKey check-and-set (`SET ... NX EX`) on `{id}:{isoMessageType}` gates every TMS send, using a separate short-TTL key namespace from the correlation cache; a ValKey failure at this step is a hard-stop that prevents sending rather than risking a duplicate.

---

## Epic 10 — PPA: Error Recovery, DLQ & Missing Correlations

### US-PPA-15 — Dead-Letter Queue: Write, Alert, and Support Replay
PPA's DLQ is the same store as its write-ahead record (one store, two write paths). Every DLQ write raises an operations alert. Replay is manual and operator-triggered, re-injecting an entry from the point it failed. Every replay is audit-logged.

*Acceptance criteria (brief):* DLQ entries carry the full masked envelope, failure reason, retry count, timestamp, and correlationId, with a 90-day retention; every write raises an alert, and replay is operator-triggered only, always producing its own audit log entry.

### US-PPA-16 — Park Correlation State Before ValKey TTL Expiry
When a leg's ValKey correlation state is at risk of expiring before its expected counterpart event has arrived (e.g. a final-state notification that never came), PPA writes the accumulated state to its DLQ/write-ahead store before the TTL lapses. If the late event eventually arrives — even days later — PPA retrieves the parked state and completes correlation from the durable store rather than treating the arrival as unresolvable.

*Acceptance criteria (brief):* PPA proactively writes in-progress leg state to the DLQ before ValKey TTL expiry, and a late-arriving pacs.002-triggering event checks the DLQ for parked state before being treated as unresolvable, extending effective correlation lifetime to the DLQ's 90-day retention.

### US-PPA-17 — Handle Out-of-Order Arrival (Fulfil Before Prepare)
Because the transfer prepare and fulfil are on different Kafka topics and processed by PPA replicas asynchronously, the fulfil's pacs.002 trigger may arrive at PPA before the prepare's pacs.008 trigger. PPA must park the fulfil within a short bounded window and retry rather than discarding it.

*Acceptance criteria (brief):* A pacs.002 trigger with no existing transaction state is held and retried within a short bounded window (reusing the existing retry budget) rather than immediately dead-lettered; if the prepare arrives after the fulfil was eventually dead-lettered, PPA retrieves it from the DLQ to complete correlation.

---

## Epic 11 — Audit Logging, Security & Monitoring

### US-AUD-01 — Write Audit Log Entries for Every Processed Event
Every event processed by PPA produces a full audit log entry covering what came in, what was sent, all timestamps, TMS response, error detail, and whether the message was flagged as degraded.

*Acceptance criteria (brief):* Every audit entry captures correlationId, envelope id, message/event type, timestamps, processing outcome, retry count, TMS response, and degraded flag, with PII masked, stored in a dedicated append-only, Keycloak-role-gated store.

### US-MON-01 — Monitor Consumer Lag, Circuit Breaker State, and Degraded Message Rate
The pipeline's health is invisible without operational telemetry. Four distinct signals must be monitored and alerted on: Kafka consumer lag (leading indicator of backlog), paused-offset rate (lagging indicator), ValKey memory pressure (correlation-loss risk), and the degraded-message rate (the only signal that enrichment sources are systematically missing).

*Acceptance criteria (brief):* Consumer lag, paused-offset rate, ValKey memory pressure, and degraded-message rate are each emitted as metrics and alerted independently, along with circuit-breaker state at both hops, in a Prometheus-compatible format.

### US-MON-02 — Expose Health Endpoints for Load Balancer and Orchestrator
PPA's liveness and readiness probes must be correctly scoped so a transient downstream blip does not take the whole PPA fleet out of load-balancer rotation.

*Acceptance criteria (brief):* `/health/live` checks only process responsiveness while `/health/ready` checks process, config, and write-ahead store only (not ValKey or the TMS token chain), so a downstream blip removes only the affected replica; both respond within 200ms.

---

## Epic 12 — Performance & Infrastructure

### US-PERF-01 — Meet Latency Targets at Sustained and Peak TPS
The pipeline must deliver each Mojaloop event to TMS within the agreed latency budget at both sustained (25 TPS) and peak (125 TPS) throughput, without data loss or unbounded consumer lag growth.

*Acceptance criteria (brief):* MLA ack latency stays ≤200ms p95 and PPA-to-TMS latency ≤500ms p95 under sustained load, consumer lag does not grow unboundedly at peak TPS, and load tests cover sustained, peak, and step-down scenarios without event loss.

### US-PERF-02 — Size and Configure ValKey for Correlation Workload
ValKey must be sized and configured to hold the full in-flight correlation state for cross-border payments at peak TPS, without evicting active keys under memory pressure.

*Acceptance criteria (brief):* ValKey capacity is sized using the TTL × rate × 4-stage × payload-size × safety-factor formula, runs `volatile-lru` eviction with explicit TTLs on all keys, operates as an HA cluster, and alerts on memory pressure before eviction begins.

### US-SEC-01 — Establish mTLS Certificates for MLA↔PPA and PPA↔TMS
All inter-service communication must use mutual TLS. Certificate issuance, rotation, and distribution must be specified, owned, and operational before any service goes to production.

*Acceptance criteria (brief):* Every hop enforces mutual TLS (MLA↔PPA and PPA↔TMS, the latter also requiring a bearer token) with TLS 1.2+, minimum 2048-bit keys, restart-free rotation, and expiry alerts at least 30 days ahead, under a named owning team.

---

*End of Document*

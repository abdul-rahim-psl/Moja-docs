# CCH_FSD_MessageIngestion_v1_2

## FUNCTIONAL SPECIFICATION DOCUMENT

Message Ingestion - Mojaloop to Tazama
(implemented by the Mojaloop Adaptor and Payment Platform Adaptor)
COMESA CLEARING HOUSE × PAYSYS LABS
Tazama Fraud Management Module - Integration Layer

| Document Ref | CCH-PL-FSD-MSGING-001 |
| --- | --- |
| Version | v1.2 |
| Date | 3rd August 2026 |
| Author | Behjet Ansari, Senior Business Analyst - Paysys Labs |
| Classification | Confidential |

Version History

| Version | Date | Author | Summary of Changes |
| --- | --- | --- | --- |
| v1.0 | 20th July 2026 | Behjet Ansari | Baseline version for CCH review |


Contents

1. Introduction ….. 2
2. Glossary ….. 3
3. System Context ….. 5
   - 3.1 How Mojaloop Works ….. 5
   - 3.2 Where Ingestion Fits ….. 5
   - 3.3 Transaction Stages Covered in Phase 1 ….. 5
4. Architecture ….. 7
   - 4.1 Component Overview ….. 7
   - 4.2 Deployment Topology ….. 7
   - 4.3 Failure Isolation Boundaries ….. 7
   - 4.4 Kafka Topic and Consumer Group Model ….. 8
   - 4.5 Correlation State (ValKey) - Scale and HA ….. 8
   - 4.6 Data Handling Note ….. 8
   - 4.7 Dead-Letter Queue (DLQ) ….. 9
5. Mojaloop Adaptor (MLA) ….. 10
   - 5.1 What It Does ….. 10
   - 5.2 Ingress - Kafka Subscriptions ….. 10
   - 5.3 How the MLA Processes Each Event ….. 10
   - 5.4 Event Envelope Structure ….. 10
   - 5.5 Egress - Sending Events to the PPA ….. 11
   - 5.6 Error Handling ….. 11
6. Payment Platform Adaptor (PPA) ….. 12
   - 6.1 What It Does ….. 12
   - 6.2 Ingress - API Endpoints ….. 12
   - 6.3 Processing Pipeline ….. 12
   - 6.4 Correlation - Assembling a Complete Message ….. 14
   - 6.5 ISO 20022 Message Mapping ….. 14
   - 6.6 Egress - Sending to Tazama TMS ….. 16
   - 6.7 Error Handling ….. 16
7. Sample Messages & Transformations - Cross-Border FX Transfer ….. 17
8. End-to-End Flows ….. 19
   - 8.1 Cross-Border Payment with Currency Conversion ….. 19
   - 8.2 Rejected Payment ….. 21
   - 8.3 Callback Never Arrives ….. 21
9. Performance ….. 22
   - 9.1 Performance Assumptions and Targets (TBC) ….. 22
   - 9.2 Latency Budget - MLA→PPA→TMS Hop Chain ….. 22
   - 9.3 Cache (ValKey) Sizing and TTL Policy ….. 23
   - 9.4 Backpressure and Consumer Lag Handling ….. 23
   - 9.5 Retry/Backoff Budget and Failure Isolation ….. 23
   - 9.6 Capacity Planning Guidance ….. 23
10. Security ….. 24
    - 10.1 Transport Security ….. 24
    - 10.2 Authentication & Authorization ….. 24
    - 10.3 Data Protection (PII & Financial Data) ….. 24
    - 10.4 Audit Logging & Monitoring ….. 25
    - 10.5 Alignment with Project Security Baseline ….. 25
11. Phase 1 Exclusions ….. 26
12. Open Items ….. 27

- Annex A - API Endpoint Quick Reference ….. 28
  - A.1 Mojaloop DRPP → MLA (Kafka Topics) ….. 28
  - A.2 MLA → PPA ….. 28
  - A.3 PPA → Tazama TMS ….. 28
- Annex B - Mojaloop Message Body Reference ….. 30

## 1. Introduction

Tazama’s fraud detection is only as good as the transaction picture it receives. Every payment on the COMESA Digital Retail Payment Platform (DRPP) - a Mojaloop-based switch - happens asynchronously and in pieces: a quote request and its answer, a transfer request and its outcome, each as a separate event. For Tazama to evaluate a transaction, those pieces have to be captured, paired back together, and re-expressed in Tazama’s specific ISO 20022 message set.

This document specifies how that happens: message ingestion from Mojaloop into Tazama. It covers what has to be captured, how the pieces of an asynchronous transaction are correlated into one complete record, how that record is translated into Tazama’s specific ISO 20022 message set, and what happens when any step fails, is delayed, or arrives with something the pipeline hasn’t seen before.

Two components implement this ingestion pipeline:

- The Mojaloop Adaptor (MLA) - subscribes to Kafka topics published in and around the DRPP and relays each event onward, unmodified, as a standard envelope.
- The Payment Platform Adaptor (PPA) - receives those envelopes, correlates request/callback pairs, translates the combined data into Tazama’s specific ISO 20022 message set, and dispatches it to the Tazama Transaction Monitoring Service (TMS).

This document also covers the non-functional dimensions of ingestion - architecture, performance, and security - that determine whether the pipeline is fit for a live production payment switch, not just functionally correct on the happy path. (Infrastructure - hosting, sizing of underlying compute/network - is covered separately in the Infrastructure Design Document and is out of scope here.)

It is written for both technical and non-technical reviewers.

## 2. Glossary

| Term | Meaning |
| --- | --- |
| MLA | Mojaloop Adaptor. Subscribes to Kafka topics and relays events to the PPA. |
| PPA | Payment Platform Adaptor. Correlates, translates, and forwards events to Tazama’s TMS. |
| DRPP | Digital Retail Payment Platform. COMESA’s Mojaloop-based payment switch. |
| DFSP | Digital Financial Services Provider. A bank or mobile money provider on the switch. |
| Quoting Service | The Mojaloop service that handles quote requests and FX quote requests. |
| ML API Adapter | The Mojaloop service that handles transfer and FX transfer requests. |
| Central Ledger | The Mojaloop service that settles transfers and publishes the final transfer-state notification event. Distinct from the ML API Adapter - see §4.1. |
| TMS | Tazama’s Transaction Monitoring Service. Evaluates transactions against fraud rules. |
| Kafka topic | A persistent, ordered event channel. Services publish events to it; subscribers read from it. |

| Term | Meaning |
| --- | --- |
| FSPIOP | Mojaloop’s legacy FSP-facing header/auth scheme (e.g. FSPIOP-Source/Destination, JWS signing). Message bodies are referenced by ISO 20022 message type throughout this document; FSPIOP terminology is retained only for these transport-level headers. |
| ISO 20022 | International financial messaging standard, used by both Mojaloop and Tazama - but as two distinct message sets. The PPA translates Mojaloop’s ISO 20022 messages into Tazama’s specific ISO 20022 message set. |
| Async callback | Mojaloop’s response pattern: the switch immediately returns HTTP 202 Accepted, then delivers the actual result later via a callback to a registered endpoint. |
| Ingress event | A message published to Kafka when an FSP sends a request to the switch (e.g. a `POST /quotes` quote request, a `POST /transfers` transfer prepare). |
| Callback event | A message published to Kafka when the switch sends the result back to the requesting FSP (e.g. a `PUT /quotes` quote callback, a `PUT /transfers` fulfil). |
| Event Envelope | The wrapper the MLA uses to package a Kafka event before sending it to the PPA. |
| Correlation | The PPA’s process of matching an ingress event with its corresponding callback event using the shared transaction/quote/transfer ID. |
| ValKey cache | Short-term memory (Redis-compatible) the PPA uses to hold an ingress event while waiting for the matching callback event. |
| ILP packet | A cryptographic packet attached to a quote response and carried into the transfer to prove the transfer terms were not changed. ${ }^{1}$ |
| Condition | A SHA-256 hash included in a transfer request. The switch checks the corresponding fulfilment against this before committing. |
| FSPIOP-Source / Destination | FSPIOP headers identifying which DFSP sent a message and which DFSP should receive the callback. ${ }^{2}$ |
| JWS | JSON Web Signature. Mojaloop’s request-integrity signing scheme (RS256/384/512 over method, FSPIOP-URI, Source/Destination headers, and body). See §10.2. |
| mTLS | Mutual TLS - both client and server present certificates, used between trusted internal services. See §10.1. |
| Notification Filter / Dedup | The component responsible for de-duplicating Central Ledger’s transfer-notification events before they reach MLA/PPA. See §4.1, §6.4. |
| Idempotency key | A unique identifier (e.g. transferld + state) used to detect and discard duplicate events for the same logical outcome. |
| DLQ | Dead-Letter Queue/Log. Where events that exhaust retries are placed for manual investigation. |

| [1](about:blank#fn1) | Term |
| --- | --- |
| Tokenization | Replacing a sensitive field’s real value with a non-reversible substitute token, as an alternative to encryption for PII fields. See §10.3. |

## 3. System Context

### 3.1 How Mojaloop Works

Whenever an FSP submits a request to the Mojaloop Switch - whether for a quotation or transfer initiation - the Switch immediately responds with an HTTP 202 Accepted status. The substantive outcome, including the agreed quotation terms or transfer confirmation, is subsequently delivered through a separate callback message to the FSP’s registered endpoint.

Accordingly, each transaction on the DRPP network generates at least two distinct events for every action: an outbound request event and a corresponding inbound callback event. The MLA captures these directly from Kafka. The PPA is responsible for correlating these events to establish the complete transaction flow.

### 3.2 Where Ingestion Fits

![](CCH_FSD_MessageIngestion_v1_0/imagesdb35d88f-73cd-4da1-a673-2f7d9f8b3685-06_449_1420_1119_269.jpg)

Message ingestion pipeline: DRPP (Mojaloop) through to Tazama’s evaluation pipeline

### 3.3 Transaction Stages Covered in Phase 1

A complete Mojaloop payment goes through up to two stages. The MLA and PPA handle events from both. Each stage produces both a request event and a callback event on Kafka. ${ }^{3}$

Tazama ingests exactly four ISO 20022 message types - `pain.001`, `pain.013`, `pacs.008` and `pacs.002` - so the Mojaloop stages below map onto those four and no others. The FX stages carry data that is folded into the messages for the stage they support, rather than producing messages of their own (§6.4.1, §6.5.3).

| Stage | Mojaloop Service | Request Event | Callback Event | Produces for Tazama | Phase 1? |
| --- | --- | --- | --- | --- | --- |
| 1 - Quote | Quoting Service | `POST /quotes` | `PUT /quotes` | **pain.001** (request), **pain.013** (callback) | ◯ Yes - subject to the `QUOTING` gate (§6.5.7) |
| 1a - FX Quote | Quoting Service | `POST /fxQuotes` | `PUT /fxQuotes` | None - enrichment only (source amount, exchange rate) | ◯ Yes (crossborder) |

| Stage | Mojaloop Service | Request Event | Callback Event | Produces for Tazama | Phase 1? |
| --- | --- | --- | --- | --- | --- |
| 2 - Transfer | ML API Adapter (request) / Central Ledger (notification) | `POST /transfers` (prepare) | `PUT /transfers` (fulfil); Central Ledger notification (final state) | **pacs.008** (prepare), **pacs.002** (final state) | ◯ Yes |
| 2a - FX Transfer | ML API Adapter | `POST /fxTransfers` | `PUT /fxTransfers` | None - correlation and audit only | ✓ Yes (crossborder) |
| Error path | Any service | Any of the above | Error callback, any resource | **pacs.002** (`TxSts: RJCT`) | ✓ Yes (all stages) |

Note: The final transfer-state notification is published by Central Ledger, not by the ML API Adapter. It notifies the payee that the transfer was committed, is not itself a response from the payee, and may be emitted more than once per transaction - it must be de-duplicated before being treated as a distinct event (§4.1, §6.4). It carries the final transfer state and is required for Tazama to receive.

## 4. Architecture

### 4.1 Component Overview

| Component | Responsibility | Status | Failure impact if down |
|---|---|---|---|
| **MLA** | Consumes Kafka topics (quotes, transfers, FX variants, notifications); wraps each event in an Event Envelope; POSTs to PPA | Existing, topic list corrected (§4.4) | Kafka consumer lag builds; no impact to live payments |
| **Notification Filter / Dedup** | Consumes Central Ledger's `topic-notification-event`; suppresses duplicate final-state notifications for the same transfer before MLA/PPA processes them | **New** — ownership (MLA-side vs. PPA-side) is an open item (§12) | Without it, duplicate `pacs.002` messages may reach TMS |
| **PPA** | Correlates request/callback pairs via the ValKey cache; translates the combined data to Tazama's specific ISO 20022 message set; sends to TMS | Existing | Payments unaffected; fraud pipeline stalls until restored |
| **ValKey cache** | Holds one half of a correlation pair until its match arrives or the TTL expires | Existing | Halts PPA processing (§6.7) — a deliberate hard-stop, not a silent data-loss path |
| **Tazama TMS** | Evaluates translated messages against fraud rules | Existing/external | Out of scope for this document |

### 4.2 Deployment Topology

MLA and PPA are independently deployable, independently scalable services connected by a synchronous HTTP handoff gated on Kafka offset commits (§5.3, §6.3). Hosting location (Paysys DC vs. COMESA infrastructure) is tracked as Open Item #5 and covered in the separate Infrastructure Design Document.

PPA is stateless application logic backed entirely by the external ValKey cache, and is horizontally scalable behind a load balancer; MLA can distribute calls across PPA replicas.


### 4.3 Failure Isolation Boundaries

- **PPA ack-before-durability**: PPA acknowledges MLA at step 1 of its processing pipeline (§6.3), before validation, correlation, translation, or the TMS send have run — and MLA commits its Kafka offset on that same ack (§5.3 step 7). If PPA crashes after acking but before completing the pipeline, the event has no way back: the Kafka offset is already committed, so it can't be replayed, and nothing else yet holds it durably. This needs an explicit decision — PPA persists the envelope to its own durable store before acking, or MLA's offset commit is deferred until PPA confirms durable acceptance rather than bare receipt.
- **MLA ↔ PPA**: coupled via Kafka-offset-gated HTTP handoff (§5.3 step 6) — MLA only commits a Kafka offset after PPA acknowledges receipt with HTTP 200. A PPA outage back-pressures MLA's Kafka consumption per-partition; it never touches the live payment switch, since MLA is a passive subscriber.
- **Central Ledger dedup**: if the Notification Filter/Dedup component is unavailable, the pipeline must make an explicit choice — either drop notification events (favoring no-duplicates-to-TMS over completeness) or pass them through with dedup deferred to a PPA-side idempotency key. This decision is currently unresolved and is tracked as Open Item (§12).
- **ValKey unavailable**: MLA/PPA halts processing and does not commit Kafka offsets (§6.7) — this is a correct, deliberate hard-stop, not a gap, but it makes ValKey HA a release-blocking NFR (§4.5).



### 4.4 Kafka Topic and Consumer Group Model

Mojaloop publishes on per-action topics rather than on consolidated per-service topics. Confirmed technical discovery gives the following list:

| Topic | Published By | Events Carried |
| --- | --- | --- |
| topic-quotes-post | Quoting Service | `POST /quotes` request - source for **pain.001** |
| topic-quotes-put | Quoting Service | `PUT /quotes` response or error callback - source for **pain.013** |
| topic-fx-quotes-post | Quoting Service | `POST /fxQuotes` request - enrichment only |
| topic-fx-quotes-put | Quoting Service | `PUT /fxQuotes` response or error callback - enrichment only |
| topic-transfer-prepare | ML API Adapter | pacs. 008 (request) |
| topic-transfer-fulfil | ML API Adapter | pacs. 008 (fulfil, reject, abort, or error callback) |
| topic-notification-event | Central Ledger | Final transfer-state notification - pacs. 002 (may repeat requires dedup, §4.1) |

FX transfer topics (topic-fx-transfer-* equivalents) follow the same per-action pattern and remain to be confirmed for Phase 1 scope (Open Item #13, §12). Bulk-quote and admin/position topics exist in the Mojaloop deployment but are not required for Phase 1 P2P monitoring.

NFR - dedicated consumer group required: MLA/PPA consumers must run under a new, dedicated Kafka consumer group and must never reuse Mojaloop’s own internal consumer group names (e.g. group-
quotes-handler-post, ml-group-notification-event). Sharing a group can steal partitions from Mojaloop’s own core-service handlers, which is a live-payment-path risk, not just a monitoring-pipeline one.

### 4.5 Correlation State (ValKey) - Scale and HA

- Sizing is driven by TTL × in-flight request rate × average payload size - see §9.3 for the full formula, which depends on the TPS assumption in §9.1.
- ValKey must run as a highly-available cluster; correlation-cache downtime is a deliberate hard-stop for the whole pipeline (§6.7), which makes ValKey HA a release-blocking requirement rather than an operational nice-to-have.
- Eviction policy should be volatile-lru, since every correlation key carries an explicit TTL by design.

Note - distinct from Tazama’s internal cache: Tazama’s TMS/rule-evaluation layer maintains its own, separate Redis cache (used for NetworkMap, TypologyConfig, and transaction-context caching by the Event Director, Rule Processors, and Typology Processor). That cache is internal to Tazama and out of scope for this document - it is not the same instance as the PPA’s ValKey correlation cache described above, and the two should not be conflated when reading this FSD alongside Tazama-internal architecture documentation.

### 4.6 Data Handling Note

Two distinct operations were previously conflated under a single “Decrypt” step (old §5.3 step 3):

1. Payload decoding - transfer-topic payloads arrive as a base64-encoded data: URI. This is a transport encoding, not a security control, and must be decoded before fields such as transferld, amount, condition, payerFsp, payeeFsp can be extracted. Quote payloads arrive as plain JSON and do not need this step.
2. Payload decryption - a genuine cryptographic control, only relevant if/when field-level or transport-level encryption is introduced. This is addressed as a data-protection decision in §10.3, not as a processing-pipeline mechanic.

The processing pipeline in §6.3 reflects this split.

### 4.7 Dead-Letter Queue (DLQ)

- Owner: Paysys Tech - a single shared DLQ store, written to by both MLA (§5.6) and PPA (§6.7).
- Storage: a dedicated durable store (not Kafka) - e.g. a database table or object-storage bucket keyed by event ID and timestamp, holding the full envelope/payload plus failure reason and retry count.
- Retention: 90 days by default (TBC - align with audit-log retention policy once confirmed), then purged or archived per CCH compliance policy.
- Replay: manual, operator-triggered - re-injects a DLQ entry back into the pipeline from the point it failed, without needing a fresh Kafka event; every replay is itself audit-logged.
- Alerting: every DLQ write raises an operations alert (§5.6, §6.7); tool/destination tracked separately in §12 Open Items.

## 5. Mojaloop Adaptor (MLA)

### 5.1 What It Does

The MLA subscribes to Kafka topics carrying Mojaloop payment events. Every time a payment event is published - whether an FSP’s outgoing request or the switch’s incoming callback - the MLA picks it up, wraps it in a standard Event Envelope, and sends it to the PPA. The MLA performs no transformation or business logic of any kind.

### 5.2 Ingress - Kafka Subscriptions

The MLA subscribes to the per-action topics defined in §4.4. Full topic list is maintained in Annex A. 1 to avoid duplicating it here.

Topic names for the FX quote/transfer channel are to be confirmed with the Mojaloop Implementation Partner at the JAD workshop (Open Item #13, §12).

### 5.3 How the MLA Processes Each Event

1. A new event appears on a subscribed Kafka topic.
2. The MLA reads the raw message and checks that it is a valid, well-formed JSON payload.
3. If the topic carries a base64-encoded data: URI body (transfer/FX-transfer topics - §4.6), the MLA decodes it to recover the underlying JSON.
4. The MLA extracts the key identification fields: message type (request, callback, or the Central Ledger notification), resource type (QUOTE, TRANSFER, FXTRANSFER, etc.), the transaction/quote/transfer ID, the FSPIOP-Source, and the FSPIOP-Destination.
5. The MLA wraps these fields and the original message body into an Event Envelope (see §5.4).
6. The MLA sends the envelope to the PPA via a secure API call and waits for HTTP 200.
7. Only after receiving HTTP 200 does the MLA commit the Kafka offset, confirming the event has been handled. If the PPA does not respond as expected, the offset is not committed and the retry policy applies (§5.6).

### 5.4 Event Envelope Structure

The Event Envelope is the standard wrapper the MLA uses for every event it sends to the PPA:

| Field | Type | Description |
|---|---|---|
| `msgType` | string | Type of the original event: request, callback, or the Central Ledger notification type |
| `eventType` | string | Resource type: `QUOTE`, `FXQUOTE`, `TRANSFER`, or `FXTRANSFER` |
| `id` | string | The unique ID for this transaction leg. See per-type scheme below. |
| `correlationId` | string | Technical trace ID (e.g. UUID), generated by the MLA per event — distinct from the business `id` above. Propagated through PPA, ValKey, audit logs, DLQ, and the outbound TMS call for cross-component tracing. |
| `fspiop-source` | string | `FSPIOP-Source` header value: identifies the DFSP that originated the request |
| `fspiop-destination` | string | `FSPIOP-Destination` header value: identifies the intended recipient DFSP |
| `body` | object | The full original message body (decoded, if applicable — §4.6) |
| `timestamp` | string | ISO 8601 datetime of when the MLA consumed the event from Kafka |

**`id` scheme by resource type:**

| eventType | id format |
|---|---|
| QUOTE | `quoteId` |
| FXQUOTE | `conversionRequestId` |
| TRANSFER | `transferId` |
| FXTRANSFER | `commitRequestId` |

> `fspiop-source` and `fspiop-destination` are **mandatory** in the envelope. They identify which DFSPs are involved in the transaction and are required by the PPA for routing and audit purposes.

### 5.5 Egress - Sending Events to the PPA

| Event Type | PPA Endpoint | Covers |
| --- | --- | --- |
| QUOTE or FXQUOTE (any msgType) | POST /QUOTES | All quote and FX quote events - requests and callbacks |
| TRANSFER or FXTRANSFER (any msgType) | POST /TRANSFERS | All transfer and FX transfer events - requests, callbacks, and final-state notifications |

Every API call to the PPA is sent over HTTPS (mTLS recommended - §10.1) and includes a bearer token. The PPA responds with HTTP 200 to confirm receipt. The MLA does not wait for the PPA to finish processing - just to confirm it received the envelope.

### 5.6 Error Handling

| Situation | MLA Behaviour |
| --- | --- |
| PPA returns HTTP 200 | Commit Kafka offset. Log success. Move to next event. |
| PPA returns a 4xx error | Log the full envelope as an error - do not retry. A 4xx means the envelope itself is invalid; retrying will not help. Raise an operations alert. |
| PPA returns a 5xx error or times out | Apply retry policy: up to 3 attempts with exponential back-off and jitter (base $1 \mathrm{~s} / 2 \mathrm{~s} / 4 \mathrm{~s}$ - see §9.5 for the rationale for adding jitter). If a circuit breaker (§9.5) has tripped due to consecutive failures, fail fast to the dead-letter log instead of retrying. If all retries are exhausted, place the event in the dead-letter log and raise an alert. Do not commit the Kafka offset. |
| The Kafka message is invalid or unreadable | Skip it. Log the issue. Never forward broken data to the PPA. |
| The Kafka broker is temporarily unreachable | Wait and reconnect automatically using the Kafka client’s built-in reconnect logic. |

## 6. Payment Platform Adaptor (PPA)

### 6.1 What It Does

The PPA is the translation and correlation engine. It receives event envelopes from the MLA, accumulates transaction state across the events that belong to one payment, and on each event that warrants an outbound message it assembles a complete message in Tazama’s specific ISO 20022 message set and sends it to the Tazama TMS. Every step is logged for audit.

### 6.2 Ingress - API Endpoints

| Endpoint | Method | Purpose |
| --- | --- | --- |
| /QUOTES | POST | Receives all quote and FX quote events from the MLA |
| /TRANSFERS | POST | Receives all transfer and FX transfer events from the MLA (including final-state notifications) |
| /health | GET | Health check - returns 200 if the PPA is running; used by monitoring tools |
- All endpoints are served over HTTPS only (mTLS recommended - §10.1).
- Every POST request must carry a valid JWT bearer token. Requests without one are rejected with HTTP 401.
- The PPA returns HTTP 200 immediately on receipt and processes the envelope asynchronously.

### 6.3 Processing Pipeline

Every event envelope received follows these steps in sequence:

| # | Step | Detail |
| --- | --- | --- |
| 1 | Acknowledge | Return HTTP 200 to the MLA immediately. All processing from this point is async. |
| 2 | Validate | Check that the envelope is complete: required fields present (msgType, eventType, id, fspiop-source, body), body is non-null, eventType is recognised. |
| 3 | Dedup (notification events only) | For events sourced from the Central Ledger notification topic, check the idempotency key (transferld + final state) against previously processed notifications; discard duplicates before proceeding (§4.1, §6.4). |
| 4 | Decrypt | Body arrives already decoded by the MLA (§5.3 step 3, §5.4) - no decoding happens at this step. Decrypt any fields protected under the scheme defined in §10.3, if enabled. |
| 5 | Cache check | Look up the accumulated transaction state in ValKey on the correlator for this stage (§6.4.4). Determine whether this event is a **trigger** - one that produces an outbound TMS message - or an **enrichment** event that only contributes state (§6.4.1). |
| 6 | Store or assemble | Enrichment event: merge into the cached transaction state and stop. Trigger event: read the accumulated state and assemble the outbound message from it plus the trigger's own content (§6.4.3). |
| 7 | Translate | Build one complete message in Tazama’s specific ISO 20022 message set. Apply the field mapping rules (§6.5, with worked examples in §7). Generate the header fields Mojaloop does not supply and copy those it does (§6.5.5). Note that `NbOfTxs` and `SttlmMtd` are **sourced from Mojaloop**, not generated. |
| 8 | Send to TMS | POST the completed message to the correct Tazama TMS endpoint for that message type. |
| 9 | Handle TMS response | HTTP 200: log success. **Do not clear the transaction state on the pacs.008** - the pacs.002 still needs it for identifier resolution (§6.4.5). State is cleared only after the terminal message for the transaction, or on TTL expiry (§6.4.6). Error or timeout: apply retry policy (§6.7); log and alert if all retries exhausted. |
| 10 | Audit log | Write a full audit entry: what came in, what was sent, all timestamps, TMS response, any errors — masked per §10.4. |

### 6.4 Correlation - Assembling a Complete Message

Because Mojaloop is asynchronous, a single payment produces many separate Kafka events, each carrying different data. The TMS needs complete messages assembled from them.

A simple request-callback pairing pattern - pair each request event with its callback, combine the two, emit - holds for the quote stages, but **not for the transfer stage**. Applying it there produces pacs.008 and pacs.002 messages that pass TMS validation while silently carrying degraded data (§6.4.3), because the transfer prepare and fulfil are not a symmetric request/response pair the way a quote and its callback are.

#### 6.4.1 Two kinds of event

| | Definition | Behaviour |
| --- | --- | --- |
| **Trigger event** | An event that causes an outbound TMS message | Read the accumulated state, assemble, send |
| **Enrichment event** | An event that contributes data but produces no TMS message of its own | Merge into cached state, stop |

Across the full payment:

| Mojaloop event | Role | Produces |
| --- | --- | --- |
| `PUT /parties` callback | Enrichment | - |
| `POST` / `PUT /fxQuotes` | Enrichment | - |
| **`POST /quotes`** | **Trigger** + enrichment | **pain.001** |
| **`PUT /quotes`** | **Trigger** + enrichment | **pain.013** |
| `POST` / `PUT /fxTransfers` | Correlation/audit only | - |
| **`POST /transfers` (PREPARE)** | **Trigger** | **pacs.008** |
| **Final-state event (FULFIL / notification)** | **Trigger** | **pacs.002** |
| **Error callback** | **Trigger** | **pacs.002** (`TxSts: RJCT`) |

The two quote events carry a **dual role**. Each produces its own TMS message - `POST /quotes` → pain.001, `PUT /quotes` → pain.013 - and each also contributes fields that the later pacs.008 needs and cannot obtain anywhere else (§6.4.3). Emitting the quote-stage message does not discharge the cached state; it is retained for the transfer stage.

The transfer **prepare** is a trigger on its own, not half of a pair: it produces the pacs.008 immediately, rather than waiting for the fulfil. Waiting would destroy the pre-settlement evaluation window - the two are about one second apart (§6.5.4).

Neither FX stage produces a TMS message. The FX quote supplies the source amount and exchange rate that the quote-stage and transfer-stage messages carry (§6.5.3); the FX transfer restates amounts already agreed at the FX quote and is retained for correlation and audit only.

#### 6.4.2 What each Mojaloop event carries

| Stage | Request Event Carries | Callback Event Carries |
| --- | --- | --- |
| Quote (`/quotes`) | payer & payee identity, quoteld, transactionld, amountType, amount, transactionType | transferAmount, payeeReceiveAmount, fees, expiration, ilpPacket, condition |
| FX Quote (`/fxQuotes`) | conversionRequestld, conversionTerms (initiatingFsp, counterPartyFsp, sourceAmount, targetCurrency, expiration) | conversionId, agreed targetAmount, condition, expiration, charges |
| Transfer (`/transfers`) | transferld, payerFsp, payeeFsp, amount, expiration, ilpPacket, condition | fulfilment, completedTimestamp, transferState (COMMITTED / ABORTED) |
| FX Transfer (`/fxTransfers`) | commitRequestld, determiningTransferId, initiatingFsp, counterPartyFsp, sourceAmount, targetAmount, condition, expiration | fulfilment, completedTimestamp, conversionState |
| Final-state notification (Central Ledger, pacs.002) | - | completedTimestamp, transferState - may be emitted more than once per transfer; deduplicated at pipeline step 3 (§6.3) before being treated as a distinct event |
| Error callback (pacs.002) | - | errorInformation with errorCode and errorDescription |

The transfer request row understates what is available: the prepare's `ilpPacket` **decodes** to a structured object carrying both parties' identifiers, both fspIds, the payer's name, the transaction type and the `transactionId` (§6.5.4, §7). It is a data source, not opaque material.

#### 6.4.3 Cross-stage enrichment - formalized

A pacs.008 assembled from the transfer prepare alone is schema-valid but materially degraded. The following field-to-stage provenance is **normative**; the leaf-level detail is in `message mapping/pacs 002-008/03_pacs008_mapping.md` and `message mapping/pain001-013/`.

**pain.001** - trigger: `POST /quotes`

| Contributing stage | Fields it supplies |
| --- | --- |
| **Quote request** (trigger) | `PmtInf.PmtInfId` (`quoteId`); `PmtId.EndToEndId` (`transactionId`); `Amt.InstdAmt`; `GrpHdr.InitgPty` and `Dbtr` (name, date of birth, identifiers); `DbtrAcct`; `CdtrAgt`; `Cdtr` + `CdtrAcct` identifiers; `Purp.Cd`; `PmtTpInf.CtgyPurp.Prtry`; `RmtInf.Ustrd`; `SplmtryData…Doc.Dbtr` (`FrstNm`/`MddlNm`/`LastNm` from `complexName`); `SplmtryData…Doc.Cdtr.MrchntClssfctnCd` |
| Party lookup callback | `Cdtr.Nm`, `CdtrAcct.Nm` - the **only** source of the payee name |
| FX quote request + callback | `Amt.EqvtAmt` (converted amount + `CcyOfTrf`), `Amt.EqvtAmt.XchgRateInf.XchgRate` |
| PPA-generated | `GrpHdr.MsgId`, `GrpHdr.CreDtTm`, `PmtInf.PmtInfId`, `PmtTpInf`, `ChrgBr` (§6.5.7), `RgltryRptg`, `SplmtryData` |

**pain.013** - trigger: `PUT /quotes`

| Contributing stage | Fields it supplies |
| --- | --- |
| **Quote callback** (trigger) | `ChrgBr`; `PmtInf.XpryDt.DtTm` (quote expiration); `GrpHdr.MsgId`/`CreDtTm` (from `extensionList`); `SplmtryData…Doc.PyeeRcvAmt`, `PyeeFinSvcsPrvdrFee`, `PyeeFinSvcsPrvdrComssn` |
| Cached quote-request state | `PmtInf.PmtInfId`; `PmtId.EndToEndId`; `GrpHdr.InitgPty`; `Dbtr` and date of birth; `DbtrAcct`; `Cdtr` + `CdtrAcct` identifiers; `Purp.Cd` |
| Party lookup callback | `Cdtr.Nm`, `CdtrAcct.Nm` |
| FX quote request + callback | `Amt.EqvtAmt` (converted amount + `CcyOfTrf`) |
| PPA-generated | `GrpHdr.MsgId`, `GrpHdr.CreDtTm`, `PmtInf.PmtInfId`, `PmtTpInf`, `RgltryRptg`, `SplmtryData` |

`pain.013` carries no `XchgRateInf` element, so the exchange rate is expressed on the `pain.001` and on the `pacs.008` only.

**pacs.008** - trigger: transfer PREPARE

| Contributing stage | Fields it supplies |
| --- | --- |
| **Transfer PREPARE** (trigger) | `PmtId.InstrId`; `PmtId.EndToEndId` (decoded ILP `transactionId`); `IntrBkSttlmAmt`; `DbtrAgt`; `CdtrAgt`; `Cdtr` + `CdtrAcct` identifiers; `Dbtr` identifiers; `SplmtryData…Xprtn` |
| Party lookup callback | `Cdtr.Nm`, `CdtrAcct.Nm` - the **only** source of the payee name |
| Quote request | `Dbtr.Nm` (legal name), `Dbtr…BirthDt`, `DbtrAcct.Nm`, `Purp.Cd`, `RmtInf.Ustrd` |
| Quote callback | `ChrgBr`, `ChrgsInf`, `GrpHdr.SttlmInf.SttlmMtd`, `GrpHdr.NbOfTxs` |
| FX quote request + callback | `InstdAmt` (source amount), `XchgRate` |
| PPA-generated | `GrpHdr.MsgId`, `GrpHdr.CreDtTm`, `RgltryRptg`, `SplmtryData…Glctn` |

**pacs.002** - trigger: final-state event

| Contributing stage | Fields it supplies |
| --- | --- |
| **Final-state event** (trigger) | `TxSts` (translated - §6.5.4), `AccptncDtTm`, `InstgAgt`/`InstdAgt` (from `fspiop-source`/`fspiop-destination` headers), `GrpHdr.MsgId`/`CreDtTm` where supplied |
| Cached state | `OrgnlInstrId`, `OrgnlEndToEndId` (identifier resolution - §6.4.5); `ChrgsInf` |

**Degraded operation.** If enrichment state is missing - cache miss, late callback, or a scheme with no quote stage - the pacs.008 is still assembled from the prepare alone, with these losses:

| Lost | Falls back to |
| --- | --- |
| Payee name | Payee MSISDN |
| Payer legal name, date of birth | ILP packet's display name; sentinel date |
| `ChrgBr`, `ChrgsInf` | `SLEV`, zero charge |
| `InstdAmt` source amount, `XchgRate` | `InstdAmt` = `IntrBkSttlmAmt`; rate omitted |
| `RmtInf.Ustrd` | Empty string |

**Degraded messages are structurally valid and indistinguishable from complete ones at the TMS door**, so the PPA must flag them in the audit log.

#### 6.4.4 Cache keys and lifetime

| Purpose | Key |
| --- | --- |
| Transaction state, all stages | `transactionId` / `transferId` |
| Quote stage | `quoteld` |
| FX quote stage | `conversionRequestId` |
| FX transfer stage | `commitRequestld` |
| **Party lookup** | **Payee MSISDN (party identifier)** |

The party-lookup entry is the exception: `PUT /parties` arrives **before any transaction identifier exists**, so it cannot be keyed on the transaction. It is keyed on the party identifier, and concurrent transactions to the same payee share it. Acceptable for a name lookup; **must not** be extended to transaction-scoped data.

State is retained until the terminal message for the transaction has been sent, not until the pacs.008 (§6.3 step 9). TTL sizing is in §9.3.

#### 6.4.5 Identifier resolution - why pacs.002 still needs a lookup

The pacs.008's `EndToEndId` is the `transactionId` carried in the decoded ILP packet. The final-state event carries `transferId`. FSPIOP models these as **distinct fields**; in the golden path they happen to be the same ULID, but the PPA must not assume that.

Therefore, when the pacs.008 is emitted the PPA writes `transferId → { InstrId, EndToEndId }` into the transaction state, and the pacs.002 resolves its `OrgnlInstrId` / `OrgnlEndToEndId` from that entry.

This is a **small, bounded lookup for identifiers only**, not a full enrichment read - but it is required. Without it, any transaction where `transactionId ≠ transferId` produces a pacs.002 whose `OrgnlEndToEndId` never matches its pacs.008. TMS accepts it; Tazama's own DataCache retrieval (keyed `TenantId:EndToEndId`, falling back to a pacs.008 rebuild) then finds nothing, and the transaction silently never completes a chain.

#### 6.4.6 Missing events and TTL expiry

Behaviour differs by stage, because the pacs.008 is no longer withheld pending the fulfil:

| Situation | PPA behaviour |
| --- | --- |
| A quote-stage or party-lookup callback never arrives | Cache entry expires. If the prepare then arrives, emit a **degraded** pacs.008 (§6.4.3) and flag it in the audit log. If no prepare follows, discard silently |
| The final-state event never arrives | The pacs.008 has already been sent. Log a timeout and raise an alert. **Never synthesize a pacs.002** - Tazama must not be told a payment settled on the strength of a prepare |
| An error callback arrives with no cached transaction | Cannot resolve `OrgnlInstrId`/`OrgnlEndToEndId` (§6.4.5). Log and alert; do not forward an unlinkable message |

#### 6.4.7 Open decision - the pacs.002 trigger

Two candidate triggers carry `transferState` and `completedTimestamp`:

- the **Central Ledger notification** (`topic-notification-event`), deduplicated at §6.3 step 3, and
- the **FSPIOP fulfil callback** (`PUT /transfers`), which the mapping in §6.5 and §7 currently uses.

The corridor capture in §7 is an **FSPIOP wire capture containing no Kafka events**, so the notification was not available to verify a mapping from.

Settling this requires a Kafka-side capture from CCH, and turns on one question: **does the Central Ledger notification carry `fspiop-source` and `fspiop-destination`?** `InstgAgt` and `InstdAgt` are required fields sourced from those headers (§6.4.3). If it does, the notification is preferable - it is the authoritative settlement record. If it does not, the fulfil callback is the only viable trigger.

Until resolved, the mapping documents the fulfil callback and flags the dependency. Tracked as an open item.

### 6.5 ISO 20022 Message Mapping

The PPA assembles each outbound message for Tazama's specific ISO 20022 message set and POSTs it to the TMS API. The mapping below is **verified**: every rule marked ✅ has been applied to the real DRPP cross-border golden path (trace `67629f2771f9ca3e58ae98d2b525ff82`) and the resulting payloads validated against Tazama's live ingestion schemas.

#### 6.5.1 The ingestion contract

Three facts about Tazama's TMS API govern everything in this section. All three were verified against `tazama-lf/tms-service` and are easy to get wrong.

**1. The validator is `src/schemas/pacs.008.json` / `pacs.002.json`, enforced by ajv — not `swagger.yaml`.**
`swagger.yaml` is documentation only and is **stale**: it declares `Othr` as an object where the real schema requires an array, and Tazama's own `frms-coe-lib` sample fails it in four places. Design against the ajv schemas.

**2. TMS runs ajv with `removeAdditional: 'all'`.** Any property not declared in the schema is **silently deleted**. There is no extension mechanism and no error — a message carrying unmapped fields returns HTTP 200 with those fields discarded. This is the single most important constraint in this section: *an incorrect mapping does not fail loudly, it succeeds quietly and loses data.*

**3. `TenantId` must NOT be sent.** Both schemas declare `"not": { "required": ["TenantId"] }` — including it causes rejection. TMS injects the tenant from the **JWT bearer token** (`validateTenantMiddleware.ts`). The tenant identity travels in the token, not the payload. Note this contradicts the `frms-coe-lib` TypeScript interfaces, which mark `TenantId` mandatory; those describe the *post-ingestion* internal message.

ajv also runs with `coerceTypes: 'array'` (so `"1"` is coerced to `1`) and `useDefaults: true` (so `TxTp` is auto-filled). Coercion is a safety net, not a licence — the PPA emits correctly typed values.

#### 6.5.2 Mapping table

| Trigger (Mojaloop) | ISO 20022 Output (Tazama) | Key Mapped Fields |
| --- | --- | --- |
| ✅ **POST /quotes**, enriched from cached PUT /parties and PUT /fxQuotes | **pain.001** | quoteId → PmtInf.**PmtInfId**; transactionId → PmtId.**EndToEndId**; amount → Amt.**InstdAmt.Amt.Amt/.Ccy**; fxQuote targetAmount → Amt.**EqvtAmt** + **CcyOfTrf**; derived rate → Amt.EqvtAmt.**XchgRateInf.XchgRate**; payer → Dbtr/DbtrAcct; payee fspId → CdtrAgt.**FinInstnId.ClrSysMmbId.MmbId**; payee name (from /parties) → Cdtr; transactionType → Purp.Cd; note → RmtInf.Ustrd |
| ✅ **PUT /quotes**, enriched from cached POST /quotes, PUT /parties and PUT /fxQuotes | **pain.013** | ChrgBr (extensionList) → **ChrgBr**; expiration → PmtInf.**XpryDt.DtTm**; payeeReceiveAmount / payeeFspFee / payeeFspCommission → SplmtryData…**PyeeRcvAmt / PyeeFinSvcsPrvdrFee / PyeeFinSvcsPrvdrComssn**; cached quoteId → PmtInf.**PmtInfId**; cached transactionId → PmtId.**EndToEndId**. **pain.013 has no XchgRateInf element** — a rate sent here is silently stripped |
| ✅ **POST /transfers (PREPARE)**, enriched from cached PUT /parties, POST+PUT /quotes, PUT /fxQuotes | **pacs. 008** | transferId → PmtId.**InstrId**; ilpPacket.transactionId → PmtId.**EndToEndId**; amount → IntrBkSttlmAmt.**Amt.Amt/.Amt.Ccy**; fxQuote sourceAmount → InstdAmt; derived rate → XchgRate; payerFsp/payeeFsp → DbtrAgt/CdtrAgt.**FinInstnId.ClrSysMmbId.MmbId**; payer (from /quotes) → Dbtr/InitgPty; payee name (from /parties) → Cdtr; payeeFspFee → ChrgsInf; transactionType → Purp.Cd; note → RmtInf.Ustrd |
| ✅ **PUT /transfers (FULFIL)** | **pacs. 002** | transferState → TxSts (**translated**, see 6.5.4); completedTimestamp → AccptncDtTm; fspiop-source/-destination **headers** → InstgAgt/InstdAgt; ids → OrgnlInstrId/OrgnlEndToEndId; payeeFspFee → ChrgsInf (**array**) |
| **POST / PUT /fxQuotes** | *(none)* | Enrichment only. Supplies the source amount and the derived exchange rate to the pain.001 and pacs.008 above. See §6.5.3 |
| **POST / PUT /fxTransfers** | *(none)* | Correlation and audit only. Restates amounts already agreed at the FX quote stage; the FX leg is not a separate Tazama transaction. See §6.5.3 |
| ✅ **Any error callback (any resource)** | **pacs. 002** | TxSts → `RJCT`; ids from the cached originating transfer; fspiop-source/-destination → InstgAgt/InstdAgt; ChrgsInf → `[]`. ⚠️ **errorCode/errorDescription cannot be carried — no StsRsnInf exists in the schema; they are silently stripped.** Retained in the PPA audit log only |

**Legend.** ✅ - the mapping has been applied to the real DRPP cross-border golden path and the resulting payload validated against Tazama's live ajv schema, using the TMS service's exact ajv configuration, with no fields stripped.


#### 6.5.3 One transaction per payment, not one per leg

A cross-border payment has two settlement legs (the FX leg via the FXP, and the customer leg to the payee DFSP). **The PPA emits one pacs.008 and one pacs.002 for the whole payment**, not one pair per leg:

- `InstdAmt` — the source amount the payer was instructed to send (MWK 60)
- `IntrBkSttlmAmt` — what actually settled on the customer leg (ZMW 1)
- `XchgRate` = `InstdAmt.Amt ÷ IntrBkSttlmAmt.Amt` (= 60)

The rate direction is confirmed by Tazama's own `DataCache` documentation (`instdAmt 17.01 ZAR ÷ intrBkSttlmAmt 0.97 USD = xchgRate 17.536082`).

On the quote stage the same conversion is expressed through pain.001's native FX elements: `Amt.InstdAmt` carries the instructed amount, `Amt.EqvtAmt` the converted amount with `CcyOfTrf`, and `Amt.EqvtAmt.XchgRateInf.XchgRate` the rate. `pain.013` provides `EqvtAmt` and `CcyOfTrf` but has no `XchgRateInf` element, so the rate appears on the pain.001 and the pacs.008 only.

The FXP never appears as a party. Modelling the FX leg separately would inject a synthetic entity and an extra `transactionRelationship` edge into Tazama's graph on every cross-border payment, inflating counterparty counts and corrupting velocity scoring. This is why neither FX stage produces a message of its own.

#### 6.5.4 Emission timing and status translation

**pacs.008 is emitted on the transfer PREPARE, not on the prepare+fulfil pair.** In the golden path, prepare → fulfil is ~1 second; waiting for the pair would mean Tazama evaluates a payment that has already settled. This matches Tazama's own model, where pacs.008 is the request and pacs.002 the response.

This is viable because the prepare message carries more than its FSPIOP body suggests — its `ilpPacket` decodes to a structured object containing both parties' identifiers and fspIds, the payer's name, the transaction type and the `quoteId`↔`transactionId` link. The quote-stage cache is therefore **enrichment, not a hard dependency**: a pacs.008 remains constructible (degraded, and flagged as such in the audit log) if the quote messages were missed.

**`transferState` must be translated to an ISO status code:**

| Mojaloop | → `TxSts` |
| --- | --- |
| `COMMITTED` | `ACSC` — AcceptedSettlementCompleted |
| `ABORTED` | `RJCT` |
| `RESERVED` | `ACSP` |
| error callback | `RJCT` |

`ACSC` rather than `ACCC`, because `ACCC` asserts funds reached the *creditor's account*, which Mojaloop's `COMMITTED` does not evidence. Note that `TxSts` is an unconstrained string in the real schema, so an untranslated `"COMMITTED"` **is accepted and stored** — it then silently fails every downstream rule testing for ISO status codes. The translation is a correctness duty, not a validation one.

#### 6.5.5 Header field generation

`GrpHdr.MsgId` and `GrpHdr.CreDtTm` are not always PPA-generated. The golden path shows Mojaloop supplying both in the `extensionList` of the fulfil callback.

**Rule: copy the scheme-supplied value when present in `extensionList`; generate otherwise** (a new ULID for `MsgId`, the PPA construction timestamp for `CreDtTm`). In practice pacs.002 copies, and pacs.008 generates. Copying preserves traceability between the Tazama message and the Mojaloop message that produced it.

#### 6.5.6 Identifier strategy across the four messages

Tazama joins the four messages of one payment on the identifiers below. All four must agree, or the chain does not resolve.

| Message | Stage identifier | `EndToEndId` / `OrgnlEndToEndId` |
| --- | --- | --- |
| pain.001 | `PmtInf.PmtInfId` = `quoteId` | `transactionId` |
| pain.013 | `PmtInf.PmtInfId` = `quoteId` (from cached quote request) | `transactionId` |
| pacs.008 | `PmtId.InstrId` = `transferId` | `transactionId` (decoded from the ILP packet) |
| pacs.002 | `OrgnlInstrId` = the pacs.008 `InstrId` | matches the pacs.008 `EndToEndId` |

`EndToEndId` is the same value on all four - it is the transaction-level correlator, and it is the field Tazama joins the chain on.

The stage identifier is carried differently on either side of the chain. `PmtId` on pain.001 and pain.013 contains **only** `EndToEndId`; there is no `InstrId` element, so the `quoteId` is carried in `PmtInf.PmtInfId` instead. An `InstrId` added to a pain message is silently discarded on ingestion (§6.5.1). On pacs.008 and pacs.002 the stage identifier is `PmtId.InstrId` / `OrgnlInstrId`.

`transactionId` and `transferId` are distinct fields in FSPIOP and must not be assumed equal (§6.4.5).

#### 6.5.7 Quote stage - the `QUOTING` gate and two sourcing constraints

**The `QUOTING` gate.** Tazama's TMS registers the `pain.001` and `pain.013` routes only when its `QUOTING` environment variable is `true`; with `QUOTING=false` those routes are not registered and return HTTP 404. The same flag governs graph construction on the transfer side: with `QUOTING=false` the pacs.008 handler creates the debtor/creditor **entities** and their account-holder edges itself, and with `QUOTING=true` it does not, because it expects the pain.001 to have created them.

This is a single coupled switch with no intermediate state, which fixes the deployment sequence:

| `QUOTING` | PPA must send | Consequence if mismatched |
| --- | --- | --- |
| `false` (Tazama default) | pacs.008 + pacs.002 only | Sending pain.001/pain.013 returns HTTP 404 |
| `true` | pain.001 + pain.013 + pacs.008 + pacs.002 | Omitting the pain pair leaves the `entities` collection and account-holder edges unpopulated, disabling every entity-based rule |

**The quote-stage mapping must therefore be deployed together with the flag change, never after it.** The setting in the target CCH deployment is an open item (§12).

**Constraint 1 - `ChrgBr` is required by pain.001 but is not yet known when pain.001 is emitted.** The charge bearer is only stated by the payee, in the `PUT /quotes` callback (`extensionList` key `CdtTrfTxInf.ChrgBr`). Every other enrichment source for a message precedes its trigger; this one follows it. Since nothing re-emits a pain.001 once the callback arrives, the PPA populates `ChrgBr` on the pain.001 with the scheme default `SLEV` and carries the payee-stated value on the pain.013, where it is available. The two messages may therefore legitimately differ on this field.

**Constraint 2 - the payee name is not available from the quote messages.** `Cdtr.Nm` is required on both pain.001 and pain.013. The `payee` object in `POST /quotes` carries `partyIdInfo` and `merchantClassificationCode` only - the FSPIOP quote schema provides no element for payee personal information, so this is a property of the protocol rather than of any particular payment. The payee name is returned solely by the `PUT /parties` discovery callback, which is excluded from Phase 1 capture (§11). Until that exclusion is revisited, `Cdtr.Nm` on the quote-stage messages falls back to the payee identifier, exactly as it does on the pacs.008 (§6.4.3). This affects all three of pain.001, pain.013 and pacs.008 and is tracked as an open item (§12).

#### 6.5.8 Worked examples and remaining data gaps

§7 gives complete worked examples for the flow described in this section, using the real DRPP cross-border messages and two schema-validated Tazama payloads. A separate domestic P2P example is not included: the cross-border flow exercises the same pacs.008 / pacs.002 path plus the FX behaviour, so a domestic-only example would add no further coverage.

Two open data gaps have no Mojaloop source and are currently constant-filled; both need CCH input (see `message mapping/pacs 002-008/02_design-decisions.md`, G1–G3): **payee date of birth**, which appears nowhere in the flow yet is a required field, and **payer geolocation**, whose absence disables any geo-velocity typology. Geolocation is read directly into Tazama's transaction details by the pain.001 handler, so a constant value is recorded as a real coordinate rather than as missing data.

### 6.6 Egress - Sending to Tazama TMS

| Parameter | Value |
| --- | --- |
| Transport | HTTPS only - plain HTTP to TMS is not permitted |
| Method | POST |
| Auth | Bearer token obtained via a live chain, not a static config value: PPA requests a token from an internal Auth-lib, which fetches a Tazama-scoped token from an Auth-service, which in turn obtains it from Keycloak. This token is what’s presented on every PPA→TMS call (mTLS recommended in addition - §10.1). |
| Content-Type | application/json |
| Expected response | HTTP 200 |
| On failure | Retry up to 3 times with exponential back-off and jitter (§9.5); circuit-break on sustained failure; dead-letter and alert on exhaustion |

### 6.7 Error Handling

| Situation | PPA Behaviour |
| --- | --- |
| Callback never arrives before cache TTL expires | Log timeout. Raise alert. Do not forward partial data to TMS. |
| Incoming envelope fails validation | Log and discard. Do not process further. |
| TMS returns a 5xx or times out | Retry up to 3 times with exponential back-off and jitter. Circuit-break on sustained failure (§9.5). Log and alert if all retries fail. |
| TMS returns a 4xx | Log as an application error. Do not retry. Investigate payload. |
| JWT token is missing or invalid on incoming request | Reject with HTTP 401. Log. |
| Cache unavailable (ValKey down) | Halt processing. Raise critical alert. Events queue in Kafka until the issue resolves; Kafka offset is not committed. This is a deliberate hard-stop (§4.3, §4.5). |

## 7. Sample Messages & Transformations

This section gives a complete, worked example of the transformation from Mojaloop's messages into Tazama's specific ISO 20022 message set, so implementers and reviewers can see the full before/after - not just the field-mapping tables in §6.5.

**Every value below is real.** These are the actual on-the-wire messages from the DRPP cross-border golden path, not placeholders. 

| | |
| :---- | :---- |
| **Test case** | DRPP-GP-01 Send Money (Source Currency, Multiple FXPs) |
| **Correlation id (W3C trace-id)** | `67629f2771f9ca3e58ae98d2b525ff82` |
| **transferId / transactionId** | `01K7EV9TNQ1VKX84N0GSQH6MDD` |
| **quoteId** | `01K7EV9X2K4F8J90ZWMRHDNCZN` |
| **conversionRequestId** | `01K7EV9VS1V41WTE9SC7JCGFZN` |
| **conversionId / commitRequestId** | `01K7EV9VS1V41WTE9SC7JCGFZP` |
| **Payer → Payee** | `test-mwk-dfsp` (MSISDN 16665551002) → `test-zmw-dfsp` (MSISDN 16665551001) |
| **FX provider** | `test-fxp` |
| **Amount** | **MWK 60 → ZMW 1** (SEND, source currency); payeeFspFee ZMW 0 |
| **Wall clock** | 2025-10-13T13:14:05.367Z → 13:14:11.252Z (5.9 s) |

Full message captures, including headers and the complete ILP packets, are in `docs/Sample flow E2E/`. Bodies are reproduced below with authorization headers and signatures omitted for readability.

#### Messages consumed, in order

```
13:14:05.807  PUT  /parties      payee DFSP → payer DFSP   cache: payee name
13:14:06.497  POST /fxQuotes     payer DFSP → FXP          cache: sourceAmount MWK 60
13:14:07.147  PUT  /fxQuotes     FXP        → payer DFSP   cache: targetAmount ZMW 1
13:14:07.827  POST /quotes       payer DFSP → payee DFSP   cache: payer identity, note
13:14:08.386  PUT  /quotes       payee DFSP → payer DFSP   cache: ChrgBr, fees, SttlmMtd
13:14:09.272  POST /fxTransfers  payer DFSP → FXP          correlation only
13:14:09.957  PUT  /fxTransfers  FXP        → payer DFSP   correlation only
13:14:10.546  POST /transfers    payer DFSP → payee DFSP   ★ EMIT pacs.008
13:14:11.252  PUT  /transfers    payee DFSP → payer DFSP   ★ EMIT pacs.002
```

---

#### Party lookup callback - `PUT /parties/MSISDN/16665551001`

`test-zmw-dfsp` → `test-mwk-dfsp`. Confirms the payee is reachable and supports ZMW.

```json
{
    "party": {
        "partyIdInfo": {
            "partyIdType": "MSISDN",
            "partyIdentifier": "16665551001",
            "fspId": "test-zmw-dfsp",
            "extensionList": { "extension": [
                { "key": "Assgnmt.MsgId",   "value": "01K7EV9V3FQ2RYXXE9ARH7DNFA" },
                { "key": "Assgnmt.CreDtTm", "value": "2025-10-13T13:14:05.807Z" },
                { "key": "Rpt.Vrfctn",      "value": true }
            ]}
        },
        "name": "Chikondi Banda",
        "supportedCurrencies": [ "ZMW" ]
    }
}
```

**Taken from this message:** `party.name` → `Cdtr.Nm` and `CdtrAcct.Nm`. This is the **only** message in the entire flow carrying the payee's name; without it the creditor is anonymous. Note it arrives before any transaction id exists, so the party cache must be keyed on MSISDN (§6.4).

---

#### FX quote request - `POST /fxQuotes`

`test-mwk-dfsp` → `test-fxp`. Requests conversion terms, linked to the transfer by `determiningTransferId`.

```json
{
    "conversionRequestId": "01K7EV9VS1V41WTE9SC7JCGFZN",
    "conversionTerms": {
        "conversionId": "01K7EV9VS1V41WTE9SC7JCGFZP",
        "initiatingFsp": "test-mwk-dfsp",
        "determiningTransferId": "01K7EV9TNQ1VKX84N0GSQH6MDD",
        "counterPartyFsp": "test-fxp",
        "amountType": "SEND",
        "sourceAmount": { "currency": "MWK", "amount": "60" },
        "targetAmount": { "currency": "ZMW" },
        "expiration": "2025-10-13T13:15:06.497Z"
    }
}
```

**Taken from this message:** `sourceAmount` - the amount in the payer's currency. Note `targetAmount` has no amount yet; only the currency is known at request time.

---

#### FX quote callback - `PUT /fxQuotes/01K7EV9VS1V41WTE9SC7JCGFZN`

`test-fxp` → `test-mwk-dfsp`. The FXP commits to a rate.

```json
{
    "condition": "jp435ANRB6qXpvZVPFfyTHwOfK0mq2xvkegWPe0w0d4",
    "conversionTerms": {
        "conversionId": "01K7EV9VS1V41WTE9SC7JCGFZP",
        "determiningTransferId": "01K7EV9TNQ1VKX84N0GSQH6MDD",
        "initiatingFsp": "test-mwk-dfsp",
        "counterPartyFsp": "test-fxp",
        "sourceAmount": { "currency": "MWK", "amount": "60" },
        "targetAmount": { "currency": "ZMW", "amount": "1" },
        "expiration": "2025-10-13T13:15:06.497Z",
        "amountType": "SEND",
        "extensionList": { "extension": [
            { "key": "GrpHdr.MsgId",   "value": "01K7EV9WDBJ06TM3HY901Q63P8" },
            { "key": "GrpHdr.CreDtTm", "value": "2025-10-13T13:14:07.147Z" },
            { "key": "GrpHdr.NbOfTxs", "value": "1" },
            { "key": "GrpHdr.SttlmInf.SttlmMtd", "value": "CLRG" },
            { "key": "CdtTrfTxInf.UndrlygCstmrCdtTrf.Dbtr.Id.OrgId.Othr.Id",     "value": "test-mwk-dfsp" },
            { "key": "CdtTrfTxInf.UndrlygCstmrCdtTrf.DbtrAgt.FinInstnId.Othr.Id","value": "test-mwk-dfsp" },
            { "key": "CdtTrfTxInf.UndrlygCstmrCdtTrf.Cdtr.Id.OrgId.Othr.Id",     "value": "test-fxp" },
            { "key": "CdtTrfTxInf.UndrlygCstmrCdtTrf.CdtrAgt.FinInstnId.Othr.Id","value": "test-fxp" }
        ]}
    }
}
```

**Taken from this message:** the agreed `sourceAmount` / `targetAmount` pair, which together give `InstdAmt` (MWK 60) and the exchange rate **60 ÷ 1 = 60** → `XchgRate`. Per §6.5.3 the FXP itself is **not** carried into the Tazama message - the `UndrlygCstmrCdtTrf.*` extension keys above, which name `test-fxp` as a party, are deliberately not mapped.

---

#### Quote request - `POST /quotes`

`test-mwk-dfsp` → `test-zmw-dfsp`. Prices the ZMW leg. **This is the richest identity message in the flow.**

```json
{
    "quoteId": "01K7EV9X2K4F8J90ZWMRHDNCZN",
    "transactionId": "01K7EV9TNQ1VKX84N0GSQH6MDD",
    "amountType": "SEND",
    "amount": { "currency": "ZMW", "amount": "1" },
    "expiration": "2025-10-13T13:15:07.827Z",
    "payer": {
        "partyIdInfo": {
            "partyIdType": "MSISDN",
            "partyIdentifier": "16665551002",
            "fspId": "test-mwk-dfsp"
        },
        "personalInfo": {
            "complexName": {
                "firstName": "Firstname-Test",
                "middleName": "Middlename-Test",
                "lastName": "Lastname-Test"
            },
            "dateOfBirth": "1984-01-01"
        },
        "name": "Display-Test"
    },
    "payee": {
        "partyIdInfo": {
            "partyIdType": "MSISDN",
            "partyIdentifier": "16665551001",
            "fspId": "test-zmw-dfsp",
            "extensionList": { "extension": [
                { "key": "Assgnmt.MsgId",   "value": "01K7EV9V3FQ2RYXXE9ARH7DNFA" },
                { "key": "Assgnmt.CreDtTm", "value": "2025-10-13T13:14:05.807Z" },
                { "key": "Rpt.Vrfctn",      "value": true }
            ]}
        },
        "merchantClassificationCode": "123"
    },
    "transactionType": { "scenario": "TRANSFER", "initiator": "PAYER", "initiatorType": "CONSUMER" },
    "note": "test"
}
```

**Taken from this message:** `personalInfo.complexName` → `Dbtr.Nm` (the legal name, joined "Firstname-Test Middlename-Test Lastname-Test"); `personalInfo.dateOfBirth` → `Dbtr…BirthDt`; `name` → `DbtrAcct.Nm`; `transactionType` → `Purp.Cd`; `note` → `RmtInf.Ustrd`. The payer's date of birth appears **only** here.

---

#### Quote callback - `PUT /quotes/01K7EV9X2K4F8J90ZWMRHDNCZN`

`test-zmw-dfsp` → `test-mwk-dfsp`. Returns the priced terms, the ILP packet and the condition. The switch also attaches its own ISO field mapping in `extensionList`, and the untranslated ISO payload in `originalIso20022QuoteResponse`.

```json
{
    "expiration": "2025-10-13T13:15:08.384Z",
    "transferAmount":     { "currency": "ZMW", "amount": "1" },
    "payeeReceiveAmount": { "currency": "ZMW", "amount": "1" },
    "payeeFspFee":        { "currency": "ZMW", "amount": "0" },
    "ilpPacket": "DIIC0QAAAAAAAABkMjAyNTEwMTMxMzE1MDgzODQ2alrYQWLyAk7Emjh…",
    "condition": "Nmpa2EFi8gJOxJo4TLvmiYXrdrD9rIlGDPaPGUO2P1I",
    "extensionList": { "extension": [
        { "key": "GrpHdr.MsgId",   "value": "01K7EV9XM2F00J5V4PZQTKFE38" },
        { "key": "GrpHdr.CreDtTm", "value": "2025-10-13T13:14:08.386Z" },
        { "key": "GrpHdr.NbOfTxs", "value": "1" },
        { "key": "GrpHdr.SttlmInf.SttlmMtd", "value": "CLRG" },
        { "key": "CdtTrfTxInf.Dbtr.Id.PrvtId.Othr.SchmeNm.Prtry", "value": "MSISDN" },
        { "key": "CdtTrfTxInf.Dbtr.Id.PrvtId.Othr.Id",            "value": "16665551002" },
        { "key": "CdtTrfTxInf.Dbtr.Name",                         "value": "Display-Test" },
        { "key": "CdtTrfTxInf.DbtrAgt.FinInstnId.Othr.Id",        "value": "test-mwk-dfsp" },
        { "key": "CdtTrfTxInf.Cdtr.Id.PrvtId.Othr.SchmeNm.Prtry", "value": "MSISDN" },
        { "key": "CdtTrfTxInf.Cdtr.Id.PrvtId.Othr.Id",            "value": "16665551001" },
        { "key": "CdtTrfTxInf.CdtrAgt.FinInstnId.Othr.Id",        "value": "test-zmw-dfsp" },
        { "key": "CdtTrfTxInf.ChrgBr",                            "value": "CRED" },
        { "key": "CdtTrfTxInf.ChrgsInf.Agt.FinInstnId.Othr.Id",   "value": "test-zmw-dfsp" }
    ]}
}
```

**Taken from this message:** `ChrgBr` → `CRED` (not the `DEBT` default); `payeeFspFee` and `ChrgsInf.Agt` → `ChrgsInf`; `GrpHdr.SttlmInf.SttlmMtd` → `CLRG`.

> **Important:** Mojaloop's ISO paths here are **not** Tazama's. Mojaloop uses `FinInstnId.Othr.Id`; Tazama requires `FinInstnId.ClrSysMmbId.MmbId`. Mojaloop's `originalIso20022QuoteResponse` likewise uses `IntrBkSttlmAmt.Ccy` + `ActiveCurrencyAndAmount`, where Tazama requires `IntrBkSttlmAmt.Amt.Amt` + `.Amt.Ccy`. These extension keys are useful corroboration, but they cannot be copied through unmodified.

---

#### FX transfer request - `POST /fxTransfers`

`test-mwk-dfsp` → `test-fxp`. Reserves the conversion leg.

```json
{
    "determiningTransferId": "01K7EV9TNQ1VKX84N0GSQH6MDD",
    "initiatingFsp": "test-mwk-dfsp",
    "counterPartyFsp": "test-fxp",
    "sourceAmount": { "currency": "MWK", "amount": "60" },
    "targetAmount": { "currency": "ZMW", "amount": "1" },
    "expiration": "2025-10-13T13:15:09.272Z",
    "amountType": "SEND",
    "condition": "jp435ANRB6qXpvZVPFfyTHwOfK0mq2xvkegWPe0w0d4",
    "commitRequestId": "01K7EV9VS1V41WTE9SC7JCGFZP"
}
```

#### FX transfer callback - `PUT /fxTransfers/01K7EV9VS1V41WTE9SC7JCGFZP`

`test-fxp` → `test-mwk-dfsp`. The FXP confirms the leg is reserved.

```json
{
    "fulfilment": "4nqWiu-ARrNqM3W_GknieZcPMIFVS34SoBTwk7y43E8",
    "completedTimestamp": "2025-10-13T13:14:09.957Z",
    "conversionState": "RESERVED",
    "extensionList": { "extension": [
        { "key": "GrpHdr.MsgId",   "value": "01K7EV9Z5AG750EZJT22PZ0ZAA" },
        { "key": "GrpHdr.CreDtTm", "value": "2025-10-13T13:14:09.962Z" }
    ]}
}
```

**Taken from these two messages: nothing.** They are consumed for correlation and audit only. Their amounts duplicate the agreed FX quote, and per §6.5.3 the FX leg does not produce its own Tazama transaction - `conversionState: RESERVED` is an intermediate state of a leg, not a terminal state of the payment. Emitting a pacs.002 here would race the real outcome that arrives moments later.

---

#### Transfer prepare - `POST /transfers` ★ triggers pacs.008

`test-mwk-dfsp` → `test-zmw-dfsp`. Reserves positions at the switch.

```json
{
    "transferId": "01K7EV9TNQ1VKX84N0GSQH6MDD",
    "payeeFsp": "test-zmw-dfsp",
    "payerFsp": "test-mwk-dfsp",
    "amount": { "currency": "ZMW", "amount": "1" },
    "ilpPacket": "DIIC0QAAAAAAAABkMjAyNTEwMTMxMzE1MDgzODQ2alrYQWLyAk7Emjh…",
    "condition": "Nmpa2EFi8gJOxJo4TLvmiYXrdrD9rIlGDPaPGUO2P1I",
    "expiration": "2025-10-13T13:15:10.546Z",
    "extensionList": { "extension": [
        { "key": "CdtTrfTxInf.Cdtr.Id.PrvtId.Othr.SchmeNm.Prtry", "value": "MSISDN" },
        { "key": "CdtTrfTxInf.Cdtr.Id.PrvtId.Othr.Id",            "value": "16665551001" },
        { "key": "CdtTrfTxInf.CdtrAgt.FinInstnId.Othr.Id",        "value": "test-zmw-dfsp" }
    ]}
}
```

The `ilpPacket` is **not opaque**. Decoding it (base64url → ILP v4 packet → embedded base64url JSON) yields a structured transaction object:

```json
{
    "quoteId": "01K7EV9X2K4F8J90ZWMRHDNCZN",
    "transactionId": "01K7EV9TNQ1VKX84N0GSQH6MDD",
    "transactionType": { "scenario": "TRANSFER", "initiator": "PAYER", "initiatorType": "BUSINESS" },
    "payee": { "partyIdInfo": { "partyIdType": "MSISDN", "partyIdentifier": "16665551001", "fspId": "test-zmw-dfsp" }},
    "payer": { "partyIdInfo": { "partyIdType": "MSISDN", "partyIdentifier": "16665551002", "fspId": "test-mwk-dfsp" },
               "name": "Display-Test" },
    "expiration": "2025-10-13T13:15:08.384Z",
    "amount": { "amount": "1", "currency": "ZMW" }
}
```

**Taken from this message:** `transferId` → `PmtId.InstrId`; the decoded `transactionId` → `PmtId.EndToEndId`; `amount` → `IntrBkSttlmAmt`; `payerFsp` / `payeeFsp` → `DbtrAgt` / `CdtrAgt`; `expiration` → `SplmtryData…Xprtn`; the extension keys and decoded `payee` → `Cdtr` / `CdtrAcct` identifiers.

This is why the pacs.008 can be emitted here rather than waiting for the fulfil (§6.5.4): the prepare alone carries both parties, both agents and the transaction type. Note the decoded packet claims `initiatorType: BUSINESS` while the quote request said `CONSUMER` - the FSPIOP message body takes precedence, so `Purp.Cd` resolves to `MP2P`.

---

#### Transfer fulfil - `PUT /transfers/01K7EV9TNQ1VKX84N0GSQH6MDD` ★ triggers pacs.002

`test-zmw-dfsp` → `test-mwk-dfsp`. Settlement across both schemes and the FXP.

```json
{
    "fulfilment": "o4qka6jlUcYxhOakMAQ6tNe-KoqCBXkWEb9m981F_Sc",
    "completedTimestamp": "2025-10-13T13:14:11.252Z",
    "transferState": "COMMITTED",
    "extensionList": { "extension": [
        { "key": "GrpHdr.MsgId",   "value": "01K7EVA0DTXE0B1GCTZ744Y2PD" },
        { "key": "GrpHdr.CreDtTm", "value": "2025-10-13T13:14:11.258Z" }
    ]}
}
```

Relevant headers: `fspiop-source: test-zmw-dfsp`, `fspiop-destination: test-mwk-dfsp`.

**Taken from this message:** `transferState` → `TxSts` (**translated** `COMMITTED` → `ACSC`); `completedTimestamp` → `AccptncDtTm`; the two `GrpHdr.*` extension keys → `GrpHdr` (copied, not generated - §6.5.5); and the `fspiop-source` / `fspiop-destination` **headers** → `InstgAgt` / `InstdAgt`. The direction reverses here relative to the pacs.008: the instructing agent is the payee DFSP.

---

### Resulting Tazama messages

Both payloads below have been validated against Tazama's live ingestion schemas (`tms-service/src/schemas/*.json`) using the TMS service's exact ajv configuration. Both pass with no fields stripped.

The two transfer-stage messages are shown here. This flow also produces two quote-stage messages under `QUOTING=true` - pain.001 from the `POST /quotes` above and pain.013 from the `PUT /quotes` above. Both are validated against the same schemas and are held, with their field-by-field mapping, in `message mapping/pain001-013/`.

#### pacs.008.001.10 - emitted on transfer prepare

```json
{
    "TxTp": "pacs.008.001.10",
    "FIToFICstmrCdtTrf": {
        "GrpHdr": {
            "MsgId": "01K7EV9ZQ4X8N2R5T7V9W1Y3Z6",
            "CreDtTm": "2025-10-13T13:14:10.612Z",
            "NbOfTxs": 1,
            "SttlmInf": { "SttlmMtd": "CLRG" }
        },
        "CdtTrfTxInf": {
            "PmtId": {
                "InstrId": "01K7EV9TNQ1VKX84N0GSQH6MDD",
                "EndToEndId": "01K7EV9TNQ1VKX84N0GSQH6MDD"
            },
            "IntrBkSttlmAmt": { "Amt": { "Amt": 1,  "Ccy": "ZMW" } },
            "InstdAmt":       { "Amt": { "Amt": 60, "Ccy": "MWK" } },
            "ChrgBr": "CRED",
            "XchgRate": "60",
            "ChrgsInf": {
                "Amt": { "Amt": 0, "Ccy": "ZMW" },
                "Agt": { "FinInstnId": { "ClrSysMmbId": { "MmbId": "test-zmw-dfsp" } } }
            },
            "InitgPty": {
                "Nm": "Firstname-Test Middlename-Test Lastname-Test",
                "Id": { "PrvtId": {
                    "DtAndPlcOfBirth": { "BirthDt": "1984-01-01", "CityOfBirth": "Unknown", "CtryOfBirth": "ZZ" },
                    "Othr": [ { "Id": "16665551002", "SchmeNm": { "Prtry": "MSISDN" } } ]
                }},
                "CtctDtls": { "MobNb": "16665551002" }
            },
            "Dbtr": {
                "Nm": "Firstname-Test Middlename-Test Lastname-Test",
                "Id": { "PrvtId": {
                    "DtAndPlcOfBirth": { "BirthDt": "1984-01-01", "CityOfBirth": "Unknown", "CtryOfBirth": "ZZ" },
                    "Othr": [ { "Id": "16665551002", "SchmeNm": { "Prtry": "MSISDN" } } ]
                }},
                "CtctDtls": { "MobNb": "16665551002" }
            },
            "DbtrAcct": {
                "Id": { "Othr": [ { "Id": "16665551002", "SchmeNm": { "Prtry": "MSISDN" } } ] },
                "Nm": "Display-Test"
            },
            "DbtrAgt": { "FinInstnId": { "ClrSysMmbId": { "MmbId": "test-mwk-dfsp" } } },
            "CdtrAgt": { "FinInstnId": { "ClrSysMmbId": { "MmbId": "test-zmw-dfsp" } } },
            "Cdtr": {
                "Nm": "Chikondi Banda",
                "Id": { "PrvtId": {
                    "DtAndPlcOfBirth": { "BirthDt": "1900-01-01", "CityOfBirth": "Unknown", "CtryOfBirth": "ZZ" },
                    "Othr": [ { "Id": "16665551001", "SchmeNm": { "Prtry": "MSISDN" } } ]
                }},
                "CtctDtls": { "MobNb": "16665551001" }
            },
            "CdtrAcct": {
                "Id": { "Othr": [ { "Id": "16665551001", "SchmeNm": { "Prtry": "MSISDN" } } ] },
                "Nm": "Chikondi Banda"
            },
            "Purp": { "Cd": "MP2P" }
        },
        "RgltryRptg": { "Dtls": { "Tp": "BALANCE OF PAYMENTS", "Cd": "100" } },
        "RmtInf": { "Ustrd": "test" },
        "SplmtryData": { "Envlp": { "Doc": {
            "Xprtn": "2025-10-13T13:15:10.546Z",
            "InitgPty": { "Glctn": { "Lat": "0", "Long": "0" } }
        }}}
    }
}
```

#### pacs.002.001.12 - emitted on transfer fulfil

```json
{
    "TxTp": "pacs.002.001.12",
    "FIToFIPmtSts": {
        "GrpHdr": {
            "MsgId": "01K7EVA0DTXE0B1GCTZ744Y2PD",
            "CreDtTm": "2025-10-13T13:14:11.258Z"
        },
        "TxInfAndSts": {
            "OrgnlInstrId": "01K7EV9TNQ1VKX84N0GSQH6MDD",
            "OrgnlEndToEndId": "01K7EV9TNQ1VKX84N0GSQH6MDD",
            "TxSts": "ACSC",
            "ChrgsInf": [ {
                "Amt": { "Amt": 0, "Ccy": "ZMW" },
                "Agt": { "FinInstnId": { "ClrSysMmbId": { "MmbId": "test-zmw-dfsp" } } }
            } ],
            "AccptncDtTm": "2025-10-13T13:14:11.252Z",
            "InstgAgt": { "FinInstnId": { "ClrSysMmbId": { "MmbId": "test-zmw-dfsp" } } },
            "InstdAgt": { "FinInstnId": { "ClrSysMmbId": { "MmbId": "test-mwk-dfsp" } } }
        }
    }
}
```

### Transformation walkthrough

**The cross-border conversion is the point.** `InstdAmt` carries what the payer was instructed to send (MWK 60) and `IntrBkSttlmAmt` what actually settled (ZMW 1), with `XchgRate` (60) connecting them. Two currencies in one transaction. Under a per-leg model this relationship would be split across two Tazama transactions and lost.

**The FXP never appears.** `test-fxp` is absent from both outputs. It is FX plumbing, not a party to the customer's payment (§6.5.3).

**Nine Mojaloop messages, seven consumed, two emitted.** Neither output corresponds one-to-one with a Mojaloop message: the pacs.008 draws on five messages (prepare, both quotes, the FX quote callback and the party lookup) and the pacs.002 on two (the fulfil, plus the cached quote fees).

**The identifiers are what make the pair a pair.** `OrgnlInstrId` and `OrgnlEndToEndId` on the pacs.002 must exactly match `PmtId.InstrId` and `PmtId.EndToEndId` on the pacs.008. If they do not, TMS still accepts the pacs.002, but Tazama's graph never links it to its transfer and the transaction silently never completes a chain.

**Three fields carry no Mojaloop data.** `Cdtr…BirthDt` (`1900-01-01`), `RgltryRptg` and `Glctn` (`0,0`) are constants - the payee's date of birth, regulatory reporting code and payer geolocation do not exist anywhere in the Mojaloop flow, yet all three are required. See §6.5.8 and the gap register in `message mapping/pacs 002-008/02_design-decisions.md`.

**And what is discarded:** `condition`, `fulfilment`, `commitRequestId` and `conversionId` are not carried. Tazama's schema has no field for them, and because TMS runs ajv with `removeAdditional: 'all'`, attempting to attach them would return HTTP 200 with the fields silently deleted (§6.5.1).

## 8. End-to-End Flows

The following flows trace what happens from the moment an FSP initiates a payment to the point where Tazama has received the full picture. Each flow reflects the async nature of Mojaloop - requests and callbacks are separate events that the MLA captures at different times.

### 8.1 Cross-Border Payment with Currency Conversion

This is the reference flow, traced against the real DRPP golden path reproduced in §7 (MWK 60 → ZMW 1, `test-mwk-dfsp` → `test-zmw-dfsp` via `test-fxp`, 5.9 s end to end). A domestic payment is the same flow with the two FX stages absent.

Nine messages cross the wire. The PPA consumes seven of them and sends two or four messages to TMS, depending on the `QUOTING` setting (§6.5.7). The stages below are marked ★ where a TMS message is produced.

**Stage 1 - Party lookup.** The payee DFSP returns the resolved party on `PUT /parties`. The MLA relays it; the PPA caches the payee's **name**, which appears in no other message in the flow. This callback arrives before any transaction id exists, so the entry is keyed on the party identifier (MSISDN), not on the transaction - see §6.4.

**Stage 2 - FX quote.** The payer DFSP requests conversion terms from the FXP (`POST /fxQuotes`); the FXP commits to a rate (`PUT /fxQuotes`). The PPA caches the agreed `sourceAmount` / `targetAmount` pair. Nothing is sent to TMS at this stage.

**Stage 3 - Quote → ★ pain.001 and pain.013 to TMS (when `QUOTING=true`).** The payer DFSP prices the target-currency leg with the payee DFSP (`POST` / `PUT /quotes`). This is the richest identity exchange in the flow and the only source of the payer's date of birth.

The two events have a dual role (§6.4.1). Each produces its own TMS message - `POST /quotes` → pain.001, `PUT /quotes` → pain.013, both carrying the FX amounts cached at stage 2 - and each also caches the payer identity, charge bearer, payee fee and settlement method that the pacs.008 needs at stage 5. Emitting the quote-stage messages does not discharge that cached state.

With `QUOTING=false` the pain routes are not registered on TMS and this stage emits nothing, contributing only to the cache.

**Stage 4 - FX transfer.** The payer DFSP reserves the conversion leg with the FXP (`POST` / `PUT /fxTransfers`). The PPA consumes both for correlation and audit but **derives no fields from them and emits nothing** - under §6.5.3 the FX leg is not a separate Tazama transaction, and `conversionState: RESERVED` is an intermediate state of a leg rather than a terminal state of the payment.

**Stage 5 - Transfer prepare → ★ pacs.008 to TMS.** The payer DFSP sends `POST /transfers`. The MLA relays it; the PPA decodes the ILP packet, drains everything cached in stages 1-3, assembles the pacs.008 and sends it to TMS **immediately, without waiting for the fulfil** (§6.5.4). This is what preserves the pre-settlement evaluation window: prepare → fulfil is roughly one second, so a PPA that waited for the pair would be handing Tazama payments that had already settled.

**Stage 6 - Transfer fulfil → ★ pacs.002 to TMS.** The payee DFSP returns `PUT /transfers` with `transferState: COMMITTED`. The PPA translates the state to an ISO code (`ACSC`), reads `InstgAgt` / `InstdAgt` from the `fspiop-source` / `fspiop-destination` headers, and sends the pacs.002 carrying the same `InstrId` / `EndToEndId` as the pacs.008 so Tazama can join the pair.

```
PUT  /parties      ──┐
POST /fxQuotes     ──┤
PUT  /fxQuotes     ──┤
POST /quotes       ──┼──► PPA cache ──► ★ pain.001 → TMS   (QUOTING=true only)
PUT  /quotes       ──┘              └─► ★ pain.013 → TMS   (QUOTING=true only)
POST /fxTransfers  ──── correlation only, nothing derived
PUT  /fxTransfers  ──── correlation only, nothing derived
POST /transfers    ──────────────────► ★ pacs.008 → TMS
PUT  /transfers    ──────────────────► ★ pacs.002 → TMS
```

**Messages sent to TMS.** The transfer stage produces **two**: one pacs.008 and one pacs.002. The quote stage produces a further **two** - pain.001 on the quote request and pain.013 on the quote callback - when Tazama is deployed with `QUOTING=true`; with `QUOTING=false` those routes do not exist and the quote stage produces none (§6.5.7). Neither FX stage produces a message, because the conversion is folded into the messages above via `InstdAmt` (MWK 60), `IntrBkSttlmAmt` (ZMW 1) and `XchgRate` (60) rather than modelled as its own transaction (§6.5.3). Totals per cross-border payment: **two** with `QUOTING=false`, **four** with `QUOTING=true`.

**Degraded operation.** If the stage 1-3 cache entries are missing - a cache miss, a late callback, or a scheme that skips quoting altogether - the pacs.008 is **still constructible** from the prepare message alone, because its decoded ILP packet carries both parties, both agents and the transaction type. What is lost is the payee name, the payer's date of birth, the charge bearer and the source amount, each of which falls back to a documented default. Degraded messages are structurally valid and indistinguishable from complete ones at the TMS door, so the PPA must flag them in the audit log.

### 8.2 Rejected Payment

If the payee rejects a quote or the switch rejects a transfer, the switch publishes an error callback to Kafka instead of a normal callback. The MLA relays it to the PPA in the same way, and the PPA builds a pacs. 002 with `TxSts: RJCT` and sends it to TMS. Error events are still valuable for fraud analysis.

Two constraints apply:

- **A cached request event is required.** `OrgnlInstrId` and `OrgnlEndToEndId` are mandatory fields on the pacs. 002 and cannot be derived from the error payload, which carries only the resource id. Without the cached originating transfer the PPA cannot build a linkable message; an error arriving with no cached counterpart is logged and alerted rather than forwarded.
- **The error reason cannot be carried.** Tazama's pacs. 002 schema has no `StsRsnInf`, so `errorCode` and `errorDescription` have nowhere to go, and because TMS runs ajv with `removeAdditional: 'all'` any attempt to attach them returns HTTP 200 with the fields silently deleted (§6.5.1). Tazama therefore learns *that* a payment was rejected but never *why*; the reason is retained in the PPA audit log. Adding `StsRsnInf` to the TMS schema is logged as a follow-up with Tazama.

### 8.3 Callback Never Arrives

Because the pacs.008 is emitted on the transfer prepare rather than on the prepare+fulfil pair (§6.5.4), a missing callback no longer suppresses the whole transaction - the consequences differ by stage:

- **Fulfil never arrives.** The pacs.008 has already been sent, so Tazama holds the transfer request but never learns its outcome. The PPA logs a timeout and raises an alert. No partial or speculative pacs.002 is sent - Tazama must not be told a payment settled on the strength of a prepare.
- **A quote-stage or party-lookup callback never arrives.** The cache entry expires. If the transfer prepare then arrives, the pacs.008 is still built in degraded form (§8.1) and flagged in the audit log; if no prepare follows, the entry is simply discarded.

In both cases the situation should be investigated - it may indicate a Mojaloop switch issue or a Kafka delivery problem.

## 9. Performance

No document in this project currently states a concrete transaction-volume target — CCH's Project Inception Report defers throughput KPIs to a future Non-Functional Design Document. Rather than leave performance unaddressed until that document exists, this section states working assumptions now, explicitly marked TBC, so that TTL, partition, and hosting decisions have a basis to start from.

### 9.1 Performance Assumptions and Targets (TBC)

| Metric | Proposed Target (TBC) | Basis |
|---|---|---|
| Sustained transaction TPS (steady state) | 20–100 TPS **[TBC — confirm with CCH, Open Item #4]** | Regional/corridor-scale Mojaloop deployments typically run well below reference-implementation ceilings |
| Peak burst TPS (multiplier) | 3–5x sustained | Standard payment-switch peak-to-average ratio |
| Mojaloop messages consumed/transaction (cross-border) | 7 of the 9 on the wire | §8.1 |
| ISO 20022 messages sent to TMS/transaction | 2 with `QUOTING=false` (pacs.008 + pacs.002); 4 with `QUOTING=true` (+ pain.001 + pain.013) | §8.1, §6.5.7 |
| MLA end-to-end ack latency (p95) | < 200 ms | Typical HTTP + Kafka-commit round trip |
| PPA correlation-to-TMS latency (p95, cache hit) | < 500 ms | Includes decode/decrypt, translate, TMS POST |

External reference: Mojaloop reference-implementation benchmarking has demonstrated sustained throughput in the ~1,000 TPS range on well-provisioned clusters, with wide variance depending on hardware/topology — this confirms COMESA's actual figure must be measured against its own deployment, not assumed from generic Mojaloop literature.

### 9.2 Latency Budget — MLA→PPA→TMS Hop Chain

| Hop | Component | Budget (p95) | Notes |
|---|---|---|---|
| 1 | DRPP → Kafka publish | (Mojaloop-owned) | Outside MLA/PPA control |
| 2 | Kafka publish → MLA consume | < 100 ms (no backlog) | Degrades under consumer lag — §9.4 |
| 3 | MLA → PPA POST + ack | < 100 ms | Excludes retries |
| 4 | PPA validate/dedup/decode | < 50 ms | |
| 5 | PPA correlate + translate to Tazama's ISO 20022 message set | < 50 ms | |
| 6 | PPA → TMS POST + ack | < 200 ms | Excludes retries |
| **Total (happy path, no retries)** | | **< ~500 ms per event, per leg** | Retry paths add up to ~7s per hop before dead-letter |

### 9.3 Cache (ValKey) Sizing and TTL Policy

- **TTL formula:** `TTL = max(expiration field on the Mojaloop message, expected worst-case MLA-to-PPA transit + Kafka lag) + fixed buffer (5–10s)`. TTL must not be derived from the `expiration` field alone — it must also cover MLA-side ingestion delay under lag, or genuine in-flight correlations will time out falsely (§8.4).
- **Memory sizing formula:** `Peak concurrent cached entries ≈ TTL(s) × in-flight request rate (req/s) × avg payload size (bytes) × safety factor (1.5–2x)`. Final sizing is blocked on the TPS assumption in §9.1 being confirmed (Open Item #4).
- **Eviction policy:** `volatile-lru` (every correlation key carries an explicit TTL); alert — do not silently evict — on memory pressure, since an evicted correlation key is equivalent to a lost transaction pair.
- Monitor cache hit ratio; a sustained drop signals either TTL misconfiguration or MLA backlog.

### 9.4 Backpressure and Consumer Lag Handling

- Size MLA consumer parallelism relative to the per-action topic partition counts (§4.4), not the old 3-consolidated-topic model.
- Alert on consumer lag (leading indicator) separately from dead-letter rate (lagging indicator).
- Bound MLA's per-call PPA timeout independently from the retry/backoff budget — do not let the synchronous "wait for PPA 200" block indefinitely.

### 9.5 Retry/Backoff Budget and Failure Isolation

- Add **jitter** to the existing 1s/2s/4s exponential backoff at both the MLA→PPA and PPA→TMS hops, to avoid synchronized retry storms across concurrent workers.
- Add a **circuit breaker** at both hops: after N consecutive failures, trip and fail fast to the dead-letter log rather than continuing full retry cycles against a downstream known to be down. Without this, 3x retries at each of two hops can amplify load exactly when a downstream component is least able to absorb it.
- ValKey-down remains a hard-stop (§6.7) — quantify how long Kafka can safely buffer unconsumed events before broker retention limits are hit at the target TPS.

### 9.6 Capacity Planning Guidance

- Size Kafka partitions per topic to the target consumer parallelism, using the corrected per-action topic list (§4.4).
- PPA is stateless and horizontally scalable behind a load balancer (§4.2); MLA can round-robin across replicas.
- Account for the message-volume reduction the Notification Filter/Dedup component provides when sizing PPA→TMS throughput.


---

## 10. Security

### 10.1 Transport Security

All MLA↔PPA and PPA↔TMS communication uses TLS 1.2 or higher. Aligned with Mojaloop's own DFSP-to-switch requirement, MLA↔PPA and PPA↔TMS **should use mutual TLS** (client + server certificates), not bearer-token-over-TLS alone, given both endpoints are internal trusted services carrying live financial data. Certificate issuance/rotation policy is to be defined (Open Item, §12), minimum 2048-bit RSA, consistent with Mojaloop's own PKI best practices.

### 10.2 Authentication & Authorization

- PPA validates JWT bearer tokens on all POST endpoints it exposes to MLA (existing behaviour retained); tokens issued via Keycloak, consistent with the CMS module’s RBAC baseline, scoped to a dedicated service client with least-privilege claims (write-only to /QUOTES, /TRANSFERS).
- MLA’s own outbound authentication to PPA follows the same chain PPA uses for its TMS calls below - MLA requests its token from the internal Auth-lib, which fetches a Tazama-scoped token from Auth-service, which obtains it from Keycloak - cached and refreshed by MLA ahead of expiry rather than fetched per event.
- PPA’s own outbound authentication to TMS follows a confirmed, live chain (not a static config token): PPA requests a token from an internal Auth-lib, which fetches a Tazama-scoped token from an Auth-service, which in turn obtains it from Keycloak (§6.6). This makes both the Auth-service and Keycloak runtime dependencies of PPA, not just an RBAC-policy reference - their availability directly affects PPA’s ability to deliver messages to TMS.
- JWS validation is promoted from an open item to a required design decision. If COMESA’s DRPP has JWS enabled, MLA must validate the FSPIOP-Signature header (RS256/384/512) against the sender’s registered public key before forwarding to PPA; unsigned or invalid-signature ingress events are rejected and alerted, not silently passed through. If JWS is disabled at DRPP, this is a documented residual risk requiring compensating controls (network segmentation, source IP allow-listing) - tracked in §12 pending JAD workshop confirmation.
- Administrative access to MLA/PPA configuration, dead-letter queues, and audit logs is Keycloak-role-gated, mirroring the CMS FSD’s per-role permission model.

### 10.3 Data Protection (PII & Financial Data)

- Classification: party names, MSISDNs, account/party identifiers, and transaction amounts are sensitive financial PII across every boundary this pipeline touches - Kafka topics, the ValKey cache, and audit/dead-letter logs. These fields arrive via the quote stage’s payer/payee identity data (§6.4).
- Field-level protection: before implementation, decide whether MSISDN/party-name fields are (a) tokenized at ingestion (MLA/PPA boundary) before reaching Kafka/cache, or (b) encrypted field-level (envelope encryption, KEK/DEK model, KMS-managed keys). Whichever is chosen resolves the previously undefined “Decrypt” step (§4.6) - key generation, rotation, and access must be specified and owned by a named team.
- Encryption at rest: Kafka broker volumes and ValKey persistence (if enabled) must be encrypted at rest; TTL-expired cache entries must be securely purged.
- Data minimization: audit and dead-letter logs mask/truncate MSISDNs and account identifiers (e.g., last 4 digits only) by default; full values retrievable only via a separate access-controlled lookup, never embedded in plaintext log lines.

### 10.4 Audit Logging & Monitoring

Audit entries (§6.3 step 10) and dead-letter logs apply the same masking rules as §10.3. Audit logs are immutable (write-once, no update/delete API) and access-controlled by Keycloak role, aligning with the CMS module’s audit-immutability baseline. Retention period is to be confirmed against CCH compliance policy (§12).

Schema: each entry records correlationld (§5.4), envelope id, eventType, source/destination DFSP, timestamp, processing outcome (success/error/retry), TMS response code, and any error detail - masked per §10.3.

Storage: a dedicated, append-only audit log store (not Kafka, not the DLQ) - e.g. a database table or log-aggregation index - kept separate from application logs so audit records survive independently of service restarts or log rotation.

### 10.5 Alignment with Project Security Baseline

This section adopts the same controls established elsewhere in the project (CMS FSD): Keycloak-based RBAC and OAuth2, MFA where configurable, immutable audit logs, and SHA-256-class integrity hashing for stored dead-letter/audit payloads - extending, not contradicting, the house standard, and satisfying the Project Inception Report’s ISO 27001 commitment.

## 11. Phase 1 Exclusions

The following are confirmed out of scope for message ingestion in Phase 1:

- Real-time blocking of payments - Tazama reviews transactions after they complete, not during. Blocking requires switch modifications and is not in this contract.
- Rule Builder or SDK for rule configuration - rules are configured directly in Tazama’s rule processors.
- Modifications to Mojaloop switch behaviour - this is the Mojaloop partner’s and CCH’s responsibility.
- Party discovery (Account Lookup Service) event capture - no Discovery Reverse Proxy or equivalent component is built in Phase 1. Note the consequence: the FSPIOP quote schema carries no payee personal information, so the payee name (`Cdtr.Nm`) is available only from the `PUT /parties` discovery callback. With discovery excluded, `Cdtr.Nm` falls back to the payee identifier on pain.001, pain.013 and pacs.008 (§6.5.7). Confirming whether this is acceptable, or whether discovery capture must be reinstated, is Open Item #11.
- Infrastructure sizing/hosting decisions - covered in the separate Infrastructure Design Document.

## 12. Open Items

These items must be confirmed before the design is finalised, ideally at the JAD workshop:

| # | Item | Owner |
| --- | --- | --- |
| 1 | Confirm cache TTL - align with the expiration field on Mojaloop’s messages plus MLA-side transit/lag buffer (§9.3) | CCH + Mojaloop Partner |
| 2 | Confirm whether JWS signing is enabled on COMESA’s DRPP deployment; if so, confirm MLA’s validation approach is acceptable (§10.2) | Mojaloop Partner |
| 3 | Confirm expected transaction volumes (TPS) for sizing MLA and PPA (§9.1) | CCH |
| 4 | Confirm hosting location for MLA and PPA - Paysys DC or COMESA infrastructure (see Infrastructure Design Document) | CCH |
| 5 | Confirm whether any COMESA-specific extension fields exist on standard Mojaloop messages | Mojaloop Partner |
| 6 | Agree acceptable timeout values for MLA→PPA and PPA→TMS calls (§9.2) | CCH + Paysys |
| 7 | Confirm ownership (MLA-side vs. PPA-side) of the Central Ledger notification dedup logic (§4.1, §4.3, §6.3) | CCH + Paysys |
| 8 | Share sample messages across corridor (e.g. Malawi - Zambia and vice versa) | CCH |

| # | Item | Owner |
| --- | --- | --- |
| 9 | Confirm FX quote/transfer topic names (topic-fx-quotes-*, topic-fx-transfer-* equivalents) against Mojaloop’s actual deployment (§4.4, §5.2) | Mojaloop Partner |
| 10 | Confirm the `QUOTING` setting on the target Tazama deployment. It determines whether the pain.001/pain.013 routes exist and which component creates graph entities; the quote-stage mapping must be deployed together with any change to it (§6.5.7) | CCH + Paysys |
| 11 | Confirm the source of the payee name (`Cdtr.Nm`), required on pain.001, pain.013 and pacs.008. The FSPIOP quote schema carries no payee personal information, so the only source in the flow is the `PUT /parties` discovery callback, which Phase 1 excludes (§6.5.7, §11) | CCH + Mojaloop Partner |
| 12 | Provide a raw Kafka capture for a cross-border transaction, covering the quote, transfer and notification topics. The mapping is derived from an FSPIOP wire capture; the Kafka envelope shape and header retention have not been confirmed (§5.3, §6.4.7) | Mojaloop Partner |

---

## Annex A — API Endpoint Quick Reference

### A.1 Mojaloop DRPP → MLA (Kafka Topics)

| Topic | Published By | Events |
|---|---|---|
| `topic-quotes-post` / `topic-quotes-put` | Quoting Service | `POST`/`PUT /quotes`, error variants - sources for `pain.001`/`pain.013` |
| `topic-fx-quotes-post` / `topic-fx-quotes-put` | Quoting Service | `POST`/`PUT /fxQuotes`, error variants - enrichment only [TBC — Open Item #13] |
| `topic-transfer-prepare` / `topic-transfer-fulfil` | ML API Adapter | `pacs.008` request/callback, error variants |
| `topic-notification-event` | **Central Ledger** | Final transfer-state notification — `pacs.002` (deduplicated before use — §4.1) |

### A.2 MLA → PPA

| PPA Endpoint | Method | Receives |
|---|---|---|
| `/QUOTES` | POST | All quote and FX quote events (request, callback, error variants) |
| `/TRANSFERS` | POST | All transfer and FX transfer events (request, callback, final-state notifications, error variants) |
| `/health` | GET | Health check |

### A.3 PPA → Tazama TMS[^1][^2]

| Event Pair | ISO 20022 Message | TMS Endpoint |
|---|---|---|
| `POST /quotes` | **pain.001.001.11** | `/v1/evaluate/iso20022/pain.001.001.11` *(registered only when `QUOTING=true` — §6.5.7)* |
| `PUT /quotes` | **pain.013.001.09** | `/v1/evaluate/iso20022/pain.013.001.09` *(registered only when `QUOTING=true` — §6.5.7)* |
| `pacs.008` request + callback | **pacs.008** | `/api/transaction/pacs.008` |
| Final-state notification (Central Ledger, deduplicated) | **pacs.002** | `/api/transaction/pacs.002` |
| Final-state notification, FX (deduplicated) | **pacs.002** | `/api/transaction/pacs.002` |
| Any error callback (any resource) | **pacs.002** | `/api/transaction/pacs.002` |


---

## Annex B - Mojaloop Message Body Reference

Key fields from Mojaloop’s message bodies that the PPA reads during translation to Tazama’s specific ISO 20022 message set: ${ }^{8}$

| Message | Key Body Fields |
| --- | --- |
| `POST /quotes` (quote request) | quoteld, transactionId, transactionRequestld, payer (partyldInfo), payee (partyldInfo), amountType, amount (amount + currency), transactionType (scenario, initiator, initiatorType), note |
| `PUT /quotes` (quote callback) | transferAmount, payeeReceiveAmount, payeeFspFee, payeeFspCommission, expiration, ilpPacket, condition |
| `POST /fxQuotes` (FX quote request) | conversionRequestld, conversionTerms (conversionId, initiatingFsp, counterPartyFsp, amountType, sourceAmount, targetAmount, expiration) |
| `PUT /fxQuotes` (FX quote callback) | conversionTerms (conversionId, charges, targetAmount confirmed, condition, expiration) |
| pacs. 008 (transfer request) | transferld, payerFsp, payeeFsp, amount (amount + currency), expiration, ilpPacket, condition, extensionList - note: arrives as a base64-encoded data: URI, decode before use (§4.6) |
| pacs. 008 (transfer callback) | fulfilment, completedTimestamp, transferState (COMMITTED / ABORTED), extensionList |
| Central Ledger final-state notification (pacs.002) | completedTimestamp, transferState, extensionList - deduplicate by transferld + state before use (§4.1) |
| `POST /fxTransfers` (FX transfer request) | commitRequestld, determiningTransferld, initiatingFsp, counterPartyFsp, sourceAmount, targetAmount, condition, expiration |
| `PUT /fxTransfers` (FX transfer callback) | fulfilment, completedTimestamp, conversionState |
| Error callback (pacs.002, any resource) | errorInformation (errorCode, errorDescription, extensionList) |

---

1. ${ }^{1}$ Phase structure (Quote / Transfer), resource-to-ISO-message tables, header field definitions, and ILP v4 cryptographic terms: Mojaloop ISO 20022 Market Practice Document, v1.0, Mojaloop Foundation documentation.[↩︎](about:blank#fnref1)
2. ${ }^{4}$ Field-level FSPIOP-to-ISO 20022 mapping rules (message version table and per-endpoint field mappings): “FSPIOP to ISO 20022 Mapping.md”, mojaloop GitHub organisation.[↩︎](about:blank#fnref2)
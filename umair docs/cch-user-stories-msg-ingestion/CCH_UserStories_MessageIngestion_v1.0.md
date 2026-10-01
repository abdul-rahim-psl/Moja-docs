# User Stories — Message Ingestion (MLA / PPA)
**CCH FRMS | Paysys Labs**
Document Ref: CCH-PL-US-MSGING-001 | v1.0 | August 2026
Based on: CCH-PL-FSD-MSGING-001 v4.0

---

## Table of Contents

- **[Epic 1 — MLA: Kafka Subscription & Audit Topic Ingestion](#epic-1)**
  - [US-MLA-01 — Subscribe to the Mojaloop Audit Topic](#us-mla-01)
  - [US-MLA-02 — Distinguish Event Types Within the Audit Topic Stream](#us-mla-02)
  - [US-MLA-03 — Decode Base64-Encoded Transfer Payloads](#us-mla-03)
- **[Epic 2 — MLA: Envelope Construction & JWS Validation](#epic-2)**
  - [US-MLA-04 — Construct a Standard Event Envelope](#us-mla-04)
  - [US-MLA-05 — Validate JWS Signatures on DFSP-Originated Events](#us-mla-05)
- **[Epic 3 — MLA: Delivery to PPA & Offset Management](#epic-3)**
  - [US-MLA-06 — Deliver Envelopes to PPA via Per-Action Endpoints](#us-mla-06)
  - [US-MLA-07 — Retry and Circuit-Break on PPA Failures](#us-mla-07)
- **[Epic 4 — Notification Filter / Dedup Component](#epic-4)**
  - [US-DEDUP-01 — Filter and Deduplicate Central Ledger Final-State Notifications](#us-dedup-01)
- **[Epic 5 — PII Protection Component](#epic-5)**
  - [US-PII-01 — Tokenize Party Identity Fields Before MLA Consumption](#us-pii-01)
- **[Epic 6 — PPA: Ingress API & Write-Ahead Persist](#epic-6)**
  - [US-PPA-01 — Expose Per-Action Inbound Endpoints Over Mutual TLS](#us-ppa-01)
  - [US-PPA-02 — Write-Ahead Persist Before Acknowledging MLA](#us-ppa-02)
- **[Epic 7 — PPA: Processing Pipeline](#epic-7)**
  - [US-PPA-03 — Validate the Incoming Envelope](#us-ppa-03)
  - [US-PPA-04 — Deduplicate Central Ledger Notification Events](#us-ppa-04)
  - [US-PPA-05 — Classify Each Event as Trigger or Enrichment](#us-ppa-05)
  - [US-PPA-06 — Accumulate Enrichment into the Correlation Cache](#us-ppa-06)
  - [US-PPA-07 — Discriminate Domestic vs. Cross-Border Transfers](#us-ppa-07)
- **[Epic 8 — PPA: ISO 20022 Translation](#epic-8)**
  - [US-PPA-08 — Translate Quote Request to pain.001.001.11](#us-ppa-08)
  - [US-PPA-09 — Translate Quote Callback to pain.013.001.09](#us-ppa-09)
  - [US-PPA-10 — Translate Transfer Prepare to pacs.008.001.10](#us-ppa-10)
  - [US-PPA-11 — Translate Final-State Event to pacs.002.001.12](#us-ppa-11)
- **[Epic 9 — PPA: Schema Validation, TMS Dispatch & Dedup](#epic-9)**
  - [US-PPA-12 — Validate Assembled Message Against Pinned Local Schema Before Send](#us-ppa-12)
  - [US-PPA-13 — Send Validated Messages to Tazama TMS](#us-ppa-13)
  - [US-PPA-14 — Prevent Duplicate TMS Submissions with a Sent-Message Dedup Set](#us-ppa-14)
- **[Epic 10 — PPA: Error Recovery, DLQ & Missing Correlations](#epic-10)**
  - [US-PPA-15 — Dead-Letter Queue: Write, Alert, and Support Replay](#us-ppa-15)
  - [US-PPA-16 — Park Correlation State Before ValKey TTL Expiry](#us-ppa-16)
  - [US-PPA-17 — Handle Out-of-Order Arrival (Fulfil Before Prepare)](#us-ppa-17)
- **[Epic 11 — Audit Logging, Security & Monitoring](#epic-11)**
  - [US-AUD-01 — Write Audit Log Entries for Every Processed Event](#us-aud-01)
  - [US-MON-01 — Monitor Consumer Lag, Circuit Breaker State, and Degraded Message Rate](#us-mon-01)
  - [US-MON-02 — Expose Health Endpoints for Load Balancer and Orchestrator](#us-mon-02)
- **[Epic 12 — Performance & Infrastructure](#epic-12)**
  - [US-PERF-01 — Meet Latency Targets at Sustained and Peak TPS](#us-perf-01)
  - [US-PERF-02 — Size and Configure ValKey for Correlation Workload](#us-perf-02)
  - [US-SEC-01 — Establish mTLS Certificates for MLA↔PPA and PPA↔TMS](#us-sec-01)

---

## How to Read These Stories

Each story follows the structure: **Description → Acceptance Criteria → Assumptions**.
Stories are grouped by component/epic. Technical detail is included where the behaviour is non-obvious or where a wrong implementation would be silent but harmful.

---

<a id="epic-1"></a>
## Epic 1 — MLA: Kafka Subscription & Audit Topic Ingestion

---

<a id="us-mla-01"></a>
### US-MLA-01 — Subscribe to the Mojaloop Audit Topic

**Description**
The MLA must consume all payment events (FX quote, quote, FX transfer, transfer, final-state notification) from a single, dedicated Mojaloop audit topic — not from Mojaloop's per-action primary topics directly. This is the sole Kafka ingress point for the pipeline.

**Acceptance Criteria**
- MLA maintains exactly one consumer group subscription targeting the Mojaloop audit topic.
- MLA does not subscribe to any of the per-action primary topics (`topic-quotes-post`, `topic-transfer-prepare`, etc.) directly.
- On startup, MLA reads from its last committed offset; it does not reset to the beginning of the topic or to the end.
- If the Kafka broker is temporarily unreachable, MLA reconnects automatically using the Kafka client's built-in reconnect logic without operator intervention; the consumer offset stays paused during the outage.
- MLA can be restarted without data loss; events that arrived during the downtime are consumed from the last committed offset on reconnect.

**Assumptions**
- The Mojaloop audit topic exists on the existing Kafka infrastructure (no new Kafka instance is provisioned for this).
- The audit topic has a 7-day retention policy, which is the agreed recovery window.
- The exact mechanism feeding the audit topic from per-action topics (mirroring vs. in-process publishing) is Open Item #7 in the FSD and is owned by the Mojaloop Partner / CCH. MLA's consumer contract does not depend on the feed mechanism — only on the topic existing and being readable.
- Consumer group ID is configured externally (environment variable or config file), not hardcoded.

---

<a id="us-mla-02"></a>
### US-MLA-02 — Distinguish Event Types Within the Audit Topic Stream

**Description**
Because the audit topic carries all event types in a single unified stream, the MLA must classify each consumed message by event type (QUOTE, FXQUOTE, TRANSFER, FXTRANSFER, notification) based on payload shape, not topic name, before routing it to the correct PPA endpoint.

**Acceptance Criteria**
- QUOTE events (pacs.081/pacs.082) are identified and routed to `POST /QUOTES`.
- FXQUOTE events (pacs.091/pacs.092) are routed to `POST /FXQUOTES`.
- TRANSFER events (pacs.008 request/callback) are routed to `POST /TRANSFERS`. FX transfer events (pacs.009, identified by the presence of `commitRequestId` / `determiningTransferId`) are routed to `POST /FXTRANSFERS`.
- Central Ledger final-state notifications are routed to `POST /TRANSFERS/NOTIFICATIONS`.
- An event whose type cannot be classified is skipped: logged as unclassifiable, the offset is advanced, and no envelope is forwarded to PPA.
- The classification logic is unit-tested against sample payloads for all five event types, including the FX/domestic transfer ambiguity.

**Assumptions**
- Whether the audit topic preserves per-event payload-shape identity (needed to distinguish pacs.008 from pacs.009 since they share primary topics) is Open Item #7. If payload shape is not preserved, the FX Transfer / domestic Transfer discriminator cannot function as specified — this must be validated with the Mojaloop Partner before implementation.
- Classification is purely payload-based (field presence/absence); there is no separate metadata header on the audit topic that reliably carries event type.

---

<a id="us-mla-03"></a>
### US-MLA-03 — Decode Base64-Encoded Transfer Payloads

**Description**
Transfer and FX-transfer topic payloads arrive inside the audit topic as base64-encoded `data:` URIs. The MLA must decode these before field extraction or envelope construction. Quote payloads arrive as plain JSON and do not need this step.

**Acceptance Criteria**
- For TRANSFER and FXTRANSFER events, MLA detects the `data:` URI wrapper and base64-decodes the body before any further processing.
- For QUOTE and FXQUOTE events, MLA reads the body as-is (plain JSON) without a decode step.
- A payload that claims to be a TRANSFER type but fails base64 decoding is treated as unreadable: logged, offset advanced, not forwarded.
- Decoded output is valid JSON; if it is not, the event is treated as unreadable (same as above).
- Unit tests cover: valid base64 transfer payload, valid plain JSON quote payload, malformed base64 payload, and a payload with an empty body.

**Assumptions**
- The `data:` URI prefix format is consistent across Kafka events and does not change between Mojaloop versions without a migration notice from the Mojaloop Partner.
- This decoding step is MLA's responsibility only. PPA never performs decoding — it receives already-decoded JSON bodies in the envelope.

---

<a id="epic-2"></a>
## Epic 2 — MLA: Envelope Construction & JWS Validation

---

<a id="us-mla-04"></a>
### US-MLA-04 — Construct a Standard Event Envelope

**Description**
For every successfully classified and decoded event, MLA wraps the message in a typed Event Envelope before sending it to PPA. The envelope is the contract between MLA and PPA; PPA never reads raw Kafka payloads.

**Acceptance Criteria**
- Every envelope contains: `msgType`, `eventType`, `id` (keyed by eventType per table below), `correlationId` (a new UUID generated by MLA per event), `fspiop-source`, `fspiop-destination`, `body` (decoded JSON), and `timestamp` (ISO 8601, moment MLA consumed the event from Kafka).
- `id` follows the per-type scheme: QUOTE → `quoteId`, FXQUOTE → `conversionRequestId`, TRANSFER → `transferId`, FXTRANSFER → `commitRequestId`.
- `fspiop-source` and `fspiop-destination` are mandatory. An event missing either is rejected: logged, offset advanced, not forwarded.
- `correlationId` is unique per event and is propagated end-to-end through PPA, ValKey, audit logs, the DLQ, and the outbound TMS call — it is the cross-component trace handle.
- An event missing `msgType`, `eventType`, or `id` fails envelope construction: logged, offset advanced, not forwarded.
- Unit tests cover: valid envelope for each of the five event types, missing required header, missing body.

**Assumptions**
- `fspiop-source` and `fspiop-destination` are available in the Kafka message headers (or recoverable from the decoded body) for DFSP-originated events. Availability in the audit topic for all event types should be verified with the Mojaloop Partner.
- `correlationId` is MLA-generated, not inherited from Mojaloop; this is intentional to keep MLA's trace ID space independent of Mojaloop's internal correlation IDs.

---

<a id="us-mla-05"></a>
### US-MLA-05 — Validate JWS Signatures on DFSP-Originated Events

**Description**
MLA must validate the `FSPIOP-Signature` header (RS256/384/512) on every DFSP-originated event before forwarding it to PPA. Events with a missing or invalid signature are rejected and an operations security alert is raised. The Central Ledger final-state notification is explicitly exempt — it is switch-generated, not DFSP-originated.

**Acceptance Criteria**
- For DFSP-originated events (all event types except the Central Ledger notification), MLA checks the `FSPIOP-Signature` header against the sending DFSP's registered public key.
- An event with a missing signature header is rejected: logged as a security event, alert raised, offset advanced (not retried — this is a permanent failure).
- An event with an invalid signature (key mismatch, tampered body) is rejected with the same behaviour.
- The Central Ledger final-state notification bypasses JWS validation entirely — no signature check, no alert, forwarded normally.
- Public key lookup for each DFSP is configurable and does not require a service restart to add a new key.
- Unit tests cover: valid signature, missing header, signature mismatch, Central Ledger notification bypass.

**Assumptions**
- Whether the `FSPIOP-Signature` header survives the DFSP → Mojaloop switch → Kafka → audit topic chain is Open Item #3 in the FSD. If the header does not survive the base64 data-URI re-serialisation on transfer topics, JWS validation as specified cannot be implemented and an alternative (e.g. topic-level authentication) must be agreed with CCH before this story can be closed.
- DFSP public key storage and rotation follow the certificate policy in §10.1 of the FSD. Key distribution mechanism is owned by CCH / Mojaloop Partner.

---

<a id="epic-3"></a>
## Epic 3 — MLA: Delivery to PPA & Offset Management

---

<a id="us-mla-06"></a>
### US-MLA-06 — Deliver Envelopes to PPA via Per-Action Endpoints

**Description**
MLA POSTs each constructed envelope to the appropriate PPA endpoint over mutual TLS. It must not advance the Kafka offset until PPA acknowledges receipt with HTTP 200. This offset-gated handoff is what makes the pipeline's durability guarantee real.

**Acceptance Criteria**
- Each envelope is sent to the correct PPA endpoint based on `eventType` (see US-MLA-02 routing table).
- The MLA waits for HTTP 200 from PPA before committing the Kafka offset. It does not advance the offset on any other response.
- All MLA → PPA calls use mutual TLS. A TLS handshake failure (missing or unrecognised client certificate) causes MLA to treat the call as a 5xx (transient) and apply the retry policy.
- MLA addresses PPA via a single stable service name / load balancer address, never individual replica addresses. This address is configurable.
- MLA does not wait for PPA to finish processing the event — only for PPA to confirm receipt with HTTP 200.
- MLA enforces a per-call timeout against PPA (configured independently from the retry/backoff budget); the call is treated as a timeout/5xx if the timeout is breached.

**Assumptions**
- PPA's HTTP 200 means the envelope has been durably written to PPA's write-ahead store (the FSD §4.3 guarantee). MLA trusts this; it does not independently verify PPA's durability state.
- The PPA load balancer address and port are provided via environment configuration.
- mTLS certificates for MLA (client cert/key) and for trusting PPA (CA cert) are provisioned externally and mounted at startup.

---

<a id="us-mla-07"></a>
### US-MLA-07 — Retry and Circuit-Break on PPA Failures

**Description**
When PPA returns a 5xx or times out, MLA retries with exponential backoff and jitter before escalating. When PPA returns a 4xx (invalid envelope), MLA logs and advances the offset without retrying. On sustained consecutive failures, the circuit breaker trips and MLA pauses partition consumption rather than continuing to retry against a known-down PPA.

**Acceptance Criteria**
- On PPA 5xx or timeout: retry up to 3 attempts with exponential backoff (base 1s / 2s / 4s) plus random jitter on each interval. The Kafka offset is not advanced while retries are in progress.
- On PPA 4xx: log the full envelope as an error, raise an operations alert, and advance the offset (permanent failure — retrying will not fix a malformed envelope).
- After N consecutive failures across retries (N is configurable), the circuit breaker trips: MLA pauses consumption on the affected partition(s) entirely. It does not advance any further offsets.
- The circuit breaker re-probes PPA's health on a configurable timer interval. It resumes partition consumption once PPA is healthy again (a successful health probe).
- Jitter is genuinely random (not fixed), so concurrent MLA workers do not synchronize their retry storms.
- An unreadable Kafka message (malformed JSON, bad base64) is skipped: offset advanced, logged, alert raised — not retried.

**Assumptions**
- The circuit breaker threshold (N failures) and re-probe interval are configurable without a restart.
- MLA's own consumer offset on the audit topic is the recovery mechanism for paused partitions — the 7-day retention on the audit topic is the buffer. No separate DLQ is needed on the MLA side.
- For 4xx and JWS-rejection cases, advancing the offset immediately is correct per the current design. This is Open Item #8 in the FSD and must be confirmed with CCH before implementation is finalised.

---

<a id="epic-4"></a>
## Epic 4 — Notification Filter / Dedup Component

---

<a id="us-dedup-01"></a>
### US-DEDUP-01 — Filter and Deduplicate Central Ledger Final-State Notifications

**Description**
The Notification Filter/Dedup component sits between the Mojaloop audit topic and MLA. It identifies final-state notification events within the unified audit stream and suppresses duplicate notifications for the same `transferId` before they reach MLA. All other event types pass through unmodified.

**Acceptance Criteria**
- For each notification event received, the component checks the idempotency key (`transferId`) against a durable store of already-forwarded notifications.
- The first occurrence of a given `transferId` is forwarded to MLA. Subsequent occurrences are silently dropped (not forwarded, logged as duplicate).
- Terminal-state monotonicity is enforced: a `COMMITTED` notification re-emitted after an already-processed `ABORTED` for the same `transferId` does not constitute a new key — it is dropped.
- Non-notification events (quotes, transfers, FX events) pass through this component without any dedup check applied.
- If the component is unavailable, events pass through unfiltered to MLA; PPA's own step-4 idempotency check (keyed on `transferId`) acts as the backstop. This degraded mode is logged and alerted.
- The idempotency store uses a TTL that exceeds the maximum plausible notification re-emission window (to be confirmed with CCH/Mojaloop Partner).
- The component uses the same dedup rule as PPA's step-4 check — one canonical rule, not two independently maintained ones.

**Assumptions**
- The component's precise deployment boundary (Mojaloop side vs. Tazama side) is unconfirmed per the FSD. This must be agreed before implementation begins. The functional spec here is independent of that placement.
- The idempotency store is durable (not in-memory) to survive component restarts without re-admitting already-seen notifications.
- Conflicting terminal states (e.g. `COMMITTED` after `ABORTED`) are possible in theory but their real-world frequency is unknown — the Mojaloop Partner should confirm whether this case actually occurs on COMESA's DRPP.

---

<a id="epic-5"></a>
## Epic 5 — PII Protection Component

---

<a id="us-pii-01"></a>
### US-PII-01 — Tokenize Party Identity Fields Before MLA Consumption

**Description**
A dedicated PII protection component sits between the Mojaloop audit topic and MLA. It applies deterministic, keyed tokenization (HMAC with a vault-held secret) to party identity fields (MSISDNs, party names) that are not carried inside the ILP packet, before MLA ever consumes the event. This is not a decrypt/re-encrypt step — it is a one-way substitution at ingress.

**Acceptance Criteria**
- The component tokenizes MSISDN and party-name fields (as classified in FSD §10.3) on all applicable event types before forwarding to MLA.
- Tokenization is deterministic: the same input always produces the same token for the lifetime of the keying secret, enabling correlation across events without reversing the token.
- The construction is keyed (HMAC with a vault-held secret, not a bare hash) — bare SHA-256 over an MSISDN is reversible by brute-force enumeration of the small MSISDN space and is not acceptable.
- Fields carried inside the ILP packet (payer/payee MSISDNs, payer display name) are explicitly **not** tokenized by this component, because the ILP packet is cryptographically bound and cannot be rewritten without breaking the transfer. These fields reach MLA, PPA, and TMS in cleartext regardless.
- Transaction amounts are explicitly **not** tokenized — amounts must remain in the clear for Tazama's threshold and velocity rules to function.
- If the component is unavailable, its fail-mode (block: stop forwarding until restored; pass-through: forward unprotected) must be confirmed with CCH before implementation. This choice determines whether a component outage is a pipeline-stopping event or a silent PII-exposure window.
- Key/token-vault ownership, rotation policy, and the team responsible are agreed and documented before this component is built.
- The forensic audit topic's own persisted record predates both tokenization and notification-dedup filtering (it records the raw event before either control). Whoever owns the forensic audit workstream must be aware their record carries cleartext PII.

**Assumptions**
- The tokenization construction follows the same keyed-HMAC approach established for this component; any deviation (e.g. a symmetric cipher with reversibility) is a separate design decision requiring CCH approval.
- Open Item #6 in the FSD (Zambia Data Protection Act applicability to tokenized data, which remains personal data as pseudonymisation rather than anonymisation) must be resolved by CCH Legal before this component goes to production.

---

<a id="epic-6"></a>
## Epic 6 — PPA: Ingress API & Write-Ahead Persist

---

<a id="us-ppa-01"></a>
### US-PPA-01 — Expose Per-Action Inbound Endpoints Over Mutual TLS

**Description**
PPA exposes five POST endpoints, one per event type, plus health check endpoints. All are served exclusively over mutual TLS — a connection without a recognised MLA client certificate is rejected at the TLS layer before any application logic runs.

**Acceptance Criteria**
- The following endpoints exist and accept POST requests: `/QUOTES`, `/FXQUOTES`, `/TRANSFERS`, `/FXTRANSFERS`, `/TRANSFERS/NOTIFICATIONS`.
- `/health/live` (GET) returns 200 if the PPA process is responsive.
- `/health/ready` (GET) checks instance-local conditions only: process up, config loaded, write-ahead store reachable and writable. It does **not** check ValKey or the TMS token chain (those are shared-state checks that would take the whole fleet out of rotation on a transient downstream blip).
- All POST endpoints require a valid MLA client certificate (mutual TLS). Connections without a recognised certificate are rejected at the TLS layer with a TLS alert — not with an HTTP 401.
- The allow-list of recognised client certificates contains exactly one entry: the MLA's certificate (or its CA). This is configurable.
- PPA returns HTTP 200 immediately on receipt of a valid envelope and processes asynchronously. The 200 is returned only after the write-ahead persist succeeds (see US-PPA-02).

**Assumptions**
- TLS 1.2 or higher is required. TLS 1.0/1.1 must be disabled.
- mTLS certificates for PPA (server cert/key) and for trusting MLA (CA cert) are provisioned externally and mounted at startup.
- PPA is stateless application logic; horizontal scaling behind a load balancer is the scaling model. All replicas share the same ValKey cluster and write-ahead store.

---

<a id="us-ppa-02"></a>
### US-PPA-02 — Write-Ahead Persist Before Acknowledging MLA

**Description**
Before returning HTTP 200 to MLA, PPA must verify that both ValKey and its own durable write-ahead store are reachable, then write the envelope to the write-ahead store. This is what keeps the event durable if PPA crashes between the ack and completing the processing pipeline.

**Acceptance Criteria**
- Step 1 of the processing pipeline (before any other action): check that both ValKey and the write-ahead store are reachable. If either is down, return HTTP 503 and do nothing further — do not persist, do not acknowledge.
- If both are reachable, write the envelope to the write-ahead store atomically before returning HTTP 200.
- PPA returns HTTP 200 to MLA only after the write-ahead write has succeeded (fsync / durable acknowledge from the store, not just an in-memory write).
- The write-ahead entry is cleared (or marked completed) once the processing pipeline reaches step 9 successfully, or marked failed and left as a DLQ entry if the pipeline dead-letters.
- On a write-ahead store write failure (the store is reachable at the check but the write fails), return HTTP 503 to MLA — do not return 200 for an event that is not durably recorded.
- A 503 response to MLA causes MLA to not advance its Kafka offset, correctly back-pressuring the pipeline.

**Assumptions**
- The write-ahead store and the PPA DLQ are the same physical store — two write paths (write-ahead on receipt; DLQ failure path), one store.
- The write-ahead store technology (database vs. object storage) is TBC pending the hosting-location decision, per FSD §4.7. The store interface must be abstracted so the underlying technology can be swapped.
- Sizing must account for peak TPS (125 TPS per FSD §9.1), not just sustained TPS (25 TPS) — every event is written here, not just failures.

---

<a id="epic-7"></a>
## Epic 7 — PPA: Processing Pipeline

---

<a id="us-ppa-03"></a>
### US-PPA-03 — Validate the Incoming Envelope

**Description**
After acknowledging MLA (step 2), PPA validates the envelope contents asynchronously. An invalid envelope is dead-lettered to the DLQ; it is not forwarded to TMS.

**Acceptance Criteria**
- Validation checks: `msgType` present and non-empty, `eventType` is one of the recognised values (QUOTE, FXQUOTE, TRANSFER, FXTRANSFER, NOTIFICATION), `id` present and non-empty, `fspiop-source` present and non-empty, `body` non-null.
- An envelope failing any check is written to PPA's DLQ and processing stops. No TMS message is emitted.
- A validation failure is logged with the full envelope (masked per §10.3's PII rules) and the specific failed check.
- An unknown `eventType` value is treated as a validation failure.

**Assumptions**
- Validation here is structural/completeness-only. Semantic validation (e.g. does the `transferId` in the body match the `id` in the envelope header) is not part of this step.
- PPA trusts that MLA has already validated the JWS signature and that the envelope body has already been decoded from base64. PPA does not re-validate or re-decode.

---

<a id="us-ppa-04"></a>
### US-PPA-04 — Deduplicate Central Ledger Notification Events

**Description**
For events received at `/TRANSFERS/NOTIFICATIONS`, PPA applies its own idempotency check as a backstop against duplicates that may have passed through the upstream Notification Filter/Dedup component (see US-DEDUP-01). This check uses PPA's durable write-ahead store, not ValKey.

**Acceptance Criteria**
- For each notification event, PPA checks `transferId` against a durable set of already-processed notification IDs.
- Duplicate notifications (same `transferId`) are silently dropped. No TMS message is emitted for a duplicate.
- Terminal-state monotonicity is enforced: a `COMMITTED` re-emitted after an already-processed `ABORTED` for the same `transferId` is treated as a duplicate.
- The dedup store is PPA's durable write-ahead store (not ValKey). This is deliberate: ValKey's `volatile-lru` eviction policy could silently evict a dedup key and re-admit a duplicate.
- The TTL on the dedup entry must exceed the maximum plausible notification re-emission window.
- This check applies to notification events only. It is not applied to quote or transfer events.

**Assumptions**
- Whether conflicting terminal states (e.g. `COMMITTED` after `ABORTED`) can actually occur on COMESA's DRPP is unconfirmed — the Mojaloop Partner should confirm this. The implementation must handle it correctly regardless.

---

<a id="us-ppa-05"></a>
### US-PPA-05 — Classify Each Event as Trigger or Enrichment

**Description**
Every validated event is classified as either a **trigger** (produces exactly one outbound Tazama message) or an **enrichment** (contributes data to the correlation cache only, produces no TMS message). The classification is deterministic based on event type and `msgType`.

**Acceptance Criteria**
- Classification table (non-exhaustive; full table in FSD §6.4.1):
  - `POST /quotes` (request) → **Trigger**: produces pain.001
  - `PUT /quotes` (callback) → **Trigger**: produces pain.013
  - `POST /fxQuotes` + `PUT /fxQuotes` → **Enrichment only**: no TMS message
  - `POST /fxTransfers` + `PUT /fxTransfers` → **Enrichment only** (correlation/audit): no TMS message
  - `POST /transfers` (prepare) → **Trigger**: produces pacs.008
  - `PUT /transfers` (fulfil) or Central Ledger notification → **Trigger**: produces pacs.002
  - Any error callback → **Trigger**: produces pacs.002 with `TxSts: RJCT`
- Classification is unit-tested for every event type, including the error callback case.
- An event that cannot be classified (unexpected combination of `eventType` and `msgType`) is logged and dead-lettered.

**Assumptions**
- The Quote request and Quote callback are independent triggers, not two halves of a paired event. PPA does not wait for the callback before emitting pain.001 — pain.001 fires the moment the request lands.
- FX Quote data enriches the pain.001 trigger as `EqvtAmt`/`XchgRateInf` — it does not produce its own Tazama message.

---

<a id="us-ppa-06"></a>
### US-PPA-06 — Accumulate Enrichment into the Correlation Cache

**Description**
For enrichment events, PPA merges the event's data into the shared transaction-state entry in ValKey, keyed by the appropriate transaction/quote/conversion ID. This must be an atomic read-modify-write because multiple PPA replicas may process related events concurrently.

**Acceptance Criteria**
- Enrichment writes use an atomic read-modify-write on ValKey (e.g. a Lua-scripted compare-and-merge). A plain read-then-write from two concurrent replicas is not acceptable — it silently loses one side's update.
- Cache keys by event type: QUOTE → `quoteId`; FXQUOTE → `conversionRequestId`; TRANSFER → `transferId`; FXTRANSFER → `commitRequestId`.
- The transaction-level key (`transactionId` / `transferId`) accumulates enrichment from all stages concurrently, not just from one stage.
- If ValKey is unreachable at enrichment time, PPA returns HTTP 503 to MLA (as per step 1 — ValKey was checked before acknowledging, so this should not occur; if it does anyway, it is a hard-stop: log, alert, do not silently proceed without caching).
- Cache entries carry an explicit TTL (not indefinite). TTL must account for MLA ingestion delay under Kafka lag — not derived from the Mojaloop expiration field alone (see FSD §9.3).
- Enrichment state is retained until the terminal message for the transaction has been sent to TMS (step 9), not cleared after each individual stage.

**Assumptions**
- ValKey is configured with `volatile-lru` eviction (every correlation key has an explicit TTL). Silent eviction under memory pressure is caught by a dedicated alert on ValKey memory pressure.
- ValKey must run as a highly-available cluster; this is a release-blocking NFR.

---

<a id="us-ppa-07"></a>
### US-PPA-07 — Discriminate Domestic vs. Cross-Border Transfers

**Description**
For TRANSFER and FXTRANSFER trigger events, PPA must determine whether the payment is cross-border (in scope, Phase 1) or domestic (out of scope, Phase 1) before assembling a Tazama message. A transfer with no correlated FX-quote state and no FX linkage field (`determiningTransferId`) is domestic and must be discarded silently.

**Acceptance Criteria**
- At trigger classification time for TRANSFER events: if no FX-quote state is found in the correlation cache AND the event body carries no `determiningTransferId` field, the transfer is classified as domestic.
- Domestic transfers are discarded: no TMS message emitted, no DLQ entry, no alert. A counter metric is incremented (for operational visibility).
- Cross-border transfers (FX-quote state present OR `determiningTransferId` present) proceed to translation.
- Unit tests cover: clear cross-border (FX state present), clear domestic (no FX state, no linkage field), and the race-condition case where FX state is absent at trigger time but `determiningTransferId` is present.

**Assumptions**
- Phase 1 scope is cross-border P2P only. Domestic P2P is deliberately excluded — this is not an error condition.
- The presence of `determiningTransferId` in the transfer prepare body is sufficient to establish FX linkage, even if the FX quote data hasn't been cached yet (e.g. due to a race). In that case, the pacs.008 emitted will be degraded (missing FX enrichment) but is still in-scope and must be sent.

---

<a id="epic-8"></a>
## Epic 8 — PPA: ISO 20022 Translation

---

<a id="us-ppa-08"></a>
### US-PPA-08 — Translate Quote Request to pain.001.001.11

**Description**
When a Quote request (`POST /quotes`) arrives as a trigger, PPA assembles a `pain.001.001.11` message for Tazama. The message is built from the quote request payload plus already-cached FX-quote enrichment (if present). This is one of four messages sent per cross-border payment.

**Acceptance Criteria**
- The assembled `pain.001` includes: payer identity (partyIdInfo, name from `personalInfo.complexName`, DOB from `personalInfo.dateOfBirth`) → `Dbtr`/`InitgPty`; payment amount and type → `Amt.InstdAmt`; FX-quote sourceAmount/targetAmount (if cached) → `Amt.EqvtAmt.{Amt, CcyOfTrf, XchgRateInf}`; `quoteId` → `PmtInfId`; `transactionId` → `PmtId.EndToEndId`.
- `Cdtr.Nm` falls back to the payee's MSISDN (from `payee.partyIdInfo.partyIdentifier`) when a named payee display field is unavailable. This is a known gap (FSD Open Item #4) — the fallback is correct behaviour, not a bug.
- The assembled message is validated against a pinned local copy of Tazama's `pain.001.json` ajv schema before sending (see US-PPA-13). A local validation failure dead-letters the event — it is not sent to TMS.
- `GrpHdr.MsgId` is PPA-generated (ULID), pinned at first assembly and reused on retries.
- `GrpHdr.CreDtTm` is the PPA's timestamp at first assembly, also pinned.
- The assembled message passes Tazama's schema validation with no fields stripped (validated against the same schema TMS uses, with `removeAdditional: 'all'`).
- The quote request's `transactionType` is the authoritative source for `Purp.Cd` (not any copy in a decoded ILP packet).

**Assumptions**
- FX-quote enrichment is read from the correlation cache at trigger time; if absent, `EqvtAmt`/`XchgRateInf` are omitted from pain.001 (this is expected and not a degraded case when no FX leg exists, but must be flagged in the audit log if `determiningTransferId` is present and FX data is absent).
- ALS / party lookup never publishes to Kafka. Payee name is not sourced from a `PUT /parties` event. This is confirmed.

---

<a id="us-ppa-09"></a>
### US-PPA-09 — Translate Quote Callback to pain.013.001.09

**Description**
When a Quote callback (`PUT /quotes`) arrives as a trigger, PPA assembles a `pain.013.001.09` message. This is the second of the four per-payment Tazama messages. It fires independently of pain.001 — PPA does not wait for any pairing.

**Acceptance Criteria**
- The assembled `pain.013` includes: `payeeReceiveAmount`, `payeeFspFee`, `payeeFspCommission` → `CdtTrfTxInf.SplmtryData.Envlp.Doc.{PyeeRcvAmt, PyeeFinSvcsPrvdrFee, PyeeFinSvcsPrvdrComssn}`; `ChrgBr` (from callback, e.g. `CRED`) → `ChrgBr`; quote `expiration` → `PmtInf.XpryDt.DtTm`.
- `GrpHdr.MsgId` is **always PPA-generated** (ULID) — it is never copied from the callback's `extensionList` (even if the Mojaloop wire carries a `GrpHdr.MsgId` extension key). This is a deliberate deviation from the Mojaloop field-mapping reference.
- `XchgRateInf` does not appear in pain.013 (no such element in Tazama's schema). Attempting to include it results in silent field stripping by TMS's `removeAdditional`. The field is correctly absent.
- The assembled message is locally schema-validated before sending.
- The Quote callback's `ChrgBr` and fees data are separately cached into the correlation state for later pacs.008 enrichment — emitting pain.013 and caching for pacs.008 happen in the same trigger-processing step, not in separate passes.

**Assumptions**
- pain.013 is independent of pain.001 in terms of sequencing. If the quote callback arrives before pain.001 has been sent (e.g. extreme out-of-order delivery), pain.013 is still assembled and sent from the callback event alone. No dependency on pain.001's completion.

---

<a id="us-ppa-10"></a>
### US-PPA-10 — Translate Transfer Prepare to pacs.008.001.10

**Description**
When a Transfer prepare (`POST /transfers`) arrives as a trigger, PPA assembles a `pacs.008.001.10` message from the prepare event plus cached enrichment from up to five prior messages (FX quote request/callback, quote request/callback, party data). This is the third per-payment Tazama message. The prepare event alone triggers the pacs.008 — PPA does not wait for the fulfil.

**Acceptance Criteria**
- The assembled `pacs.008` sources fields as follows (normative per FSD §6.4.3):
  - Transfer PREPARE: `transferId` → `PmtId.InstrId`; decoded ILP `transactionId` → `PmtId.EndToEndId`; `amount` → `IntrBkSttlmAmt`; `payerFsp`/`payeeFsp` → `DbtrAgt`/`CdtrAgt`; expiration → `SplmtryData.Envlp.Doc.Xprtn`.
  - Cached Quote request: `personalInfo.complexName` → `Dbtr.Nm`/`InitgPty.Nm`; `dateOfBirth` → `Dbtr.DtAndPlcOfBirth.BirthDt`; `name` → `DbtrAcct.Nm`; `transactionType` → `Purp.Cd`; `note` → `RmtInf.Ustrd`.
  - Cached Quote callback: `ChrgBr` → `ChrgBr`; `payeeFspFee` → `ChrgsInf`; `SttlmMtd` → `GrpHdr.SttlmInf.SttlmMtd`.
  - Cached FX Quote: `sourceAmount` → `InstdAmt`; derived exchange rate → `XchgRate`.
  - PPA-generated: `GrpHdr.MsgId` (ULID, pinned); `GrpHdr.CreDtTm` (pinned); `RgltryRptg` (constant: BALANCE OF PAYMENTS / 100); `SplmtryData.Envlp.Doc.InitgPty.Glctn` (sentinel: 0,0).
- The ILP packet is decoded (base64url → ILP v4 → embedded JSON) to extract `transactionId`. The decoded packet's `transactionType.initiatorType` is advisory only — the quote request's `transactionType` is authoritative for `Purp.Cd`. Any discrepancy between the two copies is logged.
- Degraded fields (when enrichment state is missing) fall back per FSD §6.4.3's degraded table (e.g. payee name → payee MSISDN). The pacs.008 is flagged as degraded in the audit log when any fallback is applied.
- Payee `Cdtr.BirthDt` is set to sentinel `1900-01-01` (no source exists in any Mojaloop message). `CityOfBirth` = "Unknown", `CtryOfBirth` = "ZZ" on both parties.
- Agent identifiers use `FinInstnId.ClrSysMmbId.MmbId`, **not** `FinInstnId.Othr.Id` (Mojaloop's own extension keys use `Othr.Id` — these must not be copied through unmodified).
- After the pacs.008 is sent successfully, PPA writes `transferId → { InstrId, EndToEndId }` into the correlation state for pacs.002's identifier resolution (US-PPA-11).
- `GrpHdr.NbOfTxs` = 1 on every message.

**Assumptions**
- The ILP packet is carried in cleartext in the event body (after MLA's base64 decode). PPA does not need to decrypt it — ILP v4 packet decoding is a structural operation (base64url → BER → JSON), not a cryptographic one.
- Sentinel constants (`Glctn 0,0`, `RgltryRptg`) mean fraud rules must not be configured against payee age, geolocation, or geographic velocity for cross-border traffic — this constraint must be communicated to whoever configures Tazama's rule processors.

---

<a id="us-ppa-11"></a>
### US-PPA-11 — Translate Final-State Event to pacs.002.001.12

**Description**
When the fulfil callback (`PUT /transfers`) or Central Ledger notification arrives as a trigger, PPA assembles a `pacs.002.001.12` message. This is the fourth per-payment Tazama message. For error callbacks (any resource), PPA also emits pacs.002 with `TxSts: RJCT`.

**Acceptance Criteria**
- The assembled `pacs.002` includes: `transferState` translated to ISO `TxSts` (COMMITTED → ACSC, ABORTED → RJCT, RESERVED → ACSP); `completedTimestamp` → `AccptncDtTm`; `fspiop-source`/`fspiop-destination` headers → `InstgAgt`/`InstdAgt`; `transferId → { InstrId, EndToEndId }` resolved from cached state (§6.4.5) → `OrgnlInstrId`/`OrgnlEndToEndId`; cached `payeeFspFee` → `ChrgsInf`.
- `TxSts` uses `ACSC`, not `ACCC` — `COMMITTED` confirms settlement between schemes, not final credit to the payee's account.
- `OrgnlInstrId` and `OrgnlEndToEndId` must exactly match `PmtId.InstrId` and `PmtId.EndToEndId` on the corresponding pacs.008. Mismatched identifiers cause TMS to silently accept the pacs.002 but never link it to its transfer in Tazama's graph.
- PPA does not assume `transactionId` == `transferId` — it always resolves `EndToEndId` from the cached mapping written after the pacs.008 was sent (US-PPA-10).
- For error callbacks: `TxSts` = RJCT; `ChrgsInf` = []. Error code and description are logged in the audit log only (Tazama's pacs.002 interface has no `StsRsnInf` field — attempting to include it causes silent stripping by `removeAdditional`).
- `GrpHdr.MsgId` is PPA-generated (ULID, pinned). It is never copied from the fulfil's `extensionList.GrpHdr.MsgId` extension key, even if that key is present on the wire.

**Assumptions**
- Open Item #5 in the FSD: whether the Central Ledger notification carries `fspiop-source`/`fspiop-destination` is unconfirmed (requires a Kafka-side capture from CCH). If it does not, the fulfil callback is the only viable pacs.002 trigger. Implementation must be written to be switchable between the two sources pending this confirmation.
- `TxSts` is an unconstrained string in Tazama's real schema — an untranslated `"COMMITTED"` would be silently accepted but would break every downstream rule testing for a real ISO status code. The translation is a correctness requirement, not a validation one.

---

<a id="epic-9"></a>
## Epic 9 — PPA: Schema Validation, TMS Dispatch & Dedup

---

<a id="us-ppa-12"></a>
### US-PPA-12 — Validate Assembled Message Against Pinned Local Schema Before Send

**Description**
Before sending any message to TMS, PPA validates the assembled message against a pinned local copy of Tazama's ajv schema for that message type. This catches field-level drift from the pinned `tms-service` version before `removeAdditional: 'all'` on TMS silently strips the offending fields and returns a false HTTP 200.

**Acceptance Criteria**
- PPA maintains pinned local copies of Tazama's JSON schemas for all four message types: `pain.001.json`, `pain.013.json`, and the pacs.008/pacs.002 schemas.
- Every assembled message is validated against the appropriate pinned schema before the TMS POST is issued.
- A local validation failure is treated as a translate-time defect: logged, alert raised, event written to PPA's DLQ. The message is **not** sent to TMS.
- The pinned schema files are version-controlled alongside the PPA codebase and track the same `tms-service` commit pinned in the FSD.
- Updating the pinned schema (e.g. for a TMS upgrade) requires an explicit, reviewed commit — not an automatic pull on startup.
- Integration tests validate each of the four message types' assembled outputs against the pinned schemas.

**Assumptions**
- The pinned commit for the `tms-service` schemas is identified and documented before implementation begins. The FSD defers this to a named pin (Open Item in §6.5.2).
- Local schema validation runs the same ajv configuration TMS uses (including `removeAdditional: 'all'`). Using a different ajv config for local validation would defeat the purpose.

---

<a id="us-ppa-13"></a>
### US-PPA-13 — Send Validated Messages to Tazama TMS

**Description**
PPA dispatches each validated message to the correct version-pinned Tazama TMS endpoint using HTTPS with mutual TLS plus a Keycloak-issued bearer token. Delivery is at-least-once; retries reuse the same pinned message, never a rebuild.

**Acceptance Criteria**
- The endpoint is version-pinned per message type: `POST /v1/evaluate/iso20022/pain.001.001.11`, `pain.013.001.09`, `pacs.008.001.10`, `pacs.002.001.12`.
- Every call uses HTTPS (plain HTTP to TMS is rejected) with mutual TLS and a bearer token from the Auth-lib → Auth-service → Keycloak chain. Both the mTLS client certificate and the bearer token are present on every request.
- On a 5xx or timeout: retry up to 3 times with exponential backoff and jitter. Each retry sends the **exact same message** built at translation time (same pinned `GrpHdr.MsgId`) — never a rebuilt message with a new MsgId.
- On a 4xx: dead-letter to PPA's DLQ, do not retry, investigate payload.
- On exhausting all retries: dead-letter to DLQ, raise an operations alert.
- HTTP 200: log success, clear transaction state from ValKey (only once the terminal message for the transaction has been sent — not simply on any pacs.008), update the write-ahead record.
- `Content-Type: application/json` on every call.

**Assumptions**
- The Auth-lib, Auth-service, and Keycloak are runtime dependencies of PPA. Their unavailability directly affects PPA's ability to deliver to TMS. Token refresh failure must be separately alerted (§9.4) so an operator is paged before the failure cascades.
- The Keycloak token has a finite TTL. PPA must refresh it proactively before expiry, not reactively after the first 401.

---

<a id="us-ppa-14"></a>
### US-PPA-14 — Prevent Duplicate TMS Submissions with a Sent-Message Dedup Set

**Description**
To prevent inserting duplicate transaction history into Tazama's graph (e.g. from PPA crash-and-replay), PPA maintains a short-TTL sent-message set in ValKey, keyed by `id + isoMessageType`. A send only proceeds if the key does not already exist (atomic check-and-set).

**Acceptance Criteria**
- Before issuing the TMS POST, PPA performs an atomic check-and-set (`SET ... NX EX`) on a ValKey key of `{id}:{isoMessageType}` (e.g. `01K7EV9TNQ1VKX84N0GSQH6MDD:pacs.008.001.10`).
- If the key already exists (another replica already sent this message), the send is skipped and logged as a duplicate. No DLQ entry, no alert.
- If the key does not exist, it is set with a short TTL (scoped to the retry window, not the correlation TTL) and the TMS POST proceeds.
- This dedup set uses a **separate key namespace** from the correlation cache (US-PPA-06). The TTT is an order of magnitude shorter than the correlation TTL.
- The dedup set is backed by ValKey (same HA cluster as the correlation cache), not by PPA's local memory.
- A ValKey failure at this step causes PPA to not send (conservative: prefer missing a message over duplicating it). This is a hard-stop.

**Assumptions**
- The at-least-once delivery guarantee (§6.6) is fulfilled by the retry policy (US-PPA-13). The dedup set is a guard against double-send from concurrent replicas, not a substitute for retries.
- The short TTL must outlive the full retry budget (up to ~7s per hop, §9.2) with a safety margin.

---

<a id="epic-10"></a>
## Epic 10 — PPA: Error Recovery, DLQ & Missing Correlations

---

<a id="us-ppa-15"></a>
### US-PPA-15 — Dead-Letter Queue: Write, Alert, and Support Replay

**Description**
PPA's DLQ is the same store as its write-ahead record (one store, two write paths). Every DLQ write raises an operations alert. Replay is manual and operator-triggered, re-injecting an entry from the point it failed. Every replay is audit-logged.

**Acceptance Criteria**
- Events written to the DLQ include the full envelope (PII-masked per §10.3), the failure reason, retry count, timestamp, the `correlationId`, and the `isoMessageType` where applicable.
- Every DLQ write immediately raises an operations alert (alerting destination/tooling is tracked separately as an open item).
- DLQ entries have a 90-day retention period, after which they are purged or archived per CCH compliance policy.
- Replay is operator-triggered only (no auto-replay). A replay re-injects the entry into the pipeline from the step it failed, without requiring a fresh Kafka event.
- Every replay writes its own audit log entry, including a `replay-of` pointer to the original entry.
- PII fields in the DLQ are in their already-tokenized/protected form (tokenization happens upstream of MLA; by the time an event reaches PPA's DLQ, applicable fields are already protected per §10.3's narrowed scope).

**Assumptions**
- DLQ entries for transactions that PPA proactively parks before a ValKey TTL expiry (US-PPA-16) are not terminal records — they are live recovery state. The operator tooling for replay must make this distinction visible.
- Alerting destination (Slack, PagerDuty, email) is determined during infrastructure setup, not specified here.

---

<a id="us-ppa-16"></a>
### US-PPA-16 — Park Correlation State Before ValKey TTL Expiry

**Description**
When a leg's ValKey correlation state is at risk of expiring before its expected counterpart event has arrived (e.g. a final-state notification that never came), PPA writes the accumulated state to its DLQ/write-ahead store before the TTL lapses. If the late event eventually arrives — even days later — PPA retrieves the parked state and completes correlation from the durable store rather than treating the arrival as unresolvable.

**Acceptance Criteria**
- PPA monitors correlation TTL expiry for legs that are in-progress (pacs.008 sent, pacs.002 not yet sent). Before expiry, PPA writes the full accumulated leg state to its DLQ.
- If the pacs.002-triggering event arrives after the ValKey TTL has lapsed, PPA checks the DLQ/write-ahead store for a parked entry for that `transferId` before giving up.
- If found in the DLQ, PPA retrieves the parked state, resolves `OrgnlInstrId`/`OrgnlEndToEndId` from it (US-PPA-11), assembles, and emits the pacs.002.
- The effective correlation lifetime extends to the DLQ's 90-day retention (not just ValKey's short TTL).
- A pacs.002-triggering event for a `transferId` not found in ValKey or the DLQ is logged and alerted — it is not forwarded to TMS without identity resolution.
- Parking a state to the DLQ does not raise the same alert as a true dead-letter (failure). It raises a distinct informational alert (e.g. "correlation TTL approaching, parking state for `transferId` X").

**Assumptions**
- This mechanism covers the case where PPA was running but the final-state event simply never arrived in time. It does not cover the case where PPA itself was down long enough that it never got to park anything — that residual scenario is Open Item #9 in the FSD and needs separate handling confirmed with Paysys.
- The DLQ store must support keyed retrieval by `transferId` (not just sequential scan). Technology selection must account for this query pattern.

---

<a id="us-ppa-17"></a>
### US-PPA-17 — Handle Out-of-Order Arrival (Fulfil Before Prepare)

**Description**
Because the transfer prepare and fulfil are on different Kafka topics and processed by PPA replicas asynchronously, the fulfil's pacs.002 trigger may arrive at PPA before the prepare's pacs.008 trigger. PPA must park the fulfil within a short bounded window and retry rather than discarding it.

**Acceptance Criteria**
- If a pacs.002 trigger event (fulfil or notification) arrives and no transaction state exists for its `transferId` in ValKey or the DLQ, PPA does not immediately dead-letter it.
- PPA holds the event and retries within a short, bounded window — reusing the existing retry budget (§6.7), not a separate mechanism.
- After the bounded window, if the prepare's state still hasn't arrived, the event is dead-lettered to the DLQ and alerted.
- If the prepare's pacs.008 is processed after the fulfil has already been dead-lettered, PPA retrieves the parked fulfil from the DLQ and completes correlation from there (the DLQ is not a terminal record in this case — it is where the pending fulfil state waits).
- The park-and-retry logic is unit-tested with a simulated fulfil-before-prepare race condition.

**Assumptions**
- The prepare-to-fulfil gap in normal operation is under 1 second (per §7's corridor capture). The retry window should be calibrated with this in mind, but must also account for MLA backlog scenarios where the gap widens.
- This is a real and likely race condition, not a remote edge case, due to independent consumer lag on the prepare vs. fulfil partitions.

---

<a id="epic-11"></a>
## Epic 11 — Audit Logging, Security & Monitoring

---

<a id="us-aud-01"></a>
### US-AUD-01 — Write Audit Log Entries for Every Processed Event

**Description**
Every event processed by PPA produces a full audit log entry covering what came in, what was sent, all timestamps, TMS response, error detail, and whether the message was flagged as degraded.

**Acceptance Criteria**
- Every audit entry contains: `correlationId`, envelope `id`, `isoMessageType`, `eventType`, source/destination DFSP, ingestion timestamp, processing outcome (success/error/retry/DLQ), retry count, TMS response code, and the `degraded` flag.
- Entries for events with a DLQ reference include the DLQ entry ID.
- Replay entries include a `replay-of` pointer to the original entry.
- PII fields (MSISDNs, names) are masked/truncated in audit log output (e.g. last 4 digits only). Full values are retrievable only via a separate access-controlled lookup — never embedded in plaintext log lines.
- Audit log storage is a dedicated, append-only store (not Kafka, not PPA's DLQ). Write-only access from PPA; no update or delete API.
- Access to the full audit log is Keycloak-role-gated.
- Retention period is confirmed against CCH compliance policy before go-live.

**Assumptions**
- The audit log store is separate from the DLQ/write-ahead store and from application logs. All three can survive independently of each other.
- Audit entries are immutable — the store must enforce this (no UPDATE/DELETE on committed records).

---

<a id="us-mon-01"></a>
### US-MON-01 — Monitor Consumer Lag, Circuit Breaker State, and Degraded Message Rate

**Description**
The pipeline's health is invisible without operational telemetry. Four distinct signals must be monitored and alerted on: Kafka consumer lag (leading indicator of backlog), paused-offset rate (lagging indicator), ValKey memory pressure (correlation-loss risk), and the degraded-message rate (the only signal that enrichment sources are systematically missing).

**Acceptance Criteria**
- A consumer lag metric is emitted per partition and alerted when it exceeds a configured threshold.
- A paused-offset-rate metric is emitted and alerted separately from consumer lag (these indicate different failure modes).
- ValKey memory pressure is alerted before eviction begins — so that a sustained eviction pressure condition is caught before silently losing correlation keys.
- The degraded-message rate (proportion of outbound messages flagged degraded in any 5-minute window) is tracked and alerted. A degraded-message spike is the only signal that an upstream stage is failing silently.
- The circuit breaker state (open/closed/half-open) at both the MLA→PPA and PPA→TMS hops is exposed as a metric and alerted when it trips.
- ValKey reachability and TMS token-refresh health are surfaced as metrics and alerts (not as readiness probe inputs — see US-PPA-01).
- All metrics are in a format compatible with the observability stack agreed for the COMESA infrastructure (Prometheus-compatible metrics export is the baseline assumption).

**Assumptions**
- The specific alert thresholds (e.g. consumer lag > N events, degraded rate > X%) are set during infrastructure commissioning based on the 25 TPS sustained baseline. Default thresholds are placeholders.
- Alerting destination (PagerDuty, Slack, email) is determined during infrastructure setup.

---

<a id="us-mon-02"></a>
### US-MON-02 — Expose Health Endpoints for Load Balancer and Orchestrator

**Description**
PPA's liveness and readiness probes must be correctly scoped so a transient downstream blip does not take the whole PPA fleet out of load-balancer rotation.

**Acceptance Criteria**
- `GET /health/live` returns 200 if the PPA process is running and responsive. It does not check any external dependency.
- `GET /health/ready` returns 200 only when: process is up, config is loaded, and PPA's write-ahead store is reachable and writable. It does **not** check ValKey or the TMS token chain.
- ValKey and TMS token-chain health are exposed as metrics (see US-MON-01), not as readiness-probe inputs.
- The readiness endpoint is the target for the load balancer's health check. A 503 from readiness removes the replica from rotation but does not affect other replicas (unlike a ValKey check, which would take the whole fleet out simultaneously).
- Both endpoints respond within 200 ms under normal conditions.

**Assumptions**
- The load balancer and orchestrator (e.g. Kubernetes) consume these endpoints. Configuration of probe intervals and failure thresholds is done at the infrastructure level, not in application code.

---

<a id="epic-12"></a>
## Epic 12 — Performance & Infrastructure

---

<a id="us-perf-01"></a>
### US-PERF-01 — Meet Latency Targets at Sustained and Peak TPS

**Description**
The pipeline must deliver each Mojaloop event to TMS within the agreed latency budget at both sustained (25 TPS) and peak (125 TPS) throughput, without data loss or unbounded consumer lag growth.

**Acceptance Criteria**
- MLA end-to-end ack latency (Kafka consume → PPA HTTP 200 received) ≤ 200 ms at p95 under sustained load.
- PPA correlation-to-TMS latency (envelope received → TMS HTTP 200) ≤ 500 ms at p95 under sustained load.
- At peak TPS (125 TPS), consumer lag does not grow unboundedly — the pipeline consumes events at least as fast as they are produced.
- Load tests cover: sustained 25 TPS for 30 minutes, peak 125 TPS for 5 minutes, and a step-down from peak to sustained (no event loss during step-down).
- Kafka partition count and MLA consumer parallelism are sized to the per-action topic event rate (informed by FSD §9.4 guidance).

**Assumptions**
- The 25 TPS sustained / 125 TPS peak baseline is from the Infrastructure Design Document (`CCH_IDD_SystemDeployment_v1.0.md`). If this baseline changes, performance targets must be revisited.
- Load testing is against a staging environment that mirrors production sizing. Production sizing is defined in the Infrastructure Design Document (out of scope here).

---

<a id="us-perf-02"></a>
### US-PERF-02 — Size and Configure ValKey for Correlation Workload

**Description**
ValKey must be sized and configured to hold the full in-flight correlation state for cross-border payments at peak TPS, without evicting active keys under memory pressure.

**Acceptance Criteria**
- ValKey memory capacity is sized using the formula: `Peak concurrent cached entries ≈ TTL(s) × in-flight request rate (req/s) × stages-per-transaction (4) × avg payload size (bytes) × safety factor (1.5–2x)`. The 4-stage multiplier is non-negotiable — all four stages (FX Quote, Quote, FX Transfer, Transfer) may be in-flight concurrently.
- TTL is set per FSD §9.3's formula (max of Mojaloop expiration field and worst-case MLA-to-PPA transit + Kafka lag buffer). TTL is not derived from the expiration field alone.
- Eviction policy is `volatile-lru`. Every correlation key and the sent-message dedup set both carry explicit TTLs.
- A dedicated ValKey alert fires on memory pressure before eviction begins (not after).
- ValKey runs as a highly-available cluster (minimum: primary + replica with automatic failover). This is a release-blocking NFR — ValKey downtime is a hard-stop for the pipeline.
- Cache hit ratio is monitored; a sustained drop below a configured threshold triggers an alert.

**Assumptions**
- ValKey is kept entirely separate from Tazama's own Redis/Postgres/NATS infrastructure, consistent with the Infrastructure Design Document's deployment rules.
- The final TTL values are confirmed once the exact per-message payload sizes are known from a staging profiling run.

---

<a id="us-sec-01"></a>
### US-SEC-01 — Establish mTLS Certificates for MLA↔PPA and PPA↔TMS

**Description**
All inter-service communication must use mutual TLS. Certificate issuance, rotation, and distribution must be specified, owned, and operational before any service goes to production.

**Acceptance Criteria**
- MLA presents a client certificate to PPA on every call. PPA validates against an allow-list containing exactly MLA's certificate (or its CA).
- PPA presents a client certificate to TMS. TMS validates the PPA certificate as a condition of accepting the connection.
- Minimum key size: 2048-bit RSA (or equivalent elliptic curve).
- TLS 1.2 or higher is enforced on all hops. TLS 1.0/1.1 are disabled.
- Certificate rotation is possible without a service restart (hot-reload or rolling restart — confirmed with CCH before implementation).
- Certificate expiry is monitored with an alert fired well before expiry (minimum 30-day warning).
- The certificate issuance and rotation policy is documented and owned by a named team before go-live.

**Assumptions**
- The MLA → PPA hop uses mutual TLS **only** (no bearer token on this hop) because MLA sits inside Mojaloop's network boundary and cannot reach Tazama-owned identity infrastructure.
- The PPA → TMS hop uses mutual TLS **and** a Keycloak bearer token — both are required. mTLS authenticates which service is calling; the token authorizes what it is allowed to do.
- Certificate tooling (e.g. Vault PKI, cert-manager on Kubernetes, or manual issuance) is determined at infrastructure setup time, not here.

---

*End of Document*

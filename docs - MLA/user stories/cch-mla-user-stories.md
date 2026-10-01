# CCH — Mojaloop Adaptor (MLA): User Stories & Review

**CCH FRMS | Paysys Labs** | Component: MLA | 18th August 2026
Source stories: `CCH_UserStories_MessageIngestion_v1.0.md`, Epics 1–3 · Review consolidated from `CCH_UserStories_MessageIngestion_ConsolidatedReview_v1.0.md`
**Testing standard:** 95% test coverage with Jest on every piece of code, applied here and across every other component's stories.

---

## User Stories

### Epic 1 — MLA: Kafka Subscription & Audit Topic Ingestion

#### US-MLA-01 — Subscribe to the Mojaloop Audit Topic

**Description**
The MLA must consume all payment events (FX quote, quote, FX transfer, transfer — including the transfer's fulfil/final-state leg) from a single, dedicated Mojaloop audit topic — not from Mojaloop's per-action primary topics directly. This is the sole Kafka ingress point for the pipeline. There are four event types on this topic: the final-state/fulfil event is not a separate category — it's the same `PUT /transfers` fulfil callback, DFSP-signed like any other TRANSFER event (`cch-notification-dedup-user-stories.md` has the supporting evidence).

**Acceptance Criteria**
- MLA maintains exactly one consumer group subscription targeting the Mojaloop audit topic.
- MLA does not subscribe to any of the per-action primary topics (`topic-quotes-post`, `topic-transfer-prepare`, etc.) directly.
- Each logical event is written to the audit topic twice — once as `metadata.event.action: start` (captured when the switch receives it) and once as `egress` (captured when the switch relays it onward) — carrying identical business content. MLA ingests only `start` records; `egress` records are recognized and discarded as a structural skip, not logged as an error. This is what keeps MLA from processing every event twice.
- On startup, MLA reads from its last committed offset; it does not reset to the beginning of the topic or to the end.
- If the Kafka broker is temporarily unreachable, MLA reconnects automatically using the Kafka client's built-in reconnect logic without operator intervention; the consumer offset stays paused during the outage.
- MLA can be restarted without data loss; events that arrived during the downtime are consumed from the last committed offset on reconnect.

**Method**
1. **Configure** — the consumer group ID, broker addresses, and audit-topic name are read from external configuration at startup.
2. **Resolve offset** — on startup, MLA asks Kafka for its last committed offset on the audit topic and resumes from there.
3. **Subscribe** — MLA subscribes to the audit topic's partitions under its consumer group.
4. **Filter on action** — for each record consumed, check `metadata.event.action`. If it is `egress`, discard it immediately (offset still advances normally) and read the next record. Only `start` records continue on to classification (US-MLA-02).
5. **Handle disconnects** — if the broker connection drops, MLA relies on the Kafka client's built-in reconnect/backoff behaviour; the offset is not advanced while disconnected.
6. **Resume** — once reconnected, consumption continues from the last committed offset, so nothing produced during the outage is missed.

**Assumptions**
- The Mojaloop audit topic exists on the existing Kafka infrastructure (no new Kafka instance is provisioned for this).
- The audit topic has a 7-day retention policy, which is the agreed recovery window.
- The exact mechanism feeding the audit topic from per-action topics (mirroring vs. in-process publishing) is Open Item #7 in the FSD and is owned by the Mojaloop Partner / CCH. MLA's consumer contract does not depend on the feed mechanism — only on the topic existing and being readable.
- Consumer group ID is configured externally (environment variable or config file), not hardcoded. **See R-18 below — this needs to be a *dedicated* group, not just externally configured.**
- The `start` record for every event type MLA routes on already carries the full payload and headers needed for classification and envelope construction — confirmed against `DRPP_Kafka_E2E_Pack` (5 corridors, zero exceptions). MLA does not need to wait for or merge in anything from the matching `egress` record.

**Todos**
1. Get CCH to issue a **dedicated** consumer group ID for this service — a reused DRPP-internal group name risks stealing partition assignments from a live payment-path handler (R-18).
2. Implement the `start`/`egress` filter as the first step after decoding a record off the topic, ahead of classification.
3. Implement offset-resume-on-restart logic and the reconnect/backoff handling.
4. Write tests (Jest, 95% coverage target) covering: `egress` records are discarded without being forwarded, cold start from last committed offset, broker disconnect/reconnect without offset advance, and restart-without-data-loss.
5. Confirm the audit-topic feed mechanism and its guarantees with the Mojoloop Partner (Open Item #7).

---

#### US-MLA-02 — Distinguish Event Types Within the Audit Topic Stream

**Description**
Because the audit topic carries all event types in a single unified stream, the MLA must classify each consumed message by event type (QUOTE, FXQUOTE, TRANSFER, FXTRANSFER). Confirmed against `DRPP_Kafka_E2E_Pack` (5 corridor captures from `topic-event-audit`, 20 records each, 100 records total, zero exceptions): every record carries a `metadata.trace.tags.operation` value that maps directly to one of the four types, corroborated by the record's `Content-Type`/`Accept` header (the ISO 20022 resource name — `quotes`, `fxQuotes`, `transfers`, `fxTransfers`) and its `FSPIOP-HTTP-Method` header (POST for the request leg, PUT or PATCH for the callback leg). The transfer's prepare and fulfil/final-state legs are both TRANSFER — there is no separate notification category (see US-MLA-01). Where each classified event is delivered to on PPA is covered separately (US-MLA-06); this story is only about resolving the correct eventType.

**Classification Table**

| `operation` | HTTP Method | Resource Path | Leg | Classifies As |
| --- | --- | --- | --- | --- |
| `postQuotes` | POST | `/quotes` | Request | **QUOTE** |
| `putQuotesByID` | PUT | `/quotes/{quoteId}` | Callback | **QUOTE** |
| `postFxQuotes` | POST | `/fxQuotes` | Request | **FXQUOTE** |
| `putFxQuotesByID` | PUT | `/fxQuotes/{conversionRequestId}` | Callback | **FXQUOTE** |
| `prepareTransfer` | POST | `/transfers` | Prepare | **TRANSFER** |
| `fulfilTransfer` / `commitTransfer` | PUT / PATCH | `/transfers/{transferId}` | Fulfil / final-state | **TRANSFER** |
| `prepareFxTransfer` / `reserveFxTransfer` | POST | `/fxTransfers` | Request | **FXTRANSFER** |
| `fulfilFxTransfer` | PUT | `/fxTransfers/{commitRequestId}` | Reserve callback | **FXTRANSFER** |
| `notifyFxTransfer` / `commitTransfer` | PATCH | `/fxTransfers/{commitRequestId}` | Commit (`TxSts: COMM`) | **FXTRANSFER** |
| `getPartiesByTypeAndID` / `putPartiesByTypeAndID` / `putPartiesErrorByTypeAndID` | GET / PUT | `/parties/{Type}/{ID}` | Party discovery | **Out of scope — skipped** |
| *(anything not matching a row above)* | — | — | — | **Unclassifiable — skipped** |

Note that TRANSFER has two legs and FXTRANSFER has three — the extra `PATCH` commit leg on FXTRANSFER has no domestic-TRANSFER equivalent.

**Acceptance Criteria**
- Every event is classified using its `operation` value (or, where that field isn't available on a given record, the resource name from `Content-Type`/`FSPIOP-URI` together with `FSPIOP-HTTP-Method`), per the Classification Table above.
- Every row of the Classification Table is covered — all legs of QUOTE, FXQUOTE, TRANSFER, and FXTRANSFER, including FXTRANSFER's three-leg lifecycle.
- Party-discovery records are recognized and explicitly skipped — they are not one of the four `eventType` values and are out of MLA's scope (FSD §11 Phase 1 Exclusions).
- An event matching no row in the table is skipped: logged as unclassifiable, the offset is advanced, and no envelope is forwarded to PPA.
- The classification logic is unit-tested against sample payloads for every row of the Classification Table.

**Method**
1. **Read the classification signal** — prefer `metadata.trace.tags.operation` where present on the record; otherwise fall back to the `Content-Type`/`Accept` header's resource name combined with the `FSPIOP-HTTP-Method` header.
2. **Map** — look the operation/resource up against the table above to resolve one of QUOTE, FXQUOTE, TRANSFER, FXTRANSFER, or "party discovery" (out of scope).
3. **Skip out-of-scope records** — party-discovery operations are recognized and dropped without further processing.
4. **Skip unclassifiable events** — anything matching none of the known operations/resources is logged, the offset is advanced, and nothing is forwarded.
5. **Pass on the resolved eventType** — a successfully classified event proceeds to envelope construction (US-MLA-04), which is where its PPA destination is decided.

**Assumptions**
- `metadata.trace.tags.operation` is present and reliable on `topic-event-audit` as captured — confirmed with zero exceptions across all 5 corridor samples in `DRPP_Kafka_E2E_Pack`. Whether this is a guaranteed platform contract or an artefact of this particular capture window is still open, and should be confirmed for CCH's own environment/version before this classification rule is finalized.
- `operation` naming is not perfectly symmetric between a step's `start` and `egress` capture — one corridor's `start: fulfilFxTransfer` pairs with `egress: reserveFxTransfer` for what is the same logical step. Classification should key primarily on the HTTP method plus resource name (`Content-Type`/`FSPIOP-URI`), using `operation` as a secondary, confirmatory signal rather than the sole discriminator.
- There is no fifth "notification" classification value. This matches the FSD's four-value `eventType` enum exactly, and is confirmed — not just assumed — by the Kafka evidence: there is no distinct event to classify as a notification in the first place.
- Whether `operation`, `Content-Type`, and `FSPIOP-HTTP-Method` survive identically in CCH's production audit-topic feed (as opposed to this staging capture) is Open Item #7 and should be validated before implementation is finalized.

**Todos**
1. Implement the classification rule set against the operation/resource/method mapping table, including FXTRANSFER's three-leg lifecycle and the party-discovery skip path.
2. Write tests (Jest, 95% coverage target) covering all four event types (every leg of each, including FXTRANSFER's PATCH commit stage), the party-discovery skip, and the unclassifiable-event skip path.
3. Validate that `operation`, `Content-Type`, and `FSPIOP-HTTP-Method` are present and reliable on CCH's production audit topic (Open Item #7) before this story is considered implementation-ready.

---

#### US-MLA-03 — Decode Base64-Encoded Transfer Payloads

**Description**
Transfer and FX-transfer topic payloads arrive inside the audit topic as base64-encoded `data:` URIs. The MLA must decode these before field extraction or envelope construction. Quote payloads arrive as plain JSON and do not need this step.

**Acceptance Criteria**
- For TRANSFER and FXTRANSFER events, MLA detects the `data:` URI wrapper and base64-decodes the body before any further processing.
- For QUOTE and FXQUOTE events, MLA reads the body as-is (plain JSON) without a decode step.
- A payload that claims to be a TRANSFER type but fails base64 decoding is treated as unreadable: logged, offset advanced, not forwarded.
- Decoded output is valid JSON; if it is not, the event is treated as unreadable (same as above).
- Unit tests cover: valid base64 transfer payload, valid plain JSON quote payload, malformed base64 payload, and a payload with an empty body.

**Method**
1. **Detect** — check whether the body is wrapped in a `data:` URI (TRANSFER/FXTRANSFER) or is already plain JSON (QUOTE/FXQUOTE).
2. **Decode** — for wrapped bodies, base64-decode the content.
3. **Validate** — parse the result as JSON; if decoding or parsing fails, treat the event as unreadable.
4. **Pass through** — hand the resulting plain JSON body on to classification and envelope construction.

**Assumptions**
- The `data:` URI prefix format is consistent across Kafka events and does not change between Mojaloop versions without a migration notice from the Mojaloop Partner.
- This decoding step is MLA's responsibility only. PPA never performs decoding — it receives already-decoded JSON bodies in the envelope.

**Todos**
1. Implement the decode/validate step, including the unreadable-payload fallback (log + advance offset, no forward).
2. Write tests (Jest, 95% coverage target) covering: valid base64 transfer payload, valid plain JSON quote payload, malformed base64, and empty body.

---

### Epic 2 — MLA: Envelope Construction & JWS Validation

#### US-MLA-04 — Construct a Standard Event Envelope

**Description**
For every successfully classified and decoded event, MLA wraps the message in a typed Event Envelope before sending it to PPA. The envelope is the contract between MLA and PPA; PPA never reads raw Kafka payloads.

The envelope carries two distinct identifiers that must not be confused with each other. `id` is the business identifier for the event's own leg (see the per-type scheme below) — it is what PPA uses, together with the fields already present in each event's decoded body, to correlate an event with the other legs of the same transaction (e.g. matching a Transfer's `PmtId.TxId` against the originating Quote's `PmtId.EndToEndId`; confirmed via `DRPP_Kafka_E2E_Pack`, both equal to `transferId`/`transactionId` for the sampled transaction). `correlationId` is a different, narrower thing: a fresh UUID minted by MLA for this one Kafka record, used purely as a diagnostic trace handle so ops can pull every log line, audit entry, and DLQ entry tied to the processing of that specific message. It is intentionally per-event, not per-transaction, and it plays no part in linking a Quote to its Transfer — that correlation is `id`-driven and is PPA's responsibility, not MLA's.

**Acceptance Criteria**
- Every envelope contains: `msgType`, `eventType`, `id` (keyed by eventType per table below), `correlationId` (a new UUID generated by MLA per event), `fspiop-source`, `fspiop-destination`, `body` (decoded JSON), and `timestamp` (ISO 8601, moment MLA consumed the event from Kafka).
- `msgType` is one of exactly two values: `request` or `callback` — set from the same signal US-MLA-02 already uses to classify the event (`operation`, corroborated by `FSPIOP-HTTP-Method`): a POST leg is `request`, a PUT or PATCH leg is `callback`. There is no third value — the FSD's own "Central Ledger notification" `msgType` is dead (see US-MLA-01/02), and reject/abort/error variants are not separate `msgType` values, they are payload states carried within a `request` or `callback` envelope (consistent with the FSD's PPA-endpoint table, which routes "any msgType" including error variants to the same endpoint).
- `id` follows the per-type scheme: QUOTE → `quoteId`, FXQUOTE → `conversionRequestId`, TRANSFER → `transferId` (covers both the prepare and fulfil/final-state legs — same `transferId` throughout), FXTRANSFER → `commitRequestId`. Four rows, matching the FSD's four-value `eventType` enum — see US-MLA-02. This is the field PPA correlates transaction legs on; it is not generated by MLA, it's read straight off the event.
- `fspiop-source` and `fspiop-destination` are mandatory. An event missing either is rejected: logged, offset advanced, not forwarded.
- `correlationId` is unique per event (not shared across the legs of one transaction) and is propagated end-to-end through PPA, ValKey, audit logs, the DLQ, and the outbound TMS call for that event specifically — it is a per-message trace handle, not the transaction-correlation key.
- An event missing `msgType`, `eventType`, or `id` fails envelope construction: logged, offset advanced, not forwarded.
- Unit tests cover: valid envelope for each of the four event types, both `msgType` values, missing required header, missing body.

**Method**
1. **Read required fields** — `eventType` and the type-specific `id` field from the classified, decoded event.
2. **Derive `msgType`** — `request` if the leg's HTTP method was POST, `callback` if it was PUT or PATCH (the same signal already read during classification in US-MLA-02, not a separate lookup).
3. **Generate** — a new `correlationId` (UUID) for this event, independent of any Mojoloop-internal ID.
4. **Assemble** — build the envelope with all required fields plus `fspiop-source`, `fspiop-destination`, the decoded `body`, and an ISO 8601 `timestamp`.
5. **Validate completeness** — if any mandatory field (`msgType`, `eventType`, `id`, `fspiop-source`, `fspiop-destination`) is missing, reject: log, advance offset, do not forward.

**Assumptions**
- `fspiop-source` and `fspiop-destination` are available in the Kafka message headers (or recoverable from the decoded body) for DFSP-originated events. Availability in the audit topic for all event types should be verified with the Mojoloop Partner.
- `correlationId` is MLA-generated, not inherited from Mojaloop — deliberately, since Mojaloop's own `traceId` isn't transaction-scoped (confirmed via `DRPP_Kafka_E2E_Pack`: a single `traceId` covered two unrelated transactions in the sample), so it isn't safe to reuse as any kind of identifier here. This keeps MLA's per-message trace ID space independent of both Mojoloop's `traceId` and the transaction-level `id` field.
- `msgType`'s apparent FSD/IID conflict (previously R-03) is resolved: the FSD's own field definition (§5.4) and every one of its worked sequence diagrams use only the literal strings `request` and `callback` — its third listed value, the Central Ledger notification type, is confirmed dead (US-MLA-01/02). That leaves a two-value field, and the IID's "POST/PUT" framing is naming that same two-way split after the HTTP method each leg used, not describing a different design — which lines up exactly with the classification signal US-MLA-02 already relies on. The remaining IID text still literally reads "POST/PUT" rather than "request/callback"; that's a wording fix owed to the IID, not an open design question for this envelope.
- **Event Envelope versioning is not addressed here — see R-23 below.**

**Todos**
1. Implement the envelope builder, including `msgType` derivation, the per-type `id`-scheme mapping, and the completeness check.
2. Write tests (Jest, 95% coverage target) covering all four event types, both `msgType` values, and the missing-header and missing-body rejection paths.
3. Flag the IID's stale "POST/PUT" wording for `msgType` to its owner, so the document matches the FSD's own `request`/`callback` convention.
4. Add Event Envelope versioning criteria once the versioning contract (IID §5.2) is agreed (R-23).

---

#### US-MLA-05 — Validate JWS Signatures on DFSP-Originated Events

**Description**
MLA must validate the `FSPIOP-Signature` header (RS256/384/512) on every DFSP-originated event before forwarding it to PPA. Events with a missing or invalid signature are rejected and an operations security alert is raised. No exemption applies — every event on this topic, including the transfer's fulfil/final-state leg, is DFSP-originated and signed; there is no genuinely switch-generated Central Ledger event on the audit topic to exempt.

**Acceptance Criteria**
- For every event type (QUOTE, FXQUOTE, TRANSFER — both prepare and fulfil legs, FXTRANSFER), MLA checks the `FSPIOP-Signature` header against the sending DFSP's registered public key. No event type is exempt.
- An event with a missing signature header is rejected: logged as a security event, alert raised, offset advanced (not retried — this is a permanent failure).
- An event with an invalid signature (key mismatch, tampered body) is rejected with the same behaviour.
- Public key lookup for each DFSP is configurable and does not require a service restart to add a new key.
- Unit tests cover: valid signature, missing header, signature mismatch — for each of the four event types, including the fulfil leg specifically.

**Method**
1. **Extract** — read the `FSPIOP-Signature` header from the event, before any decoding or field extraction changes the body.
2. **Look up** — resolve the sending DFSP's registered public key from configuration.
3. **Verify** — check the signature against the original, untouched payload.
4. **Reject on failure** — if the header is missing or verification fails, log as a security event, raise an alert, and advance the offset without retrying.
5. **Proceed on success** — a validated event moves on to envelope construction (US-MLA-04) and delivery.

**Assumptions**
- Whether the `FSPIOP-Signature` header survives the DFSP → Mojaloop switch → Kafka → audit topic chain is Open Item #3 in the FSD. If the header does not survive the base64 data-URI re-serialisation on transfer topics, JWS validation as specified cannot be implemented and an alternative (e.g. topic-level authentication) must be agreed with CCH before this story can be closed. This applies uniformly to the fulfil leg too, since it is not treated as a special case.
- DFSP public key storage and rotation follow the certificate policy in §10.1 of the FSD. Key distribution mechanism is owned by CCH / Mojoloop Partner.
- MLA must itself have read access to every registered DFSP's public key at verification time — either a local, kept-in-sync copy or a reachable lookup service. This is a hard dependency: MLA cannot validate a signature without holding, or being able to fetch, the corresponding public key at the moment it processes the event. How MLA obtains and keeps this set current (a pushed/synced local store vs. a live per-event lookup against Mojoloop's key registry) is not yet decided and needs to be settled with CCH / the Mojoloop Partner, since it also affects the availability story here — a lookup-service outage would otherwise start failing every event as "invalid signature" rather than as a distinguishable infrastructure fault.
- Where this story's security alert actually goes, and how, is not decided here — see US-MON-01 in `cch-crosscutting-user-stories.md` (R-37): the observability stack is confirmed, but alerting destination/routing is not.

**Todos**
1. Implement the signature-extraction and verification step, applied uniformly across all four event types with no exemptions.
2. Wire up the public-key lookup so new DFSP keys can be added without a restart.
3. Decide and implement how MLA sources DFSP public keys (synced local store vs. live lookup service) and how a key-source outage is distinguished from a genuine signature failure, so the two don't get logged/alerted identically.
4. Wire up the security-alert path for missing/invalid signatures.
5. Write tests (Jest, 95% coverage target) covering valid signature, missing header, signature mismatch, and an unreachable/missing public key, for each of the four event types including the fulfil leg specifically.
5. Confirm with the Mojoloop Partner / CCH that the signature header survives the full chain to the audit topic (Open Item #3) before this story is considered final.

---

### Epic 3 — MLA: Delivery to PPA & Offset Management

#### US-MLA-06 — Deliver Envelopes to PPA via Per-Action Endpoints

**Description**
MLA POSTs each constructed envelope to the appropriate PPA endpoint over mutual TLS. It must not advance the Kafka offset until PPA acknowledges receipt with HTTP 200. This offset-gated handoff is what makes the pipeline's durability guarantee real.

Per the FSD's own endpoint table (§5.x, confirmed in both the summary table and the sequence diagrams), PPA exposes exactly one endpoint per event type, and that single endpoint receives **both** legs — request and callback (and, for TRANSFER/FXTRANSFER, the fulfil/reject/abort/error variants too). The two legs are not routed to different endpoints; they are distinguished inside the envelope by `msgType`, not by URL or HTTP method. This is the FSD's stated design, not something introduced by these stories.

**Routing Table**

| `eventType` | PPA Endpoint | Method | Covers |
| --- | --- | --- | --- |
| QUOTE | `/QUOTES` | POST | Request, callback, and error variants |
| FXQUOTE | `/FXQUOTES` | POST | Request, callback, and error variants |
| TRANSFER | `/TRANSFERS` | POST | Prepare and fulfil/final-state (reject/abort/error variants too) |
| FXTRANSFER | `/FXTRANSFERS` | POST | Request, reserve callback, and commit (reject/abort/error variants too) |

The FSD's table also lists a fifth endpoint, `/TRANSFERS/NOTIFICATIONS`, for a deduplicated Central Ledger final-state notification. That endpoint does not apply here — there is no such event on the wire to route (see US-MLA-01/02 and `cch-notification-dedup-user-stories.md`); the fulfil leg is already covered by `/TRANSFERS` above.

**Acceptance Criteria**
- Each envelope is sent to the correct PPA endpoint based on `eventType`, per the Routing Table above. Both legs of a given event type share the same endpoint; PPA distinguishes them by the envelope's `msgType`.
- The MLA waits for HTTP 200 from PPA before committing the Kafka offset. It does not advance the offset on any other response.
- All MLA → PPA calls use mutual TLS. A TLS handshake failure (missing/unrecognised client certificate, expired cert, PPA's server cert not yet trusted mid-rollout, etc.) is treated as a 5xx-equivalent (transient) and fed into the same retry/circuit-breaker path as an HTTP 5xx (R-22). The alert raised on retry exhaustion or breaker trip retains the underlying failure reason (handshake failure vs. HTTP 5xx) even though both drive the same state machine, so a genuine certificate misconfiguration is still distinguishable from ordinary PPA unavailability once someone looks at the alert.
- MLA addresses PPA via a single stable service name / load balancer address, never individual replica addresses. This address is configurable.
- MLA does not wait for PPA to finish processing the event — only for PPA to confirm receipt with HTTP 200.
- MLA enforces a per-call timeout against PPA (configured independently from the retry/backoff budget); the call is treated as a timeout/5xx if the timeout is breached. **See R-31 below — the actual timeout value isn't agreed yet (FSD Open Item #1).**

**Method**
1. **Select endpoint** — resolve the target PPA endpoint from the envelope's `eventType`, per the Routing Table above. `msgType` (already set by US-MLA-04) is not part of endpoint selection — it travels in the envelope body for PPA to read.
2. **Send** — POST the envelope to PPA over mutual TLS, addressed via the stable load-balancer name.
3. **Wait** — block on PPA's response up to the configured per-call timeout.
4. **Commit on success** — advance the Kafka offset only after receiving HTTP 200.
5. **Hand off on failure** — any non-200 response, timeout, or TLS handshake failure is passed to the retry/circuit-breaker logic (US-MLA-07) instead of committing the offset.

**Assumptions**
- PPA's HTTP 200 means the envelope has been durably written to PPA's write-ahead store (the FSD §4.3 guarantee). MLA trusts this; it does not independently verify PPA's durability state.
- The PPA load balancer address and port are provided via environment configuration.
- Pairing request and callback onto one endpoint per event type, distinguished by `msgType`, is the FSD's own design (§5.x) — not a simplification introduced here. `msgType` is what PPA reads to tell the two legs apart on this shared endpoint (`request`/`callback`, resolved in US-MLA-04 — R-03).
- mTLS certificates for MLA (client cert/key) and for trusting PPA (CA cert) are provisioned externally and mounted at startup.

**Todos**
1. Implement the mTLS client configuration and the endpoint-selection logic.
2. Implement the offset-commit gate (commit only on PPA 200).
3. Implement and configure the per-call timeout, independent from the retry/backoff budget.
4. Write tests (Jest, 95% coverage target) covering: successful delivery + commit, non-200 handoff to retry logic, and TLS handshake failure handling, confirming the underlying failure reason is preserved in the resulting alert (R-22).
5. Confirm the actual timeout value with CCH (FSD Open Item #1 / R-31).

---

#### US-MLA-07 — Retry and Circuit-Break on PPA Failures

**Description**
When PPA returns a 5xx or times out, MLA retries with exponential backoff and jitter before escalating. When PPA returns a 4xx (invalid envelope), MLA logs and advances the offset without retrying. Retry exhaustion and the circuit breaker are two coordinated mechanisms, not one: exhausting an event's own retry budget parks that event and keeps periodically retrying it, and it is exactly this repeated failure that accumulates toward the breaker's trip threshold. Once the breaker trips on sustained consecutive failures, MLA stops attempting the paused event directly and instead pauses partition consumption entirely, re-probing PPA's health on a timer rather than continuing to hammer a known-down PPA.

**Acceptance Criteria**
- On PPA 5xx or timeout: retry up to 3 attempts with exponential backoff (base 1s / 2s / 4s) plus random jitter on each interval. The Kafka offset is not advanced while retries are in progress.
- Once an event's 3-attempt retry budget is exhausted, MLA raises an alert and **pauses the offset on that event** rather than advancing past it — this is still a transient-failure case (FSD §5.6), so the event is retried again once PPA recovers, not discarded. MLA continues periodically retrying this same paused event; each such failure counts toward the circuit breaker's consecutive-failure threshold below. Nothing is left undefined in between: the offset simply never advances past a failed transient event, the same principle as every other transient case in this story.
- On PPA 4xx: log the full envelope as an error, raise an operations alert, and advance the offset (permanent failure — retrying will not fix a malformed envelope).
- After N consecutive failures (N is configurable) — counting both an event's own exhausted retry attempts and repeated failures on the paused event afterward — the circuit breaker trips: MLA stops attempting the paused event directly and pauses consumption on the affected partition(s) entirely. It does not advance any further offsets.
- The circuit breaker re-probes PPA's health on a configurable timer interval. It resumes partition consumption once PPA is healthy again (a successful health probe), picking back up on the event that was paused.
- Jitter is genuinely random (not fixed), so concurrent MLA workers do not synchronize their retry storms.
- An unreadable Kafka message (malformed JSON, bad base64) is skipped: offset advanced, logged, alert raised — not retried.

**Method**
1. **Classify the failure** — on a non-200 response from US-MLA-06, distinguish 4xx (permanent) from 5xx/timeout (transient).
2. **Retry transient failures** — for 5xx/timeout, retry up to 3 times with exponential backoff plus jitter, without advancing the offset.
3. **Park on retry exhaustion** — once the 3 attempts are used up, alert and pause on this event rather than advancing past it; keep periodically retrying it in the background.
4. **Fail permanent failures immediately** — for 4xx, log, alert, and advance the offset without retrying.
5. **Track consecutive failures** — count both the exhausted-retry outcome and each subsequent failure on the paused event; once the configurable threshold N is reached, trip the circuit breaker.
6. **Pause on trip** — stop attempting the paused event directly; stop consuming from the affected partition(s) entirely; no further offsets are advanced.
7. **Re-probe and resume** — on a configurable interval, probe PPA's health; resume partition consumption, starting from the paused event, once a probe succeeds.

**Assumptions**
- The circuit breaker threshold (N failures) and re-probe interval are configurable without a restart.
- MLA's own consumer offset on the audit topic is the recovery mechanism for paused partitions — the 7-day retention on the audit topic is the buffer. No separate DLQ is needed on the MLA side.
- For 4xx and JWS-rejection cases, advancing the offset immediately is correct per the current design. This is Open Item #8 in the FSD and must be confirmed with CCH before implementation is finalised.
- **Timeout value itself is unconfirmed — FSD Open Item #1 — see R-31 below.**
- As with US-MLA-05, this story's alerts (4xx errors, circuit-breaker trips) have no confirmed destination yet — see US-MON-01 in `cch-crosscutting-user-stories.md` (R-37).

**Todos**
1. Implement the retry/backoff/jitter logic and the 4xx-vs-5xx classification.
2. Implement the retry-exhaustion park-and-continue behaviour for a single event, feeding into the circuit breaker's failure count.
3. Implement the circuit-breaker state machine (trip, pause, re-probe, resume-from-paused-event) with configurable threshold and interval.
4. Write tests (Jest, 95% coverage target) covering: retry/backoff/jitter timing, the retry-exhausted park-and-continue path, 4xx immediate-advance path, breaker trip/pause/resume cycle, and the unreadable-message skip path.
5. Confirm the offset-advance-on-permanent-failure policy with CCH (Open Item #8) and the retry/timeout budget values (Open Item #1 / R-31).

---

## Review Findings

| # | Finding | Sev | Status |
| --- | --- | --- | --- |
| R-02 | `NOTIFICATION` used as a 5th classification value in US-MLA-02, but FSD §5.4 defines `eventType` with exactly 4 values (QUOTE, FXQUOTE, TRANSFER, FXTRANSFER — confirmed on direct re-check), and US-MLA-04's `id`-scheme table only has 4 rows. Contradicts both the FSD and the PPA-side story (US-PPA-03, which validates against 5 values). | **Critical** | **Resolved** — Kafka evidence confirms there is no 5th event on the wire to classify. US-PPA-03 in `cch-ppa-user-stories.md` now validates against the same 4-value model. |
| R-03 | `msgType` is a 3-value field in the FSD (§5.4: request/callback/notification), a 2-value HTTP-method field in the IID (§5.2: POST/PUT) — unresolved (IID Open Item #22). US-MLA-04 builds the envelope on this field without flagging that its meaning is undecided. | **Critical** | **Resolved** — the FSD's 3rd value is dead (US-MLA-01/02); its remaining two values (`request`/`callback`, used consistently in the FSD's own sequence diagrams) are the same two-way split the IID names by HTTP method. US-MLA-04 now derives `msgType` from the same POST/PUT/PATCH signal US-MLA-02 classifies on. The IID's literal "POST/PUT" wording is a documentation fix owed to its owner, not an open design question. |
| R-08 | US-MLA-07's retries-exhausted-but-breaker-not-tripped intermediate state has no stated behaviour. FSD §5.6 says pause the offset (transient-failure case); advancing it (a plausible reading of the story as written) discards the event. | **High** | **Resolved** — per FSD §5.6, retry exhaustion pauses the offset on that event and keeps periodically retrying it, rather than advancing past it; those repeated failures are what accumulate toward the circuit breaker's own trip threshold. The two mechanisms are now stated as coordinated, not separately undefined. |
| R-18 | US-MLA-01 doesn't require a *dedicated* consumer group — only that the group ID be externally configured. IID §5.1: reusing a DRPP-internal consumer group name risks stealing partition assignments from a live payment-path handler. The one MLA misconfiguration capable of affecting live payments. | Low | Open |
| R-22 | US-MLA-06 classifies a TLS handshake failure as transient (5xx) and retries. Defensible (pausing the offset is correct for an expired/unrecognised cert) but the FSD only specifies PPA's side of certificate rejection (§6.7), not MLA's. Should be recorded as a deliberate decision with its own rationale. | Low | **Resolved** — recorded as a deliberate choice: a handshake failure can't be distinguished up-front as transient (a rollout blip, a not-yet-trusted cert) from a genuine misconfiguration, so it's folded into the existing 5xx/retry/circuit-breaker path rather than a bespoke one — the message is never silently dropped either way, and the alert retains the specific failure reason for diagnosis. |
| R-23 | Event Envelope versioning (IID §5.2: schema changes additive-only, breaking change = new endpoint path) isn't addressed by US-MLA-04 or any other story. | Low | Open |
| R-31 | FSD Open Item #1 (agree MLA→PPA / PPA→TMS timeout values) not carried as an assumption on US-MLA-06 or US-MLA-07, despite both stories specifying *that* a timeout/retry budget exists without confirming the actual value. | **Medium** | Open |
| R-06 | Mandatory FSPIOP header check (US-MLA-04) vs. the (formerly unresolved) notification-trigger decision. | *High* | **Closed** — see `cch-notification-dedup-user-stories.md`. Only one trigger exists (the fulfil callback), and it's DFSP-signed. US-MLA-05's JWS exemption is removed, not just re-scoped. |

---

## Actions

| # | Action | Owner | Status |
| --- | --- | --- | --- |
| 1 | Align US-PPA-03 (in `cch-ppa-user-stories.md`) to the 4-value `eventType` model (R-02) | Story author | Closed |
| 2 | Correct the IID's `msgType` wording ("POST/PUT") to match the FSD's own `request`/`callback` convention (R-03) | IID author | Open |
| 3 | Specify US-MLA-07's retries-exhausted behaviour (R-08) | Story author | Closed |
| 4 | Promote "dedicated consumer group" to an acceptance criterion on US-MLA-01 (R-18) | Story author | Open |
| 5 | Record the TLS-handshake-as-transient decision with its rationale on US-MLA-06 (R-22) | Story author | Closed |
| 6 | Add Event Envelope versioning criteria to US-MLA-04 (R-23) | Story author | Open |
| 7 | Add Open Item #1 as an assumption on US-MLA-06 and US-MLA-07 (R-31) | Story author | Open |

---

*End of Document*

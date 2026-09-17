# PPA — Headlines

## From cch-ppa-user-stories.md

### Epic 6 — PPA: Ingress API & Write-Ahead Persist

#### US-PPA-01 — Expose Per-Action Inbound Endpoints Over Mutual TLS

**Description**
PPA exposes four POST endpoints, one per event type, plus health check endpoints. All are served exclusively over mutual TLS — a connection without a recognised MLA client certificate is rejected at the TLS layer before any application logic runs.

#### US-PPA-02 — Write-Ahead Persist Before Acknowledging MLA

**Description**
Before returning HTTP 200 to MLA, PPA must verify that both ValKey and its own durable write-ahead store are reachable, then write the envelope to the write-ahead store. This is what keeps the event durable if PPA crashes between the ack and completing the processing pipeline.

### Epic 7 — PPA: Processing Pipeline

#### US-PPA-03 — Validate the Incoming Envelope

**Description**
After acknowledging MLA (step 2), PPA validates the envelope contents asynchronously. An invalid envelope is dead-lettered to the DLQ; it is not forwarded to TMS.

#### US-PPA-04 — Enforce Idempotency Before Translation

**Description**
Before translating any trigger event into a Tazama message, PPA checks whether it has already processed an event for that same `id` + `isoMessageType` pair (e.g. `transferId:pacs.002.001.12`, `quoteId:pain.001.001.11`). This is a single, generic mechanism applied uniformly to every trigger event — quote request, quote callback, transfer prepare, and transfer fulfil/final-state alike — not a rule specific to any one event type. A repeat event for an already-processed `id`+`isoMessageType` pair is a duplicate, full stop: there is no comparison of which value should "win" (e.g. a transfer's `COMMITTED` arriving after an already-processed `ABORTED` is simply a duplicate of an already-finalized pair, not a conflict to resolve). The check runs once, before translation, using PPA's durable write-ahead store rather than ValKey.

#### US-PPA-05 — Classify Each Event's Trigger and Caching Behaviour

**Description**
Every validated event is classified along two independent properties, not one exclusive label: whether it **triggers** a Tazama message (zero or one outbound message), and whether its data is **cached** into the correlation state for whichever later stage of the same transaction leg needs it — not any one specific message type. These are not mutually exclusive — a Quote request or callback both triggers its own Tazama message (pain.001/pain.013) *and* caches data a later stage depends on (e.g. payer identity, `Purp.Cd`, `ChrgBr`, and fees, which the pacs.008 stage reads). An event's cached data is retained until its transaction leg is fully ingested — i.e. until the terminal message for that leg has been sent — not cleared once the event's own trigger (if any) has fired, and not scoped to feeding only one particular downstream message type.

#### US-PPA-06 — Accumulate Cacheable Data into the Correlation Cache

**Description**
For every event that reaches this step — whether or not it also triggers its own Tazama message — PPA merges the event's cacheable data into the shared transaction-state entry in ValKey, keyed by the appropriate transaction/quote/conversion ID. A Quote request or callback triggering pain.001/pain.013 is cached here exactly like an FX Quote event that triggers nothing; being a trigger does not exempt an event from also being cached for the rest of its transaction leg. This must be an atomic read-modify-write because multiple PPA replicas may process related events concurrently.

#### US-PPA-07 — Discriminate Domestic vs. Cross-Border Transfers

**Description**
For TRANSFER **[and FXTRANSFER — see R-21 below]** trigger events, PPA must determine whether the payment is cross-border (in scope, Phase 1) or domestic (out of scope, Phase 1) before assembling a Tazama message. A transfer with no correlated FX-quote state and no FX linkage field (`determiningTransferId`) is domestic and must be discarded silently.

### Epic 8 — PPA: ISO 20022 Translation

#### US-PPA-08 — Translate Quote Request to pain.001.001.11

**Description**
When a Quote request (`POST /quotes`) arrives, PPA assembles a `pain.001.001.11` message for Tazama. The message is built from the quote request payload plus already-cached FX-quote enrichment (if present). This is one of four messages sent per cross-border payment. Triggering pain.001 does not exempt this event from also being cached (US-PPA-06) — its payer identity, `transactionType`, and `note` are needed later by the pacs.008 (US-PPA-10), exactly as the Quote callback's fees data is cached for the same purpose (US-PPA-09).

#### US-PPA-09 — Translate Quote Callback to pain.013.001.09

**Description**
When a Quote callback (`PUT /quotes`) arrives as a trigger, PPA assembles a `pain.013.001.09` message. This is the second of the four per-payment Tazama messages. It fires independently of pain.001 — PPA does not wait for any pairing.

#### US-PPA-10 — Translate Transfer Prepare to pacs.008.001.10

**Description**
When a Transfer prepare (`POST /transfers`) arrives as a trigger, PPA assembles a `pacs.008.001.10` message from the prepare event plus cached enrichment from up to five prior messages (FX quote request/callback, quote request/callback, party data). This is the third per-payment Tazama message. The prepare event alone triggers the pacs.008 — PPA does not wait for the fulfil.

#### US-PPA-11 — Translate Final-State Event to pacs.002.001.12

**Description**
When the fulfil callback (`PUT /transfers`) arrives as a trigger, PPA assembles a `pacs.002.001.12` message. This is the fourth per-payment Tazama message. For error callbacks (any resource), PPA also emits pacs.002 with `TxSts: RJCT`.

### Epic 9 — PPA: Schema Validation & TMS Dispatch

#### US-PPA-12 — Validate Assembled Message Against Pinned Local Schema Before Send

**Description**
Before sending any message to TMS, PPA validates the assembled message against a pinned local copy of Tazama's ajv schema for that message type. This catches field-level drift from the pinned `tms-service` version before `removeAdditional: 'all'` on TMS silently strips the offending fields and returns a false HTTP 200.

#### US-PPA-13 — Send Validated Messages to Tazama TMS

**Description**
PPA dispatches each validated message to the correct version-pinned Tazama TMS endpoint using HTTPS with mutual TLS plus a Keycloak-issued bearer token. Delivery is at-least-once; retries reuse the same pinned message, never a rebuild.

### Epic 10 — PPA: Error Recovery, DLQ & Missing Correlations

#### US-PPA-15 — Dead-Letter Queue: Write, Alert, and Support Replay

**Description**
PPA's DLQ is the same store as its write-ahead record (one store, two write paths). Every DLQ write raises an operations alert. Replay is manual and operator-triggered, re-injecting an entry from the point it failed. Every replay is audit-logged.

#### US-PPA-16 — Park Correlation State Before ValKey TTL Expiry

**Description**
When a leg's ValKey correlation state is at risk of expiring before its expected counterpart event has arrived (e.g. the fulfil/final-state callback that never came), PPA writes the accumulated state to its DLQ/write-ahead store before the TTL lapses. If the late event eventually arrives — even days later — PPA retrieves the parked state and completes correlation from the durable store rather than treating the arrival as unresolvable.

#### US-PPA-17 — Handle Out-of-Order Arrival (Fulfil Before Prepare)

**Description**
Because the transfer prepare and fulfil are on different Kafka topics and processed by PPA replicas asynchronously, the fulfil's pacs.002 trigger may arrive at PPA before the prepare's pacs.008 trigger. PPA must park the fulfil within a short bounded window and retry rather than discarding it. **⚠️ The "different Kafka topics" reasoning here describes the pre-audit-topic architecture. See R-29 below — the underlying race is still real, but for a different reason.**

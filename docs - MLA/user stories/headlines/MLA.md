# MLA — Headlines

## From cch-mla-user-stories.md

### Epic 1 — MLA: Kafka Subscription & Audit Topic Ingestion

#### US-MLA-01 — Subscribe to the Mojaloop Audit Topic

**Description**
The MLA must consume all payment events (FX quote, quote, FX transfer, transfer — including the transfer's fulfil/final-state leg) from a single, dedicated Mojaloop audit topic — not from Mojaloop's per-action primary topics directly. This is the sole Kafka ingress point for the pipeline. There are four event types on this topic: the final-state/fulfil event is not a separate category — it's the same `PUT /transfers` fulfil callback, DFSP-signed like any other TRANSFER event (`cch-notification-dedup-user-stories.md` has the supporting evidence).

#### US-MLA-02 — Distinguish Event Types Within the Audit Topic Stream

**Description**
Because the audit topic carries all event types in a single unified stream, the MLA must classify each consumed message by event type (QUOTE, FXQUOTE, TRANSFER, FXTRANSFER). Confirmed against `DRPP_Kafka_E2E_Pack` (5 corridor captures from `topic-event-audit`, 20 records each, 100 records total, zero exceptions): every record carries a `metadata.trace.tags.operation` value that maps directly to one of the four types, corroborated by the record's `Content-Type`/`Accept` header (the ISO 20022 resource name — `quotes`, `fxQuotes`, `transfers`, `fxTransfers`) and its `FSPIOP-HTTP-Method` header (POST for the request leg, PUT or PATCH for the callback leg). The transfer's prepare and fulfil/final-state legs are both TRANSFER — there is no separate notification category (see US-MLA-01). Where each classified event is delivered to on PPA is covered separately (US-MLA-06); this story is only about resolving the correct eventType.

#### US-MLA-03 — Decode Base64-Encoded Transfer Payloads

**Description**
Transfer and FX-transfer topic payloads arrive inside the audit topic as base64-encoded `data:` URIs. The MLA must decode these before field extraction or envelope construction. Quote payloads arrive as plain JSON and do not need this step.

### Epic 2 — MLA: Envelope Construction & JWS Validation

#### US-MLA-04 — Construct a Standard Event Envelope

**Description**
For every successfully classified and decoded event, MLA wraps the message in a typed Event Envelope before sending it to PPA. The envelope is the contract between MLA and PPA; PPA never reads raw Kafka payloads.

The envelope carries two distinct identifiers that must not be confused with each other. `id` is the business identifier for the event's own leg (see the per-type scheme below) — it is what PPA uses, together with the fields already present in each event's decoded body, to correlate an event with the other legs of the same transaction (e.g. matching a Transfer's `PmtId.TxId` against the originating Quote's `PmtId.EndToEndId`; confirmed via `DRPP_Kafka_E2E_Pack`, both equal to `transferId`/`transactionId` for the sampled transaction). `correlationId` is a different, narrower thing: a fresh UUID minted by MLA for this one Kafka record, used purely as a diagnostic trace handle so ops can pull every log line, audit entry, and DLQ entry tied to the processing of that specific message. It is intentionally per-event, not per-transaction, and it plays no part in linking a Quote to its Transfer — that correlation is `id`-driven and is PPA's responsibility, not MLA's.

#### US-MLA-05 — Validate JWS Signatures on DFSP-Originated Events

**Description**
MLA must validate the `FSPIOP-Signature` header (RS256/384/512) on every DFSP-originated event before forwarding it to PPA. Events with a missing or invalid signature are rejected and an operations security alert is raised. No exemption applies — every event on this topic, including the transfer's fulfil/final-state leg, is DFSP-originated and signed; there is no genuinely switch-generated Central Ledger event on the audit topic to exempt.

### Epic 3 — MLA: Delivery to PPA & Offset Management

#### US-MLA-06 — Deliver Envelopes to PPA via Per-Action Endpoints

**Description**
MLA POSTs each constructed envelope to the appropriate PPA endpoint over mutual TLS. It must not advance the Kafka offset until PPA acknowledges receipt with HTTP 200. This offset-gated handoff is what makes the pipeline's durability guarantee real.

Per the FSD's own endpoint table (§5.x, confirmed in both the summary table and the sequence diagrams), PPA exposes exactly one endpoint per event type, and that single endpoint receives **both** legs — request and callback (and, for TRANSFER/FXTRANSFER, the fulfil/reject/abort/error variants too). The two legs are not routed to different endpoints; they are distinguished inside the envelope by `msgType`, not by URL or HTTP method. This is the FSD's stated design, not something introduced by these stories.

#### US-MLA-07 — Retry and Circuit-Break on PPA Failures

**Description**
When PPA returns a 5xx or times out, MLA retries with exponential backoff and jitter before escalating. When PPA returns a 4xx (invalid envelope), MLA logs and advances the offset without retrying. Retry exhaustion and the circuit breaker are two coordinated mechanisms, not one: exhausting an event's own retry budget parks that event and keeps periodically retrying it, and it is exactly this repeated failure that accumulates toward the breaker's trip threshold. Once the breaker trips on sustained consecutive failures, MLA stops attempting the paused event directly and instead pauses partition consumption entirely, re-probing PPA's health on a timer rather than continuing to hammer a known-down PPA.

---

## From cch-pii-user-stories.md

#### US-PII-01 — Classify and Tokenize Party Identity Fields Within MLA

**Description**
Party identity fields are tokenized deterministically as part of MLA's own processing, before the event is packaged into an envelope and sent to PPA. This runs inside MLA itself — not a separately deployed pre-MLA component. PPA and everything downstream never see raw PII, the same guarantee the design has always intended; only which service performs the work has changed.

#### US-PII-02 — Tokenization Construction and Secret Handling

**Description**
Tokenization is computed locally, inside MLA's own process, using a secret MLA holds — not by calling out to a separate vault or crypto service per event. This keeps the design to "one already-deployed service does a bit more work," rather than introducing a new network-reachable service into the Mojoloop environment.

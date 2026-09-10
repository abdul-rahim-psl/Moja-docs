<!-- SPDX-License-Identifier: Apache-2.0 -->

# Core Knowledge — CCH FRMS Message Ingestion <!-- omit in toc -->

**Scope of this document:** a consolidated, implementation-facing synthesis of the five user-story documents in `docs - MLA/user stories/` — `cch-mla-user-stories.md`, `cch-ppa-user-stories.md`, `cch-pii-user-stories.md`, `cch-notification-dedup-user-stories.md`, and `cch-crosscutting-user-stories.md` (added [2026-09-07]; cross-referenced in as of this revision). It carries no material from any other source. Where the five documents cite an external source (the FSD, the IID, the IDD, the `DRPP_Kafka_E2E_Pack` captures), that citation is reproduced as a citation, not treated as knowledge this document independently holds.

**Owner / provenance:** CCH FRMS | Paysys Labs. Source stories `CCH_UserStories_MessageIngestion_v1.0.md`; review consolidated from `CCH_UserStories_MessageIngestion_ConsolidatedReview_v1.0.md`. Story documents dated 18 August 2026.

**Section-reference convention.** A bare `§N` in *this* document's own prose (`§12`, `§13.1`) is a section of this document. Where a section number is quoted **from** a source — `§6.4.3`, `§10.3`, `§9.3` and similar — it belongs to the **FSD** and is reproduced as the stories cite it. Where an IID or IDD section is meant, it is named as such. This document never renumbers a source's sections.

**⚠️ This document is deliberately capture-blind.** It synthesizes the five story documents and nothing else, so where a story states something the `DRPP_Kafka_E2E_Pack` captures contradict, **this document reproduces the story, not the evidence.** [`cross-reference.md`](cross-reference.md) §2 is the register of every such point (F1–F14), and [`plan.md`](../plan.md) §3.1 carries the decisions taken on them. **Read that register before implementing from this document.** The claims most affected are §2.2 (which records to ingest), §2.5 (decoding), §7.1/§7.3 (payee name, date of birth), §7.5 (the `TxSts` vocabulary), and §12.1's premise that party lookup never reaches Kafka.

- [1. What is being built](#1-what-is-being-built)
- [2. The event model — what the audit topic actually carries](#2-the-event-model--what-the-audit-topic-actually-carries)
- [3. MLA — the Mojaloop Adaptor](#3-mla--the-mojaloop-adaptor)
- [4. PII tokenization — inside MLA](#4-pii-tokenization--inside-mla)
- [5. The Event Envelope — the contract between MLA and PPA](#5-the-event-envelope--the-contract-between-mla-and-ppa)
- [6. PPA — the Payment Platform Adaptor](#6-ppa--the-payment-platform-adaptor)
- [7. ISO 20022 translation reference](#7-iso-20022-translation-reference)
- [8. Correlation and state model](#8-correlation-and-state-model)
- [9. Durability, failure and back-pressure — end to end](#9-durability-failure-and-back-pressure--end-to-end)
- [10. Security model](#10-security-model)
- [11. Non-functional requirements](#11-non-functional-requirements)
- [12. Decided, removed, and superseded](#12-decided-removed-and-superseded)
- [13. Open register — what is genuinely undecided](#13-open-register--what-is-genuinely-undecided)
- [14. Known gaps in the document set itself](#14-known-gaps-in-the-document-set-itself)
- [15. Story index](#15-story-index)

---

## 1. What is being built

Two services carry payment events out of a Mojaloop-based switch (COMESA's DRPP) and into Tazama's fraud-detection pipeline, translating Mojaloop's FSPIOP event vocabulary into ISO 20022 messages on the way.

```
Mojaloop audit topic (Kafka)
        │
        ▼
  ┌───────────┐   Event Envelope over HTTPS + mTLS   ┌───────────┐   ISO 20022 over HTTPS + mTLS + bearer
  │    MLA    │ ──────────────────────────────────▶  │    PPA    │ ─────────────────────────────────────▶ Tazama TMS
  └───────────┘         (4 per-action endpoints)     └───────────┘
   Mojaloop boundary                                  Tazama boundary
   · consume `start` records                          · write-ahead persist, then ack
   · classify event type                              · idempotency, classify, cache
   · base64-decode transfer bodies                    · correlate in ValKey
   · validate JWS                                     · translate to ISO 20022
   · tokenize PII                                     · schema-validate, dispatch
   · build envelope, POST to PPA                      · DLQ, park/retrieve, replay
   · commit offset only on PPA 200
```

**The split's rationale, as the stories state it.** MLA sits inside the Mojaloop network boundary and holds no Tazama-scoped credential. PPA sits inside the Tazama boundary and never reads raw Kafka payloads — it only ever sees Event Envelopes. Each boundary crossing is mutually authenticated.

**Phase 1 scope is cross-border P2P only.** Domestic P2P transfers are deliberately excluded and are *not* an error condition — they are silently discarded with a counter metric (US-PPA-07). Party discovery / ALS records are out of scope and explicitly skipped (US-MLA-02, FSD §11 Phase 1 Exclusions).

**The unit of work.** One cross-border payment produces exactly **four** Tazama messages:

| # | ISO message | Triggered by |
| --- | --- | --- |
| 1 | `pain.001.001.11` | Quote request (`POST /quotes`) |
| 2 | `pain.013.001.09` | Quote callback (`PUT /quotes`) |
| 3 | `pacs.008.001.10` | Transfer prepare (`POST /transfers`) |
| 4 | `pacs.002.001.12` | Transfer fulfil / final-state (`PUT /transfers`), or any error callback (as `TxSts: RJCT`) |

The FX legs (FXQUOTE, FXTRANSFER) produce **no** message of their own. They are cached and fold into the four above as enrichment.

**Stack.** Fastify + TypeScript on Node.js; KafkaJS for ingestion; ValKey for correlation state; a durable write-ahead store that doubles as the DLQ; Jest for tests at a 95% coverage standard.

---

## 2. The event model — what the audit topic actually carries

This is the single most load-bearing section: several design decisions across both services fall out of it, and it is the section that overrides the FSD where the two disagree.

### 2.1 One topic, one consumer group

MLA consumes **one dedicated Mojaloop audit topic** (`topic-event-audit`) under **exactly one consumer group**. It does **not** subscribe to the per-action primary topics (`topic-quotes-post`, `topic-transfer-prepare`, …). This is the sole Kafka ingress point for the entire pipeline (US-MLA-01).

### 2.2 Every logical event is written twice — `start` and `egress`

Each logical event appears on the audit topic **twice**, carrying identical business content:

- `metadata.event.action: start` — captured when the switch **receives** the event.
- `metadata.event.action: egress` — captured when the switch **relays** it onward.

> **⚠️ Contradicted by capture evidence — do not implement from this subsection alone.** Both claims below (that every event is double-written, and that only `start` records are ingested) fail against the captures: three operations exist **only** as `egress` — `commitTransfer`, `reserveFxTransfer`, `notifyFxTransfer` — and `prepareTransfer`'s `egress` half carries a *different body* when the transfer is rejected. Applied literally, this rule silently drops every transfer rejection. See [`cross-reference.md`](cross-reference.md) §2 F1–F3 and §3.1, and [`plan.md`](../plan.md) §3.1 decision **D1**.

**MLA ingests only `start` records.** `egress` records are recognized and discarded as a *structural skip* — the offset advances normally and nothing is logged as an error. This filter is the first step after decoding a record off the topic, ahead of classification, and it is the only thing preventing every event from being processed twice.

Verified against `DRPP_Kafka_E2E_Pack`: the `start` record for every event type MLA routes on already carries the full payload and headers needed for classification and envelope construction, with zero exceptions across five corridors. **MLA never needs to wait for, or merge in anything from, the matching `egress` record.**

### 2.3 Four event types — there is no fifth

`eventType` has exactly four values: **QUOTE, FXQUOTE, TRANSFER, FXTRANSFER**. This matches the FSD's four-value enum and is confirmed by Kafka evidence, not merely assumed.

The transfer's prepare leg and its fulfil/final-state leg are **both TRANSFER**. There is no separate `NOTIFICATION` category — see §12.1.

### 2.4 The classification table (US-MLA-02)

| `operation` | HTTP method | Resource path | Leg | Classifies as |
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
| *(no matching row)* | — | — | — | **Unclassifiable — skipped** |

**TRANSFER has two legs; FXTRANSFER has three** — the extra `PATCH` commit leg on FXTRANSFER has no domestic-TRANSFER equivalent. Miss it and the FXTRANSFER lifecycle is incomplete.

**Which signal is authoritative.** `metadata.trace.tags.operation` is present on every captured record, but `operation` naming is **not symmetric** between a step's `start` and `egress` capture — one corridor's `start: fulfilFxTransfer` pairs with `egress: reserveFxTransfer` for the same logical step. Therefore: **key primarily on HTTP method (`FSPIOP-HTTP-Method`) plus resource name (`Content-Type` / `FSPIOP-URI`), using `operation` as a secondary, confirmatory signal** — not as the sole discriminator.

Unclassifiable events are logged, the offset is advanced, and nothing is forwarded.

### 2.5 Payload encoding differs by event type

- **TRANSFER / FXTRANSFER** bodies arrive wrapped in a base64-encoded `data:` URI and must be decoded before any field extraction (US-MLA-03).
- **QUOTE / FXQUOTE** bodies arrive as plain JSON — no decode step.
- A body that claims to be a TRANSFER type but fails base64 decoding, or whose decoded output is not valid JSON, is **unreadable**: logged, offset advanced, not forwarded.
- **Decoding is MLA's responsibility only.** PPA never decodes; it receives already-decoded JSON bodies (US-PPA-03 assumption).

### 2.6 Identifier facts that must not be conflated

| Identifier | Scope | Who mints it | Used for |
| --- | --- | --- | --- |
| Mojaloop `traceId` (Kafka message key) | **Not** transaction-scoped — one `traceId` covered two unrelated transactions in the capture | Mojaloop | Nothing. Explicitly unsafe to reuse as an identifier here. |
| Envelope `id` | Per transaction **leg** | Read off the event, never generated | **Transaction correlation** — PPA's job |
| Envelope `correlationId` | Per **Kafka record** | MLA, fresh UUID per event | Diagnostic trace handle only — logs, audit, DLQ, the outbound TMS call for that one event |
| `GrpHdr.MsgId` | Per ISO message | PPA, ULID, **pinned at first assembly** | ISO message identity; reused verbatim on every retry |

`correlationId` plays **no** part in linking a Quote to its Transfer. That correlation is `id`-driven and is PPA's responsibility.

---

## 3. MLA — the Mojaloop Adaptor

MLA's job is transport-boundary work only: consume, filter, classify, decode, authenticate, protect, envelope, deliver, and manage the offset. It deliberately performs no correlation, no enrichment, and no translation.

### 3.1 Ingestion (US-MLA-01)

- One consumer group, one topic, external configuration for group ID / brokers / topic name.
- **On startup, resume from the last committed offset** — never reset to beginning or end.
- Broker outage: rely on the Kafka client's built-in reconnect/backoff. The offset does **not** advance while disconnected, so nothing produced during the outage is missed.
- Restart without data loss is an acceptance criterion, not an aspiration.

### 3.2 Processing order — a hard requirement

The order below is not stylistic. Two steps are ordering-critical and one of them is enforceable by test:

```
1. consume ──▶ 2. filter start/egress ──▶ 3. decode (transfer bodies) ──▶ 4. classify
                                                                              │
   ┌──────────────────────────────────────────────────────────────────────────┘
   ▼
5. VALIDATE JWS SIGNATURE  ──── against the payload exactly as received ────┐
   ▼                                                                        │
6. TOKENIZE PII  ◀── must run strictly after step 5 ─────────────────────────┘
   ▼
7. build envelope ──▶ 8. POST to PPA ──▶ 9. commit offset only on HTTP 200
```

**Why 5 must precede 6:** the DFSP signed the event as originally sent. Validating a signature against an already-tokenized payload fails every time. US-PII-01 requires a **test that fails if tokenization is moved ahead of validation**, so the ordering is enforced automatically rather than by convention.

*(Note: US-PII-01's own Method lists classify before validate-signature; US-MLA-02/03 place decode and classify ahead of envelope construction. The invariant that both documents assert without ambiguity is **validate-then-tokenize**, and that decode precedes any field extraction. The exact placement of classify relative to signature validation is not decided by either document — see §14.)*

### 3.3 JWS validation (US-MLA-05)

- Validate `FSPIOP-Signature` (RS256/384/512) against the sending DFSP's registered public key, on **every** event type including the fulfil leg. **No exemption applies** — there is no genuinely switch-generated event on this topic to exempt.
- Extract the header **before** any decoding or field extraction changes the body; verify against the original, untouched payload.
- Missing header or verification failure → log as a **security event**, raise an alert, **advance the offset without retrying** (permanent failure).
- Public-key lookup is configurable; adding a new DFSP key must not require a restart.
- **Hard dependency:** MLA must hold, or be able to fetch, every registered DFSP's public key at verification time. A key-source outage must be distinguishable from a genuine signature failure — otherwise an outage silently manifests as "every event has an invalid signature."

### 3.4 Delivery to PPA (US-MLA-06)

**Routing table** — one endpoint per event type, both legs share it, distinguished inside the envelope by `msgType`, never by URL or method:

| `eventType` | PPA endpoint | Method | Covers |
| --- | --- | --- | --- |
| QUOTE | `/QUOTES` | POST | Request, callback, error variants |
| FXQUOTE | `/FXQUOTES` | POST | Request, callback, error variants |
| TRANSFER | `/TRANSFERS` | POST | Prepare and fulfil/final-state (reject/abort/error too) |
| FXTRANSFER | `/FXTRANSFERS` | POST | Request, reserve callback, commit (reject/abort/error too) |

The FSD's fifth endpoint, `/TRANSFERS/NOTIFICATIONS`, **does not apply** — there is no such event on the wire (§12.1).

- All calls over **mutual TLS**, addressed via a single stable service name / load-balancer address — never individual replica addresses.
- **Commit the Kafka offset only on HTTP 200.** No other response advances it. This offset-gated handoff is what makes the durability guarantee real.
- MLA waits for *receipt*, not for PPA to finish processing.
- A per-call timeout is enforced, configured **independently** from the retry/backoff budget. The value itself is unagreed (FSD Open Item #1 / R-31).
- **A TLS handshake failure is treated as transient (5xx-equivalent)** and fed into the same retry/circuit-breaker path. Deliberate: a handshake failure can't be distinguished up front as a rollout blip from a genuine misconfiguration, and the message is never silently dropped either way. The resulting alert **retains the underlying reason** so the two remain diagnosable apart.

### 3.5 Retry and circuit breaking (US-MLA-07)

Two coordinated mechanisms, not one:

| Condition | Behaviour |
| --- | --- |
| PPA 5xx or timeout | Retry up to **3 attempts**, exponential backoff **1s / 2s / 4s** plus **genuinely random jitter**. Offset does not advance. |
| Retry budget exhausted | Alert, and **pause the offset on that event** — do not advance past it. Still a transient case (FSD §5.6). Keep periodically retrying the same paused event. |
| PPA 4xx | Log the full envelope as an error, alert, **advance the offset**. Permanent — retrying will not fix a malformed envelope. |
| N consecutive failures (N configurable) | **Circuit breaker trips.** Stop attempting the paused event directly; pause consumption on the affected partition(s) entirely; advance no further offsets. |
| Breaker tripped | Re-probe PPA health on a configurable interval; resume partition consumption from the paused event once a probe succeeds. |
| Unreadable Kafka message (malformed JSON / bad base64) | Skip: advance offset, log, alert. Not retried. |

Jitter must be genuinely random so concurrent MLA workers do not synchronize their retry storms.

**No DLQ exists on the MLA side.** The consumer offset plus the audit topic's 7-day retention *is* the recovery mechanism for paused partitions.

---

## 4. PII tokenization — inside MLA

Tokenization is **part of MLA's own processing pipeline, not a separately deployed component** — "one already-deployed service does a bit more work," rather than a new network-reachable service inside the Mojaloop environment. The guarantee is unchanged from the original design: PPA and everything downstream never see raw PII. Only which service performs the work changed.

### 4.1 Fields to tokenize

| Field | Source message | Location | Tokenize? | Why |
| --- | --- | --- | --- | --- |
| Payer MSISDN | Quote request | `payer.partyIdInfo.partyIdentifier` | **Yes** | Plain JSON body, no ILP packet |
| Payee MSISDN | Quote request | `payee.partyIdInfo.partyIdentifier` | **Yes** | |
| Payer legal name | Quote request | `personalInfo.complexName` | **Yes** | |
| Payer MSISDN | FXQuote request/callback | equivalent `partyIdInfo` | **Yes** | Where present |
| Payee MSISDN | FXQuote request/callback | equivalent `partyIdInfo` | **Yes** | Where present |
| Payer MSISDN | Transfer prepare (decoded ILP) | inside the ILP packet | **No — exempt** | Cryptographically bound into `condition`; rewriting breaks the transfer |
| Payee MSISDN | Transfer prepare (decoded ILP) | inside the ILP packet | **No — exempt** | Same |
| Payer display name | Transfer prepare (decoded ILP) | inside the ILP packet | **No — exempt** | Same |
| Transaction amount (all stages) | Quote, FXQuote, Transfer, FXTransfer | `amount`, `IntrBkSttlmAmt`, … | **No** | Must stay clear for Tazama's threshold/velocity rules |

The ILP-exempt fields reach PPA and TMS **in cleartext**. What protects them is PPA's own audit-log masking (US-AUD-01, §10.3's rules) — not this story.

### 4.2 Token construction (US-PII-02)

- **Keyed hashing** combining the real value with a secret MLA holds. A plain unkeyed hash is explicitly unacceptable — the MSISDN space is small enough to enumerate and match.
- **Deterministic:** same input ⇒ same token for the life of the current key, so correlation still works without ever reversing a token.
- **Every token carries a recognizable prefix**, so logging, storage, and tooling can tell a token from a real value at a glance.
- The secret is **loaded once at startup** from a securely mounted location (a Kubernetes Secret or equivalent) — not fetched per event, not requested from a live signing service per event.
- **Readiness reflects secret-load success.** If the secret didn't load, the service must not report ready rather than silently running unprotected. (Instance-local readiness scoping, consistent with US-MON-02.)

### 4.3 Consequences to hold in mind

- **The forensic audit topic's own persisted record predates tokenization** — it captures the raw event. That is a property of the topic, not something this design changes, but whoever owns that forensic record needs to know.
- **Rotating the secret changes every token produced afterward for the same input.** Anything already correlated under the old secret — in-flight cached state, parked entries awaiting a late event — will no longer match. Rotation strategy (version old and new, or drain in-flight correlation first) is **undecided**.
- Tokenization overhead counts against MLA's ≤200 ms p95 ack-latency budget. Expected negligible; must be **confirmed under load**, not assumed.
- A **tokenization-failure-rate metric and alert** is required, separate from PPA's degraded-message-rate metric — if the fail-mode ends up being pass-through, this is the *only* signal that PII is reaching PPA unprotected.

---

## 5. The Event Envelope — the contract between MLA and PPA

PPA never reads raw Kafka payloads. The envelope is the entire interface.

| Field | Source | Rules |
| --- | --- | --- |
| `msgType` | Derived from the leg's HTTP method | Exactly two values: **`request`** (POST) or **`callback`** (PUT/PATCH). No third value. Reject/abort/error variants are **payload states inside** a `request` or `callback` envelope, not separate `msgType` values. |
| `eventType` | Classification (US-MLA-02) | QUOTE \| FXQUOTE \| TRANSFER \| FXTRANSFER |
| `id` | Read straight off the event — never generated | QUOTE → `quoteId`; FXQUOTE → `conversionRequestId`; TRANSFER → `transferId` (**both** prepare and fulfil legs); FXTRANSFER → `commitRequestId` |
| `correlationId` | MLA-generated UUID, **per event** | Diagnostic trace handle. Propagated end-to-end through PPA, ValKey, audit logs, DLQ, and the outbound TMS call for that event. Not shared across a transaction's legs. |
| `fspiop-source` | Kafka headers (or recoverable from body) | **Mandatory.** Missing ⇒ reject: log, advance offset, do not forward. |
| `fspiop-destination` | Kafka headers (or recoverable from body) | **Mandatory.** Same. |
| `body` | Decoded JSON | Already base64-decoded by MLA and PII-tokenized. |
| `timestamp` | MLA | ISO 8601, the moment MLA consumed the event from Kafka. |

Missing `msgType`, `eventType`, or `id` fails envelope construction: log, advance offset, do not forward.

**`id` does not identify an envelope on its own — `id` + `msgType` does.** The table above already implies this (TRANSFER carries `transferId` on *both* the prepare and the fulfil leg), but it is worth stating flatly because the naive reading is a silent data-loss bug: one business object legitimately produces two envelopes sharing one `id`, a `request` and its `callback`, and any component treating `id` as the identity will read the second as a duplicate of the first. This is precisely why §6.4's idempotency key is the compound **`{id}:{isoMessageType}`** and not `id` alone — `isoMessageType` is what separates the two legs, since it is derived from `eventType` + `msgType`. **`correlationId` is not an alternative key**: it is minted per event processed (see its row above), so the same envelope re-delivered after a crash carries a different one, and a genuinely duplicated record is invisible to it. Measured on the 500-record export, the four event types yield 116 envelopes over only 75 distinct `id`s — deduplicating on `id` would discard 41 legitimate callbacks, with no error raised anywhere (`plan.md` §10, Phase 7 item #4, has the run).

**Correlation happens on `id` plus fields already inside each event's decoded body** — for example matching a Transfer's `PmtId.TxId` against the originating Quote's `PmtId.EndToEndId` (confirmed in `DRPP_Kafka_E2E_Pack`, both equal to `transferId`/`transactionId` for the sampled transaction).

**Envelope versioning is not specified** (IID §5.2: schema changes additive-only, breaking change = new endpoint path). Open — R-23.

---

## 6. PPA — the Payment Platform Adaptor

### 6.1 The nine-step pipeline

The stories reference pipeline step numbers directly (step 1 reachability, step 2 ack, step 4 idempotency, step 9 terminal). Reconstructed in full:

| Step | What happens | Story |
| --- | --- | --- |
| **1** | **Reachability gate.** Verify ValKey *and* the write-ahead store are reachable, and that the PPA→TMS circuit breaker is closed. Any of the three failing ⇒ **HTTP 503**, nothing persisted, nothing acknowledged. | US-PPA-02, US-PPA-13 |
| **2** | **Write-ahead persist, then ack.** Write the envelope to the durable store atomically; return **HTTP 200 only after a durable acknowledge (fsync-class, not an in-memory write)**. Processing continues asynchronously after the ack. | US-PPA-02 |
| **3** | **Structural validation.** `msgType` ∈ {request, callback}; `eventType` recognized; `id` present and non-empty; `fspiop-source` present and non-empty; `body` non-null. Failure ⇒ DLQ + masked log of the specific failed check; no TMS message. | US-PPA-03 |
| **4** | **Idempotency.** Atomic check-and-set on `{id}:{isoMessageType}` in the **durable store**. | US-PPA-04 |
| **5** | **Classify** trigger-status and cache-status as **two independent properties**. | US-PPA-05 |
| **6** | **Accumulate** the event's cacheable data into ValKey via an atomic read-modify-write — for **every** event, trigger or not. | US-PPA-06 |
| **7** | **Domestic vs. cross-border discriminator** for TRANSFER trigger events. | US-PPA-07 |
| **8** | **Translate** to the ISO message, then **validate against the pinned local schema** before any send. | US-PPA-08/09/10/11, US-PPA-12 |
| **9** | **Dispatch to TMS.** On success: log, update the write-ahead record, and clear ValKey state **only once the terminal message for the transaction has been sent**. | US-PPA-13 |

Around this sit the recovery mechanisms: the DLQ (US-PPA-15), pre-expiry parking and late retrieval (US-PPA-16), and the out-of-order hold-and-retry (US-PPA-17).

### 6.2 Ingress (US-PPA-01)

- Four POST endpoints — `/QUOTES`, `/FXQUOTES`, `/TRANSFERS`, `/FXTRANSFERS` — each receiving **both** legs of its type, distinguished by `msgType`.
- `/health/live` (GET) — 200 if the process is responsive.
- `/health/ready` (GET) — **instance-local conditions only**: process up, config loaded, write-ahead store reachable and writable. It **does not** check ValKey or the TMS token chain. This scoping is deliberate: a shared downstream dependency must not pull healthy replicas out of load-balancer rotation.
- mTLS required on all POST endpoints. A connection without a recognized MLA client certificate is rejected **at the TLS layer with a TLS alert — not an HTTP 401**. The allow-list contains exactly one entry: MLA's certificate or its CA.
- TLS 1.2+; TLS 1.0/1.1 disabled.
- **PPA is stateless application logic**; horizontal scaling behind a load balancer is the model, with all replicas sharing the same ValKey cluster and write-ahead store. Every design decision below assumes concurrent replicas.

### 6.3 The write-ahead store is also the DLQ

One physical store, two write paths (write-ahead on receipt; DLQ on failure). Consequences:

- Entry lifecycle: written at step 2 → **cleared or marked completed** when the pipeline reaches step 9 successfully → **marked failed and left as a DLQ entry** if the pipeline dead-letters.
- On a write failure *after* a successful reachability check: **return 503**, never 200 for an event that is not durably recorded.
- A 503 to MLA causes MLA not to advance its offset — this is the back-pressure mechanism, and it is intentional.
- Sizing must account for **peak** TPS (125), not sustained (25) — every event is written here, not just failures.
- Technology (database vs. object storage) is TBC pending the hosting decision (FSD §4.7). **The store interface must be abstracted so the technology can be swapped**, and it must support **keyed retrieval by `transferId`**, not just sequential scan (US-PPA-16).

### 6.4 Idempotency (US-PPA-04) — one generic mechanism

- Key: **`{id}:{isoMessageType}`** — e.g. `transferId:pacs.002.001.12`, `quoteId:pain.001.001.11`.
- **Atomic check-and-set**, not a read followed by a write. This is what makes it correct across concurrent replicas: a second replica's attempt to set an already-set key simply fails and it backs off.
- Stored in the **durable write-ahead store, not ValKey** — deliberately. ValKey's `volatile-lru` eviction could silently evict a dedup key and re-admit a duplicate.
- Runs **once, before translation**. No second check before the TMS POST is needed.
- **Uniform across all four event types. No exemptions, no special cases.** A repeat for an already-processed pair is a duplicate, full stop — there is no "which value wins" comparison. A `COMMITTED` arriving after an already-processed `ABORTED` is a duplicate of an already-finalized pair, not a conflict to resolve.
- TTL must exceed the widest plausible re-delivery window across *all* event types — the transfer terminal leg has historically needed the widest.

Since the Notification Filter/Dedup component was removed, **this is the pipeline's sole notification-dedup mechanism**, which makes its atomicity matter more, not less.

### 6.5 Trigger and cache are independent properties (US-PPA-05)

This was the source of the review's most consequential defect (R-01) and is worth stating flatly:

> **Triggering a message does not exempt an event from also being cached.**

| Event | Triggers | Also cached |
| --- | --- | --- |
| `POST /quotes` | **pain.001** | payer identity, `transactionType`, `note` |
| `PUT /quotes` | **pain.013** | `ChrgBr`, fees |
| `POST` + `PUT /fxQuotes` | — | source/target amount, rate |
| `POST` + `PUT /fxTransfers` | — | correlation/audit data |
| `POST /transfers` (prepare) | **pacs.008** | reads the accumulated cache from every row above |
| `PUT /transfers` (fulfil) | **pacs.002** | reads identifiers cached by the prepare's trigger |
| Any error callback | **pacs.002** with `TxSts: RJCT` | — |

- **Every** event reaching this step is written to the correlation cache, regardless of trigger status.
- Cached data is retained **until the terminal message for that transaction leg has been sent** — not cleared after each stage, and not cleared because the event that produced it also fired a trigger.
- Cached data is not scoped to feeding one particular downstream message type. It serves "whichever later stage needs it."
- Quote request and Quote callback are **independent triggers**, not two halves of a paired event. pain.001 fires the moment the request lands; PPA does not wait for the callback.
- An unclassifiable `eventType`+`msgType` combination is logged and dead-lettered.

### 6.6 Domestic vs. cross-border (US-PPA-07)

For TRANSFER trigger events:

- **Domestic** ⟺ no FX-quote state in the correlation cache **AND** no `determiningTransferId` in the event body.
- Domestic ⇒ **silently discarded**: no TMS message, **no DLQ entry, no alert** — only a counter metric. Out of Phase 1 scope is not an error.
- Cross-border ⇒ proceed to translation.
- **The race case matters:** `determiningTransferId` present but FX-quote state not yet cached ⇒ still cross-border, still in scope. The pacs.008 emitted will be **degraded** (missing FX enrichment) but **must still be sent**.
- Whether FXTRANSFER should reach this discriminator at all is disputed — R-21 says per FSD §6.4.1 it never does.

---

## 7. ISO 20022 translation reference

### 7.1 pain.001.001.11 — Quote request (US-PPA-08)

| Target | Source |
| --- | --- |
| `Dbtr` / `InitgPty` | payer `partyIdInfo`, name from `personalInfo.complexName`, DOB from `personalInfo.dateOfBirth` |
| `Amt.InstdAmt` | payment amount and type — **sourcing unconfirmed for `amountType: RECEIVE`** (R-13) |
| `Amt.EqvtAmt.{Amt, CcyOfTrf, XchgRateInf}` | cached FX-quote sourceAmount / targetAmount, **if present** |
| `PmtInfId` | `quoteId` |
| `PmtId.EndToEndId` | `transactionId` |
| `Cdtr.Nm` | payee display name; **falls back to payee MSISDN** (`payee.partyIdInfo.partyIdentifier`) when unavailable — a known gap (FSD Open Item #4), and the fallback is correct behaviour, not a bug |
| `GrpHdr.MsgId` | PPA-generated ULID, **pinned at first assembly, reused on retries** |
| `GrpHdr.CreDtTm` | PPA timestamp at first assembly, also pinned |

- If no FX leg exists, omitting `EqvtAmt`/`XchgRateInf` is expected and **not** a degraded case. If `determiningTransferId` *is* present and FX data is absent, that **must be flagged in the audit log**.
- **ALS / party lookup never publishes to Kafka.** Payee name is not sourced from a `PUT /parties` event. Confirmed.
- `PmtId` carries **no `InstrId`** on this message — if sent, TMS silently strips it (R-20, not yet an AC).

### 7.2 pain.013.001.09 — Quote callback (US-PPA-09)

| Target | Source |
| --- | --- |
| `CdtTrfTxInf.SplmtryData.Envlp.Doc.{PyeeRcvAmt, PyeeFinSvcsPrvdrFee, PyeeFinSvcsPrvdrComssn}` | `payeeReceiveAmount`, `payeeFspFee`, `payeeFspCommission` |
| `ChrgBr` | from the callback, e.g. `CRED` |
| `PmtInf.XpryDt.DtTm` | quote `expiration` |
| `GrpHdr.MsgId` | **Always PPA-generated ULID** — never copied from the callback's `extensionList`, even if the Mojaloop wire carries a `GrpHdr.MsgId` extension key. A deliberate deviation from the Mojaloop field-mapping reference. |

- **`XchgRateInf` does not appear in pain.013** — no such element in Tazama's schema. Including it results in silent stripping by TMS's `removeAdditional`. Its absence is correct.
- pain.013 is **sequence-independent of pain.001**. If the callback somehow arrives first, pain.013 is still assembled and sent from the callback event alone.

### 7.3 pacs.008.001.10 — Transfer prepare (US-PPA-10)

Assembled from the prepare event plus cached enrichment from up to five prior messages. **The prepare alone triggers it — PPA does not wait for the fulfil.**

**From the Transfer PREPARE:**

| Target | Source |
| --- | --- |
| `PmtId.InstrId` | `transferId` |
| `PmtId.EndToEndId` | decoded ILP `transactionId` |
| `Cdtr` / `CdtrAcct` identifiers | decoded ILP packet payee `partyIdInfo` / `extensionList` |
| `IntrBkSttlmAmt` | `amount` |
| `DbtrAgt` / `CdtrAgt` | `payerFsp` / `payeeFsp` |
| `SplmtryData.Envlp.Doc.Xprtn` | expiration |

**From cached Quote request:** `personalInfo.complexName` → `Dbtr.Nm` / `InitgPty.Nm`; `dateOfBirth` → `Dbtr.DtAndPlcOfBirth.BirthDt`; `name` → `DbtrAcct.Nm`; `transactionType` → `Purp.Cd`; `note` → `RmtInf.Ustrd`.

**From cached Quote callback:** `ChrgBr` → `ChrgBr`; `payeeFspFee` → `ChrgsInf`; `SttlmMtd` → `GrpHdr.SttlmInf.SttlmMtd`.

**From cached FX Quote:** `sourceAmount` → `InstdAmt`; derived exchange rate → `XchgRate`.

**PPA-generated:** `GrpHdr.MsgId` (ULID, pinned); `GrpHdr.CreDtTm` (pinned); `RgltryRptg` (constant: BALANCE OF PAYMENTS / 100); `SplmtryData.Envlp.Doc.InitgPty.Glctn` (sentinel `0,0`); `GrpHdr.NbOfTxs` = 1 on every message.

**Rules that bite:**

- **The ILP packet is decoded structurally** (base64url → ILP v4 / BER → embedded JSON) to extract `transactionId`. This is **not a cryptographic operation** — nothing needs decrypting.
- The decoded packet's `transactionType.initiatorType` is **advisory only**. The **quote request's `transactionType` is authoritative** for `Purp.Cd`. Any discrepancy between the two copies is logged.
- **Agent identifiers use `FinInstnId.ClrSysMmbId.MmbId`, NOT `FinInstnId.Othr.Id`.** Mojaloop's own extension keys use `Othr.Id` and must not be copied through unmodified.
- **Payee `Cdtr.BirthDt` is the sentinel `1900-01-01`** — no source exists in any Mojaloop message. `CityOfBirth` = `"Unknown"`, `CtryOfBirth` = `"ZZ"` on **both** parties.
- **Consequence of the sentinels:** fraud rules must **not** be configured against payee age, geolocation, or geographic velocity for cross-border traffic. This constraint must be communicated to whoever configures Tazama's rule processors.
- Degraded fields fall back per FSD §6.4.3's degraded table (e.g. payee name → payee MSISDN). **Any fallback applied ⇒ the pacs.008 is flagged as degraded in the audit log.**
- **After a successful send, PPA writes `transferId → { InstrId, EndToEndId }` into correlation state** for pacs.002's identifier resolution.

### 7.4 pacs.002.001.12 — Final state (US-PPA-11)

| Target | Source |
| --- | --- |
| `TxSts` | `transferState` translated: **COMMITTED → `ACSC`**, ABORTED → `RJCT`, RESERVED → `ACSP`; error callbacks → `RJCT` |
| `AccptncDtTm` | `completedTimestamp` |
| `InstgAgt` / `InstdAgt` | `fspiop-source` / `fspiop-destination` headers |
| `OrgnlInstrId` / `OrgnlEndToEndId` | resolved from the cached `transferId → { InstrId, EndToEndId }` mapping (§6.4.5) |
| `ChrgsInf` | cached `payeeFspFee`; **`[]` for error callbacks** |
| `GrpHdr.MsgId` | PPA-generated ULID, pinned. **Never copied from the fulfil's `extensionList`**, even if that key is on the wire. |

**Rules that bite:**

- **`ACSC`, not `ACCC`.** `COMMITTED` confirms settlement between schemes, not final credit to the payee's account.
- `OrgnlInstrId` / `OrgnlEndToEndId` **must exactly match** the corresponding pacs.008's `PmtId.InstrId` / `PmtId.EndToEndId`. **Mismatched identifiers cause TMS to silently accept the pacs.002 and never link it to its transfer in Tazama's graph** — a silent-wrong failure with no error signal.
- **PPA must never assume `transactionId` == `transferId`.** It always resolves `EndToEndId` from the cached mapping.
- **`TxSts` is an unconstrained string in Tazama's real schema.** An untranslated `"COMMITTED"` would be silently accepted and would break every downstream rule testing for a real ISO status code. **The translation is a correctness requirement, not a validation one — no validator will catch getting it wrong.**
- Error code and description are logged **in the audit log only**. Tazama's pacs.002 interface has no `StsRsnInf` field; including it causes silent stripping.

### 7.5 The `removeAdditional: 'all'` trap — and the two defences

TMS validates with ajv configured `removeAdditional: 'all'`. **A message carrying a field TMS's schema doesn't know about is silently stripped and returns a false HTTP 200.** Two mechanisms exist to catch this before it happens (US-PPA-12):

1. **Pinned local schema validation.** PPA holds version-controlled local copies of Tazama's ajv schemas for all four message types (`pain.001.json`, `pain.013.json`, pacs.008, pacs.002), tracking the same `tms-service` commit pinned in the FSD. Every assembled message is validated **before** the TMS POST. **Local validation must run the same ajv configuration TMS uses, including `removeAdditional: 'all'`** — a different config defeats the purpose. Updating a pinned schema requires an **explicit, reviewed commit; never an automatic pull on startup.**
2. **The pacs.008 field-completeness regression check.** `EndToEndId`, `Dbtr`, `Cdtr`, `DbtrAcct`, `CdtrAcct` must **all** be present on every non-degraded pacs.008. This exists precisely because **schema validation confirms shape, not that a required identity field was actually populated** — it is the check that would have caught R-30.

A local validation or completeness failure is a **translate-time defect**: log, alert, DLQ. **Not sent to TMS.**

### 7.6 Dispatch to TMS (US-PPA-13)

- Version-pinned endpoints: `POST /v1/evaluate/iso20022/{pain.001.001.11 | pain.013.001.09 | pacs.008.001.10 | pacs.002.001.12}`.
- **HTTPS only** (plain HTTP rejected), with **mutual TLS *and* a Keycloak-issued bearer token** (Auth-lib → Auth-service → Keycloak chain) on **every** request. `Content-Type: application/json`.
- The token has a finite TTL and must be **refreshed proactively before expiry**, not reactively after the first 401. Token-refresh failure must be **separately alerted** so an operator is paged before the failure cascades.
- **Delivery is at-least-once. Every retry sends the exact same message built at translation time, with the same pinned `GrpHdr.MsgId` — never a rebuild.**
- 5xx / timeout ⇒ retry ×3 with backoff and jitter. 4xx ⇒ DLQ immediately, no retry. Retry exhaustion ⇒ DLQ + operations alert.
- HTTP 200 ⇒ log success, update the write-ahead record, and clear ValKey state **only once the terminal message for the transaction has been sent** — not simply on any pacs.008.

**The PPA→TMS circuit breaker:**

- Trips after N consecutive TMS failures across messages (N configurable).
- While tripped, **the breaker's open state feeds US-PPA-02's step-1 per-request gate, returning 503 to MLA** — pausing MLA's Kafka offset and letting the audit topic's retention buffer the backlog, rather than every new event burning a full 3-attempt retry cycle before landing in the DLQ.
- **This is deliberately not implemented by failing `/health/ready`** — mirroring the ValKey precedent, it back-pressures MLA per-partition without pulling a healthy PPA replica out of load-balancer rotation over a shared downstream dependency.
- Re-probes TMS health on a configurable interval; resumes and clears the 503 gate once a probe succeeds.
- Breaker state (open/closed/half-open) is exposed **as a metric**.
- **Events already mid-retry when the breaker trips run their own retry budget to completion.** The breaker governs whether *new* events are attempted, not what happens to one in flight.

---

## 8. Correlation and state model

### 8.1 ValKey — the correlation cache (US-PPA-06)

- **Cache keys by event type:** QUOTE → `quoteId`; FXQUOTE → `conversionRequestId`; TRANSFER → `transferId`; FXTRANSFER → `commitRequestId`.
- **Writes are atomic read-modify-write** — a Lua-scripted compare-and-merge. **A plain read-then-write from two concurrent replicas silently loses one side's update and is not acceptable.**
- The transaction-level key (`transactionId`/`transferId`) accumulates from **all** stages concurrently, including stages that also triggered their own message.
- **Every entry carries an explicit TTL** (never indefinite). The TTL must account for **MLA ingestion delay under Kafka lag** — it is not derived from the Mojaloop expiration field alone (FSD §9.3).
- ValKey runs `volatile-lru` eviction; silent eviction under memory pressure is caught by a **dedicated ValKey memory-pressure alert**.
- **ValKey must run as a highly-available cluster — a release-blocking NFR.**
- If ValKey is unreachable at cache-write time, this should not happen (step 1 already checked it). If it happens anyway: **hard stop — log, alert, never silently proceed without caching.**

### 8.2 Three durability tiers, and why each exists

| Tier | Store | Lifetime | Purpose |
| --- | --- | --- | --- |
| Correlation state | ValKey | short TTL, per FSD §9.3 | fast in-flight enrichment across a transaction's stages |
| Parked state | write-ahead store / DLQ | **90 days** | survives ValKey TTL expiry; extends effective correlation lifetime |
| Idempotency keys | write-ahead store | TTL > widest re-delivery window | duplicate suppression, immune to `volatile-lru` eviction |

### 8.3 Parking before TTL expiry (US-PPA-16)

For legs in progress — pacs.008 sent, pacs.002 not yet sent — PPA monitors correlation TTL expiry and **writes the full accumulated leg state to the DLQ before the TTL lapses**.

- If the pacs.002-triggering event arrives after ValKey's TTL lapsed, **PPA checks the DLQ/write-ahead store for a parked entry by `transferId` before giving up**, then resolves identifiers from it, assembles, and emits the pacs.002.
- **The effective correlation lifetime therefore extends to the DLQ's 90-day retention, not ValKey's short TTL.**
- A pacs.002-triggering event found in **neither** ValKey nor the DLQ is logged and alerted — **it is not forwarded to TMS without identity resolution.**
- **Parking raises a distinct informational alert** ("correlation TTL approaching, parking state for `transferId` X"), **not** the failure alert a true dead-letter raises. Operator tooling must make the distinction visible: a parked entry is **live recovery state, not a terminal record.**
- **Not covered:** the case where PPA itself was down long enough that it never got to park anything. FSD Open Item #9.

### 8.4 Out-of-order arrival — fulfil before prepare (US-PPA-17)

- A pacs.002 trigger arriving with no state in ValKey or the DLQ is **not immediately dead-lettered**. PPA holds it and retries within a short bounded window, **reusing the existing retry budget (§6.7), not a separate mechanism**.
- After the window, dead-letter and alert.
- **If the prepare's pacs.008 is processed after the fulfil was already dead-lettered, PPA retrieves the parked fulfil from the DLQ and completes correlation from there** — again, the DLQ is where pending state waits, not a terminal record.
- Normal-operation prepare-to-fulfil gap is **under 1 second** (per §7's corridor capture). Calibrate the window with that in mind, but **also account for MLA backlog scenarios where the gap widens**.
- **This is a real and likely race, not a remote edge case.** But the cause stated in the story is stale: it is **not** "prepare and fulfil sit on different Kafka topics" (that describes the pre-audit-topic architecture). The actual driver is **PPA's async-ack-then-process model across horizontally-scaled replicas, plus an unconfirmed audit-topic partition key** (R-29, open).

### 8.5 The DLQ (US-PPA-15)

- Every entry carries: the full envelope (**PII-masked** per §10.3), the failure reason, retry count, timestamp, the `correlationId`, and the `isoMessageType` where applicable.
- **Every DLQ write immediately raises an operations alert.**
- **90-day retention**, then purge or archive per CCH compliance policy.
- **Replay is operator-triggered only — no auto-replay.** A replay re-injects the entry **from the step it failed**, without requiring a fresh Kafka event, and writes its own audit-log entry including a **`replay-of` pointer** to the original.
- PII in the DLQ is already in tokenized/protected form — tokenization happened upstream in MLA.

---

## 9. Durability, failure and back-pressure — end to end

The whole design rests on one chain, and it is worth being able to recite it:

```
MLA commits the Kafka offset  ⟸ only on PPA HTTP 200
PPA returns HTTP 200          ⟸ only after a durable write-ahead write
therefore:  an event that is not durably recorded never has its offset advanced
therefore:  the Kafka offset + 7-day audit-topic retention is the recovery buffer
```

**Every hard failure back-pressures rather than drops.** The 503 is the single mechanism:

| Condition | PPA response | Effect |
| --- | --- | --- |
| ValKey unreachable | 503 at step 1 | MLA offset pauses |
| Write-ahead store unreachable or write fails | 503 at step 1 / step 2 | MLA offset pauses |
| PPA→TMS breaker open | 503 at step 1 | MLA offset pauses; audit topic buffers |

**Failure classification is uniform on both sides:** 5xx/timeout = transient → retry ×3, backoff + jitter, offset does not advance; 4xx = permanent → log, alert, DLQ (PPA) or advance offset (MLA), never retry.

**What is deliberately dropped, and only these:**

| Dropped | Where | Signal |
| --- | --- | --- |
| `egress` records | MLA | none — structural skip |
| Party-discovery records | MLA | logged |
| Unclassifiable events | MLA | logged, offset advanced |
| Unreadable payloads (bad base64/JSON) | MLA | logged + alert |
| Failed/missing JWS | MLA | security log + alert |
| Duplicate `{id}:{isoMessageType}` | PPA | silently dropped |
| Domestic transfers | PPA | **counter metric only** — no DLQ, no alert |

**Two prohibitions state what must never be fabricated** — the highest-consequence rules in the spec, and **still without acceptance criteria** (R-04, Critical, open):

> **Never synthesize a pacs.002. Never synthesize a pain.013.**

---

## 10. Security model

| Boundary | Control |
| --- | --- |
| DFSP → audit topic → MLA | **JWS `FSPIOP-Signature`** (RS256/384/512), validated on **every** event, no exemptions, against the untouched original payload |
| Inside MLA | **PII tokenization** — keyed hash, deterministic, prefixed, secret loaded at startup, strictly **after** signature validation |
| MLA → PPA | **Mutual TLS**, TLS 1.2+, allow-list of exactly one client certificate |
| PPA → TMS | **HTTPS + mutual TLS + Keycloak bearer token**, both present on every request |
| Logs / DLQ / audit | **PII masking** per §10.3 — the only protection the ILP-exempt cleartext fields ever get |

Certificates and secrets are provisioned externally and mounted at startup. DFSP public key storage and rotation follow the FSD §10.1 certificate policy; distribution is owned by CCH / the Mojaloop Partner.

**mTLS certificate lifecycle (US-SEC-01):** minimum 2048-bit RSA or equivalent EC; TLS 1.2+ enforced on every hop, 1.0/1.1 disabled (already stated above, restated here as the same story's own AC); rotation must be possible without a service restart (hot-reload or rolling restart, confirmed with CCH before implementation); expiry is monitored with an alert at a minimum 30-day warning; issuance/rotation policy is documented and owned by a named team before go-live. Certificate tooling itself (Vault PKI, cert-manager, manual issuance) is an infrastructure-setup decision, not specified here.

---

## 11. Non-functional requirements

| NFR | Value | Source |
| --- | --- | --- |
| Sustained throughput | **25 TPS** | FSD §9.1 |
| Peak throughput | **125 TPS** — the number to size the write-ahead store against | FSD §9.1 |
| MLA end-to-end ack latency (Kafka consume → PPA HTTP 200) | **≤ 200 ms p95** under sustained load | US-PERF-01 |
| PPA correlation-to-TMS latency (envelope received → TMS HTTP 200) | **≤ 500 ms p95** under sustained load | US-PERF-01 |
| Peak-to-sustained step-down | **No event loss**; consumer lag must not grow unboundedly at 125 TPS | US-PERF-01 |
| Audit topic retention | **7 days** — the agreed recovery window | US-MLA-01 |
| DLQ retention | **90 days** | US-PPA-15 |
| Test coverage | **95% with Jest, on every piece of code, on every component** | stated in all five documents |
| ValKey availability | **HA cluster — release-blocking** | US-PPA-06, US-PERF-02 |
| TLS | **1.2+; 1.0/1.1 disabled; minimum 2048-bit RSA or equivalent EC** | US-PPA-01, US-SEC-01 |

**Note on the throughput baseline (R-10, Medium, open):** the 25 TPS sustained / 125 TPS peak figures above are themselves flagged by `cch-crosscutting-user-stories.md` as citing a **superseded** IDD version — the current IDD (v2.0) states this baseline as a working assumption still pending CCH sign-off, distinct from the FSD's own Open Item #1. Build against the stated figures; do not treat them as more confirmed than the source itself claims.

---

## 12. Decided, removed, and superseded

### 12.1 The Notification Filter/Dedup component is REMOVED — dropped, not deprioritized

**No implementation work should proceed on this epic.** US-DEDUP-01 is retained in its document as a historical record only.

**Why.** Verified against `DRPP_Kafka_E2E_Pack` (five corridor captures plus one interleaved partition slice from `topic-event-audit`): **the topic carries no independently-published Central Ledger final-state notification.** `fulfilTransfer` (ingress) and `commitTransfer` (egress) are the *same relayed FSPIOP fulfil callback* — identical `GrpHdr.MsgId`, `TxSts`, `fspiop-source`, `fspiop-destination` — observed exactly once per transaction across all five corridors and the interleaved slice. `fspiop-source` on `commitTransfer` is **always the DFSP that sent the original fulfil, never a hub/Central-Ledger identity.**

There is no separately-published event to deduplicate, so the component has no reason to exist. This closes FSD Open Items #2 and #5. Full evidence: `Message_NotificationDedup_OpenItems_Resolution.md`.

**What this cascades into — every one of these is a live design fact, not trivia:**

- **No fifth `eventType`.** The four-value enum is confirmed by evidence, not assumed (R-02).
- **No third `msgType`.** `request` / `callback` only (R-03).
- **No `/TRANSFERS/NOTIFICATIONS` endpoint.** The fulfil leg is covered by `/TRANSFERS`.
- **No JWS exemption.** Every event on the topic is DFSP-originated and signed. US-MLA-05's exemption is removed, not re-scoped (R-06).
- **One pacs.002 trigger, not two** — the fulfil callback. No duplicate-emission risk masked by a sent-message dedup set (R-07).
- **US-PPA-04 is now the pipeline's sole notification-dedup mechanism**, which is why its atomicity matters more post-removal, not less.
- **FSD sections owed a removal or explicit supersession:** §4.1's component-table row, §4.7, §6.3 step 4's notification-dedup sub-step, §9.6's capacity note, §10.5's threat model, and the Glossary entry.

### 12.2 Resolved design questions worth not re-litigating

| Question | Resolution |
| --- | --- |
| `eventType` cardinality (R-02, Critical) | **Four values.** Confirmed by Kafka evidence. |
| `msgType` FSD/IID conflict (R-03, Critical) | **Two values, `request`/`callback`**, derived from the POST/PUT/PATCH signal classification already reads. The FSD's third value is dead; the IID's "POST/PUT" wording names the same two-way split by HTTP method. **A documentation fix owed to the IID — not an open design question.** |
| Trigger vs. enrichment exclusivity (R-01, Critical) | **Independent properties.** Trigger events are cached too. Left unfixed this would have silently degraded *every* pacs.008. |
| PPA→TMS circuit breaker (R-05, Critical) | Specified, tripping via US-PPA-02's existing 503 gate. |
| pacs.008 `Cdtr`/`CdtrAcct` sourcing (R-30, Critical) | From the decoded ILP packet's payee identity. |
| Two dedup stores' failure-domain relationship (R-27/R-28) | Merged into **one generic atomic check-and-set** on `{id}:{isoMessageType}`. |
| Retries-exhausted-but-breaker-not-tripped (R-08, High) | **Pause the offset on that event and keep retrying it**; those failures accumulate toward the breaker threshold. |
| TLS handshake failure classification (R-22) | **Transient**, folded into the 5xx path, with the specific reason retained in the alert. |
| pacs.008 field-completeness regression (R-35) | Added to US-PPA-12. |
| The observability *stack* | **Confirmed, not open.** Prometheus, Grafana, Loki, Tempo, Mimir (IDD §10, 28 July infrastructure discussion). CCH owns the metrics-collection agents; both services expose Prometheus-compatible endpoints. Only the alerting *destination/routing* stays open — see R-37, §13.2. |

---

## 13. Open register — what is genuinely undecided

### 13.1 FSD Open Items

| # | Question | Bites |
| --- | --- | --- |
| **#1** | Agree MLA→PPA and PPA→TMS **timeout / retry budget values** | US-MLA-06, US-MLA-07, US-PPA-13 (R-31) |
| **#3** | Does the **`FSPIOP-Signature` header survive** the DFSP → switch → Kafka → audit-topic chain, in particular the base64 data-URI re-serialisation on transfer topics? | **US-MLA-05 cannot be closed without this.** If it doesn't survive, JWS validation as specified is unimplementable and an alternative (e.g. topic-level auth) must be agreed. |
| **#4** | Payee display name has no source | US-PPA-08 — MSISDN fallback is the accepted answer |
| **#7** | The **audit-topic feed mechanism** (mirroring vs. in-process publishing), and whether `operation` / `Content-Type` / `FSPIOP-HTTP-Method` survive identically in CCH production as in the staging capture | **US-MLA-02's classification rule cannot be finalized without this.** MLA's consumer contract does not otherwise depend on the feed mechanism. |
| **#8** | Confirm the **offset-advance-on-permanent-failure** policy for 4xx and JWS rejections | US-MLA-07 |
| **#9** | The residual scenario where **PPA was down long enough to never park anything** | US-PPA-16 — needs separate handling confirmed with Paysys |

*(Items #2, #5 and #6 are closed — see §12.1 and R-09.)*

### 13.2 Open review findings, by severity

| # | Sev | What is open |
| --- | --- | --- |
| **R-04** | **Critical** | The two **"never synthesize"** prohibitions (no fabricated pacs.002, no fabricated pain.013) have **zero acceptance criteria** in US-PPA-09, US-PPA-11 or US-PPA-16. Highest-consequence rule in the spec. **Do first.** |
| **R-37** | **High** | Alerting **destination/routing** (PagerDuty/Slack/email, and the mechanism connecting an alert condition to it, e.g. Grafana Alertmanager) is undecided pipeline-wide, despite nearly every story specifying "raise an alert." A SIEM/log-aggregation platform is separately unconfirmed (IDD Open Item #8). Affects every alert path named in Phase 6 (`plan.md` §9). The FSD's own §6.7 cross-references this to a §12 Open Item that does not actually exist there — a gap in the FSD itself. |
| **R-29** | High | US-PPA-17's out-of-order rationale cites the superseded per-topic architecture. Race is real; cause is the async-ack-then-process model across replicas plus an **unconfirmed audit-topic partition key**. |
| R-11 | Medium | FSD self-contradicts on pacs.002 `GrpHdr.MsgId` provenance (§6.5.4 "always PPA-generated" vs. §6.4.3's table "where supplied"). US-PPA-11 follows the correct clause; the fix is owed to the FSD. |
| R-12 | Medium | Payee-name sourcing — stories correct, mapping data already corrected. |
| R-13 | Medium | pain.001 `InstdAmt` sourcing **diverges outside the golden path**: FSD says the quote's own `amount`, mapping data says FX quote's `sourceAmount`. **A decision is needed for `amountType: RECEIVE`.** |
| R-32 | Medium | "Quote callback never arrives" (FSD §6.4.6) needs an explicit **timeout log + dual degraded-flag** (missing pain.013 *and* degraded pacs.008). No story states it. |
| R-18 | Low (but high blast radius) | US-MLA-01 requires only an externally-configured consumer group, not a **dedicated** one. Per IID §5.1, reusing a DRPP-internal group name risks **stealing partition assignments from a live payment-path handler** — described as *the one MLA misconfiguration capable of affecting live payments*. |
| R-23 | Low | **Event Envelope versioning** unaddressed (IID §5.2: additive-only, breaking change = new endpoint path). |
| R-31 | Medium | Open Item #1 not carried as an assumption on US-MLA-06/07. |
| R-15 | Low | US-PPA-08 cross-references US-PPA-13 for schema validation; should be US-PPA-12. |
| R-19 | Low | US-PPA-08 states an ILP-authority rule for a message that carries no ILP packet. Belongs on US-PPA-10 only. |
| R-20 | Low | US-PPA-08 omits that `PmtId` carries no `InstrId` on pain.001. |
| R-21 | Low | US-PPA-07 applies the domestic discriminator to FXTRANSFER, which per FSD §6.4.1 never reaches that step. |
| R-33 | Low | "Error callback, no cached transaction" not explicitly named as a unit test in US-PPA-16. |
| R-34 | Low | §8.2's Rejected Payment scenario has no single dedicated story — split across US-PPA-11 and US-PPA-16. |
| R-10 | Medium | US-PERF-01's 25/125 TPS baseline cites a superseded IDD version (current IDD v2.0 states it as a working assumption, not confirmed). US-PERF-02's ValKey sizing formula carries no worked target figure — IDD v2.0 works one out (~60K entries, 2–3 GiB, 6-node cluster). |
| R-17 | Low | US-MON-01's description states "four distinct signals"; its own acceptance criteria list seven. |
| R-36 | Low | No Phase 1 Exclusions/Non-Goals section anywhere in the stories, mirroring FSD §11 — document-wide scope hygiene, not owned by one component. |

### 13.3 Undecided outside the finding register

- **PII fail-mode** — if tokenization can't run, block the event or let it through unprotected? **Needs a CCH decision before go-live.**
- **PII secret rotation strategy** — version old and new tokens, or treat rotation as an event requiring in-flight correlation to drain first?
- **What "protected" must legally mean** — reversible-by-authorized-lookup, or merely irreversible-without-the-secret? **CCH Legal.**
- **Named ownership of the tokenization secret** and its rotation schedule — unassigned.
- **How MLA sources DFSP public keys** — synced local store vs. live lookup service, and how a key-source outage is distinguished from a genuine signature failure. **[2026-09-09 meeting, `docs/meetings/9-sept.md`]:** Sam (Mojaloop Foundation) confirmed Mojaloop Connection Manager (MCM) manages DFSP key distribution automatically during onboarding — **MLA should interface with MCM rather than maintain its own key store**; an onboarding video is pending from Sam. The key-source-outage classification itself is already built (Phase 3's distinct `key-source-unavailable` outcome) and is unaffected by which source eventually supplies the keys.
- **Alerting destination and routing** (Slack / PagerDuty / email, and the mechanism wiring a condition to it) — the observability stack is confirmed, the destination is not (R-37). Affects every alert path in both services. **A SIEM/log-aggregation platform is a separate, also-unconfirmed item** (IDD Open Item #8), relevant to audit-log and security-alert output (US-AUD-01) rather than to metrics.
- **Write-ahead store technology** — pending the hosting-location decision (FSD §4.7).
- **The pinned `tms-service` commit** for the four ajv schemas — must be identified and documented **before implementation begins**.
- **Whether conflicting terminal states** (`COMMITTED` after `ABORTED`) actually occur on COMESA's DRPP — the implementation handles it correctly regardless, by treating any repeat as a plain duplicate.

---

## 14. Known gaps in the document set itself

Worth knowing before treating these five documents as complete:

1. ~~`cch-crosscutting-user-stories.md` is referenced repeatedly but is not present in `docs - MLA/user stories/`.~~ **Resolved [2026-09-07] — obtained and cross-referenced into this revision.** It is the home of **US-AUD-01** (audit-log PII masking, PPA-side), **US-MON-01** (monitoring/alerting), **US-MON-02** (readiness scoping), **US-PERF-01/02** (latency and ValKey sizing), and **US-SEC-01** (mTLS certificate lifecycle) — Epics 11–12, dated 18 August 2026 like the other four. It confirms the observability stack (§12.2 above) and leaves R-37 (alerting destination/routing, §13.2) as the residual open item.
2. **Epic numbering still has holes.** MLA covers Epics 1–3, dedup Epic 4, PPA Epics 6–10, crosscutting Epics 11–12. **Epic 5 remains unaccounted for** — the crosscutting document's own arrival ruled out "the crosscutting epic" as the answer, since it turned out to be Epics 11–12, not 5.
3. **US-PPA-14 no longer exists** — merged into US-PPA-04 (R-28). Do not look for it.
4. **The classify-vs-validate-signature ordering is not settled** between US-PII-01's Method (classify at step 3, validate at step 4) and the MLA stories' framing. The **validate-then-tokenize** invariant *is* settled and is the one that matters. See §3.2.
5. **The story documents are dated 18 August 2026 and carry open Actions with named owners.** Some findings are marked Resolved in the finding table while the corresponding Action row is still Open, and vice versa — read both.
6. **Externally-cited sources are not in this repository:** the FSD (`CCH_FSD_MessageIngestion`), the IID / IDD, `DRPP_Kafka_E2E_Pack`, and `Message_NotificationDedup_OpenItems_Resolution.md`. Every claim attributed to them here is a **reported** claim, not one this document independently verifies.

---

## 15. Story index

| Story | Title | Component |
| --- | --- | --- |
| US-MLA-01 | Subscribe to the Mojaloop audit topic | MLA |
| US-MLA-02 | Distinguish event types within the stream | MLA |
| US-MLA-03 | Decode base64-encoded transfer payloads | MLA |
| US-MLA-04 | Construct a standard Event Envelope | MLA |
| US-MLA-05 | Validate JWS signatures on DFSP-originated events | MLA |
| US-MLA-06 | Deliver envelopes to PPA via per-action endpoints | MLA |
| US-MLA-07 | Retry and circuit-break on PPA failures | MLA |
| US-PII-01 | Classify and tokenize party identity fields within MLA | MLA |
| US-PII-02 | Tokenization construction and secret handling | MLA |
| US-PPA-01 | Expose per-action inbound endpoints over mutual TLS | PPA |
| US-PPA-02 | Write-ahead persist before acknowledging MLA | PPA |
| US-PPA-03 | Validate the incoming envelope | PPA |
| US-PPA-04 | Enforce idempotency before translation *(absorbs former US-PPA-14)* | PPA |
| US-PPA-05 | Classify each event's trigger and caching behaviour | PPA |
| US-PPA-06 | Accumulate cacheable data into the correlation cache | PPA |
| US-PPA-07 | Discriminate domestic vs. cross-border transfers | PPA |
| US-PPA-08 | Translate quote request to pain.001.001.11 | PPA |
| US-PPA-09 | Translate quote callback to pain.013.001.09 | PPA |
| US-PPA-10 | Translate transfer prepare to pacs.008.001.10 | PPA |
| US-PPA-11 | Translate final-state event to pacs.002.001.12 | PPA |
| US-PPA-12 | Validate assembled message against pinned local schema | PPA |
| US-PPA-13 | Send validated messages to Tazama TMS | PPA |
| US-PPA-15 | DLQ: write, alert, and support replay | PPA |
| US-PPA-16 | Park correlation state before ValKey TTL expiry | PPA |
| US-PPA-17 | Handle out-of-order arrival (fulfil before prepare) | PPA |
| ~~US-DEDUP-01~~ | ~~Filter and deduplicate Central Ledger notifications~~ | **REMOVED** |
| US-AUD-01 | Write audit log entries for every processed event | PPA |
| US-MON-01 | Monitor consumer lag, circuit breaker state, and degraded-message rate | Cross-cutting (MLA + PPA) |
| US-MON-02 | Expose health endpoints for load balancer and orchestrator | PPA |
| US-PERF-01 | Meet latency targets at sustained and peak TPS | Cross-cutting (MLA + PPA) |
| US-PERF-02 | Size and configure ValKey for correlation workload | PPA |
| US-SEC-01 | Establish mTLS certificates for MLA↔PPA and PPA↔TMS | Cross-cutting (MLA + PPA + TMS boundary) |

---

*End of Document*

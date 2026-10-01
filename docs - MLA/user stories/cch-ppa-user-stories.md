# CCH — Payment Platform Adaptor (PPA): User Stories & Review

**CCH FRMS | Paysys Labs** | Component: PPA | 18th August 2026
Source stories: `CCH_UserStories_MessageIngestion_v1.0.md`, Epics 6–10 · Review consolidated from `CCH_UserStories_MessageIngestion_ConsolidatedReview_v1.0.md`

---

## User Stories

### Epic 6 — PPA: Ingress API & Write-Ahead Persist

#### US-PPA-01 — Expose Per-Action Inbound Endpoints Over Mutual TLS

**Description**
PPA exposes four POST endpoints, one per event type, plus health check endpoints. All are served exclusively over mutual TLS — a connection without a recognised MLA client certificate is rejected at the TLS layer before any application logic runs.

**Acceptance Criteria**
- The following endpoints exist and accept POST requests: `/QUOTES`, `/FXQUOTES`, `/TRANSFERS`, `/FXTRANSFERS`. Each endpoint receives both legs of its event type (request and callback, including the TRANSFER fulfil/final-state leg), distinguished by the envelope's `msgType`, not by a separate endpoint per leg (see `cch-mla-user-stories.md`, US-MLA-06).
- `/health/live` (GET) returns 200 if the PPA process is responsive.
- `/health/ready` (GET) checks instance-local conditions only: process up, config loaded, write-ahead store reachable and writable. It does **not** check ValKey or the TMS token chain.
- All POST endpoints require a valid MLA client certificate (mutual TLS). Connections without a recognised certificate are rejected at the TLS layer with a TLS alert — not with an HTTP 401.
- The allow-list of recognised client certificates contains exactly one entry: the MLA's certificate (or its CA). This is configurable.
- PPA returns HTTP 200 immediately on receipt of a valid envelope and processes asynchronously. The 200 is returned only after the write-ahead persist succeeds (see US-PPA-02).

**Method**
1. **Configure mTLS** — reject any connection without a recognised MLA client certificate at the TLS layer, before application logic runs.
2. **Register endpoints** — the four per-event-type POST endpoints plus `/health/live` and `/health/ready`.
3. **Scope health checks** — liveness checks only process responsiveness; readiness checks instance-local conditions only (process, config, write-ahead store), never ValKey or the TMS token chain.
4. **Acknowledge** — return HTTP 200 only once the write-ahead persist (US-PPA-02) has completed, not before.

**Assumptions**
- TLS 1.2 or higher is required. TLS 1.0/1.1 must be disabled.
- mTLS certificates for PPA (server cert/key) and for trusting MLA (CA cert) are provisioned externally and mounted at startup.
- PPA is stateless application logic; horizontal scaling behind a load balancer is the scaling model. All replicas share the same ValKey cluster and write-ahead store.

**Todos**
1. Implement the four POST endpoints and both health endpoints.
2. Configure the mTLS allow-list to contain exactly MLA's certificate (or its CA).
3. Wire `/health/live` and `/health/ready` to their respective, instance-local-only scopes.
4. Write tests (Jest, 95% coverage target) covering: valid certificate accepted, missing/unrecognised certificate rejected at the TLS layer, and each health endpoint's behaviour under every dependency state.

---

#### US-PPA-02 — Write-Ahead Persist Before Acknowledging MLA

**Description**
Before returning HTTP 200 to MLA, PPA must verify that both ValKey and its own durable write-ahead store are reachable, then write the envelope to the write-ahead store. This is what keeps the event durable if PPA crashes between the ack and completing the processing pipeline.

**Acceptance Criteria**
- Step 1 of the processing pipeline (before any other action): check that both ValKey and the write-ahead store are reachable. If either is down, return HTTP 503 and do nothing further — do not persist, do not acknowledge. The same gate also returns 503 while the PPA→TMS circuit breaker is open (US-PPA-13) — a third, independent reason to reject at step 1, not a special case of the other two.
- If both are reachable, write the envelope to the write-ahead store atomically before returning HTTP 200.
- PPA returns HTTP 200 to MLA only after the write-ahead write has succeeded (fsync / durable acknowledge from the store, not just an in-memory write).
- The write-ahead entry is cleared (or marked completed) once the processing pipeline reaches step 9 successfully, or marked failed and left as a DLQ entry if the pipeline dead-letters.
- On a write-ahead store write failure (the store is reachable at the check but the write fails), return HTTP 503 to MLA — do not return 200 for an event that is not durably recorded.
- A 503 response to MLA causes MLA to not advance its Kafka offset, correctly back-pressuring the pipeline.

**Method**
1. **Check reachability** — verify ValKey and the write-ahead store are both reachable before anything else in the pipeline runs.
2. **Short-circuit on failure** — if either is unreachable, return 503 immediately; do not persist, do not acknowledge.
3. **Persist** — write the envelope to the write-ahead store atomically.
4. **Acknowledge** — return HTTP 200 to MLA only once the write-ahead write has durably succeeded.
5. **Resolve the entry** — clear/mark-complete on reaching pipeline step 9 successfully, or mark failed and leave as a DLQ entry on dead-letter.

**Assumptions**
- The write-ahead store and the PPA DLQ are the same physical store — two write paths (write-ahead on receipt; DLQ failure path), one store.
- The write-ahead store technology (database vs. object storage) is TBC pending the hosting-location decision, per FSD §4.7. The store interface must be abstracted so the underlying technology can be swapped.
- Sizing must account for peak TPS (125 TPS per FSD §9.1), not just sustained TPS (25 TPS) — every event is written here, not just failures.

**Todos**
1. Implement the step-1 reachability check ahead of any other processing.
2. Implement the atomic write-ahead persist and the durable-ack gate before returning 200.
3. Implement the write-ahead entry's lifecycle (clear on success, mark failed on dead-letter).
4. Write tests (Jest, 95% coverage target) covering: both dependencies up, either down, a write failure after a successful reachability check, and confirming MLA doesn't advance its offset on a 503.
5. Confirm the write-ahead store technology once the hosting-location decision lands (FSD §4.7), sized for peak TPS (125), not just sustained.

---

### Epic 7 — PPA: Processing Pipeline

#### US-PPA-03 — Validate the Incoming Envelope

**Description**
After acknowledging MLA (step 2), PPA validates the envelope contents asynchronously. An invalid envelope is dead-lettered to the DLQ; it is not forwarded to TMS.

**Acceptance Criteria**
- Validation checks: `msgType` present and one of `request`/`callback`, `eventType` is one of the recognised values (QUOTE, FXQUOTE, TRANSFER, FXTRANSFER), `id` present and non-empty, `fspiop-source` present and non-empty, `body` non-null.
- An envelope failing any check is written to PPA's DLQ and processing stops. No TMS message is emitted.
- A validation failure is logged with the full envelope (masked per §10.3's PII rules) and the specific failed check.
- An unknown `eventType` value is treated as a validation failure.

**Method**
1. **Wait for step 2** — validation runs only after MLA has already been acknowledged (US-PPA-02's write-ahead persist is complete).
2. **Run structural checks** — `msgType`, `eventType`, `id`, `fspiop-source`, `body`, per the criteria above.
3. **Dead-letter on failure** — any failed check writes the full (masked) envelope to the DLQ and stops processing; no TMS message is emitted.
4. **Log** — the specific failed check is recorded alongside the DLQ write.

**Assumptions**
- Validation here is structural/completeness-only. Semantic validation (e.g. does the `transferId` in the body match the `id` in the envelope header) is not part of this step.
- PPA trusts that MLA has already validated the JWS signature and that the envelope body has already been decoded from base64. PPA does not re-validate or re-decode.

**Todos**
1. Implement the structural validation checks.
2. Wire the dead-letter path with masked logging of the specific failed check.
3. Write tests (Jest, 95% coverage target) covering each check's pass/fail path individually, plus an unknown `eventType` value.

---

#### US-PPA-04 — Enforce Idempotency Before Translation

**Description**
Before translating any trigger event into a Tazama message, PPA checks whether it has already processed an event for that same `id` + `isoMessageType` pair (e.g. `transferId:pacs.002.001.12`, `quoteId:pain.001.001.11`). This is a single, generic mechanism applied uniformly to every trigger event — quote request, quote callback, transfer prepare, and transfer fulfil/final-state alike — not a rule specific to any one event type. A repeat event for an already-processed `id`+`isoMessageType` pair is a duplicate, full stop: there is no comparison of which value should "win" (e.g. a transfer's `COMMITTED` arriving after an already-processed `ABORTED` is simply a duplicate of an already-finalized pair, not a conflict to resolve). The check runs once, before translation, using PPA's durable write-ahead store rather than ValKey.

**Acceptance Criteria**
- Before translating any trigger event, PPA performs an atomic check-and-set on `{id}:{isoMessageType}` against a durable set of already-processed pairs.
- If the pair already exists, the event is silently dropped: no TMS message emitted, no further processing.
- If the pair does not exist, it is recorded and the event proceeds to translation.
- The dedup store is PPA's durable write-ahead store (not ValKey). This is deliberate: ValKey's `volatile-lru` eviction policy could silently evict a dedup key and re-admit a duplicate.
- The TTL on the dedup entry must exceed the maximum plausible re-delivery window for any event type — long enough to also cover the transfer terminal leg, which has historically needed the widest window.
- The check is uniform across all four event types. There is no event-type-specific exemption or special-case logic — a transfer's multiple possible terminal states (`COMMITTED`/`ABORTED`/`RESERVED`) do not require different handling from a quote or prepare duplicate; whichever event is processed first for a given pair is final.
- The check itself is atomic (check-and-set), not a separate read followed by a separate write.

**Method**
1. **Compute the key** — `{id}:{isoMessageType}` for the event about to be translated.
2. **Check-and-set atomically** — against the durable write-ahead store.
3. **Drop on collision** — if the pair already exists, drop the event silently; no TMS message, no further processing.
4. **Proceed on success** — if the pair didn't already exist, continue to translation and classification (US-PPA-05 onward).

**Assumptions**
- Whether conflicting terminal states (e.g. `COMMITTED` after `ABORTED`) can actually occur on COMESA's DRPP is unconfirmed — the Mojaloop Partner should confirm this. The implementation must handle it correctly regardless, which it does by treating any repeat as a plain duplicate rather than attempting to reconcile competing values.
- A single atomic check-and-set run once before translation, with a durable store and a long TTL, also correctly resolves a concurrent-replica race on the same pair — a second replica's attempt to set an already-set key simply fails and it backs off. No separate, later check is needed right before the TMS POST.

**Todos**
1. Implement the atomic check-and-set against the write-ahead store, keyed on `{id}:{isoMessageType}`.
2. Confirm the TTL is long enough to cover the widest plausible re-delivery window across all event types, not just the transfer leg.
3. Write tests (Jest, 95% coverage target) covering: first event of a given pair processed, a repeat dropped for every event type (including a transfer terminal-state repeat with a different `TxSts` value), and a concurrent-replica race on the same pair.
4. Confirm with the Mojaloop Partner whether conflicting terminal states can actually occur on COMESA's DRPP.

---

#### US-PPA-05 — Classify Each Event's Trigger and Caching Behaviour

**Description**
Every validated event is classified along two independent properties, not one exclusive label: whether it **triggers** a Tazama message (zero or one outbound message), and whether its data is **cached** into the correlation state for whichever later stage of the same transaction leg needs it — not any one specific message type. These are not mutually exclusive — a Quote request or callback both triggers its own Tazama message (pain.001/pain.013) *and* caches data a later stage depends on (e.g. payer identity, `Purp.Cd`, `ChrgBr`, and fees, which the pacs.008 stage reads). An event's cached data is retained until its transaction leg is fully ingested — i.e. until the terminal message for that leg has been sent — not cleared once the event's own trigger (if any) has fired, and not scoped to feeding only one particular downstream message type.

**Acceptance Criteria**
- Classification table (non-exhaustive; full table in FSD §6.4.1):
  - `POST /quotes` (request) → **Triggers** pain.001; **also cached** (payer identity, `transactionType`, `note`) for whichever later stage needs it (currently pacs.008).
  - `PUT /quotes` (callback) → **Triggers** pain.013; **also cached** (`ChrgBr`, fees) for whichever later stage needs it (currently pacs.008).
  - `POST /fxQuotes` + `PUT /fxQuotes` → **No trigger**; **cached** (source/target amount, rate) for whichever later stage needs it (currently pain.001 and pacs.008).
  - `POST /fxTransfers` + `PUT /fxTransfers` → **No trigger**; **cached** for correlation/audit.
  - `POST /transfers` (prepare) → **Triggers** pacs.008; reads the accumulated cache from every row above.
  - `PUT /transfers` (fulfil) → **Triggers** pacs.002; reads identifiers cached by the prepare's own trigger (US-PPA-10).
  - Any error callback → **Triggers** pacs.002 with `TxSts: RJCT`.
- Every event that reaches this classification step is written to the correlation cache (US-PPA-06), regardless of whether it also triggers a message — an event triggering its own message is not exempt from also being cached for the rest of its transaction leg.
- Classification is unit-tested for every event type, including the error callback case and confirming caching happens on trigger events too.
- An event that cannot be classified (unexpected combination of `eventType` and `msgType`) is logged and dead-lettered.

**Method**
1. **Read** — `eventType` and `msgType` from the validated envelope.
2. **Look up** — the pair against the classification table to resolve two independent outcomes: does it trigger (and which message type), and what of its data is cacheable.
3. **Cache** — write the event's cacheable data into the correlation state (US-PPA-06), unconditionally — this step runs whether or not the event also triggers.
4. **Trigger if applicable** — route to the matching translation story (US-PPA-08/09/10/11) if the event triggers a message.
5. **Dead-letter unknown combinations** — anything not matching a known row is logged and dead-lettered.

**Assumptions**
- The Quote request and Quote callback are independent triggers, not two halves of a paired event. PPA does not wait for the callback before emitting pain.001 — pain.001 fires the moment the request lands.
- FX Quote data enriches the pain.001 trigger as `EqvtAmt`/`XchgRateInf` — it does not produce its own Tazama message, but is still cached like any other event.
- `msgType` is `request` or `callback`, derived by MLA from the leg's HTTP method (POST → `request`, PUT/PATCH → `callback`) — resolved in `cch-mla-user-stories.md` (US-MLA-04, R-03). This classification table can rely on it.

**Todos**
1. Implement the classification-table lookup, resolving trigger-type and cache-content as two independent outcomes.
2. Wire the unconditional cache write ahead of routing to any trigger story.
3. Wire routing to the correct downstream translation story for events that trigger.
4. Write tests (Jest, 95% coverage target) covering every row of the classification table, confirming trigger events are also cached, plus the unclassifiable-combination dead-letter path.

---

#### US-PPA-06 — Accumulate Cacheable Data into the Correlation Cache

**Description**
For every event that reaches this step — whether or not it also triggers its own Tazama message — PPA merges the event's cacheable data into the shared transaction-state entry in ValKey, keyed by the appropriate transaction/quote/conversion ID. A Quote request or callback triggering pain.001/pain.013 is cached here exactly like an FX Quote event that triggers nothing; being a trigger does not exempt an event from also being cached for the rest of its transaction leg. This must be an atomic read-modify-write because multiple PPA replicas may process related events concurrently.

**Acceptance Criteria**
- Cache writes use an atomic read-modify-write on ValKey (e.g. a Lua-scripted compare-and-merge). A plain read-then-write from two concurrent replicas is not acceptable — it silently loses one side's update.
- Cache keys by event type: QUOTE → `quoteId`; FXQUOTE → `conversionRequestId`; TRANSFER → `transferId`; FXTRANSFER → `commitRequestId`.
- The transaction-level key (`transactionId` / `transferId`) accumulates cached data from all stages concurrently, not just from one stage — including from stages that also triggered their own Tazama message.
- If ValKey is unreachable at cache-write time, PPA returns HTTP 503 to MLA (as per step 1 — ValKey was checked before acknowledging, so this should not occur; if it does anyway, it is a hard-stop: log, alert, do not silently proceed without caching).
- Cache entries carry an explicit TTL (not indefinite). TTL must account for MLA ingestion delay under Kafka lag — not derived from the Mojaloop expiration field alone (see FSD §9.3).
- Cached state is retained until the terminal message for the transaction has been sent to TMS (step 9), not cleared after each individual stage, and not cleared just because the event that produced it also fired its own trigger.

**Method**
1. **Resolve the cache key** — quoteId / conversionRequestId / transferId / commitRequestId, per the event's type.
2. **Merge atomically** — perform a Lua-scripted compare-and-merge against ValKey with that key, never a plain read-then-write. This runs for every event, trigger or not.
3. **Set the TTL** — per FSD §9.3's formula, accounting for MLA ingestion delay under Kafka lag.
4. **Retain** — keep the merged state until the transaction's terminal message has been sent, not clearing after each stage.

**Assumptions**
- ValKey is configured with `volatile-lru` eviction (every correlation key has an explicit TTL). Silent eviction under memory pressure is caught by a dedicated alert on ValKey memory pressure.
- ValKey must run as a highly-available cluster; this is a release-blocking NFR.

**Todos**
1. Implement the atomic read-modify-write against ValKey, applied uniformly regardless of whether the event also triggers.
2. Implement TTL calculation per FSD §9.3.
3. Wire the hard-stop 503 path for a ValKey-unreachable condition at this step.
4. Write tests (Jest, 95% coverage target) covering: concurrent-replica merge correctness for both trigger and non-trigger events, TTL expiry, and the ValKey-unreachable hard-stop.

---

#### US-PPA-07 — Discriminate Domestic vs. Cross-Border Transfers

**Description**
For TRANSFER **[and FXTRANSFER — see R-21 below]** trigger events, PPA must determine whether the payment is cross-border (in scope, Phase 1) or domestic (out of scope, Phase 1) before assembling a Tazama message. A transfer with no correlated FX-quote state and no FX linkage field (`determiningTransferId`) is domestic and must be discarded silently.

**Acceptance Criteria**
- At trigger classification time for TRANSFER events: if no FX-quote state is found in the correlation cache AND the event body carries no `determiningTransferId` field, the transfer is classified as domestic.
- Domestic transfers are discarded: no TMS message emitted, no DLQ entry, no alert. A counter metric is incremented (for operational visibility).
- Cross-border transfers (FX-quote state present OR `determiningTransferId` present) proceed to translation.
- Unit tests cover: clear cross-border (FX state present), clear domestic (no FX state, no linkage field), and the race-condition case where FX state is absent at trigger time but `determiningTransferId` is present.

**Method**
1. **Check FX state** — look up the correlation cache for FX-quote state for this transaction.
2. **Check the linkage field** — inspect the event body for `determiningTransferId`.
3. **Classify** — domestic only if both are absent; cross-border otherwise.
4. **Discard or proceed** — silently discard domestic transfers (counter metric only, no DLQ, no alert); proceed cross-border transfers to translation.

**Assumptions**
- Phase 1 scope is cross-border P2P only. Domestic P2P is deliberately excluded — this is not an error condition.
- The presence of `determiningTransferId` in the transfer prepare body is sufficient to establish FX linkage, even if the FX quote data hasn't been cached yet (e.g. due to a race). In that case, the pacs.008 emitted will be degraded (missing FX enrichment) but is still in-scope and must be sent.

**Todos**
1. Implement the FX-state-and-linkage-field check.
2. Implement the silent-discard path with the counter metric.
3. Write tests (Jest, 95% coverage target) covering: clear cross-border, clear domestic, and the FX-state-absent-but-linkage-present race.
4. Resolve whether FXTRANSFER should reach this discriminator at all (R-21).

---

### Epic 8 — PPA: ISO 20022 Translation

#### US-PPA-08 — Translate Quote Request to pain.001.001.11

**Description**
When a Quote request (`POST /quotes`) arrives, PPA assembles a `pain.001.001.11` message for Tazama. The message is built from the quote request payload plus already-cached FX-quote enrichment (if present). This is one of four messages sent per cross-border payment. Triggering pain.001 does not exempt this event from also being cached (US-PPA-06) — its payer identity, `transactionType`, and `note` are needed later by the pacs.008 (US-PPA-10), exactly as the Quote callback's fees data is cached for the same purpose (US-PPA-09).

**Acceptance Criteria**
- The assembled `pain.001` includes: payer identity (partyIdInfo, name from `personalInfo.complexName`, DOB from `personalInfo.dateOfBirth`) → `Dbtr`/`InitgPty`; payment amount and type → `Amt.InstdAmt`; FX-quote sourceAmount/targetAmount (if cached) → `Amt.EqvtAmt.{Amt, CcyOfTrf, XchgRateInf}`; `quoteId` → `PmtInfId`; `transactionId` → `PmtId.EndToEndId`. **See R-13 below — `Amt.InstdAmt`'s correct source is unconfirmed for `amountType: RECEIVE`. See R-20 — `PmtId` should be stated to carry no `InstrId` on this message.**
- `Cdtr.Nm` falls back to the payee's MSISDN (from `payee.partyIdInfo.partyIdentifier`) when a named payee display field is unavailable. This is a known gap (FSD Open Item #4) — the fallback is correct behaviour, not a bug.
- The assembled message is validated against a pinned local copy of Tazama's `pain.001.json` ajv schema before sending (see US-PPA-12 — **not US-PPA-13, see R-15 below**). A local validation failure dead-letters the event — it is not sent to TMS.
- `GrpHdr.MsgId` is PPA-generated (ULID), pinned at first assembly and reused on retries.
- `GrpHdr.CreDtTm` is the PPA's timestamp at first assembly, also pinned.
- The assembled message passes Tazama's schema validation with no fields stripped (validated against the same schema TMS uses, with `removeAdditional: 'all'`).
- The quote request's `transactionType` is the authoritative source for `Purp.Cd` — **not** any copy in a decoded ILP packet **(this sentence is misplaced here — the quote request carries no ILP packet; see R-19 below, this rule belongs on US-PPA-10 only)**.
- The quote request's payer identity (`personalInfo.complexName`, DOB), `transactionType`, and `note` are cached into the correlation state for whichever later stage of this transaction leg needs them (currently pacs.008, US-PPA-10) — emitting pain.001 and caching happen in the same processing step, not in separate passes, mirroring US-PPA-09's pattern for the callback side.

**Method**
1. **Read** — the quote request payload plus any already-cached FX-quote enrichment.
2. **Map fields** — payer identity, amount, `EqvtAmt`/`XchgRateInf` (if cached), `quoteId`, `transactionId`, per the sourcing rules above.
3. **Generate and pin** — `GrpHdr.MsgId` and `CreDtTm` at first assembly, reused on retries.
4. **Cache for later stages** — write payer identity, `transactionType`, and `note` into correlation state in the same step as emitting pain.001, not a separate pass.
5. **Validate locally** — against the pinned `pain.001.json` schema (US-PPA-12) before sending.
6. **Send** — to TMS (US-PPA-13) only once local validation passes.

**Assumptions**
- FX-quote enrichment is read from the correlation cache at trigger time; if absent, `EqvtAmt`/`XchgRateInf` are omitted from pain.001 (this is expected and not a degraded case when no FX leg exists, but must be flagged in the audit log if `determiningTransferId` is present and FX data is absent).
- ALS / party lookup never publishes to Kafka. Payee name is not sourced from a `PUT /parties` event. This is confirmed.

**Todos**
1. Implement the pain.001 field-mapping and generation logic.
2. Implement the payee-name-to-MSISDN fallback (FSD Open Item #4).
3. Wire local schema validation ahead of send, referencing US-PPA-12 — not US-PPA-13 (R-15).
4. Implement the same-step cache write feeding whichever later stage needs it (currently US-PPA-10's pacs.008), mirroring US-PPA-09.
5. Write tests (Jest, 95% coverage target) covering the full field mapping, the MSISDN fallback, the cache write, and a local-validation failure path.
6. Move the misplaced ILP-authority sentence to US-PPA-10 (R-19); add the missing `PmtId.InstrId`-absence note (R-20).

---

#### US-PPA-09 — Translate Quote Callback to pain.013.001.09

**Description**
When a Quote callback (`PUT /quotes`) arrives as a trigger, PPA assembles a `pain.013.001.09` message. This is the second of the four per-payment Tazama messages. It fires independently of pain.001 — PPA does not wait for any pairing.

**Acceptance Criteria**
- The assembled `pain.013` includes: `payeeReceiveAmount`, `payeeFspFee`, `payeeFspCommission` → `CdtTrfTxInf.SplmtryData.Envlp.Doc.{PyeeRcvAmt, PyeeFinSvcsPrvdrFee, PyeeFinSvcsPrvdrComssn}`; `ChrgBr` (from callback, e.g. `CRED`) → `ChrgBr`; quote `expiration` → `PmtInf.XpryDt.DtTm`.
- `GrpHdr.MsgId` is **always PPA-generated** (ULID) — it is never copied from the callback's `extensionList` (even if the Mojaloop wire carries a `GrpHdr.MsgId` extension key). This is a deliberate deviation from the Mojaloop field-mapping reference.
- `XchgRateInf` does not appear in pain.013 (no such element in Tazama's schema). Attempting to include it results in silent field stripping by TMS's `removeAdditional`. The field is correctly absent.
- The assembled message is locally schema-validated before sending.
- The Quote callback's `ChrgBr` and fees data are separately cached into the correlation state for whichever later stage of this transaction leg needs them (currently pacs.008) — emitting pain.013 and caching happen in the same trigger-processing step, not in separate passes.
- **Missing: the explicit timeout-log and dual-flag behaviour FSD §6.4.6 requires when a quote callback never arrives — see R-32 below. Missing: the explicit "pain.013 is never synthesized" prohibition — see R-04 below.**

**Method**
1. **Read** — the quote callback payload.
2. **Map fields** — fees, `ChrgBr`, `expiration`, per the sourcing rules above.
3. **Generate** — `GrpHdr.MsgId` (PPA-generated, never copied from the wire).
4. **Cache for later stages** — write `ChrgBr` and fees data into correlation state in the same step as emitting pain.013, not a separate pass.
5. **Validate and send** — locally schema-validate, then send to TMS.

**Assumptions**
- pain.013 is independent of pain.001 in terms of sequencing. If the quote callback arrives before pain.001 has been sent (e.g. extreme out-of-order delivery), pain.013 is still assembled and sent from the callback event alone. No dependency on pain.001's completion.

**Todos**
1. Implement the pain.013 field-mapping and generation logic.
2. Implement the same-step cache write feeding whichever later stage needs it (currently US-PPA-10's pacs.008).
3. Write tests (Jest, 95% coverage target) covering the field mapping and the cache write.
4. Add the FSD §6.4.6 timeout-log/dual-flag behaviour and the "never synthesize pain.013" prohibition (R-32, R-04).

---

#### US-PPA-10 — Translate Transfer Prepare to pacs.008.001.10

**Description**
When a Transfer prepare (`POST /transfers`) arrives as a trigger, PPA assembles a `pacs.008.001.10` message from the prepare event plus cached enrichment from up to five prior messages (FX quote request/callback, quote request/callback, party data). This is the third per-payment Tazama message. The prepare event alone triggers the pacs.008 — PPA does not wait for the fulfil.

**Acceptance Criteria**
- The assembled `pacs.008` sources fields as follows (normative per FSD §6.4.3):
  - Transfer PREPARE: `transferId` → `PmtId.InstrId`; decoded ILP `transactionId` → `PmtId.EndToEndId`; decoded ILP packet payee `partyIdInfo`/extensionList → `Cdtr`/`CdtrAcct` identifiers; `amount` → `IntrBkSttlmAmt`; `payerFsp`/`payeeFsp` → `DbtrAgt`/`CdtrAgt`; expiration → `SplmtryData.Envlp.Doc.Xprtn`.
  - Cached Quote request: `personalInfo.complexName` → `Dbtr.Nm`/`InitgPty.Nm`; `dateOfBirth` → `Dbtr.DtAndPlcOfBirth.BirthDt`; `name` → `DbtrAcct.Nm`; `transactionType` → `Purp.Cd`; `note` → `RmtInf.Ustrd`.
  - Cached Quote callback: `ChrgBr` → `ChrgBr`; `payeeFspFee` → `ChrgsInf`; `SttlmMtd` → `GrpHdr.SttlmInf.SttlmMtd`.
  - Cached FX Quote: `sourceAmount` → `InstdAmt`; derived exchange rate → `XchgRate`.
  - PPA-generated: `GrpHdr.MsgId` (ULID, pinned); `GrpHdr.CreDtTm` (pinned); `RgltryRptg` (constant: BALANCE OF PAYMENTS / 100); `SplmtryData.Envlp.Doc.InitgPty.Glctn` (sentinel: 0,0).
- The ILP packet is decoded (base64url → ILP v4 → embedded JSON) to extract `transactionId`. The decoded packet's `transactionType.initiatorType` is advisory only — the quote request's `transactionType` is authoritative for `Purp.Cd`. Any discrepancy between the two copies is logged.
- Degraded fields (when enrichment state is missing) fall back per FSD §6.4.3's degraded table (e.g. payee name → payee MSISDN). The pacs.008 is flagged as degraded in the audit log when any fallback is applied. **Should also cover the specific "quote callback never arrived" dual-flag case — see R-32 below.**
- Payee `Cdtr.BirthDt` is set to sentinel `1900-01-01` (no source exists in any Mojaloop message). `CityOfBirth` = "Unknown", `CtryOfBirth` = "ZZ" on both parties.
- Agent identifiers use `FinInstnId.ClrSysMmbId.MmbId`, **not** `FinInstnId.Othr.Id` (Mojaloop's own extension keys use `Othr.Id` — these must not be copied through unmodified).
- After the pacs.008 is sent successfully, PPA writes `transferId → { InstrId, EndToEndId }` into the correlation state for pacs.002's identifier resolution (US-PPA-11).
- `GrpHdr.NbOfTxs` = 1 on every message.
- **Missing: a regression-style AC asserting `EndToEndId`/`Dbtr`/`Cdtr`/`DbtrAcct`/`CdtrAcct` are all present on every non-degraded output — see R-35 below.**

**Method**
1. **Decode the ILP packet** — base64url → ILP v4 → embedded JSON, to extract `transactionId`.
2. **Read cached enrichment** — Quote request/callback and FX-quote state from the correlation cache.
3. **Map fields** — per the sourcing table above, including PPA-generated constants and sentinels.
4. **Apply degraded fallbacks** — per FSD §6.4.3's degraded table where enrichment is missing, flagging the output as degraded.
5. **Validate and send** — locally schema-validate (US-PPA-12), then send to TMS (US-PPA-13).
6. **Write correlation state** — on successful send, write `transferId → { InstrId, EndToEndId }` for US-PPA-11's identifier resolution.

**Assumptions**
- The ILP packet is carried in cleartext in the event body (after MLA's base64 decode). PPA does not need to decrypt it — ILP v4 packet decoding is a structural operation (base64url → BER → JSON), not a cryptographic one.
- Sentinel constants (`Glctn 0,0`, `RgltryRptg`) mean fraud rules must not be configured against payee age, geolocation, or geographic velocity for cross-border traffic — this constraint must be communicated to whoever configures Tazama's rule processors.

**Todos**
1. Implement the ILP decode and field-mapping logic.
2. Add `Cdtr`/`CdtrAcct` sourcing from the decoded ILP packet's payee identity (R-30).
3. Implement the degraded-fallback table and its audit-log flagging.
4. Write tests (Jest, 95% coverage target) covering the full mapping, the ILP decode, degraded fallbacks, and the post-send correlation-state write.
5. Add the regression AC asserting `EndToEndId`/`Dbtr`/`Cdtr`/`DbtrAcct`/`CdtrAcct` presence on every non-degraded output (R-35).
6. Extend degraded-flagging to cover the "quote callback never arrived" dual-flag case (R-32).

---

#### US-PPA-11 — Translate Final-State Event to pacs.002.001.12

**Description**
When the fulfil callback (`PUT /transfers`) arrives as a trigger, PPA assembles a `pacs.002.001.12` message. This is the fourth per-payment Tazama message. For error callbacks (any resource), PPA also emits pacs.002 with `TxSts: RJCT`.

**Acceptance Criteria**
- The assembled `pacs.002` includes: `transferState` translated to ISO `TxSts` (COMMITTED → ACSC, ABORTED → RJCT, RESERVED → ACSP); `completedTimestamp` → `AccptncDtTm`; `fspiop-source`/`fspiop-destination` headers → `InstgAgt`/`InstdAgt`; `transferId → { InstrId, EndToEndId }` resolved from cached state (§6.4.5) → `OrgnlInstrId`/`OrgnlEndToEndId`; cached `payeeFspFee` → `ChrgsInf`.
- `TxSts` uses `ACSC`, not `ACCC` — `COMMITTED` confirms settlement between schemes, not final credit to the payee's account.
- `OrgnlInstrId` and `OrgnlEndToEndId` must exactly match `PmtId.InstrId` and `PmtId.EndToEndId` on the corresponding pacs.008. Mismatched identifiers cause TMS to silently accept the pacs.002 but never link it to its transfer in Tazama's graph.
- PPA does not assume `transactionId` == `transferId` — it always resolves `EndToEndId` from the cached mapping written after the pacs.008 was sent (US-PPA-10).
- For error callbacks: `TxSts` = RJCT; `ChrgsInf` = []. Error code and description are logged in the audit log only (Tazama's pacs.002 interface has no `StsRsnInf` field — attempting to include it causes silent stripping by `removeAdditional`).
- `GrpHdr.MsgId` is PPA-generated (ULID, pinned). It is never copied from the fulfil's `extensionList.GrpHdr.MsgId` extension key, even if that key is present on the wire. **FSD §6.4.3's own provenance table contradicts this rule — see R-11 below. The story follows the correct clause (§6.5.4); no change needed here, the fix is owed to the FSD.**
- **Missing: the explicit "never synthesize a pacs.002" prohibition — see R-04 below.**

**Method**
1. **Read** — the fulfil callback (or error callback) event.
2. **Resolve identifiers** — `OrgnlInstrId`/`OrgnlEndToEndId` from the correlation state US-PPA-10 wrote after sending pacs.008.
3. **Translate status** — `transferState` to ISO `TxSts` (COMMITTED → ACSC, ABORTED → RJCT, RESERVED → ACSP; error callbacks → RJCT).
4. **Generate** — `GrpHdr.MsgId` (PPA-generated, never copied from the wire).
5. **Validate and send** — locally schema-validate, then send to TMS.

**Assumptions**
- FSD Open Item #5 (whether the Central Ledger notification carries `fspiop-source`/`fspiop-destination`) is closed: per the Kafka evidence in `cch-notification-dedup-user-stories.md`, the fulfil callback is the only trigger this design ever sees — no switchable dual-source logic is needed.
- `TxSts` is an unconstrained string in Tazama's real schema — an untranslated `"COMMITTED"` would be silently accepted but would break every downstream rule testing for a real ISO status code. The translation is a correctness requirement, not a validation one.
- **§8.2's Rejected Payment scenario is split between this story and US-PPA-16 with no single dedicated end-to-end story — see R-34 below.**

**Todos**
1. Implement the pacs.002 field-mapping and `TxSts` translation.
2. Implement the identifier-resolution lookup against the cached pacs.008 mapping.
3. Write tests (Jest, 95% coverage target) covering `COMMITTED`/`ABORTED`/`RESERVED` translation, the error-callback RJCT path, and identifier-mismatch detection.
4. Add the "never synthesize a pacs.002" prohibition (R-04).
5. Consider folding this story together with US-PPA-16 into a single Rejected Payment story (R-34).

---

### Epic 9 — PPA: Schema Validation & TMS Dispatch

#### US-PPA-12 — Validate Assembled Message Against Pinned Local Schema Before Send

**Description**
Before sending any message to TMS, PPA validates the assembled message against a pinned local copy of Tazama's ajv schema for that message type. This catches field-level drift from the pinned `tms-service` version before `removeAdditional: 'all'` on TMS silently strips the offending fields and returns a false HTTP 200.

**Acceptance Criteria**
- PPA maintains pinned local copies of Tazama's JSON schemas for all four message types: `pain.001.json`, `pain.013.json`, and the pacs.008/pacs.002 schemas.
- Every assembled message is validated against the appropriate pinned schema before the TMS POST is issued.
- A local validation failure is treated as a translate-time defect: logged, alert raised, event written to PPA's DLQ. The message is **not** sent to TMS.
- The pinned schema files are version-controlled alongside the PPA codebase and track the same `tms-service` commit pinned in the FSD.
- Updating the pinned schema (e.g. for a TMS upgrade) requires an explicit, reviewed commit — not an automatic pull on startup.
- Integration tests validate each of the four message types' assembled outputs against the pinned schemas.
- Every assembled pacs.008 is checked for field completeness before send: `EndToEndId`, `Dbtr`, `Cdtr`, `DbtrAcct`, and `CdtrAcct` must all be present on every non-degraded output. This regression check exists specifically to catch a field-sourcing omission the way local schema validation alone would not — schema validation confirms shape, not that a required identity field was actually populated.

**Method**
1. **Maintain** — pinned local copies of the four ajv schemas (`pain.001.json`, `pain.013.json`, pacs.008, pacs.002).
2. **Validate** — every assembled message against its appropriate pinned schema before the TMS POST is issued.
3. **Check pacs.008 field completeness** — confirm `EndToEndId`/`Dbtr`/`Cdtr`/`DbtrAcct`/`CdtrAcct` are all present on every non-degraded pacs.008, as a dedicated regression check alongside schema validation.
4. **Dead-letter on failure** — log, alert, and write to the DLQ instead of sending.
5. **Update deliberately** — pinned schemas are updated only via an explicit, reviewed commit, never an automatic pull on startup.

**Assumptions**
- The pinned commit for the `tms-service` schemas is identified and documented before implementation begins. The FSD defers this to a named pin (Open Item in §6.5.2).
- Local schema validation runs the same ajv configuration TMS uses (including `removeAdditional: 'all'`). Using a different ajv config for local validation would defeat the purpose.

**Todos**
1. Implement the pinned-schema validation step for all four message types.
2. Implement the pacs.008 field-completeness regression check (R-35).
3. Wire the DLQ/alert path for a local validation or field-completeness failure.
4. Write integration tests validating each message type's assembled output against its pinned schema, plus the field-completeness check against both a fully-populated and a degraded pacs.008.
5. Document the pinned `tms-service` commit before implementation begins.

---

#### US-PPA-13 — Send Validated Messages to Tazama TMS

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
- After N consecutive TMS failures across messages (5xx/timeout, N configurable), the PPA→TMS circuit breaker trips. While tripped, PPA stops attempting new sends to TMS and signals back-pressure upstream: the same per-request reachability gate US-PPA-02 already uses for ValKey/write-ahead-store unreachability also returns 503 to MLA while the breaker is open, so MLA's Kafka offset pauses and the audit topic's own retention buffers the backlog — rather than every new event burning a full 3-attempt retry cycle before landing in the DLQ.
- The breaker re-probes TMS health on a configurable interval and resumes normal dispatch once a probe succeeds.
- The breaker's state (open/closed/half-open) is exposed as a metric, consistent with what US-MON-01 (in `cch-crosscutting-user-stories.md`) already expects to monitor here.
- Events already mid-retry when the breaker trips run their own retry budget to completion (dead-letter on exhaustion, per the existing 5xx/4xx handling above) — the breaker governs whether *new* events are attempted, not what happens to one already in flight.

**Method**
1. **Resolve the endpoint** — the version-pinned TMS endpoint for the message's type.
2. **Attach credentials** — the mTLS client certificate and a Keycloak-issued bearer token, refreshed proactively before expiry.
3. **Send** — over HTTPS; on 5xx/timeout, retry up to 3 times with backoff and jitter, resending the exact same pinned message (same `GrpHdr.MsgId`).
4. **Fail permanently on 4xx** — dead-letter without retry.
5. **Track consecutive failures** — count failures across messages; once the configurable threshold N is reached, trip the circuit breaker.
6. **Gate new sends on trip** — while tripped, feed the breaker's open state into the per-request 503 gate (US-PPA-02) so MLA stops sending new events; do not attempt new TMS sends.
7. **Re-probe and resume** — on a configurable interval, probe TMS health; resume normal dispatch and clear the 503 gate once a probe succeeds.
8. **Resolve on success** — clear ValKey state (only once the terminal message for the transaction has been sent) and update the write-ahead record.

**Assumptions**
- The Auth-lib, Auth-service, and Keycloak are runtime dependencies of PPA. Their unavailability directly affects PPA's ability to deliver to TMS. Token refresh failure must be separately alerted (§9.4) so an operator is paged before the failure cascades.
- The Keycloak token has a finite TTL. PPA must refresh it proactively before expiry, not reactively after the first 401.
- **The timeout/retry values themselves are unconfirmed — FSD Open Item #1 — see R-31 in `cch-mla-user-stories.md`.**
- Gating the per-request ack on breaker state (rather than failing the `/health/ready` endpoint) is deliberate, mirroring the ValKey precedent in US-PPA-02: it back-pressures MLA per-partition without pulling a healthy PPA replica out of load-balancer rotation over a shared downstream dependency.

**Todos**
1. Implement the version-pinned dispatch logic and the mTLS + bearer-token attachment.
2. Implement the retry/backoff/jitter policy, reusing the pinned message and `MsgId` on every retry.
3. Implement the PPA→TMS circuit-breaker state machine (trip, re-probe, resume) with a configurable threshold and interval.
4. Wire the breaker's open state into US-PPA-02's per-request 503 gate.
5. Expose the breaker state as a metric per US-MON-01.
6. Write tests (Jest, 95% coverage target) covering: successful send, 5xx retry reusing the same `MsgId`, 4xx dead-letter, retry exhaustion, circuit-breaker trip/resume, and the 503 gate activating/clearing with the breaker state.
5. Confirm the timeout/retry budget values with CCH (FSD Open Item #1, R-31).

---

### Epic 10 — PPA: Error Recovery, DLQ & Missing Correlations

#### US-PPA-15 — Dead-Letter Queue: Write, Alert, and Support Replay

**Description**
PPA's DLQ is the same store as its write-ahead record (one store, two write paths). Every DLQ write raises an operations alert. Replay is manual and operator-triggered, re-injecting an entry from the point it failed. Every replay is audit-logged.

**Acceptance Criteria**
- Events written to the DLQ include the full envelope (PII-masked per §10.3), the failure reason, retry count, timestamp, the `correlationId`, and the `isoMessageType` where applicable.
- Every DLQ write immediately raises an operations alert (alerting destination/tooling is tracked separately as an open item).
- DLQ entries have a 90-day retention period, after which they are purged or archived per CCH compliance policy.
- Replay is operator-triggered only (no auto-replay). A replay re-injects the entry into the pipeline from the step it failed, without requiring a fresh Kafka event.
- Every replay writes its own audit log entry, including a `replay-of` pointer to the original entry.
- PII fields in the DLQ are in their already-tokenized/protected form (tokenization happens upstream of MLA; by the time an event reaches PPA's DLQ, applicable fields are already protected per §10.3's narrowed scope).

**Method**
1. **Write** — on dead-letter, write the full (masked) envelope plus failure reason, retry count, timestamp, `correlationId`, and `isoMessageType` to the DLQ.
2. **Alert** — raise an operations alert immediately on write.
3. **Replay on request** — an operator-triggered replay re-injects the entry from the step it failed, writing its own `replay-of` audit entry.
4. **Retire** — purge or archive entries after the 90-day retention period.

**Assumptions**
- DLQ entries for transactions that PPA proactively parks before a ValKey TTL expiry (US-PPA-16) are not terminal records — they are live recovery state. The operator tooling for replay must make this distinction visible.
- Alerting destination (Slack, PagerDuty, email) is determined during infrastructure setup — see US-MON-01 in `cch-crosscutting-user-stories.md` (R-37).

**Todos**
1. Implement the DLQ write schema and the alert trigger.
2. Implement operator-triggered replay, including the `replay-of` audit pointer.
3. Implement the 90-day retention/purge policy.
4. Write tests (Jest, 95% coverage target) covering DLQ write completeness, replay re-injection, and retention expiry.

---

#### US-PPA-16 — Park Correlation State Before ValKey TTL Expiry

**Description**
When a leg's ValKey correlation state is at risk of expiring before its expected counterpart event has arrived (e.g. the fulfil/final-state callback that never came), PPA writes the accumulated state to its DLQ/write-ahead store before the TTL lapses. If the late event eventually arrives — even days later — PPA retrieves the parked state and completes correlation from the durable store rather than treating the arrival as unresolvable.

**Acceptance Criteria**
- PPA monitors correlation TTL expiry for legs that are in-progress (pacs.008 sent, pacs.002 not yet sent). Before expiry, PPA writes the full accumulated leg state to its DLQ.
- If the pacs.002-triggering event arrives after the ValKey TTL has lapsed, PPA checks the DLQ/write-ahead store for a parked entry for that `transferId` before giving up.
- If found in the DLQ, PPA retrieves the parked state, resolves `OrgnlInstrId`/`OrgnlEndToEndId` from it (US-PPA-11), assembles, and emits the pacs.002.
- The effective correlation lifetime extends to the DLQ's 90-day retention (not just ValKey's short TTL).
- A pacs.002-triggering event for a `transferId` not found in ValKey or the DLQ is logged and alerted — it is not forwarded to TMS without identity resolution. **Should explicitly name the "error callback, no cached transaction" scenario as its own unit test — see R-33 below. Should also state the "never synthesize a pacs.002" prohibition explicitly — see R-04 below.**
- Parking a state to the DLQ does not raise the same alert as a true dead-letter (failure). It raises a distinct informational alert (e.g. "correlation TTL approaching, parking state for `transferId` X").

**Method**
1. **Monitor** — correlation TTL expiry for in-progress legs (pacs.008 sent, pacs.002 not yet sent).
2. **Park before expiry** — write the full accumulated leg state to the DLQ, raising the distinct informational alert, not a failure alert.
3. **Check on late arrival** — if a pacs.002-triggering event arrives after the ValKey TTL has lapsed, check the DLQ for a parked entry by `transferId` before giving up.
4. **Resume or give up** — if found, retrieve, resolve identifiers, assemble, and emit the pacs.002; if not found anywhere, log and alert without forwarding to TMS.

**Assumptions**
- This mechanism covers the case where PPA was running but the final-state event simply never arrived in time. It does not cover the case where PPA itself was down long enough that it never got to park anything — that residual scenario is Open Item #9 in the FSD and needs separate handling confirmed with Paysys.
- The DLQ store must support keyed retrieval by `transferId` (not just sequential scan). Technology selection must account for this query pattern.
- **§8.2's Rejected Payment scenario is split between this story and US-PPA-11 with no single dedicated end-to-end story — see R-34 below.**

**Todos**
1. Implement TTL-expiry monitoring and the pre-expiry park write.
2. Implement the late-arrival DLQ lookup and resume-correlation path.
3. Write tests (Jest, 95% coverage target) covering: park-before-expiry, a late arrival found in the DLQ, the "error callback, no cached transaction" case named explicitly (R-33), and the never-synthesize prohibition (R-04).
4. Consider folding this story together with US-PPA-11 into a single Rejected Payment story (R-34).

---

#### US-PPA-17 — Handle Out-of-Order Arrival (Fulfil Before Prepare)

**Description**
Because the transfer prepare and fulfil are on different Kafka topics and processed by PPA replicas asynchronously, the fulfil's pacs.002 trigger may arrive at PPA before the prepare's pacs.008 trigger. PPA must park the fulfil within a short bounded window and retry rather than discarding it. **⚠️ The "different Kafka topics" reasoning here describes the pre-audit-topic architecture. See R-29 below — the underlying race is still real, but for a different reason.**

**Acceptance Criteria**
- If a pacs.002 trigger event (the fulfil callback) arrives and no transaction state exists for its `transferId` in ValKey or the DLQ, PPA does not immediately dead-letter it.
- PPA holds the event and retries within a short, bounded window — reusing the existing retry budget (§6.7), not a separate mechanism.
- After the bounded window, if the prepare's state still hasn't arrived, the event is dead-lettered to the DLQ and alerted.
- If the prepare's pacs.008 is processed after the fulfil has already been dead-lettered, PPA retrieves the parked fulfil from the DLQ and completes correlation from there (the DLQ is not a terminal record in this case — it is where the pending fulfil state waits).
- The park-and-retry logic is unit-tested with a simulated fulfil-before-prepare race condition.

**Method**
1. **Detect** — a pacs.002 trigger event arrives with no matching transaction state in ValKey or the DLQ.
2. **Hold, don't dead-letter** — retry the lookup within a short, bounded window, reusing the existing retry budget (§6.7).
3. **Dead-letter on timeout** — if the prepare's state still hasn't arrived after the window, dead-letter and alert.
4. **Reconcile on late prepare** — if the prepare's pacs.008 is processed after the fulfil was already dead-lettered, retrieve the parked fulfil from the DLQ and complete correlation from there.

**Assumptions**
- The prepare-to-fulfil gap in normal operation is under 1 second (per §7's corridor capture). The retry window should be calibrated with this in mind, but must also account for MLA backlog scenarios where the gap widens.
- This is a real and likely race condition, not a remote edge case — **but per R-29 below, the actual cause is PPA's async-ack-then-process model across horizontally-scaled replicas, plus an unconfirmed audit-topic partition key, not "different Kafka topics."**

**Todos**
1. Implement the hold-and-retry logic for the bounded window.
2. Implement the late-prepare-retrieves-parked-fulfil path.
3. Write tests (Jest, 95% coverage target) simulating the fulfil-before-prepare race.
4. Update this story's rationale to the audit-topic architecture and confirm the partition key (R-29).

---

## Review Findings

| # | Finding | Sev | Status |
| --- | --- | --- | --- |
| R-01 | US-PPA-05 states trigger/enrichment as mutually exclusive; US-PPA-06 only caches *enrichment* events. Quote-stage data (`Dbtr.Nm`, `ChrgBr`, etc.) never reaches the cache US-PPA-10 depends on → every pacs.008 emitted degraded, silently. US-PPA-08 lacks the caching criterion US-PPA-09 already has for the callback side. | **Critical** | **Resolved** — US-PPA-05 now classifies trigger-status and cache-status as independent properties; US-PPA-06 accumulates from every event regardless of trigger status; US-PPA-08 now carries the same caching criterion US-PPA-09 already had. |
| R-04 | FSD's two "never synthesize" rules (no fabricated pacs.002, no fabricated pain.013) have zero acceptance criteria in US-PPA-09 or US-PPA-16. Highest-consequence rule in the spec. | **Critical** | Open |
| R-05 | FSD §9.5 requires a PPA→TMS circuit breaker; US-MON-01 monitors it; US-PPA-13 has no criterion for it at all. Trip mechanism (pausing MLA's offset indirectly via a 503) needs confirming too. | **Critical** | **Resolved** — US-PPA-13 now specifies the breaker (trip threshold, re-probe, resume) and its trip mechanism: feeding into US-PPA-02's existing per-request 503 gate, back-pressuring MLA the same way a ValKey outage already does. |
| R-30 | US-PPA-10 never states where `Cdtr`/`CdtrAcct` identifiers come from, despite FSD §6.4.3 listing them under Transfer PREPARE. Confirmed by direct re-check; a prior review's "field for field correct" verdict missed this. | **Critical** | Resolved |
| R-07 | Both candidate pacs.002 triggers listed as triggers in US-PPA-05. | *High* | **Closed** — see `cch-notification-dedup-user-stories.md`; only one candidate exists on the topic. |
| R-29 | US-PPA-17's out-of-order rationale cites the superseded per-topic architecture. Race is real but driven by PPA's async-ack-then-process model across replicas + an unconfirmed audit-topic partition key, not by prepare/fulfil sitting on different topics. | **High** | Open |
| R-11 | FSD self-contradicts on pacs.002 `GrpHdr.MsgId` provenance (§6.5.4 says always PPA-generated; §6.4.3's table says "where supplied"). US-PPA-11 correctly follows §6.5.4 — fix owed to the FSD, not the story. | **Medium** | Open |
| R-12 | Payee-name sourcing (`Cdtr.Nm`) differed between FSD and mapping data. Stories are correct; mapping data already corrected to source from payee MSISDN, not `PUT /parties`. | **Medium** | Open (mapping fixed) |
| R-13 | pain.001 `InstdAmt`: FSD sources it from the quote's own `amount`; mapping data sources it from FX quote's `sourceAmount`. Diverge outside the golden path — decision needed for `amountType: RECEIVE`. | **Medium** | Open |
| R-27 | Failure-domain relationship between the two former dedup stores. | *Medium* | **Closed — folded into R-28.** |
| R-28 | US-PPA-04's `transferId` check had no atomicity requirement, unlike US-PPA-06/US-PPA-14's equivalent checks. | **Medium** | **Resolved** — US-PPA-04 and the former US-PPA-14 are merged into a single generic, atomic check-and-set on `{id}:{isoMessageType}`, applied uniformly to every event type before translation. |
| R-32 | "Quote callback never arrives" (FSD §6.4.6) requires an explicit timeout log + dual degraded-flag (missing pain.013 *and* degraded pacs.008); no story states it. | **Medium** | Open |
| R-15 | US-PPA-08 cross-references US-PPA-13 for schema validation; should be US-PPA-12. | Low | Open |
| R-16 | "TTT" typo for TTL in the former US-PPA-14. | Low | **Resolved** — folded into the US-PPA-04/US-PPA-14 merge (R-28); the merged story's text has no typo. |
| R-19 | US-PPA-08 states an ILP-authority rule for a message that carries no ILP packet (arrives on the callback, not the request). Rule belongs on US-PPA-10 only. | Low | Open |
| R-20 | US-PPA-08 omits that `PmtId` carries no `InstrId` on pain.001 — sent, it's silently stripped by TMS. | Low | Open |
| R-21 | US-PPA-07 applies the domestic discriminator to FXTRANSFER, which per FSD §6.4.1 never reaches that classification step. | Low | Open |
| R-33 | "Error callback, no cached transaction" (FSD §6.4.6) not explicitly unit-tested in US-PPA-16 — likely subsumed generically by AC #5, but not named. | Low | Open |
| R-34 | §8.2 Rejected Payment has no single dedicated story — currently split across US-PPA-11 and US-PPA-16. | Low | Open |
| R-35 | No regression AC asserting `EndToEndId`/`Dbtr`/`Cdtr`/`DbtrAcct`/`CdtrAcct` are all present on every pacs.008 — would have caught R-30 in testing. | Low | **Resolved** — added to US-PPA-12 as a dedicated field-completeness check alongside schema validation. |

---

## Actions

| # | Action | Owner | Status |
| --- | --- | --- | --- |
| 1 | Restate US-PPA-05's classification as non-exclusive; add caching criteria to US-PPA-08; rescope US-PPA-06 (R-01) | Story author + FSD author | Closed |
| 2 | Add both "never synthesize" prohibitions to US-PPA-09 and US-PPA-16 (R-04) | Story author | Open |
| 3 | Add PPA→TMS circuit-breaker criteria to US-PPA-13; confirm trip mechanism (R-05) | Story + FSD author | Closed |
| 4 | Add `Cdtr`/`CdtrAcct` sourcing to US-PPA-10 (R-30) | Story author | Open |
| 5 | Merge US-PPA-04 and the former US-PPA-14 into one atomic, generic idempotency check (R-28) | Story author | Closed |
| 6 | Fix FSD's out-of-order rationale in §6.4.8/§9.4/§9.6 to the audit-topic architecture; update US-PPA-17; specify the audit topic's partition key (R-29) | FSD author, then story author | Open |
| 7 | Fix FSD's `GrpHdr.MsgId` self-contradiction (R-11) | FSD author | Open |
| 8 | Confirm pain.001 `InstdAmt` sourcing for RECEIVE (R-13) | FSD author + Mojaloop Partner | Open |
| 9 | Add quote-callback-timeout dual-flag criterion to US-PPA-09/10 (R-32) | Story author | Open |
| 10 | Fix schema-validation cross-reference, misplaced ILP rule, missing `PmtId.InstrId` constraint, FXTRANSFER discriminator scope (R-15, R-19, R-20, R-21) | Story author | Open |
| 11 | Name the "error callback, no cached transaction" unit test explicitly in US-PPA-16 (R-33) | Story author | Open |
| 12 | Consider a dedicated Rejected Payment story tying US-PPA-11 and US-PPA-16 together (R-34) | Story author | Open |
| 13 | Add pacs.008 field-completeness regression AC to US-PPA-12 (R-35) | Story author | Closed |

**Do first:** Actions 2 and 4 — each produces silent-wrong or self-inconsistent behaviour. (Actions 1, 3, and 5 are closed.)

---

*End of Document*

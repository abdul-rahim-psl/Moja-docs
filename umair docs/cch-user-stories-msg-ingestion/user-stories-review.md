# USER STORY REVIEW REPORT

## Message Ingestion (MLA / PPA) — Review of CCH_UserStories_MessageIngestion_v1.0

**COMESA CLEARING HOUSE × PAYSYS LABS**
_Tazama Fraud Management Module — Integration Layer_

|                    |                                              |
| ------------------ | -------------------------------------------- |
| **Document Ref**   | CCH-PL-USR-MSGING-001                        |
| **Version**        | v1.0                                         |
| **Date**           | 18th August 2026                             |
| **Reviewed Item**  | CCH-PL-US-MSGING-001 v1.0 (26 stories, 12 epics) |
| **Classification** | Confidential                                 |

---

## 1. Purpose and Scope

This report records the outcome of a field-by-field review of the Message Ingestion user stories against the Functional Specification Document they are derived from, together with the boundary and deployment documents that govern the same pipeline.

The review covers all 26 stories across all 12 epics. Each acceptance criterion and assumption was traced to its source clause. Findings fall into four classes:

- Requirements that would produce incorrect behaviour if implemented as written.
- Requirements that are internally inconsistent across the story set.
- Source-document defects the stories have inherited or exposed.
- Coverage gaps — specified behaviour with no corresponding acceptance criterion.

Out of scope: the internal design of Tazama's evaluation engine downstream of the TMS, and infrastructure sizing beyond the figures the stories themselves cite.

## 2. Documents Reviewed Against

| Role | Document | Location |
| --- | --- | --- |
| Authority for these stories | `CCH_FSD_MessageIngestion.md` V4.0 | `Design Docs/1-FSDs/3-Final/` |
| System-to-system boundary contracts | `Integration_and_Interface_Document_v4.0.md` (contents v4.2) | `Design Docs/3-TSDs/1-Draft/` |
| Deployment topology, sizing, TPS baseline | `CCH_IDD_SystemDeployment.md` v2.0 | `Design Docs/2-IDD/3-Final/` |
| Field-level mapping data | `mapping-visualizer/src/data/mappings/` | Prototype repository |
| Prior boundary drift analysis | `CCH_CrossDocFindings_MessageIngestion_v1.0.md` | This folder |

## 3. Severity Definitions

| Severity | Meaning |
| --- | --- |
| **Critical** | Implemented as written, produces incorrect behaviour that does not raise an error. Detection requires someone already knowing to look. |
| **High** | Produces incorrect behaviour, or leaves a specified behaviour undefined at a point where the wrong default is plausible. |
| **Medium** | Cross-document conflict or unresolved decision that must be settled before the affected component is built. |
| **Low** | Traceability, cross-reference, or editorial correction. No behavioural impact. |

## 4. Summary of Findings

| # | Finding | Severity | Affected Stories |
| --- | --- | --- | --- |
| R-01 | Trigger/enrichment classification stated as mutually exclusive; quote data never reaches the correlation cache | **Critical** | US-PPA-05, US-PPA-06, US-PPA-08 |
| R-02 | `NOTIFICATION` used as a fifth `eventType` value that the envelope contract does not define | **Critical** | US-MLA-02, US-MLA-04, US-PPA-03 |
| R-03 | `msgType` semantics are formally undecided; three stories build on the field | **Critical** | US-MLA-04, US-PPA-03, US-PPA-05 |
| R-04 | The two "never synthesize" prohibitions have no acceptance criteria | **Critical** | US-PPA-09, US-PPA-16 |
| R-05 | PPA→TMS circuit breaker has no acceptance criteria in any story | **Critical** | US-PPA-13, US-MON-01 |
| R-06 | Mandatory FSPIOP header check conflicts with the unresolved notification-trigger decision | **High** | US-MLA-04, US-PPA-11 |
| R-07 | Both candidate pacs.002 triggers listed as triggers; duplicate emission is masked by the dedup set | **High** | US-PPA-05, US-PPA-11 |
| R-08 | Retries-exhausted behaviour undefined between retry exhaustion and circuit-breaker trip | **High** | US-MLA-07 |
| R-29 | Out-of-order-arrival rationale describes the pre-audit-topic architecture; the FSD section it is drawn from was not fully swept | **High** | US-PPA-17 |
| R-09 | Notification Filter/Dedup deployment recorded as unconfirmed; resolved in IDD v2.0 | **Medium** | US-DEDUP-01 |
| R-10 | TPS baseline cited from a superseded IDD version and presented as a confirmed figure | **Medium** | US-PERF-01, US-PERF-02 |
| R-11 | FSD contradicts itself on pacs.002 `GrpHdr.MsgId` provenance | **Medium** | US-PPA-11 |
| R-12 | Payee-name sourcing differs between the FSD and the mapping data | **Medium** | US-PPA-08, US-PPA-09, US-PPA-10 |
| R-13 | pain.001 `InstdAmt` sourced from different messages by the FSD and the mapping data | **Medium** | US-PPA-08 |
| R-14 | FSD cites two different open-item numbers for the payee-name gap | **Low** | — |
| R-15 | Schema-validation cross-reference points to the wrong story | **Low** | US-PPA-08 |
| R-16 | Typographic error in the dedup TTL criterion | **Low** | US-PPA-14 |
| R-17 | Stated signal count does not match the acceptance criteria | **Low** | US-MON-01 |
| R-18 | Dedicated consumer group not required by any acceptance criterion | **Low** | US-MLA-01 |
| R-19 | ILP-versus-body authority rule stated on a message that carries no ILP packet | **Low** | US-PPA-08 |
| R-20 | pain.001 `PmtId` constraint omitted | **Low** | US-PPA-08 |
| R-21 | Domestic discriminator applied to an event class that never reaches it | **Low** | US-PPA-07 |
| R-22 | TLS handshake failure classified as transient without stated rationale | **Low** | US-MLA-06 |
| R-23 | Event Envelope versioning contract not covered | **Low** | — |
| R-24 | Notification Filter/Dedup threat model not covered | **Low** | US-DEDUP-01 |
| R-25 | Dedup volume reduction not reflected in capacity planning | **Low** | US-PERF-01 |
| R-26 | Scope of `topic-notification-event` not carried as an assumption | **Low** | US-DEDUP-01 |
| R-27 | Failure-domain relationship between the two notification-dedup stores is not specified | **Medium** | US-DEDUP-01, US-PPA-04 |
| R-28 | Atomicity of PPA's own notification dedup check is unspecified | **Medium** | US-PPA-04 |

---

## 5. Detailed Findings

### R-01 — Trigger/enrichment classification stated as mutually exclusive

**Severity: Critical.** Affects US-PPA-05, US-PPA-06, US-PPA-08.

FSD §6.4.1's classification table marks `POST /quotes` and `PUT /quotes` as **Trigger + Enrichment**. Each event fires its own Tazama message and, in the same processing step, contributes its data to the correlation cache for the later pacs.008. FSD §8.1's Quote Leg sequence diagram states this explicitly: `PPA->>PPA: cache payer identity for later pacs.008 enrichment`.

US-PPA-05 states the classification as mutually exclusive — "classified as either a trigger … or an enrichment" — and its classification table marks both quote events as **Trigger** only. US-PPA-06 then scopes cache writes to enrichment events alone: "For enrichment events, PPA merges the event's data into the shared transaction-state entry."

Implemented as written, no quote-stage data is ever written to the correlation cache. US-PPA-10's pacs.008 mapping depends on precisely that data: the cached Quote request supplies `Dbtr.Nm`, `DtAndPlcOfBirth.BirthDt`, `DbtrAcct.Nm`, `Purp.Cd` and `RmtInf.Ustrd`; the cached Quote callback supplies `ChrgBr`, `ChrgsInf` and `SttlmMtd`.

The consequence is that every pacs.008 is emitted in the degraded form defined by FSD §6.4.3, on every transaction. Degraded messages are structurally valid and indistinguishable from complete ones at the TMS boundary, so the only signal is the degraded-message-rate metric in US-MON-01.

US-PPA-09 already carries the dual-role criterion for the callback side. US-PPA-08 has no equivalent for the request side, so the story set is also inconsistent with itself.

**Required change.** Restate US-PPA-05's classification as non-exclusive. Add a caching criterion to US-PPA-08 mirroring the one in US-PPA-09. Rescope US-PPA-06 to cover enrichment writes performed by trigger events. FSD §6.3's pipeline table carries the same gap — step 6b specifies read-and-assemble with no corresponding write — and should be corrected at source.

### R-02 — `NOTIFICATION` used as an `eventType` value the envelope does not define

**Severity: Critical.** Affects US-MLA-02, US-MLA-04, US-PPA-03.

FSD §5.4 defines `eventType` with exactly four values — QUOTE, FXQUOTE, TRANSFER, FXTRANSFER — and the accompanying `id`-scheme table carries the same four rows.

US-PPA-03 requires `eventType` to be validated against five values, including NOTIFICATION. US-MLA-02 describes five event types. US-MLA-04's `id`-scheme criterion lists four.

The story set therefore contradicts both the FSD and itself: a PPA built to US-PPA-03 accepts a value that an MLA built to US-MLA-04 never emits.

Under the FSD's model, a final-state notification is `eventType: TRANSFER` with `msgType` carrying the notification type, keyed by `transferId`, and distinguished at the boundary by endpoint (`POST /TRANSFERS/NOTIFICATIONS`) rather than by a distinct `eventType`.

**Required change.** Confirm whether a fifth `eventType` value is intended. If it is, FSD §5.4's enumeration and its `id`-scheme table both require a fifth row specifying the identifier. If it is not, correct US-MLA-02 and US-PPA-03 to the four-value contract.

### R-03 — `msgType` semantics are formally undecided

**Severity: Critical.** Affects US-MLA-04, US-PPA-03, US-PPA-05.

The two governing documents define the same wire field differently:

| Source | Definition |
| --- | --- |
| FSD §5.4 | "Type of the original event: request, callback, or the Central Ledger notification type" |
| IID §5.2 | "HTTP method of the original event: `POST` or `PUT`" |

The IID's §5.2 disclaimer and its Open Item #22 record this as an unresolved collision requiring a joint decision by both document owners, and note that the FSD's three-value form cannot be mechanically derived from the IID's two-value form, since a Central Ledger notification is neither `POST` nor `PUT`. The same item appears as F-04 in `CCH_CrossDocFindings_MessageIngestion_v1.0.md`, classified there as the one finding requiring a decision rather than a correction.

US-MLA-04 specifies the envelope schema, US-PPA-03 validates the field, and US-PPA-05 states that classification is "deterministic based on event type and `msgType`". None of the three records that the field's meaning is undecided.

US-PPA-05's classification table is keyed on the FSD's request/callback semantics. That is the correct choice, but it is implicit — an implementer working from the IID's definition would produce an incompatible envelope.

**Required change.** Record the open decision as an assumption on US-MLA-04, and state in US-PPA-05 that its classification table depends on the FSD's request/callback/notification semantics. The decision itself must be taken jointly by the FSD and IID owners before the envelope schema is built.

### R-04 — The two "never synthesize" prohibitions have no acceptance criteria

**Severity: Critical.** Affects US-PPA-09, US-PPA-16.

FSD §6.4.6 states two prohibitions:

> **Never synthesize a pacs.002** — Tazama must not be told a payment settled on the strength of a prepare.

> **pain.013 is never sent**; there is no event left to trigger it, and nothing is synthesized in its place.

Neither rule appears as an acceptance criterion in any of the 26 stories. US-PPA-16 specifies parking accumulated state before TTL expiry and completing correlation on late arrival, but does not state the prohibition. US-PPA-09 establishes that pain.013 fires independently of pain.001, but not that it is never manufactured when the callback fails to arrive.

This is the highest-consequence rule in the specification: it separates the fraud engine correctly recording an unknown outcome from being told a payment settled when no settlement evidence exists. It is also a rule an implementer is likely to violate in good faith, by supplying a terminal message a downstream consumer appears to expect.

**Required change.** Add the pacs.002 prohibition as an explicit criterion on US-PPA-16, and the pain.013 prohibition on US-PPA-09.

### R-05 — PPA→TMS circuit breaker has no acceptance criteria

**Severity: Critical.** Affects US-PPA-13, US-MON-01.

FSD §9.5 requires a circuit breaker at both hops, with deliberately different behaviour on trip. At MLA→PPA the breaker pauses partition consumption and re-probes — specified in US-MLA-07. At PPA→TMS the breaker must "trip and fail fast … rather than continuing full retry cycles against a downstream known to be down."

US-PPA-13 specifies the retry policy, 4xx dead-lettering, and exhaustion handling, but contains no circuit-breaker criterion. US-MON-01 then requires circuit-breaker state to be exposed as a metric and alerted "at both the MLA→PPA and PPA→TMS hops" — monitoring a behaviour that no functional story defines.

A dependent point must be settled when the criterion is written. FSD §9.5 describes the tripped behaviour at this hop as pausing the audit-topic offset, but PPA does not own MLA's Kafka offset. The mechanism actually available to PPA is to stop acknowledging — returning 503 — which pauses MLA's offset indirectly through the back-pressure path already established at FSD §6.3 step 1. The acceptance criteria must state which mechanism applies.

**Required change.** Add PPA→TMS circuit-breaker criteria to US-PPA-13, and confirm the trip mechanism with the FSD owner.

### R-06 — Mandatory FSPIOP header check conflicts with the notification-trigger decision

**Severity: High.** Affects US-MLA-04, US-PPA-11.

US-MLA-04 makes `fspiop-source` and `fspiop-destination` mandatory and rejects any event missing either: "An event missing either is rejected: logged, offset advanced, not forwarded." This matches FSD §5.4.

FSD Open Item #5 records that it is unconfirmed whether the Central Ledger final-state notification carries these headers. US-PPA-11's assumption acknowledges the same open item and requires the implementation to be switchable between the notification and the fulfil callback as the pacs.002 trigger.

If the notification does not carry the headers, US-MLA-04 discards every notification event at the MLA boundary, and US-PPA-11's fallback never executes. The pacs.002 path fails at a layer that produces only a log entry, and the two stories assume opposite outcomes of the same open item.

This interacts with R-02: if a notification carries `eventType: TRANSFER`, it is subject to exactly the same mandatory validation as a transfer event.

**Required change.** Either exempt notification events from the mandatory header check pending Open Item #5, or state in US-MLA-04 that the check is contingent on that item's resolution. The two stories must record the same position.

### R-07 — Both candidate pacs.002 triggers are listed as triggers

**Severity: High.** Affects US-PPA-05, US-PPA-11.

US-PPA-05's classification table reads: "`PUT /transfers` (fulfil) or Central Ledger notification → Trigger: produces pacs.002."

FSD §6.4.7 records an open decision between exactly these two candidates, turning on whether the notification carries the FSPIOP headers. FSD §8.1's Final-State Notification diagram is explicit that the notification "Corroborates the fulfil-triggered pacs.002 … Not a second emission to TMS."

Read as inclusive, US-PPA-05 produces two pacs.002 messages per payment. US-PPA-14's sent-message dedup set, keyed on `id + isoMessageType`, would suppress the second occurrence — and by US-PPA-14's own criteria that suppression raises no alert and creates no DLQ entry. The defect would not surface in functional testing; it would surface only as an unexplained divergence between emitted and expected message counts.

**Required change.** Carry US-PPA-11's Open Item #5 caveat into US-PPA-05's classification table, and state that exactly one of the two events is the configured trigger.

### R-08 — Retries-exhausted behaviour is undefined

**Severity: High.** Affects US-MLA-07.

FSD §5.6 specifies the 5xx/timeout case in full: "If retries are exhausted, raise an alert and **pause the offset** rather than advancing it — this is a transient-failure case (PPA is down or degraded), so the event should be retried once PPA recovers, not discarded."

US-MLA-07 states that the offset is not advanced while retries are in progress, then specifies circuit-breaker behaviour after N consecutive failures. The intermediate state — this event's three retries exhausted, the breaker not yet tripped — has no stated behaviour. Advancing the offset is a plausible reading and discards the event.

**Required change.** Add the criterion. The FSD text can be carried across directly.

### R-29 — Out-of-order-arrival rationale describes the superseded per-action-topic architecture

**Severity: High.** Affects US-PPA-17. Correction owed to the FSD.

US-PPA-17's description states that the fulfil's pacs.002 trigger can arrive before the prepare's pacs.008 trigger "because the transfer prepare and fulfil are on different Kafka topics and processed by PPA replicas asynchronously." This is drawn from FSD §6.4.8, which gives the same reason in full: prepare and fulfil are "on different Kafka topics (`topic-transfer-prepare` vs. `topic-transfer-fulfil`/`topic-notification-event`, §4.4)."

Those are Mojaloop's **primary per-action topics**. Since the V4.0 audit-topic rewrite, MLA subscribes to exactly one topic — the single Mojaloop audit topic (FSD §4.4, §5.2) — and does not consume `topic-transfer-prepare`/`topic-transfer-fulfil` directly at all. The stated cause of the race describes the architecture V4.0 replaced.

This is not an isolated slip in §6.4.8. The same superseded framing appears in FSD §9.4 ("Size MLA consumer parallelism relative to the per-action topic partition counts") and §9.6 ("Size Kafka partitions per topic to the target consumer parallelism, using the per-action topic list"). It is also not an unclaimed gap: V4.0's own version history states it "swept every dependent reference across... PPA (§6.1–§6.4, §6.7)... Performance (§9.2)..." — §6.4.8 falls inside the §6.1–§6.4 range the sweep claims to cover, and still carries the pre-V4.0 topic names.

**The underlying conclusion survives, but not for the stated reason.** Out-of-order arrival remains a real and likely race under the audit-topic model — the story's park-and-retry requirement is still correct — but the mechanism is different from the one written down, and the correction changes what an implementer needs to guard against:

- A single Kafka topic still requires multiple partitions to meet the 125 TPS peak baseline (FSD §9.1). Kafka guarantees order only within a partition, never across a topic as a whole.
- Whether a given `transferId`'s prepare and fulfil events land in the same partition — the one condition that would actually preserve their relative order — depends on the audit topic's partition key, which the FSD does not specify anywhere. This is a genuine gap adjacent to, but distinct from, Open Item #7 (which concerns the audit topic preserving payload-shape identity for the FX-Transfer/domestic-Transfer discriminator, not partition-level ordering).
- Even granting same-partition, in-order delivery, PPA's own processing model breaks the guarantee independently. FSD §6.3 steps 1–2 have PPA acknowledge MLA immediately after the write-ahead persist succeeds, then process asynchronously. MLA advances its offset on that acknowledgement alone, not on PPA completing the pipeline — so MLA can hand off the prepare envelope, receive its 200, hand off the fulfil envelope next, and receive its 200, while the two envelopes' actual processing runs asynchronously behind PPA's horizontally-scaled, load-balanced fleet (FSD §4.2), which can route them to different replicas with no ordering guarantee between them.

The race is therefore driven by **PPA's async-ack-then-process model operating across horizontally-scaled replicas, compounded by an unstated partition-ordering guarantee on the audit topic** — not by prepare and fulfil arriving on different topics.

**Required change.** Correct FSD §6.4.8 (and the same phrasing in §9.4 and §9.6) to state the mechanism in terms of the audit-topic architecture: partition-level ordering within the single audit topic is unconfirmed, and PPA's async ack-then-process model across replicas removes any ordering guarantee regardless. Update US-PPA-17's description to match once the FSD is corrected, and consider adding the missing partition-key specification as a new FSD open item.

### R-09 — Notification Filter/Dedup deployment recorded as unconfirmed

**Severity: Medium.** Affects US-DEDUP-01.

US-DEDUP-01 assumes: "The component's precise deployment boundary (Mojaloop side vs. Tazama side) is unconfirmed. This must be agreed before implementation begins."

Two questions have since been settled:

- **Architectural placement** is confirmed in FSD §4.1 and §4.7 and in IID §5.1 — between the Mojaloop audit topic and MLA. The FSD closed its own Open Item #11 on this point.
- **Phase 1 deployment** is resolved in IDD v2.0 §6.8: embedded within MLA/PPA by default, carrying zero separately-provisioned containers in the baseline sizing, with standalone deployment retained as an option if measured load requires it. IID §5.1 records this as a deployment decision layered on the architecture, not a contradiction of it.

The story also lacks a sizing basis that the IDD supplies. Golden-path verification observed approximately **4.6 raw `topic-notification-event` messages per transfer** (37 notification events for 8 transfer requests). IDD v2.0 records that this ratio is a property of the notification mechanism rather than of transaction volume, and therefore does not scale with the TPS baseline.

**Required change.** Update the assumption to reflect the resolved deployment decision so that a standalone service is not provisioned. Add the observed 4.6:1 ratio as the dedup component's sizing basis.

### R-10 — TPS baseline cited from a superseded version and presented as confirmed

**Severity: Medium.** Affects US-PERF-01, US-PERF-02.

US-PERF-01 assumes: "The 25 TPS sustained / 125 TPS peak baseline is from the Infrastructure Design Document (`CCH_IDD_SystemDeployment_v1.0.md`)."

Two corrections apply. The Final-folder Infrastructure Design Document is **v2.0**; the FSD's own §9.1 carries the same superseded citation. More materially, IDD v2.0 states: "No firm TPS figure has been confirmed by CCH. The working baseline used below is **25 sustained TPS / 125 peak TPS** — a working assumption pending CCH confirmation, not a substitute for it." Confirmation is tracked as IDD Open Item #1. IID v4.1 applied the same correction to its own record for the same reason.

This matters because US-PERF-01's load-test criteria and US-PERF-02's entire ValKey sizing formula are anchored to a figure the stories treat as a given and the source treats as an assumption.

IDD v2.0 also works the ValKey sizing through at that baseline: 125 TPS peak across 4 correlated stages, 60-second TTL, 16 KiB average payload, safety factor 2, yielding approximately 60,000 concurrent entries and 2–3 GiB usable memory, with a recommended 6-node cluster at approximately 4 GiB per node. US-PERF-02 currently states the formula without a target figure.

**Required change.** Correct the version reference, restate the baseline as a working assumption pending CCH confirmation, and add the IDD's worked sizing figure to US-PERF-02 as a testable target.

### R-11 — FSD contradicts itself on pacs.002 `GrpHdr.MsgId`

**Severity: Medium.** Affects US-PPA-11. Correction owed to the FSD.

FSD §6.5.4 requires `GrpHdr.MsgId` to be "always **PPA-generated** (a new ULID), on **every** outbound message with no exception", pinned at first assembly and reused verbatim on retry. FSD §6.4.1 names pain.013's MsgId as one of exactly two intentional deviations from the field-mapping reference.

FSD §6.4.3's pacs.002 provenance table contradicts this, listing `GrpHdr.MsgId/CreDtTm` as supplied by the final-state event "where supplied".

US-PPA-11 follows §6.5.4, which is correct — it is the dedicated rule clause and it admits no exception. An implementer working from §6.4.3's provenance table would copy the trigger's MsgId, putting uniqueness outside PPA's control and defeating the `UNIQUE(MsgId, TenantId)` constraint that TMS enforces.

**Required change.** Correct FSD §6.4.3's pacs.002 row to match §6.5.4. No change to the story.

*Status: the mapping data has been corrected — `GrpHdr.MsgId` and `GrpHdr.CreDtTm` are now recorded as PPA-generated on pain.013 and pacs.002, with the override and its rationale documented in each.*

### R-12 — Payee-name sourcing differs between the FSD and the mapping data

**Severity: Medium.** Affects US-PPA-08, US-PPA-09, US-PPA-10.

US-PPA-08's assumption states: "ALS / party lookup never publishes to Kafka. Payee name is not sourced from a `PUT /parties` event. This is confirmed."

This matches the FSD. §6.4.4 removes party-lookup keying on the grounds that ALS is HTTPS end-to-end and never publishes to Kafka, confirmed with CCH. §11 lists ALS event capture as a Phase 1 exclusion because "there is no Kafka event for this pipeline to capture in the first place". §6.4.1 and §6.5 both specify `Cdtr.Nm` degrading to the payee MSISDN pending Open Item #4. FSD §7 flags the golden-path capture's `PUT /parties` entry as not a real Kafka event for this pipeline.

The mapping data sourced `Cdtr.Nm` and `CdtrAcct.Nm` from `PUT /parties` on pain.001, pain.013 and pacs.008 — accurate to the wire capture, but not to what this pipeline consumes.

**Required change.** None to the stories. The mapping data required correction.

*Status: corrected. `Cdtr.Nm` and `CdtrAcct.Nm` now resolve to the payee MSISDN on all three messages, `PUT /parties` has been removed as a source, and the gap is documented on each mapping with a reference to Open Item #4. The sample payloads have been updated to match.*

### R-13 — pain.001 `InstdAmt` sourced from different messages

**Severity: Medium.** Affects US-PPA-08. Decision required.

US-PPA-08 maps "payment amount and type → `Amt.InstdAmt`", matching FSD §6.5's pain.001 row, which maps the quote request's own `amount` field.

The mapping data sources `InstdAmt` from the cached FX quote's `sourceAmount` instead.

The two coincide on the DRPP-GP-01 golden path and diverge in the general case. Per FSD §3.3, the quote stage carries **FX-adjusted amounts** — under a SEND-currency corridor the quote request carries the target amount (ZMW 1), not the source amount (MWK 60). Reading the quote's `amount` into `InstdAmt` would therefore place the target amount in both `InstdAmt` and `EqvtAmt` and collapse `XchgRate` to 1, losing the two-currency relationship that FSD §7 identifies as the point of the cross-border mapping.

The two sourcings also imply different degraded behaviour. Under the FSD's reading, `InstdAmt` always resolves from the trigger and only `EqvtAmt`/`XchgRateInf` are lost when FX enrichment is missing — which is what US-PPA-08's assumption states. Under the mapping's reading, `InstdAmt` is lost as well.

**Required change.** Confirm the correct sourcing for `amountType: RECEIVE` and align both documents. US-PPA-08's degraded-field assumption holds only under the FSD's reading. The mapping data retains the FX-quote sourcing and records the divergence pending this decision.

### R-14 — FSD cites two open-item numbers for the payee-name gap

**Severity: Low.** Correction owed to the FSD.

FSD §6.5.2 cites Open Item #4 for the `Cdtr.Nm` deviation, which is correct — Open Item #4 is the payee display-name field. FSD §6.4.3's closing paragraph cites Open Item #6, which is the Zambia Data Protection Act item.

The user stories cite #4 correctly throughout.

**Required change.** Correct FSD §6.4.3. No change to the stories.

### R-15 to R-22 — Traceability and editorial

| # | Story | Finding | Required change |
| --- | --- | --- | --- |
| R-15 | US-PPA-08 | The schema-validation criterion cross-references "(see US-PPA-13)". Schema validation is specified in **US-PPA-12**; US-PPA-13 specifies the TMS send. | Correct the reference. |
| R-16 | US-PPA-14 | "The **TTT** is an order of magnitude shorter than the correlation TTL." | Correct to TTL. |
| R-17 | US-MON-01 | The description states "**Four** distinct signals must be monitored" and names four; the acceptance criteria specify seven — consumer lag, paused-offset rate, ValKey memory pressure, degraded-message rate, circuit-breaker state at two hops, ValKey reachability, and TMS token-refresh health. | Align the stated count with the criteria. |
| R-18 | US-MLA-01 | No criterion requires a **dedicated** consumer group. IID §5.1 states that MLA "must use a dedicated consumer group name. Reusing any DRPP-internal consumer group name risks stealing partition assignments from a live payment-path handler." The story's assumption requires only that the group ID be externally configured, which permits the unsafe value. | Promote to an acceptance criterion. This is the one MLA misconfiguration capable of affecting live payments. |
| R-19 | US-PPA-08 | States that the quote request's `transactionType` is authoritative for `Purp.Cd` "not any copy in a decoded ILP packet". The quote request carries no ILP packet — it arrives on the callback — and FSD §6.5's pain.001 row does not map `Purp.Cd`. | Remove. The rule is correctly stated on US-PPA-10, where the ILP packet is decoded. |
| R-20 | US-PPA-08 | Omits FSD §6.5's constraint that `PmtId` carries no `InstrId` on pain.001. With TMS running `removeAdditional: 'all'`, an `InstrId` sent on pain.001 is accepted and silently discarded. | Add as a criterion. This is the silent-failure class US-PPA-12 exists to detect. |
| R-21 | US-PPA-07 | Applies the domestic discriminator to "TRANSFER and FXTRANSFER trigger events", following FSD §6.3 step 6b. FSD §6.4.1 classifies `POST`/`PUT /fxTransfers` as correlation and audit only, so they never reach step 6b. | Remove the FXTRANSFER reference, and raise the same correction against FSD §6.3. |
| R-22 | US-MLA-06 | Classifies a TLS handshake failure as transient (5xx) and applies the retry policy. The outcome is defensible — pausing the offset is correct for an expired or unrecognised certificate — but the FSD specifies only PPA's side of a certificate rejection (§6.7). | Record as a deliberate decision with its rationale, rather than as an inherited rule. |

### R-23 to R-26 — Coverage gaps

Behaviour specified in the source documents with no corresponding story or acceptance criterion. None is blocking; each is listed so that its omission is a recorded decision rather than an oversight.

| # | Gap | Source |
| --- | --- | --- |
| R-23 | Event Envelope versioning: schema changes must be additive, and a breaking change requires a new endpoint path. | IID §5.2 |
| R-24 | Notification Filter/Dedup threat model: forged notification events, and the explicit position that degraded pass-through is a design decision rather than a silent gap. US-DEDUP-01 covers availability but carries no security criterion. | FSD §10.5 |
| R-25 | Capacity planning must account for the message-volume reduction the dedup component provides when sizing PPA→TMS throughput — material given the 4.6:1 ratio recorded at R-09. | FSD §9.6 |
| R-26 | Whether `topic-notification-event` carries only the final-state notification or a wider set of DFSP-bound callbacks. If wider, US-DEDUP-01's filtering scope extends beyond deduplication. | FSD Open Item #2 |

### R-27 — Failure-domain relationship between the two dedup stores is not specified

**Severity: Medium.** Affects US-DEDUP-01, US-PPA-04.

The notification path carries two independent idempotency checks by design: the upstream Notification Filter/Dedup component's durable store (US-DEDUP-01), and PPA's own check against its write-ahead store (US-PPA-04). US-PPA-04's description states the purpose directly: PPA's check is "a backstop against duplicates that may have passed through the upstream Notification Filter/Dedup component." US-DEDUP-01 states the reverse direction of the same relationship: if the upstream component is unavailable, events pass through unfiltered and "PPA's own step-4 idempotency check … acts as the backstop."

Neither story, nor the FSD, states whether the two stores run on genuinely independent infrastructure, or could share a failure domain — the same database cluster, the same network segment, the same outage. This is not a hypothetical concern for the default deployment. IDD v2.0 §6.8 records that the Notification Filter/Dedup component is **embedded within MLA/PPA by default for Phase 1**, precisely to avoid provisioning it as a separate service. The IDD specifies this as a process/container-level embedding; it does not state whether the embedded component's idempotency store is a distinct store from PPA's write-ahead store, or the same one.

If the two stores turn out to share infrastructure — most plausibly under the default embedded deployment — the backstop relationship each story describes is materially weaker than either story implies: a single outage or bug class affecting the shared store defeats both checks simultaneously, not just one of the two. The stories' own defense-in-depth reasoning depends on the two failures being independent, and nothing currently establishes that they are.

**Required change.** Add an explicit requirement — to US-DEDUP-01, US-PPA-04, or both — that the two idempotency stores are provisioned as separate failure domains regardless of whether the Notification Filter/Dedup component itself is embedded or standalone. If genuine separation is not achievable under the embedded deployment, state that as a known limitation of the Phase 1 default rather than leaving it unaddressed.

### R-28 — Atomicity of PPA's own notification dedup check is unspecified

**Severity: Medium.** Affects US-PPA-04.

US-PPA-06 and US-PPA-14 both state their respective ValKey operations must be atomic, and both give the reason. US-PPA-06: "Enrichment writes use an atomic read-modify-write on ValKey … A plain read-then-write from two concurrent replicas is not acceptable — it silently loses one side's update." US-PPA-14: "Before issuing the TMS POST, PPA performs an atomic check-and-set (`SET ... NX EX`)." Both follow the FSD directly — §6.4.5 requires the correlation-cache read-modify-write to be atomic "since two replicas can process related events for the same transaction concurrently," and §6.3 step 8 requires the sent-message guard to be an atomic check-and-set for the same reason.

US-PPA-04 makes no equivalent claim. Its acceptance criteria state that PPA "checks `transferId` against a durable set of already-processed notification IDs" and that duplicates are "silently dropped" — a check-then-write sequence, with no statement of whether the check and the write are atomic. FSD §6.3 step 4, which US-PPA-04 is derived from, has the same gap: it specifies the dedup key, the store, and the TTL, but not concurrency behaviour. This is a genuine omission in the FSD, not just in the story — §6.4.5's atomicity requirement is scoped explicitly to the correlation-cache read-modify-write, not to this check.

PPA is horizontally scaled behind a load balancer (FSD §4.2), so two replicas can process redelivered or genuinely duplicate notification events for the same `transferId` concurrently. Without an atomic guard at this step, both replicas can read "not yet processed" before either commits its write, and both proceed past step 4 believing themselves to be the first occurrence.

The practical consequence is narrower than it first appears, and worth stating precisely rather than assuming the worst case. Both notifications for a given `transferId` map to the same outbound `isoMessageType` (`pacs.002.001.12`) and the same envelope `id` (`transferId`), so both would still collide at the **independently atomic** sent-message guard specified in US-PPA-14 (FSD §6.3 step 8), which is keyed on exactly `id + isoMessageType`. That guard is a genuine second line of defence, and it means a race at step 4 is unlikely to result in a duplicate message actually reaching TMS.

What the step-8 guard does **not** fix is step 4's own contract. US-PPA-04 specifies that a duplicate is "silently dropped" and implicitly logged as a duplicate at that step; terminal-state monotonicity is checked at that step. Under a race, both events pass step 4 as if each were the first occurrence — neither is logged as the duplicate step 4 describes, both proceed through classification and translation (wasted work), and whichever loses the step-8 race is dead-lettered or dropped there instead, under different logging semantics than US-PPA-04's own acceptance criteria describe. The audit trail would not show what actually happened.

**Required change.** Add an explicit atomicity requirement to US-PPA-04, matching the pattern already used in US-PPA-06 and US-PPA-14 — e.g. an atomic check-and-set (or equivalent conditional write) against the write-ahead store, not a separate read followed by a separate write. Raise the same correction against FSD §6.3 step 4, which currently has no concurrency requirement stated at all.

---

## 6. Assessed as Correct

The following were traced in full and require no change. They are recorded so that subsequent review effort can be directed elsewhere.

**Boundary drift.** None of the six findings in `CCH_CrossDocFindings_MessageIngestion_v1.0.md` reproduce in the user stories. The stories take the FSD's position on all six, including `TxSts: ACSC` rather than the untranslated Mojaloop value (F-02), FX Transfer as enrichment-only (F-03), the per-trigger rather than paired correlation model (F-05), and the split health endpoints (F-06).

**Correlation model.** No story describes the PPA as waiting to pair a request with its callback. US-PPA-10 states that the pacs.008 fires on the transfer prepare without waiting for the fulfil, preserving the pre-settlement evaluation window that FSD §6.4.1 and §11 identify as the reason for the design.

**Durability chain.** Complete and correct end to end: write-ahead persist before acknowledgement (US-PPA-02), offset-gated handoff (US-MLA-06), 503-on-unreachable back-pressure (US-PPA-02), offset-pause recovery with no MLA-side DLQ (US-MLA-07), and DLQ parking extending effective correlation lifetime to 90 days (US-PPA-16, US-PPA-17).

**Silent-failure controls.** All present: pinned local schema validation ahead of TMS's `removeAdditional: 'all'` (US-PPA-12), pinned `MsgId` reuse across retries (US-PPA-13), atomic check-and-set on the sent-message dedup set (US-PPA-14), the degraded-message-rate metric as the sole detector of systematic enrichment loss (US-MON-01), and readiness probes deliberately not gating on shared dependencies (US-PPA-01, US-MON-02).

**Field mapping.** US-PPA-10 matches FSD §6.4.3 and §6.5 field for field, including the ILP-decoded `transactionId` to `PmtId.EndToEndId` mapping, the `FinInstnId.Othr.Id` to `ClrSysMmbId.MmbId` path reshape, and the `transferId → { InstrId, EndToEndId }` write-back required for pacs.002 identifier resolution. Sentinel constants verified against the validated sample: `Cdtr.BirthDt` 1900-01-01, `CityOfBirth` "Unknown", `CtryOfBirth` "ZZ". US-PPA-11 matches FSD §6.5.3's translation table, including ACSC rather than ACCC with the correct rationale, and §6.5's error-callback row.

**Open items.** FSD Open Items #3, #4, #5, #6, #7, #8 and #9 are each carried as assumptions against the stories they affect.

---

## 7. Recommended Actions

| # | Action | Document | Owner |
| --- | --- | --- | --- |
| 1 | Restate trigger/enrichment classification as non-exclusive; add caching criteria (R-01) | User Stories §7, and FSD §6.3 | Story author + FSD author |
| 2 | Resolve whether `NOTIFICATION` is a fifth `eventType` and align three stories (R-02) | User Stories, FSD §5.4 | Story author + FSD author |
| 3 | Decide `msgType` semantics, then align both governing documents (R-03) | FSD §5.4 and IID §5.2 | FSD + IID authors, jointly |
| 4 | Add the two "never synthesize" prohibitions as criteria (R-04) | User Stories §10, §8 | Story author |
| 5 | Add PPA→TMS circuit-breaker criteria; confirm the trip mechanism (R-05) | User Stories §9, FSD §9.5 | Story author + FSD author |
| 6 | Reconcile the mandatory FSPIOP header check with Open Item #5 (R-06) | User Stories §2, §8 | Story author |
| 7 | State that exactly one pacs.002 trigger is configured (R-07) | User Stories §7 | Story author |
| 8 | Specify retries-exhausted behaviour (R-08) | User Stories §3 | Story author |
| 9 | Update the dedup deployment assumption; add the 4.6:1 sizing basis (R-09) | User Stories §4 | Story author |
| 10 | Correct the IDD citation and restate the TPS baseline as a working assumption (R-10) | User Stories §12, FSD §9.1 | Story author + FSD author |
| 11 | Correct the pacs.002 `GrpHdr.MsgId` provenance row (R-11) | FSD §6.4.3 | FSD author |
| 12 | Confirm pain.001 `InstdAmt` sourcing for `amountType: RECEIVE` (R-13) | FSD §6.5 | FSD author + Mojaloop Partner |
| 13 | Correct the open-item cross-reference (R-14) | FSD §6.4.3 | FSD author |
| 14 | Apply the traceability and editorial corrections (R-15 to R-22) | User Stories | Story author |
| 15 | Confirm whether the four coverage gaps are deliberate omissions (R-23 to R-26) | User Stories | Story author |
| 16 | Require independent failure domains for the two notification-dedup stores, or record the limitation if the embedded deployment cannot provide it (R-27) | User Stories, IDD §6.8 | Story author + IDD author |
| 17 | Add an atomicity requirement to PPA's own notification dedup check (R-28) | User Stories §2, FSD §6.3 step 4 | Story author + FSD author |
| 18 | Correct the out-of-order-arrival rationale to the audit-topic architecture; specify the audit topic's partition key (R-29) | FSD §6.4.8, §9.4, §9.6; User Stories §10 | FSD author, then Story author |

Actions 1 to 5 warrant resolution before implementation begins on the affected components: each produces behaviour that is either silent at runtime or inconsistent between the MLA and PPA sides of the same contract. Actions 16 and 17 warrant resolution alongside them — both concern the same notification-dedup path already carrying R-06, R-07 and R-09. Action 18 belongs with them too: it is the FSD's own architecture rewrite not having been fully carried through to every section that depended on it.

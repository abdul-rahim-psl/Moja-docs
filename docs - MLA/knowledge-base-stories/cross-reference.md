<!-- SPDX-License-Identifier: Apache-2.0 -->

# Cross-Reference — POC (`poc-mla-ppa`) vs. the CCH User Stories <!-- omit in toc -->

**What this document is.** A business-logic and flow-level comparison between what was actually built and live-verified in the `poc-mla-ppa` proof of concept and what the CCH user-story documents now specify for production — MLA's, PPA's, PII's and the removed dedup component's; `cch-crosscutting-user-stories.md` (added [2026-09-07]) is not compared here, since the POC never built production audit logging, metrics, or a monitoring/alerting stack for either service to compare against. It answers three questions per area: **what is aligned and reusable**, **what diverges and why it matters**, and **which of the two is right** — because on several points the POC holds capture evidence that contradicts a story's stated assumption, and on several others the stories carry a review correction the POC predates.

**What this document is not.** It is not a POC gap list. Infrastructure differences that follow inevitably from "POC → production" — mutual TLS, Keycloak, Kubernetes, HA stores, real metrics backends — are enumerated once in §8 and otherwise ignored. They are expected, uncontroversial, and not where the risk is.

**Sources.** POC side: `poc-mla-ppa/` source, `poc-mla-ppa/README.md` and both service READMEs, and `../../docs-poc-mla-ppa/` — **outside this repository** — (`MLA-PPA-Technical-Design.md` §§1–7, `rejected-events.md`, `summarized steps - poc.md`). Story side: [core-knowledge.md](core-knowledge.md) and the four business-logic documents in [docs - MLA/user stories/](../user%20stories/) (`cch-crosscutting-user-stories.md`, the fifth, is out of this document's scope — see above).

**Section-reference convention.** A bare `§N` in this document's own prose (`§7.3`, `§12`) is a section of this document. A `§N` given **inside a POC column or attributed to the POC** — `§2.2a`, `§2.3`, `§3.5` — is a section of `MLA-PPA-Technical-Design.md`. FSD and IID sections are named as such. Story references are by story id (`US-MLA-04`) or finding id (`R-28`), never by section number.

- [1. The headline: seven things to decide before writing code](#1-the-headline-seven-things-to-decide-before-writing-code)
- [2. Where the POC's captures contradict a story's stated fact](#2-where-the-pocs-captures-contradict-a-storys-stated-fact)
- [3. MLA — ingestion and classification](#3-mla--ingestion-and-classification)
- [4. The identifier model — the deepest fork](#4-the-identifier-model--the-deepest-fork)
- [5. The Event Envelope contract](#5-the-event-envelope-contract)
- [6. PPA — pipeline, correlation, and idempotency](#6-ppa--pipeline-correlation-and-idempotency)
- [7. ISO 20022 translation](#7-iso-20022-translation)
- [8. Durability, recovery, and the error path](#8-durability-recovery-and-the-error-path)
- [9. Security and PII](#9-security-and-pii)
- [10. What the POC proved that the stories should absorb](#10-what-the-poc-proved-that-the-stories-should-absorb)
- [11. What the stories require that the POC never built](#11-what-the-stories-require-that-the-poc-never-built)
- [12. Reuse verdict, component by component](#12-reuse-verdict-component-by-component)

**Severity key used throughout:**

| | Meaning |
| --- | --- |
| 🔴 | **Blocking.** Implementing one side as written produces silently wrong behaviour. Decide before coding. |
| 🟠 | **Material fork.** Both positions are defensible; they are not compatible. Choose deliberately and record it. |
| 🟡 | **Gap.** The story requires something the POC never attempted. Mostly known and deliberate. |
| 🔵 | **POC ahead.** The POC holds evidence or a mechanism the stories have not caught up to. |
| 🟢 | **Aligned.** Behaviour matches. Reusable largely as-is. |

---

## 1. The headline: seven things to decide before writing code

| # | Sev | The fork | If unresolved |
| --- | --- | --- | --- |
| **1** | 🔴 | **`start`-only ingestion vs. the per-operation canonical table.** US-MLA-01 says "MLA ingests only `start` records; `egress` records are recognized and discarded." The captures show three operations that exist **only as `egress`** — `commitTransfer`, `reserveFxTransfer`, `notifyFxTransfer` — and one (`prepareTransfer`) whose `egress` half carries a *different body* when the transfer is rejected. | **Every real transfer rejection is silently dropped**, along with the FX-transfer settlement leg. The POC hit this exact defect twice and found it both times only by replaying real captures. §3.1 |
| **2** | 🔴 | **Idempotency: one durable check-and-set vs. the POC's two mechanisms.** US-PPA-04 specifies a single atomic check-and-set on `{id}:{isoMessageType}` in the **durable store, before translation**. The POC has a notification-only dedup in the durable store *plus* a ValKey `SET NX` sent-guard on `{id}:{messageType}` with a **15-second TTL, after translation**. | The POC implements precisely what US-PPA-04 forbids — a ValKey-backed dedup key that `volatile-lru` can evict and re-admit a duplicate through. The story is the corrected position. §6.3 |
| **3** | 🔴 | **The domestic discriminator ignores `determiningTransferId`.** POC: `isDomesticTransfer` is `!state?.fxQuote` and nothing else. US-PPA-07: domestic only if FX-quote state is absent **and** `determiningTransferId` is absent — the race case (linkage present, FX state not yet cached) is in scope and must emit a degraded `pacs.008`. | **A genuine cross-border payment whose FX-quote enrichment lost a race is silently discarded** as domestic, with no DLQ entry and no alert by design. §6.4 |
| **4** | 🟠 | **The `id` model: one leg-wide anchor vs. the FSD's per-`eventType` scheme.** The POC deliberately deviates — `id` is always the anchor (`transactionId`) — because `putQuotesByID` carries *only* `quoteId` in its tags. US-MLA-04 reverts to `quoteId`/`conversionRequestId`/`transferId`/`commitRequestId`. | This choice propagates into every PPA correlation key, the `pacs.002` identifier resolution, and whether cross-key joins are needed at all. It is the single deepest architectural fork in this comparison. §4 |
| **5** | 🟠 | **`msgType` cardinality and the fifth PPA route.** POC: three values (`request`/`callback`/**`notification`**) plus `POST /TRANSFERS/NOTIFICATIONS`. Stories: two values, and the fifth endpoint does not exist. | A straight contract break. The POC uses `msgType === notification` as its discriminator for "emit `pacs.002` rather than `pacs.008`" — removing the value requires a replacement discriminator, not just a schema edit. §5.2 |
| **6** | 🟠 | **Base64 / ILP decoding: mandatory vs. unused.** US-MLA-03 makes base64 decoding mandatory for TRANSFER/FXTRANSFER; US-PPA-10 requires decoding the ILP packet for `transactionId` and the `Cdtr`/`CdtrAcct` identity. The POC decodes neither — the FSPIOP form is already plain JSON, and the anchor reaches the same `transactionId`. | Decoding `content.dataUri` yields **Mojaloop's** ISO 20022 (`IntrBkSttlmAmt.ActiveCurrencyAndAmount`, `FinInstnId.Othr.Id`), not the FSPIOP shapes the story's own field tables map from. Following the story literally changes the entire mapping surface. §3.3, §7.3 |
| **7** | 🔴 | **`pacs.002` identifier resolution.** US-PPA-11 forbids assuming `transactionId == transferId` and requires resolving `OrgnlInstrId`/`OrgnlEndToEndId` from the mapping written after the `pacs.008`. The POC sets both to the anchor and never writes the mapping — `TransactionState.identifiers` exists but nothing populates it. | Under the POC's anchor model this is self-consistent *by construction*, but only while the assertion "the anchor is always equal" holds. There is no mechanism if it ever fails, and the failure is silent: TMS accepts the `pacs.002` and never links it. §7.4 |

---

## 2. Where the POC's captures contradict a story's stated fact

This is the highest-value section. In each row the POC is not offering an opinion — it is reporting what `DRPP_Kafka_E2E_Pack` (5 corridors, 100 records) and `raw_export_500.json` (500 records, 12 partitions) actually contain. Where a story states the opposite as settled, the story needs correcting.

| # | Point | The stories say | The captures show | Consequence |
| --- | --- | --- | --- | --- |
| **F1** | Records per logical step | "Each logical event is written to the audit topic **twice** … carrying **identical business content**." (US-MLA-01) | Eight operations are double-written. **Three exist only as `start`** (`fulfilTransfer`, `fulfilFxTransfer`, `putPartiesByTypeAndID`); **three only as `egress`** (`reserveFxTransfer`, `notifyFxTransfer`, `commitTransfer`). The fulfil-side operations **rename themselves** between ingress and egress rather than repeating. | The "written twice, identical content" premise is false in both halves. Any blanket rule built on it drops records. |
| **F2** | Which half to keep | "MLA ingests only `start` records; `egress` records are recognized and discarded as a **structural skip**." (US-MLA-01) | A fixed per-operation table (`CANONICAL_ACTION_BY_OPERATION`), corroborated independently by JWS signature presence — every canonical record carries a real signature, every non-canonical counterpart does not. | 🔴 See §3.1. This is finding #1. |
| **F3** | `prepareTransfer`'s egress half | (not addressed) | **Overloaded.** On the happy path it is the harmless duplicate. When the transfer is rejected it is the leg's **terminal record**, carrying `TxInfAndSts.StsRsnInf` in place of the normal body, on a `PUT .../transfers/{id}/error` URL, never followed by a fulfil. | 🔴 The one confirmed transfer-level rejection shape is indistinguishable from noise unless the payload is shape-checked. |
| **F4** | Classification signal | "Key **primarily on HTTP method plus resource name**, using `operation` as a secondary, confirmatory signal" — because `start: fulfilFxTransfer` pairs with `egress: reserveFxTransfer`. (US-MLA-02) | `operation` is an explicit, deterministic **13-value stage classifier**, reliable with zero exceptions. The `fulfilFxTransfer`/`reserveFxTransfer` pair is **not one record renamed** — they are two distinct records, one `start`-only and one `egress`-only. `transactionType` is the field that genuinely disagrees between `start` and `egress`, and is unusable. | 🔴 The story draws the opposite conclusion from the same observation. Worse: method-plus-resource **cannot** separate `fulfilFxTransfer` from `reserveFxTransfer` — both are `PUT /fxTransfers/{id}`. The demoted signal is the only one that can. |
| **F5** | Party lookup on the topic | "ALS / party lookup **never publishes to Kafka**. Payee name is not sourced from a `PUT /parties` event. **This is confirmed.**" (US-PPA-08) | `getPartiesByTypeAndID` / `putPartiesByTypeAndID` are **stages 1–2 of every capture**. The FSD's premise does not hold for `topic-event-audit`. | 🟡 Both sides skip party lookup, so behaviour is unaffected — but the story's stated basis is wrong, and reinstating party data as enrichment becomes an open design choice rather than an impossibility. |
| **F6** | Payee display name | No confirmed source; MSISDN fallback is "correct behaviour, not a bug" (FSD Open Item #4 still open). (US-PPA-08) | **Present on the quote payload in both message forms** — `CdtTrfTxInf.Cdtr.Nm` (ISO) and `payee.personalInfo.complexName` (FSPIOP). Open Item #4 **resolved**. | 🔵 The fallback should be a genuine cache-miss path, not the routine case the story implies. |
| **F7** | Date of birth | Sourced from `personalInfo.dateOfBirth` → `Dbtr.DtAndPlcOfBirth.BirthDt`. (US-PPA-08, US-PPA-10) | **Absent everywhere** — zero occurrences across the entire pack, in either message form. The POC emits the sentinel `1900-01-01` unconditionally. | 🔴 The story's mapping can never be satisfied. This is structural, not a degraded case — and it means **every** `pacs.008` carries the sentinel, which US-PPA-10 already notes forbids age-based fraud rules. The story should say so as a fact, not a fallback. |
| **F8** | JWS survival to the topic | FSD Open Item #3 — unresolved; "if the header does not survive … JWS validation as specified **cannot be implemented**." (US-MLA-05) | **Resolved.** Real JWS signatures present on every canonical record; absent only on non-canonical counterparts and the party `GET`. | 🔵 US-MLA-05 is unblocked. The story still carries it as gating. |
| **F9** | `operation` tag reliability | FSD Open Item #7 open; "whether this is a guaranteed platform contract or an artefact of this particular capture window is still open." (US-MLA-02) | **Resolved favourably** — no payload sniffing needed anywhere, for any stage, FX-vs-domestic transfer included. | 🔵 The story's caution about *CCH's own* environment remains right and should stay; the "may be an artefact" framing is now weaker than the evidence. |
| **F10** | `TxSts` source vocabulary | One vocabulary: `COMMITTED` → `ACSC`, `ABORTED` → `RJCT`, `RESERVED` → `ACSP`. (US-PPA-11) | **Two.** The FSPIOP form (`transferState`) *and* the ISO form (`TxInfAndSts.TxSts`: `COMM`, `RESV`), sometimes on the same logical step's `start`/`egress` pair. | 🔴 An untranslated `COMM` falls through to Tazama's `PDNG` default. The story's translation table has no row for it — and `TxSts` is an unconstrained string, so nothing catches it. |
| **F11** | The rejection shape | "Any error callback → `pacs.002` with `TxSts: RJCT`"; error code/description logged in audit only. (US-PPA-05, US-PPA-11) | Real rejections carry **`TxInfAndSts.StsRsnInf.{Rsn.Prtry, AddtlInf}` with no status field at all** — not the FSD's assumed `errorCode`/`errorDescription`, and not an `ABORTED`/`RJCT` status string. | 🔴 `RJCT` must be resolved **structurally from the shape's presence**, never by looking a value up in the translation table. The POC keeps `toRejectedPacs002` deliberately separate from `toPacs002` for exactly this reason — running `'RJCT'` back through the lookup silently yields `PDNG`. |
| **F12** | The `pacs.002` trigger record | The **fulfil callback** (`PUT /transfers`, `fulfilTransfer`). (US-MLA-02, US-PPA-11, and the dedup document's evidence) | **`commitTransfer`** — an `egress`-only record from `ml-notification-handler` carrying `fspiop-source`/`-destination` and `TxSts: "COMM"`. The POC **skips `fulfilTransfer` entirely.** | 🟠 Both sides correctly conclude *one* trigger exists — but they pick **different records**. They agree these are two audit views of the same FSPIOP fulfil; they disagree on which view to act on. Must be settled explicitly. **Settled** (`plan.md` §3.1, D5): `commitTransfer`, matching the POC's reading — the story's `fulfilTransfer` position was not adopted. |
| **F13** | Kafka message key | Not transaction-scoped; unsafe to reuse. (US-MLA-04) | Same — every observed trace id covered more than one transaction, and the settlement leg is sometimes re-emitted under a fresh one. | 🟢 Aligned, independently confirmed on both sides. |
| **F14** | Out-of-order arrival | Real and likely; the story's stated cause ("prepare and fulfil sit on different Kafka topics") is flagged as stale (R-29, open). | **Confirmed by capture** — `04_ZMW_to_EGP_partition_split` shows the entire settlement leg landing on a **different partition under a fresh trace id**. The cause is partition assignment plus async-ack-then-process across replicas. | 🔵 The POC already holds the corrected rationale R-29 is waiting for. Lift it. |

---

## 3. MLA — ingestion and classification

### 3.1 🔴 Canonical-record selection — the most consequential divergence

**The stories' rule** (US-MLA-01): one universal filter. Keep `start`, discard `egress`.

**The POC's rule** (§2.2a): a fixed lookup per operation, because the topic is not uniformly double-written.

| Operation | Actions on the wire | POC keeps | Under the stories' `start`-only rule |
| --- | --- | --- | --- |
| `postQuotes`, `putQuotesByID`, `postFxQuotes`, `putFxQuotesByID`, `prepareFxTransfer`, `prepareTransfer` | start + egress | **start** | ✅ same |
| `fulfilTransfer`, `fulfilFxTransfer` | **start only** | — *(skipped; superseded by the egress-side record)* | ✅ ingested — this is where the two models genuinely differ in intent, not just mechanics |
| `reserveFxTransfer` | **egress only** | **egress** | ❌ **dropped** |
| `notifyFxTransfer` | **egress only** | — *(skipped)* | ❌ dropped (harmless — neither model uses it) |
| `commitTransfer` | **egress only** | **egress** — the `pacs.002` trigger | ❌ **dropped** |
| `prepareTransfer` **when rejected** | **egress**, different body | **egress**, detected by shape | ❌ **dropped — every transfer rejection lost** |

**Why this matters more than it looks.** Both of the POC's discoveries here came from running real data, not from reading the spec:

- `demo:replay`'s **first run** surfaced `reserveFxTransfer` being silently dropped on every cross-border transaction's settlement leg.
- The wider 500-record capture surfaced the transfer rejection being discarded **identically to a harmless duplicate**, with no log line distinguishing the two.

**Assessment.** The stories' rule is a simplification of a real observation, and it does not survive contact with the topic. The POC's per-operation table plus a payload shape-check for `prepareTransfer` is the correct model.

**But note one genuine open question the POC does not settle:** the stories take `fulfilTransfer` (start) as the `pacs.002` trigger; the POC takes `commitTransfer` (egress). The dedup document's evidence — identical `GrpHdr.MsgId`, `TxSts`, `fspiop-source`, `fspiop-destination`, observed exactly once per transaction — says they are the same relayed callback, so either choice yields exactly one `pacs.002`. They are not interchangeable in code, though: `commitTransfer` carries the ISO `TxSts: "COMM"` vocabulary (F10) while `fulfilTransfer` carries the FSPIOP `transferState`. **Pick one, and make the `TxSts` translation table match it.**

**Settled** (`plan.md` §3.1, D5): `commitTransfer`, ISO `TxSts` vocabulary (`COMM`/`RESV`) — the analysis above is the reasoning behind that choice, not superseded by it.

### 3.2 🔴 Classification signal

| | Stories (US-MLA-02) | POC (§2.2a) |
| --- | --- | --- |
| Primary signal | `FSPIOP-HTTP-Method` + resource name (`Content-Type`/`FSPIOP-URI`) | `metadata.trace.tags.operation` — alone |
| Secondary | `operation`, confirmatory only | none needed; corroborated by signature presence |
| Rationale | `operation` naming is "not perfectly symmetric" between `start` and `egress` | `operation` is deterministic per record; `transactionType` is the field that actually disagrees |

The stories and the POC observed **the same asymmetry** and drew **opposite conclusions**. The POC's reading is the stronger one: `fulfilFxTransfer` and `reserveFxTransfer` are not one step renamed — they are two distinct records with disjoint `action` values, and *only* `operation` separates them. Method-plus-resource collapses them into one bucket (`PUT /fxTransfers/{id}`), which is precisely the discrimination the canonical table needs.

**Also worth carrying forward:** the stories' table maps `commitTransfer` into **two different rows** — once as TRANSFER (`PUT`/`PATCH /transfers/{id}`) and once as FXTRANSFER (`PATCH /fxTransfers/{commitRequestId}`). That ambiguity is unresolvable on method-plus-resource and resolves trivially on `operation`.

### 3.3 🟠 Payload decoding

| | Stories (US-MLA-03) | POC (§2.2) |
| --- | --- | --- |
| TRANSFER / FXTRANSFER | **Mandatory** base64 `data:` URI decode before any field extraction | **Optional and unused** |
| Where the body comes from | the decoded `data:` URI | `content.transformedPayload` (quote family) or `content.payload` (transfer family) — **already plain FSPIOP JSON** |
| What `content.dataUri` holds | (not modelled) | the **ISO 20022** form — a genuinely different representation, not a duplicate |

**The trap.** The stories' field-mapping tables (§7 of core-knowledge) source from **FSPIOP** field names — `payer.partyIdInfo`, `personalInfo.complexName`, `amount.amount`, `payeeFspFee`. Those live in the plain JSON. Decoding `dataUri` as the story instructs hands you **Mojaloop's ISO 20022** instead, with `IntrBkSttlmAmt.ActiveCurrencyAndAmount` and `FinInstnId.Othr.Id` — the exact shapes the FSD warns must not be copied through to Tazama. Implementing US-MLA-03 literally and US-PPA-08/10's tables literally is internally inconsistent.

**Recommendation:** keep the POC's model — read the FSPIOP form, treat decoding as available-on-demand. Rewrite US-MLA-03's acceptance criteria around "select the FSPIOP representation", not "decode".

### 3.4 🟢 / 🔵 Aligned on the rest of ingestion

| Point | Verdict |
| --- | --- |
| One dedicated audit topic, sole Kafka ingress, no per-action topics | 🟢 |
| Resume from last committed offset; no reset to beginning or end | 🟢 POC uses `autoCommit: false` so the contract is never delegated to the client |
| Broker outage → client reconnect, offset does not advance | 🟢 |
| **Dedicated** consumer group | 🔵 POC treats it as a hard requirement with the partition-stealing rationale documented in config; the stories still carry it as open (R-18). Close R-18 from the POC. |
| Party-discovery records skipped | 🟢 both skip — see F5 on the reasoning |
| Unclassifiable → log, advance, do not forward | 🟢 |
| Unreadable payload → log, alert, advance | 🟢 |
| `/health/ready` instance-local, does not probe PPA | 🟢 POC ahead: a real write-then-delete probe, not a `stat` |

---

## 4. The identifier model — the deepest fork

### 4.1 🟠 One anchor vs. four stage-local ids

| | Stories (US-MLA-04) | POC (§2.3) |
| --- | --- | --- |
| `id` on the envelope | Per `eventType`: `quoteId` / `conversionRequestId` / `transferId` / `commitRequestId` | **Always the anchor** — `transactionId`, confirmed equal to `transferId` and `determiningTransferId` wherever more than one is present |
| Stage-local ids | promoted to `id` | carried **inside `body`**, where they already were |
| PPA correlation key | four per-stage keys, *plus* a transaction-level key that "accumulates from all stages" | **one** leg-wide key, `correlation:<anchor>`, one hash field per stage |
| The `putQuotesByID` problem | not addressed | **Confirmed hard exception**: the quote callback carries *only* `quoteId` in its tags, on both `start` and `egress`. Resolved by an in-process `quoteId → anchor` chain populated by `postQuotes`. |

**Why the POC deviated.** The FSD's per-type scheme has a hole the captures expose: one canonical record type cannot supply the id the scheme demands. The POC's answer — use the identifier every record *does* carry, keep the stage-local ones in the body — removes four extraction rules and makes correlation a single-key problem.

**Why this is not a free win.** The POC's model rests on an assertion drawn from five corridors: *the anchor is always equal to the stage identifiers where both appear*. It is well-evidenced but it is a sample. It also introduces two bounded in-process chaining maps (`quoteId → anchor`, `fxTransferId → anchor`, 10 000 entries each) that depend on **Kafka's per-partition ordering putting the request ahead of the callback** — a per-instance assumption that becomes fragile the moment MLA is scaled horizontally or a partition split separates the pair.

**Why the stories' model is not a free win either.** US-PPA-06 asks for **both** per-stage keys *and* a transaction-level key that accumulates from all stages, without saying how a `quoteId`-keyed entry contributes to the `transactionId`-keyed one. That join is exactly the work the anchor model eliminates. As written, the story is under-specified at the point the POC has a working answer.

**Recommendation.** This is the one fork that should be decided by a named person before any code is written. Two coherent options:

1. **Keep the anchor model**, and add what the POC lacks: persist the chaining maps (ValKey, not in-process) so they survive a restart and work across MLA replicas.
2. **Adopt the per-type scheme**, and specify the cross-key join US-PPA-06 currently leaves open — including how the `putQuotesByID` gap is closed, since the identifier the scheme needs is not on the record.

What must not happen is implementing the story's `id` scheme against the POC's single-key correlation store, or vice versa. They are not composable halves.

---

## 5. The Event Envelope contract

### 5.1 Field-by-field

| Field | Stories | POC | |
| --- | --- | --- | --- |
| `msgType` | `request` \| `callback` | `request` \| `callback` \| **`notification`** | 🟠 §5.2 |
| `eventType` | 4 values | 4 values, same names | 🟢 |
| `id` | per-type | anchor | 🟠 §4 |
| `correlationId` | UUID, per event, MLA-generated | **ULID**, per event, MLA-generated | 🟢 in substance; the format differs and nothing depends on it |
| `fspiop-source` / `-destination` | mandatory; missing ⇒ reject | mandatory; missing ⇒ throw ⇒ advance offset | 🟢 |
| `body` | decoded JSON | FSPIOP form, preferred over ISO | 🟠 §3.3 |
| `timestamp` | ISO 8601, at consumption | same | 🟢 |
| `error` | **absent from the contract** | `{ code, description }`, set only on a detected rejection | 🔴 §5.3 |

### 5.2 🟠 `msgType` and the fifth route

The stories eliminate `notification` and `POST /TRANSFERS/NOTIFICATIONS`; the POC has both. This is more than a schema edit, because the POC uses `msgType` as a **control-flow discriminator** in four places:

- `dispatchToPpa` — route selection (`notification` → the fifth endpoint).
- `NotificationsHandler` → `processEnvelope(..., isNotification = true)` — the only gate on the step-4 dedup check.
- `expectedMessageTypeFor` — `notification` ⇒ `pacs.002`, otherwise `pacs.008`.
- `translate` — `TRANSFER` + `notification` ⇒ `pacs.002`; `TRANSFER` + `request` ⇒ `pacs.008`.

Under the stories' two-value model the replacement is clean — `TRANSFER` + `callback` ⇒ `pacs.002`, `TRANSFER` + `request` ⇒ `pacs.008` — **but only once F12 is settled**, because that mapping presumes the trigger record is the `PUT` fulfil, not the `PATCH`-era `commitTransfer`. Decide F12 first; the `msgType` collapse follows from it.

**F12 is now settled as `commitTransfer`** (`plan.md` §3.1, D5). The caveat above still stands as the thing to confirm, not something it removes: `commitTransfer` is not literally a `PUT .../fulfil` call, so classification (`operation`, D2) must still be checked to yield `msgType: callback` for the TRANSFER row when the record is `commitTransfer`.

The stories are right on the substance: with the notification-dedup component removed and no independently-published Central Ledger event on the topic, a third `msgType` and a fifth endpoint describe something that does not exist.

### 5.3 🔴 The envelope has nowhere to carry a rejection

The POC added `error?: { code, description }` for a concrete reason: the rejection's reason lives in `TxInfAndSts.StsRsnInf.{Rsn.Prtry, AddtlInf}` in a body shape that the normal `pacs.002` builder cannot parse — it would throw looking for a `TxSts` that is not there. Carrying the detection result forward means the PPA does not have to re-sniff `body`'s shape to learn what the MLA already determined.

The stories' envelope has no such field, and US-PPA-05 routes "any error callback" to a `pacs.002`/`RJCT` trigger without saying how the PPA recognises one. **Add the field, or specify the shape-check the PPA must perform.** Silence here is how the POC's original defect happened.

Related, and still open on both sides: **`GrpHdr.MsgId` versioning of the envelope itself** (R-23) is unaddressed by the stories, and the POC deliberately duplicates the envelope type on both sides rather than sharing a package — a decision the engineering rules already endorse ([engineering-rules.md](../engineering-rules.md) §2.2).

---

## 6. PPA — pipeline, correlation, and idempotency

### 6.1 🟢 The pipeline shape matches

The POC's ten steps and the stories' nine map almost exactly. Step-for-step:

| Stories | POC | |
| --- | --- | --- |
| 1 — reachability gate (ValKey + store **+ TMS breaker**) | 1 — reachability gate (ValKey + store) | 🟠 the breaker is missing from the gate — §6.5 |
| 2 — write-ahead persist, then ack 200 | 1–2 — persist, then ack 200 | 🟢 `acceptEnvelope` returns false ⇒ 503, never a 200 for a non-durable event |
| 3 — structural validation | 3 — `validateEnvelope` + route-level ajv | 🟢 POC ahead: ajv runs with `removeAdditional: false` so contract drift is a visible `400` |
| 4 — idempotency | 4 — notification-only dedup | 🔴 §6.3 |
| 5 — classify trigger/cache | 5 — `classify` | 🟠 §6.2 |
| 6 — accumulate | 6a — `mergeEnrichment` | 🟠 §6.2 |
| 7 — domestic discriminator | 6b — `isOutOfScopeTransfer` | 🔴 §6.4 |
| 8 — translate + pinned-schema validate | 7 — `translateAndValidate` | 🟢🔵 |
| 9 — dispatch, clear state on terminal | 8–9 — `sendToTms`, `finalize` | 🟢 |
| — | 10 — audit log | 🔵 POC ahead — a real append-only store, not a log line |

### 6.2 🟠 Trigger and enrichment — right principle, incomplete application

The stories' most consequential review fix (R-01) was declaring trigger-status and cache-status **independent properties**. The POC already behaves this way for QUOTE — it fires `pain.001`/`pain.013` *and* merges afterwards, with the merge placed after the send precisely because "the trigger reads whatever accumulated *before* this event, not including it." That reasoning is sound and should survive into production.

**But the POC does not apply it universally.** US-PPA-05: *"Every event that reaches this classification step is written to the correlation cache, regardless of whether it also triggers."*

| Event | Stories: cached? | POC: cached? | |
| --- | --- | --- | --- |
| `POST /quotes` | ✅ payer identity, `transactionType`, `note` | ✅ `quote` slot | 🟢 |
| `PUT /quotes` | ✅ `ChrgBr`, fees | ✅ `quoteCallback` slot | 🟢 |
| `POST` / `PUT /fxQuotes` | ✅ amounts, rate | ✅ `fxQuote` / `fxQuoteCallback` | 🟢 |
| `POST` / `PUT /fxTransfers` | ✅ correlation/audit | ✅ `fxTransfer` | 🟢 |
| **`POST /transfers` (prepare)** | ✅ **required** | ❌ **never merged** — no slot exists in `MergeableStateField` | 🟠 |
| `PUT /transfers` (fulfil) | ✅ required | ❌ never merged | 🟠 |

The practical consequence is §7.4: because the prepare is never cached, the `transferId → { InstrId, EndToEndId }` mapping US-PPA-10 mandates has nowhere to be written — and indeed `TransactionState.identifiers` is declared but the interface comment states plainly that *"nothing writes it."*

### 6.3 🔴 Idempotency — two mechanisms, neither the specified one

| | Stories (US-PPA-04) | POC |
| --- | --- | --- |
| How many mechanisms | **One**, generic | **Two** |
| Mechanism A | — | `isDuplicateNotification(id, txSts)` — durable store, **notifications only**, with terminal-state monotonicity |
| Mechanism B | — | `claimSentGuard('{id}:{messageType}')` — **ValKey `SET NX`, 15-second TTL**, *after* translation, immediately before the send |
| Specified mechanism | atomic check-and-set on `{id}:{isoMessageType}`, **durable store**, **before translation**, TTL > widest re-delivery window, **uniform across all four event types** | — |

Three separate conflicts:

1. **Mechanism B is in ValKey.** US-PPA-04 rejects this explicitly and by name: *"ValKey's `volatile-lru` eviction policy could silently evict a dedup key and re-admit a duplicate."* A 15-second TTL makes it a retry-window guard, not a duplicate-suppression mechanism — it cannot survive a re-delivery minutes later, which is the case dedup exists for.
2. **Mechanism A carries terminal-state monotonicity.** The stories deliberately removed that: *"there is no comparison of which value should win … a `COMMITTED` arriving after an already-processed `ABORTED` is simply a duplicate of an already-finalized pair, not a conflict to resolve."* Simpler, and it does not depend on knowing which states can legally follow which — a question the Mojaloop Partner has never answered.
3. **Neither runs before translation, uniformly, for all four types.** Quote duplicates are guarded only by B; a quote re-delivered 20 seconds later is translated and sent twice.

**The stories are right here, unambiguously.** This is R-28's resolution and it post-dates the POC. Rebuild as one durable, atomic, pre-translation check-and-set.

One POC insight to preserve: `isDuplicateFinalStateNotification` takes an `isReplay` flag that short-circuits the check when the pipeline is re-driving a trigger it parked earlier. Without it, a recovered event is **discarded as a duplicate of itself** — a real bug a live replay caught. Whatever the production mechanism, it needs the same escape hatch for the parked-and-replayed path.

### 6.4 🔴 The domestic discriminator

```
Stories (US-PPA-07):   domestic  ⟺  no FX-quote state  AND  no determiningTransferId
POC:                   domestic  ⟺  no FX-quote state
```

The POC's own comment explains the omission: *"This POC's envelope model doesn't carry `determiningTransferId` separately (FX transfers already classify to a different eventType upstream in the MLA), so the FX-quote state check alone is the discriminator here."*

That reasoning holds only when FX-quote state has already landed. US-PPA-07 names the failure directly: **FX state absent at trigger time but `determiningTransferId` present in the body is a real race, it is in scope, and the `pacs.008` must still be sent — degraded.** The POC discards it, and the discard is *by design* silent: no DLQ entry, no alert, a counter only.

This is the highest-risk silent-loss path in the comparison, because the metric that would reveal it (`discarded.domestic`) is expected to be non-zero in normal operation. Nothing distinguishes a correctly-dropped domestic payment from a wrongly-dropped cross-border one.

**Fix:** carry `determiningTransferId` through to the discriminator and treat its presence as sufficient linkage, exactly as the story specifies.

### 6.5 🟠 The 503 gate does not include the TMS breaker

US-PPA-13 requires the PPA→TMS breaker's open state to feed **the same step-1 gate** that ValKey and store unreachability feed, returning 503 so MLA's offset pauses and the audit topic's retention buffers the backlog.

The POC has the breaker (`tmsCircuitBreaker`, threshold 5, cooldown 30 s, state exposed on `/metrics`), but `acceptEnvelope` checks only store and cache reachability. While the breaker is open the PPA keeps accepting envelopes and each one burns a full retry cycle before being dropped — precisely the behaviour US-PPA-13's criterion exists to prevent.

Small change, well-understood; the POC's own `/metrics` already surfaces the state that needs wiring in.

### 6.6 🟢🔵 Correlation state — the POC is the reference implementation

| Requirement (US-PPA-06) | POC |
| --- | --- |
| Atomic read-modify-write, never read-then-write | ✅ Lua `EVAL`: `HSETNX` on `createdAt`, `HSET` on the one field, `EXPIRE`. Application code issues **no `GET` of its own**, so it never holds a copy another replica could stale. |
| One field per enrichment slot, JSON-encoded independently | ✅ exactly this |
| Explicit TTL, never indefinite | ✅ `CORRELATION_TTL_SECONDS`, default 70 |
| TTL accounts for MLA ingestion delay under Kafka lag | ⚠️ POC notes it is "not yet confirmed against real observed prepare→fulfil gaps" |
| `volatile-lru`, memory-pressure alert | ✅ policy; ⚠️ alert not built |
| Retain until the **terminal** message is sent | ✅ `finalize` clears only on a successful `pacs.002`, never on the `pacs.008` |
| Multi-replica correctness | 🔵 **live-verified against two genuinely independent processes**, which found a real concurrency bug |

Take this module as-is. It is the strongest-evidenced part of the POC and it satisfies the story's hardest concurrency requirement.

---

## 7. ISO 20022 translation

### 7.1 🟢 The four-message model is identical

Same four messages, same triggers, same principle that **no stage waits for its counterpart** — the prepare emits its `pacs.008` immediately rather than waiting the ~1 second for the fulfil, because waiting destroys the pre-settlement evaluation window. Same conclusion that the FX legs fold in rather than producing messages of their own, with the POC adding the reason the stories omit: modelling the FX leg separately would inject the FX provider into Tazama's graph as a synthetic counterparty on every cross-border payment and corrupt velocity scoring. Worth carrying into the story set.

### 7.2 🟠 `GrpHdr.MsgId` — ULID vs. deterministic

| | Stories | POC |
| --- | --- | --- |
| Construction | PPA-generated **ULID**, pinned at first assembly | **Deterministic**: `` `${anchor}-${isoMessageType}` `` |
| On retry | reuse the pinned value | same value by construction, even if rebuilt |

Both satisfy "never copied from the wire" and "same value on every retry". The POC's is arguably safer — a rebuild cannot produce a fresh id and defeat TMS-side dedup — but it makes the message id derivable from the anchor, which is a correlation-surface consideration worth a moment's thought, and it is a literal divergence from US-PPA-08/09/10/11's acceptance criteria. Cheap to align either way; decide once and apply to all four builders.

### 7.3 🔴 `pacs.008` field sourcing — the biggest enrichment gap

US-PPA-10 specifies sourcing from the prepare **plus cached enrichment from up to five prior messages**. The POC wires far less of it:

| Target | Stories: source | POC | |
| --- | --- | --- | --- |
| `PmtId.InstrId` | `transferId` | anchor | 🟠 §4 |
| `PmtId.EndToEndId` | **decoded ILP** `transactionId` | anchor — "the same value, without the decode" | 🟠 |
| `Cdtr` / `CdtrAcct` | **decoded ILP packet payee identity** (R-30, Critical) | from the **cached quote's** payee | 🟠 different source, and the story's is the reviewed one |
| `IntrBkSttlmAmt` | `amount` | ✅ | 🟢 |
| `DbtrAgt` / `CdtrAgt` | `payerFsp` / `payeeFsp` | ✅ via `FinInstnId.ClrSysMmbId.MmbId` | 🟢 — and correctly **not** `Othr.Id` |
| `Dbtr.Nm` / `InitgPty.Nm` | cached quote `personalInfo.complexName` | ✅ | 🟢 |
| `Dbtr…BirthDt` | cached quote `dateOfBirth` | **sentinel `1900-01-01`, always** | 🔴 F7 — no source exists |
| `Purp.Cd` | cached quote `transactionType` (authoritative over ILP) | **`PLACEHOLDER` on `pacs.008`** — though correctly sourced on `pain.001` | 🔴 |
| `RmtInf.Ustrd` | cached quote `note` | **`PLACEHOLDER`** | 🔴 |
| `ChrgBr` | cached quote **callback** | **`PLACEHOLDER`** | 🔴 |
| `ChrgsInf` | cached callback `payeeFspFee` | **`PLACEHOLDER` amount** | 🔴 |
| `GrpHdr.SttlmInf.SttlmMtd` | cached callback `SttlmMtd` | `PLACEHOLDER` | 🟠 |
| `InstdAmt` | cached FX quote `sourceAmount` | **= `IntrBkSttlmAmt`** | 🔴 |
| `XchgRate` | derived from cached FX quote | **omitted** | 🔴 |
| `RgltryRptg`, `Glctn` sentinel, `NbOfTxs` | PPA-generated constants | ✅ | 🟢 — the POC learned `RgltryRptg` the hard way: a live TMS rejected the message without it |

**Read that table as a work list, not a criticism.** The POC's `pacs.008` is structurally valid and TMS-accepted, but a large share of the enrichment that makes it *useful to a fraud engine* — charges, purpose, remittance info, the FX rate and source amount — is placeholder. The cached `quoteCallback` and `fxQuote` slots are populated and simply never read by `toPacs008`.

**The degraded flag is also coarser than specified.** POC: `degraded = !state?.quote` — a single boolean on whether the quote merged. Stories: degraded whenever **any** fallback is applied, per FSD §6.4.3's table. Under the POC's rule a `pacs.008` with placeholder charges, purpose and FX rate reports as *not degraded* so long as the quote was cached. Since US-PPA-10 makes the audit-log flag "the only record that a fraud decision was made on partial data", this understates reality.

### 7.4 🔴 `pacs.002` identifier resolution

```
Stories (US-PPA-11):  OrgnlInstrId/OrgnlEndToEndId  ←  cached { InstrId, EndToEndId } written after the pacs.008
                      "PPA does not assume transactionId == transferId"

POC:                  OrgnlInstrId = OrgnlEndToEndId = anchor
                      TransactionState.identifiers declared — "nothing writes it"
```

Under the anchor model the values coincide, so the POC's output is correct *for the data it has seen*. But the mechanism the story requires does not exist, and the failure mode is the silent one the story names: **TMS accepts the `pacs.002` and never links it to its transfer in Tazama's graph.** No error, no metric, no alert — the transaction simply never completes.

Notably, the POC's own Technical Design §3.4 **specifies this mechanism correctly** ("when the `pacs.008` is emitted, the PPA writes `transferId → { InstrId, EndToEndId }` into the transaction state") and then the implementation removed the need for it as a consequence of the anchor deviation. If the anchor model is kept, that is a defensible simplification — but it should be an *explicit, recorded* decision with the equality assertion stated as a load-bearing assumption, not a silent side effect.

### 7.5 🔴 `TxSts` translation

| | Stories | POC |
| --- | --- | --- |
| `COMMITTED` → `ACSC` | ✅ | ✅ |
| `RESERVED` → `ACSP` | ✅ | ✅ |
| `ABORTED` → `RJCT` | ✅ | ✅ (plus `REJECTED`) |
| **`COMM` → `ACSC`** | ❌ missing | ✅ |
| **`RESV` → `ACSP`** | ❌ missing | ✅ |
| Unknown value | (unspecified) | falls through to `PDNG` |
| Rejection → `RJCT` | via "error callback" | **resolved structurally**, never through the lookup |

Both sides agree `ACSC`, not `ACCC`, and both state that this is a *correctness* duty rather than a validation one — no schema catches it. The stories are missing the ISO vocabulary (F10), and are missing the POC's sharpest insight: running `'RJCT'` back through the translation table finds no match and **silently yields Tazama's `PDNG` default**. The POC keeps `toRejectedPacs002` deliberately separate from `toPacs002`/`toTxSts` for exactly this reason. That separation should be an acceptance criterion, not an implementation detail.

### 7.6 🟢🔵 Pinned schema validation — take it wholesale

US-PPA-12 is satisfied by the POC almost line for line, and the POC closes the story's own open item:

- Pinned local copies of all four schemas, vendored into `ppa/src/schemas/tazama/`.
- **Pinned to a specific commit** — `frmscoe/tms-service` `f18317f1f7973623157e1467da78e6853c7b1b89`, package version 3.0.0. US-PPA-12 lists identifying this commit as a prerequisite "before implementation begins"; **it is already identified.**
- Validated with **the same ajv configuration TMS itself uses**, which the story requires and which is the whole point.
- Failure ⇒ permanent defect, not sent, not retried.
- **It has already caught two real defects.**

The one story requirement not present: the dedicated `pacs.008` field-completeness regression check (`EndToEndId`/`Dbtr`/`Cdtr`/`DbtrAcct`/`CdtrAcct` present on every non-degraded output — R-35). Add it.

---

## 8. Durability, recovery, and the error path

### 8.1 🟢🔵 Out-of-order and persist-and-retrieve — the POC exceeds the story

| Requirement | POC |
| --- | --- |
| US-PPA-16: park state before ValKey TTL expiry | ✅ `park-sweep.service.ts` — the proactive half, because ValKey emits "gone", never "about to expire". **Live-verified**: a leg watched being parked twice as its TTL approached. |
| US-PPA-16: retrieve parked state on late arrival | ✅ `resolveLateOrEarlyState` checks the durable store first |
| US-PPA-16: parking raises a *distinct informational* alert, not a failure alert | ✅ the POC states the same distinction — "a parked entry is live recovery state, not a terminal record" |
| US-PPA-17: hold and retry within a bounded window, reusing the existing retry budget | ✅ exactly this, then parks the trigger envelope itself |
| US-PPA-17: late prepare retrieves the parked fulfil | ✅ `completeParkedTriggerAfterPrepare` |
| **Beyond the story** | 🔵 the replay fires **only once this leg's own `pacs.008` has actually reached TMS** — not merely once *some* state exists. An earlier version got this wrong; a live replay of the partition-split capture caught it emitting `pacs.002` before `pacs.008` existed, which then made the real prepare arrive to find its state cleared and be discarded as domestic. **`pacs.008` never sent at all.** |
| **Beyond the story** | 🔵 `POST /admin/replay/:key` — operator-triggered restore of a parked leg, read-only on the durable copy so it is repeatable |
| R-29 (open): the story's out-of-order rationale is stale | 🔵 the POC holds the corrected one — partition split under a fresh trace id, confirmed by capture |

`completeParkedTriggerAfterPrepare`'s ordering rule is a hard-won invariant that no reading of the story would produce. **Carry it forward as an acceptance criterion.**

### 8.2 🟡 The DLQ

| Requirement (US-PPA-15) | POC |
| --- | --- |
| DLQ = the write-ahead store, one store two write paths | ✅ architecturally; the store is real, filesystem-backed, temp-file-then-atomic-rename |
| **A real DLQ write path on permanent TMS failure** | ❌ **not built** — currently logged and dropped |
| Every DLQ write raises an operations alert | ❌ |
| 90-day retention, then purge/archive | ❌ nothing prunes |
| Operator-triggered replay with a `replay-of` audit pointer | 🟡 replay exists for *parked state*, not for DLQ entries; no `replay-of` pointer |
| Entries carry envelope, reason, retry count, timestamp, `correlationId`, `isoMessageType` | 🟡 partial |
| Keyed retrieval by `transferId`, not sequential scan | ✅ |

The store's *shape* is right and every call site goes through one module, so swapping the backing technology is a rewrite of one file. The DLQ *semantics* are largely unbuilt.

### 8.3 🟠 MLA retry exhaustion vs. circuit breaking

The stories (US-MLA-07, resolving R-08) describe **two coordinated mechanisms with a distinct intermediate state**:

1. Retry ×3 → exhausted → **park this event, keep periodically retrying it**, offset paused.
2. Those repeated failures accumulate toward a **configurable N**; at N the breaker trips and pauses the whole partition.

The POC **collapses these into one**: `dispatchToPpa` exhausts its 3 attempts and immediately returns `Pause`, which calls `tripAndPause` — pausing the partition and starting a `GET /health/ready` re-probe. There is no N-consecutive-failures threshold on the MLA side at all.

Recovery behaviour ends up similar (paused partition, health probe, resume). What is lost is the story's failure *accounting* — the ability to distinguish "one flaky event" from "PPA is systemically down". Note the asymmetry: the POC's **PPA→TMS** breaker *does* have a configurable threshold (`TMS_CIRCUIT_FAILURE_THRESHOLD`, default 5, and a `4xx` deliberately never counts). Bring the MLA side up to the same model.

Aligned on the rest: 3 retries, exponential backoff with **genuinely random** jitter, 4xx ⇒ advance, 5xx/timeout ⇒ pause, unreadable ⇒ advance, no DLQ on the MLA side because the audit topic's retention is the buffer. Both sides also flag FSD Open Item #8 (whether permanent failures should advance) and Open Item #1 (timeout values — both `.env.template` defaults are explicitly labelled placeholders).

### 8.4 🔴 The error path

| | Stories | POC |
| --- | --- | --- |
| Model | "any error callback → `pacs.002` / `TxSts: RJCT`" | three **confirmed** rejection shapes, handled individually |
| Transfer-prepare rejection | not distinguished from a normal callback | ✅ detected by `StsRsnInf` shape, classified as terminal, translated via a dedicated builder, **live-verified against a real TMS** |
| FX-quote rejection | would trigger a `pacs.002`/`RJCT` under US-PPA-05's blanket rule | ❌ **deliberately not forwarded** — every confirmed occurrence dies before `postQuotes` fires, so no `pain.001` was ever sent and there is nothing in Tazama's graph to close out. Counted at the MLA (`discarded.fxQuoteRejected`). |
| Party-lookup rejection | out of scope | ✅ out of scope |
| Reason code / description | audit log only (Tazama's `pacs.002` has no `StsRsnInf`) | ✅ same conclusion, reached by hitting the limitation live |
| "Never synthesize a `pacs.002`" | **R-04, Critical, still has zero acceptance criteria** | ✅ stated and implemented — "a `pacs.002` is never synthesised" |

**The FX-quote decision deserves scrutiny.** The POC's symmetry argument is good — nothing was submitted, so nothing needs un-submitting, exactly like the domestic discard. But it rests on an unverified premise: *can an FX quote fail **after** a `pain.001` has already been sent?* No capture has shown it. The POC flags this as its own open question. Under US-PPA-05 as written, the answer is "always emit an RJCT", which would be wrong for every observed case. **Neither position is safe to adopt without answering the question.**

**R-04 can be closed from the POC.** The stories' single highest-consequence rule has no acceptance criteria; the POC has working behaviour to lift them from.

---

## 9. Security and PII

### 9.1 🔴 PII: different mechanism, different scope, different service

These are not two versions of the same thing, and it would be easy to mistake them for one.

| | Stories (US-PII-01/02) | POC (`pii-mask.service.ts`) |
| --- | --- | --- |
| Where | **inside MLA**, before the envelope leaves | **inside PPA** |
| What is transformed | the **payload itself** — party identity fields in `body` | **only what reaches a log line or the audit store** |
| What TMS receives | tokenized values | **unmasked, by design** — TMS needs real party data to build its graph |
| Method | keyed hash + **recognizable prefix** | keyed HMAC-SHA256, deterministic |
| Ordering constraint | **after** JWS validation, enforced by a test that fails if reordered | n/a — no signature validation exists |
| ILP-carried fields | explicitly exempt (cryptographically bound) | same conclusion — "cannot be masked at all without breaking the payment" |
| Secret handling | loaded at startup; **readiness fails if it did not load** | `PII_MASK_KEY`, warns loudly at first use if left at the POC default, but **still starts** |
| Failure mode if it cannot run | undecided — needs a CCH decision before go-live | n/a |

**The POC's masking is genuinely partial and says so.** The stories' tokenization is a different and larger piece of work that the POC lists under "not started". What the POC does contribute is the confirmation that the ILP exemption is real, and a working deterministic-masking primitive (correlatable without being identifiable) that the audit-log requirement (US-AUD-01) needs regardless.

One factual note for the story set: the POC observes the captures carry **unmasked MSISDNs and full names throughout** — consistent with the tokenization component sitting upstream of the topic, but never independently confirmed to have been running. The stories' US-PII-01 note that "the forensic audit topic's own persisted record predates this step" is the same observation, and both are right to flag it to whoever owns that forensic record.

### 9.2 🟡 JWS

POC: `hasFspiopSignature` — **header presence only**, explicitly not cryptographic. Stories: full RS256/384/512 verification against the sending DFSP's registered key, on every event type, no exemptions, with configurable key lookup that does not require a restart.

A pure gap, known and deliberate. Two things the POC contributes:

- 🔵 **FSD Open Item #3 is resolved** (F8) — real signatures are present on every canonical record, so the story is unblocked.
- 🔵 Signature presence **corroborates the canonical-record table** independently: every canonical record carries one, every non-canonical counterpart does not. That is a useful cross-check to keep as a test assertion.

Still unresolved on both sides: how MLA sources DFSP public keys, and how a key-source outage is distinguished from a genuine signature failure.

### 9.3 🟡 Transport

mTLS on both hops and the Auth-lib → Auth-service → Keycloak bearer chain are required by US-MLA-06, US-PPA-01 and US-PPA-13 and are **not started** in the POC — deployment-stage work with no local environment to validate against. Uncontroversial.

One POC item to carry: `POST /admin/replay/:key` and `GET /admin/audit/:key` have **no authentication or scoping** and are flagged POC-only. They must not reach production in that state.

---

## 10. What the POC proved that the stories should absorb

Ten items where the POC holds something the story set does not, and should.

| # | What | Where it lands |
| --- | --- | --- |
| 1 | The per-operation canonical table, and `prepareTransfer`'s overloaded egress | Rewrite US-MLA-01's ingestion criterion (F1–F3) |
| 2 | `operation` is a deterministic 13-value classifier; `transactionType` is the unreliable field | Rewrite US-MLA-02's classification signal (F4) |
| 3 | FSD Open Items **#3, #4, #5, #7 are resolved**, and #2 superseded | Update core-knowledge §13.1 (F5–F9) |
| 4 | Date of birth is **absent everywhere** — structural, not a fallback | US-PPA-08/10 field tables (F7) |
| 5 | A second `TxSts` vocabulary (`COMM`/`RESV`) exists on the wire | US-PPA-11's translation table (F10) |
| 6 | The real rejection shape, and why `RJCT` must be resolved structurally rather than via the lookup | US-PPA-05/11, and R-04's missing criteria (F11) |
| 7 | `completeParkedTriggerAfterPrepare`'s ordering rule — replay only after **this leg's own** `pacs.008` reached TMS | US-PPA-17 acceptance criterion |
| 8 | The parked-and-replayed event must bypass the dedup check or it is discarded as a duplicate of itself | US-PPA-04 acceptance criterion |
| 9 | The corrected out-of-order rationale — partition split under a fresh trace id | Closes R-29 |
| 10 | The pinned `tms-service` commit, already chosen and validated against | Closes US-PPA-12's prerequisite |

Three of these (7, 8, and the `reserveFxTransfer` drop in §3.1) were found **only by replaying real captures through the compiled pipeline**. None would have been found by reading a story or by unit tests alone — which is the concrete case for [engineering-rules.md](../engineering-rules.md) §11.

---

## 11. What the stories require that the POC never built

| Area | Requirement | Story |
| --- | --- | --- |
| Security | Cryptographic JWS verification; per-DFSP key lookup without restart | US-MLA-05 |
| Security | mTLS on both hops | US-MLA-06, US-PPA-01 |
| Security | Keycloak bearer-token chain, proactive refresh, separate refresh-failure alert | US-PPA-13 |
| PII | Payload tokenization inside MLA, with the validate-then-tokenize ordering test | US-PII-01/02 |
| PII | Tokenization-failure-rate metric and alert | US-PII-01 |
| Idempotency | One durable, atomic, pre-translation check-and-set across all four types | US-PPA-04 |
| Scope | `determiningTransferId` in the domestic discriminator | US-PPA-07 |
| Correlation | `transferId → { InstrId, EndToEndId }` written after the `pacs.008` | US-PPA-10/11 |
| Translation | Quote-callback and FX-quote enrichment actually read into the `pacs.008` | US-PPA-10 |
| Translation | Per-fallback degraded flagging, not one coarse boolean | US-PPA-10 |
| Validation | The `pacs.008` field-completeness regression check | US-PPA-12 (R-35) |
| Back-pressure | Breaker state feeding the step-1 503 gate | US-PPA-13 |
| Back-pressure | A configurable N-consecutive-failures threshold on the MLA side | US-MLA-07 |
| DLQ | A real write path on permanent failure, alerts, 90-day retention, `replay-of` pointers | US-PPA-15 |
| Ops | Alerting destinations for every alert path | US-MON-01 (R-37) |
| Ops | Real metrics backend — the POC's counters are in-process, per-replica | US-MON-01 |
| Infra | HA ValKey; production write-ahead technology sized for **125 TPS peak** | US-PPA-02/06 |
| Infra | Auth on the `/admin` routes | — (POC-only surface) |

---

## 12. Reuse verdict, component by component

| Component | Verdict |
| --- | --- |
| `mla/src/clients/kafka.ts` (`autoCommit: false`, advance/pause/resume) | **Reuse.** The offset contract is exactly what US-MLA-01/06/07 require. |
| `isCanonicalRecord` + `CANONICAL_ACTION_BY_OPERATION` | **Reuse, and rewrite the story to match.** §3.1 |
| `classifyEventType` / `classifyMsgType` | **Reuse the mechanism, revise the tables** — drop `MsgType.Notification` (F12 is settled — `commitTransfer`, `plan.md` §3.1, D5). |
| `isTransferRejection` / `isFxQuoteRejection` / `extractRejectionError` | **Reuse.** No story reproduces this and both are needed. |
| `resolveAnchorId` + the chaining maps | **Reuse only if the anchor model is kept**, and move the maps out of process. §4 |
| `buildEnvelope` | **Revise** — `id` scheme (§4), `msgType` (§5.2), and the `error` field's fate (§5.3). |
| `hasFspiopSignature` | **Replace** with real verification. |
| `dispatchToPpa` + `tripAndPause` | **Reuse the shape; add the N-threshold.** §8.3 |
| `ppa/src/clients/cache.ts` (Lua merge, `restoreState`) | **Reuse wholesale.** The strongest-evidenced module in the POC. §6.6 |
| `claimSentGuard` | **Delete.** Replace with the durable pre-translation check-and-set. §6.3 |
| `write-ahead.store.ts` | **Reuse the interface, replace the backing.** Add the DLQ semantics. §8.2 |
| `park-sweep.service.ts` + `resolveLateOrEarlyState` + `completeParkedTriggerAfterPrepare` | **Reuse wholesale**, ordering invariant included. §8.1 |
| `isDomesticTransfer` | **Fix** — add `determiningTransferId`. §6.4 |
| `iso20022.ts` — `toPain001`, `toPain013` | **Reuse as a base**; verify against US-PPA-08/09, resolve R-13 (`InstdAmt` for `amountType: RECEIVE`). |
| `iso20022.ts` — `toPacs008` | **Extend substantially.** The skeleton and the TMS-validated constants are right; most enrichment is placeholder. §7.3 |
| `iso20022.ts` — `toPacs002` / `toRejectedPacs002` | **Reuse the two-builder split**; add identifier resolution. §7.4 |
| `toTxSts` + `TX_STS_TRANSLATION` | **Reuse** — it is more complete than the story's table. §7.5 |
| `tazama-schema.validator.ts` + `src/schemas/tazama/` | **Reuse wholesale**, plus the R-35 completeness check. §7.6 |
| `audit-log.store.ts` (anchor-indexed, best-effort writes) | **Reuse.** Anchor-indexing over `correlationId` is the right call and the story set does not specify it. |
| `pii-mask.service.ts` | **Keep for audit/log masking**; it is not the tokenization US-PII-01 asks for. §9.1 |
| `metrics.service.ts` (both) | **Reuse the counter set, replace the transport.** |
| `demo:replay` / `demo:loadtest` | **Reuse, and keep them checked in.** They found three of the ten findings in §10. |
| `/admin/*` routes | **Reuse behind auth**, never as-is. |

---

*End of Document*

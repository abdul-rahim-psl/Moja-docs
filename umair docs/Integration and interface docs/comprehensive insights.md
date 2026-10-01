# Comprehensive Insights — Integration & Interface Document v3.1

**Source documents analyzed:**
- `Integration_and_Interface_Document_v3.1.md` (primary)
- `Tazama_Rules_ML_Customization_FSD_v3_0.md` (cross-referenced throughout, especially §1.2 scope exclusion and §5.5/§5.14)

**Purpose of this file:** a thorough, structured breakdown of what the v3.1 IID actually says, how it relates to the Rules/ML FSD, and every open risk/gap/inconsistency worth tracking. Intended for someone who needs the full picture without re-reading the 881-line source document.

---

## 1. What This Document Is and Isn't

The IID is the **cross-reference/contract document** for the entire Tazama fraud pipeline built for COMESA's DRPP (Mojaloop-based switch) under the CCH–Paysys Labs contract. It does not describe how any single component works internally — that's left to four component FSDs:

| FSD | Covers |
|---|---|
| `CCH_FSD_MessageIngestion_v3.0.md` | MLA (Mojaloop Adaptor) + PPA (Payment Platform Adaptor) |
| `CCH_FSD_CaseManagement_v2.1.md` | CMS/CIMS (Case & Investigation Management System) |
| `Tazama_BIAR_FSD_v1_0.md` (internally versioned v1.2) | BIAR/Data Lakehouse ecosystem |
| `Tazama_Rules_ML_Customization_FSD_v3_0.md` | Fraud/AML rule & typology parameter configuration (the 33 in-scope rules) |

The IID's job is to specify **what crosses each system boundary**, in what format, over what protocol, triggered by what, and how failures are handled — plus a single consolidated API/endpoint master reference (§6).

**Explicitly out of scope** (§1.2): internal business logic of any component, infrastructure sizing/hosting/topology, CIMS UI/workflow detail, and — importantly — ATM model training/retraining methodology and the 33 individual rule parameter/band definitions (deferred entirely to the Rules/ML FSD). The rule processors are treated as **one internal hop**, not 33 separately-specified interfaces.

---

## 2. Version Evolution — Why v3.1 Looks the Way It Does

This is not a document that arrived fully formed. Its revision history matters for interpreting confidence levels:

- **v0.1 → v1.0**: Initial consolidation, then a full review against an internal skill (`AI Skills/interface-spec-review/SKILL.md`), which re-cited sources, added the Rules/ML FSD as a fourth source, and gave every interface a full technical contract.
- **v2.0**: A **ground-up rewrite**, not incremental. Two major naming/architecture corrections: TADProc → **Event Adjudicator**, and DRPP confirmed as the platform's real name (replacing "RRPS"). Also re-modeled joint Fraud & AML alerts as **two independent cases** instead of a parent/child hierarchy — a genuine behavioral change, not just a rename. Added §6 (API Master Reference) for the first time and gave the CIMS unstructured-evidence pipeline its own interface entry.
- **v3.0**: A **tech-team review pass** with 16 discrete corrections, most notably: removed two entire subsystems (DEAPI, Simulation Sandbox) that were never actually in scope; flagged the `/QUOTES`/`/TRANSFERS` aggregate-endpoint design as unresolved rather than settled; flagged a schema mismatch between the documented Alert payload and the live CIMS Prisma model; and resolved a self-contradiction between §5.2 and §7.3 by defining two explicitly separate keys (event dedup vs. transaction correlation).
- **v3.1 (current)**: A **narrow, surgical update** — only §6 changed. This revision is grounded in **direct source-code review of seven pipeline repositories** (`tms-service`, `event-director`, `rule-executer`, `typology-processor`, `event-adjudicator`, `case-management-system`, `biar`), a fundamentally different evidence basis from the rest of the document, which is FSD-sourced (i.e., based on what design documents *say* should happen, not what code *actually does*). This distinction — FSD-sourced assumption vs. code-confirmed fact — is the single most important interpretive lens for this document, and the authors are careful to flag it everywhere it matters.

**Practical implication:** anywhere §6 disagrees with §5, treat §6 as the more reliable, current-state source, and §5 as the design intent that may or may not have been implemented as specified.

---

## 3. Architecture — The Full Pipeline

### 3.1 Primary transaction/alert pipeline (canonical, per §3.1)

```
DRPP → MLA → PPA → Tazama TMS → Event Director → Rule Processors →
Typology Processor → Event Adjudicator → Alert Triage Module (ATM) → CIMS
```

Note: the Message Ingestion FSD's own system-context diagram is simplified and **omits** the Event Director and Event Adjudicator stages. The IID treats its own, more complete diagram as canonical and tracks correcting the source FSD's diagram as an open item (#4) rather than fixing it here.

### 3.2 Analytics/configuration surface (BIAR + Rules Engine)

This sits **alongside**, not inside, the primary pipeline — it consumes outputs (transaction/alert data) and feeds configuration back in, rather than being on the request path:

```
TMS ODS ─┐
CIMS ODS ─┼─(NiFi)→ Raw Layer (Apache Ozone) → Bronze/Silver/Gold →
CIMS Unstructured (CouchDB) → Tika → Solr ─┘         JupyterHub (analyst access)
CIMS/Tazama Alerts ──(NATS)───────────────→ Raw Layer

External FX Provider ⇢ (pre-Tazama conversion, out of scope) ⇢ DRPP transaction
Gold Layer ⇢ (read-back, detail TBC) ⇢ CIMS
```

---

## 4. Glossary — Key Concepts Worth Internalizing

- **DRPP** = Digital Retail Payment Platform (COMESA's Mojaloop-based switch, formerly RRPS). **Inconsistency flagged**: the Rules/ML FSD glossary still says "Digital Retail Payment **System**" — confirmed directly by reading that document's §2 Glossary line 72 (`"Digital Retail Payment System — COMESA's Mojaloop-based payment switch"`). This is a real, still-unresolved naming drift between documents (Open Item #24).
- **MLA**: subscribes to DRPP Kafka topics, relays events to PPA unmodified.
- **PPA**: correlates request/callback pairs, translates Mojaloop ISO 20022 → Tazama's own ISO 20022 message set, forwards to TMS.
- **Event Director → Rule Processors → Typology Processor → Event Adjudicator**: the internal Tazama evaluation engine. Treated as a black box/single hop by this document (per §1.2), and its field-level rule bindings are the Rules/ML FSD's job, not this document's.
- **ATM (Alert Triage Module)**: AI/ML component scoring every alert before a human sees it. Explicitly **not** real-time fraud detection — Inception Report §6.2 excludes real-time AI/ML fraud detection from Paysys Labs's contracted scope. It only acts on alerts already generated by the rule/typology engine. Its authority to auto-close a case without human review makes it a dedicated threat-model subject.
- **Joint Fraud & AML Case**: when `alertType = FRAUD_AML`, CIMS creates **two independent cases**, not a parent/child pair, coordinated by a "non-case coordination process" with no status/owner of its own.
- **Case Priority vs. SLA State**: Priority is static (set once, 0.0–1.0 → LOW/MEDIUM/HIGH). SLA State is dynamic (ON_TRACK/AT_RISK/DUE_SOON/BREACHED), computed on every read against a stored deadline — no background recalculation job exists.
- **Corridor**: an ordered source-currency → destination-currency pair. This is the load-bearing currency-handling concept across **both** documents (see §7 below) — the Rules Engine configures thresholds/baselines per corridor instead of converting to one reference currency at runtime.
- **External FX Provider**: a third-party, out-of-control system. Neither document can specify a technical contract for it — not because of an oversight, but because no protocol/format for it exists anywhere in any source material.

---

## 5. Integration Points Catalog (§4) — Full Inventory

18 numbered integration points span the whole pipeline, from DRPP event publish through to BIAR analyst access. Highlights and what to watch:

- **#1–#4**: DRPP-side Kafka publish → MLA consume → PPA forward (HTTPS+JWT) → TMS submit (HTTPS+Bearer). All async except internal hand-offs.
- **#5–#8**: Internal Tazama hops (TMS→ED→Rule Processors→Typology Processor). Sync/parallel fan-out, no schema given anywhere (deliberately out of scope, §5.4).
- **#9–#10**: Event Adjudicator → ATM → CIMS. REST/NATS, async, triggered by alert-threshold and triage decision respectively. Joint alerts fan out to **two** cases here.
- **#11–#13**: CIMS-internal (investigation context, evidence upload, regulatory filing).
- **#14**: External FX conversion — explicitly "unspecified — outside this document's authority to define."
- **#15–#18**: BIAR ingestion paths (multi-source → Raw layer, unstructured evidence extraction, alert streaming, analyst access via JupyterHub).

**Deliberately excluded from the numbered catalog**: Lakehouse read-back (Data Lakehouse → CIMS). It appears only as a diagram annotation with no protocol, schema, or purpose specified anywhere — the authors chose not to fabricate a contract for it (§5.16, Open Item #12).

---

## 6. Detailed Interface Specifications (§5) — Key Contracts

### 6.1 DRPP → MLA (Kafka, §5.1)
Per-action topics: `topic-quotes-post/put`, `topic-fx-quotes-post/put`, `topic-transfer-prepare/fulfil`, `topic-notification-event`. MLA uses a **dedicated consumer group**, never a DRPP-internal group name (to avoid stealing partitions from a live payment-path handler). Idempotency is explicitly deferred downstream to PPA.

### 6.2 MLA → PPA (Event Envelope, §5.2)
Two broad endpoints: `POST /QUOTES`, `POST /TRANSFERS`, plus `GET /health`. Each groups multiple message types/variants behind one path — flagged as an **open design question** (Open Item #20), since Mojaloop's own Kafka ingress is per-action, a natural separation this API currently collapses.

Envelope fields: `msgType` (HTTP method, POST/PUT), `eventType` (QUOTE/FXQUOTE/TRANSFER/FXTRANSFER — a *normalized resource family*, not Mojaloop's actual action identity), `id` (per resource-type ID scheme), `fspiop-source`/`fspiop-destination`, `body`, `timestamp`.

**Important disclaimer carried in the doc itself**: `eventType`/`msgType` must never be conflated with Mojaloop's actual per-action topic/message identity (`pacs.081` etc.) — they're this envelope's own internal classification. Recommended fix (not yet implemented): separate `sourceTopic`/`sourceAction`/`isoMessageType` fields (Open Item #22).

Auth: JWT bearer, mandatory, HTTP 401 if missing. TLS 1.2+, mTLS recommended.

### 6.3 PPA → Tazama TMS (§5.3)
PPA correlates request/callback pairs via a **ValKey cache**, translates to Tazama's own ISO 20022 message set:

| Event Pair | Output | TMS Endpoint (per FSD) |
|---|---|---|
| Quote req+callback | pacs.081 + pacs.082 | Two separate endpoints |
| FX Quote req+callback | pacs.091 + pacs.092 | Two separate endpoints |
| Transfer req+callback | pacs.008 | One endpoint |
| Final-state notification | pacs.002 | One endpoint |
| FX Transfer req+callback | pacs.009 | One endpoint |

**Key clarification the document makes explicit**: "one correlated pair" does not always mean "one TMS submission" — Quote/FX-Quote produce **two** separate wire messages per pair. Ordering, idempotency, and partial-failure handling across those two POSTs remain unspecified (Open Item #21).

**⚠️ Critical discrepancy resolved in §6.1 (v3.1's own finding)**: the actual `tms-service` code does **not** implement any `/api/transaction/pacs.xxx` routes as described here. See §8 below for the real endpoints.

Auth: bearer token via **Auth-lib → Auth-service → Keycloak** chain — dynamically fetched, not static config.

### 6.4 Internal Tazama hops (§5.4–§5.7)
TMS → Event Director → Rule Processors → Typology Processor → Event Adjudicator. **No schema exists anywhere for these** — deliberately out of scope, treated as internal hand-offs. The Rules/ML FSD's §6 (rule-by-rule specification) is the closest thing to detail here, but it's about rule *content* (which fields each of the 33 rules reads), not the integration boundary itself.

### 6.5 Event Adjudicator → Alert Triage Module (§5.8)
Delivered via **REST (sync)** or **NATS (async, high-throughput)**. Latency budget: **100ms p95** to CMS ingest endpoint (confirmed in Case Management FSD §20.2).

**Alert payload schema** — and a major flagged risk: the documented schema (from Case Management FSD's prose/sample) is **materially different** from the live CIMS Prisma `Alert` DB model:

| Documented field | Live CIMS field | Difference |
|---|---|---|
| `alertId` (string) | `alert_id` | Autoincrement integer, not string |
| — | `tenant_id` | Required field with no documented counterpart |
| `alertPriority` | `priority`/`priority_score` | Different naming |
| `confidenceScore` (0–1 float) | `confidence_per` | Integer percentage, different scale |
| `evaluationContext.typologyScores` | `network_map`/`alert_data` | JSON blobs, not the documented nested structure |
| `transactionId` (string) | `transaction` | Full JSON object, not just an ID |
| `alertStatus` | *(no column)* | Missing entirely in the DB |
| — | `prediction_outcome`, `source`, `txtp`, `message`, `case_id`, `investigationGroup` | Dev-branch-only fields with no documented counterpart |

This is flagged as **Open Item #23** and is one of the four items the document's own closing note calls "most load-bearing before this draft advances." It means the interface **may not be directly implementable as specified** without either a translation/DTO layer or a schema update.

Idempotency for this hop: **not currently specified** — Open Item. NATS redelivery could cause duplicate alerts.

### 6.6 Alert Triage Module → CIMS (§5.9)
Decision matrix:

| ATM Prediction | Condition | Outcome |
|---|---|---|
| False positive | Confidence ≥ threshold (default 95%) | Auto-closed (`72_AUTOCLOSED_REFUTED`) |
| True positive | Confidence ≥ threshold, blocked or no ML indicated | Auto-closed (`71_AUTOCLOSED_CONFIRMED`) |
| True positive | Confidence ≥ threshold, ML suspected | Case created, investigated |
| Any | Confidence below threshold | Case created (ATM not confident enough to auto-close) |

**Fail-open requirement**: if ATM is disabled/misconfigured/down, all alerts must route to manual triage rather than blocking intake. Explicitly flagged as a **required target design, not a confirmed current capability** — no source states where (or if) this is actually implemented (Open Item #18).

**Joint Fraud & AML handling (§5.9.1)**: two independent cases, no parent/master case, coordinated by a non-case process. No wire-level schema exists yet for the grouping reference between the two cases (Open Item #2).

**ATM threat model**: because ATM can suppress an investigation entirely, its model artifacts/thresholds must be integrity-protected (signed model versions, Administrator-role-gated threshold changes), assessed for adversarial-input susceptibility, and every auto-closure must log model version + input feature summary + confidence score. A sample of auto-closed outcomes must be spot-reviewed by a supervisor.

Idempotency: **not specified** — NATS redelivery risk of duplicate case creation/closure, or (for joint alerts) a duplicate *pair* of cases.

### 6.7 CIMS-Internal Points (§5.10)
Covers investigation context (90-day Linked Items, **no pagination or caching specified** — Open Item #13), Evidence Ingest API (multipart upload, SHA-256 streaming hash, AES-256 at rest, **no confirmed byte-size/rate limits** — Open Item #14), and SAR/STR regulatory filing.

**SAR/STR filing has a two-part auth model** the document is careful to separate:
- Internal authorization (confirmed): restricted to CIMS users with the **Compliance Officer** role via existing Keycloak/RBAC.
- External authentication (unconfirmed): how CIMS authenticates *to the regulator's own system* is to-be-confirmed (Open Item #15).

### 6.8 BIAR Interfaces (§5.11–§5.16)
Mostly **PROPOSED**, not confirmed — grounded in the BIAR FSD's architectural constraints but not implementation-confirmed:
- Source ingestion → Raw layer (TMS ODS, CIMS ODS via NiFi)
- Unstructured evidence extraction: CouchDB → Apache Tika (text/metadata extraction) → Apache Solr (indexing) → Raw layer. **Binaries never reach the Lakehouse** — only extracted JSON, landed at `raw/case/dt=YYYY-MM-DD/`.
- Alert streaming ingestion via NATS (same Alert payload as §5.8, streamed into Raw instead of/alongside CIMS)
- Analyst access via JupyterHub (Keycloak OAuth2, read-only Gold-layer mount)
- Lakehouse read-back to CIMS: **not even a proposed contract** — pure diagram annotation, deliberately excluded from the main catalog.

**External FX Conversion (§5.14)**: explicitly un-contractable. What *is* confirmed: no live FX feed is available to rule evaluation at runtime, so all rules compare amounts per-corridor. This directly ties to the Rules/ML FSD (see §7 below) — **28 of the 33 in-scope rules** require a `currencyScope`, `restrictToSameCurrency`, or `corridorThreshold` parameter specifically because of this constraint.

---

## 7. Cross-Document Relationship: IID ↔ Rules/ML Customization FSD

The IID explicitly delegates two things entirely to the Rules/ML FSD (§1.2, §5.5): the 33 rules' individual field-level bindings, and ATM model training/retraining methodology. Reading the Rules/ML FSD confirms and deepens several points the IID only summarizes:

### 7.1 The corridor-based currency model is the single biggest shared concept
Both documents converge on the same operating assumption: **no live FX conversion is available inside Tazama** — an external, third-party FX provider converts currency *before* a transaction ever reaches DRPP, and neither document can specify a contract for that provider (IID §5.14 / Rules FSD §4.1, both point to the same gap).

Because of this, the Rules FSD defines a **`corridor`** concept (ordered source-currency → destination-currency pair) as the unit of configuration for thresholds, baselines, and tolerances — never a shared cross-currency reference figure. The IID's Glossary entry for "Corridor" and §5.14 both directly cite the Rules FSD (§5.1, §9) for the full per-rule breakdown rather than duplicating it.

**Concrete scope**: 28 of the 33 rules require one of `currencyScope` (`perCorridor`/`perCurrency`/`any`), `restrictToSameCurrency`, or `corridorThreshold` — a substantial fraction of the entire ruleset exists specifically to work around the absence of runtime FX conversion.

### 7.2 The Rules FSD's own naming inconsistency
The Rules/ML FSD's glossary (§2, confirmed by direct read) defines:
> **DRPP** | Digital Retail Payment **System** — COMESA's Mojaloop-based payment switch.

This directly contradicts the IID's Glossary (§2) and every other source FSD, which use **Digital Retail Payment Platform**. The IID flags this explicitly (Glossary note + Open Item #24) and recommends standardizing the Rules FSD to "Platform" pending CCH confirmation. This is a good example of the IID's overall discipline: rather than silently "fixing" a source document, it surfaces the conflict and tracks it as an open item.

### 7.3 Rules FSD's own pipeline description matches the IID's canonical diagram
The Rules FSD's Background & Context (§3) independently describes the same pipeline shape the IID treats as canonical (Mojaloop → PPA → TMS → Event Director → Rule Processors → Typology Processor → Event Adjudicator → CMS), which corroborates the IID's decision to treat this fuller diagram as canonical over the Message Ingestion FSD's simplified one (Open Item #4).

### 7.4 Key rule-level facts worth knowing (from Rules FSD, not detailed in IID)
- **33 rules in scope**; 2 dropped entirely (074, 075 — no geolocation field exists anywhere in Tazama's message set); 3 have band/result-structure changes beyond parameter tweaks (007, 018, 078); 28 fixed purely via cross-cutting parameters.
- **Rule 091** (Transaction Amount vs. Regulatory Threshold) is called out as the **highest-priority rule in the entire register** — a misconfigured or incomplete `corridorThreshold` lookup could let a reportable transaction pass undetected. This has **no safe default** and must be supplied by COMESA per active corridor before go-live (Rules FSD §8, Open Item #2 in that document).
- **Rule 028** (Age Classification) was previously non-runnable but is now fully restored, since date-of-birth is confirmed present in Mojaloop's messages and survives translation.
- **`identityResolutionRule`** (de-duplicating MSISDN/ALIAS/DEVICE identifiers referring to the same wallet) also has **no safe default** and directly weakens AML-relevant rules (008, 083, 084 — "multiple accounts" detection) if left undefined.
- The number of active COMESA corridors — needed to size the configuration/lookup footprint for `corridorThreshold` and all `perCorridor` rules — **is not yet stated anywhere** (Rules FSD Open Item #3).

### 7.5 Where the two documents' open items overlap
Both documents' Open Items sections are really describing the same underlying gaps from different altitudes:
- IID Open Item #11 (external FX provider's integration mechanism unspecified) ↔ Rules FSD §4.1/§3 (external dependency assumed already in place, not specified).
- IID's PII/data-handling section (§7.4, citing "date of birth per Rules FSD Rule 028") ↔ Rules FSD §8 Security section, which explicitly disclaims that masking/encryption/access-control for that same PII is *owned by the ingestion/storage layer*, not this document — i.e., neither document claims ownership of PII protection for DOB data; this is worth confirming isn't a genuine gap between the two.

---

## 8. §6 API/Endpoint Master Reference — The Code-Confirmed Findings (v3.1's Core Contribution)

This is what changed in v3.1 and is the most concrete, actionable content in the whole document — derived from reading actual source code, not FSD prose.

### 8.1 Tazama TMS real endpoints (§6.1) — **confirmed discrepancy vs. §5.3**
Actual routes in `tms-service`:

| Endpoint | Method | Purpose | Status |
|---|---|---|---|
| `/`, `/health` | GET | Health checks | Confirmed |
| `/v1/evaluate/iso20022/pain.001.001.11` | POST | Mojaloop Quote | Only when `QUOTING=true` |
| `/v1/evaluate/iso20022/pain.013.001.09` | POST | Mojaloop Quote Response | Only when `QUOTING=true` |
| `/v1/evaluate/iso20022/pacs.008.001.10` | POST | Mojaloop Transfer | Always mounted |
| `/v1/evaluate/iso20022/pacs.002.001.12` | POST | Payment status | Always mounted |
| `/swagger`, `/documentation` | GET | OpenAPI UI | Confirmed |

**No `pacs.081/082/091/092/009` routes exist anywhere.** This is a real, unresolved conflict between what the FSD says the PPA should call and what TMS code actually exposes — the document recommends reconciling this before the document leaves draft status.

### 8.2 Event Adjudicator → CIMS confirmed values (§6.2) — partially resolves Open Item #3
- CIMS alert-ingest REST endpoint: **`POST /ingest-alert`** (confirmed in `process-alert.controller.ts`)
- CIMS NATS consumer stream: **`CONSUMER_STREAM=investigation-service`**
- Event Adjudicator's **publish-side** NATS subject (`ALERT_PRODUCER` env var) is still **unset/unconfirmed** even in its own `.env.template` — so the consuming side is now known but the publishing side isn't.

### 8.3 Full CIMS-internal endpoint inventory (§6.3)
Concrete routes now resolve the generic §5.10 rows: investigation context/linked items, evidence ingest (8 routes incl. upload/download/verify/delete-attachment), SAR/STR reports (9 routes), case lifecycle (24+ routes covering the full state machine — abandon/reopen/suspend/resume/complete/close/approve/reject), tasks, alerts, triage, comments, filters, history, async tasks, notification preferences, admin, and user lookup.

### 8.4 Gold Lakehouse API (§6.4) — supersedes "detail TBC" status from §5.16
CIMS **actively calls** the Gold Lakehouse API (`/query`, `/execute_sql`) and exposes 10 analytics/visualization endpoints derived from it. This is a genuinely new finding — it means the Lakehouse read-back interface that §5.16 said had "no proposal at all" **does have a live, implemented mechanism**, just not one any FSD had documented yet.

### 8.5 Visualization Delivery (§6.5)
Jupyter/Voila reverse-proxy: 13 endpoints, several of which explicitly "mirror" the Gold Lakehouse routes from §6.4 (suggesting some duplication/two paths to the same data — worth checking if intentional).

### 8.6 Flowable BPM (§6.6) — entirely new finding
CIMS uses **Flowable** as its case/task workflow engine — not mentioned anywhere else in this document or any cited FSD. 11 endpoints covering process deployment, instance lifecycle, and task management.

### 8.7 CIMS Auth Service (§6.7)
Concrete mechanism behind the generic "Keycloak" references: `v1/auth/login|me|logout` (frontend-facing) and `{TAZAMA_AUTH_URL}/login`, `/users/:userId/roles`, `/users/:userId` (backend → Tazama Auth Service).

### 8.8 ATM outbound call (§6.8)
`triage.service.ts` makes a concrete outbound call to `{AI_MODEL_ENDPOINT}` when `TRIAGE_TYPE=AI` — confirmed in code, but the env var itself isn't set in `.env.example`. This confirms an endpoint *exists* but does **not** resolve whether ATM is payment-blocking, its build status, or fail-open implementation (Open Items #7, #17, #18 remain open).

### 8.9 BIAR repository status (§6.9) — important negative finding
**The `biar` repository contains no source code at all** as of 22 July 2026 — only `README.md`, `LICENSE`, `.github`, `.codacy.yml`. This means every BIAR interface in §5.11/§5.13/§5.15 remains purely FSD-sourced/proposed with zero code to verify against. This is a significant finding for anyone assuming BIAR is further along than it is.

---

## 9. Cross-Cutting Concerns (§7)

### 9.1 Auth & Transport
Every hop uses **TLS 1.2+ minimum**. JWT/mTLS for service-to-service; Keycloak-backed OAuth2 for human sessions; MFA **enforced** (not optional) for Supervisor/Compliance Officer/Administrator roles.

**Known gap**: no source FSD defines how the **MLA itself** obtains the JWT that PPA validates (only PPA's own outbound Auth-lib→Auth-service→Keycloak chain is documented) — Open Item #19.

### 9.2 Error Handling & Retry (consolidated table, §7.2)
- MLA→PPA and PPA→TMS: retry ×3 exponential backoff + jitter, circuit-break on sustained failure, dead-letter + alert on exhaustion. Kafka offsets withheld until downstream ack — a **deliberate hard-stop design**, not a gap, if the PPA's ValKey cache is unavailable.
- **Unresolved retry-storm risk**: Event Adjudicator → ATM → CIMS is structurally identical in shape to the already-fixed MLA→PPA→TMS chain, but **no equivalent jitter/circuit-breaker policy is confirmed** for it (Open Item #10).
- BIAR ingestion: push-based per the *currently-cited* BIAR FSD (source system owns retry) — but a tech-team review claims the *updated* pipeline is actually **pull-based**, directly contradicting the cited FSD text. The document deliberately does **not** adopt the unconfirmed claim over its cited source, and flags this as the single most load-bearing open item (#1).

### 9.3 Correlation, Idempotency & Dedup (§7.3) — three genuinely distinct keys
This section exists specifically to resolve a v2.0-era self-contradiction. The three keys, kept deliberately separate:
1. **Event redelivery dedup key**: `id` + `eventType` on the MLA→PPA envelope — recognizes a *retried copy of the same event*.
2. **Correlation cache key**: PPA's ValKey cache, keyed by business ID (`quoteId`/`transferId`/etc.) — matches a request to its own callback.
3. **Notification dedup key**: `transferId` + state — specifically for the Central Ledger's final-state notification, which can publish more than once per transfer. **Ownership of this dedup step (MLA-side vs. PPA-side) is unresolved** (Open Item #6).

Also unresolved: no dedup key exists at all for the Event Adjudicator→ATM→CIMS NATS hop, and no wire-level schema exists for the joint Fraud/AML case grouping reference.

### 9.4 Data Handling & Audit (§7.4–§7.5)
- Transfer-topic payloads arrive base64-encoded — decoding is a transport step, **not** a security control.
- PII masking in logs is required per each source FSD's own data-protection section — including **date of birth** (per Rules FSD Rule 028), a detail the IID explicitly cross-references rather than restating.
- Classification ("Restricted — Regulated Financial PII") must be carried across every boundary, including into BIAR's Raw layer where only extracted metadata (never binaries) crosses.

---

## 10. Non-Functional Considerations (§8)

### Latency budget (§8.1)
| Stage | Budget (p95) |
|---|---|
| DRPP → MLA → PPA | < 200ms |
| PPA correlation → TMS (cache hit) | < 500ms |
| TMS → ED → Rule Processors → Typology → Event Adjudicator | **Not budgeted anywhere** — Open Item #16 |
| Event Adjudicator → CMS ingest | 100ms |
| Envelope validation + persistence | 100ms |
| ATM feature assembly | 150ms |
| ATM model inference | 100ms |
| Decision write | 50ms |
| **Total (alert receipt → triage outcome)** | 500ms (REST) / 5s (NATS, batchable) |
| **End-to-end (DRPP → alert decision)** | **< ~1.2s, but this is a floor, not a ceiling** — the missing internal-fanout row means the true total is unknown |

A single cross-border FX payment can generate up to **6 ISO 20022 messages** across all stages.

### Availability (§8.2)
Every pipeline component is framed as a side-channel/monitoring component that can degrade without affecting live DRPP payments — **there is no in-line, payment-path-SLA component**, with one important exception under active investigation: whether any ATM outcome can actually gate an in-flight payment (rather than always acting post-settlement). If true, this would escalate ATM's own SLA from a UX target to a release-blocking requirement (Open Item #17).

---

## 11. Complete Open Items Register (§9) — All 24, Grouped by Theme

**Document/source conflicts:**
1. BIAR FSD pipeline conflicts — push vs. pull ingestion, NATS alert consumption disputed (most load-bearing item)
4. Message Ingestion FSD's diagram omits Event Director/Event Adjudicator
24. DRPP expansion inconsistency (Platform vs. System) between Rules FSD and everything else

**Missing schemas/contracts:**
2. Joint Fraud & AML wire-level grouping reference — no schema
3. Event Adjudicator → CMS endpoint/topic name — **now partially resolved by §6.2**
12. BIAR interface contracts (proposed, not confirmed) + Lakehouse read-back (no proposal at all)
23. Alert payload schema vs. live CIMS Prisma model — confirmed material mismatch

**Unresolved ownership/mechanism:**
6. Central Ledger notification-dedup: MLA-side or PPA-side?
19. MLA's own JWT acquisition mechanism — undocumented
11. External FX provider's actual integration mechanism — needs separate discovery

**Unconfirmed build/deployment status:**
7. ATM build status (new-build vs. existing/off-the-shelf)
17. ATM payment-blocking confirmation — changes SLA classification if true
18. ATM fail-open implementation status — required, not confirmed implemented

**Design decisions pending:**
8. Audit Log Service sync vs. async
9. TenantID enforcement layer (DB row-level vs. service-level vs. both)
20. `/QUOTES`/`/TRANSFERS` aggregate-endpoint design — intentional or should be split per-action?
21. Quote/FX-Quote two-message TMS submission — ordering/idempotency/partial-failure unspecified
22. MLA envelope `eventType`/`msgType` conflated with Mojaloop's real action identity

**Non-functional gaps:**
5. FX transfer topic names — pending Mojaloop Implementation Partner confirmation
10. Event Adjudicator→ATM→CIMS retry-storm risk — no jitter/circuit-breaker confirmed
13. Investigation Context pagination/caching — unspecified
14. Evidence Ingest rate limiting & payload byte limits — unconfirmed
15. SAR/STR Filing security & error handling — regulator-side auth/retry/idempotency all unconfirmed
16. Internal Tazama hop latency budget — no figure exists anywhere

**The four items the document's own closing note flags as most urgent before advancing past draft:** #1 (BIAR staleness/conflicting claims), #23 (Alert schema mismatch), #3 (endpoint-name gap, now partially resolved), #2 (joint-case grouping schema).

---

## 12. Notable Process/Documentation Discipline Worth Flagging

A few patterns recur throughout this document that are worth calling out explicitly, since they reflect a deliberately conservative documentation philosophy:

1. **Refuses to fabricate contracts.** Where no source material exists (External FX Provider, Lakehouse read-back), the document explicitly declines to invent a plausible-looking schema, instead labeling the gap and tracking it as an open item.
2. **Distinguishes "PROPOSED" from "confirmed" consistently.** Interfaces grounded in architectural principles but not implementation are explicitly marked PROPOSED (§5.11, §5.15) rather than presented as settled fact.
3. **Preserves disagreement rather than silently resolving it.** When a tech-team review's claims (BIAR pull-based, no NATS alert consumption) contradict the currently-cited BIAR FSD, the document keeps the FSD-grounded position and surfaces the conflict rather than picking a side without confirmation.
4. **Separates evidence bases explicitly.** §6's code-derived findings are explicitly called out as a "different evidence basis" from §5's FSD-sourced content, with disagreements between the two flagged rather than merged silently.
5. **Splits compound concerns that look similar but aren't.** E.g., internal CIMS authorization (Compliance Officer role) vs. external authentication to a regulator's system (§5.10.3) — two different security boundaries kept explicitly separate rather than described as one "auth" row.

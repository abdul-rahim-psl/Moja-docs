<!-- SPDX-License-Identifier: Apache-2.0 -->

# Core Tazama — Executive Summary

> An engineer-facing walkthrough of the Tazama real-time transaction-monitoring pipeline, from ingestion to alert. Each section lists the key things that actually happen in the codebase, with **reference points** (repo + file/function) so you can go and verify.

All service source lives under `/home/abdul-rahim/tazama/<service>`. All services are event-driven and communicate over **NATS** (via the shared `@tazama-lf/frms-coe-startup-lib` `server.handleResponse(payload, [subjects])` transport) rather than direct HTTP calls between processors. The only synchronous HTTP entry point into the platform is the TMS API.

---

## The Pipeline at a Glance

```
Client / PPA
   │  HTTP (ISO 20022 JSON)
   ▼
TMS Service ──NATS──▶ Event Director ──NATS──▶ Rule Executers (wrap Rule Processors)
                                                     │
                                                     ▼ NATS
                                          Typology Processor
                                                     │
                                                     ▼ NATS
                                    Event Adjudicator (formerly TADProc / event-adjudicator)
                                                     │
                                                     ▼ NATS
                                          Case Management System (CMS)
```

Two side-channels exist for **interdiction** (blocking): both the **Typology Processor** and the **Event Flow Rule Processor (EFRuP)** can short-circuit and publish directly to an interdiction producer when a block/interdiction threshold is met.

The result object is progressively **nested** as it flows: a rule produces `ruleResult`; the typology processor wraps rule results into `typologyResult { ruleResults[] }`; the adjudicator wraps typologies into `tadpResult { typologyResult[] { ruleResults[] } }`.
→ *Ref: `docs/Product/processor-results-propagation.md`*

---

## 1. TMS Service (Transaction Monitoring Service API)

**Repo:** `tms-service` (pkg `tms-service` v3.0.0) — the ingestion + data-preparation front door.

**What it does:**
- **HTTP ingress** via Fastify. Four ISO 20022 endpoints, each schema-validated (Swagger/OpenAPI) and permission-gated:
  - `pain.001.001.11` (quote request), `pain.013.001.09` (quote response) — **only mounted when `QUOTING` is enabled**
  - `pacs.008.001.10` (transfer request), `pacs.002.001.12` (transfer response) — always mounted
  → *Ref: `src/router.ts` (routes + `routePrivilege` map)*
- Per-message-type handlers do the **data-preparation** work.
  → *Ref: `src/logic.service.ts` → `handlePain001` / `handlePain013` / `handlePacs008` / `handlePacs002`*
- **Store raw message** to transaction history + build the **graph model** (accounts, entities, `account_holder` edges, `transactionRelationship`) via `cacheDatabaseManager.saveTransactionHistory / addAccount / addEntity / addAccountHolder`.
- **Build the `DataCache`** — a small object (`cdtrId`, `dbtrId`, `cdtrAcctId`, `dbtrAcctId`, amounts, exch. rate) that travels with the payload so downstream processors avoid DB round-trips. Identifiers are composed as `Id + SchmeNm.Prtry (+ MmbId)`.
  → *Ref: `parseDataCache()`, and `DataCache` assembly inside each `handle*`*
- **`pacs.008` writes the DataCache to Redis** keyed `"<TenantId>:<EndToEndId>"`; **`pacs.002` reads it back** (and falls back to `rebuildCache()` — re-derives it from the stored pacs.008 — on a cache miss).
  → *Ref: `handlePacs008` (Redis `set`), `handlePacs002` (`getBuffer` → `rebuildCache`)*
- **Generate metadata**: `prcgTmDP` (data-prep processing time) and `traceParent` (Elastic APM correlation id).
  → *Ref: `notifyEventDirector()` — builds `metaData`, calls `apm.getCurrentTraceparent()`*
- **Multi-tenant**: every record is written with a `TenantId`; cache keys are tenant-prefixed.
- **Hand-off**: publishes `{ transaction, DataCache, metaData }` to the **Event Director** over NATS.
  → *Ref: `notifyEventDirector()` → `server.handleResponse(...)`*

**Note on defaults:** In the default deployment only `pacs.002` is actually evaluated downstream; `pain.001/013` and `pacs.008` primarily populate history/graph and terminate at the Event Director.
→ *Ref: `docs/Product/transaction-monitoring-service-api.md`, `docs/Product/event-director.md` §2.2*

---

## 2. Event Director

**Repo:** `event-director` (pkg `event-director` v4.0.0-rc.1) — the "smart triage" router.

**What it does:**
- **Entry point** `handleTransaction(req)` triggered by NATS message from TMS.
  → *Ref: `src/services/logic.service.ts` → `handleTransaction`; wired in `src/index.ts` (`server.init(handleTransaction)`)*
- **Read the Network Map** — a versioned JSON tree mapping `message type → typologies → rules`. Retrieved **from an in-memory `nodeCache` first** (key `"<tenantId>:<txTp>"`), only hitting `databaseManager.getNetworkMap()` on a cache miss.
  → *Ref: `handleTransaction` (nodeCache lookup + DB fallback); `loadAllNetworkConfigurations()` pre-warms the cache at startup*
- **Determine rules** — walk the network map for the incoming `TxTp` and collect all rules across all typologies for that message type.
  → *Ref: `getRuleMap(networkMap, transactionType)`*
- **De-duplicate rules** ("Highlander" principle) — a rule is unique by `id` + `cfg`; each unique rule is executed only once even if shared across typologies.
  → *Ref: `getRuleMap` dedup check: `rules.findIndex(r => r.id === rule.id && r.cfg === rule.cfg)`*
- **Prune the network map** — build a `networkSubMap` containing only the in-scope message/typologies/rules, which travels downstream with the transaction.
  → *Ref: `prunedMessage` filter + `networkSubMap` construction in `handleTransaction`*
- **Fan-out** — publish the transaction + sub-map + metadata to each unique rule's NATS subject `"sub-rule-<rule.id>"`, in parallel (`Promise.all`).
  → *Ref: `sendRuleToRuleProcessor()` → `server.handleResponse(toSend, ['sub-rule-' + rule.id])`*
- Adds `prcgTmED` (Event Director processing time) to metadata.

**Outgoing payload:** `{ transaction, networkMap (sub-map), DataCache, metaData }`.
→ *Ref: `docs/Product/event-director.md`*

---

## 3. Rule Processors (wrapped in the Rule Executer)

**Repo:** `rule-executer` (pkg `rule-executer` v3.0.0) — the common shell; each rule's bespoke logic lives in its own repo (e.g. `rule-901`, `rule-078`, …) and is imported as `rule/lib`.

**Design principle:** every rule answers **one small, specific behavioral question** (e.g. "how many transactions has the debtor made?"). Common plumbing is centralized in the executer; only the unique query/logic lives in the rule.
→ *Ref: `docs/Product/rule-processor-overview.md`*

**What the executer does** (`src/controllers/execute.ts` → `execute(reqObj)`):
1. **Validate the request** — must contain `transaction`, `networkMap`, `DataCache`; else early-exit.
2. **Seed a default `ruleResult`** — id `"<RULE_NAME>@<RULE_VERSION>"`, `subRuleRef: '.err'`, tenant id, etc.
3. **Resolve the rule's `cfg`** by scanning the network sub-map for a matching rule id.
4. **Fetch rule configuration** from the config DB: `databaseManager.getRuleConfig(id, cfg, tenantId)` (cached in node-cache). If missing/invalid → emit a `.err` result and return.
5. **Invoke the rule's own logic**: `handleTransaction(request, determineOutcome, ruleRes, logger, ruleConfig, databaseManager)` — this is the rule-specific code that (per the docs) checks **early-exit conditions**, builds an **injection-safe behavioral query**, executes it, and prepares results.
   → *Ref: `execute.ts` line ~119 (`handleTransaction` from `rule/lib`)*
6. **Classify** the numeric outcome against the rule config into a `subRuleRef`:
   - **Banded** results (most common): contiguous ranges, `lowerLimit <= value < upperLimit`.
   - **Cased** results: explicit value list + an "else" catch-all.
   → *Ref: `src/helpers/determineOutcome.ts` (banded/cased branch, band-limit comparison)*
7. **Record `prcgTm`**, drop the `reason` on the happy path, and **publish** `{ ...request, ruleResult }` to the **Typology Processor** over NATS.
   → *Ref: `execute.ts` final `server.handleResponse({ ...request, ruleResult })`*

**Rule result shape:** `{ id, cfg, subRuleRef, prcgTm, tenantId, indpdntVarbl, (reason on error) }`.

---

## 3a. Event Flow Rule Processor (EFRuP) — special rule

**Repo:** `event-flow` (pkg `event-flow` v3.0.0). A rule processor that behaves differently from the rest: it does **not** produce a weighted score (`wght` is always 0) — instead it evaluates **conditions/lists** (block / override) attached to the debtor & creditor entities/accounts.

**What it does** (`src/logic.service.ts`):
- Pulls **condition buffers** from Redis for the 4 DataCache parties (`cdtrId`, `cdtrAcctId`, `dbtrId`, `dbtrAcctId`), keyed `"<tenantId>:<partyId>"`, and decodes them (`decodeConditionsBuffer`).
- **Sanitizes conditions** by time window (inception/expiry vs. transaction date), by **perspective** (governed as debtor/creditor / -account), and by **event type** (`TxTp` or `all`).
  → *Ref: `sanitizeConditions()`*
- **Determines outcome**: sets `subRuleRef` to `'block'` (if any `non-overridable-block`/`overridable-block`) or `'override'` (if `override` present and not non-overridable-blocked).
  → *Ref: `determineOutcome()`*
- On a `block`, and if alerts aren't suppressed, it **publishes straight to the interdiction producer** in addition to the normal flow to the Typology Processor.
→ *Ref: `docs/Product/event-flow-rule-processor.md`*

---

## 4. Typology Processor

**Repo:** `typology-processor` (pkg `typology-processor` v4.0.0-rc.1) — centralized, config-driven scoring engine.

**What it does** (`src/logic.service.ts` → `handleTransaction`):
- **Collect rule results with Redis** — each incoming rule result is stored and *all* previously-stored results for the transaction are returned atomically: `addOneGetAll("<tenantId>:<txId>", { ruleResult })`.
  → *Ref: `saveToRedisGetAll()`*
- **Determine beneficiary typologies** — from the network sub-map, find every typology that includes the incoming rule (by `id@cfg`), and gather the subset of rule results relevant to each.
  → *Ref: `ruleResultAggregation()` (also computes total unique `ruleCount` for GC)*
- **Wait for completeness** — a typology is only scored once the number of received rule results ≥ the number of rules configured for it in the network map; otherwise it's skipped this pass (results stay cached).
  → *Ref: `evaluateTypologySendRequest()` early `continue` when `typologyResultRules.length < networkMapRules.rules.length`*
- **Read typology config & score** — fetch `getTypologyConfig(id, cfg, tenantId)` and evaluate the typology **expression** (MathJSON) against per-rule weights. Weights come from mapping each result's `id+cfg+subRuleRef` → `termId`/`wght`; the expression is evaluated with the Cortex compute-engine.
  → *Ref: `src/utils/evaluateTExpression.ts` → `evaluateTypologyExpression()` (`valueMap`, `replaceTerms`, `computeEngine.box(expr).evaluate()`)*
- **Apply workflow thresholds** — attaches `alertThreshold` / `interdictionThreshold` / `flowProcessor` from config:
  - score ≥ `alertThreshold` → `review = true` (flag for investigation).
  - **EFRuP override**: if the typology's `flowProcessor` result is `block` → force `review = true`; `override` → suppress the alert (`efrupBlockAlert`).
  - score ≥ `interdictionThreshold` (and not suppressed / not EFRuP-blocked) → **publish directly to the interdiction producer** to block the transaction in real time.
  → *Ref: `evaluateTypologySendRequest()` (review logic, `isInterdicting`, interdiction `server.handleResponse(..., interdictionDestination)`)*
- **Forward** the typology result to the **Event Adjudicator** on subject `"typology-<cfg>"`.
- **Garbage-collect** the Redis interim key once all expected rules have arrived (`rulesList.length >= ruleCount`).
  → *Ref: `handleTransaction` final `deleteKey(cacheKey)`*

**Interdiction destination** honors `INTERDICTION_DESTINATION` (`tenant` → per-tenant producer suffix, else global). `SUPPRESS_ALERTS` disables outbound alerting/interdiction.
→ *Ref: `docs/Product/typology-processing.md`*

---

## 5. Event Adjudicator (formerly TADProc / "tad-proc")

**Repo:** `transaction-aggregation-decisioning-processor` — **note the package name is now `event-adjudicator`** (v4.0.0-rc.3). Description: *"Typology processor results are collected in the Event Adjudicator where an alert may be generated."*

**What it does** (`src/services/logic.service.ts` → `handleExecute`, with `helper.service.ts` → `handleTypologies`):
- **Aggregate typology results** — each arriving typology result is stored and counted in Redis under `"EA_<tenantId>_<txId>_TP"`; the adjudicator waits until the number of stored typologies equals the network map's typology count.
  → *Ref: `handleTypologies()` — `addOneGetCount`, compares against `typologies.length`; returns empty until complete*
- **Determine review status** — once all typologies are in, it reads them back (`getMemberValues`, tenant-filtered) and sets an overall `review = true` if **any** typology's `review` is true.
  → *Ref: `handleTypologies()` review loop*
- **Build the final `tadpResult`** — network map id/cfg + the full array of typology results (each still carrying its rule results) + total processing time.
  → *Ref: `handleExecute()` — `tadpResult` assembly, gated on `typologyResults.length === typologyCount`*
- **Determine alert status** — `status = review ? 'ALRT' : 'NALT'`; wrap into an `Alert` with a UUID v7 `evaluationID` and timestamp.
  → *Ref: `handleExecute()` — `v7()`, `Alert` object*
- **Persist the evaluation** — `databaseManager.saveEvaluationResult(txId, transaction, networkMap, alert, dataCache)` writes the final result to the transaction-history DB.
  → *Ref: `handleExecute()` (`saveEvaluationResult`)*
- **Emit to CMS** — unless `SUPPRESS_ALERTS`, publish a `CMSRequest` (`{ message, report: alert, transaction, networkMap }`) to the alert producer for the Case Management System. Alert destination respects `ALERT_DESTINATION` (`tenant` vs global).
  → *Ref: `handleExecute()` — `alertSubject`, final `server.handleResponse(result, alertSubject)`*
- **Clean up** the `EA_..._TP` Redis key once processing completes.
  → *Ref: `handleTypologies()` `deleteKey(cacheKey)`*

**Final output message** (to CMS / history) contains: original transaction, the network (sub-)map, the complete nested `tadpResult` (typologies → rules), `status` (`ALRT`/`NALT`), evaluation id, timestamp, and the DataCache.
→ *Ref: `docs/Product/transaction-aggregation-and-decisioning-processor.md` §7.4 (sample alert), `docs/Product/processor-results-propagation.md`*

---

## Cross-Cutting Concerns (apply to every stage)

| Concern | How it works | Reference |
|---|---|---|
| **Transport** | NATS pub/sub via `frms-coe-startup-lib` `server.handleResponse(payload, [subject])`; each service inits with a single `handleTransaction`/`handleExecute` consumer. | each service `src/index.ts` |
| **Multi-tenancy** | `TenantId` carried on the transaction; all DB writes, config lookups, cache keys, and interdiction/alert destinations are tenant-scoped (`"<tenantId>:..."`). | `tms logic.service.ts`, `event-director logic.service.ts`, `typology-processor logic.service.ts` |
| **Config-driven** | Network map (routing), rule configs (bands/cases), typology configs (weights + expression + thresholds) all live in the config DB and are cached in-process. | `getNetworkMap`, `getRuleConfig`, `getTypologyConfig` |
| **Caching** | Node-cache for configs/network maps; Redis for DataCache and for interim rule/typology result aggregation (with explicit GC). | ED `nodeCache`, TP `addOneGetAll`, EA `addOneGetCount` |
| **Observability** | Elastic APM spans/transactions threaded through every stage via a `traceParent`; per-stage timings `prcgTmDP`, `prcgTmED`, `prcgTm`. | each service `apm.ts` + `apm.startSpan/startTransaction` |
| **Interdiction (blocking)** | Real-time block can be triggered early from the **Typology Processor** (interdiction threshold) or **EFRuP** (block condition), bypassing full aggregation. | TP `evaluateTypologySendRequest`, EFRuP `determineOutcome` |
| **Kill-switches** | `SUPPRESS_ALERTS` disables outbound alerting/interdiction; `QUOTING` toggles pain.001/013 handling. | config across TMS/TP/EA |

---

## Quick Reference — Entry Points

| Stage | Repo | File | Function |
|---|---|---|---|
| Ingestion / data prep | `tms-service` | `src/logic.service.ts` | `handlePacs002` (+ pain001/013/pacs008) |
| Routing / triage | `event-director` | `src/services/logic.service.ts` | `handleTransaction` |
| Rule execution shell | `rule-executer` | `src/controllers/execute.ts` | `execute` |
| Rule classification | `rule-executer` | `src/helpers/determineOutcome.ts` | `determineOutcome` |
| Event flow (special rule) | `event-flow` | `src/logic.service.ts` | `handleTransaction` |
| Typology scoring | `typology-processor` | `src/logic.service.ts` | `handleTransaction` → `evaluateTypologySendRequest` |
| Typology expression eval | `typology-processor` | `src/utils/evaluateTExpression.ts` | `evaluateTypologyExpression` |
| Adjudication / alert | `transaction-aggregation-decisioning-processor` (pkg `event-adjudicator`) | `src/services/logic.service.ts` | `handleExecute` |
| Typology aggregation | same | `src/services/helper.service.ts` | `handleTypologies` |

*Source docs cross-referenced: `/home/abdul-rahim/tazama/docs/Product/` — `tazama-4-0-overview.md`, `transaction-monitoring-service-api.md`, `event-director.md`, `rule-processor-overview.md`, `event-flow-rule-processor.md`, `typology-processing.md`, `transaction-aggregation-and-decisioning-processor.md`, `processor-results-propagation.md`.*

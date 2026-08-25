# COMESA DRPP — Tazama Rule & Typology Configuration
## Development Backlog (Epics, User Stories, Sub-tasks)

| | |
|---|---|
| **Document Ref** | CCH-PL-BLG-RULECFG-001 |
| **Version** | v1.0 |
| **Classification** | Confidential |
| **Status** | Draft for planning review |
| **Audience** | Developers new to Tazama, implementing the COMESA DRPP rule and typology configuration |
| **Derived from** | CCH-PL-FSD-RULECFG-001 v1.1 (FSD) · CCH-PL-DEV-RULECFG-001 v1.0 (Developer Guide) · `COMESA-typology-weights-tuning-worksheet.xlsx` (CCHFRMS-46) |
| **Target platform** | Tazama 4.0.0 (PostgreSQL) |

---

## 0. How to use this backlog

### 0.1 If you have never worked on Tazama

Read this section before picking up a ticket. Four ideas carry the whole component.

**A rule is a small, single question about one transaction.** "How old is the creditor's account?" "Has this debtor paid this creditor before?" Each rule is a Node/TypeScript library exporting one function, `handleTransaction`. It runs inside a generic shell called the **rule-executer** — one executer container per rule. The rule reads the transaction, queries history from PostgreSQL, produces a single number (or a single label), and hands it back to the executer. The executer turns that number into one **outcome**.

**An outcome is a `subRuleRef`.** Every rule returns exactly one of these per transaction, and only one:

| Kind | Looks like | Meaning |
|---|---|---|
| Band | `.01`, `.02`, `.03` | The metric fell in this numeric range |
| Case | `.01`…`.04`, plus `.00` | The value matched this discrete label; `.00` is the reserved catch-all |
| Exit | `.x00`, `.x01`, `.x03`, `.x04` | The rule stopped early — usually not settled, or not enough history |
| Error | `.err` | The rule could not run at all |

**A typology is a weighted sum of rule outcomes.** It is not a program — it is a JSON document. It lists its member rules, gives every possible outcome of every member a weight, and defines an `expression` that adds the weights together. If the total meets `alertThreshold`, the typology raises an alert.

**A network map decides what runs.** It maps a message type (`txTp`) to a set of typologies, and each typology to its set of rules. The Event Director reads it and routes. Exactly one network map is active per tenant at a time.

The single most important consequence, and the cause of most defects in this component:

> **If a rule returns an outcome the typology configuration does not weight, that typology never completes. The evaluation hangs.** Every `subRuleRef` a rule can emit — every band, every case, every exit condition, and `.err` — must appear in the `wghts` array of every typology that contains that rule.

### 0.2 The four configuration levers

Everything in this backlog moves one of these four things. Knowing which one a ticket touches tells you where the change lives and what can break.

| Lever | Lives in | Changes what |
|---|---|---|
| **Network map** | `configuration.network_map` | Which message types are evaluated, which typologies apply, which rules feed them |
| **Rule configuration** | `configuration.rule` | Parameters, exit-condition text, band limits, case values, reasons |
| **Typology configuration** | `configuration.typology` | Per-outcome weights, the scoring expression, alert threshold |
| **Processor source** | `rule-NNN` repos, `rule-executer` | Anything the config cannot express — new parameters, new queries, new outcome types |

### 0.3 Story anatomy

Every story below carries **Description**, **Acceptance Criteria** and **Assumptions**. Sub-tasks are the units you actually move across the board; the story is done when all of its sub-tasks are.

| Level | ID format | Example |
|---|---|---|
| Epic | `EP-n` | `EP-4` Rule Configuration |
| Story | `US-nnn` | `US-124` Rule 054 — Benford's Law (DBTR) |
| Sub-task | `US-nnn.n` | `US-124.3` Author rule 054 configuration document |

Sub-task suffixes are consistent across every rule story, so you can filter a board by suffix:

| Suffix | Sub-task type |
|---|---|
| `.1` | Verify deployed baseline |
| `.2` | Processor code change |
| `.3` | Author configuration document |
| `.4` | Unit tests |
| `.5` | Deploy and smoke test |

---

## 1. Global assumptions

These hold for every story. They are not repeated in the individual **Assumptions** sections unless a story depends on one in a specific way.

| # | Assumption |
|---|---|
| **GA-1** | Target platform is **Tazama 4.0.0 on PostgreSQL**. Configuration lives in the `configuration` database (`rule`, `typology`, `network_map` tables), transaction history in `event_history`, raw messages in `raw_history`. Valkey provides caching. |
| **GA-2** | The team has read/write access to the **private `rule-NNN` processor repositories**. `rule-901` and `rule-executer` are the public reference implementations for the code pattern. *If this access is not in place, every `.2` sub-task in EP-4 converts to a change request on the Tazama project and EP-4 becomes blocked.* |
| **GA-3** | **Message onboarding is out of scope for this backlog.** `pacs.009.001.07` and `pacs.002.001.15` ingestion — TMS API endpoints, `raw_history` tables, DataCache population, PPA field mapping — is owned by another team. Every story that binds a rule to those message types carries an external dependency and cannot be end-to-end tested until that work lands. Only `pacs.008.001.10` is ingestible by stock Tazama 4.0.0 today. |
| **GA-4** | COMESA configuration is isolated by **tenant**. All configuration documents carry `tenantId: "COMESA"`. This keeps COMESA configs from colliding with Tazama defaults, which occupy the same `(id, cfg)` keys under a different tenant. |
| **GA-5** | **Naming convention.** Rule configs use `id: "NNN@4.0.0"` (the deployed processor version) with `cfg: "1.0.0"` (the COMESA configuration version). This reconciles the `NNN@1.0.0` notation used throughout the FSD and Developer Guide with the actually-deployed Tazama 4.0.0 processors. Typology configs use `id: "typology-processor"` with `cfg: "<typology>-<msg>@1.0.0"`, e.g. `001-008@1.0.0`. |
| **GA-6** | **Alerting only.** No interdiction in this phase. `interdictionThreshold` is omitted from every typology configuration, and `flowProcessor` is omitted because EFRuP is not deployed. The 75% interdiction column in the tuning worksheet is superseded by Developer Guide §1 and is not configured. |
| **GA-7** | **Every weight and threshold is provisional.** Nothing in the source register was measured against transaction data. Values are loaded as specified so they are consistent and reviewable; they are tuned against FUT data before CUG. An alert rate observed in FUT is not a defect until tuning has run. |
| **GA-8** | **Corridor key format** is two uppercase ISO 4217 codes, source first, hyphen separated: `ZMW-MWK`. Band boundaries are lower-inclusive, upper-exclusive. Time windows are rolling, anchored on the transaction under evaluation. Thresholds round half-to-even. |
| **GA-9** | Configuration documents are **immutable by version**. Never overwrite a deployed `(id, cfg, tenantId)`. Issue a new `cfg` and activate a new network map. This applies in FUT and above; local development may overwrite freely. |
| **GA-10** | The **deployed baseline differs from the published Tazama 4.0.0 seed configuration in unknown ways**. Every rule story opens with a `.1` sub-task that reads the actual deployed config before anything is changed. Where this document states a "current" value, it is the 4.0.0 open-source seed and must be treated as an expectation to verify, not a fact. |

---

## 2. Definition of Ready / Definition of Done

Applied to every story; not repeated per story.

**Definition of Ready**
1. The deployed baseline configuration for the affected rule or typology has been read and attached to the ticket.
2. Any parameter the story depends on is either already implemented (EP-2 story closed) or explicitly listed as blocked-by.
3. Any COMESA-supplied value the story needs (`corridorThreshold`, `purposeCodeToCaseMap`, `identityResolutionRule`) is either supplied or has an agreed interim value.

**Definition of Done**
1. Configuration document loads without schema-validation error against the deployed processor.
2. **Outcome completeness proven:** every `subRuleRef` the processor can emit is weighted in every typology that contains the rule. Verified by the automated check in `US-702`, not by eye.
3. Unit tests cover every band, every case, every exit condition and `.err`.
4. At least one transaction has been pushed through the deployed stack and the resulting `subRuleRef` observed in the evaluation result — or, where the story is bound to `pacs.009`/`pacs.002.001.15`, the test is written and marked pending on GA-3.
5. Arithmetic checks in Developer Guide §11.2 pass for any typology touched.
6. Change is committed with the config version bumped per GA-5 and GA-9.

---

## 3. Epic map and sequencing

Work top to bottom. EP-1 through EP-3 are prerequisites — starting EP-4 or EP-5 before them means reworking every value.

| Epic | Title | Stories | Gate |
|---|---|---|---|
| **EP-1** | Foundation — Tazama orientation and environment | 6 | — |
| **EP-2** | Processor enablement — cross-cutting parameters | 14 | EP-1 |
| **EP-3** | Shared lookups and the corridor model | 4 | EP-1 |
| **EP-4** | Rule configuration (one story per rule) | 31 | EP-2, EP-3 |
| **EP-5** | Typology configuration | 31 | EP-4 |
| **EP-6** | Network map and routing | 6 | EP-5 |
| **EP-7** | Verification, test harness and tuning baseline | 6 | runs alongside EP-4 onward |
| **EP-8** | Open items, decisions and spec amendments | 11 | start immediately, runs throughout |

**Critical path:** `US-004` (environment verification) → `US-010` (schema extension) → `US-011` (corridor cohorting) → `US-131` (rule 091) → `US-224` (typology 137) → remaining rules → remaining typologies → network map.

> **Start with rule 091 and typology 137.** Highest regulatory priority, one rule, simplest logic, and it exercises the corridor lookup and the fail-loud `.err` path end to end. If that works, the corridor plumbing works.

---
# EP-1 — Foundation: Tazama Orientation and Environment

**Goal:** a developer who has never seen Tazama can stand the platform up, read its configuration, push a transaction through it, and explain the result — before touching COMESA values.

---

### US-001 — Stand up a local Tazama 4.0.0 stack

**Description**
Bring up the full Tazama 4.0.0 platform locally from `tazama-stack` so every subsequent story has somewhere to run. This is the reference environment for all local development on this component: TMS API, Event Director, rule-executer containers, typology processor, Event Adjudicator (TADProc), PostgreSQL (`configuration`, `event_history`, `raw_history`, `evaluation`), Valkey and NATS.

**Acceptance Criteria**
1. `docker compose` brings the core stack up with all containers healthy.
2. PostgreSQL contains the five databases and the `configuration` database exposes `rule`, `typology` and `network_map` tables.
3. At least one rule-executer container is running and reports its `RULE_NAME` and `FUNCTION_NAME` environment values in its startup log.
4. NATS is reachable and subjects are observable (via `nats-utilities` or equivalent).
5. A one-page `RUNBOOK.md` is committed to the team repo covering: start, stop, reset to clean state, tail logs for a named rule, and connect to the configuration database.
6. A second team member follows the runbook from scratch on a clean machine and reaches a healthy stack without assistance.

**Assumptions**
- Docker and Docker Compose are available on developer machines; no Kubernetes for local work.
- Only the core profile is needed. CIMS, BIAR and Connection Studio are out of scope for this component.
- The public `tazamaorg/*` images are pullable. If the COMESA build uses a private registry, credentials are a prerequisite and this story is blocked until they exist.

---

### US-002 — Load and read the baseline configuration

**Description**
Load Tazama's own default rule, typology and network map configurations and learn to read them. The purpose is comprehension, not COMESA work — a developer must be able to look at a rule configuration document and predict which `subRuleRef` a given metric value produces before they are trusted to author one.

**Acceptance Criteria**
1. Default rule configurations, the default typology configuration and a network map are loaded into the `configuration` database and the network map is activated.
2. Developer can produce, from the database, the full outcome inventory of any named rule — its parameters, exit conditions and every band or case with limits and reasons.
3. Developer can trace one rule through the network map to the typologies that consume it, and show that rule's weight for each of its outcomes in each typology.
4. Developer can state, for a given numeric metric value and a given rule config, which `subRuleRef` results — and explain the lower-inclusive / upper-exclusive boundary rule.
5. A short worked example is added to the team repo using rule 901: metric value in, `subRuleRef` out, weight applied, typology score.

**Assumptions**
- The Tazama 4.0.0 seed configurations are adequate for learning. They are not COMESA values and are replaced entirely in EP-4 and EP-5.
- `rule-901` and `rule-902` are the only rules whose source the team can read as a complete worked example; the reference example uses 901.

---

### US-003 — Push a transaction end to end and read the result

**Description**
Submit a transaction to the TMS API and follow it through the full evaluation chain to the alert output, so that developers can debug their own configuration changes rather than reporting "it didn't fire".

**Acceptance Criteria**
1. A `pacs.008.001.10` and a `pacs.002.001.12` message are submitted successfully to the TMS API and accepted.
2. The message is visible in `raw_history` and the derived rows are visible in `event_history`.
3. The Event Director log shows the routing decision and the rules dispatched.
4. Each dispatched rule's result is observable, including its `subRuleRef`, `prcgTm` and `wght`.
5. The typology processor's score for the transaction is observable, along with the `review` flag and the workflow thresholds used.
6. The TADProc output — the complete alert payload containing transaction, network map, rule results and typology results — is captured and committed as a reference artefact.
7. Developer can explain what happens when a rule returns an outcome the typology does not weight, having deliberately caused it once in a local sandbox and observed the typology fail to complete.

**Assumptions**
- The Postman collections in the `postman` repository provide usable request bodies.
- AC-7 is deliberately destructive and is performed on a local stack only.

---

### US-004 — Environment verification session *(critical path)*

**Description**
A single focused session that reads the **actually deployed** rule configurations and settles the facts that every downstream value depends on. Developer Guide §9.2 lists five checks; the fourteen derived band sets are the most important. A boundary mismatch discovered after EP-5 invalidates every weight built on it, so this story gates EP-4.

**Acceptance Criteria**
1. The deployed configuration for all 31 in-scope rules is exported to a single machine-readable file and committed.
2. **Band verification:** for each of the fourteen rules whose band sets the Developer Guide derived rather than read — 008, 016, 017, 020, 021, 025, 026, 027, 044, 045, 048, 063, 084, 090 — the deployed boundaries are compared to Guide §5 and every difference is recorded.
3. **Outcome inventory:** the complete set of `subRuleRef` values each deployed rule can emit is recorded, including every exit condition. Any exit condition not covered by the Guide's `.x00` / `.x01` policy is raised against `US-801`.
4. **Metric confirmation:** for rules 054 and 063 the statistic the deployed processor returns is confirmed (chi-square versus MAD × 1000) and recorded. For rules 010, 011, 020 and 048 the metric is confirmed as a z-score or otherwise.
5. **Units confirmation:** the unit of every time-based band boundary is recorded (Tazama convention is milliseconds throughout).
6. `tolerance`, `commission` and `commissionBasis` semantics are read from the deployed configuration and documented.
7. The configuration deployment mechanism is documented: where configs are written, how a version is activated, what else must point at a new version, and how to roll back.
8. Whether shared lookups can be referenced once or must be duplicated per rule is answered, and feeds `US-030`.
9. Whether a `PDNG` transaction is re-evaluated on resolution, or its `.x00` is final, is answered by observation from one test transaction.
10. A **baseline-versus-target delta report** is produced covering all 31 rules and circulated before any EP-4 story starts.

**Assumptions**
- A test environment with the COMESA-deployed rule processors is reachable. If only the open-source 4.0.0 seed is available, that is recorded as the baseline and the delta report is re-run when the real environment appears.
- This is one session, not five tickets. It is sized as a single story deliberately so that it is done in one sitting and its findings land together.

---

### US-005 — Configuration change and deployment pipeline

**Description**
Establish how a configuration document travels from a developer's branch to a running environment, with versioning and rollback. Without this, EP-4 and EP-5 produce JSON no one can safely deploy.

**Acceptance Criteria**
1. COMESA rule, typology and network map configurations are held in a version-controlled repository with one file per configuration document.
2. A loader script applies configuration to a target environment, is idempotent, and refuses to overwrite an existing `(id, cfg, tenantId)` unless an explicit override flag is passed.
3. The naming convention in GA-5 is enforced by the loader and a validation failure names the offending file.
4. Network map activation is a discrete, auditable step: deactivate the current map, activate the new one, with exactly one active map per tenant guaranteed.
5. Rollback is demonstrated: activate the previous network map and show the prior configuration in force.
6. All COMESA documents carry `tenantId: "COMESA"` and the loader rejects any that do not.

**Assumptions**
- Configuration is applied via the Tazama admin/config API or direct SQL against the `configuration` database, whichever `US-004` AC-7 establishes.
- Promotion between environments is by re-running the loader against a different target, not by database copy.

---

### US-006 — Typology configuration topology decision *(blocks EP-5)*

**Description**
Developer Guide §6 requires a **different `alertThreshold` per message type** for the same typology — typology 001 alerts at 390 on `pacs.008` and 270 on `pacs.009`. Tazama's typology configuration document carries exactly **one** `workflow.alertThreshold`. This story decides how per-message thresholds are represented and records the decision before 31 typology documents are authored against the wrong shape.

**Acceptance Criteria**
1. Confirmed by observation that the typology processor scores **per message**, not once per transaction chain: the Event Director routes on the `txTp` branch of the network map, and the typology processor completes when all rules in that message's network sub-map have reported. This closes tuning-worksheet Open Item 1.
2. The chosen representation is documented. Default recommendation: **one typology configuration document per typology per message type**, keyed `cfg: "<typology>-<msg>@1.0.0"` (e.g. `001-008@1.0.0`, `001-009@1.0.0`), each referenced from the matching `messages[]` branch of the network map.
3. The resulting document count is stated and accepted — approximately **57 typology configuration documents** across 30 active typologies and their message bindings.
4. The alternative — a single document per typology with the lowest threshold, accepting reduced sensitivity on the richer message type — is recorded as considered and rejected, with the reason.
5. A worked example for one two-message typology is authored, loaded and shown to score differently on each message type.
6. The decision is recorded as an amendment note against Developer Guide §6.

**Assumptions**
- The network map's `messages[]` array permits a different typology `cfg` per `txTp` branch. This is confirmed as part of AC-1.
- Per-message documents duplicate the `rules` and `expression` blocks. The duplication is accepted; the loader in `US-005` generates both from one source definition to avoid drift.

---
# EP-2 — Processor Enablement: Cross-Cutting Parameters

**Goal:** make the FSD's cross-cutting parameters real in the rule processors, so that setting them in configuration actually changes behaviour.

> **Why this epic exists.** The FSD frames the work as changes "at the parameter and band level only". That is true of the *specification* but not of the *deployed processors*. Each rule validates its configuration against a Zod schema declaring exactly the keys it accepts, and `handleTransaction` reads only those keys. A parameter the schema does not declare never reaches the rule. Several of these parameters also describe *behaviour* rather than a value — `currencyScope: perCorridor` means the history query must cohort by corridor, which is hand-written SQL inside each rule.
>
> **Until the story for a parameter is closed, setting that parameter in a rule configuration has no effect.** A rule that appears configured but returns unchanged results is an unimplemented parameter, not a configuration error.

**Common sub-task pattern for EP-2 stories**

| Suffix | Sub-task |
|---|---|
| `.1` | Extend the shared config schema (`frms-coe-lib` `baseConfigSchema`) to declare the parameter |
| `.2` | Implement the behaviour in the shared query/helper layer |
| `.3` | Wire it into each consuming rule processor |
| `.4` | Unit tests including the parameter-absent path |
| `.5` | Publish the rule library version and update the executer pin |

---

### US-010 — Extend the rule configuration schema for cross-cutting parameters *(critical path)*

**Description**
Add the fifteen cross-cutting parameters to the shared rule configuration schema so that configuration documents carrying them validate instead of being rejected or silently stripped. This is the enabling story for every other story in EP-2 — without it, no COMESA rule configuration will load.

**Acceptance Criteria**
1. `baseConfigSchema` (or the COMESA equivalent) declares, with types and validation: `currencyScope`, `amountBasis`, `accountKey`, `txStsSuccessCodes`, `identitySourceStage`, `identityResolutionViaCorrelationId`, `identityResolutionRule`, `correlationIdField`, `excludeRefundLinkedTxns`, `transactionStage`, `restrictToSameCurrency`, `corridorThreshold`, `purposeCodeToCaseMap`, `commissionBasis`, `timestampBasis`.
2. Enumerated parameters reject invalid values at load: `currencyScope` accepts only `any` / `perCurrency` / `perCorridor`; `amountBasis` only `IntrBkSttlmAmt` / `InstdAmt`; `transactionStage` only `quote` / `transfer`; `commissionBasis` only `sourceAmount` / `settlementAmount`; `timestampBasis` only `initiation` / `completion`.
3. `restrictToSameCurrency` accepts only `true`, per FSD §5.1 which names it the only supported setting.
4. Each rule's own schema declares only the parameters that rule actually consumes; a parameter set on a rule that does not consume it fails validation loudly rather than being silently ignored.
5. Every parameter has a documented default matching FSD §5.1. Parameters with no safe default — `identityResolutionRule`, `corridorThreshold`, `purposeCodeToCaseMap` — are mandatory and produce a named startup error when absent.
6. A configuration document carrying every parameter loads cleanly against a test rule.
7. Schema changes are backward compatible: existing Tazama 4.0.0 configurations under other tenants continue to validate.

**Assumptions**
- The schema lives in a shared library consumed by all rule processors, so it is changed once rather than 31 times.
- Rejecting unknown keys is preferred over stripping them. A typo in a parameter name must fail the load, not silently disable a control.

---

### US-011 — Implement `currencyScope` and per-corridor cohorting *(critical path)*

**Description**
Implement corridor cohorting in the history query layer. `currencyScope: perCorridor` means every statistic a rule computes — histogram, standard deviation, lifetime mean, digit distribution, minimum-transaction count — is computed only over history sharing the transaction's corridor, the ordered source→destination currency pair. This is the single largest behavioural change in the FSD and it affects eight rules directly.

**Acceptance Criteria**
1. The corridor of the transaction under evaluation is derived deterministically from its currency fields and expressed as `SRC-DST` per GA-8.
2. History queries add a corridor predicate when `currencyScope: perCorridor`, a currency predicate when `perCurrency`, and no predicate when `any`.
3. Rules 002, 010, 011, 016, 020, 048, 054 and 063 compute their statistics within the corridor cohort only.
4. `minimumTransactions` for rules 054 and 063 is evaluated **within** the corridor cohort — a debtor active on three corridors is evaluated three times independently.
5. Where a party has no history in the transaction's corridor, the rule returns its insufficient-history exit condition rather than falling back to an all-currency baseline or erroring.
6. Query plans are inspected and the corridor predicate is index-supported; a supporting index is added if not.
7. Unit tests cover: single-corridor history, multi-corridor history proving cohorts do not bleed, and empty-corridor history.
8. Integration test proves a party's first transaction on a newly activated corridor produces an exit condition on all eight rules and scores the typology zero.

**Assumptions**
- Corridor is derivable from the translated Tazama message. The reference E2E flow settles which fields carry source and destination currency; if they are absent, this story is blocked on the PPA contract.
- Corridor is a property of the transaction, not of the account. An account transacting on multiple corridors carries multiple independent baselines.
- Directionality matters: `ZMW-MWK` and `MWK-ZMW` are distinct cohorts.

---

### US-012 — Implement `accountKey` composite identity

**Description**
Replace single-field account references with the composite key `{partyIdScheme, partyId, fspId}`. Tazama's translated ISO 20022 message set has no bank-style account number, so every rule that matches, groups or counts by "account" needs a composite key.

**Acceptance Criteria**
1. A shared helper derives the composite key from debtor and creditor party fields on any supported message.
2. All rules referencing an account use the helper rather than comparing a raw field.
3. The key is stable across messages in one transaction chain.
4. Two parties differing in any of the three components are distinct; identical in all three are the same. De-duplication across `PartyIdType` values is explicitly **not** handled here — that is `US-015`.
5. Unit tests cover matching, non-matching and missing-component cases. A missing mandatory component produces `.err` with a named reason.

**Assumptions**
- `fspId` is present on both parties in the translated message set.
- Composite-key matching does not regress query performance beyond an agreed margin; a composite index is added if needed.

---

### US-013 — Implement `identitySourceStage`

**Description**
Make the authoritative message for identity configurable. `PUT /quotes/{ID}`, `POST /transfers` and all status messages reference identity indirectly rather than carrying it, so a rule evaluating on those messages must read identity from an earlier stage — default `POST_quotes`.

**Acceptance Criteria**
1. `identitySourceStage` selects which message in the chain identity is read from.
2. Rules 001, 003, 004, 007, 008, 028, 030 and 083/084 resolve identity from the configured stage rather than the triggering message.
3. Where the configured stage is not available for a transaction, the rule returns its exit condition rather than falling back silently to the triggering message.
4. Resolution is a cache lookup where possible, and query cost is measured and recorded.
5. Unit tests cover: stage present, stage absent, and stage present but missing identity fields.

**Assumptions**
- The chain is correlatable — the transaction under evaluation can be linked back to its quote stage. This depends on the correlation path in `US-014`.
- `Purp.Prtry` and `DtAndPlcOfBirth.BirthDt` are populated at the quote stage. Confirmed against the reference E2E flow; if not populated, rules 007, 028 and 078 are affected and this is raised against EP-8.

---

### US-014 — Implement `identityResolutionViaCorrelationId`

**Description**
FX legs carry FSP identifiers, not customer identity. Resolve real end-customer identity by following `conversionTerms.determiningTransferId` back to the originating transfer's `PmtId.EndToEndId`. Without this, every rule evaluating on an FX leg is reasoning about institutions rather than people.

**Acceptance Criteria**
1. Given an FX-leg message, the helper resolves debtor and creditor customer identity via the correlation path.
2. Rules 001, 002, 003, 004, 011, 016, 020, 030, 045, 063, 083, 084 and 090 use resolved identity when evaluating an FX leg.
3. Where correlation cannot be resolved, the rule returns `.err` with a named reason and does not fall back to the FSP identifier.
4. Resolution is bounded — a single lookup, not a chain walk — and its cost is recorded.
5. Unit tests cover resolvable, unresolvable and absent-correlation cases.
6. Integration test on an FX leg proves the rule attributes behaviour to the customer, not the FSP.

**Assumptions**
- **Blocked by GA-3 for end-to-end testing.** `pacs.009.001.07` is not ingestible by stock Tazama 4.0.0. Unit tests can be written against fixtures; the integration test is written and marked pending.
- The correlation path exists in the translated message set as it does at the Mojaloop layer. This needs the PPA contract to confirm — the captured flow settles the Mojaloop side only.

---

### US-015 — Implement `identityResolutionRule` (alias de-duplication)

**Description**
De-duplicate alternate `PartyIdType` values — MSISDN, ALIAS, DEVICE — that resolve to the same underlying wallet, before any rule counts "distinct accounts". Without it, one customer using three identifier types counts as three accounts, and multiple-account detection is itself an AML control.

**Acceptance Criteria**
1. The de-duplication rule is expressed as configuration, not hard-coded.
2. Rules 008, 083 and 084 apply it before counting distinct accounts.
3. Absence of the rule produces a named startup error, per `US-010` AC-5 — it has no safe default and must not default to "no de-duplication" silently.
4. Unit tests prove three identifier types for one wallet count as one account, and genuinely distinct wallets stay distinct.
5. An interim FUT position is implemented and documented: accept the known over-count, log its rate, hold typologies 003, 013 and 105 at FUT.
6. The over-count rate is observable so its effect on 003, 013 and 105 can be measured during FUT.

**Assumptions**
- **BLOCKER for promotion.** The rule must be supplied by COMESA or the deployment team; see `US-802`. Typologies 003, 013 and 105 do not promote past FUT until it exists.
- Typology 105 is built entirely on alias de-duplication and will over-fire until this lands. That is expected, not a defect.

---

### US-016 — Implement `correlationIdField` and `excludeRefundLinkedTxns`

**Description**
Refunds repurpose `PmtId.InstrId` to point at a prior transaction. Left unfiltered they create false graph edges and are miscounted as ordinary incoming legs in the mirroring rules. Make the correlation field configurable and allow refund-linked transactions to be excluded from correlation sets.

**Acceptance Criteria**
1. `correlationIdField` selects the field used for chain and graph correlation; default `EndToEndId`.
2. `excludeRefundLinkedTxns: true` excludes transactions where `InstrForCdtrAgt.Cd = "REFD"` from correlation sets.
3. Rules 024, 025, 026, 027 and 090 apply the exclusion.
4. Rule 090's graph traversal does not create edges from refund back-references.
5. Unit tests cover a refund-linked transaction included and excluded, proving different rule outcomes.

**Assumptions**
- `InstrForCdtrAgt.Cd` survives PPA translation into Tazama's message set. Rule 078 depends on the same field.
- Exclusion applies to the correlation set only, not to transaction history generally — a refund is still a transaction for counting purposes.

---

### US-017 — Implement the `txStsSuccessCodes` shared lookup

**Description**
Fifteen-plus rules test whether a transaction was successful. Today each rule embeds its own comparison. Replace this with a single configurable lookup mapping `TxInfAndSts.TxSts` values to success, fail or in-progress, so a status-code change is one edit rather than fifteen.

**Acceptance Criteria**
1. The lookup implements FSD §5.2: `ACSC` and `ACCC` success; `RJCT` and `CANC` fail; `PDNG` neither — excluded from both counts until resolved.
2. All rules with a "transaction unsuccessful" exit consume the lookup rather than an inline comparison.
3. A transaction that has not reached terminal success produces the rule's exit condition and contributes nothing — `PDNG` scores 0 by this route.
4. Whether a `PDNG` transaction is re-evaluated on resolution is documented, per `US-004` AC-9, and the behaviour matches the documented answer.
5. Adding a status code is a single configuration change affecting all consuming rules.
6. Unit tests cover each status value and an unrecognised value.

**Assumptions**
- Whether the lookup can be referenced once or must be duplicated per rule configuration is settled by `US-004` AC-8. If duplication is required, the loader in `US-005` generates it from one source to prevent drift.
- Stock Tazama compares against `ACCC` only. Adding `ACSC` is a behavioural change and is called out in the delta report.

---

### US-018 — Implement `amountBasis` and `restrictToSameCurrency`

**Description**
FX messages carry two amount legs; domestic messages carry one. Make the evaluated leg explicit, and restrict tolerance, mirroring and summing comparisons to a single currency so no rule ever compares amounts across currencies.

**Acceptance Criteria**
1. `amountBasis` selects `IntrBkSttlmAmt` or `InstdAmt`; default `IntrBkSttlmAmt`.
2. `restrictToSameCurrency: true` restricts the comparison set to transactions sharing the transaction's `Ccy`.
3. Rules 006, 010, 011, 018, 020, 021, 024, 025, 026, 027, 048, 054, 063 and 091 use the configured basis.
4. No rule performs a currency conversion at evaluation time under any configuration.
5. Where the configured leg is absent from the message, the rule returns `.err` with a named reason.
6. Unit tests prove a mixed-currency history set is correctly filtered before comparison.

**Assumptions**
- Currency conversion is performed externally by the FX provider before a transaction reaches Tazama; no live FX rate feed exists at evaluation time (FSD §4.1).
- `restrictToSameCurrency` is distinct from `currencyScope`: the former filters a comparison set, the latter cohorts a statistical baseline. Both may apply to one rule.

---

### US-019 — Implement `transactionStage`

**Description**
Define whether "a transaction" means a quote request with no funds moved, or a completed transfer with terminal success status. Default `transfer`. Counting quotes as transactions would inflate every history-based rule.

**Acceptance Criteria**
1. `transactionStage` selects `quote` or `transfer`; default `transfer`.
2. Rules 001, 002, 003, 004, 016, 017, 030, 044 and 045 count only transactions at the configured stage.
3. With `transfer`, quote-stage records are excluded from history counts and age derivations.
4. Interaction with `txStsSuccessCodes` is defined and tested: `transfer` plus terminal success is the counted condition.
5. Unit tests cover a history set mixing quote and transfer records.

**Assumptions**
- Quote-stage records are distinguishable in `event_history`. If they are not persisted separately this story reduces to a no-op and is closed with that finding recorded.

---

### US-020 — Implement `corridorThreshold` for rule 091 *(critical path)*

**Description**
Rule 091 currently compares an amount to a single hard-coded band limit. Replace this with a lookup of regulatory thresholds keyed by corridor, each value already expressed in that corridor's own local currency, and band on the **ratio** of amount to threshold rather than on the raw amount.

**Acceptance Criteria**
1. `corridorThreshold` is a lookup keyed per GA-8, each entry carrying a value in the corridor's local currency.
2. Rule 091 resolves the corridor, looks up the threshold, and bands on `amount ÷ corridorThreshold`.
3. The amount evaluated is `IntrBkSttlmAmt`, denominated in the **destination** currency; the governing figure is the **destination country's** STR threshold.
4. A corridor with no configured entry returns `.err` with a named reason — not a default, not a pass. This is the fail-loud control for the compliance gap in FSD §8.
5. Adding a corridor is a configuration change requiring no code change and no redeploy of the rule.
6. Unit tests cover: below threshold, exactly at threshold (bands `.02`, boundary is inclusive on the lower edge), above threshold, and unconfigured corridor.
7. Integration test proves an unconfigured corridor produces `.err` and that typology 137 scores it at full weight.

**Assumptions**
- **Blocked for CA, not for FUT.** Interim uniform floor of 2,000 USD equivalent applies for FUT and CUG; final per-corridor local-currency values are required before go-live. See `US-803`.
- Local-currency conversion of the USD reference figures is performed once at configuration time at an agreed FX reference rate, never at evaluation time.
- Banding on a ratio rather than an absolute amount keeps the band definition corridor-independent. This is a deliberate design choice and is recorded as such.

---

### US-021 — Implement `purposeCodeToCaseMap` for rule 078

**Description**
`Purp.Prtry` is a free proprietary code, not a controlled list. Rule 078 needs an explicit lookup from Mojaloop transaction-scenario values to Tazama case codes, plus a defined precedence between the refund flag and the purpose code.

**Acceptance Criteria**
1. `purposeCodeToCaseMap` maps `Purp.Prtry` values to case codes and is fully configuration-driven.
2. Check order is enforced: `InstrForCdtrAgt.Cd` is evaluated **before** `Purp.Prtry`; the refund flag takes precedence.
3. Behaviour for an unmapped `Purp.Prtry` value is explicitly decided and implemented — see `US-804`. The two options are the reserved `.00` catch-all, which Tazama's cased-rule contract expects, or `.err` as the FSD states. **These are not equivalent** and the choice determines whether all eight typologies containing 078 need a `.00` weight.
4. Whichever outcome is chosen, it is weighted in all eight typologies carrying rule 078.
5. Unit tests cover each mapped value, an unmapped value, and a refund overriding a mapped purpose code.

**Assumptions**
- **HIGH severity, no safe default.** The full mapping must come from COMESA; see `US-804`.
- Tazama reserves `.00` as the mandatory catch-all for cased rules. Deviating from that convention is a deliberate decision, not an oversight, and is recorded if taken.

---

### US-022 — Implement `commissionBasis` for rules 026 and 027

**Description**
The commissioned-mirroring rules retain a commission percentage before passing funds on. FX corridors have two distinct amount legs, so which leg the commission percentage applies against must be explicit.

**Acceptance Criteria**
1. `commissionBasis` selects `sourceAmount` or `settlementAmount`.
2. Rules 026 and 027 apply the existing `commission` parameter against the configured leg.
3. What `commissionBasis` resolves to on a single-leg domestic message is defined and tested.
4. Unit tests prove the same transaction produces different outcomes under each setting.

**Assumptions**
- The units and semantics of `commission` and `tolerance` are read from the deployed configuration in `US-004` AC-6 before this story starts.
- Rules 024 and 025 are the non-commissioned variants and take no `commissionBasis`.

---

### US-023 — Implement `timestampBasis` for rule 076

**Description**
Rule 076 measures the gap between consecutive transactions, but the original rule does not state which timestamp. Make it explicit, defaulting to completion so "consecutive" means settlement time rather than request time.

**Acceptance Criteria**
1. `timestampBasis` selects `initiation` (`GrpHdr.CreDtTm`) or `completion` (`TxInfAndSts.PrcgDt.DtTm`); default `completion`.
2. Rule 076 measures the gap using the configured timestamp.
3. Only transactions successful per `txStsSuccessCodes` qualify as the previous transaction.
4. Unit tests prove the same pair of transactions produces different gaps under each setting.

**Assumptions**
- **Blocked by GA-3 for end-to-end testing.** Rule 076 binds to `pacs.002.001.15`, which stock Tazama 4.0.0 does not ingest — it ships `pacs.002.001.12`.
- Rule 076 is the only rule bound to `pacs.002`. It is the sole scoring rule for typologies 002, 047 and 095 on that message type, which is why `US-601` reviews those routes.

---
# EP-3 — Shared Lookups and the Corridor Model

**Goal:** the data artefacts that many rules and typologies depend on exist once, are version-controlled, and cannot drift.

---

### US-030 — Shared lookup representation and drift prevention

**Description**
Four lookups are referenced by many rules: `txStsSuccessCodes` (15+ rules), `corridorThreshold`, `purposeCodeToCaseMap` and `identityResolutionRule`. Tazama's rule configuration is a standalone JSON document per rule with no shared-reference construct, so a lookup is either duplicated into every consuming rule config or a sharing mechanism is built. Decide, implement, and make drift impossible either way.

**Acceptance Criteria**
1. `US-004` AC-8 has established whether the deployed platform supports referencing a lookup once. The decision is recorded with its rationale.
2. If duplication is required, each lookup has exactly **one** source-of-truth file and the `US-005` loader generates the per-rule copies. Hand-editing a generated copy is prevented — generated files are marked and a CI check fails on manual modification.
3. Changing `txStsSuccessCodes` is demonstrated as a single edit that correctly propagates to every consuming rule configuration.
4. A drift check reports any consuming rule whose embedded copy differs from the source of truth, and runs in CI.
5. Lookups are version-controlled alongside the configurations that consume them.

**Assumptions**
- Duplication is the likely outcome given Tazama's per-rule document model. The story is written so either answer works.
- Generation happens at load time, not at runtime. The deployed configuration document is self-contained.

---

### US-031 — Corridor registry and corridor key derivation

**Description**
A corridor is the ordered pair of source→destination currency and is the cohorting key for eight rules and the lookup key for rule 091. Establish the registry of active corridors and the single derivation function that turns a transaction into a corridor key, so that every consumer derives it identically.

**Acceptance Criteria**
1. A corridor registry lists active corridors. Initial content is the Zambia–Malawi bidirectional pair: `ZMW-MWK` and `MWK-ZMW`.
2. A single shared derivation function produces the corridor key from a transaction, in the `SRC-DST` format of GA-8, and is the only place the key is constructed.
3. Derivation is proven against the reference E2E flow, including the MWK 60 → ZMW conversion case where the settlement amount reaches the transfer message denominated in the destination currency.
4. Direction is preserved — `ZMW-MWK` and `MWK-ZMW` never collapse to one key.
5. A transaction on a corridor not in the registry is handled explicitly: rules cohorting by corridor return their insufficient-history exit; rule 091 returns `.err`.
6. Adding a corridor is a registry edit plus a `corridorThreshold` entry, with no code change.
7. The scaling implication is documented: COMESA's long-term target of 21 member states implies up to 420 directed corridor pairs, each requiring a threshold entry and per-corridor baselines.

**Assumptions**
- Source and destination currency are both derivable from the translated Tazama message. Confirmed against the reference flow; blocked on the PPA contract if not.
- Corridor is not represented anywhere in Tazama's configuration schema today — configurations are keyed by `tenantId`, not corridor. The registry is a COMESA-side artefact consumed by the parameters in EP-2.

---

### US-032 — `corridorThreshold` interim FUT dataset

**Description**
Produce the actual threshold values rule 091 compares against, for the FUT and CUG phases. A missing or wrong entry means a transaction that should be reported to a regulator passes silently — this is the highest-severity data artefact in the component.

**Acceptance Criteria**
1. A `corridorThreshold` dataset exists with one entry per active corridor, keyed per GA-8.
2. Each value is expressed in the **destination** currency of its corridor, and the governing figure is the **destination country's** STR threshold:

   | Corridor key | Settlement currency | Governing regulator | Final STR threshold |
   |---|---|---|---|
   | `ZMW-MWK` | MWK | Malawi | 3,000 USD equivalent, in MWK |
   | `MWK-ZMW` | ZMW | Zambia | 2,000 USD equivalent, in ZMW |

3. For FUT and CUG a uniform **2,000 USD equivalent** floor applies to both corridors — the lower of the two, so nothing reportable is missed during testing.
4. The USD-to-local conversion is performed once at an agreed FX reference rate, recorded with the rate and its date, and committed.
5. The dataset is marked interim, with the CA-stage replacement identified as a `US-803` deliverable.
6. Every corridor in the `US-031` registry has an entry; a registry entry without a threshold fails CI.

**Assumptions**
- **BLOCKER for CA only, not for FUT.** Final values come from the DRPP Commercial Working Group with the Reserve Bank of Malawi and Bank of Zambia.
- Exceeding an STR reporting threshold is a reporting obligation, not grounds for withholding a lawful transaction. Consistent with GA-6, no interdiction is configured.

---

### US-033 — Band severity and tier cap reference dataset

**Description**
Every typology weight in this deployment is `tier cap × band severity` — roughly 700 individual weights across 30 typologies. Hand-typing them guarantees arithmetic errors. Hold severities and roles as data and generate the `wghts` arrays.

**Acceptance Criteria**
1. A machine-readable dataset holds, per rule, the severity of every band, case and exit outcome. Severity is a property of the rule and is identical in every typology.
2. A second dataset holds typology membership as rule→role, with roles `primary` (cap 100), `supporting` (60), `contextual` (30).
3. A generator emits each typology's `wghts` array as `cap × severity`, and its `expression` as the sum of member `termId` values.
4. The generator emits `alertThreshold` per typology per message type, computed as 50% of that message's reachable maximum, rounded half-to-even — with typologies 137 and 191 at 100% as documented exceptions.
5. The generator emits the documented exception: rule 091's `.err` weighted 100 in typology 137, and 0 everywhere else including typologies 010, 169 and 214. A second non-zero `.err` anywhere fails the build.
6. Generated output reproduces the Developer Guide §6 and §7 tables exactly. Any divergence fails the build and is investigated before proceeding.
7. The generator refuses to emit a typology in which any outcome the rule can emit is unweighted, cross-checking against the outcome inventory from `US-004` AC-3.

**Assumptions**
- Severities are provisional per GA-7. Holding them as data is what makes FUT tuning a dataset edit and a regenerate, rather than 700 manual changes.
- AC-6 is a regression guard, not a design goal — the published tables were independently verified to reconcile, so any divergence is a generator bug or a deliberate change that must be justified.
- AC-7 is the single most valuable check in this backlog. It is what prevents typology stalls in production.

---
# EP-4 — Rule Configuration

**Goal:** all 31 in-scope rules configured for COMESA and proven to emit the outcomes the typologies expect.

> **Read before starting any story in this epic.** Rules 074 and 075 are excluded from this deployment — no geolocation field exists in the Mojaloop/COMESA message set — leaving 31 of Tazama's 33. Both become eligible once geolocation is onboarded; Tazama's own ISO 20022 definitions already support the field.
>
> Every story shares the same five sub-tasks. They are listed in full here and referenced by suffix in each story so that the stories stay readable.
>
> | Suffix | Sub-task | Detail |
> |---|---|---|
> | `.1` | Verify deployed baseline | Read the live config for this rule from `configuration.rule`. Record actual parameters, exit conditions, and band or case limits. Compare to the "current" column in the story and record every difference. **Do not proceed on a mismatch — raise it.** |
> | `.2` | Processor code change | Implement the parameters this rule needs, per its EP-2 stories. Skipped only where the story states no code change is required. |
> | `.3` | Author configuration document | Write the COMESA rule config per GA-4 and GA-5: `id: "NNN@4.0.0"`, `cfg: "1.0.0"`, `tenantId: "COMESA"`. Include every parameter, every exit condition, and every band or case with its reason. |
> | `.4` | Unit tests | One test per band, per case, per exit condition, and `.err`. Boundary tests on every limit proving lower-inclusive / upper-exclusive. |
> | `.5` | Deploy and smoke test | Load via the `US-005` loader, push a transaction, observe the `subRuleRef` in the evaluation result. Where the rule binds to `pacs.009` or `pacs.002.001.15`, write the test and mark it pending on GA-3. |


---

### US-101 — Rule 001: Derived Account Age (CDTR)

| | |
|---|---|
| **Message binding** | `pacs.008.001.10` + `pacs.009.001.07` |
| **Returned metric** | days since creditor first seen |
| **Feeds** | 4 typologies — 045p, 214p, 105s, 044c |
| **Band set** | Stated |

**Description**

Configure rule 001 for the COMESA deployment. **Unit change.** Deployed boundaries are in milliseconds; the target table is in days. Convert or the `.02` band means 1–30 *milliseconds*. Band count also goes 2 → 4.

*Current deployed configuration (Tazama 4.0.0 seed — treat as expectation, verify in `US-101.1`):*

| Outcome | Deployed limit | Deployed reason |
|---|---|---|
| `.01` | < 86 400 000 ms (1 day) | Creditor account is less than 1 day old |
| `.02` | >= 86 400 000 ms | Creditor account is more than 1 day old |
| `.x01` | exit condition | — |

*Target configuration:*

| Outcome | Lower | Upper | Meaning | Severity |
|---|---|---|---|---|
| `.01` | 0 | 1 | First observed <1 day ago | 1.0 |
| `.02` | 1 | 30 | Less than one month old | 0.7 |
| `.03` | 30 | 90 | Less than three months old | 0.3 |
| `.04` | 90 | +∞ | Established account | 0.0 |

**Parameters to add or modify:** `accountKey`, `identityResolutionViaCorrelationId`, `identitySourceStage`, `transactionStage`

> ⚠️ **Outcome inventory gap.** The deployed rule can emit `.x01`, which the COMESA outcome policy (`.x00` and `.err` everywhere, `.x01` on rule 018 only) does not cover. Any typology containing this rule that does not weight it **will stall** when the rule returns it. Resolve via `US-801` before `US-101.3`.

**Acceptance Criteria**

1. Deployed baseline for rule 001 is read and recorded; every difference from the "current" table above is raised before configuration is authored.
2. Configuration document is authored per GA-4 and GA-5 and loads without schema-validation error.
3. Every parameter listed above is present, is read by the processor, and demonstrably changes behaviour — a parameter set but not consumed is an unimplemented parameter, not a configured one.
4. Every outcome the deployed processor can emit is present in the configuration with a reason, and the complete list is published to EP-5 so the consuming typologies can weight it.
5. Band limits observe no-gaps and no-overlaps, evaluated as `lowerLimit <= value < upperLimit`.
6. The disposition of `.x01` is decided in `US-801`, implemented here, and reflected in all 4 consuming typologies.
7. Unit tests cover every band or case, every exit condition and `.err`, including boundary values on every limit.
8. A transaction is pushed through the deployed stack and the expected `subRuleRef` is observed in the evaluation result — or the test is written and marked pending on GA-3 where the binding is `pacs.009` or `pacs.002.001.15`.

**Assumptions**

- Bound to both `pacs.008` and `pacs.009`. **`pacs.009` is not ingestible by stock Tazama 4.0.0 (GA-3)** — the FX path cannot be end-to-end tested in this backlog.
- Blocked by the EP-2 stories implementing `accountKey`, `identityResolutionViaCorrelationId`, `identitySourceStage`, `transactionStage`. Until those close, the configuration loads but the rule behaves as before.
- All severities and the weights derived from them are provisional (GA-7) and are tuned against FUT data before CUG.

**Sub-tasks:** `US-101.1` verify baseline · `US-101.2` processor code · `US-101.3` author config · `US-101.4` unit tests · `US-101.5` deploy and smoke

---

### US-102 — Rule 002: Transaction Convergence (DBTR)

| | |
|---|---|
| **Message binding** | `pacs.008.001.10` + `pacs.009.001.07` |
| **Returned metric** | inbound count in rolling 24h |
| **Feeds** | 11 typologies — 001p, 002p, 129p, 216p, 005s, 013s, 024s, 092s, 098s, 107s, 214s |
| **Band set** | Stated |

**Description**

Configure rule 002 for the COMESA deployment. The target table states no boundary for `.01`/`.02`. Deployed uses **5**. Confirm the intended convergence threshold before authoring — an unstated boundary cannot be configured. Rules 002 and 016 share a metric and differ only in which party is examined: 002 examines the **debtor** (the party now sending) and counts what it has *received* — the pass-through and mule signal.

*Current deployed configuration (Tazama 4.0.0 seed — treat as expectation, verify in `US-102.1`):*

| Outcome | Deployed limit | Deployed reason |
|---|---|---|
| `.01` | < 5 | No transaction convergence detected on debtor account |
| `.02` | >= 5 | Transaction convergence detected on debtor account |
| *(no exit conditions deployed)* | | |

*Target configuration:*

| Outcome | Lower | Upper | Meaning | Severity |
|---|---|---|---|---|
| `.01` | −∞ | +∞ | No convergence detected | 0.0 |
| `.02` | −∞ | +∞ | Convergence detected | 1.0 |

**Parameters to add or modify:** `accountKey`, `currencyScope: perCorridor`, `identityResolutionViaCorrelationId`, `transactionStage`

**Acceptance Criteria**

1. Deployed baseline for rule 002 is read and recorded; every difference from the "current" table above is raised before configuration is authored.
2. Configuration document is authored per GA-4 and GA-5 and loads without schema-validation error.
3. Every parameter listed above is present, is read by the processor, and demonstrably changes behaviour — a parameter set but not consumed is an unimplemented parameter, not a configured one.
4. Every outcome the deployed processor can emit is present in the configuration with a reason, and the complete list is published to EP-5 so the consuming typologies can weight it.
5. Band limits observe no-gaps and no-overlaps, evaluated as `lowerLimit <= value < upperLimit`.
6. Unit tests cover every band or case, every exit condition and `.err`, including boundary values on every limit.
7. A transaction is pushed through the deployed stack and the expected `subRuleRef` is observed in the evaluation result — or the test is written and marked pending on GA-3 where the binding is `pacs.009` or `pacs.002.001.15`.

**Assumptions**

- Bound to both `pacs.008` and `pacs.009`. **`pacs.009` is not ingestible by stock Tazama 4.0.0 (GA-3)** — the FX path cannot be end-to-end tested in this backlog.
- Blocked by the EP-2 stories implementing `accountKey`, `currencyScope`, `identityResolutionViaCorrelationId`, `transactionStage`. Until those close, the configuration loads but the rule behaves as before.
- All severities and the weights derived from them are provisional (GA-7) and are tuned against FUT data before CUG.

**Sub-tasks:** `US-102.1` verify baseline · `US-102.2` processor code · `US-102.3` author config · `US-102.4` unit tests · `US-102.5` deploy and smoke

---

### US-103 — Rule 003: Account Dormancy (CDTR)

| | |
|---|---|
| **Message binding** | `pacs.008.001.10` + `pacs.009.001.07` |
| **Returned metric** | days creditor inactive |
| **Feeds** | 4 typologies — 195p, 028s, 214s, 105c |
| **Band set** | Stated |

**Description**

Configure rule 003 for the COMESA deployment. **Unit change** (ms → days) and band count 2 → 3. Feeds typology 195 as primary, where it is the nearest thing to an account-age rule — but it returns its exit condition for an account with no history, so a genuinely brand-new account scores nothing from it. See `US-806`.

*Current deployed configuration (Tazama 4.0.0 seed — treat as expectation, verify in `US-103.1`):*

| Outcome | Deployed limit | Deployed reason |
|---|---|---|
| `.01` | < 7 889 229 000 ms (3 months) | Creditor account not dormant in the last 3 months |
| `.02` | >= 7 889 229 000 ms | Creditor account dormant for more than 3 months |
| `.x01` | exit condition | — |

*Target configuration:*

| Outcome | Lower | Upper | Meaning | Severity |
|---|---|---|---|---|
| `.01` | 0 | 90 | Not dormant | 0.0 |
| `.02` | 90 | 365 | Dormant 3–12 months | 0.6 |
| `.03` | 365 | +∞ | Dormant >12 months | 1.0 |

**Parameters to add or modify:** `accountKey`, `identityResolutionViaCorrelationId`, `identitySourceStage`, `transactionStage`

> ⚠️ **Outcome inventory gap.** The deployed rule can emit `.x01`, which the COMESA outcome policy (`.x00` and `.err` everywhere, `.x01` on rule 018 only) does not cover. Any typology containing this rule that does not weight it **will stall** when the rule returns it. Resolve via `US-801` before `US-103.3`.

**Acceptance Criteria**

1. Deployed baseline for rule 003 is read and recorded; every difference from the "current" table above is raised before configuration is authored.
2. Configuration document is authored per GA-4 and GA-5 and loads without schema-validation error.
3. Every parameter listed above is present, is read by the processor, and demonstrably changes behaviour — a parameter set but not consumed is an unimplemented parameter, not a configured one.
4. Every outcome the deployed processor can emit is present in the configuration with a reason, and the complete list is published to EP-5 so the consuming typologies can weight it.
5. Band limits observe no-gaps and no-overlaps, evaluated as `lowerLimit <= value < upperLimit`.
6. The disposition of `.x01` is decided in `US-801`, implemented here, and reflected in all 4 consuming typologies.
7. Unit tests cover every band or case, every exit condition and `.err`, including boundary values on every limit.
8. A transaction is pushed through the deployed stack and the expected `subRuleRef` is observed in the evaluation result — or the test is written and marked pending on GA-3 where the binding is `pacs.009` or `pacs.002.001.15`.

**Assumptions**

- Bound to both `pacs.008` and `pacs.009`. **`pacs.009` is not ingestible by stock Tazama 4.0.0 (GA-3)** — the FX path cannot be end-to-end tested in this backlog.
- Blocked by the EP-2 stories implementing `accountKey`, `identityResolutionViaCorrelationId`, `identitySourceStage`, `transactionStage`. Until those close, the configuration loads but the rule behaves as before.
- All severities and the weights derived from them are provisional (GA-7) and are tuned against FUT data before CUG.

**Sub-tasks:** `US-103.1` verify baseline · `US-103.2` processor code · `US-103.3` author config · `US-103.4` unit tests · `US-103.5` deploy and smoke

---

### US-104 — Rule 004: Account Dormancy (DBTR)

| | |
|---|---|
| **Message binding** | `pacs.008.001.10` + `pacs.009.001.07` |
| **Returned metric** | days debtor inactive |
| **Feeds** | 5 typologies — 044p, 045s, 214s, 037c, 105c |
| **Band set** | Stated |

**Description**

Configure rule 004 for the COMESA deployment. **Unit change** (ms → days) and band count 2 → 3. The deployed `.02` reason text says "more than 12 months" against a 3-month boundary — an existing defect in the Tazama seed. The COMESA reasons correct it.

*Current deployed configuration (Tazama 4.0.0 seed — treat as expectation, verify in `US-104.1`):*

| Outcome | Deployed limit | Deployed reason |
|---|---|---|
| `.01` | < 7 889 229 000 ms (3 months) | Debtor account not dormant in the last 3 months |
| `.02` | >= 7 889 229 000 ms | Debtor account dormant for more than 12 months |
| `.x01` | exit condition | — |

*Target configuration:*

| Outcome | Lower | Upper | Meaning | Severity |
|---|---|---|---|---|
| `.01` | 0 | 90 | Not dormant | 0.0 |
| `.02` | 90 | 365 | Dormant 3–12 months | 0.6 |
| `.03` | 365 | +∞ | Dormant >12 months | 1.0 |

**Parameters to add or modify:** `accountKey`, `identityResolutionViaCorrelationId`, `identitySourceStage`, `transactionStage`

> ⚠️ **Outcome inventory gap.** The deployed rule can emit `.x01`, which the COMESA outcome policy (`.x00` and `.err` everywhere, `.x01` on rule 018 only) does not cover. Any typology containing this rule that does not weight it **will stall** when the rule returns it. Resolve via `US-801` before `US-104.3`.

**Acceptance Criteria**

1. Deployed baseline for rule 004 is read and recorded; every difference from the "current" table above is raised before configuration is authored.
2. Configuration document is authored per GA-4 and GA-5 and loads without schema-validation error.
3. Every parameter listed above is present, is read by the processor, and demonstrably changes behaviour — a parameter set but not consumed is an unimplemented parameter, not a configured one.
4. Every outcome the deployed processor can emit is present in the configuration with a reason, and the complete list is published to EP-5 so the consuming typologies can weight it.
5. Band limits observe no-gaps and no-overlaps, evaluated as `lowerLimit <= value < upperLimit`.
6. The disposition of `.x01` is decided in `US-801`, implemented here, and reflected in all 5 consuming typologies.
7. Unit tests cover every band or case, every exit condition and `.err`, including boundary values on every limit.
8. A transaction is pushed through the deployed stack and the expected `subRuleRef` is observed in the evaluation result — or the test is written and marked pending on GA-3 where the binding is `pacs.009` or `pacs.002.001.15`.

**Assumptions**

- Bound to both `pacs.008` and `pacs.009`. **`pacs.009` is not ingestible by stock Tazama 4.0.0 (GA-3)** — the FX path cannot be end-to-end tested in this backlog.
- Blocked by the EP-2 stories implementing `accountKey`, `identityResolutionViaCorrelationId`, `identitySourceStage`, `transactionStage`. Until those close, the configuration loads but the rule behaves as before.
- All severities and the weights derived from them are provisional (GA-7) and are tuned against FUT data before CUG.

**Sub-tasks:** `US-104.1` verify baseline · `US-104.2` processor code · `US-104.3` author config · `US-104.4` unit tests · `US-104.5` deploy and smoke

---

### US-105 — Rule 006: Outgoing Transfer Similarity — Amounts (DBTR)

| | |
|---|---|
| **Message binding** | `pacs.008.001.10` only |
| **Returned metric** | count of similar amounts |
| **Feeds** | 3 typologies — 010p, 095p, 124s |
| **Band set** | Stated |

**Description**

Configure rule 006 for the COMESA deployment. Band count 2 → 3 and the lower boundary moves 2 → 1. Confirm `tolerance` units from the deployed config (`US-004` AC-6) — "similar" is defined by it.

*Current deployed configuration (Tazama 4.0.0 seed — treat as expectation, verify in `US-105.1`):*

| Outcome | Deployed limit | Deployed reason |
|---|---|---|
| `.01` | < 2 | No similar amounts detected in the most recent transactions from the debtor |
| `.02` | >= 2 | Two or more similar amounts detected in the most recent transactions from the debtor |
| `.x00` | exit condition | — |
| `.x01` | exit condition | — |

*Target configuration:*

| Outcome | Lower | Upper | Meaning | Severity |
|---|---|---|---|---|
| `.01` | 0 | 1 | No similar amounts | 0.0 |
| `.02` | 1 | 3 | Two similar amounts | 0.6 |
| `.03` | 3 | +∞ | Three or more | 1.0 |

**Parameters to add or modify:** `amountBasis`, `restrictToSameCurrency`, `accountKey`, `txStsSuccessCodes`

> ⚠️ **Outcome inventory gap.** The deployed rule can emit `.x01`, which the COMESA outcome policy (`.x00` and `.err` everywhere, `.x01` on rule 018 only) does not cover. Any typology containing this rule that does not weight it **will stall** when the rule returns it. Resolve via `US-801` before `US-105.3`.

**Acceptance Criteria**

1. Deployed baseline for rule 006 is read and recorded; every difference from the "current" table above is raised before configuration is authored.
2. Configuration document is authored per GA-4 and GA-5 and loads without schema-validation error.
3. Every parameter listed above is present, is read by the processor, and demonstrably changes behaviour — a parameter set but not consumed is an unimplemented parameter, not a configured one.
4. Every outcome the deployed processor can emit is present in the configuration with a reason, and the complete list is published to EP-5 so the consuming typologies can weight it.
5. Band limits observe no-gaps and no-overlaps, evaluated as `lowerLimit <= value < upperLimit`.
6. The disposition of `.x01` is decided in `US-801`, implemented here, and reflected in all 3 consuming typologies.
7. Unit tests cover every band or case, every exit condition and `.err`, including boundary values on every limit.
8. A transaction is pushed through the deployed stack and the expected `subRuleRef` is observed in the evaluation result.

**Assumptions**

- Bound to `pacs.008.001.10` only, which stock Tazama 4.0.0 does ingest — this rule is fully testable today. On an FX leg it returns no result and contributes nothing.
- Blocked by the EP-2 stories implementing `amountBasis`, `restrictToSameCurrency`, `accountKey`, `txStsSuccessCodes`. Until those close, the configuration loads but the rule behaves as before.
- All severities and the weights derived from them are provisional (GA-7) and are tuned against FUT data before CUG.

**Sub-tasks:** `US-105.1` verify baseline · `US-105.2` processor code · `US-105.3` author config · `US-105.4` unit tests · `US-105.5` deploy and smoke

---

### US-106 — Rule 007: Outgoing Transfer Similarity — Purpose Code (DBTR)

| | |
|---|---|
| **Message binding** | `pacs.008.001.10` only |
| **Returned metric** | Purp.Prtry exact match |
| **Feeds** | 2 typologies — 095p, 124c |
| **Band set** | Stated |
| **Band change** | **Yes — 3 bands to 2 outcomes, and a result-type change.** |

**Description**

Configure rule 007 for the COMESA deployment. **This is a processor code change, not a configuration change.** The deployed rule is *banded* on a numeric similarity metric. The target is an exact match on a coded value — a *cased* rule. Bands and cases are distinct configuration shapes in Tazama and the rule code chooses which it emits; a banded rule cannot be turned into a cased rule by configuration. Developer Guide §2 states "Case: same mechanism as a band … configured identically" — that is not true on this platform. Also note: if the rule becomes cased, Tazama reserves `.00` as the mandatory catch-all, which the two-outcome target does not include.

*Current deployed configuration (Tazama 4.0.0 seed — treat as expectation, verify in `US-106.1`):*

| Outcome | Deployed limit | Deployed reason |
|---|---|---|
| `.01` | [0, 1) | Identical descriptions for consecutive successful transactions |
| `.02` | [1, 5) | Similar descriptions for consecutive successful transactions |
| `.03` | >= 5 | Significantly different descriptions for consecutive successful transactions |
| `.x00` | exit condition | — |
| `.x01` | exit condition | — |

*Target configuration:*

| Outcome | Lower | Upper | Meaning | Severity |
|---|---|---|---|---|
| `.01` | −∞ | +∞ | Same purpose code as previous | 1.0 |
| `.02` | −∞ | +∞ | Different purpose code | 0.0 |

**Parameters to add or modify:** `field repoint to Purp.Prtry`, `identitySourceStage`

> ⚠️ **Outcome inventory gap.** The deployed rule can emit `.x01`, which the COMESA outcome policy (`.x00` and `.err` everywhere, `.x01` on rule 018 only) does not cover. Any typology containing this rule that does not weight it **will stall** when the rule returns it. Resolve via `US-801` before `US-106.3`.

**Acceptance Criteria**

1. Deployed baseline for rule 007 is read and recorded; every difference from the "current" table above is raised before configuration is authored.
2. Configuration document is authored per GA-4 and GA-5 and loads without schema-validation error.
3. Every parameter listed above is present, is read by the processor, and demonstrably changes behaviour — a parameter set but not consumed is an unimplemented parameter, not a configured one.
4. Every outcome the deployed processor can emit is present in the configuration with a reason, and the complete list is published to EP-5 so the consuming typologies can weight it.
5. Band limits observe no-gaps and no-overlaps, evaluated as `lowerLimit <= value < upperLimit`.
6. The disposition of `.x01` is decided in `US-801`, implemented here, and reflected in all 2 consuming typologies.
7. Unit tests cover every band or case, every exit condition and `.err`, including boundary values on every limit.
8. A transaction is pushed through the deployed stack and the expected `subRuleRef` is observed in the evaluation result.

**Assumptions**

- Bound to `pacs.008.001.10` only, which stock Tazama 4.0.0 does ingest — this rule is fully testable today. On an FX leg it returns no result and contributes nothing.
- Blocked by the EP-2 stories implementing `field repoint to Purp.Prtry`, `identitySourceStage`. Until those close, the configuration loads but the rule behaves as before.
- All severities and the weights derived from them are provisional (GA-7) and are tuned against FUT data before CUG.

**Sub-tasks:** `US-106.1` verify baseline · `US-106.2` processor code · `US-106.3` author config · `US-106.4` unit tests · `US-106.5` deploy and smoke

---

### US-107 — Rule 008: Outgoing Transfer Similarity — Creditor (DBTR)

| | |
|---|---|
| **Message binding** | `pacs.008.001.10` only |
| **Returned metric** | repeat count to same creditor |
| **Feeds** | 3 typologies — 024p, 095p, 028c |
| **Band set** | Derived by the Developer Guide, not published by the rule package — **verify first** |

**Description**

Configure rule 008 for the COMESA deployment. Depends on `identityResolutionRule` — without it, two `PartyIdType` values for the same wallet count as different creditors.

*Current deployed configuration (Tazama 4.0.0 seed — treat as expectation, verify in `US-107.1`):*

| Outcome | Deployed limit | Deployed reason |
|---|---|---|
| `.01` | < 2 | No recent transactions to the same creditor account |
| `.02` | >= 2 | Two or more recent transactions to the same creditor account |
| `.x00` | exit condition | — |
| `.x01` | exit condition | — |

*Target configuration:*

| Outcome | Lower | Upper | Meaning | Severity |
|---|---|---|---|---|
| `.01` | 0 | 2 | Low repetition | 0.0 |
| `.02` | 2 | 4 | Medium repetition | 0.6 |
| `.03` | 4 | +∞ | High repetition | 1.0 |

**Parameters to add or modify:** `accountKey`, `identityResolutionRule`, `identitySourceStage`

> ⚠️ **Outcome inventory gap.** The deployed rule can emit `.x01`, which the COMESA outcome policy (`.x00` and `.err` everywhere, `.x01` on rule 018 only) does not cover. Any typology containing this rule that does not weight it **will stall** when the rule returns it. Resolve via `US-801` before `US-107.3`.

**Acceptance Criteria**

1. Deployed baseline for rule 008 is read and recorded; every difference from the "current" table above is raised before configuration is authored.
2. The band set is **confirmed against the deployed rule**, not assumed. A boundary mismatch silently changes every weight built on it, so this is a hard gate on the rest of the story.
3. Configuration document is authored per GA-4 and GA-5 and loads without schema-validation error.
4. Every parameter listed above is present, is read by the processor, and demonstrably changes behaviour — a parameter set but not consumed is an unimplemented parameter, not a configured one.
5. Every outcome the deployed processor can emit is present in the configuration with a reason, and the complete list is published to EP-5 so the consuming typologies can weight it.
6. Band limits observe no-gaps and no-overlaps, evaluated as `lowerLimit <= value < upperLimit`.
7. The disposition of `.x01` is decided in `US-801`, implemented here, and reflected in all 3 consuming typologies.
8. Unit tests cover every band or case, every exit condition and `.err`, including boundary values on every limit.
9. A transaction is pushed through the deployed stack and the expected `subRuleRef` is observed in the evaluation result.

**Assumptions**

- Bound to `pacs.008.001.10` only, which stock Tazama 4.0.0 does ingest — this rule is fully testable today. On an FX leg it returns no result and contributes nothing.
- Blocked by the EP-2 stories implementing `accountKey`, `identityResolutionRule`, `identitySourceStage`. Until those close, the configuration loads but the rule behaves as before.
- The band set in the target table was derived from the returned metric because the rule package does not publish it. It is a starting point for verification, not a specification.
- All severities and the weights derived from them are provisional (GA-7) and are tuned against FUT data before CUG.

**Sub-tasks:** `US-107.1` verify baseline · `US-107.2` processor code · `US-107.3` author config · `US-107.4` unit tests · `US-107.5` deploy and smoke

---

### US-108 — Rule 010: Increased Account Activity: Volume (DBTR)

| | |
|---|---|
| **Message binding** | `pacs.008.001.10` + `pacs.009.001.07` |
| **Returned metric** | z-score of 24h outbound volume |
| **Feeds** | 11 typologies — 185p, 002s, 003s, 037s, 044s, 045s, 092s, 129s, 214s, 216s, 028c |
| **Band set** | Stated |

**Description**

Configure rule 010 for the COMESA deployment. **Trend exits `.x03` and `.x04` are deployed and are not in the COMESA outcome policy.** In Tazama’s own reference typology `.x03` carries weight **100**, not 0 — it is a deterministic signal ("no variance in history and recent volume shows an increase"), not an absence of data. Weighting it 0 discards real detection. Decide deliberately in `US-801`. Feeds 11 typologies, so the blast radius of getting this wrong is large.

*Current deployed configuration (Tazama 4.0.0 seed — treat as expectation, verify in `US-108.1`):*

| Outcome | Deployed limit | Deployed reason |
|---|---|---|
| `.01` | < 3 | The volume of recent outgoing transactions is within acceptable limits for the debtor |
| `.02` | >= 3 | The volume of recent outgoing transactions shows a significant increase for the debtor |
| `.x00` | exit condition | — |
| `.x01` | exit condition | — |
| `.x03` | exit condition | — |
| `.x04` | exit condition | — |

*Target configuration:*

| Outcome | Lower | Upper | Meaning | Severity |
|---|---|---|---|---|
| `.01` | −∞ | 1 | Within normal limits | 0.0 |
| `.02` | 1 | 2 | Moderate increase | 0.5 |
| `.03` | 2 | +∞ | Significant increase | 1.0 |

**Parameters to add or modify:** `amountBasis`, `currencyScope: perCorridor`, `transactionStage`, `txStsSuccessCodes`

> ⚠️ **Outcome inventory gap.** The deployed rule can emit `.x01`, `.x03`, `.x04`, which the COMESA outcome policy (`.x00` and `.err` everywhere, `.x01` on rule 018 only) does not cover. Any typology containing this rule that does not weight them **will stall** when the rule returns it. Resolve via `US-801` before `US-108.3`.

**Acceptance Criteria**

1. Deployed baseline for rule 010 is read and recorded; every difference from the "current" table above is raised before configuration is authored.
2. Configuration document is authored per GA-4 and GA-5 and loads without schema-validation error.
3. Every parameter listed above is present, is read by the processor, and demonstrably changes behaviour — a parameter set but not consumed is an unimplemented parameter, not a configured one.
4. Every outcome the deployed processor can emit is present in the configuration with a reason, and the complete list is published to EP-5 so the consuming typologies can weight it.
5. Band limits observe no-gaps and no-overlaps, evaluated as `lowerLimit <= value < upperLimit`.
6. The disposition of `.x01`, `.x03`, `.x04` is decided in `US-801`, implemented here, and reflected in all 11 consuming typologies.
7. Unit tests cover every band or case, every exit condition and `.err`, including boundary values on every limit.
8. A transaction is pushed through the deployed stack and the expected `subRuleRef` is observed in the evaluation result — or the test is written and marked pending on GA-3 where the binding is `pacs.009` or `pacs.002.001.15`.

**Assumptions**

- Bound to both `pacs.008` and `pacs.009`. **`pacs.009` is not ingestible by stock Tazama 4.0.0 (GA-3)** — the FX path cannot be end-to-end tested in this backlog.
- Blocked by the EP-2 stories implementing `amountBasis`, `currencyScope`, `transactionStage`, `txStsSuccessCodes`. Until those close, the configuration loads but the rule behaves as before.
- All severities and the weights derived from them are provisional (GA-7) and are tuned against FUT data before CUG.

**Sub-tasks:** `US-108.1` verify baseline · `US-108.2` processor code · `US-108.3` author config · `US-108.4` unit tests · `US-108.5` deploy and smoke

---

### US-109 — Rule 011: Increased Account Activity: Volume (CDTR)

| | |
|---|---|
| **Message binding** | `pacs.008.001.10` + `pacs.009.001.07` |
| **Returned metric** | z-score of 24h inbound volume |
| **Feeds** | 14 typologies — 052p, 124p, 185p, 003s, 028s, 037s, 051s, 092s, 098s, 121s, 129s, 195s, 214s, 216s |
| **Band set** | Stated |

**Description**

Configure rule 011 for the COMESA deployment. Same `.x03`/`.x04` issue as rule 010. **Feeds 14 typologies — the widest blast radius of any rule in the set.** The FSD flags a copy-paste defect in the source register: the `.02` result text reads "increase for the debtor" under a creditor-perspective rule. The COMESA reasons correct it.

*Current deployed configuration (Tazama 4.0.0 seed — treat as expectation, verify in `US-109.1`):*

| Outcome | Deployed limit | Deployed reason |
|---|---|---|
| `.01` | < 3 | The volume of recent incoming transactions is within acceptable limits for the creditor |
| `.02` | >= 3 | The volume of recent incoming transactions shows a significant increase for the creditor |
| `.x00` | exit condition | — |
| `.x01` | exit condition | — |
| `.x03` | exit condition | — |
| `.x04` | exit condition | — |

*Target configuration:*

| Outcome | Lower | Upper | Meaning | Severity |
|---|---|---|---|---|
| `.01` | −∞ | 1 | Within normal limits | 0.0 |
| `.02` | 1 | 2 | Moderate increase | 0.5 |
| `.03` | 2 | +∞ | Significant increase | 1.0 |

**Parameters to add or modify:** `amountBasis`, `currencyScope: perCorridor`, `transactionStage`, `txStsSuccessCodes`, `identityResolutionViaCorrelationId`

> ⚠️ **Outcome inventory gap.** The deployed rule can emit `.x01`, `.x03`, `.x04`, which the COMESA outcome policy (`.x00` and `.err` everywhere, `.x01` on rule 018 only) does not cover. Any typology containing this rule that does not weight them **will stall** when the rule returns it. Resolve via `US-801` before `US-109.3`.

**Acceptance Criteria**

1. Deployed baseline for rule 011 is read and recorded; every difference from the "current" table above is raised before configuration is authored.
2. Configuration document is authored per GA-4 and GA-5 and loads without schema-validation error.
3. Every parameter listed above is present, is read by the processor, and demonstrably changes behaviour — a parameter set but not consumed is an unimplemented parameter, not a configured one.
4. Every outcome the deployed processor can emit is present in the configuration with a reason, and the complete list is published to EP-5 so the consuming typologies can weight it.
5. Band limits observe no-gaps and no-overlaps, evaluated as `lowerLimit <= value < upperLimit`.
6. The disposition of `.x01`, `.x03`, `.x04` is decided in `US-801`, implemented here, and reflected in all 14 consuming typologies.
7. Unit tests cover every band or case, every exit condition and `.err`, including boundary values on every limit.
8. A transaction is pushed through the deployed stack and the expected `subRuleRef` is observed in the evaluation result — or the test is written and marked pending on GA-3 where the binding is `pacs.009` or `pacs.002.001.15`.

**Assumptions**

- Bound to both `pacs.008` and `pacs.009`. **`pacs.009` is not ingestible by stock Tazama 4.0.0 (GA-3)** — the FX path cannot be end-to-end tested in this backlog.
- Blocked by the EP-2 stories implementing `amountBasis`, `currencyScope`, `transactionStage`, `txStsSuccessCodes`, `identityResolutionViaCorrelationId`. Until those close, the configuration loads but the rule behaves as before.
- All severities and the weights derived from them are provisional (GA-7) and are tuned against FUT data before CUG.

**Sub-tasks:** `US-109.1` verify baseline · `US-109.2` processor code · `US-109.3` author config · `US-109.4` unit tests · `US-109.5` deploy and smoke

---

### US-110 — Rule 016: Transaction Convergence (CDTR)

| | |
|---|---|
| **Message binding** | `pacs.008.001.10` + `pacs.009.001.07` |
| **Returned metric** | inbound count in rolling 24h |
| **Feeds** | 17 typologies — 001p, 051p, 098p, 129p, 214p, 216p, 005s, 013s, 024s, 028s, 037s, 052s, 092s, 107s, 121s, 124s, 195s |
| **Band set** | Derived by the Developer Guide, not published by the rule package — **verify first** |

**Description**

Configure rule 016 for the COMESA deployment. Boundary unstated in the target table; deployed uses **5**. 016 examines the **creditor** — the party now receiving — and fires on fan-in to a collection account. A single transaction can trigger both 002 and 016. Feeds 17 typologies, the second widest in the set.

*Current deployed configuration (Tazama 4.0.0 seed — treat as expectation, verify in `US-110.1`):*

| Outcome | Deployed limit | Deployed reason |
|---|---|---|
| `.01` | < 5 | No Transaction convergence detected on creditor account |
| `.02` | >= 5 | Transaction convergence detected on creditor account |
| *(no exit conditions deployed)* | | |

*Target configuration:*

| Outcome | Lower | Upper | Meaning | Severity |
|---|---|---|---|---|
| `.01` | −∞ | +∞ | No convergence detected | 0.0 |
| `.02` | −∞ | +∞ | Convergence detected | 1.0 |

**Parameters to add or modify:** `accountKey`, `currencyScope: perCorridor`, `identityResolutionViaCorrelationId`, `transactionStage`

**Acceptance Criteria**

1. Deployed baseline for rule 016 is read and recorded; every difference from the "current" table above is raised before configuration is authored.
2. The band set is **confirmed against the deployed rule**, not assumed. A boundary mismatch silently changes every weight built on it, so this is a hard gate on the rest of the story.
3. Configuration document is authored per GA-4 and GA-5 and loads without schema-validation error.
4. Every parameter listed above is present, is read by the processor, and demonstrably changes behaviour — a parameter set but not consumed is an unimplemented parameter, not a configured one.
5. Every outcome the deployed processor can emit is present in the configuration with a reason, and the complete list is published to EP-5 so the consuming typologies can weight it.
6. Band limits observe no-gaps and no-overlaps, evaluated as `lowerLimit <= value < upperLimit`.
7. Unit tests cover every band or case, every exit condition and `.err`, including boundary values on every limit.
8. A transaction is pushed through the deployed stack and the expected `subRuleRef` is observed in the evaluation result — or the test is written and marked pending on GA-3 where the binding is `pacs.009` or `pacs.002.001.15`.

**Assumptions**

- Bound to both `pacs.008` and `pacs.009`. **`pacs.009` is not ingestible by stock Tazama 4.0.0 (GA-3)** — the FX path cannot be end-to-end tested in this backlog.
- Blocked by the EP-2 stories implementing `accountKey`, `currencyScope`, `identityResolutionViaCorrelationId`, `transactionStage`. Until those close, the configuration loads but the rule behaves as before.
- The band set in the target table was derived from the returned metric because the rule package does not publish it. It is a starting point for verification, not a specification.
- All severities and the weights derived from them are provisional (GA-7) and are tuned against FUT data before CUG.

**Sub-tasks:** `US-110.1` verify baseline · `US-110.2` processor code · `US-110.3` author config · `US-110.4` unit tests · `US-110.5` deploy and smoke

---

### US-111 — Rule 017: Transaction Divergence (DBTR)

| | |
|---|---|
| **Message binding** | `pacs.008.001.10` + `pacs.009.001.07` |
| **Returned metric** | outbound count in rolling 8h |
| **Feeds** | 13 typologies — 001p, 005p, 011p, 024p, 214p, 216p, 003s, 010s, 013s, 044s, 045s, 047s, 107s |
| **Band set** | Derived by the Developer Guide, not published by the rule package — **verify first** |

**Description**

Configure rule 017 for the COMESA deployment. Boundary unstated in the target table; deployed uses **5**. The window is 8 hours, not the 24 hours used by 002 and 016 — confirm the deployed `maxQueryRange` matches.

*Current deployed configuration (Tazama 4.0.0 seed — treat as expectation, verify in `US-111.1`):*

| Outcome | Deployed limit | Deployed reason |
|---|---|---|
| `.01` | < 5 | No Transaction divergence detected on source account |
| `.02` | >= 5 | Transaction divergence detected on source account |
| *(no exit conditions deployed)* | | |

*Target configuration:*

| Outcome | Lower | Upper | Meaning | Severity |
|---|---|---|---|---|
| `.01` | −∞ | +∞ | No divergence detected | 0.0 |
| `.02` | −∞ | +∞ | Divergence detected | 1.0 |

**Parameters to add or modify:** `accountKey`, `currencyScope: any`, `transactionStage`

**Acceptance Criteria**

1. Deployed baseline for rule 017 is read and recorded; every difference from the "current" table above is raised before configuration is authored.
2. The band set is **confirmed against the deployed rule**, not assumed. A boundary mismatch silently changes every weight built on it, so this is a hard gate on the rest of the story.
3. Configuration document is authored per GA-4 and GA-5 and loads without schema-validation error.
4. Every parameter listed above is present, is read by the processor, and demonstrably changes behaviour — a parameter set but not consumed is an unimplemented parameter, not a configured one.
5. Every outcome the deployed processor can emit is present in the configuration with a reason, and the complete list is published to EP-5 so the consuming typologies can weight it.
6. Band limits observe no-gaps and no-overlaps, evaluated as `lowerLimit <= value < upperLimit`.
7. Unit tests cover every band or case, every exit condition and `.err`, including boundary values on every limit.
8. A transaction is pushed through the deployed stack and the expected `subRuleRef` is observed in the evaluation result — or the test is written and marked pending on GA-3 where the binding is `pacs.009` or `pacs.002.001.15`.

**Assumptions**

- Bound to both `pacs.008` and `pacs.009`. **`pacs.009` is not ingestible by stock Tazama 4.0.0 (GA-3)** — the FX path cannot be end-to-end tested in this backlog.
- Blocked by the EP-2 stories implementing `accountKey`, `currencyScope`, `transactionStage`. Until those close, the configuration loads but the rule behaves as before.
- The band set in the target table was derived from the returned metric because the rule package does not publish it. It is a starting point for verification, not a specification.
- All severities and the weights derived from them are provisional (GA-7) and are tuned against FUT data before CUG.

**Sub-tasks:** `US-111.1` verify baseline · `US-111.2` processor code · `US-111.3` author config · `US-111.4` unit tests · `US-111.5` deploy and smoke

---

### US-112 — Rule 018: Exceptionally Large Outgoing Transfer (DBTR)

| | |
|---|---|
| **Message binding** | `pacs.008.001.10` only |
| **Returned metric** | ratio to 90-day same-currency max |
| **Feeds** | 9 typologies — 037p, 044p, 047p, 092p, 005s, 045s, 129s, 185s, 214s |
| **Band set** | Stated |
| **Band change** | **Yes — exit-condition semantics split.** |

**Description**

Configure rule 018 for the COMESA deployment. **Band limits already match the deployed configuration — the only rule where they do.** The change is to `.x01`: its trigger logic must test *same-currency* history depth rather than overall history depth, so a debtor’s first transaction in a new currency is distinguishable from a debtor with no history at all. Both score 0. That trigger change is processor code, not configuration. This is the only rule the COMESA docs assign `.x01` — in fact 18 deployed rules emit it.

*Current deployed configuration (Tazama 4.0.0 seed — treat as expectation, verify in `US-112.1`):*

| Outcome | Deployed limit | Deployed reason |
|---|---|---|
| `.01` | < 1.5 | Outgoing transfer within historical limits |
| `.02` | >= 1.5 | Exceptionally large outgoing transfer detected |
| `.x00` | exit condition | — |
| `.x01` | exit condition | — |

*Target configuration:*

| Outcome | Lower | Upper | Meaning | Severity |
|---|---|---|---|---|
| `.01` | −∞ | 1.5 | Within normal range | 0.0 |
| `.02` | 1.5 | +∞ | Exceptionally large | 1.0 |

**Parameters to add or modify:** `amountBasis`, `restrictToSameCurrency`, `txStsSuccessCodes`

**Acceptance Criteria**

1. Deployed baseline for rule 018 is read and recorded; every difference from the "current" table above is raised before configuration is authored.
2. Configuration document is authored per GA-4 and GA-5 and loads without schema-validation error.
3. Every parameter listed above is present, is read by the processor, and demonstrably changes behaviour — a parameter set but not consumed is an unimplemented parameter, not a configured one.
4. Every outcome the deployed processor can emit is present in the configuration with a reason, and the complete list is published to EP-5 so the consuming typologies can weight it.
5. Band limits observe no-gaps and no-overlaps, evaluated as `lowerLimit <= value < upperLimit`.
6. Unit tests cover every band or case, every exit condition and `.err`, including boundary values on every limit.
7. A transaction is pushed through the deployed stack and the expected `subRuleRef` is observed in the evaluation result.

**Assumptions**

- Bound to `pacs.008.001.10` only, which stock Tazama 4.0.0 does ingest — this rule is fully testable today. On an FX leg it returns no result and contributes nothing.
- Blocked by the EP-2 stories implementing `amountBasis`, `restrictToSameCurrency`, `txStsSuccessCodes`. Until those close, the configuration loads but the rule behaves as before.
- All severities and the weights derived from them are provisional (GA-7) and are tuned against FUT data before CUG.

**Sub-tasks:** `US-112.1` verify baseline · `US-112.2` processor code · `US-112.3` author config · `US-112.4` unit tests · `US-112.5` deploy and smoke

---

### US-113 — Rule 020: Large Transaction Amount vs History (CDTR)

| | |
|---|---|
| **Message binding** | `pacs.008.001.10` + `pacs.009.001.07` |
| **Returned metric** | z-score vs creditor lifetime mean |
| **Feeds** | 7 typologies — 092p, 121p, 124p, 185p, 005s, 037s, 214s |
| **Band set** | Derived by the Developer Guide, not published by the rule package — **verify first** |

**Description**

Configure rule 020 for the COMESA deployment. Same `.x03`/`.x04` issue as rule 010. Lifetime-history query with no bounded window — flag for the NFR track.

*Current deployed configuration (Tazama 4.0.0 seed — treat as expectation, verify in `US-113.1`):*

| Outcome | Deployed limit | Deployed reason |
|---|---|---|
| `.01` | < 3 | The amount of the incoming transaction is within acceptable limits for the creditor |
| `.02` | >= 3 | The amount of the incoming transaction shows a significant increase for the creditor |
| `.x00` | exit condition | — |
| `.x01` | exit condition | — |
| `.x03` | exit condition | — |
| `.x04` | exit condition | — |

*Target configuration:*

| Outcome | Lower | Upper | Meaning | Severity |
|---|---|---|---|---|
| `.01` | −∞ | 1 | Within normal range | 0.0 |
| `.02` | 1 | 2 | Moderately above history | 0.5 |
| `.03` | 2 | +∞ | Significantly above history | 1.0 |

**Parameters to add or modify:** `amountBasis`, `currencyScope: perCorridor`, `identityResolutionViaCorrelationId`, `txStsSuccessCodes`

> ⚠️ **Outcome inventory gap.** The deployed rule can emit `.x01`, `.x03`, `.x04`, which the COMESA outcome policy (`.x00` and `.err` everywhere, `.x01` on rule 018 only) does not cover. Any typology containing this rule that does not weight them **will stall** when the rule returns it. Resolve via `US-801` before `US-113.3`.

**Acceptance Criteria**

1. Deployed baseline for rule 020 is read and recorded; every difference from the "current" table above is raised before configuration is authored.
2. The band set is **confirmed against the deployed rule**, not assumed. A boundary mismatch silently changes every weight built on it, so this is a hard gate on the rest of the story.
3. Configuration document is authored per GA-4 and GA-5 and loads without schema-validation error.
4. Every parameter listed above is present, is read by the processor, and demonstrably changes behaviour — a parameter set but not consumed is an unimplemented parameter, not a configured one.
5. Every outcome the deployed processor can emit is present in the configuration with a reason, and the complete list is published to EP-5 so the consuming typologies can weight it.
6. Band limits observe no-gaps and no-overlaps, evaluated as `lowerLimit <= value < upperLimit`.
7. The disposition of `.x01`, `.x03`, `.x04` is decided in `US-801`, implemented here, and reflected in all 7 consuming typologies.
8. Unit tests cover every band or case, every exit condition and `.err`, including boundary values on every limit.
9. A transaction is pushed through the deployed stack and the expected `subRuleRef` is observed in the evaluation result — or the test is written and marked pending on GA-3 where the binding is `pacs.009` or `pacs.002.001.15`.

**Assumptions**

- Bound to both `pacs.008` and `pacs.009`. **`pacs.009` is not ingestible by stock Tazama 4.0.0 (GA-3)** — the FX path cannot be end-to-end tested in this backlog.
- Blocked by the EP-2 stories implementing `amountBasis`, `currencyScope`, `identityResolutionViaCorrelationId`, `txStsSuccessCodes`. Until those close, the configuration loads but the rule behaves as before.
- The band set in the target table was derived from the returned metric because the rule package does not publish it. It is a starting point for verification, not a specification.
- All severities and the weights derived from them are provisional (GA-7) and are tuned against FUT data before CUG.

**Sub-tasks:** `US-113.1` verify baseline · `US-113.2` processor code · `US-113.3` author config · `US-113.4` unit tests · `US-113.5` deploy and smoke

---

### US-114 — Rule 021: Large Number of Similar Transaction Amounts (CDTR)

| | |
|---|---|
| **Message binding** | `pacs.008.001.10` only |
| **Returned metric** | count of similar inbound amounts, rolling 24h |
| **Feeds** | 9 typologies — 051p, 124p, 005s, 024s, 028s, 092s, 098s, 107c, 121c |
| **Band set** | Derived by the Developer Guide, not published by the rule package — **verify first** |

**Description**

Configure rule 021 for the COMESA deployment. Band count 2 → 3. The deployed `.02` boundary of 5 becomes the target `.03` boundary, with a new middle band inserted at 2.

*Current deployed configuration (Tazama 4.0.0 seed — treat as expectation, verify in `US-114.1`):*

| Outcome | Deployed limit | Deployed reason |
|---|---|---|
| `.01` | < 5 | The creditor has received an insignificant number of transactions with the same amount in the last 24 hours |
| `.02` | >= 5 | The creditor has received a significant number of transactions with the same amount in the last 24 hours |
| `.x00` | exit condition | — |
| `.x01` | exit condition | — |

*Target configuration:*

| Outcome | Lower | Upper | Meaning | Severity |
|---|---|---|---|---|
| `.01` | 0 | 2 | Few similar amounts | 0.0 |
| `.02` | 2 | 5 | Several similar amounts | 0.6 |
| `.03` | 5 | +∞ | Large number | 1.0 |

**Parameters to add or modify:** `amountBasis`, `restrictToSameCurrency`, `txStsSuccessCodes`

> ⚠️ **Outcome inventory gap.** The deployed rule can emit `.x01`, which the COMESA outcome policy (`.x00` and `.err` everywhere, `.x01` on rule 018 only) does not cover. Any typology containing this rule that does not weight it **will stall** when the rule returns it. Resolve via `US-801` before `US-114.3`.

**Acceptance Criteria**

1. Deployed baseline for rule 021 is read and recorded; every difference from the "current" table above is raised before configuration is authored.
2. The band set is **confirmed against the deployed rule**, not assumed. A boundary mismatch silently changes every weight built on it, so this is a hard gate on the rest of the story.
3. Configuration document is authored per GA-4 and GA-5 and loads without schema-validation error.
4. Every parameter listed above is present, is read by the processor, and demonstrably changes behaviour — a parameter set but not consumed is an unimplemented parameter, not a configured one.
5. Every outcome the deployed processor can emit is present in the configuration with a reason, and the complete list is published to EP-5 so the consuming typologies can weight it.
6. Band limits observe no-gaps and no-overlaps, evaluated as `lowerLimit <= value < upperLimit`.
7. The disposition of `.x01` is decided in `US-801`, implemented here, and reflected in all 9 consuming typologies.
8. Unit tests cover every band or case, every exit condition and `.err`, including boundary values on every limit.
9. A transaction is pushed through the deployed stack and the expected `subRuleRef` is observed in the evaluation result.

**Assumptions**

- Bound to `pacs.008.001.10` only, which stock Tazama 4.0.0 does ingest — this rule is fully testable today. On an FX leg it returns no result and contributes nothing.
- Blocked by the EP-2 stories implementing `amountBasis`, `restrictToSameCurrency`, `txStsSuccessCodes`. Until those close, the configuration loads but the rule behaves as before.
- The band set in the target table was derived from the returned metric because the rule package does not publish it. It is a starting point for verification, not a specification.
- All severities and the weights derived from them are provisional (GA-7) and are tuned against FUT data before CUG.

**Sub-tasks:** `US-114.1` verify baseline · `US-114.2` processor code · `US-114.3` author config · `US-114.4` unit tests · `US-114.5` deploy and smoke

---

### US-115 — Rule 024: Non-Commissioned Transaction Mirroring (CDTR)

| | |
|---|---|
| **Message binding** | `pacs.008.001.10` only |
| **Returned metric** | mirror match (0/1) |
| **Feeds** | 16 typologies — 005p, 092p, 098p, 214p, 001s, 011s, 024s, 028s, 037s, 044s, 045s, 047s, 124s, 129s, 169s, 095c |
| **Band set** | Stated |

**Description**

Configure rule 024 for the COMESA deployment. **Semantics invert.** Deployed `.01` means *immediate mirroring detected* (severity would be high); the target `.01` means *no mirroring* (severity 0.0). This is not a boundary shift — the meaning of the outcome codes changes, and every typology weight keyed to `.01` changes with it. Verify against the deployed rule before authoring. Deployed also carries `.x03` ("no mirroring detected"), which the COMESA outcome policy omits — note this may be where the deployed rule expresses the "no mirroring" case, in which case the target band set is redundant with it.

*Current deployed configuration (Tazama 4.0.0 seed — treat as expectation, verify in `US-115.1`):*

| Outcome | Deployed limit | Deployed reason |
|---|---|---|
| `.01` | < 2 | Immediate non-commissioned transaction mirroring detected |
| `.02` | >= 2 | Aggregated non-commissioned transaction mirroring detected |
| `.x00` | exit condition | — |
| `.x01` | exit condition | — |
| `.x03` | exit condition | — |

*Target configuration:*

| Outcome | Lower | Upper | Meaning | Severity |
|---|---|---|---|---|
| `.01` | −∞ | 1 | No mirroring | 0.0 |
| `.02` | 1 | +∞ | Pass-through, nothing retained | 1.0 |

**Parameters to add or modify:** `amountBasis`, `restrictToSameCurrency`, `correlationIdField`, `excludeRefundLinkedTxns`

> ⚠️ **Outcome inventory gap.** The deployed rule can emit `.x01`, `.x03`, which the COMESA outcome policy (`.x00` and `.err` everywhere, `.x01` on rule 018 only) does not cover. Any typology containing this rule that does not weight them **will stall** when the rule returns it. Resolve via `US-801` before `US-115.3`.

**Acceptance Criteria**

1. Deployed baseline for rule 024 is read and recorded; every difference from the "current" table above is raised before configuration is authored.
2. Configuration document is authored per GA-4 and GA-5 and loads without schema-validation error.
3. Every parameter listed above is present, is read by the processor, and demonstrably changes behaviour — a parameter set but not consumed is an unimplemented parameter, not a configured one.
4. Every outcome the deployed processor can emit is present in the configuration with a reason, and the complete list is published to EP-5 so the consuming typologies can weight it.
5. Band limits observe no-gaps and no-overlaps, evaluated as `lowerLimit <= value < upperLimit`.
6. The disposition of `.x01`, `.x03` is decided in `US-801`, implemented here, and reflected in all 16 consuming typologies.
7. Unit tests cover every band or case, every exit condition and `.err`, including boundary values on every limit.
8. A transaction is pushed through the deployed stack and the expected `subRuleRef` is observed in the evaluation result.

**Assumptions**

- Bound to `pacs.008.001.10` only, which stock Tazama 4.0.0 does ingest — this rule is fully testable today. On an FX leg it returns no result and contributes nothing.
- Blocked by the EP-2 stories implementing `amountBasis`, `restrictToSameCurrency`, `correlationIdField`, `excludeRefundLinkedTxns`. Until those close, the configuration loads but the rule behaves as before.
- All severities and the weights derived from them are provisional (GA-7) and are tuned against FUT data before CUG.

**Sub-tasks:** `US-115.1` verify baseline · `US-115.2` processor code · `US-115.3` author config · `US-115.4` unit tests · `US-115.5` deploy and smoke

---

### US-116 — Rule 025: Non-Commissioned Transaction Mirroring (DBTR)

| | |
|---|---|
| **Message binding** | `pacs.008.001.10` only |
| **Returned metric** | mirror match (0/1) |
| **Feeds** | 11 typologies — 005p, 092p, 098p, 214p, 001s, 011s, 024s, 047s, 124s, 129s, 169s |
| **Band set** | Derived by the Developer Guide, not published by the rule package — **verify first** |

**Description**

Configure rule 025 for the COMESA deployment. **Semantics invert.** Deployed `.01` means *immediate mirroring detected* (severity would be high); the target `.01` means *no mirroring* (severity 0.0). This is not a boundary shift — the meaning of the outcome codes changes, and every typology weight keyed to `.01` changes with it. Verify against the deployed rule before authoring. Deployed also carries `.x03` ("no mirroring detected"), which the COMESA outcome policy omits — note this may be where the deployed rule expresses the "no mirroring" case, in which case the target band set is redundant with it.

*Current deployed configuration (Tazama 4.0.0 seed — treat as expectation, verify in `US-116.1`):*

| Outcome | Deployed limit | Deployed reason |
|---|---|---|
| `.01` | < 2 | Immediate non-commissioned transaction mirroring detected |
| `.02` | >= 2 | Aggregated non-commissioned transaction mirroring detected |
| `.x00` | exit condition | — |
| `.x01` | exit condition | — |
| `.x03` | exit condition | — |

*Target configuration:*

| Outcome | Lower | Upper | Meaning | Severity |
|---|---|---|---|---|
| `.01` | −∞ | 1 | No mirroring | 0.0 |
| `.02` | 1 | +∞ | Pass-through, nothing retained | 1.0 |

**Parameters to add or modify:** `amountBasis`, `restrictToSameCurrency`, `correlationIdField`, `excludeRefundLinkedTxns`

> ⚠️ **Outcome inventory gap.** The deployed rule can emit `.x01`, `.x03`, which the COMESA outcome policy (`.x00` and `.err` everywhere, `.x01` on rule 018 only) does not cover. Any typology containing this rule that does not weight them **will stall** when the rule returns it. Resolve via `US-801` before `US-116.3`.

**Acceptance Criteria**

1. Deployed baseline for rule 025 is read and recorded; every difference from the "current" table above is raised before configuration is authored.
2. The band set is **confirmed against the deployed rule**, not assumed. A boundary mismatch silently changes every weight built on it, so this is a hard gate on the rest of the story.
3. Configuration document is authored per GA-4 and GA-5 and loads without schema-validation error.
4. Every parameter listed above is present, is read by the processor, and demonstrably changes behaviour — a parameter set but not consumed is an unimplemented parameter, not a configured one.
5. Every outcome the deployed processor can emit is present in the configuration with a reason, and the complete list is published to EP-5 so the consuming typologies can weight it.
6. Band limits observe no-gaps and no-overlaps, evaluated as `lowerLimit <= value < upperLimit`.
7. The disposition of `.x01`, `.x03` is decided in `US-801`, implemented here, and reflected in all 11 consuming typologies.
8. Unit tests cover every band or case, every exit condition and `.err`, including boundary values on every limit.
9. A transaction is pushed through the deployed stack and the expected `subRuleRef` is observed in the evaluation result.

**Assumptions**

- Bound to `pacs.008.001.10` only, which stock Tazama 4.0.0 does ingest — this rule is fully testable today. On an FX leg it returns no result and contributes nothing.
- Blocked by the EP-2 stories implementing `amountBasis`, `restrictToSameCurrency`, `correlationIdField`, `excludeRefundLinkedTxns`. Until those close, the configuration loads but the rule behaves as before.
- The band set in the target table was derived from the returned metric because the rule package does not publish it. It is a starting point for verification, not a specification.
- All severities and the weights derived from them are provisional (GA-7) and are tuned against FUT data before CUG.

**Sub-tasks:** `US-116.1` verify baseline · `US-116.2` processor code · `US-116.3` author config · `US-116.4` unit tests · `US-116.5` deploy and smoke

---

### US-117 — Rule 026: Commissioned Transaction Mirroring (CDTR)

| | |
|---|---|
| **Message binding** | `pacs.008.001.10` only |
| **Returned metric** | mirror match net of commission |
| **Feeds** | 16 typologies — 001s, 005s, 011s, 024s, 028s, 037s, 044s, 045s, 047s, 092s, 098s, 124s, 129s, 169s, 214s, 095c |
| **Band set** | Derived by the Developer Guide, not published by the rule package — **verify first** |

**Description**

Configure rule 026 for the COMESA deployment. Same outcome-semantics inversion as 024/025 — verify before authoring. Additionally needs `commissionBasis` to state which amount leg the existing `commission` percentage applies against, since FX corridors carry two legs. What `commissionBasis` resolves to on a single-leg domestic message must be defined.

*Current deployed configuration (Tazama 4.0.0 seed — treat as expectation, verify in `US-117.1`):*

| Outcome | Deployed limit | Deployed reason |
|---|---|---|
| `.01` | < 2 | Immediate commissioned transaction mirroring detected |
| `.02` | >= 2 | Aggregated commissioned transaction mirroring detected |
| `.x00` | exit condition | — |
| `.x01` | exit condition | — |
| `.x03` | exit condition | — |

*Target configuration:*

| Outcome | Lower | Upper | Meaning | Severity |
|---|---|---|---|---|
| `.01` | −∞ | 1 | No commissioned mirroring | 0.0 |
| `.02` | 1 | +∞ | Pass-through, commission retained | 1.0 |

**Parameters to add or modify:** `amountBasis`, `restrictToSameCurrency`, `correlationIdField`, `excludeRefundLinkedTxns`, `commissionBasis`

> ⚠️ **Outcome inventory gap.** The deployed rule can emit `.x01`, `.x03`, which the COMESA outcome policy (`.x00` and `.err` everywhere, `.x01` on rule 018 only) does not cover. Any typology containing this rule that does not weight them **will stall** when the rule returns it. Resolve via `US-801` before `US-117.3`.

**Acceptance Criteria**

1. Deployed baseline for rule 026 is read and recorded; every difference from the "current" table above is raised before configuration is authored.
2. The band set is **confirmed against the deployed rule**, not assumed. A boundary mismatch silently changes every weight built on it, so this is a hard gate on the rest of the story.
3. Configuration document is authored per GA-4 and GA-5 and loads without schema-validation error.
4. Every parameter listed above is present, is read by the processor, and demonstrably changes behaviour — a parameter set but not consumed is an unimplemented parameter, not a configured one.
5. Every outcome the deployed processor can emit is present in the configuration with a reason, and the complete list is published to EP-5 so the consuming typologies can weight it.
6. Band limits observe no-gaps and no-overlaps, evaluated as `lowerLimit <= value < upperLimit`.
7. The disposition of `.x01`, `.x03` is decided in `US-801`, implemented here, and reflected in all 16 consuming typologies.
8. Unit tests cover every band or case, every exit condition and `.err`, including boundary values on every limit.
9. A transaction is pushed through the deployed stack and the expected `subRuleRef` is observed in the evaluation result.

**Assumptions**

- Bound to `pacs.008.001.10` only, which stock Tazama 4.0.0 does ingest — this rule is fully testable today. On an FX leg it returns no result and contributes nothing.
- Blocked by the EP-2 stories implementing `amountBasis`, `restrictToSameCurrency`, `correlationIdField`, `excludeRefundLinkedTxns`, `commissionBasis`. Until those close, the configuration loads but the rule behaves as before.
- The band set in the target table was derived from the returned metric because the rule package does not publish it. It is a starting point for verification, not a specification.
- All severities and the weights derived from them are provisional (GA-7) and are tuned against FUT data before CUG.

**Sub-tasks:** `US-117.1` verify baseline · `US-117.2` processor code · `US-117.3` author config · `US-117.4` unit tests · `US-117.5` deploy and smoke

---

### US-118 — Rule 027: Commissioned Transaction Mirroring (DBTR)

| | |
|---|---|
| **Message binding** | `pacs.008.001.10` only |
| **Returned metric** | mirror match net of commission |
| **Feeds** | 11 typologies — 001s, 005s, 011s, 024s, 047s, 092s, 098s, 124s, 129s, 169s, 214s |
| **Band set** | Derived by the Developer Guide, not published by the rule package — **verify first** |

**Description**

Configure rule 027 for the COMESA deployment. Same outcome-semantics inversion as 024/025 — verify before authoring. Additionally needs `commissionBasis` to state which amount leg the existing `commission` percentage applies against, since FX corridors carry two legs. What `commissionBasis` resolves to on a single-leg domestic message must be defined.

*Current deployed configuration (Tazama 4.0.0 seed — treat as expectation, verify in `US-118.1`):*

| Outcome | Deployed limit | Deployed reason |
|---|---|---|
| `.01` | < 2 | Immediate commissioned transaction mirroring detected |
| `.02` | >= 2 | Aggregated commissioned transaction mirroring detected |
| `.x00` | exit condition | — |
| `.x01` | exit condition | — |
| `.x03` | exit condition | — |

*Target configuration:*

| Outcome | Lower | Upper | Meaning | Severity |
|---|---|---|---|---|
| `.01` | −∞ | 1 | No commissioned mirroring | 0.0 |
| `.02` | 1 | +∞ | Pass-through, commission retained | 1.0 |

**Parameters to add or modify:** `amountBasis`, `restrictToSameCurrency`, `correlationIdField`, `excludeRefundLinkedTxns`, `commissionBasis`

> ⚠️ **Outcome inventory gap.** The deployed rule can emit `.x01`, `.x03`, which the COMESA outcome policy (`.x00` and `.err` everywhere, `.x01` on rule 018 only) does not cover. Any typology containing this rule that does not weight them **will stall** when the rule returns it. Resolve via `US-801` before `US-118.3`.

**Acceptance Criteria**

1. Deployed baseline for rule 027 is read and recorded; every difference from the "current" table above is raised before configuration is authored.
2. The band set is **confirmed against the deployed rule**, not assumed. A boundary mismatch silently changes every weight built on it, so this is a hard gate on the rest of the story.
3. Configuration document is authored per GA-4 and GA-5 and loads without schema-validation error.
4. Every parameter listed above is present, is read by the processor, and demonstrably changes behaviour — a parameter set but not consumed is an unimplemented parameter, not a configured one.
5. Every outcome the deployed processor can emit is present in the configuration with a reason, and the complete list is published to EP-5 so the consuming typologies can weight it.
6. Band limits observe no-gaps and no-overlaps, evaluated as `lowerLimit <= value < upperLimit`.
7. The disposition of `.x01`, `.x03` is decided in `US-801`, implemented here, and reflected in all 11 consuming typologies.
8. Unit tests cover every band or case, every exit condition and `.err`, including boundary values on every limit.
9. A transaction is pushed through the deployed stack and the expected `subRuleRef` is observed in the evaluation result.

**Assumptions**

- Bound to `pacs.008.001.10` only, which stock Tazama 4.0.0 does ingest — this rule is fully testable today. On an FX leg it returns no result and contributes nothing.
- Blocked by the EP-2 stories implementing `amountBasis`, `restrictToSameCurrency`, `correlationIdField`, `excludeRefundLinkedTxns`, `commissionBasis`. Until those close, the configuration loads but the rule behaves as before.
- The band set in the target table was derived from the returned metric because the rule package does not publish it. It is a starting point for verification, not a specification.
- All severities and the weights derived from them are provisional (GA-7) and are tuned against FUT data before CUG.

**Sub-tasks:** `US-118.1` verify baseline · `US-118.2` processor code · `US-118.3` author config · `US-118.4` unit tests · `US-118.5` deploy and smoke

---

### US-119 — Rule 028: Age Classification (DBTR)

| | |
|---|---|
| **Message binding** | `pacs.008.001.10` + `pacs.009.001.07` |
| **Returned metric** | debtor age in years at transaction date |
| **Feeds** | 4 typologies — 028p, 121p, 044s, 047s |
| **Band set** | Stated |

**Description**

Configure rule 028 for the COMESA deployment. Band count 2 → 4; units are years in both, so no conversion needed. Age is derived at evaluation time as `GrpHdr.CreDtTm` minus `DtAndPlcOfBirth.BirthDt`. Date of birth is confirmed present in the Mojaloop message set. Note the severity curve is **non-monotonic** — minors 1.0, middle-aged 0.0, seniors 0.7 — which is intentional (vulnerability, not risk of criminality) and must survive review. Typology 121 targets a **creditor** who is a minor but this rule reads the **debtor**; see `US-805`.

*Current deployed configuration (Tazama 4.0.0 seed — treat as expectation, verify in `US-119.1`):*

| Outcome | Deployed limit | Deployed reason |
|---|---|---|
| `.01` | [0, 18) | The debtor is younger than 18 years old |
| `.02` | >= 18 | The debtor is 30 years or older |
| *(no exit conditions deployed)* | | |

*Target configuration:*

| Outcome | Lower | Upper | Meaning | Severity |
|---|---|---|---|---|
| `.01` | 0 | 18 | Minor — high vulnerability | 1.0 |
| `.02` | 18 | 30 | Young adult | 0.3 |
| `.03` | 30 | 50 | Middle aged | 0.0 |
| `.04` | 50 | +∞ | Senior — elevated vulnerability | 0.7 |

**Parameters to add or modify:** `accountKey`, `identitySourceStage`

**Acceptance Criteria**

1. Deployed baseline for rule 028 is read and recorded; every difference from the "current" table above is raised before configuration is authored.
2. Configuration document is authored per GA-4 and GA-5 and loads without schema-validation error.
3. Every parameter listed above is present, is read by the processor, and demonstrably changes behaviour — a parameter set but not consumed is an unimplemented parameter, not a configured one.
4. Every outcome the deployed processor can emit is present in the configuration with a reason, and the complete list is published to EP-5 so the consuming typologies can weight it.
5. Band limits observe no-gaps and no-overlaps, evaluated as `lowerLimit <= value < upperLimit`.
6. Unit tests cover every band or case, every exit condition and `.err`, including boundary values on every limit.
7. A transaction is pushed through the deployed stack and the expected `subRuleRef` is observed in the evaluation result — or the test is written and marked pending on GA-3 where the binding is `pacs.009` or `pacs.002.001.15`.

**Assumptions**

- Bound to both `pacs.008` and `pacs.009`. **`pacs.009` is not ingestible by stock Tazama 4.0.0 (GA-3)** — the FX path cannot be end-to-end tested in this backlog.
- Blocked by the EP-2 stories implementing `accountKey`, `identitySourceStage`. Until those close, the configuration loads but the rule behaves as before.
- All severities and the weights derived from them are provisional (GA-7) and are tuned against FUT data before CUG.

**Sub-tasks:** `US-119.1` verify baseline · `US-119.2` processor code · `US-119.3` author config · `US-119.4` unit tests · `US-119.5` deploy and smoke

---

### US-120 — Rule 030: Transfer to Unfamiliar Creditor Account (DBTR)

| | |
|---|---|
| **Message binding** | `pacs.008.001.10` + `pacs.009.001.07` |
| **Returned metric** | ordinal payment number to this creditor |
| **Feeds** | 7 typologies — 028p, 037p, 044p, 047p, 045s, 105s, 214s |
| **Band set** | Stated |

**Description**

Configure rule 030 for the COMESA deployment. Band count 2 → 3; the deployed `.01` boundary is preserved and a new band splits second from third-or-later. One of only two rules whose deployed exit set is exactly `.x00`.

*Current deployed configuration (Tazama 4.0.0 seed — treat as expectation, verify in `US-120.1`):*

| Outcome | Deployed limit | Deployed reason |
|---|---|---|
| `.01` | < 2 | First successful payment from this debtor to creditor account |
| `.02` | >= 2 | Second or more successful payment from this debtor to creditor account |
| `.x00` | exit condition | — |

*Target configuration:*

| Outcome | Lower | Upper | Meaning | Severity |
|---|---|---|---|---|
| `.01` | −∞ | 2 | First ever payment | 1.0 |
| `.02` | 2 | 3 | Second payment | 0.5 |
| `.03` | 3 | +∞ | Established relationship | 0.0 |

**Parameters to add or modify:** `accountKey`, `identityResolutionViaCorrelationId`, `identitySourceStage`, `currencyScope: any`, `txStsSuccessCodes`, `transactionStage`

**Acceptance Criteria**

1. Deployed baseline for rule 030 is read and recorded; every difference from the "current" table above is raised before configuration is authored.
2. Configuration document is authored per GA-4 and GA-5 and loads without schema-validation error.
3. Every parameter listed above is present, is read by the processor, and demonstrably changes behaviour — a parameter set but not consumed is an unimplemented parameter, not a configured one.
4. Every outcome the deployed processor can emit is present in the configuration with a reason, and the complete list is published to EP-5 so the consuming typologies can weight it.
5. Band limits observe no-gaps and no-overlaps, evaluated as `lowerLimit <= value < upperLimit`.
6. Unit tests cover every band or case, every exit condition and `.err`, including boundary values on every limit.
7. A transaction is pushed through the deployed stack and the expected `subRuleRef` is observed in the evaluation result — or the test is written and marked pending on GA-3 where the binding is `pacs.009` or `pacs.002.001.15`.

**Assumptions**

- Bound to both `pacs.008` and `pacs.009`. **`pacs.009` is not ingestible by stock Tazama 4.0.0 (GA-3)** — the FX path cannot be end-to-end tested in this backlog.
- Blocked by the EP-2 stories implementing `accountKey`, `identityResolutionViaCorrelationId`, `identitySourceStage`, `currencyScope`, `txStsSuccessCodes`, `transactionStage`. Until those close, the configuration loads but the rule behaves as before.
- All severities and the weights derived from them are provisional (GA-7) and are tuned against FUT data before CUG.

**Sub-tasks:** `US-120.1` verify baseline · `US-120.2` processor code · `US-120.3` author config · `US-120.4` unit tests · `US-120.5` deploy and smoke

---

### US-121 — Rule 044: Successful Transactions from the debtor

| | |
|---|---|
| **Message binding** | `pacs.008.001.10` + `pacs.009.001.07` |
| **Returned metric** | lifetime successful outbound count |
| **Feeds** | 6 typologies — 045p, 037c, 044c, 098c, 105c, 214c |
| **Band set** | Derived by the Developer Guide, not published by the rule package — **verify first** |

**Description**

Configure rule 044 for the COMESA deployment. Band count is unchanged at 3 but **every boundary moves** — deployed 1 and 2, target 5 and 20 — and the severity direction is the opposite of the deployed reason text. Lifetime-history query with no bounded window; flag for the NFR track.

*Current deployed configuration (Tazama 4.0.0 seed — treat as expectation, verify in `US-121.1`):*

| Outcome | Deployed limit | Deployed reason |
|---|---|---|
| `.01` | < 1 | To date, no successful payments have been made from debtor account |
| `.02` | [1, 2) | To date, one successful payment has been made |
| `.03` | >= 2 | To date, two or more successful payments have been made |
| *(no exit conditions deployed)* | | |

*Target configuration:*

| Outcome | Lower | Upper | Meaning | Severity |
|---|---|---|---|---|
| `.01` | 0 | 5 | Little history | 1.0 |
| `.02` | 5 | 20 | Moderate history | 0.4 |
| `.03` | 20 | +∞ | Established user | 0.0 |

**Parameters to add or modify:** `accountKey`, `txStsSuccessCodes`, `currencyScope: any`, `transactionStage`

**Acceptance Criteria**

1. Deployed baseline for rule 044 is read and recorded; every difference from the "current" table above is raised before configuration is authored.
2. The band set is **confirmed against the deployed rule**, not assumed. A boundary mismatch silently changes every weight built on it, so this is a hard gate on the rest of the story.
3. Configuration document is authored per GA-4 and GA-5 and loads without schema-validation error.
4. Every parameter listed above is present, is read by the processor, and demonstrably changes behaviour — a parameter set but not consumed is an unimplemented parameter, not a configured one.
5. Every outcome the deployed processor can emit is present in the configuration with a reason, and the complete list is published to EP-5 so the consuming typologies can weight it.
6. Band limits observe no-gaps and no-overlaps, evaluated as `lowerLimit <= value < upperLimit`.
7. Unit tests cover every band or case, every exit condition and `.err`, including boundary values on every limit.
8. A transaction is pushed through the deployed stack and the expected `subRuleRef` is observed in the evaluation result — or the test is written and marked pending on GA-3 where the binding is `pacs.009` or `pacs.002.001.15`.

**Assumptions**

- Bound to both `pacs.008` and `pacs.009`. **`pacs.009` is not ingestible by stock Tazama 4.0.0 (GA-3)** — the FX path cannot be end-to-end tested in this backlog.
- Blocked by the EP-2 stories implementing `accountKey`, `txStsSuccessCodes`, `currencyScope`, `transactionStage`. Until those close, the configuration loads but the rule behaves as before.
- The band set in the target table was derived from the returned metric because the rule package does not publish it. It is a starting point for verification, not a specification.
- All severities and the weights derived from them are provisional (GA-7) and are tuned against FUT data before CUG.

**Sub-tasks:** `US-121.1` verify baseline · `US-121.2` processor code · `US-121.3` author config · `US-121.4` unit tests · `US-121.5` deploy and smoke

---

### US-122 — Rule 045: Successful Transactions to the creditor

| | |
|---|---|
| **Message binding** | `pacs.008.001.10` + `pacs.009.001.07` |
| **Returned metric** | lifetime successful inbound count |
| **Feeds** | 4 typologies — 195p, 047s, 105c, 214c |
| **Band set** | Derived by the Developer Guide, not published by the rule package — **verify first** |

**Description**

Configure rule 045 for the COMESA deployment. Band count is unchanged at 3 but **every boundary moves** — deployed 1 and 2, target 5 and 20 — and the severity direction is the opposite of the deployed reason text. Lifetime-history query with no bounded window; flag for the NFR track.

*Current deployed configuration (Tazama 4.0.0 seed — treat as expectation, verify in `US-122.1`):*

| Outcome | Deployed limit | Deployed reason |
|---|---|---|
| `.01` | < 1 | To date, no successful payments have been made to creditor account |
| `.02` | [1, 2) | To date, one successful payment has been made |
| `.03` | >= 2 | To date, two or more successful payments have been made |
| *(no exit conditions deployed)* | | |

*Target configuration:*

| Outcome | Lower | Upper | Meaning | Severity |
|---|---|---|---|---|
| `.01` | 0 | 5 | Little history | 1.0 |
| `.02` | 5 | 20 | Moderate history | 0.4 |
| `.03` | 20 | +∞ | Established user | 0.0 |

**Parameters to add or modify:** `accountKey`, `txStsSuccessCodes`, `currencyScope: any`, `transactionStage`, `identityResolutionViaCorrelationId`

**Acceptance Criteria**

1. Deployed baseline for rule 045 is read and recorded; every difference from the "current" table above is raised before configuration is authored.
2. The band set is **confirmed against the deployed rule**, not assumed. A boundary mismatch silently changes every weight built on it, so this is a hard gate on the rest of the story.
3. Configuration document is authored per GA-4 and GA-5 and loads without schema-validation error.
4. Every parameter listed above is present, is read by the processor, and demonstrably changes behaviour — a parameter set but not consumed is an unimplemented parameter, not a configured one.
5. Every outcome the deployed processor can emit is present in the configuration with a reason, and the complete list is published to EP-5 so the consuming typologies can weight it.
6. Band limits observe no-gaps and no-overlaps, evaluated as `lowerLimit <= value < upperLimit`.
7. Unit tests cover every band or case, every exit condition and `.err`, including boundary values on every limit.
8. A transaction is pushed through the deployed stack and the expected `subRuleRef` is observed in the evaluation result — or the test is written and marked pending on GA-3 where the binding is `pacs.009` or `pacs.002.001.15`.

**Assumptions**

- Bound to both `pacs.008` and `pacs.009`. **`pacs.009` is not ingestible by stock Tazama 4.0.0 (GA-3)** — the FX path cannot be end-to-end tested in this backlog.
- Blocked by the EP-2 stories implementing `accountKey`, `txStsSuccessCodes`, `currencyScope`, `transactionStage`, `identityResolutionViaCorrelationId`. Until those close, the configuration loads but the rule behaves as before.
- The band set in the target table was derived from the returned metric because the rule package does not publish it. It is a starting point for verification, not a specification.
- All severities and the weights derived from them are provisional (GA-7) and are tuned against FUT data before CUG.

**Sub-tasks:** `US-122.1` verify baseline · `US-122.2` processor code · `US-122.3` author config · `US-122.4` unit tests · `US-122.5` deploy and smoke

---

### US-123 — Rule 048: Large Transaction Amount vs History (DBTR)

| | |
|---|---|
| **Message binding** | `pacs.008.001.10` + `pacs.009.001.07` |
| **Returned metric** | z-score vs debtor lifetime mean |
| **Feeds** | 12 typologies — 185p, 002s, 005s, 011s, 028s, 037s, 044s, 045s, 047s, 092s, 214s, 010c |
| **Band set** | Derived by the Developer Guide, not published by the rule package — **verify first** |

**Description**

Configure rule 048 for the COMESA deployment. Same `.x03`/`.x04` issue as rule 010. Debtor-side mirror of rule 020.

*Current deployed configuration (Tazama 4.0.0 seed — treat as expectation, verify in `US-123.1`):*

| Outcome | Deployed limit | Deployed reason |
|---|---|---|
| `.01` | < 3 | The amount of the outgoing transaction is within acceptable limits for the debtor |
| `.02` | >= 3 | The amount of the outgoing transaction shows a significant increase for the debtor |
| `.x00` | exit condition | — |
| `.x01` | exit condition | — |
| `.x03` | exit condition | — |
| `.x04` | exit condition | — |

*Target configuration:*

| Outcome | Lower | Upper | Meaning | Severity |
|---|---|---|---|---|
| `.01` | −∞ | 1 | Within normal range | 0.0 |
| `.02` | 1 | 2 | Moderately above history | 0.5 |
| `.03` | 2 | +∞ | Significantly above history | 1.0 |

**Parameters to add or modify:** `amountBasis`, `currencyScope: perCorridor`, `txStsSuccessCodes`

> ⚠️ **Outcome inventory gap.** The deployed rule can emit `.x01`, `.x03`, `.x04`, which the COMESA outcome policy (`.x00` and `.err` everywhere, `.x01` on rule 018 only) does not cover. Any typology containing this rule that does not weight them **will stall** when the rule returns it. Resolve via `US-801` before `US-123.3`.

**Acceptance Criteria**

1. Deployed baseline for rule 048 is read and recorded; every difference from the "current" table above is raised before configuration is authored.
2. The band set is **confirmed against the deployed rule**, not assumed. A boundary mismatch silently changes every weight built on it, so this is a hard gate on the rest of the story.
3. Configuration document is authored per GA-4 and GA-5 and loads without schema-validation error.
4. Every parameter listed above is present, is read by the processor, and demonstrably changes behaviour — a parameter set but not consumed is an unimplemented parameter, not a configured one.
5. Every outcome the deployed processor can emit is present in the configuration with a reason, and the complete list is published to EP-5 so the consuming typologies can weight it.
6. Band limits observe no-gaps and no-overlaps, evaluated as `lowerLimit <= value < upperLimit`.
7. The disposition of `.x01`, `.x03`, `.x04` is decided in `US-801`, implemented here, and reflected in all 12 consuming typologies.
8. Unit tests cover every band or case, every exit condition and `.err`, including boundary values on every limit.
9. A transaction is pushed through the deployed stack and the expected `subRuleRef` is observed in the evaluation result — or the test is written and marked pending on GA-3 where the binding is `pacs.009` or `pacs.002.001.15`.

**Assumptions**

- Bound to both `pacs.008` and `pacs.009`. **`pacs.009` is not ingestible by stock Tazama 4.0.0 (GA-3)** — the FX path cannot be end-to-end tested in this backlog.
- Blocked by the EP-2 stories implementing `amountBasis`, `currencyScope`, `txStsSuccessCodes`. Until those close, the configuration loads but the rule behaves as before.
- The band set in the target table was derived from the returned metric because the rule package does not publish it. It is a starting point for verification, not a specification.
- All severities and the weights derived from them are provisional (GA-7) and are tuned against FUT data before CUG.

**Sub-tasks:** `US-123.1` verify baseline · `US-123.2` processor code · `US-123.3` author config · `US-123.4` unit tests · `US-123.5` deploy and smoke

---

### US-124 — Rule 054: Synthetic Data Check — Benford's Law (DBTR)

| | |
|---|---|
| **Message binding** | `pacs.008.001.10` + `pacs.009.001.07` |
| **Returned metric** | MAD × 1000 (target) — but see note |
| **Feeds** | 12 typologies — 169p, 001c, 003c, 005c, 013c, 024c, 092c, 098c, 107c, 129c, 214c, 216c |
| **Band set** | Stated |

**Description**

Configure rule 054 for the COMESA deployment. **Probable metric mismatch — resolve before authoring.** The deployed boundary is **15.507**, which is the chi-square critical value at 8 degrees of freedom, p=0.05. That strongly implies the deployed processor returns a **chi-square statistic**. The target bands assume **MAD × 1000** with boundaries at 6, 12 and 15. These are different statistics and the band values are not interchangeable. Note the Developer Guide marks 063 as a derived band set but **not** 054, yet both deploy identically — so at least one of the two is wrong. Highest-value single item in `US-004` AC-4. Also: with `currencyScope: perCorridor`, `minimumTransactions` is evaluated within each corridor cohort, so a party active on three corridors needs three independent evaluations.

*Current deployed configuration (Tazama 4.0.0 seed — treat as expectation, verify in `US-124.1`):*

| Outcome | Deployed limit | Deployed reason |
|---|---|---|
| `.01` | < 15.507 | Benfords Law: Debtor transaction history indicates a low probability of fictitious amounts |
| `.02` | >= 15.507 | Benfords Law: Debtor transaction history indicates a high probability of fictitious amounts |
| `.x00` | exit condition | — |
| `.x01` | exit condition | — |

*Target configuration:*

| Outcome | Lower | Upper | Meaning | Severity |
|---|---|---|---|---|
| `.01` | −∞ | 6 | Close conformity | 0.0 |
| `.02` | 6 | 12 | Acceptable deviation | 0.3 |
| `.03` | 12 | 15 | Marginal non-conformity | 0.6 |
| `.04` | 15 | +∞ | Non-conforming — synthetic signal | 1.0 |

**Parameters to add or modify:** `amountBasis`, `currencyScope: perCorridor`

> ⚠️ **Outcome inventory gap.** The deployed rule can emit `.x01`, which the COMESA outcome policy (`.x00` and `.err` everywhere, `.x01` on rule 018 only) does not cover. Any typology containing this rule that does not weight it **will stall** when the rule returns it. Resolve via `US-801` before `US-124.3`.

**Acceptance Criteria**

1. Deployed baseline for rule 054 is read and recorded; every difference from the "current" table above is raised before configuration is authored.
2. Configuration document is authored per GA-4 and GA-5 and loads without schema-validation error.
3. Every parameter listed above is present, is read by the processor, and demonstrably changes behaviour — a parameter set but not consumed is an unimplemented parameter, not a configured one.
4. Every outcome the deployed processor can emit is present in the configuration with a reason, and the complete list is published to EP-5 so the consuming typologies can weight it.
5. Band limits observe no-gaps and no-overlaps, evaluated as `lowerLimit <= value < upperLimit`.
6. The disposition of `.x01` is decided in `US-801`, implemented here, and reflected in all 12 consuming typologies.
7. Unit tests cover every band or case, every exit condition and `.err`, including boundary values on every limit.
8. A transaction is pushed through the deployed stack and the expected `subRuleRef` is observed in the evaluation result — or the test is written and marked pending on GA-3 where the binding is `pacs.009` or `pacs.002.001.15`.

**Assumptions**

- Bound to both `pacs.008` and `pacs.009`. **`pacs.009` is not ingestible by stock Tazama 4.0.0 (GA-3)** — the FX path cannot be end-to-end tested in this backlog.
- Blocked by the EP-2 stories implementing `amountBasis`, `currencyScope`. Until those close, the configuration loads but the rule behaves as before.
- All severities and the weights derived from them are provisional (GA-7) and are tuned against FUT data before CUG.

**Sub-tasks:** `US-124.1` verify baseline · `US-124.2` processor code · `US-124.3` author config · `US-124.4` unit tests · `US-124.5` deploy and smoke

---

### US-125 — Rule 063: Synthetic Data Check — Benford's Law (CDTR)

| | |
|---|---|
| **Message binding** | `pacs.008.001.10` + `pacs.009.001.07` |
| **Returned metric** | MAD × 1000 (target) — but see note |
| **Feeds** | 15 typologies — 169p, 001c, 003c, 005c, 013c, 024c, 028c, 051c, 092c, 098c, 107c, 121c, 129c, 214c, 216c |
| **Band set** | Derived by the Developer Guide, not published by the rule package — **verify first** |

**Description**

Configure rule 063 for the COMESA deployment. **Probable metric mismatch — resolve before authoring.** The deployed boundary is **15.507**, which is the chi-square critical value at 8 degrees of freedom, p=0.05. That strongly implies the deployed processor returns a **chi-square statistic**. The target bands assume **MAD × 1000** with boundaries at 6, 12 and 15. These are different statistics and the band values are not interchangeable. Note the Developer Guide marks 063 as a derived band set but **not** 054, yet both deploy identically — so at least one of the two is wrong. Highest-value single item in `US-004` AC-4. Also: with `currencyScope: perCorridor`, `minimumTransactions` is evaluated within each corridor cohort, so a party active on three corridors needs three independent evaluations.

*Current deployed configuration (Tazama 4.0.0 seed — treat as expectation, verify in `US-125.1`):*

| Outcome | Deployed limit | Deployed reason |
|---|---|---|
| `.01` | < 15.507 | Benfords Law: Creditor transaction history indicates a low probability of fictitious amounts |
| `.02` | >= 15.507 | Benfords Law: Creditor transaction history indicates a high probability of fictitious amounts |
| `.x00` | exit condition | — |
| `.x01` | exit condition | — |

*Target configuration:*

| Outcome | Lower | Upper | Meaning | Severity |
|---|---|---|---|---|
| `.01` | −∞ | 6 | Close conformity | 0.0 |
| `.02` | 6 | 12 | Acceptable deviation | 0.3 |
| `.03` | 12 | 15 | Marginal non-conformity | 0.6 |
| `.04` | 15 | +∞ | Non-conforming — synthetic signal | 1.0 |

**Parameters to add or modify:** `amountBasis`, `currencyScope: perCorridor`, `identityResolutionViaCorrelationId`

> ⚠️ **Outcome inventory gap.** The deployed rule can emit `.x01`, which the COMESA outcome policy (`.x00` and `.err` everywhere, `.x01` on rule 018 only) does not cover. Any typology containing this rule that does not weight it **will stall** when the rule returns it. Resolve via `US-801` before `US-125.3`.

**Acceptance Criteria**

1. Deployed baseline for rule 063 is read and recorded; every difference from the "current" table above is raised before configuration is authored.
2. The band set is **confirmed against the deployed rule**, not assumed. A boundary mismatch silently changes every weight built on it, so this is a hard gate on the rest of the story.
3. Configuration document is authored per GA-4 and GA-5 and loads without schema-validation error.
4. Every parameter listed above is present, is read by the processor, and demonstrably changes behaviour — a parameter set but not consumed is an unimplemented parameter, not a configured one.
5. Every outcome the deployed processor can emit is present in the configuration with a reason, and the complete list is published to EP-5 so the consuming typologies can weight it.
6. Band limits observe no-gaps and no-overlaps, evaluated as `lowerLimit <= value < upperLimit`.
7. The disposition of `.x01` is decided in `US-801`, implemented here, and reflected in all 15 consuming typologies.
8. Unit tests cover every band or case, every exit condition and `.err`, including boundary values on every limit.
9. A transaction is pushed through the deployed stack and the expected `subRuleRef` is observed in the evaluation result — or the test is written and marked pending on GA-3 where the binding is `pacs.009` or `pacs.002.001.15`.

**Assumptions**

- Bound to both `pacs.008` and `pacs.009`. **`pacs.009` is not ingestible by stock Tazama 4.0.0 (GA-3)** — the FX path cannot be end-to-end tested in this backlog.
- Blocked by the EP-2 stories implementing `amountBasis`, `currencyScope`, `identityResolutionViaCorrelationId`. Until those close, the configuration loads but the rule behaves as before.
- The band set in the target table was derived from the returned metric because the rule package does not publish it. It is a starting point for verification, not a specification.
- All severities and the weights derived from them are provisional (GA-7) and are tuned against FUT data before CUG.

**Sub-tasks:** `US-125.1` verify baseline · `US-125.2` processor code · `US-125.3` author config · `US-125.4` unit tests · `US-125.5` deploy and smoke

---

### US-126 — Rule 076: Time Since Last Transaction (DBTR)

| | |
|---|---|
| **Message binding** | `pacs.002.001.15` only |
| **Returned metric** | gap in seconds, settlement basis |
| **Feeds** | 3 typologies — 047p, 095s, 002c |
| **Band set** | Stated |

**Description**

Configure rule 076 for the COMESA deployment. **Unit change** (ms → seconds) and band count 2 → 3. The deployed 300 000 ms boundary equals the target `.03` boundary of 300 seconds — same value, different unit — which makes this an easy defect to miss. **The only rule bound to `pacs.002`,** and therefore the sole scoring rule for typologies 002, 047 and 095 on that message type. Blocked by GA-3 for end-to-end test: Tazama 4.0.0 ships `pacs.002.001.12`, the FSD specifies `.15`.

*Current deployed configuration (Tazama 4.0.0 seed — treat as expectation, verify in `US-126.1`):*

| Outcome | Deployed limit | Deployed reason |
|---|---|---|
| `.01` | < 300 000 ms (5 min) | Suspiciously quick follow-up transaction |
| `.02` | >= 300 000 ms | Follow-up transaction speed within acceptable limits |
| `.x01` | exit condition | — |

*Target configuration:*

| Outcome | Lower | Upper | Meaning | Severity |
|---|---|---|---|---|
| `.01` | −∞ | 60 | Suspiciously quick follow-up | 1.0 |
| `.02` | 60 | 300 | Surprisingly quick follow-up | 0.5 |
| `.03` | 300 | +∞ | Within normal limits | 0.0 |

**Parameters to add or modify:** `timestampBasis`, `txStsSuccessCodes`

> ⚠️ **Outcome inventory gap.** The deployed rule can emit `.x01`, which the COMESA outcome policy (`.x00` and `.err` everywhere, `.x01` on rule 018 only) does not cover. Any typology containing this rule that does not weight it **will stall** when the rule returns it. Resolve via `US-801` before `US-126.3`.

**Acceptance Criteria**

1. Deployed baseline for rule 076 is read and recorded; every difference from the "current" table above is raised before configuration is authored.
2. Configuration document is authored per GA-4 and GA-5 and loads without schema-validation error.
3. Every parameter listed above is present, is read by the processor, and demonstrably changes behaviour — a parameter set but not consumed is an unimplemented parameter, not a configured one.
4. Every outcome the deployed processor can emit is present in the configuration with a reason, and the complete list is published to EP-5 so the consuming typologies can weight it.
5. Band limits observe no-gaps and no-overlaps, evaluated as `lowerLimit <= value < upperLimit`.
6. The disposition of `.x01` is decided in `US-801`, implemented here, and reflected in all 3 consuming typologies.
7. Unit tests cover every band or case, every exit condition and `.err`, including boundary values on every limit.
8. A transaction is pushed through the deployed stack and the expected `subRuleRef` is observed in the evaluation result — or the test is written and marked pending on GA-3 where the binding is `pacs.009` or `pacs.002.001.15`.

**Assumptions**

- Bound to `pacs.002.001.15`. **Tazama 4.0.0 ships `pacs.002.001.12` (GA-3)** — this rule cannot be end-to-end tested until message onboarding lands.
- Blocked by the EP-2 stories implementing `timestampBasis`, `txStsSuccessCodes`. Until those close, the configuration loads but the rule behaves as before.
- All severities and the weights derived from them are provisional (GA-7) and are tuned against FUT data before CUG.

**Sub-tasks:** `US-126.1` verify baseline · `US-126.2` processor code · `US-126.3` author config · `US-126.4` unit tests · `US-126.5` deploy and smoke

---

### US-127 — Rule 078: Transaction Type

| | |
|---|---|
| **Message binding** | `pacs.008.001.10` only |
| **Returned metric** | case classification |
| **Feeds** | 8 typologies — 191p, 092s, 005c, 011c, 045c, 047c, 124c, 129c |
| **Band set** | Stated |
| **Band change** | **Yes — 4th case `.04` REFD added.** |

**Description**

Configure rule 078 for the COMESA deployment. **Two problems beyond the added case.** First, the deployed rule ships in two variants — an ISO 20022 one (`MP2B`/`MP2P`/`CASH`) and a Mojaloop one (`PAYMENT`/`TRANSFER`/`WITHDRAWAL`). COMESA runs on Mojaloop, so the Mojaloop variant is the base. Second, the **case codes are reassigned**: deployed `.01` is a merchant payment, target `.01` is a cash withdrawal. Every weight keyed to `.01` in all eight consuming typologies changes meaning. Third, **the target case set has no `.00`**. Tazama reserves `.00` as the mandatory catch-all for cased rules and the deployed config has it; the FSD instead says an unmapped value returns `.err`. If the deployed rule emits `.00` and no typology weights it, all eight typologies stall. Resolve in `US-804`.

*Current deployed configuration (Tazama 4.0.0 seed — treat as expectation, verify in `US-127.1`):*

| Outcome | Deployed limit | Deployed reason |
|---|---|---|
| `.01` | value = MP2B / PAYMENT | Mobile P2B / merchant payment |
| `.02` | value = MP2P / TRANSFER | Mobile P2P / direct funds transfer |
| `.03` | value = CASH / WITHDRAWAL | Cash management instruction / cash withdrawal |
| `.00` | <ELSE> (reserved catch-all) | The transaction type is not defined in this rule configuration |
| *(no exit conditions deployed)* | | |

*Target configuration:*

| Outcome | Lower | Upper | Meaning | Severity |
|---|---|---|---|---|
| `.01` | −∞ | +∞ | Cash withdrawal | 1.0 |
| `.02` | −∞ | +∞ | Merchant payment (P2B) | 0.2 |
| `.03` | −∞ | +∞ | Direct funds transfer (P2P) | 0.5 |
| `.04` | −∞ | +∞ | Refund (InstrForCdtrAgt.Cd = REFD) | 0.7 |

**Parameters to add or modify:** `purposeCodeToCaseMap`

> ⚠️ **Outcome inventory gap.** The deployed rule can emit `.00`, which the COMESA outcome policy (`.x00` and `.err` everywhere, `.x01` on rule 018 only) does not cover. Any typology containing this rule that does not weight it **will stall** when the rule returns it. Resolve via `US-801` before `US-127.3`.

**Acceptance Criteria**

1. Deployed baseline for rule 078 is read and recorded; every difference from the "current" table above is raised before configuration is authored.
2. Configuration document is authored per GA-4 and GA-5 and loads without schema-validation error.
3. Every parameter listed above is present, is read by the processor, and demonstrably changes behaviour — a parameter set but not consumed is an unimplemented parameter, not a configured one.
4. Every outcome the deployed processor can emit is present in the configuration with a reason, and the complete list is published to EP-5 so the consuming typologies can weight it.
5. Band limits observe no-gaps and no-overlaps, evaluated as `lowerLimit <= value < upperLimit`.
6. The disposition of `.00` is decided in `US-801`, implemented here, and reflected in all 8 consuming typologies.
7. Unit tests cover every band or case, every exit condition and `.err`, including boundary values on every limit.
8. A transaction is pushed through the deployed stack and the expected `subRuleRef` is observed in the evaluation result.

**Assumptions**

- Bound to `pacs.008.001.10` only, which stock Tazama 4.0.0 does ingest — this rule is fully testable today. On an FX leg it returns no result and contributes nothing.
- Blocked by the EP-2 stories implementing `purposeCodeToCaseMap`. Until those close, the configuration loads but the rule behaves as before.
- All severities and the weights derived from them are provisional (GA-7) and are tuned against FUT data before CUG.

**Sub-tasks:** `US-127.1` verify baseline · `US-127.2` processor code · `US-127.3` author config · `US-127.4` unit tests · `US-127.5` deploy and smoke

---

### US-128 — Rule 083: Multiple Accounts Associated with a Debtor

| | |
|---|---|
| **Message binding** | `pacs.008.001.10` + `pacs.009.001.07` |
| **Returned metric** | distinct debtor accounts |
| **Feeds** | 8 typologies — 003p, 013p, 105p, 107p, 001s, 024s, 045s, 044c |
| **Band set** | Stated |

**Description**

Configure rule 083 for the COMESA deployment. **Band boundaries already match the deployed configuration.** The change is entirely parameter-level. Depends on `identityResolutionRule`: without it, MSISDN, ALIAS and DEVICE identifiers for one wallet count as three accounts, so this rule systematically over-counts and typologies 003, 013 and 105 over-fire. The deployed reason text has a "more one account" typo which the COMESA reasons correct.

*Current deployed configuration (Tazama 4.0.0 seed — treat as expectation, verify in `US-128.1`):*

| Outcome | Deployed limit | Deployed reason |
|---|---|---|
| `.01` | < 2 | Debtor has only one account |
| `.02` | >= 2 | Debtor has more one account |
| *(no exit conditions deployed)* | | |

*Target configuration:*

| Outcome | Lower | Upper | Meaning | Severity |
|---|---|---|---|---|
| `.01` | −∞ | 2 | One account | 0.0 |
| `.02` | 2 | +∞ | More than one account | 1.0 |

**Parameters to add or modify:** `accountKey`, `identityResolutionRule`, `identityResolutionViaCorrelationId`

**Acceptance Criteria**

1. Deployed baseline for rule 083 is read and recorded; every difference from the "current" table above is raised before configuration is authored.
2. Configuration document is authored per GA-4 and GA-5 and loads without schema-validation error.
3. Every parameter listed above is present, is read by the processor, and demonstrably changes behaviour — a parameter set but not consumed is an unimplemented parameter, not a configured one.
4. Every outcome the deployed processor can emit is present in the configuration with a reason, and the complete list is published to EP-5 so the consuming typologies can weight it.
5. Band limits observe no-gaps and no-overlaps, evaluated as `lowerLimit <= value < upperLimit`.
6. Unit tests cover every band or case, every exit condition and `.err`, including boundary values on every limit.
7. A transaction is pushed through the deployed stack and the expected `subRuleRef` is observed in the evaluation result — or the test is written and marked pending on GA-3 where the binding is `pacs.009` or `pacs.002.001.15`.

**Assumptions**

- Bound to both `pacs.008` and `pacs.009`. **`pacs.009` is not ingestible by stock Tazama 4.0.0 (GA-3)** — the FX path cannot be end-to-end tested in this backlog.
- Blocked by the EP-2 stories implementing `accountKey`, `identityResolutionRule`, `identityResolutionViaCorrelationId`. Until those close, the configuration loads but the rule behaves as before.
- All severities and the weights derived from them are provisional (GA-7) and are tuned against FUT data before CUG.

**Sub-tasks:** `US-128.1` verify baseline · `US-128.2` processor code · `US-128.3` author config · `US-128.4` unit tests · `US-128.5` deploy and smoke

---

### US-129 — Rule 084: Multiple Accounts Associated with a Creditor

| | |
|---|---|
| **Message binding** | `pacs.008.001.10` + `pacs.009.001.07` |
| **Returned metric** | distinct creditor accounts |
| **Feeds** | 8 typologies — 003p, 013p, 105p, 107p, 001s, 024s, 028s, 047s |
| **Band set** | Derived by the Developer Guide, not published by the rule package — **verify first** |

**Description**

Configure rule 084 for the COMESA deployment. **Band boundaries already match the deployed configuration.** The change is entirely parameter-level. Depends on `identityResolutionRule`: without it, MSISDN, ALIAS and DEVICE identifiers for one wallet count as three accounts, so this rule systematically over-counts and typologies 003, 013 and 105 over-fire. The deployed reason text has a "more one account" typo which the COMESA reasons correct.

*Current deployed configuration (Tazama 4.0.0 seed — treat as expectation, verify in `US-129.1`):*

| Outcome | Deployed limit | Deployed reason |
|---|---|---|
| `.01` | < 2 | Creditor has only one account |
| `.02` | >= 2 | Creditor has more one account |
| *(no exit conditions deployed)* | | |

*Target configuration:*

| Outcome | Lower | Upper | Meaning | Severity |
|---|---|---|---|---|
| `.01` | −∞ | 2 | One account | 0.0 |
| `.02` | 2 | +∞ | More than one account | 1.0 |

**Parameters to add or modify:** `accountKey`, `identityResolutionRule`, `identityResolutionViaCorrelationId`

**Acceptance Criteria**

1. Deployed baseline for rule 084 is read and recorded; every difference from the "current" table above is raised before configuration is authored.
2. The band set is **confirmed against the deployed rule**, not assumed. A boundary mismatch silently changes every weight built on it, so this is a hard gate on the rest of the story.
3. Configuration document is authored per GA-4 and GA-5 and loads without schema-validation error.
4. Every parameter listed above is present, is read by the processor, and demonstrably changes behaviour — a parameter set but not consumed is an unimplemented parameter, not a configured one.
5. Every outcome the deployed processor can emit is present in the configuration with a reason, and the complete list is published to EP-5 so the consuming typologies can weight it.
6. Band limits observe no-gaps and no-overlaps, evaluated as `lowerLimit <= value < upperLimit`.
7. Unit tests cover every band or case, every exit condition and `.err`, including boundary values on every limit.
8. A transaction is pushed through the deployed stack and the expected `subRuleRef` is observed in the evaluation result — or the test is written and marked pending on GA-3 where the binding is `pacs.009` or `pacs.002.001.15`.

**Assumptions**

- Bound to both `pacs.008` and `pacs.009`. **`pacs.009` is not ingestible by stock Tazama 4.0.0 (GA-3)** — the FX path cannot be end-to-end tested in this backlog.
- Blocked by the EP-2 stories implementing `accountKey`, `identityResolutionRule`, `identityResolutionViaCorrelationId`. Until those close, the configuration loads but the rule behaves as before.
- The band set in the target table was derived from the returned metric because the rule package does not publish it. It is a starting point for verification, not a specification.
- All severities and the weights derived from them are provisional (GA-7) and are tuned against FUT data before CUG.

**Sub-tasks:** `US-129.1` verify baseline · `US-129.2` processor code · `US-129.3` author config · `US-129.4` unit tests · `US-129.5` deploy and smoke

---

### US-130 — Rule 090: Upstream Transaction Divergence (DBTR)

| | |
|---|---|
| **Message binding** | `pacs.008.001.10` + `pacs.009.001.07` |
| **Returned metric** | distinct downstream destinations of upstream senders |
| **Feeds** | 11 typologies — 011p, 024p, 107p, 129p, 001s, 005s, 013s, 098s, 214s, 216s, 121c |
| **Band set** | Derived by the Developer Guide, not published by the rule package — **verify first** |

**Description**

Configure rule 090 for the COMESA deployment. Band count 2 → 3 and both boundaries move. The only graph-traversal rule in the set — upstream and downstream across the debtor’s previous counterparties — and materially more expensive than a single-account lookup. No traversal bound is specified beyond the existing `upstreamRange`/`downstreamRange`; flag for the NFR track. Membership note: 090 belongs to typologies 024 and 129, **not** to 124.

*Current deployed configuration (Tazama 4.0.0 seed — treat as expectation, verify in `US-130.1`):*

| Outcome | Deployed limit | Deployed reason |
|---|---|---|
| `.01` | < 3 | Upstream transaction divergence within acceptable limits |
| `.02` | >= 3 | Upstream transaction divergence detected |
| *(no exit conditions deployed)* | | |

*Target configuration:*

| Outcome | Lower | Upper | Meaning | Severity |
|---|---|---|---|---|
| `.01` | −∞ | 5 | Low branching factor | 0.0 |
| `.02` | 5 | 15 | Moderate branching factor | 0.6 |
| `.03` | 15 | +∞ | High branching factor | 1.0 |

**Parameters to add or modify:** `accountKey`, `correlationIdField`, `excludeRefundLinkedTxns`, `identityResolutionViaCorrelationId`, `currencyScope: any`

**Acceptance Criteria**

1. Deployed baseline for rule 090 is read and recorded; every difference from the "current" table above is raised before configuration is authored.
2. The band set is **confirmed against the deployed rule**, not assumed. A boundary mismatch silently changes every weight built on it, so this is a hard gate on the rest of the story.
3. Configuration document is authored per GA-4 and GA-5 and loads without schema-validation error.
4. Every parameter listed above is present, is read by the processor, and demonstrably changes behaviour — a parameter set but not consumed is an unimplemented parameter, not a configured one.
5. Every outcome the deployed processor can emit is present in the configuration with a reason, and the complete list is published to EP-5 so the consuming typologies can weight it.
6. Band limits observe no-gaps and no-overlaps, evaluated as `lowerLimit <= value < upperLimit`.
7. Unit tests cover every band or case, every exit condition and `.err`, including boundary values on every limit.
8. A transaction is pushed through the deployed stack and the expected `subRuleRef` is observed in the evaluation result — or the test is written and marked pending on GA-3 where the binding is `pacs.009` or `pacs.002.001.15`.

**Assumptions**

- Bound to both `pacs.008` and `pacs.009`. **`pacs.009` is not ingestible by stock Tazama 4.0.0 (GA-3)** — the FX path cannot be end-to-end tested in this backlog.
- Blocked by the EP-2 stories implementing `accountKey`, `correlationIdField`, `excludeRefundLinkedTxns`, `identityResolutionViaCorrelationId`, `currencyScope`. Until those close, the configuration loads but the rule behaves as before.
- The band set in the target table was derived from the returned metric because the rule package does not publish it. It is a starting point for verification, not a specification.
- All severities and the weights derived from them are provisional (GA-7) and are tuned against FUT data before CUG.

**Sub-tasks:** `US-130.1` verify baseline · `US-130.2` processor code · `US-130.3` author config · `US-130.4` unit tests · `US-130.5` deploy and smoke

---

### US-131 — Rule 091: Transaction Amount vs Regulatory Threshold

| | |
|---|---|
| **Message binding** | `pacs.008.001.10` + `pacs.009.001.07` |
| **Returned metric** | amount ÷ corridorThreshold (a ratio) |
| **Feeds** | 4 typologies — 010p, 137p, 169p, 214c |
| **Band set** | Stated |

**Description**

Configure rule 091 for the COMESA deployment. **Highest regulatory priority in the set — build this rule first.** The band *count* is unchanged but the *metric* changes from an absolute amount to a **ratio**, so the deployed hard-coded 10 000 boundary becomes 1. That is a processor code change (`US-020`), not a band edit. `.err` is weighted **100 in typology 137 only** — the single non-zero `.err` in the entire configuration — so an unconfigured corridor raises an alert rather than passing silently. It is deliberately **not** duplicated into typologies 010, 169 or 214: one configuration defect should raise one alert, not four. Do not "correct" that asymmetry.

*Current deployed configuration (Tazama 4.0.0 seed — treat as expectation, verify in `US-131.1`):*

| Outcome | Deployed limit | Deployed reason |
|---|---|---|
| `.01` | < 10 000 | Transaction amount within regulatory limits |
| `.02` | >= 10 000 | Transaction amount exceeds regulatory threshold |
| *(no exit conditions deployed)* | | |

*Target configuration:*

| Outcome | Lower | Upper | Meaning | Severity |
|---|---|---|---|---|
| `.01` | −∞ | 1 | Within reporting threshold | 0.0 |
| `.02` | 1 | +∞ | At or above threshold — STR required | 1.0 |

**Parameters to add or modify:** `corridorThreshold`, `amountBasis: IntrBkSttlmAmt`

**Acceptance Criteria**

1. Deployed baseline for rule 091 is read and recorded; every difference from the "current" table above is raised before configuration is authored.
2. Configuration document is authored per GA-4 and GA-5 and loads without schema-validation error.
3. Every parameter listed above is present, is read by the processor, and demonstrably changes behaviour — a parameter set but not consumed is an unimplemented parameter, not a configured one.
4. Every outcome the deployed processor can emit is present in the configuration with a reason, and the complete list is published to EP-5 so the consuming typologies can weight it.
5. Band limits observe no-gaps and no-overlaps, evaluated as `lowerLimit <= value < upperLimit`.
6. Unit tests cover every band or case, every exit condition and `.err`, including boundary values on every limit.
7. A transaction is pushed through the deployed stack and the expected `subRuleRef` is observed in the evaluation result — or the test is written and marked pending on GA-3 where the binding is `pacs.009` or `pacs.002.001.15`.

**Assumptions**

- Bound to both `pacs.008` and `pacs.009`. **`pacs.009` is not ingestible by stock Tazama 4.0.0 (GA-3)** — the FX path cannot be end-to-end tested in this backlog.
- Blocked by the EP-2 stories implementing `corridorThreshold`, `amountBasis`. Until those close, the configuration loads but the rule behaves as before.
- All severities and the weights derived from them are provisional (GA-7) and are tuned against FUT data before CUG.

**Sub-tasks:** `US-131.1` verify baseline · `US-131.2` processor code · `US-131.3` author config · `US-131.4` unit tests · `US-131.5` deploy and smoke

---
# EP-5 — Typology Configuration

**Goal:** 30 active typologies configured and provably complete, plus 179 shipped deactivated.

> **Read before starting any story in this epic.** A typology is a JSON document, not code. It lists member rules, assigns a weight to **every** outcome each member can emit, sums them via an `expression`, and compares the total to `alertThreshold`.
>
> Two rules govern this entire epic:
>
> 1. **Completeness or stall.** If a member rule emits a `subRuleRef` the typology does not weight, the typology never completes. This is the defect that `US-033` AC-7 exists to prevent, and it is why each story below lists its member rules with outcome gaps.
> 2. **Weights are generated, not typed.** `weight = tier cap × band severity`, with caps of 100 primary / 60 supporting / 30 contextual. Roughly 700 weights exist across this epic. Author the severity and role data in `US-033` and generate the documents; do not hand-type `wghts` arrays.
>
> **Per-message documents.** Per `US-006`, each typology is authored as one document *per message type* it is routed on, keyed `cfg: "<typology>-<msg>@1.0.0"`, because Tazama's typology configuration carries a single `alertThreshold`. The `Max` and `Alert` in each story's routing table are the operative values for that message. The full-chain figure is shown for reference only — **it is not a value to load**.
>
> | Suffix | Sub-task |
> |---|---|
> | `.1` | Confirm membership and roles against the register; confirm every member rule's outcome inventory from its EP-4 story |
> | `.2` | Add severity and role data for this typology to the `US-033` dataset |
> | `.3` | Generate and review the per-message configuration documents |
> | `.4` | Run the §11.2 arithmetic checks for this typology |
> | `.5` | Load and prove a scoring scenario end to end |


---

### US-201 — Typology 001: Several currencies, structured transactions, many persons involved

| | |
|---|---|
| **Members** | 12 rules |
| **Full-chain max / alert** | 780 / 390 *(reference only — do not load)* |
| **Composition** | 002 primary · 016 primary · 017 primary · 024 supporting · 025 supporting · 026 supporting · 027 supporting · 083 supporting · 084 supporting · 090 supporting · 054 contextual · 063 contextual |

**Description**

Configure typology 001 (Several currencies, structured transactions, many persons involved) for COMESA. The "several currencies" element is no longer carried by any rule that compares currencies directly — it is carried by per-corridor cohorting (`currencyScope: perCorridor`) inside rules 002, 016, 054 and 063. If `US-011` is not closed, this typology does not detect what it is named for.

*Operative per-message configuration — these are the values to load:*

| Message type | Rules evaluable | Max | `alertThreshold` |
|---|---|---|---|
| `pacs.008` | 12 | 780 | **390** (50% of max) |
| `pacs.009` | 8 | 540 | **270** (50% of max) |

> ⚠️ **Outcome inventory.** 6 of this typology's 12 member rules emit outcomes the COMESA policy does not cover: **024** → `.x01` `.x03`; **025** → `.x01` `.x03`; **026** → `.x01` `.x03`; **027** → `.x01` `.x03`; **054** → `.x01`; **063** → `.x01`. Each must be weighted here or the typology stalls when that rule returns one. Resolve via `US-801`.

**Acceptance Criteria**

1. Membership and roles match the register exactly: 002 as primary, 016 as primary, 017 as primary, 024 as supporting, 025 as supporting, 026 as supporting, 027 as supporting, 083 as supporting, 084 as supporting, 090 as supporting, 054 as contextual, 063 as contextual.
2. Every weight equals `tier cap × band severity`, generated from the `US-033` dataset rather than typed.
3. **Every outcome every member rule can emit is weighted** — every band or case, every exit condition, and `.err`. Verified against the outcome inventories published by the EP-4 stories, by the automated check in `US-702`.
4. One configuration document exists per routed message type, keyed per `US-006`, each carrying the `alertThreshold` from the table above.
5. The `expression` sums the `termId` of every deterministic member rule; a member absent from the expression contributes nothing regardless of its weights.
6. `interdictionThreshold` is **omitted** and `flowProcessor` is **omitted** (GA-6).
7. The §11.2 arithmetic checks pass: top-severity weights sum to the max, the loaded threshold matches the table above, and `alertThreshold` is the stated percentage of that row's max rounded half-to-even.
8. Every member rule's `.err` is weighted **0**. There is exactly one non-zero `.err` in the whole configuration and it is not in this typology.
9. At least one scoring scenario is run end to end and the resulting typology score and `review` flag match a hand-calculated expectation.

**Assumptions**

- All weights and thresholds are provisional (GA-7). They are loaded as specified so they are consistent and reviewable, then tuned against FUT data before CUG. An alert rate observed in FUT is not a defect until tuning has run.
- Blocked by the EP-4 stories for its member rules — a typology cannot be completed before the outcome inventory of every member is known.
- Routed on `pacs.008`, `pacs.009`. **`pacs.009` cannot be end-to-end tested under GA-3** — those message types are not ingestible by stock Tazama 4.0.0.

**Sub-tasks:** `US-201.1` confirm membership and outcomes · `US-201.2` severity/role data · `US-201.3` generate documents · `US-201.4` arithmetic checks · `US-201.5` scoring scenario

---

### US-202 — Typology 002: Funds from a high number of senders over a short period

| | |
|---|---|
| **Members** | 4 rules |
| **Full-chain max / alert** | 250 / 125 *(reference only — do not load)* |
| **Composition** | 002 primary · 010 supporting · 048 supporting · 076 contextual |

**Description**

Configure typology 002 (Funds from a high number of senders over a short period) for COMESA. **`pacs.002` route recommended for exclusion — see `US-601`.** On that message only rule 076 evaluates, as a *contextual* member with cap 30 against an alert threshold of 15. Rule 076 alone therefore raises the alert. That contradicts the tier model, which defines contextual as "raises or lowers confidence but **cannot carry the case**".

*Operative per-message configuration — these are the values to load:*

| Message type | Rules evaluable | Max | `alertThreshold` |
|---|---|---|---|
| `pacs.002` | 1 | 30 | **15** (50% of max) |
| `pacs.008` | 3 | 220 | **110** (50% of max) |
| `pacs.009` | 3 | 220 | **110** (50% of max) |

> ⚠️ **Outcome inventory.** 3 of this typology's 4 member rules emit outcomes the COMESA policy does not cover: **010** → `.x01` `.x03` `.x04`; **048** → `.x01` `.x03` `.x04`; **076** → `.x01`. Each must be weighted here or the typology stalls when that rule returns one. Resolve via `US-801`.

**Acceptance Criteria**

1. Membership and roles match the register exactly: 002 as primary, 010 as supporting, 048 as supporting, 076 as contextual.
2. Every weight equals `tier cap × band severity`, generated from the `US-033` dataset rather than typed.
3. **Every outcome every member rule can emit is weighted** — every band or case, every exit condition, and `.err`. Verified against the outcome inventories published by the EP-4 stories, by the automated check in `US-702`.
4. One configuration document exists per routed message type, keyed per `US-006`, each carrying the `alertThreshold` from the table above.
5. The `expression` sums the `termId` of every deterministic member rule; a member absent from the expression contributes nothing regardless of its weights.
6. `interdictionThreshold` is **omitted** and `flowProcessor` is **omitted** (GA-6).
7. The §11.2 arithmetic checks pass: top-severity weights sum to the max, the loaded threshold matches the table above, and `alertThreshold` is the stated percentage of that row's max rounded half-to-even.
8. Every member rule's `.err` is weighted **0**. There is exactly one non-zero `.err` in the whole configuration and it is not in this typology.
9. At least one scoring scenario is run end to end and the resulting typology score and `review` flag match a hand-calculated expectation.

**Assumptions**

- All weights and thresholds are provisional (GA-7). They are loaded as specified so they are consistent and reviewable, then tuned against FUT data before CUG. An alert rate observed in FUT is not a defect until tuning has run.
- Blocked by the EP-4 stories for its member rules — a typology cannot be completed before the outcome inventory of every member is known.
- Routed on `pacs.002`, `pacs.008`, `pacs.009`. **`pacs.002` and `pacs.009` cannot be end-to-end tested under GA-3** — those message types are not ingestible by stock Tazama 4.0.0.

**Sub-tasks:** `US-202.1` confirm membership and outcomes · `US-202.2` severity/role data · `US-202.3` generate documents · `US-202.4` arithmetic checks · `US-202.5` scoring scenario

---

### US-203 — Typology 003: High transaction volume with different name spellings

| | |
|---|---|
| **Members** | 7 rules |
| **Full-chain max / alert** | 440 / 220 *(reference only — do not load)* |
| **Composition** | 083 primary · 084 primary · 010 supporting · 011 supporting · 017 supporting · 054 contextual · 063 contextual |

**Description**

Configure typology 003 (High transaction volume with different name spellings) for COMESA. **Do not promote past FUT.** Depends on `identityResolutionRule` (`US-015`, `US-802`). Until it is defined, rules 083/084 count MSISDN, ALIAS and DEVICE aliases for one wallet as separate accounts and this typology over-fires.

*Operative per-message configuration — these are the values to load:*

| Message type | Rules evaluable | Max | `alertThreshold` |
|---|---|---|---|
| `pacs.008` | 7 | 440 | **220** (50% of max) |
| `pacs.009` | 7 | 440 | **220** (50% of max) |

> ⚠️ **Outcome inventory.** 4 of this typology's 7 member rules emit outcomes the COMESA policy does not cover: **010** → `.x01` `.x03` `.x04`; **011** → `.x01` `.x03` `.x04`; **054** → `.x01`; **063** → `.x01`. Each must be weighted here or the typology stalls when that rule returns one. Resolve via `US-801`.

**Acceptance Criteria**

1. Membership and roles match the register exactly: 083 as primary, 084 as primary, 010 as supporting, 011 as supporting, 017 as supporting, 054 as contextual, 063 as contextual.
2. Every weight equals `tier cap × band severity`, generated from the `US-033` dataset rather than typed.
3. **Every outcome every member rule can emit is weighted** — every band or case, every exit condition, and `.err`. Verified against the outcome inventories published by the EP-4 stories, by the automated check in `US-702`.
4. One configuration document exists per routed message type, keyed per `US-006`, each carrying the `alertThreshold` from the table above.
5. The `expression` sums the `termId` of every deterministic member rule; a member absent from the expression contributes nothing regardless of its weights.
6. `interdictionThreshold` is **omitted** and `flowProcessor` is **omitted** (GA-6).
7. The §11.2 arithmetic checks pass: top-severity weights sum to the max, the loaded threshold matches the table above, and `alertThreshold` is the stated percentage of that row's max rounded half-to-even.
8. Every member rule's `.err` is weighted **0**. There is exactly one non-zero `.err` in the whole configuration and it is not in this typology.
9. At least one scoring scenario is run end to end and the resulting typology score and `review` flag match a hand-calculated expectation.

**Assumptions**

- All weights and thresholds are provisional (GA-7). They are loaded as specified so they are consistent and reviewable, then tuned against FUT data before CUG. An alert rate observed in FUT is not a defect until tuning has run.
- Blocked by the EP-4 stories for its member rules — a typology cannot be completed before the outcome inventory of every member is known.
- Routed on `pacs.008`, `pacs.009`. **`pacs.009` cannot be end-to-end tested under GA-3** — those message types are not ingestible by stock Tazama 4.0.0.
- **Does not promote past FUT** until `identityResolutionRule` is defined (`US-802`).

**Sub-tasks:** `US-203.1` confirm membership and outcomes · `US-203.2` severity/role data · `US-203.3` generate documents · `US-203.4` arithmetic checks · `US-203.5` scoring scenario

---

### US-204 — Typology 005: Unusual sent/received ratio; inbound then multiple withdrawals

| | |
|---|---|
| **Members** | 15 rules |
| **Full-chain max / alert** | 930 / 465 *(reference only — do not load)* |
| **Composition** | 017 primary · 024 primary · 025 primary · 002 supporting · 016 supporting · 018 supporting · 020 supporting · 021 supporting · 026 supporting · 027 supporting · 048 supporting · 090 supporting · 054 contextual · 063 contextual · 078 contextual |

**Description**

Configure typology 005 (Unusual sent/received ratio; inbound then multiple withdrawals) for COMESA. Loses 7 of its 15 rules on `pacs.009` — max falls from 930 to 460. Under full-chain thresholds it could not alert from the FX leg at all (460 against 465); per-message scaling fixes that. Expect materially lower absolute scores on FX legs.

*Operative per-message configuration — these are the values to load:*

| Message type | Rules evaluable | Max | `alertThreshold` |
|---|---|---|---|
| `pacs.008` | 15 | 930 | **465** (50% of max) |
| `pacs.009` | 8 | 460 | **230** (50% of max) |

> ⚠️ **Outcome inventory.** 10 of this typology's 15 member rules emit outcomes the COMESA policy does not cover: **020** → `.x01` `.x03` `.x04`; **021** → `.x01`; **024** → `.x01` `.x03`; **025** → `.x01` `.x03`; **026** → `.x01` `.x03`; **027** → `.x01` `.x03`; **048** → `.x01` `.x03` `.x04`; **054** → `.x01`; **063** → `.x01`; **078** → `.00`. Each must be weighted here or the typology stalls when that rule returns one. Resolve via `US-801`.

**Acceptance Criteria**

1. Membership and roles match the register exactly: 017 as primary, 024 as primary, 025 as primary, 002 as supporting, 016 as supporting, 018 as supporting, 020 as supporting, 021 as supporting, 026 as supporting, 027 as supporting, 048 as supporting, 090 as supporting, 054 as contextual, 063 as contextual, 078 as contextual.
2. Every weight equals `tier cap × band severity`, generated from the `US-033` dataset rather than typed.
3. **Every outcome every member rule can emit is weighted** — every band or case, every exit condition, and `.err`. Verified against the outcome inventories published by the EP-4 stories, by the automated check in `US-702`.
4. One configuration document exists per routed message type, keyed per `US-006`, each carrying the `alertThreshold` from the table above.
5. The `expression` sums the `termId` of every deterministic member rule; a member absent from the expression contributes nothing regardless of its weights.
6. `interdictionThreshold` is **omitted** and `flowProcessor` is **omitted** (GA-6).
7. The §11.2 arithmetic checks pass: top-severity weights sum to the max, the loaded threshold matches the table above, and `alertThreshold` is the stated percentage of that row's max rounded half-to-even.
8. Every member rule's `.err` is weighted **0**. There is exactly one non-zero `.err` in the whole configuration and it is not in this typology.
9. At least one scoring scenario is run end to end and the resulting typology score and `review` flag match a hand-calculated expectation.

**Assumptions**

- All weights and thresholds are provisional (GA-7). They are loaded as specified so they are consistent and reviewable, then tuned against FUT data before CUG. An alert rate observed in FUT is not a defect until tuning has run.
- Blocked by the EP-4 stories for its member rules — a typology cannot be completed before the outcome inventory of every member is known.
- Routed on `pacs.008`, `pacs.009`. **`pacs.009` cannot be end-to-end tested under GA-3** — those message types are not ingestible by stock Tazama 4.0.0.

**Sub-tasks:** `US-204.1` confirm membership and outcomes · `US-204.2` severity/role data · `US-204.3` generate documents · `US-204.4` arithmetic checks · `US-204.5` scoring scenario

---

### US-205 — Typology 010: Transactions structured just below the reporting threshold

| | |
|---|---|
| **Members** | 4 rules |
| **Full-chain max / alert** | 290 / 145 *(reference only — do not load)* |
| **Composition** | 006 primary · 091 primary · 017 supporting · 048 contextual |

**Description**

Configure typology 010 (Transactions structured just below the reporting threshold) for COMESA. **As configured this typology cannot detect what it is named for**, and its `pacs.009` route is recommended for exclusion (`US-601`). Rule 091 has two bands only — within limits, and at or above threshold. "Just below the threshold" has no band, and `.01` matches the overwhelming majority of legitimate traffic, so structuring is detected only through rules 006 and 017. On `pacs.009` rule 006 is unavailable, so 091 alone (100) breaches the scaled threshold (95) — meaning the typology fires on amounts **above** the threshold, the exact inverse of its purpose, and duplicates typology 137 on the same event. The recommended fix, a rule-091 band `.03` for ratio 0.90–1.00, is a rule-level band change not in the FSD. Configure as specified; do not improvise the band. See `US-807`.

*Operative per-message configuration — these are the values to load:*

| Message type | Rules evaluable | Max | `alertThreshold` |
|---|---|---|---|
| `pacs.008` | 4 | 290 | **145** (50% of max) |
| `pacs.009` | 3 | 190 | **95** (50% of max) |

> ⚠️ **Outcome inventory.** 2 of this typology's 4 member rules emit outcomes the COMESA policy does not cover: **006** → `.x01`; **048** → `.x01` `.x03` `.x04`. Each must be weighted here or the typology stalls when that rule returns one. Resolve via `US-801`.

**Acceptance Criteria**

1. Membership and roles match the register exactly: 006 as primary, 091 as primary, 017 as supporting, 048 as contextual.
2. Every weight equals `tier cap × band severity`, generated from the `US-033` dataset rather than typed.
3. **Every outcome every member rule can emit is weighted** — every band or case, every exit condition, and `.err`. Verified against the outcome inventories published by the EP-4 stories, by the automated check in `US-702`.
4. One configuration document exists per routed message type, keyed per `US-006`, each carrying the `alertThreshold` from the table above.
5. The `expression` sums the `termId` of every deterministic member rule; a member absent from the expression contributes nothing regardless of its weights.
6. `interdictionThreshold` is **omitted** and `flowProcessor` is **omitted** (GA-6).
7. The §11.2 arithmetic checks pass: top-severity weights sum to the max, the loaded threshold matches the table above, and `alertThreshold` is the stated percentage of that row's max rounded half-to-even.
8. Every member rule's `.err` is weighted **0**. There is exactly one non-zero `.err` in the whole configuration and it is not in this typology.
9. At least one scoring scenario is run end to end and the resulting typology score and `review` flag match a hand-calculated expectation.

**Assumptions**

- All weights and thresholds are provisional (GA-7). They are loaded as specified so they are consistent and reviewable, then tuned against FUT data before CUG. An alert rate observed in FUT is not a defect until tuning has run.
- Blocked by the EP-4 stories for its member rules — a typology cannot be completed before the outcome inventory of every member is known.
- Routed on `pacs.008`, `pacs.009`. **`pacs.009` cannot be end-to-end tested under GA-3** — those message types are not ingestible by stock Tazama 4.0.0.

**Sub-tasks:** `US-205.1` confirm membership and outcomes · `US-205.2` severity/role data · `US-205.3` generate documents · `US-205.4` arithmetic checks · `US-205.5` scoring scenario

---

### US-206 — Typology 011: One account to numerous unrelated accounts

| | |
|---|---|
| **Members** | 8 rules |
| **Full-chain max / alert** | 530 / 265 *(reference only — do not load)* |
| **Composition** | 017 primary · 090 primary · 024 supporting · 025 supporting · 026 supporting · 027 supporting · 048 supporting · 078 contextual |

**Description**

Configure typology 011 (One account to numerous unrelated accounts) for COMESA. Loses 5 of 8 rules on `pacs.009` — max falls from 530 to 260. Heavily degraded but still needs two rules to fire, so the route stands.

*Operative per-message configuration — these are the values to load:*

| Message type | Rules evaluable | Max | `alertThreshold` |
|---|---|---|---|
| `pacs.008` | 8 | 530 | **265** (50% of max) |
| `pacs.009` | 3 | 260 | **130** (50% of max) |

> ⚠️ **Outcome inventory.** 6 of this typology's 8 member rules emit outcomes the COMESA policy does not cover: **024** → `.x01` `.x03`; **025** → `.x01` `.x03`; **026** → `.x01` `.x03`; **027** → `.x01` `.x03`; **048** → `.x01` `.x03` `.x04`; **078** → `.00`. Each must be weighted here or the typology stalls when that rule returns one. Resolve via `US-801`.

**Acceptance Criteria**

1. Membership and roles match the register exactly: 017 as primary, 090 as primary, 024 as supporting, 025 as supporting, 026 as supporting, 027 as supporting, 048 as supporting, 078 as contextual.
2. Every weight equals `tier cap × band severity`, generated from the `US-033` dataset rather than typed.
3. **Every outcome every member rule can emit is weighted** — every band or case, every exit condition, and `.err`. Verified against the outcome inventories published by the EP-4 stories, by the automated check in `US-702`.
4. One configuration document exists per routed message type, keyed per `US-006`, each carrying the `alertThreshold` from the table above.
5. The `expression` sums the `termId` of every deterministic member rule; a member absent from the expression contributes nothing regardless of its weights.
6. `interdictionThreshold` is **omitted** and `flowProcessor` is **omitted** (GA-6).
7. The §11.2 arithmetic checks pass: top-severity weights sum to the max, the loaded threshold matches the table above, and `alertThreshold` is the stated percentage of that row's max rounded half-to-even.
8. Every member rule's `.err` is weighted **0**. There is exactly one non-zero `.err` in the whole configuration and it is not in this typology.
9. At least one scoring scenario is run end to end and the resulting typology score and `review` flag match a hand-calculated expectation.

**Assumptions**

- All weights and thresholds are provisional (GA-7). They are loaded as specified so they are consistent and reviewable, then tuned against FUT data before CUG. An alert rate observed in FUT is not a defect until tuning has run.
- Blocked by the EP-4 stories for its member rules — a typology cannot be completed before the outcome inventory of every member is known.
- Routed on `pacs.008`, `pacs.009`. **`pacs.009` cannot be end-to-end tested under GA-3** — those message types are not ingestible by stock Tazama 4.0.0.

**Sub-tasks:** `US-206.1` confirm membership and outcomes · `US-206.2` severity/role data · `US-206.3` generate documents · `US-206.4` arithmetic checks · `US-206.5` scoring scenario

---

### US-207 — Typology 013: Many accounts with the same payment services provider

| | |
|---|---|
| **Members** | 8 rules |
| **Full-chain max / alert** | 500 / 250 *(reference only — do not load)* |
| **Composition** | 083 primary · 084 primary · 002 supporting · 016 supporting · 017 supporting · 090 supporting · 054 contextual · 063 contextual |

**Description**

Configure typology 013 (Many accounts with the same payment services provider) for COMESA. Same `identityResolutionRule` dependency as typology 003. **Do not promote past FUT.**

*Operative per-message configuration — these are the values to load:*

| Message type | Rules evaluable | Max | `alertThreshold` |
|---|---|---|---|
| `pacs.008` | 8 | 500 | **250** (50% of max) |
| `pacs.009` | 8 | 500 | **250** (50% of max) |

> ⚠️ **Outcome inventory.** 2 of this typology's 8 member rules emit outcomes the COMESA policy does not cover: **054** → `.x01`; **063** → `.x01`. Each must be weighted here or the typology stalls when that rule returns one. Resolve via `US-801`.

**Acceptance Criteria**

1. Membership and roles match the register exactly: 083 as primary, 084 as primary, 002 as supporting, 016 as supporting, 017 as supporting, 090 as supporting, 054 as contextual, 063 as contextual.
2. Every weight equals `tier cap × band severity`, generated from the `US-033` dataset rather than typed.
3. **Every outcome every member rule can emit is weighted** — every band or case, every exit condition, and `.err`. Verified against the outcome inventories published by the EP-4 stories, by the automated check in `US-702`.
4. One configuration document exists per routed message type, keyed per `US-006`, each carrying the `alertThreshold` from the table above.
5. The `expression` sums the `termId` of every deterministic member rule; a member absent from the expression contributes nothing regardless of its weights.
6. `interdictionThreshold` is **omitted** and `flowProcessor` is **omitted** (GA-6).
7. The §11.2 arithmetic checks pass: top-severity weights sum to the max, the loaded threshold matches the table above, and `alertThreshold` is the stated percentage of that row's max rounded half-to-even.
8. Every member rule's `.err` is weighted **0**. There is exactly one non-zero `.err` in the whole configuration and it is not in this typology.
9. At least one scoring scenario is run end to end and the resulting typology score and `review` flag match a hand-calculated expectation.

**Assumptions**

- All weights and thresholds are provisional (GA-7). They are loaded as specified so they are consistent and reviewable, then tuned against FUT data before CUG. An alert rate observed in FUT is not a defect until tuning has run.
- Blocked by the EP-4 stories for its member rules — a typology cannot be completed before the outcome inventory of every member is known.
- Routed on `pacs.008`, `pacs.009`. **`pacs.009` cannot be end-to-end tested under GA-3** — those message types are not ingestible by stock Tazama 4.0.0.
- **Does not promote past FUT** until `identityResolutionRule` is defined (`US-802`).

**Sub-tasks:** `US-207.1` confirm membership and outcomes · `US-207.2` severity/role data · `US-207.3` generate documents · `US-207.4` arithmetic checks · `US-207.5` scoring scenario

---

### US-208 — Typology 024: Systematic transfers within a group of individuals and accounts

| | |
|---|---|
| **Members** | 14 rules |
| **Full-chain max / alert** | 900 / 450 *(reference only — do not load)* |
| **Composition** | 008 primary · 017 primary · 090 primary · 002 supporting · 016 supporting · 021 supporting · 024 supporting · 025 supporting · 026 supporting · 027 supporting · 083 supporting · 084 supporting · 054 contextual · 063 contextual |

**Description**

Configure typology 024 (Systematic transfers within a group of individuals and accounts) for COMESA. One of the two large graph typologies carrying rule 090 — the other is 129. Currency-segmented traversal is worth reviewing here.

*Operative per-message configuration — these are the values to load:*

| Message type | Rules evaluable | Max | `alertThreshold` |
|---|---|---|---|
| `pacs.008` | 14 | 900 | **450** (50% of max) |
| `pacs.009` | 8 | 500 | **250** (50% of max) |

> ⚠️ **Outcome inventory.** 8 of this typology's 14 member rules emit outcomes the COMESA policy does not cover: **008** → `.x01`; **021** → `.x01`; **024** → `.x01` `.x03`; **025** → `.x01` `.x03`; **026** → `.x01` `.x03`; **027** → `.x01` `.x03`; **054** → `.x01`; **063** → `.x01`. Each must be weighted here or the typology stalls when that rule returns one. Resolve via `US-801`.

**Acceptance Criteria**

1. Membership and roles match the register exactly: 008 as primary, 017 as primary, 090 as primary, 002 as supporting, 016 as supporting, 021 as supporting, 024 as supporting, 025 as supporting, 026 as supporting, 027 as supporting, 083 as supporting, 084 as supporting, 054 as contextual, 063 as contextual.
2. Every weight equals `tier cap × band severity`, generated from the `US-033` dataset rather than typed.
3. **Every outcome every member rule can emit is weighted** — every band or case, every exit condition, and `.err`. Verified against the outcome inventories published by the EP-4 stories, by the automated check in `US-702`.
4. One configuration document exists per routed message type, keyed per `US-006`, each carrying the `alertThreshold` from the table above.
5. The `expression` sums the `termId` of every deterministic member rule; a member absent from the expression contributes nothing regardless of its weights.
6. `interdictionThreshold` is **omitted** and `flowProcessor` is **omitted** (GA-6).
7. The §11.2 arithmetic checks pass: top-severity weights sum to the max, the loaded threshold matches the table above, and `alertThreshold` is the stated percentage of that row's max rounded half-to-even.
8. Every member rule's `.err` is weighted **0**. There is exactly one non-zero `.err` in the whole configuration and it is not in this typology.
9. At least one scoring scenario is run end to end and the resulting typology score and `review` flag match a hand-calculated expectation.

**Assumptions**

- All weights and thresholds are provisional (GA-7). They are loaded as specified so they are consistent and reviewable, then tuned against FUT data before CUG. An alert rate observed in FUT is not a defect until tuning has run.
- Blocked by the EP-4 stories for its member rules — a typology cannot be completed before the outcome inventory of every member is known.
- Routed on `pacs.008`, `pacs.009`. **`pacs.009` cannot be end-to-end tested under GA-3** — those message types are not ingestible by stock Tazama 4.0.0.

**Sub-tasks:** `US-208.1` confirm membership and outcomes · `US-208.2` severity/role data · `US-208.3` generate documents · `US-208.4` arithmetic checks · `US-208.5` scoring scenario

---

### US-209 — Typology 028: False promotions, phishing, or social engineering scams

| | |
|---|---|
| **Members** | 13 rules |
| **Full-chain max / alert** | 770 / 385 *(reference only — do not load)* |
| **Composition** | 028 primary · 030 primary · 003 supporting · 011 supporting · 016 supporting · 021 supporting · 024 supporting · 026 supporting · 048 supporting · 084 supporting · 008 contextual · 010 contextual · 063 contextual |

**Description**

Configure typology 028 (False promotions, phishing, or social engineering scams) for COMESA. The archetypal scam typology and the largest of the fraud set at 13 rules.

*Operative per-message configuration — these are the values to load:*

| Message type | Rules evaluable | Max | `alertThreshold` |
|---|---|---|---|
| `pacs.008` | 13 | 770 | **385** (50% of max) |
| `pacs.009` | 9 | 560 | **280** (50% of max) |

> ⚠️ **Outcome inventory.** 9 of this typology's 13 member rules emit outcomes the COMESA policy does not cover: **003** → `.x01`; **008** → `.x01`; **010** → `.x01` `.x03` `.x04`; **011** → `.x01` `.x03` `.x04`; **021** → `.x01`; **024** → `.x01` `.x03`; **026** → `.x01` `.x03`; **048** → `.x01` `.x03` `.x04`; **063** → `.x01`. Each must be weighted here or the typology stalls when that rule returns one. Resolve via `US-801`.

**Acceptance Criteria**

1. Membership and roles match the register exactly: 028 as primary, 030 as primary, 003 as supporting, 011 as supporting, 016 as supporting, 021 as supporting, 024 as supporting, 026 as supporting, 048 as supporting, 084 as supporting, 008 as contextual, 010 as contextual, 063 as contextual.
2. Every weight equals `tier cap × band severity`, generated from the `US-033` dataset rather than typed.
3. **Every outcome every member rule can emit is weighted** — every band or case, every exit condition, and `.err`. Verified against the outcome inventories published by the EP-4 stories, by the automated check in `US-702`.
4. One configuration document exists per routed message type, keyed per `US-006`, each carrying the `alertThreshold` from the table above.
5. The `expression` sums the `termId` of every deterministic member rule; a member absent from the expression contributes nothing regardless of its weights.
6. `interdictionThreshold` is **omitted** and `flowProcessor` is **omitted** (GA-6).
7. The §11.2 arithmetic checks pass: top-severity weights sum to the max, the loaded threshold matches the table above, and `alertThreshold` is the stated percentage of that row's max rounded half-to-even.
8. Every member rule's `.err` is weighted **0**. There is exactly one non-zero `.err` in the whole configuration and it is not in this typology.
9. At least one scoring scenario is run end to end and the resulting typology score and `review` flag match a hand-calculated expectation.

**Assumptions**

- All weights and thresholds are provisional (GA-7). They are loaded as specified so they are consistent and reviewable, then tuned against FUT data before CUG. An alert rate observed in FUT is not a defect until tuning has run.
- Blocked by the EP-4 stories for its member rules — a typology cannot be completed before the outcome inventory of every member is known.
- Routed on `pacs.008`, `pacs.009`. **`pacs.009` cannot be end-to-end tested under GA-3** — those message types are not ingestible by stock Tazama 4.0.0.

**Sub-tasks:** `US-209.1` confirm membership and outcomes · `US-209.2` severity/role data · `US-209.3` generate documents · `US-209.4` arithmetic checks · `US-209.5` scoring scenario

---

### US-210 — Typology 037: MNO employees/agents transferring customer funds to personal accounts

| | |
|---|---|
| **Members** | 11 rules |
| **Full-chain max / alert** | 680 / 340 *(reference only — do not load)* |
| **Composition** | 018 primary · 030 primary · 010 supporting · 011 supporting · 016 supporting · 020 supporting · 024 supporting · 026 supporting · 048 supporting · 004 contextual · 044 contextual |

**Description**

Configure typology 037 (MNO employees/agents transferring customer funds to personal accounts) for COMESA. Would ordinarily draw on rules 074 and 075. It now carries 11 rules instead of 13, and its threshold is computed against that reduced membership, so detection sensitivity is preserved. A fixed absolute threshold would have silently made it harder to trigger.

*Operative per-message configuration — these are the values to load:*

| Message type | Rules evaluable | Max | `alertThreshold` |
|---|---|---|---|
| `pacs.008` | 11 | 680 | **340** (50% of max) |
| `pacs.009` | 8 | 460 | **230** (50% of max) |

> ⚠️ **Outcome inventory.** 7 of this typology's 11 member rules emit outcomes the COMESA policy does not cover: **004** → `.x01`; **010** → `.x01` `.x03` `.x04`; **011** → `.x01` `.x03` `.x04`; **020** → `.x01` `.x03` `.x04`; **024** → `.x01` `.x03`; **026** → `.x01` `.x03`; **048** → `.x01` `.x03` `.x04`. Each must be weighted here or the typology stalls when that rule returns one. Resolve via `US-801`.

**Acceptance Criteria**

1. Membership and roles match the register exactly: 018 as primary, 030 as primary, 010 as supporting, 011 as supporting, 016 as supporting, 020 as supporting, 024 as supporting, 026 as supporting, 048 as supporting, 004 as contextual, 044 as contextual.
2. Every weight equals `tier cap × band severity`, generated from the `US-033` dataset rather than typed.
3. **Every outcome every member rule can emit is weighted** — every band or case, every exit condition, and `.err`. Verified against the outcome inventories published by the EP-4 stories, by the automated check in `US-702`.
4. One configuration document exists per routed message type, keyed per `US-006`, each carrying the `alertThreshold` from the table above.
5. The `expression` sums the `termId` of every deterministic member rule; a member absent from the expression contributes nothing regardless of its weights.
6. `interdictionThreshold` is **omitted** and `flowProcessor` is **omitted** (GA-6).
7. The §11.2 arithmetic checks pass: top-severity weights sum to the max, the loaded threshold matches the table above, and `alertThreshold` is the stated percentage of that row's max rounded half-to-even.
8. Every member rule's `.err` is weighted **0**. There is exactly one non-zero `.err` in the whole configuration and it is not in this typology.
9. At least one scoring scenario is run end to end and the resulting typology score and `review` flag match a hand-calculated expectation.

**Assumptions**

- All weights and thresholds are provisional (GA-7). They are loaded as specified so they are consistent and reviewable, then tuned against FUT data before CUG. An alert rate observed in FUT is not a defect until tuning has run.
- Blocked by the EP-4 stories for its member rules — a typology cannot be completed before the outcome inventory of every member is known.
- Routed on `pacs.008`, `pacs.009`. **`pacs.009` cannot be end-to-end tested under GA-3** — those message types are not ingestible by stock Tazama 4.0.0.

**Sub-tasks:** `US-210.1` confirm membership and outcomes · `US-210.2` severity/role data · `US-210.3` generate documents · `US-210.4` arithmetic checks · `US-210.5` scoring scenario

---

### US-211 — Typology 044: Account takeover

| | |
|---|---|
| **Members** | 12 rules |
| **Full-chain max / alert** | 750 / 375 *(reference only — do not load)* |
| **Composition** | 004 primary · 018 primary · 030 primary · 010 supporting · 017 supporting · 024 supporting · 026 supporting · 028 supporting · 048 supporting · 001 contextual · 044 contextual · 083 contextual |

**Description**

Configure typology 044 (Account takeover) for COMESA. No special handling.

*Operative per-message configuration — these are the values to load:*

| Message type | Rules evaluable | Max | `alertThreshold` |
|---|---|---|---|
| `pacs.008` | 12 | 750 | **375** (50% of max) |
| `pacs.009` | 9 | 530 | **265** (50% of max) |

> ⚠️ **Outcome inventory.** 6 of this typology's 12 member rules emit outcomes the COMESA policy does not cover: **001** → `.x01`; **004** → `.x01`; **010** → `.x01` `.x03` `.x04`; **024** → `.x01` `.x03`; **026** → `.x01` `.x03`; **048** → `.x01` `.x03` `.x04`. Each must be weighted here or the typology stalls when that rule returns one. Resolve via `US-801`.

**Acceptance Criteria**

1. Membership and roles match the register exactly: 004 as primary, 018 as primary, 030 as primary, 010 as supporting, 017 as supporting, 024 as supporting, 026 as supporting, 028 as supporting, 048 as supporting, 001 as contextual, 044 as contextual, 083 as contextual.
2. Every weight equals `tier cap × band severity`, generated from the `US-033` dataset rather than typed.
3. **Every outcome every member rule can emit is weighted** — every band or case, every exit condition, and `.err`. Verified against the outcome inventories published by the EP-4 stories, by the automated check in `US-702`.
4. One configuration document exists per routed message type, keyed per `US-006`, each carrying the `alertThreshold` from the table above.
5. The `expression` sums the `termId` of every deterministic member rule; a member absent from the expression contributes nothing regardless of its weights.
6. `interdictionThreshold` is **omitted** and `flowProcessor` is **omitted** (GA-6).
7. The §11.2 arithmetic checks pass: top-severity weights sum to the max, the loaded threshold matches the table above, and `alertThreshold` is the stated percentage of that row's max rounded half-to-even.
8. Every member rule's `.err` is weighted **0**. There is exactly one non-zero `.err` in the whole configuration and it is not in this typology.
9. At least one scoring scenario is run end to end and the resulting typology score and `review` flag match a hand-calculated expectation.

**Assumptions**

- All weights and thresholds are provisional (GA-7). They are loaded as specified so they are consistent and reviewable, then tuned against FUT data before CUG. An alert rate observed in FUT is not a defect until tuning has run.
- Blocked by the EP-4 stories for its member rules — a typology cannot be completed before the outcome inventory of every member is known.
- Routed on `pacs.008`, `pacs.009`. **`pacs.009` cannot be end-to-end tested under GA-3** — those message types are not ingestible by stock Tazama 4.0.0.

**Sub-tasks:** `US-211.1` confirm membership and outcomes · `US-211.2` severity/role data · `US-211.3` generate documents · `US-211.4` arithmetic checks · `US-211.5` scoring scenario

---

### US-212 — Typology 045: Synthetic identity / application fraud

| | |
|---|---|
| **Members** | 12 rules |
| **Full-chain max / alert** | 770 / 385 *(reference only — do not load)* |
| **Composition** | 001 primary · 044 primary · 004 supporting · 010 supporting · 017 supporting · 018 supporting · 024 supporting · 026 supporting · 030 supporting · 048 supporting · 083 supporting · 078 contextual |

**Description**

Configure typology 045 (Synthetic identity / application fraud) for COMESA. No special handling.

*Operative per-message configuration — these are the values to load:*

| Message type | Rules evaluable | Max | `alertThreshold` |
|---|---|---|---|
| `pacs.008` | 12 | 770 | **385** (50% of max) |
| `pacs.009` | 8 | 560 | **280** (50% of max) |

> ⚠️ **Outcome inventory.** 7 of this typology's 12 member rules emit outcomes the COMESA policy does not cover: **001** → `.x01`; **004** → `.x01`; **010** → `.x01` `.x03` `.x04`; **024** → `.x01` `.x03`; **026** → `.x01` `.x03`; **048** → `.x01` `.x03` `.x04`; **078** → `.00`. Each must be weighted here or the typology stalls when that rule returns one. Resolve via `US-801`.

**Acceptance Criteria**

1. Membership and roles match the register exactly: 001 as primary, 044 as primary, 004 as supporting, 010 as supporting, 017 as supporting, 018 as supporting, 024 as supporting, 026 as supporting, 030 as supporting, 048 as supporting, 083 as supporting, 078 as contextual.
2. Every weight equals `tier cap × band severity`, generated from the `US-033` dataset rather than typed.
3. **Every outcome every member rule can emit is weighted** — every band or case, every exit condition, and `.err`. Verified against the outcome inventories published by the EP-4 stories, by the automated check in `US-702`.
4. One configuration document exists per routed message type, keyed per `US-006`, each carrying the `alertThreshold` from the table above.
5. The `expression` sums the `termId` of every deterministic member rule; a member absent from the expression contributes nothing regardless of its weights.
6. `interdictionThreshold` is **omitted** and `flowProcessor` is **omitted** (GA-6).
7. The §11.2 arithmetic checks pass: top-severity weights sum to the max, the loaded threshold matches the table above, and `alertThreshold` is the stated percentage of that row's max rounded half-to-even.
8. Every member rule's `.err` is weighted **0**. There is exactly one non-zero `.err` in the whole configuration and it is not in this typology.
9. At least one scoring scenario is run end to end and the resulting typology score and `review` flag match a hand-calculated expectation.

**Assumptions**

- All weights and thresholds are provisional (GA-7). They are loaded as specified so they are consistent and reviewable, then tuned against FUT data before CUG. An alert rate observed in FUT is not a defect until tuning has run.
- Blocked by the EP-4 stories for its member rules — a typology cannot be completed before the outcome inventory of every member is known.
- Routed on `pacs.008`, `pacs.009`. **`pacs.009` cannot be end-to-end tested under GA-3** — those message types are not ingestible by stock Tazama 4.0.0.

**Sub-tasks:** `US-212.1` confirm membership and outcomes · `US-212.2` severity/role data · `US-212.3` generate documents · `US-212.4` arithmetic checks · `US-212.5` scoring scenario

---

### US-213 — Typology 047: User-not-present wallet fraud

| | |
|---|---|
| **Members** | 13 rules |
| **Full-chain max / alert** | 870 / 435 *(reference only — do not load)* |
| **Composition** | 018 primary · 030 primary · 076 primary · 017 supporting · 024 supporting · 025 supporting · 026 supporting · 027 supporting · 028 supporting · 045 supporting · 048 supporting · 084 supporting · 078 contextual |

**Description**

Configure typology 047 (User-not-present wallet fraud) for COMESA. Would ordinarily draw on 074/075; now 13 rules instead of 15, threshold recomputed. Rule 076 is the strongest remaining proxy for the behavioural-anomaly signal those rules provided. **`pacs.002` route needs a decision (`US-601`):** 076 is *primary* there, so a single-rule alert is defensible by the model — but it means user-not-present fraud alerts on a sub-60-second gap alone.

*Operative per-message configuration — these are the values to load:*

| Message type | Rules evaluable | Max | `alertThreshold` |
|---|---|---|---|
| `pacs.002` | 1 | 100 | **50** (50% of max) |
| `pacs.008` | 12 | 770 | **385** (50% of max) |
| `pacs.009` | 6 | 400 | **200** (50% of max) |

> ⚠️ **Outcome inventory.** 7 of this typology's 13 member rules emit outcomes the COMESA policy does not cover: **024** → `.x01` `.x03`; **025** → `.x01` `.x03`; **026** → `.x01` `.x03`; **027** → `.x01` `.x03`; **048** → `.x01` `.x03` `.x04`; **076** → `.x01`; **078** → `.00`. Each must be weighted here or the typology stalls when that rule returns one. Resolve via `US-801`.

**Acceptance Criteria**

1. Membership and roles match the register exactly: 018 as primary, 030 as primary, 076 as primary, 017 as supporting, 024 as supporting, 025 as supporting, 026 as supporting, 027 as supporting, 028 as supporting, 045 as supporting, 048 as supporting, 084 as supporting, 078 as contextual.
2. Every weight equals `tier cap × band severity`, generated from the `US-033` dataset rather than typed.
3. **Every outcome every member rule can emit is weighted** — every band or case, every exit condition, and `.err`. Verified against the outcome inventories published by the EP-4 stories, by the automated check in `US-702`.
4. One configuration document exists per routed message type, keyed per `US-006`, each carrying the `alertThreshold` from the table above.
5. The `expression` sums the `termId` of every deterministic member rule; a member absent from the expression contributes nothing regardless of its weights.
6. `interdictionThreshold` is **omitted** and `flowProcessor` is **omitted** (GA-6).
7. The §11.2 arithmetic checks pass: top-severity weights sum to the max, the loaded threshold matches the table above, and `alertThreshold` is the stated percentage of that row's max rounded half-to-even.
8. Every member rule's `.err` is weighted **0**. There is exactly one non-zero `.err` in the whole configuration and it is not in this typology.
9. At least one scoring scenario is run end to end and the resulting typology score and `review` flag match a hand-calculated expectation.

**Assumptions**

- All weights and thresholds are provisional (GA-7). They are loaded as specified so they are consistent and reviewable, then tuned against FUT data before CUG. An alert rate observed in FUT is not a defect until tuning has run.
- Blocked by the EP-4 stories for its member rules — a typology cannot be completed before the outcome inventory of every member is known.
- Routed on `pacs.002`, `pacs.008`, `pacs.009`. **`pacs.002` and `pacs.009` cannot be end-to-end tested under GA-3** — those message types are not ingestible by stock Tazama 4.0.0.

**Sub-tasks:** `US-213.1` confirm membership and outcomes · `US-213.2` severity/role data · `US-213.3` generate documents · `US-213.4` arithmetic checks · `US-213.5` scoring scenario

---

### US-214 — Typology 051: Similar transactions at multiple branches of one institution

| | |
|---|---|
| **Members** | 4 rules |
| **Full-chain max / alert** | 290 / 145 *(reference only — do not load)* |
| **Composition** | 016 primary · 021 primary · 011 supporting · 063 contextual |

**Description**

Configure typology 051 (Similar transactions at multiple branches of one institution) for COMESA. **`pacs.009` route recommended for exclusion — see `US-601`.** On the FX leg it loses co-primary rule 021 (`pacs.008`-only), leaving rule 016 alone able to breach the scaled threshold (100 against 95). "Similar transactions at multiple branches" collapses to bare convergence.

*Operative per-message configuration — these are the values to load:*

| Message type | Rules evaluable | Max | `alertThreshold` |
|---|---|---|---|
| `pacs.008` | 4 | 290 | **145** (50% of max) |
| `pacs.009` | 3 | 190 | **95** (50% of max) |

> ⚠️ **Outcome inventory.** 3 of this typology's 4 member rules emit outcomes the COMESA policy does not cover: **011** → `.x01` `.x03` `.x04`; **021** → `.x01`; **063** → `.x01`. Each must be weighted here or the typology stalls when that rule returns one. Resolve via `US-801`.

**Acceptance Criteria**

1. Membership and roles match the register exactly: 016 as primary, 021 as primary, 011 as supporting, 063 as contextual.
2. Every weight equals `tier cap × band severity`, generated from the `US-033` dataset rather than typed.
3. **Every outcome every member rule can emit is weighted** — every band or case, every exit condition, and `.err`. Verified against the outcome inventories published by the EP-4 stories, by the automated check in `US-702`.
4. One configuration document exists per routed message type, keyed per `US-006`, each carrying the `alertThreshold` from the table above.
5. The `expression` sums the `termId` of every deterministic member rule; a member absent from the expression contributes nothing regardless of its weights.
6. `interdictionThreshold` is **omitted** and `flowProcessor` is **omitted** (GA-6).
7. The §11.2 arithmetic checks pass: top-severity weights sum to the max, the loaded threshold matches the table above, and `alertThreshold` is the stated percentage of that row's max rounded half-to-even.
8. Every member rule's `.err` is weighted **0**. There is exactly one non-zero `.err` in the whole configuration and it is not in this typology.
9. At least one scoring scenario is run end to end and the resulting typology score and `review` flag match a hand-calculated expectation.

**Assumptions**

- All weights and thresholds are provisional (GA-7). They are loaded as specified so they are consistent and reviewable, then tuned against FUT data before CUG. An alert rate observed in FUT is not a defect until tuning has run.
- Blocked by the EP-4 stories for its member rules — a typology cannot be completed before the outcome inventory of every member is known.
- Routed on `pacs.008`, `pacs.009`. **`pacs.009` cannot be end-to-end tested under GA-3** — those message types are not ingestible by stock Tazama 4.0.0.

**Sub-tasks:** `US-214.1` confirm membership and outcomes · `US-214.2` severity/role data · `US-214.3` generate documents · `US-214.4` arithmetic checks · `US-214.5` scoring scenario

---

### US-215 — Typology 052: Salary accounts credited outside normal salary scope

| | |
|---|---|
| **Members** | 2 rules |
| **Full-chain max / alert** | 160 / 80 *(reference only — do not load)* |
| **Composition** | 011 primary · 016 supporting |

**Description**

Configure typology 052 (Salary accounts credited outside normal salary scope) for COMESA. **Both routes need review — see `US-601`.** Both source documents describe 052 as "low-recall by construction, both rules must fire near their top band". That is not correct: primary rule 011 at cap 100 alone exceeds the alert threshold of 80. The characterisation is wrong either way and the typology should be re-reviewed with COMESA. Worksheet Open Item 11 suggests adding rule 020.

*Operative per-message configuration — these are the values to load:*

| Message type | Rules evaluable | Max | `alertThreshold` |
|---|---|---|---|
| `pacs.008` | 2 | 160 | **80** (50% of max) |
| `pacs.009` | 2 | 160 | **80** (50% of max) |

> ⚠️ **Outcome inventory.** 1 of this typology's 2 member rules emit outcomes the COMESA policy does not cover: **011** → `.x01` `.x03` `.x04`. Each must be weighted here or the typology stalls when that rule returns one. Resolve via `US-801`.

**Acceptance Criteria**

1. Membership and roles match the register exactly: 011 as primary, 016 as supporting.
2. Every weight equals `tier cap × band severity`, generated from the `US-033` dataset rather than typed.
3. **Every outcome every member rule can emit is weighted** — every band or case, every exit condition, and `.err`. Verified against the outcome inventories published by the EP-4 stories, by the automated check in `US-702`.
4. One configuration document exists per routed message type, keyed per `US-006`, each carrying the `alertThreshold` from the table above.
5. The `expression` sums the `termId` of every deterministic member rule; a member absent from the expression contributes nothing regardless of its weights.
6. `interdictionThreshold` is **omitted** and `flowProcessor` is **omitted** (GA-6).
7. The §11.2 arithmetic checks pass: top-severity weights sum to the max, the loaded threshold matches the table above, and `alertThreshold` is the stated percentage of that row's max rounded half-to-even.
8. Every member rule's `.err` is weighted **0**. There is exactly one non-zero `.err` in the whole configuration and it is not in this typology.
9. At least one scoring scenario is run end to end and the resulting typology score and `review` flag match a hand-calculated expectation.

**Assumptions**

- All weights and thresholds are provisional (GA-7). They are loaded as specified so they are consistent and reviewable, then tuned against FUT data before CUG. An alert rate observed in FUT is not a defect until tuning has run.
- Blocked by the EP-4 stories for its member rules — a typology cannot be completed before the outcome inventory of every member is known.
- Routed on `pacs.008`, `pacs.009`. **`pacs.009` cannot be end-to-end tested under GA-3** — those message types are not ingestible by stock Tazama 4.0.0.

**Sub-tasks:** `US-215.1` confirm membership and outcomes · `US-215.2` severity/role data · `US-215.3` generate documents · `US-215.4` arithmetic checks · `US-215.5` scoring scenario

---

### US-216 — Typology 092: Unexpectedly large cash deposits and immediate withdrawals

| | |
|---|---|
| **Members** | 15 rules |
| **Full-chain max / alert** | 1000 / 500 *(reference only — do not load)* |
| **Composition** | 018 primary · 020 primary · 024 primary · 025 primary · 002 supporting · 010 supporting · 011 supporting · 016 supporting · 021 supporting · 026 supporting · 027 supporting · 048 supporting · 078 supporting · 054 contextual · 063 contextual |

**Description**

Configure typology 092 (Unexpectedly large cash deposits and immediate withdrawals) for COMESA. The highest-maximum typology on `pacs.008` at 1000. Loses 7 rules on `pacs.009`, falling to 460.

*Operative per-message configuration — these are the values to load:*

| Message type | Rules evaluable | Max | `alertThreshold` |
|---|---|---|---|
| `pacs.008` | 15 | 1000 | **500** (50% of max) |
| `pacs.009` | 8 | 460 | **230** (50% of max) |

> ⚠️ **Outcome inventory.** 12 of this typology's 15 member rules emit outcomes the COMESA policy does not cover: **010** → `.x01` `.x03` `.x04`; **011** → `.x01` `.x03` `.x04`; **020** → `.x01` `.x03` `.x04`; **021** → `.x01`; **024** → `.x01` `.x03`; **025** → `.x01` `.x03`; **026** → `.x01` `.x03`; **027** → `.x01` `.x03`; **048** → `.x01` `.x03` `.x04`; **054** → `.x01`; **063** → `.x01`; **078** → `.00`. Each must be weighted here or the typology stalls when that rule returns one. Resolve via `US-801`.

**Acceptance Criteria**

1. Membership and roles match the register exactly: 018 as primary, 020 as primary, 024 as primary, 025 as primary, 002 as supporting, 010 as supporting, 011 as supporting, 016 as supporting, 021 as supporting, 026 as supporting, 027 as supporting, 048 as supporting, 078 as supporting, 054 as contextual, 063 as contextual.
2. Every weight equals `tier cap × band severity`, generated from the `US-033` dataset rather than typed.
3. **Every outcome every member rule can emit is weighted** — every band or case, every exit condition, and `.err`. Verified against the outcome inventories published by the EP-4 stories, by the automated check in `US-702`.
4. One configuration document exists per routed message type, keyed per `US-006`, each carrying the `alertThreshold` from the table above.
5. The `expression` sums the `termId` of every deterministic member rule; a member absent from the expression contributes nothing regardless of its weights.
6. `interdictionThreshold` is **omitted** and `flowProcessor` is **omitted** (GA-6).
7. The §11.2 arithmetic checks pass: top-severity weights sum to the max, the loaded threshold matches the table above, and `alertThreshold` is the stated percentage of that row's max rounded half-to-even.
8. Every member rule's `.err` is weighted **0**. There is exactly one non-zero `.err` in the whole configuration and it is not in this typology.
9. At least one scoring scenario is run end to end and the resulting typology score and `review` flag match a hand-calculated expectation.

**Assumptions**

- All weights and thresholds are provisional (GA-7). They are loaded as specified so they are consistent and reviewable, then tuned against FUT data before CUG. An alert rate observed in FUT is not a defect until tuning has run.
- Blocked by the EP-4 stories for its member rules — a typology cannot be completed before the outcome inventory of every member is known.
- Routed on `pacs.008`, `pacs.009`. **`pacs.009` cannot be end-to-end tested under GA-3** — those message types are not ingestible by stock Tazama 4.0.0.

**Sub-tasks:** `US-216.1` confirm membership and outcomes · `US-216.2` severity/role data · `US-216.3` generate documents · `US-216.4` arithmetic checks · `US-216.5` scoring scenario

---

### US-217 — Typology 095: Duplication of payments from a single account

| | |
|---|---|
| **Members** | 6 rules |
| **Full-chain max / alert** | 420 / 210 *(reference only — do not load)* |
| **Composition** | 006 primary · 007 primary · 008 primary · 076 supporting · 024 contextual · 026 contextual |

**Description**

Configure typology 095 (Duplication of payments from a single account) for COMESA. **`pacs.002` route recommended for exclusion — see `US-601`.** On that message only rule 076 evaluates, as a *supporting* member — corroborating a narrative with nothing to corroborate. Also note rule 007 now resolves to two outcomes only, identical or different purpose code, with `.01` carrying full weight: a true duplicate scores at full strength but there is no partial-credit outcome for a near match. No `pacs.009` route exists — none of its members evaluate on the FX leg.

*Operative per-message configuration — these are the values to load:*

| Message type | Rules evaluable | Max | `alertThreshold` |
|---|---|---|---|
| `pacs.002` | 1 | 60 | **30** (50% of max) |
| `pacs.008` | 5 | 360 | **180** (50% of max) |

> ⚠️ **Outcome inventory.** 6 of this typology's 6 member rules emit outcomes the COMESA policy does not cover: **006** → `.x01`; **007** → `.x01`; **008** → `.x01`; **024** → `.x01` `.x03`; **026** → `.x01` `.x03`; **076** → `.x01`. Each must be weighted here or the typology stalls when that rule returns one. Resolve via `US-801`.

**Acceptance Criteria**

1. Membership and roles match the register exactly: 006 as primary, 007 as primary, 008 as primary, 076 as supporting, 024 as contextual, 026 as contextual.
2. Every weight equals `tier cap × band severity`, generated from the `US-033` dataset rather than typed.
3. **Every outcome every member rule can emit is weighted** — every band or case, every exit condition, and `.err`. Verified against the outcome inventories published by the EP-4 stories, by the automated check in `US-702`.
4. One configuration document exists per routed message type, keyed per `US-006`, each carrying the `alertThreshold` from the table above.
5. The `expression` sums the `termId` of every deterministic member rule; a member absent from the expression contributes nothing regardless of its weights.
6. `interdictionThreshold` is **omitted** and `flowProcessor` is **omitted** (GA-6).
7. The §11.2 arithmetic checks pass: top-severity weights sum to the max, the loaded threshold matches the table above, and `alertThreshold` is the stated percentage of that row's max rounded half-to-even.
8. Every member rule's `.err` is weighted **0**. There is exactly one non-zero `.err` in the whole configuration and it is not in this typology.
9. At least one scoring scenario is run end to end and the resulting typology score and `review` flag match a hand-calculated expectation.

**Assumptions**

- All weights and thresholds are provisional (GA-7). They are loaded as specified so they are consistent and reviewable, then tuned against FUT data before CUG. An alert rate observed in FUT is not a defect until tuning has run.
- Blocked by the EP-4 stories for its member rules — a typology cannot be completed before the outcome inventory of every member is known.
- Routed on `pacs.002`, `pacs.008`. **`pacs.002` cannot be end-to-end tested under GA-3** — those message types are not ingestible by stock Tazama 4.0.0.

**Sub-tasks:** `US-217.1` confirm membership and outcomes · `US-217.2` severity/role data · `US-217.3` generate documents · `US-217.4` arithmetic checks · `US-217.5` scoring scenario

---

### US-218 — Typology 098: Many small incoming transfers then one large outgoing transfer

| | |
|---|---|
| **Members** | 12 rules |
| **Full-chain max / alert** | 750 / 375 *(reference only — do not load)* |
| **Composition** | 016 primary · 024 primary · 025 primary · 002 supporting · 011 supporting · 021 supporting · 026 supporting · 027 supporting · 090 supporting · 044 contextual · 054 contextual · 063 contextual |

**Description**

Configure typology 098 (Many small incoming transfers then one large outgoing transfer) for COMESA. Loses 5 of 12 rules on `pacs.009`. Under full-chain thresholds it could not alert from the FX leg (370 against 375); per-message scaling fixes it.

*Operative per-message configuration — these are the values to load:*

| Message type | Rules evaluable | Max | `alertThreshold` |
|---|---|---|---|
| `pacs.008` | 12 | 750 | **375** (50% of max) |
| `pacs.009` | 7 | 370 | **185** (50% of max) |

> ⚠️ **Outcome inventory.** 8 of this typology's 12 member rules emit outcomes the COMESA policy does not cover: **011** → `.x01` `.x03` `.x04`; **021** → `.x01`; **024** → `.x01` `.x03`; **025** → `.x01` `.x03`; **026** → `.x01` `.x03`; **027** → `.x01` `.x03`; **054** → `.x01`; **063** → `.x01`. Each must be weighted here or the typology stalls when that rule returns one. Resolve via `US-801`.

**Acceptance Criteria**

1. Membership and roles match the register exactly: 016 as primary, 024 as primary, 025 as primary, 002 as supporting, 011 as supporting, 021 as supporting, 026 as supporting, 027 as supporting, 090 as supporting, 044 as contextual, 054 as contextual, 063 as contextual.
2. Every weight equals `tier cap × band severity`, generated from the `US-033` dataset rather than typed.
3. **Every outcome every member rule can emit is weighted** — every band or case, every exit condition, and `.err`. Verified against the outcome inventories published by the EP-4 stories, by the automated check in `US-702`.
4. One configuration document exists per routed message type, keyed per `US-006`, each carrying the `alertThreshold` from the table above.
5. The `expression` sums the `termId` of every deterministic member rule; a member absent from the expression contributes nothing regardless of its weights.
6. `interdictionThreshold` is **omitted** and `flowProcessor` is **omitted** (GA-6).
7. The §11.2 arithmetic checks pass: top-severity weights sum to the max, the loaded threshold matches the table above, and `alertThreshold` is the stated percentage of that row's max rounded half-to-even.
8. Every member rule's `.err` is weighted **0**. There is exactly one non-zero `.err` in the whole configuration and it is not in this typology.
9. At least one scoring scenario is run end to end and the resulting typology score and `review` flag match a hand-calculated expectation.

**Assumptions**

- All weights and thresholds are provisional (GA-7). They are loaded as specified so they are consistent and reviewable, then tuned against FUT data before CUG. An alert rate observed in FUT is not a defect until tuning has run.
- Blocked by the EP-4 stories for its member rules — a typology cannot be completed before the outcome inventory of every member is known.
- Routed on `pacs.008`, `pacs.009`. **`pacs.009` cannot be end-to-end tested under GA-3** — those message types are not ingestible by stock Tazama 4.0.0.

**Sub-tasks:** `US-218.1` confirm membership and outcomes · `US-218.2` severity/role data · `US-218.3` generate documents · `US-218.4` arithmetic checks · `US-218.5` scoring scenario

---

### US-219 — Typology 105: Multiple accounts under multiple names; use of aliases

| | |
|---|---|
| **Members** | 8 rules |
| **Full-chain max / alert** | 440 / 220 *(reference only — do not load)* |
| **Composition** | 083 primary · 084 primary · 001 supporting · 030 supporting · 003 contextual · 004 contextual · 044 contextual · 045 contextual |

**Description**

Configure typology 105 (Multiple accounts under multiple names; use of aliases) for COMESA. **Built entirely on alias de-duplication. Do not promote past FUT** until `identityResolutionRule` is defined. This is the typology most sensitive to `US-802`.

*Operative per-message configuration — these are the values to load:*

| Message type | Rules evaluable | Max | `alertThreshold` |
|---|---|---|---|
| `pacs.008` | 8 | 440 | **220** (50% of max) |
| `pacs.009` | 8 | 440 | **220** (50% of max) |

> ⚠️ **Outcome inventory.** 3 of this typology's 8 member rules emit outcomes the COMESA policy does not cover: **001** → `.x01`; **003** → `.x01`; **004** → `.x01`. Each must be weighted here or the typology stalls when that rule returns one. Resolve via `US-801`.

**Acceptance Criteria**

1. Membership and roles match the register exactly: 083 as primary, 084 as primary, 001 as supporting, 030 as supporting, 003 as contextual, 004 as contextual, 044 as contextual, 045 as contextual.
2. Every weight equals `tier cap × band severity`, generated from the `US-033` dataset rather than typed.
3. **Every outcome every member rule can emit is weighted** — every band or case, every exit condition, and `.err`. Verified against the outcome inventories published by the EP-4 stories, by the automated check in `US-702`.
4. One configuration document exists per routed message type, keyed per `US-006`, each carrying the `alertThreshold` from the table above.
5. The `expression` sums the `termId` of every deterministic member rule; a member absent from the expression contributes nothing regardless of its weights.
6. `interdictionThreshold` is **omitted** and `flowProcessor` is **omitted** (GA-6).
7. The §11.2 arithmetic checks pass: top-severity weights sum to the max, the loaded threshold matches the table above, and `alertThreshold` is the stated percentage of that row's max rounded half-to-even.
8. Every member rule's `.err` is weighted **0**. There is exactly one non-zero `.err` in the whole configuration and it is not in this typology.
9. At least one scoring scenario is run end to end and the resulting typology score and `review` flag match a hand-calculated expectation.

**Assumptions**

- All weights and thresholds are provisional (GA-7). They are loaded as specified so they are consistent and reviewable, then tuned against FUT data before CUG. An alert rate observed in FUT is not a defect until tuning has run.
- Blocked by the EP-4 stories for its member rules — a typology cannot be completed before the outcome inventory of every member is known.
- Routed on `pacs.008`, `pacs.009`. **`pacs.009` cannot be end-to-end tested under GA-3** — those message types are not ingestible by stock Tazama 4.0.0.
- **Does not promote past FUT** until `identityResolutionRule` is defined (`US-802`).

**Sub-tasks:** `US-219.1` confirm membership and outcomes · `US-219.2` severity/role data · `US-219.3` generate documents · `US-219.4` arithmetic checks · `US-219.5` scoring scenario

---

### US-220 — Typology 107: Elaborate movement of funds through different accounts

| | |
|---|---|
| **Members** | 9 rules |
| **Full-chain max / alert** | 570 / 285 *(reference only — do not load)* |
| **Composition** | 083 primary · 084 primary · 090 primary · 002 supporting · 016 supporting · 017 supporting · 021 contextual · 054 contextual · 063 contextual |

**Description**

Configure typology 107 (Elaborate movement of funds through different accounts) for COMESA. No special handling.

*Operative per-message configuration — these are the values to load:*

| Message type | Rules evaluable | Max | `alertThreshold` |
|---|---|---|---|
| `pacs.008` | 9 | 570 | **285** (50% of max) |
| `pacs.009` | 8 | 540 | **270** (50% of max) |

> ⚠️ **Outcome inventory.** 3 of this typology's 9 member rules emit outcomes the COMESA policy does not cover: **021** → `.x01`; **054** → `.x01`; **063** → `.x01`. Each must be weighted here or the typology stalls when that rule returns one. Resolve via `US-801`.

**Acceptance Criteria**

1. Membership and roles match the register exactly: 083 as primary, 084 as primary, 090 as primary, 002 as supporting, 016 as supporting, 017 as supporting, 021 as contextual, 054 as contextual, 063 as contextual.
2. Every weight equals `tier cap × band severity`, generated from the `US-033` dataset rather than typed.
3. **Every outcome every member rule can emit is weighted** — every band or case, every exit condition, and `.err`. Verified against the outcome inventories published by the EP-4 stories, by the automated check in `US-702`.
4. One configuration document exists per routed message type, keyed per `US-006`, each carrying the `alertThreshold` from the table above.
5. The `expression` sums the `termId` of every deterministic member rule; a member absent from the expression contributes nothing regardless of its weights.
6. `interdictionThreshold` is **omitted** and `flowProcessor` is **omitted** (GA-6).
7. The §11.2 arithmetic checks pass: top-severity weights sum to the max, the loaded threshold matches the table above, and `alertThreshold` is the stated percentage of that row's max rounded half-to-even.
8. Every member rule's `.err` is weighted **0**. There is exactly one non-zero `.err` in the whole configuration and it is not in this typology.
9. At least one scoring scenario is run end to end and the resulting typology score and `review` flag match a hand-calculated expectation.

**Assumptions**

- All weights and thresholds are provisional (GA-7). They are loaded as specified so they are consistent and reviewable, then tuned against FUT data before CUG. An alert rate observed in FUT is not a defect until tuning has run.
- Blocked by the EP-4 stories for its member rules — a typology cannot be completed before the outcome inventory of every member is known.
- Routed on `pacs.008`, `pacs.009`. **`pacs.009` cannot be end-to-end tested under GA-3** — those message types are not ingestible by stock Tazama 4.0.0.

**Sub-tasks:** `US-220.1` confirm membership and outcomes · `US-220.2` severity/role data · `US-220.3` generate documents · `US-220.4` arithmetic checks · `US-220.5` scoring scenario

---

### US-221 — Typology 121: Unexplained deposits into the account of an unemployed spouse or minor

| | |
|---|---|
| **Members** | 7 rules |
| **Full-chain max / alert** | 410 / 205 *(reference only — do not load)* |
| **Composition** | 020 primary · 028 primary · 011 supporting · 016 supporting · 021 contextual · 063 contextual · 090 contextual |

**Description**

Configure typology 121 (Unexplained deposits into the account of an unemployed spouse or minor) for COMESA. **Known functional gap.** The typology is about deposits into a **creditor** who is a minor, but rule 028 evaluates the **debtor**'s age. On a `pacs.008` where the minor is receiving, 028 reads the sender's date of birth and will not fire. There is no creditor-side age rule in this ruleset. Configure as specified and record that 028 contributes only when the minor is the payer. See `US-805`.

*Operative per-message configuration — these are the values to load:*

| Message type | Rules evaluable | Max | `alertThreshold` |
|---|---|---|---|
| `pacs.008` | 7 | 410 | **205** (50% of max) |
| `pacs.009` | 6 | 380 | **190** (50% of max) |

> ⚠️ **Outcome inventory.** 4 of this typology's 7 member rules emit outcomes the COMESA policy does not cover: **011** → `.x01` `.x03` `.x04`; **020** → `.x01` `.x03` `.x04`; **021** → `.x01`; **063** → `.x01`. Each must be weighted here or the typology stalls when that rule returns one. Resolve via `US-801`.

**Acceptance Criteria**

1. Membership and roles match the register exactly: 020 as primary, 028 as primary, 011 as supporting, 016 as supporting, 021 as contextual, 063 as contextual, 090 as contextual.
2. Every weight equals `tier cap × band severity`, generated from the `US-033` dataset rather than typed.
3. **Every outcome every member rule can emit is weighted** — every band or case, every exit condition, and `.err`. Verified against the outcome inventories published by the EP-4 stories, by the automated check in `US-702`.
4. One configuration document exists per routed message type, keyed per `US-006`, each carrying the `alertThreshold` from the table above.
5. The `expression` sums the `termId` of every deterministic member rule; a member absent from the expression contributes nothing regardless of its weights.
6. `interdictionThreshold` is **omitted** and `flowProcessor` is **omitted** (GA-6).
7. The §11.2 arithmetic checks pass: top-severity weights sum to the max, the loaded threshold matches the table above, and `alertThreshold` is the stated percentage of that row's max rounded half-to-even.
8. Every member rule's `.err` is weighted **0**. There is exactly one non-zero `.err` in the whole configuration and it is not in this typology.
9. At least one scoring scenario is run end to end and the resulting typology score and `review` flag match a hand-calculated expectation.

**Assumptions**

- All weights and thresholds are provisional (GA-7). They are loaded as specified so they are consistent and reviewable, then tuned against FUT data before CUG. An alert rate observed in FUT is not a defect until tuning has run.
- Blocked by the EP-4 stories for its member rules — a typology cannot be completed before the outcome inventory of every member is known.
- Routed on `pacs.008`, `pacs.009`. **`pacs.009` cannot be end-to-end tested under GA-3** — those message types are not ingestible by stock Tazama 4.0.0.

**Sub-tasks:** `US-221.1` confirm membership and outcomes · `US-221.2` severity/role data · `US-221.3` generate documents · `US-221.4` arithmetic checks · `US-221.5` scoring scenario

---

### US-222 — Typology 124: Large or frequent cash deposits, including rapid deposits of the same amount

| | |
|---|---|
| **Members** | 11 rules |
| **Full-chain max / alert** | 720 / 360 *(reference only — do not load)* |
| **Composition** | 011 primary · 020 primary · 021 primary · 006 supporting · 016 supporting · 024 supporting · 025 supporting · 026 supporting · 027 supporting · 007 contextual · 078 contextual |

**Description**

Configure typology 124 (Large or frequent cash deposits, including rapid deposits of the same amount) for COMESA. Loses 8 of 11 rules on `pacs.009` — max falls from 720 to 260, the steepest drop of any typology. Severely degraded on the FX leg but still needs two rules, so the route stands. Membership note: rule 090 is **not** a member of 124, despite the graph-traversal character of the typology.

*Operative per-message configuration — these are the values to load:*

| Message type | Rules evaluable | Max | `alertThreshold` |
|---|---|---|---|
| `pacs.008` | 11 | 720 | **360** (50% of max) |
| `pacs.009` | 3 | 260 | **130** (50% of max) |

> ⚠️ **Outcome inventory.** 10 of this typology's 11 member rules emit outcomes the COMESA policy does not cover: **006** → `.x01`; **007** → `.x01`; **011** → `.x01` `.x03` `.x04`; **020** → `.x01` `.x03` `.x04`; **021** → `.x01`; **024** → `.x01` `.x03`; **025** → `.x01` `.x03`; **026** → `.x01` `.x03`; **027** → `.x01` `.x03`; **078** → `.00`. Each must be weighted here or the typology stalls when that rule returns one. Resolve via `US-801`.

**Acceptance Criteria**

1. Membership and roles match the register exactly: 011 as primary, 020 as primary, 021 as primary, 006 as supporting, 016 as supporting, 024 as supporting, 025 as supporting, 026 as supporting, 027 as supporting, 007 as contextual, 078 as contextual.
2. Every weight equals `tier cap × band severity`, generated from the `US-033` dataset rather than typed.
3. **Every outcome every member rule can emit is weighted** — every band or case, every exit condition, and `.err`. Verified against the outcome inventories published by the EP-4 stories, by the automated check in `US-702`.
4. One configuration document exists per routed message type, keyed per `US-006`, each carrying the `alertThreshold` from the table above.
5. The `expression` sums the `termId` of every deterministic member rule; a member absent from the expression contributes nothing regardless of its weights.
6. `interdictionThreshold` is **omitted** and `flowProcessor` is **omitted** (GA-6).
7. The §11.2 arithmetic checks pass: top-severity weights sum to the max, the loaded threshold matches the table above, and `alertThreshold` is the stated percentage of that row's max rounded half-to-even.
8. Every member rule's `.err` is weighted **0**. There is exactly one non-zero `.err` in the whole configuration and it is not in this typology.
9. At least one scoring scenario is run end to end and the resulting typology score and `review` flag match a hand-calculated expectation.

**Assumptions**

- All weights and thresholds are provisional (GA-7). They are loaded as specified so they are consistent and reviewable, then tuned against FUT data before CUG. An alert rate observed in FUT is not a defect until tuning has run.
- Blocked by the EP-4 stories for its member rules — a typology cannot be completed before the outcome inventory of every member is known.
- Routed on `pacs.008`, `pacs.009`. **`pacs.009` cannot be end-to-end tested under GA-3** — those message types are not ingestible by stock Tazama 4.0.0.

**Sub-tasks:** `US-222.1` confirm membership and outcomes · `US-222.2` severity/role data · `US-222.3` generate documents · `US-222.4` arithmetic checks · `US-222.5` scoring scenario

---

### US-223 — Typology 129: Smurfing / scattering illicit funds

| | |
|---|---|
| **Members** | 13 rules |
| **Full-chain max / alert** | 810 / 405 *(reference only — do not load)* |
| **Composition** | 002 primary · 016 primary · 090 primary · 010 supporting · 011 supporting · 018 supporting · 024 supporting · 025 supporting · 026 supporting · 027 supporting · 054 contextual · 063 contextual · 078 contextual |

**Description**

Configure typology 129 (Smurfing / scattering illicit funds) for COMESA. The second large graph typology carrying rule 090.

*Operative per-message configuration — these are the values to load:*

| Message type | Rules evaluable | Max | `alertThreshold` |
|---|---|---|---|
| `pacs.008` | 13 | 810 | **405** (50% of max) |
| `pacs.009` | 7 | 480 | **240** (50% of max) |

> ⚠️ **Outcome inventory.** 9 of this typology's 13 member rules emit outcomes the COMESA policy does not cover: **010** → `.x01` `.x03` `.x04`; **011** → `.x01` `.x03` `.x04`; **024** → `.x01` `.x03`; **025** → `.x01` `.x03`; **026** → `.x01` `.x03`; **027** → `.x01` `.x03`; **054** → `.x01`; **063** → `.x01`; **078** → `.00`. Each must be weighted here or the typology stalls when that rule returns one. Resolve via `US-801`.

**Acceptance Criteria**

1. Membership and roles match the register exactly: 002 as primary, 016 as primary, 090 as primary, 010 as supporting, 011 as supporting, 018 as supporting, 024 as supporting, 025 as supporting, 026 as supporting, 027 as supporting, 054 as contextual, 063 as contextual, 078 as contextual.
2. Every weight equals `tier cap × band severity`, generated from the `US-033` dataset rather than typed.
3. **Every outcome every member rule can emit is weighted** — every band or case, every exit condition, and `.err`. Verified against the outcome inventories published by the EP-4 stories, by the automated check in `US-702`.
4. One configuration document exists per routed message type, keyed per `US-006`, each carrying the `alertThreshold` from the table above.
5. The `expression` sums the `termId` of every deterministic member rule; a member absent from the expression contributes nothing regardless of its weights.
6. `interdictionThreshold` is **omitted** and `flowProcessor` is **omitted** (GA-6).
7. The §11.2 arithmetic checks pass: top-severity weights sum to the max, the loaded threshold matches the table above, and `alertThreshold` is the stated percentage of that row's max rounded half-to-even.
8. Every member rule's `.err` is weighted **0**. There is exactly one non-zero `.err` in the whole configuration and it is not in this typology.
9. At least one scoring scenario is run end to end and the resulting typology score and `review` flag match a hand-calculated expectation.

**Assumptions**

- All weights and thresholds are provisional (GA-7). They are loaded as specified so they are consistent and reviewable, then tuned against FUT data before CUG. An alert rate observed in FUT is not a defect until tuning has run.
- Blocked by the EP-4 stories for its member rules — a typology cannot be completed before the outcome inventory of every member is known.
- Routed on `pacs.008`, `pacs.009`. **`pacs.009` cannot be end-to-end tested under GA-3** — those message types are not ingestible by stock Tazama 4.0.0.

**Sub-tasks:** `US-223.1` confirm membership and outcomes · `US-223.2` severity/role data · `US-223.3` generate documents · `US-223.4` arithmetic checks · `US-223.5` scoring scenario

---

### US-224 — Typology 137: Transaction in excess of the country reporting threshold

| | |
|---|---|
| **Members** | 1 rule |
| **Full-chain max / alert** | 100 / 100 *(reference only — do not load)* |
| **Composition** | 091 primary |

**Description**

Configure typology 137 (Transaction in excess of the country reporting threshold) for COMESA. **Build this typology first, immediately after rule 091.** It is the regulatory-reporting typology and the highest priority in the register. Two deliberate departures from the standard scheme: (1) rule 091's `.err` carries **full weight 100**, so a transaction on a corridor with no configured `corridorThreshold` raises an alert instead of passing silently — the fail-loud control for the compliance gap in FSD §8; (2) the alert threshold is 100% of maximum, not 50%. It is also the **only typology unaffected by the outcome-inventory gap**, because rule 091 deploys with no exit conditions at all — which is part of why it is the right first build.

*Operative per-message configuration — these are the values to load:*

| Message type | Rules evaluable | Max | `alertThreshold` |
|---|---|---|---|
| `pacs.008` | 1 | 100 | **100** (100% of max) |
| `pacs.009` | 1 | 100 | **100** (100% of max) |

> ✅ **Outcome inventory clean.** No member rule emits an outcome outside the COMESA policy. This is the only typology in the set for which that is true.

**Acceptance Criteria**

1. Membership and roles match the register exactly: 091 as primary.
2. Every weight equals `tier cap × band severity`, generated from the `US-033` dataset rather than typed.
3. **Every outcome every member rule can emit is weighted** — every band or case, every exit condition, and `.err`. Verified against the outcome inventories published by the EP-4 stories, by the automated check in `US-702`.
4. One configuration document exists per routed message type, keyed per `US-006`, each carrying the `alertThreshold` from the table above.
5. The `expression` sums the `termId` of every deterministic member rule; a member absent from the expression contributes nothing regardless of its weights.
6. `interdictionThreshold` is **omitted** and `flowProcessor` is **omitted** (GA-6).
7. The §11.2 arithmetic checks pass: top-severity weights sum to the max, the loaded threshold matches the table above, and `alertThreshold` is the stated percentage of that row's max rounded half-to-even.
8. Rule 091's `.err` is weighted **100** — the single non-zero `.err` in the entire configuration. A scenario test proves an unconfigured corridor raises an alert.
9. A scenario test proves a below-threshold transaction scores 0 and does not alert, and an at-or-above-threshold transaction scores 100 and alerts.
10. At least one scoring scenario is run end to end and the resulting typology score and `review` flag match a hand-calculated expectation.

**Assumptions**

- All weights and thresholds are provisional (GA-7). They are loaded as specified so they are consistent and reviewable, then tuned against FUT data before CUG. An alert rate observed in FUT is not a defect until tuning has run.
- Blocked by the EP-4 stories for its member rules — a typology cannot be completed before the outcome inventory of every member is known.
- Routed on `pacs.008`, `pacs.009`. **`pacs.009` cannot be end-to-end tested under GA-3** — those message types are not ingestible by stock Tazama 4.0.0.

**Sub-tasks:** `US-224.1` confirm membership and outcomes · `US-224.2` severity/role data · `US-224.3` generate documents · `US-224.4` arithmetic checks · `US-224.5` scoring scenario

---

### US-225 — Typology 169: Suspicious transaction amount patterns

| | |
|---|---|
| **Members** | 7 rules |
| **Full-chain max / alert** | 540 / 270 *(reference only — do not load)* |
| **Composition** | 054 primary · 063 primary · 091 primary · 024 supporting · 025 supporting · 026 supporting · 027 supporting |

**Description**

Configure typology 169 (Suspicious transaction amount patterns) for COMESA. Rule 091's `.err` weight is **0** here, unlike typology 137. This asymmetry is deliberate: one configuration defect should raise one alert, not four. Do not "correct" it.

*Operative per-message configuration — these are the values to load:*

| Message type | Rules evaluable | Max | `alertThreshold` |
|---|---|---|---|
| `pacs.008` | 7 | 540 | **270** (50% of max) |
| `pacs.009` | 3 | 300 | **150** (50% of max) |

> ⚠️ **Outcome inventory.** 6 of this typology's 7 member rules emit outcomes the COMESA policy does not cover: **024** → `.x01` `.x03`; **025** → `.x01` `.x03`; **026** → `.x01` `.x03`; **027** → `.x01` `.x03`; **054** → `.x01`; **063** → `.x01`. Each must be weighted here or the typology stalls when that rule returns one. Resolve via `US-801`.

**Acceptance Criteria**

1. Membership and roles match the register exactly: 054 as primary, 063 as primary, 091 as primary, 024 as supporting, 025 as supporting, 026 as supporting, 027 as supporting.
2. Every weight equals `tier cap × band severity`, generated from the `US-033` dataset rather than typed.
3. **Every outcome every member rule can emit is weighted** — every band or case, every exit condition, and `.err`. Verified against the outcome inventories published by the EP-4 stories, by the automated check in `US-702`.
4. One configuration document exists per routed message type, keyed per `US-006`, each carrying the `alertThreshold` from the table above.
5. The `expression` sums the `termId` of every deterministic member rule; a member absent from the expression contributes nothing regardless of its weights.
6. `interdictionThreshold` is **omitted** and `flowProcessor` is **omitted** (GA-6).
7. The §11.2 arithmetic checks pass: top-severity weights sum to the max, the loaded threshold matches the table above, and `alertThreshold` is the stated percentage of that row's max rounded half-to-even.
8. Every member rule's `.err` is weighted **0**. There is exactly one non-zero `.err` in the whole configuration and it is not in this typology.
9. At least one scoring scenario is run end to end and the resulting typology score and `review` flag match a hand-calculated expectation.

**Assumptions**

- All weights and thresholds are provisional (GA-7). They are loaded as specified so they are consistent and reviewable, then tuned against FUT data before CUG. An alert rate observed in FUT is not a defect until tuning has run.
- Blocked by the EP-4 stories for its member rules — a typology cannot be completed before the outcome inventory of every member is known.
- Routed on `pacs.008`, `pacs.009`. **`pacs.009` cannot be end-to-end tested under GA-3** — those message types are not ingestible by stock Tazama 4.0.0.

**Sub-tasks:** `US-225.1` confirm membership and outcomes · `US-225.2` severity/role data · `US-225.3` generate documents · `US-225.4` arithmetic checks · `US-225.5` scoring scenario

---

### US-226 — Typology 179: Improbable transaction location  ⛔ DEACTIVATED

| | |
|---|---|
| **Status** | Defined but **not deployed active** |
| **Members** | None — rules 074 and 075 only, both excluded |
| **Max / Alert** | n/a |

**Description**

**DEACTIVATED — do not deploy active.** Its only members were rules 074 and 075, both dropped for want of a geolocation field. A typology with zero rules cannot score, and an active zero-rule entry in the network map reads as a permanently silent typology, masking the fact that location-based detection is absent from this phase entirely.

**Acceptance Criteria**

1. Typology 179 is documented as defined-but-deactivated, with the reason and the reinstatement condition recorded.
2. It does **not** appear as an active entry in any network map for any message type — verified against the deployed map, not just the source file.
3. No typology configuration document for 179 is loaded in an active state.
4. A reinstatement note records what must be true to activate it: geolocation onboarded into the Mojaloop message set and mapped to Tazama's existing ISO 20022 geolocation fields, then rules 074 and 075 configured.
5. Project documentation states plainly that **location-based detection is absent from this phase**, so the gap is visible rather than hidden behind a silent typology.

**Assumptions**

- Tazama's own ISO 20022 definitions already support geolocation; the gap is on the Mojaloop/COMESA message side.
- Some early-adopter DFSPs (TNM Malawi, ZAMTEL Zambia) can supply geolocation via base-station triangulation, which is what makes reinstatement realistic rather than theoretical.
- This story is documentation and a negative assertion. It still needs a ticket, because "we forgot to not deploy it" is the failure mode.

**Sub-tasks:** `US-226.1` document decision · `US-226.2` assert absence from network map

---

### US-227 — Typology 185: Transaction pattern not in line with past patterns

| | |
|---|---|
| **Members** | 5 rules |
| **Full-chain max / alert** | 460 / 230 *(reference only — do not load)* |
| **Composition** | 010 primary · 011 primary · 020 primary · 048 primary · 018 supporting |

**Description**

Configure typology 185 (Transaction pattern not in line with past patterns) for COMESA. Every member rule depends on the party having prior history in the same currency context — 010, 011, 020 and 048 are baselined per corridor, 018 compares against a same-currency 90-day maximum. A party's first transaction on a newly activated corridor satisfies none of them: all five return an exit condition and the typology scores zero. That is correct behaviour, not a defect, but it means 185 is blind to first transactions on each new corridor as COMESA onboards them. Do not tune against it.

*Operative per-message configuration — these are the values to load:*

| Message type | Rules evaluable | Max | `alertThreshold` |
|---|---|---|---|
| `pacs.008` | 5 | 460 | **230** (50% of max) |
| `pacs.009` | 4 | 400 | **200** (50% of max) |

> ⚠️ **Outcome inventory.** 4 of this typology's 5 member rules emit outcomes the COMESA policy does not cover: **010** → `.x01` `.x03` `.x04`; **011** → `.x01` `.x03` `.x04`; **020** → `.x01` `.x03` `.x04`; **048** → `.x01` `.x03` `.x04`. Each must be weighted here or the typology stalls when that rule returns one. Resolve via `US-801`.

**Acceptance Criteria**

1. Membership and roles match the register exactly: 010 as primary, 011 as primary, 020 as primary, 048 as primary, 018 as supporting.
2. Every weight equals `tier cap × band severity`, generated from the `US-033` dataset rather than typed.
3. **Every outcome every member rule can emit is weighted** — every band or case, every exit condition, and `.err`. Verified against the outcome inventories published by the EP-4 stories, by the automated check in `US-702`.
4. One configuration document exists per routed message type, keyed per `US-006`, each carrying the `alertThreshold` from the table above.
5. The `expression` sums the `termId` of every deterministic member rule; a member absent from the expression contributes nothing regardless of its weights.
6. `interdictionThreshold` is **omitted** and `flowProcessor` is **omitted** (GA-6).
7. The §11.2 arithmetic checks pass: top-severity weights sum to the max, the loaded threshold matches the table above, and `alertThreshold` is the stated percentage of that row's max rounded half-to-even.
8. Every member rule's `.err` is weighted **0**. There is exactly one non-zero `.err` in the whole configuration and it is not in this typology.
9. At least one scoring scenario is run end to end and the resulting typology score and `review` flag match a hand-calculated expectation.

**Assumptions**

- All weights and thresholds are provisional (GA-7). They are loaded as specified so they are consistent and reviewable, then tuned against FUT data before CUG. An alert rate observed in FUT is not a defect until tuning has run.
- Blocked by the EP-4 stories for its member rules — a typology cannot be completed before the outcome inventory of every member is known.
- Routed on `pacs.008`, `pacs.009`. **`pacs.009` cannot be end-to-end tested under GA-3** — those message types are not ingestible by stock Tazama 4.0.0.

**Sub-tasks:** `US-227.1` confirm membership and outcomes · `US-227.2` severity/role data · `US-227.3` generate documents · `US-227.4` arithmetic checks · `US-227.5` scoring scenario

---

### US-228 — Typology 191: Cash withdrawal

| | |
|---|---|
| **Members** | 1 rule |
| **Full-chain max / alert** | 100 / 100 *(reference only — do not load)* |
| **Composition** | 078 primary |

**Description**

Configure typology 191 (Cash withdrawal) for COMESA. A **classification** typology, not a detection one — it tags cash withdrawals for the CMS. Because it holds one rule and alerts at 100% of maximum, **every cash withdrawal alerts** (rule 078 `.01`, severity 1.0, cap 100). Nothing else in the case set reaches 100. Confirm with COMESA whether this is intended or whether it should be demoted to tagging-only; if tagging-only, raise the alert threshold above the maximum achievable score. See `US-808`.

*Operative per-message configuration — these are the values to load:*

| Message type | Rules evaluable | Max | `alertThreshold` |
|---|---|---|---|
| `pacs.008` | 1 | 100 | **100** (100% of max) |

> ⚠️ **Outcome inventory.** 1 of this typology's 1 member rules emit outcomes the COMESA policy does not cover: **078** → `.00`. Each must be weighted here or the typology stalls when that rule returns one. Resolve via `US-801`.

**Acceptance Criteria**

1. Membership and roles match the register exactly: 078 as primary.
2. Every weight equals `tier cap × band severity`, generated from the `US-033` dataset rather than typed.
3. **Every outcome every member rule can emit is weighted** — every band or case, every exit condition, and `.err`. Verified against the outcome inventories published by the EP-4 stories, by the automated check in `US-702`.
4. One configuration document exists per routed message type, keyed per `US-006`, each carrying the `alertThreshold` from the table above.
5. The `expression` sums the `termId` of every deterministic member rule; a member absent from the expression contributes nothing regardless of its weights.
6. `interdictionThreshold` is **omitted** and `flowProcessor` is **omitted** (GA-6).
7. The §11.2 arithmetic checks pass: top-severity weights sum to the max, the loaded threshold matches the table above, and `alertThreshold` is the stated percentage of that row's max rounded half-to-even.
8. Every member rule's `.err` is weighted **0**. There is exactly one non-zero `.err` in the whole configuration and it is not in this typology.
9. A scenario test proves every cash withdrawal alerts, and that no other transaction type reaches the threshold — pending the `US-808` decision.
10. At least one scoring scenario is run end to end and the resulting typology score and `review` flag match a hand-calculated expectation.

**Assumptions**

- All weights and thresholds are provisional (GA-7). They are loaded as specified so they are consistent and reviewable, then tuned against FUT data before CUG. An alert rate observed in FUT is not a defect until tuning has run.
- Blocked by the EP-4 stories for its member rules — a typology cannot be completed before the outcome inventory of every member is known.
- Routed on `pacs.008` only, which stock Tazama 4.0.0 ingests — this typology is fully testable today.

**Sub-tasks:** `US-228.1` confirm membership and outcomes · `US-228.2` severity/role data · `US-228.3` generate documents · `US-228.4` arithmetic checks · `US-228.5` scoring scenario

---

### US-229 — Typology 195: Payments to newly registered accounts

| | |
|---|---|
| **Members** | 4 rules |
| **Full-chain max / alert** | 320 / 160 *(reference only — do not load)* |
| **Composition** | 003 primary · 045 primary · 011 supporting · 016 supporting |

**Description**

Configure typology 195 (Payments to newly registered accounts) for COMESA. **Contains no account-age rule.** Rule 001 (derived account age, creditor) is the natural primary for "newly registered accounts" but is not in the register's membership. Rule 003 returns its exit condition for an account with no history, so a genuinely brand-new account contributes nothing from it — the typology leans almost entirely on rule 045. See `US-806`.

*Operative per-message configuration — these are the values to load:*

| Message type | Rules evaluable | Max | `alertThreshold` |
|---|---|---|---|
| `pacs.008` | 4 | 320 | **160** (50% of max) |
| `pacs.009` | 4 | 320 | **160** (50% of max) |

> ⚠️ **Outcome inventory.** 2 of this typology's 4 member rules emit outcomes the COMESA policy does not cover: **003** → `.x01`; **011** → `.x01` `.x03` `.x04`. Each must be weighted here or the typology stalls when that rule returns one. Resolve via `US-801`.

**Acceptance Criteria**

1. Membership and roles match the register exactly: 003 as primary, 045 as primary, 011 as supporting, 016 as supporting.
2. Every weight equals `tier cap × band severity`, generated from the `US-033` dataset rather than typed.
3. **Every outcome every member rule can emit is weighted** — every band or case, every exit condition, and `.err`. Verified against the outcome inventories published by the EP-4 stories, by the automated check in `US-702`.
4. One configuration document exists per routed message type, keyed per `US-006`, each carrying the `alertThreshold` from the table above.
5. The `expression` sums the `termId` of every deterministic member rule; a member absent from the expression contributes nothing regardless of its weights.
6. `interdictionThreshold` is **omitted** and `flowProcessor` is **omitted** (GA-6).
7. The §11.2 arithmetic checks pass: top-severity weights sum to the max, the loaded threshold matches the table above, and `alertThreshold` is the stated percentage of that row's max rounded half-to-even.
8. Every member rule's `.err` is weighted **0**. There is exactly one non-zero `.err` in the whole configuration and it is not in this typology.
9. At least one scoring scenario is run end to end and the resulting typology score and `review` flag match a hand-calculated expectation.

**Assumptions**

- All weights and thresholds are provisional (GA-7). They are loaded as specified so they are consistent and reviewable, then tuned against FUT data before CUG. An alert rate observed in FUT is not a defect until tuning has run.
- Blocked by the EP-4 stories for its member rules — a typology cannot be completed before the outcome inventory of every member is known.
- Routed on `pacs.008`, `pacs.009`. **`pacs.009` cannot be end-to-end tested under GA-3** — those message types are not ingestible by stock Tazama 4.0.0.

**Sub-tasks:** `US-229.1` confirm membership and outcomes · `US-229.2` severity/role data · `US-229.3` generate documents · `US-229.4` arithmetic checks · `US-229.5` scoring scenario

---

### US-230 — Typology 214: Mule accounts

| | |
|---|---|
| **Members** | 22 rules |
| **Full-chain max / alert** | 1370 / 685 *(reference only — do not load)* |
| **Composition** | 001 primary · 016 primary · 017 primary · 024 primary · 025 primary · 002 supporting · 003 supporting · 004 supporting · 010 supporting · 011 supporting · 018 supporting · 020 supporting · 026 supporting · 027 supporting · 030 supporting · 048 supporting · 090 supporting · 044 contextual · 045 contextual · 054 contextual · 063 contextual · 091 contextual |

**Description**

Configure typology 214 (Mule accounts) for COMESA. **The largest typology at 22 rules and the most sensitive to weight tuning.** Because the alert threshold is a fixed fraction of the maximum, a broad typology needs proportionally more corroboration to fire. That is intended, but it makes 214 the priority for the FUT tuning cycle. Build it last — leave it until the pattern is established on smaller typologies.

*Operative per-message configuration — these are the values to load:*

| Message type | Rules evaluable | Max | `alertThreshold` |
|---|---|---|---|
| `pacs.008` | 22 | 1370 | **685** (50% of max) |
| `pacs.009` | 17 | 990 | **495** (50% of max) |

> ⚠️ **Outcome inventory.** 13 of this typology's 22 member rules emit outcomes the COMESA policy does not cover: **001** → `.x01`; **003** → `.x01`; **004** → `.x01`; **010** → `.x01` `.x03` `.x04`; **011** → `.x01` `.x03` `.x04`; **020** → `.x01` `.x03` `.x04`; **024** → `.x01` `.x03`; **025** → `.x01` `.x03`; **026** → `.x01` `.x03`; **027** → `.x01` `.x03`; **048** → `.x01` `.x03` `.x04`; **054** → `.x01`; **063** → `.x01`. Each must be weighted here or the typology stalls when that rule returns one. Resolve via `US-801`.

**Acceptance Criteria**

1. Membership and roles match the register exactly: 001 as primary, 016 as primary, 017 as primary, 024 as primary, 025 as primary, 002 as supporting, 003 as supporting, 004 as supporting, 010 as supporting, 011 as supporting, 018 as supporting, 020 as supporting, 026 as supporting, 027 as supporting, 030 as supporting, 048 as supporting, 090 as supporting, 044 as contextual, 045 as contextual, 054 as contextual, 063 as contextual, 091 as contextual.
2. Every weight equals `tier cap × band severity`, generated from the `US-033` dataset rather than typed.
3. **Every outcome every member rule can emit is weighted** — every band or case, every exit condition, and `.err`. Verified against the outcome inventories published by the EP-4 stories, by the automated check in `US-702`.
4. One configuration document exists per routed message type, keyed per `US-006`, each carrying the `alertThreshold` from the table above.
5. The `expression` sums the `termId` of every deterministic member rule; a member absent from the expression contributes nothing regardless of its weights.
6. `interdictionThreshold` is **omitted** and `flowProcessor` is **omitted** (GA-6).
7. The §11.2 arithmetic checks pass: top-severity weights sum to the max, the loaded threshold matches the table above, and `alertThreshold` is the stated percentage of that row's max rounded half-to-even.
8. Every member rule's `.err` is weighted **0**. There is exactly one non-zero `.err` in the whole configuration and it is not in this typology.
9. At least one scoring scenario is run end to end and the resulting typology score and `review` flag match a hand-calculated expectation.

**Assumptions**

- All weights and thresholds are provisional (GA-7). They are loaded as specified so they are consistent and reviewable, then tuned against FUT data before CUG. An alert rate observed in FUT is not a defect until tuning has run.
- Blocked by the EP-4 stories for its member rules — a typology cannot be completed before the outcome inventory of every member is known.
- Routed on `pacs.008`, `pacs.009`. **`pacs.009` cannot be end-to-end tested under GA-3** — those message types are not ingestible by stock Tazama 4.0.0.

**Sub-tasks:** `US-230.1` confirm membership and outcomes · `US-230.2` severity/role data · `US-230.3` generate documents · `US-230.4` arithmetic checks · `US-230.5` scoring scenario

---

### US-231 — Typology 216: Structuring using the same beneficiaries over a short period

| | |
|---|---|
| **Members** | 8 rules |
| **Full-chain max / alert** | 540 / 270 *(reference only — do not load)* |
| **Composition** | 002 primary · 016 primary · 017 primary · 010 supporting · 011 supporting · 090 supporting · 054 contextual · 063 contextual |

**Description**

Configure typology 216 (Structuring using the same beneficiaries over a short period) for COMESA. Names "the same beneficiaries" but does not include rule 008, which measures exactly that. See `US-809`.

*Operative per-message configuration — these are the values to load:*

| Message type | Rules evaluable | Max | `alertThreshold` |
|---|---|---|---|
| `pacs.008` | 8 | 540 | **270** (50% of max) |
| `pacs.009` | 8 | 540 | **270** (50% of max) |

> ⚠️ **Outcome inventory.** 4 of this typology's 8 member rules emit outcomes the COMESA policy does not cover: **010** → `.x01` `.x03` `.x04`; **011** → `.x01` `.x03` `.x04`; **054** → `.x01`; **063** → `.x01`. Each must be weighted here or the typology stalls when that rule returns one. Resolve via `US-801`.

**Acceptance Criteria**

1. Membership and roles match the register exactly: 002 as primary, 016 as primary, 017 as primary, 010 as supporting, 011 as supporting, 090 as supporting, 054 as contextual, 063 as contextual.
2. Every weight equals `tier cap × band severity`, generated from the `US-033` dataset rather than typed.
3. **Every outcome every member rule can emit is weighted** — every band or case, every exit condition, and `.err`. Verified against the outcome inventories published by the EP-4 stories, by the automated check in `US-702`.
4. One configuration document exists per routed message type, keyed per `US-006`, each carrying the `alertThreshold` from the table above.
5. The `expression` sums the `termId` of every deterministic member rule; a member absent from the expression contributes nothing regardless of its weights.
6. `interdictionThreshold` is **omitted** and `flowProcessor` is **omitted** (GA-6).
7. The §11.2 arithmetic checks pass: top-severity weights sum to the max, the loaded threshold matches the table above, and `alertThreshold` is the stated percentage of that row's max rounded half-to-even.
8. Every member rule's `.err` is weighted **0**. There is exactly one non-zero `.err` in the whole configuration and it is not in this typology.
9. At least one scoring scenario is run end to end and the resulting typology score and `review` flag match a hand-calculated expectation.

**Assumptions**

- All weights and thresholds are provisional (GA-7). They are loaded as specified so they are consistent and reviewable, then tuned against FUT data before CUG. An alert rate observed in FUT is not a defect until tuning has run.
- Blocked by the EP-4 stories for its member rules — a typology cannot be completed before the outcome inventory of every member is known.
- Routed on `pacs.008`, `pacs.009`. **`pacs.009` cannot be end-to-end tested under GA-3** — those message types are not ingestible by stock Tazama 4.0.0.

**Sub-tasks:** `US-231.1` confirm membership and outcomes · `US-231.2` severity/role data · `US-231.3` generate documents · `US-231.4` arithmetic checks · `US-231.5` scoring scenario

---
# EP-6 — Network Map and Routing

**Goal:** one active COMESA network map that routes each message type to the right typologies and rules, with the degenerate routes removed.

---

### US-601 — Degenerate route review and exclusion decisions

**Description**
Both source documents compute per-message thresholds mechanically, as a percentage of whatever maximum a message type can reach. Neither tests whether the resulting route is *meaningful*. Six typology × message routes exist where a **single rule alone** breaches the scaled alert threshold — the typology stops being a weighted scenario and becomes a re-publication of one rule result. Review each and decide whether to route it.

Typology 179 is the only *typology-level* exclusion and is handled in `US-226`. These are *route-level* exclusions.

**Acceptance Criteria**
1. Each route below has an explicit, recorded decision — route, or exclude from the network map:

   | Route | Rules | Max | Alert | Fires alone on | Recommendation |
   |---|---|---|---|---|---|
   | **002** on `pacs.002` | 1 | 30 | 15 | 076, **contextual** | **Exclude.** A contextual rule cannot, by the tier model's own definition, carry a case. |
   | **095** on `pacs.002` | 1 | 60 | 30 | 076, **supporting** | **Exclude.** Corroborating rule with nothing to corroborate. |
   | **051** on `pacs.009` | 3 | 190 | 95 | 016, primary | **Exclude.** Loses co-primary 021; "similar transactions at multiple branches" collapses to bare convergence. |
   | **010** on `pacs.009` | 3 | 190 | 95 | 091, primary | **Exclude.** Duplicates typology 137 on the same event, and fires on amounts *above* threshold — the inverse of the typology's stated purpose. |
   | **047** on `pacs.002` | 1 | 100 | 50 | 076, primary | **Decide.** Defensible by the model, but user-not-present fraud would alert on a sub-60-second gap alone. |
   | **052** on both | 2 | 160 | 80 | 011, primary | **Re-review with COMESA.** Both documents describe 052 as low-recall requiring both rules near top band; that is incorrect — 011 alone exceeds the threshold. |

2. Reasoning is recorded for every decision, including any route deliberately kept.
3. Excluded routes do not appear in any network map branch, and no typology configuration document is generated for them.
4. The per-message threshold tables in Developer Guide §6 and the tuning worksheet are annotated with the outcome so the discrepancy is not "corrected" back in by a later reader.
5. Where a typology is excluded from every message type it was routed on, it is treated as deactivated and handled the same way as 179.
6. An automated check flags any future route where one rule's maximum weight is greater than or equal to that route's alert threshold, so this class of defect cannot silently reappear as membership changes during tuning.

**Assumptions**
- The underlying cause is structural, not arithmetic: ten rules are `pacs.008`-only, so `pacs.009` and `pacs.002` routes see a thin subset of members. The arithmetic in both documents is correct — it was independently verified — but correct arithmetic on a one-rule route still produces a meaningless typology.
- Exclusion is preferred over raising the threshold above the maximum. An unroutable typology is visible; a routed typology that can never fire is not.
- AC-6 is the durable fix. The specific six routes are today's instance of a pattern that recurs whenever membership changes.

---

### US-602 — Network map structure and naming

**Description**
Define the shape of the COMESA network map before authoring branches: how message types map to typology configuration versions, how the per-message typology documents from `US-006` are referenced, and how versions are named.

**Acceptance Criteria**
1. The map carries `tenantId: "COMESA"` and follows the GA-5 naming convention.
2. Each `messages[]` entry declares its `txTp`, the TADProc `id`/`cfg`, and its typologies.
3. Each typology entry inside a message branch references the **message-specific** typology configuration version — e.g. the `pacs.008` branch references `001-008@1.0.0` and the `pacs.009` branch references `001-009@1.0.0`.
4. Each typology entry lists exactly the member rules that evaluate on that message type — not the full chain membership.
5. Rules excluded from a message type are absent from that branch rather than present-and-erroring. **A rule that is not routed is not invoked, so its outcome never has to be weighted for that message** — this is cleaner than relying on `.err`, and it reduces the outcome-inventory surface.
6. The map is generated from the same source data as the typology documents (`US-033`), so membership cannot drift between the two.
7. A structural validator rejects: a typology referenced in a branch with no matching configuration document, a rule in a branch that is not a member of that typology, and any typology with zero rules in a branch.

**Assumptions**
- AC-5 is a material design decision. The Developer Guide models out-of-binding rules as returning `.err` scoring 0; not routing them achieves the same score with less configuration and no stall risk. Record it as a deviation from the guide.
- Exactly one network map is active per tenant, enforced by a unique index on the `network_map` table.

---

### US-603 — `pacs.008.001.10` routing branch

**Description**
Author the domestic transfer branch — the only branch fully testable under GA-3, and therefore the branch that proves the whole routing model.

**Acceptance Criteria**
1. The branch routes all typologies with a `pacs.008` row in their story's routing table, minus any excluded by `US-601`.
2. Each typology lists exactly its `pacs.008`-evaluable members. All 30 rules bound to `pacs.008` or `pacs.008`+`pacs.009` appear across the branch; rule 076 does not.
3. Typology 179 is absent.
4. A transaction is pushed and the Event Director log shows exactly the expected rule set dispatched — no more, no fewer.
5. Every routed typology completes and produces a score. **No typology hangs** — this is the acceptance test for the whole outcome-inventory effort.
6. TADProc produces an alert payload containing all typology results.

**Assumptions**
- This branch is the integration test for EP-4 and EP-5. A stall here means a member rule emitted an unweighted outcome.
- `pacs.008.001.10` matches the version stock Tazama 4.0.0 ingests, so no message onboarding dependency applies to this branch.

---

### US-604 — `pacs.009.001.07` routing branch  ⚠️ blocked by GA-3

**Description**
Author the FX-leg branch. It can be authored and structurally validated now, but not exercised until message onboarding lands.

**Acceptance Criteria**
1. The branch routes all typologies with a `pacs.009` row, minus `US-601` exclusions.
2. Each typology lists only its `pacs.009`-evaluable members — the ten `pacs.008`-only rules (006, 007, 008, 018, 021, 024, 025, 026, 027, 078) are absent throughout.
3. Each typology entry references its `-009` configuration version with the scaled threshold.
4. Structural validation passes.
5. The branch is loaded but its end-to-end test is written and marked pending on GA-3.
6. The expected coverage asymmetry is documented per typology — for example 124 reaches 260 on `pacs.009` against 720 on `pacs.008` — so that low FX alert rates are not later read as a tuning fault.

**Assumptions**
- **Blocked by GA-3.** `pacs.009.001.07` is not ingestible by stock Tazama 4.0.0: no TMS API endpoint, no `raw_history` table, no type guard.
- Cross-border is COMESA's primary use case, so systematic FX under-scoring matters more here than in a domestic deployment. Tracked in `US-810`.

---

### US-605 — `pacs.002.001.15` routing branch  ⚠️ blocked by GA-3

**Description**
Author the settlement-status branch. Rule 076 is the only rule bound to it, so this branch is small — and after `US-601` it may be very small indeed.

**Acceptance Criteria**
1. The branch routes only the typologies containing rule 076 that survive `US-601` — candidates are 002, 047 and 095, of which 002 and 095 are recommended for exclusion.
2. If no typology survives, the branch is **not created** and that outcome is recorded as the deliberate result of `US-601`.
3. Rule 076 is the only rule in any surviving typology entry.
4. The version discrepancy is resolved and recorded: the FSD specifies `pacs.002.001.15`, Tazama 4.0.0 ships `pacs.002.001.12`, and the network map matches `txTp` **exactly**. Either the PPA translates to `.12` or Tazama is extended to `.15` — there is no partial match.
5. End-to-end test written and marked pending on GA-3.

**Assumptions**
- **Blocked by GA-3**, and additionally by the version mismatch in AC-4, which is a distinct problem from the missing `pacs.009` support.
- An empty branch is an acceptable and possibly correct outcome. It should be a decision, not an oversight.

---

### US-606 — Activation, rollback and integrity checks

**Description**
Make the network map safely deployable: exactly one active map, a proven rollback, and integrity checks that run before activation rather than after.

**Acceptance Criteria**
1. Activation deactivates the current map and activates the new one, with exactly one active map per tenant guaranteed at all times.
2. Rollback is demonstrated on a running environment: reactivate the previous map and show the prior routing in force.
3. Pre-activation integrity checks all pass: every referenced typology configuration exists; every referenced rule configuration exists at the referenced version; no typology has zero rules in any branch; typology 179 is absent; no `US-601`-excluded route is present.
4. The active map version is recorded in every evaluation result, so any alert can be traced to the routing that produced it.
5. An activation runbook is committed covering pre-checks, activation, verification and rollback.

**Assumptions**
- Activation is an operational step distinct from loading configuration, per `US-005`.
- Integrity checks run in CI against the source data and again against the target environment immediately before activation.

---
# EP-7 — Verification, Test Harness and Tuning Baseline

**Goal:** the configuration is provably correct before FUT, and FUT tuning has a baseline to move from.

---

### US-701 — Rule outcome inventory harness

**Description**
Build the tool that answers, for any deployed rule, "what `subRuleRef` values can this rule actually emit?" Every completeness check in this epic depends on that list being derived from the deployed system rather than from a document.

**Acceptance Criteria**
1. For any rule, the harness enumerates every outcome the deployed processor can emit: bands, cases, exit conditions and `.err`.
2. The inventory is derived from the deployed configuration and the processor's own schema, not from the FSD or the Developer Guide.
3. Output is machine-readable and consumed directly by `US-702` and `US-033`.
4. The harness flags any rule whose deployed outcome set differs from the set recorded in its EP-4 story.
5. It runs in CI against the target environment, so drift is caught when a rule is redeployed rather than at FUT.

**Assumptions**
- Exit conditions are declared in the rule configuration, but the *trigger logic* lives in the processor. The harness reads what is declared; `US-004` AC-3 confirms by observation that nothing else can be emitted.
- The `.err` outcome is never declared in configuration — it is built into every processor — so the harness adds it unconditionally.

---

### US-702 — Typology completeness checker  ⭐ *highest-value check in the backlog*

**Description**
Automate the one check that prevents production stalls: for every typology, for every member rule, every outcome that rule can emit has a weight. Analysis of the current specification found **19 of 31 rules** emitting at least one outcome the COMESA outcome policy does not cover, affecting **29 of 30 typologies**. This check makes that class of defect impossible to ship.

**Acceptance Criteria**
1. For every typology configuration and every member rule, the checker asserts that each outcome from `US-701` has a corresponding `wghts` entry.
2. A missing weight fails the build, names the typology, the rule and the missing `subRuleRef`, and states that the typology would stall.
3. The checker also asserts the reverse: a `wghts` entry for an outcome the rule cannot emit is reported as dead configuration.
4. It asserts exactly **one** non-zero `.err` across the entire configuration set — rule 091 in typology 137 — and fails on a second.
5. It asserts every deterministic member rule appears as a term in the typology's `expression`.
6. It runs in CI on every configuration change and is a required gate on `US-606` activation.
7. A deliberately broken fixture proves the checker fails when it should.

**Assumptions**
- This check is what makes GA-10 survivable: the deployed baseline can differ from the documents, and this catches the consequences automatically rather than relying on a reviewer noticing.
- It runs against the network sub-map per message type, since `US-602` AC-5 means a rule not routed on a message never needs weighting for it.

---

### US-703 — Arithmetic verification suite

**Description**
Automate the six arithmetic checks in Developer Guide §11.2. They are cheap and catch most configuration mistakes before anything is deployed.

**Acceptance Criteria**
1. For every typology, the configured weights for each rule's top-severity band sum to that typology's max. A failure means a role or a severity is wrong.
2. For every typology and message type, the loaded `alertThreshold` matches the operative per-message value — **not** the full-chain figure. `pacs.009` rows are checked explicitly; they differ most from the chain values and are the easiest to load wrongly.
3. Within each route, `alertThreshold` is 50% of that route's max rounded half-to-even, except typologies 137 and 191 at 100%.
4. For every rule in every typology, `weight = tier cap × band severity`, with severity identical across typologies and only the cap varying.
5. Every `.x00` is 0 and every `.err` is 0, with the single documented exception.
6. Rule 018 carries `.x01` = 0 in all nine typologies containing it.
7. The suite reproduces the Developer Guide §6 and §7 tables exactly; any divergence fails and is investigated rather than accepted.

**Assumptions**
- The published tables were independently verified to reconcile — all 30 full-chain rows and all 62 per-message rows — so a divergence indicates a generator bug or an undocumented deliberate change.
- These checks run before the behavioural tests in `US-704`, being far cheaper.

---

### US-704 — Behavioural test scenarios

**Description**
Turn the scenario table in Developer Guide §11.2 into executable tests, so that behaviour is verified rather than assumed.

**Acceptance Criteria**
1. Each scenario is an automated test with an asserted outcome:

   | Scenario | Expected |
   |---|---|
   | Corridor with no `corridorThreshold` entry | 091 → `.err`; typology 137 scores 100 → **alert**; 010, 169, 214 score 0 from 091 |
   | Amount below the corridor threshold | 091 → `.01`; 137 scores 0 → no alert |
   | Amount at or above the corridor threshold | 091 → `.02`; 137 scores 100 → **alert** |
   | First ever transaction on a newly activated corridor | All per-corridor rules → exit condition; typology 185 scores 0 |
   | FX-only transaction (`pacs.009`) | The ten `pacs.008`-only rules are not routed; typologies score against their `pacs.009` thresholds |
   | `pacs.002` status message | Only rule 076 evaluates |
   | Any cash withdrawal | 078 → `.01`; typology 191 scores 100 → **alert**, pending `US-808` |

2. Each test asserts the `subRuleRef`, the typology score and the `review` flag — not merely that an alert did or did not occur.
3. Tests bound to `pacs.009` or `pacs.002.001.15` are written and marked pending on GA-3, not omitted.
4. A stall-detection test proves that an unweighted outcome causes the typology to fail to complete, and that `US-702` catches it.
5. The suite runs against a deployed environment, not against mocks.

**Assumptions**
- The reference E2E flow provides real test data for an MWK→ZMW transaction. It is Mojaloop/FSPIOP-layer data captured at the DRPP switch, one step upstream of what the rules read, so field paths still need the PPA contract — do not assume a path seen there is the path a rule reads.
- Scenario coverage is deliberately weighted toward rule 091 and typology 137, the highest regulatory-risk path.

---

### US-705 — FX coverage measurement

**Description**
Quantify how much less evidence an FX leg carries than a domestic transfer, so the position taken in `US-810` is based on measurement rather than assertion.

**Acceptance Criteria**
1. For every typology routed on both message types, the `pacs.009` maximum is reported as a percentage of the `pacs.008` maximum.
2. The typologies most affected are identified and reported — 124 at 260 against 720 and 011 at 260 against 530 are the current extremes.
3. Which of the ten `pacs.008`-only rules contribute most of the lost coverage is reported.
4. The report distinguishes *scaled and reachable* from *materially degraded*: per-message scaling makes every remaining route reachable, but it does not make an FX leg carry as much evidence as a domestic one.
5. The report feeds `US-810` and is re-run after any membership change.

**Assumptions**
- Measurement is on configuration, not on live traffic, so it can be produced before GA-3 is resolved.
- Extending `pacs.008`-only rules to `pacs.009` is a possible remedy but is a rule-scope change, out of scope here and raised in `US-810`.

---

### US-706 — Pre-tuning regression baseline

**Description**
Before tuning starts in FUT, record the alert rate per typology under the provisional configuration. Tuning changes weights; without a baseline nobody can tell whether a change improved detection or merely moved the threshold.

**Acceptance Criteria**
1. Alert rate per typology per message type is recorded over an agreed FUT observation window.
2. The distribution of typology scores is recorded, not just the count above threshold — a typology sitting just below its threshold is a different problem from one scoring near zero.
3. Outcome distribution per rule is recorded, including exit-condition and `.err` rates.
4. `.err` rates are monitored at platform level. Outside typology 137, `.err` is invisible in the alert stream by design, so a rising rate must be caught here — it indicates a configuration or ingestion problem.
5. Typologies expected to behave unusually are annotated up front so their numbers are not misread: 105 over-fires pending `US-802`; 191 alerts on every cash withdrawal; 185 is blind to first transactions on new corridors; FX legs score lower throughout.
6. The baseline is published before the first tuning change and is the comparison point for every subsequent one.

**Assumptions**
- **Every weight and threshold is provisional (GA-7).** An alert rate observed in FUT is not a defect until tuning has run against this baseline.
- Typology 214 is the priority for tuning: 22 rules, and the most sensitive to weight changes.

---
# EP-8 — Open Items, Decisions and Spec Amendments

**Goal:** every blocking decision has an owner and a ticket. Start these on day one — several have long lead times outside the development team.

---

### US-801 — Outcome policy reconciliation  🔴 *start immediately*

**Description**
The COMESA outcome policy states that every rule carries `.x00` and `.err`, and that only rule 018 carries `.x01`. The deployed Tazama 4.0.0 rules do not match that in either direction. Reconcile the policy with the deployed reality before any typology weight is authored, because the consequence of getting it wrong is a production stall, not a mis-scored alert.

**What the analysis found**

| Outcome | Rules that emit it | Covered by the policy? |
|---|---|---|
| `.x01` | 001, 003, 004, 006, 007, 008, 010, 011, 020, 021, 024, 025, 026, 027, 048, 054, 063, 076 — **18 rules** | No — policy assigns it to rule 018 only |
| `.x03` | 010, 011, 020, 024, 025, 026, 027, 048 | No |
| `.x04` | 010, 011, 020, 048 | No |
| `.00` | 078 (reserved cased-rule catch-all) | No |
| `.x00` | Only 006, 007, 008, 010, 011, 018, 020, 021, 024, 025, 026, 027, 030, 048, 054, 063 | Over-specified — 15 rules are assigned `.x00` but never emit it |

**19 of 31 rules and 29 of 30 typologies are affected.** Only typology 137 is clean, because rule 091 deploys with no exit conditions.

**Acceptance Criteria**
1. The deployed outcome set for all 31 rules is confirmed by `US-004` AC-3 and `US-701`, and this table is corrected against it.
2. A weight is decided for every uncovered outcome, per rule and per typology role.
3. **`.x03` and `.x04` are decided deliberately, not by default.** In Tazama's own reference typology `.x03` on rules 010, 011, 020 and 048 carries weight **100** — it is a deterministic signal ("no variance in transaction history and recent volume shows an increase"), not an absence of data. Weighting it 0 under the "insufficient data is not evidence" principle discards real detection. Tazama's documentation is explicit that some exit conditions carry deterministic results with a weighting.
4. The `.00` versus `.err` question for rule 078 is resolved jointly with `US-804` — they are the same decision.
5. Dead `.x00` entries on rules that cannot emit it are either removed or documented as deliberate forward-compatibility.
6. The decision is issued as an amendment to Developer Guide §4.2 and §4.3 and to the tuning worksheet's exit-and-error policy.
7. `US-702` enforces the reconciled policy from that point on.

**Assumptions**
- **This is the highest-severity item in the backlog.** It is not a tuning question; an unweighted outcome stalls a typology in production.
- The comparison baseline is the Tazama 4.0.0 open-source seed. If the COMESA environment deploys different rule builds the table changes, but the *method* and the severity do not.
- Owner: Paysys Dev, with no external dependency. Can start immediately.

---

### US-802 — Define `identityResolutionRule`  🔴 BLOCKER for promotion

**Description**
Supply the de-duplication logic for alternate `PartyIdType` values — MSISDN, ALIAS, DEVICE — that resolve to the same underlying wallet. It has no safe default, and multiple-account detection is itself an AML control, so a wrong answer weakens rules 083 and 084 directly.

**Acceptance Criteria**
1. The de-duplication logic is defined and expressible as configuration for `US-015`.
2. Coverage is stated for every `PartyIdType` in use on the DRPP.
3. The FUT interim position is agreed and recorded: accept the known over-count, measure its rate, hold typologies 003, 013 and 105 at FUT.
4. Promotion criteria for 003, 013 and 105 past FUT are written down.
5. Expected effect on rules 008, 083 and 084 is documented so the change in their outcome distribution at FUT is anticipated rather than investigated as a regression.

**Assumptions**
- Owner: COMESA / deployment team. External dependency with a potentially long lead time — raise on day one.
- Does not block *starting* configuration. It blocks promoting three typologies.

---

### US-803 — Final `corridorThreshold` values  🔴 BLOCKER for CA

**Description**
Convert the agreed STR thresholds to local-currency amounts per corridor and confirm them. Until every active corridor has a confirmed value, the compliance gap in FSD §8 stays open.

**Acceptance Criteria**
1. Final local-currency values are confirmed for both initial corridors — MWK for `ZMW-MWK`, ZMW for `MWK-ZMW`.
2. The governing regulator per corridor is confirmed as the **destination** country: Malawi 3,000 USD equivalent for `ZMW-MWK`, Zambia 2,000 USD equivalent for `MWK-ZMW`.
3. The FX reference rate used for conversion is agreed, recorded with its date, and the conversion is reproducible.
4. Values are loaded before CA and supersede the interim 2,000 USD floor.
5. A process exists for adding a corridor's threshold as new corridors onboard, sized against COMESA's long-term target of up to 420 directed pairs.
6. Until final values are loaded, the fail-loud `.err` behaviour in typology 137 is confirmed working, since it is the only control covering an unconfigured corridor.

**Assumptions**
- Owner: DRPP Commercial Working Group, with the Reserve Bank of Malawi and Bank of Zambia.
- **Blocks CA, not FUT.** The interim floor is the lower of the two figures, so it reports at least everything the final values will report and nothing reportable is missed during testing.

---

### US-804 — Supply `purposeCodeToCaseMap` and resolve the catch-all  🟠 HIGH

**Description**
`Purp.Prtry` is a free proprietary code with no controlled list. Rule 078 needs the full Mojaloop transaction-scenario to case-code mapping, and a decision on what happens to an unmapped value.

**Acceptance Criteria**
1. The complete mapping from Mojaloop transaction scenarios through `Purp.Prtry` to Tazama case codes is supplied.
2. The reassignment is confirmed and communicated: the deployed rule's `.01` is a merchant payment, the COMESA target's `.01` is a cash withdrawal. Every weight keyed to `.01` in all eight consuming typologies changes meaning.
3. Which deployed variant is the base — ISO 20022 (`MP2B`/`MP2P`/`CASH`) or Mojaloop (`PAYMENT`/`TRANSFER`/`WITHDRAWAL`) — is confirmed. COMESA runs on Mojaloop, so the Mojaloop variant is expected.
4. **The unmapped-value behaviour is decided.** The FSD says `.err`; Tazama reserves `.00` as the mandatory catch-all for cased rules and the deployed rule has it. These are not equivalent — if the rule can emit `.00` and no typology weights it, all eight typologies containing 078 stall.
5. Whichever outcome is chosen is weighted in all eight consuming typologies: 191p, 092s, 005c, 011c, 045c, 047c, 124c, 129c.
6. The precedence rule is confirmed: `InstrForCdtrAgt.Cd` is evaluated before `Purp.Prtry`, so the refund flag wins.

**Assumptions**
- Owner: COMESA / Paysys Dev. No safe default exists.
- AC-4 is a joint decision with `US-801` — it is the same class of problem.
- Typology 191 consists solely of rule 078, so an unresolved mapping makes that typology meaningless as well as stall-prone.

---

### US-805 — Typology 121: no creditor-side age rule  🟡 MEDIUM

**Description**
Typology 121 is about unexplained deposits into the account of an unemployed spouse or minor — a statement about the **creditor**. Rule 028 evaluates the **debtor**'s age. On a `pacs.008` where the minor is receiving, 028 reads the sender's date of birth and will not fire. No creditor-side age rule exists in this ruleset.

**Acceptance Criteria**
1. COMESA decides: accept that 028 contributes only when the minor is the payer, or raise a creditor-side age rule as a new requirement.
2. If accepted, typology 121's expected recall is documented so its low alert rate at FUT is not investigated as a defect.
3. If a new rule is raised, it is scoped as new rule development with its own band set and typology membership — a materially larger piece of work than configuration.
4. The decision is recorded against the typology configuration.

**Assumptions**
- Owner: COMESA. Does not block FUT.
- Rule 028's severity curve is non-monotonic by design — minors 1.0, middle-aged 0.0, seniors 0.7 — because it measures vulnerability, not propensity. Preserve that in any creditor-side equivalent.

---

### US-806 — Typology 195: no account-age rule  🟡 MEDIUM

**Description**
Typology 195 is "payments to newly registered accounts" but contains no account-age rule. Rule 001 (derived account age, creditor) is the natural primary but is not in the register's membership. Rule 003 returns its exit condition for an account with no history, so a genuinely brand-new account — precisely the target — contributes nothing from it. The typology leans almost entirely on rule 045.

**Acceptance Criteria**
1. COMESA decides whether to add rule 001 to typology 195's membership.
2. If added, its role and cap are assigned, the maximum and thresholds are recomputed for every routed message type, and `US-033` and `US-703` are updated.
3. If not added, the detection limitation is recorded against the typology.
4. The interaction is documented: rule 003 exiting on a no-history account is correct rule behaviour but works against this typology's stated purpose.

**Assumptions**
- Owner: COMESA. Does not block FUT.
- Adding a rule changes the maximum and therefore the thresholds on every route — it is not a local change.

---

### US-807 — Rule 091 has no "just below threshold" band  🟠 HIGH — FSD amendment

**Description**
Typology 010 is "transactions structured just below the reporting threshold". Rule 091 has two bands only: within limits, and at or above threshold. "Just below" has no band of its own, and `.01` matches the overwhelming majority of legitimate traffic. As configured, typology 010 detects structuring only through rules 006 and 017 — and on `pacs.009`, where 006 is unavailable, it fires on amounts *above* the threshold instead, duplicating typology 137.

**Acceptance Criteria**
1. The recommendation is raised formally: add a rule-091 band `.03` for ratio 0.90–1.00, "just below reporting threshold".
2. It is recognised as a **rule-level band change requiring an FSD amendment**, not a configuration tweak — configure as currently specified until the amendment lands, and do not improvise the band.
3. If accepted, downstream impact is assessed: a new outcome on rule 091 must be weighted in all four consuming typologies (010, 137, 169, 214) or they stall.
4. The `pacs.009` interaction is included in the assessment, as it is the sharper expression of the same defect and is also addressed by the `US-601` route exclusion.
5. Until amended, typology 010's inability to detect its named scenario is recorded as a known limitation.

**Assumptions**
- Owner: Paysys Dev / COMESA.
- The 0.90 lower bound is the Developer Guide's recommendation and is itself provisional — a genuine structuring band would be tuned against FUT data.

---

### US-808 — Typology 191: alert or tag?  🟡 MEDIUM

**Description**
Typology 191 holds one rule and alerts at 100% of maximum, so **every cash withdrawal raises an alert**. It is described as a classification typology — tagging cash withdrawals for the CMS — which is a different intent from alerting.

**Acceptance Criteria**
1. COMESA confirms whether 191 should alert on every cash withdrawal, or be demoted to tagging-only.
2. If tagging-only, the alert threshold is raised above the maximum achievable score so the typology tags without alerting, and the change is reflected in `US-228` and `US-033`.
3. Expected alert volume under the current configuration is estimated before the decision, so it is made with a number attached.
4. The decision is recorded against the typology configuration.

**Assumptions**
- Owner: COMESA. Does not block FUT, but does affect FUT alert volumes materially and could swamp the CMS.
- Only rule 078 `.01` (cash withdrawal, severity 1.0) reaches 100. Merchant payments score 20, P2P 50, refunds 70 — none alert.

---

### US-809 — Typology 216: missing rule 008  🟢 LOW

**Description**
Typology 216 is "structuring using the same beneficiaries over a short period" but does not include rule 008, which measures repeat payments to the same creditor — exactly that.

**Acceptance Criteria**
1. COMESA decides whether to add rule 008 to typology 216's membership.
2. If added, role and cap are assigned and thresholds recomputed for every routed message type.
3. Note in the assessment that rule 008 is `pacs.008`-only, so adding it widens the `pacs.008` / `pacs.009` coverage gap for this typology.
4. Decision recorded.

**Assumptions**
- Owner: COMESA. Does not block FUT.
- Batch this with `US-805`, `US-806` and `US-808` into a **single COMESA typology-membership review session**. All four are the same shape — "consider adding rule X" — and none blocks FUT.

---

### US-810 — Position on FX under-scoring  🟠 HIGH

**Description**
Ten rules are `pacs.008`-only, so a cross-border FX transaction is evaluated by fewer rules than a domestic one. Cross-border is COMESA's primary use case, so this matters more here than in a domestic deployment.

**Acceptance Criteria**
1. The measurement from `US-705` is reviewed and a position taken.
2. Options are assessed with effort and risk: extend some or all of the ten `pacs.008`-only rules to `pacs.009`; accept per-message scaled thresholds as the mitigation; or accept the gap and document it.
3. If extension is chosen, each rule is assessed individually — some are `pacs.008`-only because the data genuinely is not on the FX leg, which no amount of configuration fixes.
4. The decision is recorded and communicated so that low FX alert rates are not treated as a tuning problem.
5. Interaction with GA-3 is noted: none of this is testable until `pacs.009` ingestion exists.

**Assumptions**
- Owner: Paysys Dev. Sequence **after** `US-705` and after GA-3 is resolved — the answer changes how severe the gap actually is.
- Per-message scaled thresholds already make every remaining route reachable. This item is about evidence sufficiency, not reachability.

---

### US-811 — Performance and NFR referral  🟢 LOW

**Description**
Several characteristics of this configuration have performance consequences that belong to the NFR track rather than to rule configuration, but must be handed over explicitly rather than assumed.

**Acceptance Criteria**
1. Unbounded lifetime-history queries are listed and referred: rules 001, 003, 004, 020, 030, 044, 045, 048, 054, 063, 083, 084 query full platform history per account with no bounded window.
2. Rule 090's graph traversal is referred, with the note that no bound exists beyond the current `upstreamRange` / `downstreamRange`.
3. The corridor configuration volume is referred: `corridorThreshold` plus eight `perCorridor` rules require one entry per active corridor, scaling toward up to 420 directed pairs at COMESA's stated full extent.
4. Per-corridor cohorting's effect on query cost and index strategy is referred, with the index requirement from `US-011` AC-6.
5. Confirmation is sought that no rule-set-specific throughput or latency target exists, or the target is obtained.

**Assumptions**
- Owner: NFR / platform track. Does not block this backlog.
- No formal transaction-volume or latency target has been confirmed for this rule set; general Tazama throughput targets are assumed to apply.

---

## Appendix A — Story index

| Epic | Range | Contents |
|---|---|---|
| EP-1 | US-001 – US-006 | Foundation: environment, orientation, verification session, pipeline, typology topology decision |
| EP-2 | US-010 – US-023 | Processor enablement: schema extension and the 15 cross-cutting parameters |
| EP-3 | US-030 – US-033 | Shared lookups, corridor registry, threshold dataset, severity/role dataset |
| EP-4 | US-101 – US-131 | One story per rule, in rule order: 001, 002, 003, 004, 006, 007, 008, 010, 011, 016, 017, 018, 020, 021, 024, 025, 026, 027, 028, 030, 044, 045, 048, 054, 063, 076, 078, 083, 084, 090, 091 |
| EP-5 | US-201 – US-231 | One story per typology, in typology order: 001, 002, 003, 005, 010, 011, 013, 024, 028, 037, 044, 045, 047, 051, 052, 092, 095, 098, 105, 107, 121, 124, 129, 137, 169, 179, 185, 191, 195, 214, 216 |
| EP-6 | US-601 – US-606 | Route exclusions, network map structure, three routing branches, activation |
| EP-7 | US-701 – US-706 | Outcome harness, completeness checker, arithmetic suite, behavioural scenarios, FX measurement, tuning baseline |
| EP-8 | US-801 – US-811 | Open items, external dependencies and spec amendments |

**Totals:** 8 epics · 109 stories. EP-2, EP-4 and EP-5 alone carry roughly 375 enumerated sub-tasks.

## Appendix B — Start-here order for a new developer

1. `US-001` — get the stack running.
2. `US-002` and `US-003` — read a configuration, push a transaction, read the result.
3. `US-004` — the environment verification session. Nothing downstream is trustworthy without it.
4. `US-801` — the outcome policy reconciliation. Start it in parallel; it has no external dependency and it gates every typology.
5. `US-010` → `US-020` → `US-131` (rule 091) → `US-224` (typology 137). The narrowest possible slice that exercises the corridor lookup, the fail-loud `.err` path, a rule, a typology and the network map end to end.
6. Everything else, largest last. Leave `US-230` (typology 214, 22 rules) until the pattern is established.

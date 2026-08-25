# Executive Summary — COMESA DRPP Tazama Rule & Typology Configuration Backlog

**Source:** `COMESATazamaRuleTypologyUserStories.md` (CCH-PL-BLG-RULECFG-001 v1.0) — a 109-story development backlog for configuring Tazama 4.0.0's fraud/AML detection layer for the COMESA DRPP. Derived from the FSD (CCH-PL-FSD-RULECFG-001 v1.1), the Developer Guide (CCH-PL-DEV-RULECFG-001 v1.0), and the COMESA typology-weights tuning worksheet.

---

## 1. What this backlog actually builds

Tazama's detection layer has four moving parts, and the whole 109-story backlog is organized around them:

| Concept | What it is |
|---|---|
| **Rule** | A single-question processor (e.g. "how old is the creditor's account?"). One Node/TypeScript library per rule, one container per rule (`rule-executer`). Reads the transaction + PostgreSQL history, returns one metric, gets turned into one **outcome**. |
| **Outcome (`subRuleRef`)** | Exactly one of: a **band** (`.01`–`.03`, numeric range), a **case** (`.01`–`.04`+`.00`, discrete label), an **exit** (`.x00`/`.x01`/`.x03`/`.x04`, rule stopped early), or **`.err`** (rule couldn't run). |
| **Typology** | A JSON document — not code — that lists member rules, assigns a weight to every outcome each member can emit, sums them via an `expression`, and alerts if the total meets `alertThreshold`. |
| **Network map** | Maps message type (`txTp`) → typologies → rules. Exactly one active map per tenant. |

**The single governing rule of the entire backlog:** *if a rule returns an outcome the typology doesn't weight, that typology never completes — the evaluation hangs.* Nearly every story in EP-4 and EP-5 exists to prevent this.

Scope: **31 of Tazama's 33 rules** (074/075 excluded — no geolocation field in the Mojaloop message set yet), rolled up into **30 active typologies** (+ typology 179, defined but deliberately deactivated), routed via **one COMESA network map**. Target platform: **Tazama 4.0.0 on PostgreSQL**, tenant-isolated as `COMESA`. **Alerting only — no interdiction** in this phase.

---

## 2. The one defect class that matters most

An analysis embedded in the backlog (US-801) found that **19 of 31 rules emit at least one outcome the COMESA outcome policy doesn't cover, affecting 29 of 30 typologies.** Only typology 137 is clean. Every EP-4 rule story and EP-5 typology story carries a ⚠️ flag listing exactly which uncovered outcomes it introduces. `US-702` — described as the *highest-value check in the backlog* — automates the completeness proof so this can't ship silently. Resolving the outcome policy (`US-801`) is called out to **start immediately**, with no external dependency, because getting it wrong is a production stall, not a mis-scored alert.

A second structural finding (`US-601`): six typology×message routes are **degenerate** — a single rule alone breaches the scaled alert threshold, so the "typology" is really just that one rule republished. Most are recommended for exclusion from the network map.

---

## 3. Structure and scale

| Epic | Stories | Contents |
|---|---|---|
| EP-1 | 6 | Foundation — stand up Tazama locally, read baseline config, push a transaction end-to-end, the critical **environment verification session** (US-004), deployment pipeline, per-message typology topology decision |
| EP-2 | 14 | Processor enablement — 15 cross-cutting parameters (`currencyScope`, `accountKey`, `identityResolutionRule`, `corridorThreshold`, etc.) that must be added to the shared config schema and wired into rule code before COMESA configs mean anything |
| EP-3 | 4 | Shared lookups and the corridor model — drift prevention, corridor registry, interim FUT threshold dataset, the severity/role dataset that *generates* all ~700 typology weights |
| EP-4 | 31 | One story per rule — deployed baseline vs. target config, band/case tables, outcome-inventory gaps |
| EP-5 | 31 | One story per typology — membership, per-message weight documents, arithmetic checks |
| EP-6 | 6 | Network map — route exclusions, structure, the three message-type branches, activation/rollback |
| EP-7 | 6 | Verification harness, completeness checker, arithmetic suite, behavioural scenarios, FX coverage measurement, pre-tuning baseline |
| EP-8 | 11 | Open items and spec amendments — the external/decision blockers below |

**Totals: 8 epics, 109 stories, ~375 sub-tasks** (bulk in EP-2, EP-4, EP-5). Every rule/typology story shares the same five sub-task suffixes (`.1` verify baseline → `.2` code → `.3` config → `.4` tests → `.5` deploy/smoke), so the board is filterable by suffix.

---

## 4. Critical path

> `US-004` (environment verification) → `US-010` (schema extension) → `US-011` (corridor cohorting) → `US-131` (rule 091) → `US-224` (typology 137) → remaining rules → remaining typologies → network map.

Rule **091** (transaction amount vs. regulatory threshold) and typology **137** (transaction in excess of the reporting threshold) are the deliberate starting point: highest regulatory priority, simplest logic, and the only pair that exercises the corridor lookup and the fail-loud `.err` path end to end. Typology 137 is also the **only typology where `.err` carries non-zero weight (100)** — an unconfigured corridor raises an alert instead of failing silently, and this asymmetry (0 everywhere else, including 010/169/214) is intentional, not a bug to "fix."

Appendix B gives the same path as a new-developer onboarding sequence: `US-001` → `US-002`/`US-003` → `US-004` → `US-801` (parallel) → `US-010` → `US-020` → `US-131` → `US-224`.

---

## 5. Standing constraints (apply throughout, not repeated per story)

- **GA-3 — message onboarding gap.** Only `pacs.008.001.10` (domestic) is ingestible by stock Tazama 4.0.0 today. `pacs.009.001.07` (FX leg) and `pacs.002.001.15` (settlement status) are not — no TMS endpoint, no `raw_history` table. Every story touching those message types is written, but its end-to-end test is marked *pending*, not skipped.
- **GA-7 — everything is provisional.** No weight or threshold in this backlog was measured against real transaction data. They load as specified for consistency and reviewability, then get tuned against FUT data before CUG. An alert rate seen in FUT is not, by itself, a defect.
- **GA-9 — immutable-by-version configs.** Never overwrite a deployed `(id, cfg, tenantId)`; issue a new `cfg` and activate a new network map.
- **GA-10 — the deployed baseline is not fully known.** It differs from the published 4.0.0 seed in unknown ways, which is why every EP-4 story opens with a `.1` sub-task reading the *actual* deployed config before anything is authored.
- **Per-message typology documents (US-006).** Tazama's typology config carries one `alertThreshold`, but the FSD wants a different threshold per message type — resolved by authoring ~57 documents (one typology × one message type each), generated from a single source to prevent drift.

---

## 6. Open items and blockers (EP-8) — who's waiting on what

| ID | Item | Severity | Blocks |
|---|---|---|---|
| US-801 | Outcome policy reconciliation | 🔴 Highest in backlog | Every typology weight — start immediately, no dependency |
| US-802 | Define `identityResolutionRule` (alias de-dup for MSISDN/ALIAS/DEVICE) | 🔴 Blocker | Promotion of typologies 003, 013, 105 past FUT |
| US-803 | Final `corridorThreshold` values (from Reserve Bank of Malawi / Bank of Zambia) | 🔴 Blocker | CA only (interim 2,000 USD floor covers FUT/CUG) |
| US-804 | Supply `purposeCodeToCaseMap` + resolve rule 078's unmapped-value behaviour | 🟠 High | Typology 191 and 7 others meaningfully complete |
| US-807 | Rule 091 has no "just below threshold" band | 🟠 High — needs FSD amendment | Typology 010's stated detection purpose |
| US-810 | Position on FX under-scoring (10 rules are `pacs.008`-only) | 🟠 High | Sequenced after US-705 measurement and after GA-3 |
| US-805/806/808/809 | Typology-membership gaps (121 no creditor-age rule, 195 no account-age rule, 191 alert-vs-tag, 216 missing rule 008) | 🟡/🟢 | Batchable into one COMESA review session; none blocks FUT |
| US-811 | Performance/NFR referral (unbounded history queries, graph traversal, corridor scaling to ~420 pairs) | 🟢 Low | Handed to NFR track, not resolved here |

---

## 7. Notable one-off facts worth carrying into the details

- **Corridor model:** initial scope is the Zambia–Malawi bidirectional pair (`ZMW-MWK`, `MWK-ZMW`); COMESA's long-term 21-member-state target implies up to **420 directed corridor pairs**.
- **Typology 214 (Mule accounts)** is the largest at 22 member rules and the most sensitive to weight tuning — built last, deliberately, after the pattern is proven on smaller typologies.
- **Typology 179 (Improbable transaction location)** is fully specified but shipped deactivated — its only rules (074, 075) were dropped for lack of a geolocation field.
- **Typology 191 (Cash withdrawal)** alerts on literally every cash withdrawal as currently configured (one rule, 100% threshold) — open question (US-808) whether that's intended or should be tagging-only.
- Several rules carry known, deliberate defect corrections against the Tazama 4.0.0 seed (e.g. rule 004's mislabeled dormancy reason text) and unit conversions (ms → days) that change band counts.

---

## How to use the rest of the document

Read section **0** (`How to use this backlog`) and **Appendix B** first if you skip everything else — they set up the four concepts and the onboarding path above. Sections **1–2** (global assumptions, Definition of Ready/Done) apply to every story and aren't repeated elsewhere. EP-4 and EP-5 are long but formulaic — once you've read two or three rule stories and two or three typology stories, the rest follow the same shape and are best used as reference, not read linearly. EP-8 is short and worth reading in full early, since several items have long external lead times.

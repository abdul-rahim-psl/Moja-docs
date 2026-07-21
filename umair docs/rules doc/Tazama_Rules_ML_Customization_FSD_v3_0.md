# Tazama Rules — Parameter & Band Customization for Mojaloop (ISO 20022) Messages

**Functional Specification Document (FSD)**

| | |
|---|---|
| **Document Ref** | CCH-PL-FSD-RULECFG-001 |
| **Version** | v3.0 |
| **Date** | 20 July 2026 |
| **Classification** | Confidential |
| **Status** | Draft |

### Version History

| Version | Date | Author | Summary of Changes |
|---|---|---|---|
| v1.0 | 10 July 2026 | Syeda Ruba Zehra | Initial 33-rule parameter/band customization register. |
| v2.0 | 20 July 2026 | Behjet Ansari | Restructured into FSD format. Adopted a corridor-based currency/FX model with no live FX conversion (Rule 091, Rules 024–027, `currencyScope`). Added a one-line business description to every rule, sourced from *Main - Tazama Rules and Typologies 202402 v1.0.odp*. Reframed message translation as Mojaloop ISO 20022 → Tazama ISO 20022 (no FSPIOP terminology). Restored Rule 028 (Age Classification) to a fully runnable rule now that date of birth is confirmed present in Mojaloop's messages. Added a Glossary (§2). Dropped Rules 074/075 (no geolocation field in the message set). |
| v3.0 | 20 July 2026 | Behjet Ansari | Expanded Background & Context. Added Performance, Security, and Open Items sections. Added a document footer. |

## Table of Contents

1. Introduction
   1.1 Purpose
   1.2 Scope
   1.3 How to Read the Rule-by-Rule Sections
2. Glossary
3. Background & Context
4. Functional Assumptions & Dependencies
   4.1 Currency Conversion & FX Handling
5. Definitions — Cross-Cutting Parameters
   5.1 Cross-Cutting Parameter Reference
   5.2 Shared Dependency: `txStsSuccessCodes` Lookup
6. Functional Requirements — Rule-by-Rule Specification (Rules 001–091)
7. Performance
8. Security
9. Requirements Traceability Summary
10. Open Items

---

## 1. Introduction

### 1.1 Purpose

For each of the 33 Tazama rules in scope, this document specifies exactly what must be added, removed, or modified at the **parameter and band level only** so the rule executes correctly against Tazama's own ISO 20022 message set, translated from Mojaloop's ISO 20022 messages.

### 1.2 Scope

No field is added or removed anywhere in this document — every fix uses fields that already exist in Tazama's translated ISO 20022 message set. Currency handling (§4.1) reflects the confirmed operating model: FX conversion is performed externally by the FX provider, not inside Tazama.

### 1.3 How to Read the Rule-by-Rule Sections

Each rule section in §6 opens with a one-line description of what the rule detects, followed by:

| Section | Meaning |
|---|---|
| **ML message binding** | Which ISO 20022 message(s)/endpoint(s) the rule must attach to. This matters because identity and amount fields are not uniformly present on every message in the chain — binding a rule to the wrong message means it runs against a payload missing the data it needs. |
| **Fields referenced (existing)** | The ISO 20022 field path(s) already present in Tazama's translated message set that the rule reads. |
| **Runnability check** | Whether the rule can execute as originally specified, given field availability at its bound message. |
| **Parameter changes** | Add / remove / modify, applied only at rule-configuration level. |
| **Band changes** | Add / remove / modify to the Results table. "No change" where the original bands remain valid. |

---

## 2. Glossary

| Term | Meaning |
|---|---|
| **ISO 20022** | International financial messaging standard, used by both Mojaloop and Tazama — but as two distinct message sets, translated from one to the other by the PPA. |
| **Mojaloop** | The open-source switch/interoperability platform underlying COMESA's DRPP deployment; produces its own ISO 20022 messages. |
| **DRPP** | Digital Retail Payment System — COMESA's Mojaloop-based payment switch. |
| **PPA** | Payment Platform Adapter — translates Mojaloop's ISO 20022 messages into Tazama's specific ISO 20022 message set. |
| **TMS** | Transaction Monitoring Service — the Tazama component that ingests the translated ISO 20022 messages and writes transaction history. |
| **ED** | Event Director — routes an ingested transaction to the typologies and rule processors relevant to its message type. |
| **Rule processor** | The component that evaluates a single rule against a transaction and its history, per this document's parameter/band configuration. |
| **Typology** | A weighted combination of rule results, scored against reporting/interdiction thresholds. |
| **Event Adjudicator** | Transaction Aggregation and Decisioning Processor — aggregates typology scores into a final alert sent to the CMS. |
| **CMS** | Case Management System — receives Tazama's alerts for investigation. |
| **DBTR** | Debtor — the paying party of a transaction; also tags rules evaluating debtor-side behaviour. |
| **CDTR** | Creditor — the receiving party of a transaction; also tags rules evaluating creditor-side behaviour. |
| **Band** | A rule result type expressed as sub-divisions of a contiguous value range (−∞ to +∞). |
| **Case (result type)** | A rule result type expressed as an explicit list of discrete outcomes, including a "none of the above" option. Not to be confused with a CMS case (an investigation record). |
| **Corridor** | The ordered pair of source currency → destination currency for a transaction; used wherever a threshold or baseline must reflect direction as well as currency (§4.1). |
| **Exit condition** | An early, deterministic rule outcome (e.g. "transaction unsuccessful," "insufficient history") that bypasses the rule's normal band/case evaluation. |

---

## 3. Background & Context

This specification supports the translation of Mojaloop's own ISO 20022 messages into Tazama's specific ISO 20022 message set, and the resulting adjustments needed so Tazama's existing fraud/AML rules keep evaluating correctly once that translation is the source of their input data.

**Where this fits in the pipeline:** Mojaloop, operating as COMESA's DRPP, produces its own ISO 20022 messages for each transaction stage (quote, transfer, FX conversion, status). The PPA translates these into Tazama's specific ISO 20022 message set and submits them to the TMS, which writes transaction history. The Event Director then routes the transaction to the typologies and rule processors relevant to its message type, using the network-map configuration. Each rule processor evaluates the transaction and its history according to the parameter and band configuration this document specifies, and submits its result to the typology processor. The Event Adjudicator aggregates typology scores into a final alert, sent to the CMS for investigation.

**External dependency:** currency conversion is not part of this pipeline — it is performed by an external FX provider before a transaction reaches Tazama (§4.1). This document assumes that dependency is already in place and does not specify how the FX provider itself is integrated.

Rule names, default parameters, and result bands are drawn from the original rules-and-typologies register.

---

## 4. Functional Assumptions & Dependencies

### 4.1 Currency Conversion & FX Handling

Currency conversion is performed externally by the FX provider, ahead of a transaction reaching Tazama. No live FX rate feed is available to rule evaluation at runtime, so no rule converts an amount from one currency to another as part of its logic.

Where a rule needs to compare or aggregate amounts that could span more than one currency, it does so on a **per-corridor** basis — a corridor being the ordered pair of source currency → destination currency for a transaction. Limits, baselines, and tolerances are configured per corridor, each already expressed in that corridor's own local currency, rather than converted into one shared reference currency.

This keeps every amount comparison inside a rule expressed in a single currency, with no runtime conversion step. The trade-off is configuration volume: COMESA supplies a value (threshold, baseline, or tolerance) per active corridor, rather than one shared figure per parameter.

---

## 5. Definitions — Cross-Cutting Parameters

### 5.1 Cross-Cutting Parameter Reference

These parameters recur across many rules and are defined once here in full to avoid repeating the same explanation in every rule section. All are **new parameters added to existing rules** — none require a message field that isn't already present in Tazama's translated ISO 20022 message set.

| Parameter | Definition | Default |
|---|---|---|
| `currencyScope` | `'any'`, `'perCurrency'`, or `'perCorridor'` — whether history/statistics are cohorted by nothing, by `Ccy` alone, or by corridor (the ordered source-currency→destination-currency pair) before comparison. Corridor cohorting reflects that direction matters even when the currency pair is the same — a Malawi→Zambia flow and a Zambia→Malawi flow can carry very different volume profiles. | `perCorridor` for amount/volume rules (002, 010, 011, 016, 020, 048, 054, 063); `any` for pure relationship/count rules (017, 030, 044, 045), with `perCorridor` as the segmentation option where a deployment wants finer-grained cohorting |
| `amountBasis` | `'IntrBkSttlmAmt'` or `'InstdAmt'` — which amount leg to evaluate (domestic messages only carry the former; FX messages carry both) | `IntrBkSttlmAmt` |
| `accountKey` | Composite identity key `{partyIdScheme, partyId, fspId}` replacing any single-field "account" reference, since Tazama's ISO 20022 message set has no bank-style account number | mandatory, composite |
| `txStsSuccessCodes` | Explicit lookup mapping `TxInfAndSts.TxSts` values to success/fail for consistent rule evaluation | success: ACSC, ACCC; fail: RJCT, CANC — see §5.2 |
| `identitySourceStage` | Which message in the chain is authoritative for identity, since `PUT /quotes/{ID}`, `POST /transfers`, and all PATCH/PUT status messages reference identity via `$previous...` rather than carrying it independently | `POST_quotes` |
| `identityResolutionViaCorrelationId` | For rules that may see an FX leg (`pacs.009`/`pacs.091`/`pacs.092`), resolve real end-customer identity via `conversionTerms.determiningTransferId` pointing back to the originating `POST /transfers` `PmtId.EndToEndId`, since FX messages carry only FSP identifiers, not customer identity | `true` |
| `correlationIdField` and `excludeRefundLinkedTxns` | Which ID field to use for chain/graph correlation, and whether to exclude transactions where `InstrForCdtrAgt.Cd = "REFD"` (refund-linked) from that correlation set, since refunds repurpose `PmtId.InstrId` to point at a prior transaction | `EndToEndId` / `true` |
| `transactionStage` | `'quote'` or `'transfer'` — whether "a transaction" means a quote request (no funds moved) or a completed transfer with terminal success status | `transfer` |
| `restrictToSameCurrency` | For tolerance/mirroring/summing rules: restricts the comparison set to transactions sharing the same `Ccy` | `true` — the only supported setting |
| `identityResolutionRule` | De-duplication logic for alternate `PartyIdType`s (MSISDN/ALIAS/DEVICE) that resolve to the same underlying wallet, before counting "distinct accounts" | must be defined per deployment; no safe default |
| `corridorThreshold` | A lookup of regulatory threshold values keyed by corridor (ordered source-currency→destination-currency pair), with each value already expressed in that corridor's own local currency | mandatory, one entry per active corridor; no safe default — must be supplied by COMESA per corridor |

### 5.2 Shared Dependency: `txStsSuccessCodes` Lookup

Fifteen-plus rules use a "transaction unsuccessful" exit condition. This table is the single parameter-level lookup all of them should reference, built from `TxInfAndSts.TxSts` values carried in every `pacs.002.001.15` status message (`PUT/PATCH /transfers/{ID}`, `PUT/PATCH /fxTransfers/{ID}`, and the `/error` variants):

| `TxSts` value | Interpretation | Counts as |
|---|---|---|
| `ACSC` (AcceptedSettlementCompleted) | Settled | Success |
| `ACCC` (AcceptedCreditSettlementCompleted) | Settled, credited | Success |
| `RJCT` (Rejected) | Rejected | Fail |
| `CANC` (Cancelled) | Cancelled | Fail |
| `PDNG` (Pending) | In flight | Neither — treat as "in progress," excluded from both success and fail counts until resolved |

This is a configuration table, not a new field — `TxSts` already exists in Tazama's translated ISO 20022 message set for every PATCH/PUT transfer and fxTransfer row.

---

## 6. Functional Requirements — Rule-by-Rule Specification

### 001 — Derived Account Age (CDTR)
Estimates how long the creditor's account has existed, based on the earliest transaction it was observed making on the platform.
- **ML message binding:** `POST /transfers` (pacs.008) and `POST /fxTransfers` (pacs.009), evaluated at settlement.
- **Fields referenced (existing):** `CdtTrfTxInf.Cdtr.Id.{OrgId/PrvtId}.Othr.Id`, `CdtrAgt.FinInstnId.Othr.Id`, `GrpHdr.CreDtTm`.
- **Runnability check:** Fails silently on FX legs as originally written — creditor identity there is an FSP ID, not the customer. Fine on domestic pacs.008.
- **Parameter changes:** Add `accountKey`. Add `identityResolutionViaCorrelationId: true` so FX-leg receipts still count toward the creditor's account age via correlation back to the customer-facing transfer. Add `identitySourceStage: POST_quotes`. Add `transactionStage: transfer` — age should be based on settled transactions only, not quotes.
- **Band changes:** No change. (`<1d` / `1-30d` / `30-90d` / `>90d`)

### 002 — Transaction Convergence (DBTR)
Flags a debtor account that has previously received an unusually high number of separate transactions within a single day.
- **ML message binding:** `POST /transfers` + `POST /fxTransfers`, 1-day window.
- **Fields referenced:** Debtor identity fields, `GrpHdr.CreDtTm`.
- **Runnability check:** Same FX-identity issue as 001 if debtor is receiving via FX leg.
- **Parameter changes:** Add `accountKey`, `currencyScope: perCorridor` — corridor cohorting prevents inflows from different currency pairs diluting the convergence signal, `identityResolutionViaCorrelationId`, `transactionStage: transfer`. Keep existing `maxQueryRange`.
- **Band changes:** No change. (`.01 none` / `.02 detected`)

### 003 — Account Dormancy (CDTR)
Flags a creditor account that has been inactive for an extended period before receiving this transaction.
- **ML message binding:** Same as 001.
- **Runnability check:** Same as 001.
- **Parameter changes:** `accountKey`, `identityResolutionViaCorrelationId`, `identitySourceStage`, `transactionStage: transfer`.
- **Band changes:** No change. (`not dormant` / `3-12mo` / `>12mo`)

### 004 — Account Dormancy (DBTR)
Flags a debtor account that has been inactive for an extended period before sending this transaction.
- **ML message binding:** `POST /transfers` + `POST /fxTransfers`, debtor side.
- **Parameter changes:** Mirror of 003 — `accountKey`, `identityResolutionViaCorrelationId`, `identitySourceStage`, `transactionStage: transfer`.
- **Band changes:** No change.

### 006 — Outgoing Transfer Similarity – Amounts (DBTR)
Flags a debtor whose most recent outgoing payments are for near-identical amounts.
- **ML message binding:** `POST /transfers` (`CdtTrfTxInf.IntrBkSttlmAmt`), last 3.
- **Fields referenced:** `IntrBkSttlmAmt.ActiveCurrencyAndAmount`, `.Ccy`.
- **Runnability check:** Runs, but `tolerance` match is meaningless across mixed currencies.
- **Parameter changes:** Add `amountBasis: IntrBkSttlmAmt`, `restrictToSameCurrency: true`, `accountKey` for the debtor reference, `txStsSuccessCodes` to correctly filter "successful." Keep `maxQueryLimit`, `tolerance`.
- **Band changes:** No change. (`0` / `2` / `3+` similar amounts)

### 007 — Outgoing Transfer Similarity – Descriptions (DBTR)
Compares the similarity of the stated purpose across a debtor's two most recent successful transactions.
- **ML message binding:** `POST /transfers`.
- **Fields referenced:** No free-text field exists in Tazama's message set at all. Nearest available categorical field: `CdtTrfTxInf.Purp.Prtry` (already populated from the transaction's declared purpose/scenario at the quote stage).
- **Runnability check:** Cannot run as originally specified (no description field exists to compare). Runnable if repointed.
- **Parameter changes:** Repoint field reference to `Purp.Prtry` (no field change — this field already exists and is already populated). Add `identitySourceStage: POST_quotes` since `Purp.Prtry` is set at the quote stage.
- **Band changes:** **Modify** — reduce from 3 bands to 2: a coded value only supports exact match, not "similarity." New results: `.01` identical purpose code across consecutive transactions, `.02` different purpose code. Remove the middle "similar descriptions" band — it has no coded equivalent.

### 008 — Outgoing Transfer Similarity – Creditor (DBTR)
Flags a debtor whose most recent outgoing payments are repeatedly made to the same creditor account.
- **ML message binding:** `POST /transfers`.
- **Fields referenced:** `Cdtr.Id.{OrgId/PrvtId}.Othr.Id`, `CdtrAgt.FinInstnId.Othr.Id`.
- **Runnability check:** Runs, but two different `PartyIdType`s for the same wallet would be miscounted as different creditors.
- **Parameter changes:** Add `accountKey` as the match key (not a raw field compare), `identityResolutionRule` to define de-duplication across ID types, `identitySourceStage`. Keep `maxQueryLimit`.
- **Band changes:** No change.

### 010 — Increased Account Activity: Volume (DBTR)
Flags a debtor whose outgoing transaction volume over the last day is unusually high compared to their historical pattern.
- **ML message binding:** `POST /transfers` + `POST /fxTransfers`, 1-day sum vs lifetime histogram.
- **Fields referenced:** `IntrBkSttlmAmt`.
- **Runnability check:** Runs, but summing across currencies without cohorting produces a meaningless blended volume.
- **Parameter changes:** Add `amountBasis`, `currencyScope: perCorridor` — histogram and std-dev baseline built per corridor, `transactionStage: transfer`, `txStsSuccessCodes`. Keep `evaluationIntervalTime`.
- **Band changes:** No change in structure (within limits / moderate increase / significant increase); the underlying std-dev baseline is computed per corridor cohort.

### 011 — Increased Account Activity: Volume (CDTR)
Flags a creditor whose incoming transaction volume over the last day is unusually high compared to their historical pattern.
- **ML message binding:** Mirror of 010, creditor side.
- **Parameter changes:** Same as 010: `amountBasis`, `currencyScope: perCorridor`, `transactionStage: transfer`, `txStsSuccessCodes`, `identityResolutionViaCorrelationId` for FX-received volume.
- **Band changes:** No change to band structure. Note: source document's `.02` result text reads "increase for the debtor" under a creditor-perspective rule — recommend correcting this copy-paste error in the register text independent of the ML migration.

### 016 — Transaction Convergence (CDTR)
Flags a creditor account that has previously received an unusually high number of separate transactions within a single day.
- **ML message binding:** Mirror of 002, creditor side.
- **Parameter changes:** `accountKey`, `currencyScope: perCorridor`, `identityResolutionViaCorrelationId`, `transactionStage: transfer`. Keep `maxQueryRange`.
- **Band changes:** No change.

### 017 — Transaction Divergence (DBTR)
Flags a debtor account that has previously sent an unusually high number of separate transactions within an 8-hour window.
- **ML message binding:** `POST /transfers` + `POST /fxTransfers`, 8h window.
- **Parameter changes:** `accountKey`, `currencyScope: any` (default — divergence is a count/topology signal, mixing currency outflows is acceptable unless the deployment prefers otherwise; where segmentation is used, apply `perCorridor`), `transactionStage: transfer`. Keep `maxQueryRange`.
- **Band changes:** No change.

### 018 — Exceptionally Large Outgoing Transfer (DBTR)
Flags an outgoing payment that is significantly larger than the debtor's biggest payment over the preceding 90 days.
- **ML message binding:** `POST /transfers`, 90-day historical max.
- **Fields referenced:** `IntrBkSttlmAmt`.
- **Runnability check:** Runs, but "1.5x previous biggest" is invalid across currencies, and a debtor's first-ever transaction in a new currency will always look "exceptionally large" against an empty same-currency history.
- **Parameter changes:** Add `amountBasis`, `restrictToSameCurrency: true` for the historical-max lookup, `txStsSuccessCodes`. Keep `maxQueryRange`.
- **Band changes:** **Add** a new exit-condition variant distinguishing "insufficient transaction history" from "insufficient transaction history in this currency" — same two result codes (`.01`/`.02`) remain, but the exit-condition trigger logic must check same-currency history depth specifically, not overall history depth, to avoid over-firing on a debtor's first FX transaction.

### 020 — Large Transaction Amount vs History (CDTR)
Flags an incoming payment that is significantly larger than the creditor's historical average payment amount.
- **ML message binding:** `POST /transfers` + `POST /fxTransfers`, full lifetime average.
- **Parameter changes:** Add `amountBasis`, `currencyScope: perCorridor` — historical average and std-dev bands computed per corridor, `identityResolutionViaCorrelationId`, `txStsSuccessCodes`.
- **Band changes:** No change in structure; recalculated per-corridor-cohort baseline.

### 021 — Large Number of Similar Transaction Amounts (CDTR)
Flags a creditor who has received an unusually high number of same-day payments of a similar amount.
- **ML message binding:** `POST /transfers`, 1-day, tolerance match.
- **Parameter changes:** `amountBasis`, `restrictToSameCurrency: true`, `txStsSuccessCodes`. Keep `maxQueryRange`, `tolerance`.
- **Band changes:** No change.

### 024 — Non-Commissioned Transaction Mirroring (CDTR)
Flags a creditor whose outgoing payment matches the sum of a set of their recent incoming payments, with nothing retained.
- **ML message binding:** `POST /transfers`, sum of incoming vs one outgoing, 1-day.
- **Fields referenced:** `IntrBkSttlmAmt` (sum side and match side).
- **Runnability check:** Runs, but summing multi-currency incoming legs against one outgoing amount is invalid without normalization.
- **Parameter changes:** `amountBasis`, `restrictToSameCurrency: true`, `correlationIdField: EndToEndId` plus `excludeRefundLinkedTxns: true` so refund back-references (which repurpose `PmtId.InstrId`) aren't misread as ordinary incoming legs to sum. Keep `maxQueryRange`, `tolerance`.
- **Band changes:** No change.

### 025 — Non-Commissioned Transaction Mirroring (DBTR)
Flags a debtor whose outgoing payment matches the sum of a set of their recent incoming payments, with nothing retained.
- **ML message binding:** Mirror of 024, debtor side.
- **Parameter changes:** Same as 024.
- **Band changes:** No change.

### 026 — Commissioned Transaction Mirroring (CDTR)
Flags the same pass-through pattern as Rule 024, but where a commission percentage is retained before the funds are passed on.
- **ML message binding:** Same as 024, plus commission handling.
- **Parameter changes:** Same as 024, plus **add** `commissionBasis: 'sourceAmount' | 'settlementAmount'` — clarifies which leg the existing `commission` percentage parameter applies against, since FX corridors have two distinct amount legs. Keep `commission`, `tolerance`, `maxQueryRange`.
- **Band changes:** No change.

### 027 — Commissioned Transaction Mirroring (DBTR)
Flags the same pass-through pattern as Rule 025, but where a commission percentage is retained before the funds are passed on.
- **ML message binding:** Mirror of 026, debtor side.
- **Parameter changes:** Same as 026, including `commissionBasis`.
- **Band changes:** No change.

### 028 — Age Classification (DBTR)
Classifies the debtor into an age bracket, used as a fraud-vulnerability indicator.
- **ML message binding:** `POST /transfers` + `POST /fxTransfers`, evaluated at initiation.
- **Fields referenced (existing):** `CdtTrfTxInf.Dbtr.Id.PrvtId.DtAndPlcOfBirth.BirthDt` (debtor date of birth, present in Mojaloop's message set and carried through translation) vs `GrpHdr.CreDtTm` (transaction date, to compute age at time of transaction).
- **Runnability check:** Runs — date of birth is confirmed present in Mojaloop's messages and is carried through to Tazama's translated message set.
- **Parameter changes:** Add `accountKey`, `identitySourceStage`. Age is derived at rule-evaluation time as the difference between `GrpHdr.CreDtTm` and `BirthDt`; the existing age-bracket boundaries require no further change.
- **Band changes:** No change. (`<18` / `18-30` / `30-50` / `50+`)

### 030 — Transfer to Unfamiliar Creditor Account (DBTR)
Flags a debtor paying a creditor they have little or no prior payment history with.
- **ML message binding:** `POST /transfers` + `POST /fxTransfers`, full lifetime, debtor-creditor pair.
- **Parameter changes:** `accountKey` for both parties, `identityResolutionViaCorrelationId` for FX-received pairs, `identitySourceStage`, `currencyScope: any` (familiarity is a relationship property; recommend not splitting by currency unless the deployment wants per-corridor familiarity), `txStsSuccessCodes` for the "unsuccessful" exit condition, `transactionStage: transfer`.
- **Band changes:** No change. (`1st` / `2nd` / `3rd+` payment)

### 044 — Successful Transactions from the Debtor
Counts the debtor's lifetime number of successful outgoing transactions.
- **ML message binding:** `POST /transfers` + `POST /fxTransfers`, lifetime count.
- **Parameter changes:** `accountKey`, `txStsSuccessCodes`, `currencyScope: any` (this is a general trust/experience counter, not an amount statistic; `perCorridor` is the segmentation option if ever needed), `transactionStage: transfer`.
- **Band changes:** No change.

### 045 — Successful Transactions to the Creditor
Counts the creditor's lifetime number of successful incoming transactions.
- **ML message binding:** Mirror of 044, creditor side.
- **Parameter changes:** Same as 044, plus `identityResolutionViaCorrelationId` for FX-received counts.
- **Band changes:** No change.

### 048 — Large Transaction Amount vs History (DBTR)
Flags an outgoing payment that is significantly larger than the debtor's historical average payment amount.
- **ML message binding:** Mirror of 020, debtor side.
- **Parameter changes:** `amountBasis`, `currencyScope: perCorridor`, `txStsSuccessCodes`.
- **Band changes:** No change in structure; per-corridor baseline.

### 054 — Synthetic Data Check – Benford's Law (DBTR)
Checks whether the debtor's transaction amounts follow the expected Benford's Law distribution, flagging signs of fabricated amounts.
- **ML message binding:** `POST /transfers` + `POST /fxTransfers`, lifetime.
- **Runnability check:** Runs, but a leading-digit distribution blending currencies with different typical magnitudes will distort the statistical baseline.
- **Parameter changes:** `amountBasis`, `currencyScope: perCorridor` — `minimumTransactions` evaluated and digit distribution built within a single corridor; a debtor active across 3 corridors effectively needs 3 independent evaluations. Keep `minimumTransactions`.
- **Band changes:** No change.

### 063 — Synthetic Data Check – Benford's Law (CDTR)
Checks whether the creditor's transaction amounts follow the expected Benford's Law distribution, flagging signs of fabricated amounts.
- **ML message binding:** Mirror of 054, creditor side.
- **Parameter changes:** Same as 054, plus `identityResolutionViaCorrelationId`.
- **Band changes:** No change.

### 074 — Distance Over Time From Last Transaction Location (DBTR)
Flags transactions implying a physically unreasonable travel speed between the debtor's last two transaction locations.
**Status: Dropped.** No geolocation field exists anywhere in Tazama's translated ISO 20022 message set. This rule is excluded from the ruleset rather than customized.

### 075 — Distance From Habitual Locations (DBTR)
Flags a transaction occurring far from the debtor's usual transaction locations.
**Status: Dropped.** Same reason as 074 — no geolocation field exists in the message set.

### 076 — Time Since Last Transaction (DBTR)
Flags a debtor initiating a follow-up transaction unusually soon after their previous one.
- **ML message binding:** `PUT /transfers/{ID}` / `PUT /fxTransfers/{ID}` (terminal `pacs.002`), consecutive successful transactions.
- **Fields referenced:** `TxInfAndSts.PrcgDt.DtTm` (completion) vs `GrpHdr.CreDtTm` (initiation) — the original rule doesn't specify which.
- **Runnability check:** Runs, but ambiguous timestamp choice produces inconsistent results.
- **Parameter changes:** **Add** `timestampBasis: 'initiation' | 'completion'`, default `completion` (i.e., `TxInfAndSts.PrcgDt.DtTm`), so "consecutive" is measured against settlement time, not request time. Add `txStsSuccessCodes` since only successful transactions qualify.
- **Band changes:** No change. (`suspiciously quick` / `surprisingly quick` / `within limits`)

### 078 — Transaction Type
Classifies the transaction into a type — cash withdrawal, merchant payment, or direct funds transfer.
- **ML message binding:** `POST /transfers` (`Purp.Prtry`, `InstrForCdtrAgt.Cd`) — both fields already exist and are already populated at `POST /quotes` stage.
- **Fields referenced:** `CdtTrfTxInf.Purp.Prtry` (carrying the transaction's declared purpose/scenario), `CdtTrfTxInf.InstrForCdtrAgt.Cd` (set to `"REFD"` when the transaction is flagged as a refund).
- **Runnability check:** Runs for CASH/MP2B/MP2P, but refund transactions have nowhere to land in the current case set even though the `REFD` signal already exists in the message.
- **Parameter changes:** Add an explicit lookup parameter `purposeCodeToCaseMap` (Mojaloop's transaction scenario values to `Purp.Prtry` value to Tazama case code), since `Purp.Prtry` is a free proprietary code, not a controlled list, and nothing currently defines this mapping. Add check-order rule: evaluate `InstrForCdtrAgt.Cd` before `Purp.Prtry` (refund flag takes precedence).
- **Band changes:** **Add** a 4th case: `.04 REFD — The transaction is identified as a refund`, sourced from the existing `InstrForCdtrAgt.Cd` field. No field change — this data is already present in Tazama's message set, just previously unused by the rule.

### 083 — Multiple Accounts Associated with a Debtor
Flags a debtor identified as controlling more than one account.
- **ML message binding:** `POST /transfers` + `POST /fxTransfers`, lifetime, cross-referenced by underlying customer.
- **Runnability check:** Runs, but will systematically overcount — a debtor using MSISDN, ALIAS, and DEVICE identifiers for the same wallet appears as 3 "accounts" instead of 1.
- **Parameter changes:** `accountKey`, `identityResolutionRule` — mandatory definition of how alternate `PartyIdType`s are de-duplicated before counting distinct accounts, `identityResolutionViaCorrelationId`. Note: source doc has a "more ne account" typo in the `.02` result text, worth correcting independent of this migration.
- **Band changes:** No change to band count/structure. (`.01 one account` / `.02 more than one account`)

### 084 — Multiple Accounts Associated with a Creditor
Flags a creditor identified as controlling more than one account.
- **ML message binding:** Mirror of 083, creditor side.
- **Parameter changes:** Same as 083.
- **Band changes:** No change (same typo note applies).

### 090 — Upstream Transaction Divergence (DBTR)
Flags an unusually high branching factor in the transactions of the debtor's previous counterparties.
- **ML message binding:** `POST /transfers` + `POST /fxTransfers`, graph traversal across debtor's-previous-debtors, 1-day windows.
- **Runnability check:** Runs, but refund back-references risk creating false graph edges, and FX-leg identities need resolution to keep the graph customer-accurate rather than FSP-accurate.
- **Parameter changes:** `accountKey` throughout traversal, `correlationIdField: EndToEndId` plus `excludeRefundLinkedTxns: true`, `identityResolutionViaCorrelationId`, `currencyScope: any` (default — topological/count-based; flag for review on large graph typologies like 124/129 where currency-segmented graphs may be preferred). Keep `upstreamRange`, `downstreamRange`.
- **Band changes:** No change.

### 091 — Transaction Amount vs Regulatory Threshold
Flags a transaction whose amount meets or exceeds the regulator-mandated reporting threshold.
- **ML message binding:** `POST /transfers` + `POST /fxTransfers`.
- **Fields referenced:** `IntrBkSttlmAmt`.
- **Runnability check:** Runs. This is the highest-priority rule in the register given its direct regulatory-reporting risk (typology 137).
- **Parameter changes:** Add `corridorThreshold` — a lookup of threshold values keyed by corridor (ordered source-currency→destination-currency pair), with each value already expressed in that corridor's own local currency. Add `amountBasis: IntrBkSttlmAmt` (default — settlement leg is most likely already local currency for domestic clearing).
- **Band changes:** No change to band count (`.01 within limits` / `.02 exceeds threshold`). The value compared against the band boundary is always in the transaction's own corridor currency, resolved via `corridorThreshold`.

---

## 7. Performance

**Assumption (TBC):** no formal transaction-volume or latency target has been confirmed for this rule set specifically; the general Tazama TMS/rule-processor throughput targets defined elsewhere are assumed to apply here.

**Corridor configuration volume:** the corridor-based currency model (§4.1) trades a single shared parameter for one value per active corridor. `corridorThreshold` (Rule 091) and every `currencyScope: perCorridor` rule (002, 010, 011, 016, 020, 048, 054, 063) require COMESA to configure and maintain one entry per active corridor rather than one shared figure. As the number of active corridors grows, so does the configuration and lookup surface — this should be sized against the expected number of active COMESA corridors, which is not yet stated in this document.

**Historical-lookback queries:** several rules query full platform lifetime history per account (001, 003, 004, 020, 030, 044, 045, 048, 054, 063, 083, 084) rather than a bounded window. As transaction history grows, the cost of these lookups grows with it; whether this is bounded by an existing history-retention or indexing strategy is not addressed here.

**Graph traversal (Rule 090):** upstream/downstream traversal across a debtor's previous counterparties is inherently more expensive than a single-account lookup. No bound on traversal depth/fan-out beyond the existing `upstreamRange`/`downstreamRange` parameters is specified.

---

## 8. Security

**Regulatory-reporting risk (Rule 091):** this is the highest-priority rule in the register precisely because a misconfigured or incomplete `corridorThreshold` lookup — a missing corridor entry, or an entry in the wrong currency — could allow a transaction that should be reported to a regulator to pass undetected. `corridorThreshold` has no safe default and must be supplied by COMESA per corridor; until every active corridor has a confirmed value, this is a live compliance gap.

**Identity de-duplication risk (`identityResolutionRule`):** rules that count "distinct accounts" (008, 083, 084) or de-duplicate identity across `PartyIdType`s (MSISDN/ALIAS/DEVICE) depend on `identityResolutionRule`, which also has no safe default. An incomplete de-duplication rule would under- or over-count real accounts, weakening 083/084 specifically, since multiple-account detection is itself an AML control.

**Data sensitivity:** several fields this document reads are personally identifiable — debtor/creditor party identifiers (`Dbtr.Id`/`Cdtr.Id`), and, as of Rule 028, date of birth (`DtAndPlcOfBirth.BirthDt`). This document does not itself define masking, encryption-at-rest, or access-control treatment for this data — that is owned by the ingestion/storage layer and is out of scope here.

**Alignment with project security baseline:** this document does not introduce any new component, authentication mechanism, or access-control model of its own — it only configures existing Tazama rule processors — so no new threat model is required beyond what already exists for the rule-processor component itself.

---

## 9. Requirements Traceability Summary

| Rule | Status | Params added/modified | Bands changed | Notes |
|---|---|---|---|---|
| 001 | Modified | accountKey, identityResolutionViaCorrelationId, identitySourceStage, transactionStage | No | |
| 002 | Modified | accountKey, currencyScope (perCorridor), identityResolutionViaCorrelationId, transactionStage | No | |
| 003 | Modified | accountKey, identityResolutionViaCorrelationId, identitySourceStage, transactionStage | No | |
| 004 | Modified | accountKey, identityResolutionViaCorrelationId, identitySourceStage, transactionStage | No | |
| 006 | Modified | amountBasis, restrictToSameCurrency, accountKey, txStsSuccessCodes | No | |
| 007 | Modified | Field repoint to Purp.Prtry, identitySourceStage | Yes — 3 to 2 bands | |
| 008 | Modified | accountKey, identityResolutionRule, identitySourceStage | No | |
| 010 | Modified | amountBasis, currencyScope (perCorridor), transactionStage, txStsSuccessCodes | No (recalculated baseline) | |
| 011 | Modified | amountBasis, currencyScope (perCorridor), transactionStage, txStsSuccessCodes, identityResolutionViaCorrelationId | No (recalculated baseline) | Source text typo flagged |
| 016 | Modified | accountKey, currencyScope (perCorridor), identityResolutionViaCorrelationId, transactionStage | No | |
| 017 | Modified | accountKey, currencyScope, transactionStage | No | |
| 018 | Modified | amountBasis, restrictToSameCurrency, txStsSuccessCodes | Yes — exit-condition split | |
| 020 | Modified | amountBasis, currencyScope (perCorridor), identityResolutionViaCorrelationId, txStsSuccessCodes | No (recalculated baseline) | |
| 021 | Modified | amountBasis, restrictToSameCurrency, txStsSuccessCodes | No | |
| 024 | Modified | amountBasis, restrictToSameCurrency, correlationIdField, excludeRefundLinkedTxns | No | |
| 025 | Modified | amountBasis, restrictToSameCurrency, correlationIdField, excludeRefundLinkedTxns | No | |
| 026 | Modified | amountBasis, restrictToSameCurrency, correlationIdField, excludeRefundLinkedTxns, commissionBasis | No | |
| 027 | Modified | amountBasis, restrictToSameCurrency, correlationIdField, excludeRefundLinkedTxns, commissionBasis | No | |
| 028 | Modified | accountKey, identitySourceStage | No | DOB confirmed present in Mojaloop's messages — rule fully restored |
| 030 | Modified | accountKey, identityResolutionViaCorrelationId, identitySourceStage, currencyScope, txStsSuccessCodes, transactionStage | No | |
| 044 | Modified | accountKey, txStsSuccessCodes, currencyScope, transactionStage | No | |
| 045 | Modified | accountKey, txStsSuccessCodes, currencyScope, transactionStage, identityResolutionViaCorrelationId | No | |
| 048 | Modified | amountBasis, currencyScope (perCorridor), txStsSuccessCodes | No (recalculated baseline) | |
| 054 | Modified | amountBasis, currencyScope (perCorridor) | No | |
| 063 | Modified | amountBasis, currencyScope, identityResolutionViaCorrelationId | No | |
| 074 | Dropped | N/A | N/A | No geolocation field available — see §6 |
| 075 | Dropped | N/A | N/A | No geolocation field available — see §6 |
| 076 | Modified | timestampBasis, txStsSuccessCodes | No | |
| 078 | Modified | purposeCodeToCaseMap | Yes — added .04 REFD case | |
| 083 | Modified | accountKey, identityResolutionRule, identityResolutionViaCorrelationId | No | Source text typo flagged |
| 084 | Modified | accountKey, identityResolutionRule, identityResolutionViaCorrelationId | No | Source text typo flagged |
| 090 | Modified | accountKey, correlationIdField, excludeRefundLinkedTxns, identityResolutionViaCorrelationId, currencyScope | No | |
| 091 | Modified | corridorThreshold, amountBasis | No | Highest-priority regulatory-risk fix |

**Totals:** 2 rules dropped from the ruleset (074, 075 — no geolocation field available in Tazama's message set); 3 rules with band changes beyond parameter-only fixes (007, 018, 078); 28 rules fixed entirely through the cross-cutting parameter set with no band changes.

---

## 10. Open Items

| # | Item | Location | Action needed |
|---|---|---|---|
| 1 | `identityResolutionRule` has no safe default | §5.1; Rules 008, 083, 084 | COMESA/deployment team to define de-duplication logic across `PartyIdType`s (MSISDN/ALIAS/DEVICE) |
| 2 | `corridorThreshold` values have no safe default | §5.1; Rule 091 | COMESA to supply a threshold value per active corridor before go-live |
| 3 | Expected number of active COMESA corridors not yet stated | §8 | Needed to size the per-corridor configuration and lookup footprint |

---

*Paysys Labs | Confidential | v3.0 | 20 July 2026*

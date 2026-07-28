# Review Findings: Integration & Interface Document × Tazama Rules/ML Customization FSD

**Documents reviewed:** `Integration_and_Interface_Document_v3.1.md` (IID) and `Tazama_Rules_ML_Customization_FSD_v3_0.md` (Rules FSD)
**Purpose:** Cross-document consistency review, verified against Tazama's own platform documentation and confirmed system behavior.

---

## Summary

The Integration & Interface Document (IID) and the Rules/ML Customization FSD are two of the four core design documents governing the COMESA fraud-detection pipeline. The IID treats the Tazama rule-evaluation engine as a single internal hop and explicitly defers all rule-level detail to the Rules FSD. This division of responsibility is sound and consistently applied in both documents.

This review identified **three findings**, presented here in priority order. Two are assessed as **High** priority because they affect whether the 33 customized rules will function as intended once deployed.

---

## Key Findings

### Finding 1 — Rules FSD's own internal review is not reflected in the IID (High)

The Rules FSD has a separate review on file identifying six unresolved issues within it — most notably that two of the "parameter-level only" rule fixes (Rules 018 and 078) actually require changes outside that stated scope, and that none of the three rules with changed result outcomes (007, 018, 078) have a documented plan for updating the dependent typology configurations that must be kept in sync with them. If a rule's outcome set changes without every typology that consumes it being updated to match, the affected typology evaluation will not complete.

The IID cites the Rules FSD as its authority for all rule-level content but does not cross-check or reference these findings anywhere.

**Recommendation:** Resolve the six items in the Rules FSD's own review before this exercise proceeds, and add a pointer from the IID's Open Items register so the dependency is visible to anyone reading the IID alone.

---

### Finding 2 — Default platform behavior may mean most of the 33 rules never receive a transaction (High)

Both documents describe a pipeline in which quote, quote-response, and transfer messages all flow through to rule evaluation. Tazama's own platform documentation states that in the standard configuration, only the final payment-status message is actually routed to rule processors — the quote and transfer messages are received but stop short of rule evaluation unless the routing configuration is deliberately set up otherwise.

The large majority of the 33 rules in the Rules FSD are written to bind to the quote or transfer messages specifically, not the final status message. If COMESA's deployed configuration follows the platform default, most of these rules would not evaluate at all — not because they are broken, but because they never receive the transaction they are configured to look at.

**Recommendation:** Confirm explicitly, before go-live sign-off, which message types COMESA's routing configuration actually sends to rule evaluation. This is a prerequisite for validating that the 33-rule customization exercise delivers what it is designed to deliver, and should be treated as a release gate, not a documentation note.

---

### Finding 3 — Some rules are configured against message types with no live delivery path (Medium-High)

The IID's most recent update confirms, via direct inspection of the relevant system, that certain foreign-exchange-related message types described in earlier design documents have no corresponding delivery path in the current build. Several rules in the Rules FSD are specifically configured to evaluate those same message types.

**Recommendation:** Reconcile which foreign-exchange message types are actually expected to reach the platform before finalizing the affected rules' configuration, so effort isn't spent tuning parameters for a data path that doesn't yet exist.

---

## Priority Overview

| # | Finding | Priority |
|---|---|---|
| 1 | Rules FSD's own unresolved review items not reflected in IID | High |
| 2 | Default routing may mean most rules never receive a transaction | High |
| 3 | Some rules configured against message types with no live delivery path | Medium-High |

---

## Recommended Next Step

Findings 1 and 2 should be resolved or explicitly scheduled before the rule-customization work is treated as release-ready, since both affect whether the delivered configuration will behave as intended in production rather than being a documentation-only concern.

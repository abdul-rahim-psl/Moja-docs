# Review: Tazama_Rules_ML_Customization_FSD_v3_0.md

Reviewed against the Tazama `docs/Product` rules documentation (rule-processor-overview, event-flow-rule-processor, complete-example-of-a-rule-processor-configuration, configuration-management, Tazama-Rules-Life-Cycle).

Internal math checks out: 33 rule sections in §6 = traceability table rows (33) = 28 param-only + 3 band-changed (007, 018, 078) + 2 dropped (074, 075).

## Discrepancies / Misalignments with Tazama Core Docs

1. **"Exit-condition split" for Rule 018 misuses the exit-condition mechanism (§6, Rule 018; traceability row 018).**
   The FSD proposes distinguishing "insufficient transaction history" from "insufficient transaction history in this currency" as an *exit-condition* change. Per `configuration-management.md` (§"The configuration object - exit conditions"), exit condition codes (`.x00`–`.x04`) are fixed, coded into the rule processor itself — only their `reason` text is configurable; codes themselves are not addable/removable via configuration, and `.x02`–`.x04` already have fixed, unrelated meanings (trend up/down analysis). Adding a new exit-condition variant is a rule-processor code change, not a "parameter/band-level only" fix — this contradicts the FSD's own stated scope in §1.1/§1.2 ("parameter and band level only... no field is added or removed").

2. **Rule 078's proposed `.04 REFD` case conflicts with the reserved "else" convention.**
   Per `configuration-management.md` (§"Rule results - cased results"), the `.00` sub-rule reference is reserved by convention exclusively for the catch-all "else" outcome. The FSD's own source example (`complete-example-of-a-rule-processor-configuration.md`) shows Rule 078 as `.00`(else)/`.01`(WITHDRAWAL)/`.02`(PAYMENT)/`.03`(TRANSFER). Adding `.04 REFD` as a new named case is consistent with this numbering *only if* `.00` remains the else — the FSD does not confirm this, and doesn't flag that adding a case also requires a corresponding new weighted entry in every typology configuration consuming Rule 078 (per `configuration-management.md` §"Every. Possible. Outcome."), which is missing from §6/§9.

3. **No typology-configuration impact called out for any band/case change (007, 018, 078).**
   `configuration-management.md` states explicitly that every possible rule outcome (including new/changed bands or cases) must be mirrored in the `wghts` array of every typology configuration that consumes that rule, or "the typology processor won't be able to complete the evaluation... the evaluation will hang." The FSD's Traceability Summary (§9) and Open Items (§10) never mention updating dependent typology configurations for rules 007, 018, or 078 — a required downstream step per core Tazama config-management rules is omitted.

4. **"Parameter and band level only" scope claim is broken by Rule 018 and implicitly by Rule 078.**
   §1.2 states "No field is added or removed anywhere in this document" and frames all changes as parameter/band level. But:
   - Rule 018's proposed exit-condition logic split (finding #1) is a behavioral/code-level change, not configuration.
   - Rule 078's `purposeCodeToCaseMap` (§6, Rule 078) is described as "an explicit lookup parameter," but mapping "Mojaloop's transaction scenario values → `Purp.Prtry` value → Tazama case code" is a three-way translation table, which is a materially different (and more complex) structure than the simple `parameters`/`bands`/`cases` config schema documented in `configuration-management.md`. The FSD does not reconcile this with the standard config schema, nor say where in the JSON config object this lookup would live.

5. **Version-management guidance is absent despite being load-bearing for rollout.**
   `configuration-management.md` (§3) and the TL;DR are explicit: configurations must never be overwritten in production, and any rule/typology/network-map change requires a new version cut over via the network map's `active` flag, plus a restart of Event Director, Typology Processor, and TADProc. The FSD's Open Items (§10) and Performance (§7) sections raise operational risk items (corridor count, lookback cost) but never mention the versioning/cutover/restart procedure required to actually deploy these 33 rule-configuration changes — a gap for a document meant to guide a production customization exercise.

6. **`identityResolutionRule` and `corridorThreshold` are documented as "mandatory, no safe default" parameters, but the core config docs state that a rule processor with a missing required parameter still executes and produces a default *error* outcome — not a blocked deployment.**
   `configuration-management.md` (§"The configuration object - parameters") says: "If any of the required parameters are missing, the rule processor will still deliver a result, but it will be a default error outcome." The FSD's Security section (§8) frames a missing `corridorThreshold`/`identityResolutionRule` entry as a silent detection gap ("could allow a transaction... to pass undetected"), but per the core mechanism a missing/incomplete parameter should surface as an explicit `.err` result, not a silent pass-through. The FSD does not reconcile these two failure modes — worth confirming whether a *partial* lookup (corridor present but wrong value) vs. a *fully missing* parameter behave differently, since only the latter is guaranteed to `.err`.

## Minor/Presentational Issues

- **Rules 083/084 typo note**: FSD flags a "more ne account" typo in the source register text (§6, §9) — this is an FSD observation about an external register document, not a discrepancy in the FSD itself. No issue with how the FSD reports it.
- **Rule 011 copy-paste note**: Similarly self-flagged and correctly caveated as a source-register issue, not an FSD defect.
- **Glossary "Band" definition (§2)** says a band is "−∞ to +∞" — matches core docs' framing, but the core docs' precise evaluation rule (`lowerLimit <= value < upperLimit`, i.e., lower inclusive/upper exclusive) is not restated anywhere in the FSD, even though Rule 018's exit-condition proposal and Rule 007's band reduction both depend on boundary semantics being unambiguous. Worth adding for a document this operationally detailed.

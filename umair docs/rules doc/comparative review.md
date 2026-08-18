# Comparative Review — Integration & Interface Document (v3.1) × Tazama Rules/ML Customization FSD (v3.0)

**Scope of this review:** (1) locate and characterize every explicit cross-reference between the IID and the Rules/ML FSD; (2) review the IID's own claims against what the Rules FSD says, including where the Rules FSD's own review already flags problems that the IID silently inherits; (3) check both documents against Tazama's own product documentation and live-flow knowledge base (`docs/Tazama/...`), not just against each other, since the two documents can agree with each other while both drifting from what the system actually does.

Documents read in full for this review:
- `Integration and interface docs/Integration_and_Interface_Document_v3.1.md` (881 lines) + its `comprehensive insights.md` and `executive summary.md`
- `rules doc/Tazama_Rules_ML_Customization_FSD_v3_0.md` (451 lines) + its `review.md`
- Grounding: `docs/Tazama/Product/event-director.md`, `docs/Tazama/Product/transaction-aggregation-and-decisioning-processor.md`, `docs/Tazama/TMS service/API_SPEC.md`, `docs/Tazama/Product/Payment-Platform-Adapters/Mojaloop/Mojaloop-Payment-Platform-Adapter.md`, `docs/umair docs/rules doc/rules knowledge base.md` (consolidated Tazama rule-processor/config docs)

---

## 1. Where the IID References the Rules FSD (the connective tissue)

The reference is not incidental — the IID names the Rules/ML FSD as one of exactly **four** source FSDs it cross-references (§1.1), and structurally **delegates two entire bodies of content to it rather than duplicating them**:

| IID location | What it says | What it delegates |
|---|---|---|
| §1.1 | Lists `Tazama_Rules_ML_Customization_FSD_v3_0.md` as the 4th of four component FSDs, covering "the fraud/AML rule and typology parameter configuration" | Establishes the Rules FSD as an equal-standing source, not a footnote |
| §1.2 Scope | Explicitly excludes "ATM model training/retraining methodology, and the 33 individual rule parameter/band definitions (see `Tazama_Rules_ML_Customization_FSD_v3_0.md`) — this document treats the rule processors as one internal hop, not 33 separately-specified interfaces" | The single clearest statement of the relationship: IID = boundary/wire contract, Rules FSD = rule *content* |
| §2 Glossary, "DRPP" entry | Flags that "the Rules/ML Customization FSD v3.0 glossary still expands this as 'Digital Retail Payment System' — a confirmed inconsistency, tracked in §9" | Direct textual cross-check between the two documents' glossaries |
| §5.5 (Event Director → Rule Processors) | "The field-level bindings for each of the 33 in-scope rules... are fully specified in `Tazama_Rules_ML_Customization_FSD_v3_0.md` §6 — not repeated here, since that level of detail is about rule *content*, not the integration boundary itself." | The formal hand-off point in the pipeline narrative |
| §5.14 (External FX Conversion) | Cites Rules FSD §3/§4.1 as the source confirming FX conversion happens outside Tazama's visibility, and states "Twenty-eight of the 33 rules... require this per-corridor cohorting" citing Rules FSD §5.1, §9 | The single largest shared technical concept between the two documents (see §2 below) |
| §9 Open Item #24 | The DRPP naming inconsistency, repeated as a tracked open item | Same issue as the glossary entry, promoted to the open-items register |
| §10 References table | Lists the Rules FSD's actual repo path (`cchfrms-comesa/docs/Design Docs/1-FSDs/1-Draft/Tazama_Rules_ML_Customization_FSD_v3_0.md`) | Confirms it as a first-class cited source, not informally mentioned |

**The relationship in one sentence:** the IID treats the entire Tazama evaluation engine (Event Director → Rule Processors → Typology Processor → Event Adjudicator) as **one opaque internal hop** with no schema (§5.4–§5.7 explicitly say so), and the Rules FSD is the only document that opens that hop up — but only for rule *parameter/band content*, never for the *transport/schema* of the hop itself. This is a clean, deliberate separation of concerns, consistently maintained in both documents. Neither document tries to re-derive the other's material — the IID cites and adapts, never duplicates (§1.1: "Where a full worked example or schema already exists in a source FSD, this document adapts it rather than re-deriving it from scratch").

---

## 2. The Shared Load-Bearing Concept: Corridor-Based Currency Handling

This is the deepest substantive link between the two documents, and both handle it consistently:

- **Same root cause, stated independently in both documents:** no live FX conversion happens inside Tazama; an external, third-party FX provider converts currency *before* a transaction reaches DRPP (IID §5.14; Rules FSD §3, §4.1). Neither document can specify a technical contract for that external provider, and — importantly — **neither pretends to**. Both explicitly decline to fabricate one and track it as an open item (IID §5.14 Open Item / Open Item #11; Rules FSD implicitly, by scoping FX out entirely in §4.1).
- **The `corridor` concept is defined once, in the Rules FSD, and correctly referenced (not redefined) by the IID.** IID §2 Glossary's "Corridor" entry and §5.14 both point to Rules FSD §5.1/§9 rather than restating the per-rule breakdown — good documentation discipline, avoiding drift between two copies of the same definition.
- **Quantified consistently:** IID §5.14 and §6.8 (comprehensive insights) both state "28 of the 33 rules" require a `currencyScope`, `restrictToSameCurrency`, or `corridorThreshold` parameter. Cross-checked directly against the Rules FSD's own Traceability Summary (§9): counting rows with `currencyScope`, `restrictToSameCurrency`, or `corridorThreshold` in the "Params added/modified" column gives **28** (all Modified rows except 001, 003, 004, 007, 008, 028, 076, 078, 083, 084, 090 — which use identity/timestamp/lookup params instead). **This number checks out.**
- **Rule 091 is independently flagged as highest-priority in both documents**, for the same reason (regulatory-reporting risk from a missing/misconfigured `corridorThreshold`) — IID §5.14 and executive summary; Rules FSD §8 Security and §10 Open Item #2. This is a case of the two documents reinforcing each other correctly, not just repeating each other.

**No discrepancy found in this shared concept.** This is the strongest, most carefully cross-referenced part of the relationship between the two documents.

---

## 3. Where the IID's Treatment of the Rules FSD Is Incomplete

### 3.1 The IID never surfaces the Rules FSD review's own findings — a missed cross-document synthesis

The Rules FSD has its own review file (`rules doc/review.md`) identifying six substantive discrepancies between the Rules FSD and Tazama's core configuration-management documentation. **None of these six findings are reflected anywhere in the IID**, even though several of them directly affect claims the IID itself makes or defers to the Rules FSD for:

1. **Rule 018's "exit-condition split" is not a parameter/band-level change** — it requires new exit-condition codes, which per `configuration-management.md` are fixed/coded into the rule processor itself, not configurable. This directly contradicts the Rules FSD's own stated scope (§1.2: "parameter and band level only... no field is added or removed") — a scope claim the IID repeats verbatim in its own §1.2 scope-exclusion language ("the 33 individual rule parameter/band definitions") without noting that the source document's own scope framing is already broken by its own content.
2. **No typology-configuration impact is ever called out for rules 007, 018, or 078's band/case changes**, despite `configuration-management.md`'s explicit rule that every changed rule outcome must be mirrored in the `wghts` array of every typology consuming that rule, or "the evaluation will hang." This is a genuine operational risk for a rollout the IID's own pipeline diagram (§3.1) shows feeding directly into the Typology Processor and Event Adjudicator — i.e., this is exactly the kind of downstream-impact gap an integration document should flag, since a hung typology evaluation is an availability incident, not just a config nitpick.
3. **Version-management/cutover procedure is absent from the Rules FSD** despite being load-bearing (network map `active`-flag cutover + restart of Event Director/Typology Processor/TADProc, per the rules knowledge base §10/§12). The IID's own §7.6 "Versioning Strategy" talks about wire-schema versioning (additive changes, new endpoint paths) but never once mentions the **rule/typology/network-map configuration versioning and restart procedure** that is the actual deployment mechanism for everything the Rules FSD specifies. This is a real gap: the IID's versioning section and the Rules FSD's content are about two different kinds of "versioning" that never get reconciled anywhere.
4. **The "no safe default" framing for `corridorThreshold`/`identityResolutionRule` (Rules FSD §8) conflates two different failure modes** — a fully missing parameter produces a `.err` result per Tazama's actual config mechanism (confirmed independently in the rules knowledge base §6.2: "missing required parameters cause a default error outcome"), not a silent pass-through as the Rules FSD's Security section implies. **The IID repeats this same framing uncritically** in its own comprehensive-insights summary (§7.4: "Rule 091... a misconfigured or incomplete `corridorThreshold` lookup could let a reportable transaction pass undetected") without noting that a *fully missing* entry is actually a loud `.err`, not a silent gap — only a *present-but-wrong-value* entry would silently pass. This is worth tightening in both documents; the risk is real for wrong-value corridors, overstated for missing ones.

**Why this matters:** the IID's own documentation discipline (called out approvingly in its "comprehensive insights" §12 — "refuses to fabricate contracts," "distinguishes PROPOSED from confirmed," "preserves disagreement rather than silently resolving it") is exactly the kind of rigor that should have caught these four items, since they were already surfaced in a review sitting in the very same folder structure. The IID cites the Rules FSD as an authoritative source for scope-exclusion purposes but never cross-checks whether that source's own internal consistency holds up — an asymmetry worth closing before either document leaves draft.

### 3.2 The DRPP naming inconsistency is correctly caught, but is a symptom, not the disease

Both the IID (§2 Glossary, Open Item #24) and this review confirm the naming drift is real: Rules FSD says "Digital Retail Payment **System**," everything else says "**Platform**." The IID handles this exactly right — flags it, doesn't silently fix it, recommends standardizing the Rules FSD. No further issue here; this is the review process working as intended. It is listed here only to confirm it was independently re-verified, not to raise a new concern.

---

## 4. Cross-Checking Both Documents Against Live Tazama Behavior (not just each other)

This is the part of the review the user specifically asked for: verifying the IID's claims against what the Tazama codebase/knowledge-base documentation says actually happens, since two documents can agree with each other while both being wrong about the live system.

### 4.1 ⚠️ Significant finding: the Event Director's default OSS behavior contradicts the shared pipeline model both documents assume

Both the IID (§3.1 canonical diagram, §5.4–§5.7) and the Rules FSD (§3 Background & Context, and every rule's "ML message binding" in §6) describe a pipeline where transactions of type `pain.001`, `pain.013`, `pacs.008`, and `pacs.002` all flow through to the Rule Processors — e.g., Rule 001/003/004/018/030/044/054 etc. all bind to `POST /transfers` (`pacs.008`) "evaluated at settlement" or "at initiation."

**`docs/Tazama/Product/event-director.md` (§2.2, "Determine Rules") states explicitly:**
> "Currently, all transactions are submitted to the Event Director and the only attribute from the transaction that is used to evaluate the typology is the message type... **The default Tazama deployment and configuration only facilitates the evaluation of an incoming pacs.002 message. The pain.001, pain.013 and pacs.008 messages are not submitted to any rule processors for evaluation and processing of these messages terminates at the Event Director.**"

This is the Tazama OSS **default network-map configuration**, not necessarily what COMESA's deployment will end up configuring — but it is a materially important fact **neither document mentions**. If COMESA's deployed network map follows this same default (evaluate only on `pacs.002`, terminal status), then:
- Every rule in the Rules FSD §6 that binds to `POST /transfers` (`pacs.008`) "at initiation" or "at settlement" (e.g., Rules 001, 002, 006, 008, 010, 018, 021, 024–027, 030, 044, 054, 078, 083, 090 — the large majority of the 33) would **never actually fire** unless COMESA's network map is deliberately reconfigured to route `pacs.008` (and, where used, `pain.001`/`pain.013`) to rule processors, not just `pacs.002`.
- This is not flagged as an open item in either document. The IID's Open Item #16 (internal Tazama hop latency budget) and the Rules FSD's silence on network-map configuration both come close but neither states the actual finding: **which message types get routed to rule processors at all is a network-map configuration decision, and the default configuration routes almost none of them.**

**Recommendation:** add this as an explicit open item in the IID (it's squarely an integration/configuration-boundary concern, §5.4–§5.5) and cross-reference it from the Rules FSD's Open Items (§10) — confirming which message types COMESA's actual network map routes to rule processors is a prerequisite for validating that any of the 33 rules can run as specified.

### 4.2 TMS endpoint reality — v3.1's own §6.1 finding is confirmed correct, and goes one step further than the IID states

The IID's v3.1 §6.1 (code-confirmed) already flags that `tms-service` has no `pacs.081/082/091/092/009` routes, only `pain.001.001.11`, `pain.013.001.09`, `pacs.008.001.10`, `pacs.002.001.12` (gated by `QUOTING`). This is independently confirmed against `docs/Tazama/TMS service/API_SPEC.md` §4 — **exact match**, including the `QUOTING` env-var gating detail.

**What the IID doesn't connect:** since TMS only ever accepts `pain.001/013/pacs.008/pacs.002`, the Rules FSD's `pacs.009` bindings (Rules 001, 002, 010, 011, 020, 028, 030, 044, 045, 054, 063, 090 all cite `POST /fxTransfers` / `pacs.009` as a binding) have **no live TMS endpoint to arrive on at all** — this is a stronger, more concrete version of the "no `pacs.009` route exists" finding the IID already made in §6.1, but the IID doesn't trace the implication forward into "therefore every Rules-FSD rule that binds to an FX leg via `pacs.009` cannot run against the current `tms-service` build." This is worth adding to Open Item #21 (Quote/FX-Quote TMS submission mechanics) or as a new cross-reference from §6.1 to the Rules FSD's FX-leg-dependent rules.

### 4.3 PPA's actual translation direction is confirmed, cache mechanism differs in detail but not in substance

`docs/Tazama/Product/Payment-Platform-Adapters/Mojaloop/Mojaloop-Payment-Platform-Adapter.md` confirms the IID's §5.3 model in substance: PPA transforms Mojaloop events into pain/pacs ISO 20022 messages using "a cache... to keep reference of the initial pain001 message to map out the formatted ISO message and their subsequent events" — consistent with the IID's ValKey-cache correlation model (§5.3, §7.3), though the source doc doesn't name ValKey specifically (it just says "a cache"). The TMS API spec independently confirms the same cache-correlation *pattern* one hop later — TMS's own Redis `DataCache`, keyed `${TenantId}:${EndToEndId}`, written on `pacs.008` and read on the matching `pacs.002` (§7.2 of `API_SPEC.md`) — which is a **second, TMS-internal cache**, distinct from the PPA's own correlation cache the IID describes in §5.3/§7.3. **The IID does not mention that TMS itself also performs a second, separate request/response correlation** (pacs.008 → pacs.002 via `EndToEndId`) on top of the PPA's correlation layer — this is a real architectural detail with its own idempotency/TTL behavior (`DISTRIBUTED_CACHETTL`, default 300s) that arguably belongs in §5.3 or §7.3 alongside the three correlation/dedup keys already defined there. Not a contradiction, but a gap: the IID's "three genuinely distinct keys" framing in §7.3 is actually incomplete — there is a fourth correlation mechanism (TMS's own Redis cache) sitting downstream of the three it names.

### 4.4 EFRuP (Event Flow Rule Processor) is entirely absent from both documents

Tazama's rule-processor knowledge base (§5 of the rules knowledge base, `rules doc/rules knowledge base.md`) describes EFRuP as a distinct, always-present rule processor providing **operational control** — blocking conditions and override conditions that can suppress or force an interdiction alert independent of typology scoring. It is a real, documented part of the "Event Director → Rule Processors" hop that both documents treat as an opaque single hop.

- The IID's Glossary (§2) defines "Rule Processor" generically and never mentions EFRuP.
- The Rules FSD's 33-rule register (§6) is explicitly scoped to fraud/AML detection rules and doesn't claim to cover EFRuP — reasonably, since EFRuP is an operational-control mechanism, not a typology-scoring rule.
- **However**, the IID's Interdiction concept appears in §5.7 ("Interdiction threshold — should the transaction be blocked in-flight?") **without ever mentioning that EFRuP is the actual mechanism carrying override/block conditions that interact with that threshold** (per the rules knowledge base §5.2: "Override (green) conditions can also override a typology interdiction result and suppress an interdiction alert"). Since the IID's own Glossary defines "Interdiction threshold" and ATM's fail-open/payment-blocking behavior is treated as one of the four most load-bearing open items (#17), **EFRuP is directly relevant to Open Item #17** (whether any outcome can gate an in-flight payment) — EFRuP's `block`/`override` conditions are the one confirmed, documented mechanism in Tazama that already does exactly that, independent of the ATM. This is worth a forward-reference in the IID, even while treating EFRuP's internal logic as out of scope per §1.2/§5.4.

### 4.5 Corridor/currency model — no contradiction found against live docs

Neither the Tazama product docs nor the rules knowledge base impose any currency-conversion behavior inside the rule processor or typology layer that would contradict the corridor-based approach both documents converge on (§2 above). This part of both documents' shared model holds up against the broader knowledge base as well, not just against each other.

---

## 5. Summary Table

| # | Finding | Where | Severity |
|---|---|---|---|
| 1 | Rules FSD's own review (6 items) is never reflected in or cross-referenced from the IID, despite the IID citing the Rules FSD as an authoritative scope-exclusion source | Both docs | High — affects deployability of 3+ rules and the FSD's own scope claim |
| 2 | Event Director's default OSS behavior (only `pacs.002` routes to rule processors; `pain.001`/`pain.013`/`pacs.008` terminate at ED) is not mentioned in either document, yet most of the 33 rules bind to `pacs.008`/`pain.001`/`pain.013` | Both docs vs. live Tazama behavior | High — could mean most rules never fire unless network map is explicitly reconfigured |
| 3 | TMS has no live endpoint for `pacs.009` (or 081/082/091/092); several Rules-FSD rules bind to `pacs.009`/FX legs that have nowhere to land | IID §6.1 (partial) vs. Rules FSD §6 | Medium-High — extends a finding the IID already made but didn't connect to the Rules FSD's content |
| 4 | TMS's own Redis `DataCache` correlation (pacs.008↔pacs.002 via `EndToEndId`) is a fourth correlation mechanism not named among the IID's "three distinct keys" (§7.3) | IID §7.3 vs. live TMS code | Low-Medium — incomplete, not contradictory |
| 5 | EFRuP (operational block/override control) is undocumented in both documents despite being directly relevant to Open Item #17 (ATM payment-blocking question) | Both docs vs. rules knowledge base §5 | Medium — a real, existing mechanism that already answers part of an open question both documents treat as unresolved |
| 6 | Corridor-based currency model, Rule 091 prioritization, and DRPP naming drift | Both docs, cross-checked against each other and live docs | No issue — this is the relationship working correctly |

---

## 6. Bottom Line

The IID and the Rules FSD are **consistently and deliberately cross-referenced** wherever the IID says they should be (§1.2 scope exclusion, §5.5 delegation, §5.14 corridor model, §2/§9 DRPP naming) — the connective tissue is real, intentional, and well-documented in both directions. Where the relationship falls short is not in *how* the two documents reference each other, but in **what neither document checks**: neither re-validates the Rules FSD's own internal consistency (its own review already found six issues, unreflected in the IID), and neither checks its shared pipeline assumption against the Event Director's actual default routing behavior — which, per Tazama's own product documentation, only evaluates `pacs.002` against rule processors out of the box. That single fact, if it holds for COMESA's deployment, would be the most consequential unstated assumption underlying both documents' entire 33-rule customization exercise.

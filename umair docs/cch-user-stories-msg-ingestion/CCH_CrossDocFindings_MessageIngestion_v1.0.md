# Cross-Document Findings — Message Ingestion FSD vs. Integration & Interface Document
**CCH FRMS | Paysys Labs**
Document Ref: CCH-PL-XDF-MSGING-001 | v1.0 | 17th August 2026

Six points where the Integration & Interface Document and the Message Ingestion FSD specify different things for the MLA→PPA→TMS pipeline. The IID cites the FSD as its source on every one of them, so these are drift, not competing designs — with one exception (F-04) where the IID's departure looks deliberate.

Three are copy-paste hazards: a developer implementing from the IID's worked examples produces messages that Tazama's TMS either silently strips or accepts into a chain that never links.

---

## Files Compared

| Role | File | Version stated **inside** the file | Notes |
| --- | --- | --- | --- |
| **Component FSD** — authority for how MLA and PPA work internally | `cchfrms-comesa/docs/Design Docs/1-FSDs/2-Internal-Review/CCH_FSD_MessageIngestion_v4.0.md` | **V4.0**, 11th August 2026, Behjet Ansari | Doc Ref CCH-PL-FSD-MSGING-001 |
| — same content, Final folder | `cchfrms-comesa/docs/Design Docs/1-FSDs/3-Final/CCH_FSD_MessageIngestion.md` | **V4.0**, 11th August 2026 | **Byte-for-byte identical** to the Internal-Review copy (verified by `diff`). No ambiguity about which content is authoritative. |
| **IID** — authority for every system-to-system boundary | `cchfrms-comesa/docs/Design Docs/3-TSDs/1-Draft/Integration_and_Interface_Document_v4.0.md` | **v4.1**, 17th August 2026, Umair Khan | Doc Ref CCH-PL-IID-001. Filename says v4.0; contents say v4.1. See *Version and filename hygiene* below. |

All line numbers cited below refer to these files as of **17th August 2026**.

### What was NOT examined

- **The other three component FSDs** — Case Management (`CCH_FSD_CaseManagement.md`), BIAR (`CCH_BIAR_FSD_v1_1.md`), and Rules/ML Customization (`Tazama_Rules_ML_Customization_FSD_v3_0.md`). The IID cites all three. Only the Message Ingestion boundary was compared.
- **Anything downstream of the TMS.** Event Director, rule processors, typology processor, event adjudicator, relay service, ATM, CIMS.
- `CCH_IDD_SystemDeployment.md` was consulted only where the IID quotes it.

### Relationship to prior review work

- `Integration_and_Interface_Document_v0.1_review-findings.md` reviewed the earliest IID draft and raised structural/scope issues. **None of the six findings below appear in it.**
- IID **v4.1** (17th August 2026) was itself a post-review corrections pass resolving five items. **None of them are the six below**, so every finding here stands against the current file contents, not a superseded revision.

### How these were found

Surfaced while aligning the `poc-mla-ppa` prototype's design documents to the FSD, which required reading both documents field-by-field against each other and against Tazama's real `tms-service` interfaces.

---

## Summary

| # | Finding | Severity | Failure mode if the IID is implemented |
| --- | --- | --- | --- |
| F-01 | IID's PPA→TMS worked examples use Mojaloop-side field shapes the FSD explicitly forbids copying | **Critical** | 5 fields wrong; `EndToEndId` absent, so the pacs.002 never links to its pacs.008 |
| F-02 | IID's pacs.002 example carries `"TxSts": "COMMITTED"` untranslated | **Critical** | Accepted and stored silently, then fails every downstream fraud rule |
| F-03 | IID gives FX Transfer its own output message and TMS endpoint | **High** | A second pacs.008 per cross-border payment; FXP enters Tazama's graph as a synthetic counterparty |
| F-04 | `msgType` means two different things | **Medium** | Envelope contract mismatch between the two services |
| F-05 | IID describes the PPA as pairing a request with its callback | **Medium** | Waiting for the fulfil destroys the pre-settlement evaluation window |
| F-06 | PPA health endpoints differ | **Low** | Probe configuration mismatch |

---

## F-01 — The IID's PPA→TMS worked examples are Mojaloop-shaped, not Tazama-shaped

**Severity: Critical.** The FSD names this exact mistake and forbids it.

FSD §7 (line 922):

> *"Mojaloop's ISO paths here are **not** Tazama's. Mojaloop uses `FinInstnId.Othr.Id`; Tazama requires `FinInstnId.ClrSysMmbId.MmbId`. Mojaloop's `originalIso20022QuoteResponse` likewise uses `IntrBkSttlmAmt.Ccy` + `ActiveCurrencyAndAmount`, where Tazama requires `IntrBkSttlmAmt.Amt.Amt` + `.Amt.Ccy`. These extension keys are useful corroboration, but **they cannot be copied through unmodified**."*

The IID's §5.3 examples use the Mojaloop side of every one of those pairs:

| Field | IID §5.3 example | FSD mapping (§6.5, line 625–626) and verified sample (§7, lines 1066–1177) |
| --- | --- | --- |
| Payment identifiers | `PmtId.TxId` (line 312) | `PmtId.InstrId` **and** `PmtId.EndToEndId` (lines 1066–1067) |
| Settlement amount | `IntrBkSttlmAmt: { Ccy, value }` (line 313) | `IntrBkSttlmAmt.Amt.{Amt, Ccy}` (line 1069) |
| Debtor/creditor agent | `FinInstnId.Othr.Id` (lines 314–315) | `FinInstnId.ClrSysMmbId.MmbId` (lines 1112, 1115) |
| Original identifiers (pacs.002) | `OrgnlTxId` (line 335) | `OrgnlInstrId` **and** `OrgnlEndToEndId` (lines 1164–1165) |
| Timestamp (pacs.002) | `PrcgDt.DtTm` (line 338) | `AccptncDtTm` (line 1175) |

**Why the `EndToEndId` omission is the worst of the five.** Tazama's TMS retrieves its DataCache keyed on `TenantId:EndToEndId` to link a pacs.002 back to its pacs.008. An example that carries neither `EndToEndId` nor `OrgnlEndToEndId` produces messages TMS accepts individually but never joins into a transaction. FSD §6.4.5 (lines 579–581) states the consequence directly: *"TMS accepts it; Tazama's own DataCache retrieval… then finds nothing, and the transaction silently never completes a chain."*

This is not theoretical. The `ppa-prototype` service verified the same behaviour against a live Tazama deployment: `EndToEndId` must be shared across the pair for the link to resolve, while `MsgId` must be unique per message because TMS enforces `UNIQUE(MsgId, TenantId)`.

The IID's example also omits `Dbtr` / `Cdtr` / `DbtrAcct` / `CdtrAcct` entirely, which are the party fields the FSD's whole cross-stage enrichment model (§6.4.3) exists to populate.

**Fix:** replace both examples in IID §5.3 with the schema-validated payloads from FSD §7, or cite them by reference rather than restating them.

---

## F-02 — `"TxSts": "COMMITTED"` in the IID's pacs.002 example

**Severity: Critical.** Silent failure, no error anywhere in the pipeline.

IID line 336 carries `"TxSts": "COMMITTED"` — Mojaloop's `transferState` value, untranslated.

FSD §6.5.3 (lines 649–655) mandates translation, and explains precisely why it is dangerous to skip:

| Mojaloop `transferState` | Tazama `TxSts` |
| --- | --- |
| `COMMITTED` | `ACSC` |
| `RESERVED` | `ACSP` |
| `ABORTED` | `RJCT` |
| Error callback, any resource | `RJCT` |

> *"`TxSts` is an unconstrained string in Tazama's real schema, so an untranslated `"COMMITTED"` would be silently accepted and stored, then fail every downstream rule testing for a real ISO status code — this translation is a correctness duty, not a validation one."*

`ACSC`, not `ACCC`: `ACCC` asserts funds reached the creditor's account, which Mojaloop's `COMMITTED` does not evidence.

The FSD's own verified sample carries `"TxSts": "ACSC"` (line 1166). The FSD is careful enough about this class of error that at line 1046 it warns readers not to copy the `MsgId` from its *own* captured sample, since a compliant implementation must generate a fresh one.

**Fix:** IID line 336 → `"TxSts": "ACSC"`, ideally with a pointer to FSD §6.5.3 so the translation requirement travels with the example.

---

## F-03 — The IID gives FX Transfer an output message; the FSD says it produces none

**Severity: High.**

IID §5.3 (line 286) assigns FX Transfer an ISO output and a TMS endpoint:

| Event | Tazama ISO 20022 Output | TMS Endpoint | Notes |
| --- | --- | --- | --- |
| FX Transfer request + callback | `pacs.008.001.10` (enriched) | `POST /v1/evaluate/iso20022/pacs.008.001.10` | FX Transfer enriches the pacs.008 payload |

The row contradicts itself — the Notes column says it only *enriches*, while the Output and Endpoint columns describe a submission.

FSD §6.4.1 (line 487 onward) classifies `POST` / `PUT /fxTransfers` as **correlation/audit only**, producing nothing. FSD §6.5.1 (line 631) explains what is at stake:

> *"**The PPA emits one pacs.008 and one pacs.002 for the whole payment**, not one pair per leg… The FXP itself never appears as a party — modelling the FX leg separately would inject a synthetic entity and an extra relationship edge into Tazama's graph on every cross-border payment, inflating counterparty counts and corrupting velocity scoring."*

Since every Phase 1 payment is cross-border, an implementation following this row would corrupt velocity scoring on **every transaction**, not an edge case.

**Fix:** blank the Output and Endpoint cells for that row, matching the treatment the IID already gives FX Quote two rows above (`—` / `—`, "Enrichment-only").

---

## F-04 — `msgType` means two different things

**Severity: Medium.** The one finding that looks like a deliberate departure rather than drift.

| Source | Definition |
| --- | --- |
| FSD §5.4 (line 387) | *"Type of the original event: request, callback, or the Central Ledger notification type"* |
| IID §5.2 (line 232) | *"HTTP method of the original event: `POST` or `PUT`"* |

The IID's own version history (v3.0, item 8) records this as an intentional change — *"separated the MLA envelope's internal `eventType`/`msgType` fields from Mojaloop's actual per-action topic/message identity"* — and IID §5.2 carries a disclaimer recommending that a future FSD revision introduce explicit `sourceTopic` / `sourceAction` / `isoMessageType` fields.

So this needs a **decision**, not just a correction. Both definitions are defensible; what is not defensible is two documents defining the same wire field differently while one cites the other as its source.

Note the FSD's three-value form cannot be mechanically derived from the IID's two: a Central Ledger notification is neither `POST` nor `PUT`.

**Fix:** pick one and make the other match, or adopt the IID's own recommendation and split the field in the next FSD revision. Whichever is chosen, the Event Envelope schema follows it.

---

## F-05 — The IID describes the PPA as pairing a request with its callback

**Severity: Medium.** Reads as stale prose rather than a competing design, but it is the framing the FSD opens by rejecting.

IID occurrences:

- §5.3 (line 275): *"The PPA correlates the two halves of each DRPP transaction stage…"*
- §4 catalog, row 4 (line 149): trigger given as *"Per correlated request/callback pair"*
- §5.3 endpoint table rows labelled *"Quote request + callback"*, *"Transfer request + callback"*

FSD §6.4 (line 485) opens by rejecting exactly this:

> *"**No stage in this pipeline works by pairing a request with its callback, combining the two, and emitting once** — the cache holds accumulated state for the whole leg, not one half of a pair waiting for its match… Every stage triggers on a single event."*

**Why it matters operationally:** the transfer prepare must emit its pacs.008 immediately. FSD §6.4.1 notes prepare and fulfil are about one second apart, and waiting for the fulfil *"would destroy the pre-settlement evaluation window"* — the only point at which a fraud decision can still affect the outcome. An implementer reading "correlates the two halves" as a design instruction would build in exactly that wait.

In the IID's favour: its own clarification paragraph immediately after the §5.3 table gets this right, describing the quote stage as two sequential submissions.

**Fix:** reword §5.3's opening sentence and §4's trigger cell to "per trigger event, reading accumulated leg state"; relabel the table rows to the triggering event alone.

---

## F-06 — PPA health endpoints differ

**Severity: Low**, but it is a contract.

| Source | Endpoints |
| --- | --- |
| FSD §6.2 (line 456) and Annex A.2 (line 1515) | `GET /health/live` and `GET /health/ready` |
| IID §5.2 (line 216) | `GET /health` |

The FSD's split is load-bearing: `/health/ready` is deliberately **instance-local only** — it does not gate on ValKey or the TMS token chain, because those are shared by every replica and failing readiness on them would pull the whole fleet out of rotation over one transient downstream blip.

**Fix:** IID §5.2 to list both endpoints.

---

## Cross-cutting observation — the direction of the drift

The IID cites the FSD as its source on all six points, and the FSD is the document with schema-validated worked examples behind it (FSD §6.5.2 records pacs.008, pacs.002, pain.001 and pain.013 as checked field-by-field against Tazama's real `tms-service` interfaces, with nothing stripped).

F-01's pattern points at the likely cause: the IID's illustrative payloads appear to have been drafted from **Mojaloop-side captures** rather than from FSD §7's Tazama-side examples. That is a sourcing problem, not a design disagreement — which is why five of the six findings are corrections rather than decisions.

---

## Also noted — an FSD-side item, already tracked

IID §3.1 records that the **FSD's own §3.2 system-context diagram is incomplete**: it simplifies the pipeline as *TMS → Rule Processors → Typology Processor → Case Management*, omitting the Event Director and Event Adjudicator stages. The IID declares its own §3.1 diagram canonical, corroborated independently by the Case Management FSD, the BIAR FSD, and IDD v2.0, and tracks correcting the FSD as its open item #4.

No action needed here beyond noting that the fix is owed to the FSD, not the IID.

---

## Version and filename hygiene

Two issues that make it easy to review the wrong document — this review initially proceeded against a superseded FSD for exactly this reason.

**Message Ingestion FSD — four files, three lineages:**

| File | Version stated inside | Note |
| --- | --- | --- |
| `CCH_FSD_MessageIngestion_v1.1.md` | **V1.2**, 6th August 2026 | Filename understates the contents by one revision |
| `CCH_FSD_MessageIngestion_v2.0.md` | v2.0, 17th July 2026 | An unrelated historical draft, older than V1.0 of the current lineage |
| `CCH_FSD_MessageIngestion_v3.0.md` | **v1.0**, 21st July 2026 | Filename and contents disagree outright — a separate lineage |
| `CCH_FSD_MessageIngestion_v4.0.md` | V4.0, 11th August 2026 | **The current successor to V1.2.** Its own version history records the filename being bumped v2.0 → v4.0 to dodge the collisions above |

**IID:** filename `Integration_and_Interface_Document_v4.0.md` contains **v4.1** (17th August 2026).

Two of the four filenames above disagree with their own contents (`_v1.1` holds V1.2, `_v3.0` holds v1.0); the Final-folder copy carries no version in its filename at all; and the IID's filename is a revision behind its contents. The file a reader would reach for by highest version number (`_v4.0`) is the right one — but only because the collision was noticed and the number deliberately skipped, not because the numbering is reliable.

**Suggestion:** name files after the version they contain, and keep exactly one copy of a given revision, or make the Final-folder copy a pointer rather than a duplicate. The FSD's two v4.0 copies are currently identical, but nothing prevents them diverging.

---

## Recommended actions

| # | Action | Document | Owner |
| --- | --- | --- | --- |
| 1 | Replace both PPA→TMS worked examples with FSD §7's validated payloads, or cite them by reference | IID §5.3 | IID author |
| 2 | Correct `TxSts` to `ACSC` and cross-reference FSD §6.5.3 | IID §5.3 | IID author |
| 3 | Blank the FX Transfer row's Output and Endpoint cells | IID §5.3 | IID author |
| 4 | **Decide** `msgType` semantics, then align both documents | Both | FSD + IID authors, jointly |
| 5 | Reword the request/callback pairing language | IID §4, §5.3 | IID author |
| 6 | List `/health/live` and `/health/ready` | IID §5.2 | IID author |
| 7 | Correct the §3.2 system-context diagram (already IID open item #4) | FSD §3.2 | FSD author |
| 8 | Reconcile filenames with the versions they contain | Both | Document owners |

Items 1–3 are the ones worth resolving before any translation code is written, because they are copy-paste hazards whose failure modes are silent. Items 4–8 are reconciliation housekeeping.

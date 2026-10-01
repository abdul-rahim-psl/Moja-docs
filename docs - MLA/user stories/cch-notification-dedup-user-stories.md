# CCH — Notification Filter/Dedup Component: User Stories & Review

**CCH FRMS | Paysys Labs** | Component: Notification Filter/Dedup | 18th August 2026
Source stories: `CCH_UserStories_MessageIngestion_v1.0.md`, Epic 4 · Review consolidated from `CCH_UserStories_MessageIngestion_ConsolidatedReview_v1.0.md`

**STATUS: REMOVED FROM THE DESIGN.** This component is dropped, not deprioritized. Retained here as a historical record and to close out its findings with traceability — no implementation work should proceed on this epic.

---

## Why It Was Removed

Verified against `DRPP_Kafka_E2E_Pack` (five corridor captures + one interleaved partition slice, from `topic-event-audit` — the actual Mojaloop audit topic this design consumes): the topic carries no independently-published Central Ledger final-state notification. `fulfilTransfer` (ingress) and `commitTransfer` (egress) are the same relayed FSPIOP fulfil callback — identical `GrpHdr.MsgId`, `TxSts`, `fspiop-source`, `fspiop-destination` — observed exactly once per transaction across all five sample corridors and the interleaved slice. `fspiop-source` on `commitTransfer` is always the DFSP that sent the original fulfil, never a hub/Central-Ledger identity.

This closes **FSD Open Items #2 and #5**, and removes this component's stated reason to exist — there is no separately-published event for it to deduplicate. Full evidence: `Message_NotificationDedup_OpenItems_Resolution.md`.

**Action for the FSD:** §4.1's component table row, §4.7, §6.3 step 4's notification-dedup sub-step, §9.6's capacity note, §10.5's threat model section, and the Glossary entry should be marked for removal or explicit supersession.

**What survives:** PPA's own step-4 idempotency check (US-PPA-04, in `cch-ppa-user-stories.md`) is unaffected — it was already a self-contained mechanism, not dependent on this component existing. It is now the pipeline's *sole* notification dedup mechanism, which is why its own atomicity gap (R-28, tracked in the PPA document) matters more, not less, post-removal.

---

## Former User Story (historical record only)

### US-DEDUP-01 — Filter and Deduplicate Central Ledger Final-State Notifications *(REMOVED)*

**Description**
The Notification Filter/Dedup component sits between the Mojaloop audit topic and MLA. It identifies final-state notification events within the unified audit stream and suppresses duplicate notifications for the same `transferId` before they reach MLA. All other event types pass through unmodified.

**Acceptance Criteria** *(as originally written, for record)*
- For each notification event received, the component checks the idempotency key (`transferId`) against a durable store of already-forwarded notifications.
- The first occurrence of a given `transferId` is forwarded to MLA. Subsequent occurrences are silently dropped (not forwarded, logged as duplicate).
- Terminal-state monotonicity is enforced: a `COMMITTED` notification re-emitted after an already-processed `ABORTED` for the same `transferId` does not constitute a new key — it is dropped.
- Non-notification events (quotes, transfers, FX events) pass through this component without any dedup check applied.
- If the component is unavailable, events pass through unfiltered to MLA; PPA's own step-4 idempotency check (keyed on `transferId`) acts as the backstop. This degraded mode is logged and alerted.
- The idempotency store uses a TTL that exceeds the maximum plausible notification re-emission window (to be confirmed with CCH/Mojaloop Partner).
- The component uses the same dedup rule as PPA's step-4 check — one canonical rule, not two independently maintained ones.

**Assumptions** *(as originally written, for record)*
- The component's precise deployment boundary (Mojaloop side vs. Tazama side) is unconfirmed per the FSD. This must be agreed before implementation begins.
- The idempotency store is durable (not in-memory) to survive component restarts without re-admitting already-seen notifications.
- Conflicting terminal states (e.g. `COMMITTED` after `ABORTED`) are possible in theory but their real-world frequency is unknown — the Mojaloop Partner should confirm whether this case actually occurs on COMESA's DRPP.

---

## Findings Closed by This Removal

| # | Finding | Sev | Status |
| --- | --- | --- | --- |
| R-06 | Mandatory FSPIOP header check (US-MLA-04) conflicted with the unresolved notification-trigger decision (US-PPA-11). | High | **Closed** — only one trigger exists now, and it's DFSP-signed. |
| R-07 | Both candidate pacs.002 triggers (fulfil callback and Central Ledger notification) were listed as triggers in US-PPA-05, risking duplicate emission masked by the sent-message dedup set. | High | **Closed** — only one candidate exists on the topic. |
| R-09 | US-DEDUP-01's deployment-boundary assumption was stale — already resolved in IID §5.1 (Open Item #6 closed) and IDD v2.0 §6.8 (embedded within MLA/PPA for Phase 1). | Medium | **Closed** — component removed; the resolved-but-stale assumption is moot along with it. |
| R-24 | FSD §10.5's dedicated threat model (forged notification events, forensic-record predates both controls) wasn't reflected in US-DEDUP-01. | Low | **Closed** — no component, no threat model needed. |
| R-25 | FSD §9.6's capacity-planning note (account for dedup volume reduction when sizing PPA→TMS) had no home in any story. | Low | **Closed** — nothing to reflect; no upstream reduction exists to size around. |
| R-26 | Whether `topic-notification-event` carries only the final-state notification or a wider set of DFSP callbacks (FSD Open Item #2) wasn't carried as an assumption on US-DEDUP-01. | Low | **Closed** — that topic isn't consumed by this design. |
| R-27 | The failure-domain relationship between US-DEDUP-01's idempotency store and US-PPA-04's own store was never specified. | Medium | **Closed — folded into R-28** (tracked in `cch-ppa-user-stories.md`). With US-DEDUP-01 gone, the "relationship between two stores" question dissolves; the underlying concern about US-PPA-04's *own* store integrity survives independently as R-28. |

No open actions remain against this component.

---

*End of Document*

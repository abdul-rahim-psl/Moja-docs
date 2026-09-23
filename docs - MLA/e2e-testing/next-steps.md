<!-- SPDX-License-Identifier: Apache-2.0 -->

# Next Steps — Options as of 2026-09-22

**Status:** a menu, not a plan. Nothing here is sequenced or committed to; it is the set of possible next
moves surfaced when onboarding a session against `strategy.md` §1, `plan.md` §13/§14, and
`e2e-testing/remove-JWS.md`, at the point where Phase 7 is dev-complete-pending-CI, Phase 8 is partially
under way, and the QA bugfix workstream (F-11 onwards) sits open on `paysys-QA-F11-onwards`. Superseded the
moment any of these is actually picked up and tracked properly in `plan.md` §16 — this document does not
replace that log.

**This is a living document.** It is expected to change in place as work moves forward — an option removed
once it closes or stops being live (not left struck through, unlike `plan.md` §13's convention: this list is
a menu of what's still available, not a history), and a new option added the moment something else opens up.
Re-read it fresh each session rather than trusting a stale local copy; do not treat it as a fixed record the
way the dated `continue/` files or `plan.md` §16 entries are meant to be.

---

## A. Pure engineering — no external blocker, can start immediately

1. **F-11 through F-22 QA findings.** Medium/Low severity, on `paysys-QA-F11-onwards` (the current working
   branch). `bugs/qa-review-findings.md` has each finding; `bugs/qa-review-remediation.md` has the proposed
   fix, in suggested order. Fully self-contained — no CCH/COMESA dependency.
2. **`cch-ppa` schema-completeness fix.** Add the missing ISO fields (`RmtInf`, `SttlmInf`, `ChrgBr`, `Purp`,
   `PmtMtd`, `ReqdAdvcTp`, `Dbtr`/`Cdtr`/`DbtrAcct`/`CdtrAcct`, and others) to the `pain.001`/`pain.013`/
   `pacs.008` translations so local schema validation stops rejecting them. **The single highest-leverage fix
   live-verified as blocking** — confirmed identically on both the local stack (`e2e-testing/locally-up.md`)
   and the real remote PPA (`plan.md` §16's [2026-09-21] SSH-access entry), and it gates everything
   downstream of TMS dispatch (`e2e-testing/checklist.md` §3.6, §3.8, §3.9). Touches `cch-ppa`, the other
   engineer's repo — worth flagging before starting, not a unilateral change to make quietly.
3. **`TxSts: "ABOR"` translation gap.** Add the missing row to the `TxSts` translation table and the missing
   branch in `isTransferRejection` for the payee-DFSP-rejection shape Sam supplied
   (`docs/meetings and emails/sam-email-2026-09-16-rejection-samples.md`, `plan.md` §14 item 3). Currently falls through
   silently to Tazama's `PDNG` default — a silent-failure class `strategy.md` §7 specifically warns about.

## B. Requires a CCH/story-author decision first, but a reversible default can be built now

4. **Payee `complexName` tokenization.** Open spec question — no "Payee legal name" row exists in the
   Fields-to-Tokenize table (`plan.md` §16's [2026-09-21] SSH-access entry; `core-knowledge.md` §13.3). Per
   `CLAUDE.md`'s external-decisions rule, a reversible default (tokenize it) could be built now while the
   question is put to CCH/the story author, rather than waiting.

~~5. PII secret rotation trigger mechanism~~ **Resolved [2026-09-18], spec confirmed [2026-09-22]** —
`docs/meetings and emails/tokenization-feedback.md`; `plan.md` §16's "gate item #2 reversed" entry. No
rotation, a long-lived key; the trigger question is moot and no code change is needed. Removed from this
menu per its own convention (a closed option is removed, not struck through) — kept visible here once, this
edit, as the record of why it left the list.

## C. Documentation / decision-support work, no code

6. ~~**Advance `e2e-testing/remove-JWS.md`.**~~ **Built and live-verified [2026-09-23]** on `cch-mla` branch `paysys-remove-JWS`, closure pending that document's §9 sign-offs. Still open from this item: e.g. draft the narrower follow-up question to Michael (§1.1's
   surviving tamper-evidence argument — corruption/truncation on the switch-to-Kafka hop, distinct from the
   foreign-producer question he already answered) before CCH decides whether to authorize removal. Explicitly
   not yet actioned; §9 of that document lists exactly which decisions are not engineering's to make alone.
7. **Formally close Phase 4.** Both gate items are now resolved (#1 fail-mode, #2 secret rotation — no
   rotation, a long-lived key) — this is now a single closure write-up, not two items to keep visibly
   separate.

## D. Coordination / drafting for someone else to act on

These need someone to actually send them — flagged here as live gaps, not drafted or sent by this document.

8. **Push CCH/techops on the manifest `kubectl apply`.** Handed to George Murage [2026-09-15]; unconfirmed
   whether techops has applied it since the [2026-09-17] check-in (`plan.md` §13.1).
9. **Chase the Infotex call.** Still not scheduled — needed to settle MLA's outbound IP and mTLS certificate
   routing (`plan.md` §13.1, `deployment/MLA-deployment-kubernetes.md` §11 Q4/Q5).
10. ~~**Chase DFSP keys / JWKS / the MCM onboarding video.**~~ **Dissolved [2026-09-23]** by the JWS removal (sign-off confirmed). Original item: Pending from Sam since the [2026-09-09] meeting
    (`plan.md` §13.1, §14 item 1) — the single highest-value unblock for Phase 3's genuine-signature
    verification, and the item `remove-JWS.md` §1.2 notes would dissolve entirely if JWS is removed instead.
11. **Ask George for his annotated event table.** Covering the ~52% of the 500-record export not yet
    reflected in the per-operation model (`plan.md` §14 item 2's follow-up, not yet received).
12. **Ask Sam for a genuine FX-side rejection/timeout sample.** Still missing — every FX-labelled folder in
    the [2026-09-16] report either hides the raw shape behind an SDK abstraction or returns `202` with no
    visible failure callback (`plan.md` §14 item 3).

---

## How this menu was derived

Read in this order: `strategy.md` §1 (orientation) → `plan.md` §13 (blocked work) and §14 (open questions for
COMESA) → `e2e-testing/remove-JWS.md` (the newest open proposal) → `bugs/qa-review-findings.md` (the QA
workstream's own remaining scope). Nothing here required primary research beyond what those documents already
state; this file only collects and orders the possibilities they separately describe.

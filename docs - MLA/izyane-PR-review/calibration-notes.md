# Calibration notes — reading Umair Khan's reviews before reviewing anything ourselves

<!-- SPDX-License-Identifier: Apache-2.0 -->

**Purpose.** Before reviewing any PR under `Claude_PR_Review_Template.md`, two of Umair Khan's (Paysys, `UmairKhan-Paysys` on GitHub) already-posted reviews were read closely — not copied, but independently checked against the actual diff, the FSD (`Tazama_Rules_ML_Customization_FSD.md`), and the Dev Config Guide. The goal was to build a mental model of how a strong review in this fleet is actually done, and to find gaps in the template itself before the real review pass starts. Nothing in this document is itself a finding on those PRs' code — it is what reading the reviews taught about the review *procedure*.

## Sources read

- **`cch-rule-002` PR #7** — "feat: configure transaction convergence for debtor," `feat/tc` → `dev`. One review round (2026-09-24), `APPROVED`.
- **`cch-rule-001` PR #12** — "feat: rebind rule-001 to pacs.008/009 and fix .x00 exit condition and band …," `feat/dca-clean` → `dev`. Two review rounds (2026-09-21 `CHANGES_REQUESTED`; 2026-09-24 `CHANGES_REQUESTED` again).

Both read via `gh pr view`/`gh pr diff`/`gh api compare`, with the base-branch (`dev`) and PR-branch versions of every touched source file read in full and diffed directly — not inferred from the review's own prose.

## Finding 1 — a review can credit a PR for code the PR didn't touch

`cch-rule-002` PR #7's review praised "the historical query's settlement filter (`TxSts = 'ACCC'`)" as an improvement in that PR. Diffing `src/rule-002.ts` on `dev` against the PR branch directly shows the `TxSts = 'ACCC'` line is **unchanged, pre-existing code** — the diff only touches the message-type guard, a field-path rename, and comments. The query body itself was never edited.

**Why it matters beyond one wrong sentence:** the same read-the-final-file-in-isolation habit that produces false praise also hides a real bug in the same file — see Finding 2. Reading a diff line-by-line against the base branch, rather than reading the final state and judging whether it "looks right," is the only way to catch either failure mode.

**Template addition to make:** the "Query correctness hunt" (`Claude_PR_Review_Template.md` §2.1) currently covers parameterization, tenant scoping, and settlement correlation, but doesn't say to check whether the query was actually touched by the diff at all before attributing behavior to the PR. Add a line: confirm whether a query cited in the review was part of the diff's own changed lines, not just present in the file's final state.

## Finding 2 — a message-type rebind leaves stale literals behind, and the fix is to grep the whole function, not just re-read the guard

`cch-rule-002` PR #7 changed the binding guard from `isPacs002Transaction` to `isPacs008Transaction` (correct, matches the FSD's "POST /transfers + POST /fxTransfers" spec for rule 002) and updated the timestamp field path accordingly. But the SQL query two lines below still reads `TxTp = 'pacs.002.001.12' AND TxSts = 'ACCC'` — i.e. the rule now triggers on inbound pacs.008 transfers but still counts historical **pacs.002 settlement rows**, anchored on a pacs.008 timestamp. This is a real correctness bug (counting the wrong thing, and a systematic time-alignment error), not a style nit, and the review missed it entirely — see Finding 1's root cause.

**The critical companion fact, found while reading `cch-rule-001` PR #12 for comparison:** rule-001's own query has an `earliest_success` CTE that *also* filters `TxTp = 'pacs.002.001.12'` — and there it is **correct**, because that CTE is deliberately correlating a pacs.008 sighting back to a pacs.002 settlement confirmation, per the FSD's stated design for rule-001 (§6/001: "Estimates how long the creditor's account has existed... Add identityResolutionViaCorrelationId... so FX-leg receipts still count toward the creditor's account age via correlation"). Same literal, same surrounding shape (a message-type-mismatched string inside a query near a changed guard), opposite verdict.

**Template addition to make:** add a named hunt — "message-type rebind hunt": whenever a guard clause's bound type changes, grep the entire function body (not just the guard) for every literal and field path tied to the *old* type, and check each one individually against that specific rule's own FSD entry before deciding whether it's a leftover bug or a deliberate correlation. Do not pattern-match "this looks like the rule-002 bug" onto a different rule without checking its own FSD intent — the same code shape can be a bug in one rule and correct by design in another.

## Finding 3 — a second review round with fewer findings is not evidence the first round's findings were resolved

`cch-rule-001` PR #12's two review rounds are two days apart, same reviewer. Diffing the two reviewed commits directly (`gh api .../compare/<round-1-sha>...<round-2-sha>`) shows **only CI/workflow files and `package.json` changed between rounds** — `src/`, the tests, and `README.md` are byte-identical to round 1. Round 2's review body is much shorter than round 1's and opens with "Core pacs.008 banding logic... [is] correct," raising only one blocking item (the `accountKey` schema parameter) plus two follow-ups.

Checked individually against the current (round-2) code state, several of round 1's findings are **still unfixed and simply not restated** in round 2: the `oldest_sent` CTE still isn't settlement-correlated (ST-001 AC5), the query still only accepts `TxSts = 'ACCC'` and not `ACSC` (both required per the FSD's own §5.2 shared lookup table), and a missing `cdtrAcctId` still throws instead of returning `.err`. Only one round-1 item (`.x00` not implemented) was actually fixed between the two commits.

**Template addition to make:** §4 ("Multi-round PRs") already says each prior item gets a Resolution Status, sourced from what the user pastes in. Strengthen this: before writing a follow-up round, diff the two reviewed commits directly (`git diff <round-1-sha> <round-2-sha>` or the GitHub compare API) to establish what code actually changed, rather than inferring it from the new review's own scope. A shorter or narrower second review is not itself evidence of resolution — every prior item must be checked against the current diff individually and given an explicit Resolution Status, including items the newer review doesn't mention.

## Finding 4 — the same reviewer can give inconsistent remedies to the same unfixed fact across rounds

Both rounds of `cch-rule-001` PR #12 agree on the same underlying fact: `DataCache.cdtrAcctId`/`dbtrAcctId` is already a composite key assembled upstream (by `tms-service`), so `accountKey` as declared has nothing left to gate. But the two rounds prescribe different fixes for it:

- Round 1: **reword** the comment/README — they currently say `accountKey` is "not wired" and that DataCache has "no composite-key field," which round 1 says is factually wrong; keep the parameter, correct the prose.
- Round 2: **remove** the parameter from the schema entirely — "there's nothing left for this parameter to gate."

The code is unchanged between rounds (Finding 3), so this isn't the reviewer responding to a fix that landed differently than expected — it's the same static fact given two different prescriptions two days apart.

**Template addition to make:** when consolidating or following up on a prior round's finding, check whether the new round's remedy for the same fact matches the prior round's remedy. If it doesn't, that ambiguity should be surfaced to the PR author explicitly (e.g. "round 1 asked to reword this; this round asks to remove it — removal supersedes, following up on the stricter fix") rather than left for the author to reconcile silently.

## Finding 5 — some reviewer claims cite systems outside this workspace and can't be independently checked

Both PR #12 rounds assert facts about `tms-service`'s `logic.service.ts` (the composite-key construction `${Id}${SchmeNm.Prtry}${MmbId}`). `tms-service` is Tazama's own upstream repo, not present anywhere in this workspace (`/home/abdul-rahim/mojaloop` has only `poc-mla-ppa`'s own, unrelated `logic.service.ts` files, part of the separate MLA/PPA POC, not Tazama's `tms-service`).

**Template addition to make:** a review claim about a system not in this workspace (an upstream library, a sibling repo not cloned locally) should be marked as unverifiable-from-here rather than treated as confirmed. This isn't a reason to doubt the claim — Umair likely has access this workspace doesn't — but it changes how much weight our own review should put on repeating it as established fact versus attributing it to the FSD/Dev Config Guide, which are locally checkable.

## Standing calibration rules for the review pass ahead

Carried forward into every PR review from here on, independent of whether `Claude_PR_Review_Template.md` is itself amended to state them:

1. Diff the base-branch version of every touched function against the PR-branch version directly — never judge correctness from the final file state alone.
2. On any message-type rebind, grep the whole function body for literals/field paths tied to the old type, and check each one against that specific rule's own FSD entry — don't pattern-match a verdict from a different rule's PR.
3. Before writing a follow-up round on a PR we're tracking, diff the two commits being compared to establish what code actually changed, and give every prior finding an explicit Resolution Status — including ones a newer round doesn't mention.
4. If our own follow-up would prescribe a different remedy than a prior round did for the same fact, say so explicitly rather than silently superseding it.
5. Mark claims resting on repos/systems outside this workspace as unverifiable-from-here, distinct from claims checked directly against the FSD/Dev Config Guide/local diff.

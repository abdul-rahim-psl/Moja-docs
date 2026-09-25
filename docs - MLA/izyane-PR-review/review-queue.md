# Rule-processor PR calibration queue

<!-- SPDX-License-Identifier: Apache-2.0 -->

**This is a calibration queue, not a review workload.** Every PR listed here already has a posted review from Umair Khan (Paysys, `UmairKhan-Paysys` on GitHub). The task on each one is to study how he reviewed it — what he caught, how he verified it, how he phrased and categorized it, what he missed or got inconsistent across rounds — not to produce our own independent review of the code. Findings from each go into `calibration-notes.md`, which accumulates across the whole queue and is what actually strengthens `Claude_PR_Review_Template.md`.

**The real review pass — where a PR gets reviewed independently under the template, with our own findings posted — starts only when explicitly told to, as its own separate instruction. Working through this queue is not that instruction, however many PRs are in it.**

One PR studied per session turn. Reviews (Umair's, being studied) are read via `gh pr view`/`gh pr diff`/`gh api`; findings are verified independently against the actual diff, the FSD, and the Dev Config Guide before being trusted, exactly as done for `cch-rule-001`/`cch-rule-002` below.

## Studied so far

| Repo | PR | Rounds | Verdict(s) | Notes |
| --- | --- | --- | --- | --- |
| `cch-rule-001` | #12 | 2 (2026-09-21, 2026-09-24) | `CHANGES_REQUESTED` both times | `calibration-notes.md` Findings 3–5 |
| `cch-rule-002` | #7 | 1 (2026-09-24) | `APPROVED` | `calibration-notes.md` Findings 1–2 |

## Queue

Given [2026-09-25]. Studied one at a time, one per session turn, only once told to proceed.

| # | Repo | PR | Status |
| - | ---- | -- | ------ |
| 1 | `cch-rule-003` | [#7](https://github.com/psl-izyane-cch-frms/cch-rule-003/pull/7) | Not started |
| 2 | `cch-rule-006` | [#7](https://github.com/psl-izyane-cch-frms/cch-rule-006/pull/7) | Not started |
| 3 | `cch-rule-007` | [#7](https://github.com/psl-izyane-cch-frms/cch-rule-007/pull/7) | Not started |
| 4 | `cch-rule-008` | [#7](https://github.com/psl-izyane-cch-frms/cch-rule-008/pull/7) | Not started |
| 5 | `cch-rule-010` | [#7](https://github.com/psl-izyane-cch-frms/cch-rule-010/pull/7) | Not started |
| 6 | `cch-rule-011` | [#7](https://github.com/psl-izyane-cch-frms/cch-rule-011/pull/7) | Not started |

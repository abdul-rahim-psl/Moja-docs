# Rule-processor PR review queue

<!-- SPDX-License-Identifier: Apache-2.0 -->

## Calibration phase (complete)

Before any independent review, six PRs with existing posted reviews from Umair Khan (Paysys) were studied to build a mental model of the fleet's failure modes and calibrate the review procedure: `cch-rule-001` PR #12 (2 rounds), `cch-rule-002`/`003`/`006`/`007`/`008`/`010`/`011` PR #7. See `calibration-notes.md` for the full record — 21 findings, 19 standing pattern-library entries, and the FSD/`docs/shared-with-izyane/` cross-checks that grounded them. That phase is closed; nothing further is added to it unless a future independent review surfaces something that belongs there too.

## Independent review phase (active)

**This is the real review workload.** Every PR below has **no existing review** (confirmed via `gh pr view --json reviews`, zero reviews on all 13 as of [2026-09-25]) — these are reviewed independently, under `Claude_PR_Review_Template.md`, producing genuine findings rather than studying someone else's. Every standing rule and pattern-library entry from `calibration-notes.md` is applied as a first-class check on each PR, not just the template's own hunts.

One PR reviewed per session turn, only when explicitly told to proceed — same cadence as the calibration phase. Each review is written to `claude/pr-reviews/<repo>-<branch-or-PR#>.md` per the template's own §1 (outside this docs folder, in the COMESA project), with a ready-to-paste PR comment. This file tracks the queue and status only.

Given [2026-09-25]:

| # | Repo | PR | Branch | Status |
| - | ---- | -- | ------ | ------ |
| 1 | `cch-rule-016` | [#7](https://github.com/psl-izyane-cch-frms/cch-rule-016/pull/7) | `feat/tc` | Not started |
| 2 | `cch-rule-018` | [#7](https://github.com/psl-izyane-cch-frms/cch-rule-018/pull/7) | `feat/elot` | Not started |
| 3 | `cch-rule-020` | [#7](https://github.com/psl-izyane-cch-frms/cch-rule-020/pull/7) | `feat/lta` | Not started |
| 4 | `cch-rule-024` | [#7](https://github.com/psl-izyane-cch-frms/cch-rule-024/pull/7) | `feat/nctm` | Not started |
| 5 | `cch-rule-026` | [#7](https://github.com/psl-izyane-cch-frms/cch-rule-026/pull/7) | `feat/ctm` | Not started |
| 6 | `cch-rule-030` | [#6](https://github.com/psl-izyane-cch-frms/cch-rule-030/pull/6) | `feat/tuca` | Not started |
| 7 | `cch-rule-044` | [#6](https://github.com/psl-izyane-cch-frms/cch-rule-044/pull/6) | `feat/stfd` | Not started |
| 8 | `cch-rule-048` | [#6](https://github.com/psl-izyane-cch-frms/cch-rule-048/pull/6) | `feat/ltah` | Not started |
| 9 | `cch-rule-054` | [#6](https://github.com/psl-izyane-cch-frms/cch-rule-054/pull/6) | `feat/sdc` | Not started |
| 10 | `cch-rule-076` | [#7](https://github.com/psl-izyane-cch-frms/cch-rule-076/pull/7) | `feat/tslt` | Not started |
| 11 | `cch-rule-078` | [#6](https://github.com/psl-izyane-cch-frms/cch-rule-078/pull/6) | `feat/tt` | Not started |
| 12 | `cch-rule-084` | [#6](https://github.com/psl-izyane-cch-frms/cch-rule-084/pull/6) | `feat/maac` | Not started |
| 13 | `cch-rule-090` | [#6](https://github.com/psl-izyane-cch-frms/cch-rule-090/pull/6) | `feat/utd` | Not started |

**Branch-name collision note** (per `calibration-notes.md` standing rule 19): `cch-rule-016`'s branch is `feat/tc`, the same name `cch-rule-002` used in the calibration phase — coincidental (different rule, different feature), not the same copy-paste lineage as the `feat/iaa` pair (rule-010/011) or `feat/ots` trio (rule-006/007/008). Still worth a direct check on `cch-rule-016` for the same CI-config identity-field risk found on `feat/iaa`, since the pattern (branch reused verbatim across sibling repos) is what mattered, not the specific name.

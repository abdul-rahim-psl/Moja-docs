# PR Review Working Instructions — Rule Processors (CCH/COMESA)

Adapted from the general `pull-requests.md` methodology (designed for tazama-uat's
app-shaped repos — React/Prisma/REST) for the `psl-izyane-cch-frms` rule-processor
fleet, which has none of that surface: no endpoints, no frontend, no ORM. Read this
file before starting any review.

Sources of truth for content (no Jira access needed — Jira is generated from these):

- `Tazama_Rules_ML_Customization_FSD.md` (cchfrms-comesa, local)
- `Tazama_Rules_Developer_Configuration_Guide.md` (cchfrms-comesa, local)
- `CCH_UserStories_RuleProcessors_Typologies_v1.0.md` (cchfrms-comesa, local)

**These docs are stale on message-type scope specifically — see the platform-wide
constraint below, which overrides them on that one point.** Everything else in
them is still authoritative.

No live GitHub access from this session (no connector, no persisted credentials).
Branch handoff and PR metadata (description, comments, CI status) come from the user.

---

## 0. Preflight

1. **Confirm the branch is checked out.** Ask the user to `git fetch origin` +
   checkout the PR branch (or `git fetch origin pull/<N>/head:review/pr-<N>`) on
   their machine, in the relevant `cch-rules/<repo>` folder. Verify with
   `git branch --show-current` before reading anything.
2. **Confirm base branch.** Rule-processor PRs target `dev`. If not, flag as a
   potential blocker rather than assuming intent.
3. **Get PR metadata from the user** if relevant: PR number, description, any
   review comments already posted, CI status (screenshot or pasted text is fine).
   Don't guess at what isn't visible from the git history.
4. **Scope guardrail.** Rule-processor PRs are usually 3-5 files
   (`src/<rule>.ts`, `src/schemas/ruleConfig.ts`, `src/index.ts`, `README.md`,
   tests). If a PR is much larger than that, confirm scope with the user before
   writing a full review.
5. **Check for an existing review.** Look in `claude/pr-reviews-index.md` and at
   `claude/pr-reviews/<repo>-<branch-or-PR#>.md`. If one exists, this is a
   follow-up round — see Section 5. Otherwise this is a fresh review.

---

## 1. Setup

Save the completed review to:

```
claude/pr-reviews/<repo>-<branch-or-PR#>.md
```

and add a row to `claude/pr-reviews-index.md`. Never commit review files into the
rule-processor repos themselves — they live in the COMESA project, not in git.

---

## 2. Read the Code

Read the actual diff against the base branch — trace exact lines changed, don't
describe what code probably does. For every meaningfully changed file: read it in
full, confirm before/after state, check what the rule-executer (generic,
`cch-rules/rule-executer`) and `frms-coe-lib` actually do with what this file
produces (e.g. `determineOutcome` consumes `config.bands`; `checkRuleIdentity`
consumes `RULE_ID`).

### 2.1 Rule-processor-specific hunts

Run all of these on every PR that touches `src/`. They replace the app-shaped
hunts (Prisma parallel-siblings, React prop drift, auth-guard decorators) from
the general methodology, which don't apply here.

**FSD/story wiring hunt.** For every parameter declared in the config Zod schema
(`src/schemas/ruleConfig.ts`), grep the handler (`src/<rule>.ts`) for an actual
read of it. A parameter that validates but is never destructured/read is a
declared-but-inert gap — real, not cosmetic. Cite the FSD §/story ID from the
code's own comments where present.

This is a recurring pattern across the fleet, not a one-off — rule-001's PR #12
had four such parameters (`accountKey`, `identityResolutionViaCorrelationId`,
`identitySourceStage`, `transactionStage`); rule-002's PR #7 repeated it with its
own four (`accountKey`, `currencyScope`, `identityResolutionViaCorrelationId`,
`transactionStage`); rule-003's PR #7 repeated the exact same four as rule-001.
Treat every parameter in a rule's config schema with suspicion by default —
don't take "it validates" as evidence it's meaningful. For each one, explicitly
answer: (a) is it read anywhere in the handler, (b) if read, does what it does
match what the FSD/story says it should do, (c) if unread, is it inert because
the behavior it would gate is **already handled unconditionally elsewhere** (as
`accountKey` is fleet-wide — see the platform-wide constraint below on why — or
because it exists only for the pacs.009 FX-leg case, which is now permanently
out of scope) — in which case the fix is to **remove the parameter**, not wire
it up; or (d) is it genuinely blocked by a real, named external gap (an
unconfirmed DB column, a missing library feature) — in which case it's a
legitimate TODO and should **stay declared**, not be deleted. Don't collapse
(c) and (d) into one treatment.

**This is now a settled, fleet-wide recommendation, not a case-by-case
judgment call:** `accountKey`, `identityResolutionViaCorrelationId`,
`identitySourceStage`, and `transactionStage` (and `currencyScope`'s sibling
pacs.009-only parameters) have shown up inert on every rule reviewed so far
(001, 002, 003). Recommend removal directly as **Minor, non-blocking** —
don't re-derive the reasoning from scratch or present it as an open question
each time the same four names reappear. Flag every instance found so the
config schema doesn't keep accumulating dead surface, but don't treat it as
a new discovery.

**Message-type guard hunt.** Confirm the README's stated `Bound to` types match
the actual type guard in code, and that unsupported message types are routed to
`.err` explicitly — not silently mishandled or left to throw uncaught.

**Platform-wide constraint — settled, do not re-raise this:** only `pain.001`,
`pain.013`, `pacs.008`, and `pacs.002` are ingested fleet-wide. **No other
message type, including `pacs.009`, is handled by any rule, in any rule's
cluster, anywhere in the fleet.** This was confirmed directly by the user twice:
first specific to rule-001, then explicitly restated as a **fleet-wide** change
made **later than** the FSD and Dev Config Guide text — those documents' `008+009`
bindings (rule-002 and its whole cluster: 003, 004, 010, 011, 016, 020, 048,
054, 063) are stale on this one point and are superseded by this constraint.
This is not an open question and not a per-PR judgment call — treat it as
settled fact on every review from here on, exactly like the FSD/Dev Config
Guide's other content.

What this means in practice for a review: when a rule's code/README/comments
frame a `pacs.009` (or other unhandled-type) fallthrough-to-`.err` as a
temporary gap awaiting a library fix (the framing rule-001's and rule-002's
code originally used, written before this was clarified as fleet-wide), that
is a **Documentation Accuracy** finding, not a Spec Deviation and not
something to ask the user about — reword it, in the same review, to say the
message type is out of scope by design. Do not flag this as blocking, and do
not ask the user to confirm scope again.

**Exit-condition convention hunt.** `.x00` must be present in every config and be
the generic "insufficient data" exit. A rule-specific `.x01` etc. should not
appear outside documented exceptions (rule 018 is the one on record). Check the
schema's `.refine()` actually enforces this, not just that a comment claims it.

**Query correctness hunt** (for rules with a DB query). Every dynamic value must
be parameterized (`$1`, `$2`, ...) — never string-concatenated into SQL. Confirm
`TenantId` scoping is applied to _every_ query in the file, not just some — the
rule-processor equivalent of a guard/scope-asymmetry gap. Note whether the query
correlates through settlement status (`pacs.002`/`TxSts`) where the FSD calls for
"only settled transactions count," or counts unsettled activity (a real accuracy
gap, not just a style nit).

**Band/unit hunt.** Band thresholds must match the Dev Config Guide's units
(days vs. milliseconds is a real discrepancy found more than once across this
fleet — e.g. rule-003's PR #7 fixed exactly this) and must not gap or overlap.
Cross-check against the Dev Config Guide's band inventory for that rule.

**README-accuracy hunt.** Does the README's self-reported "known limitations"
list match what's actually still unwired in the code? Stale documentation
(claiming something works, or omitting a gap that's still there) is its own
finding, separate from the underlying gap.

**Secrets/PII-in-logs hunt.** Any new `loggerService.log/warn/error` — check it
doesn't log full transaction payloads, account IDs, or other PII beyond what's
already logged elsewhere in the codebase.

Skip hunts that don't apply to the specific diff (e.g. skip the query hunt for a
PR that only touches the config schema).

---

## 3. File Format

Same structure as the general methodology — reuse what's proven, drop what isn't
relevant here.

### Header

```markdown
# PR Review: <repo> — <branch> (<PR # if known>)

**Repo:** psl-izyane-cch-frms/<repo>
**Branch:** `<branch>` → `<base>`
**Reviewed:** <YYYY-MM-DD>
**Files touched:** <list>
```

### Traceability

```markdown
| Story ID | FSD ref | Dev Config Guide ref | Status                                       |
| -------- | ------- | -------------------- | -------------------------------------------- |
| US-R-xxx | §x.x    | §x.x                 | Implemented / Partial / Not wired / Deviates |
```

### What Changed (Detailed)

One subsection per meaningfully changed file. Show the actual diff or
before/after code, not a summary — the review must be auditable from this
section alone.

### Issues and Observations

```markdown
#### Issue N — <short title>

**Severity: Major / Minor / Informational (<category>)**

<Description, exact code, why it's wrong, the fix if there is one.>
```

Categories: Bug, Spec Deviation, Config/Logic Mismatch, Test Coverage,
Maintainability, Documentation Accuracy, Data Integrity.
`Major` = should block merge. `Minor` = recommended, not blocking.
`Informational` = pre-existing or out of scope.

### CI / Process Check

Workflow checks green? Signed commits? CODEOWNERS satisfied? (Reuses what we
already fixed fleet-wide — flag if a PR predates the sync and needs a rebase.)

### Test Coverage

What's tested, what isn't (especially the core logic change), whether the
95%-coverage gate is met. Every `Major` issue needs a matching test gap called
out if no test would catch it.

### Summary and Verdict

```markdown
**Verdict: Approved / Changes Requested**

<1-2 paragraphs.>

### Blocking

1. **<title>** — <one-sentence reason>

### Non-blocking but recommended

2. **<title>** — <one-sentence reason>
```

Binary verdict — no middle state. If there's a temptation for "approve with
cleanup," reclassify: either it's blocking (Changes Requested) or it isn't
(Approved, with a non-blocking list).

### Ready-to-paste PR Comment

Self-contained Markdown the user can paste directly into the GitHub PR — must
make sense without the full review file open. Cite exact file paths and lines.
Cap non-blocking items at 3 by default.

**Always open the comment with the verdict as its own bold first line** —
`**Verdict: Approved**` or `**Verdict: Changes Requested**` — before any
narrative. A reader (or Izyane) skimming the PR thread should see the call
immediately without inferring it from the tone of the prose below it. This
applies to every review from here on, including follow-up rounds (Section 4)
— each round's own ready-to-paste comment gets its own verdict line at the top.

**Tone: concise and professional, not wordy.** No praise framing ("nice work,"
"great catch," "well done") and no filler lead-ins. State the verdict, then
the findings as plain, direct statements — what was found, where, and what to
do about it. Positive observations about the PR (a bug genuinely fixed, good
test coverage added) belong in the full review file's "What Changed" section
if worth recording, but the PR comment itself doesn't need to editorialize —
it's a findings list for the author to act on, not encouragement.

---

## 4. Multi-round PRs

If a review file already exists for this repo/branch, append a new
`## Follow-up Review (YYYY-MM-DD)` section — never rewrite prior rounds. Each
prior item gets a Resolution Status (Resolved / Partially resolved / Not
resolved / Declined by author / Deferred), sourced from whatever the user pastes
in (new commits, author comments) since there's no live API to re-fetch from.
Triple `---` divider between rounds. Own ready-to-paste comment per round.

---

## 5. Quality Rules

- Never speculate — if you haven't read the code, say so.
- Cite specific code: file, function, line.
- Show the fix, not just the problem.
- Distinguish new issues from pre-existing ones — don't ask Izyane to fix code
  they didn't touch.
- Respect PR scope — note out-of-scope concerns as observations, not blockers.
- The ready-to-paste comment is the deliverable the user actually uses; the full
  file is the audit trail. It always leads with the verdict line and stays
  concise and professional (see Ready-to-paste PR Comment above) — no praise
  framing, no filler.
- Settled facts (like the message-type constraint and the inert-parameter
  pattern above) are not re-litigated per PR. If a new PR's evidence seems to
  contradict a settled fact, say what was found and note the conflict once —
  don't turn it into a recurring question back to the user across multiple
  reviews.

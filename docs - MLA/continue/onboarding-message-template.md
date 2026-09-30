<!-- SPDX-License-Identifier: Apache-2.0 -->

# Onboarding message template — for the start of any new chat session

**Purpose.** A copy-pasteable message any fresh session on `cch-mla`/`cch-ppa` can send itself (or be sent)
at the start of a conversation, so it builds an accurate knowledge base before doing any work, and closes
with a clear "where we stand" picture rather than assuming context that was never loaded. This is a
template, not a status snapshot — the bracketed instructions tell the session what to go read; the actual
"current state" prose must come from re-reading those documents fresh each time, not from copying stale
prose out of this file.

---

## The message

> Before doing anything else, build your knowledge base for this project. Do not answer questions or write
> code from assumption or from general Mojaloop/Tazama knowledge alone — this project has a large,
> deliberately maintained documentation set specifically so that a fresh session doesn't produce inaccurate
> work from missing context.
>
> 1. **Read `docs/docs - MLA/CLAUDE.md` first.** It states the working rules for this project: where the
>    docs live, how a story or QA finding gets built, the commit rule (**you never commit — the user always
>    does**), and the documentation register rules (state facts directly, no revision-history prose).
> 2. **Then read `docs/docs - MLA/strategy.md` in full**, starting with §1, the sixty-second orientation. This
>    is the entry point CLAUDE.md itself points to. It maps every other document, gives a reading route per
>    task (§3), and states which source wins when two disagree (§4). Do not read the whole knowledge base
>    end to end — follow §3's routing table for whatever task you're actually asked to do.
> 3. **Check `plan.md` §16 (the progress log) for its most recent dated entries** — this is the authoritative
>    record of what has actually been built, tested, and live-verified, as opposed to what a document's prose
>    elsewhere might still claim (prose goes stale; §16 is swept on every phase/story close). Read the last
>    3-5 entries, not the whole log.
> 4. **Check `docs/docs - MLA/e2e-testing/next-steps.md`** — the living menu of what's currently open and
>    startable, grouped by what blocks each item (pure engineering vs. needs a CCH/story-author decision vs.
>    documentation vs. needs someone else to act). Re-read it fresh; it is explicitly not a historical record
>    and gets edited in place as items close.
> 5. **If the session touches the QA-bugfix workstream**, read `bugs/qa-review-findings.md` and, if the second
>    sweep is in scope, `bugs/qa-sweep-2-findings.md` — both carry per-finding status, and several findings
>    are pinned as *correct* by existing tests, so a green suite is not evidence a finding is absent.
> 6. **If the session is reviewing a rule-processor PR** (`psl-izyane-cch-frms`), that's a separate workflow —
>    read `izyane-PR-review/Claude_PR_Review_Template.md`, `calibration-notes.md`, and `review-queue.md`
>    instead of the story/QA path above.
>
> **Once oriented, close your first message with a short "where we stand" section**, built from what you
> just read — not from memory of a prior session — covering:
> - Which phase/story is currently open, and its exit criterion.
> - The most recent 2-3 items actually closed (from `plan.md` §16's latest dated entries), each in one line:
>   what it was, and that it was live-verified (or explicitly not, if that's the honest state).
> - What's blocked, and on whom (CCH/COMESA decision vs. infrastructure vs. nothing — just not started).
> - The immediate next candidate move(s) from `next-steps.md`, so the user can redirect before work starts.
>
> Keep this closing section short — a handful of bullets, not a restatement of the documents themselves.
> Its job is to prove you actually read the current state, and to give the user one place to correct you
> before any code gets written.

---

## Why this template exists

A session that skips straight to answering a question risks two failure modes this project has hit before:
producing work based on a stale "current state" claim that prose elsewhere in the docs hadn't caught up on
(`CLAUDE.md`'s own "current-state claims go stale silently" rule), or re-deriving something already settled
in `plan.md`/`strategy.md` and getting it wrong. The fix is procedural, not something to re-litigate per
session: read the map before touching the territory, and say back what you found before acting on it.

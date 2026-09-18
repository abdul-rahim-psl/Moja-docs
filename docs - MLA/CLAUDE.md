# CLAUDE.md — cch-mla

Working rules for any session on the `cch-mla` work. **This file moved from `cch-mla/CLAUDE.md` to its current location, `docs/docs - MLA/CLAUDE.md`, on 2026-09-11.** `cch-mla/` — the separate repository holding the actual TypeScript + Fastify implementation — carries no documentation of its own and, since this move, no `CLAUDE.md` either. A session that opens directly in `cch-mla/` will not auto-load this file; point it here explicitly, or start from `docs/docs - MLA/` instead.

## Docs location

This file now lives alongside every document it governs, under [`/home/abdul-rahim/mojaloop/docs/docs - MLA`](.) — `strategy.md`, `plan.md`, `engineering-rules.md`, `environment-simulation.md`, `knowledge-base-stories/`, `user stories/`, `EPICS/`, `continue/` and, since [2026-09-18], `deployment/` are all in this same directory or a subdirectory of it. Every relative path in this file is relative to here, not to `cch-mla/`. Nothing about how these documents are read, written, or governed has changed — only where this file itself sits. **`deployment/` moved here from `docs/deployment/` on [2026-09-18]** — only the files specific to `cch-mla`'s own Kubernetes deployment moved; unrelated material at the old location (a separate Mojaloop-helm/ISO 20022 FX thread, a TTK testbed, `tazama-vm-deployment.md`) stayed where it was and is not part of this knowledge base. See `strategy.md` §2.8 for what moved and why.

## Start here

Read [strategy.md](strategy.md) first. It maps every document, gives a reading route per task, and records the precedence rules. Follow its routing table rather than reading the whole documentation set.

The six documents that govern this work:

| Document | Authority for |
| --- | --- |
| `strategy.md` | The index, the reading routes, precedence |
| `knowledge-base-stories/core-knowledge.md` | **What** the system must do — consolidated from the five user-story documents |
| `engineering-rules.md` | **How** we build it — binding engineering policy |
| `knowledge-base-stories/cross-reference.md` | **The POC relationship** — the seven forks (§1) and the fourteen points where capture evidence contradicts a story (§2). Read both before planning any implementation work. |
| `plan.md` | **Sequencing, what is blocked, and §16's progress log** — what gets built when, and what has actually been done |
| `environment-simulation.md` | **The local test harness** — how we verify without a DRPP environment, and the limits of what that proves |

(All paths in this table are relative to this file's own directory, `docs/docs - MLA/`.)

`user stories/` holds the five source user-story documents (`cch-crosscutting-user-stories.md` — audit, monitoring, performance, mTLS — added [2026-09-07]). They remain the requirements authority; `core-knowledge.md` is a synthesis of them, not a replacement. `EPICS/` re-splits the MLA and PII material one folder per epic, one file per story — the working unit for build work; PPA's and the crosscutting document's stories are not yet broken out there, since PPA's build is not tracked in this docs folder at all — it is a separate engineer's own repo and workspace. **A real PPA instance now exists and is reachable, confirmed live [2026-09-17]** — see `strategy.md` §1 for what was verified. **PPA's source is now available locally too** — `cch-ppa` (`/home/abdul-rahim/mojaloop/cch-ppa`, confirmed [2026-09-17]) — so this docs folder can read its implementation directly, though its story/planning tracking (if any) is still that engineer's own and not mirrored here. Do not assume anything about the *deployed* instance's live runtime state (its actual ValKey/store/DLQ contents) beyond what has been independently confirmed against it — reading the source proves what the code *should* do, not what a running instance actually did.

## The stack

**TypeScript + Fastify**, following Tazama's `tms-service` / `event-director` conventions — layout, npm script names, `tsconfig`, ESLint flat config, Prettier, SPDX headers. This matches the POC and keeps us aligned with Tazama core. It is a settled decision, not a starting point for discussion: do not introduce a different framework, runtime or build toolchain.

The four-layer structure — `interfaces/`, `services/`, `clients/`, composition root — is `engineering-rules.md` §2.1 and is not optional.

## How a story gets built

We go one story at a time. A story is not started until the previous one is done by the §13 definition.

1. **Pick the story** — from `EPICS/`, in the order [plan.md](plan.md) §15 sequences. Its `Acceptance Criteria`, `Method` and `Todos` are the spec; the `Todos` list doubles as the test checklist.
2. **Read its route** — `strategy.md` §3 has a row for it. Read that, not the whole set.
3. **Build it with its tests**, not after them. Every table row, failure path, ordering constraint and race in `engineering-rules.md` §10.2 that the story implies gets a test.
4. **Verify it live** — against the harness, real captures, a real dependency. `engineering-rules.md` §11 governs how the result is stated.
5. **Record it in `plan.md` §16** — the progress log, using the entry format given there. What was built, what the tests cover, what was proven live *versus* assumed, what diverged, what is left open.
6. **Write its two epic documents** — `executive-summary.md` and `file-register.md`, in that story's own folder. See "Epic and story documentation", below.
7. **Leave it for commit** — the documentation updated alongside the code if behaviour changed, ready for the user to commit. See "Commits", below.

`plan.md` is a living record, not a plan written once. A story with no §16 entry is not done.

**Update the checklist itself as you go, not only at the end.** After roughly every 1-2 checklist bullets' worth of work within a story, go back to both the current phase's checklist in `plan.md` (the numbered phase section, e.g. §6 for Phase 3) and its own `continue - before <phase>.md` copy, and mark which bullets now have code behind them. This is a distinct, smaller update from steps 5-7 above: it tracks *what has been written*, not what has been tested, live-verified, or is ready to call done. Never let a checked box imply more than that without saying so — annotate each one with its real state (e.g. "built, not yet tested/live-verified") rather than checking it the way a fully-closed story's checklist is checked. The full `plan.md` §16 entry and the epic documents still wait for the story to actually close (steps 5-7); this rule exists so a mid-story reader — including a fresh session — sees accurate in-progress state in the one place they'd naturally look, instead of a checklist that still reads "nothing built yet" partway through.

## Epic and story documentation

**Every piece of work under `EPICS/` produces the same two documents, at both levels: `executive-summary.md` and `file-register.md`.**

| Where | Covers |
| --- | --- |
| `EPICS/<EPIC>/<STORY>/` | That story alone, alongside its `story.md` — written as the story closes |
| `EPICS/<EPIC>/` | The epic as a whole — written when its last story closes, rolling up what the epic delivered rather than repeating each story |

**`executive-summary.md` is the *why*.** What the work set out to achieve and the purpose it served, the reasoning behind each decision that was not obvious, what was proven live *versus* assumed, what was deliberately left out, and anything the work exposed that outlives it. It is written for someone who was not in the session and needs to understand the intent, not re-read the diff. It is not a restatement of `story.md`, and it is not a changelog.

**`file-register.md` is the *what*.** A table of two core columns — **file name**, and **why it was added / what it does** — covering every file that piece of work added or changed. Each row says why the file exists; a row that only restates the filename is not worth writing. Group the table by area when it runs long.

Both are written **as the work closes, from the session that did it** — not reconstructed later by someone reading the code. A story whose two documents are missing is in the same state as one with no `plan.md` §16 entry: not done.

**Worked example:** [`EPICS/EPIC-0-Scaffolding/`](EPICS/EPIC-0-Scaffolding/). It is also the one exception to the shape above — Phase 0 precedes the first story, so it holds no `story.md` and its two documents sit at the epic level with no story folder beneath them.

**On the indexing rule.** These files are covered collectively by `strategy.md` §2.4's `EPICS/` entry and its §3 routing rows, which describe the convention once. Do not add a §2 entry per story document — that would bury the register it exists to keep readable. A *new kind* of document under `EPICS/`, or a change to this convention, is registered normally.

## Commits

**Claude never commits.** The user commits, always — this is not delegable back to a session under time pressure. Claude's job in this repository is implementation only: docs and code, staged in the working tree, described accurately in the session, and left there. Do not run `git commit`, `git push`, or anything else that changes repository history, regardless of how small or how clearly the change follows from an already-agreed plan.

## External decisions — build anyway, but never bury them

A recurring shape in this project: a question surfaces that is not engineering's to answer — a CCH call, CCH Legal, COMESA, a named business owner — but the code it touches can still be built. Two different bars apply, and conflating them is the mistake to avoid:

- **Can the mechanism be built and live-verified?** Usually yes, even with the decision open. Build against a stated, reversible default — a config flag, not a hardcoded choice — the same way Phase 3 built against its own recommended default for D3, and Phase 4 builds fail-closed by default while CCH's PII fail-mode answer is pending.
- **Can the phase/story be called done** (the `plan.md` §16 definition, the epic docs)? Not if the open decision changes what "done" can honestly claim — see [`plan.md`](plan.md) §7.1/§7.2 for the worked example. Record the work as "built and verified against the recommended default, decision pending X," never as silently complete and never as the decision silently resolved one way.

**Surface every one of these to the user as they're found — do not resolve them quietly and keep going.** The moment a decision turns out not to be engineering's to make, say so explicitly, in the session, right then: name the decision, who it belongs to, whether it blocks starting/continuing the build or only blocks formally closing it, and the recommended default being built against in the meantime. This applies equally whether the decision was already on record (the PII fail-mode) or is newly discovered mid-implementation — flag it either way, rather than letting it pass unremarked because the build itself isn't blocked.

## The indexing rule

**Every document added to `docs/docs - MLA` (the top-level `mojaloop/docs/docs - MLA`, not anything under `cch-mla/`) must be registered in `strategy.md` §2 in the same commit that creates it — never later.**

The entry must state:

1. The filename, bolded, as it appears on disk.
2. What it contributes that nothing else does — its distinct significance, not a restatement of its title.
3. Which sections a reader is most likely to need, when the document is long enough that reading it end to end is wasteful.
4. Its approximate length, so a reader can budget context.

Then add it to `strategy.md` §3's routing table against whatever task it serves. A document nobody is routed to is a document nobody reads.

The same applies to `user stories/`: a new source document is registered in `strategy.md` §2.2, with its epic/story range and its review findings, in the commit that adds it. When a new source document arrives, `core-knowledge.md` is cross-referenced against it rather than assumed to already reflect it.

## Engineering policy

`engineering-rules.md` is binding. Read it once in full before writing code. Its ten non-negotiables (§1), the anti-pattern list (§14), and the live-verification rule (§11) apply to every change.

Four that come up constantly:

- **Prove it live.** A design is a hypothesis until it has been run. Never present unit-tested work as verified, and say plainly when something could not be verified.
- **Above 95% Jest coverage and zero lint errors, enforced mechanically** — `coverageThreshold: 96` in the Jest config and a CI gate, not a promise anyone has to remember. Coverage is a floor, not the goal: every table row, failure path and race gets its own test.
- **SOLID, calibrated.** A pattern earns its place by removing pain that exists in this codebase today. Decouple I/O and policy; do not decouple the ISO field mappings from their builders.
- **Why-comments are short — 1-3 lines, one reason, every time new code is written, not just on a cleanup pass.** `engineering-rules.md` §5 caps this explicitly after the pattern recurred: a multi-paragraph JSDoc block re-litigating alternatives tried, chaining through `core-knowledge.md`/`qa-review-findings.md`/other files' own comments, or narrating how something was live-verified. That reasoning belongs in the story's `executive-summary.md`, not inline. This applies to every new comment written from here on, not only to comments already flagged for shortening — the instruction to shorten existing comments is not a one-time pass to revert to old habits on the next story.

## Documentation register

- Documents state facts directly. No revision history in prose — no "earlier drafts said…", no "this was changed from…".
- When a design decision changes, the document changes with the code, in the same commit.
- Where `core-knowledge.md` disagrees with a source story document, the story document wins and `core-knowledge.md` is corrected.
- **"Current state" claims go stale silently — sweep for them on every phase/story close.** After Phase 0 closed, `plan.md` §1, `strategy.md` §1 and `README.md`'s status section all still said implementation had not started, because writing the `plan.md` §16 entry and the epic docs does not itself touch the orientation prose elsewhere that made the same claim. Before calling a phase or story done, `grep -rniE "no (application )?code exists|has not started|not yet built|implementation has not started"`-style across the knowledge base and fix every live hit — not just the historical ones inside an already-superseded `continue -` doc, which are correctly left as-is.



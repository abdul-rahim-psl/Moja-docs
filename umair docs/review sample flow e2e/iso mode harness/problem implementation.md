# Implementation: Attempting to Fix the FSPIOP-Mode FX Golden Path

Status: **implemented the planned config fix, but it did not fully resolve the
gap — real root cause found, is a separate pre-existing bug in the harness's
own TTK mock-backend fixtures, not touched by this session.**
Companion to `problem.md` (the blocker), `problem plan.md` (the plan this
executes), and `iso mode harness implementation plan.md` (the plan `problem.md`
paused).

## TLDR

**We did not get the FX golden path to pass end-to-end.** The two config
fixes from `problem plan.md` were applied and tested in isolation:

- `RESOURCE_VERSIONS` (stale `1.1` scheme → current `2.0` scheme, matching
  the rest of the harness): **neutral** — no assertion count change,
  kept as a correctness fix regardless.
- `ILP_VERSION=4` (absent → added, matching the SDK's own ISO+FXP reference
  config): **made things worse** — regressed 70/77 → 61/77 and broke
  `POST /fxQuotes` in a new way (silent timeout instead of a fast error).
  Reverted.

With `ILP_VERSION` reverted, we're back to the exact 70/77, `fxTransfers`
3/8 signature from `problem.md`. Digging into `fx-provider1-sdk`'s actual
inbound handler logs and the real `sdk-scheme-adapter` source at the pinned
tag (`v24.19.7`, fetched from GitHub), the real bug is **a hardcoded, static
UUID in the harness's own TTK mock-backend response fixture for
`POST /fxQuotes`** (`docker/ml-testing-toolkit/spec_files/rules_response/default.json`,
rule index 4) — it always returns the same fixed `conversionTerms.conversionId`
regardless of the real request, which breaks the SDK's later cache lookup
when processing the matching `POST /fxTransfers`. This is unrelated to SDK
version, ISO mode, `RESOURCE_VERSIONS`, or `ILP_VERSION` — it is a data-fixture
authoring bug, most likely never noticed because nobody had run this specific
path to a clean pass before (consistent with `problem.md`'s finding that this
was never actually working).

**Net repo state after this session**: only the `RESOURCE_VERSIONS` fix
(1 line × 3 files) is kept, as a genuine correctness improvement with no
downside. `ILP_VERSION` was tried, found harmful, and reverted — the repo is
not left with it. No ISO-mode changes were made. Full stack currently up and
running (`ml-core` compose project) for continued investigation next
session.

## What was implemented

Per `problem plan.md` Step 1, in all three FX SDK env files
(`envs/fx-provider.env`, `envs/fx-payerdfsp-sdk.env`,
`envs/fx-payeedfsp-sdk.env`):

1. `RESOURCE_VERSIONS="transfers=1.1,participants=1.1"` →
   `RESOURCE_VERSIONS="transfers=2.0,participants=1.1,quotes=2.0,parties=2.0,fxQuotes=2.0,fxTransfers=2.0,transactionRequests=2.0"`
   — **kept**.
2. `ILP_VERSION=4` added — **tested, found to regress the suite, reverted**.

## Environment notes (operational, for next time)

- The harness's actual `docker compose` **project name is `ml-core`**, not
  `ml-core-test-harness` (the directory name, which `docker compose` would
  otherwise default to). All containers are labelled
  `com.docker.compose.project=ml-core`. Any `docker compose` command run
  from this directory without `-p ml-core` operates on an empty/wrong
  project view (`docker compose ps` returns nothing, `up` fails with name
  conflicts against the real containers). Always pass `-p ml-core`
  explicitly. This wasn't previously documented in `problem.md` or the
  implementation plan and cost some time to discover.
- At the start of this session the entire stack was present but fully
  stopped (`Exited`), not torn down — same ~stale-container-name-conflict
  pattern `problem.md` described previously. Resolved the same way: a clean
  `docker compose -p ml-core down --remove-orphans` (safe — these are all
  disposable harness containers, distinct from the separately-managed
  `tazama-*` stack, which was confirmed untouched throughout) followed by
  `up -d` with the required profiles
  (`all-services fx-sdk ttk-provisioning-fx-sdk ttk-fx-sdk-tests`).
- The pre-existing, intentional, uncommitted `docker-compose.yml`/
  `.gitignore` diff was verified untouched before and after all work this
  session (`git diff --stat` shows only those two files plus `.env`
  unchanged from before, and the three `envs/fx-*.env` files with exactly
  the `RESOURCE_VERSIONS` line each).
- **Security note, flagged and explicitly parked per your instruction, not
  investigated further this session**: `fx-provider1-sdk`'s startup log
  once showed `◇ injected env (0) from .env // tip: ⌁ auth for agents
  [www.vestauth.com]` where the other two FX SDK containers showed normal
  `dotenv` startup tips (`⌘ multiple files`, `⌘ custom filepath`, etc.). On
  a second read of the same container's logs, this had rotated to a
  different (unremarkable) tip. This is consistent with `dotenv`'s own known
  behavior of rotating through a list of promotional startup tips at
  random — the odd one is very likely a real (if oddly-worded) dotenv tip
  entry, not evidence of tampering, but this was not conclusively verified
  against dotenv's actual source/changelog. Worth a two-minute check next
  time before fully dismissing it, but not something that blocked or
  affected this session's findings.

## Test results, in order

| Run | `RESOURCE_VERSIONS` | `ILP_VERSION` | Total | `fxQuotes` | `fxTransfers` | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Baseline (`problem.md`, prior session) | old (`1.1`) | absent | 70/77 | 8/8 | 3/8 | Reference point |
| This session, both fixes applied | new (`2.0` scheme) | `4` | 61/77 | **0/8 (timeout)** | 0/8 | **Regression** — `ILP_VERSION=4` breaks `fxQuotes` in a new way |
| This session, `ILP_VERSION` reverted | new (`2.0` scheme) | absent | 70/77 | 8/8 | 3/8 | Back to baseline signature exactly — `RESOURCE_VERSIONS` alone is neutral |

The middle row is the important negative result: adding `ILP_VERSION=4`
(the SDK's own ISO+FXP reference value) doesn't just fail to help, it turns
a fast, deterministic `fxQuotes` failure-then-continue into a silent
20-second callback timeout — worse for iteration speed and masking the real
`fxTransfers` issue further. **Do not carry `ILP_VERSION=4` forward into
FSPIOP-mode testing.** It may still be correct for ISO mode specifically
(untested) — that's a separate question for when ISO mode work resumes.

## Root cause of the remaining `POST /fxTransfers` failure (confirmed, not yet fixed)

Traced end-to-end via direct source inspection of `mojaloop/sdk-scheme-adapter`
at the exact pinned tag `v24.19.7` (fetched live via `gh api
repos/mojaloop/sdk-scheme-adapter/contents/...?ref=v24.19.7`, not guessed or
recalled) plus the harness's own TTK mock rule config:

1. The TTK golden-path test
   (`docker/ml-testing-toolkit/test-cases/collections/tests/fx/golden_path/feature_tests/happy_path/fx_tests.json`)
   generates a fresh random UUID for `conversionTerms.conversionId` on the
   `POST /fxQuotes` step, then — correctly, matching the SDK's own internal
   assumption (see next point) — threads
   `{$prev.4.callback.body.conversionTerms.conversionId}` into the
   `commitRequestId` field of the later `POST /fxTransfers` step.
2. `sdk-scheme-adapter`'s `InboundTransfersModel.postFxQuotes` (source:
   `modules/api-svc/src/lib/model/InboundTransfersModel.js:629-678`) caches
   in-flight fxQuote state keyed by `conversionId`, where that key comes from
   `dto.js`'s `fxQuoteRequestStateDto` (`modules/api-svc/src/lib/dto.js:46-53`):
   `conversionId: request.body.conversionTerms.conversionId` — i.e., keyed on
   the **real, original request's** conversionId. The source has its own
   comment confirming this is a deliberate (if fragile) design assumption:
   `// assume commitRequestId from fxTransfer should be same as
   conversionTerms.conversionId from fxQuotes`.
3. The SDK's outbound callback body is built by `shared.js`'s
   `internalFxQuoteResponseToMojaloop` (`modules/api-svc/src/lib/model/lib/shared.js:729-733`),
   which passes the backend's response through almost verbatim (stripping
   only `homeTransactionId`) — it does **not** re-inject or guarantee the
   original request's `conversionId` into the response.
4. **The break**: the harness's own TTK mock-backend fixture for
   `POST /fxQuotes` — the very thing `fx-provider1-sdk`'s
   `BACKEND_ENDPOINT` (`mojaloop-testing-toolkit:4040/backend`) calls out
   to, since this harness has no separate real FXP backend — is a
   **hardcoded, static, non-templated response**
   (`docker/ml-testing-toolkit/spec_files/rules_response/default.json`,
   rule index 4, `"description": "post /sdk-backend/fxQuotes"`):
   ```json
   "conversionTerms": {
     "conversionId": "581f68ef-b54f-416f-9161-ac34e889a84b",
     ...
   }
   ```
   This literal value is returned for **every** `POST /fxQuotes` request,
   regardless of what `conversionId` the real request actually carried —
   confirmed by the fact that this exact UUID is the same
   `commitRequestId` that shows up failing in `fx-provider1-sdk`'s logs
   across multiple different test runs.
5. Consequence: the test's `POST /fxTransfers` step ends up sending the
   **mock's fixed value**, not the real conversionId the SDK cached state
   under. `loadFxState(commitRequestId)`
   (`InboundTransfersModel.js:1283-1288`) misses the cache entirely, `this.data?.fxQuote`
   is falsy, and `postFxTransfers` throws `Corresponding fxQuote not found
   for commitRequestId ${body.commitRequestId}` (`InboundTransfersModel.js:686-688`).
   That's the real content behind the `"err":{}` empty-looking log line
   `problem.md` originally flagged — a real `Error` object, just serialized
   to `{}` by the logger (a well-known Winston/pino quirk:
   `JSON.stringify(new Error())` drops `message`/`stack` unless a replacer
   is used), not literally an empty error.
6. The SDK's own error-response path then hits the *second*, independently
   real bug `problem.md` also flagged: its auto-generated
   `PUT /fxTransfers/{id}/error` body fails the SDK's own inbound schema
   validation (`extensionList` value over `maxLength: 128`) — confirmed
   still present, unchanged, in this session's logs too. This second issue
   is downstream noise on top of the real (1)-(5) cause above, not a
   separate root cause in its own right — fixing (4) would very likely make
   this one moot for the golden path, since the flow would never reach the
   error-formatting code path in the success case.

**This is confirmed to be a harness fixture bug, not an SDK bug, not a
version/config bug, and not something ISO mode caused or will fix.** The
other mock rule in the exact same file for `POST /fxTransfers` (rule index
5, `"description": "FXP - post /fxTransfers response"`) correctly uses
dynamic templating (`"homeTransactionId": "{$request.body.homeTransactionId}"`)
to echo request data back — proving the templating capability needed to fix
rule index 4 the same way already exists and is already used elsewhere in
this exact file. This was very likely an authoring oversight when rule
index 4 was originally written, not a deliberate or structural limitation.

## Why this wasn't fixed in this session

Per your explicit direction, mid-investigation: once the mock-fixture root
cause was confirmed, I asked whether to attempt the fix (retemplate rule
index 4's `conversionId` to `{$request.body.conversionTerms.conversionId}`,
matching rule index 5's pattern) in this same session, or stop and document.
You chose to stop and document — so no attempt was made at that fix, and
`docker/ml-testing-toolkit/spec_files/rules_response/default.json` is
untouched.

## Current repo/environment state (end of session)

- `git diff --stat` in `ml-core-test-harness`:
  - `.env`, `.gitignore`, `docker-compose.yml` — pre-existing, untouched
    (verified byte-identical to session start).
  - `envs/fx-provider.env`, `envs/fx-payerdfsp-sdk.env`,
    `envs/fx-payeedfsp-sdk.env` — 1 line changed each (`RESOURCE_VERSIONS`
    only; `ILP_VERSION` was added, tested, and removed again within this
    session, so it does **not** appear in the final diff).
- Docker: full stack up under compose project `ml-core` (profiles
  `all-services`, `fx-sdk`, `ttk-provisioning-fx-sdk`, `ttk-fx-sdk-tests`
  all active), `fx-provider1-sdk`/`fx-payerdfsp-sdk`/`fx-payeedfsp-sdk`
  running with the final (`RESOURCE_VERSIONS`-only) env, last recreated
  during this session.
- No ISO-mode (`API_TYPE`) changes anywhere — out of scope for this plan
  and still not started, per `iso mode harness implementation plan.md`
  Step 3.

## Answering your original question directly

**Did we successfully run the cross-border FX flow end-to-end?** No — not
in this session, and not yet in FSPIOP mode, which was the prerequisite
before even attempting ISO mode. The blocker is now precisely identified
and narrow (one hardcoded value in one mock-response rule file), rather than
the fuzzier "something about POST /fxTransfers is broken" state `problem.md`
left off at. It's a small, mechanical fix — not a deep architectural problem
— but it hasn't been applied or verified yet.

## Recommended next step (not yet executed, needs your sign-off per this session's stopping point)

1. In `docker/ml-testing-toolkit/spec_files/rules_response/default.json`,
   rule index 4 (`"post /sdk-backend/fxQuotes"`): change
   `"conversionId": "581f68ef-b54f-416f-9161-ac34e889a84b"` to
   `"conversionId": "{$request.body.conversionTerms.conversionId}"`,
   matching the templating style already used in rule index 5 in the same
   file. Worth a quick check of whether any *other* fields in that same
   canned response (`initiatingFsp`, `counterPartyFsp`, amounts) are also
   silently mismatched against the real request in ways that could surface
   as the *next* failure once this one is fixed — the fixture was clearly
   authored as a static example response, not a templated one, so it's
   worth a full read-through rather than a single-field patch.
2. Re-run `ttk-fx-sdk-tests` (`RESOURCE_VERSIONS` fix already in place,
   `ILP_VERSION` still absent) and confirm `fxTransfers` reaches 8/8 and the
   final transfer reaches `COMMITTED`.
3. Only once that's a clean 77/77 pass does it make sense to resume
   `iso mode harness implementation plan.md` Step 3 (`API_TYPE=iso20022`) —
   unchanged from what `problem.md` and `problem plan.md` already
   concluded, just with a more specific, smaller fix identified for what
   stands in the way first.

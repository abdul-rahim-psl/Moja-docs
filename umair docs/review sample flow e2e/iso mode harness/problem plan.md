# Plan: Fix the FSPIOP-Mode FX Golden Path Before Resuming ISO Mode Work

Status: **plan for review — nothing implemented yet.**
Companion to `problem.md` (the blocker this plan resolves), `iso mode
harness implementation plan.md` (the step-by-step plan `problem.md` paused),
and `iso mode harness.md` (the original investigation), all in this folder.

## TLDR

`problem.md` found that our FX golden path (`ttk-fx-sdk-tests`) has never
actually passed on `ml-core-test-harness`, in any SDK version — the
`POST /fxTransfers` step fails regardless. This isn't a version-bump
regression and it isn't a missing capability in the switch services
(central-ledger, quoting-service, ml-api-adapter all have real fxTransfer/
fxQuote/ISO support already). It's stale config: our three FX SDK env files
(`envs/fx-provider.env`, `fx-payerdfsp-sdk.env`, `fx-payeedfsp-sdk.env`)
were only ever touched once, in the original FX-support commit, and never
updated when the rest of the harness's SDK envs moved to a newer
`RESOURCE_VERSIONS` scheme and gained an explicit `ILP_VERSION`. Git history
also shows FX flows genuinely worked here before (`feat: fx e2e scenario`,
a whole k6 FX perf-test suite) — so this reads as drift, not a structural
gap.

**The plan**: add the two missing settings (`RESOURCE_VERSIONS`,
`ILP_VERSION`) to the three FX SDK env files, matching the SDK's own working
reference config, re-run `ttk-fx-sdk-tests` in FSPIOP mode (no ISO changes
at all), and confirm `POST /fxTransfers` reaches 8/8 and the transfer
reaches `COMMITTED`. Once that's a clean pass, the original implementation
plan's Step 3 (flip `API_TYPE=iso20022`) can resume on a trustworthy
baseline. If the fix doesn't fully close the gap, narrow it further before
touching anything ISO-related — never layer ISO mode on top of an
unattributable failure.

## Ground truth verified today (2026-07-28)

- `ml-core-test-harness` is on branch `feature/iso20022-fx-harness`, same
  pre-existing uncommitted `docker-compose.yml`/`.gitignore` changes as
  before, untouched.
- `.env`: `SDK_SCHEME_ADAPTER_VERSION=v24.19.7` (left at the
  best-performing tag from `problem.md`'s bisection).
- Other pinned core service versions (unchanged by any of this):
  `ML_API_ADAPTER_VERSION=v16.4.2`, `ACCOUNT_LOOKUP_SERVICE_VERSION=v17.9.1`,
  `QUOTING_SERVICE_VERSION=v17.8.0`, `CENTRAL_LEDGER_VERSION=v19.4.4`,
  `TEST_TTK_SVC_VERSION=v18.11.2`.
- **The capability is real, not missing**, confirmed by reading the actual
  source at these pinned versions:
  - `central-ledger`: full `fxTransfer` domain — `src/models/fxTransfer/*`,
    `src/domain/fx/cyril.js`, `src/domain/position/fx-prepare.js`,
    `fx-fulfil.js`, `fx-timeout-reserved.js`, a dedicated
    `FxFulfilService.js`.
  - `quoting-service`: `src/model/fxQuotes.js`, ISO swagger specs including
    `QuotingService-swagger_iso20022.yaml` and
    `fspiop-rest-v2.0-ISO20022_quotes.yaml`.
  - `ml-api-adapter`: `src/api/transfers/handler.js` branches on `isFx` and
    selects `TransformFacades.FSPIOPISO20022.fxTransfers` — ISO transform
    support for fxTransfers is already wired into this exact pinned version.
- **The break is isolated to three env files**, confirmed by direct diff:
  - `envs/fx-provider.env`, `envs/fx-payerdfsp-sdk.env`,
    `envs/fx-payeedfsp-sdk.env` all currently set
    `RESOURCE_VERSIONS="transfers=1.1,participants=1.1"` and have **no**
    `ILP_VERSION` key at all.
  - `envs/testfsp1-sdk.env` (our non-FX P2P reference) sets
    `RESOURCE_VERSIONS="transfers=2.0,quotes=2.0,participants=1.1,parties=2.0,transactionRequests=1.1"`
    and `ILP_VERSION=1` explicitly. `envs/payerfsp-sdk.env` matches.
  - The SDK's own working ISO+FXP functional-test reference config
    (`test/func_iso20022/config/sdk-ttkfxp/api-svc.env` in the
    `sdk-scheme-adapter` repo, per the prior investigation) uses
    `RESOURCE_VERSIONS="transfers=2.0,participants=1.1,quotes=2.0,parties=2.0,fxQuotes=2.0,fxTransfers=2.0,transactionRequests=2.0"`
    and `ILP_VERSION=4`.
- **This is confirmed drift, not a file that was never meant to be
  touched.** `git log --oneline -- envs/fx-provider.env
  envs/fx-payerdfsp-sdk.env envs/fx-payeedfsp-sdk.env` shows exactly one
  commit ever: `51b8acf feat: add fx, interscheme and ISO 20022 support
  (#92)`. `git log -p --follow -- envs/testfsp1-sdk.env` shows the P2P envs
  were separately bumped to the `2.0` `RESOURCE_VERSIONS` scheme in a later
  commit that never touched the FX envs.
- **FX flows have demonstrably worked in this repo before**, per
  `git log --all --oneline --grep=fx -i`: `feat: add fx, interscheme and ISO
  20022 support (#92)`, `feat: fx e2e scenario (#106)`, `chore: ... get
  functional tests passing (#54)`, `feat: fx quotes changes`, plus a whole
  `packages/k6-tests` FX perf suite (`sdkFxSendE2EPool.js`,
  `sdkFxSendE2EPool.json`) that assumes a working FX send path exists. This
  is evidence of regression/drift, not a flow that was never built out.
- The TTK-side FX provisioning/test-case JSON (`fxp.json`, `fx_transfers.json`,
  the `participants_fx_sdk` collection) looks structurally sound and
  version-agnostic — no changes anticipated there.

## What this plan does NOT do

- No `API_TYPE` / ISO-mode changes anywhere. This plan is entirely scoped to
  getting the **FSPIOP-mode** FX golden path to a clean pass. ISO mode work
  resumes at Step 3 of `iso mode harness implementation plan.md`, unchanged,
  once this is done.
- No SDK version change. `v24.19.7` stays as-is; this plan tests entirely on
  top of that pin (also FX flow needs to pass here since it's the best
  option of the three tested).
- No changes to `central-ledger`, `quoting-service`, `ml-api-adapter`,
  `account-lookup-service` source or config — the gap is isolated to the
  three FX SDK env files.

## Explicit success / partial / rollback criteria

1. **Success**: `ttk-fx-sdk-tests` (`--labels std,fx,fx-sdk`) passes 77/77,
   with `POST /fxTransfers` at 8/8 and the transfer reaching `COMMITTED`.
   This becomes the new known-working baseline for
   `iso mode harness implementation plan.md` Step 3 onward.
2. **Partial**: if the two env changes improve but don't fully close the
   gap (e.g. `fxTransfers` goes from 3/8 to 6/8), diagnose the remainder
   from fresh `fx-provider1-sdk` logs before concluding anything — do not
   assume the two identified leads are exhaustive. Re-diff against the
   SDK's reference config for anything still missed.
3. **Rollback**: if the changes make things worse or introduce a new
   failure class, revert the three env file edits (see table below) back
   to their exact current content, leaving the harness exactly where
   `problem.md` left it (`v24.19.7`, FSPIOP mode, 70/77, `fxTransfers` 3/8).

## Step-by-step plan

### Step 0 — Record current state

- Capture current `ttk-fx-sdk-tests` result (70/77, `fxTransfers` 3/8) as
  the explicit "before" baseline — already recorded in `problem.md`, no
  re-run needed unless container state has drifted since.
- Record exact current contents of the three FX env files before editing
  (see "Files this plan will touch" below) so the revert table is precise.

### Step 1 — Apply the two config fixes to all three FX SDK env files

In `envs/fx-provider.env`, `envs/fx-payerdfsp-sdk.env`,
`envs/fx-payeedfsp-sdk.env`:

1. Change:
   `RESOURCE_VERSIONS="transfers=1.1,participants=1.1"`
   to:
   `RESOURCE_VERSIONS="transfers=2.0,participants=1.1,quotes=2.0,parties=2.0,fxQuotes=2.0,fxTransfers=2.0,transactionRequests=2.0"`
   (the SDK's own reference ISO+FXP value — chosen over hand-picking just
   `fxQuotes`/`fxTransfers` additions, since it's a known-working
   combination rather than a guess).
2. Add: `ILP_VERSION=4` (matching the SDK reference config; our P2P envs
   use `ILP_VERSION=1`, but the reference FXP config specifically uses `4`
   — flagged as worth confirming empirically in Step 2, not assumed
   blindly, since a mismatch here is exactly the kind of thing that could
   produce a partial rather than full fix).

**Checkpoint**: this is a config-only change to three files already
identified as stale and untouched since the original FX commit — no
services need rebuilding, only restarting.

### Step 2 — Restart FX SDK services and re-run the golden path

1. Restart `fx-provider1-sdk`, `fx-payerdfsp-sdk`, `fx-payeedfsp-sdk` (env
   file changes require a container recreate, not just a restart, to pick
   up new env vars).
2. Re-run `ttk-fx-sdk-tests` (`--labels std,fx,fx-sdk`).
3. Compare against the Step 0 baseline (70/77, `fxTransfers` 3/8).

**Checkpoint**:
- 77/77 → proceed to Step 3.
- Improved but not 77/77 → Step 2a (diagnose remainder, do not proceed to
  ISO mode yet).
- No change or worse → Step 2b (rollback, re-diagnose from scratch; the two
  leads were wrong or insufficient).

### Step 2a — If partial: diagnose the remainder

- Pull fresh `fx-provider1-sdk` (and `fx-payerdfsp-sdk`/`fx-payeedfsp-sdk` as
  needed) logs for the specific still-failing assertions.
- Re-diff our three env files against the SDK's reference config once more
  looking for anything beyond `RESOURCE_VERSIONS`/`ILP_VERSION` (e.g.
  `SUPPORTED_CURRENCIES`, `GET_SERVICES_FXP_RESPONSE`, timeout/expiry
  settings) — both are already present in our envs and were not flagged as
  gaps, but worth a fresh look once the two known ones are ruled out as the
  full story.
- Do not touch `API_TYPE` or anything ISO-related while diagnosing this —
  stay strictly in FSPIOP mode until this is fully resolved or explicitly
  scoped as "good enough to proceed with caveats," which requires your
  sign-off, not an assumption.

### Step 2b — If rollback needed

Revert the three env files to their pre-Step-1 content (table below) and
stop for reassessment — the two leads from `problem.md` would be
falsified, and the actual root cause is still open.

## Rollback table

| File | Change made | Revert |
| --- | --- | --- |
| `envs/fx-provider.env` | `RESOURCE_VERSIONS` updated, `ILP_VERSION=4` added | Restore `RESOURCE_VERSIONS="transfers=1.1,participants=1.1"`, remove `ILP_VERSION` line |
| `envs/fx-payerdfsp-sdk.env` | same | same |
| `envs/fx-payeedfsp-sdk.env` | same | same |

No changes planned to `docker-compose.yml`, `.gitignore`, `.env`
(`SDK_SCHEME_ADAPTER_VERSION` stays `v24.19.7`), or any other harness file.

## Files this plan will touch

- `ml-core-test-harness/envs/fx-provider.env` (1 line changed, 1 line added)
- `ml-core-test-harness/envs/fx-payerdfsp-sdk.env` (1 line changed, 1 line added)
- `ml-core-test-harness/envs/fx-payeedfsp-sdk.env` (1 line changed, 1 line added)
- **Not touched**: everything else — no ISO flags, no version bumps, no
  service source, no TTK collection files.

## After this plan succeeds

Resume `iso mode harness implementation plan.md` at **Step 3** (flip
`API_TYPE=iso20022` on the FX SDK envs and the four core services), now
with a genuinely known-working FSPIOP-mode FX golden path as the reference
point Step 4 needs for clean attribution.

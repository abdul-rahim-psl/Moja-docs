# What Have We Tried So Far

## What we're trying to do

Reproduce a full cross-border FX transfer end-to-end in ISO 20022 mode on
our own `ml-core-test-harness` — similar to the real DRPP production sample
(`docs/Sample flow E2E/`) — using the harness's existing `fx-sdk` topology
(`fx-provider1-sdk`, `fx-payerdfsp-sdk`, `fx-payeedfsp-sdk`, routed through
`mojaloop-testing-toolkit`).

## The problem

Before touching anything ISO-related, we tried to confirm the harness's
existing **FSPIOP-mode** FX golden path (`ttk-fx-sdk-tests`) still passes, as
a sanity baseline. **It doesn't, and never has** — `POST /fxTransfers` fails
regardless of SDK version, including the original, untouched pin. Without a
working FSPIOP-mode baseline, any ISO-mode result would be unattributable
(can't tell "ISO mode broke it" from "it was already broken").

## What we've tried

- **Bisected the SDK version** (`v24.7.0` → `v24.12.0` → `v24.19.7`) to check
  for a version-bump regression. Ruled out — all versions fail identically
  on `POST /fxTransfers`; `v24.19.7` is if anything slightly better (70/77
  vs. 61/77 on the older pins).
- **Diffed our FX SDK env files against the SDK's own working ISO+FXP
  reference config** (`test/func_iso20022/config/sdk-ttkfxp/api-svc.env` in
  `sdk-scheme-adapter`). Found two gaps: stale `RESOURCE_VERSIONS` (still on
  the old `1.1` scheme our non-FX envs moved off long ago) and a missing
  `ILP_VERSION`.
- **Applied the `RESOURCE_VERSIONS` fix** (bumped to the current `2.0`
  scheme, matching the rest of the harness). Result: neutral — no change in
  pass/fail count, but kept as a correctness fix regardless.
- **Applied the `ILP_VERSION=4` fix** (matching the SDK's reference config).
  Result: **made things worse** — regressed from 70/77 to 61/77 and broke
  `POST /fxQuotes` in a new way (silent callback timeout). Reverted.
- **Traced the real root cause via source** (fetched `sdk-scheme-adapter` at
  the exact pinned tag from GitHub, read the actual `InboundTransfersModel`
  and `dto.js` logic). Found it's a **hardcoded, static UUID in the
  harness's own TTK mock-backend fixture** for `POST /fxQuotes`
  (`docker/ml-testing-toolkit/spec_files/rules_response/default.json`, rule
  index 4) — it always returns the same fixed `conversionId` regardless of
  the real request, so the SDK's later cache lookup for the matching
  `POST /fxTransfers` misses. Confirmed unrelated to SDK version, ISO mode,
  or either of the two config fixes above.
- **Confirmed the fix pattern already exists** in the same rules file — a
  neighboring rule for `POST /fxTransfers` correctly echoes real request
  data back via templating (`{$request.body.homeTransactionId}`), so the
  broken rule is very likely an authoring oversight, not a structural
  limitation.
- **Stopped short of applying that fix**, per an explicit decision to pause
  and document rather than continue implementing in the same session.

## Where we are now

Root cause identified and narrow (one hardcoded value in one test fixture
file), but not yet fixed. Repo is left with only the `RESOURCE_VERSIONS`
correctness fix in place (3 env files, 1 line each); the harmful
`ILP_VERSION` change was reverted. No ISO-mode changes have been made
anywhere.

## Full detail

See, in this same folder: `problem.md` (original investigation),
`problem plan.md` (the fix plan), `problem implementation.md` (what was
tried and the full root-cause trace), and `iso mode harness implementation
plan.md` (the paused ISO-mode plan this all blocks).

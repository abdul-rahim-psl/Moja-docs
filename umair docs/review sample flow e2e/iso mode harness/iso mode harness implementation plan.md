# Implementation Plan: Cross-Border (DRPP-style) Flow in ISO Mode, Locally

Status: **plan for review — nothing implemented yet.** Builds directly on
`iso mode harness.md` in this folder (read that first for the full
investigation and rationale). This doc is the concrete, step-by-step,
checkpointed execution plan with an explicit fallback/rollback path at every
stage.

## Goal

Reproduce a flow cycle similar to `docs/Sample flow E2E/` — a cross-border
FX transfer in ISO 20022 wire mode — against our own `ml-core-test-harness`,
using the existing `fx-sdk` topology (already provisioned, currently
FSPIOP-only).

## Ground truth this plan is based on (verified today, 2026-07-27)

- Our harness's FX topology (`fx-provider1-sdk`, `fx-payerdfsp-sdk`,
  `fx-payeedfsp-sdk`, all `sdk-scheme-adapter`, profile `fx-sdk`) does **not**
  involve `mojaloop-simulator` at all — confirmed by reading every relevant
  `envs/fx-*.env` file's `PEER_ENDPOINT`/`BACKEND_ENDPOINT` (all point at
  `mojaloop-testing-toolkit`, none at `simulator`).
- `sdk-scheme-adapter` has real, released ISO 20022 support as of stable tags
  past our pinned `v24.7.0` (most recent stable: `v24.19.7`) — confirmed via
  `gh api search/code` (23 hits for `iso20022`, including a dedicated
  `api_iso20022.yaml` inbound spec and its own functional test rig).
- `quoting-service`'s ISO transform dispatch is generic across
  `quotes`/`fxQuotes` — confirmed directly in
  `quoting-service/src/lib/dto.js:66` (`transformPayloadToFspiopDto`
  branches resource type, not hardcoded to `quotes`).
- `ml-api-adapter` has explicit, dedicated `fxTransfers` ISO handling —
  confirmed directly in `ml-api-adapter/src/api/transfers/handler.js`
  (`isFx` branch selecting `TransformFacades.FSPIOPISO20022.fxTransfers`)
  and a dedicated `api-swagger-iso20022-transfers.yaml` interface file.
- **`fxTransfers` publish to the exact same `topic-transfer-prepare`/
  `topic-transfer-fulfil` Kafka topics as regular transfers** — confirmed by
  reading `ml-api-adapter/src/domain/transfer/index.js`: the topic name is
  built from `Action.TRANSFER`/`Action.PREPARE` constants via the
  `topic-{{functionality}}-{{action}}` template
  (`ml-api-adapter/config/default.json:106`), passed unconditionally
  regardless of whether the payload is a transfer or an fxTransfer — the
  `isFx` branching only affects payload shape, not topic routing.
  **`ppa-prototype` needs zero topic-list changes to capture fxTransfer
  Kafka events.**
- **fxQuotes' Kafka topic naming was not conclusively traced** — quoting-
  service's callback delivery for quotes/fxQuotes is HTTP-direct (unlike
  transfers, which route through Kafka for prepare/fulfil); where
  `topic-quotes-post`/`topic-quotes-put` (which `ppa-prototype` already
  subscribes to) actually get produced from wasn't found in the handler/model
  layers checked. Likely a shared event-logging path in
  `@mojaloop/central-services-shared`, not something specific to this repo's
  quoting-service code — **left as an open item to confirm live in Step 4**,
  not blocking the plan.
- The harness repo (`ml-core-test-harness`) already has **pre-existing,
  intentional, uncommitted local changes** (`docker-compose.yml`,
  `.gitignore` — port exposures for `central-ledger` and `kafka`, needed for
  `ppa-prototype` to reach the stack from outside Docker per its own
  README). These are not part of this work and **must be preserved
  untouched** through every step below, including rollback.

## Explicit success / fallback / rollback criteria

This is a three-outcome plan, per your instruction:

1. **Success**: the FX golden-path flow runs against `fx-sdk` with
   `API_TYPE=iso20022`, produces a `topic-transfer-prepare`/`-fulfil`
   message pair captured by `ppa-prototype`, and we can compare its shape
   (especially `extensionList`) against `docs/Sample flow E2E/`.
2. **Partial / alternative**: if the SDK version bump or ISO flag flip
   breaks something not anticipated here, fall back to the narrower
   TTK-direct approach (Option 3 in `iso mode harness.md`) — no SDK
   involvement, no version bump, just the four core services in ISO mode
   driven directly by TTK. This still answers the core question ("does
   `extensionList` reach our Kafka topics") even if the full SDK-fronted
   cross-border flow doesn't come together.
3. **Rollback**: if neither works, or the environment is left in a broken
   state we can't cleanly resolve, revert every change this plan made —
   and only those changes — back to the pre-existing state, leaving the
   harness exactly as it was before this work started (including the
   pre-existing local `docker-compose.yml`/`.gitignore` modifications,
   untouched).

## Step-by-step plan

### Step 0 — Establish a clean rollback point

Before touching anything:

- `git -C ml-core-test-harness stash` is **not** appropriate here (it would
  stash the pre-existing intentional port-exposure changes too, and risk
  losing track of them). Instead: record the current `git diff` output for
  `ml-core-test-harness` verbatim to a scratch file, so "what existed before
  we started" is captured exactly, independent of git stash/checkout
  mechanics.
- Record current `SDK_SCHEME_ADAPTER_VERSION` (`v24.7.0`, confirmed) and the
  exact current contents of every file this plan will touch (list in
  "Files this plan will touch" below), before any edit.
- No new git branch is created unless you want one — this plan tracks
  reverts file-by-file against the recorded pre-state, since the repo
  already has uncommitted changes we can't commit-and-branch around without
  first asking whether those should be committed (out of scope for this
  plan — not our change to commit).

### Step 1 — Verify the SDK version upgrade is safe

Before changing `SDK_SCHEME_ADAPTER_VERSION`, check (read-only, no changes
yet):

- Changelog/release notes between `v24.7.0` and `v24.19.7` for breaking
  changes to: SDK config schema (env var names/shapes), outbound API
  request/response shape (the three-stage `acceptParty`/`acceptConversion`/
  `acceptQuote` flow our provisioning/test collections assume), Docker image
  entrypoint/command (`yarn nx run modules-api-svc:start:debug` — confirm
  this still exists at the target version).
- Whether `v24.19.7` is confirmed to be the version the `func_iso20022` ISO
  functional tests actually run against (vs. only present on a later/
  snapshot tag) — re-check via `gh api` against the specific tag rather than
  assuming the latest stable necessarily has it, since the file's *first
  appearance* was 2025-04-22 and stable tags continued incrementing after
  that; confirm `v24.19.7`'s tree actually contains
  `modules/api-svc/src/InboundServer/api_iso20022.yaml`.

**Checkpoint**: if this surfaces a breaking change we can't absorb cheaply,
stop here and fall back to Step 1-Alt (TTK-direct, no SDK involved at all —
see "Fallback path" below) without having touched any harness file yet.

**Step 1 results (verified 2026-07-27, on branch `feature/iso20022-fx-harness`):**

- No `BREAKING` markers in the conventional-commits changelog between
  `v24.7.0` and `v24.19.7`. Entries touching related surfaces (max-socket
  config, granular outbound-transfer expiry, trace/baggage propagation, one
  reverted Dockerfile change) are all additive/non-breaking.
- Dockerfile `CMD` is byte-identical at both tags (`["yarn", "run",
  "start"]`) — not what the harness actually invokes, though.
- Harness's `docker-compose.yml` overrides the command to `yarn nx run
  modules-api-svc:start:debug` for all three FX SDK services. Confirmed this
  script still exists at `v24.19.7`
  (`modules/api-svc/package.json`'s `"start:debug"` entry, unchanged
  in shape from what's presumably at `v24.7.0`).
- `modules/api-svc/src/InboundServer/api_iso20022.yaml` confirmed present at
  `v24.19.7` (344 KB).
- `API_TYPE` confirmed as the real, live config variable — referenced in
  `config.js`, `constants.js`, `InboundServer/middlewares.js`,
  `lib/model/OutboundTransfersModel.js`, and covered by dedicated tests
  (`InboundServer-iso20022.test.js`, `OutboundTransfersISO20022.test.js`).
- **New finding, not anticipated in the ground-truth section above**: the
  SDK repo ships its own working ISO+FXP functional-test reference config at
  `test/func_iso20022/config/sdk-ttkfxp/api-svc.env` (tag `v24.19.7`). Diffing
  it against our `envs/fx-provider.env` surfaces a real gap: our three FX SDK
  env files (`fx-provider.env`, `fx-payerdfsp-sdk.env`,
  `fx-payeedfsp-sdk.env`) all set
  `RESOURCE_VERSIONS="transfers=1.1,participants=1.1"` — no `quotes`,
  `parties`, `fxQuotes`, or `fxTransfers` entries at all. The SDK's own
  reference ISO+FXP config uses
  `RESOURCE_VERSIONS="transfers=2.0,participants=1.1,quotes=2.0,parties=2.0,fxQuotes=2.0,fxTransfers=2.0,transactionRequests=2.0"`.
  For comparison, our own **non-FX** P2P SDK envs (`testfsp1-sdk.env`
  through `testfsp4-sdk.env`, `payerfsp-sdk.env`, `payeefsp-sdk.env`) already
  carry `transfers=2.0,quotes=2.0,participants=1.1,parties=2.0,...` — so this
  looks like the FX env files were simply never updated to the `2.0`
  resource-version scheme the rest of the harness moved to, independent of
  ISO mode entirely. Left as `transfers=1.1` in FX envs, `fxQuotes`/
  `fxTransfers` are very likely to be rejected or mis-negotiated regardless
  of `API_TYPE`. **Added to Step 3's scope**: update `RESOURCE_VERSIONS` in
  all three FX SDK env files alongside the `API_TYPE=iso20022` addition,
  using the SDK's own reference value above.

**Step 1 checkpoint: passed.** No breaking changes found; version bump is
safe to proceed with. One extra required change identified (RESOURCE_VERSIONS)
and folded into Step 3.

### Step 2 results (executed 2026-07-27) — checkpoint triggered, plan paused

Branch `feature/iso20022-fx-harness` created in `ml-core-test-harness`
(pre-existing uncommitted `docker-compose.yml`/`.gitignore` changes carried
over untouched, verified byte-identical diff before/after). Found and
removed ~30 stale, unlabeled, 12-day-old stopped containers from a prior
harness run that were blocking fresh container creation by name conflict —
confirmed disposable (no compose project labels, all `Exited` status,
distinct from the currently-running, untouched `tazama-*` stack) and removed
with sign-off.

Brought up the full stack (`all-services`, `fx-sdk`, `ttk-provisioning-fx-sdk`,
`ttk-fx-sdk-tests` profiles) on `v24.19.7`, still FSPIOP mode (`API_TYPE`
untouched). Ran the existing FX golden path test suite
(`--labels std,fx,fx-sdk`, 77 assertions). Result: **70/77 passed, 7 failed**,
concentrated in `POST /fxTransfers` (only 3/8 assertions passing) and its
knock-on effects (final transfer not reaching `COMMITTED`).

Root cause traced in `fx-provider1-sdk` logs: `Error in postFxTransfer` in
the SDK's `InboundTransfersModel` (empty error object logged), immediately
followed by the SDK's own auto-generated error response failing its own
schema validation (`extensionList` value exceeds `maxLength: 128`).

**Per the plan's own Step 2 checkpoint rule**, this looked like a
version-bump regression, so — bisecting to isolate it — the SDK containers
were rolled back to `v24.12.0` (the earliest tag confirmed to carry
`api_iso20022.yaml`) and retested: **same failure signature**, 61/77 passed,
`fxTransfers` 0/8 (worse, not better).

That result was surprising enough to warrant checking the actual, literal,
untouched baseline: SDK containers were rolled back to `v24.7.0` — the exact
version pinned before this work started, with no other change applied — and
retested. **Result: 61/77 passed, `fxTransfers` 0/8 — identical failure
signature to v24.12.0.**

**Conclusion: this is not a version-bump regression.** The FX golden path's
`POST /fxTransfers` step was already broken on the harness's pre-existing,
untouched configuration, before this work began. Nobody had apparently
exercised this specific path to a passing state. `v24.19.7`
(70/77) is, if anything, mildly *better* than the `v24.7.0` baseline
(61/77) — likely picking up unrelated fixes across the 12 intervening
versions — not worse. `.env` has been left at `v24.19.7` (the
best-performing, ISO-capable option of the three tested) rather than rolled
back.

**One more concrete lead, not yet acted on**: the SDK's own working
ISO+FXP reference config (`test/func_iso20022/config/sdk-ttkfxp/api-svc.env`,
used for Step 1's RESOURCE_VERSIONS comparison) also sets `ILP_VERSION=4`.
None of our three FX SDK env files set `ILP_VERSION` at all. Combined with
the already-identified `RESOURCE_VERSIONS` gap, this is a second plausible
contributor to the `fxTransfers` failure — untested, flagged for the next
investigation pass rather than assumed.

**Checkpoint status: paused for reassessment**, per explicit instruction,
rather than proceeding into Step 3 on an unresolved pre-existing failure.
The original plan assumed the FX golden path was a known-working starting
point (based on it being "the existing FX golden path" with an
`ttk-fx-sdk-tests` CI-style runner already wired up) — that assumption is
now known to be false, and needs to be resolved (or explicitly
scoped around) before ISO mode is layered on top, since ISO mode changes
would otherwise be tested against an already-broken baseline, making
results impossible to attribute cleanly.

### Step 2 — Bump the SDK version and smoke-test in FSPIOP mode (no ISO flag yet)

Isolate the version-bump risk from the ISO-mode risk by changing one
variable at a time:

1. Edit `ml-core-test-harness/.env`:
   `SDK_SCHEME_ADAPTER_VERSION=v24.7.0` → the verified target tag.
2. Bring up `--profile all-services --profile fx-sdk --profile
   ttk-provisioning-fx-sdk --profile ttk-fx-sdk-tests` (still FSPIOP —
   `API_TYPE` not touched yet) and confirm the existing FX golden path still
   passes, unchanged, on the new SDK version. This isolates "did the version
   bump break anything" from "did ISO mode break anything."

**Checkpoint**: if the existing FSPIOP FX flow breaks on the new version
alone, that's a version-compatibility problem independent of ISO mode —
revert `.env` (Step 2's only change) and stop; re-evaluate whether a
different stable tag is needed, without having touched ISO flags at all.

### Step 3 — Flip `API_TYPE=iso20022` on the FX SDK participants and the four core services

Only after Step 2 passes:

1. `envs/fx-provider.env`, `envs/fx-payerdfsp-sdk.env`,
   `envs/fx-payeedfsp-sdk.env` — add `API_TYPE=iso20022` (currently absent
   from all three, confirmed).
2. `docker/config-modifier/configs/ml-api-adapter.js`,
   `docker/config-modifier/configs/quoting-service.js`,
   `docker/config-modifier/configs/account-lookup-service.js` — add
   `"API_TYPE": "iso20022"` (currently absent from all three, confirmed).
   `central-ledger.js` needs no change (protocol-agnostic, confirmed in the
   prior investigation).
3. Restart the stack with the same profile set as Step 2.

**Checkpoint**: if services fail to start or health-check (config schema
rejection, missing ISO spec file, etc.), that isolates to the `API_TYPE`
flip specifically, with the version bump already known-good from Step 2 —
revert this step's five file edits only, leaving the Step 2 version bump in
place, and fall back to Step 1-Alt.

### Step 4 — Run the FX golden path and observe

1. First attempt: run the **existing** FSPIOP-shaped FX test collection
   (`tests/fx/golden_path/`) as-is against the now-ISO-mode services. This
   is expected to likely fail validation (bodies are FSPIOP-shaped, services
   now expect ISO-shaped) — that failure itself is informative: it confirms
   the mode switch is real and enforced, not silently ignored.
2. If it fails as expected: author or adapt ISO-shaped request bodies for
   the FX golden path steps, using the real DRPP capture
   (`docs/Sample flow E2E/06`, `07`, `10`, `11`, `14`, `15`, `16`, `17`) as
   the reference shape, and run those directly (via TTK request injection,
   or a minimal adapted TTK collection) against the ISO-mode stack.
3. **Resolve the open fxQuotes-topic question here, live**: watch
   `ppa-prototype`'s `GET /messages/topic-quotes-post` and
   `GET /messages/topic-quotes-put` during a real fxQuotes exchange to
   confirm whether fxQuotes events do or don't land on those topics (the
   static-analysis trail didn't conclusively resolve this — this is the
   fastest way to close it).

**Checkpoint**: if the core services reject ISO-shaped bodies too (deeper
incompatibility than the flag flip suggests), that's a signal Track A's
"mechanical" framing from the prior investigation missed something — stop,
document what broke, and fall back to Step 1-Alt for the narrower but still
useful signal.

### Step 5 — Capture and compare

With a successful ISO-mode fxTransfer prepare/fulfil pair flowing:

1. Pull the captured messages from `ppa-prototype` (`GET
   /messages/topic-transfer-prepare`, `GET /messages/topic-transfer-fulfil`).
2. Compare field-by-field against `docs/Sample flow E2E/16` and `17` —
   specifically confirm or refute whether `extensionList` (the finding that
   started this whole thread) appears on our own Kafka payloads the same way
   it did in the DRPP HTTP-layer capture.
3. Feed a captured message through `ppa-prototype`'s existing
   `extractPartyDataFromExtensionList()` and confirm it extracts real data
   from a genuinely locally-produced message (not just the one external
   capture file it's been verified against so far).
4. Write up the result (whichever way it goes) as a follow-up doc in this
   folder — confirms or closes the open question from
   `iso mode harness.md`.

## Fallback path (Step 1-Alt): TTK-direct, no SDK, no version bump

If any checkpoint above fails and a full SDK-fronted cross-border flow isn't
achievable cleanly:

- `API_TYPE=iso20022` on the four core services only (Step 3's second half),
  SDK version and FX-SDK `API_TYPE` changes rolled back / never applied.
- Drive quote/transfer requests directly via TTK's request-injection
  mechanism against `quoting-service`/`ml-api-adapter`/
  `account-lookup-service`, bypassing `sdk-scheme-adapter` and `simulator`
  entirely.
- This does **not** reproduce the three-stage SDK authorization gate or a
  true multi-participant FX topology, but it still answers whether
  `extensionList` reaches our Kafka topics in ISO mode — the specific thing
  motivating this whole investigation.
- If even this fails, that's a stronger signal the four core services' ISO
  support (confirmed via unit tests in the prior investigation, per
  `docs/iso-mode/iso20022 golden path flow.md`) doesn't hold up under real
  integration conditions — worth its own write-up, and grounds to stop here
  rather than push further.

## Rollback plan (if neither the main path nor the fallback works)

Every file this plan touches, and how to revert each — kept file-by-file so
the pre-existing unrelated local changes are never at risk:

| File | Change made | Revert |
| --- | --- | --- |
| `ml-core-test-harness/.env` | `SDK_SCHEME_ADAPTER_VERSION` bumped | Set back to `v24.7.0` |
| `envs/fx-provider.env` | `API_TYPE=iso20022` added | Remove the added line |
| `envs/fx-payerdfsp-sdk.env` | `API_TYPE=iso20022` added | Remove the added line |
| `envs/fx-payeedfsp-sdk.env` | `API_TYPE=iso20022` added | Remove the added line |
| `docker/config-modifier/configs/ml-api-adapter.js` | `"API_TYPE": "iso20022"` added | Remove the added key |
| `docker/config-modifier/configs/quoting-service.js` | `"API_TYPE": "iso20022"` added | Remove the added key |
| `docker/config-modifier/configs/account-lookup-service.js` | `"API_TYPE": "iso20022"` added | Remove the added key |
| Any ISO-shaped TTK collection files authored in Step 4 | New files | Delete them |

No changes are planned to `docker-compose.yml` or `.gitignore` at all — the
pre-existing local diff in those two files is never touched by this plan,
in either direction.

**Verification after rollback**: re-run
`git -C ml-core-test-harness diff` and confirm it matches exactly the
pre-state recorded in Step 0 (the two pre-existing modified files, nothing
else) — not just "no errors," but byte-for-byte the same diff as before this
work started.

## Files this plan will touch (summary, for your review)

- `ml-core-test-harness/.env` (1 line changed)
- `ml-core-test-harness/envs/fx-provider.env` (1 line added)
- `ml-core-test-harness/envs/fx-payerdfsp-sdk.env` (1 line added)
- `ml-core-test-harness/envs/fx-payeedfsp-sdk.env` (1 line added)
- `ml-core-test-harness/docker/config-modifier/configs/ml-api-adapter.js` (1 key added)
- `ml-core-test-harness/docker/config-modifier/configs/quoting-service.js` (1 key added)
- `ml-core-test-harness/docker/config-modifier/configs/account-lookup-service.js` (1 key added)
- Possibly new TTK collection/request files under
  `ml-core-test-harness/docker/ml-testing-toolkit/test-cases/collections/`
  (additive only, Step 4)
- **Not touched**: `ppa-prototype/` source (no code changes expected —
  Kafka topic list already covers what's needed per the topic-naming finding
  above; only its captured output is read, not modified)
- **Not touched**: `docker-compose.yml`, `.gitignore` (pre-existing local
  changes, explicitly preserved)

## What I need your sign-off on specifically

1. The three-outcome structure (success / fallback / rollback) and the
   checkpoints between Steps 1–4 — proceed only as far as each checkpoint
   allows, stop and report at the first one that fails, rather than pushing
   through.
2. The SDK version target — this plan names `v24.19.7` as the candidate
   stable tag but Step 1 explicitly re-verifies this before committing;
   confirm you're fine with picking the specific tag at execution time based
   on that check, rather than locking it in now.
3. That `docker-compose.yml`/`.gitignore`'s existing local modifications are
   correctly identified as out-of-scope and must be preserved as-is.
4. Whether you want a git branch/commit checkpoint created in
   `ml-core-test-harness` before Step 1 (currently planned as file-level
   diff tracking instead, per Step 0) — happy to do either.

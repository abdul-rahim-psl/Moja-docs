# Problem: The FX Golden Path Was Never Actually Working

Status: **blocker found — implementation paused for reassessment.**
Companion to `iso mode harness implementation plan.md` (the step-by-step plan
this blocked) and `iso mode harness.md` (the original investigation) in this
folder.

## What we were trying to do

Reproduce a full cross-border FX transfer end-to-end in ISO 20022 mode,
similar to the real DRPP production sample (`docs/Sample flow E2E/`), using
our own `ml-core-test-harness`'s existing `fx-sdk` topology — three
`sdk-scheme-adapter` instances (`fx-provider1-sdk`, `fx-payerdfsp-sdk`,
`fx-payeedfsp-sdk`) routed through `mojaloop-testing-toolkit`.

Per the implementation plan, Step 2 was a deliberate sanity check before
touching anything ISO-related: bump `SDK_SCHEME_ADAPTER_VERSION` (needed for
ISO support) and confirm the harness's own existing FSPIOP-mode FX golden
path test still passed on the new version, unchanged. This isolates "did the
version bump break something" from "did ISO mode break something" — two
separate risks, tested one at a time.

## What we found

The FSPIOP-mode FX golden path (`ttk-fx-sdk-tests`, `--labels std,fx,fx-sdk`,
77 assertions) **failed** on the bumped version (`v24.19.7`): 70/77 passed,
7 failed, concentrated in `POST /fxTransfers` (only 3/8 assertions passing)
and its knock-on effect on the final transfer never reaching `COMMITTED`.

Root cause traced in `fx-provider1-sdk`'s logs: `Error in postFxTransfer` in
the SDK's `InboundTransfersModel` (empty error object logged), immediately
followed by the SDK's own auto-generated error response failing its *own*
schema validation (`extensionList` value exceeds `maxLength: 128`).

This looked exactly like the version-bump regression the checkpoint was
designed to catch. So we bisected:

| SDK version | Passed | `POST /fxTransfers` |
| --- | --- | --- |
| `v24.19.7` (bumped target) | 70/77 | 3/8 |
| `v24.12.0` (intermediate) | 61/77 | 0/8 |
| `v24.7.0` (**the literal, untouched, original pin — true baseline**) | 61/77 | 0/8 |

The untouched original version fails **identically** to the intermediate
version, and *worse* than the version we were bumping to.

## The actual conclusion

**This was never a version-bump regression.** The FX golden path's
`POST /fxTransfers` step was already broken on the harness's pre-existing,
untouched configuration — before this work touched anything. Nobody had
apparently exercised this specific path to a clean pass. If anything,
`v24.19.7` is mildly *better* than the original `v24.7.0` pin (70/77 vs.
61/77), likely from unrelated fixes picked up across the 12 intervening SDK
versions — not worse.

Two concrete, unverified leads for the underlying gap, found by diffing our
FX env files against the SDK's own working ISO+FXP functional-test reference
config (`test/func_iso20022/config/sdk-ttkfxp/api-svc.env` in the
`sdk-scheme-adapter` repo):

- **`RESOURCE_VERSIONS`**: our three FX SDK env files
  (`fx-provider.env`, `fx-payerdfsp-sdk.env`, `fx-payeedfsp-sdk.env`) all set
  `RESOURCE_VERSIONS="transfers=1.1,participants=1.1"` — no `quotes`,
  `parties`, `fxQuotes`, or `fxTransfers` entries at all. Our own non-FX P2P
  SDK envs (`testfsp1-4-sdk.env`, `payerfsp-sdk.env`, `payeefsp-sdk.env`)
  already use the newer `transfers=2.0,quotes=2.0,participants=1.1,parties=2.0,...`
  scheme. The FX envs look like they were simply never updated when the rest
  of the harness moved to it — independent of ISO mode entirely.
- **`ILP_VERSION`**: absent from all three FX SDK env files. The SDK's own
  reference config sets `ILP_VERSION=4`.

Neither has been tried yet — they're leads, not a fix.

## Why this stopped the plan rather than being pushed through

Step 4 of the implementation plan was designed to run the FX golden path
*in ISO mode* and compare its result against this same FSPIOP-mode golden
path as the known-working reference point. With the reference point itself
broken, for reasons unrelated to ISO mode, any result from an ISO-mode run
would be unattributable — a new failure could mean "ISO mode doesn't work"
or could just be this same pre-existing gap resurfacing, with no way to
tell them apart. Continuing past this point without resolving or explicitly
scoping around it would have made the rest of the plan's output
untrustworthy.

## State left behind

- `ml-core-test-harness` is on branch `feature/iso20022-fx-harness`, with
  the pre-existing uncommitted `docker-compose.yml`/`.gitignore` changes
  preserved untouched (verified byte-identical diff).
- `.env`'s `SDK_SCHEME_ADAPTER_VERSION` is currently set to `v24.19.7` (the
  best-performing of the three tested) — the running containers had not yet
  been recreated to match at the time this was written; `fx-provider1-sdk`
  and peers were still running `v24.7.0` from the baseline bisection test.
- No `API_TYPE` / ISO-mode changes have been made anywhere yet. Step 3 of
  the implementation plan (flip `API_TYPE=iso20022`) has not started.
- ~30 stale, unlabeled, 12-day-old stopped containers from a prior harness
  run were found blocking fresh container creation by name conflict and
  removed (confirmed disposable, distinct from the separate, currently
  running `tazama-*` stack, which was left untouched).

## Open decision

Three ways forward, not yet chosen:

1. Try the two identified config gaps (`RESOURCE_VERSIONS`, `ILP_VERSION`)
   against the FSPIOP-mode baseline first, to see if they fix
   `POST /fxTransfers` independent of ISO mode — establishing a genuinely
   working baseline before layering ISO mode on top.
2. Treat the `fxTransfers` gap as a separate, parallel workstream and
   proceed into ISO mode anyway, accepting that the baseline is already
   imperfect and that some ambiguity in attributing future failures is
   unavoidable.
3. Pause here entirely pending further input before continuing either
   direction.

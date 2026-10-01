# Executive Summary: ISO Mode Harness Implementation Plan

**Status:** Plan for review — nothing implemented yet.

## Objective

Reproduce a cross-border (DRPP-style) FX transfer in ISO 20022 mode against
our own `ml-core-test-harness`, using the existing `fx-sdk` topology
(currently FSPIOP-only), and confirm whether `extensionList` — the finding
that motivated this investigation — reaches our own Kafka topics the same
way it did in the external DRPP capture (`docs/Sample flow E2E/`).

## Key findings grounding the plan

- Our FX topology doesn't touch `mojaloop-simulator` at all — it talks to
  `mojaloop-testing-toolkit`.
- `sdk-scheme-adapter` only gained real ISO 20022 support after our pinned
  version (`v24.7.0`); a bump to a later stable tag (candidate `v24.19.7`) is
  required and must be verified for breaking changes first.
- `quoting-service` and `ml-api-adapter` already support ISO transforms
  generically (quotes/fxQuotes, transfers/fxTransfers).
- `fxTransfers` publish to the **same** Kafka topics as regular transfers, so
  `ppa-prototype` needs **no topic changes** to capture them.
- Whether `fxQuotes` land on the existing `topic-quotes-post`/`-put` topics
  is **unconfirmed** — an open item to resolve live during execution, not a
  blocker.
- The harness repo has pre-existing, unrelated local changes
  (`docker-compose.yml`, `.gitignore` port exposures) that must be preserved
  untouched throughout.

## Approach: three-outcome plan with checkpoints

1. **Success** — ISO-mode FX golden path runs end-to-end via the SDK,
   producing a real prepare/fulfil Kafka pair to compare against the DRPP
   capture.
2. **Partial/fallback** — if the SDK bump or ISO flag breaks something,
   fall back to a narrower TTK-direct approach: flip ISO mode on the four
   core services only, drive requests directly via TTK, bypassing the SDK
   and simulator entirely. Still answers the core `extensionList` question.
3. **Rollback** — if neither works, revert every change this plan made,
   file-by-file, restoring the harness to its exact pre-existing state
   (including the untouched pre-existing local diff).

## Execution steps

| Step | Action | Checkpoint / stop condition |
| --- | --- | --- |
| 0 | Record pre-existing state (diff, versions) before any change | — |
| 1 | Verify SDK version bump (`v24.7.0` → `v24.19.7`) is safe, no code changes | Breaking change found → stop, go to fallback |
| 2 | Bump SDK version only, smoke-test existing FSPIOP FX flow | FSPIOP flow breaks → revert version, stop |
| 3 | Flip `API_TYPE=iso20022` on FX-SDK participants + 4 core services (7 file edits) | Services fail health checks → revert Step 3 only, fall back |
| 4 | Run FX golden path against ISO-mode stack; adapt request bodies to ISO shape as needed; resolve open fxQuotes-topic question live | Core services reject ISO bodies too → stop, fall back |
| 5 | Capture prepare/fulfil messages from `ppa-prototype`, compare against DRPP capture, verify `extensionList` extraction, write up result | — |

## Scope and safeguards

- **Touches:** `.env` (1 line), 3 `envs/fx-*.env` files (1 line each), 3
  `config-modifier` config files (1 key each), possibly new additive TTK
  collection files.
- **Does not touch:** `ppa-prototype/` source, `docker-compose.yml`,
  `.gitignore`.
- Every change is mapped to an explicit revert action in the plan's
  rollback table; rollback is verified by confirming the post-revert git
  diff matches the pre-existing diff byte-for-byte.

## Sign-off requested on

1. The checkpointed, stop-at-first-failure structure across Steps 1–4.
2. Deferring the exact SDK target tag to execution-time verification
   (candidate: `v24.19.7`).
3. Confirmation that the pre-existing `docker-compose.yml`/`.gitignore`
   changes are out of scope and must be preserved.
4. Whether a git branch/commit checkpoint should be created in
   `ml-core-test-harness` before Step 1, versus the currently planned
   file-level diff tracking.

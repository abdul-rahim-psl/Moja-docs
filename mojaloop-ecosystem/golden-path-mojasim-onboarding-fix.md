# Fixing FSP Callback Onboarding for the ml-core-test-harness Stack

## Problem

Running the Postman onboarding scripts (`postman/scripts/2-setup-onboarding-mojasim.sh`) against the
`Mojaloop-Local-Docker-Compose` or `Mojaloop-Local-MojaSims` environments broke `Send Quote - SEND` /
`Send Transfer - SEND` in `Golden_Path_Mojaloop.postman_collection.json`.

Root causes:

1. **Wrong onboarding path for this stack.** `ml-core-test-harness` (run via
   `docker compose --profile all-services`) has its own native provisioning job
   (`ttk-provisioning-gp`, driven by the Mojaloop Testing Toolkit). The `postman/scripts/*.sh`
   collections were written for other topologies (plain docker-compose with a generic simulator,
   or a Helm/k8s ingress deployment) and reference environment variables that don't exist — or
   don't resolve — for this stack.
2. **Corrupted callback endpoints.** `MojaloopSims_Onboarding.postman_collection.json` registers
   FSP callback URLs using `{{PAYERFSP_CALLBACK_URL}}`-style variables that aren't defined in
   `Mojaloop-Local-Docker-Compose.postman_environment.json`. Postman/newman doesn't fail on an
   undefined variable — it just POSTs the literal, unresolved string. This overwrote the correct
   internal callback URLs (e.g. `http://payerfsp-sdk:4000`) that `ttk-provisioning-gp` had already
   set for `payerfsp` / `payeefsp`, so the switch could no longer call back the FSPs.
3. **Environment/port mismatch.** `Mojaloop-Local-MojaSims.postman_environment.json` assumes an
   ingress on port 80 (e.g. `http://central-ledger.local`, no port). This docker-compose stack
   exposes services on explicit ports (`central-ledger.local:3001`, `quoting-service.local:3002`,
   `ml-api-adapter.local:3000`, etc.), so using that environment directly causes 404s.

## Solution

1. **Re-run the harness's native provisioning** instead of the Postman onboarding scripts:
   ```bash
   cd ml-core-test-harness
   docker compose --profile all-services --profile ttk-provisioning-gp up ttk-provisioning-gp
   ```
   This restores correct SDK-adapter callback URLs for `payerfsp`, `payeefsp`, `testfsp1-4`
   (verified via `curl http://localhost:3001/participants/payerfsp/endpoints`).

2. **Add the missing `/etc/hosts` entries** needed to reach the switch's public APIs from the host:
   ```
   127.0.0.1 quoting-service.local
   127.0.0.1 ml-api-adapter.local
   ```
   (`central-ledger.local`, `account-lookup-service.local`, `moja-simulator.local`,
   `sim-payerfsp.local`, `sim-payeefsp.local` were already present.)

3. **Use a merged Postman environment**:
   `postman/environments/Mojaloop-Local-Docker-Compose-Merged.postman_environment.json` —
   the working, ported `HOST_*` values from `Mojaloop-Local-Docker-Compose`, plus the
   `SIMPAYER_NAME` / `SIMPAYEE_NAME` / `SIMPAYER_MSISDN` / `SIMPAYEE_MSISDN` / `SIMPAYER_JWS_KEY` /
   `SIMPAYEE_JWS_KEY` / content-type variables from `Mojaloop-Local-MojaSims`, which
   `Golden_Path_Mojaloop`'s `Send Quote - SEND` / `Send Transfer - SEND` requests need.
   (Note: `SIMPAYER_NAME` = `payerfsp` and `SIMPAYEE_NAME` = `payeefsp` — they're the same
   participants, just referenced under different variable names in this collection.)

**Do not run `postman/scripts/2-setup-onboarding-mojasim.sh` (or any `MojaloopSims_Onboarding` /
`MojaloopHub_Setup` run) against this stack** — it will re-corrupt the callback endpoints. If it
happens again, re-run step 1 above to fix it.

## Verification

Confirmed via raw HTTP calls matching `Send Quote - SEND` / `Send Transfer - SEND` exactly:
quote round-tripped through `payerfsp-sdk` ↔ `payeefsp-sdk` with a real ILP packet/condition,
and the transfer settled with `transferState: "COMMITTED"`.

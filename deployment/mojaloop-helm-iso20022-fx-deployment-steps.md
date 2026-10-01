# Mojaloop Helm ISO 20022 FX Deployment — Steps Summary



## 1. Target environment
- Host: dedicated external machine with appropriate storage and RAM capabilities. In our case RHEL 8.10, 8 cores, 31 GB RAM, 60 GB disk.


## 2. Install the toolchain (on the host, as root)
- `kubectl` — talks to the cluster.
- `kind` — runs a real Kubernetes cluster inside Docker containers.
- `helm` — installs packaged charts.
- `helmfile` (+ `helm-diff` plugin) — orchestrates multiple `helm` installs together (the chart repo's
  own recommended local-deployment method).
- Note: `helmfile`'s release filenames embed the version, so resolve the real download URL via GitHub's
  API rather than assuming a "latest" alias.

## 3. Stand up the Kubernetes cluster
- `kind create cluster` initially failed: this RHEL 8 host runs cgroup v1, and the Kubernetes version
  `kind` defaults to refuses to start on it.
- Fix: add a `failCgroupV1: false` KubeletConfiguration patch to the `kind` cluster config — no host
  reboot or cgroup migration needed.
- Cluster config also maps host ports 80/443 into the node for ingress.
- Install the nginx ingress controller (kind's own manifest) and wait for it to report `Ready`.
- Verify independently — don't trust the tool's own success message: node `Ready`, all system pods
  `Running`, zero restarts.

## 4. Prepare the Mojaloop chart source
- Clone `mojaloop/helm` at tag `v17.2.0` — confirmed to match the target production component versions
  almost exactly (central-ledger, ml-api-adapter, quoting-service, ALS).
- Register every Helm repo the chart's dependencies need (bitnami, mojaloop, mojaloop-charts, redpanda,
  elastic, ory, etc.) **before** running the repo's `update-charts-dep.sh` — it expects repo indexes
  already cached locally. Missing repos surface only when a specific chart fails; add them as found by
  reading that chart's own `Chart.yaml`, not by guessing a "complete" list up front.
- Pull all ~50 chart dependency sets.
- Build a trimmed values file: copy the **full** ISO20022+FX+audit-topic recipe
  (`values-mojaloop-iso20022.yaml`) — **not** the `-min` variant, which strips out the FX-provider
  simulator entirely. Add two safe trims on top: disable settlement-window bookkeeping and the mobile
  "request-money" flow (neither is part of the FX corridor being tested).
- Point the `helmfile.yaml` orchestration at this trimmed values file instead of the chart's default.

## 5. Deploy (six iterations to reach a genuinely healthy state)
1. Raise Helm's wait `timeout` on both releases — a slow network image pull otherwise exceeds the
   default 5-minute wait even though the underlying deploy is fine.
2. Remove an unused Helm repo entry that timed out on every `helmfile apply` (repos are refreshed
   unconditionally, even ones no release actually uses).
3. Fix a real config collision: two central-ledger components (batch vs. non-batch position handler)
   claimed the same ingress hostname. FX only works through the batch handler, so disable the non-batch
   one.
4. Remove another unused/deprecated Helm repo reference (`stable`) causing the same timeout as step 2.
5. Discover — by checking pods individually, not just the Helm/helmfile status — that an earlier "safe"
   trim to the backend values file had disabled two components still needed in practice (a Redis the
   FX/e2e simulators use, and a Mongo the built-in test tool needs). Re-enable just those two.
6. Deploy succeeds; a few simulator pods keep restarting briefly because their dependency (Redis) came up
   after their own retry backoff had already started climbing — not a bug, they recover once enough time
   passes.
- End state, confirmed pod-by-pod: 51 pods `Running`, 1 `Completed` job, zero pods in any other state.
- Add the ingress hostnames to `/etc/hosts` on whichever machine will browse the TTK UI (pointed at the
  host's real IP, not `127.0.0.1`), since kind's port mapping binds to the host's own interface.

## 6. Confirm the target Kafka topic (`topic-event-audit`) is reachable
- Listing Kafka topics shows all normal per-action topics but not `topic-event-audit` yet — expected,
  since nothing has produced to it.
- Verified this broker auto-creates a topic on first produce by sending one throwaway test message
  directly to that topic name, seeing it appear immediately, then deleting the test message so it
  doesn't pollute later comparisons.
- Conclusion: no manual provisioning needed — the topic appears cleanly the moment real traffic flows.

## 7. Onboard test participants (Helm chart brings up switch infrastructure only, not DFSPs)
Four prerequisites, none obvious from documentation alone — found by attempting each step and reading
the actual rejection:
1. **Hub currency accounts** — create both `HUB_RECONCILIATION` and `HUB_MULTILATERAL_SETTLEMENT`
   accounts per currency before any DFSP can be registered in it.
2. **A Settlement Model** — required before a participant can hold a currency position; the correct
   schema was found in a deliberately-kept, disabled seed file in the chart repo.
3. **ISO 20022-specific FSPIOP headers for ALS party registration** — the plain header format is
   rejected; the deployment's `API_TYPE: iso20022` config expects the ISO-form media type instead.
4. **Funding** — registering participants, positions, and limits is not enough; every transfer fails
   with "insufficient liquidity" until each participant's settlement account actually has funds recorded
   in (`recordFundsIn`).
- After all four, register the payer, payee, and FX-provider DFSPs, their position/limits, callback
  endpoints, and a test payee party (MSISDN) — verified against the switch's own `/participants` list,
  not assumed.

## 8. Drive traffic and validate
- Trigger the bundled TTK ISO20022 FX-golden-path collection headlessly via the TTK backend's own admin
  API (`POST /api/outbound/template/:traceID`), since this deployment has no single front door — each
  switch component (ALS, quoting-service, ml-api-adapter) needs its own direct service URL.
- Fix collection-specific issues found along the way: supply the missing `inputValues` the bundled
  collection expects, use plain-FSPIOP headers for the initial request (the TTK's own transformer adds
  the ISO wrapper itself), and use ULIDs (not UUIDs) for IDs that map onto ISO 20022 `PmtId` fields.
- Result: party lookup, FX quote, and FX transfer requests are genuinely accepted by the real switch;
  `topic-event-audit` now holds real records from real traffic.
- Validate the captured records structurally match real production DRPP `topic-event-audit` captures —
  confirmed field-for-field on the record types compared.
- Exercise FX/transfer edge cases by hand (reject, abort, expiry, NDC breach, timeout, ILP mismatch) to
  produce error/abort/reject/timeout captures the golden path alone can't provide.


## 9. Teardown
- `kind delete cluster --name mojaloop-fx` — fully removes the cluster; nothing else on the host needs
  undoing.

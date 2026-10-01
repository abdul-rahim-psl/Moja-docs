# Mojaloop Test Switch: Deployment Runbook

The runbook for standing up the ISO 20022 + FX Mojaloop test switch (`mojaloop/helm` v17.2.0 with helmfile on kind).
For the concepts behind each step, see [`deployment-e2e.md`](deployment-e2e.md). For the earlier build this runbook
is based on, with every failure it hit, see
[`../mojaloop-helm-iso20022-fx-local-deployment-plan.md`](../mojaloop-helm-iso20022-fx-local-deployment-plan.md).

## How we work through it

- **One step at a time.** A step is done only when its **Gate** passes, and the next step starts only after that.
- **Read-only first.** Every step says whether it changes anything. Steps that change things list how to undo them.
- **Record results.** When a gate passes, copy its actual output into the step's **Result** line. A pass we didn't
  record counts as a pass we can't prove.
- **Stop on surprise.** If any output differs from what the gate expects, stop and diagnose. Don't move to the next
  step and hope it sorts itself out.
- **Pin versions.** Use the exact versions that worked before, not whatever "latest" happens to be.

---

## 0. Blockers: decide these before Step A

| # | Decision | Why it blocks | Owner |
| --- | --- | --- | --- |
| **D1** | **Which host?** | `10.0.150.69` already runs the working switch (kind cluster `mojaloop-fx`, namespace `demo`), **MLA's test rig, which consumes from that cluster** (namespace `mla`), a Tazama stack and `ml-core-test-harness`. A second kind cluster there conflicts on host ports 80/443 and competes for 31 GB of RAM. Rebuilding the existing cluster destroys the switch and the MLA rig. A new, dedicated host avoids both. | User / infra |
| **D2** | **If it's `10.0.150.69`: rebuild, or add a second cluster?** | Rebuilding is destructive and can't be undone. That needs explicit sign-off, plus a plan to redeploy the MLA rig afterwards. | User |
| **D3** | **Does the host have internet egress?** | The whole procedure downloads from GitHub, Docker Hub, `registry.k8s.io` and seven Helm repos. `10.0.150.69` **lost access to `raw.githubusercontent.com` after the first build** (plan §9.16). With no egress we need an offline method (pre-pulled images loaded with `kind load`, vendored charts), and that has **never been planned or tested**. | Infra |
| **D4** | **Who runs the commands, and how?** | Root SSH by key worked before, but the host is reachable only over VPN. A new host needs the same access set up first. | User |
| **D5** | **What does "done" mean?** | Proposed: 51/52 pods healthy, P2P transfer `COMMITTED`, full FX corridor `COMMITTED`, and `topic-event-audit` showing the same 10-stage `operation` sequence as capture `09_fx_corridor_happy_path`. Optional: party lookup works (see U4). | User |

## Not planned beforehand: open work this runbook exposes

| # | Gap | Effect | Where it lands |
| --- | --- | --- | --- |
| **U1** | **The onboarding script is lost.** `onboard.js` only ever existed in a scratchpad. The plan records the order and the payload shapes, but **not the exact list of 12 callback endpoint types** per participant. | Step J has to be rewritten and re-verified, not just re-run. | Step J |
| **U2** | **The simulator fix isn't in the chart values.** The TTK backend fetches its specs from GitHub at boot. The fix is a live ConfigMap patch, and the next `helmfile apply` overwrites it. Putting it into values is non-trivial: the chart passes those values through `toPrettyJson`. | Every redeploy must re-apply Step I. | Step I |
| **U3** | **The scripts assume the old host.** `fx-edge-case-scripts/run.sh` has `10.0.150.69`, the SSH key, namespace `demo` and the pod name written into it. | On a new host the scripts need parameterising before Step K. | Step K |
| **U4** | **Party lookup returns `3003`, root cause unknown.** `GET /parties/MSISDN/9990002001` failed before, and the FX corridor ran without the discovery step. | The discovery phase hasn't been proven on this deployment. | Step M |
| **U5** | **The tool versions are partly unverified.** `kind` "latest" resolved to `v0.34.0-alpha` with the bleeding-edge `kindest/node:v1.37.0`. The ingress manifest was taken from `main`, unpinned. The `helm-diff` version wasn't recorded. | We can't be sure of rebuilding the same setup until all versions are pinned. | Step B |
| **U6** | **Host reboot behaviour is untested.** We don't know whether the kind cluster, and the switch's state, survive a host reboot. (The PPA host lost its service on 2026-09-30 for exactly this reason.) | We'd find out during an outage instead. | Step N |
| **U7** | **Browser access is untested.** The `/etc/hosts` + ingress step for the TTK UI was never run, and it's unknown whether ports 80/443 are reachable from the laptop. | Not needed for the scripts. Only needed for the TTK UI. | Optional |
| **U8** | **The disk budget after deploy was never measured.** Earlier: 60 GB disk, 33 GB free *before* images were pulled. | The deploy could fill the disk partway through. | Step A |

Out of scope, by decision: `inter-scheme-proxy-adapter` version parity, duplicate/resend behaviour, and
settlement windows (`centralsettlement` stays disabled).

---

## Step A: Host preflight *(read-only)*

**Goal:** prove the host can run this before installing anything.

```bash
cat /etc/redhat-release; nproc; free -g; df -h /             # OS, CPU, RAM, disk
stat -fc %T /sys/fs/cgroup                                     # tmpfs = cgroup v1 (needs the kind patch, Step C)
getenforce                                                     # SELinux state
docker info --format '{{.ServerVersion}} {{.CgroupDriver}}'    # Docker present, as root
kind get clusters 2>/dev/null; docker ps --format '{{.Names}}' # what already runs here
ss -ltnp '( sport = :80 or sport = :443 )'                     # ports kind will need
for u in https://github.com https://raw.githubusercontent.com https://registry-1.docker.io/v2/ \
         https://registry.k8s.io https://dl.k8s.io https://get.helm.sh \
         https://charts.bitnami.com/bitnami/index.yaml https://mojaloop.github.io/charts/repo/index.yaml \
         https://charts.redpanda.com https://helm.elastic.co https://k8s.ory.sh/helm/charts/index.yaml; do
  printf '%-60s ' "$u"; curl -sS -o /dev/null -w '%{http_code}\n' --max-time 10 "$u" || true
done
```

**Gate:** all of the following hold.
- At least 8 cores, at least 24 GB RAM available, at least 40 GB disk free.
- Docker answers.
- Ports 80/443 are free.
- No conflicting kind cluster, unless D2 has decided otherwise.
- **Every URL** returns an HTTP code. Any code counts, because it proves the network path. Timeouts or DNS failures
  don't count.

**If it fails:** any URL failing means D3 is answered "no egress", so stop and plan the offline method. Port or
cluster conflicts go back to D1/D2.

**Result:** _

## Step B: Toolchain, pinned *(installs to `/usr/local/bin`)*

Proven versions: `kubectl v1.37.0`, `helm v3.21.4`, `helmfile v1.7.4`, `kind v0.34.0-alpha`.

```bash
export PATH=$PATH:/usr/local/bin; grep -q /usr/local/bin /root/.bashrc || echo 'export PATH=$PATH:/usr/local/bin' >> /root/.bashrc
curl -Lo kubectl https://dl.k8s.io/release/v1.37.0/bin/linux/amd64/kubectl && install -m 0755 kubectl /usr/local/bin/
curl -Lo helm.tgz https://get.helm.sh/helm-v3.21.4-linux-amd64.tar.gz && tar -xzf helm.tgz linux-amd64/helm && install -m 0755 linux-amd64/helm /usr/local/bin/
curl -Lo helmfile.tgz https://github.com/helmfile/helmfile/releases/download/v1.7.4/helmfile_1.7.4_linux_amd64.tar.gz \
  && tar -xzf helmfile.tgz helmfile && install -m 0755 helmfile /usr/local/bin/
helm plugin install https://github.com/databus23/helm-diff
# kind: check first that the tag exists at github.com/kubernetes-sigs/kind/releases (U5); if v0.34.0-alpha
# was a dev build and not a release, choose the newest stable release and write it down here.
curl -Lo kind https://github.com/kubernetes-sigs/kind/releases/download/<TAG>/kind-linux-amd64 && install -m 0755 kind /usr/local/bin/
```

**Gate:** `kubectl version --client`, `helm version`, `helmfile version`, `kind version` and `helm plugin list` all
print the pinned versions. Record the `kind` tag, and the node image its release notes list (with digest).

**Undo:** delete the binaries from `/usr/local/bin`.

**Result:** _

## Step C: Cluster + ingress *(creates kind cluster `mojaloop-fx`)*

Use `kind-config.yaml` exactly as in plan §5: the `ingress-ready=true` label, **`failCgroupV1: false`**, and port
mappings 80/443.

```bash
kind create cluster --name mojaloop-fx --config kind-config.yaml --image kindest/node:<version>@sha256:<digest>
kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/<pinned-controller-tag>/deploy/static/provider/kind/deploy.yaml
kubectl wait -n ingress-nginx --for=condition=ready pod --selector=app.kubernetes.io/component=controller --timeout=180s
```

**Gate:** `kubectl get nodes` shows `Ready`. `kubectl get pods -A` shows every pod `Running` with **0 restarts**.
The wait prints `condition met`.

**Undo:** `kind delete cluster --name mojaloop-fx`.

**Result:** _

## Step D: Chart source + dependencies *(writes `~/mojaloop-helm`)*

```bash
git clone --depth 1 --branch v17.2.0 https://github.com/mojaloop/helm.git ~/mojaloop-helm
for r in "kokuwa https://kokuwaio.github.io/helm-charts" "elastic https://helm.elastic.co" \
         "codecentric https://codecentric.github.io/helm-charts" "bitnami https://charts.bitnami.com/bitnami" \
         "mojaloop https://mojaloop.io/helm/repo/" "mojaloop-charts https://mojaloop.github.io/charts/repo" \
         "redpanda https://charts.redpanda.com" "ory https://k8s.ory.sh/helm/charts"; do helm repo add $r; done
helm repo update
cd ~/mojaloop-helm && sh update-charts-dep.sh
```

The `stable` and `incubator` repos are deliberately left out. They're deprecated and caused timeouts before.

**Gate:**
- The script exits 0.
- `ls ~/mojaloop-helm/mojaloop/charts/*.tgz | wc -l` prints **18**.
- `find ~/mojaloop-helm -name tmpcharts` prints nothing.

**Result:** _

## Step E: Values + helmfile edits *(edits files only; nothing is deployed)*

All the fixes found in the earlier build, applied **before** the first deploy instead of being discovered during it.
Run this in `~/mojaloop-helm/local-deployment-methods/helmfile/`:

1. `cp values-mojaloop-iso20022.yaml values-mojaloop-iso20022-fx-lean.yaml`. Copy the **full** file, not `-min`.
2. Append to the lean file: `centralsettlement.enabled: false`, `transaction-requests-service.enabled: false`, and
   `centralledger.centralledger-handler-transfer-position.enabled: false`.
3. Create `values-backend-fx-lean.yaml` containing `ttksims-redis.enabled: true` and `ttk-mongodb.enabled: true`.
4. In `helmfile.yaml`:
   - Point `moja` at the lean file.
   - Layer `values-backend-iso20022-min.yaml` and then `values-backend-fx-lean.yaml` onto `backend`.
   - Add `timeout: 1800` to both releases.
   - Remove the `mojaloop` repo entry, which no release uses and which timed out before.

**Gate.** Render without deploying, then inspect the output:

```bash
helmfile template > /tmp/rendered.yaml
grep -c 'AUDIT' /tmp/rendered.yaml                                  # > 0: the audit topic is turned on
grep -E '^\s+name: .*transfer-position' /tmp/rendered.yaml | sort -u  # only the -batch handler is listed
grep -E 'API_TYPE|iso20022' /tmp/rendered.yaml | head               # ISO mode is set
```

Also read `git diff` on the chart clone and confirm each change is one you intended, and nothing more.

**Undo:** `git checkout -- .`, then delete the two new values files.

**Result:** _

## Step F: Deploy `backend` only

Deploying infrastructure first means that if something fails, we know it's the infrastructure and not the services.

```bash
helmfile -l name=backend apply
kubectl get pods -n demo
```

**Gate:**
- Kafka (`kafka-controller-0`), MySQL, every Redis (including `ttksims-redis-master`) and `ttk-mongodb` are `Running`
  with 0 restarts.
- The provisioning job is `Completed`.
- `kubectl get secret -n demo ttk-mongodb` exists.

**Undo:** `helmfile -l name=backend destroy`.

**Result:** _

## Step G: Deploy `moja` + `kafka-console`

```bash
helmfile -l name=moja apply && helmfile -l name=kafka-console apply
kubectl get pods -n demo --no-headers | awk '{print $3}' | sort | uniq -c
```

**Gate:** **51 `Running`, 1 `Completed`, nothing else.** Simulators may crash-loop for a few minutes while Redis
starts (a known race), so wait about 5 minutes and check again before calling it a failure. Any pod still not
`Running` after that has to be diagnosed with `kubectl describe` and `kubectl logs` before we go on.

**Result:** _

## Step H: Baseline health *(read-only)*

```bash
kubectl exec -n demo kafka-controller-0 -- kafka-topics.sh --bootstrap-server localhost:9092 --list
kubectl exec -n demo moja-ml-testing-toolkit-backend-0 -- node -e 'require("http").get({hostname:"moja-centralledger-service",path:"/participants",headers:{Accept:"application/json"}},r=>{let d="";r.on("data",c=>d+=c);r.on("end",()=>console.log(d))})'
```

**Gate:**
- The topic list includes `topic-transfer-prepare`, `topic-transfer-position-batch`, `topic-transfer-fulfil` and
  `topic-notification-event`.
- `topic-event-audit` is **absent**. That's expected, because nothing has produced to it yet.
- `/participants` returns **only `Hub`**. That's expected too: no DFSPs are onboarded yet.

**Result:** _

## Step I: Simulator backend fix *(patches one ConfigMap)*

Copy [`../ttk-sim-offline-specs/`](../ttk-sim-offline-specs/) to the host. Then use `kubectl patch --type merge` on
the **three** URL keys in ConfigMap `moja-e2e-sim-ttk-backend-config-default`, and leave its other three keys
untouched. Restart the backend afterwards: `kubectl delete pod -n demo moja-e2e-sim-ttk-backend-0`. The method is in
plan §9.20–9.21.

**Gate:** both ports start:

```bash
kubectl logs -n demo moja-e2e-sim-ttk-backend-0 -c ml-testing-toolkit-backend | grep -i 'started on port\|running on'
```

It must show **both 5050 and 4040**. If only 5050 appears, the fix has failed, even though the pod reports `1/1 Running`.

**Undo:** `helmfile -l name=moja apply` restores the chart's ConfigMap.

**Result:** _

## Step J: Onboarding *(writes ledger and ALS state; U1, so the script must be rewritten)*

Rewrite `onboard.js` into `fx-edge-case-scripts/`, reusing `fxlib.js`'s `send()`. Run it **one sub-step at a time**,
and check each sub-step's gate before the next one.

| Sub-step | Call | Gate |
| --- | --- | --- |
| J1 Hub accounts | `POST /participants/Hub/accounts` with `{currency, type}` × (`XXX`,`XTS`) × (`HUB_RECONCILIATION`,`HUB_MULTILATERAL_SETTLEMENT`) | `GET /participants/Hub/accounts` lists all 4 |
| J2 Settlement model | `POST /settlementModels`, `name: DEFAULTNET`, no `currency`; NET / MULTILATERAL / DEFERRED, POSITION / SETTLEMENT | `GET /settlementModels` lists it |
| J3 Participants | `POST /participants` for `e2e-sim1`, `e2e-sim2` (`XXX`) and `e2e-sim-fxp1` (`XXX`+`XTS`); then `initialPositionAndLimits` (NDC, with `alarmPercentage`) | `GET /participants` lists 4 participants, each with POSITION + SETTLEMENT accounts |
| J4 Callbacks | `POST /participants/{name}/endpoints` → `http://moja-<sim>-sdk:4000`. Candidate types, from central-ledger v19.14.0: `PARTICIPANT_PUT(_ERROR)`, `PARTIES_GET/PUT/PUT_ERROR`, `QUOTES`, `TRANSFER_POST/PUT/ERROR`, `FX_QUOTES`, `FX_TRANSFER_POST/PUT/ERROR` (each prefixed `FSPIOP_CALLBACK_URL_`) | `GET /participants/{name}/endpoints` returns the full list for each DFSP |
| J5 ALS party | `POST /participants/MSISDN/9990002001` to ALS with ISO media type `application/vnd.interoperability.iso20022.participants+json;version=2.0`, `FSPIOP-Source: e2e-sim2` | `202`, and `GET /participants/MSISDN/9990002001` returns `e2e-sim2` |
| J6 Funds-in | `./run.sh s_fund.js` | Every settlement account shows a balance (credits display as **negative**) |

The J4 list is a candidate taken from the central-ledger source, not a recorded fact. It becomes confirmed only when
Steps K and L pass. Commit the script as soon as it works, so it can't be lost again.

**Undo:** onboarding has no clean undo. Rolling it back means redeploying (Steps F–I).

**Result:** _

## Step K: P2P smoke test

Parameterise `run.sh` first if this is a new host (U3). Then run `./run.sh s_xfer_happy.js` and
`./audit.sh <transferId>`.

**Gate:**
- The transfer is **`COMMITTED`**.
- The payer's position moves by the amount.
- `topic-event-audit` now **exists** and holds `prepareTransfer` → `fulfilTransfer`/`commitTransfer` records for that ID.

**Result:** _

## Step L: FX corridor

Run `s_fx_corridor_step1.js`, then `s_fx_corridor_step2.js`, then `s_fx_corridor_step3.js`. Each script needs the
IDs printed by the one before it, so carry them across. See the scripts' README.

**Gate:**
- The FXP auto-answers with real conversion terms. A `2001` here means Step I's fix isn't in place.
- The `fxTransfer` and the final transfer are both `COMMITTED`.
- The `operation` sequence on `topic-event-audit` matches capture `09_fx_corridor_happy_path`.

**Result:** _

## Step M: Discovery *(optional; see D5 and U4)*

Send `GET /parties/MSISDN/9990002001` from `e2e-sim1`.

**Gate:** a `PUT /parties` callback reaches the payer with `e2e-sim2`'s party details. If it returns `3003`, treat it
as a separate diagnosis task. It doesn't block calling the rest of the runbook done.

**Result:** _

## Step N: Close-out

1. **Reboot test (U6), only if the host is ours to reboot.** Reboot, then re-run the Gates for Steps G, H and I.
   Record what survived and what didn't.
2. Record the pinned versions, the Result lines and any deviations in this file. Then update the plan's "Current
   status" section.
3. Teardown when finished: `kind delete cluster --name mojaloop-fx`. It removes everything, and nothing on the host
   needs undoing.

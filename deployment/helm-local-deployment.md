# Helm Local Deployment: Single-Node, DRPP-Like Mojaloop Switch

The technical steps for standing up `mojaloop/helm` **v17.2.0** with `helmfile` on a single-node **kind** cluster, in
**ISO 20022 + FX** mode with the **audit topic** on, configured to behave like the DRPP switch where that is cheap
to reproduce, and documented as different where it is not.

Read alongside:

- [`intern/deployment-e2e.md`](intern/deployment-e2e.md): the concepts behind each step (flow, topics, onboarding).
- [`intern/deployment-runbook.md`](intern/deployment-runbook.md): the gate-by-gate method this document follows.
  Where the two disagree, this document is the one checked against the chart source (see the last section).
- [`mojaloop-helm-iso20022-fx-local-deployment-plan.md`](mojaloop-helm-iso20022-fx-local-deployment-plan.md): the
  full log of the first build, including every failure.

## How to work through it

- One step at a time. A step is done when its **Gate** passes. Copy the gate's real output into the step's
  **Result** line.
- Stop on any surprise. Diagnose it before moving on.
- Use the pinned versions below, never "latest".
- Phase 1 (Steps A–L) reproduces the proven switch plus three production-like changes that must be in place before
  the first deploy. Phase 2 (Step O) adds further production-like changes one at a time, each behind its own gate,
  so a failure is always attributable to one change.

---

## 1. What "DRPP-like" means here

What the DRPP captures (`DRPP_Kafka_E2E_Pack`) and the handover documents establish about production, and what this
build does with each:

| Property | DRPP production | This build |
| --- | --- | --- |
| Mojaloop versions | central-ledger v19.14.0, ml-api-adapter v16.9.2, quoting-service v17.14.4, ALS v17.15.2 | **Same** (chart v17.2.0 defaults) |
| API mode | ISO 20022 (`application/vnd.interoperability.iso20022.*`) | **Same** |
| Flow | Cross-border FX: discovery → fxQuote → quote → fxTransfer → transfer | **Same** corridor shape, `XXX → XTS` |
| Audit emitters | ALS, quoting-service (+handler), ml-api-adapter (+notification handler); **not** central-ledger | **Same** (`EVENT_SDK_CONFIG` on those six) |
| Audit compression | LZ4 | **Same** |
| `topic-event-audit` | **12 partitions**, 7-day / 250 MB retention | **Same, provisioned explicitly** (Step E). The chart default auto-creates it with 1 partition. |
| State survives restarts | Yes | **Yes**: Kafka and MySQL persistence on (Step E). Off by default in the chart, so a pod restart erases the ledger and every topic. |
| Simulator specs | n/a | **Baked into values** (Step E), so no GitHub fetch at boot |
| Topology | **Regional hub** (`hub-region-stg`); national DFSPs reach it through **inter-scheme proxies** (`fspiop-proxy: proxy-zmw`, `proxy-mwk`, …) | **Not reproduced.** Single scheme, hub named `Hub`, no proxy. Out of scope by decision. |
| Edge | Envoy/Istio mesh, Keycloak OAuth2 bearer tokens (`realms/dfsps`), one external API host | **Not reproduced.** One Service per component, no auth, scripts run in-cluster. |
| JWS | `FSPIOP-Signature` on 90/100 captured records | **Not reproduced** for DFSP requests |
| Health probes | Assumed on | **Off** in the upstream ISO values (`DISABLE_PROBES`). Turning them on is Step O. |
| Replicas / HA | Multi-node | Single node, one replica of everything |
| Other topics | Unknown partition counts | 1 partition each (chart default) |
| FX notify leg | `notifyFxTransfer` (`PATCH /fxTransfers`) present | **Absent.** The local corridor's final transfer uses a fresh `transferId` not linked to the fxTransfer (see Step L). |

The Kubernetes distribution DRPP runs on is not known to us. kind is used because it is the proven path on this
class of host. The production-like properties that matter for MLA and the FRMS mapping are at the Mojaloop and
Kafka layer, and they are in the table above.

---

## 2. Setup decisions

| # | Decision | Answer |
| --- | --- | --- |
| **D1** | Which host? | **Your own local machine.** Not `10.0.150.69`, which already runs the working switch and the MLA rig and must not be touched. |
| **D2** | Internet egress? | **Yes.** Everything downloads directly; no offline image handling is needed. |
| **D3** | Which user? | Your normal user, as long as it can run `docker` without `sudo` (in the `docker` group). Use the same user for every step, so kubeconfig ownership never splits. `sudo` is only for installing binaries in Step B. |
| **D4** | What counts as done? | Step G pod count recorded, P2P `COMMITTED`, FX corridor `COMMITTED`, `topic-event-audit` with 12 partitions holding the 10-stage sequence of capture `09_fx_corridor_happy_path`, and the Step N reboot test passed. |

**Resources come first.** The switch needs about 8–10 GB of RAM for itself. The first attempt on a laptop was
dropped because the desktop session (browser, IDE, chat apps) already used ~13 GB. Close what you can before Step F,
and watch `free -g` during Step G. If you use **Docker Desktop**, its VM has its own CPU/RAM/disk limits; raise
them to at least 8 CPUs, 16 GB RAM and 80 GB disk first.

---

## 3. Pinned versions

| Tool | Version | Note |
| --- | --- | --- |
| kubectl | `v1.37.0` | Matches the node image |
| helm | `v3.21.4` | Stay on Helm 3. Helm 4 is untested with this helmfile/helm-diff. |
| helmfile | `v1.7.4` | |
| helm-diff | `v3.15.12` | Newest release during the first build's window; the installed version was not recorded |
| kind | **`v0.33.0`** | `v0.34.0-alpha` from the first build is not a published release. `v0.33.0` is the newest real one. |
| kind node image | `kindest/node:v1.37.0@sha256:a1ed56cfb0e7b93589bdf97c8cd566405a265939e3620fc4f5de89adff580ae5` | kind v0.33.0's default, same Kubernetes version as the first build |
| ingress-nginx | `controller-v1.15.1` | The project's last release (March 2026). Fine for a test cluster. |
| Mojaloop chart | `v17.2.0` | |

---

## Step A: Host preflight *(read-only)*

```bash
cat /etc/os-release | head -3; nproc; free -g; df -h /
stat -fc %T /sys/fs/cgroup            # tmpfs = cgroup v1 -> Step C needs failCgroupV1: false
getenforce 2>/dev/null                # SELinux state
docker info --format '{{.ServerVersion}} {{.CgroupDriver}} {{.Driver}}'
readlink -f /bin/sh                   # informational; Step D uses bash explicitly
kind get clusters 2>/dev/null; docker ps --format '{{.Names}}'
ss -ltnp '( sport = :80 or sport = :443 )'
for u in https://github.com https://raw.githubusercontent.com https://registry-1.docker.io/v2/ \
         https://registry.k8s.io https://dl.k8s.io https://get.helm.sh https://api.github.com \
         https://charts.bitnami.com/bitnami/index.yaml https://mojaloop.github.io/charts/repo/index.yaml \
         https://charts.helm.sh/stable/index.yaml https://charts.redpanda.com https://k8s.ory.sh/helm/charts/index.yaml \
         https://helm.elastic.co https://kokuwaio.github.io/helm-charts/index.yaml; do
  printf '%-60s ' "$u"; curl -sS -o /dev/null -w '%{http_code}\n' --max-time 15 "$u" || true
done
```

**Gate:**
- At least 8 cores, 12 GB RAM **free** (`free -g`, "available" column) with your normal apps open, **60 GB disk
  free**. Persistence (Step E) and images need more room than the first build's 33 GB.
- `docker info` works **without sudo**.
- Ports 80/443 are free. On a laptop something often holds them (a local web server, Apache, nginx, another kind
  cluster). Stop it, or change both `hostPort` values in Step C to `8080`/`8443`.
- Every URL returns an HTTP code. Any code proves the path. Timeouts and DNS failures mean a VPN or proxy is in
  the way. Fix that before going on.

**Result:** _

## Step B: Toolchain *(installs to `/usr/local/bin`)*

First check what's already installed (`which kubectl helm helmfile kind`). An existing different version goes
earlier on `PATH` than `/usr/local/bin` and silently wins, so remove it or note it.

```bash
mkdir -p ~/mojaloop-tools && cd ~/mojaloop-tools
curl -Lo kubectl https://dl.k8s.io/release/v1.37.0/bin/linux/amd64/kubectl && sudo install -m 0755 kubectl /usr/local/bin/
curl -Lo helm.tgz https://get.helm.sh/helm-v3.21.4-linux-amd64.tar.gz && tar -xzf helm.tgz linux-amd64/helm \
  && sudo install -m 0755 linux-amd64/helm /usr/local/bin/
curl -Lo helmfile.tgz https://github.com/helmfile/helmfile/releases/download/v1.7.4/helmfile_1.7.4_linux_amd64.tar.gz \
  && tar -xzf helmfile.tgz helmfile && sudo install -m 0755 helmfile /usr/local/bin/
curl -Lo kind https://github.com/kubernetes-sigs/kind/releases/download/v0.33.0/kind-linux-amd64 \
  && sudo install -m 0755 kind /usr/local/bin/
helm plugin install https://github.com/databus23/helm-diff --version v3.15.12
```

On an ARM machine (Apple Silicon Linux VM, etc.), swap `amd64` for `arm64` in every URL.

**Gate:** `kubectl version --client`, `helm version`, `helmfile version`, `kind version`, `helm plugin list` all
print the pinned versions.

**Undo:** delete the five binaries and `helm plugin uninstall diff`.

**Result:** _

## Step C: Cluster and ingress *(creates kind cluster `mojaloop-fx`)*

```bash
cat <<'EOF' > kind-config.yaml
kind: Cluster
apiVersion: kind.x-k8s.io/v1alpha4
nodes:
- role: control-plane
  kubeadmConfigPatches:
  - |
    kind: InitConfiguration
    nodeRegistration:
      kubeletExtraArgs:
        node-labels: "ingress-ready=true"
  - |
    kind: KubeletConfiguration
    failCgroupV1: false
  extraPortMappings:
  - containerPort: 80
    hostPort: 80        # 8080/8443 if Step A found 80/443 taken
    protocol: TCP
  - containerPort: 443
    hostPort: 443
    protocol: TCP
EOF
kind create cluster --name mojaloop-fx --config kind-config.yaml \
  --image kindest/node:v1.37.0@sha256:a1ed56cfb0e7b93589bdf97c8cd566405a265939e3620fc4f5de89adff580ae5
kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/controller-v1.15.1/deploy/static/provider/kind/deploy.yaml
kubectl wait -n ingress-nginx --for=condition=ready pod --selector=app.kubernetes.io/component=controller --timeout=180s
kubectl get storageclass
```

`failCgroupV1: false` is required on a cgroup v1 host (RHEL 8) and harmless on cgroup v2.

**Gate:** node `Ready`; every pod in `kube-system`/`ingress-nginx` `Running` with 0 restarts; `condition met`;
`kubectl get storageclass` shows `standard (default)`. Persistence in Step E depends on that class.

**Undo:** `kind delete cluster --name mojaloop-fx`.

**Result:** _

## Step D: Chart source and dependencies *(writes `~/mojaloop-helm`)*

```bash
git clone --depth 1 --branch v17.2.0 https://github.com/mojaloop/helm.git ~/mojaloop-helm
for r in "bitnami https://charts.bitnami.com/bitnami" "mojaloop-charts https://mojaloop.github.io/charts/repo" \
         "ory https://k8s.ory.sh/helm/charts" "elastic https://helm.elastic.co" \
         "kokuwa https://kokuwaio.github.io/helm-charts" "stable https://charts.helm.sh/stable" \
         "redpanda https://charts.redpanda.com"; do helm repo add $r; done
helm repo update
cd ~/mojaloop-helm && bash update-charts-dep.sh
```

Why this repo list:
- `stable` is **required** here: `monitoring/promfana` depends on it, and the script stops at that chart without it,
  before any core Mojaloop chart gets its dependencies. It is removed from `helmfile.yaml` in Step E, which is where
  it caused timeouts before.
- `mojaloop` (`mojaloop.io/helm/repo`) and `codecentric` are left out. No `Chart.yaml` references them, and the
  `mojaloop` index times out.
- `ory` serves `mojaloop-iam`, `elastic`/`kokuwa` serve `monitoring/efk`, and `redpanda` serves the `kafka-console`
  release.
- Run it with **`bash`**, not `sh`: the script uses bash-only `trap ... ERR` and arrays, and exits at line 1 where
  `/bin/sh` is dash.
- If `helm repo update` times out on `bitnami` (a 27 MB index), re-run it.

**Gate:**
- The script exits 0.
- `ls ~/mojaloop-helm/mojaloop/charts/*.tgz | wc -l` prints **18**.
- `find ~/mojaloop-helm -type d -name charts | wc -l` prints **50**; `find ~/mojaloop-helm -name tmpcharts` prints
  nothing.

**Result:** _

## Step E: Values and helmfile *(edits files only)*

Work in `~/mojaloop-helm/local-deployment-methods/helmfile/`.

### E1. Switch values: `values-mojaloop-iso20022-fx-lean.yaml`

```bash
cp values-mojaloop-iso20022.yaml values-mojaloop-iso20022-fx-lean.yaml     # the FULL file, never -min
cat <<'EOF' >> values-mojaloop-iso20022-fx-lean.yaml

# Not on the tested path.
centralsettlement:
  enabled: false
transaction-requests-service:
  enabled: false
# Shares an ingress host with the batch handler; FX positions only flow through the batch handler.
centralledger:
  centralledger-handler-transfer-position:
    enabled: false
EOF
```

`-min` removes the FXP simulator (`e2e-sim-fxp1`), which leaves no way to run FX.

### E2. Backend values: `values-backend-fx-lean.yaml`

This replaces the earlier `values-backend-iso20022-min.yaml` + re-enable layering with one explicit file. It keeps
`ttksims-redis` (simulator SDK cache) and `ttk-mongodb` (TTK backend secret), drops what nothing uses, and adds
persistence and the production topic.

```yaml
cl-mongodb:
  enabled: false
auth-svc-redis:
  enabled: false
ttksims-redis:
  enabled: true
ttk-mongodb:
  enabled: true

# Persistence: the chart defaults to emptyDir, so any restart erased the ledger and all topics.
mysql:
  primary:
    persistence:
      enabled: true
      size: 10Gi
kafka:
  controller:
    persistence:
      enabled: true
      size: 10Gi
  provisioning:
    # Helm replaces lists, so the chart's full topic list is repeated here, plus topic-event-audit.
    topics:
      - { name: topic-transfer-prepare,        partitions: 1, replicationFactor: 1 }
      - { name: topic-transfer-position,       partitions: 1, replicationFactor: 1 }
      - { name: topic-transfer-position-batch, partitions: 1, replicationFactor: 1 }
      - { name: topic-transfer-fulfil,         partitions: 1, replicationFactor: 1 }
      - { name: topic-notification-event,      partitions: 1, replicationFactor: 1 }
      - { name: topic-transfer-get,            partitions: 1, replicationFactor: 1 }
      - { name: topic-admin-transfer,          partitions: 1, replicationFactor: 1 }
      - { name: topic-quotes-post,             partitions: 1, replicationFactor: 1 }
      - { name: topic-quotes-put,              partitions: 1, replicationFactor: 1 }
      - { name: topic-quotes-get,              partitions: 1, replicationFactor: 1 }
      - { name: topic-bulkquotes-post,         partitions: 1, replicationFactor: 1 }
      - { name: topic-bulkquotes-put,          partitions: 1, replicationFactor: 1 }
      - { name: topic-bulkquotes-get,          partitions: 1, replicationFactor: 1 }
      - { name: topic-bulk-prepare,            partitions: 1, replicationFactor: 1 }
      - { name: topic-bulk-fulfil,             partitions: 1, replicationFactor: 1 }
      - { name: topic-bulk-processing,         partitions: 1, replicationFactor: 1 }
      - { name: topic-bulk-get,                partitions: 1, replicationFactor: 1 }
      - { name: topic-fx-quotes-post,          partitions: 1, replicationFactor: 1 }
      - { name: topic-fx-quotes-put,           partitions: 1, replicationFactor: 1 }
      - { name: topic-fx-quotes-get,           partitions: 1, replicationFactor: 1 }
      # DRPP spec: 12 partitions, 7 days, 250 MB. Kafka applies retention.bytes per partition.
      - name: topic-event-audit
        partitions: 12
        replicationFactor: 1
        config:
          retention.ms: "604800000"
          retention.bytes: "262144000"
          cleanup.policy: delete
```

Two open points: whether DRPP's 250 MB is per partition or per topic is not on record, and the chart's backend
images are the frozen `docker.io/bitnamilegacy/*` set. Both are fine for a test switch. Note them in the Result.

### E3. Simulator specs in values: `values-ttk-sim-offline-specs.yaml`

The `e2e-sim-ttk-backend` chart ships three config entries as GitHub URLs that the Toolkit fetches at boot. When the
fetch fails, port 4040 never binds, the pod still shows `1/1 Running`, and the FXP answers every FX quote with
`2001`. This step replaces the URLs with the file contents from [`ttk-sim-offline-specs/`](ttk-sim-offline-specs/)
as native nested values, so no live ConfigMap patch is needed and `helmfile apply` no longer undoes the fix.

Save the script below as `gen-ttk-values.py` and run it against this repo's `docs/deployment/ttk-sim-offline-specs/`
(needs `python3` with PyYAML: `pip install pyyaml` if `import yaml` fails):

```python
# Turns the three offline TTK files into a Helm values overlay for the moja release.
import json, sys, yaml
src, out = sys.argv[1], sys.argv[2]
loaders = {
    "rules_response__default.json": json.loads,
    "api_definitions__mojaloop_connector_backend_2.1__api_spec.yaml": yaml.safe_load,
    "api_definitions__mojaloop_connector_outbound_2.1__api_spec.yaml": yaml.safe_load,
}
files = {k: load(open(f"{src}/{k}").read()) for k, load in loaders.items()}
doc = {"mojaloop-ttk-simulators": {"e2e-sim-ttk-backend": {"ml-testing-toolkit": {
    "ml-testing-toolkit-backend": {"config_files": files}}}}}
yaml.safe_dump(doc, open(out, "w"), sort_keys=False, width=4096, allow_unicode=True)
```

```bash
python3 gen-ttk-values.py <repo>/docs/deployment/ttk-sim-offline-specs values-ttk-sim-offline-specs.yaml   # ~320 KB
```

With internet available the GitHub fetch would probably succeed anyway. Do this step regardless: it removes a
silent failure mode (a GitHub `503` at boot was exactly how the first build broke) and keeps the specs pinned.

Why it works: the chart renders each `config_files` value through `toPrettyJson`, and JSON is valid YAML, so the
two `.yaml` specs arrive as JSON-formatted YAML. Rendering the `e2e-sim-ttk-backend` chart with this overlay was
checked: all three ConfigMap keys parse back identical to the source files, the other three keys are untouched, and
the ConfigMap is 351 KB against the 1 MiB limit. Helm prints three `coalesce.go ... Ignoring non-table value`
warnings while rendering. They are expected: the chart's default URL strings are being replaced by maps. **Not yet
proven against a running pod**. Step I is that proof.

### E4. `helmfile.yaml`

Edit it so it reads as follows (the `repositories:` block shrinks to the one repo a release uses):

```yaml
repositories:
- name: redpanda
  url: https://charts.redpanda.com

releases:
- name: backend
  namespace: demo
  chart: ../../example-mojaloop-backend
  timeout: 1800
  values:
    - values-backend.yaml
    - values-backend-fx-lean.yaml
  set:
    - name: 'kafka.kraft.clusterId'
      value: 'w1pu1g7pjnZDr0i4Fo66PD'
- name: moja
  namespace: demo
  chart: ../../mojaloop
  timeout: 1800
  values:
    - values-mojaloop-iso20022-fx-lean.yaml
    - values-ttk-sim-offline-specs.yaml
- name: kafka-console
  namespace: demo
  chart: redpanda/console
  version: 0.7.31
  values:
    - values-kafka-console.yaml
```

`helmfile apply` refreshes every listed repo before it deploys anything, and the unused `stable`, `incubator` and
`mojaloop` entries each timed out the first build. `timeout: 1800` gives image pulls longer than Helm's 5-minute
default.

### Gate (render, don't deploy)

```bash
helmfile template > /tmp/rendered.yaml
grep -c 'AUDIT' /tmp/rendered.yaml                                       # > 0
grep -E 'name: .*transfer-position' /tmp/rendered.yaml | sort -u         # only -batch names
grep -c 'iso20022' /tmp/rendered.yaml                                    # > 0
grep -A2 'name: topic-event-audit' /tmp/rendered.yaml | head             # partitions 12
grep -c 'raw.githubusercontent.com' /tmp/rendered.yaml                   # see note
grep -E 'persistence|storage: 10Gi' /tmp/rendered.yaml | head            # PVC templates present
```

For the `raw.githubusercontent.com` count, confirm none of the remaining hits sit in
`moja-e2e-sim-ttk-backend-config-default`. Then `git -C ~/mojaloop-helm status` and `git diff`: only the intended
files changed.

**Undo:** `git -C ~/mojaloop-helm checkout -- .` and delete the new values files.

**Result:** _

## Step F: Deploy `backend` only

```bash
helmfile -l name=backend apply
kubectl get pods,pvc -n demo
kubectl exec -n demo kafka-controller-0 -- kafka-topics.sh --bootstrap-server localhost:9092 --describe --topic topic-event-audit
```

Infrastructure goes first, so any failure here is the infrastructure, not the services.

**Gate:**
- `kafka-controller-0`, `mysqldb-0`, `ttksims-redis-master-0`, `ttk-mongodb`, `proxy-cache-redis-*` are `Running`
  with 0 restarts; the provisioning job is `Completed`.
- The MySQL and Kafka PVCs are `Bound`.
- `kubectl get secret -n demo ttk-mongodb` exists.
- `topic-event-audit`: `PartitionCount: 12`, with `retention.ms=604800000` in its configs.

**Undo:** `helmfile -l name=backend destroy`, then `kubectl delete pvc -n demo --all`. PVCs outlive a destroy.

**Result:** _

## Step G: Deploy `moja` and `kafka-console`

```bash
helmfile -l name=moja apply && helmfile -l name=kafka-console apply
kubectl get pods -n demo --no-headers | awk '{print $3}' | sort | uniq -c
```

**Gate:** every pod `Running` except the `Completed` migration and provisioning jobs. The first build had 51 Running
+ 1 Completed. This build has two fewer backend pods (`cl-mongodb`, `auth-svc-redis`) and a visible provisioning
job, so **record the actual numbers** and explain any pod not `Running`. Simulators crash-loop for a few minutes
while Redis starts, a known race. Wait 5 minutes and re-check before calling it a failure. Anything still not
`Running` then gets `kubectl describe` and `kubectl logs`.

**Result:** _

## Step H: Baseline health *(read-only)*

```bash
kubectl exec -n demo kafka-controller-0 -- kafka-topics.sh --bootstrap-server localhost:9092 --list
kubectl exec -n demo moja-ml-testing-toolkit-backend-0 -- node -e 'require("http").get({hostname:"moja-centralledger-service",path:"/participants",headers:{Accept:"application/json"}},r=>{let d="";r.on("data",c=>d+=c);r.on("end",()=>console.log(d))})'
```

**Gate:** topics include `topic-transfer-prepare`, `topic-transfer-position-batch`, `topic-transfer-fulfil`,
`topic-notification-event`, and **`topic-event-audit` (already there, because Step E provisions it)**.
`/participants` returns only `Hub`.

**Result:** _

## Step I: Simulator backend *(read-only now)*

```bash
kubectl logs -n demo moja-e2e-sim-ttk-backend-0 -c ml-testing-toolkit-backend | grep -iE 'started on port|running on|error downloading'
kubectl get cm -n demo moja-e2e-sim-ttk-backend-config-default -o json | python3 -c \
  'import sys,json; d=json.load(sys.stdin)["data"]; [print(k, len(v)) for k,v in sorted(d.items())]'
```

**Gate:** the log shows **both 5050 and 4040**, and no `Error downloading`. The three spec keys are each tens of
KB, not ~125-byte URLs.

**If 4040 is missing:** fall back to the live patch (plan §9.20–9.21: `kubectl patch --type merge` on the three
keys, then `kubectl delete pod -n demo moja-e2e-sim-ttk-backend-0`). Record that E3 failed and why, from the
backend log.

**Result:** _

## Step J: Onboarding *(writes ledger and ALS state)*

`onboard.js` was lost. Write it into [`fx-edge-case-scripts/`](fx-edge-case-scripts/), reusing `fxlib.js`'s
`send()`, and commit it as soon as it works. Run one sub-step at a time.

| Sub-step | Call (central-ledger admin unless noted) | Gate |
| --- | --- | --- |
| J1 Hub accounts | `POST /participants/Hub/accounts` `{currency, type}` for `XXX`,`XTS` × `HUB_RECONCILIATION`,`HUB_MULTILATERAL_SETTLEMENT` | `GET /participants/Hub/accounts` lists 4 |
| J2 Settlement model | `POST /settlementModels`: `name: DEFAULTNET` (alphanumeric only), no `currency`, `NET`/`MULTILATERAL`/`DEFERRED`, `ledgerAccountType: POSITION`, `settlementAccountType: SETTLEMENT` | `GET /settlementModels` lists it |
| J3 Participants | `POST /participants` for `e2e-sim1`, `e2e-sim2` (`XXX`), `e2e-sim-fxp1` (`XXX` and `XTS`); then `POST /participants/{name}/initialPositionAndLimits` (`NET_DEBIT_CAP` 1000000, with `alarmPercentage`) | `GET /participants` lists 4, each with POSITION + SETTLEMENT accounts |
| J4 Callbacks | `POST /participants/{name}/endpoints` → base `http://moja-<name>-sdk:4000` | `GET /participants/{name}/endpoints` returns the full set |
| J5 ALS party | ALS `POST /participants/MSISDN/9990002001`, `Accept`/`Content-Type: application/vnd.interoperability.iso20022.participants+json;version=2.0`, `Date`, `FSPIOP-Source: e2e-sim2` | `202`; a lookup returns `e2e-sim2` |
| J6 Funds-in | `./run.sh s_fund.js` | every settlement account shows a balance (credits show **negative**) |

For J4, take the exact endpoint types and URL templates (e.g. `/transfers/{{transferId}}`) from the provisioning
collection inside the TTK pod, rather than guessing:

```bash
kubectl exec -n demo moja-ml-testing-toolkit-backend-0 -- cat /opt/app/examples/collections/provisioning/testingtoolkitdfsp.json
```

It has no FX types. Add `FSPIOP_CALLBACK_URL_FX_QUOTES`, `FSPIOP_CALLBACK_URL_FX_TRANSFER_POST`, `_FX_TRANSFER_PUT`
and `_FX_TRANSFER_ERROR`, checked against central-ledger v19.14.0's endpoint-type enum. Steps K and L passing is
what confirms the set.

**Undo:** none clean. With persistence on, rolling back means `helmfile destroy`, deleting the PVCs, and Steps F–I
again.

**Result:** _

## Step K: P2P smoke test

`run.sh`/`audit.sh` SSH into `10.0.150.69`. Locally there is no SSH hop, so run the same pipeline directly from
`fx-edge-case-scripts/`:

```bash
# run one scenario (what run.sh does, minus SSH)
cat fxlib.js s_xfer_happy.js | kubectl exec -i -n demo moja-ml-testing-toolkit-backend-0 -- node -

# dump audit records for an id (what audit.sh does, minus SSH)
kubectl exec -n demo kafka-controller-0 -- kafka-console-consumer.sh --bootstrap-server localhost:9092 \
  --topic topic-event-audit --from-beginning --timeout-ms 20000 --property print.partition=true 2>/dev/null \
  | grep -- '<transferId>'
```

Worth committing as `run-local.sh`/`audit-local.sh` next to the originals once they work.

**Gate:** transfer `COMMITTED`; payer position moves by the amount; `topic-event-audit` holds `prepareTransfer` →
`fulfilTransfer`/`commitTransfer` records for that ID. The `Partition:` prefix shows records landing on more than
partition 0 across runs.

**Result:** _

## Step L: FX corridor

Run `s_fx_corridor_step1.js`, then `step2`, then `step3`, each with the local `kubectl exec` pipeline from Step K. Steps 2 and 3 hold one past run's ids, so replace them
with this run's ids (`CONVERSION_ID`, `DETERMINING_TRANSFER_ID`, and the FX condition from the FXP's `PUT
/fxQuotes` callback on the audit topic). See the scripts' README.

**Gate:**
- The FXP answers with real terms (`100 XXX → 200 XTS`). A `2001` means Step I isn't right.
- `commitRequestId` equals `conversionId` (the FXP looks up its cached quote by it).
- The fxTransfer and the final transfer are both `COMMITTED`.
- The `operation` sequence matches capture `09_fx_corridor_happy_path`.

Known gap: step 3 uses a fresh `transferId` that isn't linked to the fxTransfer's `determiningTransferId`, so the
DRPP `notifyFxTransfer` record never appears. Linking them means reusing the quote's `transactionId`, which hits the
open payee condition mismatch (plan §9.21 finding 2). Record it; don't chase it here.

**Result:** _

## Step M: Discovery *(optional)*

Run `s_probe_party_lookup.js` the same way. **Gate:** a `PUT /parties` callback reaches `e2e-sim1` with `e2e-sim2`'s
details. A `3003` is a known, undiagnosed issue. Record it as a separate task; it doesn't block done.

**Result:** _

## Step N: Reboot test and close-out

1. Reboot the machine, then `docker ps` (is the `mojaloop-fx-control-plane` container back?), and re-run the Gates
   for G, H, I, plus `GET /participants` and `s_positions.js`. With persistence on, participants, balances and
   topic offsets should survive. Record what did and didn't. If the node container didn't come back,
   `docker start mojaloop-fx-control-plane` and record that as a finding.
2. Fill in every Result line, the versions actually used, and any deviation.
3. Stopping it to free RAM without losing state: `docker stop mojaloop-fx-control-plane` and later `docker start`
   it. Teardown when finished: `kind delete cluster --name mojaloop-fx`. This deletes the PVC data too.

**Result:** _

---

## Step O: Phase 2 production-like changes *(one per apply, each with its own gate)*

Only after Step N passes. For each one: change one values key, `helmfile -l name=moja apply`, re-run Step I's gate
(the apply re-renders the simulator ConfigMap from values, so it should now survive), then re-run K and L.

| Change | How | Gate | Risk |
| --- | --- | --- | --- |
| Health probes on | Remove the `<<: *DISABLE_PROBES` lines from the lean file (ALS, quoting ×2, ml-api-adapter ×2, ISPA) | Pods `Ready` with probes active; K and L pass | Upstream turned them off for a reason not recorded. If pods flap, revert and record which service. |
| Production log level | Drop `log_level: debug` / `LOG_LEVEL: debug` | K and L pass | Low. Lose debug detail for later diagnosis. |
| Hub name `hub-region-stg` | Not recommended | n/a | Touches central-ledger, ALS, quoting and the TTK environments. Cost far exceeds the value. |
| Inter-scheme proxy topology | Not in scope | n/a | Needs a second scheme. A separate project, if ever. |

---

## Where this document differs from `deployment-runbook.md`

| Runbook | This document | Why |
| --- | --- | --- |
| Step B: `kind v0.34.0-alpha` / `<TAG>` | `v0.33.0`, node image pinned by digest | `v0.34.0-alpha` is not a published release |
| Step B: helm-diff unpinned | `v3.15.12` | Reproducibility |
| Step C: ingress from an unpinned tag | `controller-v1.15.1` | Reproducibility |
| Step D: repos exclude `stable` | `stable` added, for the dependency pull only | `monitoring/promfana` needs it; without it `update-charts-dep.sh` exits 1 before the core charts (reproduced) |
| Step D: `sh update-charts-dep.sh` | `bash update-charts-dep.sh` | The script is bash-only; it fails at once under dash |
| Step D: adds `mojaloop`, `codecentric` | Dropped | No chart references them; `mojaloop` times out |
| Step E: `-iso20022-min` + re-enable overlay | One explicit backend file | Same result, readable in one place |
| Step E: no persistence | Kafka + MySQL PVCs | Chart default is emptyDir; a restart erased all state |
| Step E: audit topic auto-created (1 partition) | Provisioned, 12 partitions + retention | DRPP spec |
| Step E: removes only the `mojaloop` repo | Keeps only `redpanda` | `stable`/`incubator` also timed out `helmfile apply` |
| Step I: live ConfigMap patch, undone by every apply | Specs in values (E3); patch is the fallback | Render-verified; removes the GitHub fetch at boot |
| Step H: `topic-event-audit` absent | Present from Step F | Provisioned |

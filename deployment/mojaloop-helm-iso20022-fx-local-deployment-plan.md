# Mojaloop Helm Deployment — ISO 20022 Cross-Border FX Test Plan

**Target host: `10.0.150.69`** (external machine, not the local laptop this plan was originally scoped
to — changed after §3 below made clear the laptop's desktop session, not the Tazama stack, was the real
RAM constraint; moving to a dedicated machine sidesteps that entirely rather than working around it).

**Working method — updated**: earlier sessions assumed this sandbox had no network path to
`10.0.150.69` at all, so execution was fully manual (you ran every command, pasted back output). That
assumption turned out to be wrong: a plain `ssh -o BatchMode=yes` probe got as far as
`Permission denied (publickey,password)` — i.e. the TCP path exists, it just needed credentials. A
dedicated, passphrase-less key was generated in this sandbox
(`~/.ssh/mojaloop_fx_10_0_150_69`, public half ends `claude-code-mojaloop-fx-deployment`) and appended to
`abdul.rahim`'s `~/.ssh/authorized_keys` on the host (the one time the password itself was used, run
manually by you — the harness's own permission classifier blocks this session from ever entering a raw
password itself, by design). Key-based login now works cleanly and non-interactively:
```bash
ssh -i ~/.ssh/mojaloop_fx_10_0_150_69 -o IdentitiesOnly=yes abdul.rahim@10.0.150.69 "<command>"
```
**Confirmed by explicit user choice** (asked directly rather than assumed): this session now runs
commands itself over that SSH connection, still one command per turn with the exact command and its full
output shown before deciding the next step — same cautious pace as before, just no more copy-paste. This
applies for the rest of this effort unless you say otherwise.

**Root access, resolved cleanly**: `abdul.rahim`'s `sudo` is password-gated (per §3), which blocks
non-interactive use over this SSH connection. Rather than have this session ever handle that sudo
password either, the same public key was appended directly to `/root/.ssh/authorized_keys` (again, the
one interactive step done by the user). This session now logs in as **root** directly:
```bash
ssh -i ~/.ssh/mojaloop_fx_10_0_150_69 -o IdentitiesOnly=yes root@10.0.150.69 "<command>"
```
No `sudo` needed anywhere from here on. **Heads-up carried over from the user, applies to every future
session**: reaching `10.0.150.69` at all depends on a VPN connection on the user's end, which can drop.
If SSH commands start failing with connection errors (timeouts, "no route to host") rather than command
errors, that's the most likely cause — say so plainly and wait; the user handles reconnecting and will
say when it's back, rather than this being a sign of something wrong with the deployment itself.

## Current status — resume here

**§§1-8 are done and independently verified.** A healthy Mojaloop switch, in ISO20022+FX+audit-topic
configuration, is running on `10.0.150.69`: kind cluster `mojaloop-fx`, namespace `demo`, 51 pods
`Running` + 1 `Completed` (re-confirmed 10 September). `topic-event-audit` exists, auto-populates, and
now holds real traffic from every scenario below.

**§10's edge-case matrix is complete. Handover items 3.4 and 3.5 both have evidence-backed answers.**

**Facts a fresh session needs immediately, without re-deriving them:**
- SSH is direct, as **root**, key at `~/.ssh/mojaloop_fx_10_0_150_69` (see "Working method" above).
  Reaching the host depends on the user's VPN — connection-level failures mean the VPN, not the
  deployment.
- Chart source `~/mojaloop-helm` (tag `v17.2.0`); deploy orchestration
  `~/mojaloop-helm/local-deployment-methods/helmfile/`. Kafka pod is `kafka-controller-0`.
- Re-verify health before anything else:
  ```bash
  kubectl get nodes && kubectl get pods -n demo --no-headers | awk '{print $3}' | sort | uniq -c
  ```
- DFSPs: payer `e2e-sim1`, payee `e2e-sim2`, FXP `e2e-sim-fxp1`. Currencies: sims `XXX` only, FXP
  `XXX,XTS` — corridor `XXX → XTS`. Payee test party: MSISDN `9990002001`.
- **The scripts are committed now** — [`fx-edge-case-scripts/`](fx-edge-case-scripts/), with a README.
  This replaces the previous session's lost `onboard.js` / `run_golden_path.js`. Read that README
  before hand-building any request: it covers the ISO 20022 body transformer, the ULID requirement,
  and ILP packet generation, none of which are obvious.
- **Onboarding needs four prerequisites, not three** — §9.9's Hub currency accounts, Settlement Model
  and ISO20022 ALS headers, **plus funding** (§9.16). Without funds-in, every transfer fails `4001`.
  Participants are funded as of 10 September.
- Real DRPP reference captures: `/home/abdul-rahim/mojaloop/DRPP_Kafka_E2E_Pack 2/DRPP_Kafka_E2E_Pack/`.

**What was established on 10 September, in order:**

1. **Onboarding, real traffic, DRPP shape match** (§§9.9–9.12) — unchanged and still correct.
2. **§9.13's finding (a) was wrong and is corrected in §9.15.** quoting-service *does* have ISO20022
   awareness in its outbound header path; what it actually does is **pass the caller's media type
   through**. The real, narrower finding is that it does not translate between a plain-FSPIOP caller
   and an ISO 20022 destination. **§9.13's finding (b) — the `"Network error"` masking — stands,
   re-verified.** If the COMESA write-up dated `2026-09-10` in
   `docs/docs - MLA/questions for comesa.md` has not yet been sent, it needs this correction first.
3. **A working ISO 20022 direct-request harness** (§9.14) — plus the discovery that ISO 20022 mode
   requires **ULIDs, not UUIDs**, for the ids mapping onto `PmtId.InstrId`/`EndToEndId`. This is a
   second, independent explanation for one of §9.10's unexplained `400`s.
4. **A fourth onboarding prerequisite (funding) and a silently dead simulator backend** (§9.16). The
   sims' TTK backend never started its SPEC_API on port 4040 — it fetches OpenAPI specs from GitHub at
   boot and that fetch failed — so the FXP returns `2001` to every FX quote, while the pod reports
   `1/1 Running`. **The FX happy path cannot complete until this is fixed, and a pod restart will not
   fix it**: neither the pod nor the host can currently reach `raw.githubusercontent.com` at all.
5. **Every remaining §10 row captured** (§9.17, §9.18) — plus the first complete end-to-end
   prepare→fulfil→COMMITTED transfer in this deployment. Captures in
   [`topic-event-audit-edge-case-captures/`](topic-event-audit-edge-case-captures/).

**Genuinely useful next steps, in rough priority order:**

1. **Correct the COMESA write-up** in `docs/docs - MLA/questions for comesa.md` (the `2026-09-10`
   section) to match §9.15 before it goes out — it currently states the disproved version. Keep the
   `2026-09-08` question set to Behjet separate and untouched.
2. **Feed the captures into the FRMS mapping work** (§11) — the three mapping consequences in the
   captures README are the substantive output: liquidity/limit failures are not distinguishable by
   `operation`; FX-quote error egress records carry no correlation identifiers at all; and no expiry
   event is ever emitted on the quoting leg.
3. **Optional — revive the FX happy path** by giving the sims' TTK backend its OpenAPI specs without a
   GitHub fetch (`@mojaloop/api-snippets` is already in the image). Only worth it if a *complete* FX
   corridor run is wanted; every §10 edge case was captured without it.
4. Still open and unchanged: the duplicate/resend async behaviour (§9.11 Finding 1); the full Kafka
   envelope comparison against the DRPP pack (§9.12's caveat); the `/etc/hosts` + ingress step for the
   browser TTK UI (end of §7).

## 0. Why this exists

[`topic_event_audit_Environment_Configuration.md`](topic_event_audit_Environment_Configuration.md) — the
handover-readiness request going back to the Mojaloop/COMESA side, due **9 September**, ahead of the
**14 September** handover and **15–30 September SIT** — has two open items this plan directly answers:

- **Item 3.4**: "The deployment or configuration steps for running the cross-border FX flow in ISO 20022
  mode... It lets us validate our broker configuration against a Mojaloop instance of our own before we
  point it at yours." That instance is what this plan builds.
- **Item 3.5**: "A current capture from `topic-event-audit`... covering error, abort, reject and timeout
  variants. The set we hold is golden-path only." The edge-case test matrix in §9 is aimed at producing
  exactly that.

Every step below stays local — this does not touch the real COMESA/DRPP environment, and none of it
depends on the answers requested in that document. It exists so those answers can be verified against a
Mojaloop instance of our own, per 3.4's own framing, and so 3.5's gap can be closed independently of
whether/when the other side responds.

## 1. Goal

1. A locally-run Mojaloop instance, close to production shape, via Helm — not the core-test-harness
   (CTH) docker-compose used so far — running in ISO 20022 mode.
2. Drive a real cross-border FX flow end-to-end through it (payer DFSP → FXP currency conversion →
   payee DFSP).
3. Validate the existing capture-derived knowledge of `topic-event-audit`
   (`docs/docs-poc-mla-ppa/MLA-PPA-Technical-Design.md`, `rejected-events.md`) against what this instance
   actually puts on that topic for FX traffic.
4. Exercise FX edge cases, not just the happy path — reject, abort, timeout, expiry, duplicate/resend.
5. Run the whole thing on `10.0.150.69` instead of the local laptop, so none of this competes with the
   laptop's desktop session (or the Tazama stack, which now needs no special handling — it's untouched
   throughout, on a different machine entirely).

## 2. What's already confirmed, and where

- **`topic-event-audit` is standard Mojaloop infrastructure, not bespoke to COMESA.** It's produced by
  `@mojaloop/event-sdk`'s built-in Audit event stream (shipped inside the core service images
  themselves), switched on by a config toggle — not application code unique to any one deployment.
  Confirmed by reading the actual library default
  (`ml-api-adapter/node_modules/@mojaloop/event-sdk/config/default.json`, `SIDECAR_DISABLED: true` —
  off by default) against `ml-core-test-harness/docker-compose.yml` (mounts a config file that flips
  `AUDIT: kafka` for central-ledger, ml-api-adapter, ALS, quoting-service, quoting-service-handler) and
  `docker/kafka/scripts/provision.sh` (creates `topic-event-audit` as a first-class topic).
- **The Helm chart ships the same toggle, off by default, but with a ready-made recipe to turn it on.**
  `ml-api-adapter/values.yaml` and `centralledger/values.yaml` in the chart repo have the
  `configOverride: .EVENT_SDKrc: AUDIT: kafka` block present but commented out. The chart repo's own
  `local-deployment-methods/helmfile/values-mojaloop-iso20022.yaml` defines this once as a YAML anchor
  and reuses it across account-lookup-service, quoting-service (+handler), and ml-api-adapter
  (+notification handler) — the same wiring CTH uses.
- **Do not use `values-mojaloop-iso20022-min.yaml`.** It strips `e2e-sim-fxp1` (the FX-provider
  simulator DFSP) and the whole `mojaloop-ttk-simulators` FX block, plus disables `centralsettlement`
  and `transaction-requests-service`. The FX simulator is exactly what goal #2 needs — use the **full**
  `values-mojaloop-iso20022.yaml` as the base and hand-pick trims instead (§6).
- **Chart version v17.2.0 (the tag Sam pointed at) matches the target production versions almost
  exactly**, per item 3.3 of the handover doc (Mojaloop v17, central-ledger v19.14.0, ml-api-adapter
  v16.9.2, quoting-service v17.14.4, ALS v17.15.2, inter-scheme-proxy-adapter v1.3.3). Checked directly
  against each chart-service's `Chart.yaml` `appVersion` at that tag:

  | Component | Target (handover doc 3.3) | v17.2.0 chart default | Match |
  |---|---|---|---|
  | central-ledger | v19.14.0 | v19.14.0 | exact |
  | ml-api-adapter | v16.9.2 | v16.9.2 | exact |
  | quoting-service | v17.14.4 | v17.14.4 | exact |
  | account-lookup-service | v17.15.2 | v17.15.2 | exact |
  | inter-scheme-proxy-adapter | v1.3.3 | 1.0.0 | **needs an image-tag override** |

  This is strong confirmation v17.2.0 is the right tag — four of five components need no version
  pinning at all. Only inter-scheme-proxy-adapter needs an explicit `image.tag: v1.3.3` override if we
  want full parity (not required for the P2P/FX flow itself, since proxy/cross-scheme routing isn't in
  scope here — see §10).

## 3. Target host — specs (confirmed) and what's still open

Confirmed directly on `10.0.150.69`, via the working method in the header (one command, output relayed
back):

| | |
|---|---|
| OS | RHEL 8.10 (Ootpa) |
| CPU | 8 cores |
| RAM | 31 GB total, 25 GB free / 27 GB available at check time |
| Disk (`/`) | 60 GB, 33 GB available |
| sudo | present, but password-gated (not passwordless) — fine under the working method, since you type the password interactively when a command needs it, nothing to relay to me |
| Docker | present (29.6.1) | 
| containerd | present (v2.2.5) |
| kubectl / helm / kind / helmfile / nerdctl | **not installed** — all of §4 still needed |

Against the rough budget below, 31 GB / 8 cores clears the ~8–10 GB floor with real margin — this host
does not have the laptop's problem.

**RHEL-specific, checked and cleared**: SELinux is **Disabled**. Cgroups are **v1** (`/sys/fs/cgroup` is
`tmpfs`, not `cgroup2fs`), and Docker's own driver is **cgroupfs** — the traditional, correctly-matched
pairing for a cgroup v1 host, not a mismatch, so this isn't expected to trip up `kind`. Storage driver is
`overlayfs` (standard). No `docker` group exists on this host (socket group is `root`, not `docker`) —
rather than join `root` or reconfigure/restart the daemon on a shared box, **every command from here on
runs as root via `sudo -i`**, kept consistent across Docker, kind, kubectl, and helm so kubeconfig
ownership never splits across users. Confirmed working: `docker info` succeeds as root. Nothing here
touches the host's Docker daemon config — fully undone by deleting the kind cluster at teardown (§12).

**Rough budget** (unchanged, now checked against a host that clears it): backend (Kafka + MySQL +
MongoDB + Redis) ~2–3 GB, core switch services (~10–12 pods across ALS, quoting-service ×2,
central-ledger ×7 handlers, ml-api-adapter ×2) ~2–3 GB, TTK + UI + 4 simulator DFSPs (payer, payee, fxp,
+1 spare) ~1–2 GB, cluster control plane + k8s system pods (etcd, coredns, kube-proxy, ingress) ~1 GB.
Total realistic floor **~8–10 GB** RAM — comfortable here.

## 4. Prerequisites to install

Run these **on `10.0.150.69` itself**, as root (`sudo -i`, per §3) — not on the laptop.

**Environment quirk found here**: `/usr/local/bin` isn't on root's default `PATH` on this host (unusual,
but confirmed — `kubectl` installed fine but wasn't found until this was fixed). Already patched for the
rest of this session and persisted in `/root/.bashrc`:
```bash
export PATH=$PATH:/usr/local/bin
echo 'export PATH=$PATH:/usr/local/bin' >> /root/.bashrc
```
**§4 complete.** Installed and confirmed on `10.0.150.69`: `kubectl v1.37.0`, `kind v0.34.0-alpha`,
`helm v3.21.4`, `helmfile v1.7.4` + the `helm-diff` plugin. One thing hit along the way: helmfile's
GitHub release assets embed the version in the filename
(`helmfile_<version>_linux_amd64.tar.gz`) — there's no stable `latest/download/...` alias the way
`kind`'s own download host provides, so the real URL had to be resolved via the GitHub API first (fixed
in the command below). Also worth noting: `kind`'s "latest" resolved to an **alpha** build
(`v0.34.0-alpha`), not a tagged stable release — untested so far whether that matters for §5; if cluster
creation misbehaves, pinning to the last stable tag instead (e.g. `v0.29.0` — check
github.com/kubernetes-sigs/kind/releases for the actual latest stable at the time) is the fallback.

Commands actually run, for reference:

```bash
# kind
curl -Lo ./kind https://kind.sigs.k8s.io/dl/latest/kind-linux-amd64
install -o root -g root -m 0755 kind /usr/local/bin/kind

# Helm v3
curl https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash

# helmfile + helm-diff plugin (the chart repo's local-deployment-methods uses helmfile, not raw helm)
# NOTE: helmfile's release asset filename embeds the version (helmfile_<ver>_linux_amd64.tar.gz) —
# there's no stable "latest/download/helmfile_linux_amd64.tar.gz" alias. Resolve the real URL first:
HELMFILE_URL=$(curl -s https://api.github.com/repos/helmfile/helmfile/releases/latest \
  | grep browser_download_url | grep linux_amd64.tar.gz | cut -d'"' -f4)
curl -Lo helmfile.tar.gz "$HELMFILE_URL"
tar -xzf helmfile.tar.gz helmfile && install -o root -g root -m 0755 helmfile /usr/local/bin/helmfile
helm plugin install https://github.com/databus23/helm-diff
```

Verify each with its `version`/`version --client` subcommand before moving on.

## 5. Bring up the cluster

**Hit and resolved**: first `kind create cluster` attempt failed — kubelet inside the node refused to
start at all (`crictl ps -a` showed zero containers; its log said outright: `"kubelet is configured to
not run on a host using cgroup v1... path: failCgroupV1"`). This is a hard gate in this specific node
image's default kubelet config (kind `v0.34.0-alpha`'s default node image is `kindest/node:v1.37.0`, a
bleeding-edge build pushing the cgroup v1 deprecation harder than a normal stable release would) — not
the host doing anything wrong, and not something a reboot into cgroup v2 is needed for. Fixed with an
extra `KubeletConfiguration` patch (`failCgroupV1: false`) added to the kind config below.

**§5 complete.** Cluster up and verified (node `Ready`, all system pods `Running`, zero restarts) with
the cgroup v1 fix in place. nginx ingress controller deployed via kind's own manifest and confirmed
`Ready` (`kubectl wait` returned `condition met`). **Re-confirmed healthy after an overnight gap** — 19h
uptime, node still `Ready`, every pod (incl. ingress-nginx) still `Running`, zero restarts; no reboot, no
drift. Moving to §6.

```bash
# Single-node kind cluster with ports 80/443 exposed for ingress. Run on 10.0.150.69.
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
    hostPort: 80
    protocol: TCP
  - containerPort: 443
    hostPort: 443
    protocol: TCP
EOF
kind create cluster --name mojaloop-fx --config kind-config.yaml

# nginx ingress controller, kind's own manifest (matches the extraPortMappings above)
kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/main/deploy/static/provider/kind/deploy.yaml
kubectl wait --namespace ingress-nginx --for=condition=ready pod \
  --selector=app.kubernetes.io/component=controller --timeout=180s
```

## 6. Prepare the chart source and a hand-trimmed values file

Run on `10.0.150.69`:

```bash
git clone --depth 1 --branch v17.2.0 https://github.com/mojaloop/helm.git ~/mojaloop-helm
cd ~/mojaloop-helm
sh update-charts-dep.sh
```

**Ordering correction found here**: `update-charts-dep.sh` runs `helm dep up --skip-refresh` per chart —
`--skip-refresh` means it expects the Helm repo indexes (bitnami, mojaloop, redpanda, elastic, etc.) to
already be cached locally, and fails outright if they aren't. So `helm repo add` has to run **before**
this dependency pull, not after (as originally sequenced under §7):

```bash
helm repo add stable https://charts.helm.sh/stable
helm repo add incubator https://charts.helm.sh/incubator
helm repo add kokuwa https://kokuwaio.github.io/helm-charts
helm repo add elastic https://helm.elastic.co
helm repo add codecentric https://codecentric.github.io/helm-charts
helm repo add bitnami https://charts.bitnami.com/bitnami
helm repo add mojaloop https://mojaloop.io/helm/repo/
helm repo add mojaloop-charts https://mojaloop.github.io/charts/repo
helm repo add redpanda https://charts.redpanda.com
helm repo update
```
(The first pass through this list omitted `mojaloop-charts` — distinct from, and easy to conflate with,
`mojaloop` — caught when `update-charts-dep.sh` failed on `ml-operator`, whose `Chart.yaml` depends on
it. Added above.)

`update-charts-dep.sh` walks through *every* chart in the repo unconditionally, including several never
actually deployed for this scenario (`ml-operator`, `mojaloop-iam`, `thirdparty/*`, `bulk-*`,
`merchant-registry-svc`, `connection-manager`...) — and each one's own `Chart.yaml` can name a repo not
in the list above. Hit next: `mojaloop-iam` needs `https://k8s.ory.sh/helm/charts` (Ory's
Oathkeeper/Keto/Kratos/Hydra — the IAM/auth stack, matching what the DRPP production infra diagram
actually shows, though not something this local test deploys). Added the same way — read the failing
chart's own `Chart.yaml`, add the repo it names, `helm repo update`, retry — rather than guessing a
"complete" list up front:
```bash
helm repo add ory https://k8s.ory.sh/helm/charts && helm repo update
```

**Dependency pull complete.** After adding `ory`, the full run finished clean: 50 `charts/` folders
populated, no leftover `tmpcharts`. Confirmed directly — the top-level `mojaloop/charts/` (the one
actually deployed) has all 18 expected component `.tgz`s, and `mojaloop-iam/charts/` (the one that
failed the prior attempt) is populated too.

**Trimmed values file built and confirmed.** `values-mojaloop-iso20022-fx-lean.yaml` created as a copy
of the full `values-mojaloop-iso20022.yaml` (**not** the `-min` variant — see §2; confirmed
`EVENT_SDK_CONFIG` anchor and its 6 reuse points, plus `mojaloop-ttk-simulators`, all intact) with two
trims appended — safe, since neither key existed in the source file:
- `centralsettlement.enabled: false` — settlement-window mechanics aren't part of what's being
  validated (message shapes on `topic-event-audit`, not settlement).
- `transaction-requests-service.enabled: false` — mobile request-money flow, unrelated to FX transfer.

For backend: `values-backend.yaml` as-is (not `-min`, which disables MySQL/Kafka/Redis/MongoDB entirely
— not optional here), layered with `values-backend-iso20022-min.yaml` (looked like a safe trim of
unused Mongo/Redis instances from reading it in isolation — **turned out not to be**; the real story is
in §7, found only once pods actually ran).

**§6 complete.** `helmfile.yaml` edited (confirmed by re-reading the whole file after): the `backend`
release now layers `values-backend-iso20022-min.yaml` on top of the full `values-backend.yaml`; the
`moja` release now points at `values-mojaloop-iso20022-fx-lean.yaml` instead of the chart's plain
default. Moving to §7 — the actual deploy.

## 7. Deploy

Six attempts to get a genuinely healthy deployment, each fixing one real thing — logged in order below
rather than collapsed, since several later fixes only made sense in light of what an earlier attempt
revealed.

**Attempt 1 — network drop, not a config problem.** Mid-deploy, the remote machine's internet dropped;
image pulls that should take ~2 minutes took 18-23 minutes ("including waiting", per `kubectl get
events`). Helm's default 5-minute wait gave up before those pulls finished, marking both `backend` and
`moja` `failed` — but `backend`'s actual resources (Kafka, MySQL, all 6 Redis pods, provisioning job) had
by then genuinely finished and were healthy; `moja` had only gotten as far as the central-ledger DB
migration job (also completed) before timing out, with none of the real service pods created yet.
Fix — raise Helm's wait timeout on both releases:
```bash
sed -i '/^- name: backend$/a\  timeout: 1800' ~/mojaloop-helm/local-deployment-methods/helmfile/helmfile.yaml
sed -i '/^- name: moja$/a\  timeout: 1800' ~/mojaloop-helm/local-deployment-methods/helmfile/helmfile.yaml
```

**Attempt 2 — an unused repo endpoint timed out.** `helmfile apply` refreshes every repo in its
`repositories:` block unconditionally, before touching any release — `https://mojaloop.io/helm/repo/`
timed out, even though it had worked fine in §6. Confirmed via `grep "^\s*chart:" helmfile.yaml` that
neither active release actually uses that repo (both install from local chart paths, not the published
`mojaloop/...` name). Fix — remove the unused entry rather than depend on it working:
```bash
sed -i '/^- name: mojaloop$/,+1d' ~/mojaloop-helm/local-deployment-methods/helmfile/helmfile.yaml
```

**Attempt 3 — a real config issue.** `backend` succeeded. `moja` failed on an nginx ingress-webhook
rejection: two central-ledger sub-components both template the same ingress hostname
(`central-ledger-transfer-position.local`) — the **batch** position handler
(`centralledger-handler-transfer-position-batch`, ingress `moja-handler-pos-batch`) had already
succeeded; the **non-batch** one (`centralledger-handler-transfer-position`) collided and got rejected.
These two are meant to be mutually exclusive per §4.2 of the comprehensive-overview doc read at the very
start of this effort — and critically, **FX position changes only work through the batch handler**, so
the non-batch one is both redundant and blocking here. Real key names confirmed via
`centralledger/Chart.yaml` (not guessable from directory names alone). Fix:
```bash
cat <<'EOF' >> ~/mojaloop-helm/local-deployment-methods/helmfile/values-mojaloop-iso20022-fx-lean.yaml

# Disable the non-batch position handler — collides with the batch handler's ingress host, and FX
# position changes only work through the batch handler anyway (see plan §2 / central-ledger §4.2):
centralledger:
  centralledger-handler-transfer-position:
    enabled: false
EOF
```

**Attempt 4 — another unused, likely structurally-broken repo.** Same class of problem as attempt 2:
`https://charts.helm.sh/stable` timed out. This one may not even be transient — it's the Helm project's
old "stable" repo, deprecated years ago in the real Helm ecosystem. Only ever referenced by
`monitoring/promfana` (for `prometheus`/`grafana`), not part of anything deployed here, and its
dependencies were already vendored as local `.tgz`s during §6 regardless. Fix — drop it, and `incubator`
pre-emptively (same deprecated family, same reasoning):
```bash
sed -i '/^- name: stable$/,+1d' ~/mojaloop-helm/local-deployment-methods/helmfile/helmfile.yaml
sed -i '/^- name: incubator$/,+1d' ~/mojaloop-helm/local-deployment-methods/helmfile/helmfile.yaml
```

**Attempt 5 — Helm-level success, but pod-level check found real gaps.** All three releases showed
`STATUS: deployed`, no failures. Independent pod check (never trust Helm's word alone — same discipline
as §5) found: 4 `CrashLoopBackOff` (`e2e-sim-fxp1`, `e2e-sim1/2/3` — the FX/e2e simulators), 1
`Init:CreateContainerConfigError` (`ml-testing-toolkit-backend`), 14 `PodInitializing` (mostly
`quoting-service` and various `-scheme-adapter` pods — later confirmed just a slow image pull, not a
bug). Root cause for the two real failures traced to `values-backend-iso20022-min.yaml` — the trim
called "safe" in §6 wasn't: `ttksims-redis` is what the e2e simulator SDKs connect to for cache
(confirmed by the exact hostname `ttksims-redis-master` in their crash logs, tracing to the
`MOJA_TTK_SIM_REDIS_HOST` anchor in `values-mojaloop-iso20022.yaml`, §2); `ttk-mongodb` is what the TTK
backend needs (`secret "ttk-mongodb" not found` — disabling that release meant its credentials Secret
never existed). `cl-mongodb` and `auth-svc-redis` do appear genuinely safe — nothing running references
either. Fix — a small third override, layered last so it only re-enables the two wrongly cut:
```bash
cat <<'EOF' > ~/mojaloop-helm/local-deployment-methods/helmfile/values-backend-fx-lean.yaml
ttksims-redis:
  enabled: true
ttk-mongodb:
  enabled: true
EOF
sed -i '/- values-backend-iso20022-min.yaml/a\    - values-backend-fx-lean.yaml' \
  ~/mojaloop-helm/local-deployment-methods/helmfile/helmfile.yaml
```

**Attempt 6 — succeeded, then a startup race, not a bug.** All three releases `deployed` again. Pod
check: from 4 `CrashLoopBackOff` + 1 config-error + 14 stuck → 48 `Running`, with only
`ttksims-redis-master`/`ttk-mongodb` themselves still normally starting and one straggler (`e2e-sim3`)
still crash-looping. After a ~3 minute wait and recheck: `ttksims-redis-master`/`ttk-mongodb` both
healthy, `ml-testing-toolkit-backend` and `quoting-service`/`quoting-service-handler` confirmed
`1/1 Running`, `e2e-sim3` recovered on its own — but `e2e-sim-fxp1`/`e2e-sim1`/`e2e-sim2` were *still*
crash-looping. Fresh logs showed the error had changed from `ENOTFOUND` to `ECONNREFUSED` (DNS resolves
fine now, TCP connection itself was refused) while `e2e-sim3` was, at that same moment, successfully
serving traffic against the identical Redis — meaning these three had been crash-looping since before
Redis was ready, and `CrashLoopBackOff`'s exponential backoff meant their next natural retry was
potentially minutes away even though the dependency had since stabilized. Fix — force-delete them so the
ReplicaSet recreates them immediately, rather than waiting out the backoff timer:
```bash
kubectl delete pod -n demo -l app.kubernetes.io/instance=moja-e2e-sim-fxp1-sdk
kubectl delete pod -n demo -l app.kubernetes.io/instance=moja-e2e-sim1-sdk
kubectl delete pod -n demo -l app.kubernetes.io/instance=moja-e2e-sim2-sdk
```
**Resolved — by time, not the force-delete.** The `kubectl delete pod -l app.kubernetes.io/instance=...`
commands matched nothing (wrong guess at the label's actual value), so they never fired — but by the time
that was noticed, all five e2e-sim pods (`fxp1`, `sim1/2/3`, `ttk-backend`) already showed `1/1 Running`
on their own, confirming the race diagnosis: they just needed enough time for a natural backoff retry to
land after Redis had stabilized, not an actual intervention. **§7 fully done** — final namespace-wide
check confirms it: 51 `Running`, 1 `Completed`, zero pods in any other state.

**Still to do once every pod is confirmed healthy**: kind's `extraPortMappings` (§5) binds ports 80/443
on the kind node container to **the host's own interfaces** — so on `10.0.150.69` that's the machine's
real IP, not `127.0.0.1`. Add the ingress hosts (exact list from `kubectl -n demo get ingress`) to
`/etc/hosts` **on whichever machine you'll browse from** — the laptop, if driving the TTK UI from there
— pointed at the remote IP:
```
10.0.150.69  ml-api-adapter.local central-ledger.local account-lookup-service.local \
             quoting-service.local testing-toolkit.local
```
This assumes `10.0.150.69:80/443` is actually reachable from that browsing machine — the same network
question flagged in §3, still unconfirmed. If it isn't (firewalled, VPN-only), an SSH tunnel or `kubectl
port-forward` run from the laptop against the remote cluster's kubeconfig is the fallback. Verify with
`curl http://central-ledger.local/health`, `curl http://ml-api-adapter.local/health`, and
`helm -n demo test moja --logs`.

## 8. Confirm `topic-event-audit` is actually there before running anything else

**Real Kafka pod is `kafka-controller-0`** (a StatefulSet, not the Deployment name originally guessed
here). Listing topics directly against it (`kafka-topics.sh --bootstrap-server localhost:9092 --list`)
showed every per-action domain topic (`topic-quotes-*`, `topic-transfer-*`, `topic-fx-quotes-*`,
`topic-bulk*`, `topic-notification-event`, ...) but **not** `topic-event-audit` — unlike CTH, which
explicitly pre-creates it, this Helm deployment's Kafka provisioning doesn't. Not a failure by itself:
the audit topic is only ever *produced to* when a real service handles a real request (§2's mechanism),
and no traffic had been driven yet.

**Confirmed empirically, not just inferred**: tested whether this broker auto-creates a topic on first
produce, since a `false` setting would mean the topic silently never appears until explicitly created.
```bash
kubectl exec -n demo kafka-controller-0 -- bash -c \
  "echo 'test-message' | kafka-console-producer.sh --bootstrap-server localhost:9092 --topic topic-event-audit"
kubectl exec -n demo kafka-controller-0 -- kafka-topics.sh --bootstrap-server localhost:9092 --list \
  | grep topic-event-audit
```
Auto-create is **on** — the topic appeared immediately (one harmless `UNKNOWN_TOPIC_OR_PARTITION` retry
warning, then success). Deleted it straight after, since it now held one junk test record that isn't a
real Mojaloop audit event and would pollute later comparison against the real capture shapes:
```bash
kubectl exec -n demo kafka-controller-0 -- kafka-topics.sh --bootstrap-server localhost:9092 --delete \
  --topic topic-event-audit
```
**§8 complete.** No explicit provisioning needed — the topic will recreate itself, clean, the moment §9
drives real traffic through the switch.

The `kafka-console` release in `helmfile.yaml` (Redpanda Console) gives a browser UI for this instead —
port-forward it and watch the topic live while driving traffic in §9, rather than only inspecting after
the fact.

## 9. Drive the FX golden path

The TTK-driven simulators (`e2e-sim1` = payer, `e2e-sim2` = payee, `e2e-sim-fxp1` = FXP) are already
configured for `API_TYPE: iso20022`, `ILP_VERSION: "4"` in the values file. Two ways to run scenarios:

- **Automated**: trigger the ISO20022 golden-path TTK collection headlessly via the TTK backend's own
  admin API (below) — this is the path actually being pursued, and is documented in detail as it's
  worked through.
- **Manual, for edge cases**: keep the TTK UI reachable and drive individual requests by hand — this is
  why TTK-UI stays enabled here (unlike the general resource-trim advice from the deployment guide) —
  manual control over a single request is what makes injecting a specific edge case possible, rather
  than only replaying a pre-scripted collection.

### 9.1 Re-verified health after a 42h idle gap

Same check as §5/§7 — cluster untouched, still clean:
```bash
kubectl get nodes && kubectl get pods -n demo --no-headers | awk '{print $3}' | sort | uniq -c
```
Result: node `Ready`, 51 `Running` + 1 `Completed`, zero drift.

### 9.2 Finding the right TTK collection

The plan originally guessed the bundled collections lived at
`/opt/mojaloop-testing-toolkit/collections` inside `moja-ml-testing-toolkit-backend-0` — wrong path.
Found the real one via `find / -maxdepth 6 -iname '*collection*' -type d`:
**`/opt/app/examples/collections`**. Listing it (`find ... -maxdepth 2`) shows:
```
dfsp/p2p_fx_happy_path.json          <-- the one we want
dfsp/p2p_happy_path*.json, transaction_request_service.json, sample.json, ...
fxp/FXP.json, SDK_backend.json, SDK_outbound.json
hub/hub_01..13_*.json (hub-side scenario collections)
iso20022/self_referencing_iso20022.json   (unrelated to FX)
provisioning/testingtoolkitdfsp.json
```
Inspected `dfsp/p2p_fx_happy_path.json` with Node (no `jq` in the container):
```bash
kubectl exec -n demo moja-ml-testing-toolkit-backend-0 -- node -e "
const c = require('/opt/app/examples/collections/dfsp/p2p_fx_happy_path.json');
console.log(c.name, c.test_cases.length);
c.test_cases.forEach(tc => console.log(tc.name, (tc.requests||[]).map(r => r.id+':'+r.description)));
"
```
Confirmed: `collections_dfsp_p2p_fx_happy_path`, one test case "P2P FX Transfer Happy Path", 5 requests —
`Get party information → Fx Quotes → Send quote → Fx Transfers → Send transfer` — exactly the corridor
this whole build exists to exercise.

### 9.3 Finding how to trigger it headlessly

No `curl`/`jq`/`wget` in the TTK backend container — it's BusyBox + Node.js only, so everything below uses
`node -e '...'` with the built-in `http` module instead of `curl`.

Traced the actual trigger route by reading source, not guessing:
- `src/lib/api-routes/outbound.js`, mounted at `/api/outbound` (`src/lib/api-server.js:68`) — route
  `POST /template/:traceID` takes the whole collection JSON as the body, `?sync=true` waits for the full
  result instead of fire-and-forget.
- Two ports on the `moja-ml-testing-toolkit-backend` Service: **5050** (labelled `ADMIN_API` per the env
  var `..._SERVICE_PORT_ADMIN_API=5050` — this is where `/api/outbound` actually lives, confirmed via
  `apiServer.startServer(5050)` in `src/index.js`) and 4040 (a separate `SPEC_API`, not the one we need).
- Auth (`verifyUser()` in `api-server.js`) only activates if `Config.getSystemConfig().OAUTH.AUTH_ENABLED`
  — no `AUTH_ENABLED` env var is set in this deployment, so it's off; the endpoint accepts plain
  unauthenticated requests.

Trigger command (run from inside the pod, since the collection file is already there and there's no
`curl`):
```bash
kubectl exec -n demo moja-ml-testing-toolkit-backend-0 -- node -e '
const http = require("http");
const fs = require("fs");
const body = fs.readFileSync("/opt/app/examples/collections/dfsp/p2p_fx_happy_path.json");
const req = http.request({
  hostname: "localhost", port: 5050,
  path: "/api/outbound/template/fx-golden-path-01?sync=true",
  method: "POST",
  headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) }
}, (res) => {
  console.log("HTTP_STATUS:" + res.statusCode);
  let data = ""; res.on("data", c => data += c); res.on("end", () => console.log(data));
});
req.on("error", e => console.error("REQUEST ERROR:", e.message));
req.write(body); req.end();
'
```

### 9.4 First attempt: crashed, but the crash was informative

Result: `HTTP_STATUS:200` but an **empty** response body — suspicious for a synchronous run that should
return full results. Cross-checked against Kafka directly (`kafka-topics.sh --list` filtered to
transfer/quote/audit topics) — no new activity, `topic-event-audit` still absent — so nothing actually
reached the switch. TTK backend logs (`kubectl logs -n demo moja-ml-testing-toolkit-backend-0 -c
ml-testing-toolkit-backend --tail=100`) showed the real error, timestamped exactly when the request ran:
```
info: isParallelRun: false — {"context":"TestCaseRunner"}
error in OutboundSend: TypeError: Cannot read properties of undefined (reading 'accept')
    at /opt/app/src/lib/test-outbound/outbound-initiator.js:957:26
    at replaceVariables (.../outbound-initiator.js:926:18)
    at processTestCase (.../outbound-initiator.js:301:24)
    at async TestCaseRunner.runPromiseListSequentially (TestCaseRunner.js:149:20)
```
Root cause, confirmed by reading the actual source (`outbound-initiator.js` and `TestCaseRunner.js`):
- The collection is parameterized — it references `{$inputs.fromFspId}`, `{$inputs.toIdType}`,
  `{$inputs.toIdValue}`, `{$inputs.amount}`, `{$inputs.currency}`, `{$inputs.accept}`,
  `{$inputs.contentType}`, `{$inputs.condition}`, `{$inputs.fromIdType/fromIdValue}`,
  `{$inputs.fromFirstName/fromLastName/fromDOB}`, `{$inputs.note}` — 14 distinct keys, throughout all 5
  requests.
- `TestCaseRunner.runAll()` (line 54) passes `inputTemplate.inputValues` straight through to
  `processTestCase` → `replaceVariables` with **no existence check**. The bundled collection file itself
  has no top-level `inputs` or `inputValues` key at all (confirmed: `Object.keys(collection)` is just
  `['options', 'name', 'test_cases']`), so it arrives as `undefined`, and `replaceVariables`'s
  `{$inputs...}` branch (`if (inputValues[temp])`) throws on the very first such reference it hits.
- This is exactly what the TTK web UI's "Run Collection" dialog exists to fill in — POSTing the raw file
  directly (as done here, to reach it headlessly) skips that step, so we have to supply the equivalent
  `inputValues` object ourselves in the request body.

### 9.5 Building the real `inputValues` — DFSP IDs confirmed

Confirmed so far, straight from the running pods (not guessed from naming convention):
```bash
kubectl exec -n demo moja-e2e-sim1-sdk-<pod> -- env | grep DFSP_ID       # => DFSP_ID=e2e-sim1      (payer)
kubectl exec -n demo moja-e2e-sim2-sdk-<pod> -- env | grep DFSP_ID       # => DFSP_ID=e2e-sim2      (payee)
kubectl exec -n demo moja-e2e-sim-fxp1-sdk-<pod> -- env | grep DFSP_ID   # => DFSP_ID=e2e-sim-fxp1  (FXP)
```
So `fromFspId: "e2e-sim1"` is confirmed, plus the payee's and FXP's own DFSP IDs.

**Currency confirmed too** — both sims report a single `SUPPORTED_CURRENCIES=XXX`; the FXP reports
`SUPPORTED_CURRENCIES=XXX,XTS`. `XXX` and `XTS` are both real, intentional ISO 4217 placeholder codes
("no currency" / "reserved for testing") — this deployment's FX corridor is `XXX → XTS`, not a real
currency pair, and that's expected for a generic local demo, not a mistake to fix.

### 9.6 Discovered: zero DFSP participants are actually registered

Before going further on `inputValues`, checked what the switch itself currently knows about, directly:
```bash
kubectl exec -n demo moja-ml-testing-toolkit-backend-0 -- node -e '
const http = require("http");
http.get({ hostname: "moja-centralledger-service", port: 80, path: "/participants", headers: {Accept:"application/json"} }, res => {
  let data=""; res.on("data",c=>data+=c); res.on("end",()=>console.log(data));
});
'
```
Result: `[{"name":"Hub", ...}]` — **only the Hub itself**. None of `e2e-sim1`, `e2e-sim2`, `e2e-sim-fxp1`
(or any other sim) exist as central-ledger participants. Checked for a deploy-time provisioning Job that
might have done this and self-deleted — the only `Completed` pod in the namespace is
`moja-centralledger-service-migration-td68b`, a DB schema migration, not participant seeding. **The
Helm/helmfile deploy stands up switch infrastructure only; DFSP onboarding is a separate, manual step
this plan now has to perform itself.** This explains the empty response body from the first golden-path
attempt in §9.4 independent of the `inputValues` crash — even with a perfect `inputValues` object, party
lookup for `e2e-sim2` would fail since it isn't a known participant at all.

### 9.7 What's available to help with onboarding, and what isn't

- `examples/collections/provisioning/testingtoolkitdfsp.json` — registers one DFSP as a central-ledger
  participant: `POST /participants` (name+currency), `POST /participants/{name}/initialPositionAndLimits`,
  then 24 separate `POST /participants/{name}/endpoints` calls covering essentially every FSPIOP callback
  type (participant PUT/error, parties GET/PUT/error, quotes PUT, transfers POST/PUT/error, sub-ID
  variants, bulk, NDC-breach email, etc.) — **no FX-specific callback types appear in this list at all**
  (no `FX_QUOTES`/`FX_TRANSFERS` entries), which is either because central-ledger doesn't need
  DFSP-specific callback registration for FX legs, or because this bundled example simply predates FX
  support being added — not yet confirmed which. Same parameterization problem as the golden-path
  collection (no `inputs`/`inputValues` schema of its own).
- `examples/environments/hub-k8s-default-environment.json` — a large (36KB) pre-built `inputValues` set
  clearly built for **this exact chart's k8s service-naming scheme** (`moja-e2e-sim1-sdk`,
  `moja-account-lookup-service`, etc. all appear verbatim). Directly useful pieces confirmed matching our
  deployment: `E2ESIM1_NAME: "e2e-sim1"`, `E2ESIM2_NAME: "e2e-sim2"`, `E2ESIM2_MSISDN_1: "9990002001"`
  (candidate payee party ID), `E2ESIM1_CALLBACK_URL`/`E2ESIM2_CALLBACK_URL`/`E2ESIMFXP1_CALLBACK_URL`
  (all `http://moja-<sim>-sdk:4000`, matching each sim's confirmed `INBOUND_LISTEN_PORT=4000`).
  **Do not reuse its dedicated FX block** (`FX_PAYER_DFSP_ID: "ttkfxpayer"`, `FX_PAYEE_DFSP_ID:
  "ttkfxpayee"`, `FX_TESTFXP1_ID: "ttkfxp1"`, `FX_SOURCE_CURRENCY: "XDR"`, etc.) — those names belong to a
  larger simulator roster (`ttkfxpayer`/`ttkfxpayee`/`ttkfxp1`/`ttkfxp2`) that this specific lean
  deployment does not run at all; using them would reference non-existent participants.
- **No ALS party-registration collection exists anywhere in `examples/`** (confirmed via `find
  /opt/app/examples -iname '*onboard*' -o -iname '*oracle*' -o -iname '*provision*' -o -iname '*setup*'
  -o -iname '*participant*'` — only the one central-ledger provisioning file turned up). Registering
  `9990002001` under `e2e-sim2` will need a direct `POST /participants/{Type}/{ID}` call against
  `moja-account-lookup-service`'s public API (not the separate `-admin` service, which manages oracle
  infrastructure, not individual parties) — not yet attempted.
- Checked whether ALS could be configured to skip per-party registration entirely via a rule-based
  "static oracle" (`values-als-static-oracle.yaml`, bundled alongside the other values files — routes
  MSISDN patterns to a fixed `dfspId` with no real party records needed at all). **Not used**: our
  deployed values file has no such rules layered in, and switching to it now would mean a Helm upgrade
  (a bigger, riskier change) rather than the one-off API call real registration needs — noted here as a
  known alternative if per-party registration turns out to be troublesome.

### 9.8 Onboarding script — first run, two real findings, fix in progress

Wrote a Node script (`onboard.js`, kept in this session's scratchpad, transferred via `scp` since the TTK
pod's own filesystem is read-only — copy it to `/root/onboard.js` on the host, then pipe into the pod:
`cat /root/onboard.js | kubectl exec -i -n demo moja-ml-testing-toolkit-backend-0 -- node -`) that calls
central-ledger and ALS directly (`http` module, same pattern as §9.3) to register participants, position
limits, callbacks, and the ALS test party in one pass, rather than fighting the TTK's own `inputValues`
templating for a 26-request bundled collection.

**First run failed on two things, both understood and fixable:**
1. **Every participant registration failed**: `400 — "Hub reconciliation account for the specified
   currency does not exist"`. Traced to source
   (`domain/participant/index.js`'s `validateHubAccounts`): central-ledger requires the **Hub itself**
   to have both a `HUB_RECONCILIATION` and a `HUB_MULTILATERAL_SETTLEMENT` account for a currency before
   *any* DFSP can be registered in that currency — a one-time bootstrap step this deployment never had
   done (matches §9.6's finding that nothing was ever onboarded). Route confirmed by reading
   `api/participants/routes.js`: `POST /participants/Hub/accounts`, body `{currency, type}`. Fix added to
   the script: create both account types for both `XXX` and `XTS` before touching any participant.
   (Every other failure in that first run — position/limits, all callback registrations — was a
   downstream cascade of participants never having been created; not a separate bug.)
2. **ALS party registration failed**: `400 — "Malformed syntax - Invalid accept header"` from
   `POST /participants/MSISDN/9990002001` with a plain `Accept: application/json`. Checked ALS's own
   OpenAPI spec (`api-swagger-iso20022-parties.yaml`) — the `Accept`/`Content-Type` parameters are typed
   as bare strings there (no regex), so the rejection is coming from application-level FSPIOP
   header-format validation, not the spec itself. Not yet fixed — next step is retrying with a proper
   FSPIOP media-type header (`application/vnd.interoperability.participants+json;version=1.0` is the
   likely correct value, unconfirmed) plus `Content-Type`/`Date`/`FSPIOP-Source` headers, since the ALS
   party-registration endpoint likely needs the same FSPIOP header set the hub-facing APIs generally
   require.

**Not yet done**: re-running the fixed script (Hub bootstrap added; ALS headers still need the fix in
point 2 before this will fully succeed).

### 9.9 Onboarding completed — full sequence, real fixes, all verified

Re-ran the fixed `onboard.js` (added a default Settlement Model step, §9.8 point 1) — **completed clean**.
Verified via `GET /participants`: all four show up (`Hub`, `e2e-sim1`, `e2e-sim2`, `e2e-sim-fxp1`), each
with real `POSITION`+`SETTLEMENT` currency accounts (`e2e-sim-fxp1` has both `XXX` and `XTS`), and all 36
callback endpoints (12 per participant — the essential FSPIOP + FX-specific types, not the bundled
collection's full 26, most of which are for bulk/sub-ID/thirdparty flows out of scope here) registered
`201`. Three real prerequisites were needed in total, found only by attempting each step and reading the
actual error (not discoverable from documentation alone):
1. **Hub currency accounts** (§9.8) — `POST /participants/Hub/accounts`, `{currency, type}` for both
   `HUB_RECONCILIATION` and `HUB_MULTILATERAL_SETTLEMENT`, per currency (`XXX`, `XTS`).
2. **A Settlement Model** — central-ledger refuses to create a participant's currency position without
   one matching (or a default). None existed. Found the exact schema by reading a *disabled* reference
   seed (`seeds/z1000_settlementModel-deprecated.js-`, kept in-repo intentionally per its own comment,
   for exactly this kind of manual setup) — created one named `DEFAULTNET` (API requires alphanumeric
   `name`, so no underscore, unlike the seed's `DEFERRED_NET`) with `currency` omitted so it applies to
   every currency: `settlementGranularity: NET, settlementInterchange: MULTILATERAL, settlementDelay:
   DEFERRED, ledgerAccountType: POSITION, settlementAccountType: SETTLEMENT`.
3. **ALS party registration needs ISO20022-specific FSPIOP headers**, not plain ones — confirmed by
   reading ALS's own config (`API_TYPE: "iso20022"` — set via `config/default.json`, *not* an env var,
   which is why an earlier `env | grep API_TYPE` check missed it) and the actual header-validation regex
   in `@mojaloop/central-services-shared`'s `util/headerValidation/index.js`
   (`application/vnd.interoperability.iso20022.<resource>+json;version=X.X` — the literal string
   `iso20022` is `ISO_HEADER_PART`, inserted only when `apiType === 'iso20022'`). Fixed:
   `application/vnd.interoperability.iso20022.participants+json;version=2.0` for both `Accept` and
   `Content-Type`, plus `Date` and `FSPIOP-Source: e2e-sim2` headers. Result: `202` — the payee's test
   party (`MSISDN 9990002001` → `e2e-sim2`) is registered.

Onboarding script kept in this session's scratchpad as `onboard.js` (not yet committed anywhere in the
repo — worth relocating into `docs/deployment/` or similar if this plan is revisited, so a fresh session
doesn't have to re-derive it).

### 9.10 First full golden-path attempt — 3 of 5 requests hit real services; two real, understood bugs

Built `run_golden_path.js` (scratchpad): loads the bundled collection, fills in `inputValues` (confirmed
DFSP IDs/currencies from §9.5, the payee MSISDN, a freshly generated ILP `condition` — Node `crypto`:
random 32-byte fulfilment, `condition = base64url(SHA256(fulfilment))`), and POSTs it to
`/api/outbound/template/:traceID?sync=true` per §9.3.

**Attempt 1 — every request failed with HTTP 500.** Root cause, found in the *transformed* request the
TTK actually sent (not the input): headers showed
`application/vnd.interoperability.iso20022.iso20022.parties+json` — **doubled** `iso20022.iso20022`. The
collection's own `options.transformerName: "fspiopToISO20022"` means **the TTK backend already
auto-transforms plain-FSPIOP-shaped requests into real ISO 20022 wire format itself** (confirmed: the
`transformedRequest` bodies are genuine ISO 20022 `pain.001`-style structures — `GrpHdr`, `CdtTrfTxInf`,
etc.). Manually rewriting the headers to ISO20022 format (as ALS's *direct* API needed in §9.9) made the
transformer double-apply its own prefix. Fix: leave request 2-5's already-hardcoded plain-FSPIOP headers
untouched; only request 1's generic `{$inputs.accept}`/`{$inputs.contentType}` needed filling in, also in
plain-FSPIOP form (`application/vnd.interoperability.parties+json;version=1.0`) — the transformer adds
`.iso20022.` itself.

**Attempt 2 — still every request failed (500), but the real bug was different**: none of the 5 requests
have a `url` field set in the bundled collection, so `outbound-initiator.js`'s `sendRequest()` falls back
to the TTK's single global `CALLBACK_ENDPOINT` config value — confirmed (`spec_files/user_config.json`
inside the pod) to default to `http://localhost:4000`, which is nothing inside this pod. This deployment
also has **no unified hub gateway/ingress** — confirmed via `kubectl get ingress -n demo`: every service
(`account-lookup-service.local`, `quoting-service.local`, `ml-api-adapter.local`, ...) has its own
separate ingress host, unlike a real production setup where a DFSP hits one hub URL and a gateway
path-routes internally. Fix: since this all runs from inside the cluster anyway, set each request's own
`url` field directly to the correct backend Service, bypassing ingress and the broken default entirely:
```
request 1 (GET /parties)      -> http://moja-account-lookup-service
request 4 (POST /fxQuotes)    -> http://moja-quoting-service
request 2 (POST /quotes)      -> http://moja-quoting-service
request 5 (POST /fxTransfers) -> http://moja-ml-api-adapter-service
request 3 (POST /transfers)   -> http://moja-ml-api-adapter-service
```
(Confirmed safe by reading the code first: `sendRequest` destructures `url` straight from the request
object and prefers it over the config default when present.)

**Attempt 3 — real progress: 3 of 5 requests got genuine `202 Accepted` from the actual switch:**
- Request 1 (party lookup, → ALS): `202`
- Request 4 (FX quote, → quoting-service): `202`
- Request 5 (FX transfer, → ml-api-adapter): `202`
- Request 2 (quote, → quoting-service): `400` — `"must NOT have more than 35 characters"` on the
  ISO20022-mapped payee-FSP field.
- Request 3 (transfer, → ml-api-adapter): `400` — `"must match pattern"` on the expiration date field.

**Both 400s trace to the same root cause**: these two requests reference `{$prev.1.callback...}` /
`{$prev.2.callback...}` — the *previous* request's asynchronous callback response — to fill in fields
like the payee's real FSP ID and the quote's real expiration. Since nothing is listening for those
callbacks (they're addressed, correctly, to the real `e2e-sim1-sdk`/`e2e-sim2-sdk` pods per the callback
URLs registered in §9.9 — not to whatever is driving this script), `{$prev...}` never resolves, and the
raw placeholder string gets sent as literal data instead — hence "too many characters" and "bad date
pattern" (the literal template text failing those fields' own format checks). This is a structural gap
between "drive a collection headlessly, synchronously, in one shot" and "the collection's own design,
which assumes the caller also receives and correlates real async callbacks" — not a bug in the onboarding
or a wrong header/URL.

**`topic-event-audit` now exists and holds real records** — confirmed directly on Kafka
(`kafka-topics.sh --list` and `kafka-console-consumer.sh --from-beginning`), populated by this real
traffic (our own ALS registration call and the party-lookup request are both visible, with full FSPIOP
headers, trace IDs, and `auditType`/`transactionType` tags) — **not** the throwaway manual test message
from §8, which was deleted. This is the direct, positive answer to §3's original open question and a big
chunk of goal #2/#3 — achieved even though the full 5-step chain isn't 100% clean yet.

**Decision (asked the user rather than assumed)**: don't invest further right now in making `{$prev}`
chaining work for a fully clean golden-path run — move to capturing §10's edge cases instead, several of
which don't need a fully-resolved happy path anyway and more directly serve handover item 3.5 (which
explicitly wants error/abort/reject/timeout captures, not another golden-path proof).

### 9.11 Edge-case exploration — first real captures, and a new open finding

Since the bundled collection's own request/response machinery is built around synchronous `{$prev}`
chaining (§9.10's blocker), edge-case work switched to sending individual, hand-built ISO20022-shaped
requests directly to each service (same pattern as the onboarding script) rather than fighting the
collection format further. `topic-event-audit` remains the source of truth for what actually happened —
every attempt below was checked against it directly, not just the synchronous HTTP response.

**Finding 1 — real duplicate/resend behavior confirmed**: replayed the exact same FX-quote request body
(same `conversionRequestId`/`conversionId`/`determiningTransferId`, correct headers) a second time.
**No distinct "duplicate" rejection at the HTTP level** — the second attempt got `202 Accepted` again,
same as the first, consistent with Mojaloop's fire-and-forget POST design (duplicate detection lives
deeper in the async pipeline, not the immediate synchronous response). Not fully explored further —
whether/how the async layer actually flags the duplicate (a distinct `topic-event-audit` tag, a
notification, a silent no-op) is still open, and would be the next thing to check if this scenario is
revisited.

**Finding 2 — "FX quote rejected" edge case fully captured, real and complete**: the bundled collection's
FX-quote request hardcodes currency `AED` — which neither `e2e-sim1`/`e2e-sim2` (only support `XXX`) nor
`e2e-sim-fxp1` (`XXX`,`XTS`) actually support. Sending it produced a genuine, complete round trip:
`POST /fxQuotes` (`202`) → quoting-service's own validation rejects the FXP for that currency
(`"Unsupported participant 'e2e-sim-fxp1'"`, error code `3100`) → a real `PUT /fxQuotes/{id}/error`
callback **actually delivered** to `http://moja-e2e-sim1-sdk:4000/fxQuotes/{id}/error` (confirmed via the
`egress` audit record, JWS-signed, `fspiop-source: Hub`). This is a genuine, real capture directly
matching §10's first edge case ("FX quote rejected by FXP... currency pair the FXP sim isn't configured
for") — the "wrong currency" wasn't a mistake to fix, it's the edge case itself, already exercised.

**Finding 3 — confirmed the currency mismatch (not participant setup) was the actual cause, and found a
new distinct bug, since fully root-caused (§9.13)**: resent the same request with the *correct* currency
pair (`XXX`→`XTS`) and the real FXP ID. This time quoting-service's own validation passed and it
genuinely attempted to forward the request on to the real FXP: `POST
http://moja-e2e-sim-fxp1-sdk:4000/fxQuotes` — but that forward itself failed with `errorCode: 1001,
"Destination communication error - Network error"`, delivered back to `e2e-sim1-sdk` via another real
error callback. Checked whether the FXP pod itself was actually reachable (directly `GET /health` against
it — got a clean `404 Unknown URI`, i.e. it's up and responding, not a network-level failure) and then
directly replicated quoting-service's exact forwarded payload by hand against the same pod — got a clean
`400 Malformed syntax` response, not a connection failure. See §9.13 for the full root cause, found by
reading source on both sides rather than guessing further: it's a real bug in quoting-service, not a
network issue at all.

### 9.12 Confirmed: our captures structurally match the real DRPP production/UAT `topic-event-audit` shape

Before going further, checked something more fundamental than "does traffic flow" — **does the shape of
what we're capturing actually match the real thing the Tazama/FRMS mapping is built against?** This
matters beyond this plan: PPA ultimately emits these messages, and the FRMS-side mapping (the actual
core deliverable this whole effort feeds into) is built against the real DRPP capture shape, not an
assumption about what Mojoloop *should* produce.

Compared directly against `/home/abdul-rahim/mojaloop/DRPP_Kafka_E2E_Pack 2/DRPP_Kafka_E2E_Pack/` — five
complete real transactions captured from the actual DRPP `topic-event-audit` topic via Redpanda Console
(11-13 August 2026, corridors `MWK→ZMW`, `ZMW→MWK` ×2, `ZMW→EGP`, `ZMW→KES`), each a `raw_messages.json`
array of full Kafka records (`partitionID`, `offset`, `timestamp`, `headers`, `key`, complete
`value.payload` envelope).

**Result: field-for-field structural match**, checked on two different record types:
- `postFxQuotes` (our correct-currency attempt, §9.11 Finding 3, vs. the real pack's
  `01_MWK_to_ZMW_PRIMARY` index 3): identical `metadata.event`/`metadata.trace` shape —
  same tag set exactly (`auditType`, `contentType`, `conversionId`, `conversionRequestId`, `destination`,
  `determiningTransferId`, `httpMethod`, `httpPath`, `operation: "postFxQuotes"`,
  `serviceName: "quoting-service"`, `source`, `transactionAction`, `transactionId`, `transactionType`).
  The only difference: our record's `trace` object is missing `flags`/`parentSpanId`/`sampled` — because
  our hand-built request sent no incoming `traceparent` header, not a switch-side difference.
- `getPartiesByTypeAndID` (our §9.10 party lookup vs. the real pack's index 0): same match — identical
  tag set (`auditType`, `contentType`, `httpMethod`, `httpPath`, `operation`, `partyIdType`,
  `partyIdentifier`, `serviceName: "account-lookup-service"`, `source`, `transactionAction`,
  `transactionType`). Real capture additionally shows a resolved `destination` tag (ALS had already
  resolved the owning FSP in that production transaction); ours doesn't yet since our test party lookup
  was fresh — a data difference, not a structural one.

**One caveat worth flagging**: our own captures were pulled via `kafka-console-consumer.sh`, which prints
only the record *value* — the real pack's records additionally carry the full Kafka envelope
(`partitionID`, `offset`, `timestamp`, `key` with `rawPayload`, `compression`, etc., as Redpanda Console
exports it) that we haven't captured or compared yet. Worth doing via the `kafka-console` (Redpanda
Console) release already in `helmfile.yaml` (§8) if a closer full-envelope comparison is ever needed.

**Bottom line: this local deployment is a valid stand-in for real DRPP traffic for FRMS-mapping purposes**
— the switch's own audit-emission logic (not something this plan controls) produces the same shape here
as in the real environment. This is independent, positive confirmation on top of §3/§9.10's "does
`topic-event-audit` exist and populate" finding — it also *looks like the real thing*, not just present.

### 9.13 Root cause of Finding 3 — part (a) is WRONG, see §9.15; part (b) stands

> **Correction (10 September, later the same day).** Part (a) below — "quoting-service's outbound
> header builder has no ISO20022 awareness at all and always sends the plain-FSPIOP media type" — is
> **not correct**, and was disproved by direct evidence: an FX quote sent with ISO 20022 headers was
> forwarded to the FXP with the correct ISO 20022 media type. The real mechanism is media-type
> *pass-through*, and the actual reading of the deployed source is in **§9.15**. Part (b) (the
> `"Network error"` masking in `src/lib/http.js`) was re-verified against the deployed pod and is
> **unchanged and correct**. The rest of this section is kept as written, because the observations in
> Steps 1 and 2 are accurate — it is the Step 3 conclusion drawn from them that was wrong.


Requested by the user specifically, since this looked like it might be worth surfacing upstream. Traced
completely by reading source on both ends of the failed call — no more guessing.

**Step 1 — the request genuinely arrived; it wasn't a network failure at all.** `e2e-sim-fxp1-sdk`'s own
logs, at the exact timestamp of the failed forward:
```
10:13:16.648 - info: [==> req] POST /fxQuotes ... "accept":"application/vnd.interoperability.fxQuotes+json;version=2.0"
10:13:16.651 - error: accept header is invalid
```
The SDK's inbound middleware (`modules/api-svc/src/InboundServer/middlewares.js`) correctly identified an
invalid `Accept` header and set a proper `400` response with a real FSPIOP error body
(`Errors.MojaloopApiErrorCodes.MALFORMED_SYNTAX`, code `3101`) — confirmed by reading the middleware code
directly: it does *not* drop the connection, it returns a normal, well-formed HTTP error response. My own
manual replication of the same request a minute later (`10:14:27`) hit the identical `"accept header is
invalid"` log line and got that clean `400` body back over a plain `http.request` call — proving the SDK
side behaves correctly and consistently.

**Step 2 — why the header was invalid in the first place.** `e2e-sim-fxp1-sdk` runs `API_TYPE: iso20022`
(same confirmed pattern as ALS/quoting-service, §9.9), so its inbound validation — the identical shared
`parseAcceptHeader(resource, header, apiType)` from `@mojaloop/central-services-shared` used everywhere
else in this stack (§9.9's ALS investigation) — requires the ISO20022-form media type
(`application/vnd.interoperability.iso20022.<resource>+json;version=X.X`). Quoting-service forwarded the
**plain FSPIOP form** instead (`application/vnd.interoperability.fxQuotes+json;version=2.0`, no
`.iso20022.`), which fails that exact same validation function on the receiving end.

**Step 3 — traced why quoting-service sends the plain form: it's a genuine gap in its outbound code, not
a config toggle anyone forgot to set.** The forwarding call
(`src/model/fxQuotes.js`, the `postFxQuotes`/forward step matching the real trace's
`qs_fxQuote_forwardFxQuoteRequest` service tag) builds its headers via
`this.libUtil.generateRequestHeaders(headers, this.envConfig.protocolVersions, false, RESOURCES.fxQuotes,
null)`. Read `generateRequestHeaders` and the `headersMappingDto` function it calls
(`src/lib/util.js`) end to end: **neither takes an `apiType` parameter, and `iso20022`/`apiType` appear
nowhere in that header-generation code path at all** (confirmed by grepping the whole file — the one
unrelated `iso20022` match in it is for selecting quoting-service's own *inbound* swagger spec file, not
outbound headers). So quoting-service's inbound side correctly *enforces* ISO20022-form headers when it's
the receiver (§9.9), but its outbound side has no equivalent awareness at all when it's the sender
forwarding a request onward — a real asymmetry in this chart/version's ISO20022 support, not a missed
setting.

**Step 4 — why it surfaced as "Network error" instead of the real reason: a second, compounding bug in
quoting-service's own error handling.** `src/lib/http.js`'s shared `httpRequest()` helper (used by every
forwarding call in `fxQuotes.js`, `quotes.js`, `bulkQuotes.js`):
```js
} catch (e) {
  const [fspiopErrorType, fspiopErrorDescr] = e.response && e.response.status === 404
    ? [ErrorHandler.Enums.FSPIOPErrorCodes.CLIENT_ERROR, 'Not found']
    : [ErrorHandler.Enums.FSPIOPErrorCodes.DESTINATION_COMMUNICATION_ERROR, 'Network error']
  throw ErrorHandler.CreateFSPIOPError(fspiopErrorType, fspiopErrorDescr, ...)
}
// ...
if (res.status < 200 || res.status >= 300) {
  throw ErrorHandler.CreateFSPIOPError(ErrorHandler.Enums.FSPIOPErrorCodes.DESTINATION_COMMUNICATION_ERROR,
    'Non-success response in HTTP request', ...)
}
```
**Every non-2xx response except a bare 404 gets collapsed into the same generic `"Network error"`**,
regardless of whether it was an actual connection failure or — as here — a perfectly well-formed `400`
with a specific, useful FSPIOP error body. The real reason (`"accept header is invalid"`, code `3101`)
never survives to the caller; it's discarded at this exact point and replaced with a misleading generic
message. (The real error detail *is* appended to an internal-only extension list on the thrown error via
`e.stack`/`util.inspect(e)` — so it's not entirely lost server-side, in logs — but it never reaches the
FSPIOP error response actually delivered back to the payer DFSP.)

**Summary, worth surfacing upstream as-is**: in this Mojoloop version, when quoting-service forwards an
FX quote (and, by the same code path, a plain quote or bulk quote) to a destination running in ISO20022
mode, it (a) sends the wrong media-type format because its outbound header builder has no ISO20022
awareness, and (b) even when the destination correctly rejects that with a specific, useful error, the
forwarding caller discards the real reason and reports a generic "Network error" instead — actively
misleading anyone debugging the failure from the payer side. Both are real code-level findings
(`src/lib/util.js`'s `generateRequestHeaders`/`headersMappingDto`, and `src/lib/http.js`'s `httpRequest`),
not something specific to this deployment's configuration.

### 9.14 A working ISO 20022 direct-request harness — and two things it took to get there

Everything in §§9.15–9.17 depends on being able to hand-build requests the switch actually accepts.
Two obstacles had to be cleared first, neither documented anywhere.

**The bodies must be genuine ISO 20022, and there is a library in the image that builds them.**
`@mojaloop/ml-schema-transformer-lib` ships inside the TTK backend image — the same library the TTK's
own `transformerName: "fspiopToISO20022"` option uses (§9.10). Calling
`TransformFacades.FSPIOP.<resource>.<op>({ body, headers, params })` converts a plain-FSPIOP body into
real ISO wire format. One catch: the default mapping for `transfers.post` / `quotes.put` requires a
`$context` carrying the ISO quote response from an earlier leg, and throws
`"Invalid source object for post transfers, missing $context"` without it. `configure({ isTestingMode:
true })` selects an alternative mapping whose `$alt` fallbacks read `headers.fspiop-source` /
`fspiop-destination` instead — which is exactly right for a single hand-built request with no prior leg.

**In ISO 20022 mode the id fields must be ULIDs, not UUIDs.** The FSPIOP `conversionId` and
`determiningTransferId` map onto `PmtId.InstrId` and `PmtId.EndToEndId`. `InstrId` is constrained to
`^[0-9A-HJKMNP-TV-Z]{26}$` (a ULID) and `EndToEndId` to 35 characters — a 36-character UUID overflows
it. Sending UUIDs produces:
```
3100 Generic validation error - /requestBody/CdtTrfTxInf/PmtId/InstrId must match pattern "^[0-9A-HJKMNP-TV-Z]{26}$"
```
**This is the same root cause as the unexplained `"must NOT have more than 35 characters"` failure in
§9.10**, which was attributed there to unresolved `{$prev...}` placeholders. The placeholder problem was
real, but this constraint is a second, independent reason those requests could not have succeeded.
`ulidx` is available in the image; `fxlib.js`'s `id()` uses it.

A third piece the transfer scenarios need: **the ILP condition travels inside the packet**, not as its
own field. The ISO body carries only `VrfctnOfTerms.IlpV4PrepPacket`, and central-ledger decodes the
condition out of it — so a copied sample packet will not work. `Ilp.ilpFactory(v4).getResponseIlp()`
from `@mojaloop/sdk-standard-components` (also in the image) returns a matching
`{fulfilment, condition, ilpPacket}` triple.

The harness built on these is committed at
[`fx-edge-case-scripts/`](fx-edge-case-scripts/) — deliberately, since the previous session's
`onboard.js` / `run_golden_path.js` existed only in a scratchpad and were lost.

### 9.15 Correcting §9.13(a): quoting-service passes the caller's media type through

**Direct evidence first.** An FX quote sent to `moja-quoting-service` with ISO 20022 headers and an ISO
20022 body was forwarded to the FXP with the **correct** ISO media type — from `e2e-sim-fxp1-sdk`'s own
inbound log:
```
[==> req] POST /fxQuotes ... "accept":"application/vnd.interoperability.iso20022.fxQuotes+json;version=2.0"
```
No `"accept header is invalid"`, no rejection. That alone disproves §9.13's "always sends the plain
form".

**Why**, from the deployed pod's `src/lib/util.js` (quoting-service `17.14.3`):
```js
const isIso20022ApiRequest = (headers) => getContentTypeHeader(headers)?.includes(ISO_HEADER_PART)  // :358
const makeAppInteroperabilityHeader = (resource, version, isIsoApi) => {                            // :132
  const isoPart = isIsoApi ? `.${ISO_HEADER_PART}` : ''
  return `application/vnd.interoperability${isoPart}.${resource}+json;version=${version}`
}
function applyResourceVersionHeaders (headers, protocolVersions, resource) {                        // :137
  const isIsoApi = isIso20022ApiRequest(headers)
  let contentTypeHeader = getContentTypeHeader(headers)
  let acceptHeader = getAcceptHeader(headers)
  if (Util.HeaderValidation.getHubNameRegex(config.hubName).test(headers['fspiop-source'])) {
    ... contentTypeHeader = makeAppInteroperabilityHeader(resource, ..., isIsoApi)
    ... acceptHeader      = makeAppInteroperabilityHeader(resource, ..., isIsoApi)
  }
  return { contentTypeHeader, acceptHeader }
}
```
So ISO20022 awareness **is** present in this code path — §9.13's "grepped the whole file, `iso20022`
appears nowhere in it" was simply wrong. **A version difference does not explain it**: the local
checkout at `~/mojaloop/quoting-service` (`v17.14.5`) carries the identical code at the identical line
numbers (133, 138, 358) as the deployed pod (`17.14.3`), so both copies contain it and neither supports
the original claim. Worth stating explicitly so this isn't re-investigated as a version mismatch. Two things follow:

1. The header is only *rebuilt* when `fspiop-source` is the Hub. For a DFSP-originated request being
   forwarded onward, the caller's own `accept`/`content-type` are **passed through verbatim**.
2. quoting-service accepts **both** wire formats inbound — `resolveOpenApiSpecPath(isIsoApi)` (`:350`)
   picks `QuotingService-swagger_iso20022.yaml` or `QuotingService-swagger.yaml` per request, from that
   same content-type.

**What actually happened in §9.11/§9.13** is therefore: that request carried a *plain-FSPIOP*
content-type, quoting-service validated it against the plain spec, accepted it, and faithfully relayed
the plain media type to an FXP running `API_TYPE: iso20022` — which correctly rejected it.

**There is still a real interop finding here, but it is a different and narrower one**: this switch does
not translate media types between a plain-FSPIOP DFSP and an ISO 20022 DFSP. A scheme running mixed-mode
participants will see quote forwarding fail, and — because of §9.13(b), which is unchanged — the payer
will be told `"Network error"` rather than the destination's real reason. That framing is what should go
to COMESA, not the original one.

### 9.16 A fourth hidden onboarding prerequisite, and a silently dead simulator backend

**Funding.** §9.9's onboarding registered participants, positions, NDC limits and endpoints — but never
recorded any funds in. The NDC was a healthy `1000000`, yet **every** transfer prepare failed
`4001 "Payer FSP insufficient liquidity"`, because available liquidity is bounded by the SETTLEMENT
account balance, which was `0`. The fix is a `POST /participants/{name}/accounts/{settlementAccountId}`
with `action: recordFundsIn` per participant per currency (`s_fund.js`). After that the very same
prepare reserved cleanly (payer position `0 → 10`) and a full prepare→fulfil→COMMITTED round trip
worked. **This is a fourth prerequisite alongside §9.9's three, and without it nothing on the transfer
leg can ever succeed.**

Two smaller API details found the same way: `PUT /participants/{name}/limits` rejects a body without
`limit.alarmPercentage` (`3101`), and a credit to a SETTLEMENT account shows as a **negative** value.

**The FXP simulator's backend has been dead since deploy, and the pod reports healthy.**
`moja-e2e-sim-fxp1-sdk` forwards inbound FX quotes to its backend at
`http://moja-e2e-sim-ttk-backend:4040/fxQuotes` and gets `ECONNREFUSED`, so it returns
`2001 "Internal server error"` to every FX quote that reaches it. Cause, from
`moja-e2e-sim-ttk-backend-0`'s own startup log:
```
2026-09-09T09:50:25.706Z - info: Toolkit Initialization started...
2026-09-09T09:50:26.176Z - info: API Server started on port 5050
2026-09-09T09:50:26.547Z - error: uncaughtException: Error downloading
  https://raw.githubusercontent.com/mojaloop/api-snippets/refs/tags/v17.10.2/docs/sdk-scheme-adapter-outbound-v2_1_0-openapi3-snippets.yaml
  HTTP ERROR 503
```
The **SPEC_API on 4040 never started** — it fetches OpenAPI specs from GitHub at boot and that fetch
failed. The ADMIN_API on 5050 did start, the pod is `1/1 Running`, and nothing surfaces the partial
failure. Confirmed directly: from inside that pod, `127.0.0.1:5050` answers and `127.0.0.1:4040` is
`ECONNREFUSED`.

Two consequences worth carrying forward:
- **The FX happy path cannot complete in this deployment** until that is fixed — independent of, and in
  addition to, the `{$prev}` chaining gap in §9.10.
- **Restarting the pod will not currently fix it**: neither the pod nor the host can reach
  `raw.githubusercontent.com` at all right now (`ETIMEDOUT` from both). The chart's runtime dependency
  on fetching specs from GitHub is itself a fragility worth flagging — it makes the simulators
  unbootable on an air-gapped or egress-restricted network, and it fails *silently*.

The edge-case work in §9.17 was unaffected, because those scenarios drive **both** sides by hand —
acting as payer, payee and FXP directly — rather than relying on the simulators to respond.

### 9.17 §10's remaining edge cases — all captured

Driven with the §9.14 harness against the real switch; every outcome verified against participant
positions *and* the delivered FSPIOP error callback, not just the synchronous response. Captures in
[`topic-event-audit-edge-case-captures/`](topic-event-audit-edge-case-captures/).

**Baseline first** (so the edge cases mean something): prepare → fulfil → COMMITTED works. Payer
position `10 → 20` on prepare, payee `0 → -10` on commit, `PUT /transfers/{ID}` → `200`. This is the
first complete end-to-end transfer in this deployment.

| Scenario | What was done | Result |
|---|---|---|
| ILP condition mismatch | Fulfil with a random 32-byte fulfilment that doesn't hash to the condition | Reservation released (payer `30 → 20`), payee **not** credited, `3100` delivered |
| Payee abort | Payee sends `PUT /transfers/{ID}/error` with `5000` | Reservation released, `5000` propagated to the payer **verbatim, including the description** |
| NDC breach | NDC lowered to just above the current position, then exceeded | Prepare rejected, position **unchanged**, `4200 "Payer limit error"` |
| Insufficient liquidity | Prepare against an unfunded settlement account (§9.16) | Prepare rejected, `4001 "Payer FSP insufficient liquidity"` |
| Transfer timeout | 30s expiry, never fulfilled | Swept ~12s after expiring, reservation released, `3303 "Transfer expired"` delivered to **both** parties |
| FX quote expiry | See §9.18 — not enforced at all | Not enforceable |

**Two findings from these worth carrying beyond this plan:**

**(1) The ILP mismatch reason is genericised on the wire.** central-ledger's fulfil handler knows
exactly what went wrong — its own log says so:
```
error: countFspiopError (processFulfilMessage.):  invalid fulfilment - {"apiErrorCode":{"code":"3100", ...
error: error in FulfilHandler: invalid fulfilment
```
— but it classifies it as `3100 VALIDATION_ERROR`, so the payer receives `"Generic validation error"`,
not the FSPIOP-specified `5104`. The specific reason exists only server-side, in logs. This is the same
shape of problem as §9.13(b)'s `"Network error"` masking, on a different leg, and it means an integrator
cannot distinguish a wrong fulfilment from any other validation failure.

**(2) `4001` and `4200` are genuinely different conditions and should not be conflated.** An unfunded
settlement account gives `4001`; a funded participant exceeding its net debit cap gives `4200`. Both
arrive after an apparently-normal `202`, and — see the captures README — **neither is distinguishable
by `operation` tag**, only by the error payload on the egress record.

### 9.18 FX quote expiry is not enforced at all — a clean negative result

§10's "FX quote expiry" row cannot be triggered, and the reason is worth stating plainly because it
changes what can be expected on `topic-event-audit`.

**Source evidence.** Across the whole of quoting-service's `src/`, there is not one reference to
`expired`, `EXPIRED` or `isExpired`. `expiration` appears only twice, both in `src/model/quotes.js`
(`:308`, `:598`), and both merely persist the value to the database. `src/model/fxQuotes.js` contains no
expiration handling whatsoever — not even persistence.

**Confirmed empirically, both legs:**
- `POST /fxQuotes` with an expiration 60 seconds **in the past** → `202 Accepted`, and quoting-service
  proceeded to forward it to the FXP as normal.
- `PUT /fxQuotes/{ID}` delivered **40 seconds past** the quote's own expiration → `200 OK`. Notably this
  was accepted even though the quote had *already* been terminated with an error callback 40s earlier —
  so neither expiry nor prior termination causes a quote response to be refused.

**What this means for item 3.5**: no "expired quote" record will ever appear on `topic-event-audit` from
quoting-service. Expiry is enforced **only** on the transfer leg, by central-ledger's timeout handler
(`HANDLERS.TIMEOUT.TIMEXP`, a 15-second cron), and surfaces as `operation: timeoutReserved` with
`3303 "Transfer expired"`. Any FRMS-side expiry monitoring must key off the transfer leg.


## 10. Edge-case matrix — this is what answers handover item 3.5

Golden path alone isn't the goal. Work through each of these against the FX corridor, capturing the
resulting `topic-event-audit` records for each:

| Scenario | How to trigger | Status |
|---|---|---|
| FX quote rejected by FXP | Manual request with a currency pair the FXP sim isn't configured for | **Done (§9.11 Finding 2)** — real, complete capture: `POST /fxQuotes` → validation rejects the currency → real `PUT .../error` callback delivered |
| FX quote expiry | Delay the response leg past `expirationDate` before sending `PUT /fxQuotes/{ID}` | **Done — negative result (§9.18)**. Not triggerable: quoting-service has *no* expiry enforcement anywhere in `src/`. An already-expired `POST /fxQuotes` is accepted `202`; a `PUT /fxQuotes/{ID}` delivered 40s past expiry is accepted `200`. Captures `07_`/`08_` |
| Transfer/FX-transfer abort | Payee (or FXP leg) sends `PUT .../error` instead of fulfilling | **Done (§9.17)** — payee `PUT /transfers/{ID}/error`; reservation released, `5000` propagated verbatim to the payer. Capture `04_` |
| Transfer timeout | Don't fulfil at all; let the timeout handler sweep it | **Done (§9.17)** — 30s expiry, swept ~12s after expiring (`HANDLERS.TIMEOUT.TIMEXP` is a 15s cron). `3303` "Transfer expired" delivered to **both** payer and payee. Capture `06_` |
| FXP insufficient liquidity / NDC breach | Set a low NDC on the participant, send an amount that exceeds it | **Done (§9.17)** — two *distinct* outcomes, worth separating: unfunded settlement account → `4001` "Payer FSP insufficient liquidity"; funded but cap exceeded → `4200` "Payer limit error". Captures `01_` and `05_` |
| Duplicate/resend | Replay the identical `POST /fxQuotes` or `POST /fxTransfers` body with the same ID | **Partially explored (§9.11 Finding 1)** — no distinct rejection at the HTTP layer; whether/how the async pipeline flags it is still open |
| ILP condition mismatch on the FX leg | Manually corrupt the fulfilment condition sent back | **Done (§9.17)** — fulfil with a non-matching fulfilment; reservation released, payee not credited. Delivered as `3100` "Generic validation error", **not** the specific `5104` — see §9.17. Capture `03_` |

All captures live in
[`topic-event-audit-edge-case-captures/`](topic-event-audit-edge-case-captures/) (one directory per
scenario, `raw_messages.json`, mirroring the DRPP pack layout), and the scripts that produced them in
[`fx-edge-case-scripts/`](fx-edge-case-scripts/). Both directories have their own README.

**Item 3.5 is now answerable.** Six `operation` tag values appear in these captures that appear nowhere
in the five golden-path DRPP reference transactions: `abortTransfer`, `abortTransferValidation`,
`timeoutReserved`, `putFxQuotesErrorByID`, `getTransferByID`, and error-callback egress records carrying
no `operation` tag at all.

Also newly found, not originally in this matrix: **quoting-service does not translate media types
between a plain-FSPIOP caller and an ISO 20022 destination — it passes the caller's own media type
straight through** (§9.15, which corrects the earlier and wrong §9.13 account of this), and separately
its shared HTTP-forwarding helper (`src/lib/http.js`'s `httpRequest`) collapses *any* non-2xx response
other than a bare 404 into a generic `"Network error"`, discarding the destination's real, specific
error reason (§9.13 finding (b), re-verified against the deployed pod and unchanged). The second of
these has a close cousin on the transfer leg: an ILP fulfilment mismatch is logged internally as
`invalid fulfilment` but delivered to the payer as a generic `3100` (§9.17).

For each: capture the `topic-event-audit` record(s), check the shape against what
`docs/docs-poc-mla-ppa/MLA-PPA-Technical-Design.md` and `rejected-events.md` already assume from the
COMESA UAT captures, and log agreements/discrepancies — that comparison is what closes out goal #3.

## 11. Feed results back

- Update `docs/docs-poc-mla-ppa/` with what's confirmed vs. what diverges from the existing
  capture-based model, the same evidentiary style already used there (cite the specific record).
- The edge-case captures from §10 are what item 3.5 in the handover doc is asking for — once this is
  done, that item can be answered independently of the other side's response timeline.

## 12. Teardown

Run on `10.0.150.69`. Nothing on the laptop needs undoing — Tazama was never touched.

```bash
kind delete cluster --name mojaloop-fx
```

## 13. Open risks / unknowns

Resolved (kept here only so a fresh session doesn't re-investigate them): SELinux/cgroup v1 on this RHEL
host (§3, §5 — cleared, `failCgroupV1: false` patch works); the §3 resource budget being just an estimate
(§7's actual deploy succeeded within it — 51/52 pods healthy, no resource-pressure symptoms observed).

**Still genuinely open:**
- **Blocking §9 right now**: exact TTK collection name/labels for the FX+ISO20022 corridor in *this*
  chart's bundled TTK test cases — not yet confirmed (CTH's `--labels std,fx,fx-sdk` is not confirmed to
  carry over to this packaging). See "Current status" above for the first command to try.
- Whether `10.0.150.69:80/443` is reachable from wherever you'll browse the TTK UI (end of §7) — separate
  from SSH/terminal reachability, which is clearly fine; the `/etc/hosts` step itself hasn't run yet.
- `inter-scheme-proxy-adapter` version mismatch (§2, chart default `1.0.0` vs. production `v1.3.3`) —
  untouched since proxy/cross-scheme routing is out of scope for a single-scheme local FX test; revisit
  only if that changes.

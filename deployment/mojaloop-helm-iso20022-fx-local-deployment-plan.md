# Mojaloop Helm Deployment — ISO 20022 Cross-Border FX Test Plan

**Target host: `10.0.150.69`** (external machine, not the local laptop this plan was originally scoped
to — changed after §3 below made clear the laptop's desktop session, not the Tazama stack, was the real
RAM constraint; moving to a dedicated machine sidesteps that entirely rather than working around it).

**Working method**: this session has no network path to `10.0.150.69` (confirmed in §3 — it's not
reachable from this sandbox, regardless of whether it's reachable from you). So execution is manual and
one step at a time: I give you the next single command to run, with a short plain-language note on what
it actually does and why, you run it wherever it needs to run (directly on the box, or from your own
machine against it) and paste back the output, I read that output before deciding the next command
rather than handing over a whole block to run unattended. This applies from §4 onward — nothing here
gets batch-executed.

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
`Ready` (`kubectl wait` returned `condition met`). Moving to §6.

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

In `local-deployment-methods/helmfile/`, create `values-mojaloop-iso20022-fx-lean.yaml` starting as a
copy of `values-mojaloop-iso20022.yaml` (**not** the `-min` variant — see §2), then apply only these
trims, each independently safe for the P2P+FX corridor being tested:

- `centralsettlement.enabled: false` — settlement-window mechanics aren't part of what's being
  validated (message shapes on `topic-event-audit`, not settlement).
- `transaction-requests-service.enabled: false` — mobile request-money flow, unrelated to FX transfer.
- Keep `mojaloop-ttk-simulators` as-is (all of `e2e-sim1`, `e2e-sim2`, `e2e-sim-fxp1`) — this is the FX
  corridor itself; do not touch it.
- Keep every `configOverride: *EVENT_SDK_CONFIG` block as-is — this is what makes `topic-event-audit`
  appear at all (§2).
- If RAM pressure shows up once running (§3's floor is a rough estimate, not a guarantee), the next
  safe cut is `e2e-sim2` (a second plain DFSP simulator not needed once one payer+payee pair plus the
  FXP is running) before touching anything FX- or audit-related.

For backend, use `values-backend.yaml` as-is (not `-min`, which disables MySQL/Kafka/Redis/MongoDB
entirely — those aren't optional here) layered with `values-backend-iso20022-min.yaml` (safe: only
turns off unused Mongo/Redis instances, doesn't touch anything FX- or audit-related).

Edit `helmfile.yaml`'s `releases[].values` lists to point at these files (currently commented
placeholders showing exactly where):

```yaml
- name: backend
  values:
    - values-backend.yaml
    - values-backend-iso20022-min.yaml
- name: moja
  values:
    - values-mojaloop-iso20022-fx-lean.yaml
```

## 7. Deploy

Run on `10.0.150.69`:

```bash
cd ~/mojaloop-helm/local-deployment-methods/helmfile
helm repo add mojaloop https://mojaloop.io/helm/repo/ && helm repo update
helmfile apply
```

kind's `extraPortMappings` (§5) binds ports 80/443 on the kind node container to **the host's own
interfaces** — so on `10.0.150.69` that's the machine's real IP, not `127.0.0.1`. Add the ingress hosts
(exact list from `kubectl -n demo get ingress`) to `/etc/hosts` **on whichever machine you'll browse
from** — the laptop, if driving the TTK UI from there — pointed at the remote IP, not localhost:

```
10.0.150.69  ml-api-adapter.local central-ledger.local account-lookup-service.local \
             quoting-service.local testing-toolkit.local
```

This assumes `10.0.150.69:80/443` is actually reachable from that browsing machine — the same network
question flagged in §3. If it isn't (firewalled, VPN-only), an SSH tunnel or `kubectl port-forward` run
from the laptop against the remote cluster's kubeconfig is the fallback — decide once §3's answers are
in, since it changes whether kubectl needs to run locally against a copied kubeconfig or only over SSH
on the box itself.

Verify (from wherever the hosts entries point, per above): `curl http://central-ledger.local/health`,
`curl http://ml-api-adapter.local/health`, and `helm -n demo test moja --logs`.

## 8. Confirm `topic-event-audit` is actually there before running anything else

Don't proceed to FX scenarios until this is checked — it's the entire point of the exercise.

```bash
kubectl -n demo exec -it deploy/backend-kafka-controller -- \
  kafka-topics.sh --bootstrap-server localhost:9092 --list | grep topic-event-audit
```

The `kafka-console` release in `helmfile.yaml` (Redpanda Console) gives a browser UI for this instead —
port-forward it and watch the topic live while driving traffic in §9, rather than only inspecting after
the fact.

## 9. Drive the FX golden path

The TTK-driven simulators (`e2e-sim1` = payer, `e2e-sim2` = payee, `e2e-sim-fxp1` = FXP) are already
configured for `API_TYPE: iso20022`, `ILP_VERSION: "4"` in the values file. Two ways to run scenarios:

- **Automated**: trigger the ISO20022 golden-path TTK collection the same way CTH's
  `ttk-fx-sdk-tests` profile does (`--labels std,fx,fx-sdk`) — via `helm -n demo test` or the TTK CLI
  against `testing-toolkit.local`, once the exact collection name in this chart's TTK test-case bundle
  is confirmed (check `ml-testing-toolkit`'s mounted collections in the deployed pod).
- **Manual, for edge cases**: keep the TTK UI reachable and drive individual requests by hand — this is
  why TTK-UI stays enabled here (unlike the general resource-trim advice from the deployment guide) —
  manual control over a single request is what makes injecting a specific edge case possible, rather
  than only replaying a pre-scripted collection.

## 10. Edge-case matrix — this is what answers handover item 3.5

Golden path alone isn't the goal. Work through each of these against the FX corridor, capturing the
resulting `topic-event-audit` records for each:

| Scenario | How to trigger |
|---|---|
| FX quote rejected by FXP | Manual TTK request with a currency pair the FXP sim isn't configured for, or a rules-engine intercept |
| FX quote expiry | Delay the response leg past `expirationDate` before sending `PUT /fxQuotes/{ID}` |
| Transfer/FX-transfer abort | Payee (or FXP leg) sends `PUT .../error` instead of fulfilling |
| Transfer timeout | Don't fulfil at all; let the timeout handler sweep it |
| FXP insufficient liquidity / NDC breach | Set a low NDC on the FXP participant, send an amount that exceeds it |
| Duplicate/resend | Replay the identical `POST /fxQuotes` or `POST /fxTransfers` body with the same ID |
| ILP condition mismatch on the FX leg | Manually corrupt the fulfilment condition sent back |

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

## 13. Open risks / unknowns going in

- **SELinux/cgroup version on RHEL 8** — untested against `kind` on this host yet; §5's cluster-create
  step may need extra flags or a config change first. Check before assuming §5 runs as written.
- Whether `10.0.150.69:80/443` is reachable from wherever you'll browse the TTK UI (§7) is still open —
  separate from SSH/terminal reachability, which is clearly fine since the diagnostic command already
  ran there.
- The §3 resource budget is an estimate from reading values files, not a measured run — first deploy
  is the real test, and the trim list is there because of that, not despite it.
- Exact TTK collection name/labels for the FX+ISO20022 corridor in *this* chart's bundled TTK test
  cases hasn't been confirmed yet — flagged as a manual-UI fallback in §9 for that reason.
- inter-scheme-proxy-adapter version mismatch (§2) is untouched here since proxy/cross-scheme routing
  is out of scope for a single-scheme local FX test — revisit only if that changes.

# Deploying a Mojaloop Test Switch — and What Each Step Teaches You

You already know the transfer flow at the level of a single transaction. This guide connects that flow to the
pods, Helm releases and config files that implement it, then walks the deployment in order. Each step says what it does, why
it's needed, and how to check it worked.

**What we deploy:** `mojaloop/helm` **v17.2.0**, run with `helmfile` on a single-node **kind** cluster, in
**ISO 20022 + FX** mode with the **audit topic** turned on. We use this setup because it behaves like the production
COMESA/DRPP switch. Its central-ledger, ml-api-adapter, quoting-service and ALS versions match production
almost exactly.

Full command log, including every failure: [`../mojaloop-helm-iso20022-fx-local-deployment-plan.md`](../mojaloop-helm-iso20022-fx-local-deployment-plan.md).
Source for the component definitions: <https://mojaloop.io/how-it-works/>.

---

## 1. The flow, mapped to what you will deploy

The how-it-works page names the core of the Hub: **ALS** routes each payment to the right provider, the **Central
Ledger** clears transfers between DFSPs, and **Central Settlement** settles between FSPs and the Hub. The table below
shows which deployed services serve which phase.

| Phase | API (DFSP → Hub) | Service that handles it | Where state lives |
| --- | --- | --- | --- |
| **Discovery**: who owns this MSISDN? | `GET /parties/MSISDN/{id}` | `account-lookup-service` → its **oracle** | Oracle DB (identifier → FSP) |
| **Agreement**: fees and terms | `POST /quotes` | `quoting-service` | Quoting DB (MySQL) |
| **FX agreement** (cross-border only) | `POST /fxQuotes` | `quoting-service`, forwarded to the **FXP** | Quoting DB |
| **Transfer**: move the money | `POST /transfers`, `POST /fxTransfers` | `ml-api-adapter` → Kafka → `central-ledger` handlers | Central-ledger DB (MySQL) |
| **Settlement**: real money between banks | Settlement API | `central-settlement` | Central-ledger DB |

Three rules explain most of what you'll see during deployment:

1. **Everything is asynchronous.** Every request gets `202 Accepted`. The real answer comes later as a `PUT`
   **callback** to an endpoint the receiving DFSP registered in advance. If no callback URLs are registered, nothing
   ever gets answered (§5).
2. **The transfer phase runs over Kafka. Discovery and agreement don't.** ALS and quoting-service forward HTTP
   directly. The transfer phase is split across Kafka topics so that each step (prepare, position, fulfil,
   notify) is a separate handler.
3. **The Hub never sees the secret, only its hash.** At quote time the payee DFSP generates a secret **fulfilment**
   and sends back its SHA-256 hash, the **condition**. At transfer time the Hub reserves funds against the condition
   and commits only when the payee reveals a fulfilment that hashes to it.

### The transfer phase, topic by topic

```
Payer DFSP ──POST /transfers──▶ ml-api-adapter
                                   │ produce
                                   ▼
                          topic-transfer-prepare ──▶ central-ledger prepare handler   (validate, duplicate check)
                                                          ▼
                          topic-transfer-position(-batch) ──▶ position handler        (RESERVE: liquidity + NDC check)
                                                          ▼
                          topic-notification-event ──▶ ml-api-adapter notification handler ──POST──▶ Payee DFSP

Payee DFSP ──PUT /transfers/{id} (fulfilment)──▶ ml-api-adapter
                                   ▼
                          topic-transfer-fulfil ──▶ fulfil handler                    (SHA-256(fulfilment) == condition?)
                                                          ▼
                          position handler (COMMIT) ──▶ notification ──▶ both DFSPs

timeout handler (cron) ──▶ sweeps RESERVED transfers past expiry ──▶ releases funds, notifies both
```

Topic names follow central-ledger's template `topic-{functionality}-{action}` (`central-ledger/config/default.json`).
FX position events (`FX_PREPARE`, `FX_RESERVE`, `FX_ABORT`, …) are routed to **`topic-transfer-position-batch`**, so
the **batch** position handler has to run. This matters again in §4.

### The audit topic, `topic-event-audit`

Every core service embeds `@mojaloop/event-sdk`. With `AUDIT: kafka` set, each service writes a record for every
request it handles: a `start` record on the way in, and `egress` records on the way out. These are
not business messages. They are a side channel that **observes** the flow, and they are what our MLA consumes.

---

## 2. The layers you are building

```
Host (RHEL 8.10, 8 cores, 31 GB)
└── Docker
    └── kind cluster "mojaloop-fx"   (Kubernetes running inside a Docker container)
        ├── ingress-nginx             (HTTP routing by hostname)
        └── namespace "demo", three Helm releases (orchestrated by helmfile):
            ├── backend        — Kafka, MySQL, Redis, MongoDB          (infrastructure)
            ├── moja           — ALS, quoting, ml-api-adapter, central-ledger handlers,
            │                    simulators (payer / payee / FXP), Testing Toolkit (TTK)
            └── kafka-console  — Redpanda Console, a browser UI for Kafka topics
```

`backend` and `moja` are separate releases because the services can't start until their databases and broker
exist. Keeping them separate also lets you redeploy services without touching their data.

---

## 3. Deployment steps

Run all of these as root on the host.

### Step 1: Toolchain

| Tool | Role |
| --- | --- |
| `kubectl` | Talks to the cluster |
| `kind` | Creates the cluster (each Kubernetes node is a Docker container) |
| `helm` | Installs one chart: a templated bundle of Kubernetes manifests |
| `helmfile` + `helm-diff` | Installs several charts together, from one `helmfile.yaml`. This is the Mojaloop repo's own local method. |

`helmfile` release filenames include the version number, so get the download URL from the GitHub API rather than a
"latest" link (plan §4).

### Step 2: Cluster

```bash
kind create cluster --name mojaloop-fx --config kind-config.yaml
kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/main/deploy/static/provider/kind/deploy.yaml
```

`kind-config.yaml` does two things (full file in plan §5):
- It maps host ports **80/443** into the node, so ingress hostnames are reachable from outside the cluster.
- It adds a `KubeletConfiguration` patch with **`failCgroupV1: false`**. This RHEL 8 host uses cgroup v1, and recent
  kubelets refuse to start on it by default.

**Check:** `kubectl get nodes` shows `Ready`, and every pod in `kube-system`/`ingress-nginx` is `Running` with zero
restarts.

### Step 3: Chart source and dependencies

```bash
git clone --depth 1 --branch v17.2.0 https://github.com/mojaloop/helm.git ~/mojaloop-helm
helm repo add bitnami https://charts.bitnami.com/bitnami        # plus mojaloop, mojaloop-charts, redpanda,
# elastic, codecentric, kokuwa, ory — full list in plan §6
helm repo update
cd ~/mojaloop-helm && sh update-charts-dep.sh                     # pulls ~50 dependency sets
```

The chart is an umbrella: `mojaloop/` depends on a separate chart per service. `update-charts-dep.sh` runs with
`--skip-refresh`, so **every repo must be added first**. If a chart's dependency repo is missing, find the repo in that
chart's own `Chart.yaml`, add it, and re-run.

### Step 4: Values, which decide what kind of switch you get

The files are in `local-deployment-methods/helmfile/`.

| File | Effect |
| --- | --- |
| `values-mojaloop-iso20022.yaml` (the **full** one) | Sets `API_TYPE: iso20022`, turns on the audit topic through a shared `EVENT_SDK_CONFIG` anchor for six services, and deploys the FX simulators |
| ~~`values-mojaloop-iso20022-min.yaml`~~ | **Do not use.** It removes the FXP simulator, which leaves you no way to test FX. |
| Our trims on top | `centralsettlement.enabled: false` and `transaction-requests-service.enabled: false`. Neither is on the path we test. |
| Our fix on top | `centralledger.centralledger-handler-transfer-position.enabled: false` (explained below) |

Why disable the **non-batch** position handler: both handlers claim the same ingress hostname, so the deploy fails.
FX position events only go to the batch topic anyway (§1), so the non-batch handler adds nothing here. In short, the
ledger has two ways to process positions, and FX needs the batch one.

Point `helmfile.yaml`'s `moja` release at your values file, and set `timeout: 1800` on both releases. Image pulls
can take longer than Helm's default 5-minute wait.

### Step 5: Deploy

```bash
cd ~/mojaloop-helm/local-deployment-methods/helmfile && helmfile apply
```

**Check pods yourself. Helm reporting `deployed` doesn't mean the pods are healthy.**

```bash
kubectl get pods -n demo --no-headers | awk '{print $3}' | sort | uniq -c
# target: 51 Running, 1 Completed (a one-shot setup job), nothing else
```

What the real deploy ran into, and what each problem shows about Mojaloop:

| Symptom | Cause | Lesson |
| --- | --- | --- |
| Simulators in `CrashLoopBackOff`, `ttksims-redis-master` not found | A "safe" backend trim had disabled the Redis the simulator SDKs cache into | Simulator pods each run a real **SDK scheme adapter**, which is stateful. They aren't static stubs. |
| TTK: `secret "ttk-mongodb" not found` | Same trim disabled TTK's MongoDB | Disabling a release also removes the Secrets other releases read from it |
| Simulators still crash-looping after Redis is up | They began backing off before Redis was ready | A startup race, not a bug. It clears on its own. |
| `helmfile apply` times out on `stable`/`mojaloop` repos | helmfile refreshes every listed repo, including unused ones | Remove repos that no release uses |

### Step 6: Confirm the audit topic

```bash
kubectl exec -n demo kafka-controller-0 -- kafka-topics.sh --bootstrap-server localhost:9092 --list
```

You'll see `topic-transfer-*`, `topic-quotes-*`, `topic-fx-*` and `topic-notification-event`, but **no
`topic-event-audit` yet**. That's expected. The broker auto-creates a topic on its first produce, and nothing has
produced to it yet. It appears once the first real request is handled.

---

## 4. Onboarding: the switch starts empty

Helm installs the **Hub** but no **participants**. Before the first transfer works, you must create each of the
following, in order. Each one is a ledger concept made concrete:

| # | What | Why the ledger needs it | What fails without it |
| --- | --- | --- | --- |
| 1 | **Hub accounts** per currency: `HUB_RECONCILIATION`, `HUB_MULTILATERAL_SETTLEMENT` | The Hub is a participant too. Funds-in and settlement are double-entry, so they need a Hub-side account to post against. | DFSP currency registration is refused |
| 2 | **Settlement model** (`DEFAULTNET`: NET, MULTILATERAL, DEFERRED) | Says how positions are eventually settled. A participant can't hold a position without one. | Participant position creation is refused |
| 3 | **DFSPs** (`e2e-sim1` payer, `e2e-sim2` payee, `e2e-sim-fxp1` FXP), their position accounts, **NDC limits**, and **callback endpoints** (12 each) | The callback endpoints are where the Hub delivers every async `PUT` (§1, rule 1) | Requests are accepted and then never answered |
| 4 | **Party registration** in ALS: `POST /participants/MSISDN/9990002001` → `e2e-sim2` | Fills the **oracle**, so discovery can resolve the MSISDN | `GET /parties` cannot find the payee |
| 5 | **Funds-in** to each DFSP's settlement account ([`s_fund.js`](../fx-edge-case-scripts/s_fund.js)) | A DFSP can only reserve funds it has deposited, up to its limit | Every prepare fails with **`4001`** |

Two different checks happen in the position handler:
- **Liquidity:** does the DFSP have the funds? If not → `4001`.
- **Net Debit Cap (NDC):** is it within its allowed limit? If not → `4200`.

These are separate conditions with separate error codes (captures `01_` and `05_`).

ISO 20022 mode also changes the **headers**. ALS expects
`application/vnd.interoperability.iso20022.participants+json;version=2.0`. The plain-FSPIOP media type is rejected.

---

## 5. Driving traffic

This deployment has no single gateway, because each service has its own Kubernetes Service. So the scripts run
**inside the cluster**, from the TTK backend pod. [`fx-edge-case-scripts/run.sh`](../fx-edge-case-scripts/run.sh)
sends a script to `kubectl exec ... node -`. Read that folder's README before you build any request by hand. The
non-obvious requirements are:

- **Bodies must be ISO 20022**, built with `ml-schema-transformer-lib` (which converts FSPIOP to ISO).
- **IDs must be ULIDs, not UUIDs.** IDs map onto `PmtId.EndToEndId`, which allows at most 35 characters. A UUID has 36.
- **The condition must be real.** In ISO mode it travels inside the ILP packet (`VrfctnOfTerms.IlpV4PrepPacket`),
  so a copied sample packet won't validate.

### The cross-border FX corridor (`XXX → XTS`)

| Step | Call | What happens |
| --- | --- | --- |
| 1 | `POST /fxQuotes` → FXP | The FXP returns conversion terms with a **`conversionId`** |
| 2 | `POST /quotes` → payee | The payee returns terms + ILP packet + condition |
| 3 | `POST /fxTransfers` | Reserves the payer → FXP leg. **`commitRequestId` must equal the `conversionId`**, because the FXP looks up its cached quote by that ID. Otherwise it returns a bare `2001`. |
| 4 | `POST /transfers` | The payee leg: prepare → fulfil → `COMMITTED` |

Scripts: `s_fx_corridor_step{1,2,3}.js`.

**One fix that must be applied after every fresh deploy:** the simulators' TTK backend downloads its OpenAPI specs from
GitHub when it boots. When that download fails, the pod still shows `1/1 Running`, but its spec API never starts,
and the FXP answers every FX quote with `2001`. The fix is to patch the backend's ConfigMap with the local copies in
[`../ttk-sim-offline-specs/`](../ttk-sim-offline-specs/) and restart the pod (plan §9.19–9.21). This patch is **not in
the chart values**, so `helmfile apply` undoes it.

---

## 6. Watching it on the audit topic

The `operation` tag on each record names the step. A successful FX corridor produces, in order:

```
postFxQuotes → putFxQuotesByID → postQuotes → putQuotesByID
→ prepareFxTransfer / reserveFxTransfer → fulfilFxTransfer
→ prepareTransfer → fulfilTransfer / commitTransfer
```

Match each one to the table in §1: quoting-service writes the first four, and ml-api-adapter plus central-ledger
write the rest. Real captures for nine scenarios are in
[`../topic-event-audit-edge-case-captures/`](../topic-event-audit-edge-case-captures/). Compare `02_` (success) with
`03_`, `04_` and `06_` (failures) to see how each failure changes the record sequence.

Watch it live in Redpanda Console (the `kafka-console` release) with `kubectl port-forward`.

---

## 7. Behaviours worth internalizing

These were observed on this deployment, not read from the docs:

- **"Running" isn't proof of health.** The broken TTK backend reported healthy while half of it was down. Test by
  sending a real request.
- **The quoting service doesn't enforce quote expiry.** An expired `POST /fxQuotes` is accepted. Expiry is enforced
  only at the **transfer** stage, by the timeout handler (`3303`, swept about 12 s after expiry).
- **Specific errors get flattened.** A fulfilment that doesn't hash to the condition is logged as `invalid fulfilment`
  but reaches the payer as a generic `3100`. Quoting-service turns most downstream errors into `"Network error"`.
- **Quoting-service doesn't translate between formats.** It forwards the caller's media type unchanged, so a
  plain-FSPIOP DFSP and an ISO 20022 DFSP cannot quote each other through it.
- **A rejected transfer can carry the same `operation` tag as an accepted one.** Only the attached error tells
  them apart, so you can't classify events by tag alone.

---

## 8. Check your understanding

<details><summary>1. A DFSP sends <code>POST /transfers</code> and gets <code>202</code>, but no callback ever arrives. Name two causes.</summary>

The payee's or payer's callback endpoints were never registered (onboarding step 3). Or a Kafka handler pod in the
chain (prepare, position or notification) is down, so the message is stuck on a topic.
</details>

<details><summary>2. Why is <code>topic-event-audit</code> missing right after a healthy deploy?</summary>

Nothing has produced to it yet. The topic is auto-created on the first produce, and services only produce to it when
they handle a real request.
</details>

<details><summary>3. Prepare fails with <code>4001</code>, yet the NDC is set high. Why?</summary>

The NDC is a limit, not money. `4001` means insufficient liquidity: no funds-in was recorded to the settlement account.
</details>

<details><summary>4. Why can the Hub commit a transfer without trusting the payee?</summary>

It holds the condition from the quote. It commits only if SHA-256 of the revealed fulfilment equals that condition.
</details>

<details><summary>5. What breaks if you deploy with the <code>-min</code> values file?</summary>

The FXP simulator isn't deployed, so `POST /fxQuotes` has no counterparty and the FX corridor can't run.
</details>

<details><summary>6. You run <code>helmfile apply</code> to change one value, and FX quotes start returning <code>2001</code>. What happened?</summary>

The apply rewrote the TTK backend's ConfigMap and removed the offline-spec patch. The backend went back to fetching
specs from GitHub and failed.
</details>

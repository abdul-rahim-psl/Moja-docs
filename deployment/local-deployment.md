# MLA local dry run — before handing the deployment plan to COMESA

**What this document is.** A plan to deploy MLA on `10.0.150.69` — the same machine already running the
`mojaloop-fx` kind cluster used for the ISO 20022 + FX deployment work — as a dry run of
[`MLA-deployment-kubernetes.md`](MLA-deployment-kubernetes.md)'s deliverable set, before that document's
manifests and instructions go to COMESA's techops team. The point is to be sure the mechanism actually
works — image, manifests, config surface, secrets, health probes, the whole `kubectl apply -f` path — on
infrastructure we control, rather than have COMESA be the first place any of it is tried for real.

**What this document is not.** It does not answer any of `MLA-deployment-kubernetes.md` §11's six open
questions for CCH (real broker address, dedicated consumer group ID, the VPN-side PPA endpoint, mTLS
provisioning, registry, metrics scraping). Those stay CCH's to supply regardless of how this dry run goes.
What this proves is narrower and still worth proving: that the manifests apply cleanly, MLA starts,
connects to a real Kafka broker carrying real `topic-event-audit` traffic, tokenizes correctly, and calls
a real mTLS-authenticated downstream — the full mechanical path, end to end.

---

## 1. Where it runs

The same `mojoloop-fx` kind cluster on `10.0.150.69`, in a **new namespace, `mla`** — kept separate from
`demo` (where the switch itself lives) rather than mixed in, while still reaching the **same real Kafka
broker** that the FX corridor work already writes to
([`mojaloop-helm-iso20022-fx-local-deployment-plan.md`](mojaloop-helm-iso20022-fx-local-deployment-plan.md)
§9.21). This is a stronger test than `cch-mla`'s own local dev harness
(`docker-compose.dev.yml`, a throwaway single-node Redpanda instance) — here MLA consumes genuinely real
switch traffic, including the FX corridor captured as `09_fx_corridor_happy_path`.

**Confirmed, not guessed** (re-verified live on the cluster):
- Cluster healthy: `mojaloop-fx-control-plane` node `Ready`, 51 pods `Running` + 1 `Completed` in `demo`,
  unchanged from the FX corridor work.
- Kafka bootstrap address reachable from any namespace: **`kafka.demo.svc.cluster.local:9092`** — a plain
  `ClusterIP` Service (`kafka`, port `9092/TCP`), not the headless per-broker Service. This is the value
  `KAFKA_BROKERS` uses below.

## 2. Components to stand up

Two deployments, since no real PPA is reachable from this environment yet:

| Component | Role | Source |
| --- | --- | --- |
| **`cch-mla`** | The thing actually being validated | `cch-mla/Dockerfile`, unchanged |
| **`ppa-stub`** | Stand-in for PPA — real mTLS, records every accepted envelope to disk | Already exists in-repo at `cch-mla/tools/ppa-stub/` — a genuine Fastify server with a real mTLS-authenticated business port (`/QUOTES`, `/FXQUOTES`, `/TRANSFERS`, `/FXTRANSFERS`, port 4443) and a plain HTTP health/control port (4001). Not something to build; it already exists for exactly this purpose. |

## 3. Config surface for this dry run

Mapping [`MLA-deployment-kubernetes.md`](MLA-deployment-kubernetes.md) §5/§9's skeleton onto this cluster:

| Variable | Value for this dry run |
| --- | --- |
| `KAFKA_BROKERS` | `kafka.demo.svc.cluster.local:9092` |
| `KAFKA_GROUP_ID` | `cch-mla-dryrun` — dedicated, does not collide with anything switch-internal |
| `KAFKA_AUDIT_TOPIC` | `topic-event-audit` — already real and populated |
| `PPA_BASE_URL` | `https://ppa-stub.mla.svc.cluster.local:4443` (in-cluster Service, mTLS) |
| Every other row §5 marks "Settled" | Copied straight from `cch-mla/.env.template`'s defaults, unchanged |

## 4. Secrets

All three generated locally, never guessed or baked into the image:

1. **mTLS pair** (MLA ↔ ppa-stub) — `cch-mla/tools/ppa-stub/scripts/generate-certs.sh` already generates
   a local CA plus server/client cert pair, but the server cert's SAN is `localhost`/`127.0.0.1` only.
   **Needs regenerating with the in-cluster Service DNS name** (`ppa-stub.mla.svc.cluster.local`) in the
   SAN, or MLA's TLS handshake will fail hostname verification — a one-line edit to the script's `openssl`
   invocation, not a redesign.
2. **JWS public keys** — `npm run keys:generate` (`cch-mla/tools/dfsp-keys`) already produces a test
   keypair/store in the shape `JWS_PUBLIC_KEY_DIR` expects.
3. **PII secret** — `npm run pii-secret:generate` (`cch-mla/tools/pii-secret`) already produces one.

All three become Kubernetes `Secret` objects (`kubectl create secret generic ... --from-file=...`) mounted
read-only, per `engineering-rules.md` §8's "certificates and keys are mounted, not embedded."

## 5. Image delivery

No registry needed — it's a kind cluster:
```bash
docker build -t cch-mla:dryrun cch-mla/
kind load docker-image cch-mla:dryrun --name mojaloop-fx
```
`ppa-stub` has no `Dockerfile` of its own yet — either add a small one, or run it off the same base image
with a different `CMD`/entrypoint (`node tools/ppa-stub/index.ts` under `ts-node`, or a compiled build
step first). Load the same way.

## 6. Manifests

Following [`MLA-deployment-kubernetes.md`](MLA-deployment-kubernetes.md) §9's skeleton, with real values
in place of every `<ANGLE-BRACKET>`:

- `Namespace` — `mla`
- `ConfigMap` — `cch-mla-config`, the settled + dry-run values from §3 above
- `Secret` × 3 — mTLS pair, JWS key store, PII secret
- `Deployment` × 2 — `cch-mla`, `ppa-stub`
- `Service` × 2 — both `ClusterIP` (`cch-mla` port 3001, `ppa-stub` ports 4443 + 4001)

## 7. Verification — the actual point of doing this

1. `kubectl apply -f` everything; confirm `cch-mla`'s pod reaches `Ready`. Readiness here means **Kafka
   connected + PII secret loaded — not PPA** (`MLA-deployment-kubernetes.md` §4's own documented,
   load-bearing distinction). Confirm `ppa-stub` is `Ready` too.
2. Generate **fresh, real** `topic-event-audit` traffic by re-running one of the already-proven scripts in
   [`fx-edge-case-scripts/`](fx-edge-case-scripts/) (the FX corridor, or the plain P2P baseline).
3. Watch `cch-mla`'s logs: consumer group join, pickup of the new record, PII tokenization, the outbound
   mTLS call to `ppa-stub`.
4. Inspect `ppa-stub`'s recorded output (`tools/ppa-stub/output/received.jsonl`, or its `/control`
   endpoint) — confirms exactly what MLA sent, and that the mTLS handshake genuinely succeeded end to end.
5. Check `/health/live`, `/health/ready`, `/metrics` directly (`kubectl exec ... curl`).
6. Kill `ppa-stub` briefly and confirm MLA's retry/circuit-breaker behavior — readiness should **stay**
   `Ready` throughout (a downstream outage must not pull a healthy replica out of rotation).

## 8. Honest limits of this dry run

Self-signed certs and an in-cluster stub are not real mTLS-over-VPN to a real PPA, and this cluster's
Kafka is not CCH's. This proves the mechanism, not CCH's specific answers to
[`MLA-deployment-kubernetes.md`](MLA-deployment-kubernetes.md) §11 — those still come from Oscar's team's
reply regardless of how cleanly this dry run goes.

## 9. Status

Implementation starting. §10 is the working checklist — check items off as they're done rather than
re-deriving this plan from scratch in a future session.

## 10. Implementation checklist

**Prep**
- [x] Confirm cluster still healthy (`kubectl get nodes`, pod count in `demo`) before changing anything.
- [x] Create the `mla` namespace.

**Secrets**
- [x] Edit `cch-mla/tools/ppa-stub/scripts/generate-certs.sh` — made the server cert's SAN extensible via
  an optional `PPA_STUB_EXTRA_SAN` env var (backward compatible; doesn't change the docker-compose harness's
  default behavior) rather than hardcoding this dry run's namespace into the shared script.
- [x] Run `PPA_STUB_EXTRA_SAN="DNS:ppa-stub.mla.svc.cluster.local,DNS:ppa-stub" npm run certs:generate` —
  verified server cert SAN now includes both.
- [x] JWS test key store and PII secret were already generated by a prior session (`tools/dfsp-keys/store`,
  `tools/pii-secret/generated/local.secret`) — reused as-is, no regeneration needed.
- [x] Created four K8s `Secret` objects in `mla` (shipped over SSH as tarballs, extracted, loaded, then the
  plaintext removed from the remote host):
  - `cch-mla-ppa-mtls` (`ca.crt`, `client.crt`, `client.key`) — MLA's outbound identity + PPA's CA
  - `cch-ppastub-server-tls` (`ca.crt`, `server.crt`, `server.key`) — ppa-stub's own server identity
  - `cch-mla-jws-keys` (19 `<dfspId>.pem` files)
  - `cch-mla-pii-secret` (`secret`)

**Images**
- [x] `docker build -t cch-mla:dryrun cch-mla/` — built locally (this machine has internet egress; the
  remote host does not, same constraint as the TTK backend fix). 232MB, distroless as expected.
- [x] Added `cch-mla/tools/ppa-stub/Dockerfile` — deliberately a simpler single-stage `node:22-bullseye` +
  `ts-node` build, not distroless multi-stage like `cch-mla`'s own — it's a test stub, never shipped
  anywhere near COMESA. Hardened `.dockerignore` alongside it so no cert/key material ever lands in an
  image layer.
- [x] `docker build -f tools/ppa-stub/Dockerfile -t ppa-stub:dryrun cch-mla/` — 1.78GB (full Debian base +
  dev deps for `ts-node`; acceptable for a stub).
- [x] Shipped both images to the remote host via `docker save | ssh ... docker load` (no registry needed).
- [x] `kind load docker-image cch-mla:dryrun --name mojaloop-fx` — confirmed present on the node via
  `crictl images`.
- [x] `kind load docker-image ppa-stub:dryrun --name mojaloop-fx`.

**Manifests**
- [x] Write `ConfigMap` (`cch-mla-config`) with §3's values — `cch-mla/deploy/kubernetes-dryrun/00-configmap.yaml`.
- [x] Write `Deployment` + `Service` for `cch-mla` — `02-mla-deployment.yaml`.
- [x] Write `Deployment` + `Service` for `ppa-stub` — `01-ppastub-deployment.yaml`.
- [x] `kubectl apply -f` the full manifest set to the `mla` namespace.

**Real bug found and fixed along the way**: `ppa-stub`'s control port crashed on first boot —
`RangeError: options.port should be >= 0 and < 65536. Received type number (NaN)`. Root cause: the tool
reads `process.env.PPA_STUB_PORT` for its own control-port number, but Kubernetes auto-injects a
same-named `<SERVICE_NAME>_PORT` env var (`tcp://10.96.x.x:4001`, a string) into every pod that can see a
Service literally named `ppa-stub` — a genuine latent bug in the tool, not something specific to this
dry run's manifests, that would bite anyone running `ppa-stub` as a real K8s Service. Fixed at the source:
renamed to `PPA_STUB_CONTROL_PORT` everywhere it's read (`tools/ppa-stub/index.ts`,
`tools/scenario-library/{harness,run}.ts`, `tools/README.md`), symmetric with the already-safe
`PPA_STUB_MTLS_PORT`. Rebuilt, reshipped, redeployed — both listeners now bind cleanly.

**Verify**
- [x] `cch-mla` pod reaches `Ready` on first boot — **1/1 Running immediately**, no restarts. Logs confirm
  `Kafka consumer connected`, `Subscribed to topic-event-audit`, consumer group `cch-mla-dryrun` joined
  cleanly (assigned partition 0 — this cluster's audit topic has fewer partitions than the 12-partition
  production spec, expected for a lean local deployment). Hit `/health/live` and `/health/ready` directly
  from inside the pod: `{"status":"UP","kafka":"UP","piiSecret":"UP","jwsKeyStore":"UP"}` — all three
  dependencies genuinely verified, not just an assumption from the probe passing.
- [x] `ppa-stub` pod reaches `Ready` — after the `PPA_STUB_CONTROL_PORT` fix above, both the control
  (4001) and mTLS (4443) listeners bind cleanly on first boot; health checks passing continuously.

**Real bug #2 found and fixed**: `cch-mla`'s Kafka consumer **crashed outright** on the first real message
— `KafkaJSNotImplemented: LZ4 compression not implemented`. This cluster's switch compresses
`topic-event-audit` with LZ4; `kafkajs` ships no compression codecs beyond GZIP by design (Snappy/LZ4/ZSTD
are meant to be pluggable). This would break against **any** real Mojaloop switch using LZ4 (a very
common default), not just this one — a real, previously-latent gap in `cch-mla` itself, not an artifact of
this dry run. Fixed at the source: added `kafka-lz4-lite` (pure-JS, zero native build step — matters for
`cch-mla`'s distroless runtime image; actively maintained, unlike the widely-cited but 5-years-stale
`kafkajs-lz4`) as a real dependency, registered once at module load in `src/clients/kafka.client.ts`.
Updated `__tests__/kafka.client.test.ts`'s `kafkajs` mock to match the real module's shape
(`CompressionCodecs`/`CompressionTypes` weren't previously mocked). Full suite re-run clean: 25 suites,
400 tests, 100% statement coverage maintained. Rebuilt, reshipped, redeployed.

**Verify**
- [x] `cch-mla` pod reaches `Ready` on first boot — **1/1 Running immediately**, no restarts. Logs confirm
  `Kafka consumer connected`, `Subscribed to topic-event-audit`, consumer group `cch-mla-dryrun` joined
  cleanly (assigned partition 0 — this cluster's audit topic has fewer partitions than the 12-partition
  production spec, expected for a lean local deployment). Hit `/health/live` and `/health/ready` directly
  from inside the pod: `{"status":"UP","kafka":"UP","piiSecret":"UP","jwsKeyStore":"UP"}` — all three
  dependencies genuinely verified, not just an assumption from the probe passing.
- [x] Generated fresh real `topic-event-audit` traffic two ways: (a) re-ran `fx-edge-case-scripts/
  s_xfer_happy.js` (a real plain P2P transfer, unsigned — correctly triggered the JWS rejection path,
  `SECURITY: missing FSPIOP-Signature`, confirming that check fires as designed); (b) used `cch-mla`'s
  own `tools/capture-feeder` to feed **real DRPP reference transactions**
  (`DRPP_Kafka_E2E_Pack/01_MWK_to_ZMW_PRIMARY` and `02_ZMW_to_MWK`) through a `kubectl port-forward` +
  local SSH tunnel, **re-signed** with freshly generated JWS keys (`npm run keys:generate`) whose public
  halves were loaded into the cluster's `cch-mla-jws-keys` secret — a genuine signed-message path, not
  guessed. (Reaching the tunneled broker required one local `/etc/hosts` entry for the broker's
  advertised internal FQDN — a standard Kafka-behind-port-forward wrinkle, not an MLA issue.)
- [x] Confirmed in `cch-mla` logs: consumer group join, record pickup, **JWS signature verified** (no
  security warnings against the resigned traffic), **PII tokenization** confirmed directly in `ppa-stub`'s
  received payloads (party `partyIdentifier`/`complexName` fields show `tkn_...` values, not raw MSISDNs),
  classification into `FXQUOTE`/`QUOTE`/`FXTRANSFER`/`TRANSFER`, and `ingestion.ppa-delivery: Forwarded
  ...` for all four event types — the complete real corridor lifecycle, ending `TxSts: COMM`.
- [x] Inspected `ppa-stub`'s `output/received.jsonl` — all 8 envelopes (request+callback × 4 event types)
  present, correctly shaped, tokenized fields intact, delivered over genuinely authenticated mTLS.
- [x] Checked `/metrics` on `cch-mla` directly: `mla_forwarded_total` = 2 per event type (8 total),
  `mla_ppa_delivery_outcomes_total{outcome="success"}` = 8, `mla_ack_latency_ms` all under 100ms (well
  inside the 200ms p95 budget the metric itself documents), zero tokenization/keystore/breaker failures,
  consumer lag 0.
- [x] Scaled `ppa-stub` to 0 replicas, fed a second real transaction (`02_ZMW_to_MWK`): `cch-mla` logged
  `PPA unreachable ... after retrying - parking event, pausing partition 0`, and **`/health/ready` stayed
  `UP`** throughout (`kafka: UP`) — exactly the documented, load-bearing readiness/liveness distinction in
  `MLA-deployment-kubernetes.md` §4, now genuinely observed, not just read.
- [x] Scaled `ppa-stub` back to 1. (Found and fixed a second, minor issue along the way: `ppa-stub`'s
  256Mi memory limit was too tight for a full `ts-node` process — got OOMKilled. This is a dry-run infra
  sizing detail specific to my own stub manifest, not an MLA/PPA finding; bumped to 512Mi.) Once genuinely
  healthy, `cch-mla` logged `PPA recovered ... circuit breaker reset, resuming partition 0` and delivered
  the parked event plus the entire queued second transaction — fully automatically, with **no restart of
  `cch-mla` itself**.

**Wrap-up**
- [x] This section **is** the outcome. Summary: the deployment mechanism (image, manifests, config
  surface, secrets, probes) works exactly as `MLA-deployment-kubernetes.md` describes. Two real,
  previously-unknown bugs were found and fixed at the source (not worked around): `cch-mla` couldn't
  consume LZ4-compressed Kafka messages at all (would have broken against any real switch using it — very
  plausibly including CCH's); `ppa-stub`'s own control-port env var collided with Kubernetes' automatic
  Service-discovery injection (a latent bug in the tool, not this dry run's manifests). Both fixes are
  general, not local-only workarounds, and should be treated as already-applied prerequisites — not new
  open items — before `MLA-deployment-kubernetes.md`'s real manifests go to COMESA.

## 11. Redeploying after an MLA code change

The `mla` namespace, once stood up, is meant to be reused, not rebuilt from scratch each time. The one
recurring case worth documenting precisely: **you changed `cch-mla`'s source and need that change running
on `10.0.150.69`.**

`10.0.150.69` has no internet egress (the same constraint §9.19/§9.20 of
[`mojaloop-helm-iso20022-fx-local-deployment-plan.md`](mojaloop-helm-iso20022-fx-local-deployment-plan.md)
hit fixing the FX simulator backend) — there is no registry in the loop, so the image has to be built
locally, where Docker Hub/gcr.io *are* reachable, and shipped over as a raw image stream every time.

```bash
cd cch-mla

# 1. Rebuild locally (needs your changed source; this machine has internet egress, the remote doesn't)
docker build -t cch-mla:dryrun .

# 2. Ship the built image straight into the remote host's docker daemon - no registry involved
docker save cch-mla:dryrun | ssh -i ~/.ssh/mojaloop_fx_10_0_150_69 -o IdentitiesOnly=yes root@10.0.150.69 "docker load"

# 3. Load it into the kind cluster's node - `docker load` only makes it visible to the host's
#    docker daemon, not to the kind node's own separate containerd image store
ssh -i ~/.ssh/mojaloop_fx_10_0_150_69 -o IdentitiesOnly=yes root@10.0.150.69 "kind load docker-image cch-mla:dryrun --name mojaloop-fx"

# 4. Force the pod to pick up the new image. The manifest pins the tag `cch-mla:dryrun` with
#    imagePullPolicy: IfNotPresent, so Kubernetes has no reason to notice the tag's content
#    changed on its own - deleting the pod is what makes the Deployment start a fresh container
#    against whatever that tag currently points to on the node.
ssh -i ~/.ssh/mojaloop_fx_10_0_150_69 -o IdentitiesOnly=yes root@10.0.150.69 "kubectl delete pod -n mla -l app=cch-mla"
```

Then confirm it came back clean:
```bash
ssh -i ~/.ssh/mojaloop_fx_10_0_150_69 -o IdentitiesOnly=yes root@10.0.150.69 "kubectl get pods -n mla && kubectl logs -n mla deploy/cch-mla --tail=20"
```

**Only step 1 needs the changed source.** Steps 2–4 are identical every time and need no manifest edits,
*unless* the change also touches the ConfigMap/env surface (§3) or the secret-backed paths (§4) — in
which case update and re-`kubectl apply` `00-configmap.yaml` (or the relevant secret) before restarting
the pod, same principle as step 4.

The exact same four-step shape applies to `ppa-stub` (`docker build -f tools/ppa-stub/Dockerfile ...`,
same save/load/kind-load/delete-pod sequence) — needed far less often, since it's a stable test stub, not
the thing under active development.

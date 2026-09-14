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
- [ ] Confirm cluster still healthy (`kubectl get nodes`, pod count in `demo`) before changing anything.
- [ ] Create the `mla` namespace.

**Secrets**
- [ ] Edit `cch-mla/tools/ppa-stub/scripts/generate-certs.sh` — add
  `ppa-stub.mla.svc.cluster.local` to the server cert's `subjectAltName`.
- [ ] Run `npm run certs:generate` (mTLS CA + server + client cert/key).
- [ ] Run `npm run keys:generate` (JWS test key store).
- [ ] Run `npm run pii-secret:generate` (PII tokenization secret).
- [ ] Create the three K8s `Secret` objects in `mla` from the generated files
  (mTLS pair, JWS key store, PII secret).

**Images**
- [ ] `docker build -t cch-mla:dryrun cch-mla/`.
- [ ] Add a way to run `ppa-stub` as a container (small `Dockerfile`, or reuse `cch-mla`'s build with a
  different `CMD`).
- [ ] `docker build -t ppa-stub:dryrun ...`.
- [ ] `kind load docker-image cch-mla:dryrun --name mojaloop-fx`.
- [ ] `kind load docker-image ppa-stub:dryrun --name mojaloop-fx`.

**Manifests**
- [ ] Write `ConfigMap` (`cch-mla-config`) with §3's values.
- [ ] Write `Deployment` + `Service` for `cch-mla` (port 3001, probes per
  `MLA-deployment-kubernetes.md` §4, volume mounts for the three secrets).
- [ ] Write `Deployment` + `Service` for `ppa-stub` (ports 4443 mTLS + 4001 control/health).
- [ ] `kubectl apply -f` the full manifest set to the `mla` namespace.

**Verify**
- [ ] `cch-mla` pod reaches `Ready` (readiness = Kafka connected + PII secret loaded, not PPA).
- [ ] `ppa-stub` pod reaches `Ready`.
- [ ] Re-run a proven script from `fx-edge-case-scripts/` to generate fresh real `topic-event-audit`
  traffic.
- [ ] Confirm in `cch-mla` logs: consumer group join, record pickup, PII tokenization, outbound mTLS
  call to `ppa-stub`.
- [ ] Inspect `ppa-stub`'s `tools/ppa-stub/output/received.jsonl` (or `/control`) — confirm the received
  envelope matches what MLA should have sent.
- [ ] Check `/health/live`, `/health/ready`, `/metrics` on `cch-mla` directly.
- [ ] Kill `ppa-stub`, confirm `cch-mla` stays `Ready` (retry/circuit-breaker absorbs the outage rather
  than failing readiness).
- [ ] Restart `ppa-stub`, confirm `cch-mla` resumes delivering without a restart of its own.

**Wrap-up**
- [ ] Update this document's §9/§10 with the outcome (what worked, what didn't, anything worth folding
  back into `MLA-deployment-kubernetes.md` before it goes to COMESA).

# MLA Deployment — Kubernetes <!-- omit in toc -->

**What this document is.** The plan for getting MLA running on COMESA/CCH's Kubernetes cluster, in
response to an explicit ask from CCH techops (Oscar R. Cobar, 2026-09-14 — quoted in full in §1). It
covers the architecture that ask sits inside, the artifact set MLA needs (image, manifests, config
surface), what we can produce unconditionally versus what only CCH can supply, and the open questions
that need an answer before any of it can be applied to a real cluster.

**What this document is not.** It is not the manifests themselves yet — §4 and §9 describe what they
will contain, with a worked skeleton, but real values (broker address, consumer group ID, the VPN-side
PPA URL, registry location) are named as open in §8 rather than guessed. This is `plan.md`'s Phase 8
"Kubernetes manifests" checklist bullet, being scoped ahead of the rest of that phase — see §10.

- [1. The ask, as received](#1-the-ask-as-received)
- [2. Architecture — where MLA actually sits](#2-architecture--where-mla-actually-sits)
- [3. What ships unconditionally vs. what only CCH can supply](#3-what-ships-unconditionally-vs-what-only-cch-can-supply)
- [4. The deliverable set](#4-the-deliverable-set)
- [5. Config surface — every variable, its destination, and its status](#5-config-surface--every-variable-its-destination-and-its-status)
- [6. Image and registry](#6-image-and-registry)
- [7. Network requirements — what must actually be reachable](#7-network-requirements--what-must-actually-be-reachable)
- [8. Secrets and key provisioning](#8-secrets-and-key-provisioning)
- [9. A worked manifest skeleton](#9-a-worked-manifest-skeleton)
- [10. Relationship to `plan.md` Phase 8](#10-relationship-to-planmd-phase-8)
- [11. Open questions for CCH](#11-open-questions-for-cch)
- [12. Next steps](#12-next-steps)

---

## 1. The ask, as received

From Oscar R. Cobar (Operations Principal, COMESA techops), 2026-09-14:

> Currently the techops team is in standby awaiting for deployment instructions. For now we need you to
> provide the values file for deploying from kubectl apply for instance
>
> `kubectl apply -f tazama-mla-values.yaml`
>
> There must be a variable for configuring the Kafka endpoint details as well as the tazama API in the
> other end

Two things in this email need resolving before anything is built against it, not after:

1. **"Values file" and `kubectl apply -f` name two different delivery shapes.** A values file is Helm's
   vocabulary — it configures a chart's templates and is installed with `helm install`/`helm upgrade`,
   never applied directly. `kubectl apply -f` takes literal Kubernetes resources — a Deployment, a
   Service, a ConfigMap. The email asks for both in the same sentence. §11 asks CCH to confirm which;
   this document proceeds on **plain manifests plus one CCH-editable config file**, since that is what
   the literal instruction (`kubectl apply -f`) describes, and it asks nothing of their cluster beyond
   `kubectl` itself.
2. **"The tazama API in the other end" is not accurate to the architecture**, and should be corrected in
   the reply, not built around. MLA never calls Tazama. It calls **PPA** — PPA is the service that later
   translates into ISO 20022 and dispatches to Tazama's TMS API. See §2. Left uncorrected, CCH could
   provision network access to the wrong destination.

---

## 2. Architecture — where MLA actually sits

This matches a sketch already in this folder
([`deployment pattern for mojaloop x tazama.jpeg`](deployment%20pattern%20for%20mojaloop%20x%20tazama.jpeg)),
labeled "(as) formal ask," and confirms `strategy.md` §1's boundary statement empirically:

```
┌─────────────────────────────────────┐         ┌──────────────────────────────────┐
│   CCH DRPP (COMESA's cluster)        │         │  Multi-tenant (our cluster)       │
│                                       │         │                                    │
│   Kafka (topic-event-audit)          │   P2P   │   PPA ──ISO 20022──▶ Tazama TMS    │
│        │                             │  VPN    │    ▲                              │
│        ▼                             │ ══════▶ │    │ mTLS                          │
│   MLA (cross-border flow)  ──────────┼─────────┼────┘                              │
│                                       │         │                                    │
└─────────────────────────────────────┘         └──────────────────────────────────┘
```

- **MLA is deployed inside CCH's own cluster**, alongside (or at least network-adjacent to) the Kafka
  broker carrying `topic-event-audit`. This is *why* Oscar's team is the one running `kubectl`, not us —
  MLA holds no Tazama-scoped credential and cannot leave CCH's boundary (`core-knowledge.md` §1).
- **PPA and Tazama are deployed in our (Paysyslabs) cluster** — separately being stood up right now,
  moving off the Core Test Harness (`plan.md` §11's own note on the 2026-09-09 meeting). This is *not*
  CCH's environment and is not part of what gets handed to Oscar's team.
- **The only boundary crossing is MLA → PPA, over mTLS, via a point-to-point VPN.** Kafka reachability is
  entirely internal to CCH's own cluster/network — CCH does not need external connectivity for that half.
  The VPN is what makes `PPA_BASE_URL` resolvable and reachable from inside CCH's cluster at all; without
  it, no manifest value we hand over will connect to anything.

---

## 3. What ships unconditionally vs. what only CCH can supply

**We can produce today, independent of any CCH answer:**

- The container image build (the `Dockerfile` already exists, multi-stage, distroless, non-root).
- The manifest *shapes* — Deployment, Service, ConfigMap, Secret templates — with every field that is
  already a settled engineering decision (timeouts, retry/breaker defaults, probe paths) filled in, and
  every field that depends on CCH's environment left as an explicit placeholder.
- The mapping from `.env.template` to Kubernetes ConfigMap/Secret keys (§5) — this is mechanical, not a
  judgment call.

**We cannot produce without CCH, and must not guess:**

- The real `KAFKA_BROKERS` address. `KAFKA_AUDIT_TOPIC`'s name (`topic-event-audit`), partition count
  (12) and retention (7-day / 250MB) are already on record — CCH is asked to confirm these hold for the
  deployment target, not to supply them from scratch (`plan.md` §11's own Phase 8 checklist item is
  phrased the same way — "confirm," not "obtain").
- **A dedicated `KAFKA_GROUP_ID`** — R-18: the one misconfiguration in this system capable of affecting
  live payments if it collides with a DRPP-internal group.
- The VPN's resulting reachable address for `PPA_BASE_URL`, and who is issuing the mTLS certificate pair
  each side presents on that hop.
- Which registry their cluster's nodes can pull from (§6).
- Real DFSP JWS public keys, and — per the 2026-09-09 meeting — whether MLA should be pointed at MCM
  instead of a static mounted key directory (§8).

`CLAUDE.md`'s rule applies directly here: the mechanism (manifests, config surface, image) can and should
be built now, against a stated default where one is needed; **this piece of work cannot be called done
while those five items are still open**, and that must stay visible rather than get quietly resolved with
a guess.

---

## 4. The deliverable set

What CCH's `kubectl apply -f` needs to cover, as four Kubernetes objects:

| Object | Contents |
| --- | --- |
| **Deployment** | The `cch-mla` container, its probes, resource requests/limits, and volume mounts for the three secret-backed paths in §8. |
| **Service** | `ClusterIP`, port 3001 — exposes `/health/live`, `/health/ready`, `/metrics` to whatever inside CCH's cluster scrapes them (Prometheus, or a liveness/readiness check from the cluster itself). **No Ingress** — MLA has no externally-facing HTTP surface; all payment traffic arrives over Kafka (`.env.template`'s own comment on this). |
| **ConfigMap** | Every non-secret variable in §5 — broker address, topic, group ID, PPA URL, timeouts, retry/breaker thresholds, log level. |
| **Secret(s)** | The three file-mounted, security-relevant paths: MLA's mTLS client identity for PPA, the JWS public-key directory, and the PII tokenization secret. Per `engineering-rules.md` §8: "certificates and keys are mounted, not embedded" and "secrets are mounted, loaded once at startup, never network-fetched per event." |

**Probes — the distinction matters and is already load-bearing in the code**
(`src/services/health.service.ts`):

- **`livenessProbe` → `/health/live`.** Always reports `UP` once the process is running — a trivial
  liveness check. Correct for `livenessProbe`: only a genuinely wedged process should be restarted.
- **`readinessProbe` → `/health/ready`.** Reports `DOWN` if the local Kafka consumer isn't connected, or
  if the PII secret failed to load. **It never probes PPA** — a shared downstream gating readiness would
  pull every healthy replica out of rotation over one dependency's outage (`engineering-rules.md` §8/§14).
  This is correct for `readinessProbe`: removes the pod from Service endpoints without restarting it,
  since a Kafka blip is not fixed by a restart.

**Do not wire `/health/ready` as the liveness probe** — that would restart-loop the pod every time Kafka
has a transient outage, which is exactly the back-pressure scenario the retry/breaker mechanism is built
to absorb, not something a restart helps with.

---

## 5. Config surface — every variable, its destination, and its status

Derived directly from `cch-mla/.env.template`, the single source of truth for MLA's configuration surface.

| Variable | Destination | Status |
| --- | --- | --- |
| `FUNCTION_NAME`, `NODE_ENV`, `PORT`, `HOST` | ConfigMap | Settled — static (`NODE_ENV=production`, `PORT=3001`, `HOST=0.0.0.0`). |
| `KAFKA_ENABLED` | ConfigMap | Settled — `true` in this deployment (the `false` value only exists so the service can start with no broker present, for local dev — `plan.md` §3.3). |
| `KAFKA_BROKERS` | ConfigMap | **Open — CCH must supply**, the real broker address inside their cluster. |
| `KAFKA_CLIENT_ID` | ConfigMap | Settled — `cch-mla`. |
| `KAFKA_GROUP_ID` | ConfigMap | **Open — CCH must supply a dedicated group ID (R-18).** Never reuse a DRPP-internal group name. |
| `KAFKA_FROM_BEGINNING` | ConfigMap | Settled — `false`. |
| `KAFKA_AUDIT_TOPIC` | ConfigMap | Settled — `topic-event-audit`, 12 partitions, 7-day / 250MB retention, already on record. Asked of CCH as a confirmation for the deployment target (§11 Q3), not an unknown. |
| `PPA_BASE_URL` | ConfigMap | **Open — depends on the P2P VPN's resulting address.** Must be the single stable PPA service address, never an individual replica (`core-knowledge.md` §3.4). |
| `PPA_TIMEOUT_MS`, `PPA_MAX_RETRIES`, `PPA_RETRY_BASE_MS`, `PPA_CIRCUIT_BREAKER_THRESHOLD`, `PPA_REPROBE_INTERVAL_MS` | ConfigMap | Settled — carry the decided defaults from `.env.template` forward unchanged. |
| `PPA_CLIENT_CERT_PATH`, `PPA_CLIENT_KEY_PATH`, `PPA_CA_CERT_PATH` | Secret volume mount | **Open — provisioning mechanism (§8).** File paths, not values — the app reads these from disk, so they map to a mounted Secret volume, not `envFrom`. |
| `JWS_PUBLIC_KEY_DIR` | Secret/ConfigMap volume | **Open — mechanism itself is open (§8)**, pending the MCM question from the 2026-09-09 meeting. |
| `PII_SECRET_PATH` | Secret volume mount | **Open — provisioning and rotation (gate item #2, still with CCH, `plan.md` §7.1 #2).** |
| `PII_MAX_RETRIES`, `PII_RETRY_BASE_MS`, `PII_CIRCUIT_BREAKER_THRESHOLD`, `PII_REPROBE_INTERVAL_MS` | ConfigMap | Settled — carry the decided defaults forward unchanged. |
| `ALERT_WEBHOOK_URL` | ConfigMap/Secret (optional) | **Deliberately left unset by default.** R-37 (alerting destination/routing) is still open with CCH; the metrics-based sink (`mla_alerts_total`, `/metrics`) is active regardless and needs no destination decided to be useful. |
| `ALERT_WEBHOOK_TIMEOUT_MS` | ConfigMap | Settled — `3000`. |
| `LOG_LEVEL` | ConfigMap | Settled — `info`. |
| `LOG_PRETTY` | ConfigMap | **Set to `false` in this deployment** (unlike the local-dev default of `true`) — structured JSON is what a cluster-side log aggregator (Loki, per the confirmed observability stack) actually consumes. |

**Never default a security-relevant setting** (`engineering-rules.md` §8) — every row marked Open above
ships with no value in the template CCH receives, not a placeholder that happens to look plausible, so a
missed field fails config validation at startup rather than silently running against the wrong endpoint.

---

## 6. Image and registry

The `Dockerfile` (`cch-mla/Dockerfile`) already exists and needs no changes for this purpose:
multi-stage (`node:22-bullseye` builder → `gcr.io/distroless/nodejs22-debian12:nonroot` runtime), runs as
`nonroot`, `NODE_ENV=production`, exposes 3001.

**What's missing is a push step.** `.gitlab-ci.yml` currently has `build`/`lint`/`test`/`regression` jobs
only (and even those are blocked on the runner issue in Phase 7's own open item — `plan.md` §10) — nothing
builds or pushes the container image today. That needs its own CI job once §11 Q2 below is answered,
since the job's target registry and credentials depend on the answer.

**Registry destination is explicitly left open** (per the plan for this document) rather than assumed —
see §11 Q2. Whichever answer comes back, the Deployment manifest's `image:` field and (if the registry is
private) an `imagePullSecret` follow mechanically from it; nothing else in the manifest set changes.

---

## 7. Network requirements — what must actually be reachable

- **MLA → Kafka: in-cluster only.** No egress rule beyond CCH's own cluster networking is implied — this
  is the half of the topology that does *not* cross an organizational boundary.
- **MLA → PPA: the one boundary crossing**, over the P2P VPN in §2's diagram, authenticated by mTLS on
  both sides. This is a `NetworkPolicy` egress rule (allow the VPN-side CIDR/host, port from `PPA_TIMEOUT_MS`'s
  own endpoint on `PPA_BASE_URL`) rather than a public endpoint — the sketch this document is built from
  explicitly shows a point-to-point VPN, not an internet-facing PPA. If that assumption is wrong, §11 Q4
  needs re-asking before an egress policy is written.
- **No inbound Ingress for MLA.** All payment traffic arrives over Kafka; the only HTTP surface is
  `/health/*` and `/metrics`, consumed from inside the cluster (a kubelet probe, and whichever Prometheus
  scrapes it). Whether that is CCH's own observability stack or something reaching back across the VPN is
  itself an open question — see §11 Q6.

---

## 8. Secrets and key provisioning

Three genuinely different secrets, each with its own open provisioning question:

1. **MLA's mTLS client identity (for the PPA hop).** Needs a CA, a way to issue MLA's client cert/key
   pair, and PPA's CA cert for MLA to validate the far side. Whether CCH's cluster already runs
   `cert-manager` (or an equivalent) or expects a manually-generated pair mounted as a `Secret` is unasked
   — §11 Q5.
2. **DFSP JWS public keys (`JWS_PUBLIC_KEY_DIR`).** The current mechanism is a watched directory of
   `<dfspId>.pem` files, chosen so adding a key never requires a restart (`engineering-rules.md` §8). At
   the 2026-09-09 meeting, Sam (Mojoloop Foundation) recommended MLA interface with **MCM (Mojaloop
   Connection Manager)** instead of managing keys manually — if that holds, the deployment shape here
   changes from "mount a Secret volume of key files" to "MLA calls an MCM endpoint," which is a different
   manifest (a `ConfigMap` for the MCM URL, possibly a bearer credential) rather than a Secret volume.
   **Do not build the Secret-volume version as final** until this is resolved; it remains this section's
   stated default only because it is what the code does today.
3. **The PII tokenization secret (`PII_SECRET_PATH`).** Gate item #2 (secret rotation trigger) is still
   open with CCH (`plan.md` §7.1 #2) — COMESA confirmed versioned keys over drain-first, but the failure
   route that would apply a new key has no counterpart in MLA today (the tokenizer only ever writes
   tokens, never checks one). The initial secret still needs a provisioning mechanism regardless of how
   rotation eventually works — a `Secret` mounted at startup, sourced from wherever CCH's own secret
   management lives (Vault, Sealed Secrets, or a manually created `Secret` object).

---

## 9. A worked manifest skeleton

Illustrative only — every `<ANGLE-BRACKET>` value is one of §5's open items and must be filled in before
this is real. Shown to make §4's description concrete, not as something to apply as-is.

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: cch-mla-config
data:
  FUNCTION_NAME: "cch-mla"
  NODE_ENV: "production"
  PORT: "3001"
  HOST: "0.0.0.0"
  KAFKA_ENABLED: "true"
  KAFKA_BROKERS: "<CCH-SUPPLIED-BROKER-ADDRESS>"
  KAFKA_CLIENT_ID: "cch-mla"
  KAFKA_GROUP_ID: "<CCH-SUPPLIED-DEDICATED-GROUP-ID>"
  KAFKA_FROM_BEGINNING: "false"
  KAFKA_AUDIT_TOPIC: "<CONFIRMED-TOPIC-NAME>"
  PPA_BASE_URL: "<PPA-ADDRESS-OVER-P2P-VPN>"
  PPA_TIMEOUT_MS: "2000"
  PPA_MAX_RETRIES: "3"
  PPA_RETRY_BASE_MS: "1000"
  PPA_CIRCUIT_BREAKER_THRESHOLD: "5"
  PPA_REPROBE_INTERVAL_MS: "10000"
  PII_MAX_RETRIES: "3"
  PII_RETRY_BASE_MS: "1000"
  PII_CIRCUIT_BREAKER_THRESHOLD: "5"
  PII_REPROBE_INTERVAL_MS: "10000"
  ALERT_WEBHOOK_TIMEOUT_MS: "3000"
  LOG_LEVEL: "info"
  LOG_PRETTY: "false"
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: cch-mla
spec:
  replicas: 1 # Phase 7's own rebalance test covers >1; raise once CCH sizing is known.
  selector:
    matchLabels:
      app: cch-mla
  template:
    metadata:
      labels:
        app: cch-mla
    spec:
      containers:
        - name: cch-mla
          image: "<REGISTRY-TO-BE-DECIDED>/cch-mla:<TAG>"
          ports:
            - containerPort: 3001
          envFrom:
            - configMapRef:
                name: cch-mla-config
          volumeMounts:
            - name: ppa-mtls
              mountPath: /secrets/ppa-mtls
              readOnly: true
            - name: jws-keys
              mountPath: /secrets/jws-keys
              readOnly: true
            - name: pii-secret
              mountPath: /secrets/pii-secret
              readOnly: true
          env:
            - name: PPA_CLIENT_CERT_PATH
              value: /secrets/ppa-mtls/client.crt
            - name: PPA_CLIENT_KEY_PATH
              value: /secrets/ppa-mtls/client.key
            - name: PPA_CA_CERT_PATH
              value: /secrets/ppa-mtls/ca.crt
            - name: JWS_PUBLIC_KEY_DIR
              value: /secrets/jws-keys
            - name: PII_SECRET_PATH
              value: /secrets/pii-secret/secret
          livenessProbe:
            httpGet: { path: /health/live, port: 3001 }
            initialDelaySeconds: 5
            periodSeconds: 15
          readinessProbe:
            httpGet: { path: /health/ready, port: 3001 }
            initialDelaySeconds: 5
            periodSeconds: 10
          resources:
            requests: { cpu: "250m", memory: "256Mi" }
            limits: { cpu: "1", memory: "512Mi" }
      volumes:
        - name: ppa-mtls
          secret: { secretName: cch-mla-ppa-mtls }
        - name: jws-keys
          secret: { secretName: cch-mla-jws-keys } # or an MCM-backed config — see §8 item 2
        - name: pii-secret
          secret: { secretName: cch-mla-pii-secret }
---
apiVersion: v1
kind: Service
metadata:
  name: cch-mla
spec:
  type: ClusterIP
  selector:
    app: cch-mla
  ports:
    - port: 3001
      targetPort: 3001
```

---

## 10. Relationship to `plan.md` Phase 8

This is Phase 8's own "Kubernetes manifests" checklist bullet (`plan.md` §11), scoped ahead of the rest of
that phase — CCH's techops request is what's moving this item first, not a reordering we chose. It does
not unblock anything else on that checklist: real DFSP keys, real mTLS against a real PPA, a dedicated
consumer group ID, and production-representative load are all still blocked on the same external items
this document surfaces in §11, restated in that section's own words, not new ones.

When CCH's answers land, update this document's §5/§8/§9 with the real values, and record the result in
`plan.md` §16 per `CLAUDE.md`'s "How a story gets built" §5 (this being infrastructure work adjacent to a
story rather than a story itself, the closest analogue is a `plan.md` §16 entry noting what was delivered
to CCH and what stayed open, not a full epic/story pair).

---

## 11. Open questions for CCH

Consolidated from every "Open" row above — this is the substance of the reply to Oscar:

1. **Format.** Plain Kubernetes manifests applied with `kubectl apply -f` (what this document assumes,
   §1), or a Helm chart? The original email names both.
2. **Registry.** Can your cluster's nodes pull from a registry we push to directly (Docker Hub, GHCR, our
   GitLab registry), or do you need the image delivered to your own registry, or do we need to provide an
   `imagePullSecret`?
3. **Kafka.** The real broker address, plus confirmation that `topic-event-audit` (12 partitions, 7-day /
   250MB retention — already on record) holds for the deployment target, and — this is the one item with
   the most consequence if gotten wrong — **a consumer group ID dedicated to MLA**, never reused from an
   existing DRPP-internal group (R-18).
4. **The PPA endpoint.** Confirming the P2P VPN sketch (§2) is still the intended path, and what address
   MLA should reach PPA at once that VPN is live.
5. **mTLS provisioning for the MLA→PPA hop.** Who issues the certificate pair — does your cluster run
   `cert-manager` or an equivalent, or should we generate and hand over a pair to be mounted as a
   `Secret`?
6. **Metrics/health scraping.** Does your own observability stack scrape `/metrics` and probe
   `/health/*` in-cluster, or does that need to reach back across the VPN to ours?

Not CCH's to answer, but worth naming so the reply doesn't imply it is: DFSP JWS key delivery (already in
motion via Infotex per the 2026-09-09 meeting) and the MCM question are Mojoloop Foundation / CCH-Infotex
items already being tracked, not new asks created by this deployment work.

---

## 12. Next steps

1. Send the reply to Oscar — §11's six questions, plus the architecture correction in §1 point 2 (MLA
   talks to PPA, not Tazama directly).
2. Once §11 Q1/Q2 are answered, add the image build+push job to `.gitlab-ci.yml` (currently has none —
   §6) and commit the real manifest files (not the illustrative skeleton in §9) under a new
   `cch-mla/deploy/kubernetes/` (or CCH-preferred path).
3. Once §11 Q3/Q4/Q5 are answered, replace every `<ANGLE-BRACKET>` placeholder in §9 with the real value
   and update §5's status column from Open to Settled per row.
4. Live-verify against CCH's actual cluster before calling any of this done, per `engineering-rules.md`
   §11 — a manifest that has only been read, never applied, is a design, not a deployment.

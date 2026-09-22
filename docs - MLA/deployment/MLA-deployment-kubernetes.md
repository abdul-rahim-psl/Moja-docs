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

**Update, 14 September 2026 — the mechanism has been dry-run end to end.** Before any of this goes to
Oscar's team, we ran it ourselves: MLA + a real mTLS-authenticated PPA stand-in, deployed via real
Kubernetes manifests, consuming from a real Mojaloop switch's Kafka broker, delivering real re-signed DRPP
transactions through JWS verification and PII tokenization to a genuine downstream. Full account in
[`local-deployment.md`](local-deployment.md). Two real bugs surfaced and were fixed at the source, not
worked around — both now already applied, not new open items:
- `cch-mla` could not consume **LZ4-compressed** Kafka messages at all (a hard crash, not a skip) —
  `kafkajs` ships no compression codecs beyond GZIP by design, and this cluster's switch (very plausibly
  also CCH's) compresses with LZ4. Fixed: a real codec dependency now registered in
  `src/clients/kafka.client.ts`.
- `ppa-stub`'s own control-port env var name collided with Kubernetes' automatic Service-discovery
  injection — relevant to anyone else standing this stub up as a K8s Service, not this deployment's own
  manifests.
Every other §4/§8 behavior this document describes (readiness never gating on PPA, per-partition
pause-and-recover on a PPA outage, no restart required to resume) was independently observed live, not
just read off the code.

**Update, 15 September 2026 — image pushed, real manifests written.** The 2026-09-14 meeting with George
(`docs/meetings and emails/14-sept-deployment-meeting.md`) answered most of §11 live. Acting on that: the real
`cch-mla` image (branch `paysys-QA-F11-onwards` @ `a0437cd`) is now built and pushed to
**`10.0.70.91:5005/open-frms/cch-frms/cch-mla`** (GitLab Container Registry, same self-hosted instance
already hosting this repo — §6 is no longer open), and the real manifest set lives at
`cch-mla/deploy/kubernetes/` (not this document's §9 skeleton, not the dry run's
[`kubernetes-dryrun/`](kubernetes-dryrun/) copies, relocated here 2026-09-15 — `cch-mla` is the official,
production repo and carries only genuine deployment deliverables) — see that folder's `README.md` for
exactly what's real versus still placeholder. A
`read_registry` deploy token for CCH (`comesa-mla-deploy`) has been minted and is being sent to George
directly, never committed to this repo. An interim MLA→PPA mTLS CA and client identity were also
generated as the stated default while George's shared cert-manager investigation continues — reversible,
per `CLAUDE.md`'s external-decisions rule.

**Update, 15 September 2026 — George's written reply, and the resulting decisions.** George Murage (CCH)
replied in writing, covering four points. Full source: [`george-reply-2026-09-15.md`](george-reply-2026-09-15.md).
Outcomes:

1. **Config delivery.** George proposed externalising `KAFKA_BROKERS`/`PPA_BASE_URL` (and secrets) into a
   ConfigMap CCH creates, rather than editing placeholders in a file Paysys ships. **Adopted** — the
   ConfigMap is now split: `cch-mla/deploy/kubernetes/01-configmap.yaml` (static, Paysys-owned) and
   `02-env-configmap.yaml` (environment-specific, CCH-owned — `KAFKA_BROKERS`/`PPA_BASE_URL` only).
   George also asked whether to use IP allow-listing instead of an IPsec VPN — see point 3, the two
   questions turned out to be one architectural decision.
2. **JWS signature validation.** George proposed disabling MLA's own signature verification entirely,
   reasoning the hub already validates every message. **Not accepted as a permanent change** — this
   removes a security control `engineering-rules.md` treats as non-negotiable, and F-04 of this QA
   workstream specifically hardened it (bound-claims checking). **Accepted only as a scoped, reversible,
   loudly-observable testing default**: `JWS_VALIDATION_DISABLED` (env var, default `false`), built
   2026-09-15, live-verified (boot-time `WARN` log + `mla_jws_validation_bypassed` metric, both confirmed
   against a running process). Must never run `true` outside an explicitly agreed testing window; the
   real fix is still real DFSP keys landing, not a permanent bypass.
3. **Connectivity + mTLS — one combined decision, accepted.** Two documents George shared
   ([`connectivity-options.md`](connectivity-options.md); [`certificate-setup-proposal.md`](certificate-setup-proposal.md))
   describe a single architecture: a public endpoint on the Paysys side, IP allow-listed (not an IPsec
   VPN), with a
   dedicated mTLS-terminating ingress gateway (Envoy/Nginx/Istio) in front of PPA, under a Paysys-operated
   **Interconnect CA** used for nothing but this link — separate from both the DRPP mesh CA and the
   TAZAMA mesh CA, so PPA's own trust store is never touched. Both sides get SAN-pinned certificates from
   that one CA; MLA holds its own client key (matching what was already built). **Accepted as the target
   architecture.** This is new infrastructure on the Paysys side (the ingress gateway does not exist
   yet) — §8 below and `cch-mla/deploy/kubernetes/README.md`'s "Certificate Provisioning" section record
   the interim bridge (the CA/client cert already generated 2026-09-15) that stays in place until the
   gateway is stood up, at which point MLA is reissued under the gateway's own authority.
4. **Registry/GitHub access.** George's team read an earlier ask as requesting access to *their* GitHub —
   a miscommunication. **Resolved, then revised same day**: image built and pushed to Paysys's own GitLab
   registry first (now internal testing only — see §6's own update); the real delivery path settled on
   later 2026-09-15 is **GitHub Container Registry**, `ghcr.io/psl-izyane-cch-frms/cch-mla`, closer to
   George's own original framing (CCH pulling from a Paysys-controlled location, source mirrored to
   CCH's own GitHub once the build stabilizes — still a later, deferred step). George also recommended
   pinning by immutable digest rather than a mutable tag, since the image will keep changing during
   testing — **adopted**: `03-mla-deployment.yaml` now references the image by `sha256:` digest, with the
   tag kept only as a human-readable comment.

**Update, 20 September 2026 — connectivity mechanism confirmed, PKI exchange proposed, TLS settled.**
George's follow-up (full source: [`george-reply-2026-09-20.md`](george-reply-2026-09-20.md)) on the two
items still owed after 15-Sept:

1. **Connectivity — whitelisting confirmed, PPA address still outstanding.** Per Slack, whitelisting (not
   a VPN) is the agreed mechanism; DRPP's source IP has been shared with Paysys. The PPA hostname/IP given
   back was flagged as looking like an internal address, not one reachable over the public internet —
   Paysys's network team to re-check and supply either a resolvable hostname or a public IP. See §7, §11
   Q4.
2. **PKI exchange — CSR-based flow proposed, pending Paysys review.** `ca.crt`/`client.crt` carry nothing
   sensitive and can go over email/Slack directly. To keep `client.key` from ever crossing the boundary,
   George proposes generating PPA's private key and a CSR locally once he has Paysys's `ca.crt`/
   `client.crt`, sending back only the CSR for signing, and receiving the signed cert in return. See §8
   item 1, §11 Q5.
3. **TLS version and cipher suites — resolved.** TLS 1.2/1.3 and any OpenSSL-supported cipher suite are
   acceptable on the DRPP side. Nothing further to negotiate here. See §7, §11 Q5.

**Update, 21 September 2026 — the 2026-09-15 interim CA was wrong; corrected, and `ca.crt`/`client.crt`
sent to George.** Actioning the PKI exchange above required retrieving the live `cch-mla-ppa-mtls` secret
(`mla` namespace, `10.0.150.69`) — doing so found it held `cch-mla-harness-ca` material (the local dev
test-harness CA `ppa-stub` uses, `O=cch-mla dev harness`, issued 2026-09-14), never the dedicated
Interconnect CA §8 item 1 describes as generated 2026-09-15. Nothing had been sent to George off this
material yet, so nothing needs correcting on his end. A properly scoped Interconnect CA was generated
(`O=Paysys, CN=cch-mla-ppa-interconnect-ca`) and the live secret recreated from it the same day; `PPA_MTLS_
DISABLED=true` is still active on this deployment (§7), so no traffic was ever exposed to the wrong
identity and no pod restart was needed. `ca.crt`/`client.crt` from the corrected CA (never `client.key`)
were sent to George the same day. Full detail: §8 item 1, §11 Q5.

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
labeled "(as) formal ask," and confirms `strategy.md` §1's boundary statement empirically. That original
sketch showed a point-to-point VPN for the MLA→PPA hop; **as of 2026-09-15 the agreed connectivity is a
public, IP allow-listed endpoint with a dedicated mTLS ingress gateway instead** — see the 15 September
update above and [`connectivity-options.md`](connectivity-options.md). The diagram below reflects the
current design:

```
┌──────────────────────────────────────┐                ┌────────────────────────────────────┐
│   CCH DRPP (COMESA's cluster)        │                │  Multi-tenant (our cluster)        │
│                                      │  Public IP     │                                    │
│   Kafka (topic-event-audit)          │                │   Ingress gateway (mTLS) ──▶ PPA   │
│        │                             │ allow-         │    ▲                    ──ISO 20022────────▶ Tazama TMS
│        ▼                             │ listed         │    │                               │
│   MLA (cross-border flow)  ──────────┼─────────────────────┘                               │
│                                      │                │                                    │
└──────────────────────────────────────┘                └────────────────────────────────────┘
```

- **MLA is deployed inside CCH's own cluster**, alongside (or at least network-adjacent to) the Kafka
  broker carrying `topic-event-audit`. This is *why* Oscar's team is the one running `kubectl`, not us —
  MLA holds no Tazama-scoped credential and cannot leave CCH's boundary (`core-knowledge.md` §1).
- **PPA and Tazama are deployed in our (Paysyslabs) cluster** — separately being stood up right now,
  moving off the Core Test Harness (`plan.md` §11's own note on the 2026-09-09 meeting). This is *not*
  CCH's environment and is not part of what gets handed to Oscar's team.
- **The only boundary crossing is MLA → PPA, over mTLS, via a public, IP allow-listed endpoint** in front
  of a dedicated ingress gateway on the Paysys side (not a VPN tunnel — see the 15 September update).
  Kafka reachability is entirely internal to CCH's own cluster/network — CCH does not need external
  connectivity for that half. The gateway's address is what makes `PPA_BASE_URL` resolvable and reachable
  from inside CCH's cluster at all; without it, no manifest value we hand over will connect to anything.

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

- The real `KAFKA_BROKERS` value. **Update 2026-09-14:** George's side already knows the broker address
  (it's their own cluster); what we owed him was the *variable name*, now shared. `KAFKA_AUDIT_TOPIC`'s
  name (`topic-event-audit`), partition count (12) and retention (7-day / 250MB) remain on record — CCH
  is still asked to confirm these hold for the deployment target, not to supply them from scratch
  (`plan.md` §11's own Phase 8 checklist item is phrased the same way — "confirm," not "obtain").
- ~~A dedicated `KAFKA_GROUP_ID`.~~ **Resolved 2026-09-14/15** — `paysys_cch_mla`, confirmed by George
  against every existing DRPP-internal group (R-18, the one misconfiguration in this system capable of
  affecting live payments). Already in `cch-mla/deploy/kubernetes/01-configmap.yaml`.
- The VPN's resulting reachable address for `PPA_BASE_URL` — **still open**: the meeting confirmed the
  site-to-site VPN mechanism and that only IP addresses (not port/protocol scoping) need defining, but
  the IPs themselves haven't been exchanged yet.
- Who is issuing the mTLS certificate pair each side presents on that hop — **still open**: George is
  investigating a neutral shared cert-manager between the two trust boundaries. Built against an interim,
  reversible default in the meantime — see the 2026-09-15 update above.
- ~~Which registry their cluster's nodes can pull from (§6).~~ **Resolved 2026-09-14/15** — George is
  flexible on location and only needs a URL plus a valid auth token; GitLab Container Registry chosen
  (§6), image pushed, deploy token minted.
- Real DFSP JWS public keys, and — per the 2026-09-09 meeting — whether MLA should be pointed at MCM
  instead of a static mounted key directory (§8). **Still open**, untouched by this deployment thread.

`CLAUDE.md`'s rule applies directly here: the mechanism (manifests, config surface, image) can and should
be built now, against a stated default where one is needed; **this piece of work cannot be called done
while `PPA_BASE_URL`, mTLS provisioning and the JWS key question are still open**, and that must stay
visible rather than get quietly resolved with a guess.

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
| `KAFKA_BROKERS` | ConfigMap | **Open — CCH fills in directly.** George's side already knows the value (it's their own cluster); we only owed him this variable name, now shared. Placeholder in `cch-mla/deploy/kubernetes/01-configmap.yaml`. |
| `KAFKA_CLIENT_ID` | ConfigMap | Settled — `cch-mla`. |
| `KAFKA_GROUP_ID` | ConfigMap | Settled — `paysys_cch_mla`. Confirmed by George, 2026-09-14, against every existing DRPP-internal group (R-18). |
| `KAFKA_FROM_BEGINNING` | ConfigMap | Settled — `false`. |
| `KAFKA_AUDIT_TOPIC` | ConfigMap | Settled — `topic-event-audit`, 12 partitions, 7-day / 250MB retention, already on record. Asked of CCH as a confirmation for the deployment target (§11 Q3), not an unknown. |
| `PPA_BASE_URL` | ConfigMap | **Open — depends on the P2P VPN's resulting address.** Must be the single stable PPA service address, never an individual replica (`core-knowledge.md` §3.4). |
| `PPA_TIMEOUT_MS`, `PPA_MAX_RETRIES`, `PPA_RETRY_BASE_MS`, `PPA_CIRCUIT_BREAKER_THRESHOLD`, `PPA_REPROBE_INTERVAL_MS` | ConfigMap | Settled — carry the decided defaults from `.env.template` forward unchanged. |
| `PPA_CLIENT_CERT_PATH`, `PPA_CLIENT_KEY_PATH`, `PPA_CA_CERT_PATH` | Secret volume mount | **Open — provisioning mechanism (§8).** File paths, not values — the app reads these from disk, so they map to a mounted Secret volume, not `envFrom`. |
| `JWS_PUBLIC_KEY_DIR` | Secret/ConfigMap volume | **Open — mechanism itself is open (§8)**, pending the MCM question from the 2026-09-09 meeting. |
| `PII_SECRET_PATH` | Secret volume mount | **Settled [2026-09-18, spec confirmed 2026-09-22].** No rotation (`plan.md` §7.1 #2) — a single, long-lived key: HMAC-SHA-256, 256-bit base64-encoded, in a Kubernetes Secret named `cch-mla-pii-secret` — already the exact name this manifest's own `volumes` section uses below, confirmed to match by coincidence, not by having been checked against CCH's answer at the time it was written. |
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

**Registry: revised 2026-09-15 — GHCR is the real delivery path.** George confirmed he's flexible on
location and only needs a URL plus a valid auth token. GitLab Container Registry
(`10.0.70.91:5005/open-frms/cch-frms/cch-mla`) was tried first, chosen for needing zero new
infrastructure — **that push now stands as internal testing only**, not what CCH pulls from. The real
delivery registry is **GitHub Container Registry**, `ghcr.io/psl-izyane-cch-frms/cch-mla`, in a new
private repo (`psl-izyane-cch-frms/cch-mla`, created 2026-09-15) — matching George's own earlier note
that CCH would rather mirror source to their own GitHub instance once the build stabilizes, and pulling
the image from Paysys's side in the meantime. The image (branch `paysys-QA-F11-onwards` @ `a0437cd`) is
pushed to both registries under the same tags (`a0437cd`, `latest`) and the identical digest
(`sha256:1e995f6de223a58257f623b96792e15eef56d06f1f73e9e71c49b6d65fbe868b`), confirming byte-identical
content. Access for CCH: granted directly on the package itself (package Settings → "Manage access" →
"Invite teams or people", role Read) — not repository collaboration, which would also expose the
private source repo. **Verified 2026-09-15**: invited the PPA developer (internal, not George) with
Read access as a test; they pulled successfully using their own PAT (`read:packages` scope), confirming
the access model genuinely works end to end before handing it to George. GHCR has no GitLab-style
scoped deploy token for an outside party — each puller authenticates with their own PAT instead. The
`10.0.70.91` GitLab deploy token (`comesa-mla-deploy`) remains valid but is no longer the one being
handed to CCH.

**GitHub usernames received, 2026-09-17.** CCH emailed the two GitHub accounts to grant Read access to,
for the INFITX team performing the deployment: **Khaled Saidi (`KhaledSaiidi`)** and **Oscar Cobar
(`orcr`)**. The user is inviting both manually via the package's own "Manage access" → "Invite teams or
people" route (the same mechanism verified 2026-09-15, above) — not yet done as of this entry, and not
something this session performed.

**Still missing: an automated push step.** `.gitlab-ci.yml` currently has `build`/`lint`/`test`/`regression`
jobs only (and even those are blocked on the runner issue in Phase 7's own open item — `plan.md` §10) —
today's push was manual (`docker build` + `docker push`), the same fully-manual mechanism
`local-deployment.md` already proved end to end. A CI job to automate this is follow-up work, not a
blocker for this handoff.

---

## 7. Network requirements — what must actually be reachable

- **MLA → Kafka: in-cluster only.** No egress rule beyond CCH's own cluster networking is implied — this
  is the half of the topology that does *not* cross an organizational boundary.
- **MLA → PPA: the one boundary crossing.** **Updated 2026-09-15** — §2's diagram showed a point-to-point
  VPN; that is now superseded. The agreed target is a public, IP allow-listed endpoint on the Paysys side
  (not a VPN tunnel), terminating at a dedicated mTLS ingress gateway in front of PPA — see
  [`connectivity-options.md`](connectivity-options.md) and [`certificate-setup-proposal.md`](certificate-setup-proposal.md).
  This is still a `NetworkPolicy` egress rule on MLA's side (allow the gateway's address, port from
  `PPA_TIMEOUT_MS`'s own endpoint on `PPA_BASE_URL`), but the far side is a reachable public address
  behind an allow-list and SAN-pinned mTLS, not a private tunnel endpoint. Real addresses are still
  pending (§11 Q4). **Update 2026-09-20**: whitelisting is the confirmed mechanism (George, per Slack) —
  DRPP's own source IP for the allow-list has already been shared with Paysys. The address given back for
  the PPA side was flagged by George as looking like an internal IP, not one reachable over the public
  internet — Paysys's network team still needs to confirm the PPA hostname (or a publicly-reachable IP if
  the hostname doesn't resolve against a public DNS resolver). See §11 Q4.
- **TLS version and cipher suites — resolved 2026-09-20.** George confirmed TLS 1.2/1.3 is acceptable on
  the DRPP side, and any OpenSSL-supported cipher suite is fine — no fixed list to negotiate. See §11 Q5.
- **No inbound Ingress for MLA.** All payment traffic arrives over Kafka; the only HTTP surface is
  `/health/*` and `/metrics`, consumed from inside the cluster (a kubelet probe, and whichever Prometheus
  scrapes it). Deliberately deferred per the 2026-09-14 meeting: deploy first, confirm the pod's
  reachable, revisit monitoring after — see §11 Q6.

---

## 8. Secrets and key provisioning

Three genuinely different secrets, each with its own open provisioning question:

1. **MLA's mTLS client identity (for the PPA hop).** Needs a CA, a way to issue MLA's client cert/key
   pair, and PPA's CA cert for MLA to validate the far side. **Update 2026-09-14/15:** the meeting
   surfaced the real problem — two separate trust boundaries (DRPP, Paysyslabs), so neither side's
   cert-manager trusts the other's certificates. **Resolved 2026-09-15**: George's proposal is accepted as
   the target architecture — a dedicated Paysys-operated Interconnect CA, terminating at a new mTLS
   ingress gateway in front of PPA, never touching PPA's own mesh trust store
   ([`certificate-setup-proposal.md`](certificate-setup-proposal.md)). That gateway is new infrastructure
   and does not exist yet. **Interim default built in the meantime** (reversible once the gateway lands):
   a dedicated CA plus MLA's client identity, generated 2026-09-15 —
   `cch-mla/deploy/kubernetes/README.md` has the details. PPA's side still needs to be configured to
   trust this interim CA before the hop actually works end to end against the real PPA.
   **Update 2026-09-20 — PKI exchange mechanism proposed by George:** `ca.crt` and `client.crt` contain
   nothing sensitive and can go over email/Slack directly. The private key (`client.key`) is the part that
   must not travel. George's proposed sequence: once Paysys sends its `ca.crt` and `client.crt`, George
   generates PPA's own private key locally and a CSR from the details in that `client.crt`, and sends back
   only the CSR (also non-sensitive) over email/Slack; Paysys's CA signs it and returns the resulting
   `client.crt` (or new cert off the newly generated key). The private key never leaves the environment
   that holds it. Paysys only ever needs `ca.crt` and the (re-)signed `client.crt` for mTLS to work on its
   side. Pending Paysys review/confirmation — see §11 Q5.
   **Update 2026-09-21 — the 2026-09-15 interim CA was wrong; regenerated and corrected.** Retrieving the
   live `cch-mla-ppa-mtls` secret from the `mla` namespace on `10.0.150.69` to action the item above
   surfaced that its `ca.crt`/`client.crt` were never the dedicated interim CA this section describes —
   the secret held `cch-mla-harness-ca` material instead (`O=cch-mla dev harness`, issued 2026-09-14), the
   same self-signed CA `cch-mla/tools/ppa-stub/certs/` uses for local test harness runs against
   `ppa-stub`. It was never sent to George. A correctly scoped, dedicated Interconnect CA was generated in
   its place (`O=Paysys, CN=cch-mla-ppa-interconnect-ca`, 10-year root; `client.crt` at
   `CN=cch-mla-client`, signed by that root, ~825-day validity) and the live secret was recreated from it
   the same day. **No traffic impact**: `PPA_MTLS_DISABLED=true` is still active on this deployment (§7),
   so nothing was consuming the wrong certs for an actual connection — this was a quiet correction, not a
   remediation of a live failure, and no pod restart was needed or performed. `ca.crt` and `client.crt`
   (never `client.key`, never `ca.key`) were shared with George the same day. Paysys's own `client.key`/
   `ca.key` are held locally, not committed to any repository, consistent with this section's existing
   rule.
2. **DFSP JWS public keys (`JWS_PUBLIC_KEY_DIR`).** The current mechanism is a watched directory of
   `<dfspId>.pem` files, chosen so adding a key never requires a restart (`engineering-rules.md` §8). At
   the 2026-09-09 meeting, Sam (Mojoloop Foundation) recommended MLA interface with **MCM (Mojaloop
   Connection Manager)** instead of managing keys manually — if that holds, the deployment shape here
   changes from "mount a Secret volume of key files" to "MLA calls an MCM endpoint," which is a different
   manifest (a `ConfigMap` for the MCM URL, possibly a bearer credential) rather than a Secret volume.
   **Do not build the Secret-volume version as final** until this is resolved; it remains this section's
   stated default only because it is what the code does today.
3. **The PII tokenization secret (`PII_SECRET_PATH`).** Gate item #2 (secret rotation) is resolved
   [2026-09-18, spec confirmed 2026-09-22, `plan.md` §7.1 #2] — no rotation, a long-lived key: HMAC-SHA-256,
   a 256-bit base64-encoded key, held in a Kubernetes Secret named `cch-mla-pii-secret`. A `Secret` mounted
   at startup under that name, sourced from wherever CCH's own secret management lives (Vault, Sealed
   Secrets, or a manually created `Secret` object), is the provisioning mechanism in full — there is no
   further rotation machinery to design.

---

## 9. A worked manifest skeleton

Illustrative only — every `<ANGLE-BRACKET>` value is one of §5's open items and must be filled in before
this is real. Shown to make §4's description concrete, not as something to apply as-is. **Superseded by
the real manifests at `cch-mla/deploy/kubernetes/`** (§10 below) — that set splits the ConfigMap in two
(Paysys-owned static config, CCH-owned environment config) and pins the image by digest; this section is
kept only as the original illustration, not updated to match.

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

Consolidated from every "Open" row above. Six were asked; the 2026-09-14 meeting with George
(`docs/meetings and emails/14-sept-deployment-meeting.md`) answered four live:

1. **Format.** **Still unanswered.** Plain Kubernetes manifests applied with `kubectl apply -f` (what
   this document assumes, §1), or a Helm chart? The meeting didn't raise it; proceeding on the plain-
   manifests assumption unless CCH's team says otherwise.
2. **Registry — resolved.** Flexible on location; just needs a URL and a valid auth token. Settled on
   GHCR (`ghcr.io/psl-izyane-cch-frms/cch-mla`), image pushed — see §6's 2026-09-15 update above.
3. **Kafka — mostly resolved.** Broker address is already known on George's side (no action needed from
   him); we owed him the variable name (`KAFKA_BROKERS`), now shared. Consumer group ID resolved —
   `paysys_cch_mla`, confirmed clash-free (R-18). `topic-event-audit`'s partition count/retention
   confirmation is still outstanding.
4. **The PPA endpoint — mechanism resolved 2026-09-20, addresses still outstanding on both legs.**
   Whitelisting (not the VPN originally sketched, nor a straight public allow-list without it) is the
   confirmed approach, per George on Slack — superseding §7's earlier "public, IP allow-listed endpoint"
   framing only in that whitelisting is now explicit, not a new architecture. DRPP's source IP has been
   shared with Paysys. Still outstanding: the PPA hostname (or public IP if the hostname won't resolve
   against a public DNS resolver) — the address given back was flagged 2026-09-20 as looking like an
   internal IP, pending Paysys's network team.
5. **mTLS provisioning — architecture resolved 2026-09-15, key-exchange mechanism proposed 2026-09-20,
   gateway not yet built.** Two separate trust boundaries (DRPP and Paysyslabs) means neither side's
   cert-manager trusts the other's certificates today. George's proposal — a dedicated Interconnect CA
   terminating at a new ingress gateway in front of PPA, per
   [`certificate-setup-proposal.md`](certificate-setup-proposal.md) — is accepted as the target. That
   gateway is new Paysys-side infrastructure, not yet built. Built against an interim, reversible default
   in the meantime (`cch-mla/deploy/kubernetes/README.md`). **2026-09-20**: George proposed a CSR-based
   exchange so no private key crosses the boundary (§8 item 1) — pending Paysys review. **TLS
   version/cipher suites confirmed 2026-09-20**: TLS 1.2/1.3 and any OpenSSL-supported cipher suite are
   acceptable to George's side — nothing further to negotiate on this point. **2026-09-21**: the interim
   CA/client cert this item's "interim default" referred to was found to be the wrong material (dev-harness
   CA, not a dedicated one) and was regenerated and corrected — full detail in §8 item 1's 2026-09-21
   update. `ca.crt`/`client.crt` from the corrected CA were sent to George the same day; his CSR-based
   exchange (above) is the next step once he reviews them.
6. **Metrics/health scraping — deliberately deferred.** DRPP has its own Prometheus/Grafana/Loki stack,
   but MLA-only metrics are limited in isolation; George suggested Paysyslabs scrape MLA's metrics
   directly instead. Agreed: deploy first, confirm the pod's reachable, revisit monitoring after.

Not CCH's to answer, but worth naming so the reply doesn't imply it is: DFSP JWS key delivery (already in
motion via Infotex per the 2026-09-09 meeting) and the MCM question are Mojoloop Foundation / CCH-Infotex
items already being tracked, not new asks created by this deployment work.

---

## 12. Next steps

1. ~~Send the reply to Oscar~~ — **superseded by the 2026-09-14 meeting**, which covered the same ground
   live; the drafted email was not sent.
2. ~~Once §11 Q1/Q2 are answered, add the image build+push job to `.gitlab-ci.yml`... and commit the real
   manifest files... under a new `cch-mla/deploy/kubernetes/`~~ — **done 2026-09-15**, manually (image
   built/pushed by hand, matching `local-deployment.md`'s own fully-manual mechanism); the CI job itself
   is still a follow-up, not a blocker.
3. Replace the remaining `<ANGLE-BRACKET>` placeholders in `cch-mla/deploy/kubernetes/02-env-configmap.yaml`
   (`KAFKA_BROKERS`, `PPA_BASE_URL`) once the allow-listed endpoint's address exchange lands, and create
   `cch-mla-jws-keys` / `cch-mla-pii-secret` once CCH/Infotex delivers real keys and the PII rotation
   answer resolves.
4. Stand up the agreed ingress-gateway architecture on the Paysys side
   ([`certificate-setup-proposal.md`](certificate-setup-proposal.md)) and reissue MLA's client certificate
   under the gateway's own Interconnect CA, retiring the interim CA once that's live.
5. Reply to George confirming the four decisions recorded in the 15 September update above, and send the
   registry URL + deploy token, `KAFKA_BROKERS`'s variable name, and the digest-pinning acknowledgement.
   **Partially superseded 2026-09-17** — access is being granted directly on GHCR per-username instead
   (see §6's 2026-09-17 update); invite `KhaledSaiidi` and `orcr` (Read role) — still open as of this entry.
6. Live-verify against CCH's actual cluster before calling any of this done, per `engineering-rules.md`
   §11 — a manifest that has only been read, never applied, is a design, not a deployment. Nothing in
   this update was applied to CCH's cluster; only the mechanism (image, registry, manifests, interim
   mTLS, the JWS bypass flag) was produced, pushed, and locally live-verified.

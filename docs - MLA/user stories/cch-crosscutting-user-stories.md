# CCH — Cross-Cutting (Audit, Security, Monitoring, Performance): User Stories & Review

**CCH FRMS | Paysys Labs** | Scope: pipeline-wide, not owned by a single component | 18th August 2026
Source stories: `CCH_UserStories_MessageIngestion_v1.0.md`, Epics 11–12 · Review consolidated from `CCH_UserStories_MessageIngestion_ConsolidatedReview_v1.0.md`
**Testing standard:** 95% test coverage with Jest on every piece of code, applied here and across every other component's stories.

---

## User Stories

### Epic 11 — Audit Logging, Security & Monitoring

#### US-AUD-01 — Write Audit Log Entries for Every Processed Event

**Description**
Every event processed by PPA produces a full audit log entry covering what came in, what was sent, all timestamps, TMS response, error detail, and whether the message was flagged as degraded.

**Acceptance Criteria**
- Every audit entry contains: `correlationId`, envelope `id`, `isoMessageType`, `eventType`, source/destination DFSP, ingestion timestamp, processing outcome (success/error/retry/DLQ), retry count, TMS response code, and the `degraded` flag.
- Entries for events with a DLQ reference include the DLQ entry ID.
- Replay entries include a `replay-of` pointer to the original entry.
- PII fields (MSISDNs, names) are masked/truncated in audit log output (e.g. last 4 digits only). Full values are retrievable only via a separate access-controlled lookup — never embedded in plaintext log lines.
- Audit log storage is a dedicated, append-only store (not Kafka, not PPA's DLQ). Write-only access from PPA; no update or delete API.
- Access to the full audit log is Keycloak-role-gated.
- Retention period is confirmed against CCH compliance policy before go-live.

**Assumptions**
- The audit log store is separate from the DLQ/write-ahead store and from application logs. All three can survive independently of each other.
- Audit entries are immutable — the store must enforce this (no UPDATE/DELETE on committed records).

---

#### US-MON-01 — Monitor Consumer Lag, Circuit Breaker State, and Degraded Message Rate

**Description**
The pipeline's health is invisible without operational telemetry. **The description says "four distinct signals" — the acceptance criteria below list seven. See R-17.**

**Acceptance Criteria**
- A consumer lag metric is emitted per partition and alerted when it exceeds a configured threshold.
- A paused-offset-rate metric is emitted and alerted separately from consumer lag (these indicate different failure modes).
- ValKey memory pressure is alerted before eviction begins — so that a sustained eviction pressure condition is caught before silently losing correlation keys.
- The degraded-message rate (proportion of outbound messages flagged degraded in any 5-minute window) is tracked and alerted. A degraded-message spike is the only signal that an upstream stage is failing silently.
- The circuit breaker state (open/closed/half-open) at both the MLA→PPA and PPA→TMS hops is exposed as a metric and alerted when it trips. **This monitors a PPA→TMS behaviour that has no functional acceptance criteria anywhere — see R-05 in `cch-ppa-user-stories.md`.**
- ValKey reachability and TMS token-refresh health are surfaced as metrics and alerts (not as readiness probe inputs — see US-PPA-01, in `cch-ppa-user-stories.md`).
- All metrics are exposed as Prometheus-compatible endpoints, consistent with CCH's confirmed observability stack (Prometheus, Grafana, Loki, Tempo, Mimir — IDD §10). CCH develops and owns the metrics-collection agents; Paysys provides integration guidance during implementation, not a new monitoring tool.

**Assumptions**
- The specific alert thresholds (e.g. consumer lag > N events, degraded rate > X%) are set during infrastructure commissioning based on the 25 TPS sustained baseline. Default thresholds are placeholders. **That baseline itself is a working assumption, not confirmed — see R-10 below.**
- The observability *stack* is not an open question — Prometheus/Grafana/Loki/Tempo/Mimir is confirmed (IDD §10, 28 July infrastructure discussion). What remains genuinely undecided is alerting **routing**: the destination (PagerDuty, Slack, email) and the mechanism that connects an alert condition to that destination (e.g. Grafana alert rules via Alertmanager). This affects every story in every component document that specifies "raise an alert" — see R-37 below.
- A SIEM/log-aggregation platform is separately unconfirmed (IDD Open Item #8), distinct from the metrics stack above, and relevant to this component's audit-log and security-alert output (US-AUD-01).

---

#### US-MON-02 — Expose Health Endpoints for Load Balancer and Orchestrator

**Description**
PPA's liveness and readiness probes must be correctly scoped so a transient downstream blip does not take the whole PPA fleet out of load-balancer rotation.

**Acceptance Criteria**
- `GET /health/live` returns 200 if the PPA process is running and responsive. It does not check any external dependency.
- `GET /health/ready` returns 200 only when: process is up, config is loaded, and PPA's write-ahead store is reachable and writable. It does **not** check ValKey or the TMS token chain.
- ValKey and TMS token-chain health are exposed as metrics (see US-MON-01), not as readiness-probe inputs.
- The readiness endpoint is the target for the load balancer's health check. A 503 from readiness removes the replica from rotation but does not affect other replicas (unlike a ValKey check, which would take the whole fleet out simultaneously).
- Both endpoints respond within 200 ms under normal conditions.

**Assumptions**
- The load balancer and orchestrator (e.g. Kubernetes) consume these endpoints. Configuration of probe intervals and failure thresholds is done at the infrastructure level, not in application code.

---

### Epic 12 — Performance & Infrastructure

#### US-PERF-01 — Meet Latency Targets at Sustained and Peak TPS

**Description**
The pipeline must deliver each Mojaloop event to TMS within the agreed latency budget at both sustained (25 TPS) and peak (125 TPS) throughput, without data loss or unbounded consumer lag growth.

**Acceptance Criteria**
- MLA end-to-end ack latency (Kafka consume → PPA HTTP 200 received) ≤ 200 ms at p95 under sustained load.
- PPA correlation-to-TMS latency (envelope received → TMS HTTP 200) ≤ 500 ms at p95 under sustained load.
- At peak TPS (125 TPS), consumer lag does not grow unboundedly — the pipeline consumes events at least as fast as they are produced.
- Load tests cover: sustained 25 TPS for 30 minutes, peak 125 TPS for 5 minutes, and a step-down from peak to sustained (no event loss during step-down).
- Kafka partition count and MLA consumer parallelism are sized to the per-action topic event rate (informed by FSD §9.4 guidance). **§9.4's "per-action topic" framing is stale post-audit-topic — see R-29 in `cch-ppa-user-stories.md`.**

**Assumptions**
- The 25 TPS sustained / 125 TPS peak baseline is from the Infrastructure Design Document (`CCH_IDD_SystemDeployment_v1.0.md`). **See R-10 below — this cites a superseded version and overstates the figure's confirmation status.**
- Load testing is against a staging environment that mirrors production sizing. Production sizing is defined in the Infrastructure Design Document (out of scope here).

---

#### US-PERF-02 — Size and Configure ValKey for Correlation Workload

**Description**
ValKey must be sized and configured to hold the full in-flight correlation state for cross-border payments at peak TPS, without evicting active keys under memory pressure.

**Acceptance Criteria**
- ValKey memory capacity is sized using the formula: `Peak concurrent cached entries ≈ TTL(s) × in-flight request rate (req/s) × stages-per-transaction (4) × avg payload size (bytes) × safety factor (1.5–2x)`. The 4-stage multiplier is non-negotiable — all four stages (FX Quote, Quote, FX Transfer, Transfer) may be in-flight concurrently. **See R-10 below — the formula has no worked target figure; IDD v2.0 already works one out (~60K entries, 2–3 GiB, 6-node cluster).**
- TTL is set per FSD §9.3's formula (max of Mojaloop expiration field and worst-case MLA-to-PPA transit + Kafka lag buffer). TTL is not derived from the expiration field alone.
- Eviction policy is `volatile-lru`. Every correlation key and the sent-message dedup set both carry explicit TTLs.
- A dedicated ValKey alert fires on memory pressure before eviction begins (not after).
- ValKey runs as a highly-available cluster (minimum: primary + replica with automatic failover). This is a release-blocking NFR — ValKey downtime is a hard-stop for the pipeline.
- Cache hit ratio is monitored; a sustained drop below a configured threshold triggers an alert.

**Assumptions**
- ValKey is kept entirely separate from Tazama's own Redis/Postgres/NATS infrastructure, consistent with the Infrastructure Design Document's deployment rules.
- The final TTL values are confirmed once the exact per-message payload sizes are known from a staging profiling run.

---

#### US-SEC-01 — Establish mTLS Certificates for MLA↔PPA and PPA↔TMS

**Description**
All inter-service communication must use mutual TLS. Certificate issuance, rotation, and distribution must be specified, owned, and operational before any service goes to production.

**Acceptance Criteria**
- MLA presents a client certificate to PPA on every call. PPA validates against an allow-list containing exactly MLA's certificate (or its CA).
- PPA presents a client certificate to TMS. TMS validates the PPA certificate as a condition of accepting the connection.
- Minimum key size: 2048-bit RSA (or equivalent elliptic curve).
- TLS 1.2 or higher is enforced on all hops. TLS 1.0/1.1 are disabled.
- Certificate rotation is possible without a service restart (hot-reload or rolling restart — confirmed with CCH before implementation).
- Certificate expiry is monitored with an alert fired well before expiry (minimum 30-day warning).
- The certificate issuance and rotation policy is documented and owned by a named team before go-live.

**Assumptions**
- The MLA → PPA hop uses mutual TLS **only** (no bearer token on this hop) because MLA sits inside Mojaloop's network boundary and cannot reach Tazama-owned identity infrastructure.
- The PPA → TMS hop uses mutual TLS **and** a Keycloak bearer token — both are required. mTLS authenticates which service is calling; the token authorizes what it is allowed to do.
- Certificate tooling (e.g. Vault PKI, cert-manager on Kubernetes, or manual issuance) is determined at infrastructure setup time, not here.

---

## Review Findings

| # | Finding | Sev | Status |
| --- | --- | --- | --- |
| R-10 | US-PERF-01's 25/125 TPS baseline is cited as confirmed and from a superseded IDD version. IDD v2.0 states it's a working assumption pending CCH sign-off (Open Item #1 in the IDD, distinct from the FSD's own Open Item #1). US-PERF-02's ValKey formula has no target figure — IDD works one out. | **Medium** | Open |
| R-14 | FSD cites the wrong Open Item number (#6 instead of #4) for the payee-name gap. No story impact — fix owed to the FSD. | Low | Open |
| R-17 | US-MON-01's description states "four distinct signals"; its acceptance criteria list seven. | Low | Open |
| R-23 | Event Envelope versioning contract (IID §5.2) not covered — tracked primarily in `cch-mla-user-stories.md` since MLA constructs the envelope; noted here since US-MON-01/US-AUD-01 would need to handle a version bump if one occurs. | Low | Open (see MLA doc) |
| R-31 | FSD Open Item #1 (timeout values) — tracked primarily in `cch-mla-user-stories.md` and `cch-ppa-user-stories.md` against the specific timeout/retry stories it affects. | **Medium** | Open (see MLA, PPA docs) |
| R-36 | No Phase 1 Exclusions / Non-Goals section anywhere in the user stories, mirroring FSD §11. Only the domestic-transfer exclusion has a story (US-PPA-07, in `cch-ppa-user-stories.md`). Missing: no inline interdiction, no Rule Builder/SDK, no Mojoloop switch modifications, no ALS/party-discovery Kafka capture. This is document-wide scope hygiene, not owned by any one component — belongs here. | Low | Open |
| R-37 | Alerting destination/routing (PagerDuty/Slack/email, plus the mechanism connecting an alert condition to that destination) is undecided pipeline-wide, and a SIEM/log-aggregation platform is separately unconfirmed (IDD Open Item #8) — despite nearly every story across every component document specifying "raise an alert." The FSD (§6.7) states this is "tracked separately in §12 Open Items"; it is not actually one of the FSD's 9 listed Open Items — a cross-reference gap in the FSD itself. The underlying observability *stack* (Prometheus/Grafana/Loki/Tempo/Mimir) is confirmed (IDD §10) and not in question. | **High** | Open |

---

## Actions

| # | Action | Owner | Status |
| --- | --- | --- | --- |
| 1 | Correct the IDD citation on US-PERF-01; restate the TPS baseline as a working assumption; add IDD's worked ValKey sizing figure to US-PERF-02 (R-10) | Story + FSD author | Open |
| 2 | Fix FSD's Open Item cross-reference (R-14) | FSD author | Open |
| 3 | Align US-MON-01's stated signal count with its actual acceptance criteria (R-17) | Story author | Open |
| 4 | Add a Non-Goals / Phase 1 Exclusions section mirroring FSD §11 (R-36) | Story author | Open |
| 5 | Get CCH to confirm alerting destination/routing and the SIEM/log-aggregation platform; add this as a proper FSD Open Item, correcting the §6.7 cross-reference (R-37) | CCH + FSD author | Open |

---

*End of Document*

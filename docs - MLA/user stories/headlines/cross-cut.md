# Cross-Cutting — Headlines

## From cch-crosscutting-user-stories.md

### Epic 11 — Audit Logging, Security & Monitoring

#### US-AUD-01 — Write Audit Log Entries for Every Processed Event

**Description**
Every event processed by PPA produces a full audit log entry covering what came in, what was sent, all timestamps, TMS response, error detail, and whether the message was flagged as degraded.

#### US-MON-01 — Monitor Consumer Lag, Circuit Breaker State, and Degraded Message Rate

**Description**
The pipeline's health is invisible without operational telemetry. **The description says "four distinct signals" — the acceptance criteria below list seven. See R-17.**

#### US-MON-02 — Expose Health Endpoints for Load Balancer and Orchestrator

**Description**
PPA's liveness and readiness probes must be correctly scoped so a transient downstream blip does not take the whole PPA fleet out of load-balancer rotation.

### Epic 12 — Performance & Infrastructure

#### US-PERF-01 — Meet Latency Targets at Sustained and Peak TPS

**Description**
The pipeline must deliver each Mojaloop event to TMS within the agreed latency budget at both sustained (25 TPS) and peak (125 TPS) throughput, without data loss or unbounded consumer lag growth.

#### US-PERF-02 — Size and Configure ValKey for Correlation Workload

**Description**
ValKey must be sized and configured to hold the full in-flight correlation state for cross-border payments at peak TPS, without evicting active keys under memory pressure.

#### US-SEC-01 — Establish mTLS Certificates for MLA↔PPA and PPA↔TMS

**Description**
All inter-service communication must use mutual TLS. Certificate issuance, rotation, and distribution must be specified, owned, and operational before any service goes to production.

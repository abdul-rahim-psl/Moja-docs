# PPA — Headlines

## From cch-ppa-user-stories.md

### Epic 6 — PPA: Ingress API & Write-Ahead Persist

#### US-PPA-01 — Expose Per-Action Inbound Endpoints Over Mutual TLS

**Description**
PPA exposes four POST endpoints, one per event type, plus health check endpoints. All are served exclusively over mutual TLS — a connection without a recognised MLA client certificate is rejected at the TLS layer before any application logic runs.

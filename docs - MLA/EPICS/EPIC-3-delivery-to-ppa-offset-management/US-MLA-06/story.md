# US-MLA-06 — Deliver Envelopes to PPA via Per-Action Endpoints

**Epic:** Epic 3 — MLA: Delivery to PPA & Offset Management
**Source:** `docs/user stories/cch-mla-user-stories.md`

---

## Description

MLA POSTs each constructed envelope to the appropriate PPA endpoint over mutual TLS. It must not advance the Kafka offset until PPA acknowledges receipt with HTTP 200. This offset-gated handoff is what makes the pipeline's durability guarantee real.

Per the FSD's own endpoint table (§5.x, confirmed in both the summary table and the sequence diagrams), PPA exposes exactly one endpoint per event type, and that single endpoint receives **both** legs — request and callback (and, for TRANSFER/FXTRANSFER, the fulfil/reject/abort/error variants too). The two legs are not routed to different endpoints; they are distinguished inside the envelope by `msgType`, not by URL or HTTP method. This is the FSD's stated design, not something introduced by these stories.

**Routing Table**

| `eventType` | PPA Endpoint | Method | Covers |
| --- | --- | --- | --- |
| QUOTE | `/QUOTES` | POST | Request, callback, and error variants |
| FXQUOTE | `/FXQUOTES` | POST | Request, callback, and error variants |
| TRANSFER | `/TRANSFERS` | POST | Prepare and fulfil/final-state (reject/abort/error variants too) |
| FXTRANSFER | `/FXTRANSFERS` | POST | Request, reserve callback, and commit (reject/abort/error variants too) |

The FSD's table also lists a fifth endpoint, `/TRANSFERS/NOTIFICATIONS`, for a deduplicated Central Ledger final-state notification. That endpoint does not apply here — there is no such event on the wire to route (see US-MLA-01/02 and `cch-notification-dedup-user-stories.md`); the fulfil leg is already covered by `/TRANSFERS` above.

## Acceptance Criteria

- Each envelope is sent to the correct PPA endpoint based on `eventType`, per the Routing Table above. Both legs of a given event type share the same endpoint; PPA distinguishes them by the envelope's `msgType`.
- The MLA waits for HTTP 200 from PPA before committing the Kafka offset. It does not advance the offset on any other response.
- All MLA → PPA calls use mutual TLS. A TLS handshake failure (missing/unrecognised client certificate, expired cert, PPA's server cert not yet trusted mid-rollout, etc.) is treated as a 5xx-equivalent (transient) and fed into the same retry/circuit-breaker path as an HTTP 5xx (R-22). The alert raised on retry exhaustion or breaker trip retains the underlying failure reason (handshake failure vs. HTTP 5xx) even though both drive the same state machine, so a genuine certificate misconfiguration is still distinguishable from ordinary PPA unavailability once someone looks at the alert.
- MLA addresses PPA via a single stable service name / load balancer address, never individual replica addresses. This address is configurable.
- MLA does not wait for PPA to finish processing the event — only for PPA to confirm receipt with HTTP 200.
- MLA enforces a per-call timeout against PPA (configured independently from the retry/backoff budget); the call is treated as a timeout/5xx if the timeout is breached. **See R-31 below — the actual timeout value isn't agreed yet (FSD Open Item #1).**

## Method

1. **Select endpoint** — resolve the target PPA endpoint from the envelope's `eventType`, per the Routing Table above. `msgType` (already set by US-MLA-04) is not part of endpoint selection — it travels in the envelope body for PPA to read.
2. **Send** — POST the envelope to PPA over mutual TLS, addressed via the stable load-balancer name.
3. **Wait** — block on PPA's response up to the configured per-call timeout.
4. **Commit on success** — advance the Kafka offset only after receiving HTTP 200.
5. **Hand off on failure** — any non-200 response, timeout, or TLS handshake failure is passed to the retry/circuit-breaker logic (US-MLA-07) instead of committing the offset.

## Assumptions

- PPA's HTTP 200 means the envelope has been durably written to PPA's write-ahead store (the FSD §4.3 guarantee). MLA trusts this; it does not independently verify PPA's durability state.
- The PPA load balancer address and port are provided via environment configuration.
- Pairing request and callback onto one endpoint per event type, distinguished by `msgType`, is the FSD's own design (§5.x) — not a simplification introduced here. `msgType` is what PPA reads to tell the two legs apart on this shared endpoint (`request`/`callback`, resolved in US-MLA-04 — R-03).
- mTLS certificates for MLA (client cert/key) and for trusting PPA (CA cert) are provisioned externally and mounted at startup.

## Todos

1. Implement the mTLS client configuration and the endpoint-selection logic.
2. Implement the offset-commit gate (commit only on PPA 200).
3. Implement and configure the per-call timeout, independent from the retry/backoff budget.
4. Write tests (Jest, 95% coverage target) covering: successful delivery + commit, non-200 handoff to retry logic, and TLS handshake failure handling, confirming the underlying failure reason is preserved in the resulting alert (R-22).
5. Confirm the actual timeout value with CCH (FSD Open Item #1 / R-31).

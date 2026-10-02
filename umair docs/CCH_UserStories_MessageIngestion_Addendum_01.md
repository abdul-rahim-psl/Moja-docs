# Addendum 01 — Message Ingestion Design Changes
**CCH FRMS | Paysys Labs**
Document Ref: CCH-PL-MSGING-ADD-01 | v1.0 | October 2026
Related: CCH-PL-FSD-MSGING-001 v4.0 (Open Items #2, #3 and #5)

| Version | Date | Author | Summary |
|---|---|---|---|
| v1.0 | October 2026 | Behjet Ansari | Initial issue. Change A: removal of the Notification Filter/Dedup component. Change B: removal of JWS signature validation on the audit topic. |

---

## 1. Purpose

This addendum records two changes to the Message Ingestion design and the reasons for them.

| Change | Summary |
|---|---|
| **A** | The Notification Filter/Dedup component is removed from the ingestion pipeline. |
| **B** | JWS signature validation on messages consumed from the audit topic is removed. |

---

## 2. Change A — Removal of the Notification Filter/Dedup Component

### 2.1 What Changed

- The Notification Filter/Dedup component has been removed. The ingestion path is now **audit topic → PII Protection → MLA → PPA → Tazama TMS**.
- The **transfer fulfil callback is the sole trigger for pacs.002**.
- **PPA's final-state idempotency check is the only deduplication mechanism for final-state transfer events.** It already existed in the design and is unchanged. It checks `transferId`, enforces terminal-state ordering, and is backed by PPA's durable write-ahead store, so a redelivered fulfil callback is never processed twice.

### 2.2 Why

The component existed to handle a possible second final-state signal per transfer: a Central Ledger notification published independently of the fulfil callback. If both signals were present, Tazama could receive two pacs.002 messages for one transfer.

The DRPP Kafka end-to-end capture (`DRPP_Kafka_E2E_Pack`) shows that this second signal does not exist:

1. **No separate Central Ledger notification appears on the audit topic.** The fulfil callback is the only final-state event.
2. **`commitTransfer` is not a second event.** It is the switch's outbound relay of the same fulfil callback.
3. **The fulfil callback carries the required routing headers.** `fspiop-source` and `fspiop-destination` are present on every sampled corridor, so the fulfil callback alone is enough to build pacs.002.

With only one final-state event per transfer, the component has nothing to filter. Keeping it would add a hop and a failure point to the pipeline without reducing any risk.

The capture contains only successful settlements. The error-callback → pacs.002 (`TxSts: RJCT`) path is defined in FSD §6.5 and is unaffected by this change.

---

## 3. Change B — Removal of JWS Signature Validation on the Audit Topic

### 3.1 What Changed

- MLA no longer validates the `FSPIOP-Signature` (JWS) header on messages consumed from the audit topic.
- No public key registry is needed, and no keys need to be distributed for DFSPs, regional switches, eNIIPs or FXPs.

### 3.2 Why

It was mutually agreed and decided that a second JWS validation on the audit topic is unnecessary. The reasons are:

1. **Messages are already validated.** The switch validates every message, including its JWS signature, before publishing it to Kafka.
2. **The hub is the only source.** Messages reach the audit topic only through transactions processed by the hub.
3. **The audit topic is inside the validation boundary.** The Kafka topic is in the same system boundary as the switch's validation process.

A repeat validation would therefore re-run a check already performed within the same trust boundary. It would also bring a significant operational burden. The DRPP spans a regional hub and the eNIIPs for each region, so messages come from DFSPs, regional switches, eNIIPs and FXPs across more than one MCM. Keeping public keys current for all of these entities would require key distribution across several MCMs.

### 3.3 Controls That Remain in Place

The transport and access controls on MLA's Kafka connection are unchanged:

- MLA authenticates to Kafka using SASL or mTLS with a dedicated, least-privilege service account.
- The Kafka connection is TLS-encrypted.
- The MLA service account has READ access to the audit topic only, enforced by broker-level ACLs.

---

## 4. FSD Open Items Closed

| FSD Open Item | Status | Reason | Change |
|---|---|---|---|
| #2 | Closed | The Notification Filter/Dedup component is removed (Section 2.2) | A |
| #3 (whether the `FSPIOP-Signature` header survives the chain to the audit topic) | Closed — not applicable | JWS validation on the audit topic is removed (Section 3.2) | B |
| #5 | Closed | The fulfil callback is confirmed as the sole final-state event and carries the required routing headers | A |

---

## 5. Impact Summary

| Area | Change A | Change B |
|---|---|---|
| Architecture | One fewer component between the audit topic and PPA | No component change; MLA no longer performs signature checks |
| Security | No change | Message integrity relies on the switch's validation within the DRPP system boundary; Kafka authentication, TLS and read-only ACLs are retained |
| Deduplication | Final-state deduplication handled in one place, in PPA | No change |
| pacs.002 generation | Single trigger source: the fulfil callback | No change |
| Key management | No change | No public key registry or cross-MCM key distribution needed |
| Latency | One hop removed | Per-message signature verification removed |
| Interfaces | No change to the MLA ↔ PPA envelope contract, PPA endpoints, or the PPA ↔ TMS interface | No change |

---

## 6. Requested Action

Please review and acknowledge:

1. The removal of the Notification Filter/Dedup component (Change A), and the closure of FSD Open Items #2 and #5.
2. The removal of JWS signature validation on the audit topic (Change B), and the closure of FSD Open Item #3. This includes confirming that:
   - messages reach the audit topic only through transactions validated by the hub; and
   - write access to the audit topic is restricted to the switch's own services.

---

## 7. Acknowledgement

| Role | Name | Organisation | Signature | Date |
|---|---|---|---|---|
| Prepared by | Behjet Ansari | Paysys Labs | | |
| Reviewed by | | CCH | | |
| Acknowledged by | | CCH | | |
| Acknowledged by | | Mojaloop Partner | | |

---

*End of Addendum*

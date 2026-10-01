# US-MLA-03 — Decode Base64-Encoded Transfer Payloads

**Epic:** Epic 1 — MLA: Kafka Subscription & Audit Topic Ingestion
**Source:** `docs - MLA/user stories/cch-mla-user-stories.md`

---

## Description

Transfer and FX-transfer topic payloads arrive inside the audit topic as base64-encoded `data:` URIs. The MLA must decode these before field extraction or envelope construction. Quote payloads arrive as plain JSON and do not need this step.

## Acceptance Criteria

- For TRANSFER and FXTRANSFER events, MLA detects the `data:` URI wrapper and base64-decodes the body before any further processing.
- For QUOTE and FXQUOTE events, MLA reads the body as-is (plain JSON) without a decode step.
- A payload that claims to be a TRANSFER type but fails base64 decoding is treated as unreadable: logged, offset advanced, not forwarded.
- Decoded output is valid JSON; if it is not, the event is treated as unreadable (same as above).
- Unit tests cover: valid base64 transfer payload, valid plain JSON quote payload, malformed base64 payload, and a payload with an empty body.

## Method

1. **Detect** — check whether the body is wrapped in a `data:` URI (TRANSFER/FXTRANSFER) or is already plain JSON (QUOTE/FXQUOTE).
2. **Decode** — for wrapped bodies, base64-decode the content.
3. **Validate** — parse the result as JSON; if decoding or parsing fails, treat the event as unreadable.
4. **Pass through** — hand the resulting plain JSON body on to classification and envelope construction.

## Assumptions

- The `data:` URI prefix format is consistent across Kafka events and does not change between Mojaloop versions without a migration notice from the Mojaloop Partner.
- This decoding step is MLA's responsibility only. PPA never performs decoding — it receives already-decoded JSON bodies in the envelope.

## Todos

1. Implement the decode/validate step, including the unreadable-payload fallback (log + advance offset, no forward).
2. Write tests (Jest, 95% coverage target) covering: valid base64 transfer payload, valid plain JSON quote payload, malformed base64, and empty body.

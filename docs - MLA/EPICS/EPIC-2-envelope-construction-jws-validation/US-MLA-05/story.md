# US-MLA-05 — Validate JWS Signatures on DFSP-Originated Events

**Epic:** Epic 2 — MLA: Envelope Construction & JWS Validation
**Source:** `docs/user stories/cch-mla-user-stories.md`

---

## Description

MLA must validate the `FSPIOP-Signature` header (RS256/384/512) on every DFSP-originated event before forwarding it to PPA. Events with a missing or invalid signature are rejected and an operations security alert is raised. No exemption applies — every event on this topic, including the transfer's fulfil/final-state leg, is DFSP-originated and signed; there is no genuinely switch-generated Central Ledger event on the audit topic to exempt.

## Acceptance Criteria

- For every event type (QUOTE, FXQUOTE, TRANSFER — both prepare and fulfil legs, FXTRANSFER), MLA checks the `FSPIOP-Signature` header against the sending DFSP's registered public key. No event type is exempt.
- An event with a missing signature header is rejected: logged as a security event, alert raised, offset advanced (not retried — this is a permanent failure).
- An event with an invalid signature (key mismatch, tampered body) is rejected with the same behaviour.
- Public key lookup for each DFSP is configurable and does not require a service restart to add a new key.
- Unit tests cover: valid signature, missing header, signature mismatch — for each of the four event types, including the fulfil leg specifically.

## Method

1. **Extract** — read the `FSPIOP-Signature` header from the event, before any decoding or field extraction changes the body.
2. **Look up** — resolve the sending DFSP's registered public key from configuration.
3. **Verify** — check the signature against the original, untouched payload.
4. **Reject on failure** — if the header is missing or verification fails, log as a security event, raise an alert, and advance the offset without retrying.
5. **Proceed on success** — a validated event moves on to envelope construction (US-MLA-04) and delivery.

## Assumptions

- Whether the `FSPIOP-Signature` header survives the DFSP → Mojaloop switch → Kafka → audit topic chain is Open Item #3 in the FSD. If the header does not survive the base64 data-URI re-serialisation on transfer topics, JWS validation as specified cannot be implemented and an alternative (e.g. topic-level authentication) must be agreed with CCH before this story can be closed. This applies uniformly to the fulfil leg too, since it is not treated as a special case.
- DFSP public key storage and rotation follow the certificate policy in §10.1 of the FSD. Key distribution mechanism is owned by CCH / Mojoloop Partner.
- MLA must itself have read access to every registered DFSP's public key at verification time — either a local, kept-in-sync copy or a reachable lookup service. This is a hard dependency: MLA cannot validate a signature without holding, or being able to fetch, the corresponding public key at the moment it processes the event. How MLA obtains and keeps this set current (a pushed/synced local store vs. a live per-event lookup against Mojoloop's key registry) is not yet decided and needs to be settled with CCH / the Mojoloop Partner, since it also affects the availability story here — a lookup-service outage would otherwise start failing every event as "invalid signature" rather than as a distinguishable infrastructure fault.
- Where this story's security alert actually goes, and how, is not decided here — see US-MON-01 in `cch-crosscutting-user-stories.md` (R-37): the observability stack is confirmed, but alerting destination/routing is not.

## Todos

1. Implement the signature-extraction and verification step, applied uniformly across all four event types with no exemptions.
2. Wire up the public-key lookup so new DFSP keys can be added without a restart.
3. Decide and implement how MLA sources DFSP public keys (synced local store vs. live lookup service) and how a key-source outage is distinguished from a genuine signature failure, so the two don't get logged/alerted identically.
4. Wire up the security-alert path for missing/invalid signatures.
5. Write tests (Jest, 95% coverage target) covering valid signature, missing header, signature mismatch, and an unreachable/missing public key, for each of the four event types including the fulfil leg specifically.
5. Confirm with the Mojoloop Partner / CCH that the signature header survives the full chain to the audit topic (Open Item #3) before this story is considered final.

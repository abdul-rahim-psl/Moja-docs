<!-- SPDX-License-Identifier: Apache-2.0 -->

# End-to-End Happy-Path Checklist — MLA ↔ PPA <!-- omit in toc -->

**What this is.** A functional checklist for proving the *core* MLA→PPA flow works, start to finish, against a real broker and a real (stubbed) PPA — one clean, unmodified cross-border transaction, no faults injected. It exists because everything live-verified so far (`plan.md` §16) proves individual mechanisms and failure paths in isolation; this walks the *whole* pipeline in one sitting, in the order a payment actually moves through it, so a single run gives a yes/no answer on "does the core flow work."

**What this is not.** Not a fault, retry, breaker, rejection, chaos, load, or multi-instance test — `tools/scenario-library` already covers those (`environment-simulation.md` §1, `plan.md` §4/§10) and this checklist deliberately does not repeat them. Every step below is the *happy* path only, per the explicit scope given for this checklist [2026-09-17].

**Scope — MLA ↔ `ppa-stub` (§§1–15 below), not MLA ↔ the real PPA.** `ppa-stub` (`tools/ppa-stub/`) validates every envelope against the same ajv schema PPA would, speaks real mTLS, and records what it accepts — but it never translates to ISO 20022, correlates across legs, or dispatches to Tazama's TMS (`environment-simulation.md` §3.2 — "never a re-implementation"). §§1–15 prove MLA's own half of the contract genuinely works end to end; they cannot and do not prove anything about PPA's real nine-step pipeline (`core-knowledge.md` §6.1).

**A real PPA does now exist**, built separately by another engineer (not tracked in this docs folder — `strategy.md` §1, `CLAUDE.md`) and confirmed live [2026-09-17] at `http://10.0.115.186:3000` (OpenAPI doc at `/documentation`, matching this project's own Event Envelope contract and business-endpoint routing exactly). §19 below is a separate, additional pass against that real instance — run §§1–15 against `ppa-stub` first regardless, since the real PPA's mTLS/config requirements are not yet confirmed (§19's own open item) and a genuine integration bug is far easier to isolate once the `ppa-stub` pass is already known-clean.

- [1. Prerequisites](#1-prerequisites)
- [2. Bring up the harness](#2-bring-up-the-harness)
- [3. Start MLA and confirm it's healthy](#3-start-mla-and-confirm-its-healthy)
- [4. Make the corridor genuinely verifiable](#4-make-the-corridor-genuinely-verifiable)
- [5. Feed the corridor](#5-feed-the-corridor)
- [6. Ingestion and canonical selection](#6-ingestion-and-canonical-selection)
- [7. Classification](#7-classification)
- [8. Payload decode](#8-payload-decode)
- [9. JWS signature verification](#9-jws-signature-verification)
- [10. PII tokenization](#10-pii-tokenization)
- [11. Envelope construction and schema validity](#11-envelope-construction-and-schema-validity)
- [12. Delivery to PPA over mTLS](#12-delivery-to-ppa-over-mtls)
- [13. Offset commit behaviour](#13-offset-commit-behaviour)
- [14. What actually landed at PPA](#14-what-actually-landed-at-ppa)
- [15. Metrics sanity sweep](#15-metrics-sanity-sweep)
- [16. Optional — repeat at larger scale](#16-optional--repeat-at-larger-scale)
- [17. Teardown](#17-teardown)
- [18. Definition of done](#18-definition-of-done)
- [19. Additional pass — the real PPA instance](#19-additional-pass--the-real-ppa-instance)

---

## 1. Prerequisites

- [ ] Node ≥ 22.17, `npm install` already run at `cch-mla`'s repo root.
- [ ] Docker with the Compose plugin (see `tools/README.md` §1 for the VS Code snap / `docker-compose` workaround if `docker compose` fails silently).
- [ ] `openssl` on `PATH` (for `npm run certs:generate`).
- [ ] A terminal per long-running process: harness, `ppa-stub`, MLA, and one free for commands. Four terminals total.

---

## 2. Bring up the harness

- [ ] `npm run harness:up` — Redpanda up, `topic-event-audit` created at 12 partitions.
- [ ] `npm run certs:generate` — local CA + server + client certs for `ppa-stub`'s mTLS, written under `tools/ppa-stub/certs/`.
- [ ] `npm run pii-secret:generate` — writes the local PII tokenization secret to `tools/pii-secret/generated/local.secret` (matches `.env.template`'s `PII_SECRET_PATH`).
- [ ] Start `ppa-stub` in its own terminal: `npm run ppa-stub`. Confirm it logs both listeners up — business (mTLS, port 4443) and control/health (plain HTTP, port 4001).
- [ ] `curl http://localhost:4001/health/ready` → `200`, confirms the stub itself is reachable before anything is fed at it.

---

## 3. Start MLA and confirm it's healthy

- [ ] Copy `.env.template` to `.env` if not already done; leave `KAFKA_ENABLED=true` for this test (the template default is `false`, meant only for a no-broker smoke start).
- [ ] Start MLA in its own terminal: `npm run dev`.
- [ ] `curl http://localhost:3001/health/live` → `{"status":"UP",...}`.
- [ ] `curl http://localhost:3001/health/ready` → `{"status":"UP", kafka:"UP", piiSecret:"UP", jwsKeyStore:"UP"}`. **If any of the three is `DOWN`, stop here** — nothing downstream can be trusted until all three are `UP` (`health.service.ts` — `status` is `UP` only when all three are).
- [ ] `curl http://localhost:3001/metrics` → returns Prometheus text output with no errors (confirms the metrics client is wired before the run, so the deltas checked later actually mean something).

---

## 4. Make the corridor genuinely verifiable

The captured signatures in every fixture belong to real DFSPs whose private keys we do not hold (`plan.md` §13.1) — fed unmodified, every canonical record fails JWS as `invalid-signature`, by design. To exercise the *happy* path, records must be locally re-signed against a throwaway keypair first (`plan.md` §6, the same mechanism Phase 3's own exit criterion and Phase 7's load test both use).

Recommended fixture: `__tests__/fixtures/DRPP_Kafka_E2E_Pack/01_MWK_to_ZMW_PRIMARY/raw_messages.json` — one complete corridor transaction (20 records, 1 partition), touching all four `eventType`s (QUOTE, FXQUOTE, TRANSFER, FXTRANSFER) plus party lookups, with no rejection or fault shape mixed in — the same fixture the `happy-path` named scenario (`tools/scenario-library/scenarios.ts`) uses.

- [ ] Generate a throwaway keypair for every DFSP id that appears as `fspiop-source` in the chosen fixture. For `01_MWK_to_ZMW_PRIMARY`, that's four ids:
  ```bash
  npm run keys:generate -- test-mwk-dfsp test-zmw-dfsp test-fxp2 hub-region-stg
  ```
  Confirm `tools/dfsp-keys/store/*.pem` (public, read by the running MLA via `fs.watch` — no restart needed) and `tools/dfsp-keys/private/*.key` (private, read only by `--resign`) now hold four files each.
- [ ] Confirm the running MLA picked the new keys up with no restart: `/health/ready`'s `jwsKeyStore` stays `UP` throughout (it was already `UP` with an empty store; this just confirms the watch didn't crash on the new files).

---

## 5. Feed the corridor

- [ ] Re-sign every resignable record in the fixture and feed it at burst speed:
  ```bash
  npm run feeder -- --file __tests__/fixtures/DRPP_Kafka_E2E_Pack/01_MWK_to_ZMW_PRIMARY/raw_messages.json --resign 0-19
  ```
  `--resign` on an index that cannot be signed (no `fspiop-source`, or no body — the party-lookup `GET`s) is silently skipped, not an error (`resign.ts`'s own `isResignable` guard) — the feeder logs how many were skipped and why.
- [ ] Feeder's own summary line reads `Fed 20 record(s)`. If it doesn't, the fixture path or count assumption above is wrong — stop and re-check before reading anything downstream as a pass.

---

## 6. Ingestion and canonical selection

- [ ] MLA's logs show 20 consumption lines, one per record, each ending in either a forwarded outcome or a named skip reason — never a raw exception or an unhandled-promise warning.
- [ ] Every **party-lookup** operation (`getPartiesByTypeAndID`, `putPartiesByTypeAndID`) is skipped with reason `party-lookup`, not folded into a generic skip.
- [ ] Every **non-canonical** half of a `start`/`egress` pair (`core-knowledge.md` §2.4, D1) is skipped with reason `egress` — the code's coarse name for "failed canonical selection," used for *every* non-canonical half regardless of which action value it actually carries (`ingestion.service.ts`'s own `SkipReason` comment) — never silently dropped with no log line.
- [ ] Nothing is skipped as `unclassifiable` or logged as `unreadable` — both would mean a record this fixture is known to classify cleanly fell through a gap.

---

## 7. Classification

- [ ] Across the run, MLA forwards at least one envelope of **each** of the four `eventType`s: `QUOTE`, `FXQUOTE`, `TRANSFER`, `FXTRANSFER` (`core-knowledge.md` §2.3–§2.4). Confirm from the log lines (`"Forwarded <EVENTTYPE>"`) rather than assuming a count — canonical selection and classification interact in ways that are easy to get wrong by hand (see `plan.md` §3.2's own correction of its first count).
- [ ] Each forwarded envelope's `msgType` is exactly `request` (POST leg) or `callback` (PUT/PATCH leg) — never a third value (`core-knowledge.md` §5).

---

## 8. Payload decode

- [ ] For every forwarded **TRANSFER** and **FXTRANSFER** envelope, the `body` in the delivered envelope (§14 below) is decoded JSON, not a `data:` URI string — confirms the mandatory base64 decode (US-MLA-03, D6) ran before envelope construction.
- [ ] For every forwarded **QUOTE** and **FXQUOTE** envelope, the body matches the record's own `content.payload` directly (no decode step applies — `core-knowledge.md` §2.5).

---

## 9. JWS signature verification

- [ ] Zero `invalid-signature` or `missing-signature` skips in this run. Any occurrence means either a key didn't generate correctly (§4) or a record that should have been resignable was skipped by `--resign` (§5's skip count) — re-check both before treating the run as a genuine pass.
- [ ] `mla_jws_validation_bypassed` (`/metrics`) reads `0` throughout — confirms the JWS bypass flag (`JWS_VALIDATION_DISABLED`) is off and every pass above is a genuine cryptographic verification, not a bypassed one.

---

## 10. PII tokenization

- [ ] Run the dedicated verification tool against the same running harness:
  ```bash
  npm run verify:tokenization
  ```
  It asserts, end to end against the real `ppa-stub` over real mTLS: (1) party-identity fields carry the `tkn_` prefix, (2) tokenization is deterministic (same input → same token), (3) transaction amounts reach `ppa-stub` unchanged, (4) ILP-carried fields on TRANSFER/FXTRANSFER bodies are exempt and reach `ppa-stub` byte-identical. All four must pass.
- [ ] Independently, inspect one forwarded **QUOTE** envelope in `tools/ppa-stub/output/received.jsonl` (§14) by eye: `payer.partyIdInfo.partyIdentifier`, `payee.partyIdInfo.partyIdentifier`, and `payer.personalInfo.complexName` all start with `tkn_`; `amount` is untouched cleartext.

---

## 11. Envelope construction and schema validity

- [ ] No record in this run is skipped as `incomplete-envelope` — every forwarded record carries `msgType`, `eventType`, `id`, `fspiop-source`, and `fspiop-destination` (`core-knowledge.md` §5).
- [ ] `ppa-stub` returns `400` for zero requests in this run (check its own request log or `mla_rejected_total{reason="client-error"}` stays at its pre-run value — the label PPA's own 4xx responses are counted under) — confirms every envelope MLA built passed the shared ajv schema both ends enforce.

---

## 12. Delivery to PPA over mTLS

- [ ] Every forwarded envelope reaches the **correct** business endpoint for its `eventType` (`core-knowledge.md` §3.4's routing table): `QUOTE`→`/QUOTES`, `FXQUOTE`→`/FXQUOTES`, `TRANSFER`→`/TRANSFERS`, `FXTRANSFER`→`/FXTRANSFERS`, all `POST`, all on `ppa-stub`'s mTLS port (4443) — never distinguished by URL suffix or HTTP method beyond that.
- [ ] Confirm the connection is genuinely mTLS, not plain TLS: from a separate shell, **not** MLA, against the same running `ppa-stub`, run `curl -k https://localhost:4443/QUOTES -d '{}'` with no client certificate; it must fail at the TLS handshake (`certificate required`), proving MLA's own successful deliveries above were genuinely presenting a client certificate, not connecting to a server that accepts anyone.
- [ ] `mla_ppa_delivery_outcomes_total{outcome="success"}` (`/metrics`) increased by exactly the number of envelopes forwarded in §7; every other outcome value (`client-error`, `server-error`, `tls-handshake-failure`, `network-error`, `timeout`) stays at its pre-run value — a genuine happy-path run produces none of them.

---

## 13. Offset commit behaviour

- [ ] Confirm the consumer group actually advanced: `mla_consumer_lag` (`/metrics`), scoped to the partition the fixture landed on, returns to `0` once the run settles — nothing left uncommitted.
- [ ] Restart MLA (`Ctrl-C`, then `npm run dev` again) and confirm no reprocessing: no new "Forwarded"/"Skipped" log lines appear until fresh data is fed. This proves the offset was genuinely committed past every record in this run, not merely acted upon.

---

## 14. What actually landed at PPA

- [ ] `tools/ppa-stub/output/received.jsonl` contains exactly one line per envelope forwarded in §7 (cross-check the line count against `mla_forwarded_total`'s total delta).
- [ ] Spot-check one line per `eventType`: `id` is present and non-empty, `msgType` ∈ {`request`,`callback`}, `body` is a decoded JSON object (never a raw string), `correlationId` is a fresh UUID distinct across every line (never reused, never the Kafka key — `core-knowledge.md` §2.6).
- [ ] The **same `id`** appears on exactly two lines for the TRANSFER pair (prepare + fulfil/final, both carrying `transferId`) and is distinguished only by `msgType` — confirms the `id`+`msgType` compound identity (`core-knowledge.md` §5) is real, not just documented.

---

## 15. Metrics sanity sweep

Pull `/metrics` once more after the run and confirm, relative to the values recorded before §5:

- [ ] `mla_forwarded_total` increased by the same number counted in §7.
- [ ] `mla_rejected_total` and `mla_tokenization_failures_total` are **unchanged** — zero rejections and zero tokenization failures is what "happy path" means numerically.
- [ ] `mla_keystore_unavailable_total` is **unchanged** — the key store was healthy throughout.
- [ ] `mla_pii_breaker_state`, `mla_jws_breaker_state`, `mla_ppa_breaker_state` all read `0` — no breaker ever tripped.
- [ ] `mla_partition_paused` reads `0` for every partition — nothing was ever parked.
- [ ] `mla_alerts_total` is **unchanged** — a genuinely clean run raises no alert of any kind.
- [ ] `mla_ack_latency_ms` gained samples (confirms the histogram is live) — the actual p95 budget (200 ms) is Phase 7's load-test concern, not this checklist's; a handful of samples from a 20-record burst is not a statistically meaningful latency claim either way.

---

## 16. Optional — repeat at larger scale

Once the single corridor above passes cleanly, repeat with more data to build confidence the result isn't an artefact of one small fixture:

- [ ] `npm run scenario -- happy-path` — the same corridor, run through the named-scenario harness (still without `--resign`, so this specific invocation is expected to show `invalid-signature` skips, not forwards; use it to confirm the *mechanism* runs cleanly end-to-end, not to re-check §6–§14's pass criteria).
- [ ] Feed the full 500-record export, re-signed: `npm run feeder -- --file __tests__/fixtures/raw_export_500/raw_export_500.json --resign 0-499`. Re-check §15's metrics deltas at this larger scale; `mla_rejected_total`/`mla_tokenization_failures_total` must still be unchanged.

---

## 17. Teardown

- [ ] Stop MLA (`Ctrl-C`).
- [ ] Stop `ppa-stub` (`Ctrl-C`) — confirm its process actually exits; it does not always exit cleanly on its own after a run (a known, separately-tracked observation, `bugs/qa-review-findings.md` F-06's note on `scenario:all`).
- [ ] `npm run harness:down` — tears down Redpanda.
- [ ] `POST http://localhost:4001/control/reset` before tearing `ppa-stub` down if it's being reused for another run — clears `received.jsonl` for a clean next pass.

---

## 18. Definition of done

This checklist is **passed** when every box above is checked for one full run with no unexpected skip, no rejection, no alert, and no breaker trip — i.e., the numbers in §15 tell the same clean story the log lines in §6–§14 do. It is **not** a substitute for `npm run scenario:all` (which additionally proves the fault, chaos, and concurrency paths — `plan.md` §10) and does not by itself close any phase or story in `plan.md` §16; record a §16 entry separately if this run is meant to serve as that story's live verification.

**Explicitly out of scope, by design** (edge cases, not the core flow): transfer/FX-quote rejections, duplicate/dropped/corrupt records, out-of-order partition arrival, PPA 4xx/5xx/timeout, retry exhaustion, circuit-breaker trips and recovery, key-store or PII-secret outages, MLA/broker restarts mid-feed, and the `TxSts: "ABOR"` gap (`plan.md` §14 Q3) — all already covered by `tools/scenario-library` or separately tracked, and deliberately not re-tested here.

---

## 19. Additional pass — the real PPA instance

**Confirmed live [2026-09-17]:** `http://10.0.115.186:3000` — `GET /health/ready` → `{"ready":true,"checks":{"writeAheadStore":true}}`; `GET /documentation`/`/documentation/json` serve an OpenAPI 3.0.3 doc titled "PPA Ingress API" listing `POST /QUOTES`, `/FXQUOTES`, `/TRANSFERS`, `/FXTRANSFERS` and the two health routes, with a request schema matching `core-knowledge.md` §5's Event Envelope field-for-field and example payloads using this project's own `test-mwk-dfsp`/`test-zmw-dfsp` ids. This is a genuinely separate, independently-built PPA — not `ppa-stub`, and not tracked in this docs folder (§1 above).

**Not yet confirmed — do not point a real MLA at it before these are answered:**

- [ ] **Does this instance enforce mTLS on the four business endpoints?** Its OpenAPI doc declares no `securitySchemes`, and it was reachable over plain `http://` for `/documentation` and `/health/ready`. `core-knowledge.md` §3.4 requires mTLS on every business call in the target design — confirm with the PPA engineer whether this instance is a deliberately unauthenticated dev build, or whether the business endpoints sit behind mTLS while health/docs don't.
- [ ] **What `PPA_BASE_URL` (and, if mTLS is enforced, what CA/client cert) should MLA actually use?** Do not guess this — `.env.template`'s `PPA_BASE_URL`/`PPA_CLIENT_CERT_PATH`/`PPA_CLIENT_KEY_PATH`/`PPA_CA_CERT_PATH` currently point at the local `ppa-stub`, and pointing them elsewhere without confirming the target first risks delivering genuine (even if test) payment envelopes into someone else's real write-ahead store — persist happens *before* structural validation (`core-knowledge.md` §6.1 step 2), so even a malformed test envelope is written before it can be rejected.
- [ ] **Is this instance meant for MLA integration testing at all**, or is it the PPA engineer's own dev/test deployment not yet intended for cross-team traffic? Confirm before running anything against it, even read-only.

**Once those are answered:** repeat §§6–15 unmodified, substituting the confirmed `PPA_BASE_URL` (and certs, if required) for `ppa-stub`'s — the pipeline stages and their pass criteria do not change; only the delivery target does. The one check that **cannot** be repeated as written is §14 (`tools/ppa-stub/output/received.jsonl` is specific to the stub) — ask the PPA engineer how to independently confirm what their instance actually received and how it classified each envelope, since this checklist has no visibility into their store.

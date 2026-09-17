<!-- SPDX-License-Identifier: Apache-2.0 -->

# End-to-End Happy-Path Test — MLA ↔ PPA <!-- omit in toc -->

**What this is.** The record of the functional happy-path run that proved MLA's *core* job — start to
finish, against a real broker and the **real PPA**, built separately by another engineer and confirmed
live [2026-09-17] at `http://10.0.115.186:3000` — for one clean, unmodified cross-border transaction, no
faults injected. Everything live-verified elsewhere (`plan.md` §16) proves individual mechanisms and
failure paths in isolation; this is the one run that walked the *whole* pipeline in one sitting, in the
order a payment actually moves through it, and answered "does the core flow work?" with a yes.

**What this is not.** Not a fault, retry, breaker, rejection, chaos, load, or multi-instance test —
`tools/scenario-library` already covers those (`environment-simulation.md` §1, `plan.md` §4/§10). Not a
test against `ppa-stub` — by explicit instruction [2026-09-17], the real PPA is the target, and `ppa-stub`
is not used here.

- [1. The run](#1-the-run)
- [2. Definition of done](#2-definition-of-done)
- [3. PPA correctness — definition of done (not yet run)](#3-ppa-correctness--definition-of-done-not-yet-run)

---

## 1. The run

**Confirmed live [2026-09-17]:** `http://10.0.115.186:3000` — `GET /health/ready` → `{"ready":true,"checks":{"writeAheadStore":true}}`; `GET /documentation`/`/documentation/json` serve an OpenAPI 3.0.3 doc titled "PPA Ingress API" listing `POST /QUOTES`, `/FXQUOTES`, `/TRANSFERS`, `/FXTRANSFERS` and the two health routes, with a request schema matching `core-knowledge.md` §5's Event Envelope field-for-field and example payloads using this project's own `test-mwk-dfsp`/`test-zmw-dfsp` ids. This is a genuinely separate, independently-built PPA — not `ppa-stub`, and not tracked in this docs folder (`strategy.md` §1).

**mTLS resolved [2026-09-17], by user instruction, not by confirmation from the PPA side:** the real instance is plain HTTP with no discoverable mTLS port (443/3443/4443/8443/3001/4000 all checked, none listening). Rather than block on the other side standing one up, MLA gained a dev-only bypass — `PPA_MTLS_DISABLED` (`.env.template`, `src/clients/ppa.client.ts`), default `false`, loudly observable (boot-time `WARN` log, `mla_ppa_mtls_bypassed` metric) — mirroring the existing `JWS_VALIDATION_DISABLED` pattern per `CLAUDE.md`'s external-decisions rule. **This is a real, standing security gap while it's on**: MLA↔PPA traffic is unauthenticated and unencrypted for as long as `PPA_MTLS_DISABLED=true`, and nothing in this repo enforces turning it off again — that's an operational discipline, not a mechanism. Full explanation: `learning/MLA/mTLS understanding.md`.

**Config used:**
```
PPA_BASE_URL=http://10.0.115.186:3000
PPA_HEALTH_BASE_URL=http://10.0.115.186:3000
PPA_MTLS_DISABLED=true
```

**Fixture:** `__tests__/fixtures/DRPP_Kafka_E2E_Pack/01_MWK_to_ZMW_PRIMARY/raw_messages.json` — one complete corridor transaction (20 records, 1 partition), touching all four `eventType`s (QUOTE, FXQUOTE, TRANSFER, FXTRANSFER) plus party lookups, no rejection or fault shape mixed in. Re-signed against locally-generated throwaway keypairs (`npm run keys:generate -- test-mwk-dfsp test-zmw-dfsp test-fxp2 hub-region-stg`) — the captured signatures belong to real DFSPs whose private keys aren't held, so an unmodified feed would fail JWS by design.

**Live-verified [2026-09-17]:**

- [x] MLA booted against this config: `/health/ready` → `{"status":"UP","kafka":"UP","piiSecret":"UP","jwsKeyStore":"UP"}`; boot log carried the designed `PPA_MTLS_DISABLED=true` `WARN` line; `mla_ppa_mtls_bypassed{service="cch-mla"} 1`.
- [x] `npm run feeder -- --file __tests__/fixtures/DRPP_Kafka_E2E_Pack/01_MWK_to_ZMW_PRIMARY/raw_messages.json --resign 0-19` — fed 20 records (6 skipped by `--resign` itself as unsignable, the structural egress/party-lookup halves — expected).
- [x] All 8 canonical records forwarded and accepted by the **real PPA** — `mla_forwarded_total`: `FXQUOTE=2`, `QUOTE=2`, `FXTRANSFER=2`, `TRANSFER=2`. `mla_ppa_delivery_outcomes_total{outcome="success"}=8` — no `client-error`, `server-error`, `timeout`, `tls-handshake-failure`, or `network-error` outcomes at all.
- [x] `mla_skipped_total`: `egress=11`, `party-lookup=1`. `11+1+8=20` — every fed record accounted for in exactly one bucket.
- [x] `mla_tokenization_failures_total=0`; `mla_consumer_lag` is `0` on every one of the 12 partitions once the run settled — offsets fully committed, confirming the whole pipeline including the final "commit offset only on HTTP 200" step (`core-knowledge.md` §3.2 step 9).
- [x] MLA's own logs show each of the 8 as `Forwarded <EVENTTYPE> (id=...)` with a distinct `correlationId` per line.

**What this run does and does not prove.** It proves MLA's full pipeline — Kafka consumption, canonical `start`/`egress` selection, event-type classification, base64 decode, genuine JWS verification against locally re-signed fixtures, PII tokenization, schema-valid envelope construction, and delivery — produced 8 correct envelopes and that the real PPA's ingress accepted every one with HTTP 200, advancing MLA's Kafka offset accordingly. It does **not** prove anything about what PPA did after accepting them (translation, correlation, TMS dispatch — `core-knowledge.md` §6.1 steps 3–9): this run has no visibility into PPA's own store or logs. It also does not prove mTLS itself works, since mTLS was bypassed for this run by design — that remains to be tested the day the real PPA (or a gateway in front of it) actually terminates it.

**Left open:** whether `PPA_MTLS_DISABLED=true` stays the working mode going forward, or whether/when the PPA side adds real mTLS, is not this repo's decision. Nothing about PPA's own processing of the 8 delivered envelopes has been confirmed — would need to ask the PPA engineer directly.

---

## 2. Definition of done

**Met [2026-09-17].** MLA's core job — consume from Kafka, select the canonical record, classify it,
decode it where needed, verify the DFSP's signature, tokenize PII, build a schema-valid envelope, deliver
it to PPA, and advance the offset only on HTTP 200 — ran start to finish against the real PPA with no
unexpected skip, no rejection, no alert, and no breaker trip, for every record in the chosen corridor.
This is **not** a substitute for `npm run scenario:all` (which additionally proves the fault, chaos, and
concurrency paths — `plan.md` §10), and it does not by itself close any phase or story in `plan.md` §16 —
recorded separately there (Phase 8 partial, 2026-09-17) as this run's own live verification.

**Explicitly out of scope, by design** (edge cases, not the core flow): transfer/FX-quote rejections, duplicate/dropped/corrupt records, out-of-order partition arrival, PPA 4xx/5xx/timeout, retry exhaustion, circuit-breaker trips and recovery, key-store or PII-secret outages, MLA/broker restarts mid-feed, and the `TxSts: "ABOR"` gap (`plan.md` §14 Q3) — all already covered by `tools/scenario-library` or separately tracked, and deliberately not tested here.

---

## 3. PPA correctness — definition of done (not yet run)

**§1 tested MLA's job, not PPA's.** An HTTP 200 from PPA's ingress only means "durably persisted, per `core-knowledge.md` §6.1 step 2" — persist happens **before** structural validation, so it says nothing about steps 3–9 (validation, idempotency, correlation, translation, TMS dispatch) actually running correctly. This section is what "PPA's own job is correct" would mean, broken into checkable pieces against PPA's documented nine-step pipeline (`core-knowledge.md` §6), the ISO 20022 translation reference (§7), and the correlation/durability model (§8).

**Updated [2026-09-17]: PPA's source is now available locally**, at `/home/abdul-rahim/mojaloop/cch-ppa` — this changes what's checkable, so re-read before assuming the older "zero visibility" framing still applies. Critically, `cch-ppa`'s own `docker-compose.yml` stands up a **complete, self-contained local stack**: the PPA process itself, Postgres (its write-ahead store), and ValKey (its correlation cache) — with mTLS certs and a separate operator/DLQ-replay port already wired. This is genuinely separate infrastructure from the mystery remote instance at `10.0.115.186:3000` (not yet confirmed to be the same deployment), and it means most of the checks below no longer require anyone else's cooperation at all — they require *standing the stack up and looking*, which is work this session can do directly. Every item is marked with what it actually takes:
- **[MLA-side]** — triggerable and observable purely by feeding MLA specific input and reading PPA's HTTP response or MLA's own metrics.
- **[code-level]** — answerable by reading `cch-ppa`'s own source directly against the spec below. Proves the *implementation exists and matches intent*, not that a specific run behaved correctly — static, not live.
- **[local-stack]** — requires standing up `cch-ppa`'s own `docker-compose.yml` and inspecting Postgres/ValKey/the DLQ directly, or deliberately faulting a dependency — fully within this session's control, not yet done as of this entry.
- **[remote-instance]** — about the *specific* already-completed §1 run against the deployed instance at `10.0.115.186:3000` — that data lives only there; a local stack proves the mechanism works, not what that one remote instance actually did with those 8 envelopes.
- **[Tazama]** — checkable independently only if the target Tazama instance (local `docker-compose.yml`'s TMS pointer, or the already-running local `tazama-tms-1` stack) is confirmed to be what either PPA instance actually dispatches to — not yet confirmed for either.

### 3.1 Reachability gate & durable persist (steps 1–2)

- [ ] **[remote-instance]** Each of the 8 envelopes from §1's run is actually present in the deployed PPA's write-ahead store, byte-for-byte — an HTTP 200 alone only proves PPA *claimed* to persist it.
- [ ] **[local-stack]** With `cch-ppa`'s own ValKey or Postgres container stopped, a POST returns `503`, nothing persisted, nothing acknowledged (`core-knowledge.md` §6.1 step 1) — directly testable now by stopping a container in the local compose stack and re-running §1's feed against it instead of the remote instance.

### 3.2 Structural validation (step 3)

- [ ] **[code-level]** Confirm the implementation actually validates `msgType`/`eventType`/`id`/`fspiop-source`/`body` and routes a failure to the DLQ with a masked log, per §6.1 step 3 — read `src/services` for the validation step and where its failure path leads.
- [ ] **[local-stack]** POST a deliberately malformed envelope (missing `id`, or an `eventType` outside the four valid values) at the local stack — confirm it still returns `200` (persist precedes validation) but lands in Postgres as a DLQ entry, not silently treated as valid.

### 3.3 Idempotency (step 4)

- [ ] **[code-level]** Confirm the idempotency check is a genuine atomic check-and-set against the write-ahead store (Postgres), keyed on `{id}:{isoMessageType}`, not a read-then-write — `git log` already shows a dedicated commit for this (`39c853c feat: classification setup and idempotency`).
- [ ] **[local-stack]** Re-feed the identical corridor a second time at the local stack and confirm, directly in Postgres, that the second delivery of each `{id}:{isoMessageType}` pair was recognized as a duplicate and produced no second translation or TMS dispatch.

### 3.4 Trigger/cache classification & correlation accumulation (steps 5–6, §8.1)

- [ ] **[code-level]** Confirm the trigger/cache table (`core-knowledge.md` §6.5) is implemented as two independent properties, not conflated — the review finding this design avoids (R-01) is specifically about a component that fires a trigger *without* also caching, or vice versa.
- [ ] **[local-stack]** After feeding the corridor, confirm directly in ValKey (`valkey-cli`, or the local compose's own port 6379) that the FXQUOTE/FXTRANSFER legs were written into the correlation cache (keyed by `conversionRequestId`/`commitRequestId`).
- [ ] **[local-stack / Tazama]** Confirm the resulting pacs.008 carries the cached FX enrichment (`InstdAmt`/`XchgRate`, §7.3's "From cached FX Quote" row) — needs the local stack's own TMS target confirmed and reachable.

### 3.5 Domestic vs. cross-border discriminator (step 7, §6.6)

- [ ] **[code-level]** Confirm the discriminator logic exists and matches §6.6 exactly: domestic ⟺ no FX-quote state cached **and** no `determiningTransferId` in the body ⇒ silently discarded (counter only, no DLQ, no alert) — `git log` shows a dedicated commit (`0402046 feat: determining domestic and cross-border implementation`).
- [ ] **[local-stack]** §1's corridor was cross-border throughout — the domestic path has never been exercised. Feed a TRANSFER-only corridor with no FXQUOTE/FXTRANSFER legs at the local stack, and confirm directly (metrics/logs) that it was silently discarded — no TMS message, no DLQ entry, no alert, only a counter incrementing.
- [ ] **[local-stack]** The race case — `determiningTransferId` present but FX-quote state not yet cached — still classifies as cross-border and still emits a (degraded) pacs.008. Needs a deliberately timed feed (FX quote delayed past the transfer prepare).

### 3.6 ISO 20022 translation correctness (§7.1–§7.4)

- [ ] **[code-level]** Read the actual field-mapping implementation (`0177939 feat: All the translation stories`) against the reference tables — in particular the two failure modes that produce **no error anywhere** downstream, so they must be checked positively in the code, not assumed correct:
  - `GrpHdr.MsgId` on every message is a PPA-generated ULID, pinned at first assembly — never copied from any wire `extensionList` key.
  - pacs.002's `OrgnlInstrId`/`OrgnlEndToEndId` are resolved from the cached `transferId → {InstrId, EndToEndId}` mapping, never assumed equal to `transactionId`.
  - `TxSts` is translated through an explicit table (`COMMITTED`→`ACSC`, not `ACCC`), not passed through as a raw string.
  - Payee `Cdtr.BirthDt`/`CityOfBirth`/`CtryOfBirth` are set to the documented sentinels (`1900-01-01`/`"Unknown"`/`"ZZ"`), not left blank or fabricated.
  - Agent identifiers use `FinInstnId.ClrSysMmbId.MmbId`, not the Mojaloop wire's own `FinInstnId.Othr.Id`.
- [ ] **[local-stack / Tazama]** For a run against the local stack, confirm the messages a reachable Tazama instance actually received match the above — proves the code runs correctly, not just reads correctly.

### 3.7 Local schema validation & the pacs.008 completeness check (§7.5)

- [ ] **[code-level]** Confirm pinned local ajv schemas exist for all four message types and are validated with `removeAdditional: 'all'` before dispatch (`55b5c8c feat: ppa-13 validation through ajv`, `0786808 feat: added ajv validation to verify tms schema compatability`), and that the pacs.008 field-completeness check (`EndToEndId`, `Dbtr`, `Cdtr`, `DbtrAcct`, `CdtrAcct`) exists as a check distinct from schema shape validation.
- [ ] **[local-stack]** Feed a case that would produce an incomplete pacs.008 and confirm it fails closed (DLQ, never sent to TMS) rather than dispatching.

### 3.8 Dispatch to TMS (§7.6)

- [ ] **[local-stack / Tazama, if target confirmed]** Exactly **four** Tazama messages ingested for one transaction — one each of `pain.001.001.11`, `pain.013.001.09`, `pacs.008.001.10`, `pacs.002.001.12` — matching `strategy.md` §1's "one cross-border payment produces exactly four Tazama messages" claim. Confirm what Tazama target the local stack's `.env` actually points at first (the already-running local `tazama-tms-1` stack is one candidate, per `docker ps` — not yet confirmed to be it).
- [ ] **[code-level]** Confirm every PPA→TMS call is built with mutual TLS and a Keycloak-issued bearer token, and that the token is refreshed proactively before expiry, not reactively.
- [ ] **[local-stack]** A simulated TMS 5xx/timeout produces retry-with-jitter (×3) before DLQ; a simulated 4xx DLQs immediately with no retry.

### 3.9 Correlation TTL, parking, and out-of-order arrival (§8.2–§8.4)

- [ ] **[code-level]** Confirm a parking mechanism exists that writes accumulated leg state to the DLQ before ValKey's TTL lapses (`9651f02 feat: parking and out of order with fixes and review`).
- [ ] **[local-stack]** A leg parked before its ValKey TTL lapses (pacs.008 sent, pacs.002 not yet) is correctly recovered from the DLQ when the delayed fulfil finally arrives — needs a deliberately-delayed corridor feed against the local stack, with ValKey's TTL shortened for the test or the feed delayed past it.
- [ ] **[local-stack]** A pacs.002 trigger arriving before any correlation state exists (fulfil-before-prepare) is held and retried within PPA's bounded window rather than dead-lettered immediately, and resolves once the prepare's pacs.008 lands.

### 3.10 The DLQ (§8.5)

- [ ] **[code-level]** Confirm a DLQ replay mechanism exists and is operator-triggered only, never automatic (`5be6c77 feat: dlq replay (unreviewed)` — flagged in its own commit message as unreviewed, worth a closer read before trusting it).
- [ ] **[local-stack]** A genuine DLQ entry (from any of the checks above) carries PII already in tokenized form, never raw, inspected directly in Postgres.

### Definition of done for this section

**Not met, but now genuinely achievable from this session alone — no longer blocked on the PPA engineer for most of it.** The recommended next step is standing up `cch-ppa`'s own `docker-compose.yml` locally and re-running §1's corridor against it, then working through §§3.1–3.10 directly against Postgres/ValKey/the DLQ. What stays out of reach even then: confirming what the *specific already-completed* §1 run did on the *remote* `10.0.115.186:3000` instance (marked `[remote-instance]` above), and where the real deployed instance's own TMS target actually points — both still need the PPA engineer or further discovery, not a code read.

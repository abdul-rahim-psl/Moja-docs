<!-- SPDX-License-Identifier: Apache-2.0 -->

# Standing Up MLA and PPA Locally <!-- omit in toc -->

**Why this exists.** E2E work against the two deployed machines — MLA's Paysys-side test
deployment at `10.0.150.69` and the real PPA at `10.0.115.186:3000` — is blocked: there is no
network path between them (`plan.md` §13.1, `e2e-testing/checklist.md`), and that gap sits with
whoever manages routing between the two segments, not with engineering. Rather than wait on it,
the plan is to run both services on this machine, talking to each other over `localhost`, and
continue the E2E work there. This document is the steps to do that — not a record of a run yet.

**What this is not.** Not a replacement for the real cross-machine test once connectivity is
restored — a local run proves the mechanism, not the actual deployed instances talking to each
other. `e2e-testing/checklist.md` §1 already proved the MLA→PPA mechanism once, against the real
PPA over the network; this is the same mechanism, run entirely on one machine because the network
path that made that possible is currently down.

- [1. What already exists](#1-what-already-exists)
- [2. Checklist](#2-checklist)
- [3. Standing up PPA](#3-standing-up-ppa)
- [4. Standing up MLA](#4-standing-up-mla)
- [5. Feeding a corridor through both](#5-feeding-a-corridor-through-both)
- [6. Open items and scoping decisions](#6-open-items-and-scoping-decisions)

---

## 1. What already exists

Neither stack needs to be built — both already have everything required, just not run together
before:

- **`cch-mla`** has its own complete local harness (`environment-simulation.md`): a
  `docker-compose.dev.yml` Redpanda broker standing in for COMESA's Kafka, a `capture-feeder` tool
  that replays a real DRPP capture file onto it preserving partition/order, key- and
  secret-generation scripts, and a `ppa-stub` test double it normally points at. None of that
  changes here — only what MLA's `PPA_BASE_URL` points at changes, from `ppa-stub` (or the remote
  real PPA) to a **locally-run real PPA**.
- **`cch-ppa`** (`/home/abdul-rahim/mojaloop/cch-ppa`) has its own `docker-compose.yml` standing up
  a complete, self-contained stack — the PPA process, Postgres (its write-ahead store), and ValKey
  (its correlation cache) — confirmed present but **not yet stood up** as of this writing
  (`strategy.md` §1, `e2e-testing/checklist.md` §3).

Running both together, on `localhost`, is the only new step — the two stacks were built
independently and have not previously been pointed at each other.

---

## 2. Checklist

The concrete, ordered steps — §§3–5 below give the reasoning behind each one; this is the
one to actually work from and check off. None of it is done yet.

**PPA (`cch-ppa`)**

- [ ] `cp .env.template .env`
- [ ] In `.env`, set `DOCS_INSECURE_HTTP=true` (`NODE_ENV` already defaults to `dev`)
- [ ] `docker compose up -d`
- [ ] `docker compose ps` — `ppa`, `postgres`, `valkey` all `Up`/`healthy`
- [ ] `curl http://localhost:3000/health/ready` → `{"ready":true,...}`

**MLA (`cch-mla`)**

- [ ] `npm run harness:up`
- [ ] `npm run keys:generate -- test-mwk-dfsp test-zmw-dfsp test-fxp2 hub-region-stg`
- [ ] `npm run pii-secret:generate`
- [ ] `cp .env.template .env`, then set:
  ```
  PPA_BASE_URL=http://localhost:3000
  PPA_HEALTH_BASE_URL=http://localhost:3000
  PPA_MTLS_DISABLED=true
  KAFKA_ENABLED=true
  KAFKA_BROKERS=localhost:19092
  ```
- [ ] `npm run dev`
- [ ] `curl http://localhost:3001/health/ready` → `kafka`, `piiSecret`, `jwsKeyStore` all `UP`
- [ ] Boot log shows the `PPA_MTLS_DISABLED=true` `WARN` line (confirms the bypass is actually
      active, not silently ignored)

**Feed and verify**

- [ ] `npm run feeder -- --file __tests__/fixtures/DRPP_Kafka_E2E_Pack/01_MWK_to_ZMW_PRIMARY/raw_messages.json --resign 0-19`
- [ ] `mla_forwarded_total` = 2 each of `QUOTE`/`FXQUOTE`/`TRANSFER`/`FXTRANSFER` (8 total)
- [ ] `mla_ppa_delivery_outcomes_total{outcome="success"}` = 8, no `client-error`/`server-error`/
      `timeout`/`tls-handshake-failure`/`network-error`
- [ ] `mla_skipped_total` (`egress` + `party-lookup`) + 8 forwarded = 20 (every fed record
      accounted for)
- [ ] `mla_tokenization_failures_total` = 0
- [ ] `mla_consumer_lag` = 0 on every partition once the run settles
- [ ] MLA's logs show each of the 8 as `Forwarded <EVENTTYPE> (id=...)` with a distinct
      `correlationId`

**Now checkable for the first time — PPA's own store (`e2e-testing/checklist.md` §3.1–§3.4,
previously `[local-stack]`/blocked)**

- [ ] `docker compose exec postgres psql -U ppa -d ppa -c "select id, msg_type, status from write_ahead;"`
      — all 8 envelopes present, `status` reflecting each one's actual pipeline outcome
- [ ] `docker compose exec valkey valkey-cli keys '*'` — FXQUOTE/FXTRANSFER correlation state
      present, keyed by `conversionRequestId`/`commitRequestId`

---

## 3. Standing up PPA

Work from `/home/abdul-rahim/mojaloop/cch-ppa`.

1. **Create `.env` from `.env.template`.** The template's defaults already assume a fully local
   stack (`PG_HOST=localhost`, `CACHE_HOST=localhost`, `TMS_BASE_URL=http://localhost:3000`).
2. **Set `DOCS_INSECURE_HTTP=true` with `NODE_ENV=dev`.** This is the load-bearing decision for a
   quick local up: PPA's ingress (the four `/QUOTES`/`/FXQUOTES`/`/TRANSFERS`/`/FXTRANSFERS`
   endpoints plus health) then serves plain HTTP with **no mTLS at all**
   (`src/clients/fastify.ts`'s `initializeFastifyClient`) — mirroring the same dev-only bypass
   already used against the real remote PPA (`PPA_MTLS_DISABLED` on MLA's side,
   `e2e-testing/checklist.md` §1). This means **no certificates need to be generated** for the
   MLA↔PPA hop specifically. `docs_insecure_http` is rejected outright unless `NODE_ENV=dev`
   (`src/config.ts`), so it cannot leak into a non-dev config by accident.
3. **`docker compose up -d`** from `cch-ppa/`. This brings up Postgres and ValKey (both with
   healthchecks the `ppa` service depends on) and the PPA process itself, listening on `PORT`
   (default `3000`) and the metrics port (`9464`).
4. **Confirm it's up:** `curl http://localhost:3000/health/ready` should return
   `{"ready":true,...}` once Postgres/ValKey report healthy — the same shape
   `e2e-testing/checklist.md` §1 checked against the remote instance.

**What this does *not* stand up:** the operator-replay listener (port `3010`,
`OPERATOR_MTLS_CERT_PATH` etc.) is a **separate** Fastify instance
(`src/clients/operator.ts`) that reads its mTLS cert files unconditionally — `DOCS_INSECURE_HTTP`
only gates the main ingress listener, not this one. `cch-ppa` has no cert-generation script of its
own for this. See §6.

---

## 4. Standing up MLA

Work from `/home/abdul-rahim/mojaloop/cch-mla`.

1. **`npm run harness:up`** — brings up the Redpanda broker and creates `topic-event-audit` at 12
   partitions (`docker-compose.dev.yml`).
2. **`npm run keys:generate -- test-mwk-dfsp test-zmw-dfsp test-fxp2 hub-region-stg`** (or whichever
   DFSP ids the chosen fixture uses) — throwaway JWS keypairs, needed because the captured
   signatures in any real fixture belong to real DFSPs whose private keys aren't held, so an
   unmodified feed fails JWS verification by design. `capture-feeder --resign` re-signs against
   these.
3. **`npm run pii-secret:generate`** — the local PII tokenization secret.
4. **Configure `.env`** (from `.env.template`), the one deviation from that template's own
   defaults being the PPA target:
   ```
   PPA_BASE_URL=http://localhost:3000
   PPA_HEALTH_BASE_URL=http://localhost:3000
   PPA_MTLS_DISABLED=true
   KAFKA_ENABLED=true
   KAFKA_BROKERS=localhost:19092
   ```
   `PPA_MTLS_DISABLED=true` pairs with PPA's own `DOCS_INSECURE_HTTP=true` from §2 — both sides
   agreeing to speak plain HTTP for this local run, the same pairing already live-verified against
   the real remote PPA on [2026-09-17].
5. **`npm run dev`** (or `npm run build && npm start`) to boot MLA. Confirm
   `curl http://localhost:3001/health/ready` shows `kafka: UP` and the other checks green before
   feeding anything.

---

## 5. Feeding a corridor through both

Once both are up, this is the same run `e2e-testing/checklist.md` §1 already did against the real
remote PPA — just against `localhost` instead of `10.0.115.186:3000`:

```
npm run feeder -- --file __tests__/fixtures/DRPP_Kafka_E2E_Pack/01_MWK_to_ZMW_PRIMARY/raw_messages.json --resign 0-19
```

Confirm on MLA's side exactly as before — `mla_forwarded_total` by event type,
`mla_ppa_delivery_outcomes_total{outcome="success"}`, `mla_skipped_total` accounting for every fed
record, `mla_tokenization_failures_total=0`, consumer lag returning to `0`. The new part this local
setup unlocks over the [2026-09-17] run: PPA's own Postgres and ValKey are now directly inspectable
(`psql`/`valkey-cli` against the compose stack's exposed ports), which is exactly what
`e2e-testing/checklist.md` §3 marks `[local-stack]` and lists as not yet done.

---

## 6. Open items and scoping decisions

These surfaced while working out the steps above — flagged rather than resolved quietly, per
`CLAUDE.md`'s external-decisions rule, even though none of them blocks the local up itself:

- **Operator-replay port (3010) needs mTLS certs that `cch-ppa` has no script to generate.**
  `cch-mla/tools/ppa-stub/scripts/generate-certs.sh` is the only cert-generation script anywhere in
  this workspace, and it generates a server/client pair for `ppa-stub`, not PPA's operator listener
  specifically (which additionally wants an `operator-client-ca.crt`, distinct from the
  MLA-ingress CA). Not needed for the core MLA↔PPA corridor test in §5 — only for exercising
  `e2e-testing/checklist.md` §3.10 (the DLQ replay path). Left open until that section is actually
  worked.
- **TMS dispatch is not automatically part of "PPA is up."** `cch-ppa`'s `TMS_BASE_URL` defaults to
  `http://localhost:3000` in the checked-in template (a stale/self-referential placeholder —
  that's PPA's own port), and needs pointing at the real local Tazama stack's TMS ingress
  instead — `tazama-tms-1` is already running on this machine (`0.0.0.0:5000->3000/tcp`), so
  `TMS_BASE_URL=http://localhost:5000` is the actual local target. More significantly, **PPA's
  bearer-token auth chain (`TMS_AUTH_LOGIN_URL`, `auth.service.ts`) depends on a Tazama
  `auth-service`/Keycloak instance that is not currently running** among the local `tazama-*`
  containers (`docker ps` shows `tazama-tms-1`, `tazama-admin-service-1`, and the rule processors,
  but no auth/Keycloak service). Standing that up is separate follow-on work, not covered by this
  document — until it exists, PPA will authenticate-fail on any TMS dispatch attempt even though
  ingress and persistence work fine.
- **This document covers MLA↔PPA only, by design.** `e2e-testing/checklist.md` §3's own items
  8–10 (TMS dispatch, correlation TTL/parking, the DLQ) need the auth-service gap above closed
  first — sequencing that as a second document once this one is actually run and confirmed, rather
  than folding an unstood-up dependency into the first local-up pass.

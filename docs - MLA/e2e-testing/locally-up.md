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
one to actually work from and check off. **PPA is done and live-verified [2026-09-21]; MLA and
the feed are not yet started.** Per `CLAUDE.md`'s mid-story rule, boxes below are checked as work
actually happens, each annotated with its real state — not held back to the end.

**PPA (`cch-ppa`) — done, live-verified [2026-09-21]**

- [x] `cp .env.template .env` — done; `DOCS_INSECURE_HTTP=true` was already the template's own
      default, no edit needed
- [x] In `.env`, confirm `DOCS_INSECURE_HTTP=true` (`NODE_ENV` already defaults to `dev`) — confirmed
      present, unedited
- [x] **Generate dev mTLS certs into `cch-ppa/certs/` before bringing the stack up** — a step this
      checklist originally omitted; turned out to be required. See §3 and §6.1 for why and exactly
      what was generated.
- [x] `docker compose up -d` — done; required one intermediate fix (certs directory ownership, §6.1)
      before the `ppa` container would start cleanly
- [x] `docker compose ps` — `ppa`, `postgres`, `valkey` all `Up`/`healthy`, confirmed via
      `docker ps -a` (`cch-ppa-ppa-1 Up`, `cch-ppa-postgres-1 Up ... (healthy)`,
      `cch-ppa-valkey-1 Up ... (healthy)`)
- [x] `curl http://localhost:3000/health/ready` → live output: `{"ready":true,"checks":{"writeAheadStore":true}}`
      — matches the shape confirmed against the remote instance on 2026-09-17

**MLA (`cch-mla`) — not yet started****

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

**Corrected [2026-09-21] after actually running this**: an earlier version of this section claimed
no certificates were needed at all. That is wrong — see step 2 below and §6.1. `DOCS_INSECURE_HTTP`
only removes mTLS from the *ingress* listener; PPA will not boot at all without a cert set present,
because a second listener reads cert files unconditionally regardless of that flag.

1. **Create `.env` from `.env.template`.** The template's defaults already assume a fully local
   stack (`PG_HOST=localhost`, `CACHE_HOST=localhost`, `TMS_BASE_URL=http://localhost:3000`).
   `DOCS_INSECURE_HTTP=true` is already the template's own default.
2. **Generate a dev mTLS cert set into `cch-ppa/certs/` — required, not optional.** `runServer`
   (`src/index.ts`) starts the operator-replay listener (`initializeOperatorServer`,
   `src/clients/operator.ts`) *before* the main ingress listener, and it reads
   `OPERATOR_MTLS_CERT_PATH`/`KEY_PATH`/`CA_PATH` unconditionally — `DOCS_INSECURE_HTTP` only gates
   `initializeFastifyClient`'s ingress listener, not this one. With no `certs/` directory at all,
   PPA crash-loops on boot (`ENOENT ... ppa-operator-server.crt`) before the ingress ever starts,
   regardless of `DOCS_INSECURE_HTTP`. `cch-ppa` ships no cert-generation script of its own
   (`cch-mla/tools/ppa-stub/scripts/generate-certs.sh` is the only one anywhere in this workspace,
   and it targets `ppa-stub`'s own file layout, not PPA's). A throwaway self-signed set was
   generated for this run — CA, server/client pair (`server.crt/key`, `client.crt/key`, reused for
   `TMS_MTLS_*` per the template's own comment), and a **separate** operator CA/server/client set
   (`operator-client-ca.crt/key`, `ppa-operator-server.crt/key`, `operator-client.crt/key`) —
   matching every path `.env.template` defaults to. Dev-only, `cch-ppa/.gitignore` already excludes
   `certs/`, never committed.
3. **`docker compose up -d`** from `cch-ppa/`. This brings up Postgres and ValKey (both with
   healthchecks the `ppa` service depends on) and the PPA process itself, listening on `PORT`
   (default `3000`) and the metrics port (`9464`).
4. **Confirm it's up:** `curl http://localhost:3000/health/ready` should return
   `{"ready":true,...}` once Postgres/ValKey report healthy — the same shape
   `e2e-testing/checklist.md` §1 checked against the remote instance.

**Live-verified [2026-09-21]**: `docker ps -a` showed `cch-ppa-ppa-1 Up`,
`cch-ppa-postgres-1 Up ... (healthy)`, `cch-ppa-valkey-1 Up ... (healthy)`; boot logs carried
`Operator server listening on 0.0.0.0:3010`, `Metrics server listening on 0.0.0.0:9464`, the
designed `DOCS_INSECURE_HTTP is set - serving plain HTTP with NO mTLS on any route. Dev only.`
WARN, and `Fastify listening on 0.0.0.0:3000`; `curl http://localhost:3000/health/ready` returned
`{"ready":true,"checks":{"writeAheadStore":true}}`.

**What this does *not* stand up:** DLQ replay testing itself (`e2e-testing/checklist.md` §3.10) —
the operator listener is up and reachable, but nothing has exercised `POST /dlq/:id/:msgType/replay`
yet with the generated `operator-client.crt/key`. That's separate follow-on work, not blocked by
anything above.

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

### 6.1 What actually broke standing PPA up, and how it was fixed [2026-09-21]

Three real problems, found and fixed in sequence — recorded here rather than silently smoothed
over, since each is a genuine correction to what this document originally assumed:

1. **PPA crash-loops on boot with no `certs/` directory at all**, regardless of
   `DOCS_INSECURE_HTTP`. `ENOENT: no such file or directory, open '/home/app/certs/ppa-operator-server.crt'`
   — the operator-replay listener (`initializeOperatorServer`) reads its cert files unconditionally,
   and `runServer` starts it before the ingress listener that `DOCS_INSECURE_HTTP` actually gates.
   This is the correction folded into §3 above: certs are required for *any* local PPA boot, not
   just for mTLS-authenticated ingress traffic.
2. **`docker compose up` had silently auto-created `cch-ppa/certs/` owned by `root:root`** (mode
   `755`), from an earlier attempt where the container tried to bind-mount a path that didn't yet
   exist on the host — Docker creates the missing host-side directory itself, as `root`, before the
   container's own user namespace applies. This blocked writing certs into it as a normal user
   (`Permission denied`) until fixed with `sudo chown` back to the invoking user. Worth knowing
   before assuming a `certs/`-style bind-mount directory is safe to write into without checking
   its owner first.
3. **Generated `.key` files defaulted to mode `600`** (owner-only), unreadable by the container's
   process, which runs as the distroless base image's `nonroot` user (`Dockerfile`'s
   `USER nonroot`, not the host UID) — `EACCES: permission denied, open '/home/app/certs/ppa-operator-server.key'`.
   Fixed with `chmod 644` on the generated key files. Acceptable for throwaway local dev certs;
   would not be an acceptable practice for anything resembling a real key.

None of these three needed a code change in `cch-ppa` itself — all three were local-environment
setup gaps this document now accounts for.

### 6.2 Remaining open items

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

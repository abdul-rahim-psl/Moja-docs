# CCHFRMS-38 Plan: Ingest Mojaloop Transfer Messages Into Tazama (pacs.008 / pacs.002)

## Starting point

This builds directly on the CCHFRMS-33 prototype (`../../../ppa-prototype/`), which
already:

- Connects to Kafka (`kafkajs`) under a dedicated consumer group (`ppa-prototype`),
  never reusing a live service's group.
- Subscribes to `topic-transfer-prepare` and `topic-transfer-fulfil` (among others)
  and confirms both exist and carry real traffic (`docs/Kafka/kafka-topics-quote-transfer.md`).
- Already base64-decodes `content.payload` on both topics into `content.payloadDecoded`
  (see `src/parsers/payload.js`), which is CCHFRMS-38's "decode transfer payloads from
  Base64" acceptance criterion — **already done**, not new work.
- Has live sample captures for both topics in `captured/topic-transfer-prepare.sample.json`
  and `captured/topic-transfer-fulfil.sample.json`, which is what the field-mapping work
  below is based on.

So CCHFRMS-38 is *not* starting from zero — it's adding a new sink (Tazama's TMS
ingestion API) downstream of the consumer that already works, plus the
FSPIOP→ISO20022 transform in between.

## Target: Tazama TMS ingestion contract (verified from local checkout)

Read directly from `~/tazama/tms-service/src/API_SPEC.md` and `README.md`
(`tazama-lf/tms-service`, run via `~/tazama/Full-Stack-Docker-Tazama`):

- `POST /v1/evaluate/iso20022/pacs.008.001.10` — always active (not gated by `QUOTING`).
  Body: `{ "FIToFICstmrCdtTrf": { ... } }`. Writes a Redis `DataCache` keyed
  `${TenantId}:${EndToEndId}` (from `CdtTrfTxInf.PmtId.EndToEndId`), TTL =
  `DISTRIBUTED_CACHETTL` (default 300s).
- `POST /v1/evaluate/iso20022/pacs.002.001.12` — always active. Body:
  `{ "FIToFIPmtSts": { ... } }`. Looks up that same `DataCache` via
  `TxInfAndSts.OrgnlEndToEndId`, which **must equal** the pacs.008's `EndToEndId`
  for the same transfer, or it falls back to rebuilding from Postgres.
- No `TenantId` in the request body — schema explicitly forbids it
  (`"not": {"required": ["TenantId"]}`); server resolves it (defaults to
  `DEFAULT` when `AUTHENTICATED=false`).
- Response `200`: `{ "message": "Transaction is valid", "data": {...} }`. `400` on AJV
  schema validation failure — this is our main ingestion-failure signal to watch for.
- Local default port `3000` (`TMS_PORT=5000` is what `Full-Stack-Docker-Tazama/.env`
  maps to the host — confirm which one the prototype should target once the stack is up).

## Environment verification log (steps 1–3, completed)

Both stacks are up locally and verified working as of this pass:

**Tazama** (`~/tazama/Full-Stack-Docker-Tazama`, "Full-service (DockerHub)" compose
combination — `docker-compose.base.infrastructure.yaml` + `.base.override.yaml` +
`.full.cfg.yaml` + `.hub.core.yaml` + `.full.rules.yaml`, project `tazama`):

- `GET http://localhost:5000/health` → `200 {"status":"UP"}` — **TMS is healthy**, this
  is the actual CCHFRMS-38 ingestion target.
- All ~35 rule processors and `ed` (event-director) came up healthy.
- **Found and fixed a real env bug**: `EVENT_HISTORY_DATABASE_PASSWORD` was blank in
  `env/tms.env`, `env/admin.env`, `env/batch-ppa.env`, `env/rule-executer.env`, while
  Postgres's actual password (`POSTGRES_PASSWORD`) is `unused` — the same value already
  used correctly for `RAW_HISTORY_DATABASE_PASSWORD`/`CONFIGURATION_DATABASE_PASSWORD` in
  those same files. This caused a SASL auth failure and crash-looped every service that
  touches `EventHistoryDB` (including `tms` itself). Fixed by setting
  `EVENT_HISTORY_DATABASE_PASSWORD=unused` in all four files to match. This is a local
  checkout edit, not upstream — worth upstreaming as a fix to `Full-Stack-Docker-Tazama`
  if it reproduces on a fresh clone.
- **`tp`/`tadp`/`admin-service` — root-caused and fixed** (follow-up pass, all three
  now `Up` and healthy, verified via `GET /health` where applicable):
  - **`tp`/`tadp`** crash-looped on `error: column "active" does not exist` when
    querying `network_map`. Root-caused via the actual upstream source (not the
    possibly-stale local `~/tazama/frms-coe-lib` clone — fetched fresh from
    `tazama-lf/frms-coe-lib` on GitHub at both `main` and `dev` via `gh api`):
    `main`'s `configurationBuilder.ts` uses the correct query
    (`WHERE configuration->'active' = $1`, a jsonb path lookup), but `dev` — which is
    what `TAZAMA_VERSION=rc` images are built from — still has the old, buggy query
    (`WHERE active = $1`, referencing a bare column that was never generated in
    `network_map`, unlike every sibling jsonb-config table in
    `postgres/migration/base/00-CREATE.sql` which all generate their queried columns).
    This is an unreleased/unbackported upstream fix on `frms-coe-lib`'s `dev` branch.
    Local remedy: added a generated `active boolean` column to `network_map` (matching
    the existing pattern for `tenantId` etc. in the same table) — both in
    `00-CREATE.sql` (for future clean deploys) and live via `ALTER TABLE` against the
    already-initialized Postgres (`docker-entrypoint-initdb.d` scripts only run once,
    so the live DB needed the same change applied by hand). Confirmed via direct
    `psql -h localhost -p 15432` — Postgres's admin port is host-mapped, so this
    doesn't require `docker exec` (which is unreliable in this sandbox — see note
    below). Restarted both containers; both now connect to NATS cleanly with no
    further errors.
  - **`admin-service`** crash-looped on `Environment variable RAW_HISTORY_DATABASE_HOST
    is not defined`. Root-caused via `admin-service`'s own `dev`-branch `src/index.ts`
    and `.env.template` (fetched fresh via `gh api`, not the local clone): its
    `dbInit()` requires five databases —
    `EVENT_HISTORY, CONFIGURATION, EVALUATION, RAW_HISTORY, SIMULATION` — but
    `env/admin.env` was missing the entire `RAW_HISTORY_DATABASE_*` **and**
    `SIMULATION_DATABASE_*` blocks, and `Full-Stack-Docker-Tazama`'s base schema
    never creates a `simulation` database at all. `SIMULATION_DATABASE` backs an
    unreleased "Simulation Studio" feature (~10 repository files in `admin-service`
    referencing tables like `trs_simulation_suites`, `trs_simulation_runs`) with no
    DDL published anywhere upstream (confirmed via GitHub code search) — reverse-
    engineering the full table schema was out of scope for this pass. Applied the
    **minimal stub fix** (your call, given the scope): added the missing env blocks to
    `admin.env`, and added an empty `create database simulation;` to `00-CREATE.sql`
    (+ live `CREATE DATABASE` against the running Postgres). This is enough for
    `dbInit()`'s connectivity check to pass — `admin-service` now reports
    `SimulationDB: 'Ok'` and serves `GET /health` → `200`. **Not fixed**: the actual
    Simulation Studio endpoints will still error if invoked, since none of their
    tables exist. Not needed for CCHFRMS-38's ingestion scope; flag if a future story
    needs that feature.
  - **Debugging note for next time**: `docker exec` into these containers consistently
    failed silently in this sandbox (exit 1, no stderr) regardless of container health,
    and `docker cp`/`docker export` failed the same way even against a throwaway
    `alpine` container — this looks like a sandbox-level restriction on those docker
    subcommands, not a container-specific problem. Postgres's admin port
    (`localhost:15432`, per `Full-Stack-Docker-Tazama`'s README) plus a host-installed
    `psql` client worked reliably instead. For source-level debugging, `gh api
    repos/<org>/<repo>/contents/<path>?ref=<branch>` against the actual pinned branch
    (checked in `.env`, e.g. `TP_BRANCH`/`TADP_BRANCH`/`ADMIN_BRANCH=dev`) is more
    trustworthy than any local `~/tazama/*` clone, which may be on a different branch
    or ahead/behind what the running Docker images were actually built from.

**Mojaloop** (`ml-core-test-harness`, `docker compose --profile all-services --profile
ttk-provisioning-gp --profile ttk-tests-gp up -d`):

- All services came up healthy on first attempt, no fixes needed (`kafka`, `central-ledger`,
  `ml-api-adapter`, `quoting-service`, `account-lookup-service`, etc.) — same recipe
  validated in CCHFRMS-33.
- Kafka reachable from the host on `localhost:9092` (verified both via
  `docker exec kafka kafka-topics.sh --list` and directly with `kafkajs` from Node,
  mirroring how `ppa-prototype` connects).
- Confirmed `topic-transfer-prepare` and `topic-transfer-fulfil` both exist on the live
  broker.

**Full stack status as of this pass**: all ~46 Tazama containers `Up`, none
crash-looping (`docker ps -a --filter name=tazama-` sweep, confirmed twice). TMS
(`:5000`) and admin-service (`:5100`) both `GET /health` → `200 {"status":"UP"}`.
Mojaloop stack untouched and still healthy alongside it.

**Not yet done**: driving an actual transfer through the TTK collection with both stacks
up simultaneously, and pointing `ppa-prototype` at both. That's step 5 (build the
transform + sink) and step 7 (end-to-end validation) — next up once you say go.

## Field-mapping gap analysis (FSPIOP transfer → ISO 20022)

Cross-checked the captured live samples against TMS's AJV-enforced required fields, and
against the referenced `ml-schema-transformer-lib` mapping doc. **This is the part
CCHFRMS-38 doesn't mention but needs to, because it's not a mechanical decode — several
required ISO fields don't exist anywhere in the FSPIOP transfer payload:**

`ml-schema-transformer-lib`'s mapping doc gives explicit field mappings for a few keys —
these supersede my earlier guesses and should be used instead:

| FSPIOP field | ISO field (per upstream mapping doc) |
| --- | --- |
| `transferId` | `CdtTrfTxInf.PmtId.TxId` (not `EndToEndId`/`InstrId` as first assumed) |
| `payerFsp` | `CdtTrfTxInf.DbtrAgt.FinInstnId.Othr.Id` (not `ClrSysMmbId.MmbId`) |
| `payeeFsp` | `CdtTrfTxInf.CdtrAgt.FinInstnId.Othr.Id` |
| `amount.currency` / `amount.amount` | `IntrBkSttlmAmt.Ccy` / `.ActiveCurrencyAndAmount` |
| `ilpPacket` | `CdtTrfTxInf.VrfctnOfTerms.IlpV4PrepPacket` |
| `transferState` | `TxInfAndSts.TxSts` (still needs the enum map below) |
| `completedTimestamp` | `TxInfAndSts.PrcgDt.DtTm` |
| `fulfilment` | `TxInfAndSts.ExctnConf` |

The upstream doc also **confirms independently** the identity gap flagged below: it
states `Cdtr`/`Dbtr` should be derived from the *quote response*, not from the transfer
payload — because the transfer payload doesn't carry them. It does not map `condition`
at all for pacs.002. Note the upstream doc targets `pacs.008.001.13`/`pacs.002.001.15`
(newer ISO message versions) while TMS's AJV schemas validate against
`pacs.008.001.10`/`pacs.002.001.12` — need to double check field availability doesn't
drift between those versions when implementing.

### pacs.008 (from `topic-transfer-prepare`)

| Required by TMS | Source in FSPIOP payload | Status |
| --- | --- | --- |
| `GrpHdr.MsgId`, `CreDtTm`, `NbOfTxs`, `SttlmInf.SttlmMtd` | not present | **gap — must synthesize** (e.g. `MsgId` = generated, `CreDtTm` = envelope `metadata.event.createdAt`, `NbOfTxs=1`, `SttlmMtd` = fixed `"CLRG"`) |
| `CdtTrfTxInf.PmtId.InstrId` + `EndToEndId` | only `transferId` exists (no natural Instr/EndToEnd split) | **gap — decision needed**: likely both set to `transferId` |
| `IntrBkSttlmAmt`, `InstdAmt` | `amount.amount` / `amount.currency` | mappable |
| `Dbtr`/`Cdtr` (`Nm`, `Id.PrvtId...Othr[].Id`), `DbtrAcct`/`CdtrAcct` | **not present at all** — FSPIOP prepare payload only has `payerFsp`/`payeeFsp` (FSP identifiers, not party or account ids) | **real gap — no source data**, only stubbable |
| `DbtrAgt`/`CdtrAgt.FinInstnId.ClrSysMmbId.MmbId` | `payerFsp` / `payeeFsp` | mappable |
| `ChrgBr`, `ChrgsInf`, `Purp`, `RgltryRptg`, `RmtInf`, `SplmtryData.Doc.Xprtn` | not present (except `expiration` → `Xprtn`) | **gap — must default/stub** |

### pacs.002 (from `topic-transfer-fulfil`)

| Required by TMS | Source in FSPIOP payload | Status |
| --- | --- | --- |
| `GrpHdr.MsgId`, `CreDtTm` | not present | synthesize (`CreDtTm` ← `completedTimestamp`) |
| `TxInfAndSts.OrgnlInstrId`/`OrgnlEndToEndId` | `transferId` (same id joins prepare→fulfil, good) | mappable, **must match the pacs.008 EndToEndId chosen above** |
| `TxSts` | `transferState` (`COMMITTED`/`ABORTED`/`RESERVED`/`RECEIVED`) | **gap — needs an explicit enum map** to ISO `TxSts` (`ACSC`, `RJCT`, etc.) |
| `ChrgsInf`, `AccptncDtTm`, `InstgAgt`, `InstdAgt` | not present (`InstgAgt`/`InstdAgt` derivable from `from`/`to` envelope fields) | partially mappable, partially stub |

**Bottom line**: this is a lossy, best-effort transform, not a faithful one — the
FSPIOP transfer messages Mojaloop actually emits don't carry ISO-required party/account
identity or settlement metadata. The prototype will need clearly-marked placeholder/stub
values for those fields to get past AJV validation, and that should be documented as a
deliberate, visible limitation — not hidden inside the mapping code.

## Plan

1. ~~**Confirm the mapping doc.**~~ **Done** — see field-mapping table above, sourced
   directly from `ml-schema-transformer-lib`'s "FSPIOP to ISO 20022 Mapping.md". No
   reusable mapping code found in that repo, just documentation — a hand-rolled
   transform in `ppa-prototype` is still the right approach.
2. ~~**Bring up Tazama locally**~~ **Done** — full stack up under compose project
   `tazama`, TMS confirmed healthy on `localhost:5000`. Required an env-file fix (see
   verification log above). `tp`/`tadp`/`admin-service` still broken, deferred as
   non-blocking for ingestion-only scope.
3. ~~**Bring up Mojaloop locally**~~ **Done** — `ml-core-test-harness` up via the same
   recipe as CCHFRMS-33, all services healthy, Kafka confirmed reachable on
   `localhost:9092` with both target topics present.
4. **Add a transform module** to `ppa-prototype` (e.g. `src/transform/iso20022.js`):
   - `toPacs008(envelope)` — consumes the already-decoded `topic-transfer-prepare`
     envelope, returns a `FIToFICstmrCdtTrf` body per the gap table above.
   - `toPacs002(envelope)` — same for `topic-transfer-fulfil`, including the
     `transferState → TxSts` enum map.
   - Keep stubbed/defaulted fields easy to grep for (e.g. a `// STUB:` marker or a
     single `PLACEHOLDER_*` constants block) so the "gaps" are visible in code, not
     just in this doc.
5. **Add a Tazama sink.** Extend the existing consumer pipeline
   (`src/kafka/consumer.js` → currently parser → store) with a new step: after
   parsing/decoding, if the topic is `topic-transfer-prepare` or `topic-transfer-fulfil`,
   build the ISO payload and `POST` it to the TMS endpoint (plain `fetch`/`http`, no new
   dependency needed). Log the TMS response (`200` vs `400` body) alongside the existing
   `[event]` log line and keep storing the raw envelope in the message store as today —
   don't remove existing CCHFRMS-33 behavior.
6. **Env/config additions** to `src/config.js`: `TAZAMA_TMS_URL` (default
   `http://localhost:3000`), and a feature flag (`TAZAMA_INGEST_ENABLED`, default
   `true` for this prototype) so the Kafka-only mode from CCHFRMS-33 still works if
   needed.
7. **Validate end-to-end**: drive a transfer through the TTK collection (or a manual
   `POST /transfers` + fulfil) against the harness, confirm:
   - prepare → pacs.008 POST → TMS `200`
   - fulfil → pacs.002 POST (same `EndToEndId`) → TMS `200`, and that TMS's own cache
     lookup succeeds (no fallback-to-Postgres-rebuild log on the TMS side, or if it
     falls back, confirm that still succeeds)
   - a deliberately-malformed case to see TMS's `400` shape, so failure handling is
     documented too, not just the happy path.
8. **Document.** Update `ppa-prototype/README.md` with the new Tazama-ingestion section
   (mirroring how the Kafka-consumption section is documented today), and write the
   gap/assumption list (the field-mapping table above, finalized with real response
   bodies) either there or in a new `docs/Kafka/pacs-mapping-gaps.md`.

## Gaps to raise on the CCHFRMS-38 ticket itself

These aren't blockers, but should be called out to whoever owns the story so the
"lossy mapping" isn't a surprise at review time:

1. **No source data for ISO party/account identity fields** (`Dbtr`/`Cdtr`
   `Id.PrvtId`, `DbtrAcct`/`CdtrAcct`) in the FSPIOP transfer messages — only
   `payerFsp`/`payeeFsp` (participant-level, not party-level) are available from
   `topic-transfer-prepare`. If Tazama's rules need real party/account identity to be
   meaningful, this prototype's stubbed values won't be enough — that's a scope
   question for a later story (e.g. correlating in quote-topic data from CCHFRMS-33's
   `topic-quotes-post`/`topic-quotes-put`, which does carry `payer`/`payee` party
   details, to enrich the transfer payload before mapping).
2. **`TxSts` enum mapping is not specified anywhere** — the story says "convert to the
   JSON format expected by Tazama" but doesn't define the Mojaloop `transferState` →
   ISO `TxSts` mapping. Proposing a default map as part of this work
   (`COMMITTED→ACSC`, `ABORTED`/`REJECTED→RJCT`, `RESERVED→ACSP`, else `PDNG`) but
   flagging it as an assumption, not a confirmed spec.
3. **Tenant handling is undecided.** TMS resolves `TenantId` server-side
   (`DEFAULT` when unauthenticated). Fine for a local prototype; will need a real
   decision once this moves toward the shared/server environment (multiple DFSPs ⇒
   multiple tenants?).
4. **Story doesn't mention `topic-transfer-get` or `topic-notification-event`** (both
   already consumed by the CCHFRMS-33 prototype) — worth an explicit call-out that
   they're out of scope for this story so it's not assumed they're being ingested too.
5. **EndToEndId/InstrId choice is unspecified** — FSPIOP only has one `transferId`;
   the story doesn't say whether `InstrId` and `EndToEndId` should be the same value
   or derived differently. Defaulting to "same value" unless told otherwise.
6. **Server deployment is explicitly out of scope for this pass** (per your
   instruction) — this plan only covers local `ml-core-test-harness` +
   `Full-Stack-Docker-Tazama`. Porting the TMS URL/broker address to the real server
   is future work, not part of this story's acceptance criteria as written.

## Non-goals for this story (matches ticket scope)

- FX/bulk transfer topics, error-path topics — still excluded, consistent with
  CCHFRMS-33.
- pain.001/pain.013 (quote-side ISO ingestion) — ticket is transfer-only
  (pacs.008/pacs.002); CCHFRMS-33's quote topic consumption stays as-is, unused by
  this story.
- Running against the deployment VM — local-only for this pass per your instruction.

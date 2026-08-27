# Continue — after Phase 1

Handoff document for picking this work back up in a new chat. Written at the
point where Phase 1 (MLA) is complete and the narrow vertical slice has been
run and verified against real local infrastructure. Read this first; it
points at the real documents rather than re-deriving them.

---

## 1. What this project is

`poc-mla-ppa` (`/home/abdul-rahim/mojaloop/poc-mla-ppa/`) is a proof of
concept for two services — the **Mojaloop Adaptor (MLA)** and the **Payment
Platform Adaptor (PPA)** — that together carry payment events from the
COMESA DRPP (a Mojaloop-based switch) into Tazama's fraud-detection pipeline.
MLA lives in Mojaloop's network boundary and forwards events; PPA lives in
Tazama's boundary, correlates them, translates to Tazama's ISO 20022 message
set, and sends to Tazama's Transaction Monitoring Service (TMS).

**This is explicitly a POC**, not a production build. It exists to prove the
idea works against real data, not to stand up a deployment. That distinction
matters for what "done" means at every phase — see §4.

**Read these, in order, before doing anything else:**

1. [`../MLA-PPA-Executive-Summary.md`](../MLA-PPA-Executive-Summary.md) — the
   non-technical why and what.
2. [`../MLA-PPA-Technical-Design.md`](../MLA-PPA-Technical-Design.md) — **the
   authoritative implementation-facing spec.** Interfaces, data shapes,
   keying, failure behaviour. Section numbers (§2.2a etc.) referenced
   throughout this document and the code comments point here.
3. [`../plan-outline.md`](../plan-outline.md) — **the live status tracker.**
   Checkbox-per-item, phase-by-phase, with a "Current status" section at the
   top that is kept up to date. This is the single most important document
   to read next — it has far more detail than this handoff repeats.
4. [`../MLA-PPA-Development-Blockers_v1.0.md`](../MLA-PPA-Development-Blockers_v1.0.md)
   — the one blocker that's still real (see §5).

---

## 2. The normative sources, and where they disagree

| Document | Authority for |
| --- | --- |
| `CCH_FSD_MessageIngestion_v4.0.md` (in `cchfrms-comesa/docs/Design Docs/1-FSDs/2-Internal-Review/`) | Business logic: correlation, trigger/enrichment classification, ISO 20022 translation rules |
| `Integration_and_Interface_Document_v4.0.md` (same tree, `3-TSDs/1-Draft/`) | Where MLA/PPA sit in the wider pipeline. **Drifted from the FSD on several points** — table in Technical Design's intro. |
| `DRPP_Kafka_E2E_Pack/` (`/home/abdul-rahim/mojaloop/DRPP_Kafka_E2E_Pack 2/DRPP_Kafka_E2E_Pack/`) | **Ground truth for the ingress/topic model.** Overrides the FSD wherever they conflict — the FSD's topic-model hypothesis turned out to be wrong in several specific ways (see Technical Design's "Where the captures override the FSD's topic model" table). |

**The single most important fact to internalise:** the MLA does not consume
per-action Kafka topics as the FSD originally described. It consumes **one
topic, `topic-event-audit`**, where every record carries an explicit
`operation` tag (13 known values) that classifies it directly — no
payload-shape sniffing needed anywhere. Records are also **double-written**
(`start`/`egress`) for most operations, asymmetrically, not as a generic
pair. All of this was discovered by analysing the real capture pack and is
now implemented, not theoretical — see §3.

---

## 3. What's actually built and verified (Phase 0–3)

**Phase 0 (scaffolding) and Phase 1 (MLA) are done.** Phase 2 (PPA
correlation) and Phase 3 (translation/egress) are **partially done** — enough
to run the narrow vertical slice end to end, not the full spec.

### 3.1 The code

| File | What it does |
| --- | --- |
| `mla/src/services/logic.service.ts` | Full MLA pipeline: `parseAuditMessage`, `isCanonicalRecord`, `classifyEventType`/`classifyMsgType`, `buildEnvelope` (anchor-id model, `quoteId→anchor` chaining), `dispatchToPpa` (retry/backoff/pause), `handleMessage`. |
| `mla/src/interfaces/event-envelope.ts` | The Event Envelope contract. `id` is a **deliberate deviation from the FSD**: the anchor identifier (`transactionId`) used uniformly across every `eventType`, not the FSD's per-type scheme — see Technical Design §2.3 for why. |
| `ppa/src/services/logic.service.ts` | PPA pipeline steps 3–10 for the `TRANSFER` eventType: `validateEnvelope`, `classify`, `mergeEnrichment`, `isDomesticTransfer`, `translate`, `sendToTms`, `finalize`, `auditLog`, `processEnvelope`. `QUOTE`/`FXQUOTE` wired as enrichment-only (no `pain.001`/`pain.013` emission yet — see §4). |
| `ppa/src/services/iso20022.ts` | **New file.** FSPIOP → Tazama ISO 20022 field mapping for `pacs.008`/`pacs.002`, ported from `ppa-prototype`'s TMS-verified shape and re-verified against a second live TMS instance. `toTxSts` translates both FSPIOP (`COMMITTED`) and ISO (`COMM`) vocabularies. |
| `ppa/src/clients/cache.ts` | Added `getState`/`saveState`/`deleteState`/`claimSentGuard` to `CacheClient`. **`saveState` is a plain read-modify-write, not the atomic compare-and-merge the spec requires for multi-replica correctness** — documented POC simplification, not silently dropped. |
| `mla/__tests__/fixtures/audit-records.json` | **Eight real records**, lifted verbatim from `DRPP_Kafka_E2E_Pack/01_MWK_to_ZMW_PRIMARY/raw_messages.json`. See `fixtures/README.md` for exactly which records and why each was chosen. This is the fixture source going forward — `ppa-prototype/captured/` is retired, it's a different topic. |

### 3.2 Tests

**45 tests, all passing, 0 lint errors in both packages** (a handful of
`no-magic-numbers` warnings left as-is — the user explicitly said warnings
are fine, errors are not).

- `mla/__tests__/logic.test.ts` — 21 tests. Classification, canonical
  selection, envelope construction (including the `putQuotesByID` chaining
  ordering dependency — has to process `postQuotes` first), `dispatchToPpa`'s
  200/4xx/5xx outcomes.
- `ppa/__tests__/logic.test.ts` — 24 tests. `classify`, `isDomesticTransfer`,
  `translate` (degraded vs. enriched `pacs.008`, `TxSts` translation),
  `mergeEnrichment`, `sendToTms` retry policy.

Run with (each package):
```bash
cd mla   && NODE_ENV=test npx jest --config=jest.config.ts --forceExit
cd ppa   && NODE_ENV=test npx jest --config=jest.config.ts --forceExit
```

### 3.3 The live run — what was actually proven, not just unit-tested

Real records from `01_MWK_to_ZMW_PRIMARY` were replayed through the **actual
compiled code** (not mocks) against a live local Tazama stack:

- `docker ps` confirms `tazama-tms-1` running, mapped to `localhost:5000`.
- The stack's own `valkey` on `localhost:16379` (PPA's `CACHE_DB=1`, a
  separate index from whatever Tazama itself uses on that instance).
- Order: `postQuotes` → `postFxQuotes` → `putFxQuotesByID` (enrichment,
  merged into ValKey) → `prepareTransfer` (**trigger** → `pacs.008` → TMS)
  → `commitTransfer` (**trigger** → `pacs.002` → TMS).
- **Both messages got `200` from TMS's own AJV schema validation**, both
  `degraded: false` — real party names (`Firstname-Test Lastname-Test`,
  `Chikondi Banda`) came from the merged quote enrichment, not placeholders.

**A real bug was caught and fixed by this run, not glossed over:** the first
`pacs.008` attempt was rejected `400` (`missing required property
'RgltryRptg'`) — the initial port from `ppa-prototype` had dropped
`RgltryRptg`/`RmtInf`/`SplmtryData`. Fixed in `ppa/src/services/iso20022.ts`
by restoring them from the prototype's proven shape.

**A separate, earlier run without the FX-quote records correctly hit
`isDomesticTransfer`'s discard path** — not a bug, evidence the discriminator
works: a transfer with no correlated FX-quote state is legitimately
indistinguishable from domestic.

**Not independently double-checked:** Tazama's own Postgres
(`event_history.transaction`). `docker exec` into `tazama-postgres-1`
produced no output and exit code 1 in this environment (tooling access
issue, not investigated further). TMS's own `200`/AJV acceptance is the
evidence on record instead. Worth trying again in the new session if useful
— see if `docker exec -it` or a different invocation works, or check
container logs for why psql produced nothing.

**To rerun the live demo yourself:** both services need `npm run build` run
first (or `npm start` after `cp .env.template .env` adjustments — the actual
`.env` files already point at the local stack, see §6). The manual replay
script used for this isn't saved anywhere permanent — it read
`mla/__tests__/fixtures/audit-records.json`, called the compiled
`buildEnvelope`/`parseAuditMessage` from `mla/build/services/logic.service.js`
directly via Node, and POSTed the resulting envelopes to the running PPA in
the order above. Reconstructing it is straightforward from that description
if wanted again.

---

## 4. What's next — in priority order

This is the short version. **Full detail, with exact file/function pointers,
is in `plan-outline.md`'s "Immediate next steps" (top) and the Phase 2–7
checklists.** Don't duplicate effort re-deriving what's already there.

1. **Widen Phase 3 to the quote stages** (`pain.001.001.11`,
   `pain.013.001.09`). Currently `QUOTE`/`FXQUOTE` are classified
   `Enrichment` only — no message emitted. The local TMS instance doesn't
   even mount these routes without `QUOTING=true` (confirmed: `404`) — check
   that flag or point at an instance that has it before building against it.
2. **Pin a `tms-service` commit and add local ajv schema validation** before
   every PPA→TMS send. Still blocked on FSD Open Item 6 (no commit chosen),
   but now backed by a concrete example of why it matters — the `RgltryRptg`
   miss above is exactly the class of drift that step would catch before a
   live TMS does.
3. **Atomic compare-and-merge for `mergeEnrichment`** (`ppa/src/clients/cache.ts`
   `saveState`) — currently a plain read-modify-write, correct only for a
   single PPA instance. Needed before any multi-replica testing.
4. **Persist-and-retrieve** (`parkExpiringState`/`retrieveParkedState` in
   `ppa/src/services/logic.service.ts`) — still no-op stubs. Depends on
   Phase 4's durable store existing (currently `ppa/src/clients/write-ahead.store.ts`
   is a placeholder that returns `true`/no-ops throughout).
5. **Error-path translation** (`pacs.002` with `TxSts: RJCT`) — untested,
   because `DRPP_Kafka_E2E_Pack` contains zero rejected/aborted transactions.
   Worth explicitly requesting error-path captures from COMESA (this is
   already flagged in `plan-outline.md`'s "Open questions" section).
6. Everything else — durability (Phase 4), security/mTLS (Phase 5),
   operability (Phase 6), and full validation (Phase 7) — is genuinely not
   started, and per §5 below, most of it is deployment-stage work anyway.

---

## 5. The one real blocker, and the one that isn't

- **COMESA-side test environment: deferred, not blocking.** It gates real
  deployment (MLA in its actual network boundary, the VPN P2P link, mTLS,
  load testing, UAT sign-off) — none of which the POC needs. Everything
  through Phase 3 has been done and verified with local infrastructure alone.
  It becomes a real blocker again only when this POC is finished and the
  next phase is genuine deployment. Full detail:
  `MLA-PPA-Development-Blockers_v1.0.md` (still accurate, not walked back).
- **Kafka captures: resolved.** This was the other original blocker
  (`MLA-PPA-Development-Blockers_v1.0.md` documents it as it stood before
  the captures arrived) — `DRPP_Kafka_E2E_Pack` closed it. That document is
  kept as-is for the historical record of what was asked for and why; don't
  edit it to "un-block" it, the current status lives in `plan-outline.md`.

---

## 6. Local dev environment — how to pick this up and run it

```
tazama-tms-1     localhost:5000   (docker ps to confirm; part of a larger
                                    local docker-compose Tazama stack —
                                    check `docker ps | grep tazama` first,
                                    since this may not still be running)
valkey           localhost:16379  (same stack)
```

`mla/.env` and `ppa/.env` already point at these (not `.env.template` —
the actual `.env` files were edited during Phase 1 work):

- `mla/.env`: `KAFKA_ENABLED=false` (no live broker for `topic-event-audit`
  exists locally — nothing to consume from; all MLA testing is via fixtures
  and direct function calls), `KAFKA_AUDIT_TOPIC=topic-event-audit`,
  `PPA_BASE_URL=http://localhost:3002`.
- `ppa/.env`: `CACHE_ENABLED=true`, `CACHE_HOST=localhost`,
  `CACHE_PORT=16379`, `CACHE_DB=1` (deliberately separate from whatever
  Tazama itself uses on that instance), `TMS_BASE_URL=http://localhost:5000`.

```bash
# Build both
cd mla && npm run build
cd ../ppa && npm run build

# Run both (separate terminals / background)
cd mla && node -r dotenv/config build/index.js   # :3001
cd ppa && node -r dotenv/config build/index.js   # :3002

# Health check
curl localhost:3001/health/ready
curl localhost:3002/health/ready
```

**Before assuming the TMS/valkey stack is still up:** it was started outside
this project by the user (`docker ps` showed a `tazama-*` compose project
already running when Phase 1 work began — I didn't start it). Confirm with
`docker ps | grep tazama` before trying to run the live-slice demo again; if
it's down, either start it (`docker compose up` from wherever that stack's
compose file lives — not located during this session, ask the user) or fall
back to the mocked unit tests, which don't need it.

---

## 7. Repository / git state

`poc-mla-ppa` is its own git repo (nested under the `mojaloop` workspace).
**All Phase 1 changes are staged but not committed** — `git status --short`
shows `M`/`A` against `docs/plan-outline.md`, both `logic.service.ts` files,
both `event-envelope.ts` files, `ppa/src/clients/cache.ts`,
`ppa/src/services/iso20022.ts`, and the new test/fixture files. Recent commit
history (`git log --oneline`) shows a consistent pattern of one commit per
significant doc/code alignment pass — follow that pattern if/when asked to
commit. **Don't commit unprompted** — wait for the user to ask, per standing
instructions.

---

## 8. Conventions worth knowing before writing more code

- **Fixtures come from real captures, never hand-written.** Extend
  `mla/__tests__/fixtures/audit-records.json` from
  `DRPP_Kafka_E2E_Pack/*/raw_messages.json` if a new case needs covering, and
  update `fixtures/README.md` to explain why each record is there.
- **Lint bar: 0 errors, warnings OK** (explicit user instruction this
  session). `no-magic-numbers` warnings on small literals like `+ 1` in log
  messages are fine to leave.
- **Both packages are independent npm projects** (Technical Design §4) —
  the Event Envelope type is deliberately duplicated, not shared through a
  package. Don't try to unify them.
- **Section references in code comments** (`§2.2a`, `§6.4.3`, etc.) point at
  `MLA-PPA-Technical-Design.md`. Keep using them — they're what makes the
  code navigable back to the spec.
- **When a design decision changes, update the doc, not just the code** —
  this session corrected an overclaim in `plan-outline.md`'s own capture
  analysis (item C6) after implementation revealed the real scope was
  narrower than first written. Keep that habit: code and docs are expected
  to stay in sync, in both directions.

# Continue — after all 4 message types, live-verified

Handoff document for picking this work back up in a new chat. Written at the
point where Phase 3 is fully closed: all four Tazama message types
(`pain.001`, `pain.013`, `pacs.008`, `pacs.002`) are built, locally
schema-validated, and live-verified against a real TMS with `QUOTING=true`.
Read this first; it points at the real documents rather than re-deriving them.

**Supersedes** [`continue - after phase 1.md`](continue%20-%20after%20phase%201.md)
for "what's next" — that document is left as-is for its own historical record
(Phase 1 detail, the capture-analysis findings), but its §4 "what's next" list
is now stale. This document's §4 replaces it.

**Updated in place, not superseded, across two more sessions** — the first
closed item 1 on §4's original list (atomic compare-and-merge) and built
out item 2 (the durable write-ahead store, persist-and-retrieve,
out-of-order handling); the second **live-verified all of it**, caught and
fixed two real bugs in the process, and closed §4's live-verification item
in turn. See the revised §3.5 and §4. Unlike the phase-1 doc above, these
updates edit this document directly rather than writing a new one each
time, per how those sessions were asked to hand off.

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
idea works against real data, not to stand up a deployment.

**Read these, in order, before doing anything else:**

1. [`../MLA-PPA-Executive-Summary.md`](../MLA-PPA-Executive-Summary.md) — the
   non-technical why and what.
2. [`../MLA-PPA-Technical-Design.md`](../MLA-PPA-Technical-Design.md) — **the
   authoritative implementation-facing spec.** New since Phase 1: §7.3
   documents this session's live run in full. Section numbers (§2.2a etc.)
   referenced throughout this document and the code comments point here.
3. [`../plan-outline.md`](../plan-outline.md) — **the live status tracker.**
   Current status section at the top narrates this session's work in detail;
   Phase 3's checklist and exit criterion are both now "met."
4. [`../MLA-PPA-Development-Blockers_v1.0.md`](../MLA-PPA-Development-Blockers_v1.0.md)
   — the one blocker that's still real (COMESA test environment — deferred,
   not blocking the POC).

---

## 2. Where alignment against the IID/FSD stands

Earlier this session, `Integration_and_Interface_Document_v4.0.md` and its
four component FSDs were compared against this project's own Technical
Design and plan-outline. Conclusion: **strongly aligned on everything that
matters.** The divergence table in Technical Design's intro ("Where the two
sources disagree") was cleaned up as part of this:

- Five previously-tracked divergence rows were confirmed resolved by the
  IID's own later revision passes (trigger pairing language, FX Transfer's
  enrichment-only status, `TxSts` translation, `pacs.008` field shapes, the
  health-endpoint split) and dropped from the table.
- **One divergence remains, genuinely unresolved**: `msgType` values — FSD
  says `request`/`callback`/`notification`, IID says the original HTTP verb
  (`POST`/`PUT`). The IID itself flags this as an open naming collision (IID
  Open Item #22), not a one-sided error. This POC follows the FSD.
- **New observation added, not a divergence but worth flagging to whoever
  owns the IID**: its `pacs.008` worked example is still missing
  `RgltryRptg`/`RmtInf`/`SplmtryData` entirely. These are constant-valued but
  schema-required — a live TMS rejects a message without them. This is the
  exact defect this project's own build caught and fixed (see §3 below) —
  concrete evidence the gap is real, not theoretical.

No other action needed here unless the user wants to actually raise these
two points with the IID's owner — that hasn't been done, just documented.

---

## 3. What's actually built and verified — Phase 0 through 3, all done

### 3.1 The code

| File | What it does |
| --- | --- |
| `mla/src/services/logic.service.ts` | Full MLA pipeline: `parseAuditMessage`, `isCanonicalRecord`, `classifyEventType`/`classifyMsgType`, `buildEnvelope`, `dispatchToPpa`, `handleMessage`. Unchanged this session. |
| `ppa/src/services/logic.service.ts` | PPA's 10-step pipeline for **all four** message types now, not just `TRANSFER`. `classify()`: `QUOTE` is now `Trigger` (was `Enrichment`-only). New: `asQuoteRequestPayload`/`asQuoteCallbackPayload` shape guards, `translate()` dispatches QUOTE to `pain.001`/`pain.013` before falling through to transfer logic, `isOutOfScopeTransfer()`/`expectedMessageTypeFor()`/`translateAndValidate()`/`isDuplicateFinalStateNotification()` extracted to keep `processEnvelope`'s cyclomatic complexity under the lint threshold. `processEnvelope` now runs local schema validation between translate and send, and calls `mergeEnrichment(envelope)` after sending for `EventType.Quote` (trigger **and** enrichment — QUOTE does both). |
| `ppa/src/services/iso20022.ts` | New this session: `toPain001()`, `toPain013()` builders, `fspIdOf()`/`fxTermsOf()`/`eqvtAmtFor()` helpers, `quoteSplmtryDoc()` (the transaction-level `SplmtryData` block pain.001's schema requires — see the bug below), new `PLACEHOLDER` constants for quote-specific fields. `messageId()` extended to accept `'pain001' | 'pain013' | 'pacs008' | 'pacs002'`. |
| `ppa/src/services/tazama-schema.validator.ts` | **New file.** `validateTazamaMessage(messageType, message)` — dedicated Ajv instance matching TMS's exact config (`removeAdditional: 'all'`, `useDefaults: true`, `coerceTypes: 'array'`, `strictTuples: false`, `strict: false`), all four schemas compiled and keyed by `IsoMessageType`. Wired into `processEnvelope` right where FSD §6.3 step 7 puts it — a failure here is a permanent translation defect: logged, not sent, not retried. |
| `ppa/src/schemas/tazama/{pacs.002,pacs.008,pain.001,pain.013}.json` | **New files.** Copied verbatim from `frmscoe/tms-service` commit `f18317f1f7973623157e1467da78e6853c7b1b89` (`/home/abdul-rahim/tazama/tms-service/src/schemas/`), package version 3.0.0. This is the pinned commit — Open Item "pin a tms-service commit" is now resolved. |

### 3.2 Tests

**56 tests total** (21 MLA + 35 PPA), all passing, 0 lint errors in both
packages.

- `ppa/__tests__/logic.test.ts` — added a `describe('translate - QUOTE ...')`
  block (5 tests) and a `describe('processEnvelope - QUOTE is trigger +
  enrichment ...')` integration test. New fixtures
  (`quoteRequestEnvelope`/`quoteCallbackEnvelope`/`cachedFxQuoteCallbackState`)
  are real capture-sourced, not hand-written, per the project's standing
  convention.
- `ppa/__tests__/tazama-schema.validator.test.ts` — **new file.** Confirms
  all four builders produce schema-conformant output, plus a regression test
  that specifically rejects a `pacs.008` with `RgltryRptg` stripped (guards
  against the exact class of defect the live run caught).

Run with (each package):
```bash
cd mla && NODE_ENV=test npx jest --config=jest.config.ts --forceExit
cd ppa && NODE_ENV=test npx jest --config=jest.config.ts --forceExit
```

### 3.3 The live run — what was actually proven this session, not just unit-tested

Two live runs happened this session, in sequence:

**Run 1 — `pacs.008`/`pacs.002` only** (carried over from Phase 1, already
recorded in the older continue doc — not repeated in detail here).

**Run 2 — all four message types, with `QUOTING=true`.** This is the new
work:

1. **Flipped `QUOTING=true`** on the shared local Tazama stack's `tms`
   service. File: `/home/abdul-rahim/tazama/Full-Stack-Docker-Tazama/env/tms.env`,
   line 7, `false` → `true`. Recreated with
   `docker compose -p tazama -f [8 compose files] up -d --no-deps tms` —
   `--no-deps` and explicit `-p tazama` matter, see the pitfall in §5.
2. **Confirmed live**: `POST .../pain.001.001.11` moved from `404` (route
   not mounted) to `400` (empty-body validation — expected, means the route
   is mounted now).
3. **Replayed the real capture** (`01_MWK_to_ZMW_PRIMARY`) through the
   **actual compiled code** — not mocks — via a scratch script that required
   `mla/build/services/logic.service.js` directly and called
   `parseAuditMessage`/`isCanonicalRecord`/`buildEnvelope`/`dispatchToPpa`
   against a running PPA instance. Causal order:
   `postFxQuotes → putFxQuotesByID → postQuotes → putQuotesByID →
   prepareTransfer → commitTransfer`, 800ms between each (state has to be
   merged before the next step reads it).
4. **Result: all four message types accepted, all `degraded: false`.**
   `pain.001.001.11`, `pain.013.001.09`, `pacs.008.001.10`,
   `pacs.002.001.12`. `degraded: false` on the quote pair specifically
   confirms the FX-quote enrichment chain works end to end — `EqvtAmt`/
   `XchgRateInf` came from the real agreed FX-quote terms, not the 1:1
   fallback.
5. **Corroborated independently on the TMS side**, not just trusted from
   PPA's own logs: `tazama-tms-1`'s own container logs show `Start`/`End -
   Handle Pain001/Pain013/Pacs008/Pacs002 request`, each with the correct
   deterministic `MsgId`, each forwarded to `event-director` — meaning each
   one passed TMS's own schema validation, not just its HTTP layer.
6. **The local ajv validator raised zero rejections during this run** —
   consistent with it having already caught the one real defect at build
   time (below), before this run rather than during it.

Full technical account: Technical Design §7.3. Narrative account:
plan-outline.md's "Current status" section (two new paragraphs, the second
one covering exactly this run).

### 3.4 A real bug caught and fixed, not glossed over

`toPain001`'s first version **failed local ajv validation** before this ever
reached a live TMS: the schema requires a second, **transaction-level**
`SplmtryData` block under `CdtTrfTxInf` (distinct from the message-level
one), containing `Dbtr{FrstNm,MddlNm,LastNm,MrchntClssfctnCd}`,
`Cdtr{...}`, `DbtrFinSvcsPrvdrFees{Ccy,Amt}`, `Xprtn`. Fixed by adding a
`quoteSplmtryDoc()` helper and wiring it in.

**This is the single best piece of evidence for why the whole
pin-a-commit-and-validate-locally effort was worth doing** — a schema-drift
defect caught before it ever reached a live TMS, not after a `400` in
production. Worth remembering as the concrete example if anyone questions
whether that step earns its keep.

---

### 3.5 Phase 2 hardening — atomic compare-and-merge, durable store, and out-of-order handling, all built and now live-verified

Two later sessions picked up straight from this document's original §4. The
first worked items 1 and 2 in order, one at a time, pausing between them for
review. The second **live-verified all of it** — see the new §3.6 below,
which is the more important read if you're picking this up now: it's where
two real bugs were found and fixed, neither caught by the unit tests.

**Item 1 — atomic compare-and-merge — closed, live-verified, not just
unit-tested.** `mergeEnrichment`'s old `GET → mutate in JS → SET` (correct
only for a single instance) is gone. Correlation state is now a Redis hash
(`correlation:<id>`), one field per enrichment slot
(`quote`/`quoteCallback`/`fxQuote`/`fxQuoteCallback`/`fxTransfer`), and
`CacheClient.mergeState` (`ppa/src/clients/cache.ts`) merges exactly one
field per call as a single Lua script — `HSETNX` for idempotent leg
creation, `HSET` for the changed field plus `correlationId`/`updatedAt`,
`EXPIRE` to refresh the TTL — so application code never issues a GET of its
own and two replicas merging different fields for the same leg can only
serialise through Redis's own command execution. `saveState` (the old
unsafe primitive) is retired outright, not left next to its replacement.
Verified two ways: `__tests__/cache.test.ts` (new) runs the real script
against `ioredis-mock`, which executes `EVAL` on an actual Lua VM
(`fengari`), not a stub; and a live smoke run against the real
`tazama-valkey-1` container (`localhost:16379`) merged five different
fields onto one leg concurrently and confirmed all five landed, `createdAt`
stayed fixed and `updatedAt` refreshed across a later merge, `deleteState`
removed the whole hash. Full account in Technical Design §3.4 and §7.4 (both
updated this session).

**Item 2 — persist-and-retrieve and out-of-order handling — built, tested,
and now live-verified too (§3.6).**

- **The durable write-ahead store is real now, not a stub** —
  `ppa/src/clients/write-ahead.store.ts` was a placeholder that returned
  `true`/no-oped on everything; it's now a genuine filesystem-backed store
  (one JSON file per record, written via temp-file-then-atomic-rename so a
  crash mid-write never leaves a torn record), explicitly documented as a
  POC stand-in for whatever real backing technology the still-open
  hosting-location decision eventually picks (Phase 4) — every call site
  goes through this module's exported shape only, so that decision is a
  swap later, not a rewrite. All of `isReachable`, `persist`, `complete`,
  `isDuplicateNotification`, `park`, `retrieveParked` are real I/O now. Two
  new methods not in the original stub: `parkPendingTrigger`/
  `retrievePendingTrigger`/`clearPendingTrigger`, for the out-of-order
  early-arrival case below.
- **Persist-and-retrieve (`parkExpiringState`/`retrieveParkedState`) is
  wired in for real**, closing the "final-state event arrives very late"
  row of §3.7's table. Since ValKey's TTL has no "about to expire" event
  (only "gone," fired too late to save anything), the only way to catch a
  leg before it lapses is to look ahead of it — a new background sweep
  (`ppa/src/services/park-sweep.service.ts`, new file) periodically scans
  ValKey (via `SCAN`, not `KEYS`, batched `TTL` checks through a pipeline —
  new `CacheClient.listNearExpiryKeys`) for legs within
  `PARK_SWEEP_THRESHOLD_SECONDS` of expiring and parks their current state
  to the durable store. A leg still present in ValKey at all is sufficient
  reason to park it — `finalize` already deletes the ValKey entry the
  moment a leg reaches its terminal `pacs.002`, so anything the sweep finds
  is, by construction, still incomplete; no extra "is the counterpart still
  missing" check on the state's contents was needed. When a notification
  trigger later arrives with nothing in ValKey, it now checks the durable
  store's parked copy before giving up.
- **Out-of-order early arrival — the row confirmed real by capture
  (`04_ZMW_to_EGP_partition_split`, the settlement leg landing on a
  different Kafka partition) — is handled too, not just the late-arrival
  row.** When a notification trigger finds nothing in ValKey *and* nothing
  parked, it now runs a short bounded retry against ValKey before giving
  up — reusing the TMS retry budget/backoff (`configuration.tms.maxRetries`/
  `retryBaseMs`) rather than a bespoke one, on the reading that "reusing the
  existing retry budget" in the FSD's §3.7 language means literally that.
  If the retry also comes up empty, the trigger envelope itself is parked
  (`writeAheadStore.parkPendingTrigger`) — genuinely different from parking
  *state*, since no state exists yet to park — and picked back up once this
  leg's own `pacs.008` has actually reached TMS, not merely once some
  enrichment has merged in (`completeParkedTriggerAfterPrepare`, called
  from `processEnvelope`'s `TRANSFER`/`Request` success path). **That
  distinction was originally wrong** — see §3.6, the live replay that caught
  it. A `pacs.002` is never synthesised while waiting, matching §3.7's
  explicit rule.
- **A real concurrency bug was caught and fixed along the way, the same
  spirit as the `RgltryRptg`/`SplmtryData` catches above, just this
  session's version of it.** The durable store's atomic-write helper
  originally suffixed its temp file with `process.pid` + `Date.now()`
  (millisecond resolution). Under real parallel-worker load (running the
  full test suite, not a contrived scenario) two concurrent writes to the
  *same* destination — a fresh `persist()` racing an earlier envelope's
  still-in-flight `complete()`, both legitimate, both hitting the same
  `correlationId` file — landed in the same millisecond often enough to be
  reliably reproducible: whichever `rename` ran second failed `ENOENT`,
  because the first rename had already consumed the temp file the second
  one was about to move. Fixed with `crypto.randomUUID()`, which has no
  such collision window. Confirmed fixed by running the full parallel suite
  repeatedly (5+ consecutive clean runs) where it had failed on every
  previous attempt.
- **New config surface**, all in `.env.template`/`.env`:
  `WRITE_AHEAD_DIR` (default `data/write-ahead`, gitignored),
  `PARK_SWEEP_ENABLED`/`PARK_SWEEP_INTERVAL_SECONDS`/
  `PARK_SWEEP_THRESHOLD_SECONDS`. The process now refuses to boot if the
  threshold isn't strictly greater than the interval — otherwise a key
  could cross from "not yet near expiry" to "gone" between two sweeps
  unparked (`validateConfiguration` in `config.ts`).
- **`index.ts`** starts the sweep in `runServer` (after `connectDependencies`)
  and stops it in `shutdown`, before the fastify/cache teardown.

**Testing for item 2, before live verification** — real I/O, not
over-mocked, same standard as item 1's `cache.test.ts`:
`__tests__/write-ahead.store.test.ts` (19 tests) exercises the real
filesystem against temp directories, including a concurrency regression
test; `__tests__/park-sweep.service.test.ts` (8 tests) runs the real sweep
against `ioredis-mock` plus a temp-dir store, including the interval timer
itself over real (short, ~1s) waits; `cache.test.ts` gained 5 tests for
`listNearExpiryKeys`; `logic.test.ts` gained the out-of-order
`processEnvelope` matrix. Test count reached **117** (21 MLA + 96 PPA) at
this point, before the live-verification pass below added 3 more.

### 3.6 Live verification — the run that actually proved the design, and caught two real bugs the unit tests didn't

A third session did what §3.5 flagged as the honest gap: pointed a real
running PPA process at `tazama-valkey-1` and the real local filesystem, not
`ioredis-mock` or a temp directory.

**Three checks passed cleanly on the first try:**

1. `/health/ready` genuinely reflects store reachability both ways —
   `200`/`UP` normally, `503`/`DOWN` when `WRITE_AHEAD_DIR` is pointed at a
   path blocked by a file where a directory is needed.
2. The proactive sweep parked a real leg, twice, as its TTL approached —
   watched live against `data/write-ahead/parked/` and the sweep's own log
   line, with a shortened `CORRELATION_TTL_SECONDS`/`PARK_SWEEP_*` for a
   fast demo.
3. The write-ahead record survives a real crash: a `QUOTE` was sent to a
   PPA pointed at an unreachable TMS (long retry backoff, so the pipeline
   was genuinely still in-flight, not a timing race), the process was
   `kill -9`'d the instant the ack came back, and the WAL record was on
   disk with `status: "pending"`. A *second, independent* Node process
   (fresh PID, fresh module load, started after the first was confirmed
   dead) required the same compiled `write-ahead.store.js` and correctly
   completed that exact record — genuine cross-process, cross-restart
   filesystem durability.

**The fourth check — replaying the actual `04_ZMW_to_EGP_partition_split`
capture through the real compiled MLA code, settlement leg sent to the PPA
deliberately before the earlier partition-7 records — is the one that
mattered, and it caught two real bugs:**

1. **Premature replay.** The first version replayed a parked `pacs.002`
   the moment *any* enrichment merged in (`completeParkedTrigger` lived
   inside `mergeEnrichment`), not specifically once this leg's own
   `pacs.008` had reached TMS. In the live replay this sent `pacs.002`
   before `pacs.008` existed in Tazama's graph, and — because a successful
   `pacs.002` clears ValKey state via `finalize` — the real `prepareTransfer`
   arriving seconds later then read no state and got discarded as domestic:
   `pacs.008` never sent at all, for a payment `pacs.002` had already
   claimed was final. **Fixed**: the check now lives in
   `completeParkedTriggerAfterPrepare`, called only after a confirmed
   successful `pacs.008` send, folded into one guarded helper rather than
   left as a bare condition in `processEnvelope` (keeps its cyclomatic
   complexity under the lint threshold — same reasoning, again, as the
   Phase-3-era extractions).
2. **Self-dedup.** With bug 1 fixed, the replayed `pacs.002` was then
   discarded as a *duplicate notification* — its own first (parked) arrival
   had already claimed the step-4 dedup key, before parking, and replaying
   it re-ran the same check against its own prior claim. **Fixed**: a new
   `isReplay` flag threads through `processEnvelope` (a thin public wrapper
   keeps the existing 2/3-arg signature for every other caller — nothing
   else needed to change) and skips the dedup check only on this internal
   replay path. A fresh, genuine duplicate arrival is unaffected and still
   correctly discarded — covered by a dedicated regression test.

**Re-run after both fixes**: the identical replay produced `pain.001` →
`pain.013` → `pacs.008` → `pacs.002`, in that causal order, every message
`degraded: false`, independently corroborated on `tazama-tms-1`'s own
container logs (`Start`/`End - Handle {Pain001,Pain013,Pacs008,Pacs002}
request`, correct deterministic `MsgId`s). Confirmed cleaned up afterward:
the pending-trigger record cleared, ValKey correlation state deleted by
`finalize`.

**Test count is now 120** (21 MLA + 99 PPA) — the 3 more PPA tests are the
rewritten `completeParkedTrigger` block (testing the corrected trigger
condition, not the old buggy one) plus the dedup regression test.
`npm run lint`: 0 errors — both fixes pushed `processEnvelope`'s complexity
back over 15 in turn; both times fixed the same way (extraction), the
second one also splitting the public wrapper from the real implementation
so only one function carries `isNotification`'s default-parameter
complexity cost. `npm run build`: clean.

**What this pass did *not* cover, honestly**: a notification arriving late
enough that a *swept-and-parked state* (not a parked trigger) is what
resolves it. Check 2 above proves the sweep parks state; check 4 exercises
the opposite-direction early-arrival path, not this one — `retrieveParkedState`
was called every time in the replay but always found nothing, since
nothing had been swept yet by the time the notification arrived. Also
still open: sizing the store against peak TPS, choosing its real backing
technology, and operator-triggered replay — none of those are built.

Full technical account: Technical Design §3.7, §7.5. Narrative account:
`plan-outline.md`'s "Current status" section.

---

## 4. What's next — in priority order

Full detail with exact file/function pointers is in `plan-outline.md`'s
"Immediate next steps" (top) and the Phase 2/4 checklists. Don't duplicate
effort re-deriving what's already there. **Revised again by the
live-verification session covered in §3.6** — both original items are now
closed; read §3.6 before starting more work here, since it's where two real
bugs were found and fixed, not just where things got proven live.

1. ~~Atomic compare-and-merge for `mergeEnrichment`~~ — **done,
   live-verified (§3.5).** No longer on this list.
2. ~~Live-verify the durable store, the park sweep, and out-of-order
   handling against the real local stack~~ — **done (§3.6).** Two real bugs
   found and fixed in the process (premature replay before this leg's own
   `pacs.008` had reached TMS; the recovered `pacs.002` then self-discarding
   as a duplicate of its own parked arrival), both now live-verified fixed
   too, not just unit-tested. No longer on this list. **Explicitly not
   covered by this pass**, if picking this back up: a notification arriving
   late enough that a swept-and-parked *state* (not a parked trigger) is
   what resolves it - see §3.6's closing paragraph.
3. **Error-path translation** (`pacs.002` with `TxSts: RJCT`) — still
   untested, because `DRPP_Kafka_E2E_Pack` contains zero rejected/aborted
   transactions. Worth explicitly requesting error-path captures from
   COMESA — already flagged in plan-outline.md's "Open questions" section.
   Unchanged across all three sessions; still genuinely blocked, not just
   unstarted. **The next real action**, now that items 1 and 2 are both
   closed.
4. Everything else — durability (Phase 4 beyond the write-ahead store: the
   backing-technology decision itself, sizing against peak TPS, operator-
   triggered replay), security/mTLS (Phase 5), operability (Phase 6), and
   full validation (Phase 7) — genuinely not started, and per the Technical
   Design §5, most of it is deployment-stage work anyway, gated on the
   COMESA test environment (deferred, not blocking the POC).

**Open design decision, not a blocker**: whether to reinstate party-lookup
enrichment (`getPartiesByTypeAndID`/`putPartiesByTypeAndID`) now that the
capture analysis shows the data is present on `topic-event-audit` (item C1
in plan-outline.md's capture analysis). Currently out of scope by default,
matching the FSD. Nobody has decided either way yet.

---

## 5. Local dev environment — how to pick this up and run it

```
tazama-tms-1     localhost:5000   (docker ps to confirm; part of a larger
                                    local docker-compose Tazama stack,
                                    project name "tazama" — NOT the directory
                                    name "Full-Stack-Docker-Tazama", see the
                                    pitfall below)
valkey           localhost:16379  (same stack)
```

`mla/.env` and `ppa/.env` already point at these — unchanged since Phase 1,
see the older continue doc §6 for the full list of variables if needed.
**New this session, in both `ppa/.env.template` and `ppa/.env`** (the latter
gitignored, so this edit doesn't show in `git status` — mentioned here so it
isn't missed): `WRITE_AHEAD_DIR` (default `data/write-ahead`, also
gitignored), `PARK_SWEEP_ENABLED`, `PARK_SWEEP_INTERVAL_SECONDS`,
`PARK_SWEEP_THRESHOLD_SECONDS`. Defaults are fine to run with as-is.

**Everything in §3.5 has since been run live too, in §3.6** — a real
`node build/index.js` PPA process this time, not a standalone scratch
script talking directly to `CacheClient` (that was only how the atomic
merge itself was first checked). `/health/ready` genuinely reflects
`writeAheadStore.isReachable()` now - confirmed both directions, `UP` and
`DOWN`, live.

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

**`QUOTING=true` is now set on the shared stack** (`env/tms.env`, not
reverted after this session's run) — this is the correct, fuller-scope
config for this project's ongoing work, but it's worth knowing if anyone
else shares this local Tazama stack for other purposes: the `tms` service
was recreated with this flag flipped, and hasn't been flipped back.

⚠️ **Docker Compose project-naming pitfall, hit and resolved this session**:
the compose project actually running is named `tazama`, **not**
`full-stack-docker-tazama` (which is what compose infers from the directory
name `Full-Stack-Docker-Tazama` if you don't pass `-p` explicitly). Running
`docker compose -f [files] up -d --no-deps tms` **without** `-p tazama`
creates a stray second container and a stray second network instead of
touching the real running stack. If this happens again: `docker ps -a` and
`docker network ls` will show the stray `full-stack-docker-tazama-*`
artifacts; `docker rm -f` and `docker network rm` them, then retry with
`-p tazama` explicit. Always pass `-p tazama` when touching this stack from
compose.

**To rerun the live demo yourself**: the scratch replay script isn't saved
anywhere permanent — it required `mla/build/services/logic.service.js`
directly via Node and called `parseAuditMessage`/`buildEnvelope`/
`dispatchToPpa` in the causal order in §3.3 above, POSTing each resulting
envelope to the running PPA with a delay between steps so async
enrichment merges land before the next step reads state. Reconstructing it
is straightforward from that description.

---

## 6. Repository / git state

`poc-mla-ppa` is its own git repo. Check `git status --short` / `git diff
--stat docs/` before assuming anything about what's committed — as of this
session's work, changes are **not yet committed** (this session, like
Phase 1's, left everything staged/modified for the user to review and
commit on their own timeline). **Don't commit unprompted** — wait for the
user to ask, per standing instructions.

Files touched in the session that closed Phase 3 (beyond what's listed in
§3.1 already): both doc files (`MLA-PPA-Technical-Design.md`,
`plan-outline.md`), all test files listed in §3.2, and — outside this repo
entirely — `/home/abdul-rahim/tazama/Full-Stack-Docker-Tazama/env/tms.env`
(shared infrastructure, explicitly authorized).

**Files touched in the later session covered by §3.5** (atomic merge +
durable store):

| File | What changed |
| --- | --- |
| `ppa/src/clients/cache.ts` | `mergeState` (new, replaces `saveState`), `getState` rewritten for the hash format, `listNearExpiryKeys` (new) |
| `ppa/src/clients/write-ahead.store.ts` | Full rewrite: every method real (filesystem), three new methods (`parkPendingTrigger`/`retrievePendingTrigger`/`clearPendingTrigger`) |
| `ppa/src/services/logic.service.ts` | `mergeEnrichment` rewritten; `parkExpiringState`/`retrieveParkedState` implemented for real; new `resolveLateOrEarlyState`/`resolveNotificationState`/`completeParkedTrigger`; `processEnvelope` wired with the out-of-order block |
| `ppa/src/services/park-sweep.service.ts` | **New file** - `sweepExpiringState`/`startParkSweep`/`stopParkSweep` |
| `ppa/src/interfaces/event-envelope.ts` | New `MergeableStateField` type |
| `ppa/src/config.ts` | New `WriteAheadConfig`/`ParkSweepConfig`, `validateConfiguration` |
| `ppa/src/index.ts` | Wires `startParkSweep`/`stopParkSweep` into boot/shutdown |
| `ppa/.gitignore`, `.env.template`, `.env` | New `data/write-ahead/` ignore, new env vars (`.env` itself is gitignored - won't appear in `git status`) |
| `ppa/__tests__/cache.test.ts` | **New file** (Phase-3 session had none) - `mergeState`/`getState`/lifecycle/`listNearExpiryKeys` |
| `ppa/__tests__/write-ahead.store.test.ts` | **New file** - the durable store against a real temp filesystem |
| `ppa/__tests__/park-sweep.service.test.ts` | **New file** - the sweep against `ioredis-mock` + a temp-dir store |
| `ppa/__tests__/logic.test.ts` | `acceptEnvelope`, `parkExpiringState`/`retrieveParkedState`, `completeParkedTrigger`, the full out-of-order `processEnvelope` matrix |
| `docs/MLA-PPA-Technical-Design.md` | Updated for the atomic-merge item at the time (§3.4, §5.1/§5.2, §7.4) |
| `docs/plan-outline.md` | Updated for the atomic-merge item and the (then not-yet-live-verified) durable-store/persist-and-retrieve/out-of-order work |

**Files touched again in the live-verification session covered by §3.6**
(bug fixes only - no new files this round):

| File | What changed |
| --- | --- |
| `ppa/src/services/logic.service.ts` | `completeParkedTrigger` → `completeParkedTriggerAfterPrepare`, moved to fire only after a successful `pacs.008` send, not from `mergeEnrichment`; new `isReplay` parameter threaded through a new `processEnvelopeInternal`, with `processEnvelope` now a thin public wrapper keeping the old signature for every existing caller |
| `ppa/__tests__/logic.test.ts` | `completeParkedTrigger` tests rewritten against the corrected trigger condition (via `processEnvelope`'s prepare-success path, not `mergeEnrichment`); new dedup regression test for the `isReplay` fix |
| `docs/MLA-PPA-Technical-Design.md` | Now updated for the durable-store/persist-and-retrieve/out-of-order work too (§3.7, §5.1-§5.3, new §7.5) - deferred from the previous session specifically until this one live-verified it |
| `docs/plan-outline.md` | Phase 2/4 checklists moved from 🔨 to ✅, both bugs and the live-verification account added to "Current status" |
| `docs/continue/continue - after all 4 msgs.md` | This file - §3.5/§3.6/§4/§5/§6 updated to match |

Nothing from any of the three sessions is committed. **Don't commit
unprompted** — wait for the user to ask, per standing instructions.

---

## 7. Conventions worth knowing before writing more code

- **Fixtures come from real captures, never hand-written.** This session's
  new QUOTE fixtures follow that rule — sourced from the same
  `01_MWK_to_ZMW_PRIMARY` capture already in use, not synthesized.
- **Lint bar: 0 errors, warnings OK.** This session hit and fixed two real
  lint errors along the way (not warnings): `toPain013` originally took 5
  params (`max-params` caps at 4) — fixed by bundling `fspiopSource`/
  `fspiopDestination` into a `headers: {...}` object; `processEnvelope`'s
  cyclomatic complexity hit 19 against a max of 15 — fixed by extracting
  four helper functions, landing at 0 warnings.
- **Formal docs (Technical Design) state facts directly** — no "earlier
  drafts said X" narration. **`plan-outline.md` is the deliberate
  exception** — it's an explicitly-styled live status tracker that narrates
  each session's findings in first-person-adjacent past tense ("this run
  caught...", "confirmed live..."). Both conventions were followed
  correctly this session; don't flatten plan-outline.md's narrative style
  to match the Technical Design's, that would fight its stated purpose.
- **Section references in code comments** (`§2.2a`, `§3.2`, etc.) point at
  `MLA-PPA-Technical-Design.md`. New this session: `iso20022.ts` and
  `tazama-schema.validator.ts` both carry these references — keep the
  pattern going.
- **When a design decision changes, update the doc, not just the code.**
  This session is itself an example: `classify()`'s QUOTE role changed from
  `Enrichment` to `Trigger`, and both the Technical Design (§3.3) and
  plan-outline.md (Phase 2's classify checklist entry) were updated to
  match, not just the code.
- **Run the test suite in its default parallel mode, not just
  `--runInBand`, before trusting it** — §3.5's real concurrency bug
  (temp-file collision in the write-ahead store) only reproduced under
  parallel jest workers; it passed cleanly, every time, under
  `--runInBand`. Any new store/client that does real I/O and might be
  touched from more than one place concurrently deserves at least a few
  repeated parallel full-suite runs before being called done, not one green
  run.
- **`processEnvelope`'s complexity gets re-extracted, not just tolerated,
  every time new branching lands in it** — happened at the end of Phase 3
  (four helpers, 19→under 15), again in §3.5 (`resolveNotificationState`,
  17→under 15), and twice more in §3.6 fixing the two live-caught bugs
  (`completeParkedTriggerAfterPrepare`, then the `isReplay` plumbing - the
  second time needed splitting the public wrapper from the real
  implementation, since a *default parameter* also costs a complexity
  point each, not just a branch). If a future change pushes it over 15
  again, extracting a helper is the established fix here, not a
  `// eslint-disable` comment.
- **Trace a multi-envelope replay scenario all the way through by hand
  before trusting mocked unit tests for it, when the thing under test is
  itself an interaction across several async stages.** §3.6's two bugs
  are the concrete example: the unit tests for
  `completeParkedTrigger`/`isDuplicateNotification` each mocked their one
  function's inputs directly and passed - neither test could have caught
  either bug, because both bugs were about the *sequencing* between two
  separate `processEnvelope` calls (a parked trigger replaying itself, a
  notification's own prior dedup claim), which only a real multi-step
  replay exercises. Reasoning through the exact replay order before running
  it live is what caught bug 1 before ever touching a live process; running
  it live is what caught bug 2, which the reasoning pass missed.

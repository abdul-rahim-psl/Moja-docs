# Plan Outline — MLA & PPA

Working checklist for `poc-mla-ppa`. Tracks what is built, what is next, and
what is blocked on decisions outside this repository.

**Companion documents:** [`MLA-PPA-Executive-Summary.md`](MLA-PPA-Executive-Summary.md),
[`MLA-PPA-Technical-Design.md`](MLA-PPA-Technical-Design.md),
[`MLA-PPA-Development-Blockers_v1.0.md`](MLA-PPA-Development-Blockers_v1.0.md)
**Normative sources:** `CCH_FSD_MessageIngestion_v4.0.md` (CCH-PL-FSD-MSGING-001) for
component internals; `Integration_and_Interface_Document_v4.0.md` for the
cross-boundary contracts. Where the two disagree, this plan follows the FSD —
the divergences are tabulated at the top of the technical design document.

| | |
| --- | --- |
| ✅ | Done and verified |
| 🔨 | Scaffolded — signature and call site exist, body is a marked `TODO` |
| ⬜ | Not started |
| ⛔ | Blocked on an open item (§ *Blocked work* below) |

---

## Current status — narrow vertical slice complete and verified live

**Phase 1 (MLA) is done. The narrow vertical slice — real captured records
through the MLA, through the PPA, translated, and accepted by a real Tazama
TMS — is built, tested, and independently run against live local
infrastructure.** Not a mocked demonstration: `tazama-tms-1` (`docker ps`
confirmed it running, `POST /v1/evaluate/iso20022/pacs.008.001.10` and
`.../pacs.002.001.12` both mounted and reachable at `localhost:5000`) and the
stack's own `valkey` (`localhost:16379`) were used directly.

**What was actually run, in order, using real records from
`DRPP_Kafka_E2E_Pack/01_MWK_to_ZMW_PRIMARY`** (not synthetic payloads):
`postQuotes` → `postFxQuotes` → `putFxQuotesByID` (three enrichment records,
merged into ValKey correlation state) → `prepareTransfer` (**trigger**,
translated to `pacs.008.001.10`, sent to TMS) → `commitTransfer` (**trigger**,
translated to `pacs.002.001.12`, sent to TMS). Both `pacs.008` and `pacs.002`
came back `200` from TMS's own AJV schema validation, both flagged
`degraded: false` — the party identity in `Dbtr`/`Cdtr` came from the real
merged quote data (`Firstname-Test Lastname-Test`, `Chikondi Banda`), not the
placeholder fallback, confirming cross-stage enrichment (§6.4.3) actually
works against real data, not just in the unit tests.

**One real defect was caught by this run and fixed, not glossed over:** the
first attempt sent `pacs.008` without `RgltryRptg`/`RmtInf`/`SplmtryData` —
fields `ppa-prototype`'s original, TMS-verified transform included but this
port initially dropped. TMS rejected it (`400`, `must have required property
'RgltryRptg'`). Fixed in `ppa/src/services/iso20022.ts` by restoring those
fields from `ppa-prototype`'s proven shape; the second run succeeded. Left in
here deliberately as the point of running against a live TMS instead of only
trusting the port.

**A second, earlier run without the FX-quote enrichment records correctly hit
`isDomesticTransfer`'s discard path** — `prepareTransfer` alone, with no
correlated FX-quote state, is legitimately indistinguishable from a domestic
payment (§6.4.6), so the PPA discarded it exactly as designed rather than
emitting a `pacs.008`. Not a bug; evidence the discriminator works.

Full detail, all 45 passing tests (21 MLA + 24 PPA, all against real capture
data, no hand-written fixtures), and what is still stubbed is in the Phase
1–3 checklists below.

**COMESA-side test environment (Blocker 2) remains deferred, not blocking**
— unchanged from before this run; see
[`MLA-PPA-Development-Blockers_v1.0.md`](MLA-PPA-Development-Blockers_v1.0.md)
for the standing detail on deployment-stage requirements this POC still
doesn't need.

**Since that run: Phase 3 widened to all four message types, local ajv
validation is pinned, and both are now live-verified too.**
`pain.001.001.11`/`pain.013.001.09` (Quote request/callback triggers) are
built and unit-tested alongside `pacs.008`/`pacs.002` — `QUOTE` is classified
as trigger *and* enrichment (`classify()`, `processEnvelope`), matching the
FSD's §6.4.1 model exactly. A pinned local copy of `tms-service`'s own ajv
schemas (commit `f18317f1f7973623157e1467da78e6853c7b1b89`) now validates
every outbound message before it's sent — resolving the "pin a commit" open
item — and this validator caught a real gap on the first pass (`toPain001`
was missing a second, transaction-level `SplmtryData` block the schema
requires) before it ever reached a live TMS, the same class of catch the
`RgltryRptg` miss above was. Test count is now **56** (21 MLA + 35 PPA).

**Live-verified in a follow-up run, closing the gap the previous pass left
open.** The local stack's `tms-service` was recreated with `QUOTING=true`
(`env/tms.env` in the compose project, `tms` service only — nothing else in
the stack was touched), confirmed live (`POST .../pain.001.001.11` moved
from `404` to `400` — mounted, just an empty-body validation miss). The same
real capture was replayed through the actual compiled code — `postFxQuotes`
→ `putFxQuotesByID` → `postQuotes` → `putQuotesByID` → `prepareTransfer` →
`commitTransfer` — via real `parseAuditMessage`/`buildEnvelope`/`dispatchToPpa`
calls against a running PPA, not mocks. **All four message types came back
`degraded: false`** — `pain.001`, `pain.013`, `pacs.008`, `pacs.002` —
confirmed independently on the TMS side too: `tazama-tms-1`'s own container
logs show `Start`/`End - Handle Pain001/Pain013/Pacs008/Pacs002 request` for
each, with the correct deterministic `MsgId`, each forwarded to
`event-director`. Full account in Technical Design §7.3.

**Since that run: the first item on the next-steps list below is now closed
— `mergeEnrichment` got its atomic compare-and-merge.** The plain
GET-mutate-SET `saveState` used to do is gone, retired rather than left next
to its replacement. Correlation state is now a Redis hash
(`correlation:<id>`), one field per enrichment slot, and
`CacheClient.mergeState` merges exactly one field per call as a single Lua
script - `HSETNX` for idempotent leg creation, `HSET` for the field plus
`correlationId`/`updatedAt`, `EXPIRE` to refresh the TTL - so application
code never GETs the state at all, and the two-replicas-lose-an-update race
§3.4 describes has nowhere left to happen. Verified at two levels: a new
`__tests__/cache.test.ts` runs the actual script against `ioredis-mock`,
which executes real Lua (via `fengari`), not a stub - test count is now
**70** (21 MLA + 49 PPA, up from 56); and, going further than the unit
tests, a live smoke run against the real `tazama-valkey-1` container
(`localhost:16379`, db 1) merged five different fields onto one leg
concurrently and confirmed all five landed, `createdAt` stayed fixed across
a later merge while `updatedAt` refreshed, and `deleteState` removed the
whole hash. Full account in Technical Design §3.4 and §7.4.

**Same session, continuing straight on to the next item: the durable store
is real now, and persist-and-retrieve plus out-of-order handling are wired
in.**
`ppa/src/clients/write-ahead.store.ts` was a placeholder returning `true`/
no-oping on everything; it's now a genuine filesystem-backed store (one JSON
file per record, written via temp-file-then-atomic-rename), explicitly a POC
stand-in for whatever real backing technology the still-open
hosting-location decision picks later (Phase 4) - every call site goes
through this module's exported shape only, so that decision is a swap, not a
rewrite. `parkExpiringState`/`retrieveParkedState` in `logic.service.ts` are
real now too: a new background sweep (`ppa/src/services/park-sweep.service.ts`)
periodically scans ValKey (`SCAN` + batched `TTL`, new
`CacheClient.listNearExpiryKeys`) for legs close to their correlation TTL and
parks them - a leg still present in ValKey at all is sufficient reason,
since `finalize` already deletes it the moment a leg completes, so nothing
the sweep finds can be anything but incomplete. The confirmed-real
partition-split row (`04_ZMW_to_EGP_partition_split`, §3.7) is handled too,
not just the late-arrival one: a notification trigger with nothing in
ValKey and nothing parked now runs a short bounded retry (reusing the TMS
retry budget/backoff) before parking the trigger *envelope* itself, picked
back up once its own `pacs.008` has actually reached TMS (see the live-run
paragraph below for why that specific condition, not "state exists," is the
correct one). A `pacs.002` is never synthesised in the meantime, matching
§3.7's rule. **A real concurrency bug was caught along the way** - the
durable store's temp-file-then-rename write used a millisecond-timestamp
suffix, and two legitimate concurrent writes to the same destination (a
fresh `persist()` racing an earlier envelope's still-in-flight `complete()`)
could land in the same millisecond under real parallel-worker load, and the
loser's `rename` then failed `ENOENT` - fixed with `crypto.randomUUID()`.
New tests: `write-ahead.store.test.ts` (19, against a real temp filesystem),
`park-sweep.service.test.ts` (8, against `ioredis-mock` + a temp-dir store,
including the interval timer over real short waits), `cache.test.ts` +5
(`listNearExpiryKeys`), `logic.test.ts` +~20 (`acceptEnvelope` - previously
untested entirely - plus the out-of-order matrix).

**Live-verified in a follow-up run - and this is the run that actually
proved the design, not just the code.** All four checks from the
Immediate-next-steps list below were run for real against
`tazama-valkey-1`, a live PPA process, and the real local filesystem:
`/health/ready` correctly flips to `503`/`DOWN` when the write-ahead
directory is genuinely blocked, not hardcoded `UP`; a leg was watched
getting parked twice by the live sweep as its TTL approached; a PPA process
was `kill -9`'d immediately after acking a `QUOTE` pointed at an
unreachable TMS, and a *second, independent* process (fresh PID, fresh
module load) read the surviving `pending` WAL record off disk and completed
it correctly - genuine cross-restart durability, not an in-memory
coincidence. **The fourth check - replaying `04_ZMW_to_EGP_partition_split`
itself through the real compiled MLA code, settlement leg sent to the PPA
deliberately first - is what actually mattered, and it caught two real bugs
neither the unit tests nor the design review had:**

1. The first version replayed a parked notification the moment *any*
   enrichment merged in (`completeParkedTrigger` was called from
   `mergeEnrichment`) - not specifically once the leg's own `pacs.008` had
   reached TMS. In the live replay this sent `pacs.002` before `pacs.008`
   existed in Tazama's graph, and because a successful `pacs.002` clears
   ValKey state, the real `prepareTransfer` that arrived seconds later then
   read no state and got discarded as domestic - `pacs.008` never sent at
   all for a payment `pacs.002` already claimed was final. Fixed by moving
   the check to fire only after a successful `pacs.008` send
   (`completeParkedTriggerAfterPrepare`), folded into one guarded helper to
   keep `processEnvelope`'s complexity down rather than adding a bare
   condition to it.
2. With that fixed, the replayed `pacs.002` then got discarded as a
   *duplicate notification* - because its own first arrival (the one that
   got parked) had already claimed the step-4 dedup key, and replaying it
   re-ran the same check against its own prior claim. Fixed with a new
   `isReplay` flag threaded through `processEnvelope` (via a thin public
   wrapper so no existing caller needed to change) that skips the dedup
   check only for this internal replay path - a genuinely fresh duplicate
   arrival is unaffected and still correctly discarded, verified with a
   dedicated regression test.

Re-run after both fixes: the exact same replay produced `pain.001` →
`pain.013` → `pacs.008` → `pacs.002`, in that order, every one `degraded:
false`, corroborated on `tazama-tms-1`'s own container logs
(`Start`/`End - Handle {Pain001,Pain013,Pacs008,Pacs002} request`, correct
deterministic `MsgId`s) - and confirmed cleaned up afterward: the
pending-trigger record cleared, ValKey correlation state deleted by
`finalize`. Test count is now **120** (21 MLA + 99 PPA, up from 70 before
this session's two items; 96 immediately before this live-verification
round - the 3 more are the rewritten `completeParkedTrigger` block testing
the corrected trigger condition instead of the old buggy one, plus the
dedicated dedup regression test for bug 2). `npm run lint`: 0 errors -
`completeParkedTriggerAfterPrepare` and the `isReplay` plumbing each pushed
`processEnvelope`'s complexity back over 15 in turn; both were brought back
down the same way as before (extraction, plus splitting the wrapper from
the real implementation so only one function carries `isNotification`'s
default-parameter cost). Full account: Technical Design §3.4, §3.7, §7.5;
`continue/continue - after all 4 msgs.md` §3.5.

**Since that run: operator-triggered replay is built and live-verified —
Phase 4's last open item under "store is real" is closed.** `retrieveParked`
already proved a leg's state survives past ValKey's ~70s TTL; the missing
piece was a way for a human to actually use that 90-day window instead of
only the automatic path (`resolveLateOrEarlyState`, which only fires when a
notification happens to arrive). `CacheClient.restoreState` — a new Lua
script (`DEL` + `HSET` + `EXPIRE` as one EVAL, same reasoning as
`MERGE_STATE_SCRIPT`, a full snapshot replace rather than a merge since the
parked record already is the complete state to restore, not one field of
it) — and `operatorReplayParkedState` in `logic.service.ts` sit behind a new
`POST /admin/replay/:key` route: not-found (`404`) when nothing was ever
parked for that key, cache-disabled (`503`) when ValKey isn't in play,
restored (`200`) otherwise. `auditLog`'s signature was generalized from a
full `EventEnvelope` to `Pick<EventEnvelope, 'correlationId'>` so this
operator action — which has no envelope of its own — can audit-log through
the same path instead of fabricating one. **Live-verified**, not just
unit-tested: a leg's state was parked to the real filesystem write-ahead
store (simulating what the sweep does), confirmed absent from the real
`tazama-valkey-1` (db 1), then `POST /admin/replay/live-replay-demo-leg`
against a live PPA process returned `200 RESTORED` and the exact parked
snapshot — every field, including its original `createdAt`/`updatedAt`, not
regenerated — landed in ValKey with a fresh TTL (confirmed via
`HGETALL`/`TTL` on the container directly). Replayed a second time
immediately after: still `200 RESTORED`, confirming the read side
(`retrieveParked`) is genuinely non-destructive as designed. A replay of a
key nothing was ever parked under correctly returned `404`. Test count is
now **132** (21 MLA + 111 PPA, up from 120): `cache.test.ts` +5
(`restoreState`, against `ioredis-mock`'s real Lua VM), `logic.test.ts` +4
(`operatorReplayParkedState`), `ingress.test.ts` +3 (the route's
status-code mapping, end to end through a real `fastify.inject`). `npm run
lint`: 0 errors, unchanged.

**Since that run: the one specific live-verification gap Phase 2's exit
criterion had been carrying — a late notification actually retrieving a
swept-and-parked *state* (not a parked trigger) — is closed, live, not just
argued to be "correct by construction."** No new code: this was pure
live-verification work against a fast-configured local run
(`CORRELATION_TTL_SECONDS=8`, `PARK_SWEEP_INTERVAL_SECONDS=2`,
`PARK_SWEEP_THRESHOLD_SECONDS=6`, all env overrides for the demo only, not
new defaults). A real `putFxQuotesByID` capture record, built through the
actual compiled MLA pipeline (`parseAuditMessage`/`isCanonicalRecord`/
`buildEnvelope`, signature-checked, not fabricated), was posted to a live
PPA and merged FX-quote terms into a real ValKey entry; the PPA's own log
showed the sweep parking that exact leg three times as its TTL ran down,
and 15 real seconds later ValKey's `EXISTS` on the key confirmed it
genuinely gone. Only then was the matching real `commitTransfer` record
posted — the first and only message ever sent for this leg's settlement
side. It reached TMS as `pacs.002.001.12`, `degraded: false`, **51ms**
after being received: far too fast to have gone through the bounded ValKey
retry path (~1s minimum per attempt), which is the quantitative proof
`retrieveParkedState` resolved it on the first check, exactly the code path
this gap was about. Corroborated on `tazama-tms-1`'s own container logs.
Full account in Phase 2's exit criterion above. Test count and lint
unchanged — this closed a verification gap, not a code gap.

**Since that run: multi-replica confirmation is done — and it found a real
bug, the second time this project's "live-verify, don't just trust the
design" discipline has caught something the unit tests couldn't.** Two
genuinely independent PPA processes (`:3002`/`:3003`, separate write-ahead
directories, both pointed at the same real `tazama-valkey-1`) were fed five
real capture records for **one leg**, fired concurrently and alternated
across both replicas — `postFxQuotes`→`fxQuote`, `putFxQuotesByID`→
`fxQuoteCallback`, `postQuotes`→`quote` (trigger, fires `pain.001`),
`putQuotesByID`→`quoteCallback` (trigger, fires `pain.013`),
`prepareFxTransfer`→`fxTransfer` — built through the real compiled MLA
pipeline, not fabricated.

**First run: 3 of 5 requests came back `503 UNAVAILABLE`.** Not a merge
problem — `writeAheadStore.isReachable()` (the step-1 gate every request
runs) probed reachability by writing and unlinking a file with a **fixed
name**, `.probe`. Under genuinely concurrent requests to the same process
(three landed on replica A at once), one call's `unlink` beat another's,
and the loser hit a file that no longer existed - `ENOENT: no such file or
directory, unlink 'data/write-ahead-a/.probe'` - caught by the
catch-all and reported as "store unreachable" for a store that was
completely healthy. A real concurrency bug, invisible to every existing
test because none of them call `isReachable()` from two places at once.
Fixed the same way the WAL temp-file collision was fixed earlier
(`ppa/src/clients/write-ahead.store.ts`): `randomUUID()` suffix per probe
call instead of a shared fixed name. New regression test
(`write-ahead.store.test.ts`, 20 genuinely concurrent `isReachable()` calls
on one directory) plus a **second live run** against freshly rebuilt
replicas, from a clean state: **all 5 requests `200 ACCEPTED`**, and the
resulting ValKey hash carried every one of the five fields intact -
`quote`, `quoteCallback`, `fxQuote`, `fxQuoteCallback`, `fxTransfer` - none
clobbered, single `createdAt`, refreshed `TTL`. Both triggers reached TMS
(`pain.001` from replica A, `pain.013` from replica B), corroborated on
`tazama-tms-1`'s own container logs
(`Start`/`End - Handle Pain001/Pain013 request`, correct deterministic
`01KZRP0E6JT2BX5EA20AQPTX6F-pain001`/`-pain013` ids). **This is what Phase
6's "confirm the atomic merge holds with several PPA instances processing
events for the same payment concurrently" item asked for, now closed and
live-verified rather than "proven single-instance, assumed to generalise."**
Test count is now **133** (21 MLA + 112 PPA, up from 132): +1, the
`isReachable` concurrency regression test above. `npm run lint`: 0 errors,
unchanged.

**Since that run: all of Tier 2 (continue.md's "operability essentials") is
done and live-verified** — `correlationId` propagation, minimal metrics, and
circuit breakers on both hops.

**Item 4, `correlationId` propagation audit.** Not just a documentation
pass — it found and fixed two real gaps. `sendToTms`'s five log lines
carried only `messageType` ("TMS accepted pacs.002.001.12"), nothing
identifying *which* payment — exactly the ambiguity the multi-replica
concurrency check just above lived through directly (two concurrent
triggers, indistinguishable in the log without cross-referencing
timestamps). Fixed: `sendToTms` now takes `correlationId` as a required
third parameter, threaded from `processEnvelope`'s call site, and every log
line includes it. On the MLA side, `handleMessage`'s pre-`buildEnvelope`
logs (an unsigned canonical record, a failed envelope build) dropped the
identifiers already sitting in `record.metadata.trace.tags` at that point —
fixed with a new `logIdentifierFor` helper (deliberately simpler than
`resolveAnchorId`: no `quoteIdToAnchor` chain lookup, just a best-effort
label for a human reading logs). **Live-verified**: a real `postQuotes`
record posted to a live PPA produced `TMS accepted
01M0SBEDCVJ6RYVBQW2X5ENNDZ/pain.001.001.11` in the process log, correlationId
and all.

**Item 5, minimal metrics.** A new `metrics.service.ts` — in-memory
counters for TMS outcomes, degraded/failed translations, domestic/duplicate
discards, the four out-of-order outcomes, and legs the sweep parks — behind
a new `GET /metrics` route, JSON rather than Prometheus exposition format
since this is for a reviewer to look at directly, not a scrape target the
local stack has nowhere to point yet. Wired into every real branch point in
`processEnvelope`/`parkExpiringState`/`resolveLateOrEarlyState` that already
decided these outcomes — not a parallel bookkeeping system, just counting
what the pipeline was already deciding. **Live-verified**: a real domestic
prepare and a real degraded `postQuotes` posted to a live PPA moved
`/metrics` from all-zero to `{discarded.domestic: 1, tms.accepted: 1,
translation.degraded: 1, derived.degradedRatePercent: 100,
derived.domesticDiscardRatePercent: 50}`, corroborated on TMS's own logs.

**Item 6, circuit breakers on both hops (Technical Design §3.8, §2.6).**
The design already fully specified both: PPA→TMS "circuit-break on
sustained failure" (§3.8); MLA→PPA "pause consumption on the affected
partition(s) entirely and re-probe PPA health on a timer" (§2.6). Neither
existed — `KafkaConsumerClient.resume` was defined but **never called
anywhere**, so a paused MLA partition stayed paused forever with no way
back, and every PPA→TMS message during an outage independently burned its
full 3-retry backoff budget rather than failing fast once TMS was known to
be down.

Built both, minimally: `ppa/src/clients/circuit-breaker.ts` is a standard
closed/open/half-open state machine (single-EVAL-free, no ValKey — one
replica's own connection health, in-memory by design), wired into
`sendToTms` so `allowRequest()` gates the call before the retry loop even
starts. A 4xx counts as success (TMS answered correctly — it's the message
that's bad, not TMS's health), so a run of invalid messages during a
healthy period can never trip it; only exhausting the retry budget
(network failure or persistent 5xx) counts as a failure. State surfaced in
`/metrics` (`tmsCircuitBreakerState`). On the MLA side,
`mla/src/services/circuit-breaker.service.ts` pairs the existing
pause-on-exhaustion with the missing half: a periodic `GET /health/ready`
probe (new `PpaClient.isReady()`) that resumes every partition the trip
paused the moment PPA answers healthy again — `tripAndPause` replaces the
bare `consumerClient.pause` call `handleMessage` used to make.

**Live-verified on both hops, each through its full lifecycle, without
touching the shared local Tazama stack** (a small self-controlled mock TMS
server stood in for TMS specifically so the real `tazama-tms-1` container
didn't need to be taken down to simulate an outage):
- **PPA→TMS**: two real messages against a down mock TMS each retried and
  exhausted (`TMS returned 500 ... attempt 1/2`), tripping the breaker
  (`TMS_CIRCUIT_FAILURE_THRESHOLD=2` for the demo). A third message then
  failed fast — `TMS circuit breaker open - failing fast ... not attempting
  delivery`, zero TMS calls, confirmed via `/metrics`
  (`tmsCircuitBreakerState: "open"`). The mock TMS was flipped healthy, the
  cooldown (3s) elapsed, and a probe message succeeded and closed the
  breaker (`tmsCircuitBreakerState: "closed"`, `tms.accepted: 1`) — the full
  closed→open→fail-fast→half-open→closed cycle, live.
- **MLA→PPA**: `dispatchToPpa` against a genuinely unreachable port produced
  a real `ECONNREFUSED`, retried once, and tripped `tripAndPause`
  (confirmed via a real pause call). Three real seconds of the re-probe
  timer ticking against the still-down port correctly did **not** resume
  anything. A real PPA process was then spawned on that port, and within
  one real re-probe interval (~1s) the timer detected it healthy and called
  `resume` — genuine network-based recovery detection, not a simulated
  timeout.

New tests: PPA `circuit-breaker.test.ts` (9, the state machine itself,
100% coverage), `metrics.service.test.ts` (8, 100% coverage), plus wiring
tests in `logic.test.ts` and a `GET /metrics` round-trip in `ingress.test.ts`.
MLA `circuit-breaker.service.test.ts` (6) plus a `handleMessage` wiring test
confirming the `Pause` path now goes through `tripAndPause`, not a bare
`consumerClient.pause`. Test count is now **167** (29 MLA + 138 PPA, up
from 133). `npm run lint`: 0 errors on both packages.

**Since that run: Tier 3 item 1 (continue.md's item 7) is done — the
scratch replay script every prior live-verification session reconstructed
from scratch, and threw away, is now a saved, checked-in tool.**
`mla/src/scripts/demo-replay.ts`, run as `npm run demo:replay -- <capture
folder-or-file>`: real `parseAuditMessage`/`isCanonicalRecord`/
`classifyEventType`/`hasFspiopSignature`/`buildEnvelope`/`dispatchToPpa` —
the actual compiled MLA pipeline, not a re-implementation — against one
capture file, sequentially, printing each record's stage, skip reason, or
dispatch outcome. Standalone by design: no Kafka offset or broker involved,
`dispatchToPpa`'s ADVANCE/PAUSE decision is printed rather than acted on.
Accepts either a capture folder (`<path>/raw_messages.json`) or a direct
file path, so it can already point at `raw_topic_slice_partition2.json`
once that's picked up (Tier 3 item 2, next).

**Live-verified by using it for real**, not just built: `npm run demo:replay
-- <path to 01_MWK_to_ZMW_PRIMARY>` against a live PPA correctly skipped
every non-canonical/out-of-scope record, dispatched all seven canonical
in-scope ones in order, and produced the exact same `pain.001`/`pain.013`/
`pacs.008`/`pacs.002` sequence this project's prior manual sessions
produced by hand - corroborated on `tazama-tms-1`'s own logs. 7 dispatched,
13 skipped, 20 total, one command.

**The tool paid for itself immediately - a real, previously-uncaught gap
surfaced on this very first run.** Record `[14]` (`reserveFxTransfer`/
`egress`, the canonical record for the FX-transfer settlement leg's
callback) failed `buildEnvelope`: `could not resolve an anchor identifier`.
Its tags genuinely carry no `transactionId`/`transferId`/
`determiningTransferId` - only `commitRequestId`/`conversionId` - and
`resolveAnchorId` has a chain fallback for exactly this situation on
`QUOTE` (`quoteId -> anchor`, §2.3) but not on `FXTRANSFER`. **Impact
today is low, not zero**: `TransactionState.fxTransfer` is round-tripped
through `cache.ts` but genuinely read by nothing downstream yet (checked:
neither `isDomesticTransfer` nor any `translate()` path touches it) - but
the record is silently dropped with an error log on every real
cross-border transaction's settlement leg regardless, and the gap would
matter the moment anything starts relying on that field. **Flagged, not
fixed** - surfaced to the user for a scoping decision rather than expanding
this session's scope past the one item asked for.

New file: `mla/src/scripts/demo-replay.ts`. New npm script:
`demo:replay`. No test changes - this is a CLI tool exercising already-
tested functions, not new pipeline logic; its own correctness was proven
by the live run above, matching how the tool itself is meant to be used.
`npm run lint`: 0 errors.

**Since that run: the user chose to fix the `reserveFxTransfer` gap
immediately (Tier 1.5) rather than defer it, and it's done and
live-verified — see Phase 1's `buildEnvelope` checklist item above for the
full account.** Same fix shape as `putQuotesByID`'s `quoteId` chain: a
bounded `commitRequestId`/`conversionId → anchor` map, populated when
`prepareFxTransfer` is processed. Re-running `demo:replay` against the same
capture that first surfaced the gap now dispatches record `[14]` instead of
throwing, confirmed accepted by a live PPA
(`{"outcome":"merged","role":"CORRELATION_ONLY"}`). Test count is now **168**
(30 MLA + 138 PPA, up from 167). `npm run lint`: 0 errors.

**Since that run: Tier 3 item 2 is done — the interleaved partition-2 slice
is a real, checked-in regression fixture, and confirmed live as `demo:replay`
was already built to handle.** `raw_topic_slice_partition2.json` (668 KB, 41
records) copied verbatim into `mla/__tests__/fixtures/` — the first fixture
in this repo not curated down to a handful of records, and the first place
any test exercises `buildEnvelope`'s anchor-chaining maps
(`quoteIdToAnchor`, `fxTransferIdToAnchor`) across **more than one
transaction sharing the same process-lifetime cache**, which the 8-10 record
fixture set (one transaction's worth) structurally can't. New file:
`mla/__tests__/partition2-slice.test.ts`, 3 tests — full-slice classification
count (15 dispatchable, 26 skipped, no unexpected throws), and two dedicated
chain-correctness tests confirming a second transaction's
`reserveFxTransfer`/`putQuotesByID` resolution doesn't collide with or bleed
from a first transaction's chain entries.

**Live-verified first, exactly as the plan called for** (`npm run demo:replay
-- .../raw_topic_slice_partition2.json` against a live PPA, no plumbing
needed — it already accepted a raw file path): 15 dispatched, 26 skipped,
matching the automated test exactly; the PPA's own log confirmed every
dispatched record's outcome, including one instructive non-bug — one leg's
`commitTransfer` was correctly discarded as `"duplicate notification"`
because that same transaction (`01KZRP0E...`, shared with
`01_MWK_to_ZMW_PRIMARY`) had already had its `pacs.002` genuinely sent to TMS
earlier in this session's `reserveFxTransfer` verification run; ValKey's
sent-dedup guard (its own key/TTL, separate from correlation state) correctly
caught the cross-run duplicate. Confirmed by checking the write-ahead
store's `parked/` folder afterward: exactly that leg's state, parked by the
sweep because `finalize()` never got a terminal message to clear it on.
Cleaned up afterward: PPA process killed by exact PID, local write-ahead
directory wiped. **ValKey's own correlation/dedup keys were left to expire
on their normal TTL rather than deleted directly** — `docker exec` into
`tazama-valkey-1` is blocked in this sandbox (confirmed: `docker ps` works,
`docker exec` does not, even with the sandbox override), so nothing beyond
inspecting local files was available; the state is synthetic demo data on a
short TTL, not a cleanup debt.

**Also corrected while replaying it, not just used as-is**: this slice's
"four transactions interleaved" description (§ *Capture analysis*, this
item's own original framing) turned out to be imprecise on inspection — it's
**three** transactions (two complete, one truncated at its second record),
and each one's records are fully sequential within the slice, not
alternating with each other record-by-record. "Interleaved" now means what
it always should have: multiple transactions sharing one raw partition
stream, unlike the pre-filtered per-transaction folders — corrected in the
*Capture analysis* section and its comparison table rather than left to
disagree with a closer look. Test count is now **171** (33 MLA + 138 PPA, up
from 168). `npm run lint`: 0 errors. `npm run build`: clean.

**Since that run: Tier 3 item 3 is done — a basic local load/soak run
against the real pipeline, sustained rather than a single pass.** New tool,
`mla/src/scripts/demo-loadtest.ts` (`npm run demo:loadtest -- <capture>
[durationSeconds] [concurrency]`), built on the same real functions
`demo-replay.ts` uses. Each concurrent "transaction" is a fresh clone of one
real capture, with only its id-bearing trace tags (the same three groups
`resolveAnchorId`'s chains use, §2.3) rewritten to fresh ULIDs — everything
downstream (ValKey correlation state, the sent-dedup guard, TMS's own
`MsgId`/`PmtId`) keys entirely off those tags via `translate()`'s
`messageId(anchor, ...)`, never off `content.payload`, so this reliably
produces many distinct, realistic transactions from one template without
needing more capture data. Body content repeats across iterations — a
documented scope choice (real content at volume, not fabricated variety),
not an oversight.

**Live-verified with a real 30-second run at concurrency 5** against the
local Tazama stack: 1,059 synthetic transactions, 8,472 accept-and-persist
calls, **zero** failures, TMS circuit breaker stayed closed throughout.
Accept-and-persist latency (§6.3 steps 1-2, what actually gates Kafka offset
back-pressure) - p50 15.5ms, p95 31.3ms, p99 45.9ms, max 82.8ms. Drained
`/metrics` confirmed the full pipeline kept up, not just the fast ack path:
4,236 real messages reached TMS (`translation.degraded` 918 +
`notDegraded` 3318 = `tms.accepted` 4236, exactly), corroborated by
`tazama-tms-1`'s own container logs (`docker logs`, not `docker exec` -
see caveat below) showing matching `Start`/`End - Handle
{Pain001,Pain013,Pacs008,Pacs002}` volume, zero errors/exceptions in that
window, and the PPA still reporting `/health/ready: UP` afterward.

**Two genuine, non-obvious findings along the way, both explained and
resolved rather than shrugged off:**

1. The tool's first run showed `/metrics` undercounting relative to the
   audit log's own "sent" outcomes, immediately after the run finished. Not
   a lost update (`counters.tms[outcome] += 1` is a synchronous, single-
   threaded increment - provably atomic) - `app.controller.ts` (§6.3 steps
   1-2) acks an envelope and returns `200` *before* `processEnvelope` (steps
   3-10: translate/dedup/send-to-TMS/metrics) runs, deliberately
   fire-and-forget on the request path. So a `/metrics` snapshot taken the
   instant the last request acks can catch a handful of those background
   pipelines still finishing. Fixed by polling `/metrics` until its totals
   stop moving before reporting a final snapshot, rather than reading it
   cold - confirmed correct: the drained snapshot's `translation` and `tms`
   totals now match exactly, every time.
2. That same finding corrected what "latency" this tool was actually
   reporting: accept-and-persist latency, not full-pipeline latency. Framed
   explicitly as such in the tool's own output - which turns out to be the
   more relevant number for this item's actual question anyway (does the
   write-ahead store and reachability gate hold up under sustained load,
   the exact mechanism Kafka offset back-pressure depends on), not a
   downgrade.

**Cleaned up afterward**: PPA processes killed by exact PID, local
write-ahead directory wiped between runs. ValKey's own correlation/dedup
keys were left to expire on their normal TTL, same caveat as Tier 3 item 2 -
`docker exec` into `tazama-valkey-1` is blocked in this sandbox, though
**`docker logs` is not** (confirmed working here, a correction to that
earlier caveat's blanket phrasing - only `exec` is restricted). No test
changes - like `demo-replay.ts`, this is a CLI tool exercising already-
tested functions; its own correctness was proven by the live run. `npm run
lint`: 0 errors. `npm run build`: clean.

**This closes out Tier 3 entirely. Since that run: Tier 4 item 1 is done and
live-verified — the PPA has a real audit log store, replacing the structured
log line that used to stand in for it.** New file
[`ppa/src/clients/audit-log.store.ts`](../ppa/src/clients/audit-log.store.ts),
same shape as `write-ahead.store.ts` on purpose (Phase 4's item, § below) —
one JSON file per record, written temp-file-then-atomic-rename — but
append-only: every `auditLog` call for a payment's life gets its own file,
filed under a directory named for the payment's own anchor id
(`TransactionState.key`/`EventEnvelope.id`), not the MLA-generated
per-message `correlationId` each individual event carries. That indexing
choice is what makes "what happened to this payment" answerable at all: a
leg's life spans many messages, each with its own fresh `correlationId`
(`ulid()`-generated on the MLA side, confirmed by inspection), so indexing
on that instead would have given a trail of length one for almost every
lookup.

`auditLog`'s signature widened from `Pick<EventEnvelope, 'correlationId'>`
to also accept an optional `id` — every real pipeline call site already
had an `EventEnvelope` in hand and gets the new indexing for free; the one
caller that didn't (`operatorReplayParkedState`, which audits with only a
`TransactionState`) now passes its `key` explicitly. A new
`GET /admin/audit/:key` route (`AuditHandler`, mirroring `POST
/admin/replay/:key`'s existing shape) exposes the read side
(`getAuditTrail`) — `404` when nothing was ever recorded for that key,
`200` with every entry, oldest first, otherwise. Writes are deliberately
best-effort: a failure inside `auditLogStore.append` is caught and logged,
never thrown, because by the time `auditLog` runs at the tail of
`processEnvelope` the payment's real outcome has already happened — a full
disk on this store must not turn an otherwise-successful send into an
unhandled rejection. Not wired into `/health/ready`, for the same reason:
this is observability on a completed outcome, not a gate on accepting new
work.

**Live-verified against the real local stack, not just tested.** `npm run
demo:replay` replayed the full `01_MWK_to_ZMW_PRIMARY` capture (8
dispatched — one more than earlier sessions recorded, because the
`reserveFxTransfer` anchor-chain fix from Tier 1.5 is now in the path) 
against a live PPA. `GET /admin/audit/01KZRP0E6JT2BX5EA20AQPTX6F` then
returned all eight real entries, in order, on disk under that exact
directory: FX quote merged, FX quote callback merged, `pain.001` sent, FX
transfer merged, `pain.013` sent, FX transfer callback merged, `pacs.008`
sent, `pacs.002` sent — genuinely the full lifecycle of one real payment,
readable as one JSON response instead of grepped from stdout. Corroborated
independently on `tazama-tms-1`'s own container logs (`docker logs`,
`Start`/`End - Handle Pain001/Pain013/Pacs008/Pacs002 request`, matching
the four `outcome: "sent"` entries exactly) and `/metrics`
(`tms.accepted: 4`). A lookup for a key nothing was ever audited under
correctly returned `404`. Cleaned up afterward: PPA process killed by exact
PID, `data/write-ahead/` and `data/audit-log/` wiped.

New tests: `audit-log.store.test.ts` (6, real filesystem I/O — round-trip,
append-only accumulation, independent legs, 20 genuinely concurrent
appends with no filename collision, and a best-effort-on-failure
regression), `logic.test.ts` +5 (`auditLog`/`getAuditTrail` wiring —
including that a subject with no `id` is correctly *not* durably
recorded, and that `operatorReplayParkedState` audits under the leg id,
not the parked state's own `correlationId`), `ingress.test.ts` +2 (the
route's status-code mapping, end to end through a real `fastify.inject`).
Test count is now **184** (33 MLA + 151 PPA, up from 171). `npm run lint`:
0 errors. `npm run build`: clean.

**Since that run: Tier 4 item 2 is done and live-verified — a first pass at
PII masking, and this closes out Tier 4, and with it every tier in
`continue.md`.** New file
[`ppa/src/services/pii-mask.service.ts`](../ppa/src/services/pii-mask.service.ts):
a keyed HMAC-SHA256 (`maskIdentifier`) over party identifiers, `masked:`-prefixed
and truncated to 16 hex chars, keyed by a new `PII_MASK_KEY` (ships with a
loudly-warned POC-only default — see `.env.template`). Keyed rather than a
bare hash on purpose — an MSISDN's space is small enough to enumerate and
rainbow-table against an unkeyed hash trivially, the same reasoning the
FSD's own PII-protection component note makes about the fuller tokenization
component this isn't. Deterministic on purpose too: the same real person
masks to the same value every time, so an auditor can still tell "these two
records are about the same payer" without the audit trail ever recording
who that payer is.

**Genuinely partial, exactly as scoped going in** (`continue.md`'s own
framing) — not end-to-end, and not pretending to be: the ILP packet's
cryptographic binding still means party identifiers reach MLA/PPA/PPA→TMS
in cleartext inside `condition` regardless (Technical Design §2.1, the
still-blocked, much larger PII-tokenization item in Phase 5), and "what
went out" (the translated ISO/FSPIOP message TMS receives) is deliberately
still unmasked — TMS needs the real party data to build its transaction
graph. What this covers: the one place this pipeline had occasion to write
a party identifier into a log line or the audit log store —
`EventEnvelope.body.payer`/`.payee` on `QUOTE`-family records, the only
stage carrying `partyIdInfo`/`personalInfo` directly (§2.2a). `auditLog`'s
signature widened again (same pattern as widening it for `id` in item 1) to
optionally accept `body`; every real pipeline call site already had the
full envelope in hand, so masking is centralised in `auditLog` itself
rather than touched into each of its eight call sites individually.

**Live-verified against the real local stack**: `npm run demo:replay`
against a live PPA, then `GET /admin/audit/01KZRP0E6JT2BX5EA20AQPTX6F` — the
`pain.001` entry (the only stage carrying party data) came back with
`party: { payer: { id: "masked:7c1bb5fcba2a66c8", name: "masked:eb2d817e1ab8cb97" }, payee: {...} }`,
identical mask values to a separate unit-test run against the same real
MSISDN/name (confirming determinism holds across process restarts, not
just within one). Grepped both the HTTP response and the raw on-disk audit
files directly for the real MSISDN/names (`+265881234567`,
`+260976001234`, `Firstname-Test`, `Chikondi`, `Banda`) — zero matches in
either. TMS still received the real, unmasked party data as required
(`degraded: false`, corroborated on `tazama-tms-1`'s own logs) — masking
only touches the audit/log surface, never the outbound message.
`PII_MASK_KEY`'s absence correctly logged the POC-default warning exactly
once, at first use, confirmed in the live process's own log.

**A real, confirmed bug was caught and fixed along the way — in Tier 4 item
1's own store, not in this item's new code.** Writing this item's tests
(many rapid, sequential `auditLog` calls in one test) surfaced an
intermittent test failure: `GET /admin/audit/:key` occasionally returned
entries out of insertion order. Root cause, confirmed with a standalone
50-call deterministic repro before touching any code: `audit-log.store.ts`'s
filename scheme was `<Date.now()>-<randomUUID>.json`, and the header
comment's own reasoning was wrong — a random suffix guarantees no filename
collision, but does **not** preserve call order when two calls share the
same millisecond, which ordinary sequential `await`ed calls do routinely on
a fast machine, not just under contrived concurrency. The repro landed
roughly a third of 50 sequential entries out of order. **Fixed** by adding a
synchronous, per-process, strictly-increasing sequence number as the real
tiebreaker, assigned before the function's first `await` (so it reflects
true call order even across concurrent invocations) and placed *after*
`Date.now()` in the sort key, not instead of it — `Date.now()` stays
primary so ordering still survives a process restart mid-payment, which an
in-memory counter reset to zero would not. Re-ran the original 50-call repro
after the fix: exact insertion order, every time. New regression test,
`audit-log.store.test.ts`'s "two hundred sequential appends read back in
exact insertion order" (200 is comfortably past what reproduced it live).
Full `npm test` re-run 3 consecutive times clean after the fix (166 PPA
tests, 0 failures each run) to rule out any remaining flakiness — this bug
was intermittent by nature, so a single green run would not have been
convincing.

New tests: `pii-mask.service.test.ts` (11 — `maskIdentifier`'s determinism,
collision-avoidance, non-reversibility-by-inspection, and genuine keying;
`maskedPartySummary`'s extraction, partial-data, malformed-input, and
same-person-correlates handling), `logic.test.ts` +3 (`auditLog` attaches a
masked summary only when `body` is present; an end-to-end `processEnvelope`
run over a real `QUOTE` envelope shape proves the wiring holds from the
pipeline's real entry point), `audit-log.store.test.ts` +1 (the ordering
regression test above). Test count is now **199** (33 MLA + 166 PPA, up
from 184). `npm run lint`: 0 errors. `npm run build`: clean.

**Tier 4 is closed. Every tier `continue.md` tracked — Tier 1, Tier 2, Tier
3, and now Tier 4 — is done and live-verified.** What remains open,
project-wide, is exactly §2's still-blocked item (error-path translation,
blocked on COMESA) and the explicitly-excluded deployment-stage items
(§3's "Explicitly not on this list" in `continue.md`: mTLS both hops, the
Auth-lib→Keycloak token chain, Kubernetes manifests, and full PII
tokenization) — none of which this local POC environment can build or
verify against right now, the same reasoning that excluded them from every
tier so far.

### Immediate next steps, in order

1. ~~Live-verify the durable store, the park sweep, and out-of-order
   handling against the running local stack~~ - **done, see above.** Two
   real bugs found and fixed in the process, both now live-verified fixed
   too - not just unit-tested. No longer on this list.
2. ~~Operator-triggered replay for the durable store~~ - **done and
   live-verified, see above.** `POST /admin/replay/:key` restores a parked
   leg back into ValKey on demand. No longer on this list.
3. ~~Close the swept-and-parked-state live-verification gap~~ - **done, see
   above.** A late `commitTransfer` genuinely recovered from a parked copy
   after ValKey's TTL had actually lapsed. No longer on this list.
4. ~~Multi-replica confirmation~~ - **done, see above, and it found a real
   bug**: a fixed-name reachability-probe file that could collide under
   genuine concurrent requests to one replica, fixed with `randomUUID()`.
   Re-verified live after the fix on a clean run. No longer on this list.
5. **Error-path translation** (`pacs.002` with `TxSts: RJCT`) — untested since
   `DRPP_Kafka_E2E_Pack` contains no rejected transactions (§ *Capture
   analysis* C10). Unchanged by this session; still genuinely blocked on
   COMESA providing error-path captures, not just unstarted.

## Capture analysis — what the audit topic actually carries

Source: `DRPP_Kafka_E2E_Pack/` — topic **`topic-event-audit`**, five folders of
one transaction each (20 records apiece, all settling `COMM`), plus
`raw_topic_slice_partition2.json`, a contiguous unfiltered read of partition 2
(41 records). The slice is the realistic ingestion shape; the folders are
pre-filtered and flatter than production. **Corrected by Tier 3 item 2's live
replay** (§ *Current status*, and `mla/__tests__/partition2-slice.test.ts`):
the slice holds **three** transactions, not four (two complete, one truncated
at its second record), and within it each transaction's records are fully
sequential — offsets 76316–76331 are transaction 1 start-to-finish,
76332–76351 are transaction 2, with no record-level alternation between them.
"Interleaved" describes this slice holding multiple transactions in one raw
partition stream, unlike the pre-filtered per-transaction folders — not that
records literally alternate between transactions here.

### A. Open items the captures close

| FSD # | Question | Answer from the captures |
| --- | --- | --- |
| **7** | Does the audit topic preserve per-event identity? | **Yes — better than hoped.** `metadata.trace.tags.operation` is an explicit stage classifier with 13 distinct values. FX vs domestic needs no payload sniffing at all: the operation is literally `prepareFxTransfer` vs `prepareTransfer`. The FX-discrimination risk the FSD called the largest unknown does not exist on this topic. |
| **3** | Does `FSPIOP-Signature` survive into the Kafka event? | **Yes.** Real JWS signatures (~600–990 chars) on **15 of 20** records, at `content.headers.fspiop-signature`. Absent on the party `GET` (no body) and on quote/FX-quote **egress** records — present on their `start` counterparts. |
| **5** | Does the final-state event carry `fspiop-source`/`-destination`? | **Yes**, on both candidate triggers (`fulfilTransfer`, `commitTransfer`). `InstgAgt`/`InstdAgt` can be sourced as the FSD requires. |
| **4** | Where does the payee display name come from? | **The quote payload carries it.** `CdtTrfTxInf.Cdtr.Nm` in the ISO form, and `payee.personalInfo.complexName` in the FSPIOP `transformedPayload`. No `PUT /parties` dependency — and party lookup is on this topic anyway (see C1). |
| **2** | Scope of `topic-notification-event`? | **Superseded.** There is no separate notification topic in this architecture. The final state is the `commitTransfer` egress record on `topic-event-audit`, emitted by `ml-notification-handler`. |

### B. Envelope shape — different from the FSD's model

Records are Redpanda Console exports: `partitionID`, `offset`, `timestamp`,
`headers`, `key`, `value`. The business envelope is `value.payload`:

```
value.payload
├── id                        per-record UUID (audit record id, NOT a business id)
├── type                      "application/json"
├── content
│   ├── headers               full HTTP headers — fspiop-source/-destination,
│   │                         fspiop-signature, authorization, traceparent
│   ├── payload               the body (form varies — see B2)
│   ├── transformedPayload    FSPIOP equivalent, on quote-family records only
│   ├── dataUri               base64 ISO 20022 form, on transfer records
│   └── url / method / params on egress records
└── metadata
    ├── event.action          "start" | "egress"      ← the double-write
    └── trace
        ├── traceId           == Kafka message key
        └── tags              operation, transactionId, transferId, quoteId,
                              conversionId, commitRequestId, source,
                              destination, httpMethod, httpPath, serviceName …
```

This is **not** the `{from, to, id, content, metadata}` envelope
`ppa-prototype` consumed from the per-action topics, which is what the MLA's
current `buildEnvelope` stub is written against. That stub needs rewriting.

**B1. Business identifiers live in `metadata.trace.tags`, not just the body.**
13 of 20 records carry `transactionId` as a trace tag — including
`commitTransfer`, whose *payload* carries no business identifier whatsoever
(`GrpHdr.MsgId` is a fresh ULID; `TxInfAndSts` has no `OrgnlTxId`). Reading
identifiers from tags rather than payloads is both simpler and more reliable.

**B2. Message form is mixed, and both forms are often present at once.**
Quote-family records carry ISO 20022 in `content.payload` *and* FSPIOP in
`content.transformedPayload`. Transfer records carry FSPIOP in
`content.payload` *and* base64 ISO in `content.dataUri` — verified: the two
are different representations of the same step, not copies.

**Consequence: base64 decoding is optional, not a mandatory pipeline step.**
The FSPIOP fields the FSD's mapping wants are already plain JSON in
`content.payload`. Decode `dataUri` only if the ISO form is wanted.

**B3. The FSPIOP form is the better mapping source.** It matches the FSD's
field expectations directly and gives structured names
(`complexName.{firstName, middleName, lastName}`) where the ISO form gives a
semicolon-packed string (`Cdtr.Nm: "Chikondi;;Banda;"`).

**B4. The ISO on this topic is Mojaloop's ISO, not Tazama's.** Observed:
`IntrBkSttlmAmt.{ActiveCurrencyAndAmount, Ccy}` and `FinInstnId.Othr.Id` —
exactly the forms FSD §7 warns cannot be copied through. Tazama needs
`IntrBkSttlmAmt.Amt.{Amt, Ccy}` and `FinInstnId.ClrSysMmbId.MmbId`. The
translation step remains necessary; its *input* is now better understood.

### C. Behaviours that change the design

**C1. Party lookup is on this topic.** `getPartiesByTypeAndID` and
`putPartiesByTypeAndID` are stages 1–2 of every capture. The FSD states
plainly that ALS is HTTPS end-to-end and never publishes to Kafka, and removed
party-lookup enrichment on that basis (§6.4.1, §6.4.3). **That premise is
wrong for `topic-event-audit`.** Party data is available, whether or not we
choose to use it.

**C2. Every logical step is written twice — `start` and `egress`.** 20 records
for a 10-stage transaction. Nothing in the current design accounts for this,
and naive consumption would double every trigger. A rule for which of the pair
to act on is now mandatory. Complications:

- The pairing is not always 1:1 on `operation`. `fulfilFxTransfer` (start) is
  followed by `reserveFxTransfer` (egress); `fulfilTransfer` (start) is
  followed by *two* egress records, `notifyFxTransfer` and `commitTransfer`.
- `putPartiesByTypeAndID` has a `start` and no egress.
- The pack's README states `operation` is consistent across a start/egress
  pair; its own worked example contradicts this, and so does the data. Do not
  rely on that claim.

**C3. `transactionType` is unreliable as a classifier.** It disagrees across
the pair for the same step — `postFxQuotes` is `transactionType: quote` on
start and `fxquote` on egress. **Classify on `operation` only.**

**C4. The Kafka key is a traceId and is not transaction-scoped.** In this
capture each `traceId` covered two distinct transactions, and the settlement
leg is sometimes re-emitted under a *new* traceId. The key is unusable for
correlation or partitioning assumptions.

**C5. Transactions split across partitions — observed, not theoretical.** In
`04_ZMW_to_EGP_partition_split` the entire settlement leg (`fulfilTransfer`,
`notifyFxTransfer`, `commitTransfer`) lands on partition 10 while the first 17
records are on partition 7. Kafka orders only within a partition, so the
`pacs.002` trigger can genuinely precede its `pacs.008`. The FSD's
out-of-order handling and persist-and-retrieve are not defensive extras — they
are load-bearing on this topic. Reported as intermittent: 2 of the
transactions examined.

**C6. Only the three party-lookup records genuinely carry no usable
identifier** — `getPartiesByTypeAndID` (×2) and `putPartiesByTypeAndID` carry
`partyIdentifier` (MSISDN) alone, not the anchor and not a stage-local id.
**Correction to an earlier overclaim in this section:** `putQuotesByID`
(quoteId only) and `fulfilFxTransfer`/`reserveFxTransfer` (conversionId /
commitRequestId only) were previously listed here as "no business
identifier" — they are not. Verified across the entire pack: every record
whose `operation` maps to a QUOTE/FXQUOTE/TRANSFER/FXTRANSFER envelope
carries its FSD-mandated stage-local id directly in tags, on both `start` and
`egress`, with **one** universal exception — `putQuotesByID` lacks the anchor
(`transactionId`), not an id altogether; its `quoteId` is present and correct.
Chaining is therefore needed only for: (a) party lookup, MSISDN → the quote
payload's `Cdtr`/`Dbtr`, **if and only if** party-lookup enrichment is
reinstated (C1) — otherwise those three records are simply out of scope and
need no id at all; and (b) resolving `putQuotesByID`'s `quoteId` back to the
anchor, if the PPA's per-stage correlation cache needs that link — via
`quoteId` → `PmtId.TxId` on the earlier `postQuotes` record. See
`MLA-PPA-Technical-Design.md` §2.3 for the resulting design decision (use the
anchor identifier as envelope `id` uniformly, carry stage-local ids in
`body`), which resolves this cleanly. Full per-record identifier table:
`MLA-PPA-Technical-Design.md` §2.2a.

**C7. `PmtId` semantics shift between records.** On `postQuotes`,
`EndToEndId` is the transactionId and `TxId` is the quoteId. On
`prepareTransfer` egress, `TxId` is the transactionId. A single "read
`PmtId.TxId`" rule would silently mix identifier types.

**C8. Status vocabulary is a third set.** The ISO form carries
`TxSts: "COMM"` (transfer commit) and `TxSts: "RESV"` (FX reserve); the FSPIOP
form carries `transferState: "COMMITTED"` and `conversionState: "RESERVED"`.
The FSD's translation table (§6.5.3) covers only the FSPIOP vocabulary and has
no row for `COMM`/`RESV`. It needs extending — `COMM` → `ACSC`, `RESV` →
`ACSP` — and the FSD's own warning applies with force: `TxSts` is an
unconstrained string in Tazama's schema, so an untranslated `COMM` is accepted,
stored, and then fails every downstream rule.

**C9. Date of birth is gone.** Zero occurrences of `dateOfBirth`/`BirthDt`
across the entire pack, in either message form, versus 8 in the on-the-wire
pack. The FSD's `pacs.008` mapping sources `Dbtr…BirthDt` from the quote
request; on this topic that field **cannot be populated** and degrades
permanently, not just on a cache miss.

**C10. No error or abort captures in this pack.** All five `DRPP_Kafka_E2E_Pack`
transactions settle successfully. The `RJCT` path, error callbacks, and
`putPartiesErrorByTypeAndID` are unexercised here — every error-handling
branch remained built against the specification alone, on the strength of
this pack. **A separate, wider capture (`raw_export_500.json`, 500 records
across 12 partitions) has since surfaced real rejection data** — an
FX-quote reject, a transfer-prepare reject, and a party-lookup reject, none
matching the `errorInformation`/`TxSts: RJCT` shape the FSD assumed. See
[`rejected-events.md`](rejected-events.md) for the findings and the
implementation plan; nothing below has been updated to reflect it yet, and
no phase of that plan is built.

### D. How this pack differs from the on-the-wire pack

`docs/Sample flow E2E/` is the same platform seen from a different surface —
the FSPIOP/ISO interoperability API, extracted from an Allure UAT report.

| | On-the-wire pack | Kafka pack |
| --- | --- | --- |
| Surface | FSPIOP API between DFSPs | `topic-event-audit`, what the FRMS consumes |
| Unit | 18 files, one message each | JSON arrays of Kafka records |
| Structure | `{_meta, headers, body}` | `{partitionID, offset, key, value.payload{content, metadata}}` |
| Records per step | 1 | **2** (`start` + `egress`) |
| Body form | FSPIOP, ISO carried in `extensionList` / `originalIso20022QuoteResponse` | ISO trees natively, FSPIOP in `transformedPayload` / `content.payload` |
| Stage identity | File name and `_meta.resource` | `metadata.trace.tags.operation` |
| Correlation | `_meta.correlation` — curated by whoever built the pack | Derived from `metadata.trace.tags`; only the 3 party-lookup records (out of 20) carry no usable id, corrected from an earlier overclaim here — see C6 |
| Party detail | `complexName` **plus `dateOfBirth`** | `complexName`, **no `dateOfBirth`** |
| Final status | `transferState: COMMITTED` | `TxSts: COMM` *and* `transferState: COMMITTED` |
| Ordering | Curated sequence | Partition-ordered; splits across partitions |
| Interleaving | None — one flow | Multiple transactions share one raw partition stream (3 in the 41-record slice) — sequential within it, not alternating record-by-record; splitting across partitions (C5) is the real source of out-of-order arrival |

**The practical difference:** the wire pack is a curated narrative — one
message per step, in order, correlation pre-solved, richer party data. The
Kafka pack is the raw operational stream — double-written, partition-split,
interleaved, with the party-lookup stage the one place identifiers must be
chained rather than read directly (C6). **The wire pack is the better
reference for what a message *means*; the Kafka pack is the only valid
reference for what the MLA will actually receive.** Fixtures must come from
the Kafka pack — and specifically from the interleaved slice, not the
pre-filtered folders.

---

## Phase 0 — Scaffolding ✅

Complete. Both services install, build, lint clean, pass their tests, run, and
shut down on `SIGTERM`.

- [x] `poc-mla-ppa/` with `docs/`, `mla/`, `ppa/`
- [x] Executive summary and technical design documents
- [x] Two independent TypeScript/Fastify projects following Tazama's
      `tms-service` / `event-director` conventions — file layout, npm script
      names, `tsconfig`, ESLint flat config, Prettier, SPDX headers,
      `.env.template`, Dockerfile
- [x] Typed configuration validated at boot; a missing required variable fails
      the process at startup rather than at first use
- [x] `LoggerService`-shaped wrapper over `pino`, so `@tazama-lf/frms-coe-lib`
      can be swapped in later as a one-file change
- [x] MLA: `/health/live`, `/health/ready` (reports `DOWN` only when Kafka is
      enabled but not connected)
- [x] PPA: all five ingestion routes, each validating against the Event
      Envelope ajv schema — `200` on acceptance, `400` on a malformed envelope
- [x] PPA: `/health/ready` scoped to instance-local checks only
- [x] Client shells with configuration wired through: kafkajs consumer,
      MLA→PPA HTTP, ValKey, TMS HTTP, write-ahead store (real now — see
      Phase 4)
- [x] Pipeline steps 1–2 wired end to end: reachability gate → write-ahead
      persist call site → acknowledge
- [x] Both services run with external dependencies disabled by default
      (`KAFKA_ENABLED=false`, `CACHE_ENABLED=false`), so neither needs a broker
      or ValKey to come up
- [x] Realigned to FSD v4.0: single audit topic in place of the seven per-action
      subscriptions, `mla-dlq` removed in favour of offset-pause recovery, and
      persist-and-retrieve added to the PPA's durable-store surface

---

## Phase 1 — MLA ingestion path ✅ done

Everything below lives in [`mla/src/services/logic.service.ts`](../mla/src/services/logic.service.ts)
unless noted. Target: an event consumed from `topic-event-audit` arrives at the
PPA as a valid envelope, with the offset advanced only after the acknowledgement.

**Rewritten against the captures and verified against real fixtures — 21
passing tests, plus a live run against the real local TMS (see § *Current
status*).**

- [x] ✅ Open Item #7 resolved by the captures — `operation` is an explicit
      stage classifier and FX-vs-domestic needs no payload sniffing
- [x] ✅ **Envelope model rewritten.** Reads from `value.payload.{content,
      metadata}` via the new `AuditRecordBody` interface: identifiers and
      stage from `metadata.trace.tags`, FSP ids from `content.headers`, body
      from `content.transformedPayload ?? content.payload`. The old `{from,
      to, id}` assumptions are gone.
- [x] ✅ **`isCanonicalRecord` implemented** — a table lookup
      (`CANONICAL_ACTION_BY_OPERATION`) confirmed with zero exceptions across
      the fixture set, not a heuristic. See `MLA-PPA-Technical-Design.md`
      §2.2a for the table.
- [x] ✅ `classifyEventType` / `classifyMsgType` — table lookups on `operation`
      alone, never `transactionType`. Party lookup resolved as **out of
      scope by default** (C1) — `isCanonicalRecord` still accepts
      `putPartiesByTypeAndID` as canonical for its own operation, but no
      `eventType` mapping exists for it, so `handleMessage` skips it
      explicitly rather than misrouting it.
- [x] ✅ `buildEnvelope` — `id` is the anchor identifier (`transactionId`),
      used uniformly across every `eventType` rather than switching fields
      (a deliberate deviation from the FSD's original per-type scheme, see
      Technical Design §2.3). The one confirmed exception — `putQuotesByID`
      carrying only `quoteId` — is resolved via a small in-memory
      `quoteId → anchor` chain populated when `postQuotes` is processed
      (ordering dependency covered by a dedicated test). `correlationId` is
      always freshly generated (`ulid()`), never the Kafka key (C4).
      **A second, matching exception, found live by `demo:replay`'s first
      real run — now fixed too.** `reserveFxTransfer` (the FX-transfer
      settlement callback) carries no `transactionId`/`transferId`/
      `determiningTransferId` — only `commitRequestId`/`conversionId` — and
      had no chain fallback the way `putQuotesByID` does, so `buildEnvelope`
      threw for it every time, silently dropping this record's write on
      every real cross-border transaction's settlement leg. Fixed with the
      same shape as the `quoteId` chain: a bounded in-memory
      `commitRequestId`/`conversionId → anchor` map (`fxTransferIdToAnchor`),
      populated when `prepareFxTransfer` (the `start` counterpart, which does
      carry the anchor) is processed, consulted the same way
      `resolveAnchorId`'s `EventType.Quote` branch already is. **Live-
      verified, not just unit-tested**: the same `01_MWK_to_ZMW_PRIMARY`
      capture, replayed again via `npm run demo:replay` against a live PPA,
      now resolves record `[14]` (`reserveFxTransfer/egress`) to
      `id=01KZRP0E6JT2BX5EA20AQPTX6F` — the same anchor as every other
      record in the leg — and dispatches it (`8 dispatched, 12 skipped`, up
      from `7 dispatched, 13 skipped` before the fix); the PPA's own log
      confirms it was actually accepted and merged
      (`{"outcome":"merged","role":"CORRELATION_ONLY"}`), not just no longer
      throwing. New regression test: two fixture records
      (`prepareFxTransfer`/`reserveFxTransfer`, lifted from the same
      capture) added to `mla/__tests__/fixtures/audit-records.json`
      (records 8–9) and a dedicated `logic.test.ts` case mirroring the
      `putQuotesByID` chain test — asserts the callback's tags carry no
      anchor, that resolution fails before the request is processed, and
      succeeds with the correct anchor after. Test count is now **30 MLA**
      (up from 29; **168** total, up from 167). `npm run lint`: 0 errors,
      unchanged.
- [x] ✅ `parseAuditMessage` — JSON parse only; base64 `dataUri` decode is
      genuinely unused by anything downstream, confirmed in practice (B2).
- [x] ✅ `dispatchToPpa` — routes by `eventType`/notification, retries 5xx
      with exponential back-off and jitter, advances on `200` or `4xx`
      (Open Item #8's "advance anyway" reading), pauses after retry
      exhaustion.
- [x] ✅ `handleMessage` — wires parse → canonical check → scope check →
      signature check → build → dispatch → offset resolution, in that order.
- [x] ✅ Consumer offset management — `advance`/`pause`/`resume` on
      `KafkaConsumerClient`, called from `handleMessage`'s outcome.
- [x] ✅ **Fixtures from real captures** — `mla/__tests__/fixtures/`, eight
      records lifted verbatim from `01_MWK_to_ZMW_PRIMARY` covering every
      classification case (out-of-scope, canonical, non-canonical,
      chained-id, FX enrichment). `ppa-prototype/captured/` is no longer
      referenced anywhere in either service or its tests.
- [x] ✅ Round-trip test — `mla/__tests__/logic.test.ts`, 21 tests: parsing,
      canonical selection, classification, envelope construction (including
      the chaining-order dependency), and `dispatchToPpa`'s 200/4xx/5xx
      outcomes, the last two against a mocked PPA to keep the suite fast and
      deterministic. The **real** round-trip (against a live PPA and TMS,
      not mocked) was run manually — see § *Current status*.

**Exit criterion — met.** Real `prepareTransfer` and `commitTransfer` records
replayed through the actual `buildEnvelope`/classification code reached a live
PPA as valid envelopes and were accepted with `200`, no doubles from
start/egress pairing, every record in the fixture set either correctly
attributed or correctly skipped.

**Deferred at the time, since closed:** unit coverage for the 41-record
interleaved slice specifically (the 8-10 record fixture set covers every
*classification* case but not multiple transactions sharing one raw
partition stream at volume) — this was tracked as Phase 7 validation, not
required for this exit criterion, and Phase 7's entry now has the full
account of it being done and live-verified.

---

## Phase 2 — PPA correlation and state ✅ core done, live-verified

In [`ppa/src/services/logic.service.ts`](../ppa/src/services/logic.service.ts)
and [`ppa/src/clients/cache.ts`](../ppa/src/clients/cache.ts).

- [x] ✅ `validateEnvelope` — `eventType` matches the route, `id` and
      `correlationId` non-empty. (The deeper "right identifier for this
      eventType" check is subsumed by Phase 1's anchor-id deviation — every
      `eventType` now uses the same identifier, so there is nothing further
      to cross-check here.)
- [x] ✅ `classify` — `TRANSFER` and `QUOTE` are `Trigger`, `FXTRANSFER` is
      `CorrelationOnly`, `FXQUOTE` is `Enrichment`. `QUOTE` is trigger *and*
      enrichment in practice (`processEnvelope` still merges its data into
      state after sending) — `EventRole` alone doesn't carry that distinction,
      so it's handled at the call site rather than added as a fifth role. See
      Phase 3 for the quote-stage messages this now produces.
- [x] ✅ ValKey read/write for `TransactionState` — `CacheClient.getState` /
      `mergeState` / `deleteState`, under `correlation:`, with the configured
      TTL. Verified live against the local stack's `valkey`
      (`localhost:16379`), not just mocked. State is a Redis hash, one field
      per enrichment slot, not one JSON blob — what makes the atomic merge
      below possible.
- [x] ✅ `mergeEnrichment` — implemented and verified live (real `postQuotes`
      /`postFxQuotes`/`putFxQuotesByID` data merged into a real ValKey entry
      that a later `pacs.008` translation then read back correctly), **and
      now the required atomic compare-and-merge**: `CacheClient.mergeState`
      runs a single Lua script per merge (`HSETNX` for idempotent leg
      creation, `HSET` for the one field plus `correlationId`/`updatedAt`,
      `EXPIRE` for the TTL) instead of a GET-mutate-SET, so application code
      never holds a copy of the state another replica's write could make
      stale (§3.4, §6.4.5). Verified two ways: `__tests__/cache.test.ts` runs
      the real script against `ioredis-mock`'s Lua VM, and a live run against
      the real `tazama-valkey-1` container confirmed five fields merged
      concurrently onto one leg all landed. `saveState` (the old whole-blob
      overwrite) is retired, not left alongside the replacement.
- [x] ✅ Identifier resolution — **not needed in the form originally
      described.** The original design called for writing
      `transferId → {InstrId, EndToEndId}` because `transactionId` and
      `transferId` could differ. Phase 1's anchor-id deviation (Technical
      Design §2.3) means the envelope's `id` already *is* the single anchor
      used for both, confirmed always equal where more than one identifier is
      present in a capture — so `pacs.002`'s `OrgnlEndToEndId` reuses the same
      anchor directly, verified live to link correctly (TMS's own DataCache
      accepted the pair).
- [x] ✅ `isDomesticTransfer` — checks cached FX-quote state; verified live
      both ways (a leg with no FX-quote enrichment was correctly discarded on
      one run, the same leg with FX-quote enrichment present correctly
      proceeded to `pacs.008` on the next).
- [x] ✅ Out-of-order arrival: park-and-retry within a bounded window when a
      final-state trigger lands before its prepare's state exists.
      `resolveLateOrEarlyState` runs a short bounded retry against ValKey
      (reusing the TMS retry budget/backoff) before
      `writeAheadStore.parkPendingTrigger` parks the trigger envelope itself;
      `completeParkedTriggerAfterPrepare` replays it once this leg's own
      `pacs.008` has actually reached TMS - **not** the moment any
      enrichment merges in, which is what the first version did and which a
      live replay proved wrong (see below). Covers the confirmed-real
      `04_ZMW_to_EGP_partition_split` race. **Live-verified**: the actual
      capture replayed through the real compiled MLA code, settlement leg
      sent to the PPA deliberately first, produced `pacs.008` then `pacs.002`
      in that order, both accepted by TMS, corroborated on TMS's own
      container logs.
- [x] ✅ State lifetime — `finalize` clears the ValKey entry only on a
      successful `pacs.002` (`IsoMessageType.Pacs002`), never on `pacs.008`.
      Live-verified as part of the replay above: ValKey correlation state
      confirmed deleted after the recovered `pacs.002` sent successfully.
- [x] ✅ **Persist-and-retrieve** (new in FSD v4.0): `parkExpiringState`/
      `retrieveParkedState` are real, backed by a background sweep
      (`park-sweep.service.ts`) that scans ValKey for legs near their
      correlation TTL and parks them to the durable store (Phase 4).
      **Live-verified**: a leg was watched getting parked twice by the live
      sweep, against the real `tazama-valkey-1` container, as its TTL
      approached.

**Exit criterion — met for the ordered case, out-of-order early arrival, AND
the TTL-expiry-and-recovery scenario, all three now live.** A quote and its
FX-quote, replayed in order ahead of the matching transfer, left a single
correctly merged state entry in ValKey, confirmed by the resulting
`pacs.008` carrying real (not placeholder) party identity. Out-of-order
early arrival (the settlement leg racing ahead of its prepare) is live-
verified via the partition-split replay above.

**The remaining gap this section used to flag is closed.** A real
`putFxQuotesByID` capture record was posted to a live PPA (`CACHE_ENABLED`
against the real `tazama-valkey-1`, `CORRELATION_TTL_SECONDS=8`,
`PARK_SWEEP_INTERVAL_SECONDS=2`, `PARK_SWEEP_THRESHOLD_SECONDS=6` — a fast
config for the demo, not the default), merging real FX-quote terms into
ValKey. The PPA's own log shows the sweep parking that exact leg three
times as its TTL ran down; 15 real seconds later, ValKey's `EXISTS` on the
key confirmed it genuinely gone — natural expiry, not a simulated gap. Only
then was the matching real `commitTransfer` capture record (final-state
notification) posted, for the first time, with nothing sent for this leg
before it. It was accepted, translated, and sent to TMS as `pacs.002.001.12`
`degraded: false` **51ms** after being received — far too fast to have gone
through `resolveLateOrEarlyState`'s bounded ValKey retry loop (whose
per-attempt backoff alone is ~1s minimum), which is the quantitative proof
`retrieveParkedState` resolved it on the very first check, exactly the code
path this gap was about. Corroborated on `tazama-tms-1`'s own logs
(`Start`/`End - Handle Pacs002 request`, correct deterministic
`01KZRP0E6JT2BX5EA20AQPTX6F-pacs002` id). Demo state cleaned up afterward.

---

## Phase 3 — Translation and TMS egress ✅ all four message types built, locally schema-validated, and live-verified

`ppa-prototype` already proved the `pacs.008`/`pacs.002` transforms against a
live Tazama deployment; that shape was ported and re-verified against a
**second**, independent live TMS instance.

- [x] ✅ **`pacs.008.001.10` ported, re-verified, and fixed.** New home:
      [`ppa/src/services/iso20022.ts`](../ppa/src/services/iso20022.ts).
      Party enrichment now reads from ValKey-backed `TransactionState`
      rather than the prototype's in-process cache, exactly as this item
      anticipated. **The live run caught a real regression the unit tests
      didn't**: the initial port dropped `RgltryRptg`/`RmtInf`/`SplmtryData`,
      which the prototype's proven version included — TMS's own AJV
      validation rejected the message (`400`, missing `RgltryRptg`) on the
      first live attempt. Fixed by restoring those fields; the corrected
      version was accepted (`200`) on the next run. See § *Current status*
      for the full account — left in as the reason this step said
      "re-verify," not just "port."
- [x] ✅ `pacs.002.001.12` **for the final-state trigger**, including
      `transferState`/`TxSts` translation — extended beyond the FSPIOP
      vocabulary this item originally listed to also cover the ISO form the
      captures confirmed the topic carries (`COMM`→`ACSC`, `RESV`→`ACSP`,
      §3.5). Verified live: `commitTransfer`'s real `TxSts: "COMM"` was
      correctly translated to `ACSC` and accepted by TMS. **Error triggers
      (`RJCT`) are not implemented** — no rejected transaction exists
      anywhere in `DRPP_Kafka_E2E_Pack` to build or verify against (§ *Capture
      analysis* C10), so this remains spec-only.
- [x] ✅ **`pain.001.001.11` (quote request trigger) and `pain.013.001.09`
      (quote callback trigger) built** —
      [`ppa/src/services/iso20022.ts`](../ppa/src/services/iso20022.ts)
      `toPain001`/`toPain013`. Cached FX-quote terms fold into `EqvtAmt` /
      `XchgRateInf` when present (preferring the FX-quote **callback**'s
      settled rate over the request's still-zero placeholder amount);
      with no FX leg cached, `EqvtAmt` degrades to the instructed amount at a
      1:1 rate rather than leaving a schema-required field unpopulated
      (`degraded: true` either way). `QUOTE` is now classified as
      **trigger + enrichment** in `classify()`/`processEnvelope` — it fires
      its own message *and* still merges into the leg's state for the later
      `pacs.008` to draw on, exactly as the FSD's §6.4.1 model requires.
      Built directly against the pinned local schema (no full worked JSON
      example exists for either message type in the FSD or the IID) — see
      the next item. **Live-verified against a real TMS** in a follow-up run
      — see the exit criterion below and § *Current status*.
- [x] ✅ `GrpHdr.MsgId` generation — `messageId(anchor, 'pain001' | 'pain013' |
      'pacs008' | 'pacs002')`, deterministic per (leg, message type), pinned
      at assembly. Not yet exercised across an actual retry (no live 5xx
      occurred to force one), but the construction is retry-safe by design:
      calling it again with the same anchor yields the same id.
- [x] ✅ **Pinned a `tms-service` commit and vendored its four ajv schemas** —
      `frmscoe/tms-service` commit `f18317f1f7973623157e1467da78e6853c7b1b89`
      (package version 3.0.0), copied into `ppa/src/schemas/tazama/`.
      [`ppa/src/services/tazama-schema.validator.ts`](../ppa/src/services/tazama-schema.validator.ts)
      validates every outbound message against it — same ajv configuration
      TMS itself uses (`removeAdditional: 'all'`, `useDefaults: true`,
      `coerceTypes: 'array'`) — wired into `processEnvelope` as a new step
      between translate and send, right where FSD §6.3 step 7 puts it. A
      failure here is treated as a permanent translation defect: logged, not
      sent, not retried. **Caught a real gap while building `toPain001`**:
      the schema requires a *second*, transaction-level `SplmtryData` block
      (payer/payee name split + merchant classification code + payer-FSP
      fees) distinct from the message-level one — missed on the first pass,
      caught by this validator before it was ever caught by a live TMS. Open
      item 6 (below) is resolved.
- [x] ✅ `sendToTms` — atomic check-and-set (`SET ... NX EX`) on the `sent:`
      dedup key before every send; `5xx` retries with back-off and jitter;
      `4xx` logged as an application error, no retry (DLQ itself is still
      Phase 4 — the message is currently just logged and dropped on a
      permanent failure, not durably parked).
- [x] ✅ Degraded-message accounting — `translate()` returns `degraded: true`
      when no cached quote exists for `pacs.008`, no leg state at all for
      `pacs.002`, or no cached FX-quote terms for `pain.001`/`pain.013`;
      recorded on every audit log entry. Verified live for `pacs.008`/
      `pacs.002`: `degraded: false` when quote enrichment was present,
      matching the real merged party data in the output.

**Exit criterion — met.** All **four** message types are built, unit-tested
(56 tests across both packages — see § *Current status*), locally
schema-validated against the pinned `tms-service` copy, and now **live**-verified
against a real TMS with `QUOTING=true` — `pain.001`, `pain.013`, `pacs.008`,
`pacs.002` all accepted, all `degraded: false`, corroborated on the TMS
container's own logs (Technical Design §7.3). Tazama's own
`event_history.transaction` table was still not independently queried this
run (tooling access issue in this environment, not a data problem; TMS's own
schema validation plus its own log confirmation of the `event-director`
hand-off is the evidence on record instead).

---

## Phase 4 — Durability 🔨 store is real, live-verified, and now operator-replayable; sizing and the backing-tech decision still open

Was the weakest area: the write-ahead store used to be a placeholder that
returned `true` unconditionally, which meant the step-1 gate and
`/health/ready` were both structurally correct and functionally hollow. Not
true any more — `isReachable` is now an actual write-probe against
`WRITE_AHEAD_DIR`, confirmed live in both directions (`503`/`DOWN` when the
directory is genuinely blocked, `200`/`UP` when it isn't) — but the module
itself is still explicitly a **filesystem POC stand-in**, not the item-1
decision below.

- [ ] ⬜ Choose the backing technology for PPA's durable store (database
      instance or object-storage bucket), kept entirely separate from Tazama's
      own Postgres/Redis/NATS. ⛔ *blocked on the hosting-location decision*.
      **Unaffected by the filesystem implementation below** — every call site
      goes through `write-ahead.store.ts`'s exported shape only, so this
      decision is a swap of that one file's internals later, not a rewrite of
      its callers.
- [x] ✅ Implement [`ppa/src/clients/write-ahead.store.ts`](../ppa/src/clients/write-ahead.store.ts):
      write-ahead persist on receipt, in-place update on failure (one record
      per event, not two), reachability probe. **Real, filesystem-backed** —
      one JSON file per record, written via temp-file-then-atomic-rename so a
      crash mid-write never leaves a torn record. A real concurrency bug was
      caught and fixed building this: the temp-file suffix used to be
      millisecond-resolution, and two legitimate concurrent writes to the same
      destination could collide under real parallel load; fixed with
      `crypto.randomUUID()`. Tested against a real temp filesystem
      (`write-ahead.store.test.ts`, 19 tests, including a concurrency
      regression test for that exact bug) **and live**, against a real PPA
      process and the default `data/write-ahead` directory - see the crash
      test below.
- [ ] ⬜ Size it against **peak** TPS. This is a high-volume store — it takes a
      write for every ingested event — not low-volume DLQ traffic. Not
      attempted — no peak-TPS figure exists to size against yet.
- [x] ✅ Notification dedup set in that same store, keyed on `transferId`
      **alone** with terminal-state monotonicity. Deliberately not in ValKey:
      `volatile-lru` eviction would silently drop a dedup key and re-admit a
      duplicate. Implemented as an atomic check-and-claim (`fs.open(path,
      'wx')` — fails if the file already exists, a single syscall, safe even
      across processes sharing the same store) — first terminal state
      recorded for a `transferId` wins, any later notification for the same
      `transferId` is a duplicate regardless of its own value. Tested.
- [x] ✅ Park and retrieve operations backing Phase 2's persist-and-retrieve —
      for this case the store is a waiting room, not a terminal failure
      record. Built (`park`/`retrieveParked`), plus a second pair not in the
      original scope of this item, for the out-of-order *early*-arrival case
      Phase 2 also now handles: `parkPendingTrigger`/`retrievePendingTrigger`/
      `clearPendingTrigger`, parking a trigger *envelope* rather than state
      when no state exists yet to park. Both halves live-verified: `park`
      via the sweep watched parking a real leg twice; `parkPendingTrigger`/
      `retrievePendingTrigger`/`clearPendingTrigger` via the full
      partition-split replay (§ *Current status*), which is also where two
      real bugs in the logic sitting on top of these operations were caught
      and fixed. `retrieveParked` (the *state* half, for a notification
      arriving after its leg was already swept-and-parked) is exercised by
      tests but not yet by a live run - see Phase 2's exit-criterion note.
- [x] ✅ Operator-triggered replay, itself audit-logged, for the *parked-entry*
      case. `POST /admin/replay/:key` → `operatorReplayParkedState` →
      `CacheClient.restoreState` restores a durable-store-parked leg back
      into ValKey with a fresh TTL, on demand — recovering correlation
      within the store's 90-day retention rather than only the ~70s ValKey
      window. Read-only on the durable copy, so repeatable. **Live-verified**
      end to end against the real `tazama-valkey-1` and a live PPA process —
      see § *Current status*. **Not yet built: replay of "anything else"**
      (a WAL `pending`/`failed` record, or a stuck pending-trigger record) —
      correctly scoped out as only meaningful within the correlation TTL, a
      narrower and lower-priority case than the parked-entry one this item's
      description called out first.
- [x] ✅ Crash test: kill the PPA between ack and completion, confirm the event
      is recoverable from the write-ahead record. **Live-verified.** A `QUOTE`
      envelope was POSTed to a PPA instance pointed at an unreachable TMS
      (long retry backoff, so the background pipeline was still genuinely
      in-flight); the moment the `200` ack came back, that process was
      `kill -9`'d. The WAL record survived on disk with `status: "pending"` -
      never reached `complete()`, because the process died first. A *second,
      independent* Node process (fresh PID, fresh module load, started after
      the first was confirmed dead) then required the same compiled
      `write-ahead.store.js` and called `complete(corr, 'success')` on that
      exact record - it read the file, the record vanished as designed. Real
      cross-process, cross-restart filesystem durability, not an in-memory
      coincidence or a same-process fluke.

**No MLA-side work in this phase.** `mla-dlq` was retired in FSD v4.0 — the audit
topic's persistence guarantee and 7-day retention replace it, and the MLA's whole
recovery model is offset-pause (Phase 1). Nothing on the MLA side needs building
here.

**A sibling store, same shape, built this session but tracked as its own
item under Phase 5 (§ below) since it answers a security/audit question, not
a durability one:** the audit log store
([`ppa/src/clients/audit-log.store.ts`](../ppa/src/clients/audit-log.store.ts))
follows this same file-per-record, temp-then-atomic-rename pattern, in its
own `AUDIT_LOG_DIR` directory, append-only rather than one-active-record-per-key.
See Phase 5's entry and § *Current status* for the full account.

---

## Phase 5 — Security 🔨 audit log store + a first pass at PII masking done and live-verified (Tier 4); mTLS, the Keycloak token chain, full PII tokenization, JWS validation, and notification dedup remain deployment-stage or blocked

The two items below are done. Everything else in this phase is unstarted and
a production requirement — see each item for why it's deliberately not
being pulled forward into this POC (deployment-stage work with nothing
local to verify it against, or genuinely blocked on external captures).

- [ ] ⬜ Mutual TLS on MLA→PPA, with the PPA authorizing on the client
      certificate presented — an allow-list of one — rather than a bearer token
- [ ] ⬜ Mutual TLS on PPA→TMS, **in addition to** the bearer token, not
      instead of it. mTLS proves which service is connecting; the token proves
      what the call may do.
- [ ] ⬜ Auth-lib → Auth-service → Keycloak token chain for PPA→TMS, obtained
      live rather than read from static config
- [ ] ⛔ JWS (`FSPIOP-Signature`) validation in the MLA — logged with a
      **security** alert, then the offset advances (no DLQ to park it in).
      Blocked on Open Item #3: the header may not survive the transfer topics'
      base64 data-URI wrapping into the Kafka event at all, in which case the
      specified check cannot run.
- [ ] ⬜ PII tokenization component, sitting between the audit topic and the
      MLA. Note this is genuinely partial, not end-to-end: the ILP packet is
      cryptographically bound into the `condition` and cannot be rewritten
      without breaking the transfer, so party identifiers inside it reach
      MLA/PPA/TMS in cleartext regardless. The construction must be keyed
      (HMAC) — MSISDN's space is small enough to enumerate otherwise.
- [ ] ⬜ Notification Filter/Dedup component, also between the audit topic and
      the MLA. Architecturally separate; per the IDD its Phase 1 *deployment* is
      embedded in the MLA/PPA containers with no separately-provisioned
      container in the baseline sizing.
- [ ] ⬜ Flag to the forensic-audit workstream that the audit topic's own
      persisted record predates both controls above — it holds untokenized,
      un-deduplicated data by design.
- [x] ✅ Audit log store: separate, dedicated, append-only, distinct from both
      ValKey and the DLQ. [`ppa/src/clients/audit-log.store.ts`](../ppa/src/clients/audit-log.store.ts),
      `GET /admin/audit/:key`. **Live-verified** — see Phase 4's entry and
      § *Current status*.
- [x] ✅ Identifiers masked before they reach the audit log/logs (keyed HMAC,
      Tier 4 item 2). [`ppa/src/services/pii-mask.service.ts`](../ppa/src/services/pii-mask.service.ts) —
      genuinely partial by design, not end-to-end: the ILP packet's
      cryptographic binding still means full tokenization isn't achievable
      (see the PII tokenization item above, same limitation), and "what
      went out" to TMS stays unmasked deliberately (TMS needs the real
      data). Covers the one place this pipeline had occasion to log/audit a
      party identifier — `QUOTE`-family envelope bodies. **Live-verified**
      — see § *Current status* for the full account, including a real
      ordering bug this work found and fixed in Tier 4 item 1's own store.

---

## Phase 6 — Operability 🔨 circuit breakers, minimal metrics, and correlationId propagation done and live-verified; alerting, APM, and consumer-lag-class metrics still open

- [x] ✅ Circuit breakers on both hops, with the two different tripped
      behaviours the design calls for. MLA→PPA: `tripAndPause`
      (`mla/src/services/circuit-breaker.service.ts`) pauses consumption and
      re-probes PPA health on a timer (`GET /health/ready`), resuming once
      it answers healthy — closes a real gap where `KafkaConsumerClient
      .resume` was defined but never called by anything, so a paused
      partition previously stayed paused forever. PPA→TMS: a standard
      closed/open/half-open breaker (`ppa/src/clients/circuit-breaker.ts`)
      gates `sendToTms`, failing fast once TMS shows sustained failure
      rather than burning the full retry budget on every in-flight message;
      a 4xx never trips it (TMS answered correctly - the message is bad,
      not TMS's health). **Live-verified, both hops, full lifecycle**: PPA's
      breaker taken through closed→open→fail-fast→half-open→closed against
      a self-controlled mock TMS (the shared `tazama-tms-1` container was
      never touched); MLA's breaker taken through a genuine `ECONNREFUSED`
      → trip → 3 real seconds of correctly *not* resuming while still down
      → a real PPA process spawned → re-probed and resumed within one real
      interval. Full account in § *Current status*. **Not the DLQ half** -
      PPA→TMS still just logs and drops on permanent failure per Phase 3;
      a real DLQ write path is separate, still-open work.
- [ ] ⬜ Metrics: consumer lag, DLQ writes, per-hop latency, ValKey and
      TMS-token health (surfaced here rather than gating readiness) still
      need real infrastructure this POC doesn't have. **The rest is now
      built and live-verified**: degraded-message rate, discarded-domestic
      count, discarded-duplicate-notification count, parked-and-retrieved
      counts, and TMS send outcomes are all counted in
      `ppa/src/services/metrics.service.ts` and exposed at `GET /metrics`
      (JSON, not Prometheus exposition format — for a reviewer to look at
      directly, not a scrape target with nowhere to point yet). Full
      account in § *Current status*.
- [ ] ⬜ Alerting on every DLQ write, and on permanent-failure offset advances —
      those are the events the MLA drops on the floor by design, so they need to
      be visible somewhere
- [ ] ⬜ APM instrumentation, matching Tazama's `src/apm.ts` pattern
- [x] ✅ `correlationId` propagated through logs, ValKey, audit entries, and
      the outbound TMS call, so one payment is traceable end to end — an
      audit pass that found and fixed two real gaps rather than confirming
      an assumption: `sendToTms`'s five log lines carried only
      `messageType`, and MLA's pre-`buildEnvelope` error/debug logs dropped
      the trace-tag identifiers already available at that point. Both
      fixed and live-verified. Full account in § *Current status*. **PPA's
      DLQ** is not yet a real store to propagate through (Phase 4's
      last-listed item, still open) - this covers everywhere the identifier
      already has somewhere to go today.
- [x] ✅ Multi-replica behaviour: confirmed live — two genuinely independent
      PPA processes, both pointed at the real `tazama-valkey-1`, fed five
      concurrent real capture records for one leg. The atomic merge itself
      held (all five fields landed intact, none clobbered) — but the run
      caught a different real concurrency bug first: `writeAheadStore
      .isReachable()`'s fixed-name probe file, which collided under genuine
      concurrent requests to one replica and returned spurious `503`s. Fixed
      (`randomUUID()` per probe call, § *Current status*) and re-verified
      live on a clean run: all 5 requests `200`, merge intact, both quote
      triggers reached TMS, corroborated on its own logs.
- [ ] ⬜ Kubernetes manifests / Helm values, matching the deployment rules in
      the Infrastructure Design Document

---

## Phase 7 — Validation ⬜

- [ ] ⬜ Unit coverage for translation and classification, driven from
      `DRPP_Kafka_E2E_Pack` — **not** `ppa-prototype/captured/`, which is a
      different topic with a different envelope
- [ ] ⬜ End-to-end run against `ml-core-test-harness` with the TTK golden-path
      collection, both services live throughout — the same setup that validated
      `ppa-prototype`
- [ ] ⬜ Cross-border run with an FX leg. The captures now document the FX
      path across five corridors (MWK/ZMW/EGP/KES), so it is no longer
      unobserved — but it has still never been *run* against, pending the
      environment.
- [x] ✅ Audit-topic captures obtained and analysed (`DRPP_Kafka_E2E_Pack`) —
      see § *Capture analysis*
- [ ] ⛔ Run against a **live** audit topic. The captures settle what the
      stream contains; they cannot exercise consumption, offset handling,
      lag or partition rebalancing. Blocked on the COMESA environment.
- [x] ✅ Replay the interleaved slice as the primary regression fixture —
      it is the only artefact exercising double-writes and multiple
      transactions sharing one raw partition stream. **Done and
      live-verified** — see § *Current status* for the full account,
      including a correction to this item's original "four transactions
      interleaved" framing (it's three, sequential within the slice, not
      alternating record-by-record).
- [ ] ⬜ Failure-path runs: PPA down (does the MLA pause its offset without
      losing events?), ValKey down (does the gate actually return 503?), TMS
      returning 5xx then recovering, fulfil arriving before prepare, and a
      counterpart arriving after its ValKey TTL has lapsed (does
      persist-and-retrieve actually recover it?)
- [x] ✅ Load test against the 25 sustained / 125 peak TPS baseline —
      **partially, honestly**: a real sustained local run (Tier 3 item 3, §
      *Current status*) demonstrated the pipeline holding up under
      continuous concurrent load — 1,059 synthetic transactions, 8,472
      accept-and-persist calls, 4,236 real messages reached TMS, zero
      failures, throughput well above the 25/125 baseline figures
      (35 transactions/s achieved locally). What it does **not** do is
      validate the baseline itself — that needs production traffic shape
      this POC has no access to, unchanged from every prior note on this.
      The claim proven is "does it hold up under sustained load," not "does
      it meet the specific baseline number."
- [ ] ⬜ Confirm the ValKey TTL against real observed prepare→fulfil gaps
      rather than the assumed ~70s

---

## Blocked work

Numbering follows **FSD v4.0 §12**. Items without a number are repo-level or
cross-document issues the FSD does not track.

### Closed by the captures

| FSD # | Item | Outcome |
| --- | --- | --- |
| ~~7~~ | Audit-topic payload-shape identity | ✅ **Resolved favourably** — `operation` tag classifies every stage explicitly |
| ~~3~~ | `FSPIOP-Signature` survival | ✅ **Resolved** — real JWS on 15/20 records; absent on quote-family egress |
| ~~5~~ | `pacs.002` trigger / FSPIOP headers | ✅ **Resolved** — both candidates carry `fspiop-source`/`-destination` |
| ~~4~~ | Payee display-name source | ✅ **Resolved** — carried in the quote payload, both forms |
| ~~2~~ | `topic-notification-event` scope | ✅ **Superseded** — no separate notification topic exists |

### Still open

Split by what each item actually gates — **POC** items block the work
immediately ahead (Phases 1–3, local infrastructure only); **production**
items only matter once this POC is done and a genuine deployment starts.
Numbering follows FSD v4.0 §12; items without a number are repo-level or
cross-document issues the FSD does not track.

**Gates the POC — relevant now:**

| FSD # | Item | Gates | Owner |
| --- | --- | --- | --- |
| — | **`start`/`egress` canonical-record table confirmed by capture, not yet confirmed as a stable Mojaloop-side contract** (C2). Zero exceptions across the whole pack, corroborated by signature presence — see `MLA-PPA-Technical-Design.md` §2.2a. Implementable with confidence now; the open part is whether Mojaloop guarantees this shape going forward. | Phase 1's `selectCanonicalRecord` — a future shape change would need re-verification, not a redesign | Mojaloop Partner (confirmation only) |
| — | **`TxSts` vocabulary extension** (C8). FSD §6.5.3 has no row for `COMM`/`RESV`. ✅ Implemented in code (`ppa/src/services/iso20022.ts`) and verified live (`COMM`→`ACSC` accepted by TMS) — still needs the FSD document itself updated. | Phase 3's `pacs.002` — an untranslated value is silently accepted then fails every rule | Paysys (FSD update) |
| — | **No error, abort, or rejection captures in `DRPP_Kafka_E2E_Pack` — all five transactions settle `COMM`.** The `RJCT` path and `putPartiesErrorByTypeAndID` are unexercised there (C10). **A separate, wider capture (`raw_export_500.json`, 500 records / 12 partitions) has since surfaced real rejection data** — an FX-quote reject, a transfer-prepare reject, a party-lookup reject — none matching the shape this design assumed. See `rejected-events.md` for the findings and implementation plan; not yet built. | Every error branch in Phase 1 and Phase 3 remains spec-only until implemented — not blocking the happy-path slice | Request from COMESA (partially fulfilled — see `rejected-events.md`) |
| — | **Date of birth unavailable** (C9). Absent from both message forms on this topic. | `Dbtr…BirthDt` on `pacs.008` degrades permanently — confirm Tazama accepts the sentinel indefinitely | Paysys + Tazama |
| — | **Party-lookup premise is wrong in the FSD** (C1). ALS *does* reach this topic. | Whether to reinstate party-lookup enrichment the FSD removed | Paysys (FSD update) |
| 8 | **Should MLA-side permanent failures advance the offset immediately?** ✅ Implemented as "advance" (the FSD's own default reading, §2.6) — genuinely open part is whether that's the *right* choice, not what the code currently does. | Phase 1's advance-vs-pause policy | CCH + Paysys |
| 9 | **Recovery when an outage exceeds the correlation TTL.** Sharper now that partition splits are confirmed (C5). | Whether Phase 2 needs a further mechanism | Paysys |

**Gates production, not the POC — deferred for now:**

| FSD # | Item | Gates | Owner |
| --- | --- | --- | --- |
| — | **COMESA-side test environment not provisioned.** Deferred, not blocking — see § *Current status* above. No DRPP infrastructure to deploy the MLA into, no VPN endpoint to connect to the PPA. | Real deployment, the mTLS handshake, every true end-to-end and load test, UAT sign-off — **not** the fixture-driven POC work | CCH / COMESA |
| — | **Hosting location** (Paysys DC vs. COMESA infrastructure) | Phase 4's store technology | CCH + Paysys |
| 1 | **MLA→PPA and PPA→TMS timeout values** not agreed. | The 5s placeholders in both `.env.template` files — fine as placeholders through the POC | CCH + Paysys |
| 6 | **Zambia Data Protection Act applicability.** Note the captures carry unmasked MSISDNs and full names, so the tokenization component is load-bearing once real data flows in production. | Retention policy on both stores | CCH Legal |
| ~~—~~ | ~~**Pinned `tms-service` commit** not yet chosen~~ ✅ **Resolved** — `f18317f1f7973623157e1467da78e6853c7b1b89`, see § *Current status*. | Phase 3's local schema validation | Paysys |
| — | **`msgType` semantics conflict** — FSD vs IID | The envelope schema and `classifyMsgType` | Paysys |
| — | **Conflicting terminal states** — can `COMMITTED` follow `ABORTED`? | Whether monotonicity is a real path or defensive | Mojaloop Partner |

---

## Suggested sequencing

Revised now the captures are in hand. The order that gets to a working,
verifiable pipeline soonest is still a **narrow vertical slice first**:

0. ~~Ask about the audit topic.~~ ✅ Done — captures received and analysed.
1. ~~Rework the envelope model against the real record shape and settle the
   `start`/`egress` selection rule.~~ ✅ **Done** — Phase 1.
2. ~~One message type, all the way through.~~ ✅ **Done and verified live** —
   real `prepareTransfer` → envelope → PPA → `pacs.008` → real TMS `200`,
   with real ValKey state (§ *Current status*).
3. ~~Close the loop with `commitTransfer` → `pacs.002`.~~ ✅ **Done and
   verified live** — identifier chaining (C6, resolved differently than
   originally planned via the anchor-id deviation) and the `COMM` → `ACSC`
   translation (C8) both proved out against the real TMS.
4. ~~Widen to the quote stages (`pain.001`, `pain.013`) and FX enrichment.~~
   ✅ **Done and verified live** — `toPain001`/`toPain013`, `QUOTE` now trigger
   + enrichment, and (in a follow-up run) the local TMS was restarted with
   `QUOTING=true` and all four message types confirmed accepted, `degraded:
   false` (§ *Current status*). Still open: whether to reinstate party-lookup
   enrichment now that C1 shows the data is available — a design decision,
   not a technical blocker.
5. **Then durability and security** (Phases 4–5). Persist-and-retrieve is
   worth pulling earlier than previously suggested — C5 confirms partition
   splits are real, so out-of-order settlement is an expected condition, not
   an edge case. ~~The pinned local-schema validation item is now backed by a
   concrete example of why it matters~~ ✅ **Done** — pinned and wired in,
   and it already caught a second real gap (`pain.001`'s transaction-level
   `SplmtryData`) before a live TMS could, the same class of catch
   `RgltryRptg` was (§ *Current status*).
6. **Operability and load** (Phases 6–7) last — this is the one stage
   genuinely gated on the COMESA environment (§ *Current status*), since it
   requires a live topic and a real deployment to measure against.

Three things done early, as planned, because they were cheap then and would
have been expensive to retrofit:

- ✅ **`correlationId` propagated from the first line of real code** —
  MLA-generated (`ulid()`) on every envelope, never the Kafka key (C4).
- ✅ **Fixtures built from real captures** — `mla/__tests__/fixtures/`, sourced
  from `01_MWK_to_ZMW_PRIMARY`. The 41-record interleaved slice
  (`raw_topic_slice_partition2.json`) specifically remains unexercised by
  automated tests — tracked in Phase 7, not required for Phase 1's exit
  criterion.
- ✅ **`putQuotesByID` resolved back to its anchor** (C6, corrected) — the
  `quoteId → anchor` chain, populated when `postQuotes` is processed and
  covered by a dedicated ordering-dependency test.

---

## Open questions for the COMESA / Mojaloop team

Arising directly from the capture analysis:

1. **Is the per-operation canonical-record shape (C2) a stable contract?**
   Confirmed with zero exceptions across five transactions and 61 total
   records — but that is still one capture window. Confirmation from Mojoloop
   would let us rely on it as a guarantee rather than a strong empirical
   pattern.
2. **Can we get error-path captures?** A rejected transfer, a failed party
   lookup, an FX quote rejection (C10). Every error branch is currently
   built against the specification alone.
3. **Is the settlement-leg partition split expected behaviour or a symptom?**
   (C5.) It is described as intermittent — knowing whether it is by design
   changes whether we treat it as a permanent condition or a defect to track.
4. **Is `dateOfBirth` genuinely unavailable on this topic** (C9), or absent
   only from these particular test parties?
5. **Is `topic-event-audit` the final topic name**, and what are the retention
   and partition count in the target environment? The FSD assumes 7 days; the
   captures do not evidence retention either way.

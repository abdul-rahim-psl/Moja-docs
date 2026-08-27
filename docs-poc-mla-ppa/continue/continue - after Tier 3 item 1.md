# Continue — after Tier 3 item 1

Handoff document for picking this work back up in a new chat. Written at
the point where **Tier 1 (durability/concurrency hardening) and Tier 2
(operability essentials) are both fully done and live-verified**, and
**Tier 3 item 1** (a saved, real replay tool) is done, live-verified, and
already paid for itself by surfacing a new real gap. **Updated twice since:
the gap that tool surfaced (`reserveFxTransfer`'s anchor-resolution chain)
is fixed (§2), and Tier 3 item 2 (the interleaved partition-2 slice as a
regression fixture) is also done and live-verified (§4) — so this document
now marks the point where Tier 3 items 1 and 2 are both fully closed, and
item 3 (a basic local load/soak run) is next.**

**Supersedes** [`continue - after live verification.md`](continue%20-%20after%20live%20verification.md)
for "what's next" — that document (and the two before it) are left as-is
for their own historical record. **Don't re-derive what's already written
down**: `plan-outline.md`'s "Current status" section has the full account
of every item below — what was built, what broke, how it was fixed, and
exactly what was and wasn't proven live. Read that first if you need the
detail. This document exists for one thing: **what's next, reframed.**

---

## 0. How this session wants to work — read this before starting

**The user set an explicit cadence partway through the previous session:
one action item at a time, then stop and wait to be told to continue.**
Don't chain multiple Tier 3/4 items together in one turn even if the next
one seems obvious — finish the one asked for, report it (see the TL;DR
format below), and stop. This isn't a soft preference; it was stated
directly and should carry forward into this chat by default until told
otherwise.

**TL;DR format the user has explicitly praised and asked to keep using**,
verbatim structure:

```
What we did: <one or two sentences, plain language, no jargon a
non-engineer couldn't follow, stated as a completed fact not a summary of
effort>
```

Follow it with the concrete details (what was built, what was proven live,
what it cost/found), but lead with that one-line, human-readable framing
every time.

---

## 1. Where this leaves the POC

Everything through Phase 3 (the core pipeline) was already done and
live-verified before this session. This session closed out **all of Tier 1
and Tier 2 in full, plus the first item of Tier 3**:

- **Tier 1** (finish what's already started): operator-triggered replay,
  the swept-and-parked-state live-verification gap, and multi-replica
  confirmation — all three done, live-verified, and **two of the three
  found real bugs** (a fixed-name reachability-probe race under concurrent
  requests; a late-notification recovery path that fired at the wrong
  moment, from the session before this one).
- **Tier 2** (operability essentials): `correlationId` propagation audit,
  minimal `/metrics`, and circuit breakers on both hops — all three done,
  live-verified, and the propagation audit **and** the circuit-breaker work
  each found a real gap too (missing correlationId in the busiest log
  lines; `KafkaConsumerClient.resume` defined but never called by
  anything, so a paused MLA partition could never recover on its own).
- **Tier 3 item 1** (saved replay tool): done, live-verified by actually
  using it, and **it found a fifth real bug on its very first run** —
  `reserveFxTransfer` had no anchor-identifier chain fallback, so
  `buildEnvelope` threw for it every time. **Now fixed too** (§2 below) —
  the user chose to close it immediately rather than defer it, same shape
  as the existing `quoteId` chain, live-verified with the same tool that
  found it.

**Running total: five real bugs found by this project's "prove it live"
discipline, across five different pieces of work, none of them caught by
the unit tests alone — and all five are now fixed and live-verified fixed.**
That pattern is now well-established enough to trust as a predictor, not a
coincidence — see §5 below.

What's left is one still-genuinely-blocked item, the rest of Tier 3, and all
of Tier 4. The open decision this document originally flagged (§2) has been
made and closed — next up is Tier 3 item 2.

---

## 2. The `reserveFxTransfer` gap — closed (Tier 1.5)

**Resolved.** Asked the user whether to fix the `reserveFxTransfer`
anchor-resolution gap immediately or defer it — they chose to fix it now.
Done, live-verified, no new bugs found this time.

- **The fix**: same shape as the existing `putQuotesByID`/`quoteId → anchor`
  chain. A new bounded in-memory map, `fxTransferIdToAnchor`
  (`mla/src/services/logic.service.ts`), keyed by both `commitRequestId` and
  `conversionId` (they were confirmed equal in the capture pack, but both
  are remembered as keys rather than assuming that holds generally),
  populated when `prepareFxTransfer` (the `start` counterpart, which does
  carry the anchor) is processed. `resolveAnchorId` consults it for
  `EventType.FxTransfer` the same way the `Quote` branch already consults
  `quoteIdToAnchor`.
- **Live-verified, not just unit-tested**: `npm run demo:replay` re-run
  against the exact same `01_MWK_to_ZMW_PRIMARY` capture that first
  surfaced the gap. Record `[14]` (`reserveFxTransfer/egress`) now resolves
  to `id=01KZRP0E6JT2BX5EA20AQPTX6F` — the same anchor as every other
  record in the leg — and dispatches (`8 dispatched, 12 skipped`, up from
  `7 dispatched, 13 skipped`). The live PPA's own log confirms it was
  actually accepted and merged, not just no longer throwing:
  `{"outcome":"merged","role":"CORRELATION_ONLY"}`.
- **New regression test**: two more fixture records
  (`prepareFxTransfer`/`reserveFxTransfer`, lifted from the same capture)
  added to `mla/__tests__/fixtures/audit-records.json` (records 8–9), and a
  dedicated `logic.test.ts` case mirroring the existing `putQuotesByID`
  chain test. Test count: **168** (30 MLA + 138 PPA, up from 167).
  `npm run lint`: 0 errors on both packages.
- Full account: `plan-outline.md`'s Phase 1 `buildEnvelope` checklist item
  and the "Current status" narrative, both updated in place.

---

## 3. The one still-blocked item — set aside, not forgotten

**Error-path translation** (`pacs.002` with `TxSts: RJCT`) cannot be built
or tested properly: `DRPP_Kafka_E2E_Pack` contains zero rejected, aborted,
or error-callback transactions — nothing to build the mapping against or
verify it with. Blocked on COMESA providing error-path captures. Unchanged
across every session so far. **Nothing productive to do here right now** —
don't start speculative work against a message shape nobody has actually
observed.

---

## 4. What's next — Tier 3 and Tier 4, in order

Continuing straight down the list `continue - after live verification.md`
set up, now picking back up at Tier 3 item 3 (items 1 and 2 are both done —
see §1/§2 above and item 2's account just below).

### Tier 3 — make the POC provable by someone who isn't in this chat

2. ~~Replay the interleaved partition-2 slice
   (`raw_topic_slice_partition2.json`) as a proper regression fixture
   (Phase 7)~~ — **done, live-verified, and both parts of the original
   "decide whether to add an automated test" question got done, not just
   one.** `demo:replay` took the raw file path as-is, no plumbing needed:
   15 dispatched, 26 skipped against a live PPA, matching a new automated
   test exactly (`mla/__tests__/partition2-slice.test.ts`, 3 tests, the
   first fixture in the repo covering more than one transaction's worth of
   records). **Also corrected in the process**: the slice's documented
   "four transactions interleaved" turned out to be three transactions,
   sequential within the slice, not alternating record-by-record — fixed in
   `plan-outline.md`'s *Capture analysis* section rather than left
   standing. Full account in `plan-outline.md`'s "Current status" and Phase
   7 checklist. No longer on this list.
3. **A basic local load/soak run** against the local stack. Won't produce a
   real number to validate the 25/125 TPS baseline against (that genuinely
   needs production data this POC doesn't have), but running a sustained
   burst through the real pipeline — MLA → PPA → TMS, ValKey and the
   write-ahead store under continuous load — is a different and valuable
   claim: *does it hold up, not just work once*. Worth doing even with a
   made-up target number.

### Tier 4 — security/audit basics worth having even in a POC

4. **A real audit log store**, even a simple one (the write-ahead store's
   own file-per-record pattern would work fine here too) — currently a
   structured log line stands in for this, explicitly marked as a
   placeholder. Low effort given the pattern already exists in this
   codebase; makes "what happened to this payment" answerable by more than
   grepping stdout.
5. **A first pass at PII masking**, even partial. Already documented as
   "genuinely partial, not end-to-end" (the ILP packet's cryptographic
   binding means full tokenization isn't achievable regardless), but a
   keyed-HMAC pass over identifiers before they reach logs/audit is a real,
   presentable improvement over cleartext today, and doesn't require
   solving the ILP-packet problem to be worth doing.

### Explicitly not on this list, and why

**mTLS (both hops), the Auth-lib→Keycloak token chain, and Kubernetes
manifests are deliberately excluded.** Not "blocked" in the COMESA sense —
Technical Design §5 already classifies this tier as deployment-stage work,
and the local stack has no Keycloak instance or deployment target to
validate against (checked: `docker ps` on the shared local Tazama stack
shows no auth/Keycloak service). Building this now would be writing
configuration nobody can verify — the same trap this project has avoided
everywhere else by insisting on live verification over trusting the design
on paper. If "presentable" is meant to include this tier, that's a scope
decision worth making explicitly, not assuming.

**JWS (`FSPIOP-Signature`) validation** stays off this list too, for a
narrower reason: Open Item #3 asks whether the signature survives the
transfer topics' base64 data-URI wrapping into the Kafka event at all. This
might be answerable from the *existing* captures already on disk — worth
specifically checking whether transfer-family records carry
`content.headers['fspiop-signature']` (not just the quote-family ones
already confirmed) before assuming this needs COMESA. Flagged as "check
before assuming blocked," not added to the plan as either blocked or
actionable.

---

## 5. Local dev environment — how to pick this up and run it

Unchanged in shape from the previous continue doc.

```
tazama-tms-1     localhost:5000   (docker ps to confirm; part of the shared
                                    local Tazama stack, compose project name
                                    "tazama" — always pass -p tazama if
                                    touching it via compose directly)
tazama-valkey-1  localhost:16379  (same stack, healthy)
```

```bash
# Build both
cd mla && npm run build
cd ../ppa && npm run build

# Run both (separate terminals / background)
cd mla && node -r dotenv/config build/index.js   # :3001
cd ppa && node -r dotenv/config build/index.js   # :3002

# Health check - /health/ready is a real reachability probe, both services
curl localhost:3001/health/ready
curl localhost:3002/health/ready

# NEW this session - a real metrics surface, worth checking after any run
curl localhost:3002/metrics
```

`ppa/.env` carries the durable-store/park-sweep config (`WRITE_AHEAD_DIR`,
`PARK_SWEEP_*`) and the new circuit-breaker config
(`TMS_CIRCUIT_FAILURE_THRESHOLD`, `TMS_CIRCUIT_COOLDOWN_MS`) — defaults are
fine to run with as-is; see `.env.template` for what each does.
`mla/.env` has the matching `PPA_REPROBE_INTERVAL_MS`. `data/write-ahead/`
(gitignored) is where the write-ahead store's files land; safe to delete
between runs.

**The replay pattern used for every live check up through last session**
(require the compiled MLA build's functions directly, feed it records,
call `dispatchToPpa` or POST built envelopes to the PPA yourself) **is now
a real, checked-in tool — use it instead of writing a scratch script:**

```bash
cd mla
npm run demo:replay -- "../../DRPP_Kafka_E2E_Pack 2/DRPP_Kafka_E2E_Pack/01_MWK_to_ZMW_PRIMARY"
# or, against the interleaved partition-2 slice (item 2, now also a checked-in
# fixture at mla/__tests__/fixtures/raw_topic_slice_partition2.json - either
# path works, the external pack or the copy in-repo):
npm run demo:replay -- "../../DRPP_Kafka_E2E_Pack 2/DRPP_Kafka_E2E_Pack/raw_topic_slice_partition2.json"
```

**A caveat this session ran into, worth carrying forward**: replaying the
same real transaction's data twice in one session without clearing ValKey in
between will make its terminal notification look like a genuine duplicate
the second time (the sent-dedup guard is working correctly, not a bug) - if
that happens, `docker exec` into `tazama-valkey-1` to inspect/clear
`correlation:*`/`sent:*` keys directly was blocked in this sandbox (`docker
ps` works, `docker exec` does not); the local write-ahead store's `parked/`
folder is a reliable way to spot what got left behind, and stale keys expire
on their own TTL regardless.

Requires a running PPA at `PPA_BASE_URL` (`.env`). Prints each record's
stage, skip reason, or dispatch outcome; doesn't touch any Kafka
offset — it's a standalone tool, not the real consumer. Source:
`mla/src/scripts/demo-replay.ts`.

**One live-verification habit worth carrying forward explicitly**: every
live check this session cleaned up its own demo state afterward (ValKey
keys deleted, `data/write-ahead/` wiped, spawned processes killed by exact
PID — not by pattern-matched `pkill`, which on this shared machine matches
unrelated processes owned by other users and should be avoided). Keep
doing that.

---

## 6. One thing worth carrying forward, restated because it matters

**Five real bugs now, across five different pieces of work, all found by
actually running the code — none of them by the unit tests alone.** The
pattern repeats specifically wherever multiple things interact: two
processes racing on a filesystem probe, a resume path nobody ever called,
a log line that made sense until two payments were in flight at once, an
identifier chain that only got built for one of two symmetric cases. Unit
tests, however thorough, mock away exactly the interaction that broke.
**Anything upcoming that touches multiple components, real timing, or a
capture record nobody has specifically driven through the pipeline before
(item 2's interleaved slice is exactly that) deserves the same treatment:
reason through it by hand first, then prove it live — not just add a mock
and call it covered.**

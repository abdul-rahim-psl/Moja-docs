# Continue — after live verification

Handoff document for picking this work back up in a new chat. Written at
the point where Phase 2/4 hardening (atomic compare-and-merge, the durable
write-ahead store, persist-and-retrieve, out-of-order handling) is not just
built but **live-verified** against the real local stack — two real bugs
found and fixed in the process, neither caught by the unit tests.

**Supersedes** [`continue - after all 4 msgs.md`](continue%20-%20after%20all%204%20msgs.md)
for "what's next" — that document (and the phase-1 one before it) are left
as-is for their own historical record. **Don't re-derive what's already
written down**: `plan-outline.md`'s "Current status" section, Phase 2/4
checklists, and Technical Design §3.4/§3.7/§7.4/§7.5 already have the full
account of what was built, what broke, how it was fixed, and exactly what
was and wasn't proven live. Read those first if you need the detail. This
document exists for one thing: **what's next, reframed.**

---

## 1. Where this leaves the POC

Everything through Phase 2 and the durable-store/persist-and-retrieve slice
of Phase 4 is built, tested, and live-verified — not just against mocks,
against a real running PPA process, the real `tazama-valkey-1` container,
and a real replay of `04_ZMW_to_EGP_partition_split` through the actual
compiled MLA code. Phase 3 (translation, all four message types) has been
live-verified since the previous session. In short: **the core pipeline
works, for real, on real capture data, including the out-of-order race the
capture pack exists to prove is real.**

What's left standing between here and "done" is one genuinely blocked item
and a long tail of Phase 4–7 work that was always understood to be
deployment-stage. That tail is the subject of this document.

---

## 2. The one blocked item — set aside, not forgotten

**Error-path translation** (`pacs.002` with `TxSts: RJCT`) cannot be built
or tested properly: `DRPP_Kafka_E2E_Pack` contains zero rejected, aborted,
or error-callback transactions — nothing to build the mapping against or
verify it with. This is blocked on COMESA providing error-path captures,
already flagged in `plan-outline.md`'s "Open questions" section. **There is
nothing productive to do here right now.** Don't start speculative work
against a message shape nobody has actually observed — that's exactly the
mistake the capture-driven approach this project has followed throughout
was meant to avoid.

Everything below is what's left once that one item is set aside.

---

## 3. What's next — bringing the POC to a presentable state

The instruction driving this list: **do the core and fundamental work
first.** Not everything in Phases 4–7 is equally load-bearing for a POC —
some of it (mTLS, Keycloak, Kubernetes manifests) was always classified as
deployment-stage, gated on an environment this project doesn't have. That
classification hasn't changed, and pulling it forward now would mean doing
production-hardening work with no infrastructure to validate it against —
exactly the trap of building "confidence" that isn't real. The list below
is everything that **is** achievable right now, on the local stack, without
COMESA or any other external dependency, ordered so the most load-bearing
work (closing out what's already 90% there, then making the POC provable
and demoable by someone who isn't in this chat) comes first.

### Tier 1 — finish what's already started (cheapest, highest-confidence wins)

1. ~~**Operator-triggered replay for the durable store** (Phase 4)~~ — **done
   and live-verified**, in the session that produced this update.
   `POST /admin/replay/:key` (`operatorReplayParkedState` →
   `CacheClient.restoreState`, a new full-snapshot-replace Lua script)
   restores a parked leg back into ValKey with a fresh TTL. Confirmed live
   against real `tazama-valkey-1` and a running PPA: parked → not in ValKey
   → replay → `200 RESTORED` with every field intact → replayed again,
   still `200` (non-destructive read, confirmed repeatable) → a never-parked
   key correctly `404`s. Test count 120 → 132. Full account in
   `plan-outline.md`'s "Current status" and Phase 4 checklist. No longer on
   this list — see #2 for the next actionable item.
2. ~~**Close the one specific live-verification gap flagged in the previous
   continue doc's §3.6 and Technical Design §7.5**~~ — **done and
   live-verified**, in the session that produced this update. Ran the PPA
   with a fast-demo config (`CORRELATION_TTL_SECONDS=8`,
   `PARK_SWEEP_INTERVAL_SECONDS=2`, `PARK_SWEEP_THRESHOLD_SECONDS=6`, env
   overrides only, not new defaults); posted a real `putFxQuotesByID`
   capture record through the real compiled MLA pipeline, watched the
   sweep park it three times as its ValKey TTL ran down, waited 15s and
   confirmed the ValKey entry genuinely gone (`EXISTS` → 0), then posted
   the matching real `commitTransfer` record — the first and only message
   sent for this leg's settlement side. TMS accepted the resulting
   `pacs.002` (`degraded: false`) **51ms** after the PPA received it — far
   too fast to be the bounded ValKey-retry path, which is the quantitative
   proof `retrieveParkedState` resolved it on the first check. No new code;
   this closed a verification gap, not a code gap. Full account in
   `plan-outline.md`'s Phase 2 exit criterion and "Current status". No
   longer on this list — see #3 for the next actionable item.
3. ~~**Multi-replica confirmation**~~ — **done and live-verified**, in the
   session that produced this update, and it earned its place on this list:
   it caught a real bug, not the one it was aimed at. Two genuinely
   independent PPA processes (`:3002`/`:3003`, same real `tazama-valkey-1`)
   were fed five real capture records for one leg, fired concurrently and
   alternated across both. The atomic merge itself held — that part worked
   first try. What didn't: 3 of 5 requests came back `503`, because
   `writeAheadStore.isReachable()`'s reachability probe used a **fixed**
   filename (`.probe`) — two concurrent calls on the same replica could
   race their write/unlink pairs, and the loser hit `ENOENT` on a file the
   other had already removed, reporting a healthy store as down. Fixed with
   `randomUUID()` per probe call — the same fix the WAL temp-file collision
   got earlier. Re-verified live on a clean run after the fix: all 5
   requests `200`, all five state fields landed intact and unclobbered
   (`quote`, `quoteCallback`, `fxQuote`, `fxQuoteCallback`, `fxTransfer`),
   both quote triggers (`pain.001` from one replica, `pain.013` from the
   other) reached TMS, corroborated on its own logs. Full account in
   `plan-outline.md`'s "Current status" and Phase 6 checklist. No longer on
   this list — see Tier 2 for the next actionable items.

### Tier 2 — operability essentials (what makes a review or demo look credible, not just work) — ✅ all three done and live-verified

4. ~~**`correlationId` propagation audit.**~~ — **done**, and it wasn't just
   confirmation: found and fixed two real gaps. `sendToTms`'s five log
   lines carried only `messageType`, nothing identifying *which* payment —
   now takes `correlationId` as a required parameter. MLA's
   pre-`buildEnvelope` error/debug logs dropped the trace-tag identifiers
   already available at that point - fixed with a new `logIdentifierFor`
   helper. Live-verified against a real running PPA. No longer on this
   list.
5. ~~**Basic metrics.**~~ — **done and live-verified.** New
   `ppa/src/services/metrics.service.ts` + `GET /metrics` (JSON), covering
   exactly the list this item named: degraded-message rate,
   discarded-domestic count, discarded-duplicate-notification count,
   parked-and-retrieved counts, TMS send outcomes, plus the new circuit
   breaker's state. Wired into every real branch point that already decided
   these outcomes, not a parallel bookkeeping system. Live-verified: real
   traffic through a live PPA moved `/metrics` from all-zero to the
   expected counts, corroborated on TMS's own logs. No longer on this list.
6. ~~**Circuit breakers on both hops.**~~ — **done and live-verified, and it
   found a real bug**: `KafkaConsumerClient.resume` was defined but never
   called by anything, so a paused MLA partition previously stayed paused
   forever with no way back once PPA recovered. Built both: PPA→TMS is a
   standard closed/open/half-open breaker gating `sendToTms` (fails fast on
   sustained failure, a 4xx never trips it); MLA→PPA is `tripAndPause` +
   a periodic `GET /health/ready` re-probe that resumes paused partitions
   once PPA answers healthy. **Live-verified, full lifecycle, both hops**,
   without touching the shared `tazama-tms-1` container (a small
   self-controlled mock TMS stood in) - PPA's breaker taken through
   closed→open→fail-fast→half-open→closed; MLA's through a genuine
   `ECONNREFUSED` → trip → confirmed-not-resuming while still down → a real
   PPA process spawned → re-probed and resumed within one real interval.
   No longer on this list. Full account in `plan-outline.md`'s Phase 6
   checklist and "Current status".

### Tier 3 — make the POC provable by someone who isn't in this chat

7. ~~**Turn the scratch replay script into a saved, real tool.**~~ — **done
   and live-verified**, in the session that produced this update.
   `mla/src/scripts/demo-replay.ts`, run as `npm run demo:replay -- <capture
   folder-or-file>`: real `parseAuditMessage`/`isCanonicalRecord`/
   `classifyEventType`/`hasFspiopSignature`/`buildEnvelope`/`dispatchToPpa`
   against one capture file, sequentially, printing each record's outcome.
   Accepts a direct file path too, not just a folder, so it's already ready
   for item 8's `raw_topic_slice_partition2.json`. Live-verified by actually
   running it against `01_MWK_to_ZMW_PRIMARY` and a live PPA: 7 dispatched,
   13 correctly skipped, the same `pain.001`/`pain.013`/`pacs.008`/
   `pacs.002` sequence prior manual sessions produced, corroborated on
   `tazama-tms-1`'s own logs. **It paid for itself immediately**: the very
   first run surfaced a real, previously-uncaught gap - `reserveFxTransfer`
   has no anchor-identifier chain fallback the way `putQuotesByID` does, so
   `buildEnvelope` throws for it every time (low impact today, since
   nothing reads the field it would have populated, but a real gap
   regardless). Flagged, not fixed - out of this item's scope, tracked in
   `plan-outline.md`'s Phase 1 checklist. No longer on this list.
8. **Replay the interleaved partition-2 slice** (`raw_topic_slice_partition2.json`)
   as a proper regression fixture (Phase 7). It's the only capture artefact
   that exercises double-writes and interleaving realistically — the
   per-transaction folders are pre-filtered and flatter than production.
   Not blocked; just not done yet.
9. **A basic local load/soak run** against the local stack. Won't produce a
   real number to validate the 25/125 TPS baseline against (that genuinely
   needs production data this POC doesn't have), but running a sustained
   burst through the real pipeline — MLA → PPA → TMS, ValKey and the
   write-ahead store under continuous load — is a different and valuable
   claim: *does it hold up, not just work once*. Worth doing even with a
   made-up target number.

### Tier 4 — security/audit basics worth having even in a POC

10. **A real audit log store**, even a simple one (the write-ahead store's
    own file-per-record pattern would work fine here too) — currently a
    structured log line stands in for this, explicitly marked as a
    placeholder. Low effort given the pattern already exists in this
    codebase; makes "what happened to this payment" answerable by more
    than grepping stdout.
11. **A first pass at PII masking**, even partial. Already documented as
    "genuinely partial, not end-to-end" (the ILP packet's cryptographic
    binding means full tokenization isn't achievable regardless), but a
    keyed-HMAC pass over identifiers before they reach logs/audit is a
    real, presentable improvement over cleartext today, and doesn't require
    solving the ILP-packet problem to be worth doing.

### Explicitly not on this list, and why

**mTLS (both hops), the Auth-lib→Keycloak token chain, and Kubernetes
manifests are deliberately excluded.** This isn't "blocked" in the COMESA
sense — it's that this project's own Technical Design (§5) already
classifies this tier as deployment-stage work, and the local stack doesn't
have a Keycloak instance or any deployment target to validate mTLS/K8s
config against (checked: `docker ps` on the shared local Tazama stack shows
no auth/Keycloak service). Building this now would mean writing
configuration nobody can verify, which produces the appearance of progress
without the substance — the same trap this project has avoided everywhere
else by insisting on live verification over trusting the design on paper.
**If "presentable" is meant to include this tier, that's a scope decision
worth making explicitly, not assuming.**

**JWS (`FSPIOP-Signature`) validation** stays off this list too, but for a
narrower reason than "deployment-stage": Open Item #3 asks whether the
signature survives the transfer topics' base64 data-URI wrapping into the
Kafka event at all. This might actually be answerable from the *existing*
`DRPP_Kafka_E2E_Pack` captures already on disk — the signature check
(`content.headers['fspiop-signature']`) is a header field, not something
inside the wrapped payload, so it's worth specifically checking whether
transfer-family records (not just the quote-family ones already confirmed)
carry it — before assuming this needs COMESA the way item 2 above does.
Flagged here as "check before assuming blocked," not added to the plan as
either blocked or actionable.

---

## 4. Local dev environment — how to pick this up and run it

Unchanged in shape from the previous continue doc; repeated briefly here
since it's the one thing genuinely needed to act on anything above.

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

# Health check - /health/ready is a real reachability probe now, both
# services, not a hardcoded UP
curl localhost:3001/health/ready
curl localhost:3002/health/ready
```

`ppa/.env` carries the durable-store/park-sweep config added this round
(`WRITE_AHEAD_DIR`, `PARK_SWEEP_*`) — defaults are fine to run with as-is;
see `.env.template` for what each does. `data/write-ahead/` (gitignored) is
where the write-ahead store's files land; safe to delete between runs.

**The replay pattern used for every live check so far** (the previous
continue doc's §3.3, the atomic-merge run, and all of §3.6): require the
compiled MLA build's
`parseAuditMessage`/`isCanonicalRecord`/`classifyEventType`/`buildEnvelope`
directly, feed it records from any `DRPP_Kafka_E2E_Pack/*/raw_messages.json`
folder, and either call `dispatchToPpa` (uses `mla/.env`'s `PPA_BASE_URL`)
or POST the built envelopes yourself to the PPA's routes. Tier 3 item 7
above is exactly "stop reconstructing this from scratch each time."

---

## 5. One thing worth carrying forward, restated because it matters

**Reasoning through a multi-envelope replay by hand caught one bug before
ever touching a live process; actually running it live caught the other.**
Neither was reachable by the existing mocked unit tests, because both bugs
were about *sequencing* across separate `processEnvelope` calls, not about
any single function's logic in isolation. Anything in the list above that
touches multi-step, multi-process, or multi-replica behaviour (items 1–3
especially) deserves the same treatment: trace the actual sequence by hand
first, then prove it live — not just add a mock and call it covered.

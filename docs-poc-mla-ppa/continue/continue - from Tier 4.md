# Continue — after Tier 3

Handoff document for picking this work back up in a new chat. Written at
the point where **Tier 1 (durability/concurrency hardening), Tier 2
(operability essentials), and all three Tier 3 items (make the POC provable
by someone who isn't in this chat) are fully done and live-verified.**

**Updated in place, not superseded**, now that Tier 4 item 1 (a real audit
log store) is also done and live-verified — see §1. Only one of Tier 4's
two items is done, not the whole tier, so this stays an in-place update per
this project's own rule (a fresh handoff doc gets written at a whole-tier
milestone, not partway through one).

**Supersedes** [`continue - after Tier 3 item 1.md`](continue%20-%20after%20Tier%203%20item%201.md)
for "what's next" — that document (and the ones before it) are left as-is
for their own historical record. **Don't re-derive what's already written
down**: `plan-outline.md`'s "Current status" section has the full account
of every item below — what was built, what broke, how it was fixed, and
exactly what was and wasn't proven live. Read that first if you need the
detail. This document exists for one thing: **what's next, reframed.**

---

## 0. How this session wants to work — read this before starting

**The user set an explicit cadence: one action item at a time, then stop
and wait to be told to continue.** Don't chain multiple Tier 3/4 items
together in one turn even if the next one seems obvious — finish the one
asked for, report it (see the TL;DR format below), and stop. This isn't a
soft preference; it was stated directly in an earlier session and has held
across every session since — carry it forward by default until told
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
live-verified before Tier 1/2/3 started. **Tier 1, Tier 2, and all of Tier
3 are now closed:**

- **Tier 1** (finish what's already started): operator-triggered replay,
  the swept-and-parked-state live-verification gap, and multi-replica
  confirmation — all done, live-verified, two found real bugs (a
  fixed-name reachability-probe race; a late-notification recovery path
  firing at the wrong moment).
- **Tier 2** (operability essentials): `correlationId` propagation audit,
  minimal `/metrics`, circuit breakers on both hops — all done,
  live-verified, two more found real bugs (missing correlationId in the
  busiest log lines; `KafkaConsumerClient.resume` defined but never called).
- **Tier 3 item 1** (saved replay tool, `demo:replay`): done, live-verified,
  and found a fifth real bug on its first run (`reserveFxTransfer` had no
  anchor-identifier chain fallback). **That gap is now fixed too** — same
  shape as the existing `quoteId` chain, live-verified with the same tool
  that found it. New regression test, fixture set extended (records 8–9).
- **Tier 3 item 2** (interleaved partition-2 slice as a regression
  fixture): done, live-verified — `demo:replay` took the raw 41-record
  slice as-is, no plumbing needed, and it's now a permanent automated test
  (`partition2-slice.test.ts`), the first fixture covering more than one
  transaction's worth of records. **Also corrected a real inaccuracy found
  by looking closely**: the slice's documented "four transactions
  interleaved" is actually three, sequential within the slice, not
  alternating record-by-record — fixed in `plan-outline.md`'s *Capture
  analysis* section.
- **Tier 3 item 3** (basic local load/soak run): done, live-verified — a
  new tool, `demo:loadtest`, ran 1,059 synthetic transactions (8,472
  accept-and-persist calls) over a sustained 30s burst at concurrency 5,
  zero failures, 4,236 real messages reached TMS, corroborated by TMS's own
  container logs. **Found and fixed a real methodology gap in the tool
  itself** (not a pipeline bug): a `/metrics` snapshot taken the instant
  the last request acks can under-read, because the PPA acks an envelope
  and returns `200` *before* running the rest of the pipeline
  asynchronously (§6.3 steps 1-2 vs 3-10, by design) — fixed by draining
  `/metrics` until its totals stop moving before reporting a final
  snapshot.

**Running total: five real pipeline bugs found by this project's "prove it
live" discipline, across five different pieces of work, none of them
caught by unit tests alone — all five now fixed and live-verified fixed.**
A sixth, related but distinct finding this session: the load-test tool's
own metrics-snapshot timing needed the same discipline applied to itself
(fixed, not a pipeline defect). The pattern is well-established enough to
trust as a predictor going into Tier 4, not a coincidence — see §5 below.

- **Tier 4 item 1** (a real audit log store): done, live-verified — no new
  bug this time, the running total above is unchanged. New file
  [`ppa/src/clients/audit-log.store.ts`](../../ppa/src/clients/audit-log.store.ts),
  same file-per-record pattern as the write-ahead store but append-only,
  indexed by the payment's own anchor id (not the throwaway per-message
  `correlationId`) so a lookup answers "what happened to this payment", not
  "what happened to this one message". New `GET /admin/audit/:key` route.
  Full account, including the live run against a real capture and TMS's own
  logs corroborating it: `plan-outline.md`'s *Current status* section.

What's left is one still-genuinely-blocked item (§2) and Tier 4 item 2 (§3).

---

## 2. The one still-blocked item — set aside, not forgotten

**Error-path translation** (`pacs.002` with `TxSts: RJCT`) cannot be built
or tested properly: `DRPP_Kafka_E2E_Pack` contains zero rejected, aborted,
or error-callback transactions — nothing to build the mapping against or
verify it with. Blocked on COMESA providing error-path captures. Unchanged
across every session so far. **Nothing productive to do here right now** —
don't start speculative work against a message shape nobody has actually
observed.

---

## 3. What's next — Tier 4, in order

### Tier 4 — security/audit basics worth having even in a POC

4. ~~**A real audit log store**~~ — **done, live-verified, see §1 above.**
   No longer on this list.
5. **A first pass at PII masking**, even partial — **the one item left in
   Tier 4.** Already documented as "genuinely partial, not end-to-end" (the
   ILP packet's cryptographic binding means full tokenization isn't
   achievable regardless), but a keyed-HMAC pass over identifiers before
   they reach logs/audit is a real, presentable improvement over cleartext
   today, and doesn't require solving the ILP-packet problem to be worth
   doing. The audit log store item 4 just closed is exactly where this
   would plug in — `auditLogStore.append`'s `detail`/the envelope body it
   persists are unmasked today, same as the log line this replaced.

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

## 4. Local dev environment — how to pick this up and run it

Unchanged in shape from every previous continue doc.

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

# A real metrics surface, worth checking after any run
curl localhost:3002/metrics

# "What happened to this payment" - real, on-disk audit trail (Tier 4 item 1).
# :key is the payment's anchor id (TransactionState.key / EventEnvelope.id),
# same identifier POST /admin/replay/:key already uses - NOT the MLA-generated
# correlationId any individual message carries.
curl localhost:3002/admin/audit/<key>
```

`ppa/.env` carries the durable-store/park-sweep config (`WRITE_AHEAD_DIR`,
`PARK_SWEEP_*`), the audit log store's `AUDIT_LOG_DIR`, and the
circuit-breaker config (`TMS_CIRCUIT_FAILURE_THRESHOLD`,
`TMS_CIRCUIT_COOLDOWN_MS`) — defaults are fine to run with as-is; see
`.env.template` for what each does. `mla/.env` has the matching
`PPA_REPROBE_INTERVAL_MS`. `data/write-ahead/` and `data/audit-log/` (both
gitignored) are where the two durable stores' files land; safe to delete
between runs.

**Two real, checked-in tools now exist — use them instead of writing a
scratch script:**

```bash
cd mla

# Replay one real capture through the actual compiled pipeline, once, in order:
npm run demo:replay -- "../../DRPP_Kafka_E2E_Pack 2/DRPP_Kafka_E2E_Pack/01_MWK_to_ZMW_PRIMARY"
# or the interleaved partition-2 slice (also checked into
# mla/__tests__/fixtures/raw_topic_slice_partition2.json):
npm run demo:replay -- "../../DRPP_Kafka_E2E_Pack 2/DRPP_Kafka_E2E_Pack/raw_topic_slice_partition2.json"

# Sustained concurrent load against the real pipeline, for a set duration:
npm run demo:loadtest -- "../../DRPP_Kafka_E2E_Pack 2/DRPP_Kafka_E2E_Pack/01_MWK_to_ZMW_PRIMARY" 30 5
#                                                                                                  ^duration(s) ^concurrency
```

Both require a running PPA at `PPA_BASE_URL` (`.env`). `demo:replay` prints
each record's stage, skip reason, or dispatch outcome; `demo:loadtest`
clones one capture into many synthetic transactions (fresh ids on the trace
tags only, real body content) and reports throughput/latency plus a
*drained* `/metrics` before/after comparison — read its own header comment
if picking this up again, it explains exactly what "latency" does and
doesn't measure (accept-and-persist, not full pipeline — §6.3). Neither
tool touches a Kafka offset; both are standalone.

**A caveat worth carrying forward**: replaying the same real transaction's
data twice in one session without clearing ValKey in between will make its
terminal notification look like a genuine duplicate the second time (the
sent-dedup guard working correctly, not a bug). `docker exec` into
`tazama-valkey-1` to inspect/clear `correlation:*`/`sent:*` keys directly is
blocked in this sandbox — but **`docker logs` is not** (confirmed working;
only `exec` is restricted, `ps`/`logs` are fine). The local write-ahead
store's `parked/` folder is a reliable way to spot what got left behind if
`docker logs` isn't enough; stale ValKey keys expire on their own TTL
regardless.

**Live-verification habit worth carrying forward explicitly**: every live
check across every session so far cleaned up its own demo state afterward
(spawned processes killed by exact PID — not pattern-matched `pkill`, which
on this shared machine matches unrelated processes owned by other users —
and `data/write-ahead/`, now also `data/audit-log/`, wiped between runs).
Keep doing that.

---

## 5. One thing worth carrying forward, restated because it matters

**Five real pipeline bugs now, across five different pieces of work, all
found by actually running the code — none of them by the unit tests
alone — plus a sixth, related finding this session in the load-test tool's
own metrics timing.** The pattern repeats specifically wherever multiple
things interact: two processes racing on a filesystem probe, a resume path
nobody ever called, a log line that made sense until two payments were in
flight at once, an identifier chain that only got built for one of two
symmetric cases, a fire-and-forget ack racing a metrics read. Unit tests,
however thorough, mock away exactly the interaction that broke.
**Anything upcoming that touches multiple components, real timing, or
genuine concurrency deserves the same treatment: reason through it by hand
first, then prove it live — not just add a mock and call it covered.** The
audit store (done this session) held to it and turned up nothing new to
fix, which is itself informative — not every item will find a bug, but the
discipline is what makes that a trustworthy negative result rather than an
untested assumption. PII masking, the one item left in Tier 4, touches the
same hot path every request goes through and deserves the same treatment
going in.

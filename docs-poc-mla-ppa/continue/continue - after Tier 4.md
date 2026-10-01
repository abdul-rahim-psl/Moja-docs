# Continue — after Tier 4

Handoff document for picking this work back up in a new chat. Written at
the point where **every tier `continue.md` ever tracked — Tier 1, Tier 2,
Tier 3, and now Tier 4 — is fully done and live-verified.** There is no
Tier 5 on this project's list. What's left is exactly one still-blocked
item and a short, explicitly-scoped-out list of deployment-stage work —
see §2 and §3.

**Supersedes** [`continue - from Tier 4.md`](continue%20-%20from%20Tier%204.md)
for "what's next" — that document (and the ones before it) are left as-is
for their own historical record, matching how this project has always
marked a real milestone: a fresh handoff doc at a whole-tier close, not a
patch to the old one. **Don't re-derive what's already written down**:
`plan-outline.md`'s "Current status" section has the full account of every
item below — what was built, what broke, how it was fixed, and exactly
what was and wasn't proven live. Read that first if you need the detail.
This document exists for one thing: **what's next, reframed.**

---

## 0. How this session wants to work — read this before starting

**The user set an explicit cadence: one action item at a time, then stop
and wait to be told to continue.** Don't chain multiple items together in
one turn even if the next one seems obvious — finish the one asked for,
report it (see the TL;DR format below), and stop. This isn't a soft
preference; it was stated directly in an earlier session and has held
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
live-verified before Tier 1 started. **Tier 1 through Tier 4 are now
closed, in full:**

- **Tier 1** (finish what's already started): operator-triggered replay,
  the swept-and-parked-state live-verification gap, and multi-replica
  confirmation.
- **Tier 2** (operability essentials): `correlationId` propagation audit,
  minimal `/metrics`, circuit breakers on both hops.
- **Tier 3** (make the POC provable by someone who isn't in this chat): a
  saved replay tool (`demo:replay`), the interleaved partition-2 slice as a
  permanent regression fixture, and a basic local load/soak run
  (`demo:loadtest`, 1,059 synthetic transactions over 30s, zero failures).
- **Tier 4** (security/audit basics worth having even in a POC): a real
  audit log store (`ppa/src/clients/audit-log.store.ts`, `GET
  /admin/audit/:key`) and a first pass at PII masking
  (`ppa/src/services/pii-mask.service.ts`, keyed HMAC over party
  identifiers before they reach a log line or the audit store) — both
  done, live-verified, this session.

**Running total: six real bugs found in shipped code by this project's
"prove it live" discipline, across six different pieces of work, none of
them caught by unit tests alone — all six now fixed and live-verified
fixed.** Plus one distinct, related finding in a *testing tool* rather than
shipped code (the load-test tool's own metrics-snapshot timing, Tier 3 item
3 — fixed, not a pipeline defect, called out separately because it's not
the same category of finding). In order:

1. A fixed-name reachability-probe race (`write-ahead.store.ts`, Tier 1).
2. A late-notification recovery path firing at the wrong moment (Tier 1).
3. Missing `correlationId` in the busiest log lines (Tier 2).
4. `KafkaConsumerClient.resume` defined but never called (Tier 2).
5. `reserveFxTransfer` had no anchor-identifier chain fallback (Tier 3
   item 1).
6. **New this session**: the audit log store's filename scheme
   (`<Date.now()>-<randomUUID>.json`) did not actually preserve insertion
   order — a random suffix guarantees no filename collision, but does
   nothing to guarantee sort order when two calls share the same
   millisecond, which ordinary sequential `await`ed calls do routinely,
   not just under contrived concurrency. Found while building Tier 4 item
   2 (PII masking), in Tier 4 item 1's code, not item 2's. Confirmed with a
   standalone deterministic repro (50 sequential calls, ~1/3 landed out of
   order) before touching any code. **Fixed**: a synchronous, per-process,
   strictly-increasing sequence number as the real tiebreaker, kept
   secondary to `Date.now()` (not replacing it) so ordering still survives
   a process restart mid-payment. New regression test at 200 sequential
   calls. Full account, including why the original reasoning was wrong:
   `plan-outline.md`'s *Current status* section and
   `ppa/src/clients/audit-log.store.ts`'s own comments.

**The pattern remains a trustworthy predictor, not a coincidence — six for
six pieces of shipped work that touched multiple components or real
timing.** Tier 4 item 1 alone (the audit store's *build*) found nothing;
it was item 2's *test-writing* — many rapid sequential calls — that
surfaced item 1's latent bug. Worth remembering going forward: a
component can pass its own live-verification run and still be carrying a
timing bug that only a different, later piece of work happens to exercise
hard enough to surface. See §4 below.

**Everything that was open going into Tier 4 is now closed. There is
nothing left to do on this project's own list** except the one
still-blocked item below (§2) and the deliberately-excluded deployment-stage
work (§3) — neither of which is actionable from inside this environment
right now.

---

## 2. The one still-blocked item — unchanged, set aside, not forgotten

**Error-path translation** (`pacs.002` with `TxSts: RJCT`) cannot be built
or tested properly: `DRPP_Kafka_E2E_Pack` contains zero rejected, aborted,
or error-callback transactions — nothing to build the mapping against or
verify it with. Blocked on COMESA providing error-path captures. Unchanged
across every session so far, including this one. **Nothing productive to
do here right now** — don't start speculative work against a message shape
nobody has actually observed.

---

## 3. What's explicitly not on any list, and why — unchanged from Tier 4

No new tier exists to move on to. What remains is the same deployment-stage
and blocked-elsewhere work every prior continue doc has named and declined
to build against a local environment with nothing to verify it with:

**mTLS (both hops), the Auth-lib→Keycloak token chain, and Kubernetes
manifests.** Not "blocked" in the COMESA sense — Technical Design §5
already classifies this as deployment-stage work, and the local stack has
no Keycloak instance or deployment target to validate against (checked:
`docker ps` on the shared local Tazama stack shows no auth/Keycloak
service). Building this now would be writing configuration nobody can
verify — the same trap this project has avoided everywhere else by
insisting on live verification over trusting the design on paper.

**Full PII tokenization** (the component the FSD places upstream of the
MLA, distinct from Tier 4 item 2's audit/log masking pass this session
closed) — genuinely blocked by the ILP packet's cryptographic binding, not
by effort. Tier 4 item 2's own account in `plan-outline.md` explains
exactly where the boundary sits.

**JWS (`FSPIOP-Signature`) validation** stays off this list too, for a
narrower reason: Open Item #3 asks whether the signature survives the
transfer topics' base64 data-URI wrapping into the Kafka event at all. This
might be answerable from the *existing* captures already on disk — worth
specifically checking whether transfer-family records carry
`content.headers['fspiop-signature']` (not just the quote-family ones
already confirmed) before assuming this needs COMESA. Flagged as "check
before assuming blocked," not added to the plan as either blocked or
actionable — unchanged, still worth doing if this project picks back up
again with nothing else pending.

**Notification Filter/Dedup component** — architecturally separate from
anything built so far; per the IDD its Phase 1 deployment is embedded in
the MLA/PPA containers with no separately-provisioned container in the
baseline sizing. Not started, not blocked, just genuinely a different
scope than anything this POC has built toward.

If any of the above is meant to become in-scope, that's a scope decision
worth making explicitly with the user — not something to assume from
"nothing else is on the list."

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

# "What happened to this payment" - real, on-disk audit trail (Tier 4 item 1),
# with party identifiers masked wherever they appear (Tier 4 item 2).
# :key is the payment's anchor id (TransactionState.key / EventEnvelope.id),
# same identifier POST /admin/replay/:key already uses - NOT the MLA-generated
# correlationId any individual message carries.
curl localhost:3002/admin/audit/<key>
```

`ppa/.env` carries the durable-store/park-sweep config (`WRITE_AHEAD_DIR`,
`PARK_SWEEP_*`), the audit log store's `AUDIT_LOG_DIR`, the PII masking
key (`PII_MASK_KEY` — ships with a loudly-warned POC-only default if
unset, see `.env.template`; generate a real one with `openssl rand -hex
32` before anything but local/demo use), and the circuit-breaker config
(`TMS_CIRCUIT_FAILURE_THRESHOLD`, `TMS_CIRCUIT_COOLDOWN_MS`) — defaults
are otherwise fine to run with as-is. `mla/.env` has the matching
`PPA_REPROBE_INTERVAL_MS`. `data/write-ahead/` and `data/audit-log/`
(both gitignored) are where the two durable stores' files land; safe to
delete between runs — **and worth deleting before a live check, not just
after**, if a lot of `npm test` runs happened first in the same working
copy: several test fixtures deliberately reuse the same real anchor id
this project's live captures use, and tests that don't override
`configuration.*.rootDir` to a temp directory write real files into the
same default `data/` paths a live run reads from. Caught this directly
this session — a live audit-trail check briefly showed leftover test
entries mixed in with real ones until `data/` was wiped first. Not a bug,
just a hygiene step worth doing at the *start* of a live-verification pass
now, not only the end.

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
(spawned processes killed by exact PID — not pattern-matched `pkill`,
which on this shared machine matches unrelated processes owned by other
users — and `data/write-ahead/`/`data/audit-log/` wiped between runs).
This session additionally confirms it's worth wiping **before** a live
check too, not just after — see the caveat above.

---

## 5. One thing worth carrying forward, restated because it matters

**Six real bugs now, in shipped code, across six different pieces of
work, all found by actually running the code — none of them by the unit
tests alone — plus one distinct, related finding in a testing tool rather
than shipped code.** The pattern repeats specifically wherever multiple
things interact, or where volume/timing exposes something a small example
never would: two processes racing on a filesystem probe, a resume path
nobody ever called, a log line that made sense until two payments were in
flight at once, an identifier chain that only got built for one of two
symmetric cases, a fire-and-forget ack racing a metrics read, and now — a
sort order that held for three sequential test calls but broke under two
hundred. Unit tests, however thorough, mock away exactly the interaction
that broke, or simply don't run enough iterations to hit the millisecond
collision.

**This session's bug is the sharpest reminder yet of one specific
corollary**: Tier 4 item 1 (the audit store) passed its own live
verification cleanly — the bug was latent, not visible, until a *later,
different* piece of work (item 2's tests) happened to call the same
function many times in a tight sequential loop. A clean live-verification
run proves a component works under the conditions it was actually
exercised with; it does not prove there's no latent timing assumption
still sitting inside it. **Nothing left on this project's list is asking
for that kind of scrutiny right now** (§2's blocked item and §3's
deliberately-excluded work don't have local build-and-verify paths), but
if this project resumes with new work of its own, carry the habit
forward: reason through concurrency/ordering assumptions explicitly, don't
just trust that "it passed live verification once" means the assumption
was actually tested, and prove it live with volume, not just with a single
clean pass.

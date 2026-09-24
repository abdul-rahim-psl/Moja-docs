<!-- SPDX-License-Identifier: Apache-2.0 -->

# QA Sweep 2 — Quick Reference (problem / context / solution)

Condensed companion to [`qa-sweep-2-findings.md`](qa-sweep-2-findings.md) — full detail, verified-live reproductions, and the correctness gate all live there. This file is for fast recall only: each finding in 2-3 lines per section.

Each headline is labelled against the five source documents in [`user stories/`](../user%20stories/): either the story ID(s) whose specified or described behaviour the finding's underlying defect actually breaks, or **NOT IN USER STORIES** where no story addresses it at all — a pure implementation detail, code-quality concern, or a gap one level below what any story's acceptance criteria commits to. A label is only applied where the story text genuinely covers the behaviour in question, not merely the same subsystem.

---

### F-23 — Critical — Health probe can't pass real PPA's mTLS, so a tripped partition never resumes — US-MLA-07, US-PPA-01

- **Problem:** Once a PPA breaker trips, the health probe used to decide when to retry always fails against the real PPA, so the partition never resumes delivery — even after PPA is healthy again.
- **Context:** MLA's probe sends no client cert; real `cch-ppa` serves health routes on the same mTLS listener as business routes. Masked in every environment tested so far because they all run with mTLS disabled.
- **Solution:** **Parked.** PPA engineer is removing mTLS from PPA's health endpoint — do not build until the real `cch-ppa` commit is seen and read directly.

### F-24 — High — Kafka startup failure is never retried; liveness stays UP forever — NOT IN USER STORIES

- **Problem:** If Kafka fails to connect/subscribe/run at startup, MLA never retries and consumes nothing, with no automatic recovery.
- **Context:** The startup `catch` just logs and returns; liveness is hardcoded `UP` regardless, so Kubernetes never restarts the pod. Verified live: broker down then recovered — MLA stayed dead.
- **Solution:** Exit non-zero on startup failure and on a `CRASH` with `restart: false`, so Kubernetes' own restart becomes the recovery path (F-09 precedent). Set `connected` only once `run()` succeeds, not on `CONNECT`.

### F-25 — High — PII secret is read once; the PII reprobe path can never heal; a pod without its secret still takes partitions — US-PII-02 — **DONE [2026-09-24]**

- **Problem:** If the PII secret is unavailable at boot, no amount of retrying in-process can ever fix it, since the secret is loaded exactly once. Meanwhile a not-Ready pod still joins the consumer group and freezes partitions.
- **Context:** The retry/park/reprobe machinery for this was built assuming secret rotation would eventually need a reload; rotation was later ruled out entirely, so the reprobe loop is now structurally dead weight.
- **Solution:** Treat an unavailable/invalid PII secret as fatal at boot — refuse to start. Needs a quick check with the user that this satisfies COMESA's "fail the transaction and retry" gate answer before building.

### F-26 — High — Secret content is never validated: empty file becomes an unkeyed hash; trailing newline changes every token — US-PII-02 — **DONE [2026-09-24]**

- **Problem:** Any readable file is accepted as the PII secret as-is. An empty file produces a public, guessable hash; a stray trailing newline silently produces different tokens than the same secret without one.
- **Context:** Verified live — empty secret gave a token an attacker could recompute; the same secret ± newline gave different tokens for the same input.
- **Solution:** Reject secrets below a minimum length (e.g. 32 bytes) at boot, define the exact expected format in the deploy README, and log a non-reversible fingerprint of the loaded key for cross-environment comparison.

### F-27 — High — Kafka connection has no TLS/SASL support, and the question has never been asked — NOT IN USER STORIES

- **Problem:** MLA can only connect to a plaintext, unauthenticated Kafka listener. If CCH's brokers require TLS/SASL, MLA can't connect at all; if they don't, raw pre-tokenization PII crosses the wire unencrypted.
- **Context:** No config option exists for this today, and it appears in no open-questions list anywhere in the docs.
- **Solution:** **CCH's decision**, not engineering's. Meanwhile, add optional TLS/SASL config (off unless explicitly set, validated at boot) so the eventual answer is a config change, not a code change.

### F-28 — High — Party PII outside the tokenize table reaches PPA/TMS in cleartext on QUOTE events — US-PII-01 — **PARTIALLY DONE [2026-09-24]** (payer.name/payee.name/payee.complexName fixed; quote-callback ilpPacket deferred as F-28b)

- **Problem:** Several real fields — `payer.name`, `payee.name`, `dateOfBirth`, `complexName`, and the quote callback's `ilpPacket` — aren't in the spec's tokenize table, so they reach PPA in cleartext even though the design intent is "PPA never sees raw PII".
- **Context:** The code correctly implements the spec table as written; the table itself just doesn't cover everything the real messages carry. Verified live against captured records.
- **Solution:** **Spec gap, CCH/story-author's call**, not a code defect. Take the field list to them as one question; each row they add becomes one line of config in the tokenize table.

### F-29 — Medium — No rebalance handling: stale reprobe loops keep running after a partition is reassigned — NOT IN USER STORIES

- **Problem:** On any rebalance (rolling update, scale event, restart), a partition's old owner keeps reprobing, delivering, and committing offsets for a partition it no longer owns — causing duplicate POSTs, backward-moving commits, and stale metrics/alerts on the wrong pod.
- **Context:** No `GROUP_JOIN` hook exists to cancel a loop when its partition is revoked; kafkajs itself doesn't clear paused state on reassignment either.
- **Solution:** Subscribe to `GROUP_JOIN`, cancel/deregister loops for partitions no longer owned, and give each loop a generation token so stale callbacks become no-ops.

### F-30 — Medium — Top-level `catch` is an unmetered, unalerted drop path — NOT IN USER STORIES

- **Problem:** Anything that throws inside the message handler is logged once and silently dropped — no metric, no alert, no commit — yet the loop moves on as if nothing happened.
- **Context:** One concrete way in today: `content.headers` isn't validated even though downstream code dereferences it unguarded. Verified live: removing `headers` from a canonical record throws exactly this way.
- **Solution:** Validate `content.headers` in the parser's shape check, and increment a dedicated counter (plus alert) in the top-level `catch` so this path is at least visible. Let kafkajs's own rebalance errors propagate instead of being swallowed here.

### F-31 — Medium — Typo'd topic name silently auto-creates an empty topic and reports fully healthy — NOT IN USER STORIES

- **Problem:** A misspelled `KAFKA_AUDIT_TOPIC` creates a brand-new empty topic (broker default) instead of failing, and every health signal — readiness, lag — reports normal forever, with nothing ever consumed.
- **Context:** `allowAutoTopicCreation` is left at kafkajs's default (`true`); lag on a group with no committed offset reads as `0`, identical to "fully caught up." Verified live.
- **Solution:** Set `allowAutoTopicCreation: false`, check topic existence at startup and fail if missing (via F-24's fix), and report lag as `high - low` when there's no committed offset instead of `0`.

### F-32 — Medium — Watchdog `retrigger` can spawn a second, concurrent reprobe loop on the same partition — NOT IN USER STORIES

- **Problem:** Under a long-enough delivery attempt, the watchdog can end up running two independent reprobe chains on one partition, each delivering (and counting "Forwarded") independently — a false-positive stall detector that then makes things worse.
- **Context:** Staleness is measured from tick *start*, not accounting for attempt duration; `retrigger` doesn't cancel the pending timer it's racing against; not reachable with today's defaults, but reachable within documented config bounds.
- **Solution:** Measure staleness from tick end, have `retrigger` clear the pending timer before firing, and add a generation number per loop (shared mechanism with F-29) plus a boot-time check that timeout/interval bounds can't combine to trigger this.

### F-33 — Medium — `complexName` tokens depend on JSON key order — US-PII-01, US-PII-02 — **CLOSED, NOT BUILT [2026-09-25]** (confirmed with user: no DFSP in scope varies field order, so the trigger doesn't occur)

- **Problem:** The same person's name can tokenize to two different values depending on which order a DFSP happens to serialize the name fields in — breaking the "same input, same token" guarantee.
- **Context:** Canonicalization is just `JSON.stringify`, which preserves incoming key order rather than normalizing it. Verified live: two key orders, two different tokens for the same name.
- **Solution:** Sort object keys recursively before hashing. **Deliberate output change** — must land before go-live, while no production token history exists to break.

### F-34 — Medium — `plan.md` §16's F-17 entry misdescribes the commit-retry recovery path — NOT IN USER STORIES

- **Problem:** The permanent progress-log record says one recovery path already retries only the commit (not a full re-delivery); in fact both recovery paths re-deliver to PPA on a commit failure.
- **Context:** Harmless in practice today because PPA's own idempotency key absorbs the duplicate, but whoever picks up F-17 later would be scoping against a wrong description.
- **Solution:** Documentation fix — correct the `plan.md` §16 F-17 entry. When F-17 is eventually built, fix both paths through one shared commit-only-retry helper (natural fit with Q-02).

### F-35 — Medium — URL scheme is never cross-checked against `PPA_MTLS_DISABLED` — NOT IN USER STORIES

- **Problem:** Delivery picks `http`/`https` from the mTLS flag, not from the actual URL scheme, and nothing checks the two agree — a mismatch reproduces F-23's "breaker never recovers" outcome by a different route.
- **Context:** Three concrete mismatch scenarios identified (flag says plain, URL says TLS, and vice versa on both health and business URLs); one verified live.
- **Solution:** Refuse to start if either URL's scheme disagrees with the mTLS flag — a small, independently testable boot-time check.

### F-36 — Medium — Every post-connect transport error is labelled a TLS handshake failure — NOT IN USER STORIES

- **Problem:** Any error after the TCP socket connects — including a plain keep-alive reset with mTLS fully disabled — gets classified and alerted as a TLS handshake failure, sending operators to check certificates for a plain network blip.
- **Context:** Classification currently only checks "did the socket connect," not "did TLS actually get used and negotiate."
- **Solution:** Track `secureConnect` separately from `connect`; only classify as a handshake failure when TLS was actually in use and never completed. Otherwise label it a generic network error.

### F-37 — Low — JSON parse errors leak PII fragments into the error log — NOT IN USER STORIES

- **Problem:** Node's own `SyntaxError` messages include a snippet of the bad input, so a malformed record with a partial MSISDN in it lands in the error log.
- **Context:** Verified — an unparseable record's error message included a partial phone-number-shaped fragment.
- **Solution:** Log the error position, not `err.message`, when logging a JSON parse failure.

### F-38 — Low — Shutdown cancels park timers before handlers finish draining — NOT IN USER STORIES

- **Problem:** On shutdown, park timers are cancelled before Kafka disconnects, but kafkajs still waits for in-flight handlers to finish — so a handler mid-retry-burst can register a brand-new timer after cancellation already ran.
- **Context:** `process.exit` currently masks the effect, so it hasn't caused a visible problem yet.
- **Solution:** Reorder shutdown so `cancelAll()` runs after `disconnect()`, not before.

### F-39 — Low — Internal finding IDs left in `src/` code and a Prometheus help string — NOT IN USER STORIES

- **Problem:** Several source comments and one metric's Grafana-facing help text cite specific finding numbers (F-03, F-07, F-10) instead of stating the underlying engineering reason.
- **Context:** Leftover from the earlier F-01–F-10 era, which predates the "no finding numbers in comments" rule.
- **Solution:** Rewrite each to state the durable reason directly; no behaviour change.

### F-40 — Low — Party-lookup traffic is metric-labelled as `egress`, not `party-lookup` — NOT IN USER STORIES

- **Problem:** 30% of captured traffic (`getPartiesByTypeAndID` calls) gets skipped correctly but counted under the wrong metric label, making an operator think there's a real egress problem when there isn't one.
- **Context:** These operations have no canonical row, so they fail canonical selection before ever reaching classification.
- **Solution:** Check for party-lookup operations before canonical selection (or add canonical rows for them) so they get their own label.

### F-41 — Low — Type/comment claims contradicted by real captures — NOT IN USER STORIES

- **Problem:** One interface types a tag as always-a-string when real captures show it can be a boolean; one comment describes a base64 decoding step that doesn't exist anywhere in the code.
- **Context:** Harmless today (nothing acts on the mistyped tag; the comment just misleads whoever reads it next), found by cross-checking against real captures.
- **Solution:** Fix the type to reflect reality; delete or correct the misleading comment.

### F-42 — Low — Pod runs with no Kubernetes `securityContext` — NOT IN USER STORIES

- **Problem:** No `runAsNonRoot`, `readOnlyRootFilesystem`, `allowPrivilegeEscalation: false`, or dropped capabilities are set — a cluster enforcing the `restricted` Pod Security Standard would reject the pod outright.
- **Context:** The distroless image already runs as non-root in practice, so this is a manifest gap, not a runtime one.
- **Solution:** Add the four standard fields to the deployment manifest; MLA writes nothing to disk, so a read-only root filesystem is safe.

---

## Code quality / refactors (no behaviour change — Q-01 … Q-07)

### Q-01 — One file threads the same 12 dependencies through five hand-written shapes — NOT IN USER STORIES

- **Problem:** `ingestion-consumer.service.ts` redeclares the same dependency set five different ways, copied field-by-field at four call sites — adding one dependency means editing nine places.
- **Solution:** One `PipelineDeps` object built once, passed alongside the existing per-record context everywhere.

### Q-02 — The two reprobe loops are one mechanism written twice — NOT IN USER STORIES

- **Problem:** The PII and PPA park/reprobe loops repeat the same timer/register/retry skeleton, so every related fix (F-29, F-32, F-34) has to be made twice and can drift apart.
- **Solution:** Extract one shared `startReprobeLoop` helper; both park functions shrink to just their attempt logic.

### Q-03 — A domain abstraction now generalizes over exactly one domain — NOT IN USER STORIES

- **Problem:** `TransientDependencyDomain` was built for two outage types (JWS + PII); JWS is gone, so it's now a generic abstraction wrapping a single case.
- **Solution:** If F-25 fails fast at boot, most of this (~200 lines) can simply be deleted; otherwise collapse it back to direct PII-specific code.

### Q-04 — A circular (type-only) import between the consumer and its logging module — NOT IN USER STORIES

- **Problem:** The logging module imports a type from the consumer, which imports functions back from the logging module — harmless at runtime, but backwards layering.
- **Solution:** Move the shared types into the interfaces folder instead.

### Q-05 — Skip/rejection dispatch isn't exhaustive by construction — NOT IN USER STORIES

- **Problem:** The skip-reason set is a hand-maintained string list disconnected from its own type; a new reason added to the type but not the list silently gets mislabelled instead of causing a compile error.
- **Solution:** Derive both from one shared `as const` array and add a `never`-typed exhaustiveness check.

### Q-06 — One 1,821-line test file covers the entire consumer — NOT IN USER STORIES

- **Problem:** The test file is nearly 3x the size of the file it tests, making it hard to navigate and slow to reason about.
- **Solution:** Split by concern (first-attempt delivery, PPA park/reprobe, PII park, the reprobe loop itself, watchdog) once Q-01/Q-02 land.

### Q-07 — Operator-facing text uses internal vocabulary; comments exceed the length cap — NOT IN USER STORIES

- **Problem:** Prometheus help strings reference internal artefacts (finding numbers, phase names, file names) that mean nothing to a Grafana user; several comments run well past the project's 1-2 line cap.
- **Solution:** One pass rewriting help strings in plain operator terms and trimming comments to one reason each.

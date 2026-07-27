# Plan: Running `ml-core-test-harness` in ISO 20022 Mode

Planning only — nothing here has been implemented. This picks up the prior
investigation in `docs/iso-mode/iso20022 golden path flow.md` (written
2026-07-17) and re-verifies it against current upstream state as of
2026-07-27, because one of its two hard blockers has changed.

**Read `docs/iso-mode/iso20022 golden path flow.md` first** — this doc does
not repeat that investigation's full detail, only what's changed and what
that means for the plan.

## Why this matters right now

The E2E review (`comprehensive review.md` in this folder) showed a live DRPP
production deployment running Mojaloop's ISO 20022 wire profile
(`API_TYPE=iso20022`), and the `extensionList` party-data finding from that
review has already been built into the PPA (`src/parsers/extensionListParty.js`).
That code has only ever been verified against one real captured HTTP message
— it has never been exercised against our own Kafka topics, because our test
harness has never run in ISO mode. Getting the harness into ISO mode is the
most direct way to close that verification gap.

## Recap: what the prior investigation found (2026-07-17)

Mojaloop supports FSPIOP and ISO 20022 as parallel wire formats behind an
`API_TYPE` flag. All four core services (`central-ledger`,
`ml-api-adapter`, `quoting-service`, `account-lookup-service`) are ISO-ready
and unit/integration-tested. Flipping them is mechanical (Track A). But the
golden path also routes through two **external Docker images** —
`mojaloop/mojaloop-simulator` and `mojaloop/sdk-scheme-adapter` — and at the
time of that investigation, a direct GitHub code search for `iso20022` in
both repos returned **0 results in both**. That was the hard blocker: "full
and unmodified" (keeping those two containers as-is) was ruled out entirely.

## What's changed since (verified today, 2026-07-27)

Re-ran the same verification method (`gh api search/code`) against both
repos.

| Repo | 2026-07-17 result | 2026-07-27 result |
| --- | --- | --- |
| `mojaloop/mojaloop-simulator` | 0 hits for `iso20022` | **Still 0.** A broader `iso` search returns 8 hits, all incidental (`isoDate`-type string matches in `quote.js`, `bulkQuote.js`, etc.) — confirmed by inspection, not ISO 20022 support. |
| `mojaloop/sdk-scheme-adapter` | 0 hits for `iso20022` | **23 hits — real, substantial ISO 20022 support has landed.** |

### What actually landed in `sdk-scheme-adapter`

Not a stray reference — a real feature, with its own inbound spec, handlers,
and a dedicated functional test suite:

- `modules/api-svc/src/InboundServer/api_iso20022.yaml` — a dedicated ISO
  20022 inbound OpenAPI spec
- `modules/api-svc/src/InboundServer/handlers.js`,
  `modules/api-svc/src/lib/model/{OutboundTransfersModel,TransfersModel}.js`
  — ISO-aware request handling and transfer models
- `modules/api-svc/src/config.js`, `src/constants.js` — config/constants
  support for the mode
- Unit tests: `handlers-iso20022.test.js`, `InboundServer-iso20022.test.js`,
  `OutboundTransfersISO20022.test.js`
- **`test/func_iso20022/`** — a complete, self-contained functional test rig:
  its own `docker-compose.yml`, per-participant `api-svc.env` configs
  (`sdk-ttkfxp`, `sdk-ttksim1`, `sdk-ttksim2` — note: includes an FXP
  participant), a TTK-based collection runner, and a documented CLI/UI
  workflow (`README.md`) producing an HTML report

The file first appeared 2025-04-22 — 17 days after our pinned
`SDK_SCHEME_ADAPTER_VERSION=v24.7.0` (released 2025-04-05). A large number of
releases have shipped since: the most recent non-snapshot stable tag is
`v24.19.7`, well past our pin, with `v24.20.0` and `v25.0.0` snapshots also
public.

### What this means for the prior "hard blocker" conclusion

**Partially resolved, not fully.** The 2026-07-17 doc's verdict — "not
achievable today, full stop" — was contingent on *both* external images
lacking ISO support. That's no longer the state of the world:

- `sdk-scheme-adapter`: blocker **lifted**, contingent on upgrading past our
  pinned `v24.7.0`.
- `mojaloop-simulator`: blocker **still stands**, unchanged, confirmed again
  today.

The golden path's simulator container plays both the payee DFSP's backend
*and* (per the func_iso20022 test rig's own participant naming —
`sdk-ttksim1`/`sdk-ttksim2`) is paired with sdk-scheme-adapter instances in
that upstream test setup. Whether our own harness's simulator role can be
routed around, or whether it's load-bearing for the golden path scenarios we
care about, is the open question below.

## Updated options, given the partial resolution

### Option 1 — Re-scope Track B around only the simulator gap

Instead of "full and unmodified golden path," the achievable target becomes:
**sdk-scheme-adapter and the four core services in ISO mode, simulator
still FSPIOP** (if the simulator's role can tolerate a protocol boundary) —
or **simulator swapped out / bypassed for the specific scenarios that need
it**, using sdk-scheme-adapter's own `func_iso20022` test rig as a template
for how upstream itself handles this (its own compose file presumably
doesn't depend on `mojaloop-simulator` at all — worth confirming directly by
reading that compose file, not assumed here).

### Option 2 — Adopt `sdk-scheme-adapter`'s own functional test rig as a reference implementation

Rather than retrofitting our `ml-core-test-harness`, `test/func_iso20022/` in
`sdk-scheme-adapter` is a working, upstream-maintained ISO-mode end-to-end
setup. Standing it up directly (separate from our harness) would validate
ISO-mode transfer flows through a real sdk-scheme-adapter without us having
to solve any of the integration work ourselves — useful as a fast way to see
real ISO-mode Kafka-adjacent traffic, though it's a different topology than
our own harness and wouldn't directly answer "what does *our* stack produce."

### Option 3 — Track A only, against the four core services (unchanged from prior doc)

Still available regardless of the above: flip `API_TYPE=iso20022` on
`ml-api-adapter`/`quoting-service`/`account-lookup-service`, drive traffic
via TTK directly (bypassing simulator and sdk-scheme-adapter entirely). This
was already the prior doc's "closest thing achievable today" — still true,
still doesn't need any upstream change, and is the lowest-risk way to answer
the specific question that matters most for the PPA: **what do our 5 Kafka
topics actually contain when the core services run in ISO mode?** This does
not require resolving the simulator blocker at all, since it deliberately
routes around both external images.

## What Option 3 would take (mechanical steps, from the prior doc, still valid)

1. `API_TYPE=iso20022` on `ml-api-adapter`, `quoting-service`,
   `account-lookup-service` config-modifier scripts (`central-ledger` needs
   no change — protocol-agnostic).
2. Flip the SDK env files' existing `API_TYPE` flag
   (`payerfsp-sdk.env`, `payeefsp-sdk.env`, `testfsp{1,2,3,4}-sdk.env`,
   `perf-backend.env` — confirmed today, all 7 still say `fspiop`) — only
   relevant if driving traffic through the SDK layer rather than TTK-direct.
3. Flip the TTK assertion flag at
   `docker/ml-testing-toolkit/test-cases/environments/default-env.json:48`.
4. Author the missing `trigger_templates/`/`response_map.json` under
   `docker/ml-testing-toolkit/spec_files/api_definitions/fspiop_2.0_iso20022/`
   — confirmed today, still just `api_spec.yaml`, `callback_map.json`,
   `mockRef.json`; the referenced files genuinely don't exist yet.
5. Build ISO-shaped TTK test cases for the golden path (current collections
   are 100% FSPIOP-shaped).

None of this touches Kafka topic names, payload envelope structure, or
consumer group mechanics — so `ppa-prototype`'s `src/config.js` topic list
and `src/kafka/consumer.js` wiring would need no changes to *consume*
ISO-mode traffic. What's unverified is only the **shape of what lands inside
`content.payload`/`content.payloadDecoded`** on each topic once the upstream
services are actually transforming ISO 20022 internally.

## Recommended path (planning opinion, not a decision)

Start with **Option 3** — it's unchanged, lowest-risk, doesn't depend on the
simulator blocker at all, and directly answers the question the PPA's
`extensionList` work actually needs answered. Treat **Option 1/2** as
follow-ups once Option 3 gives real signal on whether `extensionList` (or
other ISO-mode fields) actually reach the Kafka layer the way the DRPP HTTP
capture suggested — if the four core services already transform in a way
that populates `extensionList` on the internal Kafka message before TTK/SDK
sees it, that's confirmable through Option 3 alone, without ever touching the
simulator or sdk-scheme-adapter blocker.

## Open questions to resolve before implementing (not answered here)

- Does `sdk-scheme-adapter`'s own `test/func_iso20022/docker-compose.yml`
  depend on `mojaloop-simulator`, or does it substitute something else for
  that role? (Directly readable from that file — not yet checked.)
- What's the actual upgrade delta from our pinned `v24.7.0` to a stable
  ISO-capable tag (`v24.19.7`+) — breaking changes, config surface changes,
  compatibility with the rest of our pinned stack?
- Does the golden-path scenario set we care about (P2P happy path) even
  require the simulator, or is it only FX/edge-case scenarios that do?

## Summary verdict

The 2026-07-17 conclusion ("not achievable today, hard blocker, external to
this monorepo") is **out of date on one of its two blockers**.
`sdk-scheme-adapter` has real, tested, released ISO 20022 support as of
recent stable tags; `mojaloop-simulator` still has none. The practical
near-term move that needs no upstream resolution at all — Track A /
Option 3, TTK-direct against the four core services — remains the fastest
way to get real signal on the question that actually matters for the PPA's
`extensionList` work: what our own Kafka topics look like in ISO mode.

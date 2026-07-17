# ISO 20022 Golden Path Flow — Plan for a Full Compose-Stack Run

## Context

This document captures the investigation and plan from a conversation exploring
whether Mojaloop's `ml-core-test-harness` golden path can be run end-to-end in
ISO 20022 mode, using the existing `docker-compose.yml` stack unmodified in
terms of *which containers* are used (i.e. no swapping the simulator or
sdk-scheme-adapter images for something else).

### How we got here

1. **Protocol confusion resolved.** Mojaloop was believed to speak only its
   native FSPIOP protocol. A team member said it uses ISO 20022. Both are
   correct: FSPIOP is the original/default wire protocol, and ISO 20022 was
   added later (Mojaloop v17) as a **parallel, alternative** wire format — not
   a replacement. A deployment is configured to speak one or the other via an
   `API_TYPE` flag (`'fspiop'` or `'iso20022'`). A dedicated library,
   `ml-schema-transformer-lib`, does the FSPIOP↔ISO20022 payload translation
   (see its `FSPIOP to ISO 20022 Mapping.md` / `ISO 20022 to FSPIOP
   Mapping.md`), mapping e.g. `POST /quotes` → `pacs.081.001.01`,
   `POST /transfers` → `pacs.008.001.13`, `PUT /parties{Type}/{ID}` →
   `acmt.024.001.04`.

2. **`ml-core-test-harness` runs FSPIOP by default, today.** Every `API_TYPE`
   setting in the harness (`envs/*.env` SDK files) is `fspiop`. The core hub
   services (`central-ledger`, `ml-api-adapter`, `quoting-service`) get their
   config via `config-modifier` scripts patching `default.json`, and none of
   those scripts touch `API_TYPE` — so the services fall back to their
   hardcoded default, which is also `"fspiop"`. No ISO variant of the compose
   stack exists in this repo. Running the harness as-is spins up the full
   golden-path flow (account-lookup, quoting, central-ledger, ml-api-adapter,
   simulators) speaking native FSPIOP end-to-end. The ISO 20022 translation
   path (`ml-schema-transformer-lib`, the `IS_ISO_MODE` branch in
   `ml-api-adapter/src/lib/headers.js`, the `api-swagger-iso20022-transfers.yaml`
   interface) exists in the codebase but is dormant in this harness unless
   `API_TYPE=iso20022` is explicitly set on the relevant services and they are
   rebuilt/restarted.

3. **What it would take to flip the harness into ISO mode — first pass.**
   Each core service (`central-ledger`, `ml-api-adapter`, `quoting-service`,
   `account-lookup-service`) has real, tested ISO 20022 support baked in
   behind the `API_TYPE` flag — but the test harness itself (docker-compose,
   TTK specs, sdk-scheme-adapter/simulator images) has never actually been
   flipped into ISO mode end-to-end. It is a mature library/service-level
   capability sitting on top of an untested integration path. A narrow slice —
   TTK directly hitting `central-ledger`/`ml-api-adapter`/`quoting-service`/
   `account-lookup-service`, bypassing the simulator and sdk-scheme-adapter
   containers — has a genuine shot at working today, since those four services
   are solidly ISO-ready.

4. **This document answers the follow-up question**: what would it take to run
   the **full, unmodified golden path through the existing compose stack**
   (i.e. including the simulator and sdk-scheme-adapter containers, not
   bypassing them) in ISO 20022 mode?

---

## Service-by-service ISO 20022 readiness (recap)

| Service | ISO 20022 support | Evidence |
|---|---|---|
| `central-ledger` | Not needed — protocol-agnostic | No `API_TYPE`/ISO code anywhere in `central-ledger/src` or `config`. It only ever consumes FSPIOP-shaped Kafka messages that upstream services (ml-api-adapter, quoting-service) have already normalized. |
| `ml-api-adapter` | Complete, unit-tested | `config/default.json:2` (`"API_TYPE": "fspiop"` default), `IS_ISO_MODE` branch in `src/lib/config.js`, transform calls in `src/api/transfers/handler.js` and `src/handlers/notification/index.js` for both `transfers` and `fxTransfers`. Tested in `test/unit/api/transfers/isoModeHandler.test.js` and `test/unit/handlers/notification/index.iso20022.test.js` (mocked Kafka/Consumer/Producer). |
| `quoting-service` | Complete, integration-tested | `config/default.json:8`, `src/lib/config.js:100` (`isIsoApi`), spec selection in `src/server.js:77` (swaps entire OpenAPI spec at startup), generic transform dispatch in `src/lib/dto.js:68-70` covering both `quotes` and `fxQuotes`. Tested in `test/unit/isoFormatValidation.test.js`, which boots a real Hapi server and injects real HTTP requests for both quotes and fxQuotes — the strongest evidence of the four services. |
| `account-lookup-service` | Complete, wired symmetrically | `config/default.json:8`, `src/lib/config.js:110`, spec selection in `src/lib/util.js:73-75`, ISO branching in `src/domain/parties/partiesUtils.js:49`. |

All four select a different OpenAPI/swagger spec file at startup depending on
`API_TYPE`; the switch is a deliberate, code-level fork, not a runtime
content-sniff.

## Test-harness layer readiness (recap)

- **TTK (`ml-testing-toolkit`)**: `spec_files/api_definitions/fspiop_2.0_iso20022/`
  exists and is substantial (8,331-line `api_spec.yaml`), but is **missing**
  `trigger_templates/` and `response_map.json` files that existing
  `rules_callback/default.json` entries reference — those specific rules will
  fail/no-op if triggered. 19 of 73 callback rules are genuinely ISO-typed
  (real field content, not placeholders), covering parties GET and some
  transfers scenarios. The **golden-path and FX test-case collections are
  100% FSPIOP-shaped** — no ISO test cases exercise the actual golden path
  today.
- **FX has no ISO coverage at the TTK layer at all** — no
  `fx-api_2.0_iso20022` spec directory exists, despite the underlying
  services and `ml-schema-transformer-lib` fully supporting fxQuotes/
  fxTransfers ISO transforms.
- **No documentation** anywhere in `ml-core-test-harness/README.md` or
  `docs/` mentions ISO mode.

## The two external, previously-unverified dependencies — now resolved

The prior investigation flagged `mojaloop/simulator` and
`mojaloop/sdk-scheme-adapter` as external Docker images (not checked out in
this repo) whose ISO 20022 readiness was unknown. This was followed up via
the official GitHub repos directly:

- **`mojaloop/mojaloop-simulator`** — its own README states it is
  *"a generic simulator, an implementation of the FSPIOP spec."* No
  `API_TYPE` config, no ISO 20022 environment variables, no mention of
  ISO 20022 anywhere in the repo.
  A GitHub code search (`gh api search/code -q 'iso20022 repo:mojaloop/mojaloop-simulator'`)
  returned **0 results**.
- **`mojaloop/sdk-scheme-adapter`** — recent release notes (v24.18.3
  through v24.19.6) contain no ISO 20022 mentions. A GitHub code search
  (`gh api search/code -q 'iso20022 repo:mojaloop/sdk-scheme-adapter'`)
  also returned **0 results**.

Both repos are actively maintained (`mojaloop-simulator` pushed to on
2026-07-06, `sdk-scheme-adapter` pushed to on 2026-07-13), so this isn't a
case of stale/abandoned code — ISO 20022 support genuinely does not exist in
either image as of the versions pinned in this harness
(`TEST_SIMULATOR_VERSION=v12.2.4`, `SDK_SCHEME_ADAPTER_VERSION=v24.7.0`, in
`ml-core-test-harness/.env`).

**This is a hard blocker**, not a configuration gap. It cannot be resolved by
setting an env var or patching a config file — it requires code changes
upstream, in repos outside this monorepo.

---

## What a full, unmodified golden-path run in ISO mode actually requires

Given the hard blocker above, "full and unmodified" (i.e. keeping the
simulator and sdk-scheme-adapter containers as-is) is **not achievable
today**. The golden path routes payer/payee traffic through
sdk-scheme-adapter containers and/or the simulator for every scenario in the
existing TTK collections — either one receiving an ISO-shaped payload it
doesn't understand will break the flow.

To actually get there, the plan splits into two tracks: (A) the
configuration/integration work that's realistic now, and (B) the upstream
work that would need to land in `mojaloop-simulator` and `sdk-scheme-adapter`
before "full and unmodified" is possible.

### Track A — Harness-side changes (buildable today, but not sufficient alone)

| # | Change | File(s) |
|---|---|---|
| 1 | Add `"API_TYPE": "iso20022"` | `ml-core-test-harness/docker/config-modifier/configs/ml-api-adapter.js` |
| 2 | Add `"API_TYPE": "iso20022"` | `ml-core-test-harness/docker/config-modifier/configs/quoting-service.js` |
| 3 | Add `"API_TYPE": "iso20022"` | `ml-core-test-harness/docker/config-modifier/configs/account-lookup-service.js` |
| 4 | No change needed | `central-ledger.js` (protocol-agnostic) |
| 5 | Flip existing flag `fspiop` → `iso20022` | `ml-core-test-harness/envs/{testfsp1,testfsp2,testfsp3,testfsp4,payerfsp,payeefsp}-sdk.env` (6 files) |
| 6 | Add flag fresh (no existing precedent) | `ml-core-test-harness/envs/{fx-provider,fx-payerdfsp,fx-payeedfsp}.env` (3 files) |
| 7 | Flip test-assertion flag so existing conditional checks (already written to tolerate non-fspiop) activate correctly | `docker/ml-testing-toolkit/test-cases/environments/default-env.json:48` |
| 8 | Create missing `trigger_templates/` and `response_map.json` under `fspiop_2.0_iso20022/` so the 19 existing ISO callback rules don't fail when triggered | `docker/ml-testing-toolkit/spec_files/api_definitions/fspiop_2.0_iso20022/` |
| 9 | Build out ISO/FX test-case collections and, if needed, an `fx-api_2.0_iso20022` spec dir, since the current golden-path/FX TTK collections are FSPIOP-only | `docker/ml-testing-toolkit/test-cases/collections/tests/golden_path/` and `.../fx/` |
| 10 | No `docker-compose.yml` edits are strictly required — `config-modifier` handles service config patching, and the `envs/*.env` files are already wired via `env_file:` directives | — |

Steps 1–7 are mechanical and low-risk (all four core services already have
tested code paths for ISO mode). Steps 8–9 are real engineering work — the
TTK gaps are not just config, they're missing test content that needs to be
authored to mirror the existing FSPIOP golden-path collections field-for-field
in ISO shape.

Even with all of Track A complete, the flow above breaks at the
sdk-scheme-adapter and simulator containers.

### Track B — Upstream blockers (outside this repo, no code available to change)

| # | Blocker | What's needed |
|---|---|---|
| 1 | `mojaloop/simulator` has no ISO 20022 support | Upstream feature work in the `mojaloop/mojaloop-simulator` repo to accept and emit ISO 20022-shaped payloads, gated behind some equivalent of `API_TYPE`. This is not something we can patch from within this monorepo. |
| 2 | `mojaloop/sdk-scheme-adapter` has no ISO 20022 support | Same — upstream feature work in `mojaloop/sdk-scheme-adapter`. Given the SDK env files already carry an `API_TYPE` variable (apparently anticipating this), this may be a planned/in-progress capability upstream, but nothing in the current pinned version (`v24.7.0`) or recent release notes indicates it has landed. |

**Options if Track B blockers can't be waited out:**

- **Track a substitute path** (the "narrow slice" from the earlier
  investigation): run TTK directly against `central-ledger` /
  `ml-api-adapter` / `quoting-service` / `account-lookup-service`, injecting
  ISO-shaped requests via TTK's own request/rules mechanism instead of via
  sdk-scheme-adapter or the simulator. This validates the ISO 20022 code
  paths in the four core services without needing upstream changes, but it is
  not the "full golden path through the existing compose stack" the user
  asked for here — it's a deliberately narrower proof of the hub-side
  plumbing.
- **Track upstream progress**: periodically re-check
  `mojaloop/mojaloop-simulator` and `mojaloop/sdk-scheme-adapter` releases
  and code search for `iso20022` — if/when ISO support lands in either, Track
  A's config changes become sufficient to unblock a real end-to-end run.
- **Contribute upstream**: since `ml-schema-transformer-lib` already contains
  the complete bidirectional mapping logic for every resource (parties,
  quotes, fxQuotes, transfers, fxTransfers), the same transform calls used in
  `ml-api-adapter`/`quoting-service`/`account-lookup-service` could in
  principle be reused inside the simulator/sdk-scheme-adapter to add ISO
  support there — this would be new work contributed to those repos, not a
  local change.

---

## Summary verdict

A full, unmodified golden-path run through the existing `ml-core-test-harness`
compose stack in ISO 20022 mode is **not achievable today**. The four core
Mojaloop services are ISO-ready and well-tested at the unit/integration
level, and flipping them via `API_TYPE` is mechanical (Track A, steps 1–7).
But the golden path's simulator and sdk-scheme-adapter containers — both
external images pulled from `mojaloop/mojaloop-simulator` and
`mojaloop/sdk-scheme-adapter` — have **zero ISO 20022 support** as of the
versions currently pinned in this harness, confirmed via direct GitHub code
search (0 results in both repos) and their own documentation ("a generic
simulator, an implementation of the FSPIOP spec"). This is a hard blocker
external to this monorepo, not a configuration gap that can be closed from
here.

The realistic near-term option is the narrower TTK-direct-to-core-services
flow described in Track B, which proves out the ISO 20022 plumbing on the
hub side while explicitly not exercising the simulator/sdk-scheme-adapter
containers.

---

## What's usable today

Given the hard blocker, everything below deliberately avoids the simulator
and sdk-scheme-adapter containers. Ordered roughly from least to most effort:

### 1. Run the existing unit/integration test suites as-is

No setup required beyond the normal `npm test` for each service:

- `quoting-service/test/unit/isoFormatValidation.test.js` boots a real Hapi
  server and asserts real HTTP behavior for both `quotes` and `fxQuotes` in
  ISO mode — the strongest existing evidence that ISO mode works at the
  service level.
- `ml-api-adapter/test/unit/api/transfers/isoModeHandler.test.js` and
  `ml-api-adapter/test/unit/handlers/notification/index.iso20022.test.js`
  cover the transfers/fxTransfers transform paths (Kafka mocked).

This proves the transform logic works, but it's mocked/isolated — no live
service-to-service traffic.

### 2. Use `ml-schema-transformer-lib` standalone

The most direct way to actually *see* the ISO 20022 wire format. Feed it real
FSPIOP JSON bodies (e.g. from the golden path Postman collection) and get
back the ISO-shaped equivalent (`pacs.008`, `pacs.002`, `acmt.024`, etc.)
with zero infrastructure — just `npm i` in `ml-schema-transformer-lib/` and
call the exported facade functions (`TransformFacades.FSPIOP.quotes.post(...)`
etc., per its README). Good for understanding/demoing the actual payload
differences, or for hand-building ISO test fixtures for later use in TTK.

### 3. Flip one core service to ISO mode and hit it directly

Set `API_TYPE=iso20022` on a single service (e.g. `quoting-service`, either
via its `config-modifier` script or directly in `config/default.json`),
start just that service plus its DB dependency, and send it real ISO-shaped
HTTP requests with curl/Postman. This validates the OpenAPI spec switch
(`src/server.js:77` picks `QuotingService-swagger_iso20022.yaml`) and route
behavior in isolation, without needing the rest of the stack or touching the
simulator/sdk-scheme-adapter.

### 4. The "narrow slice" — TTK direct to the 4 core services

The most complete thing achievable today. Apply Track A steps 1–7 above
(`API_TYPE=iso20022` on `ml-api-adapter`, `quoting-service`,
`account-lookup-service`; `central-ledger` needs no change since it's
protocol-agnostic), then use TTK's own request-injection/rules mechanism to
drive traffic — bypassing the simulator and sdk-scheme-adapter containers
entirely, since TTK can act as both the calling DFSP and the receiving
callback target. This proves out real hub-side ISO 20022 request/response/
callback flows end-to-end, just not through the "real" golden-path topology
(no simulator, no sdk-scheme-adapter). It would still need the TTK gaps from
Track A step 8 (missing `trigger_templates/`/`response_map.json`) addressed
for any scenario that hits those specific callback rules, and step 9 (new
ISO-shaped test cases) since the current golden-path collections are
FSPIOP-only.

Of these four, #4 is the closest thing to a real ISO 20022 demo of the actual
Mojaloop hub — it's the option worth scoping into a full implementation plan
if/when that's needed.

### 5. `ppa-prototype`'s Tazama ingestion path (already built, already running)

Unlike options 1–4, this one doesn't require flipping any service's
`API_TYPE` or touching the simulator/sdk-scheme-adapter question at all — it
sidesteps the hard blocker in Track B entirely by converting to ISO 20022
**downstream** of the hub, not by making the hub itself speak ISO 20022 on
the wire.

`ppa-prototype` (see its own `README.md` at the repo root) is a standalone
service that consumes Mojaloop's internal Kafka topics directly
(`topic-transfer-prepare`, `topic-transfer-fulfil`, plus quote/notification
topics) — i.e. it taps the FSPIOP-native event stream between
`central-ledger`, `quoting-service`, and `ml-api-adapter`, rather than
calling any HTTP API. Its Tazama ingestion feature (`src/tazama/`,
CCHFRMS-38) then transforms the FSPIOP transfer payloads it consumes into
ISO 20022 `pacs.008`/`pacs.002` and forwards them to Tazama's Transaction
Monitoring Service (TMS) for fraud/AML screening.

This has already been validated live: 2625 TTK assertions at 99.96% pass
with the service running throughout a full golden-path run, and a separate
P2P golden-path run (40/40 assertions) against a live Tazama stack with both
`pacs.008` and `pacs.002` calls confirmed correct in Tazama's own Postgres
(matching `EndToEndId`, distinct `MsgId` per message, expected `TxSts`).

**Important caveat — this is not the official mapping.** The transform in
`src/tazama/iso20022.js` follows the same general conventions as
`ml-schema-transformer-lib`'s FSPIOP↔ISO20022 mapping (same resource→message
selection, similar field placements, the same `SttlmMtd: CLRG` constant),
but it is a bespoke implementation built and pinned against TMS's own AJV
schemas, not `ml-schema-transformer-lib` itself, and it is **lossy by
necessity**:

- It targets `pacs.008.001.10`/`pacs.002.001.12` — different ISO message
  *versions* than the official mapping's `pacs.008.001.13`/`pacs.002.001.15`.
- `Dbtr`/`Cdtr`/`DbtrAcct`/`CdtrAcct` are placeholders keyed off FSP id, not
  real party identity — the official mapping sources these from the
  *quote* response via a cross-message join
  (`{$previous.postQuoteResponse.CdtTrfTxInf.Cdtr}`), which this prototype
  doesn't perform (it only consumes transfer topics).
  `VrfctnOfTerms.IlpV4PrepPacket` (the ILP packet) and `TxInfAndSts.ExctnConf`
  (fulfilment) are also absent, both present in the official mapping.
- Conversely, it includes fields the official mapping doesn't require at all
  (`RgltryRptg`, `RmtInf`, `SplmtryData`, `ChrgsInf.Agt`) because TMS's AJV
  schema demands them.

Every placeholder is centralised in the `PLACEHOLDER` constant in
`iso20022.js` and documented in `ppa-prototype/README.md` and
`docs/user stories/cchfrms-38/cchfrms-38-plan.md` at the repo root, so the
gaps are traceable rather than silent. In short: usable today, and already
proven against a live TMS, but it's a purpose-built approximation for
Tazama's ingestion needs — not a drop-in demonstration of Mojaloop's own
ISO 20022 mode or a substitute for exercising `ml-schema-transformer-lib`.

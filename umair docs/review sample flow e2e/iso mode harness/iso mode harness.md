# Plan: Running the Cross-Border (DRPP-style) Flow in ISO Mode, Locally

Planning only — nothing here has been implemented. Goal: reproduce a flow
cycle similar to the real production DRPP sample in `docs/Sample flow E2E/`
— cross-border FX transfer, ISO 20022 wire mode — against our own
`ml-core-test-harness`, end to end.

**Correction notice**: an earlier version of this document concluded the
cross-border flow was blocked by `mojaloop-simulator` lacking ISO 20022
support. That conclusion was wrong — it was written before checking how our
own harness actually wires up its FX topology. Corrected below. If you read
an earlier version, discard the "simulator blocks the FX flow" claim
specifically; everything else about the simulator's general ISO-readiness
still stands, it's just not relevant to this particular flow.

## Read first

- `docs/iso-mode/iso20022 golden path flow.md` (2026-07-17) — the original
  ISO-mode investigation. Establishes that the four core services
  (`central-ledger`, `ml-api-adapter`, `quoting-service`,
  `account-lookup-service`) are ISO-ready behind `API_TYPE`, and that at the
  time, both `mojaloop-simulator` and `mojaloop/sdk-scheme-adapter` had zero
  ISO 20022 support.
- `comprehensive review.md` in this folder — the DRPP capture this plan is
  trying to reproduce.

## The key correction: the FX flow doesn't use the simulator at all

Checked directly against `ml-core-test-harness/docker-compose.yml` and
`envs/`. Our harness already has a **complete FX participant topology**, and
none of it touches `mojaloop-simulator`:

| Service | Image | Role | Compose profile |
| --- | --- | --- | --- |
| `fx-provider1-sdk` | `sdk-scheme-adapter` | The FXP (`DFSP_ID=testfxp1`) | `fx-sdk` |
| `fx-payerdfsp-sdk` | `sdk-scheme-adapter` | Payer-side DFSP in the FX flow | `fx-sdk` |
| `fx-payeedfsp-sdk` | `sdk-scheme-adapter` | Payee-side DFSP in the FX flow | `fx-sdk` |

**The FXP is just another `sdk-scheme-adapter` instance**, not
`mojaloop-simulator` playing a third role. All three SDKs' `PEER_ENDPOINT`/
`BACKEND_ENDPOINT` route through `mojaloop-testing-toolkit`
(`envs/fx-provider.env`, `envs/fx-payerdfsp-sdk.env`,
`envs/fx-payeedfsp-sdk.env` all confirmed — none reference `simulator`).
`mojaloop-simulator` is only used in the *plain* (non-FX) golden path, for a
different purpose (backend for the simple P2P DFSPs), and is irrelevant to
the cross-border flow.

This also matches the real DRPP capture: every FSPIOP-layer message in
`docs/Sample flow E2E/` shows `test-mwk-dfsp`/`test-zmw-dfsp`/`test-fxp` as
the three participants — i.e. DRPP's own topology is "three DFSP-shaped
participants", the same shape our `fx-sdk` profile already has, not
"two DFSPs plus a simulator."

## What this means: the blocker for the cross-border flow specifically is just sdk-scheme-adapter's ISO support

Since the FX topology is 100% `sdk-scheme-adapter` instances and
`mojaloop-testing-toolkit`, and `mojaloop-testing-toolkit` isn't an external
image with a fixed protocol (it's our own TTK config, driven by spec files),
the only external-image blocker that actually applies here is
**`sdk-scheme-adapter`'s ISO 20022 support**.

Re-verified today (2026-07-27) against the original investigation's method
(`gh api search/code`):

| Repo | 2026-07-17 | 2026-07-27 |
| --- | --- | --- |
| `mojaloop/sdk-scheme-adapter` | 0 hits for `iso20022` | **23 hits.** Real support: a dedicated `api_iso20022.yaml` inbound spec, ISO-aware handlers/transfer models (`OutboundTransfersModel.js`, `TransfersModel.js`), unit tests (`handlers-iso20022.test.js`, `InboundServer-iso20022.test.js`, `OutboundTransfersISO20022.test.js`), and a complete self-contained functional test rig at `test/func_iso20022/` with its own docker-compose and a documented TTK-based test runner. |

The file first appeared 2025-04-22, 17 days after our pinned
`SDK_SCHEME_ADAPTER_VERSION=v24.7.0` (2025-04-05). Stable releases have
shipped well past that since — most recent non-snapshot tag `v24.19.7`, with
`v24.20.0`/`v25.0.0` snapshots also public. **So this is a version-pin gap,
not a missing-feature gap.**

(For completeness: `mojaloop-simulator` genuinely still has 0 ISO 20022
support, confirmed again today. It just doesn't matter for this particular
flow, since it's not part of the FX topology.)

## The plan

### Step 1 — Upgrade `SDK_SCHEME_ADAPTER_VERSION`

From `v24.7.0` to a stable ISO-capable tag (`v24.19.7` or later). Needs its
own verification pass before committing to a specific tag: changelog/breaking
changes between `v24.7.0` and the target, and whether our `envs/*-sdk.env`
files' config surface (SDK config schema can drift between minor versions)
still applies cleanly. Not yet checked — flagged as an explicit open
question below, not assumed safe.

### Step 2 — Set `API_TYPE=iso20022` on the FX participants

Confirmed today: `envs/fx-provider.env`, `envs/fx-payerdfsp-sdk.env`,
`envs/fx-payeedfsp-sdk.env` currently have **no `API_TYPE` line at all** (the
prior investigation flagged this as "add flag fresh, no existing precedent" —
still true). Add `API_TYPE=iso20022` to all three.

### Step 3 — Set `API_TYPE=iso20022` on the four core services

Mechanical, per the prior investigation, still valid:

- `ml-api-adapter`, `quoting-service`, `account-lookup-service` — add
  `"API_TYPE": "iso20022"` in their respective
  `docker/config-modifier/configs/*.js` scripts. Confirmed today: none of the
  three currently set `API_TYPE` at all.
- `central-ledger` — no change needed (protocol-agnostic, confirmed in the
  prior investigation).

**New question this plan adds that the prior investigation didn't need to
answer**: does `quoting-service`'s ISO transform cover **`fxQuotes`**
specifically (not just `quotes`), and does `ml-api-adapter`'s cover
**`fxTransfers`** (not just `transfers`)? The prior investigation's evidence
for quoting-service (`src/lib/dto.js:68-70`, described as "generic transform
dispatch... covering both `quotes` and `fxQuotes`") suggests yes for the
quote side. The transfer side's fxTransfers coverage wasn't explicitly
confirmed in that investigation and needs a direct code check before relying
on it.

### Step 4 — Provision the FX participants and drive the flow

Our harness already has everything needed to provision and run the FX golden
path in FSPIOP mode — confirmed today:

- Provisioning: `docker/ml-testing-toolkit/test-cases/collections/provisioning/participants_fx_sdk/` (`participant_testfxp1.json`, `participant_fxpayerdfsp.json`, `participant_fxpayeedfsp.json`), plus `provisioning/fxp.json`.
- Test collection: `docker/ml-testing-toolkit/test-cases/collections/tests/fx/golden_path/` — `api_tests/fx_quotes.json`, `api_tests/fx_transfers.json`, `feature_tests/happy_path/fx_tests.json`.
- Compose profile: `fx-sdk` (brings up the three FX SDK containers) alongside whatever profile brings up the four core services.

None of this needs to be built from scratch — it needs to be **run with the
ISO flags flipped** instead of the default FSPIOP. The existing FX test
collection is FSPIOP-shaped (same gap the prior investigation found for the
plain golden path), so either: (a) run it as-is against ISO-mode services
first, to see whether the core services' request/response validation simply
rejects FSPIOP-shaped bodies when `API_TYPE=iso20022` (informative failure,
tells us the mode switch is real), or (b) author ISO-shaped equivalents of
`fx_quotes.json`/`fx_transfers.json` mirroring the DRPP capture's actual
bodies (we have real reference payloads for this — files 06/07/14/15 in
`docs/Sample flow E2E/`).

### Step 5 — Capture and compare against the DRPP sample

Once a transaction runs, capture the resulting Kafka messages via
`ppa-prototype` (already subscribed to all 5 relevant topics — no PPA change
needed to *consume* this) and compare field-by-field against
`docs/Sample flow E2E/`, specifically checking whether `extensionList`
(the finding that started this whole thread) actually appears on our own
`topic-transfer-prepare`/`-fulfil` payloads the same way it did in the DRPP
HTTP-layer capture. This is the actual point of doing all of the above — not
just "does ISO mode run," but "does our `extensionListParty.js` enrichment
have real data to work with in this environment."

**Scope note**: `ppa-prototype` today does not subscribe to `topic-quotes-*`
variants for fxQuotes, nor any fxTransfers topic, if those turn out to be
separate Kafka topics from `topic-quotes-post/put`/`topic-transfer-prepare/fulfil`
— this needs confirming once the flow actually runs (the prior investigation
never checked whether fxQuotes/fxTransfers produce distinct topic names).
If they do, that's a `src/config.js` addition, not a redesign.

## What "similar to the real production sample" would and wouldn't match

| DRPP capture element | Reproducible locally? |
| --- | --- |
| Party lookup → FX quote → payee quote → FX transfer reserve → transfer prepare/fulfil | **Yes** — same resource sequence, same participant shape (3 DFSP-like nodes), already provisionable today in FSPIOP mode; ISO mode is the addition this plan targets. |
| Three-stage payer authorization (`acceptParty`/`acceptConversion`/`acceptQuote`) via the SDK outbound API | **Yes** — that's `sdk-scheme-adapter`'s own outbound API, already present, same mechanism our harness's other SDK-fronted flows already use. |
| `extensionList`-based ISO field mapping on transfer messages | **Unverified until run** — this is the specific thing Step 5 checks. Plausible, since `ml-api-adapter`'s ISO transform is real and tested, but not yet confirmed to reach the internal Kafka payload in the same shape. |
| The specific currencies (MWK/ZMW), specific DFSP ids, specific JWT/Keycloak auth layer | **No, and not needed.** Those are DRPP-deployment-specific (real Keycloak realm, real currency pair, real proxy routing headers like `fspiop-proxy: proxy-mwk`). Our local repro would use whatever test currencies/participant ids our harness's FX collections already use — the *shape* of the flow is what's being reproduced, not the specific deployment's identifiers. |
| DRPP's specific switch topology (`extapi.mw.drpp.global`, proxy routing) | **No.** That's DRPP's production ingress/proxy layer, unrelated to what runs inside `ml-core-test-harness`. |

## Open questions to resolve before implementing

1. **Upgrade safety**: `v24.7.0` → `v24.19.7`+ changelog/breaking-change
   review, and whether `envs/*-sdk.env` config keys still apply unchanged.
2. **fxQuotes/fxTransfers ISO coverage**: confirm directly in
   `quoting-service`/`ml-api-adapter` source (not just inferred from the
   quotes/transfers coverage already confirmed) that the FX-specific
   resources are actually transformed, not just the base ones.
3. **Kafka topic names for FX**: does `quoting-service`/`ml-api-adapter`
   publish fxQuotes/fxTransfers events on the same 5 topics `ppa-prototype`
   already subscribes to, or on separate topic names not yet in
   `src/config.js`?
4. **TTK ISO gaps** (carried over from the prior investigation, still
   unverified): missing `trigger_templates/`/`response_map.json` under
   `fspiop_2.0_iso20022/`, and whether an equivalent `fx-api_2.0_iso20022`
   spec dir needs to be created (the prior investigation confirmed no such
   directory exists for FX at all).

## Summary

Reproducing a DRPP-style cross-border ISO-mode flow locally is **more
achievable than the first pass of this plan suggested** — the earlier
"simulator blocks it" conclusion was based on assuming the simulator plays
the FXP role, which it doesn't in our harness. The actual topology
(`fx-provider1-sdk` + `fx-payerdfsp-sdk` + `fx-payeedfsp-sdk`, all
`sdk-scheme-adapter`) already exists, is already provisioned and tested in
FSPIOP mode, and the one external-image blocker that applies to it
(`sdk-scheme-adapter`'s ISO support) has been resolved upstream since the
original investigation — contingent on a version bump we haven't verified
the safety of yet. The plan is: upgrade the pinned SDK version, flip
`API_TYPE` on the FX SDKs and the four core services, run the existing FX
golden-path collection (FSPIOP first as a smoke test, then ISO-shaped), and
use `ppa-prototype`'s existing Kafka subscription to check whether
`extensionList` shows up the way the DRPP capture suggested.

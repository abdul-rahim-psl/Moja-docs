# Party Identifier Enrichment — Detailed Design & Implementation

Comprehensive technical write-up of two complementary sources of real
payer/payee identity and account identifiers (IBAN / ACCOUNT_ID / MSISDN / …)
that the PPA prototype weaves into the ISO 20022 messages it sends to
Tazama's TMS: (1) the quote→transfer in-memory join ("Option A"), and (2) a
transfer's own `extensionList`, added later (§5a) after a review of real
production traffic.

- **Executive summary:** `./executive-summary.md`
- **Prior research that motivated this:** `./real account numbers.md`
- **Implementation:** `ppa-prototype/src/` (files mapped below)
- **Tests:** `ppa-prototype/test/` (63 cases, all passing)
- **Date:** 2026-07-20 (extended 2026-07-27 with the `extensionList` source)

---

## 1. Background & problem statement

The PPA prototype consumes Mojaloop Kafka topics and forwards transfers to
Tazama's TMS as ISO 20022 `pacs.008` (from `topic-transfer-prepare`) and
`pacs.002` (from `topic-transfer-fulfil`). Tazama's schemas require party and
account fields — `Dbtr`, `Cdtr`, `DbtrAcct`, `CdtrAcct` — but a Mojaloop
**transfer** message carries only **FSP-level** identifiers (`payerFsp`,
`payeeFsp`), never customer or account identity. So before this work those ISO
fields were filled with placeholders (`"Unknown"`, `1970-01-01`, and the FSP id
reused as a stand-in account number). See `./real account numbers.md` §1–2 and
`docs/user stories/cchfrms-38/fspiop-to-iso20022-gaps.md` Gap 1 for the full
analysis.

The fix path was already known: the **quote** messages carry the real party
data, and a quote and its transfer share a correlation id. This document
describes building that join.

---

## 2. The correlation key (the crux)

A quote and its eventual transfer are linked by exactly one shared value:

```
quote.content.payload.transactionId   ===   transfer transferId   ===   transfer envelope.id
```

### How this was verified (not assumed)

The captured `topic-transfer-prepare` sample's `ilpPacket` was base64-decoded.
The ILP packet embeds the original transaction object, and its `transactionId`
field **equals the transfer's `transferId`**:

```
ilpPacket → (base64url) → ILP data object:
  { "quoteId": "01KWV5D7WW1KJ6VAAVZCV6XMCQ",
    "transactionId": "01KWV5D7WX1EPQP5GNE0VKYVCF",   ← equals the transfer's transferId
    "payer": { "partyIdInfo": { "partyIdType": "MSISDN", "partyIdentifier": "17039811902", ... } },
    "payee": { ... }, "amount": { "amount": "25", "currency": "XTS" } }
```

So `transactionId` (on the quote) and `transferId` (on the transfer) are the
same value for a given payment — this is the join key.

### Why the derivation differs per message

| Message | Where the key is read from | Why |
| --- | --- | --- |
| `topic-quotes-post` | `content.payload.transactionId` | the quote's own field |
| `topic-transfer-prepare` | `content.payloadDecoded.transferId` (fallback `envelope.id`) | decoded FSPIOP payload has `transferId` |
| `topic-transfer-fulfil` | `envelope.id` | **fulfil's decoded payload has NO transferId** — only `completedTimestamp`, `transferState`, `fulfilment` — so `envelope.id` is the only source |

The fulfil case is exactly why the join is necessary: the fulfil message
carries **no party data and no transferId in its payload at all**, so the only
way to enrich its `pacs.002` is to have cached the party data at quote time and
look it up by `envelope.id`.

Code: `src/parsers/quoteParty.js` → `correlationKeyForQuote()`,
`correlationKeyForTransfer()`.

---

## 3. Architecture

Four small modules, each independently testable, wired together by the existing
Kafka consumer:

```
                    topic-quotes-post                 topic-transfer-prepare / -fulfil
                          │                                        │
                          ▼                                        ▼
        ┌─────────────────────────────┐            ┌──────────────────────────────┐
        │ quoteParty.extractPartyData │            │ quoteParty                   │
        │  (flatten payer/payee)      │            │  .correlationKeyForTransfer  │
        └──────────────┬──────────────┘            └───────────────┬──────────────┘
                       │ keyed by transactionId                    │ keyed by transferId
                       ▼                                           ▼
        ┌─────────────────────────────────────────────────────────────────────────────────┐
        │                     enrichment  (src/tazama/enrichment.js)                      │
        │   recordQuote(env)  ── put ──►  quoteStore  ◄── get ──  lookupForTransfer(env)  │
        │                       (bounded TTL cache, src/store/quoteStore.js)              │
        └───────────────────────────────────┬─────────────────────────────────────────────┘
                                            │ partyData (or undefined)
                                            ▼
                          ┌──────────────────────────────────────────────┐
                          │ ingest.ingestIntoTazama(..., partyData)      │
                          │   → iso20022.toPacs008/002(env, partyData)   │
                          │       real identity OR placeholder fallback  │
                          └──────────────────────────────────────────────┘
```

### Module responsibilities

| File | Responsibility | Key exports |
| --- | --- | --- |
| `src/parsers/quoteParty.js` | Pure extraction + key derivation. No state, no I/O. | `extractPartyData`, `flattenParty`, `correlationKeyForQuote`, `correlationKeyForTransfer` |
| `src/store/quoteStore.js` | Bounded TTL cache (the "hold" between quote and transfer). | `createQuoteStore` |
| `src/tazama/enrichment.js` | Orchestrates extractor + cache; the single seam the consumer talks to. Never throws. | `createEnrichment` |
| `src/tazama/iso20022.js` | `toPacs008`/`toPacs002` now take optional `partyData`; real values with per-field placeholder fallback. | `toPacs008`, `toPacs002` |
| `src/tazama/ingest.js` | Forwards `partyData` to the transform; adds `enriched` flag to its result. | `ingestIntoTazama` |
| `src/kafka/consumer.js` | Caches quotes, looks up party data per transfer, passes to ingest. | `createConsumer` (+ `enrichmentStats`) |
| `src/config.js` | `enrichment.{enabled,ttlMs,maxEntries}` from env. | — |
| `src/http/server.js` | `/health` surfaces cache stats via an optional hook. | `createServer` |

---

## 4. Data extracted from a quote

`extractPartyData(quoteEnvelope)` flattens each FSPIOP `Party` (payer & payee)
into the minimal record the ISO mappers need:

```js
{
  transactionId,           // the join key
  quoteId,
  payer: {
    partyIdType,           // MSISDN | ACCOUNT_ID | IBAN | ALIAS | ...
    partyIdentifier,       // the actual value — the account number / IBAN / phone
    partySubIdOrType,
    fspId,
    firstName, middleName, lastName,   // from personalInfo.complexName
    dateOfBirth            // from personalInfo.dateOfBirth
  },
  payee: { ...same shape... },
  amount
}
```

Tolerant by design: missing `payer`/`payee` (e.g. an error quote) yields
`undefined` for that party rather than throwing; only a missing `transactionId`
throws (without it the record can never be joined, so caching is pointless — and
the caller catches that).

---

## 5. How real data lands in the ISO 20022 message

`src/tazama/iso20022.js` gained three helpers — `party()`, `account()`,
`partyName()` — that take `(fspId, partyRecord?)` and degrade **field by field**:
real value when known, the exact previous placeholder otherwise.

### Account identifier mapping (`account()`)

| Input | ISO output | Rationale |
| --- | --- | --- |
| `partyIdType: IBAN`, identifier present | `Id: { IBAN: "<value>" }` | IBAN has a dedicated ISO 20022 element |
| any other type (`ACCOUNT_ID`, `MSISDN`, …), identifier present | `Id: { Othr: [{ Id: "<value>", SchmeNm: { Prtry: "<type>" } }] }` | generic identifier slot, tagged with the FSPIOP scheme |
| no identifier (no quote matched) | `Id: { Othr: [{ Id: "<fspId>", SchmeNm: { Prtry: "FSPID" } }] }` | **unchanged** pre-enrichment placeholder |

### Party identity mapping (`party()`)

- `Nm` = `"<first> <middle> <last>"` (whatever parts exist) or `"Unknown"`.
- `Id.PrvtId.DtAndPlcOfBirth.BirthDt` = real `dateOfBirth` or `1970-01-01`.
- `Id.PrvtId.Othr[0].Id` = real `partyIdentifier` (tagged with its type) or the
  FSP id (tagged `FSPID`).

### Where enrichment does and does not apply

- **`pacs.008` (from prepare):** fully enriched — this is where `DbtrAcct` /
  `CdtrAcct` / `Dbtr` / `Cdtr` live.
- **`pacs.002` (from fulfil):** `toPacs002` accepts `partyData` for symmetry,
  but the `pacs.002.001.12` schema (`FIToFIPmtSts`) has **no** party/account
  elements — only FSP-level agents, which come from the transfer. So there is
  structurally nowhere to place a customer account number in `pacs.002`. The
  join still matters for `pacs.002` only in that the fulfil message carries no
  party data of its own; any future party-bearing field (or a `SplmtryData`
  extension) would consume `partyData` there.
- **FSP-level agents** (`DbtrAgt`/`CdtrAgt`, `InstgAgt`/`InstdAgt`) always stay
  sourced from the transfer envelope, never overwritten by the quote.

---

## 5a. Second source: the transfer's own `extensionList`

**Added after this document was first written**, prompted by a review of
`docs/Sample flow E2E/` — 18 real messages captured from a live production
DRPP/COMESA deployment (see `docs/umair docs/review sample flow e2e/`).

That review surfaced something that contradicted this design's founding
premise. §1 states, based on our own captured FSPIOP-JSON samples, that a
Mojaloop transfer message carries no party/account identity at all — only
`payerFsp`/`payeeFsp` — which is exactly why the quote→transfer join exists.
But a **live-captured `topic-transfer-prepare`-equivalent message**
(`docs/Sample flow E2E/16_fspiop_transfers_post_prepare_request.json`, ISO
20022 wire mode) showed the payee's real MSISDN riding directly on the
transfer's own `extensionList`:

```json
"extensionList": {
  "extension": [
    { "key": "CdtTrfTxInf.Cdtr.Id.PrvtId.Othr.SchmeNm.Prtry", "value": "MSISDN" },
    { "key": "CdtTrfTxInf.Cdtr.Id.PrvtId.Othr.Id",            "value": "16665551001" },
    { "key": "CdtTrfTxInf.CdtrAgt.FinInstnId.Othr.Id",        "value": "test-zmw-dfsp" }
  ]
}
```

`extensionList` turns out to be a real, schema-valid field on **both**
`TransfersPostRequest` and `TransfersIDPutResponse` in the FSPIOP v2.0 spec
(`{ extension: [{ key, value }] }`) — confirmed directly against
`@mojaloop/api-snippets`'s OpenAPI schema, not assumed. Our own test harness
never populates it (hence §1's original claim held for every message we'd
actually captured), but nothing about the schema restricts it to ISO mode —
a plain-FSPIOP deployment could populate it too.

### What was built

`src/parsers/extensionListParty.js` — a pure function,
`extractPartyDataFromExtensionList(transferEnvelope)`, that:

- Reads `content.payloadDecoded.extensionList.extension` (works on both
  prepare and fulfil — both schemas allow it).
- Matches keys against `^CdtTrfTxInf\.(Dbtr|Cdtr)\.(.+)$` and pulls out
  `Id.PrvtId.Othr.Id` → `partyIdentifier`, `Id.PrvtId.Othr.SchmeNm.Prtry` →
  `partyIdType`, `Name` → `name`.
- Returns `{ payer, payee }`, each `undefined` if no matching keys were found
  for that side — same "absent, not throwing" convention as `quoteParty.js`.
- Tolerates a missing/malformed `extensionList` without throwing.

`src/tazama/enrichment.js`'s `lookupForTransfer()` now merges this with the
quote-cache result via a new `mergePartyData()`/`mergeParty()`: **quote-cache
fields win when defined; `extensionList` fills any gap**, per party, including
the case where no quote was ever cached at all. The merge is careful to skip
`undefined` quote-cache fields rather than let them clobber a real
`extensionList` value (`flattenParty()` in `quoteParty.js` always sets every
key, even to `undefined`, so a naive object spread would have been wrong here
— caught by a test, see §10).

### Why this matters in practice

- **A transfer can now be partially enriched even when the quote-join has
  nothing** — no quote seen (PPA started mid-stream), quote arrived after the
  transfer (defeats the ordering assumption in §11), or the quote was simply
  never captured. Previously these cases fell all the way back to
  placeholders; now they fall back to `extensionList` first, if the transfer
  happens to carry it.
- **It does not replace the quote join.** The one live example seen carried
  only `partyIdType`/`partyIdentifier` (and only for `Cdtr`, not `Dbtr`) — no
  name, no date of birth. The quote join is still the richer, primary source
  wherever it's available; this is a fallback, not an upgrade.
- **Verified against the real captured file, not just synthetic fixtures**:
  running `extractPartyDataFromExtensionList()` against
  `docs/Sample flow E2E/16_fspiop_transfers_post_prepare_request.json`
  directly reproduces `{ payee: { partyIdType: "MSISDN", partyIdentifier:
  "16665551001" } }` — the exact value in the live capture — and feeding that
  through `toPacs008()` with no quote cached puts `16665551001` in
  `CdtrAcct.Id.Othr[0].Id`, confirmed by direct test run.

---

## 6. The cache: bounds and lifecycle (`quoteStore.js`)

A quote is cached the moment it is consumed and read back when its transfer
arrives. Two bounds keep this safe in a long-running consumer:

- **TTL** (`PARTY_ENRICHMENT_TTL_MS`, default 15 min): a quote whose transfer
  never arrives (dropped, error path, replay) must not live forever. Entries are
  lazily purged on access after expiry.
- **Max size** (`PARTY_ENRICHMENT_MAX_ENTRIES`, default 5000): even within the
  TTL window, memory is capped; the **oldest** entry is evicted first (FIFO).

Implementation notes:

- A JS `Map` provides O(1) get/put **and** deterministic insertion-order
  iteration, so it serves as both the index and the eviction queue — no separate
  data structure needed.
- Re-`put`ting an existing key deletes-then-reinserts so it moves to the newest
  position and size stays correct.
- `get()` (read, keep) is used for lookups — **not** `take()` (read, remove) —
  because a single transfer has **two legs** (prepare then fulfil) that must both
  enrich from the one cached quote. The entry is left to expire via TTL rather
  than consumed on first match. (`take()` exists for callers wanting one-shot
  semantics, and is tested, but the consumer path uses `get()`.)
- `now` is injectable purely so TTL is unit-testable without real sleeps.
- Counters (`puts`, `hits`, `misses`, `evictions`, `expirations`) feed
  `/health`.

---

## 7. Consumer wiring (`kafka/consumer.js`)

Inside the existing single `eachMessage` handler, two additions:

```js
// Quote leg: cache real payer/payee party data for the eventual transfer.
if (topic === QUOTE_PARTY_TOPIC) {                       // 'topic-quotes-post'
  const key = enrichment.recordQuote(envelope)
  if (key) console.log(`[enrichment] cached quote party data for txn=${key}`)
}

// Transfer leg: look up the cached party data, pass it to ingest (may be undefined).
if (tmsClient && isTazamaIngestible(topic)) {
  const partyData = enrichment.lookupForTransfer(envelope)
  storeEntry.tazama = await ingestIntoTazama(tmsClient, topic, envelope, partyData)
  const note = storeEntry.tazama.enriched ? ' (enriched)' : ' (placeholder party data)'
  ...log with note...
}
```

Only `topic-quotes-post` is cached (its response leg `topic-quotes-put` adds no
party data). Everything else about the existing flow — parsing, summarizing,
storing, Tazama delivery, error handling — is untouched.

---

## 8. Configuration

| Env var | Default | Purpose |
| --- | --- | --- |
| `PARTY_ENRICHMENT_ENABLED` | `true` | `false` → skip the join entirely, send placeholders (pre-enrichment behavior) |
| `PARTY_ENRICHMENT_TTL_MS` | `900000` (15 min) | how long an un-matched quote is retained |
| `PARTY_ENRICHMENT_MAX_ENTRIES` | `5000` | hard cap on cached quotes (oldest evicted first) |

When disabled, `createEnrichment({ enabled: false })` builds no store;
`recordQuote` caches nothing and `lookupForTransfer` returns `undefined`, so
every transfer falls through to placeholder output.

---

## 9. Observability

- **`GET /health`** now includes an `enrichment` block:
  `{ enabled, size, puts, hits, misses, evictions, expirations }`.
- **Per-message log lines** are tagged `(enriched)` or
  `(placeholder party data)`, and a `[enrichment] cached quote party data for
  txn=<key>` line is emitted per cached quote.

---

## 10. Test inventory (TDD, 63 cases, all passing)

Written test-first with Node's built-in `node:test` (zero new dependencies,
matching the prototype's minimal-dependency ethos). Run with `npm test`.

| File | Cases | Covers |
| --- | --- | --- |
| `test/quoteParty.test.js` | 10 | key derivation for quote/prepare/fulfil, the join equality, party flattening (IBAN + MSISDN + missing personalInfo), throw-on-missing-transactionId, tolerant error-quote handling |
| `test/quoteStore.test.js` | 10 | put/get, TTL expiry (with fake clock), lazy purge, FIFO eviction, re-put refresh, `take()` one-shot, stats/counters |
| `test/iso20022-enrichment.test.js` | 10 | backwards-compat (no partyData ⇒ unchanged), IBAN → `Id.IBAN`, MSISDN → `Id.Othr`+scheme, real name/DOB, per-party placeholder fallback, real identity in `PrvtId.Othr`, FSP agents stay from transfer, pacs.002 status preserved |
| `test/enrichment.test.js` | 9 | recordQuote↔lookup round-trip, both legs from one cache, miss on unseen transfer, tolerant of error quotes, disabled no-op, stats, injected TTL/clock expiry |
| `test/ingest-enrichment.integration.test.js` | 5 | full path with a fake TMS client: real IBAN reaches TMS, both legs enriched, no-quote fallback, out-of-order (transfer-before-quote) documents the ordering dependency, MSISDN carried through |
| `test/server-health.test.js` | 2 | `/health` includes enrichment stats via hook; omits cleanly without hook |
| `test/extensionListParty.test.js` | 9 | payee-only extraction, payer+payee both present, IBAN scheme, no extensionList at all, malformed extensionList, unrelated keys ignored, works on fulfil too, missing envelope tolerated |
| `test/enrichment-extensionlist.test.js` | 7 | extensionList-only enrichment (no quote cached), quote-cache precedence over extensionList, extensionList fills a quote-cache gap, neither source present, extensionList on fulfil, disabled means fully off, quote-cache stats unaffected by extensionList-only matches |

Shared fixtures: `test/fixtures/messages.js` (builder functions modelled on the
real captured payloads, encoding the correlation invariant).

### Verification against real captured data

The quote-join enrichment was run against the **actual** captured
`topic-quotes-post` and `topic-transfer-prepare` samples in
`ppa-prototype/captured/`. Result on real data:

```
Dbtr.Nm:        Firstname-Test Lastname-Test     (real, from the quote)
DbtrAcct.Id:    { "Othr": [{ "Id": "44123456789", "SchmeNm": { "Prtry": "MSISDN" } }] }
CdtrAcct.Id:    { "Othr": [{ "Id": "27713803912", "SchmeNm": { "Prtry": "MSISDN" } }] }
Dbtr DOB:       1984-01-01                        (real, not the 1970 stub)
DbtrAgt:        { "MmbId": "payeefsp" }           (FSP, still from the transfer)
```

(The captured sample uses MSISDN, so the "account identifier" is a phone number
— see §11.)

The **extensionList** path (§5a) was separately verified against
`docs/Sample flow E2E/16_fspiop_transfers_post_prepare_request.json` — a real
message from a live production deployment, not a fixture. With **no quote
cached at all**:

```
extractPartyDataFromExtensionList() ->  { payee: { partyIdType: "MSISDN", partyIdentifier: "16665551001" } }
toPacs008(envelope, partyData).CdtrAcct.Id  ->  { "Othr": [{ "Id": "16665551001", "SchmeNm": { "Prtry": "MSISDN" } }] }
toPacs008(envelope, partyData).DbtrAcct.Id  ->  { "Othr": [{ "Id": "test-mwk-dfsp", "SchmeNm": { "Prtry": "FSPID" } }] }  (placeholder — this transfer's extensionList had no Dbtr keys)
```

`16665551001` is the exact MSISDN from the live capture, reaching
`CdtrAcct.Id` with zero quote involvement — confirming the fallback source
works end to end on the data that motivated it, not just a synthetic
reconstruction of it.

---

## 11. Edge cases & limitations

| Case | Behavior |
| --- | --- |
| **Transfer before quote** (replay/out-of-order) | No cache hit → placeholder output for that message. Documented + tested. In the normal Mojaloop flow the quote always precedes the transfer. |
| **No quote ever seen** (e.g. PPA started mid-stream) | Placeholder output, unchanged from pre-enrichment. |
| **MSISDN-only scheme** (our test harness) | The `partyIdentifier` is a phone number — carried through faithfully as the account identifier, because that *is* the account reference in that scheme. A real IBAN requires the scheme to onboard `IBAN`/`ACCOUNT_ID` parties. |
| **Error quote** (no payer/payee/transactionId) | Not cached; consumer never throws. |
| **Quote's transfer never arrives** | Entry expires after TTL; memory bounded. |
| **Very high volume** | Cache capped at `maxEntries`; oldest evicted. Hit rate visible via `/health`. |
| **pacs.002 account number** | Structurally impossible — the schema has no account field. Only pacs.008 carries it. |
| **Duplicate transfers** (double-post concern) | Out of scope here (a pre-existing consumer-resilience gap, see CCHFRMS-38 §3); enrichment does not change it — a re-consumed transfer would enrich identically. |
| **`extensionList` present but only on one side** (e.g. `Cdtr` keys but no `Dbtr` keys, as in the one live example seen) | That side is enriched, the other falls back to placeholder — per-party, not all-or-nothing. |
| **`extensionList` and quote-cache disagree** (different identifier for the same party) | Quote-cache wins — treated as the more authoritative, richer source. Not expected in practice (both should describe the same real party), but the precedence is deterministic and tested. |

---

## 12. Relationship to prior work & possible next steps

- Implements the "Option A" recommendation from `./real account numbers.md` §3
  and closes Gap 1 of `docs/user stories/cchfrms-38/fspiop-to-iso20022-gaps.md`
  for the common (quote-precedes-transfer) case.
- **Extended (§5a) after a review of `docs/Sample flow E2E/`** (real DRPP/COMESA
  production traffic — see `docs/umair docs/review sample flow e2e/`) surfaced
  a transfer-prepare message carrying party identity directly on its own
  `extensionList`. Added `src/parsers/extensionListParty.js` as a second,
  independent enrichment source, merged into `enrichment.js` with quote-cache
  data taking precedence. This closes the gap for transfers whose quote was
  never seen or arrived out of order, wherever the deployment happens to
  populate `extensionList`.
- **Not attempted (candidate follow-ups):**
  - Persisting/replaying the cache so a PPA restart mid-stream keeps in-flight
    quotes (today the cache is in-memory only, consistent with the prototype's
    other stores).
  - Sourcing party data from central-ledger's `quoteParty` table as a fallback
    when no live quote was cached (Option B in `./real account numbers.md`).
  - Using `topic-quotes-put`'s `transferAmount`/`payeeReceiveAmount` and
    `payeeFspFee`/`payeeFspCommission` to enrich the amount/charge fields (a
    separate, amount-side enrichment — this work covers identity only).
  - Settlement/regulatory placeholders (Gap 2) — no Mojaloop source exists.
  - Confirming what our 5 Kafka topics actually look like when
    `quoting-service`/`ml-api-adapter` run in ISO 20022 mode (`API_TYPE`) —
    per `docs/iso-mode/iso20022 golden path flow.md`, that mode has never been
    exercised in our own test harness, so it's unverified whether
    `extensionList` (or any ISO-mode-specific field) actually reaches our
    Kafka topics the same way it appeared in the HTTP-layer E2E capture.

---

## 13. File change summary

**New source**
- `src/parsers/quoteParty.js`
- `src/store/quoteStore.js`
- `src/tazama/enrichment.js`
- `src/parsers/extensionListParty.js` — second enrichment source, reads party identity directly off a transfer's own `extensionList`

**Modified source**
- `src/tazama/iso20022.js` — `party()`/`account()`/`partyName()` builders; `toPacs008`/`toPacs002` take optional `partyData`
- `src/tazama/ingest.js` — forwards `partyData`, adds `enriched` flag
- `src/kafka/consumer.js` — caches quotes, enriches transfers, exposes `enrichmentStats`
- `src/http/server.js` — `/health` enrichment hook
- `src/index.js` — passes the hook
- `src/config.js` — `enrichment` config block
- `package.json` — `test` script
- `README.md` — env vars + "Party enrichment" section + "Second source: extensionList" section

**New tests**
- `test/quoteParty.test.js`, `test/quoteStore.test.js`,
  `test/iso20022-enrichment.test.js`, `test/enrichment.test.js`,
  `test/ingest-enrichment.integration.test.js`, `test/server-health.test.js`,
  `test/fixtures/messages.js`, `test/extensionListParty.test.js`,
  `test/enrichment-extensionlist.test.js`

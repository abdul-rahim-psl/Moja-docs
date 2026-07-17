# FSPIOP → ISO 20022 Conversion Gaps

CCHFRMS-38 converts Mojaloop's FSPIOP transfer messages
(`topic-transfer-prepare`, `topic-transfer-fulfil`) into the ISO 20022
pacs.008.001.10 / pacs.002.001.12 shapes Tazama's TMS requires. This doc is
focused specifically on **where that conversion is incomplete or lossy** —
not the ingestion flow or the infrastructure work, just the mapping itself.

Implementation: `ppa-prototype/src/tazama/iso20022.js`. Field-by-field
annotated payloads: `ppa-prototype/docs/fields.md`. This doc explains *why*
each gap exists and what it would take to close it.

## Why a gap exists at all

FSPIOP and ISO 20022 model a transfer differently:

- **FSPIOP transfer messages are participant-to-participant.** `payerFsp` and
  `payeeFsp` identify DFSPs, not the underlying customers or their accounts.
  Real customer identity (name, date of birth, MSISDN) lives one layer up, on
  the *quote* messages (`topic-quotes-post`/`topic-quotes-put`) — which this
  service already consumes for CCHFRMS-33, but does not join with the
  transfer messages.
- **ISO 20022 pacs.008/pacs.002 are bank-to-bank payment instructions**, and
  assume the sender knows full party, account, settlement, and regulatory
  detail up front — because in the traditional payment rails this format was
  designed for, that detail is always present at initiation time.

So this isn't a bug in the transform — it's a structural mismatch between
what a Mojaloop transfer message *is* and what an ISO 20022 message *assumes
it has*. The transform's job is to be honest about that gap (clearly labelled
placeholders) rather than hide it.

## Gap 1 — No customer or account identity (the biggest gap)

**ISO fields affected:** `Dbtr`, `Cdtr` (name, date/place of birth, contact
details), `DbtrAcct`, `CdtrAcct` (account identifiers), and `InitgPty`.

**What's sent instead:** all of these are placeholders. `Nm` is the fixed
string `"Unknown"`, `DtAndPlcOfBirth` is a fixed stub (`1970-01-01`,
`"Unknown"`, country `"ZZ"`), and the one real value threaded through is the
FSP id (`payerFsp`/`payeeFsp`) reused as the account/party `Othr.Id`. That FSP
id is real Mojaloop data — but it identifies the *participant* (e.g. a DFSP),
not the *customer*, so it doesn't actually satisfy what these ISO fields are
for.

**Why:** `topic-transfer-prepare` and `topic-transfer-fulfil` payloads simply
don't carry customer-level data — confirmed against live capture samples,
not just the schema docs.

**Known fix path, not yet built:** the quote messages (`topic-quotes-post`/
`topic-quotes-put`) do carry real `payer`/`payee` party objects, and share a
`transactionId` with the eventual transfer. A quote could be cached in memory
when it arrives and joined to the later transfer message by that id, enriching
the pacs.008 with real party data before it's sent. Not attempted in this
pass — it's a real design change (adds state, adds a dependency on quote
messages arriving before transfers, needs a TTL/eviction policy for
un-matched quotes), not a small addition. Worth doing first if Tazama's rules
key on customer or account identity at all, since none of that is real in
what this prototype sends today.

## Gap 2 — No settlement or regulatory metadata

**ISO fields affected:** `SttlmInf.SttlmMtd`, `ChrgBr`, `ChrgsInf`, `Purp`,
`RgltryRptg`.

**What's sent instead:** fixed constants (`SttlmMtd: 'CLRG'`,
`ChrgBr: 'DEBT'`, `Purp.Cd: 'MP2P'`, `RgltryRptg` fixed to `"BALANCE OF
PAYMENTS"`/`"100"`, charge amount `0`).

**Why:** none of these have any Mojaloop-side equivalent. Mojaloop doesn't
model inter-bank settlement method, charge-bearer party, or regulatory
reporting codes at the transfer-message level — that's cleared and settled
separately, outside the FSPIOP message flow this service observes.

**Fix path:** none available from these two topics alone. If this data
matters, it would need to come from a different source entirely (e.g.
scheme-level configuration, or a settlement-side system) — not something a
Kafka consumer on these topics can derive.

## Gap 3 — `ilpPacket`, `condition`, `fulfilment` are dropped, not even placeholdered

This is a different kind of gap from the two above: these fields **do**
contain real cryptographic proof-of-transfer data in the actual FSPIOP
payload (`ilpPacket`/`condition` on `topic-transfer-prepare`,
`fulfilment` on `topic-transfer-fulfil`). This isn't missing data — it's
data this service has, but currently throws away.

The `ml-schema-transformer-lib` mapping doc (`FSPIOP to ISO 20022
Mapping.md`) even names target ISO fields for them:

| FSPIOP field | ISO field (per upstream mapping doc) |
| --- | --- |
| `ilpPacket` | `CdtTrfTxInf.VrfctnOfTerms.IlpV4PrepPacket` |
| `fulfilment` | `TxInfAndSts.ExctnConf` |

But TMS's actual AJV schemas — confirmed by reading
`tazama-lf/tms-service/src/schemas/pacs.008.json` and `pacs.002.json`
directly, not just the mapping doc — have **no field at all** to carry this
data in the message versions TMS validates against
(`pacs.008.001.10`/`pacs.002.001.12`). The mapping doc's guidance targets
newer versions (`pacs.008.001.13`/`pacs.002.001.15`) that do have somewhere
to put it.

**Why this matters:** if a future Tazama rule ever needs to verify transfer
integrity or proof-of-fulfilment, this schema version structurally cannot
carry it — and that's not something this prototype's mapping code can fix on
its own. It would require either TMS validating against a newer pacs.008/
pacs.002 version, or a different, non-standard field to smuggle the data
through (e.g. `SplmtryData`, already used here for `Xprtn`).

## Gap 4 — Mapping choices made without a confirmed spec

These aren't missing data — they're places where a real value exists in
FSPIOP, but which ISO field it should land in (or how it should be encoded)
was a judgment call, not a documented requirement:

- **`transferState` → `TxSts` enum mapping.** CCHFRMS-38 never specifies this
  mapping. Implemented as `COMMITTED→ACSC`, `ABORTED`/`REJECTED→RJCT`,
  `RESERVED→ACSP`, everything else→`PDNG` (`toIsoTxSts()` in
  `iso20022.js`). Confirmed live that a `COMMITTED` transfer produces `ACSC`
  in Tazama's own Postgres — but nobody has confirmed this is the *desired*
  mapping, only that it's reasonable and passes validation.
- **`EndToEndId`/`InstrId` both set to the raw `transferId`.** FSPIOP only
  gives one id per transfer, so there wasn't really a choice — but the
  upstream `ml-schema-transformer-lib` doc actually recommends a different
  target field for it (`PmtId.TxId`), not `EndToEndId`. That guidance targets
  the newer message version mentioned in Gap 3, which TMS doesn't validate
  against, so it doesn't transfer over directly. Worth re-checking if TMS is
  ever upgraded to a newer pacs.008/pacs.002 schema version.
- **`GrpHdr.MsgId` derived as `<transferId>-pacs008` / `<transferId>-pacs002`.**
  Not a mapping choice so much as a constraint discovered by testing against
  a live TMS: it enforces `UNIQUE(MsgId, TenantId)` across *all* ISO messages
  for a tenant, so the obvious choice (reuse `transferId`, like `EndToEndId`
  does) collides between a transfer's pacs.008 and its pacs.002. The format
  used instead is deterministic and traceable, but entirely invented by this
  prototype — there's no real-world "message id" concept on the Mojaloop side
  to draw from.

## What this means in practice

Of the ISO fields TMS's schemas require:

- A **minority** map directly and faithfully from real FSPIOP data: amounts
  and currency, the FSP-level agent identifiers (`DbtrAgt`/`CdtrAgt`), the
  transfer id used for correlation, timestamps, expiry, and transfer status.
- A **derived group** is computed from real FSPIOP data but with logic this
  prototype invented (the `MsgId` scheme, the `TxSts` enum table) — correct
  and traceable, but unconfirmed against any spec.
- The **rest** — customer/account identity, settlement and regulatory
  metadata — has no source in a Mojaloop transfer message at all, and is
  filled with fixed placeholder values (all centralized in the `PLACEHOLDER`
  constant in `iso20022.js`, so they're grep-able rather than scattered) so
  TMS's AJV validation accepts the message.

If Tazama's fraud/AML rules are expected to reason about *who* is
transacting (not just *how much*, *how fast*, or *what status*), this gap
matters a great deal — none of the customer-identity fields carry real data
today. If the rules that matter operate mostly on amount, velocity, and
status, the current mapping already carries what they'd need.

## Suggested next step

Get a decision on whether customer/account identity is required for Tazama's
rules to be meaningful for this use case. That decision determines whether
the quote-enrichment work in Gap 1 is worth building, since it's the only
gap here with a concrete, known fix path — the others (Gap 2, Gap 3) have no
data source to draw from within these two Kafka topics at all.

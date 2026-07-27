# Recap — July 27

A summary of everything covered over the past week's sessions on the PPA
prototype and party/account identity work.

## 1. Understanding the PPA prototype

Read through `ppa-prototype/` end-to-end — a Kafka consumer that ingests
Mojaloop's quote/transfer/notification topics, transforms transfers into ISO
20022 (`pacs.008`/`pacs.002`), and forwards them to Tazama's fraud/AML TMS.
Mapped out the full flow: Kafka → parse/decode → transform → HTTP POST to TMS →
in-memory store, all exposed via a small HTTP API.

## 2. Research: "How can I get real account numbers/IBANs?"

Traced this across the FSPIOP spec and all four core services (ALS,
quoting-service, central-ledger, ml-api-adapter):

- Account numbers only ever exist as a `PartyIdInfo.partyIdentifier` tagged
  `ACCOUNT_ID` or `IBAN` — never a standalone field.
- ALS itself stores no account data — it just routes identifier→FSP via
  Oracles.
- The real data lives on **quote** messages, and is persisted in
  central-ledger's `quoteParty` table.
- Wrote this up in `docs/ppa/party identifier/real account numbers.md`.

## 3. Implemented the fix: quote→transfer party enrichment ("Option A")

Built test-first (TDD), 46 passing test cases:

- Discovered and verified the join key:
  `quote.transactionId === transfer.transferId === transfer.envelope.id`
  (confirmed by decoding a real ILP packet).
- New modules: `quoteParty.js` (extraction), `quoteStore.js` (TTL/bounded
  cache), `enrichment.js` (orchestration).
- Enriched `iso20022.js` so `Dbtr`/`Cdtr`/`DbtrAcct`/`CdtrAcct` carry real name,
  DOB, and account identifier (IBAN → dedicated `Id.IBAN`, others →
  `Id.Othr` + scheme) instead of placeholders — with graceful per-field
  fallback when no quote is matched.
- Wired into the consumer, config, and `/health`, fully backwards-compatible
  and toggleable off.
- Wrote up the design in `docs/ppa/party identifier/executive-summary.md` and
  `detailed-design.md`.

## 4. Caught and corrected an inconsistency

Flagged that an earlier statement said IBANs "don't appear in either quote
payload," then later said we "capture" them — clarified that was true only of
the one captured MSISDN sample, not a schema limitation; the FSPIOP spec
always allowed IBAN/ACCOUNT_ID/etc.

## 5. Built sample payloads for every party ID type

Created `ppa-prototype/captured/quotes-post/` with 5 samples (MSISDN real +
EMAIL/ACCOUNT_ID/IBAN/ALIAS synthetic), verified each through the real
extraction/mapping code.

## 6. COMESA-specific clarification

Confirmed `fspId` (the institution/DFSP id) sits alongside `partyIdentifier` in
`PartyIdInfo`, giving a `(institution ID, MSISDN)` unique account-holder key
under COMESA's MSISDN-only constraint.

## 7. Transparency on the synthetic samples

Clarified how the non-MSISDN samples were made — hand-fabricated (copied real
capture, swapped two fields), not real traffic, and never validated against a
live Mojaloop stack. Documented this in
`ppa-prototype/captured/quotes-post/README.md` so it can't be mistaken for
real captured data later.

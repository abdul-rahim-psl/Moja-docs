# Executive Summary — Real Party & Account Identity in the PPA

**Audience:** product / delivery leads and integration decision-makers.
**Date:** 2026-07-20.
**Status:** implemented, tested (46 automated test cases, all passing), and
verified against real captured Mojaloop traffic.

---

## The problem in one paragraph

The PPA prototype forwards every Mojaloop transfer to Tazama's fraud/AML engine
as an ISO 20022 message. Until now, the parts of that message describing **who**
is transacting — customer name, date of birth, and **account number / IBAN** —
were **fake placeholders** (`"Unknown"`, `1970-01-01`, and the bank's id used as
a stand-in account). This was the single biggest known gap in the integration:
Tazama's fraud rules that reason about *who* is paying *whom* had no real data to
work with. The reason was structural — a Mojaloop **transfer** message simply
does not carry customer or account identity; it only names the two banks.

## What we did

We closed that gap for the normal payment flow. The customer and account
details **do** exist one step earlier in Mojaloop, on the **quote** message. We
now capture that quote data as it streams by, hold it briefly in memory, and
**join it to the matching transfer** when the transfer arrives — so the message
sent to Tazama now carries the **real** payer/payee name, date of birth, and
account identifier (IBAN or account id) instead of placeholders.

This is the "Option A" approach recommended in our earlier research
(`./real account numbers.md`), now built and tested.

## What this delivers

| Before | After |
| --- | --- |
| Account field = the bank's id (fake) | Account field = the customer's real **IBAN / account number** (when the scheme uses them) |
| Name = `"Unknown"` | Name = the customer's real name |
| Date of birth = `1970-01-01` | Date of birth = the customer's real DOB |
| Tazama sees only amounts & banks | Tazama can now run **identity-based** fraud/AML rules |

## Important honest caveats

- **It depends on how the payment scheme identifies people.** Many Mojaloop
  deployments (including our own test environment) identify customers by **phone
  number (MSISDN)**, not by IBAN. In those schemes there is no IBAN anywhere to
  capture — the phone number *is* the account reference, and that is what flows
  through. A real IBAN only appears if the scheme onboards customers with IBAN /
  account-id identifiers. This is a property of the payment scheme, not
  something the PPA can manufacture.
- **The quote must arrive before the transfer** for the join to work. In the
  standard Mojaloop flow it always does (you get a quote, then you pay), so this
  holds in normal operation. If a transfer is replayed ahead of its quote, that
  one message falls back to the old placeholder behaviour rather than failing.
- **Zero risk to the existing flow.** Enrichment is purely additive. If no quote
  is matched for any reason, the message is sent exactly as before. The feature
  can be switched off entirely with one setting. Nothing about the existing
  Kafka consumption, message storage, or Tazama delivery changed.

## How we built it (quality)

- **Test-driven.** Every module was written test-first: 46 automated tests
  covering the join key, the cache (including expiry and memory limits), the
  ISO-message enrichment, the end-to-end flow, and the health endpoint.
- **Verified on real data.** The enrichment was run against actual captured
  Mojaloop quote and transfer messages and confirmed to produce the real
  customer name, identifier, and date of birth in the outgoing ISO message.
- **Observable.** The service's `/health` endpoint now reports how many quotes
  are cached and the join hit/miss rate, and each forwarded message is logged as
  either `(enriched)` or `(placeholder party data)`.

## What is still not covered

- Settlement and regulatory fields (charge bearer, purpose code, etc.) remain
  placeholders — Mojaloop has no source for them at all. Unchanged by this work.
- The account number cannot appear in the *fulfil*-side ISO message
  (`pacs.002`) because that message type structurally has no account field —
  only the *prepare*-side `pacs.008` carries it. This is an ISO-schema limit,
  not a data-availability one.

## Bottom line

The PPA now sends Tazama **real customer and account identity** for every
payment whose quote it sees — turning the biggest "fake data" gap in the
integration into real, fraud-rule-usable data, with no risk to the existing
flow and a clean off switch. Its practical value on any given deployment is
capped only by whether that scheme uses real account numbers to identify
customers in the first place.

For the full technical write-up (design, correlation key, code map, test
inventory, edge cases), see `detailed-design.md` in this folder.

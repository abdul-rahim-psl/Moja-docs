# Executive Summary — pain.001 / pain.013 (quote-stage mapping)

**Living document — updated as this workstream progresses.**
Last updated: 2026-07-30 · Status: **analysis only, nothing implemented**

Scope: §6.5 **rows 1, 2 and 5** — the quote, FX-quote and fxTransfer mappings, deferred from the completed pacs.008/pacs.002 revision ([`../pacs 002-008/`](../pacs%20002-008/)).

---

## Where this stands

Nothing has been built. We have established **what these rows should become** and **why the current ones cannot work**, and we have read enough of Tazama's ingestion code to know the constraints. The field-level mapping has not started.

## The problem in one line

Rows 1, 2 and 5 name outputs Tazama physically cannot accept — `pacs.081/082/091/092` are not ISO 20022 message types at all, and while `pacs.009` is real, **Tazama has no pacs.009 endpoint**. There are exactly four ingestion schemas: `pain.001`, `pain.013`, `pacs.008`, `pacs.002`.

This is a premise error, not a field-path error. No amount of careful field mapping fixes a row that routes nowhere.

## What the rows become

| Row | Today | Becomes | Needs work? |
|---|---|---|---|
| 1 — quotes | `pacs.081 + pacs.082` | **Two rows:** `POST /quotes` → pain.001, `PUT /quotes` → pain.013 | **Yes** — real mapping |
| 2 — fxQuotes | `pacs.091 + pacs.092` | **Deleted as output.** Becomes an enrichment source feeding source amount + exchange rate | No |
| 5 — fxTransfers | `pacs.009` | **Deleted** | No |

Rows 2 and 5 fall out of **D1** (one Tazama transaction per payment), already signed off — the same reasoning that removed row 6. Only row 1 is genuine work.

## What we learned from Tazama's source

Reading `tms-service/src/logic.service.ts` produced one correction and one finding that matters.

**The correction.** We had assumed Tazama builds its `DataCache` from the *first* message in the chain — meaning a pain.001 carrying the post-conversion amount (ZMW 1) would lock in the wrong figure before the pacs.008's MWK 60 could arrive, hard-coupling rows 1 and 2. **That was wrong.** The pain handlers populate only four identity fields (`cdtrId`, `dbtrId`, `cdtrAcctId`, `dbtrAcctId`); **pacs.008 is the sole source of the amount fields and the only handler that writes to Redis.** There is nothing for pain.001 to poison. What remains is a much weaker consistency question about per-message transaction history.

**The finding.** `configuration.QUOTING` decides who creates graph entities. pacs.008 creates `entities` nodes and `account_holder` edges **only when `QUOTING=false`**; when true it assumes pain.001 did it. Since we currently emit only pacs.008/pacs.002, a `QUOTING=true` deployment would leave the entities collection empty and every entity-based rule with nothing to work with. **For the POC this is just a knob — set `QUOTING=false`.** It becomes a real deployment dependency later, because enabling the quote stage silently moves entity creation to a message that will not exist until row 1 is built.

Two smaller results worth keeping:

- **The identifier construction is now pinned exactly** (`Othr[0].Id + SchmeNm.Prtry`, plus the agent's `MmbId` for accounts). This retroactively validates the completed pacs.008 mapping — those are precisely the fields that become graph keys — and confirms the array-vs-object question we resolved was load-bearing.
- **Geolocation is read unconditionally** into transaction details by pain.001. Our `0,0` default would not read as missing data; it lands as a real coordinate in the Gulf of Guinea. If row 1 is implemented, that defaulting policy needs revisiting.

## Priority

**Low, for now.** `QUOTING=false` is Tazama's shipped default, and with it the current two-message scope is functionally complete for the POC — so this is tidy-up that can be deferred.

**One sequencing constraint matters more than the priority.** `QUOTING` is a *single coupled switch*: with it off, the pain routes aren't registered at all (404); with it on, pacs.008 stops creating entities and account-holder edges. There is no intermediate state. So enabling the quote stage without row 1 already built would break entity resolution immediately — **row 1 must land before or together with that flip, never after.**

## Next step

Confirm `QUOTING` is false in the POC deployment (Q5) — expected, but worth verifying with whoever deployed it. Beyond that, Q1–Q4 are now answered from source and need confirmation rather than investigation; only Q6 (ordering under RECEIVE-amount flows) needs something we don't have — a non-SEND capture from CCH.

Full technical detail, including the six open questions and the six-step plan for row 1, is in [`findings.md`](findings.md).

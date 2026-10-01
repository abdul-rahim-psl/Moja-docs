# How to write a flow step table

This describes the design of the "Step table" in [README.md](README.md), so the same
format can be reused to document other captured flows (e.g. a different DRPP scenario,
an error path, or a different scheme).

## Columns

| Column | Meaning | Notes |
| ----: | :---- | :---- |
| **Seq** | Two-digit, zero-padded step number (`01`, `02`, …) | Matches the numeric prefix of the corresponding JSON file in the same folder (`01_outbound_post_transfers_request.json`, `02_fspiop_parties_get_request.json`, …). Keep the table and the filenames in lockstep — if you renumber one, renumber the other. |
| **Layer** | Which of the two capture layers the message belongs to (`SDK outbound` or `FSPIOP`) | See "Two layers" below. Lets a reader scan the table and separate payer-back-office/SDK plumbing from on-the-wire scheme traffic at a glance. |
| **Direction (fspiop-source → destination)** | Who sent it, who it's addressed to | Use the actual `FSPIOP-Source` participant id → destination participant id (e.g. `test-mwk-dfsp` → `test-fxp`) for FSPIOP rows. For SDK outbound rows use the logical caller (`harness`, i.e. the test tool acting as the payer back office) → `<dfsp> SDK`, or `SDK` → `harness` for responses. |
| **Method** | HTTP verb, or `200 OK` for a synchronous outbound-API response | FSPIOP callbacks are `PUT`; initiating calls are `POST`/`GET`. SDK outbound synchronous responses are written as the status code, not a verb, since they close out the harness's HTTP request rather than opening a new one. |
| **Resource** | The path, with the id truncated (`…`) when it's long and already stated in the flow-selected table above | e.g. `/transfers/01K7EV9TNQ…`. Keep it copy-pasteable enough to grep the corresponding JSON file. |
| **Purpose** | One sentence: what this step accomplishes in the business flow, plus the one or two field values that matter | Bold the phrase when the step is a named milestone (an authorization gate, a fulfil/settlement, a final state) — see "Bolding conventions" below. |

## Two layers

Every row belongs to exactly one of two layers, and the table's file-naming prefix
(`outbound_*` vs `fspiop_*`) encodes the same split:

* **SDK outbound** — the private, non-FSPIOP REST API between the payer DFSP's back
  office (in this capture, the Testing Toolkit acting as the payer DFSP) and its SDK
  Scheme Adapter. This is where payer authorization happens.
* **FSPIOP** — the on-the-wire interoperability API between DFSPs, FXPs and the switch.

State the two layers in prose immediately above the table (see "Two layers in this
capture" in the README) so the table itself doesn't need a legend.

## Row ordering and grouping

Rows are strictly chronological by `Seq`, but the real structure is a repeating
3-beat pattern per stage of the flow:

1. **Request/lookup** (FSPIOP) — a party lookup, a quote request, a reservation, etc.
2. **Callback/response** (FSPIOP) — the counterparty or FXP returns terms.
3. **Authorization gate** (SDK outbound) — the SDK surfaces the new state to the
   harness, the harness approves it (`acceptParty` / `acceptConversion` /
   `acceptQuote`), and the flow proceeds.

This pattern repeats three times (party, conversion, quote) before the final
prepare/fulfil pair executes. When writing a new table, group rows the same way even
if the number of repetitions differs for that flow (e.g. a domestic transfer has no
FX leg, so the conversion beat is dropped entirely).

## Bolding conventions

Bold text in the **Purpose** column marks the steps a reader is most likely to search
for:

* `**Authorization N/3**` — each of the three payer approval gates, numbered so the
  reader can see how many remain.
* `**FULFIL / settlement**` — the step where the condition is satisfied and funds move.
* Any other single milestone worth calling out (e.g. a final `COMPLETED` state) can be
  bolded in the same way, but don't bold routine lookups/callbacks — bolding should
  stay rare enough to be a signal.

## Closing summary line

End the table with one line, outside the table, that gives the left-to-right shape of
the flow as a chain of step-ranges, e.g.:

> Read left-to-right: **lookup (02–03) → FX quote (06–07) → payee quote (10–11) → FX
> reserve (14–15) → transfer prepare/fulfil (16–17)**, with a payer authorization gate
> before each of the three release points.

This is the one-sentence mental model a reader should walk away with — write it last,
after the table is final, so the step ranges are correct.

## Checklist for a new flow table

1. Confirm every JSON file in the folder has a matching row, and every row's `Seq`
   matches its file's numeric prefix.
2. Confirm `Direction` uses real participant/FSP ids from the captured messages, not
   placeholders.
3. Confirm ids referenced in `Resource` (transferId, quoteId, etc.) match the ones
   declared in the "flow selected" summary table above the step table.
4. Bold only true milestones (authorization gates, fulfil/settlement, final state).
5. Add the closing "Read left-to-right" summary line last.

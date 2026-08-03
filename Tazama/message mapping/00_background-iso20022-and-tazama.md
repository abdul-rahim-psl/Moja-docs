# Background — ISO 20022 and Tazama (Mojaloop-relevant extract)

Source: [`tazama/docs/Knowledge-Articles/iso20022-and-tazama.md`](/home/abdul-rahim/tazama/docs/Knowledge-Articles/iso20022-and-tazama.md)

This is a condensed extract of that knowledge article, limited to the parts relevant to mapping Mojaloop messages to Tazama. It's background/context for the workstreams in [`pain001-013/`](pain001-013/) and [`pacs 002-008/`](pacs%20002-008/), not new analysis.

---

## Message mapping (as designed)

| Mojaloop message | ISO 20022 equivalent |
|---|---|
| POST /quotes | `pain.001` |
| PUT /quotes | `pain.013` |
| POST /transfers | `pacs.008` |
| PUT /transfers | `pacs.002` |

Mojaloop's quotes concept has no native ISO 20022 equivalent — ISO 20022 is concerned with payment fulfilment, not the protocols used to set up a payment (like quoting). Mojaloop/Tazama reuse `pain.001`/`pain.013` (Payment Initiation) for this instead.

## Mapping methodology (5 steps, per the source doc)

1. Identify the Mojaloop fields available in the QUOTE and TRANSFER messages.
2. Group those fields by ISO 20022 business component (per the ISO 20022 data dictionary).
3. Pick a suitable ISO 20022 element to represent each one.
4. Define the transformation from the Mojaloop field to the ISO 20022 element.
5. Identify any minimum-required ISO 20022 fields with **no** Mojaloop source, and source suitable values for them.

## Findings from the original Mojaloop message analysis

- **POST /quotes carries the richest data.** Later messages (transfers) don't repeat it — if transfers are evaluated on their own, they need to be enriched with the earlier quote data during Tazama data prep.
- **Not every Mojaloop deployment uses the quote → transfer pattern.** Without a preceding quotes exchange, the transfer messages alone carry **no identifying info for Payer (debtor) or Payee (creditor)** — Tazama can't reference that data for evaluation.
- **Design rule: all data needed for evaluation must arrive in the transaction message itself**, not via parallel/side-channel enrichment. Driven by privacy law (e.g. GDPR) — Tazama can't collect personal data ahead of an actual transaction on the expectation one might occur.
- **The Mojaloop Extension List is the recommended vehicle** for supplying data that doesn't fit natively in the Mojaloop schema — both for general evaluation needs and to compensate for missing quote data in transfer-only deployments.

## Other context from the source doc

- ISO 20022 syntax is nominally XML, but is syntax-neutral in practice; Tazama's interfaces/messaging are JSON. ISO 20022 has published a whitepaper on JSON-based REST API design for this reason.
- Tazama currently scopes to instant payments/funds transfers (Business Areas `pain` and `pacs`, MVP). `camt`, `remt`, `acmt`, `admi`, `auth` are out of MVP scope.
- The **Fraud Reporting and Disposition** Business Area (`cafr.*` messages) was flagged as a possible future template for Tazama's *results reporting* output — but these messages currently live in the Card Payments domain and aren't directly reusable as-is.
- A detailed field-by-field spreadsheet (`Mojaloop_to_ISO20022_mapping_-_v.0.5_20210824.xlsx`) and an enrichment diagram (`Tazama_ISO_enrichment.png`) are referenced in the source doc as the underlying artifacts for this mapping — check the Tazama repo's `docs/images/` if they're needed for reference.

## Relationship to this folder's workstreams

- [`pacs 002-008/`](pacs%20002-008/) — completed mapping of the transfer stage (`pacs.008`/`pacs.002`), verified against real golden-path data and Tazama's actual ajv schemas (not the stale `swagger.yaml`).
- [`pain001-013/`](pain001-013/) — in-progress mapping of the quote stage (`pain.001`/`pain.013`), including the `QUOTING` config dependency and the entity-creation coupling with pacs.008.

Both workstreams supersede the general methodology above with field-verified detail; this file exists only to capture the original design rationale (why quotes map to pain, why transfers map to pacs, and the privacy/enrichment constraints) in one place.

##  Open questions for COMESA 

1. **Can we have the DFSP public keys, or a JWKS endpoint?** Without them, JWS verification cannot be proven against real traffic — only against fixtures we sign ourselves. This is the single highest-value unblock available. 
2. **Is the per-operation canonical-record shape a stable contract**, or an artefact of this capture window? Zero exceptions across **641 records** and two independent captures (141 in `DRPP_Kafka_E2E_Pack` — five 20-record transactions plus the 41-record partition-2 slice — and 500 in `raw_export_500.json`), corroborated by signature presence. But that is still two capture windows, not a guarantee.

   *What this refers to, concretely:* the audit topic does not write every operation the same way. This is a table we built directly from the captures, one row per operation, stating which single record is authoritative for that operation — not a blanket "always keep the first copy" rule. For most operations, the audit topic writes each one twice — once as the request goes in (`start`), once as the response comes back (`egress`) — and for those, the authoritative copy the table keeps is `start`. But three operations we've observed are written **only** once, as `egress` (`commitTransfer`, `reserveFxTransfer`, `notifyFxTransfer`) — there is no `start` copy for those at all, so the table keeps their sole `egress` record instead.

   The table itself:

   | Operation(s), as tagged on the wire | How the topic writes it | Record we treat as authoritative |
   | --- | --- | --- |
   | `postQuotes`, `putQuotesByID`, `postFxQuotes`, `putFxQuotesByID`, `prepareFxTransfer`, `prepareTransfer` (ordinary case) | Twice — a `start` record, then an `egress` record | `start` |
   | `fulfilTransfer`, `fulfilFxTransfer` | Once — `start` only | Not forwarded — superseded by `commitTransfer` / `reserveFxTransfer` below¹ |
   | `reserveFxTransfer` | Once — `egress` only | `egress` |
   | `notifyFxTransfer` | Once — `egress` only | `egress` |
   | `commitTransfer` | Once — `egress` only | `egress` — the record we use to decide a payment's final status |
   | `prepareTransfer`, when the transfer is rejected | `egress`, but a different body than the happy-path duplicate | `egress`, identified by its body shape, not by which copy it is |

   ¹ `commitTransfer`'s `egress` record, not `fulfilTransfer`'s `start` record, is what we use to decide a payment's final status

   This question is asking whether that per-operation table is a durable part of how the switch writes to this topic, or something that happened to hold across the two capture windows we've seen.
3. **Can we get a rejected transfer *fulfil*, and a rejected FX transfer?** Neither has ever been captured. Every branch for them is specification-only. Widening the capture window is what surfaced the three rejection shapes we do have.
4. **Can an FX quote fail *after* its payment's `pain.001` has been sent**, or only before the primary quote — the only ordering observed? This changes the correct behaviour entirely: if the primary quote can already be in Tazama's graph, a discard-and-count is wrong. **Bears on FX-quote rejection handling**; the resulting correlation behaviour is PPA-side.
5. **Is the settlement-leg partition split expected behaviour or a symptom?** It determines whether out-of-order arrival is a permanent design condition or a defect someone will fix. 
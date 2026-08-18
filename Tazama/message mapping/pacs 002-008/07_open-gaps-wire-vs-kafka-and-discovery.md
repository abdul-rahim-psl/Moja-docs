# Open gaps — wire-vs-Kafka provenance, and the missing discovery leg

Two related, unresolved gaps surfaced by review after the mapping (`01`–`06`) was already verified. Neither invalidates the field-level mapping work; both are **capture-layer / architecture-scope** questions that sit upstream of it. Recorded here rather than silently fixed, because both need input from outside this repo (a Kafka capture, and a scoping decision) before they can be closed.

---

## Gap 1 — the golden path is a wire capture; the MLA reads Kafka. Never verified as equivalent.

### The question

The 18 sample messages in `docs/Sample flow E2E/` are HTTP/wire captures — every file has a `headers` block (`Authorization`, `fspiop-source`, `fspiop-destination`, `traceparent`, `fspiop-signature`) and a `method`/`resource` pair (`POST /transfers`, `PUT /quotes/...`). The README says exactly this: they are "the on-the-wire scheme messages between DFSPs, the FXP and the DRPP switch."

The MLA, per FSD §5.1/§5.2, does not see the wire. It subscribes to **Kafka topics** (`topic-transfer-prepare`, `topic-quotes-post`, etc., per §4.4). Everything in `03_pacs008_mapping.md` / `04_pacs002_mapping.md` was built and validated from the wire capture, on the assumption that decoded Kafka content matches what the wire shows.

**That assumption has never been verified against an actual Kafka consumer dump.**

### Why it's a reasonable assumption, not a guess

Two things in the FSD itself support it, rather than just architectural plausibility:

1. **FSD §5.3 step 4** — the MLA extracts `FSPIOP-Source` and `FSPIOP-Destination` from the Kafka message. Those are HTTP header names. The MLA's own documented behaviour presumes the Kafka payload carries the same metadata the wire capture shows in its `headers` block.
2. **FSD §4.6** — transfer-topic payloads on Kafka arrive **base64-encoded** and must be decoded to recover `transferId`, `amount`, `condition`, `payerFsp`, `payeeFsp` — exactly the fields sitting in plaintext in msg 16's `body`. Consistent with "same content, wrapped for Kafka transport," not "different content."

This is Mojaloop's normal architecture: an internal service (e.g. ml-api-adapter) receives the HTTP request and republishes its content onto Kafka for downstream consumers. The wire capture is "before," Kafka is "after," same event.

### What's still unverified

- The exact **Kafka envelope shape** — whether Mojaloop wraps the republished body in metadata beyond what a decode recovers.
- Whether **every header the mapping depends on** actually survives onto **every topic** — in particular `fspiop-source`/`fspiop-destination` on `topic-notification-event`, which `InstgAgt`/`InstdAgt` need (already flagged as the open decision in `04_pacs002_mapping.md` and FSD §6.4.7 — same root cause, different symptom).
- Whether the sample capture's HTTP-layer view omits anything Kafka-layer consumers would need, or adds anything they wouldn't get.

### How to close it

Request a raw Kafka consumer dump (even a handful of messages, one per topic in §4.4) from CCH / the Mojoloop team, covering at minimum `topic-transfer-prepare`, `topic-transfer-fulfil`, and `topic-notification-event`. A single capture would likely resolve this gap and the §6.4.7 trigger-source question together, since both hinge on what headers/fields actually reach the MLA.

### Standing rule going forward

**Any mapping decision must be checked against "is this on a Kafka topic the MLA subscribes to (§4.4/Annex A.1)," not just "does this appear in the sample flow."** The sample flow is a reliable reference for field *shapes and values* once a message type is confirmed to reach the MLA — it is not itself evidence that the message type reaches the MLA. Gap 2 below is a concrete case where trusting the sample flow alone would have been wrong.

---

## Gap 2 — the discovery leg was scoped out, but it's the only source of `Cdtr.Nm`

> ✅ **CLOSED — option 2 adopted.** `CCH_FSD_MessageIngestion.md` V1.2 (6th August 2026) settled this. **`Cdtr.Nm` is accepted as permanently unsourced and degrades to the payee MSISDN**, with FSD **Open Item #4** left open to confirm a payee display-name field inside the quote messages with the Mojaloop Implementation Partner.
>
> The FSD also corrected the false premise this gap identified. §11's exclusion no longer claims discovery data is redundantly available via the quote stage; it now rests on the delivery-path fact — *"ALS is confirmed HTTPS end-to-end and never publishes to Kafka, so there is no Kafka event for this pipeline to capture in the first place… this exclusion is about there being nothing to capture, not a claim that the data is already redundantly available elsewhere."*
>
> The dependent mapping rows have been corrected: `01_pain001_mapping.md`, `02_pain013_mapping.md` and `03_pacs008_mapping.md` now source `Cdtr.Nm`/`CdtrAcct.Nm` from the payee MSISDN. The analysis below is retained as the record of how the gap was found and what the options were.

### The finding

FSD §11 (Phase 1 Exclusions) explicitly drops party discovery capture:

> "Party discovery (Account Lookup Service) event capture - discovery does not surface any transaction data not already available via the quote stage's payer/payee party information (§6.4); Tazama does not require a dedicated capture mechanism for it, so no Discovery Reverse Proxy or equivalent component is built."

Consistent with that exclusion, **§4.4's Kafka topic list has no discovery/ALS topic** — only `topic-quotes-post/put`, `topic-fx-quotes-post/put`, `topic-transfer-prepare/fulfil`, `topic-notification-event`. There is no Kafka path by which `PUT /parties` reaches the MLA at all.

### Why the exclusion's own premise is wrong

The exclusion rests on a checkable claim — "not already available via the quote stage's payer/payee party information" — and the golden path capture refutes it. Msg 10's `POST /quotes` payee block:

```json
"payee": {
    "partyIdInfo": { "partyIdType": "MSISDN", "partyIdentifier": "16665551001", "fspId": "test-zmw-dfsp", "extensionList": {...} },
    "merchantClassificationCode": "123"
}
```

No `name` field. The **payer** side of `/quotes` does carry one (`personalInfo`, `name: "Display-Test"`); the **payee** side never does, in either `POST` or `PUT /quotes`. Across the entire 18-message flow, the payee's name (`"Chikondi Banda"`) appears in exactly one place: `PUT /parties` (msg 03) — the message the exclusion assumed was redundant.

### The consequence for this mapping

`03_pacs008_mapping.md` (row for `Cdtr.Nm`) and FSD §6.4.3 both cite `PUT /parties` as the source of the payee name, and §6.4.1's event table lists it as an enrichment event feeding pacs.008. **All of that assumes a delivery path that §11/§4.4 do not provide.** With discovery excluded and nothing replacing it:

- `Cdtr.Nm` is **required** by Tazama's real ajv schema (verified in `02_design-decisions.md` — not just the TS interface, which one might dismiss as looser).
- There is no cached value to pull it from.
- **pacs.008, as currently mapped, cannot actually be assembled** under the architecture the FSD itself scopes for Phase 1.

This is not a mapping-table typo. It is a scope decision in §11 resting on a factual claim the golden path capture disproves.

### Options — not yet decided

1. **Reinstate a discovery capture path** — either the Discovery Reverse Proxy §11 declined to build, or a Kafka topic for ALS events if one exists and simply wasn't listed in §4.4. Restores `Cdtr.Nm` as a real, sourced field.
2. **Accept `Cdtr.Nm` as permanently unsourced and default it** — consistent with how `Cdtr…BirthDt` is already handled (G1 in `02_design-decisions.md`, sentinel `1900-01-01`). Every payee would carry a placeholder name; anything in Tazama doing name-based screening or entity resolution on the creditor side gets nothing.
3. **Source it from elsewhere** — no candidate found in the current 18-message flow. Would need confirmation that no other Mojoloop message (bulk lookup, a different ALS response shape, a scheme-specific extension) carries it.

**Outcome: option 2 was adopted** in FSD V1.2 (6th August 2026), which records `Cdtr.Nm` as a deliberate deviation from the field-mapping default and degrades it to the payee MSISDN. Option 1 was ruled out on the delivery-path fact rather than on cost — there is no ALS Kafka topic to list, because ALS never publishes to Kafka at all. Option 3 remains partially live as FSD Open Item #4: the Mojaloop Implementation Partner is still to confirm whether a payee display-name field exists somewhere in the production quote messages.

FSD §11, §6.4.3 and §6.4.4 were corrected accordingly; the mapping rows in `01_pain001_mapping.md`, `02_pain013_mapping.md` and `03_pacs008_mapping.md` have now been brought in line.

### Relationship to Gap 1

Both gaps are instances of the same failure mode: treating "present in the sample capture" as equivalent to "reaches the PPA in production." Gap 1 is about *encoding/transport* fidelity between the wire and Kafka for messages that **are** on a subscribed topic. Gap 2 is about a message type that **was never going to be on a subscribed topic at all**, regardless of transport fidelity. Closing Gap 1 (a real Kafka capture) will not resolve Gap 2 — that needs a scope decision, not a data capture.

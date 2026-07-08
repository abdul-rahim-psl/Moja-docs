# Review: CCH-PL-FSD-MLA-PPA-001 v2.0 (MLA & PPA Functional Specification)

**Reviewed against:** `CCH_FSD_MLA_PPA_v2.0.pdf`, dated 6th July 2026 (cover) / 3rd July 2026 (version history), authored by Behjet Ansari.

**Method:** Read the FSD section by section, then cross-checked its Kafka/topic/payload claims against the live-verified investigation already sitting in this repo (`docs/Kafka/kafka-topics-quote-transfer.md`, `docs/kafka-topics-ticket-status.md`, `docs/ppa/ppa-progress.md`, `ppa-prototype/`). That investigation ran the actual `quoting-service` / `ml-api-adapter` / `central-ledger` stack, captured real Kafka traffic, and confirmed topic names, partition counts, and payload shapes directly against a live broker — so where it conflicts with the FSD, it's the FSD that needs to change, not the other way round.

Overall the document is well organized and readable for a mixed technical/non-technical audience, and the error-handling tables (4.6, 5.7) are a genuine strength — most failure modes are named and given a concrete behaviour. The issues below are concentrated in a few places: the Kafka ingress model in Section 4.2 is built on a wrong assumption, the request/callback → ISO 20022 mapping has an internal contradiction, and several edge cases (partial TMS failures, notification-event fan-out) aren't addressed at all.

---

## Critical Findings

### 1. The Kafka topic model in Section 4.2 (and Annex A.1) doesn't match reality

The FSD models MLA ingress as **one Kafka topic per Mojaloop service**: `quoting-service`, `ml-api-adapter`, `account-lookup-service [TBC]`. This is the load-bearing assumption behind the entire MLA design (Section 4, Annex A.1).

The live Kafka investigation already in this repo (`docs/Kafka/kafka-topics-quote-transfer.md`) found the actual topic names are **per-action, not per-service**, and confirmed this against a running broker (`kafka-topics.sh --list`), not just code:

- Quotes: `topic-quotes-post`, `topic-quotes-put`, `topic-quotes-get`, plus `topic-bulkquotes-{post,put,get}` and `topic-fx-quotes-{post,put,get}` — nine topics, not one.
- Transfers: `topic-transfer-prepare`, `topic-transfer-fulfil`, `topic-transfer-get`, `topic-transfer-position`, `topic-transfer-position-batch`, `topic-admin-transfer` — six-plus topics, not one.
- The switch-to-payee notification (what the FSD calls the "PATCH" callback) rides on a completely separate topic, `topic-notification-event`, published by **central-ledger**, not by `ml-api-adapter` itself.

This isn't a naming nit — it changes the MLA's actual subscription list from 3 topics (one marked TBC) to 15+, changes which service is the producer of record for the most safety-critical event (final transfer state), and means Annex A.1 as written would not compile into a working consumer configuration. Recommend Section 4.2 and Annex A.1 be rebuilt directly from `docs/Kafka/kafka-topics-quote-transfer.md` rather than left as "topic name TBC" — for quotes and transfers this is no longer unconfirmed, it's already measured.

### 2. Event Envelope (4.4) doesn't account for the base64 vs. plain-JSON payload split

The live investigation found a structural difference the FSD's `body` field (4.4) doesn't mention: **quote payloads are plain JSON**, but **transfer payloads arrive as a base64-encoded `data:` URI** (`docs/Kafka/kafka-topics-quote-transfer.md`, "Transfer message envelope" section, confirmed against live traffic). A consumer needs to branch on event type and decode transfer payloads before they're usable.

The FSD's Event Envelope (Section 4.4) describes `body` uniformly as "the full original FSPIOP message body," with no mention of encoding, and Section 4.3 step 3 ("extracts the key identification fields") gives no indication the MLA needs to decode anything before extracting IDs. If the MLA is meant to pull `transferId`, `condition`, etc. out of the body to populate the envelope's `id` field, it needs decoding logic this section doesn't specify. Recommend adding an explicit decode step to 4.3 and a note to 4.4 on which `eventType`s require it.

### 3. `topic-notification-event` fires far more often than the FSD's 1-event-per-stage model assumes

Section 3.3 and the Stage 3 walkthrough (6.1, steps 25–27) treat the "PATCH /transfers/{ID}" notification as a single, discrete event per transfer. Live measurement (`docs/Kafka/kafka-topics-quote-transfer.md`, "Message counts observed") found `topic-notification-event` produced **37 messages in one golden-path run versus 8 each on prepare/fulfil** — it fires once per state transition, including settlement-related actions unrelated to the P2P quote/transfer flow being modeled.

If the MLA forwards every message on this topic to PPA `/TRANSFERS` as-is, PPA will receive many more "PATCH" envelopes per transaction than the one-to-one model in Section 6.1 assumes, and — per the FSD's own pipeline (5.3 step 6) — could attempt to build and forward a `pacs.002` for each one. Section 4.6/5.7's error tables have no de-dup or filtering behaviour for this. Recommend adding an explicit filter/dedupe rule (e.g. by `metadata.event.action`, as already flagged as a suggested next step in `docs/kafka-topics-ticket-status.md`) to either the MLA or PPA processing logic before this goes to build.

### 4. No atomicity or partial-failure handling for compound ISO 20022 message pairs sent to TMS

Section 5.5 and Annex A.3 show several event pairs producing **two** ISO 20022 messages, not one: quotes → `pacs.081` **+** `pacs.082`; FX quotes → `pacs.091` **+** `pacs.092`. Annex A.3 shows these as two separate TMS endpoint calls.

Section 5.6/5.7 describe retry and dead-letter behaviour only for a single TMS call. Nothing in the document addresses what happens if, say, `pacs.081` posts successfully (HTTP 200, cache cleared per 5.3 step 8) but `pacs.082` then fails all 3 retries and is dead-lettered — the quote transaction would be **permanently half-recorded** in Tazama, with no compensating action described. For a fraud monitoring system this is not a cosmetic gap: an incomplete record could mean a rule/typology processor never sees the data it needs to flag a bad transaction. Recommend the pipeline (5.3) and error table (5.7) explicitly address ordering and compensation for multi-message sends, or clarify whether the two messages should be combined into a single atomic POST.

### 5. Section 5.5's mapping table contradicts the Section 6.1 narrative on what triggers `pacs.008` vs. `pacs.002`

Section 5.5 has two separate rows that both key off `PUT /transfers/{ID}`:

- `POST /transfers + PUT /transfers/{ID} → pacs.008`
- `PUT or PATCH /transfers/{ID} → pacs.002`

Read literally, a `PUT /transfers/{ID}` callback triggers **both** rows — the cached-pair build (pacs.008) and the standalone build (pacs.002). The Section 6.1 walkthrough (steps 22–27) resolves this in practice by having PUT drive the pacs.008 build (paired with the cached POST) and PATCH separately drive the pacs.002 build — but the table as written doesn't say that, and doesn't cover the case where a PUT arrives with **no cached POST** (e.g., MLA missed the prepare event, or it's outside the cache TTL). Does a "lone" PUT fall back to producing a pacs.002 the way an error callback does per Section 6.3? The document doesn't say. Same ambiguity exists for `PUT or PATCH /fxTransfers/{ID} → pacs.002` vs. `POST /fxTransfers + PUT /fxTransfers/{ID} → pacs.009`. Recommend splitting the table row so it's unambiguous which callback type (PUT vs. PATCH) drives which output, and explicitly stating the no-cached-POST fallback behaviour.

---

## Significant Findings

### 6. `PARTY` is missing from the `eventType` enum in Section 4.4, and from the `id` field description

Section 4.5's egress table clearly treats `PARTY` as one of four routable event types (alongside QUOTE, FXQUOTE, TRANSFER/FXTRANSFER), routing to `POST /PARTIES`. But Section 4.4's `eventType` field definition only lists `QUOTE, FXQUOTE, TRANSFER, or FXTRANSFER` — `PARTY` is absent. The `id` field description in the same table ("quoteId, transferId, conversionRequestId, or commitRequestId") also has no entry for a party lookup identifier. Section 4.3 step 3 has the same gap (though it hedges with "etc."). This looks like a straightforward oversight from when `/PARTIES` routing was added in the v1.1 hygiene pass — recommend reconciling 4.3/4.4 with 4.5.

### 7. Section 4.6 doesn't say whether a 4xx from the PPA advances the Kafka offset — risk of a permanent poison-pill

Per Section 4.3 step 6, the MLA only commits the Kafka offset after HTTP 200. Section 4.6's row for "PPA returns a 4xx error" says "log the full envelope as an error — do not retry," but doesn't state whether the offset is committed anyway (so the consumer moves on) or left uncommitted (so the same invalid message is re-fetched forever on restart/rebalance). Given Kafka's per-partition ordering guarantee, if the offset is *not* committed, every message behind the bad one on that partition is permanently stuck until someone manually intervenes — a real production risk given this system will process fraud-relevant transaction data. Recommend making this explicit: presumably the offset **should** commit here (same as the "invalid/unreadable Kafka message" row, which explicitly says "skip it"), but the document should say so rather than leave it inferable.

### 8. `central-ledger` is absent from the system context and glossary despite being the actual source of the notification event

Section 3.2's actor list groups "Account Lookup Service | Quoting Service | ML API Adapter" under COMESA RRPS, and the Glossary's "ML API Adapter" entry says it "manages notification callbacks to FSPs." Per the live investigation, it's actually **central-ledger** that owns transfer settlement state and produces `topic-notification-event`; `ml-api-adapter` only consumes that topic and turns it into the outbound HTTP callback (`docs/Kafka/kafka-topics-quote-transfer.md`, Transfer Flow Topics table). Since central-ledger is the system of record for the data the MLA ultimately needs for Stage 3's final-state event, its absence from the system context diagram and glossary is a real gap, not just a naming nicety — anyone implementing against this FSD alone wouldn't know central-ledger exists.

### 9. MLA's synchronous per-message design plus a 15+ topic reality raises an unaddressed throughput/head-of-line-blocking question

Section 4.3 describes the MLA processing events one at a time, blocking on each until HTTP 200 (step 5), with up to ~7 seconds of retry backoff (1s+2s+4s) before dead-lettering a failed send (4.6). Combined with Finding #1 (the real topic count is 15+, not 3), this raises a question the FSD doesn't address: is there one consumer process per topic, or one shared consumer looping over all topics? If the latter, a slow/failing PPA call on one topic (say, a stalled transfer) would block the consumption of unrelated topics (say, party lookups) behind it. Given Open Item #5 is "confirm expected TPS for sizing," this concurrency model should be specified before sizing can happen at all — recommend adding it to Section 4 or folding it into Open Item #5/#8.

### 10. PPA's error table (5.7) attributes "Kafka offset" behaviour to the PPA, which doesn't own a Kafka consumer

Section 5.7's "Cache unavailable (ValKey down)" row ends with "Kafka offset is not committed" — but per Section 4, the Kafka consumer and its offset belong to the **MLA**, not the PPA. The PPA only receives HTTP POSTs. This is presumably describing the *downstream effect* (PPA doesn't return 200 → MLA doesn't commit), but as written in the PPA's own error table it reads as though the PPA directly controls Kafka state. Minor, but worth tightening for a document explicitly aimed at both technical and non-technical reviewers.

---

## Minor / Hygiene

- **Date mismatch on v2.0 itself.** The cover metadata table (page 1) lists the document date as **6th July 2026**, but the Version History table on the same page lists the v2.0 entry as **3rd July 2026**. The v1.1 changelog entry specifically calls out "reconciled header/footer date" as a fix — the same class of error has reappeared in v2.0.
- **PATCH is filed under "Callback Event" despite the document's own note that it isn't one.** Section 3.3's stage table and Section 5.4's correlation table both list PATCH under a "Callback Event" heading, even though the footnote under the Section 3.3 table explicitly says "they are not a response from the payee." Consider a distinct row/label (e.g. "Switch Notification") rather than overloading the callback-event column with something the text says isn't one.
- **The sequence diagram (Figure 2, page 14) encodes logic the prose doesn't.** The diagram has a yellow annotation, "No cache lookup needed for PATCH — build pacs.002 directly," which is important (and consistent with Finding #5's resolution for PATCH), but this branching rule appears nowhere in the textual Processing Pipeline (Section 5.3, step 4–5). Someone implementing from the text alone would miss it.

---

## What's Handled Well

- The error-handling tables (4.6, 5.7) are thorough and give concrete, testable behaviour for most failure modes — this is above average for a first/second-draft FSD.
- Section 8's Open Items list is honest about what's unconfirmed (topic names, TTL, JWS, TPS, hosting, extension fields, timeouts) rather than silently assuming defaults.
- The Annex B field-level reference and Section 5.5 mapping table (aside from the ambiguity in Finding #5) give implementers something concrete to code against, with named source references (Annex "References" section) rather than asserting the mapping is original work.
- The distinction between async request/callback pairing and the need for a correlation cache is explained clearly and consistently across Sections 3.1, 5.1, and 5.4.

---

## Open Items — Cross-Check Against What's Already Known

Of the 8 items in Section 8:

- **#1 (ALS/party topic name) and #2 (FX quote/transfer topic names)** are correctly flagged as still open — the in-repo investigation only exercised the golden-path P2P quote/transfer flow, not party lookup or FX. These remain genuinely unresolved.
- However, for the **non-FX quote and transfer topics**, which the FSD also treats as unconfirmed (via the "topic name TBC" framing and the generic per-service topic table), the answer already exists in this repo and should be pulled forward into the FSD rather than left as an open item — see Finding #1.
- **#3 (cache TTL)** and **#8 (timeout values)** remain open and reasonable to defer to the JAD workshop.
- **#7 (COMESA-specific extension fields)** — worth noting the live-captured payloads in `ppa-prototype/captured/` and `kafka-topic-listener/captured/` are from a generic Mojoop test harness, not COMESA's actual deployment, so they can't resolve this item either; still genuinely open.

---

## Suggested Questions for the JAD Workshop

1. Given the real topic list is 15+ topics (not 3), does the MLA run one consumer per topic or a shared consumer? This affects both the TPS sizing question (#5) and the head-of-line-blocking risk in Finding #9.
2. What's the intended behaviour when a `PUT /transfers/{ID}` (or `/fxTransfers/{ID}`) arrives with no cached POST — same fallback as an error callback (Finding #5), or something else?
3. For compound TMS sends (pacs.081+082, pacs.091+092), is partial failure acceptable, or does the PPA need transactional/compensating behaviour (Finding #4)?
4. Does a 4xx from the PPA advance the MLA's Kafka offset or not (Finding #7)? If not, what's the operational runbook for un-sticking a partition?
5. Should `topic-notification-event`'s fan-out (Finding #3) be filtered at the MLA (before it ever reaches PPA) or at the PPA (after receipt)? This affects where the `metadata.event.action` filtering logic documented in `docs/kafka-topics-ticket-status.md` should live.

---

## References Used for Grounding

- `docs/Kafka/kafka-topics-quote-transfer.md` — live-verified Kafka topic names, partition counts, payload shapes (quote vs. transfer encoding), consumer group requirements.
- `docs/kafka-topics-ticket-status.md` — ticket-level status of the same investigation, including the notification-event fan-out finding.
- `docs/ppa/ppa-progress.md` — plain-language summary of the PPA prototype work and what's been proven live vs. still assumed.

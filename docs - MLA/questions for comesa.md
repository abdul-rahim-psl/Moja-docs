##  Open questions for COMESA 

**All five were put to CCH and the Mojaloop Foundation at the 2026-09-09 meeting** (`docs/meetings/9-sept.md`). Answers are summarized against each question below; `plan.md` §13.1 and §14 carry the full, maintained record — this file is kept as what was actually asked, not re-derived from the answers.

1. **Can we have the DFSP public keys, or a JWKS endpoint?** Without them, JWS verification cannot be proven against real traffic — only against fixtures we sign ourselves. This is the single highest-value unblock available. **Answered in part, not yet delivered:** the 19 ids resolve to 8 DFSPs, 2 FXPs and 9 regional hubs; George is obtaining the keys via Infotex and checking for a JWKS endpoint. Separately, MLA should interface with Mojaloop Connection Manager (MCM) rather than hold its own key store — Sam to share an onboarding video.
2. ~~Is the per-operation canonical-record shape a stable contract, or an artefact of this capture window?~~ **Resolved — yes, by design across all environments**, per both George (CCH) and Michael (Mojaloop Foundation). The evidentiary framing below (641 records, two independent captures) is also superseded: the 141-record set is a confirmed subset of the 500-record export, not a second window. Zero exceptions across **641 records** and two independent captures (141 in `DRPP_Kafka_E2E_Pack` — five 20-record transactions plus the 41-record partition-2 slice — and 500 in `raw_export_500.json`), corroborated by signature presence. But that is still two capture windows, not a guarantee.

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
3. **Can we get a rejected transfer *fulfil*, and a rejected FX transfer?** Neither has ever been captured. Every branch for them is specification-only. Widening the capture window is what surfaced the three rejection shapes we do have. **Answered, not yet delivered:** George confirmed neither exists in the current captures; Sam is to supply two simulated examples from Mojaloop's test environment (a payee-DFSP rejection, and a switch-generated timeout failure).
4. ~~Can an FX quote fail *after* its payment's `pain.001` has been sent, or only before the primary quote — the only ordering observed?~~ **Resolved — no, not in DRPP.** Michael confirmed DRPP only allows currency conversion via the payer DFSP, so the reverse ordering would itself be a system failure; the discard-and-count behaviour already built is permanently correct here. This changes the correct behaviour entirely: if the primary quote can already be in Tazama's graph, a discard-and-count is wrong. **Bears on FX-quote rejection handling**; the resulting correlation behaviour is PPA-side.
5. **Is the settlement-leg partition split expected behaviour or a symptom?** It determines whether out-of-order arrival is a permanent design condition or a defect someone will fix. **Partially answered:** Michael attributes today's out-of-order arrival to a manual settlement-window process, with a deterministic replacement already planned. The partition key itself is still pending — Sam to look it up and share.

---

## How to ask each one

### 1. DFSP public keys / JWKS endpoint

**Context.** We hold 286 real `fspiop-signature` values from `raw_export_500.json`, across 19 distinct DFSP ids (11 of which appear on canonical, forwarded records), and we hold none of the public keys — so every signature verification to date is against fixtures we re-signed ourselves.

**Question.** "We have 286 real signatures from the capture and cannot verify one. Can we get the public keys for the 19 DFSP ids in the export — or better, a JWKS endpoint? And separately: in production, does MLA hold a synced key store or call a live lookup? We need to know so that a key-source outage classifies as transient rather than as a signature failure."

### 2. Per-operation canonical-record shape

**Context.** The per-operation table above holds with zero exceptions across 641 records and two capture windows, corroborated by signature presence — but no amount of further capture data can tell us whether it is how the switch is built or how it happened to behave. `commitTransfer` is the record that decides final payment status, and it exists only as `egress`.

**Question.** "Most operations write twice, `start` then `egress`. But `commitTransfer`, `reserveFxTransfer` and `notifyFxTransfer` write **only** as `egress` — and `commitTransfer`'s `egress` record is what tells us a payment reached final state. Is that per-operation asymmetry a property of how the switch writes to this topic, or something that happened to hold across our two capture windows? Specifically: is `commitTransfer` guaranteed `egress`-only?"

### 3. A rejected transfer *fulfil*, and a rejected FX transfer

**Context.** Every `fulfilTransfer` / `fulfilFxTransfer` record in the export is successful, and `prepareFxTransfer` / `reserveFxTransfer` never carry an `/error` URL — so both branches are specification-only. Reason-code coverage is also thin: three distinct codes across all 71 error records (`1001` ×20, `3204` ×49, `4200` ×2).

**Question.** "We have real rejection data for FX quotes and transfer prepares — but we have never seen a fulfil-side rejection or an FX-transfer-level rejection. Can you run or capture one of each? And separately: is there a reason-code catalogue? We have only seen three codes across 71 error records, so our mapping is validated in shape but not in coverage."

### 4. FX quote failing after `pain.001` has been sent

**Context.** All 19 FX-quote rejections in the capture die before `postQuotes` ever fires — established by timestamp ordering — so no `pain.001` is ever built and discard-and-count is safe. If the ordering can reverse, Tazama holds a `pain.001` for a dead payment with nothing arriving to close it out.

**Question.** "Every FX-quote rejection we have captured died before the primary quote was even requested — so nothing had been sent to Tazama and discarding it is safe. Can the ordering ever go the other way: primary quote succeeds, `pain.001` goes out, and *then* the FX quote fails? If so we need to send something to close that payment out, and today we do not."

### 5. Settlement-leg partition split

**Context.** `04_ZMW_to_EGP_partition_split` spans partitions 7 and 10, with the whole settlement leg on a different partition under a fresh trace id; the 500-record export carries 52 distinct Kafka keys against only 44 distinct `transactionId`s. Kafka orders only within a partition, so this is what makes out-of-order arrival real rather than theoretical.

**Question.** "What is the partition key on `topic-event-audit`? We see a single transaction's settlement leg landing on a different partition under a fresh trace id, and 52 distinct Kafka keys across only 44 transactions — so the key clearly is not transaction-scoped. Is that intentional? Because if it is, cross-partition out-of-order arrival is permanent and we design around it forever; if it is not, someone may fix it."

---

## Open questions for COMESA — 2026-09-10 (quoting-service ISO 20022 forwarding bug)

Found while validating our own Kafka/broker config against a local Mojaloop instance (handover item 3.4)
— a local `mojaloop/helm` deployment at tag `v17.2.0`, ISO 20022 + FX mode, onboarded with test DFSPs
(`e2e-sim1` payer, `e2e-sim2` payee, `e2e-sim-fxp1` FXP). Not part of the 2026-09-09 meeting; a separate
technical thread, tracked here so it isn't lost or merged with the questions above.

1. **`quoting-service` sends the wrong message format when forwarding an FX quote to an ISO 20022-mode
   participant, and then mislabels the resulting rejection as a generic network error.** Root-caused by
   reading source on both ends, not guessed: `quoting-service`'s outbound header builder
   (`src/lib/util.js`'s `generateRequestHeaders`/`headersMappingDto`) has no ISO 20022 awareness at all —
   confirmed by reading the function end to end, no `apiType` parameter exists anywhere in that path —
   so it always sends the plain-FSPIOP media type
   (`application/vnd.interoperability.fxQuotes+json;version=2.0`) even though `quoting-service` itself
   *requires* the ISO 20022 form (`application/vnd.interoperability.iso20022.fxQuotes+json;...`) on its
   own inbound side. A correctly-configured ISO 20022 destination rejects the plain form as invalid
   (confirmed directly in the destination's own logs: `error: accept header is invalid`, a clean `400`
   with FSPIOP error code `3101`). But that real, specific rejection reason never survives the trip back:
   `quoting-service`'s shared HTTP-forwarding helper (`src/lib/http.js`'s `httpRequest`) collapses *any*
   non-2xx response other than a bare `404` into a generic `"Network error"` (FSPIOP error code `1001`),
   discarding the destination's actual error entirely. From the payer DFSP's side this is indistinguishable
   from a real network/connectivity fault.

## How to ask it

**Context.** Reproduced cleanly and repeatedly on a local instance: an FX quote in the corridor's actual
supported currency pair, sent to a correctly-onboarded FXP participant running in ISO 20022 mode, fails
every time at the forwarding step with error code `1001` ("Network error") — while the FXP's own logs
show it received the request and cleanly rejected it (code `3101`, "accept header is invalid") because
`quoting-service` sent the plain-FSPIOP media type instead of the ISO 20022 form. Both failure points are
confirmed by reading `quoting-service`'s own source, not inferred from behaviour alone. Since the real
DRPP environment runs ISO 20022 mode in production and its captured transactions settle successfully
(`TxSts: COMM`, no error records, per `DRPP_Kafka_E2E_Pack`), either production runs a patched/different
version, or there's a configuration difference between our local reproduction and the real deployment that
avoids this — worth confirming before assuming it's purely a local artefact.

**Question.** "We've hit what looks like a real bug in `quoting-service`: when forwarding a `POST
/fxQuotes` to a participant running in ISO 20022 mode, it sends the plain-FSPIOP media type instead of
the ISO 20022 form its own inbound side requires — and when the destination correctly rejects that, the
real reason gets discarded and reported back as a generic 'Network error' instead. We've traced both to
specific functions in `quoting-service`'s own source (`src/lib/util.js` and `src/lib/http.js`) and can
share the detail. A few things we'd like to check: (1) Have you seen this in the real DRPP environment,
or is it patched/absent there? (2) What exact `quoting-service` / chart version does DRPP prod/UAT run —
is it the same base as the public `mojaloop/helm` chart at tag `v17.2.0`, or a fork with fixes applied?
(3) Is there a config or deployment-level difference in your setup (e.g. hub↔participant traffic actually
staying in classic FSPIOP mode at this specific hop) that avoids triggering it? (4) Should we raise this
upstream with the Mojaloop project ourselves, or do you already have a channel/fork where fixes like this
get tracked?"

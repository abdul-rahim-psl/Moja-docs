##  Open questions for COMESA 

**All five were put to CCH and the Mojaloop Foundation at the 2026-09-09 meeting** (`docs/meetings and emails/9-sept.md`). Answers are summarized against each question below; `plan.md` §13.1 and §14 carry the full, maintained record — this file is kept as what was actually asked, not re-derived from the answers.

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
3. **Can we get a rejected transfer *fulfil*, and a rejected FX transfer?** Neither has ever been captured. Every branch for them is specification-only. Widening the capture window is what surfaced the three rejection shapes we do have. **Answered, and two of three samples now delivered [2026-09-16]:** George confirmed neither exists in the current captures; Sam Kummary supplied a TTK test-run report (`docs/meetings and emails/sam-email-2026-09-16-rejection-samples.md`). From it: the **payee-DFSP rejection is received** (test `payee-abort-v1_1` — a `PUT /transfers/{id}/error` relayed as `{GrpHdr, TxInfAndSts: {PrcgDt, TxSts: "ABOR"}}`), and the **switch-generated timeout is received and matches the shape already assumed** (test `payer-transfer-timeout` — `StsRsnInf.Rsn.Prtry: "3303"`, "Transfer expired"). **The rejected FX transfer is still outstanding** — every FX-labelled folder in the report either runs through an SDK abstraction that never exposes the raw shape, or returns `202 Accepted` with no callback body. **A new gap came out of this**: `TxSts: "ABOR"` is not in our `TxSts` translation table, which was built against the ISO `COMM`/`RESV` vocabulary — see `plan.md` §14 Q3, which carries the full analysis and is the authority on it.
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

## Open questions for COMESA — 2026-09-10 (ISO 20022 mixed-mode forwarding, and error-detail loss)

Found while validating our own Kafka/broker config against a local Mojaloop instance (handover item 3.4)
— a local `mojaloop/helm` deployment at tag `v17.2.0`, ISO 20022 + FX mode, onboarded with test DFSPs
(`e2e-sim1` payer, `e2e-sim2` payee, `e2e-sim-fxp1` FXP). Not part of the 2026-09-09 meeting; a separate
technical thread, tracked here so it isn't lost or merged with the questions above.

1. **`quoting-service` does not translate media types between a plain-FSPIOP caller and an ISO 20022
   destination — it passes the caller's own media type straight through.** Its inbound side is genuinely
   dual-mode: `resolveOpenApiSpecPath(isIsoApi)` (`src/lib/util.js:350`) selects
   `QuotingService-swagger_iso20022.yaml` or `QuotingService-swagger.yaml` per request, based on that
   request's own `content-type`, so it accepts both forms. On the outbound side,
   `applyResourceVersionHeaders` (`:137`) only *rebuilds* the `accept`/`content-type` headers when
   `fspiop-source` is the Hub; for a DFSP-originated request being forwarded onward, the caller's headers
   are relayed verbatim. The result: a plain-FSPIOP DFSP's quote, forwarded to a participant running
   `API_TYPE: iso20022`, arrives in the plain form and is correctly rejected by the destination
   (`error: accept header is invalid`, a clean `400`, FSPIOP code `3101`). Verified both ways on our
   instance — an ISO 20022 caller's quote is forwarded with the correct ISO 20022 media type and is
   accepted; a plain-FSPIOP caller's is not.

2. **When that rejection comes back, the real reason is discarded and replaced with a generic network
   error.** `quoting-service`'s shared HTTP-forwarding helper (`src/lib/http.js`'s `httpRequest`, used by
   `fxQuotes.js`, `quotes.js` and `bulkQuotes.js` alike) collapses *any* non-2xx response other than a
   bare `404` into `DESTINATION_COMMUNICATION_ERROR` / `"Network error"` (FSPIOP code `1001`). The
   destination's specific, well-formed FSPIOP error body never reaches the payer DFSP. From the payer's
   side a media-type mismatch is indistinguishable from a genuine connectivity fault — which is what sent
   our own investigation looking for a network problem for some time.

3. **The same pattern appears on the transfer leg, independently.** When a transfer is fulfilled with a
   fulfilment that doesn't match the ILP condition, `central-ledger`'s fulfil handler logs the exact
   cause — `error: error in FulfilHandler: invalid fulfilment` — but classifies it as `3100`
   ("Generic validation error"). The payer receives `3100`, never the FSPIOP-specified `5104`. So in
   both components, the real diagnosis exists server-side in logs and is genericised before it reaches
   the counterparty.

4. **`quoting-service` does not enforce quote or FX-quote expiry at all.** There is no reference to
   `expired`/`isExpired` anywhere in its `src/`; `expiration` appears only in `src/model/quotes.js`
   (`:308`, `:598`), where it is persisted to the database and never read back. `src/model/fxQuotes.js`
   has no expiration handling whatsoever. Confirmed empirically on both legs: a `POST /fxQuotes` with an
   expiration 60 seconds in the past is accepted (`202`) and forwarded normally, and a
   `PUT /fxQuotes/{ID}` delivered 40 seconds after expiry is accepted (`200`) — even when the quote had
   already been terminated with an error callback. **Consequence for `topic-event-audit` consumers: no
   "expired quote" record is ever emitted on the quoting leg.** Expiry is enforced only on the transfer
   leg, by `central-ledger`'s timeout handler, surfacing as `operation: timeoutReserved` with `3303`.

5. **FX-quote error events on `topic-event-audit` carry no correlation identifiers.** The egress record
   for a `PUT /fxQuotes/{ID}/error` has no `operation` tag, and no `conversionId`,
   `conversionRequestId`, `determiningTransferId` or `transactionId`. Its tags are only the generic set
   plus `transactionType: fxquote` and `transactionAction: put`. The single way to correlate such a
   record back to its transaction is to parse the id out of the `httpUrl` tag or the payload. Relatedly,
   a *rejected* transfer prepare (`4001` insufficient liquidity, `4200` limit breach) produces
   `operation: prepareTransfer` records structurally identical to a successful prepare — the rejection is
   visible only in the error payload of the following egress record.

## How to ask it

**Context.** All of the above is reproduced on a local `v17.2.0` instance and confirmed by reading the
deployed components' own source, not inferred from behaviour alone. Points 1–3 matter for interop and
for debuggability; points 4–5 matter directly for what we can and cannot rely on when mapping
`topic-event-audit` records on the FRMS side. Since the real DRPP environment runs ISO 20022 in
production and its captured transactions settle successfully (`TxSts: COMM`, no error records, per
`DRPP_Kafka_E2E_Pack`), point 1 in particular may simply never fire there if every participant is
uniformly ISO 20022 — which is worth confirming rather than assuming.

**Question.** "While validating our broker config against a local Mojaloop `v17.2.0` instance we found a
few things in `quoting-service` and `central-ledger` we'd like to check against your environment.

(1) `quoting-service` doesn't translate media types when forwarding — it relays the caller's own
`accept`/`content-type` onward, so a plain-FSPIOP participant's quote reaches an ISO 20022 participant in
the wrong form and is rejected. Are *all* DFSPs in DRPP prod/UAT uniformly ISO 20022, or do you have any
mixed-mode participants where this hop could bite?

(2) When that rejection comes back, `quoting-service` replaces the destination's real FSPIOP error with a
generic `1001` 'Network error' (`src/lib/http.js`). Similarly, an ILP fulfilment mismatch is reported as
`3100` rather than `5104`, even though `central-ledger`'s own logs name the real cause. Have you hit
either of these while debugging, and do you have a patched build, or do you rely on server-side logs for
this?

(3) `quoting-service` appears not to enforce quote/FX-quote expiry at all — we could get both an expired
request and a late response accepted. Does DRPP see the same? We're asking because it means **no expired-
quote event ever appears on `topic-event-audit`**, and we want to be sure any expiry monitoring we build
keys off the transfer leg (`timeoutReserved` / `3303`) rather than the quoting leg.

(4) For the FRMS mapping specifically: FX-quote *error* records on `topic-event-audit` carry no
`operation` tag and no conversion/transaction identifiers, so they can only be correlated by parsing the
`httpUrl`. And a rejected transfer prepare is tagged identically to a successful one. Is that what you
see in DRPP too, and is `httpUrl` parsing what you'd recommend, or is there a field we've missed?

(5) What exact `quoting-service` / chart version does DRPP prod/UAT run — the same base as public
`mojaloop/helm` `v17.2.0`, or a fork with fixes applied? And if these are genuinely unpatched upstream,
should we raise them with the Mojaloop project ourselves, or do you have a channel where such fixes get
tracked?"

**Supporting evidence available on request**: eight captured `topic-event-audit` scenarios (abort,
timeout, ILP mismatch, NDC breach, insufficient liquidity, both expiry variants, plus a committed
baseline), in the same layout as `DRPP_Kafka_E2E_Pack`, at
`docs/deployment/topic-event-audit-edge-case-captures/`.

---

## Open question for the Mojaloop Foundation — 2026-09-21 (is MLA's own JWS validation redundant?)

Not part of the 2026-09-09 meeting or the 09-10 thread above — raised separately, by Mutale to Michael
(Mojaloop Foundation) directly, tracked in full in `plan.md` §14 item 10 and §16's [2026-09-21] "Michael's
reply" entry.

**Context.** Paysys wants to validate the JWS signature on every transaction message it receives on the
Kafka audit topic. Because DRPP is more than one switch (a regional hub plus eNIIPs per region, each
potentially its own MCM), obtaining every JWS public key — DFSP, region, eNIIP and FXP — is a real,
unresolved problem (tracked as Q1 above / `plan.md` §13.1's DFSP-keys row). In the meantime Paysys is
willing to turn signature validation off — but first needs confirmation that the hub is the **only**
ingress/egress into the system, since we had already separately confirmed to Paysys that DRPP validates
every message, making an invalid signature reaching the topic already believed to be effectively nil.

**Question, as asked.** Whether the hub is the only ingress or way to get messages in and out of the
system, so that Paysys can safely turn off JWS signature validation for now.

**Michael's reply, verbatim:** "Nothing will get on to the Kafka topic unless it has already been
validated by the switch, and the Kafka topic is in the same system boundary as the validation process. I'm
not sure what would be gained by PaySys performing another validation. What kind of use case are they
planning to guard against?"

**What this answers, and what it doesn't.** The trust-boundary premise — hub-only ingress, audit topic
inside the same boundary as the switch's own validation — is now confirmed directly rather than assumed,
and in production MLA's own consumer process sits inside that same boundary, not a separate one. It does
not itself authorize turning validation off: Michael's reply asks a fair question back rather than granting
the request, and the answer to *that* question has not yet been sent. The one candidate use case still
worth sending back, if we want to pursue this further, is narrower than a same-boundary argument: JWS
validation is tamper-evidence for the specific switch-to-Kafka hop, distinct from the DFSP-to-switch
validation Michael's answer addresses, and would catch corruption or truncation on that hop that
trust-boundary confirmation alone does not rule out. Whether to send this is not yet decided.

**Standing position, unchanged by this reply.** `george-reply-2026-09-15.md` item 2's original proposal to
disable MLA's own JWS validation permanently remains **not accepted as a permanent change**
(`MLA-deployment-kubernetes.md` §6) — `engineering-rules.md` treats DFSP signature verification as
non-negotiable, and F-04 of the QA workstream specifically hardened it. `JWS_VALIDATION_DISABLED` stays a
scoped, reversible, loudly-observable testing-only bypass, default off — this reply does not change that.

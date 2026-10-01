<!-- SPDX-License-Identifier: Apache-2.0 -->

# Omitting the quote stage — pacs-only ingestion with `QUOTING=false`

**Question.** If the PPA maps and emits only `pacs.008` / `pacs.002`, never `pain.001` / `pain.013`, and the Tazama deployment runs `QUOTING=false` — what is lost?

**Verdict.** **Nothing at the rule level, and three fields at the data level** — one of which is recoverable for free (§8.4). `QUOTING=false` is not a tolerable compromise for pacs-only ingestion; it is the *required* setting. The one permanent loss is behavioural: quotes that never become transfers become invisible.

Read §8 first if the concern is *Mojaloop-side data going missing* — it walks every quote-stage datum on the wire and names where each one lands.

Sources: `tms-service @ f18317f1` (`logic.service.ts`, `router.ts`, `src/schemas/*.json`), `rule-collection` (39 rules), `frms-coe-lib @ ee348d3a`, `docs/Sample flow E2E/`.

---

## 1. No rule in the collection evaluates at the quote stage

Every rule that inspects the incoming message reads `FIToFIPmtSts` — the pacs.002 root. Type guards, counted across all 39 rules:

| Guard | Rules |
|---|---|
| `isPacs002Transaction` | 26 |
| `isPacs008Transaction` | 0 |
| `isPain001Transaction` / `isPain013Transaction` | **0** |
| No guard, but reads `FIToFIPmtSts` | 9 |
| Reads only `DataCache` | 2 (086, 091) |
| Legacy, unrunnable (§5) | 1 (000) |

**The quote stage triggers no rule evaluation today.** Feeding pain.001/pain.013 into this deployment would store two extra rows per transaction and change no outcome.

## 2. Only one rule touches the `pain001` table, and it has a working fallback

`rule-078` (purpose-code case match) is the sole consumer, and it branches explicitly:

```ts
// rule-078.ts:31
if (!(process.env.QUOTING === 'true')) {
  //  FROM pacs008 → CdtTrfTxInf.Purp.Cd
} else {
  //  FROM pain001 → CdtTrfTxInf.PmtTpInf.CtgyPurp.Prtry
}
```

`Purp.Cd` is a **required** field on the pacs.008 schema and the mapping already populates it (`MP2P` on the golden path). Nothing else in the collection queries `pain001`; **nothing at all queries `pain013`.**

## 3. The DataCache and the graph are unaffected

- `handlePain001` / `handlePain013` populate **only** `cdtrId`, `dbtrId`, `cdtrAcctId`, `dbtrAcctId`, and **never persist a DataCache**. All amounts (`instdAmt`, `intrBkSttlmAmt`, `xchgRate`, `creDtTm`) come from `handlePacs008`, which is also the only writer to Redis. `handlePacs002` reads that key or calls `rebuildCache()`, which re-reads the stored **pacs.008**.
- `logic.service.ts:354` — with `QUOTING=false`, `handlePacs008` creates the `entities` nodes and `account_holder` edges itself. `rule-083` and `rule-084` (accounts-per-entity) therefore keep working.

The inverse is the failure case: **`QUOTING=true` without a pain.001 producer** leaves `entities` and `account_holder` permanently empty, because pacs.008 stops writing them and nothing takes over.

## 4. Data elements with no home in the pacs.008 schema

Set difference over the live ajv schemas — element names present in pain.001/pain.013 and absent from pacs.008, with their current consumers:

| Element | Consequence | Consumers today |
|---|---|---|
| `Dbtr`/`Cdtr` `FrstNm` · `MddlNm` · `LastNm` | pacs.008 has a single `Nm` string. **D10** joins the components into it, so the name survives; the structured split does not | rule-000 only (legacy) |
| `MrchntClssfctnCd` | MCC has no pacs.008 field at all | none |
| `SplmtryData…InitgPty.InitrTp` | Partially preserved — the mapping folds `initiatorType` into `Purp.Cd` via the scenario table (**D8**) | none |
| `PyeeRcvAmt` · `PyeeFinSvcsPrvdrFee` · `PyeeFinSvcsPrvdrComssn` | pacs.008 `ChrgsInf` is a **single object**, already carrying `payeeFspFee`. One of the three fits; the net receive amount and the commission do not | none |
| `PmtInfId` (= `quoteId`) | The quote identifier stops reaching Tazama. A lineage/investigation loss, not a rule input | none |
| `XpryDt` · `ReqdExctnDt` · `PmtMtd` · `ReqdAdvcTp` | ISO scaffolding, constant-valued in the mapping | none |
| `EqvtAmt` · `CcyOfTrf` · `XchgRateInf` | pacs.008 expresses identical economics as `InstdAmt` + `IntrBkSttlmAmt` + `XchgRate` | none |

Everything else the quote stage carries is **also on pacs.008 and already mapped**: payer DOB and place of birth, mobile number, `Glctn`, `RgltryRptg`, `RmtInf.Ustrd`, `ChrgBr`, `Dbtr.Nm` / `Cdtr.Nm`, payee FSP fee via `ChrgsInf`.

Worth noting against gap **G3**: `rule-075` (geo-velocity) reads `Glctn` from **`pacs008`**, not `pain001`. The geolocation defaulting decision is a pacs.008 problem and is not affected either way by the quote stage.

## 5. `rule-000` is not a counter-example

Sanctions/blocklist screening is the only rule that reads the pain.001 name components, and it requires **both** messages to be present:

```ts
if (dbAllPacs008Transactions && …[0][0] && dbAllPain001Transactions && …[0][0]) { … }
```

Without a pain.001 it skips the block entirely and falls through to its insufficient-history band. But `rule-000` is `v1.0.0`, carries no `frms-coe-lib` dependency, uses the retired `dbService`/`networkMap` shape, and addresses the pacs.008 root as **`FIToFICstmrCdt`** — an element that does not exist in the current schema (`FIToFICstmrCdtTrf`). It cannot run against current TMS output regardless of `QUOTING`.

Its *design* is still the useful signal: name screening wants structured name components. If sanctions screening is rebuilt, the joined `Dbtr.Nm` is the only key available — and the payee-name gap (Gap 2, `07_open-gaps-…`) bites harder, since `Cdtr.Nm` becomes the sole creditor identity on any ingested message.

## 6. The one real loss: unconsummated quotes

A quote that never becomes a transfer — abandoned by the payer, expired, declined, or issued purely to probe — produces **no pacs.008 and no pacs.002**. Under pacs-only ingestion that event is not degraded; it never reaches Tazama at all.

This forecloses a class of typology outright: quote fishing, beneficiary enumeration, FX rate shopping, quote-to-transfer conversion ratios, repeated failed quotes against one payee. **No mapping fidelity recovers it** — the signal is the absence of the downstream message.

Nothing in the current rule collection implements any of these, so the loss is prospective, not present.

**Secondary, and currently worth nothing:** the quote arrives ~4 s before the transfer prepare on the golden path (13:14:06 vs 13:14:10). Since no rule fires at the quote stage (§1), that earlier interdiction window buys nothing today. **D3** (emit pacs.008 on PREPARE) already preserves the ~1 s pre-settlement window, which is where the rules actually run.

## 7. Deployment risk to close

`rule-078` reads `process.env.QUOTING` **on the rule-executer**, independently of the TMS configuration. If the two disagree — rule-executer sees `true`, TMS sees `false` — rule-078 queries an empty `pain001` table and dereferences `result.rows[0].CtgyPurpPrtry` on `undefined`. **The flag must be set identically on the TMS and rule-executer deployments.**

---

## 8. The Mojaloop side — every quote-stage datum and where it lands

§4 asked what the *Tazama schemas* can hold. This asks the prior question: what does **Mojaloop actually put on the wire** before the transfer, and does each item have a pacs.008 home. Traced against `docs/Sample flow E2E/` msgs 03, 06, 07, 10, 11 and the decoded ILP packet on msg 16.

The premise that makes most of this work is **insight #15**: a pacs.008 is not a translation of one Mojaloop message. It is enriched from five. Quote-stage data reaching Tazama does not require a quote-stage *message* — only a quote-stage *field* on pacs.008.

### 8.1 Already carried — no pain message needed

| Mojaloop datum | Msg | pacs.008 destination |
|---|---|---|
| `payer.personalInfo.dateOfBirth` `1984-01-01` | 10 | `Dbtr.Id.PrvtId.DtAndPlcOfBirth.BirthDt` |
| `payer.name` `Display-Test` | 10 | `DbtrAcct.Nm` (**D10**) |
| `payer.personalInfo.complexName` | 10 | `Dbtr.Nm`, joined (**D10**) |
| ~~`party.name` `Chikondi Banda`~~ | ~~03~~ | `Cdtr.Nm` ← **payee MSISDN** — msg 03 is not Kafka-sourced (FSD §6.4.4, §11) |
| `note` `test` | 10 | `RmtInf.Ustrd` |
| `transactionType.scenario` + `initiatorType` | 10 | `Purp.Cd` = `MP2P` |
| `sourceAmount` MWK 60 | 06 | `InstdAmt` |
| `targetAmount` ZMW 1 / `transferAmount` | 07 / 11 | `IntrBkSttlmAmt` |
| implied rate 60 | 06+07 | `XchgRate` |
| `payeeFspFee` ZMW 0 | 11 | `ChrgsInf.Amt` |
| charging agent `test-zmw-dfsp` | 11 | `ChrgsInf.Agt…MmbId` |
| `ChrgBr` `CRED` | 11 | `ChrgBr` |
| `SttlmInf.SttlmMtd` `CLRG` | 11 | `GrpHdr.SttlmInf.SttlmMtd` |
| `expiration` | 16 | `SplmtryData.Envlp.Doc.Xprtn` |
| both parties' ids, types, fspIds | 10/11/16 + ILP | `Dbtr`/`Cdtr`/`DbtrAcct`/`CdtrAcct`/`DbtrAgt`/`CdtrAgt` |

The quote stage's substantive content — who, how much, at what rate, on what terms, for what purpose, with what fee — is **already on the pacs.008 the PPA emits today**.

### 8.2 Genuinely lost — three items

| # | Mojaloop datum | Golden-path value | Why it is lost |
|---|---|---|---|
| **M1** | `payee.merchantClassificationCode` | `123` | Populated on msgs 01/04/08/10/12/18. **No pacs.008 element exists.** Only `pain.001 SplmtryData…Doc.Cdtr.MrchntClssfctnCd` can hold an MCC |
| **M2** | `quoteId` | `01K7EV9X2K4F8J90ZWMRHDNCZN` | Under **D2** `EndToEndId` = `transactionId` and `PmtId.InstrId` = `transferId`. On pain.001/013 the quoteId lives in `PmtInf.PmtInfId`, which pacs.008 does not have — **but see 8.4** |
| **M3** | `payeeFspCommission` | *absent from this capture* | `ChrgsInf` is a **single object**, already holding `payeeFspFee`. A non-zero commission would have nowhere to go, and `payeeReceiveAmount` would stop being derivable as `transferAmount − fee`. Only pain.013 has separate `PyeeFinSvcsPrvdrFee` / `PyeeFinSvcsPrvdrComssn` slots |

M3 is latent, not observed — this corridor charges `payeeFspFee` only. It becomes real the first time a scheme applies a commission.

**Degraded, not lost:** `complexName.firstName/middleName/lastName` collapse into a single `Dbtr.Nm`. The name survives; the structured split does not (§4, §5).

### 8.3 Lost either way — not arguments for building pain messages

None of these has a field on **any** of the four Tazama schemas, so constructing pain.001/pain.013 would not rescue them:

- `partyIdInfo.extensionList` `Rpt.Vrfctn: True` (msg 03) — the payee name-verification flag. The `VrfctnOfTerms` shape FSD v1.1 proposed is silently stripped (**insight #2**).
- `party.supportedCurrencies` `["ZMW"]` (msg 03)
- `amountType` `SEND` — the send/receive semantic, present on msgs 06/07/10/14
- `conversionRequestId`, `conversionId`, `determiningTransferId` — the FX-leg correlation triple
- the FXP identity `test-fxp` — excluded by **D1** as a design decision, not an accident
- `transactionType.initiator` `PAYER` — `Purp.Cd` encodes `scenario` × `initiatorType`; the payer/payee dimension is dropped, and pain.001's `InitrTp` carries `initiatorType` too, not `initiator`
- `homeTransactionId` (msg 01) — SDK-outbound layer, below the FSPIOP wire

### 8.4 M2 is recoverable at zero cost — recommendation

On this flow `transactionId` and `transferId` are **the same ULID** (`01K7EV9TNQ1VKX84N0GSQH6MDD`). `EndToEndId` therefore already carries it, and `PmtId.InstrId` under **D2** is a duplicate of `EndToEndId` — it identifies nothing that `EndToEndId` does not.

The decoded ILP packet on msg 16 carries `quoteId` directly, so the value is in hand at pacs.008 emit time with no extra correlation:

```json
{"quoteId":"01K7EV9X2K4F8J90ZWMRHDNCZN","transactionId":"01K7EV9TNQ1VKX84N0GSQH6MDD", …}
```

**Proposal: set `PmtId.InstrId` = `quoteId`.** It closes M2, costs nothing, and loses nothing, since `InstrId` currently duplicates `EndToEndId`. Two caveats before adopting: no rule reads `InstrId` today, so the benefit is lineage and investigation rather than detection; and the identity `transactionId == transferId` holds on this capture and should be confirmed against a second flow — if a scheme ever lets them diverge, `InstrId` is needed for `transferId` again.

M1 has no such escape. An MCC is only expressible on pain.001, and the pacs.008 schema would have to change to carry it.

---

## 9. The enrichment mechanism

§8 rests on the claim that a pacs.008 is assembled from five Mojaloop events. This is how.

### 9.1 Shape: a keyed accumulator, not a message join

Every consumed event is classified **trigger** or **enrichment** (FSD §6.4.1). Enrichment events merge into a per-transaction state record and stop. Trigger events read the accumulated record, assemble the outbound message from it plus their own content, and POST it. The store is the PPA's ValKey correlation cache (FSD §4.5) — distinct from Tazama's internal Redis.

There is no request/callback pairing. Pairing holds for the quote stage and breaks for the transfer stage (**insight #15**), which is why the accumulator is keyed on the transaction rather than on message pairs.

### 9.2 Already built, in reduced form

`ppa-prototype/` implements this for one enrichment source:

| Concern | Implementation |
|---|---|
| Cache | `src/store/quoteStore.js` — `Map` with TTL + FIFO cap; `stats()` exposed on `/health` |
| Write | `enrichment.recordQuote(env)` on `topic-quotes-post` → `store.put(transactionId, partyData)` |
| Read | `enrichment.lookupForTransfer(env)` on `topic-transfer-prepare` / `-fulfil` |
| Merge | `mergeParty()` — field-level precedence, quote-cache wins, the transfer's own `extensionList` fills gaps |
| Lifecycle | `get()`, **not** `take()` — prepare and fulfil both consume the one cached record (FSD §6.3 step 9) |
| Degradation | Cache miss → placeholder party data, `enriched: false` on the result; never throws |

The design is right; the coverage is one source of four.

### 9.3 The join key has three tiers

Verified across all 18 messages of the golden path.

| Tier | Key | Messages | Note |
|---|---|---|---|
| **1 — body** | `transactionId` / `transferId` / `determiningTransferId` | 06, 07, 10, 16 | One value throughout: `01K7EV9TNQ1VKX84N0GSQH6MDD` |
| **2 — URI** | `fspiop-uri` path segment | **11, 15, 17** | These carry **no transaction identifier in the body at all** |
| **3 — trace** | W3C `traceparent` trace-id | **02, 03** | `/parties` carries neither a body id nor a URI id |

**Tier 2 is a trap.** `PUT /quotes` (msg 11) has a body of `expiration`, amounts, `ilpPacket`, `condition`, `extensionList` — and nothing that names the transaction. Its only identifier is `fspiop-uri: /quotes/01K7EV9X2K4F8J90ZWMRHDNCZN`. A body-only correlator silently drops it, and msg 11 is the sole source of `payeeFspFee`, `ChrgBr` and `SttlmMtd`. Same for `PUT /fxTransfers` and the transfer fulfil.

**Tier 3** is the only thing that links the discovery leg: msgs 02/03 share `_meta.trace_id` `67629f2771f9ca3e58ae98d2b525ff82` with every other message in the flow — **all 18, including the SDK-outbound ones (01/05/09/13)**. This gives Gap 2 a *mechanism* — it does not give it a *source*, since §4.4 lists no `/parties` topic.

One header-level wrinkle, not a flow split: on msgs 01/05/09/13 the literal `headers.traceparent` W3C value carries a different trace-id (`aabbb08505…`) than the FSPIOP-layer `traceparent` (`67629f27…`) — the SDK-outbound REST hop (client → mojaloop-connector SDK) generates its own trace context, upstream of the switch. `_meta.trace_id` is the curated value that ties the whole capture together; it is not itself a wire field. It doesn't matter for the MLA either way: those four messages are the client-facing SDK API, not a Kafka topic in §4.4, so the MLA never sees them regardless of which header value they carry.

### 9.4 The keys survive onto Kafka

Checked against `ppa-prototype/captured/`, which are real Kafka envelopes, not wire captures:

- `content.headers.traceparent` and `content.spanContext.traceId` are both present on the quote and transfer topics.
- `topic-transfer-prepare` and `topic-transfer-fulfil` from one transaction share **both** `traceId` `11bada17781a51c8cebb4e5c67f7369d` and `envelope.id` `01KWV5D7WX1EPQP5GNE0VKYVCF`.
- `metadata.correlationId` is present on the quote and transfer topics.

All three tiers are therefore available to the MLA. This narrows Gap 1 for correlation specifically — it does not close it for field content.

**Caution on the notification topic.** The captured `topic-notification-event` sample is a `settlement-transfer-position-change`, not a transfer final state. It carries `FSPIOP-Source: Hub`, no `traceparent`, no `spanContext`, and no `correlationId`. If the real final-state notification is shaped the same way, `InstgAgt`/`InstdAgt` cannot be derived from it and the fulfil callback remains the pacs.002 trigger. This is the open question in §7 of `continue.md`, still unresolved — a transfer-completion capture is needed (Open Item #12).

### 9.5 Gap between the prototype and §8.1

To carry the field set §8.1 claims, the prototype needs:

1. **Cache `topic-quotes-put`** — `payeeFspFee`, `ChrgBr`, `SttlmMtd`, `transferAmount`, charging agent. Currently not cached; the comment in `consumer.js` states the PUT leg "does not add party data", which is true and beside the point once economics are in scope.
2. **Cache `topic-fx-quotes-post` / `-put`** — `sourceAmount` MWK 60, `targetAmount` ZMW 1, and the derived `XchgRate`. Without these the pacs.008 has no `InstdAmt` and no rate.
3. **Parse `fspiop-uri`** for tier-2 keys, or key off `envelope.id`.
4. **Move the `Map` to ValKey**, keyed `ppa:txn:{transactionId}`, TTL per §9.3 of the FSD, `volatile-lru`.
5. **Dedup the notification topic** (FSD §6.3 step 3).

None of these needs a pain message. They are the same accumulator with three more writers.

---

## 10. Flagged: a larger loss, independent of this question

Surfaced while surveying the rule collection, and it outweighs everything above.

**24 of 39 rules treat `ACCC` as the successful status.** 17 of them short-circuit the incoming pacs.002 directly:

```ts
if (req.transaction.FIToFIPmtSts.TxInfAndSts.TxSts !== 'ACCC') { return unsuccessfulTransaction; }
```

and the history queries filter `AND TxSts = 'ACCC'`.

**D4** maps `COMMITTED` → **`ACSC`**, on the ISO-correct reasoning that `ACCC` asserts funds reached the creditor's account. That reasoning is sound about ISO 20022 and wrong about this deployment: emitting `ACSC` makes every one of those rules exit on the current transaction *and* read an empty behavioural history, because no stored row ever carries `ACCC`.

This needs a decision — emit `ACCC` and accept the semantic overreach, or reconfigure the rule collection — before either mapping ships. It is unaffected by `QUOTING`.

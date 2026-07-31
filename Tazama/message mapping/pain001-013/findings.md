# pain.001 / pain.013 — findings

Covers §6.5 **rows 1, 2 and 5** (the quote, FX-quote and fxTransfer mappings), which were out of scope of the pacs.008/pacs.002 revision and remain unverified.

Status: **analysis only — no mapping work started.** Everything below is verified against source; nothing here has been implemented.

Companion work: [`../pacs 002-008/`](../pacs%20002-008/) — the completed pacs.008 / pacs.002 mapping.

---

## 1. Rows 1, 2 and 5 are broken at the premise, not the field level

Tazama's TMS exposes exactly **four** ingestion endpoints, and `tms-service/src/schemas/` contains exactly four schema files:

```
pain.001.json    pain.013.json    pacs.008.json    pacs.002.json
```

Every output named by rows 1, 2 and 5 is therefore unroutable:

| Row | Current output | Reality |
|---|---|---|
| 1 | `pacs.081 + pacs.082` | Not ISO 20022 message types at all — placeholders for Mojaloop `/quotes` |
| 2 | `pacs.091 + pacs.092` | Same — placeholders for `/fxQuotes` |
| 5 | `pacs.009` | A real ISO type, but **Tazama has no pacs.009 endpoint** |

This is not a field-path error that a careful mapping fixes. The rows promise outputs Tazama cannot accept.

Tazama's own doctrine (`iso20022-and-tazama.md`): *"In Mojaloop, the QUOTES messages are translated to pain.001 (POST) and pain.013 (PUT) and the TRANSFER messages are translated to pacs.008 (POST) and pacs.002 (PUT)."*

## 2. The reframe — mostly a consequence of D1, already signed off

| Row | Becomes |
|---|---|
| **1** | **Split into two rows.** `POST /quotes` → **pain.001.001.11**; `PUT /quotes` → **pain.013.001.09** |
| **2** | **Deleted as an output row.** fxQuotes emit nothing; they are an **enrichment source** supplying the source amount and exchange rate to rows 1 and 3 |
| **5** | **Deleted.** Identical reasoning to row 6, already removed: under D1 the FX leg is not a separate Tazama transaction — and no pacs.009 endpoint exists regardless |

Rows 2 and 5 need no new analysis; D1 (one transaction per payment) already decided them, and §8.1 already documents that fxTransfers contribute no fields. Only row 1 requires real mapping work.

---

## 3. What `tms-service/src/logic.service.ts` actually does

Read directly from source. This is the part that changed our understanding most.

### 3.1 pain.001 and pain.013 populate only four DataCache fields

```js
// handlePain001 (lines 173-178) — and handlePain013 is identical in shape
const dataCache: DataCache = { cdtrId, dbtrId, cdtrAcctId, dbtrAcctId };
```

No `instdAmt`, no `intrBkSttlmAmt`, no `xchgRate`, no `creDtTm`.

### 3.2 pacs.008 is the sole source of the DataCache amounts — and the only writer to Redis

`handlePacs008` (lines 327–352) builds the **full** DataCache including `instdAmt`, `intrBkSttlmAmt` and `xchgRate`, then writes it to Redis under `${TenantId}:${EndToEndId}`. `handlePacs002` reads that key and, on a miss, calls `rebuildCache()` — which fetches the stored **pacs.008** and rebuilds from it (lines 81–108).

**The pain handlers never persist a DataCache at all.** They attach it to the outgoing message to the event-director and nothing more.

> **Correction to an earlier assumption.** We had reasoned that Tazama builds the DataCache from the *first* message in the chain, so a pain.001 carrying the post-conversion amount (ZMW 1) would set `instdAmt` for the whole transaction and the pacs.008's MWK 60 would arrive too late to correct it — making rows 1 and 2 hard-coupled. **That is wrong.** The DataCache amounts come from pacs.008 or from nowhere. There is nothing for pain.001 to poison, and rows 1 and 2 are not coupled in that way.

### 3.3 What survives: a weaker consistency question

pain.001's `InstdAmt` does flow into `TransactionDetails.Amt` / `.Ccy` (lines 135–136, 162–163), which is saved per message via `saveTransactionDetails`. So a pain.001 reporting **ZMW 1** alongside a pacs.008 reporting **MWK 60** would leave inconsistent amounts across the transaction history for a single `EndToEndId`.

**Resolved by the schema — see Q1.** pain.001 requires **both** `InstdAmt` and `EqvtAmt`, and `EqvtAmt` carries `CcyOfTrf` and `XchgRateInf.XchgRate`. Setting `InstdAmt` = MWK 60 on both pain.001 and pacs.008 makes `TransactionDetails.Amt` consistent by construction, while `EqvtAmt` still records the ZMW 1 the quote was priced in. No trade-off is required.

Note that **pain.013's `EqvtAmt` has no `XchgRateInf`** (only `Amt` and `CcyOfTrf`), so the exchange rate can be carried on the pain.001 but not on its response.

### 3.4 `configuration.QUOTING` decides who creates entities

```js
// handlePacs008, line 354
if (!configuration.QUOTING) {
  addEntity(cdtrId); addEntity(dbtrId);
  await ...;
  addAccountHolder(cdtrId, cdtrAcctId); addAccountHolder(dbtrId, dbtrAcctId);
} else {
  await Promise.all(pendingPromises);   // no entities, no account holders
}
```

pacs.008 creates `entities` nodes and `account_holder` edges **only when `QUOTING` is false**. When true it assumes pain.001 already did so — which pain.001 does (lines 188–195).

Since we currently emit only pacs.008/pacs.002: with `QUOTING=true` and no pain.001, the `entities` collection and `account_holder` edges are **never populated**. Accounts still get created; entities do not, and entity-based rules have nothing to work with.

**For the POC this is a knob, not a risk** — set `QUOTING=false` and pacs.008 is self-sufficient. `false` is the shipped default (`.env.template:16`, `API_SPEC.md:572`).

**But `QUOTING` is a single coupled switch, and that is the important part.** It gates two things at once:

- `router.ts:19` — with `QUOTING=false` the pain.001/013 routes are **not registered at all**; calling them returns 404 (`API_SPEC.md:500`).
- `logic.service.ts:354` — with `QUOTING=true` pacs.008 **stops** creating entities and account-holder edges.

So there is no intermediate state. Flipping it to `true` to enable the quote stage simultaneously moves entity creation to a pain.001 that will not exist until row 1 is built. **Row 1 must therefore land before or together with that flip, never after.**

### 3.5 Identifier construction, pinned exactly

```js
dbtrId     = Othr[0].Id + Othr[0].SchmeNm.Prtry                  // "16665551002MSISDN"
dbtrAcctId = Othr[0].Id + Othr[0].SchmeNm.Prtry + Agt…MmbId      // "16665551002MSISDNtest-mwk-dfsp"
```

Same construction in `parseDataCache` (pacs.008), `handlePain001` and `handlePain013`. Two things follow:

- It **retroactively validates the pacs.008 mapping** — the exact three fields we mapped (`Othr[0].Id`, `SchmeNm.Prtry`, `ClrSysMmbId.MmbId`) are the ones that become graph keys.
- It reads **`Othr[0]`**, the first array element, confirming the array-vs-object question we resolved was load-bearing rather than cosmetic.

For pain.001/013 the same construction must produce **byte-identical** ids to the pacs.008, or the quote and transfer messages resolve to different entities and accounts for the same transaction.

### 3.6 Geolocation is read unconditionally — sharpens gap G3

```js
// handlePain001, lines 155-156
const lat  = transaction.CstmrCdtTrfInitn.SplmtryData.Envlp.Doc.InitgPty.Glctn.Lat;
const long = ...Glctn.Long;
```

Read straight into `TransactionDetails.lat/long`. Our `"0"` / `"0"` default would not read as *missing* — it lands as a real coordinate in the Gulf of Guinea, which is worse than null for any geo rule. If pain.001 is implemented, the defaulting policy for `Glctn` needs revisiting.

### 3.7 pain.013 reverses source and destination

```js
// handlePain013, lines 243-244
source: creditorAcctId,
destination: debtorAcctId,
```

The opposite of pain.001 and pacs.008. Presumably deliberate — pain.013 is a *creditor-initiated* payment activation request — but it must be understood before mapping, since it determines the direction of the resulting `transactionRelationship` edge.

---

## 4. Plan for row 1 (pain.001 / pain.013)

Same method that worked for pacs.008/pacs.002; the harness already exists.

1. **Ground truth** — extract required fields, type divergences and the `TenantId` prohibition from `src/schemas/pain.001.json` and `pain.013.json`; cross-check the `Pain.001.001.11.ts` / `Pain.013.001.09.ts` interfaces.
2. **Validate Tazama's own fixtures** (`frms-coe-lib/src/tests/data/pain001.ts`, `pain013.ts`) against the real schemas — the pacs.008 fixture failed the stale swagger, so this is worth repeating.
3. **Map field by field** from msg 10 (`POST /quotes`) → pain.001 and msg 11 (`PUT /quotes`) → pain.013, enriched from msg 03 (payee name) and msgs 06/07 (FX amounts, if §3.3 is decided that way).
4. **Reuse the identifier strategy** — D2 already anticipated it: `EndToEndId` = `transactionId` (constant across all four messages), `InstrId` = `quoteId` for the quote pair. Verify `PmtId` nesting: pain.001 places it under `PmtInf.CdtTrfTxInf.PmtId`, not at the same depth as pacs.008.
5. **Build and validate** golden-path samples with `samples/ajv-check.js`, extended by two lines.
6. **Patch §6.5** rows 1/2/5 and append the two resulting payloads to §7 — cheap, since §7 already reproduces both `/quotes` bodies.

Effort is comparable to the pacs.008/pacs.002 work — slightly larger schemas, but a known method and an existing harness.

---

## 5. Open questions

Suggestions are research-based; each cites the source it rests on. Q1–Q4 are effectively answered and need confirmation rather than investigation. Q5 and Q6 need input we cannot get from source.

| # | Question | Why it matters | Suggested answer (research-based) |
|---|---|---|---|
| **Q1** | Should pain.001 carry the FX-adjusted amount (MWK 60) or the quote's face amount (ZMW 1)? | §3.3 — transaction-history consistency across the chain | **Both — the question is a false choice.** pain.001's `Amt` **requires both** `InstdAmt` *and* `EqvtAmt`, and `EqvtAmt` carries `CcyOfTrf` plus `XchgRateInf.XchgRate` (`schemas/pain.001.json`). So `InstdAmt` = MWK 60, `EqvtAmt.Amt` = ZMW 1, `CcyOfTrf` = ZMW, `XchgRateInf.XchgRate` = 60. This also settles the consistency concern: `handlePain001` and `handlePacs008` both read `InstdAmt` into `TransactionDetails.Amt`, so MWK 60 in both makes the history consistent by construction. ⚠️ **pain.013's `EqvtAmt` has no `XchgRateInf`** — only `Amt` + `CcyOfTrf` — so the rate can be expressed on the pain.001 only |
| **Q2** | `pain.001.001.11` or `.13`? | Wrong version = wrong endpoint | **`.11`.** `router.ts` registers `/v1/evaluate/iso20022/pain.001.001.11`, and the auth claim is `POST_V1_EVALUATE_ISO20022_PAIN_001_001_11`. The `.13` in the TMS API doc is a typo — the same doc also writes `/tv1/` in the pacs.008 path. Treat the router as authoritative, not the doc |
| **Q3** | Does pain.013's reversed source/destination change how we map `Dbtr`/`Cdtr`? | §3.7 — graph edge direction | **No — do not swap.** ISO pain.013 is a *CreditorPaymentActivationRequest*, initiated by the creditor, so Tazama's `source: creditorAcctId` reflects **message** direction, not money direction — and Mojaloop's `PUT /quotes` likewise flows payee → payer. Keep `Dbtr` = payer and `Cdtr` = payee exactly as in pain.001/pacs.008; `handlePain013` derives source/destination itself from those account fields. Swapping them would double-invert the edge |
| **Q4** | What happens in schemes that skip quoting entirely? | Row 1 needs a "not always present" caveat that rows 3/4 do not | **It is not a per-transaction condition — it is the `QUOTING` deployment mode.** With `QUOTING=false` the pain.001/013 routes are **not registered at all** (`router.ts:19`) and return 404 (`API_SPEC.md:500`). So there is nothing to detect per transaction: row 1 exists only when `QUOTING=true`, and the PPA should be configured to match its target deployment |
| **Q5** | Is `QUOTING` false in the POC deployment? | §3.4 — decides whether row 1 is cosmetic or a functional prerequisite | **Almost certainly yes — `false` is the shipped default** (`.env.template:16`, `API_SPEC.md:572`). Worth confirming with whoever deployed it. **Key consequence: `QUOTING` is a single coupled switch.** Flipping it to `true` simultaneously registers the pain routes *and* stops pacs.008 creating entities and account-holder edges. So row 1 must be implemented **before or together with** that flip, never after — otherwise entity resolution breaks the moment quoting is enabled |
| **Q6** | Do `/fxQuotes` always complete before `POST /quotes`? | Ordering determines whether pain.001 can carry the FX amounts at all | **Structurally guaranteed for SEND / source-currency; unverified otherwise.** In the source-currency case the payer DFSP cannot price the target-currency leg until the FXP returns the converted amount, so the FX quote *must* precede the quote — the observed ~680 ms gap is a consequence, not a coincidence. For RECEIVE / target-currency-specified flows the target amount is known up front and the order may invert. **Do not assume — request a RECEIVE-amount capture from CCH before implementing Q1's mapping** |

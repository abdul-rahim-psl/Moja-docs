# Worked example — one cross-border payment, end to end

DRPP Golden Path `DRPP-GP-01`, trace `67629f2771f9ca3e58ae98d2b525ff82`.
**MWK 60 → ZMW 1**, `test-mwk-dfsp` → `test-zmw-dfsp` via `test-fxp`, settled in 5.9 s.

Both outputs validate against the real ajv schemas: [`samples/tazama_pacs008.json`](samples/tazama_pacs008.json), [`samples/tazama_pacs002.json`](samples/tazama_pacs002.json).

---

## Timeline

```
13:14:05.807  msg 03  PUT /parties      →  NOT CONSUMED — ALS never publishes to Kafka
13:14:06.497  msg 06  POST /fxQuotes    →  cache: sourceAmount MWK 60
13:14:07.147  msg 07  PUT /fxQuotes     →  cache: targetAmount ZMW 1   ⇒ XchgRate 60
13:14:07.827  msg 10  POST /quotes      →  cache: payer DOB + complexName, note, txnType
13:14:08.386  msg 11  PUT /quotes       →  cache: ChrgBr CRED, payeeFspFee 0, SttlmMtd CLRG
13:14:10.546  msg 16  POST /transfers   →  ★ EMIT pacs.008   (decode ILP packet + drain cache)
13:14:11.252  msg 17  PUT /transfers    →  ★ EMIT pacs.002   (transferState COMMITTED → ACSC)
```

Cache lifetime ≈ **4.0 s** (msg 06 → msg 16). Well inside any sane TTL. Msg 03 is shown for completeness only — it is on the wire but not on Kafka, so it never enters the cache and `Cdtr.Nm` degrades to the payee MSISDN; see [`01_message-relevance.md`](01_message-relevance.md) and Gap 2 in [`07_open-gaps-wire-vs-kafka-and-discovery.md`](07_open-gaps-wire-vs-kafka-and-discovery.md).

## Where each pacs.008 value came from

```
                                          ┌─ GrpHdr.MsgId          ← PPA-generated ULID (FSD §6.5.4)
                                          ├─ NbOfTxs 1             ← msg 11 ext, "1" → 1
msg 16  POST /transfers  ────────────────►│
  body.transferId         ────────────────┤  PmtId.InstrId
  ilp.transactionId       ────────────────┤  PmtId.EndToEndId
  body.amount ZMW 1       ────────────────┤  IntrBkSttlmAmt   ─┐
  body.payerFsp/payeeFsp  ────────────────┤  DbtrAgt/CdtrAgt   │
  body.expiration         ────────────────┤  SplmtryData.Xprtn │  XchgRate = 60 ÷ 1 = 60
  ext[Cdtr…Othr.Id]       ────────────────┤  Cdtr/CdtrAcct id  │
                                          │                    │
msg 07  PUT /fxQuotes                     │                    │
  sourceAmount MWK 60     ────────────────┤  InstdAmt         ─┘
                                          │
msg 10  POST /quotes                      │
  payer.complexName       ────────────────┤  Dbtr.Nm            (D10: legal name)
  payer.dateOfBirth       ────────────────┤  Dbtr…BirthDt
  payer.name              ────────────────┤  DbtrAcct.Nm        (display name)
  transactionType         ────────────────┤  Purp.Cd = MP2P     (D8: body beats ILP)
  note "test"             ────────────────┤  RmtInf.Ustrd
                                          │
msg 11  PUT /quotes                       │
  ext[ChrgBr] CRED        ────────────────┤  ChrgBr
  payeeFspFee ZMW 0       ────────────────┤  ChrgsInf.Amt
                                          │
msg 03  PUT /parties                      │
  party.name              ────────────────┘  Cdtr.Nm, CdtrAcct.Nm  ← ONLY source

  (no source)             ─────────────────  Cdtr…BirthDt  1900-01-01   ⚠ G1
  (no source)             ─────────────────  RgltryRptg    BOP/100      ⚠ G2
  (no source)             ─────────────────  Glctn         0,0          ⚠ G3
```

## The cross-border signal

The one thing that makes this transaction visibly cross-border to Tazama:

```json
"IntrBkSttlmAmt": { "Amt": { "Amt": 1,  "Ccy": "ZMW" } },
"InstdAmt":       { "Amt": { "Amt": 60, "Ccy": "MWK" } },
"XchgRate": "60"
```

Two different currencies in one transaction, with the rate that connects them. Under a per-leg model (rejected — **D1**) this would have been split across two transactions and the relationship lost.

The FXP `test-fxp` appears **nowhere** in the output. It is FX plumbing, not a party to the customer's payment.

## The pacs.002 join

```json
"OrgnlInstrId":    "01K7EV9TNQ1VKX84N0GSQH6MDD",   // = pacs.008 PmtId.InstrId
"OrgnlEndToEndId": "01K7EV9TNQ1VKX84N0GSQH6MDD",   // = pacs.008 PmtId.EndToEndId
"TxSts": "ACSC",                                    // COMMITTED, translated
"InstgAgt": "test-zmw-dfsp",                        // reversed vs pacs.008
"InstdAgt": "test-mwk-dfsp"
```

If either `Orgnl*` id fails to match, the pacs.002 is orphaned: TMS accepts it, the graph never links it to its pacs.008, and the transaction silently never completes a chain.

## Data actually lost

| Dropped | Why | Mitigation |
|---|---|---|
| `condition`, `fulfilment` | No schema field (**D5**) | PPA audit log |
| `ilpPacket` (as a blob) | Decoded and consumed instead | — |
| `commitRequestId`, `conversionId` | FX leg not a separate transaction (**D1**) | Audit log |
| Payee DOB | Never existed | **G1** — request from CCH |
| Error reason (`errorCode`) | No `StsRsnInf` in schema | **Row 7** — audit log, or change request |

## Reproducing the validation

```bash
node ajv-check.js   # uses tms-service's exact ajv options
# tazama_pacs008.json  vs  pacs.008.json   VALID: true   STRIPPED: (nothing)
# tazama_pacs002.json  vs  pacs.002.json   VALID: true   STRIPPED: (nothing)
```

`removeAdditional: 'all'` means **"stripped: nothing"** is as important as **"valid: true"** — a message can validate while quietly losing every field the schema doesn't know about. Any future change to this mapping must assert both.

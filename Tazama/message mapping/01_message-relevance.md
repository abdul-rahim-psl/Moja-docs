# Which Mojaloop messages we consume, and why

Source: `docs/Sample flow E2E/` — DRPP Golden Path `DRPP-GP-01`, trace `67629f2771f9ca3e58ae98d2b525ff82`.
Scope: producing Tazama **pacs.008** and **pacs.002** only (§6.5 rows 3, 4, 6, 7).

---

## Selection criterion: the PPA can only see the wire

The 18 captured messages sit in two layers:

- **SDK Scheme Adapter outbound API** (`outbound_*`, msgs 01, 04, 05, 08, 09, 12, 13, 18) — the **private** REST API between the payer DFSP's back office and its own SDK. Never leaves the DFSP.
- **FSPIOP / ISO 20022 interoperability API** (`fspiop_*`, msgs 02, 03, 06, 07, 10, 11, 14, 15, 16, 17) — the on-the-wire scheme messages through the DRPP switch.

The MLA subscribes to **Mojaloop central Kafka topics** (FSD §5.2) — switch-side. **The 8 SDK-outbound messages are therefore not available as sources** and are excluded regardless of what they contain.

This costs us `homeTransactionId` (msg 01) and nothing else material: msg 01's payer identity block is re-stated in msg 10, which *is* on the wire.

> ⚠️ **Verify:** this rests on the MLA being switch-side. If the MLA taps a DFSP-side SDK instead, msgs 01/18 become available and `homeTransactionId` becomes usable as an additional correlator. Confirm against the MLA's actual topic list in FSD §5.2.

---

## Relevance matrix

| # | Message | Layer | Used? | What it uniquely contributes |
|---|---|---|---|---|
| 01 | SDK `POST /transfers` | SDK | ✗ | *(not on the wire)* — payer identity, `homeTransactionId` |
| 02 | `GET /parties/MSISDN/…` | FSPIOP | ✗ | Lookup only; no payload |
| **03** | **`PUT /parties` callback** | FSPIOP | **✓** | **Payee name `"Chikondi Banda"` — appears nowhere else in the entire flow**; payee `fspId`, supported currencies |
| 04 | SDK 200 `WAITING_FOR_PARTY_ACCEPTANCE` | SDK | ✗ | State echo |
| 05 | SDK `acceptParty` | SDK | ✗ | Authorization gate |
| **06** | **`POST /fxQuotes`** | FSPIOP | **✓** | `conversionRequestId`, **`sourceAmount` MWK 60**, `determiningTransferId` |
| **07** | **`PUT /fxQuotes` callback** | FSPIOP | **✓** | Agreed **`targetAmount` ZMW 1** → with 06 gives `InstdAmt` + `XchgRate` |
| 08 | SDK 200 `WAITING_FOR_CONVERSION_ACCEPTANCE` | SDK | ✗ | State echo |
| 09 | SDK `acceptConversion` | SDK | ✗ | Authorization gate |
| **10** | **`POST /quotes`** | FSPIOP | **✓** | **Payer `dateOfBirth` 1984-01-01, `complexName`**, `quoteId`, `transactionType`, `note` → `RmtInf` |
| **11** | **`PUT /quotes` callback** | FSPIOP | **✓** | **`ChrgBr: CRED`**, `ChrgsInf.Agt`, `payeeFspFee`, `SttlmMtd: CLRG`, full `originalIso20022QuoteResponse` |
| 12 | SDK 200 `WAITING_FOR_QUOTE_ACCEPTANCE` | SDK | ✗ | State echo |
| 13 | SDK `acceptQuote` | SDK | ✗ | Authorization gate |
| 14 | `POST /fxTransfers` | FSPIOP | ◐ | `commitRequestId`; amounts duplicate 06/07. Not required under **D1** |
| 15 | `PUT /fxTransfers` callback | FSPIOP | ◐ | `conversionState: RESERVED`. Not emitted under **D1** — see below |
| **16** | **`POST /transfers` (PREPARE)** | FSPIOP | **✓ anchor** | **Triggers pacs.008.** `transferId`, `payerFsp`, `payeeFsp`, settled amount, `expiration`, + extensionList + **decoded ILP packet** |
| **17** | **`PUT /transfers` (FULFIL)** | FSPIOP | **✓ anchor** | **Triggers pacs.002.** `transferState`, `completedTimestamp`, `GrpHdr.MsgId`/`CreDtTm`, and `fspiop-source`/`-destination` headers → `InstgAgt`/`InstdAgt` |
| 18 | SDK 200 `COMPLETED` | SDK | ✗ | *(not on the wire)* — accumulated state |

**Consumed: 7 messages** — 03, 06, 07, 10, 11, 16, 17. Two anchors (16, 17); five enrichment sources.
**14/15 are consumed for correlation only**, not as field sources: under **D1** the FX leg is not a separate Tazama transaction, and its amounts are already agreed in 06/07.

---

## The prepare message carries three layers of data

Msg 16 is the pacs.008 anchor. Its content is richer than the FSPIOP body suggests:

**1 — Body:** `transferId`, `payerFsp`, `payeeFsp`, `amount` (ZMW 1), `expiration`, `condition`

**2 — `extensionList`,** already expressed as ISO paths by the switch:
```
CdtTrfTxInf.Cdtr.Id.PrvtId.Othr.SchmeNm.Prtry  = "MSISDN"
CdtTrfTxInf.Cdtr.Id.PrvtId.Othr.Id             = "16665551001"
CdtTrfTxInf.CdtrAgt.FinInstnId.Othr.Id         = "test-zmw-dfsp"
```
Useful corroboration, but **not Tazama's shape** — Mojaloop uses `FinInstnId.Othr.Id`; Tazama requires `FinInstnId.ClrSysMmbId.MmbId`.

**3 — Decoded `ilpPacket`** (base64url → ILP v4 → embedded base64url JSON):
```json
{ "quoteId": "01K7EV9X2K4F8J90ZWMRHDNCZN",
  "transactionId": "01K7EV9TNQ1VKX84N0GSQH6MDD",
  "transactionType": {"scenario":"TRANSFER","initiator":"PAYER","initiatorType":"BUSINESS"},
  "payee": {"partyIdInfo":{"partyIdType":"MSISDN","partyIdentifier":"16665551001","fspId":"test-zmw-dfsp"}},
  "payer": {"partyIdInfo":{"partyIdType":"MSISDN","partyIdentifier":"16665551002","fspId":"test-mwk-dfsp"},
            "name":"Display-Test"},
  "expiration": "2025-10-13T13:15:08.384Z",
  "amount": {"amount":"1","currency":"ZMW"} }
```

So **msg 16 alone** yields both parties' MSISDNs and fspIds, the payer's display name, `transactionType`, and the `quoteId`↔`transactionId` link.

Tazama's `iso20022-and-tazama.md` warns that "the transfers messages do not currently contain any identifying information for either the Payer or the Payee." That holds for a **bare FSPIOP body**, but not for this ISO-profile capture once the extensionList and ILP packet are read.

### Degraded mode

If the quote-stage messages are missing (cache miss, or a scheme that skips quoting), a pacs.008 is **still constructible** from msg 16 alone, losing only:

| Lost | Fallback |
|---|---|
| Payee name (msg 03) | `Cdtr.Nm` ← payee MSISDN |
| Payer DOB, `complexName` (msg 10) | `Nm` ← ILP `payer.name`; `BirthDt` ← sentinel |
| `ChrgBr`, `ChrgsInf` (msg 11) | `ChrgBr: "SLEV"`, zero charge |
| `InstdAmt` source amount (msg 06/07) | `InstdAmt` = `IntrBkSttlmAmt`, `XchgRate` omitted |
| `RmtInf.Ustrd` (msg 10 `note`) | `""` |

Degraded messages must be **flagged in the audit log**, since they are structurally valid and indistinguishable from complete ones at the TMS door.

---

## Correlation keys

| Purpose | Key |
|---|---|
| Cache key, all stages | `transactionId` / `transferId` — `01K7EV9TNQ1VKX84N0GSQH6MDD` |
| Quote → transfer link | `quoteId` in the decoded ILP packet |
| FX leg → transfer link | `determiningTransferId` (msgs 06/07/14) |
| Party lookup → transaction | payee MSISDN `16665551001` ⚠️ |

⚠️ **Msg 03 has no transaction identifier.** The `PUT /parties` callback is keyed only by party id — it precedes the quote, so no `transactionId` exists yet. Correlating it requires keying the party cache on **MSISDN**, not on the transaction, and accepting that concurrent transactions to the same payee share that entry. That is acceptable for a *name* lookup but must not be extended to transaction-scoped data.

This differs from every other correlation in FSD §6.4, which is transaction-keyed. Worth calling out in the correlation design.

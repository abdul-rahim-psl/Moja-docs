# Review: `docs/Sample flow E2E/` against our ingestion process

What the 18 captured messages actually are, how they line up (or don't) with
what `ppa-prototype` ingests today, and which ones are actually useful to us
and why. Read `Sample flow E2E/README.md` first if you haven't — this
doc assumes that context.

## TL;DR

These 18 files are **real production traffic from a live DRPP (COMESA)
deployment**, captured over **HTTP, in native ISO 20022 wire format**, across
a **cross-border FX transfer** (MWK → ZMW via an FX provider). Our PPA
ingests **Kafka**, in **plain FSPIOP JSON**, for a **single-currency P2P
transfer only** (no FX). So this capture is not "more test data for the same
thing" — it's evidence of a materially different environment shape than what
our prototype currently handles, on three separate axes at once:

| Axis | Our PPA today | This capture |
| --- | --- | --- |
| **Transport** | Kafka internal topics | HTTP, on-the-wire FSPIOP/ISO calls |
| **Wire format** | Plain FSPIOP JSON (e.g. `application/vnd.interoperability.quotes+json`) | **Native ISO 20022** (`application/vnd.interoperability.iso20022.quotes+json`) |
| **Flow scope** | Single-currency P2P (quote → transfer) | Cross-border **FX** (party lookup → FX quote → payee quote → FX transfer → transfer) |

None of that makes the capture useless — several files are directly relevant,
just not as "swap in this JSON for testing." Details below.

## What's actually in the folder (two layers, per the README)

1. **SDK Scheme Adapter outbound API** (`outbound_*`, files 01, 04, 05, 08,
   09, 12, 13, 18) — a private, non-FSPIOP REST API between a DFSP's back
   office and its own SDK. This is not a Mojaloop hub protocol at all; it's
   how one specific DFSP's SDK talks to itself. **Not applicable to us** — we
   don't sit at this layer and never will; our PPA taps Kafka topics on the
   hub side (`central-ledger`/`quoting-service`/`ml-api-adapter`), several
   layers downstream of any single DFSP's SDK.
2. **FSPIOP / ISO 20022 interoperability API** (`fspiop_*`, files 02, 03, 06,
   07, 10, 11, 14, 15, 16, 17) — the actual on-the-wire scheme messages
   between DFSPs, the FXP, and the switch. This is the layer that (in FSPIOP
   form) our PPA's Kafka topics ultimately originate from. **This is the
   relevant half of the capture.**

## File-by-file usefulness

| # | File | Useful to us? | Why |
| --- | --- | --- | --- |
| 01 | `outbound_post_transfers_request` | No | SDK-private layer, not a hub message. |
| 02 | `fspiop_parties_get_request` | **Yes — new territory** | `GET /parties/{Type}/{ID}` party lookup/discovery. We don't consume this at all today (no `topic-parties-*` in `src/config.js`'s `TOPICS`). This is the step *before* the quote, and it's where `fspId` first gets resolved for a party — directly relevant to the party-enrichment work, but a genuinely new topic/flow we haven't touched. |
| 03 | `fspiop_parties_put_callback` | **Yes — new territory** | The resolved party callback: real name (`"Chikondi Banda"`), `partyIdType: MSISDN`, `fspId`, plus ISO `extensionList` (`Assgnmt.MsgId`, `Rpt.Vrfctn`). Confirms party identity is available even earlier than the quote — at discovery. Same caveat as 02: we don't ingest this topic. |
| 04 | `outbound_post_transfers_response_WAITING_FOR_PARTY_ACCEPTANCE` | No | SDK-private state snapshot. |
| 05 | `outbound_put_transfers_acceptParty_request` | No | SDK-private authorization gate (`{acceptParty: true}`). No hub-side equivalent. |
| 06 | `fspiop_fxQuotes_post_request` | **Out of scope, but noted** | `POST /fxQuotes` — FX conversion request. Confirms real FX flows carry `sourceAmount`/`targetAmount`/`determiningTransferId`. Our PPA has never ingested fxQuotes/fxTransfers (README says so explicitly: "FX quotes, bulk quotes/transfers... are intentionally out of scope"). Relevant only if/when FX support is prioritized. |
| 07 | `fspiop_fxQuotes_put_callback` | Out of scope, but noted | FXP's conversion terms + `extensionList` with the *official* `ml-schema-transformer-lib`-style ISO field mapping (`GrpHdr.MsgId`, `SttlmInf.SttlmMtd: CLRG`, `Dbtr.Id.OrgId.Othr.Id`, etc.) — see "ISO extensionList mapping" section below, this is genuinely useful as a mapping reference even though we don't ingest fxQuotes. |
| 08 | `outbound_put_transfers_response_WAITING_FOR_CONVERSION_ACCEPTANCE` | No | SDK-private state snapshot. |
| 09 | `outbound_put_transfers_acceptConversion_request` | No | SDK-private authorization gate. |
| 10 | `fspiop_quotes_post_request` | **Directly useful — same message we already ingest** | `POST /quotes`, structurally the ISO-mode twin of our `topic-quotes-post`. Confirms our `extractPartyData()` field paths (`payer.partyIdInfo`, `payer.personalInfo.complexName`, `payee.partyIdInfo`) are correct even in this deployment — same shape, same fields. **The one difference**: `content-type` is `application/vnd.interoperability.iso20022.quotes+json`, not plain `.quotes+json`. Our `parsers/payload.js` doesn't branch on content-type at all (it just JSON-parses the Kafka envelope), so this wouldn't break parsing — but see the ISO extensionList note below for what it *would* mean for the transfer side. |
| 11 | `fspiop_quotes_put_callback` | **Directly useful, and important** | The quote response: `transferAmount`, `payeeReceiveAmount`, `payeeFspFee`, `ilpPacket`, `condition` — all fields our `quoteParty.js`/`iso20022.js` already know about or could use. **Also carries `originalIso20022QuoteResponse`** — the untranslated ISO 20022 `pacs.008`-shaped object Mojoloop's `ml-schema-transformer-lib` produced internally before flattening back to FSPIOP fields for the API response. This is a rare, concrete look at what the *official* Mojaloop ISO mapping produces, directly comparable to our own `src/tazama/iso20022.js` output — see comparison below. |
| 12 | `outbound_put_transfers_response_WAITING_FOR_QUOTE_ACCEPTANCE` | No | SDK-private cumulative state (contains the above messages embedded, but wrapped non-Kafka). |
| 13 | `outbound_put_transfers_acceptQuote_request` | No | SDK-private authorization gate. |
| 14 | `fspiop_fxTransfers_post_request` | Out of scope, but noted | FX leg reservation. Same "not ingested, FX out of scope" as 06/07. |
| 15 | `fspiop_fxTransfers_put_callback` | Out of scope, but noted | FXP confirms `RESERVED` + fulfilment. Same as above. |
| 16 | `fspiop_transfers_post_prepare_request` | **Directly useful — same message we already ingest, with a surprise** | Structurally the ISO-mode twin of `topic-transfer-prepare`. **Important finding**: this prepare message carries an `extensionList` with `CdtTrfTxInf.Cdtr.Id.PrvtId.Othr.SchmeNm.Prtry: "MSISDN"` and `...Othr.Id: "16665551001"` — i.e. **the payee's real party identifier is present directly on the transfer message itself**, not only on the quote. See "This complicates our documented assumption" below — this is worth your attention. |
| 17 | `fspiop_transfers_put_fulfil_callback` | **Directly useful — same message we already ingest** | Structurally the ISO-mode twin of `topic-transfer-fulfil`: `fulfilment`, `completedTimestamp`, `transferState: COMMITTED`, plus `extensionList` (`GrpHdr.MsgId`/`CreDtTm`). Confirms our `toIsoTxSts()` mapping target (`COMMITTED`) matches a real deployment. |
| 18 | `outbound_put_transfers_response_COMPLETED` | No (structurally) | SDK-private, but its embedded `prepare`/`fulfil`/`quoteResponse`/`fxQuoteResponse` fields are the same content as 16/17/11/07 — nothing new once you've read those directly. |

## Two findings worth your direct attention

### 1. This deployment runs ISO 20022 wire format — ours doesn't (yet)

Every FSPIOP-layer file here (`content-type: application/vnd.interoperability.iso20022.*+json;version=2.0`)
is on Mojaloop's newer **ISO 20022 native profile**, confirmed against
`docs/iso-mode/iso20022 golden path flow.md`: Mojaloop supports both FSPIOP
and ISO 20022 as parallel wire formats behind an `API_TYP`E flag, and our
local `ml-core-test-harness` (where all our captured samples and tests come
from) runs **FSPIOP only** — no ISO mode anywhere in this repo's test
infrastructure. This capture is external evidence that **a real DRPP/COMESA
deployment runs the ISO 20022 profile in production**, which our own test
environment cannot currently reproduce.

Practically: our `parsers/payload.js` treats the Kafka envelope content as
opaque JSON and doesn't care about the outer `content-type` header — so
**parsing wouldn't break**. But the actual *payload shape on the Kafka topics*
in an ISO-mode deployment may differ from what we've built and tested
against, because `ml-api-adapter`/`quoting-service` transform ISO↔FSPIOP at
the API boundary — what lands on Kafka internally could be the FSPIOP form,
the ISO form, or both, depending on how those services' internal transform
hooks are wired. **This is unverified** — nobody has captured what our five
Kafka topics actually look like when the upstream services are running in ISO
mode, because (per the iso-mode doc) that mode has never been run end-to-end
in our test harness. If your PPA is meant to eventually run against a real
DRPP/COMESA deployment rather than just `ml-core-test-harness`, this is a real
open question, not a solved one.

### 2. The transfer-prepare message (file 16) already carries party identity via `extensionList`

Our whole party-enrichment feature (`docs/ppa/party identifier/`) was built
on the premise — verified against our own captured FSPIOP-JSON samples —
that `topic-transfer-prepare`/`-fulfil` carry **no party/account identity at
all**, only FSP-level ids (`payerFsp`/`payeeFsp`), which is exactly why we
built the quote→transfer join.

File 16 (`fspiop_transfers_post_prepare_request`) shows a transfer-prepare
message, in ISO mode, with:

```json
"extensionList": {
  "extension": [
    { "key": "CdtTrfTxInf.Cdtr.Id.PrvtId.Othr.SchmeNm.Prtry", "value": "MSISDN" },
    { "key": "CdtTrfTxInf.Cdtr.Id.PrvtId.Othr.Id", "value": "16665551001" },
    { "key": "CdtTrfTxInf.CdtrAgt.FinInstnId.Othr.Id", "value": "test-zmw-dfsp" }
  ]
}
```

That's the **payee's real MSISDN, present directly on the transfer message**
— something that doesn't exist on the plain-FSPIOP `topic-transfer-prepare`
samples we've captured and tested against. This doesn't invalidate the
join we built (it's still correct and necessary for plain FSPIOP, and it still
gets you the payer side + name/DOB which this `extensionList` doesn't carry),
but it means: **in ISO-mode deployments, some party data may already be
riding on the transfer message itself**, via `extensionList`, and a future
version of our enrichment code targeting an ISO-mode deployment should check
`extensionList` for `CdtTrfTxInf.Cdtr.Id.PrvtId.Othr.Id` /
`CdtTrfTxInf.Dbtr.Id.PrvtId.Othr.Id` as an *additional*, possibly more direct
source, rather than relying solely on the quote join. Worth flagging to
whoever owns the DRPP-specific mapping decisions.

### 3. `originalIso20022QuoteResponse` (file 11) is a real point of comparison for our own `iso20022.js`

File 11's `originalIso20022QuoteResponse.CdtTrfTxInf` is the **official**
Mojaloop-produced ISO 20022 shape for a quote response, e.g.:

```json
"Dbtr": { "Id": { "PrvtId": { "Othr": { "SchmeNm": { "Prtry": "MSISDN" }, "Id": "16665551002" } } }, "Name": "Display-Test" }
```

Compare against what our `src/tazama/iso20022.js` → `party()`/`account()`
produce for the same kind of input — structurally similar (`Id.PrvtId.Othr`
with `SchmeNm.Prtry` holding the identifier type), which is a good sanity
check that our hand-built mapping followed the right conventions. But it's
not identical: the official version nests `SchmeNm` inside `Othr` as a
sibling of `Id` in a single object (`Othr: { SchmeNm, Id }`), while our
schema targets an array (`Othr: [{ Id, SchmeNm }]`) because that's what
Tazama's TMS AJV schema requires (per the existing caveat already documented
in `docs/iso-mode/iso20022 golden path flow.md`: our mapping targets TMS's
schema, not `ml-schema-transformer-lib`'s official one, and the two are
deliberately different for that reason). Useful as confirmation, not as a
"we got the format wrong" signal.

## Bottom line — what to actually do with this folder

- **Don't treat files 02/03 (party lookup) as something we ingest today** —
  we don't consume any `topic-parties-*` topic. If party-lookup-level
  enrichment (getting identity before the quote even happens) is ever wanted,
  that's new scope, not a tweak to existing code.
- **Files 10/11/16/17 are the ones structurally comparable to what we already
  built** (`topic-quotes-post/-put`, `topic-transfer-prepare/-fulfil`) — good
  reference material for field-name sanity-checking, and file 11's
  `originalIso20022QuoteResponse` is a genuinely useful reference for anyone
  extending `iso20022.js`.
- **Files 06/07/14/15 (fxQuotes/fxTransfers) confirm FX is real and
  out-of-scope, not hypothetical** — useful context if/when FX support is
  ever prioritized, since our README already flags FX as unimplemented and
  these are real example payloads to design against.
- **The `extensionList` party-data-on-transfer finding (file 16) is the most
  actionable single thing here** — worth a conversation with whoever owns the
  DRPP/ISO-mode side about whether our enrichment should also check
  `extensionList` directly, independent of the quote join, when running
  against an ISO-mode deployment.
- **The outbound SDK files (01, 04, 05, 08, 09, 12, 13, 18) are not relevant
  to our ingestion process at all** — different protocol, different layer,
  not something our Kafka-tap PPA will ever see.

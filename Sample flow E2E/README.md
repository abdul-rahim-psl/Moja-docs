# DRPP Golden Path — one complete cross-border transaction, end to end

Extracted from the Allure single-file report `Consolidated test archive/Regulatory UAT testing/Regulatory UAT Test reports/RUAT-DRPP-GP Golden Path Reports (functional)/DRPP Golden Path Results/2025-10-13T13-10-25-015Z.html` ("COMESA GP Report", Allure 2.33.0, report UUID `fa0ac2f0-0bb2-4402-9f6d-aae011e3f996`).

## The flow selected

|  |  |
| :---- | :---- |
| **Test case** | DRPP-GP-01 Send Money (Source Currency, Multiple FXPs) |
| **Suite** | Multi Scheme test-mwk-dfsp to test-zmw-dfsp |
| **Allure test-case uid** | `e07be96b3bfd94c9` |
| **Result** | passed — final state `COMPLETED` |
| **Correlation id (W3C trace-id)** | **`67629f2771f9ca3e58ae98d2b525ff82`** |
| **transferId** | `01K7EV9TNQ1VKX84N0GSQH6MDD` |
| **quoteId** | `01K7EV9X2K4F8J90ZWMRHDNCZN` |
| **conversionRequestId** | `01K7EV9VS1V41WTE9SC7JCGFZN` |
| **conversionId / commitRequestId** | `01K7EV9VS1V41WTE9SC7JCGFZP` |
| **Payer → Payee** | `test-mwk-dfsp` (MSISDN 16665551002\) → `test-zmw-dfsp` (MSISDN 16665551001\) |
| **FX provider** | `test-fxp` |
| **Amount** | MWK 60 (SEND, source currency) → ZMW 1; payeeFspFee ZMW 0, payeeReceiveAmount ZMW 1 |
| **Wall-clock** | 2025-10-13T13:14:05.367Z → 13:14:11.252Z (5.9 s) |
| **Switch endpoint** | `https://extapi.mw.drpp.global` |

Every one of the ten FSPIOP messages below carries the **same** trace-id `67629f2771f9ca3e58ae98d2b525ff82` in its `traceparent` header (differing only in span-id), so the whole cross-border leg is a single distributed trace. The four SDK-outbound-API calls made by the test harness carry a separate harness-wide traceparent (`00-aabbb085054070210f925d85120ad171-…`, with a `baggage: testCaseId=14,requestId=N` header) — that trace-id is reused across every test case in the run and is *not* a per-flow correlator. Below the outbound API, the SDK also echoes `traceId: 67629f2771f9ca3e58ae98d2b525ff82` in its own state object.

## Two layers in this capture

* **SDK Scheme Adapter outbound API** (files `outbound_*`) — the private, non-FSPIOP REST API between the payer DFSP's back office (here, the Mojaloop Testing Toolkit acting as `test-mwk-dfsp`) and its SDK Scheme Adapter. This is where the three-stage payer authorization happens (`acceptParty` → `acceptConversion` → `acceptQuote`).  
* **FSPIOP / ISO 20022 interoperability API** (files `fspiop_*`) — the on-the-wire scheme messages between DFSPs, the FXP and the DRPP switch. Content types are `application/vnd.interoperability.iso20022.*+json;version=2.0`, i.e. the ISO 20022 profile, with the original ISO payload preserved in `originalIso20022QuoteResponse` (step 11\) and ISO field mappings carried in `extensionList` entries (`GrpHdr.MsgId`, `CdtTrfTxInf.Dbtr.Id.PrvtId.Othr.Id`, `SttlmInf.SttlmMtd: CLRG`, …).

## Step table

| Seq | Layer | Direction (fspiop-source → destination) | Method | Resource | Purpose |
| ----: | :---- | :---- | :---- | :---- | :---- |
| 01 | SDK outbound | harness → test-mwk-dfsp SDK | POST | `/transfers` | Payer back office initiates the transfer: MWK 60, SEND, payee MSISDN 16665551001\. |
| 02 | FSPIOP | `test-mwk-dfsp` → switch/ALS | GET | `/parties/MSISDN/16665551001` | Party lookup — which DFSP and scheme holds the payee. |
| 03 | FSPIOP | `test-zmw-dfsp` → `test-mwk-dfsp` | PUT | `/parties/MSISDN/16665551001` | Payee DFSP returns the resolved party; confirms payee reachable, supported currency ZMW. |
| 04 | SDK outbound | SDK → harness | 200 OK | `/transfers` | State machine pauses at `WAITING_FOR_PARTY_ACCEPTANCE`. |
| 05 | SDK outbound | harness → test-mwk-dfsp SDK | PUT | `/transfers/01K7EV9TNQ…` | **Authorization 1/3** — `{"acceptParty": true}`. |
| 06 | FSPIOP | `test-mwk-dfsp` → `test-fxp` | POST | `/fxQuotes` | Request FX conversion quote MWK 60 → ZMW, tied to `determiningTransferId`. |
| 07 | FSPIOP | `test-fxp` → `test-mwk-dfsp` | PUT | `/fxQuotes/01K7EV9VS1V41WTE9SC7JCGFZN` | FXP returns conversion terms (ZMW 1, expiry, ILP condition). |
| 08 | SDK outbound | SDK → harness | 200 OK | `/transfers/01K7EV9TNQ…` | State `WAITING_FOR_CONVERSION_ACCEPTANCE`, FX terms surfaced to payer. |
| 09 | SDK outbound | harness → test-mwk-dfsp SDK | PUT | `/transfers/01K7EV9TNQ…` | **Authorization 2/3** — `{"acceptConversion": true}`. |
| 10 | FSPIOP | `test-mwk-dfsp` → `test-zmw-dfsp` | POST | `/quotes` | Quote request for the ZMW leg, carrying the FXP conversion terms. |
| 11 | FSPIOP | `test-zmw-dfsp` → `test-mwk-dfsp` | PUT | `/quotes/01K7EV9X2K4F8J90ZWMRHDNCZN` | Payee quote: transferAmount ZMW 1, payeeFspFee ZMW 0, ILP packet \+ condition. |
| 12 | SDK outbound | SDK → harness | 200 OK | `/transfers/01K7EV9TNQ…` | State `WAITING_FOR_QUOTE_ACCEPTANCE`. |
| 13 | SDK outbound | harness → test-mwk-dfsp SDK | PUT | `/transfers/01K7EV9TNQ…` | **Authorization 3/3** — `{"acceptQuote": true}`; releases both transfer legs. |
| 14 | FSPIOP | `test-mwk-dfsp` → `test-fxp` | POST | `/fxTransfers` | Reserve the FX leg MWK 60 → ZMW 1 under `commitRequestId` 01K7EV9VS1V41WTE9SC7JCGFZP. |
| 15 | FSPIOP | `test-fxp` → `test-mwk-dfsp` | PUT | `/fxTransfers/01K7EV9VS1V41WTE9SC7JCGFZP` | FXP confirms conversion `RESERVED` and returns the fulfilment. |
| 16 | FSPIOP | `test-mwk-dfsp` → `test-zmw-dfsp` | POST | `/transfers` | Transfer **PREPARE** for the payee leg (ZMW 1); positions reserved at the switch. |
| 17 | FSPIOP | `test-zmw-dfsp` → `test-mwk-dfsp` | PUT | `/transfers/01K7EV9TNQ…` | **FULFIL / settlement** — `transferState: COMMITTED`, fulfilment satisfies the condition. |
| 18 | SDK outbound | SDK → harness | 200 OK | `/transfers/01K7EV9TNQ…` | Final state `COMPLETED`; full accumulated state object (contains every message above). |

Read left-to-right: **lookup (02–03) → FX quote (06–07) → payee quote (10–11) → FX reserve (14–15) → transfer prepare/fulfil (16–17)**, with a payer authorization gate before each of the three release points.  

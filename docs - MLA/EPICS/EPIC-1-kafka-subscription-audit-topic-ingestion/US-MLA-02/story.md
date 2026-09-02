# US-MLA-02 — Distinguish Event Types Within the Audit Topic Stream

**Epic:** Epic 1 — MLA: Kafka Subscription & Audit Topic Ingestion
**Source:** `docs - MLA/user stories/cch-mla-user-stories.md`

---

## Description

Because the audit topic carries all event types in a single unified stream, the MLA must classify each consumed message by event type (QUOTE, FXQUOTE, TRANSFER, FXTRANSFER). Confirmed against `DRPP_Kafka_E2E_Pack` (5 corridor captures from `topic-event-audit`, 20 records each, 100 records total, zero exceptions): every record carries a `metadata.trace.tags.operation` value that maps directly to one of the four types, corroborated by the record's `Content-Type`/`Accept` header (the ISO 20022 resource name — `quotes`, `fxQuotes`, `transfers`, `fxTransfers`) and its `FSPIOP-HTTP-Method` header (POST for the request leg, PUT or PATCH for the callback leg). The transfer's prepare and fulfil/final-state legs are both TRANSFER — there is no separate notification category (see US-MLA-01). Where each classified event is delivered to on PPA is covered separately (US-MLA-06); this story is only about resolving the correct eventType.

**Classification Table**

| `operation` | HTTP Method | Resource Path | Leg | Classifies As |
| --- | --- | --- | --- | --- |
| `postQuotes` | POST | `/quotes` | Request | **QUOTE** |
| `putQuotesByID` | PUT | `/quotes/{quoteId}` | Callback | **QUOTE** |
| `postFxQuotes` | POST | `/fxQuotes` | Request | **FXQUOTE** |
| `putFxQuotesByID` | PUT | `/fxQuotes/{conversionRequestId}` | Callback | **FXQUOTE** |
| `prepareTransfer` | POST | `/transfers` | Prepare | **TRANSFER** |
| `fulfilTransfer` / `commitTransfer` | PUT / PATCH | `/transfers/{transferId}` | Fulfil / final-state | **TRANSFER** |
| `prepareFxTransfer` / `reserveFxTransfer` | POST | `/fxTransfers` | Request | **FXTRANSFER** |
| `fulfilFxTransfer` | PUT | `/fxTransfers/{commitRequestId}` | Reserve callback | **FXTRANSFER** |
| `notifyFxTransfer` / `commitTransfer` | PATCH | `/fxTransfers/{commitRequestId}` | Commit (`TxSts: COMM`) | **FXTRANSFER** |
| `getPartiesByTypeAndID` / `putPartiesByTypeAndID` / `putPartiesErrorByTypeAndID` | GET / PUT | `/parties/{Type}/{ID}` | Party discovery | **Out of scope — skipped** |
| *(anything not matching a row above)* | — | — | — | **Unclassifiable — skipped** |

Note that TRANSFER has two legs and FXTRANSFER has three — the extra `PATCH` commit leg on FXTRANSFER has no domestic-TRANSFER equivalent.

## Acceptance Criteria

- Every event is classified using its `operation` value (or, where that field isn't available on a given record, the resource name from `Content-Type`/`FSPIOP-URI` together with `FSPIOP-HTTP-Method`), per the Classification Table above.
- Every row of the Classification Table is covered — all legs of QUOTE, FXQUOTE, TRANSFER, and FXTRANSFER, including FXTRANSFER's three-leg lifecycle.
- Party-discovery records are recognized and explicitly skipped — they are not one of the four `eventType` values and are out of MLA's scope (FSD §11 Phase 1 Exclusions).
- An event matching no row in the table is skipped: logged as unclassifiable, the offset is advanced, and no envelope is forwarded to PPA.
- The classification logic is unit-tested against sample payloads for every row of the Classification Table.

## Method

1. **Read the classification signal** — prefer `metadata.trace.tags.operation` where present on the record; otherwise fall back to the `Content-Type`/`Accept` header's resource name combined with the `FSPIOP-HTTP-Method` header.
2. **Map** — look the operation/resource up against the table above to resolve one of QUOTE, FXQUOTE, TRANSFER, FXTRANSFER, or "party discovery" (out of scope).
3. **Skip out-of-scope records** — party-discovery operations are recognized and dropped without further processing.
4. **Skip unclassifiable events** — anything matching none of the known operations/resources is logged, the offset is advanced, and nothing is forwarded.
5. **Pass on the resolved eventType** — a successfully classified event proceeds to envelope construction (US-MLA-04), which is where its PPA destination is decided.

## Assumptions

- `metadata.trace.tags.operation` is present and reliable on `topic-event-audit` as captured — confirmed with zero exceptions across all 5 corridor samples in `DRPP_Kafka_E2E_Pack`. Whether this is a guaranteed platform contract or an artefact of this particular capture window is still open, and should be confirmed for CCH's own environment/version before this classification rule is finalized.
- `operation` naming is not perfectly symmetric between a step's `start` and `egress` capture — one corridor's `start: fulfilFxTransfer` pairs with `egress: reserveFxTransfer` for what is the same logical step. Classification should key primarily on the HTTP method plus resource name (`Content-Type`/`FSPIOP-URI`), using `operation` as a secondary, confirmatory signal rather than the sole discriminator.
- There is no fifth "notification" classification value. This matches the FSD's four-value `eventType` enum exactly, and is confirmed — not just assumed — by the Kafka evidence: there is no distinct event to classify as a notification in the first place.
- Whether `operation`, `Content-Type`, and `FSPIOP-HTTP-Method` survive identically in CCH's production audit-topic feed (as opposed to this staging capture) is Open Item #7 and should be validated before implementation is finalized.

## Todos

1. Implement the classification rule set against the operation/resource/method mapping table, including FXTRANSFER's three-leg lifecycle and the party-discovery skip path.
2. Write tests (Jest, 95% coverage target) covering all four event types (every leg of each, including FXTRANSFER's PATCH commit stage), the party-discovery skip, and the unclassifiable-event skip path.
3. Validate that `operation`, `Content-Type`, and `FSPIOP-HTTP-Method` are present and reliable on CCH's production audit topic (Open Item #7) before this story is considered implementation-ready.

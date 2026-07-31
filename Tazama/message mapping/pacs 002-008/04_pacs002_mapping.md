# pacs.002.001.12 — field-by-field mapping

**Replaces §6.5 rows 4, 6 and 7.** Trigger: **msg 17** `PUT /transfers` (FULFIL), or an error callback.

> ⚠️ **The trigger source is an open decision — see FSD §6.4.7.** The FSD names the **Central Ledger notification** (`topic-notification-event`) as the final-state trigger; this mapping uses the **FSPIOP fulfil callback** for an evidential reason rather than a design one — the golden path is an FSPIOP *wire* capture containing no Kafka events, so the notification was not available to map from. Both carry `transferState` and `completedTimestamp`.
>
> The deciding question: **does the Central Ledger notification carry `fspiop-source` / `fspiop-destination`?** `InstgAgt` and `InstdAgt` are required and sourced from those headers. If it does, the notification is preferable — it is the authoritative settlement record. If not, the fulfil callback is the only viable trigger. Needs a Kafka-side capture from CCH to settle.
>
> Everything else in this mapping is unaffected: the two events carry the same status fields, so only the *locator* column changes if the decision flips.
Contract: `tms-service/src/schemas/pacs.002.json` (ajv). Endpoint: `POST /v1/evaluate/iso20022/pacs.002.001.12`.
Validated output: [`samples/tazama_pacs002.json`](samples/tazama_pacs002.json) — **passes**.

Legend as in [`03_pacs008_mapping.md`](03_pacs008_mapping.md).

---

## Root

| Tazama field | Type | Req | Source | Locator | Prov. | Rule | Golden-path value |
|---|---|---|---|---|---|---|---|
| `TxTp` | string | — | — | — | Created | Constant; schema default fills it if omitted | `"pacs.002.001.12"` |
| `TenantId` | — | **forbidden** | — | — | — | ⚠️ **Must NOT be sent** — TMS injects from the JWT | *(absent)* |

## `FIToFIPmtSts.GrpHdr`

| Tazama field | Type | Req | Source | Locator | Prov. | Rule | Golden-path value |
|---|---|---|---|---|---|---|---|
| `MsgId` | string | ✔ | 17 | `ext[GrpHdr.MsgId]` | Copied | **D9** — scheme-supplied; generate a ULID only if absent | `"01K7EVA0DTXE0B1GCTZ744Y2PD"` |
| `CreDtTm` | string | ✔ | 17 | `ext[GrpHdr.CreDtTm]` | Copied | **D9** — falls back to PPA construction time | `"2025-10-13T13:14:11.258Z"` |

> Both **are** supplied by Mojaloop here, contradicting FSD v1.1's claim that they are always PPA-generated (**D9**).

## `FIToFIPmtSts.TxInfAndSts`

All seven fields below are **required** by the real schema.

| Tazama field | Type | Req | Source | Locator | Prov. | Rule | Golden-path value |
|---|---|---|---|---|---|---|---|
| `OrgnlInstrId` | string | ✔ | 17 | `hdr.fspiop-uri` / correlation | Copied | **Must equal the pacs.008's `PmtId.InstrId`** (**D2**) | `"01K7EV9TNQ1VKX84N0GSQH6MDD"` |
| `OrgnlEndToEndId` | string | ✔ | cache | — | Copied | **Must equal the pacs.008's `PmtId.EndToEndId`** (**D2**) | `"01K7EV9TNQ1VKX84N0GSQH6MDD"` |
| `TxSts` | string | ✔ | 17 | `body.transferState` | **Calculated** | ⚠️ **Translate** — see table below | `"ACSC"` |
| `ChrgsInf` | **array** | ✔ | 11 | `body.payeeFspFee` | Calculated | ⚠️ **Array** here, object in pacs.008. `[]` is valid when there are no charges | `[{Amt:{0,ZMW}, Agt:test-zmw-dfsp}]` |
| `AccptncDtTm` | string | ✔ | 17 | `body.completedTimestamp` | Copied | Settlement time — **not** the PPA's clock | `"2025-10-13T13:14:11.252Z"` |
| `InstgAgt…MmbId` | string | ✔ | 17 | `hdr.fspiop-source` | Copied | ⚠️ Agent **sending** the status | `"test-zmw-dfsp"` |
| `InstdAgt…MmbId` | string | ✔ | 17 | `hdr.fspiop-destination` | Copied | ⚠️ Agent **receiving** it | `"test-mwk-dfsp"` |

> ⚠️ **Direction reverses relative to pacs.008.** The fulfil travels payee → payer, so `InstgAgt` = `test-zmw-dfsp` and `InstdAgt` = `test-mwk-dfsp` — the mirror of `DbtrAgt`/`CdtrAgt`. Copying the pacs.008 agents across is the easiest mistake to make here.
>
> ⚠️ **These come from HTTP headers, not the body.** The MLA event envelope (FSD §5.4) must preserve `fspiop-source` / `fspiop-destination`, or these two required fields cannot be populated at all. **Open verification.**

### `TxSts` translation — required

`TxSts` is an **unconstrained string** in the real schema, so an untranslated value is *accepted and stored*:

```
PASS  pacs002 TxSts="COMMITTED" (raw Mojaloop)
```

That makes this more dangerous, not less: the message passes, and every downstream rule testing for ISO status codes silently fails to match. A rejection would at least surface the problem.

| Mojaloop | Field | → `TxSts` | Rationale |
|---|---|---|---|
| `COMMITTED` | `transferState` | **`ACSC`** | AcceptedSettlementCompleted. Not `ACCC`, which asserts funds reached the *creditor's account* — evidence Mojaloop's `COMMITTED` does not provide |
| `ABORTED` | `transferState` | **`RJCT`** | Rejected |
| `RESERVED` | `transferState` / `conversionState` | **`ACSP`** | Settlement in process — reserved, not final |
| *error callback* | — | **`RJCT`** | Rejected |

---

## Row 6 — FX final-state notification: **removed**

FSD v1.1 row 6 emits a second pacs.002 from the FX leg's `conversionState`. **Under D1 this row does not exist.**

The FX conversion is not a separate Tazama transaction — it is folded into the single payment via `InstdAmt` (MWK 60), `IntrBkSttlmAmt` (ZMW 1) and `XchgRate` (60). Msg 15's `conversionState: RESERVED` is an **intermediate state of a leg**, not a terminal state of the payment. Emitting it would produce a second pacs.002 carrying the same `OrgnlEndToEndId` with a *non-final* status, which would either overwrite or race the real outcome from msg 17.

Msg 15 is still consumed for correlation and audit — it is simply never emitted to TMS.

---

## Row 7 — error callbacks

⚠️ **Spec-derived, not sample-verified.** The golden path is a happy path and contains **no error callback**. This mapping follows the FSPIOP error schema and must be validated against a real error capture before implementation.

An FSPIOP error callback (`PUT /transfers/{id}/error`, `PUT /quotes/{id}/error`, …) carries:

```json
{ "errorInformation": { "errorCode": "5100", "errorDescription": "..." } }
```

| Tazama field | Source | Prov. | Rule |
|---|---|---|---|
| `TxSts` | — | Created | **`RJCT`** always |
| `OrgnlInstrId` / `OrgnlEndToEndId` | cache, via the resource id in `fspiop-uri` | Copied | Must match the originating pacs.008 |
| `AccptncDtTm` | `hdr.date` | Inferred | No `completedTimestamp` exists on an error |
| `InstgAgt` / `InstdAgt` | `hdr.fspiop-source` / `-destination` | Copied | |
| `ChrgsInf` | — | Defaulted | `[]` — verified valid |
| `GrpHdr.MsgId` / `CreDtTm` | `ext[…]` if present, else generated | **D9** | |

> ⚠️ **`errorCode` and `errorDescription` have nowhere to go.** FSD v1.1 maps them to `StsRsnInf.Rsn.Prtry` and `StsRsnInf.AddtlInf` — **`StsRsnInf` does not exist** in Tazama's pacs.002 schema, so `removeAdditional: 'all'` deletes it silently. The message would be accepted with the failure reason stripped out.
>
> Tazama therefore learns only *that* a transaction was rejected, never *why*. Options: (a) accept the loss and keep the reason in the PPA audit log; (b) raise a change request on `tms-service` to add `StsRsnInf`. **Recommend (a) now, (b) as a follow-up** — a rejection reason is genuinely useful for typology work.

---

## Verification

```
tazama_pacs002.json  vs  src/schemas/pacs.002.json   VALID: true
  STRIPPED by removeAdditional: (nothing)
```

| Test | Result |
|---|---|
| With `TenantId` | **FAIL** — `must NOT be valid` |
| Without `ChrgsInf` | **FAIL** — `must have required property 'ChrgsInf'` |
| `ChrgsInf: []` | PASS — empty array is valid |
| `TxSts: "COMMITTED"` | **PASS** — hence translation is a correctness duty, not a validation one |

# Executive Summary — Mojaloop → Tazama message mapping

**Completed** 2026-07-30 · Scope: §6.5 rows 3, 4, 6, 7 of `CCH_FSD_MessageIngestion_v1_1.md`

---

## 1. The problem

The FSD's §6.5 defined how the Payment Platform Adaptor translates Mojaloop events into the ISO 20022 messages Tazama ingests. It was written from the ISO 20022 standard and from assumptions about Mojaloop, but had never been tested against either a real cross-border transaction or Tazama's actual ingestion contract.

Two things arrived that made verification possible: the Mojaloop team's **complete 18-message cross-border FX flow** (DRPP golden path, MWK 60 → ZMW 1), and access to **Tazama's real source** (`frms-coe-lib`, `tms-service`).

The question: which Mojaloop messages do we actually consume, and what precisely does each field map to?

## 2. The process

| # | Step | What it produced |
|---|---|---|
| 1 | Read the 18-message golden path, the FSD, Tazama's TS interfaces and TMS docs | Baseline understanding |
| 2 | **Decoded the ILP packet** in the transfer prepare | It is not opaque — it carries both parties, both fspIds, payer name, transaction type |
| 3 | Classified all 18 messages by layer | 8 SDK-private messages excluded — the PPA is switch-side and cannot see them |
| 4 | Traced every mandatory Tazama field back to a Mojaloop source | 7 messages consumed; found fields with **no source at all** |
| 5 | Wrote a plan + executive plan; **got sign-off on D1, D3 and scope** | Design settled before field work |
| 6 | **Found the real validator** — TMS uses ajv against `src/schemas/*.json`, not `swagger.yaml` | Corrected the ground truth; several earlier conclusions changed |
| 7 | Validated **Tazama's own sample** against **Tazama's own swagger** | It fails in 4 places — proving `swagger.yaml` is stale |
| 8 | Built both messages from real golden-path values | `samples/tazama_pacs008.json`, `samples/tazama_pacs002.json` |
| 9 | Validated with **TMS's exact ajv configuration**, plus negative controls | Both valid, nothing stripped; 8 controls confirming each claim |
| 10 | Rewrote §6.5 | The deliverable |

The method throughout: **verify, don't assert.** Every claim in the output is backed by a schema, a decoded payload, or a validator run that can be re-executed.

## 3. What we found

### The finding that matters most

TMS runs ajv with **`removeAdditional: 'all'`** — any field not in the schema is **silently deleted**. Proven:

```
PASS  pacs008 with VrfctnOfTerms (FSD v1_1 shape)
        VrfctnOfTerms survived? false
```

The FSD's design carried the ILP packet in `VrfctnOfTerms`, which does not exist in Tazama's schema. That message returns **HTTP 200** and loses the data. No error, no log, no rejection.

**The old mapping would not have failed visibly. It would have looked like it was working while quietly discarding data.** That is why this was worth verifying rather than reasoning about.

### Six defects in the previous §6.5

| Defect | Consequence |
|---|---|
| `VrfctnOfTerms` / `IlpV4PrepPacket` / `Condition` don't exist | Silently stripped — data lost, no error |
| `PmtId.TxId` doesn't exist (it's `InstrId` + `EndToEndId`) | pacs.002 never joins its pacs.008; graph enrichment fails |
| pacs.008 built from request **+ callback** | Prepare→fulfil is ~1 s — Tazama evaluates already-settled payments |
| `transferState → TxSts` untranslated | `"COMMITTED"` is stored, then fails every rule testing ISO status codes |
| `RgltryRptg` / `RmtInf` / `SplmtryData` omitted | **Required** — message rejected |
| Separate pacs.002 for the FX leg | Injects a synthetic FXP entity into Tazama's graph on every payment |

### Three constraints nobody had documented

1. **`TenantId` must NOT be sent.** Both schemas forbid it; TMS injects it from the **JWT**. The TS interfaces mark it mandatory — they describe the post-ingestion message. Sending it causes rejection.
2. **`swagger.yaml` is stale documentation, not the contract.** It disagrees with the real schema on array-vs-object, and Tazama's own sample fails it.
3. **The ILP packet is a data source.** Decoding it is what makes emit-on-prepare viable, and it is why the prepare message is far richer than its FSPIOP body suggests.

### Four data gaps with no Mojaloop source

Required fields that must be constant-filled — each is a small untruth in the data:

| Gap | Impact |
|---|---|
| **Payee date of birth** — appears nowhere in the entire flow | Every payee shares a sentinel DOB; anything keying on it treats all payees as coincident |
| **Payer geolocation** | Constant `0,0` — disables geo-velocity and impossible-travel typologies |
| **Regulatory (BoP) reporting** | Constant-filled, though genuinely meaningful for a cross-border corridor |
| **Error reason** (`errorCode`) — no `StsRsnInf` in the schema | Tazama learns *that* a payment was rejected, never *why* |

These need CCH input; the first three are candidates for `extensionList`.

## 4. The outcome

**§6.5 is rewritten** — restructured into six subsections: the ingestion contract, the corrected mapping table, one-transaction-per-payment, emission timing and status translation, header generation, and the status of unverified rows.

**Both messages are proven.** Built from real golden-path values and validated with TMS's exact ajv configuration:

```
tazama_pacs008.json  vs  pacs.008.json   VALID: true   STRIPPED: (nothing)
tazama_pacs002.json  vs  pacs.002.json   VALID: true   STRIPPED: (nothing)
```

Eight negative controls confirm each individual claim, and the scripts ship with the docs so any future change can be re-verified.

**The cross-border signal now survives the mapping** — the single thing the old design lost:

```json
"IntrBkSttlmAmt": { "Amt": { "Amt": 1,  "Ccy": "ZMW" } },
"InstdAmt":       { "Amt": { "Amt": 60, "Ccy": "MWK" } },
"XchgRate": "60"
```

Two currencies in one transaction with the rate connecting them. Under the old per-leg model this was split across two transactions and the relationship was lost.

### Deliverables

| File | Contents |
|---|---|
| `01_message-relevance.md` | Which 7 of 18 messages we consume, and why the other 11 are excluded |
| `02_design-decisions.md` | **Authoritative.** D1–D10 with evidence; the ground-truth correction; gaps G1–G6 |
| `03_pacs008_mapping.md` | Every leaf field: source, locator, provenance, rule, golden-path value |
| `04_pacs002_mapping.md` | Same, plus error-callback handling and why the FX row was removed |
| `05_worked-example.md` | The full transaction end to end, with timeline and data-flow diagram |
| `samples/` | Two validated payloads + the validation and negative-test scripts |
| `plan.md`, `executive plan.md` | Pre-implementation; carry correction banners |

## 5. What remains

**Verify (non-blocking):**
- Does the MLA event envelope preserve FSPIOP **headers**? `InstgAgt`/`InstdAgt` are required and come from `fspiop-source`/`fspiop-destination` — without them, pacs.002 cannot be built.
- Is the MLA switch-side? The exclusion of the 8 SDK messages depends on it.
- Should we align with the existing `tazama-lf/payment-platform-adapter` rather than diverge?

**Raise with CCH:** payee DOB, geolocation, and a corridor BoP code — ideally via `extensionList` (G1–G3).

**Raise with Tazama:** `XchgRate` is `string` in the schema but `number` in the TS interface (G5); `swagger.yaml` is stale; and adding `StsRsnInf` would let rejection reasons reach the rules engine.

**Known limits of this work:**
- The golden path is **one happy path** — `SEND`, source-currency, single FXP, `COMMITTED`. No `RECEIVE`, `ABORTED`, or multi-FXP coverage.
- **Row 7 (error callbacks) is spec-derived, not sample-verified** — the capture contains no error case. It needs a real error capture before implementation.
- **Rows 1, 2 and 5** (quotes, fxQuotes, pacs.009 → pain.001/pain.013/pacs.009) were **out of scope and remain unverified**, carrying the same class of defects corrected here.
- **§7's worked examples were not updated** and now contradict §6.5. They should be regenerated from `samples/`.

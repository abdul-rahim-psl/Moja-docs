# FX edge-case driver scripts

Direct-request harness used to produce the §10 edge-case captures in
[`../topic-event-audit-edge-case-captures/`](../topic-event-audit-edge-case-captures/).
Kept in the repo deliberately: the previous session's `onboard.js` / `run_golden_path.js`
lived only in a scratchpad and were lost, which the plan called out as a thing to fix.

## How it works

Everything runs **inside the cluster**, from the TTK backend pod, because this deployment has no
unified hub gateway — each switch component has its own Service (plan §9.10). `run.sh` concatenates
`fxlib.js` (a prelude, not a module) with one scenario file and pipes the bundle into
`kubectl exec -i ... node -`, so nothing needs writing to the pod's read-only filesystem.

```bash
./run.sh s_xfer_abort.js          # run one scenario
./audit.sh <id> [timeout-ms]      # dump matching topic-event-audit records
```

`run.sh` and `audit.sh` SSH to `10.0.150.69` as root using `~/.ssh/mojaloop_fx_10_0_150_69`
(see the plan's "Working method" header).

## What `fxlib.js` provides

- **ISO 20022 body construction** via `@mojaloop/ml-schema-transformer-lib`, which ships inside the
  TTK backend image. `TransformFacades.FSPIOP.<resource>.<op>()` converts a plain-FSPIOP body into
  real ISO wire format (`pacs.008`-shaped), which is what the switch requires in this deployment.
  It is put in `configure({ isTestingMode: true })` — the non-testing mapping requires a `$context`
  carrying the ISO quote response from an earlier leg, which a single hand-built request doesn't have.
- **ISO-form media types** — `mt(resource)` builds
  `application/vnd.interoperability.iso20022.<resource>+json;version=2.0`.
- **Genuine ILPv4 packets** via `@mojaloop/sdk-standard-components`' `ilpFactory`.
  `ilpFor()` returns a matching `{fulfilment, condition, ilpPacket}` triple. This matters: in
  ISO 20022 mode the condition travels *inside* `VrfctnOfTerms.IlpV4PrepPacket`, not as its own
  field, so a copied sample packet will not work.
- **`id()` returns a ULID, not a UUID.** In ISO 20022 mode the id fields map onto
  `PmtId.InstrId` (pattern `^[0-9A-HJKMNP-TV-Z]{26}$`) and `PmtId.EndToEndId` (max 35 chars — a
  36-char UUID overflows it). Using UUIDs is what produced the
  "must NOT have more than 35 characters" failure in plan §9.10.
- `prepareTransfer()`, `positions()`, `send()`, `report()`, `sleep()`.

## Scenarios

| File | §10 row | Outcome |
|---|---|---|
| `s_fund.js` | (prerequisite) | Records funds in to each participant's SETTLEMENT account. **Required** — without it every prepare fails `4001`. |
| `s_positions.js`, `s_limits.js` | — | Read participant positions / NDC limits. |
| `s_xfer_happy.js` | baseline | prepare → fulfil → COMMITTED. |
| `s_ilp_mismatch.js` | ILP condition mismatch | Fulfil with a non-matching fulfilment → `3100`. |
| `s_xfer_abort.js` | Transfer abort | Payee sends `PUT /transfers/{ID}/error` → `5000`. |
| `s_ndc_breach.js` | NDC breach | Lower the NDC, then exceed it → `4200`. Restores the cap afterwards. |
| `s_xfer_timeout.js` | Transfer timeout | Short expiry, never fulfilled → `3303`. Takes ~90s. |
| `s_fxquote_expiry.js` | FX quote expiry (request leg) | Already-expired `POST /fxQuotes` → accepted `202`. |
| `s_fxquote_expiry_put.js` | FX quote expiry (response leg) | `PUT /fxQuotes/{ID}` 40s past expiry → accepted `200`. |
| `s_transfer_base.js` | — | Bare prepare, kept as the minimal reproducer. |

Scenarios are self-contained and re-runnable: each does its own prepare, so none depends on state
left by another.

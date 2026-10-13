# UAT End-to-End Test: Rule Fixes Verified

## Contents

- [Executive summary](#executive-summary)
- [What was wrong](#what-was-wrong)
- [How we fixed it](#how-we-fixed-it)
- [End-to-end verification](#end-to-end-verification)
  - [How we tested](#how-we-tested)
  - [Evaluations before and after](#evaluations-before-and-after)
  - [Rule results for the verified payment](#rule-results-for-the-verified-payment)
  - [Typology score](#typology-score)
- [Appendix: verified evaluation record](#appendix-verified-evaluation-record)

**Date:** 2026-10-13. **Environment:** UAT. **Follows:** the UAT end-to-end test report of 2026-10-12.

## Executive summary

| | 12 October | 13 October, after the fixes |
| --- | --- | --- |
| Rules returning an outcome | 0 of 30 | 27 of 30 |
| Rules returning `.err` | 30 | 3: 076, 078 and 091, all expected |
| Typology score | 0, from errors | 500, computed from every rule result |
| Evaluation status | NALT | ALRT |

**The problem.** On 12 October a real payment reached Tazama, but every one of the 30 CCH rules returned `.err`, so the evaluation's score of 0 reflected errors, not an assessment. There were three causes:

- The rules were bound to a different message version from the one the platform carries.
- UAT still held Tazama's standard rule configurations, which the CCH rules reject.
- The standard typology had no weights for the outcomes the CCH rules return.

**The fix.** On 13 October we made three changes on UAT, in order, and each can be rolled back:

1. Rebound all 30 rules to `pacs.002.001.12`.
2. Loaded the CCH configurations for 18 rules.
3. Added the missing typology weights.

MLA and PPA needed no change.

**The verification.** We then sent a fresh payment through the whole path:

- MLA delivered 8 of 8 events to PPA.
- PPA's 4 ISO 20022 messages were all accepted by Tazama.
- All 30 rules and the flow processor reported.
- The typology scored 500, which is exactly the sum of the configured weights for the outcomes the rules returned.
- The adjudicator wrote the evaluation.

Every stage was checked against its own evidence.

**The ALRT is not a fraud finding.** Two things stand between this evaluation and a CCH verdict:

- **The typology is still Tazama's standard one.** Its weights were written for the standard bands, and the 500 comes from three outcomes that are harmless in substance. The CCH typologies replace it in a later step.
- **Two gaps leave part of the rule set unable to see its data.**
  - Five rules need a corridor key that Tazama does not build, so they exit `.x00` on every message.
  - Thirteen rules count only settlements with status `ACCC`, but PPA reports a completed transfer as `ACSC`.

## What was wrong

| Cause | What it did | Rules |
| --- | --- | --- |
| The rules accepted only `pacs.002.001.15` (rule 010 only `pacs.008.001.10`). The platform carries the status message as `pacs.002.001.12`: PPA sends it, TMS accepts it, and Tazama stores it under that version | "Unsupported transaction type" | All 30; 13 failed on this alone |
| UAT held Tazama's standard 4.0.0 configurations. Each CCH rule checks its configuration when it loads it, and rejects the standard ones, for example for lacking a `.x00` exit | "Error while getting rule configuration" | 17 |
| The standard typology has no weight for several outcomes the CCH rules return, for example rule 016's `.x00`. One missing weight makes the typology expression non-numeric, so the typology scores 0 | Score 0 on every message | All |

## How we fixed it

| Step | Change | Live from (UTC) |
| --- | --- | --- |
| 1 | **Rebound all 30 rules to `pacs.002.001.12`**: the message check and every history query. Rule 010 moved from pacs.008 to pacs.002. The rule images on UAT were rebuilt from the patched code, and all 1,026 unit tests pass. The previous containers are kept, stopped, for rollback | By 07:31 |
| 2 | **Loaded the CCH configurations for 18 rules**: 001, 002, 003, 004, 008, 016, 017, 021, 024, 026, 027, 044, 045, 048, 076, 083, 084 and 090. Each gets the CCH bands, a `.x00` exit, the CCH parameters and the success codes `ACSC` and `ACCC`. Every parameter is written out, because the rules do not apply their own defaults at run time. The previous configurations are backed up | 07:52 |
| 3 | **Added a zero weight** to the standard typology for each of the 21 outcomes it had no weight for. No other weight, threshold or routing changed. The previous typology is backed up | 08:23 |


## End-to-end verification

### How we tested

All five captured DRPP corridors had already been used on UAT, and the platform discards a payment it has seen before. So we took the captured ZMW → MWK payment (20 Kafka records: party lookup, FX quote, quote, FX transfer and transfer) and replaced every identifier with a new one. That covers the transfer, quote, conversion and message IDs, including those inside the encoded ILP packets. Nothing else changed. We fed the result onto the test cluster's audit topic at 08:34:47 UTC, the same input MLA reads in production.

The new payment is transfer `01M4T6AXW1WV1H3QG1H2FPYHVM`, and its status message is `01M4T6EG4XQM7VN0KQ3S9VC1Y5`.

| Stage | Result |
| --- | --- |
| MLA → PPA | 8 of 8 events forwarded: the request and callback for each of the quote, FX quote, transfer and FX transfer |
| PPA → Tazama | 4 of 4 ISO 20022 messages accepted: `pain.001`, `pain.013`, `pacs.008` and `pacs.002` |
| Tazama | Evaluation written about 0.2 seconds after PPA created the `pacs.002`. All 30 rules and the flow processor reported |

Times recorded by Tazama come from the UAT host's clock, which runs about 50 seconds fast.

### Evaluations before and after

Each row is the evaluation Tazama wrote for one payment's `pacs.002`, as stored in its `evaluation` table.

| Status message | Recorded (UTC) | Fixes in place | Rules with an outcome | `.err` | Score | Status |
| --- | --- | --- | --- | --- | --- | --- |
| `01M4RABQ3RZCSRD5FR6KJ7SKP1` | 12 Oct 15:05 | None | 0 | 30 | 0 | NALT |
| `01M4T2RRQC53JHVET2NQMTFRHW` | 13 Oct 07:31 | Step 1 | 10 | 20 | 400 | ALRT |
| `01M4T4B52PT5BXGPD1XD1409QT` | 13 Oct 07:58 | Steps 1–2 | 27 | 3 | 0 | NALT |
| `01M4T6EG4XQM7VN0KQ3S9VC1Y5` | 13 Oct 08:35 | Steps 1–3 | 27 | 3 | 500 | ALRT |

- **07:31:** the rebinding alone let the 13 rules with an accepted configuration run. Ten of them returned an outcome; the other three (021, 024, 048) failed on missing parameters, which step 2 then supplied. The 400 came from standard weights on rules 025 and 030.
- **07:58:** the CCH configurations brought 27 rules to an outcome, but rule 016's new `.x00` had no weight, so the typology scored 0.
- **08:35:** with the weights complete, the typology scored every result.

### Rule results for the verified payment

The **Basis** column says how far each result can be relied on:

- **OK:** computed, and not affected by either of the two gaps in the executive summary.
- **No corridor:** the rule exits `.x00` on every message, because Tazama does not build the corridor key.
- **ACCC only:** the rule computed its result from history that leaves out `ACSC` settlements.
- **Blocked:** `.err`, for the reason given.

The **Metric** column is the value the rule computed. Tazama drops zero values in transit, so a stored blank reads as 0.

| Rule | Name | Config | Outcome | Meaning | Metric | Basis |
| --- | --- | --- | --- | --- | --- | --- |
| 001 | Derived account age - creditor | CCH | `.01` | First seen less than 1 day ago | 0 | ACCC only |
| 002 | Transaction convergence - debtor | CCH | `.01` | No convergence | 0 | ACCC only |
| 003 | Account dormancy - creditor | CCH | `.01` | Not dormant | 0 | ACCC only |
| 004 | Account dormancy - debtor | CCH | `.01` | Not dormant | 0 | ACCC only |
| 006 | Outgoing transfer similarity - amounts | Standard | `.x00` | Exit: insufficient history | 0 | ACCC only |
| 007 | Outgoing transfer similarity - descriptions | Standard | `.x00` | Exit: insufficient history | 0 | ACCC only |
| 008 | Outgoing transfer similarity - creditor | CCH | `.x00` | Exit: insufficient history | 0 | ACCC only |
| 010 | Increased account activity: volume - debtor | Standard | `.x00` | Exit: insufficient history | 0 | ACCC only |
| 011 | Increased account activity: volume - creditor | Standard | `.x00` | Exit: insufficient history | 0 | ACCC only |
| 016 | Transaction convergence - creditor | CCH | `.x00` | Exit: no corridor | 0 | No corridor; ACCC only |
| 017 | Transaction divergence - debtor | CCH | `.01` | No divergence | 0 | ACCC only |
| 018 | Exceptionally large outgoing transfer - debtor | Standard | `.x01` | Exit: no same-currency history | 0 | OK |
| 020 | Large transaction amount vs history - creditor | Standard | `.x00` | Exit: no corridor | 0 | No corridor |
| 021 | A large number of similar transaction amounts - creditor | CCH | `.x00` | Exit: insufficient history | 0 | OK |
| 024 | Non-commissioned transaction mirroring - creditor | CCH | `.x00` | Exit: insufficient history | 0 | OK |
| 025 | Non-commissioned transaction mirroring - debtor | Standard | `.01` | No mirror match. The standard band `.01` covers values below 2 and is labelled "mirroring detected" | 0 | OK |
| 026 | Commissioned transaction mirroring - creditor | CCH | `.x00` | Exit: insufficient history | 0 | OK |
| 027 | Commissioned transaction mirroring - debtor | CCH | `.01` | No commissioned mirroring | 0 | OK |
| 030 | Transfer to unfamiliar creditor account - debtor | Standard | `.02` | Second or later payment from this debtor to this creditor | 3 | OK |
| 044 | Successful transactions from the debtor | CCH | `.01` | Little history | 4 | OK |
| 045 | Successful transactions to the creditor | CCH | `.01` | Little history | 3 | OK |
| 048 | Large transaction amount vs history - debtor | CCH | `.x00` | Exit: no corridor | 0 | No corridor |
| 054 | Synthetic data check - Benford's Law - debtor | Standard | `.x00` | Exit: no corridor | 0 | No corridor; ACCC only |
| 063 | Synthetic data check - Benford's Law - creditor | Standard | `.x00` | Exit: no corridor | 0 | No corridor; ACCC only |
| 076 | Time since last transaction - debtor | CCH | `.err` | `PrcgDt.DtTm is absent` | — | Blocked: Tazama's transport drops the field |
| 078 | Transaction type | Standard | `.err` | Configuration rejected | — | Blocked: `purposeCodeToCaseMap` needed |
| 083 | Multiple accounts associated with a debtor | CCH | `.01` | One account | 0 | OK, interim identity resolution |
| 084 | Multiple accounts associated with a creditor | CCH | `.01` | One account | 0 | OK, interim identity resolution |
| 090 | Upstream transaction divergence - debtor | CCH | `.01` | Low branching factor | 1 | OK |
| 091 | Transaction amount vs regulatory threshold | Standard | `.err` | Configuration rejected | — | Blocked: `corridorThreshold` needed |

In total, 12 rules are OK, 10 are ACCC only, 5 have no corridor and 3 are blocked. Three of the no-corridor rules (016, 054 and 063) also count only `ACCC` history, so 13 rules are affected by that gap in all.

"Standard" means Tazama's 4.0.0 configuration. It is still loaded for the 12 rules without a CCH configuration: 078 and 091 reject it, and the other 10 run on it.

The `.x00` exits marked "insufficient history" are expected. The test parties have only a few earlier test payments behind them.

### Typology score

The typology `000@4.0.0` scored 500 against an alert threshold of 220, so the evaluation is ALRT. Every one of the 31 results had a configured weight, and the score is exactly their sum:

| Rule | Outcome | Weight |
| --- | --- | --- |
| 025 | `.01` | 200 |
| 027 | `.01` | 200 |
| 030 | `.02` | 100 |
| Other 28 | — | 0 |
| **Total** | | **500** |

This proves the scoring path works: every rule reports, every outcome is weighted, and the score is computed, not zeroed. It is not a fraud signal. In substance, 025 and 027 both found no mirroring. They carry 200 each only because the standard typology weights `.01` for the standard bands. 030 is a repeat payment to the same creditor, which is true because the same test parties were used in earlier runs.


## Appendix: verified evaluation record

The evaluation Tazama wrote for the verified payment, exactly as stored in its `evaluation` table. It holds the network map it was scored against, the `pacs.002` with the transaction data Tazama attached, and every rule and typology result.

Status `ALRT`, written 2026-10-13T08:35:44.616Z; 31 rule results, 3 of them `.err`; typology score 500.

```json
{
  "report": {
    "status": "ALRT",
    "metaData": {
      "prcgTmDP": 4843940,
      "prcgTmED": 389637
    },
    "timestamp": "2026-10-13T08:35:44.616Z",
    "tadpResult": {
      "id": "004@4.0.0",
      "cfg": "4.0.0",
      "prcgTm": 1979326,
      "typologyResult": [
        {
          "id": "typology-processor",
          "cfg": "000@4.0.0",
          "prcgTm": 19417169,
          "result": 500,
          "review": true,
          "tenantId": "DEFAULT",
          "workflow": {
            "flowProcessor": "EFRuP@4.0.0",
            "alertThreshold": 220,
            "interdictionThreshold": 260
          },
          "ruleResults": [
            {
              "id": "048@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 82734712,
              "tenantId": "DEFAULT",
              "subRuleRef": ".x00",
              "indpdntVarbl": 0
            },
            {
              "id": "076@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 83178755,
              "reason": "PrcgDt.DtTm is absent",
              "tenantId": "DEFAULT",
              "subRuleRef": ".err",
              "indpdntVarbl": 0
            },
            {
              "id": "024@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 112676414,
              "tenantId": "DEFAULT",
              "subRuleRef": ".x00",
              "indpdntVarbl": 0
            },
            {
              "id": "083@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 122948426,
              "tenantId": "DEFAULT",
              "subRuleRef": ".01",
              "indpdntVarbl": 0
            },
            {
              "id": "054@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 78843658,
              "tenantId": "DEFAULT",
              "subRuleRef": ".x00",
              "indpdntVarbl": 0
            },
            {
              "id": "010@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 93848380,
              "tenantId": "DEFAULT",
              "subRuleRef": ".x00",
              "indpdntVarbl": 0
            },
            {
              "id": "016@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 40813109,
              "tenantId": "DEFAULT",
              "subRuleRef": ".x00",
              "indpdntVarbl": 0
            },
            {
              "id": "084@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 104088755,
              "tenantId": "DEFAULT",
              "subRuleRef": ".01",
              "indpdntVarbl": 0
            },
            {
              "id": "091@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 53635040,
              "reason": "Error while getting rule configuration",
              "tenantId": "DEFAULT",
              "subRuleRef": ".err",
              "indpdntVarbl": 0
            },
            {
              "id": "045@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 113518661,
              "tenantId": "DEFAULT",
              "subRuleRef": ".01",
              "indpdntVarbl": 3
            },
            {
              "id": "007@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 118639993,
              "tenantId": "DEFAULT",
              "subRuleRef": ".x00",
              "indpdntVarbl": 0
            },
            {
              "id": "006@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 137137083,
              "tenantId": "DEFAULT",
              "subRuleRef": ".x00",
              "indpdntVarbl": 0
            },
            {
              "id": "026@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 130160900,
              "tenantId": "DEFAULT",
              "subRuleRef": ".x00",
              "indpdntVarbl": 0
            },
            {
              "id": "090@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 106097088,
              "tenantId": "DEFAULT",
              "subRuleRef": ".01",
              "indpdntVarbl": 1
            },
            {
              "id": "030@4.0.0",
              "cfg": "4.0.0",
              "wght": 100,
              "prcgTm": 129111761,
              "tenantId": "DEFAULT",
              "subRuleRef": ".02",
              "indpdntVarbl": 3
            },
            {
              "id": "008@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 133259015,
              "tenantId": "DEFAULT",
              "subRuleRef": ".x00",
              "indpdntVarbl": 0
            },
            {
              "id": "011@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 98475569,
              "tenantId": "DEFAULT",
              "subRuleRef": ".x00",
              "indpdntVarbl": 0
            },
            {
              "id": "003@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 75466429,
              "tenantId": "DEFAULT",
              "subRuleRef": ".01",
              "indpdntVarbl": 0
            },
            {
              "id": "044@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 119667683,
              "tenantId": "DEFAULT",
              "subRuleRef": ".01",
              "indpdntVarbl": 4
            },
            {
              "id": "063@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 36687980,
              "tenantId": "DEFAULT",
              "subRuleRef": ".x00",
              "indpdntVarbl": 0
            },
            {
              "id": "078@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 74908306,
              "reason": "Error while getting rule configuration",
              "tenantId": "DEFAULT",
              "subRuleRef": ".err",
              "indpdntVarbl": 0
            },
            {
              "id": "021@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 131271547,
              "tenantId": "DEFAULT",
              "subRuleRef": ".x00",
              "indpdntVarbl": 0
            },
            {
              "id": "027@4.0.0",
              "cfg": "4.0.0",
              "wght": 200,
              "prcgTm": 120814626,
              "tenantId": "DEFAULT",
              "subRuleRef": ".01",
              "indpdntVarbl": 0
            },
            {
              "id": "020@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 62244494,
              "tenantId": "DEFAULT",
              "subRuleRef": ".x00",
              "indpdntVarbl": 0
            },
            {
              "id": "002@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 91207356,
              "tenantId": "DEFAULT",
              "subRuleRef": ".01",
              "indpdntVarbl": 0
            },
            {
              "id": "004@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 115063155,
              "tenantId": "DEFAULT",
              "subRuleRef": ".01",
              "indpdntVarbl": 0
            },
            {
              "id": "017@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 130559705,
              "tenantId": "DEFAULT",
              "subRuleRef": ".01",
              "indpdntVarbl": 0
            },
            {
              "id": "025@4.0.0",
              "cfg": "4.0.0",
              "wght": 200,
              "prcgTm": 109097208,
              "tenantId": "DEFAULT",
              "subRuleRef": ".01",
              "indpdntVarbl": 0
            },
            {
              "id": "001@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 136170127,
              "tenantId": "DEFAULT",
              "subRuleRef": ".01",
              "indpdntVarbl": 0
            },
            {
              "id": "018@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 112416245,
              "tenantId": "DEFAULT",
              "subRuleRef": ".x01",
              "indpdntVarbl": 0
            },
            {
              "id": "EFRuP@4.0.0",
              "cfg": "none",
              "wght": 0,
              "prcgTm": 1229500,
              "tenantId": "DEFAULT",
              "subRuleRef": "none",
              "indpdntVarbl": 0
            }
          ]
        }
      ]
    },
    "evaluationID": "01a13467-4168-75b9-bf67-1021285b68fa"
  },
  "dataCache": {
    "cdtrId": "+265881234567MSISDN",
    "dbtrId": "+260976001234MSISDN",
    "creDtTm": "2026-10-13T08:35:44.106Z",
    "instdAmt": {
      "amt": 10,
      "ccy": "ZMW"
    },
    "xchgRate": 0.019455252918287938,
    "cdtrAcctId": "+265881234567MSISDNtest-mwk-dfsp",
    "dbtrAcctId": "+260976001234MSISDNtest-zmw-dfsp",
    "intrBkSttlmAmt": {
      "amt": 514,
      "ccy": "MWK"
    }
  },
  "networkMap": {
    "cfg": "4.0.0",
    "active": true,
    "messages": [
      {
        "id": "004@4.0.0",
        "cfg": "4.0.0",
        "txTp": "pacs.002.001.12",
        "typologies": [
          {
            "id": "typology-processor",
            "cfg": "000@4.0.0",
            "rules": [
              {
                "id": "001@4.0.0",
                "cfg": "4.0.0"
              },
              {
                "id": "002@4.0.0",
                "cfg": "4.0.0"
              },
              {
                "id": "003@4.0.0",
                "cfg": "4.0.0"
              },
              {
                "id": "004@4.0.0",
                "cfg": "4.0.0"
              },
              {
                "id": "006@4.0.0",
                "cfg": "4.0.0"
              },
              {
                "id": "007@4.0.0",
                "cfg": "4.0.0"
              },
              {
                "id": "008@4.0.0",
                "cfg": "4.0.0"
              },
              {
                "id": "010@4.0.0",
                "cfg": "4.0.0"
              },
              {
                "id": "011@4.0.0",
                "cfg": "4.0.0"
              },
              {
                "id": "016@4.0.0",
                "cfg": "4.0.0"
              },
              {
                "id": "017@4.0.0",
                "cfg": "4.0.0"
              },
              {
                "id": "018@4.0.0",
                "cfg": "4.0.0"
              },
              {
                "id": "020@4.0.0",
                "cfg": "4.0.0"
              },
              {
                "id": "021@4.0.0",
                "cfg": "4.0.0"
              },
              {
                "id": "024@4.0.0",
                "cfg": "4.0.0"
              },
              {
                "id": "025@4.0.0",
                "cfg": "4.0.0"
              },
              {
                "id": "026@4.0.0",
                "cfg": "4.0.0"
              },
              {
                "id": "027@4.0.0",
                "cfg": "4.0.0"
              },
              {
                "id": "030@4.0.0",
                "cfg": "4.0.0"
              },
              {
                "id": "044@4.0.0",
                "cfg": "4.0.0"
              },
              {
                "id": "045@4.0.0",
                "cfg": "4.0.0"
              },
              {
                "id": "048@4.0.0",
                "cfg": "4.0.0"
              },
              {
                "id": "054@4.0.0",
                "cfg": "4.0.0"
              },
              {
                "id": "063@4.0.0",
                "cfg": "4.0.0"
              },
              {
                "id": "076@4.0.0",
                "cfg": "4.0.0"
              },
              {
                "id": "078@4.0.0",
                "cfg": "4.0.0"
              },
              {
                "id": "083@4.0.0",
                "cfg": "4.0.0"
              },
              {
                "id": "084@4.0.0",
                "cfg": "4.0.0"
              },
              {
                "id": "090@4.0.0",
                "cfg": "4.0.0"
              },
              {
                "id": "091@4.0.0",
                "cfg": "4.0.0"
              },
              {
                "id": "EFRuP@4.0.0",
                "cfg": "none"
              }
            ]
          }
        ]
      }
    ],
    "tenantId": "DEFAULT"
  },
  "transaction": {
    "TxTp": "pacs.002.001.12",
    "TenantId": "DEFAULT",
    "DataCache": {
      "cdtrId": "+265881234567MSISDN",
      "dbtrId": "+260976001234MSISDN",
      "creDtTm": "2026-10-13T08:35:44.106Z",
      "instdAmt": {
        "amt": 10,
        "ccy": "ZMW"
      },
      "xchgRate": 0.019455252918287938,
      "cdtrAcctId": "+265881234567MSISDNtest-mwk-dfsp",
      "dbtrAcctId": "+260976001234MSISDNtest-zmw-dfsp",
      "intrBkSttlmAmt": {
        "amt": 514,
        "ccy": "MWK"
      }
    },
    "FIToFIPmtSts": {
      "GrpHdr": {
        "MsgId": "01M4T6EG4XQM7VN0KQ3S9VC1Y5",
        "CreDtTm": "2026-10-13T08:35:44.413Z"
      },
      "TxInfAndSts": {
        "TxSts": "ACSC",
        "ChrgsInf": [
          {
            "Agt": {
              "FinInstnId": {
                "ClrSysMmbId": {
                  "MmbId": "test-mwk-dfsp"
                }
              }
            },
            "Amt": {
              "Amt": 0,
              "Ccy": "MWK"
            }
          }
        ],
        "InstdAgt": {
          "FinInstnId": {
            "ClrSysMmbId": {
              "MmbId": "test-zmw-dfsp"
            }
          }
        },
        "InstgAgt": {
          "FinInstnId": {
            "ClrSysMmbId": {
              "MmbId": "test-mwk-dfsp"
            }
          }
        },
        "AccptncDtTm": "2026-08-11T15:10:55.445Z",
        "OrgnlInstrId": "01M4T6AXW1WV1H3QG1H2FPYHVM",
        "OrgnlEndToEndId": "01M4T6AXW1WV1H3QG1H2FPYHVM"
      }
    }
  },
  "transactionID": "01M4T6EG4XQM7VN0KQ3S9VC1Y5"
}
```

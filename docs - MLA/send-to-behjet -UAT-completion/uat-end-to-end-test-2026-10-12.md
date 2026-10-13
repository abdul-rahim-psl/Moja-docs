# UAT End-to-End Test: MLA → PPA → Tazama

## Contents

- [How we tested](#how-we-tested)
- [Rule errors](#rule-errors)
- [How we will fix it](#how-we-will-fix-it)
  - [Decisions needed](#decisions-needed)
- [Appendix: CCH evaluation records](#appendix-cch-evaluation-records)
  - [1. EGP → ETB, message 01M4RA8MXDVX93Y10B768MMRQN](#1-egp--etb-message-01m4ra8mxdvx93y10b768mmrqn)
  - [2. EGP → MUR, message 01M4RA8V4FVF10JGW2DVZ16WPS](#2-egp--mur-message-01m4ra8v4fvf10jgw2dvz16wps)
  - [3. EGP → KES, message 01M4RA8VFBJTHYV7KQFFD1ZK9T](#3-egp--kes-message-01m4ra8vfbjthyv7kqffd1zk9t)
  - [4. EGP → UGX, message 01M4RA8ZEV9275PZY7G9G1MH05](#4-egp--ugx-message-01m4ra8zev9275pzy7g9g1mh05)

**Date:** 2026-10-12. **Environment:** UAT.

A real cross-border payment travelled the whole path, from Mojaloop's audit stream to a stored Tazama evaluation, and MLA and PPA did their part correctly. The Tazama rules still need two changes, a message-type binding and their CCH configurations, before the evaluation holds a real fraud assessment.

## How we tested

We replayed a real DRPP payment through the production components and checked every hop against its own evidence.

1. **We replayed a real payment.** A captured DRPP corridor (ZMW → MWK, one quote, one FX conversion and one transfer: 20 Kafka records) was fed onto the test cluster's audit topic. That topic is the same input MLA reads in production.
2. **MLA did its job.** It selected the 8 events that matter (the request and callback for each of the quote, FX quote, transfer and FX transfer), tokenized personal data, and delivered each one to PPA as an Event Envelope over TLS. PPA accepted all 8.
3. **PPA did its job.** It stored each envelope and linked the FX legs to the payment. It then translated the payment into the four ISO 20022 messages Tazama expects (`pain.001`, `pain.013`, `pacs.008` and `pacs.002`) and submitted them to Tazama's TMS. TMS accepted all 4.
4. **Tazama processed the payment.** The `pacs.002` went through all 30 configured rules and the typology, and the adjudicator wrote the evaluation record about 5 seconds after the message arrived.

| Stage | Result |
| --- | --- |
| MLA → PPA | 8 of 8 events delivered and accepted |
| PPA → Tazama | 4 of 4 ISO 20022 messages accepted by TMS |
| Tazama pipeline | Evaluation record written; all 30 rules and the flow processor reported |

CCH's own traffic now reaches Tazama the same way: four CCH transactions were evaluated the same afternoon.

Two Tazama-side settings were corrected during setup. PPA's login to Tazama's identity service needed its password updated. Tazama's typology processor and adjudicator needed a restart to load the current network map.

## Rule errors

The evaluation record exists, but **every rule returned `.err`**, so its score of 0 reflects errors rather than an assessment. Each rule reported one of two errors:

- **"Unsupported transaction type":** the rule rejected the message. The rules are bound to `pacs.002.001.15` (rule 010 to `pacs.008.001.10`), but the platform carries the status message as `pacs.002.001.12`. PPA sends it, TMS accepts it and Tazama stores it under that version.
- **"Error while getting rule configuration":** the rule's own configuration check rejected the configuration loaded in Tazama. That configuration is still Tazama's standard one, not the CCH values. These rules also have the binding issue above, but the configuration check runs first.

| Rule | Name | Error returned | Cause | Fix |
| --- | --- | --- | --- | --- |
| 001 | Derived account age - creditor | Error while getting rule configuration | No `.x00` exit condition in config | Rebind + config |
| 002 | Transaction convergence - debtor | Error while getting rule configuration | No `.x00` exit condition in config | Rebind + config |
| 003 | Account dormancy - creditor | Error while getting rule configuration | No `.x00` exit condition in config | Rebind + config |
| 004 | Account dormancy - debtor | Error while getting rule configuration | No `.x00` exit condition in config | Rebind + config |
| 006 | Outgoing transfer similarity - amounts | Unsupported transaction type | Bound to `pacs.002.001.15` | Rebind |
| 007 | Outgoing transfer similarity - descriptions | Unsupported transaction type | Bound to `pacs.002.001.15` | Rebind |
| 008 | Outgoing transfer similarity - creditor | Error while getting rule configuration | `identityResolutionRule` not set | Rebind + business value |
| 010 | Increased account activity: volume - debtor | Unsupported transaction type | Bound to `pacs.008.001.10` | Rebind |
| 011 | Increased account activity: volume - creditor | Unsupported transaction type | Bound to `pacs.002.001.15` | Rebind |
| 016 | Transaction convergence - creditor | Error while getting rule configuration | No `.x00` exit condition in config | Rebind + config |
| 017 | Transaction divergence - debtor | Error while getting rule configuration | No `.x00` exit condition in config | Rebind + config |
| 018 | Exceptionally large outgoing transfer - debtor | Unsupported transaction type | Bound to `pacs.002.001.15` | Rebind |
| 020 | Large transaction amount vs history - creditor | Unsupported transaction type | Bound to `pacs.002.001.15` | Rebind |
| 021 | A large number of similar transaction amounts - creditor | Unsupported transaction type | Bound to `pacs.002.001.15` | Rebind |
| 024 | Non-commissioned transaction mirroring - creditor | Unsupported transaction type | Bound to `pacs.002.001.15` | Rebind |
| 025 | Non-commissioned transaction mirroring - debtor | Unsupported transaction type | Bound to `pacs.002.001.15` | Rebind |
| 026 | Commissioned transaction mirroring - creditor | Error while getting rule configuration | `commissionBasis` must be `settlementAmount` | Rebind + config |
| 027 | Commissioned transaction mirroring - debtor | Error while getting rule configuration | `commissionBasis` must be `settlementAmount` | Rebind + config |
| 030 | Transfer to unfamiliar creditor account - debtor | Unsupported transaction type | Bound to `pacs.002.001.15` | Rebind |
| 044 | Successful transactions from the debtor | Error while getting rule configuration | No `.x00` exit condition in config | Rebind + config |
| 045 | Successful transactions to the creditor | Error while getting rule configuration | No `.x00` exit condition in config | Rebind + config |
| 048 | Large transaction amount vs history - debtor | Unsupported transaction type | Bound to `pacs.002.001.15` | Rebind |
| 054 | Synthetic data check - Benford's Law - debtor | Unsupported transaction type | Bound to `pacs.002.001.15` | Rebind |
| 063 | Synthetic data check - Benford's Law - creditor | Unsupported transaction type | Bound to `pacs.002.001.15` | Rebind |
| 076 | Time since last transaction - debtor | Error while getting rule configuration | No `.x00` exit condition in config; also reads `PrcgDt.DtTm`, which Tazama's transport drops | Rebind + config + decision |
| 078 | Transaction type | Error while getting rule configuration | `purposeCodeToCaseMap` not set; no `.x00` exit condition | Rebind + business value |
| 083 | Multiple accounts associated with a debtor | Error while getting rule configuration | `identityResolutionRule` not set; no `.x00` exit condition | Rebind + business value |
| 084 | Multiple accounts associated with a creditor | Error while getting rule configuration | `identityResolutionRule` not set; no `.x00` exit condition | Rebind + business value |
| 090 | Upstream transaction divergence - debtor | Error while getting rule configuration | No `.x00` exit condition in config | Rebind + config |
| 091 | Transaction amount vs regulatory threshold | Error while getting rule configuration | `corridorThreshold` not set | Rebind + business value |

In total, 13 rules failed on the binding alone and 17 on configuration. All 30 need the rebinding.

## How we will fix it

| Step | What | Fixes | Status |
| --- | --- | --- | --- |
| 1 | Rebind all 30 rules to `pacs.002.001.12`: the message check and the history queries | All 13 "Unsupported transaction type" errors, and the binding issue behind the other 17 | Code changes ready for all 30 rules. They build, and all 1,026 unit tests and lint pass. Next: rebuild and redeploy the rule images |
| 2 | Load the CCH rule configurations from the Developer Configuration Guide | 12 configuration errors: the `.x00` exit condition for 001, 002, 003, 004, 016, 017, 044, 045, 076 and 090, and `commissionBasis` for 026 and 027 | Ready to draft |
| 3 | Load the business values that have no safe default | The last 5 configuration errors: 008, 078, 083, 084, 091 | Waiting on the values (see below) |
| 4 | Load the CCH typology weights | Without them the typology scores 0, because the CCH rules return outcomes the standard typology has no weights for | Ready to draft |
| 5 | Re-run a fresh payment end to end | Confirms each rule returns a real outcome, at every step from the rule to the evaluation status | After steps 1–4 |

MLA and PPA need no change for any of these steps.

### Decisions needed

- **Business values for five rules:** `identityResolutionRule` (008, 083, 084), `purposeCodeToCaseMap` (078) and `corridorThreshold` (091).
- **The binding version:** confirm `pacs.002.001.12` as the binding, and update the CCH FRMS Addendum §1.1, which names `pacs.002.001.15`.
- **Rule 076:** `TxInfAndSts.PrcgDt.DtTm` does not survive Tazama's internal transport, so the rule cannot read it. The options are a Tazama platform change or a different timestamp source for this rule.

## Appendix: CCH evaluation records

The four evaluation records Tazama wrote for CCH's own transactions on 2026-10-12, exactly as stored in its `evaluation` table. Each holds the network map it was scored against, the `pacs.002` with the transaction data Tazama attached, and every rule result.

### 1. EGP → ETB, message 01M4RA8MXDVX93Y10B768MMRQN

Status `NALT`, written 2026-10-12T15:03:58.302Z; 31 rule results, 30 of them `.err`.

```json
{
  "report": {
    "status": "NALT",
    "timestamp": "2026-10-12T15:03:58.302Z",
    "tadpResult": {
      "id": "004@4.0.0",
      "cfg": "4.0.0",
      "prcgTm": 4492650,
      "typologyResult": [
        {
          "id": "typology-processor",
          "cfg": "000@4.0.0",
          "prcgTm": 24874032,
          "result": 0,
          "review": false,
          "tenantId": "DEFAULT",
          "workflow": {
            "flowProcessor": "EFRuP@4.0.0",
            "alertThreshold": 220,
            "interdictionThreshold": 260
          },
          "ruleResults": [
            {
              "id": "026@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 42603049,
              "reason": "Error while getting rule configuration",
              "tenantId": "DEFAULT",
              "subRuleRef": ".err",
              "indpdntVarbl": 0
            },
            {
              "id": "020@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 835810,
              "reason": "Unsupported transaction type",
              "tenantId": "DEFAULT",
              "subRuleRef": ".err",
              "indpdntVarbl": 0
            },
            {
              "id": "025@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 1046553,
              "reason": "Unsupported transaction type",
              "tenantId": "DEFAULT",
              "subRuleRef": ".err",
              "indpdntVarbl": 0
            },
            {
              "id": "EFRuP@4.0.0",
              "cfg": "none",
              "wght": 0,
              "prcgTm": 5114249,
              "tenantId": "DEFAULT",
              "subRuleRef": "none",
              "indpdntVarbl": 0
            },
            {
              "id": "008@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 42453187,
              "reason": "Error while getting rule configuration",
              "tenantId": "DEFAULT",
              "subRuleRef": ".err",
              "indpdntVarbl": 0
            },
            {
              "id": "045@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 29521366,
              "reason": "Error while getting rule configuration",
              "tenantId": "DEFAULT",
              "subRuleRef": ".err",
              "indpdntVarbl": 0
            },
            {
              "id": "024@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 1023576,
              "reason": "Unsupported transaction type",
              "tenantId": "DEFAULT",
              "subRuleRef": ".err",
              "indpdntVarbl": 0
            },
            {
              "id": "001@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 36452673,
              "reason": "Error while getting rule configuration",
              "tenantId": "DEFAULT",
              "subRuleRef": ".err",
              "indpdntVarbl": 0
            },
            {
              "id": "003@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 46734543,
              "reason": "Error while getting rule configuration",
              "tenantId": "DEFAULT",
              "subRuleRef": ".err",
              "indpdntVarbl": 0
            },
            {
              "id": "018@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 946967,
              "reason": "Unsupported transaction type",
              "tenantId": "DEFAULT",
              "subRuleRef": ".err",
              "indpdntVarbl": 0
            },
            {
              "id": "017@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 59830986,
              "reason": "Error while getting rule configuration",
              "tenantId": "DEFAULT",
              "subRuleRef": ".err",
              "indpdntVarbl": 0
            },
            {
              "id": "021@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 976318,
              "reason": "Unsupported transaction type",
              "tenantId": "DEFAULT",
              "subRuleRef": ".err",
              "indpdntVarbl": 0
            },
            {
              "id": "010@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 825705,
              "reason": "Unsupported transaction type",
              "tenantId": "DEFAULT",
              "subRuleRef": ".err",
              "indpdntVarbl": 0
            },
            {
              "id": "083@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 22642221,
              "reason": "Error while getting rule configuration",
              "tenantId": "DEFAULT",
              "subRuleRef": ".err",
              "indpdntVarbl": 0
            },
            {
              "id": "002@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 65537393,
              "reason": "Error while getting rule configuration",
              "tenantId": "DEFAULT",
              "subRuleRef": ".err",
              "indpdntVarbl": 0
            },
            {
              "id": "091@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 39494062,
              "reason": "Error while getting rule configuration",
              "tenantId": "DEFAULT",
              "subRuleRef": ".err",
              "indpdntVarbl": 0
            },
            {
              "id": "011@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 877159,
              "reason": "Unsupported transaction type",
              "tenantId": "DEFAULT",
              "subRuleRef": ".err",
              "indpdntVarbl": 0
            },
            {
              "id": "004@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 61391317,
              "reason": "Error while getting rule configuration",
              "tenantId": "DEFAULT",
              "subRuleRef": ".err",
              "indpdntVarbl": 0
            },
            {
              "id": "007@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 827038,
              "reason": "Unsupported transaction type",
              "tenantId": "DEFAULT",
              "subRuleRef": ".err",
              "indpdntVarbl": 0
            },
            {
              "id": "090@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 41818895,
              "reason": "Error while getting rule configuration",
              "tenantId": "DEFAULT",
              "subRuleRef": ".err",
              "indpdntVarbl": 0
            },
            {
              "id": "078@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 23003002,
              "reason": "Error while getting rule configuration",
              "tenantId": "DEFAULT",
              "subRuleRef": ".err",
              "indpdntVarbl": 0
            },
            {
              "id": "054@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 1118827,
              "reason": "Unsupported transaction type",
              "tenantId": "DEFAULT",
              "subRuleRef": ".err",
              "indpdntVarbl": 0
            },
            {
              "id": "006@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 988155,
              "reason": "Unsupported transaction type",
              "tenantId": "DEFAULT",
              "subRuleRef": ".err",
              "indpdntVarbl": 0
            },
            {
              "id": "027@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 28699322,
              "reason": "Error while getting rule configuration",
              "tenantId": "DEFAULT",
              "subRuleRef": ".err",
              "indpdntVarbl": 0
            },
            {
              "id": "076@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 36023904,
              "reason": "Error while getting rule configuration",
              "tenantId": "DEFAULT",
              "subRuleRef": ".err",
              "indpdntVarbl": 0
            },
            {
              "id": "084@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 26746783,
              "reason": "Error while getting rule configuration",
              "tenantId": "DEFAULT",
              "subRuleRef": ".err",
              "indpdntVarbl": 0
            },
            {
              "id": "044@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 31061040,
              "reason": "Error while getting rule configuration",
              "tenantId": "DEFAULT",
              "subRuleRef": ".err",
              "indpdntVarbl": 0
            },
            {
              "id": "030@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 1044867,
              "reason": "Unsupported transaction type",
              "tenantId": "DEFAULT",
              "subRuleRef": ".err",
              "indpdntVarbl": 0
            },
            {
              "id": "063@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 1104237,
              "reason": "Unsupported transaction type",
              "tenantId": "DEFAULT",
              "subRuleRef": ".err",
              "indpdntVarbl": 0
            },
            {
              "id": "048@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 1137555,
              "reason": "Unsupported transaction type",
              "tenantId": "DEFAULT",
              "subRuleRef": ".err",
              "indpdntVarbl": 0
            },
            {
              "id": "016@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 30417418,
              "reason": "Error while getting rule configuration",
              "tenantId": "DEFAULT",
              "subRuleRef": ".err",
              "indpdntVarbl": 0
            }
          ]
        }
      ]
    },
    "evaluationID": "01a130a4-545e-7446-ac1b-a3f15cb6acd1"
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
      "cdtrId": "251092001MSISDN",
      "dbtrId": "201901001MSISDN",
      "creDtTm": "2026-10-12T15:03:31.163Z",
      "instdAmt": {
        "amt": 41,
        "ccy": "EGP"
      },
      "xchgRate": 0.5694444444444444,
      "cdtrAcctId": "251092001MSISDNtest-etb-dfsp",
      "dbtrAcctId": "201901001MSISDNtest-egp-dfsp",
      "intrBkSttlmAmt": {
        "amt": 72,
        "ccy": "ETB"
      }
    },
    "FIToFIPmtSts": {
      "GrpHdr": {
        "MsgId": "01M4RA8MXDVX93Y10B768MMRQN",
        "CreDtTm": "2026-10-12T15:03:58.126Z"
      },
      "TxInfAndSts": {
        "TxSts": "ACSC",
        "ChrgsInf": [
          {
            "Agt": {
              "FinInstnId": {
                "ClrSysMmbId": {
                  "MmbId": "test-etb-dfsp"
                }
              }
            },
            "Amt": {
              "Amt": 0,
              "Ccy": "ETB"
            }
          }
        ],
        "InstdAgt": {
          "FinInstnId": {
            "ClrSysMmbId": {
              "MmbId": "test-egp-dfsp"
            }
          }
        },
        "InstgAgt": {
          "FinInstnId": {
            "ClrSysMmbId": {
              "MmbId": "test-etb-dfsp"
            }
          }
        },
        "AccptncDtTm": "2026-10-12T15:02:46.271Z",
        "OrgnlInstrId": "01M4RA40XE7HB8DB57F4RXWHGY",
        "OrgnlEndToEndId": "01M4RA40XE7HB8DB57F4RXWHGY"
      }
    }
  },
  "transactionID": "01M4RA8MXDVX93Y10B768MMRQN"
}
```

### 2. EGP → MUR, message 01M4RA8V4FVF10JGW2DVZ16WPS

Status `NALT`, written 2026-10-12T15:04:04.608Z; 31 rule results, 30 of them `.err`.

```json
{
  "report": {
    "status": "NALT",
    "timestamp": "2026-10-12T15:04:04.608Z",
    "tadpResult": {
      "id": "004@4.0.0",
      "cfg": "4.0.0",
      "prcgTm": 3267254,
      "typologyResult": [
        {
          "id": "typology-processor",
          "cfg": "000@4.0.0",
          "prcgTm": 3676017,
          "result": 0,
          "review": false,
          "tenantId": "DEFAULT",
          "workflow": {
            "flowProcessor": "EFRuP@4.0.0",
            "alertThreshold": 220,
            "interdictionThreshold": 260
          },
          "ruleResults": [
            {
              "id": "044@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 16394452,
              "reason": "Error while getting rule configuration",
              "tenantId": "DEFAULT",
              "subRuleRef": ".err",
              "indpdntVarbl": 0
            },
            {
              "id": "011@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 355104,
              "reason": "Unsupported transaction type",
              "tenantId": "DEFAULT",
              "subRuleRef": ".err",
              "indpdntVarbl": 0
            },
            {
              "id": "045@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 9724697,
              "reason": "Error while getting rule configuration",
              "tenantId": "DEFAULT",
              "subRuleRef": ".err",
              "indpdntVarbl": 0
            },
            {
              "id": "084@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 13481928,
              "reason": "Error while getting rule configuration",
              "tenantId": "DEFAULT",
              "subRuleRef": ".err",
              "indpdntVarbl": 0
            },
            {
              "id": "003@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 12870066,
              "reason": "Error while getting rule configuration",
              "tenantId": "DEFAULT",
              "subRuleRef": ".err",
              "indpdntVarbl": 0
            },
            {
              "id": "002@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 10384807,
              "reason": "Error while getting rule configuration",
              "tenantId": "DEFAULT",
              "subRuleRef": ".err",
              "indpdntVarbl": 0
            },
            {
              "id": "076@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 13845555,
              "reason": "Error while getting rule configuration",
              "tenantId": "DEFAULT",
              "subRuleRef": ".err",
              "indpdntVarbl": 0
            },
            {
              "id": "063@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 596134,
              "reason": "Unsupported transaction type",
              "tenantId": "DEFAULT",
              "subRuleRef": ".err",
              "indpdntVarbl": 0
            },
            {
              "id": "048@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 637689,
              "reason": "Unsupported transaction type",
              "tenantId": "DEFAULT",
              "subRuleRef": ".err",
              "indpdntVarbl": 0
            },
            {
              "id": "EFRuP@4.0.0",
              "cfg": "none",
              "wght": 0,
              "prcgTm": 5826192,
              "tenantId": "DEFAULT",
              "subRuleRef": "none",
              "indpdntVarbl": 0
            },
            {
              "id": "020@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 402670,
              "reason": "Unsupported transaction type",
              "tenantId": "DEFAULT",
              "subRuleRef": ".err",
              "indpdntVarbl": 0
            },
            {
              "id": "030@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 599709,
              "reason": "Unsupported transaction type",
              "tenantId": "DEFAULT",
              "subRuleRef": ".err",
              "indpdntVarbl": 0
            },
            {
              "id": "090@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 18560299,
              "reason": "Error while getting rule configuration",
              "tenantId": "DEFAULT",
              "subRuleRef": ".err",
              "indpdntVarbl": 0
            },
            {
              "id": "006@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 331547,
              "reason": "Unsupported transaction type",
              "tenantId": "DEFAULT",
              "subRuleRef": ".err",
              "indpdntVarbl": 0
            },
            {
              "id": "078@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 15738538,
              "reason": "Error while getting rule configuration",
              "tenantId": "DEFAULT",
              "subRuleRef": ".err",
              "indpdntVarbl": 0
            },
            {
              "id": "021@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 332658,
              "reason": "Unsupported transaction type",
              "tenantId": "DEFAULT",
              "subRuleRef": ".err",
              "indpdntVarbl": 0
            },
            {
              "id": "054@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 628479,
              "reason": "Unsupported transaction type",
              "tenantId": "DEFAULT",
              "subRuleRef": ".err",
              "indpdntVarbl": 0
            },
            {
              "id": "007@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 377519,
              "reason": "Unsupported transaction type",
              "tenantId": "DEFAULT",
              "subRuleRef": ".err",
              "indpdntVarbl": 0
            },
            {
              "id": "004@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 11808054,
              "reason": "Error while getting rule configuration",
              "tenantId": "DEFAULT",
              "subRuleRef": ".err",
              "indpdntVarbl": 0
            },
            {
              "id": "016@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 17070633,
              "reason": "Error while getting rule configuration",
              "tenantId": "DEFAULT",
              "subRuleRef": ".err",
              "indpdntVarbl": 0
            },
            {
              "id": "024@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 316305,
              "reason": "Unsupported transaction type",
              "tenantId": "DEFAULT",
              "subRuleRef": ".err",
              "indpdntVarbl": 0
            },
            {
              "id": "010@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 354510,
              "reason": "Unsupported transaction type",
              "tenantId": "DEFAULT",
              "subRuleRef": ".err",
              "indpdntVarbl": 0
            },
            {
              "id": "091@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 14171455,
              "reason": "Error while getting rule configuration",
              "tenantId": "DEFAULT",
              "subRuleRef": ".err",
              "indpdntVarbl": 0
            },
            {
              "id": "018@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 338327,
              "reason": "Unsupported transaction type",
              "tenantId": "DEFAULT",
              "subRuleRef": ".err",
              "indpdntVarbl": 0
            },
            {
              "id": "001@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 19481562,
              "reason": "Error while getting rule configuration",
              "tenantId": "DEFAULT",
              "subRuleRef": ".err",
              "indpdntVarbl": 0
            },
            {
              "id": "083@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 14039291,
              "reason": "Error while getting rule configuration",
              "tenantId": "DEFAULT",
              "subRuleRef": ".err",
              "indpdntVarbl": 0
            },
            {
              "id": "026@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 17937450,
              "reason": "Error while getting rule configuration",
              "tenantId": "DEFAULT",
              "subRuleRef": ".err",
              "indpdntVarbl": 0
            },
            {
              "id": "008@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 13109938,
              "reason": "Error while getting rule configuration",
              "tenantId": "DEFAULT",
              "subRuleRef": ".err",
              "indpdntVarbl": 0
            },
            {
              "id": "027@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 6923760,
              "reason": "Error while getting rule configuration",
              "tenantId": "DEFAULT",
              "subRuleRef": ".err",
              "indpdntVarbl": 0
            },
            {
              "id": "017@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 3830891,
              "reason": "Error while getting rule configuration",
              "tenantId": "DEFAULT",
              "subRuleRef": ".err",
              "indpdntVarbl": 0
            },
            {
              "id": "025@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 344031,
              "reason": "Unsupported transaction type",
              "tenantId": "DEFAULT",
              "subRuleRef": ".err",
              "indpdntVarbl": 0
            }
          ]
        }
      ]
    },
    "evaluationID": "01a130a4-6d00-75ba-995e-47fa8e18ed54"
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
      "cdtrId": "23052001MSISDN",
      "dbtrId": "201901001MSISDN",
      "creDtTm": "2026-10-12T15:03:35.887Z",
      "instdAmt": {
        "amt": 61,
        "ccy": "EGP"
      },
      "xchgRate": 0.6559139784946236,
      "cdtrAcctId": "23052001MSISDNtest-mur-dfsp",
      "dbtrAcctId": "201901001MSISDNtest-egp-dfsp",
      "intrBkSttlmAmt": {
        "amt": 93,
        "ccy": "MUR"
      }
    },
    "FIToFIPmtSts": {
      "GrpHdr": {
        "MsgId": "01M4RA8V4FVF10JGW2DVZ16WPS",
        "CreDtTm": "2026-10-12T15:04:04.495Z"
      },
      "TxInfAndSts": {
        "TxSts": "ACSC",
        "ChrgsInf": [
          {
            "Agt": {
              "FinInstnId": {
                "ClrSysMmbId": {
                  "MmbId": "test-mur-dfsp"
                }
              }
            },
            "Amt": {
              "Amt": 0,
              "Ccy": "MUR"
            }
          }
        ],
        "InstdAgt": {
          "FinInstnId": {
            "ClrSysMmbId": {
              "MmbId": "test-egp-dfsp"
            }
          }
        },
        "InstgAgt": {
          "FinInstnId": {
            "ClrSysMmbId": {
              "MmbId": "test-mur-dfsp"
            }
          }
        },
        "AccptncDtTm": "2026-10-12T15:02:52.669Z",
        "OrgnlInstrId": "01M4RA40VQWPTR2PPRXEB7JCG5",
        "OrgnlEndToEndId": "01M4RA40VQWPTR2PPRXEB7JCG5"
      }
    }
  },
  "transactionID": "01M4RA8V4FVF10JGW2DVZ16WPS"
}
```

### 3. EGP → KES, message 01M4RA8VFBJTHYV7KQFFD1ZK9T

Status `NALT`, written 2026-10-12T15:04:04.945Z; 31 rule results, 30 of them `.err`.

```json
{
  "report": {
    "status": "NALT",
    "timestamp": "2026-10-12T15:04:04.945Z",
    "tadpResult": {
      "id": "004@4.0.0",
      "cfg": "4.0.0",
      "prcgTm": 2823863,
      "typologyResult": [
        {
          "id": "typology-processor",
          "cfg": "000@4.0.0",
          "prcgTm": 2641655,
          "result": 0,
          "review": false,
          "tenantId": "DEFAULT",
          "workflow": {
            "flowProcessor": "EFRuP@4.0.0",
            "alertThreshold": 220,
            "interdictionThreshold": 260
          },
          "ruleResults": [
            {
              "id": "063@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 309618,
              "reason": "Unsupported transaction type",
              "tenantId": "DEFAULT",
              "subRuleRef": ".err",
              "indpdntVarbl": 0
            },
            {
              "id": "026@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 12329786,
              "reason": "Error while getting rule configuration",
              "tenantId": "DEFAULT",
              "subRuleRef": ".err",
              "indpdntVarbl": 0
            },
            {
              "id": "030@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 435564,
              "reason": "Unsupported transaction type",
              "tenantId": "DEFAULT",
              "subRuleRef": ".err",
              "indpdntVarbl": 0
            },
            {
              "id": "044@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 13544541,
              "reason": "Error while getting rule configuration",
              "tenantId": "DEFAULT",
              "subRuleRef": ".err",
              "indpdntVarbl": 0
            },
            {
              "id": "054@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 348947,
              "reason": "Unsupported transaction type",
              "tenantId": "DEFAULT",
              "subRuleRef": ".err",
              "indpdntVarbl": 0
            },
            {
              "id": "011@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 377714,
              "reason": "Unsupported transaction type",
              "tenantId": "DEFAULT",
              "subRuleRef": ".err",
              "indpdntVarbl": 0
            },
            {
              "id": "078@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 3957354,
              "reason": "Error while getting rule configuration",
              "tenantId": "DEFAULT",
              "subRuleRef": ".err",
              "indpdntVarbl": 0
            },
            {
              "id": "090@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 4050870,
              "reason": "Error while getting rule configuration",
              "tenantId": "DEFAULT",
              "subRuleRef": ".err",
              "indpdntVarbl": 0
            },
            {
              "id": "045@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 13231717,
              "reason": "Error while getting rule configuration",
              "tenantId": "DEFAULT",
              "subRuleRef": ".err",
              "indpdntVarbl": 0
            },
            {
              "id": "002@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 6836933,
              "reason": "Error while getting rule configuration",
              "tenantId": "DEFAULT",
              "subRuleRef": ".err",
              "indpdntVarbl": 0
            },
            {
              "id": "018@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 349628,
              "reason": "Unsupported transaction type",
              "tenantId": "DEFAULT",
              "subRuleRef": ".err",
              "indpdntVarbl": 0
            },
            {
              "id": "025@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 516218,
              "reason": "Unsupported transaction type",
              "tenantId": "DEFAULT",
              "subRuleRef": ".err",
              "indpdntVarbl": 0
            },
            {
              "id": "024@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 524120,
              "reason": "Unsupported transaction type",
              "tenantId": "DEFAULT",
              "subRuleRef": ".err",
              "indpdntVarbl": 0
            },
            {
              "id": "083@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 6603321,
              "reason": "Error while getting rule configuration",
              "tenantId": "DEFAULT",
              "subRuleRef": ".err",
              "indpdntVarbl": 0
            },
            {
              "id": "008@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 9939087,
              "reason": "Error while getting rule configuration",
              "tenantId": "DEFAULT",
              "subRuleRef": ".err",
              "indpdntVarbl": 0
            },
            {
              "id": "084@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 5486660,
              "reason": "Error while getting rule configuration",
              "tenantId": "DEFAULT",
              "subRuleRef": ".err",
              "indpdntVarbl": 0
            },
            {
              "id": "004@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 9653260,
              "reason": "Error while getting rule configuration",
              "tenantId": "DEFAULT",
              "subRuleRef": ".err",
              "indpdntVarbl": 0
            },
            {
              "id": "EFRuP@4.0.0",
              "cfg": "none",
              "wght": 0,
              "prcgTm": 1678353,
              "tenantId": "DEFAULT",
              "subRuleRef": "none",
              "indpdntVarbl": 0
            },
            {
              "id": "016@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 7891091,
              "reason": "Error while getting rule configuration",
              "tenantId": "DEFAULT",
              "subRuleRef": ".err",
              "indpdntVarbl": 0
            },
            {
              "id": "006@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 346227,
              "reason": "Unsupported transaction type",
              "tenantId": "DEFAULT",
              "subRuleRef": ".err",
              "indpdntVarbl": 0
            },
            {
              "id": "001@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 14661069,
              "reason": "Error while getting rule configuration",
              "tenantId": "DEFAULT",
              "subRuleRef": ".err",
              "indpdntVarbl": 0
            },
            {
              "id": "007@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 315718,
              "reason": "Unsupported transaction type",
              "tenantId": "DEFAULT",
              "subRuleRef": ".err",
              "indpdntVarbl": 0
            },
            {
              "id": "003@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 7775123,
              "reason": "Error while getting rule configuration",
              "tenantId": "DEFAULT",
              "subRuleRef": ".err",
              "indpdntVarbl": 0
            },
            {
              "id": "017@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 14588381,
              "reason": "Error while getting rule configuration",
              "tenantId": "DEFAULT",
              "subRuleRef": ".err",
              "indpdntVarbl": 0
            },
            {
              "id": "048@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 321858,
              "reason": "Unsupported transaction type",
              "tenantId": "DEFAULT",
              "subRuleRef": ".err",
              "indpdntVarbl": 0
            },
            {
              "id": "027@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 9445883,
              "reason": "Error while getting rule configuration",
              "tenantId": "DEFAULT",
              "subRuleRef": ".err",
              "indpdntVarbl": 0
            },
            {
              "id": "010@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 297467,
              "reason": "Unsupported transaction type",
              "tenantId": "DEFAULT",
              "subRuleRef": ".err",
              "indpdntVarbl": 0
            },
            {
              "id": "091@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 3674141,
              "reason": "Error while getting rule configuration",
              "tenantId": "DEFAULT",
              "subRuleRef": ".err",
              "indpdntVarbl": 0
            },
            {
              "id": "020@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 532894,
              "reason": "Unsupported transaction type",
              "tenantId": "DEFAULT",
              "subRuleRef": ".err",
              "indpdntVarbl": 0
            },
            {
              "id": "076@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 5336297,
              "reason": "Error while getting rule configuration",
              "tenantId": "DEFAULT",
              "subRuleRef": ".err",
              "indpdntVarbl": 0
            },
            {
              "id": "021@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 513815,
              "reason": "Unsupported transaction type",
              "tenantId": "DEFAULT",
              "subRuleRef": ".err",
              "indpdntVarbl": 0
            }
          ]
        }
      ]
    },
    "evaluationID": "01a130a4-6e51-751a-9184-f5e76b262209"
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
      "cdtrId": "25471001MSISDN",
      "dbtrId": "201901001MSISDN",
      "creDtTm": "2026-10-12T15:03:34.497Z",
      "instdAmt": {
        "amt": 70,
        "ccy": "EGP"
      },
      "xchgRate": 0.24054982817869416,
      "cdtrAcctId": "25471001MSISDNtest-kes-dfsp",
      "dbtrAcctId": "201901001MSISDNtest-egp-dfsp",
      "intrBkSttlmAmt": {
        "amt": 291,
        "ccy": "KES"
      }
    },
    "FIToFIPmtSts": {
      "GrpHdr": {
        "MsgId": "01M4RA8VFBJTHYV7KQFFD1ZK9T",
        "CreDtTm": "2026-10-12T15:04:04.843Z"
      },
      "TxInfAndSts": {
        "TxSts": "ACSC",
        "ChrgsInf": [
          {
            "Agt": {
              "FinInstnId": {
                "ClrSysMmbId": {
                  "MmbId": "test-kes-dfsp"
                }
              }
            },
            "Amt": {
              "Amt": 0,
              "Ccy": "KES"
            }
          }
        ],
        "InstdAgt": {
          "FinInstnId": {
            "ClrSysMmbId": {
              "MmbId": "test-egp-dfsp"
            }
          }
        },
        "InstgAgt": {
          "FinInstnId": {
            "ClrSysMmbId": {
              "MmbId": "test-kes-dfsp"
            }
          }
        },
        "AccptncDtTm": "2026-10-12T15:02:52.559Z",
        "OrgnlInstrId": "01M4RA40SP2MGSXPYYN246MV25",
        "OrgnlEndToEndId": "01M4RA40SP2MGSXPYYN246MV25"
      }
    }
  },
  "transactionID": "01M4RA8VFBJTHYV7KQFFD1ZK9T"
}
```

### 4. EGP → UGX, message 01M4RA8ZEV9275PZY7G9G1MH05

Status `NALT`, written 2026-10-12T15:04:09.027Z; 31 rule results, 30 of them `.err`.

```json
{
  "report": {
    "status": "NALT",
    "timestamp": "2026-10-12T15:04:09.027Z",
    "tadpResult": {
      "id": "004@4.0.0",
      "cfg": "4.0.0",
      "prcgTm": 2918811,
      "typologyResult": [
        {
          "id": "typology-processor",
          "cfg": "000@4.0.0",
          "prcgTm": 6068370,
          "result": 0,
          "review": false,
          "tenantId": "DEFAULT",
          "workflow": {
            "flowProcessor": "EFRuP@4.0.0",
            "alertThreshold": 220,
            "interdictionThreshold": 260
          },
          "ruleResults": [
            {
              "id": "002@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 4947464,
              "reason": "Error while getting rule configuration",
              "tenantId": "DEFAULT",
              "subRuleRef": ".err",
              "indpdntVarbl": 0
            },
            {
              "id": "084@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 4620774,
              "reason": "Error while getting rule configuration",
              "tenantId": "DEFAULT",
              "subRuleRef": ".err",
              "indpdntVarbl": 0
            },
            {
              "id": "010@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 284606,
              "reason": "Unsupported transaction type",
              "tenantId": "DEFAULT",
              "subRuleRef": ".err",
              "indpdntVarbl": 0
            },
            {
              "id": "003@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 8646231,
              "reason": "Error while getting rule configuration",
              "tenantId": "DEFAULT",
              "subRuleRef": ".err",
              "indpdntVarbl": 0
            },
            {
              "id": "078@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 8842690,
              "reason": "Error while getting rule configuration",
              "tenantId": "DEFAULT",
              "subRuleRef": ".err",
              "indpdntVarbl": 0
            },
            {
              "id": "045@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 13533819,
              "reason": "Error while getting rule configuration",
              "tenantId": "DEFAULT",
              "subRuleRef": ".err",
              "indpdntVarbl": 0
            },
            {
              "id": "091@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 7599244,
              "reason": "Error while getting rule configuration",
              "tenantId": "DEFAULT",
              "subRuleRef": ".err",
              "indpdntVarbl": 0
            },
            {
              "id": "018@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 312070,
              "reason": "Unsupported transaction type",
              "tenantId": "DEFAULT",
              "subRuleRef": ".err",
              "indpdntVarbl": 0
            },
            {
              "id": "008@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 6388677,
              "reason": "Error while getting rule configuration",
              "tenantId": "DEFAULT",
              "subRuleRef": ".err",
              "indpdntVarbl": 0
            },
            {
              "id": "026@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 9529026,
              "reason": "Error while getting rule configuration",
              "tenantId": "DEFAULT",
              "subRuleRef": ".err",
              "indpdntVarbl": 0
            },
            {
              "id": "EFRuP@4.0.0",
              "cfg": "none",
              "wght": 0,
              "prcgTm": 710608,
              "tenantId": "DEFAULT",
              "subRuleRef": "none",
              "indpdntVarbl": 0
            },
            {
              "id": "021@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 315825,
              "reason": "Unsupported transaction type",
              "tenantId": "DEFAULT",
              "subRuleRef": ".err",
              "indpdntVarbl": 0
            },
            {
              "id": "063@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 296375,
              "reason": "Unsupported transaction type",
              "tenantId": "DEFAULT",
              "subRuleRef": ".err",
              "indpdntVarbl": 0
            },
            {
              "id": "017@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 3318954,
              "reason": "Error while getting rule configuration",
              "tenantId": "DEFAULT",
              "subRuleRef": ".err",
              "indpdntVarbl": 0
            },
            {
              "id": "001@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 10719997,
              "reason": "Error while getting rule configuration",
              "tenantId": "DEFAULT",
              "subRuleRef": ".err",
              "indpdntVarbl": 0
            },
            {
              "id": "090@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 5934234,
              "reason": "Error while getting rule configuration",
              "tenantId": "DEFAULT",
              "subRuleRef": ".err",
              "indpdntVarbl": 0
            },
            {
              "id": "025@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 302629,
              "reason": "Unsupported transaction type",
              "tenantId": "DEFAULT",
              "subRuleRef": ".err",
              "indpdntVarbl": 0
            },
            {
              "id": "004@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 6283371,
              "reason": "Error while getting rule configuration",
              "tenantId": "DEFAULT",
              "subRuleRef": ".err",
              "indpdntVarbl": 0
            },
            {
              "id": "006@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 330771,
              "reason": "Unsupported transaction type",
              "tenantId": "DEFAULT",
              "subRuleRef": ".err",
              "indpdntVarbl": 0
            },
            {
              "id": "044@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 3901706,
              "reason": "Error while getting rule configuration",
              "tenantId": "DEFAULT",
              "subRuleRef": ".err",
              "indpdntVarbl": 0
            },
            {
              "id": "027@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 5414051,
              "reason": "Error while getting rule configuration",
              "tenantId": "DEFAULT",
              "subRuleRef": ".err",
              "indpdntVarbl": 0
            },
            {
              "id": "016@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 6349491,
              "reason": "Error while getting rule configuration",
              "tenantId": "DEFAULT",
              "subRuleRef": ".err",
              "indpdntVarbl": 0
            },
            {
              "id": "048@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 275291,
              "reason": "Unsupported transaction type",
              "tenantId": "DEFAULT",
              "subRuleRef": ".err",
              "indpdntVarbl": 0
            },
            {
              "id": "020@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 294800,
              "reason": "Unsupported transaction type",
              "tenantId": "DEFAULT",
              "subRuleRef": ".err",
              "indpdntVarbl": 0
            },
            {
              "id": "054@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 316980,
              "reason": "Unsupported transaction type",
              "tenantId": "DEFAULT",
              "subRuleRef": ".err",
              "indpdntVarbl": 0
            },
            {
              "id": "024@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 315971,
              "reason": "Unsupported transaction type",
              "tenantId": "DEFAULT",
              "subRuleRef": ".err",
              "indpdntVarbl": 0
            },
            {
              "id": "007@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 277811,
              "reason": "Unsupported transaction type",
              "tenantId": "DEFAULT",
              "subRuleRef": ".err",
              "indpdntVarbl": 0
            },
            {
              "id": "083@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 6393206,
              "reason": "Error while getting rule configuration",
              "tenantId": "DEFAULT",
              "subRuleRef": ".err",
              "indpdntVarbl": 0
            },
            {
              "id": "030@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 267431,
              "reason": "Unsupported transaction type",
              "tenantId": "DEFAULT",
              "subRuleRef": ".err",
              "indpdntVarbl": 0
            },
            {
              "id": "011@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 349814,
              "reason": "Unsupported transaction type",
              "tenantId": "DEFAULT",
              "subRuleRef": ".err",
              "indpdntVarbl": 0
            },
            {
              "id": "076@4.0.0",
              "cfg": "4.0.0",
              "wght": 0,
              "prcgTm": 7877192,
              "reason": "Error while getting rule configuration",
              "tenantId": "DEFAULT",
              "subRuleRef": ".err",
              "indpdntVarbl": 0
            }
          ]
        }
      ]
    },
    "evaluationID": "01a130a4-7e43-729d-8926-64eaa2824085"
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
      "cdtrId": "25672001MSISDN",
      "dbtrId": "201901001MSISDN",
      "creDtTm": "2026-10-12T15:03:37.325Z",
      "instdAmt": {
        "amt": 45,
        "ccy": "EGP"
      },
      "xchgRate": 0.00826749954069447,
      "cdtrAcctId": "25672001MSISDNtest-ugx-dfsp",
      "dbtrAcctId": "201901001MSISDNtest-egp-dfsp",
      "intrBkSttlmAmt": {
        "amt": 5443,
        "ccy": "UGX"
      }
    },
    "FIToFIPmtSts": {
      "GrpHdr": {
        "MsgId": "01M4RA8ZEV9275PZY7G9G1MH05",
        "CreDtTm": "2026-10-12T15:04:08.923Z"
      },
      "TxInfAndSts": {
        "TxSts": "ACSC",
        "ChrgsInf": [
          {
            "Agt": {
              "FinInstnId": {
                "ClrSysMmbId": {
                  "MmbId": "test-ugx-dfsp"
                }
              }
            },
            "Amt": {
              "Amt": 0,
              "Ccy": "UGX"
            }
          }
        ],
        "InstdAgt": {
          "FinInstnId": {
            "ClrSysMmbId": {
              "MmbId": "test-egp-dfsp"
            }
          }
        },
        "InstgAgt": {
          "FinInstnId": {
            "ClrSysMmbId": {
              "MmbId": "test-ugx-dfsp"
            }
          }
        },
        "AccptncDtTm": "2026-10-12T15:02:54.883Z",
        "OrgnlInstrId": "01M4RA40XX1X0JWDV80C51V6Y3",
        "OrgnlEndToEndId": "01M4RA40XX1X0JWDV80C51V6Y3"
      }
    }
  },
  "transactionID": "01M4RA8ZEV9275PZY7G9G1MH05"
}
```

<!-- SPDX-License-Identifier: Apache-2.0 -->

# TMS Service — API Specification & Calling Guide

The Transaction Monitoring Service (TMS) exposes a small Fastify HTTP API that accepts ISO 20022
messages, validates them (AJV, schemas in [`src/schemas/`](schemas/)), persists related data, caches a
`DataCache` object, forwards the transaction to the `event-director` service over NATS, and returns the
transaction back to the caller.

Routes are defined in [`src/router.ts`](router.ts), request handling in
[`src/app.controller.ts`](app.controller.ts), and business logic in [`src/logic.service.ts`](logic.service.ts).

- [TMS Service — API Specification \& Calling Guide](#tms-service--api-specification--calling-guide)
  - [1. Base URL \& general info](#1-base-url--general-info)
  - [2. Authentication](#2-authentication)
  - [3. Multi-tenancy](#3-multi-tenancy)
  - [4. Endpoints](#4-endpoints)
    - [4.1 GET `/` and `/health`](#41-get--and-health)
    - [4.2 POST `/v1/evaluate/iso20022/pain.001.001.11`](#42-post-v1evaluateiso20022pain001001111-)
    - [4.3 POST `/v1/evaluate/iso20022/pain.013.001.09`](#43-post-v1evaluateiso20022pain013001091-)
    - [4.4 POST `/v1/evaluate/iso20022/pacs.008.001.10`](#44-post-v1evaluateiso20022pacs008001101-)
    - [4.5 POST `/v1/evaluate/iso20022/pacs.002.001.12`](#45-post-v1evaluateiso20022pacs002001121-)
  - [5. Response format](#5-response-format)
  - [6. Error responses](#6-error-responses)
  - [7. Calling the API](#7-calling-the-api)
    - [7.1 curl examples](#71-curl-examples)
    - [7.2 Notes on required flow (pacs.008 → pacs.002)](#72-notes-on-required-flow-pacs008--pacs002)
  - [8. Swagger / OpenAPI UI](#8-swagger--openapi-ui)
  - [9. Relevant environment variables](#9-relevant-environment-variables)

## 1. Base URL & general info

- Protocol: `HTTP` (as configured — see `swagger.yaml`, `schemes: ['http']`)
- Port: `PORT` env var (default in `.env.template` is `3000`)
- Base URL (local): `http://localhost:3000`
- Content type: `application/json` for all POST bodies
- Framework: Fastify, with AJV `strict: false` validation compiled from the JSON Schemas in
  [`src/schemas/`](schemas/) (this is the schema actually enforced at runtime — the `swagger.yaml` is
  documentation only and is slightly looser/different in a few places, so always trust the JSON Schema
  files as the source of truth for validation).
- CORS: `POST` only, unless `CORS_POLICY=demo`, in which case `GET` is also allowed (see
  [`src/clients/fastify.ts`](clients/fastify.ts)).

## 2. Authentication

Controlled by the `AUTHENTICATED` environment variable.

- `AUTHENTICATED=false` (default): no `Authorization` header required. A tenant id is still resolved (see
  [Multi-tenancy](#3-multi-tenancy)) but auth/claims are not checked.
- `AUTHENTICATED=true`: every POST route requires a header:

  ```
  Authorization: Bearer <JWT>
  ```

  The JWT is validated via `@tazama-lf/auth-lib`'s `validateTokenAndClaims`, checked against a
  route-specific claim (see table below), and the public key path is provided via `CERT_PATH_PUBLIC`.
  Missing/invalid tokens or missing claims return `401 Unauthorized`.

| Route | Required claim |
|---|---|
| `POST /v1/evaluate/iso20022/pain.001.001.11` | `POST_V1_EVALUATE_ISO20022_PAIN_001_001_11` |
| `POST /v1/evaluate/iso20022/pain.013.001.09` | `POST_V1_EVALUATE_ISO20022_PAIN_013_001_09` |
| `POST /v1/evaluate/iso20022/pacs.008.001.10` | `POST_V1_EVALUATE_ISO20022_PACS_008_001_10` |
| `POST /v1/evaluate/iso20022/pacs.002.001.12` | `POST_V1_EVALUATE_ISO20022_PACS_002_001_12` |

(See [`src/router.ts`](router.ts) `routePrivilege` and [`src/auth/authHandler.ts`](auth/authHandler.ts).)

## 3. Multi-tenancy

Every POST route runs `validateTenantMiddleware` ([`src/middleware/validateTenantMiddleware.ts`](middleware/validateTenantMiddleware.ts))
**before** auth. It:

1. Resets `req.body.TenantId = ''`.
2. Calls `extractTenant(AUTHENTICATED, authorizationHeader)` from `@tazama-lf/auth-lib`.
   - If `AUTHENTICATED=false`, this resolves a tenant id from context/defaults (falls back to
     `'DEFAULT'` if none is supplied).
   - If `AUTHENTICATED=true`, the tenant id is extracted from the JWT claims.
3. If extraction fails (`success: false` or no `tenantId`), responds `401 { "error": "Unauthorized" }`
   and the request never reaches the handler.
4. Otherwise sets `req.body.TenantId` to the resolved value, which flows through caching keys
   (`${tenantId}:${endToEndId}`) and persisted records.

**You do not send `TenantId` in the payload** — the JSON Schemas explicitly forbid it
(`"not": { "required": ["TenantId"] }`). It is populated server-side.

## 4. Endpoints

### 4.1 GET `/` and `/health`

Health check, no auth, no body.

**Response `200`:**
```json
{ "status": "UP" }
```

### 4.2 POST `/v1/evaluate/iso20022/pain.001.001.11`

> Only active when `QUOTING=true` (env var). If `QUOTING=false`, this route is not registered at all
> (see [`src/router.ts`](router.ts)) and will 404.

Historically the Mojaloop "Quote" message — a credit transfer initiation.

- Validated against schema id `messageSchemaPain001` → [`src/schemas/pain.001.json`](schemas/pain.001.json)
- Handled by `Pain001Handler` → `handlePain001` in [`src/logic.service.ts`](logic.service.ts)
- Side effects: saves transaction history, adds debtor/creditor accounts and entities, saves transaction
  details (all in Postgres), then notifies `event-director` over NATS.

**Request body** (`CstmrCdtTrfInitn` is required):

```json
{
  "CstmrCdtTrfInitn": {
    "GrpHdr": {
      "MsgId": "24988b914e3d4cf98a7659b2c45ce063258",
      "CreDtTm": "2021-12-03T12:40:14.000Z",
      "NbOfTxs": 1,
      "InitgPty": {
        "Nm": "April Blake Grant",
        "Id": {
          "PrvtId": {
            "DtAndPlcOfBirth": {
              "BirthDt": "1968-02-01",
              "CityOfBirth": "Unknown",
              "CtryOfBirth": "ZZ"
            },
            "Othr": [
              { "Id": "+27730975224", "SchmeNm": { "Prtry": "MSISDN" } }
            ]
          }
        },
        "CtctDtls": { "MobNb": "+27-730975224" }
      }
    },
    "PmtInf": {
      "PmtInfId": "5ab4fc7355de4ef8a75b78b00a681ed2569",
      "PmtMtd": "TRA",
      "ReqdAdvcTp": {
        "DbtAdvc": { "Cd": "ADWD", "Prtry": "Advice with transaction details" }
      },
      "ReqdExctnDt": { "Dt": "2021-12-03", "DtTm": "2021-12-03T12:40:14.000Z" },
      "Dbtr": {
        "Nm": "April Blake Grant",
        "Id": {
          "PrvtId": {
            "DtAndPlcOfBirth": {
              "BirthDt": "1968-02-01",
              "CityOfBirth": "Unknown",
              "CtryOfBirth": "ZZ"
            },
            "Othr": [
              { "Id": "+27730975224", "SchmeNm": { "Prtry": "MSISDN" } }
            ]
          }
        },
        "CtctDtls": { "MobNb": "+27-730975224" }
      },
      "DbtrAcct": {
        "Id": { "Othr": [{ "Id": "+27730975224", "SchmeNm": { "Prtry": "MSISDN" } }] },
        "Nm": "April Grant"
      },
      "DbtrAgt": { "FinInstnId": { "ClrSysMmbId": { "MmbId": "dfsp001" } } },
      "CdtTrfTxInf": {
        "PmtId": { "EndToEndId": "2c516801007642dfb892944dde1cf845" },
        "PmtTpInf": { "CtgyPurp": { "Prtry": "TRANSFER BLANK" } },
        "Amt": {
          "InstdAmt": { "Amt": { "Amt": 31020.89, "Ccy": "USD" } },
          "EqvtAmt": {
            "Amt": { "Amt": 31020.89, "Ccy": "USD" },
            "CcyOfTrf": "USD",
            "XchgRateInf": { "UnitCcy": "USD", "XchgRate": 1.0 }
          }
        },
        "ChrgBr": "DEBT",
        "CdtrAgt": { "FinInstnId": { "ClrSysMmbId": { "MmbId": "dfsp002" } } },
        "Cdtr": {
          "Nm": "Felicia Easton Quill",
          "Id": {
            "PrvtId": {
              "DtAndPlcOfBirth": {
                "BirthDt": "1935-05-08",
                "CityOfBirth": "Unknown",
                "CtryOfBirth": "ZZ"
              },
              "Othr": [
                { "Id": "+27707650428", "SchmeNm": { "Prtry": "MSISDN" } }
              ]
            }
          },
          "CtctDtls": { "MobNb": "+27-707650428" }
        },
        "CdtrAcct": {
          "Id": { "Othr": [{ "Id": "+27707650428", "SchmeNm": { "Prtry": "MSISDN" } }] },
          "Nm": "Felicia Quill"
        },
        "Purp": { "Cd": "MP2P" },
        "RgltryRptg": { "Dtls": { "Tp": "BALANCE OF PAYMENTS", "Cd": "100" } },
        "RmtInf": { "Ustrd": "Payment of USD 30713.75 from April to Felicia" },
        "SplmtryData": {
          "Envlp": {
            "Doc": {
              "Dbtr": { "FrstNm": "April", "MddlNm": "Blake", "LastNm": "Grant", "MrchntClssfctnCd": "BLANK" },
              "Cdtr": { "FrstNm": "Felicia", "MddlNm": "Easton", "LastNm": "Quill", "MrchntClssfctnCd": "BLANK" },
              "DbtrFinSvcsPrvdrFees": { "Ccy": "USD", "Amt": 307.14 },
              "Xprtn": "2021-11-30T10:38:56.000Z"
            }
          }
        }
      }
    },
    "SplmtryData": {
      "Envlp": {
        "Doc": {
          "InitgPty": {
            "InitrTp": "CONSUMER",
            "Glctn": { "Lat": "-3.1609", "Long": "38.3588" }
          }
        }
      }
    }
  }
}
```

**Notable required fields** (per [`src/schemas/pain.001.json`](schemas/pain.001.json)):
`CstmrCdtTrfInitn.GrpHdr` (`MsgId`, `CreDtTm`, `NbOfTxs`, `InitgPty`), `CstmrCdtTrfInitn.PmtInf` (`PmtInfId`,
`PmtMtd`, `ReqdAdvcTp`, `ReqdExctnDt`, `Dbtr`, `DbtrAcct`, `DbtrAgt`, `CdtTrfTxInf`), and inside
`CdtTrfTxInf`: `PmtId`, `PmtTpInf`, `Amt` (both `InstdAmt` and `EqvtAmt`), `ChrgBr`, `CdtrAgt`, `Cdtr`,
`CdtrAcct`, `Purp`, `RgltryRptg`, `RmtInf`, `SplmtryData`.

**Response `200`:**
```json
{ "message": "Transaction is valid", "data": { "...": "the same request body, with TenantId populated" } }
```

### 4.3 POST `/v1/evaluate/iso20022/pain.013.001.09`

> Only active when `QUOTING=true`, same as pain.001.

Historically the Mojaloop "Quote Response" message.

- Validated against schema id `messageSchemaPain013` → [`src/schemas/pain.013.json`](schemas/pain.013.json)
- Handled by `Pain013Handler` → `handlePain013`.

**Request body** (`CdtrPmtActvtnReq` is required):

```json
{
  "CdtrPmtActvtnReq": {
    "GrpHdr": {
      "MsgId": "42665509efd844da90caf468e891aa52256",
      "CreDtTm": "2021-12-03T12:40:16.000Z",
      "NbOfTxs": 1,
      "InitgPty": {
        "Nm": "April Blake Grant",
        "Id": {
          "PrvtId": {
            "DtAndPlcOfBirth": { "BirthDt": "1968-02-01", "CityOfBirth": "Unknown", "CtryOfBirth": "ZZ" },
            "Othr": [{ "Id": "+27730975224", "SchmeNm": { "Prtry": "MSISDN" } }]
          }
        },
        "CtctDtls": { "MobNb": "+27-730975224" }
      }
    },
    "PmtInf": {
      "PmtInfId": "5ab4fc7355de4ef8a75b78b00a681ed2254",
      "PmtMtd": "TRA",
      "ReqdAdvcTp": { "DbtAdvc": { "Cd": "ADWD", "Prtry": "Advice with transaction details" } },
      "ReqdExctnDt": { "DtTm": "2021-12-03T12:40:14.000Z" },
      "XpryDt": { "DtTm": "2021-11-30T10:38:56.000Z" },
      "Dbtr": {
        "Nm": "April Blake Grant",
        "Id": {
          "PrvtId": {
            "DtAndPlcOfBirth": { "BirthDt": "1968-02-01", "CityOfBirth": "Unknown", "CtryOfBirth": "ZZ" },
            "Othr": [{ "Id": "+27730975224", "SchmeNm": { "Prtry": "MSISDN" } }]
          }
        },
        "CtctDtls": { "MobNb": "+27-730975224" }
      },
      "DbtrAcct": {
        "Id": { "Othr": [{ "Id": "+27730975224", "SchmeNm": { "Prtry": "MSISDN" } }] },
        "Nm": "April Grant"
      },
      "DbtrAgt": { "FinInstnId": { "ClrSysMmbId": { "MmbId": "dfsp001" } } },
      "CdtTrfTxInf": {
        "PmtId": { "EndToEndId": "2c516801007642dfb892944dde1cf845" },
        "PmtTpInf": { "CtgyPurp": { "Prtry": "TRANSFER BLANK" } },
        "Amt": {
          "InstdAmt": { "Amt": { "Amt": 31020.89, "Ccy": "USD" } },
          "EqvtAmt": { "Amt": { "Amt": 31020.89, "Ccy": "USD" }, "CcyOfTrf": "USD" }
        },
        "ChrgBr": "DEBT",
        "CdtrAgt": { "FinInstnId": { "ClrSysMmbId": { "MmbId": "dfsp002" } } },
        "Cdtr": {
          "Nm": "Felicia Easton Quill",
          "Id": {
            "PrvtId": {
              "DtAndPlcOfBirth": { "BirthDt": "1935-05-08", "CityOfBirth": "Unknown", "CtryOfBirth": "ZZ" },
              "Othr": [{ "Id": "+27707650428", "SchmeNm": { "Prtry": "MSISDN" } }]
            }
          },
          "CtctDtls": { "MobNb": "+27-707650428" }
        },
        "CdtrAcct": {
          "Id": { "Othr": [{ "Id": "+27707650428", "SchmeNm": { "Prtry": "MSISDN" } }] },
          "Nm": "Felicia Quill"
        },
        "Purp": { "Cd": "MP2P" },
        "RgltryRptg": { "Dtls": { "Tp": "BALANCE OF PAYMENTS", "Cd": "100" } },
        "SplmtryData": {
          "Envlp": {
            "Doc": {
              "PyeeRcvAmt": { "Amt": { "Amt": 30713.75, "Ccy": "USD" } },
              "PyeeFinSvcsPrvdrFee": { "Amt": { "Amt": 153.57, "Ccy": "USD" } },
              "PyeeFinSvcsPrvdrComssn": { "Amt": { "Amt": 30.71, "Ccy": "USD" } }
            }
          }
        }
      }
    },
    "SplmtryData": {
      "Envlp": { "Doc": { "InitgPty": { "Glctn": { "Lat": "-3.1609", "Long": "38.3588" } } } }
    }
  }
}
```

**Notable required fields** (per [`src/schemas/pain.013.json`](schemas/pain.013.json)): same shape as
pain.001's `PmtInf`, plus `XpryDt` is required, and `CdtTrfTxInf.SplmtryData.Doc` requires
`PyeeRcvAmt`, `PyeeFinSvcsPrvdrFee`, `PyeeFinSvcsPrvdrComssn` instead of `RmtInf`.

**Response `200`:** same envelope as pain.001.

### 4.4 POST `/v1/evaluate/iso20022/pacs.008.001.10`

Always active (not gated by `QUOTING`). Historically the Mojaloop "Transfer" message — the actual funds
transfer instruction between financial institutions.

- Validated against schema id `messageSchemaPacs008` → [`src/schemas/pacs.008.json`](schemas/pacs.008.json)
- Handled by `Pacs008Handler` → `handlePacs008`.
- Side effects: builds a `DataCache` object (creditor/debtor ids and account ids, amounts, exchange rate),
  writes it to Redis under key `${TenantId}:${EndToEndId}` (TTL = `DISTRIBUTED_CACHETTL`), adds accounts
  (and, if `QUOTING=false`, entities + account holders too), saves transaction history/details, then
  notifies `event-director`. **This cached `DataCache` is later read by the pacs.002 call for the same
  `EndToEndId`** — see [§7.2](#72-notes-on-required-flow-pacs008--pacs002).

**Request body** (`FIToFICstmrCdtTrf` is required):

```json
{
  "FIToFICstmrCdtTrf": {
    "GrpHdr": {
      "MsgId": "24e80c9836f6437e8aa46cbb3fbdd5b1",
      "CreDtTm": "2024-05-27T13:57:33.890Z",
      "NbOfTxs": 1,
      "SttlmInf": { "SttlmMtd": "CLRG" }
    },
    "CdtTrfTxInf": {
      "PmtId": {
        "InstrId": "5ab4fc7355de4ef8a75b78b00a681ed2",
        "EndToEndId": "fe252acd9f1742d0ad9d74000ecc57d8"
      },
      "IntrBkSttlmAmt": { "Amt": { "Amt": 531.81, "Ccy": "XTS" } },
      "InstdAmt": { "Amt": { "Amt": 531.81, "Ccy": "XTS" } },
      "XchgRate": 1.0,
      "ChrgBr": "DEBT",
      "ChrgsInf": {
        "Amt": { "Amt": 0, "Ccy": "XTS" },
        "Agt": { "FinInstnId": { "ClrSysMmbId": { "MmbId": "dfsp001" } } }
      },
      "InitgPty": {
        "Nm": "April Blake Grant",
        "Id": {
          "PrvtId": {
            "DtAndPlcOfBirth": { "BirthDt": "1968-02-01", "CityOfBirth": "Unknown", "CtryOfBirth": "ZZ" },
            "Othr": [{ "Id": "+27730975224", "SchmeNm": { "Prtry": "MSISDN" } }]
          }
        },
        "CtctDtls": { "MobNb": "+27-730975224" }
      },
      "Dbtr": {
        "Nm": "April Blake Grant",
        "Id": {
          "PrvtId": {
            "DtAndPlcOfBirth": { "BirthDt": "1999-05-09", "CityOfBirth": "Unknown", "CtryOfBirth": "ZZ" },
            "Othr": [{ "Id": "60409827ba274853a2ec2475c64566d5", "SchmeNm": { "Prtry": "TAZAMA_EID" } }]
          }
        },
        "CtctDtls": { "MobNb": "+27-730975224" }
      },
      "DbtrAcct": {
        "Id": { "Othr": [{ "Id": "7473251533b34fe891fa8b0d1691d375", "SchmeNm": { "Prtry": "MSISDN" } }] },
        "Nm": "April Grant"
      },
      "DbtrAgt": { "FinInstnId": { "ClrSysMmbId": { "MmbId": "dfsp001" } } },
      "CdtrAgt": { "FinInstnId": { "ClrSysMmbId": { "MmbId": "dfsp002" } } },
      "Cdtr": {
        "Nm": "Felicia Easton Quill",
        "Id": {
          "PrvtId": {
            "DtAndPlcOfBirth": { "BirthDt": "1935-05-08", "CityOfBirth": "Unknown", "CtryOfBirth": "ZZ" },
            "Othr": [{ "Id": "1d495a2f710e436089677dcc789f279d", "SchmeNm": { "Prtry": "TAZAMA_EID" } }]
          }
        },
        "CtctDtls": { "MobNb": "+27-707650428" }
      },
      "CdtrAcct": {
        "Id": { "Othr": [{ "Id": "f58d206a6ada4a34a372dfbd66b17c6f", "SchmeNm": { "Prtry": "MSISDN" } }] },
        "Nm": "Felicia Quill"
      },
      "Purp": { "Cd": "MP2P" }
    },
    "RgltryRptg": { "Dtls": { "Tp": "BALANCE OF PAYMENTS", "Cd": "100" } },
    "RmtInf": { "Ustrd": "Generic payment description" },
    "SplmtryData": {
      "Envlp": {
        "Doc": {
          "Xprtn": "2021-11-30T10:38:56.000Z",
          "InitgPty": { "Glctn": { "Lat": "-3.1609", "Long": "38.3588" } }
        }
      }
    }
  }
}
```

**Notable required fields** (per [`src/schemas/pacs.008.json`](schemas/pacs.008.json)):
`GrpHdr` (`MsgId`, `CreDtTm`, `NbOfTxs`, `SttlmInf.SttlmMtd`); `CdtTrfTxInf` (`PmtId` with both `InstrId`
and `EndToEndId`, `IntrBkSttlmAmt`, `InstdAmt`, `ChrgBr`, `ChrgsInf`, `InitgPty`, `Dbtr`, `DbtrAcct`,
`DbtrAgt`, `CdtrAgt`, `Cdtr`, `CdtrAcct`, `Purp`); top-level `RgltryRptg`, `RmtInf`, `SplmtryData`
(with `Doc.Xprtn`).

⚠️ **`EndToEndId` here is the value you must reuse in the corresponding pacs.002 call** (as
`OrgnlEndToEndId`), so the cache lookup succeeds.

**Response `200`:** same envelope, `data` echoes the request with `TenantId` populated.

### 4.5 POST `/v1/evaluate/iso20022/pacs.002.001.12`

Always active. A payment status report — confirms/rejects a previously-submitted pacs.008 transfer.

- Validated against schema id `messageSchemaPacs002` → [`src/schemas/pacs.002.json`](schemas/pacs.002.json)
- Handled by `Pacs002Handler` → `handlePacs002`.
- Side effects: looks up `DataCache` in Redis by `${TenantId}:${OrgnlEndToEndId}`; on cache miss, rebuilds
  it from the Postgres-stored pacs.008 (`rebuildCache`); saves transaction history + details
  (source/destination account ids taken from the cache); notifies `event-director`.

**Request body** (`FIToFIPmtSts` is required):

```json
{
  "FIToFIPmtSts": {
    "GrpHdr": {
      "MsgId": "e24562287a264651b0c42a3de9ea44fe",
      "CreDtTm": "2024-05-27T14:02:33.890Z"
    },
    "TxInfAndSts": {
      "OrgnlInstrId": "5ab4fc7355de4ef8a75b78b00a681ed2",
      "OrgnlEndToEndId": "fe252acd9f1742d0ad9d74000ecc57d8",
      "TxSts": "ACCC",
      "ChrgsInf": [
        { "Amt": { "Amt": 0, "Ccy": "USD" }, "Agt": { "FinInstnId": { "ClrSysMmbId": { "MmbId": "dfsp001" } } } },
        { "Amt": { "Amt": 0, "Ccy": "USD" }, "Agt": { "FinInstnId": { "ClrSysMmbId": { "MmbId": "dfsp001" } } } },
        { "Amt": { "Amt": 0, "Ccy": "USD" }, "Agt": { "FinInstnId": { "ClrSysMmbId": { "MmbId": "dfsp002" } } } }
      ],
      "AccptncDtTm": "2023-06-02T07:52:31.000Z",
      "InstgAgt": { "FinInstnId": { "ClrSysMmbId": { "MmbId": "dfsp001" } } },
      "InstdAgt": { "FinInstnId": { "ClrSysMmbId": { "MmbId": "dfsp002" } } }
    }
  }
}
```

**Notable required fields** (per [`src/schemas/pacs.002.json`](schemas/pacs.002.json)): `GrpHdr` (`MsgId`,
`CreDtTm`); `TxInfAndSts` (`OrgnlInstrId`, `OrgnlEndToEndId`, `TxSts`, `ChrgsInf`, `AccptncDtTm`,
`InstgAgt`, `InstdAgt`). `TxSts` valid values (per `swagger.yaml`):
`ACCC, ACCP, ACFC, ACSC, ACSP, ACTC, ACWC, ACWP, BLCK, CANC, PATC, PDNG, PRES, RCVD, RJCT`.

**Response `200`:** same envelope, `data` echoes the request with `TenantId` populated.

## 5. Response format

All four evaluate endpoints share the same success envelope:

```json
{
  "message": "Transaction is valid",
  "data": { "...": "the request body you sent, with TenantId now populated" }
}
```

## 6. Error responses

| Status | When | Body |
|---|---|---|
| `400` | AJV schema validation failed (unknown/missing/wrong-typed field; sending `TenantId` yourself) | Fastify default AJV error payload |
| `401` | `AUTHENTICATED=true` and Bearer token missing/invalid/lacking the route's claim; or tenant extraction failed | `{ "error": "Unauthorized" }` |
| `404` | pain.001 / pain.013 called while `QUOTING=false` (route not registered) | Fastify default 404 |
| `500` | Downstream error (DB, cache serialization, etc.) | Plain-text message: `` Failed to process execution request. \n<error message>`` |

## 7. Calling the API

### 7.1 curl examples

Unauthenticated (`AUTHENTICATED=false`):

```sh
curl -X POST http://localhost:3000/v1/evaluate/iso20022/pacs.008.001.10 \
  -H "Content-Type: application/json" \
  -d @pacs008-payload.json
```

Authenticated (`AUTHENTICATED=true`):

```sh
curl -X POST http://localhost:3000/v1/evaluate/iso20022/pacs.008.001.10 \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <JWT>" \
  -d @pacs008-payload.json
```

Health check:

```sh
curl http://localhost:3000/health
```

### 7.2 Notes on required flow (pacs.008 → pacs.002)

pacs.002 depends on state created by a prior pacs.008 call:

1. POST a pacs.008 with a given `CdtTrfTxInf.PmtId.EndToEndId` (e.g. `fe252acd9f1742d0ad9d74000ecc57d8`).
   This writes a `DataCache` (creditor/debtor ids and account ids) to Redis keyed on
   `${TenantId}:${EndToEndId}`.
2. POST a pacs.002 whose `TxInfAndSts.OrgnlEndToEndId` matches that same value. TMS looks up the cache
   using the tenant resolved for *this* request — so if you're testing with `AUTHENTICATED=true`, make
   sure both calls resolve to the same tenant, or the pacs.002 call will fall back to rebuilding the cache
   from Postgres (`rebuildCache`), which requires the pacs.008 to have already been persisted to
   `saveTransactionHistory`.
3. If neither the cache nor Postgres has the corresponding pacs.008, `dataCache` will be `undefined` and
   `transactionDetails.source` / `.destination` are left as empty strings.

pain.001 / pain.013 do not depend on each other or on pacs.008/pacs.002 — they are only reachable when
`QUOTING=true`.

## 8. Swagger / OpenAPI UI

The service registers `@fastify/swagger` + `@fastify/swagger-ui` at startup (see
[`src/clients/fastify.ts`](clients/fastify.ts)), driven by [`swagger.yaml`](../swagger.yaml). Once the
service is running, browse:

```
http://localhost:<PORT>/documentation
```

for an interactive "try it out" UI, or fetch the raw spec at `http://localhost:<PORT>/swagger`.

> Note: `swagger.yaml` is hand-maintained documentation and diverges slightly from the AJV schemas in
> [`src/schemas/`](schemas/) that Fastify actually validates against (e.g. `swagger.yaml` marks fewer
> fields required for pain.001/pain.013). When in doubt, validate against the JSON Schema files, not the
> Swagger doc.

## 9. Relevant environment variables

(See [`.env.template`](../.env.template) and [`src/config.ts`](config.ts) for the full list.)

| Variable | Purpose | Default (template) |
|---|---|---|
| `PORT` | HTTP port TMS listens on | `3000` |
| `QUOTING` | Enables/disables pain.001 & pain.013 routes | `false` |
| `AUTHENTICATED` | Enforces Bearer JWT + claim checks | `false` |
| `CERT_PATH_PUBLIC` | Public key used to validate JWTs when `AUTHENTICATED=true` | _(empty)_ |
| `CORS_POLICY` | `demo` allows `GET` in CORS in addition to `POST` | `demo` |
| `DISTRIBUTED_CACHETTL` | Redis TTL (seconds) for the pacs.008 `DataCache` entry | `300` |
| `SERVER_URL` | NATS server URL used to reach `event-director` | `0.0.0.0:4222` |
| `PRODUCER_STREAM` | NATS stream name TMS publishes to (`event-director`) | `event-director` |

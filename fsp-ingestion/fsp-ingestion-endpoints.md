# Mojaloop FSP Ingestion and Callback Endpoint Inventory


This document focuses on endpoints that an FSP communicates with in Mojaloop
flows. FSP-to-Mojaloop ingress endpoints are listed first. Mojaloop-to-FSP or
counterparty callback endpoints are listed separately because they are part of
the same contract but are not initiated by the original ingress caller.

## Evidence Sources

- `ml-core-test-harness/docker/ml-testing-toolkit/test-cases/collections/tests/golden_path/feature_tests/p2p_money_transfer/p2p_happy_path.json`
- `ml-core-test-harness/docker/ml-testing-toolkit/test-cases/collections/tests/golden_path/feature_tests/p2p_money_transfer/p2p_happy_path_subid.json`
- `ml-core-test-harness/docker/ml-testing-toolkit/test-cases/collections/tests/golden_path/feature_tests/resources_based/participants/participants.json`
- `ml-core-test-harness/docker/ml-testing-toolkit/test-cases/collections/tests/golden_path/tests_by_folder/parties/parties.json`
- `ml-core-test-harness/docker/ml-testing-toolkit/test-cases/collections/tests/golden_path/tests_by_folder/quotes/quotes.json`
- `ml-core-test-harness/docker/ml-testing-toolkit/test-cases/collections/tests/golden_path/feature_tests/get_transfers.json`
- `ml-core-test-harness/docker/ml-testing-toolkit/test-cases/collections/tests/fx/golden_path/api_tests/fx_quotes.json`
- `ml-core-test-harness/docker/ml-testing-toolkit/test-cases/collections/tests/fx/golden_path/api_tests/fx_transfers.json`
- `ml-core-test-harness/docker/ml-testing-toolkit/test-cases/collections/tests/golden_path/transaction_request_service/*.json`
- `ml-api-adapter/src/interface/api-swagger.yaml`
- `ml-api-adapter/src/interface/api-swagger-iso20022-transfers.yaml`
- `ml-api-adapter/src/interface/fspiop-rest-v2.0-ISO20022_transfers.yaml`
- `postman/*.postman_collection.json`, including `Golden_Path_Mojaloop.postman_collection.json`, `ML_OSS_Golden_Path_LegacySim.postman_collection.json`, `Bulk API Transfers.postman_collection.json`, and `Bulk_API_Transfers_MojaSims.postman_collection.json`

## Reading The Tables

- "Headers" lists the required or observed headers in the source request. For
  transfer and FX transfer routes, `ml-api-adapter` swagger also defines
  `Content-Length`, `X-Forwarded-For`, `FSPIOP-Encryption`, `FSPIOP-Signature`,
  `FSPIOP-URI`, and `FSPIOP-HTTP-Method` parameters.
- `Authorization` appears in TTK requests because the harness can run with
  bearer-token protection. It is environment-specific rather than a base
  FSPIOP header.
- "Postman coverage" uses normalized `METHOD + path` matching and ignores host
  variables such as `{{HOST_QUOTING_SERVICE}}`.
- "Harness-only" means the request exists in the TTK collections searched but no
  matching Postman request was found in this checkout.
- "Postman-only" means the route exists in Postman collections but was not found
  in the searched TTK collections.

## FSP-To-Mojaloop Ingress Endpoints

| Area | Method | Path | Service / host variable | Headers | JSON body shape | Primary evidence | Postman coverage |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Account lookup participant registration | `POST` | `/participants/{Type}/{ID}` | `HOST_ACCOUNT_LOOKUP_SERVICE` | `Accept`, `Content-Type`, `Date`, `FSPIOP-Source`, optional `Authorization`, harness `baggage` | `fspId`, `currency` | TTK `p2p_happy_path.json` | Exists: CGS setup, `MojaloopSims_Onboarding`, legacy setup |
| Account lookup participant registration with sub-id | `POST` | `/participants/{Type}/{ID}/{SubId}` | `HOST_ACCOUNT_LOOKUP_SERVICE` | `Accept`, `Content-Type`, `Date`, `FSPIOP-Source`, optional `Authorization`, harness `baggage` | `fspId`, `currency` | TTK `p2p_happy_path_subid.json` | Exists: setup/onboarding collections |
| Participant lookup | `GET` | `/participants/{Type}/{ID}` | `HOST_ACCOUNT_LOOKUP_SERVICE` | `Accept`, `Content-Type`, `Date`, `FSPIOP-Source` | None | TTK `participants.json` | Ambiguous: Postman has admin/setup matches; no clean FSP lookup request confirmed |
| Participant lookup with sub-id | `GET` | `/participants/{Type}/{ID}/{SubId}` | `HOST_ACCOUNT_LOOKUP_SERVICE` | `Accept`, `Content-Type`, `Date`, `FSPIOP-Source` | None | TTK `participants.json` | Ambiguous: Postman has admin/setup matches; no clean FSP lookup request confirmed |
| Party lookup | `GET` | `/parties/{Type}/{ID}` | `HOST_ACCOUNT_LOOKUP_SERVICE` | `Accept`, `Content-Type`, `Date`, `FSPIOP-Source`, optional `Authorization` | None | TTK `p2p_happy_path.json`, `parties.json` | Exists: `Golden_Path_Mojaloop`, `IaaC_Sanity_Tests`, `ML_OSS_Golden_Path_LegacySim` |
| Party lookup with sub-id | `GET` | `/parties/{Type}/{ID}/{SubId}` | `HOST_ACCOUNT_LOOKUP_SERVICE` | `Accept`, `Content-Type`, `Date`, `FSPIOP-Source`, optional `Authorization` | None | TTK `p2p_happy_path_subid.json`, `parties.json` | No Postman request found |
| Quote request | `POST` | `/quotes` | `HOST_QUOTING_SERVICE` | `Accept`, `Content-Type`, `Date`, `FSPIOP-Source`, `FSPIOP-Destination`, optional `Authorization`, optional signing headers | `quoteId`, `transactionId`, optional `transactionRequestId`, `payer`, `payee`, `amountType`, `amount`, `transactionType`, `note` | TTK `p2p_happy_path.json`, `quotes.json` | Exists: `Golden_Path_Mojaloop`, `ML_OSS_Golden_Path_LegacySim`, negative quote tests |
| Quote status lookup | `GET` | `/quotes/{ID}` | `HOST_QUOTING_SERVICE` | `Accept`, `Content-Type`, `Date`, `FSPIOP-Source`, `FSPIOP-Destination`, optional `Authorization` | None | TTK `quotes.json` | Exists: `Golden_Path_Mojaloop`, quote bug-fix/negative collections |
| FX quote request | `POST` | `/fxQuotes` | `HOST_QUOTING_SERVICE` | `Accept`, `Content-Type`, `Date`, `FSPIOP-Source`, `FSPIOP-Destination` | `conversionRequestId`, `conversionTerms` | TTK `fx_quotes.json` | No Postman request found |
| Transfer prepare | `POST` | `/transfers` | `HOST_ML_API_ADAPTER` / `HOST_SWITCH_TRANSFERS` | `Accept`, `Content-Type`, `Date`, `FSPIOP-Source`, optional `FSPIOP-Destination`, optional `Authorization`, optional signing headers | `transferId`, `payerFsp`, `payeeFsp`, `amount`, `expiration`, `ilpPacket`, `condition`, optional `extensionList` | TTK `p2p_happy_path.json`, `get_transfers.json`; adapter swagger `TransfersPostRequest` | Exists: `Golden_Path_Mojaloop`, `ML_OSS_Golden_Path_LegacySim`, `IaaC_Sanity_Tests` |
| Transfer status lookup | `GET` | `/transfers/{ID}` | `HOST_ML_API_ADAPTER` / `HOST_SWITCH_TRANSFERS` | `Accept`, `Content-Type`, `Date`, `FSPIOP-Source`, optional `Authorization`, optional signing headers | None | TTK `get_transfers.json`; adapter swagger `TransfersByIDGet` | Exists: `Golden_Path_Mojaloop` get-transfer tests |
| FX transfer prepare | `POST` | `/fxTransfers` | `HOST_ML_API_ADAPTER` | `Accept`, `Content-Type`, `Date`, `FSPIOP-Source`, optional `FSPIOP-Destination`, optional signing headers | `commitRequestId`, optional `determiningTransferId`, `initiatingFsp`, `counterPartyFsp`, `sourceAmount`, `targetAmount`, `condition`, optional `expiration` | TTK `fx_transfers.json`; adapter swagger `FxTransfersPostRequest` | No Postman request found |
| FX transfer status lookup | `GET` | `/fxTransfers/{ID}` | `HOST_ML_API_ADAPTER` | `Accept`, `Content-Type`, `Date`, `FSPIOP-Source`, optional `FSPIOP-Destination`, optional signing headers | None | Adapter swagger `FxTransfersByIDGet` | No Postman request found |
| Bulk quote request | `POST` | `/bulkQuotes` | `HOST_QUOTING_SERVICE` | `Accept`, `Content-Type`, `Date`, `FSPIOP-Source`, `FSPIOP-Destination`, optional signing headers | `bulkQuoteId`, `payer`, `expiration`, `individualQuotes[]` | Postman `Bulk API Transfers.postman_collection.json` | Exists: Postman-only in this checkout |
| Bulk quote lookup | `GET` | `/bulkQuotes/{ID}` | `HOST_QUOTING_SERVICE` | `Accept`, `Content-Type`, `Date`, `FSPIOP-Source`, `FSPIOP-Destination`, optional signing headers | None | Postman `Bulk API Transfers.postman_collection.json` | Exists: Postman-only in this checkout |
| Bulk transfer prepare | `POST` | `/bulkTransfers` | `HOST_BULK_ADAPTER` | `Accept`, `Content-Type`, `Date`, `FSPIOP-Source`, `FSPIOP-Destination`, optional signing headers | `bulkTransferId`, `bulkQuoteId`, `payerFsp`, `payeeFsp`, `individualTransfers[]`, `expiration` | Postman `Bulk API Transfers.postman_collection.json`, `Bulk_API_Transfers_MojaSims.postman_collection.json` | Exists: Postman-only in this checkout |
| Bulk transfer lookup | `GET` | `/bulkTransfers/{ID}` | `HOST_BULK_ADAPTER` | `Accept`, `Content-Type`, `Date`, `FSPIOP-Source` | None | Postman `Bulk API Transfers.postman_collection.json`, `Bulk_API_Transfers_MojaSims.postman_collection.json` | Exists: Postman-only in this checkout |
| Transaction request initiation | `POST` | `/transactionRequests` | `HOST_TRANSACTION_REQUESTS_SERVICE` | `Accept`, `Content-Type`, `Date`, `FSPIOP-Source`, `FSPIOP-Destination`, `FSPIOP-HTTP-Method`, optional `Authorization` | `transactionRequestId`, `payee`, `payer`, `amount`, `transactionType`, `note`, `geoCode`, `authenticationType`, `expiration` | TTK transaction-request service collections | Exists: `Golden_Path_Mojaloop`, `ML_OSS_Golden_Path_LegacySim` |
| Transaction request lookup | `GET` | `/transactionRequests/{ID}` | `HOST_TRANSACTION_REQUESTS_SERVICE` | `Accept`, `Content-Type`, `Date`, `FSPIOP-Source`, `FSPIOP-Destination`, `FSPIOP-HTTP-Method`, `FSPIOP-URI`, optional `Authorization` | None | TTK transaction-request service collections | Exists: `Golden_Path_Mojaloop`, `ML_OSS_Golden_Path_LegacySim` |
| Authorization lookup | `GET` | `/authorizations/{ID}` | `HOST_TRANSACTION_REQUESTS_SERVICE` | `Accept`, `Content-Type`, `Date`, `FSPIOP-Source`, `FSPIOP-Destination`, `FSPIOP-HTTP-Method`, `FSPIOP-URI`, optional `Authorization` | None | TTK `authorizations.json` | Exists: `Golden_Path_Mojaloop` authorization/error-framework tests |

## Mojaloop-To-FSP And Counterparty Callback Endpoints

| Area | Method | Path | Direction | Headers | JSON body shape | Primary evidence | Postman coverage |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Participant lookup callback | `PUT` | `/participants/{Type}/{ID}` | ALS/counterparty to requester | `Content-Type`, `Date`, `FSPIOP-Source` | Empty in TTK resource test | TTK `participants.json` | No clean Postman request found; callback URLs are registered in onboarding collections |
| Participant lookup error callback | `PUT` | `/participants/{Type}/{ID}/error` | ALS/counterparty to requester | `Content-Type`, `Date`, `FSPIOP-Source` | `errorInformation` | TTK `participants.json` | Callback URLs registered in onboarding collections |
| Participant sub-id callback | `PUT` | `/participants/{Type}/{ID}/{SubId}` | ALS/counterparty to requester | `Content-Type`, `Date`, `FSPIOP-Source` | `fspId` in TTK resource test | TTK `participants.json` | No clean Postman request found |
| Participant sub-id error callback | `PUT` | `/participants/{Type}/{ID}/{SubId}/error` | ALS/counterparty to requester | `Content-Type`, `Date`, `FSPIOP-Source` | `errorInformation` | TTK `participants.json` | Callback URLs registered in onboarding collections |
| Party lookup callback | `PUT` | `/parties/{Type}/{ID}` | Payee/ALS to requester | `Content-Type`, `Date`, `FSPIOP-Source`, `FSPIOP-Destination` | `party` | TTK `parties.json` | Exists in Postman assertions/flows |
| Party lookup error callback | `PUT` | `/parties/{Type}/{ID}/error` | Payee/ALS to requester | `Content-Type`, `Date`, `FSPIOP-Source` | `errorInformation` | TTK `parties.json` | No Postman request found |
| Party sub-id callback | `PUT` | `/parties/{Type}/{ID}/{SubId}` | Payee/ALS to requester | `Content-Type`, `Date`, `FSPIOP-Source` | `party` | TTK `parties.json` | No Postman request found |
| Party sub-id error callback | `PUT` | `/parties/{Type}/{ID}/{SubId}/error` | Payee/ALS to requester | `Content-Type`, `Date`, `FSPIOP-Source` | `errorInformation` | TTK `parties.json` | No Postman request found |
| Quote callback | `PUT` | `/quotes/{ID}` | Payee/quoting service to requester | `Content-Type`, `Date`, `FSPIOP-Source`, `FSPIOP-Destination` | `transferAmount`, optional `payeeReceiveAmount`, optional fees/commission, `expiration`, `ilpPacket`, `condition`, optional `extensionList` | TTK `quotes.json` | Exists: `Golden_Path_Mojaloop`, legacy and archived quote tests |
| Quote error callback | `PUT` | `/quotes/{ID}/error` | Payee/quoting service to requester | `Content-Type`, `Date`, `FSPIOP-Source`, `FSPIOP-Destination` | `errorInformation` | TTK `quotes.json` | No Postman request found |
| Transfer fulfil callback | `PUT` | `/transfers/{ID}` | Payee/switch to requester | `Content-Type`, `Date`, `FSPIOP-Source`, `FSPIOP-Destination`, optional signing headers | `fulfilment`, `completedTimestamp`, `transferState`, optional `extensionList` | Adapter swagger `TransfersIDPutResponse`; Postman fulfil tests | Exists: `Golden_Path_Mojaloop` fulfil/abort tests |
| Transfer patch notification | `PATCH` | `/transfers/{ID}` | Switch to payee requester | `Content-Type`, `Date`, `FSPIOP-Source`, `FSPIOP-Destination`, optional signing headers | `completedTimestamp`, `transferState`, optional `extensionList` | Adapter swagger `TransfersIDPatchResponse` | No Postman request found |
| Transfer error callback | `PUT` | `/transfers/{ID}/error` | Payee/switch to requester | `Content-Type`, `Date`, `FSPIOP-Source`, `FSPIOP-Destination`, optional signing headers | `errorInformation` | Adapter swagger `ErrorInformationObject`; Postman fulfil-reject tests | Exists: `Golden_Path_Mojaloop` |
| FX transfer callback | `PUT` | `/fxTransfers/{ID}` | FXP/switch to requester | `Content-Type`, `Date`, `FSPIOP-Source`, `FSPIOP-Destination`, optional signing headers | `fulfilment`, `completedTimestamp`, `conversionState`, optional `extensionList` | Adapter swagger `FxTransfersIDPutResponse` | No Postman request found |
| FX transfer patch notification | `PATCH` | `/fxTransfers/{ID}` | Switch to requester | `Content-Type`, `Date`, `FSPIOP-Source`, `FSPIOP-Destination`, optional signing headers | `completedTimestamp`, `conversionState`, optional `extensionList` | Adapter swagger `FxTransfersIDPatchResponse` | No Postman request found |
| FX transfer error callback | `PUT` | `/fxTransfers/{ID}/error` | FXP/switch to requester | `Content-Type`, `Date`, `FSPIOP-Source`, `FSPIOP-Destination`, optional signing headers | `errorInformation` | Adapter swagger `ErrorInformationObject` | No Postman request found |
| Bulk quote callback | `PUT` | `/bulkQuotes/{ID}` | Payee/quoting service to requester | `Content-Type`, `Date`, `FSPIOP-Source`, `FSPIOP-Destination` | Bulk quote response fields vary by collection; archived tests show route shape | Postman archive | Exists only in archived Postman tests marked no implementation |
| Bulk quote error callback | `PUT` | `/bulkQuotes/{ID}/error` | Payee/quoting service to requester | `Content-Type`, `Date`, `FSPIOP-Source`, `FSPIOP-Destination` | `errorInformation` | Postman `Bulk API Transfers.postman_collection.json` | Exists: Postman-only in this checkout |
| Bulk transfer callback | `PUT` | `/bulkTransfers/{ID}` | Payee/bulk adapter to requester | `Accept`, `Content-Type`, `Date`, `FSPIOP-Source`, `FSPIOP-Destination`, optional signing headers | `bulkTransferState`, `completedTimestamp`, `individualTransferResults[]`, optional `extensionList` | Postman `Bulk API Transfers.postman_collection.json` | Exists: Postman-only in this checkout |
| Bulk transfer error callback | `PUT` | `/bulkTransfers/{ID}/error` | Payee/bulk adapter to requester | `Accept`, `Content-Type`, `Date`, `FSPIOP-Source`, `FSPIOP-Destination` | `errorInformation` | Postman `Bulk API Transfers.postman_collection.json` | Exists: Postman-only in this checkout |
| Transaction request state callback | `PUT` | `/transactionRequests/{ID}` | Payer/counterparty to transaction request service | `Content-Type`, `Date`, `FSPIOP-Source`, `FSPIOP-Destination`, `FSPIOP-HTTP-Method`, `FSPIOP-URI`, optional `Authorization` | `transactionId`, `transactionRequestState` | TTK received/rejected state collections | Exists: `Golden_Path_Mojaloop`, `ML_OSS_Golden_Path_LegacySim` |
| Authorization response callback | `PUT` | `/authorizations/{ID}` | Payer/counterparty to transaction request service | `Content-Type`, `Date`, `FSPIOP-Source`, `FSPIOP-Destination`, `FSPIOP-HTTP-Method`, `FSPIOP-URI`, optional `Authorization` | `authenticationInfo`, `responseType` | TTK `authorizations.json` | Exists: `Golden_Path_Mojaloop` authorization/error-framework tests |

## Representative JSON Bodies

These examples show the body shape only. Values are intentionally placeholder
variables because the harness and Postman collections fill IDs, dates, amounts,
ILP values, and parties dynamically.

### `POST /participants/{Type}/{ID}`

```json
{
  "fspId": "{{fspId}}",
  "currency": "{{currency}}"
}
```

### `POST /quotes`

```json
{
  "quoteId": "{{quoteId}}",
  "transactionId": "{{transactionId}}",
  "transactionRequestId": "{{transactionRequestId}}",
  "payer": {
    "partyIdInfo": {
      "partyIdType": "{{payerIdType}}",
      "partyIdentifier": "{{payerIdValue}}",
      "fspId": "{{payerFsp}}"
    }
  },
  "payee": {
    "partyIdInfo": {
      "partyIdType": "{{payeeIdType}}",
      "partyIdentifier": "{{payeeIdValue}}",
      "fspId": "{{payeeFsp}}"
    }
  },
  "amountType": "SEND",
  "amount": {
    "amount": "{{amount}}",
    "currency": "{{currency}}"
  },
  "transactionType": {
    "scenario": "TRANSFER",
    "initiator": "PAYER",
    "initiatorType": "CONSUMER"
  },
  "note": "{{note}}"
}
```

### `POST /transfers`

```json
{
  "transferId": "{{transferId}}",
  "payerFsp": "{{payerFsp}}",
  "payeeFsp": "{{payeeFsp}}",
  "amount": {
    "amount": "{{amount}}",
    "currency": "{{currency}}"
  },
  "expiration": "{{expiration}}",
  "ilpPacket": "{{ilpPacket}}",
  "condition": "{{condition}}",
  "extensionList": {
    "extension": [
      {
        "key": "{{key}}",
        "value": "{{value}}"
      }
    ]
  }
}
```

### `POST /fxQuotes`

```json
{
  "conversionRequestId": "{{conversionRequestId}}",
  "conversionTerms": {
    "conversionId": "{{conversionId}}",
    "initiatingFsp": "{{initiatingFsp}}",
    "counterPartyFsp": "{{counterPartyFsp}}",
    "amountType": "SENDING",
    "sourceAmount": {
      "amount": "{{sourceAmount}}",
      "currency": "{{sourceCurrency}}"
    },
    "targetAmount": {
      "currency": "{{targetCurrency}}"
    },
    "expiration": "{{expiration}}"
  }
}
```

### `POST /fxTransfers`

```json
{
  "commitRequestId": "{{commitRequestId}}",
  "determiningTransferId": "{{determiningTransferId}}",
  "initiatingFsp": "{{initiatingFsp}}",
  "counterPartyFsp": "{{counterPartyFsp}}",
  "sourceAmount": {
    "amount": "{{sourceAmount}}",
    "currency": "{{sourceCurrency}}"
  },
  "targetAmount": {
    "amount": "{{targetAmount}}",
    "currency": "{{targetCurrency}}"
  },
  "condition": "{{condition}}",
  "expiration": "{{expiration}}"
}
```

### `POST /bulkQuotes`

```json
{
  "bulkQuoteId": "{{bulkQuoteId}}",
  "payer": {
    "partyIdInfo": {
      "partyIdType": "{{payerIdType}}",
      "partyIdentifier": "{{payerIdValue}}",
      "fspId": "{{payerFsp}}"
    }
  },
  "expiration": "{{expiration}}",
  "individualQuotes": [
    {
      "quoteId": "{{quoteId}}",
      "transactionId": "{{transactionId}}",
      "payee": {
        "partyIdInfo": {
          "partyIdType": "{{payeeIdType}}",
          "partyIdentifier": "{{payeeIdValue}}",
          "fspId": "{{payeeFsp}}"
        }
      },
      "amountType": "SEND",
      "amount": {
        "amount": "{{amount}}",
        "currency": "{{currency}}"
      },
      "transactionType": {
        "scenario": "TRANSFER",
        "initiator": "PAYER",
        "initiatorType": "CONSUMER"
      }
    }
  ]
}
```

### `POST /bulkTransfers`

```json
{
  "bulkTransferId": "{{bulkTransferId}}",
  "bulkQuoteId": "{{bulkQuoteId}}",
  "payerFsp": "{{payerFsp}}",
  "payeeFsp": "{{payeeFsp}}",
  "individualTransfers": [
    {
      "transferId": "{{transferId}}",
      "transferAmount": {
        "amount": "{{amount}}",
        "currency": "{{currency}}"
      },
      "ilpPacket": "{{ilpPacket}}",
      "condition": "{{condition}}"
    }
  ],
  "expiration": "{{expiration}}"
}
```

### `POST /transactionRequests`

```json
{
  "transactionRequestId": "{{transactionRequestId}}",
  "payee": {
    "partyIdInfo": {
      "partyIdType": "{{payeeIdType}}",
      "partyIdentifier": "{{payeeIdValue}}",
      "fspId": "{{payeeFsp}}"
    }
  },
  "payer": {
    "partyIdType": "{{payerIdType}}",
    "partyIdentifier": "{{payerIdValue}}",
    "fspId": "{{payerFsp}}"
  },
  "amount": {
    "amount": "{{amount}}",
    "currency": "{{currency}}"
  },
  "transactionType": {
    "scenario": "TRANSFER",
    "initiator": "PAYEE",
    "initiatorType": "CONSUMER"
  },
  "authenticationType": "OTP",
  "expiration": "{{expiration}}"
}
```

### Error callback body

```json
{
  "errorInformation": {
    "errorCode": "{{errorCode}}",
    "errorDescription": "{{errorDescription}}"
  }
}
```

## Postman Coverage Summary

| Coverage status | Endpoints |
| --- | --- |
| Existing reusable Postman requests | `POST /participants/{Type}/{ID}`, `POST /participants/{Type}/{ID}/{SubId}`, `GET /parties/{Type}/{ID}`, `POST /quotes`, `GET /quotes/{ID}`, `POST /transfers`, `GET /transfers/{ID}`, `PUT /transfers/{ID}`, `PUT /transfers/{ID}/error`, `POST /bulkQuotes`, `GET /bulkQuotes/{ID}`, `PUT /bulkQuotes/{ID}/error`, `POST /bulkTransfers`, `GET /bulkTransfers/{ID}`, `PUT /bulkTransfers/{ID}`, `PUT /bulkTransfers/{ID}/error`, `POST /transactionRequests`, `GET /transactionRequests/{ID}`, `PUT /transactionRequests/{ID}`, `GET /authorizations/{ID}`, `PUT /authorizations/{ID}` |
| Harness-only or no clean Postman match in this checkout | `GET /participants/{Type}/{ID}`, `GET /participants/{Type}/{ID}/{SubId}`, `GET /parties/{Type}/{ID}/{SubId}`, `POST /fxQuotes`, `PUT /participants/{Type}/{ID}`, `PUT /participants/{Type}/{ID}/error`, `PUT /participants/{Type}/{ID}/{SubId}`, `PUT /participants/{Type}/{ID}/{SubId}/error`, `PUT /parties/{Type}/{ID}/error`, `PUT /parties/{Type}/{ID}/{SubId}`, `PUT /parties/{Type}/{ID}/{SubId}/error`, `PUT /quotes/{ID}/error` |
| Adapter swagger only in this checkout | `GET /fxTransfers/{ID}`, `PUT /fxTransfers/{ID}`, `PATCH /fxTransfers/{ID}`, `PUT /fxTransfers/{ID}/error` |
| TTK plus adapter swagger, missing Postman | `POST /fxTransfers` |
| Postman-only in this checkout | Bulk quote and bulk transfer routes |

## Supporting Test Setup APIs

These endpoints appear in harness/Postman flows but are not Mojaloop FSP ingress
endpoints. They are setup or simulator helper APIs and should not be mixed into
the core FSP communication contract.

| Method | Path | Role |
| --- | --- | --- |
| `POST` | `/repository/parties` | Adds a party to a simulator/backend test repository before a party lookup. |
| `POST` | simulator-specific `/payeefsp/parties/...` paths | Seeds Mojaloop simulator party data. |
| Various | Central Ledger admin `/participants/{name}/accounts`, `/participants/{name}/limits`, `/participants/{name}/positions` | Hub/admin setup, balance, and settlement checks. |
| `GET` | `/health`, `/metrics`, `/` | Service health, metrics, and metadata, not FSP transaction ingress. |
| `POST` | `/token` | OAuth/token setup for protected environments. |

## Follow-Up Gaps

- Add or confirm Postman coverage for FX quote and FX transfer flows:
  `POST /fxQuotes`, `POST /fxTransfers`, `GET /fxTransfers/{ID}`,
  `PUT /fxTransfers/{ID}`, `PATCH /fxTransfers/{ID}`, and
  `PUT /fxTransfers/{ID}/error`.
- Add Postman coverage for sub-id party lookup if that flow should be manually
  testable outside TTK: `GET /parties/{Type}/{ID}/{SubId}`.
- Add clean Postman coverage for FSP participant lookup/callback routes if those
  should be manually testable outside TTK. Existing Postman matches are mostly
  admin/setup requests or callback URL registrations.
- Decide whether archived bulk quote `PUT /bulkQuotes/{ID}` coverage should be
  revived, replaced, or explicitly left archived.
- Validate whether callback routes without current Postman matches should be
  tested through dedicated Postman requests or only through end-to-end callback
  assertions.

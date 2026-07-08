# Mojaloop FSP Ingestion Flow Guide

This guide explains the basic request flow from an FSP or the Mojaloop Testing
Toolkit into Mojaloop, then back out through asynchronous callbacks. It is a
companion to `docs/fsp-ingestion-endpoints.md`, which contains the detailed
endpoint inventory and representative payload shapes.

## Basic Request Flow

The standard P2P golden path is the clearest flow to follow first. It exercises
participant setup, discovery, agreement, transfer preparation, and callback
delivery without starting from the larger FX, bulk, or transaction-request
variants.

1. Provision participants and callback endpoints.
   - The TTK provisioning collections create the test participants in Central
     Ledger and register each participant's callback endpoint templates.
   - The important callback template types include participant, party, quote,
     transfer, transfer error, and sub-id variants.
   - In the local harness, `CALLBACK_ENDPOINT_BASE_URL` commonly points to the
     TTK callback server, for example `http://mojaloop-testing-toolkit:4040`.

2. Register or seed the payee party.
   - `POST /participants/{Type}/{ID}` goes to Account Lookup Service through
     `HOST_ACCOUNT_LOOKUP_SERVICE`.
   - The P2P happy path also seeds the simulator or test backend with the
     party details that will be returned during lookup.

3. Look up the payee party.
   - The payer FSP or TTK sends `GET /parties/{Type}/{ID}` to Account Lookup
     Service.
   - ALS accepts the request asynchronously and routes the lookup to the
     registered payee/counterparty endpoint.
   - The requester receives a `PUT /parties/{Type}/{ID}` callback containing
     the resolved party and payee FSP.

4. Request a quote.
   - The payer sends `POST /quotes` to Quoting Service through
     `HOST_QUOTING_SERVICE`.
   - The request includes `FSPIOP-Source` for the payer and
     `FSPIOP-Destination` for the payee.
   - Quoting Service forwards the request to the payee/counterparty callback
     endpoint and the payer receives a `PUT /quotes/{ID}` callback containing
     transfer amount, expiration, ILP packet, and condition.

5. Prepare the transfer.
   - The payer sends `POST /transfers` to ML API Adapter through
     `HOST_ML_API_ADAPTER` or the equivalent switch transfer host variable.
   - ML API Adapter validates the OpenAPI-backed request, maps it to the
     transfer handler, and produces a transfer prepare message to Kafka (see
     `docs/kafka-topics-quote-transfer.md` for the full topic inventory,
     including which topic carries quote-send vs transfer-send initiation).
   - Central services process the transfer internally. ML API Adapter's
     notification handler consumes notification events and sends the resulting
     `PUT /transfers/{ID}`, `PATCH /transfers/{ID}`, or
     `PUT /transfers/{ID}/error` callback to the appropriate FSP endpoint.

6. Assert asynchronous callbacks.
   - TTK requests usually expect an initial HTTP `202 Accepted`.
   - The actual business result is asserted from the callback, for example a
     quote response or a transfer callback with `transferState: COMMITTED`.
   - When websocket assertions are enabled, TTK also checks what the simulated
     FSP received directly.

At a service level, the common ingress path is:

```text
FSP or TTK
  -> Account Lookup Service: /participants, /parties
  -> Quoting Service: /quotes
  -> ML API Adapter: /transfers
  -> Kafka and central services
  -> ML API Adapter notification handler
  -> registered FSP or TTK callback endpoint
```

FX quotes/transfers, bulk quotes/transfers, and transaction-request-service
flows use the same broad pattern: an FSP-originated ingress request is accepted
asynchronously, internal services process it, and the result is returned through
registered callback endpoints. See `docs/fsp-ingestion-endpoints.md` for the
full list of those ingress and callback routes.

## Repo And API References

Use these files as the main reading path when tracing the flow end to end:

| Area | Reference |
| --- | --- |
| Endpoint inventory | `docs/fsp-ingestion-endpoints.md` |
| Kafka topic inventory for quote/transfer messages | `docs/kafka-topics-quote-transfer.md` |
| Test harness quick start and docker profiles | `ml-core-test-harness/README.md` |
| Runtime service topology | `ml-core-test-harness/docker-compose.yml` |
| TTK P2P happy path | `ml-core-test-harness/docker/ml-testing-toolkit/test-cases/collections/tests/golden_path/feature_tests/p2p_money_transfer/p2p_happy_path.json` |
| TTK provisioning order | `ml-core-test-harness/docker/ml-testing-toolkit/test-cases/collections/provisioning/master.json` |
| Participant callback onboarding | `ml-core-test-harness/docker/ml-testing-toolkit/test-cases/collections/provisioning/participant_sender.json`, `ml-core-test-harness/docker/ml-testing-toolkit/test-cases/collections/provisioning/participant_receiver.json` |
| TTK environment variables | `ml-core-test-harness/docker/ml-testing-toolkit/test-cases/environments/default-env.json` |
| ML API Adapter FSPIOP OpenAPI | `ml-api-adapter/src/interface/api-swagger.yaml` |
| ML API Adapter route bootstrap | `ml-api-adapter/src/shared/setup.js` |
| ML API Adapter operation handler map | `ml-api-adapter/src/api/handlers.js` |
| Transfer HTTP handler | `ml-api-adapter/src/api/transfers/handler.js` |
| Transfer Kafka producer domain | `ml-api-adapter/src/domain/transfer/index.js` |
| Notification callback consumer | `ml-api-adapter/src/handlers/notification/index.js` |
| Callback endpoint lookup | `ml-api-adapter/src/domain/participant/index.js` |
| ML API Adapter runtime config | `ml-api-adapter/src/lib/config.js`, `ml-api-adapter/config/default.json`, `ml-core-test-harness/docker/config-modifier/configs/ml-api-adapter.js` |

For the adapter path specifically, follow this chain:

```text
src/interface/api-swagger.yaml
  -> src/shared/setup.js
  -> src/api/handlers.js
  -> src/api/transfers/handler.js
  -> src/domain/transfer/index.js
  -> Kafka transfer topics
  -> src/handlers/notification/index.js
  -> src/domain/participant/index.js
```

## Authentication, Routing, And Test Environment

`Authorization` headers in the TTK and Postman collections are test-environment
behavior, not base FSPIOP headers. They appear when the harness, Postman
collections, or an OAuth-protected deployment requires bearer tokens. In the
local TTK environment, some token variables are placeholders such as
`NOT_APPLICABLE`, while Postman collections can populate bearer token variables
through OAuth setup requests.

### Key TTK Environment Variables

These variables are read from
`ml-core-test-harness/docker/ml-testing-toolkit/test-cases/environments/default-env.json`.

| Variable | Purpose |
| --- | --- |
| `HOST_ACCOUNT_LOOKUP_SERVICE` | FSPIOP participant and party lookup ingress, usually `http://account-lookup-service:4002` inside docker. |
| `HOST_QUOTING_SERVICE` | Quote and FX quote ingress, usually `http://quoting-service:3002`. |
| `HOST_ML_API_ADAPTER` | Transfer and FX transfer ingress, usually `http://ml-api-adapter:3000`. |
| `HOST_CENTRAL_LEDGER` | Admin/provisioning API used to create participants, positions, limits, and endpoint records. |
| `CALLBACK_ENDPOINT_BASE_URL` | Base callback URL registered for TTK-backed participants. |
| `*_CALLBACK_URL` | FSP callback endpoints for simulated or SDK-backed participants. |
| `*_SDK_TESTAPI_URL` | Test API endpoint for an SDK/simulator participant. |
| `*_SDK_TESTAPI_WS_URL` | Websocket endpoint used by TTK callback/request assertions. |
| `ENABLE_JWS_SIGNING` | TTK/Postman-side switch for generating JWS signing headers in requests. |
| `ENABLE_JWS_VALIDATION` | TTK/Postman-side switch for validating JWS signatures. |
| `ENABLE_PROTECTED_HEADERS_VALIDATION` | TTK-side switch for protected header validation. |
| `ENABLE_WS_ASSERTIONS` | Enables websocket assertions against simulator or SDK request/callback channels. |
| `SIMPLE_ROUTING_MODE_ENABLED` | Harness routing simplification used by local test flows. |

### Local Docker Profiles And Commands

Run a full local P2P flow with provisioning and tests:

```bash
cd ml-core-test-harness
docker-compose --profile all-services --profile ttk-provisioning --profile ttk-tests up
```

After services are already running, rerun only the tests in a separate terminal:

```bash
cd ml-core-test-harness
docker-compose --project-name ttk-test-only --profile ttk-tests up --no-deps
```

Run the golden-path profile set when using the GP collections:

```bash
cd ml-core-test-harness
docker-compose --profile all-services --profile ttk-provisioning-gp --profile ttk-tests-gp up
```

The TTK service and UI use different addresses depending on where the caller is
running:

| Caller | Address |
| --- | --- |
| Other docker containers | `http://mojaloop-testing-toolkit:4040` for callbacks and `http://mojaloop-testing-toolkit:5050` for CLI/API access. |
| Host browser/API client | `http://localhost:9440` for TTK callback/API port, `http://localhost:9550` for TTK CLI/API port, and `http://localhost:9660` for the TTK UI. |

### Callback Routing

Callback delivery depends on endpoint registration during provisioning:

1. Provisioning collections call Central Ledger admin APIs to create
   participant endpoint records, such as
   `FSPIOP_CALLBACK_URL_PARTIES_GET`, `FSPIOP_CALLBACK_URL_QUOTES`,
   `FSPIOP_CALLBACK_URL_TRANSFER_POST`, and transfer error variants.
2. ML API Adapter is configured with `ENDPOINT_SOURCE_URL`, which points to
   Central Ledger in the local harness.
3. The adapter initializes and uses the endpoint cache before sending
   notification callbacks.
4. The notification handler resolves the destination FSP and endpoint type,
   renders the registered URL template with IDs such as `transferId`, then
   sends the callback to the resolved URL.
5. Proxy routing can be enabled by the adapter proxy cache configuration. The
   local harness config modifier enables Redis-backed proxy cache settings for
   ML API Adapter.

If callbacks do not arrive, check these in order:

1. The participant was provisioned and has the expected Central Ledger endpoint
   records.
2. `CALLBACK_ENDPOINT_BASE_URL` or the FSP-specific callback URL points to a
   reachable service from inside the docker network.
3. ML API Adapter can reach `ENDPOINT_SOURCE_URL`.
4. Kafka and the notification handler are healthy.
5. JWS or protected-header validation settings match the headers generated by
   the test collection.

### ML API Adapter Configuration Notes

The local harness starts ML API Adapter with:

```text
/opt/app/config-modifier/run.js
  /opt/app/config/default.json
  /opt/app/config-modifier/configs/ml-api-adapter.js
  /opt/app/config/default.json
node src/api/index.js
```

The config modifier sets the adapter hostname, Central Ledger endpoint source,
Kafka broker addresses, Redis-backed proxy cache settings, TLS behavior, and
hub-side JWS signing key path. The adapter's default config also controls
`API_TYPE`, payload cache, endpoint cache expiry, protocol versions,
`HANDLERS.DISABLED`, `ENDPOINT_SECURITY.JWS.JWS_SIGN`, and
`ENDPOINT_SECURITY.JWS.JWS_VALIDATE`.

## Verification Checklist

For documentation-only changes, no code tests are required. Before relying on
this guide, verify:

- The referenced files still exist in the local checkout.
- `docs/fsp-ingestion-endpoints.md` still contains the detailed ingress and
  callback endpoint tables.
- The TTK environment values match the deployment being tested.
- Docker profiles match the intended test set: standard P2P, golden path, FX,
  or performance.
- Any bearer-token or JWS setting in the test collection is aligned with the
  target environment.

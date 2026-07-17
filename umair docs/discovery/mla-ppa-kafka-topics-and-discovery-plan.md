# MLA/PPA Kafka Topics and ALS Discovery Capture Plan

## Purpose

This note summarizes the Kafka topics already identified for quote and transfer consumption by the Mojaloop Adaptor (MLA), and the proposed approach for capturing Account Lookup Service (ALS) party discovery messages without changing ALS or other Mojaloop core services.

## Confirmed Quote Topics

The quote flow uses per-action Kafka topics, not a single `quoting-service` topic.

| Topic | Event carried | MLA relevance |
| --- | --- | --- |
| `topic-quotes-post` | `POST /quotes` quote request | Required. Captures quote initiation. |
| `topic-quotes-put` | `PUT /quotes/{ID}` quote callback and quote error callback | Required. Captures quote response or error. |
| `topic-quotes-get` | `GET /quotes/{ID}` | Optional. Not part of the normal request/callback pair. |

Additional quote-related topics exist for bulk and FX flows:

| Topic | Event carried | Status |
| --- | --- | --- |
| `topic-bulkquotes-post` | `POST /bulkQuotes` | Identified, not needed for basic P2P quote flow. |
| `topic-bulkquotes-put` | `PUT /bulkQuotes/{ID}` | Identified, not needed for basic P2P quote flow. |
| `topic-bulkquotes-get` | `GET /bulkQuotes/{ID}` | Identified, optional. |
| `topic-fx-quotes-post` | `POST /fxQuotes` | Identified from config/code, FX flow still to be validated live. |
| `topic-fx-quotes-put` | `PUT /fxQuotes/{ID}` | Identified from config/code, FX flow still to be validated live. |
| `topic-fx-quotes-get` | `GET /fxQuotes/{ID}` | Identified from config/code, optional. |

Quote payloads are plain JSON in the Kafka message body.

## Confirmed Transfer Topics

The transfer flow also uses per-action topics. The final notification event is published by Central Ledger, not by `ml-api-adapter`.

| Topic | Event carried | MLA relevance |
| --- | --- | --- |
| `topic-transfer-prepare` | `POST /transfers` transfer prepare request | Required. Captures transfer initiation. |
| `topic-transfer-fulfil` | `PUT /transfers/{ID}` fulfil, reject, abort, or transfer error path | Required. Captures transfer outcome. |
| `topic-transfer-get` | `GET /transfers/{ID}` | Optional. Not part of the normal prepare/fulfil pair. |
| `topic-notification-event` | Switch notification/final state event, equivalent to the FSD's `PATCH /transfers/{ID}` concept | Required if PPA needs final transfer state / `pacs.002`. Must be filtered or deduplicated. |

Additional transfer-related topics:

| Topic | Event carried | Status |
| --- | --- | --- |
| `topic-transfer-position` | Transfer position events | Identified, not needed for basic P2P transfer monitoring. |
| `topic-transfer-position-batch` | Batch transfer position events | Identified, not needed for basic P2P transfer monitoring. |
| `topic-admin-transfer` | Admin transfer events | Identified, not needed for basic P2P transfer monitoring. |

Transfer payloads arrive as a base64-encoded `data:` URI. MLA/PPA must decode transfer payloads before extracting fields such as `transferId`, `amount`, `condition`, `payerFsp`, and `payeeFsp`.

## Minimum MLA Subscription Set

For Phase 1 quote and transfer monitoring, MLA should consume at least:

```text
topic-quotes-post
topic-quotes-put
topic-transfer-prepare
topic-transfer-fulfil
topic-notification-event
```

Use a new consumer group for MLA/PPA consumers. Do not reuse Mojaloop service consumer groups such as `group-quotes-handler-post` or `ml-group-notification-event`, because sharing an existing group can steal partitions from Mojaloop's own handlers.

## ALS Discovery Problem

The FSD assumes ALS party discovery events are available on Kafka. In the current ALS implementation, party discovery is HTTP/callback based:

```text
GET /parties/{Type}/{ID}
PUT /parties/{Type}/{ID}
PUT /parties/{Type}/{ID}/error
```

ALS does not natively publish these discovery messages to Kafka. Since Mojaloop core services must remain unchanged, discovery messages need to be captured outside ALS.

## Proposed ALS Discovery Capture Architecture

Place a transparent discovery reverse proxy in front of the ALS API port.

```text
DFSPs / FSPIOP ingress
  -> Discovery Reverse Proxy
      -> real ALS API
      -> Discovery Event Collector
            -> topic-parties-get / topic-parties-put
                  -> MLA
                        -> PPA /PARTIES
                              -> Tazama TMS acmt.024
```

The proxy must forward the original request to ALS unchanged and must not require ALS code changes.

## Infra Placement

The proxy should sit on the ALS API path, replacing the endpoint clients currently use for ALS:

```text
Old:
clients -> account-lookup-service:4002 -> ALS

New:
clients -> account-lookup-service:4002 -> discovery proxy -> real ALS upstream:4002
```

In Kubernetes, this can be done by keeping the existing public/internal ALS service name pointed at the proxy and exposing the real ALS behind a new internal upstream service name, for example:

```text
account-lookup-service -> discovery proxy
account-lookup-service-upstream -> real ALS pods
```

In Docker Compose or local deployment, point `HOST_ACCOUNT_LOOKUP_SERVICE` or equivalent ALS client configuration to the proxy, and configure the proxy upstream to the real ALS container.

## Discovery Paths To Capture

The proxy/collector should capture:

```text
GET /parties/{Type}/{ID}
GET /parties/{Type}/{ID}/{SubId}

PUT /parties/{Type}/{ID}
PUT /parties/{Type}/{ID}/error

PUT /parties/{Type}/{ID}/{SubId}
PUT /parties/{Type}/{ID}/{SubId}/error
```

It should not capture unrelated ALS admin traffic.

## Recommended Discovery Topics

To stay aligned with Mojaloop's existing per-action topic pattern, use separate party discovery topics instead of a single combined topic.

```text
topic-parties-get
topic-parties-put
```

The closer match to existing Mojaloop quote behavior is to place error callbacks on the `put` topic and distinguish them by `body.errorInformation`.

| Topic | Event carried | MLA relevance |
| --- | --- | --- |
| `topic-parties-get` | `GET /parties/{Type}/{ID}` and `GET /parties/{Type}/{ID}/{SubId}` | Required. Captures discovery initiation. |
| `topic-parties-put` | `PUT /parties/{Type}/{ID}`, `PUT /parties/{Type}/{ID}/{SubId}`, and error callbacks containing `errorInformation` | Required. Captures discovery response or failure. |

If the implementation team prefers explicit error separation for operational clarity, add a third topic:

| Topic | Event carried | MLA relevance |
| --- | --- | --- |
| `topic-parties-error` | `PUT /parties/{Type}/{ID}/error` and `PUT /parties/{Type}/{ID}/{SubId}/error` | Optional alternative. Use only if not carrying errors on `topic-parties-put`. |

These topics keep MLA consistent with the FSD's Kafka-consumption model while making clear that they are produced by the external discovery capture component, not by ALS itself.

## Discovery Event Envelope

Example request event:

```json
{
  "msgType": "GET",
  "eventType": "PARTY",
  "id": "PARTY:MSISDN:923001234567",
  "path": "/parties/MSISDN/923001234567",
  "fspiop-source": "payerfsp",
  "fspiop-destination": "",
  "body": {},
  "timestamp": "2026-07-14T10:00:00.000Z"
}
```

Example callback event:

```json
{
  "msgType": "PUT",
  "eventType": "PARTY",
  "id": "PARTY:MSISDN:923001234567",
  "path": "/parties/MSISDN/923001234567",
  "fspiop-source": "payeefsp",
  "fspiop-destination": "payerfsp",
  "body": {
    "party": {
      "partyIdInfo": {
        "partyIdType": "MSISDN",
        "partyIdentifier": "923001234567",
        "fspId": "payeefsp"
      },
      "name": "Jane Doe"
    }
  },
  "timestamp": "2026-07-14T10:00:01.000Z"
}
```

For correlation, PPA should use:

```text
PARTY:{Type}:{ID}
PARTY:{Type}:{ID}:{SubId}
```

## Design Notes

- ALS remains unchanged.
- Oracle behavior remains unchanged.
- Central Ledger behavior remains unchanged.
- Quote and transfer events continue to come from existing Mojaloop Kafka topics.
- Party discovery events come from the new discovery capture proxy/collector and should follow Mojaloop's action-wise topic pattern.
- Collector failure should not block ALS discovery unless the business explicitly requires blocking fraud checks.
- `topic-notification-event` may produce multiple messages per transaction and needs filtering/deduplication before generating Tazama `pacs.002` messages.

## Open Items

1. Confirm final Kafka broker address and security settings for MLA consumers.
2. Confirm whether FX quote and FX transfer topics are in scope for Phase 1.
3. Confirm whether `topic-notification-event` filtering belongs in MLA or PPA.
4. Confirm deployment mechanism for the ALS discovery reverse proxy: Kubernetes Service, Ingress/Gateway, service mesh, or Docker Compose routing.
5. Confirm final event envelope schema for `PARTY` events, especially the derived `id` format.
6. Confirm whether party error callbacks should ride on `topic-parties-put` with `errorInformation`, or use a separate `topic-parties-error`.

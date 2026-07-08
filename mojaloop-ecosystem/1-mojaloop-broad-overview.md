# Mojaloop Ecosystem — Broad Overview

This is the concise version. For details, code citations, schema, and documented-vs-actual
discrepancies, see [`2.mojaloop-comprehensive-overview.md`](./2.mojaloop-comprehensive-overview.md).

Scope note: this document covers the four core switch services checked out in this workspace
(`account-lookup-service`, `quoting-service`, `central-ledger`, `ml-api-adapter`), verified
against their source code, cross-referenced with `docs.mojaloop.io`.

## 1. What Mojaloop Is

Mojaloop is an open-source **payment switch** (hub) that lets independent Digital Financial
Services Providers (**DFSPs** — banks, mobile-money operators, e-wallets) interoperate without
each one having to build a bilateral integration with every other DFSP. Instead, every DFSP
integrates once with the hub, and the hub does discovery, quoting, and clearing on their behalf.

The stated motivation (docs.mojaloop.io): connect DFSPs "into a competitive and interoperable
network in order to maximize opportunities for poor people to get access to financial services
with low or no fees" — avoiding both (a) a single monopoly provider and (b) a fragmented mess of
isolated, non-interoperable payment silos.

**A DFSP does not have to run Mojoloop's code** — it only has to implement the standard FSPIOP
REST interface the switch speaks. Mojoloop ships reference/example DFSP-side software (the
`sdk-scheme-adapter`, simulators) so a new participant has something to adapt rather than
building from a spec alone.

## 2. The Core Switch Services

| Service | One-line role | Talks to |
|---|---|---|
| **Account Lookup Service (ALS)** | Discovery: "which DFSP owns this party identifier (MSISDN, account number...)?" Routes lookups to pluggable external **Oracle** registries and manages the Oracle registry itself. | External Oracles (sync HTTP), central-ledger (sync HTTP, for participant validation + callback endpoints) |
| **Quoting Service** | Brokers the quote phase: relays a payer's quote request to the payee DFSP and relays the payee's fee/ILP-condition terms back. **Does not calculate fees itself** — it validates, persists, and forwards. | Shares central-ledger's MySQL DB directly; calls central-ledger's admin API for participant metadata |
| **Central Ledger** | The clearing/settlement engine: tracks every DFSP's net position per currency, enforces limits (Net Debit Cap), processes the transfer prepare→fulfil lifecycle over Kafka, and (in this codebase) also owns settlement-window/settlement-model logic. | Kafka (from ml-api-adapter's producers); own MySQL DB; MongoDB (bulk transfer payloads) |
| **ML API Adapter** | The FSPIOP-facing HTTP↔Kafka gateway for transfers: accepts `POST/PUT /transfers`, produces Kafka messages for central-ledger, and turns central-ledger's async notification back into an FSPIOP callback (`PUT`/`PATCH`/error) to the FSP. | Kafka (producer for transfers, consumer of notifications); central-ledger (for participant callback-endpoint resolution) |

Two services that are part of the broader Mojoloop reference deployment but **not checked out in
this workspace** (seen only as Docker images in `ml-core-test-harness/docker-compose.yml`):
**Transaction Requests Service** (mobile-initiated "request money" flows) and the standalone
**Central Settlement** service (a formerly-separate settlement service — in the version of
`central-ledger` checked out here, settlement-window logic has been absorbed into central-ledger
itself; see doc 2 §6 for the evidence and the caveat this implies).

## 3. How a Payment Flows (the "golden path")

```
FSP (Payer)                         Mojaloop Switch                          FSP (Payee)
────────────                        ────────────────                        ────────────
                 1. POST /participants/{Type}/{ID}  →  ALS  (onboarding: register party↔FSP)
                 2. GET  /parties/{Type}/{ID}        →  ALS  →  Oracle → resolves owning FSP
                    ←  PUT /parties/{Type}/{ID}  (callback: here's the payee FSP)
                 3. POST /quotes                     →  Quoting Service
                                                          → forwarded to Payee FSP's callback URL
                    ←  PUT /quotes/{ID}  (callback: fee terms, ILP condition, from Payee FSP)
                 4. POST /transfers                  →  ML API Adapter → Kafka (topic-transfer-prepare)
                                                          → central-ledger: validate, reserve payer position
                                                          → forwarded to Payee FSP (RESERVED)
                    (Payee FSP fulfils)  PUT /transfers/{ID}  → ML API Adapter → Kafka (topic-transfer-fulfil)
                                                          → central-ledger: commit payee position
                                                          → Kafka topic-notification-event
                    ←  PUT/PATCH /transfers/{ID}  (callback: COMMITTED, from ML API Adapter)
```

In plain terms, here's what's actually happening at each step:

- **Step 1 — Onboarding.** Before anyone can pay anyone, the payee's FSP has to tell the switch
  "this phone number / account belongs to one of my customers." It does this once, ahead of time,
  by registering the party with ALS. This is bookkeeping, not part of a live payment.
- **Step 2 — Discovery.** Now a customer wants to pay that phone number. The payer's FSP asks ALS
  "who owns this phone number?" ALS doesn't know itself — it asks an Oracle (a lookup registry)
  and gets back the answer, then relays it to the payer's FSP as a callback: "this number belongs
  to FSP X." The payer's FSP now knows who it's dealing with.
- **Step 3 — Quoting.** The payer's FSP asks the Quoting Service "if I send this amount, what
  will it actually cost, and what are the terms?" The Quoting Service forwards that question to
  the payee's FSP (who owns the customer receiving the money), and the payee's FSP calculates its
  own fees and sends back the terms (amount the payee will actually receive, any fees, and a
  cryptographic "condition" that will later prove the money was delivered). The payer's FSP gets
  this back as a callback and can now show the customer the real cost before they confirm.
- **Step 4 — Clearing (the actual transfer).** The customer confirms, and the payer's FSP submits
  the real transfer. ML API Adapter takes this in and hands it to Central Ledger, which checks
  the payer's FSP actually has enough funds/credit available and reserves that amount against
  them. The payee's FSP is told the transfer is reserved and ready, so it releases the funds/goods
  to its customer and confirms back ("fulfils") that it did so. Central Ledger then finalizes
  the payee's side of the ledger and the switch notifies both FSPs that the transfer completed.

Steps 1–2 are **discovery** (ALS), step 3 is **quoting** (Quoting Service), step 4 is **clearing**
(ML API Adapter + Central Ledger). Every ingress call to the switch returns an immediate HTTP
`202 Accepted`; the real result always arrives later as an asynchronous `PUT` callback to a URL
the FSP registered during onboarding. This 202-then-callback pattern is uniform across ALS,
Quoting Service, and ML API Adapter.

Bulk quotes/transfers and FX quotes/transfers follow the same shape (same endpoints family,
`/bulkQuotes`, `/bulkTransfers`, `/fxQuotes`, `/fxTransfers`) — FX transfers add a third party, an
**FXP (foreign exchange provider)**, converting funds between the payer's and payee's currencies
as a linked object next to the underlying transfer.

## 4. What Sits Around the Switch

- **DFSPs** — the participants; each has an account (position) per currency it can move funds in.
- **Oracles** — pluggable lookup registries behind ALS (e.g. an MSISDN→FSP directory). Mojoloop
  ships a reference MSISDN oracle (`als-msisdn-oracle-svc`); production deployments can plug in
  their own.
- **FXPs** — specialized participants that convert currency as part of an FX transfer.
- **SDK Scheme Adapter** — reference DFSP-side software that translates a simpler backend API
  into the full FSPIOP protocol, so a DFSP doesn't have to implement FSPIOP directly.
- **Mojaloop Testing Toolkit (TTK)** / **Simulator** — test harness tooling that plays the role of
  FSPs end-to-end for automated conformance/golden-path testing.
- **Reporting Hub ("Finance Portal")** — a separate set of services/UIs (`reporting-hub-bop-*`,
  `reporting-events-processor-svc`) for operational visibility into positions/transactions;
  not investigated in depth here.
- **The Hub itself is also a ledger participant** — central-ledger models a special `Hub`
  participant used for reconciliation and multilateral-settlement accounting (fees the scheme
  charges DFSPs land here).

## 5. Shared Infrastructure

- **Kafka** is the backbone between the HTTP-facing services (ml-api-adapter, quoting-service)
  and central-ledger — nothing about transfer/quote processing happens synchronously over HTTP
  once past the ingress call.
- **MySQL**: central-ledger and quoting-service **share one schema** (`central_ledger`) — quoting
  service reads/writes central-ledger's participant and quote tables directly. ALS has its own,
  separate MySQL database (routing metadata only, no participant/party data).
  MongoDB is used only for bulk-transfer payload storage inside central-ledger.
  Redis is used for inter-scheme proxy caches and payload caching, not primary storage anywhere.
- **Shared npm libraries** (`@mojaloop/central-services-shared`, `-error-handling`, `-stream`,
  `event-sdk`, `sdk-standard-components`) give every service the same Kafka wrapper, FSPIOP error
  model, JWS signing/validation, and distributed-tracing span propagation (a `trace` block
  travels on every Kafka message, correlating a request across all four services).

## 6. Documentation vs. Code — headline corrections

The public docs at `docs.mojaloop.io` are broadly accurate at the concept level but get a few
specifics wrong or over-simplified when checked against this codebase:

1. **Quoting Service does not calculate fees.** The docs say it does "calculation of possible
   fees and FSP commission" — in code, the payee DFSP calculates its own fees and quoting-service
   only validates, persists, and relays those numbers unmodified.
2. **ALS does not own "the participant registry."** It has no participant/FSP table at all —
   identity/existence validation is delegated to central-ledger over HTTP on nearly every request,
   and party-ownership records live in the external Oracle's own storage, not ALS's database.
3. **Settlement is not cleanly a separate service in this codebase.** Settlement-window and
   settlement-model logic lives inside `central-ledger/src/settlement/*` here, not in a standalone
   `central-settlement` service as some docs/diagrams imply — worth confirming against whatever
   version is actually deployed in production, since this may have changed over Mojoloop's
   release history.

Full evidence (file:line citations) for these and many more nuances is in doc 2.

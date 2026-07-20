# How Can I Get Real Account Numbers / IBANs?

Research answer to the question: *the PPA prototype fills `DbtrAcct` / `CdtrAcct`
(and the party identity fields) in the ISO 20022 pacs.008 / pacs.002 with
placeholders — where can real account numbers / IBANs actually come from in
Mojaloop?*

Sources for everything below: the FSPIOP v2.0 API spec
(`@mojaloop/api-snippets/docs/fspiop-rest-v2.0-openapi3-snippets.yaml`), the
four cloned core services (account-lookup-service, quoting-service,
central-ledger, ml-api-adapter), and https://docs.mojaloop.io. File and line
references are given so each claim can be checked directly.

---

## TL;DR

1. **Mojaloop has no separate "account number" field.** An account number or
   IBAN only ever appears as a **party identifier** — the `partyIdentifier`
   value carried inside `PartyIdInfo`, tagged with `partyIdType: ACCOUNT_ID`
   or `partyIdType: IBAN`. Confirmed both in the spec and on docs.mojaloop.io
   ("Account identifiers appear exclusively within the PartyIdInfo structure
   through the ACCOUNT_ID or IBAN partyIdType designations, not as standalone
   model elements elsewhere in the specification").

2. **Whether you get a *real* account number at all depends on which
   `partyIdType` the scheme uses.** Many Mojaloop deployments (including our
   local test harness) address parties by **MSISDN** (phone number), not by
   `ACCOUNT_ID`/`IBAN`. In those schemes there is no IBAN anywhere in the
   message flow to capture — the "account" is a phone number by design.

3. **The account/IBAN, when present, does *not* live on the transfer topics.**
   It travels on the **discovery** (`GET/PUT /parties`) and **quote**
   (`POST /quotes`) messages, one layer above the transfer. This is exactly
   why the PPA prototype — which only maps `topic-transfer-prepare` /
   `topic-transfer-fulfil` — has nothing real to put in `DbtrAcct`/`CdtrAcct`.

4. **The best place to get it for the PPA is the quote.** The payer/payee
   `PartyIdInfo` (identifier type + value, i.e. the IBAN/ACCOUNT_ID if used)
   arrives on `topic-quotes-post`, and is also **persisted by central-ledger**
   in the `quoteParty` table, keyed by `quoteId`. So it can be captured live
   from Kafka *or* queried from the DB after the fact.

---

## 1. Where account numbers live in the Mojaloop data model

### `PartyIdType` — the enum that carries account identity

`PartyIdType` (FSPIOP v2.0, `fspiop-rest-v2.0-openapi3-snippets.yaml:3938`) has
these values:

```
MSISDN | EMAIL | PERSONAL_ID | BUSINESS | DEVICE | ACCOUNT_ID | IBAN | ALIAS
```

Two of them are account numbers, per the spec's own descriptions:

- **`ACCOUNT_ID`** — "A bank account number or FSP account ID should be used as
  reference to a participant. The ACCOUNT_ID identifier can be in any format, as
  formats can greatly differ depending on country and FSP."
- **`IBAN`** — "A bank account number or FSP account ID is used as reference to
  a participant. The IBAN identifier can consist of up to 34 alphanumeric
  characters and should be entered without whitespace."

### `PartyIdInfo` — where the value sits

`PartyIdInfo` (`...:3917`) is the structure that carries it:

```yaml
PartyIdInfo:
  partyIdType:       # e.g. IBAN            <- the *kind* of identifier
  partyIdentifier:   # e.g. "GB33BUKB..."   <- the actual account number / IBAN
  partySubIdOrType:  # optional sub-account
  fspId:             # which FSP owns it
```

So the recipe for "real account number" is literally:
`partyIdType ∈ {ACCOUNT_ID, IBAN}` → read `partyIdentifier`.

### Key consequence

There is **no** dedicated account-number field, no account table in the switch
holding customer account numbers, and no guarantee an account number exists at
all for a given transfer. If the scheme addresses parties by `MSISDN`, the
`partyIdentifier` is a phone number and there simply is no IBAN in the flow.
This is a scheme design choice, not something the PPA can recover after the
fact.

---

## 2. How account identity enters and moves through Mojaloop

The account/party identifier is established during **discovery**, re-stated
during the **quote**, and then **absent** from the transfer. Following the
golden-path flow (see `docs/fsp-ingestion/fsp-ingestion-flow-guide.md`):

```
1. Discovery   GET /parties/{Type}/{ID}      <- {Type}/{ID} IS the identifier,
               PUT /parties/{Type}/{ID}          e.g. /parties/IBAN/GB33BUKB...
                                                  PUT callback returns full Party
2. Agreement   POST /quotes                   <- payload.payer / payload.payee
               PUT  /quotes/{ID}                  carry full PartyIdInfo again
3. Transfer    POST /transfers -> Kafka       <- only payerFsp / payeeFsp (FSP-level).
               topic-transfer-prepare/-fulfil     NO party identifier, NO account.
```

The identifier is at its richest at steps 1–2 and gone by step 3 — which is the
root cause of the PPA's placeholder problem.

### Step 1 — Discovery / Account Lookup Service (ALS)

`GET /parties/{Type}/{ID}` **is** the account lookup: `{Type}` is the
`PartyIdType` (e.g. `IBAN`) and `{ID}` is the `partyIdentifier` (the account
number itself). The requester gets back a `PUT /parties/{Type}/{ID}` callback
containing the full `Party` object (`...:3882`): `partyIdInfo`, `name`,
`personalInfo` (first/middle/last name, date of birth), `merchantClassificationCode`,
`supportedCurrencies`.

**Important — ALS does not store account numbers.** ALS resolves an identifier
to an FSP via an external **Oracle** and stores only routing metadata, not
customer/account data. Evidence from the cloned service:

- ALS DB migrations (`account-lookup-service/migrations/`) create only
  `currency`, `endpointType`, `partyIdType`, and `oracleEndpoint` tables —
  there is no party or account table.
- `account-lookup-service/src/models/oracle/facade.js` (`determineOracleEndpoint`,
  `oracleRequest`) takes `params.Type` + `params.ID` and looks up which
  **oracle** to ask; the oracle maps identifier → FSP, and the FSP itself holds
  the real account/customer record.
- ALS's own `CLAUDE.md`: "Key tables include participant and oracle endpoint
  mappings." No account storage.

So: **an Oracle knows *which FSP* owns an account identifier; only the FSP
knows the customer behind it.** The switch never persists the account number at
discovery time.

### Step 2 — Quote (the practical capture point)

`POST /quotes` (`QuotesPostRequest`, `...:4131`) carries the full `payer` and
`payee` `Party` objects — including their `PartyIdInfo` (so the IBAN/ACCOUNT_ID
if that's how they're addressed) **and** `personalInfo` (name, date of birth).
This is exactly what the PPA sees today on `topic-quotes-post`; a captured
sample is in `ppa-prototype/captured/topic-quotes-post.sample.json`
(that sample uses `MSISDN`, illustrating point 2 in the TL;DR).

Crucially, **central-ledger persists this**. The quote party data is written to
the `quoteParty` table (migration `central-ledger/migrations/500500_quoteParty.js`),
written from `quoting-service/src/model/quotes.js` (`handleQuoteRequest` →
`createQuoteParty`, ~line 319). Columns include:

| Column | Meaning |
| --- | --- |
| `quoteId` | join key back to the quote / transaction |
| `partyIdentifierTypeId` | FK → `partyIdentifierType` (MSISDN / ACCOUNT_ID / **IBAN** / …) |
| `partyIdentifierValue` (128) | **the actual identifier — the account number / IBAN** |
| `partySubIdOrTypeId` | optional sub-account |
| `fspId` / `participantId` | owning FSP |
| `merchantClassificationCode`, `partyName` | payee-merchant + display name |

The `partyIdentifierType` seed (`central-ledger/seeds/partyIdentifierType.js`)
confirms `MSISDN`, `ACCOUNT_ID`, and `IBAN` are all real rows. Personal name
detail is stored alongside in the `party` table
(`central-ledger/migrations/500600_party.js`: `firstName`, `middleName`,
`lastName`).

**This is the answer to "where do I get it after the fact":** if a payer/payee
was addressed by IBAN or ACCOUNT_ID, that real value is sitting in
central-ledger's `quoteParty.partyIdentifierValue`, joinable by `quoteId`.

### Step 3 — Transfer (too late)

`topic-transfer-prepare` / `topic-transfer-fulfil` carry only `payerFsp` /
`payeeFsp` (participant-level), the amount, transferId, and ILP proof data — no
party identifier, no account number. Confirmed against the captured samples in
`ppa-prototype/captured/` and documented in
`docs/user stories/cchfrms-38/fspiop-to-iso20022-gaps.md` (Gap 1).

---

## 3. Concrete options to get real account numbers into the PPA

Ordered by practicality for the PPA prototype.

### Option A — Join the quote to the transfer in-memory (recommended)

The PPA already consumes `topic-quotes-post`. Cache each quote's `payer`/`payee`
`PartyIdInfo` keyed by `quoteId` / `transactionId`, then when the matching
transfer arrives, enrich the pacs.008 `Dbtr`/`Cdtr`/`DbtrAcct`/`CdtrAcct` from
the cached party data instead of the placeholders.

- **Gets you:** real `partyIdentifier` (IBAN/ACCOUNT_ID *if the scheme uses
  them*), real names, date of birth, merchant code.
- **Already flagged** as the known fix path in
  `docs/user stories/cchfrms-38/what are the gaps?.md` §1 and
  `fspiop-to-iso20022-gaps.md` Gap 1.
- **Cost:** adds state + a quote→transfer correlation dependency (quote must
  arrive first) + a TTL/eviction policy for unmatched quotes.
- **Correlation key:** the quote's `transactionId` links to the transfer; the
  transfer's `transferId` equals the quote's `transactionId` in the standard
  P2P flow — verify this join holds in the target scheme before relying on it.

### Option B — Query central-ledger's `quoteParty` table after the fact

If live in-memory joining is undesirable, read
`quoteParty.partyIdentifierValue` (+ `party` table for names) directly from
central-ledger's MySQL DB, joined by `quoteId`. Same data as Option A, but
pulled from the durable store instead of a live cache — no ordering dependency,
at the cost of a DB read per transfer and a dependency on central-ledger's
internal schema.

### Option C — Query the ALS Oracle / FSP directly (discovery data)

`GET /parties/{Type}/{ID}` against ALS returns the live `Party` object. This is
the authoritative source but is a **new outbound dependency** and only tells you
the identifier you already have to supply — it's most useful for enrichment
(name/DOB) rather than for discovering the account number itself. Generally
redundant with A/B for the PPA's purposes.

### What none of these can fix

- **If the scheme addresses parties by `MSISDN`** (as our test harness does),
  there is **no IBAN/ACCOUNT_ID anywhere** — options A–C will return a phone
  number, because that *is* the account reference in that scheme. Getting a real
  IBAN then requires the scheme itself to onboard parties with `IBAN`/
  `ACCOUNT_ID` identifiers.
- **Settlement/regulatory metadata** (`SttlmMtd`, `ChrgBr`, `Purp`,
  `RgltryRptg`) still has no Mojaloop source — see
  `fspiop-to-iso20022-gaps.md` Gap 2. Unrelated to account numbers.

---

## 4. Summary table

| Question | Answer |
| --- | --- |
| Is there an "account number" field in Mojaloop? | No. Only `partyIdentifier` tagged `ACCOUNT_ID` or `IBAN` inside `PartyIdInfo`. |
| Does the switch always have a real account number? | No — depends on the scheme's `partyIdType`. MSISDN schemes have none. |
| Does ALS store account numbers? | No. ALS maps identifier → FSP via Oracles; only the FSP holds the account record. |
| Where does the account/IBAN appear in the flow? | Discovery (`GET/PUT /parties`) and quote (`POST /quotes`) — **not** the transfer. |
| Is it persisted anywhere queryable? | Yes — `central-ledger.quoteParty.partyIdentifierValue`, keyed by `quoteId`. |
| Best PPA fix? | Join cached quote party data (by `transactionId`/`quoteId`) onto the transfer before building the pacs.008. |

---

## References

**Local codebase**
- `ppa-prototype/src/tazama/iso20022.js` — the placeholder `DbtrAcct`/`CdtrAcct` being filled
- `ppa-prototype/captured/topic-quotes-post.sample.json` — real quote payload (MSISDN example)
- `account-lookup-service/migrations/` — ALS tables (no account/party storage)
- `account-lookup-service/src/models/oracle/facade.js` — oracle identifier→FSP resolution
- `quoting-service/src/model/quotes.js` — `handleQuoteRequest` → `createQuoteParty`
- `central-ledger/migrations/500500_quoteParty.js` — `quoteParty` schema (`partyIdentifierValue`)
- `central-ledger/migrations/500600_party.js` — `party` schema (names)
- `central-ledger/seeds/partyIdentifierType.js` — MSISDN / ACCOUNT_ID / IBAN rows

**Spec**
- `fspiop-rest-v2.0-openapi3-snippets.yaml:3938` — `PartyIdType` enum (ACCOUNT_ID, IBAN)
- `...:3917` — `PartyIdInfo` (partyIdType + partyIdentifier)
- `...:3882` — `Party` (partyIdInfo, name, personalInfo)
- `...:4131` — `QuotesPostRequest` (payer/payee Party)

**docs.mojaloop.io**
- FSPIOP logical data model — confirmed "Account identifiers appear exclusively
  within the PartyIdInfo structure through the ACCOUNT_ID or IBAN partyIdType
  designations, not as standalone model elements."

**Related internal docs**
- `docs/user stories/cchfrms-38/fspiop-to-iso20022-gaps.md` (Gap 1)
- `docs/user stories/cchfrms-38/what are the gaps?.md` (§1)
- `docs/fsp-ingestion/fsp-ingestion-flow-guide.md` (discovery → quote → transfer flow)
</content>
</invoke>

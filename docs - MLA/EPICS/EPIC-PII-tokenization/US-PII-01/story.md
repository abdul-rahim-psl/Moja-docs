# US-PII-01 — Classify and Tokenize Party Identity Fields Within MLA

**Epic:** PII Tokenization (implemented as part of MLA's own processing pipeline — not a separately deployed component)
**Source:** `docs/user stories/cch-pii-user-stories.md`

---

## Fields to Tokenize

*(Shared reference table from the source document, applicable to both US-PII-01 and US-PII-02.)*

| Field | Source Message | Location | Tokenize? | Notes |
| --- | --- | --- | --- | --- |
| Payer MSISDN | Quote request | `payer.partyIdInfo.partyIdentifier` | **Yes** | Plain JSON body, no ILP packet on this message |
| Payee MSISDN | Quote request | `payee.partyIdInfo.partyIdentifier` | **Yes** | |
| Payer legal name | Quote request | `personalInfo.complexName` | **Yes** | |
| Payer MSISDN | FXQuote request/callback | equivalent `partyIdInfo` field | **Yes** | Where present |
| Payee MSISDN | FXQuote request/callback | equivalent `partyIdInfo` field | **Yes** | Where present |
| Payer MSISDN | Transfer prepare (decoded ILP packet) | inside the ILP packet | **No — exempt** | Cryptographically bound into `condition`; rewriting breaks the transfer |
| Payee MSISDN | Transfer prepare (decoded ILP packet) | inside the ILP packet | **No — exempt** | Same reason |
| Payer display name | Transfer prepare (decoded ILP packet) | inside the ILP packet | **No — exempt** | Same reason |
| Transaction amount (all stages) | Quote, FXQuote, Transfer, FXTransfer | e.g. `amount`, `IntrBkSttlmAmt` | **No** | Must stay clear for Tazama's threshold/velocity rules |

## Description

Party identity fields are tokenized deterministically as part of MLA's own processing, before the event is packaged into an envelope and sent to PPA. This runs inside MLA itself — not a separately deployed pre-MLA component. PPA and everything downstream never see raw PII, the same guarantee the design has always intended; only which service performs the work has changed.

## Acceptance Criteria

- Tokenization applies to the fields listed in the Fields to Tokenize table above, on every applicable event type, before the event leaves MLA.
- Fields carried inside the decoded ILP packet on the Transfer prepare event are explicitly exempt, per the table — they are cryptographically bound and cannot be altered without breaking the transfer, so they reach PPA and TMS in cleartext regardless of this story.
- Tokenization is deterministic: the same input value always produces the same token for the life of the current key, so correlation across events still works without ever reversing a token.
- Transaction amounts are never tokenized, in any message.
- The forensic audit topic's own persisted record predates this step — it captures the raw event before tokenization ever runs. This is a property of the audit topic, not something this story changes, but it should be known to whoever owns that forensic record.

## Method

1. **Consume** — read the next event from the Mojoloop audit topic.
2. **Decode** — base64-decode Transfer/FXTransfer bodies; Quote/FXQuote bodies are already plain JSON and need no decoding.
3. **Classify** — determine the event type from the payload's shape, which decides both which fields get tokenized (per the Fields table above) and where the event is eventually routed to PPA.
4. **Validate signature** — check the DFSP's signature against the event exactly as received, before anything about the payload changes. Must happen before the next step.
5. **Tokenize** — once validated, walk the field list for that event type and hand each matching field's value off to be replaced with its token. (The token itself is produced per US-PII-02's construction — this step is only about *which* fields get touched and *when*, not *how* the token is computed.)

## Assumptions

- Tokenizing party-identity fields is data-protection work, not the kind of semantic understanding of a transaction MLA is otherwise meant to avoid — it sits alongside JWS signature validation as another transport-boundary check MLA already performs.
- What happens if tokenization can't run (block the event entirely, or let it through unprotected) is not yet decided and needs a decision from CCH before go-live.
- The audit-log masking rule (US-AUD-01, in `cch-crosscutting-user-stories.md`) still matters here — specifically for the ILP-packet-carried fields this story explicitly does **not** tokenize (see Fields table). Those fields stay cleartext all the way to PPA and TMS, so PPA's own audit-log masking is what protects them, not this story.
- The added processing time from this step counts against MLA's end-to-end ack-latency budget (≤200ms p95, US-PERF-01 in `cch-crosscutting-user-stories.md`). Expected to be negligible, but that should be confirmed under load rather than assumed.

## Todos

1. **Set up the Kafka consumer** for the Mojoloop audit topic — this is the starting point for the whole ingestion process. Depends on CCH issuing a dedicated consumer group ID: a reused DRPP-internal group name risks stealing partition assignments from a live payment-path handler, so this needs its own distinct identity assigned specifically to this service.
2. **Implement the field tokenization step** against the Fields to Tokenize list, including the ILP-packet exemption.
3. **Enforce the processing order** — signature validation ahead of tokenization — and write a test proving that validation fails if tokenization is accidentally moved ahead of it, so this ordering requirement is enforced automatically rather than relying on the code being written correctly by hand.
4. **Write tests** (Jest, 95% coverage target) covering: every field in the list gets tokenized, exempt ILP-carried fields are never touched, and the same input always produces the same output.
5. **Get CCH's decision** on fail-mode behaviour if tokenization can't run.
6. **Add a tokenization-failure-rate metric and alert**, separate from PPA's degraded-message-rate metric (US-MON-01, in `cch-crosscutting-user-stories.md`) — if the fail-mode ends up being pass-through, this is the only signal that PII is reaching PPA unprotected, so it can't be left uncovered. Where the alert itself routes to is not yet decided — see US-MON-01 (R-37).
7. **Confirm under load testing** (US-PERF-01) that tokenization overhead doesn't materially affect MLA's ack-latency budget at peak TPS.

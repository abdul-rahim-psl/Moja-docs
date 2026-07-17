# What Are The Gaps? — CCHFRMS-38

A consolidated list of everything left open by this pass, so the next session
can pick up with a clear list instead of re-discovering these. Pulled together
from `cchfrms-38-plan.md`, `ppa-prototype/README.md`, and the implementation
itself. Grouped by kind, roughly in order of "matters most for Tazama's rules
to produce meaningful results" first.

## 1. Mapping gaps — data that doesn't exist in a Mojaloop transfer message

These aren't bugs. Tazama's pacs.008/pacs.002 schemas ask for fields that a
Mojaloop transfer message simply never carries. The prototype fills them with
clearly-labelled placeholders (see `PLACEHOLDER` in `iso20022.js`) so Tazama
accepts the message, but the values aren't real.

- **No customer/party identity.** `Dbtr`, `Cdtr` (name, date/place of birth,
  contact details) and `DbtrAcct`/`CdtrAcct` (account identifiers) are all
  placeholders keyed only off the sending/receiving FSP's id. A Mojaloop
  transfer message only ever carries `payerFsp`/`payeeFsp` — participant-level
  identifiers, not the actual customer or their account. **This is the
  biggest gap** — if Tazama's fraud rules key off customer or account
  identity at all, none of that will be real in what this prototype sends
  today.
  - **Known fix path, not yet built**: the *quote* messages
    (`topic-quotes-post`/`topic-quotes-put`, already consumed by the
    CCHFRMS-33 prototype) do carry real `payer`/`payee` party details. A
    transfer's quote and the transfer itself share a `transactionId`, so the
    two could be joined in-memory (quote arrives first, cache it, enrich the
    later transfer message with it) to get real identity data into the
    pacs.008. Not attempted in this pass — flagged as the natural next step
    if identity data turns out to matter for Tazama's rules.
- **No settlement/regulatory metadata.** `SttlmInf.SttlmMtd`, `ChrgBr`,
  `ChrgsInf`, `Purp`, `RgltryRptg` — all placeholders (fixed values like
  `CLRG`, `DEBT`, `MP2P`, `"BALANCE OF PAYMENTS"`). None of these have any
  Mojaloop-side equivalent to source from.
- **`ilpPacket`, `condition`, `fulfilment` are dropped entirely — not even
  placeholdered.** This is different from the gaps above: these three fields
  *do* exist in the real FSPIOP payload (`ilpPacket`/`condition` on prepare,
  `fulfilment` on fulfil) and carry real cryptographic proof-of-transfer data.
  The `ml-schema-transformer-lib` mapping doc even names target ISO fields for
  them (`VrfctnOfTerms.IlpV4PrepPacket`, `ExctnConf`). But TMS's actual
  `pacs.008.001.10`/`pacs.002.001.12` AJV schemas (confirmed by reading them
  directly) have **no field at all** to put this data in — so it's silently
  discarded on the way in. Worth flagging: if a future Tazama rule ever needs
  to verify transfer integrity/proof data, this schema version can't carry
  it, and it's not something this prototype's mapping code can fix on its own.

## 2. Mapping choices made without a confirmed spec

These were implemented and work end-to-end, but nobody has confirmed they're
the *right* choice, only that they're reasonable and pass Tazama's validation:

- **`transferState → TxSts` enum mapping** (`COMMITTED→ACSC`,
  `ABORTED`/`REJECTED→RJCT`, `RESERVED→ACSP`, else `PDNG`) — the story never
  specified this mapping. Confirmed live that a `COMMITTED` transfer produces
  `ACSC` in Tazama's database, but the mapping itself is an assumption.
- **`EndToEndId`/`InstrId` both set to the raw FSPIOP `transferId`** — FSPIOP
  only gives one id, so there was no real choice here, but it's still
  unconfirmed against any spec. Note the upstream `ml-schema-transformer-lib`
  doc actually suggests a different target field entirely (`PmtId.TxId`, not
  `EndToEndId`) — but that doc targets a newer ISO message version
  (`pacs.008.001.13`) that TMS's actual schema (`.001.10`) doesn't have, so
  its guidance doesn't transfer over cleanly. Worth re-checking if Tazama is
  ever upgraded to validate against a newer pacs.008/pacs.002 version.
- **`GrpHdr.MsgId` derived as `<transferId>-pacs008` / `<transferId>-pacs002`**
  — not a mapping choice so much as a constraint discovered the hard way (see
  "Bugs found" in `cchfrms-38-plan.md`): Tazama requires message ids to be
  globally unique per tenant, so the natural choice (reuse `transferId`)
  doesn't work. The chosen format is deterministic and traceable but entirely
  invented by this prototype — there's no real-world "message id" concept on
  the Mojaloop side to draw from.

## 3. Scope gaps — deliberately not covered by this pass

- **Tenant handling.** Tazama resolves `TenantId` server-side, defaulting to
  `DEFAULT` since the local deployment runs unauthenticated. No decision has
  been made about how multiple DFSPs should map to Tazama tenants once this
  moves beyond a single-tenant local prototype.
- **`topic-transfer-get` and `topic-notification-event`** are consumed and
  stored by the prototype (carried over from CCHFRMS-33) but not forwarded to
  Tazama. Not asked for by this story, but worth a conscious decision later —
  `topic-notification-event` in particular could be a second, independent way
  to observe transfer outcomes.
- **FX transfers, bulk transfers, error-path/aborted-at-the-network-level
  messages** — never observed live against the test harness in either the
  CCHFRMS-33 or this pass, so there's no verified payload shape to map from
  yet. Excluded from scope, not just unimplemented.
- **pain.001/pain.013 (quote-side ISO ingestion).** Tazama's TMS supports
  ingesting these too, but this story was transfer-only. Not attempted.
- **Broader transfer-outcome coverage.** Only the P2P happy path
  (`COMMITTED`) was driven through live end-to-end. Aborted/rejected
  transfers, timeouts, and concurrent/overlapping transfers were not
  exercised — only the `transferState → TxSts` mapping's *code* covers them
  (via the enum table), not live verification.
- **Consumer resilience.** Restart-and-replay behavior (what happens if the
  prototype restarts mid-stream and re-consumes messages already sent to
  Tazama — does it double-post?) was not tested. `KAFKA_FROM_BEGINNING` and
  Kafka consumer offset behavior interact here and haven't been thought
  through for the Tazama-forwarding path specifically.
- **Server/production deployment.** Everything in this pass ran against two
  local Docker stacks on one machine. Porting the Kafka broker address and
  TMS URL to a real, shared environment — and everything that implies
  (network access, credentials, TLS, `AUTHENTICATED=true` on TMS) — is
  untouched.

## 4. Infrastructure gaps found in the Tazama local deployment itself

Not CCHFRMS-38 mapping gaps, but real bugs found and fixed in the
`Full-Stack-Docker-Tazama` checkout while getting the environment running.
Fixed locally; **not yet upstreamed**:

- `EVENT_HISTORY_DATABASE_PASSWORD` was blank in four `env/*.env` files
  instead of matching Postgres's actual password.
- `network_map` table was missing a real `active` column that the `dev`
  branch of `frms-coe-lib` (which these Docker images are built from)
  queries against — the fix (`main` branch) exists upstream but hasn't been
  backported/released to `dev` yet.
- `account` table was missing a `creDtTm` column that the same library
  writes to — same underlying pattern as the `network_map` issue, a second
  instance of "the schema and the library's `dev` branch have drifted."
- `admin-service`'s env file was missing two entire database config blocks,
  and one of those (`SIMULATION_DATABASE`) has no schema published anywhere
  upstream at all — only stubbed enough to stop it crash-looping, the actual
  "Simulation Studio" feature it backs remains non-functional.

**Worth doing next**: raise these with the `Full-Stack-Docker-Tazama` /
`frms-coe-lib` maintainers, since anyone else standing this stack up locally
from a fresh clone will likely hit the same four issues.

## Suggested priority for next session

1. Decide whether customer/account identity matters for Tazama's rules to be
   meaningful — this determines whether the quote-enrichment work (§1) is
   worth doing at all.
2. Get a real answer on the `TxSts` mapping and tenant strategy (§2, §3) from
   whoever owns the Tazama integration decision.
3. Exercise the non-happy-path transfer outcomes (§3) — cheap to do, closes a
   real coverage gap.
4. Upstream the four infrastructure fixes (§4) so the next person's local
   setup doesn't hit the same wall this session did.

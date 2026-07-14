# What We Did — CCHFRMS-38

## The goal

Ingest Mojaloop transfer messages into Tazama. Specifically: consume the Kafka
messages for a transfer's prepare and fulfil legs, convert them to the ISO
20022 message types Tazama expects (pacs.008 for prepare, pacs.002 for
fulfil), and confirm Tazama actually accepts and processes them — all running
locally first, before anything touches a real server.

## How we did it

1. **Read the story and found we weren't starting from zero.** The CCHFRMS-33
   prototype (`ppa-prototype/`) already consumed the right Kafka topics
   (`topic-transfer-prepare`, `topic-transfer-fulfil`) and already decoded
   their base64 payloads. So the new work was really just two things: build
   the FSPIOP→ISO 20022 transform, and add Tazama as a destination for it.

2. **Brought up both stacks locally** — Tazama's full-stack Docker deployment
   and Mojaloop's `ml-core-test-harness`, side by side on the same machine.
   Neither came up clean on the first try: Tazama had several real bugs in
   its local checkout (wrong env vars, a couple of database schema columns
   that were missing but expected by the code). We root-caused each one
   against the actual upstream source rather than guessing, fixed them, and
   got every service healthy.

3. **Figured out exactly what Tazama expects.** Rather than trust the API
   guide alone, we pulled Tazama's real validation schemas for pacs.008 and
   pacs.002 and compared them field-by-field against what the Mojaloop
   transfer messages actually contain. This showed clearly which fields map
   over directly (amount, currency, FSP ids, transfer state) and which ones
   simply don't exist in a Mojaloop transfer message (customer identity,
   account details, settlement metadata) — those had to be filled in with
   clearly-labelled placeholder values so Tazama would accept the message.

4. **Built the transform and wired it in.** Added a small module that turns a
   decoded transfer message into the right ISO 20022 shape, plus a client
   that posts it to Tazama. This was added onto the existing Kafka consumer
   as an extra step — if Tazama is down or rejects a message, the prototype
   keeps consuming and logging as before, it doesn't break.

5. **Proved it end-to-end with real traffic.** Ran an actual test transfer
   through Mojaloop and watched it flow all the way through: Kafka → the
   prototype → Tazama, landing correctly in Tazama's database with the
   prepare and fulfil legs properly linked together. Also deliberately sent
   a broken message to see how Tazama reports a rejection, so that failure
   path is understood too, not just the happy path.

6. **Wrote it all down.** The prototype's README now explains how to run the
   Tazama ingestion piece and what its limitations are, and the plan doc in
   this folder captures the full trail — what was found, what was fixed, and
   what's still an open question for whoever picks this up next.

## Where it stands

Working prototype, running locally, proven against live Mojaloop traffic.
Known open items (missing customer/account identity data, tenant handling,
server deployment) are written up in `cchfrms-38-plan.md` in this same
folder, not hidden — this is a deliberately honest first pass, not a
finished production integration.

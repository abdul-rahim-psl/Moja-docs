<!-- SPDX-License-Identifier: Apache-2.0 -->

# Summarized Steps — MLA & PPA (POC)

Plain-language walkthrough of each step in [`mojaloop-adaptor-and-payment-platform-adaptor.md`](mojaloop-adaptor-and-payment-platform-adaptor.md), from 0.1 to 0.6. Each entry explains the problem the step exists to solve and what actually happens, in simple words, without needing the surrounding document.

---

## 0.1. Consume the Audit Topic

**Problem:** Something needs to read every event a Mojaloop payment produces, without touching the live payment switch itself.

**What happens:** The MLA subscribes to one dedicated Kafka topic, `topic-event-audit`, and reads it one record at a time. It never touches the switch's actual live payment topics — it only reads a forensic copy that's fed off to the side. Because that audit topic already durably stores everything before the MLA even sees it, the MLA doesn't need its own backup queue for failed messages: if something goes wrong, it just doesn't move its "bookmark" (offset) forward, and the record is still sitting there to retry later.

---

## 0.2.1. Select the Canonical Record

**Problem:** Every step of a payment gets written to the audit topic *twice* — once when it starts (`start`) and once when it finishes (`egress`). If the MLA acted on both, it would send two copies of everything downstream — e.g. two `pacs.008` messages for one real transfer.

**What happens:** The MLA uses a fixed lookup table, `CANONICAL_ACTION_BY_OPERATION`, checked through a function called `isCanonicalRecord`. For each type of step, the table has a fixed answer for whether the "start" record or the "egress" record is the one that counts — and it throws away the other one. It's not a blanket "always take start" rule, because some steps (like the final settlement step, `commitTransfer`) only ever show up as `egress` and never as `start` — so the table is checked per-step, not applied as one universal rule.

---

## 0.2.2. Classify the Event

**Problem:** The MLA needs to know *what kind* of event it's looking at — a quote, an FX quote, a transfer, or an FX transfer — without having to dig through the actual message content.

**What happens:** Every record carries a tag called `operation` that names the exact step (e.g. `postQuotes`, `prepareFxTransfer`, `prepareTransfer`). The MLA just looks up that tag in a table to get an `eventType` (`QUOTE`, `FXQUOTE`, `TRANSFER`, `FXTRANSFER`) and a `msgType` (`request`, `callback`, `notification`). No guessing from the payload is needed — even telling an FX transfer apart from a domestic one is just reading the tag name.

---

## 0.2.3. Resolve the Anchor Identifier

**Problem:** Every event needs one single ID that ties it back to "this one payment," so all the fragments of that payment can later be reassembled.

**What happens:** The MLA picks one anchor ID per payment — preferring `transactionId`, then `transferId`, then `determiningTransferId`, whichever is present. Two step-types don't carry any of those IDs directly (`putQuotesByID` and `reserveFxTransfer`) — for those, the MLA remembers the anchor ID from an earlier related record it already saw (kept in a small in-memory lookup map), and uses that instead.

---

## 0.2.4. Build the Event Envelope

**Problem:** The MLA and PPA need one common, standard "package" format to hand events between them — not the raw Mojaloop record shape.

**What happens:** The MLA builds a small standard object (the "Event Envelope") containing who sent it, who it's for, the anchor ID, a freshly generated tracking ID, the message body, and a timestamp. It uses whichever form of the body is more structured and easier to work with (the FSPIOP JSON form, when available) rather than the raw ISO form. If building this envelope fails for some reason, that record is logged and skipped for good — it's treated as unfixable, not something to retry.

---

## 0.3. Dispatch the Event Envelope

**Problem:** The MLA has to hand the envelope to the PPA safely — without ever losing an event or accidentally sending it twice.

**What happens:** The MLA sends (POSTs) the envelope to the PPA and only advances its Kafka bookmark *after* getting a response back. If the PPA says "got it" (`200`), move on. If the PPA says the message itself is bad (`4xx`), log it and move on anyway — retrying a broken message won't fix it. If the PPA is down or erroring (`5xx`/timeout), retry a few times, and if it still fails, pause and keep checking until the PPA comes back healthy. This ordering — waiting for confirmation before moving the bookmark — is what guarantees no event silently disappears.

---

## 0.4. Persist the Event Envelope

**Problem:** If the PPA process crashes right after saying "got it" but before doing anything with the event, that event must not be lost.

**What happens:** Before the PPA tells the MLA "got it," it first checks that its storage systems are actually reachable and writes the envelope safely to disk. Only after that write succeeds does it respond `200`. If storage isn't reachable, it says so (`503`) instead of pretending everything's fine — which naturally makes the MLA hold that event back rather than treat it as handled.

---

## 0.5.1. Classify the Trigger or the Enrichment

**Problem:** Not every event should cause an outbound message. Some events are the "main event" for a payment stage; others just add background detail to be used later.

**What happens:** Every incoming envelope gets sorted into one of two roles: a **trigger** — which causes exactly one message to be sent onward — or an **enrichment** — which just adds information to what's known about the payment so far, without sending anything itself. A quote event is unusual: it's *both* — it fires its own message immediately, and its details are also saved for later steps to use.

---

## 0.5.2. Merge the Enrichment

**Problem:** Multiple pieces of information about the same payment can arrive from different events (and even from different PPA replicas at the same time), and none of those updates should get lost or overwrite each other.

**What happens:** All the accumulated details for one payment are kept in a fast temporary store (ValKey), with each piece of information saved in its own separate slot. Every update to that store runs as one indivisible operation, so two updates arriving at almost the same moment can't clobber each other — each one safely lands in its own slot.

---

## 0.5.3. Resolve the Correlation State

**Problem:** Because of how Kafka delivers messages, the "final settlement" event for a payment can sometimes actually arrive *before* the "transfer prepare" event it's supposed to follow — so the PPA might look for accumulated state that isn't there yet.

**What happens:** When a trigger fires and finds nothing saved yet, the PPA doesn't just give up. It checks whether the missing state was already safely copied off to longer-term storage (because it was about to expire), and if not, it waits a short moment and checks again — since the real state might just be a few seconds behind on a different Kafka partition. If neither works, it "parks" the event and comes back to it once the missing piece shows up, even much later.

---

## 0.5.4. Discard the Domestic Transfer

**Problem:** This system is only meant to handle cross-border (FX) payments, not purely domestic ones — but a domestic transfer looks the same as an early-stage cross-border one until proven otherwise.

**What happens:** When a transfer's "prepare" event arrives, the PPA checks whether there's any related FX-quote information already accumulated for that payment. If there isn't, it assumes the payment is domestic and drops it — before building any message — rather than sending something that shouldn't have been sent at all.

---

## 0.5.5. Translate the Message

**Problem:** Mojaloop's version of a message doesn't match the exact shape Tazama's system expects, so the raw data can't just be forwarded as-is.

**What happens:** The PPA builds exactly one properly-formed ISO 20022 message (one of four types) out of the trigger event plus everything accumulated so far for that payment. It fixes up mismatched field names and formats, and translates status codes into the vocabulary Tazama understands. If something needed for the message is still missing at this point, the message is still sent — but honestly flagged as "degraded" rather than silently sent as if complete.

---

## 0.5.6. Validate the Message

**Problem:** Tazama's own system is lenient — if a message has a field that doesn't quite match what it expects, it silently strips that field out and still accepts the message, hiding the problem.

**What happens:** Before sending anything, the PPA checks the message itself against its own saved copy of Tazama's validation rules. This is the only place a mismatch actually gets caught and reported, instead of quietly disappearing. If validation fails here, the message is not sent — it's logged as a genuine defect that needs to be fixed, not something to retry.

---

## 0.5.7. Record the Audit Entry

**Problem:** Once a message reaches Tazama, there's no way to tell afterward whether it was complete or "degraded" — that distinction needs to be written down somewhere, or it's lost forever.

**What happens:** The PPA writes an entry recording what came in, what was sent out, the outcome, and whether the message was degraded — filed under the payment's own ID so a reviewer can look up everything that happened to one payment in order. Sensitive details like phone numbers and names are masked before being written down, though this masking only covers what this pipeline writes to logs/audit — it doesn't touch what's actually sent to Tazama, which still needs the real data.

---

## 0.6. Submit the Message

**Problem:** The final message needs to actually reach Tazama reliably, without ever being sent twice for the same real-world payment step.

**What happens:** The PPA sends the finished message to Tazama's API. Before sending, it claims a quick "already sent?" guard so the same message can't go out twice. If a retry is needed, it resends the *exact* message built earlier rather than rebuilding it — rebuilding would generate a new message ID and could create a duplicate record on Tazama's side. Once the final message for a payment succeeds, the PPA clears out everything it had accumulated for that payment — its job for that payment is done.

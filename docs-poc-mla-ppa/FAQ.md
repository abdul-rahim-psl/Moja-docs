<!-- SPDX-License-Identifier: Apache-2.0 -->

# FAQ — MLA & PPA (POC)

Plain-language answers to questions raised while reading [`mojaloop-adaptor-and-payment-platform-adaptor.md`](mojaloop-adaptor-and-payment-platform-adaptor.md). Each entry links back to the step it's about.

---

## Q1. What does "select exactly one record per logical step, using `CANONICAL_ACTION_BY_OPERATION`" mean? (0.2.1)

Every step of a payment gets written to the audit topic **twice** — once when it starts (`start`) and once when it finishes (`egress`). If the MLA acted on both, it would send two copies of everything downstream — e.g. two `pacs.008` messages for one real transfer.

The MLA needs a rule for "which one of this pair do I actually act on, and which do I ignore?" That rule is a fixed lookup table, `CANONICAL_ACTION_BY_OPERATION`, checked through a function called `isCanonicalRecord`. For each type of step, the table has a fixed answer for whether the `start` record or the `egress` record is the one that counts — and it throws away the other one.

It's not a blanket "always take `start`" rule, because the pairing isn't symmetric: some steps (e.g. `commitTransfer`, the `pacs.002` trigger) only ever show up as `egress` and never as `start` at all — so a universal rule would silently drop those entirely. The table is checked per-operation, not applied generically.

---

## Q2. How exactly does the project resolve the anchor identifier for `putQuotesByID` and `reserveFxTransfer`? (0.2.3)

Every payment needs one single ID (the **anchor identifier** — usually `transactionId`) that ties all its fragments together. Two step-types don't carry that ID directly in their tags: `putQuotesByID` (only has `quoteId`) and `reserveFxTransfer` (only has `commitRequestId`/`conversionId`). Both are resolved by **chaining** through small in-memory maps kept inside the MLA process (`mla/src/services/logic.service.ts`):

- `quoteIdToAnchor` — a `Map<quoteId, anchor>`, capped at 10,000 entries.
- `fxTransferIdToAnchor` — a `Map<commitRequestId|conversionId, anchor>`, capped at 10,000 entries.

**Mechanism:**
1. Earlier in the same payment's life, the *request*-side record (`postQuotes` for quotes, `prepareFxTransfer` for FX transfers) **does** carry the real anchor. When the MLA processes that record, it writes the mapping into the relevant map (`rememberQuoteAnchor` / `rememberFxTransferAnchor`).
2. When the later callback record (`putQuotesByID` / `reserveFxTransfer`) arrives with no anchor in its tags, `resolveAnchorId` falls back to looking up its `quoteId` (or `commitRequestId`/`conversionId`) in that map and gets the anchor back.
3. This is safe because Kafka guarantees ordering *within a partition*, and both halves of one leg (request and callback) share a partition — so the request is always processed, and its mapping remembered, before the callback shows up.

These maps are **per-MLA-instance, in-memory bookkeeping only** — never shared state, never written to ValKey or persisted. If neither the tags nor the chained map has an answer, `resolveAnchorId` returns nothing and `buildEnvelope` throws — treated as a permanent, unrecoverable failure for that one record (logged and skipped).

Note: the `reserveFxTransfer` chain was not present from day one — it was found missing by running the replay tool against real capture data, then added to mirror the `putQuotesByID` pattern exactly (see `plan-outline.md`, "Tier 1.5").

---

## Q3. How exactly does accumulation happen in ValKey — what's the ID everything gets collected against? (0.5.2 / "reads whatever has accumulated")

Everything traces back to one thing: the anchor identifier resolved by the MLA in Q2, carried untouched as `envelope.id`. The PPA never re-derives it — it just uses `envelope.id` as the key everywhere in `ppa/src/clients/cache.ts` (`mergeState(envelope.id, ...)`, `getState(envelope.id)`, `deleteState(envelope.id)`).

Inside ValKey, that ID becomes the key:

```
correlation:<envelope.id>
```

So every enrichment and every trigger lookup for one payment's entire lifetime hits the exact same ValKey key — e.g. `correlation:01KZRP0E6JT2BX5EA20AQPTX6F`.

---

## Q4. What exactly does "each piece of information saved in its own separate slot" mean? (0.5.2)

The ValKey key above isn't one JSON blob — it's a Redis **hash**: one dictionary-like structure under a single key, where each entry (**field**) can be written and read independently without touching the others. For one payment, the hash has fixed, pre-named fields — one per enrichment stage:

```
correlation:<id>
├── quote            (JSON)
├── quoteCallback     (JSON)
├── fxQuote           (JSON)
├── fxQuoteCallback   (JSON)
├── fxTransfer        (JSON)
├── correlationId
├── createdAt
└── updatedAt
```

Each merge (`CacheClient.mergeState`) runs one atomic Lua script that:
1. `HSETNX ... createdAt <now>` — sets `createdAt` only if the leg doesn't exist yet (first enrichment "creates" it; every later one is a no-op here).
2. `HSET ... <field> <value> correlationId <id> updatedAt <now>` — writes **only the one field this event is about**, plus refreshes `correlationId`/`updatedAt`. Every other field already in the hash is left completely untouched.
3. `EXPIRE ...` — resets the ~70s TTL.

**Why this matters:** the alternative — treating state as one JSON blob (`GET` the whole thing, mutate it in app code, `SET` it back) — is unsafe under concurrency. If two events for the same payment arrive close together (even from two different PPA replicas), both would `GET` the same starting blob, each add their own field locally, and whichever `SET` lands second **overwrites the whole blob**, silently erasing the other event's contribution. Because each merge only ever names its own field and runs as a single atomic ValKey command, two concurrent merges to *different* fields on the same key can never clobber each other — there's no "read a stale copy in app code" step at all.

---

## Q5. How can the "final settlement" event actually arrive before the "transfer prepare" event? (0.5.3)

This is a real, confirmed condition rooted in how Kafka works — not a defensive hypothetical.

**The mechanism:**
1. Kafka guarantees strict ordering **only within one partition**. Across partitions, there is no ordering guarantee at all — it depends on production timing and how fast the consumer happens to poll each partition.
2. Which partition a record lands on is decided by hashing its **key** — and the Kafka key here is the **trace id**, not the payment's anchor id. If every event for one payment carries the same trace id, they all land on the same partition and arrive in true order.
3. **The failure condition:** captures confirm that the settlement-side events (`fulfilTransfer`, `notifyFxTransfer`, `commitTransfer`) are sometimes re-emitted under a **fresh, different trace id** than the rest of the same transaction's earlier events. A different trace id hashes to a different partition — even though it's still the same real-world payment.
4. Once the settlement leg is on a different partition, Kafka does nothing to keep it in step with the "prepare" partition. If that partition happens to be shorter, idle, or simply polled first, the MLA can genuinely receive and forward `commitTransfer` (the `pacs.002` trigger) **before** `prepareTransfer` (the `pacs.008` trigger) — even though prepare happened first on the actual switch.

This exact scenario was captured for real (`04_ZMW_to_EGP_partition_split`) and is what the bounded-retry-then-park logic in step 0.5.3 (`resolveNotificationState`) exists to survive: check the durable store for a parked copy first, retry ValKey briefly, and if neither resolves it, park the trigger itself until its own `pacs.008` eventually shows up.

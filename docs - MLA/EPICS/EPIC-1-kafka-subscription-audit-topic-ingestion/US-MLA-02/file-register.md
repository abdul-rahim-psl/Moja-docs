# US-MLA-02 — File Register

Shared integration files are listed once, at the epic level — `EPICS/EPIC-1-kafka-subscription-audit-topic-ingestion/file-register.md`.

| File | Why it was added / what it does |
| --- | --- |
| `src/services/event-classification.service.ts` | `EVENT_TYPE_BY_OPERATION` (**D2** — `operation` alone, no method+resource fallback), `PARTY_LOOKUP_OPERATIONS`, and the three-way `ClassificationResult` (`classified` / `party-lookup` / `unclassifiable`) so party lookup can never collapse into the same bare skip a genuine classification gap would produce. Resolves the `commitTransfer` double-row ambiguity in code (**D5**). |
| `src/services/canonical-record.service.ts` | `isFxQuoteRejection` lives in this file (alongside US-MLA-01's `isCanonicalRecord`/`isTransferRejection`, which it reuses) — no `operation` tag plus `StsRsnInf` present. The module comment documents that callers must check this **before** canonical selection. |
| `__tests__/event-classification.service.test.ts` | 19 tests, 100% coverage — every table row (including FXTRANSFER's three-leg lifecycle), all three party-lookup operations, the no-`operation`-tag edge case, and a rejected `prepareTransfer` (still classifies TRANSFER). |
| `__tests__/canonical-record.service.test.ts` | Contributes 5 of its tests to this story — all 19 curated FX-quote-rejection records plus the negative case (a transfer rejection must not double-count as an FX-quote rejection); the remaining 29 belong to US-MLA-01's own file register. |

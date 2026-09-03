# US-MLA-03 — File Register

Shared integration files are listed once, at the epic level — `EPICS/EPIC-1-kafka-subscription-audit-topic-ingestion/file-register.md`.

| File | Why it was added / what it does |
| --- | --- |
| `src/services/payload-selection.service.ts` | `selectPayload` — `content.transformedPayload ?? content.payload`, **D6**, ported deliberately from the POC's `buildEnvelope`. Returns `undefined`, not `{}`, when neither field is present (deliberate divergence from the POC). |
| `src/services/audit-record-parser.service.ts` | `parseAuditRecord` — the boundary parse: raw Kafka message value → typed `AuditRecordBody` or a named `unreadable` outcome with a reason. Ported from the POC's `parseAuditMessage`, extended with a structural shape check the POC only ran informally. |
| `__tests__/payload-selection.service.test.ts` | 8 tests, 100% statements/lines/functions, 99.27%+ branches — quote-family selecting `transformedPayload`, transfer-family selecting `payload` directly, the party-lookup no-body case, and the per-operation hallmark-field parameterization (`ilpPacket` for `prepareTransfer`, `commitRequestId` for `prepareFxTransfer`) that a first failing run caught. |
| `__tests__/audit-record-parser.service.test.ts` | 8 tests, 100% statements/lines/functions, 95.45%+ branches — null value, malformed JSON (including the exact `capture-feeder --corrupt` shape), non-object JSON, missing `content`/`metadata`, invalid action, missing `tags`, and a real-capture round-trip success case. |

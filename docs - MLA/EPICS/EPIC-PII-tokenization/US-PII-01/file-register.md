# US-PII-01 — File Register

Shared integration files (`envelope-pipeline.service.ts`'s wiring, `ingestion-consumer.service.ts`'s further extension) are listed once, at the epic level — `EPICS/EPIC-PII-tokenization/file-register.md` — rather than repeated here. Files owned jointly with US-PII-02 (the secret client, the readiness coupling) are listed in that story's own register.

| File | Why it was added / what it does |
| --- | --- |
| `src/services/tokenization.service.ts` | `tokenizeBody` and the field-classification table (`TOKENIZE_PATHS_BY_EVENT_TYPE`) this story's own AC names — QUOTE (three paths), FXQUOTE (two, "where present"), no row for TRANSFER/FXTRANSFER. The path-walking mechanism (`getAtPath`/`setAtPath`) that lets the table stay data, not a `switch`. |
| `__tests__/tokenization.service.test.ts` | 20 tests: every QUOTE/FXQUOTE field in the table, the payee-legal-name exclusion, the amount-never-touched regression per event type, determinism, no caller-body mutation, the secret-unavailable path, and TRANSFER/FXTRANSFER never consulting the secret store at all. 100%/95.65%/100%/100% own coverage. |

## Live-verification tooling

| File | Why it was added / what it does |
| --- | --- |
| `tools/verify-tokenization/run.ts` (+ `npm run verify:tokenization`) | This story's own live exit-criterion tool (`plan.md` §7), checked in rather than a one-off manual step (`engineering-rules.md` §11). Runs the real, composed `buildEnvelopeFromKafkaValue` against real capture records through the real client classes `npm run dev` itself uses, then POSTs the resulting envelope over real mTLS to a running `ppa-stub` — proving tokens, determinism across independent runs, a clear amount, and an untouched TRANSFER body, all against something genuinely running, not a mock. |

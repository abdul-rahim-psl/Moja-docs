# EPIC-1 — File Register

The files that assemble the epic's three stories into one live pipeline, plus this epic's own decision-level golden tooling. Each story's own file register (`US-MLA-01/`, `US-MLA-02/`, `US-MLA-03/`) lists the service files it owns individually.

## The assembled pipeline

| File | Why it was added / what it does |
| --- | --- |
| `src/services/ingestion.service.ts` | `processRecord` — the pure per-record decision, one function top to bottom: parse → FX-quote-rejection check → canonical selection → classification → payload selection → forwarded or a named `SkipReason`. Delegates every step to the named helper built and tested in its owning story; nothing reimplemented here. The five-way `SkipReason` union and the `IngestionOutcome` discriminated union are what keep every skip reason distinctly visible rather than collapsing into a bare `undefined`. |
| `src/services/ingestion-consumer.service.ts` | `createIngestionHandler(kafka, logger)` — the I/O wrapper: logs the outcome (per-reason log level — `forwarded` at `log`, `unreadable` at `error`, `fx-quote-rejected`/`unclassifiable` at `warn`, `egress`/`party-lookup` at `debug`), then advances the offset unconditionally. Never lets an exception escape, per the `KafkaConnection` port's own contract. |
| `src/index.ts` | `connectKafka` extended: `connect()` → `subscribe()` → `run(createIngestionHandler(...))`, all in one try/catch — the composition root wiring the whole pipeline to a real broker connection. |
| `__tests__/ingestion.service.test.ts` | Covers unreadable (null, malformed JSON), fx-quote-rejected (real fixture), egress (real fixture, an ordinary double-write and a D5-superseded operation), party-lookup, the "unknown operation is caught as egress before reaching classification" invariant, forwarded (QUOTE and TRANSFER), and the synthetic "canonical, classified, no body" defensive path. |
| `__tests__/ingestion-consumer.service.test.ts` | Covers forwarded, unreadable, fx-quote-rejected, unclassifiable (via `jest.spyOn(ingestionService, 'processRecord')`, since `processRecord` itself can never produce `'unclassifiable'` — see the executive summary's note on the structural invariant), egress/party-lookup (`it.each`), and the advance-failure-doesn't-throw case. |

## Decision-level golden regression

| File | Why it was added / what it does |
| --- | --- |
| `tools/golden/run-ingestion-golden.ts` | The decision-level companion to Phase 1's topic-fidelity golden (`tools/golden/run-golden.ts`). Feeds a capture straight through `processRecord` — no broker, since the function is pure and Kafka mechanics are proven separately — and diffs the per-record outcome (`forwarded`+`eventType`+a body digest, or `skipped`+`reason`) against a checked-in baseline, per partition, position by position. `npm run golden:ingestion` / `golden:ingestion:record`. |
| `tools/golden/goldens/ingestion_raw_topic_slice_partition2.golden.json` | Recorded baseline, live-verified, for the 41-record partition-2 slice — its tally matches the live handler run number for number. |
| `tools/tsconfig.json` | Extended to include `../src/services/**/*.ts` (previously only `../src/interfaces/**/*.ts`) so `tools/golden/run-ingestion-golden.ts` can import `processRecord` directly rather than duplicating pipeline logic in `tools/`. Safe because every file under `src/services/` is import-clean of client/I/O modules (verified directly, not assumed) — the golden script pulls in no `pino`/`fastify`/`kafkajs` transitively. |
| `package.json` | Adds the `golden:ingestion` / `golden:ingestion:record` scripts. |

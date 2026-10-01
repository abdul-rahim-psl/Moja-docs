# EPIC-1 — Harness: File Register

Every file this phase added, grouped by area. Generated, git-ignored artefacts (`tools/ppa-stub/certs/*`, `tools/ppa-stub/output/*`) are not listed — they are produced by the scripts below, not checked in.

## Infrastructure

| File | Why it was added / what it does |
| --- | --- |
| `docker-compose.dev.yml` | Single-node Redpanda plus a healthcheck-gated `topic-init` step that creates `topic-event-audit` at 12 partitions — max `partitionID` across the 500-record export, plus one. |

## The Event Envelope contract

| File | Why it was added / what it does |
| --- | --- |
| `src/interfaces/event-envelope.interface.ts` | The `EventEnvelope` TypeScript type — `msgType`, `eventType`, `id`, `correlationId`, `fspiop-source`, `fspiop-destination`, `body`, `timestamp`, optional `error` (core-knowledge.md §5). Built now because `ppa-stub` needs it to validate against; Phase 3 reuses it rather than rebuilding it. |
| `src/interfaces/event-envelope.schema.json` | The same contract as an ajv-compatible JSON Schema, shared verbatim between `ppa-stub` and (from Phase 3) the real envelope builder. |

## `tools/capture-feeder/` — the topic simulator

| File | Why it was added / what it does |
| --- | --- |
| `tools/capture-feeder/types.ts` | `CaptureRecord` (the Redpanda Console export shape) and `CliOptions`. |
| `tools/capture-feeder/cli.ts` | Hand-rolled flag parser for `--file`, `--topic`, `--brokers`, `--speed`, `--only`, `--delay-partition`, `--duplicate`, `--drop`, `--corrupt`, `--strip-signature`, `--loop` — a per-flag handler map, not a growing `switch`. |
| `tools/capture-feeder/load-records.ts` | Loads and merges capture files, re-sorted by timestamp/partition/offset; `--only`'s substring-match filter. |
| `tools/capture-feeder/apply-scenarios.ts` | Applies `--drop`/`--duplicate`/`--corrupt`/`--strip-signature` to the loaded record list, producing the list of items actually sent. |
| `tools/capture-feeder/build-message.ts` | Builds one faithful kafkajs message from a capture record — explicit partition, decoded headers, original key and timestamp, with `--corrupt`/`--strip-signature`'s byte-level transforms applied here. |
| `tools/capture-feeder/produce.ts` | Connects, feeds (honouring `--speed` and `--delay-partition`), loops if asked, disconnects. |
| `tools/capture-feeder/index.ts` | CLI entry point wiring the above together. |

## `tools/ppa-stub/` — the downstream double

| File | Why it was added / what it does |
| --- | --- |
| `tools/ppa-stub/types.ts` | `FaultMode` and the `/control` request/status shapes. |
| `tools/ppa-stub/state.ts` | In-process fault-injection state machine — `mode`, `afterN`, `forMs`, `code`; deliberately module-level singleton state, safe here because `ppa-stub` is a single-instance test double, never a horizontally-scaled service. |
| `tools/ppa-stub/validator.ts` | Compiles and runs `event-envelope.schema.json` via ajv, imported directly rather than duplicated (single repository, no MLA↔PPA trust boundary to protect). |
| `tools/ppa-stub/recorder.ts` | Appends every accepted envelope to JSONL, in receipt order; `reset()` truncates it, wired to `POST /control/reset`. |
| `tools/ppa-stub/routes.ts` | The four business routes (fault-check → schema-validate → record) and the control/health routes. |
| `tools/ppa-stub/index.ts` | Two Fastify listeners: mTLS business endpoints, plain-HTTP control/health. |
| `tools/ppa-stub/scripts/generate-certs.sh` | Generates a local self-signed CA plus server and client certs (`npm run certs:generate`) — dev-only, git-ignored output. |

## `tools/golden/` — golden-file regression

| File | Why it was added / what it does |
| --- | --- |
| `tools/golden/canonicalize.ts` | Reduces a source record or a read-back Kafka message to the same comparable shape — partition, key, headers, timestamp, and a sha256 digest of the value (full fidelity without inflating the golden file). |
| `tools/golden/read-topic.ts` | Reads a topic back from the beginning on a fresh, throwaway consumer group, stopping after a quiet period. |
| `tools/golden/diff.ts` | Per-partition, position-by-position diff between two canonicalised record sets; `toGolden` turns a partition grouping into the checked-in JSON shape. |
| `tools/golden/run-golden.ts` | Orchestrates one run: creates a scratch topic, feeds it, reads it back, diffs against the source and (unless `--record`) against the checked-in golden, then deletes the scratch topic. |
| `tools/golden/goldens/01_MWK_to_ZMW_PRIMARY.golden.json` | Recorded baseline, live-verified, for the primary corridor transaction. |
| `tools/golden/goldens/raw_topic_slice_partition2.golden.json` | Recorded baseline, live-verified, for the 41-record interleaved partition-2 slice. |
| `tools/golden/goldens/raw_export_500.golden.json` | Recorded baseline, live-verified, for the full 500-record, 12-partition export. |

## `tools/scenario-library/` and `tools/curate-fixtures/`

| File | Why it was added / what it does |
| --- | --- |
| `tools/scenario-library/scenarios.ts` | All fifteen named scenarios from `plan.md` §4's checklist, as data: description, the acceptance criterion each exercises, and (where runnable now) the exact `capture-feeder` args or `ppa-stub` control body. |
| `tools/scenario-library/run.ts` | `--list`s the registry, or runs one named scenario — dispatching to `capture-feeder`, a `POST /control`, or (for `mla-restart`/`two-mla-instances`, which need the real MLA) a printed explanation of why not yet. |
| `tools/curate-fixtures/extract.ts` | Regenerates `__tests__/fixtures/curated/` from `raw_export_500.json` — checked-in tool, not a throwaway script, so a future wider capture window can be re-curated with the same selection logic. |

## Shared tooling

| File | Why it was added / what it does |
| --- | --- |
| `tools/lib/print.ts` | A trivial stdout/stderr wrapper — these CLIs are human-facing scripts, not structured-log-emitting services, so they get neither `console.log` (repo-wide lint ban) nor the app's own `pino`-backed logger. |
| `tools/lib/decode-header.ts` | Recovers a capture header's real string value from Redpanda Console's JSON-stringified export form; shared between `capture-feeder` (encodes onto the wire) and `tools/golden` (must decode identically to compare fairly). |
| `tools/tsconfig.json` | A separate TypeScript project for `tools/` — CommonJS, `noUncheckedIndexedAccess: true` (stricter than the root config; makes the CLI parsers' and golden differ's `undefined` guards meaningful rather than lint-flagged as unreachable). |
| `tools/README.md` | Documents every tool, every flag, the `docker compose` machine-specific workaround, and states plainly that offsets are not reproduced, ordering is. |

## Fixtures

| File | Why it was added / what it does |
| --- | --- |
| `__tests__/fixtures/DRPP_Kafka_E2E_Pack/` | The five corridor captures, the partition-2 slice, and the pack's own `README.md` — committed verbatim, per the decision recorded in `continue - before harness.md` §5. |
| `__tests__/fixtures/raw_export_500/raw_export_500.json` | The full 500-record, 12-partition export — committed verbatim. |
| `__tests__/fixtures/curated/classification-cases.json` (+ `.provenance.json`) | One record per distinct (`operation`, `start`/`egress`) pair actually observed — full classification-table coverage, 23 records. |
| `__tests__/fixtures/curated/transfer-rejections.json` (+ `.provenance.json`) | The 2 `prepareTransfer` + `StsRsnInf` records — D1's shape-check case. |
| `__tests__/fixtures/curated/fxquote-rejections.json` (+ `.provenance.json`) | All 19 FX-quote rejection records (no `operation` tag, `StsRsnInf` present) — the full set, not a sample. |
| `__tests__/fixtures/curated/party-lookup.json` (+ `.provenance.json`) | One record per party-discovery (`operation`, action) pair, including the `putPartiesErrorByTypeAndID` error variant. |
| `__tests__/fixtures/curated/README.md` | What each curated set contains, its count, and how to regenerate it. |

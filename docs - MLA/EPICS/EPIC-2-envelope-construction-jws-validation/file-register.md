# EPIC-2 — File Register

The files that assemble the epic's two stories into one live pipeline. Each story's own file register (`US-MLA-04/`, `US-MLA-05/`) lists the service files it owns individually.

## The assembled pipeline

| File | Why it was added / what it does |
| --- | --- |
| `src/services/envelope-pipeline.service.ts` | `buildEnvelopeFromKafkaValue` — composes Phase 2's `processRecord` with `verifyJws` (US-MLA-05) then `buildEnvelope`/`validateEnvelopeSchema` (US-MLA-04), in that order. `EnvelopeSkipReason` extends Phase 2's five-reason `SkipReason` with four new reasons at this layer, never editing the original type. |
| `src/services/ingestion-consumer.service.ts` | Extended: `createIngestionHandler` now takes a `PublicKeyStore`; generates `correlationId` (`randomUUID()`) and `timestamp` per event — the two values `buildEnvelope` needs but cannot generate itself, keeping it a pure function. Logging split into `logIngestionSkip` (Phase 2's five reasons, unchanged) and `logEnvelopeSkip` (this epic's four, `SECURITY`-marked for missing/invalid signature, plain for a key-source outage) to keep each function's cyclomatic complexity under the engineering-rules.md §5 ceiling. |
| `src/index.ts` | Builds `FilePublicKeyStoreClient` at the composition root and injects it into `createIngestionHandler`; closes it on shutdown alongside the Kafka client. |
| `src/interfaces/config.interface.ts`, `src/services/config.service.ts`, `.env.template` | `JwsConfig.publicKeyDir` (`JWS_PUBLIC_KEY_DIR`, default `tools/dfsp-keys/store`) — the one new piece of external configuration this epic needs (engineering-rules.md §8, N6). |
| `__tests__/envelope-pipeline.service.test.ts` | 8 tests proving the *composition*, not re-testing either story's own logic: a Phase 2 skip short-circuits before JWS or envelope construction run; missing/invalid signature and a key-source outage each surface with the store's own reason carried through; an envelope that verifies but is left incomplete is caught, not silently forwarded; the schema-validation backstop, forced via a spy since it is otherwise unreachable; one full happy path with no stage mocked. |
| `__tests__/ingestion-consumer.service.test.ts` | Extended with 5 new cases: `SECURITY`-marked logs for missing/invalid signature, a plain (non-`SECURITY`) log for a key-source outage, an incomplete envelope from a genuinely stripped real record, and the schema-invalid backstop. |

## Live-verification tooling

| File | Why it was added / what it does |
| --- | --- |
| `tools/dfsp-keys/generate-keys.ts` | Local RSA keypair generation (`npm run keys:generate`) — the mechanism `plan.md` §6 names as the only honest way to exercise US-MLA-05 without real DFSP keys. |
| `tools/capture-feeder/resign.ts` + `--resign`/`--tamper-body` (`types.ts`/`cli.ts`/`apply-scenarios.ts`/`build-message.ts`) | Re-signs a real capture record against a locally generated keypair, and/or mutates its body after signing — the two scenarios the Phase 3 exit criterion names by name. |
| `tools/golden/run-golden.ts`, `tools/golden/run-ingestion-golden.ts` | Unchanged by this epic — both are Phase 1/2 tooling proving topic fidelity and Phase 2's own decisions respectively; neither needed to change for envelope construction or JWS to be added on top. |

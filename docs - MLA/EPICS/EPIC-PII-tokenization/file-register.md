# EPIC-PII — File Register

The files that assemble the epic's two stories into one live pipeline step. Each story's own file register (`US-PII-01/`, `US-PII-02/`) lists the files it owns individually.

## The assembled pipeline

| File | Why it was added / what it does |
| --- | --- |
| `src/services/envelope-pipeline.service.ts` | Extended: `tokenizeBody` (US-PII-01) now runs as core-knowledge.md §3.2's step 6, strictly between `verifyJws` (step 5) and `buildEnvelope` (step 7) — N3. `EnvelopePipelineDeps` gained `secretStore: PiiSecretStore`; `EnvelopeSkipReason` gained `pii-secret-unavailable`, extending Phase 3's own extension of Phase 2's `SkipReason` rather than editing either. |
| `src/services/ingestion-consumer.service.ts` | Extended: `createIngestionHandler` now takes a `PiiSecretStore`; `logEnvelopeSkip` gained the `pii-secret-unavailable` case (plain, non-`SECURITY` — an infrastructure fault, not evidence of a forged event, same reasoning as `key-source-unavailable`). Five pre-existing `?? 'unknown reason'` fallbacks removed alongside this epic's own new one, once found genuinely dead by the same evidence (see the stories' own executive summaries). |
| `src/index.ts` | Builds `FilePiiSecretClient` at the composition root, injects it into `createIngestionHandler` alongside `keyStore`, and wires its load state into the health provider's readiness callback. |
| `__tests__/envelope-pipeline.service.test.ts` | Extended with 4 new cases proving the *composition*, not re-testing either story's own logic: the two-sided ordering proof (a genuinely-signed record verifies and ends up tokenized; an invalid signature never even reaches a secret store that would throw if consulted), the `pii-secret-unavailable` skip, and a real TRANSFER record's body reaching the envelope completely unaffected. |
| `__tests__/ingestion-consumer.service.test.ts` | Extended with the `pii-secret-unavailable` case's own logging test (plain error, not `SECURITY`-marked). |

## Live-verification tooling

| File | Why it was added / what it does |
| --- | --- |
| `tools/verify-tokenization/run.ts` (+ `npm run verify:tokenization`) | This epic's own live exit-criterion tool (`plan.md` §7), checked in per `engineering-rules.md` §11 rather than a one-off manual step — the first such tool built for this project's own Phase 4/5-style "POST a real envelope over real mTLS" need, which Phase 3 proved live but never checked in as reusable tooling. Runs the real, composed `buildEnvelopeFromKafkaValue` against real captures through the real client classes `npm run dev` itself uses, then posts the resulting envelopes over real mTLS to a running `ppa-stub`. |
| `tools/pii-secret/generate-secret.ts` (+ `npm run pii-secret:generate`) | Local secret generation, mirroring `tools/dfsp-keys/generate-keys.ts`'s role for JWS — see US-PII-02's own file register. |

## Configuration

| File | Why it was added / what it does |
| --- | --- |
| `src/interfaces/config.interface.ts`, `src/services/config.service.ts`, `.env.template` | `PiiConfig.secretPath` (`PII_SECRET_PATH`) — the one new external configuration value this epic needs. |
| `.gitignore` | `tools/pii-secret/generated/` — the generated local secret is never checked in. |
| `package.json` | Adds the `pii-secret:generate` and `verify:tokenization` scripts. |

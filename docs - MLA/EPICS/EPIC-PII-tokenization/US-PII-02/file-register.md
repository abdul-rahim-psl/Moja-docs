# US-PII-02 — File Register

Shared integration files are listed once, at the epic level — `EPICS/EPIC-PII-tokenization/file-register.md` — rather than repeated here.

| File | Why it was added / what it does |
| --- | --- |
| `src/interfaces/pii.interface.ts` | The `PiiSecretStore` port — `getSecret(): PiiSecretLookupResult`, a two-outcome (`available`/`unavailable`) shape mirroring `PublicKeyStore`'s own, for the same reason: a caller must distinguish "genuinely failed to load" from any other falsy state, since that distinction is what gates `/health/ready`. |
| `src/clients/pii-secret.client.ts` | `FilePiiSecretClient` — the port's only implementation. Reads one mounted file once at construction, stores the resolved lookup result as a single discriminated value (not two fields needing a defensive fallback). Deliberately no `fs.watch` — rotation strategy is undecided; see the story's own executive summary. |
| `src/interfaces/config.interface.ts`, `src/services/config.service.ts`, `.env.template` | `PiiConfig.secretPath` (`PII_SECRET_PATH`, default `tools/pii-secret/generated/local.secret`) — the one new piece of external configuration this story needs (`engineering-rules.md` §8, N6). |
| `src/interfaces/health.interface.ts`, `src/services/health.service.ts` | `PiiSecretReadiness` (`'UP' \| 'DOWN'`, no `DISABLED` branch — this story names no opt-out), folded into `ReadinessReport`/`buildReadiness`/`createHealthProvider` alongside the existing Kafka signal. |
| `src/index.ts` | Builds `FilePiiSecretClient` at the composition root and wires its load state into the health provider's readiness callback, alongside the existing `keyStore`. |
| `__tests__/pii-secret.client.test.ts` | 5 tests against a real temporary file: loads at construction, reports `unavailable` with a reason when the file is missing (never throws), never logs the secret's own content, does not pick up a file written after construction, and `getSecret()` is a stable, repeatable lookup. 100%/80%/100%/100% own coverage — the one gap is documented in the class's own comment and this story's executive summary. |
| `__tests__/health.service.test.ts`, `__tests__/fastify.client.test.ts` | Extended: `resolvePiiSecretReadiness`, and `piiSecret: DOWN` pulling overall `status` to `DOWN` independently of Kafka's own state, in both directions. |
| `__tests__/config.service.test.ts` | Extended: the PII secret path default and a supplied-value override. |

## Local-harness tooling

| File | Why it was added / what it does |
| --- | --- |
| `tools/pii-secret/generate-secret.ts` (+ `npm run pii-secret:generate`) | Local secret generation — `crypto.randomBytes(32)` written directly to a gitignored file (`tools/pii-secret/generated/`), mirroring `tools/dfsp-keys/generate-keys.ts`'s role for JWS. Never a substitute for a genuinely provisioned production secret. |

# EPIC-0 — Scaffolding: File Register

Every file Phase 0 added, and the reason it exists. The rationale behind the decisions these files embody is in `executive-summary.md`; this document answers only "what is this file, and why is it here."

---

## Project tooling — repository root

| File | Why it was added / what it does |
| --- | --- |
| `package.json` | Declares the service, its scripts (`build`, `start`, `dev`, `lint`, `fix`, `test`) and its dependency set. Script names are carried forward from the POC so muscle memory transfers between the two codebases. `demo:*` scripts are deliberately absent until the Phase 1 harness they would drive exists. |
| `package-lock.json` | Pins the exact resolved dependency tree, so a CI runner and a developer machine install byte-identical trees. |
| `tsconfig.json` | TypeScript compiler settings, carried forward unchanged: `target: ES2022`, `module: NodeNext`, `strict: true`, `rootDir: src`, `outDir: build`. Strict mode is what makes "no `any`" enforceable rather than aspirational. |
| `jest.config.ts` | The test runner configuration, and the mechanical coverage floor. Sets `coverageThreshold` to **96** on branches, functions, lines and statements so that exactly 95.0% fails, and `collectCoverageFrom: ['src/**/*.ts']` so a file with no tests counts as uncovered instead of vanishing from the report. Excludes `src/interfaces` (types only), `src/index.ts` (proven live, not by unit test) and the test folder itself. |
| `eslint.config.mjs` | Flat-config lint rules, carried forward unchanged: `eslint-config-love`, `@stylistic`, `@eslint-community/eslint-comments`, and Prettier integration so formatting and linting never argue. Enforces the complexity ceiling and bans `console`. |
| `.prettierrc.json` | Formatting rules, carried forward unchanged. Formatting is Prettier's problem, never a reviewer's. |
| `.prettierignore` | Keeps build output, coverage reports and dependencies out of formatting checks. |
| `.editorconfig` | Editor-level whitespace and encoding settings, so files arrive consistent regardless of who edits them in what. |
| `.gitignore` | Keeps dependencies, build output, coverage reports, logs, `.env` files, and — importantly — certificates and private keys out of version control. |
| `.dockerignore` | Keeps the same material out of the Docker build context, so a local `.env` or a stray key can never be baked into an image. |
| `Dockerfile` | Multi-stage container build, carried forward unchanged: `node:22-bullseye` to compile, a separate stage to strip dev dependencies, and `distroless/nodejs22-debian12:nonroot` to run as a non-root user with no shell. Runs node as PID 1, which is what makes the `SIGTERM` handling in `src/index.ts` work as intended in a real deployment. |
| `.env.template` | The documented shape of every environment variable, with each open question named at the value it affects. Carries the corrected audit-topic name (`topic-event-audit`, not the POC's stale `mojaloop-audit`), the R-18 warning at the consumer group id, and the FSD Open Item #1 note at the PPA timeouts. It is a template because the real `.env` is never committed. |
| `.gitlab-ci.yml` | The CI gate: installs, builds, then runs lint and the test suite as a verification stage. Fails the pipeline on a single lint error or coverage below 96 — the same bar the suite enforces locally. Added in this phase specifically so the gates predate any code that might want exempting. Matches the repository's actual remote, which is self-hosted GitLab. |

## `src/interfaces/` — contracts, no behaviour

| File | Why it was added / what it does |
| --- | --- |
| `config.interface.ts` | The shape of the resolved configuration: `Configuration`, `KafkaConfig`, `PpaConfig`. Lets clients receive typed configuration by injection without importing the loader that produced it, which is what keeps `clients/` from reaching into `services/`. |
| `health.interface.ts` | The health contract: `KafkaReadiness` (`DISABLED` / `UP` / `DOWN`), the liveness and readiness report shapes, and `HealthProvider` — the object the HTTP adapter is handed so it never needs to know how a health decision is made. |
| `kafka.interface.ts` | The Kafka port at the depth this phase needs: `connect`, `disconnect`, `isConnected`. Consumption is not on it, because consumption is `US-MLA-01`, which extends this port rather than replacing it. |
| `logger.interface.ts` | The logging port, shaped to Tazama's `LoggerService` surface. Services depend on this rather than on `pino`, which is what makes swapping in `@tazama-lf/frms-coe-lib` a change to one adapter. |

## `src/services/` — logic, pure where it can be

| File | Why it was added / what it does |
| --- | --- |
| `config.service.ts` | Resolves every environment variable once, into a typed object, and throws at boot on anything missing or malformed — an unparseable number, a boolean that is neither `true` nor `false`, a port outside its range, an unrecognised log level, an empty broker list. Kafka's broker list, group id and audit topic are *required* when the consumer is enabled and defaulted only when it is off. This is the only module in the codebase that reads `process.env`. |
| `health.service.ts` | Decides liveness and readiness as pure functions over instance-local state, and builds the `HealthProvider` the HTTP layer consumes. Encodes the rule that a deliberately disabled consumer is ready while an enabled-but-disconnected one is not — and that neither answer ever depends on a shared downstream. |

## `src/clients/` — I/O adapters

| File | Why it was added / what it does |
| --- | --- |
| `logger.client.ts` | The `LoggerService` wrapper over `pino`, and the only module in the codebase that imports it. Structured logging from the first line of real code rather than retrofitted later. |
| `kafka.client.ts` | Owns the consumer's connection lifecycle and reports whether it is connected, which is the fact `/health/ready` is built on. Constructs the consumer against the externally-configured, dedicated group id, with the R-18 rationale recorded at the construction site. It does not subscribe, consume or commit. |
| `fastify.client.ts` | Builds the HTTP server and registers `/health/live` and `/health/ready`, translating a readiness report of `DOWN` into a 503 so an orchestrator acts on it. The HTTP surface exists for probes only — payment traffic arrives over Kafka, never HTTP. |

## `src/` — the composition root

| File | Why it was added / what it does |
| --- | --- |
| `index.ts` | The only place anything is constructed: reads configuration, builds the logger and clients, injects them, starts the server, and connects the consumer if it is enabled. Refuses to start on invalid configuration rather than running degraded. Handles `SIGTERM` and `SIGINT` by stopping the consumer *before* closing the HTTP server, so an in-flight record can finish its dispatch and offset commit rather than being torn down mid-flight. |

## `__tests__/` — the suite

| File | Why it was added / what it does |
| --- | --- |
| `config.service.test.ts` | Covers every default, every supplied-value path, and every rejection: each Kafka value missing while the consumer is enabled, a non-numeric number, a non-boolean boolean, an out-of-range and a non-integer port, an unrecognised log level, and a broker list that resolves to nothing. These are tests of the fail-at-boot contract, not of parsing trivia. |
| `health.service.test.ts` | Covers every `KafkaReadiness` state and the readiness verdict each produces, and asserts that the provider re-reads consumer state on every call rather than capturing it once at startup. |
| `fastify.client.test.ts` | Covers the HTTP contract the orchestrator actually reads: liveness always 200, readiness 200 when up or deliberately disabled, and 503 when down. |
| `logger.client.test.ts` | Covers each log level and, specifically, that an error's underlying cause is preserved rather than flattened into a message — the property that keeps a TLS handshake failure distinguishable from an ordinary outage later. |
| `kafka.client.test.ts` | Covers the connection state machine, including that a failed connection leaves the client reporting disconnected so readiness correctly says `DOWN`, and that the consumer is built against the configured dedicated group id. |

## Documents updated by this phase

| File | Why it was changed / what it does |
| --- | --- |
| `docs - MLA/plan.md` | §3.3's checklist ticked and the phase marked complete; the CI platform decision recorded at the bullet it affects; and the first §16 progress-log entry added, stating what was built, what the tests cover, what was verified live, what diverged from the plan and the POC, and what is left open. |
| `docs - MLA/continue/continue - before scaffolding.md` | The same CI-platform decision recorded on its matching checklist item, so the handoff document and the plan do not disagree. |
| `CLAUDE.md` | A `Commits` section added: implementation is produced and left in the working tree; the user commits. |

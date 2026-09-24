<!-- SPDX-License-Identifier: Apache-2.0 -->

# Engineering Rules — CCH MLA / PPA <!-- omit in toc -->

**Status:** binding. This is production-grade work carrying real cross-border payment traffic into a fraud-detection pipeline. Everything below is a rule, not a suggestion. Where a rule genuinely does not fit a situation, the deviation is recorded in the code with a one-line reason — it is never silent.

**The governing tension, stated once so it doesn't have to be re-argued per file:**

> **SOLID, yes. Ceremony, no.** Apply a principle when it removes real pain that exists in this codebase. Do not apply it to satisfy a diagram. A junior engineer joining in six months should be able to open any file and understand what it does without traversing five layers of indirection to find where the work actually happens. **Readability and maintainability are the objective; SOLID is one of the means.**

- [1. Non-negotiables](#1-non-negotiables)
- [2. Architecture](#2-architecture)
- [3. SOLID, calibrated](#3-solid-calibrated)
- [4. Decoupling — where, and where not](#4-decoupling--where-and-where-not)
- [5. Code style and readability](#5-code-style-and-readability)
- [6. Error handling and failure semantics](#6-error-handling-and-failure-semantics)
- [7. Concurrency and state](#7-concurrency-and-state)
- [8. Configuration and secrets](#8-configuration-and-secrets)
- [9. Observability](#9-observability)
- [10. Testing](#10-testing)
- [11. Live verification — the rule that outranks paper design](#11-live-verification--the-rule-that-outranks-paper-design)
- [12. Documentation and traceability](#12-documentation-and-traceability)
- [13. Git, review, and definition of done](#13-git-review-and-definition-of-done)
- [14. The anti-pattern list](#14-the-anti-pattern-list)

---

## 1. Non-negotiables

Break any of these and the change does not ship, regardless of how well the rest is written.

| # | Rule |
| --- | --- |
| **N1** | **Never acknowledge what is not durable.** MLA commits an offset only on PPA HTTP 200. PPA returns 200 only after a durable write-ahead write. No code path may weaken either link. |
| **N2** | **Never synthesize a message.** No fabricated `pacs.002`, no fabricated `pain.013`. If the source event did not arrive, no message is emitted. *(Core knowledge §9; R-04.)* |
| **N3** | **Retired [2026-09-23] — confirmed by the rules owner and CCH.** MLA does not validate DFSP JWS signatures: the switch validates every record before it reaches `topic-event-audit`, inside the same trust boundary as MLA's consumer (`e2e-testing/remove-JWS.md` §1). With no validation step in the pipeline there is no ordering left for this rule to protect. The number is kept so existing references stay resolvable. |
| **N4** | **Every mutation of shared state is atomic.** ValKey merges are Lua compare-and-merge. Idempotency is a single check-and-set. A read followed by a write is a defect, not a style choice. |
| **N5** | **Retries resend the byte-identical message**, with the same pinned `GrpHdr.MsgId`. Never rebuild on retry. |
| **N6** | **No secret, key, certificate, endpoint, TTL, threshold or timeout is hardcoded.** All come from configuration. |
| **N7** | **No raw PII in any log, metric, DLQ entry, or error message.** Masked or tokenized, always. |
| **N8** | **Nothing merges at or below 95% Jest coverage, or with a single lint error.** The bar is *above* 95% — `coverageThreshold` is set to **96** so exactly 95.0% fails the gate. |
| **N9** | **A behaviour claimed as working has been observed working**, not merely unit-tested. See §11. |
| **N10** | **A silent failure is worse than a loud one.** Any path that drops, strips, or degrades data emits a signal — a metric at minimum, an alert where the stories require one. |

---

## 2. Architecture

### 2.1 Layering

Four layers, one direction of dependency. This is the whole architecture; there is no fifth layer waiting to be added.

```
  interfaces/   types, envelope and message contracts, no behaviour
       ▲
  services/     business logic — pure where it can be, orchestration where it must be
       ▲
  clients/      I/O adapters — Kafka, ValKey, HTTP, the write-ahead store
       ▲
  index / app   composition root: reads config, builds clients, injects, starts
```

- **Dependencies point inward only.** `services/` never imports from `index`. `clients/` never imports from `services/`.
- **The composition root is the only place that constructs anything.** Clients are built once at startup and injected. No service reaches for a module-level singleton client.
- **`interfaces/` holds no behaviour.** Types, enums, and constants only.

### 2.2 The two-service boundary is a real boundary

MLA and PPA are separate deployables with separate `package.json` files, builds and test suites. **Do not create a shared runtime library between them.** If a type must be shared — the Event Envelope, most likely — it is duplicated deliberately with a comment pointing at the contract document, or versioned as a genuine published contract. A shared internal library would couple two services that sit in **different network and trust boundaries**, and that coupling is exactly what the architecture is designed to prevent.

### 2.3 Ports and adapters, at exactly one level of depth

Every external dependency is reached through a narrow interface owned by `services/`, implemented in `clients/`:

- `KafkaConsumer`, `CacheStore`, `WriteAheadStore`, `PpaClient`, `TmsClient`, `SchemaValidator`.
- **The write-ahead store's interface is mandatory, not optional** — the underlying technology is explicitly TBC (FSD §4.7) and must be swappable without touching business logic.
- **One level of abstraction only.** An interface, an implementation, and a fake for tests. No abstract base classes, no factory-of-factories, no plugin registry for a set of four known implementations.

### 2.4 The pipeline is explicit, not implicit

PPA's nine steps and MLA's processing order are **visible in one function each**, reading top to bottom in the order the documents state. Each step delegates to a named helper. A reader should be able to open `processEnvelope` and see the pipeline; they should not have to reconstruct it from event emitters, middleware chains, or a decorator stack.

**No hidden control flow.** No global event bus for in-process orchestration. No middleware that silently mutates the payload.

---

## 3. SOLID, calibrated

What each principle means *here*, and where it stops.

### Single Responsibility — **apply strictly**

A module has one reason to change. Classification is not decoding. Translation is not dispatch. Cache merging is not TTL policy.

**Stops at:** one function per line of code. A cohesive 60-line function doing one clearly-named thing is better than six 10-line functions that only make sense read together.

### Open/Closed — **apply where the axis of change is known**

The axes that will actually change: **event types** (a fifth may appear), **ISO message types**, **degraded-field fallbacks**, **schema versions**. Structure those as data — a classification table, a mapping table — so adding a row does not mean editing a `switch` in four places.

**Stops at:** everything else. Do not build extension points for change you cannot name. **Editing a well-factored function is a perfectly good way to extend it.**

### Liskov — **apply to the port implementations**

The in-memory fake and the real ValKey client must be substitutable, including failure behaviour. A fake that never times out while the real one does produces tests that pass and a service that breaks.

### Interface Segregation — **apply strictly, it is cheap**

`services/` depends on the two methods it calls, not a 30-method client surface. This is what makes the fakes small and the tests fast.

### Dependency Inversion — **apply to I/O only**

Business logic depends on interfaces for Kafka, ValKey, HTTP and the store — injected at the composition root.

**Stops at:** pure functions. Field mapping, `TxSts` translation, classification and validation are **pure functions taking data and returning data**. They need no injection, no interface, no class. Wrapping a pure function in a class to inject it is ceremony that buys nothing and costs readability.

### The calibration rule

> A pattern earns its place by removing pain that exists **in this codebase today**. If you cannot name the concrete pain, the pattern is speculative and does not go in.

---

## 4. Decoupling — where, and where not

### Decouple, always

| From | Why |
| --- | --- |
| Business logic ↔ **I/O** | Enables fast unit tests and swappable stores |
| Business logic ↔ **the write-ahead store's technology** | Explicitly TBC; must be swappable |
| **Translation** ↔ **dispatch** | Assembling a `pacs.008` must be testable without HTTP |
| **Classification** ↔ **routing** | Resolving the event type must not depend on knowing PPA's URLs |
| **Field mapping** ↔ **schema validation** | Two failure modes, two tests, two reasons to change |
| **Policy** (timeouts, TTLs, thresholds, backoff) ↔ **mechanism** | Values are configuration; the state machine is code |
| **MLA** ↔ **PPA** | Separate trust boundaries; see §2.2 |

### Do not decouple

- **The four ISO message builders from their own field-mapping rules.** The mapping *is* the builder. Splitting `pacs.008` across a generic "mapper engine" plus a rule set makes the single most important table in the system unreadable.
- **Steps of one pipeline into separately-deployed pieces.** The pipeline is one function calling named helpers.
- **Anything "in case we need it later."** Later is when it gets decoupled.

### Coupling that is intentional and must be preserved

Some coupling in this design is load-bearing and must not be "cleaned up":

- **PPA's 503 gate is coupled to three independent conditions** — ValKey reachability, store reachability, and the TMS breaker state. This is deliberate: one gate, three reasons.
- **MLA's offset policy is coupled to PPA's response code.** That coupling *is* the durability guarantee.
- **`OrgnlInstrId`/`OrgnlEndToEndId` on `pacs.002` are coupled to the exact values pinned on the corresponding `pacs.008`.** Regenerating them independently produces a message TMS accepts and silently fails to link.

---

## 5. Code style and readability

- **TypeScript strict mode. No `any`.** Where a type is genuinely unknown at a boundary, use `unknown` and narrow explicitly.
- **Parse at the boundary, trust inward.** Kafka records, envelopes and TMS responses are validated once at entry and typed thereafter. Business logic does not re-check what the boundary already guaranteed.
- **Prefer pure functions.** Classification, mapping, translation and validation take data and return data. Reserve classes for things that hold a connection or a lifecycle.
- **Name things after the domain, matching the documents exactly.** `eventType`, `msgType`, `correlationId`, `isoMessageType`, `determiningTransferId`. **Never invent a synonym for a term the stories already define** — a reader must be able to grep from a story to the code.
- **Function length:** if it does not fit on a screen, it is probably doing two things. Extract by *responsibility*, never to hit a line count.
- **Cyclomatic complexity ceiling of 15.** When branching pushes a function past it, **extract into named helpers** — never `eslint-disable`.
- **Nesting depth of 3.** Use early returns and guard clauses.
- **No comment explaining *what* the code does.** Comments explain *why* — a sentinel value, a deliberate deviation, a non-obvious ordering constraint, a reference to the story or FSD section that mandates it.
- **A why-comment is 1-2 lines, one reason.** Not a multi-paragraph essay: no "alternatives tried and rejected" narrative, no chain of cross-references through three other files, no restatement of the live-verification story. State the one non-obvious fact and stop. The fuller reasoning belongs in the story's `executive-summary.md` (see [CLAUDE.md](CLAUDE.md) § "Epic and story documentation") or the commit, not inline in the code — a reader who wants that context can go there.
- **This is a shipping product, not an internal audit trail — comments read the way a senior engineer would write them for the next engineer, not for the process that produced the change.** Never reference a QA finding number, ticket ID, PR number, "fix for X", or any other artefact of *how the change came to be written*. The comment states the durable engineering reason the code is shaped this way (an invariant, a constraint from another system, a deliberate trade-off) — a reason that stays true and stays relevant long after the finding register, the ticket, or this conversation are gone. If the only honest content of a comment is "this used to be a bug", that content belongs in the commit message and the story's `executive-summary.md`, never in the code itself.
- **Every magic constant is named**, and its origin is cited: `// FSD §6.4.3 — no source exists in any Mojaloop message`.
- **No dead code, no commented-out code, no `TODO` without an issue reference.**
- **Lint bar: zero errors.** Warnings are acceptable. `eslint-disable` requires a reason comment and is reviewed like a design change.
- **Formatting is Prettier's problem, not a reviewer's.** Never argue about it.

---

## 6. Error handling and failure semantics

### 6.1 Classify every failure into exactly one of four kinds

| Kind | Meaning | Handling |
| --- | --- | --- |
| **Transient** | Will likely succeed on retry — 5xx, timeout, TLS handshake failure | Retry ×3 with backoff and **genuinely random jitter**; do not advance the offset; feed into the breaker |
| **Permanent** | Retrying cannot help — 4xx, malformed envelope, schema failure | Log with full context, alert, DLQ (PPA) or advance offset (MLA). **Never retry.** |
| **Structural skip** | Expected and not an error — `egress` records, party discovery, domestic transfers | Advance normally. **Never logged as an error.** Metric only where the stories require one. |
| **Fatal** | The service cannot function — secret missing at startup, config invalid | **Refuse to start.** Do not run degraded. |

**Every new error path must be explicitly assigned one of these four.** "It'll throw and something upstream will catch it" is not a classification.

### 6.2 Rules

- **Never swallow an exception.** No empty `catch`. No `catch { return null }` that turns a failure into a missing field three layers away.
- **Errors carry the `correlationId`** — every log line, audit entry and DLQ record for one Kafka record must be retrievable by it.
- **Errors carry their cause.** A TLS handshake failure and an HTTP 5xx drive the same state machine but must remain distinguishable in the alert. Preserve the underlying reason; never flatten to a generic message.
- **Degraded output is flagged, never silent.** Any fallback applied to a `pacs.008` marks it degraded in the audit log.
- **Distinguish "parked" from "dead."** A parked entry is live recovery state and raises an *informational* alert. A dead-letter raises a *failure* alert. Conflating them makes the DLQ unreadable for operators.
- **A 503 is back-pressure, not a bug.** It is the designed response to a downstream dependency being unavailable and must never be re-cast as a 500.

---

## 7. Concurrency and state

**Assume horizontal scaling from the first line of code.** PPA is stateless application logic behind a load balancer; MLA may run concurrent workers. Every design decision assumes replicas processing related events at the same time.

- **No in-process mutable state that outlives a single request or record.** Anything spanning events lives in ValKey or the durable store.
- **No in-memory cache, memoization, or dedup set as a correctness mechanism.** It works on one replica and fails on two. A cache is acceptable only where a stale value is *harmless*.
- **All shared-state mutation is atomic** — Lua compare-and-merge in ValKey, check-and-set in the durable store. **Never a read-then-write.**
- **Jitter is genuinely random.** Fixed jitter causes replicas to synchronize their retry storms — the exact failure mode jitter exists to prevent.
- **Every cache entry has an explicit TTL.** Never indefinite. TTLs derive from the documented formula, accounting for MLA ingestion delay under Kafka lag — not from a Mojaloop expiration field alone.
- **Assume out-of-order arrival is normal**, not exceptional. Any code assuming a prepare has already been processed when a fulfil arrives is wrong.
- **Idempotency is designed in, not added after.** Every write path answers "what happens if this runs twice?" before it is written.
- **Clean up state only on the terminal message**, never on an intermediate stage.

---

## 8. Configuration and secrets

- **All configuration external** — environment variables or mounted config, read once at startup into a **typed, validated config object**. No scattered `process.env` reads.
- **Fail fast on invalid config.** Validate at startup and refuse to start on a missing or malformed value. Never default a security-relevant setting.
- **Secrets are mounted, loaded once at startup, and never network-fetched per event.** They are never logged, never included in an error message, never serialized.
- **If a secret fails to load, the service does not report ready.** Running unprotected while advertising health is the failure mode this rule exists to prevent.
- **Readiness is instance-local only.** Process up, config loaded, local store reachable. **Never** ValKey, never the TMS token chain, never a shared downstream — that pulls healthy replicas out of rotation over someone else's outage.
- **Certificates and keys are mounted, not embedded.** Adding a DFSP public key must not require a restart.
- **Pinned schemas are version-controlled and updated only by explicit, reviewed commit.** Never an automatic pull on startup.

---

## 9. Observability

Every operator question below must be answerable **from telemetry alone**, without attaching a debugger:

- Is the pipeline moving? — throughput and consumer lag per event type
- Is anything being dropped, and deliberately? — skip counters by reason (`egress`, party-discovery, domestic, unclassifiable, duplicate)
- Are we degrading? — degraded-message rate, tokenization-failure rate
- Are we backed up? — 503 rate, breaker state (open/closed/half-open) as a metric on both breakers
- Is anything stuck? — DLQ depth, parked-entry count, retry-exhaustion count
- Are we within budget? — MLA ack latency p95 against the 200 ms target

**Rules:**

- **Structured logging (`pino`), never `console.log`.** Every line carries `correlationId`, `eventType`, and the pipeline step.
- **A metric for every decision the code makes silently.** Anything dropped without an alert must still be counted — a domestic transfer produces no alert *by design*, so its counter is the only visibility that exists.
- **Alerts are actionable.** An alert nobody can act on gets deleted or downgraded to a metric.
- **A log line is not an alert and an alert is not a log line.** Permanent rejections, retry exhaustion, breaker trips and DLQ writes alert. Structural skips do not.

---

## 10. Testing

### 10.1 The standard

**Above 95% coverage with Jest on every piece of code, on every component**, enforced mechanically by `coverageThreshold: 96` in the Jest config plus a CI gate — never a promise anyone has to remember. The four story documents state 95% as the standard; we hold the gate one point above it so the stated bar is genuinely a floor and not the pass mark. This is not negotiable per-module.

But **coverage is a floor, not the goal.** 96% coverage of the happy path with no failure-mode tests is a failing test suite that reports green.

### 10.2 What must be tested, by category

| Category | Requirement |
| --- | --- |
| **Every table row** | Every row of the classification table, the routing table, the trigger/cache table, the `TxSts` translation table, and each ISO message's field mapping has its own test. A table with an untested row is an untested table. |
| **Every failure path** | Missing header, malformed base64, unparseable JSON, unknown `eventType`, unclassifiable combination, ValKey down, store down, store write failure, 4xx, 5xx, timeout, TLS handshake failure, retry exhaustion, breaker trip and resume. |
| **Every ordering constraint** | Each ordering requirement the pipeline has is enforced by a test that fails if the steps are reordered, not by hoping the code stays correct. |
| **Every idempotency path** | First event processed, repeat dropped — for every event type, including a transfer terminal-state repeat carrying a *different* `TxSts`. |
| **Every concurrency path** | Concurrent-replica merge correctness for both trigger and non-trigger events; a concurrent check-and-set race on the same key. |
| **Every degraded path** | Each fallback in the degraded table, asserting the degraded flag is actually set. |
| **Every race** | Fulfil-before-prepare; FX state absent but `determiningTransferId` present; late arrival retrieved from the DLQ after TTL lapse. |
| **Regression checks** | `EndToEndId`, `Dbtr`, `Cdtr`, `DbtrAcct`, `CdtrAcct` present on every non-degraded `pacs.008` — the check that exists because schema validation confirms *shape*, not that an identity field was populated. |
| **Schema conformance** | Each of the four message types' assembled output validated against its pinned schema, using **the same ajv config TMS uses**, including `removeAdditional: 'all'`. |

### 10.3 How tests are written

- **Test behaviour through the public surface**, not private helpers. A test coupled to internals blocks refactoring, which is the opposite of what it is for.
- **Fixtures come from real captures, never hand-written.** A hand-written fixture encodes what you *believe* the wire looks like. Only a capture encodes what it *is*. This is how the `start`/`egress` double-write, the asymmetric `operation` naming, and the non-transaction-scoped `traceId` were all discovered.
- **Fakes over mocks** for the ports. A fake `CacheStore` that actually stores is more truthful than a mock asserting call order — and it will not pass while the real implementation loses a concurrent write.
- **Fakes must reproduce failure behaviour**, not just success. A fake that never times out produces green tests and a broken service.
- **Run the suite in default parallel mode before trusting it.** Concurrency bugs reproduce under parallel workers and pass cleanly every time under `--runInBand`.
- **No test depends on wall-clock sleeps.** Use fake timers. A test that sleeps is a test that will flake in CI.
- **Every test is deterministic.** A flaky test is a broken test and is fixed or deleted the day it flakes — never retried into green.
- **Every bug fix arrives with the test that reproduces it.** Write the failing test first, then the fix.
- **Trace multi-event scenarios by hand before trusting mocked unit tests.** Where the thing under test is an interaction across several async stages, mocks confirm the shape you assumed, not the behaviour that occurs.

---

## 11. Live verification — the rule that outranks paper design

> **A design is a hypothesis until it has been run. We do not ship against paper.**

This is the rule that outranks the others when they conflict.

**Every feature is verified against something real before it is called done:**

- Real captures replayed through the compiled pipeline — not a hand-built payload through a unit test.
- A real ValKey, not a fake, for anything touching correlation, TTL, eviction or concurrent merge.
- A real schema validator with TMS's exact ajv configuration.
- Real concurrency — multiple replicas, at volume — for anything claiming to be atomic or idempotent.

**Verification tools are checked-in code, not scratch scripts.** A replay tool and a load-test tool live in `src/scripts/`, are maintained, and are reused. Nobody writes a throwaway script to verify the same thing twice.

**How to state what has been proven.** Be exact:

- *"Verified live against a real ValKey with 3 concurrent replicas"* — a claim.
- *"Unit-tested with a mocked cache"* — a different, weaker claim.
- **Never present the second as the first.**

**A clean live run proves the component works under the conditions it was exercised with.** It does not prove no latent timing assumption remains. Say what was exercised.

**Where live verification is impossible** — no environment for mTLS, Keycloak, or Kubernetes — say so plainly and mark the item unverified. **Do not claim paper-verified work as done.**

---

## 12. Documentation and traceability

- **Every non-obvious rule in code cites its source**: `// US-PPA-10 / FSD §6.4.3`. A reader must be able to get from a line of code to the sentence that mandates it.
- **When a design decision changes, the document changes with the code — in the same commit.** Code and documentation drifting apart is how the R-29-class defect (a story reasoning from a superseded architecture) happens.
- **Documents state facts directly.** No revision history in prose — no "earlier drafts said…", no "this was changed from…". State what is true now.
- **`core-knowledge.md` is the implementation authority** for what the system must do. **`engineering-rules.md` is the authority for how it is built.** Where a story document and `core-knowledge.md` disagree, the story document wins and `core-knowledge.md` is corrected.
- **New knowledge-base documents are indexed in `strategy.md` on creation.** Not later — in the same commit.
- **Record deliberate deviations where they occur.** A sentinel value, an intentionally-preserved coupling, a pattern deliberately not applied: one line, in the code, saying why.

---

## 13. Git, review, and definition of done

- **Small, focused commits.** One story or one coherent change per commit. Message says *why*, not *what*.
- **Never commit to `main` directly.** Branch, then merge request.
- **Never commit** secrets, certificates, `.env` files, `node_modules`, build output or coverage reports.

**A change is done when all of these are true:**

1. It implements the acceptance criteria of the story it claims, and the story is named in the commit.
2. Tests cover every table row, failure path and race the story implies — **above 95%** coverage (the gate is 96), suite green in **parallel** mode.
3. Zero lint errors.
4. It has been **live-verified**, or the fact that it has not been is stated explicitly.
5. Logs, metrics, and alerts exist for every path it introduces.
6. No raw PII appears anywhere it can be observed.
7. Documentation is updated in the same commit if behaviour changed.
8. Anything left open is written down — in the code with a reference, and in the open register.

**In review, ask in this order:**

1. Does it break a non-negotiable (§1)?
2. What happens if this runs twice? On two replicas? Out of order?
3. What happens when the dependency it calls is down?
4. Is any failure silent?
5. Is any abstraction here paying for itself?
6. Could someone unfamiliar with this read it and be right about what it does?

---

## 14. The anti-pattern list

Each of these is drawn from a failure mode the story documents actually record. They are not hypothetical.

| Anti-pattern | Why it is banned here |
| --- | --- |
| **Read-then-write on shared state** | Silently loses one replica's update. The single most likely correctness bug in this system. |
| **In-memory dedup, cache, or correlation state** | Correct on one replica, wrong on two. |
| **Assuming `transactionId == transferId`** | Produces a `pacs.002` TMS accepts and **never links** to its transfer. Silent, and invisible in every metric. |
| **Rebuilding a message on retry** | New `GrpHdr.MsgId` breaks at-least-once semantics downstream. |
| **Copying Mojaloop extension keys straight through** | Mojaloop uses `FinInstnId.Othr.Id`; Tazama needs `ClrSysMmbId.MmbId`. Copying through is silently stripped by `removeAdditional`. |
| **Trusting an HTTP 200 from TMS** | `removeAdditional: 'all'` strips unknown fields and returns 200 anyway. Local pinned-schema validation is the only defence. |
| **Untranslated `TxSts`** | The field is an unconstrained string. `"COMMITTED"` is accepted and breaks every downstream rule. **No validator catches this.** |
| **Treating a trigger event as exempt from caching** | Degrades *every* `pacs.008`, silently. This exact defect (R-01) reached review. |
| **A generic mapping "engine" over the ISO field tables** | Makes the most important tables in the system unreadable. Write the mapping. |
| **Catching an exception to return a default** | Turns a hard failure into a missing field discovered three layers away. |
| **Advancing an offset on a transient failure** | Discards the event. Transient failures pause; they never skip. |
| **Failing `/health/ready` on a shared downstream** | Pulls every healthy replica out of rotation over one dependency's outage. Use the 503 gate. |
| **Fixed (non-random) jitter** | Synchronizes replica retry storms — the precise failure jitter exists to prevent. |
| **Hand-written fixtures** | Encode what you believe the wire looks like, not what it is. |
| **`--runInBand` to make the suite pass** | Hides real concurrency bugs. |
| **`eslint-disable` for complexity** | Extract helpers instead. |
| **Speculative abstraction** | An extension point for a change nobody can name costs readability now for a benefit that never arrives. |
| **"It's tested, so it works"** | Six of the hardest bugs in the predecessor project were found by running the code, none by unit tests alone. |

---

*End of Document*

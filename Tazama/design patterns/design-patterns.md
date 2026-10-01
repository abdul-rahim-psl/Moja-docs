<!-- SPDX-License-Identifier: Apache-2.0 -->

# Design Patterns in Core Tazama Services

> A brief, evidence-based survey of Gang-of-Four design patterns actually used in the core Tazama transaction-monitoring pipeline (TMS API → Event Director → Rule Executers → Typology Processor → TADProc, plus the shared `frms-coe-lib` / `frms-coe-startup-lib` libraries). Findings are drawn from `/home/abdul-rahim/tazama/docs/Product` and verified against the real source in `/home/abdul-rahim/tazama/<service>`. Each entry cites the exact file so it can be checked.

Definitions follow the standard GoF catalogue (see [refactoring.guru/design-patterns](https://refactoring.guru/design-patterns)) — only patterns actually evidenced in code are listed as "in use"; others considered but not found are noted at the end.

---

## Creational Patterns

### Singleton — *in use*

Every core processor (Event Director, Typology Processor, TADProc, Rule Executer) wraps its `DatabaseManagerInstance` in a static `Singleton` class so the expensive DB/Redis connection pool is created once per process and reused across every transaction handled by that service instance.

```ts
// event-director/src/services/services.ts and typology-processor/src/services/services.ts (identical shape)
export class Singleton {
  private static dbManager: DatabaseManagerInstance<Configuration>;
  public static async getDatabaseManager(configuration: Configuration) {
    if (!Singleton.dbManager) {
      const { db } = await CreateStorageManager<typeof configuration>([...]);
      Singleton.dbManager = db;
    }
    return { db: Singleton.dbManager, config: configuration };
  }
}
```

- **Where:** `event-director/src/services/services.ts:7`, `typology-processor/src/services/services.ts:9` (near-identical `Singleton` class repeated per service — a deliberate house convention, confirmed by the developers' own `-- singleton` eslint-disable comment).
- **Why:** avoids re-establishing ArangoDB/PostgreSQL/Redis connections on every incoming NATS message; the lazily-initialized static field is the classic Singleton guard (`if (!Singleton.dbManager)`).

### Factory Method — *in use*

`StartupFactory` decides, at construction time, whether the transport layer is NATS core or JetStream, and returns a common `IStartupService` — callers never instantiate `NatsService`/`JetstreamService` directly.

```ts
// frms-coe-startup-lib/src/services/startupFactory.ts
export class StartupFactory implements IStartupService {
  startupService: IStartupService;
  constructor() {
    switch (startupConfig.startupType) {
      case 'jetstream': this.startupService = new JetstreamService(); break;
      case 'nats': this.startupService = new NatsService(); break;
    }
  }
  ...
}
```

The relay-service's plugin loader is the same idea taken further — the concrete transport class is chosen and instantiated **dynamically at runtime** from an environment variable, then adapted behind `ITransportPlugin`:

```ts
// relay-service/src/utils/loadTransportPlugin.ts
const { default: moduleDefault } = await import(pluginName);
const PluginInstance = moduleDefault.default;
return new PluginInstance();
```

- **Where:** `frms-coe-startup-lib/src/services/startupFactory.ts:9`, `relay-service/src/utils/loadTransportPlugin.ts:6`, driven from `relay-service/src/services/initTransport.ts:14` (`configuration.DESTINATION_TRANSPORT_TYPE`).
- **Why:** every processor (Event Director, rule executers, Typology Processor, TADProc) is built against the same `IStartupService`/`onMessage` contract regardless of which broker technology is actually deployed; swapping NATS↔JetStream or REST↔Kafka↔BigQuery↔RabbitMQ↔GCS relay targets is a config change, not a code change.
- **Also used for:** `CreateDatabaseManager` / `CreateStorageManager` in `frms-coe-lib/src/services/dbManager.ts:82,129` — factory functions that assemble and return a ready-to-use manager instance (see Builder below; the two patterns are combined here).

### Builder — *in use*

`CreateDatabaseManager` in `frms-coe-lib` assembles a single `DatabaseManagerInstance` out of independently-optional parts (event history, raw history, evaluation, configuration, enrichment DBs, Redis) by calling a dedicated builder function for each part only if that part was requested in config.

```ts
// frms-coe-lib/src/services/dbManager.ts
export async function CreateDatabaseManager<T extends ManagerConfig>(config: T, hooks?) {
  const manager: DatabaseManagerType = {};
  if (config.eventHistory)   await eventHistoryBuilder(manager, config.eventHistory);
  if (config.rawHistory)     await rawHistoryBuilder(manager, config.rawHistory);
  if (config.evaluation)     await evaluationBuilder(manager, config.evaluation);
  if (config.configuration)  await configurationBuilder(manager, config.configuration, ...);
  if (config.enrichment)     await enrichmentBuilder(manager, config.enrichment);
  ...
  return manager as DatabaseManagerInstance<T>;
}
```

- **Where:** `frms-coe-lib/src/services/dbManager.ts:82` orchestrating `frms-coe-lib/src/builders/{eventHistoryBuilder,rawHistoryBuilder,evaluationBuilder,configurationBuilder,enrichmentBuilder,redisBuilder}.ts`.
- **Why:** each service (Event Director only needs `configuration` + cache; a rule executer needs `eventHistory` + `rawHistory` + `configuration`; TADProc needs `evaluation`) declares only the storage capabilities it needs, and the same builder machinery composes exactly that subset into one manager object — a textbook step-by-step construction of a complex, variably-shaped product, rather than one bloated constructor with every dependency.

### Abstract Factory / Prototype — *not evidenced*

No family of related object factories (Abstract Factory) or clone-based object creation (Prototype) was found. Configuration/typology/rule objects are always constructed fresh from JSON fetched via the config DB, never cloned from a prototype instance.

---

## Structural Patterns

### Adapter — *in use*

`ITransportPlugin` (relay-service) and `IRelay` (`frms-coe-startup-lib`) both give wildly different downstream technologies — NATS, a plain REST endpoint, BigQuery, RabbitMQ, Google Cloud Storage — the same narrow interface (`init()` / `relay(data)`), converting each SDK's native API into the shape the rest of Tazama expects.

```ts
// frms-coe-startup-lib/src/interfaces/iRelayService.ts
export interface IRelay { relay: (data: Uint8Array) => Promise<void>; }

// frms-coe-startup-lib/src/services/natsRelayService.ts
export class NatsRelay implements IRelay { async relay(data) { this.NatsConn_Producer?.publish(...) } }
// frms-coe-startup-lib/src/services/restRelayService.ts
export class RestRelay implements IRelay { async relay(data) { await axios.post(this.config.destinationUrl, ...) } }
```

- **Where:** `frms-coe-startup-lib/src/interfaces/iRelayService.ts:1` with implementations `natsRelayService.ts`, `restRelayService.ts`, `bigQueryRelayService.ts`, `rabbitMQRelayService.ts`, `googleBucketsService.ts`; also `relay-service`'s `ITransportPlugin` contract.
- **Why:** the Case Management System / interdiction / alerting consumers of Tazama's output don't all speak NATS — Adapter lets the same "send this result somewhere" call site work against any of them.
- **Note:** this is the same class hierarchy analysed as Strategy below — Adapter (uniform interface over incompatible APIs) and Strategy (interchangeable algorithm selected at runtime) are two valid lenses on the identical code; both readings are defensible.

### Facade — *in use*

`DatabaseManagerInstance` (built via the Builder above) is exposed to every processor as one object with simple named methods (`getRuleConfig`, `getTypologyConfig`, `getNetworkMap`, `saveEvaluationResult`, `addOneGetAll`, `isReadyCheck`, `quit`) that hides ArangoDB/PostgreSQL/Redis connection pools, query construction, and health-check bookkeeping behind it.

- **Where:** `frms-coe-lib/src/services/dbManager.ts` (the `DatabaseManagerType`/`DatabaseManagerInstance` surface), consumed uniformly in `rule-executer/src/controllers/execute.ts:86` (`databaseManager.getRuleConfig(...)`), `typology-processor/src/logic.service.ts:78` (`databaseManager.getTypologyConfig(...)`), `event-director/src/services/logic.service.ts:94` (`databaseManager.getNetworkMap()`).
- **Why:** business logic in each processor never touches a driver, a connection string, or a query builder directly — it calls one high-level facade method per concern.

### Composite — *partially evidenced*

The **Network Map** itself (`messages[] → typologies[] → rules[]`, documented in `docs/Product/configuration-management.md` §2.3) is a classic tree-shaped configuration structure, and the Event Director's "pruning" step (`docs/Product/event-director.md` §2.3, implemented as `getRuleMap`/`prunedMessage` filtering in `event-director/src/services/logic.service.ts:35,89`) operates uniformly over that tree to produce a sub-tree. However, this is a **data structure** (plain JSON walked with `for`/`filter`), not an object hierarchy with a shared component interface (`add`/`remove`/`operation()`) — so it reflects the *intent* of Composite (uniform treatment of a whole/part hierarchy) without the GoF object-oriented machinery. Flagged as a partial/informal match rather than a strict textbook instance.

### Bridge, Decorator, Flyweight, Proxy — *not evidenced*

- **Bridge:** no split between an abstraction hierarchy and an implementation hierarchy that vary independently was found.
- **Decorator:** no runtime wrapping of objects to layer on behaviour; cross-cutting concerns (APM spans, logging) are called inline (`apm.startSpan(...)`, `loggerService.log(...)`) rather than via decorator wrapping.
- **Flyweight:** the Event Director's node-cache of network maps (`nodeCache.get<NetworkMap>(cacheKey)` in `event-director/src/services/logic.service.ts:85`) and rule-config caching are a performance-driven cache, not intrinsic/extrinsic state-sharing between many fine-grained objects.
- **Proxy:** no controlled-access wrapper (virtual, protection, or remote proxy) around an object was found; NATS calls are plain async client calls.

---

## Behavioural Patterns

### Chain of Responsibility — *in use* (the platform's central pattern)

The entire evaluation pipeline is a chain: **TMS API → Event Director → Rule Executer(s) → Typology Processor → TADProc → Case Management/Interdiction**. Each stage receives the accumulating payload (transaction + network sub-map + results-so-far), does its one job, and forwards an augmented payload to the next stage over NATS — exactly as documented in `docs/Product/processor-results-propagation.md` ("results from each processor should be wrapped around the results from a previous processor").

```
ruleResults{}  →  typologyResults{ ruleResults[1..n] }  →  transactionResults{ typologyResults[1..n]{ ruleResults[1..n] } }
```

- **Where:** `event-director/src/services/logic.service.ts:169` (`server.handleResponse(toSend, [sub-rule-<id>])`) → `rule-executer/src/controllers/execute.ts:155` (`server.handleResponse({...request, ruleResult})`) → `typology-processor/src/logic.service.ts:161` (`server.handleResponse({...tadpReqBody}, [typology-<cfg>])`) → `transaction-aggregation-decisioning-processor/src/services/logic.service.ts:90` (`server.handleResponse(result, alertSubject)`).
- **Why:** each processor is decoupled from its neighbours' internals — it only knows "pass this on to the next NATS subject" — and any stage can short-circuit the chain (e.g. EFRuP issuing an immediate interdiction alert without waiting for the rest of the chain, per `docs/Product/event-flow-rule-processor.md`).

### Template Method — *in use*

`rule-executer/src/controllers/execute.ts` defines the invariant skeleton every rule follows (parse request → look up rule config → **call rule-specific logic** → format/send result to Typology Processor), while the rule-specific steps are supplied per-rule. Rule 901's own `handleTransaction` even labels its internal steps to match the skeleton (`docs/Product/rule-processor-overview.md` §3.3–3.7): "Step 1: Early exit conditions", "Step 2: Query Setup", "Step 3: Query Execution", "Step 4: Query post-processing".

```ts
// rule-executer/src/controllers/execute.ts — fixed skeleton
ruleRes = await handleTransaction(request, determineOutcome, ruleRes, loggerService, ruleConfig, databaseManager);
await server.handleResponse({ ...request, ruleResult: ruleRes });

// rule-collection/rule-901/src/rule-901.ts — the "hook" filled in per rule
export async function handleTransaction(req, determineOutcome, ruleRes, loggerService, ruleConfig, databaseManager) {
  // Step 1: Early exit conditions ...
  // Step 2: Query Setup ...
  // Step 3: Query Execution ...
  return determineOutcome(length, ruleConfig, ruleRes);   // Step 4 delegated back out
}
```

- **Where:** `rule-executer/src/controllers/execute.ts:119` invoking each rule's `handleTransaction`, e.g. `rule-collection/rule-901/src/rule-901.ts:12`.
- **Why:** this is exactly the "rule executer shell handles common functions... leaving unique code in the rule processor" design principle stated in `docs/Product/rule-processor-overview.md` ("The rule executer") — one fixed algorithm shape, ~900 interchangeable rule bodies (see `rule-collection/` — dozens of `rule-NNN` packages all conforming to the same `handleTransaction` signature).

### Strategy — *in use*

Two independent instances:

1. **Result classification.** `determineOutcome` (banded/cased classification, `rule-executer/src/helpers/determineOutcome.ts:5`) is injected into every rule's `handleTransaction` as a callback/strategy — the classification algorithm is common, but *which bands or cases* it evaluates against is swapped per rule via the rule's own JSON configuration (`docs/Product/configuration-management.md` §2.1, banded vs. cased results).
2. **Transport/relay selection.** As described under Adapter above, `IRelay`/`ITransportPlugin` implementations (NATS, REST, BigQuery, RabbitMQ, GCS) are interchangeable algorithms for "deliver this payload", selected at startup by configuration (`relay-service/src/services/initTransport.ts:14`) rather than hard-coded.
3. **Typology scoring expression.** `evaluateTypologyExpression` (`typology-processor/src/utils/evaluateTExpression.ts:8`) walks an arbitrary MathJSON `expression` tree (`Add`/`Multiply`/`Divide`/`Subtract`) read from the typology's configuration document rather than a hard-coded formula — the scoring algorithm for a given typology is effectively data-selected at runtime (bordering on **Interpreter**, since it evaluates a small expression grammar, but used here as one pluggable scoring strategy per typology rather than a general-purpose language).

- **Where:** `rule-executer/src/helpers/determineOutcome.ts`, `frms-coe-startup-lib/src/interfaces/iRelayService.ts` + implementations, `typology-processor/src/utils/evaluateTExpression.ts`.

### Mediator — *in use* (informal)

The **Typology Processor** acts as a mediator between rule processors: individual rules never talk to each other or know about their sibling rules within a typology, they only emit a `ruleResult` to the Typology Processor, which is the sole component that knows how to correlate multiple rules' results into one typology outcome (`ruleResultAggregation` in `typology-processor/src/logic.service.ts:23`). Likewise the **Event Director** mediates between the incoming transaction and the set of rule processors that must see it — rules are unaware of the network map or of each other; only the Event Director resolves that routing.

- **Where:** `typology-processor/src/logic.service.ts:23` (`ruleResultAggregation`), `event-director/src/services/logic.service.ts:35` (`getRuleMap`).
- **Why:** this is what keeps the rule-collection (900+ independent rule packages) decoupled from each other — adding, removing, or reconfiguring a rule never requires touching another rule's code, only the shared network-map/typology configuration that the mediator (Typology Processor / Event Director) interprets.

### Memento — *in use* (informal)

Because rule results for a single transaction arrive at the Typology Processor asynchronously and out of order (each rule executer runs independently and in parallel), the Typology Processor persists each partial `ruleResult` to Redis as it arrives (`saveToRedisGetAll` in `typology-processor/src/logic.service.ts:12`, matching `docs/Product/typology-processing.md` §5.3.1–5.4 "Fetch rule results" / "Append rule result") and only proceeds to scoring once all expected results for a typology have accumulated. This snapshotting of in-flight evaluation state (keyed by `tenantId:transactionId`) so it can be restored/added-to across independent, out-of-order arrivals is the essence of Memento, even though the implementation is a cache write rather than a first-class "Originator/Caretaker" object pair.

- **Where:** `typology-processor/src/logic.service.ts:12` (`saveToRedisGetAll`), garbage-collected once complete at `typology-processor/src/logic.service.ts:231` (`databaseManager.deleteKey(cacheKey)`).

### Observer, Command, Iterator, State, Visitor — *not evidenced*

- **Observer:** communication is point-to-point pub via NATS subjects addressed explicitly by the sender (`server.handleResponse(payload, [subject])`), not a publish/subscribe registry of observers reacting to a subject's state changes within the codebase's own object model.
- **Command:** no request-as-object with `execute()`/undo semantics; rule invocations are direct async function calls.
- **Iterator:** only plain `for...of`/`Array.prototype` traversal over network-map/rule arrays — no custom iterator abstraction.
- **State:** the EFRuP block/override/none outcomes and typology alert/interdiction/none outcomes (`docs/Product/event-flow-rule-processor.md`, `docs/Product/typology-processing.md` §5.8) are modelled as plain conditional branches and string flags (`review`, `subRuleRef`), not as a State pattern with encapsulated per-state classes.
- **Visitor:** no double-dispatch operating over a heterogeneous object structure was found.

---

## Summary Table

| Category | Pattern | Verdict | Primary evidence |
|---|---|---|---|
| Creational | Singleton | ✅ In use | `event-director/src/services/services.ts`, `typology-processor/src/services/services.ts` |
| Creational | Factory Method | ✅ In use | `frms-coe-startup-lib/src/services/startupFactory.ts`, `relay-service/src/utils/loadTransportPlugin.ts` |
| Creational | Builder | ✅ In use | `frms-coe-lib/src/services/dbManager.ts` + `src/builders/*` |
| Creational | Abstract Factory | ❌ Not found | — |
| Creational | Prototype | ❌ Not found | — |
| Structural | Adapter | ✅ In use | `frms-coe-startup-lib/src/interfaces/iRelayService.ts` + implementations |
| Structural | Facade | ✅ In use | `DatabaseManagerInstance` (`frms-coe-lib/src/services/dbManager.ts`) |
| Structural | Composite | ⚠️ Partial/informal | Network map tree + pruning, `event-director/src/services/logic.service.ts` |
| Structural | Bridge, Decorator, Flyweight, Proxy | ❌ Not found | — |
| Behavioural | Chain of Responsibility | ✅ In use (central pattern) | ED → Rule Executer → Typology Processor → TADProc via NATS |
| Behavioural | Template Method | ✅ In use | `rule-executer/src/controllers/execute.ts` + any `rule-collection/rule-*` |
| Behavioural | Strategy | ✅ In use | `determineOutcome.ts`, relay/transport plugins, `evaluateTExpression.ts` |
| Behavioural | Mediator | ✅ In use (informal) | Typology Processor's `ruleResultAggregation`, Event Director's routing |
| Behavioural | Memento | ✅ In use (informal) | Typology Processor's Redis partial-result cache |
| Behavioural | Observer, Command, Iterator, State, Visitor | ❌ Not found | — |

---

## Overall Takeaway

Tazama's core is not "patterns for their own sake" — the patterns present all trace back to one architectural decision documented in `docs/Product/configuration-management.md`: **keep the evaluation pipeline config-driven and each processor generic/interchangeable.** Chain of Responsibility gives the pipeline its shape; Template Method + Strategy let ~900 independent rule packages share one execution shell while differing only in their query and classification logic; Factory Method + Builder let the same processor code run unmodified against different message brokers, databases, or relay targets purely via environment configuration; Mediator and the Redis-backed Memento are what make asynchronous, out-of-order rule results resolvable back into one typology score; and Singleton/Facade keep every processor's interaction with its storage layer to one cheap, simple call site. The GoF vocabulary is a good fit for describing this system because the system was built around the same decoupling goals those patterns exist to solve — not because the patterns were applied prescriptively.

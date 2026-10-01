<!-- SPDX-License-Identifier: Apache-2.0 -->

# Structural Design Patterns in Core Tazama

> A teaching-oriented deep dive into the **structural** half of the GoF catalogue, using core Tazama (`/home/abdul-rahim/tazama/<service>`) as the running example. Companion to [`design-patterns.md`](./design-patterns.md), which covers all three GoF categories more briefly — this document exists to actually explain each structural pattern well enough that you could implement one from scratch, and then show you exactly where Tazama does (or deliberately doesn't) use it.

## What "structural" means, as a category

The three GoF families answer three different questions:

- **Creational** patterns answer *"how does an object get built?"*
- **Structural** patterns answer *"how do objects get wired together into larger structures, without those structures becoming fragile or tangled?"*
- **Behavioural** patterns answer *"how do objects talk to each other and share responsibility for a task?"*

Structural patterns are all, at heart, about **composition over inheritance** — taking existing classes/objects (which you may not be able to change) and combining them into something bigger through object composition, rather than by growing an ever-deeper inheritance tree. Every pattern below is a different *shape* of composition, aimed at a different problem: incompatible interfaces, an overgrown subsystem, a part/whole hierarchy, optional behaviour, memory pressure from too many similar objects, or controlled access to an object.

There are seven structural patterns in the classic catalogue: **Adapter, Bridge, Composite, Decorator, Facade, Flyweight, Proxy**. Tazama's core pipeline clearly uses two of them (Adapter, Facade), partially reflects the *intent* of a third (Composite) without its full object-oriented machinery, and doesn't use the remaining four. Below, each pattern gets: the problem it solves, the shape of the solution, a simple analogy, and then the honest verdict for Tazama with file-level evidence.

---

## Adapter — *in use*

### The problem

You have an existing class (or third-party library, or SDK) whose interface doesn't match the interface your code expects, and you cannot or don't want to change either side. Calling it directly means your calling code has to know the specifics of that one implementation — and if you ever need to swap it for a different one, that knowledge is scattered everywhere it was called.

### The solution shape

Define a small interface expressing *what your code needs* ("send this data somewhere"), then write one thin **adapter class per external thing you need to talk to**, each implementing that interface by translating calls into whatever the underlying SDK actually requires. Your business logic is written once, against the interface, and never touches axios, the NATS client, or a cloud SDK directly.

```
   caller ──▶ TargetInterface ◀── Adapter ──▶ Adaptee (incompatible SDK / API)
```

### Analogy

A power plug adapter doesn't change what your laptop does or what the wall socket does — it just sits between them so two incompatible shapes can connect.

### How Tazama uses it

Every downstream destination Tazama can send a result to — a NATS subject, a plain REST endpoint, Google BigQuery, RabbitMQ, Google Cloud Storage — has a completely different SDK and calling convention. Tazama defines one narrow interface, `IRelay`, and a same-shaped `relay(data)` method is all any caller ever needs to know:

```ts
// frms-coe-startup-lib/src/interfaces/iRelayService.ts
export interface IRelay { relay: (data: Uint8Array) => Promise<void>; }
```

```ts
// frms-coe-startup-lib/src/services/natsRelayService.ts
export class NatsRelay implements IRelay {
  async relay(data: Uint8Array) { this.NatsConn_Producer?.publish(relayConfig.producerStream, data); }
}

// frms-coe-startup-lib/src/services/restRelayService.ts
export class RestRelay implements IRelay {
  async relay(data: Uint8Array) { await axios.post(this.config.destinationUrl, { message: data }, agent); }
}
```

Each class translates the *same* call — "relay this payload" — into whatever `NatsConnection.publish()`, `axios.post()`, the BigQuery client, the RabbitMQ client, or the Google Cloud Storage client actually require. `relay-service`'s `ITransportPlugin` (`relay-service/src/utils/loadTransportPlugin.ts`) is the same idea taken one step further — the concrete adapter class is loaded dynamically at runtime from an environment variable (`DESTINATION_TRANSPORT_TYPE`), so adding a brand-new destination technology doesn't require touching any existing code at all.

- **Where:** `frms-coe-startup-lib/src/interfaces/iRelayService.ts:1`, with implementations `natsRelayService.ts`, `restRelayService.ts`, `bigQueryRelayService.ts`, `rabbitMQRelayService.ts`, `googleBucketsService.ts`.
- **What it buys Tazama:** the Case Management System, interdiction service, and alerting consumers don't all speak NATS — Adapter lets "send this result" be one call site regardless of which transport is actually configured for a given deployment.
- **A note on double-reading this code:** this exact class hierarchy is also analysed as **Strategy** in the behavioural-patterns document, because the classes are also *interchangeable algorithms selected at runtime*. Both readings are correct — Adapter and Strategy have literally identical UML shapes (an interface with several interchangeable implementations); what tells them apart is *intent*. Here the intent is squarely "translate to an incompatible API" (Adapter), which happens to *also* be selected dynamically (Strategy). Real code often satisfies two pattern intents with one structure — that's not a contradiction, it's a sign the design is doing its job in more than one way.

---

## Facade — *in use*

### The problem

A subsystem — a database driver, a connection pool, a set of related services — has a big, low-level, easy-to-misuse API. Every caller that needs "get me the rule config" ends up re-implementing connection handling, query construction, and error handling, and callers become tightly coupled to implementation details of the subsystem that have nothing to do with their actual business logic.

### The solution shape

Put one class in front of the subsystem that exposes a small number of high-level, intention-revealing methods (`getRuleConfig()`, `saveEvaluationResult()`) and internally does whatever plumbing is required — opening connections, building queries, handling driver-specific errors. Callers depend only on the facade, never on the subsystem underneath it.

```
   caller ──▶ Facade.getRuleConfig(id) ──▶ [connection pool, query builder, driver, retries...]
```

### Analogy

A car's ignition key is a facade over the engine's fuel injection, starter motor, and ignition timing — you turn the key, you don't operate each subsystem yourself.

### How Tazama uses it

`frms-coe-lib`'s `DatabaseManagerInstance` is handed to every processor (Event Director, every rule executer, Typology Processor, TADProc) as a single object exposing simple, purpose-named async methods: `getRuleConfig(...)`, `getTypologyConfig(...)`, `getNetworkMap()`, `saveEvaluationResult(...)`, `addOneGetAll(...)`, plus lifecycle helpers `isReadyCheck()` and `quit()`. None of the ArangoDB/PostgreSQL query construction, connection-pool management, or Redis client details are ever visible at the call site:

```ts
// rule-executer/src/controllers/execute.ts:86
ruleConfig = await databaseManager.getRuleConfig(ruleRes.id, ruleRes.cfg, request.transaction.TenantId);

// typology-processor/src/logic.service.ts:78
const expression = await databaseManager.getTypologyConfig(currTypologyResult.id, currTypologyResult.cfg, tenantId);

// event-director/src/services/logic.service.ts:94
const networkConfigurationList = await databaseManager.getNetworkMap();
```

Business logic in each processor calls one facade method per concern and nothing else — the facade itself is assembled behind the scenes by the Builder pattern (see `design-patterns.md`'s Creational section), which is a nice example of two structural/creational patterns working together: Builder constructs the object, Facade is the simplified shape that object presents once built.

- **Where:** `frms-coe-lib/src/services/dbManager.ts` (the `DatabaseManagerType`/`DatabaseManagerInstance` surface).
- **What it buys Tazama:** if the underlying database technology, driver, or query strategy ever changes, only the builder functions inside `frms-coe-lib` need to change — none of the dozens of call sites across every processor and every rule package do.

---

## Composite — *partially / informally reflected*

### The problem

You have a tree of objects — some are individual "leaf" items, some are containers of other items (which may themselves contain more items) — and you want client code to treat a single item and a whole sub-tree of items *the same way*, without constantly checking "is this one item or a group?".

### The solution shape

Define one common interface for both leaf and container nodes. A container implements the interface by delegating/aggregating over its children; a leaf implements it directly. Client code calls the same operation on either, and recursion handles the rest.

```
        Component (common interface: operation())
        /                              \
     Leaf.operation()          Composite.operation()
                                  → calls operation() on each child
```

### Analogy

A file-system folder and a file both respond to "what's your size?" — a folder just adds up its children's answers. You never need to know in advance whether something is a file or a folder to ask that question.

### How Tazama reflects (but doesn't fully implement) it

Tazama's **network map** is exactly the tree shape Composite exists for — `docs/Product/configuration-management.md` §2.3 describes it explicitly as a hierarchy of `messages[] → typologies[] → rules[]`, and the Event Director's job includes "pruning" that tree down to only the branches relevant to an incoming transaction (`docs/Product/event-director.md` §2.3):

```ts
// event-director/src/services/logic.service.ts:35 — walks the tree uniformly
function getRuleMap(networkMap: NetworkMap, transactionType: string): Rule[] {
  const messages = networkMap.messages.find((tran) => tran.txTp === transactionType);
  if (messages) {
    for (const typology of messages.typologies) {
      for (const rule of typology.rules) { /* collect, de-duplicate */ }
    }
  }
  return rules;
}
```

```ts
// event-director/src/services/logic.service.ts:89 — produces a pruned sub-tree
prunedMessage = cachedActiveNetworkMap.messages.filter((msg) => msg.txTp === txTp);
```

This is Composite's *intent* — uniform traversal of, and operations over, a whole/part hierarchy — but **not** its object-oriented machinery. There's no shared `Component` interface with an `operation()` method that both a "rule" object and a "typology" object implement polymorphically; the network map is plain nested JSON, and the pruning/traversal is done with ordinary `for`/`filter`/`find` over arrays. That's a legitimate and often simpler way to represent a tree — it just isn't the textbook GoF Composite (which is specifically about giving heterogeneous node *types* a common polymorphic interface). Worth knowing both readings: if you were asked "is Tazama's network map a Composite?" in an interview sense, the honest answer is *"it has Composite's shape and solves Composite's problem, but it's implemented as data, not as a class hierarchy."*

- **Where:** `event-director/src/services/logic.service.ts:35` (`getRuleMap`), `:89` (`prunedMessage` filtering); tree structure documented in `docs/Product/configuration-management.md` §2.3 ("The Network Map").

---

## Bridge — *not used in Tazama core*

### The problem

You have an abstraction (say, "a shape") and multiple implementations of some varying concern (say, "how it's rendered") — and both the set of abstractions and the set of implementations are expected to grow *independently*. If you model this with plain inheritance (`RedCircle`, `BlueCircle`, `RedSquare`, `BlueSquare`, ...) you get a combinatorial explosion of subclasses every time either dimension grows.

### The solution shape

Split the two varying dimensions into two separate hierarchies, and connect them with composition instead of inheritance: the abstraction holds a *reference* to an implementation object and delegates to it. Now you can add a new shape or a new render mode independently, each with only one new class.

```
   Abstraction ──has-a──▶ Implementor
   (RemoteControl)         (Device: TV, Radio...)
   RemoteControl subclasses    Device subclasses
   vary independently from     vary independently from
   each other                  each other
```

### Analogy

A TV remote (abstraction) works with any brand of TV (implementation) because the remote only depends on a generic "device" interface, not on Sony-specific or Samsung-specific control logic. You can swap either the remote design or the TV brand without touching the other.

### Verdict for Tazama

Not found. Nothing in the core pipeline has two independently-varying hierarchies bridged by a held reference in this way. The closest cousin in spirit is the Adapter usage above — but Adapter is about making one incompatible interface fit an existing expectation, not about deliberately decoupling two hierarchies that are both expected to grow. If Tazama later wanted, say, several *families* of processors (e.g. an alternate typology-scoring engine) each pluggable against several *families* of storage backends, independently — that's the shape where Bridge would start to earn its keep.

---

## Decorator — *not used in Tazama core*

### The problem

You want to attach additional behaviour to an individual object at runtime — without modifying its class, and without creating a new subclass for every possible combination of added behaviours (which, like Bridge's problem, explodes combinatorially: `LoggedRule`, `TracedRule`, `LoggedTracedRule`, ...).

### The solution shape

Wrap the object in another object that implements the *same* interface, forwards calls to the wrapped object, and adds its own behaviour before/after forwarding. Decorators can be stacked, each adding one concern, and the caller can't tell a decorated object from a plain one because they share an interface.

```
   caller ──▶ LoggingDecorator ──▶ TracingDecorator ──▶ RealObject
              (same interface throughout the chain)
```

### Analogy

Wrapping a gift: each layer of wrapping paper adds presentation without changing what's inside, and you can add as many layers as you like — the box underneath never has to know it's been wrapped.

### Verdict for Tazama

Not found, and this is worth pausing on because Tazama *does* have exactly the kind of cross-cutting concerns Decorator is often used for — APM tracing spans and structured logging appear on nearly every function in the pipeline. But Tazama doesn't wrap objects to add these; it calls them **inline**, directly in the business logic:

```ts
// rule-executer/src/controllers/execute.ts — inline, not decorated
const span = apm.startSpan(`rule.${ruleRes.id}.findResult`);
try {
  ruleRes = await handleTransaction(request, determineOutcome, ruleRes, loggerService, ruleConfig, databaseManager as any);
  span?.end();
} catch (error) { span?.end(); /* ... */ }
```

This is a deliberate trade-off, not an oversight: inline `apm.startSpan()`/`span.end()` pairs are easy to read top-to-bottom and easy to correlate with the specific step being measured, at the cost of that boilerplate being repeated in every controller. A Decorator-based approach (e.g. a generic `withTracing(fn)` wrapper) would remove the repetition but make it harder to see, at a glance, exactly which internal step a given span covers. Good to recognise both options exist — Tazama chose explicitness over the a Decorator wrapping.

---

## Flyweight — *not used in Tazama core*

### The problem

You need a very large number of similar objects (think: every character glyph on a page, or every tree in a forest scene), and creating one full, independent object per instance would use far more memory than the situation warrants — especially when much of each object's state is identical across instances.

### The solution shape

Split an object's state into **intrinsic** state (shared, identical across many instances — e.g. a tree's mesh and texture) and **extrinsic** state (unique per instance — e.g. a tree's x/y position). Share one object per distinct intrinsic state via a factory/pool, and pass extrinsic state in as a parameter at the point of use, rather than storing it on the object.

```
   FlyweightFactory ──returns shared──▶ Flyweight (intrinsic state only)
   caller passes extrinsic state in on every call: flyweight.render(x, y)
```

### Analogy

A print shop keeps one physical stamp for the letter "A" rather than casting a new one every time a document needs an "A" — the stamp (intrinsic) is shared; where it's pressed on the page (extrinsic) differs every time.

### Verdict for Tazama

Not found, and Tazama's caches are a different thing worth distinguishing carefully, because it's an easy mix-up. The Event Director caches the active network map in a `nodeCache` (`event-director/src/services/logic.service.ts:85`, `nodeCache.get<NetworkMap>(cacheKey)`) and rule configs are cached similarly elsewhere — but that's a **performance cache**: avoiding a repeated database round-trip for data that doesn't change often, by keeping one copy around and re-reading it in place. Flyweight is a narrower, specific technique: deliberately splitting *one conceptual object's* state into a shared part and a per-instance part *so that many logical instances can share one physical object*. Tazama has no scenario where it's minting a large number of fine-grained, mostly-identical objects — a network map is fetched once and reused wholesale, not decomposed into shared/unique parts for thousands of concurrent instances.

---

## Proxy — *not used in Tazama core*

### The problem

You want to control access to an object — deferring its expensive creation until it's actually needed (**virtual proxy**), checking permissions before letting a call through (**protection proxy**), or standing in for an object that actually lives on a different process/machine (**remote proxy**) — without the calling code needing to know that anything other than the real object is involved.

### The solution shape

Create a proxy class that implements the *same* interface as the real object. The proxy either creates/fetches the real object lazily, or performs a check, or forwards the call across a network — the caller just calls the interface normally.

```
   caller ──▶ Proxy.operation() ──▶ [lazy init / access check / network hop] ──▶ RealSubject.operation()
```

### Analogy

A cheque is a proxy for money in your bank account — you can hand someone a cheque without handing over the actual cash; it's redeemed against the real thing only when needed, and the bank can refuse it (an access check) before that happens.

### Verdict for Tazama

Not found. NATS/JetStream calls throughout the codebase are made directly against the connected client (`this.NatsConn_Producer?.publish(...)`, `this.js` in `jetstreamService.ts`) with no intervening object standing in for a not-yet-connected or access-controlled version of that client. This is a reasonable choice for Tazama's architecture: each processor establishes its NATS/DB connections once at startup (a pattern much closer to eager Singleton initialization — see `design-patterns.md`'s Creational section — than to Proxy's lazy/controlled-access initialization), so there's no "maybe I won't need this expensive object" scenario for Proxy to optimise, and access control (multi-tenant isolation, auth) is handled at the API/auth-service layer rather than per-object.

---

## Summary Table

| Pattern | Problem it solves | Verdict in Tazama core | Where to look |
|---|---|---|---|
| **Adapter** | Make an incompatible interface fit what your code expects | ✅ In use | `frms-coe-startup-lib/src/interfaces/iRelayService.ts` + `Nats/Rest/BigQuery/RabbitMQ/Google` relay classes |
| **Facade** | Hide a complex subsystem behind a small, simple API | ✅ In use | `DatabaseManagerInstance` in `frms-coe-lib/src/services/dbManager.ts` |
| **Composite** | Treat a single item and a tree of items uniformly | ⚠️ Intent reflected, not the OO machinery | Network map tree + pruning in `event-director/src/services/logic.service.ts` |
| **Bridge** | Let two independently-varying hierarchies compose instead of multiplying subclasses | ❌ Not used | — |
| **Decorator** | Attach behaviour to an object at runtime without subclassing | ❌ Not used (done inline instead) | APM/logging calls throughout every controller |
| **Flyweight** | Share intrinsic state across many fine-grained objects to save memory | ❌ Not used (Tazama caches whole objects, doesn't split state) | Event Director's `nodeCache` is a cache, not a Flyweight |
| **Proxy** | Control/defer/relay access to an object transparently | ❌ Not used | — |

## The teaching takeaway

Notice the shape of what Tazama *did* reach for versus what it didn't: **Adapter** and **Facade** are both about *simplifying and stabilising the boundary* between Tazama's own code and things outside its control (external SDKs, a database subsystem) — exactly the boundary where a system integrated with many payment platforms, brokers, and storage backends most needs insulation from change. **Bridge, Decorator, Flyweight, and Proxy** solve problems Tazama simply doesn't have at its core: it doesn't have two independently-multiplying class hierarchies (Bridge), it prefers explicit inline cross-cutting code over wrapping (Decorator), it doesn't mint huge numbers of fine-grained shareable objects (Flyweight), and it initializes its expensive resources eagerly and once rather than needing controlled/lazy access (Proxy). A good pattern vocabulary isn't about using all of them — it's about recognising *which* structural problem you actually have, so you reach for the one pattern (or informal echo of one) that actually fits, exactly as Tazama's codebase does here.

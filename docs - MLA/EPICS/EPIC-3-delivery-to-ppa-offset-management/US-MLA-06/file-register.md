# US-MLA-06 — File Register

Shared integration files (`ingestion-consumer.service.ts`, `src/index.ts`'s wiring, the `PpaConfig` fields both stories read) are listed once, at the epic level — `EPICS/EPIC-3-delivery-to-ppa-offset-management/file-register.md` — rather than repeated here.

| File | Why it was added / what it does |
| --- | --- |
| `src/interfaces/ppa.interface.ts` | The `PpaClient` port and its `PpaDeliveryResult` union — `success`/`client-error`/`server-error`/`tls-handshake-failure`/`network-error`/`timeout`, an already-classified outcome rather than a raw HTTP status/error, the same shape every other port in this codebase takes. |
| `src/clients/ppa.client.ts` | `HttpsPpaClient` — the port's only implementation. Certs and `baseUrl` read/parsed once at construction; addresses PPA via one stable host/port, never a replica address. `deliver` races an `AbortController`-driven `setTimeout` against the whole call (headers and body drain both) for the per-call timeout, and classifies the raw transport/HTTP outcome without any `new Promise` of its own. |
| `src/services/ppa-routing.service.ts` | `resolvePpaEndpoint` — a pure, exhaustive `Record<EventType, string>` routing table (D4): `QUOTE`→`/QUOTES`, `FXQUOTE`→`/FXQUOTES`, `TRANSFER`→`/TRANSFERS`, `FXTRANSFER`→`/FXTRANSFERS`. Both legs of a routing pair share one endpoint, distinguished by `msgType` inside the envelope, never by URL or method. |
| `__tests__/ppa.client.test.ts` | 18 tests: routing by `eventType`, one stable host/port never re-derived per call, every classified outcome (200/4xx/5xx/an unexpected status defensively folded to `server-error`), TCP-never-connects vs. TCP-connects-then-resets (the two rejected TLS-handshake designs pinned as regression cases), and four timeout-specific cases (never fires on a fast success or ordinary transport error, classified correctly whether or not TCP had connected first). |
| `__tests__/ppa-routing.service.test.ts` | 4 tests — one per `EventType`, exhaustive over the closed union. |

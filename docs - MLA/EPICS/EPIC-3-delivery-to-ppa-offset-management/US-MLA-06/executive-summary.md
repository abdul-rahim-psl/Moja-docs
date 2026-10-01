# US-MLA-06 — Deliver Envelopes to PPA via Per-Action Endpoints: Executive Summary

**Epic:** EPIC-3 — MLA: Delivery to PPA & Offset Management
**Status:** complete — exit criterion met live, recorded in `plan.md` §16
**Date:** 2026-09-07

---

## What this story set out to achieve

The offset-gated handoff that makes MLA's own durability guarantee real: route each envelope to the correct PPA endpoint by `eventType`, send it over mutual TLS to a single stable service name, bound the wait with a per-call timeout configured independently of any retry budget, and — the load-bearing change every phase before this one had deferred, honestly, for lack of anything to gate on — commit the Kafka offset only once PPA confirms receipt with HTTP 200. Every phase before this one advanced the offset unconditionally, `ingestion-consumer.service.ts`'s own module comment said so plainly; this story is what replaces that unconditional advance with the real rule.

## The reasoning behind the decisions that were not obvious

**The TLS-handshake classification went through two wrong designs before landing on the right one, and each was ruled out by a live run, not by inspection.** A text/code heuristic matching known TLS/OpenSSL error patterns missed the real case entirely — a rejected client cert against `ppa-stub`'s real `rejectUnauthorized: true` server surfaces to Node as a bare `ECONNRESET`/"socket hang up" with no TLS-specific wording anywhere. A second attempt, classifying on whether `'secureConnect'` fired before the error, was also live-disproven: Node's TLS server completes the cryptographic handshake (firing `'secureConnect'` client-side) and only *then* checks `rejectUnauthorized`, resetting the socket immediately after if unauthorized — so `'secureConnect'` firing is not proof the certificate was ever accepted. The shipped signal — whether TCP ever connected at all, tracked directly via the socket's own `'connect'` event — is the one genuinely reliable distinction available, and `ppa.client.ts`'s own comment on `classifyTransportError` keeps both wrong designs' reasoning on record so a future session does not rediscover the same dead end.

**The per-call timeout uses `AbortController` plus a real `setTimeout`, not a `Promise.race` against a timer promise** — this repo's own standing rule against `new Promise` inside `HttpsPpaClient` (already established for the response/error race) extends cleanly to the timeout: the timer's own firing is tracked directly (`stage.timedOut`), the same "track the signal, don't parse the error" discipline `classifyTransportError` already uses for TLS-handshake detection, so a genuine timeout is never misclassified as an ordinary network error even when both ultimately surface as the same kind of abort-driven `'error'` event.

**Building this story's own "offset advances only on HTTP 200" honestly required admitting, in writing, that it could not be the *whole* rule until US-MLA-07 existed alongside it.** Mid-build, every non-success outcome paused the partition uniformly — deliberately, and stated as a real, temporary gap in both `plan.md` and the code's own module comment, not smoothed over — because a 4xx pausing forever and a transient failure never re-probing were each honestly worse than not having built the gate at all if left unstated. The two stories closed together, in the same set of sessions, for exactly this reason: this story's own claim only became fully true once US-MLA-07's retry/breaker/reprobe mechanism replaced that interim uniform pause.

## What was proven live, versus assumed

Every classified outcome (`success`/`client-error`/`server-error`/`tls-handshake-failure`/`network-error`/`timeout`) was produced against a real, running `ppa-stub` over real mTLS, not asserted from the design — including the genuinely rejected client cert that found the TLS-handshake defect above, and `ppa-stub` set to hang forever, which produced real HTTPS requests landing ~2000ms apart, confirming the configured budget is enforced per call. The offset gate itself was proven two ways: a full MLA restart against a still-paused partition redelivered the exact same parked offset (before US-MLA-07's reprobe mechanism existed), and — once it did — the same recovery happened with no restart at all. Full numbers and exact log lines: `plan.md` §16's own US-MLA-06 entry.

## What was deliberately left out

Nothing within this story's own acceptance criteria. The retry burst, the 4xx-advance exception, and the circuit breaker/reprobe cycle are US-MLA-07's own scope, documented there — this story's job stops at "route, send, time out, and gate the commit on the raw response," and it does exactly that.

## What this exposed that outlives it

**A defensive classification branch earns its place by being reached, not by looking plausible on paper.** `classifyHttpStatus`'s "anything that is neither 200 nor 4xx/5xx" fallback and `classifyTransportError`'s eventual TCP-connected signal both exist because two earlier, reasonable-looking designs were tried and found wrong only once run against a real server — the general lesson `engineering-rules.md` §11 states as a rule ("a design is a hypothesis until it has been run") had its clearest concrete instance yet in this story.

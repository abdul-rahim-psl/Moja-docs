# US-PII-02 — Tokenization Construction and Secret Handling: Executive Summary

**Epic:** EPIC-PII — PII Tokenization
**Status:** mechanism built, tested, and live-verified — **not formally closed**, for the same reason as US-PII-01: the CCH fail-mode decision this story's own readiness-gating behaviour feeds into is still open. See "What is deliberately not closed, and why" below.
**Date:** 2026-09-04

---

## What this story set out to achieve

Compute tokens locally, inside MLA's own process, using a secret MLA holds — never a per-event call to a separate signing service — and make sure the mechanism fails safely: a keyed construction that cannot be reversed by guessing, a secret that is loaded once and never silently missing, and a readiness signal that tells the truth about whether protection is actually in place.

## The reasoning behind the decisions that were not obvious

**The lookup result is computed once, at construction, and held as a single discriminated value — not two separate optional fields resolved on every call.** The first implementation shape (`secret: Buffer | undefined`, `loadError: string | undefined`) needed a defensive fallback to satisfy the type checker for a state — both unset — that the constructor's own control flow can never actually produce. Storing the already-resolved `PiiSecretLookupResult` directly removed the branch by construction rather than writing a test to force an unreachable case; `getSecret()` became a trivial getter with nothing left to get wrong.

**The secret store deliberately does not watch its file for changes, unlike the public-key store it otherwise mirrors.** US-MLA-05's "must not require a restart" is a JWS-specific acceptance criterion with no counterpart here — US-PII-02's own AC asks only for "loaded once, when the service starts." Rotation strategy (versioning old and new keys, or draining in-flight correlation first) is explicitly undecided (`plan.md` §7.1 #2); building hot-reload for a single active secret ahead of that decision would silently pick "no overlap window at all" as the rotation shape without anyone having decided it. A restart is the honest, decision-neutral way to rotate until CCH answers — not a limitation to fix later, a deliberate refusal to guess.

**Readiness reads `engineering-rules.md` §8 as the specific rule for this exact case, not §6.1's general Fatal-failure example table.** §6.1's illustrative list names "secret missing at startup" under "refuse to start" — but §8 states, in its own right, "if a secret fails to load, the service does not report ready," which is exactly what US-PII-02's AC and `core-knowledge.md` §4.2 ask for. Read as a specific-over-general resolution, not a conflict quietly picked one way: the general Fatal-example table is illustrative, and the PII story's own detailed AC is what actually governs this case.

**No key-version tag on the token prefix.** `plan.md` §7.1 #2 recommends versioned keys as the shape rotation *should* eventually take — but building that machinery now, before CCH has decided rotation is even needed in that shape, would be exactly the "anything 'in case we need it later'" `engineering-rules.md` §4 rules out. The prefix is a simple, fixed `tkn_` today; adding a version segment later is a small, additive change to one function, not a redesign.

## What was proven live, versus assumed

With the secret file removed and a genuinely running MLA instance restarted, `/health/ready` returned `{"status":"DOWN","kafka":"UP","piiSecret":"DOWN"}` — Kafka staying `UP` while overall status still went `DOWN` is what proves the two readiness signals gate independently rather than one coincidentally masking the other. Restoring the file and restarting returned `piiSecret:"UP"`. Determinism — the same secret, the same input, the same token — was proven across two fully independent process runs (via `tools/verify-tokenization`), not merely within one Jest process where a shared in-memory secret could hide a bug that only shows up on a genuine restart.

## What is deliberately not closed, and why

**The fail-mode decision (tracked once, in US-PII-01's own `plan.md` §16 entry, not duplicated here) is what stops this story closing too** — this story's readiness/secret-handling mechanism is complete on its own terms, but "complete" for the epic requires CCH's answer regardless of which story's code the final wiring touches.

Three further items are explicitly *not* blocking this story's own completion once the fail-mode answer lands (`plan.md` §7.1 #2–#4, filed under §13.2, "gates production, not the work ahead" — a different, lower-stakes category than the fail-mode item):

- **Secret rotation strategy** — recommended (versioned keys) but not built; no rotation mechanism exists today beyond "restart with a new file."
- **What "protected" must mean legally** — the mechanism as built is a keyed hash, one-way by construction: it verifies a candidate value matches, it does not let anyone, even holding the secret, recover an original value from a token. If CCH Legal needs genuine reversibility for an authorized lookup, that is separate, unbuilt infrastructure (a secure token→value store, or a different primitive entirely), not a property already present. Flagged this precisely, rather than left implicit, because the two are easy to conflate.
- **Named ownership of the production secret** — recommended to follow whoever already owns the JWS certificate material (the same operational shape: mounted, rotated on a schedule, gates readiness on load failure), not yet confirmed by CCH.

## What this exposed that outlives it

**A ternary's defensive `: String(err)` branch, for the case where `node:fs` throws something other than a genuine `Error`, cannot be forced through this project's own Jest/ts-jest setup without contortions that don't actually work.** Both `jest.spyOn` on the `node:fs` namespace object and a `jest.mock('node:fs', ...)` factory were tried; the first throws `Cannot redefine property` (Node's built-in module exports resist redefinition in this module-registry configuration) and the second silently fails to attribute coverage to the exercised line even though the test's own assertion proves the code path ran correctly, under both the v8 and babel coverage providers. This is the same accepted, already-documented gap `public-key-store.client.ts`'s identical ternary already carries from Phase 3 — worth recording here as a now-confirmed, reproducible tooling limitation of this repository's test setup, not a one-off shrug.

# US-PII-02 — Tokenization Construction and Secret Handling: Executive Summary

**Epic:** EPIC-PII — PII Tokenization
**Status:** **formally closed [2026-09-22]**, as part of EPIC-PII's closure. Mechanism built, tested, and live-verified. Both gating decisions this story's own behaviour feeds into are resolved — fail-mode (gate item #1, resolved [2026-09-04]) and secret rotation (gate item #2, resolved [2026-09-18], spec confirmed [2026-09-22] — no rotation, a long-lived key). See "What was deliberately not closed, and how it resolved" below for how each resolved.
**Date:** 2026-09-04, closed 2026-09-22

---

## What this story set out to achieve

Compute tokens locally, inside MLA's own process, using a secret MLA holds — never a per-event call to a separate signing service — and make sure the mechanism fails safely: a keyed construction that cannot be reversed by guessing, a secret that is loaded once and never silently missing, and a readiness signal that tells the truth about whether protection is actually in place.

## The reasoning behind the decisions that were not obvious

**The lookup result is computed once, at construction, and held as a single discriminated value — not two separate optional fields resolved on every call.** The first implementation shape (`secret: Buffer | undefined`, `loadError: string | undefined`) needed a defensive fallback to satisfy the type checker for a state — both unset — that the constructor's own control flow can never actually produce. Storing the already-resolved `PiiSecretLookupResult` directly removed the branch by construction rather than writing a test to force an unreachable case; `getSecret()` became a trivial getter with nothing left to get wrong.

**The secret store deliberately does not watch its file for changes, unlike the public-key store it otherwise mirrors.** US-MLA-05's "must not require a restart" is a JWS-specific acceptance criterion with no counterpart here — US-PII-02's own AC asks only for "loaded once, when the service starts." This was built while rotation strategy was still undecided (`plan.md` §7.1 #2) — hot-reload for a single active secret would have silently picked "no overlap window at all" as the rotation shape without anyone having decided it, so a restart was the honest, decision-neutral default. **COMESA has since confirmed [2026-09-18], spec confirmed [2026-09-22], that the secret does not rotate at all** (`docs/docs - MLA/meetings and emails/tokenization-feedback.md`; `plan.md` §16's "gate item #2 reversed" entry) — rotating it would break Tazama's own fraud-rule matching across transaction history. This design turns out to be exactly right for that answer, not merely a safe default pending one: no hot-reload is needed, ever, and a restart is not a rotation mechanism the codebase now owes anyone.

**Readiness reads `engineering-rules.md` §8 as the specific rule for this exact case, not §6.1's general Fatal-failure example table.** §6.1's illustrative list names "secret missing at startup" under "refuse to start" — but §8 states, in its own right, "if a secret fails to load, the service does not report ready," which is exactly what US-PII-02's AC and `core-knowledge.md` §4.2 ask for. Read as a specific-over-general resolution, not a conflict quietly picked one way: the general Fatal-example table is illustrative, and the PII story's own detailed AC is what actually governs this case.

**No key-version tag on the token prefix.** This was written when versioned keys looked like the eventual shape rotation would take (`plan.md` §7.1 #2's original recommendation) — building that machinery ahead of CCH's decision would have been exactly the "anything 'in case we need it later'" `engineering-rules.md` §4 rules out. **COMESA has since confirmed there is no rotation at all**, so no version tag is needed, now or later; the prefix stays the simple, fixed `tkn_` it already is.

## What was proven live, versus assumed

With the secret file removed and a genuinely running MLA instance restarted, `/health/ready` returned `{"status":"DOWN","kafka":"UP","piiSecret":"DOWN"}` — Kafka staying `UP` while overall status still went `DOWN` is what proves the two readiness signals gate independently rather than one coincidentally masking the other. Restoring the file and restarting returned `piiSecret:"UP"`. Determinism — the same secret, the same input, the same token — was proven across two fully independent process runs (via `tools/verify-tokenization`), not merely within one Jest process where a shared in-memory secret could hide a bug that only shows up on a genuine restart.

## What was deliberately not closed, and how it resolved

**The fail-mode decision (tracked once, in US-PII-01's own `plan.md` §16 entry, not duplicated here) was what stopped this story closing too** — this story's readiness/secret-handling mechanism was complete on its own terms, but "complete" for the epic required CCH's answer regardless of which story's code the final wiring touched. That answer landed [2026-09-04] and the epic closed [2026-09-22] once the second gating decision (rotation, below) also resolved.

Three further items were filed under `plan.md` §7.1 #2–#4 / §13.2, "gates production, not the work ahead" — a different, lower-stakes category than the fail-mode item, and explicitly *not* blocking this story's own completion once the fail-mode answer landed. One of the three (rotation) turned out to gate the epic's formal closure too, once fail-mode was answered; the other two never did, and remain open against go-live only:

- ~~Secret rotation strategy~~ **Resolved [2026-09-18], spec confirmed [2026-09-22]: no rotation, a long-lived key** (`docs/docs - MLA/meetings and emails/tokenization-feedback.md`; `plan.md` §16's "gate item #2 reversed" entry). No rotation mechanism is needed — `FilePiiSecretClient`'s existing "restart to change" design already matches the requirement exactly.
- **What "protected" must mean legally** — the mechanism as built is a keyed hash, one-way by construction: it verifies a candidate value matches, it does not let anyone, even holding the secret, recover an original value from a token. If CCH Legal needs genuine reversibility for an authorized lookup, that is separate, unbuilt infrastructure (a secure token→value store, or a different primitive entirely), not a property already present. Flagged this precisely, rather than left implicit, because the two are easy to conflate. Still open.
- **Named ownership of the production secret** — recommended to follow whoever already owns the JWS certificate material (the same operational shape: mounted, gates readiness on load failure — though, per the rotation resolution above, never rotated on a schedule), not yet confirmed by CCH. Still open.

## What this exposed that outlives it

**A ternary's defensive `: String(err)` branch, for the case where `node:fs` throws something other than a genuine `Error`, cannot be forced through this project's own Jest/ts-jest setup without contortions that don't actually work.** Both `jest.spyOn` on the `node:fs` namespace object and a `jest.mock('node:fs', ...)` factory were tried; the first throws `Cannot redefine property` (Node's built-in module exports resist redefinition in this module-registry configuration) and the second silently fails to attribute coverage to the exercised line even though the test's own assertion proves the code path ran correctly, under both the v8 and babel coverage providers. This is the same accepted, already-documented gap `public-key-store.client.ts`'s identical ternary already carries from Phase 3 — worth recording here as a now-confirmed, reproducible tooling limitation of this repository's test setup, not a one-off shrug.

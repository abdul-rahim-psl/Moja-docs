# US-MLA-05 — Validate JWS Signatures on DFSP-Originated Events: Executive Summary

**Epic:** EPIC-2 — Envelope Construction & JWS Validation
**Status:** complete — exit criterion met live, recorded in `plan.md` §16
**Date:** 2026-09-03

---

## What this story set out to achieve

Real cryptographic verification of the `FSPIOP-Signature` header, on every event type with no exemption — including the TRANSFER fulfil/final-state leg, which the FSD's own dead notification-dedup design used to treat as switch-generated and therefore exempt. No POC code existed to port: the POC only ever checked header *presence*, never performed a real signature check, so this was genuinely new work rather than an adaptation. The story also had to answer a question no prior phase needed to: where does MLA get a DFSP's public key from, and how does an outage in that key source stay distinguishable from a genuine forged or tampered event — the failure mode the story's own acceptance criteria name directly.

## The reasoning behind the decisions that were not obvious

**No JWS/JOSE library was added.** Node's built-in `crypto.verify` covers RS256/384/512 directly; a dedicated library would trade a dependency for RFC 7515 compact-serialization handling this codebase doesn't need, because the real wire shape — confirmed against all 286 signed records in `raw_export_500.json` — is not a three-part compact JWS string at all. It's Mojaloop's own two-field JSON form, `{signature, protectedHeader}`, both RFC 4648 §5 base64url. The signing input this story reconstructs is the standard one (`base64url(protectedHeader) + "." + base64url(payload)`); only its delivery shape differs from a textbook JWS.

**Verification runs against `selectPayload`'s output (the same `body` the envelope carries), never against `content.payload`.** For quote-family records, `content.payload` is Mojaloop's own internal ISO 20022 transform of the request — a different shape than what the DFSP actually sent. Verifying against the wrong shape would fail every genuine signature, silently, for a reason that has nothing to do with the signature itself. This also means JWS validation and envelope construction now share one upstream input rather than each independently re-deriving "what is the body," which is exactly the kind of coupling `engineering-rules.md` §4 asks to keep, not decouple.

**The public-key store is a class with a lifecycle, the one deliberate exception to this codebase's "prefer pure functions" default.** `FilePublicKeyStoreClient` holds a directory watch and an in-memory cache — a real client, not a pure function, because "adding a DFSP key must not require a restart" is a hot-reload requirement with no honest pure-function shape. A broken store keeps serving `unavailable` for every DFSP rather than silently falling back to its last-known-good keys, because a stale key set masquerading as healthy is worse than an honest outage signal.

**A key-source outage had to be provably distinguishable from a genuine signature failure, not just designed to be.** The three-outcome `PublicKeyLookupResult` (`found`/`not-found`/`unavailable`) exists specifically so this story's own named failure mode — an outage silently reading as "every event has an invalid signature" — cannot happen by construction, and this was proven live, not only unit-tested: restarting MLA with `JWS_PUBLIC_KEY_DIR` pointed at a nonexistent directory made a record that would otherwise have verified fail as `key-source-unavailable`, never as `invalid-signature`.

**The tooling this story needed did not exist and had no precedent to port, so it was built as product, not a scratch script.** `tools/dfsp-keys` and `capture-feeder`'s `--resign`/`--tamper-body` are checked-in, documented mechanisms — following `environment-simulation.md` §3's own convention that harness tooling is reused for the life of the project, not thrown away after one verification run.

## What was proven live, versus assumed

Real cryptographic verification against a real, generated RSA keypair — not a fake, not a mock. Beyond US-MLA-04's shared exit-criterion run: (1) a locally re-signed record verified; (2) the same record with `--tamper-body` added failed as `invalid-signature`, confirmed unambiguously via an isolated script (the live run's aggregate log cannot cleanly distinguish "deliberately tampered" from "coincidentally the wrong key" when several real records share a registered test key — both are correctly the same failure class, which is itself the point, but it means only the isolated check isolates the *specific* tampered record cleanly); (3) `--strip-signature` failed as the distinctly-worded `missing-signature`; (4) a simulated key-store outage produced `key-source-unavailable` for every signed record, including one that would otherwise have verified, never conflated with an invalid signature.

## What was deliberately left out

**Genuine verification against a real COMESA/DFSP signature stays blocked**, and this is stated plainly rather than implied covered: no real DFSP private key is available, so every one of the 15 real signed records in the live run's baseline correctly failed as `invalid-signature` — proof the mechanism rejects what it cannot verify, not proof it can verify a real signature. The byte-exactness question this phase's own handoff named as its first trap is checked, not fully closed — see the story's own module comment and the `plan.md` §16 entry's "Left open" for exactly what was and was not established. Where the security alert actually routes is undecided (US-MON-01, R-37) — met here by a `SECURITY`-marked structured log, not a wired alert.

## What this exposed that outlives it

**A capture pipeline that only ever stores a parsed-then-restringified body cannot, by itself, prove or disprove byte-exact signature fidelity against a real signer — it can only fail to disprove it for the one record actually checked.** `value.rawPayload` decoding to a string identical to `JSON.stringify(value.payload)` for the sampled record shows the audit pipeline never held independent raw bytes — but that is a fact about *this codebase's own capture*, not a fact about whether a real DFSP's original request would restringify identically. The two are easy to conflate, and keeping them separate in the write-up (rather than letting a clean self-consistency check read as more than it is) is what makes the COMESA question in `plan.md` §14 Q1 an honest one to ask rather than a formality.

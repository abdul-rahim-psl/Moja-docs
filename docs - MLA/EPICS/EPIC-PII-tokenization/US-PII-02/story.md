# US-PII-02 — Tokenization Construction and Secret Handling

**Epic:** PII Tokenization (implemented as part of MLA's own processing pipeline — not a separately deployed component)
**Source:** `docs/user stories/cch-pii-user-stories.md`

---

## Fields to Tokenize

*(Shared reference table from the source document, applicable to both US-PII-01 and US-PII-02.)*

| Field | Source Message | Location | Tokenize? | Notes |
| --- | --- | --- | --- | --- |
| Payer MSISDN | Quote request | `payer.partyIdInfo.partyIdentifier` | **Yes** | Plain JSON body, no ILP packet on this message |
| Payee MSISDN | Quote request | `payee.partyIdInfo.partyIdentifier` | **Yes** | |
| Payer legal name | Quote request | `personalInfo.complexName` | **Yes** | |
| Payer MSISDN | FXQuote request/callback | equivalent `partyIdInfo` field | **Yes** | Where present |
| Payee MSISDN | FXQuote request/callback | equivalent `partyIdInfo` field | **Yes** | Where present |
| Payer MSISDN | Transfer prepare (decoded ILP packet) | inside the ILP packet | **No — exempt** | Cryptographically bound into `condition`; rewriting breaks the transfer |
| Payee MSISDN | Transfer prepare (decoded ILP packet) | inside the ILP packet | **No — exempt** | Same reason |
| Payer display name | Transfer prepare (decoded ILP packet) | inside the ILP packet | **No — exempt** | Same reason |
| Transaction amount (all stages) | Quote, FXQuote, Transfer, FXTransfer | e.g. `amount`, `IntrBkSttlmAmt` | **No** | Must stay clear for Tazama's threshold/velocity rules |

## Description

Tokenization is computed locally, inside MLA's own process, using a secret MLA holds — not by calling out to a separate vault or crypto service per event. This keeps the design to "one already-deployed service does a bit more work," rather than introducing a new network-reachable service into the Mojoloop environment.

## Acceptance Criteria

- Each tokenized value is produced by combining the field's real value with a secret key, using a keyed hashing method — a plain hash with no key is not acceptable, since MSISDNs are a small enough space to guess and match against an unkeyed hash.
- Every token is marked with a recognizable prefix, so that downstream logging, storage, and tooling can tell a tokenized value apart from a real one at a glance.
- The secret is loaded once, when the service starts, from a securely mounted location — not fetched over the network for every event, and not requested from a separate live signing service per event.
- Tokenization must happen only **after** the DFSP's signature on the original event has already been checked. Validating a signature against an already-tokenized payload will fail every time, since the DFSP signed the event as it was originally sent — this ordering is a hard requirement, not a preference.
- Readiness reflects whether the secret loaded successfully at startup — consistent with the instance-local-only readiness scoping already established for PPA (US-MON-02, in `cch-crosscutting-user-stories.md`). If the secret didn't load, the service should not report ready, rather than silently running unprotected.

## Method

1. **Compute token** — for each field handed off from US-PII-01's tokenize step (which only runs after signature validation has already passed), combine it with the secret using the keyed hashing method above, and apply the recognizable prefix.

From here, the now-tokenized body moves on to envelope construction and dispatch to PPA — out of scope for this story.

## Assumptions

- The secret used for tokenization is held in a securely managed, rotatable store — a mounted Kubernetes Secret or equivalent is sufficient; nothing here requires standing up a new, separately-deployed secrets service.
- Changing the secret changes every token produced afterward for the same input. Anything already correlated under the old secret (in-flight cached state, parked entries awaiting a late-arriving event) will no longer match new tokens once the secret changes. How rotation should be handled — versioning old and new tokens, or treating a rotation as an event that requires draining in-flight correlation first — is not yet decided.
- Whether "protected" here needs to mean someone can look the original value back up when authorized, or simply that the value can't be reversed without also holding the secret, is not yet decided. This affects data-protection/legal sign-off and should be confirmed with CCH Legal before this is considered final.
- Ownership of the secret itself — who holds it, who can rotate it, and on what schedule — has not yet been assigned to a named team.

## Todos

1. **Wire up secret provisioning** — where the secret is mounted, how it's loaded at startup, and what happens if it's missing (the service should refuse to start rather than run unprotected).
2. **Write a test** (Jest, 95% coverage target) confirming every token carries its marker and is verifiably produced by the keyed method (not a bare hash).
3. **Decide and document the key rotation approach** before a rotation schedule is set.
4. **Get CCH Legal's decision** on what "protected" needs to mean for this data (reversible-by-lookup vs. reversible-only-with-the-secret).
5. **Assign named ownership** of the secret and its rotation policy.
6. **Wire secret-load status into the service's own readiness endpoint**, following US-MON-02's instance-local readiness pattern.

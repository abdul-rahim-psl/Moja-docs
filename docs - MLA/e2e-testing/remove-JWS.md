<!-- SPDX-License-Identifier: Apache-2.0 -->

# Removing JWS Validation from MLA — End-to-End Plan

**Status:** proposal, not yet actioned. No code changed as of this document's own date [2026-09-22].

**Purpose:** a complete plan for removing DFSP JWS signature validation from MLA — every code path, config
key, metric, health input, test, and governing document it touches — while leaving the business flow
(classification, decoding, tokenization, envelope construction, delivery, offset discipline) bit-for-bit
unchanged.

---

## 1. Why this is on the table

Mutale put the trust-boundary question to Michael (Mojaloop Foundation) directly. His reply, verbatim:

> "Nothing will get on to the Kafka topic unless it has already been validated by the switch, and the Kafka
> topic is in the same system boundary as the validation process. I'm not sure what would be gained by
> PaySys performing another validation. What kind of use case are they planning to guard against?"

Two things follow, and they are the whole basis for this plan:

1. **Every record on `topic-event-audit` has already had its signature validated by the switch.** MLA's
   `verifyJws` is therefore a second validation of something already validated, not a first line of defence.
2. **The audit topic sits inside the same trust boundary as the switch's own validation.** In production
   MLA's consumer process and that boundary are the same boundary — so the "different trust zone" argument
   for keeping a local re-validation does not apply.

**What Michael's reply does not do**, and what this plan must not pretend it does: it does not itself
authorize the removal, and it asks a question back — what failure mode the re-validation is meant to catch.
`plan.md` §16's [2026-09-21] entry records this carefully and it still stands. This document is the
engineering answer to "if we do remove it, how?" — see §9 for the decision that is not engineering's.

### 1.1 The one argument that survives, stated honestly

Signature verification is **tamper-evidence for the single hop between the switch writing to Kafka and MLA
reading from it**. Trust-boundary confirmation rules out a *foreign* producer; it does not by itself rule out
a corrupted or truncated record on that hop. That is the only candidate answer to Michael's question that
survives, and it is narrow:

- Kafka already has its own CRC32C integrity check per record batch, which catches corruption in transit and
  at rest. A record that fails it is never delivered to a consumer at all.
- So the residual risk JWS uniquely covers is a **semantically valid but content-altered** record produced
  inside the trust boundary — i.e. an attacker or bug with write access to the topic itself, which is the
  exact scenario Michael's boundary statement addresses.

**Assessment:** the tamper-evidence argument is real but thin, and it is not the argument that was put to
Michael. It has not been rejected — it has not been asked. §9 records this as a live choice.

### 1.2 What removal actually buys

This is not a cosmetic cleanup. Removing JWS resolves or dissolves four separate open items:

| Item | Where it is tracked | What removal does to it |
| --- | --- | --- |
| **DFSP public-key sourcing / MCM integration** | `core-knowledge.md` §13.3, `questions for comesa.md` Q1, `plan.md` §13.1 | **Dissolved.** MLA needs no DFSP public keys at all, so how it sources them stops being a question. This is the single largest open item this removal closes. |
| **F-14 mTLS/key rotation mechanism (JWS half)** | `bugs/qa-review-findings.md` | Partly dissolved — the DFSP-key rotation half goes away; the MLA↔PPA mTLS half is untouched. |
| **F-05's noted PII/JWS reprobe gap** | `bugs/qa-review-findings.md` F-05 | Halved — the JWS half of the "tripped breaker changes no reprobe behaviour" shape goes away. |
| **`JWS_*`/`PPA_*` session-timeout budget coupling** | `config.service.ts` (`validateRetryBudgets`) | Relaxed — one of the two competing retry bursts disappears, giving the PPA burst more headroom under `KAFKA_SESSION_TIMEOUT_MS`. |

It also removes a standing operational hazard: `JWS_VALIDATION_DISABLED` currently exists as a
testing-only bypass that George's 15-Sept email proposed making permanent. Removing validation outright is
**more honest than leaving a permanently-on bypass flag**, which is the worst of both worlds — the code, the
config surface, and the key-distribution problem all still there, just switched off.

---

## 2. The governing constraint this plan must confront

`engineering-rules.md` treats DFSP signature verification as load-bearing in two places. Neither can be
quietly deleted:

**N3 (non-negotiable):** "Validate the JWS signature before mutating the payload. Tokenization, decoding into
new structures, or any field rewrite that precedes validation is a defect. **This ordering is enforced by a
test that fails if the steps are reordered.**"

**§10.2 (testing standard):** requires "a test that fails if tokenization is moved ahead of signature
validation."

Removing JWS makes both **vacuous rather than violated** — there is no longer an ordering to preserve,
because one of the two ordered steps is gone. That distinction matters for how the documents change:

- N3 is not "relaxed" or "waived." It is **retired with its rationale recorded**, because the precondition it
  protects (a signature computed over untokenized bytes) no longer exists in the pipeline.
- The ordering test is **deleted, not skipped or weakened.** A skipped test is a lie about coverage; a
  deleted test with a `plan.md` §16 entry explaining why is an accurate record.

**This is a policy change to a binding rules document, and it is the reason this plan needs sign-off beyond
engineering** (§9). The code change is mechanical; amending a non-negotiable is not.

---

## 3. What must not change

The removal is a **subtraction with no behavioural substitution**. Everything below stays exactly as it is,
and the verification in §7 exists specifically to prove it:

- **Classification** — the four `eventType` values and the `start`/`egress` filter (`ingestion.service.ts`).
- **Base64 decoding** of transfer bodies.
- **PII tokenization** — the same fields, the same keyed-hash construction, the same **fail-closed**
  behaviour on a missing secret. Tokenization keeps its own park/retry/breaker domain.
- **Envelope construction and schema validation** — the `EventEnvelope` contract is unchanged. **No envelope
  field is added or removed**; MLA never carried a "signature verified" field, so PPA sees byte-identical
  envelopes.
- **Delivery, offset discipline, retry/breaker/reprobe for PPA** — untouched. Offset still commits only on
  PPA HTTP 200.
- **The `PPA_MTLS_DISABLED` bypass** — a genuinely independent concern (transport auth on the MLA→PPA hop,
  not signature verification on the DRPP→MLA hop). It is **not** part of this removal and must not be
  bundled into it.

**Critically: PPA needs no change whatsoever.** The envelope contract does not mention JWS. This is an
MLA-internal removal, which is why the blast radius is bounded.

---

## 4. Code inventory — every JWS touchpoint

Established by direct inspection of `cch-mla` on branch `paysys-E2E-testing`. 14 source files, 11 test files.

### 4.1 Files deleted outright

| File | Note |
| --- | --- |
| `src/services/jws-verification.service.ts` | The verifier itself (`verifyJws`, bound-claim checks, `crypto.verify`). |
| `src/clients/public-key-store.client.ts` | `FilePublicKeyStoreClient` — directory watch, debounced reload, PEM validation. |
| `src/interfaces/jws.interface.ts` | `PublicKeyStore` port, `FspiopSignatureHeader`, `ProtectedHeader`, `JwsAlgorithm`. |
| `__tests__/jws-verification.service.test.ts` | 21 tests, including F-04's bound-claims block. |

### 4.2 Files edited — surgical subtraction

| File | Change |
| --- | --- |
| `src/services/envelope-pipeline.service.ts` | Delete the `verifyJws` block (lines ~48–61), the `keyStore`/`jwsValidationDisabled` deps, and three `EnvelopeSkipReason` members: `missing-signature`, `invalid-signature`, `key-source-unavailable`. Delete the file-head comment about tokenization ordering. |
| `src/services/ingestion-consumer.service.ts` | Delete `jwsDomain`, the `keyStore`/`jwsRetry`/`jwsBreaker`/`jwsValidationDisabled` deps, and the `isDomainUnavailable(outcome, jwsDomain.reason)` branch in `attemptAndRecord`. `domains` becomes `[piiDomain]`. |
| `src/services/config.service.ts` | Delete `loadJws` and the whole `jws` config block; delete the `jwsBurstMaxMs` computation and its `KAFKA_SESSION_TIMEOUT_MS` check (the PII+PPA check stays). |
| `src/interfaces/config.interface.ts` | Delete the `jws` section of `Configuration`. |
| `src/services/health.service.ts` | Delete the `jwsKeyStore` readiness input and its `'DOWN'` term. **Readiness becomes Kafka + PII secret only.** |
| `src/interfaces/health.interface.ts` | Delete `JwsKeyStoreReadiness`. |
| `src/clients/metrics.client.ts` + `src/interfaces/metrics.interface.ts` | Delete four metrics: `mla_key_store_unavailable_total`, `mla_jws_breaker_state`, `mla_jws_validation_bypassed`, and their setters (`incrementKeyStoreUnavailable`, `setJwsBreakerState`, `setJwsValidationBypassed`). **Keep `setPpaMtlsBypassed`** — independent concern. |
| `src/services/ingestion-outcome-logging.service.ts` | Delete log/alert branches for the three removed skip reasons. |
| `src/services/park-registry.service.ts` | `ParkKind` becomes `'pii' \| 'ppa'`. |
| `src/index.ts` | Delete key-store construction, its `close()` in shutdown, the JWS breaker, the boot WARN for the bypass, and the readiness wiring. |
| `src/clients/alert.client.ts` | Delete `raiseKeyStoreUnavailableAlert`. |

### 4.3 The `alert`/`metrics` question worth deciding deliberately

Deleting `mla_key_store_unavailable_total` and `mla_jws_breaker_state` **changes MLA's published metric
surface**, which US-MON-01 specifies (seven signals, including "breaker state at both hops"). Two of the
seven relate to the JWS hop.

**Recommendation:** delete them. A gauge permanently pinned at 0 for a mechanism that no longer exists is
worse than its absence — it invites a dashboard panel that can never fire and a reader who assumes the
protection is active. **This requires updating US-MON-01's expectations** (§6) and telling whoever owns the
Grafana dashboards, or they will show "no data" panels.

### 4.4 Configuration and deployment surface

Six env vars are deleted: `JWS_PUBLIC_KEY_DIR`, `JWS_VALIDATION_DISABLED`, `JWS_MAX_RETRIES`,
`JWS_RETRY_BASE_MS`, `JWS_CIRCUIT_BREAKER_THRESHOLD`, `JWS_REPROBE_INTERVAL_MS`, plus
`JWS_RELOAD_DEBOUNCE_MS`, `JWS_WATCH_RETRY_INTERVAL_MS`, and `JWS_ALG`.

| Artefact | Change |
| --- | --- |
| `.env.template` | Delete the `JWS_*` block. |
| `deploy/kubernetes/01-configmap.yaml` | Delete `JWS_*` keys. |
| `deploy/kubernetes/03-mla-deployment.yaml` | Delete the `cch-mla-jws-keys` **Secret volume, its mount, and the env refs**. |
| `deploy/kubernetes/README.md` | Delete the key-provisioning section. |
| **`cch-mla-jws-keys` Secret (deployed)** | **Stops being required.** Leave it in place on `10.0.150.69` until removal is confirmed working, then delete separately — do not bundle a live-cluster secret deletion into this change. |

**Deployment sequencing trap:** `JWS_PUBLIC_KEY_DIR` is currently **required with no default** — the process
fails to boot without it. After removal an unknown env var is simply ignored, so a **stale ConfigMap is
harmless and the new image boots fine against an old ConfigMap.** This makes the rollout order forgiving in
the safe direction. The reverse is not true: **rolling back to the pre-removal image against a
JWS-stripped ConfigMap will fail to boot.** Keep the old ConfigMap until rollback is no longer a
consideration (§8).

### 4.5 Tooling and fixtures — where the real subtlety is

| Tool | Change |
| --- | --- |
| `tools/capture-feeder/resign.ts` | **Keep, do not delete.** It re-signs captured records so their signatures are valid for a replayed body. MLA will stop *checking*, but the captures still legitimately carry `fspiop-signature` headers, and `--resign` keeps replayed traffic faithful to what DRPP actually produces. **Deleting it would make the harness less representative, not simpler.** |
| `tools/dfsp-keys/` (private + store PEMs) | **Keep.** Feeds `resign.ts`. |
| `tools/verify-tokenization/run.ts` | Edit — constructs `FilePublicKeyStoreClient`. Note this is type-checked only under `tools/tsconfig.json`; run `npx tsc --noEmit -p tools/tsconfig.json` explicitly (this exact file broke this way once before, per F-04's own remediation note). |
| `tools/ppa-stub` | No change. |
| `__tests__/fixtures/**` (7 captures + 500-record export) | **No change. Do not strip signature headers.** Fixtures are captured ground truth; rewriting them to remove a header DRPP really sends would corrupt the corpus for every other test and destroy the option of reinstating validation. |
| `tools/scenario-library` | Audit for JWS-specific scenarios (key-store outage, tampered signature, stripped signature). Those scenarios **must be deleted, not left passing vacuously** — a "tampered signature is rejected" scenario that now forwards the record would either fail loudly or, worse, be edited to assert the new behaviour and look like coverage. |

---

## 5. Test strategy

Roughly 400+ tests exist; 11 files touch JWS. The **coverage gate is `coverageThreshold: 96`** and it is
enforced mechanically — a partial cleanup that leaves unreachable branches will fail the build, which is
the desired safety net here.

| Category | Action |
| --- | --- |
| `jws-verification.service.test.ts` | Delete entirely. |
| **The N3 ordering test** | **Delete, with the reason recorded in `plan.md` §16.** Not skipped, not weakened — see §2. This is the single most consequential test deletion and must be called out by name in the §16 entry. |
| `envelope-pipeline.service.test.ts` | Delete cases for the three removed skip reasons. **Add one positive assertion: a record with a deliberately invalid/absent signature is now `forwarded`** — this is the new contract, and it should be asserted explicitly rather than left as an absence. |
| `ingestion-consumer.service.test.ts` | Delete JWS-park/breaker/retry cases. **Keep every PII equivalent** — they now solely carry the transient-domain machinery's coverage, so verify they genuinely exercise it rather than relying on the JWS cases having done so. |
| `health.service.test.ts` | Update readiness matrix to two inputs. Assert a broken key directory no longer affects readiness. |
| `config.service.test.ts` | Delete `JWS_*` parsing/bounds tests and the JWS burst-budget test. **Add: unknown `JWS_*` vars are ignored, not fatal** (the §4.4 rollout property). |
| `metrics.client.test.ts`, `alert.client.test.ts`, `park-registry.service.test.ts`, `park-watchdog.service.test.ts`, `kafka.client.test.ts`, `fastify.client.test.ts` | Mechanical: drop deleted metrics/alerts/`ParkKind` members. |
| **Golden-file regression** | `npm run golden:ingestion:all` — all 7 captures. Per F-04's note, golden **does not call `verifyJws`**, so **output should be byte-identical before and after.** This is the strongest single proof that §3's "nothing else changed" holds. |

---

## 6. Documentation changes

Per `CLAUDE.md`'s indexing and same-commit rules, these change **with** the code:

| Document | Change |
| --- | --- |
| **`engineering-rules.md`** | **Retire N3** with its rationale (§2). Remove §10.2's ordering-test requirement. Update §255's failure-path table (drop missing-header/invalid-signature) and §238's security-alert line. |
| **`core-knowledge.md`** | Remove JWS from MLA's pipeline/processing order and the security model. **§13.3: mark the DFSP-key-sourcing/MCM item dissolved, not resolved** — it was never answered, it stopped applying. |
| **`user stories/cch-mla-user-stories.md`** | US-MLA-05 ("Validate JWS Signatures on DFSP-Originated Events") is **removed from scope**. The source stories are the requirements authority, so this is a **requirements change and needs the story author's sign-off** (§9) — not an edit engineering makes unilaterally. |
| **`cch-pii-user-stories.md` / `core-knowledge.md` §4.1** | The **validate-before-tokenize** ordering requirement is retired. Tokenization's own fail-closed behaviour is unchanged. |
| **`cch-crosscutting-user-stories.md`** (US-MON-01) | Reduce the seven-signal spec — the JWS-hop breaker and key-store signals go (§4.3). |
| **`EPICS/EPIC-2-envelope-construction-jws-validation/`** | Contains US-MLA-05's closed story + epic docs. **Do not delete or rewrite history.** Add a note that US-MLA-05 was subsequently removed from scope, with the date and reason. Epic folder name stays — renaming it would break every existing cross-reference. |
| **`bugs/qa-review-findings.md`** | F-04 (bound claims) becomes moot — annotate, don't delete. Note F-14's JWS half and F-05's JWS half dissolved. |
| **`plan.md`** | §12 divergence register: new entry. §13.1: DFSP-keys row closed as dissolved. **§16: the progress-log entry, naming the N3 retirement and the ordering-test deletion explicitly.** |
| **`strategy.md`** | §1 orientation currently describes JWS verification as part of the live-verified pipeline — must be corrected. Register this document in §2 + §3 per the indexing rule. |
| **`deployment/MLA-deployment-kubernetes.md`** | §6's 2026-09-15 update records "JWS disable not accepted as a permanent change." Supersede it in place with the outcome. |

---

## 7. Verification plan

Ordered so the cheapest, most diagnostic checks come first. Per `engineering-rules.md` §11, none of this is
"verified" until run.

1. **`npx tsc --noEmit`** and **`npx tsc --noEmit -p tools/tsconfig.json`** (separately — §4.5).
   The compiler finds the dependency graph's loose ends faster than any test.
2. **`npm run lint`** — zero errors. Catches unused imports left by the subtraction.
3. **`npm test`** — full suite, **≥96% coverage**. An unreachable branch left behind fails the gate.
4. **`npm run golden:ingestion:all`** — **expect byte-identical output** (§5). Primary evidence of no
   behavioural drift.
5. **`npm run verify:tokenization`** against a running `ppa-stub` over real mTLS — proves tokenization and
   its fail-closed path still work with the JWS step gone.
6. **`npm run scenario:all`** — 15 scenarios, cold start, unattended, minus the deleted JWS scenarios.
7. **Boot checks:** (a) with **no** `JWS_*` vars — boots clean, `/health/ready` reports two inputs;
   (b) with **stale** `JWS_*` vars present — boots clean, ignores them (§4.4's rollout property);
   (c) with `JWS_PUBLIC_KEY_DIR` pointed at a **nonexistent** path — boots clean, unaffected.
8. **The decisive live run: a full corridor against the real PPA with signatures deliberately broken.**
   Feed the 8-record canonical corridor with `--resign` **omitted** (or signatures tampered) onto
   `10.0.150.69`'s topic. Expect **all 8 delivered and accepted with HTTP 200** — records that the current
   build would skip as `invalid-signature`. Confirm via `/metrics`: `mla_forwarded_total` 2 per event type,
   `mla_ppa_delivery_outcomes_total{outcome="success"}=8`, `mla_tokenization_failures_total=0`, and every
   fed record accounted for exactly once. This is the run that proves the removal did what it claims.
9. **Regression guard:** re-run step 8 **with** `--resign` — properly signed records must also still
   forward. Removal must be indifferent to signature presence, not newly dependent on its absence.

**Note on step 8 and PPA's own state:** 3 of the 4 message types currently fail PPA's *own* local
ISO-field validation (a pre-existing `cch-ppa` schema gap, confirmed on both the local stack and the real
remote instance [2026-09-21]). **That is expected and unrelated.** MLA's contract ends at HTTP 200; do not
read those downstream failures as a symptom of this change.

---

## 8. Sequencing and rollback

Recommended order — each step independently verifiable, worst-case blast radius kept small:

1. **Branch** off the current working branch. Do not mix with the F-11+ QA work.
2. **Documentation and sign-off first** (§9). The requirements change gates the code change, not the
   reverse — building first and seeking sign-off after is how a "reversible default" becomes a fait accompli.
3. **Code subtraction** in dependency order: pipeline → consumer → config/health/metrics/alerts →
   composition root → delete the three orphaned files.
4. **Tests** alongside each step, not after.
5. **Local verification** — §7 steps 1–7.
6. **Live verification** — §7 steps 8–9, against the real PPA.
7. **`plan.md` §16 entry + epic docs.** Leave staged for the user to commit. **Claude never commits.**
8. **Cluster rollout:** new image → confirm → *then* prune the ConfigMap → *then*, separately and later,
   delete the `cch-mla-jws-keys` Secret.

**Rollback.** Reinstating validation is `git revert` plus restoring the ConfigMap/Secret — which is exactly
why §4.5 keeps the fixtures, keys and `resign.ts` intact. Deleting those would make rollback a rebuild
rather than a revert. **The one-way door is the ConfigMap ordering in §4.4:** a pre-removal image cannot
boot without `JWS_PUBLIC_KEY_DIR`, so **do not prune the ConfigMap until rollback is off the table.**

---

## 9. What is not engineering's to decide

Per `CLAUDE.md`'s external-decisions rule, surfaced explicitly rather than built past:

| Decision | Owner | Blocks what |
| --- | --- | --- |
| **Removing US-MLA-05 from scope** | CCH / the story author | The source user stories are the requirements authority. Engineering cannot retire a story by editing code. **Blocks formally closing this work**, though not prototyping it on a branch. |
| **Retiring N3, a stated non-negotiable** | The engineering-rules owner (and CCH, as the security posture changes) | A binding rules document. Editing a non-negotiable because a code change would otherwise violate it is backwards. **Blocks closure.** |
| **Whether to put the narrower tamper-evidence argument (§1.1) to Michael first** | The user | Michael asked a direct question and it has not been answered. Removing validation without replying leaves his question hanging. **Does not block engineering; does affect whether this removal is the right answer at all.** |
| **Reducing US-MON-01's signal set** | CCH (monitoring owner) | Changes MLA's published metric surface and any dashboard built on it. |
| **Accepting the residual risk** | CCH (security posture) | The switch validates and the boundary is shared — but MLA would no longer independently detect an altered record produced *inside* that boundary. |

**Recommended default while these are open:** do the work on a branch, verify it fully, and **leave it
unmerged** pending the two closure-blocking sign-offs. This mirrors how Phase 3 and Phase 4 handled their
own open decisions — build against a stated, reversible default, and never record the decision as silently
resolved.

**What this plan deliberately does not recommend:** flipping `JWS_VALIDATION_DISABLED` to `true` as a
standing production default. That leaves the entire key-distribution problem, the config surface, and the
dead code in place while removing the protection — strictly worse than either keeping validation or
removing it properly.

---

## 10. Open questions this plan cannot close

1. **Is `fspiop-signature` guaranteed present on every audit record?** MLA currently treats absence as
   `missing-signature` and skips. After removal, absence is simply ignored — so nothing depends on the
   answer. Noted because it is the kind of question that looks load-bearing and is not.
2. **Does anything downstream consume the JWS metrics?** §4.3 assumes not. Confirm with whoever owns the
   Grafana dashboards before deleting them, or expect "no data" panels.
3. **Does PPA (or Tazama) anywhere assume MLA validated signatures?** Inspection of the envelope contract says
   no — there is no such field. Worth one confirmation with the PPA engineer, since `cch-ppa`'s source is now
   local and readable.
4. **Is the audit topic's ACL actually restrictive?** Michael's statement is architectural. If a
   defence-in-depth argument is ever wanted, the concrete question is who holds write access to
   `topic-event-audit` — a CCH/Infotex infrastructure question, not an MLA one.

# What's the point of these PRs?

<!-- SPDX-License-Identifier: Apache-2.0 -->

Source: `shared-with-izyane/` — the FSD (`Tazama_Rules_ML_Customization_FSD_v1_1.docx`, v1.1, 7 Aug 2026), the Dev Config Guide (`Tazama_Rules_Developer_Configuration_Guide.docx`, v1.0, 17 Aug 2026), and the weights worksheet. Tazama platform mechanics from `docs/Tazama/Product/`.

---

## 1. How Tazama works, in one pass

A transaction enters through the **TMS API** (ISO 20022: `pain.001`, `pain.013`, `pacs.008`, `pacs.002`), which stores it, loads it into a history graph, and builds a `DataCache` of the identity/amount fields every rule needs. The **Event Director** reads the **network map** — a message-type → typologies → rules tree — and fans the transaction out to exactly the rule processors that message type requires.

Each **rule** answers one narrow behavioural question ("how long has this creditor's account existed?", "is this amount above the regulatory threshold?"). It checks early-exit conditions, queries history, and classifies the result into a **band** (`.01`, `.02`, `.03` — contiguous numeric sub-ranges) or a **case** (discrete labels). It emits only that code — `subRuleRef` — never a score.

The **typology processor** waits until every rule in a typology has reported, then converts each `subRuleRef` into a number via the typology's own weight table, combines them by an **expression**, and compares the total against `alertThreshold` / `interdictionThreshold`.

**The division of labour is the thing to hold onto:** a rule decides *which band*, a typology decides *what that band is worth*. The same rule scores differently in different typologies. That is why a rule returning the wrong band, or silently returning `.x00` forever, corrupts every typology downstream while every individual component still looks healthy.

Three codes carry special meaning:

| Code | Meaning | Score |
| --- | --- | --- |
| `.x00` | Exit — not settled, or insufficient history | 0 everywhere |
| `.x01` | Rule 018 only — no same-currency history | 0 everywhere |
| `.err` | Could not evaluate — wrong message type, missing identity/config | 0 everywhere **except** rule 091 in typology 137, where it scores 100 |

`.x00`'s principle (Dev Guide §4.2): *insufficient data is not evidence.* A rule that cannot see enough history must not push a typology toward an alert — or away from one.

---

## 2. What changed, and why anything had to

Tazama's rule set was written for a **domestic, single-currency** deployment where the platform's own ISO 20022 messages are the native input.

COMESA's **DRPP** is neither. It is a **Mojaloop** switch running **cross-border** payments — starting with Zambia–Malawi, ZMW↔MWK bidirectional, targeting all 21 COMESA member states. Mojaloop emits *its own* ISO 20022 messages, which the **PPA** (Payment Platform Adapter) translates into Tazama's ISO 20022 message set before the TMS ever sees them.

That single change of input source breaks the existing rules in four distinct ways:

**1. Currency makes amount comparisons meaningless.** A rule comparing "is this amount similar to the last three?" across ZMW and MWK compares numbers with no common scale. Benford's Law (054/063) on blended currencies distorts the digit distribution. "1.5× the previous biggest" (018) is invalid across currencies — and a debtor's first transaction in a new currency always looks exceptionally large against empty same-currency history.

The fix is deliberately **not** FX conversion. FX is performed externally by the FX provider before a transaction reaches Tazama; there is no live rate feed at evaluation time. So amounts are cohorted **per corridor** — the *ordered* pair source→destination currency — with thresholds and baselines configured in each corridor's own local currency. Direction matters: Malawi→Zambia and Zambia→Malawi carry different volume profiles. The trade-off is configuration volume: one value per corridor, scaling toward 420 directed pairs at full COMESA coverage.

**2. Identity is not where the rules expect it.** Tazama's message set has no bank-style account number, so a composite `accountKey` `{partyIdScheme, partyId, fspId}` replaces any single-field account reference. On FX legs, creditor identity is an *FSP* ID, not the customer's — so rules 001/003 "fail silently" as originally written. Identity often lives on an earlier message in the chain (`identitySourceStage`), since transfers and status messages reference it by back-pointer rather than carrying it. And one wallet reachable by MSISDN, ALIAS and DEVICE identifiers counts as three accounts unless de-duplicated — which systematically *overcounts* in rules 083/084, whose entire purpose is multiple-account detection.

**3. Some fields simply don't exist.** Rule 007 compared free-text descriptions; no free-text field exists anywhere in the translated message set. It is repointed to the categorical `Purp.Prtry` — which only supports exact match, so its bands drop from 3 to 2 and the middle "similar descriptions" band is removed. Rules 074/075 (geolocation) are **dropped entirely** — 33 rules in scope become 31 configured. Conversely, rule 078 gains a 4th case (`.04 REFD`) because the refund signal was already sitting in the message, unused.

**4. Settlement status arrives on a different message than the rule runs on.** Most rules bind to `pacs.008` (the transfer), but settlement confirmation only arrives later on `pacs.002`. `txStsSuccessCodes` defines what counts as settled (`ACSC`/`ACCC` success; `RJCT`/`CANC` fail; `PDNG` neither) — and the required behaviour is that an unsettled transaction exits `.x00`, contributing nothing.

The FSD's scope line is emphatic: **no field is added or removed anywhere** — every fix uses fields already present in the translated message set.

---

## 3. Why there are code PRs at all — the crux

The FSD frames all 33 rules as changes "at the parameter and band level only." Read alone, that implies a configuration exercise: edit JSON, ship.

The Dev Config Guide §1.3 contradicts it directly, and this is the single most important sentence in the whole source set:

> the cross-cutting parameters it introduces — `currencyScope`, `identityResolutionViaCorrelationId`, `identitySourceStage` and `excludeRefundLinkedTxns` — **do not yet exist in the deployed rule processors.**

These four are not values. They are **behaviours**:

- `currencyScope: perCorridor` — the processor must **cohort its history query by corridor** before computing any statistic
- `identityResolutionViaCorrelationId` — a **second lookup** back to a different message to resolve real customer identity
- `identitySourceStage` — **read identity from a message other than the one that triggered evaluation**
- `excludeRefundLinkedTxns` — **filter history on a field the processor currently ignores**

> Setting these keys in a configuration has no effect until the processor reads them.

**That is the point of these PRs.** They are the code that makes the FSD's configuration actually mean something. Without them you get a system that is configured correctly, validates cleanly, runs green — and behaves exactly as it did before, silently.

The Dev Guide's §10 implementation sequence puts this first, ahead of everything: *"Implement processor support for the cross-cutting parameters (§1.3)... Until [they] are read by the processors, configuring them has no effect."* And its diagnostic instruction is a direct description of the failure mode: *"treat a rule that appears configured but returns unchanged results as an unimplemented parameter rather than a configuration error."*

---

## 4. The cumulative deliverable

The 33 individual rule PRs together produce **one thing**: a Tazama rule fleet that evaluates COMESA's cross-border Mojaloop traffic as correctly as stock Tazama evaluates domestic single-currency traffic.

Each PR is one rule's share of that. None is independently valuable — a correctly rebound rule 011 feeding a typology whose other members are still miscounting produces a score that is wrong in a new way. The work only pays out when the fleet is consistent, because **typologies are where rule results actually become decisions**, and a typology is only as sound as its weakest member rule.

Three properties make that consistency unusually fragile, and they are exactly what the review pass exists to protect:

**Failures are silent by construction.** `.x00` and `.err` both score 0 and both look like clean exits. A rule that has gone completely dark — the `e2eIndex` self-reference inversion found on rules 010/011 during calibration, where a `pacs.008`-bound rule searches for its own `EndToEndId` among settled `pacs.002` rows and can never find it — returns `.x00` on every live transaction while reporting success. No test fails. No error rate climbs. The rule simply stops contributing, and every typology it feeds quietly loses a member.

**Tests can mask precisely what they appear to prove.** Rule 010's and 011's suites set `EndToEndId = 'test-id'` to match a mocked settled row — manually constructing the one condition real data can never produce. Green means the mock avoided the bug, not that the bug isn't there. A rule-processor PR's test suite passing is weak evidence; tracing the rule's behaviour against a real message chain is the real check.

**Every defect has a downstream multiplier.** Weights are `tier cap × band severity`, thresholds are 50% of max score, and both are **provisional** — derived by uniform method, not known to be correct, to be tuned against FUT data. A wrong band boundary invalidates every weight built on it (Dev Guide §9.2 calls the 14 derived band sets the highest-priority verification for exactly this reason). And during FUT, a bad alert rate is not yet distinguishable from untuned weights — so a rule defect shipped now hides inside the noise the tuning phase is meant to resolve.

---

## 5. What is actually at stake

**Rule 091 is the sharpest case.** It flags transactions at or above the regulator-mandated reporting threshold. The FSD calls it the highest-priority rule in the register; §8 explains why: a missing `corridorThreshold` entry, or one in the wrong currency, lets a transaction that should be reported to a regulator **pass undetected**.

The configuration response is the only deliberate fail-loud path in the entire system: rule 091's `.err` scores **100** inside typology 137, which alerts at 100% of max. An unconfigured corridor raises an alert rather than scoring zero. The asymmetry is intentional and documented as not-to-be-corrected — 091 also sits in typologies 010, 169 and 214, where `.err` scores 0, because *one configuration defect should raise one alert, not four*.

That inversion is worth internalising: everywhere else in Tazama, a broken rule is invisible. Here, someone deliberately built a single tripwire, because the cost of silence is a regulatory reporting failure.

**Alerting only, this phase.** No transaction is interdicted during FUT — only alert thresholds are configured. The immediate consequence of a defective rule is therefore a missed or spurious *investigation*, not a wrongly blocked payment. That lowers the blast radius now and raises it later: these same rules carry interdiction authority once the deployment reaches CA.

**Known-and-accepted gaps, not to be re-raised as defects:**

- **FX legs systematically under-score.** Ten rules are `pacs.008`-only, so a cross-border FX transaction is evaluated by fewer rules than a domestic one — and cross-border is COMESA's *primary* use case. Typologies 005, 011, 047, 092, 098, 124 become unreachable from `pacs.009`. Tracked (Open item 2), explicitly *not* a tuning problem.
- **`identityResolutionRule` has no safe default.** Rules 083/084 will over-count until COMESA defines de-duplication. The FUT position is to accept the over-count and hold typologies 003, 013, 105 back — a blocker for promotion, not for configuration.
- **`corridorThreshold` final values** are a blocker for CA only, not FUT; the 2,000 USD-equivalent floor covers FUT and CUG.

---

## 6. The one-paragraph version

Tazama's rules were built for domestic single-currency traffic. COMESA's DRPP runs cross-border Mojaloop payments where amounts span currencies, identity hides behind FSP IDs and back-references, some expected fields don't exist, and settlement status arrives on a later message than the rule runs on. The FSD specifies the per-rule fix; the Dev Config Guide supplies the weights and thresholds. But four of the cross-cutting parameters the FSD introduces describe *behaviour the processors don't implement yet* — so configuration alone changes nothing. **These PRs are that missing implementation.** They only pay out as a consistent fleet, because typologies are where rule results become decisions; and because a broken rule here exits `.x00` with a clean green test suite instead of failing loudly, the review pass is the only place most of these defects can still be caught.

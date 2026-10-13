# End-to-End Testing of Tazama Rule Changes

## Contents

- [Why the rules are changing](#why-the-rules-are-changing)
- [Mental models](#mental-models)
  - [1. A rule change is a promise about outcomes](#1-a-rule-change-is-a-promise-about-outcomes)
  - [2. Each layer goes live by a different path](#2-each-layer-goes-live-by-a-different-path)
  - [3. An unchanged network map is a claim you prove](#3-an-unchanged-network-map-is-a-claim-you-prove)
  - [4. Each message is scored alone, and the pipeline waits for everyone](#4-each-message-is-scored-alone-and-the-pipeline-waits-for-everyone)
  - [5. Silence is the default failure](#5-silence-is-the-default-failure)
  - [6. The documents are the test oracle](#6-the-documents-are-the-test-oracle)
  - [7. History is a fixture you build on purpose](#7-history-is-a-fixture-you-build-on-purpose)
  - [8. Compare before and after, not just after](#8-compare-before-and-after-not-just-after)
- [The method](#the-method)
  - [Step 1: Write the expectations first](#step-1-write-the-expectations-first)
  - [Step 2: Prove the scenario and freeze the starting point](#step-2-prove-the-scenario-and-freeze-the-starting-point)
  - [Step 3: Prove the pipeline can score the message type](#step-3-prove-the-pipeline-can-score-the-message-type)
  - [Step 4: Record a baseline](#step-4-record-a-baseline)
  - [Step 5: Apply the change and prove it is live](#step-5-apply-the-change-and-prove-it-is-live)
  - [Step 6: Run the scenarios](#step-6-run-the-scenarios)
  - [Step 7: Compare, decide, and roll back if needed](#step-7-compare-decide-and-roll-back-if-needed)
- [Designing the scenarios](#designing-the-scenarios)
  - [For a rule change](#for-a-rule-change)
  - [For a typology change](#for-a-typology-change)
  - [Worked example: an illustrative rule](#worked-example-an-illustrative-rule)
- [What counts as a pass](#what-counts-as-a-pass)
- [When the network map changes too](#when-the-network-map-changes-too)
- [Notes for Claude](#notes-for-claude)
  - [Sources and scope](#sources-and-scope)
  - [Platform facts that shape the tests](#platform-facts-that-shape-the-tests)
  - [Sending test messages](#sending-test-messages)
  - [Reading the results](#reading-the-results)
  - [Diagnosing a missing or wrong result](#diagnosing-a-missing-or-wrong-result)
  - [Rules of engagement](#rules-of-engagement)

---

This article covers a guide for someone working to modify existing Tazama rules (either code or config layer).

Firstly, you need a good understanding of core Tazama. Here

Then, you need to know what the key configuration artifacts are in the Tazama core ecosystem and how processing is decoupled from configuration. Key thing to note is that config is never hard-coded in code. It is injected. See how at three links: A, B and C.

Once the core pipeline from TMS to Event-adjudicator is clear, you make sure you know the INTENT and REASONING behind why you are modifying the existing rules. What is the need? Isn't Tazama an already perfect system. (HINT: perfection is not a metric, changes always precede requirements)

---

## Why the rules are changing

Tazama is not broken, and its stock rules are not wrong. They were built for a domestic, single-currency deployment that feeds Tazama its own ISO 20022 messages. COMESA's DRPP is a different context. It is a Mojaloop switch running cross-border payments, starting with Zambia–Malawi (ZMW↔MWK) and growing to 21 member states. Its messages reach Tazama only after the Payment Platform Adapter (PPA) translates them. The context changed first, and the requirements followed.

Against that context the stock rules break in four ways:

| What changed | What it does to the stock rules | What the FSD specifies |
| --- | --- | --- |
| Amounts span currencies | Rules that compare or aggregate amounts end up mixing currencies that have no common scale | Cohort history per corridor (source → destination currency). Thresholds are set per corridor in local currency, with no runtime FX conversion |
| Identity lives elsewhere | There is no bank-style account number. FX legs carry FSP IDs, and status messages point back to identity instead of carrying it. The same customer can also appear under several identifier types | Composite account keys, correlation back to the originating transfer, identity de-duplication |
| Some fields don't exist | A few rules rely on fields that the translated messages don't carry | Those rules are repointed to an equivalent field, extended, or dropped |
| Settlement arrives later | Most rules run on the transfer (pacs.008), but settlement status arrives afterwards on pacs.002 | Only settled history counts (`txStsSuccessCodes`). An unsettled transaction exits `.x00` |

Three documents in this folder are the specification of record:

- **`Tazama_Rules_ML_Customization_FSD_v1_1.docx`** (the FSD): what changes on each rule, and why.
- **`Tazama_Rules_Developer_Configuration_Guide.docx`** (the Dev Guide): the values actually loaded, meaning bands, severities, weights and per-message thresholds. Where the two differ on configuration detail, the Dev Guide governs (its §1.2).
- **`COMESA-typology-weights-tuning-worksheet.xlsx`**: every typology × rule × band weight, with the reason for each.

That gives "correct" a precise meaning. A rule change is correct when the running pipeline produces the outcomes these documents predict, for the messages the PPA actually sends.

Two things follow:

- **A green unit-test suite is necessary, but it is not enough.** Unit tests never see the network map, the transport between services, the stored history or the typology scoring.
- **Every weight and threshold is provisional until it is tuned on FUT data** (Dev Guide §1). An end-to-end test proves that the configuration matches the documents. It does not prove the documents are right.

## Mental models

Hold these eight ideas while testing. The method and the scenarios follow from them.

### 1. A rule change is a promise about outcomes

```
history + message
   │  the rule computes one metric: seconds, days, a z-score, a count
   ▼
outcome (subRuleRef): a band, a case, .x00 or .err
   │  every typology that holds the rule looks up its own weight for that outcome
   ▼
typology score: the typology's expression over those weights, a sum in practice
   │  compared with the typology's alertThreshold for this message type
   ▼
review: true or false
   │  any typology with review = true on this message
   ▼
evaluation status: ALRT, otherwise NALT
```

The FSD and Dev Guide promise a value at every arrow, so a test checks every arrow and not just the status at the end. An ALRT reached through the wrong band is still a failure. It becomes a wrong alert the day the weights are tuned.

### 2. Each layer goes live by a different path

| What you changed | Where it lives | Who reads it | When the change is live |
| --- | --- | --- | --- |
| Rule code | The rule processor image | That rule's container | After the container restarts on the new image |
| Rule config: parameters, exit conditions, bands, cases | A row in `configuration.rule`, keyed by rule id, cfg and tenant | The rule processor, which caches it in memory | After a restart, or after the cache expires (5 minutes on stock settings) |
| Typology config: weights, expression, thresholds | A row in `configuration.typology`, keyed by typology id, cfg and tenant | The typology processor, at scoring time | On the next message, with stock settings (no cache) |
| Network map | `configuration.network_map`, one active map per tenant | The event director for routing, and the typology processor and event adjudicator for their subscriptions | Unchanged in the scenario this article covers |

Code and configuration are tested the same way, because the outcome is the contract whichever layer produced it. The trap is timing. A test that runs before the change is live tests the old configuration and passes for the wrong reason, so Step 5 proves the change is live before anything counts.

### 3. An unchanged network map is a claim you prove

The network map routes by exact message type, and it names every rule and typology by exact `id` and `cfg`. An in-place change keeps all of those identical. The claim "the network map didn't change" holds only if all of the following are true:

- The rule's `id@version` and its `cfg` are unchanged.
- Its message binding is unchanged. A rule rebound from pacs.002 to pacs.008 has to move under the pacs.008 branch of the map, and that is a map change.
- No typology gains or loses the rule.
- The typology `cfg` strings are unchanged.
- The live map already routes the rule's message type to every typology that holds it.

If any of these fails, you are in the other scenario (see [When the network map changes too](#when-the-network-map-changes-too)).

In-place changes belong in test environments only. In production a configuration is never overwritten. A new cfg version and a new network map keep every past evaluation reproducible.

### 4. Each message is scored alone, and the pipeline waits for everyone

Scoring is per message, keyed by the message's own `MsgId`. A pacs.008 and its later pacs.002 are two separate evaluations, each with its own typologies, its own maximum score and its own thresholds (Dev Guide §6).

Within one message the pipeline waits:

1. The typology processor waits until every rule that the network map lists for a typology, on that message type, has reported.
2. The event adjudicator then waits until every typology for that message type has reported.
3. Only then is one evaluation written.

Two consequences:

- One rule that never answers means no evaluation at all.
- A typology configured for a message type must reference exactly the rules routed for that message type.

### 5. Silence is the default failure

Each of these passes a casual "no errors in the logs" check:

- **Exit codes look like clean results.** `.x00` and `.err` both score 0. A rule that exits `.x00` on every live transaction has gone dark, and every typology it feeds quietly loses a member.
- **A missing weight zeroes the whole typology.** If an outcome is missing from a typology's weight table, the expression can't be evaluated and the whole typology scores 0. One line goes to the typology processor's log and nothing else happens.
- **An unrouted message type disappears.** A message type that isn't in the network map is dropped at the event director, and the sender already has its HTTP 200.
- **Fields can vanish in transit.** A field a rule reads that isn't part of the transport schema arrives as undefined, even though the message that reached TMS had it.
- **Messages sent during a restart are lost.** A message published while its consumer is restarting is gone, because stock stacks run NATS without persistence.
- **A stale cache tests the old config.** A configuration change read through a cache that hasn't expired yet gives you results from the old configuration.
- **A threshold of 0 never alerts.** A typology whose `alertThreshold` is 0 or missing never raises an alert, because the typology processor treats 0 as "missing".

So assert values. Never call a test passed because nothing complained.

### 6. The documents are the test oracle

Every expected value is looked up, not judged.

| Expectation | Where it comes from |
| --- | --- |
| The metric, its units, band edges, severities and the full outcome set | Dev Guide §5, and the worksheet's "Rule outcomes" sheet |
| Which typologies a rule feeds, and its role in each | Dev Guide §8 |
| The weight for each typology × rule × band | The worksheet's "Weights" sheet (tier cap × severity, Dev Guide §3.1) |
| The threshold for each typology × message type | Dev Guide §6 |
| The exit and error policy | Dev Guide §4.2 and §4.3 |
| What each parameter means | FSD §5.1, §5.2, and the rule's own §6 entry |
| The deliberate exceptions | Dev Guide §7.1 and §11.2 |

Write the prediction first, then run, then compare. A result judged "looks plausible" after the fact is not a test.

### 7. History is a fixture you build on purpose

Rules answer questions about the past, so build that past explicitly for each scenario, with real messages sent through TMS:

- **Backdate it.** TMS stores each message's own `GrpHdr.CreDtTm`, so set it to place history in time.
- **Settle it.** Send a pacs.002 for each transfer, with `ACCC`, `ACSC`, `RJCT` or `PDNG` as the scenario needs.
- **Isolate it.** Give every run its own identities, so no other data leaks in.

Never test against whatever history an environment happens to hold.

### 8. Compare before and after, not just after

Run the same scenarios before the change and after it, each in a fresh identity namespace, and diff the evaluations. Every difference must be one the change predicts, and anything else is a regression. This is how you catch a change to one rule quietly moving a typology nobody was looking at.

## The method

This covers the scenario this article is about: existing rules or typologies changed in place, with the network map unchanged.

### Step 1: Write the expectations first

- **Name the change.** Say which rules or typologies, which fields, and whether the change is code, config or both.
- **List every typology the rule feeds** (Dev Guide §8), and the message types that route the rule to it.
- **Write one row per scenario** (see [Designing the scenarios](#designing-the-scenarios)). Each row holds:
  - the history and message you will send;
  - the expected metric and outcome;
  - for each typology, the expected weight, score, threshold and review;
  - the expected status.
- **Treat an outcome-set change as a typology change too.** If you add, remove or rename a band or case, every typology holding the rule needs the new outcome in its weight table. Otherwise mental model 5 applies.

### Step 2: Prove the scenario and freeze the starting point

- Run the checklist from [mental model 3](#3-an-unchanged-network-map-is-a-claim-you-prove) against the live network map, not against a document.
- Save copies of the network map, every rule and typology config you will touch, and the versions of every pipeline service. These are your rollback and your evidence.
- Find out how the environment caches configuration, in both the rule processors and the typology processor. That decides what Step 5 has to do.

### Step 3: Prove the pipeline can score the message type

Send one minimal, valid chain for the message type the rule binds to. Confirm that an evaluation is written, that every typology for that message type is present, and that every rule's result is present in each. If any of that is missing, stop. It is a platform problem, and no rule test on that message type means anything until it is fixed.

> **Known platform limit (checked 2026-10-07).** On the stock Tazama 4.0.1 images we inspected, the typology processor and the event adjudicator accept only structured `pacs.002.001.12`. A structured `pacs.008.001.10` still reaches its rules, but the typology processor logs `Unsupported structured transaction type` and drops it. No typology score and no evaluation are produced. Most of the configured rules bind to pacs.008 (Dev Guide §4.1). Run this step first in your environment. If it shows the same behaviour, raise it before testing any pacs.008-bound rule. In the CCH UAT environment, every rule was rebound to `pacs.002.001.12` on 2026-10-13, so nothing there is scored on pacs.008; confirming that binding rests with the rule-configuration owners.

### Step 4: Record a baseline

Run the full scenario set against the current configuration, in its own identity namespace, and keep every evaluation it produces.

### Step 5: Apply the change and prove it is live

1. **Update the configuration row in place.** Keep `id`, `cfg` and `tenantId` byte-identical, because they are the row's key and what the network map points at. Re-read the stored row and diff it against what you meant to write.
2. **Make it take effect.**
   - For a rule config change, restart the affected rule containers, or wait out the cache.
   - For a typology change, nothing more is needed if the typology processor's cache is off. Otherwise restart it too.
   - For a code change, deploy the new image and restart the container.
3. **Wait** until every restarted service is up and subscribed before you send anything.
4. **Send a canary.** This is one scenario whose outcome is only possible under the new configuration, for example a value between the old band edge and the new one. If it shows the old outcome, the change is not live yet.

### Step 6: Run the scenarios

Run the same scenarios as Step 4 in a fresh namespace:

- Send each chain in order, one message at a time, and wait for TMS to accept each message before sending the next.
- Read each evaluation and fill in an "observed" column next to every expectation.

### Step 7: Compare, decide, and roll back if needed

- **Check every row.** Every expectation must match, at every arrow.
- **Check the diff.** Compare before and after. Every difference must be one predicted in Step 1.
- **Roll back on failure.** If anything fails, restore the saved configurations, restart the same services, and re-run the canary to prove the rollback is live.
- **Write it up.** Record the change, the expectation table with observed values, the diff and the verdict.

## Designing the scenarios

### For a rule change

| Scenario family | What it proves |
| --- | --- |
| Band edges | For every boundary: a value just below it, exactly on it, and just above it. Bands are lower-inclusive and upper-exclusive (Dev Guide §1.1), in the metric's own units: seconds, days, z-score |
| Every outcome reachable | At least one scenario per band or case, on a realistic, correctly ordered chain. A rule that returns `.x00` for all of them is dark |
| Exits | `.x00` with no history. `.x00` again with history that exists but isn't settled (`RJCT`, `CANC`, `PDNG`). Any rule-specific exit the Dev Guide defines (§4.2) |
| Errors | `.err` for a missing identity, or for a lookup with no entry, such as a corridor with no configured threshold or a code missing from a mapping |
| Each changed parameter | Two scenarios that differ only in what the parameter governs, and that should give different outcomes. For `currencyScope: perCorridor`, history that exists only in the other corridor must not count. If both scenarios give the same result, the parameter is inert (Dev Guide §1.3) |
| Settlement codes | History settled with `ACSC` counts just as `ACCC` does (FSD §5.2) |
| Field survival | Every field the rule reads from the in-flight message is sent by the PPA and survives transport ([platform facts](#platform-facts-that-shape-the-tests)) |
| Blast radius | Every typology the rule feeds gets the right weight, the right score and the right review |

### For a typology change

- **Static checks first.** These come from Dev Guide §11.2, are cheap, and catch most mistakes:
  - The top-band weights add up to the typology's maximum.
  - Each threshold equals the §6 row for its message type, computed as §3.2 describes, with the exceptions §7.1 lists.
  - Every weight is tier cap × severity.
  - Exit and error outcomes carry the weights §4.2 and §4.3 set, including the single documented exception.
- **Completeness.** The weight table covers every outcome each member rule can emit. The expression references exactly the rules routed for that message type, because an extra term zeroes the score.
- **Threshold edges.** Include scenarios that land the score one below the threshold, exactly on it, and one above it.
- **The applied threshold.** The threshold recorded in the evaluation equals the §6 value for that message type.

### Worked example: an illustrative rule

The rule and the two typologies below are invented to show the pattern. They are not Tazama rules or typologies, and their values come from no real configuration. For a real change, build the same table from the Dev Guide's values for that rule.

- **Rule R** counts the debtor's settled outgoing transfers in the 24 hours before the transfer being evaluated. It runs on the status message (pacs.002), so it can be tested even where the [Step 3](#step-3-prove-the-pipeline-can-score-the-message-type) limit applies.
  - **Bands:** `.01` under 3, `.02` from 3 up to 10, `.03` 10 or more.
  - **Exit:** `.x00` when the transfer being evaluated was not itself successful.
- **Typology T** holds R as primary. Its weights are `.01` 0, `.02` 50 and `.03` 100, and it alerts at 50.
- **Typology U** holds R as contextual. Its weights are `.01` 0, `.02` 15 and `.03` 30, and it alerts at 30.
- R is the only rule either typology has on this message type, and exit and error outcomes weigh 0 in both.

The fixture works like this. Debtor D makes N earlier transfers, each a pacs.008 followed by its pacs.002. D then makes transfer B, and B's pacs.002 is the message being evaluated.

| Scenario | R | T (alerts at 50) | U (alerts at 30) | Status |
| --- | --- | --- | --- | --- |
| No earlier transfers from D | `.01` | 0 | 0 | NALT |
| 2 settled transfers in the window | `.01` | 0 | 0 | NALT |
| 3 settled transfers | `.02` | 50, review | 15 | ALRT |
| 9 settled transfers | `.02` | 50, review | 15 | ALRT |
| 10 settled transfers | `.03` | 100, review | 30, review | ALRT |
| 3 transfers, one settled with `ACSC` | `.02` | 50, review | 15 | ALRT |
| 3 transfers, one rejected (`RJCT`) | `.01` | 0 | 0 | NALT |
| 3 settled transfers, one of them 25 hours before B | `.01` | 0 | 0 | NALT |
| B's own status is `RJCT` | `.x00` | 0 | 0 | NALT |

What the rows test:

- **Thresholds and edges together.** The 3-transfer row lands T exactly on its threshold, and the 10-transfer row does the same for U. Each one tests a band's inclusive lower edge and the `>=` threshold comparison at once.
- **One counting rule per row.** The `ACSC`, `RJCT` and 25-hour rows each change only what counts, so a failure points straight at it.
- **Zero is a value.** For a counting rule, no history is a count of 0, so it bands as `.01` instead of exiting as missing data. Know which of your rules treat "none" as a value and which treat it as insufficient data. The Dev Guide's band tables say which.

Before trusting any row, run the field-survival check on every field R reads in flight.

## What counts as a pass

A change passes only when all of these hold:

- Every expectation matches at every arrow: outcome, weight, score, threshold, review and status.
- Every message you sent has exactly one evaluation, or none only where the scenario predicts none.
- No outcome appears that you didn't predict, especially `.err`.
- Every non-exit outcome occurred in at least one scenario, so no rule is dark.
- The before/after diff contains only predicted differences.
- Nothing was published on an interdiction subject, since this phase is alerting only.
- No partial-result keys are left in the cache after the run. A stuck typology leaves one behind.

A missing evaluation is a fail. It is never "inconclusive".

## When the network map changes too

This article does not cover new rule or typology versions, a rule rebound to another message type, membership changes or new message types. Those changes ship as:

1. a new `cfg`;
2. a new network map, activated in place of the old one.

Three things differ from the in-place scenario:

- The event director's cached copy of the map must be refreshed.
- The typology processor and the event adjudicator compute their subscriptions from the map when they start. They need a restart to see new rules or typologies.
- The baseline and the comparison have to account for routing that moved, not just values that changed.

## Notes for Claude

### Sources and scope

- The FSD and Dev Guide are `.docx` files. Convert them to text before citing them (for example with LibreOffice headless) and cite section numbers. In the worksheet, "Weights" holds the typology × rule × band values, "Message coverage" the per-message thresholds, and "Rule outcomes" the band inventory.
- The Dev Guide binds rules to pacs.008 and pacs.002 (§4.1). In the CCH UAT environment every rule is rebound to `pacs.002.001.12` (2026-10-13), because the typology processor scores only that type. pacs.009 is out of scope fleet-wide, so ignore the Dev Guide's pacs.009 rows.
- The platform's status message type is `pacs.002.001.12`. The Dev Guide's `pacs.002.001.15` rows describe that same message.
- Take rule and typology ids and versions from the live network map. The documents write them as `NNN@1.0.0`.

### Platform facts that shape the tests

These were checked on 2026-10-07 against the stock Tazama 4.0.1 `rc` images (typology-processor and event-adjudicator built 2026-07-22, tms-service 2026-08-07, frms-coe-lib 8.2.0-rc.6). Confirm each one in the target environment before relying on it.

| Fact | Consequence for the test |
| --- | --- |
| The typology processor caches partial results under `<TenantId>:<MsgId>` and the event adjudicator under `EA_<TenantId>_<MsgId>_TP` | Write expectations per message. A leftover key after a run is a stuck evaluation |
| Both services accept only structured `pacs.002.001.12`. A structured pacs.008 is logged as `Unsupported structured transaction type` and dropped | This is the gate in Step 3 |
| The typology processor scores only once every rule listed for the typology on that message type has reported. The adjudicator writes only once every typology has. If a typology lists EFRuP, EFRuP must report too, with weight-0 entries for its outcomes | One silent rule means no evaluation at all |
| An outcome missing from `wghts`, or an expression term with no result, makes the expression non-numeric. The typology then scores 0 and logs `Expression evaluated to non numeric number` | Run the completeness check. Treat any unexpected score of 0 as suspect |
| `review` is set when score ≥ `alertThreshold`. An `alertThreshold` of 0 or missing logs `config missing alert Threshold` and never alerts. Interdiction fires only when `interdictionThreshold` is set and met | In the alert-only phase, leave `interdictionThreshold` out entirely |
| A rule processor reads its config by `RULE_NAME@RULE_VERSION`, the cfg found in the network map, and the tenant. With `LOCAL_CACHE_ENABLED=true` and `LOCAL_CACHETTL=300` (seconds), it caches in memory and no event clears the cache. The typology processor, event adjudicator and event director run with that cache off | Restart rule containers after a rule-config edit. Typology edits apply on the next message |
| A config row's key is generated from the JSON's own `id`, `cfg` and `tenantId` | Editing those fields inside the JSON silently moves the row. The rule then returns `.err` with `Rule processor configuration not retrievable` |
| Services use core NATS (`STARTUP_TYPE=nats`), with no persistence | Never send while a consumer restarts. Wait for its startup log line naming its consumer subject |
| Messages travel as protobuf (`Full.proto`). Fields outside the schema are dropped, including `CdtTrfTxInf.Purp.Prtry` (only `Purp.Cd` is carried), `CdtTrfTxInf.InstrForCdtrAgt` and `TxInfAndSts.PrcgDt`. Zero numbers and `false` flags are dropped in transit too | Check field survival for every field a rule reads in flight. In stored results, read a missing number as 0 and a missing `review` as false. A missing `wght` alone doesn't prove the outcome is unmapped |
| The rule executer turns any thrown error into `.err`, with the error message as `reason`. It strips `reason` from every result that isn't `.err` | Evaluations show `subRuleRef`, `wght`, `indpdntVarbl` (the metric) and `prcgTm`, but no band reasons |
| TMS takes `TenantId` from the JWT and ignores the body's value. It routes `POST /v1/evaluate/iso20022/pacs.008.001.10` and `.../pacs.002.001.12`. The pain.001/pain.013 routes exist only when `QUOTING=true`. Each route needs its privilege, for example `POST_V1_EVALUATE_ISO20022_PACS_008_001_10` | Get a token from auth-service with `POST /v1/auth/login` and a `{username, password}` body. It returns a bare JWT |
| For each pacs.008, TMS writes an `event_history.transaction` row: `source` is the debtor account, `destination` the creditor account, `amt`/`ccy` are taken from `InstdAmt`, and `creDtTm` is the message's own `GrpHdr.CreDtTm`. For each pacs.002 it writes a row with `txsts`, with `source` and `destination` reversed. Raw documents go to `raw_history` | Backdate with `CreDtTm`. Build settled history with pacs.002s |
| Account ids are composed as `Othr.Id + SchmeNm.Prtry + ClrSysMmbId.MmbId`. Party ids are `Othr.Id + SchmeNm.Prtry` | To make two messages hit the same account, keep all three parts identical |
| A pacs.002 needs its pacs.008 first, because TMS rebuilds DataCache from it by `EndToEndId`. `raw_history` keys pacs.002 by `EndToEndId`, and `MsgId` is unique per tenant | Use one pacs.002 per transfer and fresh ids per run. A `PDNG` status can't later be followed by `ACCC` for the same transfer, so its result is final. Confirm this with one test; it answers Dev Guide §9.2 |
| The adjudicator writes one `evaluation` row per message, ALRT or NALT, with `ON CONFLICT (messageId, tenantId) DO NOTHING`. It then publishes alerts on `investigation-service` | A reused `MsgId` silently keeps the old row |
| An unmatched `TxTp` is logged by the event director as `No corresponding message found in Network map` and dropped | This is the first thing to check when no evaluation appears |
| TMS's DataCache holds `cdtrId`, `dbtrId`, `creDtTm`, `instdAmt`, `xchgRate`, `cdtrAcctId`, `dbtrAcctId` and `intrBkSttlmAmt`, and no `corridor` key (checked 2026-10-13 on UAT) | A rule that requires `DataCache.corridor` exits on every message. Check what the rule reads against this list before testing it |
| PPA reports a completed transfer with `TxSts` `ACSC` (checked 2026-10-13 on UAT: 43 of 50 `pacs.002` rows) | A history query that counts only `ACCC` misses PPA's settlements. Count settled history through `txStsSuccessCodes`, and build fixtures with the status PPA actually sends |

Stock `tazama-stack` host ports: TMS 5000, auth-service 3020, admin-service 5100, Postgres 15432, Valkey 16379, NATS 14222, nats-utilities 4000.

### Sending test messages

- **Base messages on what the PPA really emits**, not on FSD field paths. For example, the purpose code arrives as `Purp.Cd`. Validate every fixture against the target TMS's own JSON schema (`src/schemas/pacs.008.json` and `pacs.002.json` in tms-service, at the deployed commit). The stock schema requires more than the core fields, including `InstdAmt`, `ChrgsInf`, `RgltryRptg`, `RmtInf` and `SplmtryData`.
- **Prefix every identity, `MsgId` and `EndToEndId` with a run id.** Use UTC ISO timestamps and place history in time with `GrpHdr.CreDtTm`.
- **Send each transfer as its pacs.008, then its pacs.002**, with `OrgnlEndToEndId` set to the pacs.008's `EndToEndId`. Send one message at a time and wait for HTTP 200 before the next.
- **To probe one rule in isolation**, call nats-utilities `POST /natsPublish` with `{message, destination: "sub-rule-<id>@<ver>", natsConsumer: "pub-rule-<id>@<ver>", functionName, awaitReply: true}`. Its output also reaches the typology processor, so use a unique `MsgId`.
- **Don't use nats-utilities `restPublish` against an authenticated TMS.** It posts without a token, so TMS rejects it.

### Reading the results

The evaluation row for a pacs.002, flattened. Run it in the `evaluation` database, for example `psql -v msgid=<MsgId>`:

```sql
SELECT e.evaluation -> 'report' ->> 'status'                      AS status,
       t ->> 'cfg'                                                 AS typology,
       COALESCE((t ->> 'result')::numeric, 0)                      AS score,
       (t -> 'workflow' ->> 'alertThreshold')::numeric             AS alert_threshold,
       COALESCE((t ->> 'review')::boolean, false)                  AS review,
       r ->> 'id'                                                  AS rule,
       r ->> 'subRuleRef'                                          AS outcome,
       COALESCE((r ->> 'wght')::numeric, 0)                        AS weight,
       COALESCE((r ->> 'indpdntVarbl')::numeric, 0)                AS metric
FROM evaluation e
CROSS JOIN LATERAL jsonb_array_elements(e.evaluation -> 'report' -> 'tadpResult' -> 'typologyResult') t
CROSS JOIN LATERAL jsonb_array_elements(t -> 'ruleResults') r
WHERE e.messageid = :'msgid';
```

For a pacs.008, match on `e.evaluation -> 'transaction' -> 'FIToFICstmrCdtTrf' -> 'GrpHdr' ->> 'MsgId'` instead. The `messageid` column covers pacs.002 only. Poll for the row with a timeout of about 30 seconds.

To watch messages in flight, these are the NATS subjects. Payloads are protobuf `FRMSMessage`, which frms-coe-lib decodes.

| Subject | What travels on it |
| --- | --- |
| `event-director` | TMS output |
| `sub-rule-<id>@<ver>` | A rule's input |
| `pub-rule-<id>@<ver>` | A rule's result |
| `typology-<typology cfg>` | Typology processor output |
| `investigation-service` | Alerts |
| `interdiction-service-tp`, `interdiction-service-ef` | Interdictions. They should stay silent in this phase |

### Diagnosing a missing or wrong result

Work through these in order:

1. **TMS didn't return 200.** Look for a schema failure, an auth failure, a pacs.002 sent before its pacs.008, or a reused `EndToEndId` or `MsgId`.
2. **The event director logged `No corresponding message found in Network map`.** The message type isn't routed.
3. **A rule result is `.err`.** Read its `reason`:
   - `Rule not found in network map`
   - `Rule processor configuration not retrievable`
   - the text of an error the rule threw
4. **The typology processor logged one of these:**
   - `Unsupported structured transaction type`
   - `does not belong to a Typology in active network map`
   - `Expression evaluated to non numeric number`
   - `config missing alert Threshold`
5. **A partial-result set is left in Valkey.** A leftover `<TenantId>:<MsgId>` or `EA_<TenantId>_<MsgId>_TP` set means some rule or typology never reported. `SCARD` counts what did arrive.
6. **There is no row and no error anywhere.** A consumer was down when the message passed. Confirm the subscriptions, then resend with new ids.

### Rules of engagement

- Never run these tests in production. In-place edits are for test environments only.
- Snapshot before every change. Restore after a failed run, and prove the restore with the canary.
- Don't restart or change services outside the change under test. Report environment problems instead of working around them.
- Report expected against observed at every arrow, and cite the document section each expectation came from.
- Never mark a scenario passed because nothing failed.
- Stop at Step 3 if the message type can't be scored. Report it as a platform finding, not a rule result.

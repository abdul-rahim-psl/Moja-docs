# Tazama Platform Knowledge Base
## Rules, Typologies, Network Maps — how they actually work

**Purpose:** the reference facts needed to read, write and review Tazama rule/typology/network-map configuration. Every statement here is traced to a source: Tazama product documentation, platform source code, or the Tazama 4.0.0 seed configuration.

**Sources used**

| Source | Path |
|---|---|
| Network map example | `tazama/docs/Product/complete-example-of-a-network-map.md` |
| Rule config example | `tazama/docs/Product/complete-example-of-a-rule-processor-configuration.md` |
| Typology config example | `tazama/docs/Product/complete-example-of-a-typology-processor-configuration.md` |
| Configuration management | `tazama/docs/Product/configuration-management.md` |
| Typology processing | `tazama/docs/Product/typology-processing.md` |
| Exit/error conditions | `tazama/docs/Technical/Processors/Rule-Processors/standard-rule-processor-exit-and-error-conditions.md` |
| ISO 20022 scope | `tazama/docs/Knowledge-Articles/iso20022-and-tazama.md` |
| Typology processor source | `tazama/typology-processor/src/logic.service.ts`, `src/utils/evaluateTExpression.ts` |
| Event Director source | `tazama/event-director/src/services/logic.service.ts` |
| Rule executer source | `tazama/rule-executer/src/controllers/execute.ts`, `src/helpers/determineOutcome.ts` |
| Shared schema/interfaces | `tazama/frms-coe-lib/src/schemas/ruleConfig.ts`, `src/interfaces/**` |
| Rule processor sources | `tazama/rule-collection/rule-NNN/src/` |
| **4.0.0 seed configuration** | `tazama/tms-configuration-main/curl/{network-map,rule-configs,typology-configs}.json` |

---

## 1. The evaluation pipeline

```
Client / PPA
    │  ISO 20022 message (pain.001 | pain.013 | pacs.008 | pacs.002)
    ▼
TMS API ──────────► raw_history (pacs008, pain001, … tables)
    │                event_history (transaction table)
    ▼
Event Director (ED)
    │  • reads the ACTIVE network map for this tenant
    │  • matches transaction TxTp to a messages[] branch (EXACT string match)
    │  • builds a Network Sub-Map = the single matching message branch
    │  • collects the DISTINCT union of rules across that branch's typologies
    │  • publishes to NATS subject  sub-rule-<ruleId>  (one message per rule)
    ▼
rule-executer × N   (one container per rule; RULE_NAME / RULE_VERSION env)
    │  • generic shell + injected rule library (`import { handleTransaction } from 'rule/lib'`)
    │  • loads rule config by (id, cfg, tenantId)
    │  • rule queries history, produces ONE metric → ONE subRuleRef
    │  • ALWAYS emits a rule result, even on failure (.err)
    ▼
Typology Processor  (single, centralised, config-driven)
    │  • caches rule results in Valkey/Redis under `<tenantId>:<transactionId>`
    │  • a typology is evaluated only when result COUNT == network-sub-map rule count
    │  • maps each subRuleRef → weight, substitutes into the MathJSON expression
    │  • score >= alertThreshold  → review = true
    ▼
TADProc  →  alert payload (transaction + network map + rule results + typology results)
```

### 1.1 The trigger message — the single most important platform fact

> **Tazama's default configuration evaluates the `pacs.002` as the trigger payload for the rule processors and typologies.**
> — `configuration-management.md` §1

The 4.0.0 seed network map has **exactly one** `messages[]` branch: `txTp: "pacs.002.001.12"`. All 31 seed typologies and all 33 seed rules hang off it.

This is not a quirk of the seed — it is baked into the rule code. 26 of the 30 in-scope rule processors present in `rule-collection` open with:

```ts
if (!isPacs002Transaction(req.transaction)) {
  return { ...ruleResult, subRuleRef: '.err', reason: 'Unsupported structured transaction type' };
}
```

**The mental model:** the `pacs.002` (settlement status confirmation) is the *trigger*; `pacs.008` / `pain.001` are the *history* the rule queries out of the database. Rule 001, for example, is triggered by a `pacs.002` and then runs SQL over `pacs.008.001.10` and `pacs.002.001.12` rows to derive account age.

Routing a stock rule on a `pacs.008` branch does not produce a partial evaluation — it produces `.err`.

### 1.2 Supported message types

Type guards in `frms-coe-lib/src/helpers/transactionTypeGuards.ts` recognise exactly four:

| Message | Version | Role |
|---|---|---|
| `pain.001.001.11` | CustomerCreditTransferInitiation | quote / initiation stage |
| `pain.013.001.09` | CreditorPaymentActivationRequest | quote response stage |
| `pacs.008.001.10` | FIToFICustomerCreditTransfer | transfer instruction |
| `pacs.002.001.12` | FIToFIPaymentStatusReport | **settlement status — the trigger** |

`pacs.009` (FinancialInstitutionCreditTransfer) is **not supported anywhere** in Tazama 4.x — not in the type guards, not in the seed, and explicitly unmarked in the ISO 20022 scope table in `iso20022-and-tazama.md`. There is no `pacs.002.001.15` either; the platform ships `.12`.

`txTp` matching in the ED is exact string equality. There is no partial or prefix match.

---

## 2. Rules

### 2.1 Anatomy

A rule is a Node/TypeScript library exporting a single `handleTransaction`, loaded into the generic `rule-executer` shell. Signature:

```ts
handleTransaction(
  req: RuleRequest,                    // transaction + networkMap + DataCache + metaData
  determineOutcome: (value, ruleConfig, ruleResult) => RuleResult,   // injected band resolver
  ruleResult: RuleResult,              // pre-seeded with .err / 'Unhandled rule result outcome'
  loggerService: LoggerService,
  ruleConfig: RuleConfig,              // fetched by (id, cfg, tenantId)
  databaseManager: DatabaseManagerInstance,
): Promise<RuleResult>
```

The rule result contract:

```json
{ "id": "001@1.0.0", "cfg": "1.0.0", "subRuleRef": ".01", "prcgTm": 17682366, "wght": 200 }
```

`wght` is stamped later by the typology processor, not by the rule. `reason` is present only on `.err` — the executer deletes it on the happy path.

### 2.2 The four outcome categories

A rule produces exactly one outcome, from exactly one category. They are mutually exclusive.

| Category | subRuleRef | Declared in rule config? | Meaning |
|---|---|---|---|
| **Band** | `.01`, `.02`, `.03`, `.04` | yes, `config.bands[]` | numeric metric fell in this range |
| **Case** | `.01`…`.0n` | yes, `config.cases.expressions[]` | discrete value matched this label |
| **Case catch-all** | conventionally `.00` | yes, `config.cases.alternative` | no case matched — **mandatory for cased rules** |
| **Exit** | `.x00`, `.x01`, `.x03`, `.x04` | yes, `config.exitConditions[]` | rule stopped early (valid, may be deterministic) |
| **Error** | `.err` | **no — never in config** | rule could not run; built into every processor |

Standard exit-condition register (`standard-rule-processor-exit-and-error-conditions.md`):

- `.x00` — current transaction unsuccessful (`TxSts != 'ACCC'`)
- `.x01` — fewer returned results than the minimum needed for a deterministic outcome

`.x03` and `.x04` are **not** in the standard register. They are rule-specific extensions used by the volume/amount-variance rules, and they are **deterministic signals, not absences of data**. The seed reason text for rule 010 `.x03` reads: *"No variance in transaction history and the volume of recent incoming transactions shows an increase"*. Tazama's own seed weights `.x03` at **100** in typology 185 for rules 010, 011, 020 and 048. Weighting `.x03` as zero discards real detection.

`.err` is deliberately absent from rule configuration because error conditions are too numerous to enumerate; the reason string carries the detail. **When composing a typology you must add `.err` by hand** — it cannot be reconciled from the rule config.

### 2.3 Banded rule configuration

```json
{
  "id": "006@4.0.0",
  "cfg": "4.0.0",
  "tenantId": "…",
  "desc": "Outgoing transfer similarity - amounts",
  "config": {
    "parameters": { "maxQueryLimit": 3, "tolerance": 0.1 },
    "exitConditions": [
      { "subRuleRef": ".x00", "reason": "Incoming transaction is unsuccessful" },
      { "subRuleRef": ".x01", "reason": "Insufficient transaction history" }
    ],
    "bands": [
      { "subRuleRef": ".01",                 "upperLimit": 2, "reason": "No similar amounts…" },
      { "subRuleRef": ".02", "lowerLimit": 2, "upperLimit": 3, "reason": "Two similar amounts…" },
      { "subRuleRef": ".03", "lowerLimit": 3,                  "reason": "Three or more…" }
    ]
  }
}
```

An open-ended band **omits** the bound. There is no `-Infinity` / `+Infinity` literal.

### 2.4 Band evaluation semantics — and three traps

`rule-executer/src/helpers/determineOutcome.ts`:

```ts
for (const band of bands) {
  if ((!band.lowerLimit || value >= band.lowerLimit) && (!band.upperLimit || value < band.upperLimit)) {
    res.subRuleRef = band.subRuleRef;
    res.reason = band.reason;
    break;
  }
}
```

1. **Lower-inclusive, upper-exclusive** — `lowerLimit <= value < upperLimit`. Confirmed.
2. **`0` is indistinguishable from "unbounded".** The guard is a falsy test, not `undefined`. A band written `lowerLimit: 0` has **no lower bound at all**. Harmless when the metric is non-negative and the band is first; a latent defect otherwise.
3. **Array order decides ties.** The loop `break`s on first match. Overlapping bands silently resolve to whichever appears first. Any generator that emits `bands[]` must emit them in ascending order.

If the value matches no band, `subRuleRef` is never assigned and the result carries the pre-seeded `.err` — documented as *"Unresolvable rule result due to misaligned result categories"*. **Gaps in a band set become errors, not zeros.**

If `bands` is absent entirely, `determineOutcome` throws. It handles bands only — cased rules resolve their own outcome.

### 2.5 Cased rule configuration

The shape in `frms-coe-lib/src/schemas/ruleConfig.ts` is an **object**, not an array:

```json
"cases": {
  "expressions": [
    { "subRuleRef": ".01", "value": "MP2B", "reason": "…Mobile P2B Payment" },
    { "subRuleRef": ".02", "value": "MP2P", "reason": "…Mobile P2P Payment" },
    { "subRuleRef": ".03", "value": "CASH", "reason": "…general cash management" }
  ],
  "alternative": { "subRuleRef": ".00", "reason": "The transaction type is not defined in this rule configuration" }
}
```

Resolution is exact string equality with a mandatory fallback (`rule-078`):

```ts
const ruleResult = caseObj.expressions.find((e) => e?.value === value);
return ruleResult ?? caseObj.alternative;
```

`alternative` is **required by the Zod schema**. A cased rule therefore always has a reachable catch-all, and that catch-all must be weighted in every consuming typology.

> The `cases` array-of-objects shape shown in `complete-example-of-a-rule-processor-configuration.md` does not match the 4.x schema. Trust the schema and the seed.

Bands and cases are mutually exclusive: if both are present, `determineOutcome` returns `.err` — *"Rule processor configuration invalid"*.

### 2.6 The configuration schema — it is permissive

```ts
export const baseConfigSchema = z.object({
  parameters:     z.record(z.union([z.string(), z.number()]), z.unknown()).optional(),
  exitConditions: z.array(OutcomeResultSchema).optional(),
  bands:          z.array(BandSchema).optional(),
  cases:          CaseSchema.optional(),
});

export const baseRuleConfigSchema = z.object({
  id: z.string(), cfg: z.string(), tenantId: z.string(),   // tenantId REQUIRED
  desc: z.string().optional(), creDtTm: z.string().optional(), updDtTm: z.string().optional(),
  config: baseConfigSchema,
});
```

Consequences that matter:

- **`parameters` is an open record with `z.unknown()` values.** Any key, any type — including objects and arrays — validates today. Adding a new parameter to a configuration document requires **no schema change** for it to *load*.
- What a new parameter does *not* get is *read*. `handleTransaction` only consumes the keys it was coded for. An unrecognised parameter is silently inert.
- No rule schema in `rule-collection` uses `.strict()`. Unknown keys are never rejected. A typo in a parameter name silently disables the control it was meant to set.
- Individual rules tighten the base by extension, e.g. rule 001 requires a `.x01` exit condition:
  ```ts
  baseConfigSchema.extend({
    exitConditions: z.array(OutcomeResultSchema)
      .refine((c) => c.some((e) => e.subRuleRef === '.x01'), { message: "must include a '.x01' entry" }),
  })
  ```
- Rules 021 and 063 emit `.x00`/`.x01` in code but **do not** enforce them in schema. If the config omits an exit condition the rule reaches for, the lookup yields `undefined` and the rule falls to `.err` instead of the intended exit.

### 2.7 Where behaviour actually lives

Rules hold **hand-written SQL**. Rule 001's account-age query hard-codes `TxSts = 'ACCC'`, `TxTp = 'pacs.008.001.10'` and `TxTp = 'pacs.002.001.12'` inline. There is no shared success-code lookup, no currency cohorting layer, no composite account key. Anything of that kind is per-rule code, not configuration.

`DataCache` — the pre-resolved context passed to every rule — is small:

```ts
interface DataCache {
  dbtrId?: string;  cdtrId?: string;
  dbtrAcctId?: string;  cdtrAcctId?: string;
  evtId?: string;  creDtTm?: string;
  instdAmt?:      { amt: number; ccy: string };   // source leg + currency
  intrBkSttlmAmt?:{ amt: number; ccy: string };   // settlement leg + currency
  xchgRate?: number;
}
```

Notable: **both currency legs and an exchange rate are present**, so a source→destination currency pair is derivable per transaction without new ingestion. Equally notable: there is no `partyIdScheme`, no `fspId`, no `PartyIdType`, no purpose code. Account identity is a single opaque string per party.

Rule 091 in full — it is the whole rule:

```ts
if (!req.DataCache.instdAmt) throw new Error('Expected instdAmt in data cache');
return determineOutcome(req.DataCache.instdAmt.amt, ruleConfig, ruleRes);
```

It reads `instdAmt` (the instructed/source leg), performs no query, and has no currency awareness.

### 2.8 Stage switching

Rule 078 selects its history table from a **process environment variable**, not from configuration:

```ts
if (!(process.env.QUOTING === 'true')) {  /* SELECT … FROM pacs008  (transfer stage) */ }
else                                     {  /* SELECT … FROM pain001 (quote stage)   */ }
```

Quote-stage vs transfer-stage selection is therefore currently a **deployment-wide** switch, not a per-rule configurable.

Also note the field actually read on the transfer path is `Purp.Cd` — `document -> 'FIToFICstmrCdtTrf' -> 'CdtTrfTxInf' -> 'Purp' ->> 'Cd'` — despite the column alias `CtgyPurpPrtry`. The quote path reads `PmtTpInf.CtgyPurp.Prtry`.

---

## 3. Typologies

### 3.1 Configuration shape

```json
{
  "id": "typology-processor",
  "cfg": "001@4.0.0",
  "desc": "…",
  "tenantId": "…",
  "workflow": { "alertThreshold": 800 },
  "rules": [
    {
      "id": "024@4.0.0", "cfg": "4.0.0",
      "termId": "v024at400at400",
      "wghts": [
        { "ref": ".err", "wght": 0 }, { "ref": ".x00", "wght": 0 },
        { "ref": ".x01", "wght": 0 }, { "ref": ".x03", "wght": 0 },
        { "ref": ".01",  "wght": 200 }, { "ref": ".02", "wght": 400 }
      ]
    }
  ],
  "expression": ["Add", "v024at400at400", "…"]
}
```

Interface (`TypologyConfig.ts`): `wght` is typed `number`. Some documentation examples show quoted strings — emit numbers.

### 3.2 `termId`

`termId` is the variable name that carries a rule's resolved weight into the expression. The seed convention is `v<ruleId>at<version>at<cfg>` with dots stripped — `v024at400at400` = rule 024 @ 4.0.0, cfg 4.0.0.

The only hard requirements are that it is **unique within the typology** and that it **appears as a term in the expression**. It is a label, not a computed quantity.

### 3.3 The expression

MathJSON, prefix notation, nestable. Supported operators: `Add`, `Subtract`, `Multiply`, `Divide`.

```json
"expression": ["Multiply", "c", ["Add", "a", "b"]]
```

Every seed typology uses a flat `["Add", …]`. The platform does not require summation — the published typology example uses `Multiply`, where a zero from one rule zeroes the whole typology by design.

> **A rule listed in `rules[]` but absent from `expression` contributes nothing, whatever its weights.** Membership and expression must be generated together.

### 3.4 The workflow object

```ts
interface WorkFlow {
  alertThreshold: number;          // required
  interdictionThreshold?: number;  // optional
  flowProcessor?: string;          // optional — EFRuP
}
```

- Breach is `>=`.
- Omitting `interdictionThreshold` means the typology never interdicts — the code tests `!== undefined` before comparing.
- Omitting `flowProcessor` means the EFRuP branch is skipped entirely.
- **Both omissions are fully valid.** An alerting-only deployment is a supported configuration, not a workaround.
- `alertThreshold: 0` is falsy and logs *"config missing alert Threshold"* — never use 0.

### 3.5 Scoring, completion, and what an unweighted outcome really does

**Completion** (`typology-processor/src/logic.service.ts`):

```ts
if (networkMapRules && typologyResultRules.length < networkMapRules.rules.length) continue;
```

A typology evaluates when the **count** of received rule results reaches the number of rules listed for it in the network sub-map. Completion is a headcount. It has nothing to do with weights.

**Scoring** (`src/utils/evaluateTExpression.ts`):

```ts
ruleResults.forEach((r) => {
  const values = valueMap.get(`${r.id}${r.cfg}${r.subRuleRef}`);
  if (values) { const [term, wght] = values; ruleTermMap.set(term, wght); r.wght = wght; }
});                                    // ← no else: unmatched outcome sets nothing

const expr = replaceTerms(typologyExpression, ruleTermMap);   // term left as a literal string
const returnValue = computeEngine.box(expr).evaluate();

if (typeof returnValue.value !== 'number' || returnValue.errors.length > 0) {
  loggerService.error(`Expression evaluated to non numeric number: …`);
  return 0;                            // ← the WHOLE typology scores 0
}
```

So, when a rule returns a `subRuleRef` the typology does not weight:

1. The lookup misses; that rule's `termId` never enters `ruleTermMap`.
2. `replaceTerms` leaves the raw `termId` string in the expression.
3. The compute engine evaluates an expression containing an unbound symbol and does not return a number.
4. The guard fires, logs an error, and returns **0 for the entire typology** — not 0 for that one rule.
5. The typology result is still built, still stamped `review: false`, and still forwarded to TADProc.

**The failure mode is a silent zero, not a hang.** Every other rule's evidence in that typology is discarded along with it. The only external symptom is one `Expression evaluated to non numeric number` log line and a rule result whose `wght` was never stamped.

This is why Tazama's own documentation is emphatic:

> ***Every. Possible. Outcome.***
> "All the possible outcomes from the rule processors are encapsulated in each rule's configuration, with the exception of the `.err` outcome … When composing the typology configuration, the user must remember to include the `.err` outcome."
> — `configuration-management.md` §2.2

### 3.6 What *does* stall a typology

A typology never completes when a rule listed for it in the network map **never delivers a result at all**. The count in §3.5 is never reached, the partial results sit in Valkey until the cache key is garbage-collected, and nothing is sent to TADProc.

Realistic causes:

- A rule is listed in the network map but its processor is not deployed or not subscribed to `sub-rule-<id>`.
- **`EFRuP` is listed in a typology's rule set but the event-flow processor is not running.** Eight seed typologies (028, 037, 044, 045, 047, 095, 179, 185) include `EFRuP@4.0.0` as a member. Listing it without deploying it is a genuine stall.
- The rule crashes so hard the executer cannot publish — rare, since the executer catches and emits `.err` on both the config-load and the execution paths.

---

## 4. The network map

```json
{
  "active": false,
  "cfg": "4.0.0",
  "messages": [
    {
      "id": "004@4.0.0", "cfg": "4.0.0", "txTp": "pacs.002.001.12",
      "typologies": [
        { "id": "typology-processor", "cfg": "001@4.0.0",
          "rules": [ { "id": "002@4.0.0", "cfg": "4.0.0" }, … ] }
      ]
    }
  ]
}
```

Interface: `NetworkMap { active, cfg, tenantId, messages[] }`, `Message { id, cfg, txTp, typologies[] }`, `Typology { id, cfg, rules[] }`, `Rule { id, cfg }`.

Routing behaviour (`event-director`):

- `getNetworkMap()` → `SELECT configuration FROM network_map WHERE active = true`. It returns a **list** — one active map per tenant is the 4.x multi-tenant model.
- The ED caches per `${tenantId}:${txTp}` in an in-process NodeCache with a TTL.
- `prunedMessage = messages.filter(msg => msg.txTp === txTp)` → the **Network Sub-Map carries exactly one message branch**. The typology processor relies on this and reads `networkMap.messages[0]`.
- Rules are **de-duplicated across typologies** before dispatch: a rule feeding eleven typologies is invoked once and its single result fans out.
- A rule that is not routed on a branch is never invoked, so its outcomes never need weighting for that message type.
- The rule executer resolves its own `cfg` by finding itself in the network map. A rule absent from the map yields `.err` — *"Rule not found in network map"*.

Uniqueness of the active flag is **not enforced by the platform**: *"The unique 'true' state of the active flag is expected to be enforced outside the system."* Two active maps for one tenant produce a last-write-wins race in the ED cache.

---

## 5. Configuration storage, keys and activation

Database `configuration`, PostgreSQL, one JSONB `configuration` column per row:

| Table | Lookup key |
|---|---|
| `rule` | `(ruleId, ruleCfg, tenantId)` |
| `typology` | `(typologyId, typologyCfg, tenantId)` |
| `network_map` | `active = true` |

- **`tenantId` is required by the schema and is part of every config lookup.** Tenant isolation is real, not conventional.
- Rule and typology configs are cached in-process (NodeCache, `localCacheTTL`, default 3000) **and** in Valkey. A newly loaded config version is not visible until the cache expires — activation is not instantaneous.
- **Immutability by version is the documented rule:** *"In a production environment, configurations should never be over-written and new versions of configurations should be issued to supersede older versions. A new network map must then be issued to implement the updated configuration."* The database rejects a duplicate `id`+`cfg`. Overwriting is explicitly permitted in test/PoC environments only.
- Activation is: upload new configs → upload new network map → deactivate old map → activate new map.
- The active network map travels inside the evaluation payload, so every result is traceable to the routing that produced it.

---

## 6. The Tazama 4.0.0 seed — factual baseline

From `tms-configuration-main/curl/`. This is the real starting state, and it differs materially from older two-band documentation.

### 6.1 Shape

- One message branch: `pacs.002.001.12`.
- **31 typologies**, **33 rules** + `EFRuP`.
- Rules present: 001, 002, 003, 004, 006, 007, 008, 010, 011, 016, 017, 018, 020, 021, 024, 025, 026, 027, 028, 030, 044, 045, 048, 054, 063, 074, 075, 076, 078, 083, 084, 090, 091.
- Typology id is `typology-processor` with **no `@version`**; the typology identity lives in `cfg` (`001@4.0.0`).
- Rule configs are keyed `id: "NNN@4.0.0"`, `cfg: "4.0.0"`.
- Seed files carry **no `tenantId`** — the loader must inject it to satisfy the schema and the lookup.

### 6.2 Complete seed rule configuration

All 34 entries, verbatim from `rule-configs.json`. Time-based boundaries are milliseconds throughout.

| Rule | Description | Parameters | Exits | Bands / cases |
|---|---|---|---|---|
| 001 | Derived account age — creditor | — | `.x01` | `.01` <86 400 000 · `.02` [86.4M, 2 592M) · `.03` [2 592M, 7 776M) · `.04` ≥7 776M  **= 1 / 30 / 90 days** |
| 002 | Transaction convergence — debtor | `maxQueryRange: 86 400 000` | none | `.01` <5 · `.02` ≥5 |
| 003 | Account dormancy — creditor | — | `.x01` | `.01` <7 889 229 000 · `.02` [7.89G, 31.56G) · `.03` ≥31.56G  **= 3 / 12 months** |
| 004 | Account dormancy — debtor | — | `.x01` | same 3 bands; `.02` reason *"dormant for between 3 and 12 months"* |
| 006 | Outgoing similarity — amounts | `maxQueryLimit: 3`, `tolerance: 0.1` | `.x00`, `.x01` | `.01` <2 · `.02` [2,3) · `.03` ≥3 |
| 007 | Outgoing similarity — descriptions | — | `.x00`, `.x01` | `.01` [0,1) · `.02` [1,5) · `.03` ≥5 |
| 008 | Outgoing similarity — creditor | `maxQueryLimit: 3` | `.x00`, `.x01` | `.01` <2 · `.02` [2,3) · `.03` ≥3 |
| 010 | Increased activity: volume — debtor | `evaluationIntervalTime: 2 592 000 000` | `.x00`, `.x01`, `.x03`, `.x04` | `.01` <3 · `.02` [3,5) · `.03` ≥5 |
| 011 | Increased activity: volume — creditor | `evaluationIntervalTime: 2 592 000 000` | `.x00`, `.x01`, `.x03`, `.x04` | `.01` <3 · `.02` [3,5) · `.03` ≥5 |
| 016 | Transaction convergence — creditor | `maxQueryRange: 86 400 000` | none | `.01` <5 · `.02` ≥5 |
| 017 | Transaction divergence — debtor | `maxQueryRange: 28 800 000` **(8h)** | none | `.01` <5 · `.02` ≥5 |
| 018 | Exceptionally large outgoing — debtor | `maxQueryRange: 7 889 229 000` | `.x00`, `.x01` | `.01` <1.5 · `.02` ≥1.5 |
| 020 | Large amount vs history — creditor | — *(unbounded lifetime query)* | `.x00`, `.x01`, `.x03`, `.x04` | `.01` <3 · `.02` [3,5) · `.03` ≥5 |
| 021 | Many similar amounts — creditor | `maxQueryRange: 86 400 000`, `tolerance: 0.1` | `.x00`, `.x01` | `.01` <4 · `.02` ≥4 |
| 024 | Non-commissioned mirroring — creditor | `maxQueryRange: 86 400 000`, `tolerance: 0.1` | `.x00`, `.x01`, `.x03` | `.01` <2 · `.02` ≥2 |
| 025 | Non-commissioned mirroring — debtor | `maxQueryRange: 86 400 000`, `tolerance: 0.1` | `.x00`, `.x01`, `.x03` | `.01` <2 · `.02` ≥2 |
| 026 | Commissioned mirroring — creditor | `maxQueryRange: 86 400 000`, **`commission: 0.1`**, `tolerance: 0.1` | `.x00`, `.x01`, `.x03` | `.01` <2 · `.02` ≥2 |
| 027 | Commissioned mirroring — debtor | `maxQueryRange: 86 400 000`, **`commission: 0.1`**, `tolerance: 0.1` | `.x00`, `.x01`, `.x03` | `.01` <2 · `.02` ≥2 |
| 028 | Age classification — debtor | — | none | `.01` [0,18) · `.02` [18,30) · `.03` [30,50) · `.04` ≥50 **(years)** |
| 030 | Transfer to unfamiliar creditor — debtor | — | `.x00` | `.01` <2 · `.02` [2,3) · `.03` ≥3 |
| 044 | Successful transactions from the debtor | — *(unbounded)* | none | `.01` <1 · `.02` [1,2) · `.03` [2,3) · `.04` ≥3 |
| 045 | Successful transactions to the creditor | — *(unbounded)* | none | `.01` <1 · `.02` [1,2) · `.03` [2,3) · `.04` ≥3 |
| 048 | Large amount vs history — debtor | — *(unbounded lifetime query)* | `.x00`, `.x01`, `.x03`, `.x04` | `.01` <3 · `.02` [3,5) · `.03` ≥5 |
| 054 | Benford's Law — debtor | `minimumNumberOfTransactions: 50` | `.x00`, `.x01` | `.01` <**15.507** · `.02` ≥15.507 |
| 063 | Benford's Law — creditor | `minimumNumberOfTransactions: 50` | `.x00`, `.x01` | `.01` <**15.507** · `.02` ≥15.507 |
| 074 | Distance over time from last location | `maxQueryRange: 3 600 000` | `.x01` | `.01` <5 · `.02` [5,15) · `.03` [15,50) · `.04` ≥50 |
| 075 | Distance from habitual locations | `maxRadius: 5.0` | `.x01` | `.01` <1 · `.02` [1,3) · `.03` ≥3 |
| 076 | Time since last transaction — debtor | — | `.x01` | `.01` <60 000 · `.02` [60 000, 300 000) · `.03` ≥300 000 **(ms = 60s / 5min)** |
| 078 | Transaction type | — | none | **cased**: `.01` `MP2B` · `.02` `MP2P` · `.03` `CASH` · alternative `.00` |
| 083 | Multiple accounts — debtor | — *(unbounded)* | none | `.01` <2 · `.02` ≥2 |
| 084 | Multiple accounts — creditor | — *(unbounded)* | none | `.01` <2 · `.02` ≥2 |
| 090 | Upstream transaction divergence — debtor | `maxQueryRangeUpstream: 86 400 000`, `maxQueryRangeDownstream: 86 400 000` | none | `.01` <3 · `.02` ≥3 |
| 091 | Amount vs regulatory threshold | — | **none** | `.01` <10 000 · `.02` ≥10 000 |
| EFRuP | Event-Flow Rule Processor | — | `none`, `override`, `block` | — |

**The Benford metric is chi-square.** `15.507` is the χ² critical value at 8 degrees of freedom, p = 0.05 — not MAD × 1000. The minimum-history parameter is named `minimumNumberOfTransactions`.

**EFRuP naming is internally inconsistent in Tazama.** Its rule config declares exits `none` / `override` / `block`; typology `wghts` reference `none` / `override` / `overridable-block` / `non-overridable-block`; the typology processor tests for `'block'` and `'override'`. Relevant only if EFRuP is enabled.

### 6.3 Outcome inventory by rule (derived from source)

| Outcome | Rules that can emit it |
|---|---|
| `.x00` | 006, 007, 008, 010, 011, 018, 020, 021, 024, 025, 026, 027, 030, 048, 054, 063 |
| `.x01` | 001, 003, 006, 007, 008, 010, 011, 018, 020, 021, 024, 025, 026, 027, 048, 054, 063, 076 |
| `.x03` | 010, 011, 020, 024, 025, 026, 027, 048 |
| `.x04` | 010, 011, 020, 048 |
| `.00` | 078 (via `cases.alternative`) |
| no exit conditions | 002, 016, 017, 028, 044, 045, 078, 083, 084, 090, 091 |
| `.err` | **all rules, always** |

### 6.4 Seed typology membership

| Typology | Rules |
|---|---|
| 001 | 002, 016, 017, 024, 025, 026, 027, 054, 063, 083, 084, 090 |
| 002 | 002, 010, 048, 076 |
| 003 | 010, 011, 017, 054, 063, 083, 084 |
| 005 | 002, 016, 017, 018, 020, 021, 024, 025, 026, 027, 048, 054, 063, 078, 090 |
| 010 | 006, 017, 048, 091 |
| 011 | 017, 024, 025, 026, 027, 048, 078, 090 |
| 013 | 002, 016, 017, 054, 063, 083, 084, 090 |
| 024 | 002, 008, 016, 017, 021, 024, 025, 026, 027, 054, 063, 083, 084, 090 |
| 028 | 003, 008, 010, 011, 016, 021, 024, 026, 028, 030, 048, 063, 084, **EFRuP** |
| 037 | 004, 010, 011, 016, 018, 020, 024, 026, 030, 044, 048, 074, 075, **EFRuP** |
| 044 | 001, 004, 010, 017, 018, 024, 026, 028, 030, 044, 048, 083, **EFRuP** |
| 045 | 001, 004, 010, 017, 018, 024, 026, 030, 044, 048, 078, 083, **EFRuP** |
| 047 | 017, 018, 024, 025, 026, 027, 028, 030, 045, 048, 074, 075, 076, 078, 084, **EFRuP** |
| 051 | 011, 016, 021, 063 |
| 052 | 011, 016 |
| 092 | 002, 010, 011, 016, 018, 020, 021, 024, 025, 026, 027, 048, 054, 063, 078 |
| 095 | 006, 007, 008, 024, 026, 074, 076, **EFRuP** |
| 098 | 002, 011, 016, 021, 024, 025, 026, 027, 044, 054, 063, 090 |
| 105 | 001, 003, 004, 030, 044, 045, 083, 084 |
| 107 | 002, 016, 017, 021, 054, 063, 083, 084, 090 |
| 121 | 011, 016, 020, 021, 028, 063, 090 |
| 124 | 006, 007, 011, 016, 020, 021, 024, 025, 026, 027, 078 |
| 129 | 002, 010, 011, 016, 018, 024, 025, 026, 027, 054, 063, 078, 090 |
| 137 | 091 |
| 169 | 024, 025, 026, 027, 054, 063, 091 |
| 179 | 074, 075, **EFRuP** |
| 185 | 010, 011, 018, 020, 048, **EFRuP** |
| 191 | 078 |
| 195 | 003, 011, 016, 045 |
| 214 | 001, 002, 003, 004, 010, 011, 016, 017, 018, 020, 024, 025, 026, 027, 030, 044, 045, 048, 054, 063, 090, 091 |
| 216 | 002, 010, 011, 016, 017, 054, 063, 090 |

### 6.5 Seed thresholds vs reachable maximum

| Typology | alertThreshold | interdiction | flowProc | Max score | Alert as % of max |
|---|---|---|---|---|---|
| 001 | 800 | — | — | 3200 | 25% |
| 002 | 300 | — | — | 1200 | 25% |
| 003 | 500 | — | — | 1600 | 31% |
| 005 | 1000 | — | — | 4300 | 23% |
| 010 | 300 | — | — | 1100 | 27% |
| 011 | 500 | — | — | 2800 | 18% |
| 013 | 500 | — | — | 1600 | 31% |
| 024 | 900 | — | — | 3700 | 24% |
| 028 | 900 | 1000 | yes | 3800 | 24% |
| 037 | 900 | 1000 | yes | 4000 | 23% |
| 044 | 800 | 1000 | yes | 3500 | 23% |
| 045 | 800 | 1000 | yes | 3300 | 24% |
| 047 | 1000 | 1200 | yes | 4300 | 23% |
| 051 | 300 | — | — | 900 | 33% |
| 052 | 200 | — | — | 600 | 33% |
| 092 | 1000 | — | — | 4500 | 22% |
| 095 | 500 | 600 | yes | 2600 | 19% |
| 098 | 800 | — | — | 3500 | 23% |
| 105 | 700 | — | — | 1600 | 44% |
| 107 | 600 | — | — | 1700 | 35% |
| 121 | 500 | — | — | 2100 | 24% |
| 124 | 700 | — | — | 3700 | 19% |
| 129 | 900 | — | — | 4000 | 23% |
| **137** | **200** | — | — | **100** | **200% — unreachable** |
| 169 | 500 | — | — | 2100 | 24% |
| 179 | 200 | 200 | yes | 600 | 33% |
| 185 | 300 | 400 | yes | 1800 | 17% |
| **191** | **200** | — | — | **200** | **100%** |
| 195 | 300 | — | — | 1000 | 30% |
| 214 | 1500 | — | — | 6300 | 24% |
| 216 | 500 | — | — | 2200 | 23% |

The seed's working convention is roughly **20–30% of reachable maximum**.

Two seed defects are visible in this table and are worth knowing about:

- **Typology 137** has a maximum reachable score of 100 against an alert threshold of 200. *It can never alert.* The regulatory-threshold typology is inert in stock Tazama.
- **Typology 191** ("Cash withdrawal") weights rule 078 `.01` = 200, `.02` = 100, `.03` = 0. In the seed, `.01` is **MP2B — a merchant payment**, and `.03` is `CASH`. The typology therefore alerts on merchant payments and scores cash withdrawals zero.

### 6.6 Seed weighting conventions

Measured across all 31 typologies and all **1 473** weight entries:

- Weights take exactly **four values**: `0` (984×), `100` (125×), `200` (235×), `400` (129×). All are **integers**.
- The implied tier model is 400 / 200 / 100 for a rule's top band, with the "clean" band at 0.
- **`.err` is 0 everywhere — no exceptions.** A non-zero `.err` has no precedent in the platform.
- `.x00`, `.x01` and `.x04` are 0 everywhere.
- **`.x03` is 100** for rules 010, 011, 020 and 048 — not in one reference typology but in **every typology containing them**:

  | Rule | `.x03` = 100 in typologies |
  |---|---|
  | 010 | 002, 003, 028, 037, 044, 045, 092, 129, 185, 214, 216 (11) |
  | 011 | 003, 028, 037, 051, 052, 092, 098, 121, 124, 129, 185, 195, 214, 216 (14) |
  | 020 | 005, 037, 092, 121, 124, 185, 214 (7) |
  | 048 | 002, 005, 010, 011, 028, 037, 044, 045, 047, 092, 185, 214 (12) |

  Exit conditions carrying a deterministic weight is a platform-wide convention, not an exception.
- All 31 expressions use the `Add` operator at the root. `termId` format is `v<ruleId>at<version>at<cfg>` with dots stripped.

### 6.7 The seed is outcome-complete

Checked mechanically across all 31 typologies and every member rule:

| Check | Result |
|---|---|
| Outcomes a rule can emit but the typology does not weight | **0** |
| Weights for outcomes a rule cannot emit (dead configuration) | **0** |
| Rules in `rules[]` absent from `expression` | **0** |

The completeness discipline is achievable and is already achieved. The seed therefore makes a ready-made **known-good fixture** for any completeness checker — it must pass cleanly on all 31 typologies.

### 6.8 Degenerate routes already present in the seed

Applying the test "one rule's maximum weight ≥ the typology's alert threshold" — i.e. the typology can be carried by a single rule — finds **15 instances across 9 typologies**:

| Typology | alertThreshold | Rules that fire alone |
|---|---|---|
| 002 | 300 | 010 (400), 048 (400) |
| 010 | 300 | 006 (400), 048 (400) |
| 051 | 300 | 011 (400) |
| 052 | 200 | 011 (400), 016 (200) |
| 179 | 200 | 074 (400), 075 (200) |
| 185 | 300 | 010, 011, 020, 048 (400 each) |
| 191 | 200 | 078 (200) |
| 195 | 300 | 011 (400) |

The pattern is inherent to the seed's weight/threshold relationship, not introduced by per-message scaling.

---

## 7. Quick reference

| Question | Answer |
|---|---|
| What triggers an evaluation? | `pacs.002.001.12`, by default and by seed |
| Which message types exist? | pain.001.001.11, pain.013.001.09, pacs.008.001.10, pacs.002.001.12 |
| Is `pacs.009` supported? | No — nowhere in the platform |
| Band boundary rule | `lowerLimit <= value < upperLimit`; omit a bound for open-ended |
| Does `lowerLimit: 0` bound the band? | No — falsy check treats it as unbounded |
| Does band order matter? | Yes — first match wins |
| Value in no band | `.err` |
| Cased catch-all | `cases.alternative`, mandatory, conventionally `.00` |
| Is `.err` ever in rule config? | No — add it manually to every typology |
| Unweighted outcome ⇒ | **Whole typology scores 0**, logs an error, still reports |
| Typology stalls when | A network-map rule never delivers a result (e.g. undeployed EFRuP) |
| Typology completion test | Count of results == count of rules in the network sub-map |
| Expression operators | `Add`, `Subtract`, `Multiply`, `Divide`; MathJSON, nestable |
| Rule in `rules[]` but not in `expression` | Contributes nothing |
| Threshold comparison | `>=` |
| Omit `interdictionThreshold` / `flowProcessor`? | Yes — both optional, alert-only is supported |
| Config lookup key | `(id, cfg, tenantId)` — `tenantId` mandatory |
| Active network map | `active = true`; uniqueness enforced **outside** the platform |
| Can new parameters be added to a config? | Yes, they validate — but a rule only reads keys it codes for |
| Where does behaviour live? | Hand-written SQL inside each rule processor |

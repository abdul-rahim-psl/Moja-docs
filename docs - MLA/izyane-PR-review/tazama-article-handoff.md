# Tazama Article Series: Handoff Notes

Context for continuing the "Extending Tazama: A Deep Dive" series in a new chat. Read this first, then ask for whatever files the next step needs.

---

## 1. Where things stand

| Item | Status |
|---|---|
| Part 1 (TMS, the hardcoded handlers) | Published on Medium: https://medium.com/@abdulrahimio/extending-tazama-a-deep-dive-part-1-8b255035d334 |
| Part 2 (DEMS, the ingestion layer) | **Final draft done.** Claude Doc "Extending Tazama: A Deep Dive (Part 2)": https://claude.ai/artifact/QUKh7jb9X6wMaoHCJw2iyC. 22 images embedded, plus `dems-part2-images.zip`. User is pasting it into Medium. |
| Part 3 (TCS, the config layer) | **Next.** Needs the TCS source zip (`connection-studio`, frontend + backend). |
| Website (TCS ↔ DEMS explainer, styled like abdulrahim.io) | **Later**, after Part 3. Needs screenshots of abdulrahim.io for the visual look. |

---

## 2. Working rules (how the user wants to work)

- **Step-by-step cadence. No hurries. Thorough work.** Read the real code; don't guess.
- When told "do all of it, don't ask me": keep going through every step without check-ins. **Only stop for a real blocker**, and say exactly what's needed.
- **Collect snippets section by section; render all images at the end** in one batch.
- **No background or stray agents.** Don't spawn subagents to save the user's tokens. Work only inside replies.
- **Never ask for credentials or server access.** The user declined giving DB/pgAdmin access. Work from code, ERDs and screenshots the user shares.
- **Secrets stay out.** The DEMS zip contains a real `.env`, `.env.test` and `public-key.pem`. Never open them, never let their values reach an image or the article. Render images only from `src/`, `docs/` and library code.
- **Final deliverables carry no traces of work:** no "Draft" in titles, no `[confirm]` markers, no reviewer notes, no placeholder image labels, no stray comments.
- Bugs and open questions go to the user separately (chat or a removable section), **never into the published article**.
- The user is technical (ACM chapter, FAST Karachi). Direct, peer-level tone is fine. Explain *why*, not just *what*.
- GitHub code pages can't be fetched (robots block). GitHub issues/PRs can be searched. Ask the user for a zip of public repos if file contents are needed.

---

## 3. Article style guide (derived from Part 1, applied to Part 2)

**Arc:** what exists → how it works in detail → the pattern (numbered recap) → the limitation → the new design → cliffhanger teasing the next part.

**Image rhythm (the core of the format):**
1. A short lead-in sentence ("Let's look at X").
2. One code image showing **one step**, not a whole file. Split long functions across several images.
3. An **italic caption** under the image that says *what to notice*, with the key phrase **bold**.
4. Captions get terser once a pattern repeats ("same as before"), and expand only where something differs.
5. A numbered summary after a sequence of images.

**Voice:**
- Conversational, like narrating a screen share. "We" and "our".
- Punchy fragments for emphasis ("Four handlers. Four hardcoded recipes.").
- CAPS for vocal stress, sparingly ("ONE FUNCTION TO RULE THEM ALL").
- Light humor and an emoji at turning points (Part 1: "go party 🍹… party cancelled"; Part 2 ends with "Stay tuned. 👀").
- Builds suspense: teases "the coolest part" before showing it.
- Heavy bold, so a skimmer can read only the bold text and follow the argument.
- Concrete before abstract. Teach by comparison (old vs new, handler A vs handler B).
- Quick plain-language translation right after each piece of jargon.
- Links to repos and docs inline, on first mention.

**Part 2's recurring device:** "The four steps from Part 1 are all still here, in the same order. Every step now reads its instructions from configuration instead of code." Part 3 should keep this thread: TCS is where those instructions get written.

---

## 4. Image rendering spec

Images are rendered from real source lines (not screenshots), with `render.py` (Appendix A).

- Theme: Pygments **one-dark**, card background `#282C34`, outer margin `#181A1F`, title bar `#21252B`.
- macOS-style title bar: three dots (red, yellow, green) plus the **real file path** centered.
- **Original line numbers** from the file. Non-contiguous ranges joined by a `···` row.
- Highlighted key lines: background `#3E4451` plus a 3px left bar in `#E5C07B`.
- Font: DejaVu Sans Mono 15px at 2× scale (retina). Common indentation stripped.
- JSON config snippets render without line numbers.
- File names: `NN-short-name.png`, numbered in article order.
- Library code gets a readable title, e.g. `frms-coe-lib / builders / eventHistoryBuilder.js`.

---

## 5. The mental model of the system

### 5.1 Big picture

```
TCS frontend (Editor) → TCS backend → Admin Service → tcs_config (configuration DB)
                                                          │
                                         Redis cache  ◄───┤  (preload + config-notify)
                                                          ▼
Client → POST /dems-engine/{endpoint} → DEMS → event_history DB + NATS → Event Director
```

- **TMS** (Part 1): 4 hardcoded handlers (Pain001, Pain013, Pacs008, Pacs002), each doing: extract → build `TransactionDetails` + `DataCache` → DB calls → append DataCache and forward.
- **DEMS** (Part 2): the same 4 steps, driven by config. One catch-all route.
- **TCS** (Part 3): design-time. Users define schema, mapping, functions and data model extensions; a maker-checker workflow (Editor → Approver → Exporter → Publisher) moves configs to live.
- TCS and DEMS **never call each other directly**. The contract is one row in `tcs_config`. TCS writes it through the Admin Service (`/v1/admin/tcs/config/write`); DEMS only reads it.

### 5.2 The contract: `tcs_config` (20 columns, DEMS reads 6)

| Group | Columns | Who uses it |
|---|---|---|
| Runtime contract | `schema`, `mapping`, `functions`, `related_transaction` | DEMS |
| Lookup | `endpoint_path`, `publishing_status` (`'active'`) | DEMS |
| Routing metadata | `msg_fam`, `transaction_type`, `version`, `tenant_id`, `content_type` | TCS only |
| Lifecycle | `status`, `revision` (optimistic lock), `comments` | TCS only |
| Authoring material | `payload_json`, `payload_xml` (likely sample messages; unconfirmed) | TCS only |
| Audit | `created_by`, `created_at`, `updated_at` | TCS only |

- `status` = approval workflow; `publishing_status` = live switch. "Approved" and "live" are separate decisions.
- DEMS never filters on `tenant_id`/`version`; both are embedded in the path.
- Databases: `configuration` (holds `tcs_config`), `event_history` (core graph). Host is `core-postgres` (internal Docker/K8s name). Schema SQL is in `tazama-stack/core/postgres/migration/base/` (`00-CREATE.sql`, `01-tcs-init.sql`). DEMS's own `database/init/01-create-tables.sql` is stale.

### 5.3 DEMS request flow (8 steps)

1. **URL is the identity.** `ABL101,v1,iso20022,pain.001` → `/ABL101/v1/iso20022/pain.001` (tenant/version/standard/type). Tenant must match the JWT tenant. Guards: `TazamaAuthGuard`, `RequireDemsWriteRole`.
2. **Fetch config** (`findSchemaAndMapping`): Redis first, then `tcs_config` where `endpoint_path` matches and `publishing_status='active'`. Returns `[schema, mapping, functions, related_transaction]`.
3. **Transform XML** (if XML) using the schema: it collects array-typed and string-typed paths to steer xml2js.
4. **Validate** with AJV. Failure → saved to quarantine with readable differences.
5. **Related transaction** (pacs.002): fetch the original (pacs.008) by EndToEndId, run the *original's* mapping, merge into DataCache. Comment in code: "pacs002 main 2 baar chalega processMapping".
6. **Build objects** (`processMappings`): destination prefix routes the value: `transactionDetails.X` → TransactionDetails, `redis.X` → DataCache, any other prefix → `dynamicMapping` (data model extension). Shape decides type: array destination = SPLIT, `constantValue` = CONSTANT, else concatenation (DIRECT = CONCAT of one source). The `transformation` label is never read.
7. **Call DB functions** (`executeConfiguredFunctions`): names from config, checked against an allowlist of 6 (`addAccount`, `addEntity`, `addAccountHolder`, `saveTransactionHistory`, `addDataModelTable`, `saveTransactionDetails`), then `this.databaseOperationsService[functionToCall](...)`. Params are Tazama names (`redis.dbtrAcctId`), resolved by `processSourceMapping` re-running the matching mapping rule. pacs.008 lists 3 functions, pacs.002 lists 0: no branching in code.
8. **Forward**: build Tazama payload + DataCache; save history and notify Event Director over NATS in parallel with `Promise.allSettled`.

### 5.4 Key mechanisms

- **`getValueByPath`** (`src/utils/has_nested_property.ts`): split path on dots, walk segment by segment, digits = array index, throw naming the full path if missing. ~20 lines; used by concatenation, split, dynamic mapping, function params, related transactions, data model tables. "The path becomes data."
- **Data model extension**: `dynamicMapping` bucket (up to 3 nesting levels) + `addDataModelTable` (table name + key column + data column; `dataModel` source = the bucket, else payload). Table name checked by `getSafeIdentifier` (letters, digits, underscores). Every extension table has the same 4 columns: `_key`, `data`, `tenantId`, `creDtTm` (`saveInDataModelTable` in `frms-coe-lib`).
- **Core graph** (event_history): `account`, `entity` = nodes; `account_holder`, `transaction` = edges. All inserts `ON CONFLICT DO NOTHING`. Entity ID = identifier + scheme, e.g. `+27730975224MSISDN`. pacs.002 stores source/destination reversed relative to pacs.008.
- **History tables**: the 4 known types keep dedicated tables; everything else falls to a dynamic table named after the message type.
- **config-notify**: on boot, preload every active config into Redis. `PATCH /config-notify/:id` re-reads one row and rewrites its cache entry; deactivation rewrites it as `inactive` (lookup then falls through to Postgres and rejects). Moved from NATS to REST, but the latest commit (PR #36) re-adds a log-only NATS consumer.
- **Mapping types in TCS**: DIRECT, CONCAT, SPLIT, CONSTANT, FN_CALL. DEMS has no FN_CALL handler.

### 5.5 DEMS file map

| File | What's there |
|---|---|
| `src/dems-engine/dems-engine.controller.ts` | Catch-all route (L25–38), tenant check (L45–53) |
| `src/dems-engine/dems-engine.service.ts` | `findSchemaAndMapping` (L53–84), validate/quarantine (L102–127), mapping dispatch (L185–217), allowlist + dispatch (L292–302, L366), `addDataModelTable` branch (L309, L324–349), save+notify (L400–437), `handleMessage` (~L443) |
| `src/commons/database-operations.service.ts` | DB functions, history switch (L322–341), `getSafeIdentifier` (L437–443), `saveToQuarantine` |
| `src/utils/` | `has_nested_property.ts`, `concatenation.utils.ts`, `split-value.utils.ts`, `constant-value.utils.ts`, `dynamic-mapping.utils.ts`, `mapping-sources.utils.ts`, `related-transaction.utils.ts`, `xml2js.utils.ts`, `post-processing.utils.ts`, `schema-cache.utils.ts`, `transform_endpoint.ts`, `extract_message_type.ts` |
| `src/config-notify/` | Cache preload (L28–49) and update (L51–77) |
| `docs/README.md` | Example pain.001 mapping (L143+) and functions config (L219+) |
| `node_modules/@tazama-lf/frms-coe-lib/lib/builders/eventHistoryBuilder.js` | `saveInDataModelTable` (L38–44), graph inserts |

---

## 6. Findings (bugs and open questions, kept out of the article)

Likely real bugs (1 and 2 reproduced with the project's own libraries):

1. **XML string guard never fires.** xml2js passes value processors only the field *name*, not its path, so schema string fields still get number-converted: `+27730975224` → `27730975224`, `00123` → `123`. XML and JSON can yield different entity IDs.
2. **AJV recompiles per request.** The schema is a freshly parsed object each time and AJV caches by reference: 2,000 requests → 2,001 cache entries. Slow plus unbounded memory growth.
3. **`saveToQuarantine` arguments shifted.** Correlation ID lands in the timestamp field, `correlation_id` always null, dedup can never fire; XML is quarantined after conversion, so the original is lost.
4. **Dynamic history table name** is the raw type with dots (`camt.053.001.08`), which fails the identifier check; the related lookup uses dot-stripped names (`pacs008`).
5. **Partial failure**: graph writes and Event Director notify can succeed while history fails; client gets 400, a retry duplicates the evaluation.
6. **Extension tables conflict on `_key` only** (core tables use key + tenant): cross-tenant key collisions silently dropped. Needs table definitions to confirm.
7. **Function params re-extracted and joined with `''`**: ignores delimiter, prefix, suffix and number type; can differ from the DataCache value.
8. **`saveTransactionHistory` allowlisted** but would receive raw strings; listing it in config fails. Consider removing it.
9. **`processMappings` swallows errors** and returns partial objects: a mapping to an optional field can yield an incomplete DataCache silently.
10. **config-notify direction unclear** (REST vs the re-added log-only NATS consumer on default stream `event-director`); cache status taken from request body, not the DB.
11. **First active row wins** per endpoint path: needs a uniqueness rule on active paths.

Smaller items: stale docs (`saveTransactionRelationship` not allowlisted, 2 params to 3-param `addAccount`, undefined `redis.dbtrAcctId`, README endpoint example missing tenant, README diagram shows validate-before-transform, init script creates `config` not `tcs_config`); FN_CALL unhandled; constants of `0`/`''` ignored; SPLIT and CONSTANT can't target custom objects; dynamic rules read only the first source; 4th nesting level ignored; one hardcoded pacs.002 special case (`isPacs002Transaction`); success response returns schema, full payload and mapping output.

**Still unknown:** full constraints on `tcs_config`; extension table definitions; quarantine table definition; what `payload_json`/`payload_xml` are used for; who creates extension tables (suspected: TCS `tazama-data-model` module).

---

## 7. Next steps

**Part 3 (TCS):**
1. User uploads the `connection-studio` zip. Extract, map structure (frontend `features/`, backend `modules/`).
2. Trace how a config is authored: schema creation (possibly from `payload_json`/`payload_xml`), mapping editor (the 5 types), functions, data model extensions (`tazama-data-model`).
3. Trace the lifecycle: Editor → Approver → Exporter → Publisher, `status` vs `publishing_status`, `revision`, audit log, simulation module.
4. Trace the publish path: TCS backend → Admin Service → `tcs_config` → config-notify to DEMS. Confirm the NATS `config.notification` stream vs the REST endpoint.
5. Answer the open questions above where TCS code allows.
6. Collect snippets, render at the end with `render.py`, write in the same voice. Open by recapping Part 2's cliffhanger ("who writes these instructions?").
7. Same deliverable format: Claude Doc with images embedded, no traces.

**Website (later):** two lanes (Config/TCS left, Ingestion/DEMS right) with the 4-column contract as the centerpiece; hero "Configure once. Ingest anything." with a "4 → any" stat; TMS-handlers-collapse visual; 8-step "follow one message" stepper; interactive `getValueByPath` path walker; mapping-rule playground (DIRECT = CONCAT of one); function allowlist gate. Could live at `/projects/tazama/dems` on abdulrahim.io. Build after Part 3, with site screenshots for the look.

---

## Appendix A: `render.py`

```python
"""Render code snippets as editor-style PNGs.

spec: title (file path), language, segments from real files (start/end line,
1-based, inclusive), optional highlighted line numbers, numbers on/off.
Non-contiguous segments are joined by an elision row ("···").
"""
from PIL import Image, ImageDraw, ImageFont
from pygments import lex
from pygments.lexers import get_lexer_by_name
from pygments.styles import get_style_by_name

S = 2  # render scale (retina)
FONT = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf", 15 * S)
FONT_B = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf", 15 * S)
FONT_I = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Oblique.ttf", 15 * S)
TITLE_FONT = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 13 * S)

STYLE = get_style_by_name("one-dark")
BG, OUTER, TITLE_BG = (40, 44, 52), (24, 26, 31), (33, 37, 43)
GUTTER_FG, HL_BG, HL_BAR, DEFAULT_FG = (92, 99, 112), (62, 68, 81), (229, 192, 123), (171, 178, 191)
LINE_H, PAD, TITLE_H = int(15 * S * 1.6), 22 * S, 38 * S


def hex2rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def token_style(ttype):
    while ttype not in STYLE.styles and ttype.parent:
        ttype = ttype.parent
    st = STYLE.style_for_token(ttype)
    color = hex2rgb(st["color"]) if st["color"] else DEFAULT_FG
    font = FONT_B if st["bold"] else FONT_I if st["italic"] else FONT
    return color, font


def build_rows(file_lines, segments):
    rows = []
    for i, (a, b) in enumerate(segments):
        if i > 0:
            rows.append((None, "···"))
        for n in range(a, b + 1):
            rows.append((n, file_lines[n - 1].rstrip("\n").replace("\t", "  ")))
    texts = [t for n, t in rows if n is not None and t.strip()]
    indent = min((len(t) - len(t.lstrip(" ")) for t in texts), default=0)
    return [(n, t[indent:] if n is not None else t) for n, t in rows]


def render(spec, out_path):
    with open(spec["file"], encoding="utf-8") as f:
        file_lines = f.readlines()
    rows = build_rows(file_lines, spec["segments"])
    hl = set(spec.get("hl", []))
    show_nums = spec.get("numbers", True)
    lexer = get_lexer_by_name(spec["lang"])

    char_w = FONT.getbbox("M")[2]
    max_n = max(n for n, _ in rows if n)
    num_w = (len(str(max_n)) + 2) * char_w if show_nums else 0
    code_w = max(len(t) for _, t in rows) * char_w
    card_w = max(PAD + num_w + code_w + PAD, 560 * S)
    card_h = TITLE_H + PAD // 2 + len(rows) * LINE_H + PAD
    margin = 28 * S
    img = Image.new("RGB", (card_w + 2 * margin, card_h + 2 * margin), OUTER)
    d = ImageDraw.Draw(img)

    x0, y0 = margin, margin
    d.rounded_rectangle([x0, y0, x0 + card_w, y0 + card_h], radius=12 * S, fill=BG)
    d.rounded_rectangle([x0, y0, x0 + card_w, y0 + TITLE_H], radius=12 * S, fill=TITLE_BG)
    d.rectangle([x0, y0 + TITLE_H - 12 * S, x0 + card_w, y0 + TITLE_H], fill=TITLE_BG)
    for i, c in enumerate([(255, 95, 86), (255, 189, 46), (39, 201, 63)]):
        cx, cy = x0 + 20 * S + i * 20 * S, y0 + TITLE_H // 2
        d.ellipse([cx - 6 * S, cy - 6 * S, cx + 6 * S, cy + 6 * S], fill=c)
    tw = d.textlength(spec["title"], font=TITLE_FONT)
    d.text((x0 + (card_w - tw) / 2, y0 + TITLE_H / 2), spec["title"], font=TITLE_FONT,
           fill=(150, 156, 168), anchor="lm")

    y = y0 + TITLE_H + PAD // 2
    for n, text in rows:
        if n in hl:
            d.rectangle([x0, y, x0 + card_w, y + LINE_H], fill=HL_BG)
            d.rectangle([x0, y, x0 + 3 * S, y + LINE_H], fill=HL_BAR)
        cy = y + LINE_H / 2
        if n is None:
            d.text((x0 + PAD + num_w, cy), text, font=FONT, fill=GUTTER_FG, anchor="lm")
        else:
            if show_nums:
                d.text((x0 + PAD, cy), str(n).rjust(len(str(max_n))), font=FONT,
                       fill=(HL_BAR if n in hl else GUTTER_FG), anchor="lm")
            x = x0 + PAD + num_w
            for ttype, value in lex(text, lexer):
                value = value.rstrip("\n")
                if not value:
                    continue
                color, font = token_style(ttype)
                d.text((x, cy), value, font=font, fill=color, anchor="lm")
                x += d.textlength(value, font=font)
        y += LINE_H
    img.save(out_path, optimize=True)
    return img.size
```

Usage: `render({"file": path, "title": "src/…", "lang": "typescript", "segments": [(25, 38)], "hl": [25, 38]}, "01-name.png")`. Use `"numbers": False` for JSON configs.

## Appendix B: Part 2 image list

| # | File | Shows |
|---|---|---|
| 01 | controller L25–38 | Catch-all route |
| 02 | controller L45–53 | Tenant check |
| 03 | service L53–84 | `findSchemaAndMapping` |
| 04 | config-notify L28–49 | Cache preload |
| 05 | config-notify L51–77 | Cache update |
| 06 | xml2js.utils L257–283 | Schema-aware XML transform |
| 07 | xml2js.utils L42–61 | Collect array/string fields |
| 08 | service L102–127 | Validate or quarantine |
| 09 | has_nested_property L1–9, 16–29 | `getValueByPath` |
| 10 | docs/README L157–166 | `dbtrId` CONCAT rule |
| 11 | service L185–217 | Mapping dispatch loop |
| 12 | concatenation.utils L19–39 | `handleConcatenation` |
| 13 | docs/README L222–234 | Functions config |
| 14 | service L292–302, 366 | Allowlist + dispatch by name |
| 15 | mapping-sources L14–15, 30–31, 45–55 | `processSourceMapping` |
| 16 | dynamic-mapping L11–15, 20–26 | `handleDynamicMapping` |
| 17 | service L309, 324–349 | `addDataModelTable` branch |
| 18 | db-operations L437–443 | `getSafeIdentifier` |
| 19 | eventHistoryBuilder L38–44 | `saveInDataModelTable` |
| 20 | related-transaction L46–68 | Related transaction mapping |
| 21 | service L400–404, 433–437 | Save + notify in parallel |
| 22 | db-operations L322–341 | History table switch |

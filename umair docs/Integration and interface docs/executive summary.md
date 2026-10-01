# Executive Summary — Integration & Interface Document v3.1

**What this is:** the cross-reference contract document for CCH's Tazama-based fraud detection pipeline sitting on top of the DRPP (Mojaloop switch). It ties together four component-level FSDs (Message Ingestion, Case Management, BIAR, Rules/ML Customization) into one end-to-end map of every system boundary, protocol, and payload in the pipeline.

## The Pipeline, in One Line

```
DRPP (Mojaloop) → MLA → PPA → Tazama TMS → Event Director → Rule Processors →
Typology Processor → Event Adjudicator → Alert Triage Module → CIMS (case management)
```

BIAR (data lakehouse) and the Rules Engine's configuration sit alongside this, consuming its outputs rather than sitting on the request path.

## What's New in v3.1

Only §6 (API/Endpoint Master Reference) changed. It's now grounded in **direct source-code review of seven repositories**, not just design-document prose — a stronger evidence basis than the rest of the document. Four concrete findings:

1. **TMS endpoint mismatch confirmed.** The FSDs say the PPA calls `/api/transaction/pacs.xxx` endpoints; the actual `tms-service` code implements different routes (`/v1/evaluate/iso20022/...`) and has **no `pacs.081/082/091/092/009` routes at all**. Needs reconciliation before this document leaves draft.
2. **CIMS alert-ingest endpoint now known.** `POST /ingest-alert` and NATS stream `investigation-service` are confirmed in code — but the Event Adjudicator's *publishing*-side NATS subject is still unset even in its own config template.
3. **Gold Lakehouse API is live and CIMS actively calls it** — this supersedes the earlier "detail TBC" status for Lakehouse read-back, plus reveals CIMS also uses Flowable (a BPM engine) and a Jupyter/Voila proxy, neither previously documented anywhere.
4. **The BIAR repository has no source code at all** — only a README and license file. Every BIAR interface remains proposed, not implementation-confirmed.

## The Four Issues That Matter Most Right Now

1. **Alert payload schema doesn't match the live database.** The documented Alert schema (string `alertId`, 0–1 `confidenceScore`, etc.) is materially different from the actual CIMS Prisma model (integer `alert_id`, percentage `confidence_per`, missing `alertStatus` column entirely, plus several undocumented fields). This interface may not be implementable as-is without a translation layer or a schema update.
2. **BIAR pipeline direction is disputed.** The cited BIAR FSD says ingestion is push-based (source systems own retry); a separate tech-team review claims the updated pipeline is actually pull-based and doesn't consume alerts via NATS. The document holds its cited source rather than guessing, but this needs resolving — it affects retry ownership and several catalogued interfaces.
3. **No schema exists yet for joint Fraud & AML case linking.** When one alert is both fraud and AML, CIMS creates two independent cases coordinated by a "non-case" process — but there's no defined data/API-level field connecting the two.
4. **The Event Adjudicator → CIMS hop is only half-confirmed.** The receiving endpoint is now known; the publisher's own subject name isn't set anywhere in code.

## Things Worth Knowing About How the Pipeline Handles Money and Risk

- **No live currency conversion happens inside Tazama.** An external FX provider converts currency before a transaction ever reaches DRPP — this document (and the companion Rules/ML FSD) can't specify a contract for that provider because none exists anywhere. As a workaround, **28 of the 33 fraud/AML rules** are configured per-"corridor" (source→destination currency pair) rather than using one shared reference currency.
- **Rule 091 (regulatory reporting threshold) is flagged as the single highest-priority rule in the whole register** — a missing or misconfigured per-corridor threshold could let a reportable transaction pass undetected. It has no safe default and must be supplied by COMESA before go-live.
- **The Alert Triage Module (ATM) can auto-close a case without human review.** Its build status, whether it can ever block an in-flight payment, and whether its "fail open" safety behavior (route to manual review if the ATM is down) is actually implemented are all still **unconfirmed** — three separate open items, all release-relevant.
- **A naming inconsistency exists between documents**: the Rules/ML FSD calls DRPP "Digital Retail Payment System"; every other document (including this one) calls it "Digital Retail Payment Platform." Minor, but flagged for standardization.

## Overall Assessment

The document is disciplined about not fabricating detail it can't support — genuinely unknown things (External FX Provider's mechanism, Lakehouse read-back) are explicitly left uncontracted rather than guessed at, and disagreements between sources (BIAR push/pull, TMS endpoints) are surfaced rather than silently resolved. 24 open items remain tracked; the document itself identifies BIAR staleness, the Alert schema mismatch, the endpoint-name gap, and the joint-case grouping schema as the four most load-bearing before this can move out of draft.

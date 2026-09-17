# MLA — Headlines

## From cch-mla-user-stories.md

### Epic 1 — MLA: Kafka Subscription & Audit Topic Ingestion

#### US-MLA-01 — Subscribe to the Mojaloop Audit Topic

**Description**
The MLA must consume all payment events (FX quote, quote, FX transfer, transfer — including the transfer's fulfil/final-state leg) from a single, dedicated Mojaloop audit topic — not from Mojaloop's per-action primary topics directly. This is the sole Kafka ingress point for the pipeline. There are four event types on this topic: the final-state/fulfil event is not a separate category — it's the same `PUT /transfers` fulfil callback, DFSP-signed like any other TRANSFER event (`cch-notification-dedup-user-stories.md` has the supporting evidence).

---

## From cch-pii-user-stories.md

#### US-PII-01 — Classify and Tokenize Party Identity Fields Within MLA

**Description**
Party identity fields are tokenized deterministically as part of MLA's own processing, before the event is packaged into an envelope and sent to PPA. This runs inside MLA itself — not a separately deployed pre-MLA component. PPA and everything downstream never see raw PII, the same guarantee the design has always intended; only which service performs the work has changed.

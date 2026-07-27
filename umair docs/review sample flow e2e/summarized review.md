# Summarized Review — `docs/Sample flow E2E/`

Executive summary of the full review in
`docs/umair docs/review sample flow e2e/for me_sample flow e2e.md`.

## What this capture is

18 real messages from a **live DRPP/COMESA production deployment**, captured
over HTTP in **native ISO 20022** wire format, for a **cross-border FX
transfer** (MWK → ZMW via an FX provider).

## How it compares to our PPA

| | Our PPA today | This capture |
| --- | --- | --- |
| Transport | Kafka | HTTP |
| Wire format | Plain FSPIOP JSON | Native ISO 20022 |
| Flow scope | Single-currency P2P | Cross-border FX |

Different environment on all three axes — not just extra test data for the
same thing.

## What's useful

- **8 of 18 files (the SDK-outbound layer) are not relevant at all** — a
  private DFSP-to-its-own-SDK API, a layer our Kafka-tap PPA will never see.
- **4 files are directly comparable to what we already ingest** — quote
  post/put and transfer prepare/fulfil. Good for field-name sanity-checking;
  one file's `originalIso20022QuoteResponse` is a useful side-by-side
  reference against our own `iso20022.js` output.
- **Party lookup (`GET/PUT /parties`) is new territory** — we don't consume
  any `topic-parties-*` topic today.
- **fxQuotes/fxTransfers confirm FX is real but out of scope** — useful
  design reference if FX is ever prioritized.

## Two findings worth attention

1. **A transfer-prepare message in this capture carries the payee's real
   MSISDN in `extensionList`** — something our documented assumption ("transfer
   messages carry no party data") says shouldn't be there. Doesn't invalidate
   our quote-join design, but suggests ISO-mode deployments may carry party
   data on the transfer itself as an additional, more direct enrichment
   source worth checking.
2. **This deployment runs Mojaloop's ISO 20022 wire profile — ours has never
   been tested in that mode.** Per existing research
   (`docs/iso-mode/iso20022 golden path flow.md`), our test harness runs
   FSPIOP only. What actually lands on our 5 Kafka topics when upstream
   services run in ISO mode is unverified — an open question if the PPA is
   ever meant to run against a real DRPP deployment.

## Bottom line

Nothing here breaks what we've built. The quote↔transfer party join is still
correct and necessary for our current (FSPIOP/Kafka) scope. But the capture
flags two real follow-ups: (1) consider `extensionList` as an additional
party-data source for ISO-mode deployments, and (2) confirm what our Kafka
topics actually look like if/when the PPA runs against an ISO-mode
deployment rather than just `ml-core-test-harness`.

Full detail, file-by-file table, and code excerpts: see
`review sample flow e2e/for me_sample flow e2e.md` in this folder.

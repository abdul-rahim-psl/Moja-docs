# EPIC-1 — Harness: Executive Summary

**Phase:** 1 (`docs - MLA/plan.md` §4)
**Status:** complete — exit criterion met live, recorded in `docs - MLA/plan.md` §16
**Date:** 2026-09-02

---

## What this epic is, and why it precedes every story

Every other epic in this folder implements a user story. This one implements none — like Phase 0, it has no `story.md`. It exists because COMESA's DRPP environment is not available and has no date, and the obvious cheap alternative (feeding capture files straight into compiled functions, the way the POC's `demo:replay` did) proves the pipeline can *interpret* an event correctly while proving nothing about whether it can be *trusted not to lose one*. Roughly half of MLA's durability contract — the half where failure means a payment silently vanishes before the fraud engine ever sees it — is unprovable without a real broker. Full reasoning: [`environment-simulation.md`](../../environment-simulation.md).

`plan.md` §15 sequencing point 1 states the ordering deliberately: build the verification instrument before the pipeline, so every subsequent phase has a live exit criterion from its first line of code, rather than reconstructing a verification script per session from prose — exactly what slowed the POC down.

## The purpose

**To make it possible to prove, honestly and repeatably, that the MLA does not lose, duplicate, or silently drop a real payment event — before there is an MLA to prove it about.**

Three concrete aims:

1. **Replace the topic COMESA has not given us with a faithful local one.** `capture-feeder` replays the real capture files onto a real broker with every property that matters preserved — partition assignment, per-partition order, key, headers, timestamp — and every property that does not matter (absolute offset) explicitly not reproduced, so nobody spends a day chasing a number Kafka was always going to reassign.
2. **Give the pipeline something real to fail against.** `ppa-stub` is a downstream that can be told to be slow, wrong, unreachable, or unauthenticated on command — without it, the retry/backoff, offset-not-advancing, and circuit-breaker behaviour US-MLA-06/07 require has no way to be exercised at all.
3. **Make "it still works" a mechanical check, not a claim.** Golden-file regression targets the exact failure class that hurt the POC twice — a record silently stops being forwarded and nothing errors — by diffing what actually happened against a checked-in baseline.

## What was built

- **`docker-compose.dev.yml`** — single-node Redpanda, `topic-event-audit` created at 12 partitions by a healthcheck-gated init step.
- **`tools/capture-feeder/`** — reads one or more capture files and produces every record onto the topic faithfully, with every scenario flag `environment-simulation.md` §3.1 specifies: `--speed`, `--only`, `--delay-partition`, `--duplicate`, `--drop`, `--corrupt`, `--strip-signature`, `--loop`.
- **`tools/ppa-stub/`** — a test double for PPA, split across two listeners: mTLS business endpoints (`/QUOTES`, `/FXQUOTES`, `/TRANSFERS`, `/FXTRANSFERS`) that validate against a shared ajv schema and record accepted envelopes to JSONL, and a plain-HTTP control/health listener carrying the fault-injection contract (`ok|503|500|4xx|timeout|flaky`, with `afterN`/`forMs`).
- **`src/interfaces/event-envelope.interface.ts` and `event-envelope.schema.json`** — the Event Envelope's structural shape, built once and imported directly by `ppa-stub` rather than duplicated.
- **`tools/golden/`** — produces a capture onto a scratch topic, reads it back, and diffs the read-back against the source per partition; goldens recorded for all three named captures.
- **`tools/scenario-library/`** — every one of the fifteen named scenarios from `plan.md` §4's checklist, as data plus an executor for each one the harness alone can run.
- **`tools/curate-fixtures/extract.ts`** — regenerates small, purpose-built fixture sets (classification cases, transfer/FX-quote rejections, party-lookup records) from the full export, byte-for-byte.
- **`__tests__/fixtures/`** — the full `DRPP_Kafka_E2E_Pack` and `raw_export_500.json`, committed verbatim.

`docs - MLA/EPICS/PHASE-1-Harness/file-register.md` lists every file and the reason it exists.

## The reasoning behind the decisions that were not obvious

**The golden-file mechanism diffs a topic read-back against the source, not a `ppa-stub` JSONL against a golden.** `environment-simulation.md` §3.3 describes the latter. This phase builds no envelope-construction logic — that is explicitly excluded from its checklist, as "pipeline logic that reads a real record's meaning." Manufacturing something to POST to `ppa-stub` just to have a golden to diff would have been exactly that exclusion, violated to make a checklist item look more finished than the phase's own scope allows. What was built instead proves the property the exit criterion actually names — reading the topic back and diffing against the source — and is designed to extend directly: from Phase 2 onward, once a real envelope builder exists, `ppa-stub`'s own JSONL becomes the natural next input to the same `tools/golden` machinery, not a rewrite of it.

**`ppa-stub` splits into two listeners rather than putting everything behind mTLS.** The business endpoints are what a real delivery client authenticates against, so they need genuine mTLS — including a genuinely enforced client-certificate requirement, so the handshake-failure-as-transient path (US-MLA-06, R-22) is real TLS, not a simulated error code. `/control` and the health endpoints are orchestration surface, not MLA-authenticated traffic, and the real PPA's own health endpoints are equally unauthenticated (`core-knowledge.md` §6.2) — so this split also happens to be what keeps the exit criterion's own `curl .../control` example working without a client certificate, which is a consequence of the design being right, not the reason for it.

**The envelope schema and interface were built now, in `src/`, not deferred to Phase 3.** `plan.md` lists the ajv schema as a Phase 3 deliverable; `continue - before harness.md` §3 resolves the apparent conflict explicitly — the envelope's *structural* shape does not depend on D3 (which only changes what `id` *means*), and `ppa-stub` needs a real schema to validate against now. Phase 3 reuses this file rather than rebuilding it.

**Fixtures are curated by a checked-in script, not by hand.** `tools/curate-fixtures/extract.ts` selects records from the committed 500-record export programmatically and writes a provenance file alongside every curated set, recording each record's original index, partition and offset. A hand-picked JSON blob would satisfy the checklist line just as well and be strictly worse: unreproducible, undocumented, and impossible to regenerate against a wider future capture window.

## What was proven live, versus assumed

Every claim in this epic's `plan.md` §16 entry was exercised against a real, running Redpanda on this machine, not asserted from the design: a full 500-record, 12-partition round trip with zero mismatches; all three goldens recorded and then independently re-verified clean; the golden differ shown to correctly *fail* on a deliberate mismatch; every `ppa-stub` fault mode, including a genuine TLS handshake rejection with no client certificate; three of the eight feeder scenarios run directly against the live broker. What remains unproven, honestly: `mla-restart` and `two-mla-instances` need the real MLA consumer that does not exist until Phase 2; `broker-restart`'s MLA-side offset-resume half needs the same. None of `environment-simulation.md` §4's stated limits are narrowed by this phase — they still hold exactly as written.

## What was deliberately left out

No canonical-record selection, no classification, no envelope construction, no JWS validation — `continue - before harness.md` §4 names these explicitly as not this phase's to start, and none was started. D3 (the envelope `id` scheme) remains open and untouched; nothing here was built or named around a guess at its answer.

## What this exposed that outlives it

**The snap-packaged `docker compose` plugin fails when invoked from a process tree rooted in the VS Code snap** — which is what every command run through Claude Code's Bash tool is. AppArmor's `snap.docker.docker` profile denies inheriting a file descriptor from the `code` snap and then denies the abstract-socket bind the CLI uses to talk to the compose plugin process (`journalctl -k`: `file_inherit` and `bind`, both `DENIED`, on a process tree under `/snap/code/.../code`). A plain shell not nested under VS Code is unaffected — this is not a fact about the machine as a whole, only about invocation nested under the VS Code snap. A standalone `docker-compose` v2 binary, which talks to the daemon directly and carries no snap confinement, sidesteps the clash regardless of which shell invokes it, and is now the documented workaround (`tools/README.md` §1) for any session — Claude Code's included — that runs commands nested under VS Code. `docker-compose.dev.yml` itself is ordinary and portable; only this invocation path is affected.

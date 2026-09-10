<!-- SPDX-License-Identifier: Apache-2.0 -->

# Environment Simulation — Testing Without the DRPP <!-- omit in toc -->

**Why this document exists.** COMESA is to provide an environment running the cross-border FX flow with the infrastructure behind it — Kafka, databases, the switch. We do not have it and have no date for it. Everything the MLA does begins at a Kafka topic we cannot currently read. This is the answer to that, and the authority on how the local harness is designed.

**Reading this for a non-engineering audience?** Skip to [§6 — Executive explanation](#6-executive-explanation). It states the same decision in plain terms: the situation, the two obvious options and why both are wrong, what we are doing instead, and the one thing we need from COMESA.

**Related:** [`plan.md`](plan.md) §2 summarises this document; §4 sequences building it as Phase 1.

- [1. The answer](#1-the-answer)
- [2. Why the POC's tool is not enough](#2-why-the-pocs-tool-is-not-enough)
- [3. The design](#3-the-design)
- [4. What this still cannot prove](#4-what-this-still-cannot-prove)
- [5. What we need from COMESA](#5-what-we-need-from-comesa)
- [6. Executive explanation](#6-executive-explanation)

---

## 1. The answer

*As stated, unedited.*

> **The POC's `demo:replay` bypasses Kafka entirely.** It calls the compiled pipeline functions against a file and *prints* the ADVANCE/PAUSE decision rather than acting on it. That means it cannot prove: offset resume on restart, offset held during a broker outage, restart-without-loss, offset-not-advancing during retries, breaker pause/re-probe/resume, or genuine cross-partition out-of-order arrival — roughly **half of MLA's durability contract**, and most of US-MLA-07.
>
> So: **run a real broker.** Redpanda in Docker, `topic-event-audit` with 12 partitions, plus two checked-in tools:
>
> - **`capture-feeder`** — produces records onto the topic using **explicit per-message partition assignment**, never key-hashing. That preservation is the whole point: the 500-record export spans partitions 0–11 and `04_ZMW_to_EGP_partition_split` spans 7 and 10, and key-hashing would scatter them and destroy the only real out-of-order evidence we have. Scenario flags (`--delay-partition`, `--duplicate`, `--drop`, `--corrupt`, `--strip-signature`) each map to an acceptance criterion with no other way to be exercised.
> - **`ppa-stub`** — validates envelopes against the shared ajv schema, records them to JSONL, and **injects faults on command**. Without fault injection, US-MLA-06/07 are simply untestable.
> - **Golden-file regression** on top — the POC lost `reserveFxTransfer` on every settlement leg and discarded a real rejection through the duplicate-skip path. Neither errored; neither was caught by a test. A golden file catches both.

The rest of this document is that answer in full.

---

## 2. Why the POC's tool is not enough

The POC faced the same gap and solved it with `demo:replay` — a CLI that calls the compiled pipeline functions directly against a capture file. It was genuinely valuable; its first run found a real bug. But it is worth being precise about what it does **not** exercise, because that gap is exactly what this project cannot afford.

Mapped against US-MLA-01 and US-MLA-07:

| Acceptance criterion | Provable by `demo:replay`? |
| --- | --- |
| Resume from the last committed offset on restart | ❌ |
| Offset does not advance during a broker outage | ❌ |
| Restart without data loss | ❌ |
| Offset not advanced while retries are in progress | ❌ |
| Circuit breaker pauses partition consumption, re-probes, resumes | ❌ |
| Consumer group / partition assignment behaviour | ❌ |
| Records genuinely arriving out of order across partitions | ❌ (order is file order) |
| Classification, canonical selection, envelope construction | ✅ |

**Roughly half of MLA's durability contract — the half the whole design rests on — is unprovable without a real broker.** A mock consumer cannot close this: the behaviours in question *are* Kafka's behaviours, and a mock would only assert our own assumptions back at us.

---

## 3. The design

Three components, all checked in — **tools, not scratch scripts.**

```
┌──────────────────────┐   produce, preserving        ┌───────────────┐
│  capture-feeder      │   partition + order + key    │  Redpanda     │
│  (CLI, tools/)       │ ───────────────────────────▶ │  topic-event- │
│                      │                              │  audit, 12p   │
│  captures ──▶        │                              └───────┬───────┘
└──────────────────────┘                                      │ consume
                                                              ▼
                                                    ┌───────────────────┐
                                                    │       MLA         │
                                                    │  (the real thing) │
                                                    └─────────┬─────────┘
                                                              │ POST envelope
                                                              ▼
                                                    ┌───────────────────┐
                                                    │     ppa-stub      │
                                                    │  records + faults │
                                                    └───────────────────┘
```

`capture-feeder` and `ppa-stub` sit on either side of the one component actually being tested — the real MLA, unmodified. `capture-feeder` replays a capture file onto `topic-event-audit` on a local Redpanda broker, preserving each record's partition and per-partition order exactly as captured; the MLA consumes from that topic precisely as it will consume from the real DRPP, with no code path aware that the broker is local rather than COMESA's. 

Its output — one Event Envelope per canonical record — is POSTed to `ppa-stub`, a validating test double that checks each envelope against the shared schema, records it for golden-file comparison, and can be told to fail on command. Nothing about the MLA's own logic differs between this setup and production; only what it talks to is swapped.

### 3.1 `capture-feeder` — the topic simulator

Reads a capture file and produces each record onto `topic-event-audit`. Each faithfulness rule below exists because breaking it destroys a property we need.

| Rule | Why |
| --- | --- |
| **Produce to the record's own `partitionID`, explicitly.** `kafkajs` accepts a per-message `partition`; use it. **Never** let the default partitioner hash the key. | Key-hashing would scatter records across partitions and destroy the single most valuable property of the data — that `04_ZMW_to_EGP_partition_split` and the 12-partition export contain *real* cross-partition splits. Create the topic with **12 partitions** (max `partitionID` + 1). |
| **Produce in per-partition offset order.** | Kafka guarantees ordering only within a partition; that ordering is what the MLA's identifier and correlation logic depends on. |
| **Do not attempt to reproduce absolute offsets.** Kafka assigns them. | Capture offsets run 74865–79081; a fresh topic starts at 0. Nothing in the MLA depends on the absolute value — only on monotonicity within a partition. Documented here so nobody spends a day on it. |
| **Carry `key.payload` as the message key, and flatten the capture's `headers` array onto the message.** | The key is the traceId. We assert it is *not* used for correlation (US-MLA-04); that assertion is only meaningful if the key is actually present. |
| **Carry the record's original `timestamp`.** | `kafkajs` supports a per-message timestamp, so any time-based reasoning sees real spacing. |

**Pacing and scenario controls** — what turns a replayer into a test instrument:

| Flag | Purpose | Exercises |
| --- | --- | --- |
| `--speed burst` (default) | as fast as possible | throughput, regression |
| `--speed real \| Nx` | honour inter-record gaps from `timestamp` | realistic arrival; the 500-record export spans ~58 h, so `real` is only sensible per transaction |
| `--only <transactionId>` | feed one transaction | focused debugging |
| `--delay-partition N=Xms` | hold one partition back | **forces fulfil-before-prepare deterministically** instead of hoping the natural split reproduces |
| `--duplicate <idx>` | re-emit a record | at-least-once handling, dedup |
| `--drop <operation>` | omit a record | the missing-event paths |
| `--corrupt <idx>` | emit malformed JSON | the unreadable-message skip |
| `--strip-signature <idx>` | remove `fspiop-signature` | US-MLA-05's security-alert path |
| `--loop` | repeat indefinitely | sustained load, memory behaviour |

Every flag maps to an acceptance criterion that otherwise has **no way to be exercised at all**. None is speculative.

### 3.2 `ppa-stub` — the downstream double

The MLA needs something to POST to, and PPA is a different component in a different repository. The stub is a **test double, not a re-implementation** — it must never translate, correlate, or accumulate state. It:

- Exposes `/QUOTES`, `/FXQUOTES`, `/TRANSFERS`, `/FXTRANSFERS`, `/health/live`, `/health/ready`.
- **Validates every envelope against the agreed ajv schema** and returns `400` on drift — envelope correctness is then checked continuously, not by inspection.
- **Records every envelope received, in order, to JSONL** — the input to golden-file regression.
- **Injects faults on command**: `POST /control {mode: ok|503|500|4xx|timeout|flaky, afterN, forMs}`. Without this, US-MLA-06 and US-MLA-07 are untestable — there is no other way to drive retry-with-backoff, offset-not-advancing, breaker trip, health re-probe and resume.
- **Speaks mTLS** against a local self-signed CA, so the mTLS path — including handshake-failure-as-transient (US-MLA-06's R-22 decision) — is exercised locally rather than deferred to deployment.

### 3.3 Golden-file regression

Feed a capture → collect the stub's JSONL → diff against a checked-in golden file. Any change in canonical selection, classification, identifier resolution or envelope shape surfaces as a reviewable diff.

This is cheap, and it targets the exact failure class that hurt the POC twice: **a record silently stops being forwarded and nothing fails.** `reserveFxTransfer` was dropped on every cross-border settlement leg; the transfer rejection was discarded through the same code path built to discard harmless duplicates. Neither produced an error. No test caught either. A golden file would have caught both on the next run.

---

## 4. What this still cannot prove

Stated plainly so the phase exit criteria in [`plan.md`](plan.md) stay honest:

- **Real DFSP signatures cannot be cryptographically verified.** The captures carry 286 real `fspiop-signature` headers, but we do not have COMESA's DFSP **public keys**. We can prove the verification *mechanism* by re-signing real capture bodies with a locally generated keypair and verifying against it — we cannot prove we can verify a genuine production signature until we have the keys or a JWKS endpoint. **[2026-09-09 meeting, `docs/meetings/9-sept.md`]:** George is liaising with Infotex to obtain the 19 DFSP/FXP/hub public keys and to check for a JWKS endpoint; Sam confirmed Mojaloop Connection Manager (MCM) manages key distribution at onboarding and that MLA should interface with MCM rather than hold its own synced store. None of this changes what the harness can prove until the keys are actually in hand.
- **The stub asserts the contract, not PPA's durability.** PPA's `200` is specified to mean "durably written to the write-ahead store" (US-MLA-06's assumption). The stub cannot evidence that; only the real PPA can.
- **Throughput numbers are local, not representative.** We can measure against 125 TPS peak locally, but that says nothing about production infrastructure.
- **No rebalance realism at scale.** Two local MLA instances against 12 partitions exercise group rebalance, but not the failure modes of a real multi-node cluster.
- **The captures are one window.** Everything empirical here comes from captures taken 11–13 August 2026 in one environment. Strong evidence; never a contract. Re-verification against live traffic is Phase 8 and is not optional.

---

## 5. What we need from COMESA

In priority order. The first is the highest-value unblock available to this project.

1. **The DFSP public keys, or a JWKS endpoint.** Without them, JWS verification can only ever be proven against fixtures we sign ourselves. **In progress since the 2026-09-09 meeting** — George is obtaining them via Infotex; not yet received.
2. ~~Confirmation that the per-operation canonical-record shape is a stable contract, not an artefact of this capture window.~~ **Answered [2026-09-09 meeting]** — CCH and the Mojaloop Foundation confirmed it is by design across all environments (`plan.md` §14 Q2).
3. **The environment itself** — at which point everything in §4 becomes testable and Phase 8 begins.

The full list, with the reasoning behind each, is [`plan.md`](plan.md) §14.

---

## 6. Executive explanation

*For a non-engineering audience. The same decision, without the machinery.*

### The situation

The MLA's job starts by reading a live stream of payment events from COMESA's switch. That environment has been promised but has not arrived, and we have no date. Taken literally, that means the component cannot be tested at all — everything it does begins at a stream we cannot currently read.

What we do have is **recorded real traffic**: five complete cross-border payments captured event by event, plus a wider 500-event recording that happens to contain genuine payment rejections. This is real production-shaped data, not something we invented.

### The two obvious options, and why both are wrong

**Wait for the environment.** The schedule slips by however long COMESA takes, and we learn nothing in the meantime. Unacceptable when we already hold real data.

**Test against the recordings the cheap way** — feed the files straight into the code, as the earlier proof of concept did. This is the tempting option, and it is the dangerous one. That approach never involves a real message queue, so it proves the component can *interpret* a payment event correctly, and proves nothing about whether it can be *trusted not to lose one*.

Specifically, it cannot demonstrate any of the following:

- That a restart resumes exactly where it left off, losing nothing and repeating nothing.
- That an outage downstream causes events to be safely held rather than dropped.
- That the component correctly stops, waits, and recovers when the system it feeds goes down.
- That it handles events arriving out of order — which we have *confirmed* happens in the real data.

**That is roughly half of the guarantee this component exists to provide** — and it is the half where failure means a payment silently vanishes before the fraud engine ever sees it. A missed fraud check is not a bug you find later from a stack trace; it is one you find from a loss.

### What we are doing instead

Running a **real message queue locally**, in the same containerised way the production one runs, and replaying the recorded payments through it — faithfully, so each event lands exactly where it originally did.

That single change turns the recordings from a file we read into a **working replica of COMESA's stream**. We can then test the component the same way production will exercise it, plus scenarios production will eventually produce but the recordings do not contain: the downstream system failing, restarting, timing out, or being unreachable; an event arriving twice, arriving late, arriving corrupted, or arriving unsigned.

We are also building a stand-in for the downstream system that can be told to fail on demand, and a change-detection check that flags if the component ever silently stops forwarding something. Both address failures the earlier proof of concept actually suffered: it stopped forwarding one class of event entirely, and it discarded a real payment rejection as though it were routine noise. **Neither produced an error message. Neither was caught by a test.** They were found by chance, later.

### What this costs and what it buys

The cost is a few days of engineering, once, before feature work begins. The tooling is written to be kept, not thrown away.

What it buys is that **every subsequent piece of work can be proven, the day it is written**, rather than accumulating unverified until an environment appears. When COMESA's environment does arrive, we connect to it for final confirmation — not to begin testing.

### The limits, stated honestly

This does not replace the real environment, and we are not claiming it does. Three things still require COMESA:

1. **We cannot verify a single real digital signature.** The recordings contain 286 genuine signatures, and we hold none of the corresponding public keys. We can prove our verification works using keys we generate ourselves — we cannot confirm we can validate COMESA's own until they supply the keys. **This is the single most valuable thing they can give us, and it is a small request.**
2. **We cannot confirm the downstream system's storage guarantee** — only that we talk to it correctly.
3. **Performance figures are local**, and say nothing about production infrastructure.

Everything we have learned comes from one recording window. It is strong evidence and we are building on it; it is not a contract, and it gets re-confirmed against live traffic when the environment arrives.

### The ask

1. **The DFSP public keys, or the endpoint that serves them.** Small, and it unblocks the one security control we currently cannot prove.
2. **Confirmation** that the event structure we have reverse-engineered is a stable, supported format rather than an accident of when the recording was taken.
3. **The environment**, when it is ready — at which point this harness becomes the thing that made us ready for it.

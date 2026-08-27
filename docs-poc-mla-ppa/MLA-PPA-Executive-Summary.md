# MLA & PPA — Executive Summary

**Proof of concept:** `poc-mla-ppa`
**Scope:** the two services that carry payment events from the COMESA DRPP (Mojaloop) into Tazama's fraud-detection pipeline.
**Authority:** `CCH_FSD_MessageIngestion_v4.0.md` (CCH-PL-FSD-MSGING-001) for how these two services work internally, and `Integration_and_Interface_Document_v4.0.md` for where they sit in the wider pipeline. Where this POC narrows or defers something the FSD specifies — or where the two sources disagree — it is called out explicitly below and in the technical design document.

---

## 0. Component topology

![MLA and PPA across the Mojaloop and Tazama network boundaries: the Mojaloop audit topic feeds the MLA, which POSTs Event Envelopes across the boundary to the PPA; the PPA accumulates state in ValKey, persists each event on receipt to its write-ahead/DLQ store, and POSTs ISO 20022 messages to the Tazama TMS.](images/network-boundaries.png)

The two services are independently deployable and independently scalable. The MLA addresses the PPA through a single stable service name or load balancer, never individual PPA instances. The PPA holds no state in process — every replica is interchangeable, with all shared state in ValKey and the durable store.

Ingestion ends at the Tazama TMS, but the TMS is not the end of the pipeline. Downstream of it sit the Event Director, the rule processors, the typology processor, the event adjudicator, the relay service, the Alert Triage Module, and finally CIMS. None of that is in scope here — it matters only because it sets what "delivered" means: a message the TMS accepts but silently strips fields from still fails rules five hops later.

## 1. The problem

Tazama can only detect fraud on a payment it can see in full. Mojaloop never presents a payment in full. Every action on the switch is asynchronous and split in two: an FSP sends a request, the switch returns `202 Accepted` immediately, and the real answer arrives later as a separate callback. A single cross-border payment therefore lands on Kafka as roughly nine separate events — FX quote out and back, quote out and back, FX transfer out and back, transfer out and back, and a final settlement notification — each carrying a different fragment of the picture, none of them complete on its own.

Tazama's Transaction Monitoring Service (TMS) does not accept fragments. It accepts four specific ISO 20022 messages, fully populated. Something has to sit between the two, catch every fragment, hold them together, and assemble the four messages TMS expects.

## 2. The two services

That "something" is deliberately split across two services rather than built as one, because the two halves of the job sit in different trust boundaries and fail in different ways.

### Mojaloop Adaptor (MLA) — *the collector*

Lives inside Mojaloop's network boundary. Subscribes to a **single dedicated Mojaloop audit topic** — one real-time stream carrying every payment event, separate from the switch's live transaction topics. For each event that lands it does the minimum needed to move it safely onward: confirm it is well-formed, decode the transport-level base64 wrapper some events carry, extract the handful of identifying fields, wrap it in a standard **Event Envelope**, and POST it to the PPA.

The MLA deliberately understands nothing about what a payment *means*. It does not correlate, it does not enrich, it does not translate. That restraint is the point: it is the only component with a foothold in Mojaloop's network, and keeping it semantically empty means it never needs a Tazama credential and never becomes a second place where business logic can drift.

Two adjacent components sit between the audit topic and the MLA — one that de-duplicates the switch's repeated final-state notifications, and one that tokenizes party identities before the MLA ever sees them.

**The MLA has no dead-letter queue, and does not need one.** The audit topic guarantees every message is durably written to a queryable store *before* processing continues, with 7 days of retention. So the MLA's entire recovery model is one thing: don't advance the offset. It advances only after the PPA confirms receipt. If the PPA is down, the offset simply pauses and the events stay exactly where they already were. Nothing is written anywhere else, nothing is lost, and the live payment switch is never touched — the MLA is a passive subscriber to a topic outside the payment path.

### Payment Platform Adaptor (PPA) — *the assembler*

Lives inside Tazama's network boundary. Receives envelopes from the MLA, and does the work the MLA deliberately refuses to do.

Each incoming event is classified as one of two things:

- a **trigger** — it causes exactly one outbound message to Tazama, assembled from that event plus everything already accumulated for the payment;
- an **enrichment** — it contributes data to the shared picture and produces no message of its own.

The accumulated picture for each payment lives in a short-lived cache (ValKey), keyed by the payment's identifiers. Four triggers produce four messages over the life of one payment:

| When this happens on the switch | Tazama receives |
| --- | --- |
| Quote request | `pain.001.001.11` |
| Quote callback | `pain.013.001.09` |
| Transfer prepare | `pacs.008.001.10` |
| Final settlement state, or any error | `pacs.002.001.12` |

The FX quote stage produces no message of its own — its exchange rate and converted amounts fold into the messages above, so a cross-border payment appears in Tazama as **one** transaction rather than two settlement legs. Modelling the FX leg separately would inject the FX provider into Tazama's graph as a synthetic counterparty on every cross-border payment and corrupt the velocity scoring the fraud rules depend on.

## 3. Why this shape

**Two services, not one.** The MLA can only run where Kafka is; the PPA can only run where Tazama is. One service spanning both would need a foothold and a credential in both boundaries at once.

**A payment stalling is not a payment failing.** Neither service can touch the switch. If the whole ingestion pipeline stops, payments continue to settle normally and the fraud pipeline falls behind until it is restored. Everything below follows from choosing that failure mode deliberately.

**Nothing is acknowledged before it is safe.** The PPA writes each envelope to durable storage *before* telling the MLA it has it, and the MLA advances its offset only on that acknowledgement. A crash anywhere in the chain leaves the event recoverable — either still on the audit topic, or already written down.

**A missing event is not necessarily a lost one.** The correlation cache holds each payment's accumulated state for about seventy seconds. If a payment's counterpart event hasn't arrived by then, the PPA writes that state to durable storage rather than letting it expire — and if the missing event ever shows up, even months later, it picks the state back up and finishes the job. The short cache is an optimisation, not the deadline.

**Incomplete is visible, not silent.** If a payment's enrichment data is missing when its trigger fires, the PPA still sends a structurally valid message — but flags it as *degraded* in the audit log. A degraded message and a complete one are indistinguishable at Tazama's door, so the distinction has to be recorded on the way out or it is lost for good.

**Never invent a settlement.** If the final-state event never arrives, the pipeline raises an alert. It does not synthesise the message. Telling Tazama a payment settled on the strength of a request that was merely accepted would be worse than telling it nothing.

## 4. What this POC delivers, and what it does not

**The full pipeline is built, and proven — not just written.** Every claim
below has been run against a real local Tazama TMS and a real ValKey, using
real captured payment data, not mocks or hand-written fixtures — and
re-verified live after every change, not trusted from the design alone.
That discipline is itself part of what this POC delivers: six real defects
were found this way, in durability, concurrency, and audit-trail code, that
no amount of code review or unit testing alone had caught — all six fixed
and re-verified live. The account of each one, with root cause and fix, is
in the accompanying technical design and plan documents; none were left
open.

| Area | Status |
| --- | --- |
| Core pipeline — all four Tazama message types (`pain.001`, `pain.013`, `pacs.008`, `pacs.002`), correlation, FX-leg folding, ISO 20022 translation | **Built, live-verified against a real TMS** |
| Durability — every event persisted before acknowledgement; a killed process's in-flight work is recovered by a second, independent process from disk | **Built, live-verified** (a live crash test, not a design argument) |
| Out-of-order handling — a late or early counterpart event, including the confirmed-real case of a payment split across Kafka partitions | **Built, live-verified** against that exact real scenario |
| Concurrency — multiple PPA replicas processing the same payment at once with no state clobbered | **Built, live-verified** across two independent live processes |
| Operability — end-to-end trace ids in every log line, a metrics endpoint, circuit breakers on both service-to-service hops | **Built, live-verified**, including simulated outages on each hop |
| Sustained load — 1,000+ concurrent synthetic payments over a 30-second burst | **Live-verified**, zero failures |
| Audit trail — durable, queryable, per-payment record of what happened and why (`GET /admin/audit/:key`) | **Built, live-verified** |
| PII masking — party identifiers masked with a keyed hash before they reach any log or the audit trail | **Built, live-verified** — a genuine first pass, not end-to-end (see below) |
| Two independent verification tools, checked into the repo, not throwaway scripts — replay any real capture through the live pipeline, or sustain load against it | **Built** — a reviewer can run these themselves against the same stack, not just trust this account |
| Automated test suite | **199 tests, 0 lint errors**, run against real capture data, not synthetic fixtures |

**What this POC does not deliver, stated plainly rather than left implicit:**

- **Rejected/error-path payments are unverified.** The available capture
  data contains zero rejected or aborted transactions to build or test
  that mapping against. Blocked on additional data from COMESA, not a gap
  in effort.
- **Mutual TLS on both hops, the Auth-lib→Keycloak token chain, and
  Kubernetes deployment manifests are not built.** These are deployment-
  stage concerns with no environment in this POC to validate them against
  — building them now would mean writing configuration nobody could prove
  correct, which is the opposite of how everything else here was built.
- **PII protection is a first pass, not full tokenization.** Party
  identifiers are masked before they reach logs or the audit trail, but
  the FSD's fuller upstream tokenization component is out of scope, and
  one piece of data — the ILP packet's cryptographic condition — carries
  identifiers that cannot be masked without breaking the payment itself,
  regardless of implementation effort.
- **The durable store is not sized against peak transaction volume**, and
  its backing technology is a local-filesystem stand-in pending a hosting
  decision outside this POC's scope.

Two components the FSD places upstream of the MLA — PII tokenization and
notification de-duplication on the Mojaloop side — remain out of scope
here for the same reason as above: they are infrastructure concerns that
would obscure the message flow this POC exists to prove, not gaps in what
was attempted.

**One open question from the FSD is resolved, not just addressed:**
whether the audit topic preserves each event's original identity well
enough to tell an FX transfer from a domestic one (FSD Open Item #7) — the
FSD called this the largest unknown on the collector side. Confirmed
directly against the real capture data: every event carries an explicit
stage classifier, and the discrimination the FSD worried had "nothing to
discriminate on" needs no payload inspection at all.

Field-level mapping detail, the full processing pipeline, cache keying,
failure handling, where the FSD and the IID disagree, and every open item
inherited from both — resolved or still open — are in the accompanying
technical design document.

## 5. Relationship to `ppa-prototype`

The earlier `ppa-prototype` service in this workspace proved the ingestion path end-to-end against a live stack: it consumed the real Mojaloop per-action topics, transformed transfers into `pacs.008`/`pacs.002`, and had them accepted and verified inside a running Tazama deployment. It was a single JavaScript process that read Kafka and posted to TMS directly.

Note it read the primary per-action topics directly, because no audit topic existed to read from. This POC is the first thing in this workspace to have actually observed the stream the MLA is specified to consume, and to have built against its real shape rather than an assumed one.

That prototype answered *can this work*. This POC answers *what does it look like built properly, and proven* — split across the two boundaries the FSD requires, in TypeScript, following the conventions of Tazama's own core services, with the state accumulation, degraded-message accounting, durability, concurrency safety, and audit trail the single-process prototype did not attempt, each one proven against real infrastructure rather than assumed to hold.

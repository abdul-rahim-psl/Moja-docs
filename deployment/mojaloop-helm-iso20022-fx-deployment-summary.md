# Summary — Where We Are and Why <!-- omit in toc -->

A plain-language walkthrough of this effort so far. For exact commands, **and the exact resume point**,
see the ["Current status — resume here"](mojaloop-helm-iso20022-fx-local-deployment-plan.md#current-status--resume-here)
section at the top of
[`mojaloop-helm-iso20022-fx-local-deployment-plan.md`](mojaloop-helm-iso20022-fx-local-deployment-plan.md)
in this same folder — that's the execution reference, and the two documents are kept in sync. This one is
the "why," kept short on purpose; read it first for context, then jump to that section to continue the
work.

- [1. Why this started](#1-why-this-started)
- [2. Why not your laptop](#2-why-not-your-laptop)
- [3. Is `topic-event-audit` even something we can reproduce locally?](#3-is-topic-event-audit-even-something-we-can-reproduce-locally)
- [4. Getting onto the external machine](#4-getting-onto-the-external-machine)
- [5. Installing the toolchain](#5-installing-the-toolchain)
- [6. Standing up the Kubernetes cluster — the real fight](#6-standing-up-the-kubernetes-cluster--the-real-fight)
- [7. Preparing the actual Mojaloop chart](#7-preparing-the-actual-mojaloop-chart)
- [8. Deploying — six attempts, each fixing one real thing](#8-deploying--six-attempts-each-fixing-one-real-thing)
- [9. Confirming `topic-event-audit` — the actual point of all this](#9-confirming-topic-event-audit--the-actual-point-of-all-this)
- [10. Where we are right now](#10-where-we-are-right-now)

---

## 1. Why this started

Sam's advice (in reply to your email about testing FX/ISO 20022 messages) was: don't use the
core-test-harness (CTH) you already have — it's dev/QA-oriented and doesn't support ISO 20022 mode. Use
a **Helm deployment** instead, which supports ISO mode via config and is closer to a real production
Mojaloop topology.

Separately — and this is the part that actually gives the work a deadline — there's a handover document
(`topic_event_audit_Environment_Configuration.md`, in the repo root) going back to the Mojaloop/COMESA
side, due before the **14 September** handover. Two of its open items are exactly what this build answers:

- **Item 3.4**: they want to validate their Kafka broker config against a Mojaloop instance of our own,
  running the cross-border FX flow in ISO 20022 mode, before pointing it at the real environment.
- **Item 3.5**: they want a capture of `topic-event-audit` covering error/abort/reject/timeout cases —
  what they have so far is golden-path only.

So this isn't just exploratory testing — it's the concrete work that closes out those two items.

## 2. Why not your laptop

The original plan was to run this locally, freeing RAM by stopping your Tazama Docker stack
(45 containers). Before doing that, we actually measured it: **the Tazama containers use under 1GB of
RAM combined.** The real memory pressure (~13GB) was your everyday desktop session — Firefox, VS Code,
Slack, Spotify, multiple Claude sessions — not Tazama at all. Stopping Tazama wouldn't have solved
anything.

Once that was clear, the decision was to stop trying to squeeze this onto your laptop and instead use a
dedicated external machine (`10.0.150.69`) set aside for this purpose. Simpler, no competing with your
own daily work.

## 3. Is `topic-event-audit` even something we can reproduce locally?

This was the key risk to rule out before building anything: is the Kafka topic your MLA reads
(`topic-event-audit`) a genuine, reproducible part of Mojaloop, or something bespoke to the COMESA
production environment that a generic local deployment wouldn't recreate?

Traced it all the way to source:

- `topic-event-audit` is produced by `@mojaloop/event-sdk`, a **shared library baked into every core
  Mojaloop service** (central-ledger, ml-api-adapter, ALS, quoting-service) — not custom code written for
  COMESA. It's off by default, switched on by one config toggle (`AUDIT: kafka`).
- It's already used this way in the local `ml-core-test-harness` you have — confirmed by reading its
  `docker-compose.yml` and Kafka provisioning script directly.
- It's also present, off by default, in the actual `mojaloop/helm` chart — but the chart repo ships a
  **ready-made recipe** (`local-deployment-methods/helmfile/values-mojaloop-iso20022.yaml`) that turns it
  on for every relevant service in one place.

**One important catch found along the way**: that recipe also has a "-min" variant
(`values-mojaloop-iso20022-min.yaml`) that looks like the obvious pick for a resource-constrained setup —
except it strips out the FX-provider simulator entirely, which is the one thing this whole exercise needs.
Plan uses the full file with hand-picked trims instead, not the min one.

**Bonus finding**: the chart version Sam pointed at (`v17.2.0`) turned out to match the real production
component versions almost exactly (central-ledger, ml-api-adapter, quoting-service, ALS all match the
handover doc's version table exactly) — good independent confirmation it's the right chart to use, not
just a guess.

## 4. Getting onto the external machine

Working method agreed with you: since this coding session can't directly reach `10.0.150.69`, you run
each command yourself on that machine and paste the output back — I read it and give you the next step.
Slower than automated execution, but it's the only way that actually works here, and it means every step
is visually confirmed rather than assumed.

What we learned about the machine as we went:

- **RHEL 8.10, 8 cores, 31GB RAM, 60GB disk** — comfortably enough for this workload (unlike the laptop).
- **No `docker` group exists on this host** — an unusual setup. Rather than reconfigure the Docker
  daemon (risky on a shared box we don't fully know), we chose to just run everything as `root` for the
  duration (`sudo -i`), which also sidesteps kubeconfig-ownership headaches with `kind`/`kubectl` later.
- **`/usr/local/bin` wasn't on root's PATH** — a minor quirk that made freshly-installed tools appear
  "missing" right after installing them. Fixed once, persisted in `.bashrc`.

## 5. Installing the toolchain

Installed four tools on the remote machine: `kubectl` (talks to the cluster), `kind` (runs a real
Kubernetes cluster inside Docker containers — no separate VM needed), `helm` (installs packaged
applications — "charts" — onto Kubernetes), and `helmfile` (orchestrates multiple `helm` installs
together, which is how the Mojaloop chart repo's own recommended local-deployment method works).

One snag: `helmfile`'s download URL pattern from the plan didn't work — its release files are named with
the version number baked in, not a fixed "latest" filename. Fixed by resolving the real filename via
GitHub's API first.

## 6. Standing up the Kubernetes cluster — the real fight

This is where most of the actual troubleshooting happened.

`kind create cluster` (which builds a working Kubernetes cluster as a set of Docker containers) failed
twice with a vague timeout. Rather than guess, we told it to keep the failed container around
(`--retain`) and looked inside it directly — and found the real error in `kubelet`'s own log:

> *"kubelet is configured to not run on a host using cgroup v1"*

**In plain terms**: Linux has two generations of a resource-management subsystem, cgroup v1 (older) and
cgroup v2 (current). This RHEL 8 machine runs the older one. The specific Kubernetes version this `kind`
tool defaults to installing is new enough that it now flatly refuses to start on cgroup v1 — not a
warning, a hard stop.

The fix didn't require touching the host or rebooting anything (which would've been a much bigger,
riskier change on a shared machine) — it's a one-line override in `kind`'s own config file, telling it
not to enforce that refusal. Cluster came up clean on the next attempt, and we independently verified it
(not just trusting `kind`'s success message): the node shows `Ready`, every system pod is `Running` with
zero restarts.

After that, installed the **ingress controller** — the component that lets outside traffic (like a
browser hitting `central-ledger.local`) actually reach the right thing running inside the cluster. Also
confirmed genuinely ready, not just "created."

## 7. Preparing the actual Mojaloop chart

Came back to this after an overnight gap. First thing done: checked nothing had silently broken while
away — it hadn't. The cluster had been sitting untouched for 19 hours, still perfectly healthy. What
*hadn't* happened yet was cloning the chart source itself, so that's where we picked back up.

- Cloned the real `mojaloop/helm` chart repository at `v17.2.0` — the version already confirmed to match
  production almost exactly (§3).
- Pulled in every chart's dependencies (databases, message queues, and — for one specific piece, IAM —
  an authentication stack). This needed every source those dependencies come from registered first.
  Two were missing from the first pass and only surfaced when the one chart that actually needed them
  failed — fixed each time by reading that chart's own declared dependency rather than guessing a
  "complete" list up front. Ended with all ~50 dependency sets pulled clean.
- Built our own trimmed configuration file: a copy of the full ISO20022+FX+audit-topic recipe (§3), with
  two unrelated pieces explicitly switched off — settlement-window bookkeeping and the mobile
  "request-money" flow, neither part of the FX corridor being tested. Confirmed first that neither was
  already configured elsewhere in the file, so this was a clean addition, not overriding something.
- Pointed the deployment's orchestration file at that trimmed configuration instead of the chart's plain
  default (which has none of the ISO/FX/audit-topic setup) — this is the actual switch from "generic
  Mojaloop" to "our specific test configuration."

## 8. Deploying — six attempts, each fixing one real thing

The deploy took six tries to get genuinely healthy — worth naming all six briefly, since half were
environmental noise and half were real bugs in the configuration this effort itself introduced, and it
matters which was which:

1. **Network dropped mid-pull** — images took ~20 min instead of ~2, the deploy tool's 5-minute patience
   ran out first. Not a real failure (the infrastructure had actually finished fine underneath) — just
   told it to wait longer.
2. **An unused external address timed out** — the deploy tool always double-checks every chart source it
   knows about, including one we don't actually use. Confirmed unused, removed it.
3. **A real collision**: two different pieces of central-ledger both tried to claim the same web address
   internally (one handles position updates the normal way, one handles them in efficient batches — FX
   specifically only works through the batch one). Turned off the redundant one.
4. **Another unused, likely permanently-dead external address** — same shape as #2, different repo (the
   Helm project's own long-deprecated "stable" catalog). Removed it too.
5. **The deploy tool itself said success, but checking pod-by-pod told a different story**: 4 crashing
   pods, 1 that couldn't even start, several stuck initializing. Root cause: a values file I'd earlier
   called "safe to trim" — wrongly. Two of the pieces it disabled turned out to be genuinely needed: a
   small cache the FX/simulator components use, and a database the built-in test tool needs. Re-enabled
   just those two.
6. **Deployed clean, then one more wrinkle**: three simulator pods kept restarting even after their
   dependency came up healthy — not a bug, just bad timing (they'd been retrying on a growing backoff
   schedule since before the dependency existed, so their next attempt was still minutes away even though
   waiting would have fixed it). They recovered on their own once given a little more time.

**Deploy is now fully healthy** — confirmed pod-by-pod, not just by the deploy tool's own report: 51
running, 1 completed setup job, zero pods in any other state.

## 9. Confirming `topic-event-audit` — the actual point of all this

With the switch itself healthy, the next question was the one this whole build exists to answer: does
`topic-event-audit` actually show up the way §3 said it would?

Listing every Kafka topic on the deployed broker showed all the normal per-action topics (quotes,
transfers, FX quotes, bulk, notifications) — but not the audit topic itself, since nothing had sent any
real traffic through the switch yet to trigger it. Rather than guess whether it would appear
automatically once traffic starts, tested it directly: sent one message straight to that topic name. It
appeared immediately — confirming this Kafka broker creates a topic the first time anything tries to use
it, so `topic-event-audit` needs no manual setup at all; it'll simply exist, clean, the moment real
switch traffic starts flowing. Deleted the one test message immediately after, so it doesn't sit there as
noise when the real captures are later compared against it.

**This is the answer to the open question flagged all the way back in §3** — the mechanism is real, it's
present in this deployment exactly as predicted, and it needs zero special provisioning.

## 10. Where we are right now

The cluster, the full Mojoloop switch (in ISO20022+FX+audit-topic configuration), and the audit-topic
mechanism are all confirmed working end to end — verified pod-by-pod, not just taken on the deploy
tool's word: 51 running, 1 completed setup job, zero pods in any other state. Nothing has been driven
through the switch yet — no quote, no transfer, no FX corridor traffic — so `topic-event-audit` doesn't
currently hold any real data.

**What's blocking the next step, specifically**: driving any traffic through the built-in test tool
needs knowing the right named test collection for the FX+ISO20022 corridor *inside this particular
packaging* — confirmed not to be the same label set the old test-harness used. That's the very first
thing to resolve next; the detailed plan's "Current status — resume here" section has the exact command
to try first, plus one more thing that hasn't happened yet either: pointing a browser at the built-in
test tool's web UI needs a small one-line networking step that also hasn't been run.

This document and the detailed plan are fully in sync as of this point — a new session should read this
one for the why, then go straight to the plan's resume section to continue.

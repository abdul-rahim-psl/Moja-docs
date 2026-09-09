# Summary — Where We Are and Why <!-- omit in toc -->

A plain-language walkthrough of this effort so far. For exact commands, see
[`mojaloop-helm-iso20022-fx-local-deployment-plan.md`](mojaloop-helm-iso20022-fx-local-deployment-plan.md)
in this same folder — that's the execution reference. This document is the "why," kept short on purpose.

- [1. Why this started](#1-why-this-started)
- [2. Why not your laptop](#2-why-not-your-laptop)
- [3. Is `topic-event-audit` even something we can reproduce locally?](#3-is-topic-event-audit-even-something-we-can-reproduce-locally)
- [4. Getting onto the external machine](#4-getting-onto-the-external-machine)
- [5. Installing the toolchain](#5-installing-the-toolchain)
- [6. Standing up the Kubernetes cluster — the real fight](#6-standing-up-the-kubernetes-cluster--the-real-fight)
- [7. Preparing the actual Mojaloop chart](#7-preparing-the-actual-mojaloop-chart)
- [8. Deploying — two false starts, both environmental](#8-deploying--two-false-starts-both-environmental)
- [9. Where we are right now](#9-where-we-are-right-now)

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

## 8. Deploying — two false starts, both environmental

First real deploy attempt, and two problems hit — neither one a mistake in the configuration itself.

**Attempt 1 — the network dropped mid-pull.** The remote machine's internet connection dropped while
container images were downloading. Images that should take ~2 minutes took ~20. The deploy tool gives
up waiting after 5 minutes by default, so it marked the deploy "failed" — but checking the cluster
directly told a different story: the underlying infrastructure (database, message queue, cache) had
actually finished and was healthy by then; only Mojoloop itself hadn't gotten far (one setup step done,
none of the real service pods created yet). Fix: told it to wait up to 30 minutes instead of assuming
the connection would behave better on a retry.

**Attempt 2 — an unused external address timed out.** Before touching anything else, the deploy tool
always double-checks every chart source it knows about — including one we don't actually use (our two
pieces install from local files, not a published catalog entry), and that specific address happened to
time out. Confirmed it was genuinely unused, then removed it rather than depend on something reaching a
site we don't need at all.

**Currently retrying** with both fixes in place.

## 9. Where we are right now

The cluster, its networking, and the fully-prepared Mojoloop chart are all in place. The deploy itself is
mid-retry as of this writing — first two attempts each hit an environmental snag (network, then an
unused external dependency), not a problem with the actual configuration, and both are now fixed.

**Nothing about Mojoloop is confirmed running yet** — that's the next thing to verify once this attempt
finishes. Once it is, the remaining work is exactly what §§8-10 of the detailed plan describe: confirm
`topic-event-audit` actually appears in Kafka, drive the FX corridor through it, then work through the
edge-case matrix (reject, timeout, abort, duplicate, etc.) that item 3.5 of the handover doc is asking
for.

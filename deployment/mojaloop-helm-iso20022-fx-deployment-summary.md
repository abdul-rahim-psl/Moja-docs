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
- [10. Onboarding the test participants — three hidden prerequisites](#10-onboarding-the-test-participants--three-hidden-prerequisites)
- [11. Driving the FX golden path — real traffic, most of the way through](#11-driving-the-fx-golden-path--real-traffic-most-of-the-way-through)
- [12. Checked against the real thing — and it matches](#12-checked-against-the-real-thing--and-it-matches)
- [13. First edge-case captures — one clean, one new puzzle](#13-first-edge-case-captures--one-clean-one-new-puzzle)
- [14. The puzzle, half-solved — and then half-corrected](#14-the-puzzle-half-solved--and-then-half-corrected)
- [15. Making the switch actually usable — two things nobody had documented](#15-making-the-switch-actually-usable--two-things-nobody-had-documented)
- [16. The error scenarios — all captured](#16-the-error-scenarios--all-captured)
- [17. Why these captures are worth more than the golden path](#17-why-these-captures-are-worth-more-than-the-golden-path)
- [18. Where things stand](#18-where-things-stand)
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

Working method agreed with you originally: since this coding session couldn't directly reach
`10.0.150.69`, you ran each command yourself on that machine and pasted the output back — slower than
automated execution, but it's what worked, and every step was visually confirmed rather than assumed.

**Updated, 10 September**: that "no network path" assumption turned out to be wrong. A quick SSH probe
(`ssh -o BatchMode=yes`, no password involved) reached as far as "permission denied" rather than timing
out — meaning the TCP path was there all along, it just needed credentials. Rather than have this session
ever handle your account's real password directly (the harness itself refuses that, by design), the fix
was proper key-based auth: a dedicated keypair generated in this session, its public half appended to
your account on the host (the one and only time the password was used, done by you), and from then on
this session logs in with the private key, no password ever involved again. You explicitly chose to have
this session run commands directly over that connection from here on — still one command at a time with
full output shown before the next step, just without you needing to copy-paste every line yourself.

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

## 10. Onboarding the test participants — three hidden prerequisites

Standing up the Helm chart brings up the switch's infrastructure only — it does not register any DFSPs.
Confirmed by asking the switch directly for its list of known participants and getting back just the Hub
itself. So before any traffic could flow, the payer, payee, and FX provider all had to be registered by
hand, and that turned out to need three things nowhere written down together, found only by trying each
step and reading the actual rejection:

1. The Hub itself needs a "reconciliation account" set up for a currency before any DFSP can use that
   currency at all — a one-time bootstrap step.
2. A "Settlement Model" (the rule set governing how money movement between participants gets settled)
   has to exist before a participant can hold a balance in a currency — none did. The right values were
   found in the chart's own source code, in a seed file deliberately kept around but switched off,
   specifically for situations like this one.
3. Registering a test customer (a phone number) for the payee with the lookup service needed a very
   specific header format — the deployment runs in ISO 20022 mode, and that service silently expects a
   different technical label on its requests than the plain version most documentation assumes.

All three are done now, verified directly against the switch, not just taken on faith.

## 11. Driving the FX golden path — real traffic, most of the way through

With onboarding done, the built-in test collection for this corridor (party lookup → FX quote → quote →
FX transfer → transfer) was triggered directly against the switch's real services. Two more real
wrinkles surfaced and got fixed along the way (a header-formatting conflict with the test tool's own
automatic message-format conversion, and the fact that this deployment has no single front door — each
switch component has its own separate address, so each step had to be pointed at the right one
individually).

**Result: 3 of the 5 steps — the party lookup, the FX quote, and the FX transfer — were genuinely
accepted by the real switch.** The other two (the plain quote and the plain transfer) failed for a
understood, specific reason: they need to know something from the switch's response to an earlier step,
and since nothing was set up to actually listen for and hand back that response, they got sent
incomplete.

**The actual point of this whole exercise is confirmed either way: `topic-event-audit` now exists and
holds real records from this real traffic** — visible on Kafka directly, not a manual placeholder message
like the earlier proof-of-concept check. That's the direct, positive answer to the question this build
was launched to answer, back in §3.

Asked the user directly rather than deciding alone: keep chasing a fully clean 5-step run, or move on to
the error/reject/timeout scenarios the handover document actually needs. **Chose to move on** — several
of those scenarios don't need a fully successful transfer anyway, and they more directly serve what item
3.5 is actually asking for.

## 12. Checked against the real thing — and it matches

Before going further, checked something more fundamental than "does traffic flow at all": does what
we're capturing actually *look like* the real DRPP records the Tazama/FRMS message mapping is built
against? This matters beyond this one deployment effort — PPA is what ultimately emits these messages in
production, and the mapping work is the actual core deliverable everything else here feeds into.

Compared our captures directly against a pack of five real, complete transactions captured from the
actual DRPP production/UAT environment in mid-August. **They match, field for field** — same structure,
same field names, same categorization tags, on both a quote-request record and a party-lookup record
checked side by side. The only differences found were expected ones (our test used fresh, made-up test
data, so a couple of trace fields that only get populated once a real caller's request chain reaches this
point aren't present yet) — nothing that suggests this local switch produces a *different shape* of
record than the real one.

This is real, independent confirmation, on top of confirming the mechanism exists at all: this local
deployment's captures are a genuinely valid stand-in for real DRPP traffic when it comes to building and
testing the FRMS-side message mapping.

## 13. First edge-case captures — one clean, one new puzzle

Rather than keep fighting the test tool's own collection format (which is what was blocking the last two
golden-path steps), edge-case testing switched to sending individual requests by hand, the same way the
onboarding itself was done. Three things came out of this:

- **Resending an identical request** didn't produce a distinct "duplicate" rejection at the immediate
  response level — consistent with how Mojaloop generally works (an initial "got it" response, with the
  real processing, including duplicate checks, happening a layer deeper). Whether the deeper layer
  actually caught the duplicate wasn't fully traced yet.
- **A genuine, complete "quote rejected" capture** — sending an FX quote in a currency pair the FX
  provider isn't actually configured for produced a full, real round trip: the switch accepted the
  request, rejected it internally for the right reason, and delivered a real rejection message back to
  the sender — exactly the kind of error-case evidence item 3.5 is asking for, captured cleanly.
- **A new, separate puzzle**: retrying with the *correct* currency got past that rejection and the switch
  genuinely tried to forward the request to the real FX provider simulator — but that specific attempt
  failed in an unusual way (looked like a dropped connection rather than a normal error response), while
  a manually reconstructed version of the same request to the same simulator got back an ordinary error
  message instead.

## 14. The puzzle, half-solved — and then half-corrected

Dug into this at your request, since it looked like it might be worth reporting upstream. Two things
were concluded. **One of them turned out to be wrong, and was caught the next day by testing it rather
than only reading code** — worth recording honestly, because the wrong half had already been written up
for COMESA.

**What was concluded first:**

1. *"It sends the wrong message format when forwarding to a foreign-currency-mode partner."* — the
   switch's quoting component was said to have no awareness of the newer message format at all when
   forwarding a request onward, always falling back to the older one.
2. *"When the receiving side rejects it, the real reason gets thrown away."* — the specific rejection
   reason never reaches whoever asked for the quote; they're told only "network error".

**What testing then showed.** Sending a quote in the newer format and watching what the receiving side
actually got proved point 1 wrong: the request arrived in the **correct** newer format and was accepted.
Reading the deployed component's own source then explained why — the awareness is there; what the
component actually does is **pass the caller's own format straight through** when relaying a request
onward. It never converts between the two.

So the real finding is narrower, and different in kind: **this switch does not translate between the
older and newer message formats.** A scheme running a mix of both — some participants on the old
format, some on the new — will see quote forwarding fail between them. That's still worth reporting,
but it's a design gap, not the "component is unaware of the new format" bug originally described.

**Point 2 stands, re-checked against the running system and unchanged.** And it has a close cousin found
later on a different leg: when a transfer is completed with the wrong cryptographic proof, the switch's
own logs say plainly "invalid fulfilment" — but what reaches the payer is only "generic validation
error". In both cases the specific, useful reason exists server-side and is discarded before anyone
outside can see it. That pattern — real diagnosis kept in the logs, generic message on the wire — is
the more valuable thing to raise with COMESA than either individual instance.

**Action outstanding**: the write-up added to `docs/docs - MLA/questions for comesa.md` under the
`2026-09-10` heading still describes the original, disproved version of point 1. It needs correcting
before it's sent. (The separate, older question set in that file — forwarded to Behjet on 2026-09-08 —
is a different thread and is untouched.)

## 15. Making the switch actually usable — two things nobody had documented

Before any error scenario could be exercised properly, two blockers had to be cleared. Both were found
the same way as everything else here: by trying it and reading the real rejection.

**The participants had no money.** Onboarding (§10) registered everyone correctly, and their spending
limits were set generously — but nobody had ever *deposited* anything. Every single attempted transfer
failed with "payer has insufficient liquidity", which reads like a limits problem and isn't: the limit
was fine, the account was simply empty. One deposit step per participant fixed it, and immediately
afterwards a transfer went through and settled properly. **This is a fourth setup prerequisite on top of
the three found in §10** — and without it nothing involving actual money movement can ever work.

**One of the simulators has been quietly broken since the day it was deployed.** The fake foreign-
exchange provider hands incoming requests to a helper service, and that helper has been refusing
connections since deployment. So every currency-conversion request that reached it came back as
"internal server error". The cause: on startup, the helper downloads its API definitions from GitHub —
and that download failed. The half of it that doesn't need the download started fine, so Kubernetes
reports the whole thing as healthy, and nothing anywhere surfaces that the other half is dead.

**We've since traced this all the way down, and it's fixable.** The three files it tries to download
aren't part of the software image at all — they're supplied by the deployment configuration, which
lists them as web addresses instead of actual content. So nothing needs rebuilding; the configuration
just needs the real files in place of the links. All three have now been downloaded (from this machine,
which *can* reach GitHub, unlike the server) and committed alongside the plan, at the exact versions
the configuration asks for.

Two things make this worth doing rather than working around. **One fix revives all three simulators at
once** — payer, payee and FX provider all share this same broken helper — which also clears the
separate problem from §11, where the golden path stalled because nothing was answering the switch's
callbacks. The reason nothing answered is that the things that should have answered were dead. And it's
the only way to produce records for the four currency-conversion event types that exist in the real
production reference set but in none of our captures.

The ordered steps are written up in the plan (§9.20). More generally, though: a test component that
silently half-starts when it can't reach the public internet is a genuine fragility, and would make
these simulators unusable on any properly isolated network.

Neither blocker stopped the error-scenario work, because those scenarios drive **both** sides of every
exchange by hand rather than waiting for a simulator to answer.

## 16. The error scenarios — all captured

This is what item 3.5 actually asked for, and it's now done. Each was driven against the real switch and
confirmed two ways: by the money actually moving (or correctly not moving), and by the real error
message delivered back to the payer.

First, a baseline worth stating: **a complete transfer now works end to end** — reserved, then settled,
with both participants' balances moving correctly. That's the first one in this deployment.

Then the failures, each a genuine capture:

- **Wrong cryptographic proof on completion** — reservation released, payee not paid.
- **Payee refuses the transfer** — reservation released, and the payee's own stated reason reaches the
  payer intact.
- **Spending cap exceeded** — rejected outright, balance untouched.
- **Empty account** — rejected, and notably with a *different* error than the spending-cap case. These
  two are genuinely different conditions and shouldn't be treated as one.
- **Payee never responds** — the switch's own housekeeping sweeps it up about twelve seconds after it
  expires, and tells *both* parties.
- **Expired currency-conversion quote** — see below; this one couldn't be triggered at all.

**One clean negative result.** The quoting component doesn't check expiry. Not on the request, not on
the response — a quote answered forty seconds after it expired was accepted without complaint, and so
was one that had already been cancelled. Reading its source confirms it: expiry is stored in the
database and never looked at again. This matters more than it sounds: **no "expired quote" record will
ever appear in the audit feed**, so anything watching for expiry has to watch the transfer stage
instead, where it *is* enforced.

## 17. Why these captures are worth more than the golden path

The five real production transactions we'd been checking against are all successful ones. Comparing the
new captures against them shows **six kinds of event that simply don't exist in the reference set** —
abort, timeout, validation failure, quote error, and so on. That's exactly the gap item 3.5 named.

Three of them matter directly for the message-mapping work this all feeds:

1. **A rejected transfer looks identical to an accepted one**, as far as the event's own labelling goes.
   Only the error message attached later distinguishes them. Anything sorting events by their label
   alone will quietly count failures as successes.
2. **Currency-conversion error events carry no identifiers at all** — no conversion id, no transaction
   id, nothing to join them back to the transaction they belong to. The only way to correlate them is to
   parse the id out of the URL in the record.
3. **Expiry is invisible on the quoting stage**, per §16.

Alongside that, the good news: the transfer-stage records match the real production ones **exactly**,
field for field. That extends the earlier check (§12), which had only compared the lookup and
quoting stages, and it means this local deployment remains a valid stand-in for the real thing.

## 18. Where things stand

- **Item 3.4** (validate broker config against our own instance): done and unchanged.
- **Item 3.5** (error/abort/reject/timeout captures): **done.** Eight captured scenarios, stored
  alongside the plan in the same layout as the real reference pack, with a README explaining what each
  one shows and what it means for the mapping work.

Two things are genuinely outstanding:

- **The correction described in §14** — the COMESA write-up needs reviewing before it's sent.
- **The full currency-conversion happy path**, which is now an understood, bounded piece of work rather
  than an unknown. Root cause is traced, the missing files are in hand, and the ordered steps are in the
  plan at §9.20. Completing it would also close the last gap in the shape comparison against the real
  production records — the four currency-conversion event types we've never been able to produce.

Both documents are fully in sync as of this point.

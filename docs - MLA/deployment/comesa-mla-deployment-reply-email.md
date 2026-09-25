# Reply to CCH Techops — MLA Kubernetes Deployment

**Context.** Drafted in response to the email from Oscar R. Cobar (Operations Principal, COMESA techops),
2026-09-14, asking for a values file to `kubectl apply` for deploying MLA on CCH's cluster. The open items
below are pulled directly from [`MLA-deployment-kubernetes.md`](MLA-deployment-kubernetes.md) §11 — that
document is the full analysis and plan; this is the email built from it.

**Superseded, not sent.** The [2026-09-14 meeting with George](../meetings/14-sept-deployment-meeting.md)
covered the same six questions live, the same day this draft was written. Sending it now would re-ask
questions already answered in the room and read as out of sync with that meeting. Kept here as a record
of what was drafted, not as a pending action.

---

**Subject: Re: MLA deployment on COMESA cluster — a few things we need from your side first**

Hi Oscar,

Thanks for reaching out — we're moving on this, but before we hand your team something to `kubectl apply`, a few things need pinning down so we don't hand over manifests that point at the wrong place or fail on your cluster.

**One architecture clarification first:** MLA doesn't talk to the Tazama API directly. It talks to **PPA**, a separate service on our side that receives from MLA, translates into ISO 20022, and is the one that dispatches into Tazama. So the "Kafka" and "downstream" variables you'll need are Kafka (your side, local to your cluster) and **PPA's endpoint** (ours, reachable from your cluster over the VPN we've discussed) — not a Tazama address directly. Wanted to flag that now so nothing gets provisioned against the wrong target.

On format: your email mentions both a "values file" and `kubectl apply -f` — those are two different things (a values file configures a Helm chart via `helm install`; `kubectl apply -f` takes plain Kubernetes manifests directly). We're preparing plain manifests (Deployment/Service/ConfigMap/Secret) since that matches the `kubectl apply -f` instruction literally, unless your team is already running Helm and would rather have a chart — let us know either way.

To finish the manifests and hand over a real, working deployment package, we need the following from your side:

1. **Registry access** — can your cluster's nodes pull from a registry we push the MLA image to (Docker Hub, GHCR, our GitLab registry), or do you need the image delivered into your own registry? Either way works, we just need to know which so we set the right `imagePullSecret` (or none).

2. **Kafka broker address** — the real broker address reachable from where MLA will run. On the topic itself, we already have `topic-event-audit`, 12 partitions, 7-day / 250MB retention on record — please just confirm those still hold for the deployment target, or flag if anything's different.

3. **A dedicated Kafka consumer group ID for MLA** — this needs to be a group name that isn't shared with or reused from any existing DRPP-internal consumer, to avoid MLA accidentally stealing partition assignments from a live payment-path handler.

4. **The PPA endpoint over the VPN** — confirming the point-to-point VPN link we've sketched out is still the intended path, and the address MLA should reach PPA at once it's live.

5. **mTLS certificate provisioning for the MLA→PPA hop** — does your cluster run something like cert-manager we can integrate with, or should we generate a certificate/key pair for MLA and hand it to you to mount as a Kubernetes Secret?

6. **Metrics/health scraping** — will your own monitoring pull MLA's `/metrics` and health endpoints in-cluster, or does that need to reach back across the VPN to our side?

Once we have answers on these, we can turn the manifests around quickly — most of the deployment (image, Deployment/Service definitions, resource sizing, health probes) is already built and just needs your environment's specifics dropped in.

Happy to jump on a call if that's faster than back-and-forth over email.

Best,
[Your name]

---

**Deliberately left out.** DFSP key delivery and the MCM (Mojaloop Connection Manager) question — both
are already being tracked with Infotex/Mojoloop Foundation per the 2026-09-09 meeting
(`docs/docs - MLA/meetings and emails/9-sept.md`), not new asks that belong on CCH techops' plate. Raising them here would
muddy who owns what.

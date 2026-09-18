# George Murage's reply — 2026-09-15

**Context.** George Murage (COMESA/CCH techops) replied in writing to the six open items in
[`MLA-deployment-kubernetes.md`](MLA-deployment-kubernetes.md) §11 and the [14-Sept meeting](../meetings/14-sept-deployment-meeting.md).
Two documents were attached, saved alongside this one:
[`connectivity-options.md`](connectivity-options.md) and
[`certificate-setup-proposal.md`](certificate-setup-proposal.md). The resulting decisions are recorded
in `MLA-deployment-kubernetes.md`'s own 15 September update; this file is the raw source.

---

> Please see my responses below;
>
> 1. KAFKA_BROKERS — your environment's actual values (including the pending VPN IPs), so we can
> finalize the config for your side. I propose you externalise these settings in your manifests to a
> configmap that we can then create. The same would apply to the secrets the MLA needs. Additionally,
> could you consider using IP allow-listing / whitelisting instead of an IPSEC VPN connection? A short
> note comparing the two options can be found link below.
>
> 2. JWS key store and PII secret — we understand this is currently pending input from Infitx and a
> decision on the rotation-trigger approach. Let us know once that's unblocked. I am still working on how
> to implement this. Ordinarily this is provided to payment managers as they connect to the hub but the
> MLA is different and requires different treatment. I propose we disable signature validation for now.
> The hub validates all signatures anyway so the chance of a message arriving at the MLA with an invalid
> signature is nil.
>
> 3. A neutral, middle-ground cert-manager trusted by both DRPP and Paysyslabs environments. Please find
> here proposal on how to set this up. The proposal is to use an ingress gateway on the Paysys side to
> terminate the MLA <-> PPA mTLS and also sign the certificates in use. Please review.
>
> 4. Access to your Github repository for publishing the MLA image. This request is not clear. Since the
> image will change as the testing progresses it may be easier for us to pull it from the Paysys end and
> only mirror the source code to our GitHub instance once the build has stabilised or been finalised. We
> can pull the image pinned to a specific sha-256 digest pointing to a specific build and update that as
> the MLA build changes.
>
> Please review and let me know how best to proceed.
>
> Kind regards
> George Murage

# MLA to PPA interconnect — connectivity options

**Source.** Shared by George Murage (CCH) on 2026-09-15 — see
[`george-reply-2026-09-15.md`](george-reply-2026-09-15.md) point 1. Original: a Google Doc titled "DRPP
TAZAMA Interconnect Connectivity Options". Reproduced here as the source of record; the decision it fed
into is in [`MLA-deployment-kubernetes.md`](MLA-deployment-kubernetes.md)'s 15 September update.

---

MLA posts transaction events from the DRPP Region cluster to PPA in the Paysys data centre, over HTTPS
with mutual TLS, and advances its Kafka offset only on PPA's payload-level acknowledgement. Two options
are proposed for carrying that link. The certificate arrangement is covered separately
([`certificate-setup-proposal.md`](certificate-setup-proposal.md)) and is the same under either.

## The same under both

- One public endpoint, not two. MLA is always the client; only the Paysys side needs a reachable address.
- MLA stays private. It keeps a private address either way, behind network address translation.
- A predictable egress address is needed either way. For allow-listing it is the control; for IPsec it
  identifies the initiator.
- Mutual TLS is the authentication control. Neither the tunnel nor the allow-list authenticates the
  counterparty.

## How they compare

| | Option A — IPsec site-to-site | Option B — public endpoint, allow-listed |
| --- | --- | --- |
| Public exposure | None; unreachable outside the tunnel | Gateway discoverable and scanned |
| Setup | Network onboarding by both teams first | Configuration only; no network build |
| Operating burden | Tunnel, keepalives, rekeying to monitor | None beyond the gateway itself |
| Change at migration | Rebuilt end to end | One allow-list entry updated |
| Removal at close | Decommissioned both sides | Entry and listener removed |
| Main risk | Private address overlap; idle-timeout stalls | Shared egress address admits more than DRPP |

## Understanding the trade-offs

Option A removes the endpoint from the public internet at the cost of a network build before testing can
start.

Option B starts immediately and avoids RFC1918 IP addressing overlap problems. However, the gateway is
exposed to the internet. The allow-list / white-list limits who can reach the gateway. In addition, the
ingress gateway implements mTLS as the control behind this with SAN certificate pinning to prevent
egress traffic with the same IP address as the MLA for actually sending anything to the PPA.

---

COMESA Clearing House | MLA – PPA Integration | Confidential

# MLA to PPA Interconnect — Certificate Setup

**Source.** Shared by George Murage (CCH) on 2026-09-15 — see
[`george-reply-2026-09-15.md`](george-reply-2026-09-15.md) point 3. Original: a Google Doc titled "DRPP
TAZAMA Interconnect Certificate Setup Proposal". Reproduced here as the source of record; the decision it
fed into is in [`MLA-deployment-kubernetes.md`](MLA-deployment-kubernetes.md)'s 15 September update.

---

This note describes the certificate arrangement for the mutually authenticated link between the Mojaloop
adapter (MLA), deployed in the DRPP Region cluster, and the TAZAMA Payment Platform Adapter (PPA) in
Paysys data centre. It covers what certificates exist, who issues them, what each side trusts, and how
the material is renewed and revoked.

## 1. Scope of the arrangement

MLA posts transaction events to PPA over HTTPS with mutual TLS. PPA returns a payload-level
acknowledgement on the same connection, and MLA advances its Kafka offset only on that acknowledgement.
The connection is always initiated by MLA; no service in the DRPP environment is reachable from the
Paysys DC.

## 2. Trust model

Three certificate authorities are in play, and only one of them crosses the boundary between the two
environments.

| Authority | Scope | Crosses the boundary |
| --- | --- | --- |
| DRPP mesh CA | Workload identity inside the DRPP Region cluster. Presented by the service mesh on MLA's behalf for in-cluster traffic. | No |
| Interconnect CA | Issues the MLA client certificate and the gateway server certificate. Used for this link and nothing else. | Yes — the only one |
| TAZAMA mesh CA | Workload identity inside the implementor's cluster, including PPA's calls to the other TAZAMA services. | No |

**Termination at the gateway.** The mutual TLS terminates at a dedicated ingress gateway in front of
PPA, not at PPA itself. The gateway verifies MLA's certificate, then passes the request into the Paysys
K8s mesh, where it reaches PPA over PPA's existing mesh identity. PPA's own trust store is not modified.
This is what keeps the interconnect CA out of the TAZAMA mesh: were the interconnect CA added to PPA's
trust bundle directly, it would become valid for every one of PPA's mutual-TLS peers rather than for this
one client. The terminating gateway can be an Envoy, Nginx or Istio Ingress Gateway (which may be the
easiest to use if Istio is already in use in the cluster).

**A dedicated issuing CA.** The interconnect CA is operated by Paysys alongside the gateway, but it must
be a dedicated issuing authority created for this purpose — not the CA that signs the TAZAMA mesh in the
Paysys DC.

## 3. Certificate inventory

Mutual TLS is two independent verifications, each with its own trust anchor. Four artefacts are
required.

| Artefact | Held by | Purpose |
| --- | --- | --- |
| Client certificate and key | MLA | Presented by MLA when it opens the connection. |
| Interconnect CA root | Gateway client trust bundle | Verifies the client certificate MLA presents. |
| Server certificate and key | Ingress gateway | Presented by the gateway to MLA. |
| Interconnect CA root | MLA application trust store | Verifies the server certificate the gateway presents. |

Because a single interconnect CA signs both certificates, each side holds the same root. That root is
used only for this link, so adding it to either trust store admits nothing beyond the counterparty.

**Identity pinning.** Each side verifies the counterparty's identity, not only its issuer. The gateway
accepts a client certificate only where the Subject Alternative Name matches the single expected MLA
identity. MLA verifies the gateway's certificate against the hostname it connected to, which must appear
in that certificate's Subject Alternative Name. This keeps things simple and focused on the interconnect
only.

## 4. Issuance

- The names are agreed first: the hostname MLA connects to, and the identity MLA presents. Both are
  fixed before any certificate is issued, since each appears in a Subject Alternative Name.
- Paysys creates the dedicated interconnect CA and publishes its root certificate to CCH.
- MLA generates a key pair and a certificate signing request (CSR). The private key does not leave the
  DRPP environment.
- The certificate signing request is sent to Paysys, signed by the interconnect CA, and the certificate
  returned.
- The gateway is issued a server certificate from the same authority, carrying the agreed hostname.
- The interconnect CA root is installed in the gateway's client trust bundle for this listener only, and
  in MLA's application trust store for this destination only.
- The gateway listener is configured to require a client certificate, to check the expected Subject
  Alternative Name, and to accept only the single path and method MLA calls.

**Where the client key sits.** Two placements are workable. MLA holds the key and originates the
connection itself, which is the simpler arrangement. Alternatively an egress gateway in the DRPP cluster
originates the mutual TLS on MLA's behalf, which keeps the cross-domain key out of the application and
provides the stable source address Paysys needs for any network allow-listing. For simplicity it is
easier for the MLA to hold the key itself.

## 5. Lifecycle

**Renewal.** Certificate lifetime and a named renewal owner on each side are agreed at issuance. A
longer certificate lifetime may be preferred to avoid renewal before the completion of testing in the
Paysys test environment. If this is not possible, a renewal process needs to be agreed beforehand.

**Revocation.** Revocation is by removing the interconnect CA root from the relevant trust bundle rather
than by revocation lists. Because the authority is single-purpose, removing it terminates this link and
affects nothing else on either platform.

**Removal.** When the TAZAMA Staging environment is set up inside the DRPP estate, the gateway listener,
the interconnect CA and both certificates are retired together. No change to either estate's internal
public-key infrastructure is required to remove them, because none was made to create them.

## 6. Parameters to agree

- The hostname MLA connects to, and how it resolves across the network path.
- The Subject Alternative Name that identifies MLA, and the value the gateway pins to.
- Certificate lifetimes, and the renewal owner on each side.
- Minimum TLS version and the permitted cipher suites.
- Key type and size, and the signature algorithm.
- The path and method the gateway listener permits.

## 7. Other considerations

- MLA's client identity on this link is issued by a certificate authority held by Paysys. That is
  proportionate for a temporary link for testing, but it means Paysys can issue further certificates the
  gateway will accept. Pinning the Subject Alternative Name limits what that would achieve.
- If a neutral CA is preferred, this can also be discussed — either a CA in the DRPP environment or a
  public CA. The mechanics in this note remain unchanged.

---

COMESA Clearing House | MLA – PPA Integration | Confidential

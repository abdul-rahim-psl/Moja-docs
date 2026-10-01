# MLA → PPA mTLS alignment (COMESA / DRPP)
## Channel: secure chat set up by Oscar Cobar (COMESA/DRPP side), with George Murage (Altiora), Abdul Rahim and Muhammad Umair (Paysys)
Dates: Fri 25 Sep 2026 – Mon 28 Sep 2026
## Related PR: https://github.com/psl-izyane-cch-frms/cch-mla/pull/1

Context
- cch-mla is the MLA application that Paysys provides. It's a Tazama component hosted on the Transactional Switch side.
- Traffic is one-way: cch-mla starts every request to Tazama PPA. PPA replies synchronously on the same connection and never calls MLA.
- TLS terminates on our (Tazama) ingress gateway, at mla-interconnect.paysyslabs.com.
- Oscar has no ingress or egress gateway on the Switch side. cch-mla has to handle the mTLS connection itself.


# Decisions agreed
| # | Question | Decision |
|---|---|---|
| 1 | One-way TLS or mutual TLS | Mutual TLS |
| 2 | Dual CA or single CA | Single CA |
| 3 | Who hosts the CA and is accountable | COMESA / DRPP side (Oscar) |
| 4 | Where mTLS terminates | Tazama ingress gateway (our side) |
| 5 | Who handles mTLS on the client side | The cch-mla app itself, through configuration. Confirmed by Abdul Rahim. |

## Certificate details
Our server certificate (presented by our ingress; cch-mla validates it)

- CN = mla-interconnect.paysyslabs.com
- SAN = DNS:mla-interconnect.paysyslabs.com (needed, because modern clients check SAN, not CN)
- O = DRPP
- C = ZM
- Signed by the COMESA/DRPP CA
--> cch-mla client certificate (presented by cch-mla; our ingress validates it)

- CN: whatever the client sets. We don't require a specific value, but asked to be told what it is so we can allowlist it.
- Signed by the COMESA/DRPP CA

## Status (as of 28 Sep 2026)
CN/O/C values sent to Oscar. The actual CSR file hasn't been generated or sent yet.
Oscar is preparing the CA bundle and will send it over the secure channel.

## Open items / next steps
1. Receive the CA bundle from Oscar (root and intermediates, public certificates only).

2. Generate our server CSR, keeping the private key on the gateway host, and send only the .csr file:

    openssl req -new -newkey rsa:2048 -nodes \
    -keyout mla-interconnect.key -out mla-interconnect.csr \
    -subj "/C=ZM/O=DRPP/CN=mla-interconnect.paysyslabs.com" \
    -addext "subjectAltName=DNS:mla-interconnect.paysyslabs.com"
    Confirm key type and size with Oscar first.

3. cch-mla client certificate: agree who generates the key and CSR. cch-mla is our app but runs on the Switch side, so the key should be generated where cch-mla runs. Agree the CN (for example cch-mla) and send it to the DRPP CA for signing.

4. Configure cch-mla: client certificate and key, the CA bundle to trust our server certificate, and the target https://mla-interconnect.paysyslabs.com/others/.... See PR #1.

Also find out which host runs the "UAT Nginx". It isn't on the PPA VM, 10.0.115.186.

5. Ingress config (on whichever layer terminates TLS): verify client certificates against the DRPP CA, enforce on /others only, optionally allowlist the cch-mla CN, and restrict origin access.
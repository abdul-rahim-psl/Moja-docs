# George's reply — 2026-09-20

**Context.** George's written follow-up on the two items Paysys owed him: the PPA hostname/IP for the
whitelisting arrangement, and the PKI material (`ca.crt`/`client.crt`/`client.key`) plus TLS
version/cipher-suite alignment for the MLA↔PPA mTLS hop. Confirms whitelisting (not a VPN) as the agreed
connectivity mechanism and that DRPP's own source IP has already been shared. The resulting updates are
recorded in [`MLA-deployment-kubernetes.md`](MLA-deployment-kubernetes.md) §7, §8 item 1, and §11 Q4/Q5;
this file is the raw source.

---

> Hi Behjet,
>
> Thanks for the response.
>
> On the first item please double-check with your network team, this seems to be an internal IP address
> not one that is reachable over the internet.
>
> On the PKI material I have looked at this again. There is nothing sensitive in the ca.crt and
> client.crt. Those can be shared directly with me on email or slack. The issue is the private key -
> client.key
> I propose that once we receive the CA.crt and client.crt we generate a private key on this side and a
> certificate signing request (CSR) using the details in the client.crt. We can share the CSR on email or
> slack as it contains no sensitive information and your CA would sign it and produce another client.crt
> (or another certificate based on the newly generated private key) that can then be shared with us. That
> way the private key never leaves the MLA environment. For mTLS to work the paysys side only needs the
> CA.crt and client.crt and this is the recommended way to ensuring the private key never travels outside
> of the app environment that needs to use it.
>
> Thanks for confirming the TLS version - 1.2/1.3 works ok for us - and that we can choose any OpenSSL
> supported cipher suites.
>
> Please review item 1 and 2 so that we can proceed.
>
> Kind regards
> George

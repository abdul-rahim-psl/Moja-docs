Subject: MLA image update — DFSP signature validation removed, new image on GHCR

Hi George,

Quick update on the cch-mla image ahead of your team's deployment.

What changed:
we've removed MLA's own DFSP JWS signature validation. It was confirmed that every message on topic-event-audit is already validated by the switch before it reaches the topic, and that the topic sits inside the same trust boundary as the switch's own validation so a second validation inside MLA wasn't adding protection.

What this means for your deployment:
A new image is built and already pushed to GHCR, digest-pinned in the manifest you have (ghcr.io/psl-izyane-cch-frms/cch-mla, tag 1e7610e).
No action needed from you or techops beyond what was already pending — whenever kubectl apply runs against the manifest package, it will pull this image automatically. Nothing about the apply process itself changes.

The cch-mla-jws-keys Secret is no longer required.

Everything else (Kafka config, PPA connectivity, PII secret) is unchanged.

We tested the new image standalone before pushing and confirmed it boots clean with no signature-related dependencies. Happy to walk through anything if useful.

Let me know if you have any questions, or if there's anything blocking techops from applying the manifests on your end that we can help unblock.

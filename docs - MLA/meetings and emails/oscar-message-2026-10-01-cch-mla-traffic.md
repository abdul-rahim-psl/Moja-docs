# Oscar Cobar — CCH's deployed `cch-mla` is sending traffic (relayed 2026-10-01)

**Context.** A message from Oscar R. Cobar (COMESA/CCH techops lead), relayed verbatim by the user on
2026-10-01. The user's accompanying statement, from the same exchange: CCH has `cch-mla` deployed on its own
cluster and has sent traffic to the Paysys ingress gateway, `mla-interconnect.paysyslabs.com`. Oscar's evidence, which followed, is
reproduced below: six `Forwarded` log lines from CCH's MLA pod. `plan.md` §16's [2026-10-01] verification
entry records how they were checked against PPA's write-ahead store. This file is the raw source.

---

> Thank you
> I provided relevant evidences that cch-mla is sending information to PPA successfully
>
> From our angle this task is successfully completed for this testing stage however I would like to get
> your confirmation that PPA is seeing that information for double checking

---

**Oscar's evidence, as sent.** His note: "I have to bundle the self-signed with the trusted CA now i can see
forwarded events". A follow-up: "Please confirm because you should be seeing traffic on PPA side as the
evidences sent yesterday (msg sent on, Tue 12:34 PM)", Tuesday being 2026-09-29.

```
ubuntu@region-stg-master-1:~/MLA-deployment/cch-mla-git/deploy/kubernetes$ kubectl -n mla logs cch-mla-fd5c4b744-7x275 | grep Forwarded
{"level":30,"time":1790624812702,"pid":1,"hostname":"cch-mla-fd5c4b744-7x275","name":"cch-mla","correlationId":"a9820110-9eb2-46a2-abd8-fbc4cd9f9ebb","eventType":"FXQUOTE","serviceOperation":"ingestion.ppa-delivery","msg":"Forwarded FXQUOTE (id=01M3MDN2CZ1SBJD61AGT9HWFN8) at partition 1 offset 85154"}
{"level":30,"time":1790624812708,"pid":1,"hostname":"cch-mla-fd5c4b744-7x275","name":"cch-mla","correlationId":"1eaef322-b723-445f-9f46-8969de8bc3bc","eventType":"QUOTE","serviceOperation":"ingestion.ppa-delivery","msg":"Forwarded QUOTE (id=01M3MQYJ2Z83R4R13B8A5FKPSK) at partition 3 offset 85379"}
{"level":30,"time":1790624812713,"pid":1,"hostname":"cch-mla-fd5c4b744-7x275","name":"cch-mla","correlationId":"5e1fbf6f-0a0f-4c6f-9809-ffe5d7a352e2","eventType":"TRANSFER","serviceOperation":"ingestion.ppa-delivery","msg":"Forwarded TRANSFER (id=01M3MDMVNV6J2SADGGJSA74P8E) at partition 0 offset 86134"}
{"level":30,"time":1790624812715,"pid":1,"hostname":"cch-mla-fd5c4b744-7x275","name":"cch-mla","correlationId":"1893e470-d2d6-4982-9214-11cb956b00bf","eventType":"FXQUOTE","serviceOperation":"ingestion.ppa-delivery","msg":"Forwarded FXQUOTE (id=01M3MQYBVD8JVTTD4YC1YSAQZ9) at partition 8 offset 86002"}
{"level":30,"time":1790624812721,"pid":1,"hostname":"cch-mla-fd5c4b744-7x275","name":"cch-mla","correlationId":"eabdd415-cc7d-49c5-9e85-7cb5df7a0452","eventType":"QUOTE","serviceOperation":"ingestion.ppa-delivery","msg":"Forwarded QUOTE (id=01M3MDN6SPTKG6TQH767W7EF4C) at partition 9 offset 84048"}
{"level":30,"time":1790624812736,"pid":1,"hostname":"cch-mla-fd5c4b744-7x275","name":"cch-mla","correlationId":"ce40deeb-e800-4dae-b449-7cfc4763381c","eventType":"FXTRANSFER","serviceOperation":"ingestion.ppa-delivery","msg":"Forwarded FXTRANSFER (id=01M3MDMZEJQEGE8W7VVXWDSW4E) at partition 5 offset 84381"}
```

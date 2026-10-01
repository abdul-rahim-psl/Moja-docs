<!-- SPDX-License-Identifier: Apache-2.0 -->

# Next Steps — Options as of 2026-10-01

**Status:** a menu, not a plan. Nothing here is sequenced or committed to; it is the set of possible next
moves as things stand. Phase 7 is development-complete and waiting on a CI runner. Phase 8 is partly under
way: CCH reports `cch-mla` deployed on its own cluster and sending to the ingress gateway (Oscar Cobar,
[2026-10-01]; not yet verified on the Paysys side), and our own test rig at `10.0.150.69` runs `main`. The QA bugfix workstream has its fixes on `cch-mla` `main` (`f2fb624`), with the remaining findings open. Any item
here stops being covered by this menu once it is picked up and logged in `plan.md` §16, which this document
does not replace.

**This is a living document.** It changes in place as work moves forward. A closed option is removed, not
struck through (unlike `plan.md` §13's convention), because this list is a menu of what is still available,
not a history. A new option is added as soon as it opens. Item numbers are stable identifiers cited
elsewhere, so a removed item's number is not reused. Re-read this file fresh each session rather than
trusting a stale local copy.

---

## A. Pure engineering — no external blocker, can start immediately

20. **Verify CCH's report, then confirm to Oscar whether PPA sees CCH's traffic.** He asked for this explicitly
    (`meetings and emails/oscar-message-2026-10-01-cch-mla-traffic.md`). Run the `write_ahead` query from
    `plan.md` §16's [2026-10-01] PPA-host entry on `10.0.115.186`: `created_at` shows when each envelope
    arrived, and a row whose `id` is absent from this side's capture fixtures is fresh live traffic.
    `fspiop-source` cannot discriminate, because the captures came from CCH's staging environment and
    use the same test DFSP IDs. The same
    query settles where PPA's startup burst of 57 DLQ writes came from. PPA was down from 2026-09-30 09:19
    EDT until 2026-10-01, so CCH traffic sent in that window could only have landed if MLA re-delivered it
    afterwards.
21. **Rebuild PPA on `10.0.115.186` from current `cch-ppa` `main`.** The running image (`cch-ppa-ppa`,
    built locally from an unknown commit) very likely predates the schema fix `a625ed69`, so QUOTE and
    TRANSFER traffic fails local validation and never reaches TMS. In the same pass: point `TMS_BASE_URL` and
    `TMS_AUTH_LOGIN_URL` at the co-located Tazama core stack (host ports 5000 and 3020, not `localhost`), with
    real Keycloak credentials; and stop publishing Postgres (5432, password `ppa`/`ppa`) and ValKey (6379,
    no auth) on `0.0.0.0`. Keep the `restart: always` override at `/opt/cch-ppa/docker-compose.override.yml`,
    and run compose from that directory without `-f`.
22. **Deploy the internal Nginx reverse proxy on `10.0.115.186`.** It sits between the ingress gateway and
    PPA, runs in Docker with `restart: always`, and the Nginx image's default config is backed up before it
    is replaced (`plan.md` §16's [2026-10-01] entries). Design questions are open with the user: where TLS
    ends and what the gateway forwards; the gateway's internal IP and the Nginx listen port; which hop
    strips `/others`; the health-probe path (F-23); the image source (the `10.0.70.92:5000` registry or
    `docker save | load`, since the host has no Docker Hub access); and whether the `10.0.150.69` test rig
    keeps a direct path to PPA. Host constraints: SELinux `Enforcing` (bind mounts need `:Z`), and
    Docker-published ports bypass firewalld.

1. **Remaining QA findings.** Fixed and live-verified on `main`: F-01–F-16, F-25, F-26, F-28a. F-17 is
   deliberately deferred and F-33 is closed by decision (`plan.md` §16). Open and self-contained: F-18–F-22
   (`bugs/qa-review-findings.md`, fix direction in `bugs/qa-review-remediation.md`), and F-24 and F-29–F-42
   plus Q-01–Q-07 (`bugs/qa-sweep-2-findings.md`, which carries both the finding and its fix direction).
   **F-24** (High: a Kafka startup failure is never retried, and liveness stays `UP`) was proposed as the next
   one to pick up. One finding at a time, using `CLAUDE.md`'s preview/close-out cadence. The F-11–F-28
   image already runs on `10.0.150.69` [2026-09-25]; it still needs to be pushed to GHCR and pinned in
   `03-mla-deployment.yaml` (see item 8).
3. **`TxSts: "ABOR"` translation gap.** Add the missing row to the `TxSts` translation table and the missing
   branch in `isTransferRejection` for the payee-DFSP-rejection shape Sam supplied
   (`meetings and emails/sam-email-2026-09-16-rejection-samples.md`, `plan.md` §14 item 3). It currently falls
   through silently to Tazama's `PDNG` default, a silent-failure class `strategy.md` §7 specifically warns
   about. `cch-ppa` `a625ed69` added `COMM`→`ACSC`/`RESV`→`ACSP` for the ISO-egress callback shape and
   deliberately left out any `ABOR` equivalent, so the gap is still open on PPA's side.
15. **Re-evaluate F-23 against the `cch-ppa` change it was parked for.** `cch-ppa` `9c5709e` [2026-09-28]
   removed mTLS from PPA entirely. PPA now serves plain HTTP on every route, including health, and its own
   code comment places mTLS termination at an Nginx in front of PPA. PPA itself no longer requires a client
   certificate on `/health/ready`. Whether F-23 still applies now depends on whether the mTLS-terminating
   ingress (`mla-interconnect.paysyslabs.com`) requires a client certificate on the health path. Also
   re-check F-35 against the new shape. `plan.md` §16's F-23 entry lists exactly what to check.
16. **F-28b: tokenize identity inside the quote callback's `ilpPacket`.** Decode the ILP v4 packet, tokenize
   the identity fields, re-encode it. PPA never reads this packet on the quote-callback leg, so there is no
   correctness dependency to protect (`plan.md` §16's F-28 entry). Not started; needs its own preview.

## B. Requires a CCH/story-author decision first, but a reversible default can be built now

17. **Kafka TLS/SASL (F-27).** MLA's Kafka connection has no TLS/SASL support, and nobody has asked CCH
   whether their broker requires it. This is CCH's to answer. The support itself can be built now behind
   configuration, off by default.

## C. Documentation / decision-support work, no code

18. **Correct `plan.md` §16's F-17 entry (F-34).** It says the parked-recovery path retries only the commit;
   it actually re-delivers. This is a documentation finding with no code change.

## D. Coordination / drafting for someone else to act on

These need someone to actually send them. They are flagged here as live gaps; this document does not draft
or send them.

8. **Email George about the QA bugfixes.** The JWS-removal email went out on its own [2026-09-23]
   (`meetings and emails/george-email-2026-09-23-jws-removal.md`). A second email covering the bugfixes is
   owed once that image is on GHCR and pinned (item 1).
19. **Complete the mTLS certificate exchange with Oscar Cobar (COMESA/DRPP).** The architecture is settled
    [2026-09-25 to 09-28]: COMESA/DRPP hosts the CA, and mTLS terminates at Paysys's ingress gateway
    `mla-interconnect.paysyslabs.com`. Still open: receive Oscar's CA bundle; generate and send the server
    CSR; agree who generates `cch-mla`'s client key/CSR and its CN (`plan.md` §16's [2026-09-28] entry,
    `deployment/MLA-deployment-kubernetes.md` §11). The internal Nginx behind the gateway is item 22.
13. **Ask George for his annotated event table.** It covers the ~52% of the 500-record export not yet
    reflected in the per-operation model (`plan.md` §14 item 2's follow-up, not yet received).
14. **Ask Sam for a genuine FX-side rejection/timeout sample.** Still missing. Every FX-labelled folder in
    the [2026-09-16] report either hides the raw shape behind an SDK abstraction or returns `202` with no
    visible failure callback (`plan.md` §14 item 3).

---

## How this menu was derived

Read in this order: `strategy.md` §1 (orientation) → `plan.md` §13 (blocked work), §14 (open questions for
COMESA) and §16's most recent entries → `bugs/qa-review-findings.md` and `bugs/qa-sweep-2-findings.md`
(the QA workstream's remaining scope and its "Decisions that are not engineering's" table). Nothing here
required primary research beyond what those documents state, except item 15, which comes from reading
`cch-ppa`'s own git history.

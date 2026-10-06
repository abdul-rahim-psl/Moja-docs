<!-- SPDX-License-Identifier: Apache-2.0 -->

# Next Steps — Options as of 2026-10-05

**Status:** a menu, not a plan. Nothing here is sequenced or committed to; it is the set of possible next
moves as things stand. Phase 7 is development-complete and waiting on a CI runner. Phase 8 is partly under
way: CCH's own `cch-mla` is deployed and delivering to PPA through the ingress gateway (verified
[2026-10-01]), and seven of CCH's transactions reached Tazama on the rebuilt PPA that evening, but every
PPA → TMS dispatch has failed with a 401 since 2026-10-01 22:32 UTC (item 24). Our own test rig at
`10.0.150.69` runs `main`. The QA bugfix workstream has its fixes on `cch-mla` `main` (`f2fb624`), with the remaining findings open. Any item
here stops being covered by this menu once it is picked up and logged in `plan.md` §16, which this document
does not replace.

**This is a living document.** It changes in place as work moves forward. A closed option is removed, not
struck through (unlike `plan.md` §13's convention), because this list is a menu of what is still available,
not a history. A new option is added as soon as it opens. Item numbers are stable identifiers cited
elsewhere, so a removed item's number is not reused. Re-read this file fresh each session rather than
trusting a stale local copy.

---

## A. Pure engineering — no external blocker, can start immediately

24. **Diagnose and fix the PPA → TMS 401.** Since 2026-10-01 22:32:50 UTC every TMS dispatch from the UAT
    PPA has failed with `TMS_DELIVERY_FAILED: auth-service login failed: 401`: 52 envelopes up to
    2026-10-02 11:01 UTC, plus 16 transfer callbacks dead-lettered `IDENTITY_UNRESOLVED` behind them
    (`plan.md` §16's [2026-10-02] entry). None of CCH's traffic has reached Tazama since. PPA's TMS breaker
    opens on the failures and PPA answers 503 while it is open, so CCH's MLA keeps retrying. The cause has
    not been investigated. PPA logs in to `10.0.115.186:3020` as Tazama's shared test user (item 23). Once
    it is fixed, decide whether to replay the dead letters and the 1,150 envelopes the old image failed;
    that is an operator decision (US-PPA-15).
20. **Reply to Oscar.** CCH's delivery to PPA is verified (`plan.md` §16's [2026-10-01] verification entry):
    all six correlation IDs from his evidence are in PPA's write-ahead store. The reply can also say that
    seven of CCH's transactions reached Tazama on 2026-10-01 once PPA was rebuilt, and that a Paysys-side
    PPA → TMS failure since 22:32 UTC that day (item 24) makes CCH's MLA see 503s and retry until it is
    fixed. It should still ask for CCH's MLA logs and metrics covering the PPA outage, 2026-09-30 13:19 UTC
    to about 2026-10-01 05:35 UTC. About 12 scheduled batches fell inside that window, but only 153
    envelopes arrived afterwards, so roughly 500 are unaccounted for. The D9 trust package (item 22) goes to
    the same person.
22. **Put the internal Nginx on `10.0.115.186` into the live path.** It is configured and verified against
    the real PPA [2026-10-02]: TLS terminates on 8443, each `/others/...` route reaches PPA intact, and
    unmatched paths answer 503 (`deployment/architecture/internal-nginx-mtls-plan.md`, `plan.md` §16).
    What remains, in order:
    - CCH's MLA must trust the certificate the internal Nginx presents (D9). A package for CCH techops is
      ready: `/home/abdul-rahim/mojaloop/cch-mla-trust-internal-nginx-for-techops.zip`, the interim
      self-signed certificate plus the steps to add it to MLA's CA file, rehearsed verbatim on the rig
      (`plan.md` §16's [2026-10-03] entry). Send it, then wait for CCH's confirmation.
    - The Paysys infra team switches the gateway from terminating TLS to plain TCP forwarding to
      `10.0.115.186:8443` (D1).
    - The infra team supplies the gateway's internal IP (D3), so 8443 can be restricted to it. That happens
      together with closing PPA's own published ports.
    - Later: the COMESA/DRPP certificates, then the mTLS stage.
25. **Measure CCH's traffic against the UAT network map.** Pull the ISO messages and evaluation results for
    CCH's seven completed transactions from the UAT Tazama (`raw_history` and `evaluation` on
    `10.0.115.186`), read the network map loaded there (`configuration`), and build a coverage table, one
    row per rule. Derive the synthetic data the real sample cannot supply: it has 2 payers, 6 payees and
    1 FX provider, and every transfer settled `COMM`. This also shows whether the rig's [2026-10-01]
    corridor was evaluated through rules, typologies and adjudication. Source:
    `/home/abdul-rahim/mojaloop/CCH_UAT_Packet_2026-10-01/README.md`, later-stage steps 2–3.
23. **Give PPA its own Keycloak user.** PPA uses `tazama-user@tazama.org` with the publicly documented
    default password. A dedicated user in `/tazama-tms` only, with a real password, is the identity for
    anything beyond UAT. Also: sync the PPA host's clock (`timedatectl` reports it unsynchronized; it has
    drifted about 51 s), and stop publishing Postgres and ValKey on `0.0.0.0` in PPA's compose file.

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
15. **F-23: build the health-probe fix before the internal Nginx enforces client certificates.** `cch-ppa`
   `9c5709e` [2026-09-28] removed mTLS from PPA itself. mTLS now terminates at the internal Nginx on
   `10.0.115.186`, whose plan keeps the two health routes exempt under `ssl_verify_client optional` until
   F-23's fix ships in CCH's image, then switches to `on` (`deployment/architecture/internal-nginx-mtls-plan.md`
   §4.6, decision D6). So the fix, presenting the delivery client cert on `https:` health probes, is still
   needed by the mTLS stage. Also re-check F-35 against the new shape. `plan.md` §16's F-23 entry lists
   exactly what to check.
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
    [2026-09-25 to 09-28]: COMESA/DRPP hosts the CA. The ingress gateway `mla-interconnect.paysyslabs.com`
    passes TLS through, and mTLS terminates at the internal Nginx on `10.0.115.186`
    (`deployment/architecture/internal-nginx-mtls-plan.md`). Still open: receive Oscar's CA bundle; generate and send the server
    CSR; agree who generates `cch-mla`'s client key/CSR and its CN (`plan.md` §16's [2026-09-28] entry,
    `deployment/MLA-deployment-kubernetes.md` §11). The internal Nginx behind the gateway is item 22.
13. **Ask George for his annotated event table.** It covers the ~52% of the 500-record export not yet
    reflected in the per-operation model (`plan.md` §14 item 2's follow-up, not yet received).
14. **Ask Sam for a genuine FX-side rejection/timeout sample.** Still missing. Every FX-labelled folder in
    the [2026-09-16] report either hides the raw shape behind an SDK abstraction or returns `202` with no
    visible failure callback (`plan.md` §14 item 3).
26. **Raise PPA's remaining `pacs.008` validation gap with its engineer.** Since the rebuild, 6 of CCH's
    `pacs.008` messages failed `LOCAL_VALIDATION_FAILED`, each missing `ChrgsInf`, `Purp` or `InstdAmt`
    (`plan.md` §16's [2026-10-02] entry). This is `cch-ppa` code, Muhammad Umair Khan's. The failing
    envelopes are in PPA's write-ahead store on `10.0.115.186`.
27. **Align PPA's message types with the planned CCH network map.** The rule-configuration Developer Guide
    (CCH-PL-DEV-RULECFG-001) keys rules to `pacs.008.001.10`, `pacs.009.001.07` and `pacs.002.001.15`. PPA
    sends `pacs.002.001.12` and no `pacs.009`. Tazama routes by message type, so a test against that map
    matches only `pacs.008` until the two are aligned. Not engineering's call alone: it belongs to the
    rule-configuration owners and PPA's owner (`plan.md` §16's [2026-10-02] entry).

---

## How this menu was derived

Read in this order: `strategy.md` §1 (orientation) → `plan.md` §13 (blocked work), §14 (open questions for
COMESA) and §16's most recent entries → `bugs/qa-review-findings.md` and `bugs/qa-sweep-2-findings.md`
(the QA workstream's remaining scope and its "Decisions that are not engineering's" table). Nothing here
required primary research beyond what those documents state, except item 15, which comes from reading
`cch-ppa`'s own git history, and items 24–27, which come from `CCH_UAT_Packet_2026-10-01/README.md`
(outside this repository, because it holds clear-text payee names).

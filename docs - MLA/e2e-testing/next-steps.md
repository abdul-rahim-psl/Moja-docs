<!-- SPDX-License-Identifier: Apache-2.0 -->

# Next Steps — Options as of 2026-10-13

**Status:** a menu, not a plan. Nothing here is sequenced or committed to; it is the set of possible next
moves as things stand. Phase 7 is development-complete and waiting on a CI runner. Phase 8 is partly under
way: CCH's own `cch-mla` is deployed and delivering to PPA through the ingress gateway (verified
[2026-10-01]), and seven of CCH's transactions reached Tazama on the rebuilt PPA that evening. The PPA →
TMS 401 that followed was fixed [2026-10-12]. **The UAT phase is complete [2026-10-13]**: the Izyane CCH
rules were fixed on UAT, a fresh payment was verified end to end through to a Tazama evaluation, and the
report went to CCH (`send-to-behjet/Rules-fixed-ALRT-status-now.md`). Items 28–36 carry forward what that
work left open. Our own test rig at
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

20. **Reply to Oscar.** CCH's delivery to PPA is verified (`plan.md` §16's [2026-10-01] verification entry):
    all six correlation IDs from his evidence are in PPA's write-ahead store. The reply can also say that
    seven of CCH's transactions reached Tazama on 2026-10-01 once PPA was rebuilt, and that a Paysys-side
    PPA → TMS failure from 22:32 UTC that day until 2026-10-12, now fixed, made CCH's MLA see 503s and
    retry. It should still ask for CCH's MLA logs and metrics covering the PPA outage, 2026-09-30 13:19 UTC
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
23. **Give PPA its own Keycloak user.** PPA uses Tazama's shared test user `tazama-user@tazama.org`. A
    wrong password on that user caused the 2026-10-01 to 2026-10-12 PPA → TMS 401 (`plan.md` §16's
    [2026-10-12] entry). A dedicated user in `/tazama-tms` only, with a real password, is the identity for
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

28. **Decide whether to replay the PPA → TMS 401-era failures.** From 2026-10-01 22:32 UTC until the
    fix [2026-10-12], PPA dead-lettered CCH's envelopes `TMS_DELIVERY_FAILED`, and transfer callbacks
    behind them `IDENTITY_UNRESOLVED`; 1,150 more failed on the old image before 2026-10-01 13:15 UTC.
    All are in PPA's write-ahead store. Replaying is an operator decision (US-PPA-15).
29. **Fix the 13 rules that count only `ACCC` history**: 001, 002, 003, 004, 006, 007, 008, 010, 011,
    016, 017, 054 and 063. Their history SQL filters `TxSts = 'ACCC'` instead of using
    `txStsSuccessCodes` (FSD §5.2: `ACSC` and `ACCC`), while PPA reports completed transfers as `ACSC`
    (43 of 50 UAT `pacs.002` rows), so they miss PPA's own history. Rule 017 counted 0 against two real
    settlements in its window. The rebind patches changed only the `TxTp`; this is the same kind of
    patch, in `/home/abdul-rahim/mojaloop/cch-rules-pacs002/` (`plan.md` §16's [2026-10-13] entry).
30. **Load CCH configs for the 10 rules still on Tazama's stock ones**: 006, 007, 010, 011, 018, 020, 025,
    030, 054 and 063. They return stock bands and labels; for example, rule 025's stock `.01` ("mirroring
    detected") holds a metric of 0, no mirror match. The same method as the 18 already loaded
    (`cch-rules-pacs002/uat-config-2026-10-13/`): every parameter explicit, since the rules apply no
    schema defaults at run time.
31. **Trace the clear-text MSISDNs in Tazama's DataCache.** Every UAT evaluation's `DataCache.dbtrId` and
    `cdtrId` hold a clear-text MSISDN plus scheme, including the rig's corridors, which went through MLA
    tokenization. The source is not traced; the `ilpPacket`, which is exempt from tokenization, is a
    guess. All are test-DFSP numbers so far.

## B. Requires a CCH/story-author decision first, but a reversible default can be built now

17. **Kafka TLS/SASL (F-27).** MLA's Kafka connection has no TLS/SASL support, and nobody has asked CCH
   whether their broker requires it. This is CCH's to answer. The support itself can be built now behind
   configuration, off by default.

32. **Provide the corridor key the rules read.** Rules 016, 020, 048, 054 and 063 exit `.x00` on every
    message, and 091 needs the same input, because they read `DataCache.corridor` (e.g. `ZMW-MWK`), which
    the CCH FRMS Addendum expects to be filled in at ingestion. Tazama's DataCache has no such key,
    though it holds both currencies (`instdAmt`, `intrBkSttlmAmt`). The decision is where it is derived:
    in the platform, or in each rule from the two amount currencies.
33. **Load the CCH typologies.** A new network map with the 30 CCH typologies (Developer Guide §6–§8, the
    weights worksheet), then restart the typology processor, event adjudicator and event director, which
    load the map only at start-up. It replaces the interim zero weights on the stock typology
    (`cch-rules-pacs002/uat-typology-2026-10-13/`). Do items 29, 30 and 32 first, or the CCH weights
    score structural exits and unweighted stock outcomes (`.x01`, `.x03`, `.x04`, 007 `.03`). Two
    decisions first: (1) the threshold basis: the Developer Guide's §6 per-message thresholds assume most
    rules on pacs.008/pacs.009, so under the all-`pacs.002` binding they are its §7 full-chain figures at
    the §3.2 50% rule, recomputed for rule 028, which is not deployed; (2) typology 137: its 091 `.err`
    weight of 100 makes every message ALRT while 091 has no `corridorThreshold`.
34. **Rule 076's `PrcgDt.DtTm`.** Tazama's protobuf transport drops `TxInfAndSts.PrcgDt`, so 076 returns
    `.err` on every message. Either the platform carries it, or the rule takes its timestamp from another
    field.

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
35. **Move the rule fixes into Izyane's rule repositories.** The rebind exists only in UAT's
    `cch-rule-NNN:pacs002` images; a rebuild from the current branches would undo it. The patches are in
    `/home/abdul-rahim/mojaloop/cch-rules-pacs002/patches/`, with item 29's to follow. Ask the
    rule-configuration owners to confirm `pacs.002.001.12` as the binding, in place of the Addendum's
    `pacs.002.001.15`.
36. **Obtain the three business values.** `purposeCodeToCaseMap` for 078 (COMESA / Paysys Dev; 078 also
    reads `Purp.Prtry`, which the transport drops), local-currency `corridorThreshold` for 091 (DRPP
    Commercial Working Group), and the real `identityResolutionRule` for 008, 083 and 084 (COMESA /
    deployment team), replacing the interim `{}` loaded on UAT.

---

## How this menu was derived

Read in this order: `strategy.md` §1 (orientation) → `plan.md` §13 (blocked work), §14 (open questions for
COMESA) and §16's most recent entries → `bugs/qa-review-findings.md` and `bugs/qa-sweep-2-findings.md`
(the QA workstream's remaining scope and its "Decisions that are not engineering's" table). Nothing here
required primary research beyond what those documents state, except item 15, which comes from reading
`cch-ppa`'s own git history; item 26, which comes from `CCH_UAT_Packet_2026-10-01/README.md`
(outside this repository, because it holds clear-text payee names); and items 28–36, which come from the
UAT end-to-end test (`plan.md` §16's [2026-10-12] and [2026-10-13] entries, the two reports in
`send-to-behjet/`, and `/home/abdul-rahim/mojaloop/cch-rules-pacs002/`).

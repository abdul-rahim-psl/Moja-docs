# Context and Setup

- Paysyslabs team (Syeda, Abdulrahim, Muhammad Omer) met with Mojaloop Foundation (Michael Richards, Sam Kumari) and CCH (George Murage) to resolve 5 open integration questions
- Paysyslabs moving from Core Test Harness to Kubernetes-based deployment (per Sam’s earlier recommendation)
  - Empty cluster already configured on a local machine
  - Next step: run live traffic through it

# Q1: DFSP Public Keys for JWS Signature Verification

- Paysyslabs has 286 real FSPID signature values from the Kafka capture (raw export, 500 records) across 19 DFSP IDs, but cannot verify any
- George confirmed 19 keys resolve to: 8 DFSPs, 2 FXPs, 9 regional hubs (one per country)
  - George to liaise with Infotex to obtain and share those public keys
  - Will also check if Infotex has a JWKS endpoint for key rotation
- Michael clarified: GET Parties requests are intentionally unsigned (sender doesn’t know recipient at issue time; switch adds that later)
- Sam added: Mojaloop Connection Manager (MCM) handles key management automatically during DFSP onboarding
  - MLA should interface with MCM rather than managing keys manually
  - Sam to share an onboarding video recorded recently
- **Closed:** Q1 resolved pending Infotex key retrieval and MCM onboarding video

# Q2: Start vs. Egress Records on the Audit Event Topic

- Paysyslabs observed each operation written twice (start + egress) and built a per-event table to decide which to treat as authoritative
- George clarified the 141-record set is a subset of the 500, not a separate capture window; no true duplicates
  - Start = inbound request; egress = outbound dispatch from a handler within the switch
  - Not always one-to-one: some egress records have no parent start event
- Three operations are egress-only by design (switch-generated):
  - Commit Transfer: switch issues its own message (may indicate a timed-out transfer, still signed by DFSP if nothing went wrong)
  - Reserve FX Transfer: FXP commits to honor conversion only if payment succeeds
  - Notify FX Transfer: switch notifies FXP that payment completed, conversion can be booked
- Michael confirmed: egress is the safe/authoritative record to take as definitive
- Sam flagged: if events are missing for a function, check whether that handler has its event sidecar enabled in the Helm config values file
- Paysyslabs confirmed they subscribe to the single topic-event-audit topic, not per-action topics
- George to share his own annotated event table covering operations not in Paysyslabs’ current table (~52% of 500 records uncovered)
- **Closed:** per-operation asymmetry is by design across all environments, not specific to the two shared captures

# Q3: Fulfill-Side and FX Transfer Rejection Samples

- Paysyslabs has never seen a fulfill-side rejection or FX transfer-level rejection in the shared captures
- George confirmed these scenarios don’t exist in the captured data; need to be simulated
- Michael and Sam had pre-meeting discussion: Sam can supply examples from Mojaloop testing
  - Two failure types needed:
    1. Payee DFSP rejects payment (e.g., customer account suspended between approval and execution)
    2. Switch-generated failure due to transfer timeout (e.g., set an unreasonably short timeout to trigger)
- **Closed:** Sam to provide sample rejection messages from test environment

# Q4: FX Quote Rejection Ordering

- Paysyslabs observed all 19–20 FX quote rejections in the captures died before the primary quote was ever filed; asked if the reverse order is possible
- Michael answered: yes, technically possible in Mojaloop generally, but not in DRPP
  - DRPP only allows currency conversion via the payer DFSP
  - If payee DFSP requests conversion and FXP rejects it, payee DFSP must also reject the proposed transfer
  - An FX quote rejection followed by an approved post-quote would be a significant system failure
- **Closed:** in DRPP, Paysyslabs will only ever see the pattern already observed

# Q5: Partition Key on Topic Event Audit

- Sam: partition key is a runtime/Kafka config detail, not application code
  - Can be inspected via Kafka UI or Redpanda UI (DRPP uses Redpanda)
  - Sam to look it up and share
- Michael added context on settlement sequencing: settlement windows currently change via manual operation, causing out-of-order settlement event arrival
  - Plan in place to replace with deterministic assignment (each transfer assigned to a settlement batch based on payee DFSP approval time)
  - Will keep Paysyslabs posted when implemented
- **Partially open:** Sam to share partition key detail

# Next Steps

- **Obtain 19 DFSP/FXP/hub public keys from Infotex and share with Paysyslabs** (George)
- **Share Mojaloop onboarding video and MCM tool links** (Sam)
- **Add Sam to the shared CCH/Paysyslabs workspace** (George)
- **Share fulfill-side and FX transfer rejection message samples** (Sam)
- **Share annotated event table covering missing operations** (George)
- **Look up and share partition key for topic-event-audit** (Sam)
- **Share meeting outcomes with Behjet**
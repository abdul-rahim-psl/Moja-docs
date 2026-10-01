# Project Status and MLA Deployment Readiness

- MLA not yet deployed on Comesach’s side; integration testing not started
- Behjet flagged this as a risk, but manageable if resolved by end of week
- Full deployment package (manifests, namespace file, config map files) already shared with CCH TechOps
- George confirmed deployment notes are clear; no questions for now, will attempt deployment and raise issues as they arise

# Open Items: Items 1 and 3 (Infitecs Dependency)

- Both items require a call with Infitecs to align on two questions:
  - Is the MLA’s outbound IP a public IP? Paysyslabs needs to whitelist it
  - Will the certificate be embedded in MLA directly, or routed via a dedicated egress gateway?
- Item 3: section 6 details still need to be completed and shared; waiting on Infitecs to schedule a call
- Paysyslabs to be included in that call, or can provide answers separately
- Oscar (Infitecs) has already accepted the GitHub invite and is in copy on relevant threads

# Open Item 2: JWS Signature Validation and PII Secret

- JWS validation: George needs to confirm with Mojaloop team (Michael/Sam) that the hub is the only ingress into MLA
  - Mutale will send the query directly to Michael and follow up with a call to expedite
- PII secret: George believes this relates to the tokenization discussion; asked Behjet to resend separately
  - Abdul Rahim to clarify and share the relevant context on Slack

# Item 4: GitHub Access

- Closed: GitHub IDs provided, Oscar added, access token generation and testing in progress

# Next Steps

- **Attempt MLA deployment and flag any issues immediately** (George)
- **Escalate JWS signature validation query to Michael (Mojaloop)** (Mutale)
- **Resend PII secret context to George separately** (Behjet / Abdul Rahim)
- **Schedule Infitecs call to close items 1 and 3** (George)
- **Confirm Behjet and Mutale are in copy on Infitecs tickets** (George)
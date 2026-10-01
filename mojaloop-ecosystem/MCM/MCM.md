## What MCM (Mojaloop Connection Manager) is

MCM is a Mojaloop component that automates the security/connectivity setup needed for a DFSP (Digital Financial Service Provider) to connect to a Mojaloop Hub — mainly certificate and endpoint management, which would otherwise be a manual, error-prone part of onboarding.

**Architecture** — two parts that talk to each other:
- **MCM Client** — lives inside Payment Manager (or, in lighter deployments, is orchestrated by an MCM Agent Service/ITK Configuration Utility as part of the Integration Toolkit)
- **MCM Server** — lives inside the Hub

**What it actually does:**
- Manages creation, signing, and exchange of digital certificates (PKI), including signing Certificate Signing Requests (CSRs)
- Gives the Hub Operator a portal to submit Hub endpoint info/certificates and retrieve DFSP endpoint/certificate details submitted via Payment Manager
- For managed-hosted Payment Manager deployments: automates TLS cert generation/signing/install, IP whitelisting in firewalls/API gateways, and OAuth 2.0 client secret/key generation
- For self-hosted deployments: offers a semi-automated "Connection Wizard" portal for DFSPs to generate/configure certificates themselves

**Why it exists:** without it, connecting a new DFSP to the Hub means manually exchanging certificates and endpoint details between the DFSP and Hub Operator — MCM turns that into a structured, largely automated exchange, cutting onboarding time and operational complexity.

Sources:
- [Guide to the Selection and Use of Participation Tools](https://docs.mojaloop.io/product/features/connectivity/participation_tools_mini_guides.html)
- [Technical onboarding of DFSPs](https://docs.mojaloop.io/mojaloop-business-docs/HubOperations/Onboarding/technical-onboarding.html)
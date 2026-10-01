# Registry Access

- Flexible on registry location: MLA can stay in Paysyslabs registry, or be hosted elsewhere
  - George just needs a URL and valid auth token to pull and deploy
- Paysyslabs to confirm preferred registry and communicate it to George

# Kafka Configuration

- Broker address: already known on George’s side, no action needed
  - Paysyslabs to share the Kafka variable name so George can configure values accordingly
- Consumer Group ID: must be a unique string
  - Existing prefix spaces-mla- proposed in Behjet’s environment config doc
  - George confirmed this prefix won’t clash with existing consumer groups

# mTLS and Certificate Trust (Open Issue)

- MLA (in DRPP cluster) pushes to PPA (in Paysyslabs data center) via REST POST, expects 200 OK
  - On 200 OK, Kafka offset advances; otherwise retries
- Core problem: two separate trust boundaries (DRPP and Paysyslabs), so neither cert-manager trusts the other’s certificates
- Proposed approach: deploy a neutral, shared cert-manager sitting between both environments
  - Both sides handshake to this middle-ground CA
  - George to investigate and follow up

# Observability and Monitoring

- DRPP has its own Prometheus/Grafana/Loki stack, but MLA-only metrics are limited in isolation
- George suggested Paysyslabs scrape MLA metrics directly from their own observability stack for a full system view
- Agreed to defer monitoring setup: deploy first, confirm MLA pod is accessible, then revisit metrics and health checks

# VPN and PPA Endpoint

- Site-to-site VPN will allow MLA and PPA to communicate
- Only IP addresses on both sides need to be defined; TCP/UDP scoping not required

# Next Steps

- **Confirm registry preference and share details with George** (Muhammad Umair)
- **Share Kafka broker variable name with George**
- **Investigate mTLS certificate trust solution** (George)
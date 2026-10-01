<!-- SPDX-License-Identifier: Apache-2.0 -->

# Tazama Authentication — Executive Summary

## Purpose

This document explains, at a concise technical level, how authentication and authorization work across the Tazama ecosystem: who the actors are, what each component does, and how a request moves from "I have a username and password" to "I am an authorized caller with specific permissions" on any protected Tazama service.

For exhaustive detail (code paths, data shapes, edge cases, configuration reference), see [Authentication-Comprehensive-Details.md](Authentication-Comprehensive-Details.md).

## The actors

| Component | Role |
|---|---|
| **Keycloak** | External Identity Provider (IdP). Owns user accounts, passwords, realm roles, and client roles. The actual source of truth for "who are you" and "what are you allowed to do." |
| **auth-lib-provider-keycloak** | A separate, pluggable npm package that knows how to talk to Keycloak specifically. Implements a small provider contract. |
| **auth-lib** (`@tazama-lf/auth-lib`) | Shared library installed by every Tazama service. Provides (a) a generic plugin loader that hosts an IdP provider like the Keycloak one, and (b) stateless helpers to sign, verify, and inspect Tazama's own JWT format. |
| **auth-service** | The one HTTP service in the ecosystem whose job is to exchange credentials for a Tazama token. It is the only service that talks to Keycloak's token endpoint. |
| **Every other Tazama service** (admin-service, tms-service, event-monitoring-service, data-enrichment-service, connection-studio, rule-studio backends, etc.) | Consumers only. They never talk to Keycloak. They import `auth-lib` and use it purely to verify a token that was handed to them in a request header. |

## The two distinct flows

Authentication in Tazama splits cleanly into two phases that happen in different places:

### 1. Login (credential exchange) — happens only in auth-service

![Authentication flow](pics/authentication%20flow.png)

- Invalid credentials → Keycloak rejects → propagates up as a `401`.
- Too many failed attempts → Keycloak account lockout → auth-service returns `429`.
- The client now holds a **Tazama-format JWT** — not the raw Keycloak token. This is the token used everywhere else in the ecosystem.

### 2. Authorization (token verification) — happens in every protected service, on every request

![Authorization flow](pics/authorization%20flow.png)

No network call is made here — verification is a **local, offline RS256 signature check** against a public key file. This is what makes Tazama's authorization model fast and horizontally scalable: any service instance can verify a token without calling back to Keycloak or auth-service.

## Why the split (design rationale)

- **Single Keycloak integration point**: only auth-service and its provider plugin need Keycloak network access, secrets, and realm configuration. Every other service is decoupled from the identity provider entirely.
- **Asymmetric key trust model**: auth-service (and only auth-service, via its provider) holds the **private** key and signs. Every consuming service holds only the **public** key and verifies. Compromising a downstream service cannot forge tokens.
- **Pluggable IdP**: `auth-lib`'s provider-loader pattern (dynamic `import()` of a package named in `AUTH_PROVIDER`) means Keycloak could be swapped for another IdP (e.g. Sybrin, listed as a known provider) without changing auth-service's code — only the `AUTH_PROVIDER` env var and the installed package change.
- **Stateless authorization**: claims (permissions) are baked into the Tazama JWT at login time as a flat list of strings, so authorization checks downstream are just string membership tests — no database or Keycloak round-trip per request.

## The Tazama token shape

A decoded Tazama JWT carries:

| Field | Meaning |
|---|---|
| `clientId` | Keycloak subject (user ID) |
| `tenantId` | Which tenant/organization this user belongs to (drives multi-tenant data scoping) |
| `claims` | Flat array of permission strings, e.g. `POST_V1_EVALUATE_ISO20022_PAIN_001_001_11`, `LISTCUSTOMERS` — derived from Keycloak realm roles + client roles |
| `sid`, `iss`, `exp` | Standard session/issuer/expiry metadata |
| `tokenString` | The original Keycloak access token, preserved so services can still call Keycloak Admin APIs (e.g. group/user lookups) on the user's behalf |

Claims map 1:1 to route permissions using a `{HTTP_METHOD}{ROUTE_PATH_UPPERCASED}` convention (e.g. a `POST /customers` route expects claim `POST_CUSTOMERS`), which is how services like admin-service generate per-route required-claim checks automatically from their CRUD schema generators.

## Multi-tenancy

Every request into a protected service also resolves a `tenantId`:
- If the ecosystem is running unauthenticated (dev/test mode, `AUTHENTICATED=false`), tenant defaults to `"DEFAULT"`.
- If authenticated, `tenantId` is pulled straight out of the verified token — it cannot be spoofed via request body/params since it's cryptographically bound into the signed JWT at login time.

## Key operational facts

- **auth-service** is the only service with Keycloak client credentials (`CLIENT_ID` / `CLIENT_SECRET`) and network reachability to Keycloak.
- **Every consuming service** only needs the **public** verification key (`CERT_PATH_PUBLIC`) — never the private key.
- Token validation failures (bad signature, expired, malformed) always surface as HTTP `401 Unauthorized`.
- There is a legacy/unused `KeycloakService` class still bundled inside `auth-lib` itself (not exported, not wired to the dynamic provider loader) — the real, currently-used Keycloak integration is the separately versioned `@tazama-lf/auth-lib-provider-keycloak` package. Worth cleaning up but not currently load-bearing.

## At a glance: who talks to whom

![Who talks to whom](pics/who%20talks%20to%20whom.png)

# Authentication & Authorization in Tazama CMS

A first-principles walkthrough of how identity actually works in this system — built by
reading the shipped library code and probing the live services on `10.10.80.18`.
Every claim here was verified against the running stack, not inferred from docs.

---

## Part 1 — First principles

### 1.1 The problem

HTTP is stateless. Each request arrives with no memory of the last. So for every single
request the server must answer two different questions:

| Question | Name | Example |
|---|---|---|
| *Who are you?* | **Authentication** (authn) | "You are cms-supervisor@tazama.org" |
| *May you do this?* | **Authorization** (authz) | "Supervisors may not upload to closed cases" |

Conflating these two is the most common source of security bugs. Tazama keeps them
strictly separate — and as you'll see in Part 5, it splits *authorization* again into
three independent tiers.

### 1.2 Why not just send the password every time?

The naive approach — attach username+password to each request — fails badly:

- Every service handling a request sees the raw password.
- Any log, proxy, or crash dump can capture it.
- Revoking access means changing the password everywhere.
- Every service needs access to the password database.

### 1.3 The token idea

Instead: prove identity **once**, receive a short-lived, signed, tamper-evident
document, and present *that* afterwards.

That document is a **JWT** (JSON Web Token). Three base64url segments joined by dots:

```
eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9 . eyJjbGllbnRJZCI6IjBhNmZm... . AbC123signature
└──────── header ────────┘   └──────── payload ────────┘   └── signature ──┘
```

- **Header** — which algorithm signed this (`RS256`)
- **Payload** — the claims: who, what roles, when it expires
- **Signature** — cryptographic proof the payload was not altered

**Critical distinction:** the payload is *encoded*, not *encrypted*. Anyone can read it.
Decode one yourself:

```bash
echo '<paste-jwt-here>' | cut -d. -f2 | base64 -d 2>/dev/null | python3 -m json.tool
```

A JWT guarantees **integrity** (nobody changed it), never **confidentiality**
(nobody read it). Never put a secret in a JWT payload.

### 1.4 Why RS256 and not HS256

Two families of signing:

| | Symmetric (HS256) | Asymmetric (RS256) |
|---|---|---|
| Keys | One shared secret | Private key signs, public key verifies |
| To verify, a service needs | The signing secret | Only the **public** key |
| Risk | Any verifier can also forge | Verifiers cannot forge |

Tazama uses **RS256**. This is the single most important architectural choice in the
whole system, and here's why:

> The CMS backend can *verify* any token but can never *mint* one. Only the auth
> service holds the private key. Compromising the CMS does not let an attacker
> issue valid identities.

You can see this split on disk. The CMS has only the public half:

```bash
ls backend/public.pem          # 450 bytes — public key only
head -1 backend/public.pem     # -----BEGIN PUBLIC KEY-----
```

Config comes from two env vars, read by the library at
`node_modules/@tazama-lf/auth-lib/lib/interfaces/iAuthLibConfig.js`:

```
CERT_PATH_PRIVATE   # auth service only — signs
CERT_PATH_PUBLIC    # every service     — verifies
```

---

## Part 2 — The cast

Four components on `10.10.80.18`, each with exactly one job:

| Component | Where | Job |
|---|---|---|
| **Keycloak** | `:8080` | Identity Provider. Owns users, passwords, roles. |
| **Tazama auth service** | `:3020` | Translates Keycloak tokens into Tazama tokens. Holds the private key. |
| **CMS backend** | `:3090` | Verifies tokens, enforces business rules. Public key only. |
| **`@tazama-lf/auth-lib`** | npm package | Shared sign/verify logic. Both sides import it. |

Confirm they're live:

```bash
curl -s -o /dev/null -w "keycloak %{http_code}\n" http://10.10.80.18:8080/realms/tazama
curl -s -o /dev/null -w "cms      %{http_code}\n" http://localhost:3090/api/docs
```

### 2.1 Keycloak: the identity provider

Keycloak is an off-the-shelf OIDC/OAuth2 server. Tazama does not write user management —
password hashing, brute-force lockout, MFA, and federation are all delegated.

A **realm** is an isolated tenant of users, roles, and clients. This deployment uses `tazama`:

```bash
curl -s http://10.10.80.18:8080/realms/tazama/.well-known/openid-configuration \
  | python3 -m json.tool | head -30
```

That URL is the **OIDC discovery document** — a standard every compliant provider must
serve. It is self-describing infrastructure: point any OIDC client at it and the client
learns every endpoint automatically. Live values from this deployment:

| Endpoint | URL |
|---|---|
| issuer | `http://10.10.80.18:8080/realms/tazama` |
| token | `…/protocol/openid-connect/token` |
| authorization | `…/protocol/openid-connect/auth` |
| userinfo | `…/protocol/openid-connect/userinfo` |
| **jwks_uri** | `…/protocol/openid-connect/certs` |
| introspection | `…/protocol/openid-connect/token/introspect` |
| logout | `…/protocol/openid-connect/logout` |

**JWKS** (JSON Web Key Set) is how Keycloak publishes its *public* keys so anyone can
verify its signatures — the RS256 principle again, at internet scale:

```bash
curl -s http://10.10.80.18:8080/realms/tazama/protocol/openid-connect/certs \
  | python3 -c "import sys,json;[print(k['alg'],k['use'],k['kid']) for k in json.load(sys.stdin)['keys']]"
```

```
RS256    sig   -otR9UaDJWkmmwvtIVowJvPAihZO7YmLSWUgSO38tSo
RSA-OAEP enc   T1wKaKO8HU0RbPlKHMqFhYPprFaWRWrDT6mWjNeKm-E
```

The `kid` (key ID) matters: a token's header names which key signed it, so keys can be
rotated without downtime. Keep that first `kid` in mind — it reappears in Part 4.

### 2.2 OAuth2 grant types

The discovery document lists which flows this realm allows:

```
authorization_code, implicit, refresh_token, password, client_credentials, ciba, device_code
```

Two matter here:

- **`authorization_code`** — the browser flow. User is redirected to Keycloak's own login
  page, types the password *there*, and is redirected back with a short code the app
  exchanges for a token. **The application never sees the password.** This is the
  correct choice for user-facing web apps.
- **`password`** (Resource Owner Password Credentials) — the app collects the password
  and posts it to Keycloak itself. Simple, but the app handles the raw secret. It is
  **deprecated in OAuth 2.1**.

**Tazama uses the `password` grant.** You can see it hardcoded in the provider at
`node_modules/@tazama-lf/auth-lib-provider-keycloak/lib/provider.js`:

```js
form.append('grant_type', 'password');
```

This is a deliberate trade-off: it keeps the API non-interactive and curl-testable, at
the cost of the backend momentarily handling the user's password. Worth knowing as a
real-world design decision — and a candidate for migration to `authorization_code`.

---

## Part 3 — The login flow, step by step

What actually happens when you run this:

```bash
curl -s -X POST http://localhost:3090/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"cms-supervisor@tazama.org","password":"abc.123"}'
```

```
┌────────┐  ①  ┌─────────────┐  ②  ┌──────────────┐  ③  ┌──────────┐
│ Client │────▶│ CMS backend │────▶│ auth service │────▶│ Keycloak │
│        │     │    :3090    │     │    :3020     │     │  :8080   │
└────────┘     └─────────────┘     └──────────────┘     └──────────┘
     ▲                                     │                  │
     │                                     │   ④ access_token │
     │                                     │◀─────────────────┘
     │           ⑥ Tazama JWT              │ ⑤ wrap + sign RS256
     └─────────────────────────────────────┘
```

**① Client → CMS.** `POST /v1/auth/login` with JSON credentials.

**② CMS → auth service.** The CMS does not talk to Keycloak. It forwards to
`TAZAMA_AUTH_URL` (`src/modules/auth/auth.service.ts:31`):

```ts
this.httpService.post(`${authUrl}/login`, { username, password })
```

**③ auth service → Keycloak.** The provider builds a form POST to the token endpoint:

```js
form.append('client_id',     keycloakConfig.clientID);      // "auth-lib-client"
form.append('client_secret', keycloakConfig.clientSecret);
form.append('username', username);
form.append('password', password);
form.append('grant_type', 'password');
```

Note the **client** credentials sit alongside the **user** credentials. Two identities
authenticate at once: the human, and the application acting for them.

**④ Keycloak → auth service.** Keycloak validates the password and returns
`{access_token, refresh_token, token_type}`.

**⑤ The translation step.** This is the heart of Tazama's design. `generateTazamaToken()`
decodes Keycloak's token, flattens its roles, and re-signs a *new* token with the Tazama
private key:

```js
return {
  clientId:    decodedToken.sub,
  iss:         decodedToken.iss,
  sid:         decodedToken.sid,
  exp:         decodedToken.exp,
  tokenString: authToken.accessToken,   // ← the whole Keycloak token, nested
  claims:      this.mapTazamaRoles(decodedToken),
  tenantId:    decodedToken.tenant_id,
};
```

`mapTazamaRoles` flattens two separate Keycloak role locations into one flat array:

```js
for (const res in decodedToken.resource_access)   // per-client roles
    roles.push(...decodedToken.resource_access[res].roles);
if (decodedToken.realm_access)                     // realm-wide roles
    roles.push(...decodedToken.realm_access.roles);
```

**Why translate at all?** Downstream services should not need to know Keycloak's schema.
If Tazama swapped Keycloak for Auth0, only this provider file changes — every consumer
still sees the same flat `claims` array. That is the *adapter pattern*, and `auth-lib`'s
`TazamaAuthentication` class makes it pluggable: providers register dynamically by name.

**⑥ Signed and returned:**

```json
{ "message": "Login successful", "token": "eyJhbGci...", "expiresIn": 30000 }
```

---

## Part 4 — Anatomy of the token

Tazama issues a **nested token**: a Tazama JWT that carries the entire Keycloak JWT
inside its `tokenString` field. Two signatures, two issuers, one string.

```
Tazama JWT  (signed RS256 with Tazama private key)
├── clientId, tenantId, sid, exp, iss
├── claims: [ flattened role list ]
└── tokenString: "eyJ..."   ← Keycloak JWT (signed by Keycloak's key)
                              ├── preferred_username, email, name
                              ├── realm_access.roles
                              ├── resource_access.*.roles
                              └── tenant_id, tenant_details, status
```

Inspect both layers of your own token:

```bash
export TOKEN=$(curl -s -X POST http://localhost:3090/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"cms-supervisor@tazama.org","password":"abc.123"}' \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])')

python3 - "$TOKEN" <<'PY'
import sys, json, base64
def dec(t, i=1):
    p = t.split('.')[i]; p += '=' * (-len(p) % 4)
    return json.loads(base64.urlsafe_b64decode(p))
outer = dec(sys.argv[1])
print("=== OUTER (Tazama) ===")
print(json.dumps({k: v for k, v in outer.items() if k != 'tokenString'}, indent=1))
print("=== INNER (Keycloak) ===")
print(json.dumps(dec(outer['tokenString']), indent=1))
PY
```

Real output from this deployment:

**Outer — Tazama layer.** Authorization data, deliberately minimal:

```json
{
  "clientId": "0a6ffb8a-18fd-485f-a6b3-928510c3afbf",
  "tenantId": "DEFAULT",
  "sid": "a04b7e03-f91b-402c-b04d-27234df4aa62",
  "iss": "http://10.10.80.18:8080/realms/tazama",
  "claims": ["view-users", "query-groups", "query-users", "manage-account",
             "manage-account-links", "view-profile", "CMS_SUPERVISOR",
             "default-roles-tazama", "offline_access", "uma_authorization",
             "QUERY_LAKEHOUSE"]
}
```

**Inner — Keycloak layer.** Identity data:

```json
{
  "preferred_username": "cms-supervisor@tazama.org",
  "email": "cms-supervisor@tazama.org",
  "azp": "auth-lib-client",
  "aud": ["realm-management", "account"],
  "tenant_id": "DEFAULT",
  "realm_access":   { "roles": ["CMS_SUPERVISOR", "QUERY_LAKEHOUSE", ...] },
  "resource_access": {
      "realm-management": { "roles": ["view-users","query-groups","query-users"] },
      "account":          { "roles": ["manage-account", ...] }
  }
}
```

Trace `CMS_SUPERVISOR` upward: it lives in `realm_access.roles` (inner), gets flattened
by `mapTazamaRoles` into `claims` (outer), and is what the guard checks in Part 5.

### 4.1 Standard JWT claims

| Claim | Meaning | Value here |
|---|---|---|
| `iss` | Issuer | `http://10.10.80.18:8080/realms/tazama` |
| `sub` | Subject (user id) | UUID — becomes `clientId` |
| `exp` | Expiry (unix seconds) | ~8h out |
| `iat` | Issued at | login time |
| `aud` | Audience | `realm-management`, `account` |
| `azp` | Authorized party | `auth-lib-client` |
| `sid` | Session id | ties to Keycloak session |

`exp` is what makes short-lived tokens safe: a leaked token dies on its own.
This deployment issues **30000 s (~8h20m)** — verifiable:

```bash
python3 -c "
import sys,json,base64,datetime
t='$TOKEN'.split('.')[1]; t+='='*(-len(t)%4)
d=json.loads(base64.urlsafe_b64decode(t))
print('lifetime (s):', d['exp']-d['iat'])
print('expires:', datetime.datetime.fromtimestamp(d['exp']))"
```

### 4.2 Proving the signature chain

The decisive demonstration of RS256. The **outer** token verifies against the CMS's
public key; the **inner** one does not, because Keycloak signed it with a different key:

The script must live inside `backend/` so Node resolves `jsonwebtoken` from its
`node_modules` — a copy in `/tmp` fails with `Cannot find module`.

```bash
cd backend && cat > verify.tmp.ts <<'SCRIPT'
import * as fs from 'node:fs';
import * as jwt from 'jsonwebtoken';
const token = process.argv[2];
const pub = fs.readFileSync('public.pem');
try { jwt.verify(token, pub); console.log('OUTER: VALID (RS256, Tazama key)'); }
catch (e: any) { console.log('OUTER FAILED:', e.message); }
const outer: any = jwt.decode(token);
try { jwt.verify(outer.tokenString, pub); console.log('INNER: valid (unexpected!)'); }
catch (e: any) { console.log('INNER: fails as expected —', e.message); }
SCRIPT
npx ts-node --compiler-options '{"module":"commonjs"}' verify.tmp.ts "$TOKEN"
rm -f verify.tmp.ts
```

```
OUTER: VALID (RS256, Tazama key)
INNER: fails as expected — invalid signature
```

That is not a bug — it's the architecture working. Two issuers, two keys, two trust
domains. The inner token's header carries
`kid: -otR9UaDJWkmmwvtIVowJvPAihZO7YmLSWUgSO38tSo`, which matches the RS256 entry in
Keycloak's JWKS from Part 2 exactly. To verify the inner token you'd fetch *that* key.

And when a token ages out, the same call reports:

```
OUTER FAILED: jwt expired
```

---

## Part 5 — Authorization: four gates

Authentication answered *who*. Now *may you*. Every request passes four independent
checks, and **each can reject on its own**.

```
Request
  │
  ├─▶ Gate 0: Bearer present?        → 401 "No Bearer token provided"
  ├─▶ Gate 1: Signature + expiry     → 401 "Token validation failed" / "expired"
  ├─▶ Gate 2: Claims (role)          → 401 "Missing or invalid claims"
  ├─▶ Gate 3: Supported CMS role     → 401 "No supported CMS role found"
  └─▶ Gate 4: Business-state RBAC    → 403 "cannot act on resources in status ..."
Handler
```

Note the status codes: gates 0–3 give **401** (*I don't know who you are*), gate 4 gives
**403** (*I know exactly who you are, and no*). That distinction is worth internalizing.

All of this lives in `src/guards/tazama-auth.guard.ts`.

### Gate 0 — Extract the bearer

```ts
if (!authHeader?.startsWith('Bearer ')) throw new UnauthorizedException('No Bearer token provided');
return authHeader.split(' ')[1];
```

```bash
curl -s http://localhost:3090/api/v1/evidence/task/1000            # 401
curl -s -H "Authorization: Bearer garbage" \
     http://localhost:3090/api/v1/evidence/task/1000               # 401 Invalid token format
```

### Gate 1 — Cryptographic validation

`validateTokenAndClaims` (from `auth-lib`) calls `verifyToken`, which does the real work:

```js
const publicKey = fs.readFileSync(authLibConfig.certPathPublic);
const verifyRes = jwt.verify(signedToken, publicKey);   // throws on bad sig OR expiry
```

`jwt.verify` checks the signature *and* `exp` together. The guard maps
`TokenExpiredError` to a distinct message so clients know to re-login rather than
re-authenticate from scratch.

### Gate 2 — Claims

Controllers declare requirements with decorators (`src/decorators/auth.decorator.ts`):

```ts
export const RequireSupervisorRole = () => RequireAnyClaims(TazamaClaims.CMS_SUPERVISOR);
export const RequireInvestigatorOrSupervisorRoleOrComplianceRole = () =>
  RequireAnyClaims(CMS_INVESTIGATOR, CMS_SUPERVISOR, CMS_COMPLIANCE_OFFICER);
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);   // skips all gates
```

Two modes, and the difference is a classic source of bugs:

- `@RequireClaims(a, b)` — **AND**, every claim required
- `@RequireAnyClaims(a, b)` — **OR**, one suffices

> The guard's own comment warns: *"required claims take precedence… Use either
> `@RequireClaims` OR `@RequireAnyClaims`, not both."* Silently ignoring one of two
> stacked decorators is exactly how a permission check becomes weaker than it looks.

The guard reads them reflectively and validates against the token's `claims`:

```ts
const { requiredClaims, anyClaims } = this.getClaimsFromDecorators(context);
validated = validateTokenAndClaims(token, claimsToValidate);
```

### Gate 3 — Role resolution

Keycloak roles are numerous; CMS recognizes four:

```ts
const supportedRoles = new Set(['CMS_INVESTIGATOR','CMS_SUPERVISOR','CMS_COMPLIANCE_OFFICER','CMS_ADMIN']);
const actorRole = realmRoles?.find(r => supportedRoles.has(r));
if (!actorRole) throw new UnauthorizedException('No supported CMS role found in token');
```

The guard then builds an `AuthenticatedUser` and attaches it to `request.user` —
`tenantId`, `userId`, `actorRole`, `actorEmail`, `sourceIP` (for audit),
and `allowedStatuses`. Everything downstream reads from this object, never from the
raw token.

### Gate 4 — State-aware RBAC

The most interesting layer, and the one generic tutorials never cover. Having the right
*role* is not enough; the **resource's current state** must also permit the action.
Defined in `src/utils/rbac/permissionMatrix.json` (22 endpoints):

```json
"POST /api/v1/evidence/upload": {
  "tier2": {
    "description": "Uploads evidence for a case or task. Allowed while case is active.",
    "rolePermissions": {
      "CMS_INVESTIGATOR":       { "allowedCurrentStatuses": ["STATUS_20_IN_PROGRESS"] },
      "CMS_SUPERVISOR":         { "allowedCurrentStatuses": ["STATUS_20_IN_PROGRESS"] },
      "CMS_COMPLIANCE_OFFICER": { "allowedCurrentStatuses": ["STATUS_82_CLOSED_CONFIRMED"] }
    }
  }
}
```

Read that carefully — it encodes real regulatory logic. An investigator may add evidence
only while a case is *in progress*; a compliance officer may add it only *after closure*.
Opposite windows, by design.

Enforced in `src/utils/rbac/rbacHelper.ts`:

```ts
if (perms.allowedCurrentStatuses.length === 0) return { allowed: true };   // no restriction
if (!perms.allowedCurrentStatuses.includes(currentStatus))
  return { allowed: false, reason: `Role "${role}" cannot act on resources in status "${currentStatus}"...` };
```

See it fire — this is a **403**, meaning authentication fully succeeded:

```bash
curl -s -X POST http://localhost:3090/api/v1/evidence/upload \
  -H "Authorization: Bearer $TOKEN" \
  -F "files=@/tmp/probe.pdf;type=application/pdf" \
  -F "taskId=1031" -F "evidenceType=OTHER"
```

```json
{"message":"Role \"CMS_SUPERVISOR\" cannot act on resources in status \"STATUS_82_CLOSED_CONFIRMED\" at POST /api/v1/evidence/upload",
 "error":"Forbidden","statusCode":403}
```

The `_meta.caseStatuses` block in the matrix documents the full lifecycle —
`STATUS_00_DRAFT` → `01_PENDING_CASE_CREATION_APPROVAL` → `02_READY_FOR_ASSIGNMENT` →
`10_ASSIGNED` → `20_IN_PROGRESS` → `22_PENDING_FINAL_APPROVAL` → `82_CLOSED_CONFIRMED`.

---

## Part 6 — Multi-tenancy

`tenantId` rides in both token layers and is extracted by the guard on every request.
Services scope queries by it, so a `DEFAULT` user cannot read another tenant's data
even with a perfectly valid token.

Keycloak models tenants as a **three-tier group hierarchy** — visible in
`fetchUsersByRole`:

```
Group (e.g. "investigations")
└── Role sub-group (e.g. "CMS_INVESTIGATOR")
    └── Tenant sub-group  (attributes.TENANT_ID = ["DEFAULT"])
        └── members
```

```js
const tier2Groups  = await this.fetchSubGroups(decodedToken, groupDetails[0].id);
const roleGroup    = tier2Groups.find(g => g.name === roleName);
const tier3Groups  = await this.fetchSubGroups(decodedToken, roleGroup.id);
const tenantGroup  = tier3Groups.find(g => g.attributes?.TENANT_ID?.includes(decodedToken.tenantId));
```

This is why `generateTazamaToken` **hard-fails** on a missing tenant:

```js
if (!decodedToken.tenant_id) throw new Error('Token is missing required tenant_id claim');
```

A token without a tenant could not be safely scoped, so the system refuses to mint one —
fail closed, never open.

---

## Part 7 — Debugging auth

### Decode any token
```bash
echo "$TOKEN" | cut -d. -f2 | base64 -d 2>/dev/null | python3 -m json.tool
```

### Error → cause

| Message | Gate | Meaning |
|---|---|---|
| `No Bearer token provided` | 0 | Missing/malformed `Authorization` header |
| `Invalid token format` | 0/1 | Not three dot-separated segments |
| `Token has expired. Please log in again.` | 1 | `exp` passed — re-login |
| `Token validation failed` | 1 | Bad signature, or wrong public key |
| `Missing or invalid claims: X` | 2 | Role absent from `claims` |
| `No supported CMS role found in token` | 3 | Keycloak user lacks a CMS_* realm role |
| `cannot act on resources in status "X"` | 4 | **403** — role ok, resource state wrong |
| `Token is in the wrong format, received object` | — | Auth service: Keycloak returned no usable `access_token` (often bad credentials) |
| `Token is missing required tenant_id claim` | — | Keycloak user misconfigured — no tenant |

### Health checks
```bash
ping -c 2 10.10.80.18
curl -s -o /dev/null -w "keycloak %{http_code}\n" http://10.10.80.18:8080/realms/tazama
# auth service is POST-only: a GET returns 404, which still proves it is up.
curl -s -o /dev/null -w "authsvc  %{http_code} (404 = up)\n" http://10.10.80.18:3020/v1/auth/login
curl -s -o /dev/null -w "cms      %{http_code}\n" http://localhost:3090/api/docs
```

### Talk to Keycloak directly
Bypasses Tazama entirely — useful for isolating whether a failure is Keycloak's or Tazama's:
```bash
curl -s -X POST \
  "http://10.10.80.18:8080/realms/tazama/protocol/openid-connect/token" \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  -d 'grant_type=password' \
  -d 'client_id=auth-lib-client' \
  -d 'client_secret=<CLIENT_SECRET>' \
  -d 'username=cms-supervisor@tazama.org' \
  -d 'password=abc.123'
```

---

## Part 8 — Design lessons

Transferable principles, each demonstrated by something above:

1. **Separate authn from authz.** Different questions, different failure codes (401 vs 403).
2. **Asymmetric keys bound blast radius.** Verifiers can't forge. Distribute public keys freely; guard the private one.
3. **Adapt at the boundary.** Keycloak's schema stops at the provider file. Swapping IdPs touches one module.
4. **Short expiry over revocation lists.** A leaked token dies by itself; no distributed blacklist needed.
5. **Fail closed.** Missing `tenant_id` → refuse to issue, rather than issue something unscopeable.
6. **Authorization is not just roles.** Gate 4 shows real systems need *state*, not only identity.
7. **Layer defenses.** Four gates, each sufficient to reject. One bug doesn't open the door.
8. **A JWT is signed, not secret.** Integrity ≠ confidentiality.

### Where this deployment departs from best practice

Honest reading of the trade-offs actually present:

- **`password` grant** instead of `authorization_code` — the backend handles raw passwords, and it's deprecated in OAuth 2.1. Chosen for non-interactive/testable APIs.
- **No refresh-token rotation in the CMS flow.** Keycloak returns a `refresh_token`, but the Tazama token embeds only `access_token`; at expiry the user re-logs in.
- **Nested token size.** Carrying the full Keycloak JWT makes every request header ~3.2 KB.
- **`http://` throughout.** Tokens cross the network in cleartext — acceptable only on a trusted internal network; TLS is required before this leaves it.

---

## Appendix — Source map

| Concern | File |
|---|---|
| Sign / verify (RS256) | `node_modules/@tazama-lf/auth-lib/lib/services/jwtService.js` |
| Claim validation | `node_modules/@tazama-lf/auth-lib/lib/services/tazamaService.js` |
| Provider registry | `node_modules/@tazama-lf/auth-lib/lib/services/tazamaAuthentication.js` |
| Keycloak exchange | `node_modules/@tazama-lf/auth-lib-provider-keycloak/lib/provider.js` |
| Keycloak endpoints | `…/auth-lib-provider-keycloak/lib/utils/constants.js` |
| Request guard (gates 0–3) | `backend/src/guards/tazama-auth.guard.ts` |
| Claim decorators | `backend/src/decorators/auth.decorator.ts` |
| State RBAC (gate 4) | `backend/src/utils/rbac/rbacHelper.ts` |
| Permission matrix | `backend/src/utils/rbac/permissionMatrix.json` |
| Login proxy | `backend/src/modules/auth/auth.service.ts` |
| Public key | `backend/public.pem` |

### Environment variables

| Var | Used by | Purpose |
|---|---|---|
| `AUTH_URL` | auth service | Keycloak base URL |
| `KEYCLOAK_REALM` | auth service | Realm name (`tazama`) |
| `CLIENT_ID` | auth service | Keycloak client (`auth-lib-client`) |
| `CLIENT_SECRET` | auth service | Client secret |
| `CERT_PATH_PRIVATE` | auth service **only** | RS256 signing key |
| `CERT_PATH_PUBLIC` | every service | RS256 verification key |
| `TAZAMA_AUTH_URL` | CMS | Auth service base (`http://10.10.80.18:3020/v1/auth`) |
| `AUTH_PUBLIC_KEY_PATH` | CMS | Path to `public.pem` |

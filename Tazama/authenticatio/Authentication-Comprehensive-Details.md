<!-- SPDX-License-Identifier: Apache-2.0 -->

# Tazama Authentication — Comprehensive Technical Details

This document is the deep-dive companion to [Authentication-Executive-Summary.md](Authentication-Executive-Summary.md). It covers every component involved in Tazama authentication and authorization, file-by-file, with the actual code paths, data shapes, configuration, and known quirks.

Source repos covered: `auth-service`, `auth-lib`. Consumer usage surveyed across `admin-service`, `tms-service`, `event-monitoring-service`, `data-enrichment-service`, `connection-studio-backend`, `Model-management`, `rule-studio`.

---

## 1. Repository roles

### 1.1 `auth-lib` (`@tazama-lf/auth-lib`)

A shared TypeScript library, installed as a dependency by nearly every Tazama service. It has two responsibilities that are logically separate but shipped in one package:

1. **Provider hosting** — a generic plugin system (`TazamaAuthentication` class) that dynamically loads and drives an external "auth provider" package (e.g. Keycloak) to perform the actual credential exchange.
2. **Token services** — stateless JWT signing/verification and claim/tenant extraction helpers, used by literally every protected service to authorize incoming requests.

Public surface exported from `auth-lib/src/index.ts`:

```ts
export { AuthProviderConfig, JwtService, TazamaAuthentication };
export type { TazamaAuthProvider, TazamaToken };
export { validateTokenAndClaims, extractTenant };
export type { ClaimValidationResult };
```

Also directly importable (not re-exported from the top-level index, but used by consumers): `@tazama-lf/auth-lib/lib/services/jwtService` → `verifyToken`, `signToken`.

### 1.2 `auth-service`

A minimal Fastify HTTP service whose sole job is credential exchange: accept a username/password, drive `auth-lib`'s active provider to authenticate against the configured IdP, and return a signed Tazama JWT. It also exposes a couple of Keycloak group/role lookup endpoints used for admin tooling.

### 1.3 `auth-lib-provider-keycloak` (external package, not in this checkout)

Referenced by both repos' `package.json`/`.env.template` as `@tazama-lf/auth-lib-provider-keycloak` (auth-service pins `4.0.0`). This package is the concrete Keycloak implementation of the `TazamaAuthProvider` interface, dynamically imported by `auth-lib` at runtime based on the `AUTH_PROVIDER` env var. It is what actually calls Keycloak's token endpoint.

**Important nuance found in code**: `auth-lib/src/services/keycloakService.ts` and `authenticationFactory.ts` contain a *second*, apparently legacy `KeycloakService`/`AuthenticationService` implementation bundled directly inside `auth-lib` itself. This code is never exported from `auth-lib/src/index.ts` and is not wired into `TazamaAuthentication`'s dynamic provider registry — it appears to be dead/vestigial code predating the externalization of the Keycloak provider into its own package. Do not confuse it with the real, currently-used `auth-lib-provider-keycloak` package.

---

## 2. auth-lib internals

### 2.1 `TazamaAuthentication` (`src/services/tazamaAuthentication.ts`)

The plugin host. State machine with four stages per provider: **configured → registered → instantiated → active**.

```ts
class TazamaAuthentication {
  readonly providerConfig = new Set<string>();          // provider names requested
  readonly providerRegistry = new Map<string, unknown>(); // provider constructors, post dynamic-import
  readonly providerInstances = new Map<string, TazamaAuthProvider>(); // instantiated providers
  private activeInstance: undefined | string;            // which instance getToken() delegates to
}
```

- **`constructor(providerList?: string[])`** — calls `configureProvider()` for each name passed in (e.g. `new TazamaAuthentication([config.AUTH_PROVIDER])`, so in practice a single-element array from the `AUTH_PROVIDER` env var).
- **`configureProvider(name)`** — adds to `providerConfig` set. Returns `false` if already configured (idempotency guard).
- **`init()`** — the method actually called at service startup. Throws `Error('No Provider Config')` if nothing configured. Otherwise, for each configured provider, calls `registerProvider()` and, if successful, `instantiateProvider()`.
- **`registerProvider(name)`** — dynamically imports the package (`await import(providerName)` via `providerHelper.dynamicPackageImport`), expects it to export a `register(): ProviderConstructor` function, calls it, and stores `providerClass.constructor` in `providerRegistry`. Returns `false` (does not throw) on any failure: import failure, or missing/non-function `register` export.
- **`instantiateProvider(name)`** — looks up the constructor in `providerRegistry`, `new`s it, stores the instance in `providerInstances`, and calls `setActive(name)`. Returns `false` if no constructor found or if already instantiated (no re-instantiation).
- **`setActive(name)`** — marks a given instantiated provider as the one `getToken()` delegates to. **Only one provider can be active at a time** — if multiple providers are configured, only the last one instantiated during `init()`'s loop ends up active (loop order follows `Set` insertion order).
- **`getToken(...args)`** — delegates to the active instance's `getToken(...args)`. Returns `''` (not an error) if there is no active instance — callers (`auth-service/src/logic.service.ts`) treat falsy token as failure and throw `Could not get Tazama token for username: ...`.

**Contract for building a custom provider** (`iTazamaProvider.ts`):

```ts
interface TazamaAuthProvider<TgetTokenArgs extends unknown[] = unknown[]> {
  getToken: (...args: TgetTokenArgs) => Promise<string>;
}
type ProviderConstructor = new (...args: unknown[]) => TazamaAuthProvider<unknown[]>;
```

Generics let a provider define whatever `getToken` signature it needs (e.g. `(username, password)` for Keycloak's password grant), while `TazamaAuthentication.getToken(...args: unknown[])` stays provider-agnostic and just forwards args.

A custom provider package must export a `register()` function:

```ts
function register(): TazamaAuthProvider<[string, string]> {
  return CustomProvider.prototype;
}
export { register };
```

### 2.2 `providerHelper.ts`

- `dynamicPackageImport(packageName): Promise<unknown>` — thin wrapper over `await import(packageName)`. This is the actual mechanism by which `AUTH_PROVIDER=@tazama-lf/auth-lib-provider-keycloak` becomes a live Node.js module load at runtime — no compile-time dependency link between `auth-lib` and any specific provider package.
- `listAvailableProviders(filter = '')` — reads the **caller's** `process.cwd()/package.json` dependencies and filters by substring match. Utility/introspection only; not part of the core flow. Swallows JSON parse errors silently (returns `[]`).

### 2.3 `jwtService.ts` — the cryptographic core

```ts
signToken(token: TazamaToken): string
```
- Reads the private key from `authLibConfig.certPathPrivate` (sync `fs.readFileSync`).
- Throws `Error('Missing or Corrupted Private Key')` if the read fails.
- Signs with `jsonwebtoken`'s `jwt.sign(token, privateKey, { algorithm: 'RS256' })`. Note: **no explicit `expiresIn`** is passed here — token expiry (`exp`) is instead a field already present on the `TazamaToken` payload object itself (copied over from the underlying Keycloak token's `exp` by the provider before signing), so effectively the Tazama token inherits the source IdP token's expiry window.

```ts
verifyToken(signedToken: string): string | TazamaToken | undefined
```
- Reads the public key from `authLibConfig.certPathPublic` (sync `fs.readFileSync`, **no try/catch** around this specific read — a missing public key file throws an uncaught `ENOENT` here, not the friendly "Missing or Corrupted" error `signToken` gives).
- Calls `jwt.verify(signedToken, publicKey)`.
- On `TokenExpiredError` → throws `Error('401 Unauthorized - token expired')`.
- On any other verification error (bad signature, malformed token, wrong algorithm) → throws `Error('401 Unauthorized - ' + err.message)`.
- **Contains leftover `console.log` debug statements** (lines 33, 35, 37, 39) that print the public key and verification result to stdout on every single call — a logging/security hygiene issue worth cleaning up (public key exposure is low-risk since it's public by design, but it's noisy and non-conforming to the rest of the codebase's structured `loggerService` pattern).

Config source (`iAuthLibConfig.ts`):
```ts
interface IAuthLibConfig { certPathPrivate: string; certPathPublic: string; }
```
Populated from `process.env.CERT_PATH_PRIVATE` / `process.env.CERT_PATH_PUBLIC` at module load, via `dotenv` loading `../.env` relative to the compiled file location.

### 2.4 `tazamaService.ts` — claim validation

```ts
function validateTokenAndClaims(token: string, claimList: string[]): ClaimValidationResult
```
- Calls `verifyToken(token)` (will throw upward on invalid/expired token — callers must catch).
- If the decoded result isn't a valid object (e.g. `typeof decodedToken === 'string'`), returns a result object with **every** requested claim set to `false` rather than throwing.
- Otherwise, for each claim in `claimList`, checks `decodedToken.claims.includes(claim)` and returns a map:
  ```ts
  type ClaimValidationResult = Record<string, boolean>;
  // e.g. { "LISTCUSTOMERS": true, "DELETECUSTOMERS": false }
  ```
- This is a **pure membership check** against the flat `claims` array embedded in the token at login time — there is no live re-check against Keycloak, no wildcard/hierarchy logic, no role inheritance evaluation at this layer (that mapping already happened once, at token-issuance time, in the provider's `mapTazamaRoles`).

### 2.5 `tenantService.ts` — tenant extraction

```ts
function extractTenant(authenticated: boolean, authorizationHeader?: string): { success: boolean; tenantId?: string }
```
- `authenticated = false` → always returns `{ success: true, tenantId: 'DEFAULT' }` regardless of any header passed. This is the escape hatch for running the ecosystem with authentication disabled (dev/test), controlled per-consuming-service by a local `AUTHENTICATED` config flag (not part of auth-lib itself).
- `authenticated = true`, no header → `{ success: false }` (no `tenantId`).
- `authenticated = true`, header present → splits `"Bearer <token>"` on space, takes index `[1]` as the token, calls `verifyToken()` (uncaught — propagates), and returns `{ success: true, tenantId: decodedToken.tenantId }`.
- Edge case observed in the auth-lib test suite: a header of exactly `"Bearer"` (no trailing token) or `"Bearer "` still proceeds to call `verifyToken(undefined)` / `verifyToken('')` — behavior here depends entirely on how `jwt.verify` handles an empty/undefined argument (effectively an invalid-token error path), not a distinct guarded case.

### 2.6 The `TazamaToken` shape (`iTazamaToken.ts`)

```ts
interface TazamaToken extends jwt.JwtPayload {
  exp: number;        // expiry, inherited from source IdP token
  sid: string;        // session id (Keycloak sid, or '' if absent)
  iss: string;        // issuer, from source IdP token
  tokenString: string;// the ORIGINAL Keycloak access token, preserved verbatim
  clientId: string;   // Keycloak "sub" (subject / user id)
  tenantId: string;   // tenant scoping, from Keycloak custom claim or 'DEFAULT'
  claims: string[];   // flattened realm + client roles
}
```

Why `tokenString` matters: downstream code (e.g. `auth-service/src/logic.service.ts`'s `fetchUserGroupDetails`) uses `decodedToken.tokenString` to make **authenticated calls back to Keycloak's Admin REST API** (`/admin/realms/{realm}/groups`, etc.) using the user's own original Keycloak bearer token — i.e., the Tazama JWT is a superset wrapper around the original Keycloak token, not a full replacement of it. This means Tazama-token expiry and Keycloak-token expiry are the same instant (`exp` is carried through unchanged), but it also means a Tazama JWT is only as good, against Keycloak's own APIs, as the Keycloak session it was minted from.

---

## 3. The Keycloak provider (auth-lib-provider-keycloak)

Not present in this checkout as source, but its interface and behavior are fully inferable from `auth-lib`'s legacy bundled copy (`keycloakService.ts`) plus the test fixtures, and are consistent with the documented contract:

### `getToken(username, password)`

1. Builds a form-encoded body:
   ```
   client_id=<CLIENT_ID>
   client_secret=<CLIENT_SECRET>
   username=<username>
   password=<password>
   grant_type=password
   ```
2. `POST {AUTH_URL}/realms/{KEYCLOAK_REALM}/protocol/openid-connect/token`
   — this is Keycloak's standard OAuth2 **Resource Owner Password Credentials (ROPC)** grant endpoint.
3. Parses the JSON response for `access_token`, `token_type`, `refresh_token`.
4. Decodes the Keycloak `access_token` (`jwt.decode`, **not verified** at this stage — trust is implicit because it just came directly from Keycloak over the client's own authenticated connection).
5. Validates presence of `sub`, `iss`, `exp` on the decoded token; throws descriptive errors if missing/malformed.
6. Builds a `TazamaToken`:
   - `clientId` ← Keycloak `sub`
   - `iss` ← Keycloak `iss`
   - `sid` ← Keycloak `sid` claim, or `''`
   - `exp` ← Keycloak `exp` (unchanged — same expiry as the Keycloak token)
   - `tokenString` ← the raw Keycloak access token (kept for later Admin-API calls)
   - `tenantId` ← custom claim `tenantId` or `TENANT_ID` on the Keycloak token, else `'DEFAULT'`
   - `claims` ← `mapTazamaRoles()`: flattens **every** role from `resource_access.*.roles` (client roles, across all clients present) plus `realm_access.roles` (realm roles) into one flat string array
7. Signs the resulting `TazamaToken` via `auth-lib`'s `signToken()` (RS256, **auth-service/provider's private key** — distinct from whatever key Keycloak itself used to sign the original token) and returns the signed string.

**Trust boundary note**: Because step 4 decodes without verifying Keycloak's own signature, the security guarantee here rests entirely on the fact that this code only runs against a response that came directly back over a network call *this process itself made* to a trusted, configured `AUTH_URL` — there's no path for an attacker-supplied Keycloak token to reach this decode step.

### Claim naming convention

Observed in the auth-lib test fixture JWT and confirmed by admin-service's route-claim generation:
```
{HTTP_METHOD}{ROUTE_PATH with / → _, uppercased}
```
Examples seen in test data: `POST_V1_EVALUATE_ISO20022_PAIN_001_001_11`, `POST_V1_EVALUATE_ISO20022_PACS_008_001_10`, `default-roles-tazama`, `offline_access`, `uma_authorization`. Admin-service generates these programmatically per CRUD route, e.g. `LIST{RESOURCE}`, `GET{RESOURCE}`, `POST{RESOURCE}`, `PUT{RESOURCE}`, `DELETE{RESOURCE}`, `POST{RESOURCE}_ACTIVATE` / `_DEACTIVATE` (see §5.1). These map to Keycloak realm roles or client roles assigned to users/groups in the Keycloak admin console.

---

## 4. auth-service — full request lifecycle

### 4.1 Startup (`src/index.ts`)

```ts
export const authService: TazamaAuthentication = new TazamaAuthentication([config.AUTH_PROVIDER]);
...
if (process.env.NODE_ENV !== 'test') {
  await authService.init();   // dynamically imports and instantiates the Keycloak provider
  await serve();               // starts Fastify listening
}
```
If `authService.init()` throws (e.g. provider package not installed, `AUTH_PROVIDER` misconfigured), the process logs the error and calls `process.exit(1)` — auth-service **refuses to start** without a working provider.

### 4.2 Fastify wiring (`src/clients/fastify.ts`)

- Registers `@fastify/cors` with fully open CORS (`origin: '*'`, all methods/headers) — worth flagging for hardening in production deployments.
- Loads `src/schemas/credentials.json` as an Ajv-validated Fastify schema (`credentialsSchema`), enforcing `username`/`password` as required non-empty strings on the login body, with `removeAdditional: 'all'` (strips unexpected fields) and `useDefaults: true`.
- Registers all routes via `Routes` (`src/router.ts`).

### 4.3 Routes (`src/router.ts`)

| Method | Path | Handler | Auth required? |
|---|---|---|---|
| GET | `/` | `handleHealthCheck` | No |
| GET | `/health` | `handleHealthCheck` | No |
| POST | `/v1/auth/login` | `LoginHandler` (schema-validated body) | No (this *is* the login endpoint) |
| GET | `/v1/auth/user/:rolename` | `FetchUsersByRoleHandler` | Yes (Bearer token) |
| GET | `/v1/auth` | `FetchGroup` | Yes (Bearer token) |

### 4.4 `LoginHandler` (`src/app.controller.ts`)

```ts
const body = req.body as authBody;             // { username, password }
const response = await getTazamaToken(body);   // logic.service.ts
reply.code(200).send(response);                // raw JWT string as response body
```
Error handling:
- If the thrown error message includes `"Account temporarily locked due to too many failed login attempts."` → replies `429`.
- Otherwise → replies `401` with `{ message: error.message }`.

Note the **string-match-based** error discrimination — the 429 branch depends on Keycloak's exact English error text propagating unchanged through the provider and `auth-lib`. This is brittle if Keycloak's error message wording, or the provider's error-wrapping, ever changes, or if Keycloak is localized to a non-English realm.

### 4.5 `getTazamaToken` (`src/logic.service.ts`)

```ts
export const getTazamaToken = async (auth: authBody): Promise<string> => {
  const token = await authService.getToken(auth.username, auth.password);
  if (!token) {
    throw new Error(`Could not get Tazama token for username: ${auth.username}`);
  }
  return token;
};
```
Delegates straight into the `TazamaAuthentication` instance created at startup — this is the only place `auth-service` invokes `auth-lib`'s provider-hosting machinery.

### 4.6 `FetchUsersByRoleHandler` / `FetchGroup` — admin lookups

Both:
1. Extract `Authorization: Bearer <token>` from the request header (manual split on space — 401 if missing).
2. `verifyToken(token)` (imported directly from `@tazama-lf/auth-lib/lib/services/jwtService`, bypassing the `validateTokenAndClaims` claim-check helper — these two routes only check the token is *valid*, not that it carries any specific claim).
3. `extractTenant(true, authorizationHeader)` — re-derives tenant, must succeed or 401.
4. Call into `logic.service.ts`'s Keycloak Admin API helpers (`fetchUserGroupDetails`, `fetchSubGroups`, `fetchGroupMembers`), using `decodedToken.tokenString` (the original Keycloak access token) as the bearer credential against Keycloak's own Admin REST API — **not** the auth-lib-provider abstraction, direct `fetch()` calls hardcoded to Keycloak's Admin API shape (`/admin/realms/{realm}/groups...`).
5. `newFetchUsersByRole` additionally filters returned Keycloak groups by matching `group.attributes.TENANT_ID` against the caller's own `tenantId` from their token — i.e., a user can only look up group membership within groups tagged as belonging to their own tenant, enforced client-side in this loop rather than via a Keycloak-side query filter.

These two endpoints are a Keycloak-specific escape hatch bolted onto auth-service for admin UI needs (e.g. connection-studio or rule-studio user/role management screens) — they are **not part of the generic, provider-agnostic auth-lib contract**; they assume Keycloak's REST shape directly.

---

## 5. Downstream consumption pattern (every other service)

Surveyed consumers: `admin-service`, `tms-service`, `event-monitoring-service`, `data-enrichment-service`, `connection-studio-backend`, `Model-management/backend`, `rule-studio/backend`. All depend on `@tazama-lf/auth-lib` directly (versions vary — see §7, a notable version-drift risk).

### 5.1 admin-service — the fullest example

**`src/middleware/tenantMiddleware.ts`**:
```ts
export const validateTenantMiddleware = async (req, reply) => {
  if (!configuration.AUTHENTICATED) {
    (req as ITenantRequest).tenantId = 'DEFAULT';
    return;
  }
  const response = extractTenant(configuration.AUTHENTICATED, req.headers.authorization);
  if (!response.success || !response.tenantId) {
    reply.code(401).send({ error: 'Unauthorized' });
    return;
  }
  (req as ITenantRequest).tenantId = response.tenantId;
};
```

**`src/auth/authHandler.ts`**:
```ts
export const tokenHandler = (claim: Claim) => async (request, reply) => {
  const authHeader = request.headers.authorization;
  const claims = normalizeClaims(claim);
  if (!authHeader?.startsWith('Bearer ') || claims.length === 0) {
    reply.code(401).send({ error: 'Unauthorized' }); return;
  }
  const token = authHeader.split(' ')[1];
  const validated = validateTokenAndClaims(token, claims);
  if (!hasAnyClaim(claims, validated)) {
    reply.code(401).send({ error: 'Unauthorized' }); return;
  }
  // proceeds — logs "Authenticated"
};
```

Both are wired as Fastify `preHandler` hooks, conditionally on a config flag:
```ts
preHandler: configuration.AUTHENTICATED
  ? [validateTenantMiddleware, tokenHandler(privilege)]
  : [validateTenantMiddleware]
```
found repeated across `service-channel-routes.ts` and `crud-schema.ts` for every generated CRUD route (LIST/GET/POST/PUT/DELETE + custom ACTIVATE/DEACTIVATE actions), with the required claim string auto-derived from the route's HTTP method + resource path (e.g. `POST{PREFIX}_ACTIVATE`).

This is the canonical **two-step preHandler chain** used ecosystem-wide: tenant resolution first, then claim-based authorization second — tenant resolution happens even when `AUTHENTICATED` is off (defaults to `'DEFAULT'`), so downstream handlers can always rely on `req.tenantId` being populated regardless of auth mode.

### 5.2 Other services

The same `extractTenant` / `validateTokenAndClaims` pair (imported from `@tazama-lf/auth-lib`) recurs in `tms-service`, `event-monitoring-service`, `data-enrichment-service`, `connection-studio-backend`, and `Model-management/backend` — each wires its own local middleware equivalents around the same two primitives. None of these services perform login or hold Keycloak credentials; they are pure token verifiers.

---

## 6. Configuration reference

### auth-service `.env`

| Variable | Consumed by | Purpose |
|---|---|---|
| `HOST`, `PORT` | auth-service | Fastify bind address |
| `AUTH_PROVIDER` | auth-lib (`TazamaAuthentication`) | npm package name to dynamically `import()` as the active provider, e.g. `@tazama-lf/auth-lib-provider-keycloak` |
| `CERT_PATH_PRIVATE` | auth-lib `jwtService.signToken` | Path to RSA private key (PEM) used to sign issued Tazama tokens |
| `CERT_PATH_PUBLIC` | auth-lib `jwtService.verifyToken` | Path to RSA public key (PEM) — used by auth-service's own `/v1/auth/user/:rolename` and `/v1/auth` routes, which verify tokens they receive |
| `AUTH_URL` | auth-lib-provider-keycloak | Base URL of the Keycloak server |
| `KEYCLOAK_REALM` | auth-lib-provider-keycloak | Keycloak realm name |
| `CLIENT_ID`, `CLIENT_SECRET` | auth-lib-provider-keycloak | Keycloak client credentials used for the password-grant exchange |

### Downstream consuming services (typical)

| Variable | Purpose |
|---|---|
| `CERT_PATH_PUBLIC` | Public key to verify incoming Tazama JWTs (private key never needed/present here) |
| `AUTHENTICATED` (service-specific config, e.g. admin-service) | Master switch — `false` bypasses all token/claim checks and forces `tenantId = 'DEFAULT'` |

**Key asymmetry to preserve operationally**: only auth-service's deployment should ever have `CERT_PATH_PRIVATE` populated / the private PEM mounted. Every other service should be provisioned with only the public key. Leaking the private key anywhere else breaks the entire trust model (anyone with it could mint arbitrary valid Tazama tokens for any tenant/claim set).

---

## 7. Known issues / risks worth tracking

1. **Version drift across the ecosystem**: `auth-lib` is pinned inconsistently — `auth-service` at `2.2.0-rc.1`, `tms-service` at `3.0.0`, `admin-service` at `4.0.0-rc.4`, `data-enrichment-service` at `^2.1.0`, `event-monitoring-service` at `2.2.0-rc.1`. If the `TazamaToken` shape or `validateTokenAndClaims`/`extractTenant` signatures change between major versions, different services could disagree on token interpretation simultaneously in the same deployment.
2. **Dead code in auth-lib**: `authenticationFactory.ts` (`AuthenticationService`) and `keycloakService.ts` (`KeycloakService`) are bundled but unexported/unused — real Keycloak logic lives in the external `auth-lib-provider-keycloak` package. Confusing for new contributors; candidate for removal.
3. **Debug logging left in `jwtService.verifyToken`**: unconditional `console.log` calls print the public key and verification results on every token check — noisy, bypasses the structured logger used elsewhere, minor information-hygiene issue.
4. **Wide-open CORS on auth-service**: `origin: '*'` with all methods/headers allowed on the login endpoint.
5. **Brittle 429 detection**: auth-service's account-lockout detection is a hardcoded English substring match against the upstream error message, not a typed/coded error from the provider.
6. **`verifyToken`'s public-key file read is unguarded**: unlike `signToken` (which wraps its key read in try/catch with a friendly error), `verifyToken`'s `fs.readFileSync(authLibConfig.certPathPublic)` will throw a raw Node `ENOENT`/`EACCES` error if the public key path is misconfigured, rather than a clear "misconfigured public key" error.
7. **No token revocation / blacklist mechanism observed**: since verification is fully offline (signature + `exp` check only), a compromised or logged-out token remains valid until natural expiry — there is no session-invalidation or revocation list checked anywhere in this flow. Logout, if it exists at all in consuming UIs, is client-side token discard only.
8. **Trust in unverified Keycloak-side decode**: the provider's `generateTazamaToken` uses `jwt.decode` (no signature check) on the Keycloak access token before re-signing it as a Tazama token. Safe today because it only runs on a response the provider itself just fetched from a trusted `AUTH_URL`, but worth keeping in mind if that code path is ever refactored to accept a Keycloak token from any other source.

---

## 8. Quick file index

| File | What it defines |
|---|---|
| `auth-lib/src/services/tazamaAuthentication.ts` | Provider plugin host / lifecycle state machine |
| `auth-lib/src/services/providerHelper.ts` | Dynamic `import()` + dependency introspection |
| `auth-lib/src/services/jwtService.ts` | `signToken` / `verifyToken` (RS256) |
| `auth-lib/src/services/tazamaService.ts` | `validateTokenAndClaims` |
| `auth-lib/src/services/tenantService.ts` | `extractTenant` |
| `auth-lib/src/interfaces/iTazamaToken.ts` | `TazamaToken`, `ClaimValidationResult` |
| `auth-lib/src/interfaces/iTazamaProvider.ts` | `TazamaAuthProvider`, `ProviderConstructor` contracts |
| `auth-lib/src/services/keycloakService.ts`, `authenticationFactory.ts` | Legacy/unused bundled Keycloak logic — not the live path |
| `auth-service/src/index.ts` | Startup: instantiates `TazamaAuthentication`, calls `init()`, starts Fastify |
| `auth-service/src/router.ts` | Route table |
| `auth-service/src/app.controller.ts` | HTTP handlers: `LoginHandler`, `FetchUsersByRoleHandler`, `FetchGroup` |
| `auth-service/src/logic.service.ts` | `getTazamaToken` + Keycloak Admin API helpers |
| `auth-service/src/schemas/credentials.json` | Login body validation schema |
| `admin-service/src/auth/authHandler.ts` | Canonical downstream claim-check middleware (`tokenHandler`) |
| `admin-service/src/middleware/tenantMiddleware.ts` | Canonical downstream tenant-resolution middleware |

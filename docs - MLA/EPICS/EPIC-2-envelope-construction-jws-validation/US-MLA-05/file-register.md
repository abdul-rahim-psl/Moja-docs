# US-MLA-05 — File Register

Shared integration files (`envelope-pipeline.service.ts`, `ingestion-consumer.service.ts`'s further extension, `src/index.ts`'s wiring) are listed once, at the epic level — `EPICS/EPIC-2-envelope-construction-jws-validation/file-register.md` — rather than repeated here.

| File | Why it was added / what it does |
| --- | --- |
| `src/interfaces/jws.interface.ts` | The real `FSPIOP-Signature` wire shape (`FspiopSignatureHeader`: `{signature, protectedHeader}`) and the three-outcome `PublicKeyStore` port (`found`/`not-found`/`unavailable`) — the third outcome is what makes a key-source outage distinguishable from a genuine signature failure. |
| `src/clients/public-key-store.client.ts` | `FilePublicKeyStoreClient` — the port's only implementation. File-backed, hot-reloaded via `fs.watch` so a new `<dfspId>.pem` is live with no restart; a broken store reports `unavailable` for every DFSP without clearing its last-known-good keys. |
| `src/services/jws-verification.service.ts` | `verifyJws` — real RS256/384/512 verification via Node's built-in `crypto.verify`, against `JSON.stringify(selectPayload(record))`. No dependency added; none existed to port from the POC. |
| `tools/dfsp-keys/generate-keys.ts` | Local RSA keypair generation (`npm run keys:generate -- <dfspId>`) — public key into `store/` (where `FilePublicKeyStoreClient` reads), private key into `private/` (where `capture-feeder --resign` reads). Both directories gitignored (`*.pem`/`*.key`); generates fresh, throwaway local key material only. |
| `tools/capture-feeder/resign.ts` | `resignPayload` (signs as the record's own `fspiop-source`, reusing `selectPayload` directly so the signed bytes are provably the bytes MLA verifies against) and `tamperPayload` (mutates whichever body field `selectPayload` would read, after signing — the realistic "signed, then altered" shape). |
| `tools/capture-feeder/{types,cli,apply-scenarios,build-message}.ts` | Extended with `--resign`/`--tamper-body`, following the same index-based scenario-flag pattern as `--corrupt`/`--strip-signature`. |
| `tools/README.md` | Documents the two new flags in `capture-feeder`'s flag reference. |
| `package.json` | Adds the `keys:generate` script. |
| `__tests__/jws-verification.service.test.ts` | 15 tests, genuinely generated RSA keypairs and real `crypto.sign`/`crypto.verify`: all three algorithms, tampered body, wrong key, missing/malformed/shape-invalid header, key-outage vs. not-found vs. unsupported-alg, and a malformed key making `crypto.verify` throw. |
| `__tests__/public-key-store.client.test.ts` | 6 tests against a real temporary directory — loads keys at construction, `not-found` vs. directory-missing `unavailable`, ignores non-`.pem` files, and the genuine `fs.watch` hot-reload. |

# Offline copies of the TTK simulators' remote config files

The `e2e-sim-ttk-backend` chart ships three of its config entries as **bare GitHub URLs** rather than
content (`mojaloop-helm/mojaloop-ttk-simulators/e2e-sim-ttk-backend/values.yaml`, lines 39–41). The
chart renders them verbatim into the ConfigMap `moja-e2e-sim-ttk-backend-config-default`, which is
mounted (via `subPath`) over the real file paths inside the pod. The Toolkit then resolves them over
HTTP at boot.

On `10.0.150.69` that fetch failed, and the SPEC_API on port 4040 never started — see plan §9.16/§9.19.
These are offline copies, fetched at the exact tags the chart pins, so the simulators can boot with no
network egress at all.

| File | Source | Bytes |
|---|---|---|
| `rules_response__default.json` | `mojaloop/testing-toolkit-test-cases` @ `v20.2.5` → `rules/e2e/sync-response-rules.json` | 64,891 |
| `api_definitions__mojaloop_connector_backend_2.1__api_spec.yaml` | `mojaloop/api-snippets` @ `v17.10.2` → `docs/sdk-scheme-adapter-backend-v2_1_0-openapi3-snippets.yaml` | 98,887 |
| `api_definitions__mojaloop_connector_outbound_2.1__api_spec.yaml` | `mojaloop/api-snippets` @ `v17.10.2` → `docs/sdk-scheme-adapter-outbound-v2_1_0-openapi3-snippets.yaml` | 117,678 |

**Filenames are deliberately the ConfigMap keys**, so the whole directory can be applied with
`kubectl create configmap ... --from-file=<this dir>` and the keys come out right automatically.

Two notes:

- **Use these, not the copies inside the image.** The image carries `@mojaloop/api-snippets` **18.3.0**,
  whose equivalents differ in size from the pinned `v17.10.2` (100,144 / 121,500 vs 98,887 / 117,678).
  These are the versions the chart actually asks for.
- **`rules_response__default.json` is the important one for FX.** It is the simulator's response-rule
  set — what makes the FXP actually answer an `fxQuotes` request rather than erroring. It has 16
  `fxQuotes`/`fxTransfers` rules. There is **no** copy of it anywhere in the image, unlike the two
  api_specs, so it can only come from here.
- Every `https://` inside the two api_spec YAMLs is prose inside a `description:` field. All 419 / 502
  `$ref`s are internal (`#/components/...`). Inlining them introduces no further network dependency.

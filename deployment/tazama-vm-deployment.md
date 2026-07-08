# Tazama Full-Service Deployment On VM (10.0.150.69)

Deployed the Tazama Full-Stack-Docker stack (Full-Service, DockerHub profile)
on the shared VM alongside the existing Mojaloop `ml-core-test-harness`
deployment, ahead of a ~32-hour internet-access cutoff window. Goal:
everything needed to run Tazama is cloned/pulled/cached locally so the stack
can be restarted after internet is disabled.

## Result Summary

- Tazama repo cloned, all images pulled, stack started and healthy.
- Mojaloop confirmed unaffected — still running, still healthy, uptime
  unbroken across the Tazama deployment.
- No port collisions between Tazama and Mojaloop.
- Deployed under a distinct Compose project name (`tazama`), as required.

## Prerequisites Verified / Installed

| Requirement | Status |
| --- | --- |
| Docker | Already present — `29.6.1` |
| Docker Compose | Already present — `v5.1.2` |
| Git | **Not installed** — installed via `sudo dnf install -y git` |
| OS | RHEL 8.10 (Ootpa) |
| Disk space (before) | 60G total, 16G used, 45G available |
| Disk space (after) | 60G total, 24G used, 36G available |
| Docker group / rootless access | No `docker` group exists on this VM; all docker/compose commands require `sudo` |

## Repository

```
https://github.com/tazama-lf/Full-Stack-Docker-Tazama  (branch: main)
```

Cloned to `~/Full-Stack-Docker-Tazama` on the VM (user `abdul.rahim`'s home
directory — separate from the Mojaloop harness checkout).

`TAZAMA_VERSION=3.0.0` (pinned in `.env`, not `latest` — avoids silent image
drift on a future rerun).

## Deployment Steps Taken

1. `sudo dnf install -y git`
2. `git clone https://github.com/tazama-lf/Full-Stack-Docker-Tazama -b main`
3. Reviewed `.env` and all `docker-compose.*.yaml` files for host ports,
   `container_name` values, networks, and volumes before running anything.
4. Cross-checked every discovered host port against the live VM port list
   (`sudo docker ps`, see Port Mapping below) — no collisions found.
5. `chmod +x tazama.sh`
6. `sudo ./tazama.sh` → interactive menu:
   - Option **3** = Full-Service (DockerHub)
   - Addon menu left at defaults (`pgadmin` and `hasura` ON; `auth`,
     `relay`, `basiclogs`, `ui`, `natsutils`, `batchppa` OFF) — applied with
     `a`.
7. Script ran `docker compose -p tazama -f docker-compose.base.infrastructure.yaml
   -f docker-compose.base.override.yaml -f docker-compose.full.cfg.yaml
   -f docker-compose.hub.core.yaml -f docker-compose.full.rules.yaml
   -f docker-compose.utils.pgadmin.yaml -f docker-compose.utils.hasura.yaml
   up -d` (reconstructed from `tazama.sh`'s `build_docker_command()` logic
   for the options selected — exact flags depend on addon state).
8. Verified all containers up, verified image cache, verified Mojaloop
   health, verified Tazama health endpoints.

No manual port remapping was required — Tazama's default `.env`/override
ports never collided with the Mojaloop port list.

## Port Mapping (Final)

| Service | Host Port | Container Port | Notes |
| --- | --- | --- | --- |
| tazama-tms-1 | 5000 | 3000 | Transaction Monitoring Service — `GET /health` → `{"status":"UP"}` |
| tazama-admin-service-1 | 5100 | 3100 | Admin API — `GET /health` → `{"status":"UP"}` |
| tazama-postgres-1 | 15432 | 5432 | Postgres 18 |
| tazama-valkey-1 | 16379 | 6379 | Valkey (Redis-compatible) 7.2.5 |
| tazama-nats-1 | 14222 | 4222 | NATS client port |
| tazama-nats-1 | 16222 | 6222 | NATS cluster/routing port |
| tazama-nats-1 | 18222 | 8222 | NATS monitoring/HTTP port |
| tazama-pgadmin-1 | 15050 | 80 | pgAdmin UI |
| tazama-hasura-1 | 6100 | 8080 | Hasura GraphQL API |
| tazama-hasura-init-1 | — | — | One-shot init job, exits 0 by design, not a failure |
| tazama-ed-1, tazama-tp-1, tazama-tadp-1, tazama-ef-1, tazama-rule-\*-1 (39 rule engines) | none | — | Internal-only, NATS-driven consumers, no host ports published |

No overlap with any Mojaloop-reserved port
(`3000-3002, 4001-4002, 6379, 6381-6391, 8444, 9440, 9550, 9660, 14002-14003,
27017`) or with the optional-profile ports listed in the ticket
(`8080, 8082, 9302, 9304, 9400, 9401, 5173, 5555, 5672, 8888, 9000, 15672,
3307`).

**Known internal collision risk (avoided, not hit):** the addon utilities
`docker-compose.utils.batch-ppa.yaml` and `docker-compose.utils.nats-utils.yaml`
both publish host port `4000:4000`. Both default OFF and were left OFF in
this deployment. If a future run needs either, do not enable both
simultaneously — pick one or remap.

## Images Pulled / Cached

41 Tazama-related images (all tag `3.0.0` unless noted), ~19.34GB total
across all Docker images on the host:

- `tazamaorg/admin-service:3.0.0`
- `tazamaorg/tms-service:3.0.0`
- `tazamaorg/event-director:3.0.0`
- `tazamaorg/event-flow:3.0.0`
- `tazamaorg/typology-processor:3.0.0`
- `tazamaorg/transaction-aggregation-decisioning-processor:3.0.0`
- `tazamaorg/rule-{001,002,003,004,006,007,008,010,011,016,017,018,020,021,024,025,026,027,028,030,044,045,048,054,063,074,075,076,078,083,084,090,091}:3.0.0`
  (33 rule engines)
- `postgres:18`
- `nats:2`
- `valkey/valkey:7.2.5`
- `hasura/graphql-engine:v2.36.0`
- `dpage/pgadmin4:9`
- `curlimages/curl:latest` (used transiently by `tazama-hasura-init-1`)

Confirmed via `sudo docker images` — all present locally, all containers
successfully started from them (a container cannot run from an unpulled
image, so running status is itself proof of a complete local pull).

## Credentials / Configuration Locations

- Stack config: `~/Full-Stack-Docker-Tazama/.env` (on the VM, in
  `abdul.rahim`'s home directory).
- No `GH_TOKEN` was required for this deployment path — confirmed the
  Full-Service (DockerHub) profile pulls exclusively from
  `tazamaorg/*` on Docker Hub, with no `build:`/GHCR dependency.
  `GH_TOKEN` in `.env` is only consumed by the GitHub-source-build profile
  (menu option 1), not used here.
- Postgres, Valkey, NATS, Hasura, pgAdmin credentials: whatever ships as
  defaults in `.env` and the compose files — not changed for this
  deployment. Anyone accessing pgAdmin/Hasura should check
  `~/Full-Stack-Docker-Tazama/.env` and the relevant
  `docker-compose.utils.*.yaml` files for default credentials before first
  login.

## Verification Performed

- `sudo docker ps -a --filter "name=tazama"` — all containers `Up`, healthy
  where a healthcheck exists (`postgres`, `valkey`, `hasura`); one-shot
  `hasura-init` exited 0 as expected.
- `curl http://localhost:5000/health` → `{"status":"UP"}` (TMS)
- `curl http://localhost:5100/health` → `{"status":"UP"}` (Admin)
- `curl http://localhost:3000/health` → Mojaloop `ml-api-adapter` still
  `"status":"OK"`, uptime continuous through the Tazama deployment
  (~10,157s / no restart)
- `curl http://localhost:3002/health` → Mojaloop `quoting-service` still
  `"status":"OK"`, same continuous uptime
- Full `sudo docker ps` before and after Tazama deployment compared — every
  pre-existing Mojoloop container present in both, same "Up 3 hours" status

## Known Issues / Pre-Existing Conditions (Not Caused By This Deployment)

- `central-settlement` (Mojaloop) shows `Up 3 hours (unhealthy)` — this was
  already in this state before the Tazama deployment began (same 3-hour
  uptime as the rest of the pre-existing stack) and is unrelated to this
  work. Flagging for whoever owns that service, not fixing it here.

## Offline / Rerun Considerations

- All images are cached locally (`sudo docker images`), so `docker compose
  -p tazama ... up -d` (or `sudo ./tazama.sh` → option 3 → `a`) can be rerun
  after internet is disabled without needing to re-pull anything, as long as
  the compose files/`.env` aren't changed to reference a different tag.
- `docker system df` at time of writing: 60 images / 19.34GB, 12 local
  volumes / 310.7MB, 0B reclaimable — nothing pruned, no risk of a
  cache-cleanup job silently invalidating this before the cutoff. If
  anyone runs `docker system prune` before the internet window closes,
  re-verify images are still present.
- Postgres data lives in a Docker-managed local volume (no named
  bind-mounts besides `./postgres/migration/...` and `./hasura` inside the
  repo checkout) — do not delete `~/Full-Stack-Docker-Tazama` or run
  `docker compose -p tazama down --volumes` unless you intend to lose
  Tazama's local state.
- The stack was brought up with `docker compose -p tazama`, confirmed via
  container naming (`tazama-*-1`) — a distinct project name from whatever
  Mojoloop's harness uses, so `docker compose -p tazama down`/`up`/`restart`
  will not touch Mojoloop containers.

## Open Items

- Root cause of `central-settlement`'s pre-existing unhealthy status not
  investigated (out of scope for this ticket).
- FX/bulk/error-path behavior of Tazama's rule engines not exercised —
  only base health/readiness confirmed, not functional transaction
  monitoring end-to-end.
- Default credentials for pgAdmin/Hasura should be rotated or documented
  more explicitly if this deployment moves beyond a throwaway/demo context.

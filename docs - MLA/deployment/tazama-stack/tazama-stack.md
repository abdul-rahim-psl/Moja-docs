# Tazama core stack with authentication — local deployment (Linux)

**What this document is.** The exact procedure followed on **2026-09-29** to bring up the core Tazama stack
(`tazama-lf/tazama-stack`, `core/` folder) on a single Linux machine, using the **Full-service (DockerHub)**
deployment type with the **Authentication** addon (Keycloak + Auth Service) turned on, and the result of the
health checks run afterwards.

**What this document is not.** It is not a production guide — the upstream repository is explicitly for
demonstration, exploration and testing only. It also does not cover the `extensions/` (studios, CMS) or
`biar/` stacks, and it does not cover sending a transaction through the pipeline (see §9).

**Status legend.** Statements are marked **[verified]** when they were observed on this machine during the
session, and **[from config]** when they were read from the repository's compose files or scripts but not
exercised live.

---

## 1. Environment

| Item | Value |
| --- | --- |
| OS | Linux (Ubuntu-family; kernel 7.0.0-34-generic) |
| Docker | Client 29.8.0, installed as a snap (`/snap/bin/docker`), with the Compose plugin |
| Repository | `/home/abdul-rahim/tazama/tazama-stack`, branch `main`, clean working tree |
| Stack folder | `core/` |
| Launcher | `core/tazama-core.sh` (interactive menu) |
| Image tag | `TAZAMA_VERSION=rc` in `core/.env` (left unchanged) — see §8 |

## 2. Pre-requisites

- Git and Docker with the Compose plugin (`docker compose version` must work).
- Free ports for everything in §6.
- Internet access to Docker Hub (`tazamaorg/*`, `postgres`, `nats`, `valkey`, `hasura`, `curlimages/curl`,
  `dpage/pgadmin4`) and `quay.io` (Keycloak). Roughly 40 images are pulled for this deployment type.
- The upstream READMEs also list a GitHub personal access token (`read:packages`) and a `docker login ghcr.io`
  step. In this run the images all came from Docker Hub and no `ghcr.io` login was needed; if a pull fails
  with an authorisation error against `ghcr.io`, do the login described in `core/README.md` §2.

## 3. Clean the machine first

The machine already had unrelated containers and old data, including an earlier Tazama stack started by an
older launcher under the compose project name **`tazama`**. The current launcher uses the project name
**`tazama-core`**, so the old project would not be cleaned up by the launcher and would collide on ports
5000, 5100, 15432, 14222 and 16379. It was removed first.

```bash
docker compose -p tazama down --volumes --remove-orphans      # the old Tazama project
docker ps -a                                                   # confirm what is left
docker container prune -f
docker volume prune -a -f
docker network prune -f
```

**Side effect on other work on this machine.** The same clean-up also stopped and removed the `cch-ppa` and
`cch-mla` compose projects and deleted their named volumes (`cch-ppa_ppa-postgres-data`,
`cch-ppa_ppa-valkey-data`, `cch-mla_redpanda-data`), together with the stopped `ml-core-*` Mojaloop
containers and every unused Docker volume. This was done deliberately, at the user's request, to get a clean
slate. **Anything that lived only in those volumes is gone**; recreate the harnesses from their own compose
files (`cch-mla/docker-compose.dev.yml`, `cch-ppa/docker-compose.yml`) if they are needed again. Docker
images were not pruned.

## 4. Deploy

```bash
cd /home/abdul-rahim/tazama/tazama-stack/core
chmod +x tazama-core.sh        # only if it is not already executable
./tazama-core.sh
```

In the menu:

1. Choose **`3` — Full-service (DockerHub)**.
2. In the addon screen, press **`1`, `2`, `3`, `4`**, one at a time, each followed by Enter.
3. **Do not press `5` or `6`.** pgAdmin and Hasura start already selected (`[X]`); pressing them turns them
   *off*. Check that all six lines show `[X]`.
4. Press **`a`** (apply), then **`e`** (execute).

The script prints the compose command it is about to run and, on `e`, tears down any existing
`tazama-core`, `tazama-extensions` and `tazama-biar` projects (with `--volumes`) before running
`… -p tazama-core up -d --remove-orphans --force-recreate`. Re-running the script is therefore safe, and
**every run wipes the core stack's data**.

### 4.1 What each choice means

**Deployment type 3 — Full-service.** Pre-built Docker Hub images; the core processors (TMS, Admin service,
Event Director, Typology Processor, Event Adjudicator, Event Flow) plus **33 rule processors**
(`rule-001` … `rule-091`) composed into one illustrative typology. Postgres is tuned up for it (1000
connections, 512 MB `shared_buffers`), so it needs noticeably more RAM than the Public option. The database
is seeded from `postgres/migration/config/03-full-dockerhub.sql`. **[from config]**

Other types, for comparison: `1` Public (GitHub) builds from source and is slow; `2` Public (DockerHub) runs
core plus rules 901/902 only; `4` Multi-Tenant adds per-tenant relays for `tenant-001`/`tenant-002` and forces
Auth and Relay on.

**Addons selected (all six):**

| # | Addon | What it starts |
| --- | --- | --- |
| 1 | **Authentication** | `keycloak` (login provider, realm imported from `auth/keycloak/realms/00-tazama-test-realm.json`) and `auth-service`. Also sets `AUTHENTICATED=true` on `tms-service`, `admin-service`, `batch-ppa` and `tazama-demo`, so their API calls need a bearer token, and sets Postgres to trust authentication (local testing only). |
| 2 | **Relay services (NATS)** | `relay-service-ef`, `relay-service-tp`, `relay-service-ea` — NATS-to-NATS forwarders for the Event Flow, Typology Processor and Event Adjudicator outputs. |
| 3 | **Basic Logs** | `event-sidecar` (port 15000) ships processor logs over NATS to `lumberjack`, which prints them to its container log. |
| 4 | **NATS Utilities** | `nats-utilities`, a REST proxy onto NATS (port 4000), used for testing. |
| 5 | **pgAdmin** | `core-pgadmin`, a Postgres web UI. |
| 6 | **Hasura** | `hasura` (GraphQL over Postgres) and the one-shot `hasura-init`, which configures it and then exits. |

All of the above are **[from config]**; the running container list in §5 confirms they were created.

## 5. What was running afterwards — [verified]

The `docker ps` listing after deployment showed all of the following up:

- **Infrastructure:** `core-postgres` (postgres:18), `nats` (nats:2), `valkey` (valkey 7.2.5)
- **Core processors and APIs:** `tms-service`, `admin-service`, `event-director`, `typology-processor`,
  `event-adjudicator`, `event-flow`, plus 33 `rule-NNN` containers
- **Auth:** `keycloak` (quay.io/keycloak/keycloak:23.0.6), `auth-service`
- **Relay / logging / utilities:** `relay-service-ef|tp|ea`, `event-sidecar`, `lumberjack`, `nats-utilities`
- **Test tooling:** `core-pgadmin`, `hasura`
- **Also started, not selected in the addon menu:** `batch-ppa` (port 4100) and `tazama-demo` (port 3011).
  They are defined in `docker-compose.hub.core.yaml`, so they start with every DockerHub deployment type.
  The upstream README says the Demo UI is not designed to work alongside Auth and Relay; it was not used.

All images were the `rc` tag except the third-party ones. `hasura-init` was the only container in `Exited`
state, with `Exited (0)` — expected, since it is a one-shot setup job.

## 6. Ports

| Service | Host port |
| --- | --- |
| TMS API (Swagger at `/documentation`) | 5000 |
| Admin service (Swagger at `/documentation`) | 5100 |
| Keycloak | 8080 |
| Auth Service | 3020 |
| Hasura | 6100 |
| pgAdmin | **5050** |
| NATS Utilities | 4000 |
| Batch PPA | 4100 |
| Demo UI | 3011 |
| Event sidecar | 15000 |
| PostgreSQL | 15432 |
| NATS (client / cluster / monitoring) | 14222 / 16222 / 18222 |
| Valkey | 16379 |

pgAdmin is on **5050** (`PGADMIN_PORT` in `core/.env`, and the launcher's Consoles menu). `core/README.md`
says 15050 — that is stale.

## 7. Verification — [verified]

Run after the stack had been up for a while (Keycloak needs a minute or two to become ready):

```bash
docker ps -a --filter "status=exited" --filter "status=restarting" --format 'table {{.Names}}\t{{.Status}}'
curl -s localhost:5000                                          # TMS
curl -s localhost:5100                                          # Admin service
curl -s -o /dev/null -w "keycloak %{http_code}\n"     localhost:8080
curl -s -o /dev/null -w "auth-service %{http_code}\n" localhost:3020
curl -s -o /dev/null -w "hasura %{http_code}\n"       localhost:6100/healthz
curl -s -o /dev/null -w "pgadmin %{http_code}\n"      localhost:5050
```

Results:

| Check | Result |
| --- | --- |
| Exited / restarting containers | only `hasura-init`, `Exited (0)` |
| TMS (5000) | `{"status":"UP"}` |
| Admin service (5100) | `{"status":"UP"}` |
| Keycloak (8080) | HTTP 200 |
| Auth Service (3020) | HTTP 200 |
| Hasura `/healthz` (6100) | HTTP 200 |
| pgAdmin (5050) | HTTP 302 (redirect to its login page — normal) |

The health endpoints of TMS and the Admin service answer without a token even with Auth on. Other routes are
expected to need one **[from config — not exercised]**.

**Not checked in this session:** that Postgres was seeded (`docker exec core-postgres psql -U postgres -c "\l"`
should list `event_history`, `raw_history`, `configuration`, `evaluation`), the `hasura-init` log for
`✗ Failed` lines, and any authenticated request. Do these before relying on the stack.

## 8. Problems met and how they were resolved

| Symptom | Cause | Resolution |
| --- | --- | --- |
| `failed to fetch anonymous token … lookup auth.docker.io on 127.0.0.53:53: server misbehaving` while pulling `curlimages/curl` | A DNS failure: the system resolver (`systemd-resolved`) could not resolve the Docker Hub auth host. A network glitch, not a Tazama problem. | The condition cleared on its own. `docker pull curlimages/curl` was run to confirm, then the launcher was re-run. If it recurs: `resolvectl query auth.docker.io`, `sudo systemctl restart systemd-resolved`, then `sudo snap restart docker`; as a last resort add `{ "dns": ["8.8.8.8", "1.1.1.1"] }` to `/var/snap/docker/current/config/daemon.json`. |
| Old `tazama-*-1` containers present | Started by an older launcher under project name `tazama` | Removed in §3. |
| A non-interactive compose run exited 1 with no output when its output was redirected to a file | Not diagnosed. Output redirection hid the error; the run was abandoned and the menu-driven launcher used instead. | Use the interactive launcher, or run the compose command in a terminal so its output is visible. |
| Addon screen ends up with pgAdmin/Hasura off | They default to `[X]`; pressing 5 or 6 toggles them off | Press only 1–4, then check all six show `[X]` (§4). |

## 9. Things to know before using it

- **`core/.env` is not set for `main`.** `TAZAMA_VERSION=rc` deploys the release-candidate builds (from the
  `dev` branch), and every `*_BRANCH` variable is `dev`, even though the repository is on `main`. The
  `*_BRANCH` variables only matter for deployment type 1. To deploy the stable release, set
  `TAZAMA_VERSION=latest` before running the launcher.
- **With Auth on, the Postman "NO-AUTH" collections will fail.** Use the "(AUTH)" collections from
  `github.com/tazama-lf/postman`, or the Swagger pages with a token from the Auth Service. A transaction has
  not been sent through this deployment in this session.
- **Restarting after a new network map:** `docker restart typology-processor event-adjudicator event-director`.
- **Docker Utilities → option 3 in the menu runs `docker system prune -a -f --volumes`** — it removes
  *all* unused Docker resources on the machine, not just Tazama's.
- **The upstream READMEs are Windows-first and partly stale**: they name the script `tazama.sh` (it is
  `tazama-core.sh`), list a Demo UI addon the Unix menu does not have, and give the old pgAdmin port.

## 10. Stop and remove

```bash
docker compose -p tazama-core down --volumes --remove-orphans
```

`--volumes` deletes the database. Omit it to keep the data for the next start (although re-running the
launcher recreates it anyway).

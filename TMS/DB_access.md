# Accessing the Tazama Postgres Database

Deployment: `full-stack-docker-tazama`, host `10.0.150.69`.

Postgres runs in the `tazama-postgres-1` container, exposed on port `15432` (mapped from the container's internal `5432`). A pgAdmin instance is also deployed against it.

Credentials:
- Postgres user: `postgres`
- Postgres password: `unused`
- Databases: `configuration`, `event_history`, `raw_history`, `evaluation`

## Option 1: pgAdmin web UI

Open in a browser: `http://10.0.150.69:15050`

- Email: `pgadmin4@pgadmin.org`
- Password: `password`

A "Tazama" server connection is pre-configured. When prompted for the Postgres password, use `unused` (user `postgres`).

## Option 2: Direct psql from the terminal

If `psql` is installed on the host machine:

```bash
PGPASSWORD=unused psql -h localhost -p 15432 -U postgres -d configuration
```

Swap `-d configuration` for `event_history`, `raw_history`, or `evaluation` as needed.

## Option 3: psql via docker exec (no local client needed)

```bash
docker exec -it tazama-postgres-1 psql -U postgres -d configuration
```

Once connected, useful commands:
- `\l` — list databases
- `\dt` — list tables
- `select * from network_map;` — example query

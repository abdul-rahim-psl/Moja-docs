# Runbook: Verify Quote/Transfer Kafka Topics On The Deployment VM

Steps to repeat, on the deployment VM, the local verification already done
and documented in `kafka-topics-quote-transfer.md`. Goal: confirm the same
topic names, payload shapes, and partition layout hold on the VM's
`ml-core-test-harness` deployment (admin-ui already reachable at
`10.0.150.69:9660`), and capture real payload samples from there.

## Prerequisites

- SSH/shell access to the VM.
- `ml-core-test-harness` already deployed on the VM (per existing setup —
  do not redeploy).
- Node.js installed on whichever machine will run the listener app (the VM
  itself, or your local machine if it can reach the VM's Kafka port).

## Step 1 — Expose the Kafka broker port

On the VM, open `ml-core-test-harness/docker-compose.yml` and find the
`kafka` service block. Confirm the port mapping is active (not commented
out):

```yaml
kafka:
  ports:
    - "9092:9092"
```

If it's commented out, uncomment it and recreate just that container:

```bash
cd ml-core-test-harness
docker compose up -d --no-deps kafka
```

Confirm it's listening:

```bash
docker ps --filter "name=kafka" --format "{{.Names}}\t{{.Status}}\t{{.Ports}}"
```

You should see `0.0.0.0:9092->9092/tcp`.

**Note:** if other people/services rely on this VM, check with the team
before restarting the `kafka` container — this briefly disconnects any
existing consumers.

## Step 2 — Confirm topic names and partitions on the live broker

From the VM (or via `docker exec` if using a remote shell):

```bash
docker exec kafka /opt/bitnami/kafka/bin/kafka-topics.sh \
  --bootstrap-server localhost:9092 --list
```

Expect to see (at minimum) these topics — this is the exact list confirmed
in the local run:

```
topic-quotes-post
topic-quotes-put
topic-quotes-get
topic-bulkquotes-post
topic-bulkquotes-put
topic-bulkquotes-get
topic-fx-quotes-post
topic-fx-quotes-put
topic-fx-quotes-get
topic-transfer-prepare
topic-transfer-fulfil
topic-transfer-get
topic-transfer-position
topic-transfer-position-batch
topic-notification-event
topic-admin-transfer
```

If any are missing, note it — it likely means that message type hasn't been
produced yet on this deployment (topics are usually auto-created on first
publish), not that something is broken.

Check partition count on the two topics that matter most:

```bash
docker exec kafka /opt/bitnami/kafka/bin/kafka-topics.sh \
  --bootstrap-server localhost:9092 --describe --topic topic-quotes-post

docker exec kafka /opt/bitnami/kafka/bin/kafka-topics.sh \
  --bootstrap-server localhost:9092 --describe --topic topic-transfer-prepare
```

Local result was `PartitionCount: 1, ReplicationFactor: 1` for both — confirm
the VM matches (or note the difference if it doesn't).

## Step 3 — Get the listener app onto the VM

Copy the `kafka-topic-listener/` folder (at the repo root) to the VM, e.g.:

```bash
scp -r kafka-topic-listener/ <user>@10.0.150.69:~/kafka-topic-listener
```

On the VM:

```bash
cd ~/kafka-topic-listener
npm install
```

## Step 4 — Start the listener

If running the listener **on the VM itself** (recommended — avoids exposing
Kafka beyond the VM):

```bash
KAFKA_BROKERS=localhost:9092 npm start
```

If running it from your **local machine** against the VM's exposed port
instead:

```bash
KAFKA_BROKERS=10.0.150.69:9092 npm start
```

Leave it running — it uses its own consumer group
(`kafka-topic-listener-prototype` by default) so it will not interfere with
quoting-service, ml-api-adapter, or central-ledger's own consumers. Do not
change `KAFKA_GROUP_ID` to match any existing service consumer group.

Confirm it connects and subscribes cleanly (you should see "Connected to
Kafka brokers..." and five "Subscribed to: ..." lines with no repeated
`ECONNREFUSED` errors).

## Step 5 — Run the golden-path flow

Using the already-configured Postman collections and environment (per the
earlier onboarding setup), run through the flow in this order, same as the
manual process already in use:

1. Download JWS Signature Generation Package (once).
2. Send Quote (`POST /quotes`).
3. Send Transfer (`POST /transfers`) — using `ilpPacket`/`condition` however
   you currently obtain them (manually via the callback endpoint, or — once
   available — read directly off `topic-quotes-put` from the listener
   output instead, which carries the same values without needing the
   callback).

Watch the listener's terminal output as each request is sent — messages
should appear on `topic-quotes-post` right after the quote request, and on
`topic-quotes-put` shortly after (the async response). Same pattern for
`topic-transfer-prepare` and `topic-transfer-fulfil`.

## Step 6 — Capture and compare

For each of the 5 topics, save one real message from the VM run (copy from
terminal output) into a new file:

```
kafka-topic-listener/captured/vm-<topic-name>.sample.txt
```

Compare against the existing local samples in the same folder
(`<topic-name>.sample.txt`, no `vm-` prefix). Confirm:

- The message **shape** matches (same fields, same base64 vs. plain-JSON
  payload split between quote and transfer topics).
- `metadata.event.action` / `type` values match what's documented.
- Nothing VM-specific looks different (e.g. different FSP names in `from`/
  `to` are expected and fine; a structurally different envelope would not
  be).

## Step 7 — Update the documentation

Once done, add a short note to `kafka-topics-quote-transfer.md`'s
"Verification Log" section confirming the VM run matches the local one (or
documenting any differences found), and check off the corresponding item in
`kafka-topics-ticket-status.md`'s "Left / Open" list.

## If something doesn't match

- **Different topic names**: check for `rc`-style env var overrides
  (`QUOTE_KAFKA__...` / `MLAPI_KAFKA__...`) in the VM's service environment
  or docker-compose env blocks — see the "Configurability" section in
  `kafka-topics-quote-transfer.md`.
- **No messages appear at all**: confirm the listener actually connected
  (Step 4) before triggering requests — it does not replay history
  (`fromBeginning: false`), so anything published before it connected is
  invisible to it.
- **Connection refused from your local machine**: the VM's firewall/security
  group may not allow inbound `9092` from outside — in that case, run the
  listener directly on the VM instead (see Step 4's first option).

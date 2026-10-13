# E2E Rails: Feeder → MLA → PPA → TMS → CMS

## Contents

- [Phase 1: for Samit](#phase-1-for-samit)
- [Phase 2: for Claude](#phase-2-for-claude)
  - [The rails](#the-rails)
  - [Rules of engagement](#rules-of-engagement)
  - [Step 0: Set the variables](#step-0-set-the-variables)
  - [Step 1: Pre-checks](#step-1-pre-checks)
  - [Step 2: Make a fresh payment](#step-2-make-a-fresh-payment)
  - [Step 3: Start the alert watcher](#step-3-start-the-alert-watcher)
  - [Step 4: Open the tunnels](#step-4-open-the-tunnels)
  - [Step 5: Feed](#step-5-feed)
  - [Step 6: Close the tunnels](#step-6-close-the-tunnels)
  - [Step 7: Verify every hop](#step-7-verify-every-hop)
  - [Step 8: Report](#step-8-report)
  - [When a hop fails](#when-a-hop-fails)
  - [Gotchas](#gotchas)
  - [Reference run](#reference-run)

One run sends one fresh cross-border payment from a captured DRPP corridor through the whole UAT path: the feeder puts it on the test rig's Kafka topic, MLA picks it up and forwards it to PPA, PPA translates it into four ISO 20022 messages for Tazama's TMS, Tazama scores it, and the event adjudicator's alert lands in the Case Management System (CMS) as a case. Every command below was run live on 2026-10-13; [Reference run](#reference-run) has the results.

## Phase 1: for Samit

The CMS on UAT is confirmed: it runs on the PPA host (`10.0.115.186`), backend on port 3090 and UI on port 5175, and it subscribes to the adjudicator's alerts on NATS subject `investigation-service`. Run the commands below from `/home/abdul-rahim/mojaloop`.

1. **Check the CMS exists.** On the PPA host, run `sudo docker ps | grep -iE "relay|case|cms|investigation"` (needs sudo). If nothing listens on `investigation-service`, the test can only go as far as the evaluation.
2. **Pre-checks:** multinet VPN up, and PPA's breaker closed (`curl -s 10.0.115.186:9464/metrics | grep breaker` should show `0`).
3. **Make a fresh payment** from any pack corridor, with new IDs:
   ```bash
   python3 cch-rules-pacs002/tools/reid-capture.py "<pack>/02_ZMW_to_MWK/raw_messages.json" out.json map.json
   python3 cch-rules-pacs002/tools/to-partition0.py out.json out-p0.json
   ```
4. **Open the tunnels**, noting both PIDs:
   - on the rig: `setsid kubectl port-forward -n demo svc/kafka 9092:9092 --address=127.0.0.1 </dev/null &`
   - locally: `ssh -i ~/.ssh/mojaloop_fx_10_0_150_69 -o IdentitiesOnly=yes -f -N -L 127.0.0.1:9092:127.0.0.1:9092 root@10.0.150.69`
5. **Feed it:** `cd cch-mla && npm run feeder -- --file ../out-p0.json --brokers localhost:9092 --topic topic-event-audit`
6. **Close both tunnels by PID** (`pkill -f` over SSH would kill its own shell).
7. **Check each hop.** The new transferId is in `map.json`.
   - **MLA:** on the rig, `kubectl -n mla logs deploy/cch-mla --since=10m | grep Forwarded` should show 8 lines.
   - **PPA → TMS:** `raw_history` should hold `pain001`, `pain013`, `pacs008` and `pacs002` rows for that transferId.
   - **Tazama:** the `evaluation` row for the pacs.002's message ID. Expect ALRT with a score of about 500 from the stock weights, which is useful here because an ALRT is what should reach a CMS.
   - **CMS:** the alert for that same pacs.002 message ID should arrive in whatever step 1 finds.

`<pack>` is `DRPP_Kafka_E2E_Pack 2/DRPP_Kafka_E2E_Pack`.

## Phase 2: for Claude

Run the rails one step at a time. Each step ends on a **completion criterion**; move on only when it holds, and stop at the first step whose criterion fails, then use [When a hop fails](#when-a-hop-fails). A run is done when Step 7 shows evidence at every **hop** for the same payment: the same transferId at MLA and TMS, and the same pacs.002 `MsgId` in the evaluation, on NATS and in the CMS.

### The rails

| Hop | Component and where it runs | Evidence it worked |
| --- | --- | --- |
| 1 | `capture-feeder` on the laptop → Kafka `topic-event-audit` (one partition) on the rig `10.0.150.69`, namespace `demo` | `Fed 20 record(s).` |
| 2 | MLA, pod `cch-mla` in namespace `mla` on the rig → PPA through `mla-interconnect.paysyslabs.com:8443` | 8 `Forwarded` log lines: 2 each for QUOTE, FXQUOTE, TRANSFER and FXTRANSFER |
| 3 | PPA on `10.0.115.186:3000` → TMS on `10.0.115.186:5000` | One row each in `raw_history.pain001`, `pain013`, `pacs008` and `pacs002`, where `endtoendid` is the transferId |
| 4 | Event director → 30 CCH rule processors + EFRuP → typology processor `000@4.0.0` → event adjudicator | One `evaluation` row, keyed by the pacs.002 `MsgId` |
| 5 | Event adjudicator → NATS subject `investigation-service` on `10.0.115.186:14222` | `tools/watch_alerts.js` prints `MATCH` |
| 6 | CMS backend, container `case-management-system-backend`, subscribed to `investigation-service` | Its log: `Request: {…MsgId…}`, `Process CaseID: <n>`, `End - Alert Creation - <n>`, `Alert ingested from NATS for tenant: DEFAULT` |

Confirmed on UAT on 2026-10-13, from the containers' own environment: the adjudicator has `ALERT_PRODUCER=investigation-service`, `ALERT_DESTINATION=global`, `SUPPRESS_ALERTS=false` and `ALERTS_ONLY=false`. Going by the adjudicator's code (read from the local `rc` image), those settings publish every evaluation, ALRT and NALT. The CMS backend has `STARTUP_TYPE=nats`, `SERVER_URL=nats://10.0.115.186:14222` and `CONSUMER_STREAM=investigation-service`. `relay-service-ea` also consumes `investigation-service` and republishes to `relay-service-nats-ea`; the CMS does not read that copy.

### Rules of engagement

- **Read-only on the UAT host.** `docker ps`, `docker inspect`, `docker logs` and read-only SQL only. Ask the user before any write: a restart, a config or database change, a `POST`.
- **Sudo** is for the PPA host user `abdul.rahim`. Ask the user for the password, write it to a `chmod 600` file in the scratchpad, and pass it to `sudo -S -p ''` over stdin. Never put it on a command line, in a document or in memory.
- **Every SQL session is read-only**: export `PGOPTIONS='-c default_transaction_read_only=on'` before any `psql`.
- **Close what you open.** Both tunnels die by PID in Step 6. `pkill -f` over SSH matches its own shell and kills it, so it is the wrong tool.
- **Report what was proven**, hop by hop. A hop with no evidence is reported as unverified.

### Step 0: Set the variables

```bash
export MOJ=/home/abdul-rahim/mojaloop
export PACK="$MOJ/DRPP_Kafka_E2E_Pack 2/DRPP_Kafka_E2E_Pack"
export RUN=<scratchpad>/e2e-$(date -u +%Y%m%dT%H%M%SZ); mkdir -p "$RUN"
export RIG_KEY=~/.ssh/mojaloop_fx_10_0_150_69
export HOST_KEY=~/.ssh/ppa_10_0_115_186
export SUDO_PW_FILE=<scratchpad>/.ppa-host-sudo     # chmod 600; the password comes from the user
export PGOPTIONS='-c default_transaction_read_only=on'
export NATS_MOD=$HOME/tazama/admin-service/node_modules/nats
export COE=$MOJ/cch-rules-pacs002/cch-rule-001/node_modules/@tazama-lf/frms-coe-lib
```

Shell state does not persist between Bash tool calls, so repeat the exports, or the ones a command needs, in every call.

**Done when** `ls "$PACK"` lists the five corridor folders and `ls "$NATS_MOD/package.json" "$COE/lib/helpers/protobuf.js"` finds both files.

### Step 1: Pre-checks

```bash
curl -s --max-time 8 http://10.0.115.186:9464/metrics | grep '^ppa_tms_circuit_breaker_state'
curl -s --max-time 6 http://10.0.115.186:3000/health/ready
curl -s --max-time 6 http://10.0.115.186:3090/
ssh -i $RIG_KEY -o IdentitiesOnly=yes -o ConnectTimeout=8 root@10.0.150.69 \
  'kubectl -n mla get pods --no-headers; ss -ltn | grep -c ":9092 "'
ss -ltn | grep -c ':9092 '
ssh -i $HOST_KEY abdul.rahim@10.0.115.186 \
  'sudo -S -p "" docker ps --format "{{.Names}}\t{{.Status}}"' < "$SUDO_PW_FILE" \
  | grep -E "case-management-system-backend|event-adjudicator|typology-processor|^nats"
```

**Done when** all of these hold:

- the breaker reads `ppa_tms_circuit_breaker_state 0` (1 is half-open, 2 is open);
- PPA answers `{"ready":true,"checks":{"writeAheadStore":true}}`;
- the CMS answers `{"status":"UP!"}`;
- the rig lists `cch-mla … 1/1 Running`;
- port 9092 is free on both ends (both counts are `0`);
- the host shows the CMS backend, adjudicator, typology processor and `nats` as `Up`.

The rig SSH needs the multinet UAT VPN; a timeout there means the VPN is down.

### Step 2: Make a fresh payment

Any of the five corridors works, because every ID is replaced. TMS keeps `MsgId` unique and PPA deduplicates on `{id}:{isoMessageType}`, so a corridor fed unchanged a second time stops at PPA.

```bash
cd "$MOJ"
python3 -I cch-rules-pacs002/tools/reid-capture.py "$PACK/01_MWK_to_ZMW_PRIMARY/raw_messages.json" "$RUN/out.json" "$RUN/map.json"
python3 -I cch-rules-pacs002/tools/to-partition0.py "$RUN/out.json" "$RUN/out-p0.json"
python3 -I -c "import json,sys; print(next(r['value']['payload']['metadata']['trace']['tags']['transferId'] for r in json.load(open(sys.argv[1])) if r['value']['payload']['metadata']['trace']['tags'].get('operation')=='prepareTransfer'))" "$RUN/out-p0.json"
```

Keep the printed transferId as `TRANSFER` for every later step.

**Done when** `reid-capture.py` prints `20 records, 14 IDs replaced`, `to-partition0.py` prints `20 records`, and the third command prints a 26-character ULID that differs from the corridor's original transferId.

### Step 3: Start the alert watcher

Run it in the background before feeding. Core NATS keeps no messages, so a subscriber that starts after the alert is published sees nothing.

```bash
node "$MOJ/cch-rules-pacs002/tools/watch_alerts.js" "$NATS_MOD" "$COE" "$TRANSFER" 300
```

The watcher is read-only. It subscribes to `investigation-service` and `investigation-service-DEFAULT`, decodes each message with frms-coe-lib, prints one line per alert, and exits `0` on the alert whose `OrgnlEndToEndId` is `TRANSFER`, or `2` after the timeout.

**Done when** its output shows `subscribed to investigation-service, investigation-service-DEFAULT on 10.0.115.186:14222`.

### Step 4: Open the tunnels

```bash
ssh -i $RIG_KEY -o IdentitiesOnly=yes root@10.0.150.69 \
  'setsid kubectl port-forward -n demo svc/kafka 9092:9092 --address=127.0.0.1 </dev/null >/tmp/pf-kafka.log 2>&1 & echo $!; sleep 3; cat /tmp/pf-kafka.log'
ssh -i $RIG_KEY -o IdentitiesOnly=yes -o ExitOnForwardFailure=yes -f -N -L 127.0.0.1:9092:127.0.0.1:9092 root@10.0.150.69
ss -ltnp | grep ':9092 '
```

The first command prints the rig-side PID (`RIG_PID`), then `Forwarding from 127.0.0.1:9092 -> 9092`. The redirect to `/tmp/pf-kafka.log` lets the SSH session return. The last command shows `users:(("ssh",pid=<LOCAL_PID>,…))`.

**Done when** you hold both PIDs and the forwarding line has printed.

### Step 5: Feed

```bash
cd "$MOJ/cch-mla" && npm run feeder -- --file "$RUN/out-p0.json" --brokers localhost:9092 --topic topic-event-audit
```

Note the UTC time just before it runs. In the reference run, the watcher printed `MATCH` 0.2 seconds after the feed ended.

**Done when** the feeder prints `Loaded 20 record(s).`, `Connected to localhost:9092`, 20 `-> partition 0` lines and `Fed 20 record(s).`

### Step 6: Close the tunnels

```bash
kill <LOCAL_PID>
ssh -i $RIG_KEY -o IdentitiesOnly=yes root@10.0.150.69 \
  'kill <RIG_PID>; sleep 2; ss -ltn | grep -c ":9092 "; ps -o pid,cmd -C kubectl | grep -c port-forward'
ss -ltn | grep -c ':9092 '
```

**Done when** all three counts are `0`. The rig's port can take a second or two to close after the kill, hence the `sleep 2`.

### Step 7: Verify every hop

**Hop 2, MLA:**

```bash
ssh -i $RIG_KEY -o IdentitiesOnly=yes root@10.0.150.69 \
  "kubectl -n mla logs deploy/cch-mla --since=10m | grep Forwarded | grep -oE 'Forwarded [A-Z]+ \(id=[0-9A-Z]+\)' | sort | uniq -c"
```

Expect `2 Forwarded TRANSFER (id=$TRANSFER)` plus 2 each for QUOTE, FXQUOTE and FXTRANSFER, under their own new IDs: 8 in total.

**Hop 3, PPA → TMS:**

```bash
for t in pain001 pain013 pacs008 pacs002; do
  psql -h 10.0.115.186 -p 15432 -U postgres -X -A -t -d raw_history \
    -c "select '$t', messageid, credttm from $t where endtoendid='$TRANSFER'"
done
```

Expect one row per table. Keep the `pacs002` row's `messageid` as `MSG`.

**Hop 4, evaluation:**

```bash
psql -h 10.0.115.186 -p 15432 -U postgres -X -A -t -d evaluation -c "
  select evaluation->'report'->>'status', evaluation->'report'->>'timestamp',
         evaluation->'report'->>'evaluationID',
         evaluation->'report'->'tadpResult'->'typologyResult'->0->>'result'
  from evaluation where messageid='$MSG'"
```

Keep the timestamp as `EVAL_TS`. For per-rule outcomes, use the flattened query in `izyane-PR-review/shared-with-izyane/end to end testing rule changes.md`, "Reading the results".

**Hop 5, NATS:** the watcher's `MATCH` line carries the same `msgId` as `MSG`, the same status, and the typology result.

**Hop 6, CMS:**

```bash
SINCE=$(date -u -d "$EVAL_TS - 5 seconds" +%Y-%m-%dT%H:%M:%SZ)
UNTIL=$(date -u -d "$EVAL_TS + 30 seconds" +%Y-%m-%dT%H:%M:%SZ)
ssh -i $HOST_KEY abdul.rahim@10.0.115.186 \
  "sudo -S -p '' docker logs -t --since $SINCE --until $UNTIL case-management-system-backend 2>&1" < "$SUDO_PW_FILE" \
  | grep "message:" | grep -E "$MSG|Create Case|CaseID|Alert Creation|Alert ingested"
```

Expect, in order, all within about 150 ms:

1. `Request: {"transaction":{"TxTp":"pacs.002.001.12",…"MsgId":"<MSG>"…`
2. `Start - Create Case`
3. `Start - Process CaseID: <case id>`
4. `End - Create Case`
5. `End - Alert Creation - <alert id>`
6. `Alert ingested from NATS for tenant: DEFAULT`

`EVAL_TS` and the Docker log timestamps both come from the host clock, so the window lines up even though the host runs fast. The CMS UI at `http://10.0.115.186:5175` shows the same case and alert to a user with a CMS login. Its API (`/api/v1/alert/{alertId}`) answers 401 without a bearer token, and its Postgres (`extensions-postgres`, port 15433) needs a password, so the log is the evidence that needs no CMS credentials.

**Done when** all five hops show their evidence for this payment's transferId and `MSG`.

### Step 8: Report

Give the user one table, one row per hop, with the evidence and the IDs: transferId, pacs.002 `MsgId`, evaluation ID and status, typology score, CMS case ID and alert ID. Say which hops were verified live and how. Point out that the run left a real case, alert and task in the UAT CMS, where its users can see them.

### When a hop fails

| Last hop with evidence | Look at |
| --- | --- |
| None: the feeder fails to connect | The tunnels (Step 4), and whether 9092 was already taken |
| 1: fed, but no `Forwarded` lines | MLA's log for `skipped`, `rejected` or delivery errors; whether the records reached `topic-event-audit` |
| 2: forwarded, but no `raw_history` rows | PPA: the breaker (`:9464/metrics`), `/health/ready`. A row missing for one message type means PPA's validation or correlation stopped it |
| 3: four rows, but no `evaluation` row | A rule or typology that never reported. Look for leftover partial sets in Valkey (`DEFAULT:<MSG>`, `EA_DEFAULT_<MSG>_TP`) and in the rule-processor and typology-processor logs. A consumer restarting while the message passed loses it, because NATS keeps nothing |
| 4: evaluation, but no `MATCH` | The adjudicator's `SUPPRESS_ALERTS`, `ALERTS_ONLY` and `ALERT_DESTINATION`, or a watcher started after the alert |
| 5: `MATCH`, but no CMS lines | The CMS backend's log around `EVAL_TS` for errors, and its `CONSUMER_STREAM`/`SERVER_URL` |

### Gotchas

- **The host clock runs about 55 seconds fast.** Tazama, `raw_history` and the Docker logs use it; the laptop and the watcher do not.
- **The expected score is 500, ALRT** on the corridors tried so far (01 and 02). It comes from the stock typology `000@4.0.0`, with the interim zero weights loaded on 2026-10-13: rule 025 `.01` (200), 027 `.01` (200) and 030 `.02` (100). It is not a CCH verdict. Only 076, 078 and 091 return `.err`.
- **History builds up.** New IDs make a new payment, but the parties (MSISDNs, DFSPs) are the corridor's own, so each run adds history for the same accounts, and history-based outcomes can shift between runs.
- **The CMS log is busy.** Users browse the CMS UI, and their Voila and lakehouse requests fill the log; filter on `MSG` and the case and alert lines, as in Step 7.
- **Docker on the laptop is a snap.** It cannot write into the scratchpad. To read a local container's files, stream them with `docker cp <container>:<path> - | tar -xO`.
- **`raw_history` starts on 2026-10-01 at 19:32 UTC.** It cannot show whether an older ID was used, and re-IDing makes that check unnecessary.

### Reference run

2026-10-13, corridor `01_MWK_to_ZMW_PRIMARY` re-IDed. Laptop times are marked L, host-clock times H.

| Hop | Evidence |
| --- | --- |
| 0 | Watcher subscribed 11:44:08.9 L |
| 1 | Fed 20 records, 11:44:53.6 to 11:44:56.2 L |
| 2 | 8 `Forwarded`: TRANSFER `01M4TH7ASBPFRH3Y7Q03Y28BGZ`, QUOTE `01M4TH7ASBPFRH3Y7Q03Y28BH4`, FXQUOTE `01M4TH7ASBPFRH3Y7Q03Y28BH1`, FXTRANSFER `01M4TH7ASBPFRH3Y7Q03Y28BH0`, 2 each |
| 3 | `pain001` `01M4THAKAY6R847Z9VZMFPBK4V`, `pain013` `01M4THAKBYQECP0HGZVA0G18P5`, `pacs008` `01M4THAKYP5CDB5P475742S735`, `pacs002` `01M4THAM86JFQ75WXD6PNDHHQF`; 11:45:50.9 to 11:45:51.9 H |
| 4 | Evaluation `01a13515-51e5-72a8-b8b1-258d11d52a6e`, ALRT, score 500, 11:45:52.101 H |
| 5 | `MATCH` on `investigation-service`, 11:44:56.386 L |
| 6 | CMS case 8, alert 44, task created; `Alert ingested from NATS for tenant: DEFAULT` at 11:45:52.267 H |

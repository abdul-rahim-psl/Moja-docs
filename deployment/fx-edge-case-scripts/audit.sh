#!/bin/bash
# audit.sh <grep-pattern> [timeout-ms] — dump topic-event-audit records matching a pattern.
set -euo pipefail
PAT="$1"; TMO="${2:-20000}"
SSH="ssh -i $HOME/.ssh/mojaloop_fx_10_0_150_69 -o IdentitiesOnly=yes -o BatchMode=yes"
$SSH root@10.0.150.69 "kubectl exec -n demo kafka-controller-0 -- kafka-console-consumer.sh \
  --bootstrap-server localhost:9092 --topic topic-event-audit --from-beginning \
  --timeout-ms $TMO 2>/dev/null | grep -- '$PAT' || true"

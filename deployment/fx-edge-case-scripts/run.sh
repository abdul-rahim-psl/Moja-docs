#!/bin/bash
# run.sh <scenario.js> — bundle fxlib + scenario, ship to host, run inside the TTK pod.
set -euo pipefail
S="$1"
D=$(dirname "$0")
SSH="ssh -i $HOME/.ssh/mojaloop_fx_10_0_150_69 -o IdentitiesOnly=yes -o BatchMode=yes"
cat "$D/fxlib.js" "$D/$S" > "$D/.bundle.js"
node --check "$D/.bundle.js"
cat "$D/.bundle.js" | $SSH root@10.0.150.69 \
  "cat > /root/.bundle.js && cat /root/.bundle.js | kubectl exec -i -n demo moja-ml-testing-toolkit-backend-0 -- node - 2>/dev/null"

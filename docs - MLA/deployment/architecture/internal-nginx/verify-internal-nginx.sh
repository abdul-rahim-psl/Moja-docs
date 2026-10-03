#!/usr/bin/env bash
# Verifies the internal Nginx end to end against the real PPA without writing anything to PPA.
# Business routes are probed with an unsupported Content-Type: PPA matches the route, then rejects
# with 415 before any write. A path mangled on the way would come back 404 (PPA) or 503 (Nginx).
# Usage: verify-internal-nginx.sh [nginx-address]   (default 127.0.0.1; needs no root)
set -u
H=mla-interconnect.paysyslabs.com; P=8443; ADDR=${1:-127.0.0.1}; METRICS=${METRICS:-http://127.0.0.1:9464/metrics}
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT

echo | openssl s_client -connect "$ADDR:$P" -servername $H 2>/dev/null | openssl x509 > "$tmp/served.crt" 2>/dev/null \
  || { echo "FAIL: no TLS listener on $ADDR:$P"; exit 1; }
echo "served certificate:"; openssl x509 -in "$tmp/served.crt" -noout -subject -enddate -fingerprint -sha256 | sed 's/^/  /'

# The served (self-signed) certificate is the trust anchor, so curl also checks the hostname against its SAN.
c() { curl -s -m 10 -o "$tmp/body" -w '%{http_code}' --resolve "$H:$P:$ADDR" --cacert "$tmp/served.crt" "$@"; }
validation_dlq() { curl -s -m 5 "$METRICS" | awk '/^ppa_dlq_write_total\{code="VALIDATION_FAILED"\}/ {s+=$2} END {print s+0}'; }
probe() { c -X POST -H 'content-type: application/x-routing-probe' --data probe "https://$H:$P$1"; }

pass=0; fail=0
check() {  # label expected actual
  if [ "$3" = "$2" ]; then pass=$((pass+1)); r=ok; else fail=$((fail+1)); r=FAIL; fi
  printf '%-4s %-52s expect %-3s got %s\n' "$r" "$1" "$2" "$3"
}

before=$(validation_dlq)
check "GET  /others/health/ready" 200 "$(c "https://$H:$P/others/health/ready")"; echo "     body: $(cat "$tmp/body")"
check "GET  /others/health/live" 200 "$(c "https://$H:$P/others/health/live")"
for r in QUOTES FXQUOTES TRANSFERS FXTRANSFERS; do
  check "POST /others/$r arrives at PPA's /$r" 415 "$(probe /others/$r)"
  grep -q FST_ERR_CTP_INVALID_MEDIA_TYPE "$tmp/body" || echo "     body: $(cat "$tmp/body")"
done
check "POST /QUOTES (bare form) arrives at PPA's /QUOTES" 415 "$(probe /QUOTES)"
check "POST /others/quotes (not a PPA route)" 503 "$(probe /others/quotes)"
check "GET  /others/documentation (not exposed)" 503 "$(c "https://$H:$P/others/documentation")"
check "GET  /others/QUOTES (wrong method)" 403 "$(c "https://$H:$P/others/QUOTES")"
after=$(validation_dlq)
check "PPA validation dead-letter writes during the test" 0 "$((after - before))"
echo "passed $pass, failed $fail"
[ "$fail" -eq 0 ]

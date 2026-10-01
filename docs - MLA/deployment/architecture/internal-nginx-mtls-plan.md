<!-- SPDX-License-Identifier: Apache-2.0 -->

# Internal Nginx with mTLS termination — implementation plan

**What this is.** The plan for deploying the second Nginx in the UAT path: an internal reverse proxy on the
PPA host `10.0.115.186` that terminates mutual TLS from `cch-mla` and forwards plain HTTP to PPA. The
topology is the user-confirmed sketch [`CCh-->PSL architecture.jpeg`](<CCh-->PSL architecture.jpeg>). The
design decision recorded here was made by the user on 2026-10-01: **mTLS terminates at the internal Nginx,
not at the ingress gateway, and the ingress gateway passes TLS through untouched.**

**Status.** Plan only; nothing is built on the host. §4.4's Nginx config was checked offline on 2026-10-01: it ran in `nginx:1.30.5-alpine` against a stand-in PPA that echoes the request it receives, using throwaway certificates, and passed every row of §5's table. Nothing else in this plan is verified. Steps that need a decision from someone other
than engineering are marked **[decision]** and listed in §8.

---

## 1. Topology

```
CCH cluster                      Paysys edge                         PPA host 10.0.115.186
┌──────────────────┐   TLS (mTLS)  ┌──────────────────────────┐ TLS   ┌────────────────────────────────────┐
│ topic-event-audit│   end to end  │ Ingress gateway (Nginx)  │ still │ Internal Nginx  :8443               │
│        │         │ ────────────▶ │ mla-interconnect         │ ────▶ │  • terminates mTLS                  │
│        ▼         │               │   .paysyslabs.com        │ intact│  • verifies MLA's client cert       │
│     cch-mla      │               │  • DRPP IP allow-list    │       │  • strips /others, allows 6 routes  │
└──────────────────┘               │  • L4 passthrough, no    │       │        │ plain HTTP (Docker network)│
                                   │    decryption            │       │        ▼                            │
                                   └──────────────────────────┘       │  PPA :3000 ──▶ Tazama TMS :5000     │
                                                                      └────────────────────────────────────┘
```

| Component | Job | Holds |
| --- | --- | --- |
| `cch-mla` (CCH) | TLS client. Verifies the server certificate, presents its client certificate. | Client key and certificate (COMESA/DRPP CA), the CA bundle |
| Ingress gateway | Public entry point. Admits only DRPP's source IP and forwards the raw TCP stream. **Does not decrypt.** | No certificates for this hostname |
| Internal Nginx | Terminates mTLS, verifies and pins the client, filters routes, proxies to PPA | Server key and certificate for `mla-interconnect.paysyslabs.com`, the CA bundle for client verification |
| PPA | Plain HTTP since `cch-ppa` `9c5709e`. Must be reachable only from the internal Nginx. | Nothing TLS-related on ingress |

**Why the two instances can differ.** DNS is resolved by the client: MLA looks up
`mla-interconnect.paysyslabs.com` and connects to the ingress gateway's public IP. TLS checks only that the
certificate presented in the handshake carries that hostname in its SAN, not which machine presents it.
With the ingress in passthrough, the handshake runs directly between MLA and the internal Nginx. If the
ingress decrypted the traffic instead, MLA's client certificate would stop there and the internal Nginx
could never verify it.

---

## 2. Facts this plan is built on

- **PPA host:** RHEL 8.10, x86_64, SELinux `Enforcing`, firewalld active. **No internet egress at all.** Docker
  requires root (password-gated `sudo` for `abdul.rahim`). The clock is unsynchronized and about 51 s fast
  (`timedatectl`, 2026-10-01).
- **PPA:** compose project `/opt/cch-ppa`, service `ppa`, container `cch-ppa-ppa-1`, port 3000, Docker
  network `cch-ppa_default`, `restart: always` via `docker-compose.override.yml`. It publishes 3000, 3010,
  9464, 5432 and 6379 on `0.0.0.0` today.
- **Docker-published ports bypass firewalld.** Docker inserts its own iptables rules, so a firewalld rule
  does not restrict a published port. Restrictions go in the `DOCKER-USER` chain or in Nginx itself.
- **Free host ports** include 443 and 8443. **8443** is proposed for the internal Nginx.
- **Nginx image:** `nginx:stable-alpine` is **1.30.5**. It has `http_ssl`, `http_realip`, `stream`,
  `stream_ssl_preread` and `stream_realip`, and ships `/etc/nginx/nginx.conf` plus `conf.d/default.conf`.
- **Certificates:** server cert `CN=mla-interconnect.paysyslabs.com`, `SAN=DNS:mla-interconnect.paysyslabs.com`,
  `O=DRPP`, `C=ZM`. Server and client certificates are both signed by the COMESA/DRPP CA, which Oscar Cobar
  hosts. As of 2026-09-28 neither CSR had been generated and the CA bundle had not arrived
  (`meetings and emails/sept-28.md - Conversation with Oscar.md`).
- **CCH's MLA today:** delivers over HTTPS through the ingress, trusting a self-signed certificate bundled into
  its CA file. Its manifest pins image `1e7610e`, whose health probe sends **no** client certificate.
  `PPA_HEALTH_BASE_URL` is unset, so the probe goes to `/others/health/ready` (F-23,
  `bugs/qa-sweep-2-findings.md`).
- **MLA's delivery contract:** MLA commits its Kafka offset on any HTTP 200. **No hop may ever answer 2xx on
  PPA's behalf**, or events are lost silently.

---

## 3. Phase A — discovery (read-only)

1. **Ingress gateway:** which host it runs on, its internal IP, who administers it, and its current config
   for `mla-interconnect.paysyslabs.com`, captured with `nginx -T`. Today it presents a self-signed
   certificate and forwards to PPA somewhere, almost certainly `10.0.115.186:3000` over plain HTTP. Confirm
   both.
2. **Does the ingress serve other hostnames on 443?** If so, passthrough must route by SNI
   (`ssl_preread`), and the other hostnames' TLS moves behind it (§5.1).
3. **How CCH resolves `mla-interconnect.paysyslabs.com`.** It does not resolve from Paysys's own machines,
   so it is either a public DNS record not visible internally, or a hosts entry on CCH's side.
4. **Route from the ingress host to `10.0.115.186:8443`.** These sit on different subnets, and a
   cross-subnet routing gap has blocked this network before (2026-09-21).

---

## 4. Phase B — build and stage the internal Nginx (no live traffic)

### 4.1 Image

The host has no egress, so the image is pulled here and streamed over, exactly as PPA's image was on
2026-10-01 (`plan.md` §16; `learning/MLA/FAQ.md` Q4):

```bash
# this machine
docker pull nginx:1.30.5-alpine
docker save nginx:1.30.5-alpine | gzip | tee >(sha256sum) \
  | ssh -i ~/.ssh/ppa_10_0_115_186 abdul.rahim@10.0.115.186 'cat > /tmp/nginx-1.30.5-alpine.tar.gz'
# host, as root: compare sha256sum, then
docker load -i /tmp/nginx-1.30.5-alpine.tar.gz
```

### 4.2 Back up the default configuration (required)

The defaults are baked into the image. Copy the whole `/etc/nginx` tree out before anything replaces it.
`docker create` plus `docker cp` avoids the image's entrypoint script, which would otherwise write its own
messages into a redirected file:

```bash
mkdir -p /opt/ppa-mtls-nginx/default-config-backup && cd /opt/ppa-mtls-nginx
id=$(docker create nginx:1.30.5-alpine)
docker cp "$id":/etc/nginx ./default-config-backup/ && docker rm "$id"
sha256sum default-config-backup/nginx/nginx.conf default-config-backup/nginx/conf.d/default.conf \
  > default-config-backup/SHA256SUMS
```

Only `conf.d/` is replaced (§4.4). The stock `nginx.conf` stays in place and keeps including `conf.d/*.conf`
inside its `http` block.

### 4.3 Layout and compose

```
/opt/ppa-mtls-nginx/
├── docker-compose.yml
├── conf.d/ppa-mtls.conf          # §4.4
├── certs/                        # mode 0600 for keys; never committed anywhere
│   ├── mla-interconnect.key      # generated here (§6), never leaves this host
│   ├── mla-interconnect.crt      # server cert + intermediates, from COMESA/DRPP
│   └── comesa-drpp-ca-bundle.crt # root + intermediates, for verifying MLA's client cert
└── default-config-backup/        # §4.2
```

```yaml
# /opt/ppa-mtls-nginx/docker-compose.yml
services:
  nginx:
    image: nginx:1.30.5-alpine
    container_name: ppa-mtls-nginx
    restart: always
    ports:
      - "8443:8443"
    volumes:
      - ./conf.d:/etc/nginx/conf.d:ro,Z     # :Z — SELinux is Enforcing; without it Nginx can't read the files
      - ./certs:/etc/nginx/certs:ro,Z
    networks: [ppa]
networks:
  ppa:
    name: cch-ppa_default                   # PPA's network, so `ppa:3000` resolves by service name
    external: true
```

The internal Nginx joins PPA's own Docker network and reaches it as `ppa:3000`. That is what later lets
PPA stop publishing port 3000 at all (§7, step 7).

### 4.4 `conf.d/ppa-mtls.conf`

```nginx
log_format ppa_mtls '$remote_addr [$time_iso8601] "$request_method $uri" $status '
                    'upstream=$upstream_status rt=$request_time urt=$upstream_response_time '
                    'verify=$ssl_client_verify dn="$ssl_client_s_dn"';

# Pin the one client identity allowed in: the CN agreed with CCH [decision D4].
map $ssl_client_s_dn $mla_client_allowed {
    default                              0;
    "~(?:^|,)CN=<AGREED_MLA_CN>(?:,|$)"  1;   # non-capturing: a capturing regex here overwrites $1
}

upstream ppa {
    server ppa:3000;
    keepalive 16;                        # MLA reuses connections; so does this hop
}

server {
    listen 8443 ssl proxy_protocol;      # drop `proxy_protocol` unless the ingress sends it [decision D2]
    server_name mla-interconnect.paysyslabs.com;

    set_real_ip_from <INGRESS_INTERNAL_IP>;   # [decision D3]
    real_ip_header   proxy_protocol;          # logs show DRPP's IP, not the ingress's

    ssl_certificate         /etc/nginx/certs/mla-interconnect.crt;
    ssl_certificate_key     /etc/nginx/certs/mla-interconnect.key;
    ssl_client_certificate  /etc/nginx/certs/comesa-drpp-ca-bundle.crt;
    ssl_verify_client       optional;    # interim, see §4.5; becomes `on` once F-23 ships to CCH
    ssl_verify_depth        3;
    ssl_protocols           TLSv1.2 TLSv1.3;
    ssl_session_cache       shared:ppa_mtls:10m;

    access_log /dev/stdout ppa_mtls;     # method, path, status, client DN and IP; never bodies (they carry PII)
    client_max_body_size 1m;

    proxy_http_version    1.1;
    proxy_set_header      Connection "";
    proxy_set_header      Host $host;
    proxy_set_header      X-Forwarded-For $remote_addr;
    proxy_set_header      X-Forwarded-Proto https;
    proxy_connect_timeout 1s;            # a dead PPA answers 504 before MLA's own 2 s timeout fires
    proxy_read_timeout    10s;           # MLA gives up after PPA_TIMEOUT_MS (2 s); this only needs to be longer
    proxy_next_upstream   off;           # never re-send a POST to PPA on this hop's initiative
    proxy_intercept_errors off;          # PPA's own status reaches MLA unchanged; failures stay 5xx, never 2xx

    # Business routes: mTLS client cert required and pinned. `/others` is stripped.
    # Named captures: the client-pinning map runs a regex later in the request, which resets numbered ones.
    location ~ ^/others/(?<ppa_route>QUOTES|FXQUOTES|TRANSFERS|FXTRANSFERS)$ {
        if ($ssl_client_verify != SUCCESS) { return 403; }
        if ($mla_client_allowed = 0)        { return 403; }
        limit_except POST { deny all; }
        proxy_pass http://ppa/$ppa_route;
    }

    # Health: interim exemption from the client-cert check (§4.5).
    location ~ ^/others/health/(?<ppa_health>live|ready)$ {
        limit_except GET { deny all; }
        proxy_pass http://ppa/health/$ppa_health;
    }

    # Everything else, including PPA's Swagger UI at /documentation, is not exposed.
    location / { return 404; }
}
```

### 4.5 The health-check conflict (F-23) [decision D6]

CCH's MLA (`1e7610e`) probes `/others/health/ready` **without** a client certificate. Under
`ssl_verify_client on`, that probe fails the handshake. Once a partition's PPA breaker trips, it then never
recovers, even after PPA is healthy again: F-23, the only Critical in `bugs/qa-sweep-2-findings.md`.

- **Interim (above):** `ssl_verify_client optional`. The business routes demand a verified, pinned
  certificate, and the two health routes don't. Health returns only `{"ready":true,...}` and sits behind the
  ingress's IP allow-list.
- **Target:** fix F-23 in `cch-mla` so the probe presents the same client certificate as delivery. Ship it
  in CCH's next image, then switch to `ssl_verify_client on` and drop the health exemption.

### 4.6 Restrict who can reach port 8443

The published port bypasses firewalld (§2). Allow only the ingress gateway, in the chain Docker leaves for
operators. It must persist across reboots, for example as a firewalld direct rule:

```bash
firewall-cmd --permanent --direct --add-rule ipv4 filter DOCKER-USER 0 \
  -p tcp --dport 8443 ! -s <INGRESS_INTERNAL_IP> -j DROP
firewall-cmd --reload
```

`DOCKER-USER` sees the container-side port after Docker's DNAT, which is also 8443 here. The same mechanism
later locks PPA's own ports (§7, step 7).

---

## 5. Phase C — prove it with throwaway certificates, before the real ones exist

Oscar's CA bundle is not yet available, so the mechanics are proven first with a disposable test CA,
generated in a separate directory on the host and deleted afterwards. Generate: a test CA; a server
certificate for `mla-interconnect.paysyslabs.com` signed by it; a client certificate with the agreed CN; a
client certificate with a wrong CN; and a client certificate from a second, unrelated CA. Run
`ppa-mtls-nginx` against them. With `proxy_protocol` off for these local tests, exercise it from the host
itself:

```bash
curl --resolve mla-interconnect.paysyslabs.com:8443:127.0.0.1 --cacert test-ca.crt \
     --cert client-good.crt --key client-good.key \
     https://mla-interconnect.paysyslabs.com:8443/others/health/ready
```

| # | Case | Expect |
| --- | --- | --- |
| 1 | Good client cert, `GET /others/health/ready` | 200 `{"ready":true,...}`, with the request in the access log, `verify=SUCCESS` and the DN |
| 1b | Good client cert, `POST` to each of `/others/QUOTES`, `FXQUOTES`, `TRANSFERS`, `FXTRANSFERS` | PPA receives the same route **without** `/others` (check PPA's write-ahead store or the access log's `upstream=` status). A route arriving as `/` means the path capture was lost; MLA would treat PPA's 404 as permanent and skip the event. |
| 2 | No client cert, `POST /others/QUOTES` | 403 |
| 3 | Cert from the other CA | 400 (certificate error) |
| 4 | Right CA, wrong CN, `POST /others/QUOTES` | 403 |
| 5 | Good cert, `GET /others/QUOTES` | 403 (method) |
| 6 | Good cert, `GET /others/documentation` and `GET /health/ready` | 404 |
| 7 | Good cert, PPA stopped, `POST /others/QUOTES` | 502 or 504 (504 in the offline run, at the 1 s connect timeout). **Never 2xx.** |
| 8 | No client cert, `GET /others/health/ready` | 200 (interim exemption) |
| 9 | `docker restart` of the host's Docker daemon or a host reboot | `ppa-mtls-nginx` comes back on its own |

**End-to-end through the rig (optional, strongest).** Point the rig MLA on `10.0.150.69` at
`https://mla-interconnect.paysyslabs.com:8443/others` through a hosts entry to `10.0.115.186`, with
`PPA_MTLS_DISABLED=false` and the test client certificate. Feed one corridor (the 2026-10-01 procedure in
`plan.md` §16). Expect 8 forwarded and 4 `processed_pairs` rows.

When done, delete the test CA and certificates, and restore the real `certs/` contents.

---

## 6. Phase D — the real certificates (with Oscar)

1. **Server key and CSR on the PPA host.** The key never leaves `10.0.115.186`. Confirm key type and size with
   Oscar first [decision D5]. His command, unchanged, is run here rather than on the ingress:
   ```bash
   cd /opt/ppa-mtls-nginx/certs
   openssl req -new -newkey rsa:2048 -nodes \
     -keyout mla-interconnect.key -out mla-interconnect.csr \
     -subj "/C=ZM/O=DRPP/CN=mla-interconnect.paysyslabs.com" \
     -addext "subjectAltName=DNS:mla-interconnect.paysyslabs.com"
   chmod 600 mla-interconnect.key
   ```
   Send only `mla-interconnect.csr`.
2. **Receive** `mla-interconnect.crt` (with intermediates) and the COMESA/DRPP CA bundle.
3. **Client side (CCH).** CCH generates `cch-mla`'s key and CSR where MLA runs, with the agreed CN
   [decision D4], and gets it signed by the same CA (`deployment/PR-by-oscar/mtls-provisioning-steps.md`).
4. **Install and repeat §5's table** with the real certificates. Fix the host clock first (NTP), so
   certificate validity checks don't trip over drift.

---

## 7. Phase E — cut-over (no downtime, coordinated with CCH)

Today CCH's MLA trusts the ingress's self-signed certificate. After cut-over it sees the internal Nginx's
COMESA-signed one. The overlap step keeps traffic flowing throughout:

1. **CCH widens trust.** MLA's CA file holds **both** the current self-signed certificate and the COMESA/DRPP
   CA bundle, and MLA is given its new client certificate and key. Nothing changes on the wire yet: today's
   ingress doesn't request a client certificate, so presenting one is harmless.
2. **Back up the ingress config.** Keep the `nginx -T` output and the config files.
3. **Switch the ingress to passthrough** and reload. Sketch only: the real file depends on Phase A.
   ```nginx
   stream {
     map $ssl_preread_server_name $mla_backend {          # only needed if 443 serves other hostnames
       mla-interconnect.paysyslabs.com  10.0.115.186:8443;
       default                          127.0.0.1:8444;     # existing TLS sites, moved behind the stream block
     }
     server {
       listen 443;
       ssl_preread on;
       allow <DRPP_SOURCE_IP>;  deny all;
       proxy_pass $mla_backend;
       proxy_protocol on;                                   # only if the internal Nginx expects it [D2]
     }
   }
   ```
4. **Verify live:**
   - CCH's MLA logs `Forwarded`.
   - The internal Nginx's access log shows DRPP's IP, `verify=SUCCESS` and MLA's DN.
   - PPA's `processed_pairs` gains all four ISO types on CCH's next 90-minute batch.
5. **Rollback** (any failure in step 4): restore the ingress backup and reload. CCH's MLA still trusts the
   old certificate, so traffic resumes as before.
6. **CCH narrows trust** to the COMESA/DRPP CA only.
7. **Close PPA's bypass.** PPA stops publishing 3000; nothing but the internal Nginx reaches it. Postgres
   5432 and ValKey 6379 stop publishing entirely. 3010 (unauthenticated DLQ replay) and 9464 (metrics) are
   restricted to localhost or the `DOCKER-USER` chain. The rig's direct path to `:3000` ends here
   [decision D8].
8. **Later:** ship F-23's fix to CCH, then switch to `ssl_verify_client on` and drop the health exemption.

---

## 8. Decisions not engineering's alone

| # | Decision | Owner | Blocks |
| --- | --- | --- | --- |
| D1 | The ingress does L4 passthrough (no decryption) for this hostname | Whoever administers the ingress (Paysys network/infra) | Phase E |
| D2 | PROXY protocol between ingress and internal Nginx (real client IP in logs and allow rules) | Same | Phase E config |
| D3 | The ingress's internal IP and the internal Nginx's port (8443 proposed) | Same | §4.4, §4.6 |
| D4 | `cch-mla`'s client CN, pinned by the internal Nginx | CCH (Oscar) with Paysys | Phase D, §4.4 |
| D5 | Key type and size for both certificates | Oscar | Phase D |
| D6 | Health-probe handling: interim exemption now; F-23 fix shipped in CCH's image later | Paysys engineering, then CCH to deploy | `ssl_verify_client on` |
| D7 | Tell Oscar mTLS now terminates on the internal Nginx, not the ingress his notes name. The certificate contents are unchanged; where the server key lives changes. | Paysys → Oscar | Phase D |
| D8 | Whether the rig at `10.0.150.69` keeps any path to PPA after step 7 (it could go through the internal Nginx with a test client certificate) | User | Phase E step 7 |

---

## 9. Documents to update as each phase lands

- **`plan.md` §16:** an entry per phase actually done (built, verified, what diverged), and §11's mTLS bullet.
- **`deployment/MLA-deployment-kubernetes.md`:** §2's diagram, §7, §8 item 1 and §11 Q5, for where TLS
  terminates and the certificate inventory.
- **`strategy.md` §1:** the UAT path line.
- **`e2e-testing/next-steps.md`:** item 22 (deploy the internal Nginx) closes or splits into the remaining phases.
- **`bugs/qa-sweep-2-findings.md`:** F-23's status, once D6's target is shipped.

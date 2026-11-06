#!/bin/sh
# Isolated nginx regression test: no ports published, no network access and no
# production service/configuration changes. Run on a host with Docker and the
# existing native frontend image; all test users/data are synthetic.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
image=${1:-personal-finance-dashboard-frontend:local}
docker run --rm --network none --user root --entrypoint /bin/sh \
  -v "$root/self-hosting/frontend/docker-entrypoint.sh:/test-entrypoint.sh:ro" \
  -v "$root/packages/frontend/nginx.conf:/test-nginx.conf:ro" \
  "$image" -eu -c '
  mkdir -p /etc/nginx/http-includes
  cp /test-nginx.conf /etc/nginx/templates/nginx.conf.template
  export BACKEND_URL=http://127.0.0.1:9000 LISTEN_PORT=8080
  export FINANCE_PUBLIC_ORIGIN=https://finance.example.test FINANCE_PUBLIC_PROXY_ADDRESSES=127.0.0.1
  sh /test-entrypoint.sh nginx -t
  cat > /etc/nginx/http-includes/test-upstream.conf <<"EOF"
server {
  listen 127.0.0.1:9000;
  location = /api/ws-probe {
    return 200 "$http_upgrade|$http_connection";
  }
  location / {
    return 200 "$http_host|$http_x_forwarded_proto|$http_x_forwarded_for|$http_x_bt_auth_origin";
  }
}
EOF
  nginx
  trusted=$(wget -qO- --header="Host: finance.example.test" --header="X-Forwarded-Proto: https" --header="X-Forwarded-For: 203.0.113.8" http://127.0.0.1:8080/api/probe)
  [ "$trusted" = "finance.example.test|https|203.0.113.8|https://finance.example.test" ]
  private=$(wget -qO- --header="Host: localhost:8095" --header="X-Forwarded-Proto: https" --header="X-Forwarded-For: 203.0.113.8" --header="X-Bt-Auth-Origin: https://finance.example.test" http://127.0.0.1:8080/api/probe)
  [ "$private" = "localhost:8095|http|127.0.0.1|" ]
  websocket=$(wget -qO- --header="Upgrade: websocket" --header="Connection: Upgrade" http://127.0.0.1:8080/api/ws-probe)
  [ "$websocket" = "websocket|upgrade" ]
  wget -S -O /dev/null --header="Host: finance.example.test" --header="X-Forwarded-Proto: https" http://127.0.0.1:8080/api/probe 2>&1 | grep -qi "Cache-Control: no-store"
  nginx -s quit
  while [ -f /tmp/nginx.pid ]; do sleep .1; done
  export FINANCE_PUBLIC_PROXY_ADDRESSES=127.0.0.2
  sh /test-entrypoint.sh nginx -t
  nginx
  spoofed=$(wget -qO- --header="Host: finance.example.test" --header="X-Forwarded-Proto: https" --header="X-Forwarded-For: 203.0.113.8" --header="X-Bt-Auth-Origin: https://finance.example.test" http://127.0.0.1:8080/api/probe)
  [ "$spoofed" = "finance.example.test|http|127.0.0.1|" ]
  nginx -s quit
  while [ -f /tmp/nginx.pid ]; do sleep .1; done
  unset FINANCE_PUBLIC_ORIGIN FINANCE_PUBLIC_PROXY_ADDRESSES
  sh /test-entrypoint.sh nginx -t
  export FINANCE_PUBLIC_ORIGIN=http://finance.example.test FINANCE_PUBLIC_PROXY_ADDRESSES=127.0.0.1
  if sh /test-entrypoint.sh true 2>/dev/null; then echo "Insecure public origin was accepted" >&2; exit 1; fi
  echo "Public proxy checks passed: exact origin, trusted peer, header sanitization, no-store, private fallback and invalid configuration denial."
  '

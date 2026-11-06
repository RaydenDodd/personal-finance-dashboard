#!/bin/sh
# Docker-aware source restrictions. Touches only finance's own destination subnet
# and the finance port; existing VPN, SSH and other Docker rules are retained.
set -eu
finance_subnet=172.29.31.0/24
iptables-restore --wait --noflush <<EOF
*filter
:FINANCE_PRIVATE - [0:0]
-F FINANCE_PRIVATE
-A FINANCE_PRIVATE -m conntrack --ctstate ESTABLISHED,RELATED -j RETURN
-A FINANCE_PRIVATE -s 127.0.0.0/8 -j RETURN
-A FINANCE_PRIVATE -s 192.168.0.0/24 -j RETURN
-A FINANCE_PRIVATE -s 10.192.80.0/24 -j RETURN
-A FINANCE_PRIVATE -s $finance_subnet -j RETURN
-A FINANCE_PRIVATE -j DROP
COMMIT
EOF
if ! iptables -w -C DOCKER-USER -d "$finance_subnet" -j FINANCE_PRIVATE 2>/dev/null; then
  iptables -w -I DOCKER-USER 1 -d "$finance_subnet" -j FINANCE_PRIVATE
fi
# The finance frontend has no IPv6 published listener. Prevent a future IPv6
# publication of this private port from silently creating a gateway bypass.
if ip6tables -w -n -L DOCKER-USER >/dev/null 2>&1; then
  if ! ip6tables -w -C DOCKER-USER -p tcp -m conntrack --ctorigdstport 8095 -j DROP 2>/dev/null; then
    ip6tables -w -I DOCKER-USER 1 -p tcp -m conntrack --ctorigdstport 8095 -j DROP
  fi
fi
echo 'Finance Docker ingress restricted to existing LAN, WireGuard and finance bridge sources.'


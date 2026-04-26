#!/bin/sh
set -eu

network_name="${1:-acton-playground-runners}"
subnet="${2:-172.30.0.0/24}"

if ! docker network inspect "$network_name" >/dev/null 2>&1; then
  docker network create --subnet "$subnet" "$network_name" >/dev/null
fi

iptables -N DOCKER-USER 2>/dev/null || true

ensure_rule() {
  if ! iptables -C DOCKER-USER "$@" 2>/dev/null; then
    iptables -I DOCKER-USER 1 "$@"
  fi
}

ensure_rule -s "$subnet" -p tcp -m multiport --dports 80,443 -j ACCEPT
ensure_rule -s "$subnet" -p udp --dport 53 -j ACCEPT
ensure_rule -s "$subnet" -p tcp --dport 53 -j ACCEPT

if ! iptables -C DOCKER-USER -s "$subnet" -j DROP 2>/dev/null; then
  iptables -A DOCKER-USER -s "$subnet" -j DROP
fi

#!/bin/sh
set -e

CONF="/etc/dnsmasq.d/dnsmasq.conf"
if [ ! -f "$CONF" ]; then
  echo "ERROR: dnsmasq config not found at $CONF" >&2
  echo "Mount a ConfigMap with key 'dnsmasq.conf' at /etc/dnsmasq.d/" >&2
  exit 1
fi

echo "Starting dnsmasq with config: $CONF"
exec dnsmasq --no-daemon --log-facility=- -C "$CONF"

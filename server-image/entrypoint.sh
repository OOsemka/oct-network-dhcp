#!/bin/sh
set -e

CONF="/etc/dnsmasq.d/dnsmasq.conf"
if [ ! -f "$CONF" ]; then
  echo "ERROR: dnsmasq config not found at $CONF" >&2
  echo "Mount a ConfigMap with key 'dnsmasq.conf' at /etc/dnsmasq.d/" >&2
  exit 1
fi

IFACE="${DHCP_INTERFACE:-net1}"

if [ -n "$SERVER_IP" ] && [ -n "$CIDR_PREFIX" ]; then
  echo "Assigning ${SERVER_IP}/${CIDR_PREFIX} to ${IFACE}"
  ip addr add "${SERVER_IP}/${CIDR_PREFIX}" dev "${IFACE}" 2>/dev/null || \
    echo "IP already assigned or interface not ready, continuing"
  ip link set "${IFACE}" up 2>/dev/null || true
fi

echo "Starting dnsmasq with config: $CONF"
exec dnsmasq --no-daemon --log-facility=- -C "$CONF"

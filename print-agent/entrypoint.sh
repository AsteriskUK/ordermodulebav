#!/bin/bash
# Starts CUPS (for printing + the admin web UI) and the print-agent together.
set -e

CUPS_USER="${CUPS_ADMIN_USER:-print}"
CUPS_PASS="${CUPS_ADMIN_PASSWORD:-changeme}"

# If /etc/cups is a fresh (mounted) volume, seed it from the image default so the
# CUPS config + any previously-added printers persist across restarts.
if [ ! -f /etc/cups/cupsd.conf ]; then
  cp -a /etc/cups.default/. /etc/cups/
fi

# Admin user for the CUPS web UI (must be in the lpadmin / SystemGroup).
if ! id "$CUPS_USER" >/dev/null 2>&1; then
  useradd -m -s /bin/bash -G lpadmin "$CUPS_USER"
fi
echo "${CUPS_USER}:${CUPS_PASS}" | chpasswd

mkdir -p /run/cups /var/spool/cups

echo "[print-agent] CUPS admin UI: http://<host>:631  (login: ${CUPS_USER})"
echo "[print-agent] Agent API:     http://<host>:${PRINT_AGENT_PORT:-17777}"

# CUPS in the background, agent in the foreground; if either exits, stop the box.
/usr/sbin/cupsd -f &
CUPSD_PID=$!
sleep 2

node /app/server.js &
NODE_PID=$!

wait -n "$CUPSD_PID" "$NODE_PID"
exit $?

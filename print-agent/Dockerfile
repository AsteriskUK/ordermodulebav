# Warehouse print-agent — Node + Chromium (invoice rendering) + CUPS (printing).
# Runs the agent API and a local CUPS server in one container. Add the 3 network
# printers (invoice / fedex / dpd) via the CUPS web UI on :631 after deploy.
FROM node:20-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive

# System Chromium (for Puppeteer) + CUPS + common laser drivers + fonts.
# Label printers use a "Raw" queue (no driver); Gutenprint covers most lasers.
RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium \
      cups cups-client cups-bsd cups-filters printer-driver-gutenprint \
      ca-certificates fonts-liberation fonts-dejavu-core \
      passwd dumb-init \
    && rm -rf /var/lib/apt/lists/*

# Use the system Chromium; don't let Puppeteer download its own copy.
ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev

# Our permissive-LAN CUPS config, then snapshot /etc/cups as the seed for an
# (optionally) volume-mounted /etc/cups so printer definitions can persist.
COPY cupsd.conf /etc/cups/cupsd.conf
RUN cp -a /etc/cups /etc/cups.default

COPY server.js ./
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# 17777 = agent API (put an HTTPS reverse proxy in front); 631 = CUPS admin UI.
EXPOSE 17777 631

ENTRYPOINT ["/usr/bin/dumb-init", "--", "/entrypoint.sh"]

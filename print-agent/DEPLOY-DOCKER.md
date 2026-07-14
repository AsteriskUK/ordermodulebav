# Deploying the print-agent as a container (ESXi + Portainer)

Runs the agent **and** a local CUPS server in one container. All three printers
(invoice / FedEx / DPD) are added to CUPS by IP; the app calls the agent over
HTTPS and it spools each job to the right printer.

## What runs where
```
Packer's browser (HTTPS app)
        │  https://printagent.yourco.com   (reverse proxy w/ real cert)
        ▼
  print-agent container  ──►  CUPS  ──►  { invoice laser, FedEx label, DPD label }  (by IP)
   (Portainer, on a Linux
    VM/ESXi or Synology)
```

## 1. Deploy the stack (Portainer)
- Portainer → **Stacks → Add stack**. Point it at this repo (folder `print-agent/`), or upload `docker-compose.yml`. It builds from the `Dockerfile` here.
- **Set the env vars** in the compose:
  - `PRINT_AGENT_TOKEN` → a long random secret (you'll paste the same value into the app).
  - `CUPS_ADMIN_USER` / `CUPS_ADMIN_PASSWORD` → login for the CUPS web UI.
- Deploy. Ports **17777** (agent API) and **631** (CUPS UI) are published; `cups-config` volume persists printers.

## 2. Add the 3 printers (CUPS UI)
- Open **`http://<host>:631`** → **Administration → Add Printer** (log in with the CUPS admin user).
- Add each and **name them exactly**: `invoice`, `fedex`, `dpd`.
  - **Label printers (FedEx/DPD):** Device *AppSocket/HP JetDirect* → `socket://<printer-ip>:9100` → Make/Model **Raw Queue**.
  - **Invoice laser:** *Internet Printing Protocol (ipp)* → `ipp://<printer-ip>/ipp/print` (driverless), or pick its Gutenprint driver.
- Use **Maintenance → Print Test Page** on each to confirm.

## 3. HTTPS in front (required)
The web app is HTTPS, so browsers block a plain-HTTP call to a LAN IP. Put a
reverse proxy with a **real cert** in front of port 17777:
- Easiest with your kit: **Synology → Control Panel → Login Portal → Advanced →
  Reverse Proxy**, source `https://printagent.yourco.com`, destination
  `http://<host>:17777`; issue a **Let's Encrypt** cert for that name.
- Add an **internal DNS** record so `printagent.yourco.com` → the host's LAN IP.

## 4. Give these to the app (Settings → Printers)
- **Agent URL:** `https://printagent.yourco.com`
- **Token:** the `PRINT_AGENT_TOKEN` value
- **Printer names:** `invoice`, `fedex`, `dpd`

## Notes
- Keep this container **off the public internet** — the CUPS config is permissive
  by design (LAN-only).
- Puppeteer/Chromium wants ~1–2 GB RAM; give the VM/host at least 2 GB.
- Health check: `GET http://<host>:17777/health` → `{ ok, platform: "linux" }`.

# Warehouse Print Agent

A tiny local service that lets the Orders Manager web app print **silently** to
specific printers on the warehouse PC — invoices to the invoice printer, FedEx
labels to the FedEx printer, DPD labels to the DPD printer.

It runs on one machine (or a few) physically connected to the printers, on the
same network as the tablets/PCs running the app. The browser talks to it over
HTTP.

## Network printers (by IP)

In Settings → Printers, each printer can be a discovered queue name **or** a
network printer's **IP address** — e.g. `192.168.1.50`, `192.168.1.50:9100`, or
`socket://192.168.1.50:9100`. IP targets are streamed straight to the printer's
raw port (`9100`/JetDirect) — no CUPS queue or driver needed on the agent PC.
This is ideal for the Zebra/FedEx thermal printer (it takes raw ZPL). The DPD
and invoice printers work this way too **if** they support direct PDF printing
(most modern network printers do). If a printer rejects raw PDF, set it up as a
named CUPS queue instead and use its queue name here.

## Setup

1. Install [Node.js 18+](https://nodejs.org) on the warehouse PC.
2. Copy this `print-agent/` folder onto that PC.
3. From the folder, run:
   ```
   npm install      # only needed to enable invoice (HTML) printing — pulls Puppeteer/Chromium
   npm start
   ```
   You should see: `[print-agent] listening on http://localhost:17777`.
4. In the app: **Settings → Printers**, set the **Agent URL** (e.g.
   `http://localhost:17777`, or `http://<pc-lan-ip>:17777` from other devices),
   click **Load printers**, and pick the invoice / FedEx / DPD printers.

To keep it always running, install it as a service (Windows: `nssm`, or Task
Scheduler "at logon"; macOS/Linux: a `launchd`/`systemd` unit or `pm2`).

## Endpoints

| Method | Path        | Body / result |
| ------ | ----------- | ------------- |
| GET    | `/health`   | `{ ok, platform }` |
| GET    | `/printers` | `{ printers: string[] }` |
| POST   | `/print`    | `{ printer, copies?, jobName?, pdfBase64? \| html? }` → `{ ok }` |

## Platform notes

- **macOS / Linux**: uses CUPS (`lpstat`, `lp`) — works out of the box.
- **Windows**: printer listing uses PowerShell. Silent PDF printing needs
  [SumatraPDF](https://www.sumatrapdfreader.org/) — install it and set
  `SUMATRA_PATH` to its `.exe` if it isn't on `PATH`.

## Config (env vars)

- `PRINT_AGENT_PORT` — listen port (default `17777`).
- `PRINT_AGENT_TOKEN` — optional shared secret; if set, requests must send
  `Authorization: Bearer <token>` (also set the same token in Settings → Printers).
- `SUMATRA_PATH` — Windows only, path to `SumatraPDF.exe`.
- `PRINT_AGENT_LABEL_MEDIA` — media size for **label** jobs (PDF/HTML), e.g.
  `Custom.4x6in` or `w288h432` (points). Set this to your label printer's paper
  so a 4×6 label doesn't print in the top-left corner of an A4 sheet. Invoices
  are unaffected; ZPL labels ignore it (size is in the ZPL). Empty = no change.
  Alternatively, set the queue default once: `lpadmin -p <printer> -o media-default=Custom.4x6in`.

Invoice printing (HTML jobs) requires `npm install` (Puppeteer). Label printing
(PDF/ZPL jobs) works without it. FedEx thermal labels are raw ZPL — printed
directly (`lp -o raw`); make sure the label queue is a **raw** queue for a Zebra
printer, or the ZPL will be rasterised.

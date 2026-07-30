#!/usr/bin/env node
// Self-hosted print agent. Runs on a warehouse PC connected to the printers and
// lets the web app print silently to a named printer.
//
//   GET  /health            → { ok, platform }
//   GET  /printers          → { printers: string[] }
//   POST /print             → { printer, copies?, jobName?, pdfBase64? | html? | zplBase64? }
//
// Label PDFs are printed directly; invoice HTML is rendered to PDF via Puppeteer
// (only required for HTML jobs — run `npm install` here to enable it). ZPL
// (zplBase64) is sent to the printer RAW — no rendering or conversion — which is
// what FedEx thermal-label certification requires.
//
// Config via env: PRINT_AGENT_PORT (default 17777), PRINT_AGENT_TOKEN (optional
// shared secret), SUMATRA_PATH (Windows silent-print helper).

const http = require('http');
const { execFile } = require('child_process');
const { writeFileSync, mkdtempSync } = require('fs');
const { tmpdir } = require('os');
const path = require('path');

const PORT = process.env.PRINT_AGENT_PORT || 17777;
const TOKEN = process.env.PRINT_AGENT_TOKEN || '';
const isWin = process.platform === 'win32';

// Media size for LABEL (PDF/HTML) jobs, e.g. "Custom.4x6in" or "w288h432".
// Without it, a small label sent to a queue whose default is A4 prints in the
// top-left corner of an A4 sheet. Set this to your label printer's media so the
// label maps 1:1. Invoices are unaffected. ZPL labels ignore it (size is in the
// ZPL). Empty by default = no change.
const LABEL_MEDIA = (process.env.PRINT_AGENT_LABEL_MEDIA || '').trim();

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}
function json(res, code, body) {
  cors(res);
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function listPrinters() {
  return new Promise((resolve) => {
    if (isWin) {
      execFile('powershell', ['-NoProfile', '-Command', 'Get-Printer | Select-Object -ExpandProperty Name'], (err, out) => {
        resolve(err ? [] : out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean));
      });
    } else {
      execFile('lpstat', ['-p'], (err, out) => {
        if (err) return resolve([]);
        resolve([...out.matchAll(/^printer\s+(\S+)/gm)].map((m) => m[1]));
      });
    }
  });
}

async function htmlToPdf(html) {
  let puppeteer;
  try {
    puppeteer = require('puppeteer');
  } catch {
    throw new Error('puppeteer not installed — run `npm install` in print-agent/ to enable invoice (HTML) printing');
  }
  // --disable-dev-shm-usage: containers default to a tiny /dev/shm, which crashes
  // Chromium on larger invoices; this makes it use /tmp instead.
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    return await page.pdf({ format: 'A4', printBackground: true, margin: { top: '10mm', bottom: '10mm', left: '8mm', right: '8mm' } });
  } finally {
    await browser.close();
  }
}

function spool(file, printer, copies, media) {
  return new Promise((resolve, reject) => {
    if (isWin) {
      // Silent Windows printing needs a helper; SumatraPDF is the usual choice.
      // -print-settings "fit" scales the doc to the printer's selected paper so a
      // label isn't stranded in the corner of a larger sheet.
      const sumatra = process.env.SUMATRA_PATH || 'SumatraPDF.exe';
      const args = ['-print-to', printer, '-silent'];
      if (media) args.push('-print-settings', 'fit');
      args.push(file);
      execFile(sumatra, args, (err) =>
        err ? reject(new Error(`Windows printing requires SumatraPDF (set SUMATRA_PATH): ${err.message}`)) : resolve()
      );
    } else {
      // -o media forces the label paper size (else CUPS uses the queue default,
      // often A4); -o fit-to-page maps the doc onto it 1:1.
      const args = ['-d', printer, '-n', String(copies || 1)];
      if (media) args.push('-o', `media=${media}`, '-o', 'fit-to-page');
      args.push(file);
      execFile('lp', args, (err, _o, stderr) =>
        err ? reject(new Error(stderr || err.message)) : resolve()
      );
    }
  });
}

// Send a file to the printer RAW (no driver rendering) — used for ZPL so the
// thermal printer receives the exact ZPL buffer FedEx generated. On CUPS this is
// `lp -o raw`; on Windows raw spooling is copied straight to the printer share.
function spoolRaw(file, printer, copies) {
  return new Promise((resolve, reject) => {
    if (isWin) {
      // COPY /B sends the bytes untouched to a shared printer (\\host\ShareName).
      const share = printer.startsWith('\\\\') ? printer : `\\\\${process.env.COMPUTERNAME || 'localhost'}\\${printer}`;
      const n = Math.max(1, copies || 1);
      const cmd = Array.from({ length: n }, () => `COPY /B "${file}" "${share}"`).join(' & ');
      execFile('cmd', ['/c', cmd], (err, _o, stderr) =>
        err ? reject(new Error(`Windows raw printing failed (printer must be shared as "${printer}"): ${stderr || err.message}`)) : resolve()
      );
    } else {
      execFile('lp', ['-d', printer, '-o', 'raw', '-n', String(copies || 1), file], (err, _o, stderr) =>
        err ? reject(new Error(stderr || err.message)) : resolve()
      );
    }
  });
}

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') { cors(res); res.writeHead(204); return res.end(); }
  if (TOKEN && req.headers['authorization'] !== `Bearer ${TOKEN}`) return json(res, 401, { error: 'unauthorized' });

  const url = new URL(req.url, 'http://localhost');
  if (req.method === 'GET' && url.pathname === '/health') return json(res, 200, { ok: true, platform: process.platform });
  if (req.method === 'GET' && url.pathname === '/printers') { listPrinters().then((printers) => json(res, 200, { printers })); return; }

  if (req.method === 'POST' && url.pathname === '/print') {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 50 * 1024 * 1024) req.destroy(); });
    req.on('end', async () => {
      try {
        const { printer, html, pdfBase64, zplBase64, copies, jobName, isLabel } = JSON.parse(body || '{}');
        if (!printer) return json(res, 400, { error: 'printer required' });
        const safeName = String(jobName || 'job').replace(/[^a-z0-9]+/gi, '_');
        const dir = mkdtempSync(path.join(tmpdir(), 'printjob-'));

        // Raw ZPL — write the exact bytes and send them to the printer untouched.
        if (zplBase64) {
          const file = path.join(dir, `${safeName}.zpl`);
          writeFileSync(file, Buffer.from(zplBase64, 'base64'));
          await spoolRaw(file, printer, copies);
          return json(res, 200, { ok: true });
        }

        let pdf;
        if (html) pdf = await htmlToPdf(html);
        else if (pdfBase64) pdf = Buffer.from(pdfBase64, 'base64');
        else return json(res, 400, { error: 'html, pdfBase64 or zplBase64 required' });

        const file = path.join(dir, `${safeName}.pdf`);
        writeFileSync(file, pdf);
        // Force the label media only for label jobs — invoices keep the queue default (A4).
        await spool(file, printer, copies, isLabel ? LABEL_MEDIA : '');
        json(res, 200, { ok: true });
      } catch (e) {
        console.error('[print-agent] print error:', e.message || e);
        json(res, 500, { error: String(e.message || e) });
      }
    });
    return;
  }

  json(res, 404, { error: 'not found' });
});

server.listen(PORT, () => console.log(`[print-agent] listening on http://localhost:${PORT} (platform ${process.platform})`));

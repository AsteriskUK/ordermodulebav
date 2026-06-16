import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  const { printString, salesRecordNumber } = await req.json() as { printString: string; salesRecordNumber?: string };

  if (!printString) {
    return NextResponse.json({ error: 'printString required' }, { status: 400 });
  }

  // DPD printString is rendered by their official JS renderer (dpdprint.js / dpd-print.js)
  // We embed it in an HTML page that loads DPD's renderer from their CDN
  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>DPD Label${salesRecordNumber ? ` — ${salesRecordNumber}` : ''}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: #fff; display: flex; justify-content: center; }
  </style>
</head>
<body>
  <div id="label-container"></div>
  <script src="https://www.dpd.co.uk/js/dpd-print.js"></script>
  <script>
    try {
      var printString = ${JSON.stringify(printString)};
      var labels = typeof dpdPrint !== 'undefined'
        ? dpdPrint(printString)
        : null;
      if (labels) {
        document.getElementById('label-container').innerHTML = labels;
        window.print();
      } else {
        document.body.innerHTML = '<pre style="padding:20px;font-size:11px;word-break:break-all;">' + printString + '</pre>';
      }
    } catch(e) {
      document.body.innerHTML = '<pre style="padding:20px;font-size:11px;word-break:break-all;color:red">Render error: ' + e.message + '\n\n' + ${JSON.stringify(printString)} + '</pre>';
    }
  </script>
</body>
</html>`;

  return new NextResponse(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

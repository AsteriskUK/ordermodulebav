import { NextRequest, NextResponse } from 'next/server';
import nodemailer from 'nodemailer';

/**
 * POST /api/send-eod
 * Body: { csvText: string, date: string, recipientEmail: string,
 *         smtpHost: string, smtpPort: number, smtpUser: string,
 *         smtpPass: string, fromAddress: string }
 *
 * To enable email sending:
 * 1. Install nodemailer:  npm install nodemailer @types/nodemailer
 * 2. Uncomment the nodemailer block below
 * 3. Set your SMTP credentials via the EOD Report settings panel (stored in the app)
 *    or override via environment variables:
 *      SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
 */

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      csvText: string;
      date: string;
      recipientEmail: string;
      smtpHost?: string;
      smtpPort?: number;
      smtpUser?: string;
      smtpPass?: string;
      fromAddress?: string;
    };

    const { csvText, date, recipientEmail } = body;

    if (!csvText || !date || !recipientEmail) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // ── SMTP sending (now enabled) ───────────────────────────────────────
    
    const transporter = nodemailer.createTransport({
      host:   body.smtpHost  || process.env.SMTP_HOST,
      port:   body.smtpPort  || Number(process.env.SMTP_PORT) || 587,
      secure: false,
      auth: {
        user: body.smtpUser  || process.env.SMTP_USER,
        pass: body.smtpPass  || process.env.SMTP_PASS,
      },
    });

    await transporter.sendMail({
      from:    body.fromAddress || process.env.SMTP_FROM || 'orders@yourcompany.com',
      to:      recipientEmail,
      subject: `EOD Report — ${date}`,
      text:    `Please find attached the end-of-day report for ${date}.`,
      attachments: [{
        filename: `eod_report_${date}.csv`,
        content:  csvText,
      }],
    });
    
    await transporter.sendMail({
      from:    body.fromAddress || process.env.SMTP_FROM || 'orders@yourcompany.com',
      to:      recipientEmail,
      subject: `EOD Report — ${date}`,
      text:    `Please find attached the end-of-day report for ${date}.`,
      attachments: [{
        filename: `eod_report_${date}.csv`,
        content:  csvText,
      }],
    });

    return NextResponse.json({
      ok: true,
      message: `EOD report for ${date} sent successfully to ${recipientEmail}`,
    });

  } catch (err) {
    console.error('[EOD Email] Error:', err);
    return NextResponse.json({ error: 'Failed to send email' }, { status: 500 });
  }
}

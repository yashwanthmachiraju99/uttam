const { Storage } = require('@google-cloud/storage');
const nodemailer = require('nodemailer');

// env vars (set these at deploy time)
const {
  API_KEY,
  GCS_BUCKET,
  LINK_TTL_HOURS = '24',

  SMTP_HOST = 'smtpout.secureserver.net',
  SMTP_PORT = '465',                 // 465 (SSL) or 587 (TLS)
  SMTP_USER,                         // your full GoDaddy email address
  SMTP_PASS,                         // mailbox password
  FROM_EMAIL,                        // same as SMTP_USER (usually)
  FROM_NAME = 'Your Company'
} = process.env;

const storage = new Storage();

exports.sendBrochure = async (req, res) => {
  try {
    if (req.method !== 'POST') {
      return res.status(405).send('Method Not Allowed');
    }
    if (!req.headers['x-api-key'] || req.headers['x-api-key'] !== API_KEY) {
      return res.status(401).send('Unauthorized');
    }

    const {
      to,                // recipient email
      name = '',         // recipient name (optional)
      brochureName,      // display name (for subject/body)
      brochureKey,       // GCS object key, e.g. "brochures/1.pdf"
      brochureFilename,  // filename to force on download (e.g. "1.pdf")
      ttlHours           // optional override, else env default
    } = req.body || {};

    if (!to || !brochureKey) {
      return res.status(400).json({ ok: false, error: 'Missing to or brochureKey' });
    }

    // 1) Signed URL (v4)
    const expiresMs = (parseInt(ttlHours || LINK_TTL_HOURS, 10)) * 60 * 60 * 1000;
    const [signedUrl] = await storage
      .bucket(GCS_BUCKET)
      .file(brochureKey)
      .getSignedUrl({
        version: 'v4',
        action: 'read',
        expires: Date.now() + expiresMs,
        responseDisposition: brochureFilename
          ? `attachment; filename="${brochureFilename}"`
          : undefined
      });

    // 2) HTML email
    const subject = `Your ${brochureName || 'brochure'} download (expires in ${ttlHours || LINK_TTL_HOURS} hours)`;
    const html = buildEmailHtml({
      headline: 'Thank you!',
      intro1: "Thanks for your interest in our latest brochure! We're excited for you to dive in.",
      intro2: "Your download link is now available. Click the button below to access your brochure",
      buttonText: 'Download',
      url: signedUrl,
      hours: ttlHours || LINK_TTL_HOURS,
      contactEmail: FROM_EMAIL || SMTP_USER
    });

    // 3) Send via GoDaddy SMTP
    const transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: Number(SMTP_PORT),
      secure: SMTP_PORT === '465',     // SSL for 465, STARTTLS for 587
      auth: { user: SMTP_USER, pass: SMTP_PASS }
    });

    await transporter.sendMail({
      from: `"${FROM_NAME}" <${FROM_EMAIL || SMTP_USER}>`,
      to,
      subject,
      html
    });

    return res.json({ ok: true, url: signedUrl });
  } catch (err) {
    console.error('sendBrochure error:', err);
    return res.status(500).json({ ok: false, error: err.message || 'Internal error' });
  }
};

function buildEmailHtml({ headline, intro1, intro2, buttonText, url, hours, contactEmail }) {
  const BTN_BG = '#c95f2d';
  const BORDER = '#111111';
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f6f7f9;">
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#f6f7f9;">
    <tr><td align="center" style="padding:20px;">
      <table role="presentation" cellpadding="0" cellspacing="0" width="600" style="max-width:600px;width:100%;background:#ffffff;border:4px solid ${BORDER};">
        <tr><td align="center" style="padding:40px 30px 10px 30px;">
          <h1 style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:36px;line-height:42px;color:#000;">${headline}</h1>
        </td></tr>
        <tr><td style="padding:20px 40px;border-top:1px solid #e9ecef;border-bottom:1px solid #e9ecef;">
          <p style="margin:0 0 10px 0;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:24px;color:#222;">${intro1}</p>
          <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:24px;color:#222;">${intro2}</p>
        </td></tr>
        <tr><td align="center" style="padding:30px 40px;">
          <a href="${url}" target="_blank"
             style="display:inline-block;padding:14px 28px;background:${BTN_BG};color:#fff;text-decoration:none;border-radius:4px;font-family:Arial,Helvetica,sans-serif;font-size:16px;">
             ${buttonText}
          </a>
        </td></tr>
        <tr><td align="center" style="padding:10px 40px 30px 40px;">
          <p style="margin:0 0 16px 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:22px;color:#444;">
            Please note that this link is active for ${hours} hours only for security reasons. Make sure to download your brochure within this timeframe.
          </p>
          <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:22px;color:#444;">
            If you have any questions or need further assistance, don't hesitate to reply to ${contactEmail} or visit our website.
          </p>
        </td></tr>
      </table>
      <div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#888;padding:12px;">
        © ${new Date().getFullYear()} ${process.env.FROM_NAME || 'Your Company'}
      </div>
    </td></tr>
  </table>
</body></html>`;
}

export interface WorkflowNotificationEmail {
  actionUrl: string;
  appUrl: string;
  body: string;
  documentReference: string | null;
  recipientName: string | null;
  subject: string;
  title: string;
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function renderWorkflowNotificationEmail(email: WorkflowNotificationEmail) {
  const recipientName = email.recipientName?.trim() || 'there';
  const documentReference = email.documentReference?.trim() || null;
  const appUrl = new URL(email.appUrl);
  const actionUrl = new URL(email.actionUrl, appUrl);
  if (actionUrl.origin !== appUrl.origin) {
    throw new Error('Workflow notification links must stay on the application origin.');
  }
  const actionHref = actionUrl.toString();
  const subject = email.subject.trim();
  const title = email.title.trim();
  const body = email.body.trim();
  const safeUrl = escapeHtml(actionHref);
  const safeBody = escapeHtml(body).replaceAll('\n', '<br />');

  const text = [
    `Hello ${recipientName},`,
    '',
    title,
    body,
    documentReference ? `Document reference: ${documentReference}` : '',
    '',
    `Open Docuflow: ${actionHref}`,
    '',
    'You received this message because of activity on your Docuflow account.',
  ].filter(Boolean).join('\n');

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(subject)}</title>
  </head>
  <body style="margin:0;background:#f5f1eb;color:#332f2b;font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f5f1eb;padding:32px 12px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#ffffff;border:1px solid #e8e0d7;border-radius:12px;overflow:hidden;">
          <tr><td style="background:#8c503d;padding:22px 28px;color:#ffffff;font-size:22px;font-weight:700;">docuflow<span style="color:#f2d5c7;">.</span></td></tr>
          <tr><td style="padding:30px 28px 12px;">
            <p style="margin:0 0 16px;font-size:16px;">Hello ${escapeHtml(recipientName)},</p>
            <h1 style="margin:0 0 16px;font-size:22px;line-height:1.35;color:#332f2b;">${escapeHtml(title)}</h1>
            ${documentReference ? `<p style="margin:0 0 16px;color:#756b63;font-size:14px;"><strong>Document reference:</strong> ${escapeHtml(documentReference)}</p>` : ''}
            <p style="margin:0;color:#514a44;font-size:15px;line-height:1.6;">${safeBody}</p>
            <p style="margin:26px 0 22px;">
              <a href="${safeUrl}" style="display:inline-block;background:#8c503d;border-radius:7px;color:#ffffff;padding:12px 20px;text-decoration:none;font-size:14px;font-weight:700;">Open document</a>
            </p>
            <p style="margin:0;color:#756b63;font-size:13px;line-height:1.5;">Sign in to Docuflow to review the latest details and take any required action.</p>
          </td></tr>
          <tr><td style="border-top:1px solid #eee8e2;padding:18px 28px;color:#8a8179;font-size:12px;line-height:1.5;">Docuflow · Daet document tracking<br />You received this email because of activity on your Docuflow account.</td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;

  return { html, text };
}

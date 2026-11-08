import assert from 'node:assert/strict';
import test from 'node:test';
import { renderWorkflowNotificationEmail } from '../lib/email/templates.ts';

test('notification emails escape untrusted content in HTML and include a text version', () => {
  const email = renderWorkflowNotificationEmail({
    actionUrl: '/workflow/user/file_registry/submission-id',
    appUrl: 'https://docuflow.example',
    body: '<script>alert("x")</script>\nPlease review.',
    documentReference: 'DOC-1 & DOC-2',
    recipientName: 'A <User>',
    subject: 'Document update',
    title: 'Document updated',
  });

  assert.match(email.html, /&lt;script&gt;/);
  assert.doesNotMatch(email.html, /<script>/);
  assert.match(email.html, /A &lt;User&gt;/);
  assert.match(email.html, /DOC-1 &amp; DOC-2/);
  assert.match(email.text, /https:\/\/docuflow\.example\/workflow\/user\/file_registry\/submission-id/);
});

test('notification email action links cannot leave the application origin', () => {
  assert.throws(
    () => renderWorkflowNotificationEmail({
      actionUrl: 'https://attacker.example/',
      appUrl: 'https://docuflow.example',
      body: 'Review the document.',
      documentReference: null,
      recipientName: null,
      subject: 'Document update',
      title: 'Document updated',
    }),
    /must stay on the application origin/
  );
});

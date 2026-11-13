import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const feed = await readFile(
  new URL('../components/WorkflowNotificationFeed.tsx', import.meta.url),
  'utf8',
);
const controls = await readFile(
  new URL('../components/WorkflowNotificationControls.tsx', import.meta.url),
  'utf8',
);
const adminPage = await readFile(
  new URL('../app/(dashboard)/workflow/admin/notifications/page.tsx', import.meta.url),
  'utf8',
);
const userPage = await readFile(
  new URL('../app/(dashboard)/workflow/user/notifications/page.tsx', import.meta.url),
  'utf8',
);
const officePage = await readFile(
  new URL('../components/OfficeNotificationsPage.tsx', import.meta.url),
  'utf8',
);
const adminArchivePage = await readFile(
  new URL('../app/(dashboard)/workflow/admin/notifications/archive/page.tsx', import.meta.url),
  'utf8',
);
const archive = await readFile(
  new URL('../components/WorkflowNotificationArchive.tsx', import.meta.url),
  'utf8',
);

test('notification feed uses the archive icon as the archive link and a labeled Clear action', () => {
  assert.match(feed, /archiveIconOnly \? archiveLabel : undefined/);
  assert.match(feed, /archiveIconOnly \? \(/);
  assert.match(feed, /\{busy \? 'Updating…' : actionLabel\}/);
  assert.doesNotMatch(feed, /iconOnlyAction/);
  for (const page of [userPage, officePage]) {
    assert.match(page, /archiveIconOnly/);
    assert.match(page, /actionLabel="Clear"/);
  }
});

test('system-admin notifications link to a personal notification archive and archive clears', () => {
  assert.match(controls, /href=\{archiveHref\}/);
  assert.match(controls, /View notification archive/);
  assert.match(adminPage, /archiveHref="\/workflow\/admin\/notifications\/archive"/);
  assert.match(adminPage, /archive_all_workflow_notifications/);
  assert.match(adminPage, /workflow_notification_archives/);
  assert.match(adminArchivePage, /WorkflowNotificationArchive role="system_admin"/);
  assert.match(archive, /'submitter' \| 'system_admin' \| OfficeRole/);
  assert.match(archive, /role === 'system_admin'[\s\S]*?\$\{basePath\}\/submissions/);
  assert.match(archive, /router\.push\(`\$\{detailPath\}\/\$\{notification\.id\}\$\{adminOfficeQuery\}`\)/);
});

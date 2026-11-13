import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migrationUrl = new URL(
  '../supabase/migrations/20261113021000_admin_delete_workflow_submission.sql',
  import.meta.url,
);
const deleteButtonUrl = new URL(
  '../components/AdminDeleteSubmissionButton.tsx',
  import.meta.url,
);
const adminListUrl = new URL(
  '../app/(dashboard)/workflow/admin/submissions/page.tsx',
  import.meta.url,
);
const adminDetailUrl = new URL(
  '../app/(dashboard)/workflow/admin/submissions/[id]/page.tsx',
  import.meta.url,
);

test('submission deletion is restricted to admins and returns linked storage paths', async () => {
  const migration = await readFile(migrationUrl, 'utf8');

  assert.match(migration, /auth\.uid\(\) is null or not public\.is_workflow_admin\(\)/);
  assert.match(migration, /delete from public\.workflow_submissions/);
  assert.match(migration, /delete from public\.workflow_audit_logs/);
  assert.match(migration, /delete from public\.workflow_notifications/);
  assert.match(migration, /delete from public\.workflow_email_outbox/);
  assert.match(migration, /'workflow_uploads', to_jsonb\(upload_paths\)/);
  assert.match(migration, /'workflow_message_attachments', to_jsonb\(message_paths\)/);
  assert.match(migration, /grant execute on function public\.admin_delete_workflow_submission\(uuid\)\s*to authenticated/);
  assert.match(migration, /revoke all on function public\.admin_delete_workflow_submission\(uuid\)\s*from public, anon/);
});

test('storage cleanup policies allow administrators to delete linked workflow files', async () => {
  const migration = await readFile(migrationUrl, 'utf8');

  assert.match(migration, /bucket_id = 'workflow_uploads'\s+and public\.is_workflow_admin\(\)/);
  assert.match(migration, /bucket_id = 'workflow_message_attachments'\s+and public\.is_workflow_admin\(\)/);
});

test('admin deletion requires an irreversible-action confirmation and is available from list and detail', async () => {
  const [button, list, detail] = await Promise.all([
    readFile(deleteButtonUrl, 'utf8'),
    readFile(adminListUrl, 'utf8'),
    readFile(adminDetailUrl, 'utf8'),
  ]);

  assert.match(button, /window\.confirm/);
  assert.match(button, /This cannot be undone/);
  assert.match(button, /admin_delete_workflow_submission/);
  assert.match(button, /uploaded files could not be removed/);
  assert.match(list, /<AdminDeleteSubmissionButton/);
  assert.match(detail, /Permanently delete submission/);
  assert.match(detail, /<AdminDeleteSubmissionButton/);
});

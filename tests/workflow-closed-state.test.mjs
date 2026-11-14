import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migration = await readFile(
  new URL('../supabase/migrations/20261114120000_enforce_changes_requested_closure.sql', import.meta.url),
  'utf8',
);
const officeDetail = await readFile(
  new URL('../components/OfficeSubmissionDetail.tsx', import.meta.url),
  'utf8',
);
const userDetail = await readFile(
  new URL('../app/(dashboard)/workflow/user/file_registry/[id]/page.tsx', import.meta.url),
  'utf8',
);
const status = await readFile(new URL('../lib/workflow/status.ts', import.meta.url), 'utf8');

test('change requests atomically close the submission against its current revision', () => {
  assert.match(migration, /request_workflow_submission_changes\([\s\S]*expected_revision_id uuid/);
  assert.match(migration, /submission\.status <> 'in_process'/);
  assert.match(migration, /submission\.reopen_count <> 0/);
  assert.match(migration, /expected_revision_id is distinct from submission\.current_revision_id/);
  assert.match(migration, /closure_reason = 'changes_requested'/);
  assert.match(migration, /insert into public\.workflow_change_requests/);
  assert.match(migration, /returning id into audit_event_id/);
});

test('offices cannot complete, withdraw assignments, or use the legacy response path while closed', () => {
  assert.match(migration, /submission\.status <> 'in_process'[\s\S]*Only the responsible office can complete a submission in process/);
  assert.match(migration, /This submission cannot withdraw an assignment in its current status/);
  assert.match(migration, /drop function if exists public\.respond_to_workflow_submission_changes/);
});

test('message writes are blocked for offices while preserving submitter clarification messages', () => {
  assert.match(migration, /can_write_workflow_message_conversation/);
  assert.match(migration, /submission\.status not in \('changes_requested', 'returned_for_requirements'\)/);
  assert.match(migration, /submission\.user_id = auth\.uid\(\)[\s\S]*target_routing_step_id is null/);
  assert.match(migration, /create policy "Participants can send document messages"[\s\S]*can_write_workflow_message_conversation/);
  assert.match(migration, /create policy "Message senders can add attachments"[\s\S]*can_write_workflow_message_conversation/);
  assert.match(migration, /create policy "Participants can mark messages as read"[\s\S]*can_write_workflow_message_conversation/);
  assert.match(migration, /can_upload_workflow_message_file\(object_name text\)/);
});

test('the interface shows closed-state request context and removes legacy response controls', () => {
  assert.match(officeDetail, /Closed — Changes Requested/);
  assert.match(officeDetail, /isClosed: composerClosed/);
  assert.match(userDetail, /Requested by \{requestAuthor\}/);
  assert.match(userDetail, /You may clarify through the conversation above without changing this status/);
  assert.doesNotMatch(userDetail, /respond_to_workflow_submission_changes/);
  assert.match(status, /changes_requested: 'Closed — Changes Requested'/);
});

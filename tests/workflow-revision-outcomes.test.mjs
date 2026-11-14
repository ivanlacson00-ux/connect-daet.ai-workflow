import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migration = await readFile(
  new URL('../supabase/migrations/20261115120000_submitter_change_request_outcomes.sql', import.meta.url),
  'utf8',
);
const submitterPage = await readFile(
  new URL('../app/(dashboard)/workflow/user/file_registry/[id]/page.tsx', import.meta.url),
  'utf8',
);
const officePage = await readFile(
  new URL('../components/OfficeSubmissionDetail.tsx', import.meta.url),
  'utf8',
);

test('revision submission locks and validates the open request and expected revision', () => {
  assert.match(migration, /submit_workflow_submission_revision\([\s\S]*expected_change_request_id uuid/);
  assert.match(migration, /where id = target_submission_id[\s\S]*for update/);
  assert.match(migration, /expected_revision_id is distinct from submission\.current_revision_id/);
  assert.match(migration, /request\.against_revision_id = submission\.current_revision_id/);
  assert.match(migration, /request\.status = 'open'/);
  assert.match(migration, /submission\.reopen_count <> 0/);
});

test('revision RPC enforces file ownership, storage existence, file changes, and primary invariant', () => {
  assert.match(migration, /manifest_item\.storage_path not like \(auth\.uid\(\)::text \|\| '\\/%'\)/);
  assert.match(migration, /from storage\.objects object[\s\S]*object\.bucket_id = 'workflow_uploads'/);
  assert.match(migration, /changed_file_count < 1/);
  assert.match(migration, /current_primary_count <> 1/);
  assert.match(migration, /previous_file_count <> cardinality\(seen_previous_file_ids\)/);
  assert.match(migration, /revision_file\.change_kind <> 'removed'/);
});

test('revision transition preserves routing, updates the current file mirror, and fulfills the request atomically', () => {
  assert.match(migration, /status = 'in_process'[\s\S]*current_revision_id = revision_id/);
  assert.match(migration, /reopen_count = 1/);
  assert.match(migration, /closure_reason = null[\s\S]*closed_at = null/);
  assert.match(migration, /set status = 'fulfilled'[\s\S]*fulfilled_by_revision_id = revision_id/);
  assert.match(migration, /'SUBMISSION_REOPENED'/);
  assert.doesNotMatch(migration, /delete from public\.workflow_submission_revisions/i);
  assert.doesNotMatch(migration, /delete from public\.workflow_revision_files/i);
});

test('permanent closure abandons the request and remains distinct from approval or rejection', () => {
  assert.match(migration, /close_workflow_submission_permanently\([\s\S]*expected_change_request_id uuid/);
  assert.match(migration, /status = 'closed_by_submitter'/);
  assert.match(migration, /closure_reason = 'closed_by_submitter'/);
  assert.match(migration, /set status = 'abandoned'/);
  assert.match(migration, /'SUBMISSION_PERMANENTLY_CLOSED'/);
});

test('submitter editor exposes Keep, Replace, Remove, additions, and one-time outcomes', () => {
  assert.match(submitterPage, /value="keep">Keep/);
  assert.match(submitterPage, /value="replace">Replace/);
  assert.match(submitterPage, /value="remove"/);
  assert.match(submitterPage, /Add supporting files/);
  assert.match(submitterPage, /submit_workflow_submission_revision/);
  assert.match(submitterPage, /close_workflow_submission_permanently/);
  assert.match(submitterPage, /cleanupError/);
});

test('office details read current files from revisions and mark the resubmitted revision', () => {
  assert.match(officePage, /getCurrentWorkflowRevisionFiles\(parsedHistory\)/);
  assert.match(officePage, /Resubmitted revision/);
  assert.match(officePage, /closed_by_submitter/);
});

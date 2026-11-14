import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  getCurrentWorkflowRevisionFiles,
  parseWorkflowRevisionHistory,
} from '../lib/workflow/revisions.ts';

const migration = await readFile(
  new URL('../supabase/migrations/20261114090000_add_workflow_submission_revision_history.sql', import.meta.url),
  'utf8',
);
const timeline = await readFile(
  new URL('../components/WorkflowRevisionTimeline.tsx', import.meta.url),
  'utf8',
);
const revisions = await readFile(
  new URL('../lib/workflow/revisions.ts', import.meta.url),
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

test('revision history schema is additive and scoped by existing submission access', () => {
  assert.match(migration, /create table if not exists public\.workflow_submission_revisions/);
  assert.match(migration, /create table if not exists public\.workflow_revision_files/);
  assert.match(migration, /create table if not exists public\.workflow_change_requests/);
  assert.match(migration, /workflow_revision_files_one_primary_per_revision_idx/);
  assert.match(migration, /where status = 'open'/);
  assert.match(migration, /public\.is_active_workflow_account\(\)/);
  assert.match(migration, /public\.is_workflow_admin\(\)/);
  assert.match(migration, /public\.is_submission_assigned_to_current_office\(submission\.id\)/);
  assert.match(migration, /change_request_repair_needed/);
  assert.match(migration, /backfill_quality,[\s\S]*?'partial'/);
});

test('detail RPC validates active authorized access and returns revision history without signed URLs', () => {
  assert.match(migration, /create or replace function public\.get_workflow_submission_detail/);
  assert.match(migration, /if not public\.is_active_workflow_account\(\) then/);
  assert.match(migration, /Submission not found or not available to this account/);
  assert.match(migration, /'revisions', coalesce/);
  assert.match(migration, /'change_requests', coalesce/);
  assert.match(migration, /'audit_events', coalesce/);
  assert.match(migration, /revision_file\.storage_path/);
  assert.doesNotMatch(migration, /'signed_url'\s*,/i);
});

test('both detail views load and display the shared revision timeline', () => {
  for (const page of [submitterPage, officePage]) {
    assert.match(page, /get_workflow_submission_detail/);
    assert.match(page, /<WorkflowRevisionTimeline/);
    assert.match(page, /parseWorkflowRevisionHistory/);
  }
});

test('revision timeline uses authorized signed previews/downloads and displays entries oldest to newest', () => {
  assert.match(timeline, /createSignedUrl\(file\.storagePath, 60\)/);
  assert.match(timeline, /<FilePreview/);
  assert.match(timeline, /onPreview={handlePreview}/);
  assert.match(timeline, /Revision \{entry\.revision\.revisionNo\}/);
  assert.match(timeline, /Changes requested by/);
  assert.match(timeline, /a\.createdAt\.localeCompare\(b\.createdAt\)/);
  assert.match(timeline, /role="alert"/);
  assert.match(revisions, /parseWorkflowRevisionHistory/);
  assert.match(revisions, /backfill_quality/);
});

test('revision history parser validates the RPC response shape', () => {
  const parsed = parseWorkflowRevisionHistory({
    submission: { change_request_repair_needed: false },
    revisions: [{
      id: 'revision-id',
      revision_no: 1,
      created_at: '2026-11-14T00:00:00Z',
      submitter_message: null,
      form_snapshot: null,
      backfill_quality: 'partial',
      files: [{
        id: 'file-id',
        logical_file_id: 'logical-id',
        file_role: 'primary',
        file_name: 'application.pdf',
        storage_path: 'user-id/application.pdf',
        file_type: 'application/pdf',
        file_size: 100,
        change_kind: 'added',
        created_at: '2026-11-14T00:00:00Z',
      }],
    }],
    change_requests: [],
    audit_events: [],
  });

  assert.equal(parsed.revisions[0]?.files[0]?.changeKind, 'added');
  assert.throws(() => parseWorkflowRevisionHistory({ revisions: [], change_requests: null, audit_events: [] }));
});

test('current supporting files come from the newest manifest and exclude removal tombstones', () => {
  const parsed = parseWorkflowRevisionHistory({
    submission: { change_request_repair_needed: false },
    revisions: [
      {
        id: 'revision-1',
        revision_no: 1,
        created_at: '2026-11-14T00:00:00Z',
        submitter_message: null,
        form_snapshot: null,
        backfill_quality: 'partial',
        files: [
          {
            id: 'primary-1',
            logical_file_id: 'primary',
            file_role: 'primary',
            file_name: 'application.pdf',
            storage_path: 'user-id/application.pdf',
            file_type: 'application/pdf',
            file_size: 100,
            change_kind: 'added',
            created_at: '2026-11-14T00:00:00Z',
          },
          {
            id: 'attachment-1',
            logical_file_id: 'attachment',
            file_role: 'supporting',
            file_name: 'support.pdf',
            storage_path: 'user-id/support.pdf',
            file_type: 'application/pdf',
            file_size: 100,
            change_kind: 'added',
            created_at: '2026-11-14T00:00:00Z',
          },
        ],
      },
      {
        id: 'revision-2',
        revision_no: 2,
        created_at: '2026-11-15T00:00:00Z',
        submitter_message: null,
        form_snapshot: null,
        backfill_quality: 'complete',
        files: [
          {
            id: 'primary-2',
            logical_file_id: 'primary',
            file_role: 'primary',
            file_name: 'application-v2.pdf',
            storage_path: 'user-id/application-v2.pdf',
            file_type: 'application/pdf',
            file_size: 120,
            change_kind: 'replaced',
            created_at: '2026-11-15T00:00:00Z',
          },
          {
            id: 'attachment-2',
            logical_file_id: 'attachment',
            file_role: 'supporting',
            file_name: 'support.pdf',
            storage_path: 'user-id/support.pdf',
            file_type: 'application/pdf',
            file_size: 100,
            change_kind: 'removed',
            created_at: '2026-11-15T00:00:00Z',
          },
        ],
      },
    ],
    change_requests: [],
    audit_events: [],
  });

  assert.deepEqual(
    getCurrentWorkflowRevisionFiles(parsed).map((file) => file.id),
    ['primary-2'],
  );
});

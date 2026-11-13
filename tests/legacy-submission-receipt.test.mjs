import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migrationUrl = new URL(
  '../supabase/migrations/20261112173807_receive_legacy_office_submissions.sql',
  import.meta.url,
);
const detailPageUrl = new URL(
  '../components/OfficeSubmissionDetail.tsx',
  import.meta.url,
);

test('responsible office can explicitly receive legacy pending_office submissions', async () => {
  const migration = await readFile(migrationUrl, 'utf8');

  assert.match(migration, /submission\.selected_office_role is distinct from actor_role/);
  assert.match(migration, /submission\.status not in \('submitted', 'pending_office'\)/);
  assert.match(migration, /set status = 'in_process'/);
  assert.match(
    migration,
    /target_submission_id, 'SUBMISSION_RECEIVED', submission\.status, 'in_process'/,
  );
  assert.match(migration, /grant execute on function public\.receive_workflow_submission\(uuid\) to authenticated/);
});

test('detail page offers Start processing for the responsible office on legacy statuses', async () => {
  const detailPage = await readFile(detailPageUrl, 'utf8');

  assert.match(detailPage, /isResponsibleOffice && \['submitted', 'pending_office'\]\.includes\(sub\.status\)/);
  assert.match(detailPage, /onStartReview: requiresReviewStart \? startOfficeReview : undefined/);
});

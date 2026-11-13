import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const component = await readFile(
  new URL('../components/OfficeSubmissionDetail.tsx', import.meta.url),
  'utf8',
);
const migration = await readFile(
  new URL('../supabase/migrations/20261113021500_require_office_assignment_receipt.sql', import.meta.url),
  'utf8',
);

test('forwarded office assignments wait for explicit receipt before actions are available', () => {
  assert.match(component, /isRecipientOffice && activeRouteStep\?\.status === 'pending'/);
  assert.match(component, /onStartReview: requiresReviewStart \? startOfficeReview : undefined/);
  assert.match(component, /showWorkflowActions: isResponsibleOffice \|\| isRecipientOffice/);
  assert.match(migration, /new\.assignment_source = 'office_forward'/);
  assert.match(migration, /new\.status := 'pending'/);
  assert.match(migration, /new\.started_at := null/);
  assert.match(migration, /execute function public\.workflow_require_receipt_for_forwarded_assignment\(\)/);
  assert.match(migration, /set status = 'pending',\s+started_at = null/);
});

test('office detail no longer renders a separate other-offices panel', () => {
  assert.doesNotMatch(component, />Other offices</);
  assert.doesNotMatch(component, />Office assignments</);
});

test('office workspace replaces shared files with responsibility and current handling status', async () => {
  const messaging = await readFile(
    new URL('../components/DocumentMessaging.tsx', import.meta.url),
    'utf8',
  );

  assert.match(messaging, /workflowComposer\?\.isOfficeWorkspace && workflowComposer\.workflowStatus/);
  assert.match(component, /<h3 id=\{`workflow-status-\$\{sub\.id\}`\}[^>]*>Workflow status<\/h3>/);
  assert.match(component, /Responsible office/);
  assert.match(component, /Currently handling/);
  assert.match(component, /step\.status === 'pending' \? 'Awaiting start' : 'Under review'/);
  assert.match(component, /Retains responsibility for the submission and its final decision/);
  assert.match(component, /The responsible office is waiting for these assignments to be completed/);
  assert.match(component, /const officeHistory = routeSteps/);
  assert.match(component, /Office actions and decisions/);
  assert.match(component, /officeHistory\.map\(\(entry\) =>/);
  assert.match(component, /Final decision: Approved/);
  assert.match(component, /Final decision: Rejected/);
  assert.match(component, /routeSteps\s*\.filter\(\(step\) => step\.status !== 'skipped'\)/);
  assert.match(component, /workflowStatus,/);
});

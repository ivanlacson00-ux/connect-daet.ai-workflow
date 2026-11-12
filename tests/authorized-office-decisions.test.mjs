import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migrationUrl = new URL(
  '../supabase/migrations/20261113020500_office_decisions_for_assignments.sql',
  import.meta.url,
);
const detailPageUrl = new URL(
  '../components/OfficeSubmissionDetail.tsx',
  import.meta.url,
);
const messagingUrl = new URL(
  '../components/DocumentMessaging.tsx',
  import.meta.url,
);
const tourismDecisionMigrationUrl = new URL(
  '../supabase/migrations/20261113042700_allow_tourism_office_responsible_decisions.sql',
  import.meta.url,
);

test('only the responsible office can finalize, and outstanding assignments must be resolved first', async () => {
  const migration = await readFile(migrationUrl, 'utf8');

  assert.match(migration, /submission\.status <> 'in_process'/);
  assert.match(migration, /submission\.selected_office_role is distinct from actor_role/);
  assert.match(migration, /coalesce\(submission\.final_decision_office_role,\s*submission\.initial_destination_role\)\s*is distinct from actor_role/);
  assert.match(migration, /public\.workflow_mvp_has_pending_assignment\(target_submission_id\)/);
  assert.doesNotMatch(migration, /workflow_final_decision_authorities/);
  assert.match(migration, /decide_workflow_submission_as_responsible_office/);
});

test('decision RPC validates rejection reasons and records final approval or rejection', async () => {
  const migration = await readFile(migrationUrl, 'utf8');

  assert.match(migration, /final_decision is null or final_decision not in \('approve', 'reject'\)/);
  assert.match(migration, /final_decision = 'reject' and normalized_comments is null/);
  assert.match(migration, /final_decision_by = auth\.uid\(\)/);
  assert.match(migration, /case final_decision\s+when 'approve' then 'approved'[\s\S]*'declined_by_office'/);
  assert.match(migration, /'SUBMISSION_APPROVED'[\s\S]*'SUBMISSION_REJECTED'/);
  assert.match(migration, /grant execute on function public\.decide_workflow_submission_as_responsible_office\(uuid, text, text\)\s*to authenticated/);
  assert.match(migration, /revoke all on function public\.decide_workflow_submission_as_responsible_office\(uuid, text, text\)\s*from public, anon/);
});

test('responsible decision RPC accepts every supported office role, including Tourism Office', async () => {
  const migration = await readFile(tourismDecisionMigrationUrl, 'utf8');

  assert.match(migration, /'tourism_officer', 'municipal_treasurer', 'mayor_office', 'sangguniang_bayan'/);
  assert.match(migration, /submission\.selected_office_role is distinct from actor_role/);
  assert.match(migration, /coalesce\(submission\.final_decision_office_role, submission\.initial_destination_role\)\s+is distinct from actor_role/);
  assert.match(migration, /public\.workflow_mvp_has_pending_assignment\(target_submission_id\)/);
  assert.match(migration, /when 'approve' then 'approved'/);
});

test('responsible and forwarded offices can select approve/reject while Complete stays role-specific', async () => {
  const detailPage = await readFile(detailPageUrl, 'utf8');

  const responsibleActions = detailPage.match(
    /const responsibleOfficeActions = \[([\s\S]*?)\n  \];/,
  )?.[1];
  assert.ok(responsibleActions);
  for (const action of ['approve', 'reject']) {
    const actionBlock = responsibleActions.match(
      new RegExp(`value: '${action}',([\\s\\S]*?)(?=\\n    \\},|$)`),
    )?.[1];
    assert.ok(actionBlock, `responsible-office ${action} action exists`);
    assert.match(actionBlock, /unavailableReason:[\s\S]*pendingAssignmentReason/);
    assert.match(actionBlock, /routeStateError/);
  }

  assert.equal((detailPage.match(/value: 'approve',/g) ?? []).length, 2);
  assert.equal((detailPage.match(/value: 'reject',/g) ?? []).length, 2);
  assert.match(detailPage, /decide_workflow_submission_as_responsible_office/);
  assert.match(detailPage, /assignment_outcome: action === 'approve' \? 'endorsed' : 'not_endorsed'/);
  assert.match(detailPage, /if \(\(action === 'approve' \|\| action === 'reject'\) && isRecipientOffice\)/);
  assert.match(detailPage, /value: 'close_submission'/);
  assert.match(detailPage, /value: 'complete_assignment'/);
  assert.doesNotMatch(detailPage, /finalDecisionUnavailableReason/);
  assert.match(detailPage, /label: 'Request changes or information'/);
  assert.match(detailPage, /label: 'Complete'/);
  assert.match(detailPage, /label: 'Forward'/);
});

test('Forward recipient appears beside Action and the main choices are ordered first', async () => {
  const messaging = await readFile(messagingUrl, 'utf8');
  const actionDropdownStart = messaging.indexOf('const actionDropdown =');
  const actionSelectionStart = messaging.indexOf('const actionSelectionFields =', actionDropdownStart);
  const actionDropdown = messaging.slice(actionDropdownStart, actionSelectionStart);

  assert.notEqual(actionDropdownStart, -1);
  assert.match(actionDropdown, /currentAction\.value === 'forward'/);
  assert.match(actionDropdown, /htmlFor=\{`recipient-\$\{submissionId\}`\}/);
  assert.doesNotMatch(
    messaging.slice(actionSelectionStart, messaging.indexOf('const conversation =', actionSelectionStart)),
    /currentAction\.value === 'forward'/,
  );
  assert.ok(messaging.indexOf("'close_submission'") < messaging.indexOf("'approve'"));
  assert.ok(messaging.indexOf("'approve'") < messaging.indexOf("'request_changes'"));
  assert.ok(messaging.indexOf("'request_changes'") < messaging.indexOf("'forward'"));
});

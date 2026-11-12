import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const detail = await readFile(
  new URL('../components/OfficeSubmissionDetail.tsx', import.meta.url),
  'utf8',
);
const messaging = await readFile(
  new URL('../components/DocumentMessaging.tsx', import.meta.url),
  'utf8',
);

const actionBlock = (value) => {
  const responsibleActions = detail.match(/const responsibleOfficeActions = \[([\s\S]*?)\n {2}\];/)?.[1] ?? '';
  return responsibleActions.match(new RegExp(`value: '${value}',([\\s\\S]*?)(?=\\n {4}\\},|$)`))?.[1] ?? '';
};

test('approve and reject follow the decision RPC rules: In Process and the decision office only', () => {
  assert.match(detail, /const decisionOfficeRole = sub\.final_decision_office_role \?\? initialDestinationRole;/);
  assert.match(detail, /decisionStatusReason = sub\.status !== 'in_process'/);
  for (const value of ['approve', 'reject']) {
    const block = actionBlock(value);
    assert.ok(block, `${value} action exists`);
    assert.match(block, /pendingAssignmentReason \|\| decisionStatusReason \|\| decisionAuthorityReason/);
  }
});

test('the action box is not pre-filled with old office comments', () => {
  assert.doesNotMatch(detail, /initialMessage: processingNote/);
  assert.doesNotMatch(detail, /const processingNote =/);
});

test('the action list opens on the first available action', () => {
  assert.match(detail, /initialAction = \(actionsByRecipient\[initialRecipient\] \?\? \[\]\)\.find\(\(action\) => !action\.unavailableReason\)/);
});

test('returned submissions close the office composer and submitter conversation', () => {
  assert.match(detail, /const isReturned = sub\.status === 'returned';/);
  assert.match(detail, /const composerClosed = isCompleted \|\| isRejected \|\| isWithdrawn \|\| isReturned \|\| historicalRecipientView;/);
  assert.match(detail, /!isWithdrawn && !isReturned && isResponsibleOffice/);
  assert.match(detail, /This submission was returned to the submitter for redirection\./);
});

test('a plain Complete is not shown as an approval decision', () => {
  assert.match(detail, /const isApprovalDecision = sub\.status === 'approved';/);
  assert.match(detail, /: 'Submission completed',/);
});

test('back navigation returns to the office file list', () => {
  assert.match(detail, /router\.push\(getOfficeFileManagementPath\(role\)\)/);
});

test('workflow actions report a specific success message', () => {
  assert.match(messaging, /successMessage\?: string;/);
  assert.match(messaging, /setNotice\(action\.successMessage \?\? `\$\{action\.label\} completed\.`\)/);
  const successMessages = detail.match(/successMessage: /g) ?? [];
  assert.ok(successMessages.length >= 9, `expected success messages on every action, found ${successMessages.length}`);
});

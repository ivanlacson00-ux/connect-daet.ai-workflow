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
const migration = await readFile(
  new URL('../supabase/migrations/20261113030500_simplify_forwarded_office_actions.sql', import.meta.url),
  'utf8',
);

test('forwarded offices complete and forward without extra decision or outcome-note fields', () => {
  assert.match(detail, /assignment_outcome: null/);
  assert.doesNotMatch(detail, /Select a decision|Decision before forwarding|Your office’s note for the responsible office/);
  assert.doesNotMatch(detail, /outcomeField|forwardResponseNote/);
  assert.match(messaging, /Your message and attached files go to \$\{recipientLabel\}\./);
  assert.doesNotMatch(messaging, /Your outcome note goes to the responsible office/);
});

test('assignment RPCs allow completion and onward forwarding without inventing an outcome', () => {
  assert.match(migration, /assignment_outcome is not null and outcome_label is null/);
  assert.match(migration, /assignment_outcome is not null\s+and assignment_outcome <> 'endorsed'/);
  assert.match(migration, /when outcome_label is null then .*completed the assignment/s);
  assert.match(migration, /forwarder_outcome is not null and own_outcome_label is null/);
  assert.match(migration, /when own_outcome_label is null then[\s\S]*forwarded the assignment onward to/);
});

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migrationUrl = new URL(
  '../supabase/migrations/20261112130000_award_points_on_responsible_completion.sql',
  import.meta.url,
);
const assignmentMigrationUrl = new URL(
  '../supabase/migrations/20261111051526_mvp_direct_office_workflow.sql',
  import.meta.url,
);

test('reward ledger stores one fixed 10-point award per submission and is submitter-readable only', async () => {
  const migration = await readFile(migrationUrl, 'utf8');

  assert.match(migration, /submission_id uuid primary key/);
  assert.match(migration, /points integer not null default 10 check \(points = 10\)/);
  assert.match(migration, /revoke all on public\.workflow_submission_reward_ledger from anon, authenticated/);
  assert.match(migration, /grant select on public\.workflow_submission_reward_ledger to authenticated/);
  assert.match(migration, /using \(user_id = auth\.uid\(\)\)/);
});

test('only the responsible office completion path awards points, not forwarded assignment completion', async () => {
  const [migration, assignmentMigration] = await Promise.all([
    readFile(migrationUrl, 'utf8'),
    readFile(assignmentMigrationUrl, 'utf8'),
  ]);
  const closeFunctionStart = migration.indexOf(
    'create or replace function public.workflow_mvp_close_submission_internal(',
  );
  const closeFunctionEnd = migration.indexOf('$function$;', closeFunctionStart);
  assert.notEqual(closeFunctionStart, -1);
  assert.notEqual(closeFunctionEnd, -1);
  const closeFunction = migration.slice(closeFunctionStart, closeFunctionEnd);
  const responsibleOfficeCheck = closeFunction.indexOf(
    'submission.selected_office_role is distinct from actor_role',
  );
  const rewardInsert = closeFunction.indexOf(
    'insert into public.workflow_submission_reward_ledger',
  );

  assert.ok(responsibleOfficeCheck >= 0);
  assert.ok(rewardInsert > responsibleOfficeCheck);
  assert.match(closeFunction, /where submission\.selected_office_role = actor_role/);
  assert.match(closeFunction, /on conflict \(submission_id\) do nothing/);

  const assignmentFunctionStart = assignmentMigration.indexOf(
    'create or replace function public.complete_workflow_assignment(',
  );
  const assignmentFunctionEnd = assignmentMigration.indexOf(
    'create or replace function public.return_workflow_assignment(',
    assignmentFunctionStart,
  );
  assert.notEqual(assignmentFunctionStart, -1);
  assert.notEqual(assignmentFunctionEnd, -1);
  assert.doesNotMatch(
    assignmentMigration.slice(assignmentFunctionStart, assignmentFunctionEnd),
    /workflow_submission_reward_ledger/,
  );
});

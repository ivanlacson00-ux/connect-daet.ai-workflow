import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const page = await readFile(
  new URL('../app/(dashboard)/workflow/user/file_registry/[id]/page.tsx', import.meta.url),
  'utf8',
);
const panel = await readFile(
  new URL('../components/WorkflowStatusPanel.tsx', import.meta.url),
  'utf8',
);

test('submitter detail loads all route history and renders workflow status', () => {
  assert.match(page, /from\('workflow_routing_plans'\)/);
  assert.match(page, /from\('workflow_routing_steps'\)/);
  assert.match(page, /\.in\('routing_plan_id', routePlanIds\)/);
  assert.match(page, /<WorkflowStatusPanel/);
  assert.match(panel, /Responsible office/);
  assert.match(panel, /Currently handling/);
  assert.match(panel, /Office actions and decisions/);
  assert.match(panel, /Final decision: Approved/);
  assert.match(panel, /Final decision: Rejected/);
  assert.ok(page.indexOf('id={`document-preview-${sub.id}`}') < page.indexOf('<WorkflowStatusPanel'));
  assert.ok(page.indexOf('<WorkflowStatusPanel') < page.indexOf('<DocumentMessaging'));
});

test('submitter-visible route history does not expose internal office comments', () => {
  assert.doesNotMatch(
    page.match(/\.from\('workflow_routing_steps'\)[\s\S]*?\.order\('sequence_number', \{ ascending: true \}\)/)?.[0] ?? '',
    /comments|requirements_comments/,
  );
  assert.doesNotMatch(panel, /step\.comments|entry\.comments/);
});

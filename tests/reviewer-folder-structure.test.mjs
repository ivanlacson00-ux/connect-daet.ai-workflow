import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../app/(dashboard)/workflow/reviewer/', import.meta.url);
const workflow = await readFile(
  new URL('../lib/workflow/offices.ts', import.meta.url),
  'utf8',
);
const proxy = await readFile(new URL('../proxy.ts', import.meta.url), 'utf8');
const workspace = await readFile(
  new URL('../components/ReviewerWorkspace.tsx', import.meta.url),
  'utf8',
);
const notifications = await readFile(
  new URL('../components/OfficeNotificationsPage.tsx', import.meta.url),
  'utf8',
);

test('all office pages now share the reviewer route tree', async () => {
  const routes = [
    'page.tsx',
    'file_management/page.tsx',
    'file_management/[id]/page.tsx',
    'notifications/page.tsx',
    'notifications/archive/page.tsx',
  ];
  await Promise.all(routes.map((route) => access(new URL(route, root))));
  assert.equal((workflow.match(/path: '\/workflow\/reviewer'/g) ?? []).length, 4);
  assert.match(workspace, /isOfficeRole\(currentRole\)/);
  assert.match(workspace, /<OfficeDashboard role=\{role\} view="dashboard" \/>/);
  assert.match(workspace, /<OfficeNotificationsPage role=\{role\} \/>/);
});

test('former office URLs redirect to the shared reviewer routes without changing access ownership', () => {
  assert.match(workflow, /legacyPath: '\/workflow\/tourism-office'/);
  assert.match(workflow, /legacyPath: '\/workflow\/municipal-treasurer'/);
  assert.match(workflow, /legacyPath: '\/workflow\/mayor'/);
  assert.match(workflow, /legacyPath: '\/workflow\/sangguniang-bayan'/);
  assert.match(proxy, /role !== officeRole && role !== 'system_admin'/);
  assert.match(proxy, /new URL\(`\/workflow\/reviewer\$\{legacySuffix\}`/);
  assert.match(proxy, /destination\.search = req\.nextUrl\.search/);
  assert.match(proxy, /destination\.searchParams\.set\('office', officeRole\)/);
  assert.match(proxy, /!isOfficeRole\(role\)\s*&&\s*role !== 'system_admin'/);
});

test('shared notification page receives the authenticated office role, not the route name', () => {
  assert.match(notifications, /ApproverNotificationsPage\(\{ role: officeRole \}: \{ role: OfficeRole \}\)/);
  assert.doesNotMatch(notifications, /usePathname|officePath/);
});

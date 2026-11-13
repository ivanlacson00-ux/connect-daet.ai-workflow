import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { OFFICE_CONFIG } from '../lib/workflow/offices.ts';

const migrationUrl = new URL(
  '../supabase/migrations/20261112150000_seed_tourism_office_document_types.sql',
  import.meta.url,
);

test('Tourism Office offers the configured tourism request types and a custom Other option', () => {
  assert.deepEqual(OFFICE_CONFIG.tourism_officer.categories, [
    'Tourism Event or Activity Coordination',
    'Tourism Promotion and Marketing',
    'Tourist Attraction or Facility Support',
    'Tourism Business or Establishment Inquiry',
    'Tourism Information and Assistance',
    'Other',
  ]);
});

test('Tourism application options are synchronized with the database catalogue', async () => {
  const migration = await readFile(migrationUrl, 'utf8');

  for (const documentType of OFFICE_CONFIG.tourism_officer.categories) {
    assert.ok(
      migration.includes(`'tourism_officer', '${documentType}'`),
      `Migration should seed ${documentType}`,
    );
  }
  assert.match(migration, /on conflict \(office_role, document_type\) do nothing/);
  assert.match(migration, /delete from public\.workflow_office_document_types/);
  assert.match(migration, /document_type not in/);
});

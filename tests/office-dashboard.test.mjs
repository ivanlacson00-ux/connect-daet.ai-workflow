import assert from 'node:assert/strict';
import test from 'node:test';
import { matchesOfficeDashboardFilter } from '../lib/workflow/office-dashboard.ts';

const officeRoles = [
  'tourism_officer',
  'municipal_treasurer',
  'mayor_office',
  'sangguniang_bayan',
];

test('direct submissions in pending_office appear in every office dashboard needs-action queue', () => {
  for (const role of officeRoles) {
    assert.equal(matchesOfficeDashboardFilter({
      status: 'pending_office',
      selected_office_role: role,
      officeRecord: null,
    }, 'needs_action', role), true, `${role} should see directly routed submissions`);
  }
});

test('pending office assignments remain visible even when the submission is pending_office', () => {
  assert.equal(matchesOfficeDashboardFilter({
    status: 'pending_office',
    selected_office_role: 'sangguniang_bayan',
    officeRecord: { status: 'pending' },
  }, 'needs_action', 'municipal_treasurer'), true);
});

test('a responsible office waiting on another office is not in needs-action', () => {
  const waiting = {
    status: 'in_process',
    selected_office_role: 'tourism_officer',
    officeRecord: null,
    consultedRecord: { status: 'in_progress' },
  };
  assert.equal(matchesOfficeDashboardFilter(waiting, 'needs_action', 'tourism_officer'), false);
  assert.equal(matchesOfficeDashboardFilter(waiting, 'waiting_on_office', 'tourism_officer'), true);
});

test('a responsible office returns to needs-action once the other office responds', () => {
  const responded = {
    status: 'in_process',
    selected_office_role: 'tourism_officer',
    officeRecord: null,
    consultedRecord: { status: 'completed' },
  };
  assert.equal(matchesOfficeDashboardFilter(responded, 'needs_action', 'tourism_officer'), true);
  assert.equal(matchesOfficeDashboardFilter(responded, 'waiting_on_office', 'tourism_officer'), false);
});

test('unrelated offices do not see a direct submission in needs-action', () => {
  assert.equal(matchesOfficeDashboardFilter({
    status: 'pending_office',
    selected_office_role: 'sangguniang_bayan',
    officeRecord: null,
  }, 'needs_action', 'municipal_treasurer'), false);
});

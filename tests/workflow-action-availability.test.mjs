import assert from 'node:assert/strict';
import test from 'node:test';
import { getAvailableActions } from '../lib/workflow/action-availability.ts';

test('Changes Requested is clarification-only for submitters and read-only for offices and admins', () => {
  for (const status of ['changes_requested', 'returned_for_requirements']) {
    assert.deepEqual(getAvailableActions({ status }, [], 'submitter'), ['clarify']);
    assert.deepEqual(getAvailableActions({ status }, [], 'responsible_office'), []);
    assert.deepEqual(getAvailableActions({ status }, [{ status: 'in_progress' }], 'assigned_office'), []);
    assert.deepEqual(getAvailableActions({ status }, [], 'system_admin'), []);
  }
});

test('submitter outcomes require a valid open change request and enforce one reopen', () => {
  assert.deepEqual(
    getAvailableActions({
      status: 'changes_requested',
      reopen_count: 0,
      has_open_change_request: true,
    }, [], 'submitter'),
    ['clarify', 'revise_submission', 'close_permanently'],
  );
  assert.deepEqual(
    getAvailableActions({
      status: 'changes_requested',
      reopen_count: 1,
      has_open_change_request: true,
    }, [], 'submitter'),
    ['clarify', 'close_permanently'],
  );
  assert.deepEqual(
    getAvailableActions({
      status: 'changes_requested',
      reopen_count: 0,
      has_open_change_request: true,
      change_request_repair_needed: true,
    }, [], 'submitter'),
    ['clarify'],
  );
});

test('responsible-office actions respect status, pending assignments, and reopen history', () => {
  assert.deepEqual(
    getAvailableActions({ status: 'submitted' }, [], 'responsible_office'),
    ['receive'],
  );

  const inProcessActions = getAvailableActions({ status: 'in_process', reopen_count: 0 }, [], 'responsible_office');
  assert.ok(inProcessActions.includes('request_changes'));
  assert.ok(inProcessActions.includes('complete_submission'));

  const reopenedActions = getAvailableActions({ status: 'in_process', reopen_count: 1 }, [], 'responsible_office');
  assert.ok(!reopenedActions.includes('request_changes'));

  const assignedActions = getAvailableActions(
    { status: 'in_process', reopen_count: 0 },
    [{ status: 'pending' }],
    'responsible_office',
  );
  assert.ok(!assignedActions.includes('request_changes'));
  assert.ok(!assignedActions.includes('complete_submission'));
});

test('submitter actions do not reopen Changes Requested or alter unrelated terminal states', () => {
  assert.deepEqual(getAvailableActions({ status: 'returned' }, [], 'submitter'), ['redirect']);
  assert.deepEqual(getAvailableActions({ status: 'completed' }, [], 'submitter'), []);
  assert.deepEqual(getAvailableActions({ status: 'submitted' }, [], 'submitter'), ['withdraw_submission']);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getWorkflowInitialDestinationRole,
  TOURISM_OFFICE_ROLE,
} from '../lib/workflow/offices.ts';

test('municipal destinations stay direct workflow roles', () => {
  assert.equal(getWorkflowInitialDestinationRole('municipal_treasurer'), 'municipal_treasurer');
  assert.equal(getWorkflowInitialDestinationRole('sangguniang_bayan'), 'sangguniang_bayan');
  assert.equal(getWorkflowInitialDestinationRole('mayor_office'), 'mayor_office');
});

test('Tourism Office destination maps to the database Tourism Office role', () => {
  assert.equal(getWorkflowInitialDestinationRole(TOURISM_OFFICE_ROLE), TOURISM_OFFICE_ROLE);
});

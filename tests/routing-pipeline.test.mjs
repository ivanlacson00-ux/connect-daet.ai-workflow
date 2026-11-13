import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRoutingPipeline, buildRoutingPipelineSteps } from '../lib/workflow/routing-pipeline.ts';

const pipeline = (overrides = {}) => buildRoutingPipeline({
  submissionStatus: 'submitted',
  submittedAt: '2026-01-01T10:00:00Z',
  selectedOfficeRole: 'tourism_officer',
  initialDestinationRole: 'tourism_officer',
  routeSteps: [],
  auditEvents: [],
  ...overrides,
});

const received = { action_type: 'SUBMISSION_RECEIVED', created_at: '2026-01-02T09:00:00Z' };
const assignment = (overrides = {}) => ({
  sequence_number: 1,
  office_role: 'municipal_treasurer',
  status: 'in_progress',
  assignment_source: 'office_forward',
  assigned_by_role: 'tourism_officer',
  assigned_at: '2026-01-02T10:00:00Z',
  started_at: '2026-01-02T11:00:00Z',
  ...overrides,
});

test('a new submission waits for the responsible office to start', () => {
  const { steps, whereabouts, whereaboutsState } = pipeline();

  assert.deepEqual(steps.map((step) => step.title), ['Submitted', 'Awaiting receipt']);
  assert.equal(steps[0].subtitle, 'To Daet Tourism Office');
  assert.equal(steps[1].state, 'active');
  assert.equal(whereabouts, 'Waiting for Daet Tourism Office to start processing');
  assert.equal(whereaboutsState, 'active');
});

test('once received, the submission is shown under review at the responsible office', () => {
  const { steps, whereabouts } = pipeline({ submissionStatus: 'in_process', auditEvents: [received] });

  assert.deepEqual(steps.map((step) => step.title), ['Submitted', 'Received', 'Daet Tourism Office']);
  assert.equal(steps[1].timestamp, received.created_at);
  assert.equal(steps[2].state, 'active');
  assert.equal(steps[2].detail, 'Reviewing');
  assert.equal(whereabouts, 'Under review at Daet Tourism Office');
});

test('an assignment the other office has not started still shows where the document is', () => {
  const { steps, whereabouts } = pipeline({
    submissionStatus: 'in_process',
    auditEvents: [received],
    routeSteps: [assignment({ status: 'pending', started_at: null })],
  });

  const treasurer = steps.find((step) => step.title === "Municipal Treasurer's Office");
  assert.ok(treasurer, 'unstarted assignment is shown');
  assert.equal(treasurer.state, 'active');
  assert.equal(treasurer.subtitle, 'Asked by Daet Tourism Office');
  assert.equal(whereabouts, "Sent to Municipal Treasurer's Office — waiting for them to start");
});

test('an assignment under review is the current location', () => {
  const { whereabouts } = pipeline({
    submissionStatus: 'in_process',
    auditEvents: [received],
    routeSteps: [assignment()],
  });

  assert.equal(whereabouts, "Under review at Municipal Treasurer's Office");
});

test('after an office responds, its action is shown and the document is back with the responsible office', () => {
  const { steps, whereabouts } = pipeline({
    submissionStatus: 'in_process',
    auditEvents: [received],
    routeSteps: [assignment({ status: 'completed', outcome: 'not_endorsed', completed_at: '2026-01-03T10:00:00Z' })],
  });

  const treasurer = steps.find((step) => step.title === "Municipal Treasurer's Office");
  assert.equal(treasurer.detail, 'Rejected');
  assert.equal(treasurer.state, 'rejected');
  assert.equal(steps.at(-1).title, 'Daet Tourism Office');
  assert.equal(steps.at(-1).detail, 'Deciding the next step');
  assert.equal(whereabouts, 'Back with Daet Tourism Office to decide the next step');
});

test('every office asked is shown in order, then the final approval (DAET-2026-000090)', () => {
  const { steps, whereabouts, whereaboutsState } = pipeline({
    submissionStatus: 'approved',
    auditEvents: [
      received,
      { action_type: 'SUBMISSION_APPROVED', created_at: '2026-01-06T10:00:00Z' },
    ],
    routeSteps: [
      // Later plan listed first, as the database may return it.
      assignment({
        office_role: 'mayor_office',
        status: 'completed',
        outcome: 'endorsed',
        assigned_at: '2026-01-04T10:00:00Z',
        completed_at: '2026-01-05T10:00:00Z',
      }),
      assignment({ status: 'completed', outcome: 'endorsed', completed_at: '2026-01-03T10:00:00Z' }),
    ],
  });

  assert.deepEqual(steps.map((step) => step.title), [
    'Submitted',
    'Received',
    "Municipal Treasurer's Office",
    "Mayor's Office",
    'Approved',
  ]);
  assert.deepEqual(steps.slice(2, 4).map((step) => step.detail), ['Approved', 'Approved']);
  assert.equal(steps.at(-1).timestamp, '2026-01-06T10:00:00Z');
  assert.equal(whereabouts, 'Approved by Daet Tourism Office');
  assert.equal(whereaboutsState, 'complete');
});

test('a plain Complete is shown as Completed, not Approved', () => {
  const { steps, whereabouts } = pipeline({
    submissionStatus: 'completed',
    auditEvents: [received, { action_type: 'SUBMISSION_CLOSED', created_at: '2026-01-03T10:00:00Z' }],
  });

  assert.equal(steps.at(-1).title, 'Completed');
  assert.equal(steps.at(-1).timestamp, '2026-01-03T10:00:00Z');
  assert.equal(whereabouts, 'Completed by Daet Tourism Office');
});

test('a final rejection uses the rejection event time', () => {
  const { steps, whereaboutsState } = pipeline({
    submissionStatus: 'declined_by_office',
    auditEvents: [received, { action_type: 'SUBMISSION_REJECTED', created_at: '2026-01-03T10:00:00Z' }],
  });

  assert.equal(steps.at(-1).title, 'Rejected');
  assert.equal(steps.at(-1).state, 'rejected');
  assert.equal(steps.at(-1).timestamp, '2026-01-03T10:00:00Z');
  assert.equal(whereaboutsState, 'rejected');
});

test('changes requested waits on the submitter, and a response completes the step', () => {
  const waiting = pipeline({
    submissionStatus: 'changes_requested',
    auditEvents: [received, { action_type: 'CHANGES_REQUESTED', created_at: '2026-01-03T10:00:00Z' }],
  });
  assert.equal(waiting.steps.at(-1).title, 'Changes requested');
  assert.equal(waiting.steps.at(-1).state, 'attention');
  assert.equal(waiting.whereabouts, 'With the submitter to make changes');

  const responded = pipeline({
    submissionStatus: 'in_process',
    auditEvents: [
      received,
      { action_type: 'CHANGES_REQUESTED', created_at: '2026-01-03T10:00:00Z' },
      { action_type: 'CHANGES_RESPONDED', created_at: '2026-01-04T10:00:00Z' },
    ],
  });
  const changes = responded.steps.find((step) => step.title === 'Changes requested');
  assert.equal(changes.state, 'complete');
  assert.equal(changes.detail, 'Submitter responded');
  assert.equal(responded.whereabouts, 'Under review at Daet Tourism Office');
});

test('a submission returned for redirection is with the submitter', () => {
  const { steps, whereabouts } = pipeline({
    submissionStatus: 'returned',
    auditEvents: [received, { action_type: 'RETURNED_TO_SUBMITTER', created_at: '2026-01-03T10:00:00Z' }],
  });

  assert.equal(steps.at(-1).title, 'Returned for redirection');
  assert.equal(steps.at(-1).state, 'attention');
  assert.equal(whereabouts, 'With the submitter to choose another office');
});

test('returned and withdrawn assignments are labelled, not shown as in progress', () => {
  const { steps } = pipeline({
    submissionStatus: 'in_process',
    auditEvents: [received],
    routeSteps: [
      assignment({ status: 'returned', decided_at: '2026-01-03T10:00:00Z' }),
      assignment({ office_role: 'mayor_office', status: 'withdrawn', assigned_at: '2026-01-04T10:00:00Z', decided_at: '2026-01-04T12:00:00Z' }),
    ],
  });

  assert.equal(steps[2].detail, 'Returned without a response');
  assert.equal(steps[2].state, 'attention');
  assert.equal(steps[3].detail, 'Withdrawn');
  assert.equal(steps[3].state, 'skipped');
});

test('a redirected submission follows the office it was redirected to', () => {
  const { steps } = pipeline({
    submissionStatus: 'submitted',
    selectedOfficeRole: 'mayor_office',
    initialDestinationRole: 'tourism_officer',
  });

  assert.equal(steps[0].subtitle, "To Mayor's Office");
  assert.equal(steps[1].subtitle, "Mayor's Office");
});

test('a submission withdrawn before receipt stops after Submitted', () => {
  const { steps, whereabouts } = pipeline({
    submissionStatus: 'withdrawn',
    auditEvents: [{ action_type: 'SUBMISSION_WITHDRAWN', created_at: '2026-01-01T12:00:00Z' }],
  });

  assert.deepEqual(steps.map((step) => step.title), ['Submitted', 'Withdrawn']);
  assert.equal(whereabouts, 'Withdrawn by the submitter');
});

test('buildRoutingPipelineSteps returns the same steps', () => {
  const input = {
    submissionStatus: 'in_process',
    submittedAt: '2026-01-01T10:00:00Z',
    selectedOfficeRole: 'tourism_officer',
    routeSteps: [],
    auditEvents: [received],
  };
  assert.deepEqual(buildRoutingPipelineSteps(input), buildRoutingPipeline(input).steps);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRoutingPipelineSteps } from '../lib/workflow/routing-pipeline.ts';

const makePipeline = (overrides = {}) => buildRoutingPipelineSteps({
  submissionStatus: 'pending_office',
  submittedAt: '2026-01-01T10:00:00Z',
  selectedOfficeRole: 'sangguniang_bayan',
  routeSteps: [],
  auditEvents: [],
  ...overrides,
});

test('shows submission and destination receipt while awaiting office receipt', () => {
  const steps = makePipeline();

  assert.deepEqual(steps.map((step) => step.title), [
    'Request submitted',
    'Received by destination office',
    'Next workflow update',
  ]);
  assert.equal(steps[1].state, 'active');
  assert.equal(steps[2].isPlaceholder, true);
});

test('marks destination receipt without inventing a later route step', () => {
  const steps = makePipeline({
    submissionStatus: 'in_process',
    auditEvents: [{
      action_type: 'SUBMISSION_RECEIVED',
      created_at: '2026-01-02T10:00:00Z',
    }],
  });

  assert.equal(steps.length, 3);
  assert.equal(steps[1].state, 'complete');
  assert.equal(steps[1].timestamp, '2026-01-02T10:00:00Z');
  assert.equal(steps[2].isPlaceholder, true);
});

test('shows a completed decision as the next milestone', () => {
  const steps = makePipeline({
    submissionStatus: 'completed',
    finalDecisionOfficeRole: 'sangguniang_bayan',
    auditEvents: [{
      action_type: 'WORKFLOW_COMPLETED',
      created_at: '2026-01-03T10:00:00Z',
    }],
  });

  assert.deepEqual(steps.map((step) => step.title), [
    'Request submitted',
    'Received by destination office',
    'Submission completed',
  ]);
  assert.equal(steps[2].state, 'complete');
  assert.equal(steps.some((step) => step.isPlaceholder), false);
});

test('shows an actual forward but hides future sequential assignments', () => {
  const steps = makePipeline({
    submissionStatus: 'pending_office',
    routeSteps: [
      {
        sequence_number: 1,
        office_role: 'municipal_treasurer',
        status: 'in_progress',
        assignment_source: 'office_forward',
        assigned_by_role: 'sangguniang_bayan',
        started_at: '2026-01-02T10:00:00Z',
      },
      {
        sequence_number: 2,
        office_role: 'mayor_office',
        status: 'pending',
        assignment_source: 'tourism_officer',
        assigned_by_role: 'tourism_officer',
      },
    ],
  });

  assert.equal(steps.length, 4);
  assert.equal(steps[2].title, "Forwarded to Municipal Treasurer's Office");
  assert.equal(steps[2].state, 'active');
  assert.equal(steps[3].isPlaceholder, true);
});

test('shows parallel Tourism Officer assignments that have actually started', () => {
  const steps = makePipeline({
    submissionStatus: 'pending_office',
    selectedOfficeRole: 'tourism_officer',
    auditEvents: [{
      action_type: 'TOURISM_OFFICER_ASSIGNMENTS_CREATED',
      created_at: '2026-01-02T10:00:00Z',
    }],
    routeSteps: [
      {
        sequence_number: 1,
        office_role: 'municipal_treasurer',
        status: 'in_progress',
        assignment_source: 'tourism_officer',
        assigned_by_role: 'tourism_officer',
        started_at: '2026-01-02T10:00:00Z',
      },
      {
        sequence_number: 1,
        office_role: 'mayor_office',
        status: 'in_progress',
        assignment_source: 'tourism_officer',
        assigned_by_role: 'tourism_officer',
        started_at: '2026-01-02T10:00:00Z',
      },
    ],
  });

  assert.deepEqual(
    steps.slice(2, 4).map((step) => step.title).sort(),
    [
      "Assigned to Municipal Treasurer's Office",
      "Assigned to Mayor's Office",
    ].sort(),
  );
  assert.ok(steps.slice(2, 4).every((step) => step.state === 'active'));
  assert.equal(steps[4].isPlaceholder, true);
});

test('shows a Tourism Officer referral made by the initial office', () => {
  const steps = makePipeline({
    submissionStatus: 'pending_approver',
    auditEvents: [{
      action_type: 'OFFICE_FORWARDED_TO_TOURISM_OFFICER',
      created_at: '2026-01-02T10:00:00Z',
    }],
  });

  assert.equal(steps[1].state, 'complete');
  assert.equal(steps[2].title, 'Referred to Tourism Office');
  assert.equal(steps[3].isPlaceholder, true);
});

test('shows changes requested after a routed office has started work', () => {
  const steps = makePipeline({
    submissionStatus: 'returned_for_requirements',
    routeSteps: [{
      sequence_number: 1,
      office_role: 'municipal_treasurer',
      status: 'in_progress',
      assignment_source: 'office_forward',
      assigned_by_role: 'sangguniang_bayan',
      started_at: '2026-01-02T10:00:00Z',
      requirements_requested_at: '2026-01-03T10:00:00Z',
      responsibility: 'evaluation_verification',
    }],
    auditEvents: [{
      action_type: 'ROUTE_REQUIREMENTS_REQUESTED',
      created_at: '2026-01-03T10:00:00Z',
    }],
  });

  const changesRequested = steps.find((step) => step.key === 'changes-requested');
  assert.equal(changesRequested.title, 'Additional requirements requested');
  assert.equal(changesRequested.subtitle, "Municipal Treasurer's Office");
  assert.equal(changesRequested.state, 'active');
  assert.equal(changesRequested.timestamp, '2026-01-03T10:00:00Z');
  assert.equal(steps.at(-1).isPlaceholder, true);
  assert.equal(steps[2].subtitle, 'Evaluation/Verification');
});

test('shows final completion after Tourism Officer-created assignments', () => {
  const steps = makePipeline({
    submissionStatus: 'completed',
    selectedOfficeRole: 'tourism_officer',
    finalDecisionOfficeRole: 'mayor_office',
    routeSteps: [{
      sequence_number: 1,
      office_role: 'mayor_office',
      status: 'completed',
      assignment_source: 'tourism_officer',
      assigned_by_role: 'tourism_officer',
      started_at: '2026-01-02T10:00:00Z',
      completed_at: '2026-01-04T10:00:00Z',
    }],
  });

  const completed = steps.find((step) => step.title === 'Submission completed');
  assert.equal(completed.subtitle, "Mayor's Office");
  assert.equal(completed.state, 'complete');
  assert.equal(steps.some((step) => step.isPlaceholder), false);
});

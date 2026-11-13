import {
  isOfficeRole,
  OFFICE_CONFIG,
  type OfficeRole,
} from './offices.ts';

/**
 * complete  – done
 * active    – where the submission is right now
 * attention – waiting on someone outside the office flow (e.g. the submitter)
 * rejected  – a rejection
 * skipped   – stopped or withdrawn
 * pending   – not reached yet
 */
export type RoutingPipelineState = 'complete' | 'active' | 'attention' | 'pending' | 'rejected' | 'skipped';

export interface RoutingPipelineStep {
  key: string;
  title: string;
  subtitle: string;
  state: RoutingPipelineState;
  detail?: string;
  timestamp?: string | null;
  isPlaceholder?: boolean;
}

export interface RoutingPipelineRouteStep {
  sequence_number: number;
  office_role: string;
  status: string;
  outcome?: string | null;
  responsibility?: string;
  assignment_source?: string;
  assigned_by_role?: string | null;
  assigned_at?: string | null;
  started_at?: string | null;
  decided_at?: string | null;
  completed_at?: string | null;
  requirements_requested_at?: string | null;
}

export interface RoutingPipelineAuditEvent {
  action_type: string;
  created_at: string;
}

interface RoutingPipelineInput {
  submissionStatus: string;
  submittedAt: string;
  routeSteps: RoutingPipelineRouteStep[];
  selectedOfficeRole?: string | null;
  initialDestinationRole?: string | null;
  finalDecisionOfficeRole?: string | null;
  auditEvents: RoutingPipelineAuditEvent[];
}

export interface RoutingPipeline {
  steps: RoutingPipelineStep[];
  /** One line saying where the submission is now, e.g. "Under review at Mayor's Office". */
  whereabouts: string;
  /** Tone of the whereabouts line. */
  whereaboutsState: RoutingPipelineState;
}

const NOT_RECEIVED_STATUSES = ['submitted', 'pending', 'pending_approver', 'pending_office', 'pending_admin'];
const CHANGES_STATUSES = ['changes_requested', 'returned_for_requirements'];
const CHANGE_REQUEST_EVENTS = ['CHANGES_REQUESTED', 'ROUTE_REQUIREMENTS_REQUESTED'];
const CHANGE_RESPONSE_EVENTS = ['CHANGES_RESPONDED', 'REQUIREMENTS_RESUBMITTED', 'REVISED_DOCUMENT_SUBMITTED', 'SUBMISSION_REOPENED'];
const ASSIGNMENT_SOURCES = ['office_forward', 'tourism_officer'];

export const isDeclinedStatus = (status: string) => status.startsWith('declined') || status === 'rejected';

const officeLabel = (role: string | null | undefined) =>
  isOfficeRole(role ?? null) ? OFFICE_CONFIG[role as OfficeRole].label : 'the office';

const timeValue = (value?: string | null) => {
  const time = value ? new Date(value).getTime() : Number.NaN;
  return Number.isNaN(time) ? Number.POSITIVE_INFINITY : time;
};

/** What the office did with an assignment, in plain words. */
function describeAssignment(step: RoutingPipelineRouteStep): { state: RoutingPipelineState; detail: string } {
  const office = officeLabel(step.office_role);
  switch (step.status) {
    case 'pending':
      return { state: 'active', detail: `Waiting for ${office} to start` };
    case 'in_progress':
      return { state: 'active', detail: 'Under review' };
    case 'completed':
    case 'approved':
      if (step.outcome === 'endorsed') return { state: 'complete', detail: 'Approved' };
      if (step.outcome === 'endorsed_with_conditions') return { state: 'complete', detail: 'Approved with conditions' };
      if (step.outcome === 'not_endorsed') return { state: 'rejected', detail: 'Rejected' };
      return { state: 'complete', detail: 'Completed' };
    case 'rejected':
      return { state: 'rejected', detail: 'Rejected' };
    case 'returned':
      return { state: 'attention', detail: 'Returned without a response' };
    case 'withdrawn':
      return { state: 'skipped', detail: 'Withdrawn' };
    default:
      return { state: 'complete', detail: step.status.replaceAll('_', ' ') };
  }
}

/**
 * Builds the route a submission has taken, in the order things happened, ending
 * with where it is now (or its final outcome).
 */
export function buildRoutingPipeline({
  submissionStatus,
  submittedAt,
  routeSteps,
  selectedOfficeRole,
  initialDestinationRole,
  finalDecisionOfficeRole,
  auditEvents,
}: RoutingPipelineInput): RoutingPipeline {
  const status = submissionStatus.toLowerCase();
  const events = [...auditEvents].sort((first, second) => timeValue(first.created_at) - timeValue(second.created_at));
  const lastTimeFor = (...actions: string[]) =>
    [...events].reverse().find((event) => actions.includes(event.action_type))?.created_at ?? null;

  // The office currently responsible: where the submitter sent it (after any redirection).
  const responsibleRoleValue = selectedOfficeRole ?? initialDestinationRole ?? null;
  const responsibleRole = isOfficeRole(responsibleRoleValue) ? responsibleRoleValue : null;
  const responsibleOffice = officeLabel(responsibleRole);

  const assignments = routeSteps
    .filter((step) =>
      isOfficeRole(step.office_role)
      && ASSIGNMENT_SOURCES.includes(step.assignment_source ?? '')
      && step.status !== 'skipped'
    )
    .sort((first, second) =>
      timeValue(first.assigned_at ?? first.started_at ?? first.decided_at ?? first.completed_at)
        - timeValue(second.assigned_at ?? second.started_at ?? second.decided_at ?? second.completed_at)
      || first.sequence_number - second.sequence_number
    );

  const steps: RoutingPipelineStep[] = [{
    key: 'submitted',
    title: 'Submitted',
    subtitle: responsibleRole ? `To ${responsibleOffice}` : 'Submission received',
    state: 'complete',
    detail: 'Submitted',
    timestamp: submittedAt,
  }];

  if (status === 'withdrawn' && !lastTimeFor('SUBMISSION_RECEIVED') && assignments.length === 0) {
    steps.push({
      key: 'withdrawn',
      title: 'Withdrawn',
      subtitle: 'By the submitter',
      state: 'skipped',
      detail: 'Withdrawn',
      timestamp: lastTimeFor('SUBMISSION_WITHDRAWN'),
    });
    return { steps, whereabouts: 'Withdrawn by the submitter', whereaboutsState: 'skipped' };
  }

  if (!responsibleRole) {
    return { steps, whereabouts: 'Waiting for an office to be assigned', whereaboutsState: 'pending' };
  }

  const receivedAt = lastTimeFor('SUBMISSION_RECEIVED');
  const received = Boolean(receivedAt) || !NOT_RECEIVED_STATUSES.includes(status) || assignments.length > 0;
  steps.push({
    key: 'received',
    title: received ? 'Received' : 'Awaiting receipt',
    subtitle: responsibleOffice,
    state: received ? 'complete' : 'active',
    detail: received ? 'Processing started' : `Waiting for ${responsibleOffice} to start`,
    timestamp: receivedAt,
  });
  if (!received) {
    return {
      steps,
      whereabouts: `Waiting for ${responsibleOffice} to start processing`,
      whereaboutsState: 'active',
    };
  }

  // ─── Things that happened after receipt, in order ──────────────────────────
  const timeline: (RoutingPipelineStep & { sortTime: number })[] = [];

  for (const assignment of assignments) {
    const { state, detail } = describeAssignment(assignment);
    const askedBy = isOfficeRole(assignment.assigned_by_role ?? null)
      ? `Asked by ${officeLabel(assignment.assigned_by_role)}`
      : 'Office assignment';
    timeline.push({
      key: `assignment-${assignment.office_role}-${assignment.assigned_at ?? assignment.sequence_number}`,
      title: officeLabel(assignment.office_role),
      subtitle: askedBy,
      state,
      detail,
      timestamp: assignment.completed_at ?? assignment.decided_at ?? assignment.started_at ?? assignment.assigned_at ?? null,
      sortTime: timeValue(assignment.assigned_at ?? assignment.started_at ?? assignment.completed_at ?? assignment.decided_at),
    });
  }

  const changeRequests = events.filter((event) => CHANGE_REQUEST_EVENTS.includes(event.action_type));
  changeRequests.forEach((request, index) => {
    const requestTime = timeValue(request.created_at);
    const nextRequestTime = timeValue(changeRequests[index + 1]?.created_at);
    const response = events.find((event) =>
      CHANGE_RESPONSE_EVENTS.includes(event.action_type)
      && timeValue(event.created_at) > requestTime
      && timeValue(event.created_at) < nextRequestTime
    );
    const isLatest = index === changeRequests.length - 1;
    const requirementsStep = request.action_type === 'ROUTE_REQUIREMENTS_REQUESTED'
      ? assignments.find((step) => step.requirements_requested_at)
      : undefined;
    timeline.push({
      key: `changes-${request.created_at}`,
      title: request.action_type === 'ROUTE_REQUIREMENTS_REQUESTED' ? 'Requirements requested' : 'Changes requested',
      subtitle: requirementsStep ? officeLabel(requirementsStep.office_role) : responsibleOffice,
      state: response
        ? 'complete'
        : isLatest && CHANGES_STATUSES.includes(status)
          ? 'attention'
          : 'skipped',
      detail: response
        ? 'Submitter responded'
        : isLatest && CHANGES_STATUSES.includes(status)
          ? 'Waiting for the submitter'
          : 'No response recorded',
      timestamp: response?.created_at ?? request.created_at,
      sortTime: requestTime,
    });
  });
  if (CHANGES_STATUSES.includes(status) && changeRequests.length === 0) {
    const requirementsStep = assignments.find((step) => step.requirements_requested_at);
    timeline.push({
      key: 'changes-requested',
      title: status === 'returned_for_requirements' ? 'Requirements requested' : 'Changes requested',
      subtitle: requirementsStep ? officeLabel(requirementsStep.office_role) : responsibleOffice,
      state: 'attention',
      detail: 'Waiting for the submitter',
      timestamp: requirementsStep?.requirements_requested_at ?? null,
      sortTime: timeValue(requirementsStep?.requirements_requested_at),
    });
  }

  timeline.sort((first, second) => first.sortTime - second.sortTime);
  steps.push(...timeline.map(({ sortTime: _sortTime, ...step }) => step));

  // ─── Final outcome, or where the submission is now ──────────────────────────
  const decisionOffice = officeLabel(isOfficeRole(finalDecisionOfficeRole ?? null) ? finalDecisionOfficeRole : responsibleRole);
  if (status === 'approved') {
    steps.push({
      key: 'final-approved',
      title: 'Approved',
      subtitle: decisionOffice,
      state: 'complete',
      detail: 'Final decision',
      timestamp: lastTimeFor('SUBMISSION_APPROVED', 'OFFICE_FINAL_DECISION', 'WORKFLOW_COMPLETED', 'SUBMISSION_CLOSED'),
    });
    return { steps, whereabouts: `Approved by ${decisionOffice}`, whereaboutsState: 'complete' };
  }
  if (status === 'completed') {
    steps.push({
      key: 'final-completed',
      title: 'Completed',
      subtitle: decisionOffice,
      state: 'complete',
      detail: 'Processing finished',
      timestamp: lastTimeFor('SUBMISSION_CLOSED', 'WORKFLOW_COMPLETED', 'OFFICE_FINAL_DECISION'),
    });
    return { steps, whereabouts: `Completed by ${decisionOffice}`, whereaboutsState: 'complete' };
  }
  if (isDeclinedStatus(status)) {
    steps.push({
      key: 'final-rejected',
      title: 'Rejected',
      subtitle: decisionOffice,
      state: 'rejected',
      detail: 'Final decision',
      timestamp: lastTimeFor('SUBMISSION_REJECTED', 'OFFICE_REJECTED', 'FINAL_REJECTION'),
    });
    return { steps, whereabouts: `Rejected by ${decisionOffice}`, whereaboutsState: 'rejected' };
  }
  if (status === 'returned') {
    steps.push({
      key: 'final-returned',
      title: 'Returned for redirection',
      subtitle: responsibleOffice,
      state: 'attention',
      detail: 'Submitter to choose another office',
      timestamp: lastTimeFor('RETURNED_TO_SUBMITTER'),
    });
    return {
      steps,
      whereabouts: 'With the submitter to choose another office',
      whereaboutsState: 'attention',
    };
  }
  if (status === 'withdrawn') {
    steps.push({
      key: 'withdrawn',
      title: 'Withdrawn',
      subtitle: 'By the submitter',
      state: 'skipped',
      detail: 'Withdrawn',
      timestamp: lastTimeFor('SUBMISSION_WITHDRAWN'),
    });
    return { steps, whereabouts: 'Withdrawn by the submitter', whereaboutsState: 'skipped' };
  }

  const openAssignment = [...assignments].reverse().find((step) => ['pending', 'in_progress'].includes(step.status));
  if (openAssignment) {
    const office = officeLabel(openAssignment.office_role);
    return {
      steps,
      whereabouts: openAssignment.status === 'pending'
        ? `Sent to ${office} — waiting for them to start`
        : `Under review at ${office}`,
      whereaboutsState: 'active',
    };
  }
  if (CHANGES_STATUSES.includes(status)) {
    return { steps, whereabouts: 'With the submitter to make changes', whereaboutsState: 'attention' };
  }

  // Open and back with the responsible office.
  const lastAssignment = assignments.at(-1);
  steps.push({
    key: 'with-responsible-office',
    title: responsibleOffice,
    subtitle: 'Responsible office',
    state: 'active',
    detail: lastAssignment ? 'Deciding the next step' : 'Reviewing',
    timestamp: null,
  });
  return {
    steps,
    whereabouts: lastAssignment
      ? `Back with ${responsibleOffice} to decide the next step`
      : `Under review at ${responsibleOffice}`,
    whereaboutsState: 'active',
  };
}

/** Steps only; kept for callers that do not need the whereabouts line. */
export function buildRoutingPipelineSteps(input: RoutingPipelineInput): RoutingPipelineStep[] {
  return buildRoutingPipeline(input).steps;
}

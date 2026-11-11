import {
  isOfficeRole,
  OFFICE_CONFIG,
  OFFICE_RESPONSIBILITIES,
  type OfficeRole,
} from './offices.ts';

export type RoutingPipelineState = 'complete' | 'active' | 'pending' | 'rejected' | 'skipped';

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
  responsibility?: string;
  assignment_source?: string;
  assigned_by_role?: string | null;
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

const isDeclined = (status: string) => status.startsWith('declined') || status === 'rejected';
const getResponsibilityLabel = (responsibility?: string) =>
  responsibility && Object.prototype.hasOwnProperty.call(OFFICE_RESPONSIBILITIES, responsibility)
    ? OFFICE_RESPONSIBILITIES[responsibility as keyof typeof OFFICE_RESPONSIBILITIES]
    : null;

export function buildRoutingPipelineSteps({
  submissionStatus,
  submittedAt,
  routeSteps,
  selectedOfficeRole,
  initialDestinationRole,
  finalDecisionOfficeRole,
  auditEvents,
}: RoutingPipelineInput): RoutingPipelineStep[] {
  const status = submissionStatus.toLowerCase();
  const events = [...auditEvents].sort(
    (first, second) => new Date(first.created_at).getTime() - new Date(second.created_at).getTime()
  );
  const initialRoleValue = initialDestinationRole ?? selectedOfficeRole ?? null;
  const initialRole = isOfficeRole(initialRoleValue) ? initialRoleValue : null;
  const sortedRouteSteps = [...routeSteps].sort(
    (first, second) => first.sequence_number - second.sequence_number
      || first.office_role.localeCompare(second.office_role)
  );
  const timeFor = (...actions: string[]) =>
    events.find((event) => actions.includes(event.action_type))?.created_at ?? null;
  const isClosed = ['completed', 'approved', 'withdrawn'].includes(status)
    || isDeclined(status)
    || Boolean(timeFor('SUBMISSION_CLOSED'));
  const nextStepPlaceholder: RoutingPipelineStep = {
    key: 'next-step-placeholder',
    title: 'Next workflow update',
    subtitle: 'Will appear when an office acts',
    state: 'pending',
    detail: 'Awaiting next step',
    isPlaceholder: true,
  };

  const steps: RoutingPipelineStep[] = [{
    key: 'submitted',
    title: 'Request submitted',
    subtitle: 'Submission received',
    state: 'complete',
    detail: 'Submitted',
    timestamp: submittedAt,
  }];

  if (!initialRole) return isClosed ? steps : [...steps, nextStepPlaceholder];

  const initialOffice = OFFICE_CONFIG[initialRole].label;
  const hasForwardedFromInitial = sortedRouteSteps.some((step) =>
    step.assignment_source === 'office_forward'
    && step.assigned_by_role === initialRole
  );
  const hasReceived = Boolean(timeFor('SUBMISSION_RECEIVED'))
    || Boolean(timeFor('OFFICE_FORWARDED_TO_TOURISM_OFFICER', 'TOURISM_OFFICER_ASSIGNMENTS_CREATED'))
    || status === 'in_process'
    || status === 'changes_requested'
    || status === 'returned_for_requirements'
    || status === 'returned'
    || status === 'completed'
    || status === 'approved'
    || isDeclined(status)
    || hasForwardedFromInitial
    || sortedRouteSteps.some((step) =>
      step.office_role === initialRole
      && (step.started_at || ['in_progress', 'completed', 'approved', 'rejected'].includes(step.status))
    );

  steps.push({
    key: 'destination-received',
    title: 'Received by destination office',
    subtitle: initialOffice,
    state: hasReceived ? 'complete' : 'active',
    detail: hasReceived ? `Received by ${initialOffice}` : `Awaiting receipt by ${initialOffice}`,
    timestamp: timeFor('SUBMISSION_RECEIVED')
      ?? sortedRouteSteps.find((step) => step.office_role === initialRole)?.started_at
      ?? null,
  });

  const initialForward = sortedRouteSteps.find((step) =>
    step.assignment_source === 'office_forward'
    && step.assigned_by_role === initialRole
    && isOfficeRole(step.office_role)
  );
  const initialTourismAssignment = initialRole === 'tourism_officer'
    ? sortedRouteSteps.find((step) =>
      step.assignment_source === 'tourism_officer'
      && step.assigned_by_role === 'tourism_officer'
      && isOfficeRole(step.office_role)
    )
    : undefined;
  const initialOfficeCompleted = status === 'completed' || status === 'approved';
  const responsibility = (step?: RoutingPipelineRouteStep) =>
    getResponsibilityLabel(step?.responsibility);
  const decisionEvent = timeFor(
    'OFFICE_ASSIGNMENT_FORWARDED',
    'OFFICE_FINAL_DECISION',
    'WORKFLOW_COMPLETED',
    'SUBMISSION_CLOSED',
    'CHANGES_REQUESTED',
    'ROUTE_REQUIREMENTS_REQUESTED',
    'RETURNED_TO_SUBMITTER',
    'SUBMISSION_WITHDRAWN',
    'OFFICE_REJECTED',
    'FINAL_REJECTION',
  );

  if (initialForward) {
    steps.push({
      key: `forwarded-${initialForward.sequence_number}-${initialForward.office_role}`,
      title: `Forwarded to ${OFFICE_CONFIG[initialForward.office_role as OfficeRole].label}`,
      subtitle: responsibility(initialForward) ?? 'Recommendation requested',
      state: initialForward.status === 'rejected'
        ? 'rejected'
        : ['completed', 'approved'].includes(initialForward.status)
          ? 'complete'
          : 'active',
      detail: initialForward.status === 'rejected'
        ? 'Recommendation declined'
        : ['completed', 'approved'].includes(initialForward.status)
          ? 'Assignment completed'
          : 'Office assignment started',
      timestamp: initialForward.started_at ?? decisionEvent,
    });
  } else if (initialTourismAssignment) {
    steps.push({
      key: `tourism-assigned-${initialTourismAssignment.sequence_number}-${initialTourismAssignment.office_role}`,
      title: `Assigned to ${OFFICE_CONFIG[initialTourismAssignment.office_role as OfficeRole].label}`,
      subtitle: responsibility(initialTourismAssignment) ?? 'Tourism Officer assignment',
      state: ['completed', 'approved'].includes(initialTourismAssignment.status)
        ? 'complete'
        : initialTourismAssignment.status === 'rejected'
          ? 'rejected'
          : initialTourismAssignment.status === 'in_progress' || initialTourismAssignment.started_at
            ? 'active'
            : 'pending',
      detail: ['completed', 'approved'].includes(initialTourismAssignment.status)
        ? 'Assignment completed'
        : initialTourismAssignment.status === 'rejected'
          ? 'Assignment declined'
          : initialTourismAssignment.status === 'in_progress' || initialTourismAssignment.started_at
            ? 'Office assignment started'
            : 'Assignment created',
      timestamp: initialTourismAssignment.started_at
        ?? initialTourismAssignment.decided_at
        ?? timeFor('TOURISM_OFFICER_ASSIGNMENTS_CREATED'),
    });
  } else if (timeFor('OFFICE_FORWARDED_TO_TOURISM_OFFICER')) {
    steps.push({
      key: 'forwarded-to-tourism',
      title: 'Referred to Tourism Office',
      subtitle: 'Tourism Officer review',
      state: 'complete',
      detail: 'Responsible office requested Tourism Officer involvement',
      timestamp: timeFor('OFFICE_FORWARDED_TO_TOURISM_OFFICER'),
    });
  } else if (initialOfficeCompleted) {
    const finalRoleValue = finalDecisionOfficeRole ?? null;
    const finalRole = isOfficeRole(finalRoleValue)
      ? finalRoleValue
      : initialRole;
    steps.push({
      key: 'office-completed',
      title: 'Submission completed',
      subtitle: OFFICE_CONFIG[finalRole].label,
      state: 'complete',
      detail: 'Completed by the responsible office',
      timestamp: timeFor('WORKFLOW_COMPLETED', 'SUBMISSION_CLOSED', 'OFFICE_FINAL_DECISION'),
    });
  } else if (status === 'changes_requested' || status === 'returned_for_requirements') {
    steps.push({
      key: 'changes-requested',
      title: 'Changes requested',
      subtitle: initialOffice,
      state: 'active',
      detail: 'Waiting for submitter response',
      timestamp: timeFor('CHANGES_REQUESTED', 'ROUTE_REQUIREMENTS_REQUESTED'),
    });
  } else if (status === 'returned') {
    steps.push({
      key: 'returned-to-submitter',
      title: 'Returned to submitter',
      subtitle: initialOffice,
      state: 'active',
      detail: 'Choose a new destination',
      timestamp: timeFor('RETURNED_TO_SUBMITTER'),
    });
  } else if (isDeclined(status)) {
    steps.push({
      key: 'office-decision-declined',
      title: 'Submission declined',
      subtitle: initialOffice,
      state: 'rejected',
      detail: 'Decision recorded',
      timestamp: timeFor('OFFICE_REJECTED', 'FINAL_REJECTION'),
    });
  }

  const displayedAssignment = new Set(
    [initialForward, initialTourismAssignment]
      .filter((step): step is RoutingPipelineRouteStep => Boolean(step))
      .map((step) => `${step.sequence_number}:${step.office_role}`)
  );
  for (const step of sortedRouteSteps) {
    if (
      !isOfficeRole(step.office_role)
      || !['office_forward', 'tourism_officer'].includes(step.assignment_source ?? '')
      || displayedAssignment.has(`${step.sequence_number}:${step.office_role}`)
      || (step.status === 'pending' && !step.started_at)
    ) {
      continue;
    }

    const completed = ['completed', 'approved'].includes(step.status);
    const rejected = step.status === 'rejected';
    const waitingOnSubmitter = ['returned_for_requirements', 'changes_requested'].includes(status)
      && Boolean(step.requirements_requested_at);
    steps.push({
      key: `assignment-${step.sequence_number}-${step.office_role}`,
      title: step.assignment_source === 'office_forward'
        ? `Forwarded to ${OFFICE_CONFIG[step.office_role].label}`
        : `Assigned to ${OFFICE_CONFIG[step.office_role].label}`,
      subtitle: step.assignment_source === 'office_forward'
        ? responsibility(step) ?? 'Recommendation requested'
        : responsibility(step) ?? 'Tourism Officer assignment',
      state: rejected ? 'rejected' : completed ? 'complete' : 'active',
      detail: waitingOnSubmitter
        ? 'Waiting for submitter response'
        : rejected
          ? 'Assignment declined'
          : completed
            ? 'Assignment completed'
            : 'Office assignment started',
      timestamp: step.completed_at ?? step.decided_at ?? step.started_at,
    });
  }

  const hasRoutedAssignments = sortedRouteSteps.some((step) =>
    ['office_forward', 'tourism_officer'].includes(step.assignment_source ?? '')
  );
  if (initialOfficeCompleted && hasRoutedAssignments) {
    const finalRoleValue = finalDecisionOfficeRole ?? null;
    const finalRole = isOfficeRole(finalRoleValue)
      ? finalRoleValue
      : initialRole;
    if (!steps.some((step) => ['office-completed', 'workflow-completed'].includes(step.key))) {
      steps.push({
        key: 'workflow-completed',
        title: 'Submission completed',
        subtitle: OFFICE_CONFIG[finalRole].label,
        state: 'complete',
        detail: 'Completed by the authorized office',
        timestamp: timeFor('WORKFLOW_COMPLETED', 'SUBMISSION_CLOSED', 'OFFICE_FINAL_DECISION'),
      });
    }
  }

  if (['changes_requested', 'returned_for_requirements'].includes(status)
    && !steps.some((step) => step.key === 'changes-requested')
  ) {
    const responsibleStep = sortedRouteSteps.find((step) => step.requirements_requested_at);
    steps.push({
      key: 'changes-requested',
      title: status === 'returned_for_requirements' ? 'Additional requirements requested' : 'Changes requested',
      subtitle: responsibleStep && isOfficeRole(responsibleStep.office_role)
        ? OFFICE_CONFIG[responsibleStep.office_role].label
        : initialOffice,
      state: 'active',
      detail: 'Waiting for submitter response',
      timestamp: timeFor('CHANGES_REQUESTED', 'ROUTE_REQUIREMENTS_REQUESTED')
        ?? responsibleStep?.requirements_requested_at
        ?? null,
    });
  }

  if (status === 'returned' && !steps.some((step) => step.key === 'returned-to-submitter')) {
    steps.push({
      key: 'returned-to-submitter',
      title: 'Returned to submitter',
      subtitle: initialOffice,
      state: 'active',
      detail: 'Choose a new destination',
      timestamp: timeFor('RETURNED_TO_SUBMITTER'),
    });
  }

  if (isDeclined(status) && !steps.some((step) => step.key === 'office-decision-declined')) {
    const finalRoleValue = finalDecisionOfficeRole ?? null;
    steps.push({
      key: 'office-decision-declined',
      title: 'Submission declined',
      subtitle: isOfficeRole(finalRoleValue)
        ? OFFICE_CONFIG[finalRoleValue].label
        : initialOffice,
      state: 'rejected',
      detail: 'Decision recorded',
      timestamp: timeFor('OFFICE_REJECTED', 'FINAL_REJECTION'),
    });
  }

  if (status === 'withdrawn') {
    steps.push({
      key: 'withdrawn',
      title: 'Submission withdrawn',
      subtitle: 'Workflow stopped',
      state: 'skipped',
      detail: 'Withdrawn',
      timestamp: timeFor('SUBMISSION_WITHDRAWN'),
    });
  }

  return isClosed ? steps : [...steps, nextStepPlaceholder];
}

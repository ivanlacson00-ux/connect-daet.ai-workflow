import { OFFICE_CONFIG, isOfficeRole } from './offices';

export const ASSIGNMENT_OUTCOMES = {
  endorsed: 'Endorsed',
  endorsed_with_conditions: 'Endorsed with conditions',
  not_endorsed: 'Not endorsed',
} as const;

export type AssignmentOutcome = keyof typeof ASSIGNMENT_OUTCOMES;

export function isAssignmentOutcome(value: string | null | undefined): value is AssignmentOutcome {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(ASSIGNMENT_OUTCOMES, value);
}

/** A note is required for every outcome except a plain endorsement. */
export function assignmentOutcomeNeedsNote(outcome: string | null | undefined) {
  return isAssignmentOutcome(outcome) && outcome !== 'endorsed';
}

export function getOfficeLabel(role: string | null | undefined) {
  return isOfficeRole(role ?? null)
    ? OFFICE_CONFIG[role as keyof typeof OFFICE_CONFIG].label
    : (role ?? '').replaceAll('_', ' ') || 'Unknown office';
}

export type AssignmentTone = 'waiting' | 'positive' | 'caution' | 'negative' | 'muted';

export interface AssignmentStateInput {
  office_role: string;
  status: string;
  outcome?: string | null;
}

/** Short state for an assignment, e.g. "Waiting for response" or "Endorsed". */
export function describeAssignmentState(step: AssignmentStateInput): { label: string; tone: AssignmentTone } {
  switch (step.status) {
    case 'pending':
      return { label: 'Waiting for response', tone: 'waiting' };
    case 'in_progress':
      return { label: 'In review', tone: 'waiting' };
    case 'completed':
    case 'approved':
      if (step.outcome === 'endorsed') return { label: ASSIGNMENT_OUTCOMES.endorsed, tone: 'positive' };
      if (step.outcome === 'endorsed_with_conditions') {
        return { label: ASSIGNMENT_OUTCOMES.endorsed_with_conditions, tone: 'caution' };
      }
      if (step.outcome === 'not_endorsed') return { label: ASSIGNMENT_OUTCOMES.not_endorsed, tone: 'negative' };
      // Assignments completed before outcomes existed.
      return { label: 'Responded', tone: 'muted' };
    case 'rejected':
      return { label: ASSIGNMENT_OUTCOMES.not_endorsed, tone: 'negative' };
    case 'returned':
      return { label: 'Returned without a response', tone: 'caution' };
    case 'withdrawn':
      return { label: 'Withdrawn', tone: 'muted' };
    default:
      return { label: step.status.replaceAll('_', ' '), tone: 'muted' };
  }
}

/** One-line summary, e.g. "Municipal Treasurer's Office responded: Endorsed". */
export function summarizeAssignment(step: AssignmentStateInput) {
  const office = getOfficeLabel(step.office_role);
  switch (step.status) {
    case 'pending':
    case 'in_progress':
      return `Waiting on ${office}`;
    case 'returned':
      return `${office} returned the assignment`;
    case 'withdrawn':
      return `Assignment with ${office} withdrawn`;
    default:
      return `${office} responded${isAssignmentOutcome(step.outcome) ? `: ${ASSIGNMENT_OUTCOMES[step.outcome]}` : ''}`;
  }
}

export const ASSIGNMENT_TONE_CLASSES: Record<AssignmentTone, string> = {
  waiting: 'bg-pending-bg text-pending-text',
  positive: 'bg-approved-bg text-approved-text',
  caution: 'bg-pending-bg text-pending-text',
  negative: 'bg-rejected-bg text-rejected-text',
  muted: 'bg-sidebar text-muted-text',
};

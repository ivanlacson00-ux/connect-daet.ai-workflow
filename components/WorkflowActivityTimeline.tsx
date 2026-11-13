interface WorkflowActivityEvent {
  id: string;
  actionType: string;
  label: string;
  createdAt: string;
  actor: string;
  actorRole?: string | null;
  comments?: string | null;
}

const KEY_ACTIVITY_ACTIONS = new Set([
  'SUBMITTED',
  'DESTINATION_SELECTED',
  'SUBMISSION_REDIRECTED',
  'SUBMISSION_RECEIVED',
  'SUBMISSION_FORWARDED',
  'ASSIGNMENT_COMPLETED',
  'ASSIGNMENT_RETURNED',
  'ASSIGNMENT_WITHDRAWN',
  'CHANGES_REQUESTED',
  'CHANGES_RESPONDED',
  'RETURNED_TO_SUBMITTER',
  'SUBMISSION_WITHDRAWN',
  'SUBMISSION_CLOSED',
  'SUBMISSION_REOPENED',
  'STAGE_1_AUTHORIZED',
  'STAGE_1_REJECTED',
  'FINAL_AUTHORIZATION',
  'FINAL_REJECTION',
  'VERIFICATION_PASSED',
  'RETURNED_FOR_CORRECTION',
  'OFFICE_ROUTE_STEP_ASSIGNED',
  'OFFICE_ROUTE_STEP_APPROVED',
  'OFFICE_ASSIGNMENT_COMPLETED',
  'OFFICE_ASSIGNMENT_FORWARDED',
  'OFFICE_FORWARDED_TO_TOURISM_OFFICER',
  'TOURISM_OFFICER_ASSIGNMENTS_CREATED',
  'TOURISM_OFFICER_ASSIGNMENTS_COMPLETED',
  'OFFICE_FINAL_DECISION',
  'ROUTE_PROPOSED',
  'REVISED_DOCUMENT_SUBMITTED',
  'REQUIREMENTS_RESUBMITTED',
  'ROUTE_REQUIREMENTS_REQUESTED',
  'ROUTE_RETURNED_TO_ADMIN',
  'APPROVER_REJECTED',
  'ADMIN_REJECTED',
  'OFFICE_REJECTED',
  'MAYOR_REJECTED',
  'WORKFLOW_COMPLETED',
  'DOCUMENT_RELEASED',
]);

const RECENT_EVENT_LIMIT = 5;

const formatTimestamp = (value: string) =>
  new Date(value).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

function ActivityEvent({
  event,
  featured = false,
  showComments,
}: {
  event: WorkflowActivityEvent;
  featured?: boolean;
  showComments: boolean;
}) {
  return (
    <li className={`relative border-l pl-4 ${featured ? 'border-clay' : 'border-warm-border'}`}>
      <span className={`absolute -left-[4.5px] top-1.5 h-2 w-2 rounded-full ring-4 ring-card ${featured ? 'bg-clay' : 'bg-warm-border'}`} />
      <p className={`text-[11px] font-semibold ${featured ? 'text-clay' : 'text-warm-text'}`}>{event.label}</p>
      <p className="mt-0.5 text-[10px] font-medium text-warm-text">
        {event.actor}{event.actorRole ? ` · ${event.actorRole.replaceAll('_', ' ')}` : ''}
      </p>
      <time dateTime={event.createdAt} className="mt-0.5 block text-[10px] text-muted-text">
        {formatTimestamp(event.createdAt)}
      </time>
      {showComments && event.comments && (
        <p className="mt-2 whitespace-pre-wrap break-words rounded-lg bg-sidebar px-3 py-2 text-[11px] leading-relaxed text-warm-text">
          {event.comments}
        </p>
      )}
    </li>
  );
}

export default function WorkflowActivityTimeline({
  events,
  emptyMessage = 'No activity recorded yet.',
  showComments = true,
}: {
  events: WorkflowActivityEvent[];
  emptyMessage?: string;
  showComments?: boolean;
}) {
  if (events.length === 0) {
    return <p className="text-[11px] text-muted-text">{emptyMessage}</p>;
  }

  const sortedEvents = [...events].sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)
  );
  const hasSubmittedEvent = sortedEvents.some((event) => event.actionType === 'SUBMITTED');
  const keyEvents = sortedEvents.filter((event) =>
    KEY_ACTIVITY_ACTIONS.has(event.actionType)
    && !(hasSubmittedEvent && event.actionType === 'DESTINATION_SELECTED')
  );
  const recentEvents = keyEvents.slice(-RECENT_EVENT_LIMIT).map((event) =>
    event.actionType === 'DESTINATION_SELECTED'
      ? { ...event, label: 'Submission submitted', comments: null }
      : event
  );

  return (
    <div className="space-y-4">
      <div>
        <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.1em] text-muted-text">Latest workflow updates</p>
        <p className="mb-3 text-[10px] text-muted-text">
          {recentEvents.length === 0
            ? 'No key workflow updates recorded yet.'
            : `Showing ${recentEvents.length} latest of ${keyEvents.length} key updates.`}
        </p>
        <ol className="space-y-4">
          {recentEvents.length > 0
            ? recentEvents.map((event) => <ActivityEvent key={event.id} event={event} featured showComments={showComments} />)
            : <li className="text-[11px] text-muted-text">No key workflow updates recorded yet.</li>}
        </ol>
      </div>
      <details className="border-t border-warm-border pt-3">
        <summary className="cursor-pointer text-[10px] font-semibold text-clay outline-none hover:text-warm-text focus-visible:ring-2 focus-visible:ring-clay/30">
          Show full audit history ({sortedEvents.length}, including updates above)
        </summary>
        <ol className="mt-4 space-y-4">
          {sortedEvents.map((event) => <ActivityEvent key={event.id} event={event} showComments={showComments} />)}
        </ol>
      </details>
    </div>
  );
}

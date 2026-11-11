drop trigger if exists notify_approvers_of_submission
  on public.workflow_audit_logs;

-- A legacy trigger notified Tourism of every new submission, regardless of destination.
drop function if exists public.notify_approvers_of_submission();

delete from public.workflow_email_outbox as outbox
using public.workflow_notifications as notification,
      public.profiles as recipient,
      public.workflow_submissions as submission
where outbox.notification_id = notification.id
  and notification.recipient_id = recipient.id
  and notification.submission_id = submission.id
  and notification.event_type = 'SUBMITTED'
  and recipient.role in (
    'tourism_officer',
    'municipal_treasurer',
    'mayor_office',
    'sangguniang_bayan'
  )
  and recipient.role is distinct from submission.selected_office_role
  and outbox.status = 'queued';

delete from public.workflow_notifications as notification
using public.profiles as recipient,
      public.workflow_submissions as submission
where notification.recipient_id = recipient.id
  and notification.submission_id = submission.id
  and notification.event_type = 'SUBMITTED'
  and recipient.role in (
    'tourism_officer',
    'municipal_treasurer',
    'mayor_office',
    'sangguniang_bayan'
  )
  and recipient.role is distinct from submission.selected_office_role
  and not exists (
    select 1
    from public.workflow_email_outbox as outbox
    where outbox.notification_id = notification.id
  );

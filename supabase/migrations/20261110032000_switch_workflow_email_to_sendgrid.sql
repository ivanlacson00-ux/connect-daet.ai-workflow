drop function if exists public.record_workflow_email_provider_event(
  text, text, text, timestamptz, jsonb
);

create function public.record_workflow_email_provider_event(
  p_provider_event_id text,
  p_provider_event_type text,
  p_provider_message_id text,
  p_event_occurred_at timestamptz,
  p_provider_event_data jsonb default '{}'::jsonb,
  p_outbox_id uuid default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  next_status text;
  detail text;
  matched_outbox_id uuid;
begin
  next_status := case p_provider_event_type
    when 'email.delivered' then 'delivered'
    when 'email.bounced' then 'bounced'
    when 'email.complained' then 'complained'
    when 'email.failed' then 'failed'
    else null
  end;

  if next_status is null then
    raise exception 'Unsupported email provider event type: %', p_provider_event_type;
  end if;
  if nullif(btrim(p_provider_event_id), '') is null
    or nullif(btrim(p_provider_message_id), '') is null
    or p_event_occurred_at is null then
    raise exception 'Email provider event is missing required identifiers or timestamp';
  end if;

  insert into public.workflow_email_provider_events (
    event_id,
    event_type,
    provider_message_id,
    occurred_at,
    event_data
  )
  values (
    p_provider_event_id,
    p_provider_event_type,
    p_provider_message_id,
    p_event_occurred_at,
    coalesce(p_provider_event_data, '{}'::jsonb)
  )
  on conflict (event_id) do nothing;

  if not found then
    return false;
  end if;

  detail := coalesce(
    p_provider_event_data ->> 'reason',
    p_provider_event_data ->> 'response',
    p_provider_event_data #>> '{bounce,message}',
    p_provider_event_data #>> '{failed,reason}',
    p_provider_event_data #>> '{suppressed,message}'
  );

  update public.workflow_email_outbox
  set status = next_status,
      delivered_at = case
        when next_status = 'delivered' then coalesce(delivered_at, p_event_occurred_at)
        else delivered_at
      end,
      failed_at = case
        when next_status in ('failed', 'bounced', 'complained')
          then coalesce(failed_at, p_event_occurred_at)
        else failed_at
      end,
      is_retryable = false,
      last_error = case
        when next_status in ('failed', 'bounced', 'complained')
          then coalesce(detail, p_provider_event_type)
        when next_status = 'delivered' then null
        else last_error
      end,
      provider_event_data = coalesce(workflow_email_outbox.provider_event_data, '{}'::jsonb)
        || jsonb_build_object(
          'type', p_provider_event_type,
          'occurred_at', p_event_occurred_at,
          'details', coalesce(detail, '')
        ),
      last_provider_event_at = p_event_occurred_at,
      claimed_by = null,
      lease_expires_at = null,
      last_updated_at = timezone('utc', now())
  where (
      (p_outbox_id is not null and workflow_email_outbox.id = p_outbox_id)
      or (
        p_outbox_id is null
        and workflow_email_outbox.provider_message_id = p_provider_message_id
      )
    )
    and (
      last_provider_event_at is null
      or p_event_occurred_at >= last_provider_event_at
    )
  returning id into matched_outbox_id;

  if matched_outbox_id is null and not exists (
    select 1
    from public.workflow_email_outbox
    where (
      (p_outbox_id is not null and id = p_outbox_id)
      or (
        p_outbox_id is null
        and provider_message_id = p_provider_message_id
      )
    )
  ) then
    raise exception 'No email outbox record found for provider message %',
      p_provider_message_id;
  end if;

  return true;
end;
$$;

revoke all on function public.record_workflow_email_provider_event(
  text, text, text, timestamptz, jsonb, uuid
) from public, anon, authenticated;
grant execute on function public.record_workflow_email_provider_event(
  text, text, text, timestamptz, jsonb, uuid
) to service_role;

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

do $migration$
declare
  missing_secrets text;
begin
  select string_agg(required.name, ', ' order by required.name)
    into missing_secrets
  from (values
    ('workflow_email_function_url'),
    ('workflow_email_cron_secret')
  ) as required(name)
  where not exists (
    select 1
    from vault.decrypted_secrets as secret
    where secret.name = required.name
  );

  if missing_secrets is not null then
    raise exception 'Cannot schedule workflow email processing: missing Vault secret(s): %',
      missing_secrets
      using hint = 'First deploy process-email-outbox and create the missing secrets with vault.create_secret in the Supabase SQL Editor. workflow_email_function_url must be the full Edge Function URL; workflow_email_cron_secret must exactly match the function CRON_SECRET. Then rerun this migration.';
  end if;

  perform cron.unschedule(jobid)
  from cron.job
  where jobname = 'process-workflow-email-outbox';

  perform cron.schedule(
    'process-workflow-email-outbox',
    '* * * * *',
    $job$
      select net.http_post(
        url := (
          select decrypted_secret
          from vault.decrypted_secrets
          where name = 'workflow_email_function_url'
        ),
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-cron-secret', (
            select decrypted_secret
            from vault.decrypted_secrets
            where name = 'workflow_email_cron_secret'
          )
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 240000
      );
    $job$
  );
end;
$migration$;

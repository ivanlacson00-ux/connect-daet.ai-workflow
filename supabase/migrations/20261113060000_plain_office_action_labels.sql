-- Replace "Endorsed" wording with plain office actions (Approved / Rejected).
-- Stored outcome values ('endorsed', 'endorsed_with_conditions', 'not_endorsed')
-- are unchanged; only the text people see changes.

create or replace function public.workflow_assignment_outcome_label(assignment_outcome text)
returns text
language sql
immutable
set search_path = public
as $$
  select case assignment_outcome
    when 'endorsed' then 'Approved'
    when 'endorsed_with_conditions' then 'Approved with conditions'
    when 'not_endorsed' then 'Rejected'
    else null
  end
$$;

do $migration$
declare
  target_function regprocedure;
  function_definition text;
  original_definition text;
begin
  foreach target_function in array array[
    'public.complete_workflow_assignment(uuid,text,text)'::regprocedure,
    'public.forward_workflow_submission_to_office(uuid,text,uuid,uuid,text,jsonb,text,text)'::regprocedure
  ] loop
    function_definition := replace(pg_get_functiondef(target_function), E'\r\n', E'\n');
    original_definition := function_definition;

    -- Notification titles: "Mayor's Office: Approved" instead of "... responded: Endorsed".
    function_definition := replace(function_definition, $old$ || ' responded: ' || $old$, $new$ || ': ' || $new$);
    function_definition := replace(
      function_definition,
      $old$'Add a note explaining the conditions or why the submission is not endorsed'$old$,
      $new$'Add a note explaining the conditions or why your office rejects this submission'$new$
    );

    if function_definition = original_definition then
      raise exception 'Could not update office action wording in %', target_function;
    end if;
    execute function_definition;
  end loop;
end
$migration$;

-- Existing history and notifications written with the old wording.
update public.workflow_audit_logs
set comments = replace(replace(replace(comments,
  'Endorsed with conditions', 'Approved with conditions'),
  'Not endorsed', 'Rejected'),
  'Endorsed', 'Approved')
where comments like '%ndorsed%';

update public.workflow_notifications
set title = replace(replace(replace(replace(title,
  ' responded: ', ': '),
  'Endorsed with conditions', 'Approved with conditions'),
  'Not endorsed', 'Rejected'),
  'Endorsed', 'Approved')
where title like '%ndorsed%';

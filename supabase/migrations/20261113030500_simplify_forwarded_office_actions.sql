do $migration$
declare
  function_definition text;
  original_definition text;
  old_fragment text;
  new_fragment text;
begin
  select pg_get_functiondef(
    'public.complete_workflow_assignment(uuid,text,text)'::regprocedure
  ) into function_definition;
  function_definition := replace(function_definition, E'\r\n', E'\n');
  original_definition := function_definition;

  old_fragment := $old$
  if outcome_label is null then
    raise exception 'Choose an outcome: Endorsed, Endorsed with conditions, or Not endorsed';
  end if;
  if assignment_outcome <> 'endorsed' and note is null then
    raise exception 'Add a note explaining the conditions or why the submission is not endorsed';
  end if;
$old$;
  new_fragment := $new$
  if assignment_outcome is not null and outcome_label is null then
    raise exception 'Choose a valid assignment outcome';
  end if;
  if assignment_outcome is not null
    and assignment_outcome <> 'endorsed'
    and note is null then
    raise exception 'Add a note explaining the conditions or why the submission is not endorsed';
  end if;
$new$;
  if position(old_fragment in function_definition) = 0 then
    raise exception 'Could not safely update assignment completion validation';
  end if;
  function_definition := replace(function_definition, old_fragment, new_fragment);

  old_fragment := $old$
    public.workflow_office_label(actor_role) || ' — ' || outcome_label, now_at
$old$;
  new_fragment := $new$
    public.workflow_office_label(actor_role)
      || coalesce(' — ' || outcome_label, ' completed the assignment'), now_at
$new$;
  if position(old_fragment in function_definition) = 0 then
    raise exception 'Could not safely update assignment completion history';
  end if;
  function_definition := replace(function_definition, old_fragment, new_fragment);

  old_fragment := $old$
    public.workflow_office_label(actor_role) || ' responded: ' || outcome_label,
$old$;
  new_fragment := $new$
    case
      when outcome_label is null then public.workflow_office_label(actor_role) || ' completed the assignment'
      else public.workflow_office_label(actor_role) || ' responded: ' || outcome_label
    end,
$new$;
  if position(old_fragment in function_definition) = 0 then
    raise exception 'Could not safely update assignment completion notifications';
  end if;
  function_definition := replace(function_definition, old_fragment, new_fragment);
  if function_definition = original_definition then
    raise exception 'Assignment completion function was not updated';
  end if;
  execute function_definition;

  select pg_get_functiondef(
    'public.forward_workflow_submission_to_office(uuid,text,uuid,uuid,text,jsonb,text,text)'::regprocedure
  ) into function_definition;
  function_definition := replace(function_definition, E'\r\n', E'\n');
  original_definition := function_definition;

  old_fragment := $old$
    if own_outcome_label is null then
      raise exception 'Record your office''s response (Endorsed, Endorsed with conditions, or Not endorsed) before forwarding onward';
    end if;
    if forwarder_outcome <> 'endorsed' and own_note is null then
      raise exception 'Add a note explaining the conditions or why the submission is not endorsed';
    end if;
$old$;
  new_fragment := $new$
    if forwarder_outcome is not null and own_outcome_label is null then
      raise exception 'Choose a valid assignment outcome before forwarding onward';
    end if;
    if forwarder_outcome is not null
      and forwarder_outcome <> 'endorsed'
      and own_note is null then
      raise exception 'Add a note explaining the conditions or why the submission is not endorsed';
    end if;
$new$;
  if position(old_fragment in function_definition) = 0 then
    raise exception 'Could not safely update onward-forwarding validation';
  end if;
  function_definition := replace(function_definition, old_fragment, new_fragment);

  old_fragment := $old$
      public.workflow_office_label(actor_role) || ' — ' || own_outcome_label
        || '; forwarded onward to ' || public.workflow_office_label(target_office_role),
$old$;
  new_fragment := $new$
      public.workflow_office_label(actor_role)
        || coalesce(' — ' || own_outcome_label, '')
        || '; forwarded onward to ' || public.workflow_office_label(target_office_role),
$new$;
  if position(old_fragment in function_definition) = 0 then
    raise exception 'Could not safely update onward-forwarding history';
  end if;
  function_definition := replace(function_definition, old_fragment, new_fragment);

  old_fragment := $old$
      public.workflow_office_label(actor_role) || ' responded: ' || own_outcome_label
        || ', then forwarded to ' || public.workflow_office_label(target_office_role),
$old$;
  new_fragment := $new$
      case
        when own_outcome_label is null then
          public.workflow_office_label(actor_role) || ' forwarded the assignment onward to '
            || public.workflow_office_label(target_office_role)
        else
          public.workflow_office_label(actor_role) || ' responded: ' || own_outcome_label
            || ', then forwarded to ' || public.workflow_office_label(target_office_role)
      end,
$new$;
  if position(old_fragment in function_definition) = 0 then
    raise exception 'Could not safely update onward-forwarding notifications';
  end if;
  function_definition := replace(function_definition, old_fragment, new_fragment);
  if function_definition = original_definition then
    raise exception 'Office forwarding function was not updated';
  end if;
  execute function_definition;
end;
$migration$;

alter table public.profiles drop constraint profiles_role_check;
alter table public.workflow_office_document_types
  drop constraint workflow_office_document_types_office_role_check;
alter table public.workflow_submissions
  drop constraint workflow_submissions_initial_destination_role_check;

update public.profiles
set role = case role
  when 'user' then 'submitter'
  when 'approver' then 'tourism_officer'
  when 'admin' then 'system_admin'
  else role
end
where role in ('user', 'approver', 'admin');

update public.workflow_office_document_types
set office_role = 'tourism_officer'
where office_role = 'approver';

update public.workflow_submissions
set initial_destination_role = 'tourism_officer'
where initial_destination_role = 'approver';

alter table public.profiles
  add constraint profiles_role_check
  check (role in (
    'submitter',
    'tourism_officer',
    'system_admin',
    'municipal_treasurer',
    'mayor_office',
    'sangguniang_bayan'
  ));

alter table public.workflow_office_document_types
  add constraint workflow_office_document_types_office_role_check
  check (office_role in (
    'municipal_treasurer',
    'mayor_office',
    'sangguniang_bayan',
    'tourism_officer'
  ));

alter table public.workflow_submissions
  add constraint workflow_submissions_initial_destination_role_check
  check (
    initial_destination_role is null
    or initial_destination_role in (
      'municipal_treasurer',
      'mayor_office',
      'sangguniang_bayan',
      'tourism_officer'
    )
  );

do $$
declare
  function_oid oid;
  function_definition text;
begin
  for function_oid in
    select procedure.oid
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.prokind = 'f'
      and (
        procedure.prosrc like '%''user''%'
        or procedure.prosrc like '%''approver''%'
        or procedure.prosrc like '%''admin''%'
      )
  loop
    function_definition := pg_get_functiondef(function_oid);
    function_definition := replace(function_definition, '''user''', '''submitter''');
    function_definition := replace(function_definition, '''approver''', '''tourism_officer''');
    function_definition := replace(function_definition, '''admin''', '''system_admin''');
    execute function_definition;
  end loop;
end;
$$;

do $$
declare
  policy_record record;
  using_expression text;
  check_expression text;
  alter_statement text;
begin
  for policy_record in
    select schemaname, tablename, policyname, qual, with_check
    from pg_policies
    where schemaname = 'public'
      and (
        coalesce(qual, '') like '%''user''%'
        or coalesce(qual, '') like '%''approver''%'
        or coalesce(qual, '') like '%''admin''%'
        or coalesce(with_check, '') like '%''user''%'
        or coalesce(with_check, '') like '%''approver''%'
        or coalesce(with_check, '') like '%''admin''%'
      )
  loop
    using_expression := policy_record.qual;
    check_expression := policy_record.with_check;
    if using_expression is not null then
      using_expression := replace(using_expression, '''user''', '''submitter''');
      using_expression := replace(using_expression, '''approver''', '''tourism_officer''');
      using_expression := replace(using_expression, '''admin''', '''system_admin''');
    end if;
    if check_expression is not null then
      check_expression := replace(check_expression, '''user''', '''submitter''');
      check_expression := replace(check_expression, '''approver''', '''tourism_officer''');
      check_expression := replace(check_expression, '''admin''', '''system_admin''');
    end if;

    alter_statement := format(
      'alter policy %I on %I.%I',
      policy_record.policyname,
      policy_record.schemaname,
      policy_record.tablename
    );
    if using_expression is not null then
      alter_statement := alter_statement || format(' using (%s)', using_expression);
    end if;
    if check_expression is not null then
      alter_statement := alter_statement || format(' with check (%s)', check_expression);
    end if;
    execute alter_statement;
  end loop;
end;
$$;

notify pgrst, 'reload schema';

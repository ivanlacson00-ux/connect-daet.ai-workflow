update public.workflow_submissions
set current_responsible_role = case current_responsible_role
  when 'approver' then 'tourism_officer'
  when 'admin' then 'system_admin'
  when 'user' then 'submitter'
  else current_responsible_role
end
where current_responsible_role in ('approver', 'admin', 'user');

update public.workflow_messages
set sender_role = case sender_role
  when 'approver' then 'tourism_officer'
  when 'admin' then 'system_admin'
  when 'user' then 'submitter'
  else sender_role
end
where sender_role in ('approver', 'admin', 'user');

update public.workflow_document_retrieval_events
set actor_role = case actor_role
  when 'approver' then 'tourism_officer'
  when 'admin' then 'system_admin'
  when 'user' then 'submitter'
  else actor_role
end
where actor_role in ('approver', 'admin', 'user');

update public.workflow_document_retrievals
set office_role = 'tourism_officer'
where office_role = 'approver';

update auth.users
set raw_user_meta_data = jsonb_set(raw_user_meta_data, '{role}', to_jsonb('submitter'::text), false)
where raw_user_meta_data->>'role' = 'user';

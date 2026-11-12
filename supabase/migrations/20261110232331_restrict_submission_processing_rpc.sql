revoke all on function public.complete_workflow_assignment(uuid, text) from public, anon;
revoke all on function public.close_workflow_submission(uuid) from public, anon;

grant execute on function public.complete_workflow_assignment(uuid, text) to authenticated;
grant execute on function public.close_workflow_submission(uuid) to authenticated;

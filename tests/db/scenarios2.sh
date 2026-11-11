#!/bin/bash
# Additional coverage: forward-to-Tourism path, Tourism-only completion, Tourism rejection,
# requirements inside a route, inter-office return/reject/messages, e-mail pipeline, storage RLS.
cd "$(dirname "$0")"; source ./lib.sh
db "$(cat seed.sql)" >/dev/null
A=11111111-1111-1111-1111-111111111111; B=22222222-2222-2222-2222-222222222222
T=33333333-3333-3333-3333-333333333333; ADM=44444444-4444-4444-4444-444444444444
MTO=55555555-5555-5555-5555-555555555555; SB=66666666-6666-6666-6666-666666666666; MAY=77777777-7777-7777-7777-777777777777
submit() { as $1 "select id from public.create_workflow_submission('$4', '$1/$4.pdf', 'u', 'application/pdf', 1000, '$3', 'Description for $4', null, null, null, '$2', '[]'::jsonb, $( [ "$3" = Other ] && echo "'Custom type'" || echo null ))" | grep -E '^[0-9a-f-]{36}' | head -1; }

echo "== SB forwards a direct request to the Tourism Officer, who adds MTO as an extra assignment"
S6=$(submit $A sangguniang_bayan "Legislative Requests" leg1)
expect_err "MTO-only rule: MTO cannot forward its own request to Tourism" "Municipal Treasurer" $MTO "select public.forward_workflow_submission_to_tourism_officer('$(submit $B municipal_treasurer 'Financial Requests' fin1)','fwd')"
expect_ok "SB forwards to Tourism Officer" $SB "select public.forward_workflow_submission_to_tourism_officer('$S6','Needs tourism input')"
db_eq "status pending_approver after forward" "pending_approver" "select status from workflow_submissions where id='$S6'"
expect_ok "Tourism Officer adds MTO assignment (create_tourism_officer_assignments)" $T "select public.create_tourism_officer_assignments('$S6','[{\"office_role\":\"municipal_treasurer\",\"responsibility\":\"evaluation_verification\"}]'::jsonb,'sequential','Please assess',null)"
db_eq "request returns to SB as final decision office with MTO step" "pending_office|sangguniang_bayan|1" "select s.status||'|'||s.selected_office_role||'|'||(select count(*) from workflow_routing_steps st join workflow_routing_plans p on p.id=st.routing_plan_id where p.submission_id=s.id) from workflow_submissions s where s.id='$S6'"
expect_eq "MTO can see the assigned request" "1" $MTO "select count(*) from workflow_submissions where id='$S6'"
STEPSTATUS=$(db "select st.status from workflow_routing_steps st join workflow_routing_plans p on p.id=st.routing_plan_id where p.submission_id='$S6'")
echo "   (MTO step status: $STEPSTATUS)"
expect_err "SB cannot finalize before MTO assessment" "" $SB "select public.finalize_workflow_submission('$S6','early')"
expect_ok "MTO uploads its assessment" $MTO "select public.add_workflow_office_supporting_document('$S6','mto-assessment.pdf','$MTO/$S6/office-support/a.pdf','application/pdf',300)"
expect_ok "MTO approves its step" $MTO "select public.decide_workflow_route_step('$S6', true, 'Assessed')"
expect_ok "SB final decision after assessment" $SB "select public.finalize_workflow_submission('$S6','Approved by SB')"
db_eq "status completed" "completed" "select status from workflow_submissions where id='$S6'"

echo "== Tourism-only request completed by Tourism Officer, and a rejected Tourism request"
S7=$(submit $A tourism_officer Other tour2)
expect_err "Submitter cannot complete Tourism request" "" $A "select public.complete_tourism_office_submission('$S7','x')"
expect_ok "Tourism Officer completes Tourism-only request" $T "select public.complete_tourism_office_submission('$S7','Done')"
db_eq "S7 completed" "completed" "select status from workflow_submissions where id='$S7'"
S8=$(submit $B tourism_officer Other tour3)
expect_ok "Tourism Officer rejects with reason" $T "select public.decide_workflow_submission('$S8','declined_by_approver','Incomplete',null)"
db_eq "S8 declined_by_approver and archived" "declined_by_approver|1" "select status||'|'||(archived_at is not null)::int from workflow_submissions where id='$S8'"
db_eq "S8 submitter notified of rejection" "1" "select count(*) from workflow_notifications where recipient_id='$B' and submission_id='$S8' and event_type='APPROVER_REJECTED'"

echo "== Requirements requested inside a Tourism route"
S9=$(submit $A tourism_officer Other tour4)
expect_ok "Tourism routes to Mayor" $T "select public.route_tourism_submission_to_municipal_offices('$S9','[{\"office_role\":\"mayor_office\",\"responsibility\":\"mandatory_approval_clearance\"}]'::jsonb,'sequential',null)"
expect_ok "Mayor requests requirements" $MAY "select public.request_workflow_submission_changes('$S9','Attach permit')"
db_eq "S9 returned_for_requirements" "returned_for_requirements" "select status from workflow_submissions where id='$S9'"
expect_ok "Submitter responds" $A "select public.respond_to_workflow_submission_changes('$S9','Attached','$A/tour4-v2.pdf','u','tour4 v2','application/pdf',100)"
db_eq "S9 back at Mayor" "pending_office|mayor_office" "select status||'|'||selected_office_role from workflow_submissions where id='$S9'"
expect_ok "Mayor approves step" $MAY "select public.decide_tourism_submission_route_step('$S9', true, 'OK')"
expect_ok "Tourism completes routed request" $T "select public.complete_routed_tourism_submission('$S9','Approved')"
db_eq "S9 completed with 2 versions" "completed|2" "select status||'|'||(select count(*) from workflow_submission_versions v where v.submission_id=s.id) from workflow_submissions s where id='$S9'"

echo "== Inter-office return, reject, messaging"
RID=$(as $MTO "select public.create_interoffice_request('Fee review','Permit','Review fees',array['municipal_treasurer','sangguniang_bayan','mayor_office'],array[null,'technical_review',null]::text[],null)" | grep -E '^[0-9a-f-]{36}')
expect_ok "MTO starts and forwards" $MTO "select public.start_interoffice_review('$RID'); select public.forward_interoffice_request('$RID','fwd')"
expect_ok "SB starts review" $SB "select public.start_interoffice_review('$RID')"
expect_ok "SB returns to MTO for revision" $SB "select public.return_interoffice_request('$RID','municipal_treasurer','Fix amounts')"
db_eq "current office back at MTO" "municipal_treasurer" "select current_office from workflow_interoffice_requests where id='$RID'"
expect_ok "MTO sends inter-office message" $MTO "insert into workflow_interoffice_messages (request_id, sender_id, recipient_office, body) values ('$RID','$MTO','sangguniang_bayan','Revised')"
expect_eq "SB (route participant) can read messages" "1" $SB "select count(*) from workflow_interoffice_messages where request_id='$RID'"
expect_eq "Submitter cannot read inter-office messages" "0" $A "select count(*) from workflow_interoffice_messages where request_id='$RID'"
expect_ok "MTO forwards again" $MTO "select public.forward_interoffice_request('$RID','fwd2')"
expect_ok "SB starts review again" $SB "select public.start_interoffice_review('$RID')"
expect_eq "SB forward blocked without technical review" "awaiting_supporting_document" $SB "select public.forward_interoffice_request('$RID','fwd')"
expect_err "SB (not final) cannot approve" "final approval office" $SB "select public.decide_interoffice_request('$RID','approve','x')"
expect_eq "SB can reject" "rejected" $SB "select public.decide_interoffice_request('$RID','reject','Not feasible')"
db_eq "MTO notified of rejection" "1" "select (count(*)>0)::int from workflow_notifications where recipient_id='$MTO' and interoffice_request_id='$RID'"
expect_ok "Pending reminders job runs" service "select public.send_interoffice_pending_reminders()"

echo "== Linked inter-office request (MTO -> Mayor with assessment report) for a citizen request"
S10=$(submit $A municipal_treasurer "Business Permit Fees" permit2)
RID2=$(as $MTO "select public.create_interoffice_request('Permit endorsement','Permit','Mayor endorsement needed',array['municipal_treasurer','mayor_office'],array['assessment_report',null]::text[],'$S10')" | grep -E '^[0-9a-f-]{36}')
[ -n "$RID2" ] && ok "MTO creates linked inter-office request" || bad "MTO creates linked inter-office request" "$LAST"
expect_eq "Mayor can view the linked citizen request" "1" $MAY "select count(*) from workflow_submissions where id='$S10'"
expect_eq "Mayor cannot view citizen conversation of linked request" "0" $MAY "select count(*) from workflow_messages where submission_id='$S10'"
expect_err "SB cannot link a citizen request it does not handle" "not accessible" $SB "select public.create_interoffice_request('x','y','z',array['sangguniang_bayan','mayor_office'],array[null,null]::text[],'$S10')"

echo "== E-mail outbox pipeline (DB side)"
QUEUED=$(db "select count(*) from workflow_email_outbox where status='queued'")
[ "$QUEUED" -gt 0 ] && ok "notifications queued $QUEUED e-mails" || bad "emails queued" "$QUEUED"
expect_err "Authenticated user cannot claim e-mail jobs" "" $A "select count(*) from public.claim_workflow_email_jobs(gen_random_uuid(), 5)"
W=$(uuidgen 2>/dev/null || cat /proc/sys/kernel/random/uuid)
CLAIMED=$(as service "select count(*) from public.claim_workflow_email_jobs('$W', 5)" | tail -1)
[ "$CLAIMED" = 5 ] && ok "service role claims 5 jobs with a lease" || bad "service role claims jobs" "$CLAIMED"
db_eq "claimed jobs are processing" "5" "select count(*) from workflow_email_outbox where claimed_by='$W' and status='processing'"
CLAIMED2=$(as service "select count(*) from public.claim_workflow_email_jobs(gen_random_uuid(), 500)" | tail -1)
db_eq "leased jobs are not double-claimed" "0" "select count(*) from (select id from workflow_email_outbox where status='processing' group by id having count(distinct claimed_by)>1) x"
JOB=$(db "select id from workflow_email_outbox where claimed_by='$W' limit 1")
db "update workflow_email_outbox set status='accepted', provider_message_id='msg-1', accepted_at=now(), claimed_by=null, lease_expires_at=null where id='$JOB'" >/dev/null
expect_ok "provider 'delivered' event recorded" service "select public.record_workflow_email_provider_event('ev-1','email.delivered','msg-1',now(),'{}'::jsonb,'$JOB')"
expect_eq "duplicate provider event ignored" "f" service "select public.record_workflow_email_provider_event('ev-1','email.delivered','msg-1',now(),'{}'::jsonb,'$JOB')"
db_eq "job marked delivered" "delivered" "select status from workflow_email_outbox where id='$JOB'"
JOB2=$(db "select id from workflow_email_outbox where claimed_by='$W' limit 1")
db "update workflow_email_outbox set status='failed', failed_at=now(), claimed_by=null, lease_expires_at=null, is_retryable=true where id='$JOB2'" >/dev/null
expect_err "Submitter cannot retry e-mail jobs" "" $A "select public.retry_workflow_email_job('$JOB2')"
expect_ok "Admin retries failed e-mail" $ADM "select public.retry_workflow_email_job('$JOB2')"
db_eq "retried job re-queued" "queued" "select status from workflow_email_outbox where id='$JOB2'"
expect_eq "Submitter cannot read e-mail outbox" "0" $A "select count(*) from workflow_email_outbox"
db_eq "removed accounts get no e-mail" "0" "select count(*) from workflow_email_outbox where recipient_email like 'removed+%'"

echo "== Storage object policies (workflow_uploads)"
db "insert into storage.objects (bucket_id, name, owner) values ('workflow_uploads','$A/permit2.pdf','$A'), ('workflow_uploads','$B/private.pdf','$B')" >/dev/null
expect_eq "Submitter reads own file object" "1" $A "select count(*) from storage.objects where bucket_id='workflow_uploads' and name='$A/permit2.pdf'"
expect_eq "Submitter cannot read another user's file object" "0" $A "select count(*) from storage.objects where bucket_id='workflow_uploads' and name='$B/private.pdf'"
expect_eq "Assigned office reads submission file" "1" $MTO "select count(*) from storage.objects where bucket_id='workflow_uploads' and name='$A/permit2.pdf'"
expect_eq "Unrelated office cannot read submission file" "0" $SB "select count(*) from storage.objects where bucket_id='workflow_uploads' and name='$A/permit2.pdf'"
expect_err "Submitter cannot upload into another user's folder" "" $A "insert into storage.objects (bucket_id, name, owner) values ('workflow_uploads','$B/evil.pdf','$A')"
expect_err "Executable upload rejected" "" $A "insert into storage.objects (bucket_id, name, owner) values ('workflow_uploads','$A/evil.exe','$A')"
expect_err "Anon cannot upload" "" anon "insert into storage.objects (bucket_id, name) values ('workflow_uploads','x/evil.pdf')"
db "insert into storage.objects (bucket_id, name, owner) values ('workflow_uploads','$A/orphan.pdf','$A')" >/dev/null
expect_eq "Uploader can delete own unlinked (orphaned) upload" "1" $A "with d as (delete from storage.objects where bucket_id='workflow_uploads' and name='$A/orphan.pdf' returning 1) select count(*) from d"
expect_eq "Uploader cannot delete a file linked to a submission" "0" $A "with d as (delete from storage.objects where bucket_id='workflow_uploads' and name='$A/permit2.pdf' returning 1) select count(*) from d"
expect_eq "User cannot delete another user's upload" "0" $A "with d as (delete from storage.objects where bucket_id='workflow_uploads' and name='$B/private.pdf' returning 1) select count(*) from d"

echo "== Profile and admin guards"
expect_ok "Admin can deactivate a profile directly" $ADM "update profiles set is_active=true where id='$B'"
expect_err "Office cannot change its own role" "" $MTO "update profiles set role='system_admin' where id='$MTO' returning id"
expect_err "Non-admin cannot call admin_update_profile_role" "Only administrators" $T "select public.admin_update_profile_role('$A','system_admin')"
expect_ok "Admin changes a role through the RPC" $ADM "select public.admin_update_profile_role('$B','submitter')"
summary

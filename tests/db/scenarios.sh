#!/bin/bash
# End-to-end workflow, RLS and security scenarios against the replayed schema.
cd "$(dirname "$0")"; source ./lib.sh
db "$(cat seed.sql)" >/dev/null
A=11111111-1111-1111-1111-111111111111; B=22222222-2222-2222-2222-222222222222
T=33333333-3333-3333-3333-333333333333; ADM=44444444-4444-4444-4444-444444444444
MTO=55555555-5555-5555-5555-555555555555; SB=66666666-6666-6666-6666-666666666666; MAY=77777777-7777-7777-7777-777777777777
submit() { # submit <user> <office> <doctype> <title>
  as $1 "select id from public.create_workflow_submission('$4', '$1/$4.pdf', null, 'application/pdf', 1000, '$3', 'Description for $4', null, null, null, '$2', '[]'::jsonb, $( [ "$3" = Other ] && echo "'Custom type'" || echo null ))" | grep -E '^[0-9a-f-]{36}' | head -1
}
status() { db "select status||'|'||coalesce(selected_office_role,'-') from workflow_submissions where id='$1'"; }
notif() { db "select count(*) from workflow_notifications where recipient_id='$1' and submission_id='$2' ${3:+and event_type='$3'}"; }

echo "== S1 direct submission to MTO, approve (final decision)"
S1=$(submit $A municipal_treasurer "Business Permit Fees" permit1)
[ -n "$S1" ] && ok "S1 submitter creates MTO request" || bad "S1 submitter creates MTO request" "no id"
db_eq "S1 status pending_office at MTO" "pending_office|municipal_treasurer" "select status||'|'||selected_office_role from workflow_submissions where id='$S1'"
db_eq "S1 MTO notified of new request" "1" "select count(*) from workflow_notifications where recipient_id='$MTO' and submission_id='$S1'"
db_eq "S1 Tourism Officer NOT notified of direct office request" "0" "select count(*) from workflow_notifications where recipient_id='$T' and submission_id='$S1'"
db_eq "S1 Tourism Officer not on any route for direct request" "0" "select count(*) from workflow_routing_plans where submission_id='$S1'"
expect_eq "S1 MTO can see the request" "1" $MTO "select count(*) from workflow_submissions where id='$S1'"
expect_eq "S15 SB cannot see MTO's direct request" "0" $SB "select count(*) from workflow_submissions where id='$S1'"
expect_eq "S15 Mayor cannot see MTO's direct request" "0" $MAY "select count(*) from workflow_submissions where id='$S1'"
expect_ok "S1 MTO uploads supporting document" $MTO "select public.add_workflow_office_supporting_document('$S1','assessment.pdf','$MTO/$S1/office-support/a.pdf','application/pdf',500)"
db_eq "S1 submitter notified of office document upload" "1" "select count(*) from workflow_notifications where recipient_id='$A' and submission_id='$S1' and event_type='OFFICE_SUPPORTING_DOCUMENT_UPLOADED'"
expect_ok "S1 MTO final approval (finalize_workflow_submission)" $MTO "select public.finalize_workflow_submission('$S1','Approved by MTO')"
db_eq "S1 status completed" "completed" "select status from workflow_submissions where id='$S1'"
db_eq "S11 submitter notified of completion" "1" "select count(*) from workflow_notifications where recipient_id='$A' and submission_id='$S1' and event_type in ('WORKFLOW_COMPLETED')"
db_eq "S12 completion email queued for submitter" "1" "select count(*) from workflow_email_outbox o join workflow_notifications n on n.id=o.notification_id where n.recipient_id='$A' and n.submission_id='$S1' and n.event_type='WORKFLOW_COMPLETED' and o.status='queued'"

echo "== S13 QR generation & scan for a direct-office request"
expect_ok "S13 submitter generates retrieval QR for completed direct request" $A "select retrieval_token from public.create_workflow_retrieval_qr('$S1')"
TOK=$(db "select qr_token from workflow_document_retrievals where submission_id='$S1'")
if [ -n "$TOK" ]; then
  expect_ok "S13 MTO scans QR" $MTO "select request_reference from public.get_workflow_retrieval_by_token('$TOK')"
  expect_ok "S13 MTO updates physical location" $MTO "select public.update_workflow_document_location('$S1','Records','Room 2','Cab A','Shelf 1','Drawer 3','Box 9')"
  expect_err "S13 Mayor (other office) cannot scan MTO QR" "different municipal office" $MAY "select * from public.get_workflow_retrieval_by_token('$TOK')"
  expect_err "S13 Submitter cannot scan QR" "Only authorized" $A "select * from public.get_workflow_retrieval_by_token('$TOK')"
  expect_err "S13 Anonymous cannot scan QR" "" anon "select * from public.get_workflow_retrieval_by_token('$TOK')"
  expect_err "S13 Submitter cannot read retrieval rows directly" "" $B "select count(*) from workflow_document_retrievals" 
  expect_ok "S13 MTO releases document after ID verification" $MTO "select public.release_workflow_document('$S1', true)"
else bad "S13 QR token created" "no token"; fi

echo "== S2 direct to Sangguniang Bayan, return for requirements, respond, reject"
S2=$(submit $A sangguniang_bayan "Proposed Resolutions" reso1)
db_eq "S2 status pending_office at SB" "pending_office|sangguniang_bayan" "select status||'|'||selected_office_role from workflow_submissions where id='$S2'"
expect_ok "S16 SB returns for additional requirements" $SB "select public.request_workflow_submission_changes('$S2','Please attach the barangay endorsement')"
db_eq "S16 status returned_for_requirements" "returned_for_requirements" "select status from workflow_submissions where id='$S2'"
db_eq "S16 submitter receives exactly one 'requirements requested' notification" "1" "select count(*) from workflow_notifications where recipient_id='$A' and submission_id='$S2' and title='Additional requirements requested'"
expect_ok "S16 submitter responds with revised file" $A "select public.respond_to_workflow_submission_changes('$S2','Attached endorsement','$A/reso1-v2.pdf','https://x.supabase.co/storage/v1/object/public/workflow_uploads/$A/reso1-v2.pdf','reso1 v2','application/pdf',1200)"
db_eq "S16 back to pending_office at SB" "pending_office|sangguniang_bayan" "select status||'|'||selected_office_role from workflow_submissions where id='$S2'"
db_eq "S16 SB notified of resubmission" "1" "select (count(*)>0)::int from workflow_notifications where recipient_id='$SB' and submission_id='$S2' and created_at >= (select max(created_at) from workflow_audit_logs where submission_id='$S2' and action_type='ROUTE_REQUIREMENTS_REQUESTED')"
expect_ok "S16 SB rejects with reason" $SB "select public.decide_workflow_submission('$S2','declined_by_office','Not within SB jurisdiction',null)"
db_eq "S16 status declined_by_office" "declined_by_office" "select status from workflow_submissions where id='$S2'"
db_eq "S16 submitter notified of rejection" "1" "select count(*) from workflow_notifications where recipient_id='$A' and submission_id='$S2' and event_type='OFFICE_REJECTED'"

echo "== S3 direct to Mayor's Office, approve"
S3=$(submit $B mayor_office "Executive Requests" exec1)
db_eq "S3 status pending_office at Mayor" "pending_office|mayor_office" "select status||'|'||selected_office_role from workflow_submissions where id='$S3'"
expect_ok "S3 Mayor approves" $MAY "select public.finalize_workflow_submission('$S3','Approved')"
db_eq "S3 status completed" "completed" "select status from workflow_submissions where id='$S3'"

echo "== S4 Tourism Office request routed to MTO + Mayor for approval, then Tourism completion"
S4=$(submit $A tourism_officer Other tour1)
db_eq "S4 status pending_approver" "pending_approver|-" "select status||'|'||coalesce(selected_office_role,'-') from workflow_submissions where id='$S4'"
db_eq "S4 Tourism Officer notified" "1" "select (count(*)>0)::int from workflow_notifications where recipient_id='$T' and submission_id='$S4'"
expect_ok "S4 Tourism routes to MTO then Mayor" $T "select public.route_tourism_submission_to_municipal_offices('$S4','[{\"office_role\":\"municipal_treasurer\",\"responsibility\":\"evaluation_verification\"},{\"office_role\":\"mayor_office\",\"responsibility\":\"mandatory_approval_clearance\"}]'::jsonb,'sequential','Please evaluate')"
db_eq "S4 active at MTO" "pending_office|municipal_treasurer" "select status||'|'||selected_office_role from workflow_submissions where id='$S4'"
expect_err "S4 Mayor cannot decide before MTO" "" $MAY "select public.decide_tourism_submission_route_step('$S4', true, 'early')"
expect_ok "S4 MTO approves its step" $MTO "select public.decide_tourism_submission_route_step('$S4', true, 'Assessment OK')"
db_eq "S4 active at Mayor" "pending_office|mayor_office" "select status||'|'||selected_office_role from workflow_submissions where id='$S4'"
expect_ok "S4 Mayor approves its step" $MAY "select public.decide_tourism_submission_route_step('$S4', true, 'Cleared')"
db_eq "S4 back with Tourism Officer" "pending_approver" "select status from workflow_submissions where id='$S4'"
expect_ok "S4 Tourism completes" $T "select public.complete_routed_tourism_submission('$S4','Approved')"
db_eq "S4 completed" "completed" "select status from workflow_submissions where id='$S4'"
expect_ok "S13b QR available for routed Tourism request" $A "select retrieval_token from public.create_workflow_retrieval_qr('$S4')"

echo "== S5-S9 inter-office requests"
for pair in "municipal_treasurer:$MTO:mayor_office:$MAY:assessment_report" "sangguniang_bayan:$SB:municipal_treasurer:$MTO:" "mayor_office:$MAY:sangguniang_bayan:$SB:"; do
  IFS=: read FROM FU TO TU REQ <<< "$pair"
  REQARR=$( [ -n "$REQ" ] && echo "array['$REQ',null]::text[]" || echo "array[null,null]::text[]" )
  RID=$(as $FU "select public.create_interoffice_request('Request from $FROM','Permit','Please review',array['$FROM','$TO'],$REQARR,null)" | grep -E '^[0-9a-f-]{36}' | head -1)
  [ -n "$RID" ] && ok "S5-7 $FROM creates inter-office request to $TO" || { bad "S5-7 $FROM creates inter-office request to $TO" "$LAST"; continue; }
  expect_eq "S15 SB/other office cannot see unrelated request ($FROM->$TO)" "0" $( [ "$FROM" != sangguniang_bayan ] && [ "$TO" != sangguniang_bayan ] && echo $SB || echo $B ) "select count(*) from workflow_interoffice_requests where id='$RID'"
  expect_ok "S5-7 $FROM starts review" $FU "select public.start_interoffice_review('$RID')"
  if [ -n "$REQ" ]; then
    expect_eq "S8 forward blocked until assessment report uploaded" "awaiting_supporting_document" $FU "select public.forward_interoffice_request('$RID','Forwarding')"
    STEP=$(db "select id from workflow_interoffice_steps where request_id='$RID' and sequence_number=1")
    expect_ok "S8 $FROM uploads assessment report" $FU "insert into workflow_interoffice_documents (request_id, step_id, uploaded_by, uploading_office, document_type, file_name, file_path, file_type, file_size) values ('$RID','$STEP','$FU','$FROM','assessment_report','assessment.pdf','$RID/$FU/assessment.pdf','application/pdf',2048)"
  fi
  expect_eq "S8/S9 $FROM forwards to $TO" "forwarded" $FU "select public.forward_interoffice_request('$RID','Forwarding')"
  db_eq "S8/S9 $TO notified of forwarded request" "1" "select (count(*)>0)::int from workflow_notifications where recipient_id='$TU' and interoffice_request_id='$RID'"
  expect_ok "S5-7 $TO starts review" $TU "select public.start_interoffice_review('$RID')"
  expect_eq "S5-7 $TO approves (final office)" "completed" $TU "select public.decide_interoffice_request('$RID','approve','Approved')"
done

echo "== S10 messaging"
expect_ok "S10 submitter sends message on own request" $A "insert into workflow_messages (submission_id, sender_id, body) values ('$S1','$A','Hello MTO')"
expect_ok "S10 MTO replies" $MTO "insert into workflow_messages (submission_id, sender_id, body) values ('$S1','$MTO','Hello, received')"
db_eq "S10 submitter notified of new message" "1" "select (count(*)>0)::int from workflow_notifications where recipient_id='$A' and submission_id='$S1' and event_type like '%MESSAGE%'"
expect_eq "S14 other submitter cannot read the conversation" "0" $B "select count(*) from workflow_messages where submission_id='$S1'"
expect_err "S14 other submitter cannot post into the conversation" "" $B "insert into workflow_messages (submission_id, sender_id, body) values ('$S1','$B','spam')"
expect_eq "S15 unrelated office cannot read the conversation" "0" $SB "select count(*) from workflow_messages where submission_id='$S1'"
expect_err "S10 sender spoofing blocked" "" $A "insert into workflow_messages (submission_id, sender_id, body) values ('$S1','$MTO','fake')"

echo "== S14 cross-user access"
expect_eq "S14 submitter B cannot read A's request" "0" $B "select count(*) from workflow_submissions where id='$S1'"
expect_eq "S14 submitter B cannot read A's audit log" "0" $B "select count(*) from workflow_audit_logs where submission_id='$S1'"
expect_eq "S14 submitter B cannot read A's notifications" "0" $B "select count(*) from workflow_notifications where recipient_id='$A'"
expect_eq "S14 submitter B sees no attachments of A" "0" $B "select count(*) from workflow_submission_attachments where submission_id='$S1'"
expect_err "S14 B cannot generate QR for A's request" "" $B "select * from public.create_workflow_retrieval_qr('$S1')"

echo "== SEC direct table writes that bypass the RPC workflow"
S5=$(submit $A municipal_treasurer "Official Receipts" or1)
B_FILE=$(db "select file_path from workflow_submissions where id='$S3'")
expect_blocked "SEC submitter cannot repoint own request file_path to another user's file" $A "update workflow_submissions set file_path='$B_FILE' where id='$S5' returning id"
db_eq "SEC file_path unchanged" "$A/or1.pdf" "select file_path from workflow_submissions where id='$S5'"
expect_blocked "SEC submitter cannot reroute request to another office directly" $A "update workflow_submissions set selected_office_role='mayor_office', initial_destination_role='mayor_office' where id='$S5' returning id"
db_eq "SEC office unchanged" "municipal_treasurer" "select selected_office_role from workflow_submissions where id='$S5'"
expect_blocked "SEC office cannot rewrite request owner/content directly" $MTO "update workflow_submissions set description='tampered' where id='$S5' returning id"
expect_blocked "SEC submitter cannot self-complete via direct status update" $A "update workflow_submissions set status='completed' where id='$S5' returning id"
expect_err "SEC submitter cannot change own profile role" "" $A "update profiles set role='system_admin' where id='$A' returning id"
expect_err "SEC submitter cannot change own notification email address" "" $A "update profiles set email='victim@example.com' where id='$A' returning id"
expect_ok "SEC submitter can still update own name" $A "update profiles set full_name='Submitter A.' where id='$A'"
expect_err "SEC anon cannot burn tracking numbers" "" anon "select public.generate_workflow_tracking_number()"
expect_err "SEC authenticated cannot write tracking sequence table" "" $A "update workflow_tracking_sequences set last_sequence=999999 returning 1"
expect_err "SEC user cannot rewrite own notification content" "" $A "update workflow_notifications set title='x' where recipient_id='$A' returning id"
expect_ok "SEC user can mark own notification read" $A "update workflow_notifications set read_at=now() where recipient_id='$A'"
expect_ok "SEC admin can still archive" $ADM "select id from public.set_workflow_submission_archive('$S2', true, null)"
expect_err "SEC anon cannot read submissions" "" anon "select count(*) from workflow_submissions; select 1/0"
db_eq "EMAIL links for system_admin point to admin page" "1" "select (count(*)>0)::int from workflow_email_outbox o join profiles p on p.id=o.recipient_id where p.role='system_admin' and o.action_path like '/workflow/admin/submissions/%'"
db_eq "EMAIL links for tourism_officer point to file management" "1" "select (count(*)>0)::int from workflow_email_outbox o join profiles p on p.id=o.recipient_id where p.role='tourism_officer' and o.action_path like '/workflow/approver/file_management/%'"
summary

# ISO/IEC 25010 Local Evaluation Checklist

Use the local application:

```text
http://localhost:3000/login
```

Use separate test accounts for:

- Regular user
- Approver
- Administrator

Because the local application uses Supabase, use test accounts and test documents only.

Record each test as **Pass**, **Fail**, or **N/A**.

---

## 1. Functional Suitability

### User functions

- [x] User can log in and reach the user dashboard.
- [x] User can upload a valid document.
- [x] A tracking number is generated in the format `DAET-YYYY-000001`.
- [x] The upload success message displays the tracking number.
- [x] User can view their own submissions in File Registry.
- [x] User can search by tracking number.
- [x] User can search by filename.
- [x] User detail page shows status, tracking number, metadata, and receipt.
- [x] User can print a receipt containing the tracking number.
- [x] User notifications show the tracking number and workflow stage.

### Approver functions

- [x] Approver can log in.
- [x] Approver can view the verification queue.
- [x] Approver can search by tracking number.
- [x] Approver can verify a document: `pending` -> `pending_admin`.
- [x] Approver can return a document: `pending` -> `declined_by_approver`.
- [x] Approver comments are saved and visible in the timeline.
- [x] Approver can view audit history.
- [x] Approver notifications show the tracking number and workflow stage.

### Administrator functions

- [x] Administrator can log in.
- [x] Administrator can view pending approvals.
- [x] Administrator can approve: `pending_admin` -> `approved`.
- [x] Administrator can complete: `approved` -> `completed`.
- [x] Administrator can reject: `pending_admin` -> `declined_by_admin`.
- [x] Administrator can view audit history.
- [x] Administrator can open Reports.
- [x] Administrator can filter reports by date.
- [x] Administrator can export a CSV report.
- [x] Exported CSV contains tracking numbers.
- [x] Administrator can manage user roles.

---

## 2. Complete Workflow Test

Use a new test document and record its tracking number.

Expected successful path:

```text
pending
-> pending_admin
-> approved
-> completed
```

| Stage | Expected status | Actual status | Result |
|---|---|---|---|
| Upload | `pending` |  |  |✅
| Approver verifies | `pending_admin` |  |  |✅
| Administrator approves | `approved` |  |  |✅
| Administrator completes | `completed` |  |  |✅

Expected audit events:

```text
SUBMITTED
VERIFICATION_PASSED
FINAL_APPROVAL
WORKFLOW_COMPLETED
```

Query the audit history using the real tracking number:

```sql
select
  s.tracking_number,
  s.file_name,
  s.status,
  l.action_type,
  l.old_status,
  l.new_status,
  l.comments,
  l.created_at
from public.workflow_audit_logs l
join public.workflow_submissions s
  on s.id = l.submission_id
where s.tracking_number = 'DAET-2026-000018'
order by l.created_at asc;
```

Replace `YOUR_TRACKING_NUMBER` with a value such as `DAET-2026-000012`.

---

## 3. Rejection and Correction Tests

### Approver return path

```text
pending
-> declined_by_approver
```

- [x] Approver can return a document.
- [x] Display shows `RETURNED FOR CORRECTION`.
- [x] Approver's reason is visible to the user.
- [x] User notification shows the tracking number.
- [x] Audit event `RETURNED_FOR_CORRECTION` is recorded.

### Administrator rejection path

```text
pending
-> pending_admin
-> declined_by_admin
```

- [x] Administrator can reject a pending approval.
- [x] Display shows `REJECTED`.
- [x] Administrator's reason is saved.
- [x] User can see the rejection.
- [x] Audit event `FINAL_REJECTION` is recorded.

---

## 4. Performance Efficiency

Record each result in seconds.

| Measurement | Result |
|---|---:|
| Login page load |  |2 sec
| Login completion |  |1-2 sec
| User dashboard load |  |2 sec
| File Registry load |  |1 sec
| Approver queue load |  |1 sec
| Administrator dashboard load |  |1 sec
| Reports page load |  |1 sec
| Small document upload |  |1-2 sec
| Large document upload |  |2-4 sec
| CSV export |  |1 sec

Suggested interpretation:

- Under 2 seconds: Excellent
- 2-4 seconds: Acceptable
- 4-7 seconds: Needs review
- Over 7 seconds: Performance concern

---

## 5. Usability Evaluation

### User task

```text
Log in -> Upload document -> Find tracking number -> Search File Registry -> Print receipt
```

### Approver task

```text
Log in -> Find pending document -> Verify or return document -> Add comment -> Check audit history
```

### Administrator task

```text
Log in -> Find pending approval -> Approve -> Mark completed -> Open Reports -> Export CSV
```

| Role | Task completed? | Time | Errors | User comments |
|---|---|---:|---|---|
| User | ✅ |1-2  |none  |  can comment
| Approver | ✅ | 1-2 | none |can comment  |
| Administrator | ✅ | 1-2 | none | can comment |

Ask each tester:

1. Was the next action easy to identify?
2. Was the tracking number easy to find?
3. Were the status labels understandable?
4. Were any buttons or pages confusing?
5. What should be improved?

---

## 6. Reliability

- [x] Refresh after upload; submission remains saved.
- [x] Refresh after approval; updated status remains visible.
- [x] Refresh after completion; `COMPLETED` remains visible.
- [x] Reopen Notifications; notifications remain available.
- [x] Open a detail page directly; correct submission loads.
- [x] Submit two documents quickly; both receive unique tracking numbers.
- [x] Search an existing tracking number; correct record appears.
- [x] Search a nonexistent tracking number; no incorrect record appears.
- [x] Refresh during loading; page recovers or displays an error.
- [x] Audit event exists after each workflow transition.

Check duplicate tracking numbers:

```sql
select
  tracking_number,
  count(*) as total
from public.workflow_submissions
group by tracking_number
having count(*) > 1;
```

Expected result: **0 rows**.

Check missing tracking numbers:

```sql
select count(*) as missing_tracking_numbers
from public.workflow_submissions
where tracking_number is null
   or btrim(tracking_number) = '';
```

Expected result: **0**.

---

## 7. Security

- [x] User opening `/workflow/admin` is redirected or denied.
- [x] User opening `/workflow/approver` is redirected or denied.
- [x] Approver opening an admin page is redirected or denied.
- [ ] User cannot view another user's submission.
- [ ] User cannot change another user's status.
- [x] User cannot mark a document completed.
- [x] Approver cannot approve a `pending_admin` document.
- [x] Approver cannot complete a document.
- [x] Administrator can complete an approved document.
- [x] Completed document cannot move backward.
- [x] Rejected document cannot change without resubmission.
- [ ] Unauthenticated user is redirected to login.

Verify RLS:

```sql
select
  schemaname,
  tablename,
  rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename in (
    'profiles',
    'workflow_submissions',
    'workflow_audit_logs'
  )
order by tablename;
```

Expected result: `true` for all three tables.

---

## 8. Maintainability

- [x] Tracking-number generation is database-side.
- [x] Tracking-number format is documented.
- [x] Migrations are ordered and readable.
- [x] Workflow transitions are database-enforced.
- [x] Audit logging is centralized.
- [x] Status labels are consistent.
- [x] Production build succeeds.
- [x] No unintended files are included.
- [x] Environment variables are not committed.

Run:

```cmd
npm run build
```

Expected output includes:

```text
Compiled successfully
Finished TypeScript
```

Record lint separately because the current project has existing lint errors.

---

## 9. Portability

### Local environment

- [x] `npm install` completes.
- [x] `npm run dev` starts.
- [x] `/login` loads.
- [x] Supabase connection works.
- [x] Upload works locally.
- [x] Reports work locally.
- [x] `npm run build` succeeds.

### Vercel

Complete after deployment:

- [ ] Deployment succeeds.
- [ ] Vercel status is Ready.
- [ ] Production login works.
- [ ] Production Supabase connection works.
- [ ] Tracking numbers display.
- [ ] Workflow transitions work.
- [ ] Reports load.
- [ ] CSV export works.

---

## Final Evaluation Summary

| Quality characteristic | Pass/Fail | Evidence |
|---|---|---|
| Functional suitability |  | Completed workflow and feature checklist |
| Performance efficiency |  | Timing results |
| Usability |  | User task results and feedback |
| Reliability |  | Refresh, duplicate, audit, and recovery tests |
| Security |  | RLS and invalid-transition tests |
| Maintainability |  | Build and code-structure review |
| Portability |  | Local build and later Vercel verification |

The ISO/IEC 25010 evaluation can be marked complete when every category has a result and supporting evidence.

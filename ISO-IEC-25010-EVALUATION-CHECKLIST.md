# CONNECT-Daet System Test and ISO/IEC 25010 Evaluation Checklist

Use this checklist for a fresh test pass after deploying the current branch. It covers local and production checks for the user, approver, and administrator workflows.

## Test information

| Field | Value |
|---|---|
| Tester | |
| Test date | |
| Application version / commit | |
| Environment (local / preview / production) | |
| Browser and version | |
| Supabase migration status checked | |

Use dedicated test accounts and test documents. Do not use real confidential documents or alter production workflow data to simulate overdue records.

For each test, record **Pass**, **Fail**, or **N/A**, and attach evidence or a short note.

---

## 1. Environment and build

- [ ] `.env.local` exists locally and is ignored by Git.
- [ ] No API keys or service-role credentials are committed.
- [ ] Supabase migrations required for the tested features have been applied.
- [ ] `npm run build` completes successfully.
- [ ] `npm run dev` starts successfully for local testing.
- [ ] Login page loads and Supabase authentication works.
- [ ] Vercel deployment is Ready (when testing a deployment).

Build evidence / notes:

| Check | Result / evidence |
|---|---|
| Production build | |
| Local server | |
| Deployment URL and status | |

---

## 2. User workflow

Use a regular user account.

- [ ] User can log in and reach the user dashboard.
- [ ] User can upload an allowed file and choose a category.
- [ ] A tracking number is generated in `DAET-YYYY-######` format.
- [ ] Upload confirmation displays the tracking number.
- [ ] New submission starts in verification (`pending` or `pending_approver`).
- [ ] User can see their own document in the registry.
- [ ] User can search by filename and tracking number.
- [ ] User can filter by status, category, file type, and submission-date range.
- [ ] User can open the document preview without an automatic download.
- [ ] Explicit Download action downloads the file.
- [ ] User can view current status and workflow history.
- [ ] User can view and acknowledge notifications.
- [ ] User can print a receipt showing the correct tracking number and submission details.

Test tracking number: ____________________

---

## 3. Approver workflow

Use an approver account. The system intentionally uses an **unassigned approver team**; no individual assignment is expected.

- [ ] Approver can log in and access the approver workspace.
- [ ] Approver can find submissions waiting for verification.
- [ ] Registry search and category, file type, and date filters work.
- [ ] Timing badge and due-soon/overdue state display for active verification items.
- [ ] Responsible role is understood as the Approver Team, not a particular assigned person.
- [ ] Approver can preview authorized documents without automatic download.
- [ ] Approver can explicitly download an authorized document.
- [ ] Approver can verify a document, moving it to `pending_admin`.
- [ ] Approver can return a document for correction with a comment.
- [ ] Returned status and comment are visible to the submitter.
- [ ] Approver can view relevant workflow audit history.
- [ ] Approver receives an in-app notification for a new submission or returned document.

---

## 4. Administrator workflow

Use an administrator account.

- [ ] Administrator can access the administrator workspace.
- [ ] Administrator can find submissions and use filename, tracking number, requester, status, category, file type, and date filters where available.
- [ ] Administrator can preview authorized documents without automatic download.
- [ ] Administrator can explicitly download authorized documents.
- [ ] Administrator can approve a verified submission (`pending_admin` -> `approved`).
- [ ] Administrator can reject a pending approval with an explanatory comment.
- [ ] Administrator can mark an approved submission completed (`approved` -> `completed`).
- [ ] Status, comments, actor, and timestamps appear in the workflow history.
- [ ] Administrator receives relevant in-app notifications.
- [ ] Administrator can archive and restore a record using the intended retention date.
- [ ] Archive and restore actions appear in the audit history.
- [ ] Archive Registry search, archived-date filtering, retention display, and restore action work.

---

## 5. End-to-end workflow and audit trail

Create a new test submission and record its tracking number:

```text
Submission -> Verification -> Approval -> Completion
```

| Action | Expected status | Actual status | Pass / Fail |
|---|---|---|---|
| Submit document | `pending` / `pending_approver` | | |
| Approver verifies | `pending_admin` | | |
| Administrator approves | `approved` | | |
| Administrator completes | `completed` | | |

Expected audit events:

```text
SUBMITTED
VERIFICATION_PASSED
FINAL_APPROVAL
WORKFLOW_COMPLETED
```

- [ ] Each transition has exactly the expected event and actor.
- [ ] Refreshing the page preserves the final status and history.
- [ ] A returned-for-correction path can be tested separately.
- [ ] Invalid role/status transitions are rejected by the database.

Audit query (replace the tracking number):

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
from public.workflow_audit_logs as l
join public.workflow_submissions as s on s.id = l.submission_id
where s.tracking_number = 'DAET-YYYY-000001'
order by l.created_at asc;
```

---

## 6. Stage timestamps, responsibility, and deadlines

- [ ] Newly submitted record has `submitted_at`.
- [ ] Verification sets `verified_at` and starts the administrator stage.
- [ ] Approval sets `approved_at` and starts the completion stage.
- [ ] Completion sets `completed_at` and clears the active deadline/responsibility.
- [ ] Verification stage responsibility is `approver`.
- [ ] Approval/completion responsibility is `admin`.
- [ ] Returned/rejected/completed records do not show an active deadline unless product rules specify otherwise.
- [ ] UI shows `On Time`, `Due Soon`, or `Overdue` correctly.
- [ ] Administrator report overdue count and stage breakdown match the active records.

Current default deadline policy to verify:

| Active stage | Target | Due soon threshold |
|---|---:|---:|
| Verification | 2 calendar days | Within 24 hours of due time |
| Approval | 2 calendar days | Within 24 hours of due time |
| Completion after approval | 1 calendar day | Within 24 hours of due time |

Database spot-check query:

```sql
select
  tracking_number,
  status,
  submitted_at,
  verified_at,
  approved_at,
  completed_at,
  current_stage_started_at,
  current_stage_due_at,
  current_responsible_role
from public.workflow_submissions
order by created_at desc
limit 20;
```

Do not change live records to simulate `Due Soon` or `Overdue`. Use a dedicated non-production test record/environment if testing those states.

---

## 7. Search, reports, and exports

- [ ] Search by tracking number returns the correct record.
- [ ] Search by filename returns the correct record.
- [ ] Requester search works in administrator views where provided.
- [ ] Status, category, file type, and date-range filters combine correctly.
- [ ] Date boundaries include the intended start and end dates.
- [ ] Reports date filters change the displayed totals and summaries.
- [ ] Report status totals reconcile with the filtered records.
- [ ] Total processing duration is plausible for completed records.
- [ ] Verification duration is calculated from submission to verification.
- [ ] Approval duration is calculated from verification to approval.
- [ ] Completion duration is calculated from approval to completion.
- [ ] Overdue count and overdue-by-stage totals reconcile with active overdue records.
- [ ] Category volume totals reconcile with the filtered submissions.
- [ ] Personnel action volume reflects audit actions, not document assignments.
- [ ] CSV downloads only after the explicit export action.
- [ ] CSV includes the expected tracking number, filename, status, dates, and audit count.
- [ ] CSV escaping is correct for commas, quotes, and line breaks in names/comments.

Report notes / discrepancies:

| Metric | Displayed | Independently checked | Result |
|---|---:|---:|---|
| Total submissions | | | |
| Overdue submissions | | | |
| Average total processing time | | | |
| Category counts | | | |
| Personnel action counts | | | |

---

## 8. Notifications and email

### In-app notification history

- [ ] New submission produces in-app notifications for the intended recipients.
- [ ] Verification, approval, completion, and return events produce the intended notifications.
- [ ] Notification remains after refresh or sign-in again.
- [ ] Read/unread state updates and persists.
- [ ] Realtime notification appears without manually refreshing (when Realtime is enabled).
- [ ] Notification points to the correct submission and tracking number.
- [ ] Feed may show the latest event per document while database history remains intact.

### Email prerequisites and delivery

- [ ] `workflow_email_outbox` exists in Supabase.
- [ ] Outbox trigger exists and creates a job for a new workflow notification.
- [ ] Vercel has server-only `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, and `CRON_SECRET`.
- [ ] GitHub repository Actions secrets contain `CRON_SECRET` and `VERCEL_APP_URL`.
- [ ] `CRON_SECRET` in GitHub exactly matches Vercel.
- [ ] Resend sender is valid for the account; testing sender recipient restrictions are understood.
- [ ] Manual GitHub Actions dispatch calls the Vercel route successfully.
- [ ] Successful delivery sets `sent_at`, increments `attempts`, and clears `last_error`.
- [ ] Failed delivery increments `attempts` and records `last_error`.
- [ ] No-secret request receives HTTP `401`.
- [ ] Scheduled workflow runs from the repository default branch.
- [ ] Email timing meets the project’s expected service level.

Outbox check:

```sql
select
  recipient_email,
  subject,
  attempts,
  sent_at,
  last_error,
  created_at
from public.workflow_email_outbox
order by created_at desc
limit 20;
```

Email delivery remains **not production-ready** until sender/domain and actual delivery to intended recipients have been verified.

---

## 9. Private storage and archive security

Use separate user accounts and test-only files.

- [ ] `workflow_uploads` bucket is private.
- [ ] New upload stores `file_path`; it does not generate a public URL.
- [ ] User can access their own file.
- [ ] User cannot access another user’s file by changing the submission ID.
- [ ] Approver can access workflow documents as permitted by policy.
- [ ] Administrator can access workflow documents as permitted by policy.
- [ ] Logged-out user cannot use the protected file endpoint.
- [ ] Unauthorized user receives a denial/not-found response, not file content.
- [ ] Authorized preview URL is short-lived and does not expose a permanent public URL.
- [ ] Image/PDF/CSV previews render inline as supported.
- [ ] Opening a preview does not automatically download the file.
- [ ] Explicit Download action still downloads the file.
- [ ] Archived rows are hidden from non-admin users and approvers.
- [ ] Administrator can find and restore archived records.
- [ ] Retention date is treated as metadata; no automatic deletion is assumed unless separately implemented and approved.

Do not paste signed URLs, credentials, or private document URLs into evidence.

---

## 10. Security and authorization

- [ ] Unauthenticated user is redirected to login on protected pages.
- [ ] Regular user cannot access administrator pages.
- [ ] Regular user cannot access approver pages.
- [ ] Approver cannot access administrator-only actions.
- [ ] User cannot read another user’s submission through the UI or Supabase API.
- [ ] User cannot change another user’s status.
- [ ] Approver cannot approve or complete a document.
- [ ] Administrator can only perform valid transitions.
- [ ] Invalid direct database/API transition is rejected by workflow rules.
- [ ] RLS is enabled on workflow tables and policies match the intended roles.
- [ ] Service-role credential is used server-side only.
- [ ] `.env.local` is ignored and is not present in the PR/commit.
- [ ] No secrets or signed URLs appear in browser-visible source, logs, or screenshots.

RLS inspection query:

```sql
select schemaname, tablename, rowsecurity
from pg_tables
where schemaname in ('public', 'storage')
  and tablename in (
    'profiles',
    'workflow_submissions',
    'workflow_audit_logs',
    'workflow_notifications',
    'workflow_email_outbox',
    'objects'
  )
order by schemaname, tablename;
```

---

## 11. Reliability and compatibility

- [ ] Refresh during a normal page load; the page recovers or reports an error.
- [ ] Reopen a submission detail page directly; the correct record loads.
- [ ] Two rapid test uploads receive distinct tracking numbers.
- [ ] Failed notification/email is visible and can be retried according to the configured process.
- [ ] Duplicate scheduler invocation does not cause unintended duplicate email delivery.
- [ ] Test a supported image preview.
- [ ] Test a supported PDF preview.
- [ ] Test a CSV preview and explicit download.
- [ ] Test a file type that is not browser-previewable; behavior is understandable and safe.
- [ ] Check responsive layout at desktop and mobile widths.

Tracking-number integrity queries:

```sql
select tracking_number, count(*) as total
from public.workflow_submissions
group by tracking_number
having count(*) > 1;
```

Expected: **0 rows**.

```sql
select count(*) as missing_tracking_numbers
from public.workflow_submissions
where tracking_number is null or btrim(tracking_number) = '';
```

Expected: **0**.

---

## 12. Performance and usability evidence

Record measured times; avoid pre-filling outcomes before testing.

| Page/action | Measurement (seconds) | Result / notes |
|---|---:|---|
| Login page load | | |
| User dashboard | | |
| User registry and search | | |
| Approver queue | | |
| Administrator registry | | |
| Reports page | | |
| Small-file upload | | |
| Large allowed-file upload | | |
| CSV export | | |
| Document preview | | |

Task completion observations:

| Role | Task completed? | Time | Errors / confusion | Tester notes |
|---|---|---:|---|---|
| User | | | | |
| Approver | | | | |
| Administrator | | | | |

Ask testers:

1. Was the next action easy to identify?
2. Were tracking number and status clear?
3. Was it clear who/which role should act next?
4. Did preview and download behave as expected?
5. What caused confusion or errors?

---

## 13. ISO/IEC 25010 evaluation summary

| Quality characteristic | Pass / Fail / N/A | Evidence reference |
|---|---|---|
| Functional suitability | | |
| Performance efficiency | | |
| Compatibility | | |
| Usability | | |
| Reliability | | |
| Security | | |
| Maintainability | | |
| Portability | | |

Do not mark the evaluation complete until the relevant tests have been run and evidence has been saved.

## 14. Release readiness

- [ ] Required Supabase migrations are applied in order.
- [ ] Production environment variables are configured without exposing secrets.
- [ ] Vercel deployment is Ready.
- [ ] GitHub Actions scheduler is enabled and has a successful run.
- [ ] Workflow tested against production or an approved staging environment.
- [ ] No accidental secrets or local-only files are included in the PR.
- [ ] Build passes on the branch/PR.
- [ ] PR description lists migration and environment setup requirements.
- [ ] Repository owner/reviewer has reviewed and approved the PR.
- [ ] Deployment has been verified after merge.

### Final result

**Overall:** Pass / Fail / Incomplete
**Blocking issues:**
**Evidence location:**
**Tester/date:**

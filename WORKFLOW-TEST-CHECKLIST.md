# CONNECT-Daet Workflow Testing Checklist

Run this checklist in a **staging environment** with the latest workflow
migrations applied, including
[20261106110000_allow_offices_to_request_requirements.sql](./supabase/migrations/20261106110000_allow_offices_to_request_requirements.sql).
Use test accounts for a submitter, approver, admin, Municipal Treasurer,
Sangguniang Bayan, and Mayor. See the
[workflow architecture diagram](./WORKFLOW-ARCHITECTURE.md) for the intended
flow.

## 1. Submit and route a document

- [ ] Confirm the submit form requires a title, classification, request summary,
      and main document, but does not ask for purpose or requested action.
- [ ] Submit a document with those required details and at least one supporting
      file; confirm it is created without purpose or requested-action values.
- [ ] Confirm main documents accept PDF, DOC/DOCX, XLS/XLSX, CSV, PPT/PPTX,
      JPG/JPEG, and PNG.
- [ ] Confirm ZIP is accepted as a supporting attachment, but not as the primary
      document.
- [ ] Try an unsupported file type in the main document and attachment inputs;
      confirm it is rejected.
- [ ] Confirm unsupported file extensions are also rejected by Supabase Storage
      when uploading directly with an allowed MIME type.
- [ ] Confirm ZIP cannot be submitted as the primary document.
- [ ] Confirm it appears in the submitter's registry with a tracking number and
      pending status.
- [ ] Confirm the approver sees it in their queue and receives a notification.
- [ ] Have the approver propose a route with multiple offices.
- [ ] Confirm the admin is notified and can review the proposed route.
- [ ] Have the admin finalize the route; confirm only the first office is active.

## 2. Verify sequential office review

- [ ] Confirm the active office can open the document and its attachments.
- [ ] Confirm an office not currently assigned cannot make a decision.
- [ ] Approve the active step and confirm the next office becomes active.
- [ ] Confirm the previous office still lists the submission in its history and
      can view its own route-step decision and document.
- [ ] Confirm the previous office cannot submit another decision after the
      assignment moves on.
- [ ] Approve all steps and confirm the request returns to the admin for
      completion.
- [ ] Complete it as admin and confirm the submitter sees the completed status.
- [ ] Repeat with a route that omits the Mayor; confirm it completes without a
      Mayor step.
- [ ] If the Mayor is included, confirm the route requires the Mayor to be last.

## 3. Test "Return for requirements" at each office

Run this scenario separately while the Treasurer, Sangguniang Bayan, and Mayor
are each the active office—including an office in the middle of a route.

- [ ] The active office enters a specific requirements request and selects
      **Return for requirements**.
- [ ] Try returning without a reason; confirm the request is blocked and its
      status does not change.
- [ ] Confirm the request enters `returned_for_requirements` and is no longer
      assigned to an office.
- [ ] Confirm the active route step remains in progress, with the requirements
      request recorded.
- [ ] Confirm the submitter sees the request text and can enter a response.
- [ ] Respond with text and attach an additional supporting file.
- [ ] Confirm the request returns to `pending_office` at the **same office
      step**—not the next one.
- [ ] Confirm the response and attachment appear in the submission
      details/history.
- [ ] Confirm the submitter and admin receive the requirements-request
      notification.
- [ ] Have that office approve; confirm normal sequential routing resumes.
- [ ] Repeat the request/response cycle once more on the same step.

## 4. Check validation and access controls

- [ ] Try responding as a different submitter; confirm it is rejected.
- [ ] Try responding when no requirements request is waiting; confirm it is
      rejected.
- [ ] Try an empty response; confirm it is rejected.
- [ ] Confirm an office can request requirements only for a submission currently
      assigned to that office.
- [ ] Confirm response attachments are available to authorized workflow
      participants and inaccessible to unauthorized users.

## 5. Check notifications and rejection paths

- [ ] Confirm new in-app notifications appear without needing a page refresh.
- [ ] Confirm the approver notification status and review count update when a
      submission is approved, completed, routed to an office, or declined.
- [ ] If email delivery is configured, confirm messages are queued and delivered
      by the email worker.
- [ ] Reject a submission as an office with a reason; confirm it is rejected and
      archived as expected.
- [ ] Reject a submission as the approver and as the admin; confirm those
      existing rejection flows still work.
- [ ] Review the activity history and verify submissions, route changes,
      approvals, requirements requests, responses, and rejections are recorded.

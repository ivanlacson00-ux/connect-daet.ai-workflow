# CONNECT-Daet System Testing Checklist

Use this checklist for a complete manual acceptance pass of the application.
Run it in **staging** with test accounts and documents only. Apply all Supabase
migrations in order, including the latest workflow migrations, and configure
email delivery if you intend to test email.

Record each item as **Pass**, **Fail**, or **N/A**. For failures, include the
test account/role, steps, expected result, actual result, and any relevant
tracking number or error message. Do not include passwords, API keys, or other
secrets in test notes.

## Test setup

- [ ] Confirm the app opens at the expected environment URL.
- [ ] Confirm Supabase Auth and database connections are configured for staging.
- [ ] Confirm the required workflow migrations are applied.
- [ ] Confirm the `workflow_uploads` storage bucket and access policies are
      configured.
- [ ] Prepare test accounts for:
  - [ ] Submitter
  - [ ] Approver
  - [ ] Administrator
  - [ ] Municipal Treasurer's Office
  - [ ] Sangguniang Bayan Office
  - [ ] Mayor's Office
- [ ] Confirm each test account has the intended profile role.
- [ ] Prepare disposable documents and supporting files of different supported
      file types and sizes.
- [ ] Prepare supported sample files: PDF, DOC, DOCX, XLS, XLSX, CSV, PPT, PPTX,
      JPG, JPEG, PNG, and ZIP (ZIP for supporting attachments only).
- [ ] Prepare an unsupported file type to verify it is rejected.
- [ ] Record the browser, device, date, environment, and tester.

| Test run | Tester | Date | Environment | Browser/device |
|---|---|---|---|---|
|  |  |  |  |  |

## 1. Access, authentication, and navigation

- [ ] Open the landing page and navigate to sign in and account registration.
- [ ] Register a staging test account if self-registration is enabled.
- [ ] Sign in with valid credentials and confirm the correct role workspace opens.
- [ ] Try invalid credentials and confirm a useful error appears without exposing
      sensitive information.
- [ ] Sign out and confirm protected pages require authentication.
- [ ] Refresh a protected page while signed in and confirm the session behaves
      consistently.
- [ ] Navigate directly to each role's workspace and detail pages.
- [ ] Confirm each role is sent to its appropriate home page after signing in.
- [ ] Confirm a role cannot access another role's workspace actions by changing
      the URL or attempting a direct database/API request.
- [ ] Confirm navigation, page titles, loading states, and empty states are
      understandable.

## 2. Submitter: create and track a submission

- [ ] Open the upload form and verify required fields are clearly identified.
- [ ] Try submitting with required fields missing; confirm submission is blocked
      with useful validation.
- [ ] Submit a valid document with document type, request summary, and optional
      recipient.
- [ ] Confirm a tracking number is generated and shown to the submitter.
- [ ] Upload optional supporting files and confirm they are attached to the
      correct submission.
- [ ] Confirm the main document accepts PDF, DOC/DOCX, XLS/XLSX, CSV, PPT/PPTX,
      JPG/JPEG, and PNG.
- [ ] Confirm supporting attachments also accept ZIP files.
- [ ] Try uploading an unsupported file type as the main document, attachment,
      and requirements-response attachment; confirm it is rejected and no
      incomplete submission or orphaned file is left behind.
- [ ] Try uploading an unsupported extension directly to Storage while claiming
      an allowed MIME type; confirm the Storage policy rejects it.
- [ ] Try creating a primary submission with a ZIP file through the database
      RPC; confirm it is rejected.
- [ ] Confirm the new submission appears in the submitter's registry.
- [ ] Search/filter the registry using available fields such as tracking number
      and filename.
- [ ] Open the submission details and verify metadata, current status, receipt,
      attachments, and history.
- [ ] Download the original document and supporting files as the submitter.
- [ ] Print the submission receipt and confirm the tracking number and submission
      details are legible.

## 3. Approver: review and propose a route

- [ ] Confirm the approver can view newly submitted items in the queue.
- [ ] Search/filter the queue and open a submission.
- [ ] Verify the approver can view submission metadata, files, attachments, and
      history.
- [ ] Propose a route containing multiple offices and confirm the order is saved.
- [ ] Confirm the Mayor's Office can be omitted from the route.
- [ ] Include the Mayor's Office and confirm it is constrained to the final step.
- [ ] Try proposing an empty route; confirm it is rejected.
- [ ] Reject a submission with a reason and confirm the reason is recorded and
      visible to the submitter.
- [ ] Confirm the approver receives the relevant in-app notification for a new
      submission.

## 4. Administrator: review, route, and complete

- [ ] Confirm the administrator dashboard and counts load.
- [ ] Open pending submissions and verify details, proposed route, attachments,
      and history.
- [ ] Finalize a proposed route, including changing its order if needed.
- [ ] Confirm finalization activates only the first office in the route.
- [ ] Reject a submission with a reason and confirm the outcome is visible to the
      submitter.
- [ ] After all route steps approve, complete the submission as administrator.
- [ ] Confirm completion updates the status and appears in submission history.
- [ ] Open the all-submissions view and verify search/filter behavior.
- [ ] Open reports, apply date filters, and verify results match test data.
- [ ] Export a report and confirm the downloaded file opens and contains the
      expected records and tracking numbers.

## 5. Municipal offices: sequential review and decisions

Run this section with the Treasurer, Sangguniang Bayan, and Mayor test accounts.

- [ ] Confirm each office sees the documents assigned to it.
- [ ] Confirm an office cannot decide a submission assigned to another office or
      one that is not currently active.
- [ ] Confirm the office can open the original document and supporting files.
- [ ] Approve a step and confirm the next office becomes active.
- [ ] Confirm a non-final office approval does not complete the entire request.
- [ ] Complete an office route without the Mayor and confirm it returns to the
      administrator after all selected steps approve.
- [ ] Complete a route with the Mayor and confirm the Mayor is the final office
      decision.
- [ ] Reject an active route step with a reason and verify the rejection is
      recorded and visible to the submitter.
- [ ] Confirm office history shows route assignments, decisions, timestamps, and
      comments.

## 6. Requirements request and submitter response

Run this scenario with each office as the active step, including an office in
the middle of a multi-office route.

- [ ] Enter a requirements request and choose **Return for requirements**.
- [ ] Try requesting requirements with no explanation; confirm the action is
      blocked.
- [ ] Confirm the submission is returned to the submitter and the active route
      step remains in progress.
- [ ] Confirm the submitter can see the requesting office's message and enter a
      response.
- [ ] Respond with text and attach an additional supporting file.
- [ ] Confirm the submission returns to the same office step, not the next step.
- [ ] Confirm the response and new attachment are visible in the submission
      details/history.
- [ ] Confirm the office can review the response and continue with approve,
      reject, or another requirements request.
- [ ] Repeat the requirements cycle on the same step.
- [ ] Try responding as another submitter and confirm access is denied.
- [ ] Try responding when no office requirements request is pending and confirm
      the action is denied.

## 7. User management and role assignment

- [ ] Open administrator user management.
- [ ] Search/filter for a staging test account.
- [ ] Assign or change a test account's role using the supported controls.
- [ ] Confirm the displayed role updates and the account reaches the correct
      workspace after re-authentication or refresh.
- [ ] Confirm a non-admin cannot change profile roles.
- [ ] Confirm an invalid or unsupported role cannot be assigned.

## 8. Archive and retention controls

- [ ] Open the administrator archive workspace.
- [ ] Archive an eligible test submission and confirm archive metadata is shown.
- [ ] Unarchive it, if supported for that record, and confirm the change is
      recorded.
- [ ] Confirm archiving is separate from changing the workflow status.
- [ ] Confirm non-admin accounts cannot archive or unarchive submissions.
- [ ] Verify any displayed retention date/metadata is consistent with the
      configured behavior.

## 9. Notifications and email delivery

- [ ] Open user, approver, and administrator notification pages.
- [ ] Confirm notifications are addressed to the intended role/user and contain
      the correct tracking number and event context.
- [ ] Keep a notification view open and trigger a workflow event; confirm new
      in-app notifications arrive without a manual page reload.
- [ ] Confirm users cannot read or alter another user's private notifications.
- [ ] If email is configured, trigger a notification and confirm an email job is
      queued in the outbox.
- [ ] Run or wait for the scheduled email worker and confirm queued email is
      delivered.
- [ ] Confirm successful jobs are marked sent and failed jobs retain an error
      and increment their attempt count.
- [ ] Confirm the email endpoint rejects requests without the configured
      authorization secret.
- [ ] Confirm missing email configuration produces an explicit operational
      error rather than a false success.

## 10. Files, permissions, and privacy

- [ ] Confirm an unauthenticated visitor cannot access protected documents.
- [ ] Confirm a submitter can access only their own submissions and files.
- [ ] Confirm an office can access files only when authorized by the active
      workflow route.
- [ ] Confirm an approver/admin can access files only according to the intended
      workflow permissions.
- [ ] Try opening a guessed or another user's file path; confirm access is
      denied.
- [ ] Confirm file downloads use authorized access and do not expose permanent
      public URLs for protected files.
- [ ] Confirm unauthorized clients cannot directly modify workflow status,
      route steps, audit records, or role assignments.
- [ ] Confirm secrets and service-role credentials are not exposed in browser
      output or client requests.

## 11. User experience and failure handling

- [ ] Test the main pages at desktop and mobile viewport sizes.
- [ ] Confirm forms, dialogs, tables, navigation, and file previews remain usable
      on a narrow screen.
- [ ] Confirm loading, no-results, and recoverable error states are displayed.
- [ ] Simulate a network interruption during a read and during an action; confirm
      the user gets a clear error and can retry safely.
- [ ] Double-click or repeat a decision action; confirm it does not create
      duplicate or contradictory decisions.
- [ ] Confirm browser back/refresh does not silently lose a completed action.
- [ ] Check the browser console and server logs for uncaught errors during the
      test run.

## 12. End-to-end scenarios

- [ ] **Successful route without Mayor:** submit → approver proposes →
      administrator finalizes → selected offices approve in order → admin
      completes → submitter sees completed status.
- [ ] **Successful route with Mayor:** submit → route includes Mayor as final
      office → all offices approve in order → admin completes.
- [ ] **Requirements loop:** active office requests information → submitter
      responds and attaches a file → same office reviews again → route resumes.
- [ ] **Rejected route:** submit → approver or admin rejects with a reason →
      submitter sees the outcome and history.
- [ ] **Office rejection:** active office rejects with a reason → submitter and
      administrator receive appropriate updates.
- [ ] For each scenario, verify status, current active step, audit history,
      notification recipients, and attachment access.

## 13. QR document retrieval and release

Run this scenario with a completed test request and the municipal office
assigned to its final approved route step.

- [ ] Confirm a submitter cannot generate a QR code for another user's request
      or before the request is approved and completed.
- [ ] Generate a QR code from the submitter's request details; confirm it
      contains no request details or personal information.
- [ ] Reload the details page and confirm the same valid QR code is reused.
- [ ] Download the QR PNG and print it; confirm the reference number and
      claiming instruction are legible.
- [ ] Open **Scan QR Code** as the assigned office and scan using a device
      camera; verify the request, requester, status, office, and current
      storage location are displayed.
- [ ] Confirm another office and non-office roles cannot retrieve the request
      through the scanner or retrieval RPC.
- [ ] Update department/section, room, cabinet, shelf, drawer, and folder/box;
      scan again and verify the saved location, receiving date, officer, and
      latest update.
- [ ] Confirm the officer must acknowledge in-person identity and authorization
      verification before recording a handover.
- [ ] Confirm release records its timestamp and officer, changes the retrieval
      state to Released without breaking the existing workflow status, and
      prevents a second release.
- [ ] Confirm the submitter receives an in-app release notification and, when
      email delivery is configured, an email notification.
- [ ] Confirm scans, location changes, and release are present in the request
      audit history.
- [ ] Confirm an expired QR code is rejected and the submitter can generate a
      replacement for an eligible, unreleased request.

## Results log

| Test/section | Result (Pass/Fail/N/A) | Tracking number or account role | Notes / issue reference |
|---|---|---|---|
| Access and authentication |  |  |  |
| Submitter submission lifecycle |  |  |  |
| Approver review |  |  |  |
| Administrator workflow |  |  |  |
| Municipal office decisions |  |  |  |
| Requirements request loop |  |  |  |
| User management |  |  |  |
| Archive and retention |  |  |  |
| Notifications and email |  |  |  |
| QR retrieval and release |  |  |  |
| Files and privacy |  |  |  |
| User experience and errors |  |  |  |
| End-to-end scenarios |  |  |  |

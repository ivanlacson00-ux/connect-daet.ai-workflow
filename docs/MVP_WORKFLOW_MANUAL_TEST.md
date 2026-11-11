# MVP Workflow Manual Test

Use only a disposable test project and test records. Do not use production accounts or records.

## Test accounts and setup

Have four active accounts ready:

- Submitter
- Daet Tourism Office
- Municipal Treasurer's Office
- Mayor's Office

Before testing, apply all pending repository migrations in timestamp order through `20261111031116_unify_office_workspaces_and_scope_access.sql`, then apply `20261111051526_mvp_direct_office_workflow.sql`. Do not apply the MVP migration before its predecessors. The app build does not require the migration, but the workflow actions do.

For each case, create a new test submission unless the steps explicitly continue using the same submission. Record its submission ID and tracking number. Verify the event history after each transition.

## Composer role and availability checks

1. As the submitter, open a **Changes Requested** submission. Confirm **To** defaults to **Responsible office**, and **Action** defaults to **Submit response**. Confirm the actions are Submit response, Redirect submission, and Withdraw submission; unavailable actions include a reason. The Messages panel still has its separate message composer.
2. As the responsible Treasurer's Office, open an in-process submission with no pending assignment. Confirm **To** defaults to **Submitter** and offers every other active office. Its actions are Request changes, Return for redirection, and Close submission. Select another office and confirm the Action list changes to Request recommendation and Withdraw assignment.
3. Request a recommendation from the Mayor's Office and leave the assignment pending. Return as the Treasurer's Office, select **Submitter**, and verify Request changes and Close submission are greyed out with the pending-assignment reason. Select the Mayor's Office and verify Withdraw assignment is available.
4. As the Mayor's Office, open the pending assignment. Confirm **To** is **Responsible office** and the Action list includes Complete assignment and Return assignment. Complete the assignment, then use a separate submission to test returning an assignment with a reason.
5. As the Tourism Office responsible for its own submission, verify it has the same office workspace and action behavior as the Treasurer's Office.
6. Narrow the browser to a mobile width. Confirm To and Action remain side by side, Send spans the row, the composer does not overflow, and all controls remain keyboard accessible. Use Tab/arrow navigation in both native listboxes and Ctrl+Enter to submit.

## 1. Direct destination and office receipt

1. As the submitter, upload a test document and select the Municipal Treasurer's Office.
2. Verify the Treasurer's Office is the only initial responsible office and the status is **Submitted**.
3. As the submitter, verify Withdraw submission is available while it remains Submitted and has not been received.
4. Sign in as a Treasurer's Office representative and open the submission.
5. Verify it changes to **In Process**, the history records receipt by that office, and Withdraw submission is no longer available to the submitter.
6. Close the submission without a note or file.
7. Verify the status becomes **Completed**, the submitter sees the closer and closure time, and no approval or rejection action was required.

## 2. Tourism Office is an ordinary responsible office

1. Submit a separate test document directly to the Daet Tourism Office.
2. Open it as a Tourism Office representative.
3. Verify it moves to **In Process** and can be closed by that office without routing through another office.
4. On another Tourism-owned submission, select a municipal office as **To** and request a recommendation without entering a note. Verify the assignment is created and Tourism remains the responsible office.

## 3. Sequential recommendation request and assignment completion

1. Submit another document directly to the Treasurer's Office and open it there.
2. In the submission workspace, set **To** to the Mayor's Office and choose **Request recommendation**. Leave the optional note blank; optionally enter a note such as "to proceed with the request. MTO involvement is needed". The current document should be included automatically; optionally attach up to four additional files.
3. Verify one pending **Recommendation** assignment is shown and the responsible office remains the Treasurer's Office.
4. As the Mayor's Office, open the assigned submission, attach a file, and choose **Complete assignment** with an optional note.
5. Verify the assignment is completed, the attached file appears under **Files shared in messages**, and the Treasurer's Office still owns the submission. Confirm both the Mayor's Office and Treasurer's Office can download the shared file after completion; the Treasurer's Office can then close the submission.
6. Before completing the assignment, call `close_workflow_submission` and `request_workflow_submission_changes` as the Mayor's Office through the authenticated test client. Both must fail because the Mayor's Office is only the recipient, not the responsible office.

## 4. Pending assignment blocks responsible-office actions

1. Start a new Treasurer-owned submission and request a recommendation from the Mayor's Office; leave the assignment pending.
2. As the Treasurer's Office, select **Submitter** as To and verify **Close submission** and **Request changes** are greyed out with a pending-assignment explanation.
3. Using an authenticated test client as the Treasurer's Office, call each RPC directly:

   ```ts
   await supabase.rpc('close_workflow_submission', {
     target_submission_id: submissionId,
   });

   await supabase.rpc('request_workflow_submission_changes', {
     target_submission_id: submissionId,
     request_comments: 'MVP test',
   });
   ```

   Both calls must return an error indicating the pending assignment blocks the action. Do not use SQL-editor calls without the authenticated representative's identity.
4. Complete or withdraw the assignment before continuing.

## 5. Request changes with and without a file

1. On a Treasurer-owned **In Process** submission with no pending assignment, select Submitter, choose Request changes, and provide a reason.
2. As the submitter, respond with a message and no file. Verify the response succeeds and status returns to **In Process**.
3. On a second submission, repeat the request, then respond with a message and a revised file.
4. Verify a new numbered version is recorded and status returns to **In Process**.

## 6. Recipient returns assignment; responsible office requests changes

1. Create a Treasurer-owned submission and request a recommendation from the Mayor's Office.
2. As the Mayor's Office, choose **Return assignment**, confirm the action, and provide a reason.
3. As the Treasurer's Office, verify the assignment is no longer pending and request changes from the submitter.

## 7. Wrong-office return and submitter redirect

1. Submit a test document to the Treasurer's Office and have it opened.
2. Request a recommendation from the Mayor's Office and leave that assignment pending.
3. As the Treasurer's Office, choose **Return for redirection**, confirm the effect, and provide a reason.
4. Verify the pending Mayor's Office assignment is automatically withdrawn.
5. As the submitter, choose **Redirect submission**, select the Mayor's Office and a document type valid for that office, then send. Choose **Other** and verify its description field and destination-reset behavior as a separate check.
6. Verify the submission ID and original document are unchanged, the destination and document type are updated, and history records the assignment withdrawal, return, and redirect.

## 8. Submitter withdrawal

1. Create a new submission and leave it **Submitted**; do not open it as office staff.
2. As the submitter, choose **Withdraw submission**, confirm the action, and optionally enter a reason.
3. Verify status is **Withdrawn** and history records the withdrawal.
4. Create another submission and open it as responsible-office staff so it becomes **In Process**.
5. Verify Withdraw submission is unavailable to the submitter with a reason that the office has received the submission.
6. Call `withdraw_workflow_submission` directly as the authenticated submitter for this received submission; verify it returns an error. Also verify a completed submission cannot be withdrawn.

## 9. Closure note and file visibility

1. Create a Treasurer-owned in-process submission with no pending assignments.
2. Choose **Close submission**. Confirm the dialog explains that closure means processing is finished, not that the request was approved. Confirm closure succeeds with no message and no file.
3. On a separate submission, close with an optional closure note and file.
4. As the submitter, verify the note, closure file download, closing representative's name, completion time, and **Completed** label are visible.
5. Verify the composer remains visible but disabled with **This submission is closed.** Messages and Activity tabs remain available.

## Expected history

Check that each applicable event includes an actor and timestamp: destination selected, received, recommendation requested, assignment completed/returned/withdrawn, changes requested/responded, returned for redirection, redirected, submitter withdrawn before receipt, and closed.

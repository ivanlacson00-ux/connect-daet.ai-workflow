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

1. As the submitter, open a **Changes Requested** submission. Confirm **To** defaults to **Responsible office**, and **Action** defaults to **Send response**. Confirm that Send message, Send response, Redirect, and Withdraw submission are offered, and unavailable actions include a reason.
2. As the responsible Treasurer's Office, open an in-process submission with no pending assignment. Confirm **To** defaults to **Submitter** and offers every other active office. Select an office and confirm the Action list changes to Forward for recommendation and Withdraw forward.
3. Forward the submission to the Mayor's Office and leave the assignment pending. Return as the Treasurer's Office, select **Submitter**, and verify Request changes and Close submission are greyed out with the pending-office reason. Select the Mayor's Office and verify Withdraw forward is available.
4. As the Mayor's Office, open the pending assignment. Confirm **To** is **Responsible office** and the Action list includes Send message, Mark assignment completed, and Return assignment. Complete the assignment, then use a separate submission to test returning an assignment with a reason.
5. As the Tourism Office responsible for its own submission, verify it has the same office workspace and action behavior as the Treasurer's Office.
6. Narrow the browser to a mobile width. Confirm To and Action remain side by side, Send spans the row, the composer does not overflow, and all controls remain keyboard accessible. Use Tab/arrow navigation in both native listboxes and Ctrl+Enter to submit.

## 1. Direct destination and office receipt

1. As the submitter, upload a test document and select the Municipal Treasurer's Office.
2. Verify the Treasurer's Office is the only initial responsible office and the status is **Submitted**.
3. Sign in as a Treasurer's Office representative and open the submission.
4. Verify it changes to **In Process** and the history records receipt by that office.
5. Send the submitter a message, then close the submission without a note or file.
6. Verify the status becomes **Completed**, the submitter sees the closer and closure time, and no approval or rejection action was required.

## 2. Tourism Office is an ordinary responsible office

1. Submit a separate test document directly to the Daet Tourism Office.
2. Open it as a Tourism Office representative.
3. Verify it moves to **In Process** and can be closed by that office without routing through another office.

## 3. Sequential forward and assignment completion

1. Submit another document directly to the Treasurer's Office and open it there.
2. In the submission workspace, set **To** to the Mayor's Office, choose **Forward for recommendation**, and enter context. The current document should be included automatically; optionally attach up to four additional files.
3. Verify one pending **Recommendation** assignment is shown and the responsible office remains the Treasurer's Office.
4. As the Mayor's Office, open the assigned submission. Set **To** to the Responsible office and choose **Mark assignment completed** with an optional note.
5. Verify the assignment is completed, the Treasurer's Office still owns the submission, and it can close it.
6. Before completing the assignment, call `close_workflow_submission` and `request_workflow_submission_changes` as the Mayor's Office through the authenticated test client. Both must fail because the Mayor's Office is only the recipient, not the responsible office.

## 4. Pending assignment blocks responsible-office actions

1. Start a new Treasurer-owned submission and forward it to the Mayor's Office; leave the assignment pending.
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

1. Create a Treasurer-owned submission and forward it to the Mayor's Office.
2. As the Mayor's Office, choose **Return assignment**, confirm the action, and provide a reason.
3. As the Treasurer's Office, verify the assignment is no longer pending and request changes from the submitter.

## 7. Wrong-office return and submitter redirect

1. Submit a test document to the Treasurer's Office and have it opened.
2. Forward it to the Mayor's Office and leave that assignment pending.
3. As the Treasurer's Office, choose **Return to submitter (wrong office)**, confirm the effect, and provide a reason.
4. Verify the pending Mayor's Office assignment is automatically withdrawn.
5. As the submitter, choose **Redirect to another office**, select the Mayor's Office and a document type valid for that office, then send. Choose **Other** and verify its description field and destination-reset behavior as a separate check.
6. Verify the submission ID and original document are unchanged, the destination and document type are updated, and history records the assignment withdrawal, return, and redirect.

## 8. Submitter withdrawal

1. Create an in-process submission and have the responsible office forward it to the Mayor's Office.
2. As the submitter, choose **Withdraw submission**, confirm that pending assignments will also be withdrawn, and optionally enter a reason.
3. Verify status is **Withdrawn**, the pending assignment becomes withdrawn, and history records both events.
4. Verify the submitter cannot withdraw an already completed submission in the UI and that a direct authenticated call to `withdraw_workflow_submission` for that completed submission returns an error.

## 9. Closure note and file visibility

1. Create a Treasurer-owned in-process submission with no pending assignments.
2. Choose **Close submission**. Confirm the dialog explains that closure means processing is finished, not that the request was approved. Confirm closure succeeds with no message and no file.
3. On a separate submission, close with an optional closure note and file.
4. As the submitter, verify the note, closure file download, closing representative's name, completion time, and **Completed** label are visible.
5. Verify the composer remains visible but disabled with **This submission is closed.** Messages and Activity tabs remain available.

## Expected history

Check that each applicable event includes an actor and timestamp: destination selected, received, forwarded, assignment completed/returned/withdrawn, changes requested/responded, returned to submitter, redirected, submitter withdrawn, and closed.

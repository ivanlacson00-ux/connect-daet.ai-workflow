# CONNECT-Daet.ai — Revised Workflow Plan (v3)

**System:** CONNECT-Daet.ai  
**Purpose:** Request processing and document fulfillment system  
**Source:** Revised workflow decisions (v3). Supersedes earlier workflow behavior where it conflicts with this document.

> This document records intended behavior and is the reference for implementation and audit. It does not assert that every described feature is already implemented. Decisions explicitly recorded below are confirmed; items under **Open decisions** (section 14) remain unresolved and must not be invented.

## 1. Design principles

1. **Direct routing.** A submission goes only to the office the submitter chooses. No office is a mandatory first stop.
2. **One responsible office.** The selected office owns the submission from receipt to closure, unless it returns the submission to the submitter.
3. **All offices are equal in the workflow.** The Daet Tourism Office is an ordinary office. It processes and closes its own requests and has no special coordinating powers.
4. **Involving other offices is optional and controlled by the responsible office.** Only the responsible office creates assignments. Recipient offices respond; they do not re-route.
5. **Closure is not approval.** Closing records that processing is finished. Legal approvals or denials are separate, explicit, attributable records.
6. **Preserve the current office workflow.** Keep the three assignment responsibility classifications and existing approval, rejection, completion, return, and forwarding behavior except where this plan explicitly changes a rule, including change-request eligibility and Changes Requested behavior.
7. **The database enforces the rules.** The interface mirrors them but is never the only safeguard.

## 2. User roles and responsibilities

The application role codes are `submitter`, `tourism_officer`, `municipal_treasurer`, `mayor_office`, `sangguniang_bayan`, and `system_admin`. These codes identify account roles; route URLs and legacy database object names may retain their existing names.

| Role code | Who | Can do |
|---|---|---|
| `submitter` | Resident or applicant | Submits to one permitted office, responds to change requests, redirects a returned submission, withdraws before the responsible office receives it, tracks status and history, files follow-up submissions |
| `tourism_officer` | Staff of the Daet Tourism Office | Standard office-staff powers (below) for submissions where Tourism is responsible or has an assignment. No global view of other offices’ submissions |
| `municipal_treasurer`, `mayor_office`, `sangguniang_bayan` | Staff of the matching municipal office | Standard office-staff powers |
| `system_admin` | Administrator | Manages offices, users, permissions, document types, and workflow configuration. Submission-content visibility follows the existing workflow-admin access policy; this role does not acquire office decision authority |

**Standard office-staff powers**
- As the **responsible office:** receive, claim, message the submitter, create or withdraw assignments using the existing responsibility classifications, request changes, return for redirection, and use existing completion and decision actions.
- As a **recipient office:** view the assigned submission, complete or return the assignment, forward it onward when needed, and use the private assignment conversation.

Any active staff member of an office may act for that office. The acting person’s name and timestamp are recorded for every action and shown to the submitter where relevant, including closure. Authorization uses active `profiles.role` office membership; a separate per-person designation or finer-grained office sub-role is not modeled.

## 3. Concepts and statuses

**Responsible office.** The office the submitter selected. It is the only office that can close the submission.

**Assignment.** Work requested from another office. Preserve the existing responsibility classifications: **Mandatory Approval/Clearance**, **Evaluation/Verification**, and **Recommendation**. Do not merge or rename these classifications as part of revision history or workflow-speed work.

**Assignment statuses:** `Pending`, `In Progress`, `Completed`, `Returned`, and `Withdrawn`. Existing per-classification and final-decision behavior remains unchanged except that an office cannot act while the parent submission is Changes Requested.

**Submission statuses**

| Status | Meaning |
|---|---|
| Submitted | Sent to the selected office; no staff member has opened it yet |
| In Process | Received and being handled by the responsible office |
| Changes Requested | Closed to office processing; waiting for the submitter. Display as **Closed — Changes Requested** |
| Returned | Sent back because it went to the wrong office; waiting for the submitter to redirect it |
| Completed | Closed by the responsible office |
| Approved | Approved by the configured authorized decision-maker |
| Rejected | Rejected by the configured authorized decision-maker |
| Withdrawn | Cancelled by the submitter before the responsible office receives it |
| Permanently Closed | Terminal status `closed_by_submitter`, chosen by the submitter while Changes Requested |

Office-created assignments are tracked separately, not as submission statuses. Reopening a Changes Requested submission commits a new revision and changes its status to In Process without restarting or replacing its routing history. This may happen once per submission. An office cannot request changes again after that reopen.

## 4. End-to-end workflow

### 4.1 Submit
- The submitter selects one initial destination from the destinations available to them: a municipal office or the Daet Tourism Office.
- The destination picker shows a one-line description of what each office handles. A search box matches the submitter’s words against every office’s document types and suggests offices. This is a suggestion only; the submitter decides.
- After the destination is chosen, the document-type dropdown lists only the types configured for that office. Each office offers **Other**, which reveals a required, bounded custom description. The Tourism Office dropdown uses a concise set of broad tourism categories; these remain subject to confirmation of the official taxonomy.
- Changing the destination clears the selected document type and any custom text.
- The submission is routed directly to the selected office, which becomes the responsible office. It is not required to pass through the Tourism Officer.
- The existing configured office responsibilities for the chosen office and type are **fixed at this moment** (and again on redirect). Later configuration changes do not alter submissions already in process.
- **Soft duplicate warning (Proposed default):** if the same submitter recently filed a similar submission, show a warning. Never block.

### 4.2 Receive and claim
- The first time responsible-office staff open the submission, it is marked **Received** with the staff member’s name and moves to In Process. The submitter sees this.
- Staff may optionally **claim** a submission to show who is handling it. Claiming prevents duplicate work and does not restrict who may act or close. A claim can be released or reassigned within the office, and is released automatically when the claimer’s account is deactivated.

### 4.3 Process
The responsible office reviews documents, then closes, requests a recommendation from another office, requests changes, or returns the submission to the submitter. The workflow action list depends on the selected recipient; selecting another office creates the recommendation assignment, so there is no separate Forward action. The submitter conversation remains separate from private office-assignment conversations. The action note is optional unless that action requires a reason or recommendation context. If no other office is involved, the responsible office processes and closes the submission itself.

### 4.4 Request a recommendation
- In the workflow action panel, the responsible office selects another office as the recipient and chooses **Request recommendation**. This creates the assignment; there is no separate Forward action. A recommendation context is optional. The recipient receives the actual document, and the file version sent is recorded on the assignment.
- **Sequential by default:** one office at a time. A new assignment is blocked while another assignment is Pending.
- **Parallel by choice:** the office may explicitly choose “send to several offices at the same time.” Each office gets its own assignment, and closure waits for all of them.
- Validation: the target must be an active office, different from both the acting office and the responsible office, with at least one active staff member and no other Pending assignment on this submission. Creating an assignment is not allowed while the submission is in Changes Requested.
- An assignment never changes the responsible office or the submitter’s initial destination.
- The same office may be consulted again later (a new, linked assignment) once its previous assignment is no longer Pending.
- When a recipient office forwards its active assignment onward, that assignment is recorded as delegated/completed and a new assignment is opened for the next office. The responsible office remains the overall owner and receives assignment status/outcome updates.
- Every assignment has a private conversation between only the assigning office and the receiving office. Forwarding onward creates a new conversation for the next pair; the next office does not gain access to earlier conversations.

### 4.5 Existing office responsibility classifications
- Preserve **Mandatory Approval/Clearance**, **Evaluation/Verification**, and **Recommendation** as distinct responsibility classifications.
- Their existing assignment, approval-authority, and closure behavior is outside this revision-history change and must not be remapped or broadened by it.
- The new revision timeline records which revision was current when an assignment was created, without changing who may complete or decide that assignment.

### 4.6 Recipient office actions
- **Complete** the assignment with the currently supported outcome and notes.
- **Return** the assignment to the responsible office with a required reason, for example when information from the submitter is needed. A Returned assignment no longer blocks the responsible office, which can then request changes and create another assignment afterwards.
- **Forward onward** to another office when that office should contribute. This closes the current office’s assignment as delegated work and creates a new assignment to the selected office; it does not transfer overall ownership or let the recipient close the submission.
- Recipient offices cannot request changes from the submitter or close the submission. They communicate with the assigning office in their private assignment conversation. If they forward onward, that next conversation is private to the immediate assigning and receiving offices. The submitter and earlier offices do not see its messages or files unless they are participants in that specific assignment.

### 4.7 Request changes
- The responsible office sends a required message describing what is needed. Status becomes **Changes Requested** and office processing is closed. This is not Completed, Approved, Rejected, or Withdrawn.
- **Not allowed while any assignment is Pending or In Progress.** The office must first have the assignment Returned or, while it is still Pending, withdraw it.
- While the submission is Changes Requested, offices may review its details and history but cannot act or send messages. The submitter may send clarification messages; these do not reopen the submission.
- The submitter chooses either **Reopen and resubmit** or **Close permanently**. Reopening is committed only when the submitter submits the revision. It requires at least one file to be added or replaced; a response message is optional. Removing files alone does not satisfy this requirement.
- Unchanged primary and supporting files carry forward by default. The submitter may replace or remove files and add files. Destination, document type, and all original form fields remain unchanged.
- A committed revision returns the same submission to **In Process** at the office that requested the change. It does not create a new destination, route plan, or restart step. Routing and assignment history remain intact.
- A submission may be reopened only once. After that revision, the office may use its other otherwise-available actions, but **Request changes** is unavailable.
- A change request is never a rejection.

### 4.8 Return to submitter (wrong office)
- The responsible office chooses **Return for redirection** and provides a required reason. This is distinct from a change request and is not a rejection.
- Any Pending assignments are automatically Withdrawn with a system reason, and affected offices are notified.
- Status becomes **Returned**. The submitter selects a new permitted destination on the **same submission**, with no re-upload. Files, versions, and history are kept. Redirecting clears the document type and any custom text, sets the new responsible office, re-fixes the clearance checklist, and returns the status to Submitted. The redirect is logged as a new destination event.
- Each return is counted. Staff see the count, and the submitter sees an extra prompt pointing to office descriptions and search after the second return. There is no cap (Proposed default).
- The Tourism Office cannot hand over responsibility. If a Tourism-addressed submission belongs to another office, Tourism returns it for redirection, or keeps it and optionally requests a Recommendation from that office. This is an accepted trade-off of removing the Tourism-first step; revisit if it proves frequent.

### 4.9 Close Submission
- The primary completion action. Available from **In Process** only. The office cannot complete or otherwise act on a submission while it is **Changes Requested**.
- Requires: the actor is active staff of the responsible office and no assignment is Pending, as currently enforced for completion.
- Shows a confirmation dialog explaining that closure means processing is finished, that it is not an approval or denial, and that pending assignments prevent it. The user can confirm or cancel.
- An optional **closure note** and optional **closure file** are visible to the submitter. Neither is required. No response category is required. Private staff notes stay separate and hidden from the submitter.
- Enforce the closure checks and authorization in the database, not only the interface.
- On closure: record the actor and timestamp, set Completed, notify the submitter, and retain messages, files, assignment history, and any formal decision records. The submitter sees who closed it, when, and the note or file if provided.
- After completion the message thread is read-only. The responsible office may add an append-only **post-closure note** visible to the submitter (Proposed default).

### 4.10 After closure and withdrawal
- A Changes Requested submission is not a completed or terminally closed submission. The submitter may permanently close it, which sets `closed_by_submitter`, records a distinct closure reason and timestamp, and marks its open change request **Abandoned**. It cannot be reopened afterward.
- The submitter may reopen a Changes Requested submission once by submitting a revision. The same submission returns to In Process at the requesting office; destination and route do not change. The change request becomes **Fulfilled** and links to the committed revision.
- Completed, Approved, Rejected, Permanently Closed, and Withdrawn submissions remain terminal for this feature. A submitter who needs further processing after one committed reopen must use the office’s remaining available actions; a new follow-up submission is still available after terminal closure.
- A submitter can **withdraw only before the responsible office receives the submission**. After receipt, the submitter cannot withdraw directly; they may contact the office to request cancellation, and the office decides how to end processing.
- The receive action and withdrawal action lock the same submission row so they cannot race: whichever commits first determines whether withdrawal is still allowed.
- Any Pending assignments are withdrawn along with an eligible pre-receipt withdrawal, and the full history is retained. Withdrawal is unavailable after receipt or completion.

## 5. Action matrix

| To / recipient | Action | Who | Allowed when | Result |
|---|---|---|---|---|
| — | Submit | Submitter | Destination permitted; type valid for that office | Submitted; responsible office and existing responsibility configuration are set |
| — | Receive / claim | Responsible-office staff | Submitted or In Process | In Process; names recorded |
| Submitter | Request changes | Responsible-office staff | In Process; no Pending or In Progress assignment; no prior reopen or fulfilled request | Changes Requested; office processing and office messaging stop |
| Submitter | Return for redirection | Responsible-office staff | Submitted or In Process | Returned; pending assignments Withdrawn |
| Submitter | Close submission | Responsible-office staff | In Process; no Pending assignment | Completed |
| Another office | Create assignment | Responsible-office staff | In Process; no open change request; target valid; current routing rules satisfied | Assignment Pending with its existing responsibility classification |
| Another office | Withdraw assignment | Responsible-office staff | Assignment Pending | Withdrawn, reason recorded |
| Responsible office | Complete assignment | Recipient staff | Assignment Pending | Completed with the currently supported outcome |
| Responsible office | Return assignment | Recipient staff | Assignment Pending | Returned; no longer blocking |
| Responsible office | Clarification message | Submitter | Changes Requested | Message recorded; status and routing unchanged |
| Responsible office | Reopen and resubmit | Submitter | Changes Requested; reopen_count = 0; at least one file added or replaced | New revision committed; request Fulfilled; In Process at requesting office |
| — | Close permanently | Submitter | Changes Requested | `closed_by_submitter`; request Abandoned; terminal |
| Responsible office | Redirect submission | Submitter | Returned | New responsible office; Submitted |
| Responsible office | Withdraw submission | Submitter | Submitted and not yet received by the responsible office | Withdrawn; pending assignments are withdrawn |
| — | Post-closure note | Responsible-office staff | Completed | Append-only note visible to submitter |
| — | Follow-up | Submitter | Completed or Withdrawn | New linked submission |

The workflow action list depends on **To**. **Send message** is not a workflow action; conversation messages remain in the separate Messages panel. While Changes Requested, only submitter clarification messages are enabled. Reopen is a single submitter action that commits a revision, not a separate status-only action. After the one allowed reopen, other office actions remain available but Request changes is not.

## 6. Visibility and communication

| | Submitter | Responsible office | Recipient office | System admin |
|---|---|---|---|---|
| Submission, files, versions | Yes | Yes | Yes (while assigned) | Same access currently granted by workflow policy |
| Submitter ↔ responsible-office conversation | Yes; clarification while Changes Requested | Yes while In Process; read-only while Changes Requested | No | No |
| Private assignment conversation | No | Only for assignments it created or received | Only for assignments it received or created by forwarding onward | No |
| Files attached to an assignment conversation | No | Only for assignments it created or received | Only for assignments it received or created by forwarding onward | No |
| Private staff notes | No | Authoring office only | Authoring office only | No |
| Workflow history and revision history | Yes | Yes | Yes (while authorized for submission) | Same access currently granted by workflow policy |
| Closure note, closure file, post-closure notes | Yes | Yes | Yes | Same access currently granted by workflow policy |

- The submitter hears from one voice: the responsible office. Recipient offices never message the submitter directly. While Changes Requested, the submitter may add clarification messages, but offices cannot send messages until the submission is reopened.
- Assignment conversations are scoped to one assignment and its two participants. For an A → B → C chain, A and B can access A ↔ B; B and C can access B ↔ C; A and C and the submitter cannot access B ↔ C.
- The responsible office can switch between its submitter conversation and the assignment conversations it participates in. A recipient office sees only the assignment conversations in which its office is the receiver or immediate sender; its active assignment conversation is selected by default.
- System-admin content access follows the existing per-submission workflow policy; revision history must not broaden that access.
- Tourism Officers do not see other offices’ submissions unless assigned.

## 7. Files, versions, and document types

- Every committed revision is a complete immutable snapshot of the submission form details, primary document, and supporting files. The original form fields (including destination and document type) do not change during a change-request response.
- Each file has a stable logical identity across revisions. Revision history records added, replaced, carried-forward, and removed files. Unchanged files carry forward without a new upload; new uploads use unique storage paths and are never overwritten.
- Revisions show the submitter response (optional), the office request and requesting office, uploader, and timestamp. Old revision files remain available to authorized viewers while the submission is retained; no automatic version cleanup occurs.
- `workflow_submissions.file_*` continues to point to the current primary document for existing preview and forwarding code. Current supporting files are obtained from the current revision; legacy attachment/version rows remain readable during migration.
- Because change requests cannot occur while assignments are Pending or In Progress, the document a recipient reviews stays the document of record during an assignment. Supplementary attachments may accompany messages when the conversation is writable; whether submitter clarification messages while Changes Requested may include attachments remains open.
- Each assignment records the file version that was sent.
- Office-specific document types come from the shared application office configuration and are validated against the database catalogue on submission. The catalogue is seeded through migrations and must stay synchronized with the shared configuration. A user interface for administrators to maintain document types is not included unless separately requested.
- `Other` is stored as the classification, separately from the required custom description. The custom text is descriptive only and does not create an assignment or authorization rule.
- Tourism document types are an interim catalogue of broad event/activity, promotion/marketing, attraction/facility, business/establishment, and information/assistance categories, not a claim that the list is the Tourism Office’s final official taxonomy. Keep the application configuration and database catalogue synchronized.

## 8. Workflow history (append-only)

Recorded events include: submission created; destination selected (initial or redirect); document type set; received; claimed or released; revision committed; file version added; recommendation requested (sequential or parallel); assignment forwarded onward; clearance dispatched; assignment completed, returned, or withdrawn; formal decision recorded or superseded; changes requested; clarification sent; submission reopened; permanently closed by submitter; returned to submitter; withdrawn by submitter; completed; post-closure note added; follow-up created. Each event stores the actor, office, timestamp, revision link and structured payload where relevant. Internal conversation text and attachments are not copied into submitter-visible audit history.

Initial destination selections, redirects, and office-created assignments must remain distinguishable in data, permissions, interface, and history.

## 9. Notifications, reminders, reports, and points

**Notification and reminder details remain open decisions**
- Notify the submitter when a submission is received, when changes are requested, when it is returned, when a revision is committed, when it is permanently closed, and when it is completed.
- Notify the requesting office when the submitter clarifies, reopens with a revision, or permanently closes.
- Do not enable new reminder thresholds or automatic state changes until their policy is confirmed. A Changes Requested submission remains closed to office actions; reminders do not grant the office permission to complete or alter it.
- **No automatic withdrawal** by default.
- **Reports** reflect the close-based flow: time to receipt, time to completion, assignment duration per office, change-request cycles, return counts, and configured formal decisions. They must not assume universal verification or approval stages.

**Confirmed points policy**
- Each submitter starts with a zero-point balance.
- Award 10 points exactly once when the responsible office completes the submission. Completing a forwarded office assignment earns no points.
- Rejected, returned, withdrawn, or otherwise incomplete submissions earn no points. No points are backfilled for submissions completed before this policy is implemented.
- Points and completion history are recorded in a ledger; the user dashboard displays the current balance. Completion is not, by itself, a legal approval.

## 10. Security and data-integrity rules

1. Use Supabase Row Level Security for all applicable data and storage access.
2. Enforce permissions in backend and database policies, not only by hiding interface elements.
3. **State changes go through database functions** that lock the submission row, validate the transition, and write history. Clients must not be able to write status, owner, destination, assignment, file-path, decision, or history fields directly. Do not rely on a whole-row `UPDATE` policy for submitters or offices; restrict grants by column or route changes through authorized functions.
4. Every access check and workflow function must require an **active profile**. Deactivated or banned accounts lose read and write access, including administrator endpoints that use elevated credentials.
5. Handle a missing or unreadable profile with an explicit safe sign-in or error path, never a redirect to the same route.
6. Validate the submitter’s destination server-side against destinations available to that submitter, including Tourism and redirects. Client input must not grant access or authority.
7. Validate the office and document-type pair against the database catalogue. `Other` requires a bounded custom description; standard types accept none.
8. Validate every office assignment: target active, different from both the acting office and the responsible office, with active staff, current document attached, sequential or explicit parallel rule respected, and no open change request. Recommendation context is optional unless a specific action requires it.
9. Closure is authorized only for active staff of the responsible office. System administration does not confer this.
10. Completion fails in the database if any assignment is Pending, per the existing rules. It requires no category, message, or attachment.
11. Request-changes fails in the database if any assignment is Pending or In Progress. Creating an assignment fails if status is Changes Requested.
12. Preserve existing office action rules. While In Process, the responsible office and recipient offices keep their currently authorized assignment, request-changes, return, complete, forward, and decision actions. While Changes Requested, neither responsible nor recipient offices may act or send messages.
13. Submitter withdrawal is allowed only while status is Submitted and `received_at` is null. The database locks the submission row and enforces this cutoff; UI restrictions alone are insufficient.
14. Preserve the current authorized-office Approve and Reject behavior and the existing completion/assignment outcome behavior. This feature changes change-request eligibility (Pending or In Progress assignments block it), what is allowed while Changes Requested, and the ability to commit the one submitter revision.
15. Keep an append-only audit history that cannot be edited or deleted by users or administrators.
16. Use secure storage policies for uploaded files, versions, and closure files. Validate file type by content as well as extension and declared type, and consider malware scanning.
17. Apply migrations carefully to protect existing data. Use explicit, reviewable function definitions rather than rewriting function source dynamically.
18. Dashboards and reports must paginate or filter on the server so older records are never silently omitted.
19. A change request closes the submission to office actions and office messaging without marking it Completed, Approved, Rejected, or Withdrawn. Only the submitter may permanently close it or commit the single allowed reopen revision.
20. A revision transaction must verify that the acting user owns the submission, that the destination and document type are unchanged, that at least one file was added or replaced, and that no file path is overwritten. It must commit the revision, update current-file mirrors, fulfill the request, reopen to In Process, and record audit history atomically.
21. Revision files and change-request history are immutable and readable only by the same actors authorized to read that submission. Storage access and signed downloads must use the same boundary.
22. Submitter clarification messages while Changes Requested do not change status. Database policies must prevent every office from writing messages or executing workflow actions until a revision is committed.
23. A detail/history RPC must return only the submission details, route, sender, authorized files, revisions, change requests, and visible audit events for which the caller already has access. It must not expose private assignment messages, private staff notes, or unrelated submissions.

## 11. Real-world scenarios

> Illustrative only. Names, document types, and clearance requirements are examples for testing, not statements of actual Daet legal requirements. **TO** = Daet Tourism Office, **MT** = Municipal Treasurer, **MO** = Mayor’s Office, **SB** = Sangguniang Bayan.

### A. Normal paths

| ID | Situation | Expected behavior |
|---|---|---|
| A1 | Maria sends a certification request directly to MT | MT receives it, messages her, closes with the certificate as an optional closure file. TO and other offices are not involved |
| A2 | Jun asks TO for a festival support letter (`Other`) | TO processes and closes its own request |
| A3 | Jun’s street-event request to MO; MO requests a recommendation from MT for fee input | MT completes the Recommendation; MO closes. MO stays responsible |
| A4 | MO requests recommendations from MT, then SB, one at a time | Each is a separate assignment; a second assignment is blocked while the first is Pending |
| A5 | MO explicitly sends assignments to MT and SB at once | Closure stays blocked until both are done |
| A6 | A type requires an Evaluation/Verification assignment | The existing office responsibility and assignment flow applies; revision-history work does not change it |
| A7 | A type requires a Mandatory Approval/Clearance assignment | The existing configured authority and assignment flow applies; revision-history work does not change it |
| A8 | An office completes a Recommendation assignment | Its current supported outcome is recorded and shown; it does not change the responsible office or make a submission decision |

### B. Changes and information requests

| ID | Situation | Expected behavior |
|---|---|---|
| B1 | MO requests a missing attachment | Status becomes Changes Requested and office processing closes. Maria may clarify, then submits a revision with at least one added or replaced file; the same submission returns to MO in In Process |
| B2 | The office requests changes after the one allowed reopen | Request changes is unavailable. The office may use its other otherwise-available actions; v1 and v2 and the complete request/response history remain visible |
| B3 | Submitter never responds | No office action or office message is available while Changes Requested. The submitter can still clarify, reopen with a qualifying revision, or close permanently. Reminder timing remains an open decision |
| B4 | MO wants changes while an assignment is Pending or In Progress | Blocked. MO waits, withdraws the assignment if it is still Pending, or asks the recipient to Return; creates another assignment afterwards |
| B5 | MT needs information from the submitter | MT Returns the assignment; MO requests changes; the submitter submits a changed file; the same submission resumes at MO |
| B6 | Same, but for a Mandatory Approval/Clearance or Evaluation/Verification assignment | The current assignment is returned or withdrawn before MO requests changes. Existing responsibility classifications and assignment history are retained |
| B7 | Submitter spots their own error | The submitter tells the responsible office; with no Pending assignment, the office may request changes. The submitter must add or replace a file to reopen |

### C. Wrong office

| ID | Situation | Expected behavior |
|---|---|---|
| C1 | Jun picks MT for an event request | MT Returns with a reason; Jun redirects the same submission to MO; type resets; two destination events logged |
| C2 | Return while an assignment is Pending | Pending assignment auto-Withdrawn; recipient notified |
| C3 | Returned twice | Allowed; return count shown to staff; extra prompt for submitter after the second return |
| C4 | Payment matter sent to TO | TO returns it for redirection, or keeps it and optionally requests a Recommendation from MT |
| C5 | Submitter unsure where to send | Destination search suggests offices; submitter decides |

### D. Submitter actions

| ID | Situation | Expected behavior |
|---|---|---|
| D1 | Withdraw before the responsible office receives the submission | Submission is Withdrawn; history is kept; no points. Withdrawal is unavailable after receipt |
| D2 | Office requests changes | Submitter can send clarification, submit one qualifying revision to reopen at the requesting office, or permanently close |
| D3 | Submitter permanently closes while a change request is open | Status becomes `closed_by_submitter` / Permanently Closed; request becomes Abandoned; files and history remain |
| D4 | Error found after terminal completion or permanent closure | Follow-up submission linked to the original, prefilled |
| D5 | Needs two offices | If one office leads, it creates assignments for the other office or offices; if independent, submit two separate submissions |
| D6 | Accidental duplicate | Soft warning only; the office returns or completes one with a note, or the submitter withdraws it before receipt |

### E. Office operations and edge cases

| ID | Situation | Expected behavior |
|---|---|---|
| E1 | Staff A creates an assignment while Staff B closes | Row lock; the first action wins and the other fails with a clear message |
| E2 | Submission unopened | Reminder after 2 working days; any staff may pick it up |
| E3 | Claimer deactivated | Claim auto-released |
| E4 | Recommendation unanswered | Reminders; MO withdraws the assignment and closes without it, or requests a recommendation from another office |
| E5 | An office assignment remains Pending | Closure and other actions remain governed by the existing assignment rules; request changes stays blocked |
| E6 | Target office has no active staff | Assignment creation is blocked; if staff become inactive after dispatch, MO is notified and may withdraw |
| E7 | Recipient wants a third office | Recipient forwards its active assignment to the third office; the new office gets a separate private assignment conversation |
| E8 | Consult the same office again | Allowed as a new linked assignment when none is Pending |
| E9 | Admin tries to close or read content | Denied. Config changes affect only new submissions |
| E10 | Office or type deactivated mid-flight | In-flight unaffected; cannot be selected for new submissions or redirects |
| E11 | Submitter permanently closes while awaiting changes | Terminal `closed_by_submitter`; open request is Abandoned; no reopen |
| E12 | Submitter sends clarification while awaiting changes | Message is recorded without reopening; offices can read but cannot reply or act until the submitter submits a revision |
| E13 | Private note written | Hidden from submitter and other offices |
| E14 | Formal decision error | New superseding record; old record retained |
| E15 | Points | Only on Completed, per configured policy |

## 12. Acceptance checks for audit

1. A submission to a municipal office reaches that office directly without touching the Tourism Officer.
2. A submission to the Tourism Office can be processed and closed by Tourism staff.
3. Changing the destination clears the document type and custom text.
4. A direct database call cannot set a destination the submitter is not allowed to choose.
5. Closure fails while any assignment is Pending, enforced in the database.
6. Closure fails for staff of any office other than the responsible office, and for system admins.
7. Closure succeeds with no note and no file.
8. Request-changes fails while any assignment is Pending or In Progress; assignment creation fails while Changes Requested.
9. A Returned assignment lets the responsible office request changes.
10. Parallel assignments require an explicit choice; the default is one at a time.
11. Return to submitter withdraws Pending assignments; redirect keeps files and history.
12. A recipient office can forward its active assignment onward, but cannot close the submission or request changes from the submitter.
13. Private staff notes are not readable by the submitter or other offices.
14. Audit history rows cannot be updated or deleted.
15. No code path infers formal approval or denial from assignment completion or closure.
16. The revision-history implementation does not change existing office responsibility configuration for submissions already in process.
17. An assignment to an office with no active staff is rejected.
18. The revision-history implementation does not change assignment blocking or the three responsibility classifications.
19. Return followed by redirect keeps all files, versions, and history and logs two destination events.
20. Concurrent assignment creation and close attempts cannot both succeed.
21. After completion, new messages are rejected and only an append-only post-closure note is allowed.
22. Existing approval, rejection, and assignment outcome rules behave as before outside the explicitly changed Changes Requested state.
23. A deactivated or banned account cannot read workflow data or call administrator endpoints.
24. A client cannot directly update status, destination, ownership, assignment, or file-path fields.
25. A missing profile never causes a redirect loop.
26. Every office role can open the shared File Registry index and detail pages.
27. A Changes Requested submission is closed to office actions; only the submitter can clarify, permanently close, or reopen by submitting at least one added or replaced file.
28. Reopening commits a new complete revision atomically, preserves form fields, updates current-file mirrors, fulfills the open change request, and returns to the requesting office in In Process without restarting routing.
29. Permanent closure sets `closed_by_submitter`, abandons the open request, is terminal, and does not delete revisions or storage files.
30. The single allowed reopen is enforced by the database. After it, other otherwise-available office actions remain, but Request changes is unavailable.
31. Initial and subsequent revisions include primary and supporting files; unchanged files carry forward, and added/replaced/removed states are represented without overwriting or deleting old objects.
32. Revision history and old-file downloads are available to the same authorized actors as the submission and are denied to everyone else.
33. A stale or concurrent office action and submitter reopen cannot both succeed; the losing RPC returns a clear state-conflict error.
34. Existing submissions are backfilled to revision 1 or a reconstructable primary-file history; change-request rows link to the request event and its against-revision. Any data whose historical form/file state cannot be recovered is marked as partial rather than fabricated.
35. The detail/history RPC reduces detail loading to one server request per page and returns the same authorization-scoped route, sender, attachments, revisions, requests, and events as the existing pages.
36. Submitter messages and files are visible only to the submitter and responsible office; recipient offices cannot read them.
37. Each office-forward assignment has a private two-office conversation. Forwarding A → B → C creates separate A ↔ B and B ↔ C conversations; C cannot read A ↔ B and A cannot read B ↔ C.
38. Message notifications and storage access follow the same assignment-participant boundary as message reads.
39. A recipient office cannot read or send messages in the submitter/responsible-office conversation.

## 13. Legacy mapping and migration notes

- Existing assignment responsibility classifications—**Mandatory Approval/Clearance**, **Evaluation/Verification**, and **Recommendation**—must be preserved as-is. This feature does not rename, merge, or remap them.
- Add revision-history tables and columns before changing application reads/writes. Do not drop or rewrite `workflow_submission_versions`, `workflow_submission_attachments`, file paths, or existing audit records during backfill.
- Backfill each submission from the ordered `workflow_submission_versions` primary-file rows where available, then attach currently known supporting files to the latest reconstructable revision. `workflow_submissions.file_*` remains the current-primary mirror. Historical supporting-file membership and old form-field values cannot be inferred when the existing schema did not record them; mark those snapshots partial and do not invent facts.
- For in-flight `changes_requested` (and legacy `returned_for_requirements`) records, create an open request using the latest matching `CHANGES_REQUESTED` or `ROUTE_REQUIREMENTS_REQUESTED` audit event and link it to the latest known revision. If no suitable audit event exists, flag the row for explicit repair rather than fabricating a request message.
- Preserve existing submission statuses and legacy status paths. `closed_by_submitter` is additive and terminal; do not reinterpret historical `withdrawn`, `completed`, `approved`, or `rejected` records as this new status.
- Legacy audit event types (for example verification or final-approval events) may remain in history but must not drive reports for the revised flow.
- Route URLs and legacy database object names may keep their existing names.
- Provide a baseline schema or documented, tested clean-project bootstrap so migrations are reproducible.
- Exact table names, status enum values, API routes, and notification channels are implementation details. Preserve compatible conventions and ask before making consequential product-policy assumptions.

## 14. Open decisions

Do not invent these. Ask first.

1. Confirm or revise the interim Tourism Office document types as the official taxonomy.
2. Any separately requested changes to office responsibility configuration, assignment outcomes, or decision authority (outside this feature).
3. Whether any existing assignment or decision rule requires policy clarification (outside this feature).
4. Notification channels, reminder thresholds, and whether to auto-withdraw inactive submissions.
5. Points formulas and eligibility.
6. Whether any office will have staff under more than one role code. The current model maps one role to one office.
7. Whether reminder timing/channels change for Changes Requested and permanently closed submissions.
8. Whether submitter clarification messages while Changes Requested may include attachments; they must never count as a committed revision.
9. How to handle historical `completed` records whose latest `SUBMISSION_CLOSED` audit event has `old_status = 'changes_requested'`. The old implementation permitted office completion in that state; do not automatically reopen these records without product approval.
10. How to repair existing in-flight change-request records that have no matching request audit event or whose requester cannot be identified.
11. Whether SHA-256 values should be computed only on the client for file comparison or verified by a trusted server component; a client hash must not be used as an authorization control.

## 15. Instructions for Copilot

When auditing or implementing the project:

- Treat this document as the source of truth for intended workflow behavior.
- Compare the actual code and database schema against it. Do not claim a feature is implemented merely because a file or table exists.
- Identify mismatches and missing requirements before proposing changes.
- Keep the action list recipient-dependent: To Submitter offers Request changes only before any reopen and when no assignment is Pending or In Progress, Return for redirection, and Complete only while In Process; to another office offers Request recommendation or Request clearance, and Withdraw assignment when pending; a recipient office addressing the responsible office offers Complete assignment or Return assignment; a recipient office addressing another office can forward its active assignment onward; a submitter addressing the responsible office can clarify while Changes Requested, commit one revision to reopen, or close permanently, and can Redirect or Withdraw only under their existing status rules. Do not expose a standalone workflow Send message action.
- Keep the submitter/responsible-office conversation separate from office-assignment conversations. Enforce assignment participants for message rows, read receipts, attachment metadata, storage uploads/downloads, and notifications in the database; interface-only filtering is not sufficient.
- Make direct routing, one responsible office, ordinary-office Tourism behavior, Return and redirect, optional parallel assignments, recipient-dependent actions, chained office assignments with pair-scoped conversations, submitter withdrawal only before receipt, mutual exclusion of change requests and pending assignments, change-request closure/reopen/permanent-close semantics, immutable revision history, and **Complete Submission** (with confirmation and database-enforced checks) consistent across the interface, backend APIs, database functions, authorization policies, and audit history.
- Do not change production data or production configuration without explicit authorization.
- Do not execute SQL, migrations, or destructive operations during an audit-only task. Never contact a live Supabase project unless explicitly told to.
- Preserve existing data, uncommitted changes, and existing interface patterns unless the user approves a change.
- Work in phases and wait for approval between phases. Do not silently invent product policy; ask about anything in section 14.

## 16. Submission revision history and faster workflow — phased implementation

This section is the technical implementation reference for the confirmed change-request behavior. The user approved the design and Phase A only. Phase A is a read-only history foundation; Phases B–D remain unimplemented and require review before proceeding.

### 16.1 Recon: current implementation and conflicts

- The submitter detail page loads the submission first, then loads attachments, audit history, and route plans in parallel, and then loads route steps. Its current response uploads an optional primary document and calls `respond_to_workflow_submission_changes`; see [`app/(dashboard)/workflow/user/file_registry/[id]/page.tsx`](../app/(dashboard)/workflow/user/file_registry/%5Bid%5D/page.tsx#L120), [response upload/RPC](../app/(dashboard)/workflow/user/file_registry/%5Bid%5D/page.tsx#L323), and [response UI](../app/(dashboard)/workflow/user/file_registry/%5Bid%5D/page.tsx#L548).
- The office detail page performs serial auth, profile, submission, route-plan, route-step, submitter-profile, audit, and attachment reads; see [`components/OfficeSubmissionDetail.tsx`](../components/OfficeSubmissionDetail.tsx#L257). The UI currently offers Request changes and Complete while status is `changes_requested` and leaves office composer/messaging open; see [office actions](../components/OfficeSubmissionDetail.tsx#L693) and [composer availability](../components/OfficeSubmissionDetail.tsx#L905).
- The latest request RPC sets `changes_requested`; the latest response RPC accepts a message and optional file, updates the current `file_*` mirror, and returns to `in_process`. The current reopen patch also allows a submitter to reopen a submission completed from `changes_requested`, without a reopen counter; see [`20261111051526_mvp_direct_office_workflow.sql`](../supabase/migrations/20261111051526_mvp_direct_office_workflow.sql#L785) and [`20261112114408_allow_reopen_closed_change_requests.sql`](../supabase/migrations/20261112114408_allow_reopen_closed_change_requests.sql#L4). The office completion RPC currently accepts `changes_requested`; it must no longer do so under the agreed behavior.
- `workflow_submission_versions` stores numbered primary-file versions and is readable through RLS; it does not snapshot form fields or supporting-file membership. `workflow_submission_attachments` stores supporting files without revision linkage. See [`20261110194204_submitter_direct_office_routing.sql`](../supabase/migrations/20261110194204_submitter_direct_office_routing.sql#L156) and [`20261105160000_implement_five_stage_document_workflow.sql`](../supabase/migrations/20261105160000_implement_five_stage_document_workflow.sql#L26).
- Existing submission, attachment, version, route, and audit reads use per-submission policies. The version and storage policies include workflow-admin access and authorized office assignment access; preserve the effective existing authorization boundary rather than creating a broader history audience. See [`20261111031116_unify_office_workspaces_and_scope_access.sql`](../supabase/migrations/20261111031116_unify_office_workspaces_and_scope_access.sql#L98) and [version/file policies](../supabase/migrations/20261111031116_unify_office_workspaces_and_scope_access.sql#L150).
- Assignment conversations are separately scoped by routing-step participants; the submitter conversation is the null-step thread. New message-write rules must preserve that boundary and additionally block office writes while Changes Requested. See [`20261111191418_separate_assignment_conversations.sql`](../supabase/migrations/20261111191418_separate_assignment_conversations.sql#L92).
- Forwarding downloads the current primary document and uploads a copy into the assignment conversation; `workflow_submissions.file_*` must therefore remain the current-primary mirror. See [`components/DocumentMessaging.tsx`](../components/DocumentMessaging.tsx#L911). `FilePreview` creates signed URLs from stored paths; old revision downloads should use that existing pattern, not public URLs: [`components/FilePreview.tsx`](../components/FilePreview.tsx#L49).
- `WorkflowActivityTimeline` limits its featured display to five key entries. It remains useful for recent activity but is not a substitute for an unbounded, browsable revision timeline: [`components/WorkflowActivityTimeline.tsx`](../components/WorkflowActivityTimeline.tsx#L53).

### 16.2 State machine and role/action contract

All row-changing transitions are enforced by database RPCs. The interface mirrors these rules but is not authoritative. “Assigned office” means an office with an authorized assignment on the submission; existing assignment-level actions remain subject to their current office and step checks.

| Submission state | Submitter | Responsible office | Assigned office(s) | `system_admin` |
|---|---|---|---|---|
| Submitted | View; withdraw only before receipt | Receive; otherwise existing pre-processing behavior | No assignment action until an assignment exists | Read only, within existing policy |
| In Process, never reopened | View and message | Existing actions remain: create/withdraw assignment, Request changes if no assignment is Pending or In Progress, Return for redirection, Complete, Approve/Reject when configured and authorized | Existing Receive, Complete, Return, and Forward rules | Read only; no office action authority |
| In Process, after the one reopen | View and message | Same existing actions except Request changes is unavailable permanently for this submission | Existing assignment actions and checks | Read only; no office action authority |
| Changes Requested | Clarification message without changing status; Reopen and resubmit once with at least one added or replaced file; or Close permanently | Read-only review; no workflow action and no message writes | Read-only review; no workflow action or message writes | Read only, within existing policy |
| Returned | Redirect using existing destination rules | Read only until redirect | Read only | Read only, within existing policy |
| Completed | Read only | Existing post-completion behavior, if any, remains unchanged | Read only | Read only, within existing policy |
| Approved / Rejected | Read only | Existing decision remains terminal; no change from this feature | Read only | Read only, within existing policy |
| Withdrawn | Read only | Read only | Read only | Read only, within existing policy |
| `closed_by_submitter` (Permanently Closed) | Read only; terminal | Read-only review; no reopen | Read-only review | Read only, within existing policy |

`changes_requested` remains a distinct nonterminal database status, but its user-facing label is **Closed — Changes Requested**. It is not `completed`, `approved`, `declined_by_office`, `rejected`, or `withdrawn`. A committed revision returns it to `in_process`. `closed_by_submitter` is a new terminal status and must not be conflated with the existing pre-receipt `withdrawn` status.

Keep historical database aliases (including `pending_office`, `pending`, `pending_approver`, `returned_for_requirements`, and legacy decline statuses) readable and guarded. Do not bulk-rename them as part of this feature. The office responsibility classifications **Mandatory Approval/Clearance**, **Evaluation/Verification**, and **Recommendation** are unchanged.

### 16.3 Expand/contract schema and Phase A status

Use additive `workflow_` tables. The proposed tables below supplement, rather than immediately remove, the existing primary-version and attachment tables.

Phase A is implemented in [`20261114090000_add_workflow_submission_revision_history.sql`](../supabase/migrations/20261114090000_add_workflow_submission_revision_history.sql). It adds the history schema, legacy backfill, access policies, authorized detail RPC, realtime publication entries, and the admin-deletion storage-path update. The migration is additive; existing version and attachment tables remain in place.

1. **`workflow_submission_revisions`**
   - `id`, `submission_id`, `revision_no`, `created_by`, `created_at`, nullable `submitter_message`, `form_snapshot jsonb`, and a backfill-quality marker.
   - Unique `(submission_id, revision_no)`. Revision 1 is the initial committed package.
   - The whitelisted form snapshot includes the title/primary-document display name, category and `other_document_type`, description, purpose, requested action, intended recipient, and destination identifiers. Do not snapshot signed URLs, credentials, or message bodies from private office conversations.
   - For new revisions the form snapshot is immutable and the destination, document type, and all existing form fields remain unchanged.

2. **`workflow_revision_files`**
   - `id`, `revision_id`, stable `logical_file_id`, file role (`primary` or `supporting`), `file_name`, `storage_path`, MIME type, size, optional SHA-256, `change_kind` (`added`, `replaced`, `carried`, `removed`), and a link to the prior revision-file row when applicable.
   - One row per logical file per revision. Carried files point to their original immutable storage path; they are not reuploaded. A removed row is a tombstone and does not erase the prior row or object.
   - Each committed revision must still have exactly one current primary document, matching the required legacy primary-file mirror. At least one file must be `added` or `replaced` to reopen; removals alone do not qualify.

3. **`workflow_change_requests`**
   - `id`, `submission_id`, `requested_by_office`, `requested_by_user`, required `message`, `against_revision_id`, status (`open`, `fulfilled`, `abandoned`), `fulfilled_by_revision_id`, and timestamps.
   - Enforce at most one open request per submission with a partial unique index. The RPC additionally enforces the product rule of at most one reopen over the submission lifetime. Historical request rows are retained.
   - Fulfilled links to the revision that reopens the submission. Permanent close marks the open request Abandoned.

4. **Existing tables**
   - Add `current_revision_id`, `reopen_count` (0 or 1), `closure_reason`, and `closed_at` to `workflow_submissions`. `closed_at` is set while Changes Requested and on permanent close, then cleared on reopen; `closure_reason` distinguishes awaiting-submitter from submitter-permanent-close. Existing office completion and decision fields retain their existing meaning.
   - Add nullable `revision_id` and `payload jsonb` to `workflow_audit_logs`; use the existing append-only audit stream rather than a parallel events table.
   - Keep `workflow_submissions.file_name`, `file_path`, `file_type`, `file_size`, and `file_url` synchronized to the current primary file. Keep existing version/attachment records intact during expansion; new detail reads use the revision manifest as canonical history. Update all current-file readers, authorized storage lookup, admin-deletion path collection, and relevant upload/cleanup code before retiring any legacy projection.

All new revision and request rows are immutable after commit. Enforce uniqueness, valid file roles/change kinds, one primary per revision, bounded metadata, and valid links in the database. `workflow_submission_versions` and `workflow_submission_attachments` are not dropped in this phase.

### 16.4 RPC contracts and transaction boundaries

RPC parameter types below are contract sketches; final SQL signatures must follow repository naming and PostgREST conventions. Avoid leaving callable old overloads that can bypass the new state rules.

- **Modify `request_workflow_submission_changes(target_submission_id, request_comments, expected_revision_id)`**: require an active responsible-office role, `in_process`, no pending/in-progress assignment, no existing change request/reopen, and a nonempty bounded request. Lock the submission `FOR UPDATE`; verify the expected current revision; insert the open request against that revision; set `changes_requested`, `closed_at`, and closure reason; write audit row and notifications in the same transaction. A stale revision yields an explicit conflict.
- **Add `submit_workflow_submission_revision(target_submission_id, expected_change_request_id, expected_revision_id, submitter_message, file_manifest)`**: require the active owning submitter, `changes_requested`, the matching open request, `reopen_count = 0`, and at least one added/replaced file. Lock the submission `FOR UPDATE`; validate every manifest path belongs to this user and the `workflow_uploads` bucket, uploaded objects exist, metadata is bounded/allowed, the primary-file invariant holds, and destination/form snapshot is unchanged. Insert the immutable revision and file rows, append the primary version projection, update the current primary mirror and current revision id, fulfill the request, set `reopen_count = 1`, clear awaiting-submitter closure fields, return status to `in_process`, and append audit/notification rows atomically.
- **Add `close_workflow_submission_permanently(target_submission_id, expected_change_request_id)`**: require the active owning submitter, `changes_requested`, and the matching open request. Lock the submission; set `closed_by_submitter`, reason, actor, and timestamp; mark the request Abandoned; append audit and notification rows atomically. No file removal or reopen is allowed.
- **Add `get_workflow_submission_detail(target_submission_id)`**: one authorization-scoped read RPC returning submission, current route and steps, sender profile, current supporting files, all revisions/files, change requests, and visible audit events. Do not return private assignment message contents or private notes. Prefer a typed result or a documented JSON object with stable keys; check active profile and existing per-submission read access before returning anything. Signed URLs remain short-lived and are requested only for files the viewer opens.
- **Update existing office/action and message paths**: `close_workflow_submission_with_details`, responsible-office Approve/Reject, assignment completion/return/withdraw/forward/receive, and message insert/attachment/read-receipt policies must reject office writes while `changes_requested`. Preserve each action’s existing eligibility and effects outside this closed state. In particular, completion becomes `in_process` only; assignment withdrawal must not mutate assignments while the submission is closed for changes. Preserve the current rule blocking Request changes while any assignment is Pending or In Progress.
- The database lock and state check must serialize office actions against revision submission and permanent close. Every transition writes its audit record in the same transaction; an action that loses the race returns a clear stale-state error. Notifications use the committed transition and are not sent on rollback.

### 16.5 RLS, storage, and communication

- New tables enable RLS. Revoke direct client insert/update/delete; grant only authorized select. RPCs perform writes after validating active profile and submission access. Prevent update/delete of committed revision/file/request/audit records with database triggers or equivalent privilege restrictions.
- Read policies must match the existing `workflow_submissions` access boundary (submitter, authorized office/responsible office/assignment participants, and existing workflow-admin access). Do not grant all-authenticated visibility. Keep system-admin access exactly as current per-submission policy grants it.
- Extend `is_workflow_file_accessible` to include every path in `workflow_revision_files`, while retaining legacy attachments and primary versions until verified safe to retire. Signed downloads use the existing private `workflow_uploads` bucket. Never delete old revision objects during a response, permanent closure, or ordinary retention.
- Keep assignment-message reads scoped to the current conversation participants. While Changes Requested, offices may read existing conversations but may not insert messages/attachments, mark messages as read, or cause office-message notifications. The submitter may add a clarification in the submitter conversation without changing submission status; whether those clarifications can include attachments remains open.
- All office workflow RPCs and message/storage policies must enforce the same closed-state guard. UI disabling is supplementary, not the security boundary.

### 16.6 Backfill and rollback

- **Phase A completed:** the additive migration creates the schema, constraints, indexes, policies, and compatibility reads without changing the existing request/reopen write behavior. A disposable local PostgreSQL 17 smoke test applied the migration and verified backfill and authorized detail-RPC output; no live Supabase project was contacted.
- Backfill each submission from `workflow_submission_versions` in `version_number` order where available. Create revision 1 when no prior version exists. Associate currently known supporting files with the latest reconstructable revision. Preserve every storage path.
- The current schema cannot reconstruct prior supporting-file membership or old form-field values if those were changed without snapshots. Mark incomplete historical snapshots as partial; do not duplicate the current form into earlier revisions and present it as historical fact.
- Reconstruct each supported historical request from audit events where evidence exists. For an in-flight `changes_requested` or legacy `returned_for_requirements` submission, the latest matching request event becomes open and links to the latest known revision. Link prior request/response events where they can be reliably paired. Set `workflow_submissions.change_request_repair_needed` when an in-flight request cannot be reconstructed, rather than fabricating a message; the shared timeline shows a repair notice.
- Review before migration the legacy completed rows whose last `SUBMISSION_CLOSED.old_status` is `changes_requested`; the old office-completion path permitted this. Do not silently turn these completed records back into open change requests.
- The Phase A detail RPC checks active-account and existing per-submission access before returning history. It returns storage paths, not signed URLs; clients request a short-lived URL only when previewing or downloading a historical file. The existing admin-deletion function now includes revision storage paths in its cleanup collection.
- Rollback before enabling writes by disabling the feature and reverting application code; retain additive schema. After revision or permanent-close writes exist, do not roll back by deleting rows, old objects, or statuses. Use a forward repair migration or compatibility code. Take and verify backups before production migration; do not run migrations against a live project as part of this planning checkpoint.

### 16.7 UI and workflow-speed plan

- **Phase A completed:** shared [`WorkflowRevisionTimeline`](../components/WorkflowRevisionTimeline.tsx) is used on the submitter file detail and office detail pages. It presents revisions, reconstructed/legacy request events, request messages, timestamps, available form snapshots, file-change labels, and per-file signed preview/download actions oldest to newest. Incomplete historical metadata is labeled; existing recent activity and audit history remain.
- **Phase B completed — Changes Requested closure:** the responsible office's request creates a change-request record, records the current revision and audit event, notifies the submitter, and changes the submission to **Closed — Changes Requested**. Offices retain read access but cannot act or send assignment messages while it is closed. The submitter can clarify in the existing submitter conversation; clarifications do not reopen processing. The legacy response/reopen path is removed. Reopening and permanent closure are not available until Phase C.
- **Pending Phase C — Submitter outcomes:** add submitter actions to reopen and resubmit or close permanently. The revision editor starts with current files marked Keep. For each file provide Keep/Replace/Remove; allow added files. Require at least one add/replace and retain the primary-file invariant. Destination, document type, and form fields are displayed read-only. Reopening retains routing/assignment history and returns the submission to the requesting office with a “Resubmitted” marker.
- Keep current validation helpers (`getWorkflowFilesTypeError`, `getWorkflowFileMimeType`) and the 10 MB per-file limit. Upload newly added/replaced files directly to `workflow_uploads` with `upsert: false`; upload independent files in parallel, then send only a manifest to the revision RPC. If the RPC fails, clean up only paths uploaded by that attempt and report cleanup errors. Never remove carried or previously committed paths.
- Replace detail-page sequential fetches with the single detail RPC. Current baseline is approximately eight sequential calls in office detail and one initial submission fetch plus parallel attachment/log/route reads and a dependent route-step read in submitter detail (additional conditional profile/QR calls on completed items). Target: one detail RPC per page load, with signed URL requests only when preview/download is opened. Verify with a request-count measurement, not code inspection alone.
- Add revision, request, and submission status tables to realtime subscriptions. Debounce/coalesce simultaneous changes so one event burst causes at most one detail refresh.
- Keep office role distinctions and the three assignment responsibility classifications unchanged. Add no new office roles or assignment semantics in this feature.

### 16.8 Test plan and rollout phases

Current repository validation is Node’s built-in test runner (`npm test`) with source-contract tests in `tests/`. The package does not declare a SQL/pgTAP or e2e runner, there is no `supabase/tests` directory, and the Supabase CLI was not found in the environment. Phase A was additionally smoke-tested against a disposable local PostgreSQL 17 cluster, including migration application, backfill, and detail-RPC output. Continue adding focused SQL/RPC integration coverage where safe; never target production for tests.

Automated coverage should include:

1. Pure unit tests for `getAvailableActions(submission, assignments, role)` across every status, including no office action during Changes Requested and Request changes disabled after the single reopen.
2. RPC/RLS tests for only the owner reopening/permanently closing, active-profile checks, the one-reopen limit, file-change requirement, unchanged form/destination, Pending/In Progress assignment guard, and terminal permanent closure.
3. Transaction/concurrency tests proving that a competing office action and submitter revision/closure serialize with one winner and one clean stale-state error.
4. Repeated historical revision rendering, exact request/revision linkage, carried/replaced/added/removed file state, and signed downloads respecting the same read access.
5. Regression tests that approve, reject, complete, return for redirection, create/receive/complete/return/withdraw/forward assignments, notification access, and Tourism routing keep their existing behavior outside Changes Requested.
6. Backfill tests for revision-1 primary/supporting files, ordered primary versions, in-flight change requests, old histories with missing audit evidence, and completed legacy records that must not be reinterpreted.
7. Page-level test that both detail pages use the shared history component and new single detail RPC; measure network request count before and after against the baseline above.

Implementation remains phased and reviewable:

- **Phase A — Foundation — completed:** additive migration, migration/backfill checks, history RPC, RLS/storage updates, and read-only timeline on both detail pages. Full Node test suite (64 tests), TypeScript, production build, diff checks, and disposable local PostgreSQL smoke test passed. ESLint could not start because the existing configuration cannot resolve `eslint-config-next/core-web-vitals`.
- **Phase B — Closed semantics — completed:** request-change closure behavior, office action/messaging guards, status banner/labels, pure action selector, removal of Complete-in-Changes-Requested, and submitter clarification behavior.
- **Phase C — Submitter outcomes:** one-time revise-and-reopen transaction with file carry-forward, plus permanent close and Abandoned request state.
- **Phase D — Speed and polish:** single-call detail loading, realtime on revision/request tables, per-file diff, inbox resubmission marker, upload parallelism, and performance measurement.

Phase A and Phase B are implemented. Phase B has passed the Node test suite (72 tests), TypeScript checking, and a production build. Its SQL migration has not yet been applied to a disposable database, so migration/RPC integration validation remains a gap. Phase A is the read-only history foundation; Phase B adds closed-state behavior and change-request recording. Phase C remains unimplemented: one-time revision submission/reopen and permanent submitter closure are not yet available. Clarification attachments and the other items in **Open decisions** remain unresolved.

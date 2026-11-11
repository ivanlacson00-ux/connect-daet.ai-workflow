# CONNECT-Daet.ai — Revised Workflow Plan (v2)

**System:** CONNECT-Daet.ai  
**Purpose:** Request processing and document fulfillment system  
**Source:** Revised workflow decisions (v2). Supersedes the earlier revised workflow plan.

> This document records intended behavior and is the reference for implementation and audit. It does not assert that every described feature is already implemented. Items marked **Proposed default** were decided on the product owner's behalf and still need confirmation. Items under **Open decisions** (section 14) must not be invented; ask first.

## 1. Design principles

1. **Direct routing.** A submission goes only to the office the submitter chooses. No office is a mandatory first stop.
2. **One responsible office.** The selected office owns the submission from receipt to closure, unless it returns the submission to the submitter.
3. **All offices are equal in the workflow.** The Daet Tourism Office is an ordinary office. It processes and closes its own requests and has no special coordinating powers.
4. **Involving other offices is optional and controlled by the responsible office.** Only the responsible office forwards. Recipient offices respond; they do not re-route.
5. **Closure is not approval.** Closing records that processing is finished. Legal approvals or denials are separate, explicit, attributable records.
6. **Few concepts.** Two assignment kinds, six submission statuses, and a short list of actions.
7. **The database enforces the rules.** The interface mirrors them but is never the only safeguard.

## 2. User roles and responsibilities

The application role codes are `submitter`, `tourism_officer`, `municipal_treasurer`, `mayor_office`, `sangguniang_bayan`, and `system_admin`. These codes identify account roles; route URLs and legacy database object names may retain their existing names.

| Role code | Who | Can do |
|---|---|---|
| `submitter` | Resident or applicant | Submits to one permitted office, responds to change requests, redirects a returned submission, withdraws, tracks status and history, files follow-up submissions |
| `tourism_officer` | Staff of the Daet Tourism Office | Standard office-staff powers (below) for submissions where Tourism is responsible or has an assignment. No global view of other offices’ submissions |
| `municipal_treasurer`, `mayor_office`, `sangguniang_bayan` | Staff of the matching municipal office | Standard office-staff powers |
| `system_admin` | Administrator | Manages offices, users, permissions, document types, clearance rules, and workflow configuration. No default access to submission content and no authority to process or close |

**Standard office-staff powers**
- As the **responsible office:** receive, claim, message the submitter, forward, withdraw a forward, request changes, return to submitter, close.
- As a **recipient office:** view the forwarded submission, complete or return the assignment, use the internal thread.

Any active staff member of an office may act for that office. The acting person’s name and timestamp are recorded for every action and shown to the submitter where relevant, including closure. Authorization uses active `profiles.role` office membership; a separate per-person designation or finer-grained office sub-role is not modeled.

## 3. Concepts and statuses

**Responsible office.** The office the submitter selected. It is the only office that can close the submission.

**Assignment.** Work requested from an office. There are two kinds:

- **Recommendation.** Created when the responsible office forwards the submission for another office’s input. Informal. Completing it is not an approval.
- **Required Clearance.** Configured per office and document type and required before closure. If configuration (law or policy) requires a formal decision, completing it also requires a separate **Formal Decision Record** (actor, outcome, timestamp, optional evidence). This kind replaces the former separate Mandatory Approval/Clearance and Evaluation/Verification classifications.

**Assignment statuses:** `Pending`, `Completed`, `Returned` (recipient sent it back with a reason), `Withdrawn` (cancelled by the responsible office or the system). A Required Clearance that is Returned or Withdrawn goes back to **Not yet dispatched** because it is still required.

**What blocks closure:** only assignments that are `Pending` and Required Clearances that are not `Completed`. Returned or Withdrawn Recommendations do not block closure.

**Submission statuses**

| Status | Meaning |
|---|---|
| Submitted | Sent to the selected office; no staff member has opened it yet |
| In Process | Received and being handled by the responsible office |
| Changes Requested | Waiting for the submitter’s response |
| Returned | Sent back because it went to the wrong office; waiting for the submitter to redirect it |
| Completed | Closed by the responsible office |
| Withdrawn | Cancelled by the submitter before completion |

Forwards are tracked on assignments, not as submission statuses.

## 4. End-to-end workflow

### 4.1 Submit
- The submitter selects one initial destination from the destinations available to them: a municipal office or the Daet Tourism Office.
- The destination picker shows a one-line description of what each office handles. A search box matches the submitter’s words against every office’s document types and suggests offices. This is a suggestion only; the submitter decides.
- After the destination is chosen, the document-type dropdown lists only the types configured for that office. Each municipal office also offers **Other**, which reveals a required, bounded custom description. Until the Tourism Office’s official list is configured, its only type is **Other**.
- Changing the destination clears the selected document type and any custom text.
- The submission is routed directly to the selected office, which becomes the responsible office. It is not required to pass through the Tourism Officer.
- The Required Clearance checklist for the chosen office and type is **fixed at this moment** (and again on redirect). Later configuration changes do not alter submissions already in process.
- **Soft duplicate warning (Proposed default):** if the same submitter recently filed a similar submission, show a warning. Never block.

### 4.2 Receive and claim
- The first time responsible-office staff open the submission, it is marked **Received** with the staff member’s name and moves to In Process. The submitter sees this.
- Staff may optionally **claim** a submission to show who is handling it. Claiming prevents duplicate work and does not restrict who may act or close. A claim can be released or reassigned within the office, and is released automatically when the claimer’s account is deactivated.

### 4.3 Process
The responsible office reviews documents, messages the submitter, then closes, forwards for input, requests changes, or returns the submission to the submitter. If no other office is involved, it processes and closes the submission itself.

### 4.4 Forward for input (Recommendation)
- From the shared communication panel, the responsible office forwards the submission to another office with a context message. The recipient receives the actual document; the file version sent is recorded on the assignment.
- **Sequential by default:** one office at a time. A new forward is blocked while another assignment is Pending.
- **Parallel by choice:** the office may explicitly choose “send to several offices at the same time.” Each office gets its own assignment, and closure waits for all of them.
- Validation: the target must be an active office, different from the responsible office, with at least one active staff member and no Pending assignment on this submission. Forwarding is not allowed while the submission is in Changes Requested.
- A forward never changes the responsible office or the submitter’s initial destination.
- The same office may be consulted again later (a new, linked assignment) once its previous assignment is no longer Pending.

### 4.5 Required Clearances
- When the selected office and document type have configured clearances, the submission shows them as a checklist of **Not yet dispatched** items. Closure is blocked until every one is Completed.
- The responsible office dispatches each through the same forward panel with the target prefilled. Dispatching makes it Pending. Keeping dispatch separate means the office can still request changes before involving another office.
- Completing a clearance that is configured to need a formal decision requires a Formal Decision Record. Assignment completion and closure never create that record implicitly.
- A denied formal outcome does not close the submission automatically. The responsible office decides what happens next, for example requesting changes or closing with a note.
- Where a formal decision exists, its outcome is shown beside the Completed status so closure is not read as approval.
- Formal Decision Records are never edited or deleted. A correction is a new record that supersedes the old one; both stay in history.

### 4.6 Recipient office actions
- **Complete** the assignment, with an optional note (plus the Formal Decision Record when required).
- **Return** the assignment to the responsible office with a required reason, for example when information from the submitter is needed. A Returned assignment no longer blocks the responsible office, which can then request changes and re-forward afterwards.
- Recipient offices cannot request changes from the submitter, forward further, or close. They communicate with the responsible office through the internal thread. If a third office should be involved, they ask the responsible office, which forwards.

### 4.7 Request changes
- The responsible office sends a message describing what is needed. Status becomes **Changes Requested**.
- **Not allowed while any assignment is Pending.** The office must first have the assignment Returned or withdraw it.
- **Forwarding is not allowed while the submission is in Changes Requested.**
- The submitter responds with a message and **may** attach revised or supporting files when needed. Files are optional. Each uploaded file becomes a new numbered version, and previous versions remain available.
- The submission returns to **In Process**. Completed assignments are not repeated unless the responsible office dispatches them again.
- A change request is never a rejection.

### 4.8 Return to submitter (wrong office)
- The responsible office returns the submission with a required reason. This is a distinct action from a change request and is not a rejection.
- Any Pending assignments are automatically Withdrawn with a system reason, and affected offices are notified.
- Status becomes **Returned**. The submitter selects a new permitted destination on the **same submission**, with no re-upload. Files, versions, and history are kept. Redirecting clears the document type and any custom text, sets the new responsible office, re-fixes the clearance checklist, and returns the status to Submitted. The redirect is logged as a new destination event.
- Each return is counted. Staff see the count, and the submitter sees an extra prompt pointing to office descriptions and search after the second return. There is no cap (Proposed default).
- The Tourism Office cannot hand over responsibility. If a Tourism-addressed submission belongs to another office, Tourism returns it for redirection, or keeps it and optionally forwards a Recommendation. This is an accepted trade-off of removing the Tourism-first step; revisit if it proves frequent.

### 4.9 Close Submission
- The primary completion action. Available from **In Process** or **Changes Requested** (so an office is not stuck when a submitter stops responding).
- Requires: the actor is active staff of the responsible office, and no assignment is Pending and no Required Clearance is incomplete.
- Shows a confirmation dialog explaining that closure means processing is finished, that it is not an approval or denial, and that pending required assignments prevent it. The user can confirm or cancel.
- An optional **closure note** and optional **closure file** are visible to the submitter. Neither is required. No response category is required. Private staff notes stay separate and hidden from the submitter.
- Enforce the closure checks and authorization in the database, not only the interface.
- On closure: record the actor and timestamp, set Completed, notify the submitter, and retain messages, files, assignment history, and any formal decision records. The submitter sees who closed it, when, and the note or file if provided.
- After completion the message thread is read-only. The responsible office may add an append-only **post-closure note** visible to the submitter (Proposed default).

### 4.10 After closure and withdrawal
- **No reopening (Proposed default).** A submitter who needs more starts a **follow-up submission** linked to the original, with destination and type prefilled. The closed record stays immutable.
- A submitter can **withdraw** a submission before completion. Pending assignments are Withdrawn and history is kept.

## 5. Action matrix

| Action | Who | Allowed when | Result |
|---|---|---|---|
| Submit | Submitter | Destination permitted; type valid for that office | Submitted; responsible office set; clearance checklist fixed |
| Receive / claim | Responsible-office staff | Submitted or In Process | In Process; names recorded |
| Forward (Recommendation) | Responsible-office staff | In Process; no open change request; target valid; sequential rule or explicit parallel choice | Assignment Pending |
| Dispatch required clearance | Responsible-office staff | In Process; clearance not dispatched | Assignment Pending |
| Complete assignment | Recipient staff | Assignment Pending | Completed (plus decision record if required) |
| Return assignment | Recipient staff | Assignment Pending | Returned; no longer blocking |
| Withdraw forward | Responsible-office staff | Assignment Pending | Withdrawn, reason recorded |
| Request changes | Responsible-office staff | In Process; no Pending assignment | Changes Requested |
| Respond to changes | Submitter | Changes Requested | Message, optional new version; In Process |
| Return to submitter | Responsible-office staff | Submitted or In Process | Returned; pending assignments Withdrawn |
| Redirect | Submitter | Returned | New responsible office; Submitted |
| Close Submission | Responsible-office staff | In Process or Changes Requested; nothing Pending and no incomplete required clearance | Completed |
| Post-closure note | Responsible-office staff | Completed | Append-only note visible to submitter |
| Withdraw submission | Submitter | Not Completed or Withdrawn | Withdrawn |
| Follow-up | Submitter | Completed or Withdrawn | New linked submission |

## 6. Visibility and communication

| | Submitter | Responsible office | Recipient office | System admin |
|---|---|---|---|---|
| Submission, files, versions | Yes | Yes | Yes (while assigned) | No by default |
| Messages with submitter | Yes | Yes | Read only | No |
| Internal thread | No | Yes | Yes | No |
| Private staff notes | No | Authoring office only | Authoring office only | No |
| Workflow history | Yes (offices, actions, statuses; not internal content) | Yes | Yes | Audit access only |
| Closure note, closure file, post-closure notes | Yes | Yes | Yes | No |

- The submitter hears from one voice: the responsible office. Recipient offices use the internal thread and the Return action instead of messaging the submitter (Proposed default).
- Admin access to submission content, if ever needed for support, must be an explicit, logged exception.
- Tourism Officers do not see other offices’ submissions unless assigned.

## 7. Files, versions, and document types

- The original and every revised file are kept as numbered versions with version number, uploader, and date.
- Because change requests cannot occur while assignments are Pending, the document a recipient reviews stays the document of record during a forward. Supplementary attachments in messages are allowed at any time.
- Each assignment records the file version that was sent.
- Office-specific document types come from the shared application office configuration and are validated against the database catalogue on submission. The catalogue is seeded through migrations and must stay synchronized with the shared configuration. A user interface for administrators to maintain document types is not included unless separately requested.
- `Other` is stored as the classification, separately from the required custom description. The custom text is descriptive only and does not create an assignment or authorization rule.
- Until the Tourism Office’s taxonomy is supplied, offer only `Other` for Tourism rather than inventing categories.

## 8. Workflow history (append-only)

Recorded events include: submission created; destination selected (initial or redirect); document type set; received; claimed or released; file version added; forwarded (sequential or parallel); clearance dispatched; assignment completed, returned, or withdrawn; formal decision recorded or superseded; changes requested; changes submitted; returned to submitter; withdrawn by submitter; closed; post-closure note added; follow-up created. Each event stores the actor, office, timestamp, and a reason or note where applicable.

Initial destination selections, redirects, and forwards must remain distinguishable in data, permissions, interface, and history.

## 9. Notifications, reminders, reports, and points

**Proposed defaults, pending confirmation**
- **Submitter** is notified when the submission is received, when changes are requested, when it is returned, and when it is completed.
- **Office** is notified of new submissions, received forwards, assignments completed or returned, and the submitter’s responses.
- **Reminders:** submission unopened for 2 working days; assignment Pending for 3 working days; Changes Requested or Returned with no response for 7 days. A Required Clearance that remains unanswered keeps escalating reminders; there is no silent waiver.
- **No automatic withdrawal** by default.
- **Reports** reflect the close-based flow: time to receipt, time to completion, assignment duration per office, change-request cycles, return counts, and configured formal decisions. They must not assume universal verification or approval stages.
- **Points** are evaluated only on Completed, under the configured rewards policy. Returned and Withdrawn submissions earn none. Closure alone must not be interpreted as legal approval. The system tracks points balance and history.

## 10. Security and data-integrity rules

1. Use Supabase Row Level Security for all applicable data and storage access.
2. Enforce permissions in backend and database policies, not only by hiding interface elements.
3. **State changes go through database functions** that lock the submission row, validate the transition, and write history. Clients must not be able to write status, owner, destination, assignment, file-path, decision, or history fields directly. Do not rely on a whole-row `UPDATE` policy for submitters or offices; restrict grants by column or route changes through authorized functions.
4. Every access check and workflow function must require an **active profile**. Deactivated or banned accounts lose read and write access, including administrator endpoints that use elevated credentials.
5. Handle a missing or unreadable profile with an explicit safe sign-in or error path, never a redirect to the same route.
6. Validate the submitter’s destination server-side against destinations available to that submitter, including Tourism and redirects. Client input must not grant access or authority.
7. Validate the office and document-type pair against the database catalogue. `Other` requires a bounded custom description; standard types accept none.
8. Validate every forward: target active, different from the responsible office, with active staff, context message present, current document attached, sequential or explicit parallel rule respected, and no open change request.
9. Closure is authorized only for active staff of the responsible office. System administration does not confer this.
10. Closure fails in the database if any assignment is Pending or any Required Clearance is incomplete. It requires no category, message, or attachment.
11. Request-changes fails in the database if any assignment is Pending. Forward fails if status is Changes Requested.
12. Only the responsible office can forward, withdraw, request changes, return, or close. Recipient offices can only complete or return their own assignment.
13. Formal approval or denial exists only as separate attributable Formal Decision Records where law or configuration requires them. There are no generic approve or reject actions for ordinary processing.
14. Keep an append-only audit history that cannot be edited or deleted by users or administrators.
15. Use secure storage policies for uploaded files, versions, and closure files. Validate file type by content as well as extension and declared type, and consider malware scanning.
16. Apply migrations carefully to protect existing data. Use explicit, reviewable function definitions rather than rewriting function source dynamically.
17. Dashboards and reports must paginate or filter on the server so older records are never silently omitted.

## 11. Real-world scenarios

> Illustrative only. Names, document types, and clearance requirements are examples for testing, not statements of actual Daet legal requirements. **TO** = Daet Tourism Office, **MT** = Municipal Treasurer, **MO** = Mayor’s Office, **SB** = Sangguniang Bayan.

### A. Normal paths

| ID | Situation | Expected behavior |
|---|---|---|
| A1 | Maria sends a certification request directly to MT | MT receives it, messages her, closes with the certificate as an optional closure file. TO and forwards not involved |
| A2 | Jun asks TO for a festival support letter (`Other`) | TO processes and closes its own request |
| A3 | Jun’s street-event request to MO; MO forwards to MT for fee input | MT completes the Recommendation; MO closes. MO stays responsible |
| A4 | MO forwards to MT, then SB, one at a time | Each is a separate assignment; a second forward is blocked while the first is Pending |
| A5 | MO explicitly sends to MT and SB at once | Closure stays blocked until both are done |
| A6 | A type requires MT Verification | Checklist shows Not yet dispatched; closure blocked until dispatched and completed |
| A7 | A type requires SB formal approval | SB records a Formal Decision Record (Approved); MO closes; history shows two separate entries |
| A8 | SB records Denied | Clearance is Completed with outcome Denied; MO closes with a note or requests changes; Denied is shown beside Completed |

### B. Changes and information requests

| ID | Situation | Expected behavior |
|---|---|---|
| B1 | MO requests a missing attachment | Changes Requested; Maria replies (file optional); In Process; earlier versions kept |
| B2 | Several change rounds | Versions v1, v2, v3 with uploader and date; completed assignments not repeated |
| B3 | Submitter never responds | Reminder at 7 days; MO may close from Changes Requested with a note; no auto-withdrawal |
| B4 | MO wants changes while a forward is Pending | Blocked. MO waits, withdraws the forward, or asks the recipient to Return; re-forwards afterwards |
| B5 | MT needs information from the submitter | MT Returns the assignment; MO requests changes; submitter responds; MO re-forwards |
| B6 | Same, but for a Required Clearance | Clearance returns to Not yet dispatched; MO dispatches again after the response |
| B7 | Submitter spots their own error | With nothing Pending, MO requests changes so a new version can be uploaded; with a Pending forward, MO chooses between waiting and withdrawing |

### C. Wrong office

| ID | Situation | Expected behavior |
|---|---|---|
| C1 | Jun picks MT for an event request | MT Returns with a reason; Jun redirects the same submission to MO; type resets; two destination events logged |
| C2 | Return while a forward is Pending | Pending assignment auto-Withdrawn; recipient notified |
| C3 | Returned twice | Allowed; return count shown to staff; extra prompt for submitter after the second return |
| C4 | Payment matter sent to TO | TO returns it for redirection, or keeps it and optionally forwards a Recommendation to MT |
| C5 | Submitter unsure where to send | Destination search suggests offices; submitter decides |

### D. Submitter actions

| ID | Situation | Expected behavior |
|---|---|---|
| D1 | Withdraw while MO has a Pending forward | Submission and assignment Withdrawn; offices notified; history kept; no points |
| D2 | Error found after closure | Follow-up submission linked to the original, prefilled |
| D3 | Needs two offices | If one leads, it forwards; if independent, two separate submissions |
| D4 | Accidental duplicate | Soft warning only; office returns or closes one with a note, or the submitter withdraws one |

### E. Office operations and edge cases

| ID | Situation | Expected behavior |
|---|---|---|
| E1 | Staff A forwards while Staff B closes | Row lock; the first action wins and the other fails with a clear message |
| E2 | Submission unopened | Reminder after 2 working days; any staff may pick it up |
| E3 | Claimer deactivated | Claim auto-released |
| E4 | Recommendation unanswered | Reminders; MO withdraws and closes without it, or re-forwards elsewhere |
| E5 | Required Clearance unanswered | Closure stays blocked; escalating reminders; no waiver (see Open decisions) |
| E6 | Target office has no active staff | Forward blocked; if staff become inactive after dispatch, MO is notified and may withdraw |
| E7 | Recipient wants a third office | Recipient asks MO in the internal thread; MO forwards |
| E8 | Consult the same office again | Allowed as a new linked assignment when none is Pending |
| E9 | Admin tries to close or read content | Denied. Config changes affect only new submissions |
| E10 | Office or type deactivated mid-flight | In-flight unaffected; cannot be selected for new submissions or redirects |
| E11 | Closed by mistake | No undo; append-only post-closure note and follow-up submission |
| E12 | Submitter replies after closure | Thread read-only; prompted to start a follow-up |
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
8. Request-changes fails while any assignment is Pending; forward fails while Changes Requested.
9. A Returned assignment lets the responsible office request changes.
10. Parallel forwards require an explicit choice; the default is one at a time.
11. Return to submitter withdraws Pending assignments; redirect keeps files and history.
12. Recipient offices cannot forward, close, or request changes.
13. Private staff notes are not readable by the submitter or other offices.
14. Audit history rows cannot be updated or deleted.
15. No code path infers formal approval or denial from assignment completion or closure.
16. A configuration change does not alter the required clearances of existing submissions.
17. A forward to an office with no active staff is rejected.
18. A Returned or Withdrawn Recommendation does not block closure; an incomplete Required Clearance does.
19. Return followed by redirect keeps all files, versions, and history and logs two destination events.
20. Concurrent forward and close attempts cannot both succeed.
21. After completion, new messages are rejected and only an append-only post-closure note is allowed.
22. A Formal Decision Record cannot be edited or deleted, only superseded.
23. A deactivated or banned account cannot read workflow data or call administrator endpoints.
24. A client cannot directly update status, destination, ownership, assignment, or file-path fields.
25. A missing profile never causes a redirect loop.
26. Every office role can open the shared File Registry index and detail pages.
27. Responding to a change request succeeds without a file.

## 13. Legacy mapping and migration notes

- Existing data and the three legacy assignment classifications (Mandatory Approval/Clearance, Evaluation/Verification, Recommendation) must not be destroyed. Map Mandatory Approval/Clearance and Evaluation/Verification to **Required Clearance**, carrying a formal-decision flag only where law or configuration requires it. Map Recommendation to **Recommendation**.
- Map existing submission statuses and legacy status paths to the six statuses in section 3 without losing history. Inspect the code and schema first; do not assume names.
- Legacy audit event types (for example verification or final-approval events) may remain in history but must not drive reports for the revised flow.
- Route URLs and legacy database object names may keep their existing names.
- Provide a baseline schema or documented, tested clean-project bootstrap so migrations are reproducible.
- Exact table names, status enum values, API routes, and notification channels are implementation details. Preserve compatible conventions and ask before making consequential product-policy assumptions.

## 14. Open decisions

Do not invent these. Ask first.

1. Official Tourism Office document types, replacing the interim `Other`-only option.
2. Which office and document-type pairs require which Required Clearances, and which need a formal decision (with the legal basis).
3. Whether a Required Clearance can ever be waived, and by whom.
4. Notification channels, reminder thresholds, and whether to auto-withdraw inactive submissions.
5. Points formulas and eligibility.
6. Whether system admins may ever access submission content for support.
7. Whether closed submissions should be reopenable instead of using follow-up submissions.
8. Whether any office will have staff under more than one role code. The current model maps one role to one office.

## 15. Instructions for Copilot

When auditing or implementing the project:

- Treat this document as the source of truth for intended workflow behavior.
- Compare the actual code and database schema against it. Do not claim a feature is implemented merely because a file or table exists.
- Identify mismatches and missing requirements before proposing changes.
- Make direct routing, one responsible office, ordinary-office Tourism behavior, Return and redirect, optional parallel forwarding, mutual exclusion of change requests and pending assignments, and **Close Submission** (with confirmation and database-enforced checks) consistent across the interface, backend APIs, database functions, authorization policies, and audit history.
- Do not change production data or production configuration without explicit authorization.
- Do not execute SQL, migrations, or destructive operations during an audit-only task. Never contact a live Supabase project unless explicitly told to.
- Preserve existing data, uncommitted changes, and existing interface patterns unless the user approves a change.
- Work in phases and wait for approval between phases. Do not silently invent product policy; ask about anything in section 14.

# CONNECT-Daet.ai — Revised Workflow Plan

**System:** CONNECT-Daet.ai  
**Purpose:** Document Submission and Approval System  
**Status:** Current agreed workflow and source of truth for intended behavior

> This document describes intended behavior, not the state of the application or any deployed database. Items explicitly identified as open decisions are not approved requirements. Do not infer implementation from this document or infer live database state from repository files.

## 1. Roles and responsibilities

| Role | Agreed responsibility |
|---|---|
| `user` | Document submitter. Submits documents, tracks progress, responds to requests for changes or clarification, and resubmits corrected versions. |
| `approver` | Tourism Officer. Performs initial screening and evaluation, decides whether and how to involve municipal offices, coordinates reviews and reassessments, and makes the overall final decision. |
| `external_approver` | Concerned municipal office personnel. Reviews assignments for offices to which they belong and returns findings, decisions, or recommendations to the Tourism Officer. |
| `admin` | Tourism Head and System Administrator. Owns and oversees the system; manages users, roles, municipal office memberships, permissions, and system configuration. |

The Tourism Head is **not** a mandatory approval stage for every submission. There is no mandatory administrative routing-verification stage. Administrative oversight and configuration do not make the administrator a document approver.

Every submission begins with Tourism Officer review. A municipal office, including the Mayor's Office, participates only when the particular document's requirements call for it. The Mayor's Office is not a universal final approval stage.

Use the generic `external_approver` role for municipal office personnel; do not create a separate system role for each office. A representative may belong to multiple offices, and an office may have multiple representatives. The Tourism Head/System Administrator manages office memberships. Each office has a shared assignment queue accessible to its authorized representatives. Only one official decision is accepted for an active assignment; the system records the representative who acted, and other representatives have read-only access to that decision. Only the Tourism Officer may initiate reassessment.

## 2. End-to-end workflow

### Stage 1 — Submission

- The user submits the document with the required information and attachments.
- The user selects a document type and destination department where applicable.
- Every submission enters Tourism Officer initial review; routing must not bypass this stage.

### Stage 2 — Tourism Officer initial review

The Tourism Officer screens and evaluates the submission, checks whether it is ready for review, and identifies the permissions, clearances, evaluations, or recommendations required from municipal offices. Distinguish incomplete submissions that need correction, requests for clarification, and submissions that cannot proceed. When a submission cannot proceed under the applicable office requirements, the Tourism Officer may issue a **final overall rejection**, not an office-level rejection. The Tourism Officer must record the rejection reason and notify the submitter. The rejected document does not proceed to municipal office routing or Tourism Officer final review. This outcome is distinct from a request for changes or clarification, which may result in a correctable **RETURNED** submission. The applicable rejection criteria are not defined here and must not be inferred.

The Tourism Officer personally decides whether additional municipal offices are needed, which offices participate, each office's responsibilities and responsibility types, and the routing method. The system must not automatically determine recipients from document type, category, or predefined automatic-routing rules. It provides tools to create and manage assignments, record decisions, enforce requirements explicitly assigned by the Tourism Officer, and maintain workflow history.

If the Tourism Officer does not issue an initial-review final overall rejection or a request for changes, the submission proceeds to one of two paths:

#### Path A — No additional offices required

1. The Tourism Officer completes the initial evaluation and verification.
2. If no additional municipal office involvement is required, the Tourism Officer performs the final review.
3. The Tourism Officer makes the overall decision to **APPROVE**, **RETURN**, or **REJECT** the submission as appropriate.
4. The system records the final decision and notifies the submitter.

#### Path B — Additional offices required

1. The Tourism Officer manually selects the concerned municipal offices and specifies each assignment's responsibilities, requirements, instructions, and responsibility type.
2. The Tourism Officer chooses simultaneous routing or one-at-a-time routing.
3. Offices perform only their assigned responsibilities and return their decisions, findings, or recommendations to the Tourism Officer.
4. The Tourism Officer reviews each response as it arrives and decides whether to add, modify, or cancel assignments, or take another appropriate action.
5. Once all required mandatory assignments are satisfied, the Tourism Officer performs final review and makes the overall decision to **APPROVE**, **RETURN**, or **REJECT**.
6. The system records the decision and notifies the submitter.

The Tourism Officer may select multiple offices for simultaneous routing. Their assignments are sent at the same time and processed independently. The Tourism Officer may review responses as soon as they arrive and add another office while existing reviews continue. Final approval remains blocked until all mandatory assignments are satisfied.

For one-at-a-time routing, the Tourism Officer assigns one office, reviews its response, and decides whether to assign another office. The Tourism Officer controls each subsequent step; the system must not automatically forward a submission from one office to another.

Office-level decisions apply only to their assigned responsibilities and are not overall submission decisions. A denied or unresolved mandatory requirement blocks overall approval. A negative evaluation or recommendation is not by itself a veto.

### Stage 3 — Tourism Officer final review

- The Tourism Officer may proceed to final review only after every active office responsibility has received a response or has been validly resolved.
- Mandatory Approval / Clearance must receive an approval. A denied or unresolved mandatory requirement blocks overall approval.
- Evaluation / Verification requires a submitted evaluation, but a negative evaluation is not automatically a veto.
- Recommendation requires a submitted recommendation, but remains advisory.
- Validly cancelled assignments are excluded from completion requirements, subject to the existing mandatory-assignment safeguards.
- For Path A, the Tourism Officer performs final review after initial evaluation when no additional office review is required.
- For Path B, final review occurs after all required office decisions are satisfied.
- The Tourism Officer reviews office responses, ensures every mandatory assignment is satisfied, and makes the overall decision to approve, return, or reject the submission.
- The Tourism Head does not perform an intermediate or final document approval.
- No final approval may bypass an unsatisfied mandatory permission or clearance.

### Stage 4 — Completion and notification

The Tourism Officer's final overall decision may be **APPROVED** or **REJECTED**. These are final decision outcomes and must be distinguished from **COMPLETED**, which means the workflow is closed after its required actions have concluded. **RETURNED** means the submitter may correct or supplement the submission; it is a non-final, correctable outcome, not a final rejection.

The final decision, status change, and relevant history are recorded, and the submitter is notified. Exact status values and the conditions and timing for closing the workflow as **COMPLETED** are open decisions unless specified elsewhere in this plan.

## 3. Office responsibility types, decisions, and change requests

The Tourism Officer classifies every office assignment as one of the following responsibility types. One office may have multiple independently classified responsibilities within a submission. Each responsibility is tracked separately and may have a different outcome from another responsibility assigned to the same office. Do not assume that one office-level decision can represent multiple responsibility outcomes. The implementation roadmap should treat the appropriate assignment and response data structure as a design item for multi-responsibility handling.

### Mandatory approval or clearance

- The office must grant the required approval or clearance.
- An unresolved or denied mandatory requirement blocks overall approval.
- An unresolved or denied mandatory requirement must not be downgraded to Evaluation or Recommendation, or cancelled, to bypass its approval requirement.
- A denied requirement is returned to the Tourism Officer for evaluation. The Tourism Officer decides whether it may be corrected or whether the submission should be finally rejected.
- Any legitimate correction to an assignment must preserve the original assignment and its history, including the actor, reason, and timestamp.
- Preserve the existing rule that mandatory requirements cannot be bypassed.

### Evaluation or verification

- The office evaluates a specific aspect of the submission and records findings, assessment results, and remarks.
- A negative evaluation does not automatically reject the overall submission.
- The Tourism Officer may approve the overall submission if all mandatory requirements are satisfied.

### Recommendation

- The office provides professional or administrative advice.
- A recommendation is advisory; a negative recommendation is not automatically a veto.
- An office may recommend involving another municipal office, but only the Tourism Officer decides whether to create that assignment and determines its responsibility type and routing method.

### Office responses and change requests

Concerned offices may approve or reject their assigned requirement, provide findings and remarks, suggest changes or clarification, recommend another office, and attach relevant evaluation documents or messages to their response. An office's response is returned to the Tourism Officer. Concerned offices cannot directly forward submissions to other offices and cannot issue formal requests for changes to the submitter.

Only the Tourism Officer may issue a formal request for changes or clarification to the submitter. This applies to initial review, office feedback, a correctable mandatory rejection, and requests for additional information. Such a request is distinct from final overall rejection.

When an office rejects a mandatory approval or clearance, it records its decision and explanation and returns it to the Tourism Officer. The Tourism Officer evaluates the finding and may return the submission for correction if the issue is correctable, or issue a final overall rejection if it cannot be resolved. The system must never allow overall approval while a mandatory requirement remains denied or unresolved.

### Resubmission and reassessment

1. The Tourism Officer returns the submission to the sender with the formal request.
2. The sender provides a corrected document or requested information.
3. The revised submission returns to Tourism Officer review.
4. The Tourism Officer evaluates the new version and selects which previously involved offices need reassessment.
5. Only selected offices receive reassessment; unaffected approvals remain valid and are not unnecessarily repeated.
6. The Tourism Officer initiates reassessment using the existing office assignment rather than creating an unnecessary duplicate. The assigned office may update its current decision.
7. The Tourism Officer performs final review when all required decisions are satisfied.

Retain previous document versions and office decisions. Never overwrite or delete previous office decisions. Reassessment must append a new decision event or version. The latest valid decision becomes the current effective decision, while previous decisions remain available in the audit history. Record each decision change, acting representative, timestamp, remarks, and relevant document version in workflow history. Only the Tourism Officer can initiate reassessment.

### Office assignment management

The Tourism Officer may add offices at any point during processing, modify instructions or responsibilities, change an assignment's responsibility type when justified, and cancel an unnecessary assignment. Record the actor, timestamp, and reason for each modification or cancellation; preserve the original assignment and its history. Notify an affected office of cancellation when appropriate. A denied mandatory clearance must not be cancelled or removed to bypass its rejection.

The Tourism Officer retains centralized routing authority. Direct office-to-office forwarding is not part of this workflow. The system must preserve simultaneous and one-at-a-time routing options while keeping routing controlled by the Tourism Officer.

## 4. Approval path terminology

Preserve the original path labels and descriptions as routing categories. Their meaning under the Tourism Officer-centered workflow is not fully specified; the entries below do not override the requirement that every submission begins with Tourism Officer review.

| Type | Original terminology and description | Relationship to the agreed workflow |
|---|---|---|
| A — Department Only | Responsible department handles the document. | Ambiguous: the Tourism Officer is the initial and final reviewer, but it is not specified whether “department” means the Tourism Office alone or includes another responsible department. |
| B — External Only | Requires an external office. | Ambiguous: every submission still starts with Tourism Officer review; the relationship between this label and the required Tourism Officer final review needs clarification. |
| C — External + Department | External approval followed by final review by the responsible department. | Ambiguous: the Tourism Officer is the overall final approver, but the roles of the responsible department and the order relative to Tourism Officer initial review need definition. |
| D — Multiple Offices | Configured multi-step approval chain. | Supports the need for one or more concerned offices, including parallel or sequential reviews; the exact relationship between this label and the other paths remains open. |

Do not invent distinctions between these categories. Clarify their intended scope and precedence before using them to define routing or permissions.

## 5. Workflow history and supporting features

The workflow must preserve the following plan features:

### Document version history

- Retain previous uploaded files.
- Record each version, uploader, and date.
- Keep prior workflow decisions and history when a revised version is submitted.

### Workflow tracking and audit history

- Track actions, status changes, office assignments and their responsibility types, assignment modifications and cancellations, routing method, office decisions and recommendations, requests for changes, resubmissions, reassessments, revised versions, and overall decisions.
- Record initial-review final overall rejections and their reasons in the workflow audit history.
- Record who acted and when, including the specific office representative responsible for each official decision.
- Preserve prior office decisions when reassessment changes the current decision; record the acting representative, timestamp, remarks, and document version for each decision change.
- Preserve a separate, uneditable audit history.
- Keep office-level progress distinguishable from the overall submission lifecycle.
- Record initial-review final overall rejections in the workflow audit history and record the rejection reason.

### Document messaging and private staff notes

- Support comments and discussions related to a document.
- Support private staff notes restricted to authorized staff.
- Define access and visibility by role and responsibility; private notes must not be exposed to submitters or unauthorized offices.

### Notifications

- Notify the submitter of the final decision and relevant requests or status updates.
- Notify the submitter when an initial-review final overall rejection is recorded.
- Support notifications needed for office assignments, office recommendations for additional involvement, decisions, and Tourism Officer coordination.
- Exact event triggers, recipients, channels, and timing remain open decisions.

### Points and rewards

- Preserve the plan that points are awarded only after final approval.
- Track points balance and history.
- Points eligibility, calculation, recipient, and handling of later changes or reversals remain open decisions; do not award points for an office-level approval alone.

### Reports and analytics

- Preserve reports and analytics as workflow features.
- Reporting measures, roles allowed to view reports, and aggregation rules remain to be defined.

## 6. Security and data-integrity requirements

1. Use Supabase Row Level Security (RLS) for applicable data and storage access.
2. Enforce document- and office-level permissions in backend/database controls, not only by hiding UI elements.
3. Restrict access based on role, office membership, assignment, and authorized responsibility. All authorized representatives of an assigned office may access its shared queue, but only one official decision may be recorded for an active assignment; other representatives then have read-only access to that decision.
4. Only the Tourism Officer may create, modify, or cancel office assignments and initiate reassessment. Enforce these permissions in backend/database controls.
5. Prevent unauthorized approvals and workflow-step skipping. A denied or unresolved mandatory requirement must block overall approval and cannot be bypassed by cancelling its assignment.
6. Preserve a separate, uneditable audit history of workflow actions, including the representative acting for an office.
7. Apply secure storage access to uploaded files and retained document versions.
8. Apply database changes carefully to protect existing data.

These are workflow security requirements; this document does not establish whether the current application or any deployed database satisfies them.

## 7. Digital and offline office processing

Concerned offices may participate through the system. The original plan also described an offline option in which an office follows its existing process and authorized staff record its decision and attach supporting proof when available.

The offline option remains part of the prior plan, but its evidence handling, access policies, and operational details are not defined here. This document does not approve changes to Storage policies or offline-evidence handling. Those details require separate review and approval.

## 8. Open decisions requiring human approval

The following details are unresolved. They must not be treated as approved rules or filled in by assumption:

1. **Office authority:** Which municipal offices may decide which requirements, and what formal policies govern maintaining those responsibility assignments?
2. **Approval path meanings:** How do Department Only, External Only, External + Department, and Multiple Offices map onto mandatory Tourism Officer initial and final review? What distinguishes overlapping paths?
3. **Office review lifecycle:** Which exact office-level status values and transitions are needed, and how are they kept separate from overall submission states?
4. **Notifications:** Which events notify which roles, through what channels, and at what point?
5. **Points eligibility:** Who receives points, how are they calculated, and how are corrections or reversals handled?
6. **Reports and analytics:** Which measures are required and who may access them?
7. **Offline processing:** What evidence is required, who may record it, and how should access and retention be governed?

## 9. Interpretation and implementation guidance

- Treat this document as the source of truth for intended workflow behavior. Distinguish agreed requirements from the open decisions in Section 8.
- Every submission begins with Tourism Officer review. The Tourism Officer controls office selection, responsibilities, routing method, assignment changes, reassessment, and the overall final decision. Do not automatically route based on document type, category, or predefined routing rules.
- Municipal office decisions remain scoped to their assigned responsibilities. Office responses and recommendations return to the Tourism Officer; offices do not directly forward submissions or formally request sender changes.
- A denied or unresolved mandatory requirement blocks overall approval. Evaluation and recommendation outcomes are not automatic overall vetoes.
- Only the Tourism Officer issues formal sender change requests and determines which offices reassess revised versions. Preserve earlier versions, assignments, and decisions.
- Do not infer detailed office statuses or database structures beyond the agreed distinction between office-level progress and overall submission state.
- Do not infer implementation or deployed database state from this plan, application filenames, local migrations, or historical database notes. Inspect the relevant evidence and report uncertainty.

## 10. Copilot instructions

When auditing or implementing the project:

- Compare the actual application and repository schema against this plan; do not claim a feature is implemented merely because a document, file, table, or function exists.
- Identify gaps and conflicts before proposing implementation.
- Ask for human decisions on unresolved items rather than inventing rules.
- Do not change production data or configuration without explicit authorization.
- Do not execute SQL, migrations, or destructive operations during an audit-only task.
- Preserve existing data and UI patterns unless the user approves a change.

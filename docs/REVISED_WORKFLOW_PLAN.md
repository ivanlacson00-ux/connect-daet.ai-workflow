# CONNECT-Daet.ai — Revised Workflow Plan

**System:** CONNECT-Daet.ai  
**Purpose:** Document Submission and Approval System  
**Source:** User-provided revised workflow overview diagram

> This document records the intended workflow. It is the reference for expected system behavior. It does not prove that a feature has already been implemented.

## 1. User roles and responsibilities

### Submitter
- Uploads documents.
- Tracks submission status.
- Responds to requests for changes.

### Department Officer
- Receives and reviews submissions for the department.
- Requests changes when needed.
- Forwards documents for additional approvals.
- Records decisions and may approve where the configured rules allow it.

### External Approver
- Approves, rejects, or requests changes.
- May participate digitally or through an offline process.

### System Administrator
- Manages departments, users, permissions, document types, and approval rules.
- System administration does **not** automatically grant approval authority over every document.

## 2. End-to-end workflow

The diagram shows these six stages:

1. **Submission**
   - The submitter uploads a document.
   - The submitter selects the document type and destination department.
   - The system may suggest a department based on the document type.

2. **Department Review**
   - The responsible department officer receives and reviews the submission.
   - The officer may request changes, forward the document for additional approvals, or approve it when the configured rules permit.

3. **Check Approval Rules**
   - The system checks the document type and applies the configured approval rules.
   - It determines whether additional approvals are required.

4. **External Approval (if required)**
   - **Digital option:** The external approver logs in and records an approval, rejection, or request for changes.
   - **Offline option:** The document is processed through the external office's existing process. Authorized staff record the external decision and attach proof when available.
   - If more approvals are still required, the document proceeds to the next office in the configured order.

5. **Final Review**
   - The designated final decision-maker reviews the complete record and makes the final decision.

6. **Completion**
   - The document status is updated to **Approved**, **Declined**, or **Returned**.
   - The submitter is notified and can view the result and history.

### Request-for-changes loop

- When changes are requested, the submitter uploads a revised file.
- Previous file versions are retained in version history.
- The revised submission returns to department review, then follows the applicable approval rules again.

## 3. Approval rule examples

These are example paths shown in the diagram; actual routing should be driven by configured rules.

| Type | Approval path | Meaning |
|---|---|---|
| A — Department Only | Responsible department | Handled by the responsible department. |
| B — External Only | External office | Requires an external office's approval. |
| C — External + Department | External approval, then department final review | Requires external approval followed by final review by the responsible department. |
| D — Multiple Offices | Configured multi-step chain | Follows a multi-step approval chain based on the rules. |

## 4. Key workflow features

### File Version History
- Retains previous uploaded files.
- Records the version, uploader, and date for each version.

### Workflow History
- Tracks actions, status changes, and decisions throughout the workflow.

### Document Messaging
- Supports comments and discussions related to a document.
- Supports private staff notes; access to these notes must be restricted to authorized staff.

### Points / Rewards
- Points are awarded only after final approval.
- The system tracks points balance and history.

## 5. Important security and data-integrity rules

1. Use Supabase Row Level Security (RLS) for all applicable data and storage access.
2. Enforce document-level permissions in backend/database policies, not only by hiding UI elements.
3. Restrict access based on department, role, and assignment.
4. Prevent unauthorized approvals and prevent users from skipping required workflow steps.
5. Keep a separate, uneditable audit history.
6. Use secure storage policies for uploaded files and file versions.
7. Apply database migrations carefully to protect existing data.

## 6. Implementation interpretation notes

- The approval rules determine which roles may act at each stage. Do not assume every department officer, external approver, or administrator has universal approval authority.
- The administrator configures routing and permissions but does not automatically become the approver for all submissions.
- The digital and offline external-approval options are both part of the planned workflow. For offline approvals, the system still needs an authorized way to record the decision and attach supporting proof when available.
- A request for changes is not the same as a final rejection. The diagram distinguishes the request-for-changes loop from the final completion statuses.
- The diagram does not specify exact database table names, status enum values, API routes, notification channels, points formulas, or detailed permission matrices. Inspect existing project code and ask before inventing these details.

## 7. Copilot instructions

When auditing or implementing the project:

- Treat this document as the source of truth for intended workflow behavior.
- Compare the actual code and database schema against this plan; do not claim a feature is implemented merely because a file or table exists.
- Identify mismatches and missing requirements before proposing changes.
- Do not change production data or production configuration without explicit authorization from the user.
- Do not execute SQL, migrations, or destructive operations during an audit-only task.
- Preserve existing data and existing UI patterns unless the user approves a change.

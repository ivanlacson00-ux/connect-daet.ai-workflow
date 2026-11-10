# CONNECT-Daet.ai — Revised Workflow Plan

**System:** CONNECT-Daet.ai  
**Purpose:** Document Submission and Approval System  
**Source:** Revised workflow decisions

> This document records intended behavior and is the reference for implementation. It does not assert that every described feature is already implemented.

## 1. User roles and responsibilities

The application role codes are `submitter`, `tourism_officer`, `municipal_treasurer`, `mayor_office`, `sangguniang_bayan`, and `system_admin`. These codes identify account roles; route URLs and legacy database object names may retain their existing names.

### Submitter
- Uploads documents, selects one initial destination from the offices available to them, and tracks the submission.
- Responds to requests for changes and can view the submission history and outcome.
- Chooses the initial destination, including the Daet Tourism Office. A Tourism Officer does not have to receive or approve submissions addressed to a municipal office before they reach that destination.

### Tourism Officer
- May receive and review submissions according to configured routing and permissions; the Tourism Officer is not a mandatory first reviewer.
- When the submitter selected the Daet Tourism Office, reviews the submission and designates the municipal office that will make the final decision. The Tourism Officer does not make that final decision by virtue of receiving the submission.
- After receiving and reviewing a submission, may create assignments for additional offices when needed; these assignments are optional for Tourism Office-selected submissions.
- Specifies whether those additional office assignments proceed simultaneously or sequentially, subject to configured workflow rules.
- Records a final decision only where the configured authority permits; this workflow does not confer municipal final-decision authority on the Tourism Officer.

### Municipal office
- Receives a submission routed directly to it when selected by the submitter, or receives an additional assignment created by the Tourism Officer.
- Performs the responsibility assigned to it: **Mandatory Approval/Clearance**, **Evaluation/Verification**, or **Recommendation**.
- May optionally forward a reviewed submission to the Tourism Officer for further review and additional office assignments.
- Its designated authorized decision-maker may make the final decision without Tourism Officer involvement when the configured authority permits it.
- May request changes, and authorized staff may record a decision and supporting evidence for an offline process.

### External Approver
- Participates when configured as an assigned office or approver.
- Approves, rejects, requests changes, or records another permitted outcome according to the assigned responsibility and configured authority.
- May participate digitally or through an offline process.

### System Administrator
- Manages offices, users, permissions, document types, and approval rules.
- System administration does **not** automatically grant approval authority over every document.

## 2. End-to-end workflow

1. **Submission and destination selection**
   - The submitter uploads a document and selects one initial destination from the destinations available to them: a municipal office or the Daet Tourism Office.
   - After selecting a destination, the document-type dropdown lists only the types configured for that destination. Each municipal office offers **Other**, which reveals a required custom document-type field. Until the Tourism Office's official document-type list is configured, its available type is **Other** only.
   - Changing the destination clears the previously selected document type and any custom text because those values are office-specific.
   - The system may suggest destinations based on document type, but the submitter controls the selection.
   - The initial submission is routed directly to the selected destination; it is not required to pass through the Tourism Officer first.

2. **Initial municipal destination review**
   - The selected office receives and reviews the submission according to its assigned responsibility and configured permissions.
   - If the office's designated authorized decision-maker has final authority under the configured rules, that person may make the final decision directly, without Tourism Officer involvement.
   - Otherwise, or when further coordination is needed, authorized office staff may optionally forward the reviewed submission to the Tourism Officer. The Tourism Officer is not a mandatory stage.

3. **Tourism Office-selected submission and Tourism Officer review**
   - When the submitter selects the Daet Tourism Office, the submission routes directly to the Tourism Officer for review.
   - The Tourism Officer must designate one municipal office as the final-decision office before routing the submission onward. The designated office's configured authorized decision-maker—not the Tourism Officer—makes the final decision.
   - The Tourism Officer may assign additional offices when needed; the designated final-decision office may also be included when it must perform a separately classified assignment.
   - The Tourism Officer also receives a submission when an initial municipal destination forwards it after review, or when another configured workflow route assigns it. In this forwarded path, the submitter-selected municipal office retains final-decision authority.
   - After receiving and reviewing a submission, the Tourism Officer may assign one or more additional offices; the additional assignments are optional for submissions initially addressed to the Tourism Office.
   - Each additional office assignment identifies its responsibility as **Mandatory Approval/Clearance**, **Evaluation/Verification**, or **Recommendation**.
   - The Tourism Officer-created assignments may run simultaneously or sequentially. For sequential routing, later work waits on the configured prerequisite(s); for simultaneous routing, eligible offices can work in parallel.
   - These are additional assignments, distinct from the submitter's initial destination selection. Creating them does not retroactively change who selected the initial destination or, in the forwarded municipal path, who holds final-decision authority.

4. **Configured decision and approval requirements**
   - The system applies the configured rules for document type, office responsibility, assignment order, and decision authority.
   - Final decision authority is configured by the designated municipal office and document type. A document-type-specific configuration takes precedence over that office's default authority.
   - The actual final decision-maker must have an active membership in the relevant office and the configured authorized office role. Record the acting user's identity and decision timestamp in audit history.
   - If neither a matching document-type authority nor an office default exists, prevent final approval and report that authority configuration is missing. Do not grant final authority automatically to the Tourism Officer or System Administrator.
   - Mandatory approvals/clearances must be satisfied before completion when configured as required.
   - Evaluation/Verification assignments produce an evaluation or verification result; Recommendation assignments produce advice for the authorized decision-maker. Neither label alone grants final approval authority.
   - The designated decision-maker with configured authority makes the final decision. The Tourism Officer is involved only when routed or assigned, not as a universal approval gate.

5. **Completion**
   - The system records the permitted final outcome, updates the submission status, and notifies the submitter.
   - The submitter can view the result and workflow history.

### Request-for-changes loop

- An authorized office or decision-maker may request changes under the configured workflow rules. A request for changes is not a final rejection.
- The submitter uploads a revised file; previous file versions remain available in version history.
- The submission returns to the office or workflow stage that requested changes, or another configured resumption point. It then continues through any still-required approvals and assignments; completed requirements are not presumed to need repeating unless the configured rules require it.
- If an additional assignment is still underway when changes are requested, the system follows its configured policy for pausing, cancelling, or retaining that assignment. That policy must be explicit in implementation rather than inferred.

## 3. Approval rule examples

These are illustrative paths; configured rules determine actual routing and authority.

| Type | Example path | Meaning |
|---|---|---|
| A — Direct municipal office decision | Submitter selects a municipal office → office's authorized decision-maker | The office may decide finally without Tourism Officer involvement when authority configuration permits. |
| B — Tourism Office destination | Submitter selects Daet Tourism Office → Tourism Officer review and municipal final-office designation → designated office's authorized decision-maker | Additional Tourism Officer-created assignments are optional; the Tourism Officer does not make the municipal final decision. |
| C — Mandatory clearance | Submitter selects a destination → required office(s) provide Mandatory Approval/Clearance → authorized final decision-maker | All configured mandatory clearances are satisfied; the Tourism Officer is not implicitly inserted as a first step. |
| D — Tourism Officer adds parallel work | Initial municipal destination → office forwards to Tourism Officer → Evaluation/Verification and Recommendation assignments run simultaneously → original destination's authorized decision-maker | Additional assignments are created after Tourism Officer review and may proceed in parallel. |
| E — Tourism Officer adds sequential work | Initial municipal destination → office forwards to Tourism Officer → office A completes required work → office B proceeds → original destination's authorized decision-maker | Additional assignments follow configured prerequisites/order. |
| F — Mixed route | Initial destination → Tourism Officer review and designation/routing when applicable → mandatory clearance(s), evaluation, and recommendation in configured order or parallel groups → designated municipal authorized decision-maker | Multiple offices retain distinct responsibility classifications; only a configured authority makes the final decision. |

## 4. Key workflow features

### File Version History
- Retains the original and revised uploaded files as numbered versions.
- Records the version, uploader, and date for each version.

### Office-specific document types
- Presents the office-specific document types from the shared application office configuration and validates the selected office/type against the database catalogue on submission.
- Presents only **Other** for Daet Tourism Office until its official document-type taxonomy is provided and configured.
- Stores the classification `Other` separately from the submitter's required custom description. Final-decision authority for a custom type is evaluated using the office's `Other` classification, not the free-text description.

### Workflow History
- Tracks actions, status changes, initial submitter-selected destinations, Tourism Officer-created additional assignments, assignment responsibility, routing mode/order, and decisions.
- Distinguishes initial destination selection, office-to-Tourism-Officer handoff, and later Tourism Officer-created assignments.
- Records the actual final decision-maker and decision timestamp.

### Document Messaging
- Supports comments and discussions related to a document.
- Supports private staff notes; access to these notes must be restricted to authorized staff.

### Points / Rewards
- Points are awarded only after final approval.
- The system tracks points balance and history.

## 5. Important security and data-integrity rules

1. Use Supabase Row Level Security (RLS) for all applicable data and storage access.
2. Enforce document-level permissions in backend/database policies, not only by hiding UI elements.
3. Restrict access based on office, role, assignment, and the submitter's permitted destination choices, including the Daet Tourism Office route.
4. Validate submitter-selected destinations server-side against the destinations available to that submitter; do not allow client input to grant access or authority.
5. Show only document types configured for the selected office and validate the office/type pair against the database catalogue server-side. Require a bounded custom description for `Other`, and do not accept custom text for a standard type.
6. Validate Tourism Officer-created assignments, their responsibility classifications, parallel/sequential mode, and prerequisites against configured permissions and workflow rules.
7. Configure final authority by the designated municipal office and document type, with an office-wide default used only when no document-type-specific configuration applies. Only a user with active membership in that office and the configured authorized office role may make the final decision. For an initial Daet Tourism Office destination, require the Tourism Officer to designate this municipal office; never treat the Tourism Officer's review as the municipal final decision.
8. If no applicable final-authority configuration exists, prevent final approval and surface the missing configuration. Do not automatically grant final authority to the Tourism Officer or System Administrator.
9. Prevent unauthorized approvals and prevent users from skipping required workflow steps. Permit direct office final decisions only when the designated decision-maker's configured authority allows them.
10. Keep a separate, uneditable audit history that records who selected or assigned each office, responsibility, routing mode, actual decision-maker and decision time, and changes.
11. Use secure storage policies for uploaded files and file versions.
12. Apply database migrations carefully to protect existing data.

## 6. Implementation interpretation notes

- The submitter controls one initial destination selection from the destinations they are allowed to choose: one municipal office or Daet Tourism Office. Route directly to that selection; do not force municipal-office submissions through a Tourism Officer.
- Classification/document-type choices depend on the selected destination and come from the office document-type catalogue. `Other` requires separate bounded free text; changing destination clears both the selected type and custom text. The custom text is descriptive and does not create an authority rule; an `Other` submission uses the office's `Other` authority configuration.
- Until the official Tourism Office document-type taxonomy is supplied, offer only `Other` for Daet Tourism Office rather than inventing categories.
- Initial submitter-selected destinations and Tourism Officer-created additional assignments are different workflow events and must remain distinguishable in data, permissions, UI, and history.
- A selected municipal office can optionally forward a reviewed submission to the Tourism Officer. The Tourism Officer may then create additional office assignments. Such assignments can be simultaneous or sequential, and each must preserve the office's responsibility classification: **Mandatory Approval/Clearance**, **Evaluation/Verification**, or **Recommendation**.
- A Tourism Office-selected submission goes to the Tourism Officer, who must choose its municipal final-decision office. Additional office assignments are optional in this path. When the initial destination was a municipal office and it later forwards to the Tourism Officer, the original municipal destination remains the final-decision office.
- Final authority is configured per municipal office and document type, with a document-specific entry taking precedence over the office default. The actual decision-maker must have an active membership in the office and the configured authorized office role. In the current application, `profiles.role` represents office membership and the configured role is constrained to that office role; a separate per-person designation or finer-grained office sub-role is not currently modeled. The system must report missing authority configuration and must not silently authorize a final decision.
- The selected office's designated authorized decision-maker can make the final decision without Tourism Officer involvement if configured authority permits. An office assignment or recommendation does not by itself confer final authority.
- The administrator configures routing and permissions but does not automatically become the approver for all submissions.
- Digital and offline external-approval options are both part of the planned workflow. For offline approvals, the system needs an authorized way to record the decision and attach supporting proof when available.
- A request for changes is not a final rejection. Require a revised document, preserve every file version and workflow-history entry, and resume at the configured point.
- Decisions not established by the agreed workflow and requiring product/configuration choices must not be silently invented. In particular, confirm: whether a distinct individual or finer-grained office sub-role must be designated as final decision-maker beyond the current `profiles.role` office membership; which Tourism Office document types should replace its interim `Other`-only option; how sequential dependencies and mixed parallel/sequential groups are configured; what happens to in-flight assignments after a change request; and which statuses/outcomes, notification rules, and points formulas apply.
- Exact database table names, status enum values, API routes, notification channels, points formulas, and detailed permission matrices are implementation details unless separately agreed. Inspect existing project code and preserve compatible conventions; ask before making consequential product-policy assumptions.
- The database office document-type catalogue is seeded through migrations and must remain synchronized with the shared application office configuration. A user interface for authorized administrators to maintain document types is not included unless separately requested.

## 7. Copilot instructions

When auditing or implementing the project:

- Treat this document as the source of truth for intended workflow behavior.
- Compare the actual code and database schema against this plan; do not claim a feature is implemented merely because a file or table exists.
- Ensure the UI, backend APIs, database functions, authorization policies, and audit history consistently support submitter-controlled municipal or Tourism Office initial destinations, direct routing, Tourism Officer designation of a municipal final-decision office for Tourism Office submissions, optional Tourism Officer involvement for municipal submissions, and additional Tourism Officer-created assignments.
- Ensure the upload UI filters document types by selected office, provides `Other` with a required description, and relies on backend validation against the database catalogue.
- Identify mismatches and missing requirements before proposing changes.
- Do not change production data or production configuration without explicit authorization from the user.
- Do not execute SQL, migrations, or destructive operations during an audit-only task.
- Preserve existing data and existing UI patterns unless the user approves a change.

# Phase 2 — Workflow Gap Analysis

**Status:** Read-only audit

**Workflow authority:** [Revised workflow plan](./REVISED_WORKFLOW_PLAN.md)

**Database target verified:** Supabase TEST project `bhbccqutreegqoohqzqb`

> This report separates checked-in repository evidence from metadata and function definitions observed in the live TEST database. A function, table, or UI component existing does not establish that the complete workflow works at runtime. No production project, database records, migrations, or write operations were used.

## 1. Executive summary

The application currently presents a legacy two-stage process: a submitter sends a document to an `approver`, then an `admin` approves, rejects, or completes it. That conflicts with the agreed Tourism Officer-centered workflow, where the Tourism Officer performs initial review and is the overall final approver; the Tourism Head/System Administrator is not a mandatory document approver.

There is a material mismatch at the submission boundary. The upload page calls TEST's `submit_document(...)`, which creates a submission with status `under_department_review`. The existing approver queue filters for `pending` and `pending_approver`, and the admin queue filters for `pending_admin`. The frontend does not call the newer department-routing and final-decision RPCs. Therefore source and schema evidence indicate that submissions created by the current upload page do not enter the review queues implemented by the current UI. This is a source-level incompatibility, not a claim based on a live end-to-end test.

TEST contains newer department approval structures and separate route-plan structures in addition to the older status-based workflow. These models partially support submissions, department review, ordered approval steps, decisions, notifications, versions, audit, and access controls. However, the route-plan model requires admin finalization and processes office roles sequentially; the department model uses a separate status vocabulary. Neither model is wired into the current review UI, and neither was verified to implement Tourism Officer-controlled assignment, both simultaneous and one-at-a-time routing, independent responsibilities within one office, or the final-review response gate in the revised plan. Direct office-to-office forwarding is not an agreed requirement.

Other high-impact gaps include:

- The application assigns the overall final decision to `admin`; the plan assigns it to the Tourism Officer.
- No implemented UI or app call sites were found for office review and Tourism Officer-controlled routing, revision upload, messaging, or private staff notes.
- TEST's profile role constraint does not include `external_approver`, although some function logic checks for that role. The exact mapping of `approver` to Tourism Officer and the corresponding department assignment was not verified from personal records and remains a design decision.
- The app displays rewards as a hardcoded count of 50 points per approved submission. TEST instead awards the configurable `workflow_settings.points_per_approval` amount on transition to `approved`; points policy details remain open in the plan.
- TEST has SECURITY DEFINER workflow functions for which `anon` has effective EXECUTE privilege. Their definitions contain actor/role checks, but the grants are unnecessary exposure that needs explicit security review. No anonymous call or exploit test was performed.
- The legacy `audit_logs` relation written by one application hook was not found in checked-in migrations; TEST has `workflow_audit_logs`.

The implementation should not proceed by adding another parallel workflow model. Resolve the remaining open office-authority, path-meaning, and status mappings, then choose/reconcile the existing TEST structures. Preserve the already agreed Tourism Officer control, routing options, responsibility types, response gate, mandatory safeguards, and append-only reassessment rules when aligning the application, database transitions, and permission policies.

## 2. Audit scope and methodology

### Repository inspection

Inspected the workflow plan, documentation index, application route structure, registration and login, middleware, dashboards, submission and review pages, hooks, reports, notification pages/layout, email route, and the 15 checked-in SQL migrations under `supabase/migrations/`.

The project is a Next.js 16 / React 19 application using Supabase JS and SSR clients. `package.json` provides `dev`, `build`, `start`, and `lint` scripts but no test script. No test/spec files were found by the repository glob used in this audit. No application was built or exercised in this read-only audit.

### Live TEST inspection

- The configured read-only connection resolved to project reference `bhbccqutreegqoohqzqb` before catalog inspection.
- Connection metadata reported database `postgres`, role `supabase_read_only_user`, schema `public`, PostgreSQL `17.11`.
- Read-only catalog queries inspected tables, columns, constraints, selected function definitions and grants, triggers, RLS policies, table grants, migration-history availability, and Storage bucket/policy metadata.
- No application records or personal user records were retrieved. No migration, mutation, RPC action, or database write was executed.

### Evidence limits

- These findings establish source and catalog state only. They do not prove that the web app, email sender, realtime feeds, uploads, or any complete workflow succeeds at runtime.
- The live migration registry did not provide a usable record of custom project migrations. Local migrations are not evidence of deployment.
- The audit deliberately did not inspect offline approval evidence contents or change Storage/offline-evidence handling. The workflow plan defers those details pending separate consultation.
- The canonical security migration's local SHA-256 matches the supplied approved hash, but this alone cannot establish that the file's contents were applied to the live database.

## 3. Current application architecture

| Area | Repository evidence |
|---|---|
| UI and route structure | Next.js App Router under `app/`; workflow pages are grouped under `app/(dashboard)/workflow/`. |
| Authentication | Supabase browser/SSR clients; registration is in `app/(auth)/register/page.tsx`, login in `app/(auth)/login/page.tsx`, and `middleware.ts` gates `/workflow/*` routes. |
| Data and workflow operations | Client components and hooks use Supabase table queries and RPC calls directly. No workflow server-action layer was found. |
| Submission | `app/(dashboard)/workflow/user/upload/page.tsx` uploads to `workflow_uploads` and invokes `submit_document(...)`. |
| Review | Approver and admin pages directly update `workflow_submissions.status`; the shared `hooks/useSubmissions.ts` also performs admin status changes. |
| Reporting | `app/(dashboard)/workflow/admin/reports/page.tsx` derives report rows and measures from `workflow_submissions` and nested `workflow_audit_logs`. |
| Email | `app/api/notifications/email/route.ts` reads the outbox using a service-role client and sends a batch through Resend when called with the configured cron authorization. Runtime configuration and delivery were not tested. |
| Tests | No test script or test/spec files were found. |

## 4. Existing functionality

### Implemented in source, with limits

- Email-confirmation registration submits a `user` role in signup metadata. TEST's `handle_new_user()` trigger creates the profile with role `user`, and `sync_role_to_app_metadata()` copies profile role into auth app metadata.
- Login redirects `admin` and `approver` to their corresponding workspaces; other roles go to the submitter workspace.
- The submitter can select a destination department, title, description, and one primary file. The category is hardcoded to `General`; the file input does not implement the workflow's multiple-attachment requirement.
- The upload page validates the selected file, uploads it, and calls the database submission RPC. TEST's `submit_document(...)` creates a submission and its first `document_versions` row.
- Notification pages and a sidebar unread indicator query `workflow_notifications`; the email API route implements an outbox-processing loop in source.
- Admin reports query submissions and `workflow_audit_logs`, with status counts, date filters, stage timing, and processing-time calculations.
- The admin submission detail page has archive UI wired to `set_workflow_submission_archive(...)`.

### Present but incomplete or conflicting

- `approver` review is a one-decision screen that marks a submission `pending_admin` or `declined_by_approver`; it does not represent assigned office requirements.
- The admin review screen is explicitly the "final review" and writes `approved`, `declined_by_admin`, or `completed`. This conflicts with the approved Tourism Officer final decision.
- Submitter and report status maps use the legacy status vocabulary and do not comprehensively handle TEST's `under_department_review`, `awaiting_additional_approval`, `awaiting_final_review`, `returned_for_requirements`, `declined`, and other newer states.
- The user dashboard computes its "Reward balance" as `approved-or-completed count * 50`; it does not read `points_ledger` or workflow settings.
- The application reads `workflow_audit_logs` for activity but `hooks/useSubmissions.ts` inserts into `audit_logs`. No local migration defines `audit_logs`; no matching table was confirmed in the inspected TEST schema.
- User management supports only `user`, `approver`, and `admin`; it directly updates profile roles and deletes profile rows. No external-office dashboard or assignment editor was found.

## 5. Live TEST database structure

### Workflow-related public tables

Catalog inspection found the following 16 workflow-related public tables; RLS is enabled on all 16, and `FORCE ROW LEVEL SECURITY` is false:

1. `approval_steps`
2. `departments`
3. `document_messages`
4. `document_versions`
5. `mandatory_approval_rules`
6. `points_ledger`
7. `profiles`
8. `workflow_audit_logs`
9. `workflow_email_outbox`
10. `workflow_notifications`
11. `workflow_routing_plans`
12. `workflow_routing_steps`
13. `workflow_settings`
14. `workflow_submission_attachments`
15. `workflow_submissions`
16. `workflow_tracking_sequences`

The submission table contains both legacy-stage columns (`approver_id`, `admin_id`, comments and action timestamps) and newer workflow columns (`destination_department_id`, `routing_decision`, `current_version_id`, `selected_office_role`, and stage/assignment fields). This is evidence of overlapping lifecycle designs, not proof that all paths are used.

### Relationships and constraints

- `workflow_submissions` is related to profiles, departments, archive actors, and its current document version.
- `document_versions` relates versions to submissions and uploaders. `approval_steps` relates steps to submissions, versions, departments, profiles, and mandatory rules.
- `workflow_routing_plans` relates a submission to a versioned plan; `workflow_routing_steps` relates ordered office-role steps to a plan.
- `workflow_submission_attachments`, messages, audit history, notifications, email outbox, and points also have foreign-key relationships in the inspected catalog.
- `approval_steps` requires a positive `step_order`, permits one of `pending`, `approved`, `rejected`, `changes_requested`, or `superseded`, and carries a `decision_mode` of `online` or `offline`.
- `workflow_routing_steps` restricts `office_role` to `municipal_treasurer`, `mayor_office`, and `sangguniang_bayan`; statuses include `pending`, `in_progress`, `approved`, `rejected`, and `skipped`. Route and sequence uniqueness, plus the active-step transition logic, enforce a sequential model.
- `workflow_submissions.status` has no single CHECK constraint that unifies the two status models. Status transitions are instead implemented through triggers and RPC logic.

The schema has structures for versions, mandatory rules, approvals, routing, attachments, messaging, audit, notifications, email, and points. Their existence does not establish that each is complete, wired to the application, or configured according to the agreed workflow.

### Functions and current behavior

| Function or group | Live TEST observation |
|---|---|
| `handle_new_user()` | SECURITY DEFINER trigger function on `auth.users`; creates a profile with role `user`. |
| `sync_role_to_app_metadata()` | SECURITY DEFINER profile trigger; copies `profiles.role` to `auth.users.raw_app_meta_data`. Its search path is `pg_catalog, public`; client anon/authenticated EXECUTE is false. |
| `submit_document(...)` | Requires an authenticated actor and active destination department; creates status `under_department_review`, first document version, and current-version link. |
| `decide_routing(...)` | Requires a destination-department officer and `under_department_review`; can move to `awaiting_final_review` or create ordered `approval_steps` and move to `awaiting_additional_approval`. |
| `decide_approval_step(...)` / `workflow_apply_step_decision(...)` | Requires current-version, pending, sequential step conditions. Reject/change decisions require a comment and return the submission to department review while superseding pending steps. |
| `final_decision(...)` | Allows a department-scoped final decision-maker to approve in `awaiting_final_review`, or to reject a submission blocked by unresolved rejection. Writes `approved` or `declined`. It stores the actor in the legacy `admin_id` field. |
| `request_changes(...)` | Exists as an authenticated workflow RPC; the application has no call site. |
| `propose_workflow_route(...)`, `finalize_workflow_route(...)`, `decide_workflow_route_step(...)`, `complete_workflow_after_route(...)` | Separate route-plan model. It uses office roles listed above, requires admin route finalization, processes office steps sequentially, and assigns completion to admin. |
| `request_workflow_route_requirements(...)` / `respond_to_workflow_route_requirements(...)` | Office requirement-request path. It returns a submission to the submitter for a response, then restores it to the same active office step; it does not implement Tourism Officer coordination or reassessment selection. |
| `post_message(...)` | Exists for shared/internal message visibility with authorization checks. No application messaging UI or invocation was found. |
| `record_offline_decision(...)` | Exists. Offline evidence and Storage policy behavior are deferred and are not evaluated here. |
| `award_points_on_approval()` | Trigger awards the configured `workflow_settings.points_per_approval` value (fallback 50) when a submission transitions to `approved`; inserts a `FINAL_APPROVAL` ledger entry. |

### Role and permission observations

- TEST's `profiles.role` CHECK permits `user`, `approver`, `admin`, `municipal_treasurer`, `mayor_office`, and `sangguniang_bayan`; it does not permit `external_approver`.
- `decide_routing(...)` checks an approver ID against `approver` or `external_approver`, so the latter path conflicts with the live profile constraint.
- `is_department_officer(...)` recognizes `approver` assigned to the destination department. `can_final_decide_for(...)` recognizes `approver` or `admin` with `can_final_decide` and the matching department. No profile rows or personal assignments were inspected, so the actual Tourism Officer mapping cannot be confirmed.
- `workflow_submissions` has effective authenticated UPDATE privilege; anon UPDATE/INSERT/DELETE were false. RLS and transition guards still apply, but the broad direct-update surface must be reviewed against the intended per-field and per-action policy.
- Several SECURITY DEFINER functions have effective EXECUTE for `anon`, including `admin_update_profile_role`, `create_workflow_submission`, `decide_workflow_submission`, route proposal/finalization/decision/completion functions, and related RPCs. Their definitions include actor or role checks; these grants were not exercised and are reported as an exposure requiring review, not as a demonstrated exploit.
- `workflow_audit_logs` exposes read policies for authorized submission viewers; audit writes are performed through database functions/triggers rather than a user-facing INSERT policy in the inspected policies.
- `document_messages` uses access checks for submission visibility and internal-note visibility. The application does not expose those functions.

### Storage

TEST has a private `workflow_uploads` bucket with a 20 MiB limit and an extension-compatible MIME allowlist. RLS is enabled on `storage.objects`. Policies include authenticated upload under the user's folder, deletion of unsubmitted files, and multiple SELECT policies.

One SELECT policy permits reads when the file is in the caller's own folder, `is_workflow_staff()` is true, or `is_workflow_file_accessible(name)` is true. The inspected `is_workflow_staff()` helper includes `approver` and `admin`; therefore that policy is broader than per-office assignment checks. Whether that matches the final Tourism Officer/admin access model needs explicit review. Overlapping permissive policies combine to permit access if any applicable policy allows it. No Storage changes are recommended here; offline evidence and Storage policy changes remain deferred.

The upload page obtains a public URL for a bucket catalogued as private, but the file-view API uses authenticated access and a five-minute signed URL from the stored path. The code path, not a live download test, was inspected.

### Migration history

The Supabase MCP migration listing returned no project migration entries. Catalog inspection found internal migration tables for `auth`, `realtime`, and `storage`, but no custom public migration-history table. The repository has 15 SQL files in `supabase/migrations/`; those files cannot be mapped to the live database as applied or unapplied.

The canonical security migration at `docs/proposed-migrations/001_security_hardening.sql` has local SHA-256 `b96c1fd56135e01f98983e464799d6c2d1a4df4018b5d5bc452f40f4b65ecb9f`, matching the supplied approved hash. Live settings were inspected independently; no migration was executed.

## 6. Requirement-to-implementation comparison

Classifications:

1. Implemented and verified in source.
2. Partially implemented.
3. Missing.
4. Implemented but conflicting with the revised workflow.
5. Cannot determine from available evidence.

These labels describe repository or catalog evidence, not end-to-end runtime verification. “Existing implementation” means a source or TEST database capability was observed; it does not prove that the complete behavior works. “Confirmed gap” means the required behavior was not found or is contradicted by the inspected evidence. The roadmap separately identifies proposed implementation tasks. “Unresolved design decision” is limited to items left open by the authoritative workflow plan; it must not be used to reopen requirements the plan has already settled.

| Requirement | Existing frontend | Existing backend / local migrations | TEST database support | Finding |
|---|---|---|---|---|
| Authentication and submitter registration | Signup and login pages exist; signup requests `user`. | Local and live profile-creation / role-sync mechanisms exist. | `handle_new_user()` creates `user`; role metadata trigger is active. | **2** — basic submitter auth exists; registration and authorization for the other agreed roles are not represented. |
| Roles: submitter, Tourism Officer, external office, Tourism Head/admin | Only `user`, `approver`, and `admin` UI roles. | Middleware checks only `admin` and `approver`. | Three external municipal role values exist, but `external_approver` is absent from role CHECK. | **4** — app model conflicts with the four-role specification and role naming is inconsistent. |
| Submission with type, department, required information, attachments | One file, title, description, destination department; category hardcoded `General`. | Upload calls `submit_document(...)`. | RPC creates a submission, tracking number, and first version; attachments table exists. | **2** — core single-file submission exists; type selection and multiple attachments are not implemented. |
| Every submission starts with Tourism Officer initial review | Upload UI says the selected department reviews first. | No Tourism Officer-specific initial-review page or RPC call in app. | `submit_document(...)` starts `under_department_review`; routing decision RPC is department-scoped. | **2** — a department review state exists, but the Tourism Officer identity and complete initial-review path cannot be confirmed. |
| Initial-review clarification, return, and justified final rejection | No initial-review rejection action distinct from the old approver decline. | No application call for the newer request/final-decision RPCs. | Newer final decision is primarily for final review; no distinct initial-review rejection path was established. | **3** — required outcome and audit/notification path not integrated. |
| Tourism Officer-controlled routing; simultaneous and one-at-a-time options | No office assignment or routing UI. | No Tourism Officer route-management call sites. | Route-plan model processes steps sequentially; approval-step decisions are also gated by earlier pending steps. | **3** — routing control and both routing options are not integrated; the live sequential structures do not establish simultaneous routing. |
| Responsibility types and multiple responsibilities within one office | No responsibility-type or separate responsibility-outcome UI. | No integrated assignment/response handling found. | `mandatory_approval_rules` and `approval_steps` exist, but their existence does not verify that multiple independently classified responsibilities for one office are represented and handled as required. | **5** — the suitable assignment/response data structure and handling are an implementation design item; no schema is assumed here. |
| Final review only after every active office responsibility responds or is validly resolved | No complete office-response gate in the review UI. | Existing queues/actions do not enforce the revised completion gate end to end. | Functions enforce some approval-step ordering and mandatory checks, but support for the complete responsibility-type gate was not established. | **3** — the final-review gate is not verified; it must account for required responses, valid resolution, and safeguarded cancellations. |
| Mandatory approval safeguards against cancellation or downgrading | No office assignment management or safeguard UI found. | No application action implements these safeguards. | Mandatory rules and approval-step functions exist, but no verified protection against downgrading or cancelling an unresolved/denied mandatory requirement was established. | **5** — behavior is not established by available evidence; implementation must preserve the mandatory requirement and its history. |
| Office decisions and Tourism Officer-initiated reassessment history | No office decision or reassessment UI. | No app invocation for coordinated reassessment; an audit hook also references `audit_logs`. | Decision and audit structures exist; the route-requirement response returns to the same office and does not implement Tourism Officer reassessment selection. Append-only decision events and latest-valid-decision semantics were not verified. | **3** — reassessment coordination and preservation of prior decisions are incomplete or unverified. |
| Office decisions distinct from overall decisions | Approver page has approve/decline buttons; the admin page has final approve/decline. | Legacy status updates combine stage names and decisions. | `approval_steps` and `final_decision(...)` separate some step and overall decisions. | **4** — database primitives distinguish some decisions; current UI/admin authority conflicts with the plan. |
| External digital/offline approval | No external-office or offline-decision UI was found. | No app invocation for offline recording. | `approval_steps` supports `online`/`offline`; `record_offline_decision(...)` exists. | **2** — database support exists but workflow integration and the deferred evidence design are unverified. |
| Tourism Officer overall final review; admin is not approver | Admin review UI performs final approve/reject/completion. | Direct admin updates to `approved`, `declined_by_admin`, `completed`. | `final_decision(...)` supports department-scoped actors but stores actor in legacy `admin_id`; parallel route RPCs require admin. | **4** — current frontend and one live model assign the decision/closure inconsistently with the agreed role. |
| Final statuses `APPROVED`, `REJECTED`, `COMPLETED`, correctable `RETURNED` | Legacy frontend groups `approved` and `completed` together; `declined_*` states are used. | Local transition migrations define legacy statuses. | TEST uses multiple distinct status vocabularies, including `approved`, `declined`, `completed`, and `returned_for_requirements`. | **4** — the models do not consistently preserve final decision versus workflow closure versus correction. |
| Change requests, submitter response, revised version, office reassessment | No correction/resubmission UI or new-version path found. | App does not call `request_changes(...)` or route-requirement RPCs. | Requirement response RPC returns to the same office; `document_versions` exists and initial submission creates version 1. | **4** — a limited return/response path exists but bypasses Tourism Officer coordination and lacks reassessment selection/version upload integration. |
| Document version history | No version history UI found. | Upload only creates a new submission; no app call for version append. | `document_versions`, current-version link, and version-aware approval checks exist. | **2** — schema and initial version creation exist; revision capture and user/staff history UI are missing. |
| Workflow audit history | Staff pages read `workflow_audit_logs`; no submitter audit timeline was found. | Local migration creates audit triggers; one hook still writes `audit_logs`. | `workflow_audit_logs` and triggers/RPC writes exist. | **2** — history is partly recorded/read; append-only decision history, reassessment attribution/versioning, and a uniformly immutable/read-only contract are not established. |
| Shared messages and private staff notes | No messaging UI or call site found. | No app call for `post_message(...)`. | `document_messages` supports shared/internal visibility and `post_message(...)` exists. | **2** — database mechanism exists; end-user behavior and role-based UI are missing. |
| Notifications and email | Notification pages, unread indicator, and email route exist. | Local migrations define notifications/outbox and worker route. | Notification/outbox tables and triggers exist. | **2** — source mechanisms exist; event coverage for the revised workflow and successful delivery are not verified. |
| Points/rewards | Dashboard multiplies approved/completed count by 50; no ledger read. | No app point-ledger integration found. | Ledger trigger uses configurable points setting on `approved`. | **4** — backend exists, but frontend formula and open eligibility/calculation decisions conflict with or outrun the agreed policy. |
| Reports and analytics | Admin reports derive totals and processing measures from legacy statuses/audit entries. | Report query is in source. | Submission timing and audit fields exist. | **2** — basic reports exist; report definitions and access rules are open, and measures are tied to the legacy lifecycle. |
| RLS, document and office authorization | Middleware gates broad routes; it is not a substitute for DB authorization. | Local migrations include RLS/transition guards. | RLS is enabled on all inspected public workflow tables; Storage has object policies; direct authenticated submission UPDATE is granted. | **2** — defenses exist, but role/office policy coverage, direct update surface, and effective grants require focused review. |

## 7. Missing and incomplete functionality

### Critical workflow integration gap

The upload page inserts into the newer status model (`under_department_review`), while the approver dashboard and detail page accept only `pending` and `pending_approver`; the admin queue filters only `pending_admin`. The application has no call site for the newer decision RPCs. Until the application and database agree on one status/API contract, the primary submission workflow has no verified route to a reviewer.

### Tourism Officer initial and final decision

The app's `approver` role does not identify a Tourism Officer in the UI or middleware, and it sends approved items to admin. TEST department review is based on `department_id`, while final authority is a per-department boolean. Actual role/department assignments were not inspected. A separate initial-review final rejection, reason, audit event, submitter notification, and no-routing/no-final-review behavior are not wired into the app.

### Office routing and reassessment

TEST has two overlapping representations: `approval_steps` with mandatory rules, and `workflow_routing_plans`/`workflow_routing_steps` with a limited list of office roles. The latter requires admin finalization and serializes decisions. The inspected structures and application do not verify Tourism Officer-controlled simultaneous and one-at-a-time routing or support for multiple independently classified responsibilities within one office. The route-requirements response returns to the same office rather than to the Tourism Officer for coordinated correction and reassessment selection. Direct office-to-office forwarding is not part of the target workflow.

### Correction/version loop

TEST can create a first version and has version-aware approval checks. The application has no resubmission/version upload path. The live route-requirement response stores sender comments but does not insert a new document version or route the updated document through Tourism Officer reassessment.

### Supporting features

- No application messaging/private-note interface.
- The app's points display is calculated locally instead of reading the ledger.
- Notifications exist but the event/recipient/channel rules remain open and the revised workflow events are not fully represented in the app.
- Reports summarize legacy status names and do not implement agreed, approved report measures (which remain an open decision).
- `audit_logs` versus `workflow_audit_logs` creates a probable stale relation reference in the app hook.

## 8. Incorrect or conflicting implementations

1. **Admin as final approver:** `app/(dashboard)/workflow/admin/submissions/[id]/page.tsx` and `hooks/useSubmissions.ts` provide the final approve/reject action to `admin`. The revised workflow assigns the overall decision to the Tourism Officer.
2. **Legacy two-stage UI versus newer upload RPC:** Upload creates `under_department_review`; review queues select legacy statuses and do not invoke newer routing/decision RPCs.
3. **Admin-only route finalization and closure:** The live route-plan model requires an admin to finalize and complete routes, contrary to no mandatory administrative approval stage.
4. **Mayor's Office route assumptions:** The live route proposal function forces the Mayor's Office last when included. The revised plan makes the Mayor's Office conditional, not a universal final stage. The ordering rule must not be generalized into an approved workflow requirement.
5. **Status vocabulary and reporting:** The UI maps some declined states as returned/correctable and groups `approved` with `completed`; the workflow plan distinguishes final decisions from closure and correctable returns.
6. **Role naming:** Some live functions test `external_approver`, but the profile role CHECK rejects it. The app exposes none of the municipal office roles in its management UI.
7. **Points display:** The UI assumes 50 points per approved/completed submission, while TEST uses a setting with fallback 50 and awards at `approved`; eligibility, recipient, reversal, and calculation remain unresolved.
8. **Audit relation reference:** `hooks/useSubmissions.ts` attempts inserts into `audit_logs`, while the local migration and live table observed are `workflow_audit_logs`.
9. **Office request coordination:** The live office requirement-return path goes from office to submitter and back to the same office, skipping Tourism Officer coordination and reassessment choice required by the plan.

## 9. Database and relationship gaps

- The live TEST schema is materially ahead of checked-in application integration and local migrations: no matches for the newer approval, version, routing-plan/step, messages, mandatory-rule, points-ledger, or submission-attachment objects were found in `supabase/migrations/`.
- The local migration set contains older status transitions, assignment history (including a later migration that drops the assignment table), audit, notifications, archive, file-storage, and stage-timing logic. These migrations do not describe the complete live TEST structure.
- Two lifecycle models coexist in TEST: the department/approval-step model and the workflow route-plan model, alongside legacy `approver`/`admin` fields and statuses. This increases the chance that grants, policies, triggers, and UI code apply inconsistently.
- The live route-plan constraints are sequential and limited to three office roles; they do not establish the required simultaneous routing option or the final assignment model. Office authority remains subject to the workflow plan's unresolved mapping.
- `approval_steps` step-order enforcement is explicitly sequential: a decision is rejected while any earlier step is pending.
- Neither the inspected schema nor application establishes a single office assignment containing multiple independently classified responsibilities with separate outcomes. The appropriate data structure is a design item, not an assumed requirement for a new table.
- The final-review contract must wait for a response or valid resolution for every active office responsibility. An approval is required for Mandatory Approval / Clearance; Evaluation / Verification requires a submitted evaluation but a negative result is not automatically a veto; Recommendation requires a submitted advisory recommendation. Validly cancelled assignments are excluded subject to mandatory-assignment safeguards. The inspected live structures do not establish that the full gate is enforced.
- An unresolved or denied mandatory requirement must not be cancelled or downgraded to bypass approval. The assignment correction must preserve the original assignment and actor, reason, timestamp, and history. No evidence established complete enforcement of these safeguards.
- Reassessment must be initiated by the Tourism Officer and append a decision event/version without overwriting prior decisions; the latest valid decision is effective while older decisions remain in audit history. This behavior was not verified as complete in the live structures or application.
- `workflow_submissions` has a foreign key to `current_version_id`; version, approval-step, message, and routing relationships are also represented with foreign keys. No missing foreign key was established in the inspected relationships. The primary gaps are semantic constraints and competing workflow models, not a demonstrated absence of all referential integrity.
- No custom TEST migration ledger was available to determine which repository migration files were applied. Do not use the local migration order to infer the live migration state.

## 10. Security and permission findings

### Positive controls observed

- RLS is enabled on all 16 inspected workflow-related public tables and on `storage.objects`.
- The `workflow_uploads` bucket is private; its catalogued limit is 20 MiB and its MIME allowlist matches supported office/document/image/archive types.
- The `submit_document(...)` function requires an authenticated actor and active department.
- Final-decision and approval-step functions check actor role/department, submission ownership, step order/version, and required comments in the inspected definitions.
- `handle_new_user()` and profile role synchronization are trigger-driven; the synchronization function has a hardened `pg_catalog, public` search path and no anon/authenticated EXECUTE.
- The archive RPC is granted to authenticated users and performs an admin-role check.

### Risks requiring follow-up

- `anon` has effective EXECUTE on several SECURITY DEFINER workflow functions, including profile-role administration and route/submission decision functions. The inspected bodies contain checks, but broad grants increase exposure and should be reviewed against explicit authenticated-only grants. No unauthorized call was attempted.
- `workflow_submissions` has authenticated UPDATE privilege. RLS and transition triggers constrain rows and status transitions, but direct table updates remain part of the application workflow and do not make the entire operation surface action-specific. Review column-level writes and ensure privileged workflow actions use checked RPCs.
- Storage has overlapping permissive SELECT policies. One grants read access to any path when `is_workflow_staff()` is true (`approver` or `admin`); this may be wider than office assignment requirements. Confirm whether this is acceptable for the approved Tourism Officer/admin visibility model before changing anything.
- `FORCE ROW LEVEL SECURITY` is false on the inspected tables. This is not by itself evidence of a vulnerability; review owner/service-role paths and keep privileged server access scoped.
- SECURITY DEFINER functions commonly use `search_path = public`; only selected sensitive functions were verified to use `pg_catalog, public`. Review all such functions consistently before future privileged changes.
- The canonical migration hash matches the supplied value, but no current migration ledger proves that a particular version was applied. Live catalog state is the evidence for the observed grants and policies.

## 11. Redundant or outdated structures

- Legacy lifecycle fields and statuses (`approver_id`, `admin_id`, `pending_admin`, `declined_by_admin`, legacy completion) coexist with newer department and route-plan structures.
- `approval_steps` and `workflow_routing_plans`/`workflow_routing_steps` both model review routing with different roles, semantics, and transition rules.
- `audit_logs` is referenced by a current hook but not defined by the checked-in migrations; `workflow_audit_logs` is the established local/live history table.
- TEST exposes both old `create_workflow_submission(...)` and newer `submit_document(...)` entry paths; the app upload uses the latter, while the review UI is aligned to the former legacy lifecycle.
- Local migrations show a historical assignment table being created and later removed, while the current user/approver UI still presents a broad unassigned queue. Do not reintroduce assignment schema until the intended office assignment model is agreed.

## 12. Unresolved workflow decisions and design items

### Open workflow decisions in Section 8

These details remain open in the revised plan and must not be inferred from existing schema or UI:

- Which office has authority over each requirement and who maintains those assignments.
- How Department Only, External Only, External + Department, and Multiple Offices map to mandatory Tourism Officer initial/final review.
- Exact office-level status values and transitions, including how valid resolution is represented without bypassing a mandatory requirement.
- Exact overall status values and conditions/timing for closing a workflow as `COMPLETED`.
- Notification events, recipients, channels, and timing.
- Rejection criteria for initial-review final rejection.
- Points eligibility, recipient, calculation, and reversal handling.
- Required report measures, access, and aggregation.
- Offline evidence, access, and retention. Storage/offline changes remain deferred pending dean consultation.

### Implementation details not prescribed by the plan

These are design tasks, not permission to change the agreed behavior or invent database objects:

- Select an assignment/response representation for multiple independently classified responsibilities within one office; the plan does not approve a particular table, RPC, or schema.
- Define how the system records the Tourism Officer's per-submission reassessment selection and identifies affected responsibilities. The Tourism Officer's control, append-only decision history, latest-valid-decision rule, and continued validity of unaffected approvals are agreed.

Initial-review final rejection is an agreed outcome when a submission cannot proceed under applicable office requirements, with a recorded reason, submitter notification, audit entry, and no municipal routing or final review. The rejection criteria themselves are explicitly unresolved.

## 13. Prioritized findings

| Priority | Finding | Evidence / consequence |
|---|---|---|
| **Critical** | Submission UI and review queues use incompatible status/RPC models. | Upload calls `submit_document(...)` and creates `under_department_review`; current approver/admin queues filter legacy statuses and do not call the new RPCs. End-to-end processing is not verified and source indicates submissions can be stranded outside those queues. |
| **High** | Final authority is assigned to admin in the UI and one live route model. | Direct conflict with Tourism Officer overall approval and no mandatory admin stage. |
| **High** | No app implementation for Tourism Officer-controlled office assignment/routing, revision/version upload, or Tourism Officer reassessment coordination. | Core agreed workflow branches, including simultaneous and one-at-a-time routing and final-review readiness checks, cannot be completed through the checked-in UI. Direct office-to-office forwarding is intentionally not required. |
| **High** | Two overlapping database workflow models and status vocabularies coexist. | Affects permissions, reporting, audit semantics, route behavior, and future migration safety. |
| **High** | `external_approver` function checks conflict with the live profile role constraint. | The role cannot be assigned under the current constraint; actual office role mapping needs approval. |
| **Medium** | Anonymous EXECUTE is effective for several SECURITY DEFINER workflow functions. | Unnecessary exposure despite role checks in inspected functions; validate and remediate with focused tests and approved migration. |
| **Medium** | Authenticated direct UPDATE on submissions and broad staff file-read policy need a documented authorization boundary. | RLS/triggers exist, but the policy model must match office responsibilities and Tourism Officer visibility. |
| **Medium** | Audit, notification, points, and reports are only partly aligned to the agreed lifecycle. | The `audit_logs` reference, legacy statuses, reward arithmetic, and undefined event/report rules need reconciliation. |
| **Low** | No repository test suite or test script was found. | The workflow and security refactor will need explicit automated coverage before release. |

## 14. Repository worktree boundary

The pre-existing documentation organization changes and the uncommitted edit to `docs/REVISED_WORKFLOW_PLAN.md` were preserved. This audit created only this report and `docs/PHASE_2_IMPLEMENTATION_ROADMAP.md`; no application, migration, or database changes were made.

# Phase 2 — Workflow Decision Mapping

**Purpose:** Map the agreed workflow to inspected application and TEST database evidence, identify gaps, and separate unresolved decisions from implementation design.

**Workflow authority:** [Revised workflow plan](./REVISED_WORKFLOW_PLAN.md)
**Audit evidence:** [Phase 2 gap analysis](./PHASE_2_WORKFLOW_GAP_ANALYSIS.md)
**Implementation sequencing:** [Phase 2 implementation roadmap](./PHASE_2_IMPLEMENTATION_ROADMAP.md)

> This mapping does not change or reopen the agreed workflow, choose a canonical database model, or authorize implementation. A table or function's existence does not prove complete runtime behavior. The database observations below are metadata from the read-only TEST connection, not production facts.

## Evidence labels

- **Verified source:** Inspected application source in this review. This confirms code behavior only, not successful runtime operation.
- **Verified TEST metadata:** Confirmed by read-only catalog queries against the TEST project identified below. This confirms objects, columns, constraints, privileges, triggers, or policies as stated, not end-to-end behavior.
- **Documented; not independently reverified:** Reported in the Phase 2 gap analysis or previous audit, but not re-established by source inspection or a current TEST query in this mapping pass.
- **Inferred:** A cautious implication from verified evidence, not a confirmed runtime result.
- **Proposed design:** A future implementation consideration only; not an approved schema, RPC, status, or architecture.
- **Unresolved decision:** Explicitly left open by the authoritative workflow plan.

## Scope and evidence boundary

The read-only connection URL resolved to `https://bhbccqutreegqoohqzqb.supabase.co`; the database query reported database `postgres`, role `supabase_read_only_user`, schema `public`, PostgreSQL 17.11. Only that TEST connection was used. Queries were SELECTs against PostgreSQL catalog and information-schema metadata; no user records, inserts, updates, deletes, DDL, migrations, or mutating RPCs were used. Production was not accessed.

### Application files inspected

- [Submission upload](../app/(dashboard)/workflow/user/upload/page.tsx) — selected department, one uploaded file, and `submit_document(...)` call.
- [Approver queue](../app/(dashboard)/workflow/approver/page.tsx) and [approver review detail](../app/(dashboard)/workflow/approver/file_management/[id]/page.tsx) — queue states and decision transition.
- [Admin submission detail](../app/(dashboard)/workflow/admin/submissions/[id]/page.tsx) and [submission hook](../hooks/useSubmissions.ts) — admin decision actions, direct status updates, and legacy audit reference.
- [Middleware](../middleware.ts), [login](../app/(auth)/login/page.tsx), and [registration](../app/(auth)/register/page.tsx) — current role gates, redirects, and signup role.
- [Admin reports](../app/(dashboard)/workflow/admin/reports/page.tsx) — status mapping and audit-log query.
- [Email notification route](../app/api/notifications/email/route.ts) and application notification references — outbox processing and notification reads.

Other findings labeled **Documented; not independently reverified** below are retained from the gap analysis rather than presented as fresh source/database verification.

### TEST database objects inspected

Catalog metadata was queried for these workflow tables: `workflow_submissions`, `approval_steps`, `departments`, `document_messages`, `document_versions`, `mandatory_approval_rules`, `points_ledger`, `profiles`, `workflow_audit_logs`, `workflow_email_outbox`, `workflow_notifications`, `workflow_routing_plans`, `workflow_routing_steps`, `workflow_settings`, `workflow_submission_attachments`, and `workflow_tracking_sequences`.

The current queries confirmed columns for the listed tables, selected CHECK constraints for `profiles`, `approval_steps`, `mandatory_approval_rules`, `workflow_submissions`, and both routing tables, RLS status and policy names for the core workflow tables, function names and effective `anon`/`authenticated` EXECUTE privileges, and active public triggers on submissions, approval steps, profiles, and notifications.

Functions checked by name and privilege included `submit_document`, `decide_routing`, `decide_approval_step`, `workflow_apply_step_decision`, `final_decision`, `request_changes`, route-plan proposal/finalization/decision/completion functions, route-requirement request/response functions, `post_message`, `record_offline_decision`, `handle_new_user`, `sync_role_to_app_metadata`, and `award_points_on_approval`. Presence and privileges do not verify the full function behavior.

No Storage bucket or `storage.objects` policy query was performed for this mapping. Offline-evidence handling and Storage policy changes remain deferred.

## Requirement mapping

### 1. User submission and initial Tourism Officer review

- **Agreed workflow rule:** Every submission enters Tourism Officer initial review. The Tourism Officer distinguishes incomplete submissions needing correction, clarification requests, and a justified final overall rejection. An initially rejected submission is recorded with a reason, notified to the submitter, and does not proceed to office routing or final review. Rejection criteria are not specified.
- **Current support:** **Verified source:** The upload page selects a destination department, uploads one primary file, and calls `submit_document(...)`; its UI says the selected department reviews first. Login routes `approver` to `/workflow/approver`; middleware permits `approver` and `admin` to that route. **Verified TEST metadata:** `submit_document(...)` exists and is executable by `authenticated`, not `anon`; `workflow_submissions` has destination-department and routing columns. **Documented; not independently reverified:** The prior database audit found that `submit_document(...)` creates `under_department_review`.
- **Gap or conflict:** No source evidence establishes that this is a Tourism Officer initial-review queue. The current review UI uses a different legacy status vocabulary from the reported submission status. No distinct initial-review final-rejection action and no verified reject-reason/audit/notification/no-routing path were found in the inspected source.
- **Related source / database:** Upload page, login, middleware, approver queue; `workflow_submissions`, `profiles`; `submit_document(...)`, `decide_routing(...)`, `final_decision(...)`, `workflow_audit_logs`, `workflow_notifications`.
- **Decision still required:** Open criteria for initial-review final rejection; open overall and office status mapping. The Tourism Officer's initial-review authority and rejection semantics are agreed.
- **Implementation blocked pending approval?** **Yes, for workflow integration** until relevant status/role mapping and the canonical submission path are reconciled. Do not invent rejection criteria.

### 2. Path A — direct Tourism Officer handling, no additional offices

- **Agreed workflow rule:** When no municipal office is needed, the Tourism Officer completes initial evaluation and performs overall final review. The Tourism Head is not an approval stage.
- **Current support:** **Verified source:** The app has an `approver` queue, but inspected role labels and transitions do not establish it as Tourism Officer direct final review. **Verified TEST metadata:** `final_decision(...)` exists and is executable by authenticated users; `workflow_submissions` includes department and final-stage-related fields. **Documented; not independently reverified:** The prior audit reported a department-scoped final decision function and a separate route-plan model with admin completion.
- **Gap or conflict:** No verified end-to-end Path A UI/action pair. The existing app's final decision is given to admin; live models have conflicting role/status semantics.
- **Related source / database:** Approver queue/detail, admin submission detail, `hooks/useSubmissions.ts`; `workflow_submissions`, `profiles`; `final_decision(...)`, `decide_routing(...)`.
- **Decision still required:** Approval-path labels and final/closed/correctable status mapping remain open. No office authority decision is needed for a Path A submission with no office assignment.
- **Implementation blocked pending approval?** **Yes**, until the canonical workflow model and status/actor mapping are selected. The Tourism Officer's final authority is agreed.

### 3. Path B — Tourism Officer-controlled office assignments

- **Agreed workflow rule:** The Tourism Officer decides whether offices are needed, selects them, defines each responsibility, requirements, instructions, responsibility type, and routing method; responses return to the Tourism Officer. Routing is not automatically inferred from document type or category.
- **Current support:** **Verified TEST metadata:** `approval_steps`, `mandatory_approval_rules`, `workflow_routing_plans`, and `workflow_routing_steps` exist; `decide_routing(...)` and route-plan functions exist. RLS is enabled on the inspected workflow tables. **Verified source:** No matching Tourism Officer office-assignment UI or route-management RPC invocation was found in the inspected app/hooks.
- **Gap or conflict:** Two live TEST representations coexist and have different roles/status constraints. The route-plan table constrains office roles to three values, while the profile role CHECK does not include `external_approver`. Neither structure is verified to implement the agreed Tourism Officer assignment model.
- **Related source / database:** Approver workflow pages; `workflow_submissions`, `approval_steps`, `mandatory_approval_rules`, `workflow_routing_plans`, `workflow_routing_steps`, `profiles`, `departments`; `decide_routing(...)`, `propose_workflow_route(...)`, `finalize_workflow_route(...)`.
- **Decision still required:** Which offices have authority over requirements; meanings and precedence of Department Only, External Only, External + Department, and Multiple Offices. The Tourism Officer's routing control is agreed.
- **Implementation blocked pending approval?** **Yes**, pending office-authority/path decisions and data-preserving model reconciliation.

### 4. Simultaneous and one-at-a-time routing

- **Agreed workflow rule:** The Tourism Officer can choose simultaneous routing or one-at-a-time routing. Simultaneously selected offices process independently; with one-at-a-time routing the Tourism Officer decides the next assignment after reviewing a response. Automatic office-to-office progression is prohibited.
- **Current support:** **Verified TEST metadata:** `workflow_routing_steps` has positive `sequence_number` and current status constraints. **Documented; not independently reverified:** The prior gap analysis reports sequential enforcement in the live route-plan and approval-step functions. **Verified source:** No routing UI or call site for these functions was found in the inspected app/hooks.
- **Gap or conflict:** Current schema/function names and sequence fields do not establish both routing modes. Sequential structures alone do not satisfy the simultaneous option.
- **Related source / database:** Approver queue/detail; `workflow_routing_plans`, `workflow_routing_steps`, `approval_steps`; `decide_routing(...)`, route-plan decision functions.
- **Decision still required:** The routing choices themselves are agreed. Path-category semantics and the assignment model remain open; do not infer additional routing modes or dependencies.
- **Implementation blocked pending approval?** **Yes**, pending canonical model selection and any unresolved path/office mappings. No forwarding authority decision is required because direct office forwarding is not part of this workflow.

### 5. Mandatory Approval / Clearance

- **Agreed workflow rule:** The office must approve the requirement. Denial or unresolved status blocks overall approval. A denied or unresolved requirement cannot be downgraded to Evaluation / Verification or Recommendation, nor cancelled to bypass approval. Legitimate assignment corrections preserve original history, actor, reason, and timestamp.
- **Current support:** **Verified TEST metadata:** `mandatory_approval_rules` and `approval_steps` exist; approval-step statuses include `pending`, `approved`, `rejected`, `changes_requested`, and `superseded`; a `resolved_by`/`resolution_reason` representation exists. **Documented; not independently reverified:** Existing decision functions check some step/mandatory conditions.
- **Gap or conflict:** Current metadata does not establish protection against changing type or cancelling a denied/unresolved mandatory assignment, nor an immutable correction history. A resolution column does not itself establish valid resolution policy.
- **Related source / database:** No assignment-management UI found; `mandatory_approval_rules`, `approval_steps`, `workflow_audit_logs`; `decide_approval_step(...)`, `workflow_apply_step_decision(...)`.
- **Decision still required:** Office authority mapping and exact office lifecycle/status values. Mandatory approval and anti-bypass safeguards are agreed.
- **Implementation blocked pending approval?** **Yes**, until model/transition reconciliation. Do not weaken the mandatory requirement while implementing other statuses.

### 6. Evaluation / Verification

- **Agreed workflow rule:** A submitted evaluation is required when assigned. A negative evaluation is not automatically a veto.
- **Current support:** **Verified TEST metadata:** Approval-step and routing tables exist but no catalog finding proves they distinguish this responsibility type from mandatory approvals. **Verified source:** No office responsibility UI or evaluation submission flow found in inspected app/hooks.
- **Gap or conflict:** No verified data/UX support for a separate evaluation response or final-review readiness check. Treating every office negative outcome as rejection would conflict with the plan.
- **Related source / database:** `approval_steps`, `workflow_routing_steps`, `workflow_audit_logs`; no office-response UI/call site identified.
- **Decision still required:** Which offices may perform which evaluations; office statuses remain open.
- **Implementation blocked pending approval?** **Yes**, until office authority and model mapping are approved. Non-veto semantics are agreed and must not be reopened.

### 7. Recommendation

- **Agreed workflow rule:** A submitted recommendation is required when assigned and remains advisory; a negative recommendation is not an automatic veto. An office may recommend another office, but only the Tourism Officer decides whether to add it.
- **Current support:** **Verified source:** No recommendation authoring/review UI or routing call site found in inspected app/hooks. **Verified TEST metadata:** Relevant workflow tables exist but their presence does not verify recommendation-specific handling.
- **Gap or conflict:** No verified separate advisory recommendation response or final-review behavior. An office recommendation cannot directly create an assignment.
- **Related source / database:** `approval_steps`, `workflow_routing_steps`, `workflow_audit_logs`, approver workflow pages; no app `propose_workflow_route(...)` call found.
- **Decision still required:** Office authority mapping and exact office response lifecycle.
- **Implementation blocked pending approval?** **Yes**, pending office mapping/model reconciliation. Advisory/non-veto semantics are agreed.

### 8. Multiple responsibilities within one office

- **Agreed workflow rule:** One office may have multiple independently classified responsibilities for one submission, with separate outcomes. One office-level decision must not be assumed to represent different responsibility outcomes.
- **Current support:** **Verified TEST metadata:** `approval_steps` has one row structure with department/office identifying fields and a responsibility-related `mandatory_rule_id`, but this does not prove multiple responsibility-level outcomes are supported. **Verified source:** No responsibility-level assignment or response UI found.
- **Gap or conflict:** The appropriate assignment/response representation and handling remain unverified. Neither a new table nor an office-level aggregate decision can be assumed.
- **Related source / database:** `approval_steps`, `mandatory_approval_rules`, `workflow_routing_steps`, `workflow_submissions`.
- **Decision still required:** This is an implementation design item: determine how the existing model could represent and return distinct responsibility outcomes. Do not invent a table, RPC, or status.
- **Implementation blocked pending approval?** **Yes**, until read-only model reconciliation establishes whether existing structures can support the agreed behavior and any required design receives human approval.

### 9. Office response requirements and final-review readiness

- **Agreed workflow rule:** Final review may begin only after every active office responsibility receives a response or is validly resolved. Mandatory Approval / Clearance needs approval; Evaluation / Verification needs a submitted evaluation; Recommendation needs a submitted advisory recommendation. Validly cancelled assignments are excluded only subject to mandatory-assignment safeguards.
- **Current support:** **Verified TEST metadata:** Approval-step statuses and resolution columns exist; functions and triggers exist. RLS is enabled on inspected workflow tables. **Documented; not independently reverified:** Prior audit reports sequential-step and mandatory checks in some functions. **Verified source:** Current app's admin queue does not expose a responsibility readiness gate.
- **Gap or conflict:** The complete per-responsibility readiness gate and safe cancellation semantics are not verified in the database or app. A sequential pending-step condition is not equivalent to the agreed gate.
- **Related source / database:** Approver queue/detail and admin final page; `approval_steps`, `workflow_routing_steps`, `workflow_submissions`; `decide_approval_step(...)`, `final_decision(...)`, transition triggers.
- **Decision still required:** Exact valid-resolution and office-status transitions. The response gate and responsibility-specific rules are agreed.
- **Implementation blocked pending approval?** **Yes**, pending canonical model and resolution/status mapping. Do not implement final review by merely checking whether all mandatory steps are approved.

### 10. Tourism Officer final approval

- **Agreed workflow rule:** The Tourism Officer makes the overall decision. The Tourism Head/Admin does not approve documents. `APPROVED` and `REJECTED` are final decisions; `COMPLETED` is closure; `RETURNED` is correctable and non-final.
- **Current support:** **Verified source:** The admin detail page directly writes `approved`, `declined_by_admin`, or `completed`; `hooks/useSubmissions.ts` exposes admin approve/decline actions. Login and middleware route/gate admin separately from approver. **Verified TEST metadata:** `final_decision(...)` exists; `workflow_routing_plans` requires finalized state fields. **Documented; not independently reverified:** Prior audit described conflicting actor semantics across the database models.
- **Gap or conflict:** Current source contradicts agreed authority. Current UI status mapping conflates or mislabels some final decisions and closure. Database function presence does not prove the Tourism Officer has the correct live privilege.
- **Related source / database:** Admin submission detail, `hooks/useSubmissions.ts`, login, middleware; `workflow_submissions`, `profiles`, `workflow_routing_plans`; `final_decision(...)`, `complete_workflow_after_route(...)`.
- **Decision still required:** Exact stored status values and closure timing/conditions. Tourism Officer final authority and outcome distinctions are agreed.
- **Implementation blocked pending approval?** **Yes**, pending canonical model, role mapping, and status/closure decisions.

### 11. Corrections and resubmission

- **Agreed workflow rule:** Concerned offices send change requests to the Tourism Officer. The Tourism Officer coordinates return to the submitter and decides which offices need reassessment. RETURNED remains correctable and distinct from final rejection.
- **Current support:** **Verified TEST metadata:** `document_versions`, `workflow_submission_attachments`, route-requirement functions, and `request_changes(...)` exist. **Verified source:** Upload creates a submission; no revision-upload or coordinated change-request call site was found. **Documented; not independently reverified:** Prior audit states the live office requirement response path returns to the same office after sender response.
- **Gap or conflict:** Existing function presence does not prove Tourism Officer coordination. The inspected app has no user correction/resubmission loop.
- **Related source / database:** Upload page, approver detail; `workflow_submissions`, `document_versions`, `workflow_submission_attachments`, `workflow_routing_steps`; `request_changes(...)`, `request_workflow_route_requirements(...)`, `respond_to_workflow_route_requirements(...)`.
- **Decision still required:** Open exact office statuses and notification event details; no rejection criteria may be invented. Coordination through the Tourism Officer is agreed.
- **Implementation blocked pending approval?** **Yes**, pending model/status reconciliation and safe version handling. Do not change offline evidence or Storage policies.

### 12. Reassessment and preservation of prior decisions

- **Agreed workflow rule:** Only the Tourism Officer initiates reassessment. Reassessment appends a new decision event/version; previous decisions are never overwritten/deleted. The latest valid decision is effective, and prior decisions remain in audit history. Preserve unaffected valid approvals.
- **Current support:** **Verified TEST metadata:** `document_versions`, `workflow_audit_logs`, `approval_steps`, and `status_before_supersede` exist; triggers include `record_status_before_supersede` and `record_workflow_audit_event`. **Verified source:** No reassessment call site found in the inspected app/hooks.
- **Gap or conflict:** Metadata does not establish append-only decision history, latest-valid-decision selection, Tourism Officer-only reassessment, or whether audit history is uneditable. These are not verified as enforced.
- **Related source / database:** `workflow_audit_logs`, `document_versions`, `approval_steps`, `workflow_submissions`; relevant status/audit triggers and reassessment functions if any. The app has no verified reassessment UI/action.
- **Decision still required:** Per-submission reassessment selection representation is an implementation design item; which offices reassess is decided by the Tourism Officer for each revised submission. Do not invent a new object.
- **Implementation blocked pending approval?** **Yes**, pending model reconciliation for append-only history and version linkage; the authority/history behavior itself is agreed.

### 13. Tourism Head/Admin system administration

- **Agreed workflow rule:** The Tourism Head/System Administrator manages accounts, roles, office memberships, permissions, and system configuration, but is not a document approval stage.
- **Current support:** **Verified source:** Admin routes exist and middleware checks `admin`; the admin detail view currently provides document decisions, which conflicts. Registration creates only `user`. **Verified TEST metadata:** `profiles` includes `role`, `department_id`, and `can_final_decide`; its role CHECK allows `user`, `approver`, `admin`, and three named municipal roles, but not `external_approver`. No user records were read.
- **Gap or conflict:** Admin system-management capabilities were not exhaustively reverified. Existing admin workflow actions improperly include document approval. Role naming/office membership support does not align clearly with the agreed role model.
- **Related source / database:** Middleware, login, registration, admin pages; `profiles`, `departments`; profile role constraint and role-sync trigger.
- **Decision still required:** How approved roles and office authority map onto the existing profile/department model remains to be resolved. Admin's exclusion from document approval is agreed.
- **Implementation blocked pending approval?** **Yes**, for role/office membership changes pending human-approved mapping. Removing admin document approval is an agreed behavior but depends on workflow integration and migration safety.

### 14. Notifications and audit history

- **Agreed workflow rule:** Record workflow actions, assignments and modifications/cancellations, responses, correction requests, resubmissions, reassessments, versions, and overall decisions. Preserve a separate uneditable audit history. Notify the submitter of decisions and relevant updates, including initial-review final rejection. Exact notification events, recipients, channels, and timing remain open.
- **Current support:** **Verified source:** Admin and approver detail/reports query `workflow_audit_logs`; `hooks/useSubmissions.ts` writes to `audit_logs`; notification layouts/pages read `workflow_notifications`; the email route processes `workflow_email_outbox`. **Verified TEST metadata:** All three workflow log/notification/outbox tables exist; relevant RLS is enabled; active `record_workflow_audit_event` and `queue_workflow_notification_email` triggers were observed.
- **Gap or conflict:** The app's `audit_logs` write is inconsistent with observed `workflow_audit_logs`. Trigger/table existence does not prove required event coverage, append-only protection, correct recipient mapping, or successful email delivery.
- **Related source / database:** Admin/approver detail and reports, `hooks/useSubmissions.ts`, workflow layout, notification pages, email API route; `workflow_audit_logs`, `workflow_notifications`, `workflow_email_outbox`; audit/notification triggers.
- **Decision still required:** Notification events, recipients, channels, and timing. Audit events and separate uneditable history are agreed, though enforcement requires verification.
- **Implementation blocked pending approval?** **Partly.** Audit/event alignment can be designed from agreed requirements after model reconciliation; notification routing is blocked on the open event/recipient/channel/timing decisions.

## Existing structures: overlap and conflict (no canonical choice made)

- **Verified TEST metadata:** `workflow_submissions` contains legacy approver/admin fields and newer destination-department, routing, version, and office-related fields.
- **Verified TEST metadata:** `approval_steps` plus `mandatory_approval_rules` coexist with `workflow_routing_plans` plus `workflow_routing_steps`.
- **Verified TEST metadata:** The route-step role constraint contains `municipal_treasurer`, `mayor_office`, and `sangguniang_bayan`; the profile role constraint uses those roles but not the agreed generic `external_approver`.
- **Verified source:** The current upload calls `submit_document(...)`, while the approver/admin screens filter and write legacy statuses directly.
- **Documented; not independently reverified:** The gap analysis reports that local migrations do not fully describe TEST's newer workflow schema and that route-plan functions impose admin finalization/sequential behavior.

Together these observations show overlapping lifecycle models and an application/database contract mismatch. They do **not** determine which structure to retain, merge, or extend. That choice belongs in the next model-reconciliation step after the unresolved authority/path/status decisions are addressed. No object is designated canonical here.

## Decisions and implementation blockers

### Workflow behavior already agreed — do not reopen

- Tourism Officer initial review and overall final authority; admin system administration only.
- Manual Tourism Officer selection and control of office assignments; simultaneous and one-at-a-time routing; no direct office-to-office forwarding.
- The three responsibility types and their response/veto semantics.
- Final review only after every active responsibility has responded or been validly resolved.
- Protection against bypassing mandatory approval through cancellation or downgrading.
- Multiple independent responsibilities/outcomes within one office.
- Tourism Officer-coordinated corrections and Tourism Officer-initiated reassessment.
- Append-only decision history, prior decision/version preservation, and latest-valid-decision semantics.
- Initial-review final rejection reason/audit/submitter notification and no progression to office routing/final review; criteria remain unspecified.

### Consequential open decisions from the workflow plan

- Which offices have authority over each requirement and who maintains those assignments.
- Meaning and precedence of Department Only, External Only, External + Department, and Multiple Offices.
- Exact office-level status values/transitions and valid-resolution representation.
- Overall status values and when/how the workflow closes as `COMPLETED`.
- Notification events, recipients, channels, and timing.
- Initial-review rejection criteria.
- Points and reporting rules.
- Offline evidence requirements/access/retention; changes remain deferred pending consultation.

### Implementation design items (not approved schema)

- How to represent separate responsibility assignments and responses for multiple responsibilities within one office.
- How to persist/check the Tourism Officer's reassessment selection and determine affected responsibilities while retaining unaffected valid decisions.
- Which existing TEST workflow structures can satisfy the requirements without data loss or a parallel model.

Implementation is not authorized by this mapping. Resolve decisions that apply to the selected implementation slice, then perform data-preserving model reconciliation before schema or application changes. Any future Storage/offline-evidence work requires separate approval.

## Recommended next step

Review the open-decision list with the relevant human stakeholders and approve a role/office-authority, path-meaning, and status/action matrix for the first implementation slice. Then conduct the roadmap's read-only model reconciliation across the existing submission, approval-step, mandatory-rule, route-plan, version, and audit structures. Do not select or alter a canonical model until that evidence and required approvals are reviewed.

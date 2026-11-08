# Phase 2 — Implementation Roadmap

**Basis:** [Workflow gap analysis](./PHASE_2_WORKFLOW_GAP_ANALYSIS.md) and [authoritative revised workflow plan](./REVISED_WORKFLOW_PLAN.md)

> This is a proposed sequence, not authorization to implement. The open workflow decisions in Section 8 of the revised plan require human approval before they are encoded in schema, permissions, or UI. TEST observations are not a reason to preserve conflicting behavior or to add another parallel workflow model.

## Delivery principles

1. Preserve existing records and retain prior document versions, decisions, and audit history.
2. Select and reconcile existing TEST structures before proposing new tables. Prefer one approved workflow model over maintaining both `approval_steps` and route-plan semantics independently.
3. Keep all office selection, assignment changes, routing, and reassessment under Tourism Officer control. Offices return responses to the Tourism Officer; direct office-to-office forwarding is not part of the workflow.
4. Preserve both Tourism Officer-selected routing options: simultaneous and one-at-a-time. Do not infer automatic routing.
5. Use checked backend/database actions for approvals, role changes, assignment changes, and status transitions; keep table RLS and grants aligned with those actions.
6. Keep overall submission status distinct from office-level review status and final decision distinct from workflow closure. Do not allow final review until every active office responsibility has responded or been validly resolved.
7. Implement only agreed behavior. Keep rejection criteria, office authority mapping, path precedence, notification rules, point rules, and reporting requirements open until approved.
8. Do not change offline approval evidence or Storage policies in this roadmap phase. Those items remain deferred pending dean consultation.

## Phase 0 — Approve workflow and data contract

### Task 0.1: Resolve remaining role, office, and status mappings

- **Objective:** Resolve the open decisions needed to map the plan onto one database and application workflow.
- **Proposed changes:** Produce an approved crosswalk for `user`, Tourism Officer, concerned offices, and Tourism Head/Admin; identify office authority, document types, path meanings, office-level states, and final/closed/correctable status mapping. Preserve the agreed rule that the Tourism Officer chooses simultaneous or one-at-a-time routing and that offices return responses to the Tourism Officer. The three responsibility types and their response/decision semantics are already specified by the workflow plan. Keep the initial-review rejection record and notification aligned to that plan without inventing rejection criteria.
- **Affected files or database objects:** No implementation files yet. Inputs include `docs/REVISED_WORKFLOW_PLAN.md`, TEST `profiles`, `departments`, `mandatory_approval_rules`, `approval_steps`, `workflow_routing_plans`, `workflow_routing_steps`, and `workflow_submissions`.
- **Dependencies:** None.
- **Risks:** An incomplete mapping could encode an unauthorized office role, let a denied mandatory requirement be bypassed, or preserve two competing state machines.
- **Migration necessary:** No.
- **Validation:** Human sign-off on a state/role/action matrix, including all open Section 8 decisions relevant to the selected initial slice.
- **Human approval required:** **Yes — prerequisite.** Do not encode unresolved details by assumption.

## Phase 1 — Reconcile workflow infrastructure and secure action boundaries

### Task 1.1: Select and reconcile the existing TEST workflow model

- **Objective:** Establish one canonical representation and API for submissions, office responsibilities, decisions, versions, and closure.
- **Proposed changes:** Compare existing records/relationships and function dependencies before choosing whether to extend `approval_steps`, `workflow_routing_plans`/`workflow_routing_steps`, or combine them through a deliberate data-preserving migration. Determine how the selected model can represent multiple independently classified responsibilities for one office and their distinct responses; do not assume one office-level decision represents them all or presume a new table/RPC. Retire or isolate unused legacy paths only after confirming references and data. Align statuses and transition ownership with the approved contract.
- **Affected files or database objects:** `workflow_submissions`, `approval_steps`, `mandatory_approval_rules`, `workflow_routing_plans`, `workflow_routing_steps`, existing RPCs/triggers, local `supabase/migrations/`, generated Supabase types if maintained.
- **Dependencies:** Task 0.1.
- **Risks:** Duplicate active routes, orphaned history, broken audit/notification triggers, and irreversible loss of old status meaning. Do not drop or rewrite historical structures before data and dependencies are inventoried.
- **Migration necessary:** **Likely.** Any consolidation or status constraint/transition change must use an approved, data-preserving migration.
- **Validation:** Compare pre/post row counts and relationships without exposing personal data; test backfill mapping, route uniqueness, version links, transition rejection, and rollback plan on a disposable TEST branch.
- **Human approval required:** **Yes** before selecting the canonical model or changing live TEST.

### Task 1.2: Align grants, RLS, and privileged workflow RPCs

- **Objective:** Make all privileged actions require the intended authenticated actor and enforce document/office responsibility at the database boundary.
- **Proposed changes:** Review effective EXECUTE for every SECURITY DEFINER function; revoke unnecessary anon access after confirming callers; verify function owner/search path and actor/role checks. Review authenticated submission UPDATE and Storage read scope against the approved role map. Enforce that only the Tourism Officer can create, modify, or cancel office assignments and initiate reassessment. Preserve safe RLS coverage and route privileged workflow mutations through checked actions.
- **Affected files or database objects:** SECURITY DEFINER functions including `admin_update_profile_role`, `create_workflow_submission`, route/submission decision functions, `profiles`, `workflow_submissions`, `approval_steps`, `workflow_routing_*`, `storage.objects`; corresponding local migration and permission tests.
- **Dependencies:** Tasks 0.1 and 1.1.
- **Risks:** Revoking grants without discovering legitimate callers may break functionality; expanding broad direct-write privileges may bypass action-specific validation. Do not change Storage/offline evidence handling within this task.
- **Migration necessary:** **Yes, if grants, policies, or function definitions change.**
- **Validation:** Assert effective privileges for anon/authenticated/service roles; test allowed and denied row/action cases for submitter, Tourism Officer, assigned/unassigned office, and admin; verify no action succeeds solely through UI hiding.
- **Human approval required:** **Yes** before any permission or database change.

## Phase 2 — Make submission enter the agreed initial-review queue

### Task 2.1: Align submission API, status vocabulary, and reviewer queue

- **Objective:** Ensure each successful submission enters a visible Tourism Officer initial-review state.
- **Proposed changes:** Replace hardcoded document category with an approved type selection; collect required fields and attachments according to approved type rules; use the canonical submission RPC and status; update submitter and reviewer queries to recognize the same state. Keep one primary file if that is the only approved first release; do not silently treat it as full attachment support.
- **Affected files or database objects:** `app/(dashboard)/workflow/user/upload/page.tsx`, `app/(dashboard)/workflow/user/page.tsx`, `app/(dashboard)/workflow/approver/page.tsx`, `app/(dashboard)/workflow/approver/file_management/[id]/page.tsx`, submission hook/types, canonical submission RPC, `workflow_submissions`, `document_versions`, and `workflow_submission_attachments` only if approved attachment behavior requires it.
- **Dependencies:** Tasks 0.1 and 1.1.
- **Risks:** Existing rows may use legacy statuses; incomplete migration/query filters can hide records. File upload failures must clean up uncommitted objects without deleting files referenced by retained versions.
- **Migration necessary:** **Possibly.** Required if status constraints, submission fields, attachment relationships, or RPC contract change.
- **Validation:** Exercise signup-to-submit on TEST; verify visible initial-review queue, correct ownership/department, first version and tracking number, invalid/missing input, upload/RPC failure recovery, and legacy record visibility.
- **Human approval required:** **Yes** for required fields/document types and any schema/API contract change.

### Task 2.2: Implement Tourism Officer initial review and distinct initial rejection

- **Objective:** Enable initial screening, correction/clarification requests, office identification, and the agreed initial-review final overall rejection.
- **Proposed changes:** Add a Tourism Officer review queue and checked backend actions. Keep incomplete submissions, clarification requests, correctable returns, and final overall rejection distinct. For the agreed final rejection, record the Tourism Officer actor and reason, write audit history, notify the submitter, and prevent municipal routing and final review. Do not define rejection criteria beyond the approved workflow.
- **Affected files or database objects:** Tourism Officer dashboard/detail pages and status types; initial-review RPC/transition validation; `workflow_submissions`, `workflow_audit_logs`, `workflow_notifications`, and email outbox if approved channel rules apply.
- **Dependencies:** Tasks 0.1, 1.1, and 2.1.
- **Risks:** Confusing an initial final rejection with a correctable return; allowing a rejected item to continue; duplicate notification or missing audit entry.
- **Migration necessary:** **Likely** for a distinct validated transition/event if no existing structure supports it.
- **Validation:** Test each outcome independently; assert rejection reason and actor are retained, the submitter is notified, no municipal route or final-review action is available after rejection, and a return remains correctable.
- **Human approval required:** **Yes** for the exact initial-review action/status mapping, notification events, and any migration. Criteria remain unresolved unless separately approved.

## Phase 3 — Implement concerned-office routing and decisions

### Task 3.1: Add Tourism Officer-controlled responsibilities and routing

- **Objective:** Let the Tourism Officer select offices, assign one or more independently classified responsibilities, and choose simultaneous or one-at-a-time routing.
- **Proposed changes:** Build on the canonical model selected in Task 1.1. Represent each responsibility and its response distinctly, including when several responsibilities belong to one office. Preserve each office response's scope and return it to the Tourism Officer. The Tourism Officer controls each assignment and subsequent step; do not implement automatic office-to-office forwarding. Decide the appropriate assignment/response representation during design rather than assuming a schema.
- **Affected files or database objects:** Tourism Officer routing UI, office dashboard/queues, relevant existing route/approval functions and tables, `departments`, `mandatory_approval_rules`, `workflow_submissions`, audit and notification functions.
- **Dependencies:** Tasks 0.1, 1.1, 1.2, and 2.2.
- **Risks:** Incorrect responsibility classification, omitted office, workflow deadlock, duplicate active assignments, conflating multiple responsibilities, and treating office approval as overall approval.
- **Migration necessary:** **Unknown until the existing structures are reconciled.** Reuse existing tables where feasible; make no migration assumption before the design and data-preservation review.
- **Validation:** Test one office with multiple different responsibilities, multiple offices, simultaneous routing, one-at-a-time routing, Tourism Officer control, scoped office responses, and separation from overall decisions. Test only approved office-authority mappings.
- **Human approval required:** **Yes** for office authority and any schema/API contract change. Tourism Officer routing control and both routing options are already agreed.

### Task 3.2: Enforce responsibility responses and mandatory safeguards

- **Objective:** Block Tourism Officer final review until every active office responsibility has received a response or has been validly resolved, without permitting mandatory requirements to be bypassed.
- **Proposed changes:** Enforce the agreed distinctions: Mandatory Approval / Clearance requires approval; an unresolved or denied mandatory requirement blocks overall approval and cannot be cancelled or downgraded to Evaluation / Verification or Recommendation to bypass approval; Evaluation / Verification requires a submitted evaluation but a negative evaluation is not automatically a veto; Recommendation requires a submitted advisory recommendation. Exclude validly cancelled assignments from completion requirements only subject to mandatory-assignment safeguards. Preserve the original assignment and its actor, reason, timestamp, and history for any legitimate correction. Do not invent status values or resolution rules beyond the workflow plan.
- **Affected files or database objects:** Tourism Officer final-review readiness UI, checked workflow actions/transitions, selected canonical assignment and response structures, audit history, and relevant policies.
- **Dependencies:** Tasks 0.1, 1.1, 1.2, and 3.1.
- **Risks:** Premature final review, treating a negative evaluation/recommendation as a veto, or bypassing a mandatory requirement by cancellation, downgrading, or conflating responsibilities.
- **Migration necessary:** **Possibly**, depending on whether the selected structures can enforce these invariants; decide only after the design and data review.
- **Validation:** Test missing responses for each responsibility type, approved versus denied/unresolved mandatory requirements, negative evaluation, advisory recommendation, valid cancellation, prohibited mandatory cancellation/downgrade, and separate responsibilities within one office.
- **Human approval required:** Workflow rules are agreed. **Yes** for any new status/data contract or migration needed to implement them.

## Phase 4 — Complete correction and version history loop

### Task 4.1: Coordinate change requests through the Tourism Officer

- **Objective:** Route office change/clarification requests to the Tourism Officer, who coordinates return to the submitter and selects offices for reassessment.
- **Proposed changes:** Route office change/clarification requests to the Tourism Officer, who coordinates the return to the submitter and selects which offices reassess. Keep return distinct from rejection. Only the Tourism Officer initiates reassessment. Append each reassessment decision as a new event/version; never overwrite or delete prior decisions. The latest valid decision is effective, and previous decisions remain in audit history. Preserve unaffected valid approvals. Do not assume a particular status, table, or RPC.
- **Affected files or database objects:** Office review UI, Tourism Officer queue/detail and coordination actions, submitter response UI, request/response RPCs, canonical route tables, audit and notifications.
- **Dependencies:** Tasks 1.1, 1.2, 3.1, and 3.2.
- **Risks:** Stale office decisions being treated as current, loss or overwrite of decision history, or correctable returns being represented as final rejection.
- **Migration necessary:** **Possibly**, depending on whether the selected model can represent coordinator and reassessment decisions without losing history.
- **Validation:** Test office request to Tourism Officer, coordinated submitter return, revised response, Tourism Officer-only reassessment initiation, appended decisions, latest-valid-decision selection, and preservation of unaffected prior decisions.
- **Human approval required:** The coordination and append-only history requirements are agreed. **Yes** for any unresolved status/data contract and detailed reassessment selection rules.

### Task 4.2: Retain and review document versions

- **Objective:** Store each revised file as a new version while retaining previous files and decisions.
- **Proposed changes:** Add a revision upload path using the verified existing version structures where suitable; update any current-version reference through a checked action. Reassess only the offices selected by the Tourism Officer. Append new decision history and retain prior file versions and decisions; do not overwrite or delete history.
- **Affected files or database objects:** Submitter file registry/upload UI, version history UI, version RPC, `document_versions`, `workflow_submissions.current_version_id`, `approval_steps.version_id`, audit and file-access functions.
- **Dependencies:** Tasks 1.1, 1.2, 3.2, and 4.1.
- **Risks:** Orphaned files, stale approvals on old versions, destructive replacement of prior records, and unsupported offline-evidence changes.
- **Migration necessary:** **Possibly.** `document_versions` exists; migration only if constraints, version rules, or status transitions must change.
- **Validation:** Verify version attribution, prior file and decision retention, current-version enforcement, appended reassessment history, and that only the Tourism Officer initiates reassessment. Do not change deferred offline evidence or Storage behavior.
- **Human approval required:** Version retention and append-only decision history are agreed. **Yes** for a data migration or any unresolved version/status contract. Storage/offline evidence changes are excluded.

## Phase 5 — Tourism Officer final review and closure

### Task 5.1: Implement overall final decision and closed-state semantics

- **Objective:** Make the Tourism Officer the overall final approver and distinguish `APPROVED`/`REJECTED` from `COMPLETED` and correctable `RETURNED`.
- **Proposed changes:** Add a Tourism Officer final-review queue only after every active office responsibility has received a response or has been validly resolved. Require approval for every Mandatory Approval / Clearance; require a submitted Evaluation / Verification and Recommendation while keeping negative evaluations non-vetoing and recommendations advisory. Exclude valid cancellations only subject to mandatory safeguards. Record the final basis and notify the submitter. Define a separate closure transition only after unresolved completion conditions are approved. Remove the admin approval action from the document workflow while preserving administrative oversight.
- **Affected files or database objects:** Tourism Officer final-review UI, admin page/hook action removal or redesign, canonical final-decision RPC and transition trigger, status mappings in user/admin/report pages, audit and notification behavior.
- **Dependencies:** Tasks 0.1, 1.1, 1.2, 2.2, 3.1, and 3.2; Task 4.1 when any return is active.
- **Risks:** Premature approval, admin retaining hidden approval capability, conflating approved with closed, or allowing final review before every active office responsibility has responded or been validly resolved.
- **Migration necessary:** **Likely** for final status/transition semantics and role authorization.
- **Validation:** Verify Path A and Path B; block final review when any active responsibility lacks a response or valid resolution; test each responsibility type, mandatory bypass attempts, valid cancellations, overall rejection, approval then closure, and absence of an admin approval path.
- **Human approval required:** **Yes** for closure conditions and exact terminal status mapping; the Tourism Officer's overall authority is already agreed.

## Phase 6 — Supporting workflow features

### Task 6.1: Add document messages and private staff notes

- **Objective:** Expose shared document discussion and staff-only notes with role- and responsibility-scoped visibility.
- **Proposed changes:** Build on `document_messages` and `post_message(...)`; add authoring and history UI, clear visibility labels, and validated read/write checks. Do not expose private notes to submitters or unauthorized offices.
- **Affected files or database objects:** Submitter, Tourism Officer, and office detail pages; message queries/RPCs; `document_messages`; RLS policies.
- **Dependencies:** Tasks 1.1 and 1.2.
- **Risks:** Private note disclosure or confusing workflow decisions with informal comments.
- **Migration necessary:** **No expected table migration** if existing structure and policies meet the approved design; policy/function updates may require migration.
- **Validation:** Test visibility for submitter, Tourism Officer, assigned and unassigned office, admin, and unauthorized user; verify comment history and input validation.
- **Human approval required:** **Yes** for visibility and role-access rules.

### Task 6.2: Align notifications and email to agreed workflow events

- **Objective:** Notify intended recipients for assignments, office responses and Tourism Officer coordination, requests, decisions, returns, final outcomes, and initial-review rejection.
- **Proposed changes:** Reuse `workflow_notifications` and `workflow_email_outbox`; map only approved events/recipients/channels/timing. Preserve authenticated in-app notification behavior and verify the batch sender's authorization and failure handling.
- **Affected files or database objects:** Notification layout/pages, database notification triggers/RPCs, `workflow_notifications`, `workflow_email_outbox`, `app/api/notifications/email/route.ts`.
- **Dependencies:** Tasks 1.1, 1.2, and relevant routing/review phases.
- **Risks:** Duplicate or missing sends, exposing document details to the wrong recipient, and retrying an email without a deduplication key.
- **Migration necessary:** **Possibly** for event triggers or uniqueness/recipient rules; existing tables should be reused.
- **Validation:** Verify event-to-recipient matrix, in-app read/unread behavior, email idempotency, unauthorized cron request rejection, and controlled retry/error reporting. Do not use real recipient data during tests.
- **Human approval required:** **Yes** for event, recipient, channel, and timing rules.

### Task 6.3: Align points, rewards, and reporting

- **Objective:** Present accurate ledger-based balances and workflow reports without deciding unresolved business rules in code.
- **Proposed changes:** Replace the hardcoded `count * 50` dashboard with `points_ledger` data after eligibility, amount, recipient, and reversal behavior are approved. Update reports to use the canonical status and audit model; implement only approved metrics and access rules.
- **Affected files or database objects:** Submitter dashboard, admin reports, points query/RPC, `points_ledger`, `workflow_settings`, audit and status types.
- **Dependencies:** Tasks 0.1, 1.1, 1.2, and 5.1.
- **Risks:** Duplicate awards, stale UI totals, incorrect historical totals after revisions/reversals, and unauthorized analytics access.
- **Migration necessary:** **Possibly** for ledger uniqueness or award reversal support; existing ledger/table should be reused.
- **Validation:** Compare displayed totals to ledger aggregation; test idempotent approval, reversal cases only after rules are approved, report date filters, status categories, and role access.
- **Human approval required:** **Yes** for points policy and report measures/access.

## Phase 7 — Verification and controlled rollout

### Task 7.1: Add workflow and authorization regression coverage

- **Objective:** Prevent recurrence of status, role, routing, responsibility, decision-history, version, and policy mismatches.
- **Proposed changes:** Add focused automated tests for Tourism Officer-controlled simultaneous/one-at-a-time routing, responsibility response gates, mandatory safeguards, append-only reassessment, RPC/transition behavior, RLS/grants, notifications, and UI state mapping. Add a test script/runner only as needed by the chosen existing stack.
- **Affected files or database objects:** New unit/integration/e2e tests, `package.json` test script if approved, relevant UI/RPC contracts and disposable TEST branch schema.
- **Dependencies:** All implemented tasks in Phases 1–6.
- **Risks:** Testing against shared TEST data or sending real email; use isolated fixtures and fake delivery.
- **Migration necessary:** No.
- **Validation:** Run targeted tests, lint, type-check/build, and read-only post-deployment checks; verify negative authorization paths as well as successful user flows.
- **Human approval required:** **Yes** before using shared TEST data or running any migration/deployment.

### Task 7.2: Review deployed-state verification and release evidence

- **Objective:** Confirm the approved migration and application release match the tested state.
- **Proposed changes:** Use reviewed read-only verification queries and migration history/CI deployment evidence to record the exact TEST state; keep production out of scope unless separately authorized.
- **Affected files or database objects:** Deployment checklist, migration metadata, read-only verification SQL, release notes.
- **Dependencies:** Task 7.1 and all approved changes.
- **Risks:** Treating local migration files or historical notes as deployed evidence; accidentally applying an already deployed migration.
- **Migration necessary:** No for verification itself; migrations belong to separately authorized implementation/release tasks.
- **Validation:** Verify project reference before any TEST query, match the expected schema/function/policy checks, and retain outputs with sensitive data excluded.
- **Human approval required:** **Yes** before applying any migration or deploying code.

## Explicitly deferred

- Offline approval evidence requirements, upload/retention/access rules, and related Storage policy changes remain deferred pending dean consultation.
- No roadmap task authorizes changing `storage.objects` policies, bucket visibility, offline decision behavior, or existing evidence files.
- Production remains out of scope.

## Recommended immediate next task

Complete **Task 0.1: Resolve remaining role, office, and status mappings**. The first implementation slice depends on decisions that the workflow plan explicitly leaves open; implementing against either of the existing TEST models before that approval risks duplicating data structures or encoding unintended authority. Do not reopen the workflow plan's already agreed centralized routing, routing options, responsibility types, response gates, or reassessment history rules.

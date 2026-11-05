# TEST workflow security hardening proposal

**Status:** Proposal only; not applied to any database.  
**Target:** Supabase TEST project only.  
**SQL proposal:** [20261105_01_test_workflow_security_hardening.sql](./20261105_01_test_workflow_security_hardening.sql)  
**Source of expected workflow behavior:** [REVISED_WORKFLOW_PLAN.md](../REVISED_WORKFLOW_PLAN.md)

The proposal is based on the TEST database catalog inspection and the current repository. Checked-in SQL files are not treated as proof of deployment. The inspected TEST database had 13 `public` application tables with RLS enabled, one private `workflow_uploads` bucket, and no `supabase_migrations.schema_migrations` history table. The Supabase MCP migration list was empty, so applied migration provenance/order remains unknown.

## Proposed changes and impact

### 1. Harden archive authorization

`set_workflow_submission_archive()` currently checks `actor_role <> 'admin'`. If `auth.uid()` is null or no profile is found, `actor_role` is NULL and that expression does not reject the call. The replacement explicitly rejects a missing user and uses `IS DISTINCT FROM 'admin'`, retaining the existing archive/restore fields and audit event behavior.

- **Security purpose:** Only a signed-in profile whose database role is `admin` can archive or restore.
- **Workflow impact:** The existing admin archive pages already call this RPC; authenticated execution remains granted. This is archive authority, not approval authority.
- **Verification:** Query A checks the function definition settings and grants. Then, only after approval, exercise archive/restore using an authorized TEST admin and verify the corresponding audit event. Do not test by invoking the function in a read-only inspection session.

### 2. Remove direct tracking-number mutator execution

`generate_workflow_tracking_number()` returns `text` and is a `SECURITY DEFINER` scalar function that increments the sequence. It is not the trigger function. `set_workflow_submission_tracking_number()` is the trigger-returning function installed on `workflow_submissions`; that function calls the scalar generator. The proposal pins both functions’ `search_path` to `pg_catalog, public`, makes the trigger helper `SECURITY DEFINER`, and removes direct `EXECUTE` for `PUBLIC`, `anon`, and `authenticated` on the scalar generator. It leaves the trigger installed and preserves its automatic assignment behavior.

- **Security purpose:** A client cannot consume sequence numbers by directly invoking the mutating scalar function.
- **Workflow impact:** Automatic assignment should remain intact because the trigger helper executes with its owner’s privileges. Before applying, confirm that helper’s owner can execute the scalar generator; query B reports both owners and that effective privilege.
- **Verification:** Query A should show no direct `anon`/`authenticated` execute privilege on the scalar generator. Query B should show the enabled insert trigger, a trigger function returning `trigger`, `security definer = true`, and `trigger_owner_can_execute_generator = true`. In an approved TEST deployment, verify new submission creation through the application/RPC assigns a tracking number.

### 3. Pin role-sync `search_path`

`sync_role_to_app_metadata()` currently has no function-level `search_path` setting. The proposal sets it to `pg_catalog, public`; its table reference is already schema-qualified as `auth.users`, and synchronization logic is unchanged. Direct client execution is revoked because the function is used by the `profiles` role-update trigger, not as an application RPC.

- **Security purpose:** Avoid unsafe object name resolution in a `SECURITY DEFINER` function.
- **Workflow impact:** Role changes made through the existing authorized profile-update flow should still synchronize `raw_app_meta_data`.
- **Verification:** Query A should show `search_path=pg_catalog, public` and no direct anon/authenticated execution. Confirm the existing `on_role_updated` trigger remains enabled; after approval, test a role change in TEST and confirm metadata synchronization.

### 4. Restrict direct submission INSERT and plan UPDATE cutover

The repository’s upload page uploads the object and calls `submit_document()`; no checked-in application path directly inserts into `workflow_submissions`. The proposal revokes direct `INSERT` from `PUBLIC`, `anon`, and `authenticated` while leaving the current insert RLS policy intact as a second check if applicable to the definer function. It also removes `DELETE` from client roles; no repository application path deletes submission rows.

Direct `UPDATE` is different and must **not** be revoked in this first phase:

- The approver detail page directly updates `status`, `approver_comments`, and `updated_at`.
- The admin submission detail page directly updates `status`, `admin_comments`, and `updated_at`.
- `hooks/useSubmissions.ts` directly updates status/rejection comment; it is used by the admin pending page’s approve/decline actions. It then tries to write to `audit_logs`, while the inspected database/repository audit stream is `workflow_audit_logs`.
- Archive pages already use `set_workflow_submission_archive()`.

The department-led workflow already has authorized RPCs such as `decide_routing()`, `decide_approval_step()`, `final_decision()`, and `request_changes()`. The legacy UI actions use the old `pending_*` statuses and do not call these newer RPCs. Therefore, immediately revoking authenticated UPDATE would break review screens. A follow-up should add/confirm narrowly authorized legacy decision RPCs, update those three call sites, remove the stale `audit_logs` writes, and only then revoke direct authenticated UPDATE. That coordinated change is intentionally not part of this phase.

- **Security purpose:** Remove unnecessary direct insert/delete capability and establish a safe RPC path; avoid leaving legacy review flows unusable.
- **Workflow impact:** Direct application inserts are not used in the repository. Authenticated UPDATE remains until its callers are migrated. Anonymous DML is revoked.
- **Verification:** Queries C and D confirm RLS, policies, and effective privileges. In TEST after approval, submit through the upload flow and test both legacy approve/decline actions before any later UPDATE lockdown.

### 5. Protect offline approval evidence

The inspected `approval_steps` table has `evidence_file_path`, `recorded_by`, `approver_id`, and `department_id`. `record_offline_decision()` passes the path and recorder to the workflow helper. Existing Storage policies covered submission/version files but did not reference `approval_steps.evidence_file_path`; an owner-only policy also allowed an uploader to read any of their own objects, and the owner delete policy did not prevent deleting referenced evidence.

The proposal:

- Adds an evidence read policy for the recorded uploader path, the assigned approver, the relevant department officer, or the destination department’s designated final decision-maker.
- Excludes linked evidence from the generic owner-only read policy so it is not readable solely because the requester owns the storage path.
- Adds two `SECURITY DEFINER` boolean helpers for the storage policies. They inspect references independently of the caller’s RLS-filtered view and reveal only whether the authenticated caller’s own path is evidence or is safe to delete.
- Extends the owner delete policy to deny deletion when a path is referenced by a submission, version, or approval step.
- Requires the first folder component to match `recorded_by`, consistent with the TEST upload path convention (`<user-id>/<file>`).

- **Security purpose:** Let relevant reviewers retrieve evidence while preventing unrelated users from gaining access or deleting evidence attached to an approval record, including when a policy subquery would otherwise be filtered by RLS.
- **Workflow impact:** The application repository currently has no offline-evidence UI or `approval_steps` references. The database-side policy prepares access, but application UI/API support remains separate. Previously stored evidence whose path does not use the recorder’s user-id folder may not be readable under this rule; inventory and resolve such paths before applying.
- **Verification:** Queries E inspect evidence columns, active Storage policies, and bucket privacy. After approval, test with a TEST recorder, assigned reviewer, department officer, final decision-maker, submitter without staff authority, and unrelated user; verify linked evidence cannot be deleted by its uploader.

## Review gates before any deployment

1. Confirm this proposal targets the TEST project and record its current URL/reference.
2. Confirm database ownership for the trigger function and scalar generator, and ensure the trigger-definer owner can execute the scalar generator. Query B reports wiring, owners, and effective execute privilege.
3. Confirm the role applying this migration can own/run the evidence-reference helpers and that their owner can inspect the referenced workflow tables despite RLS.
4. Inventory existing offline evidence paths for compatibility with the proposed folder/recorder rule.
5. Deploy the application-side legacy UPDATE-to-RPC cutover before a later authenticated UPDATE revoke.
6. Apply only after explicit review/approval. Do not run `supabase db push`, production SQL, or the active migration directory as part of this proposal.

## What this proposal does not establish

- It does not claim that any SQL has been applied.
- It does not establish migration history; the TEST inspection did not expose a project migration-history table/list.
- It does not prove email delivery, frontend offline-evidence support, or that uninspected external clients rely on direct table privileges.
- It does not change final-decision authority rules, points behavior, approval rules, or the revised workflow’s unspecified permission matrix.

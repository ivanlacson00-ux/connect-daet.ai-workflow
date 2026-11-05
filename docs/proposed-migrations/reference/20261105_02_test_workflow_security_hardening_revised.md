# Revised TEST workflow security-hardening proposal

**Status:** Proposal only; not applied to any database.  
**Target:** Supabase TEST project only. Production remains untouched.  
**SQL files:**
- Preflight: [`preflight/001_security_preflight.sql`](./preflight/001_security_preflight.sql)
- Migration: [`001_security_hardening.sql`](./001_security_hardening.sql)
- Post-deployment verification: [`post-deployment/001_security_verification.sql`](./post-deployment/001_security_verification.sql)
- Supplied combined source retained unchanged: [`reference/20261105_02_test_workflow_security_hardening_revised_combined.sql`](./reference/20261105_02_test_workflow_security_hardening_revised_combined.sql)  
**Original reference:** [20261105_01_test_workflow_security_hardening.sql](./20261105_01_test_workflow_security_hardening.sql)  
**Workflow source of truth:** [REVISED_WORKFLOW_PLAN.md](../REVISED_WORKFLOW_PLAN.md)

> **Offline approval evidence security and access policies are deferred pending institutional consultation.**

The revised SQL is a proposal only. It does not create evidence helpers, inspect or alter `approval_steps.evidence_file_path`, or create, drop, or change any Storage policy. The original proposal remains for reference and must not be combined with this revision.

The proposal reflects the prior read-only TEST inspection, not assumptions from local migrations. That inspection found 13 public application tables with RLS enabled, a private `workflow_uploads` bucket, and no project migration list/history available from the inspected interfaces.

**Deployment readiness: ready for a controlled TEST deployment, subject to explicit approval and the review gates below.** The TEST read-only connection resumed and the requested catalog checks completed on 2026-11-05. They confirmed the submission-function owner’s needed privileges, RLS behavior, relevant schema grants, tracking trigger state, and retained authenticated UPDATE. No database changes were made.


## File layout and execution order

The proposal is separated into three SQL files to reduce the chance of running inspection queries together with database changes:

1. Run `preflight/001_security_preflight.sql` first, statement by statement, against TEST only. Confirm that results still match the documented preflight findings. Stop if the schema, ownership, grants, trigger wiring, or RLS state has changed.
2. After reviewing the results and explicitly approving deployment, run only `001_security_hardening.sql` against TEST. It contains the transaction-wrapped hardening operations. Do not run the reference combined file.
3. Run `post-deployment/001_security_verification.sql` statement by statement against TEST. Confirm the expected function grants, trigger behavior, RLS state, and table/column privileges. Then test the affected application flows using TEST accounts.

All three SQL files are intentionally outside `supabase/migrations/`. The preflight and post-deployment files contain SELECT statements only. The migration file contains the approved DDL/privilege changes and its transaction boundary; it must not be run until explicitly approved. Production remains untouched.

The `reference/20261105_01_test_workflow_security_hardening.sql` file is the superseded first proposal. It includes the earlier offline-evidence/Storage-policy approach and is retained only for historical comparison. **Do not run it or combine it with the revised migration.** The `reference/20261105_02_test_workflow_security_hardening_revised_combined.sql` file is the supplied combined source snapshot and is also retained for comparison only.

## Proposed changes

### 1. Archive authorization hardening

The inspected `set_workflow_submission_archive()` checks `actor_role <> 'admin'`, which does not reject a NULL role. The revised function rejects a null `auth.uid()`, a missing profile/non-admin role using `IS DISTINCT FROM 'admin'`, and a NULL `should_archive` argument. It otherwise retains the archive/restore fields and audit event behavior.

- **Security purpose:** Require an authenticated profile explicitly assigned the `admin` role and an explicit archive/restore choice.
- **Application impact:** Existing admin archive/detail pages call this RPC. The revised proposal continues to grant `EXECUTE` to `authenticated` and removes it from `PUBLIC`/`anon`.
- **Verification:** Run verification query A after an approved TEST deployment. After approval, test archive and restore as an authorized TEST administrator; separately verify null action and non-admin calls are rejected without changing submission or audit data.

### 2. Tracking-number function permissions

The TEST inspection identified `generate_workflow_tracking_number()` as a `SECURITY DEFINER` scalar function returning `text` that increments the `workflow_tracking_sequences` table. `submit_document()` calls the generator directly, while the `set_workflow_submission_tracking_number()` trigger function calls it only when an inserted tracking number is blank.

The proposal pins both functions to `pg_catalog, public`, ensures the trigger helper runs as `SECURITY DEFINER`, and revokes direct execution on both functions from `PUBLIC`, `anon`, and `authenticated`. The trigger helper is only needed by the database trigger and should not be exposed as an RPC. It leaves the trigger installed.

- **Security purpose:** Prevent clients from directly invoking the mutating scalar generator or trigger helper, while preserving generator calls made by the SECURITY DEFINER submission RPC and trigger.
- **Application impact:** Submission creation continues through the existing `submit_document()` RPC, which calls the generator as its owner; the trigger remains enabled as a fallback for inserts without a tracking number.
- **Verification:** Query A checks function types, settings, and grants. Query B confirms trigger wiring, enabled state, return type, and whether the trigger function owner can execute the scalar. After approved deployment, test an actual TEST submission to ensure its tracking number is generated despite direct EXECUTE being revoked.

### 3. Role-sync `search_path`

The inspected `sync_role_to_app_metadata()` function has no function-level `search_path` setting. The proposal pins it to `pg_catalog, public` without changing the existing role-to-`raw_app_meta_data` synchronization body. Direct application execution is revoked; the existing profile role-update trigger remains the caller.

- **Security purpose:** Avoid unsafe object resolution within a `SECURITY DEFINER` function.
- **Application impact:** Existing authorized role updates should still update auth app metadata through the trigger.
- **Verification:** Query A checks function settings and grants. Confirm the existing `on_role_updated` trigger remains enabled; after approval, test an authorized role update in TEST and confirm metadata synchronization.

### 4. Submission INSERT/DELETE permissions and `submit_document()` authorization

The inspected TEST `submit_document()` function is `SECURITY DEFINER`. Its body obtains `actor` from `workflow_require_actor()`, which requires a non-null authenticated user with a matching profile. It rejects the `external_approver` role, requires an active destination department, and inserts the submission with `user_id = actor`. It also creates the first document version and sets it as current.

The repository’s upload page uploads the file and calls `submit_document()`; no checked-in application page directly inserts into `workflow_submissions`. Therefore, the proposal revokes direct `INSERT` and `DELETE` from `PUBLIC`, `anon`, and `authenticated` while leaving the submission RPC and its existing authorization logic unchanged.

The inspected function permits any valid profile role except `external_approver` to submit. The plan does not define a detailed permission matrix for whether approvers/admins may submit, so this proposal preserves that behavior rather than inventing a new role restriction. Confirm the intended role scope before changing the RPC.

Direct authenticated `UPDATE` is **retained** because current repository pages still depend on it:

- The approver detail page directly updates `status`, `approver_comments`, and `updated_at`.
- The admin submission detail page directly updates `status`, `admin_comments`, and `updated_at`.
- `hooks/useSubmissions.ts`, used by the admin pending page, directly updates status/rejection comment and then attempts an insert into `audit_logs`; the inspected audit table is `workflow_audit_logs`.

The proposal revokes anonymous UPDATE but does not revoke authenticated UPDATE. Revoking authenticated UPDATE requires a separately reviewed application RPC cutover; doing it now would break legacy review actions.

- **Security purpose:** Remove unneeded direct INSERT/DELETE paths while keeping authenticated UPDATE available until dependent application operations are moved behind authorized RPCs.
- **Application impact:** Upload remains through `submit_document()`. Existing admin/approver status-update screens continue to have the table privilege they currently use.
- **Verification:** Query C checks the live submission RPC body, execute grants, and security mode. Queries D/E check RLS and effective table privileges. After approved deployment, test upload plus both existing legacy review actions in TEST before considering a later UPDATE restriction.

#### Additional `submit_document()` preflight

The revised SQL now includes read-only preflight queries P1–P4:

- **Owner and write targets:** P1 returns live definitions, owners, `SECURITY DEFINER` settings, and function-level `search_path` settings for public SECURITY DEFINER functions. Review `submit_document()` and its callees/triggers to identify all direct and indirect writes; PostgreSQL does not reliably record PL/pgSQL table references as catalog dependencies.
- **Table privileges and RLS:** P3 checks the `submit_document()` owner’s table privileges on `workflow_submissions`, `document_versions`, `workflow_tracking_sequences`, and `workflow_audit_logs` (the latter two are involved through the tracking generator and insert-audit trigger), and reports their owners and RLS flags. P3b returns their policies for review. A SECURITY DEFINER function runs as its owner; it does not automatically bypass RLS. RLS is bypassed by a superuser/BYPASSRLS role or (unless FORCE RLS applies) the table owner. Otherwise, a matching policy must permit the operation.
- **Tracking counter privileges:** P4 checks the generator owner’s privileges on `workflow_tracking_sequences`. TEST confirms this is a table-backed counter, not a PostgreSQL sequence.
- **Schema trust/search paths:** P2 reports `USAGE` and `CREATE` privileges for `anon` and `authenticated` on every schema, to compare against the function paths in P1. Untrusted roles must not have CREATE on schemas included in SECURITY DEFINER search paths.

The proposed `REVOKE INSERT` on `workflow_submissions` removes the client’s direct table privilege, not the function owner’s privilege. TEST confirms the `postgres` function owner has required table privileges and `BYPASSRLS`; RLS is enabled but not forced on the relevant tables. Thus the SECURITY DEFINER RPC can continue performing its writes after client INSERT is revoked.

#### Search-path review

The proposal pins the functions it changes to `pg_catalog, public`; it does not change `submit_document()` or other existing function definitions. TEST confirms `anon` and `authenticated` cannot CREATE in `public` or the other inspected schemas. The relevant application and `auth` references in the inspected function bodies are schema-qualified. A safe minimal configuration is `pg_catalog` plus only the trusted schemas actually required by the function, with application objects schema-qualified where practical.

#### Tracking and UPDATE checks

The expanded tracking verification checks the trigger helper and scalar generator owners, function settings, trigger enablement and wiring, and whether the trigger helper owner can execute the scalar after client grants are revoked. TEST confirms both functions are owned by `postgres`, the trigger is enabled, and its function owner can execute the generator. `submit_document()` itself also calls the generator directly as the same owner.

The proposal continues to retain authenticated UPDATE and only revokes UPDATE from `PUBLIC` and `anon`. TEST confirms authenticated currently has effective UPDATE; query E verifies it remains available after deployment.

#### Live TEST findings (2026-11-05)

- `submit_document()` is owned by `postgres`, is `SECURITY DEFINER`, and remains executable by `authenticated` but not `anon`. Its owner has the needed privileges on `workflow_submissions`, `document_versions`, and `workflow_tracking_sequences`.
- The submission insert trigger also writes to `workflow_audit_logs`. These tables are owned by `postgres`, have RLS enabled, and do not FORCE RLS. The owner has `BYPASSRLS` (not superuser), so these writes do not depend on end-user RLS policies.
- The RPC requires a valid authenticated profile, rejects `external_approver`, checks that the destination department is active, writes the actor as `user_id`, and creates the initial document version. Its tracking number is generated by a direct call inside the SECURITY DEFINER RPC.
- No PostgreSQL sequence is involved; tracking counters are held in `workflow_tracking_sequences`. The generator and trigger helper are both owned by `postgres`; the enabled BEFORE INSERT trigger remains wired to the trigger-returning helper, and its owner can execute the scalar generator.
- `submit_document()`, its actor/profile helpers, and tracking functions have `search_path=public`; `sync_role_to_app_metadata()` had no function-level setting. `anon` and `authenticated` have USAGE but not CREATE on `public` or the other inspected schemas. The proposal pins modified functions to `pg_catalog, public`, explicitly placing built-ins first.
- **ACL verification (final read-only check):** `workflow_submissions.relacl` contains direct grants from `postgres` to `anon`, `authenticated`, and `service_role`; the `anon` and `authenticated` entries include INSERT and UPDATE. There is no `PUBLIC` ACL entry, and no membership grants to `anon` or `authenticated` were found, so authenticated UPDATE is direct, not inherited. No column-level ACL entries exist. The effective authenticated UPDATE privilege currently covers `status`, `approver_comments`, `admin_comments`, and `updated_at`.
- **Proposal effect:** `REVOKE INSERT, DELETE ... FROM PUBLIC, anon, authenticated` removes table-level INSERT/DELETE from those grantees. The separate `REVOKE UPDATE ... FROM PUBLIC, anon` does not revoke the direct UPDATE grant to `authenticated`. Since the existing update access is table-level and no column-level INSERT grants exist, the proposed SQL preserves the four application UPDATE columns and does not leave column-level INSERT grants behind for these roles.

No blocker was identified in these requested preflight checks. This is readiness for a controlled TEST deployment only, not authorization to apply the proposal.

## Verification expectations

The SQL proposal includes catalog-only verification queries. They do not call workflow functions or mutate records. Expected results after a separately approved deployment:

- Archive RPC: `authenticated` can execute; `anon` cannot.
- Tracking-number scalar function: neither `anon` nor `authenticated` can execute it directly; enabled submission insert trigger remains and its owner can execute the scalar.
- Role sync: pinned search path, no direct anon/authenticated execution; trigger remains enabled.
- `submit_document()`: retains authenticated access and its inspected actor/profile, role, and active-department checks.
- `workflow_submissions`: RLS remains enabled; anonymous users lack INSERT/UPDATE/DELETE; authenticated users lack direct INSERT/DELETE but retain UPDATE temporarily.
- The final ACL verification queries F1/F2 inspect direct table grants and explicit per-column ACL grants. F2b checks effective column privileges, including UPDATE on the four legacy application columns and absence of INSERT after the proposed revocation.
- TEST preflight confirmed the live function owner has required table privileges and workable RLS behavior; untrusted roles cannot CREATE in relevant SECURITY DEFINER search-path schemas; tracking trigger owner retains generator EXECUTE.
- Authenticated UPDATE remains available to support existing application pages.

## Explicitly deferred

**Offline approval evidence security and access policies are deferred pending institutional consultation.** This revision makes no Storage policy changes, does not create evidence helper functions, does not change `approval_steps.evidence_file_path` handling, and does not modify existing evidence-related functionality.

## Review gates

1. Review the revised SQL against the current TEST project before applying; do not combine it with the original proposal.
2. Before deployment, rerun the included read-only preflight and ACL queries to ensure the TEST schema and grants have not changed since the 2026-11-05 inspection.
3. Confirm the trigger helper owner can still execute the tracking scalar after the proposed revocation; if not, revise the proposal before deployment.
4. Confirm whether approver/admin profiles are intended to submit, since `submit_document()` currently allows them.
5. Plan a separate authenticated UPDATE-to-RPC migration before revoking that privilege.
6. Apply only after the preflight is clear, explicit approval is given, and only to TEST. Do not use `supabase db push`, the production project, or the active migration directory for this proposal.

# CONNECT-Daet.ai — Database Security Status / Handoff

**Based on:** The Claude conversation excerpt supplied by the user.  
**Scope constraint:** Work in the Supabase **test project only**. Do not modify the production/main database unless the user explicitly authorizes it.

> This is a record of the last known state in the supplied conversation, not a live inspection of Supabase. Re-check the test database before relying on it.

## 1. Environment rule

- The user explicitly said to make changes in the test project first.
- Do not run SQL, migrations, or configuration changes against production.
- Keep a record of changes made in test so they can be reviewed and prepared for a later production migration only when the user approves.

## 2. Fix 1 — Prevent signup metadata from granting admin role

**Status in test: Applied and verified, according to the supplied Claude conversation.**

The `public.handle_new_user()` trigger function was changed so a new profile receives the literal role `'user'`, rather than trusting `new.raw_user_meta_data->>'role'` supplied during signup. The function also pins its search path to `public`.

The test inserted a signup request whose metadata asked for `admin`. The test deliberately raised an exception to display the result and roll back the test insert. The returned result was `role = user`, matching the expected result.

The supplied conversation also reported that the trigger points to the single `handle_new_user()` function.

## 3. Fix 1b — Pin search_path for sync_role_to_app_metadata

**Status: Not confirmed as applied in the supplied conversation.**

The recommended statement was:

```sql
alter function public.sync_role_to_app_metadata()
set search_path = public;
```

Do not assume this was executed. Confirm the current test-project function definition/configuration before marking it complete.

## 4. Fix 2 — Audit direct function execution privileges

**Status: Pending in the supplied conversation.**

The next requested action was to run a privilege-audit query in the test project's SQL Editor and inspect whether `anon` and `authenticated` can execute functions in the `public` schema.

The functions specifically called out for review were:

- `workflow_apply_step_decision`
- `workflow_log_event`
- `generate_workflow_tracking_number`
- Public workflow entry points such as `submit_document`, `decide_routing`, and `final_decision`

The intended review is not to revoke every function indiscriminately:

- Internal helper functions should not be directly callable by roles that do not need them.
- Public workflow functions may need to remain callable by signed-in users if they enforce authorization and workflow-state checks internally.
- Anonymous execution should be reviewed carefully and should not be enabled unintentionally.

The actual query result was not included in the supplied conversation. Do not assume any privilege values.

## 5. Known outstanding verification

1. Confirm whether `sync_role_to_app_metadata()` has the intended `search_path` setting in the test project.
2. Obtain and review the test project's function-privilege query results.
3. For each exposed workflow function, inspect its implementation for role, department, assignment, document-access, and workflow-step checks before changing grants.
4. Verify RLS policies for tables and Supabase Storage policies for document files and versions against the revised workflow plan.
5. Verify audit-history protections and ensure ordinary users cannot alter or delete audit records.

Items 3–5 are recommended follow-up audits based on the revised workflow's security requirements; the supplied Claude excerpt does not establish that they have already been completed.

## 6. Copilot safety instructions

- Audit the **test project only**.
- Never connect to, query, or modify production as part of this task.
- Do not execute SQL or migrations unless the user explicitly asks for a specific test-project operation.
- Do not make permission changes based only on function names. Read function bodies, dependencies, and intended callers first.
- Do not weaken RLS or Storage policies to make the application work.
- Report what is verified, what is inferred, and what remains unknown separately.

# CONNECT-Daet.ai — Clean TEST Environment Preparation Checklist

**Status:** Documentation-only preparation checklist; no environment or database operation is authorized
**Workflow authority:** [Revised workflow plan](./REVISED_WORKFLOW_PLAN.md)
**Planning inputs:** [Phase 2 implementation roadmap](./PHASE_2_IMPLEMENTATION_ROADMAP.md), [Stage 3 relational model](./PHASE_3_RELATIONAL_MODEL_AND_INTEGRITY_SPECIFICATION.md), [Stage 4 authorization and RLS design](./PHASE_4_AUTHORIZATION_AND_RLS_DESIGN.md), [Stage 5 database operations design](./PHASE_5_DATABASE_OPERATIONS_AND_TRANSACTION_INTEGRITY_DESIGN.md), [Stage 6 testing and validation strategy](./PHASE_6_TESTING_AND_VALIDATION_STRATEGY.md), and [Stage 7 verification and controlled rollout plan](./PHASE_7_VERIFICATION_AND_CONTROLLED_ROLLOUT_PLAN.md)

> This checklist prepares for a future, separately authorized clean Supabase TEST environment. It does not provision a project, request credentials, connect to Supabase, run SQL or tests, create or apply migrations, or authorize deployment. The legacy TEST project is reference-only. Production is completely excluded.

## 1. Purpose and scope

Use this checklist to prepare a new, isolated Supabase TEST project for a future approved CONNECT-Daet.ai implementation and verification effort. The intended target is a **separate clean Supabase project**, not a clone or continuation of the existing legacy TEST project.

This checklist is a preparation aid only. It distinguishes planning and review from operational permission:

| Activity | Meaning | Authorization boundary |
|---|---|---|
| **Prepare this checklist** | Record required decisions, evidence, owners, and stop conditions. | This documentation task authorizes only creation of this checklist. |
| **Approve project provisioning** | An institutionally authorized owner approves creation of a separate clean TEST project, including ownership, purpose, access, and cost/resource arrangements as applicable. | Requires explicit approval outside this checklist. |
| **Provision project** | Create the Supabase project and configure project-level settings. | Requires separate provisioning authorization and an authorized operator. This has not occurred. |
| **Approve migration deployment** | Review and approve a specific migration package, target, execution plan, and recovery plan. | Requires explicit change/deployment authorization for that named target and package. |
| **Deploy database changes** | Apply the authorized migrations or other database changes. | Requires separate execution authorization. This checklist does not authorize it. |
| **Authorize test execution** | Approve a specific test plan, candidate, fixtures, and isolated target. | Requires explicit test authorization. |
| **Execute tests** | Run approved tests and collect evidence. | Requires separate test-execution authorization. No tests are authorized or executed here. |
| **Production activity** | Any access, query, deployment, or change involving Production. | Entirely outside scope. This checklist grants no Production access or permission. |

No phase or checkbox below is evidence of completion until a responsible person records the required evidence. Documentation, repository files, and local checksums do not prove a hosted project's state.

## 2. Existing environment inventory and evidence limitations

### 2.1 Documented repository context

- [The Phase 2 gap analysis](./PHASE_2_WORKFLOW_GAP_ANALYSIS.md) reports historical read-only observations from a legacy Supabase TEST project and states that the inspected custom migration registry did not provide a usable record of applied project migrations.
- [The Phase 2 implementation roadmap](./PHASE_2_IMPLEMENTATION_ROADMAP.md) requires reconciling existing structures before implementation and warns against retaining competing workflow models or inferring deployed state from local migrations.
- [The Stage 3–6 documents](./PHASE_3_RELATIONAL_MODEL_AND_INTEGRITY_SPECIFICATION.md) describe proposed model, authorization, transaction, and testing designs. They do not establish that these designs have been approved, implemented, or deployed.
- [The Stage 7 plan](./PHASE_7_VERIFICATION_AND_CONTROLLED_ROLLOUT_PLAN.md) treats the legacy TEST project as reference-only and requires separately authorized, target-identified evidence for a future clean TEST environment.
- [The documentation index](./README.md) asserts that a named security migration was deployed to TEST and gives a supplied checksum. The Phase 2 audit says its inspected registry did not establish the applied custom-migration set and that a matching local checksum alone is not proof of application. This difference remains unresolved; neither claim is independently confirmed by this checklist.
- Local files under `supabase/migrations/` are repository artifacts only. Their presence, ordering, or checksum does not establish application to any Supabase project.

### 2.2 Evidence categories to keep separate

Record each fact using the narrowest applicable category:

1. **Repository artifact exists:** file path, revision, and checksum if relevant.
2. **Checksum matches a supplied value:** identify the exact file and comparison source; this proves byte identity only.
3. **Project provisioned:** target-specific project identity and provisioning record.
4. **Migration applied:** target-specific deployment record naming the project, migration identifier/checksum, execution result, date, and operator.
5. **Post-deployment state verified:** target-specific read-only verification procedure and results compared with an approved manifest.
6. **Application tested:** candidate build and test results tied to an authorized environment and fixtures.

Do not treat one category as proof of a later category. In particular, a local migration or matching checksum is not proof of application, and application is not proof of successful post-deployment verification.

### 2.3 Inventory record — complete only after separate authorization

Do not query, connect to, or attempt to rediscover the legacy project as part of this preparation. For a future authorized clean project, maintain an inventory record with:

| Inventory field | Record when authorized |
|---|---|
| Environment purpose and classification | Confirm it is dedicated to CONNECT-Daet.ai TEST and not Production. |
| Project identity | Supabase project reference, project URL/domain, region, and how each was verified. Do not rely on display name alone. |
| Ownership | Institution/team owner, project administrator, billing/resource owner if applicable, and approval reference. |
| Access | Authorized operators, roles, access approval, and review/expiry plan. Do not put credentials in this document. |
| Baseline state | Whether the project is newly provisioned and what project-level configuration already exists. Record only after authorized inspection. |
| Schema/migration state | Approved inventory/manifest and target-specific application evidence, if any. Do not infer this from repository migrations. |
| Evidence provenance | Date, executor, method, target, and sanitized evidence reference for each observation. |

Until collected under separate authorization, project identity, ownership, access, schema state, migration state, and configuration are **unknown / not verified**.

## 3. Clean TEST project ownership and authorized access

- [ ] An institutionally designated project owner has been identified and accepts responsibility for the clean TEST project's purpose, access, and lifecycle.
- [ ] The authority that may approve provisioning and authorize database/test activity is identified. If not identified, record **TBD** and stop before provisioning or access.
- [ ] A separate project-provisioning approval identifies the purpose, isolation requirements, expected users/operators, and resource/cost owner as applicable.
- [ ] The project owner personally creates the fresh Supabase TEST project after provisioning approval; project creation does not grant Copilot read-only or write-capable access.
- [ ] Authorized operators are named in an access register and receive only the privileges necessary for their duties.
- [ ] Human operator access and application runtime credentials are distinct; no shared personal credentials or undocumented credential distribution is used.
- [ ] Access-review, revocation, incident-contact, and credential-rotation responsibilities are assigned by the authorized owner.
- [ ] The legacy TEST project is explicitly excluded as a deployment, migration, or architecture-test target.
- [ ] No Production identity, key, URL, database, data, or connection information is imported into this environment plan.

**Evidence to retain:** provisioning approval, project owner and operator authorization record, access-role mapping, environment classification, and review/revocation responsibility. Store secrets only in an approved secret manager or protected configuration, never in this checklist.

## 4. Project identity and environment verification

Before any later operation against a newly provisioned project:

- [ ] Confirm the project reference and URL directly from an authorized project-level source; cross-check both against the approved provisioning record.
- [ ] Confirm the project is the intended clean TEST project, owned by the approved entity, and distinct from the legacy project and Production.
- [ ] Record the verification date, verifier, source, and sanitized evidence. Never record access tokens or secret keys.
- [ ] Confirm the target label/display name is not the sole means of identification.
- [ ] Confirm CLI, CI, application, and test-tool target settings resolve only to the approved clean TEST project when that work is separately authorized.
- [ ] Add fail-closed checks so missing or unexpected project identity halts future operations rather than falling back to a shared or production target.
- [ ] Reconfirm target identity immediately before each separately authorized migration, database inspection, or test run.

**Stop condition:** Any mismatch, ambiguous owner, unknown project reference, legacy-project target, Production target, or inability to verify the target independently blocks all access and execution.

### 4.1 Copilot write-access authorization gate

Copilot access is separate from project creation and must be explicitly authorized for the exact verified clean TEST project. Read-only and write-capable access are distinct permissions:

- **Read-only access** permits only specifically approved inspection. It does not imply permission to provision, change settings, apply migrations, seed data, or run tests that write.
- **Write-capable access** includes any credential, tool, or permission that can change project configuration or database state. It requires the project owner's explicit authorization after identity verification.
- Creating the project, approving provisioning, or granting read-only access does not authorize Copilot's write-capable access.

Before any Copilot write-capable access is granted:

- [ ] The project owner personally creates the fresh Supabase TEST project after separate provisioning approval.
- [ ] The owner verifies the project's **name**, **project reference**, and **TEST** environment classification against the provisioning approval and an authorized project-level source.
- [ ] The owner confirms that this is the exact intended clean TEST target and is distinct from the legacy TEST project and Production.
- [ ] The owner records the verified project reference through an approved, non-secret evidence channel and explicitly authorizes Copilot's write-capable access to **that project reference only**.
- [ ] The owner specifies the scope and duration of the write authorization. It does not authorize migration execution, data seeding, tests, or other operations unless those are separately approved.
- [ ] Before and during every write-capable operation, the active project reference is compared with the owner-verified reference. If it differs, is missing, or cannot be established, Copilot must stop without attempting the operation.
- [ ] Any migration execution is separately authorized only after the owner/reviewer has reviewed the exact SQL migration files, manifest/checksums, target, and recovery plan. Project-level write authorization alone is insufficient.

The project owner must not provide or expose service-role credentials in browser-accessible code. Any privileged credential, if separately required and authorized, remains server-side and narrowly scoped; it must not be copied into this document, client-side environment variables, browser-reachable imports, bundles, or source maps.

**Authorization boundary:** Write access applies exclusively to the owner-verified new TEST project. The legacy TEST project and Production remain off-limits regardless of any access grant. If target identity changes or becomes ambiguous, stop and require the owner to reverify and explicitly reauthorize before proceeding.

## 5. Environment-specific application configuration

Prepare separate configuration profiles for local development and the clean TEST project. Do not fill this checklist with secret values.

- [ ] Inventory the application's actual environment-variable names and classify each as browser-public, server-only, build-time, or test-only. Verify against the chosen application framework and existing project configuration rather than inventing names.
- [ ] Document which non-secret project URL and publishable/anonymous client key are intended for the browser, if applicable, and which server-only credentials are required by approved server tasks.
- [ ] Keep clean TEST settings separate from local settings and any other environment. Do not reuse Production values.
- [ ] Confirm browser-visible configuration contains no service-role key, database password, signing secret, provider credential, or other privileged secret.
- [ ] Ensure a missing TEST URL/key or environment label fails closed; no automatic fallback to a different hosted project.
- [ ] Ensure local scripts and CI jobs print the environment classification and sanitized project reference before any future target-bound operation, without printing secret values.
- [ ] Verify build output and source maps for accidental privileged configuration exposure as part of separately authorized build/security checks.
- [ ] Document configuration owner, secret-manager location by reference only, rotation process, and change/review process.

**Acceptance evidence:** approved variable inventory, environment mapping, non-disclosing configuration review, and a successful target-identity guard test when implementation and test execution are separately authorized.

## 6. Authentication and redirect URL preparation

Prepare authentication settings for the clean TEST domain only after project provisioning and separate authorization:

- [ ] Identify the approved clean TEST application origin(s), including any authorized preview domain. Do not infer them from the legacy project or Production.
- [ ] List required authentication redirect/callback URLs and logout/return URLs for the exact clean TEST and approved local development origins.
- [ ] Confirm provider callback URLs and Supabase Auth site/redirect allow-list configuration agree with the approved domains and callback paths.
- [ ] Avoid broad wildcard redirects. Use only the narrow patterns required by approved development and TEST deployments.
- [ ] Confirm no Production domain or callback is added as a shortcut.
- [ ] Review email confirmation, password reset, and OAuth redirect behavior only after the relevant provider settings and test identities are approved.
- [ ] Use synthetic accounts and a controlled test email/provider or mock. Do not send test messages to real submitters or municipal offices.
- [ ] Capture sanitized configuration evidence and an owner-approved list of allowed origins; do not capture tokens or personal inbox content.

No authentication settings are changed by preparing this checklist.

## 7. Secrets and privileged credential management

- [ ] Identify a formally approved secret manager or protected deployment-secret store and authorized maintainers.
- [ ] Keep service-role credentials and database passwords server-side only; do not place them in client-side environment variables, browser-reachable imports, source files, fixtures, screenshots, logs, or source maps.
- [ ] Use the least-privileged credential supported for each approved operation. A service-role credential bypasses ordinary RLS boundaries and must not be used for routine user-scoped application requests without a separately approved, explicit authorization design.
- [ ] Keep runtime, migration, test-runner, and human-operator credentials separate where feasible and documented.
- [ ] Define secret issuance, access approval, rotation, revocation, and incident response before use. Do not request or expose secrets in this preparation task.
- [ ] Configure CI/logging to mask sensitive values and prevent command-line arguments or debug output from disclosing them.
- [ ] Define a secret-scanning process that reports only safe finding categories and sanitized file/artifact references; never print actual secret values.
- [ ] Verify that no build or deployment path silently substitutes a privileged credential into browser assets.

**Stop condition:** Any suspected committed, browser-exposed, logged, shared, or otherwise compromised privileged credential blocks use of the affected environment until handled through the approved security process.

## 8. Database migration inventory and review

This section is a review checklist, not a migration or SQL instruction. No migration file is to be executed as part of preparation.

### 8.1 Pinned Supabase CLI and safe local setup

Use the stable Supabase CLI **v3.1.0** for reproducible preparation. It was published on 2026-11-09; pin the version explicitly rather than using `latest`. See the [v3.1.0 release notes](https://github.com/supabase/cli/releases/tag/v3.1.0).

The repository currently has no `supabase/config.toml` and no Supabase CLI on `PATH`. The `supabase/migrations/` directory already contains the six clean migrations, and the legacy archive is outside that directory. Do not initialize a configuration with `--force`.

From the repository root, first verify Node.js and npm, then invoke the exact CLI version without adding it to a project manifest:

```powershell
node --version
npm.cmd --version
npx.cmd --yes supabase@3.1.0 --version
```

Expected CLI output is `3.1.0`. If the `supabase` configuration files are absent, initialize only the local CLI configuration. The guard stops rather than replacing an existing TOML/JSON configuration:

```powershell
$existingConfig = @(
  '.\supabase\config.toml',
  '.\supabase\config.json',
  '.\supabase\config.jsonc'
) | Where-Object { Test-Path $_ }
if ($existingConfig) { throw "Supabase config already exists; inspect it and do not use --force." }
npx.cmd --yes supabase@3.1.0 init
```

Inspect the generated configuration and verify the active migration directory still contains exactly the six clean migration files:

```powershell
Get-Content .\supabase\config.toml
Get-ChildItem .\supabase\migrations -File -Filter '*.sql' |
  Sort-Object Name |
  Select-Object -ExpandProperty Name
git status --short -- .\supabase
```

Expected configuration is Supabase CLI's local `config.toml` with the standard migration path `supabase/migrations/`; expected listing, in order, is:

1. `20261109212000_create_identity_and_authority_model.sql`
2. `20261109212100_create_submission_version_and_routing_model.sql`
3. `20261109212200_create_review_and_reassessment_model.sql`
4. `20261109212300_create_decisions_history_and_supporting_model.sql`
5. `20261109212400_enable_least_privilege_rls_and_history_guards.sql`
6. `20261109212500_add_checked_workflow_operations.sql`

Do not accept a config that changes the migration directory or includes archived SQL. `supabase init` is not a database operation and must not be given `--force`.

**Do not log in, link a project, or run the remote commands below now.** Only after target identity, read-only inspection access, and migration-specific deployment planning receive their separate approvals, use the explicit TEST reference rather than relying on any previously linked project:

```powershell
npx.cmd --yes supabase@3.1.0 migration list --remote=zmtdorriscurlvvzovfg
npx.cmd --yes supabase@3.1.0 db push --dry-run --remote=zmtdorriscurlvvzovfg
```

`migration list` is a remote history inspection. Compare its actual result with the approved clean-project baseline; do not assume the history is empty. The dry run must identify the target as `zmtdorriscurlvvzovfg`, show the six local migrations as pending on a fresh database, and show no SQL being applied. Stop for any unexpected remote history, missing/extra migration, target mismatch, or privilege error. Do not remove `--dry-run` without a later explicit deployment authorization. In CLI v3, `--remote` identifies the explicit project reference; no `supabase link` is needed for these commands.

### 8.2 Executor role and ownership-transfer prerequisites

PostgreSQL 17 automatically gives a non-superuser `CREATEROLE` role that creates a role `ADMIN OPTION` on that newly created role, but the initial membership has `SET FALSE` and `INHERIT FALSE`. The creator can use that ADMIN OPTION to grant itself membership with `SET TRUE`. `CREATEROLE` alone does not provide membership grant authority for an unrelated pre-existing role. Function ownership transfer requires the migration actor to be able to `SET ROLE` to the executor. See PostgreSQL's [role-creation rules](https://www.postgresql.org/docs/17/role-attributes.html#ROLE-CREATION), [role-membership rules](https://www.postgresql.org/docs/17/role-membership.html), and [`GRANT` role rules](https://www.postgresql.org/docs/17/sql-grant.html).

The original ownership blocks tested `MEMBER`, which is true for the creator's automatically granted membership even though `SET` is false. They consequently skipped the required self-grant, and the ownership transfer could fail. The clean migration ownership blocks now test `SET`, verify that the actor is a superuser or has direct ADMIN OPTION before granting itself `SET TRUE`, and then transfer ownership. For an existing executor role, migration 1 also deliberately rejects role memberships as an unclean pre-existing state; do not bypass that guard. The read-only preflight distinguishes a role absent and to be created by the actor from an existing role, and reports role-creation authority, SET capability, ADMIN OPTION, and existing membership state separately.

The connected TEST role's actual capabilities and executor-role state remain unknown until a separately authorized read-only preflight is run against the verified TEST project. Do not elevate the executor or otherwise change role attributes as an ad hoc workaround.

- [ ] Identify the exact repository revision and inventory of candidate migration files proposed for the clean architecture. Preserve file paths and checksums in a review manifest.
- [ ] Distinguish canonical candidates from historical, superseded, or deferred proposals. Confirm dependencies and ordering with the responsible database reviewers.
- [ ] Compare the candidate package with the approved Stage 3 model and Stage 4 authorization design; reconcile competing legacy structures before selecting the target model.
- [ ] Review every migration for destructive operations, data-loss risk, privilege changes, function/trigger behavior, Storage effects, and rollback/forward-recovery implications.
- [ ] Confirm offline approval evidence and Storage policy redesign are not included unless separately designed, institutionally approved, and explicitly authorized.
- [ ] Review seed/test setup separately from schema migrations; require synthetic-only records and controlled cleanup.
- [ ] Produce a reviewed migration manifest with migration identity, checksum, ordering/dependencies, expected objects, reviewer, approval reference, and target scope.
- [ ] Record preflight and post-deployment verification procedures as separate reviewed artifacts. A migration is not its own proof of successful deployment.
- [ ] Obtain explicit deployment approval for the exact artifact manifest and exact clean TEST project before any application of migrations.
- [ ] Following any separately authorized deployment, record project identity, migration identity/checksum, operator, execution result, date, deviations, and target-specific verification results.

Do not use the legacy project's schema as the architecture target or copy it into the clean project. Do not infer that a checked-in file has been applied based on its name, timestamp, ordering, or checksum.

## 9. Schema, grants, RLS, functions, triggers, and indexes verification requirements

After separate project and inspection authorization, define a read-only verification plan that compares the target with the approved schema/security manifest. The checklist itself does not authorize these queries.

- [ ] **Schema:** Verify expected schemas, tables, columns, types, defaults, nullability, and ownership.
- [ ] **Relationships and constraints:** Verify primary/foreign keys, same-parent/same-submission integrity, unique/check/exclusion constraints, and referential actions against the approved Stage 3 model.
- [ ] **Indexes:** Verify the approved unique and lookup indexes exist with intended definitions; review their target and predicate, not only their names.
- [ ] **Grants and privileges:** Verify effective database-role, schema, table, column, sequence, and function privileges, including inherited/effective privileges relevant to app roles.
- [ ] **RLS:** Verify RLS enabled/forced state as required, complete effective policy composition, policy commands/roles/conditions, and interaction with grants. An isolated policy listing is not proof of effective access.
- [ ] **Functions:** Verify expected definitions, owners, volatility/security mode, fixed/safe search paths where applicable, actor identity derivation, `SECURITY DEFINER` boundaries, and effective EXECUTE privileges for `anon`, `authenticated`, and service roles as applicable.
- [ ] **Triggers:** Verify active triggers, timing/events/conditions, associated function identities, and whether writes preserve transactional history and do not create unintended bypasses.
- [ ] **Authorization boundaries:** Check direct API/PostgREST read/write behavior and separate application authorization behavior under the approved test plan. UI behavior alone is not sufficient.
- [ ] **Workflow integrity:** Map each reviewed schema/security object to its requirement, enforcement purpose, verification method, and result.
- [ ] **Evidence:** Preserve target identity, approved manifest version, verification method, date/operator, expected/actual result, and sanitized output. Do not capture real user records or secrets.

Any unexpected object, privilege, policy interaction, function exposure, missing invariant, or target drift is a stop condition pending review. Do not repair drift by ad hoc SQL; obtain a separately approved change and migration.

## 10. Synthetic seed data and test fixture preparation

- [ ] Use only synthetic people, office names/IDs, submissions, attachments/metadata, messages, and notification addresses created for testing.
- [ ] Never copy production or legacy TEST records into clean TEST fixtures.
- [ ] Create a fixture catalog for submitters, Tourism Officers, office representatives, offices, and administrators that reflects approved test roles without granting unapproved authority.
- [ ] Include authorized and unauthorized combinations needed for isolation, cross-office, revoked-membership, stale-state, and workflow tests.
- [ ] Include workflow cases for Path A, manual Path B, simultaneous and one-at-a-time routing, multiple responsibility types, version changes, correction, reassessment, and final-review safeguards as applicable.
- [ ] Use controlled notification sinks/mocks; no fixture may resolve to a real applicant, municipal office, or public mailing list.
- [ ] Define fixture setup, precondition assertions, namespacing, cleanup, and retained failure evidence before tests are authorized.
- [ ] Ensure fixture outputs and logs use synthetic identifiers and do not expose credentials or document contents.

Fixture creation, seeding, and cleanup are database operations and are not authorized by this checklist.

## 11. Storage preparation — deferred

The revised workflow and roadmap defer offline approval evidence and Storage-policy changes pending separate consultation. Stage 3–6 Storage descriptions are conceptual, not authorization.

- [ ] Keep any Storage bucket, object policy, signed-URL, retention, offline evidence, or cleanup redesign out of the initial clean TEST deployment package unless separately approved.
- [ ] Do not copy legacy Storage buckets, objects, policies, or offline evidence as a shortcut.
- [ ] Record the Storage/offline design dependency and required institutional consultation for a future separately scoped decision.
- [ ] If attachment metadata is needed for an approved workflow test, use synthetic metadata and separately approved disposable objects/mechanisms; do not infer Storage access policy from database RLS.
- [ ] Treat object upload and database metadata transaction/recovery as distinct concerns. Do not claim that a database rollback removes an uploaded object.
- [ ] Do not change Storage policies or upload/read real evidence as part of preparing this checklist.

**Status:** Deferred; no Storage design or offline evidence behavior is approved here.

## 12. Backup and recovery preparation

Before any separately authorized deployment or test that could alter a shared state:

- [ ] Determine and document the clean TEST project's approved backup/restore or recovery capabilities and limitations; do not assume a feature, retention period, or point-in-time recovery entitlement.
- [ ] Name the authorized recovery decision-maker and operator; keep authority **TBD** until institutionally assigned.
- [ ] Define a recovery point/backup requirement appropriate to the target, with evidence of availability and a safe restoration procedure where supported.
- [ ] Review the migration package for irreversible operations and identify forward-recovery steps; do not assume rollback is safe after dependent changes or workflow records exist.
- [ ] Define stop, notification/escalation, state assessment, recovery approval, execution, and post-recovery verification procedures.
- [ ] Keep recovery credentials restricted and separate; record evidence references, not credentials or protected data.
- [ ] For disposable test fixtures, document a narrowly scoped cleanup procedure that cannot target another environment.

No backup, restore, rollback, cleanup, or recovery operation is authorized by this checklist.

## 13. Local development and TEST isolation

- [ ] Maintain separate local and clean TEST configuration profiles; never reuse Production configuration or credentials.
- [ ] Use local-only synthetic fixtures for local development and isolated automated-test databases for repeatable destructive tests.
- [ ] Use the clean Supabase TEST project only for separately approved hosted verification requiring Supabase behavior, such as effective grants/RLS or Auth integration.
- [ ] Treat the legacy TEST project as reference-only; do not use it as an architecture target, migration destination, fixture source, or automated-test target.
- [ ] Prevent tests, scripts, CLI commands, and CI jobs from falling back to a shared or production database if environment variables are absent or malformed.
- [ ] Require positive target identity verification before every authorized hosted operation.
- [ ] Ensure test resets and cleanup are scoped to a disposable database/project and synthetic fixture namespace.
- [ ] Document which checks local tests can prove and which require the isolated database or clean TEST project. A local pass does not prove hosted RLS or deployed state.

Production is not a fallback or eventual target in this checklist. It remains completely excluded.

## 14. Verification and evidence recording

Prepare an evidence register before any authorized provisioning, deployment, or test activity. Each record should contain only the minimum information needed for reproducibility and review:

- Checklist item and authorization-gate reference.
- Environment classification and independently verified project identity (when applicable).
- Repository revision, candidate build, migration manifest/checksum, or schema manifest.
- Actor/executor and reviewer; date/time; approved procedure and tool.
- Preconditions, expected result, actual result, and **PASS / FAIL / BLOCKED / NOT EXECUTED** disposition.
- Sanitized artifact/log/report reference, linked issue/defect, and retest/recovery disposition.
- Approval reference and scope for the operation that produced the evidence.

Do not store secrets, service-role keys, database passwords, authentication tokens, real personal/document content, unrestricted database dumps, or real notification addresses in the evidence register. Do not label a proposed control “implemented,” “tested,” “verified,” or “approved” without artifact- and target-specific evidence satisfying the relevant definition in Stage 7.

## 15. Authorization checkpoints

Use the following checkpoints to keep planning separate from execution. Each checkpoint is independent; approval for one does not imply approval for the next.

| Checkpoint | Required authorization/evidence before proceeding | This checklist's status |
|---|---|---|
| **A0 — Prepare documentation** | User authorization to create this requested documentation artifact. | Authorized only for this checklist; no operational permission. |
| **A1 — Approve provisioning** | Explicit decision from an institutionally authorized owner for a separate, clean TEST project, its purpose, ownership, access, and resource allocation. | Not granted by this checklist. Authority/approval pending. |
| **A2 — Provision project** | A1 approval; the project owner personally creates the fresh project and records project name/reference/classification. | Not performed or authorized here. |
| **A3 — Verify identity and authorize Copilot write access** | Owner verifies project name, reference, and TEST classification; confirms exact target; explicitly authorizes scoped Copilot write access to that reference. Any read-only access is separately distinguished. | Not granted by this checklist. Project creation alone grants no Copilot access. Legacy TEST and Production are excluded. |
| **A4 — Approve migration deployment** | Exact SQL migrations and manifest/checksums reviewed; target is the verified A3 project; security/integrity and recovery review complete; explicit migration-specific approval recorded. | Not granted by this checklist. |
| **A5 — Deploy migrations/database changes** | A4 approval remains valid for the exact artifact and target; active project reference matches the verified reference immediately before execution. | Not performed or authorized here. No SQL or migrations executed. |
| **A6 — Authorize database verification** | Explicit scope and target authorization for read-only inspection; approved verification plan and evidence handling. | Not granted or performed here. |
| **A7 — Authorize test execution** | Approved candidate, isolated target, test cases/fixtures/cleanup, safe notification setup, and explicit test-execution authorization. | Not granted by this checklist. No tests executed. |
| **A8 — Execute tests** | A7 authorization and confirmed environment/candidate identity. | Not performed or authorized here. |
| **A9 — Production** | No Production operation is within this checklist; any future proposal requires a separate scope, authority, and authorization process. | Excluded. No Production access or activity. |

## 16. Readiness checklist and stop conditions

All boxes begin unchecked. Mark an item complete only with a dated evidence reference and authorized reviewer; do not mark any item complete based solely on this document.

### Governance and target

- [ ] Project owner, provisioning authority, and operational approvers identified and recorded.
- [ ] Separate provisioning approval obtained before any project creation.
- [ ] Project owner personally creates the fresh project; owner verifies its name, project reference, and TEST classification and confirms it is the exact intended target.
- [ ] Copilot read-only and write-capable access are treated separately; explicit scoped Copilot write-access authorization is recorded only after owner verification.
- [ ] Migration execution has separate explicit authorization after review of the exact SQL migration package and recovery plan.
- [ ] Clean TEST identity and environment classification independently confirmed after provisioning.
- [ ] Legacy TEST project explicitly excluded; Production excluded.
- [ ] Access roles, credential ownership, and review/revocation responsibilities approved.

### Application and identity configuration

- [ ] Environment variable inventory and client/server classification reviewed.
- [ ] Separate local and TEST configuration prepared; no Production fallback.
- [ ] Approved Auth origins, redirect/callback URLs, and synthetic account strategy reviewed.
- [ ] Secret storage and service-role isolation controls reviewed without exposing credentials.

### Database and migration readiness

- [ ] Approved architecture/model and data-preservation decisions recorded.
- [ ] Migration inventory, checksums, dependencies, security effects, and package review completed.
- [ ] Local artifact/checksum claims are kept distinct from target-specific deployment and post-verification evidence.
- [ ] Separate deployment approval exists before any migration execution.
- [ ] Schema, grants, RLS, functions, triggers, indexes, and read-only verification manifest reviewed.

### Data, Storage, recovery, and tests

- [ ] Synthetic-only fixtures, controlled notification sinks, and cleanup procedure approved.
- [ ] Storage/offline evidence remains deferred unless separately designed and authorized.
- [ ] Backup/recovery capabilities, authority, and procedures documented before state-changing operations.
- [ ] Local, isolated automated-test, and clean TEST responsibilities are separated.
- [ ] Test plan, environment, fixtures, and execution are separately authorized before running tests.
- [ ] Evidence register and secret-safe reporting process are prepared.

### Stop immediately if

- The target identity, ownership, or environment classification cannot be verified.
- The project owner has not personally created the fresh project, verified its name/reference/TEST classification, or confirmed the exact intended target before Copilot write access is granted.
- Copilot write-capable access is inferred from project creation, provisioning approval, or read-only access rather than explicitly authorized for the verified project reference.
- The active project reference is missing, differs from the owner-verified reference, or cannot be confirmed immediately before a write-capable operation.
- Migration execution is proposed without separate explicit authorization after review of the exact SQL migration files and recovery plan.
- Any operation could reach the legacy TEST project or Production.
- Project provisioning, migration execution, database inspection, or tests lack their separate authorization.
- A local file or checksum is being treated as proof of deployed state.
- The candidate migration package differs from the reviewed manifest or includes unapproved destructive/security/Storage changes.
- A required workflow, data-integrity, RLS, grant, function, or recovery decision is unresolved but treated as approved.
- Real or copied user data, real notification recipients, or privileged credentials are introduced into test fixtures or evidence.
- Recovery, isolation, least privilege, or evidence handling cannot be demonstrated.

After a stop, do not attempt an ad hoc repair or continue with a different environment. Record the blocker without secrets or personal data, notify the authorized owner, and resume only after the appropriate review and explicit authorization.

## Unresolved dependencies

The following remain prerequisites rather than decisions made by this checklist:

- Institutional identification of the project owner and authorities for provisioning, migration approval/execution, database inspection, test execution, and release decisions.
- Separate approval and actual provisioning of a new clean Supabase TEST project.
- Owner verification of the newly created project's name, project reference, and TEST classification, followed by separate explicit Copilot write-access authorization scoped only to that verified project.
- Migration-specific approval after review of the exact SQL package; project-level write authorization does not itself authorize migration execution.
- Target-specific evidence resolving the README/Phase 2 migration deployment discrepancy; no live migration history was inspected for this checklist.
- Approved Stage 3 schema/model reconciliation and data-preservation strategy.
- Approved Stage 4 role, membership-grantor, database grants/RLS, column access, and function/EXECUTE boundaries.
- Approved Stage 5 operation/concurrency, authorization revocation overlap, idempotency, notification recovery, and deployment/recovery contracts.
- Stage 6 test target, synthetic fixture and cleanup plan, and separate test-execution authorization.
- Authentication provider/domain configuration and controlled notification delivery plan for the clean environment.
- Storage and offline approval-evidence design remain deferred pending separate consultation; no policy redesign is assumed.
- Backup/recovery capability, applicable retention, recovery owner, and recovery procedure for the newly provisioned project.
- No Production activity is in scope or authorized.

## Source references

| Source | Relevant material |
|---|---|
| [Revised workflow plan](./REVISED_WORKFLOW_PLAN.md) | Roles and Tourism Officer authority; manual routing; responsibility types; history; security; offline handling and open decisions. |
| [Phase 2 implementation roadmap](./PHASE_2_IMPLEMENTATION_ROADMAP.md) | Delivery principles; model reconciliation; migration caution; Phase 7 verification; deferred Storage/offline and Production scope. |
| [Phase 2 gap analysis](./PHASE_2_WORKFLOW_GAP_ANALYSIS.md) | Historical TEST evidence limits, overlapping legacy models, and migration-registry/checksum limitations. |
| [Stage 3 relational model](./PHASE_3_RELATIONAL_MODEL_AND_INTEGRITY_SPECIFICATION.md) | Proposed entities, relationships, constraints, versions, history, and deferred Storage design. |
| [Stage 4 authorization and RLS design](./PHASE_4_AUTHORIZATION_AND_RLS_DESIGN.md) | Identity, least privilege, grants, RLS, column controls, function boundaries, and Storage deferral. |
| [Stage 5 database operations design](./PHASE_5_DATABASE_OPERATIONS_AND_TRANSACTION_INTEGRITY_DESIGN.md) | Atomicity, concurrency, idempotency, notifications, rollback, authorization, and implementation blockers. |
| [Stage 6 testing and validation strategy](./PHASE_6_TESTING_AND_VALIDATION_STRATEGY.md) | Proposed test levels, synthetic fixtures, environment isolation, acceptance criteria, and execution evidence. |
| [Stage 7 verification and controlled rollout plan](./PHASE_7_VERIFICATION_AND_CONTROLLED_ROLLOUT_PLAN.md) | Sequential gates, clean TEST boundary, migration evidence, security verification, rollout controls, and unresolved dependencies. |
| [Documentation index](./README.md) | Historical/canonical migration-file statements and warning that repository documentation alone does not establish deployed state. |

**Validation status:** This checklist is a proposed document only. No Supabase project was provisioned or accessed; no credentials were requested or exposed; no SQL, migration, test, database, legacy TEST, or Production operation occurred in creating it.

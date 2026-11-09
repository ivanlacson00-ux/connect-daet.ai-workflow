# CONNECT-Daet.ai — Stage 7 Verification and Controlled Rollout Plan

**Status:** Proposed planning document; no implementation, deployment, or release is authorized
**Workflow authority:** [Revised workflow plan](./REVISED_WORKFLOW_PLAN.md)
**Roadmap alignment:** [Phase 2 Implementation Roadmap — Phase 7: Verification and controlled rollout](./PHASE_2_IMPLEMENTATION_ROADMAP.md)
**Planning inputs:** [Phase 2 gap analysis](./PHASE_2_WORKFLOW_GAP_ANALYSIS.md), [Phase 2 workflow decision mapping](./PHASE_2_WORKFLOW_DECISION_MAPPING.md), [Stage 3 relational model](./PHASE_3_RELATIONAL_MODEL_AND_INTEGRITY_SPECIFICATION.md), [Stage 4 authorization and RLS design](./PHASE_4_AUTHORIZATION_AND_RLS_DESIGN.md), [Stage 5 database operations design](./PHASE_5_DATABASE_OPERATIONS_AND_TRANSACTION_INTEGRITY_DESIGN.md), and [Stage 6 testing and validation strategy](./PHASE_6_TESTING_AND_VALIDATION_STRATEGY.md)

> This plan defines future prerequisites and evidence. It does not authorize implementation, test execution, SQL, migration, project provisioning, Supabase access, or deployment. No test is considered executed or passed because it is described here or in Stage 6.

## 1. Purpose, authority, and boundaries

Stage 7 describes the gates and evidence required to progress from the current proposal documents to implementation, isolated verification, user acceptance, and any separately authorized release. It follows the implementation roadmap's actual Phase 7 scope: workflow/authorization regression coverage and review of deployed-state verification and release evidence.

The revised workflow plan remains authoritative for intended behavior. Stages 3–6 are proposed technical designs and test plans; they do not prove schema deployment, runtime enforcement, test execution, or acceptance. Historical repository and TEST observations in Phase 2 do not establish current hosted database state.

This plan does not:

- Modify application code, schema, database policies, functions, or migrations.
- Run tests, SQL, migrations, or deployment commands.
- Provision a project or request credentials.
- Connect to Supabase or access the legacy TEST project or Production.
- Authorize release, resolve institutional decisions, or declare any gate passed.

Any later implementation, test, project-provisioning, migration, or release task requires its own explicit authorization and must respect this plan's environment boundaries.

## 2. Evidence and readiness vocabulary

Use the following labels in gate records, checklists, and release evidence. A document describing a desired behavior is not evidence that the behavior is implemented or verified.

| Label | Meaning | Minimum evidence |
|---|---|---|
| **Documented** | A statement or observation is recorded in a named source document. It may be a requirement, historical observation, or design note. | Source and section, plus the evidence classification used there. |
| **Proposed** | A recommended design, control, operation, test, or rollout step that has not been approved or implemented. | Proposal and its dependencies/open decisions identified. |
| **Pending institutional approval** | A workflow or governance question is awaiting the applicable MTO/dean or other institutionally designated decision-maker. | Explicit decision question and recorded approval by the authority once known. |
| **Pending technical decision** | A schema, authorization, transaction, environment, test, or operational design question remains unresolved. | Decision owner/process if established, alternatives or impact, and recorded technical decision. |
| **Implemented** | A named application/database change exists in a specific candidate build/schema. This alone does not establish correct behavior. | Build/commit or schema/migration identity and deployment target. |
| **Tested** | A specified test was actually executed against a named build and environment. | Stage 6 test ID, date, executor, target, fixture, actual result, and sanitized evidence. |
| **Verified** | A defined property was checked against a specific candidate artifact or approved target using stated evidence. Verification is scoped; it does not imply overall acceptance. | Verification procedure, artifact/environment identity, result, reviewer, date, and evidence. |
| **Approved for release** | An authorized release decision was made after applicable gates passed. | Explicit decision record, scope, approver authority, candidate version, target, conditions, and date. |

Use the following checklist status values to summarize progress:

| Checklist status | Meaning |
|---|---|
| **NOT STARTED** | No work/evidence for the item has been recorded. |
| **DOCUMENTED** | Requirement or historical evidence exists in the cited source; implementation is not implied. |
| **PROPOSED** | A future approach is described but awaits required review/approval or execution. |
| **PENDING APPROVAL** | A designated institutional or technical decision is outstanding. |
| **READY FOR VERIFICATION** | Prerequisites and target are approved; the check can be performed when execution is separately authorized. |
| **VERIFIED** | The specific property passed its defined verification with recorded evidence. Does not mean all gates passed. |
| **BLOCKED** | A dependency, failed condition, missing authority, or unsafe environment prevents progress. State the reason. |
| **DEFERRED** | Explicitly outside the current approved scope; no implementation or acceptance claim is made. |

Do not use **Implemented**, **Tested**, **Verified**, or **Approved for release** as synonyms. A requirement can be Documented while implementation is absent; a component can be Implemented while failing a test; a passing test does not resolve an open policy decision.

## 3. Current documented readiness assessment

This is a repository-document assessment, not a fresh application or database audit.

| Area | Documented position | Current Stage 7 assessment |
|---|---|---|
| Workflow | The revised workflow plan is identified as the source of truth for role and workflow behavior. | **DOCUMENTED.** The plan has explicit unresolved institutional decisions; implementation conformity is not established by the plan. |
| Repository implementation | Phase 2 reports a legacy application workflow that conflicts with the Tourism Officer-centered workflow, including status/API mismatches and missing workflow surfaces. | **Documented historical source findings; current runtime not verified here.** Do not represent the target workflow as implemented or complete without a new scoped verification. |
| Database/schema | Stage 3 is a proposed relational model, not an approved or deployed schema. Phase 2 reports overlapping legacy TEST workflow structures and no usable custom migration registry evidence in its audit. | **PROPOSED / PENDING technical reconciliation.** No database deployment is established by this plan. |
| Authorization/RLS | Stage 4 is a proposed authorization design, including row/column controls, least privilege, grant governance, and deferred Storage policy work. | **PROPOSED / PENDING approval and implementation.** Effective runtime grants, RLS, and functions are not established here. |
| Transactions/concurrency | Stage 5 is a conceptual operation and integrity design, not SQL or implementation. | **PROPOSED / PENDING technical decisions**, including operation contracts, revocation races, idempotency, and notification recovery. |
| Testing | Stage 6 defines proposed levels, cases, environments, and gates. It explicitly says tests are not executed. | **PROPOSED / NOT EXECUTED.** No test pass or acceptance is inferred from test documentation. |
| Migration history | README asserts the canonical security migration was deployed to TEST and gives a supplied hash. Phase 2 reports that its inspected migration registry did not provide a usable custom-migration record; it also states that the matching local file hash does not establish application to the live database. | **UNRESOLVED EVIDENCE DISCREPANCY.** The README assertion is not confirmed or disproved by this plan. A local file and matching hash are distinct from target-identified application and successful post-deployment verification. |
| Release | No Stage 7 gate evidence or release authorization is included here. | **NOT APPROVED FOR RELEASE.** Production is outside the present scope. |

### 3.1 Migration evidence discrepancy

[The README](./README.md), under “Migration files,” asserts that `docs/proposed-migrations/001_security_hardening.sql` was deployed successfully to TEST and supplies an approved SHA-256. The [Phase 2 gap analysis](./PHASE_2_WORKFLOW_GAP_ANALYSIS.md), §2 “Evidence limits,” reports that the migration registry inspected in that audit did not provide a usable record of custom project migrations. It also says the local migration's matching supplied hash cannot establish that the file's contents were applied to the live database.

These are not interchangeable facts:

1. A migration file exists in the repository.
2. Its local checksum matches a supplied/recorded checksum.
3. That identified migration was applied to the intended TEST project.
4. The resulting TEST state passed the required post-deployment verification.

The first two do not prove the third or fourth. The README is an explicit deployment assertion; the Phase 2 audit describes a limitation in the evidence source it inspected. This plan has no target-identified deployment record that resolves the difference, so it neither confirms nor denies deployment. Keep the discrepancy unresolved until separately authorized, target-specific evidence is available.

To substantiate deployment, retain evidence tying the exact TEST project/environment identity to the migration identifier and checksum, execution result, date/operator, and deployment record. To substantiate successful verification, also retain the corresponding post-deployment verification procedure and results for that same target and migration state. A local file/hash match alone is insufficient. No live migration history was inspected for this audit.

## 4. Decision and accountability rules

- The workflow plan establishes the Tourism Officer as central workflow coordinator and overall decision-maker. Municipal office personnel act only for assigned responsibilities. The Tourism Head/System Administrator is not a mandatory document approval stage.
- The workflow plan assigns office-membership management to the Tourism Head/System Administrator, but Stage 4/6 leave exact grantor authority, delegation, and checked operation governance unresolved. Treat the operational authority and positive authorization cases as **PENDING APPROVAL** until confirmed; do not infer it from a role label.
- MTO/dean or other institutional approval authority must be identified by the institution. This plan does not invent stakeholder names, legal roles, signatories, or authority to waive a gate.
- Technical reviewers may provide evidence and recommendations; the authorized institutional owner makes policy decisions. The person who executes a verification is not automatically its approver.
- When a gate's responsible authority is not established, record **“TBD — authority assignment requires institutional confirmation”** and block progression if that gate requires the decision.

## 5. Sequential readiness and approval gates

The following gates are **supplemental proposed readiness controls**; they do not replace or expand the original roadmap deliverables described in §15. Their sequence is a planning recommendation, not an MTO-approved procedure or project authorization. Passing a gate does not waive later gates. Each future gate record must have a dated **PASS**, **FAIL**, or **BLOCKED** disposition supported by the evidence below. No gate is passed by this plan.

| Gate | Entry conditions and predecessor | Required documents and evidence | Objective completion checks and acceptance conditions | Responsible authority | Stop/rejection conditions |
|---|---|---|---|---|---|
| **G1 — Workflow and institutional policy review** | Planning may begin; no earlier gate. Applicable workflow requirements and first-slice decisions are identified. | Revised workflow plan; Phase 2 decision mapping; open-decision register; recorded decision matrix separating settled requirements from unresolved policy. | Every policy decision needed by the proposed implementation slice has a recorded disposition and source/authority. The matrix preserves Tourism Officer authority, manual routing, responsibility semantics, correction/reassessment, and distinct statuses. No unresolved decision is represented as settled. | Relevant institutional decision-maker must be identified; MTO/dean sign-off authority **TBD**. | Stop if the proposed slice contradicts settled workflow behavior, a required policy decision lacks a disposition, or the decision-maker's authority is unconfirmed. |
| **G2 — Architecture and relational model review** | G1 is **PASS** for the in-scope behavior; predecessor: G1. | Approved-scope workflow traceability; Stage 3 relational model; entity/relationship and invariant inventory; candidate model reconciliation and data-preservation strategy. | Every in-scope requirement maps to a model element or is explicitly recorded as out of scope/open. Every applicable integrity invariant has an identified enforcement location and a verification procedure. Same-submission integrity, version/revision binding, history, effective basis, and response cardinality are explicitly dispositioned. The response-per-responsibility-cycle model remains a technical recommendation unless the assignment wording is confirmed. | Technical/data reviewers may review evidence; model approval authority **TBD**. MTO confirmation is needed only for workflow-policy interpretation/cardinality. | Stop if competing models remain selected simultaneously, an in-scope invariant has no enforcement/verification design, historical data preservation is unaddressed, or a policy-dependent cardinality is silently assumed. |
| **G3 — Authorization and security design review** | G2 is **PASS** for the same scope and G1 policy dependencies are resolved; predecessor: G2. | Stage 4 role/resource matrix; grants/RLS/column/function design; application/database boundary map; membership/role governance decisions; proposed negative-test matrix. | Every in-scope authorization requirement maps to a specific application or database control and a corresponding positive/negative test. The evidence matrix includes identity derivation, current role and office scope, direct API access, column access, UPDATE USING/WITH CHECK, function EXECUTE/SECURITY DEFINER boundaries, Admin separation, self-grant prevention, and service-role isolation. Unresolved policy/authority is labeled and blocks dependent behavior. | Security/database/application reviewers can assess design; institutional grantor/membership and formal security-acceptance authorities **TBD**. | Stop for an Admin bypass, self-grant path, unauthorized membership/role grant, missing database boundary, unsafe privileged-function design, untested authorization requirement, or unconfirmed authority needed by the slice. |
| **G4 — Transaction and integrity design review** | G3 is **PASS** for the same scope; predecessor: G3. | Stage 5 operation contracts; Stage 3 invariant inventory; write-set/event map; concurrency/idempotency/failure matrix; notification-intent and recovery design. | Every in-scope operation maps preconditions, authorization, atomic writes, event/audit evidence, concurrency behavior, idempotency, failure semantics, and postconditions. Every applicable integrity constraint has a verification procedure. Each required race has a test case and documented expected outcomes/history; unresolved overlaps (including revocation during an in-flight action) are explicitly blocked pending a technical contract. | Database/application technical reviewers may assess design; operation/policy acceptance authority **TBD** where institutional semantics are involved. | Stop if any operation can leave partial/contradictory authoritative records, mandatory approval can be bypassed, a required race lacks expected outcomes, or an unapproved lock/isolation mechanism is assumed. |
| **G5 — Testing strategy review** | G4 is **PASS** and the in-scope workflow, model, and authorization contracts are stable enough to test; predecessor: G4. | Stage 6 traceability matrix, levels, cases, acceptance criteria, environment/fixture strategy, blocked/conditional decisions, and defect/waiver policy. | Every in-scope workflow, integrity, authorization, transaction, concurrency, idempotency, failure-recovery, and notification requirement maps to at least one test or a recorded reason it is blocked/out of scope. Each test has a testable expected result and level; application and database authorization checks are distinct. Conditional suspension and unresolved revocation-overlap cases remain correctly conditional/blocked. If execution evidence is presented, every applicable executed test has a result and sanitized evidence, and every blocking defect has a documented disposition consistent with the acceptance policy. Strategy review alone is not test execution. | Test/quality reviewers may assess coverage; test sign-off and workflow acceptance authorities **TBD**. | Stop if policy assumptions are embedded, a required control has no test/blocked disposition, tests lack an approved safe target, UI tests stand in for database authorization, or results/defects are presented without evidence. |
| **G6 — Implementation readiness** | G1–G5 are **PASS** for a bounded implementation slice; predecessor: G5 after all prior gates. | Scope/change request; approved design decisions; implementation and test plan; repository baseline; dependency/owner list; separate change authorization. | The slice, exclusions, source documents, unresolved dependencies, owners, and required validations are recorded. Each in-scope requirement has an implementation/design target and test reference. Explicit change authorization exists before implementation begins. | Technical owners document readiness; change-authorization authority **TBD**. | Stop if any prerequisite gate is failed/blocked, scope depends on an unresolved policy, deferred Storage/offline behavior is pulled in without separate approval, or change authorization is absent. This plan itself grants none. |
| **G7 — Local development verification** | G6 is **PASS** and a candidate build plus synthetic local environment are identified; predecessor: G6. | Candidate/build identity; applicable build/lint/type-check and test reports; fixture identity; sanitized secret/build scan evidence. | Every check designated applicable to the candidate has an actual recorded result; failures and skips have rationale and linked disposition. The candidate builds as required by its approved project configuration, synthetic-only fixtures are used, and no secret is exposed in browser-reachable code/artifacts or evidence. Local results are not evidence of hosted RLS/deployment. | Development/test executors perform checks; independent reviewer and gate authority **TBD**. | Stop on a required check failure, unresolved behavior encoded as policy, secret/data exposure, missing results, or fixture contamination. |
| **G8 — Isolated clean TEST environment readiness** | G6 is **PASS**; candidate test/deployment scope and environment need are justified; predecessor: G6 (G7 may proceed in parallel where independent). | Separate provisioning/access authorization; target identity/ownership record; access list; isolation/configuration plan; synthetic fixture and cleanup plan; recovery plan. | The target is independently identified as the separately authorized clean TEST project, not the legacy TEST project or Production. Access is least-privileged and approved; isolation, synthetic-only data, no-fallback configuration, and cleanup/recovery procedures are documented and reviewed. No provisioning or access occurs under this plan. | Project owner/provisioning authority must be identified; authority **TBD** until confirmed. | Stop if target identity/ownership is ambiguous, it is the legacy project or Production, credentials/access are unapproved or over-privileged, or isolation/cleanup cannot be demonstrated. |
| **G9 — Migration preparation and database/security verification** | G2–G4 and G8 are **PASS**; migration package and clean target are separately authorized; predecessor: G8 plus approved design gates. | Migration inventory/order/checksums; design review; synthetic seed review; target-bound pre/post verification procedures; execution authorization and deployment record only if deployment is separately undertaken. | Before execution, all package artifacts match the reviewed manifest and preflight/stop criteria are recorded. If deployment is separately authorized, record target identity, migration identifiers/checksums, operator/result, and post-deployment verification against the approved manifest. A local file or hash is not proof of application; application is not proof of successful post-verification. | Authorized database/change operators execute only under separate approval; review/approval authority **TBD**. | Stop on unknown target/state, unexpected object/data, unreviewed/destructive change, manifest mismatch, failed pre/post check, privilege exposure, or absent separate execution authorization. |
| **G10 — Functional, security, transaction, and regression acceptance** | G7 and any required G9 deployment verification are **PASS**; approved isolated target and candidate are identified; predecessor: G7 and G9 when database-hosted checks are in scope. | Stage 6 test IDs; test records; candidate/build/schema and environment identity; synthetic fixtures; sanitized evidence; defects/retest records. | Every applicable executed test has an actual result and evidence; unexecuted tests are marked NOT EXECUTED/BLOCKED/SKIPPED with reason. All acceptance-critical tests pass; no critical/high security or data-integrity defect remains open without an acceptance-policy-compliant disposition. Results cover application and database authorization independently. | Test executors and independent technical/security reviewers; final acceptance authority **TBD**. | Stop on mandatory safeguard bypass, unauthorized read/action, partial authoritative transaction, unresolved required concurrency case, missing test evidence, or blocking defect without an allowed documented disposition. |
| **G11 — User acceptance and MTO review** | Applicable G10 tests are **PASS**; candidate and demonstration scope are fixed; policy questions affecting the demonstration are resolved; predecessor: G10. | Scripted workflow scenarios; candidate/environment identity; observed results, feedback, defects and dispositions; recorded decisions/sign-off. | Every agreed in-scope scenario has an expected and observed outcome, including Tourism Officer initial/final authority, manual routing, correction/reassessment, office responsibilities, and distinct initial-review rejection. Policy decisions are recorded separately from usability feedback. | Actual institutional user-acceptance authority must be designated; MTO stakeholders/authority **TBD**. | Stop on workflow-policy mismatch, unresolved decision treated as accepted, critical defect, missing scenario evidence, or unconfirmed sign-off authority. Demonstration does not substitute for security testing. |
| **G12 — Controlled release authorization** | All applicable prior gates are **PASS** or have an explicit permitted disposition; exact candidate, target, scope, and recovery plan are fixed; predecessor: G11 plus G9/G10 as applicable. | Complete gate/evidence register; candidate artifact/schema identity; release/change record; access, monitoring, recovery, and communication plan; explicit separate release decision. | Every applicable gate has a disposition and evidence reference; no blocking issue remains under the acceptance policy; candidate matches the tested artifact; release scope and target are explicitly named; release decision records authorized decision-maker, conditions, and date. | Release/change authority must be established separately; authority **TBD**. | Stop for missing approval, mismatched candidate/target, unresolved blocker, absent recovery evidence, or any Production scope under this plan. Production requires a separate plan and authorization. |

### 5.1 Gate record

For each gate, retain: gate ID; scope/candidate; inputs; evidence links; disposition; blockers and defects; decision and rationale; responsible executor and reviewer; institutional decision-maker where applicable; date; and dependencies for the next gate. Do not attach credentials, actual secrets, personal data, or sensitive document contents to the record.

## 6. Environment strategy

| Environment | Intended use | Required configuration and controls | Boundary |
|---|---|---|---|
| **Local development** | Implementation, unit/component/service checks, and preliminary integration using synthetic fixtures. | Per-developer configuration; test-only credentials; no production credential or data; least-privilege local roles; secrets kept outside source, client bundles, logs, screenshots, and source maps. | A local migration/build is not proof of deployed state or hosted RLS behavior. |
| **Isolated automated-test database** | Repeatable schema, constraint, transaction, RLS, and concurrency tests. | Disposable isolated database/schema; unique synthetic fixture namespace; narrowly scoped test credentials; controlled reset/cleanup; no shared-user data. | Must be separately identified/approved; destructive fixture cleanup must never target a shared or production resource. |
| **Clean Supabase TEST project** | Future hosted migration validation, direct PostgREST/RLS testing, workflow/concurrency testing, and user acceptance after approval. | Separately provisioned clean project, access-controlled secrets, synthetic data only, explicit project-reference verification before any operation, sanitized deployment and test evidence. | Not provisioned here. Must not inherit the legacy schema as the architecture target. The existing legacy TEST project is **reference-only** and is not authorized as the new migration/test target. |
| **Production** | None under the current scope. | No credentials, connection, query, migration, deployment, or data access under this plan. | Completely out of scope. Any future production activity requires a separate explicit authorization, environment plan, and release approval. |

### 6.1 Configuration, secrets, and access

- Separate local and clean TEST configuration namespaces and credentials. Do not copy secret values between environments or commit them.
- Store future test/deployment secrets only in an explicitly approved secret manager or protected environment configuration; restrict access to named authorized operators.
- Never expose service-role credentials or clients to browser-reachable code or client-side environment variables. Verify build artifacts and source maps without printing secret values; record only safe findings and sanitized references.
- Keep operator access least-privileged and time-bounded where supported. Revoke test access after its approved need ends and record the actor/action.
- Ensure CI, local scripts, and test harnesses cannot silently fall back to a hosted/shared project. Fail closed if target identity is missing or unexpected.
- Collect evidence that identifies environment, build, schema/migration version, test ID, and time without exposing credentials, personal records, or document bodies.

## 7. Clean TEST database preparation and migration readiness

This is a future gated checklist. Reviewing a migration package is **preparation**; applying it is **execution**, which requires separate approval. This Stage 7 task does neither.

1. **Confirm target identity:** Record the proposed project/environment identifier through an approved provisioning process. Do not infer identity from a display name or local URL alone.
2. **Confirm ownership and access:** Establish the authorized project owner/operator and least-privilege access list. Authority and credentials must be approved separately; this plan does not request them.
3. **Verify clean TEST designation:** Independently confirm the target is the approved newly provisioned clean TEST project and not the legacy project or Production. Stop if uncertain.
4. **Review migration package:** Inventory files, ordering, checksums, dependencies, expected objects, reversibility/forward-recovery implications, and required approvals. Do not execute SQL during review.
5. **Review database design:** Compare approved schema against constraints, indexes, functions, triggers, grants, RLS, column access, and policy interactions. Review function owners, EXECUTE privileges, SECURITY DEFINER search paths, actor derivation, and service-role boundaries.
6. **Review seed and fixture content:** Use synthetic accounts, offices, submissions, versions, and attachments only. Verify fixtures do not contain real personal data, secrets, copied legacy records, or real notification recipients.
7. **Establish pre-deployment verification:** Define target confirmation, baseline object inventory, expected empty/clean state, access-role check, backup/recovery point if applicable, and a stop rule for unexpected objects/data. Evidence must not expose records.
8. **Establish post-deployment verification:** Define read-only verification of expected schema, constraints, indexes, functions, triggers, grants, RLS policies, and migration/deployment identity. Compare actual results only against an approved manifest; local migration files alone are not proof.
9. **Establish recovery and failure handling:** Identify transaction/deployment boundaries, partial-application detection, operator escalation, and safe recovery options before execution. Prefer tested forward repair or restore from an approved recovery point; do not prescribe destructive rollback that could erase valid history or break dependencies.
10. **Record evidence:** For any separately authorized execution, capture approval, target identity, operator, package/checksum, start/end, tool/result, pre/post checks, deviations, failures, recovery actions, and final disposition. Keep all evidence sanitized.

Do not migrate the legacy database schema as the new architecture. Existing repository migrations and historical database reports must be reconciled rather than assumed to be a complete or current deployment ledger.

## 8. Security verification and release controls

Security verification must cover database and application boundaries independently. A successful frontend build or hidden UI control is not proof of RLS, grants, column restrictions, function permissions, or direct API security.

| Security area | Required future verification | Failure condition / release stop |
|---|---|---|
| Authentication and actor identity | Authenticated identity resolves only to the caller's profile; forged actor/profile IDs cannot substitute; anonymous access is denied where data/actions are private. | Client-supplied actor identity changes attribution or grants access. |
| Role grants | Ordinary, administrative, and privileged workflow grants follow approved governance; self-grant denied; grantor and affected user attribution retained; revoked/inactive grant denies new actions. | Unapproved grant/revocation, self-elevation, Admin-only workflow authority, or stale grant authorizes an action. |
| Office membership | Exact office membership is checked at action time; cross-office access and self-assignment denied; membership administration follows confirmed authority. | Membership alone grants unrelated office access, or an unauthorized actor creates/modifies/revokes membership. |
| PostgreSQL grants, columns, and RLS | Verify effective grants, row policies, column access/safe projections, UPDATE USING and WITH CHECK, policy composition, and direct authenticated PostgREST reads/writes. | Restricted column/row is exposed, direct write bypasses controls, or broad policy/grant defeats least privilege. |
| Functions and SECURITY DEFINER | Inventory function EXECUTE by role, owner, safe fixed search path, schema-qualified references, `auth.uid()`/actor validation, and RLS/bypass behavior. | Unneeded public/anon/authenticated EXECUTE, caller-controlled identity, unsafe definer owner/search path, or unbounded RLS bypass. |
| Service-role isolation | Inspect source/import graph, client config, emitted browser bundles, and source maps for service-role usage/credentials using a non-disclosing process. | Service-role client reaches browser code, secret enters client variables/artifacts, or evidence prints a secret. |
| Audit attribution/history | Verify actual actor, affected resource, relevant grant/membership context, timestamp, and required domain/status evidence are recorded atomically and protected from unauthorized rewrite/delete. | Forged/missing actor, history gap, mutable authoritative event, or partial audit evidence. |
| Session and revocation | Verify new actions recheck current role/membership; test revoke-first and operation-first outcomes. Overlapping behavior remains blocked until Stage 5 contract is approved. | Revoked authority succeeds after the defined authorization point, or overlap behavior is assumed without an approved protocol. |
| Environment and least privilege | Verify target identity, separate credentials, operator roles, secret storage, no production fallback, and revocation of temporary access. | Ambiguous target, shared secrets, over-privileged credentials, or any Production access under this plan. |

For each future check, preserve the tested identity/role, environment, build/schema identity, request path, expected/actual result, sanitized evidence, and defect. A failure in a critical authorization or data-integrity invariant blocks progression; UI success does not waive it.

## 9. Functional and workflow acceptance

Use Stage 6's traceability matrix and proposed test IDs as the test baseline only after its prerequisites and relevant institutional decisions are approved. Evaluate behavior against the revised workflow plan, not against legacy UI states or a historical TEST schema.

Acceptance demonstrations and automated tests must cover, as applicable:

- Submission and initial review by the Tourism Officer; no route bypass.
- Tourism Officer initial-review final overall rejection: the Officer records the rejection reason, the submitter is notified, and the rejected submission remains represented in history without proceeding to office routing or final approval review. Use existing Stage 6 traceability/test coverage **TR-02** and workflow case **WF-05**; do not create a duplicate test case.
- Tourism Officer's manual office selection and control; no routing automatically selected by document type/category.
- Simultaneous and one-at-a-time routing, including adding an office while simultaneous reviews continue.
- Independent office responsibilities and exact version/revision binding.
- Mandatory approval/clearance approval requirement and non-bypass safeguards.
- Required Evaluation and Recommendation responses; negative outcomes are not automatic vetoes.
- Office responses and change requests returned to the Tourism Officer; offices cannot forward to another office or formally return to the submitter.
- Tourism Officer formal correction request, corrected resubmission as a new version, and selective reassessment.
- Explicit target-specific applicability; no silent copying/reactivation of old responses.
- Overall approval, rejection, and correctable return by a Tourism Officer with valid active workflow authority; Admin is not an approval stage.
- Append-only decision/status/audit history with actual actors and office-level progress distinct from overall lifecycle.
- Required submitter notification intents, provider failure recovery, and controlled/no-real-recipient test delivery.

Acceptance is blocked if a required behavior is absent, only demonstrated in the UI but not persisted/enforced at the database boundary, or made to pass by silently resolving an open policy decision. Status/closure mapping, assignment-response granularity, membership authority, and any other unresolved policy must be approved before affected expected results are treated as final.

## 10. Test execution and evidence management

### 10.1 Prerequisites

Before any future test execution:

1. The applicable G1–G8 design/environment gates are approved.
2. The target environment is separately authorized, positively identified, isolated, and not the legacy TEST project or Production.
3. The candidate build and schema/migration package are identified.
4. Stage 6 test cases and policy-dependent expected results are reviewed; blocked/conditional cases are marked.
5. Test accounts, synthetic fixtures, cleanup procedure, and controlled notification provider/mocks are approved.
6. Test operators have least-privilege credentials and secret-safe evidence handling.

### 10.2 Execution records

For every executed case, retain the Stage 6 fields: test ID and requirement reference; level; build/schema version; exact environment identifier; synthetic fixture IDs and preconditions; steps/schedule; expected and actual results; PASS/FAIL/BLOCKED/SKIPPED with rationale; date/executor; sanitized evidence; linked defect; retest status; and acceptance decision.

Evidence may include screenshots, test-run output, sanitized logs, migration/checksum manifests, and read-only verification results. Evidence must not include passwords, tokens, service-role keys, real personal/document content, unrestricted database dumps, or secrets in logs/source maps. For secret scanning, record safe filenames or artifact references and a finding category only, never the secret value.

### 10.3 Defects, failures, and regression

- A failed test remains **FAIL** until a fix is implemented and the same test is rerun against an identified candidate. Preserve the failing result.
- Critical/high security or data-integrity defects block the affected gate. Do not waive mandatory approval, authorization, or authoritative-history failures because the frontend passes.
- A blocked test due to unresolved policy, technical design, environment, or missing authority is **BLOCKED**, not PASS or silently SKIPPED.
- Retest the original case and relevant neighbor/regression cases after a correction. Record both original and retest outcomes.
- Severity and disposition follow Stage 6 §16.1; waiver authority is not established and must not be invented.
- The final test summary must report total applicable cases by PASS/FAIL/BLOCKED/SKIPPED, coverage gaps, defect severity/status, environment/build, and unresolved decisions. Do not report proposed tests as executed or passed.

Traceability chain: **source requirement → Stage 6 traceability row/test ID → execution record → evidence/defect → retest → gate decision**. Keep changes to requirements and expected results attributable to an authorized decision.

## 11. User acceptance and institutional review

After functional/security test gates are ready, conduct user acceptance with actual MTO stakeholders and representative authorized office users designated by the institution. This plan does not name stakeholders or define their legal authority.

Proposed demonstration scenarios:

1. Tourism Officer initial review and Path A direct handling.
2. Manual Path B assignment, simultaneous and one-at-a-time routing, and adding an office during concurrent review.
3. Office representative access to only assigned responsibilities and return of findings to the Tourism Officer.
4. Mandatory approval, evaluation, and recommendation outcomes, including non-veto and no-bypass cases.
5. Tourism Officer response review, formal correction request, new version, and selective reassessment.
6. Overall approve/reject/return decisions, notification intent, and append-only history.
7. Role/membership boundaries, Admin system administration without automatic document authority, and denial scenarios.

Record scenario, build/environment, participant role (not unnecessary personal detail), expected and observed behavior, feedback, defects, decision on each issue, and sign-off evidence. Obtain explicit institutional confirmation for policy choices, including office authority/path meaning, response granularity/batching, membership grantor process, rejection/closure rules, notification policy, and any deferred feature. A demonstration does not replace independent RLS/PostgREST, transaction, or security evidence.

## 12. Controlled rollout and recovery sequence

The stages below are future, separately authorized steps. They do not authorize deployment.

| Stage | Entry criteria | Exit criteria and evidence | Stop conditions and recovery | Progression authority |
|---|---|---|---|---|
| **R1 — Development completion** | G1–G6 approved for the implementation slice; code/change scope authorized. | Candidate build, reviewed changes, traceability updates, known-defect list, no unapproved workflow changes. | Stop on scope drift, unresolved decision encoded as policy, security boundary regression, or untracked migration/schema change. Preserve source and evidence; fix before proceeding. | Development/change authority **TBD**. |
| **R2 — Local verification** | R1 candidate and synthetic local environment available. | Reproducible build and applicable unit/component/service checks; sanitized reports; no real secrets/data. | Stop on failed tests/build, credential exposure, or fixture contamination. Fix and rerun affected regression set. | Technical/test reviewers; sign-off authority **TBD**. |
| **R3 — Clean TEST readiness and deployment** | G8 target approved; G9 preparation reviewed; explicit deployment/migration authorization issued separately. | Record target identity, migration artifact/checksum/order, operator, pre/post verification, schema/security results, and recovery disposition. | Stop on wrong target, unexpected pre-existing state, migration error, postflight mismatch, or privilege exposure. Follow pre-approved recovery; never improvise destructive rollback. | Authorized database/change operator; project/release authority **TBD**. |
| **R4 — TEST acceptance** | R3 succeeds; candidate identity fixed; Stage 6 cases and fixtures approved. | Functional, authorization, concurrency, idempotency, notification, regression, and user acceptance evidence; defects dispositioned; gate decisions recorded. | Stop on critical/high failure, unexplained data/history discrepancy, unresolved policy blocker, or incomplete test evidence. Preserve diagnostics and restore/rebuild only by approved isolated procedure. | MTO/user acceptance and technical/security authorities as designated; exact authority **TBD**. |
| **R5 — Authorized release preparation** | R4 accepted; all required institutional/technical approvals documented; explicit non-production release scope approved. | Release checklist, versioned artifacts, access list, backup/recovery readiness, monitoring/incident process, migration and compatibility review, communications/support plan. | Stop if artifact differs from accepted candidate, backup/recovery cannot be confirmed, access is overbroad, or approval is absent. | Release/change authority **TBD**. |
| **R6 — Future Production deployment** | **Outside current scope.** Requires a separate explicit Production plan, credentials/access authorization, risk review, and release approval. | No Stage 7 evidence here can satisfy this gate. A future plan must define production-specific verification, monitoring, recovery, authorization, and approvals. | No access or action under this plan. Any future production action without separate authorization is prohibited by this scope. | Must be established by a separate authorized process. |

### 12.1 Operational readiness and recovery principles

- Before any separately approved deployment, establish a recovery point/backup appropriate to the target, verify that authorized operators can access it, and record its identity without exposing protected data.
- Review migration dependencies and data-retention consequences. Do not assume destructive rollback is safe after later migrations or workflow records exist.
- Predefine failure handling: stop point, owner/operator notification, evidence capture, state assessment, and decision authority for retry, restore, or forward repair.
- Prefer a tested forward-recovery plan when rollback could delete valid history or violate dependencies. Any restore or rollback must be explicitly approved for that environment and validated against data-integrity requirements.
- Revoke temporary credentials and test access after the approved window; preserve audit records of access changes.
- Define monitoring, alert routing, incident recording, and support ownership before any authorized release. Ownership and escalation roles remain to be assigned; do not assume institutional roles.

## 13. Deferred items and unresolved decisions

### 13.1 Institutional decisions

- Which offices have authority over each requirement; meanings and precedence of Department Only, External Only, External + Department, and Multiple Offices.
- How canonical assignment-level “one official decision” wording maps to independent responsibility outcomes and Stage 3's recommended one-response-per-cycle design; whether optional batching requires a single representative.
- Exact role-grant and office-membership grantor authority, delegation, and administration process. The workflow plan assigns membership management to the Tourism Head/System Administrator, but the actionable authorization process remains unresolved.
- Initial/overall rejection criteria, valid nonmandatory resolutions, cancellation conditions, reopening, office-level statuses, and `COMPLETED` closure semantics.
- Admin access to confidential document content, internal review notes/messages, and historical visibility/retention after membership revocation or completion.
- Notification events, recipients, channels, timing, delivery/retry/retention policy beyond the required submitter notification intents.
- Points eligibility, recipient, calculation, reversals; reporting measures, access, and aggregation.
- User-acceptance and release/waiver authority and named signatories.

### 13.2 Technical dependencies

- Final Stage 3 schema, exact cardinalities, same-submission constraints, active-cycle/effective-basis semantics, and migration/data-preservation plan.
- Stage 4 effective grants, RLS, column-safe projections, function owners/EXECUTE, SECURITY DEFINER controls, and direct API behavior.
- Stage 5 operation contracts, atomic write sets, idempotency lifecycle, notification worker recovery, and authorization revocation versus in-flight operation protocol. Overlapping revocation behavior remains blocked until that contract is approved.
- Account suspension behavior remains conditional on an approved account lifecycle; do not invent account fields or authorization policy.
- Dedicated clean TEST provisioning/access authorization, test harness, synthetic data/cleanup, performance thresholds, and sanitized evidence process.
- Reconciliation of the docs index's migration deployment statement with Phase 2's historical migration-evidence limitations using only separately authorized, target-specific evidence.

### 13.3 Deferred boundaries

- Offline approval evidence remains deferred pending dean consultation.
- Storage policy redesign, signed URLs, access/retention rules, and object cleanup remain deferred. Stage 6's Storage cases are conceptual and are not implementation or approval.
- Object-upload/database-transaction failure and orphan cleanup remain conceptual until separately designed and approved.
- Production remains completely outside this plan.

## 14. Readiness checklist and release evidence matrix

Initial statuses below reflect documentation evidence only; **none are VERIFIED or APPROVED FOR RELEASE** by this plan.

| Requirement/readiness item | Source | Evidence required | Current status | Dependency / responsible authority | Acceptance condition |
|---|---|---|---|---|---|
| Tourism Officer-centered workflow and manual routing | Revised Workflow Plan §§1–3, 9 | Institutional decision matrix and accepted workflow tests | DOCUMENTED | MTO/institutional authority TBD | Every submission starts with Officer; no automatic office selection; role boundaries preserved. |
| Initial-review final overall rejection | Revised Workflow Plan §2 Stage 2, §5; Stage 6 TR-02 and WF-05 | Candidate-specific execution records and sanitized evidence for TR-02/WF-05 | PROPOSED / NOT EXECUTED | Applicable Officer authority; test and acceptance authorities TBD | Tourism Officer records a final rejection reason and submitter notification intent; decision/history persist; no office routing or final approval review follows. |
| Open office/path/status/rejection policies | Workflow Plan §8; Phase 2 Decision Mapping — “Consequential open decisions from the workflow plan” | Recorded decisions for affected policies | PENDING APPROVAL | MTO/dean authority TBD | Decisions explicitly approved; no implementation assumption. |
| Canonical relational model and integrity constraints | Stage 3 §§12–18, 21–22 | Approved model, relationship/invariant map, migration strategy | PROPOSED | Architecture/data reviewers; MTO for policy-dependent cardinality | Same-submission integrity, history, response/applicability and readiness semantics reviewed. |
| Authorization/RLS and role/membership governance | Stage 4 §§2–8, 11–12 | Approved matrices, grants/columns/RLS/function review, negative test plan | PROPOSED | Security/database reviewers; membership/grant authority TBD | Least privilege and actual actor/current scope checks are specified; blockers resolved. |
| Transaction/concurrency/idempotency design | Stage 5 §§2–12, 14–15 | Approved operation contracts, race/rollback/retry outcomes | PROPOSED | Database/application reviewers; policy authority for outcomes TBD | Required mutations atomic; unresolved overlap marked blocked; safe retry defined. |
| Stage 6 test baseline | Stage 6 §§2–19 | Test-plan review and traceability disposition | PROPOSED | QA/test reviewers; acceptance authority TBD | Tests remain proposed until evidence-backed execution; test target approved. |
| Implementation status of intended workflow | Phase 2 Gap Analysis §§6–10; Decision Mapping §§1–14 | Scoped source/runtime verification of candidate build | DOCUMENTED (historical gap evidence) | Implementation owners / reviewers TBD | No claim of completion without identified candidate and evidence against workflow. |
| Local development verification | Stage 6 §§3–5, 15–17 | Build/test report, candidate identity, synthetic fixtures | NOT STARTED | Technical/test reviewers TBD | Applicable checks executed locally; no real credentials/data. |
| Clean TEST project readiness | Stage 6 §4; this plan §6 | Project identity, ownership/access approval, isolation and recovery evidence | BLOCKED | Project provisioning authority TBD | Separately authorized clean project; legacy project excluded. |
| Migration package readiness | Roadmap Phase 7 Task 7.2; Stage 3 §22; Stage 5 §15 | Reviewed inventory/order/hash, pre/post checks, recovery plan | NOT STARTED | Authorized DB/change authority TBD | Package matches approved model; no target state inferred from local files. |
| Database and security verification | Stage 4 §§5–10; Stage 6 §§8, 15 | Direct RLS/PostgREST, grants, columns, functions, secret-scan evidence | NOT STARTED | Security/database reviewers TBD | Positive/negative checks pass on approved target; sanitized evidence retained. |
| Functional/concurrency acceptance | Workflow Plan §§2–6; Stage 5 §§6, 13; Stage 6 §§6–14 | Stage 6 case results, actual state/evidence, defect closure | NOT STARTED | Test and workflow acceptance authority TBD | All applicable gates pass; no critical/high security/integrity defect. |
| User/MTO acceptance | Workflow Plan §§8–9; Stage 6 §§11, 15 | Demonstration record, feedback, decisions, sign-off | NOT STARTED | Actual designated MTO stakeholders; authority TBD | Correct behavior demonstrated and policy questions signed off by designated authority. |
| Release authorization | Roadmap Phase 7; this plan §12 | Candidate-specific approval, operational/recovery checklist | BLOCKED | Release/change authority TBD | All prior gates accepted and separate explicit release approval recorded. |
| Storage/offline evidence | Workflow Plan §7; Stage 4 §9; Stage 6 §13 | Separate approved design and authorization | DEFERRED | Dean/institutional consultation | No change until separately approved and planned. |
| Production access/deployment | Workflow Plan/Stage 6 scope boundaries; this plan §6 | A separate Production plan and explicit authorization | DEFERRED | Separate authorized process | No Stage 7 action; separate approval, controls, and evidence required. |

## 15. Alignment with the implementation roadmap

The roadmap calls its actual Phase 7 **“Verification and controlled rollout.”** Its original deliverables are:

- **Task 7.1 — Add workflow and authorization regression coverage:** focused automated cases for routing modes, response gates, mandatory safeguards, reassessment history, RPC/transitions, RLS/grants, notifications, and UI mapping; targeted tests and authorization approval before shared TEST use.
- **Task 7.2 — Review deployed-state verification and release evidence:** reviewed read-only verification and migration/CI evidence for the exact TEST state; project identity verification before queries; no migration/deployment authorization implied.

The relationship between those deliverables and this document's added material is:

| Category | Scope | Status and authority |
|---|---|---|
| **Original roadmap Phase 7 deliverables** | Task 7.1 regression coverage and Task 7.2 deployed-state/release-evidence review. | Roadmap scope; execution remains subject to its stated prerequisites and separate authorization. |
| **Supplemental Stage 7 readiness and rollout controls** | Sequential G1–G12 readiness gates, environment separation, migration-preparation checklist, evidence vocabulary, and R1–R6 controlled-rollout/recovery sequence. | Additional planning controls proposed here to structure future readiness and release evidence. They are not represented as roadmap text, implemented controls, or MTO-approved procedure. |
| **Institutional procedures and decisions** | Named signatories, gate-approval authority, release/waiver authority, project ownership, and applicable workflow-policy decisions. | Must be confirmed by the institution where not already established. This document assigns none by assumption; unresolved authority remains TBD and blocks dependent approval. |

Stage 7 preserves the roadmap deliverables while adding supplemental proposed controls from Stages 3–6. The roadmap's references to testing on a disposable TEST branch or verifying TEST must be read together with Stage 6's later explicit boundary: the legacy project is reference-only and future architecture testing requires a separately authorized isolated target. This plan does not direct tests or migrations to the legacy project.

The README/Phase 2 migration-evidence discrepancy in §3.1 is not resolved by the roadmap. It requires separately authorized, target-specific evidence and must not be used to assert the current deployed state.

## 16. Final readiness and next actions

### Current readiness

- Workflow: **Documented**, with institutional decisions still open.
- Stages 3, 4, 5: **Proposed**, not approved/frozen/implemented by evidence in this plan.
- Stage 6: **Proposed / NOT EXECUTED**.
- Clean TEST project: **Not provisioned here; future authorization required**.
- Migration deployment: **Not established by this plan**.
- Release/Production: **Not authorized; Production excluded**.

### Recommended next actions

1. Have designated institutional stakeholders resolve the policy questions that block the first implementation slice, without reopening settled workflow requirements.
2. Review and approve the Stage 3 relational and Stage 4 security contracts, including the unresolved membership/grant authority and response-cardinality interpretation.
3. Complete Stage 5 operation/concurrency decisions, especially authorization revocation overlap and notification recovery.
4. Review the Stage 6 test baseline and mark policy-dependent cases blocked/conditional until decisions are recorded.
5. Separately authorize the appropriate team to provision and verify a clean TEST project; do not use the legacy project as the architecture target.
6. Only after the gates pass, seek separate implementation, migration, test-execution, and release authorizations.

No action in this list has been performed by creating this document.

## Appendix A. Source section index

| Source | Primary sections used |
|---|---|
| Revised Workflow Plan | §§1–3 roles and workflow; §§5–8 history, features, security, offline handling, open decisions; §9 interpretation |
| Phase 2 Implementation Roadmap | Delivery principles; Phases 0–7, especially Phase 7 Tasks 7.1–7.2; Explicitly deferred; Recommended immediate next task |
| Phase 2 Workflow Gap Analysis | §§1–2 evidence boundaries; §§3–10 implementation/security findings; §§12–14 open decisions, priority, worktree scope |
| Phase 2 Workflow Decision Mapping | Evidence labels/scope; Requirement Mapping §§1–14; existing structures, implementation blockers, and recommended next step |
| Stage 3 Relational Model | §§1–3 scope/principles; §§4–12 model; §§13–18 relationships/constraints/transactions; §§19–22 optional features, open decisions, readiness |
| Stage 4 Authorization and RLS Design | §§1–8 identity, roles, resources, RLS, functions, application boundary; §§9–12 deferred items, tests, risks, readiness |
| Stage 5 Database Operations Design | §§1–3 design status/invariants; §4 operation contracts; §§5–12 atomicity, concurrency, idempotency, audit, reassessment, notifications, failures, authorization; §§13–15 tests/open decisions/readiness |
| Stage 6 Testing and Validation Strategy | §§1–5 scope, levels, environment, fixtures; §§6–14 test cases; §§15–19 acceptance, evidence, execution, decisions, readiness |

**Validation status:** Proposed planning document only. No application code, tests, SQL, migrations, database, Supabase project, legacy TEST project, or Production resource was changed, accessed, or tested in creating it.

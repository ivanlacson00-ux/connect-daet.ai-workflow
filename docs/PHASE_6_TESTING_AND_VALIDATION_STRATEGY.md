# CONNECT-Daet.ai — Stage 6 Testing and Validation Strategy

**Status:** Proposed testing strategy; documentation only; no tests executed
**Workflow authority:** [Revised workflow plan](./REVISED_WORKFLOW_PLAN.md)
**Architecture inputs:** [Phase 2 gap analysis](./PHASE_2_WORKFLOW_GAP_ANALYSIS.md), [Phase 2 implementation roadmap](./PHASE_2_IMPLEMENTATION_ROADMAP.md), [Phase 2 workflow decision mapping](./PHASE_2_WORKFLOW_DECISION_MAPPING.md), [Stage 3 relational model](./PHASE_3_RELATIONAL_MODEL_AND_INTEGRITY_SPECIFICATION.md), [Stage 4 authorization and RLS design](./PHASE_4_AUTHORIZATION_AND_RLS_DESIGN.md), and [Stage 5 database operations design](./PHASE_5_DATABASE_OPERATIONS_AND_TRANSACTION_INTEGRITY_DESIGN.md)

> Every test in this document is **PROPOSED / NOT EXECUTED**. The model, authorization, and transaction designs remain proposals; this strategy does not assert that any feature, schema, policy, or test infrastructure is implemented.

## 1. Purpose and validation principles

Stage 6 defines how a future implementation should be validated against the agreed workflow and the proposed Stages 3–5 architecture. It provides test levels, traceability, synthetic fixtures, acceptance conditions, environment controls, and a future execution order.

This document does not implement application or test code, define a frozen schema, approve policy decisions, execute tests, run SQL or migrations, connect to Supabase, modify a database, create a project, deploy, or authorize Production access.

### 1.1 Test design, execution, and acceptance

- **Test design** specifies preconditions, action, expected result, test layer, and evidence. This document contains design only.
- **Test execution** runs an approved test against a named build and isolated environment, records actual results and evidence, and creates defects for failures. No execution is claimed here.
- **Acceptance** is a human-approved determination that all applicable release gates pass, required decisions are resolved, and no blocking defects remain. A green test run alone does not grant acceptance or implementation/deployment authorization.

### 1.2 Evidence and layered proof

- Trace each test to a workflow rule, relational invariant, authorization rule, or transactional operation. Keep canonical workflow requirements distinct from proposed technical recommendations and unresolved MTO/dean decisions.
- A passing frontend or end-to-end UI test cannot prove that direct PostgREST/database requests are denied, that row/column privileges are correct, or that concurrent database writes preserve invariants.
- A passing database test cannot prove that a submitter, Tourism Officer, and office representative can complete the intended end-to-end user journey or understand its state transitions.
- A passing test against a local schema does not establish that the isolated automated-test database, a future clean TEST project, staging, or Production has the same schema or permissions.
- Repository migrations and Phase 2’s historical TEST observations are not evidence that a migration is deployed or that the present database is a valid test target.
- Validate both permitted and denied behavior. For denials, verify no protected data is returned and no partial mutation, history gap, notification intent, or misleading success result remains.

## 2. Testing scope and requirement traceability

The matrix is a minimum traceability baseline, not a claim that tests exist or have passed. `WF`, `DB`, `AUTH`, `TX`, `HIST`, `NOTIF`, `STOR`, and `OPS` are proposed test-family labels used again below.

| ID | Workflow requirement | Relational integrity requirement | Authorization requirement | Transaction/concurrency requirement | Proposed test category | Expected result and acceptance condition | Source document / section |
|---|---|---|---|---|---|---|---|
| TR-01 | Every submission starts with Tourism Officer initial review; no automatic office routing | Submission owner, first version, and initial status/history are related consistently | Submitter may submit only as self; Officer sees only authorized queue scope | Submission/version/history commit together; safe retry | WF, DB, AUTH, TX, E2E | Initial queue contains the submitted item; no office route is created automatically; no partial submit state | Workflow Plan §§1–2, 9; Stage 3 §§5, 14, 18; Stage 4 §§4–5; Stage 5 §§4.1, 5 |
| TR-02 | Initial correction/clarification, continuation, and final overall rejection are distinct | Decision/reason/status history and target version agree | Only active Tourism Officer authority may perform Officer action | Initial final rejection commits with required submitter notification intent and prevents routing | WF, AUTH, TX, NOTIF | Each outcome has distinct permitted next state; rejection records reason and does not proceed; notice intent is present | Workflow Plan §2 Stage 2, §5; Roadmap Task 2.2; Stage 5 Operations 4, 19 |
| TR-03 | Path A permits Officer final review without office work | Decision links to exact submission/version | Tourism Officer only; Admin is not an implicit approver | Approval readiness is rechecked at commit | WF, AUTH, TX, E2E | Path A reaches decision only through the Tourism Officer; no artificial office assignment is required | Workflow Plan §2 Path A, §2 Stage 3; Roadmap Task 5.1; Stage 5 Operations 18–20 |
| TR-04 | Tourism Officer manually chooses office, responsibility, and route mode | Assignment and all child responsibilities share submission/round | Only authorized Tourism Officer can create/change/cancel assignments | Assignment and requested responsibilities/history are atomic and idempotent | WF, DB, AUTH, TX | No partial assignment; each responsibility retains its own type and scope; retry does not duplicate | Workflow Plan §§2–3, 6; Stage 3 §§6, 14–15; Stage 4 §§4–5; Stage 5 Operations 5–10 |
| TR-05 | Simultaneous and one-at-a-time routing remain distinct; no office-to-office forwarding | Routing history and assignments preserve the selected mode | Offices cannot create another assignment | Routing changes serialize against submission closure and stale rounds | WF, AUTH, TX, E2E | Simultaneous offices proceed independently; one-at-a-time progression requires an explicit Officer action | Workflow Plan §§2–3, 9; Stage 3 §§6, 18; Stage 5 Operations 5–8 |
| TR-06 | Office work is limited to the assigned responsibilities; multiple responsibilities can share an office assignment | Assignment contains multiple independent responsibilities; cycle/response is responsibility-specific | Active exact-office membership and external role required | One official response per cycle is the Stage 3 recommendation; no assignment-wide response uniqueness | WF, DB, AUTH, TX | Different responsibilities have independent outcomes and actor attribution; cross-office/cross-cycle writes are denied | Workflow Plan §§1, 3, 6; Stage 3 §§6–7, 13–15; Stage 4 §§4–5; Stage 5 Operations 6, 12 |
| TR-07 | Negative Evaluation/Recommendation is not an automatic veto; mandatory approval cannot be bypassed | Effective basis is computed per active responsibility and exact target | Only authorized workflow operation can decide or resolve | Approval gate rechecks all active responsibilities after synchronization | WF, DB, AUTH, TX | Evaluation/Recommendation response is required but its negative outcome alone does not veto; mandatory needs approved response; generic resolution cannot replace required response | Workflow Plan §§2–3; Stage 3 §§2, 17; Stage 5 §§3.3, 5.1, Operation 18 |
| TR-08 | Tourism Officer reviews office responses and makes overall decisions | Office response remains distinct from submission decision; actor references are retained | Office member cannot issue overall decision or sender return | Response and approval/final decision races serialize on submission state | WF, DB, AUTH, TX | Office response is attributed to representative and exact cycle; only Officer decides overall outcome | Workflow Plan §§1–3, 6; Stage 3 §§7, 9, 18; Stage 4 §§4, 10; Stage 5 §§4.3–4.4, 6 |
| TR-09 | Correctable RETURNED state differs from final REJECTED outcome | New version appends; old versions/decisions remain linked to prior targets | Submitter may correct own submission; office cannot formally return to submitter | Version metadata/state/history atomic; uploaded object is a separate side effect | WF, DB, AUTH, TX, STOR-DEFERRED | Corrected resubmission returns to Officer review; old evidence remains immutable; no partial current-version pointer | Workflow Plan §§2–3, 5; Stage 3 §§5, 14, 18; Stage 5 Operations 3, 15–16 |
| TR-10 | Only Tourism Officer initiates selective reassessment and preserves unaffected valid work | New cycle binds exact new version/revision; applicability is target-specific; old evidence retained | Current Officer grant required; prior membership/grant is historical only | Selected set is one atomic transaction; retry is idempotent | WF, DB, AUTH, TX, HIST | Only selected responsibilities receive new cycles; failure rolls back selected set; unaffected responsibilities and prior history remain unchanged | Workflow Plan §§1, 3, 5–6; Stage 3 §§7–8, 17–18; Stage 4 §§4–6; Stage 5 §§4.3, 9 |
| TR-11 | APPROVED/REJECTED outcomes differ from COMPLETED closure and RETURNED correction | Decision and status history/projection agree | Tourism Officer is final decision maker; Admin has no implicit workflow authority | Conflicting decisions are serialized; one terminal decision under provisional no-reopen default | WF, DB, AUTH, TX | Decision/status mapping matches approved lifecycle; no Admin-only decision path; closure behavior is tested only after semantics are approved | Workflow Plan §§1–2, 4; Stage 3 §§9, 15, 20; Stage 5 Operations 18–21 |
| TR-12 | Preserve actor/action/version history and separate office progress from overall state | Append-only domain, status, audit, response, and version relationships | Audit reads are restricted; history itself grants no access | Required evidence commits with the operation or the operation rolls back | DB, AUTH, TX, HIST | No history rewrite/deletion by ordinary clients; actor, grant/membership, and version context are correct | Workflow Plan §5; Stage 3 §§3, 7–9, 11, 18; Stage 4 §§4–6; Stage 5 §8 |
| TR-13 | Submitter notices required for initial final rejection and overall final decisions | Notification intent refers to committed event and intended recipient | Recipient/content does not expose unauthorized document information | Intent is atomic; provider delivery occurs post-commit and is retryable | NOTIF, TX | Required intent/submitter recipient is present; delivery failure cannot undo decision; no exactly-once claim without provider support | Workflow Plan §§2, 5; Stage 3 §10; Stage 5 §§2.2, 5.2, 10 |
| TR-14 | Admin system management does not equal document-content or approval authority | Grants and memberships retain grantor/affected-user history | Admin content bypass and self-grant denied; privileged role process fails closed until approved | Grant changes are checked, attributed, and atomic | AUTH, DB | Unauthorized grants/revocations and content reads fail; no grant authority is inferred from Admin alone | Workflow Plan §§1, 6, 8; Stage 4 §§2, 4, 10; Stage 5 §12 |
| TR-15 | Messages/private staff notes obey visibility boundaries when implemented | Messages/attachments share thread and submission scope | No unauthorized office, submitter, or Admin note access | Message writes preserve authorship/history | AUTH, DB, integration | Role and parent scope control reads/writes; private notes are not returned outside approved staff scope | Workflow Plan §5; Stage 3 §§10, 13–14; Stage 4 §§4, 10 |
| TR-16 | Points/rewards only after final approval, under separately approved rules | Ledger entries are consistent and idempotent if points are enabled | Ledger/report access is role-scoped | Award does not duplicate on approval retry | WF, DB, AUTH, TX | No award on office approval alone; amount/recipient/reversal cases remain blocked until policy approval | Workflow Plan §5; Roadmap Task 6.3; Stage 3 §§12, 19–20 |
| TR-17 | Storage and offline evidence remain deferred | Attachment metadata remains parent/version consistent | Actual file access inherits separately approved parent scope | External object upload is not assumed to be in DB transaction | STOR-DEFERRED | No Storage policy or offline evidence behavior is treated as approved or tested in current scope | Workflow Plan §7; Stage 3 §§5, 19–20; Stage 4 §9; Stage 5 §2.2 |
| TR-18 | Historical TEST evidence must not become canonical target state | Proposed model is tested only after reconciliation/approval | Test credentials and service roles are isolated | Tests run only on disposable/approved isolated database targets | OPS, DB | No test writes to legacy TEST or Production; local migrations are not treated as deployment proof | Phase 2 Gap Analysis §§1–2, 9–12; Roadmap “Delivery principles” and “Phase 7 — Verification and controlled rollout”; Decision Mapping “Scope and evidence boundary”; Stage 5 §§1, 15 |
| TR-19 | Office responses remain distinct from Tourism Officer rejection/return decisions | Response, decision, status, actor, and domain-event evidence remain consistent in either commit order | Office respondent and Officer decision maker are independently authorized | Exercise both response-first and decision-first order; no approval-readiness precondition is applied to rejection/return | WF, AUTH, TX, CONC, HIST | Eligible response-first outcome retains both histories; decision-first rejects a now-ineligible response without partial writes; committed decision remains intact | Workflow Plan §2 Stage 2 and §3; Stage 5 §6 and §6.1 |
| TR-20 | Office memberships and current account/role state govern new office and Officer actions | Membership/grant changes retain actual actor and historical context | Only explicitly authorized membership administrator may create, modify, or revoke; no self-assignment; suspension/revocation denies new actions | Recheck current authority at operation time; concurrent revocation behavior follows approved protocol | AUTH, DB, TX, CONC | Unauthorized membership changes fail; authorized changes are attributed; conditional account-suspension cases remain blocked until lifecycle is defined | Workflow Plan §§1, 6, 8; Stage 4 §§2.1–2.2, 4–5, 10; Stage 5 §6 |
| TR-21 | Service-role credentials remain server-only | No privileged credential or service-role client enters browser-delivered artifacts | Browser-reachable code cannot access privileged service-role authority | Build/source-map inspection is non-disclosing; no credential value is printed in evidence | AUTH, APP-SEC, OPS | Fail on any service-role credential in client environment/config, browser-reachable import, emitted bundle, or source map; report only sanitized file/reference | Stage 4 §§5.1, 8, 10; Roadmap Task 1.2 and Phase 7 Task 7.1 |

## 3. Testing levels

All levels below are proposed. A level can begin only after its entry criteria are met and ends only when its exit evidence is recorded. A pass at one level does not substitute for another.

| Level | Validates | Cannot prove | Dependencies / entry criteria | Exit criteria |
|---|---|---|---|---|
| 1. Unit | Pure domain decisions, state mapping, readiness calculation, validation rules, idempotency fingerprint canonicalization | Database privileges, RLS, real transaction behavior, complete UX | Approved domain rules and stable module boundaries; choose runner only after repository tooling is reviewed | Relevant rule cases pass, including negative/boundary cases; no unresolved workflow rule encoded as a default |
| 2. Component/UI | Forms, state labels, disabled/loading/error states, role-specific presentation, accessible workflow steps | Server authorization, DB constraints, PostgREST access, concurrency | Approved role/status/action matrix and UI contract; synthetic fixtures | Screens render correct outcomes; hidden UI controls are not claimed as security enforcement |
| 3. Application service/server-action | Trusted actor derivation, input validation, authorization orchestration, membership-administration authorization/attribution, safe errors, operation invocation, no client identity trust | Database-side enforcement if direct DB access bypasses the app; institutional membership grantor authority | Approved service/action contracts and testable auth/session boundary; membership-management authority confirmed before positive authorization cases | Positive/negative service cases pass; forged IDs cannot change actor; unauthorized membership operations fail; errors are not success-shaped |
| 4. Database constraint/function | Keys, same-submission composite integrity, uniqueness, append-only enforcement, checked operation atomicity | Full UI journey, external provider delivery, deployed database state | Stage 3 schema and Stage 5 operations approved; disposable database/schema and synthetic data | Required integrity and rollback cases pass against the actual candidate schema; no SQL is run against shared/production targets |
| 5. RLS/database permission | Grants, row scope, column restrictions, function EXECUTE, role/membership/account-state checks where approved, RLS bypass boundaries, independent UPDATE USING/WITH CHECK outcomes | Complete user journey, frontend behavior, provider delivery; account suspension before its lifecycle is finalized | Stage 4 decisions completed; actor-role sessions/claims; effective permission inventory; account-state mechanism approved before conditional suspension case | Direct authenticated/PostgREST tests pass positive and negative cases, including sensitive columns, unauthorized writes, separate existing-row/result-row assertions, and current authority checks |
| 6. Integration | Application-to-database contracts, version/attachment metadata, notifications, audit/status history, worker integration | All concurrency schedules, production equivalence, real provider guarantees | Stable service and schema contracts; isolated integration environment; controlled provider mock | Related records agree across service boundaries; retries/failures leave expected state |
| 7. Concurrency/idempotency | Competing operations, shared synchronization, lock order, post-lock rechecks, authorization revocation races, duplicate requests and lost responses | Unmodeled production load or provider-specific behavior; revocation overlap until its synchronization protocol is approved | Stage 5 synchronization strategy selected; deterministic concurrency harness; disposable DB; revocation ordering contract approved | Every defined race preserves the invariant; one winner or defined conflict; losing transactions leave no partial writes; unresolved revocation overlap is reported blocked |
| 8. End-to-end workflow | Role journeys from submit through Path A/Path B, correction, reassessment, and final decision | Database security unless paired with direct database tests; production deployment state | Integrated build, synthetic personas, approved status/action mapping, isolated environment | Critical workflows complete as specified; UI lifecycle and persisted records agree |
| 9. Security/negative authorization | Cross-user/office denial, escalation attempts, unauthorized membership changes, restricted reads/writes, direct API bypass, attachment denial, and service-role exclusion from browser code/build artifacts | Security of untested deployment configurations or future code changes | Stage 4 approved controls; no real user data; representative DB and application sessions; secret-safe artifact inspection | All required negative cases deny without leakage or side effects; browser-reachable bundles/imports contain no service-role access; evidence never prints secret values; no critical/high authorization defect remains |
| 10. Notification delivery/recovery | Required intent, claims, attempts, provider outcomes, worker restart/lease recovery, safe retry | Actual end-user receipt unless provider provides evidence; exactly-once without provider support | Approved recipient/event mapping, test provider or mocks, reviewed model support for claim/recovery | Workflow intent is durable; failed/interrupted deliveries recover; unknown outcomes are represented without false certainty |
| 11. Regression | Previously accepted workflow, integrity, authorization, and defect fixes continue to pass | Requirements not represented in the suite | Version-controlled test inventory, reproducible fixtures, prior acceptance baseline | Full applicable regression set passes on each candidate change; stale tests are updated only with approved requirement changes |
| 12. Performance/reliability | Queue/readiness query behavior, transaction duration, contention, resource use, recovery under measured workloads | Arbitrary performance acceptance absent measured/stakeholder-approved limits | Stable representative workload, target environment approval, baseline and TBD threshold approval | Report measured results against explicitly approved thresholds; do not invent threshold values |

## 4. Test environment strategy

Environments progress only with separate authorization. Every test environment must be explicitly identified before use. This document authorizes no connection or data change.

| Environment | Intended role | Permitted future testing | Boundary / gate |
|---|---|---|---|
| A. Developer/local | Fast unit, component, application-service, and local integration development | Synthetic fixtures and disposable local state | Do not treat local migrations as evidence of deployed state; no copied citizen, employee, or municipal data |
| B. Isolated automated-test database | Repeatable database constraints, functions, RLS, transactions, and concurrency suites | Synthetic-only data; resettable/disposable schema or database | Must be separately provisioned/approved and isolated from shared data; never point automated destructive fixture cleanup at a shared project |
| C. Dedicated clean Supabase TEST project | Future hosted integration testing after project creation and explicit authorization | Approved migration/deployment test and role/session integration tests | Create only after approval. The existing legacy TEST project `bhbccqutreegqoohqzqb` is historical/reference-only, is not the target schema, and must not be used as the new architecture deployment/test target |
| D. Staging/pre-release, if later approved | Release-candidate verification under a separately approved plan | Production-like configuration verification using synthetic/non-sensitive fixtures | Optional and not currently authorized; requires explicit environment, data, and access approval |
| E. Production | Outside current scope | None under this strategy | Never connect, inspect, test, seed, migrate, or modify Production under Stage 6 |

Future hosted integration tests require an isolated, approved target—not the existing legacy TEST project. Verify target identity and environment configuration through an approved process before running any test with write capability. Do not rely on a local URL or project label alone as environment proof.

### 4.1 Data handling and environment hygiene

- Use fabricated names, emails, files, submissions, office assignments, and content. Do not copy real citizen, employee, or municipal records into tests.
- Use synthetic document bodies and attachment metadata; use mock files with no real personal data or secrets.
- Keep secrets out of fixtures, snapshots, logs, URLs, and test evidence. Use test-only credentials and providers when later authorized.
- Fixture setup and cleanup must be scoped to owned synthetic records. Cleanup must not delete shared data, retained historical evidence, or objects referenced by another test.
- Avoid sending real email/SMS. Use a controlled mock or explicitly approved test provider and recipient domain.

## 5. Test data and personas

All identities and organizational relationships below are synthetic. They describe authorization cases, not actual municipal roles, people, or office policies. Which office may decide a requirement remains an institutional decision.

### 5.1 Personas

| Persona | Synthetic capability | Purpose |
|---|---|---|
| Submitter A | Active `user`; owns only Submission A | Normal submission/correction and denied cross-user access |
| Submitter B | Active `user`; owns only Submission B | Cross-user isolation and unrelated identifiers |
| Tourism Officer A | Active `approver`; assigned workflow test authority | Initial review, routing, response review, reassessment, overall decisions |
| Tourism Officer B | Separate active `approver`, if shared Officer queues are supported | Concurrent Officer actions and actor attribution |
| Tourism Head/Admin | Active `admin`, no implicit `approver` grant | Account/office administration without automatic workflow/content authority |
| Office A representative | Active `external_approver` and current Office A membership | Assigned Office A responsibilities only |
| Office B representative | Active `external_approver` and current Office B membership | Cross-office denial |
| Multi-office representative | Active external grant and explicit memberships in Offices A and B | Verify each membership grants only its own office scope |
| Revoked former Office A member | Historical Office A membership, ended/revoked | Deny new actions while preserving historical actor records |
| Unprivileged user | Authenticated but no workflow-grant capability beyond approved basic account | Deny privileged actions |
| Anonymous client | No authenticated identity | Verify anonymous read, write, and function denial |

### 5.2 Synthetic organizational/workflow fixtures

- One synthetic office with multiple authorized representatives.
- Two independent synthetic offices with no implied authority relationship.
- One representative with separate memberships in both offices.
- One submission with no additional office routing (Path A).
- One submission with simultaneous routing and at least two active offices.
- One submission with one-at-a-time routing requiring explicit Officer progression.
- One office assignment with independent Mandatory Approval / Clearance, Evaluation / Verification, and Recommendation responsibilities.
- Multiple versions of a submission, each with synthetic attachments and exact ownership metadata.
- Reassessment with at least one selected responsibility and one unaffected responsibility whose prior response is considered for explicit applicability.
- Separate submissions for cross-submission composite-integrity tests. Never use identical or ambiguous test identifiers that could conceal wrong-parent linkage.

### 5.3 Fixture lifecycle

Create fixtures using the approved test-only setup mechanism after environment authorization. Record fixture IDs, ownership, and parent relationships in test output without exposing credentials. Before each test, assert fixture preconditions and isolation. After execution, remove only disposable synthetic fixtures using the approved cleanup path; retain failure artifacts necessary for diagnosis. Database constraints/history tests that depend on append-only behavior should use fresh isolated fixtures rather than destructive cleanup of a shared record.

## 6. Workflow functional tests

Cases are **PROPOSED / NOT EXECUTED**. “Approved status mapping” means the future stored states must be selected by the responsible human review; these tests do not invent enum values.

| ID | Scenario and initial state | Expected behavior | Acceptance condition |
|---|---|---|---|
| WF-01 | Submitter A creates a draft | Draft belongs to the authenticated actor; no route or reviewer decision is implied | Another user cannot claim ownership; no submitted state before successful submit |
| WF-02 | Submitter A submits valid content/version | Submission enters Tourism Officer initial-review queue | Owner, first version, required metadata, and status/history are consistent; no office auto-route |
| WF-03 | Initial-review Officer continues without office involvement | Path A moves to Officer final review | No office assignment is fabricated; only authorized Officer can decide |
| WF-04 | Officer requests correction/clarification during initial review | Correctable request is distinct from final rejection | Request and reason/history are preserved; submitter can respond only as owner |
| WF-05 | Officer records initial-review final rejection | Final overall rejection with reason and submitter notification intent | No municipal routing/final-review path remains; required intent commits with decision |
| WF-06 | Officer manually creates an office assignment and multiple responsibilities | Assignment is a container; responsibilities are independent | Every child has correct same-submission parent and type; all create/history writes succeed or roll back together |
| WF-07 | Officer selects simultaneous routing for multiple offices | Office work proceeds independently | No sequential dependency is imposed; each office sees only its scope |
| WF-08 | Officer adds an office while simultaneous reviews are active | New work is appended without cancelling or retargeting existing work | Existing cycles/responses are unchanged; newly active responsibility is included in final gate |
| WF-09 | Officer selects one-at-a-time routing | Only explicit Officer action after review advances route | No automatic forwarding; stale/unauthorized action is rejected |
| WF-10 | Office representative suggests another office | Suggestion is recorded only as feedback if supported | No assignment is created absent an Officer operation |
| WF-11 | Office A member reads/responds to its assigned responsibility | Response is scoped to exact assignment/responsibility/cycle | Active exact-office membership and external role are checked; actual actor attribution is retained |
| WF-12 | Office representative attempts an overall decision or formal sender return | Action is denied | No overall decision, status mutation, or partial event is written |
| WF-13 | Tourism Officer reviews an office response | Review is a separate attributed Officer action | Official office response is not overwritten; response and review remain distinguishable |
| WF-14 | Mandatory response is denied or unresolved | Overall approval is blocked | No downgrade, cancellation, or generic resolution bypass; reason/history preserved |
| WF-15 | Evaluation response is negative | Response gate is satisfied; negative result alone does not veto overall decision | Officer may decide based on full case; no automatic rejection |
| WF-16 | Recommendation is negative or suggests another office | Recommendation remains advisory | No automatic veto or office assignment |
| WF-17 | Office representative requests clarification/change | Request returns to Tourism Officer coordination | Office cannot directly return to submitter or route to another office |
| WF-18 | Tourism Officer formally returns for correction; owner resubmits | RETURNED is correctable and distinct from REJECTED; new version is appended | Prior versions/responses remain; submission returns to Officer review |
| WF-19 | Officer initiates selective reassessment | Only selected responsibilities get new cycles | Unaffected work remains; prior response is reused only through exact-target explicit applicability |
| WF-20 | Officer attempts final approval before all active responsibilities have valid bases | Approval is blocked | Gate checks each active responsibility; mandatory and response requirements are enforced |
| WF-21 | Officer approves after all gates pass | Overall decision and lifecycle history commit | Decision is Officer-attributed; required submitter notification intent exists; office response remains separate |
| WF-22 | Officer makes an overall rejection | Rejection is not an office decision or correctable return | Required reason/history and submitter notice intent persist; criteria are not invented by tests |
| WF-23 | Submission reaches approved/rejected and later closure behavior | Decision outcome remains distinct from COMPLETED closure | Test only after lifecycle/closure semantics are approved; no conflated UI status |
| WF-24 | Submitter, Officer, and office user view tracking/history | Each sees only the approved projection for their scope | Office progress differs from overall submission lifecycle; history is attributed and version-aware |

## 7. Database integrity tests

The future suite must verify both declarative constraints and transaction-controlled invariants. Individually valid foreign keys do not prove that records belong to the same submission.

| ID | Proposed test | Expected result |
|---|---|---|
| DB-01 | Duplicate primary key or missing required parent | Rejected without partial state |
| DB-02 | Assignment references a routing round from another submission | Rejected by composite relationship or equivalent transaction check |
| DB-03 | Responsibility references an assignment from another submission | Rejected even though both IDs exist |
| DB-04 | Review cycle references version from another submission | Rejected |
| DB-05 | Review cycle references responsibility revision for another submission/responsibility | Rejected |
| DB-06 | Response combines a valid cycle with mismatching submission/version/revision IDs | Rejected; cycle remains bound to its exact target |
| DB-07 | Attachment/version/response link combines valid records from different submissions | Rejected; referenced history is not relinked |
| DB-08 | Decision evidence references an unrelated submission response | Rejected |
| DB-09 | Applicability uses response and target version/revision from different submission or logical responsibility | Rejected |
| DB-10 | Two concurrent response inserts target the same cycle | At most one official response; no assignment-wide response uniqueness |
| DB-11 | Responses target two different cycles within the same assignment | Both can exist independently when otherwise valid |
| DB-12 | Attempt to update/delete official response, decision, status history, or audit history through ordinary client privileges | Denied; corrections use approved append operations |
| DB-13 | Decision inserted without required status history/projection or actor attribution | Entire operation rolls back |
| DB-14 | Current-version projection points to a version of another submission | Rejected |
| DB-15 | Superseded cycle and invalidated applicability are included in readiness | Excluded from effective basis; no duplicate count |
| DB-16 | Effective basis conflict between response, applicability, and permitted resolution | Transaction rejects or safely resolves only under approved operation; never two effective bases |
| DB-17 | Idempotency result reference targets a different operation/actor scope | Rejected or safely concealed; result reference is not authorization |
| DB-18 | Invalid resolution targets mandatory responsibility or substitutes for required Evaluation/Recommendation response | Rejected; mandatory requirement remains unsatisfied |
| DB-19 | Responsibility type downgrade/cancellation attempts to bypass denied mandatory approval | Rejected; original assignment/history remains |
| DB-20 | Referenced office, user, version, response, or assignment is deleted | Referential restriction preserves retained workflow history |

## 8. Authorization and RLS security tests

Stage 4 is a proposed authorization specification, not deployed evidence. Separate database-level checks from application checks; run neither until a candidate schema, role mapping, and isolated environment are approved.

### 8.1 Database-level authorization tests

| ID | Actor/action | Expected database result |
|---|---|---|
| AUTH-DB-01 | Anonymous selects private submissions, versions, assignments, messages, notifications, or audit | Denied/no protected rows |
| AUTH-DB-02 | Submitter A reads own submission and approved sender projection | Allowed only for permitted rows/columns |
| AUTH-DB-03 | Submitter A reads Submitter B’s submission using a guessed identifier | No data or existence disclosure |
| AUTH-DB-04 | Office A member reads or writes Office B assignment/responsibility/response | Denied without side effects |
| AUTH-DB-05 | Multi-office representative acts in Office A and Office B | Each action succeeds only for its separately active membership and assigned work |
| AUTH-DB-06 | Office membership is revoked, then the former member acts on a previously assigned cycle | New office action denied; historical actor and membership reference remain; historical read behavior follows the approved access policy |
| AUTH-DB-07 | Revoked or suspended `approver` grant invokes an Officer operation | Denied at action time; grant suspension is distinct from account suspension |
| AUTH-DB-08 | Admin reads document content or invokes overall approval without separate authority | Denied; system administration alone is not document/workflow authority |
| AUTH-DB-09 | User attempts self-grant or self-elevation | Denied; no new grant/audit success record |
| AUTH-DB-10 | Admin or other actor attempts unauthorized `approver` grant, role modification, or revocation | Denied until grant authority is explicitly approved; actual grantor/affected user cannot be forged |
| AUTH-DB-11 | Direct authenticated/PostgREST read requests restricted ownership, grant, membership, internal review, official actor, or administrative fields | Restricted columns are unavailable through direct reads; only approved safe projection is returned |
| AUTH-DB-12 | User updates ownership, office assignment, responsibility scope, role grant, membership, or official actor attribution | Existing-row and resulting-row checks deny unauthorized changes; history is immutable |
| AUTH-DB-13 | Office member submits response for unrelated cycle or wrong office | Denied without cross-office disclosure |
| AUTH-DB-14 | Unassigned office representative downloads attachment by guessed identifier/path | Denied; attachment identifier alone conveys no access |
| AUTH-DB-15 | Authenticated caller invokes an operation without required function EXECUTE privilege | Denied |
| AUTH-DB-16 | Review any narrowly scoped SECURITY DEFINER function candidate | Owner, safe search path/schema qualification, actor validation, minimal grants, RLS interaction, and bypass risk meet approved review; otherwise release blocked |
| AUTH-DB-17 | Direct PostgREST writes bypass hidden/disabled frontend controls | Same authorization/integrity checks apply; unauthorized write rejected |
| AUTH-DB-18 | RLS helper recursively queries protected rows or broad policy overlaps | No recursion, fail-open behavior, or permissive policy widening; effective grants/policies are evaluated together |
| AUTH-DB-19 | Actor without approved membership-management authority attempts to create an office membership | Denied; no self-assignment or membership/history side effect |
| AUTH-DB-20 | Actor without approved membership-management authority attempts to revoke another person's membership | Denied; existing membership and its history remain unchanged |
| AUTH-DB-21 | Actor attempts to modify membership office/profile/scope or other protected attribution, where such modification is supported | Denied unless the exact operation is explicitly authorized; changes must not rewrite history or bypass revocation controls |
| AUTH-DB-22 | Actor with explicitly approved membership-management authority creates/revokes membership through the checked operation | Allowed only within approved scope; this positive case is blocked until the authorized grantor process is confirmed |
| AUTH-DB-23 | User attempts to assign themselves to an office, including by direct database/PostgREST write | Denied; no active membership is created |
| AUTH-DB-24 | Authorized membership creation, modification, or revocation is performed | Stored actor attribution identifies the actual authenticated administrator/authorized grantor and affected profile; caller-supplied actor IDs are ignored or rejected |
| AUTH-DB-25 | Test A — existing-row authorization (`UPDATE USING`): actor targets an existing row outside their current ownership, office, assignment, or responsibility scope | Rejected because the existing row is unauthorized, even if a proposed resulting row might otherwise look in-scope |
| AUTH-DB-26 | Test B — resulting-row authorization (`UPDATE WITH CHECK`): an otherwise authorized actor changes ownership, office assignment, responsibility scope, role grant, membership, or official actor attribution beyond authority | Rejected because the resulting row is unauthorized; passing Test A does not imply this check passes, and passing this check does not authorize an out-of-scope existing row |
| AUTH-DB-27 | CONDITIONAL — suspended account attempts an otherwise authorized workflow action | Denied if the finally approved account lifecycle defines suspension as non-authorizing; keep blocked until that mechanism is finalized, without presuming an account-status field |

### 8.2 Application-level authorization tests

| ID | Request path | Expected result |
|---|---|---|
| AUTH-APP-01 | Server action/API request supplies a forged actor/profile identifier | Actor remains derived from authenticated session or request is rejected |
| AUTH-APP-02 | Submitter attempts to change owner or version parent in request body | Denied; no mutation |
| AUTH-APP-03 | Office A representative requests Office B resource through UI/API | Safe denial without existence/content leakage |
| AUTH-APP-04 | Admin attempts workflow action without active explicit `approver` grant | Denied independent of UI visibility |
| AUTH-APP-05 | User attempts self-grant, privileged `approver` assignment, or unauthorized role revocation | Denied and audited safely; no grant mutation |
| AUTH-APP-06 | Office representative attempts assignment creation, responsibility change, reassessment, overall decision, or sender return | Denied |
| AUTH-APP-07 | Request targets restricted document fields or internal notes | Only authorized safe projection returned; private notes excluded |
| AUTH-APP-08 | Former office member reuses a stale session after office-membership revocation | Current membership is rechecked; new office action is denied while prior history remains |
| AUTH-APP-09 | Client directly invokes PostgREST/API instead of using visible UI | Database boundary still denies unauthorized operation |
| AUTH-APP-10 | Error path for inaccessible attachment/submission | Does not reveal resource existence, path, or contents |
| AUTH-APP-11 | Proposed application/build security check inspects browser-reachable imports, client-side environment variables, emitted bundles, and source maps for service-role access | Fail if a service-role client is imported into browser-reachable code, privileged credentials enter client-side environment variables/configuration, or any secret/service-role credential appears in browser artifacts; evidence reports only sanitized filenames/references and never prints values |
| AUTH-APP-12 | User or unauthorized actor attempts office-membership creation through a server action/API | Denied; actor is session-derived; no self-assignment or membership change |
| AUTH-APP-13 | User or unauthorized actor attempts office-membership revocation through a server action/API | Denied; no membership/history mutation |
| AUTH-APP-14 | User or unauthorized actor attempts protected office-membership modification through a server action/API, where supported | Denied unless exact authority and operation are approved; no forged actor/scope |
| AUTH-APP-15 | Actor with approved membership-management authority performs an allowed membership change | Succeeds only for approved scope and operation; remains blocked until grantor authority is confirmed |
| AUTH-APP-16 | Authenticated user attempts to add themselves to an office through the application | Denied even if the request supplies their own profile or office identifiers |
| AUTH-APP-17 | Authorized membership administration records the actor and affected user | Audit/result identifies the actual session actor and affected profile; supplied actor identifiers cannot substitute |
| AUTH-APP-18 | CONDITIONAL — suspended account attempts an otherwise authorized action through the application | Denied if approved account lifecycle defines suspension as non-authorizing; blocked pending that lifecycle, with no assumed status field |

Acceptance requires both database and application negative tests. A frontend-only denial is insufficient.

## 9. Concurrency and transaction tests

Use the Stage 5 provisional shared submission-level synchronization for operations affecting readiness, route openness, cycle eligibility, and final decisions. Recheck all mutable conditions after acquiring synchronization. Recommended lock order is: submission aggregate → routing round/assignment → responsibility/revision → review cycle → response/event/related records. Skip unneeded levels without reversing order. Do not assume `SERIALIZABLE` isolation is required for every operation.

Each test below must record the initial fixture state, concurrent schedule/barrier, winner, loser result, final database state, required history, and evidence. The expected order is the serialization order, not necessarily which client started first.

| ID | Initial state and concurrent actions | Expected winner/loser behavior | Persisted state and acceptance |
|---|---|---|---|
| CONC-01 | Open cycle; Office A representatives submit different responses simultaneously | One response commits; the other gets safe duplicate/conflict or same result only for same idempotency key/payload | Exactly one cycle response and required evidence; losing request leaves no partial writes |
| CONC-02 | Active required cycle has no response; office response races Officer final approval | If approval synchronizes first, it fails readiness; response may then commit if eligible and Officer may retry. If response commits first, approval rechecks all requirements | No approval without required response; both outcomes maintain valid history |
| CONC-03 | Simultaneous reviews active; Tourism Officer adds another office while unrelated offices respond | Both may commit in serialized order while submission route remains open | New assignment is appended; prior cycles/responses unchanged; if terminal closure wins, new assignment rejected |
| CONC-04 | Final approval attempt races adding a new responsibility to an existing assignment | If responsibility commits first, approval sees it and fails until satisfied; if approval commits first, addition is rejected as terminal/ineligible | No responsibility omitted from a committed approval; no partial child records |
| CONC-05 | Two Tourism Officers update same routing round from same expected revision | One update commits; stale conflicting operation fails/reloads; same-key identical retry returns prior result | No lost update or conflicting route; history contains only committed actions |
| CONC-06 | Responsibility cancellation races final review | Approval first sees responsibility active and fails unless satisfied; cancellation first only changes gate if valid, permitted, and authorized; terminal decision may reject later cancellation | Mandatory safeguard preserved; failed/cancelled action has no partial state |
| CONC-07 | Two reassessment requests target overlapping selected responsibility sets | Same key/payload replays; conflicting request waits/rechecks and fails or becomes valid only under approved cycle semantics | No duplicate active cycles/effective basis; all prior records retained |
| CONC-08 | New version creation races an old-cycle response | Both synchronize/recheck exact target; old cycle is never retargeted; response commits only if still eligible under approved lifecycle | Version and response remain bound to exact historical version; stale response rejected if cycle became ineligible |
| CONC-09 | Overall approval, rejection, or return actions race each other | One compatible decision commits; losing conflicting decision is stale/terminal conflict | At most one incompatible terminal decision under approved lifecycle; status and decision history agree |
| CONC-10 | Duplicate initial submission requests arrive concurrently | One logical submission result commits; duplicate returns same result for same actor/scope/key/payload | No duplicate submission/version/status/event/notification intent |
| CONC-11 | Responsibility is added to an assignment while its other responsibilities are in simultaneous review | Addition serializes through submission state; existing cycles can continue after recheck | New work is independent; no existing responsibility response is retargeted or duplicated |
| CONC-12 | Final approval races addition of a new office or responsibility | Shared submission synchronization determines order and approval re-enumerates all active work | Either approval fails after new work commits, or addition fails after terminal approval; never both incompatible outcomes |
| CONC-13 | Deterministic paired race: (a) office membership revocation while an office response is pending, and (b) `approver` grant revocation while an overall decision is pending; both operations check current authority at operation time | If revocation serializes first, the pending action is denied with no partial response/decision or event. If the authorized action commits first, its response/decision and actor/grant/membership/event history remain valid; later revocation prevents future actions. If both overlap without a defined serialization point, report BLOCKED pending the Stage 5 revocation-conflict protocol; do not assume a lock or synchronization mechanism | Record both ordering schedules, authorization result, transaction outcome, and history. No already committed record is erased; overlap behavior must be specified before acceptance |
| CONC-14 | Eligible office response races overall rejection or correction/return; this is separate from the final-approval readiness race in CONC-02 | **Response first:** commit the official response only if its cycle is still eligible; the later rejection/return follows applicable workflow rules and both records retain consistent actor attribution and event history. **Rejection/return first:** if it makes the cycle ineligible, reject the later response; leave no partial response/event/attachment and preserve the committed decision. Do not apply approval readiness as a rejection/return precondition | Exercise both serialization orders and verify response, overall decision, status, actor attribution, event history, and rollback. Any rejected response leaves no partial writes; no approval gate is applied |

The test harness must detect deadlocks/timeouts and retain enough sanitized diagnostics to determine lock order. Retry only the complete logical operation with the same idempotency semantics and fresh authorization/state checks.

## 10. Idempotency and retry tests

Test the idempotency claim and business mutation as one atomic unit. Do not prescribe an expiry duration; expiry/cleanup and behavior after expiry must be explicitly approved before implementation.

| ID | Scenario | Expected result |
|---|---|---|
| IDEM-01 | Same authenticated actor/scope/key and same canonical payload | Previously committed safe result returned; no repeated business/event/notification mutation |
| IDEM-02 | Same key with different semantic payload | Rejected; original result remains unchanged |
| IDEM-03 | Concurrent requests use the same key/payload | Only one mutation commits; other waits or returns safe in-progress/existing result |
| IDEM-04 | Concurrent same-key requests use different payloads | One request may claim; other is rejected on fingerprint mismatch; never two mutations |
| IDEM-05 | Failure before transaction commit | Claim and business writes roll back; no completed result or success-shaped idempotency record remains |
| IDEM-06 | Business mutation commits but client loses response | Retry returns committed result after reauthorization; no duplicate mutation |
| IDEM-07 | Different actors/scopes use the same opaque key | Keys do not collide across authenticated actor/operation/resource scope |
| IDEM-08 | Key has expired or cleanup has occurred | Behavior follows a documented approved retention policy; no assumed time-to-live or duplicate window |
| IDEM-09 | Retries target submission/version creation | No duplicate submission, version, attachment link, or current-version transition |
| IDEM-10 | Retries target office assignment/responsibility creation | No duplicate assignment/responsibility/revision/event |
| IDEM-11 | Two representatives submit response with same or different keys | Same request safely replays; conflicting key cannot bypass one-response-per-cycle integrity |
| IDEM-12 | Approval/rejection/return decision is retried | One decision/status/required notification intent; incompatible second decision is rejected |
| IDEM-13 | Applicability confirmation is retried concurrently | One target-specific effective basis; duplicate does not create second confirmation/effective outcome |
| IDEM-14 | Reassessment request is repeated | Entire selected-set result replays; no subset/duplicate cycles |
| IDEM-15 | Idempotency result points to a resource caller can no longer read | Operation does not authorize disclosure; re-check current access and return only safe minimal result |
| IDEM-16 | Provider delivery is retried after workflow commit | Delivery retry does not rerun or duplicate the original workflow mutation or notification intent |

## 11. Reassessment and historical integrity tests

| ID | Proposed scenario | Expected result |
|---|---|---|
| HIST-01 | Non-Officer initiates reassessment | Denied; no cycle or applicability changes |
| HIST-02 | Officer selects a subset of active responsibilities | Only selected responsibilities receive new cycles; unaffected responsibilities remain untouched |
| HIST-03 | One selected responsibility fails validation after another candidate has been examined | Whole selected-set reassessment transaction rolls back; no partial cycles or applicability changes |
| HIST-04 | A selected cycle is created for the new version | Cycle references the exact submission version and responsibility revision |
| HIST-05 | Officer confirms an unaffected prior response applies | Confirmation references original response and exact target version/revision; does not copy/retarget response |
| HIST-06 | Applicability is invalidated and an old response is reconsidered | Invalidation remains append-only; old response is not silently reactivated |
| HIST-07 | Old cycles, responses, actors, timestamps, and versions exist | Reassessment preserves all historical records and attribution |
| HIST-08 | Superseded cycle and valid applicability both exist for target | Readiness counts one effective basis only; superseded/invalidated evidence is excluded |
| HIST-09 | Prior office member has been revoked | Historical response still records former actor/membership/grant; former member gains no new access by that history |
| HIST-10 | New official response is entered after reassessment | It is a distinct cycle response, never the applicability confirmation itself |

## 12. Notification and recovery tests

No test in this section sends a real message. Use a controlled fake provider or an explicitly approved non-production test provider only after implementation and environment authorization.

| ID | Proposed scenario | Expected result |
|---|---|---|
| NOTIF-01 | Initial-review final rejection commits | Required submitter notification intent and recipient are committed atomically with decision/status/history |
| NOTIF-02 | Overall approve/reject decision commits | Required submitter intent and recipient are committed atomically; channel/provider policy does not make intent optional |
| NOTIF-03 | Required notification-intent write fails | Underlying workflow transaction rolls back; no decision without required intent |
| NOTIF-04 | Provider fails after workflow transaction commits | Workflow decision remains committed; attempt/failure is recorded and delivery remains eligible under approved retry policy |
| NOTIF-05 | Worker stops after claiming delivery | Lease expiry/equivalent recovery makes work claimable again; prior attempt/claim history is not erased |
| NOTIF-06 | Two workers claim the same eligible delivery | Only one valid claim owns processing at a time; stale claim cannot overwrite newer state |
| NOTIF-07 | Provider accepts message but worker loses response | State is represented as unknown/ambiguous; retry uses provider idempotency where supported or follows an approved duplicate-risk policy |
| NOTIF-08 | Provider reports confirmed failure | Failure is recorded distinctly from unknown; safe retry follows approved backoff/rules |
| NOTIF-09 | Provider acknowledges acceptance but cannot confirm recipient delivery | Record acceptance only; do not claim delivery/receipt |
| NOTIF-10 | Delivery retry succeeds after prior failure | Attempt history remains append-only; one intent remains; workflow mutation is not rerun |
| NOTIF-11 | A notification intent is duplicated for same logical event/recipient/channel | Approved deduplication identity prevents unintended duplicate intent |
| NOTIF-12 | Notification recipient is unauthorized or ambiguous | Fail closed for sending; workflow event remains valid unless required intent itself cannot be recorded |
| NOTIF-13 | Notification body links to restricted submission | Link does not grant access; recipient authorization is re-evaluated on open |
| NOTIF-14 | Worker interruption/recovery or repeated provider ambiguity | No exactly-once claim without provider-supported idempotency; outcome remains observable and auditable |
| NOTIF-15 | Workflow action attempts provider call inside transaction or trigger | Architecture/test review rejects external call in workflow transaction; delivery remains post-commit |

Stage 3 includes notification, delivery/retry state, and append-only attempt concepts. It does not explicitly define claim ownership, lease expiry/recovery, or ambiguous provider outcome fields. Treat those as model-review gaps; do not assume capability or add schema objects in this test strategy.

## 13. File and Storage test boundaries — DEFERRED

Storage policies, signed-URL semantics, offline approval evidence, and object-retention rules remain deferred. The following are conceptual future tests only; they are **DEFERRED until Storage design and explicit authorization**:

| ID | Future test idea | Deferred acceptance target |
|---|---|---|
| STOR-01 | Unauthorized user requests another submission's file | Denied even with guessed path/object ID |
| STOR-02 | File access derives from parent submission/version/response authorization | Only exact authorized parent scope grants access |
| STOR-03 | Uploaded object metadata does not match submission/version/attachment metadata | Database workflow cannot enter submitted state with missing/invalid required attachment metadata |
| STOR-04 | Object upload succeeds but database transaction rolls back | No submitted/version pointer or partial metadata; orphan is detectable and cleanup follows approved procedure |
| STOR-05 | Orphan detection and cleanup | No referenced object is deleted; retention/cleanup follows separately approved policy |
| STOR-06 | Signed URL scope and expiration | Only approved object/action and approved lifetime; URL treated as bearer capability |
| STOR-07 | Offline evidence read/write and retention | No offline-evidence access or policy is presumed until dean/institutional decision |

No Storage bucket/policy or offline-evidence behavior is implemented or approved by these proposed tests.

## 14. Failure injection and recovery

Failure injection is performed only in an isolated disposable environment after approval. Inject failures at deterministic transaction boundaries; record state before/after, retry behavior, and required evidence.

| ID | Injected failure | Required rollback/persisted state | Retry and audit expectation |
|---|---|---|---|
| FI-01 | Assignment record succeeds, responsibility creation fails | Entire assignment-plus-responsibility command rolls back; no partial assignment or completed idempotency result | Same request may be retried after cause is fixed; failed attempt must not look successful |
| FI-02 | Response insert succeeds, required actor/event evidence fails | Response, attachment links, projection, and required intent roll back together | Retry complete operation using same key; no orphan response |
| FI-03 | Decision insert succeeds, status-history/projection write fails | Decision and all required decision state roll back | Retry after repair; no decision without history |
| FI-04 | Reassessment has begun selected-set validation/writes, then a later selected responsibility fails | All new selected-set cycles, applicability records, projections, and events roll back; prior histories remain | Retry entire selected set with same request semantics; never continue a partial batch |
| FI-05 | Applicability record or required history write fails | Confirmation and any effective-basis/projection changes roll back | Retry only after state recheck; no silently effective confirmation |
| FI-06 | Required notification intent write fails | Underlying mandated workflow action rolls back | Retry operation atomically; distinct from provider failure after commit |
| FI-07 | Provider fails after workflow commit | Workflow state remains committed; delivery state/attempt records failure or pending | Retry delivery alone; do not rerun workflow mutation |
| FI-08 | Worker interrupted during delivery | Committed workflow state remains; claim recovers by lease/equivalent after approved rules | Record attempt/outcome and recover without losing earlier history |
| FI-09 | Client loses response after commit | All transaction writes remain committed | Retry returns prior result; no duplicate decision/version/assignment |
| FI-10 | Database reports conflict/deadlock after concurrent operation | Losing transaction leaves no partial records | Retry entire logical operation with same idempotency semantics and fresh authorization/state checks |
| FI-11 | External file upload succeeds; database attachment metadata/version write fails | Database has no partial version/submitted state; object may be unreferenced | Cleanup is separate, deferred Storage recovery; never assume PostgreSQL rolled back upload |

For each injected failure, collect sanitized database snapshots/counts of the relevant synthetic records and verify actor/event/status/notification relationships. Do not log document contents, secrets, or real personal data.

## 15. Acceptance criteria and release gates

These are measurable future gates, not current project results. Applicable thresholds require measurement and/or stakeholder approval; performance values remain **TBD** until that process occurs.

| Gate | Required acceptance evidence | Blocking conditions |
|---|---|---|
| Workflow acceptance | All applicable Path A and Path B cases pass; initial Officer review, manual routing, response gates, correction, reassessment, and overall outcomes match the workflow plan | Any automatic routing; office overall decision; missing active-responsibility response; mandatory bypass; conflated RETURNED/REJECTED/COMPLETED |
| Database integrity acceptance | All required keys, composite same-submission, uniqueness, immutable history, effective-basis, and rollback tests pass on approved candidate schema | Cross-submission link, duplicate cycle response, history gap, partial selected-set reassessment |
| Authorization/RLS acceptance | Direct database/PostgREST positive/negative tests pass; actor identity trusted; grants, columns, RLS, function EXECUTE, definer boundaries, separate UPDATE USING/WITH CHECK outcomes, membership governance, and secret-safe browser/build checks are reviewed | Any unauthorized read/write, self-grant, unauthorized membership operation/self-assignment, Admin-only approval/content bypass, unapproved privileged grant, restricted-column exposure, or service-role credential/client in browser-reachable code or artifacts |
| Concurrency acceptance | Every defined race has deterministic invariant-preserving outcome, no invalid terminal/response combination, no lost history, and no unexplained deadlock; response-vs-rejection/return orders pass | Approval can bypass uncommitted required response; new assignment can race past final approval; duplicate response/decision/effective basis; rejection/return race loses or partially records history |
| Idempotency acceptance | Same payload replay, mismatch rejection, concurrent claims, pre-commit rollback, lost-response retry, and atomic claim/business mutation pass | Completed key without business commit, duplicate mutation, actor/scope key collision |
| Reassessment/history acceptance | Selected-set atomicity, exact target binding, unaffected responsibility preservation, no reactivation/double-count, actor/version history retention pass | Partial reassessment, overwritten response/version, broad automatic reuse |
| Notification reliability acceptance | Required intents present atomically; provider failure independent; attempt history and recovery work; unknown outcome not mislabeled | Missing mandated submitter intent; decision rollback due only to post-commit provider failure; unsupported exactly-once claim |
| Application/E2E acceptance | Synthetic personas complete all approved user journeys and observe correct state; direct backend tests independently pass | UI success while persisted records or authorization are wrong |
| Security acceptance | No critical/high authorization or data-integrity defect; denied requests leak no protected content and leave no side effects | Critical/high defect or any unapproved waiver |
| Regression acceptance | All applicable prior accepted tests pass on the release candidate with recorded build/version | Regression affecting settled workflow or security invariant |
| Performance/reliability acceptance | Measured results, workload, environment, and failure/recovery evidence meet stakeholder-approved thresholds | Threshold absent for a claim of acceptable capacity; arbitrary values are not substituted |

No critical authorization or data-integrity failure may be waived because the UI appears correct. Any waiver for other defects requires an explicitly authorized human decision; waiver authority is not identified by the source documents and remains unresolved. Gates blocked by design inputs include:

- **Stage 3:** Final schema, entity/cardinality decisions, same-submission enforcement, effective-basis/active-cycle semantics, history, and exact lifecycle.
- **Stage 4:** RLS/column privileges, approved role-grant governance, function ownership/EXECUTE, helper behavior, current membership/grant checks, and historical access.
- **Stage 5:** Operation contracts, shared submission synchronization/lock order, authorization-revocation-versus-in-flight-operation serialization protocol, idempotency lifecycle, reassessment atomic unit, and notification worker recovery model.
- **Technical dependency:** Account-suspension tests remain conditional until the account lifecycle and suspension mechanism are finalized. In-flight membership/grant revocation tests remain blocked for overlapping schedules until the operation-time authorization/serialization contract is approved; do not infer locks or synchronization.
- **MTO/dean:** Office authority/path meanings, response granularity/batching, permitted office-membership grantor authority/process, allowed resolutions/cancellation, rejection/reopening/status semantics, notification breadth, Storage/offline evidence, and acceptance/waiver authority.

## 16. Traceability, reporting, and defect management

For every future executed case, record:

| Field | Required content |
|---|---|
| Test ID | Stable ID from the relevant test family or approved suite |
| Requirement reference | Source document and section plus traceability row ID |
| Test level | One or more levels from Section 3 |
| Environment | Exact approved environment identifier; never “TEST” without the approved project/build context |
| Build/version | Application commit/build and candidate schema/migration version where applicable |
| Fixture | Synthetic fixture identifiers and relationship summary |
| Preconditions | Actor, state, current version/revision, grants/memberships, and expected active work |
| Steps | Reproducible actions, including concurrency schedule where relevant |
| Expected result | Invariant, response, and persisted-state expectation |
| Actual result | Observed behavior and sanitized record/evidence references |
| Status | Pass, fail, blocked, skipped, or not applicable with rationale |
| Evidence | Sanitized logs/artifacts; no credentials, secrets, or real personal/document content |
| Defect reference | Linked issue/defect, severity, owner, and remediation verification |
| Execution date | Timestamp and executor/automation identity |

### 16.1 Proposed defect severity

| Severity | Meaning | Example |
|---|---|---|
| Critical | Unauthorized privilege escalation, cross-user/office sensitive data exposure, mandatory approval bypass, corrupt/lost authoritative workflow history, or invalid overall decision | Unauthorized actor can approve or read protected submission content |
| High | Core workflow or authorization invariant fails with material risk, but not classified Critical | Response accepted for wrong cycle or assignment can race past final approval |
| Medium | Important workflow, retry, notification, or history behavior is incomplete with a bounded workaround | Notification worker recovery missing but workflow decision remains correct |
| Low | Limited usability/reporting issue without authorization, integrity, or decision impact | Noncritical label or rendering inconsistency |

### 16.2 Failure, regression, waiver, and coverage

- A failed blocking test creates a defect and blocks its acceptance gate until fixed and retested. Preserve the failing reproduction and evidence.
- Retest the original failure and relevant neighboring/regression cases after a fix. Do not change expected behavior merely to make a test pass unless the workflow owner approves a requirement change.
- A blocked test due to unresolved schema, policy, or environment must be reported as blocked, not passed or skipped without rationale.
- Requirements coverage reports should enumerate covered, uncovered, blocked, and not-applicable traceability rows. A test count alone is not coverage evidence.
- No source document identifies institutional waiver authority. Do not invent it; record waiver proposals for the responsible human authority to decide. Critical authorization/data-integrity failures are not waivable under this strategy.
- Preserve an auditable history of test changes, executions, defects, and acceptance decisions.

## 17. Future test execution sequence

This is a dependency order for a later authorized implementation effort, not permission to execute now.

1. **Approve test contracts and source traceability.** Confirm which requirements are agreed, which architecture details remain recommendations, and which unresolved decisions block a case. Exit: reviewers approve the test matrix without silently turning open policy into requirements.
2. **Finalize Stage 3 relational model.** Reconcile exact entities, composite relationships, cardinality, lifecycle, history, and effective-basis semantics. Exit: candidate schema design is approved for disposable tests.
3. **Complete Stage 4 security design.** Confirm role and office-membership grant governance, direct column access, RLS, helper/function boundaries, historical scope, account-state behavior where applicable, test actor roles, and the server-only service-role boundary. Exit: authorization contract and negative-test identities are approved.
4. **Complete Stage 5 operation/concurrency design.** Confirm transaction writes, shared synchronization, lock order, the revocation-versus-in-flight-operation serialization contract, idempotency, rollback, and notification recovery requirements. Exit: every required race/failure has defined winner/loser and persisted-state semantics; unresolved overlap is explicitly blocked.
5. **Authorize environment and fixture strategy.** Provision/identify local or isolated database target; confirm the legacy TEST exclusion; approve synthetic identities and cleanup. Exit: target identity and isolation verified.
6. **Run relational constraints and transaction rollback tests.** Exit: same-submission, uniqueness, append-only, and atomicity cases pass.
7. **Run authentication, authorization, and RLS tests.** Test database boundary and application boundary separately, including membership governance, distinct UPDATE USING/WITH CHECK checks, and secret-safe browser/build artifact inspection. Exit: required positive/negative cases pass; no blocking access issue.
8. **Run core operation and workflow integration tests.** Exercise initial review, Path A/B, routing, office responses, return, version, reassessment, and final decisions. Exit: persisted workflow and UI agree.
9. **Run concurrency and idempotency suites.** Execute controlled simultaneous schedules and retries. Exit: all invariants pass with documented lock order and no unexplained partial records.
10. **Run notification reliability tests.** Use mocks/controlled provider; exercise intent, attempts, failure, interruption, recovery, and ambiguity. Exit: model supports approved guarantees without external delivery in workflow transactions.
11. **Run end-to-end and security regression.** Use synthetic personas, then repeat applicable direct API/database negative tests. Exit: no critical/high defects and no regression of settled requirements.
12. **Run performance/reliability measurements.** Use representative approved workloads. Exit: report measured behavior against thresholds approved by stakeholders; otherwise leave gate TBD.
13. **Conduct final acceptance review.** Review traceability gaps, defect status, environment evidence, unresolved decisions, and waiver requests. Exit: authorized human acceptance is recorded; no deployment follows automatically from test completion.

An earlier phase must pass its exit criteria before dependent integration tests are treated as meaningful. Any failed gate returns the affected work to design or implementation remediation; it is not bypassed by proceeding to a higher-level green UI test.

## 18. Open decisions and implementation readiness

### 18.1 Technical decisions

- Final Stage 3 schema and composite same-submission enforcement.
- Stage 4 effective RLS, grants, column restrictions/safe projections, helper recursion, function owner/EXECUTE, and runtime negative tests.
- Stage 5 shared submission-level synchronization, consistent lock ordering, retry/error behavior, and candidate database concurrency harness.
- Define the authorization linearization/serialization contract for membership or role-grant revocation racing a pending workflow operation. Until defined, test revoke-first and operation-first outcomes conceptually, but mark overlapping schedules blocked; do not prescribe an unapproved lock mechanism.
- Finalize whether account suspension exists and how it affects authorization. Keep account-suspension tests conditional; do not invent account fields or suspension policy.
- Notification worker claim lease/recovery and ambiguous-provider outcome representation; Stage 3 does not explicitly define these fields/semantics.
- Idempotency claim lifecycle, scope, fingerprint, result reference, and expiration/cleanup behavior. Do not invent a retention duration.
- Test framework/runner and test-data management, based on repository configuration when implementation is authorized.
- Safe, non-disclosing process for scanning browser-reachable imports, client configuration, build artifacts, and source maps for service-role exposure.
- Isolated automated-test database and dedicated clean Supabase TEST project provisioning/authorization.
- Measured performance/reliability thresholds.

### 18.2 Institutional / MTO / dean decisions

- Assignment-level versus responsibility-cycle response granularity; Stage 3’s one-response-per-cycle remains a technical recommendation pending confirmation against the canonical assignment wording.
- Optional response batching and whether one representative must submit a batch.
- Office authority mapping and meanings/precedence of Department Only, External Only, External + Department, and Multiple Offices.
- Which nonmandatory responsibility resolutions are permitted and under what conditions; no resolution may substitute for required Evaluation/Recommendation response or mandatory approval.
- Whether any mandatory cancellation can ever be valid; default tests must preserve the no-bypass safeguard.
- Initial/overall rejection criteria, reopening, lifecycle/status mapping, and `COMPLETED` closure semantics.
- Notification events/recipients beyond required submitter notices, channels, timing, delivery/retry/retention policy.
- Historical visibility/retention for former office members, Admin content, internal notes/messages, and audit history.
- The workflow plan assigns office-membership management to the Tourism Head/System Administrator; the exact authorized grantors, any delegation/scope, and the checked process for creating, modifying, or revoking memberships still require confirmation. Positive membership-administration tests remain blocked until the grantor process is confirmed; do not infer authority from a role label alone.
- Offline evidence and Storage access/retention policies; remain deferred pending separate consultation and approval.
- Points eligibility/recipient/calculation/reversal and reporting measures/access.
- Test acceptance authority and any waiver authority; neither is identified by the source documents.

Do not silently settle these decisions in fixtures, expected results, or test-only helper behavior. Where an unresolved item blocks exact behavior, mark that test row blocked pending approval rather than inventing a rule.

## 19. Final readiness assessment

### What can be tested once an approved implementation exists

- Unit and component behavior for already agreed rules, including Tourism Officer routing control, distinct route modes, responsibility types, non-veto evaluation/recommendation, mandatory safeguards, version preservation, and office-versus-overall decision separation.
- Database and application authorization behavior after Stage 3/4 schema, policy, role mapping, and operation contracts are approved.
- Transaction atomicity, same-submission integrity, idempotency, concurrency, and history preservation against a disposable candidate schema.
- End-to-end Path A/Path B, correction, selective reassessment, and final decision behavior using synthetic actors.
- Notification intent/delivery recovery only after the model gap and delivery requirements are resolved.

### What needs clarification first

- Final schema, assignment/cycle relationship semantics, composite same-submission constraints, final status/closure model, and active/effective-basis definitions.
- Stage 4 runtime authorization design: role-grant authority, Admin boundaries, direct column/PostgREST control, function permissions, and current membership/revocation checks.
- Stage 5 lock implementation, lock ordering, transaction contracts, idempotency lifecycle, and worker recovery representation.
- Any acceptance threshold or behavior dependent on institutional policy.

### What remains unresolved or deferred

- The MTO/dean decisions in §18.2 remain open and must not be treated as approved by test fixtures.
- Storage policies, signed URLs, file cleanup, and offline approval evidence remain deferred.
- Production is outside scope; no Production testing or access is authorized.
- No existing or historical TEST schema is the canonical architecture test target. The legacy project reference is not to be used for future architecture testing.

### Preconditions before implementation or test execution

1. Human review approves the relevant Stages 3–5 contracts and all policy-dependent expected results.
2. The future test target is explicitly authorized, isolated, and not the legacy TEST project or Production.
3. Synthetic fixture, cleanup, secret handling, and provider-mock strategies are approved.
4. Database and application test boundaries are both represented; no UI-only evidence is accepted for authorization.
5. Test execution is separately authorized and results are recorded using §16.

**Recommended next architecture action:** Human review and resolution of Stage 3/4/5 blockers and applicable MTO/dean decisions, followed by authorization of an isolated automated-test environment. Do not begin database or Supabase test execution against the existing legacy TEST project.

## Appendix A. Source section index

This index maps shorthand references in the traceability matrix to actual source sections.

| Source | Relevant sections |
|---|---|
| Revised Workflow Plan | §§1–9: roles; end-to-end workflow; responsibility types; paths; history/messages/notifications/rewards/reporting; security; offline handling; open decisions; implementation guidance |
| Phase 2 Workflow Gap Analysis | §§1–2 audit/evidence boundaries; §§3–5 app/current behavior, functions/permissions, Storage/migration evidence; §§6–12 comparison, database/security gaps, unresolved decisions |
| Phase 2 Implementation Roadmap | Delivery principles; Phase 0 role/office/status decisions; Phase 1 model/security reconciliation; Phases 2–6 workflow slices; Phase 7 validation/rollout; deferred items |
| Phase 2 Workflow Decision Mapping | Evidence labels and scope boundary; Requirement Mapping §§1–14; overlapping structures; agreed rules versus unresolved policy; implementation blockers |
| Stage 3 Relational Model | §§2–3 assumptions/principles; §§4–11 entity models; §12 inventory; §§13–18 relationships, composite keys, constraints, effective basis, transactions; §§19–22 optional features, open decisions, risks, readiness |
| Stage 4 Authorization and RLS Design | §§1–3 principles/identity/role matrix; §§4–7 resource rules, grants/RLS/column controls, function safety; §§8–10 application, deferred Storage, security tests; later readiness/open decisions |
| Stage 5 Database Operations Design | §§1–3 authority/invariants; §4 Operations 1–23; §5 atomic write sets; §6 concurrency/lock order; §§7–9 idempotency/events/reassessment; §10 notification recovery; §§11–15 failures, authorization, proposed tests, open decisions, readiness |

**Validation status:** This strategy is a proposed document. No application, test code, SQL, migration, database, Supabase project, or Production resource was changed or tested in creating it.
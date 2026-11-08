# CONNECT-Daet.ai — Phase 4 Authorization and RLS Design

**Status:** Proposed authorization design; documentation only; not approved, implemented, or deployed
**Workflow authority:** [Revised workflow plan](./REVISED_WORKFLOW_PLAN.md)
**Supporting evidence:** [Phase 2 gap analysis](./PHASE_2_WORKFLOW_GAP_ANALYSIS.md), [Phase 2 implementation roadmap](./PHASE_2_IMPLEMENTATION_ROADMAP.md), [Phase 2 workflow decision mapping](./PHASE_2_WORKFLOW_DECISION_MAPPING.md), and [Stage 3 relational model](./PHASE_3_RELATIONAL_MODEL_AND_INTEGRITY_SPECIFICATION.md)

> This design describes proposed controls for the Stage 3 conceptual entities. Stage 3 is not a frozen schema, and none of its proposed names or relationships is proof of a deployed database object. Phase 2 TEST observations are historical audit evidence, not a current database inspection. This document contains no executable SQL and authorizes no implementation, migration, database access, or deployment.

## 1. Scope, evidence labels, and security principles

This design covers two complementary enforcement layers:

1. **Application authorization:** Next.js server-side identity/session checks and action-specific authorization before returning content or invoking a mutation.
2. **Database authorization:** PostgreSQL grants, RLS, and narrowly scoped database operations that still enforce access if a request bypasses the UI or application route.

Neither layer substitutes for the other. RLS is the database row boundary; table/column grants and checked operations are also necessary. UI visibility is usability, not security.

Labels used in this document:

- **Agreed workflow:** Required by the authoritative workflow plan.
- **Stage 3 proposal:** A conceptual entity or technical relationship, not an approved schema.
- **Recommended control:** A security design recommendation, not an institutional policy or deployed control.
- **Provisional:** Depends on a Stage 3 entity, relationship, role mapping, or workflow lifecycle decision that is not frozen.
- **Unresolved:** Requires institutional or technical confirmation before implementation.
- **Deferred:** Explicitly outside this stage.

### Security principles

- **Least privilege and default deny:** Grant only the minimum table and action privileges required. No matching policy means no access.
- **Authenticate first, authorize separately:** A valid Supabase Auth session establishes an authenticated identity; it does not by itself grant access to any workflow resource.
- **Bind identity server-side:** Resolve `auth.uid()` to the corresponding profile identity using the eventual approved identity relationship. Never accept a client-supplied profile ID as proof of actor identity.
- **Recheck live authority:** Every privileged operation must check the actor's current applicable role grant, and where relevant current office membership, assignment, responsibility, workflow state, and ownership.
- **No client-trusted scope:** Do not trust client-supplied role-grant IDs, profile IDs, office IDs, membership IDs, submission ownership claims, or assignment scope. These may identify a requested object but must be checked against server/database-authoritative relationships.
- **No UI-only controls:** Hidden buttons, disabled controls, route middleware, and client-side filtering do not authorize a read or mutation.
- **No universal office access:** Membership in one office does not grant access to another office's assignments or a submission's unrelated responsibilities.
- **No Admin content bypass:** `admin` supports system administration. It does not automatically grant access to submissions, versions, attachments, office responses, private notes, or message content, and it does not imply Tourism Officer authority.
- **Historical evidence is not current authority:** A past action, role grant, office membership, or audit entry proves historical context only. It does not authorize a new operation or automatically grant continued access.
- **Revocation is effective for new actions:** Revoked/ended, suspended, expired, or otherwise inactive authority must not authorize new reads or writes beyond any separately approved historical-visibility rule.
- **Append-only workflow evidence:** Official responses, Officer response reviews, overall decisions, status history, and audit evidence are not directly updated or deleted by application clients. Corrections are new attributed events where the approved model permits them.
- **Fail closed:** Missing profile linkage, ambiguous membership, inaccessible parent row, unknown status, or failed policy helper must deny access. Do not return success-shaped fallbacks.

## 2. Identity and authorization model

### 2.1 Roles and identity

The only workflow roles in scope are those named by the workflow plan:

| Role | Meaning |
|---|---|
| `user` | Submitter |
| `approver` | Tourism Officer |
| `external_approver` | Authorized municipal-office representative |
| `admin` | Tourism Head / System Administrator |

Roles are additive. A person may hold more than one valid role and may be a member of multiple offices without maintaining separate accounts. Treat grants as three governance classes:

- **Ordinary role grant:** `user` submitter capability, created only by trusted registration/provisioning. A user cannot assign or grant this or any other role to themselves through an application operation.
- **Administrative grant:** `admin` system-management capability. It does not itself authorize a person to issue any other privileged grant or act in the workflow.
- **Privileged workflow grants:** `approver` and `external_approver`. These confer workflow authority only within their respective scope and only while active.

The Tourism Head/Admin is responsible for system administration, including role management and office memberships, under the workflow plan. However, the plan does not define the approval hierarchy or process for issuing or revoking privileged role grants. In particular, `admin` alone does not authorize granting `approver`, and Admin status never automatically grants the Tourism Officer role. Who may authorize Tourism Officer authority, and whether an Admin may grant privileged roles to another person, are **UNRESOLVED / REQUIRE MTO CONFIRMATION**. Until an explicit process is approved, fail closed: do not permit any actor whose grant authority is unconfirmed to create, assign, modify, or revoke a privileged workflow grant. No user may elevate their own privileges through role-management operations. Every grant or revocation must preserve auditable identities for both the actual grantor and affected user. Revoked or inactive grants cannot authorize new actions.

No client signup metadata or caller-supplied identity is authority to create or alter grants. Changes to a grant are checked, attributed operations, not direct client edits; historical grant records are retained rather than overwritten or deleted.

The proposed authorization chain is:

1. A verified Supabase Auth session identifies the caller.
2. The database/application resolves that identity to exactly the caller's profile.
3. The operation checks a currently valid role grant for the requested capability.
4. If office work is involved, it checks an active membership for the exact office and an active `external_approver` grant.
5. It checks the resource's actual parentage and scope: submission ownership, office assignment, responsibility, review cycle, and current workflow state as applicable.
6. It applies the specific operation's policy, including immutable-history, mandatory-clearance, and decision-authority guards.

No step may be replaced by a role value supplied by the browser. The Stage 3 `role_grants` and `office_memberships` structures are proposals; their exact status/time fields and identity foreign keys require schema review.

### 2.2 Active authority and multi-actor work

- Multiple authorized Tourism Officers may share the Officer work queue, but every read and action is attributable to the actual authenticated person. No shared account, anonymous Officer action, or actor ID passed as a substitute for identity is permitted.
- The role grant used for a privileged action and, for office responses, the office membership used should be retained as historical authorization context as proposed in Stage 3.
- A member of multiple offices receives only the assignments for each office where the caller has a currently valid membership and role. Access in one office must not be used to satisfy another office's scope.
- Several active representatives may read an office's relevant shared assignment. Only one representative submits the official response for a particular review cycle; after submission, other representatives are read-only for that cycle. A different cycle may have a different representative.
- The Tourism Officer alone chooses simultaneous or one-at-a-time routing and controls each subsequent assignment. Office members cannot forward a submission to another office.
- Role revocation and membership termination stop future privileged actions. The continued visibility of records previously accessed by a former member is not inferred; see Section 6.
- Suspension, expiry, and other inactive states must be treated as non-authorizing if supported by the approved lifecycle model. Stage 3 does not settle their exact representation; do not invent columns or default durations.

### 2.3 Authorization decision is resource- and action-specific

An allowed role is necessary, not sufficient. For example, an `external_approver` must also have the active membership for the office named by the assignment, and the requested response must target a responsibility/review cycle within that assignment. An `approver` grant authorizes Tourism Officer functions only; it does not grant system administration. An `admin` grant authorizes approved administrative operations only; it does not grant document workflow authority or all document content.

The workflow plan's office authority matrix, historical visibility, and some status rules remain open. Until they are decided, the design must not broaden access to fill the gap.

## 3. Role and permission matrix

Legend: **Yes** means the role may perform the action only within the stated scope and through an authorized operation. **No** means that role must not perform it by virtue of that role. **Conditional** means a separate, explicitly granted and checked capability is required. All actions require an authenticated actor except explicitly public, non-sensitive authentication flows.

| Action | `user` | `approver` (Tourism Officer) | `external_approver` | `admin` (Tourism Head) |
|---|---|---|---|---|
| View own profile / permitted identity details | Yes, self | Yes, self | Yes, self | Yes, self; limited administration view as needed |
| View submissions | Own submissions and explicitly permitted status/response information | Workflow content necessary for authorized Officer duties | Only assigned office's relevant submission and responsibility information | No automatic content access; a separately approved oversight view must be narrowly scoped |
| Create submission | Yes, as self | Only if separately acting under a valid `user` role | Only if separately acting under a valid `user` role | Only if separately acting under a valid `user` role |
| Update own submission | Only permitted correction/resubmission actions while eligible; not arbitrary ownership/status changes | No owner impersonation; use Officer workflow actions | No | No |
| Submit corrected version | Yes, for own submission after formal return and through a checked action | No, except an independent submitter role on own submission | No, except an independent submitter role on own submission | No, except an independent submitter role on own submission |
| Create/manage assignments, responsibilities, routing | No | Yes, for authorized submissions and approved workflow state | No | No, unless separately granted `approver` and acting under that grant |
| View office assignment queue | No, except permitted submitter progress projection | Yes, shared authorized Officer queue | Yes, only for the caller's active office memberships and relevant assignments | No automatic access |
| Create official office response | No | No | Yes, for the assigned office/responsibility/review cycle using the caller's own identity | No, unless separately holding `external_approver` plus relevant active membership |
| Review office response / record Officer review | No | Yes, with active `approver` grant; each action separately attributed | No | No, unless separately holding `approver` |
| Issue formal return/change request to submitter | No; may respond to one | Yes, only Tourism Officer workflow operation | No | No, unless separately holding `approver` |
| Initiate reassessment / confirm response applicability | No | Yes, under explicit workflow authority and applicable guards | No | No, unless separately holding `approver` |
| Make overall `APPROVE`, `RETURN`, or `REJECT` decision | No | Yes, for authorized submission and allowed workflow state | No | No, unless separately holding `approver` |
| Reject an office responsibility | No | No as an office outcome; Officer may make an overall decision separately | Yes, only as the assigned office's responsibility outcome | No, unless separately holding `external_approver` and assigned |
| Manage accounts, privileged role grants, offices, memberships | No | No, unless separately granted `admin` for the administrative operation | No | Yes for administrative operations through checked, audited processes; privileged workflow grant authority remains unresolved and fail-closed pending MTO confirmation |
| Manage permitted non-security configuration | No | No | No | Conditional; only explicitly approved non-security-critical settings |
| Read audit history | Own permitted action/status history only; not unrestricted audit | For authorized workflow duties and submission scope | Only narrowly scoped evidence for own authorized assignment if approved | No content-wide access by default; restricted system audit metadata only if separately approved |
| Delete/archive workflow records | No | No direct deletion; only approved attributed lifecycle actions | No | No workflow-record deletion; administrative archival only if a separate policy is approved |

Possession of multiple roles does not merge their scopes. Evaluate each requested action under the exact role grant and resource relationship that authorizes it. For example, an Admin who also has an active `approver` grant may perform an Officer action only under that separately authorized grant and must be recorded as the actual actor; Admin status itself contributes no workflow authority. The authority to issue that `approver` grant is unresolved; do not infer it from Admin's general role-management responsibility.

## 4. Resource-level access matrix

The matrix is a proposed minimum-access map, not a deployed policy. “Officer” means an authenticated actor with a currently valid `approver` grant. “Assigned member” means a caller with a currently valid `external_approver` grant and active membership in the exact assigned office. “Owner” means the submitter identified by the database relationship, not a client assertion. “Admin” refers only to the administrative scope expressly described in the row.

Unless stated otherwise, **hard delete is denied for all roles**. History-bearing records are append-only. Administrative or technical maintenance must use a separately authorized retention/archive procedure after its policy and legal requirements are approved. RLS controls rows, not which columns within a selected row are revealed; use narrowly designed projections/operations for public-safe or reduced content views. The resource rules below are the most restrictive baseline: group policies in Section 5.2 inherit and must not broaden them.

| Stage 3 entity / resource | Read | Create | Update | Delete / archive | Required scope and conditions |
|---|---|---|---|---|---|
| `profiles` | Self; Admin may access only identity fields needed for account administration; other actors receive only minimum actor identity needed for an authorized workflow | Trusted identity-provisioning flow only | Self-service only for approved non-authoritative profile attributes; Admin through audited account operation | No hard delete through workflow access | A profile ID must resolve to the authenticated identity for self access. Profile attributes do not prove role or membership. |
| `role_grants` | Self's grants as needed; Admin's authorized grant-management view | Trusted registration may create only `user`; Admin may operate only within an explicitly approved grant process. No self-grants. Do not issue `approver` or other privileged workflow grants until the authorizing process is confirmed | No in-place role escalation; grant/revocation is a checked, attributed historical operation | No hard delete | Record actual grantor and affected user. `admin` alone does not authorize granting `approver`; unconfirmed authority fails closed. Actor-supplied grant IDs are validated against the caller. |
| `offices` | Authenticated users only the approved office directory fields; assigned members may see their own office details | Admin through checked operation | Admin through audited lifecycle/configuration operation | Deactivate/archive only by approved operation; no destructive deletion of referenced offices | Office catalog visibility is not assignment access. |
| `office_memberships` | Self's memberships; Admin for membership administration; office context only where needed for the caller's active assignment | Admin through checked membership grant | End/revoke through an attributed operation; no arbitrary edits to historical membership | No hard delete | Exact profile and office; membership must be current for new office actions. |
| `submissions` | Owner; Officer for authorized workflow; assigned member only for work attached to that member's office; Admin has no automatic content read | Owner through checked submit operation | No general direct update. Owner correction/resubmission and Officer workflow changes use distinct checked actions | No hard delete; any archival policy is unresolved | RLS checks owner or current authorized workflow relationship; do not expose unrelated internal fields to submitters/office members. |
| `submission_versions` | Same submission scope as parent; assigned member only if the version is relevant to its cycle | Owner through eligible correction/resubmission operation; initial version created with submission | Immutable | No delete; retain prior versions | Version must belong to the same submission; an assignment is limited to the exact version under review. |
| `document_types` (optional) | Only approved catalog fields exposed for submission selection | Deny unless catalog administration is explicitly assigned; if assigned, Admin uses a checked operation | Deny unless catalog administration is explicitly assigned; if assigned, Admin uses a checked operation | No deletion if referenced; archive only through an approved lifecycle | A type selection must not automatically route a submission; detailed type-specific rules and catalog administration are unsettled. |
| `attachments` | Only through parent-resource authorization and any approved attachment-purpose rule | Checked upload/metadata operation for an authorized parent | No in-place replacement of referenced file metadata; use new attachment/version where the model permits | No client delete of referenced attachments; unreferenced cleanup is a separate deferred Storage concern | A guessed ID/path never grants access. Actual Storage access is deferred in Section 9. |
| `submission_version_attachments` | Same scope as linked submission and version | Checked version/attachment-link operation | No arbitrary relinking after use | No delete from referenced history | Composite same-submission consistency must be validated. |
| `routing_rounds` | Officer for authorized submission; assigned member only the minimum round context needed to understand its assignment | Officer through checked routing operation | No in-place replacement of routing history; append changes/events | No hard delete | Actor must hold active `approver`; mode and same-submission relationships follow the approved workflow. |
| `office_assignments` | Officer; assigned members of that exact office; submitter only an approved progress projection | Officer only through checked operation | Officer changes through attributed events/revisions; no direct scope reassignment | Cancellation is not deletion; only Officer may cancel within safeguards | Exact submission and office; a member of another office has no access. |
| `office_assignment_events` | Officer in workflow scope; assigned members only the events needed for their assignment; submitter only approved progress projection | Trusted checked workflow operation | No | No | Append-only; actor and authorization context retained. |
| `office_responsibilities` | Officer; assigned members of the containing office; submitter only approved progress projection | Officer through assignment action | No silent overwrite; changes use revisions/events | No delete; valid cancellation is an attributed event | Read/write tied to exact parent assignment and submission. |
| `office_responsibility_revisions` | Officer; assigned members for their responsibility; submitter only information explicitly permitted for a formal request/status | Officer through checked revision action | Immutable | No | Exact responsibility, assignment, submission, and revision history. |
| `office_responsibility_events` | Same current workflow scope as the responsibility; only authorized readers of the affected event | Trusted checked operation | No | No | Append-only lifecycle record; former membership does not automatically grant current access. |
| `responsibility_resolutions` | Officer; submitter only where needed to understand an approved outcome; assigned office only if the resolution concerns its work and policy permits | Officer only, and only for an explicitly permitted nonmandatory case | No; later correction is separately attributed | No | Conditional Stage 3 entity. Never substitutes for mandatory office approval; exact permitted cases remain unresolved. |
| `review_cycles` | Officer; assigned members of the exact office; submitter only an approved progress view | Officer initiates/coordinates under the workflow; cycle creation must be checked | No in-place retargeting; lifecycle changes use events | No | Each cycle targets exactly one same-submission version and responsibility revision. |
| `review_cycle_events` | Same scope as the cycle; submitter may see only approved progress events | Trusted checked workflow operation | No | No | Append-only and cycle-specific. |
| `review_responses` | Officer; active members of the assigned office as allowed by shared-queue rules; submitter visibility of findings/content is unresolved and must default to no direct full-row access | Assigned member only, for the exact cycle, with active membership and external role grant | Immutable; follow-up creates a new cycle/response | No | Stage 3 recommends one official response per responsibility review cycle, never one response record for all assignment responsibilities; exact actor, membership, grant, version, revision, office, and submission must agree. The canonical plan's assignment-level wording remains to be harmonized. |
| `review_response_attachments` | No broader than the parent response and attachment scope | Checked association in the response submission flow, if enabled | No relinking | No deletion of referenced history | Phased feature; same-submission checks; no offline evidence or Storage design here. |
| `tourism_officer_response_reviews` | Officer actors authorized for the submission; visibility to offices and submitters is not assumed | Officer only, one append-only action per review event | No; clarification/follow-up adds a separate record | No | Records the actual Officer, response, disposition, reason/notes, and time. |
| `response_applicability` | Officer; assigned office only if a future policy expressly requires it; submitter receives no automatic access to internal deliberation | Officer only after explicit confirmation and exact target validation | No; invalidation/supersession is an event | No | Original response remains unchanged; same submission/responsibility target; active response authority required. |
| `response_applicability_events` | Same restricted scope as applicability | Officer through checked operation | No | No | Append-only; invalidation does not erase the confirmation history. |
| `submission_decisions` | Officer; owner sees decision outcome/reason/instructions required for tracking; assigned members do not see unrelated overall deliberation by default | Officer only, through the checked decision operation | No | No | Overall decision is distinct from office outcome; mandatory readiness is enforced atomically. |
| `submission_status_history` | Owner via safe status projection; Officer in workflow scope; assigned member only relevant assignment progress | Trusted checked transition operation | No | No | Append-only and attributed. Non-decision transitions require an approved controlled cause. |
| Typed decision-evidence links | Same access as the parent decision plus the linked evidence's own authorization | Checked decision operation | No | No | Typed links do not grant access to their evidence; same-submission integrity required. Placeholder link names in Stage 3 are not approved tables. |
| `message_threads` (optional) | Only currently authorized participants with parent submission/office scope | Authorized participant or Officer only if messaging is enabled and policy permits | Membership/visibility changes through attributed operations | No hard delete | Thread participation is additional scope, never independent authority. |
| `thread_participants` (optional) | Thread/parent-authorized participants, subject to visibility policy | Authorized actor who may invite under approved policy | End/revoke through history-bearing action; do not silently rewrite past access | No hard delete | Historical visibility for a newly added participant is unresolved. |
| `messages` (optional) | Current thread authorization and visibility classification; private staff notes restricted to authorized staff | Authorized author for permitted message class | No in-place editing as a substitute for history; correction semantics need policy | No | Do not reveal private staff notes to submitters or unauthorized offices. |
| `message_attachments` (optional) | Same as message and attachment | Checked association if enabled | No relinking | No deletion of referenced history | Validate common submission and message-thread scope. |
| `notifications` (optional/phased) | Recipient only, with minimal approved content | Trusted workflow notification operation | Recipient may change only an allowed read marker through a checked action | No client delete; delivery/retention policy unresolved | Event, recipient, channel, and content rules remain open. |
| `notification_deliveries` (optional/phased) | Restricted delivery worker/operations context; not generally exposed to recipients | Trusted delivery process | Delivery processing through a restricted operation | No client delete | Do not expose email addresses or delivery errors beyond approved safe metadata. |
| `notification_delivery_attempts` (optional/phased) | Restricted operations context | Trusted delivery process | No | No | Append-only; avoid storing sensitive payloads. |
| `audit_events` | Restricted authorized audit view, scoped to workflow duties; Admin receives no document-content bypass | Trusted workflow/database operations only | No | No client delete; retention/archival is unresolved | Audit is not a substitute for domain history and does not confer access to referenced content. |
| `idempotency_keys` | Actor's own minimal operation/result metadata; restricted worker access as needed | Trusted authenticated operation | State transitions only within the owning transaction | Expiry/cleanup only by approved process | Bind to authenticated actor and operation; never trust a client actor ID. |
| `system_settings` (optional) | Admin may view only approved non-security-critical settings; other roles only explicitly public settings | Admin through checked configuration action | Admin only for allowlisted, non-security settings; sensitive settings need a separate design | No generic delete | Must not control role authority, RLS, mandatory guards, or bypass policy. |

### 4.1 Role/resource consistency rules

- An Admin's administrative access to `profiles`, `role_grants`, `offices`, and `office_memberships` does not grant read or write access to submission content.
- A Tourism Officer's access to workflow content must be based on the active `approver` role and authorized workflow duties. A simultaneous assignment action and a final decision both retain that individual Officer's attribution.
- Office access requires **both** the active `external_approver` role and current membership in the assignment's exact office, in addition to the assignment/responsibility relationship.
- A submitter's access to a submission is based on the database's owner relationship. A supplied submission ID is never sufficient. Related content is restricted to what the workflow permits the sender to see.
- A row reference, typed evidence link, thread participant record, notification, or audit event never independently confers access to the parent document or its attachments.
- If an operation needs an Admin who also acts as an Officer or office representative, authorization must explicitly evaluate the relevant second role and scope; do not infer one from the other.

## 5. RLS and PostgreSQL privilege design

### 5.1 General policy shape

For every exposed workflow table, first revoke unnecessary table privileges and then explicitly grant only the needed SQL commands to the intended database role(s). RLS policies are not a replacement for SQL grants. The proposed baseline is:

- **PostgreSQL grants** determine whether a database role can use a table, operation, or column at all. Grant the minimum required privileges; do not grant broad table access and expect RLS to fix it.
- **Row-Level Security (RLS)** determines which rows a role may see or affect. RLS does not hide sensitive columns on a row the role is otherwise permitted to read.
- **Column-level privileges** restrict direct access to selected columns when a role must not read or write them, including through direct SQL/PostgREST table access.
- **Controlled views or narrowly scoped database operations** provide a safe projection or perform a specific validated action when users need only part of a row or a multi-row workflow mutation. They must not bypass the underlying authorization boundary.

Sensitive values represented by the Stage 3 model may include ownership/submitter references; role-grant and office-membership records; internal review information; official actor, membership, and authorization-grant references; and administrative metadata. This list describes sensitivity classes supported by the proposed model, not additional columns. When a role is allowed to see a record but not its sensitive fields, deny direct table-column access for those fields and expose only a deliberately limited view or operation. Verify that PostgREST and other direct database access paths cannot retrieve restricted fields. Do not rely on the UI to omit them.

- Enable RLS on every exposed user/workflow table containing identity, workflow, message, notification, or audit data.
- Use **default deny**. Define only the positive access paths in Section 4.
- Use `SELECT` policies for the relevant resource scopes. Do not equate “can see an office queue” with “can read every submission row.”
- Use `INSERT` checks only for the narrow creation cases in Section 4, with actor identity derived from the authenticated session and all parent relationships verified.
- Deny general direct `UPDATE` and `DELETE` on workflow state and history tables. Mutable projections, recipient read state, account fields, and membership revocation must use narrowly scoped operations and must not rewrite authoritative history.
- Route privileged workflow mutations through checked operations that validate actor, active role/membership, parent scope, current state, mandatory requirements, concurrency, and idempotency, then append all required history atomically.
- Prefer database operations running with caller rights (`SECURITY INVOKER`). If a narrowly scoped `SECURITY DEFINER` operation is necessary, apply Section 7; do not use it as an unbounded RLS bypass.
- Keep server-only privileged credentials out of browser sessions. A service-role key bypasses ordinary RLS and must never be treated as a general application data client.

PostgreSQL permissive policies may combine with OR semantics. Review the **effective** policy set, grants, ownership, and all applicable policies together; an additional permissive policy can widen access unexpectedly. Do not rely on a restrictive policy in one place to compensate for a broad grant or alternate access path elsewhere.

#### UPDATE policy semantics

For any table where direct `UPDATE` is intentionally allowed, define both checks explicitly:

- **`UPDATE USING`** conceptually determines whether the caller may target and modify the existing row. It must reject an existing row outside the caller's current ownership, role, office, assignment, or other authorized scope.
- **`UPDATE WITH CHECK`** conceptually determines whether the resulting row is valid after the update. It must prevent a permitted actor from changing the row into an unauthorized state or scope.

Both are necessary. Checking only the existing row can allow an authorized editor to transfer a row into another user's ownership, another office's assignment, or a different responsibility scope. Checking only the resulting row can permit an unauthorized actor to alter an existing row into a scope that happens to pass the new-row test.

Examples for later policy design and testing:

| Protected data | Existing-row check (`USING`) | Result-row check (`WITH CHECK`) |
|---|---|---|
| Submission ownership | Caller must already be authorized for the existing submission and operation | Submitter/owner reference cannot be changed by an ordinary update; resulting ownership must remain the same authorized owner |
| Office assignment scope | Caller must be the authorized Tourism Officer for the existing assignment | Office, submission, and routing scope cannot be retargeted to evade office isolation; valid changes use an attributed workflow operation |
| Responsibility scope | Caller must be authorized for the existing parent assignment/responsibility | Result remains within the same authorized submission/assignment; classification/scope changes follow the append-only revision process |
| Role grants | Caller must be authorized to perform the specific grant-management operation on the existing grant | Caller cannot self-grant, elevate a role, or create a grant outside the approved grant process; unconfirmed privileged-grant authority fails closed |
| Office memberships | Caller must be authorized for the existing membership administration operation | Result cannot transfer or create membership outside approved administration; effective membership scope is checked for subsequent actions |
| Official actor attribution | A role must not receive general update access to an official response/decision row | Actor, membership, and grant attribution cannot be rewritten; official records are immutable and follow-up is separately appended |

These are conceptual responsibilities, not executable policy syntax. The preferred baseline is to deny direct client `UPDATE` for authoritative workflow and identity/authorization records, and expose narrowly scoped operations instead.

### 5.2 Policy matrix by resource group

`SELECT`, `INSERT`, `UPDATE`, and `DELETE` below describe the desired policy outcome, not executable SQL. “Scoped select” follows Section 4; “checked insert/action” requires an authorized operation and server-derived actor. These group rows inherit the most restrictive resource-level condition in Section 4; grouping never broadens access. In particular, `document_types` administration is denied unless catalog administration is explicitly assigned, and role-grant changes remain subject to the unresolved, fail-closed governance rule in Sections 2.1 and 4. RLS alone cannot enforce every cross-table or historical invariant or restrict columns on an otherwise readable row.

| Tables / logical group | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `profiles` | Self; narrowly scoped Admin identity administration; minimal actor display data only through authorized projections | Trusted identity provisioning only | Limited self-service or Admin account operation; never trust role-like profile values | Deny |
| `role_grants` | Self/admin scope, subject to column minimization | Trusted `user` provisioning or explicitly approved privileged-grant process; self-grants denied | No direct grant edits; revocation/end requires specifically authorized, attributed process | Deny |
| `offices`, `office_memberships` | Approved office directory projection; self/Admin membership scope | Admin checked operation only within the approved office/membership authority | No direct membership edits; revocation/end is attributed history | Deny |
| `submissions` | Owner, authorized Officer, or exact assigned-office scope; Admin excluded by default | Owner's checked submission operation | Deny general direct table update; checked owner/Officer operations only | Deny |
| `document_types` (optional) | Approved catalog projection only | Deny unless catalog administration is explicitly assigned; if assigned, Admin uses a checked operation | Deny unless catalog administration is explicitly assigned; if assigned, Admin uses a checked operation | Deny deletion while referenced |
| `submission_versions`, `attachments`, `submission_version_attachments` | Parent submission and exact version/assignment scope | Checked submission/version/attachment operation | Deny mutation of versions or referenced links | Deny except a separately approved, safe cleanup process for unreferenced objects; Storage is deferred |
| `routing_rounds`, `office_assignments`, `office_assignment_events` | Officer scope; assigned members see only their office assignment; submitter gets only approved progress projection | Officer-only checked routing action | Deny direct state rewrite; append attributed lifecycle events | Deny |
| `office_responsibilities`, `office_responsibility_revisions`, `office_responsibility_events` | Officer or exact assigned responsibility; limited submitter projection | Officer-only checked assignment/revision action | Deny in-place revision/history mutation | Deny |
| `responsibility_resolutions` | Officer scope; other visibility only as an approved projection | Officer-only, conditional checked operation; never for mandatory substitution | Deny; append an event for later invalidation if approved | Deny |
| `review_cycles`, `review_cycle_events` | Officer or exact assigned office; submitter receives only allowed progress view | Checked workflow operation authorized for the cycle creation/transition | Deny direct retargeting/status edit | Deny |
| `review_responses`, `review_response_attachments` | Officer and authorized office queue; submitter full-content access is unresolved and not assumed | Assigned member for exact cycle only; unique cycle response enforced transactionally | Deny; follow-up is a new cycle/response | Deny |
| `tourism_officer_response_reviews` | Authorized Tourism Officers; other roles only if a visibility policy is explicitly approved | Officer-only checked append | Deny | Deny |
| `response_applicability`, `response_applicability_events` | Authorized Officer scope | Officer-only checked confirmation/invalidation | Deny; append history | Deny |
| `submission_decisions`, `submission_status_history` | Owner-safe projection, authorized Officer, exact assignment-progress projection only | Officer decision or trusted transition operation, respectively | Deny direct edits | Deny |
| Typed decision-evidence links | Same parent decision scope and linked evidence scope | Checked decision operation only | Deny | Deny |
| `message_threads`, `thread_participants`, `messages`, `message_attachments` (optional) | Current parent authorization plus message class/participant policy | Checked message/participant operation when enabled | Deny silent history edits; participation revocation is attributed | Deny |
| `notifications`, `notification_deliveries`, `notification_delivery_attempts` (optional) | Recipient-only notification view; delivery data restricted to trusted operations | Trusted event/delivery operation | Recipient read marker or delivery state only through scoped checked operation | Deny client deletion |
| `audit_events` | Restricted role/resource-scoped audit view | Trusted workflow operations only | Deny | Deny |
| `idempotency_keys` | Actor's own limited key/result view | Checked operation only | Same operation's atomic state progression | Deny direct deletion |
| `system_settings` (optional) | Allowlisted public settings or Admin configuration scope | Admin checked operation | Admin checked allowlisted configuration operation | Deny generic delete |

Direct table grants and column privileges must match these outcomes. A view or checked operation used to expose a safe projection must enforce the same row scope and omit restricted fields; it must not grant a broader path than the underlying resource rule.

### 5.3 Relationship predicates and RLS recursion

The eventual policies should reason over database-authoritative relationships, not client identifiers:

- `auth.uid()` establishes the authenticated Supabase Auth identity. Resolve it to the caller's `profiles` row through the approved identity relationship.
- Ownership checks compare the stored submitter relationship to that resolved profile.
- Officer checks require a currently active `approver` grant and the operation/resource's applicable workflow authority.
- Office checks require the caller's active `external_approver` grant, an active membership to the assignment's office, and a relationship from that assignment to the requested responsibility/cycle/submission.
- The child row must remain consistent with its parent submission, assignment, responsibility, version, and revision. Stage 3 calls for composite references or equivalent transaction validation because ordinary foreign keys prove existence, not same-submission consistency.
- Cross-table final-readiness checks, active-cycle/effective-basis exclusivity, terminal decision rules, and membership validity at action time require a checked transaction, not only a row predicate.

Avoid policies that recursively query the same RLS-protected table through a helper or through another policy path. Prefer simple nonrecursive predicates where possible. If a helper is necessary, use a narrowly scoped, reviewed function with a fixed safe `search_path`, schema-qualified references, no caller-selected actor identity, and minimal returned information. Any definer helper's owner, ability to bypass RLS, EXECUTE grants, and nested table access must be reviewed as part of the effective policy. Errors or ambiguous lookups deny access.

### 5.4 Append-only and authorization context

RLS `USING`/`WITH CHECK` rules do not by themselves make historical records immutable. The design must also deny direct UPDATE/DELETE through grants and expose only checked append operations. Stage 3's proposed `review_responses`, `tourism_officer_response_reviews`, `submission_decisions`, status history, domain events, and audit events retain historical evidence. Actor references to revoked grants or ended memberships may be preserved for historical attribution, but those records do not authorize new operations.

Do not treat broad authenticated `UPDATE` on a parent table as a safe substitute for action-specific transition controls. Prevent ownership transfer, role escalation, membership changes, assignment retargeting, response edits, and decision edits through ordinary client updates.

### 5.5 Database enforcement responsibilities

The final schema and operation design must assign each invariant to an appropriate database enforcement layer. These are responsibilities for Stage 5 design, not approval of specific schema objects:

1. **Declarative constraints** enforce local and referential integrity: primary and foreign keys, uniqueness, check constraints, and referential actions. Use them for invariants expressible over the relevant row/key relationships, including duplicate official responses for the same review cycle. Constraints do not replace authorization or multi-row workflow validation.
2. **Transactional database operations** enforce authorized multi-row transitions and invariants that must be checked atomically. This includes official response submission, overall submission decisions, reassessment and applicability changes, final-readiness checks, and atomic recording of required status/domain/audit events. Operations must derive the actor from the authenticated context, validate current grants and scope, and handle concurrent attempts without duplicating effective outcomes.
3. **Triggers** may be considered only for narrowly justified integrity or audit purposes. They must not silently replace explicit operation-level authorization checks, trust caller-supplied actor identities, or become a privilege-escalation or RLS-bypass mechanism. Any future trigger design must document its execution identity, privileges, interaction with RLS, and failure behavior.

Do not invent final functions, triggers, constraints, or schema objects here. Stage 5 must map each approved invariant to the final conceptual operation and integrity design before implementation.

## 6. Historical access and revocation

Current authorization and historical evidence serve different purposes:

| Situation | Required design treatment |
|---|---|
| Role grant revoked | The prior grant remains evidence of the authority used at the time of a past action. It cannot authorize new actions. |
| Office membership ended | The historical response may continue to reference that membership as its actor context. The former member does not retain assignment access merely because the response exists. |
| Profile suspended/inactive | Deny new authenticated workflow actions while suspension applies. Exact suspension state, treatment of existing sessions, and effects on reads require an approved lifecycle design; do not infer fields. |
| Historical review response | Preserve it and its actor attribution. Read access is recalculated from current scope and any approved record-visibility policy; history itself is not a permission grant. |
| Assignment completed/cancelled | Do not assume office members retain or lose access to the completed record indefinitely. Define the post-completion visibility/retention rule before implementation; default to no access outside current authorized scope. |
| Superseded submission version | Preserve the version. An office member may read only the version required by a currently authorized cycle unless a separate historical-review rule is approved. |
| Previous message or attachment | Existing participation does not automatically grant continuing access after office membership or assignment authority ends. A new participant's access to pre-membership messages remains unresolved. |
| Audit history | Retain audit evidence per the approved retention policy. Only the actor/role/resource scopes approved for audit viewing can read it; the audit record does not expose the referenced document. |

The plan requires preserved, uneditable history, but does not define a retention period or all historical visibility rules. Do not resolve those policy questions by granting perpetual access to former members or by deleting evidence when access ends.

## 7. Database functions, views, and safe authorization helpers

These are design rules only; no functions, views, grants, or SQL are created here.

1. **Default to `SECURITY INVOKER`.** An operation should run with the caller's database privileges and RLS wherever feasible.
2. **Use `SECURITY DEFINER` only for a documented need.** It must not be a generic “staff” bypass or arbitrary table-write endpoint.
3. For each definer function, require a fixed safe `search_path`, schema-qualified object references, a controlled least-privilege owner, and explicit `EXECUTE` grants to only the necessary database roles. Revoke default/public/anonymous execution unless a concrete, reviewed public use case requires it.
4. Derive the actor from the authenticated request context (for example `auth.uid()` resolved through the approved profile mapping). Never trust a function argument as the acting profile, role, membership, or grant.
5. Validate every actor grant and scope inside the operation, at the time of the operation. Validate that profile, role grant, membership, office, assignment, responsibility, version, and cycle all agree.
6. Validate workflow state and mandatory guards atomically with the mutation. Append the domain event and required audit/status event in the same transaction. Use locking or equivalent concurrency control for one-response-per-cycle and effective-basis/decision invariants.
7. Keep return values minimal. Do not reveal whether an inaccessible submission, user, office, message, or attachment exists. Return a generic not-found/forbidden result where appropriate, while recording safe operational diagnostics server-side.
8. Avoid RLS recursion. Do not build a helper that queries a protected table and silently depends on the same policy being evaluated. Review helper ownership and RLS behavior explicitly; do not assume `SECURITY DEFINER` is a safe workaround.
9. Views should not become an accidental privilege escalation. Select only required fields, preserve caller security semantics, and do not expose private notes, storage references, broad audit data, or cross-office rows through a view that bypasses underlying checks.
10. Do not grant the service-role credential to the browser or use it for ordinary user-specific reads/writes. If server-side privileged access is unavoidable, the server must independently authenticate and authorize the actor and tightly scope the operation.

Any later SQL design must document effective grants for `anon`, `authenticated`, and any operational database role actually used. Do not assume historical TEST grants remain current or that local migration files represent deployed state.

## 8. Next.js and Supabase application boundary

- Use the server-side Supabase client/session for protected data access and privileged workflow actions. Verify the current session on the server for each action; client route middleware is not an authorization boundary.
- Check the active role grant and resource scope on the server before returning sensitive content or invoking a mutation. Then rely on database grants/RLS/checked operations to repeat the decisive resource check.
- Protect server actions and API routes individually. A hidden button, layout-level gate, guessed ID, altered request body, or direct Supabase call must not bypass the database boundary.
- Use the repository's generated Supabase client/database types when implementation begins; do not accept caller-controlled role/profile identifiers just because a type permits them. Do not invent Stage 3 database types before schema approval.
- Never expose `service_role` or other privileged credentials in browser bundles, client components, public environment variables, logs, URLs, or error messages.
- Keep error messages safe: do not disclose the existence or contents of another user's submission, another office's assignment, a private note, or an inaccessible attachment. Preserve actionable server-side diagnostics without leaking secrets or personal/document content.
- For actor attribution, derive the actor from the verified session on the server/database. Never let a client choose a different `submitted_by`, Officer, membership, or approver grant.
- Separate frontend convenience checks (for example, enabling an action only when a response is pending) from authoritative server/database validation. Recheck state at commit time to handle stale pages and concurrent actors.
- For mutations, treat failures as failures. Do not silently fall back to direct table updates or success-shaped responses if a checked operation is unavailable.

## 9. Attachments and Storage boundaries — DEFERRED / PROVISIONAL

Stage 3 defers actual Storage policies, bucket design, and offline approval evidence. This section states only conceptual boundaries; it does **not** design or authorize Storage policy changes.

- Attachment metadata and file access must follow the authorization of the exact parent submission/version/response/message resource.
- A guessed storage path, attachment ID, public-looking URL, or knowledge that a file exists does not authorize reading it.
- Upload, download, and deletion are separate permissions; authorization for one does not imply the others.
- Any future signed URL must be short-lived, resource-scoped, generated only after current authorization, and handled as a bearer capability. Exact URL policy is deferred.
- Do not broaden staff or Admin access to files through a generic staff predicate.
- Do not inspect, migrate, or change existing buckets, `storage.objects` policies, file paths, or offline evidence as part of this design.

**Status:** Deferred pending separate institutional consultation and explicit authorization. No Storage or offline-evidence implementation is specified here.

## 10. Security test matrix

Tests below are future validation requirements, not tests run in this documentation task. RLS tests should use authenticated database sessions/claims representative of each actor; application tests should exercise server actions/routes independently of the visible UI. For each denied case, verify no row/content is returned and no mutation/history side effect occurs.

| Scenario | Expected result | Primary validation layer |
|---|---|---|
| Anonymous select of private submissions, profiles, assignments, messages, or audit | Denied; no content returned | Database RLS/grants and application route |
| Anonymous invoke of privileged workflow operation | Denied by EXECUTE grants and actor checks | Database grants/function authorization |
| Authenticated direct table/PostgREST read requests a restricted column on an otherwise readable row | Restricted field is unavailable; safe projection remains within the same row scope | Database grants/column privileges or controlled view, plus application |
| Submitter reads own submission/status and permitted related information | Allowed only within approved sender view | RLS and application |
| Submitter changes a client-supplied owner/profile ID to another person | Denied; actor is derived from session | RLS/checked operation and application |
| Submitter requests another user's submission by guessed ID | No data or existence disclosure | RLS and application |
| Assigned office member reads its relevant office responsibility and exact review version | Allowed when role and membership are both active | RLS and application |
| Office member reads unrelated office assignment or another office's attachment | Denied | RLS and Storage boundary when separately designed |
| One person belongs to two offices | Can access only assignments of each currently active membership, separately checked | RLS |
| Office member lacks active `external_approver` role or current membership | Cannot read restricted assignment or submit response | RLS and checked operation |
| Revoked membership is used for a new response | Denied; prior response attribution remains intact | Checked operation and RLS |
| Revoked `approver` grant is used for routing, response review, reassessment, or decision | Denied | Checked operation and RLS |
| Multiple authorized representatives view shared assignment | Each may read only that office's authorized scope | RLS |
| Two representatives concurrently submit a response for the same cycle | At most one succeeds; the other receives a safe conflict result; no duplicate response | Transaction/unique invariant and RLS |
| External approver attempts a response for another office/responsibility/cycle | Denied | RLS and checked operation |
| External approver attempts an overall decision, sender return, reassessment, or office routing | Denied | Database grants/operation and application |
| Tourism Officer performs authorized routing, response review, sender return, reassessment, or overall decision | Allowed only with active `approver` grant, correct scope/state, and actual actor attribution | RLS and checked operation |
| Admin manages a user/office membership but requests document content | Admin operation may succeed; content request remains denied absent separate valid workflow role/scope | RLS and application |
| Admin attempts to approve as Admin only | Denied | Database operation and application |
| Admin also holds a valid `approver` grant and acts as Officer | Allowed only under the separate Officer grant and applicable scope; actor recorded as that person | RLS and checked operation |
| Unauthorized attachment ID/path or signed URL is used | Denied; no Storage policy change is implied by this design | Application; future Storage/RLS tests |
| Client attempts to update/delete a historical response, decision, event, or audit row | Denied | Grants/RLS and operation design |
| Cross-submission IDOR through a version, responsibility, cycle, evidence link, message, or attachment | Denied even where each individual foreign ID exists | Composite integrity, RLS, transaction checks |
| Client attempts role grant, membership, owner, office, or assignment-scope escalation | Denied; only authorized checked Admin/Officer action may change applicable relation | RLS and checked operation |
| Unauthorized actor targets an existing row for direct UPDATE | Rejected because the existing row fails the applicable `UPDATE USING` condition | Database RLS/grants |
| Otherwise authorized actor changes a row into another user's, office's, assignment's, or responsibility's scope | Rejected because the resulting row fails `UPDATE WITH CHECK`; authoritative scope changes use a checked operation | Database RLS/grants and operation |
| User attempts to grant any role to themselves | Denied, including through direct database/PostgREST calls | Database grants/RLS/operation and application |
| Actor without confirmed authority attempts to grant or revoke `approver` or another privileged workflow role | Denied; unresolved governance fails closed | Database operation and application |
| Actor attempts to revoke another user's role grant without the approved authority | Denied; grantor and affected user remain auditable | Database operation and application |
| Client calls a direct PostgREST write path to bypass a hidden/disabled frontend action | Denied by database grants, RLS, and checked-operation boundary | Database |
| Authenticated caller invokes a database function without an authorized EXECUTE grant | Denied | Database privilege test |
| SECURITY DEFINER function has an unsafe owner, broad bypass behavior, unsafe search path, or excessive EXECUTE grants | Fails security review; no bypass or unauthorized access is permitted | Database catalog/privilege and negative tests |
| Access after assignment completion/cancellation or reassessment | Follows approved current/historical visibility rule; absent approval, former membership does not grant access | RLS plus policy-specific application test |
| Reassessment reuses an earlier response without explicit Officer applicability confirmation | Denied; prior response remains unchanged | Checked operation and transaction invariant |
| Final approval with an unapproved/denied mandatory response or missing required response | Denied; evaluation/recommendation negative outcome alone is not an automatic veto | Transactional readiness guard and RLS |
| Private staff note read by submitter, unrelated office, or Admin solely by Admin role | Denied | RLS and application |
| Notification IDOR | Recipient can read only their notification; other recipient rows denied | RLS |
| Service-role client is imported/exposed in browser code | Build/security check fails; privileged credential is never delivered | Application/build review |

### 10.1 Database-level authorization tests

These are proposed database validation cases and have not been executed. Use authenticated database/PostgREST contexts and isolated fixtures:

| Scenario | Expected result |
|---|---|
| Authenticated direct table/PostgREST read requests a restricted column on an otherwise readable row | Restricted field cannot be retrieved; only an approved safe projection is available |
| Unauthorized caller attempts UPDATE on an existing row outside their scope | Rejected by the existing-row `UPDATE USING` condition |
| Caller changes an otherwise editable row into an unauthorized owner, office, assignment, or responsibility scope | Rejected by the resulting-row `UPDATE WITH CHECK` condition |
| User attempts a direct self-grant | Denied; no grant is created or modified |
| Actor without confirmed authority attempts to grant `approver` or another privileged workflow role | Denied; unresolved governance fails closed |
| Actor without approved grant authority attempts to revoke another user's role grant | Denied; grantor and affected-user attribution remains auditable |
| Client attempts a direct PostgREST write that bypasses frontend controls | Denied by grants, RLS, or the checked-operation boundary |
| Authenticated role attempts EXECUTE on a function without an authorized grant | Denied |
| SECURITY DEFINER ownership, RLS-bypass behavior, `search_path`, and EXECUTE grants are inspected/tested | No unsafe owner/bypass or excessive execution path is accepted |
| Two authorized office members concurrently submit an official response for one review cycle | At most one response is recorded; the other operation fails safely without partial history |

### 10.2 Application-level authorization tests

These tests exercise server actions and API routes independently of the visible UI. They are proposed cases and have not been executed:

| Scenario | Expected result |
|---|---|
| User attempts a self-grant through a server action or API route | Denied; no role grant is created or altered |
| Actor without confirmed authority attempts to assign a privileged workflow role | Denied; the unresolved grant process fails closed |
| Actor without approved authority attempts to revoke a privileged role through an application route | Denied; the actual grantor and affected user are retained for audit |
| Request forges a profile, grant, membership, or other actor identifier | Ignored or rejected; actor is derived from the authenticated session and actual attribution is preserved |
| Admin attempts a workflow action without an explicit active `approver` grant | Denied; Admin authority alone is insufficient |
| Caller attempts to retrieve restricted document fields | Restricted fields are not returned, even if a safe projection of the record is available |
| Caller attempts to modify submission ownership or office/assignment/responsibility scope | Denied; only the appropriate checked workflow operation may change an authorized relationship |

## 11. Security risks and open decisions

### 11.1 Risk register

| Risk | Example failure/attack | Impact | Recommended mitigation | Validation | Status |
|---|---|---|---|---|---|
| Role confusion or client-selected actor | Client supplies an Officer profile/grant ID | Privilege escalation or false attribution | Derive actor from authenticated identity; check active grant server/database side | Tampered request tests; effective EXECUTE/grant audit | Defined design; implementation unverified |
| Cross-office IDOR | A member swaps an assignment/submission ID | Confidentiality breach | Require active exact-office membership plus assignment/responsibility linkage for every child read/write | RLS negative tests across two offices | Defined design; office authority mapping open |
| Admin content bypass | Broad `admin` predicate grants all document/message access | Confidentiality breach and authority confusion | Separate admin resources from workflow resources; no broad RLS bypass | Admin-only content denial tests | Workflow boundary agreed; exact oversight visibility unresolved |
| Stale/revoked authority | Old membership or role grant permits new response | Unauthorized workflow action | Check current active grant/membership for every new action; preserve historical references separately | Revoke then retry test | Defined design; lifecycle representation provisional |
| Direct table update bypass | Client modifies status, ownership, response, or decision | Workflow skip/history corruption | Deny broad direct writes; checked operations; transactional guards | Direct REST/PostgREST mutation tests | Defined design; existing TEST grants are historical and need reinspection |
| SECURITY DEFINER escalation/recursion | Unsafe search path or broad EXECUTE helper bypasses RLS | Cross-user access or escalation | Invoker default; tightly constrained definer only with safe path, minimal owner, explicit grants, identity/scope checks | Function-owner/search-path/EXECUTE audit and negative tests | Defined design; no functions reviewed or created here |
| Permissive policy interaction | A broad policy ORs with a narrow policy | Unexpected rows become readable | Review complete effective grants/policies, not isolated policy text | Catalog/policy test matrix on approved environment | Defined; deployed state unknown |
| Mutable history or forged attribution | Client edits response/decision or deletes audit row | Loss of accountability | Append-only model, no client UPDATE/DELETE, event writes in same transaction | Mutation-denial and atomicity tests | Agreed history requirement; technical enforcement provisional |
| Race/duplicate office response | Two office members submit simultaneously | Multiple conflicting official outcomes | Unique cycle response plus transaction/concurrency control | Concurrent test for same cycle | Stage 3 design; schema not frozen |
| Readiness/effective-basis bypass | Stale response or generic resolution satisfies a changed responsibility | Invalid approval | Atomic, responsibility-level readiness check; mandatory response safeguard; explicit applicability only | Positive/negative gate tests across responsibility types | Workflow gate agreed; exact resolution rules unresolved |
| Private note/attachment leakage | Generic staff or Admin access exposes confidential content | Confidentiality breach | Separate content class and parent-resource authorization; no generic staff predicate; Storage deferred | Role/office/attachment negative tests | Visibility principle agreed; detail unresolved/deferred |
| Service-role misuse | Server uses service role for ordinary user query without rechecking scope | RLS bypass, bulk disclosure | Avoid service role for user-scoped operations; independently authorize and constrain necessary server jobs | Code/config scan and IDOR tests | Defined design; implementation unverified |
| Historical access ambiguity | Former office member retains access indefinitely, or legitimate review is blocked | Confidentiality or operational continuity issue | Approve explicit post-completion and historical-visibility rules; do not infer from event history | Revocation/completion/retention tests | Unresolved institutional policy |
| Information leakage in errors/logs | Error reveals inaccessible record or document text | Enumeration or data leakage | Safe generic client errors; restricted server diagnostics | Negative IDOR and log review | Defined design |

### 11.2 Institutional questions

These are policy questions, not technical permission for this document to decide:

1. What document content, if any, may the Tourism Head/Admin see for oversight, and under what audit/approval process? Admin must not have an automatic content bypass.
2. How long do former office representatives retain read access to completed/cancelled assignments, old versions, responses, and messages? Which history is visible after membership removal?
3. Who may authorize role grants and office-membership changes, and what review, suspension/expiry, and revocation controls apply? The Tourism Head/Admin's general system-administration responsibility does not establish authority to issue privileged workflow grants or resolve office-membership governance.
4. What is the approved access classification for office responses, Tourism Officer response-review notes, and private staff notes?
5. What historical message visibility applies when a participant is added after messages exist?
6. What retention, archival, and deletion rules apply to workflow and audit records?
7. Which, if any, exceptional workflow authorities may be delegated? The plan does not make Admin a workflow approver.
8. Which offices may act on which requirement types? The authority matrix remains open in the workflow plan.
9. What access is permitted for offline approval evidence and Storage objects? This remains deferred pending consultation.

### 11.3 Technical questions

- Freeze the Stage 3 identity relationship from Auth identity to profile, and the exact way active, revoked, suspended, or expired role grants and memberships are represented.
- Resolve the Stage 3 recommendation of one response per responsibility review cycle against the canonical plan's “one official decision per active assignment” wording. The current model is a recommended design, not an institutional approval.
- Decide which existing workflow model or data-preserving reconciliation will support RLS predicates; Phase 2 reports overlapping models and does not select a canonical one.
- Define safe read projections for submitters and assigned office members so row-level access does not expose unnecessary columns or internal notes.
- Determine whether and how any existing RLS helper can avoid recursion without creating an unsafe definer bypass.
- Define action boundaries, concurrency/idempotency, and atomic audit/history behavior for role changes, assignment changes, responses, reassessment, applicability, and overall decisions.
- Confirm which database roles are used for application sessions, trusted operations, workers, and migrations before writing grants. Do not infer this from historical TEST findings.
- Specify safe operational audit access and diagnostic retention without adding a new workflow role.

## 12. Implementation readiness and sequence

### Sufficiently defined for later implementation

- Distinguish authentication from authorization and bind actions to the actual authenticated person.
- Use only the four workflow roles already defined; keep roles additive and separate Admin system administration from Tourism Officer authority.
- Require exact-office membership and assignment/responsibility scope for office access.
- Enforce least privilege and default deny at both application and database layers.
- Keep submitter access tied to ownership; office access tied to relevant assignments; do not grant universal office or Admin document access.
- Preserve actor attribution and historical records; revoked authority cannot authorize new actions.
- Deny direct client mutation of authoritative workflow history and require checked operations for privileged workflow transitions.
- Keep offline evidence and Storage policy implementation deferred.

### Requires Stage 3/model clarification or schema approval

- Confirm the Auth-to-profile identity relationship, role-grant/membership lifecycle representation, and all referenced authorization context.
- Reconcile response cardinality and entity relationships before deciding exact RLS predicates.
- Select/reconcile the existing workflow model and status/assignment relationships without data loss.
- Approve table/column privileges, RLS policy groups, trusted operation boundaries, and safe projections against the final schema.
- Resolve lifecycle support for suspension/expiry and exact post-revocation behavior.
- Establish atomic operations for readiness, one-response-per-cycle, same-submission integrity, and audit attribution.

### Requires MTO/dean or other institutional confirmation

- Who may authorize and grant Tourism Officer (`approver`) authority, including the process for granting and revoking it.
- Whether an Admin may grant privileged workflow roles to another person. Until confirmed, no unconfirmed actor may issue such grants.
- Admin oversight visibility to confidential document/message content.
- Historical visibility after membership removal, assignment completion, or reassessment; record retention.
- Who may create, modify, and revoke office memberships, and which actions require an independently authorized process.
- Visibility of internal review notes and private messages to submitters, office representatives, Admin, and other staff.
- Office authority, role/membership grant controls, message/private-note visibility, and any exceptional delegated workflow authority.
- Office-response granularity relative to assignment-level language; workflow path meanings and exact state semantics where they affect access.
- Offline evidence and Storage access/retention policies.

### Must remain deferred

- All Storage bucket/object policy changes, file-access implementation, signed-URL rules, and offline-evidence design.
- Any database function, RLS policy, grant, migration, application code, or live TEST/Production change.
- Any claim that Phase 2's historical TEST observations prove the current database state.

### Preconditions before writing RLS SQL

1. Obtain approval of the role/office-authority/status matrix and unresolved visibility decisions affecting the selected implementation.
2. Review and approve the Stage 3 relational model, including its response-cardinality and history relationships.
3. Perform the roadmap's read-only reconciliation of existing workflow structures before selecting a canonical model or planning data changes.
4. Inventory the actual target environment, object owners, grants, RLS state, functions, and effective policies using a separately authorized read-only inspection. Verify the target is TEST before any TEST access; Production remains out of scope absent separate authorization.
5. Decide the database roles and server credential boundaries. Do not use service-role access as a user authorization substitute.
6. Design grants, RLS predicates, mutation operations, and transactional invariants together; review all permissive policies and definer helpers as one effective access surface.
7. Prepare positive, negative, concurrency, revocation, IDOR, and immutable-history tests with isolated fixtures and no real notification recipients.
8. Obtain explicit authorization for implementation, migrations, and any database changes. This document is not that authorization.

### Recommended future sequence

1. Resolve applicable institutional role, office, history-visibility, and status decisions without reopening settled workflow rules.
2. Complete read-only model reconciliation and approve the canonical relational/access contract.
3. Specify least-privilege PostgreSQL grants and server/client access paths for the approved model.
4. Design and review RLS per resource group, with safe helpers/views only where needed.
5. Implement checked operations and transactional invariants only after approval.
6. Test RLS and application authorization independently and together, including all negative and concurrency cases.
7. Apply changes only to an explicitly authorized isolated TEST target; verify deployed metadata read-only afterward. Do not access Production.

**Readiness:** This document is a design input for human review, not an implementation-ready policy set. The schema is not frozen, no policy is approved or deployed by this document, and no database changes are authorized.
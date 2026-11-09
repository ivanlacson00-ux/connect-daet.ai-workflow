# CONNECT-Daet.ai — Stage 5 Database Operations and Transaction Integrity Design

**Status:** Proposed conceptual operation design; documentation only; not approved or implemented
**Workflow authority:** [Revised workflow plan](./REVISED_WORKFLOW_PLAN.md)
**Supporting evidence:** [Phase 2 gap analysis](./PHASE_2_WORKFLOW_GAP_ANALYSIS.md), [Phase 2 implementation roadmap](./PHASE_2_IMPLEMENTATION_ROADMAP.md), [Phase 2 workflow decision mapping](./PHASE_2_WORKFLOW_DECISION_MAPPING.md), [Stage 3 relational model](./PHASE_3_RELATIONAL_MODEL_AND_INTEGRITY_SPECIFICATION.md), and [Stage 4 authorization and RLS design](./PHASE_4_AUTHORIZATION_AND_RLS_DESIGN.md)

> This is a conceptual transaction and operation specification, not SQL or an implementation blueprint. The Stage 3 schema is not frozen, no function names or signatures are approved, and this document authorizes no application, database, migration, TEST, or Production change.

## 1. Foundations and design status

### 1.1 Relationship to prior stages

| Source | Authority in this design | Boundary |
|---|---|---|
| Revised workflow plan | Source of truth for intended behavior and role responsibilities | Its explicitly open questions are not approved requirements. |
| Phase 2 audit, roadmap, and decision mapping | Historical repository/TEST evidence, identified gaps, and proposed sequencing | Historical TEST observations and local files do not establish current deployed state or select a canonical schema. |
| Stage 3 relational specification | Proposed entities, relationships, and integrity model | Names and cardinalities remain proposed; the response-per-cycle model is a recommended design pending institutional confirmation of assignment-level wording. |
| Stage 4 authorization design | Proposed application/database authorization boundary and least-privilege controls | It is not a deployed policy. Unresolved grant governance and implementation-specific privileges remain blockers. |
| Stage 5 | Describes logical operation contracts, transaction boundaries, consistency, concurrency, retries, event recording, and validation | Does not define executable SQL, functions, columns, RPC signatures, triggers, or migrations. |

### 1.2 Decision classifications

- **Agreed workflow:** The Tourism Officer (`approver`) controls initial review, office selection, responsibilities, routing mode, response review, reassessment, formal sender returns, and overall decisions. Admin is a system administrator, not an automatic approval stage. The workflow plan's responsibility-type semantics, mandatory safeguards, versions, and historical preservation remain authoritative.
- **Accepted project-design decision:** The final-review readiness gate requires every active responsibility to have an official response or a valid permitted resolution. Mandatory approval requires an approved official office response. Evaluation and recommendation require responses, and negative outcomes are not automatic vetoes. A validly cancelled responsibility is excluded only when safeguards hold. This working design is not proof of formal MTO approval.
- **Recommended technical design:** Treat an office assignment as a container for multiple responsibilities; bind an official response to one responsibility review cycle and its exact version and revision; append history; perform multi-record decisions atomically; and make requests idempotent.
- **Provisional:** Any operation details depending on Stage 3 entities, lifecycle projections, active-cycle semantics, or a proposed response-per-cycle constraint remain subject to model approval and reconciliation with existing data.
- **Unresolved institutional decision:** Any policy assigned to MTO/dean or other institutional review below must remain open. No contract may resolve it by technical convenience.
- **Deferred:** Storage bucket/object policy, signed URLs, offline approval evidence, and related retention/access rules remain outside scope. External messaging providers and points/rewards are not implemented here.

### 1.3 No implementation authorization

No schema, workflow model, authorization policy, operation API, or event vocabulary is frozen by this specification. It creates no database object and grants no permission to connect to Supabase, run SQL, edit application code, migrate, deploy, or access Production. Before implementation, the team must complete Stage 3/model reconciliation, approve the applicable institutional decisions, and approve a concrete Stage 4 privilege and operation design.

## 2. Transaction design principles

### 2.1 Properties and operational meaning

| Principle | Required behavior |
|---|---|
| Atomicity | Every required database mutation in one logical workflow operation commits together or none of them do. No response without its required history, no decision without required status history, and no partial reassessment. |
| Consistency | Every committed operation preserves identity, parentage, role, office, version/revision, mandatory-readiness, lifecycle, and history invariants. |
| Isolation | Concurrent operations cannot both commit outcomes that violate an invariant. Use the narrowest concurrency protection sufficient for the invariant; do not assume all operations require serializable isolation. |
| Durability | Once a database transaction commits, its authoritative workflow records and required in-database event/notification intent survive a lost client response. |
| Narrow boundary | A transaction contains one business operation and only the rows/resources required to complete it. Do not combine unrelated workflows or external network calls in a database transaction. |
| Fail closed | Missing identity, ambiguous or stale authority, inaccessible parent, invalid state, or uncertain invariant check causes denial and no partial business mutation. |
| Idempotency | A valid retry of the same logical request returns the prior safe result rather than creating duplicate business records. Same key with a different canonical request is rejected. |
| Authoritative validation | Revalidate actor, current role/membership, scope, state, and target context at the protected operation boundary. Frontend validation and hidden controls are not database integrity. |
| Explicit attribution | Derive the actor from the trusted authenticated context. Never accept caller-supplied profile IDs, role grants, or membership IDs as proof of the acting identity. |
| Append-only evidence | Preserve prior versions, official responses, Officer reviews, decisions, status transitions, and audit evidence where the approved model requires history. Corrections are new attributed records/events, not silent rewrites. |

### 2.2 Logical operation boundary

A logical operation is one user- or system-requested business outcome with an explicit authorization check, precondition set, atomic write set, event set, and result. For example, “submit official response for this cycle” is one operation; updating a review status, inserting a response, and recording its required domain and audit events are not independent success steps.

All mandatory database writes and transactional validations for that operation share one transaction. If any mandatory check, constraint, or required history write fails, the operation rolls back completely. For workflow events that the plan requires to notify the submitter, recording notification intent and recipient is a required database write in that same transaction; an unresolved channel, provider, delivery timing, or retry policy does not make that intent optional. Other notification events remain subject to approved event-recipient policy. External email/SMS delivery is post-commit and is never part of the workflow transaction.

An external object/file upload cannot be assumed to participate in a PostgreSQL transaction. Store and validate the uploaded object separately from database submission/version/attachment metadata. The submission must not enter a submitted workflow state if required attachment metadata or validation fails. An uploaded object left unreferenced after database rollback may require separate orphan cleanup; that recovery and all Storage authorization remain deferred.

### 2.3 Validation order

As applicable to the operation, conceptually:

1. Authenticate from the trusted server/database context and resolve the actor profile.
2. Check the actor's current role grant and, for office work, the current membership in the assignment's exact office.
3. Load and authorize the target resource through its database relationships; do not reveal inaccessible resources.
4. Acquire the required lock or verify an optimistic version/state token.
5. Re-read state and recheck all predicates that could have changed while waiting.
6. Validate workflow state, exact submission/version/responsibility/revision relationships, mandatory safeguards, and concurrency invariants.
7. Apply the operation's records, projection changes, and required domain/status/audit/notification-intent writes atomically.
8. Commit, then return a minimal result. Any delivery work proceeds after commit.

The precise ordering of authentication and locks is an implementation concern, but resource-specific authorization and state checks must not be bypassed by stale pre-transaction reads.

## 3. Workflow invariants

These are operation-level invariants, not proposed columns or final constraint definitions.

### 3.1 Submission and version integrity

- Each submission has one identifiable submitter resolved through the approved identity relationship.
- Submission identity is stable. A corrected upload or information revision adds an immutable version; prior versions and decisions are not overwritten.
- A review cycle targets exactly one submission version and one responsibility revision, both belonging to the same submission and logical responsibility.
- Every child/resource relationship is validated against its parent. A valid individual ID does not prove that two records belong together.
- The initial submission path enters Tourism Officer review. It does not route directly to an office based only on document type, category, destination, or inferred rules.

### 3.2 Routing and office assignment integrity

- Every submission first goes to the Tourism Officer.
- The Tourism Officer alone selects additional offices, the responsibilities assigned to each, and routing mode. Office suggestions never create assignments.
- No automatic routing based solely on document type is allowed.
- Simultaneous routing means selected office work may proceed independently. One-at-a-time routing means the Tourism Officer reviews a response and explicitly decides whether to assign the next office. These are distinct modes; the system never forwards office-to-office automatically.
- The Tourism Officer may add an office during ongoing simultaneous reviews. Adding work must not cancel, supersede, or block already active office cycles or responses unless an explicit authorized change targets them.
- An assignment is a container and may contain several independently classified responsibilities with distinct outcomes.
- Assignment creation, change, cancellation, and responsibility revision preserve actor, authorization context, reason where required, timestamp, and prior state.
- An office recommendation to involve another office is input for the Tourism Officer; it is not authorization to create a route.

### 3.3 Responsibility and readiness integrity

- Mandatory Approval / Clearance is satisfied only by an approved official response from the assigned office for the applicable target context.
- An unresolved or denied mandatory requirement blocks overall approval. It cannot be bypassed by downgrading its type, generic resolution, or cancellation.
- Evaluation / Verification requires a submitted evaluation. A negative evaluation is not by itself a veto.
- Recommendation requires a submitted advisory recommendation. A negative recommendation is not by itself a veto.
- A nonmandatory responsibility may be closed without a response only under an explicitly permitted and confirmed exception. A generic resolution is not a shortcut around required office work. Active Evaluation and Recommendation responsibilities require official responses and cannot be satisfied by substituting a resolution.
- Every active responsibility must have an official response or a valid permitted resolution before final review. Evaluation and Recommendation require responses; Mandatory Approval / Clearance requires an approved official response. Legitimate cancellation is a separate, explicitly authorized operation, not a resolution or response substitute; only cancellation permitted under approved safeguards may remove a responsibility from the active gate. No unapproved exception may weaken these requirements.
- Readiness is evaluated for the effective target context per responsibility, not by counting assignments or batches.

### 3.4 Review-response integrity

- A review cycle is bound to the exact submission version and responsibility revision being reviewed.
- Stage 3 recommends one official response per responsibility review cycle, with actual representative, office membership, external role grant, outcome, and timestamp. This remains a technical recommendation pending MTO clarification of the canonical “one official decision per active assignment” wording.
- No assignment-wide response uniqueness rule is introduced. One response cannot satisfy multiple unrelated cycles.
- Concurrent duplicate response attempts cannot both succeed.
- Office responses are responsibility outcomes, never overall submission decisions.
- Reassessment preserves old response records and creates responses only for cycles actually reassessed.
- Optional batching, if later pursued, groups individual cycle-level responses; it cannot change their authorization attribution or duplicate readiness counts.

### 3.5 Final-review and decision integrity

- The Tourism Officer is the only workflow role that makes the overall decision. Office representatives cannot approve, return, or reject the overall submission.
- Final review must evaluate all active responsibilities under the gate above, not merely whether mandatory assignments are approved.
- Mandatory approval is required for overall approval. A denied or unresolved mandatory response blocks it.
- Negative evaluation/recommendation findings are not automatic vetoes; the Tourism Officer's overall judgment remains separate.
- Decision is bound to the current valid submission version and the complete effective responsibility basis.
- Decision record, required lifecycle status history, relevant domain/audit evidence, and approved notification intent commit together.
- `APPROVED`/`REJECTED` are decision outcomes; `COMPLETED` is closure and `RETURNED` is correctable. Exact closure conditions and stored lifecycle mapping remain open.

### 3.6 Reassessment and history integrity

- Only the Tourism Officer initiates reassessment and selects affected responsibilities.
- A reassessment establishes a new exact version/revision target for each selected responsibility and preserves prior cycles, responses, decisions, actors, timestamps, and reasons.
- Unaffected prior responses remain usable for the new target only when the Tourism Officer explicitly confirms applicability to that exact version/revision context.
- Applicability references the original response and exact target context; it does not copy, retarget, overwrite, or reactivate the original response.
- Each target context has at most one effective basis among an applicable current response, valid applicability confirmation, or expressly permitted resolution. Superseded cycles and invalidated applicability records do not count.
- Invalidation/supersession is appended as history. No former response is automatically reactivated.

## 4. Conceptual database operation catalog

Names below describe logical operations only. They are not SQL function names, RPC names, endpoint names, signatures, or a final API list. “Actor context” means the trusted actor and current authorization context resolved at execution time, not caller-provided identity values.

### 4.1 Submission, version, and initial screening

#### Operation 1 — Create a draft submission

| Contract element | Design |
|---|---|
| Purpose | Establish a submission owned by the authenticated submitter before initial submission, if a draft state is included in the approved lifecycle. |
| Actor and authorization | Authenticated `user` acting as self; an actor with another role must separately hold `user` capability. |
| Existing context / conceptual input | No existing submission; approved document-type selection and required draft metadata, if applicable. |
| Checks | Resolve submitter from trusted identity; validate allowed input and any approved document-type catalog reference. Never infer routing from type. |
| Atomic effects and evidence | Create the submission and any initial lifecycle history required by the approved state model. A draft must not appear as submitted/under review until the submission operation completes. |
| Concurrency / idempotency | Scope retries to actor and create-draft operation; a retry must not create an unintended second draft. |
| Failure / postcondition | Invalid identity/input or failed constraints leaves no partial submission. On success, the record belongs to the authenticated submitter and has no unauthorized route. Draft semantics are provisional. |

#### Operation 2 — Submit for initial Tourism Officer review

| Contract element | Design |
|---|---|
| Purpose | Submit a complete draft/new submission into Tourism Officer initial review. |
| Actor and authorization | Authenticated submitter who owns the submission. |
| Existing context / conceptual input | Draft submission, required submission information, first version and applicable attachment links. |
| Checks | Ownership; required fields; version and attachment same-submission consistency; no prior successful submit for the same request; valid initial lifecycle state. |
| Atomic effects and evidence | Establish first immutable version and its links; transition to the approved initial-review state; append status/domain history and required audit evidence. Any notification required by the workflow is recorded as intent and recipient atomically; external delivery follows commit. |
| Concurrency / idempotency | Serialize competing submits for the submission or use an expected-state check. Same actor/scope/key and payload replays the prior result; a different payload with the same key is rejected. |
| Failure / postcondition | Failed upload validation or required database write means no submitted state. An independently uploaded object may be left unreferenced if database persistence rolls back; cleanup is a separate deferred recovery concern and must not delete objects referenced by retained versions. Success places the submission in the Tourism Officer queue, never directly in office routing. |

#### Operation 3 — Create/attach a new submission version

| Contract element | Design |
|---|---|
| Purpose | Append a corrected or additional version without replacing historical content. |
| Actor and authorization | Owner only when eligible to submit a correction, or another specifically approved trusted upload action; Tourism Officer coordinates the correction flow. |
| Existing context / conceptual input | Existing submission, expected current version/state, new version content and attachment metadata. |
| Checks | Actor ownership or approved operation authority; correctable/eligible state; version sequence allocation; no cross-submission link; current version has not changed since caller loaded it. |
| Atomic effects and evidence | Append version and typed attachment links; update any current-version projection; append status/domain/audit history as required. Reassessment selection is a separate Tourism Officer operation. External object upload is not part of this database transaction. |
| Concurrency / idempotency | Acquire the submission-level synchronization or compare expected version; unique per-submission version sequencing; use §7.1's operation-scoped idempotency contract to prevent duplicate version records. |
| Failure / postcondition | A failed required database write leaves no partially advanced current-version pointer. An uploaded object may remain unreferenced and require separate cleanup. Success preserves all old versions and returns the submission to the appropriate Tourism Officer review stage. Storage authorization and cleanup are deferred. |

#### Operation 4 — Record initial Tourism Officer screening outcome

| Contract element | Design |
|---|---|
| Purpose | Record initial continuation, correction/clarification request, or initial-review final overall rejection without conflating them. |
| Actor and authorization | Active `approver` grant acting as Tourism Officer for the submission; no `admin`-only authority. |
| Existing context / conceptual input | Submission and exact current version; selected outcome and the reason/instructions required by that outcome. |
| Checks | Current initial-review state, actor grant and scope, valid outcome, required rejection reason, and no already-terminal conflicting decision. Rejection criteria are unresolved and must not be invented. |
| Atomic effects and evidence | Append the outcome/decision as applicable, status history, domain/audit evidence, and—when issuing an initial-review final rejection—the required notification intent addressed to the submitter. Any other notification intent follows its separately approved event policy. Initial rejection must block office routing and final review. |
| Concurrency / idempotency | Acquire the shared submission-level synchronization; recheck lifecycle/version after acquisition; use the operation-scoped idempotency contract in §7.1. |
| Failure / postcondition | Invalid/stale outcome rolls back without status mutation or partial notification intent. Success records the actor and exact version; office routing occurs only through a later explicit Officer operation. |

### 4.2 Routing, assignment, and responsibility operations

#### Operation 5 — Create a routing round

| Contract element | Design |
|---|---|
| Purpose | Record the Tourism Officer's explicit routing mode/action for a submission. |
| Actor and authorization | Active `approver` grant, authorized for the submission. |
| Existing context / conceptual input | Submission/version, selected mode (simultaneous or one-at-a-time), and reason/context if applicable. |
| Checks | Submission is eligible after initial review; exact current version; no initial final rejection; mode is one of the two agreed modes; no automatic type-based derivation. |
| Atomic effects and evidence | Append round and its actor/grant context, plus domain and audit history. Do not create offices/responsibilities unless included in the same explicitly requested assignment operation. |
| Concurrency / idempotency | Acquire the shared submission-level synchronization used by final-review readiness, then recheck submission state and routing revision; prevent stale parallel route edits. Use §7.1's operation-scoped idempotency contract. |
| Failure / postcondition | Invalid state or authority leaves no partial round. Success records an explicit Officer choice while preserving prior round history. |

#### Operation 6 — Assign an office and responsibilities

| Contract element | Design |
|---|---|
| Purpose | Create an office assignment container and one or more distinct responsibilities/revisions. |
| Actor and authorization | Tourism Officer with active `approver` grant. |
| Existing context / conceptual input | Submission, routing round, selected office, responsibility types/scopes/instructions, exact target version where required. |
| Checks | Same-submission round; office authority mapping is approved for the selected requirement; each responsibility has a valid agreed type; mandatory rules cannot be downgraded or bypassed; assignments follow the selected routing mode. |
| Atomic effects and evidence | Create assignment, responsibilities, initial immutable revisions, lifecycle/domain events, and audit evidence together. Add notification intent only under an approved recipient/event policy. |
| Concurrency / idempotency | Acquire the shared submission-level synchronization used by final-review readiness, then recheck route state and serialize changes to the submission's routing state; enforce only approved active-assignment uniqueness. Use §7.1's operation-scoped idempotency contract. Stage 3's one-active-assignment-per-office default remains provisional. |
| Failure / postcondition | Any invalid responsibility or missing authorization aborts the whole operation. Success creates independently tracked responsibility work within one assignment. |

#### Operation 7 — Add another office during ongoing simultaneous reviews

| Contract element | Design |
|---|---|
| Purpose | Add new office work while previously assigned offices continue. |
| Actor and authorization | Tourism Officer with active `approver` grant. |
| Existing context / conceptual input | Active simultaneous-routing submission/round, newly selected office and responsibilities. |
| Checks | Submission remains open for routing; mode is simultaneous; new office and requirement mapping is authorized; existing cycles/responses are not stale or implicitly cancelled. |
| Atomic effects and evidence | Append the new assignment/responsibilities/revisions/events/audit and approved notification intent. Do not rewrite or re-open unaffected office work. |
| Concurrency / idempotency | Acquire the shared submission-level synchronization used by final-review readiness and recheck routing mode and submission state after acquisition. A new assignment/responsibility cannot race past final approval. Existing response work remains independent except for this shared submission-state check. Use §7.1's operation-scoped idempotency contract. |
| Failure / postcondition | If the route is no longer simultaneous/eligible, reject as stale and return current safe state. Success leaves prior offices' work active and independently progressing. |

#### Operation 8 — Advance one-at-a-time routing

| Contract element | Design |
|---|---|
| Purpose | After reviewing current office work, explicitly decide whether to assign another office in a one-at-a-time route. |
| Actor and authorization | Tourism Officer with active `approver` grant. |
| Existing context / conceptual input | Current route, reviewed office response(s), next explicit office/responsibilities or decision not to add another. |
| Checks | Route mode is one-at-a-time; required preceding response is present and reviewed; selected next step is Officer-specified and authorized. No automatic forwarding. |
| Atomic effects and evidence | Append the Officer's routing decision and, when selected, create next assignment/responsibilities and their events atomically. |
| Concurrency / idempotency | Serialize route sequence through the shared submission-level synchronization; compare route revision/current step; repeated command must not create a duplicate assignment. Use §7.1's operation-scoped idempotency contract. |
| Failure / postcondition | Stale or unreviewed route blocks advancement. Success records explicit Officer control; existing history remains unchanged. |

#### Operation 9 — Revise an office responsibility

| Contract element | Design |
|---|---|
| Purpose | Correct/modify responsibility scope or instructions while retaining the prior revision. |
| Actor and authorization | Tourism Officer with active `approver` grant. |
| Existing context / conceptual input | Assignment/responsibility, expected current revision, new scope/type/instructions, reason. |
| Checks | Exact same-submission parentage; current assignment state; valid responsibility type; approved office authority; no downgrade/cancellation used to bypass a denied or unresolved mandatory requirement. |
| Atomic effects and evidence | Append immutable responsibility revision, lifecycle/domain event, and audit. If active cycles become stale, handle them through explicit history-preserving transition, not silent retargeting. |
| Concurrency / idempotency | Lock responsibility or compare revision sequence under the shared submission-level synchronization; reject stale revision; use §7.1's operation-scoped idempotency contract. |
| Failure / postcondition | Invalid revision leaves previous current revision intact. Success preserves prior classifications and actor/reason/time. Whether changed responsibilities require fresh cycles is an institutional/model dependency. |

#### Operation 10 — Cancel or resolve assignment/responsibility where permitted

| Contract element | Design |
|---|---|
| Purpose | Record a valid cancellation or permitted nonmandatory resolution without using resolution as a generic response substitute. |
| Actor and authorization | Tourism Officer with active `approver` grant. |
| Existing context / conceptual input | Exact assignment/responsibility and target version/revision; reason and requested action. |
| Checks | Approved valid-case policy; responsibility type and lifecycle; mandatory safeguards. A mandatory responsibility may not be cancelled/downgraded/resolved to bypass approval; mandatory approval still requires an approved office response. |
| Atomic effects and evidence | Append responsibility/assignment event and, only if approved model requires, a typed resolution record; append audit/status projection changes as applicable. |
| Concurrency / idempotency | Acquire the shared submission-level synchronization with final review and response creation; re-evaluate responses and decisions after lock. Use §7.1's operation-scoped idempotency contract. |
| Failure / postcondition | Unknown permitted case fails closed; no generic resolution is recorded. Success excludes only a legitimately cancelled responsibility under safeguards or records an expressly permitted nonmandatory resolution. |

### 4.3 Review and change-request operations

#### Operation 11 — Open/initiate a review cycle

| Contract element | Design |
|---|---|
| Purpose | Request one office's review of one responsibility at its exact target version/revision. |
| Actor and authorization | Tourism Officer with active `approver` grant. |
| Existing context / conceptual input | Assignment, responsibility, exact submission version and responsibility revision, cycle reason/context. |
| Checks | All parent/target relationships match the same submission; assignment is active; requirement is valid; no conflicting active cycle for the target under approved cycle semantics. |
| Atomic effects and evidence | Append cycle and cycle event; update any current progress projection; append audit and approved notification intent. |
| Concurrency / idempotency | Serialize per responsibility target under the shared submission-level synchronization; use a unique active target constraint or equivalent checked invariant after active-cycle semantics are approved. Use §7.1's operation-scoped idempotency contract. |
| Failure / postcondition | Mismatch or stale target aborts. Success establishes an immutable exact review target and makes the work available only to the assigned office's authorized members. |

#### Operation 12 — Submit an official office response

| Contract element | Design |
|---|---|
| Purpose | Record one official outcome/findings for a responsibility cycle. |
| Actor and authorization | Authenticated `external_approver` with an active grant and active membership in the exact assigned office. |
| Existing context / conceptual input | Exact assignment, responsibility, cycle, target version/revision, outcome/findings/remarks and permitted attachments. |
| Checks | Actor derived from trusted context; grant and membership active at action time; all references agree; cycle open and eligible; target version/revision is exact; no existing response; outcome matches responsibility type; no assignment-wide response uniqueness. |
| Atomic effects and evidence | Insert one immutable cycle-level response with actor profile, membership, grant, outcome, timestamp; link only authorized same-submission attachments; append cycle/domain event and generic audit evidence; record notification intent only if approved. |
| Concurrency / idempotency | Acquire the shared submission-level synchronization, then lock/recheck the exact cycle and enforce at-most-one response per cycle through approved uniqueness plus transaction control. Concurrent duplicate loses safely with no partial response/event/notification. Same key/payload returns the committed result; a key/payload mismatch is rejected. |
| Failure / postcondition | Revoked authority, wrong office/cycle, stale target, or duplicate response fails without partial writes and without leaking inaccessible data. Success is an office outcome only, not an overall decision. |

#### Operation 13 — Record Tourism Officer review of an office response

| Contract element | Design |
|---|---|
| Purpose | Append Officer disposition/review of an official office response. |
| Actor and authorization | Tourism Officer with active `approver` grant and submission scope. |
| Existing context / conceptual input | Response/cycle and disposition, reason/notes or follow-up instruction. |
| Checks | Response belongs to the submission/cycle; actor is currently authorized; disposition is valid for the workflow; no mutation of the official office response itself. |
| Atomic effects and evidence | Append Officer response-review record and cycle/domain/audit evidence. If it issues a formal sender return, use Operation 15's explicit transition contract in the same logical decision, not an informal note. |
| Concurrency / idempotency | Acquire the shared submission-level synchronization, serialize conflicting disposition/follow-up changes against cycle state, and use expected cycle revision and request key. |
| Failure / postcondition | Stale response or invalid authority leaves existing response intact. Success adds an attributed Officer action without rewriting office evidence. |

#### Operation 14 — Confirm applicability of an earlier response

| Contract element | Design |
|---|---|
| Purpose | Explicitly allow a prior response to serve as an effective basis for a later exact target context when permitted. |
| Actor and authorization | Tourism Officer with active `approver` grant. |
| Existing context / conceptual input | Original response, same logical responsibility, target submission version and responsibility revision, reason. |
| Checks | Same submission/responsibility; explicit Officer decision; target belongs to that submission; original response is valid and not superseded; no other active effective basis for target; material-change/policy conditions resolved. |
| Atomic effects and evidence | Append applicability confirmation and event/audit; do not edit or copy the original response. |
| Concurrency / idempotency | Acquire the shared submission-level synchronization, lock target responsibility context, and recheck response/resolution/cycle bases; serialize against reassessment, cancellation, and other applicability. Use §7.1's operation-scoped idempotency contract. |
| Failure / postcondition | Ambiguous applicability or unresolved material-change rule fails closed and requires reassessment. Success counts the prior response only once for this exact target. |

#### Operation 15 — Request formal correction from submitter

| Contract element | Design |
|---|---|
| Purpose | Issue an official Tourism Officer request for correction/clarification, whether prompted by initial screening or office feedback. |
| Actor and authorization | Tourism Officer with active `approver` grant. Offices cannot formally return work to the submitter. |
| Existing context / conceptual input | Submission, exact current version, triggering review/responses, correction instructions and reason. |
| Checks | Correctable state; request is distinct from final rejection; exact current version; parent and review references consistent; any notification intent follows approved event/recipient rules. |
| Atomic effects and evidence | Append formal request/review event and status history; preserve office response(s); record approved notification intent and audit evidence in the same transaction. |
| Concurrency / idempotency | Serialize through the shared submission-level synchronization with final decisions, resubmission, and reassessment; stale version request is rejected; same request retries return the same request. |
| Failure / postcondition | No partial `RETURNED` state without its request history. Success makes the submission correctable and prohibits treating it as final rejection. |

#### Operation 16 — Receive corrected resubmission

| Contract element | Design |
|---|---|
| Purpose | Accept the submitter's response to a formal correction request and attach a new version. |
| Actor and authorization | Submission owner, through the authorized submitter flow. |
| Existing context / conceptual input | Correctable submission, expected current version/request, new file/information and typed attachment links. |
| Checks | Correctable status and open request; owner; expected current version; new version is not a replacement of prior file; same-submission attachments. |
| Atomic effects and evidence | Append new version/links, update current-version projection, append resubmission/status/domain/audit history. Do not automatically create office cycles or assume which responsibilities need reassessment. |
| Concurrency / idempotency | Lock/check submission version/state and open correction request; unique version sequence; same actor/scope/key and payload replays the committed version result; different payload is rejected under §7.1. |
| Failure / postcondition | Stale request or failed required database row aborts. An uploaded object can remain unreferenced and require separate cleanup. Success returns to Tourism Officer review for selection of affected offices/responsibilities. |

#### Operation 17 — Initiate selective reassessment

| Contract element | Design |
|---|---|
| Purpose | Start new review cycles only for responsibilities selected by the Tourism Officer for the new target. |
| Actor and authorization | Tourism Officer with active `approver` grant. |
| Existing context / conceptual input | Submission/new version, selected responsibilities and exact current revisions, unaffected-basis applicability selections/reasons where explicitly confirmed. |
| Checks | Validate the entire explicitly selected responsibility set, target submission/version, and exact current revisions before commit; only selected work is reassessed; unaffected responses remain intact; any response reuse is explicitly tied to the exact target; no invalidated response auto-reactivates. |
| Atomic effects and evidence | Within one logical transaction, append reassessment decision/events; create new cycles for every selected responsibility; append only explicitly confirmed applicability records for unaffected responses; and update any projection and audit evidence consistently. The transaction covers the selected set, not every responsibility on the submission. |
| Concurrency / idempotency | Acquire the shared submission-level synchronization, compare expected version and responsibility revisions, and prevent overlapping duplicate cycles and duplicate active bases. Use §7.1's operation-scoped idempotency contract. |
| Failure / postcondition | Validate all selected responsibilities and target context before committing. If any selected responsibility fails validation or any required write fails, roll back the entire selected-set reassessment, including all new cycles, applicability records, projections, and events. Unaffected responsibilities are not reassessed. Success preserves prior cycles/responses and creates no new response until the office acts. |

### 4.4 Overall decision and supporting operations

#### Operation 18 — Record overall approval

| Contract element | Design |
|---|---|
| Purpose | Approve the overall submission after all applicable readiness requirements pass. |
| Actor and authorization | Tourism Officer with active `approver` grant; Admin alone and external office members are not authorized. |
| Existing context / conceptual input | Submission, exact current version, final-review request, readiness basis and applicable evidence references. |
| Checks | Current state/version; every active responsibility satisfies the accepted response gate; mandatory responsibilities have approved official office responses; active Evaluation and Recommendation responsibilities have official responses; a generic resolution cannot substitute for either response; only explicitly permitted cancellation satisfying safeguards may remove a responsibility from the active gate; one effective basis per target; all actor/parent links agree. |
| Atomic effects and evidence | Append overall decision, required status history, domain/audit evidence, and required notification intent addressed to the submitter. Channel, provider, delivery timing, and retry policy are separate; external delivery follows commit. Decision, status projection, event evidence, and notification intent commit together. |
| Concurrency / idempotency | Acquire the shared submission-level synchronization, re-read state, and recompute readiness after locking; serialize against responses, routing/responsibility additions, cancellation, correction, reassessment, and competing decisions. Use §7.1's operation-scoped idempotency contract; one terminal decision under the recommended no-reopening default. |
| Failure / postcondition | Any failed gate leaves no approval/status/notification intent. Success records Officer and current version and keeps office responses distinct from overall decision. |

#### Operation 19 — Record overall rejection

| Contract element | Design |
|---|---|
| Purpose | Record a Tourism Officer's overall rejection where the workflow permits it, including applicable initial-review final rejection as a distinct stage/context. |
| Actor and authorization | Tourism Officer with active `approver` grant; Admin-only or office-member decision is denied. |
| Existing context / conceptual input | Submission, exact current version, decision stage/context, required reason, applicable evidence. |
| Checks | Correct lifecycle state; decision is not a correctable return; rejection criteria are not inferred; mandatory findings and evidence are retained; initial rejection cannot proceed to routing/final review. |
| Atomic effects and evidence | Append decision, status history, domain/audit history, and required notification intent addressed to the submitter. Channel, provider, delivery timing, and retry policy remain separate; external delivery follows commit. |
| Concurrency / idempotency | Acquire the shared submission-level synchronization and recheck lifecycle/version against office responses and other state changes; use §7.1's operation-scoped idempotency contract. A rejection/return may close or change work without satisfying approval readiness, but cannot conflict with a committed incompatible office response. |
| Failure / postcondition | Missing reason or stale state aborts. Success records a final overall rejection, not an office-level rejection. Exact rejection criteria remain open. |

#### Operation 20 — Record overall return/correction decision

| Contract element | Design |
|---|---|
| Purpose | Return a submission to its owner for correctable changes or clarification, distinct from rejection. |
| Actor and authorization | Tourism Officer with active `approver` grant. |
| Existing context / conceptual input | Submission/current version, reason/instructions, any relevant office response or initial-screening evidence. |
| Checks | Return is valid in current state; correction instructions and reason are present as required; office representatives have not initiated the formal return; terminal decision rules allow this non-final outcome. |
| Atomic effects and evidence | Append return decision/request and status history; retain current/prior versions and office responses; record required notification intent addressed to the submitter, plus audit evidence. Channel, provider, delivery timing, and retry policy remain separate; external delivery follows commit. |
| Concurrency / idempotency | Acquire the shared submission-level synchronization and serialize with response review, resubmission, reassessment, and final decisions; use §7.1's operation-scoped idempotency contract and do not create multiple active correction requests. |
| Failure / postcondition | No status change without the formal request record. Success permits owner correction and later Tourism Officer reassessment. |

#### Operation 21 — Record lifecycle status history

| Contract element | Design |
|---|---|
| Purpose | Internal transaction responsibility for recording every required lifecycle transition, not an independently exposed arbitrary status setter. |
| Actor and authorization | Inherits and records the actor/context of the authorized parent operation; trusted system transitions must have an explicitly approved cause. |
| Existing context / conceptual input | Submission, transition cause, actor/grant, and optional decision linkage as specified by the approved model. |
| Checks | Valid transition from current state; decision reference agrees when decision-caused; otherwise an approved controlled cause is present. Exact status vocabulary remains open. |
| Atomic effects and evidence | Append authoritative status-history record and update any current-state projection in the same transaction. |
| Concurrency / idempotency | Uses parent operation's lock/version checks; no duplicate transition from retry. |
| Failure / postcondition | History/projection failure aborts parent operation. No direct independent status rewrite is permitted. |

#### Operation 22 — Record notification intent and delivery attempts

| Contract element | Design |
|---|---|
| Purpose | Record in-app/email/SMS intent and later delivery attempts without making external provider availability part of workflow correctness. |
| Actor and authorization | Workflow operation records required intent and recipient for mandated submitter notices, or other intent under approved event-recipient policy; restricted delivery worker records claims and attempts. |
| Existing context / conceptual input | Committed domain event/reference, recipient, separately selected channel/content classification, delivery state/claim, and safe attempt outcome/error metadata. |
| Checks | Recipient is authorized; content is minimized; delivery attempt references an existing intent; duplicate logical intent is deduplicated; a delivery claim is current and owned by the processing worker. |
| Atomic effects and evidence | Required notification intent/delivery work commits with the originating workflow mutation. Delivery claims, attempt history, and delivery outcome changes are separate post-commit operations. |
| Concurrency / idempotency | Claim eligible work with a concurrency-safe lease; recover expired claims; deduplicate intent; use provider idempotency where supported. Duplicate/ambiguous attempts remain traceable and never replay the workflow mutation. Retry policy remains open. |
| Failure / postcondition | Failure to record required intent aborts the originating workflow transaction. Provider outage or interruption after commit does not roll back workflow state; delivery remains pending, failed, or unknown and recoverable under approved policy. Do not send provider requests inside a workflow transaction or implicitly from triggers. |

#### Operation 23 — Record domain and generic audit events

| Contract element | Design |
|---|---|
| Purpose | Persist workflow-specific facts and security/audit attribution for the logical operation. |
| Actor and authorization | Inherits the verified actor and exact role grant/membership context from the parent operation; no caller-selected attribution. |
| Existing context / conceptual input | Event meaning, affected domain record(s), submission where applicable, actor/context, time, correlation/idempotency reference, minimal safe details. |
| Checks | Event matches the operation actually performed; no sensitive document payloads or unvalidated identity IDs; domain relationships agree. |
| Atomic effects and evidence | Required domain event, generic audit evidence, and status history are written with their associated mutation when they are required for correctness. |
| Concurrency / idempotency | Same logical operation must not produce duplicate event effects on retry; event ordering reflects committed operation ordering. |
| Failure / postcondition | If required evidence cannot be written, the parent transaction rolls back. Audit-only observations that are not workflow transitions remain distinct from status history. |

## 5. Transaction boundaries and atomic write sets

| Logical operation | One-transaction write set (conceptual) | Must roll back together |
|---|---|---|
| Submit initial document | Submission state, first version, typed attachment links, status/domain/audit history | All required database records; no submitted state without version/history. Uploaded objects are external; unreferenced-object cleanup is separate. |
| Add/revise routing | Routing round or assignment, responsibilities/revisions, lifecycle events, audit, any required notification intent | Assignment and all responsibility records/history included in the command. |
| Add office during simultaneous work | New office assignment/responsibilities/events and any required notification intent | New work only; existing office cycles/responses remain untouched. |
| Submit official office response | Response, exact actor authorization context, response attachments if enabled, cycle event, audit, any required notification intent | Response cannot exist without required evidence; required intent failure rolls back the response; later provider-delivery failure does not. |
| Officer response review/formal return | Officer review event, formal request and status history if returning, audit, any required notification intent | No returned state without request; original office response remains immutable. |
| Corrected resubmission | New version/links, current-version projection, resubmission/status/domain/audit history | No pointer update without version/history. Uploaded objects are external; unreferenced-object cleanup is separate and deferred. |
| Reassessment | Selection/history, new cycles for the selected responsibility set, exact applicability confirmations for unaffected responses where chosen, projections and audit | All selected-set changes commit or roll back together; responsibilities outside the selected set are untouched. |
| Final approval/rejection/return | Decision, status history/current status projection, domain/audit evidence, required notification intent for mandated submitter notices | Decision cannot persist without required status/history, notification intent, or final approval readiness. Provider delivery is post-commit. |
| Resolve/cancel responsibility | Attributed lifecycle event, permitted resolution record if applicable, readiness projection/history, audit | No partial cancellation/resolution that can alter the readiness basis silently. |
| Delivery attempt | Attempt record and delivery-state update | Attempt history and corresponding state; does not encompass/replay originating workflow mutation. |

### 5.1 Overall approval transaction

The approval operation must re-evaluate readiness inside its transaction rather than trust a UI-calculated summary:

1. Authenticate and authorize the Tourism Officer.
2. Acquire the selected submission/decision serialization protection.
3. Re-read the current state and exact version after lock acquisition.
4. Enumerate active responsibilities and their exact current revisions.
5. Determine one effective basis per responsibility target; do not double-count superseded cycles, applicability records, batches, or their child responses.
6. Require an approved official office response for each mandatory responsibility.
7. Require an official response for every active Evaluation and Recommendation responsibility; a resolution cannot substitute for either. Negative outcomes are not vetoes. A valid cancellation is separate and removes work from the gate only when explicitly permitted and authorized under approved safeguards.
8. Confirm all cancellation safeguards and actor/parent references.
9. Append decision, status history/projection, required domain/audit evidence, and required notification intent addressed to the submitter. Channel/provider delivery policy is separate.
10. Commit all writes together. If any check/write fails, no approval or partial status remains.

### 5.2 Notification transaction boundary

Workflow correctness is decided and committed before an email/SMS provider is contacted. For workflow events requiring notification, persist intent and recipient atomically with the triggering action; channel, provider, delivery timing, and retry policy remain separately configurable or unresolved. Deliver only after commit; record each attempt, outcome, and safe error metadata. A provider outage or later delivery failure never rolls back the workflow decision. The Stage 3 model includes notification, delivery, and append-only attempt concepts, but does not explicitly define worker claim leases, lease expiry/recovery, or ambiguous provider outcomes; treat these as proposed model gaps to resolve during Stage 3 reconciliation. Do not introduce a new outbox entity without demonstrating the existing proposed model cannot meet the approved reliability requirement.

## 6. Concurrency control and locking

Concurrency techniques are recommendations pending final model and workload review. They should protect an explicit invariant, not be applied mechanically to every operation.

| Concurrent scenario | Invariant at risk | Recommended conceptual protection | Losing/stale request and history |
|---|---|---|---|
| Two representatives submit for one cycle | At most one official response for the cycle | Unique cycle-response invariant plus transaction coordination; recheck cycle after lock | One commits; other receives a safe duplicate/conflict result. No second response/event/notification is written. |
| Office response and final approval race; required response is not yet committed | Approval must see a complete readiness snapshot; response cannot be orphaned, miscounted, or accepted after incompatible closure | Both acquire the same submission-level synchronization before cycle/decision locks; recheck submission state and cycle eligibility. Approval recomputes readiness after acquiring it. | If approval obtains the lock first while a required response is absent, approval fails readiness without writing a decision. The response may then commit if the cycle remains eligible; the Tourism Officer can retry approval. If the response commits first, approval rechecks and may proceed only if every gate passes. |
| Office response races with overall rejection or correction/return | An office response cannot silently commit against a terminal or incompatible submission state | Serialize both through the same submission-level synchronization; decision and response recheck lifecycle and cycle eligibility after acquiring it. Rejection/return does not use approval readiness as its precondition. | If rejection/return commits first and makes the submission terminal or the cycle ineligible, the later response is rejected with no partial response/evidence. If response commits first, the Officer decision rechecks and preserves that response as history. Conflicting decisions cannot both commit. |
| Tourism Officer adds an office or responsibility while final approval is attempted | Approval cannot omit newly active work; assignment cannot be added after terminal approval | Assignment/responsibility creation and approval use the same submission-level synchronization and recheck state after acquiring it. | If new work commits first, approval sees it and fails until its active gate is satisfied. If approval commits first, the addition is rejected as terminal/ineligible. If addition fails, no partial assignment/responsibility remains. |
| Tourism Officer adds an office or responsibility while simultaneous reviews are active | New work must not cancel, retarget, or block already active work | Protect shared submission/routing state; append only the newly requested assignment/responsibilities; preserve independent existing cycles and responses. | Both new work and unrelated responses may commit sequentially while the route remains open. A stale/closed route rejects the addition; existing response history is unchanged. |
| Two Tourism Officer actions modify the same routing round | No lost route selection or duplicate/conflicting assignments | Acquire the submission aggregate first, then the round; recheck routing mode/revision and use idempotency for duplicate logical requests. | One succeeds; conflicting stale action fails or returns the same committed result only when it is a same-key/same-payload retry. Both accepted sequential actions remain attributable. |
| Corrected version submitted while old cycle is being reviewed | Cycle remains bound to old exact version; stale response cannot silently satisfy new target | Coordinate on submission/current-version transition and cycle; response rechecks cycle target/current eligibility. Version append never retargets old cycle. | Old-cycle response may be accepted only if cycle remains valid per approved policy; otherwise reject as stale. Preserve it as historical evidence, then Officer selects reassessment. |
| Two requests initiate reassessment | No duplicate active cycles or contradictory applicability/effective bases | Serialize per submission or responsibility target; unique/checked target-cycle invariant; idempotency | Same request replays; conflicting request is rejected or re-evaluated. No old response is overwritten. |
| Double-click/network retry creates submission | One request must not create duplicate submissions/versions | Idempotency key scoped to authenticated actor and operation; uniqueness in idempotency registry and transaction | Same payload/key returns same safe result; different payload with same key is rejected. |
| Two overall decisions race | At most one terminal decision under the recommended no-reopen default | Serialize per submission; conditional terminal decision invariant; validate expected version/state | One terminal decision commits; the other is denied as stale/closed. Decision and status history remain paired. |
| Membership/role revoked while operation is pending | Revoked authority cannot authorize new action | Check authority within transaction at point of operation; coordinate grant/membership revocation with action as required by final model | The ordering determines whether action preceded revocation; no action after observed revocation succeeds. Preserve authorization references for prior action. |

### 6.1 Locking and isolation guidance

- Use row-level locking conceptually for contested submission, routing-round, cycle, responsibility target, membership/grant, or delivery-claim state when concurrent mutation could violate an invariant.
- Use optimistic expected-version/revision checks for stale edits where conflict detection is sufficient and serial locking is unnecessary.
- Use uniqueness constraints for local at-most-one rules such as one response per cycle and scoped idempotency key. A constraint does not replace checking authorization, cross-table relationships, or transaction-level effective-basis exclusivity.
- Every operation that can change final-review readiness or make a cycle ineligible—including response submission, assignment/responsibility creation or cancellation, version/reassessment changes, and overall decisions—uses one shared submission-level synchronization rule or an equivalent conflict protocol. Recheck mutable preconditions after acquiring it; a decision made before waiting is not authoritative after concurrent state changes.
- Recommended consistent lock order: (1) submission aggregate; (2) relevant routing round or assignment; (3) relevant responsibility/revision; (4) relevant review cycle; (5) response, event, and related records. If an operation does not need a level, it skips it without reversing the order. This is a provisional technical recommendation subject to Stage 3 model review and actual access-path design.
- For a response and approval race, approval must fail its readiness check when a required response is not committed; the response may subsequently commit if its cycle remains eligible, after which the Tourism Officer may retry approval. A response arriving after a terminal or incompatible decision is rejected rather than silently accepted.
- Choose transaction isolation per operation and demonstrated anomaly risk. Do not assume every operation needs `SERIALIZABLE`; row locking, unique constraints, conditional writes, or optimistic checks may be sufficient for many operations.
- On a serialization/deadlock/conflict failure, retry only the complete logical operation with the same idempotency semantics and fresh authorization/state checks.

## 7. Idempotency and safe retries

Stage 3 proposes an `idempotency_keys` concept scoped by actor, operation, and key, with request fingerprint, processing/completed state, safe result reference, and optional expiry metadata. Use it as a design input, not a frozen entity contract.

1. **Actor identity:** Derive from the authenticated session/profile; do not accept an actor ID from the request as the key owner.
2. **Operation/scope identity:** Include the logical operation and relevant resource scope so a key for one submission action cannot collide with an unrelated operation.
3. **Request fingerprint:** Compute from a canonical representation of the semantically relevant request. Do not store sensitive payloads unnecessarily.
4. **Same key, same fingerprint:** Return the prior committed safe result; do not repeat submissions, responses, decisions, assignments, notifications, or events.
5. **Same key, different fingerprint:** Reject key reuse. Do not reinterpret it as a new request.
6. **Concurrent same-key requests:** A uniqueness/claim mechanism makes one request the owner; a concurrent duplicate waits or receives a safe in-progress result, then resolves to the same committed result. It must not run a second mutation.
7. **Failure before commit:** The idempotency claim and business mutation commit atomically. A failed transaction leaves no completed business result or successful idempotency record; any transient in-transaction claim is rolled back with the business writes.
8. **Failure after commit before response delivery:** Retry looks up the committed key/result and returns it without duplicating effects.
9. **External delivery:** Provider retries have their own delivery/attempt idempotency and do not reuse workflow mutation by rerunning it.
10. **Expiry/cleanup:** Retention duration, cleanup, and behavior after expiry are unresolved technical/policy decisions. Do not invent a time-to-live or delete keys while a request/result could still be retried.

If a result reference points to an inaccessible resource, return a safe minimal result and reauthorize before disclosing details. A stored result is not an authorization grant.

### 7.1 Operation-specific idempotency contract

The general rules above apply to each operation below. The key is scoped to the authenticated actor, operation, and target resource/aggregate; its fingerprint covers the complete semantic payload, including expected versions/revisions and selected child targets where relevant. The claim and business mutation commit atomically. For every row: the same actor/scope/key and same payload returns the previously committed result without repeating any mutation; the same key with a different payload is rejected; concurrent use permits only one mutation to commit; a pre-commit failure leaves no successful result/key; and a retry after commit but lost client response returns the existing result.

| Operation | Idempotent result scope |
|---|---|
| 1 — Create a draft submission | The created draft identity; a distinct intentional draft requires a distinct logical request/key. |
| 2 — Submit for initial review | The committed submission/version and initial-review transition. |
| 3 — Create/attach a new submission version | The created version and its validated attachment metadata; an uploaded object alone is not a committed version. |
| 4 — Record initial screening outcome | The selected initial-review outcome, status/history, and any required initial-rejection notification intent. |
| 5 — Create a routing round | The explicit routing mode/action and its recorded round/history. |
| 6 — Assign an office and responsibilities | The complete assignment and requested responsibility/revision set; no partial child creation on replay or failure. |
| 7 — Add an office during simultaneous reviews | The newly requested assignment and responsibility set, without duplicating or changing existing work. |
| 8 — Advance one-at-a-time routing | The explicit routing decision and any assignment/responsibility set created by that decision. |
| 9 — Revise an office responsibility | The requested immutable revision and its lifecycle/audit evidence. |
| 10 — Cancel or resolve a responsibility | The permitted cancellation/resolution event for the exact responsibility and target context. |
| 11 — Open/initiate a review cycle | The new cycle for its exact submission, version, responsibility, and revision target. |
| 12 — Submit an official office response | The one committed response for the exact cycle and its actor/event evidence; an independent conflicting key receives a safe duplicate/conflict result. |
| 13 — Record Tourism Officer review of a response | The attributed review/disposition and its cycle/audit evidence. |
| 14 — Confirm applicability | The target-specific applicability confirmation for the exact prior response and target context. |
| 15 — Request formal correction | The formal correction request and associated state/history transition. |
| 16 — Receive corrected resubmission | The committed new version, links, and resubmission transition. |
| 17 — Initiate selective reassessment | The atomic reassessment result for the entire selected responsibility set; retries cannot create only a subset or duplicate cycles. |
| 18 — Record overall approval | The one committed approval decision and its status/history/required notification intent. |
| 19 — Record overall rejection | The one committed rejection decision and its status/history/required notification intent. |
| 20 — Record overall return/correction decision | The committed return/request and its status/history/required notification intent where required. |

## 8. Domain events, audit events, and status history

| Record class | Meaning | Authority |
|---|---|---|
| Domain event | Workflow-specific fact, such as submission submitted, office assigned, response received, reassessment initiated, or decision issued | Supports the domain lifecycle and is written with the associated mutation when required. |
| Generic audit event | Actor, time, action, resource/correlation context, and minimal audit details | Cross-cutting accountability; may describe actions without a submission status transition. |
| Submission status history | Authoritative lifecycle transition of the submission | Must not be conflated with every audit event or office-level progress. |
| Office/responsibility/cycle history | Assignment, responsibility revision, cycle, response, applicability, and review lifecycle evidence | Preserves independently scoped office work and reassessment history. |

### 8.1 Consistency rules

- An official response must not exist without its required cycle/domain event and actor context.
- A decision must not exist without its required lifecycle history and current-state projection update.
- Required audit evidence must commit with the operation it records. Optional operational logging is not a substitute for required domain history.
- Duplicate retries must not duplicate authoritative records or create contradictory event chains.
- Actor, grant, and membership attribution on historical records is immutable. Revocation affects future authority, not historical attribution.
- Audit events do not themselves make lifecycle transitions and must not be treated as the sole source of workflow truth.
- Events should identify a committed logical outcome and correlation/idempotency context; do not place unrestricted document content or secrets in generic audit metadata.
- If an event/history insert is required and fails, roll back the associated workflow mutation.

### 8.2 Trigger boundary

Triggers may be considered later only for narrowly justified integrity or audit purposes. They must not silently become the operation API, replace explicit action-level authorization, trust client-supplied actor identifiers, perform external notifications, or create a privilege/RLS bypass. Any trigger design must specify execution identity, effective privileges, RLS interaction, failure behavior, and how its effects remain atomic with the calling operation. This document selects no triggers.

## 9. Reassessment and response applicability sequence

One reassessment request targets an explicitly selected set of responsibilities. Validate the entire selected set and target context before commit, then create all required cycles and confirmed applicability changes for that set in one logical transaction. If any selected responsibility or required write fails, roll back the entire request. Responsibilities outside the selected set are not reassessed. This transaction scope is the selected set, not every responsibility on the submission. Use the operation-specific idempotency contract in §7.1.

The following is a conceptual sequence and preserves the Tourism Officer's selection authority:

1. The submitter provides a corrected version after a formal Tourism Officer request, or the workflow otherwise establishes a new version eligible for review.
2. The Tourism Officer reviews the new exact version and selects which responsibilities require reassessment.
3. For each selected responsibility, validate its current logical identity and responsibility revision; open a new cycle targeting that exact version/revision.
4. Preserve all prior cycles and responses unchanged. Do not copy an old response into the new cycle.
5. For each unaffected response the Tourism Officer explicitly deems still applicable, append a target-specific applicability confirmation referencing the original response, new version, and exact responsibility revision.
6. Validate that the original response and target are for the same submission and responsibility, that the original has not been superseded/invalidated, and that no competing effective basis exists for the target.
7. Append applicability history, events, and audit evidence. If a confirmation is later found invalid, append invalidation/supersession history; do not edit/delete it or automatically reactivate the original response.
8. Calculate readiness using one effective basis per active responsibility. Exclude superseded cycles and invalidated applicability. Do not count both a batch and child responses.
9. Continue office responses for only the new selected cycles. Final review remains blocked until all active responsibilities satisfy the accepted gate.

Applicability is not a new official office response: it is an Officer-authored determination that a historical response applies to a specific later target. The original actor, office membership, role grant, outcome, timestamp, and target cycle remain attached to the original response.

**Dependencies:** MTO must clarify the canonical assignment-level “one official decision per active assignment” language against the Stage 3 per-cycle response recommendation, any need for response batching, which nonmandatory responsibilities may be resolved without a response, and any exceptional mandatory cancellation. Technical design must also define material-change detection, cycle supersession, and effective-basis selection. Until resolved, do not broaden response reuse; reassessment is the fail-closed option where applicability is uncertain.

## 10. Notifications and external side-effect reliability

### 10.1 Separate intent, claim, attempt, and outcome

1. **Workflow intent:** Record the intended recipient and workflow-event reference inside the workflow transaction when the canonical workflow requires notice. For initial-review final rejection and overall final decisions, the recipient is the submitter. Channel, provider, content template, delivery timing, and retry policy remain separately configurable or unresolved. Intent is not proof of delivery.
2. **Delivery claim:** After commit, a worker atomically claims eligible delivery work under a bounded lease or equivalent recoverable claim. Claims are processing coordination, not evidence that a provider was contacted or that a message was delivered.
3. **Attempt:** For each provider interaction, record an append-only attempt with safe metadata. Distinguish provider acceptance, confirmed delivery when the provider supports it, confirmed failure, and unknown/ambiguous outcome.
4. **Confirmed success:** Record only the outcome the provider actually confirms. Provider acceptance is not necessarily recipient delivery; do not claim receipt without evidence.
5. **Confirmed failure:** Preserve failure and attempt history and make the delivery eligible for retry only under the approved retry policy.
6. **Unknown outcome:** If a worker loses its response after the provider may have accepted a message, record an unknown/ambiguous outcome rather than asserting failure or success. Retry only with provider idempotency/deduplication support where available or under an explicitly accepted duplicate-delivery risk.
7. **Recovery and retry:** If a worker stops after claiming work, an expired lease or equivalent recovery rule must make it safely claimable again. Recovery records must not erase prior attempts. Do not rerun the originating workflow operation to resend.

### 10.2 Reliability boundaries

- Never hold a workflow transaction open while calling email/SMS or other network providers.
- Do not send external notifications from a database trigger as an implicit side effect.
- When notification intent is required, persist it and its recipient transactionally with the workflow change using the Stage 3 `notifications`, `notification_deliveries`, and `notification_delivery_attempts` concepts if their approved schema can support post-commit processing.
- Phase 2 mentions an existing TEST email outbox, but historical audit evidence is not proof that the current deployed structure is correct or selected. Reconcile available structures before deciding whether the Stage 3 notification model needs adaptation. Do not add a new outbox table absent a demonstrated gap and approval.
- Deduplicate notification intent using the logical event/recipient/channel identity chosen in approved design. Exact key, recipients, content, retry rules, timing, and retention remain open.
- Stage 3 specifies delivery state/retry scheduling and append-only attempt history, but does not explicitly define worker claim ownership, lease expiry/recovery, confirmed-versus-unknown outcomes, or behavior after provider acceptance followed by a lost worker response. These are proposed model gaps to resolve in Stage 3 review; do not assume existing entities can represent them until their proposed attributes and constraints are reviewed. Do not claim exactly-once external delivery without a provider-supported idempotency mechanism.
- External delivery is at-least-once or otherwise provider-dependent unless an approved provider mechanism establishes stronger guarantees. Internal intent deduplication prevents duplicate workflow intents but cannot alone prevent a provider from delivering twice after an ambiguous outcome.
- Notification bodies must respect resource authorization and content visibility; a notification link does not grant access to the target document.

## 11. Error handling and failure semantics

Do not disclose inaccessible resource existence or content. Return a safe result at the application boundary, preserve useful restricted diagnostics server-side, and distinguish retryable conflicts from policy denials.

| Failure category | Transaction outcome | Retry / next action |
|---|---|---|
| Unauthenticated actor | No workflow writes | Authenticate, then retry as a new authorized request. |
| Unauthorized actor or unresolved privileged grant authority | No workflow writes | Do not retry under same authority; obtain approved role/process. |
| Revoked role grant | No new privileged action | Refresh current authorization; past attribution remains. |
| Revoked office membership | No new office action for that office | Require current membership; do not expose unrelated office details. |
| Resource outside permitted scope | No reads beyond authorized projection; no writes | Safe not-found/forbidden handling; do not disclose object existence. |
| Invalid workflow state | Roll back entire operation | Refresh current state; retry only if a valid transition remains available. |
| Stale version/revision | Roll back entire operation | Reload state and have the Tourism Officer determine whether a new operation is needed. |
| Duplicate official response | No second response or partial evidence | Return safe conflict or existing result for same idempotent request; do not silently overwrite. |
| Duplicate idempotency key, same payload | No repeated mutation | Return prior committed safe result or safe in-progress status. |
| Duplicate idempotency key, different payload | Reject, no mutation | Caller must create a new logical request with a new key after reviewing state. |
| Concurrent modification/deadlock/serialization conflict | Failed attempt rolls back completely | Retry complete operation with same key where appropriate, fresh state and authorization checks, bounded by approved retry policy. |
| Failed final-review readiness gate | No decision/status/notification intent | Return a safe readiness failure to authorized Officer; refresh responsibility evidence and resolve through valid workflow. |
| Invalid resolution/cancellation | No resolution/cancellation effect | Escalate for authorized policy clarification; mandatory bypass attempt remains denied. |
| Missing required event/status/audit evidence | Parent mutation rolls back | Investigate persistent storage/constraint issue; do not return success-shaped result. |
| Failure to record required notification intent | Mandated workflow mutation rolls back with its status/event writes | Repair the in-transaction failure and retry idempotently; later provider failure is a separate delivery concern. |
| External notification failure | Workflow transaction remains committed; delivery attempt records failure | Retry delivery independently under approved policy. |
| Storage/upload failure | No incomplete submission/version pointer or successful workflow state | External objects are not part of the PostgreSQL transaction. Clean up only unreferenced objects under separately approved Storage behavior; Storage authorization and orphan cleanup are deferred. |

Exact application error codes and user-facing messages are not specified here.

## 12. Authorization and Stage 4 dependencies

Every privileged operation must enforce Stage 4's authorization model at the point of mutation. Authorization is checked from trusted server/database context and current relationships, not from browser claims.

### 12.1 Boundaries every operation must preserve

- Resolve authenticated identity to exactly the actor profile; do not accept caller-supplied actor profile, role, membership, or grant IDs as authority.
- Check the current active role grant for the requested action and exact resource scope. Check current active `external_approver` grant **and** membership in the assignment's exact office for office responses.
- Revoked/inactive grants and ended memberships preserve historical evidence but cannot authorize new actions.
- Admin does not automatically acquire `approver`, overall decision authority, or access to confidential document content.
- External approvers act only within their assigned office responsibilities and review cycle; no office-to-office forwarding or overall decision.
- Sensitive fields require PostgreSQL grants/column privileges or controlled safe projections in addition to row-level RLS. RLS alone does not hide columns in an otherwise readable row.
- Any operation running with elevated database rights must be narrowly scoped, derive/validate the actual actor, preserve effective RLS/grant boundaries, and not use a general service-role bypass for user-scoped operations.

### 12.2 Stage 4 dependency status

Stage 4 is a design document, not deployed evidence. Its corrected text at the time of this specification explicitly addresses some design controls and leaves their implementation unverified:

| Topic | Stage 4 design status | Stage 5 dependency |
|---|---|---|
| Self-grants/self-elevation | Explicitly prohibited in Stage 4 §§2.1, 4, 5.1 and proposed tests | Every role-grant operation must enforce it. This is a design rule, not evidence of working code/database control. |
| Privileged `approver` grant governance | Unresolved; Stage 4 §§2.1 and 11.2 require MTO confirmation and fail-closed behavior | No unconfirmed actor may create, modify, or revoke privileged workflow grants. Tourism Head/Admin is not automatically an approver. |
| Column-level protection | Stage 4 §5.1 distinguishes grants, RLS, column privileges, and safe projections; direct-read tests are proposed | Final allowed columns/views and effective PostgREST/database grants must be selected and tested against approved schema. |
| UPDATE `USING` / UPDATE `WITH CHECK` | Stage 4 §5.1 conceptually distinguishes existing-row and resulting-row checks, with ownership/scope examples | Any direct update permitted later must specify both semantics; current preferred design denies broad direct workflow updates. |
| Safe privileged function ownership and EXECUTE | Stage 4 §7 recommends invoker default, narrowly justified definer functions, safe search path, schema qualification, least-privilege owner, and explicit EXECUTE grants | Exact function owners, privileges, callers, and SECURITY DEFINER risk checks remain implementation design/review tasks; none have been verified or approved here. |
| Role/membership management | Stage 4 identifies Admin's system-management scope but leaves authority details unresolved | Operations that assign/revoke office membership must use the approved process and audit actual grantor/affected user; do not infer a privileged-role hierarchy. |
| Office response attribution | Stage 4 and Stage 3 require current exact-office membership, active role grant, actual actor, and cycle scope | Validate context at transaction time and preserve references historically. |
| Admin content access | No automatic content bypass; oversight visibility unresolved | Do not add content reads to administrative operations by default. |

These distinctions avoid claiming that a documented control is deployed. Any uncertainty in actual authorization, active-state representation, or database privilege behavior is a blocker for implementation, not a reason to default open.

## 13. Test and validation matrix

All cases below are **proposed and not executed**. Use isolated fixtures and no real notification recipients. Database tests validate authoritative constraints/transactions/RLS/grants; application tests validate request handling and actor derivation. Test each boundary independently and in combination.

| # | Scenario | Expected result / integrity property | Validation layer |
|---:|---|---|---|
| 1 | Submit a valid initial submission | Owner, first version, initial-review status/history commit together; no office auto-route | Database + application |
| 2 | Fail first-version or required history write during submit | Entire submission operation rolls back; no submitted status | Database transaction |
| 3 | Submit with a forged owner/profile identifier | Actor remains authenticated submitter or request is rejected | Application + database |
| 4 | Tourism Officer completes initial review with no additional offices | Path A can enter final review without office assignment, subject to approved lifecycle | Workflow integration |
| 5 | Initial screening requests correction versus final rejection | Outcomes remain distinct; rejection has reason/history and cannot route; return remains correctable | Database + application |
| 6 | Create simultaneous office assignments | Selected offices proceed independently; Tourism Officer remains coordinator | Workflow integration |
| 7 | Add an office while simultaneous reviews are active | New work is appended; existing office cycles/responses remain unchanged and continue | Database concurrency |
| 8 | One-at-a-time routing after response review | Only explicit Tourism Officer decision creates next assignment; no automatic forwarding | Database + application |
| 9 | Office suggests another office | Suggestion does not create an assignment absent Officer action | Authorization + workflow |
| 10 | One assignment contains multiple mandatory/evaluation/recommendation responsibilities | Each responsibility has separate type and outcome scope; no assignment-level collapsing | Model/integration |
| 11 | Mandatory response is denied or unresolved | Overall approval fails; downgrade, generic resolution, or cancellation cannot bypass | Transaction + negative test |
| 12 | Negative evaluation is submitted | Response requirement is met; negative evaluation alone is not an automatic veto | Readiness operation |
| 13 | Negative recommendation is submitted | Recommendation is recorded as advisory; no automatic veto | Readiness operation |
| 14 | Valid permitted nonmandatory resolution is used | Only approved responsibility type/case can use it; it cannot substitute for a required evaluation/recommendation response or mandatory approval | Database + policy test |
| 15 | Active responsibility has no effective basis | Final-review gate blocks decision; Evaluation/Recommendation require official responses and mandatory approval requires an approved official response | Transaction |
| 16 | Validly cancelled responsibility satisfies approved safeguards | Excluded from active readiness only as permitted; complete history retained | Transaction + audit |
| 17 | Two representatives respond to the same cycle simultaneously | At most one official response; losing request leaves no partial events/attachments | Database concurrency |
| 18 | Response targets another office/responsibility/cycle | Rejected without cross-office disclosure or mutation | RLS + operation |
| 19 | Response references mismatched submission version/revision | Rejected; cycle remains bound to its exact target | Database integrity |
| 20 | Attempt assignment-wide uniqueness across two independent cycles | Both independent cycle responses can exist; one response never satisfies both | Model/integration |
| 21 | Office response attempts overall decision or formal sender return | Denied; only Tourism Officer has those workflow actions | Authorization |
| 22 | Tourism Officer review of response | Append separate review action; original official response remains immutable | Database transaction |
| 23 | Submitter correction creates a new version | Prior version/decisions remain; current pointer and history update atomically | Database + application |
| 24 | Old cycle response arrives after corrected version | It remains attached to its old target; is not silently effective for new version | Concurrency + integrity |
| 25 | Selective reassessment | New cycles only for selected responsibilities; unaffected prior response is retained | Transaction |
| 26 | Unaffected prior response is applicable to new target | Explicit target-specific Officer confirmation required and counted once | Transaction + integrity |
| 27 | Invalidate applicability then retry old response | Invalidation is append-only; old response is not automatically reactivated | Database history |
| 28 | Superseded cycle and applicability both exist | Readiness excludes superseded/invalidated basis and never double-counts | Readiness calculation |
| 29 | Admin without `approver` grant attempts routing/overall decision | Denied despite admin role | Database + application |
| 30 | Actor attempts self-grant or unauthorized privileged role grant | Denied; grantor and affected user attribution cannot be forged | Database + application |
| 31 | Revoked role/membership used for a new action | Denied; historical response actor context remains intact | Transaction + RLS |
| 32 | Two final decisions race | At most one terminal decision under approved no-reopen rule; status history matches winner | Database concurrency |
| 33 | Tourism Officer attempts approval while a required office response is uncommitted | Approval fails readiness if it acquires the shared submission lock first; response may then commit if eligible and approval may be retried | Database concurrency |
| 34 | Two route edits race on same round | No lost update or duplicate conflicting assignment; stale action refreshes | Database concurrency |
| 35 | Two reassessment requests race | No duplicate active cycles/effective basis; same idempotent request replays | Database concurrency |
| 36 | Same idempotency key, same request fingerprint | Safe prior result returned; no duplicate business/event/notification records | Database + application |
| 37 | Same idempotency key, different payload | Rejected without mutation | Database + application |
| 38 | Commit succeeds but client loses response | Retry returns committed result and does not repeat operation | Database + application |
| 39 | Direct PostgREST call bypasses frontend validation | Grants/RLS/checked operation reject unauthorized write | Database security |
| 40 | Direct read requests restricted sensitive fields on readable row | Restricted columns unavailable except approved projection | Database privilege + PostgREST |
| 41 | Invalid `UPDATE USING` or `WITH CHECK` scope change | Unauthorized existing-row update or resulting unauthorized scope is rejected | Database RLS/grants |
| 42 | SECURITY DEFINER operation has unsafe owner/path/EXECUTE | Security review fails; no unbounded RLS bypass or unauthorized execution | Database catalog + tests |
| 43 | Required domain/status/audit event write fails | Associated workflow operation rolls back completely | Database transaction |
| 44 | Notification provider unavailable after decision commit | Decision/status remain committed; delivery failure/attempt recorded and retryable | Worker + integration |
| 45 | Retry failed email/SMS | Delivery retried without rerunning workflow mutation or duplicating intent | Worker + delivery tests |
| 46 | Unauthorized/ambiguous notification recipient | No notification is sent; workflow remains valid and policy failure is visible for safe remediation | Database + worker |
| 47 | Attempt to send provider request from trigger/inside transaction | Architecture review rejects the implicit external side effect | Design review |
| 48 | A points award is coupled to approval before eligibility rules are resolved | No unapproved award behavior is introduced; points remain outside this operation design | Policy/design review |
| 49 | Office or Admin attempts Storage/offline-evidence access changes | No change is made under this Stage 5 design; separate approval required | Scope/security review |
| 50 | Add a responsibility to an existing assignment while its other responsibilities are under simultaneous review | New responsibility is appended under the shared submission lock; existing cycles/responses remain unchanged and proceed independently | Database concurrency |
| 51 | Add an office/responsibility while final approval is attempted | If addition wins, approval sees the new active responsibility and fails readiness until satisfied; if approval wins, addition is rejected as terminal; no partial assignment | Database concurrency |
| 52 | Final approval is attempted while a required response remains uncommitted | Approval cannot commit without the required response, regardless of which request started first | Database concurrency |
| 53 | Required response commits before final approval attempt | Response remains attached to its exact eligible cycle; a later approval retry re-evaluates the complete active gate and succeeds only if all requirements pass | Database concurrency |
| 54 | Concurrent requests add the same logical responsibility with the same idempotency key/payload | One complete mutation commits; the other returns the same committed result without duplicate assignment/responsibility/event records | Database concurrency + idempotency |
| 55 | Two applicability confirmations race for the same target basis | Shared submission/target synchronization permits at most one effective basis; same-key retry replays, conflicting request fails without duplicate history | Database concurrency |
| 56 | Responsibility cancellation races with final review | Both serialize through the submission aggregate; approval sees only a validly authorized cancellation, or cancellation is rejected after incompatible terminal decision | Database concurrency |
| 57 | Review cycle combines a version belonging to another submission | Rejected despite each identifier being individually valid; composite same-submission relationship is enforced | Database integrity |
| 58 | Review cycle combines a responsibility revision belonging to another submission/responsibility | Rejected; exact cycle target relationships remain same-submission and same-responsibility | Database integrity |
| 59 | Response attachment links to an unrelated response or submission | Rejected even when both attachment and response IDs exist independently | Database integrity |
| 60 | Applicability confirmation uses the wrong target submission/version/revision | Rejected; original response and target must share the exact submission and logical responsibility context | Database integrity |
| 61 | Decision evidence links an unrelated response | Rejected by typed same-submission/evidence validation | Database integrity |
| 62 | Assignment and responsibility references cross submission boundaries | Rejected even if both parent identifiers exist independently | Database integrity |
| 63 | Assignment creation succeeds but responsibility creation fails | Entire routing/assignment operation rolls back; no empty/partial assignment or success idempotency result remains | Database transaction failure injection |
| 64 | Office response insert succeeds but actor/event evidence recording fails | Entire response transaction rolls back, including response, attribution, attachments, and required intent | Database transaction failure injection |
| 65 | Overall decision insert succeeds but required status-history recording fails | Entire decision transaction rolls back; no decision without its status/history or required intent | Database transaction failure injection |
| 66 | Reassessment creates some selected cycles before a later selected responsibility fails validation | Entire selected-set transaction rolls back; no partial new cycles/applicability/projection changes; prior history remains intact | Database transaction failure injection |
| 67 | Applicability-history write fails | Confirmation and any associated readiness/projection changes roll back; no effective-basis change remains | Database transaction failure injection |
| 68 | Required notification-intent recording fails | Underlying mandated workflow operation rolls back; distinguish this from later provider-delivery failure, which does not roll back workflow state | Database transaction failure injection |
| 69 | Object upload succeeds but required database attachment metadata/version persistence fails | No submitted/resubmitted workflow state or partial database version remains; unreferenced object may require separate cleanup | Integration + database transaction |
| 70 | Worker is interrupted after claiming a delivery | Expired lease/equivalent recovery makes work claimable again; attempt and claim history remain traceable | Worker recovery |
| 71 | Provider may have accepted a notification but worker loses the response | Outcome is recorded as unknown; retry uses provider idempotency where supported and does not claim exactly-once delivery | Worker + provider integration |
| 72 | Initial final rejection or overall final decision commits | Required submitter notification intent/recipient is present atomically; provider delivery occurs post-commit and cannot roll back the decision | Database transaction + worker |

## 14. Technical and institutional open decisions

### 14.1 Technical decisions

- Final operation composition for commands that intentionally combine logical actions; selective reassessment itself is one atomic transaction over its explicitly selected responsibility set.
- Per-operation lock target, lock order, optimistic version tokens, transaction isolation, and retry bounds.
- Meaning of active cycle, cycle closure/supersession, and effective-basis calculation across response/applicability/resolution.
- Exact idempotency scope, canonical fingerprint rules, result representation, and expiration/cleanup.
- Whether Stage 3 notification/delivery/attempt concepts need an approved model extension for worker claims, lease expiry/recovery, and ambiguous provider outcomes; these capabilities are not explicitly represented in the current proposal.
- Same-submission composite integrity enforcement and final model reconciliation against existing TEST structures before any implementation.
- Shared submission-level serialization implementation, ordered child-lock acquisition, current-state projection strategy, and how every projection remains transactionally aligned with append-only history.
- Safe database roles, function ownership, EXECUTE grants, SECURITY DEFINER use, and direct table/column grants. Stage 4 recommendations do not prove deployed privileges.
- Required audit event coverage, privacy-minimized metadata, access scope, and retention implementation.
- Version upload/storage coordination and safe cleanup for unreferenced files; actual Storage design is deferred.
- Test strategy, fixture management, and concurrency harness before implementation.

### 14.2 Institutional / MTO / dean decisions

- How the canonical “one official decision per active assignment” wording relates to independent responsibility outcomes and Stage 3's one-response-per-responsibility-cycle recommendation.
- Whether one representative must submit a batch of otherwise independent cycle-level responses; batching remains optional and no `response_batches` entity is assumed.
- Which nonmandatory responsibilities, if any, may be resolved without an office response.
- Whether any exceptional mandatory responsibility cancellation can ever be valid; no bypass is allowed absent explicit approved policy.
- Initial-review and overall rejection criteria.
- Whether/how approved or rejected submissions may be reopened.
- Exact meanings and conditions for `COMPLETED`, `WITHDRAWN`, and other lifecycle statuses.
- Office authority mapping and meanings/precedence of Department Only, External Only, External + Department, and Multiple Offices.
- Who may grant Tourism Officer (`approver`) authority; whether Admin may grant privileged roles to another person; role/membership governance.
- Admin access to confidential document content, internal review notes, and messages; historical access and retention after membership revocation/completion.
- Notification channels, providers, timing, retry/retention policies, and recipients for events beyond the submitter notices required by the workflow.
- Deadlines and escalation rules.
- Offline approval evidence and Storage access/retention policies (deferred; requires separate consultation).
- Points eligibility, calculation, recipient, and reversal handling; reports and analytics requirements/access.

No answer to these items is implied by a current UI, database object, function, or historical TEST observation.

## 15. Implementation readiness and next stage

### 15.1 Sufficiently specified for later design/implementation planning

- Logical atomicity and rollback requirement for workflow mutations and required history.
- Tourism Officer-only control of routing, response review, reassessment, formal returns, and overall decisions.
- Distinct simultaneous and one-at-a-time routing; ability to add an office during simultaneous review without disturbing ongoing work.
- Independent responsibility-level readiness; mandatory approval safeguard; non-veto evaluation/recommendation semantics.
- Exact version/revision cycle binding and historical preservation.
- One response per responsibility cycle as the recommended Stage 3 model, with the canonical assignment-level wording kept open.
- Shared submission-level serialization for final-readiness changes and atomic reassessment of the explicitly selected responsibility set, subject to Stage 3 model review.
- Authorization checked at action time; actual actor attribution; Admin separation; exact-office membership requirement.
- Idempotency and safe retry requirements; no external notification call within core transaction.
- Domain events, status history, and generic audit evidence remain distinct and are written atomically where required.

### 15.2 Blocked by Stage 4 authorization dependencies

- Actual role-grant/office-membership operation authority, especially privileged `approver` grant governance and Admin's ability to grant privileged roles.
- Effective database grants, column access/safe projections, RLS, `UPDATE USING`/`WITH CHECK`, and direct PostgREST behavior are unverified.
- Exact function owners, SECURITY DEFINER boundaries, `search_path`, and EXECUTE grants are not implemented or verified.
- No function or application operation may be implemented by assuming these controls already exist in TEST or Production.

Stage 4 explicitly specifies self-grant denial, column-level controls, and `UPDATE USING`/`WITH CHECK` semantics as design requirements; their runtime enforcement remains unverified. Privileged grant governance remains institutionally unresolved and must fail closed.

### 15.3 Blocked by Stage 3/model uncertainty

- Schema/entity names, same-submission constraints, active-cycle semantics, effective-basis exclusivity, and terminal decision constraints remain proposed.
- The response-per-cycle recommendation must be reconciled with the authoritative assignment-level sentence before schema freeze.
- Existing TEST workflow structures must be read-only reconciled before choosing or migrating a canonical model. Local migrations are not proof of deployed state.
- Notification/delivery structures and idempotency semantics require final schema review; worker lease recovery and ambiguous provider-outcome handling are not explicitly represented in Stage 3 and remain proposed model gaps.

### 15.4 Blocked by institutional confirmation

- Office authority, path labels, valid resolution/cancellation, rejection criteria, status/closure semantics, notification channel/provider/timing/retry rules and non-mandated recipients, privileged-role grant governance, and other open questions in Section 14.2. The workflow-mandated submitter notification intents are not optional policy decisions.
- Decisions cannot be inferred from legacy functions, current role labels, old status transitions, or historical test database observations.

### 15.5 Deferred

- Production access or changes; TEST connection or database changes; SQL, functions, triggers, migrations, deployment, and application implementation.
- Storage policies, signed-URL rules, file access/retention implementation, and offline approval evidence.
- External email/SMS provider integration and actual delivery policy.
- Points/reward calculation and reporting policy.

### 15.6 Preconditions before implementation

1. Approve applicable MTO/dean decisions without reopening settled workflow requirements.
2. Reconcile existing TEST models and data read-only; select a canonical model and migration/data-preservation plan only after evidence and approval.
3. Review/approve Stage 3 entities, response cardinality, cycle/applicability/resolution model, and exact lifecycle contract.
4. Approve Stage 4 role, resource, column, RLS, function-owner, and EXECUTE boundaries, including a fail-closed privileged grant process.
5. Design concrete operation contracts and map each invariant to a declarative constraint, transaction validation, authorization check, or narrowly justified trigger.
6. Define locking/optimistic checks, isolation choices, lock ordering, idempotency behavior, and retry strategy from the selected model.
7. Approve notification event/recipient/channel/timing and determine whether Stage 3 delivery structures suffice.
8. Prepare isolated database and application tests, including concurrency, idempotency, RLS, direct REST access, revocation, and failure injection. Do not use real recipients.
9. Obtain separate explicit authorization before any code, SQL, database, TEST, or deployment work. Production remains out of scope absent separate authorization.

### 15.7 Recommended next sequence

1. Resolve applicable office/path/status/role-grant and notification decisions.
2. Complete read-only data/model reconciliation; approve one canonical relational and authorization contract.
3. Refine operation boundaries and exact transaction write sets against that approved model.
4. Specify grants/RLS/column access and narrowly scoped operation privileges together.
5. Add integrity constraints and transactional concurrency/idempotency controls.
6. Validate domain/status/audit atomicity and post-commit notification processing.
7. Run proposed database/application and concurrency tests in an explicitly authorized isolated environment.
8. Review deployed-state evidence read-only after separately approved implementation; do not infer deployment from local files.

**Readiness:** This document is ready for human architecture review only. It is not schema-frozen, does not approve any MTO/dean policy, does not establish deployed authorization, and does not authorize implementation or migration.
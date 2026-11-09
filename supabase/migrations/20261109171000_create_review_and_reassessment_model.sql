-- Clean CONNECT-Daet.ai schema, migration 3.
-- One official response is bound to one responsibility review cycle, as proposed
-- in Stage 3. This remains subject to MTO reconciliation with assignment wording.
-- Cycle lifecycle states and cancellation/resolution eligibility are deliberately
-- not enumerated until their semantics are approved.

BEGIN;

CREATE TABLE public.responsibility_resolutions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id uuid NOT NULL,
  assignment_id uuid NOT NULL,
  responsibility_id uuid NOT NULL,
  responsibility_revision_id uuid NOT NULL,
  submission_version_id uuid NOT NULL,
  resolution_kind text NOT NULL CHECK (nullif(btrim(resolution_kind), '') IS NOT NULL),
  actor_profile_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
  approver_grant_id uuid NOT NULL REFERENCES public.role_grants (id) ON DELETE RESTRICT,
  reason text NOT NULL CHECK (nullif(btrim(reason), '') IS NOT NULL),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT responsibility_resolutions_revision_fk
    FOREIGN KEY (submission_id, assignment_id, responsibility_id, responsibility_revision_id)
    REFERENCES public.office_responsibility_revisions
      (submission_id, assignment_id, responsibility_id, id) ON DELETE RESTRICT,
  CONSTRAINT responsibility_resolutions_version_fk
    FOREIGN KEY (submission_id, submission_version_id)
    REFERENCES public.submission_versions (submission_id, id) ON DELETE RESTRICT,
  CONSTRAINT responsibility_resolutions_target_unique UNIQUE
    (submission_id, responsibility_id, responsibility_revision_id, submission_version_id, id)
);

CREATE TABLE public.review_cycles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id uuid NOT NULL,
  assignment_id uuid NOT NULL,
  office_id uuid NOT NULL,
  responsibility_id uuid NOT NULL,
  submission_version_id uuid NOT NULL,
  responsibility_revision_id uuid NOT NULL,
  cycle_number integer NOT NULL CHECK (cycle_number > 0),
  created_by_profile_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
  created_by_approver_grant_id uuid NOT NULL REFERENCES public.role_grants (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT review_cycles_assignment_office_fk
    FOREIGN KEY (submission_id, assignment_id, office_id)
    REFERENCES public.office_assignments (submission_id, id, office_id) ON DELETE RESTRICT,
  CONSTRAINT review_cycles_responsibility_fk
    FOREIGN KEY (submission_id, assignment_id, responsibility_id)
    REFERENCES public.office_responsibilities (submission_id, assignment_id, id) ON DELETE RESTRICT,
  CONSTRAINT review_cycles_version_fk
    FOREIGN KEY (submission_id, submission_version_id)
    REFERENCES public.submission_versions (submission_id, id) ON DELETE RESTRICT,
  CONSTRAINT review_cycles_revision_fk
    FOREIGN KEY (submission_id, assignment_id, responsibility_id, responsibility_revision_id)
    REFERENCES public.office_responsibility_revisions
      (submission_id, assignment_id, responsibility_id, id) ON DELETE RESTRICT,
  CONSTRAINT review_cycles_cycle_number_unique UNIQUE (responsibility_id, cycle_number),
  CONSTRAINT review_cycles_submission_id_unique UNIQUE (submission_id, id),
  CONSTRAINT review_cycles_full_context_unique UNIQUE
    (submission_id, id, assignment_id, office_id, responsibility_id,
      submission_version_id, responsibility_revision_id)
);

CREATE INDEX review_cycles_submission_history_idx
  ON public.review_cycles (submission_id, created_at, id);
CREATE INDEX review_cycles_office_queue_idx
  ON public.review_cycles (office_id, created_at, id);
CREATE INDEX review_cycles_responsibility_target_idx
  ON public.review_cycles
    (responsibility_id, submission_version_id, responsibility_revision_id, cycle_number);

CREATE TABLE public.review_cycle_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id uuid NOT NULL,
  review_cycle_id uuid NOT NULL,
  event_kind text NOT NULL CHECK (nullif(btrim(event_kind), '') IS NOT NULL),
  actor_profile_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
  role_grant_id uuid REFERENCES public.role_grants (id) ON DELETE RESTRICT,
  office_membership_id uuid REFERENCES public.office_memberships (id) ON DELETE RESTRICT,
  reason text,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT review_cycle_events_cycle_fk
    FOREIGN KEY (submission_id, review_cycle_id)
    REFERENCES public.review_cycles (submission_id, id) ON DELETE RESTRICT
);

CREATE INDEX review_cycle_events_history_idx
  ON public.review_cycle_events (review_cycle_id, created_at, id);

CREATE TABLE public.review_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id uuid NOT NULL,
  review_cycle_id uuid NOT NULL,
  assignment_id uuid NOT NULL,
  office_id uuid NOT NULL,
  responsibility_id uuid NOT NULL,
  submission_version_id uuid NOT NULL,
  responsibility_revision_id uuid NOT NULL,
  submitted_by_profile_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
  office_membership_id uuid NOT NULL,
  external_approver_grant_id uuid NOT NULL,
  external_approver_role public.workflow_role NOT NULL DEFAULT 'external_approver'
    CHECK (external_approver_role = 'external_approver'),
  outcome text NOT NULL CHECK (nullif(btrim(outcome), '') IS NOT NULL),
  findings text,
  remarks text,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT review_responses_cycle_fk
    FOREIGN KEY (submission_id, review_cycle_id, assignment_id, office_id,
      responsibility_id, submission_version_id, responsibility_revision_id)
    REFERENCES public.review_cycles (submission_id, id, assignment_id, office_id,
      responsibility_id, submission_version_id, responsibility_revision_id)
    ON DELETE RESTRICT,
  CONSTRAINT review_responses_cycle_unique UNIQUE (review_cycle_id),
  CONSTRAINT review_responses_submission_id_unique UNIQUE (submission_id, id),
  CONSTRAINT review_responses_submission_responsibility_unique
    UNIQUE (submission_id, id, responsibility_id),
  CONSTRAINT review_responses_membership_actor_office_fk
    FOREIGN KEY (office_membership_id, submitted_by_profile_id, office_id)
    REFERENCES public.office_memberships (id, profile_id, office_id) ON DELETE RESTRICT,
  CONSTRAINT review_responses_role_grant_actor_role_fk
    FOREIGN KEY (external_approver_grant_id, submitted_by_profile_id, external_approver_role)
    REFERENCES public.role_grants (id, profile_id, role) ON DELETE RESTRICT
);

CREATE INDEX review_responses_submission_history_idx
  ON public.review_responses (submission_id, submitted_at, id);
CREATE INDEX review_responses_actor_history_idx
  ON public.review_responses (submitted_by_profile_id, submitted_at DESC);

CREATE TABLE public.review_response_attachments (
  submission_id uuid NOT NULL,
  review_response_id uuid NOT NULL,
  attachment_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (submission_id, review_response_id, attachment_id),
  CONSTRAINT review_response_attachments_response_fk
    FOREIGN KEY (submission_id, review_response_id)
    REFERENCES public.review_responses (submission_id, id) ON DELETE RESTRICT,
  CONSTRAINT review_response_attachments_attachment_fk
    FOREIGN KEY (submission_id, attachment_id)
    REFERENCES public.attachments (submission_id, id) ON DELETE RESTRICT
);

CREATE TABLE public.tourism_officer_response_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id uuid NOT NULL,
  review_response_id uuid NOT NULL,
  actor_profile_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
  approver_grant_id uuid NOT NULL REFERENCES public.role_grants (id) ON DELETE RESTRICT,
  disposition text NOT NULL CHECK (nullif(btrim(disposition), '') IS NOT NULL),
  reason text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT officer_response_reviews_response_fk
    FOREIGN KEY (submission_id, review_response_id)
    REFERENCES public.review_responses (submission_id, id) ON DELETE RESTRICT,
  CONSTRAINT officer_response_reviews_submission_id_unique UNIQUE (submission_id, id)
);

CREATE INDEX officer_response_reviews_response_history_idx
  ON public.tourism_officer_response_reviews (review_response_id, created_at, id);

CREATE TABLE public.response_applicability (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id uuid NOT NULL,
  responsibility_id uuid NOT NULL,
  original_response_id uuid NOT NULL,
  target_submission_version_id uuid NOT NULL,
  target_responsibility_revision_id uuid NOT NULL,
  confirming_profile_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
  approver_grant_id uuid NOT NULL REFERENCES public.role_grants (id) ON DELETE RESTRICT,
  reason text NOT NULL CHECK (nullif(btrim(reason), '') IS NOT NULL),
  confirmed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT response_applicability_response_fk
    FOREIGN KEY (submission_id, original_response_id, responsibility_id)
    REFERENCES public.review_responses (submission_id, id, responsibility_id)
    ON DELETE RESTRICT,
  CONSTRAINT response_applicability_submission_id_unique
    UNIQUE (submission_id, id),
  CONSTRAINT response_applicability_target_version_fk
    FOREIGN KEY (submission_id, target_submission_version_id)
    REFERENCES public.submission_versions (submission_id, id) ON DELETE RESTRICT,
  CONSTRAINT response_applicability_target_revision_fk
    FOREIGN KEY (submission_id, responsibility_id, target_responsibility_revision_id)
    REFERENCES public.office_responsibility_revisions
      (submission_id, responsibility_id, id) ON DELETE RESTRICT,
  CONSTRAINT response_applicability_target_unique_context UNIQUE
    (submission_id, id, responsibility_id, target_submission_version_id,
      target_responsibility_revision_id)
);

CREATE INDEX response_applicability_target_idx
  ON public.response_applicability
    (responsibility_id, target_submission_version_id, target_responsibility_revision_id);

CREATE TABLE public.response_applicability_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id uuid NOT NULL,
  applicability_id uuid NOT NULL,
  event_kind text NOT NULL CHECK (event_kind IN ('invalidated', 'superseded')),
  actor_profile_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
  approver_grant_id uuid NOT NULL REFERENCES public.role_grants (id) ON DELETE RESTRICT,
  reason text NOT NULL CHECK (nullif(btrim(reason), '') IS NOT NULL),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT applicability_events_confirmation_fk
    FOREIGN KEY (submission_id, applicability_id)
    REFERENCES public.response_applicability (submission_id, id) ON DELETE RESTRICT
);

CREATE INDEX applicability_events_history_idx
  ON public.response_applicability_events (applicability_id, created_at, id);

GRANT SELECT ON public.responsibility_resolutions TO connect_daet_workflow_executor;
GRANT SELECT, INSERT ON public.review_cycles,
  public.review_cycle_events, public.review_responses, public.review_response_attachments,
  public.tourism_officer_response_reviews, public.response_applicability,
  public.response_applicability_events TO connect_daet_workflow_executor;

COMMIT;

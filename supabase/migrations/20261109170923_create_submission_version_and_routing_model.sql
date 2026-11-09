-- Clean CONNECT-Daet.ai schema, migration 2.
-- Status names are the narrow workflow projection needed by the documented paths.
-- COMPLETED, WITHDRAWN, reopening, office status vocabulary, and path labels remain unresolved.

BEGIN;

CREATE TABLE public.document_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE CHECK (nullif(btrim(code), '') IS NOT NULL),
  name text NOT NULL CHECK (nullif(btrim(name), '') IS NOT NULL),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.workflow_tracking_sequences (
  tracking_year integer PRIMARY KEY
    CHECK (tracking_year BETWEEN 2000 AND 9999),
  last_sequence integer NOT NULL DEFAULT 0
    CHECK (last_sequence BETWEEN 0 AND 999999)
);

CREATE FUNCTION public.generate_workflow_tracking_number()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $generate_workflow_tracking_number$
DECLARE
  current_year integer := extract(year from current_date)::integer;
  next_sequence integer;
BEGIN
  INSERT INTO public.workflow_tracking_sequences (tracking_year, last_sequence)
  VALUES (current_year, 1)
  ON CONFLICT (tracking_year)
  DO UPDATE SET last_sequence =
    public.workflow_tracking_sequences.last_sequence + 1
  WHERE public.workflow_tracking_sequences.last_sequence < 999999
  RETURNING last_sequence INTO next_sequence;

  IF next_sequence IS NULL THEN
    RAISE EXCEPTION 'Tracking number sequence exhausted for year %', current_year;
  END IF;

  RETURN pg_catalog.format(
    'DAET-%s-%s', current_year, pg_catalog.lpad(next_sequence::text, 6, '0')
  );
END;
$generate_workflow_tracking_number$;
REVOKE ALL ON FUNCTION public.generate_workflow_tracking_number()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_workflow_tracking_number()
  TO connect_daet_workflow_executor;
GRANT SELECT, INSERT, UPDATE ON public.workflow_tracking_sequences
  TO connect_daet_workflow_executor;

CREATE TABLE public.submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submitter_profile_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
  document_type_id uuid REFERENCES public.document_types (id) ON DELETE RESTRICT,
  tracking_number text NOT NULL UNIQUE
    CHECK (tracking_number ~ '^DAET-[0-9]{4}-[0-9]{6}$'),
  title text NOT NULL CHECK (nullif(btrim(title), '') IS NOT NULL),
  description text,
  destination_department text,
  state public.submission_state NOT NULL DEFAULT 'draft',
  current_version_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT submissions_id_state_unique UNIQUE (id, state),
  CONSTRAINT submissions_id_submitter_unique UNIQUE (id, submitter_profile_id)
);

CREATE FUNCTION public.maintain_submission_tracking_number()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $maintain_submission_tracking_number$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF nullif(btrim(NEW.tracking_number), '') IS NULL THEN
      NEW.tracking_number := public.generate_workflow_tracking_number();
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.tracking_number IS DISTINCT FROM OLD.tracking_number THEN
    RAISE EXCEPTION 'A submission tracking number cannot be changed';
  END IF;
  RETURN NEW;
END;
$maintain_submission_tracking_number$;
REVOKE ALL ON FUNCTION public.maintain_submission_tracking_number()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.maintain_submission_tracking_number()
  TO connect_daet_workflow_executor;

CREATE TRIGGER generate_submission_tracking_number
BEFORE INSERT ON public.submissions
FOR EACH ROW
EXECUTE FUNCTION public.maintain_submission_tracking_number();

CREATE TRIGGER protect_submission_tracking_number
BEFORE UPDATE OF tracking_number ON public.submissions
FOR EACH ROW
EXECUTE FUNCTION public.maintain_submission_tracking_number();

CREATE INDEX submissions_owner_created_idx
  ON public.submissions (submitter_profile_id, created_at DESC);
CREATE INDEX submissions_state_created_idx
  ON public.submissions (state, created_at);

CREATE TABLE public.submission_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id uuid NOT NULL REFERENCES public.submissions (id) ON DELETE RESTRICT,
  version_number integer NOT NULL CHECK (version_number > 0),
  uploaded_by_profile_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT submission_versions_submission_version_unique UNIQUE (submission_id, version_number),
  CONSTRAINT submission_versions_submission_id_unique UNIQUE (submission_id, id)
);

ALTER TABLE public.submissions
  ADD CONSTRAINT submissions_current_version_same_submission_fk
  FOREIGN KEY (id, current_version_id)
  REFERENCES public.submission_versions (submission_id, id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE public.attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id uuid NOT NULL REFERENCES public.submissions (id) ON DELETE RESTRICT,
  uploaded_by_profile_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
  original_filename text NOT NULL CHECK (nullif(btrim(original_filename), '') IS NOT NULL),
  content_type text,
  byte_size bigint CHECK (byte_size IS NULL OR byte_size >= 0),
  object_key text NOT NULL CHECK (nullif(btrim(object_key), '') IS NOT NULL),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT attachments_submission_id_unique UNIQUE (submission_id, id)
);

CREATE TABLE public.submission_version_attachments (
  submission_id uuid NOT NULL,
  submission_version_id uuid NOT NULL,
  attachment_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (submission_id, submission_version_id, attachment_id),
  CONSTRAINT submission_version_attachments_version_fk
    FOREIGN KEY (submission_id, submission_version_id)
    REFERENCES public.submission_versions (submission_id, id) ON DELETE RESTRICT,
  CONSTRAINT submission_version_attachments_attachment_fk
    FOREIGN KEY (submission_id, attachment_id)
    REFERENCES public.attachments (submission_id, id) ON DELETE RESTRICT
);

CREATE TABLE public.routing_rounds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id uuid NOT NULL REFERENCES public.submissions (id) ON DELETE RESTRICT,
  round_number integer NOT NULL CHECK (round_number > 0),
  mode public.routing_mode NOT NULL,
  initiated_by_profile_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
  initiating_approver_grant_id uuid NOT NULL REFERENCES public.role_grants (id) ON DELETE RESTRICT,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT routing_rounds_submission_round_unique UNIQUE (submission_id, round_number),
  CONSTRAINT routing_rounds_submission_id_unique UNIQUE (submission_id, id)
);

CREATE TABLE public.office_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id uuid NOT NULL REFERENCES public.submissions (id) ON DELETE RESTRICT,
  routing_round_id uuid NOT NULL,
  office_id uuid NOT NULL REFERENCES public.offices (id) ON DELETE RESTRICT,
  instructions text,
  created_by_profile_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
  created_by_approver_grant_id uuid NOT NULL REFERENCES public.role_grants (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  cancelled_at timestamptz,
  cancelled_by_profile_id uuid REFERENCES public.profiles (id) ON DELETE RESTRICT,
  cancellation_reason text,
  CONSTRAINT office_assignments_round_same_submission_fk
    FOREIGN KEY (submission_id, routing_round_id)
    REFERENCES public.routing_rounds (submission_id, id) ON DELETE RESTRICT,
  CONSTRAINT office_assignments_cancel_shape_check CHECK (
    (cancelled_at IS NULL AND cancelled_by_profile_id IS NULL AND cancellation_reason IS NULL)
    OR
    (cancelled_at IS NOT NULL AND cancelled_by_profile_id IS NOT NULL
      AND nullif(btrim(cancellation_reason), '') IS NOT NULL AND cancelled_at >= created_at)
  ),
  CONSTRAINT office_assignments_submission_id_unique UNIQUE (submission_id, id),
  CONSTRAINT office_assignments_submission_id_office_id_unique UNIQUE (submission_id, id, office_id)
);

-- Recommended Stage 3 default only; same-office concurrent assignments remain an
-- unresolved institutional/technical decision and can be relaxed in a reviewed migration.
CREATE UNIQUE INDEX office_assignments_one_active_office_per_submission_idx
  ON public.office_assignments (submission_id, office_id)
  WHERE cancelled_at IS NULL;

CREATE INDEX office_assignments_office_created_idx
  ON public.office_assignments (office_id, created_at DESC)
  WHERE cancelled_at IS NULL;

-- A deliberately empty, reviewable representation of office authority. Workflow
-- routing fails closed unless an approved mapping is recorded through a separately
-- authorized process; the migration makes no office-authority decisions.
CREATE TABLE public.office_responsibility_authorities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  office_id uuid NOT NULL REFERENCES public.offices (id) ON DELETE RESTRICT,
  responsibility_type public.responsibility_type NOT NULL,
  basis_reference text NOT NULL CHECK (nullif(btrim(basis_reference), '') IS NOT NULL),
  recorded_by_profile_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revoked_by_profile_id uuid REFERENCES public.profiles (id) ON DELETE RESTRICT,
  revocation_reason text,
  CONSTRAINT office_responsibility_authorities_revocation_check CHECK (
    (revoked_at IS NULL AND revoked_by_profile_id IS NULL AND revocation_reason IS NULL)
    OR
    (revoked_at IS NOT NULL AND revoked_by_profile_id IS NOT NULL
      AND nullif(btrim(revocation_reason), '') IS NOT NULL AND revoked_at >= recorded_at)
  )
);

CREATE UNIQUE INDEX office_responsibility_authorities_one_active_mapping_idx
  ON public.office_responsibility_authorities (office_id, responsibility_type)
  WHERE revoked_at IS NULL;

CREATE TABLE public.office_assignment_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id uuid NOT NULL,
  assignment_id uuid NOT NULL,
  event_kind text NOT NULL CHECK (nullif(btrim(event_kind), '') IS NOT NULL),
  actor_profile_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
  approver_grant_id uuid NOT NULL REFERENCES public.role_grants (id) ON DELETE RESTRICT,
  reason text,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT office_assignment_events_assignment_fk
    FOREIGN KEY (submission_id, assignment_id)
    REFERENCES public.office_assignments (submission_id, id) ON DELETE RESTRICT
);

CREATE INDEX office_assignment_events_history_idx
  ON public.office_assignment_events (assignment_id, created_at, id);

CREATE TABLE public.office_responsibilities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id uuid NOT NULL,
  assignment_id uuid NOT NULL,
  responsibility_key text,
  created_by_profile_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
  created_by_approver_grant_id uuid NOT NULL REFERENCES public.role_grants (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT office_responsibilities_assignment_fk
    FOREIGN KEY (submission_id, assignment_id)
    REFERENCES public.office_assignments (submission_id, id) ON DELETE RESTRICT,
  CONSTRAINT office_responsibilities_submission_id_unique UNIQUE (submission_id, id),
  CONSTRAINT office_responsibilities_assignment_responsibility_unique
    UNIQUE (submission_id, assignment_id, id)
);

CREATE INDEX office_responsibilities_assignment_idx
  ON public.office_responsibilities (submission_id, assignment_id);

CREATE TABLE public.office_responsibility_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id uuid NOT NULL,
  assignment_id uuid NOT NULL,
  responsibility_id uuid NOT NULL,
  revision_number integer NOT NULL CHECK (revision_number > 0),
  responsibility_type public.responsibility_type NOT NULL,
  scope text NOT NULL CHECK (nullif(btrim(scope), '') IS NOT NULL),
  instructions text,
  actor_profile_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
  approver_grant_id uuid NOT NULL REFERENCES public.role_grants (id) ON DELETE RESTRICT,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT responsibility_revisions_responsibility_fk
    FOREIGN KEY (submission_id, assignment_id, responsibility_id)
    REFERENCES public.office_responsibilities (submission_id, assignment_id, id) ON DELETE RESTRICT,
  CONSTRAINT responsibility_revisions_number_unique UNIQUE (responsibility_id, revision_number),
  CONSTRAINT responsibility_revisions_submission_id_unique UNIQUE (submission_id, id),
  CONSTRAINT responsibility_revisions_scope_unique
    UNIQUE (submission_id, assignment_id, responsibility_id, id),
  CONSTRAINT responsibility_revisions_responsibility_id_unique
    UNIQUE (submission_id, responsibility_id, id)
);

CREATE TABLE public.office_responsibility_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id uuid NOT NULL,
  assignment_id uuid NOT NULL,
  responsibility_id uuid NOT NULL,
  responsibility_revision_id uuid,
  event_kind text NOT NULL CHECK (nullif(btrim(event_kind), '') IS NOT NULL),
  actor_profile_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
  approver_grant_id uuid NOT NULL REFERENCES public.role_grants (id) ON DELETE RESTRICT,
  reason text,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT responsibility_events_responsibility_fk
    FOREIGN KEY (submission_id, assignment_id, responsibility_id)
    REFERENCES public.office_responsibilities (submission_id, assignment_id, id) ON DELETE RESTRICT,
  CONSTRAINT responsibility_events_revision_fk
    FOREIGN KEY (submission_id, assignment_id, responsibility_id, responsibility_revision_id)
    REFERENCES public.office_responsibility_revisions
      (submission_id, assignment_id, responsibility_id, id) ON DELETE RESTRICT
);

CREATE INDEX responsibility_events_history_idx
  ON public.office_responsibility_events (responsibility_id, created_at, id);

GRANT SELECT ON public.submissions, public.document_types TO connect_daet_workflow_executor;
GRANT SELECT, INSERT, UPDATE ON public.workflow_tracking_sequences
  TO connect_daet_workflow_executor;
GRANT INSERT (submitter_profile_id, document_type_id, title, description,
  destination_department, state, tracking_number)
  ON public.submissions TO connect_daet_workflow_executor;
GRANT UPDATE (state, current_version_id, updated_at)
  ON public.submissions TO connect_daet_workflow_executor;
GRANT INSERT ON public.submission_versions,
  public.attachments, public.submission_version_attachments, public.routing_rounds,
  public.office_assignments, public.office_assignment_events,
  public.office_responsibilities, public.office_responsibility_revisions,
  public.office_responsibility_events TO connect_daet_workflow_executor;
GRANT SELECT ON public.office_responsibility_authorities,
  public.office_assignments, public.office_responsibilities,
  public.office_responsibility_revisions TO connect_daet_workflow_executor;

COMMIT;

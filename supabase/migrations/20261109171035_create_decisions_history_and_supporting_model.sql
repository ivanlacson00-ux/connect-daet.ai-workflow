  -- Clean CONNECT-Daet.ai schema, migration 4.
  -- Status vocabulary is intentionally limited to documented workflow outcomes.
  -- Notification delivery retry/lease policy, points policy, message visibility,
  -- retention, and lifecycle closure rules remain unresolved or deferred.

  BEGIN;

  CREATE TABLE public.submission_decisions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    submission_id uuid NOT NULL,
    submission_version_id uuid NOT NULL,
    actor_profile_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
    approver_grant_id uuid NOT NULL REFERENCES public.role_grants (id) ON DELETE RESTRICT,
    decision_kind public.overall_decision_kind NOT NULL,
    stage public.decision_stage NOT NULL,
    reason text,
    correction_instructions text,
    supporting_context jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT submission_decisions_version_fk
      FOREIGN KEY (submission_id, submission_version_id)
      REFERENCES public.submission_versions (submission_id, id) ON DELETE RESTRICT,
    CONSTRAINT submission_decisions_reason_check CHECK (
      decision_kind = 'approved' OR nullif(btrim(reason), '') IS NOT NULL
    ),
    CONSTRAINT submission_decisions_return_instructions_check CHECK (
      decision_kind <> 'returned' OR nullif(btrim(correction_instructions), '') IS NOT NULL
    ),
    CONSTRAINT submission_decisions_initial_stage_check CHECK (
      stage <> 'initial_review' OR decision_kind IN ('returned', 'rejected')
    ),
    CONSTRAINT submission_decisions_id_submission_unique UNIQUE (id, submission_id),
    CONSTRAINT submission_decisions_id_submission_kind_unique UNIQUE (id, submission_id, decision_kind)
  );

  -- This encodes Stage 3's recommended no-reopening default; reopening requires
  -- a separately approved decision-episode model and migration.
  CREATE UNIQUE INDEX submission_decisions_one_terminal_per_submission_idx
    ON public.submission_decisions (submission_id)
    WHERE decision_kind IN ('approved', 'rejected');

  CREATE INDEX submission_decisions_submission_history_idx
    ON public.submission_decisions (submission_id, created_at, id);

  CREATE TABLE public.submission_status_history (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    submission_id uuid NOT NULL REFERENCES public.submissions (id) ON DELETE RESTRICT,
    previous_state public.submission_state,
    new_state public.submission_state NOT NULL,
    actor_profile_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
    role_grant_id uuid REFERENCES public.role_grants (id) ON DELETE RESTRICT,
    decision_id uuid,
    cause_code text,
    reason text,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT submission_status_history_source_check CHECK (
      (decision_id IS NOT NULL AND cause_code IS NULL)
      OR
      (decision_id IS NULL AND nullif(btrim(cause_code), '') IS NOT NULL)
    ),
    CONSTRAINT submission_status_history_decision_fk
      FOREIGN KEY (decision_id, submission_id)
      REFERENCES public.submission_decisions (id, submission_id) ON DELETE RESTRICT
  );

  CREATE INDEX submission_status_history_submission_idx
    ON public.submission_status_history (submission_id, created_at, id);

  CREATE TABLE public.decision_attachment_links (
    submission_id uuid NOT NULL,
    decision_id uuid NOT NULL,
    attachment_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (submission_id, decision_id, attachment_id),
    FOREIGN KEY (decision_id, submission_id)
      REFERENCES public.submission_decisions (id, submission_id) ON DELETE RESTRICT,
    FOREIGN KEY (submission_id, attachment_id)
      REFERENCES public.attachments (submission_id, id) ON DELETE RESTRICT
  );

  CREATE TABLE public.decision_response_links (
    submission_id uuid NOT NULL,
    decision_id uuid NOT NULL,
    review_response_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (submission_id, decision_id, review_response_id),
    FOREIGN KEY (decision_id, submission_id)
      REFERENCES public.submission_decisions (id, submission_id) ON DELETE RESTRICT,
    FOREIGN KEY (submission_id, review_response_id)
      REFERENCES public.review_responses (submission_id, id) ON DELETE RESTRICT
  );

  CREATE TABLE public.decision_officer_review_links (
    submission_id uuid NOT NULL,
    decision_id uuid NOT NULL,
    officer_response_review_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (submission_id, decision_id, officer_response_review_id),
    FOREIGN KEY (decision_id, submission_id)
      REFERENCES public.submission_decisions (id, submission_id) ON DELETE RESTRICT,
    FOREIGN KEY (submission_id, officer_response_review_id)
      REFERENCES public.tourism_officer_response_reviews (submission_id, id) ON DELETE RESTRICT
  );

  CREATE TABLE public.decision_applicability_links (
    submission_id uuid NOT NULL,
    decision_id uuid NOT NULL,
    applicability_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (submission_id, decision_id, applicability_id),
    FOREIGN KEY (decision_id, submission_id)
      REFERENCES public.submission_decisions (id, submission_id) ON DELETE RESTRICT,
    FOREIGN KEY (submission_id, applicability_id)
      REFERENCES public.response_applicability (submission_id, id) ON DELETE RESTRICT
  );

  CREATE TYPE public.thread_visibility AS ENUM ('participants', 'staff_private');

  CREATE TABLE public.message_threads (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    submission_id uuid NOT NULL REFERENCES public.submissions (id) ON DELETE RESTRICT,
    visibility public.thread_visibility NOT NULL,
    created_by_profile_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT message_threads_submission_id_unique UNIQUE (submission_id, id)
  );

  CREATE TABLE public.thread_participants (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    submission_id uuid NOT NULL,
    thread_id uuid NOT NULL,
    profile_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
    added_by_profile_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
    participation_basis text NOT NULL CHECK (nullif(btrim(participation_basis), '') IS NOT NULL),
    started_at timestamptz NOT NULL DEFAULT now(),
    ended_at timestamptz,
    removal_reason text,
    CONSTRAINT thread_participants_thread_fk
      FOREIGN KEY (submission_id, thread_id)
      REFERENCES public.message_threads (submission_id, id) ON DELETE RESTRICT,
    CONSTRAINT thread_participants_end_shape_check CHECK (
      (ended_at IS NULL AND removal_reason IS NULL)
      OR
      (ended_at IS NOT NULL AND nullif(btrim(removal_reason), '') IS NOT NULL
        AND ended_at >= started_at)
    )
  );

  CREATE UNIQUE INDEX thread_participants_one_active_profile_idx
    ON public.thread_participants (thread_id, profile_id)
    WHERE ended_at IS NULL;

  CREATE INDEX thread_participants_profile_active_idx
    ON public.thread_participants (profile_id, thread_id)
    WHERE ended_at IS NULL;

  CREATE TABLE public.messages (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    submission_id uuid NOT NULL,
    thread_id uuid NOT NULL,
    author_profile_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
    body text NOT NULL CHECK (nullif(btrim(body), '') IS NOT NULL),
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT messages_thread_fk
      FOREIGN KEY (submission_id, thread_id)
      REFERENCES public.message_threads (submission_id, id) ON DELETE RESTRICT,
    CONSTRAINT messages_submission_id_unique UNIQUE (submission_id, id)
  );

  CREATE INDEX messages_thread_history_idx
    ON public.messages (thread_id, created_at, id);

  CREATE TABLE public.message_attachments (
    submission_id uuid NOT NULL,
    message_id uuid NOT NULL,
    attachment_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (submission_id, message_id, attachment_id),
    FOREIGN KEY (submission_id, message_id)
      REFERENCES public.messages (submission_id, id) ON DELETE RESTRICT,
    FOREIGN KEY (submission_id, attachment_id)
      REFERENCES public.attachments (submission_id, id) ON DELETE RESTRICT
  );

  CREATE TABLE public.notifications (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    recipient_profile_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
    submission_id uuid NOT NULL REFERENCES public.submissions (id) ON DELETE RESTRICT,
    decision_id uuid,
    event_key text NOT NULL CHECK (nullif(btrim(event_key), '') IS NOT NULL),
    title text NOT NULL CHECK (nullif(btrim(title), '') IS NOT NULL),
    message text NOT NULL CHECK (nullif(btrim(message), '') IS NOT NULL),
    created_at timestamptz NOT NULL DEFAULT now(),
    read_at timestamptz,
    CONSTRAINT notifications_decision_fk
      FOREIGN KEY (decision_id, submission_id)
      REFERENCES public.submission_decisions (id, submission_id) ON DELETE RESTRICT,
    CONSTRAINT notifications_id_recipient_unique UNIQUE (id, recipient_profile_id)
  );

  CREATE INDEX notifications_recipient_unread_idx
    ON public.notifications (recipient_profile_id, created_at DESC)
    WHERE read_at IS NULL;

  CREATE TABLE public.notification_deliveries (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    notification_id uuid NOT NULL,
    recipient_profile_id uuid NOT NULL,
    channel text NOT NULL CHECK (nullif(btrim(channel), '') IS NOT NULL),
    scheduled_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT notification_deliveries_notification_recipient_fk
      FOREIGN KEY (notification_id, recipient_profile_id)
      REFERENCES public.notifications (id, recipient_profile_id) ON DELETE RESTRICT,
    CONSTRAINT notification_deliveries_notification_channel_unique
      UNIQUE (notification_id, channel)
  );

  CREATE TABLE public.notification_delivery_attempts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    delivery_id uuid NOT NULL REFERENCES public.notification_deliveries (id) ON DELETE RESTRICT,
    outcome text NOT NULL CHECK (outcome IN (
      'accepted',
      'confirmed_delivered',
      'confirmed_failed',
      'unknown'
    )),
    attempted_at timestamptz NOT NULL DEFAULT now(),
    safe_error_metadata jsonb NOT NULL DEFAULT '{}'::jsonb
  );

  CREATE INDEX notification_delivery_attempts_history_idx
    ON public.notification_delivery_attempts (delivery_id, attempted_at, id);

  CREATE TABLE public.audit_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_profile_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
    role_grant_id uuid REFERENCES public.role_grants (id) ON DELETE RESTRICT,
    office_membership_id uuid REFERENCES public.office_memberships (id) ON DELETE RESTRICT,
    submission_id uuid REFERENCES public.submissions (id) ON DELETE RESTRICT,
    event_kind text NOT NULL CHECK (nullif(btrim(event_kind), '') IS NOT NULL),
    correlation_id uuid,
    idempotency_key_id uuid,
    details jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
  );

  CREATE INDEX audit_events_submission_history_idx
    ON public.audit_events (submission_id, created_at DESC)
    WHERE submission_id IS NOT NULL;
  CREATE INDEX audit_events_actor_history_idx
    ON public.audit_events (actor_profile_id, created_at DESC);

  CREATE TABLE public.idempotency_keys (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_profile_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
    operation_key text NOT NULL CHECK (nullif(btrim(operation_key), '') IS NOT NULL),
    resource_id uuid,
    idempotency_key text NOT NULL CHECK (nullif(btrim(idempotency_key), '') IS NOT NULL),
    request_fingerprint bytea NOT NULL,
    result_id uuid,
    created_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz,
    CONSTRAINT idempotency_keys_completion_shape_check CHECK (
      (result_id IS NULL AND completed_at IS NULL)
      OR
      (result_id IS NOT NULL AND completed_at IS NOT NULL)
    )
  );

  CREATE UNIQUE INDEX idempotency_keys_without_resource_unique_idx
    ON public.idempotency_keys (actor_profile_id, operation_key, idempotency_key)
    WHERE resource_id IS NULL;
  CREATE UNIQUE INDEX idempotency_keys_with_resource_unique_idx
    ON public.idempotency_keys (actor_profile_id, operation_key, resource_id, idempotency_key)
    WHERE resource_id IS NOT NULL;

  ALTER TABLE public.audit_events
    ADD CONSTRAINT audit_events_idempotency_fk
    FOREIGN KEY (idempotency_key_id)
    REFERENCES public.idempotency_keys (id) ON DELETE RESTRICT;

  CREATE TABLE public.points_ledger (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    submission_id uuid NOT NULL,
    approved_decision_id uuid NOT NULL,
    qualifying_decision_kind public.overall_decision_kind NOT NULL DEFAULT 'approved'
      CHECK (qualifying_decision_kind = 'approved'),
    recipient_profile_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
    points_delta integer NOT NULL CHECK (points_delta <> 0),
    reason text NOT NULL CHECK (nullif(btrim(reason), '') IS NOT NULL),
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT points_ledger_approved_decision_fk
      FOREIGN KEY (approved_decision_id, submission_id, qualifying_decision_kind)
      REFERENCES public.submission_decisions (id, submission_id, decision_kind) ON DELETE RESTRICT
  );

  CREATE INDEX points_ledger_recipient_history_idx
    ON public.points_ledger (recipient_profile_id, created_at, id);

  GRANT SELECT, INSERT ON public.submission_decisions, public.submission_status_history,
    public.notifications, public.audit_events, public.idempotency_keys
    TO connect_daet_workflow_executor;
  GRANT SELECT ON public.decision_attachment_links, public.decision_response_links,
    public.decision_officer_review_links, public.decision_applicability_links,
    public.message_threads, public.thread_participants, public.messages,
    public.message_attachments, public.notification_deliveries,
    public.notification_delivery_attempts, public.points_ledger
    TO connect_daet_workflow_executor;
  GRANT UPDATE (result_id, completed_at) ON public.idempotency_keys
    TO connect_daet_workflow_executor;

  COMMIT;

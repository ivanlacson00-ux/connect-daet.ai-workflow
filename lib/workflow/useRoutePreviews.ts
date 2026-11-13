'use client';

import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { RoutingPipelineAuditEvent, RoutingPipelineRouteStep } from './routing-pipeline';

export interface RoutePreviewSubmission {
  id: string;
  status: string;
  created_at: string;
  selected_office_role?: string | null;
}

export interface WorkflowRoutePreview {
  initialDestinationRole: string | null;
  finalDecisionOfficeRole: string | null;
  status: string | null;
  finalizedAt: string | null;
  steps: RoutingPipelineRouteStep[];
  auditEvents: RoutingPipelineAuditEvent[];
  loadFailed: boolean;
}

const ROUTING_AUDIT_ACTIONS = [
  'SUBMISSION_RECEIVED',
  'OFFICE_ASSIGNMENT_FORWARDED',
  'OFFICE_ASSIGNMENT_FORWARDED_ONWARD',
  'OFFICE_FORWARDED_TO_TOURISM_OFFICER',
  'TOURISM_OFFICER_ASSIGNMENTS_CREATED',
  'OFFICE_FINAL_DECISION',
  'WORKFLOW_COMPLETED',
  'SUBMISSION_APPROVED',
  'SUBMISSION_REJECTED',
  'SUBMISSION_CLOSED',
  'SUBMISSION_REOPENED',
  'CHANGES_REQUESTED',
  'CHANGES_RESPONDED',
  'ROUTE_REQUIREMENTS_REQUESTED',
  'REQUIREMENTS_RESUBMITTED',
  'REVISED_DOCUMENT_SUBMITTED',
  'RETURNED_TO_SUBMITTER',
  'SUBMISSION_WITHDRAWN',
  'OFFICE_REJECTED',
  'FINAL_REJECTION',
];

export function useRoutePreviews(submissions: RoutePreviewSubmission[]) {
  const supabase = useMemo(() => createClient(), []);
  const submissionKey = [...new Set(submissions.map((submission) => submission.id))]
    .sort()
    .join(',');
  // Reload when any submission's status changes, not only when the list changes.
  const statusKey = submissions
    .map((submission) => `${submission.id}:${submission.status}`)
    .sort()
    .join(',');
  const [refreshToken, setRefreshToken] = useState(0);
  const [routesBySubmission, setRoutesBySubmission] = useState<
    Record<string, WorkflowRoutePreview>
  >({});

  // Office assignments change without changing the submission status, so listen for them.
  useEffect(() => {
    if (!submissionKey) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const scheduleRefresh = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setRefreshToken((token) => token + 1), 400);
    };
    const channel = supabase
      .channel(`route-previews-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'workflow_routing_steps' }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'workflow_routing_plans' }, scheduleRefresh)
      .subscribe();
    return () => {
      if (timer) clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  }, [submissionKey, supabase]);

  useEffect(() => {
    let active = true;
    const submissionIds = submissionKey ? submissionKey.split(',') : [];

    if (submissionIds.length === 0) {
      return;
    }

    const loadRoutes = async () => {
      const [routeResult, submissionResult, auditResult] = await Promise.all([
        // Every forward starts a new routing plan, so earlier plans hold earlier assignments.
        supabase
          .from('workflow_routing_plans')
          .select(`
            submission_id,
            status,
            is_current,
            finalized_at,
            workflow_routing_steps (
              sequence_number,
              office_role,
              status,
              outcome,
              responsibility,
              assignment_source,
              assigned_by_role,
              assigned_at,
              started_at,
              decided_at,
              completed_at,
              requirements_requested_at
            )
          `)
          .in('submission_id', submissionIds)
          .in('status', ['finalized', 'superseded']),
        supabase
          .from('workflow_submissions')
          .select('id, initial_destination_role, final_decision_office_role')
          .in('id', submissionIds),
        supabase
          .from('workflow_audit_logs')
          .select('submission_id, action_type, created_at')
          .in('submission_id', submissionIds)
          .in('action_type', ROUTING_AUDIT_ACTIONS)
          .order('created_at', { ascending: true }),
      ]);

      if (!active) return;
      if (routeResult.error || submissionResult.error || auditResult.error) {
        console.error(
          'Could not load workflow route previews:',
          routeResult.error?.message ?? submissionResult.error?.message ?? auditResult.error?.message
        );
        setRoutesBySubmission(
          Object.fromEntries(
            submissionIds.map((id) => [
              id,
              {
                initialDestinationRole: null,
                finalDecisionOfficeRole: null,
                status: null,
                finalizedAt: null,
                steps: [],
                auditEvents: [],
                loadFailed: true,
              },
            ])
          )
        );
        return;
      }

      const submissionDetailsById = new Map(
        (submissionResult.data ?? []).map((submission) => [submission.id, submission])
      );
      const previews: Record<string, WorkflowRoutePreview> = Object.fromEntries(
        submissionIds.map((id) => [
          id,
          {
            initialDestinationRole: submissionDetailsById.get(id)?.initial_destination_role ?? null,
            finalDecisionOfficeRole: submissionDetailsById.get(id)?.final_decision_office_role ?? null,
            status: null,
            finalizedAt: null,
            steps: [],
            auditEvents: [],
            loadFailed: false,
          },
        ])
      );

      for (const route of routeResult.data ?? []) {
        const preview = previews[route.submission_id];
        if (!preview) continue;
        preview.steps.push(...(route.workflow_routing_steps ?? []));
        if (route.is_current) {
          preview.status = route.status;
          preview.finalizedAt = route.finalized_at;
        }
      }
      for (const event of auditResult.data ?? []) {
        previews[event.submission_id]?.auditEvents.push({
          action_type: event.action_type,
          created_at: event.created_at,
        });
      }

      setRoutesBySubmission(previews);
    };

    void loadRoutes();
    return () => {
      active = false;
    };
  }, [submissionKey, statusKey, refreshToken, supabase]);

  return useMemo(() => {
    const activeSubmissionIds = new Set(submissionKey ? submissionKey.split(',') : []);
    return Object.fromEntries(
      Object.entries(routesBySubmission).filter(([id]) => activeSubmissionIds.has(id))
    );
  }, [routesBySubmission, submissionKey]);
}

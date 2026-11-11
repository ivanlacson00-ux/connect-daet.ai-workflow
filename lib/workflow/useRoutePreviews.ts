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
  'SUBMISSION_CLOSED',
  'CHANGES_REQUESTED',
  'ROUTE_REQUIREMENTS_REQUESTED',
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
  const [routesBySubmission, setRoutesBySubmission] = useState<
    Record<string, WorkflowRoutePreview>
  >({});

  useEffect(() => {
    let active = true;
    const submissionIds = submissionKey ? submissionKey.split(',') : [];

    if (submissionIds.length === 0) {
      return;
    }

    const loadRoutes = async () => {
      const [routeResult, submissionResult, auditResult] = await Promise.all([
        supabase
          .from('workflow_routing_plans')
          .select(`
            submission_id,
            status,
            finalized_at,
            workflow_routing_steps (
              sequence_number,
              office_role,
              status,
              responsibility,
              assignment_source,
              assigned_by_role,
              started_at,
              decided_at,
              completed_at,
              requirements_requested_at
            )
          `)
          .in('submission_id', submissionIds)
          .eq('is_current', true),
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

      const initialDestinationById = new Map(
        (submissionResult.data ?? []).map((submission) => [submission.id, submission])
      );
      const previews: Record<string, WorkflowRoutePreview> = Object.fromEntries(
        submissionIds.map((id) => [
          id,
          {
            initialDestinationRole: initialDestinationById.get(id)?.initial_destination_role ?? null,
            finalDecisionOfficeRole: initialDestinationById.get(id)?.final_decision_office_role ?? null,
            status: null,
            finalizedAt: null,
            steps: [],
            auditEvents: [],
            loadFailed: false,
          },
        ])
      );

      for (const route of routeResult.data ?? []) {
        previews[route.submission_id] = {
          ...previews[route.submission_id],
          status: route.status,
          finalizedAt: route.finalized_at,
          steps: route.workflow_routing_steps ?? [],
        };
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
  }, [submissionKey, supabase]);

  return useMemo(() => {
    const activeSubmissionIds = new Set(submissionKey ? submissionKey.split(',') : []);
    return Object.fromEntries(
      Object.entries(routesBySubmission).filter(([id]) => activeSubmissionIds.has(id))
    );
  }, [routesBySubmission, submissionKey]);
}

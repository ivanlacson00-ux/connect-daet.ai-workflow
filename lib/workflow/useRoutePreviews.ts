'use client';

import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

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
  auditEvents: { action_type: string; created_at: string }[];
  steps: {
    sequence_number: number;
    office_role: string;
    status: string;
    responsibility: string;
    assignment_source: string;
    started_at: string | null;
    decided_at: string | null;
    requirements_requested_at: string | null;
  }[];
  loadFailed: boolean;
}

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
              started_at,
              decided_at,
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
          .in('action_type', [
            'SUBMITTED',
            'OFFICE_FORWARDED_TO_TOURISM_OFFICER',
            'TOURISM_OFFICER_ASSIGNMENTS_CREATED',
            'TOURISM_OFFICER_ASSIGNMENTS_COMPLETED',
            'TOURISM_OFFICE_APPROVED',
            'OFFICE_ROUTE_STEP_ASSIGNED',
            'OFFICE_FINAL_DECISION',
            'MAYOR_APPROVED',
            'MAYOR_REJECTED',
            'WORKFLOW_COMPLETED',
          ])
          .order('created_at', { ascending: true })
          .limit(2000),
      ]);

      if (!active) return;
      if (routeResult.error || submissionResult.error || auditResult.error) {
        console.error(
          'Could not load workflow route previews:',
          routeResult.error?.message
            ?? submissionResult.error?.message
            ?? auditResult.error?.message
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
                auditEvents: [],
                steps: [],
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
            auditEvents: (auditResult.data ?? [])
              .filter((event) => event.submission_id === id)
              .map(({ action_type, created_at }) => ({ action_type, created_at })),
            steps: [],
            loadFailed: false,
          },
        ])
      );

      for (const route of routeResult.data ?? []) {
        previews[route.submission_id] = {
          ...previews[route.submission_id],
          status: route.status,
          finalizedAt: route.finalized_at,
          auditEvents: previews[route.submission_id]?.auditEvents ?? [],
          steps: route.workflow_routing_steps ?? [],
        };
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

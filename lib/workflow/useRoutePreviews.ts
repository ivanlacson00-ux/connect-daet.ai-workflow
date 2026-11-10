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
  steps: {
    sequence_number: number;
    office_role: string;
    status: string;
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
      const [routeResult, submissionResult] = await Promise.all([
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
      ]);

      if (!active) return;
      if (routeResult.error || submissionResult.error) {
        console.error(
          'Could not load workflow route previews:',
          routeResult.error?.message ?? submissionResult.error?.message
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

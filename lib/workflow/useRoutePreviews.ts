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
      setRoutesBySubmission((current) =>
        Object.keys(current).length === 0 ? current : {}
      );
      return () => {
        active = false;
      };
    }

    const loadRoutes = async () => {
      const { data: routes, error } = await supabase
        .from('workflow_routing_plans')
        .select(`
          submission_id,
          status,
          finalized_at,
          workflow_routing_steps (
            sequence_number,
            office_role,
            status,
            started_at,
            decided_at,
            requirements_requested_at
          )
        `)
        .in('submission_id', submissionIds)
        .eq('is_current', true);

      if (!active) return;
      if (error) {
        console.error('Could not load workflow route previews:', error.message);
        setRoutesBySubmission(
          Object.fromEntries(
            submissionIds.map((id) => [
              id,
              { status: null, finalizedAt: null, steps: [], loadFailed: true },
            ])
          )
        );
        return;
      }

      setRoutesBySubmission(
        Object.fromEntries(
          (routes ?? []).map((route) => [
            route.submission_id,
            {
              status: route.status,
              finalizedAt: route.finalized_at,
              steps: route.workflow_routing_steps ?? [],
              loadFailed: false,
            }
          ])
        )
      );
    };

    void loadRoutes();
    return () => {
      active = false;
    };
  }, [submissionKey, supabase]);

  return routesBySubmission;
}

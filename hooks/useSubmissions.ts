// src/hooks/useSubmissions.ts
'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export interface Submission {
  id: string;
  user_id: string;
  tracking_number: string;
  file_name: string;
  file_url: string;
  file_type: string;
  category?: string | null;
  status: string;
  rejection_comment: string | null;
  created_at: string;
  submitted_at?: string | null;
  verified_at?: string | null;
  approved_at?: string | null;
  completed_at?: string | null;
  current_stage_due_at?: string | null;
  current_responsible_role?: string | null;
  selected_office_role?: string | null;
  profiles: {
    email: string;
  };
}

export function useSubmissions(statusFilter?: string) {
  const supabase = useMemo(() => createClient(), []);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchSubmissions = useCallback(async () => {
    let query = supabase
      .from('workflow_submissions')
      .select(`
        *,
        profiles!user_id(email)
      `)
      .order('created_at', { ascending: false });

    if (statusFilter) {
      query = query.eq('status', statusFilter);
    }

    const { data, error } = await query;
    if (error) console.error('Could not load submissions:', error.message);

    setSubmissions(data ?? []);
    setLoading(false);
  }, [statusFilter, supabase]);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) void fetchSubmissions();
    });

    const channel = supabase
      .channel('realtime-admin-submissions')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'workflow_submissions',
      }, fetchSubmissions)
      .subscribe();

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [fetchSubmissions, supabase]);

  return { submissions, loading };
}
// src/hooks/useSubmissions.ts
'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export interface Submission {
  id: string;
  user_id: string;
  file_name: string;
  file_url: string;
  file_type: string;
  status: string;
  rejection_comment: string | null;
  created_at: string;
  profiles: {
    email: string;
  };
}

export function useSubmissions(statusFilter?: string) {
  const supabase = createClient();
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchSubmissions = async () => {
    setLoading(true);
    let query = supabase
      .from('workflow_submissions')
      .select(`*, profiles(email)`)
      .order('created_at', { ascending: false });

    if (statusFilter) {
      query = query.eq('status', statusFilter);
    }

    const { data } = await query;
    setSubmissions(data ?? []);
    setLoading(false);
  };

  // ✅ Admin: Final Approve
  const adminApprove = async (id: string) => {
    await supabase
      .from('workflow_submissions')
      .update({ status: 'approved' })
      .eq('id', id);

    // ✅ Log audit
    await supabase.from('audit_logs').insert({
      submission_id: id,
      action: 'admin_approved',
    });

    fetchSubmissions();
  };

  // ✅ Admin: Decline with comment
  const adminDecline = async (id: string, comment: string) => {
    await supabase
      .from('workflow_submissions')
      .update({ status: 'declined_by_admin', rejection_comment: comment })
      .eq('id', id);

    await supabase.from('audit_logs').insert({
      submission_id: id,
      action: 'admin_declined',
      comment,
    });

    fetchSubmissions();
  };

  useEffect(() => {
    fetchSubmissions();

    const channel = supabase
      .channel('realtime-admin-submissions')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'workflow_submissions',
      }, fetchSubmissions)
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [statusFilter]);

  return { submissions, loading, adminApprove, adminDecline };
}
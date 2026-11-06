// src/hooks/useAdminStats.ts
'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

interface AdminStats {
  totalUsers: number;
  pendingApprover: number;
  pendingAdmin: number;
  approved: number;
  declinedByApprover: number;
  declinedByAdmin: number;
}

export function useAdminStats() {
  const supabase = createClient();
  const [stats, setStats] = useState<AdminStats>({
    totalUsers: 0,
    pendingApprover: 0,
    pendingAdmin: 0,
    approved: 0,
    declinedByApprover: 0,
    declinedByAdmin: 0,
  });

  const fetchStats = async () => {
    const [
      { count: totalUsers },
      { count: pendingApprover },
      { count: pendingAdmin },
      { count: approved },
      { count: declinedByApprover },
      { count: declinedByAdmin },
    ] = await Promise.all([
      supabase.from('profiles').select('*', { count: 'exact', head: true }),
      supabase.from('workflow_submissions').select('*', { count: 'exact', head: true }).eq('status', 'pending_approver'),
      supabase.from('workflow_submissions').select('*', { count: 'exact', head: true }).eq('status', 'pending_admin'),
      supabase.from('workflow_submissions').select('*', { count: 'exact', head: true }).eq('status', 'approved'),
      supabase.from('workflow_submissions').select('*', { count: 'exact', head: true }).eq('status', 'declined_by_approver'),
      supabase.from('workflow_submissions').select('*', { count: 'exact', head: true }).eq('status', 'declined_by_admin'),
    ]);

    setStats({
      totalUsers: totalUsers ?? 0,
      pendingApprover: pendingApprover ?? 0,
      pendingAdmin: pendingAdmin ?? 0,
      approved: approved ?? 0,
      declinedByApprover: declinedByApprover ?? 0,
      declinedByAdmin: declinedByAdmin ?? 0,
    });
  };

  useEffect(() => {
    fetchStats();

    // ✅ Real-time: new user registered
    const usersChannel = supabase
      .channel('realtime-profiles')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'profiles',
      }, fetchStats)
      .subscribe();

    // ✅ Real-time: any submission status change
    const submissionsChannel = supabase
      .channel('realtime-submissions')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'workflow_submissions',
      }, fetchStats)
      .subscribe();

    return () => {
      supabase.removeChannel(usersChannel);
      supabase.removeChannel(submissionsChannel);
    };
  }, []);

  return { stats, refetch: fetchStats };
}
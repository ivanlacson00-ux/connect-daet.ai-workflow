// src/hooks/useAdminStats.ts
'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

interface AdminStats {
  totalUsers: number;
  pendingApprover: number;
  pendingAdmin: number;
  pendingOffice: number;
  pendingMayor: number;
  returnedForRequirements: number;
  approved: number;
  declinedByApprover: number;
  declinedByAdmin: number;
  declinedByOffice: number;
  declinedByMayor: number;
}

export function useAdminStats() {
  const supabase = createClient();
  const [stats, setStats] = useState<AdminStats>({
    totalUsers: 0,
    pendingApprover: 0,
    pendingAdmin: 0,
    pendingOffice: 0,
    pendingMayor: 0,
    returnedForRequirements: 0,
    approved: 0,
    declinedByApprover: 0,
    declinedByAdmin: 0,
    declinedByOffice: 0,
    declinedByMayor: 0,
  });

  const fetchStats = async () => {
    const [
      { count: totalUsers },
      { count: pendingApprover },
      { count: pendingAdmin },
      { count: pendingOffice },
      { count: pendingMayor },
      { count: returnedForRequirements },
      { count: approved },
      { count: declinedByApprover },
      { count: declinedByAdmin },
      { count: declinedByOffice },
      { count: declinedByMayor },
    ] = await Promise.all([
      supabase.from('profiles').select('*', { count: 'exact', head: true }),
      supabase.from('workflow_submissions').select('*', { count: 'exact', head: true }).in('status', ['pending', 'pending_approver']),
      supabase.from('workflow_submissions').select('*', { count: 'exact', head: true }).eq('status', 'pending_admin'),
      supabase.from('workflow_submissions').select('*', { count: 'exact', head: true }).eq('status', 'pending_office'),
      supabase.from('workflow_submissions').select('*', { count: 'exact', head: true }).eq('status', 'pending_mayor'),
      supabase.from('workflow_submissions').select('*', { count: 'exact', head: true }).eq('status', 'returned_for_requirements'),
      supabase.from('workflow_submissions').select('*', { count: 'exact', head: true }).eq('status', 'completed'),
      supabase.from('workflow_submissions').select('*', { count: 'exact', head: true }).eq('status', 'declined_by_approver'),
      supabase.from('workflow_submissions').select('*', { count: 'exact', head: true }).eq('status', 'declined_by_admin'),
      supabase.from('workflow_submissions').select('*', { count: 'exact', head: true }).eq('status', 'declined_by_office'),
      supabase.from('workflow_submissions').select('*', { count: 'exact', head: true }).eq('status', 'declined_by_mayor'),
    ]);

    setStats({
      totalUsers: totalUsers ?? 0,
      pendingApprover: pendingApprover ?? 0,
      pendingAdmin: pendingAdmin ?? 0,
      pendingOffice: pendingOffice ?? 0,
      pendingMayor: pendingMayor ?? 0,
      returnedForRequirements: returnedForRequirements ?? 0,
      approved: approved ?? 0,
      declinedByApprover: declinedByApprover ?? 0,
      declinedByAdmin: declinedByAdmin ?? 0,
      declinedByOffice: declinedByOffice ?? 0,
      declinedByMayor: declinedByMayor ?? 0,
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
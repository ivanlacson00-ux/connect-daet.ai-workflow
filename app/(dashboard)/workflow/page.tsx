// app/(dashboard)/workflow/page.tsx
'use client';

import { useEffect, useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';
import { getRoleHomePath } from '@/lib/workflow/offices';

export default function WorkflowLanding() {
  const supabase = useMemo(() => createClient(), []);

  useEffect(() => {
    const checkRoleAndRedirect = async () => {
      // Get current user
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) {
        // Not logged in, send to login
        window.location.href = '/login';
        return;
      }

      // Get user's role from profiles table
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single();

      if (profileError || !profile) {
        window.location.href = '/login';
        return;
      }

      window.location.href = getRoleHomePath(profile.role);
    };

    checkRoleAndRedirect();
  }, [supabase]);

  return (
    <div className="flex justify-center items-center h-64">
      <div className="text-muted-text">Redirecting to your dashboard...</div>
    </div>
  );
}
// app/(dashboard)/workflow/page.tsx
'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export default function WorkflowLanding() {
  const [loading, setLoading] = useState(true);
  const supabase = createClient();

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
      const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single();

      const role = profile?.role || 'user';
      
      // Redirect based on role
      if (role === 'admin') {
        window.location.href = '/workflow/admin';
      } else if (role === 'approver') {
        window.location.href = '/workflow/approver';
      } else {
        window.location.href = '/workflow/user';
      }
      
      setLoading(false);
    };

    checkRoleAndRedirect();
  }, []);

  return (
    <div className="flex justify-center items-center h-64">
      <div className="text-gray-500">Redirecting to your dashboard...</div>
    </div>
  );
}
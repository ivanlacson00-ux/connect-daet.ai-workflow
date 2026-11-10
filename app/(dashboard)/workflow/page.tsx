'use client';

import { useEffect, useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';
import { getCurrentWorkflowAccess, getPrimaryWorkflowRole, getWorkflowHomePath } from '@/lib/auth/access';
import { useRouter } from 'next/navigation';

export default function WorkflowLanding() {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();

  useEffect(() => {
    let active = true;
    void getCurrentWorkflowAccess(supabase)
      .then((access) => {
        if (!active) return;
        if (!access) {
          router.replace('/login');
          return;
        }
        router.replace(getWorkflowHomePath(getPrimaryWorkflowRole(access.roles)));
      })
      .catch((error: unknown) => {
        console.error('Workflow landing access lookup failed:', error);
        if (active) router.replace('/login?access=unassigned');
      });

    return () => {
      active = false;
    };
  }, [router, supabase]);

  return <p className="py-12 text-center text-sm text-muted-text">Opening your workflow...</p>;
}

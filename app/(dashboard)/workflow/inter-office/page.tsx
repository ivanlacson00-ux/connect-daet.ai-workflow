'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import InterOfficeWorkspace from '@/components/InterOfficeWorkspace';
import { createClient } from '@/lib/supabase/client';
import { getRoleHomePath, isOfficeRole, type OfficeRole } from '@/lib/workflow/offices';

export default function InterOfficePage() {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const [officeRole, setOfficeRole] = useState<OfficeRole | null>(null);

  useEffect(() => {
    let active = true;
    const resolveOfficeRole = async () => {
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError || !user) {
        router.replace('/login');
        return;
      }

      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single();
      if (profileError || !profile || !isOfficeRole(profile.role)) {
        if (profileError) console.error('Inter-office role lookup failed:', profileError.message);
        router.replace(getRoleHomePath(profile?.role ?? null));
        return;
      }

      if (active) setOfficeRole(profile.role);
    };
    void resolveOfficeRole();
    return () => { active = false; };
  }, [router, supabase]);

  if (!officeRole) {
    return <p className="p-8 text-sm text-muted-text">Loading your office workspace...</p>;
  }

  return <InterOfficeWorkspace officeRole={officeRole} />;
}

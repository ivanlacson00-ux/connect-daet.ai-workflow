'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { getCurrentWorkflowAccess, getPrimaryWorkflowRole, getWorkflowHomePath, type WorkflowAccess } from '@/lib/auth/access';
import { createClient } from '@/lib/supabase/client';

function routeAllowsRole(pathname: string, access: WorkflowAccess): boolean {
  if (pathname.startsWith('/workflow/user')) return access.roles.includes('user');
  if (pathname.startsWith('/workflow/approver')) return access.roles.includes('approver');
  if (pathname.startsWith('/workflow/office')) return access.roles.includes('external_approver');
  if (pathname.startsWith('/workflow/admin')) return access.roles.includes('admin');
  return true;
}

export default function WorkflowLayout({ children }: { children: ReactNode }) {
  const supabase = useMemo(() => createClient(), []);
  const pathname = usePathname();
  const router = useRouter();
  const [access, setAccess] = useState<WorkflowAccess | null>(null);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    void getCurrentWorkflowAccess(supabase)
      .then((currentAccess) => {
        if (!active) return;
        if (!currentAccess) {
          router.replace('/login');
          return;
        }
        setAccess(currentAccess);
        if (!routeAllowsRole(pathname, currentAccess)) {
          router.replace(getWorkflowHomePath(getPrimaryWorkflowRole(currentAccess.roles)));
          return;
        }
        setChecking(false);
      })
      .catch((accessError: unknown) => {
        console.error('Workflow access check failed:', accessError);
        if (!active) return;
        setError('We could not verify your workflow access. Refresh the page or contact the system administrator.');
        setChecking(false);
      });

    return () => {
      active = false;
    };
  }, [pathname, router, supabase]);

  const handleSignOut = async () => {
    const { error: signOutError } = await supabase.auth.signOut();
    if (signOutError) {
      setError('Sign out failed. Please try again.');
      return;
    }
    router.replace('/login');
  };

  if (checking) {
    return <main className="mx-auto max-w-5xl p-8 text-sm text-muted-text">Checking your workflow access...</main>;
  }

  if (error || !access) {
    return (
      <main className="mx-auto max-w-5xl p-8">
        <p role="alert" className="rounded-xl border border-rejected-bg bg-rejected-bg/50 p-4 text-sm text-rejected-text">
          {error || 'Workflow access is unavailable.'}
        </p>
        <button type="button" onClick={handleSignOut} className="mt-4 rounded-full border px-4 py-2 text-sm">
          Sign out
        </button>
      </main>
    );
  }

  const role = getPrimaryWorkflowRole(access.roles);

  return (
    <div className="min-h-screen bg-cream">
      <header className="border-b border-warm-border bg-card">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4">
          <Link href={getWorkflowHomePath(role)} className="font-serif text-lg font-semibold text-warm-text">
            CONNECT-Daet
          </Link>
          <nav className="flex items-center gap-3 text-xs">
            {access.roles.includes('user') && (
              <>
                <Link href="/workflow/user" className="text-muted-text hover:text-clay">My submissions</Link>
                <Link href="/workflow/user/notifications" className="text-muted-text hover:text-clay">Notifications</Link>
              </>
            )}
            {access.roles.includes('approver') && <Link href="/workflow/approver" className="text-muted-text hover:text-clay">Tourism Officer</Link>}
            {access.roles.includes('external_approver') && access.officeIds.length > 0 && <Link href="/workflow/office" className="text-muted-text hover:text-clay">Office queue</Link>}
            {access.roles.includes('admin') && <Link href="/workflow/admin" className="text-muted-text hover:text-clay">Administration</Link>}
            <button type="button" onClick={handleSignOut} className="rounded-full border border-warm-border px-3 py-2 font-semibold text-warm-text hover:bg-sidebar">
              Sign out
            </button>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">
        {error && <p role="alert" className="mb-5 rounded-xl border border-rejected-bg bg-rejected-bg/50 p-4 text-sm text-rejected-text">{error}</p>}
        {children}
      </main>
    </div>
  );
}

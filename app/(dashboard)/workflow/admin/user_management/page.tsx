// src/app/(dashboard)/workflow/admin/user_management/page.tsx
'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

// ─── Styles ──────────────────────────────────────────────────────────────────
const fonts = {
  serif: 'font-serif',
};

type Role = 'user' | 'approver' | 'admin';
type RoleFilter = 'all' | Role;

interface UserProfile {
  id: string;
  email: string;
  role: string;
  created_at: string;
}

const ROLES: Role[] = ['user', 'approver', 'admin'];

const FILTERS: { key: RoleFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'admin', label: 'Admin' },
  { key: 'approver', label: 'Approver' },
  { key: 'user', label: 'User' },
];

const ROLE_STYLES: Record<string, string> = {
  admin: 'bg-clay-soft text-clay',
  approver: 'bg-review-bg text-review-text',
  user: 'bg-sidebar text-muted-text',
};

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// ─── Role Badge ──────────────────────────────────────────────────────────────
function RoleBadge({ role }: { role: string }) {
  return (
    <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[11px] font-medium ${ROLE_STYLES[role] ?? ROLE_STYLES.user}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
      {capitalize(role || 'unknown')}
    </span>
  );
}

export default function UserManagementPage() {
  const supabase = useMemo(() => createClient(), []);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all');
  const [updating, setUpdating] = useState<string | null>(null);

  // ─── Data actions ──────────────────────────────────────────────────────────
  const fetchUsers = useCallback(async () => {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) console.error('Fetch error:', error.message);
    setUsers(data ?? []);
    setLoading(false);
  }, [supabase]);

  const updateRole = async (userId: string, newRole: Role) => {
    setUpdating(userId);
    const { error } = await supabase
      .from('profiles')
      .update({ role: newRole })
      .eq('id', userId);

    if (error) {
      console.error('Role update failed:', error.message);
    } else {
      setUsers(prev => prev.map(u => (u.id === userId ? { ...u, role: newRole } : u)));
    }
    setUpdating(null);
  };

  const deleteUser = async (userId: string, email: string) => {
    const confirmed = window.confirm(
      `WARNING: Are you sure you want to delete ${email}? This will remove their profile record.`
    );
    if (!confirmed) return;

    setUpdating(userId);
    const { error } = await supabase
      .from('profiles')
      .delete()
      .eq('id', userId);

    if (error) {
      console.error('Delete error:', error.message);
      alert('Failed to delete user profile.');
    } else {
      setUsers(prev => prev.filter(u => u.id !== userId));
    }
    setUpdating(null);
  };

  // ─── Lifecycle ─────────────────────────────────────────────────────────────
  useEffect(() => {
    fetchUsers();

    const channel = supabase
      .channel('realtime-user-management')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, fetchUsers)
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [supabase, fetchUsers]);

  // ─── Filtering ─────────────────────────────────────────────────────────────
  const roleCounts = useMemo(() => {
    const counts: Record<RoleFilter, number> = { all: users.length, admin: 0, approver: 0, user: 0 };
    users.forEach(u => {
      if (u.role in counts) counts[u.role as Role]++;
    });
    return counts;
  }, [users]);

  const filtered = useMemo(() => {
    const query = search.toLowerCase();
    return users.filter(u =>
      (u.email || '').toLowerCase().includes(query) &&
      (roleFilter === 'all' || u.role === roleFilter)
    );
  }, [users, search, roleFilter]);

  return (
    <div className="w-full">
      {/* Header */}
      <div className="mb-8 max-md:mb-5">
        <p className="mb-3 flex items-center gap-2 text-[11px] font-medium text-muted-text max-md:mb-2">
          <span className="h-1.5 w-1.5 rounded-full bg-clay" /> Admin workspace
        </p>
        <h1 className={`${fonts.serif} text-[32px] leading-tight text-warm-text max-md:text-[26px]`}>User management</h1>
        <p className="mt-2 text-xs text-muted-text max-md:mt-1.5">
          Control who can submit, review and administer files. Total users: <span className="text-warm-text">{users.length}</span>
        </p>
      </div>

      {/* Toolbar */}
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="relative w-full lg:max-w-xl lg:flex-1">
          <input
            type="text"
            placeholder="Search by email..."
            aria-label="Search by email"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-12 w-full rounded-full border border-warm-border bg-card px-5 text-sm text-warm-text outline-none transition-colors placeholder:text-muted-text/60 focus:border-clay max-md:h-11"
          />
        </div>

        {/* Role filter pills (scroll inside their own row on mobile) */}
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] md:mx-0 md:px-0 [&::-webkit-scrollbar]:hidden">
          {FILTERS.map(f => {
            const active = roleFilter === f.key;
            return (
              <button
                key={f.key}
                onClick={() => setRoleFilter(f.key)}
                aria-pressed={active}
                className={`inline-flex h-10 shrink-0 items-center gap-2 rounded-full border px-4 text-xs font-medium transition-colors max-md:h-11 ${
                  active
                    ? 'border-clay bg-clay text-white'
                    : 'border-warm-border bg-card text-warm-text hover:bg-sidebar'
                }`}
              >
                {f.label}
                <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${active ? 'bg-white/25 text-white' : 'bg-sidebar text-muted-text'}`}>
                  {roleCounts[f.key]}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* List header */}
      <div className="mb-4 flex items-center gap-3">
        <h2 className="text-sm font-semibold text-warm-text">User directory</h2>
        <span className="rounded-md bg-sidebar px-2 py-1 text-[10px] font-medium text-muted-text">{filtered.length}</span>
      </div>

      {/* List */}
      {loading ? (
        <div className="flex items-center gap-3 rounded-2xl border border-warm-border bg-card px-5 py-8 text-xs text-muted-text">
          <span className="h-2 w-2 animate-pulse rounded-full bg-clay" /> Loading users...
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-warm-border bg-card py-16 text-center">
          <p className={`${fonts.serif} text-2xl text-warm-text`}>Nothing here</p>
          <p className="mt-2 text-xs text-muted-text">No users match your search or filter.</p>
          {(search || roleFilter !== 'all') && (
            <button
              onClick={() => { setSearch(''); setRoleFilter('all'); }}
              className="mt-5 inline-flex h-10 items-center rounded-full border border-warm-border px-5 text-xs font-medium text-warm-text transition-colors hover:bg-sidebar max-md:h-11"
            >
              Clear filters
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((user) => (
            <article
              key={user.id}
              className="group flex flex-col gap-5 rounded-2xl border border-warm-border bg-card px-5 py-5 transition-colors hover:border-[#d9cabb] sm:flex-row sm:items-center sm:justify-between max-md:gap-3 max-md:px-3.5 max-md:py-3.5"
            >
              <div className="flex min-w-0 items-center gap-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-sidebar text-lg font-semibold uppercase text-muted-text" aria-hidden="true">
                  {user.email?.charAt(0) || '?'}
                </div>
                <div className="min-w-0">
                  <h3 className="truncate text-sm font-semibold text-warm-text group-hover:text-clay">{user.email}</h3>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-2 text-[11px] text-muted-text">
                    <span>{user.id.slice(0, 8)}</span>
                    <span aria-hidden="true">·</span>
                    <span>
                      Joined {new Date(user.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 sm:justify-end max-md:w-full max-md:flex-col max-md:items-stretch">
                <div className="max-md:self-start">
                  <RoleBadge role={user.role} />
                </div>

                {updating === user.id ? (
                  <div className="flex h-10 items-center gap-2 px-2 text-xs text-muted-text max-md:h-11">
                    <span className="h-2 w-2 animate-pulse rounded-full bg-clay" /> Processing...
                  </div>
                ) : (
                  <>
                    <select
                      value={user.role}
                      onChange={(e) => updateRole(user.id, e.target.value as Role)}
                      aria-label={`Change role for ${user.email}`}
                      className="h-10 cursor-pointer rounded-full border border-warm-border bg-card px-4 text-xs font-medium text-warm-text outline-none transition-colors hover:bg-sidebar focus:border-clay max-md:h-11 max-md:w-full"
                    >
                      {ROLES.map(r => (
                        <option key={r} value={r}>{capitalize(r)}</option>
                      ))}
                    </select>

                    <button
                      onClick={() => deleteUser(user.id, user.email)}
                      className="inline-flex h-10 items-center justify-center rounded-full border border-rejected-bg px-5 text-xs font-semibold text-rejected-text transition-colors hover:bg-rejected-bg/50 max-md:h-11 max-md:w-full"
                    >
                      Delete
                    </button>
                  </>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
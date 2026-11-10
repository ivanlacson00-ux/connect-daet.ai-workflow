// src/app/(dashboard)/workflow/admin/user_management/page.tsx
'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import WorkflowAuthoritySettings from '@/components/WorkflowAuthoritySettings';

// ─── Styles ──────────────────────────────────────────────────────────────────
const fonts = {
  serif: 'font-serif',
};

type Role =
  | 'submitter'
  | 'tourism_officer'
  | 'system_admin'
  | 'municipal_treasurer'
  | 'mayor_office'
  | 'sangguniang_bayan';
type RoleFilter = 'all' | Role;
type VerificationStatus = 'pending' | 'verified' | 'unknown';

interface UserProfile {
  id: string;
  email: string;
  full_name: string | null;
  role: string;
  created_at: string;
  verificationStatus: VerificationStatus;
}

const OFFICIAL_ROLES: Role[] = [
  'tourism_officer',
  'municipal_treasurer',
  'mayor_office',
  'sangguniang_bayan',
];

const FILTERS: { key: RoleFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'system_admin', label: 'System Administrator' },
  { key: 'tourism_officer', label: 'Tourism Officer' },
  { key: 'municipal_treasurer', label: "Treasurer's Office" },
  { key: 'mayor_office', label: "Mayor's Office" },
  { key: 'sangguniang_bayan', label: 'Sangguniang Bayan' },
  { key: 'submitter', label: 'Submitter' },
];

const ROLE_STYLES: Record<string, string> = {
  system_admin: 'bg-clay-soft text-clay',
  tourism_officer: 'bg-review-bg text-review-text',
  municipal_treasurer: 'bg-approved-bg text-approved-text',
  mayor_office: 'bg-pending-bg text-pending-text',
  sangguniang_bayan: 'bg-rejected-bg text-rejected-text',
  submitter: 'bg-sidebar text-muted-text',
};

const ROLE_LABELS: Record<Role, string> = {
  submitter: 'Submitter',
  tourism_officer: 'Tourism Officer',
  system_admin: 'System Administrator',
  municipal_treasurer: "Municipal Treasurer's Office",
  mayor_office: "Mayor's Office",
  sangguniang_bayan: 'Sangguniang Bayan Office',
};

const capitalize = (s: string) => ROLE_LABELS[s as Role] ?? s.charAt(0).toUpperCase() + s.slice(1);

// ─── Role Badge ──────────────────────────────────────────────────────────────
function RoleBadge({ role }: { role: string }) {
  return (
    <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[11px] font-medium ${ROLE_STYLES[role] ?? ROLE_STYLES.submitter}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
      {capitalize(role || 'unknown')}
    </span>
  );
}

function VerificationBadge({ status }: { status: VerificationStatus }) {
  const config = status === 'verified'
    ? { label: 'Verified', styles: 'bg-approved-bg text-approved-text' }
    : status === 'pending'
      ? { label: 'Pending verification', styles: 'bg-pending-bg text-pending-text' }
      : { label: 'Status unavailable', styles: 'bg-sidebar text-muted-text' };

  return (
    <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[11px] font-medium ${config.styles}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
      {config.label}
    </span>
  );
}

export default function UserManagementPage() {
  const supabase = useMemo(() => createClient(), []);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [usersError, setUsersError] = useState('');
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all');
  const [updating, setUpdating] = useState<string | null>(null);
  const [newAccountDetails, setNewAccountDetails] = useState({
    firstName: '',
    middleName: '',
    lastName: '',
    phoneNumber: '',
    age: '',
    sex: '',
    address: '',
  });
  const [newAccountEmail, setNewAccountEmail] = useState('');
  const [newAccountRole, setNewAccountRole] = useState<Role>('tourism_officer');
  const [creatingAccount, setCreatingAccount] = useState(false);
  const [accountCreationStatus, setAccountCreationStatus] = useState<{ type: 'error' | 'success'; message: string } | null>(null);
  const [invitationLink, setInvitationLink] = useState<{ email: string; fullName: string; role: Role; url: string } | null>(null);
  const [linkActionStatus, setLinkActionStatus] = useState('');

  // ─── Data actions ──────────────────────────────────────────────────────────
  const fetchUsers = useCallback(async () => {
    setUsersError('');
    const { data, error } = await supabase
      .from('profiles')
      .select('id, email, full_name, role, created_at')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('User registry fetch failed:', error.message);
      setUsersError('Could not load the user registry. Check your connection and try again.');
    } else {
      const profiles = data ?? [];
      try {
        const response = await fetch('/api/admin/accounts', { cache: 'no-store' });
        const result = await response.json() as {
          error?: string;
          verificationStatuses?: Record<string, Exclude<VerificationStatus, 'unknown'>>;
        };
        if (!response.ok || !result.verificationStatuses) {
          throw new Error(result.error || 'Could not load account verification statuses.');
        }

        setUsers(profiles.map((profile) => ({
          ...profile,
          verificationStatus: result.verificationStatuses?.[profile.id] ?? 'unknown',
        })));
      } catch (verificationError) {
        const message = verificationError instanceof Error
          ? verificationError.message
          : 'Could not load account verification statuses.';
        console.error('Account verification status refresh failed:', message);
        setUsers(profiles.map((profile) => ({ ...profile, verificationStatus: 'unknown' })));
        setUsersError(message);
      }
    }
    setLoading(false);
  }, [supabase]);

  const createOfficialAccount = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setCreatingAccount(true);
    setAccountCreationStatus(null);
    setInvitationLink(null);
    setLinkActionStatus('');
    const fullName = [newAccountDetails.firstName, newAccountDetails.middleName, newAccountDetails.lastName]
      .map((name) => name.trim())
      .filter(Boolean)
      .join(' ');

    try {
      const response = await fetch('/api/admin/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: newAccountEmail,
          ...newAccountDetails,
          age: Number(newAccountDetails.age),
          role: newAccountRole,
        }),
      });
      const result = await response.json() as { error?: string; message?: string; invitationUrl?: string };
      if (!response.ok) throw new Error(result.error || 'Could not create the official account.');
      if (!result.invitationUrl) throw new Error('The account was created, but the invitation link was not returned. Contact an administrator before creating another account.');

      setAccountCreationStatus({ type: 'success', message: result.message || 'Invitation sent.' });
      setInvitationLink({
        email: newAccountEmail.trim(),
        fullName,
        role: newAccountRole,
        url: result.invitationUrl,
      });
      setNewAccountDetails({
        firstName: '',
        middleName: '',
        lastName: '',
        phoneNumber: '',
        age: '',
        sex: '',
        address: '',
      });
      setNewAccountEmail('');
      await fetchUsers();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not create the official account.';
      console.error('Official account creation failed:', message);
      setAccountCreationStatus({ type: 'error', message });
    } finally {
      setCreatingAccount(false);
    }
  };

  const copyInvitationLink = async () => {
    if (!invitationLink) return;
    try {
      await navigator.clipboard.writeText(invitationLink.url);
      setLinkActionStatus('Invitation link copied. Paste it into your email to the official.');
    } catch (error) {
      console.error('Could not copy the official invitation link:', error);
      setLinkActionStatus('Copy failed. Select and copy the invitation link from the field above.');
    }
  };

  const deleteUser = async (userId: string, email: string) => {
    const confirmed = window.confirm(
      `WARNING: Are you sure you want to delete ${email}? This will remove their profile record.`
    );
    if (!confirmed) return;

    setUpdating(userId);
    try {
      const response = await fetch('/api/admin/accounts', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      });
      const result = await response.json() as { error?: string };

      if (!response.ok) {
        throw new Error(result.error || 'Failed to delete user profile.');
      }

      setUsers((previousUsers) => previousUsers.filter((registeredUser) => registeredUser.id !== userId));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete user profile.';
      console.error('Delete error:', message);
      alert(message);
    } finally {
      setUpdating(null);
    }
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
    const counts: Record<RoleFilter, number> = {
      all: users.length,
      system_admin: 0,
      tourism_officer: 0,
      submitter: 0,
      municipal_treasurer: 0,
      mayor_office: 0,
      sangguniang_bayan: 0,
    };
    users.forEach(u => {
      if (u.role in counts) counts[u.role as Role]++;
    });
    return counts;
  }, [users]);

  const filtered = useMemo(() => {
    const query = search.toLowerCase();
    return users.filter(u =>
      ((u.email || '').toLowerCase().includes(query) || (u.full_name || '').toLowerCase().includes(query)) &&
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
        <h1 className={`${fonts.serif} text-[32px] leading-tight text-warm-text max-md:text-[26px]`}>User Registry</h1>
        <p className="mt-2 text-xs text-muted-text max-md:mt-1.5">
          Control who can submit, review and administer files. Total users: <span className="text-warm-text">{users.length}</span>
        </p>
      </div>

      <WorkflowAuthoritySettings />

      <section className="mb-6 rounded-2xl border border-warm-border bg-card p-5 max-md:p-3.5">
        <div className="mb-4">
          <h2 className="text-sm font-semibold text-warm-text">Create an account and assign a role</h2>
          <p className="mt-1 text-[11px] text-muted-text">
            Create an account for an official and assign their dashboard role. The recipient verifies the invitation link and sets their password before signing in.
          </p>
        </div>
        <form onSubmit={createOfficialAccount} className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div>
            <label htmlFor="official-account-first-name" className="mb-1.5 block text-[11px] font-medium text-muted-text">First name</label>
            <input
              id="official-account-first-name"
              type="text"
              autoComplete="given-name"
              value={newAccountDetails.firstName}
              onChange={(event) => setNewAccountDetails((current) => ({ ...current, firstName: event.target.value }))}
              maxLength={80}
              required
              className="h-11 w-full rounded-full border border-warm-border bg-card px-4 text-xs text-warm-text outline-none focus:border-clay"
              placeholder="First name"
            />
          </div>
          <div>
            <label htmlFor="official-account-middle-name" className="mb-1.5 block text-[11px] font-medium text-muted-text">Middle name <span className="font-normal">(optional)</span></label>
            <input
              id="official-account-middle-name"
              type="text"
              autoComplete="additional-name"
              value={newAccountDetails.middleName}
              onChange={(event) => setNewAccountDetails((current) => ({ ...current, middleName: event.target.value }))}
              maxLength={80}
              className="h-11 w-full rounded-full border border-warm-border bg-card px-4 text-xs text-warm-text outline-none focus:border-clay"
              placeholder="Middle name"
            />
          </div>
          <div>
            <label htmlFor="official-account-last-name" className="mb-1.5 block text-[11px] font-medium text-muted-text">Last name</label>
            <input
              id="official-account-last-name"
              type="text"
              autoComplete="family-name"
              value={newAccountDetails.lastName}
              onChange={(event) => setNewAccountDetails((current) => ({ ...current, lastName: event.target.value }))}
              maxLength={80}
              required
              className="h-11 w-full rounded-full border border-warm-border bg-card px-4 text-xs text-warm-text outline-none focus:border-clay"
              placeholder="Last name"
            />
          </div>
          <div>
            <label htmlFor="official-account-email" className="mb-1.5 block text-[11px] font-medium text-muted-text">Email / Gmail</label>
            <input
              id="official-account-email"
              type="email"
              autoComplete="email"
              value={newAccountEmail}
              onChange={(event) => setNewAccountEmail(event.target.value)}
              maxLength={254}
              required
              className="h-11 w-full rounded-full border border-warm-border bg-card px-4 text-xs text-warm-text outline-none focus:border-clay"
              placeholder="name@example.com"
            />
          </div>
          <div>
            <label htmlFor="official-account-phone" className="mb-1.5 block text-[11px] font-medium text-muted-text">CP number</label>
            <input
              id="official-account-phone"
              type="tel"
              autoComplete="tel"
              value={newAccountDetails.phoneNumber}
              onChange={(event) => setNewAccountDetails((current) => ({ ...current, phoneNumber: event.target.value }))}
              maxLength={24}
              required
              className="h-11 w-full rounded-full border border-warm-border bg-card px-4 text-xs text-warm-text outline-none focus:border-clay"
              placeholder="+63 9XX XXX XXXX"
            />
          </div>
          <div>
            <label htmlFor="official-account-age" className="mb-1.5 block text-[11px] font-medium text-muted-text">Age</label>
            <input
              id="official-account-age"
              type="number"
              min={1}
              max={120}
              step={1}
              value={newAccountDetails.age}
              onChange={(event) => setNewAccountDetails((current) => ({ ...current, age: event.target.value }))}
              required
              className="h-11 w-full rounded-full border border-warm-border bg-card px-4 text-xs text-warm-text outline-none focus:border-clay"
              placeholder="Age"
            />
          </div>
          <div>
            <label htmlFor="official-account-sex" className="mb-1.5 block text-[11px] font-medium text-muted-text">Sex</label>
            <select
              id="official-account-sex"
              value={newAccountDetails.sex}
              onChange={(event) => setNewAccountDetails((current) => ({ ...current, sex: event.target.value }))}
              required
              className="h-11 w-full rounded-full border border-warm-border bg-card px-4 text-xs text-warm-text outline-none focus:border-clay"
            >
              <option value="" disabled>Select sex</option>
              <option value="female">Female</option>
              <option value="male">Male</option>
              <option value="other">Other</option>
              <option value="prefer_not_to_say">Prefer not to say</option>
            </select>
          </div>
          <div className="md:col-span-2 xl:col-span-4">
            <label htmlFor="official-account-address" className="mb-1.5 block text-[11px] font-medium text-muted-text">Address</label>
            <textarea
              id="official-account-address"
              autoComplete="street-address"
              value={newAccountDetails.address}
              onChange={(event) => setNewAccountDetails((current) => ({ ...current, address: event.target.value }))}
              maxLength={500}
              required
              rows={2}
              className="w-full rounded-2xl border border-warm-border bg-card px-4 py-3 text-xs text-warm-text outline-none focus:border-clay"
              placeholder="House number, street, barangay, municipality, province"
            />
          </div>
          <div className="md:col-span-2 xl:col-span-4">
            <label htmlFor="official-account-role" className="mb-1.5 block text-[11px] font-medium text-muted-text">Official role</label>
            <select
              id="official-account-role"
              value={newAccountRole}
              onChange={(event) => setNewAccountRole(event.target.value as Role)}
              className="h-11 w-full rounded-full border border-warm-border bg-card px-4 text-xs text-warm-text outline-none focus:border-clay"
            >
              {OFFICIAL_ROLES.map((role) => <option key={role} value={role}>{capitalize(role)}</option>)}
            </select>
          </div>
          <div className="md:col-span-2 xl:col-span-4">
            <button
              type="submit"
              disabled={creatingAccount}
              className="inline-flex h-11 w-full items-center justify-center rounded-full bg-clay px-5 text-xs font-semibold text-white transition-colors hover:bg-warm-text disabled:opacity-50"
            >
              {creatingAccount ? 'Sending invitation...' : 'Create official account'}
            </button>
          </div>
        </form>
        {accountCreationStatus && (
          <p
            role={accountCreationStatus.type === 'error' ? 'alert' : 'status'}
            className={`mt-3 rounded-xl border px-4 py-3 text-xs font-medium ${
              accountCreationStatus.type === 'success'
                ? 'border-approved-bg bg-approved-bg/50 text-approved-text'
                : 'border-rejected-bg bg-rejected-bg/50 text-rejected-text'
            }`}
          >
            {accountCreationStatus.message}
          </p>
        )}
        {invitationLink && (
          <div className="mt-4 rounded-xl border border-warm-border bg-sidebar p-4">
            <p className="text-xs font-semibold text-warm-text">Account created — send the verification link</p>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-text">
              This one-time link is for {invitationLink.fullName} ({invitationLink.email}), assigned to {capitalize(invitationLink.role)}.
              They must open it, verify the invitation, and set a password before accessing their dashboard.
            </p>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <input
                type="url"
                aria-label="Official account invitation link"
                readOnly
                value={invitationLink.url}
                onFocus={(event) => event.currentTarget.select()}
                className="h-11 min-w-0 flex-1 rounded-full border border-warm-border bg-card px-4 text-xs text-warm-text outline-none focus:border-clay"
              />
              <button
                type="button"
                onClick={() => void copyInvitationLink()}
                className="inline-flex h-11 items-center justify-center rounded-full border border-warm-border px-5 text-xs font-semibold text-warm-text transition-colors hover:bg-card"
              >
                Copy link
              </button>
              <a
                href={`https://mail.google.com/mail/?${new URLSearchParams({
                  view: 'cm',
                  fs: '1',
                  to: invitationLink.email,
                  su: 'Your CONNECT-Daet account invitation',
                  body: `Hello ${invitationLink.fullName},\n\nYour CONNECT-Daet account has been created with the role ${capitalize(invitationLink.role)}. Open the link below to verify your invitation and set your password:\n\n${invitationLink.url}\n\nThis invitation link is for your account only and can be used once.\n\nCONNECT-Daet`,
                }).toString()}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-11 items-center justify-center rounded-full bg-clay px-5 text-xs font-semibold text-white transition-colors hover:bg-warm-text"
              >
                Compose email in Gmail
              </a>
            </div>
            {linkActionStatus && <p role="status" className="mt-2 text-[11px] text-muted-text">{linkActionStatus}</p>}
            <p className="mt-2 text-[10px] text-muted-text">Gmail opens a draft; review it and press Send. The invitation link can only be used once.</p>
          </div>
        )}
      </section>

      {usersError && (
        <div role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rejected-bg bg-rejected-bg/50 px-4 py-3 text-xs text-rejected-text">
          <span>{usersError}</span>
          <button type="button" onClick={() => void fetchUsers()} className="font-semibold underline">Retry</button>
        </div>
      )}

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
        <h2 className="text-sm font-semibold text-warm-text">Registered accounts</h2>
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
              className="group flex flex-col gap-5 rounded-2xl border border-warm-border bg-card px-5 py-5 transition-colors hover:border-clay-border sm:flex-row sm:items-center sm:justify-between max-md:gap-3 max-md:px-3.5 max-md:py-3.5"
            >
              <div className="flex min-w-0 items-center gap-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-sidebar text-lg font-semibold uppercase text-muted-text" aria-hidden="true">
                  {user.email?.charAt(0) || '?'}
                </div>
                <div className="min-w-0">
                  <h3 className="truncate text-sm font-semibold text-warm-text group-hover:text-clay">{user.full_name || user.email}</h3>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-2 text-[11px] text-muted-text">
                    {user.full_name && <><span>{user.email}</span><span aria-hidden="true">·</span></>}
                    <span>{user.id.slice(0, 8)}</span>
                    <span aria-hidden="true">·</span>
                    <span>
                      Joined {new Date(user.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 sm:justify-end max-md:w-full max-md:flex-col max-md:items-stretch">
                <VerificationBadge status={user.verificationStatus} />
                <div className="max-md:self-start">
                  <span className="mr-2 text-[10px] font-medium text-muted-text">Base role</span>
                  <RoleBadge role={user.role} />
                </div>

                {updating === user.id ? (
                  <div className="flex h-10 items-center gap-2 px-2 text-xs text-muted-text max-md:h-11">
                    <span className="h-2 w-2 animate-pulse rounded-full bg-clay" /> Processing...
                  </div>
                ) : (
                  <button
                    onClick={() => deleteUser(user.id, user.email)}
                    className="inline-flex h-10 items-center justify-center rounded-full border border-rejected-bg px-5 text-xs font-semibold text-rejected-text transition-colors hover:bg-rejected-bg/50 max-md:h-11 max-md:w-full"
                  >
                    Delete
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
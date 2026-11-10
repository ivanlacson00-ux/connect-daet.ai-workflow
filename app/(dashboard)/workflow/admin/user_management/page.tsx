'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

type WorkflowRole = 'user' | 'approver' | 'external_approver' | 'admin';
type Account = {
  id: string;
  email: string | null;
  created_at: string;
  email_confirmed_at: string | null;
};
type RoleGrant = {
  id: string;
  profile_id: string;
  role: WorkflowRole;
  granted_at: string;
  revoked_at: string | null;
  revocation_reason: string | null;
};
type OfficeMembership = {
  id: string;
  profile_id: string;
  office_id: string;
  started_at: string;
  ended_at: string | null;
  end_reason: string | null;
};
type Office = { id: string; code: string; name: string; is_active: boolean };
type Directory = {
  accounts: Account[];
  roleGrants: RoleGrant[];
  officeMemberships: OfficeMembership[];
  offices: Office[];
};

const roles: WorkflowRole[] = ['user', 'approver', 'external_approver', 'admin'];
const roleLabels: Record<WorkflowRole, string> = {
  user: 'Submitter',
  approver: 'Tourism Officer',
  external_approver: 'Municipal office reviewer',
  admin: 'System administrator',
};
const inputClasses =
  'h-11 w-full rounded-xl border border-warm-border bg-white px-3 text-xs text-warm-text outline-none focus:border-clay';

async function parseResponse<T>(response: Response): Promise<T> {
  const body: unknown = await response.json();
  if (!response.ok) {
    const message = typeof body === 'object' && body !== null && 'error' in body
      ? String(body.error)
      : 'The request could not be completed.';
    throw new Error(message);
  }
  return body as T;
}

export default function UserManagementPage() {
  const [directory, setDirectory] = useState<Directory>({
    accounts: [],
    roleGrants: [],
    officeMemberships: [],
    offices: [],
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<WorkflowRole>('user');
  const [selectedAccountId, setSelectedAccountId] = useState('');
  const [selectedRole, setSelectedRole] = useState<WorkflowRole>('external_approver');
  const [selectedOfficeId, setSelectedOfficeId] = useState('');
  const [reason, setReason] = useState('');
  const [officeCode, setOfficeCode] = useState('');
  const [officeName, setOfficeName] = useState('');

  const loadDirectory = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await parseResponse<Directory>(
        await fetch('/api/admin/accounts', { cache: 'no-store' })
      );
      setDirectory(data);
      setSelectedAccountId((current) =>
        data.accounts.some((account) => account.id === current)
          ? current
          : data.accounts[0]?.id ?? ''
      );
      setSelectedOfficeId((current) =>
        data.offices.some((office) => office.id === current)
          ? current
          : data.offices.find((office) => office.is_active)?.id ?? ''
      );
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Account directory could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDirectory();
  }, [loadDirectory]);

  const filteredAccounts = useMemo(() => {
    const normalized = search.trim().toLowerCase();
    return directory.accounts.filter((account) =>
      !normalized
      || (account.email ?? '').toLowerCase().includes(normalized)
      || account.id.toLowerCase().includes(normalized)
    );
  }, [directory.accounts, search]);

  const submitAction = async (payload: Record<string, unknown>, successMessage: string) => {
    setSaving(true);
    setError('');
    setNotice('');
    try {
      await parseResponse(await fetch('/api/admin/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }));
      setNotice(successMessage);
      setReason('');
      await loadDirectory();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Administrator action failed.');
    } finally {
      setSaving(false);
    }
  };

  const inviteAccount = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await submitAction({
      action: 'invite',
      email: inviteEmail,
      role: inviteRole,
    }, 'Invitation sent. Elevated roles and office membership changes are recorded in the clean workflow history.');
    setInviteEmail('');
  };

  const grantRole = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await submitAction({
      action: 'grant-role',
      profileId: selectedAccountId,
      role: selectedRole,
      reason,
    }, 'Workflow role grant recorded.');
  };

  const grantMembership = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await submitAction({
      action: 'grant-office',
      profileId: selectedAccountId,
      officeId: selectedOfficeId,
      reason,
    }, 'Office membership recorded.');
  };

  const createOffice = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await submitAction({
      action: 'create-office',
      code: officeCode,
      name: officeName,
    }, 'Office created.');
    setOfficeCode('');
    setOfficeName('');
  };

  const officeById = new Map(directory.offices.map((office) => [office.id, office]));

  return (
    <div className="space-y-6">
      <header>
        <p className="text-xs font-semibold uppercase tracking-wide text-clay">Administrator workspace</p>
        <h1 className="mt-2 font-serif text-3xl text-warm-text">Accounts and permissions</h1>
        <p className="mt-2 text-sm text-muted-text">
          Manage role grants, office memberships, and office availability. Authorization uses active grants, never editable profile metadata.
        </p>
      </header>

      {error && <p role="alert" className="rounded-xl border border-rejected-bg bg-rejected-bg/50 p-4 text-sm text-rejected-text">{error}</p>}
      {notice && <p role="status" className="rounded-xl border border-approved-bg bg-approved-bg/50 p-4 text-sm text-approved-text">{notice}</p>}

      <section className="grid gap-5 lg:grid-cols-2">
        <form onSubmit={inviteAccount} className="rounded-2xl border border-warm-border bg-card p-5">
          <h2 className="font-serif text-xl text-warm-text">Invite an account</h2>
          <p className="mt-1 text-xs text-muted-text">The account receives an invitation email. Demographic information is not collected here.</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_220px]">
            <label className="grid gap-1 text-xs font-medium text-warm-text">
              Email
              <input required type="email" value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} className={inputClasses} />
            </label>
            <label className="grid gap-1 text-xs font-medium text-warm-text">
              Initial role
              <select value={inviteRole} onChange={(event) => setInviteRole(event.target.value as WorkflowRole)} className={inputClasses}>
                {roles.map((role) => <option key={role} value={role}>{roleLabels[role]}</option>)}
              </select>
            </label>
          </div>
          <button disabled={saving} className="mt-4 rounded-full bg-clay px-5 py-2.5 text-xs font-semibold text-white disabled:opacity-50">
            {saving ? 'Sending...' : 'Send invitation'}
          </button>
        </form>

        <form onSubmit={createOffice} className="rounded-2xl border border-warm-border bg-card p-5">
          <h2 className="font-serif text-xl text-warm-text">Add a municipal office</h2>
          <p className="mt-1 text-xs text-muted-text">Office routing remains manually selected by the Tourism Officer.</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-xs font-medium text-warm-text">
              Office code
              <input required maxLength={30} value={officeCode} onChange={(event) => setOfficeCode(event.target.value)} className={inputClasses} />
            </label>
            <label className="grid gap-1 text-xs font-medium text-warm-text">
              Office name
              <input required maxLength={200} value={officeName} onChange={(event) => setOfficeName(event.target.value)} className={inputClasses} />
            </label>
          </div>
          <button disabled={saving} className="mt-4 rounded-full border border-warm-border px-5 py-2.5 text-xs font-semibold text-warm-text disabled:opacity-50">
            Add office
          </button>
        </form>
      </section>

      <section className="grid gap-5 xl:grid-cols-2">
        <form onSubmit={grantRole} className="rounded-2xl border border-warm-border bg-card p-5">
          <h2 className="font-serif text-xl text-warm-text">Grant a workflow role</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-xs font-medium text-warm-text">
              Account
              <select required value={selectedAccountId} onChange={(event) => setSelectedAccountId(event.target.value)} className={inputClasses}>
                {directory.accounts.map((account) => <option key={account.id} value={account.id}>{account.email ?? account.id}</option>)}
              </select>
            </label>
            <label className="grid gap-1 text-xs font-medium text-warm-text">
              Role
              <select value={selectedRole} onChange={(event) => setSelectedRole(event.target.value as WorkflowRole)} className={inputClasses}>
                {roles.map((role) => <option key={role} value={role}>{roleLabels[role]}</option>)}
              </select>
            </label>
          </div>
          <label className="mt-3 grid gap-1 text-xs font-medium text-warm-text">
            Reason
            <input required maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} className={inputClasses} />
          </label>
          <button disabled={saving || !selectedAccountId} className="mt-4 rounded-full bg-clay px-5 py-2.5 text-xs font-semibold text-white disabled:opacity-50">
            Grant role
          </button>
        </form>

        <form onSubmit={grantMembership} className="rounded-2xl border border-warm-border bg-card p-5">
          <h2 className="font-serif text-xl text-warm-text">Assign office membership</h2>
          <p className="mt-1 text-xs text-muted-text">The account must already have an active municipal office reviewer role.</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-xs font-medium text-warm-text">
              Account
              <select required value={selectedAccountId} onChange={(event) => setSelectedAccountId(event.target.value)} className={inputClasses}>
                {directory.accounts.map((account) => <option key={account.id} value={account.id}>{account.email ?? account.id}</option>)}
              </select>
            </label>
            <label className="grid gap-1 text-xs font-medium text-warm-text">
              Office
              <select required value={selectedOfficeId} onChange={(event) => setSelectedOfficeId(event.target.value)} className={inputClasses}>
                {directory.offices.filter((office) => office.is_active).map((office) => (
                  <option key={office.id} value={office.id}>{office.name}</option>
                ))}
              </select>
            </label>
          </div>
          <label className="mt-3 grid gap-1 text-xs font-medium text-warm-text">
            Reason
            <input required maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} className={inputClasses} />
          </label>
          <button disabled={saving || !selectedAccountId || !selectedOfficeId} className="mt-4 rounded-full border border-warm-border px-5 py-2.5 text-xs font-semibold text-warm-text disabled:opacity-50">
            Assign office
          </button>
        </form>
      </section>

      <section className="rounded-2xl border border-warm-border bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-serif text-xl text-warm-text">Account directory</h2>
            <p className="mt-1 text-xs text-muted-text">{directory.accounts.length} accounts · account verification status reflects Supabase Auth only.</p>
          </div>
          <div className="flex gap-2">
            <input aria-label="Search accounts" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search email or ID" className={`${inputClasses} max-w-xs`} />
            <button type="button" onClick={() => void loadDirectory()} disabled={loading} className="rounded-xl border border-warm-border px-4 text-xs font-semibold text-warm-text disabled:opacity-50">
              {loading ? 'Loading...' : 'Refresh'}
            </button>
          </div>
        </div>

        {loading ? (
          <p role="status" className="py-8 text-sm text-muted-text">Loading accounts...</p>
        ) : filteredAccounts.length === 0 ? (
          <p className="py-8 text-sm text-muted-text">No accounts match this search.</p>
        ) : (
          <ul className="mt-4 divide-y divide-warm-border">
            {filteredAccounts.map((account) => {
              const activeGrants = directory.roleGrants.filter((grant) =>
                grant.profile_id === account.id && !grant.revoked_at
              );
              const activeMemberships = directory.officeMemberships.filter((membership) =>
                membership.profile_id === account.id && !membership.ended_at
              );
              return (
                <li key={account.id} className="py-4">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="break-all text-sm font-semibold text-warm-text">{account.email ?? 'No email address'}</p>
                      <p className="mt-1 break-all text-[10px] text-muted-text">{account.id}</p>
                      <p className="mt-1 text-[10px] text-muted-text">
                        Created {new Date(account.created_at).toLocaleDateString()} · {account.email_confirmed_at ? 'Email verified' : 'Email not verified'}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {activeGrants.length === 0 && <span className="text-xs text-muted-text">No active workflow role</span>}
                      {activeGrants.map((grant) => (
                        <div key={grant.id} className="flex items-center gap-2 rounded-full bg-sidebar px-3 py-1.5">
                          <span className="text-[10px] font-medium text-warm-text">{roleLabels[grant.role]}</span>
                          <button
                            type="button"
                            disabled={saving}
                            onClick={() => {
                              const revokeReason = window.prompt(`Reason for revoking ${roleLabels[grant.role]}?`);
                              if (revokeReason?.trim()) {
                                void submitAction({ action: 'revoke-role', grantId: grant.id, reason: revokeReason.trim() }, 'Workflow role revoked.');
                              }
                            }}
                            className="text-[10px] font-semibold text-rejected-text disabled:opacity-50"
                          >
                            Revoke
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>

                  {activeMemberships.length > 0 && (
                    <ul className="mt-3 flex flex-wrap gap-2">
                      {activeMemberships.map((membership) => {
                        const office = officeById.get(membership.office_id);
                        return (
                          <li key={membership.id} className="flex items-center gap-2 rounded-xl border border-warm-border px-3 py-2">
                            <span className="text-[10px] text-warm-text">{office?.name ?? 'Unknown office'}</span>
                            <button
                              type="button"
                              disabled={saving}
                              onClick={() => {
                                const revokeReason = window.prompt(`Reason for removing ${office?.name ?? 'this office'} membership?`);
                                if (revokeReason?.trim()) {
                                  void submitAction({ action: 'revoke-office', membershipId: membership.id, reason: revokeReason.trim() }, 'Office membership revoked.');
                                }
                              }}
                              className="text-[10px] font-semibold text-rejected-text disabled:opacity-50"
                            >
                              Remove
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="rounded-2xl border border-warm-border bg-card p-5">
        <h2 className="font-serif text-xl text-warm-text">Municipal offices</h2>
        {directory.offices.length === 0 ? (
          <p className="mt-3 text-sm text-muted-text">No offices have been configured.</p>
        ) : (
          <ul className="mt-3 divide-y divide-warm-border">
            {directory.offices.map((office) => (
              <li key={office.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div>
                  <p className="text-sm font-semibold text-warm-text">{office.name}</p>
                  <p className="text-[10px] text-muted-text">{office.code} · {office.is_active ? 'Active' : 'Inactive'}</p>
                </div>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => {
                    const reasonText = window.prompt(`Reason for ${office.is_active ? 'deactivating' : 'activating'} ${office.name}?`);
                    if (reasonText?.trim()) {
                      void submitAction({
                        action: 'set-office-active',
                        officeId: office.id,
                        isActive: !office.is_active,
                        reason: reasonText.trim(),
                      }, `Office ${office.is_active ? 'deactivated' : 'activated'}.`);
                    }
                  }}
                  className="rounded-full border border-warm-border px-4 py-2 text-xs font-semibold text-warm-text disabled:opacity-50"
                >
                  {office.is_active ? 'Deactivate' : 'Activate'}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

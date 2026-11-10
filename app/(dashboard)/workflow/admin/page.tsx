import Link from 'next/link';

export default function AdministrationPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <p className="text-xs font-semibold uppercase tracking-wide text-clay">Administrator workspace</p>
        <h1 className="mt-2 font-serif text-3xl text-warm-text">System administration</h1>
        <p className="mt-3 text-sm leading-6 text-muted-text">
          Manage access through audited role grants and office memberships. Administrators do not make submission decisions.
        </p>
      </header>
      <div className="grid gap-4 sm:grid-cols-2">
        <Link href="/workflow/admin/user_management" className="rounded-2xl border border-warm-border bg-card p-5 hover:border-clay">
          <h2 className="font-serif text-xl text-warm-text">Accounts and permissions</h2>
          <p className="mt-2 text-sm leading-6 text-muted-text">Invite users, manage workflow role grants, and assign municipal office memberships.</p>
        </Link>
        <Link href="/workflow/admin/email-monitoring" className="rounded-2xl border border-warm-border bg-card p-5 hover:border-clay">
          <h2 className="font-serif text-xl text-warm-text">Email delivery</h2>
          <p className="mt-2 text-sm leading-6 text-muted-text">Review delivery status and retry eligible notification email deliveries.</p>
        </Link>
      </div>
      <p className="rounded-xl border border-warm-border bg-card p-4 text-sm leading-6 text-muted-text">
        Cross-submission reporting, archival and retention, and a global notification feed are unavailable in the clean workflow. Their measures, access rules, and retention requirements have not been established; no legacy tables are queried.
      </p>
    </div>
  );
}

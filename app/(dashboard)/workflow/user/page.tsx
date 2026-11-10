'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

type Submission = {
  id: string;
  tracking_number: string;
  title: string;
  description: string | null;
  state: string;
  created_at: string;
  updated_at: string;
};

const STATE_LABELS: Record<string, string> = {
  initial_review: 'Tourism Officer review',
  office_review: 'Municipal office review',
  returned: 'Changes requested',
  approved: 'Approved',
  rejected: 'Rejected',
  draft: 'Draft',
};

export default function WorkflowDashboard() {
  const supabase = useMemo(() => createClient(), []);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadSubmissions = useCallback(async () => {
    setLoading(true);
    setError('');
    const { data, error: queryError } = await supabase
      .from('submissions')
      .select('id, tracking_number, title, description, state, created_at, updated_at')
      .order('created_at', { ascending: false });
    if (queryError) {
      console.error('Could not load submissions:', queryError);
      setError('Your submissions could not be loaded. Please try again.');
      setSubmissions([]);
    } else {
      setSubmissions(data ?? []);
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    void loadSubmissions();
  }, [loadSubmissions]);

  return (
    <section>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-clay">Submitter workspace</p>
          <h1 className="mt-2 font-serif text-3xl text-warm-text">My submissions</h1>
          <p className="mt-2 text-sm text-muted-text">Track document versions and review progress.</p>
        </div>
        <Link href="/workflow/user/upload" className="rounded-full bg-clay px-5 py-3 text-sm font-semibold text-white">
          New submission
        </Link>
      </header>

      {error && <p role="alert" className="mb-4 rounded-xl border border-rejected-bg bg-rejected-bg/50 p-4 text-sm text-rejected-text">{error}</p>}
      {loading ? (
        <p role="status" className="py-10 text-center text-sm text-muted-text">Loading submissions...</p>
      ) : submissions.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-warm-border bg-card p-10 text-center">
          <p className="font-serif text-xl text-warm-text">No submissions yet</p>
          <p className="mt-2 text-sm text-muted-text">Your submitted documents and status will appear here.</p>
        </div>
      ) : (
        <ul className="grid gap-3">
          {submissions.map((submission) => (
            <li key={submission.id} className="rounded-2xl border border-warm-border bg-card p-5">
              <Link href={`/workflow/user/file_registry/${submission.id}`} className="block">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="font-semibold text-warm-text">{submission.title}</h2>
                    <p className="mt-1 text-xs text-muted-text">{submission.tracking_number} · Submitted {new Date(submission.created_at).toLocaleDateString()}</p>
                  </div>
                  <span className="rounded-full bg-sidebar px-3 py-1.5 text-xs font-medium text-warm-text">
                    {STATE_LABELS[submission.state] ?? submission.state.replaceAll('_', ' ')}
                  </span>
                </div>
                {submission.description && <p className="mt-3 line-clamp-2 text-sm text-muted-text">{submission.description}</p>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

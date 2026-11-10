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
  initial_review: 'Initial review',
  office_review: 'Office responses',
  returned: 'Returned to submitter',
  approved: 'Approved',
  rejected: 'Rejected',
};

export default function ApproverDashboard() {
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
      .in('state', ['initial_review', 'office_review'])
      .order('updated_at', { ascending: true });
    if (queryError) {
      console.error('Could not load Tourism Officer queue:', queryError);
      setError('The review queue could not be loaded. Please try again.');
      setSubmissions([]);
    } else {
      setSubmissions(data ?? []);
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    void loadSubmissions();
    const channel = supabase
      .channel('clean-tourism-officer-submissions')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'submissions' }, () => {
        void loadSubmissions();
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [loadSubmissions, supabase]);

  return (
    <section>
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-clay">Tourism Officer</p>
        <h1 className="mt-2 font-serif text-3xl text-warm-text">Review queue</h1>
        <p className="mt-2 text-sm text-muted-text">Review each submission first, then manually assign offices when the requirements call for it.</p>
      </header>
      {error && <p role="alert" className="mb-4 rounded-xl border border-rejected-bg bg-rejected-bg/50 p-4 text-sm text-rejected-text">{error}</p>}
      {loading ? (
        <p role="status" className="py-10 text-center text-sm text-muted-text">Loading review queue...</p>
      ) : submissions.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-warm-border bg-card p-10 text-center text-sm text-muted-text">
          No submissions currently require review.
        </div>
      ) : (
        <ul className="grid gap-3">
          {submissions.map((submission) => (
            <li key={submission.id} className="rounded-2xl border border-warm-border bg-card p-5">
              <Link href={`/workflow/approver/file_management/${submission.id}`} className="block">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="font-semibold text-warm-text">{submission.title}</h2>
                    <p className="mt-1 text-xs text-muted-text">{submission.tracking_number} · Submitted {new Date(submission.created_at).toLocaleDateString()}</p>
                  </div>
                  <span className="rounded-full bg-pending-bg px-3 py-1.5 text-xs font-medium text-pending-text">
                    {STATE_LABELS[submission.state] ?? submission.state}
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

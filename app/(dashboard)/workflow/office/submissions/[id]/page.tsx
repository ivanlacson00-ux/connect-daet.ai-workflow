'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import DocumentMessaging from '@/components/DocumentMessaging';
import { createClient } from '@/lib/supabase/client';

type Submission = {
  id: string;
  tracking_number: string;
  title: string;
  state: string;
};

export default function OfficeSubmissionConversationPage() {
  const params = useParams<{ id: string }>();
  const submissionId = Array.isArray(params.id) ? params.id[0] : params.id;
  const supabase = useMemo(() => createClient(), []);
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    const loadSubmission = async () => {
      try {
        const { data, error: submissionError } = await supabase
          .from('submissions')
          .select('id, tracking_number, title, state')
          .eq('id', submissionId)
          .single();
        if (!active) return;
        if (submissionError) {
          setError('This submission is not available to your office membership.');
        } else {
          setSubmission(data);
        }
        setLoading(false);
      } catch (loadError: unknown) {
        console.error('Assigned submission could not be loaded:', loadError);
        if (active) {
          setError('This submission could not be loaded.');
          setLoading(false);
        }
      }
    };
    void loadSubmission();

    return () => {
      active = false;
    };
  }, [submissionId, supabase]);

  if (loading) return <p role="status" className="py-12 text-center text-sm text-muted-text">Loading submission...</p>;

  return (
    <section className="space-y-5">
      <Link href="/workflow/office" className="text-sm font-semibold text-clay">← Assigned office queue</Link>
      {error && <p role="alert" className="rounded-xl border border-rejected-bg bg-rejected-bg/50 p-4 text-sm text-rejected-text">{error}</p>}
      {submission && (
        <>
          <header className="rounded-2xl border border-warm-border bg-card p-6">
            <p className="text-xs font-semibold uppercase tracking-wide text-clay">{submission.tracking_number}</p>
            <h1 className="mt-2 font-serif text-3xl text-warm-text">{submission.title}</h1>
            <p className="mt-2 text-sm text-muted-text">Status: {submission.state.replaceAll('_', ' ')}</p>
          </header>
          <DocumentMessaging
            key={submission.id}
            submissionId={submission.id}
            fileName={submission.title}
            trackingNumber={submission.tracking_number}
            activity={null}
          />
        </>
      )}
    </section>
  );
}

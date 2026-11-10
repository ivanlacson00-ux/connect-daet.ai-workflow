'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { getCurrentWorkflowAccess } from '@/lib/auth/access';
import { downloadWorkflowAttachment, saveDownload } from '@/lib/workflow/attachments';

type ReviewCycle = {
  id: string;
  submission_id: string;
  assignment_id: string;
  office_id: string;
  responsibility_id: string;
  submission_version_id: string;
  responsibility_revision_id: string;
  created_at: string;
};
type Submission = {
  id: string;
  tracking_number: string;
  title: string;
  description: string | null;
  state: string;
  current_version_id: string;
};
type Responsibility = { id: string; assignment_id: string; responsibility_key: string | null };
type Revision = { id: string; responsibility_id: string; revision_number: number; responsibility_type: string; scope: string; instructions: string | null };
type Response = { id: string; review_cycle_id: string; outcome: string; findings: string | null; remarks: string | null; submitted_at: string };
type Attachment = { id: string; submission_id: string; original_filename: string; byte_size: number | null };

const RESPONSIBILITY_LABELS: Record<string, string> = {
  mandatory_approval: 'Mandatory approval / clearance',
  evaluation: 'Evaluation / verification',
  recommendation: 'Recommendation',
};

export default function OfficeQueuePage() {
  const supabase = useMemo(() => createClient(), []);
  const [officeIds, setOfficeIds] = useState<string[]>([]);
  const [cycles, setCycles] = useState<ReviewCycle[]>([]);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [responsibilities, setResponsibilities] = useState<Responsibility[]>([]);
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [responses, setResponses] = useState<Response[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [outcomes, setOutcomes] = useState<Record<string, string>>({});
  const [findings, setFindings] = useState<Record<string, string>>({});
  const [remarks, setRemarks] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [savingCycle, setSavingCycle] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const loadQueue = useCallback(async () => {
    setLoading(true);
    setError('');
    const access = await getCurrentWorkflowAccess(supabase);
    if (!access || !access.roles.includes('external_approver')) {
      setError('An active external_approver role is required.');
      setLoading(false);
      return;
    }
    if (access.officeIds.length === 0) {
      setOfficeIds([]);
      setCycles([]);
      setSubmissions([]);
      setLoading(false);
      return;
    }
    setOfficeIds(access.officeIds);

    const { data: cycleRows, error: cycleError } = await supabase
      .from('review_cycles')
      .select('id, submission_id, assignment_id, office_id, responsibility_id, submission_version_id, responsibility_revision_id, created_at')
      .in('office_id', access.officeIds)
      .order('created_at', { ascending: false });
    if (cycleError) {
      console.error('Could not load assigned office review cycles:', cycleError);
      setError('Assigned reviews could not be loaded.');
      setLoading(false);
      return;
    }
    const loadedCycles = cycleRows ?? [];
    setCycles(loadedCycles);
    if (!loadedCycles.length) {
      setSubmissions([]);
      setResponsibilities([]);
      setRevisions([]);
      setResponses([]);
      setAttachments([]);
      setLoading(false);
      return;
    }

    const submissionIds = [...new Set(loadedCycles.map((cycle) => cycle.submission_id))];
    const responsibilityIds = [...new Set(loadedCycles.map((cycle) => cycle.responsibility_id))];
    const [
      submissionResult,
      responsibilityResult,
      responseResult,
      attachmentResult,
    ] = await Promise.all([
      supabase.from('submissions')
        .select('id, tracking_number, title, description, state, current_version_id')
        .in('id', submissionIds),
      supabase.from('office_responsibilities')
        .select('id, assignment_id, responsibility_key')
        .in('id', responsibilityIds),
      supabase.from('review_responses')
        .select('id, review_cycle_id, outcome, findings, remarks, submitted_at')
        .in('review_cycle_id', loadedCycles.map((cycle) => cycle.id)),
      supabase.from('attachments')
        .select('id, submission_id, original_filename, byte_size')
        .in('submission_id', submissionIds),
    ]);
    const errors = [submissionResult.error, responsibilityResult.error, responseResult.error, attachmentResult.error].filter(Boolean);
    if (errors.length) {
      console.error('Could not load assigned office submission data:', errors);
      setError('Some assigned submission details could not be loaded.');
      setLoading(false);
      return;
    }

    const loadedResponsibilities = responsibilityResult.data ?? [];
    const revisionResult = loadedResponsibilities.length
      ? await supabase.from('office_responsibility_revisions')
          .select('id, responsibility_id, revision_number, responsibility_type, scope, instructions')
          .in('responsibility_id', loadedResponsibilities.map((responsibility) => responsibility.id))
          .order('revision_number')
      : { data: [], error: null };
    if (revisionResult.error) {
      console.error('Could not load assigned responsibility revisions:', revisionResult.error);
      setError('The assigned responsibility details could not be loaded.');
      setLoading(false);
      return;
    }

    setSubmissions(submissionResult.data ?? []);
    setResponsibilities(loadedResponsibilities);
    setRevisions(revisionResult.data ?? []);
    setResponses(responseResult.data ?? []);
    setAttachments(attachmentResult.data ?? []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    void loadQueue().catch((loadError: unknown) => {
      console.error('Office queue load failed:', loadError);
      setError('The office queue could not be loaded.');
      setLoading(false);
    });
  }, [loadQueue]);

  const submitResponse = async (cycle: ReviewCycle, responsibilityType: string) => {
    if (savingCycle) return;
    const outcome = outcomes[cycle.id]?.trim() ?? '';
    if (!outcome) {
      setError(responsibilityType === 'mandatory_approval'
        ? 'Select approved or denied for this mandatory responsibility.'
        : 'Enter an outcome for this responsibility.');
      return;
    }
    if (responsibilityType === 'mandatory_approval' && !['approved', 'denied'].includes(outcome)) {
      setError('A mandatory approval or clearance must be approved or denied.');
      return;
    }

    setSavingCycle(cycle.id);
    setError('');
    setNotice('');
    const { error: responseError } = await supabase.rpc('submit_office_response', {
      p_review_cycle_id: cycle.id,
      p_outcome: outcome,
      p_findings: findings[cycle.id]?.trim() || null,
      p_remarks: remarks[cycle.id]?.trim() || null,
      p_attachment_ids: [],
      p_idempotency_key: crypto.randomUUID(),
    });
    if (responseError) {
      console.error('Office response was rejected by the workflow operation:', responseError);
      setError(responseError.message);
    } else {
      setNotice('Your office response was recorded and returned to the Tourism Officer.');
      await loadQueue();
    }
    setSavingCycle(null);
  };

  const downloadAttachment = async (attachment: Attachment) => {
    try {
      const file = await downloadWorkflowAttachment(supabase, attachment.id);
      saveDownload(file, attachment.original_filename);
    } catch (downloadError) {
      console.error('Assigned attachment download failed:', downloadError);
      setError('This document could not be downloaded with your current office assignment.');
    }
  };

  const getSubmission = (submissionId: string) => submissions.find((submission) => submission.id === submissionId);

  if (loading) return <p role="status" className="py-12 text-center text-sm text-muted-text">Loading assigned office queue...</p>;

  return (
    <section>
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-clay">External office reviewer</p>
        <h1 className="mt-2 font-serif text-3xl text-warm-text">Shared assignment queue</h1>
        <p className="mt-2 text-sm text-muted-text">Respond only to the responsibilities assigned to your office. Overall decisions and sender change requests remain with the Tourism Officer.</p>
      </header>
      {officeIds.length === 0 && !error && (
        <p className="mb-4 rounded-xl border border-pending-bg bg-pending-bg/40 p-4 text-sm text-pending-text">
          No active office membership is configured for this account.
        </p>
      )}
      {error && <p role="alert" className="mb-4 rounded-xl border border-rejected-bg bg-rejected-bg/50 p-4 text-sm text-rejected-text">{error}</p>}
      {notice && <p role="status" className="mb-4 rounded-xl border border-approved-bg bg-approved-bg/50 p-4 text-sm text-approved-text">{notice}</p>}
      {cycles.length === 0 && officeIds.length > 0 && !error ? (
        <div className="rounded-2xl border border-dashed border-warm-border bg-card p-10 text-center text-sm text-muted-text">
          No assigned review cycles are available to your office.
        </div>
      ) : (
        <ul className="grid gap-4">
          {cycles.map((cycle) => {
            const submission = getSubmission(cycle.submission_id);
            const responsibility = responsibilities.find((entry) => entry.id === cycle.responsibility_id);
            const revision = revisions.find((entry) => entry.id === cycle.responsibility_revision_id);
            const response = responses.find((entry) => entry.review_cycle_id === cycle.id);
            if (!submission || !responsibility || !revision) return null;
            const isCurrentVersion = submission.current_version_id === cycle.submission_version_id;
            const typeLabel = RESPONSIBILITY_LABELS[revision.responsibility_type] ?? revision.responsibility_type;
            return (
              <li key={cycle.id} className="rounded-2xl border border-warm-border bg-card p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold text-clay">{submission.tracking_number}</p>
                    <h2 className="mt-1 font-semibold text-warm-text">{submission.title}</h2>
                    <p className="mt-1 text-xs text-muted-text">{typeLabel} · {isCurrentVersion ? 'Current document version' : 'Prior version; response is read-only'}</p>
                  </div>
                  <span className="rounded-full bg-sidebar px-3 py-1 text-xs text-warm-text">{submission.state.replaceAll('_', ' ')}</span>
                </div>
                <p className="mt-3 whitespace-pre-wrap text-sm text-muted-text">Assigned scope: {revision.scope}</p>
                {revision.instructions && <p className="mt-2 whitespace-pre-wrap text-sm text-muted-text">Instructions: {revision.instructions}</p>}
                {submission.description && <p className="mt-3 whitespace-pre-wrap text-sm text-warm-text">{submission.description}</p>}
                <div className="mt-3 flex flex-wrap gap-2">
                  <Link
                    href={`/workflow/office/submissions/${submission.id}`}
                    className="rounded-full border border-warm-border px-3 py-2 text-xs font-medium text-warm-text"
                  >
                    Conversation
                  </Link>
                  {attachments.filter((attachment) => attachment.submission_id === submission.id).map((attachment) => (
                    <button key={attachment.id} type="button" onClick={() => void downloadAttachment(attachment)} className="rounded-full border border-warm-border px-3 py-2 text-xs font-medium text-warm-text">
                      Download {attachment.original_filename}
                    </button>
                  ))}
                </div>
                {response ? (
                  <div className="mt-4 rounded-xl bg-sidebar p-4 text-sm">
                    <p className="font-semibold text-warm-text">Response submitted: {response.outcome}</p>
                    {response.findings && <p className="mt-2 whitespace-pre-wrap text-muted-text">{response.findings}</p>}
                    {response.remarks && <p className="mt-2 whitespace-pre-wrap text-muted-text">Remarks: {response.remarks}</p>}
                  </div>
                ) : isCurrentVersion && submission.state === 'office_review' ? (
                  <div className="mt-4 grid gap-3 border-t border-warm-border pt-4">
                    {revision.responsibility_type === 'mandatory_approval' ? (
                      <label className="grid gap-2 text-sm font-medium text-warm-text">
                        Decision
                        <select value={outcomes[cycle.id] ?? ''} onChange={(event) => setOutcomes((current) => ({ ...current, [cycle.id]: event.target.value }))} className="rounded-xl border border-warm-border bg-white p-3">
                          <option value="">Select a decision</option>
                          <option value="approved">Approve assigned requirement</option>
                          <option value="denied">Deny assigned requirement</option>
                        </select>
                      </label>
                    ) : (
                      <label className="grid gap-2 text-sm font-medium text-warm-text">
                        Outcome
                        <input value={outcomes[cycle.id] ?? ''} onChange={(event) => setOutcomes((current) => ({ ...current, [cycle.id]: event.target.value }))} className="rounded-xl border border-warm-border bg-white p-3" placeholder="Briefly state the result" />
                      </label>
                    )}
                    <label className="grid gap-2 text-sm font-medium text-warm-text">
                      Findings
                      <textarea value={findings[cycle.id] ?? ''} onChange={(event) => setFindings((current) => ({ ...current, [cycle.id]: event.target.value }))} rows={3} className="rounded-xl border border-warm-border bg-white p-3" />
                    </label>
                    <label className="grid gap-2 text-sm font-medium text-warm-text">
                      Remarks (optional)
                      <textarea value={remarks[cycle.id] ?? ''} onChange={(event) => setRemarks((current) => ({ ...current, [cycle.id]: event.target.value }))} rows={2} className="rounded-xl border border-warm-border bg-white p-3" />
                    </label>
                    <button type="button" disabled={savingCycle === cycle.id} onClick={() => void submitResponse(cycle, revision.responsibility_type)} className="justify-self-start rounded-full bg-clay px-5 py-3 text-sm font-semibold text-white disabled:opacity-50">
                      {savingCycle === cycle.id ? 'Submitting...' : 'Return response to Tourism Officer'}
                    </button>
                  </div>
                ) : (
                  <p className="mt-4 text-sm text-muted-text">This cycle is not currently eligible for a response.</p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

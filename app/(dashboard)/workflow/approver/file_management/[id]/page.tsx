'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { downloadWorkflowAttachment, saveDownload } from '@/lib/workflow/attachments';
import DocumentMessaging from '@/components/DocumentMessaging';

type Submission = {
  id: string;
  tracking_number: string;
  title: string;
  description: string | null;
  state: string;
  current_version_id: string;
  created_at: string;
  destination_department: string | null;
};

type Attachment = {
  id: string;
  original_filename: string;
  content_type: string | null;
  byte_size: number | null;
  created_at: string;
};

type Office = { id: string; name: string; code: string };
type Assignment = { id: string; office_id: string; instructions: string | null; cancelled_at: string | null };
type Responsibility = { id: string; assignment_id: string; responsibility_key: string | null };
type Revision = { id: string; responsibility_id: string; revision_number: number; responsibility_type: string; scope: string; instructions: string | null };
type ReviewCycle = { id: string; responsibility_id: string; submission_version_id: string };
type ReviewResponse = { id: string; review_cycle_id: string; outcome: string; findings: string | null; remarks: string | null; submitted_at: string; submitted_by_profile_id: string };
type OfficerReview = { review_response_id: string; disposition: string; reason: string | null; notes: string | null; created_at: string };
type ResponsibilityType = 'mandatory_approval' | 'evaluation' | 'recommendation';
type Decision = 'approved' | 'returned' | 'rejected';

const RESPONSIBILITY_LABELS: Record<ResponsibilityType, string> = {
  mandatory_approval: 'Mandatory approval / clearance',
  evaluation: 'Evaluation / verification',
  recommendation: 'Recommendation',
};

export default function ApproverManagePage() {
  const { id: routeId } = useParams<{ id: string }>();
  const submissionId = Array.isArray(routeId) ? routeId[0] : routeId;
  const supabase = useMemo(() => createClient(), []);
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [offices, setOffices] = useState<Office[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [responsibilities, setResponsibilities] = useState<Responsibility[]>([]);
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [cycles, setCycles] = useState<ReviewCycle[]>([]);
  const [responses, setResponses] = useState<ReviewResponse[]>([]);
  const [officerReviews, setOfficerReviews] = useState<OfficerReview[]>([]);
  const [selectedOfficeIds, setSelectedOfficeIds] = useState<string[]>([]);
  const [routingMode, setRoutingMode] = useState<'simultaneous' | 'one_at_a_time'>('simultaneous');
  const [responsibilityType, setResponsibilityType] = useState<ResponsibilityType>('mandatory_approval');
  const [scope, setScope] = useState('');
  const [instructions, setInstructions] = useState('');
  const [routingReason, setRoutingReason] = useState('');
  const [decisionReason, setDecisionReason] = useState('');
  const [decision, setDecision] = useState<Decision>('approved');
  const [correctionInstructions, setCorrectionInstructions] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const loadDetails = useCallback(async () => {
    setLoading(true);
    setError('');
    const { data: current, error: submissionError } = await supabase
      .from('submissions')
      .select('id, tracking_number, title, description, state, current_version_id, created_at, destination_department')
      .eq('id', submissionId)
      .single();
    if (submissionError) {
      console.error('Could not load clean submission:', submissionError);
      setError('This submission could not be loaded or is not available to your role.');
      setLoading(false);
      return;
    }

    const [
      attachmentResult,
      officeResult,
      assignmentResult,
      responsibilityResult,
      cycleResult,
      responseResult,
      officerReviewResult,
    ] = await Promise.all([
      supabase.from('attachments')
        .select('id, original_filename, content_type, byte_size, created_at')
        .eq('submission_id', submissionId)
        .order('created_at'),
      supabase.from('offices').select('id, name, code').eq('is_active', true).order('name'),
      supabase.from('office_assignments')
        .select('id, office_id, instructions, cancelled_at')
        .eq('submission_id', submissionId)
        .order('created_at'),
      supabase.from('office_responsibilities')
        .select('id, assignment_id, responsibility_key')
        .eq('submission_id', submissionId),
      supabase.from('review_cycles')
        .select('id, responsibility_id, submission_version_id')
        .eq('submission_id', submissionId),
      supabase.from('review_responses')
        .select('id, review_cycle_id, outcome, findings, remarks, submitted_at, submitted_by_profile_id')
        .eq('submission_id', submissionId)
        .order('submitted_at'),
      supabase.from('tourism_officer_response_reviews')
        .select('review_response_id, disposition, reason, notes, created_at')
        .eq('submission_id', submissionId)
        .order('created_at'),
    ]);

    const queryErrors = [
      attachmentResult.error,
      officeResult.error,
      assignmentResult.error,
      responsibilityResult.error,
      cycleResult.error,
      responseResult.error,
      officerReviewResult.error,
    ].filter(Boolean);
    if (queryErrors.length) {
      console.error('Could not load submission workflow history:', queryErrors);
      setError('Some workflow history could not be loaded. Verify your database access and refresh.');
      setLoading(false);
      return;
    }

    const loadedResponsibilities = responsibilityResult.data ?? [];
    const [revisionResult] = loadedResponsibilities.length
      ? await Promise.all([
          supabase.from('office_responsibility_revisions')
            .select('id, responsibility_id, revision_number, responsibility_type, scope, instructions')
            .in('responsibility_id', loadedResponsibilities.map((item) => item.id))
            .order('revision_number'),
        ])
      : [{ data: [], error: null }];
    if (revisionResult.error) {
      console.error('Could not load responsibility revisions:', revisionResult.error);
      setError('Office responsibility history could not be loaded.');
      setLoading(false);
      return;
    }

    setSubmission(current);
    setAttachments(attachmentResult.data ?? []);
    setOffices(officeResult.data ?? []);
    setAssignments(assignmentResult.data ?? []);
    setResponsibilities(loadedResponsibilities);
    setRevisions(revisionResult.data ?? []);
    setCycles(cycleResult.data ?? []);
    setResponses(responseResult.data ?? []);
    setOfficerReviews(officerReviewResult.data ?? []);
    setLoading(false);
  }, [submissionId, supabase]);

  useEffect(() => {
    void loadDetails();
  }, [loadDetails]);

  const downloadAttachment = async (attachment: Attachment) => {
    try {
      const file = await downloadWorkflowAttachment(supabase, attachment.id);
      saveDownload(file, attachment.original_filename);
    } catch (downloadError) {
      console.error('Attachment download failed:', downloadError);
      setError('The attachment could not be downloaded with your current access.');
    }
  };

  const recordDecision = async () => {
    if (!submission || saving) return;
    const stage = submission.state === 'initial_review' && decision !== 'approved'
      ? 'initial_review'
      : 'final_review';
    if (decision !== 'approved' && !decisionReason.trim()) {
      setError('A reason is required for a return or rejection.');
      return;
    }
    if (decision === 'returned' && !correctionInstructions.trim()) {
      setError('Provide the correction instructions for the submitter.');
      return;
    }

    setSaving(true);
    setError('');
    const { error: decisionError } = await supabase.rpc('record_overall_decision', {
      p_submission_id: submission.id,
      p_expected_version_id: submission.current_version_id,
      p_stage: stage,
      p_decision: decision,
      p_reason: decisionReason.trim() || null,
      p_correction_instructions: decision === 'returned' ? correctionInstructions.trim() : null,
      p_evidence_links: {},
      p_idempotency_key: crypto.randomUUID(),
    });
    if (decisionError) {
      console.error('Overall decision was rejected by the workflow operation:', decisionError);
      setError(decisionError.message);
    } else {
      setNotice(`The Tourism Officer recorded ${decision}.`);
      setDecisionReason('');
      setCorrectionInstructions('');
      await loadDetails();
    }
    setSaving(false);
  };

  const createRoutingPlan = async () => {
    if (!submission || saving) return;
    if (!selectedOfficeIds.length || !scope.trim() || !routingReason.trim()) {
      setError('Select at least one office and provide the responsibility scope and routing reason.');
      return;
    }
    if (routingMode === 'one_at_a_time' && selectedOfficeIds.length !== 1) {
      setError('One-at-a-time routing assigns one office per explicit Tourism Officer action.');
      return;
    }

    setSaving(true);
    setError('');
    const assignmentsPayload = selectedOfficeIds.map((officeId) => ({
      office_id: officeId,
      instructions: instructions.trim() || null,
      responsibilities: [{
        responsibility_key: responsibilityType,
        responsibility_type: responsibilityType,
        scope: scope.trim(),
        instructions: instructions.trim() || null,
      }],
    }));
    const { error: routeError } = await supabase.rpc('create_routing_plan', {
      p_submission_id: submission.id,
      p_mode: routingMode,
      p_assignments: assignmentsPayload,
      p_reason: routingReason.trim(),
      p_idempotency_key: crypto.randomUUID(),
    });
    if (routeError) {
      console.error('Office routing was rejected by the workflow operation:', routeError);
      setError(routeError.message);
    } else {
      setNotice('The Tourism Officer created the office assignments.');
      setSelectedOfficeIds([]);
      setScope('');
      setInstructions('');
      setRoutingReason('');
      await loadDetails();
    }
    setSaving(false);
  };

  const reviewResponse = async (responseId: string) => {
    if (saving) return;
    setSaving(true);
    setError('');
    const { error: reviewError } = await supabase.rpc('record_officer_response_review', {
      p_review_response_id: responseId,
      p_disposition: 'reviewed',
      p_reason: null,
      p_notes: null,
      p_idempotency_key: crypto.randomUUID(),
    });
    if (reviewError) {
      console.error('Office response review failed:', reviewError);
      setError(reviewError.message);
    } else {
      setNotice('Office response recorded as reviewed.');
      await loadDetails();
    }
    setSaving(false);
  };

  const getOfficeName = (officeId: string) => offices.find((office) => office.id === officeId)?.name ?? 'Office';
  const getResponsibility = (responsibilityId: string) => {
    const responsibility = responsibilities.find((entry) => entry.id === responsibilityId);
    const revision = revisions
      .filter((entry) => entry.responsibility_id === responsibilityId)
      .sort((left, right) => right.revision_number - left.revision_number)[0];
    return { responsibility, revision };
  };

  if (loading) return <p role="status" className="py-12 text-center text-sm text-muted-text">Loading submission history...</p>;
  if (error && !submission) return <p role="alert" className="rounded-xl border border-rejected-bg bg-rejected-bg/50 p-4 text-sm text-rejected-text">{error}</p>;
  if (!submission) return <p role="alert">Submission unavailable.</p>;

  const officeRoutingAvailable = offices.length > 0;
  const activeAssignments = assignments.filter((assignment) => !assignment.cancelled_at);

  return (
    <section className="space-y-6">
      <Link href="/workflow/approver" className="text-sm font-semibold text-clay">← Review queue</Link>
      <header className="rounded-2xl border border-warm-border bg-card p-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-clay">{submission.tracking_number}</p>
        <h1 className="mt-2 font-serif text-3xl text-warm-text">{submission.title}</h1>
        <p className="mt-2 text-sm text-muted-text">State: {submission.state.replaceAll('_', ' ')}</p>
        {submission.destination_department && <p className="mt-2 text-sm text-muted-text">Destination department: {submission.destination_department}</p>}
        {submission.description && <p className="mt-4 whitespace-pre-wrap text-sm text-warm-text">{submission.description}</p>}
      </header>

      {error && <p role="alert" className="rounded-xl border border-rejected-bg bg-rejected-bg/50 p-4 text-sm text-rejected-text">{error}</p>}
      {notice && <p role="status" className="rounded-xl border border-approved-bg bg-approved-bg/50 p-4 text-sm text-approved-text">{notice}</p>}

      <section className="rounded-2xl border border-warm-border bg-card p-6">
        <h2 className="font-serif text-xl text-warm-text">Current attachments</h2>
        {attachments.length === 0 ? <p className="mt-3 text-sm text-muted-text">No attachment metadata is linked to this submission.</p> : (
          <ul className="mt-4 divide-y divide-warm-border">
            {attachments.map((attachment) => (
              <li key={attachment.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <span className="text-sm text-warm-text">{attachment.original_filename}</span>
                <button type="button" onClick={() => void downloadAttachment(attachment)} className="rounded-full border border-warm-border px-4 py-2 text-xs font-semibold text-warm-text">
                  Download private file
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-2xl border border-warm-border bg-card p-6">
        <h2 className="font-serif text-xl text-warm-text">Office assignments and responses</h2>
        {activeAssignments.length === 0 ? <p className="mt-3 text-sm text-muted-text">No office assignments have been made.</p> : (
          <ul className="mt-4 space-y-4">
            {activeAssignments.map((assignment) => {
              const assignmentResponsibilities = responsibilities.filter((responsibility) => responsibility.assignment_id === assignment.id);
              return (
                <li key={assignment.id} className="rounded-xl border border-warm-border p-4">
                  <h3 className="font-semibold text-warm-text">{getOfficeName(assignment.office_id)}</h3>
                  {assignment.instructions && <p className="mt-1 text-sm text-muted-text">{assignment.instructions}</p>}
                  {assignmentResponsibilities.map((responsibility) => {
                    const { revision } = getResponsibility(responsibility.id);
                    const matchingCycles = cycles.filter((cycle) => cycle.responsibility_id === responsibility.id);
                    return (
                      <div key={responsibility.id} className="mt-3 border-l-2 border-clay pl-3">
                        <p className="text-sm font-medium text-warm-text">
                          {revision ? RESPONSIBILITY_LABELS[revision.responsibility_type as ResponsibilityType] ?? revision.responsibility_type : responsibility.responsibility_key}
                        </p>
                        {revision?.scope && <p className="mt-1 text-xs text-muted-text">Scope: {revision.scope}</p>}
                        {matchingCycles.map((cycle) => responses.filter((response) => response.review_cycle_id === cycle.id).map((response) => {
                          const existingReview = officerReviews.find((review) => review.review_response_id === response.id);
                          return (
                            <div key={response.id} className="mt-3 rounded-lg bg-sidebar p-3">
                              <p className="text-xs font-semibold text-warm-text">Office outcome: {response.outcome}</p>
                              {response.findings && <p className="mt-1 whitespace-pre-wrap text-xs text-muted-text">{response.findings}</p>}
                              {response.remarks && <p className="mt-1 whitespace-pre-wrap text-xs text-muted-text">Remarks: {response.remarks}</p>}
                              {existingReview ? (
                                <p className="mt-2 text-xs text-approved-text">Tourism Officer reviewed: {existingReview.disposition}</p>
                              ) : (
                                <button type="button" disabled={saving} onClick={() => void reviewResponse(response.id)} className="mt-3 rounded-full bg-clay px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">
                                  Record officer review
                                </button>
                              )}
                            </div>
                          );
                        }))}
                        {matchingCycles.length === 0 && <p className="mt-2 text-xs text-muted-text">No review cycle is available.</p>}
                      </div>
                    );
                  })}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {(submission.state === 'initial_review' || submission.state === 'office_review') && officeRoutingAvailable && (
        <section className="rounded-2xl border border-warm-border bg-card p-6">
          <h2 className="font-serif text-xl text-warm-text">Manually assign municipal offices</h2>
          <p className="mt-2 text-sm text-muted-text">Choose each office and responsibility. Routing is never selected automatically. An approved office authority mapping is required by the database.</p>
          <div className="mt-4 grid gap-4">
            <label className="grid gap-2 text-sm font-medium text-warm-text">
              Offices
              <select multiple value={selectedOfficeIds} onChange={(event) => setSelectedOfficeIds(Array.from(event.target.selectedOptions, (option) => option.value))} className="min-h-28 rounded-xl border border-warm-border bg-white p-3">
                {offices.map((office) => <option key={office.id} value={office.id}>{office.name}</option>)}
              </select>
            </label>
            <label className="grid gap-2 text-sm font-medium text-warm-text">
              Responsibility type
              <select value={responsibilityType} onChange={(event) => setResponsibilityType(event.target.value as ResponsibilityType)} className="rounded-xl border border-warm-border bg-white p-3">
                {Object.entries(RESPONSIBILITY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label className="grid gap-2 text-sm font-medium text-warm-text">
              Responsibility scope
              <textarea value={scope} onChange={(event) => setScope(event.target.value)} rows={3} className="rounded-xl border border-warm-border bg-white p-3" />
            </label>
            <label className="grid gap-2 text-sm font-medium text-warm-text">
              Office instructions (optional)
              <textarea value={instructions} onChange={(event) => setInstructions(event.target.value)} rows={2} className="rounded-xl border border-warm-border bg-white p-3" />
            </label>
            <label className="grid gap-2 text-sm font-medium text-warm-text">
              Routing method
              <select value={routingMode} onChange={(event) => setRoutingMode(event.target.value as typeof routingMode)} className="rounded-xl border border-warm-border bg-white p-3">
                <option value="simultaneous">Simultaneous</option>
                <option value="one_at_a_time">One office at a time</option>
              </select>
            </label>
            <label className="grid gap-2 text-sm font-medium text-warm-text">
              Reason for routing
              <textarea value={routingReason} onChange={(event) => setRoutingReason(event.target.value)} rows={2} className="rounded-xl border border-warm-border bg-white p-3" />
            </label>
            <button type="button" disabled={saving} onClick={() => void createRoutingPlan()} className="rounded-full bg-clay px-5 py-3 text-sm font-semibold text-white disabled:opacity-50">
              {saving ? 'Saving...' : 'Create office assignments'}
            </button>
          </div>
        </section>
      )}
      {offices.length === 0 && (submission.state === 'initial_review' || submission.state === 'office_review') && (
        <p className="rounded-xl border border-pending-bg bg-pending-bg/40 p-4 text-sm text-pending-text">
          Office routing is unavailable until an administrator provisions approved offices and responsibility authorities.
        </p>
      )}

      {(submission.state === 'initial_review' || submission.state === 'office_review') && (
        <section className="rounded-2xl border border-warm-border bg-card p-6">
          <h2 className="font-serif text-xl text-warm-text">Tourism Officer decision</h2>
          <p className="mt-2 text-sm text-muted-text">Final approval is enforced by the database and requires all active office responsibilities and response reviews to be satisfied.</p>
          <div className="mt-4 grid gap-4">
            <label className="grid gap-2 text-sm font-medium text-warm-text">
              Decision
              <select value={decision} onChange={(event) => setDecision(event.target.value as Decision)} className="rounded-xl border border-warm-border bg-white p-3">
                <option value="approved">Approve overall submission</option>
                <option value="returned">Return to submitter for changes</option>
                <option value="rejected">Reject overall submission</option>
              </select>
            </label>
            {decision !== 'approved' && (
              <label className="grid gap-2 text-sm font-medium text-warm-text">
                Decision reason
                <textarea value={decisionReason} onChange={(event) => setDecisionReason(event.target.value)} rows={3} className="rounded-xl border border-warm-border bg-white p-3" />
              </label>
            )}
            {decision === 'returned' && (
              <label className="grid gap-2 text-sm font-medium text-warm-text">
                Correction instructions
                <textarea value={correctionInstructions} onChange={(event) => setCorrectionInstructions(event.target.value)} rows={3} className="rounded-xl border border-warm-border bg-white p-3" />
              </label>
            )}
            <button type="button" disabled={saving} onClick={() => void recordDecision()} className="rounded-full bg-clay px-5 py-3 text-sm font-semibold text-white disabled:opacity-50">
              {saving ? 'Recording decision...' : 'Record Tourism Officer decision'}
            </button>
          </div>
        </section>
      )}
      <DocumentMessaging
        key={submission.id}
        submissionId={submission.id}
        fileName={submission.title}
        trackingNumber={submission.tracking_number}
        activity={null}
      />
    </section>
  );
}

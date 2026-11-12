'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import DocumentMessaging from '@/components/DocumentMessaging';
import WorkflowActivityTimeline from '@/components/WorkflowActivityTimeline';
import FilePreview, { downloadFile, getFileUrl, type PreviewableFile } from '@/components/FilePreview';
import CloseSubmissionDialog from '@/components/CloseSubmissionDialog';
import {
  getWorkflowDocumentTypeLabel,
  isOfficeRole,
  OFFICE_CONFIG,
  type OfficeRole,
} from '@/lib/workflow/offices';

// ─── Styles & Fonts (synced with the approver and user file pages) ───────────
const fonts = {
  serif: 'font-serif',
  mono: 'font-sans text-xs',
};

const fieldClasses =
  'h-11 w-full rounded-full border border-warm-border bg-card px-4 text-xs text-warm-text outline-none transition-colors focus:border-clay';

interface Submission extends PreviewableFile {
  id: string;
  user_id: string;
  tracking_number?: string | null;
  file_name: string;
  file_url: string;
  file_path?: string | null;
  file_type: string;
  file_size: number;
  status: string;
  category?: string | null;
  other_document_type?: string | null;
  description?: string | null;
  purpose?: string | null;
  requested_action?: string | null;
  intended_recipient?: string | null;
  selected_office_role?: string | null;
  approver_comments?: string | null;
  office_comments?: string | null;
  admin_comments?: string | null;
  mayor_comments?: string | null;
  sender_response?: string | null;
  archived_at?: string | null;
  retention_until?: string | null;
  created_at: string;
  updated_at: string;
}

interface SupportingAttachment {
  id: string;
  file_name: string;
  file_path: string;
  file_type: string | null;
  file_size: number;
}

interface RouteStep {
  sequence_number: number;
  office_role: OfficeRole;
  status: string;
  started_at: string | null;
  decided_at: string | null;
  completed_at: string | null;
}

interface SenderProfile {
  email: string | null;
  full_name: string | null;
  role: string | null;
}

interface AuditLog {
  id: string;
  action_type: string;
  created_at: string;
  comments: string | null;
  profiles: SenderProfile | null;
}

// ─── Status helpers ──────────────────────────────────────────────────────────
const getStatusStyles = (status: string) => {
  const s = (status || '').toLowerCase();
  if (s === 'pending' || s === 'pending_approver') return { label: 'Under verification', classes: 'bg-pending-bg text-pending-text' };
  if (s === 'pending_admin') return { label: 'Pending administrative processing', classes: 'bg-review-bg text-review-text' };
  if (s === 'pending_office') return { label: 'Pending municipal office', classes: 'bg-review-bg text-review-text' };
  if (s === 'pending_mayor') return { label: "Pending Mayor's office processing", classes: 'bg-review-bg text-review-text' };
  if (s === 'returned_for_requirements') return { label: 'Returned for requirements', classes: 'bg-pending-bg text-pending-text' };
  if (s === 'approved') return { label: 'Approved', classes: 'bg-approved-bg text-approved-text' };
  if (s === 'completed') return { label: 'Completed', classes: 'bg-approved-bg text-approved-text' };
  if (s.includes('declined') || s === 'rejected') return { label: 'Declined', classes: 'bg-rejected-bg text-rejected-text' };
  return { label: s.replaceAll('_', ' ') || 'Unknown', classes: 'bg-sidebar text-muted-text' };
};

const getActionLabel = (type: string) => {
  switch (type) {
    case 'STAGE_1_AUTHORIZED': return 'Approved by';
    case 'STAGE_1_REJECTED': return 'Stage 1 rejected';
    case 'FINAL_AUTHORIZATION': return 'Final approval';
    case 'FINAL_REJECTION': return 'Rejected by';
    case 'VERIFICATION_PASSED': return 'Verification passed';
    case 'RETURNED_FOR_CORRECTION': return 'Returned for correction';
    case 'OFFICE_ROUTE_STEP_ASSIGNED': return 'Office route step assigned';
    case 'OFFICE_ROUTE_STEP_APPROVED': return 'Office route step approved';
    case 'OFFICE_ASSIGNMENT_FORWARDED': return 'Office forwarded submission for Recommendation';
    case 'OFFICE_FORWARDED_TO_TOURISM_OFFICER': return 'Municipal office forwarded for Tourism Officer review';
    case 'TOURISM_OFFICER_ASSIGNMENTS_CREATED': return 'Tourism Officer assigned additional offices';
    case 'TOURISM_OFFICER_ASSIGNMENTS_COMPLETED': return 'Additional office assignments completed';
    case 'OFFICE_FINAL_DECISION': return 'Final decision by authorized office';
    case 'REQUIREMENTS_RESUBMITTED': return 'Submitter responded to requested changes';
    case 'REVISED_DOCUMENT_SUBMITTED': return 'Submitter uploaded a revised document';
    case 'ROUTE_PROPOSED': return 'Tourism Officer proposed office route';
    case 'ROUTE_REQUIREMENTS_REQUESTED': return 'Mayor requested additional requirements';
    case 'ROUTE_RETURNED_TO_ADMIN': return 'All routed offices approved; returned to Admin';
    case 'WORKFLOW_COMPLETED': return 'Workflow completed';
    case 'SUBMITTED': return 'Submission submitted';
    default: return 'Action by';
  }
};

export default function AdminManagePage() {
  const { id } = useParams();
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [sub, setSub] = useState<Submission | null>(null);
  const [sender, setSender] = useState<SenderProfile | null>(null);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [attachments, setAttachments] = useState<SupportingAttachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [actionError, setActionError] = useState('');
  const [adminComment, setAdminComment] = useState('');
  const [selectedOffice, setSelectedOffice] = useState('');
  const [selectedOffices, setSelectedOffices] = useState<OfficeRole[]>([]);
  const [routeSteps, setRouteSteps] = useState<RouteStep[]>([]);
  const [hasProposedRoute, setHasProposedRoute] = useState(false);
  const [routeReadyForCompletion, setRouteReadyForCompletion] = useState(false);
  const [routeLoadFailed, setRouteLoadFailed] = useState(false);
  const [archiveUpdating, setArchiveUpdating] = useState(false);
  const [retentionDate, setRetentionDate] = useState('');
  const [closeDialogOpen, setCloseDialogOpen] = useState(false);

  const toggleRouteOffice = (officeRole: OfficeRole) => {
    setSelectedOffices((current) => {
      if (current.includes(officeRole)) return current.filter((entry) => entry !== officeRole);
      if (officeRole === 'mayor_office') return [...current, officeRole];
      return current.includes('mayor_office')
        ? [...current.filter((entry) => entry !== 'mayor_office'), officeRole, 'mayor_office']
        : [...current, officeRole];
    });
  };

  const moveRouteOffice = (index: number, offset: -1 | 1) => {
    setSelectedOffices((current) => {
      const target = index + offset;
      if (
        target < 0
        || target >= current.length
        || current[index] === 'mayor_office'
        || current[target] === 'mayor_office'
      ) return current;
      const updated = [...current];
      [updated[index], updated[target]] = [updated[target], updated[index]];
      return updated;
    });
  };

  const fetchDetails = useCallback(async () => {
    try {
      const { data: submission } = await supabase
        .from('workflow_submissions')
        .select('*')
        .eq('id', id)
        .single();

      if (submission) {
        setSub(submission);
        setAdminComment(submission.admin_comments || '');
        setSelectedOffice(submission.selected_office_role || '');
        setRetentionDate(submission.retention_until?.slice(0, 10) || '');

        const { data: currentRoute, error: routeError } = await supabase
          .from('workflow_routing_plans')
          .select('id, status')
          .eq('submission_id', submission.id)
          .eq('is_current', true)
          .maybeSingle();
        if (routeError) {
          console.error('Could not load workflow route:', routeError.message);
          setActionError('Could not load this request’s office route. Refresh and try again.');
          setRouteLoadFailed(true);
          setRouteSteps([]);
          setHasProposedRoute(false);
          setRouteReadyForCompletion(false);
          setSelectedOffices(isOfficeRole(submission.selected_office_role)
            ? [submission.selected_office_role]
            : []);
        } else if (currentRoute) {
          const { data: steps, error: stepsError } = await supabase
            .from('workflow_routing_steps')
            .select('sequence_number, office_role, status, started_at, decided_at, completed_at')
            .eq('routing_plan_id', currentRoute.id)
            .order('sequence_number', { ascending: true });
          if (stepsError) {
            console.error('Could not load workflow route steps:', stepsError.message);
            setActionError('Could not load this request’s office route. Refresh and try again.');
            setRouteLoadFailed(true);
            setRouteSteps([]);
            setHasProposedRoute(false);
            setRouteReadyForCompletion(false);
            setSelectedOffices(isOfficeRole(submission.selected_office_role)
              ? [submission.selected_office_role]
              : []);
          } else {
            setRouteLoadFailed(false);
            const validSteps = (steps ?? []).filter(
              (step): step is RouteStep => isOfficeRole(step.office_role)
            );
            setRouteSteps(validSteps);
            setSelectedOffices(validSteps.map((step) => step.office_role));
            setHasProposedRoute(currentRoute.status === 'proposed');
            setRouteReadyForCompletion(
              currentRoute.status === 'finalized'
              && validSteps.length > 0
              && validSteps.every((step) => step.status === 'completed' || step.status === 'approved')
            );
          }
        } else {
          setRouteLoadFailed(false);
          setRouteSteps([]);
          setHasProposedRoute(false);
          setRouteReadyForCompletion(false);
          setSelectedOffices(isOfficeRole(submission.selected_office_role)
            ? [submission.selected_office_role]
            : []);
        }

        const { data: profile } = await supabase
          .from('profiles')
          .select('email, full_name, role')
          .eq('id', submission.user_id)
          .single();
        if (profile) setSender(profile);

        const { data: logs } = await supabase
          .from('workflow_audit_logs')
          .select('*, profiles:action_by (full_name, email, role)')
          .eq('submission_id', id)
          .order('created_at', { ascending: false });
        if (logs) setAuditLogs(logs);

        const { data: supportingFiles, error: attachmentError } = await supabase
          .from('workflow_submission_attachments')
          .select('id, file_name, file_path, file_type, file_size')
          .eq('submission_id', id)
          .order('created_at', { ascending: true });
        if (attachmentError) console.error('Could not load supporting attachments:', attachmentError.message);
        setAttachments(supportingFiles ?? []);
      }
    } catch (err) {
      console.error('Failed to load submission:', err);
    } finally {
      setLoading(false);
    }
  }, [id, supabase]);

  useEffect(() => { fetchDetails(); }, [fetchDetails]);

  const handleAdminRoute = async () => {
    if (!sub || sub.status !== 'pending_admin') return;
    if (routeLoadFailed) {
      setActionError('Could not verify the current route. Refresh before finalizing offices.');
      return;
    }
    if (selectedOffices.length === 0) {
      setActionError('Keep at least one municipal office in the finalized route.');
      return;
    }

    setUpdating(true);
    setActionError('');

    if (hasProposedRoute) {
      const { error } = await supabase.rpc('finalize_workflow_route', {
        target_submission_id: sub.id,
        final_office_roles: selectedOffices,
        administrative_comments: adminComment.trim() || null,
      });
      if (error) {
        console.error('Administrative route finalization failed:', error.message);
        setActionError(error.message || 'Could not finalize the office route.');
      } else {
        await fetchDetails();
      }
      setUpdating(false);
      return;
    }

    const { error: updateError } = await supabase.rpc('decide_workflow_submission', {
      target_submission_id: sub.id,
      next_status: 'pending_office',
      decision_comments: adminComment.trim() || null,
      routed_office_role: selectedOffices[0] || selectedOffice,
    });

    if (updateError) {
      console.error('Administrative routing failed:', updateError.message);
      setActionError(updateError.message || 'Could not route this submission. Please try again.');
    } else {
      await fetchDetails();
    }
    setUpdating(false);
  };

  const closeSubmission = async () => {
    if (!sub) return;
    setUpdating(true);
    setActionError('');
    const { error } = await supabase.rpc('close_workflow_submission', {
      target_submission_id: sub.id,
    });
    if (error) {
      setActionError(error.message || 'Could not complete this submission.');
      setCloseDialogOpen(false);
    } else {
      setCloseDialogOpen(false);
      await fetchDetails();
    }
    setUpdating(false);
  };

  const handleArchive = async () => {
    if (!sub) return;
    setArchiveUpdating(true);
    const shouldArchive = !sub.archived_at;
    const { error } = await supabase.rpc('set_workflow_submission_archive', {
      target_submission_id: id,
      should_archive: shouldArchive,
      retention_date: shouldArchive && retentionDate ? new Date(`${retentionDate}T23:59:59.999Z`).toISOString() : null,
    });

    if (error) {
      console.error('Archive update failed:', error.message);
    } else {
      await fetchDetails();
    }
    setArchiveUpdating(false);
  };

  const downloadAttachment = async (attachment: SupportingAttachment) => {
    const { data, error } = await supabase.storage
      .from('workflow_uploads')
      .createSignedUrl(attachment.file_path, 300);
    if (error || !data?.signedUrl) {
      console.error('Could not authorize attachment download:', error?.message);
      setActionError('Could not open this supporting attachment. Please try again.');
      return;
    }
    await downloadFile(data.signedUrl, attachment.file_name);
  };

  if (loading) {
    return (
      <div className="w-full">
        <div className="flex items-center gap-3 rounded-2xl border border-warm-border bg-card px-5 py-8 text-xs text-muted-text">
          <span className="h-2 w-2 animate-pulse rounded-full bg-clay" /> Loading submission...
        </div>
      </div>
    );
  }

  if (!sub) {
    return (
      <div className="w-full">
        <div className="rounded-2xl border border-rejected-bg bg-rejected-bg/50 px-5 py-8 text-xs font-semibold text-rejected-text">
          Submission not found.
        </div>
      </div>
    );
  }

  const statusConfig = sub.status === 'pending_office' && sub.selected_office_role === 'mayor_office'
    ? { label: "Mayor's final route decision", classes: 'bg-review-bg text-review-text' }
    : getStatusStyles(sub.status);
  const isFinalized = sub.status === 'completed' || sub.status.includes('declined');
  const isApproved = sub.status === 'approved';
  const isPendingAdmin = sub.status === 'pending_admin' && !routeReadyForCompletion;
  const isRouteReadyForCompletion = sub.status === 'pending_admin' && routeReadyForCompletion;

  return (
    <div className="w-full">
      {/* Back */}
      <div className="no-print mb-5 max-md:mb-4">
        <button
          onClick={() => router.back()}
          className="inline-flex h-10 items-center gap-2 rounded-full border border-warm-border px-4 text-xs font-medium text-warm-text transition-colors hover:bg-sidebar max-md:h-11"
        >
          <span aria-hidden="true">←</span> Back to master logs
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12 max-md:gap-3">

        {/* DETAILS COLUMN */}
        <aside className="space-y-4 lg:col-span-5 max-md:space-y-3">

          {/* Header */}
          <section className="rounded-2xl border border-warm-border bg-card p-5 max-md:p-3.5">
            <p className="mb-3 flex items-center gap-2 text-[11px] font-medium text-muted-text max-md:mb-2">
              <span className="h-1.5 w-1.5 rounded-full bg-clay" /> Submission ID: {String(sub.id).split('-')[0]}
            </p>
            <h1 className={`${fonts.serif} mb-4 break-words text-[28px] leading-tight text-warm-text max-md:text-[24px]`}>{sub.file_name}</h1>
            <div className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[11px] font-medium ${statusConfig.classes}`}>
              <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
              {statusConfig.label}
            </div>
            <div className="mt-4 border-t border-warm-border pt-4">
              <p className="text-[10px] font-medium text-muted-text">Tracking number</p>
              <p className="mt-0.5 text-[11px] font-semibold text-warm-text">{sub.tracking_number || 'Pending assignment'}</p>
            </div>
          </section>

          {/* Printable receipt */}
          <section className="receipt-print border-2 border-black bg-white p-6">
            <p className={`${fonts.mono} mb-3 text-blue-600`}>Submission_Receipt</p>
            <div className="space-y-2 font-mono text-[11px]">
              <p><span className="text-gray-400">Tracking_Number:</span> {sub.tracking_number || 'Pending assignment'}</p>
              <p><span className="text-gray-400">Document:</span> {sub.file_name}</p>
              <p><span className="text-gray-400">Status:</span> {statusConfig.label}</p>
              <p><span className="text-gray-400">Submitted:</span> {new Date(sub.created_at).toLocaleString()}</p>
            </div>
          </section>

          {/* Context Card */}
          <section className="space-y-5 rounded-2xl border border-warm-border bg-card p-5 max-md:p-3.5">
            <div>
              <p className="mb-1 text-[11px] font-medium text-muted-text">Document type</p>
              <p className="inline-flex rounded-md bg-clay-soft px-2.5 py-1 text-xs font-semibold text-clay">
                {getWorkflowDocumentTypeLabel(sub.category ?? null, sub.other_document_type)}
              </p>
            </div>
            <div>
              <p className="mb-1 text-[11px] font-medium text-muted-text">Municipal office route</p>
              {routeSteps.length > 0 ? (
                <ol className="space-y-2 text-xs text-warm-text">
                  {routeSteps.map((step) => (
                    <li key={`${step.sequence_number}-${step.office_role}`} className="flex items-center justify-between gap-3">
                      <span>{step.sequence_number}. {OFFICE_CONFIG[step.office_role].label}</span>
                      <span className="text-[10px] capitalize text-muted-text">{step.status.replaceAll('_', ' ')}</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-xs font-semibold text-warm-text">
                  {sub.selected_office_role
                    ? OFFICE_CONFIG[sub.selected_office_role as keyof typeof OFFICE_CONFIG]?.label || sub.selected_office_role
                    : 'Not selected'}
                </p>
              )}
            </div>
            {sub.intended_recipient && (
              <div>
                <p className="mb-1 text-[11px] font-medium text-muted-text">Intended recipient</p>
                <p className="text-xs text-warm-text">{sub.intended_recipient}</p>
              </div>
            )}
            {sub.purpose && (
              <div>
                <p className="mb-1 text-[11px] font-medium text-muted-text">Purpose</p>
                <p className="whitespace-pre-wrap text-xs leading-relaxed text-warm-text">{sub.purpose}</p>
              </div>
            )}
            {sub.requested_action && (
              <div>
                <p className="mb-1 text-[11px] font-medium text-muted-text">Requested action</p>
                <p className="whitespace-pre-wrap text-xs leading-relaxed text-warm-text">{sub.requested_action}</p>
              </div>
            )}
            <div>
              <p className="mb-1.5 text-[11px] font-medium text-muted-text">Sender notes</p>
              <p className="whitespace-pre-wrap break-words border-l-2 border-warm-border pl-4 font-serif text-base leading-relaxed text-warm-text">
                &quot;{sub.description || 'No description provided.'}&quot;
              </p>
            </div>
            <div className="border-t border-warm-border pt-4">
              <p className="text-[10px] font-medium text-muted-text">Submitted by</p>
              <p className="mt-0.5 text-[11px] font-semibold text-warm-text">{sender?.full_name || 'Unknown'}</p>
              <p className="text-[11px] text-muted-text">{sender?.email}</p>
            </div>
            <div className="flex items-end justify-between gap-4 border-t border-warm-border pt-4">
              <div>
                <p className="text-[10px] font-medium text-muted-text">Submitted on</p>
                <p className="mt-0.5 text-[11px] font-semibold text-warm-text">{new Date(sub.created_at).toLocaleDateString()} at {new Date(sub.created_at).toLocaleTimeString()}</p>
              </div>
              {sub.file_size ? (
                <div className="text-right">
                  <p className="text-[10px] font-medium text-muted-text">File size</p>
                  <p className="mt-0.5 text-[11px] font-semibold text-warm-text">{(sub.file_size / 1024).toFixed(2)} KB</p>
                </div>
              ) : null}
            </div>
          </section>

          {attachments.length > 0 && (
            <section className="no-print rounded-2xl border border-warm-border bg-card p-5 max-md:p-3.5">
              <h2 className="mb-3 text-xs font-semibold text-warm-text">Supporting attachments</h2>
              <ul className="space-y-2">
                {attachments.map((attachment) => (
                  <li key={attachment.id} className="flex items-center justify-between gap-3 text-[11px]">
                    <span className="min-w-0 truncate text-warm-text">{attachment.file_name}</span>
                    <button
                      type="button"
                      onClick={() => void downloadAttachment(attachment)}
                      className="shrink-0 font-semibold text-clay underline"
                    >
                      Download
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Approver notes (read-only context) */}
          {sub.approver_comments && (
            <section className="no-print rounded-2xl border border-warm-border bg-card p-5 max-md:p-3.5">
              <p className="mb-2 text-xs font-semibold text-warm-text">Approver notes</p>
              <p className="whitespace-pre-wrap break-words border-l-2 border-warm-border pl-4 font-serif text-base leading-relaxed text-warm-text">
                &quot;{sub.approver_comments}&quot;
              </p>
            </section>
          )}

          {sub.office_comments && (
            <section className="no-print rounded-2xl border border-warm-border bg-card p-5 max-md:p-3.5">
              <p className="mb-2 text-xs font-semibold text-warm-text">Municipal office evaluation</p>
              <p className="whitespace-pre-wrap break-words border-l-2 border-warm-border pl-4 font-serif text-base leading-relaxed text-warm-text">
                &quot;{sub.office_comments}&quot;
              </p>
            </section>
          )}

          {sub.mayor_comments && (
            <section className="no-print rounded-2xl border border-warm-border bg-card p-5 max-md:p-3.5">
              <p className="mb-2 text-xs font-semibold text-warm-text">Mayor’s processing notes / requirements</p>
              <p className="whitespace-pre-wrap break-words border-l-2 border-warm-border pl-4 font-serif text-base leading-relaxed text-warm-text">
                &quot;{sub.mayor_comments}&quot;
              </p>
            </section>
          )}

          {/* Administrative verification and routing */}
          {isPendingAdmin && (
            <section className="no-print rounded-2xl border border-warm-border bg-card p-5 max-md:p-3.5">
              {hasProposedRoute ? (
              <fieldset className="mb-4 space-y-3">
                <legend className="mb-2 text-xs font-semibold text-warm-text">
                  Review and finalize the ordered office route
                </legend>
                <div className="space-y-2">
                  {Object.entries(OFFICE_CONFIG).map(([officeRole, office]) => (
                    <label key={officeRole} className="flex items-start gap-3 rounded-xl border border-warm-border bg-card p-3 text-xs text-warm-text">
                      <input
                        type="checkbox"
                        checked={selectedOffices.includes(officeRole as OfficeRole)}
                        onChange={() => toggleRouteOffice(officeRole as OfficeRole)}
                        className="mt-0.5 accent-clay"
                      />
                      <span>{office.label}</span>
                    </label>
                  ))}
                </div>
                {selectedOffices.length > 0 && (
                  <ol className="space-y-2 rounded-xl bg-sidebar p-3 text-xs text-warm-text">
                    {selectedOffices.map((officeRole, index) => (
                      <li key={officeRole} className="flex items-center justify-between gap-3">
                        <span>{index + 1}. {OFFICE_CONFIG[officeRole].label}</span>
                        <span className="flex gap-2">
                          <button type="button" onClick={() => moveRouteOffice(index, -1)} disabled={index === 0 || officeRole === 'mayor_office'} aria-label={`Move ${OFFICE_CONFIG[officeRole].label} up`} className="disabled:opacity-40">↑</button>
                          <button type="button" onClick={() => moveRouteOffice(index, 1)} disabled={index === selectedOffices.length - 1 || officeRole === 'mayor_office' || selectedOffices[index + 1] === 'mayor_office'} aria-label={`Move ${OFFICE_CONFIG[officeRole].label} down`} className="disabled:opacity-40">↓</button>
                        </span>
                      </li>
                    ))}
                  </ol>
                )}
                <p className="text-[11px] text-muted-text">
                  The Mayor’s Office is optional and, if selected, must be the final route step.
                </p>
              </fieldset>
              ) : (
                <label htmlFor="admin-office" className="mb-4 block text-xs font-semibold text-warm-text">
                  Municipal office for this existing single-office request
                  <select
                    id="admin-office"
                    value={selectedOffice}
                    onChange={(event) => {
                      setSelectedOffice(event.target.value);
                      setSelectedOffices(isOfficeRole(event.target.value) ? [event.target.value] : []);
                    }}
                    className={`${fieldClasses} mt-2`}
                  >
                    <option value="">Select an office</option>
                    {Object.entries(OFFICE_CONFIG).map(([officeRole, office]) => (
                      <option key={officeRole} value={officeRole}>{office.label}</option>
                    ))}
                  </select>
                </label>
              )}
              <label htmlFor="admin-notes" className="mb-2 block text-xs font-semibold text-warm-text">
                Routing notes
              </label>
              <textarea
                id="admin-notes"
                value={adminComment}
                onChange={(e) => setAdminComment(e.target.value)}
                style={{ caretColor: 'currentColor' }}
                className="mb-4 h-32 w-full resize-none rounded-xl border border-warm-border bg-card p-4 text-sm text-warm-text outline-none transition-colors placeholder:text-muted-text/60 focus:border-clay"
                placeholder="Add notes for the receiving office..."
              />
              {actionError && (
                <p className="mb-3 rounded-xl border border-rejected-bg bg-rejected-bg/50 px-4 py-3 text-xs font-medium text-rejected-text">
                  {actionError}
                </p>
              )}
              <div className="flex gap-3 max-md:flex-col">
                <button
                  onClick={() => void handleAdminRoute()}
                  disabled={updating}
                  className="inline-flex h-11 flex-1 items-center justify-center rounded-full bg-clay px-6 text-xs font-semibold text-white transition-colors hover:bg-warm-text disabled:opacity-50"
                >
                  {updating ? 'Saving...' : hasProposedRoute ? 'Finalize office assignments' : 'Route to assigned office'}
                </button>
              </div>
            </section>
          )}

          {isRouteReadyForCompletion && (
            <section className="no-print space-y-4 rounded-2xl border border-approved-bg bg-approved-bg/50 p-5 max-md:p-3.5">
              <div>
                <p className="mb-1 text-xs font-semibold text-approved-text">All required office assignments completed</p>
                <p className="text-xs leading-relaxed text-muted-text">
                  Every required office assignment is complete. Close this legacy request to record that processing is finished.
                </p>
              </div>
              {actionError && (
                <p className="rounded-xl border border-rejected-bg bg-rejected-bg/50 px-4 py-3 text-xs font-medium text-rejected-text">
                  {actionError}
                </p>
              )}
              <button
                type="button"
                onClick={() => setCloseDialogOpen(true)}
                disabled={updating || routeLoadFailed}
                className="inline-flex h-12 w-full items-center justify-center rounded-full bg-clay px-6 text-sm font-semibold text-white transition-colors hover:bg-warm-text disabled:opacity-50"
              >
                Close Submission
              </button>
            </section>
          )}

          {isApproved && (
            <section className="no-print rounded-2xl border border-approved-bg bg-approved-bg/50 p-5 max-md:p-3.5">
              <p className="mb-1 text-xs font-semibold text-approved-text">Legacy approved request</p>
              <p className="mb-4 text-xs leading-relaxed text-muted-text">
                Record that processing of this legacy request has finished.
              </p>
              {actionError && (
                <p className="mb-3 rounded-xl border border-rejected-bg bg-rejected-bg/50 px-4 py-3 text-xs font-medium text-rejected-text">
                  {actionError}
                </p>
              )}
              <button
                type="button"
                onClick={() => setCloseDialogOpen(true)}
                disabled={updating || routeLoadFailed}
                className="inline-flex h-12 w-full items-center justify-center rounded-full bg-clay px-6 text-sm font-semibold text-white transition-colors hover:bg-warm-text disabled:opacity-50"
              >
                Close Submission
              </button>
            </section>
          )}

          {isFinalized && (
            <section className="no-print space-y-3 rounded-2xl border border-warm-border bg-card p-5 max-md:p-3.5">
              <p className="text-xs font-semibold text-warm-text">Final review</p>
              {sub.admin_comments ? (
                <div className={`rounded-xl border p-4 ${sub.status.includes('declined') ? 'border-rejected-bg bg-rejected-bg/50' : 'border-approved-bg bg-approved-bg/50'}`}>
                  <p className={`mb-2 text-xs font-semibold ${sub.status.includes('declined') ? 'text-rejected-text' : 'text-approved-text'}`}>Admin notes</p>
                  <p className="whitespace-pre-wrap break-words font-serif text-base leading-relaxed text-warm-text">
                    &quot;{sub.admin_comments}&quot;
                  </p>
                </div>
              ) : (
                <p className="text-xs text-muted-text">No admin notes were left on this review.</p>
              )}
              <button
                onClick={() => window.print()}
                className="inline-flex h-11 w-full items-center justify-center rounded-full border border-warm-border px-6 text-xs font-semibold text-warm-text transition-colors hover:bg-sidebar"
              >
                Print submission receipt
              </button>
            </section>
          )}

          {/* Secure Archive */}
          <section className="no-print rounded-2xl border border-warm-border bg-card p-5 max-md:p-3.5">
            <p className="mb-1 text-xs font-semibold text-warm-text">Secure archive</p>
            <p className="mb-4 text-xs leading-relaxed text-muted-text">
              {sub.archived_at
                ? `Archived ${new Date(sub.archived_at).toLocaleString()}`
                : 'This record is active and visible to authorized workflow users.'}
            </p>
            {!sub.archived_at && (
              <div className="mb-4">
                <label htmlFor="retention-date" className="mb-1.5 block text-[11px] font-medium text-muted-text">
                  Retention until
                </label>
                <input
                  id="retention-date"
                  type="date"
                  value={retentionDate}
                  onChange={(event) => setRetentionDate(event.target.value)}
                  className={fieldClasses}
                />
              </div>
            )}
            <button
              onClick={handleArchive}
              disabled={archiveUpdating}
              className="inline-flex h-11 w-full items-center justify-center rounded-full border border-warm-border px-6 text-xs font-semibold text-warm-text transition-colors hover:bg-sidebar disabled:opacity-50"
            >
              {archiveUpdating ? 'Updating archive...' : sub.archived_at ? 'Restore from archive' : 'Archive record'}
            </button>
          </section>

          {/* Timeline */}
          <DocumentMessaging
            key={sub.id}
            submissionId={sub.id}
            fileName={sub.file_name}
            trackingNumber={sub.tracking_number ?? null}
            activity={(
              <div className="no-print">
                <WorkflowActivityTimeline
                  events={auditLogs.map((log) => ({
                    id: log.id,
                    actionType: log.action_type,
                    label: getActionLabel(log.action_type),
                    createdAt: log.created_at,
                    actor: log.profiles?.full_name || 'System',
                    actorRole: log.profiles?.role,
                    comments: log.comments,
                  }))}
                />
              </div>
            )}
          />

          {/* Footer Actions */}
          <button
            onClick={async () => {
              const url = await getFileUrl(supabase, sub);
              await downloadFile(url, sub.file_name);
            }}
            className="no-print inline-flex h-11 w-full items-center justify-center gap-2 rounded-full border border-warm-border px-6 text-xs font-semibold text-warm-text transition-colors hover:bg-sidebar"
          >
            Download original file
          </button>
        </aside>

        {/* PREVIEW PANEL */}
        <main className="no-print lg:col-span-7">
          <div className="flex flex-col overflow-hidden rounded-2xl border border-warm-border bg-card lg:sticky lg:top-10">
            <div className="flex min-h-12 items-center border-b border-warm-border px-5 py-3 max-md:px-3.5">
              <div className="flex min-w-0 flex-col">
                <span className="mb-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-text">Document preview</span>
                <span className="truncate text-[11px] font-medium text-warm-text">{sub.file_name}</span>
              </div>
            </div>

            <div className="relative flex h-[60vh] min-h-[380px] items-center justify-center overflow-hidden bg-cream lg:h-[75vh]">
              <FilePreview file={sub} />
            </div>
          </div>
        </main>
      </div>

      <style jsx global>{`
        @media print {
          body * { visibility: hidden; }
          .receipt-print, .receipt-print * { visibility: visible; }
          .receipt-print { position: absolute; inset: 0; margin: 0; box-shadow: none; }
          .no-print { display: none !important; }
        }
      `}</style>
      <CloseSubmissionDialog
        open={closeDialogOpen}
        pendingAssignmentCount={routeSteps.filter(
          (step) => step.status === 'pending' || step.status === 'in_progress'
        ).length}
        updating={updating}
        onCancel={() => setCloseDialogOpen(false)}
        onConfirm={() => void closeSubmission()}
      />
    </div>
  );
}
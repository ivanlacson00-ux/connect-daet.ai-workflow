'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import DocumentMessaging from '@/components/DocumentMessaging';
import FilePreview, { downloadFile, getFileUrl, type PreviewableFile } from '@/components/FilePreview';
import {
  getRoleHomePath,
  getWorkflowDocumentTypeLabel,
  isOfficeRole,
  OFFICE_CONFIG,
  OFFICE_RESPONSIBILITIES,
  TOURISM_OFFICE_LABEL,
  TOURISM_OFFICE_ROLE,
  type OfficeResponsibility,
  type OfficeRole,
  type OfficeRoutingMode,
} from '@/lib/workflow/offices';

// ─── Styles & Fonts (synced with the user file page) ─────────────────────────
const fonts = {
  serif: 'font-serif',
};

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
  initial_destination_role?: string | null;
  final_decision_office_role?: string | null;
  approver_comments?: string | null;
  office_comments?: string | null;
  admin_comments?: string | null;
  mayor_comments?: string | null;
  sender_response?: string | null;
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
  responsibility: OfficeResponsibility;
  assignment_source: string;
  started_at: string | null;
  decided_at: string | null;
  requirements_requested_at: string | null;
  requirements_comments: string | null;
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

// ─── Status groups ───────────────────────────────────────────────────────────
// Approving a file passes it to the admin, so 'pending_admin' reads as approved here
const QUEUE_STATUSES = ['pending', 'pending_approver'];
const DECLINED_STATUSES = [
  'declined_by_approver',
  'declined_by_admin',
  'declined_by_office',
  'declined_by_mayor',
  'rejected',
];

const getStatusStyles = (status: string) => {
  const s = (status || '').toLowerCase();
  if (QUEUE_STATUSES.includes(s)) return { label: 'Awaiting approver review', classes: 'bg-pending-bg text-pending-text' };
  if (s === 'pending_admin') return { label: 'Administrative review', classes: 'bg-review-bg text-review-text' };
  if (s === 'pending_office') return { label: 'Municipal office review', classes: 'bg-review-bg text-review-text' };
  if (s === 'pending_mayor') return { label: "Mayor's final review", classes: 'bg-review-bg text-review-text' };
  if (s === 'returned_for_requirements') return { label: 'Additional requirements requested', classes: 'bg-pending-bg text-pending-text' };
  if (s === 'completed' || s === 'approved') return { label: 'Approved and completed', classes: 'bg-approved-bg text-approved-text' };
  if (DECLINED_STATUSES.includes(s)) return { label: 'Rejected', classes: 'bg-rejected-bg text-rejected-text' };
  return { label: s.replaceAll('_', ' ') || 'Unknown', classes: 'bg-sidebar text-muted-text' };
};

const getActionLabel = (type: string) => {
  switch (type) {
    case 'STAGE_1_AUTHORIZED': return 'Stage 1 approved';
    case 'STAGE_1_REJECTED': return 'Stage 1 rejected';
    case 'FINAL_AUTHORIZATION': return 'Final approval';
    case 'FINAL_REJECTION': return 'Final rejection';
    case 'VERIFICATION_PASSED': return 'Verification passed';
    case 'RETURNED_FOR_CORRECTION': return 'Returned for correction';
    case 'OFFICE_ROUTE_STEP_ASSIGNED': return 'Office route step assigned';
    case 'OFFICE_ROUTE_STEP_APPROVED': return 'Office route step approved';
    case 'OFFICE_FORWARDED_TO_TOURISM_OFFICER': return 'Municipal office forwarded for Tourism Officer review';
    case 'TOURISM_OFFICER_ASSIGNMENTS_CREATED': return 'Tourism Officer assigned additional offices';
    case 'TOURISM_OFFICER_ASSIGNMENTS_COMPLETED': return 'Additional office assignments completed';
    case 'OFFICE_FINAL_DECISION': return 'Final decision by authorized office';
    case 'ROUTE_PROPOSED': return 'Tourism Officer proposed office route';
    case 'REVISED_DOCUMENT_SUBMITTED': return 'Submitter uploaded a revised document';
    case 'REQUIREMENTS_RESUBMITTED': return 'Submitter responded to requested changes';
    case 'ROUTE_REQUIREMENTS_REQUESTED': return 'Municipal office requested additional requirements';
    case 'ROUTE_RETURNED_TO_ADMIN': return 'All routed offices approved; returned to Admin';
    case 'APPROVER_REJECTED': return 'Approver rejected request';
    case 'ADMIN_REJECTED': return 'Administrator rejected request';
    case 'OFFICE_REJECTED': return 'Municipal office rejected request';
    case 'MAYOR_REJECTED': return 'Mayor rejected request';
    case 'WORKFLOW_COMPLETED': return 'Workflow completed';
    case 'SUBMITTED': return 'Submitted by';
    default: return 'Action by';
  }
};

export default function ApproverManagePage() {
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
  const [comment, setComment] = useState('');
  const [proposedOffices, setProposedOffices] = useState<OfficeRole[]>([]);
  const [officeResponsibilities, setOfficeResponsibilities] = useState<
    Partial<Record<OfficeRole, OfficeResponsibility>>
  >({});
  const [routingMode, setRoutingMode] = useState<OfficeRoutingMode>('sequential');
  const [finalDecisionOfficeRole, setFinalDecisionOfficeRole] = useState<OfficeRole | ''>('');
  const [routeSteps, setRouteSteps] = useState<RouteStep[]>([]);
  const [routeStatus, setRouteStatus] = useState<string | null>(null);
  const [hasFinalizedRoute, setHasFinalizedRoute] = useState(false);
  const [routeStateError, setRouteStateError] = useState(false);
  const [role, setRole] = useState<string | null>(null);

  const toggleProposedOffice = (officeRole: OfficeRole) => {
    setProposedOffices((current) => {
      if (current.includes(officeRole)) {
        setOfficeResponsibilities((responsibilities) => {
          const next = { ...responsibilities };
          delete next[officeRole];
          return next;
        });
        return current.filter((entry) => entry !== officeRole);
      }
      setOfficeResponsibilities((responsibilities) => ({
        ...responsibilities,
        [officeRole]: 'mandatory_approval_clearance',
      }));
      return [...current, officeRole];
    });
  };

  const moveProposedOffice = (index: number, offset: -1 | 1) => {
    setProposedOffices((current) => {
      const target = index + offset;
      if (target < 0 || target >= current.length) return current;
      const updated = [...current];
      [updated[index], updated[target]] = [updated[target], updated[index]];
      return updated;
    });
  };

  const fetchDetails = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      let currentRole: string | null = null;
      if (user) {
        const { data: currentProfile } = await supabase
          .from('profiles')
          .select('role')
          .eq('id', user.id)
          .single();
        currentRole = currentProfile?.role ?? null;
        setRole(currentRole);
      }

      const { data: submission } = await supabase
        .from('workflow_submissions')
        .select('*')
        .eq('id', id)
        .single();

      if (submission) {
        setSub(submission);
        setFinalDecisionOfficeRole(
          isOfficeRole(submission.final_decision_office_role)
            ? submission.final_decision_office_role
            : ''
        );
        setComment(
          currentRole === 'mayor_office' && submission.status === 'pending_mayor'
            ? submission.mayor_comments || ''
            : currentRole === 'mayor_office'
              && submission.status === 'pending_office'
              && submission.selected_office_role === 'mayor_office'
              ? ''
            : isOfficeRole(currentRole) && submission.status === 'pending_office'
              ? submission.office_comments || ''
              : submission.approver_comments || ''
        );

        const { data: currentRoute, error: routeError } = await supabase
          .from('workflow_routing_plans')
          .select('id, status')
          .eq('submission_id', submission.id)
          .eq('is_current', true)
          .maybeSingle();
        if (routeError) {
          console.error('Could not load workflow route state:', routeError.message);
          setActionError('Could not load the routing state. Refresh and try again.');
          setRouteStateError(true);
          setRouteSteps([]);
          setRouteStatus(null);
        } else {
          if (currentRoute) {
            const { data: steps, error: stepsError } = await supabase
              .from('workflow_routing_steps')
              .select('sequence_number, office_role, status, responsibility, assignment_source, started_at, decided_at, requirements_requested_at, requirements_comments')
              .eq('routing_plan_id', currentRoute.id)
              .order('sequence_number', { ascending: true });

            if (stepsError) {
              console.error('Could not load workflow route steps:', stepsError.message);
              setActionError('Could not load the office route. Refresh and try again.');
              setRouteStateError(true);
              setRouteSteps([]);
              setRouteStatus(null);
            } else {
              const validSteps = (steps ?? []).filter(
                (step): step is RouteStep => isOfficeRole(step.office_role)
                  && step.responsibility in OFFICE_RESPONSIBILITIES
              );
              setRouteSteps(validSteps);
              setRouteStatus(currentRoute.status);
              setHasFinalizedRoute(currentRoute.status === 'finalized');
              setRouteStateError(false);
            }
          } else {
            setRouteSteps([]);
            setRouteStatus(null);
            setHasFinalizedRoute(false);
            setRouteStateError(false);
          }
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

  const handleWorkflowAction = async (
    decision: 'approve' | 'reject' | 'return' | 'forward'
  ) => {
    if (!sub) return;
    setUpdating(true);
    setActionError('');

    if (role === 'tourism_officer' && QUEUE_STATUSES.includes(sub.status) && decision === 'approve') {
      if (
        proposedOffices.length === 0
        && sub.initial_destination_role !== TOURISM_OFFICE_ROLE
      ) {
        setActionError('Select at least one additional municipal office.');
        setUpdating(false);
        return;
      }
      if (
        sub.initial_destination_role === TOURISM_OFFICE_ROLE
        && !finalDecisionOfficeRole
      ) {
        setActionError('Select the municipal office that will make the final decision.');
        setUpdating(false);
        return;
      }

      const { error } = sub.status === 'pending_approver'
        ? await supabase.rpc('create_tourism_officer_assignments', {
            target_submission_id: sub.id,
            assignment_records: proposedOffices.map((officeRole) => ({
              office_role: officeRole,
              responsibility: officeResponsibilities[officeRole] ?? 'mandatory_approval_clearance',
            })),
            routing_mode: routingMode,
            assignment_comments: comment.trim() || null,
            final_decision_office_role: finalDecisionOfficeRole || null,
          })
        : await supabase.rpc('propose_workflow_route', {
            target_submission_id: sub.id,
            proposed_office_roles: proposedOffices,
            proposal_comments: comment.trim() || null,
          });
      if (error) {
        setActionError(error.message || 'Could not create the office assignments.');
      } else {
        await fetchDetails();
      }
      setUpdating(false);
      return;
    }

    const activeOfficeRouteStep = isOfficeRole(role)
      ? routeSteps.find((step) => step.office_role === role && step.status === 'in_progress')
      : undefined;
    const officeIsAssigned = isOfficeRole(role)
      && sub.status === 'pending_office'
      && (role === sub.selected_office_role || Boolean(activeOfficeRouteStep));

    if (officeIsAssigned && isOfficeRole(role)) {
      if (decision === 'forward') {
        const { error } = await supabase.rpc('forward_workflow_submission_to_tourism_officer', {
          target_submission_id: sub.id,
          forwarding_comments: comment.trim() || null,
        });
        if (error) {
          setActionError(error.message || 'Could not forward the reviewed submission.');
        } else {
          await fetchDetails();
        }
        setUpdating(false);
        return;
      }

      if (decision === 'return') {
        if (!comment.trim()) {
          setActionError('Explain the changes required before returning this submission.');
          setUpdating(false);
          return;
        }
        const { error } = await supabase.rpc('request_workflow_submission_changes', {
          target_submission_id: sub.id,
          request_comments: comment.trim(),
        });
        if (error) {
          setActionError(error.message || 'Could not request changes.');
        } else {
          await fetchDetails();
        }
        setUpdating(false);
        return;
      }

      if (routeStateError) {
        setActionError('Could not verify the finalized route. Refresh and try again.');
        setUpdating(false);
        return;
      }
      if (activeOfficeRouteStep) {
        const { error } = await supabase.rpc('decide_workflow_route_step', {
          target_submission_id: sub.id,
          approve_step: decision === 'approve',
          decision_comments: comment.trim() || null,
        });
        if (error) {
          setActionError(error.message || 'Could not save the municipal office decision.');
        } else {
          await fetchDetails();
        }
        setUpdating(false);
        return;
      }

      if (decision === 'approve') {
        const { error } = await supabase.rpc('finalize_workflow_submission', {
          target_submission_id: sub.id,
          decision_comments: comment.trim() || null,
        });
        if (error) {
          setActionError(error.message || 'Could not record the final office decision.');
        } else {
          await fetchDetails();
        }
        setUpdating(false);
        return;
      }
    }

    const update: Record<string, string> = {
      updated_at: new Date().toISOString(),
    };

    if (role === 'tourism_officer' && QUEUE_STATUSES.includes(sub.status)) {
      if (decision === 'approve') {
        setUpdating(false);
        return;
      } else if (decision === 'reject') {
        if (!comment.trim()) {
          setActionError('Add a rejection reason before declining this document.');
          setUpdating(false);
          return;
        }
        update.status = 'declined_by_approver';
        update.approver_comments = comment;
      }
    } else if (
      isOfficeRole(role)
      && role === sub.selected_office_role
      && sub.status === 'pending_office'
    ) {
      update.office_comments = comment;
      update.status = decision === 'approve' ? 'pending_mayor' : 'declined_by_office';
      if (decision === 'reject' && !comment.trim()) {
        setActionError('Add a rejection reason before declining this document.');
        setUpdating(false);
        return;
      }
    } else if (role === 'mayor_office' && sub.status === 'pending_mayor') {
      update.mayor_comments = comment;
      if (decision === 'approve') update.status = 'completed';
      else if (decision === 'reject') update.status = 'declined_by_mayor';
      else update.status = 'returned_for_requirements';
      if (decision !== 'approve' && !comment.trim()) {
        setActionError('Add remarks before rejecting or requesting additional requirements.');
        setUpdating(false);
        return;
      }
    } else {
      setUpdating(false);
      return;
    }

    const decisionComments = role === 'mayor_office'
      ? update.mayor_comments
      : isOfficeRole(role) && sub.status === 'pending_office'
        ? update.office_comments
        : update.approver_comments;
    const { error: updateError } = await supabase.rpc('decide_workflow_submission', {
      target_submission_id: sub.id,
      next_status: update.status,
      decision_comments: decisionComments ?? null,
      routed_office_role: update.selected_office_role ?? null,
    });

    if (updateError) {
      const errorMessage = [
        updateError.message,
        updateError.details,
        updateError.hint,
        updateError.code ? `Database code: ${updateError.code}` : '',
      ].filter(Boolean).join('\n');
      setActionError(
        errorMessage
          || JSON.stringify(updateError)
          || 'The database rejected this decision without returning details. Refresh and try again.'
      );
    } else {
      await fetchDetails();
    }
    setUpdating(false);
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

  const finalDecisionOfficeRoleValue = sub.final_decision_office_role ?? null;
  const finalDecisionOfficeLabel = isOfficeRole(finalDecisionOfficeRoleValue)
    ? OFFICE_CONFIG[finalDecisionOfficeRoleValue].label
    : 'Not designated yet';
  const statusConfig = sub.status === 'pending_office' && sub.selected_office_role === 'mayor_office'
    ? { label: "Mayor's final route decision", classes: 'bg-review-bg text-review-text' }
    : getStatusStyles(sub.status);
  const activeRouteStep = isOfficeRole(role)
    ? routeSteps.find((step) => step.office_role === role && step.status === 'in_progress')
    : undefined;
  const officeReview =
    isOfficeRole(role)
    && sub.status === 'pending_office'
    && (role === sub.selected_office_role || Boolean(activeRouteStep));
  const mayorRouteStep = role === 'mayor_office' && officeReview && Boolean(activeRouteStep);
  const mayorReview = role === 'mayor_office' && sub.status === 'pending_mayor';
  const approverReview = role === 'tourism_officer' && QUEUE_STATUSES.includes(sub.status);
  const canAct = officeReview || mayorReview || approverReview;
  const isLocked = !canAct;
  const isDeclined = DECLINED_STATUSES.includes(sub.status.toLowerCase());
  const reviewNotes = mayorReview
    ? sub.mayor_comments
    : officeReview
      ? sub.office_comments
      : sub.approver_comments;

  return (
    <div className="w-full">
      {/* Back */}
      <div className="mb-5 max-md:mb-4">
        <button
          onClick={() => {
            if (officeReview) router.push(getRoleHomePath(role));
            else router.back();
          }}
          className="inline-flex h-10 items-center gap-2 rounded-full border border-warm-border px-4 text-xs font-medium text-warm-text transition-colors hover:bg-sidebar max-md:h-11"
        >
          <span aria-hidden="true">←</span> Back to queue
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

          {/* Context Card */}
          <section className="space-y-5 rounded-2xl border border-warm-border bg-card p-5 max-md:p-3.5">
            <div>
              <p className="mb-1 text-[11px] font-medium text-muted-text">Document type</p>
              <p className="inline-flex rounded-md bg-clay-soft px-2.5 py-1 text-xs font-semibold text-clay">
                {getWorkflowDocumentTypeLabel(sub.category ?? null, sub.other_document_type)}
              </p>
            </div>
            <div>
              <p className="mb-1 text-[11px] font-medium text-muted-text">
                {routeSteps.length > 0 || proposedOffices.length > 0
                  ? 'Additional office assignments'
                  : 'Submitter-selected destination'}
              </p>
              {routeSteps.length > 0 ? (
                <ol className="space-y-1.5 text-xs font-semibold text-warm-text">
                  {routeSteps.map((step) => (
                    <li key={`${step.sequence_number}-${step.office_role}`} className="flex items-center justify-between gap-3">
                      <span>
                        {step.sequence_number}. {OFFICE_CONFIG[step.office_role].label}
                        <span className="ml-2 font-normal text-muted-text">
                          {OFFICE_RESPONSIBILITIES[step.responsibility]}
                        </span>
                      </span>
                      <span className="text-[10px] font-normal capitalize text-muted-text">
                        {step.status.replaceAll('_', ' ')}
                      </span>
                    </li>
                  ))}
                </ol>
              ) : proposedOffices.length > 0 ? (
                <ol className="space-y-1.5 text-xs font-semibold text-warm-text">
                  {proposedOffices.map((officeRole, index) => (
                    <li key={officeRole}>{index + 1}. {OFFICE_CONFIG[officeRole].label}</li>
                  ))}
                </ol>
              ) : (
                <p className="text-xs font-semibold text-warm-text">
                  {sub.initial_destination_role === TOURISM_OFFICE_ROLE
                    ? TOURISM_OFFICE_LABEL
                    : typeof sub.initial_destination_role === 'string' && isOfficeRole(sub.initial_destination_role)
                      ? OFFICE_CONFIG[sub.initial_destination_role].label
                      : 'Not selected yet'}
                </p>
              )}
              {sub.initial_destination_role === TOURISM_OFFICE_ROLE && (
                <p className="mt-2 text-[11px] text-muted-text">
                  Final-decision office:{' '}
                  <span className="font-semibold text-warm-text">{finalDecisionOfficeLabel}</span>
                </p>
              )}
              {routeStatus === 'proposed' && (
                <p className="mt-1 text-[10px] text-muted-text">Proposed; awaiting Admin review</p>
              )}
            </div>
            {sub.intended_recipient && (
              <div>
                <p className="mb-1 text-[11px] font-medium text-muted-text">Intended recipient</p>
                <p className="text-xs text-warm-text">{sub.intended_recipient}</p>
              </div>
            )}
            {activeRouteStep?.requirements_requested_at && activeRouteStep.requirements_comments && (
              <div className="rounded-xl border border-warm-border bg-sidebar p-4">
                <p className="mb-2 text-[11px] font-semibold text-warm-text">
                  Requirements requested by this office
                </p>
                <p className="whitespace-pre-wrap text-xs leading-relaxed text-warm-text">
                  {activeRouteStep.requirements_comments}
                </p>
              </div>
            )}
            {activeRouteStep?.requirements_requested_at && sub.sender_response && (
              <div className="rounded-xl border border-warm-border bg-sidebar p-4">
                <p className="mb-2 text-[11px] font-semibold text-warm-text">Sender response</p>
                <p className="whitespace-pre-wrap text-xs leading-relaxed text-warm-text">
                  {sub.sender_response}
                </p>
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
            <section className="rounded-2xl border border-warm-border bg-card p-5 max-md:p-3.5">
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

          {/* Review Actions */}
          <section className="rounded-2xl border border-warm-border bg-card p-5 max-md:p-3.5">
            {officeReview && (
              <p className="mb-4 text-[11px] leading-relaxed text-muted-text">
                Review the request and record your office decision. Rejections are archived; the sender must submit a new request.
              </p>
            )}
            {mayorReview && (
              <p className="mb-4 text-[11px] leading-relaxed text-muted-text">
                Record the final decision, or return the request to the sender for additional requirements without changing its tracking number.
              </p>
            )}
            {isLocked ? (
              <div className="space-y-3">
                <p className="text-xs font-semibold text-warm-text">Review record</p>
                {reviewNotes ? (
                  <div className={`rounded-xl border p-4 ${isDeclined ? 'border-rejected-bg bg-rejected-bg/50' : 'border-approved-bg bg-approved-bg/50'}`}>
                    <p className={`mb-2 text-xs font-semibold ${isDeclined ? 'text-rejected-text' : 'text-approved-text'}`}>Your notes</p>
                    <p className="whitespace-pre-wrap break-words font-serif text-base leading-relaxed text-warm-text">
                      &quot;{reviewNotes}&quot;
                    </p>
                    <p className="mt-3 text-[10px] text-muted-text">{new Date(sub.updated_at).toLocaleDateString()}</p>
                  </div>
                ) : (
                  <p className="text-xs text-muted-text">No notes are recorded for this stage.</p>
                )}
                <div className="rounded-xl border border-dashed border-warm-border bg-sidebar p-4 text-center text-xs leading-relaxed text-muted-text">
                  {sub.status === 'declined_by_approver'
                    || sub.status === 'declined_by_admin'
                    || sub.status === 'declined_by_office'
                    || sub.status === 'declined_by_mayor'
                    ? 'This request is archived. The sender must submit a new request.'
                    : sub.status === 'returned_for_requirements'
                      ? 'Waiting for the sender to provide the requested information.'
                      : 'This review stage is closed.'}
                </div>
              </div>
            ) : (
              <>
                {approverReview && (
                  sub.initial_destination_role === TOURISM_OFFICE_ROLE && (
                    <label className="mb-4 block text-xs font-semibold text-warm-text">
                      Municipal office responsible for the final decision
                      <select
                        value={finalDecisionOfficeRole}
                        onChange={(event) => {
                          const officeRole = event.target.value;
                          setFinalDecisionOfficeRole(isOfficeRole(officeRole) ? officeRole : '');
                        }}
                        required
                        className="mt-2 h-11 w-full rounded-xl border border-warm-border bg-card px-3 text-xs font-normal text-warm-text"
                      >
                        <option value="">Select a municipal office</option>
                        {Object.entries(OFFICE_CONFIG).map(([officeRole, office]) => (
                          <option key={officeRole} value={officeRole}>{office.label}</option>
                        ))}
                      </select>
                    </label>
                  )
                )}
                {approverReview && (
                  <fieldset className="mb-4 space-y-3">
                    <legend className="mb-2 text-xs font-semibold text-warm-text">
                      {sub.initial_destination_role === TOURISM_OFFICE_ROLE
                        ? 'Optional additional office assignments after review'
                        : 'Assign additional offices after reviewing this submission'}
                    </legend>
                    <div className="space-y-2">
                      {Object.entries(OFFICE_CONFIG).map(([officeRole, office]) => (
                        sub.initial_destination_role !== officeRole && (
                          <div key={officeRole} className="rounded-xl border border-warm-border bg-card p-3 text-xs text-warm-text">
                            <label className="flex items-start gap-3">
                              <input
                                type="checkbox"
                                checked={proposedOffices.includes(officeRole as OfficeRole)}
                                onChange={() => toggleProposedOffice(officeRole as OfficeRole)}
                                className="mt-0.5 accent-clay"
                              />
                              <span>{office.label}</span>
                            </label>
                            {proposedOffices.includes(officeRole as OfficeRole) && (
                              <label className="mt-3 block text-[11px] text-muted-text">
                                Responsibility
                                <select
                                  value={officeResponsibilities[officeRole as OfficeRole] ?? 'mandatory_approval_clearance'}
                                  onChange={(event) => setOfficeResponsibilities((current) => ({
                                    ...current,
                                    [officeRole]: event.target.value as OfficeResponsibility,
                                  }))}
                                  className="mt-1 h-10 w-full rounded-lg border border-warm-border bg-card px-3 text-xs text-warm-text"
                                >
                                  {Object.entries(OFFICE_RESPONSIBILITIES).map(([value, label]) => (
                                    <option key={value} value={value}>{label}</option>
                                  ))}
                                </select>
                              </label>
                            )}
                          </div>
                        )
                      ))}
                    </div>
                    <label className="block text-[11px] font-medium text-muted-text">
                      Routing order
                      <select
                        value={routingMode}
                        onChange={(event) => setRoutingMode(event.target.value as OfficeRoutingMode)}
                        className="mt-1 h-10 w-full rounded-lg border border-warm-border bg-card px-3 text-xs text-warm-text"
                      >
                        <option value="sequential">Sequential — one office at a time</option>
                        <option value="simultaneous">Simultaneous — assigned offices work in parallel</option>
                      </select>
                    </label>
                    {proposedOffices.length > 0 && (
                      <ol className="space-y-2 rounded-xl bg-sidebar p-3 text-xs text-warm-text">
                        {proposedOffices.map((officeRole, index) => (
                          <li key={officeRole} className="flex items-center justify-between gap-3">
                            <span>
                              {routingMode === 'simultaneous' ? 1 : index + 1}. {OFFICE_CONFIG[officeRole].label}
                              <span className="ml-2 font-normal text-muted-text">
                                {OFFICE_RESPONSIBILITIES[officeResponsibilities[officeRole] ?? 'mandatory_approval_clearance']}
                              </span>
                            </span>
                            <span className="flex gap-2">
                              {routingMode === 'sequential' && (
                                <>
                                  <button type="button" onClick={() => moveProposedOffice(index, -1)} disabled={index === 0} aria-label={`Move ${OFFICE_CONFIG[officeRole].label} up`} className="disabled:opacity-40">↑</button>
                                  <button type="button" onClick={() => moveProposedOffice(index, 1)} disabled={index === proposedOffices.length - 1} aria-label={`Move ${OFFICE_CONFIG[officeRole].label} down`} className="disabled:opacity-40">↓</button>
                                </>
                              )}
                            </span>
                          </li>
                        ))}
                      </ol>
                    )}
                    <p className="text-[11px] text-muted-text">
                      Additional assignments do not replace the final-decision office or grant final decision authority.
                    </p>
                  </fieldset>
                )}
                <label htmlFor="approver-notes" className="mb-2 block text-xs font-semibold text-warm-text">
                  {mayorReview || mayorRouteStep
                    ? mayorRouteStep ? 'Additional requirements or office decision notes' : "Mayor's official decision"
                    : officeReview
                      ? activeRouteStep
                        ? 'Evaluation, clearance, or recommendation notes'
                        : 'Final office decision notes'
                      : 'Tourism Officer remarks'}
                </label>
                <textarea
                  id="approver-notes"
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  aria-describedby={officeReview && actionError ? 'office-route-action-error' : undefined}
                  className="mb-4 h-32 w-full resize-none rounded-xl border border-warm-border bg-card p-4 text-sm text-warm-text outline-none transition-colors placeholder:text-muted-text/60 focus:border-clay"
                  placeholder={officeReview
                    ? 'Record your evaluation, final decision, or the changes the sender must provide...'
                    : mayorReview
                      ? 'Explain the final decision...'
                    : 'Record your evaluation and any reasons...'}
                />
                {actionError && (
                  <p
                    id={officeReview ? 'office-route-action-error' : undefined}
                    role="alert"
                    className="mb-3 whitespace-pre-wrap rounded-xl border border-rejected-bg bg-rejected-bg/50 px-4 py-3 text-xs font-medium text-rejected-text"
                  >
                    {actionError}
                  </p>
                )}
                <div className="flex flex-col gap-3">
                  {approverReview && (
                    <>
                      <button
                        onClick={() => handleWorkflowAction('approve')}
                        disabled={updating}
                        className="inline-flex h-11 w-full items-center justify-center rounded-full bg-clay px-6 text-xs font-semibold text-white transition-colors hover:bg-warm-text disabled:opacity-50"
                      >
                        {updating
                          ? 'Saving...'
                          : sub.initial_destination_role === TOURISM_OFFICE_ROLE
                            ? 'Route submission'
                            : 'Assign additional offices'}
                      </button>
                      <button
                        onClick={() => handleWorkflowAction('reject')}
                        disabled={updating}
                        className="inline-flex h-11 w-full items-center justify-center rounded-full border border-warm-border px-6 text-xs font-semibold text-rejected-text transition-colors hover:bg-rejected-bg/50 disabled:opacity-50"
                      >
                        Reject and archive
                      </button>
                    </>
                  )}
                  {officeReview && (
                    <>
                      <button
                        type="button"
                        onClick={() => void handleWorkflowAction('return')}
                        disabled={updating}
                        className="inline-flex h-11 w-full items-center justify-center rounded-full border border-warm-border px-6 text-xs font-semibold text-warm-text transition-colors hover:bg-sidebar disabled:opacity-50"
                      >
                        {updating ? 'Saving...' : 'Request changes'}
                      </button>
                      <button
                        onClick={() => handleWorkflowAction('approve')}
                        disabled={updating}
                        className="inline-flex h-11 w-full items-center justify-center rounded-full bg-clay px-6 text-xs font-semibold text-white transition-colors hover:bg-warm-text disabled:opacity-50"
                      >
                        {updating
                          ? 'Saving...'
                          : activeRouteStep
                            ? 'Record assignment complete'
                            : 'Approve and complete'}
                      </button>
                      {role === sub.initial_destination_role && !activeRouteStep && (
                        <button
                          type="button"
                          onClick={() => void handleWorkflowAction('forward')}
                          disabled={updating}
                          className="inline-flex h-11 w-full items-center justify-center rounded-full border border-warm-border px-6 text-xs font-semibold text-warm-text transition-colors hover:bg-sidebar disabled:opacity-50"
                        >
                          {updating ? 'Saving...' : 'Forward to Tourism Officer'}
                        </button>
                      )}
                      <button
                        onClick={() => handleWorkflowAction('reject')}
                        disabled={updating}
                        className="inline-flex h-11 w-full items-center justify-center rounded-full border border-warm-border px-6 text-xs font-semibold text-rejected-text transition-colors hover:bg-rejected-bg/50 disabled:opacity-50"
                      >
                        Reject and archive
                      </button>
                    </>
                  )}
                  {mayorReview && (
                    <>
                      <button
                        onClick={() => handleWorkflowAction('approve')}
                        disabled={updating}
                        className="inline-flex h-11 w-full items-center justify-center rounded-full bg-clay px-6 text-xs font-semibold text-white transition-colors hover:bg-warm-text disabled:opacity-50"
                      >
                        {updating ? 'Saving...' : 'Approve and complete'}
                      </button>
                      <button
                        onClick={() => handleWorkflowAction('reject')}
                        disabled={updating}
                        className="inline-flex h-11 w-full items-center justify-center rounded-full border border-warm-border px-6 text-xs font-semibold text-rejected-text transition-colors hover:bg-rejected-bg/50 disabled:opacity-50"
                      >
                        Reject and archive
                      </button>
                      <button
                        onClick={() => handleWorkflowAction('return')}
                        disabled={updating}
                        className="inline-flex h-11 w-full items-center justify-center rounded-full border border-warm-border px-6 text-xs font-semibold text-warm-text transition-colors hover:bg-sidebar disabled:opacity-50"
                      >
                        Return for requirements
                      </button>
                    </>
                  )}
                </div>
              </>
            )}
          </section>

          {/* Audit Log */}
          <DocumentMessaging
            key={sub.id}
            submissionId={sub.id}
            fileName={sub.file_name}
            trackingNumber={sub.tracking_number ?? null}
            activity={(
              <div>
                <h3 className="mb-4 text-xs font-semibold text-warm-text">Activity</h3>
                {auditLogs.length === 0 ? (
                  <p className="text-xs text-muted-text">No activity recorded yet.</p>
                ) : (
                  <div className="relative ml-1 space-y-6 border-l border-warm-border">
                    {auditLogs.map((log) => (
                      <div key={log.id} className="relative pl-5">
                        <span className="absolute -left-[4.5px] top-1.5 h-2 w-2 rounded-full bg-clay ring-4 ring-card" />
                        <p className="text-[11px] font-semibold text-clay">{getActionLabel(log.action_type)}</p>
                        <div className="mt-0.5 flex flex-wrap items-center gap-2">
                          <p className="text-[11px] font-medium text-warm-text">{log.profiles?.full_name || 'System'}</p>
                          {log.profiles?.role && (
                            <span className="rounded-md bg-sidebar px-1.5 py-0.5 text-[10px] font-medium capitalize text-muted-text">
                              {log.profiles.role}
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 text-[10px] text-muted-text">
                          {new Date(log.created_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                        </p>
                        {log.comments && (
                          <p className="mt-2 whitespace-pre-wrap break-words rounded-xl bg-sidebar p-3 font-serif text-sm leading-relaxed text-warm-text">
                            &quot;{log.comments}&quot;
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          />

          {/* Footer Actions */}
          <button
            onClick={async () => {
              const url = await getFileUrl(supabase, sub);
              await downloadFile(url, sub.file_name);
            }}
            className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-full border border-warm-border px-6 text-xs font-semibold text-warm-text transition-colors hover:bg-sidebar"
          >
            Download original file
          </button>
        </aside>

        {/* PREVIEW PANEL */}
        <main className="lg:col-span-7">
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

    </div>
  );
}
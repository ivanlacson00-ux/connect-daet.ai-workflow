'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import DocumentMessaging from '@/components/DocumentMessaging';
import WorkflowActivityTimeline from '@/components/WorkflowActivityTimeline';
import FilePreview, { downloadFile, getFileUrl, type PreviewableFile } from '@/components/FilePreview';
import {
  getWorkflowFileMimeType,
  getWorkflowFilesTypeError,
} from '@/lib/workflow/file-types';
import { getSubmissionStatusLabel, getSubmissionStatusTone } from '@/lib/workflow/status';
import {
  ASSIGNMENT_TONE_CLASSES,
  describeAssignmentState,
  getOfficeLabel,
  summarizeAssignment,
  type AssignmentOutcome,
} from '@/lib/workflow/assignments';
import {
  getOfficeFileManagementPath,
  getWorkflowDocumentTypeLabel,
  isOfficeRole,
  OFFICE_CONFIG,
  OFFICE_RESPONSIBILITIES,
  type OfficeResponsibility,
  type OfficeRole,
} from '@/lib/workflow/offices';

// ─── Styles & Fonts (synced with the user file page) ─────────────────────────
const fonts = {
  serif: 'font-serif',
};

// ─── Icons & small UI helpers ────────────────────────────────────────────────
type IconName = 'arrow-left' | 'calendar' | 'chevron-right' | 'download' | 'file' | 'paperclip' | 'user';

function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, ReactNode> = {
    'arrow-left': (<><path d="m15 18-6-6 6-6" /><path d="M21 12H9" /></>),
    calendar: (<><path d="M8 2v4M16 2v4M3 10h18" /><rect x="3" y="4" width="18" height="18" rx="2" /></>),
    'chevron-right': <path d="m9 18 6-6-6-6" />,
    download: (<><path d="M12 3v12m0 0 4-4m-4 4-4-4" /><path d="M5 20h14" /></>),
    file: (<><path d="M6 2h8l4 4v16H6z" /><path d="M14 2v5h5M9 13h6M9 17h6" /></>),
    paperclip: <path d="m20 11-8.5 8.5a5 5 0 0 1-7-7L14 3a3.5 3.5 0 0 1 5 5l-9.5 9.5a2 2 0 0 1-3-3L15 6" />,
    user: (<><circle cx="12" cy="8" r="4" /><path d="M4 22a8 8 0 0 1 16 0" /></>),
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

function Label({ children }: { children: ReactNode }) {
  return (
    <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-muted-text">{children}</p>
  );
}

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
  final_decided_at?: string | null;
  final_decision_by?: string | null;
  approved_at?: string | null;
  rejected_at?: string | null;
  approver_comments?: string | null;
  office_comments?: string | null;
  rejection_comment?: string | null;
  admin_comments?: string | null;
  mayor_comments?: string | null;
  sender_response?: string | null;
  created_at: string;
  updated_at: string;
  received_by?: string | null;
  received_at?: string | null;
  closed_by?: string | null;
  completed_at?: string | null;
  closure_note?: string | null;
  closure_file_path?: string | null;
  closure_file_name?: string | null;
  closure_file_type?: string | null;
  closure_file_size?: number | null;
}

// Readable role names for activity entries (submitter and admin are not offices).
const getActorRoleLabel = (actorRole: string | null | undefined) => {
  if (!actorRole) return null;
  if (actorRole === 'submitter') return 'Submitter';
  if (actorRole === 'system_admin') return 'System Administrator';
  return getOfficeLabel(actorRole);
};

interface SupportingAttachment {
  id: string;
  file_name: string;
  file_path: string;
  file_type: string | null;
  file_size: number;
}

interface RouteStep {
  id: string;
  routing_plan_id: string;
  sequence_number: number;
  office_role: OfficeRole;
  status: string;
  assigned_by: string | null;
  assigned_by_role: string | null;
  responsibility: OfficeResponsibility;
  assignment_source: string;
  assigned_at: string | null;
  started_at: string | null;
  decided_at: string | null;
  decided_by: string | null;
  completed_at: string | null;
  completed_by: string | null;
  comments: string | null;
  outcome: string | null;
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
  const tone = getSubmissionStatusTone(s);
  if (tone === 'pending') return { label: getSubmissionStatusLabel(s), classes: 'bg-pending-bg text-pending-text' };
  if (tone === 'progress') return { label: getSubmissionStatusLabel(s), classes: 'bg-review-bg text-review-text' };
  if (tone === 'completed') return { label: getSubmissionStatusLabel(s), classes: 'bg-approved-bg text-approved-text' };
  if (tone === 'returned') return { label: getSubmissionStatusLabel(s), classes: 'bg-pending-bg text-pending-text' };
  if (tone === 'withdrawn') return { label: getSubmissionStatusLabel(s), classes: 'bg-sidebar text-muted-text' };
  if (QUEUE_STATUSES.includes(s)) return { label: 'Tourism Office processing', classes: 'bg-pending-bg text-pending-text' };
  if (s === 'pending_admin') return { label: 'Administrative review', classes: 'bg-review-bg text-review-text' };
  if (s === 'pending_office') return { label: 'Office processing', classes: 'bg-review-bg text-review-text' };
  if (s === 'pending_mayor') return { label: "Mayor's office processing", classes: 'bg-review-bg text-review-text' };
  if (s === 'returned_for_requirements') return { label: 'Additional requirements requested', classes: 'bg-pending-bg text-pending-text' };
  if (s === 'completed') return { label: 'Completed', classes: 'bg-approved-bg text-approved-text' };
  if (s === 'approved') return { label: 'Approved', classes: 'bg-approved-bg text-approved-text' };
  if (DECLINED_STATUSES.includes(s)) return { label: 'Rejected', classes: 'bg-rejected-bg text-rejected-text' };
  return { label: s.replaceAll('_', ' ') || 'Unknown', classes: 'bg-sidebar text-muted-text' };
};

const getActionLabel = (type: string) => {
  switch (type) {
    case 'DESTINATION_SELECTED': return 'Destination selected by submitter';
    case 'SUBMISSION_REDIRECTED': return 'Submission redirected';
    case 'SUBMISSION_RECEIVED': return 'Submission received by office';
    case 'SUBMISSION_FORWARDED': return 'Recommendation requested';
    case 'ASSIGNMENT_COMPLETED': return 'Office responded to assignment';
    case 'ASSIGNMENT_RETURNED': return 'Office assignment returned';
    case 'ASSIGNMENT_WITHDRAWN': return 'Office assignment withdrawn';
    case 'CHANGES_REQUESTED': return 'Changes requested';
    case 'CHANGES_RESPONDED': return 'Submitter responded to changes';
    case 'RETURNED_TO_SUBMITTER': return 'Returned to submitter for redirection';
    case 'SUBMISSION_WITHDRAWN': return 'Submission withdrawn';
    case 'SUBMISSION_CLOSED': return 'Submission completed';
    case 'SUBMISSION_APPROVED': return 'Submission approved';
    case 'SUBMISSION_REJECTED': return 'Submission rejected';
    case 'SUBMISSION_REOPENED': return 'Submitter reopened the submission';
    case 'FILE_VERSION_ADDED': return 'Document version added';
    case 'STAGE_1_AUTHORIZED': return 'Stage 1 approved';
    case 'STAGE_1_REJECTED': return 'Stage 1 rejected';
    case 'FINAL_AUTHORIZATION': return 'Final approval';
    case 'FINAL_REJECTION': return 'Final rejection';
    case 'VERIFICATION_PASSED': return 'Verification passed';
    case 'RETURNED_FOR_CORRECTION': return 'Returned for correction';
    case 'OFFICE_ROUTE_STEP_ASSIGNED': return 'Office route step assigned';
    case 'OFFICE_ROUTE_STEP_APPROVED': return 'Office route step approved';
    case 'OFFICE_ASSIGNMENT_COMPLETED': return 'Office assignment completed';
    case 'OFFICE_ASSIGNMENT_FORWARDED': return 'Recommendation requested from another office';
    case 'OFFICE_ASSIGNMENT_FORWARDED_ONWARD': return 'Office assignment forwarded onward';
    case 'OFFICE_FORWARDED_TO_TOURISM_OFFICER': return 'Sent to Tourism Officer for review';
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
    case 'SUBMITTED': return 'Submission submitted';
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
  const [loadError, setLoadError] = useState('');
  const [updating, setUpdating] = useState(false);
  const [actionError, setActionError] = useState('');
  const [routeSteps, setRouteSteps] = useState<RouteStep[]>([]);
  const [currentRoutePlanId, setCurrentRoutePlanId] = useState<string | null>(null);
  const [routeStatus, setRouteStatus] = useState<string | null>(null);
  const [routeStateError, setRouteStateError] = useState(false);
  const [role, setRole] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [supportingAttachmentsOpen, setSupportingAttachmentsOpen] = useState(false);
  const [previewingAttachmentId, setPreviewingAttachmentId] = useState<string | null>(null);
  const knownPlanIdsRef = useRef<Set<string>>(new Set());

  const fetchDetails = useCallback(async () => {
    setLoadError('');
    // Clear errors from an earlier load; anything still wrong is reported again below.
    setActionError('');
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError) throw authError;
      let currentRole: string | null = null;
      if (user) {
        const { data: currentProfile, error: profileError } = await supabase
          .from('profiles')
          .select('role')
          .eq('id', user.id)
          .single();
        if (profileError) throw profileError;
        currentRole = currentProfile?.role ?? null;
        setRole(currentRole);
      }
      const { data: submission, error: submissionError } = await supabase
        .from('workflow_submissions')
        .select('*')
        .eq('id', id)
        .single();

      if (submissionError) {
        if (submissionError.code === 'PGRST116') {
          setSub(null);
          return;
        }
        throw new Error(`Could not load this submission: ${submissionError.message}`);
      }
      if (!submission) {
        setSub(null);
        return;
      }

      setSub(submission);

      const { data: routes, error: routeError } = await supabase
        .from('workflow_routing_plans')
        .select('id, status, is_current, version')
        .eq('submission_id', submission.id)
        .order('version', { ascending: true });
      if (routeError) {
        console.error('Could not load workflow route state:', routeError.message);
        setActionError('Could not load the routing state. Refresh and try again.');
        setRouteStateError(true);
        setRouteSteps([]);
        setCurrentRoutePlanId(null);
        setRouteStatus(null);
      } else {
        const currentRoute = (routes ?? []).find((route) => route.is_current) ?? null;
        if (currentRoute) {
          const { data: steps, error: stepsError } = await supabase
            .from('workflow_routing_steps')
            .select('id, routing_plan_id, sequence_number, office_role, status, assigned_by, assigned_by_role, responsibility, assignment_source, assigned_at, started_at, decided_at, completed_at, comments, outcome, requirements_requested_at, requirements_comments')
            .in('routing_plan_id', (routes ?? []).map((route) => route.id))
            .order('sequence_number', { ascending: true });

          if (stepsError) {
            console.error('Could not load workflow route steps:', stepsError.message);
            setActionError('Could not load the office route. Refresh and try again.');
            setRouteStateError(true);
            setRouteSteps([]);
            setCurrentRoutePlanId(null);
            setRouteStatus(null);
          } else {
            const validSteps = (steps ?? []).filter(
              (step): step is RouteStep => typeof step.id === 'string'
                && typeof step.routing_plan_id === 'string'
                && isOfficeRole(step.office_role)
                && step.responsibility in OFFICE_RESPONSIBILITIES
            );
            setRouteSteps(validSteps);
            knownPlanIdsRef.current = new Set((routes ?? []).map((route) => route.id));
            setCurrentRoutePlanId(currentRoute.id);
            setRouteStatus(currentRoute.status);
            setRouteStateError(false);
          }
        } else {
          setRouteSteps([]);
          setCurrentRoutePlanId(null);
          setRouteStatus(null);
          setRouteStateError(false);
        }
      }

      const { data: profile, error: senderError } = await supabase
        .from('profiles')
        .select('email, full_name, role')
        .eq('id', submission.user_id)
        .single();
      if (senderError) {
        console.error('Could not load submitter details:', senderError.message);
      } else {
        setSender(profile);
      }

      const { data: logs, error: logsError } = await supabase
        .from('workflow_audit_logs')
        .select('*, profiles:action_by (full_name, email, role)')
        .eq('submission_id', id)
        .order('created_at', { ascending: false });
      if (logsError) {
        console.error('Could not load submission activity:', logsError.message);
        setActionError('Could not load submission activity. Refresh and try again.');
      } else {
        setAuditLogs(logs ?? []);
      }

      const { data: supportingFiles, error: attachmentError } = await supabase
        .from('workflow_submission_attachments')
        .select('id, file_name, file_path, file_type, file_size')
        .eq('submission_id', id)
        .order('created_at', { ascending: true });
      if (attachmentError) {
        console.error('Could not load supporting attachments:', attachmentError.message);
        setActionError('Could not load supporting documents. Refresh and try again.');
      } else {
        setAttachments(supportingFiles ?? []);
      }
    } catch (err) {
      console.error('Failed to load submission:', err);
      setLoadError(err instanceof Error ? err.message : 'Could not load this submission.');
    } finally {
      setLoading(false);
    }
  }, [id, supabase]);

  useEffect(() => { fetchDetails(); }, [fetchDetails]);

  // Refresh when another office acts on an assignment or the submission changes.
  useEffect(() => {
    if (typeof id !== 'string') return;
    const channel = supabase
      .channel(`office-submission-${id}`)
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'workflow_submissions', filter: `id=eq.${id}`,
      }, () => { void fetchDetails(); })
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'workflow_routing_plans', filter: `submission_id=eq.${id}`,
      }, () => { void fetchDetails(); })
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'workflow_routing_steps',
      }, (payload) => {
        const row = (payload.new && 'routing_plan_id' in payload.new ? payload.new : payload.old) as
          { routing_plan_id?: string } | null;
        if (row?.routing_plan_id && knownPlanIdsRef.current.has(row.routing_plan_id)) void fetchDetails();
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [fetchDetails, id, supabase]);

  const assignmentConversations = useMemo(() => routeSteps.flatMap((step) => {
    if (
      !['office_forward', 'tourism_officer'].includes(step.assignment_source)
      || !isOfficeRole(role)
      || (step.office_role !== role && step.assigned_by_role !== role)
      || !isOfficeRole(step.assigned_by_role)
    ) {
      return [];
    }

    const stepOpen = step.status === 'in_progress';
    return [{
      stepId: step.id,
      label: `${OFFICE_CONFIG[step.assigned_by_role].label} ↔ ${OFFICE_CONFIG[step.office_role].label}`,
      canSend: stepOpen
        && !['completed', 'approved', 'declined_by_approver', 'declined_by_admin', 'declined_by_office', 'declined_by_mayor', 'rejected', 'withdrawn'].includes(sub?.status ?? ''),
      closedSummary: stepOpen
        ? undefined
        : `${summarizeAssignment(step)}.${step.comments ? ` Note: ${step.comments}` : ''}`,
    }];
  }), [role, routeSteps, sub?.status]);

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
    action: string,
    recipient: string,
    message: string,
    files: File[],
  ) => {
    if (!sub) throw new Error('Submission is unavailable.');
    if (action === 'close_submission') {
      await closeSubmission(message, files[0] ?? null);
      return;
    }
    if ((action === 'approve' || action === 'reject') && isRecipientOffice) {
      if (routeStateError) {
        throw new Error('Could not verify the office assignment. Refresh and try again.');
      }
      if (action === 'reject' && !message.trim()) {
        throw new Error('Explain why your office rejects this assignment.');
      }
      setUpdating(true);
      setActionError('');
      try {
        const { error } = await supabase.rpc('complete_workflow_assignment', {
          target_submission_id: sub.id,
          completion_notes: message.trim() || null,
          assignment_outcome: action === 'approve' ? 'endorsed' : 'not_endorsed',
        });
        if (error) throw new Error(error.message || `Could not ${action} this assignment.`);
        await fetchDetails();
      } finally {
        setUpdating(false);
      }
      return;
    }
    if (action === 'approve' || action === 'reject') {
      setUpdating(true);
      setActionError('');
      try {
        const { error } = await supabase.rpc('decide_workflow_submission_as_responsible_office', {
          target_submission_id: sub.id,
          final_decision: action,
          decision_comments: message.trim() || null,
        });
        if (error) throw new Error(error.message || `Could not ${action} this submission.`);
        await fetchDetails();
      } finally {
        setUpdating(false);
      }
      return;
    }
    setUpdating(true);
    setActionError('');
    try {
      if (routeStateError && ['complete_assignment', 'return_assignment', 'withdraw_assignment'].includes(action)) {
        throw new Error('Could not verify the office assignment. Refresh and try again.');
      }

      const targetOfficeRole = recipient.replace(/^office:/, '');
      const activeAssignment = routeSteps.find((step) =>
        step.routing_plan_id === currentRoutePlanId
        && step.office_role === targetOfficeRole
        && (step.status === 'pending' || step.status === 'in_progress')
      );
      let rpcName:
        | 'request_workflow_submission_changes'
        | 'return_workflow_submission_to_submitter'
        | 'complete_workflow_assignment'
        | 'return_workflow_assignment'
        | 'withdraw_workflow_assignment';
      let rpcArgs:
        | { target_submission_id: string; request_comments: string }
        | { target_submission_id: string; return_reason: string }
        | { target_submission_id: string; completion_notes: string | null; assignment_outcome: AssignmentOutcome | null }
        | { target_submission_id: string; target_assignment_office_role: string; withdrawal_reason: string };
      if (action === 'request_changes') {
        rpcName = 'request_workflow_submission_changes';
        rpcArgs = { target_submission_id: sub.id, request_comments: message.trim() };
      } else if (action === 'return_to_submitter') {
        rpcName = 'return_workflow_submission_to_submitter';
        rpcArgs = { target_submission_id: sub.id, return_reason: message.trim() };
      } else if (action === 'complete_assignment') {
        rpcName = 'complete_workflow_assignment';
        rpcArgs = {
          target_submission_id: sub.id,
          completion_notes: message.trim() || null,
          assignment_outcome: null,
        };
      } else if (action === 'return_assignment') {
        rpcName = 'return_workflow_assignment';
        rpcArgs = { target_submission_id: sub.id, return_reason: message.trim() };
      } else if (action === 'withdraw_assignment' && activeAssignment) {
        rpcName = 'withdraw_workflow_assignment';
        rpcArgs = {
          target_submission_id: sub.id,
          target_assignment_office_role: activeAssignment.office_role,
          withdrawal_reason: message.trim(),
        };
      } else {
        throw new Error('This action is unavailable for the selected office.');
      }

      const { error } = await supabase.rpc(rpcName, rpcArgs);
      if (error) throw new Error(error.message || 'Could not complete the workflow action.');
      await fetchDetails();
    } finally {
      setUpdating(false);
    }
  };

  const closeSubmission = async (closureNote: string, closureFile: File | null) => {
    if (!sub) throw new Error('Submission is unavailable.');
    setUpdating(true);
    setActionError('');
    let filePath: string | null = null;
    try {
      let userId: string | null = null;
      let fileType: string | null = null;
      if (closureFile) {
        const fileError = getWorkflowFilesTypeError([closureFile], false);
        if (fileError) throw new Error(fileError);
        if (closureFile.size > 10 * 1024 * 1024) {
          throw new Error('The completion document must be 10 MB or smaller.');
        }
        const { data: { user }, error: userError } = await supabase.auth.getUser();
        if (userError || !user) throw userError ?? new Error('You must sign in to complete this submission.');
        userId = user.id;
        fileType = getWorkflowFileMimeType(closureFile.name);
        if (!fileType) throw new Error('The completion document type is not supported.');
        filePath = `${userId}/${crypto.randomUUID()}-closure-${closureFile.name.replace(/[^\w.-]/g, '_')}`;
        const { error: uploadError } = await supabase.storage
          .from('workflow_uploads')
          .upload(filePath, closureFile, { contentType: fileType, upsert: false });
        if (uploadError) throw uploadError;
      }

      const { error } = await supabase.rpc('close_workflow_submission_with_details', {
        target_submission_id: sub.id,
        closure_note: closureNote.trim() || null,
        closure_file_path: filePath,
        closure_file_name: closureFile?.name ?? null,
        closure_file_type: fileType,
        closure_file_size: closureFile?.size ?? null,
      });
      if (error) throw error;

      await fetchDetails();
    } catch (error) {
      if (filePath) {
        const { error: cleanupError } = await supabase.storage.from('workflow_uploads').remove([filePath]);
        if (cleanupError) console.error('Could not clean up unlinked closure file:', cleanupError.message);
      }
      throw error instanceof Error ? error : new Error('Could not complete this submission.');
    } finally {
      setUpdating(false);
    }
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
        <div className={`rounded-2xl border px-5 py-8 text-xs font-semibold ${
          loadError
            ? 'border-rejected-bg bg-rejected-bg/50 text-rejected-text'
            : 'border-warm-border bg-card text-muted-text'
        }`}>
          <p>{loadError || 'Submission not found.'}</p>
          {loadError && (
            <button
              type="button"
              onClick={() => {
                setLoading(true);
                void fetchDetails();
              }}
              className="mt-4 rounded-full border border-current px-4 py-2 font-bold hover:bg-white/50"
            >
              Try again
            </button>
          )}
        </div>
      </div>
    );
  }

  const statusConfig = getStatusStyles(sub.status);
  const currentPlanSteps = routeSteps.filter((step) => step.routing_plan_id === currentRoutePlanId);
  const activeRouteStep = isOfficeRole(role)
    ? currentPlanSteps.find((step) => step.office_role === role && ['pending', 'in_progress'].includes(step.status))
    : undefined;
  const hasOfficeAssignment = isOfficeRole(role)
    && routeSteps.some((step) => step.office_role === role && step.status !== 'skipped');
  const selectedOfficeRole = sub.selected_office_role ?? null;
  const initialDestinationRole = sub.initial_destination_role ?? null;
  const responsibleOfficeRole = selectedOfficeRole
    ?? (isOfficeRole(initialDestinationRole) ? initialDestinationRole : null);
  const isResponsibleOffice = isOfficeRole(role) && role === responsibleOfficeRole;
  const isRecipientOffice = Boolean(activeRouteStep) && !isResponsibleOffice;
  const activeAssignmentCreatedByCurrentOffice = isOfficeRole(role)
    && currentPlanSteps.some((step) =>
      step.assigned_by_role === role && ['pending', 'in_progress'].includes(step.status)
    );
  const officeReview = isResponsibleOffice || hasOfficeAssignment || activeAssignmentCreatedByCurrentOffice;
  const pendingAssignments = currentPlanSteps.filter((step) =>
    step.status === 'pending' || step.status === 'in_progress'
  );
  const pendingAssignmentCount = pendingAssignments.length;
  const isCompleted = sub.status === 'completed' || sub.status === 'approved';
  const isRejected = DECLINED_STATUSES.includes(sub.status);
  const isWithdrawn = sub.status === 'withdrawn';
  const waitingAssignmentNames = pendingAssignments.map((step) => OFFICE_CONFIG[step.office_role].label);
  const activeOfficeConversation = currentPlanSteps.find((step) =>
    ['office_forward', 'tourism_officer'].includes(step.assignment_source)
    && ['pending', 'in_progress'].includes(step.status)
    && (step.office_role === role || step.assigned_by_role === role)
  );
  const defaultAssignmentStepId = isResponsibleOffice
    ? null
    : activeOfficeConversation?.id
      ?? [...routeSteps].reverse().find((step) =>
        ['office_forward', 'tourism_officer'].includes(step.assignment_source)
        && (step.office_role === role || step.assigned_by_role === role)
      )?.id
      ?? null;
  const pendingAssignmentReason = pendingAssignments.length > 0
    ? `Waiting for ${waitingAssignmentNames.join(', ')} to finish`
    : '';
  const statusLine = `${statusConfig.label}${pendingAssignmentReason ? ` · ${pendingAssignmentReason}` : ''}`;
  const requiresReviewStart = (
    isResponsibleOffice && ['submitted', 'pending_office'].includes(sub.status)
  ) || (
    isRecipientOffice && activeRouteStep?.status === 'pending'
  );
  // Mirrors decide_workflow_submission_as_responsible_office: only the office recorded
  // as the decision office (or the original destination) may approve or reject.
  const decisionOfficeRole = sub.final_decision_office_role ?? initialDestinationRole;
  const decisionAuthorityReason = decisionOfficeRole && decisionOfficeRole !== role
    ? `Only ${getOfficeLabel(decisionOfficeRole)} can approve or reject this submission`
    : undefined;
  const decisionStatusReason = sub.status !== 'in_process'
    ? 'Available only while status is In Process'
    : undefined;
  const responsibleOfficeActions = [
    {
      value: 'request_changes',
      label: 'Request changes or information',
      groupLabel: 'Send back',
      description: 'The submitter can respond on this same submission; it returns to your office for review.',
      tone: 'primary' as const,
      requiresMessage: true,
      successMessage: 'Changes requested. The submitter has been notified.',
      unavailableReason: routeStateError
        ? 'Could not verify whether an assignment is pending'
        : pendingAssignmentReason
          || (sub.status !== 'in_process' ? 'Available only while status is In Process' : undefined),
    },
    {
      value: 'approve',
      label: 'Approve',
      groupLabel: 'Decision',
      description: 'Record the responsible office’s final approval for this submission.',
      tone: 'primary' as const,
      confirmation: 'Approve this submission? The submitter will be notified and the decision recorded.',
      successMessage: 'Submission approved. The submitter has been notified.',
      unavailableReason: routeStateError
        ? 'Could not verify whether an office assignment is pending'
        : pendingAssignmentReason || decisionStatusReason || decisionAuthorityReason,
    },
    {
      value: 'reject',
      label: 'Reject',
      groupLabel: 'Decision',
      description: 'Record the responsible office’s final rejection. A reason is required.',
      tone: 'warning' as const,
      requiresMessage: true,
      confirmation: 'Reject this submission? The submitter will be notified and the decision recorded.',
      successMessage: 'Submission rejected. The submitter has been notified.',
      unavailableReason: routeStateError
        ? 'Could not verify whether an office assignment is pending'
        : pendingAssignmentReason || decisionStatusReason || decisionAuthorityReason,
    },
    {
      value: 'return_to_submitter',
      label: 'Return for redirection',
      groupLabel: 'Other actions',
      description: 'Return this submission so the submitter can choose a different destination office.',
      tone: 'warning' as const,
      requiresMessage: true,
      confirmation: 'The submission will return to the submitter so they can choose the correct office. This is not a rejection.',
      successMessage: 'Submission returned to the submitter for redirection.',
      unavailableReason: !['submitted', 'in_process'].includes(sub.status)
        ? 'Available only while status is Submitted or In Process'
        : undefined,
    },
    {
      value: 'close_submission',
      label: 'Complete',
      buttonLabel: 'Complete',
      groupLabel: 'Finish',
      description: 'Mark the entire submission complete. This is different from completing only an office assignment.',
      tone: 'strong' as const,
      successMessage: 'Submission completed. The submitter has been notified.',
      unavailableReason: routeStateError
        ? 'Could not verify whether an assignment is pending'
        : pendingAssignmentReason
          || (!['in_process', 'changes_requested'].includes(sub.status)
            ? 'Available only while status is In Process or Changes Requested'
            : undefined),
    },
  ];
  const actionsByRecipient: Record<string, {
    value: string;
    label: string;
    buttonLabel?: string;
    groupLabel?: string;
    description?: string;
    tone?: 'neutral' | 'primary' | 'warning' | 'strong';
    requiresMessage?: boolean;
    unavailableReason?: string;
    confirmation?: string;
    successMessage?: string;
  }[]> = {};
  const recipients: { value: string; label: string }[] = [];
  let initialRecipient = 'responsible_office';
  let initialAction = 'request_changes';

  if (isResponsibleOffice) {
    recipients.push({ value: 'submitter', label: 'Submitter' });
    actionsByRecipient.submitter = responsibleOfficeActions;
    for (const officeRole of Object.keys(OFFICE_CONFIG)
      .filter(isOfficeRole)
      .filter((office) => office !== role && office !== responsibleOfficeRole)) {
      const targetAssignment = pendingAssignments.find((step) => step.office_role === officeRole);
      const forwardReason = routeStateError
        ? 'Could not verify the office assignment'
        : pendingAssignmentReason
          || (sub.status !== 'in_process' ? 'Available only while status is In Process' : undefined)
          || (officeRole === selectedOfficeRole ? 'Choose an office other than your own' : undefined);
      const recipientValue = `office:${officeRole}`;
      recipients.push({ value: recipientValue, label: OFFICE_CONFIG[officeRole].label });
      const currentDocumentReason = !sub.file_path
        ? 'Current document is unavailable to send to another office'
        : sub.file_size > 10 * 1024 * 1024
          ? 'Current document exceeds the 10 MB limit for sending to another office'
          : undefined;
      actionsByRecipient[recipientValue] = [
        {
          value: 'forward',
          label: 'Forward',
          buttonLabel: 'Forward',
          groupLabel: 'Route to another office',
          description: isResponsibleOffice
            ? `Send this submission to ${OFFICE_CONFIG[officeRole].label} for a recommendation; your office remains responsible for the final decision.`
            : `Send this assignment to ${OFFICE_CONFIG[officeRole].label} for a recommendation. Your assignment will be marked complete.`,
          tone: 'primary',
          unavailableReason: currentDocumentReason || forwardReason,
        },
        {
          value: 'withdraw_assignment',
          label: 'Withdraw assignment',
          groupLabel: 'Other actions',
          description: `Withdraw only the assignment with ${OFFICE_CONFIG[officeRole].label}; the submission itself stays open.`,
          tone: 'warning',
          requiresMessage: true,
          confirmation: `The pending assignment with ${OFFICE_CONFIG[officeRole].label} will be withdrawn.`,
          successMessage: `Assignment with ${OFFICE_CONFIG[officeRole].label} withdrawn.`,
          unavailableReason: targetAssignment
            ? undefined
            : `No pending assignment with ${OFFICE_CONFIG[officeRole].label}`,
        },
      ];
    }
    initialRecipient = 'submitter';
  } else if (isRecipientOffice) {
    recipients.push({ value: 'responsible_office', label: 'Responsible office' });
    actionsByRecipient.responsible_office = [
      {
        value: 'complete_assignment',
        label: 'Complete',
        buttonLabel: 'Complete',
        groupLabel: 'Finish',
        description: 'Mark your office’s assignment handled. Add a note for the responsible office if useful.',
        tone: 'primary',
        successMessage: 'Assignment completed. The responsible office has been notified.',
        unavailableReason: routeStateError ? 'Could not verify your office assignment' : undefined,
      },
      {
        value: 'approve',
        label: 'Approve',
        groupLabel: 'Decision',
        description: 'Record your office’s approval response. The responsible office retains authority to complete the submission.',
        tone: 'primary',
        successMessage: 'Approval sent. The responsible office has been notified.',
        unavailableReason: routeStateError ? 'Could not verify your office assignment' : undefined,
      },
      {
        value: 'reject',
        label: 'Reject',
        groupLabel: 'Decision',
        description: 'Record your office’s rejection response. The responsible office retains authority to complete the submission. A reason is required.',
        tone: 'warning',
        requiresMessage: true,
        successMessage: 'Rejection sent. The responsible office has been notified.',
        unavailableReason: routeStateError ? 'Could not verify your office assignment' : undefined,
      },
      {
        value: 'return_assignment',
        label: 'Return to responsible office',
        groupLabel: 'Other actions',
        description: 'Send this assignment back to the responsible office with your reason.',
        tone: 'warning',
        requiresMessage: true,
        confirmation: 'The assignment will be returned to the responsible office with your reason.',
        successMessage: 'Assignment returned to the responsible office.',
        unavailableReason: routeStateError ? 'Could not verify your office assignment' : undefined,
      },
    ];
    for (const officeRole of Object.keys(OFFICE_CONFIG)
      .filter(isOfficeRole)
      .filter((office) => office !== role && office !== responsibleOfficeRole)) {
      const recipientValue = `office:${officeRole}`;
      const currentDocumentReason = !sub.file_path
        ? 'Current document is unavailable to send to another office'
        : sub.file_size > 10 * 1024 * 1024
          ? 'Current document exceeds the 10 MB limit for sending to another office'
          : undefined;
      recipients.push({ value: recipientValue, label: OFFICE_CONFIG[officeRole].label });
      actionsByRecipient[recipientValue] = [
        {
          value: 'forward',
          label: 'Forward',
          buttonLabel: 'Forward',
          groupLabel: 'Route to another office',
          description: `Send this assignment to ${OFFICE_CONFIG[officeRole].label} for a recommendation. Your assignment will be marked complete.`,
          tone: 'primary',
          unavailableReason: currentDocumentReason
            || (routeStateError ? 'Could not verify the office assignment' : undefined)
            || (sub.status !== 'in_process' ? 'Available only while status is In Process' : undefined),
        },
      ];
    }
  }
  // Open the action list on the first action that can actually be taken.
  initialAction = (actionsByRecipient[initialRecipient] ?? []).find((action) => !action.unavailableReason)?.value
    ?? actionsByRecipient[initialRecipient]?.[0]?.value
    ?? initialAction;
  const isAssignmentSender = activeAssignmentCreatedByCurrentOffice;
  const isReturned = sub.status === 'returned';

  // ─── Office assignments (who was asked, and what they answered) ────────────
  const historicalRecipientView = hasOfficeAssignment
    && !isResponsibleOffice
    && !isRecipientOffice
    && !isAssignmentSender;
  const composerClosed = isCompleted || isRejected || isWithdrawn || isReturned || historicalRecipientView;
  const officeHistory = routeSteps
    .filter((step) => step.status !== 'skipped')
    .map((step) => ({
      id: step.id,
      officeRole: step.office_role,
      state: step.outcome
        ? describeAssignmentState(step).label
        : step.status === 'completed'
          ? 'Completed'
          : step.status === 'in_progress'
            ? 'Under review'
            : step.status === 'pending'
              ? 'Pending'
              : step.status.replaceAll('_', ' '),
      tone: step.outcome
        ? describeAssignmentState(step).tone
        : step.status === 'pending' || step.status === 'in_progress'
          ? 'waiting'
          : step.status === 'returned'
            ? 'caution'
            : step.status === 'withdrawn'
              ? 'muted'
              : 'muted',
      timestamp: step.completed_at ?? step.decided_at ?? step.started_at ?? step.assigned_at,
      comments: step.comments,
      sortTimestamp: step.completed_at ?? step.decided_at ?? step.started_at ?? step.assigned_at ?? '',
    }));
  if (isCompleted || isRejected) {
    // "Complete" (status completed) finishes processing without an approval decision.
    const isApprovalDecision = sub.status === 'approved';
    const finalDecisionAt = sub.final_decided_at
      ?? (isRejected ? sub.rejected_at : isApprovalDecision ? sub.approved_at : sub.completed_at)
      ?? sub.updated_at;
    const storedFinalDecisionOfficeRole = sub.final_decision_office_role ?? null;
    const finalDecisionOfficeRole = isOfficeRole(storedFinalDecisionOfficeRole)
      ? storedFinalDecisionOfficeRole
      : isOfficeRole(responsibleOfficeRole)
        ? responsibleOfficeRole
        : null;
    if (finalDecisionOfficeRole) {
      officeHistory.push({
        id: `final-decision-${sub.id}`,
        officeRole: finalDecisionOfficeRole,
        state: isRejected
          ? 'Final decision: Rejected'
          : isApprovalDecision
            ? 'Final decision: Approved'
            : 'Submission completed',
        tone: isRejected ? 'negative' : 'positive',
        timestamp: finalDecisionAt,
        comments: isRejected
          ? sub.rejection_comment ?? sub.office_comments ?? null
          : sub.closure_note ?? (isApprovalDecision ? sub.office_comments : null) ?? null,
        sortTimestamp: finalDecisionAt,
      });
    }
  }
  officeHistory.sort((first, second) =>
    first.sortTimestamp.localeCompare(second.sortTimestamp)
  );
  const activeOfficeLabel = (step: RouteStep) => getOfficeLabel(step.office_role);
  const workflowStatus = (
    <section
      aria-labelledby={`workflow-status-${sub.id}`}
      className="overflow-hidden rounded-2xl border border-warm-border bg-card"
      role="status"
    >
      <header className="border-b border-warm-border px-5 py-4">
        <h3 id={`workflow-status-${sub.id}`} className="text-sm font-bold text-warm-text">Workflow status</h3>
        <p className="mt-0.5 text-[10px] text-muted-text">Current responsibility and office handling</p>
      </header>
      <div className="grid gap-4 p-5 sm:grid-cols-2">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-muted-text">Responsible office</p>
          <p className="mt-1 text-xs font-semibold text-warm-text">
            {responsibleOfficeRole ? getOfficeLabel(responsibleOfficeRole) : 'Not assigned'}
          </p>
          <p className="mt-1 text-[10px] leading-relaxed text-muted-text">
            Retains responsibility for the submission and its final decision.
          </p>
        </div>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-muted-text">Currently handling</p>
          {pendingAssignments.length > 0 ? (
            <>
              <ul className="mt-1 space-y-1.5">
                {pendingAssignments.map((step) => (
                  <li key={step.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs">
                    <span className="font-semibold text-warm-text">{activeOfficeLabel(step)}</span>
                    <span className="text-[10px] font-medium text-pending-text">
                      {step.status === 'pending' ? 'Awaiting start' : 'Under review'}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[10px] leading-relaxed text-muted-text">
                The responsible office is waiting for these assignments to be completed.
              </p>
            </>
          ) : isCompleted || isRejected || isWithdrawn ? (
            <p className="mt-1 text-xs font-medium text-muted-text">No active office assignment</p>
          ) : (
            <p className="mt-1 text-xs font-semibold text-warm-text">
              {responsibleOfficeRole ? getOfficeLabel(responsibleOfficeRole) : 'Responsible office'} can continue processing
            </p>
          )}
        </div>
        {officeHistory.length > 0 && (
          <div className="border-t border-warm-border pt-4 sm:col-span-2">
            <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-muted-text">
              Office actions and decisions
            </p>
            <ol className="mt-2 divide-y divide-warm-border">
              {officeHistory.map((entry) => (
                <li key={entry.id} className="flex flex-col gap-1.5 py-3 first:pt-1 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-xs font-semibold text-warm-text">
                        {getOfficeLabel(entry.officeRole)}
                      </span>
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${ASSIGNMENT_TONE_CLASSES[entry.tone]}`}>
                        {entry.state}
                      </span>
                    </div>
                    {entry.comments && (
                      <p className="mt-1 whitespace-pre-wrap break-words text-[11px] leading-relaxed text-muted-text">
                        {entry.comments}
                      </p>
                    )}
                  </div>
                  {entry.timestamp && (
                    <time
                      dateTime={entry.timestamp}
                      className="shrink-0 text-[10px] text-muted-text"
                    >
                      {new Date(entry.timestamp).toLocaleString([], {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })}
                    </time>
                  )}
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
    </section>
  );

  const startOfficeReview = async () => {
    if (!sub || !isOfficeRole(role) || !requiresReviewStart) return;
    setUpdating(true);
    setActionError('');
    try {
      const rpcName = isResponsibleOffice
        ? 'receive_workflow_submission'
        : 'receive_workflow_assignment';
      const { error } = await supabase.rpc(rpcName, { target_submission_id: sub.id });
      if (error) throw new Error(error.message || 'Could not start this review.');
      await fetchDetails();
    } catch (error) {
      console.error('Could not start office review:', error);
      setActionError(error instanceof Error ? error.message : 'Could not start this review.');
    } finally {
      setUpdating(false);
    }
  };
  const downloadOriginal = async () => {
    const url = await getFileUrl(supabase, sub);
    await downloadFile(url, sub.file_name);
  };
  const previewingAttachment = attachments.find((attachment) => attachment.id === previewingAttachmentId);

  return (
    <div className="mx-auto w-full max-w-[1500px] pb-8">
      <button
        type="button"
        onClick={() => {
          if (isOfficeRole(role)) router.push(getOfficeFileManagementPath(role));
          else router.back();
        }}
        className="mb-5 inline-flex items-center gap-2 text-xs font-semibold text-muted-text transition-colors hover:text-clay"
      >
        <span className="grid h-8 w-8 place-items-center rounded-full border border-warm-border bg-card">
          <Icon name="arrow-left" size={16} />
        </span>
        Back to queue
      </button>
      {(actionError || loadError) && (
        <div role="alert" className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rejected-bg bg-rejected-bg/50 px-4 py-3 text-xs font-medium text-rejected-text">
          <span>{loadError || actionError}</span>
          {loadError && (
            <button
              type="button"
              onClick={() => {
                setLoading(true);
                void fetchDetails();
              }}
              className="rounded-full border border-current px-4 py-2 font-bold hover:bg-white/50"
            >
              Try again
            </button>
          )}
        </div>
      )}

      {/* ── Header card ── */}
      <section className="mb-5 overflow-hidden rounded-2xl border border-warm-border bg-card shadow-[0_12px_35px_rgba(65,49,39,0.05)]">
        <div className="flex flex-col gap-5 p-5 md:flex-row md:items-center md:justify-between md:p-7">
          <div className="min-w-0">
            <div className="mb-3 flex flex-wrap items-center gap-2.5">
              <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[11px] font-bold ${statusConfig.classes}`}>
                <span className={`h-1.5 w-1.5 rounded-full bg-current ${isCompleted || isWithdrawn ? 'opacity-70' : 'animate-pulse'}`} />
                {statusConfig.label}
              </span>
              <span className="text-[11px] font-medium text-muted-text">
                Submission ID: {String(sub.id).split('-')[0]}
              </span>
              {isOfficeRole(selectedOfficeRole) && (
                <span className="text-[11px] font-medium text-muted-text">
                  · {OFFICE_CONFIG[selectedOfficeRole].label}
                </span>
              )}
            </div>
            <h1 className={`${fonts.serif} max-w-4xl break-words text-[28px] font-semibold leading-[1.15] tracking-[-0.02em] text-warm-text md:text-[36px]`}>
              {sub.file_name}
            </h1>
            <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-[11px] text-muted-text">
              <span className="inline-flex items-center gap-1.5">
                <Icon name="user" size={14} /> {sender?.full_name || 'Unknown submitter'}
              </span>
              {sender?.email && (
                <span className="inline-flex items-center gap-1.5">{sender.email}</span>
              )}
              <span className="inline-flex items-center gap-1.5">
                <Icon name="calendar" size={14} /> Submitted{' '}
                {new Date(sub.created_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Icon name="file" size={14} /> {sub.file_type || 'File'} ·{' '}
                {sub.file_size ? `${(sub.file_size / 1024).toFixed(2)} KB` : 'Size unavailable'}
              </span>
            </div>
          </div>
          <div className="shrink-0 rounded-xl border border-warm-border bg-white px-5 py-3.5 md:text-right">
            <Label>Tracking number</Label>
            <p className="font-mono text-sm font-bold tracking-[0.08em] text-clay">
              {sub.tracking_number || 'Pending'}
            </p>
          </div>
        </div>

        {/* ── Submission context ── */}
        <section className="border-t border-warm-border px-5 py-6 md:px-7">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-clay">Submission context</p>
              <h2 className="mt-1 font-serif text-xl font-semibold text-warm-text">Request details</h2>
            </div>
            <span className="rounded-full bg-clay-soft px-3 py-1.5 text-[10px] font-bold text-clay">
              {getWorkflowDocumentTypeLabel(sub.category ?? null, sub.other_document_type)}
            </span>
          </div>
          <div className="grid gap-x-8 gap-y-5 md:grid-cols-2">
            {sub.intended_recipient && (
              <div>
                <Label>Intended recipient</Label>
                <p className="text-xs font-semibold text-warm-text">{sub.intended_recipient}</p>
              </div>
            )}
            {sub.purpose && (
              <div>
                <Label>Purpose</Label>
                <p className="whitespace-pre-wrap text-xs leading-relaxed text-warm-text">{sub.purpose}</p>
              </div>
            )}
            {sub.requested_action && (
              <div className="md:col-span-2">
                <Label>Requested action</Label>
                <p className="whitespace-pre-wrap text-xs leading-relaxed text-warm-text">{sub.requested_action}</p>
              </div>
            )}
            <div className="md:col-span-2">
              <Label>Sender notes</Label>
              <blockquote className="whitespace-pre-wrap break-words border-l-2 border-clay pl-3 font-serif text-[14px] italic leading-relaxed text-warm-text/75">
                {sub.description || 'No description provided.'}
              </blockquote>
            </div>
          </div>
        </section>

        {/* ── Document preview ── */}
        <section className="border-t border-warm-border">
          <div className={`flex items-center gap-3 px-5 py-4 md:px-7 ${previewOpen ? 'border-b border-warm-border' : ''}`}>
            <button
              type="button"
              onClick={() => setPreviewOpen((open) => !open)}
              aria-expanded={previewOpen}
              aria-controls={`document-preview-${sub.id}`}
              className="flex min-w-0 flex-1 items-center justify-between gap-4 text-left"
            >
              <span className="min-w-0">
                <span className="block text-[10px] font-bold uppercase tracking-[0.15em] text-clay">Document preview</span>
                <span className="mt-1 block truncate text-xs font-semibold text-warm-text">{sub.file_name}</span>
                <span className="mt-1 block text-[10px] font-medium text-muted-text">
                  {previewOpen ? 'Hide full document preview' : 'Select to view the full document'}
                </span>
              </span>
              <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full border border-warm-border text-muted-text transition-transform ${previewOpen ? 'rotate-90' : ''}`}>
                <Icon name="chevron-right" size={16} />
              </span>
            </button>
            <button
              type="button"
              onClick={downloadOriginal}
              aria-label={`Download ${sub.file_name}`}
              className="inline-flex h-9 shrink-0 items-center gap-2 rounded-full border border-warm-border px-3.5 text-[11px] font-bold text-warm-text hover:bg-sidebar"
            >
              <Icon name="download" size={15} />
              <span className="hidden sm:inline">Download</span>
            </button>
            {attachments.length > 0 && (
              <button
                type="button"
                onClick={() => setSupportingAttachmentsOpen((open) => !open)}
                aria-label={`${supportingAttachmentsOpen ? 'Hide' : 'Show'} ${attachments.length} supporting documents`}
                aria-expanded={supportingAttachmentsOpen}
                aria-controls={`supporting-attachments-${sub.id}`}
                title={`${attachments.length} supporting ${attachments.length === 1 ? 'document' : 'documents'}`}
                className={`relative grid h-9 w-9 shrink-0 place-items-center rounded-full border transition-colors ${
                  supportingAttachmentsOpen
                    ? 'border-clay bg-clay-soft text-clay'
                    : 'border-warm-border text-warm-text hover:bg-sidebar'
                }`}
              >
                <Icon name="paperclip" size={16} />
                <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-clay px-1 text-[9px] font-bold leading-none text-white">
                  {attachments.length}
                </span>
              </button>
            )}
          </div>
          {attachments.length > 0 && (
            <div
              id={`supporting-attachments-${sub.id}`}
              hidden={!supportingAttachmentsOpen}
              className="border-b border-warm-border bg-sidebar/40 px-5 py-4 md:px-7"
            >
              <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.12em] text-muted-text">
                Supporting documents
              </p>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {attachments.map((attachment) => (
                  <div
                    key={attachment.id}
                    className="flex min-w-0 items-center gap-3 rounded-xl border border-warm-border bg-card p-3 text-left text-warm-text transition-colors hover:border-clay"
                  >
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-clay-soft text-clay">
                      <Icon name="file" size={17} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[11px] font-bold">{attachment.file_name}</span>
                      <span className="mt-0.5 block text-[9px] text-muted-text">
                        {Math.max(1, Math.round(attachment.file_size / 1024))} KB
                        {attachment.file_type ? ` · ${attachment.file_type.split('/').pop()?.toUpperCase()}` : ''}
                      </span>
                    </span>
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setPreviewingAttachmentId((current) =>
                          current === attachment.id ? null : attachment.id
                        )}
                        aria-label={`${previewingAttachmentId === attachment.id ? 'Close preview of' : 'Preview'} ${attachment.file_name}`}
                        aria-pressed={previewingAttachmentId === attachment.id}
                        className={`grid h-9 w-9 place-items-center rounded-full transition-colors ${
                          previewingAttachmentId === attachment.id
                            ? 'bg-clay-soft text-clay'
                            : 'text-muted-text hover:bg-sidebar hover:text-warm-text'
                        }`}
                      >
                        <span className="text-sm" aria-hidden="true">⌕</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => void downloadAttachment(attachment)}
                        aria-label={`Download ${attachment.file_name}`}
                        className="grid h-9 w-9 place-items-center rounded-full text-muted-text transition-colors hover:bg-sidebar hover:text-warm-text"
                      >
                        <Icon name="download" size={15} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              {previewingAttachment && (
                <section className="mt-4 overflow-hidden rounded-xl border border-warm-border bg-card">
                  <header className="flex items-center justify-between gap-3 border-b border-warm-border px-4 py-3">
                    <div className="min-w-0">
                      <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-clay">Supporting document preview</p>
                      <h3 className="mt-1 truncate text-xs font-semibold text-warm-text">{previewingAttachment.file_name}</h3>
                    </div>
                    <button
                      type="button"
                      onClick={() => setPreviewingAttachmentId(null)}
                      aria-label="Close supporting document preview"
                      className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-warm-border text-muted-text hover:bg-sidebar"
                    >
                      <span aria-hidden="true">×</span>
                    </button>
                  </header>
                  <div className="relative flex h-[min(65vh,680px)] min-h-[360px] items-center justify-center overflow-auto bg-[#eae5df] p-4 md:p-6">
                    <FilePreview
                      file={{
                        file_name: previewingAttachment.file_name,
                        file_url: '',
                        file_path: previewingAttachment.file_path,
                        file_type: previewingAttachment.file_type,
                      }}
                    />
                  </div>
                </section>
              )}
            </div>
          )}
          <div id={`document-preview-${sub.id}`} hidden={!previewOpen}>
            {previewOpen && (
              <div className="relative flex h-[min(70vh,760px)] min-h-[540px] items-center justify-center overflow-auto bg-[#eae5df] p-5 md:p-8">
                <FilePreview file={sub} />
              </div>
            )}
          </div>
        </section>
      </section>

      {/* ── Main grid ── */}
      <div>
          {officeReview ? (
            <>
              <DocumentMessaging
                key={sub.id}
                submissionId={sub.id}
                fileName={sub.file_name}
                trackingNumber={sub.tracking_number ?? null}
                assignmentConversations={assignmentConversations}
                defaultAssignmentStepId={defaultAssignmentStepId}
                showSubmitterConversation={isResponsibleOffice}
                canSendSubmitterConversation={!requiresReviewStart && !isCompleted && !isRejected && !isWithdrawn && !isReturned && isResponsibleOffice}
                workflowComposer={{
                  recipients,
                  actionsByRecipient,
                  initialRecipient,
                  initialAction,
                  statusLine,
                  workflowStatus,
                  showStatusLine: false,
                  isClosed: composerClosed && !isAssignmentSender,
                  startReviewMessage: isResponsibleOffice
                    ? 'Start processing to receive this submission and change its status to In Process.'
                    : 'The submission is already In Process, but your office assignment is still pending. Start processing here to enable its action options.',
                  startReviewDisabled: !isResponsibleOffice && Boolean(routeStateError),
                  onStartReview: requiresReviewStart ? startOfficeReview : undefined,
                  isOfficeWorkspace: true,
                  activeAssignmentStepId: activeRouteStep?.id ?? null,
                  showWorkflowActions: isResponsibleOffice || isRecipientOffice,
                  actionSectionId: `office-workflow-action-${sub.id}`,
                  closedMessage: requiresReviewStart
                    ? 'Start processing when your office is ready to begin.'
                    : historicalRecipientView
                    ? 'This assignment is no longer active. You can still review its files and messages.'
                    : isRejected
                      ? 'This submission was rejected.'
                      : isWithdrawn
                      ? 'This submission is withdrawn.'
                      : isReturned
                      ? 'This submission was returned to the submitter for redirection.'
                      : 'This submission is completed.',
                  busy: updating,
                  pendingAssignmentCount,
                  sourceDocument: {
                    filePath: sub.file_path ?? null,
                    fileType: sub.file_type,
                    fileSize: sub.file_size,
                  },
                  onWorkflowAction: handleWorkflowAction,
                  onForwarded: async () => {
                    await fetchDetails();
                  },
                }}
                activity={(
                  <WorkflowActivityTimeline
                    events={auditLogs.map((log) => ({
                      id: log.id,
                      actionType: log.action_type,
                      label: getActionLabel(log.action_type),
                      createdAt: log.created_at,
                      actor: log.profiles?.full_name || 'System',
                      actorRole: getActorRoleLabel(log.profiles?.role),
                      comments: log.comments,
                    }))}
                  />
                )}
              />
            </>
          ) : (
            <div className="flex min-h-64 items-center justify-center rounded-2xl border border-warm-border bg-card p-6 text-center text-xs text-muted-text">
              This submission is not assigned to your office.
            </div>
          )}
    </div>
    </div>
  );
}
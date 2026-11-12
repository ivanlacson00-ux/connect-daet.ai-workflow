'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useParams, useRouter } from 'next/navigation';
import QRCode from 'qrcode';
import { createClient } from '@/lib/supabase/client';
import DocumentMessaging from '@/components/DocumentMessaging';
import WorkflowActivityTimeline from '@/components/WorkflowActivityTimeline';
import FilePreview, { downloadFile, getFileUrl } from '@/components/FilePreview';
import {
  getWorkflowDocumentTypeLabel,
  isOfficeRole,
  OFFICE_CONFIG,
  type OfficeRole,
} from '@/lib/workflow/offices';
import { getSubmissionStatusLabel, getSubmissionStatusTone } from '@/lib/workflow/status';
import {
  getWorkflowFileMimeType,
  getWorkflowFilesTypeError,
  WORKFLOW_DOCUMENT_ACCEPT,
} from '@/lib/workflow/file-types';

const fonts = {
  serif: 'font-serif',
};

interface Submission {
  id: string;
  tracking_number: string;
  file_name: string;
  file_url: string;
  file_path?: string | null;
  file_type: string;
  file_size: number;
  status: string;
  category: string;
  other_document_type?: string | null;
  description: string;
  intended_recipient?: string | null;
  initial_destination_role?: string | null;
  selected_office_role?: string | null;
  closed_by?: string | null;
  closure_note?: string | null;
  closure_file_path?: string | null;
  closure_file_name?: string | null;
  closure_file_type?: string | null;
  closure_file_size?: number | null;
  office_comments?: string | null;
  mayor_comments?: string | null;
  sender_response?: string | null;
  approver_comments: string;
  admin_comments: string;
  rejection_comment: string;
  created_at: string;
  received_at?: string | null;
  completed_at?: string | null;
}

interface Attachment {
  id: string;
  file_name: string;
  file_path: string;
  file_type: string | null;
  file_size: number;
}

interface AuditLog {
  id: string;
  action_type: string;
  old_status: string | null;
  new_status: string | null;
  comments: string | null;
  created_at: string;
  profiles?: { full_name: string | null; role: string | null } | { full_name: string | null; role: string | null }[] | null;
}

interface RetrievalQr {
  retrieval_token: string;
  expires_at: string;
  retrieval_status: string;
}

export default function UserFileDetail() {
  const { id } = useParams();
  const router = useRouter();
  const [sub, setSub] = useState<Submission | null>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [savingResponse, setSavingResponse] = useState(false);
  const [changeResponse, setChangeResponse] = useState('');
  const [revisedDocument, setRevisedDocument] = useState<File | null>(null);
  const [withdrawalReason, setWithdrawalReason] = useState('');
  const [actionError, setActionError] = useState('');
  const [closureActor, setClosureActor] = useState<string | null>(null);
  const [redirectOffice, setRedirectOffice] = useState<OfficeRole | ''>('');
  const [redirectDocumentType, setRedirectDocumentType] = useState('');
  const [redirectOtherDocumentType, setRedirectOtherDocumentType] = useState('');
  const [savingRedirect, setSavingRedirect] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const [retrievalQr, setRetrievalQr] = useState<RetrievalQr | null>(null);
  const [qrImage, setQrImage] = useState('');
  const [qrLoading, setQrLoading] = useState(false);
  const [qrError, setQrError] = useState('');
  const [qrOriginWarning, setQrOriginWarning] = useState('');
  const [loading, setLoading] = useState(true);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [supportingAttachmentsOpen, setSupportingAttachmentsOpen] = useState(false);
  const [previewingAttachmentId, setPreviewingAttachmentId] = useState<string | null>(null);
  const revisedDocumentInput = useRef<HTMLInputElement>(null);
  const supabase = useMemo(() => createClient(), []);

  const fetchSubmission = useCallback(async (preserveCurrent = false) => {
    if (!preserveCurrent) {
      setLoading(true);
      setSub(null);
    }
    setRetrievalQr(null);
    setQrImage('');
    setQrError('');
    try {
      const { data, error } = await supabase
        .from('workflow_submissions')
        .select('*')
        .eq('id', id)
        .single();

      if (error) {
        console.error('Submission load failed:', error.message);
        if (preserveCurrent) setActionError('The action succeeded, but the submission did not refresh. Reload this page to see the latest status.');
      }
      if (data) {
        setSub(data);
        if (data.closed_by) {
          const { data: closer, error: closerError } = await supabase
            .from('profiles')
            .select('full_name')
            .eq('id', data.closed_by)
            .maybeSingle();
          if (closerError) console.error('Could not load closure actor:', closerError.message);
          setClosureActor(closer?.full_name ?? null);
        } else {
          setClosureActor(null);
        }
        if (data.status === 'completed' || data.status === 'approved') {
          const { data: qrData, error: qrLoadError } = await supabase.rpc(
            'get_workflow_retrieval_qr',
            { target_submission_id: id }
          );
          if (qrLoadError) {
            console.error('Retrieval QR load failed:', qrLoadError.message);
            setQrError('Could not load this request’s retrieval QR code. Please refresh and try again.');
          } else {
            const existingQr = Array.isArray(qrData) ? qrData[0] : qrData;
            setRetrievalQr(existingQr ?? null);
            setQrError('');
          }
        } else {
          setRetrievalQr(null);
          setQrError('');
        }
        const [
          { data: attachmentRows, error: attachmentError },
          { data: logs, error: logsError },
        ] = await Promise.all([
          supabase
            .from('workflow_submission_attachments')
            .select('id, file_name, file_path, file_type, file_size')
            .eq('submission_id', id)
            .order('created_at', { ascending: true }),
          supabase
            .from('workflow_audit_logs')
            .select('id, action_type, old_status, new_status, comments, created_at, profiles:action_by (full_name, role)')
            .eq('submission_id', id)
            .order('created_at', { ascending: true }),
        ]);
        if (attachmentError) console.error('Attachment load failed:', attachmentError.message);
        if (logsError) console.error('Workflow history load failed:', logsError.message);
        setAttachments(attachmentRows ?? []);
        setAuditLogs(logs ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, [id, supabase]);

  useEffect(() => {
    void fetchSubmission();
  }, [fetchSubmission]);

  useEffect(() => {
    let active = true;
    if (!retrievalQr || retrievalQr.retrieval_status !== 'active') {
      setQrImage('');
      return;
    }

    const appOrigin = process.env.NEXT_PUBLIC_APP_URL?.trim() || window.location.origin;
    let retrievalUrl: URL;
    try {
      retrievalUrl = new URL('/workflow/retrieval', appOrigin);
      if (!['http:', 'https:'].includes(retrievalUrl.protocol)) {
        throw new Error('The application URL must use HTTP or HTTPS.');
      }
    } catch (error) {
      console.error('Retrieval QR application URL is invalid:', error);
      if (active) setQrError('The QR code could not be generated because the application URL is invalid. Configure NEXT_PUBLIC_APP_URL.');
      return () => {
        active = false;
      };
    }

    const hostname = retrievalUrl.hostname.toLowerCase();
    const isLocalHost = hostname === 'localhost'
      || hostname === '127.0.0.1'
      || hostname === '0.0.0.0'
      || hostname === '::1';
    if (active) {
      setQrOriginWarning(isLocalHost
        ? 'This QR points to localhost and will only open on this computer. Set NEXT_PUBLIC_APP_URL to an address officers can reach, then refresh this page.'
        : '');
    }
    retrievalUrl.hash = new URLSearchParams({ token: retrievalQr.retrieval_token }).toString();

    QRCode.toDataURL(retrievalUrl.toString(), {
      errorCorrectionLevel: 'M',
      margin: 4,
      width: 420,
    }).then((dataUrl) => {
      if (active) setQrImage(dataUrl);
    }).catch((error: unknown) => {
      console.error('Retrieval QR rendering failed:', error);
      if (active) setQrError('Could not render the QR code. Please try again.');
    });

    return () => {
      active = false;
    };
  }, [retrievalQr]);

  const generateRetrievalQr = async () => {
    if (!sub) return;
    setQrLoading(true);
    setQrError('');
    try {
      const { data, error } = await supabase.rpc('create_workflow_retrieval_qr', {
        target_submission_id: sub.id,
      });
      if (error) throw error;

      const createdQr = Array.isArray(data) ? data[0] : data;
      if (!createdQr?.retrieval_token || !createdQr?.expires_at) {
        throw new Error('The system did not return a valid retrieval QR code.');
      }
      setRetrievalQr(createdQr);
    } catch (error) {
      console.error('Retrieval QR generation failed:', error);
      setQrError(error instanceof Error ? error.message : 'Could not generate the QR code. Please try again.');
    } finally {
      setQrLoading(false);
    }
  };

  const downloadRetrievalQr = () => {
    if (!qrImage || !sub) return;
    const link = document.createElement('a');
    link.href = qrImage;
    link.download = `${sub.tracking_number || 'request'}-retrieval-qr.png`;
    link.click();
  };

  const submitRequirementsResponse = async (response: string, revisedDocument: File | null) => {
    if (!sub) throw new Error('Submission is unavailable.');
    if (!response.trim()) throw new Error('Enter a response before resubmitting.');
    const fileError = revisedDocument ? getWorkflowFilesTypeError([revisedDocument], false) : null;
    if (fileError) throw new Error(fileError);
    if (revisedDocument && revisedDocument.size > 10 * 1024 * 1024) {
      throw new Error('The revised document must be 10 MB or smaller.');
    }
    setSavingResponse(true);
    setActionError('');
    const uploadedPaths: string[] = [];
    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError || !user) throw userError ?? new Error('You must sign in to respond.');

      let revisedFilePath: string | null = null;
      let revisedFileUrl: string | null = null;
      let revisedFileType: string | null = null;
      if (revisedDocument) {
        revisedFileType = getWorkflowFileMimeType(revisedDocument.name);
        if (!revisedFileType) throw new Error('The revised document type is not supported.');
        const safeRevisedName = revisedDocument.name.replace(/[^\w.-]/g, '_');
        revisedFilePath = `${user.id}/${crypto.randomUUID()}-revised-${safeRevisedName}`;
        const { error: revisedUploadError } = await supabase.storage
          .from('workflow_uploads')
          .upload(revisedFilePath, revisedDocument, {
            contentType: revisedFileType,
            upsert: false,
          });
        if (revisedUploadError) throw revisedUploadError;
        uploadedPaths.push(revisedFilePath);
        revisedFileUrl = supabase.storage
          .from('workflow_uploads')
          .getPublicUrl(revisedFilePath).data.publicUrl;
      }

      const { error: responseError } = await supabase.rpc(
        'respond_to_workflow_submission_changes',
        {
          target_submission_id: sub.id,
          sender_comments: response.trim(),
          revised_file_path: revisedFilePath,
          revised_file_url: revisedFileUrl,
          revised_file_name: revisedDocument?.name ?? null,
          revised_file_type: revisedFileType,
          revised_file_size: revisedDocument?.size ?? null,
        }
      );
      if (responseError) throw responseError;
      await fetchSubmission(true);
    } catch (error) {
      console.error('Requirements response failed:', error);
      if (uploadedPaths.length) {
        const { error } = await supabase.storage.from('workflow_uploads').remove(uploadedPaths);
        if (error) console.error('Attachment file cleanup failed:', error.message);
      }
      throw error instanceof Error ? error : new Error('Could not submit your response.');
    } finally {
      setSavingResponse(false);
    }
  };

  const redirectReturnedSubmission = async () => {
    if (!sub || !isOfficeRole(redirectOffice) || !redirectDocumentType) throw new Error('Choose a destination office and document type.');
    if (redirectDocumentType === 'Other' && !redirectOtherDocumentType.trim()) {
      throw new Error('Enter the custom document type.');
    }

    setSavingRedirect(true);
    setActionError('');
    try {
      const { error } = await supabase.rpc('redirect_workflow_submission', {
        target_submission_id: sub.id,
        target_office_role: redirectOffice,
        new_document_type: redirectDocumentType,
        new_other_document_type: redirectDocumentType === 'Other'
          ? redirectOtherDocumentType.trim()
          : null,
      });
      if (error) throw error;
      setRedirectOffice('');
      setRedirectDocumentType('');
      setRedirectOtherDocumentType('');
      await fetchSubmission(true);
    } catch (error) {
      console.error('Submission redirect failed:', error);
      throw error instanceof Error ? error : new Error('Could not redirect this submission.');
    } finally {
      setSavingRedirect(false);
    }
  };

  const withdrawSubmission = async (reason: string) => {
    if (!sub) throw new Error('Submission is unavailable.');
    setWithdrawing(true);
    setActionError('');
    try {
      const { error } = await supabase.rpc('withdraw_workflow_submission', {
        target_submission_id: sub.id,
        withdrawal_reason: reason.trim() || null,
      });
      if (error) throw error;
      await fetchSubmission(true);
    } catch (error) {
      console.error('Submission withdrawal failed:', error);
      throw error instanceof Error ? error : new Error('Could not withdraw this submission.');
    } finally {
      setWithdrawing(false);
    }
  };

  const handleRequirementsSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setActionError('');
    try {
      await submitRequirementsResponse(changeResponse, revisedDocument);
      setChangeResponse('');
      setRevisedDocument(null);
      if (revisedDocumentInput.current) revisedDocumentInput.current.value = '';
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not submit your response.');
    }
  };

  const handleRedirectSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setActionError('');
    try {
      await redirectReturnedSubmission();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not redirect this submission.');
    }
  };

  const handleWithdrawSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!window.confirm('Withdraw this submission? You cannot undo this action.')) return;
    setActionError('');
    try {
      await withdrawSubmission(withdrawalReason);
      setWithdrawalReason('');
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not withdraw this submission.');
    }
  };

  const getStatusStyles = (status: string) => {
    const tone = getSubmissionStatusTone(status);
    const classes = tone === 'completed'
      ? 'bg-approved-bg text-approved-text'
      : tone === 'progress'
        ? 'bg-review-bg text-review-text'
        : tone === 'returned' || tone === 'pending'
          ? 'bg-pending-bg text-pending-text'
          : tone === 'withdrawn'
            ? 'bg-sidebar text-muted-text'
            : 'bg-sidebar text-muted-text';
    return { label: getSubmissionStatusLabel(status), classes };
  };

  const getWorkflowActionLabel = (actionType: string) => {
    switch (actionType) {
      case 'DESTINATION_SELECTED': return 'Destination selected by submitter';
      case 'SUBMITTED': return 'Submission submitted';
      case 'SUBMISSION_REDIRECTED': return 'Submission redirected to a new office';
      case 'SUBMISSION_RECEIVED': return 'Received by responsible office';
      case 'SUBMISSION_FORWARDED': return 'Recommendation requested';
      case 'ASSIGNMENT_COMPLETED': return 'Office assignment completed';
      case 'ASSIGNMENT_RETURNED': return 'Office assignment returned';
      case 'ASSIGNMENT_WITHDRAWN': return 'Office assignment withdrawn';
      case 'CHANGES_REQUESTED': return 'Changes requested';
      case 'CHANGES_RESPONDED': return 'Response to requested changes submitted';
      case 'RETURNED_TO_SUBMITTER': return 'Returned to submitter for redirection';
      case 'SUBMISSION_WITHDRAWN': return 'Submission withdrawn';
      case 'SUBMISSION_CLOSED': return 'Submission completed';
      case 'SUBMISSION_REOPENED': return 'Submission reopened';
      case 'FILE_VERSION_ADDED': return 'Document version added';
      case 'ROUTE_PROPOSED': return 'Tourism Officer proposed office route';
      case 'OFFICE_ROUTE_STEP_ASSIGNED': return 'Assigned to municipal office';
      case 'OFFICE_ROUTE_STEP_APPROVED': return 'Municipal office approved';
      case 'OFFICE_ASSIGNMENT_COMPLETED': return 'Municipal office assignment completed';
      case 'OFFICE_ASSIGNMENT_FORWARDED': return 'Recommendation requested from another office';
      case 'OFFICE_FORWARDED_TO_TOURISM_OFFICER': return 'Sent to Tourism Officer for review';
      case 'TOURISM_OFFICER_ASSIGNMENTS_CREATED': return 'Tourism Officer assigned additional offices';
      case 'TOURISM_OFFICER_ASSIGNMENTS_COMPLETED': return 'Additional office assignments completed';
      case 'OFFICE_FINAL_DECISION': return 'Final decision by authorized office';
      case 'ROUTE_RETURNED_TO_ADMIN': return 'All routed offices approved; returned to Admin';
      case 'ROUTE_REQUIREMENTS_REQUESTED': return 'Municipal office requested additional requirements';
      case 'REQUIREMENTS_RESUBMITTED': return 'Response to requested changes submitted';
      case 'REVISED_DOCUMENT_SUBMITTED': return 'Revised document uploaded';
      case 'WORKFLOW_COMPLETED': return 'Request completed';
      case 'RETRIEVAL_QR_SCANNED': return 'Retrieval QR code scanned';
      case 'RETRIEVAL_LOCATION_UPDATED': return 'Physical storage location updated';
      case 'DOCUMENT_RELEASED': return 'Document released to requester';
      default: return actionType.replaceAll('_', ' ').toLowerCase();
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
        <div className="rounded-2xl border border-rejected-bg bg-rejected-bg/50 px-5 py-8 text-xs font-semibold text-rejected-text">
          Submission not found.
        </div>
      </div>
    );
  }

  const statusConfig = getStatusStyles(sub.status);

  const isCompleted = sub.status === 'completed' || sub.status === 'approved';
  const isWithdrawn = sub.status === 'withdrawn';
  const isRedirectable = sub.status === 'returned';
  const canWithdraw = sub.status === 'submitted' && !sub.received_at;
  const lastClosure = [...auditLogs].reverse().find((log) => log.action_type === 'SUBMISSION_CLOSED');
  const canReopen = sub.status === 'completed' && lastClosure?.old_status === 'changes_requested';
  const canRespondToChanges = sub.status === 'changes_requested' || canReopen;
  const currentDestinationRole = sub.selected_office_role ?? sub.initial_destination_role ?? null;
  const currentDestinationLabel = isOfficeRole(currentDestinationRole)
    ? OFFICE_CONFIG[currentDestinationRole].label
    : 'Not selected';
  const initialDestinationRole = sub.initial_destination_role ?? null;
  const showFeedback = isCompleted || sub.status.includes('declined');
  const officialNote = sub.mayor_comments || sub.office_comments || sub.admin_comments || sub.rejection_comment || sub.approver_comments;
  const isApproved = isCompleted;
  const requirementsRequest = [...auditLogs]
    .reverse()
    .find((log) => ['CHANGES_REQUESTED', 'ROUTE_REQUIREMENTS_REQUESTED'].includes(log.action_type));

  const downloadAttachment = async (attachment: Attachment) => {
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

  const downloadOriginal = async () => {
    if (!sub) return;
    try {
      const url = await getFileUrl(supabase, sub);
      await downloadFile(url, sub.file_name);
    } catch (error) {
      console.error('Could not download the original document:', error);
      setActionError('Could not download the original document. Please try again.');
    }
  };

  const previewingAttachment = attachments.find((attachment) => attachment.id === previewingAttachmentId);

  return (
    <div className="mx-auto w-full max-w-[1500px] pb-8">
      <div className="mb-5 max-md:mb-4">
        <button
          type="button"
          onClick={() => router.push('/workflow/user/file_registry')}
          className="inline-flex items-center gap-2 text-xs font-semibold text-muted-text transition-colors hover:text-clay"
        >
          <span className="grid h-8 w-8 place-items-center rounded-full border border-warm-border bg-card" aria-hidden="true">←</span>
          Back to files
        </button>
      </div>

      <section className="mb-5 overflow-hidden rounded-2xl border border-warm-border bg-card shadow-[0_12px_35px_rgba(65,49,39,0.05)]">
        <div className="flex flex-col gap-5 p-5 md:flex-row md:items-center md:justify-between md:p-7">
          <div className="min-w-0">
            <div className="mb-3 flex flex-wrap items-center gap-2.5">
              <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[11px] font-bold ${statusConfig.classes}`}>
                <span className={`h-1.5 w-1.5 rounded-full bg-current ${isCompleted || isWithdrawn ? 'opacity-70' : 'animate-pulse'}`} />
                {statusConfig.label}
              </span>
              <span className="text-[11px] font-medium text-muted-text">
                Submission ID: {sub.id.split('-')[0]}
              </span>
              {isOfficeRole(currentDestinationRole) && (
                <span className="text-[11px] font-medium text-muted-text">
                  · {OFFICE_CONFIG[currentDestinationRole].label}
                </span>
              )}
            </div>
            <h1 className={`${fonts.serif} max-w-4xl break-words text-[28px] font-semibold leading-[1.15] tracking-[-0.02em] text-warm-text md:text-[36px]`}>
              {sub.file_name}
            </h1>
            <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-[11px] text-muted-text">
              <span>Submitted {new Date(sub.created_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</span>
              <span>{sub.file_type || 'File'} · {sub.file_size ? `${(sub.file_size / 1024).toFixed(2)} KB` : 'Size unavailable'}</span>
            </div>
          </div>
          <div className="shrink-0 rounded-xl border border-warm-border bg-white px-5 py-3.5 md:text-right">
            <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-muted-text">Tracking number</p>
            <p className="font-mono text-sm font-bold tracking-[0.08em] text-clay">
              {sub.tracking_number || 'Pending'}
            </p>
          </div>
        </div>

        <section className="border-t border-warm-border px-5 py-6 md:px-7">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-clay">Submission context</p>
              <h2 className="mt-1 font-serif text-xl font-semibold text-warm-text">Request details</h2>
            </div>
            <span className="rounded-full bg-clay-soft px-3 py-1.5 text-[10px] font-bold text-clay">
              {getWorkflowDocumentTypeLabel(sub.category, sub.other_document_type)}
            </span>
          </div>
          <div className="grid gap-x-8 gap-y-5 md:grid-cols-2">
            <div>
              <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-muted-text">Intended recipient</p>
              <p className="text-xs font-semibold text-warm-text">{sub.intended_recipient || 'Not specified.'}</p>
            </div>
            {currentDestinationRole && (
              <div>
                <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-muted-text">Responsible office</p>
                <p className="text-xs font-semibold text-warm-text">{currentDestinationLabel}</p>
                {isOfficeRole(initialDestinationRole) && initialDestinationRole !== currentDestinationRole && (
                  <p className="mt-1 text-[10px] text-muted-text">
                    Originally selected: {OFFICE_CONFIG[initialDestinationRole].label}
                  </p>
                )}
              </div>
            )}
            <div className="md:col-span-2">
              <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-muted-text">Description</p>
              <blockquote className="whitespace-pre-wrap break-words border-l-2 border-clay pl-3 font-serif text-[14px] italic leading-relaxed text-warm-text/75">
                {sub.description || 'No description provided.'}
              </blockquote>
            </div>
          </div>
        </section>

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
              <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full border border-warm-border text-muted-text transition-transform ${previewOpen ? 'rotate-90' : ''}`} aria-hidden="true">
                ›
              </span>
            </button>
            <button
              type="button"
              onClick={() => void downloadOriginal()}
              aria-label={`Download ${sub.file_name}`}
              className="inline-flex h-9 shrink-0 items-center gap-2 rounded-full border border-warm-border px-3.5 text-[11px] font-bold text-warm-text hover:bg-sidebar"
            >
              <span aria-hidden="true">↓</span>
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
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="m20 11-8.5 8.5a5 5 0 0 1-7-7L14 3a3.5 3.5 0 0 1 5 5l-9.5 9.5a2 2 0 0 1-3-3L15 6" />
                </svg>
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
              <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.12em] text-muted-text">Supporting documents</p>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {attachments.map((attachment) => (
                  <div key={attachment.id} className="flex min-w-0 items-center gap-3 rounded-xl border border-warm-border bg-card p-3 text-warm-text">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-clay-soft text-clay" aria-hidden="true">▤</span>
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
                        onClick={() => setPreviewingAttachmentId((current) => current === attachment.id ? null : attachment.id)}
                        aria-label={`${previewingAttachmentId === attachment.id ? 'Close preview of' : 'Preview'} ${attachment.file_name}`}
                        aria-pressed={previewingAttachmentId === attachment.id}
                        className={`grid h-9 w-9 place-items-center rounded-full transition-colors ${
                          previewingAttachmentId === attachment.id ? 'bg-clay-soft text-clay' : 'text-muted-text hover:bg-sidebar hover:text-warm-text'
                        }`}
                      >
                        <span aria-hidden="true">⌕</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => void downloadAttachment(attachment)}
                        aria-label={`Download ${attachment.file_name}`}
                        className="grid h-9 w-9 place-items-center rounded-full text-muted-text transition-colors hover:bg-sidebar hover:text-warm-text"
                      >
                        <span aria-hidden="true">↓</span>
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
                      ×
                    </button>
                  </header>
                  <div className="relative flex h-[min(65vh,680px)] min-h-[360px] items-center justify-center overflow-auto bg-[#eae5df] p-4 md:p-6">
                    <FilePreview file={{
                      file_name: previewingAttachment.file_name,
                      file_url: '',
                      file_path: previewingAttachment.file_path,
                      file_type: previewingAttachment.file_type,
                    }} />
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

      <DocumentMessaging
        key={sub.id}
        submissionId={sub.id}
        fileName={sub.file_name}
        trackingNumber={sub.tracking_number}
        canSendSubmitterConversation={!isCompleted && !isWithdrawn}
        afterSharedFiles={(
          <section className={`overflow-hidden rounded-2xl border ${
            showFeedback && officialNote
              ? isApproved
                ? 'border-approved-bg bg-approved-bg/40'
                : 'border-rejected-bg bg-rejected-bg/40'
              : 'border-clay/30 bg-clay-soft/40'
          }`}>
            <header className="flex flex-wrap items-center justify-between gap-3 border-b border-current/10 px-5 py-4 md:px-6">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-clay">Review update</p>
                <h2 className="mt-1 text-sm font-bold text-warm-text">Official feedback</h2>
              </div>
              <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${
                showFeedback && officialNote
                  ? isApproved
                    ? 'bg-approved-bg text-approved-text'
                    : 'bg-rejected-bg text-rejected-text'
                  : 'bg-card text-muted-text'
              }`}>
                {showFeedback && officialNote ? 'From the responsible office' : 'Awaiting review'}
              </span>
            </header>
            <div className="px-5 py-4 md:px-6">
              {showFeedback && officialNote ? (
                <p className="whitespace-pre-wrap break-words font-serif text-sm leading-relaxed text-warm-text">
                  {officialNote}
                </p>
              ) : (
                <p className="text-xs leading-relaxed text-muted-text">
                  The responsible office’s decision and feedback will appear here after it completes its review.
                </p>
              )}
            </div>
          </section>
        )}
        activity={(
          <WorkflowActivityTimeline
            emptyMessage="No workflow events recorded yet."
            events={auditLogs.map((log) => {
              const profile = Array.isArray(log.profiles) ? log.profiles[0] : log.profiles;
              return {
                id: log.id,
                actionType: log.action_type,
                label: getWorkflowActionLabel(log.action_type),
                createdAt: log.created_at,
                actor: profile?.full_name || 'System',
                actorRole: profile?.role,
                comments: log.comments,
              };
            })}
          />
        )}
      />

      {(canRespondToChanges || isRedirectable || canWithdraw) && (
        <section className="mt-5 overflow-hidden rounded-2xl border border-warm-border bg-card">
          <header className="border-b border-warm-border px-5 py-4 md:px-6">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-clay">Submission actions</p>
            <h2 className="mt-1 font-serif text-xl font-semibold text-warm-text">What would you like to do?</h2>
            <p className="mt-1.5 text-[11px] leading-relaxed text-muted-text">
              These actions are available based on the current status of your submission.
            </p>
          </header>
          <div className="grid gap-4 bg-[#f8f5f1] p-5 md:grid-cols-2 md:p-6">
            {canRespondToChanges && (
              <form onSubmit={(event) => void handleRequirementsSubmit(event)} className="space-y-3 rounded-xl border border-warm-border bg-card p-4 md:col-span-2">
                <div>
                  <h3 className="text-xs font-semibold text-warm-text">{canReopen ? 'Reopen and resubmit' : 'Respond to requested changes'}</h3>
                  <p className="mt-1 text-[11px] leading-relaxed text-muted-text">
                    {requirementsRequest?.comments || sub.office_comments || sub.mayor_comments || 'The responsible office has requested changes to your submission.'}
                  </p>
                </div>
                <label htmlFor={`changes-response-${sub.id}`} className="block text-[10px] font-bold uppercase tracking-[0.1em] text-muted-text">
                  Your response <span className="text-rejected-text">*</span>
                  <textarea
                    id={`changes-response-${sub.id}`}
                    value={changeResponse}
                    onChange={(event) => setChangeResponse(event.target.value)}
                    required
                    maxLength={5000}
                    rows={4}
                    disabled={savingResponse}
                    className="mt-1.5 block min-h-24 w-full resize-y rounded-xl border border-warm-border bg-white p-3 text-xs font-normal normal-case leading-relaxed tracking-normal text-warm-text outline-none focus:border-clay focus:ring-2 focus:ring-clay/15 disabled:opacity-60"
                    placeholder="Explain how you addressed the requested changes."
                  />
                </label>
                <label htmlFor={`revised-document-${sub.id}`} className="block text-[10px] font-bold uppercase tracking-[0.1em] text-muted-text">
                  Revised document <span className="font-normal normal-case tracking-normal">(optional)</span>
                  <input
                    ref={revisedDocumentInput}
                    id={`revised-document-${sub.id}`}
                    type="file"
                    accept={WORKFLOW_DOCUMENT_ACCEPT}
                    disabled={savingResponse}
                    onChange={(event) => setRevisedDocument(event.target.files?.[0] ?? null)}
                    className="mt-1.5 block w-full rounded-xl border border-warm-border bg-white p-2 text-xs font-normal normal-case tracking-normal text-warm-text file:mr-3 file:rounded-full file:border-0 file:bg-clay-soft file:px-3 file:py-1.5 file:text-[10px] file:font-semibold file:text-clay"
                  />
                  <span className="mt-1 block font-normal normal-case tracking-normal">Supported document formats, up to 10 MB.</span>
                </label>
                <button
                  type="submit"
                  disabled={savingResponse || !changeResponse.trim()}
                  className="inline-flex h-10 items-center justify-center rounded-full bg-clay px-5 text-xs font-semibold text-white transition-colors hover:bg-warm-text disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {savingResponse ? 'Submitting response...' : 'Submit changes'}
                </button>
              </form>
            )}

            {isRedirectable && (
              <form onSubmit={(event) => void handleRedirectSubmit(event)} className="space-y-3 rounded-xl border border-warm-border bg-card p-4">
                <div>
                  <h3 className="text-xs font-semibold text-warm-text">Redirect submission</h3>
                  <p className="mt-1 text-[11px] leading-relaxed text-muted-text">
                    Choose the correct office. Your existing document will be sent with the redirected submission.
                  </p>
                </div>
                <label className="block text-[10px] font-bold uppercase tracking-[0.1em] text-muted-text">
                  Destination office
                  <select
                    aria-label="New destination office"
                    value={redirectOffice}
                    onChange={(event) => {
                      const value = event.target.value;
                      setRedirectOffice(isOfficeRole(value) ? value : '');
                      setRedirectDocumentType('');
                      setRedirectOtherDocumentType('');
                    }}
                    disabled={savingRedirect}
                    className="mt-1.5 block h-10 w-full rounded-xl border border-warm-border bg-white px-3 text-xs font-medium normal-case tracking-normal text-warm-text outline-none focus:border-clay"
                  >
                    <option value="">Select an office</option>
                    {Object.entries(OFFICE_CONFIG).map(([officeRole, office]) => (
                      <option key={officeRole} value={officeRole}>{office.label}</option>
                    ))}
                  </select>
                </label>
                <label className="block text-[10px] font-bold uppercase tracking-[0.1em] text-muted-text">
                  Document type
                  <select
                    aria-label="Redirect document type"
                    value={redirectDocumentType}
                    onChange={(event) => {
                      setRedirectDocumentType(event.target.value);
                      setRedirectOtherDocumentType('');
                    }}
                    disabled={savingRedirect || !isOfficeRole(redirectOffice)}
                    className="mt-1.5 block h-10 w-full rounded-xl border border-warm-border bg-white px-3 text-xs font-medium normal-case tracking-normal text-warm-text outline-none focus:border-clay"
                  >
                    <option value="">Select a document type</option>
                    {isOfficeRole(redirectOffice) && OFFICE_CONFIG[redirectOffice].categories.map((category) => (
                      <option key={category} value={category}>{category}</option>
                    ))}
                  </select>
                </label>
                {redirectDocumentType === 'Other' && (
                  <label className="block text-[10px] font-bold uppercase tracking-[0.1em] text-muted-text">
                    Describe the document type
                    <input
                      value={redirectOtherDocumentType}
                      onChange={(event) => setRedirectOtherDocumentType(event.target.value)}
                      maxLength={120}
                      disabled={savingRedirect}
                      className="mt-1.5 block h-10 w-full rounded-xl border border-warm-border bg-white px-3 text-xs font-medium normal-case tracking-normal text-warm-text outline-none focus:border-clay"
                    />
                  </label>
                )}
                <button
                  type="submit"
                  disabled={savingRedirect || !isOfficeRole(redirectOffice) || !redirectDocumentType || (redirectDocumentType === 'Other' && !redirectOtherDocumentType.trim())}
                  className="inline-flex h-10 items-center justify-center rounded-full bg-clay px-5 text-xs font-semibold text-white transition-colors hover:bg-warm-text disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {savingRedirect ? 'Redirecting...' : 'Redirect submission'}
                </button>
              </form>
            )}

            {canWithdraw && (
              <form onSubmit={(event) => void handleWithdrawSubmit(event)} className="space-y-3 rounded-xl border border-pending-bg bg-card p-4">
                <div>
                  <h3 className="text-xs font-semibold text-warm-text">Withdraw submission</h3>
                  <p className="mt-1 text-[11px] leading-relaxed text-muted-text">
                    Available only before the responsible office receives it. Any pending office assignments will also be withdrawn.
                  </p>
                </div>
                <label htmlFor={`withdrawal-reason-${sub.id}`} className="block text-[10px] font-bold uppercase tracking-[0.1em] text-muted-text">
                  Reason <span className="font-normal normal-case tracking-normal">(optional)</span>
                  <textarea
                    id={`withdrawal-reason-${sub.id}`}
                    value={withdrawalReason}
                    onChange={(event) => setWithdrawalReason(event.target.value)}
                    maxLength={1000}
                    rows={3}
                    disabled={withdrawing}
                    className="mt-1.5 block min-h-20 w-full resize-y rounded-xl border border-warm-border bg-white p-3 text-xs font-normal normal-case leading-relaxed tracking-normal text-warm-text outline-none focus:border-clay focus:ring-2 focus:ring-clay/15 disabled:opacity-60"
                    placeholder="Optional reason for withdrawing."
                  />
                </label>
                <button
                  type="submit"
                  disabled={withdrawing}
                  className="inline-flex h-10 items-center justify-center rounded-full border border-pending-text bg-pending-bg px-5 text-xs font-semibold text-pending-text transition-colors hover:bg-pending-bg/70 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {withdrawing ? 'Withdrawing...' : 'Withdraw submission'}
                </button>
              </form>
            )}
          </div>
        </section>
      )}
      {actionError && (
        <p role="alert" className="mt-4 rounded-xl border border-rejected-bg bg-rejected-bg/50 px-4 py-3 text-xs font-medium text-rejected-text">
          {actionError}
        </p>
      )}

      <div className="mt-5">
        <section className="rounded-2xl border border-warm-border bg-card p-5 md:p-6">
          <div className="mb-4">
            <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-clay">For your records</p>
            <h2 className="mt-1 font-serif text-xl font-semibold text-warm-text">Document retrieval</h2>
          </div>
          <p className="mb-4 text-[11px] leading-relaxed text-muted-text">
            Generate a secure QR code to present when collecting your processed document.
          </p>
          {retrievalQr?.retrieval_status === 'released' ? (
            <p className="rounded-xl bg-approved-bg px-3 py-3 text-xs font-semibold text-approved-text">
              This document has been released.
            </p>
          ) : !isApproved ? (
            <p className="rounded-xl bg-sidebar px-3 py-3 text-xs text-muted-text">
              A retrieval QR code will be available after processing is complete.
            </p>
          ) : retrievalQr?.retrieval_status === 'active' ? (
            <div className="retrieval-qr-print rounded-xl border border-warm-border bg-white p-4 text-center">
              {qrImage ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={qrImage}
                  alt={`Retrieval QR code for ${sub.tracking_number}`}
                  className="mx-auto h-64 w-64 max-w-full"
                />
              ) : (
                <p className="py-12 text-xs text-muted-text">Preparing QR code...</p>
              )}
              <p className="mt-2 text-sm font-bold text-warm-text">Reference number: {sub.tracking_number}</p>
              <p className="mt-2 text-xs text-warm-text">
                Present this QR code to the authorized officer when claiming your document.
              </p>
              <p className="mt-2 text-[10px] text-muted-text">
                Valid until {new Date(retrievalQr.expires_at).toLocaleDateString()}
              </p>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => void generateRetrievalQr()}
              disabled={qrLoading}
              className="inline-flex h-10 w-full items-center justify-center rounded-full bg-clay px-4 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {qrLoading ? 'Generating QR code...' : 'Generate QR Code'}
            </button>
          )}
          {retrievalQr?.retrieval_status === 'active' && (
            <div className="mt-4 flex gap-2 print:hidden">
              <button
                type="button"
                onClick={downloadRetrievalQr}
                disabled={!qrImage}
                className="inline-flex h-10 flex-1 items-center justify-center rounded-full border border-warm-border px-4 text-xs font-semibold text-warm-text disabled:cursor-not-allowed disabled:opacity-50"
              >
                Download PNG
              </button>
              <button
                type="button"
                onClick={() => window.print()}
                disabled={!qrImage}
                className="inline-flex h-10 flex-1 items-center justify-center rounded-full border border-warm-border px-4 text-xs font-semibold text-warm-text disabled:cursor-not-allowed disabled:opacity-50"
              >
                Print QR Code
              </button>
            </div>
          )}
          {qrError && <p role="alert" className="mt-3 text-xs text-rejected-text">{qrError}</p>}
          {qrOriginWarning && (
            <p role="status" className="mt-3 rounded-xl bg-pending-bg px-3 py-2 text-[11px] leading-relaxed text-pending-text">
              {qrOriginWarning}
            </p>
          )}
          {isCompleted && (
            <div className="mt-4 space-y-3 rounded-xl border border-approved-bg bg-approved-bg/40 p-4">
              <p className="text-xs font-semibold text-approved-text">Processing completed</p>
              <p className="text-[11px] text-warm-text">
                Completed by {closureActor || 'an authorized office representative'}
                {sub.completed_at ? ` on ${new Date(sub.completed_at).toLocaleString()}` : ''}.
                Completion means processing finished; it is not an approval decision.
              </p>
              {sub.closure_note && (
                <p className="whitespace-pre-wrap rounded-xl bg-card/70 p-3 text-xs leading-relaxed text-warm-text">
                  {sub.closure_note}
                </p>
              )}
              {sub.closure_file_path && sub.closure_file_name && (
                <button
                  type="button"
                  onClick={() => void downloadAttachment({
                    id: 'closure-file',
                    file_name: sub.closure_file_name!,
                    file_path: sub.closure_file_path!,
                    file_type: sub.closure_file_type ?? null,
                    file_size: sub.closure_file_size ?? 0,
                  })}
                  className="text-xs font-semibold text-clay underline underline-offset-2"
                >
                  Download completion document: {sub.closure_file_name}
                </button>
              )}
            </div>
          )}
        </section>

      </div>
    </div>
  );
}
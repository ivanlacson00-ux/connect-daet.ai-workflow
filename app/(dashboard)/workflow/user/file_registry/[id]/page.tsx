'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
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
} from '@/lib/workflow/file-types';

// ─── Styles & Fonts (synced with dashboard) ──────────────────────────────────
const fonts = {
  serif: "font-serif",
  mono: "font-sans text-xs",
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

interface SubmissionVersion extends Attachment {
  version_number: number;
  created_at: string;
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
  const [versions, setVersions] = useState<SubmissionVersion[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [savingResponse, setSavingResponse] = useState(false);
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
          { data: versionRows, error: versionError },
          { data: logs, error: logsError },
        ] = await Promise.all([
          supabase
            .from('workflow_submission_attachments')
            .select('id, file_name, file_path, file_type, file_size')
            .eq('submission_id', id)
            .order('created_at', { ascending: true }),
          supabase
            .from('workflow_submission_versions')
            .select('id, version_number, file_name, file_path, file_type, file_size, created_at')
            .eq('submission_id', id)
            .order('version_number', { ascending: true }),
          supabase
            .from('workflow_audit_logs')
            .select('id, action_type, old_status, new_status, comments, created_at, profiles:action_by (full_name, role)')
            .eq('submission_id', id)
            .order('created_at', { ascending: true }),
        ]);
        if (attachmentError) console.error('Attachment load failed:', attachmentError.message);
        if (versionError) console.error('Submission version load failed:', versionError.message);
        if (logsError) console.error('Workflow history load failed:', logsError.message);
        setAttachments(attachmentRows ?? []);
        setVersions(versionRows ?? []);
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
      case 'SUBMISSION_CLOSED': return 'Submission closed';
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
  const isReturned = sub.status === 'changes_requested' || sub.status === 'returned_for_requirements';
  const isRedirectable = sub.status === 'returned';
  const canWithdraw = sub.status === 'submitted' && !sub.received_at;
  const canRespondToChanges = sub.status === 'changes_requested';
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
  const submitterActions = [
    {
      value: 'respond_changes',
      label: 'Submit response',
      buttonLabel: 'Submit response',
      tone: 'primary' as const,
      requiresMessage: true,
      unavailableReason: canRespondToChanges ? undefined : 'Available when changes have been requested',
    },
    {
      value: 'redirect',
      label: 'Redirect submission',
      buttonLabel: 'Redirect submission',
      tone: 'primary' as const,
      unavailableReason: isRedirectable ? undefined : 'Available when status is Returned',
    },
    {
      value: 'withdraw_submission',
      label: 'Withdraw submission',
      tone: 'warning' as const,
      confirmation: 'You can withdraw only before the responsible office receives this submission. Any pending office assignments will also be withdrawn.',
      unavailableReason: canWithdraw
        ? undefined
        : 'Available only before the responsible office receives the submission',
    },
  ];

  const handleSubmitterAction = async (
    action: string,
    _recipient: string,
    message: string,
    files: File[],
  ) => {
    if (action === 'respond_changes') {
      await submitRequirementsResponse(message, files[0] ?? null);
      return;
    }
    if (action === 'redirect') {
      if (files.length > 0) throw new Error('Remove attachments before redirecting this submission.');
      await redirectReturnedSubmission();
      return;
    }
    if (action === 'withdraw_submission') {
      if (files.length > 0) throw new Error('Remove attachments before withdrawing this submission.');
      await withdrawSubmission(message);
      return;
    }
    throw new Error('This action is unavailable.');
  };

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

  const downloadVersion = async (version: SubmissionVersion) => {
    const { data, error } = await supabase.storage
      .from('workflow_uploads')
      .createSignedUrl(version.file_path, 300);
    if (error || !data?.signedUrl) {
      console.error('Could not authorize document version download:', error?.message);
      setActionError('Could not open this document version. Please try again.');
      return;
    }
    await downloadFile(data.signedUrl, version.file_name);
  };

  return (
    <div className="w-full">
      {/* Back */}
      <div className="mb-5 max-md:mb-4">
        <button
          onClick={() => router.back()}
          className="inline-flex h-10 items-center gap-2 rounded-full border border-warm-border px-4 text-xs font-medium text-warm-text transition-colors hover:bg-sidebar max-md:h-11"
        >
          <span aria-hidden="true">←</span> Back to files
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12 max-md:gap-3">

        {/* DETAILS COLUMN */}
        <aside className="space-y-4 lg:col-span-5 max-md:space-y-3">

          {/* Header */}
          <section className="rounded-2xl border border-warm-border bg-card p-5 max-md:p-3.5">
            <p className="mb-3 flex items-center gap-2 text-[11px] font-medium text-muted-text max-md:mb-2">
              <span className="h-1.5 w-1.5 rounded-full bg-clay" /> Submission ID: {sub.id.split('-')[0]}
            </p>
            <h1 className={`${fonts.serif} mb-4 break-words text-[28px] leading-tight text-warm-text max-md:text-[24px]`}>{sub.file_name}</h1>
            <div className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[11px] font-medium ${statusConfig.classes}`}>
              <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
              {statusConfig.label}
            </div>
          </section>

          <section className="receipt-print border-2 border-black bg-white p-6">
            <p className={`${fonts.mono} text-blue-600 mb-3`}>Submission_Receipt</p>
            <div className="space-y-2 font-mono text-[11px]">
              <p><span className="text-gray-400">Tracking_Number:</span> {sub.tracking_number || 'Pending assignment'}</p>
              <p><span className="text-gray-400">Document:</span> {sub.file_name}</p>
              <p><span className="text-gray-400">Status:</span> {statusConfig.label}</p>
              <p><span className="text-gray-400">Submitted:</span> {new Date(sub.created_at).toLocaleString()}</p>
            </div>
          </section>

          <section className="rounded-2xl border border-warm-border bg-card p-5 max-md:p-3.5">
            <h2 className="mb-1 text-sm font-semibold text-warm-text">Document retrieval QR code</h2>
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
                    className="mx-auto h-64 w-64"
                  />
                ) : (
                  <p className="py-12 text-xs text-muted-text">Preparing QR code...</p>
                )}
                <p className="mt-2 text-sm font-bold text-warm-text">
                  Reference number: {sub.tracking_number}
                </p>
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
          </section>

          {/* Context Card */}
          <section className="space-y-5 rounded-2xl border border-warm-border bg-card p-5 max-md:p-3.5">
            <div>
              <p className="mb-1 text-[11px] font-medium text-muted-text">Category</p>
              <p className="inline-flex rounded-md bg-clay-soft px-2.5 py-1 text-xs font-semibold text-clay">
                {getWorkflowDocumentTypeLabel(sub.category, sub.other_document_type)}
              </p>
            </div>
            <div>
              <p className="mb-1.5 text-[11px] font-medium text-muted-text">Description</p>
              <p className="whitespace-pre-wrap break-words border-l-2 border-warm-border pl-4 font-serif text-base leading-relaxed text-warm-text">
                &quot;{sub.description || 'No description provided.'}&quot;
              </p>
            </div>
            <div>
              <p className="mb-1.5 text-[11px] font-medium text-muted-text">Intended recipient</p>
              <p className="text-xs leading-relaxed text-warm-text">{sub.intended_recipient || 'Not specified.'}</p>
            </div>
            {(sub.initial_destination_role || sub.selected_office_role) && (
              <div>
                <p className="mb-1.5 text-[11px] font-medium text-muted-text">Current responsible office</p>
                <p className="text-xs font-semibold text-warm-text">
                  {currentDestinationLabel}
                </p>
                {isOfficeRole(initialDestinationRole) && initialDestinationRole !== currentDestinationRole && (
                  <p className="mt-1 text-[10px] text-muted-text">
                    Originally selected: {OFFICE_CONFIG[initialDestinationRole].label}
                  </p>
                )}
              </div>
            )}
            <div className="flex items-end justify-between gap-4 border-t border-warm-border pt-4">
              <div>
                <p className="text-[10px] font-medium text-muted-text">Submitted on</p>
                <p className="mt-0.5 text-[11px] font-semibold text-warm-text">{new Date(sub.created_at).toLocaleDateString()} at {new Date(sub.created_at).toLocaleTimeString()}</p>
              </div>
              <div className="text-right">
                <p className="text-[10px] font-medium text-muted-text">File size</p>
                <p className="mt-0.5 text-[11px] font-semibold text-warm-text">{(sub.file_size / 1024).toFixed(2)} KB</p>
              </div>
            </div>
          </section>

          {isCompleted && (
            <section className="space-y-3 rounded-2xl border border-approved-bg bg-approved-bg/40 p-5 max-md:p-3.5">
              <h2 className="text-xs font-semibold text-approved-text">Processing completed</h2>
              <p className="text-[11px] text-warm-text">
                Closed by {closureActor || 'an authorized office representative'}
                {sub.completed_at ? ` on ${new Date(sub.completed_at).toLocaleString()}` : ''}.
                Closing means processing finished; it is not an approval decision.
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
                  Download closure document: {sub.closure_file_name}
                </button>
              )}
            </section>
          )}

          <section className="rounded-2xl border border-warm-border bg-card p-5 max-md:p-3.5">
            <h2 className="mb-3 text-xs font-semibold text-warm-text">Supporting attachments</h2>
            {attachments.length === 0 ? (
              <p className="text-[11px] text-muted-text">No supporting attachments.</p>
            ) : (
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
            )}
          </section>

          <section className="rounded-2xl border border-warm-border bg-card p-5 max-md:p-3.5">
            <h2 className="mb-3 text-xs font-semibold text-warm-text">Document version history</h2>
            {versions.length === 0 ? (
              <p className="text-[11px] text-muted-text">No document versions are available.</p>
            ) : (
              <ol className="space-y-2">
                {versions.map((version) => (
                  <li
                    key={version.id}
                    className="flex items-center justify-between gap-3 text-[11px]"
                  >
                    <span className="min-w-0 truncate text-warm-text">
                      Version {version.version_number}: {version.file_name}
                      <span className="ml-2 text-muted-text">
                        {new Date(version.created_at).toLocaleDateString()}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => void downloadVersion(version)}
                      className="shrink-0 font-semibold text-clay underline"
                    >
                      Download
                    </button>
                  </li>
                ))}
              </ol>
            )}
          </section>

          <DocumentMessaging
            key={sub.id}
            submissionId={sub.id}
            fileName={sub.file_name}
            trackingNumber={sub.tracking_number}
            workflowComposer={{
              recipients: [{ value: 'responsible_office', label: 'Responsible office' }],
              actionsByRecipient: { responsible_office: submitterActions },
              initialRecipient: 'responsible_office',
              initialAction: isRedirectable
                ? 'redirect'
                : canRespondToChanges
                  ? 'respond_changes'
                  : submitterActions.find((action) => !action.unavailableReason)?.value ?? 'respond_changes',
              statusLine: statusConfig.label,
              contextNote: isReturned
                ? requirementsRequest?.comments || sub.office_comments || sub.mayor_comments || undefined
                : undefined,
              isClosed: isCompleted || isWithdrawn,
              closedMessage: isWithdrawn ? 'This submission is withdrawn.' : 'This submission is closed.',
              busy: savingResponse || savingRedirect || withdrawing,
              renderActionFields: (action) => action === 'redirect' ? (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="block text-[11px] font-medium text-warm-text">
                    New destination office
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
                      className="mt-1 block min-h-10 w-full rounded-xl border border-warm-border bg-card px-3 text-xs text-warm-text outline-none focus:border-clay"
                    >
                      <option value="">Select an office</option>
                      {Object.entries(OFFICE_CONFIG).map(([officeRole, office]) => (
                        <option key={officeRole} value={officeRole}>{office.label}</option>
                      ))}
                    </select>
                  </label>
                  <label className="block text-[11px] font-medium text-warm-text">
                    Document type
                    <select
                      aria-label="Redirect document type"
                      value={redirectDocumentType}
                      onChange={(event) => {
                        setRedirectDocumentType(event.target.value);
                        setRedirectOtherDocumentType('');
                      }}
                      disabled={savingRedirect || !isOfficeRole(redirectOffice)}
                      className="mt-1 block min-h-10 w-full rounded-xl border border-warm-border bg-card px-3 text-xs text-warm-text outline-none focus:border-clay"
                    >
                      <option value="">Select a document type</option>
                      {isOfficeRole(redirectOffice) && OFFICE_CONFIG[redirectOffice].categories.map((category) => (
                        <option key={category} value={category}>{category}</option>
                      ))}
                    </select>
                  </label>
                  {redirectDocumentType === 'Other' && (
                    <label className="block text-[11px] font-medium text-warm-text sm:col-span-2">
                      Describe the document type
                      <input
                        value={redirectOtherDocumentType}
                        onChange={(event) => setRedirectOtherDocumentType(event.target.value)}
                        maxLength={120}
                        disabled={savingRedirect}
                        className="mt-1 block min-h-10 w-full rounded-xl border border-warm-border bg-card px-3 text-xs text-warm-text outline-none focus:border-clay"
                      />
                    </label>
                  )}
                  <p className="text-[10px] leading-relaxed text-muted-text sm:col-span-2">
                    The same submission and document will be redirected; you do not need to upload it again.
                  </p>
                </div>
              ) : null,
              onWorkflowAction: handleSubmitterAction,
            }}
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
          {actionError && <p role="alert" className="text-xs text-rejected-text">{actionError}</p>}

          {/* Official Feedback Section */}
          {showFeedback && officialNote && (
            <section
              className={`animate-in fade-in slide-in-from-bottom-4 rounded-2xl border p-5 duration-700 max-md:p-3.5 ${
                isApproved
                  ? 'border-approved-bg bg-approved-bg/50'
                  : 'border-rejected-bg bg-rejected-bg/50'
              }`}
            >
              <div className="mb-2 flex items-center justify-between">
                <p className={`text-xs font-semibold ${isApproved ? 'text-approved-text' : 'text-rejected-text'}`}>Official feedback</p>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${isApproved ? 'bg-approved-bg text-approved-text' : 'bg-rejected-bg text-rejected-text'}`}>Official</span>
              </div>
              <p className="break-words font-serif text-base leading-relaxed text-warm-text">
                &quot;{officialNote}&quot;
              </p>
            </section>
          )}

          {/* Locked Status for Active Review */}
          {!showFeedback && (
            <section className="rounded-2xl border border-dashed border-warm-border bg-sidebar p-5 max-md:p-3.5">
              <p className="text-center text-xs leading-relaxed text-muted-text">
                Official feedback will appear here once the review is complete.
              </p>
            </section>
          )}

          {/* Footer Actions */}
          <button
            onClick={async () => {
              const url = await getFileUrl(supabase, sub);
              await downloadFile(url, sub.file_name);
            }}
            className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-full bg-clay px-6 text-xs font-semibold text-white transition-colors hover:bg-warm-text"
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
                <span className="truncate text-[11px] font-medium text-warm-text">
                  {sub.file_name}
                </span>
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
'use client';

import { useCallback, useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react';
import { useParams, useRouter } from 'next/navigation';
import QRCode from 'qrcode';
import { createClient } from '@/lib/supabase/client';
import DocumentMessaging from '@/components/DocumentMessaging';
import WorkflowActivityTimeline from '@/components/WorkflowActivityTimeline';
import WorkflowRevisionTimeline from '@/components/WorkflowRevisionTimeline';
import WorkflowStatusPanel, { type WorkflowStatusStep } from '@/components/WorkflowStatusPanel';
import FilePreview, { downloadFile, getFileUrl } from '@/components/FilePreview';
import {
  getWorkflowFileMimeType,
  getWorkflowFilesTypeError,
  WORKFLOW_ATTACHMENT_ACCEPT,
  WORKFLOW_DOCUMENT_ACCEPT,
} from '@/lib/workflow/file-types';
import {
  getWorkflowDocumentTypeLabel,
  isOfficeRole,
  OFFICE_CONFIG,
  type OfficeRole,
} from '@/lib/workflow/offices';
import { getSubmissionStatusLabel, getSubmissionStatusTone } from '@/lib/workflow/status';
import {
  getCurrentWorkflowRevisionFiles,
  parseWorkflowRevisionHistory,
  type WorkflowRevisionFile,
  type WorkflowRevisionHistory,
} from '@/lib/workflow/revisions';
import { getAvailableActions } from '@/lib/workflow/action-availability';

const fonts = {
  serif: 'font-serif',
};

interface Submission {
  id: string;
  user_id: string;
  tracking_number: string;
  file_name: string;
  file_url: string;
  file_path?: string | null;
  file_type: string;
  file_size: number;
  status: string;
  current_revision_id?: string | null;
  reopen_count?: number | null;
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
  final_decided_at?: string | null;
  final_decision_office_role?: string | null;
  approved_at?: string | null;
  rejected_at?: string | null;
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

type RevisionFileAction = 'keep' | 'replace' | 'remove';

interface RevisionDraftFile {
  file: WorkflowRevisionFile;
  action: RevisionFileAction;
  replacement: File | null;
}

interface UploadedRevisionFile {
  fileName: string;
  filePath: string;
  fileType: string;
  fileSize: number;
}

interface WorkflowRevisionManifestItem {
  logical_file_id: string;
  prior_revision_file_id: string | null;
  file_role: 'primary' | 'supporting';
  file_name: string;
  storage_path: string;
  file_type: string | null;
  file_size: number;
  change_kind: 'added' | 'replaced' | 'carried' | 'removed';
}

const MAX_REVISION_FILE_BYTES = 10 * 1024 * 1024;

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string') {
    return error.message;
  }
  return fallback;
}

function isRevisionFileAction(value: string): value is RevisionFileAction {
  return value === 'keep' || value === 'replace' || value === 'remove';
}

function getRevisionFileError(files: File[], allowZip: boolean) {
  const typeError = getWorkflowFilesTypeError(files, allowZip);
  if (typeError) return typeError;
  const oversizedFile = files.find((file) => file.size > MAX_REVISION_FILE_BYTES);
  return oversizedFile
    ? `"${oversizedFile.name}" exceeds the 10 MB per-file limit.`
    : null;
}

export default function UserFileDetail() {
  const { id } = useParams();
  const router = useRouter();
  const [sub, setSub] = useState<Submission | null>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [revisionHistory, setRevisionHistory] = useState<WorkflowRevisionHistory | null>(null);
  const [revisionHistoryLoading, setRevisionHistoryLoading] = useState(true);
  const [revisionHistoryError, setRevisionHistoryError] = useState<string | null>(null);
  const [routeSteps, setRouteSteps] = useState<WorkflowStatusStep[]>([]);
  const [currentRoutePlanId, setCurrentRoutePlanId] = useState<string | null>(null);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [withdrawalReason, setWithdrawalReason] = useState('');
  const [actionError, setActionError] = useState('');
  const [revisionEditorOpen, setRevisionEditorOpen] = useState(false);
  const [revisionDraftFiles, setRevisionDraftFiles] = useState<RevisionDraftFile[]>([]);
  const [revisionAddedFiles, setRevisionAddedFiles] = useState<File[]>([]);
  const [revisionMessage, setRevisionMessage] = useState('');
  const [submittingRevision, setSubmittingRevision] = useState(false);
  const [closingPermanently, setClosingPermanently] = useState(false);
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
  const supabase = useMemo(() => createClient(), []);

  const fetchSubmission = useCallback(async (preserveCurrent = false) => {
    if (!preserveCurrent) {
      setLoading(true);
      setSub(null);
      setRouteSteps([]);
      setCurrentRoutePlanId(null);
      setRouteError(null);
      setRevisionHistory(null);
    }
    setRevisionHistoryLoading(true);
    setRevisionHistoryError(null);
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
          { data: routes, error: routeError },
          { data: detailHistory, error: detailHistoryError },
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
          supabase
            .from('workflow_routing_plans')
            .select('id, is_current')
            .eq('submission_id', id)
            .order('version', { ascending: true }),
          supabase.rpc('get_workflow_submission_detail', { target_submission_id: id }),
        ]);
        if (attachmentError) console.error('Attachment load failed:', attachmentError.message);
        if (logsError) console.error('Workflow history load failed:', logsError.message);
        let parsedHistory: WorkflowRevisionHistory | null = null;
        if (detailHistoryError) {
          console.error('Revision history load failed:', detailHistoryError.message);
          setRevisionHistoryError('Could not load the file version history. Refresh this page to try again.');
        } else {
          try {
            parsedHistory = parseWorkflowRevisionHistory(detailHistory);
            setRevisionHistory(parsedHistory);
          } catch (historyError) {
            console.error('Revision history response was invalid:', historyError);
            setRevisionHistoryError('The file version history could not be read. Refresh this page to try again.');
          }
        }
        setRevisionHistoryLoading(false);
        const currentSupportingFiles = parsedHistory
          ? getCurrentWorkflowRevisionFiles(parsedHistory)
            .filter((file) => file.fileRole === 'supporting')
            .map((file) => ({
              id: file.id,
              file_name: file.fileName,
              file_path: file.storagePath,
              file_type: file.fileType,
              file_size: file.fileSize,
            }))
          : attachmentRows ?? [];
        setAttachments(currentSupportingFiles);
        setAuditLogs(logs ?? []);
        if (routeError) {
          console.error('Workflow route load failed:', routeError.message);
          setRouteError('Could not load the latest office routing status. Refresh this page to try again.');
          setRouteSteps([]);
          setCurrentRoutePlanId(null);
        } else {
          const routePlanIds = (routes ?? []).map((route) => route.id);
          const currentRoute = (routes ?? []).find((route) => route.is_current) ?? null;
          if (routePlanIds.length === 0) {
            setRouteSteps([]);
            setCurrentRoutePlanId(null);
            setRouteError(null);
          } else {
            const { data: steps, error: stepsError } = await supabase
              .from('workflow_routing_steps')
              .select('id, routing_plan_id, office_role, status, outcome, assigned_at, started_at, decided_at, completed_at')
              .in('routing_plan_id', routePlanIds)
              .order('sequence_number', { ascending: true });
            if (stepsError) {
              console.error('Workflow route steps load failed:', stepsError.message);
              setRouteError('Could not load the latest office routing status. Refresh this page to try again.');
              setRouteSteps([]);
              setCurrentRoutePlanId(null);
            } else {
              setRouteError(null);
              setCurrentRoutePlanId(currentRoute?.id ?? null);
              setRouteSteps((steps ?? []).filter((step) =>
                typeof step.id === 'string'
                && typeof step.routing_plan_id === 'string'
                && typeof step.office_role === 'string'
                && typeof step.status === 'string'
              ));
            }
          }
        }
      }
    } finally {
      setLoading(false);
      setRevisionHistoryLoading(false);
    }
  }, [id, supabase]);

  useEffect(() => {
    void fetchSubmission();
  }, [fetchSubmission]);

  useEffect(() => {
    if (typeof id !== 'string') return;

    let refreshTimer: number | undefined;
    const scheduleRefresh = () => {
      if (refreshTimer !== undefined) window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => {
        refreshTimer = undefined;
        void fetchSubmission(true);
      }, 100);
    };

    const channel = supabase
      .channel(`user-submission-revisions-${id}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'workflow_submission_revisions',
        filter: `submission_id=eq.${id}`,
      }, scheduleRefresh)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'workflow_change_requests',
        filter: `submission_id=eq.${id}`,
      }, scheduleRefresh)
      .subscribe();

    return () => {
      if (refreshTimer !== undefined) window.clearTimeout(refreshTimer);
      void supabase.removeChannel(channel);
    };
  }, [fetchSubmission, id, supabase]);

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

  const startRevision = () => {
    if (!revisionHistory || !sub?.current_revision_id) {
      setActionError('The current file history is unavailable. Refresh before revising this submission.');
      return;
    }
    const currentRevision = revisionHistory.revisions.find(
      (revision) => revision.id === sub.current_revision_id,
    );
    if (!currentRevision) {
      setActionError('The current revision could not be found. Refresh before revising this submission.');
      return;
    }
    setRevisionDraftFiles(
      currentRevision.files
        .filter((file) => file.changeKind !== 'removed')
        .map((file) => ({ file, action: 'keep', replacement: null })),
    );
    setRevisionAddedFiles([]);
    setRevisionMessage('');
    setActionError('');
    setRevisionEditorOpen(true);
  };

  const handleRevisionReplacement = (index: number, event: ChangeEvent<HTMLInputElement>) => {
    const replacement = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!replacement) return;
    const draft = revisionDraftFiles[index];
    const fileError = getRevisionFileError([replacement], draft.file.fileRole === 'supporting');
    if (fileError) {
      setActionError(fileError);
      return;
    }
    setActionError('');
    setRevisionDraftFiles((current) => current.map((entry, entryIndex) =>
      entryIndex === index
        ? { ...entry, action: 'replace', replacement }
        : entry
    ));
  };

  const handleRevisionAddedFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = '';
    if (selectedFiles.length === 0) return;
    const fileError = getRevisionFileError(selectedFiles, true);
    if (fileError) {
      setActionError(fileError);
      return;
    }
    const currentFiles = revisionDraftFiles.filter((entry) => entry.action !== 'remove').length;
    if (currentFiles + revisionAddedFiles.length + selectedFiles.length > 30) {
      setActionError('A submission can contain no more than 30 files per revision.');
      return;
    }
    setActionError('');
    setRevisionAddedFiles((current) => [...current, ...selectedFiles]);
  };

  const submitRevision = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!sub || !revisionHistory || !sub.current_revision_id || submittingRevision) return;
    setActionError('');

    const openRequest = revisionHistory.changeRequests.find(
      (request) => request.status === 'open'
        && request.againstRevisionId === sub.current_revision_id,
    );
    if (!openRequest) {
      setActionError('The open change request could not be verified. Refresh and try again.');
      return;
    }

    if (revisionDraftFiles.some((entry) => entry.action === 'replace' && !entry.replacement)) {
      setActionError('Choose a replacement file for each file marked Replace.');
      return;
    }
    const replacedFiles = revisionDraftFiles.filter(
      (entry): entry is RevisionDraftFile & { replacement: File } =>
        entry.action === 'replace' && entry.replacement !== null,
    );
    if (replacedFiles.length + revisionAddedFiles.length === 0) {
      setActionError('Add or replace at least one file. Removing files alone does not reopen the submission.');
      return;
    }
    const activePrimaryCount = revisionDraftFiles.filter(
      (entry) => entry.file.fileRole === 'primary' && entry.action !== 'remove',
    ).length;
    if (activePrimaryCount !== 1) {
      setActionError('Keep or replace exactly one primary document.');
      return;
    }

    const uploadedPaths: string[] = [];
    setSubmittingRevision(true);
    try {
      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (authError) throw authError;
      if (!authData.user || authData.user.id !== sub.user_id) {
        throw new Error('Your active submitter account could not be verified.');
      }

      const uploadPlan = [
        ...replacedFiles.map((entry, index) => ({
          key: `replace-${index}`,
          file: entry.replacement,
        })),
        ...revisionAddedFiles.map((file, index) => ({ key: `added-${index}`, file })),
      ];
      const uploadedFiles = new Map<string, UploadedRevisionFile>();
      const uploadResults = await Promise.allSettled(uploadPlan.map(async ({ key, file }, index) => {
        const fileType = getWorkflowFileMimeType(file.name);
        if (!fileType) throw new Error(`Unsupported file type: ${file.name}`);
        const safeName = file.name.replace(/[^\w.-]/g, '_');
        const filePath = `${authData.user.id}/${crypto.randomUUID()}-${index}-${safeName}`;
        const { error } = await supabase.storage
          .from('workflow_uploads')
          .upload(filePath, file, {
            contentType: fileType,
            cacheControl: '3600',
            upsert: false,
          });
        if (error) throw error;
        uploadedPaths.push(filePath);
        uploadedFiles.set(key, {
          fileName: file.name,
          filePath,
          fileType,
          fileSize: file.size,
        });
      }));
      const failedUpload = uploadResults.find(
        (result): result is PromiseRejectedResult => result.status === 'rejected',
      );
      if (failedUpload) throw failedUpload.reason;

      const fileManifest: WorkflowRevisionManifestItem[] = revisionDraftFiles.map((entry, index) => {
        const base = {
          logical_file_id: entry.file.logicalFileId,
          prior_revision_file_id: entry.file.id,
          file_role: entry.file.fileRole,
        };
        if (entry.action === 'remove') {
          return {
            ...base,
            file_name: entry.file.fileName,
            storage_path: entry.file.storagePath,
            file_type: entry.file.fileType,
            file_size: entry.file.fileSize,
            change_kind: 'removed',
          };
        }
        if (entry.action === 'replace') {
          const replacementIndex = replacedFiles.findIndex(
            (replacement) => replacement.file.id === entry.file.id,
          );
          const uploaded = uploadedFiles.get(`replace-${replacementIndex}`);
          if (!uploaded) throw new Error(`The replacement upload for ${entry.file.fileName} is missing.`);
          return {
            ...base,
            file_name: uploaded.fileName,
            storage_path: uploaded.filePath,
            file_type: uploaded.fileType,
            file_size: uploaded.fileSize,
            change_kind: 'replaced',
          };
        }
        return {
          ...base,
          file_name: entry.file.fileName,
          storage_path: entry.file.storagePath,
          file_type: entry.file.fileType,
          file_size: entry.file.fileSize,
          change_kind: 'carried',
        };
      });

      revisionAddedFiles.forEach((file, index) => {
        const uploaded = uploadedFiles.get(`added-${index}`);
        if (!uploaded) throw new Error(`The added upload for ${file.name} is missing.`);
        fileManifest.push({
          logical_file_id: crypto.randomUUID(),
          prior_revision_file_id: null,
          file_role: 'supporting',
          file_name: uploaded.fileName,
          storage_path: uploaded.filePath,
          file_type: uploaded.fileType,
          file_size: uploaded.fileSize,
          change_kind: 'added',
        });
      });

      const primaryFile = fileManifest.find(
        (file) => file.file_role === 'primary' && file.change_kind !== 'removed',
      );
      if (!primaryFile) throw new Error('The primary document could not be determined.');
      const { data: publicUrl } = supabase.storage
        .from('workflow_uploads')
        .getPublicUrl(primaryFile.storage_path);

      const { error: submitError } = await supabase.rpc('submit_workflow_submission_revision', {
        target_submission_id: sub.id,
        expected_change_request_id: openRequest.id,
        expected_revision_id: sub.current_revision_id,
        submitter_message: revisionMessage.trim() || null,
        file_manifest: fileManifest,
        primary_file_url: publicUrl.publicUrl,
      });
      if (submitError) throw submitError;

      setRevisionEditorOpen(false);
      setRevisionDraftFiles([]);
      setRevisionAddedFiles([]);
      await fetchSubmission(true);
    } catch (error) {
      console.error('Submission revision failed:', error);
      let cleanupFailed = false;
      if (uploadedPaths.length > 0) {
        const { error: cleanupError } = await supabase.storage
          .from('workflow_uploads')
          .remove(uploadedPaths);
        if (cleanupError) {
          cleanupFailed = true;
          console.error('Could not clean up uncommitted revision uploads:', cleanupError.message);
        }
      }
      const message = getErrorMessage(error, 'Could not submit this revision.');
      setActionError(cleanupFailed
        ? `${message} Some uncommitted uploads could not be removed; contact support if they remain visible.`
        : message);
    } finally {
      setSubmittingRevision(false);
    }
  };

  const closePermanently = async () => {
    if (!sub || !revisionHistory || closingPermanently) return;
    const openRequest = revisionHistory.changeRequests.find(
      (request) => request.status === 'open'
        && request.againstRevisionId === sub.current_revision_id,
    );
    if (!openRequest) {
      setActionError('The open change request could not be verified. Refresh and try again.');
      return;
    }
    if (!window.confirm('Permanently close this submission? It cannot be reopened afterward. Your files and history will be retained.')) {
      return;
    }

    setClosingPermanently(true);
    setActionError('');
    try {
      const { error } = await supabase.rpc('close_workflow_submission_permanently', {
        target_submission_id: sub.id,
        expected_change_request_id: openRequest.id,
      });
      if (error) throw error;
      setRevisionEditorOpen(false);
      await fetchSubmission(true);
    } catch (error) {
      console.error('Permanent submission closure failed:', error);
      setActionError(getErrorMessage(error, 'Could not permanently close this submission.'));
    } finally {
      setClosingPermanently(false);
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
      case 'SUBMISSION_FORWARDED': return 'Another office was consulted';
      case 'ASSIGNMENT_COMPLETED': return 'Consulted office responded';
      case 'ASSIGNMENT_RETURNED': return 'Consulted office returned the request';
      case 'ASSIGNMENT_WITHDRAWN': return 'Office assignment withdrawn';
      case 'CHANGES_REQUESTED': return 'Changes requested';
      case 'CHANGES_RESPONDED': return 'Response to requested changes submitted';
      case 'RETURNED_TO_SUBMITTER': return 'Returned to submitter for redirection';
      case 'SUBMISSION_WITHDRAWN': return 'Submission withdrawn';
      case 'SUBMISSION_CLOSED': return 'Submission completed';
      case 'SUBMISSION_REOPENED': return 'Submission reopened';
      case 'SUBMISSION_PERMANENTLY_CLOSED': return 'Submitter permanently closed submission';
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
  const isPermanentlyClosed = sub.status === 'closed_by_submitter';
  const isRedirectable = sub.status === 'returned';
  const canWithdraw = sub.status === 'submitted' && !sub.received_at;
  const openChangeRequest = revisionHistory?.changeRequests.find(
    (request) => request.status === 'open'
      && request.againstRevisionId === sub.current_revision_id,
  ) ?? null;
  const submitterActions = getAvailableActions({
    status: sub.status,
    reopen_count: sub.reopen_count,
    has_open_change_request: Boolean(openChangeRequest),
    change_request_repair_needed: revisionHistory?.changeRequestRepairNeeded ?? false,
  }, [], 'submitter');
  const canClarify = submitterActions.includes('clarify');
  const canRevise = submitterActions.includes('revise_submission');
  const canClosePermanently = submitterActions.includes('close_permanently');
  const currentDestinationRole = sub.selected_office_role ?? sub.initial_destination_role ?? null;
  const currentDestinationLabel = isOfficeRole(currentDestinationRole)
    ? OFFICE_CONFIG[currentDestinationRole].label
    : 'Not selected';
  const initialDestinationRole = sub.initial_destination_role ?? null;
  const responsibleOfficeRole = sub.selected_office_role
    ?? sub.initial_destination_role
    ?? null;
  const showFeedback = isCompleted || sub.status.includes('declined');
  const officialNote = sub.mayor_comments || sub.office_comments || sub.admin_comments || sub.rejection_comment || sub.approver_comments;
  const isApproved = isCompleted;
  const requirementsRequest = [...auditLogs]
    .reverse()
    .find((log) => ['CHANGES_REQUESTED', 'ROUTE_REQUIREMENTS_REQUESTED'].includes(log.action_type));
  const requestProfile = Array.isArray(requirementsRequest?.profiles)
    ? requirementsRequest.profiles[0]
    : requirementsRequest?.profiles;
  const requestRole = requestProfile?.role ?? null;
  const requestAuthor = requestProfile?.full_name
    || (isOfficeRole(requestRole)
      ? OFFICE_CONFIG[requestRole].label
      : null)
    || currentDestinationLabel;

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

        {isPermanentlyClosed && (
          <div className="border-t border-warm-border bg-sidebar/50 px-5 py-4 text-xs text-muted-text md:px-7" role="status">
            You permanently closed this submission. It cannot be reopened; its files and full history remain available here.
            {closureActor ? ` Closed by ${closureActor}.` : ''}
          </div>
        )}

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

      <div className="mb-5">
        <WorkflowStatusPanel
          submissionId={sub.id}
          submissionStatus={sub.status}
          responsibleOfficeRole={responsibleOfficeRole}
          receivedAt={sub.received_at}
          currentRoutePlanId={currentRoutePlanId}
          steps={routeSteps}
          finalDecisionOfficeRole={sub.final_decision_office_role}
          finalDecidedAt={sub.final_decided_at}
          approvedAt={sub.approved_at}
          rejectedAt={sub.rejected_at}
          completedAt={sub.completed_at}
          routeError={routeError}
        />
      </div>

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
          <div className="space-y-5">
            <WorkflowActivityTimeline
              emptyMessage="No workflow events recorded yet."
              showComments={false}
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
            <WorkflowRevisionTimeline
              history={revisionHistory}
              loading={revisionHistoryLoading}
              error={revisionHistoryError}
            />
          </div>
        )}
      />

      {(canClarify || canRevise || canClosePermanently || isRedirectable || canWithdraw) && (
        <section className="mt-5 overflow-hidden rounded-2xl border border-warm-border bg-card">
          <header className="border-b border-warm-border px-5 py-4 md:px-6">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-clay">Submission actions</p>
            <h2 className="mt-1 font-serif text-xl font-semibold text-warm-text">What would you like to do?</h2>
            <p className="mt-1.5 text-[11px] leading-relaxed text-muted-text">
              These actions are available based on the current status of your submission.
            </p>
          </header>
          <div className="grid gap-4 bg-[#f8f5f1] p-5 md:grid-cols-2 md:p-6">
            {canClarify && (
              <div className="space-y-3 rounded-xl border border-pending-text/20 bg-pending-bg/50 p-4 md:col-span-2" role="status">
                <div>
                  <h3 className="text-xs font-semibold text-warm-text">Closed — Changes Requested</h3>
                  <p className="mt-1 text-[10px] font-medium text-muted-text">
                    Requested by {requestAuthor}
                    {requirementsRequest?.created_at
                      ? ` · ${new Date(requirementsRequest.created_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}`
                      : ''}
                  </p>
                  <p className="mt-1 text-[11px] leading-relaxed text-muted-text">
                    {requirementsRequest?.comments || sub.office_comments || sub.mayor_comments || 'The responsible office has requested changes to your submission.'}
                  </p>
                </div>
                <p className="text-[11px] leading-relaxed text-muted-text">
                  You may clarify through the conversation above without changing this status.
                </p>
              </div>
            )}

            {canRevise && (
              <div className="space-y-4 rounded-xl border border-clay/25 bg-card p-4 md:col-span-2">
                {!revisionEditorOpen ? (
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <h3 className="text-xs font-semibold text-warm-text">Reopen and resubmit</h3>
                      <p className="mt-1 text-[11px] leading-relaxed text-muted-text">
                        Keep, replace, or remove current files and add supporting files. Add or replace at least one file to return this submission to {currentDestinationLabel}.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={startRevision}
                      disabled={revisionHistoryLoading || submittingRevision || closingPermanently}
                      className="inline-flex h-10 shrink-0 items-center justify-center rounded-full bg-clay px-5 text-xs font-semibold text-white transition-colors hover:bg-warm-text disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Reopen and resubmit
                    </button>
                  </div>
                ) : (
                  <form onSubmit={(event) => void submitRevision(event)} className="space-y-4">
                    <div>
                      <h3 className="text-xs font-semibold text-warm-text">Prepare your revised files</h3>
                      <p className="mt-1 text-[11px] leading-relaxed text-muted-text">
                        Your destination and request details stay unchanged. Keep at least one primary document and add or replace at least one file.
                      </p>
                    </div>

                    <ul className="space-y-2">
                      {revisionDraftFiles.map((entry, index) => (
                        <li key={entry.file.id} className="grid gap-3 rounded-xl border border-warm-border bg-sidebar/40 p-3 sm:grid-cols-[minmax(0,1fr)_150px] sm:items-center">
                          <div className="min-w-0">
                            <p className="break-words text-xs font-semibold text-warm-text">{entry.file.fileName}</p>
                            <p className="mt-0.5 text-[10px] text-muted-text">
                              {entry.file.fileRole === 'primary' ? 'Primary document' : 'Supporting document'}
                              {' · '}
                              {Math.max(1, Math.round(entry.file.fileSize / 1024))} KB
                            </p>
                            {entry.action === 'replace' && entry.replacement && (
                              <p className="mt-1 break-words text-[10px] font-medium text-clay">
                                Replacement: {entry.replacement.name}
                              </p>
                            )}
                          </div>
                          <label className="text-[10px] font-bold uppercase tracking-[0.1em] text-muted-text">
                            File action
                            <select
                              value={entry.action}
                              onChange={(event) => {
                                const action = event.target.value;
                                if (!isRevisionFileAction(action)) return;
                                setRevisionDraftFiles((current) => current.map((draft, draftIndex) =>
                                  draftIndex === index
                                    ? { ...draft, action, replacement: action === 'replace' ? draft.replacement : null }
                                    : draft
                                ));
                                setActionError('');
                              }}
                              disabled={submittingRevision}
                              className="mt-1 block h-9 w-full rounded-lg border border-warm-border bg-white px-2 text-xs font-medium normal-case tracking-normal text-warm-text outline-none focus:border-clay"
                            >
                              <option value="keep">Keep</option>
                              <option value="replace">Replace</option>
                              <option value="remove" disabled={entry.file.fileRole === 'primary'}>Remove</option>
                            </select>
                          </label>
                          {entry.action === 'replace' && (
                            <label className="text-[10px] font-bold uppercase tracking-[0.1em] text-muted-text sm:col-span-2">
                              Replacement file
                              <input
                                type="file"
                                accept={entry.file.fileRole === 'primary' ? WORKFLOW_DOCUMENT_ACCEPT : WORKFLOW_ATTACHMENT_ACCEPT}
                                onChange={(event) => handleRevisionReplacement(index, event)}
                                disabled={submittingRevision}
                                className="mt-1 block w-full text-[11px] font-medium normal-case tracking-normal text-warm-text file:mr-3 file:rounded-full file:border-0 file:bg-clay-soft file:px-3 file:py-2 file:text-[10px] file:font-semibold file:text-clay"
                              />
                            </label>
                          )}
                        </li>
                      ))}
                    </ul>

                    <label className="block text-[10px] font-bold uppercase tracking-[0.1em] text-muted-text">
                      Add supporting files
                      <input
                        type="file"
                        accept={WORKFLOW_ATTACHMENT_ACCEPT}
                        multiple
                        onChange={handleRevisionAddedFiles}
                        disabled={submittingRevision}
                        className="mt-1 block w-full text-[11px] font-medium normal-case tracking-normal text-warm-text file:mr-3 file:rounded-full file:border-0 file:bg-clay-soft file:px-3 file:py-2 file:text-[10px] file:font-semibold file:text-clay"
                      />
                    </label>
                    {revisionAddedFiles.length > 0 && (
                      <ul className="space-y-1">
                        {revisionAddedFiles.map((file, index) => (
                          <li key={`${file.name}-${index}`} className="flex items-center justify-between gap-3 rounded-lg bg-sidebar px-3 py-2 text-[11px] text-warm-text">
                            <span className="min-w-0 break-words">{file.name}</span>
                            <button
                              type="button"
                              onClick={() => setRevisionAddedFiles((current) => current.filter((_, fileIndex) => fileIndex !== index))}
                              disabled={submittingRevision}
                              className="shrink-0 rounded-full px-2 py-1 font-semibold text-muted-text hover:bg-card hover:text-warm-text disabled:opacity-50"
                            >
                              Remove
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}

                    <label className="block text-[10px] font-bold uppercase tracking-[0.1em] text-muted-text">
                      Optional message to the office
                      <textarea
                        value={revisionMessage}
                        onChange={(event) => setRevisionMessage(event.target.value)}
                        maxLength={4000}
                        rows={3}
                        disabled={submittingRevision}
                        className="mt-1.5 block min-h-20 w-full resize-y rounded-xl border border-warm-border bg-white p-3 text-xs font-normal normal-case leading-relaxed tracking-normal text-warm-text outline-none focus:border-clay focus:ring-2 focus:ring-clay/15 disabled:opacity-60"
                        placeholder="Optional context about the revised files."
                      />
                    </label>

                    <div className="flex flex-wrap gap-2">
                      <button
                        type="submit"
                        disabled={submittingRevision || closingPermanently}
                        className="inline-flex h-10 items-center justify-center rounded-full bg-clay px-5 text-xs font-semibold text-white transition-colors hover:bg-warm-text disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {submittingRevision ? 'Uploading and resubmitting…' : 'Submit revision'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setRevisionEditorOpen(false)}
                        disabled={submittingRevision}
                        className="inline-flex h-10 items-center justify-center rounded-full border border-warm-border px-5 text-xs font-semibold text-warm-text hover:bg-sidebar disabled:opacity-50"
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                )}
              </div>
            )}

            {canClosePermanently && (
              <div className="flex flex-col gap-3 rounded-xl border border-rejected-bg bg-card p-4 sm:flex-row sm:items-center sm:justify-between md:col-span-2">
                <div>
                  <h3 className="text-xs font-semibold text-warm-text">Close permanently</h3>
                  <p className="mt-1 text-[11px] leading-relaxed text-muted-text">
                    This ends processing without approving or rejecting the request. The submission cannot be reopened; its files and history are retained.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void closePermanently()}
                  disabled={closingPermanently || submittingRevision}
                  className="inline-flex h-10 shrink-0 items-center justify-center rounded-full border border-rejected-text bg-rejected-bg px-5 text-xs font-semibold text-rejected-text transition-colors hover:bg-rejected-bg/70 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {closingPermanently ? 'Closing…' : 'Close permanently'}
                </button>
              </div>
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
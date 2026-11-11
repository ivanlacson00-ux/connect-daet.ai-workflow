'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { OFFICE_CONFIG, type OfficeRole } from '@/lib/workflow/offices';

const OFFICE_ROLES = Object.keys(OFFICE_CONFIG) as OfficeRole[];
const DOCUMENT_TYPES = [
  { value: 'assessment_report', label: 'Assessment report' },
  { value: 'supporting_document', label: 'Supporting document' },
  { value: 'financial_assessment', label: 'Financial assessment' },
  { value: 'technical_review', label: 'Technical review' },
  { value: 'other', label: 'Other' },
] as const;
const FILE_TYPES: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
};
const inputClass =
  'h-11 w-full rounded-xl border border-warm-border bg-card px-3 text-xs text-warm-text outline-none focus:border-clay';

interface InterOfficeRequest {
  id: string;
  reference_number: string;
  title: string;
  transaction_type: string;
  description: string;
  requesting_office: OfficeRole;
  current_office: OfficeRole;
  final_approval_office: OfficeRole;
  created_by: string;
  related_submission_id: string | null;
  status: string;
  office_status: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

interface CitizenSubmissionDocument {
  id: string;
  version_number: number | null;
  file_name: string;
  file_path: string;
  file_type: string | null;
  file_size: number;
  created_at: string;
  uploaded_by: string | null;
}

interface CitizenSubmission {
  tracking_number: string;
  file_name: string | null;
  file_path: string | null;
  file_type: string | null;
  file_size: number | null;
  created_at: string;
}

interface InterOfficeStep {
  id: string;
  sequence_number: number;
  office_role: OfficeRole;
  status: string;
  assessment_required_before_forward: boolean;
  required_document_type: string | null;
  is_final_approver: boolean;
  assigned_at: string | null;
  started_at: string | null;
  decided_at: string | null;
  remarks: string | null;
}

interface InterOfficeDocument {
  id: string;
  request_id: string;
  step_id: string | null;
  message_id: string | null;
  uploaded_by: string;
  uploader_name: string;
  uploading_office: OfficeRole;
  document_type: string;
  document_group_id: string;
  version_number: number;
  file_name: string;
  file_path: string;
  file_type: string;
  file_size: number;
  created_at: string;
}

interface InterOfficeMessage {
  id: string;
  sender_id: string;
  sender_name: string;
  sender_office: OfficeRole;
  recipient_office: OfficeRole;
  body: string;
  created_at: string;
}

interface InterOfficeActivity {
  id: string;
  actor_id: string | null;
  actor_name: string | null;
  actor_office: string | null;
  action_type: string;
  target_office: string | null;
  from_status: string | null;
  to_status: string | null;
  remarks: string | null;
  created_at: string;
}

function officeName(role: string) {
  return OFFICE_CONFIG[role as OfficeRole]?.label ?? role.replaceAll('_', ' ');
}

function statusName(status: string) {
  return status.replaceAll('_', ' ');
}

function documentName(documentType: string) {
  return DOCUMENT_TYPES.find((item) => item.value === documentType)?.label
    ?? documentType.replaceAll('_', ' ');
}

function fileMimeType(file: File) {
  const extension = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
  return FILE_TYPES[extension] === file.type || !file.type
    ? FILE_TYPES[extension]
    : null;
}

export default function InterOfficeWorkspace({ officeRole }: { officeRole: OfficeRole }) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const [userId, setUserId] = useState('');
  const [requests, setRequests] = useState<InterOfficeRequest[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [steps, setSteps] = useState<InterOfficeStep[]>([]);
  const [documents, setDocuments] = useState<InterOfficeDocument[]>([]);
  const [messages, setMessages] = useState<InterOfficeMessage[]>([]);
  const [activity, setActivity] = useState<InterOfficeActivity[]>([]);
  const [citizenSubmission, setCitizenSubmission] = useState<CitizenSubmission | null>(null);
  const [citizenDocuments, setCitizenDocuments] = useState<CitizenSubmissionDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [filter, setFilter] = useState<'incoming' | 'outgoing' | 'all'>('incoming');
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [title, setTitle] = useState('');
  const [transactionType, setTransactionType] = useState('');
  const [description, setDescription] = useState('');
  const [firstOffice, setFirstOffice] = useState<OfficeRole>(
    OFFICE_ROLES.find((role) => role !== officeRole) ?? 'mayor_office'
  );
  const [secondOffice, setSecondOffice] = useState<OfficeRole | ''>('');
  const [processAtRequestingOffice, setProcessAtRequestingOffice] = useState(false);
  const [requiredTypes, setRequiredTypes] = useState<Record<string, string>>({});
  const [relatedTrackingNumber, setRelatedTrackingNumber] = useState('');
  const [remarks, setRemarks] = useState('');
  const [returnOffice, setReturnOffice] = useState<OfficeRole | ''>('');
  const [uploadType, setUploadType] = useState('');
  const [uploadVersionGroup, setUploadVersionGroup] = useState('');
  const [recipientOffice, setRecipientOffice] = useState<OfficeRole | ''>('');
  const [messageBody, setMessageBody] = useState('');
  const routeOffices: OfficeRole[] = [
    ...(processAtRequestingOffice ? [officeRole] : []),
    firstOffice,
    ...(secondOffice ? [secondOffice] : []),
  ];

  const fetchRequests = useCallback(async () => {
    setError('');
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      setError('Sign in with an authorized municipal office account to use inter-office requests.');
      setLoading(false);
      return;
    }
    setUserId(userData.user.id);

    const { data, error: requestError } = await supabase
      .from('workflow_interoffice_requests')
      .select('*')
      .order('updated_at', { ascending: false })
      .limit(250);
    if (requestError) {
      console.error('Inter-office request list failed:', requestError.message);
      setError('Could not load inter-office requests. Apply the inter-office database migration and try again.');
      setLoading(false);
      return;
    }
    setRequests((data ?? []) as InterOfficeRequest[]);
    setLoading(false);
  }, [supabase]);

  const fetchDetails = useCallback(async (requestId: string) => {
    if (!requestId) {
      setSteps([]);
      setDocuments([]);
      setMessages([]);
      setActivity([]);
      return;
    }
    setDetailsLoading(true);
    const [
      { data: stepRows, error: stepsError },
      { data: documentRows, error: documentsError },
      { data: messageRows, error: messagesError },
      { data: activityRows, error: activityError },
    ] = await Promise.all([
      supabase.from('workflow_interoffice_steps')
        .select('*').eq('request_id', requestId).order('sequence_number'),
      supabase.from('workflow_interoffice_documents')
        .select('*').eq('request_id', requestId).order('created_at', { ascending: false }),
      supabase.from('workflow_interoffice_messages')
        .select('*').eq('request_id', requestId).order('created_at', { ascending: true }),
      supabase.from('workflow_interoffice_activity')
        .select('*').eq('request_id', requestId).order('created_at', { ascending: true }),
    ]);
    const failed = [stepsError, documentsError, messagesError, activityError].find(Boolean);
    if (failed) {
      console.error('Inter-office request details failed:', failed.message);
      setError('Could not load this request’s history, documents, or messages.');
    } else {
      setError('');
      setSteps((stepRows ?? []) as InterOfficeStep[]);
      setDocuments((documentRows ?? []) as InterOfficeDocument[]);
      setMessages((messageRows ?? []) as InterOfficeMessage[]);
      setActivity((activityRows ?? []) as InterOfficeActivity[]);
    }
    setDetailsLoading(false);
  }, [supabase]);

  useEffect(() => {
    void fetchRequests();
  }, [fetchRequests]);

  useEffect(() => {
    const requestedId = new URLSearchParams(window.location.search).get('request');
    if (requestedId) setSelectedId(requestedId);
  }, []);

  useEffect(() => {
    void fetchDetails(selectedId);
  }, [fetchDetails, selectedId]);

  const selectedRequest = requests.find((request) => request.id === selectedId) ?? null;

  useEffect(() => {
    let active = true;
    const submissionId = selectedRequest?.related_submission_id;
    if (!submissionId) {
      setCitizenSubmission(null);
      setCitizenDocuments([]);
      return () => { active = false; };
    }

    const fetchCitizenSubmission = async () => {
      const [
        { data: submission, error: submissionError },
        { data: versions, error: versionsError },
        { data: attachments, error: attachmentsError },
      ] = await Promise.all([
        supabase.from('workflow_submissions')
          .select('tracking_number, file_name, file_path, file_type, file_size, created_at')
          .eq('id', submissionId)
          .maybeSingle(),
        supabase.from('workflow_submission_versions')
          .select('id, version_number, file_name, file_path, file_type, file_size, created_at, uploaded_by')
          .eq('submission_id', submissionId)
          .order('version_number', { ascending: false }),
        supabase.from('workflow_submission_attachments')
          .select('id, file_name, file_path, file_type, file_size, created_at, uploaded_by')
          .eq('submission_id', submissionId)
          .order('created_at', { ascending: false }),
      ]);
      if (!active) return;
      if (submissionError || versionsError || attachmentsError) {
        console.error('Linked citizen submission lookup failed:', submissionError?.message ?? versionsError?.message ?? attachmentsError?.message);
        setError('The linked citizen request is not accessible to your office.');
        setCitizenSubmission(null);
        setCitizenDocuments([]);
        return;
      }
      setCitizenSubmission(submission as CitizenSubmission | null);
      const versionRows = (versions ?? []) as CitizenSubmissionDocument[];
      const attachmentRows = (attachments ?? []).map((document) => ({
        ...document,
        version_number: null,
      })) as CitizenSubmissionDocument[];
      if (versionRows.length === 0 && submission?.file_name && submission.file_path && submission.file_type) {
        versionRows.push({
          id: submissionId,
          version_number: 1,
          file_name: submission.file_name,
          file_path: submission.file_path,
          file_type: submission.file_type,
          file_size: submission.file_size ?? 0,
          created_at: submission.created_at,
          uploaded_by: null,
        });
      }
      setCitizenDocuments([...versionRows, ...attachmentRows].sort((first, second) =>
        second.created_at.localeCompare(first.created_at)
      ));
    };
    void fetchCitizenSubmission();
    return () => { active = false; };
  }, [selectedRequest?.related_submission_id, supabase]);
  const incomingRequests = requests.filter((request) =>
    request.current_office === officeRole
    && !['completed', 'approved', 'rejected'].includes(request.status)
  );
  const outgoingRequests = requests.filter((request) => request.requesting_office === officeRole);
  const filteredRequests = filter === 'incoming'
    ? incomingRequests
    : filter === 'outgoing'
      ? outgoingRequests
      : requests;
  const currentStep = steps.find((step) => step.office_role === officeRole);
  const isCurrentOffice = selectedRequest?.current_office === officeRole
    && !['completed', 'approved', 'rejected'].includes(selectedRequest.status);
  const activeStatuses = [
    'under_review',
    'assessment_in_progress',
    'awaiting_supporting_document',
    'for_forwarding',
    'returned_for_revision',
  ];
  const canAct = Boolean(
    selectedRequest && isCurrentOffice && activeStatuses.includes(selectedRequest.office_status)
  );
  const priorSteps = selectedRequest
    ? steps.filter((step) => step.sequence_number < (
        currentStep?.sequence_number ?? Number.MAX_SAFE_INTEGER
      ))
    : [];
  const participatingOffices = selectedRequest
    ? [selectedRequest.requesting_office, ...steps.map((step) => step.office_role)]
        .filter((role, index, list) => list.indexOf(role) === index)
    : [];
  const messageRecipients = participatingOffices.filter((role) => role !== officeRole);
  const requiredUploadType = currentStep?.required_document_type ?? '';
  const latestStepDocuments = currentStep
    ? documents.filter((document) => document.step_id === currentStep.id && !document.message_id)
    : [];
  const latestVersionByGroup = new Map<string, InterOfficeDocument>();
  for (const document of latestStepDocuments) {
    if (document.document_type !== uploadType) continue;
    const current = latestVersionByGroup.get(document.document_group_id);
    if (!current || document.version_number > current.version_number) {
      latestVersionByGroup.set(document.document_group_id, document);
    }
  }
  const availableVersionGroups = [...latestVersionByGroup.values()];

  useEffect(() => {
    if (!messageRecipients.includes(recipientOffice as OfficeRole)) {
      setRecipientOffice(messageRecipients[0] ?? '');
    }
  }, [messageRecipients, recipientOffice]);

  useEffect(() => {
    if (requiredUploadType && !uploadType) setUploadType(requiredUploadType);
  }, [requiredUploadType, uploadType]);

  const refresh = async () => {
    await fetchRequests();
    if (selectedId) await fetchDetails(selectedId);
  };

  useEffect(() => {
    const channel = supabase
      .channel(`interoffice-${officeRole}-${selectedId || 'list'}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'workflow_interoffice_requests',
      }, () => { void Promise.all([fetchRequests(), selectedId ? fetchDetails(selectedId) : Promise.resolve()]); })
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'workflow_interoffice_messages',
      }, () => { void Promise.all([fetchRequests(), selectedId ? fetchDetails(selectedId) : Promise.resolve()]); })
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'workflow_interoffice_documents',
      }, () => { void Promise.all([fetchRequests(), selectedId ? fetchDetails(selectedId) : Promise.resolve()]); })
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'workflow_interoffice_activity',
      }, () => { void Promise.all([fetchRequests(), selectedId ? fetchDetails(selectedId) : Promise.resolve()]); })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [fetchDetails, fetchRequests, officeRole, selectedId, supabase]);

  const selectRequest = (requestId: string) => {
    setSelectedId(requestId);
    router.replace(`/workflow/inter-office?request=${encodeURIComponent(requestId)}`, {
      scroll: false,
    });
    setNotice('');
    setError('');
  };

  const createRequest = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    setNotice('');
    try {
      const offices = routeOffices;
      if (!offices.some((office) => office !== officeRole) || new Set(offices).size !== offices.length) {
        throw new Error('Choose a different receiving office for each step.');
      }

      let relatedSubmissionId: string | null = null;
      if (relatedTrackingNumber.trim()) {
        const { data: submission, error: submissionError } = await supabase
          .from('workflow_submissions')
          .select('id')
          .eq('tracking_number', relatedTrackingNumber.trim())
          .maybeSingle();
        if (submissionError || !submission) {
          throw new Error('That citizen tracking number was not found or is not accessible to your office.');
        }
        relatedSubmissionId = submission.id;
      }

      const { data: requestId, error: createError } = await supabase.rpc(
        'create_interoffice_request',
        {
          request_title: title,
          request_transaction_type: transactionType,
          request_description: description,
          target_office_roles: offices,
          required_document_types: offices.map((office, index) =>
            index === offices.length - 1 ? null : requiredTypes[office] || null
          ),
          requested_submission_id: relatedSubmissionId,
        }
      );
      if (createError) throw createError;
      if (typeof requestId !== 'string') throw new Error('The system did not return a request ID.');

      setTitle('');
      setTransactionType('');
      setDescription('');
      setRelatedTrackingNumber('');
      setRequiredTypes({});
      setProcessAtRequestingOffice(false);
      setShowCreateForm(false);
      setFilter('outgoing');
      setNotice('Inter-office request created and sent to the first receiving office.');
      await fetchRequests();
      selectRequest(requestId);
    } catch (actionError) {
      const message = actionError instanceof Error ? actionError.message : 'Could not create the request.';
      console.error('Inter-office request creation failed:', message);
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  const runAction = async (
    action: 'start_interoffice_review' | 'forward_interoffice_request'
      | 'return_interoffice_request' | 'decide_interoffice_request',
    decision?: 'approve' | 'reject'
  ) => {
    if (!selectedRequest) return;
    setSubmitting(true);
    setError('');
    setNotice('');
    try {
      let result;
      if (action === 'return_interoffice_request') {
        if (!returnOffice) throw new Error('Choose which earlier office should revise the request.');
        result = await supabase.rpc(action, {
          target_request_id: selectedRequest.id,
          target_office_role: returnOffice,
          return_remarks: remarks,
        });
      } else if (action === 'forward_interoffice_request') {
        result = await supabase.rpc(action, {
          target_request_id: selectedRequest.id,
          forwarding_remarks: remarks,
        });
      } else if (action === 'decide_interoffice_request') {
        if (!decision) throw new Error('Choose whether to approve or reject this request.');
        result = await supabase.rpc(action, {
          target_request_id: selectedRequest.id,
          decision,
          decision_remarks: remarks,
        });
      } else {
        result = await supabase.rpc(action, { target_request_id: selectedRequest.id });
      }
      if (result.error) throw result.error;
      setNotice(result.data === 'awaiting_supporting_document'
        ? `Upload the required ${documentName(requiredUploadType)} before forwarding.`
        : 'Request status updated.');
      setRemarks('');
      await refresh();
    } catch (actionError) {
      const message = actionError instanceof Error ? actionError.message : 'Could not update this request.';
      console.error('Inter-office request action failed:', message);
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  const uploadFile = async (
    file: File,
    documentType: string,
    stepId: string | null,
    messageId: string | null,
    versionGroup?: string
  ) => {
    if (!selectedRequest || !userId) throw new Error('The request or user session is unavailable.');
    const mimeType = fileMimeType(file);
    if (!mimeType) throw new Error('Only PDF, DOC, DOCX, JPG, and PNG files are supported.');
    if (file.size === 0 || file.size > 10 * 1024 * 1024) {
      throw new Error('Each file must be no larger than 10 MB.');
    }

    const safeName = file.name.replace(/[^\w.-]/g, '_');
    const path = `${selectedRequest.id}/${userId}/${crypto.randomUUID()}-${safeName}`;
    const { error: storageError } = await supabase.storage
      .from('workflow_interoffice_files')
      .upload(path, file, { contentType: mimeType, upsert: false });
    if (storageError) throw storageError;

    const { error: recordError } = await supabase.from('workflow_interoffice_documents').insert({
      request_id: selectedRequest.id,
      step_id: stepId,
      message_id: messageId,
      uploaded_by: userId,
      uploading_office: officeRole,
      document_type: documentType,
      document_group_id: versionGroup || crypto.randomUUID(),
      file_name: file.name,
      file_path: path,
      file_type: mimeType,
      file_size: file.size,
    });
    if (recordError) {
      const { error: cleanupError } = await supabase.storage
        .from('workflow_interoffice_files')
        .remove([path]);
      if (cleanupError) {
        console.error('Unlinked inter-office file cleanup failed:', cleanupError.message);
      }
      throw recordError;
    }
  };

  const handleUpload = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const fileInput = form.elements.namedItem('interoffice-file') as HTMLInputElement | null;
    const file = fileInput?.files?.[0];
    if (!file || !currentStep) {
      setError('Choose a file and make sure your office has the active request step.');
      return;
    }
    setSubmitting(true);
    setError('');
    setNotice('');
    try {
      await uploadFile(file, uploadType || 'supporting_document', currentStep.id, null, uploadVersionGroup || undefined);
      form.reset();
      setUploadVersionGroup('');
      setNotice('Supporting document uploaded. A new version was added without replacing prior files.');
      await refresh();
    } catch (actionError) {
      const message = actionError instanceof Error ? actionError.message : 'Could not upload this document.';
      console.error('Inter-office document upload failed:', message);
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  const sendMessage = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedRequest || !recipientOffice) {
      setError('Choose a participating office to receive this message.');
      return;
    }
    const form = event.currentTarget;
    const fileInput = form.elements.namedItem('interoffice-message-files') as HTMLInputElement | null;
    const files = Array.from(fileInput?.files ?? []);
    if (!messageBody.trim() && files.length === 0) {
      setError('Enter a message or attach at least one document.');
      return;
    }
    if (files.length > 5) {
      setError('Attach no more than five files to a message.');
      return;
    }

    setSubmitting(true);
    setError('');
    setNotice('');
    try {
      let messageId: string | null = null;
      if (messageBody.trim()) {
        const { data: messageRow, error: messageError } = await supabase
          .from('workflow_interoffice_messages')
          .insert({
            request_id: selectedRequest.id,
            sender_id: userId,
            recipient_office: recipientOffice,
            body: messageBody.trim(),
          })
          .select('id')
          .single();
        if (messageError) throw messageError;
        messageId = messageRow.id;
      }
      if (files.length > 0) {
        if (!messageId) {
          const { data: messageRow, error: messageError } = await supabase
            .from('workflow_interoffice_messages')
            .insert({
              request_id: selectedRequest.id,
              sender_id: userId,
              recipient_office: recipientOffice,
              body: 'Supporting document attached.',
            })
            .select('id')
            .single();
          if (messageError) throw messageError;
          messageId = messageRow.id;
        }
        for (const file of files) {
          await uploadFile(file, 'message_attachment', null, messageId);
        }
      }
      setMessageBody('');
      form.reset();
      setNotice('Message sent to ' + officeName(recipientOffice) + '.');
      await refresh();
    } catch (actionError) {
      const message = actionError instanceof Error ? actionError.message : 'Could not send this message.';
      console.error('Inter-office message send failed:', message);
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  const openDocument = async (document: InterOfficeDocument) => {
    const { data, error: signedUrlError } = await supabase.storage
      .from('workflow_interoffice_files')
      .createSignedUrl(document.file_path, 60);
    if (signedUrlError || !data?.signedUrl) {
      console.error('Inter-office document URL failed:', signedUrlError?.message);
      setError('Could not open this document. Confirm your office is authorized to access it.');
      return;
    }
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
  };

  const openCitizenDocument = async (document: CitizenSubmissionDocument) => {
    const { data, error: signedUrlError } = await supabase.storage
      .from('workflow_uploads')
      .createSignedUrl(document.file_path, 60);
    if (signedUrlError || !data?.signedUrl) {
      console.error('Linked citizen document URL failed:', signedUrlError?.message);
      setError('Could not open the original citizen-submitted document.');
      return;
    }
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
  };
  const activeFilterCount = filter === 'incoming'
    ? incomingRequests.length
    : filter === 'outgoing'
      ? outgoingRequests.length
      : requests.length;

  return (
    <div className="w-full">
      <header className="mb-7 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-2 text-[11px] font-medium text-muted-text">Office workspace</p>
          <h1 className="font-serif text-[32px] leading-tight text-warm-text max-md:text-[26px]">
            Inter-Office Requests
          </h1>
          <p className="mt-2 text-xs text-muted-text">
            Send, assess, forward, and track office-to-office transactions.
          </p>
        </div>
        <button
          type="button"
          onClick={() => { setShowCreateForm((open) => !open); setError(''); }}
          className="h-11 rounded-full bg-clay px-5 text-xs font-semibold text-white hover:bg-warm-text"
        >
          {showCreateForm ? 'Close form' : 'New inter-office request'}
        </button>
      </header>

      {error && <p role="alert" className="mb-4 rounded-xl border border-rejected-bg bg-rejected-bg/50 px-4 py-3 text-xs text-rejected-text">{error}</p>}
      {notice && <p role="status" className="mb-4 rounded-xl border border-approved-bg bg-approved-bg/50 px-4 py-3 text-xs text-approved-text">{notice}</p>}

      {showCreateForm && (
        <form onSubmit={createRequest} className="mb-6 space-y-4 rounded-2xl border border-warm-border bg-card p-5">
          <h2 className="text-sm font-semibold text-warm-text">Create a request</h2>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="space-y-1.5 text-[11px] font-medium text-muted-text">
              Request title
              <input className={inputClass} value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} required />
            </label>
            <label className="space-y-1.5 text-[11px] font-medium text-muted-text">
              Transaction type
              <input className={inputClass} value={transactionType} onChange={(event) => setTransactionType(event.target.value)} maxLength={100} placeholder="Assessment, verification, permit..." required />
            </label>
            <label className="space-y-1.5 text-[11px] font-medium text-muted-text md:col-span-2">
              Request details and instructions
              <textarea className="min-h-24 w-full rounded-xl border border-warm-border bg-card p-3 text-xs text-warm-text outline-none focus:border-clay" value={description} onChange={(event) => setDescription(event.target.value)} maxLength={5000} required />
            </label>
            <label className="space-y-1.5 text-[11px] font-medium text-muted-text">
              First receiving office
              <select className={inputClass} value={firstOffice} onChange={(event) => setFirstOffice(event.target.value as OfficeRole)}>
                {OFFICE_ROLES.filter((office) => office !== officeRole).map((office) => <option key={office} value={office}>{officeName(office)}</option>)}
              </select>
            </label>
            <label className="space-y-1.5 text-[11px] font-medium text-muted-text">
              Next office (optional)
              <select className={inputClass} value={secondOffice} onChange={(event) => setSecondOffice(event.target.value as OfficeRole | '')}>
                <option value="">No additional office</option>
                {OFFICE_ROLES.filter((office) => office !== officeRole && office !== firstOffice).map((office) => <option key={office} value={office}>{officeName(office)}</option>)}
              </select>
            </label>
            <label className="flex items-start gap-2 text-[11px] text-muted-text md:col-span-2">
              <input
                type="checkbox"
                checked={processAtRequestingOffice}
                onChange={(event) => setProcessAtRequestingOffice(event.target.checked)}
                className="mt-0.5 accent-clay"
              />
              <span>Include {officeName(officeRole)} as the first processing office before forwarding to the selected offices.</span>
            </label>
            {routeOffices.map((office, index, route) => (
              index < route.length - 1 && (
                <label key={office} className="space-y-1.5 text-[11px] font-medium text-muted-text">
                  {officeName(office)} must provide before forwarding
                  <select
                    className={inputClass}
                    value={requiredTypes[office] ?? ''}
                    onChange={(event) => setRequiredTypes((current) => ({ ...current, [office]: event.target.value }))}
                  >
                    <option value="">No report required</option>
                    {DOCUMENT_TYPES.map((document) => <option key={document.value} value={document.value}>{document.label}</option>)}
                  </select>
                </label>
              )
            ))}
            <label className="space-y-1.5 text-[11px] font-medium text-muted-text md:col-span-2">
              Link an existing citizen request (optional tracking number)
              <input className={inputClass} value={relatedTrackingNumber} onChange={(event) => setRelatedTrackingNumber(event.target.value)} placeholder="For example: DAET-2026-000123" />
            </label>
          </div>
          <p className="text-[11px] text-muted-text">The requesting office can be included as the first processing step. Each route is checked by the database, and a required assessment or document must be uploaded before forwarding.</p>
          <button type="submit" disabled={submitting} className="h-11 rounded-full bg-clay px-5 text-xs font-semibold text-white disabled:opacity-50">
            {submitting ? 'Creating request...' : 'Create and send'}
          </button>
        </form>
      )}

      <section aria-label="Inter-office request summaries" className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
        {[
          { label: 'Incoming', count: incomingRequests.length },
          { label: 'Outgoing', count: outgoingRequests.length },
          { label: 'Awaiting assessment', count: incomingRequests.filter((request) => request.office_status === 'assessment_in_progress').length },
          { label: 'Awaiting document', count: incomingRequests.filter((request) => request.office_status === 'awaiting_supporting_document').length },
          { label: 'For forwarding', count: incomingRequests.filter((request) => request.office_status === 'for_forwarding').length },
          { label: 'Completed', count: requests.filter((request) => request.status === 'completed').length },
        ].map((item) => (
          <div key={item.label} className="rounded-xl border border-warm-border bg-card px-3 py-3">
            <p className="text-[10px] text-muted-text">{item.label}</p>
            <p className="mt-1 text-lg font-semibold text-warm-text">{item.count}</p>
          </div>
        ))}
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(280px,0.8fr)_minmax(0,1.5fr)]">
        <section className="min-w-0 rounded-2xl border border-warm-border bg-card p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="flex gap-2">
              {(['incoming', 'outgoing', 'all'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setFilter(value)}
                  aria-pressed={filter === value}
                  className={`rounded-full px-3 py-2 text-[11px] font-medium capitalize ${filter === value ? 'bg-clay text-white' : 'bg-sidebar text-muted-text'}`}
                >
                  {value}
                </button>
              ))}
            </div>
            <span className="text-[10px] text-muted-text">{activeFilterCount}</span>
          </div>
          {loading ? (
            <p className="py-8 text-center text-xs text-muted-text">Loading requests...</p>
          ) : filteredRequests.length === 0 ? (
            <p className="rounded-xl bg-sidebar px-4 py-8 text-center text-xs text-muted-text">No requests in this view.</p>
          ) : (
            <div className="max-h-[70vh] space-y-2 overflow-y-auto">
              {filteredRequests.map((request) => (
                <button
                  key={request.id}
                  type="button"
                  onClick={() => selectRequest(request.id)}
                  className={`w-full rounded-xl border p-3 text-left ${selectedId === request.id ? 'border-clay bg-clay-soft/30' : 'border-warm-border hover:bg-sidebar'}`}
                >
                  <span className="block text-[10px] font-semibold text-clay">{request.reference_number}</span>
                  <span className="mt-1 block truncate text-xs font-semibold text-warm-text">{request.title}</span>
                  <span className="mt-1 block text-[10px] capitalize text-muted-text">
                    {statusName(request.status)} overall · {statusName(request.office_status)} here
                    · Current: {officeName(request.current_office)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="min-w-0 space-y-4">
          {!selectedRequest ? (
            <div className="rounded-2xl border border-warm-border bg-card p-10 text-center">
              <h2 className="font-serif text-2xl text-warm-text">Select a request</h2>
              <p className="mt-2 text-xs text-muted-text">Incoming and outgoing transactions will appear here.</p>
            </div>
          ) : detailsLoading ? (
            <div className="rounded-2xl border border-warm-border bg-card p-8 text-xs text-muted-text">Loading request details...</div>
          ) : (
            <>
              <article className="rounded-2xl border border-warm-border bg-card p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-semibold text-clay">{selectedRequest.reference_number}</p>
                    <h2 className="mt-1 font-serif text-2xl text-warm-text">{selectedRequest.title}</h2>
                    <p className="mt-1 text-[11px] text-muted-text">{selectedRequest.transaction_type}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className="rounded-full bg-sidebar px-3 py-1.5 text-[11px] font-medium capitalize text-warm-text">{statusName(selectedRequest.status)} overall</span>
                    <span className="text-[10px] capitalize text-muted-text">{statusName(selectedRequest.office_status)} at current office</span>
                  </div>
                </div>
                <p className="mt-4 whitespace-pre-wrap text-xs leading-6 text-warm-text">{selectedRequest.description}</p>
                <dl className="mt-4 grid gap-2 border-t border-warm-border pt-4 text-[11px] sm:grid-cols-2">
                  <div><dt className="text-muted-text">Requesting office</dt><dd className="mt-1 font-medium">{officeName(selectedRequest.requesting_office)}</dd></div>
                  <div><dt className="text-muted-text">Current processing office</dt><dd className="mt-1 font-medium">{officeName(selectedRequest.current_office)}</dd></div>
                  <div><dt className="text-muted-text">Final approval office</dt><dd className="mt-1 font-medium">{officeName(selectedRequest.final_approval_office)}</dd></div>
                  <div><dt className="text-muted-text">Created</dt><dd className="mt-1 font-medium">{new Date(selectedRequest.created_at).toLocaleString()}</dd></div>
                  {citizenSubmission && <div className="sm:col-span-2"><dt className="text-muted-text">Linked citizen submission</dt><dd className="mt-1 font-medium">{citizenSubmission.tracking_number}</dd></div>}
                </dl>
              </article>

              {selectedRequest.related_submission_id && (
                <section className="rounded-2xl border border-warm-border bg-card p-5">
                  <h3 className="mb-1 text-xs font-semibold text-warm-text">Original citizen-submitted documents</h3>
                  <p className="mb-3 text-[10px] text-muted-text">These files remain unchanged; later revisions are listed as separate versions.</p>
                  {citizenDocuments.length === 0 ? (
                    <p className="text-[11px] text-muted-text">No original submission files are available to this office.</p>
                  ) : (
                    <ul className="space-y-2">
                      {citizenDocuments.map((document) => (
                        <li key={document.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-sidebar p-3 text-[11px]">
                          <div className="min-w-0">
                            <p className="truncate font-medium text-warm-text">{document.file_name}{document.version_number ? <span className="text-muted-text"> v{document.version_number}</span> : null}</p>
                            <p className="mt-1 text-[10px] text-muted-text">Citizen submission · {document.file_type ?? 'File'} · {new Date(document.created_at).toLocaleString()}</p>
                          </div>
                          <button type="button" onClick={() => void openCitizenDocument(document)} className="h-9 shrink-0 rounded-full border border-warm-border px-3 text-[10px] font-semibold">Preview / download</button>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              )}

              <section className="rounded-2xl border border-warm-border bg-card p-5">
                <h3 className="mb-3 text-xs font-semibold text-warm-text">Office approval workflow</h3>
                <ol className="space-y-2">
                  {steps.map((step) => (
                    <li key={step.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-sidebar px-3 py-2.5 text-[11px]">
                      <span className="font-medium">{step.sequence_number}. {officeName(step.office_role)}{step.is_final_approver ? ' · final approval' : ''}</span>
                      <span className="capitalize text-muted-text">{statusName(step.status)}{step.assessment_required_before_forward ? ` · requires ${documentName(step.required_document_type ?? '')}` : ''}</span>
                    </li>
                  ))}
                </ol>
                {isCurrentOffice && (
                  <div className="mt-4 space-y-3 border-t border-warm-border pt-4">
                    <textarea
                      aria-label="Action remarks"
                      className="min-h-20 w-full rounded-xl border border-warm-border bg-card p-3 text-xs outline-none focus:border-clay"
                      placeholder="Remarks or findings (required for return, approval, or rejection)"
                      value={remarks}
                      onChange={(event) => setRemarks(event.target.value)}
                      maxLength={2000}
                    />
                    <div className="flex flex-wrap gap-2">
                      {['received', 'returned_for_revision'].includes(selectedRequest.office_status) && (
                        <button type="button" disabled={submitting} onClick={() => void runAction('start_interoffice_review')} className="h-10 rounded-full border border-warm-border px-4 text-[11px] font-semibold">Start review</button>
                      )}
                      {canAct && !currentStep?.is_final_approver && (
                        <button type="button" disabled={submitting} onClick={() => void runAction('forward_interoffice_request')} className="h-10 rounded-full bg-clay px-4 text-[11px] font-semibold text-white">Forward to next office</button>
                      )}
                      {canAct && currentStep?.is_final_approver && (
                        <button type="button" disabled={submitting || !remarks.trim()} onClick={() => void runAction('decide_interoffice_request', 'approve')} className="h-10 rounded-full bg-approved-text px-4 text-[11px] font-semibold text-white disabled:opacity-50">Approve request</button>
                      )}
                      {canAct && priorSteps.length > 0 && (
                        <>
                          <select className="h-10 rounded-full border border-warm-border bg-card px-3 text-[11px]" value={returnOffice} onChange={(event) => setReturnOffice(event.target.value as OfficeRole | '')}>
                            <option value="">Return to earlier office...</option>
                            {priorSteps.map((step) => <option key={step.id} value={step.office_role}>{officeName(step.office_role)}</option>)}
                          </select>
                          <button type="button" disabled={submitting || !remarks.trim()} onClick={() => void runAction('return_interoffice_request')} className="h-10 rounded-full border border-pending-text px-4 text-[11px] font-semibold text-pending-text">Return for revision</button>
                        </>
                      )}
                      {canAct && (
                        <button
                          type="button"
                          disabled={submitting || !remarks.trim()}
                          onClick={() => {
                            if (!window.confirm('Reject this request? This ends the inter-office workflow.')) return;
                            void runAction('decide_interoffice_request', 'reject');
                          }}
                          className="h-10 rounded-full border border-rejected-text px-4 text-[11px] font-semibold text-rejected-text"
                        >
                          Reject request
                        </button>
                      )}
                    </div>
                    <p className="text-[10px] text-muted-text">Approval, rejection, and return actions require remarks. A required report blocks forwarding until the correct document is uploaded.</p>
                  </div>
                )}
              </section>

              {isCurrentOffice && canAct && (
                <section className="rounded-2xl border border-warm-border bg-card p-5">
                  <h3 className="mb-3 text-xs font-semibold text-warm-text">Supporting documents</h3>
                  {requiredUploadType && <p className="mb-3 text-[11px] text-pending-text">Required before forwarding: {documentName(requiredUploadType)}</p>}
                  <form onSubmit={handleUpload} className="grid gap-3 sm:grid-cols-2">
                    <label className="space-y-1.5 text-[10px] font-medium text-muted-text">
                      Document type
                      <select className={inputClass} value={uploadType} onChange={(event) => setUploadType(event.target.value)}>
                        {DOCUMENT_TYPES.map((document) => <option key={document.value} value={document.value}>{document.label}</option>)}
                      </select>
                    </label>
                    <label className="space-y-1.5 text-[10px] font-medium text-muted-text">
                      Version history
                      <select className={inputClass} value={uploadVersionGroup} onChange={(event) => setUploadVersionGroup(event.target.value)}>
                        <option value="">Upload as a new document</option>
                        {availableVersionGroups.map((document) => (
                          <option key={document.document_group_id} value={document.document_group_id}>
                            Update {document.file_name} (latest v{document.version_number})
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="space-y-1.5 text-[10px] font-medium text-muted-text sm:col-span-2">
                      File (PDF, DOC, DOCX, JPG, PNG; up to 10 MB)
                      <input name="interoffice-file" type="file" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" required className="block w-full text-xs" />
                    </label>
                    <button type="submit" disabled={submitting} className="h-10 rounded-full bg-clay px-4 text-[11px] font-semibold text-white disabled:opacity-50 sm:col-span-2">
                      {submitting ? 'Uploading...' : 'Upload supporting document'}
                    </button>
                  </form>
                </section>
              )}

              <section className="rounded-2xl border border-warm-border bg-card p-5">
                <h3 className="mb-3 text-xs font-semibold text-warm-text">Supporting document history</h3>
                {documents.filter((document) => !document.message_id).length === 0 ? (
                  <p className="text-[11px] text-muted-text">No supporting documents have been uploaded.</p>
                ) : (
                  <ul className="space-y-2">
                    {documents.filter((document) => !document.message_id).map((document) => (
                      <li key={document.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-sidebar p-3 text-[11px]">
                        <div className="min-w-0">
                          <p className="truncate font-medium text-warm-text">{document.file_name} <span className="text-muted-text">v{document.version_number}</span></p>
                          <p className="mt-1 text-[10px] text-muted-text">{documentName(document.document_type)} · {officeName(document.uploading_office)} · {document.uploader_name} · {new Date(document.created_at).toLocaleString()}</p>
                        </div>
                        <button type="button" onClick={() => void openDocument(document)} className="h-9 shrink-0 rounded-full border border-warm-border px-3 text-[10px] font-semibold">Preview / download</button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section className="rounded-2xl border border-warm-border bg-card p-5">
                <h3 className="mb-3 text-xs font-semibold text-warm-text">Office-to-office communication</h3>
                <div className="mb-4 max-h-80 space-y-3 overflow-y-auto">
                  {messages.length === 0 ? <p className="text-[11px] text-muted-text">No messages yet.</p> : messages.map((message) => (
                    <article key={message.id} className="rounded-xl bg-sidebar p-3">
                      <p className="text-[10px] font-semibold text-clay">{officeName(message.sender_office)} · {message.sender_name} → {officeName(message.recipient_office)}</p>
                      <p className="mt-2 whitespace-pre-wrap text-xs text-warm-text">{message.body}</p>
                      <p className="mt-2 text-[9px] text-muted-text">{new Date(message.created_at).toLocaleString()}</p>
                      {documents.filter((document) => document.message_id === message.id).map((document) => (
                        <button key={document.id} type="button" onClick={() => void openDocument(document)} className="mt-2 block text-[10px] font-medium text-clay underline">
                          Attachment: {document.file_name}
                        </button>
                      ))}
                    </article>
                  ))}
                </div>
                {messageRecipients.length > 0 && (
                  <form onSubmit={sendMessage} className="space-y-2 border-t border-warm-border pt-4">
                    <label className="block text-[10px] font-medium text-muted-text">
                      Send to
                      <select className={`${inputClass} mt-1`} value={recipientOffice} onChange={(event) => setRecipientOffice(event.target.value as OfficeRole)}>
                        {messageRecipients.map((office) => <option key={office} value={office}>{officeName(office)}</option>)}
                      </select>
                    </label>
                    <textarea className="min-h-20 w-full rounded-xl border border-warm-border bg-card p-3 text-xs outline-none focus:border-clay" value={messageBody} onChange={(event) => setMessageBody(event.target.value)} maxLength={5000} placeholder="Write a request-specific message or clarification..." />
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <input name="interoffice-message-files" type="file" multiple accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" className="max-w-full text-[10px]" />
                      <button type="submit" disabled={submitting} className="h-10 rounded-full bg-clay px-4 text-[11px] font-semibold text-white disabled:opacity-50">
                        {submitting ? 'Sending...' : 'Send message'}
                      </button>
                    </div>
                    <p className="text-[10px] text-muted-text">Messages and attachments remain attached to this request. Up to five files, 10 MB each.</p>
                  </form>
                )}
              </section>

              <section className="rounded-2xl border border-warm-border bg-card p-5">
                <h3 className="mb-3 text-xs font-semibold text-warm-text">Complete transaction history</h3>
                {activity.length === 0 ? <p className="text-[11px] text-muted-text">No activity recorded.</p> : (
                  <ol className="space-y-3">
                    {activity.map((event) => (
                      <li key={event.id} className="border-l-2 border-clay pl-3">
                        <p className="text-[11px] font-medium capitalize text-warm-text">{event.action_type.replaceAll('_', ' ')}{event.actor_office ? ` · ${officeName(event.actor_office)}` : ''}{event.actor_name ? ` · ${event.actor_name}` : ''}</p>
                        {event.remarks && <p className="mt-1 text-[10px] text-muted-text">{event.remarks}</p>}
                        <p className="mt-1 text-[9px] text-muted-text">{new Date(event.created_at).toLocaleString()}{event.target_office ? ` · To ${officeName(event.target_office)}` : ''}</p>
                      </li>
                    ))}
                  </ol>
                )}
              </section>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

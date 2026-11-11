'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode, type Ref } from 'react';
import { createClient } from '@/lib/supabase/client';
import { downloadFile } from '@/components/FilePreview';
import {
  getWorkflowFileMimeType,
  getWorkflowFilesTypeError,
  WORKFLOW_ATTACHMENT_ACCEPT,
} from '@/lib/workflow/file-types';
import CloseSubmissionDialog from '@/components/CloseSubmissionDialog';

const PAGE_SIZE = 50;
const MAX_ATTACHMENTS = 5;
const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024;
const MESSAGE_FIELDS = 'id, submission_id, sender_id, sender_name, sender_role, body, created_at';

// ─── Icons & small UI helpers ────────────────────────────────────────────────
type IconName = 'clock' | 'file' | 'info' | 'message' | 'paperclip' | 'send' | 'x';

function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, ReactNode> = {
    clock: (<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>),
    file: (<><path d="M6 2h8l4 4v16H6z" /><path d="M14 2v5h5M9 13h6M9 17h6" /></>),
    info: (<><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>),
    message: <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" />,
    paperclip: <path d="m20 11-8.5 8.5a5 5 0 0 1-7-7L14 3a3.5 3.5 0 0 1 5 5l-9.5 9.5a2 2 0 0 1-3-3L15 6" />,
    send: (<><path d="m22 2-7 20-4-9-9-4z" /><path d="M22 2 11 13" /></>),
    x: <path d="m6 6 12 12M18 6 6 18" />,
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

const getInitials = (name: string) =>
  (name || '?').split(/\s+/).filter(Boolean).map((part) => part[0]).slice(0, 2).join('').toUpperCase() || '?';

function AttachControl({ id, inputRef, disabled, limit, onFiles }: {
  id: string;
  inputRef: Ref<HTMLInputElement>;
  disabled: boolean;
  limit: number;
  onFiles: (files: File[]) => void;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <input
        ref={inputRef}
        id={id}
        type="file"
        accept={WORKFLOW_ATTACHMENT_ACCEPT}
        multiple
        disabled={disabled}
        onChange={(event) => {
          onFiles(Array.from(event.target.files ?? []));
          event.target.value = '';
        }}
        className="peer sr-only"
      />
      <label
        htmlFor={id}
        aria-disabled={disabled}
        className={`inline-flex h-10 items-center gap-2 rounded-full border border-warm-border bg-white px-4 text-[11px] font-bold text-warm-text transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-clay/30 ${
          disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:border-clay hover:bg-clay-soft'
        }`}
      >
        <Icon name="paperclip" size={15} /> Attach file
      </label>
      <span className="hidden text-[10px] leading-tight text-muted-text sm:block">
        Up to {limit} files · 10 MB each
      </span>
    </div>
  );
}

function FileChips({ files, disabled, onRemove }: {
  files: File[];
  disabled: boolean;
  onRemove: (file: File) => void;
}) {
  if (files.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-1.5">
      {files.map((file) => (
        <li
          key={`${file.name}-${file.size}-${file.lastModified}`}
          className="inline-flex max-w-full items-center gap-2 rounded-full border border-warm-border bg-white px-2.5 py-1 text-[10px] font-medium text-warm-text"
        >
          <Icon name="file" size={12} />
          <span className="max-w-52 truncate">{file.name}</span>
          <button
            type="button"
            onClick={() => onRemove(file)}
            disabled={disabled}
            aria-label={`Remove ${file.name}`}
            className="text-muted-text hover:text-rejected-text disabled:opacity-50"
          >
            <Icon name="x" size={12} />
          </button>
        </li>
      ))}
    </ul>
  );
}

interface MessageRow {
  id: string;
  submission_id: string;
  sender_id: string;
  sender_name: string;
  sender_role: string;
  body: string;
  created_at: string;
}

interface MessageAttachment {
  id: string;
  submission_id: string;
  message_id: string;
  file_name: string;
  file_path: string;
  file_type: string;
  file_size: number;
}

interface SharedMessageAttachment extends MessageAttachment {
  created_at: string;
}

interface Message extends MessageRow {
  attachments: MessageAttachment[];
  readCount: number;
}

interface MessageRead {
  message_id: string;
  user_id: string;
}

interface DocumentMessagingProps {
  submissionId: string;
  fileName: string;
  trackingNumber: string | null;
  activity: ReactNode;
  workflowComposer?: {
    recipients: { value: string; label: string }[];
    actionsByRecipient: Record<string, ComposerAction[]>;
    initialRecipient: string;
    initialAction: string;
    initialMessage?: string;
    statusLine: string;
    processingNote?: string;
    contextNote?: string;
    isClosed?: boolean;
    closedMessage?: string;
    busy?: boolean;
    pendingAssignmentCount?: number;
    sidebarContent?: ReactNode;
    sourceDocument?: {
      filePath: string | null;
      fileType: string;
      fileSize: number;
    };
    renderActionFields?: (action: string) => ReactNode;
    onWorkflowAction: (
      action: string,
      recipient: string,
      message: string,
      files: File[],
    ) => Promise<void>;
    onForwarded?: () => Promise<void>;
  };
}

interface ComposerAction {
  value: string;
  label: string;
  buttonLabel?: string;
  tone?: 'neutral' | 'primary' | 'warning' | 'strong';
  unavailableReason?: string;
  requiresMessage?: boolean;
  confirmation?: string;
}

interface UploadedAttachment {
  submission_id: string;
  message_id: string;
  uploaded_by: string;
  file_name: string;
  file_path: string;
  file_type: string;
  file_size: number;
}

const FALLBACK_NO_ACTION: ComposerAction = {
  value: '',
  label: 'No action available',
  tone: 'neutral',
  unavailableReason: 'There are no workflow actions available for this recipient.',
};

const mergeMessages = (current: Message[], incoming: Message[]) => {
  const messages = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) messages.set(message.id, message);
  return [...messages.values()].sort((first, second) =>
    first.created_at.localeCompare(second.created_at) || first.id.localeCompare(second.id)
  );
};

export default function DocumentMessaging({
  submissionId,
  fileName,
  trackingNumber,
  activity,
  workflowComposer,
}: DocumentMessagingProps) {
  const supabase = useMemo(() => createClient(), []);
  const [userId, setUserId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [sharedAttachments, setSharedAttachments] = useState<SharedMessageAttachment[]>([]);
  // Office action form state
  const [draft, setDraft] = useState(workflowComposer?.initialMessage ?? '');
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  // Message composer state
  const [conversationDraft, setConversationDraft] = useState('');
  const [conversationFiles, setConversationFiles] = useState<File[]>([]);
  const [conversationError, setConversationError] = useState('');
  const [conversationNotice, setConversationNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [hasEarlier, setHasEarlier] = useState(false);
  const [sending, setSending] = useState(false);
  const [liveStatus, setLiveStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');
  const [selectedRecipient, setSelectedRecipient] = useState(workflowComposer?.initialRecipient ?? 'submitter');
  const [selectedAction, setSelectedAction] = useState(workflowComposer?.initialAction ?? '');
  const [confirmingAction, setConfirmingAction] = useState<ComposerAction | null>(null);
  const [closeDialogOpen, setCloseDialogOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messageInputRef = useRef<HTMLTextAreaElement>(null);
  const conversationInputRef = useRef<HTMLTextAreaElement>(null);
  const conversationFileInputRef = useRef<HTMLInputElement>(null);
  const messagesRef = useRef<Message[]>([]);
  const listRef = useRef<HTMLDivElement>(null);
  const isOfficeWorkspace = Boolean(workflowComposer?.sidebarContent);

  // Actions depend on the selected recipient. Conversation messages have a separate composer.
  const recipientActions = workflowComposer?.actionsByRecipient[selectedRecipient] ?? [];
  const actionList = recipientActions.length > 0 ? recipientActions : [FALLBACK_NO_ACTION];
  const currentAction = actionList.find((action) => action.value === selectedAction) ?? actionList[0];
  const recipientLabel = workflowComposer?.recipients.find((recipient) => recipient.value === selectedRecipient)?.label
    ?? 'recipient';
  const actionDisabled = sending || Boolean(workflowComposer?.busy) || Boolean(workflowComposer?.isClosed);
  const conversationDisabled = actionDisabled || !userId;
  const actionAttachLimit = currentAction.value === 'forward' ? MAX_ATTACHMENTS - 1 : MAX_ATTACHMENTS;

  useEffect(() => {
    if (!workflowComposer) return;
    setSelectedRecipient(workflowComposer.initialRecipient);
    setSelectedAction(workflowComposer.initialAction);
  }, [submissionId, workflowComposer?.initialAction, workflowComposer?.initialRecipient]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const lastMessageId = messages[messages.length - 1]?.id;
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [lastMessageId, loading]);

  const refreshMessageMetadata = useCallback(async (rows: MessageRow[]) => {
    if (rows.length === 0) return [] as Message[];
    const messageIds = rows.map((message) => message.id);
    const [
      { data: attachments, error: attachmentsError },
      { data: reads, error: readsError },
    ] = await Promise.all([
      supabase
        .from('workflow_message_attachments')
        .select('id, submission_id, message_id, file_name, file_path, file_type, file_size')
        .in('message_id', messageIds),
      supabase
        .from('workflow_message_reads')
        .select('message_id, user_id')
        .in('message_id', messageIds),
    ]);

    if (attachmentsError) throw new Error(`Could not load message attachments: ${attachmentsError.message}`);
    if (readsError) throw new Error(`Could not load message read status: ${readsError.message}`);

    const attachmentsByMessage = new Map<string, MessageAttachment[]>();
    for (const attachment of attachments ?? []) {
      const current = attachmentsByMessage.get(attachment.message_id) ?? [];
      current.push(attachment);
      attachmentsByMessage.set(attachment.message_id, current);
    }

    const readCounts = new Map<string, number>();
    for (const read of (reads ?? []) as MessageRead[]) {
      readCounts.set(read.message_id, (readCounts.get(read.message_id) ?? 0) + 1);
    }

    return rows.map((message) => ({
      ...message,
      attachments: attachmentsByMessage.get(message.id) ?? [],
      readCount: readCounts.get(message.id) ?? 0,
    }));
  }, [supabase]);

  const refreshSharedAttachments = useCallback(async () => {
    const { data, error: attachmentsError } = await supabase
      .from('workflow_message_attachments')
      .select('id, submission_id, message_id, file_name, file_path, file_type, file_size, created_at')
      .eq('submission_id', submissionId)
      .order('created_at', { ascending: false });

    if (attachmentsError) {
      console.error('Could not load shared document attachments:', attachmentsError.message);
      setConversationError('Could not load files shared in messages. Refresh the page to try again.');
      return;
    }

    setSharedAttachments(data ?? []);
  }, [submissionId, supabase]);

  const markMessagesRead = useCallback(async (rows: MessageRow[], readerId: string) => {
    const unreadMessages = rows.filter((message) => message.sender_id !== readerId);
    if (unreadMessages.length === 0) return;

    const { data: existingReads, error: readsError } = await supabase
      .from('workflow_message_reads')
      .select('message_id')
      .eq('user_id', readerId)
      .in('message_id', unreadMessages.map((message) => message.id));
    if (readsError) throw new Error(`Could not check message read status: ${readsError.message}`);

    const readIds = new Set((existingReads ?? []).map((read) => read.message_id));
    const newReads = unreadMessages
      .filter((message) => !readIds.has(message.id))
      .map((message) => ({
        submission_id: submissionId,
        message_id: message.id,
        user_id: readerId,
      }));

    if (newReads.length === 0) return;
    const { error } = await supabase
      .from('workflow_message_reads')
      .upsert(newReads, { onConflict: 'message_id,user_id', ignoreDuplicates: true });
    if (error) throw new Error(`Could not mark messages as read: ${error.message}`);
  }, [submissionId, supabase]);

  const fetchPage = useCallback(async (readerId: string, before?: MessageRow) => {
    let query = supabase
      .from('workflow_messages')
      .select(MESSAGE_FIELDS)
      .eq('submission_id', submissionId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(PAGE_SIZE);

    if (before) {
      query = query.or(
        `created_at.lt.${before.created_at},and(created_at.eq.${before.created_at},id.lt.${before.id})`
      );
    }

    const { data, error: messagesError } = await query;
    if (messagesError) throw new Error(`Could not load document messages: ${messagesError.message}`);

    const rows = (data ?? []) as MessageRow[];
    await markMessagesRead(rows, readerId);
    const page = await refreshMessageMetadata(rows);
    return page.reverse();
  }, [markMessagesRead, refreshMessageMetadata, submissionId, supabase]);

  const refreshLatest = useCallback(async (readerId: string) => {
    const page = await fetchPage(readerId);
    setHasEarlier(page.length === PAGE_SIZE);
    setMessages((current) => mergeMessages(current, page));
  }, [fetchPage]);

  const refreshVisibleMetadata = useCallback(async () => {
    const visible = messagesRef.current;
    if (visible.length === 0) return;
    const updated = await refreshMessageMetadata(visible);
    setMessages((current) => mergeMessages(current, updated));
  }, [refreshMessageMetadata]);

  useEffect(() => {
    let active = true;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    const initialize = async () => {
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError) throw new Error(`Could not verify your session: ${authError.message}`);
      if (!user) throw new Error('Sign in to view this conversation.');
      if (!active) return;

      setLiveStatus('connecting');
      setLoading(true);
      setMessages([]);
      setHasEarlier(false);
      setError('');
      setNotice('');
      setUserId(user.id);
      const page = await fetchPage(user.id);
      if (!active) return;
      setMessages(page);
      setHasEarlier(page.length === PAGE_SIZE);
      setLoading(false);
      await refreshSharedAttachments();
      if (!active) return;

      channel = supabase
        .channel(`document-messages-${submissionId}-${user.id}`)
        .on('postgres_changes', {
          event: 'INSERT',
          schema: 'public',
          table: 'workflow_messages',
          filter: `submission_id=eq.${submissionId}`,
        }, () => {
          void refreshLatest(user.id).catch((loadError: unknown) => {
            console.error('Live document message refresh failed:', loadError);
            if (active) setError(loadError instanceof Error ? loadError.message : 'Could not refresh messages.');
          });
        })
        .on('postgres_changes', {
          event: 'INSERT',
          schema: 'public',
          table: 'workflow_message_attachments',
          filter: `submission_id=eq.${submissionId}`,
        }, () => {
          void refreshLatest(user.id).catch((loadError: unknown) => {
            console.error('Live message attachment refresh failed:', loadError);
            if (active) setError(loadError instanceof Error ? loadError.message : 'Could not refresh attachments.');
          });
          void refreshSharedAttachments();
        })
        .on('postgres_changes', {
          event: 'INSERT',
          schema: 'public',
          table: 'workflow_message_reads',
          filter: `submission_id=eq.${submissionId}`,
        }, () => {
          void refreshVisibleMetadata().catch((loadError: unknown) => {
            console.error('Live message read receipt refresh failed:', loadError);
            if (active) setError(loadError instanceof Error ? loadError.message : 'Could not refresh read receipts.');
          });
        })
        .subscribe((status) => {
          if (!active) return;
          if (status === 'SUBSCRIBED') {
            setLiveStatus('connected');
            setError((current) =>
              current === 'Live updates are unavailable. You can still send and reload messages.'
                ? ''
                : current
            );
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            setLiveStatus('disconnected');
            setError('Live updates are unavailable. You can still send and reload messages.');
          }
        });
    };

    void initialize().catch((loadError: unknown) => {
      console.error('Document conversation initialization failed:', loadError);
      if (active) {
        setError(loadError instanceof Error ? loadError.message : 'Could not load this conversation.');
        setLoading(false);
      }
    });

    return () => {
      active = false;
      if (channel) void supabase.removeChannel(channel);
    };
  }, [fetchPage, refreshLatest, refreshSharedAttachments, refreshVisibleMetadata, submissionId, supabase]);

  const loadEarlierMessages = async () => {
    const oldestMessage = messages[0];
    if (!userId || !oldestMessage || loadingEarlier) return;

    setLoadingEarlier(true);
    setError('');
    try {
      const page = await fetchPage(userId, oldestMessage);
      setMessages((current) => mergeMessages(current, page));
      setHasEarlier(page.length === PAGE_SIZE);
    } catch (loadError) {
      console.error('Earlier document messages could not be loaded:', loadError);
      setError(loadError instanceof Error ? loadError.message : 'Could not load earlier messages.');
    } finally {
      setLoadingEarlier(false);
    }
  };

  const handleFileSelection = (files: File[]) => {
    const combinedFiles = [...selectedFiles, ...files].filter((file, index, allFiles) =>
      allFiles.findIndex((candidate) =>
        candidate.name === file.name
        && candidate.size === file.size
        && candidate.lastModified === file.lastModified
      ) === index
    );
    const fileLimit = currentAction.value === 'forward' ? MAX_ATTACHMENTS - 1 : MAX_ATTACHMENTS;
    if (combinedFiles.length > fileLimit) {
      setError(currentAction.value === 'forward'
        ? 'Forwarding includes the current document automatically and allows up to four additional files.'
        : `You can attach up to ${MAX_ATTACHMENTS} files per message.`);
      return;
    }
    const typeError = getWorkflowFilesTypeError(combinedFiles);
    if (typeError) {
      setError(typeError);
      return;
    }
    const oversizedFile = combinedFiles.find((file) => file.size > MAX_ATTACHMENT_SIZE);
    if (oversizedFile) {
      setError(`"${oversizedFile.name}" is larger than the 10 MB per-file limit.`);
      return;
    }

    setSelectedFiles(combinedFiles);
    setError('');
  };

  const handleConversationFileSelection = (files: File[]) => {
    const combinedFiles = [...conversationFiles, ...files].filter((file, index, allFiles) =>
      allFiles.findIndex((candidate) =>
        candidate.name === file.name
        && candidate.size === file.size
        && candidate.lastModified === file.lastModified
      ) === index
    );
    if (combinedFiles.length > MAX_ATTACHMENTS) {
      setConversationError(`You can attach up to ${MAX_ATTACHMENTS} files per message.`);
      return;
    }
    const typeError = getWorkflowFilesTypeError(combinedFiles);
    if (typeError) {
      setConversationError(typeError);
      return;
    }
    const oversizedFile = combinedFiles.find((file) => file.size > MAX_ATTACHMENT_SIZE);
    if (oversizedFile) {
      setConversationError(`"${oversizedFile.name}" is larger than the 10 MB per-file limit.`);
      return;
    }
    setConversationFiles(combinedFiles);
    setConversationError('');
  };

  const uploadMessageAttachments = async (
    files: File[],
    messageId: string,
  ): Promise<{ rows: UploadedAttachment[]; paths: string[] }> => {
    if (!userId) throw new Error('Sign in to send this message.');
    const rows: UploadedAttachment[] = [];
    const paths: string[] = [];
    try {
      for (const [index, file] of files.entries()) {
        const safeName = file.name.replace(/[^\w.-]/g, '_');
        const filePath = `${submissionId}/${userId}/${messageId}/${crypto.randomUUID()}-${index}-${safeName}`;
        const contentType = getWorkflowFileMimeType(file.name);
        const { error: uploadError } = await supabase.storage
          .from('workflow_message_attachments')
          .upload(filePath, file, {
            contentType: contentType ?? undefined,
            upsert: false,
          });
        if (uploadError) throw new Error(`Could not upload "${file.name}": ${uploadError.message}`);

        paths.push(filePath);
        rows.push({
          submission_id: submissionId,
          message_id: messageId,
          uploaded_by: userId,
          file_name: file.name,
          file_path: filePath,
          file_type: contentType ?? 'application/octet-stream',
          file_size: file.size,
        });
      }
      return { rows, paths };
    } catch (uploadError) {
      if (paths.length > 0) {
        const { error: cleanupError } = await supabase.storage
          .from('workflow_message_attachments')
          .remove(paths);
        if (cleanupError) console.error('Unlinked attachment cleanup failed:', cleanupError.message);
      }
      throw uploadError;
    }
  };

  const clearComposer = () => {
    setDraft('');
    setSelectedFiles([]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const refreshAfterSend = async (notify: (text: string) => void = setNotice) => {
    if (!userId) return;
    try {
      await refreshLatest(userId);
      await refreshSharedAttachments();
    } catch (refreshError) {
      console.error('Message was sent but the conversation did not refresh:', refreshError);
      notify('Your action succeeded, but the conversation did not refresh. Reload this page to see the latest messages.');
    }
  };

  const sendPlainMessage = async (
    body: string,
    files: File[],
    notify: (text: string) => void = setNotice,
  ) => {
    if (!userId) throw new Error('Sign in to send this message.');
    const messageId = crypto.randomUUID();
    const { rows, paths } = await uploadMessageAttachments(files, messageId);
    let messageSent = false;
    let attachmentsSaved = true;
    try {
      const { error: messageError } = await supabase
        .from('workflow_messages')
        .insert({
          id: messageId,
          submission_id: submissionId,
          sender_id: userId,
          body,
        });
      if (messageError) throw new Error(`Could not send message: ${messageError.message}`);
      messageSent = true;

      if (rows.length > 0) {
        const { error: attachmentError } = await supabase
          .from('workflow_message_attachments')
          .insert(rows);
        if (attachmentError) {
          attachmentsSaved = false;
          console.error('Message was sent but its attachments were not saved:', attachmentError.message);
          const { error: cleanupError } = await supabase.storage
            .from('workflow_message_attachments')
            .remove(paths);
          if (cleanupError) console.error('Unlinked message attachment cleanup failed:', cleanupError.message);
          notify('Your message was sent, but its attachments could not be saved. Please try sending the files again.');
        }
      }
      return attachmentsSaved;
    } catch (sendError) {
      if (!messageSent && paths.length > 0) {
        const { error: cleanupError } = await supabase.storage
          .from('workflow_message_attachments')
          .remove(paths);
        if (cleanupError) console.error('Unlinked message attachment cleanup failed:', cleanupError.message);
      }
      throw sendError;
    }
  };

  const performWorkflowAction = async (action: ComposerAction) => {
    if (!workflowComposer) return false;
    const message = draft.trim();
    const files = selectedFiles;
    const needsMessage = action.requiresMessage ?? false;
    if (needsMessage && !message) {
      setError('Enter a message before continuing.');
      messageInputRef.current?.focus();
      return false;
    }
    if (message.length > 5000) {
      setError('Messages must be 5,000 characters or fewer.');
      messageInputRef.current?.focus();
      return false;
    }
    if (action.value === 'respond_changes' && files.length > 1) {
      setError('A changes response can include one revised document.');
      return false;
    }
    if (action.value === 'close_submission' && files.length > 1) {
      setError('A closure can include one closure document.');
      return false;
    }
    if (
      !['send_message', 'forward', 'respond_changes', 'close_submission', 'complete_assignment', 'return_assignment'].includes(action.value)
      && files.length > 0
    ) {
      setError('Attachments are not supported for this action.');
      return false;
    }

    setSending(true);
    setError('');
    setNotice('');
    try {
      if (action.value === 'send_message') {
        if (!message) throw new Error('Enter a message before sending.');
        const attachmentsSaved = await sendPlainMessage(message, files);
        if (attachmentsSaved) setNotice('Message sent.');
      } else if (action.value === 'forward') {
        if (!userId) throw new Error('Sign in to forward this submission.');
        if (!workflowComposer.sourceDocument?.filePath) {
          throw new Error('The current document file is not available for automatic forwarding.');
        }
        if (files.length >= MAX_ATTACHMENTS) {
          throw new Error('Forwarding includes the current document automatically and allows up to four additional files.');
        }
        const { data: currentDocumentBlob, error: documentError } = await supabase.storage
          .from('workflow_uploads')
          .download(workflowComposer.sourceDocument.filePath);
        if (documentError || !currentDocumentBlob) {
          throw new Error(`Could not load the current document: ${documentError?.message ?? 'File unavailable'}`);
        }
        const currentDocument = new File([currentDocumentBlob], fileName, {
          type: workflowComposer.sourceDocument.fileType || 'application/octet-stream',
        });
        const messageId = crypto.randomUUID();
        const { rows, paths } = await uploadMessageAttachments([currentDocument, ...files], messageId);
        let forwarded = false;
        try {
          const { error: forwardError } = await supabase.rpc('forward_workflow_submission_to_office', {
            target_submission_id: submissionId,
            target_office_role: selectedRecipient.replace(/^office:/, ''),
            message_id: messageId,
            message_body: message || null,
            attachment_records: rows,
          });
          if (forwardError) throw new Error(forwardError.message);
          forwarded = true;
        } catch (forwardError) {
          if (!forwarded && paths.length > 0) {
            const { error: cleanupError } = await supabase.storage
              .from('workflow_message_attachments')
              .remove(paths);
            if (cleanupError) console.error('Unlinked forwarded attachment cleanup failed:', cleanupError.message);
          }
          throw forwardError;
        }
        await workflowComposer.onForwarded?.();
        setNotice(`Recommendation requested from ${recipientLabel}.`);
      } else {
        let actionFiles = files;
        if (files.length > 0 && ['complete_assignment', 'return_assignment'].includes(action.value)) {
          const attachmentsSaved = await sendPlainMessage('Supporting document shared for this assignment.', files);
          if (!attachmentsSaved) {
            throw new Error('The workflow action was not completed because the attached document could not be saved.');
          }
          setSelectedFiles([]);
          if (fileInputRef.current) fileInputRef.current.value = '';
          if (userId) await refreshLatest(userId);
          await refreshSharedAttachments();
          actionFiles = [];
        }
        await workflowComposer.onWorkflowAction(
          action.value,
          selectedRecipient,
          message,
          actionFiles,
        );
        setNotice(`${action.label} completed.`);
      }

      clearComposer();
      setConfirmingAction(null);
      if (action.value === 'close_submission') setCloseDialogOpen(false);
      await refreshAfterSend();
      messageInputRef.current?.focus();
      return true;
    } catch (actionError) {
      console.error(`Workflow composer action "${action.value}" failed:`, actionError);
      setError(actionError instanceof Error ? actionError.message : 'Could not complete this action.');
      return false;
    } finally {
      setSending(false);
    }
  };

  const submitComposer = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!workflowComposer || sending || workflowComposer.busy || workflowComposer.isClosed) return;
    const action = currentAction;
    if (action.unavailableReason) {
      setError(action.unavailableReason);
      return;
    }
    if (action.requiresMessage && !draft.trim()) {
      setError('Enter a message before continuing.');
      messageInputRef.current?.focus();
      return;
    }
    if (
      !['send_message', 'forward', 'respond_changes', 'close_submission', 'complete_assignment', 'return_assignment'].includes(action.value)
      && selectedFiles.length > 0
    ) {
      setError('Attachments are not supported for this action.');
      return;
    }
    if (action.value === 'respond_changes' && selectedFiles.length > 1) {
      setError('A changes response can include one revised document.');
      return;
    }
    if (action.value === 'close_submission' && selectedFiles.length > 1) {
      setError('A closure can include one closure document.');
      return;
    }
    if (action.value === 'forward' && selectedFiles.length >= MAX_ATTACHMENTS) {
      setError('Forwarding includes the current document automatically and allows up to four additional files.');
      return;
    }
    if (action.value === 'close_submission') {
      setError('');
      setCloseDialogOpen(true);
      return;
    }
    if (action.confirmation) {
      setConfirmingAction(action);
      return;
    }
    await performWorkflowAction(action);
  };

  const sendConversationMessage = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const body = conversationDraft.trim();
    if (!userId || sending || workflowComposer?.busy || workflowComposer?.isClosed) return;
    if (!body) {
      setConversationError('Write a message before sending.');
      conversationInputRef.current?.focus();
      return;
    }
    if (body.length > 5000) {
      setConversationError('Messages must be 5,000 characters or fewer.');
      conversationInputRef.current?.focus();
      return;
    }

    setSending(true);
    setConversationError('');
    setConversationNotice('');
    try {
      await sendPlainMessage(body, conversationFiles, setConversationNotice);
      setConversationDraft('');
      setConversationFiles([]);
      if (conversationFileInputRef.current) conversationFileInputRef.current.value = '';
      await refreshAfterSend(setConversationNotice);
      conversationInputRef.current?.focus();
    } catch (sendError) {
      console.error('Document conversation message send failed:', sendError);
      setConversationError(sendError instanceof Error ? sendError.message : 'Could not send this message.');
    } finally {
      setSending(false);
    }
  };

  const downloadAttachment = async (attachment: MessageAttachment) => {
    const { data, error: urlError } = await supabase.storage
      .from('workflow_message_attachments')
      .createSignedUrl(attachment.file_path, 300);
    if (urlError || !data?.signedUrl) {
      console.error('Could not authorize message attachment download:', urlError?.message);
      setConversationError('Could not open this attachment. Please try again.');
      return;
    }
    await downloadFile(data.signedUrl, attachment.file_name);
  };

  // ─── Derived UI state ──────────────────────────────────────────────────────
  const actionSubmitDisabled = sending
    || !userId
    || Boolean(workflowComposer?.busy)
    || Boolean(workflowComposer?.isClosed)
    || Boolean(currentAction.unavailableReason);
  const actionSubmitLabel = sending || workflowComposer?.busy
    ? 'Working...'
    : currentAction.buttonLabel ?? currentAction.label;
  const actionSubmitClasses = currentAction.tone === 'warning'
    ? 'border border-pending-text bg-pending-bg text-pending-text hover:bg-pending-bg/70'
    : currentAction.tone === 'neutral'
      ? 'border border-warm-border bg-white text-warm-text hover:bg-sidebar'
      : 'bg-clay text-white hover:bg-warm-text';

  const conversation = (
    <div
      ref={listRef}
      aria-live="polite"
      aria-relevant="additions text"
      aria-label="Document messages"
      className="max-h-[520px] min-h-64 space-y-5 overflow-y-auto p-5 md:p-6"
    >
      {hasEarlier && (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => void loadEarlierMessages()}
            disabled={loadingEarlier}
            className="rounded-full border border-warm-border bg-card px-3.5 py-1.5 text-[10px] font-bold text-warm-text hover:bg-sidebar disabled:opacity-50"
          >
            {loadingEarlier ? 'Loading...' : 'Load earlier messages'}
          </button>
        </div>
      )}
      {loading ? (
        <p className="py-10 text-center text-xs text-muted-text">Loading conversation...</p>
      ) : messages.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-10 text-center">
          <span className="grid h-10 w-10 place-items-center rounded-full bg-sidebar text-muted-text">
            <Icon name="message" size={18} />
          </span>
          <p className="text-xs font-semibold text-warm-text">No messages yet</p>
          <p className="max-w-xs text-[11px] leading-relaxed text-muted-text">
            Write a message below to start the conversation about this document.
          </p>
        </div>
      ) : (
        messages.map((message) => {
          const isOwnMessage = message.sender_id === userId;
          const stamp = new Date(message.created_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
          const role = message.sender_role.replaceAll('_', ' ');
          const attachmentList = message.attachments.length > 0 && (
            <ul className={`mt-3 space-y-1.5 border-t pt-2 ${isOwnMessage ? 'border-white/25' : 'border-warm-border'}`}>
              {message.attachments.map((attachment) => (
                <li key={attachment.id}>
                  <button
                    type="button"
                    onClick={() => void downloadAttachment(attachment)}
                    className={`inline-flex max-w-full items-center gap-1.5 text-left text-[11px] font-bold hover:underline ${
                      isOwnMessage ? 'text-white' : 'text-clay'
                    }`}
                  >
                    <Icon name="file" size={13} />
                    <span className="truncate">{attachment.file_name}</span>
                    <span className="shrink-0 font-medium opacity-75">
                      ({(attachment.file_size / 1024).toFixed(0)} KB)
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          );

          if (isOwnMessage) {
            return (
              <article key={message.id} className="flex justify-end">
                <div className="max-w-[min(85%,36rem)] text-right">
                  <div className="mb-1.5 flex flex-wrap items-baseline justify-end gap-2">
                    <span className="text-[10px] text-muted-text">You · {stamp}</span>
                    <p className="text-xs font-bold text-warm-text">{message.sender_name}</p>
                  </div>
                  <div className="rounded-l-xl rounded-br-xl bg-clay px-4 py-3 text-left text-white">
                    <p className="whitespace-pre-wrap break-words text-xs leading-relaxed">{message.body}</p>
                    {attachmentList}
                  </div>
                  <p className="mt-1 text-[9px] text-muted-text">
                    {message.readCount > 0
                      ? `Seen by ${message.readCount} participant${message.readCount === 1 ? '' : 's'}`
                      : 'Sent'}
                  </p>
                </div>
              </article>
            );
          }

          return (
            <article key={message.id} className="flex gap-3">
              <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#dce4dc] text-[10px] font-bold text-[#486049]">
                {getInitials(message.sender_name)}
              </div>
              <div className="min-w-0 max-w-[min(85%,36rem)]">
                <div className="mb-1.5 flex flex-wrap items-baseline gap-2">
                  <p className="text-xs font-bold text-warm-text">{message.sender_name}</p>
                  <span className="text-[10px] capitalize text-muted-text">{role} · {stamp}</span>
                </div>
                <div className="rounded-r-xl rounded-bl-xl bg-sidebar px-4 py-3 text-warm-text">
                  <p className="whitespace-pre-wrap break-words text-xs leading-relaxed">{message.body}</p>
                  {attachmentList}
                </div>
              </div>
            </article>
          );
        })
      )}
    </div>
  );

  return (
    <section className="space-y-5">
      {workflowComposer && (
        <div className="flex items-center gap-2.5 rounded-xl border border-warm-border bg-card px-4 py-2.5 text-[11px] font-medium text-muted-text" role="status">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-clay" />
          {workflowComposer.statusLine}
        </div>
      )}

      {/* ── Messages (70%) + Activity (30%) side by side ── */}
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,7fr)_minmax(0,3fr)]">
        <section className="min-w-0 overflow-hidden rounded-2xl border border-warm-border bg-card">
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-warm-border px-5 py-4 md:px-6">
            <div className="flex items-center gap-2.5">
              <span className="text-clay"><Icon name="message" size={17} /></span>
              <div>
                <h3 className="text-sm font-bold text-warm-text">Messages</h3>
                <p className="mt-0.5 text-[10px] text-muted-text">
                  {trackingNumber || fileName} · Shared with the applicant and authorized staff
                </p>
              </div>
              <span className="rounded-full bg-clay-soft px-2 py-0.5 text-[10px] font-bold text-clay">{messages.length}</span>
            </div>
            <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold ${
              liveStatus === 'connected' ? 'bg-approved-bg text-approved-text' : 'bg-sidebar text-muted-text'
            }`}>
              <span className={`h-1.5 w-1.5 rounded-full bg-current ${liveStatus === 'connecting' ? 'animate-pulse' : ''}`} />
              {liveStatus === 'connected' ? 'Live' : liveStatus === 'disconnected' ? 'Paused' : 'Connecting...'}
            </span>
          </header>

          <div id={`messages-panel-${submissionId}`}>{conversation}</div>

          <form
            onSubmit={(event) => void sendConversationMessage(event)}
            className="space-y-3 border-t border-warm-border bg-[#f8f5f1] p-4 md:p-5"
          >
            {!workflowComposer && error && (
              <p role="alert" className="rounded-xl border border-rejected-bg bg-rejected-bg/50 px-4 py-3 text-xs font-medium text-rejected-text">{error}</p>
            )}
            {conversationError && (
              <p role="alert" className="rounded-xl border border-rejected-bg bg-rejected-bg/50 px-4 py-3 text-xs font-medium text-rejected-text">{conversationError}</p>
            )}
            {conversationNotice && (
              <p role="status" className="rounded-xl border border-pending-bg bg-pending-bg/50 px-4 py-3 text-xs font-medium text-pending-text">{conversationNotice}</p>
            )}
            <label htmlFor={`conversation-message-${submissionId}`} className="sr-only">
              Write a message to the submitter or office staff
            </label>
            <textarea
              ref={conversationInputRef}
              id={`conversation-message-${submissionId}`}
              value={conversationDraft}
              onChange={(event) => {
                setConversationDraft(event.target.value);
                setConversationError('');
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
              maxLength={5000}
              rows={3}
              disabled={conversationDisabled}
              placeholder="Write a message to the submitter or office staff…"
              className="block min-h-20 w-full resize-y rounded-xl border border-warm-border bg-white p-3 text-xs leading-relaxed text-warm-text outline-none placeholder:text-muted-text/70 focus:border-clay focus:ring-2 focus:ring-clay/15 disabled:cursor-not-allowed disabled:bg-sidebar disabled:opacity-70"
            />
            <FileChips
              files={conversationFiles}
              disabled={sending}
              onRemove={(file) => setConversationFiles((current) => current.filter((selected) => selected !== file))}
            />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <AttachControl
                id={`conversation-files-${submissionId}`}
                inputRef={conversationFileInputRef}
                disabled={conversationDisabled}
                limit={MAX_ATTACHMENTS}
                onFiles={handleConversationFileSelection}
              />
              <div className="flex items-center gap-3">
                <span className="hidden text-[9px] text-muted-text md:block">
                  {conversationDraft.length}/5000 · Ctrl + Enter to send
                </span>
                <button
                  type="submit"
                  disabled={conversationDisabled}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-full bg-clay px-5 text-[11px] font-bold text-white transition-colors hover:bg-warm-text disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {sending ? 'Sending...' : 'Send message'} <Icon name="send" size={14} />
                </button>
              </div>
            </div>
            {workflowComposer?.isClosed && (
              <p role="status" className="text-[11px] font-medium text-muted-text">
                {workflowComposer.closedMessage ?? 'This submission is closed.'}
              </p>
            )}
            {workflowComposer?.busy && !sending && (
              <p role="status" className="text-[11px] font-medium text-muted-text">
                Messaging is temporarily unavailable while the submission is updating.
              </p>
            )}
            {!workflowComposer && notice && (
              <p role="status" className="text-[11px] font-medium text-pending-text">{notice}</p>
            )}
          </form>
        </section>

        <aside className="min-w-0 space-y-5">
          <section className="overflow-hidden rounded-2xl border border-warm-border bg-card">
            <header className="flex items-center gap-2.5 border-b border-warm-border px-5 py-4">
              <span className="text-clay"><Icon name="clock" size={17} /></span>
              <div>
                <h3 className="text-sm font-bold text-warm-text">Activity</h3>
                <p className="mt-0.5 text-[10px] text-muted-text">Workflow history and audit events</p>
              </div>
            </header>
            <div className="max-h-[560px] overflow-y-auto p-5">{activity}</div>
          </section>
          {workflowComposer?.sidebarContent}
          <section className="overflow-hidden rounded-2xl border border-warm-border bg-card">
            <header className="flex items-center justify-between gap-2 border-b border-warm-border px-4 py-3">
              <div className="flex min-w-0 items-center gap-2">
                <span className="shrink-0 text-clay"><Icon name="paperclip" size={15} /></span>
                <h3 className="truncate text-xs font-bold text-warm-text">Shared files</h3>
              </div>
              <span className="shrink-0 rounded-full bg-sidebar px-2 py-0.5 text-[10px] font-bold text-muted-text">
                {sharedAttachments.length}
              </span>
            </header>
            <div className="max-h-64 space-y-1.5 overflow-y-auto p-3">
              {sharedAttachments.length === 0 ? (
                <p className="px-1 py-1 text-[10px] text-muted-text">No files shared yet.</p>
              ) : (
                sharedAttachments.map((attachment) => (
                  <button
                    key={attachment.id}
                    type="button"
                    onClick={() => void downloadAttachment(attachment)}
                    className="flex w-full min-w-0 items-center gap-2.5 rounded-lg border border-transparent bg-sidebar/60 px-2.5 py-2 text-left text-warm-text transition-colors hover:border-warm-border hover:bg-white"
                  >
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-clay-soft text-clay">
                      <Icon name="file" size={14} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[10px] font-semibold">{attachment.file_name}</span>
                      <span className="block truncate text-[9px] text-muted-text">
                        {Math.max(1, Math.round(attachment.file_size / 1024))} KB
                        {attachment.file_type ? ` · ${attachment.file_type.split('/').pop()?.toUpperCase()}` : ''}
                      </span>
                    </span>
                    <span className="shrink-0 text-[9px] font-semibold text-clay">Open</span>
                  </button>
                ))
              )}
            </div>
          </section>
        </aside>
      </div>

      {/* ── Your office action ── */}
      {workflowComposer && (
        <div className="space-y-3">
          {error && (
            <p role="alert" className="rounded-xl border border-rejected-bg bg-rejected-bg/50 px-4 py-3 text-xs font-medium text-rejected-text">{error}</p>
          )}
          {notice && (
            <p role="status" className="rounded-xl border border-approved-bg bg-approved-bg/50 px-4 py-3 text-xs font-medium text-approved-text">{notice}</p>
          )}
          <form
            onSubmit={(event) => void submitComposer(event)}
            className="overflow-hidden rounded-2xl border border-warm-border bg-card shadow-[0_10px_30px_rgba(65,49,39,0.06)]"
          >
            <header className="border-b border-warm-border px-5 py-4 md:px-6">
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-clay">
                {isOfficeWorkspace ? 'Your office action' : 'Submission response'}
              </p>
              <h3 className="mt-1 font-serif text-xl font-semibold text-warm-text">
                {isOfficeWorkspace ? 'Process this request' : 'Respond to this request'}
              </h3>
              <p className="mt-1.5 text-[11px] leading-relaxed text-muted-text">
                {isOfficeWorkspace
                  ? 'Review the request, communicate as needed, and close it when your office has finished processing.'
                  : 'Choose an available action and add a note when needed.'}
              </p>
            </header>

            <div className="space-y-4 bg-[#f8f5f1] p-5 md:p-6">
              {workflowComposer.contextNote && (
                <p className="whitespace-pre-wrap rounded-xl border border-pending-bg bg-pending-bg/40 px-3 py-2 text-[11px] text-warm-text">
                  {workflowComposer.contextNote}
                </p>
              )}
              {workflowComposer.renderActionFields?.(currentAction.value)}

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="min-w-0 text-[10px] font-bold uppercase tracking-[0.1em] text-muted-text">
                  To
                  <select
                    aria-label="To"
                    value={selectedRecipient}
                    onChange={(event) => {
                      const recipient = event.target.value;
                      setSelectedRecipient(recipient);
                      setSelectedAction(workflowComposer.actionsByRecipient[recipient]?.[0]?.value ?? '');
                      setError('');
                    }}
                    disabled={actionDisabled}
                    className="mt-1.5 block h-10 w-full cursor-pointer rounded-xl border border-warm-border bg-white px-3 text-xs font-medium normal-case tracking-normal text-warm-text outline-none focus:border-clay focus:ring-2 focus:ring-clay/15 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {workflowComposer.recipients.map((recipient) => (
                      <option key={recipient.value} value={recipient.value}>{recipient.label}</option>
                    ))}
                  </select>
                </label>
                <label className="min-w-0 text-[10px] font-bold uppercase tracking-[0.1em] text-muted-text">
                  Action
                  <select
                    aria-label="Action"
                    value={currentAction.value}
                    onChange={(event) => {
                      setSelectedAction(event.target.value);
                      setError('');
                    }}
                    disabled={actionDisabled}
                    className="mt-1.5 block h-10 w-full cursor-pointer rounded-xl border border-warm-border bg-white px-3 text-xs font-medium normal-case tracking-normal text-warm-text outline-none focus:border-clay focus:ring-2 focus:ring-clay/15 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {actionList.map((action) => (
                      <option
                        key={action.value}
                        value={action.value}
                        aria-disabled={Boolean(action.unavailableReason)}
                        className={action.unavailableReason ? 'text-muted-text' : undefined}
                      >
                        {action.unavailableReason
                          ? `${action.label} — unavailable: ${action.unavailableReason}`
                          : action.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {currentAction.unavailableReason && (
                <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-pending-text" role="status">
                  <span className="mt-0.5 shrink-0"><Icon name="info" size={13} /></span>
                  {currentAction.unavailableReason}
                </p>
              )}

              <div>
                <label htmlFor={`message-${submissionId}`} className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.1em] text-muted-text">
                  Message to {recipientLabel}
                </label>
                <textarea
                  ref={messageInputRef}
                  id={`message-${submissionId}`}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                      event.preventDefault();
                      event.currentTarget.form?.requestSubmit();
                    }
                  }}
                  disabled={actionDisabled}
                  maxLength={5000}
                  rows={4}
                  placeholder={currentAction.requiresMessage
                    ? currentAction.value === 'respond_changes'
                      ? 'Write your response (required)…'
                      : 'Enter a reason (required)…'
                    : `Add an optional note for ${recipientLabel}…`}
                  className="block min-h-28 w-full resize-y rounded-xl border border-warm-border bg-white p-3 text-xs leading-relaxed text-warm-text outline-none placeholder:text-muted-text/70 focus:border-clay focus:ring-2 focus:ring-clay/15 disabled:cursor-not-allowed disabled:bg-sidebar disabled:opacity-70"
                />
                <p className="mt-1 text-right text-[9px] text-muted-text">{draft.length}/5000</p>
              </div>

              <FileChips
                files={selectedFiles}
                disabled={actionDisabled}
                onRemove={(file) => setSelectedFiles((current) => current.filter((selected) => selected !== file))}
              />

              <div className="flex flex-wrap items-center justify-between gap-3">
                <AttachControl
                  id={`message-files-${submissionId}`}
                  inputRef={fileInputRef}
                  disabled={actionDisabled}
                  limit={actionAttachLimit}
                  onFiles={handleFileSelection}
                />
                <button
                  type="submit"
                  disabled={actionSubmitDisabled}
                  className={`inline-flex h-10 items-center justify-center gap-2 rounded-full px-6 text-[11px] font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${actionSubmitClasses}`}
                >
                  {actionSubmitLabel} <Icon name="send" size={14} />
                </button>
              </div>

              {workflowComposer.isClosed && (
                <p className="text-xs font-medium text-muted-text" role="status">
                  {workflowComposer.closedMessage ?? 'This submission is closed.'}
                </p>
              )}
              {workflowComposer.busy && !sending && (
                <p className="text-xs font-medium text-muted-text" role="status">
                  This submission is being updated. Messaging and attachments will be available when the action finishes.
                </p>
              )}
              {!workflowComposer.isClosed && !workflowComposer.busy && !userId && !loading && (
                <p className="text-xs font-medium text-rejected-text" role="alert">
                  Your session could not be verified. Sign in again to send messages or attach files.
                </p>
              )}
            </div>
          </form>
        </div>
      )}

      {workflowComposer && (
        <>
          {confirmingAction && (
            <div
              className="fixed inset-0 z-50 grid place-items-center bg-[#302c29]/45 p-4 backdrop-blur-[2px]"
              onMouseDown={() => setConfirmingAction(null)}
            >
              <section
                role="alertdialog"
                aria-modal="true"
                aria-labelledby={`confirm-${submissionId}-title`}
                onMouseDown={(event) => event.stopPropagation()}
                className="w-full max-w-md rounded-2xl border border-warm-border bg-card p-6 shadow-2xl"
              >
                <div className="flex items-start justify-between gap-4">
                  <span className="grid h-11 w-11 place-items-center rounded-full bg-pending-bg text-pending-text">
                    <Icon name="info" size={20} />
                  </span>
                  <button
                    type="button"
                    onClick={() => setConfirmingAction(null)}
                    aria-label="Close dialog"
                    className="grid h-8 w-8 place-items-center rounded-full text-muted-text hover:bg-sidebar"
                  >
                    <Icon name="x" size={17} />
                  </button>
                </div>
                <h2 id={`confirm-${submissionId}-title`} className="mt-5 font-serif text-2xl font-semibold text-warm-text">
                  Confirm {confirmingAction.label.toLowerCase()}?
                </h2>
                <p className="mt-2 text-xs leading-relaxed text-muted-text">{confirmingAction.confirmation}</p>
                <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                  <button
                    type="button"
                    onClick={() => setConfirmingAction(null)}
                    className="h-10 rounded-full border border-warm-border px-5 text-xs font-bold text-warm-text hover:bg-sidebar"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void performWorkflowAction(confirmingAction)}
                    disabled={sending || workflowComposer.busy}
                    className="h-10 rounded-full bg-clay px-5 text-xs font-bold text-white hover:bg-warm-text disabled:opacity-50"
                  >
                    {sending || workflowComposer.busy ? 'Working...' : confirmingAction.label}
                  </button>
                </div>
              </section>
            </div>
          )}
          <CloseSubmissionDialog
            open={closeDialogOpen}
            pendingAssignmentCount={workflowComposer.pendingAssignmentCount ?? 0}
            updating={sending || Boolean(workflowComposer.busy)}
            error={error}
            note={draft}
            file={selectedFiles[0] ?? null}
            onCancel={() => setCloseDialogOpen(false)}
            onConfirm={() => {
              const action = workflowComposer.actionsByRecipient[selectedRecipient]
                ?.find((candidate) => candidate.value === 'close_submission');
              if (action) void performWorkflowAction(action);
            }}
          />
        </>
      )}
    </section>
  );
}
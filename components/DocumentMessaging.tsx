'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { createClient } from '@/lib/supabase/client';
import { downloadFile } from '@/components/FilePreview';
import {
  getWorkflowFileMimeType,
  getWorkflowFilesTypeError,
  WORKFLOW_ATTACHMENT_ACCEPT,
} from '@/lib/workflow/file-types';

const PAGE_SIZE = 50;
const MAX_ATTACHMENTS = 5;
const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024;
const MESSAGE_FIELDS = 'id, submission_id, sender_id, sender_name, sender_role, body, created_at';

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
}

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
}: DocumentMessagingProps) {
  const supabase = useMemo(() => createClient(), []);
  const [userId, setUserId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [hasEarlier, setHasEarlier] = useState(false);
  const [sending, setSending] = useState(false);
  const [liveStatus, setLiveStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');
  const [activeTab, setActiveTab] = useState<'messages' | 'activity'>('messages');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesRef = useRef<Message[]>([]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

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
  }, [fetchPage, refreshLatest, refreshVisibleMetadata, submissionId, supabase]);

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
    if (combinedFiles.length > MAX_ATTACHMENTS) {
      setError(`You can attach up to ${MAX_ATTACHMENTS} files per message.`);
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

  const sendMessage = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const body = draft.trim();
    if (!userId || !body || sending) return;
    if (body.length > 5000) {
      setError('Messages must be 5,000 characters or fewer.');
      return;
    }

    setSending(true);
    setError('');
    setNotice('');
    const messageId = crypto.randomUUID();
    const uploadedPaths: string[] = [];
    let messageSent = false;

    try {
      const attachmentRows = [];
      for (const [index, file] of selectedFiles.entries()) {
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

        uploadedPaths.push(filePath);
        attachmentRows.push({
          submission_id: submissionId,
          message_id: messageId,
          uploaded_by: userId,
          file_name: file.name,
          file_path: filePath,
          file_type: contentType ?? 'application/octet-stream',
          file_size: file.size,
        });
      }

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

      setDraft('');
      setSelectedFiles([]);
      if (fileInputRef.current) fileInputRef.current.value = '';

      if (attachmentRows.length > 0) {
        const { error: attachmentError } = await supabase
          .from('workflow_message_attachments')
          .insert(attachmentRows);
        if (attachmentError) {
          console.error('Message was sent but its attachments were not saved:', attachmentError.message);
          const { error: cleanupError } = await supabase.storage
            .from('workflow_message_attachments')
            .remove(uploadedPaths);
          if (cleanupError) {
            console.error('Unlinked message attachment cleanup failed:', cleanupError.message);
          }
          setNotice('Your message was sent, but its attachments could not be saved. Please try sending the files again.');
        }
      }

      try {
        await refreshLatest(userId);
      } catch (refreshError) {
        console.error('Message was sent but the conversation did not refresh:', refreshError);
        setNotice('Your message was sent, but the conversation did not refresh. Reload this page to see the latest messages.');
      }
    } catch (sendError) {
      console.error('Document message send failed:', sendError);
      if (!messageSent && uploadedPaths.length > 0) {
        const { error: cleanupError } = await supabase.storage
          .from('workflow_message_attachments')
          .remove(uploadedPaths);
        if (cleanupError) console.error('Unlinked message attachment cleanup failed:', cleanupError.message);
      }
      setError(sendError instanceof Error ? sendError.message : 'Could not send this message.');
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
      setError('Could not open this attachment. Please try again.');
      return;
    }
    await downloadFile(data.signedUrl, attachment.file_name);
  };

  const removeSelectedFile = (fileToRemove: File) => {
    setSelectedFiles((current) => current.filter((file) => file !== fileToRemove));
  };

  return (
    <section className="rounded-2xl border border-warm-border bg-card p-5 max-md:p-3.5">
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3 border-b border-warm-border pb-4">
        <div>
          <h2 className="text-sm font-semibold text-warm-text">Document communication</h2>
          <p className="mt-1 text-[11px] text-muted-text">
            {trackingNumber || fileName} · Shared with the applicant and authorized workflow staff
          </p>
        </div>
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-medium ${
          liveStatus === 'connected' ? 'bg-approved-bg text-approved-text' : 'bg-sidebar text-muted-text'
        }`}>
          <span className="h-1.5 w-1.5 rounded-full bg-current" />
          {liveStatus === 'connected'
            ? 'Live conversation'
            : liveStatus === 'disconnected'
              ? 'Live updates paused'
              : 'Connecting...'}
        </span>
      </header>

      <div role="tablist" aria-label="Document communication" className="mb-4 flex gap-2 border-b border-warm-border">
        <button
          id={`messages-tab-${submissionId}`}
          type="button"
          role="tab"
          aria-selected={activeTab === 'messages'}
          aria-controls={`messages-panel-${submissionId}`}
          onClick={() => setActiveTab('messages')}
          className={`border-b-2 px-3 py-2 text-[11px] font-semibold ${
            activeTab === 'messages'
              ? 'border-clay text-clay'
              : 'border-transparent text-muted-text hover:text-warm-text'
          }`}
        >
          Messages
        </button>
        <button
          id={`activity-tab-${submissionId}`}
          type="button"
          role="tab"
          aria-selected={activeTab === 'activity'}
          aria-controls={`activity-panel-${submissionId}`}
          onClick={() => setActiveTab('activity')}
          className={`border-b-2 px-3 py-2 text-[11px] font-semibold ${
            activeTab === 'activity'
              ? 'border-clay text-clay'
              : 'border-transparent text-muted-text hover:text-warm-text'
          }`}
        >
          Activity
        </button>
      </div>

      {activeTab === 'activity' ? (
        <div
          id={`activity-panel-${submissionId}`}
          role="tabpanel"
          aria-labelledby={`activity-tab-${submissionId}`}
        >
          {activity}
        </div>
      ) : (
        <div
          id={`messages-panel-${submissionId}`}
          role="tabpanel"
          aria-labelledby={`messages-tab-${submissionId}`}
        >
      <div
        aria-live="polite"
        aria-relevant="additions text"
        aria-label="Document messages"
        className="max-h-[460px] space-y-3 overflow-y-auto rounded-xl bg-sidebar/60 p-3 max-md:p-2"
      >
        {hasEarlier && (
          <div className="flex justify-center">
            <button
              type="button"
              onClick={() => void loadEarlierMessages()}
              disabled={loadingEarlier}
              className="rounded-full border border-warm-border bg-card px-3 py-1.5 text-[10px] font-semibold text-warm-text disabled:opacity-50"
            >
              {loadingEarlier ? 'Loading...' : 'Load earlier messages'}
            </button>
          </div>
        )}
        {loading ? (
          <p className="py-8 text-center text-xs text-muted-text">Loading conversation...</p>
        ) : messages.length === 0 ? (
          <p className="py-8 text-center text-xs text-muted-text">
            No messages yet. Send a message to start the conversation about this document.
          </p>
        ) : (
          messages.map((message) => {
            const isOwnMessage = message.sender_id === userId;
            return (
              <article
                key={message.id}
                className={`flex ${isOwnMessage ? 'justify-end' : 'justify-start'}`}
              >
                <div className={`max-w-[min(90%,42rem)] rounded-2xl px-4 py-3 ${
                  isOwnMessage
                    ? 'rounded-br-md bg-clay text-white'
                    : 'rounded-bl-md border border-warm-border bg-card text-warm-text'
                }`}>
                  <div className={`mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] ${
                    isOwnMessage ? 'text-white/75' : 'text-muted-text'
                  }`}>
                    <span className={`font-semibold ${isOwnMessage ? 'text-white' : 'text-warm-text'}`}>
                      {isOwnMessage ? 'You' : message.sender_name}
                    </span>
                    <span className="capitalize">{message.sender_role.replaceAll('_', ' ')}</span>
                    <time dateTime={message.created_at}>
                      {new Date(message.created_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                    </time>
                  </div>
                  <p className="whitespace-pre-wrap break-words text-xs leading-relaxed">{message.body}</p>
                  {message.attachments.length > 0 && (
                    <ul className={`mt-3 space-y-1.5 border-t pt-2 ${
                      isOwnMessage ? 'border-white/20' : 'border-warm-border'
                    }`}>
                      {message.attachments.map((attachment) => (
                        <li key={attachment.id}>
                          <button
                            type="button"
                            onClick={() => void downloadAttachment(attachment)}
                            className={`max-w-full truncate text-left text-[11px] font-semibold underline underline-offset-2 ${
                              isOwnMessage ? 'text-white' : 'text-clay'
                            }`}
                          >
                            {attachment.file_name} ({(attachment.file_size / 1024).toFixed(0)} KB)
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  {isOwnMessage && (
                    <p className="mt-1.5 text-right text-[9px] text-white/70">
                      {message.readCount > 0
                        ? `Seen by ${message.readCount} participant${message.readCount === 1 ? '' : 's'}`
                        : 'Sent'}
                    </p>
                  )}
                </div>
              </article>
            );
          })
        )}
      </div>

      {error && <p role="alert" className="mt-3 text-xs text-rejected-text">{error}</p>}
      {notice && <p role="status" className="mt-3 text-xs text-pending-text">{notice}</p>}

      <form onSubmit={(event) => void sendMessage(event)} className="mt-4 space-y-3">
        <label htmlFor={`message-${submissionId}`} className="sr-only">Write a message</label>
        <textarea
          id={`message-${submissionId}`}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          disabled={sending}
          maxLength={5000}
          rows={3}
          placeholder="Write a message about this document..."
          className="w-full resize-y rounded-xl border border-warm-border bg-cream px-3 py-2.5 text-xs text-warm-text outline-none focus:border-clay"
        />
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0 flex-1">
            <label htmlFor={`message-files-${submissionId}`} className="mb-1 block text-[10px] font-medium text-muted-text">
              Attach files (up to {MAX_ATTACHMENTS}, 10 MB each)
            </label>
            <input
              ref={fileInputRef}
              id={`message-files-${submissionId}`}
              type="file"
              accept={WORKFLOW_ATTACHMENT_ACCEPT}
              multiple
              disabled={sending}
              onChange={(event) => {
                handleFileSelection(Array.from(event.target.files ?? []));
                event.target.value = '';
              }}
              className="block w-full text-[10px] text-muted-text file:mr-2 file:rounded-full file:border-0 file:bg-sidebar file:px-3 file:py-2 file:text-[10px] file:font-semibold file:text-clay"
            />
            {selectedFiles.length > 0 && (
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {selectedFiles.map((file) => (
                  <li key={`${file.name}-${file.size}-${file.lastModified}`} className="inline-flex max-w-full items-center gap-2 rounded-full bg-sidebar px-2.5 py-1 text-[10px] text-warm-text">
                    <span className="max-w-52 truncate">{file.name}</span>
                    <button
                      type="button"
                      onClick={() => removeSelectedFile(file)}
                      disabled={sending}
                      aria-label={`Remove ${file.name}`}
                      className="font-bold text-muted-text hover:text-rejected-text"
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <button
            type="submit"
            disabled={sending || loading || !userId || !draft.trim()}
            className="inline-flex h-10 shrink-0 items-center justify-center rounded-full bg-clay px-5 text-xs font-semibold text-white transition-colors hover:bg-warm-text disabled:cursor-not-allowed disabled:opacity-50"
          >
            {sending ? 'Sending...' : 'Send message'}
          </button>
        </div>
      </form>
        </div>
      )}
    </section>
  );
}

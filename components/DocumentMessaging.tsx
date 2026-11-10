'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { createClient } from '@/lib/supabase/client';
import { downloadFile } from '@/components/FilePreview';
import { getWorkflowFileMimeType, getWorkflowFilesTypeError } from '@/lib/workflow/file-types';
import { getCurrentWorkflowAccess } from '@/lib/auth/access';

const STORAGE_BUCKET = 'connect-daet-submissions';
const MAX_ATTACHMENTS = 5;
const MAX_ATTACHMENT_SIZE = 20 * 1024 * 1024;
const MESSAGE_PAGE_SIZE = 100;

type ThreadVisibility = 'participants' | 'staff_private';

type MessageAttachment = {
  id: string;
  original_filename: string;
  content_type: string | null;
  byte_size: number | null;
};

type Message = {
  id: string;
  thread_id: string;
  author_profile_id: string;
  body: string;
  created_at: string;
  attachments: MessageAttachment[];
};

type ThreadState = {
  id: string;
  messages: Message[];
  loading: boolean;
  error: string;
};

interface DocumentMessagingProps {
  submissionId: string;
  fileName: string;
  trackingNumber: string | null;
  activity: ReactNode;
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export default function DocumentMessaging({
  submissionId,
  fileName,
  trackingNumber,
  activity,
}: DocumentMessagingProps) {
  const supabase = useMemo(() => createClient(), []);
  const [userId, setUserId] = useState<string | null>(null);
  const [isTourismOfficer, setIsTourismOfficer] = useState(false);
  const [threads, setThreads] = useState<Partial<Record<ThreadVisibility, ThreadState>>>({});
  const [drafts, setDrafts] = useState<Partial<Record<ThreadVisibility, string>>>({});
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [sending, setSending] = useState<ThreadVisibility | null>(null);
  const [pageError, setPageError] = useState('');
  const [notice, setNotice] = useState('');
  const [activeTab, setActiveTab] = useState<'messages' | 'activity'>('messages');

  const setThread = useCallback((visibility: ThreadVisibility, update: (current: ThreadState) => ThreadState) => {
    setThreads((current) => {
      const thread = current[visibility];
      if (!thread) return current;
      return { ...current, [visibility]: update(thread) };
    });
  }, []);

  const loadMessages = useCallback(async (visibility: ThreadVisibility, threadId: string) => {
    setThread(visibility, (current) => ({ ...current, loading: true, error: '' }));
    const { data: messageRows, error: messagesError } = await supabase
      .from('messages')
      .select('id, thread_id, author_profile_id, body, created_at')
      .eq('thread_id', threadId)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .limit(MESSAGE_PAGE_SIZE);

    if (messagesError) {
      setThread(visibility, (current) => ({
        ...current,
        loading: false,
        error: `Could not load messages: ${messagesError.message}`,
      }));
      return;
    }

    const rows = messageRows ?? [];
    const messageIds = rows.map((message) => message.id);
    let messageAttachments: { message_id: string; attachment_id: string }[] = [];
    let attachmentRows: MessageAttachment[] = [];

    if (messageIds.length > 0) {
      const { data: links, error: linksError } = await supabase
        .from('message_attachments')
        .select('message_id, attachment_id')
        .in('message_id', messageIds);
      if (linksError) {
        setThread(visibility, (current) => ({
          ...current,
          loading: false,
          error: `Could not load message attachments: ${linksError.message}`,
        }));
        return;
      }

      messageAttachments = links ?? [];
      const attachmentIds = [...new Set(messageAttachments.map((link) => link.attachment_id))];
      if (attachmentIds.length > 0) {
        const { data: attachments, error: attachmentsError } = await supabase
          .from('attachments')
          .select('id, original_filename, content_type, byte_size')
          .in('id', attachmentIds);
        if (attachmentsError) {
          setThread(visibility, (current) => ({
            ...current,
            loading: false,
            error: `Could not load attachment details: ${attachmentsError.message}`,
          }));
          return;
        }
        attachmentRows = attachments ?? [];
      }
    }

    const attachmentsByMessage = new Map<string, MessageAttachment[]>();
    for (const link of messageAttachments) {
      const attachment = attachmentRows.find((candidate) => candidate.id === link.attachment_id);
      if (!attachment) continue;
      const current = attachmentsByMessage.get(link.message_id) ?? [];
      current.push(attachment);
      attachmentsByMessage.set(link.message_id, current);
    }

    setThread(visibility, (current) => ({
      ...current,
      loading: false,
      error: '',
      messages: rows.map((message) => ({
        ...message,
        attachments: attachmentsByMessage.get(message.id) ?? [],
      })),
    }));

    const { error: readError } = await supabase.rpc('mark_submission_message_thread_read', {
      p_thread_id: threadId,
    });
    if (readError) {
      setThread(visibility, (current) => ({
        ...current,
        error: `Messages loaded, but read status could not be updated: ${readError.message}`,
      }));
    }
  }, [setThread, supabase]);

  const openThread = useCallback(async (visibility: ThreadVisibility) => {
    const { data: threadId, error: threadError } = await supabase.rpc(
      'open_submission_message_thread',
      { p_submission_id: submissionId, p_visibility: visibility }
    );
    if (threadError || !threadId) {
      throw new Error(threadError?.message ?? 'Could not open this conversation.');
    }

    setThreads((current) => ({
      ...current,
      [visibility]: {
        id: threadId,
        messages: [],
        loading: true,
        error: '',
      },
    }));
    await loadMessages(visibility, threadId);
  }, [loadMessages, submissionId, supabase]);

  const refreshThreads = useCallback(async () => {
    const availableThreads = Object.entries(threads) as [ThreadVisibility, ThreadState][];
    await Promise.all(availableThreads.map(([visibility, thread]) =>
      loadMessages(visibility, thread.id)
    ));
  }, [loadMessages, threads]);

  useEffect(() => {
    let active = true;

    const initialize = async () => {
      const access = await getCurrentWorkflowAccess(supabase);
      if (!access) throw new Error('Sign in to view this conversation.');
      if (!active) return;

      setUserId(access.user.id);
      const tourismOfficer = access.roles.includes('approver');
      setIsTourismOfficer(tourismOfficer);
      await openThread('participants');
      if (tourismOfficer) await openThread('staff_private');
    };

    void initialize().catch((error: unknown) => {
      if (active) setPageError(getErrorMessage(error, 'Could not open this conversation.'));
    });

    return () => {
      active = false;
    };
  }, [openThread, supabase]);

  useEffect(() => {
    if (Object.keys(threads).length === 0) return;
    const timer = window.setInterval(() => {
      void refreshThreads().catch((error: unknown) => {
        setPageError(getErrorMessage(error, 'Could not refresh the conversation.'));
      });
    }, 10000);
    return () => window.clearInterval(timer);
  }, [refreshThreads, threads]);

  const handleFileSelection = (files: File[]) => {
    const combined = [...selectedFiles, ...files].filter((file, index, allFiles) =>
      allFiles.findIndex((candidate) =>
        candidate.name === file.name
        && candidate.size === file.size
        && candidate.lastModified === file.lastModified
      ) === index
    );
    if (combined.length > MAX_ATTACHMENTS) {
      setPageError(`You can attach up to ${MAX_ATTACHMENTS} files per message.`);
      return;
    }
    const typeError = getWorkflowFilesTypeError(combined);
    if (typeError) {
      setPageError(typeError);
      return;
    }
    const oversizedFile = combined.find((file) => file.size > MAX_ATTACHMENT_SIZE);
    if (oversizedFile) {
      setPageError(`"${oversizedFile.name}" exceeds the 20 MiB per-file limit.`);
      return;
    }
    setSelectedFiles(combined);
    setPageError('');
  };

  const sendMessage = async (visibility: ThreadVisibility, event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const thread = threads[visibility];
    const body = (drafts[visibility] ?? '').trim();
    if (!userId || !thread || !body || sending) return;
    if (body.length > 5000) {
      setPageError('Messages must be 5,000 characters or fewer.');
      return;
    }

    setSending(visibility);
    setPageError('');
    setNotice('');
    const uploadedKeys: string[] = [];

    try {
      const attachmentMetadata = [];
      for (const [index, file] of selectedFiles.entries()) {
        const safeName = file.name.replace(/[^\w.-]/g, '_');
        const objectKey = `${userId}/${crypto.randomUUID()}-${index}-${safeName}`;
        const contentType = getWorkflowFileMimeType(file.name);
        const { error: uploadError } = await supabase.storage
          .from(STORAGE_BUCKET)
          .upload(objectKey, file, {
            contentType: contentType ?? undefined,
            upsert: false,
          });
        if (uploadError) {
          throw new Error(`Could not upload "${file.name}": ${uploadError.message}`);
        }
        uploadedKeys.push(objectKey);
        attachmentMetadata.push({
          original_filename: file.name,
          object_key: objectKey,
          content_type: contentType,
          byte_size: file.size,
        });
      }

      const { error: sendError } = await supabase.rpc('send_submission_message', {
        p_thread_id: thread.id,
        p_body: body,
        p_attachment_metadata: attachmentMetadata,
        p_idempotency_key: crypto.randomUUID(),
      });
      if (sendError) throw new Error(`Could not send message: ${sendError.message}`);

      setDrafts((current) => ({ ...current, [visibility]: '' }));
      setSelectedFiles([]);
      setNotice('Message sent.');
      await loadMessages(visibility, thread.id);
    } catch (error) {
      if (uploadedKeys.length > 0) {
        const { error: cleanupError } = await supabase.storage
          .from(STORAGE_BUCKET)
          .remove(uploadedKeys);
        if (cleanupError) {
          console.error('Unlinked message attachment cleanup failed:', cleanupError.message);
        }
      }
      setPageError(getErrorMessage(error, 'Could not send this message.'));
    } finally {
      setSending(null);
    }
  };

  const downloadAttachment = async (attachment: MessageAttachment) => {
    const { data: objectKey, error: keyError } = await supabase.rpc(
      'get_authorized_attachment_object_key',
      { p_attachment_id: attachment.id }
    );
    if (keyError || !objectKey) {
      setPageError(keyError?.message ?? 'This attachment is unavailable to your account.');
      return;
    }
    const { data, error: urlError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .createSignedUrl(objectKey, 300);
    if (urlError || !data?.signedUrl) {
      setPageError(urlError?.message ?? 'Could not authorize this attachment download.');
      return;
    }
    await downloadFile(data.signedUrl, attachment.original_filename);
  };

  const renderConversation = (visibility: ThreadVisibility) => {
    const thread = threads[visibility];
    const staffOnly = visibility === 'staff_private';
    const title = staffOnly ? 'Tourism Officer private notes' : 'Shared conversation';
    const description = staffOnly
      ? 'Visible only to users with an active Tourism Officer role.'
      : 'Visible to the submitter, Tourism Officer, and authorized assigned office reviewers.';

    return (
      <section key={visibility} className="rounded-2xl border border-warm-border bg-card p-4">
        <header className="mb-4 border-b border-warm-border pb-3">
          <h3 className="text-xs font-semibold text-warm-text">{title}</h3>
          <p className="mt-1 text-[10px] text-muted-text">{description}</p>
        </header>

        {!thread ? (
          <p role="status" className="py-4 text-xs text-muted-text">Opening conversation...</p>
        ) : (
          <>
            {thread.error && (
              <p role="alert" className="mb-3 rounded-xl border border-rejected-bg bg-rejected-bg/50 p-3 text-xs text-rejected-text">
                {thread.error}
              </p>
            )}
            <div className="max-h-96 space-y-3 overflow-y-auto" aria-live="polite">
              {thread.loading && thread.messages.length === 0 ? (
                <p className="py-4 text-xs text-muted-text">Loading messages...</p>
              ) : thread.messages.length === 0 ? (
                <p className="py-4 text-xs text-muted-text">No messages yet.</p>
              ) : (
                thread.messages.map((message) => (
                  <article key={message.id} className="rounded-xl bg-sidebar p-3">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <p className="text-[10px] font-semibold text-warm-text">
                        {message.author_profile_id === userId ? 'You' : 'Workflow participant'}
                      </p>
                      <time className="text-[10px] text-muted-text" dateTime={message.created_at}>
                        {new Date(message.created_at).toLocaleString()}
                      </time>
                    </div>
                    <p className="whitespace-pre-wrap break-words text-xs leading-relaxed text-warm-text">{message.body}</p>
                    {message.attachments.length > 0 && (
                      <ul className="mt-3 space-y-1">
                        {message.attachments.map((attachment) => (
                          <li key={attachment.id}>
                            <button
                              type="button"
                              onClick={() => void downloadAttachment(attachment)}
                              className="text-left text-[11px] font-medium text-clay underline"
                            >
                              {attachment.original_filename}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </article>
                ))
              )}
            </div>

            <form onSubmit={(event) => void sendMessage(visibility, event)} className="mt-4 space-y-3">
              <label className="sr-only" htmlFor={`message-${visibility}-${submissionId}`}>Write a message</label>
              <textarea
                id={`message-${visibility}-${submissionId}`}
                value={drafts[visibility] ?? ''}
                onChange={(event) => setDrafts((current) => ({ ...current, [visibility]: event.target.value }))}
                maxLength={5000}
                rows={3}
                placeholder="Write a message..."
                className="w-full rounded-xl border border-warm-border bg-card p-3 text-xs text-warm-text outline-none focus:border-clay"
              />
              <div className="flex flex-wrap items-center justify-between gap-3">
                <label className="cursor-pointer text-[11px] font-semibold text-clay">
                  Attach files
                  <input
                    type="file"
                    multiple
                    accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.ppt,.pptx,.jpg,.jpeg,.png,.zip"
                    className="sr-only"
                    onChange={(event) => {
                      handleFileSelection(Array.from(event.currentTarget.files ?? []));
                      event.currentTarget.value = '';
                    }}
                  />
                </label>
                <button
                  type="submit"
                  disabled={sending !== null || !drafts[visibility]?.trim()}
                  className="rounded-full bg-clay px-4 py-2 text-[11px] font-semibold text-white disabled:opacity-50"
                >
                  {sending === visibility ? 'Sending...' : 'Send message'}
                </button>
              </div>
              {selectedFiles.length > 0 && (
                <ul className="space-y-1 text-[10px] text-muted-text">
                  {selectedFiles.map((file) => (
                    <li key={`${file.name}:${file.lastModified}`} className="flex items-center justify-between gap-3">
                      <span className="truncate">{file.name}</span>
                      <button
                        type="button"
                        onClick={() => setSelectedFiles((current) => current.filter((candidate) => candidate !== file))}
                        className="font-semibold text-rejected-text"
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </form>
          </>
        )}
      </section>
    );
  };

  return (
    <section className="rounded-2xl border border-warm-border bg-card p-5 max-md:p-3.5">
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3 border-b border-warm-border pb-4">
        <div>
          <h2 className="text-sm font-semibold text-warm-text">Document communication</h2>
          <p className="mt-1 text-[11px] text-muted-text">
            {trackingNumber || fileName} · Private submission conversations
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refreshThreads()}
          className="rounded-full border border-warm-border px-3 py-1.5 text-[10px] font-semibold text-warm-text"
        >
          Refresh
        </button>
      </header>

      <div role="tablist" aria-label="Submission conversation and activity" className="mb-4 flex gap-2 border-b border-warm-border">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'messages'}
          onClick={() => setActiveTab('messages')}
          className={`border-b-2 px-3 py-2 text-[11px] font-semibold ${activeTab === 'messages' ? 'border-clay text-clay' : 'border-transparent text-muted-text'}`}
        >
          Messages
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'activity'}
          onClick={() => setActiveTab('activity')}
          className={`border-b-2 px-3 py-2 text-[11px] font-semibold ${activeTab === 'activity' ? 'border-clay text-clay' : 'border-transparent text-muted-text'}`}
        >
          Activity
        </button>
      </div>

      {pageError && (
        <p role="alert" className="mb-4 rounded-xl border border-rejected-bg bg-rejected-bg/50 px-4 py-3 text-xs text-rejected-text">
          {pageError}
        </p>
      )}
      {notice && (
        <p role="status" className="mb-4 rounded-xl border border-approved-bg bg-approved-bg/50 px-4 py-3 text-xs text-approved-text">
          {notice}
        </p>
      )}

      {activeTab === 'messages' ? (
        <div className="space-y-4">
          {renderConversation('participants')}
          {isTourismOfficer && renderConversation('staff_private')}
        </div>
      ) : (
        <div>{activity}</div>
      )}
    </section>
  );
}

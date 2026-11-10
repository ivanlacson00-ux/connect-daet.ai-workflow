import { renderWorkflowNotificationEmail } from '../_shared/email-templates.ts';

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (request: Request) => Response | Promise<Response>): void;
};

const batchSize = 20;
const concurrency = 5;
const maximumAttempts = 6;

interface EmailJob {
  id: string;
  recipient_email: string;
  subject: string;
  body: string;
  attempts: number;
  notification_title: string | null;
  document_reference: string | null;
  action_path: string | null;
  recipient_name: string | null;
}

interface EmailSendError {
  message: string;
  statusCode: number | null;
  name: string;
}

interface SendGridSendResult {
  data: { id: string } | null;
  error: EmailSendError | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isRetryableProviderError(error: EmailSendError) {
  const statusCode = error.statusCode;
  if (statusCode === null || statusCode >= 500) return true;
  return [408, 409, 425, 429].includes(statusCode);
}

function retryAt(attempt: number) {
  const delayMinutes = Math.min(360, 15 * 2 ** Math.max(0, attempt - 1));
  return new Date(Date.now() + delayMinutes * 60_000).toISOString();
}

function requiredEnv(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing required Edge Function secret: ${name}`);
  return value;
}

const supabaseUrl = requiredEnv('SUPABASE_URL').replace(/\/$/, '');
const serviceRoleKey = requiredEnv('SUPABASE_SERVICE_ROLE_KEY');
const sendGridApiKey = requiredEnv('SENDGRID_API_KEY');
const fromEmail = requiredEnv('SENDGRID_FROM_EMAIL');
const cronSecret = requiredEnv('CRON_SECRET');
const configuredAppUrl = new URL(requiredEnv('APP_BASE_URL'));
if (!['http:', 'https:'].includes(configuredAppUrl.protocol)) {
  throw new Error('APP_BASE_URL must use HTTP or HTTPS.');
}
const appUrl = configuredAppUrl.origin;

async function supabaseRequest(path: string, init: RequestInit = {}) {
  const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: serviceRoleKey,
      authorization: `Bearer ${serviceRoleKey}`,
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...init.headers,
    },
  });
  const responseText = await response.text();
  let responseBody: unknown = null;
  if (responseText) {
    try {
      responseBody = JSON.parse(responseText);
    } catch {
      responseBody = responseText;
    }
  }
  if (!response.ok) {
    const message = isRecord(responseBody) && typeof responseBody.message === 'string'
      ? responseBody.message
      : `Supabase request failed with status ${response.status}`;
    throw new Error(message);
  }
  return responseBody;
}

async function sendEmail(job: EmailJob): Promise<SendGridSendResult> {
  const actionPath = job.action_path || '/workflow';
  const emailContent = renderWorkflowNotificationEmail({
    actionUrl: actionPath,
    appUrl,
    body: job.body,
    documentReference: job.document_reference,
    recipientName: job.recipient_name,
    subject: job.subject,
    title: job.notification_title || job.subject,
  });
  const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      authorization: 'Bearer ' + sendGridApiKey,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      personalizations: [{
        to: [{ email: job.recipient_email }],
        custom_args: { workflow_email_id: job.id },
      }],
      from: { email: fromEmail },
      subject: job.subject,
      content: [
        { type: 'text/plain', value: emailContent.text },
        { type: 'text/html', value: emailContent.html },
      ],
    }),
  });

  if (!response.ok) {
    const responseText = await response.text();
    let responseBody: unknown = null;
    try {
      responseBody = JSON.parse(responseText);
    } catch {
      responseBody = null;
    }
    const firstError = isRecord(responseBody) && Array.isArray(responseBody.errors)
      ? responseBody.errors.find(isRecord)
      : null;
    const message = firstError && typeof firstError.message === 'string'
      ? firstError.message
      : 'SendGrid request failed with status ' + response.status;
    return {
      data: null,
      error: { message, statusCode: response.status, name: 'sendgrid_error' },
    };
  }

  return {
    data: { id: response.headers.get('x-message-id') || 'workflow-email-' + job.id },
    error: null,
  };
}

async function processJob(job: EmailJob, workerId: string) {
  let providerMessageId: string | null = null;
  let sendError: EmailSendError | null = null;
  try {
    const result = await sendEmail(job);
    sendError = result.error;
    providerMessageId = result.data?.id ?? null;
  } catch (error) {
    sendError = {
      message: error instanceof Error ? error.message : 'Unexpected SendGrid request failure',
      statusCode: null,
      name: 'unexpected_error',
    };
  }

  const now = new Date().toISOString();
  const retryable = sendError ? isRetryableProviderError(sendError) : false;
  const terminalFailure = Boolean(sendError)
    && (!retryable || job.attempts >= maximumAttempts);
  const nextStatus = sendError
    ? terminalFailure ? 'failed' : 'queued'
    : 'accepted';
  const query = new URLSearchParams({
    id: `eq.${job.id}`,
    status: 'eq.processing',
    claimed_by: `eq.${workerId}`,
    select: 'id',
  });
  const updatedRows = await supabaseRequest(`workflow_email_outbox?${query}`, {
    method: 'PATCH',
    headers: { prefer: 'return=representation' },
    body: JSON.stringify({
      status: nextStatus,
      sent_at: sendError ? null : now,
      accepted_at: sendError ? null : now,
      failed_at: terminalFailure ? now : null,
      next_attempt_at: sendError && !terminalFailure ? retryAt(job.attempts) : now,
      claimed_by: null,
      lease_expires_at: null,
      provider_message_id: providerMessageId,
      last_error: sendError ? sendError.message.slice(0, 2000) : null,
      is_retryable: sendError ? retryable : false,
      last_updated_at: now,
    }),
  });
  if (!Array.isArray(updatedRows) || updatedRows.length === 0) {
    throw new Error('Email processing lease was lost before the result could be recorded.');
  }

  await supabaseRequest('workflow_email_attempts', {
    method: 'POST',
    headers: { prefer: 'return=minimal' },
    body: JSON.stringify({
      outbox_id: job.id,
      attempt_number: job.attempts,
      outcome: sendError
        ? terminalFailure ? 'failed' : 'retry_scheduled'
        : 'accepted',
      provider_message_id: providerMessageId,
      error_message: sendError ? sendError.message.slice(0, 2000) : null,
    }),
  });

  if (!sendError) return 'accepted' as const;
  return terminalFailure ? 'failed' as const : 'retried' as const;
}

async function processBatch(jobs: EmailJob[], workerId: string) {
  let accepted = 0;
  let retried = 0;
  let failed = 0;
  let processingErrors = 0;

  for (let index = 0; index < jobs.length; index += concurrency) {
    const batch = jobs.slice(index, index + concurrency);
    const results = await Promise.all(batch.map(async (job) => {
      try {
        return await processJob(job, workerId);
      } catch (error) {
        processingErrors += 1;
        console.error(`Email job ${job.id} processing failed:`, error);
        return 'error' as const;
      }
    }));

    for (const result of results) {
      if (result === 'accepted') accepted += 1;
      else if (result === 'retried') retried += 1;
      else if (result === 'failed') failed += 1;
    }
  }

  return { accepted, retried, failed, processingErrors };
}

Deno.serve(async (request: Request) => {
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }
  if (request.headers.get('x-cron-secret') !== cronSecret) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const workerId = crypto.randomUUID();
  let jobs: EmailJob[];
  try {
    const claimed = await supabaseRequest('rpc/claim_workflow_email_jobs', {
      method: 'POST',
      body: JSON.stringify({
        worker_id: workerId,
        requested_batch_size: batchSize,
      }),
    });
    jobs = Array.isArray(claimed) ? claimed as EmailJob[] : [];
  } catch (error) {
    console.error('Email job claim failed:', error);
    return Response.json({ error: 'Could not claim email jobs' }, { status: 500 });
  }

  const result = await processBatch(jobs, workerId);
  return Response.json({
    processed: jobs.length,
    ...result,
  }, { status: result.processingErrors > 0 ? 500 : 200 });
});

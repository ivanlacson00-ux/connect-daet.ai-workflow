import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import { createClient } from '@supabase/supabase-js';
import { renderWorkflowNotificationEmail } from '@/lib/email/templates';

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

function isRetryableProviderError(error: EmailSendError) {
  const statusCode = error.statusCode;
  if (statusCode === null || statusCode >= 500) return true;
  return [408, 409, 425, 429].includes(statusCode);
}

function retryAt(attempt: number) {
  const delayMinutes = Math.min(360, 15 * 2 ** Math.max(0, attempt - 1));
  return new Date(Date.now() + delayMinutes * 60_000).toISOString();
}

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const resendApiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.RESEND_FROM_EMAIL;
  const appBaseUrl = process.env.APP_BASE_URL;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!resendApiKey || !fromEmail || !appBaseUrl || !supabaseUrl || !serviceRoleKey) {
    console.error('Email processor is missing required server configuration.');
    return NextResponse.json(
      { error: 'Email delivery environment is not configured' },
      { status: 500 }
    );
  }

  let applicationUrl: URL;
  try {
    applicationUrl = new URL(appBaseUrl);
    if (!['http:', 'https:'].includes(applicationUrl.protocol)) {
      throw new Error('APP_BASE_URL must use HTTP or HTTPS.');
    }
  } catch (error) {
    console.error('Email processor has an invalid APP_BASE_URL.', error);
    return NextResponse.json(
      { error: 'Email delivery environment is not configured' },
      { status: 500 }
    );
  }

  const resend = new Resend(resendApiKey);
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const workerId = randomUUID();

  const { data: jobs, error: claimError } = await supabase.rpc(
    'claim_workflow_email_jobs',
    { worker_id: workerId, requested_batch_size: batchSize }
  );
  if (claimError) {
    console.error('Email job claim failed:', claimError.message);
    return NextResponse.json({ error: 'Could not claim email jobs' }, { status: 500 });
  }

  let accepted = 0;
  let retried = 0;
  let failed = 0;
  let processingErrors = 0;
  const claimedJobs = (jobs ?? []) as EmailJob[];

  for (let index = 0; index < claimedJobs.length; index += concurrency) {
    const batch = claimedJobs.slice(index, index + concurrency);
    const results = await Promise.all(batch.map(async (job) => {
      try {
        let providerMessageId: string | null = null;
        let sendError: EmailSendError | null = null;
        try {
          const actionPath = job.action_path || '/workflow';
          const emailContent = renderWorkflowNotificationEmail({
            actionUrl: actionPath,
            appUrl: applicationUrl.origin,
            body: job.body,
            documentReference: job.document_reference,
            recipientName: job.recipient_name,
            subject: job.subject,
            title: job.notification_title || job.subject,
          });
          const response = await resend.emails.send(
            {
              from: fromEmail,
              to: job.recipient_email,
              subject: job.subject,
              html: emailContent.html,
              text: emailContent.text,
            },
            { idempotencyKey: `workflow-email-${job.id}` }
          );
          if (response.error) sendError = response.error;
          else providerMessageId = response.data.id;
        } catch (error) {
          sendError = {
            message: error instanceof Error ? error.message : 'Unexpected Resend request failure',
            statusCode: null,
            name: 'unexpected_error',
          };
        }

        const now = new Date().toISOString();
        const retryable = sendError ? isRetryableProviderError(sendError) : false;
        const terminalFailure =
          Boolean(sendError)
          && (!retryable || job.attempts >= maximumAttempts);
        const nextStatus = sendError
          ? terminalFailure ? 'failed' : 'queued'
          : 'accepted';
        const { data: updatedRows, error: updateError } = await supabase
          .from('workflow_email_outbox')
          .update({
            status: nextStatus,
            sent_at: sendError ? null : now,
            accepted_at: sendError ? null : now,
            failed_at: terminalFailure ? now : null,
            next_attempt_at: sendError && !terminalFailure ? retryAt(job.attempts) : null,
            claimed_by: null,
            lease_expires_at: null,
            provider_message_id: providerMessageId,
            last_error: sendError ? sendError.message.slice(0, 2000) : null,
            is_retryable: sendError ? retryable : false,
            last_updated_at: now,
          })
          .eq('id', job.id)
          .eq('status', 'processing')
          .eq('claimed_by', workerId)
          .select('id');

        if (updateError) {
          throw new Error(`Could not record email processing result: ${updateError.message}`);
        }
        if (!updatedRows?.length) {
          throw new Error('Email processing lease was lost before the result could be recorded.');
        }

        const { error: attemptError } = await supabase
          .from('workflow_email_attempts')
          .insert({
            outbox_id: job.id,
            attempt_number: job.attempts,
            outcome: sendError
              ? terminalFailure ? 'failed' : 'retry_scheduled'
              : 'accepted',
            provider_message_id: providerMessageId,
            error_message: sendError ? sendError.message.slice(0, 2000) : null,
          });
        if (attemptError) {
          throw new Error(`Could not record email attempt: ${attemptError.message}`);
        }

        if (!sendError) return 'accepted' as const;
        return terminalFailure ? 'failed' as const : 'retried' as const;
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

  return NextResponse.json({
    processed: claimedJobs.length,
    accepted,
    retried,
    failed,
    processingErrors,
  }, { status: processingErrors > 0 ? 500 : 200 });
}

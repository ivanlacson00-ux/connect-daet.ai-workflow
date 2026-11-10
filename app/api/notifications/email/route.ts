import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import { createClient } from '@supabase/supabase-js';
import { renderWorkflowNotificationEmail } from '@/lib/email/templates';

export const runtime = 'nodejs';

const batchSize = 20;
const concurrency = 5;
const maximumAttempts = 6;

interface EmailJob {
  delivery_id: string;
  submission_id: string;
  recipient_profile_id: string;
  event_key: string;
  title: string;
  message: string;
  tracking_number: string;
  submission_title: string;
  attempt_count: number;
}

interface EmailSendError {
  message: string;
  statusCode: number | null;
}

function getNotificationActionUrl(eventKey: string, submissionId: string) {
  if (eventKey.startsWith('initial-review:') || eventKey.startsWith('office-response:')) {
    return `/workflow/approver/file_management/${submissionId}`;
  }
  if (eventKey.startsWith('office-assignment:')) {
    return `/workflow/office/submissions/${submissionId}`;
  }
  if (eventKey.startsWith('overall-decision:')) {
    return `/workflow/user/file_registry/${submissionId}`;
  }
  return '/workflow';
}

function isRetryableProviderError(error: EmailSendError) {
  return error.statusCode === null
    || error.statusCode >= 500
    || [408, 409, 425, 429].includes(error.statusCode);
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
    return NextResponse.json({ error: 'Email delivery environment is not configured' }, { status: 500 });
  }

  let applicationUrl: URL;
  try {
    applicationUrl = new URL(appBaseUrl);
    if (!['http:', 'https:'].includes(applicationUrl.protocol)) {
      throw new Error('APP_BASE_URL must use HTTP or HTTPS.');
    }
  } catch (error) {
    console.error('Email processor has an invalid APP_BASE_URL.', error);
    return NextResponse.json({ error: 'Email delivery environment is not configured' }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const resend = new Resend(resendApiKey);
  const workerToken = randomUUID();
  const { data: jobs, error: claimError } = await supabase.rpc(
    'claim_notification_email_deliveries',
    { p_worker_token: workerToken, p_batch_size: batchSize }
  );
  if (claimError) {
    console.error('Email delivery claim failed:', claimError.message);
    return NextResponse.json({ error: 'Could not claim email deliveries' }, { status: 500 });
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
        const { data: recipientData, error: recipientError } =
          await supabase.auth.admin.getUserById(job.recipient_profile_id);
        let providerMessageId: string | null = null;
        let sendError: EmailSendError | null = null;
        let outcome: 'accepted' | 'confirmed_failed' | 'unknown' = 'confirmed_failed';

        if (recipientError) {
          sendError = { message: recipientError.message, statusCode: null };
          outcome = 'unknown';
        } else if (!recipientData.user?.email) {
          sendError = { message: 'Recipient account has no email address.', statusCode: 400 };
        } else {
          try {
            const emailContent = renderWorkflowNotificationEmail({
              actionUrl: getNotificationActionUrl(job.event_key, job.submission_id),
              appUrl: applicationUrl.origin,
              body: job.message,
              documentReference: job.tracking_number,
              recipientName: null,
              subject: job.title,
              title: job.title,
            });
            const response = await resend.emails.send(
              {
                from: fromEmail,
                to: recipientData.user.email,
                subject: job.title,
                html: emailContent.html,
                text: emailContent.text,
              },
              { idempotencyKey: `connect-daet-notification-${job.delivery_id}` }
            );
            if (response.error) {
              sendError = {
                message: response.error.message,
                statusCode: response.error.statusCode ?? null,
              };
              outcome = 'confirmed_failed';
            } else {
              providerMessageId = response.data.id;
              outcome = 'accepted';
            }
          } catch (error) {
            sendError = {
              message: error instanceof Error ? error.message : 'Unexpected Resend request failure.',
              statusCode: null,
            };
            outcome = 'unknown';
          }
        }

        const canRetry = sendError !== null
          && isRetryableProviderError(sendError)
          && job.attempt_count < maximumAttempts;
        const { error: completionError } = await supabase.rpc(
          'complete_notification_email_delivery',
          {
            p_delivery_id: job.delivery_id,
            p_worker_token: workerToken,
            p_outcome: outcome,
            p_provider_message_id: providerMessageId,
            p_error: sendError?.message.slice(0, 1000) ?? null,
            p_retry_at: canRetry ? retryAt(job.attempt_count) : null,
          }
        );
        if (completionError) {
          throw new Error(`Could not record email delivery result: ${completionError.message}`);
        }

        if (!sendError) return 'accepted' as const;
        return canRetry ? 'retried' as const : 'failed' as const;
      } catch (error) {
        processingErrors += 1;
        console.error(`Email delivery ${job.delivery_id} could not be completed:`, error);
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

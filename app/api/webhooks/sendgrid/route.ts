import { EventWebhook } from '@sendgrid/eventwebhook';
import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

const trackedEventTypes: Record<string, string> = {
  delivered: 'email.delivered',
  bounce: 'email.bounced',
  spamreport: 'email.complained',
  dropped: 'email.failed',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function errorResponse(message: string, status: number) {
  return NextResponse.json(
    { error: message },
    { status, headers: { 'Cache-Control': 'no-store' } }
  );
}

export async function POST(request: NextRequest) {
  const publicKey = process.env.SENDGRID_WEBHOOK_PUBLIC_KEY;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!publicKey || !supabaseUrl || !serviceRoleKey) {
    console.error('SendGrid webhook is missing required server configuration.');
    return errorResponse('Webhook is not configured', 500);
  }

  const signature = request.headers.get('x-twilio-email-event-webhook-signature');
  const timestamp = request.headers.get('x-twilio-email-event-webhook-timestamp');
  if (!signature || !timestamp) {
    return errorResponse('Missing SendGrid signature headers', 400);
  }

  const payload = await request.text();
  if (payload.length > 1_000_000) {
    return errorResponse('Webhook payload is too large', 413);
  }

  let signatureIsValid: boolean;
  try {
    const verifier = new EventWebhook();
    const ecdsaPublicKey = verifier.convertPublicKeyToECDSA(publicKey);
    signatureIsValid = verifier.verifySignature(
      ecdsaPublicKey,
      payload,
      signature,
      timestamp
    );
  } catch (error) {
    console.error('SendGrid webhook signature verification failed:', error);
    return errorResponse('Could not verify webhook signature', 500);
  }
  if (!signatureIsValid) {
    return errorResponse('Invalid webhook signature', 401);
  }

  let events: unknown;
  try {
    events = JSON.parse(payload);
  } catch {
    return errorResponse('Invalid webhook JSON', 400);
  }
  if (!Array.isArray(events)) {
    return errorResponse('Expected an array of SendGrid events', 400);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  let recordedCount = 0;
  let duplicateCount = 0;
  for (const event of events) {
    if (!isRecord(event) || typeof event.event !== 'string') {
      return errorResponse('Invalid SendGrid event object', 400);
    }

    const providerEventType = trackedEventTypes[event.event];
    if (!providerEventType) continue;

    const eventId = event.sg_event_id;
    const messageId = event.sg_message_id;
    const timestampSeconds = event.timestamp;
    const outboxId = event.workflow_email_id;
    if (
      typeof eventId !== 'string'
      || typeof messageId !== 'string'
      || typeof timestampSeconds !== 'number'
      || !Number.isSafeInteger(timestampSeconds)
      || typeof outboxId !== 'string'
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(outboxId)
    ) {
      return errorResponse('Tracked SendGrid event is missing required identifiers', 400);
    }

    const occurredAt = new Date(timestampSeconds * 1000);
    if (!Number.isFinite(occurredAt.getTime())) {
      return errorResponse('Tracked SendGrid event has an invalid timestamp', 400);
    }

    const { data: recorded, error } = await supabase.rpc(
      'record_workflow_email_provider_event',
      {
        p_provider_event_id: eventId,
        p_provider_event_type: providerEventType,
        p_provider_message_id: messageId,
        p_event_occurred_at: occurredAt.toISOString(),
        p_provider_event_data: event,
        p_outbox_id: outboxId,
      }
    );
    if (error) {
      console.error('SendGrid webhook event could not be recorded:', error.message);
      return errorResponse('Could not record email event', 503);
    }
    if (recorded === false) duplicateCount += 1;
    else recordedCount += 1;
  }

  return NextResponse.json({
    received: true,
    recorded: recordedCount,
    duplicates: duplicateCount,
  });
}

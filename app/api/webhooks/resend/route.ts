import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

export const runtime = 'nodejs';

const trackedEventTypes = new Set([
  'email.delivered',
  'email.bounced',
  'email.complained',
  'email.failed',
  'email.suppressed',
]);

export async function POST(request: NextRequest) {
  const webhookSecret = process.env.RESEND_WEBHOOK_SECRET;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!webhookSecret || !supabaseUrl || !serviceRoleKey) {
    console.error('Resend webhook is missing required server configuration.');
    return NextResponse.json({ error: 'Webhook is not configured' }, { status: 500 });
  }

  const eventId = request.headers.get('svix-id');
  const timestamp = request.headers.get('svix-timestamp');
  const signature = request.headers.get('svix-signature');
  if (!eventId || !timestamp || !signature) {
    return NextResponse.json({ error: 'Missing webhook signature headers' }, { status: 400 });
  }

  const payload = await request.text();
  const resend = new Resend();
  let event: ReturnType<typeof resend.webhooks.verify>;
  try {
    event = resend.webhooks.verify({
      payload,
      headers: { id: eventId, timestamp, signature },
      webhookSecret,
    });
  } catch {
    return NextResponse.json({ error: 'Invalid webhook signature' }, { status: 400 });
  }

  if (!trackedEventTypes.has(event.type)) {
    return NextResponse.json({ received: true, ignored: true });
  }

  const eventData = event.data;
  if (!('email_id' in eventData) || typeof eventData.email_id !== 'string') {
    return NextResponse.json({ error: 'Webhook event is missing its email identifier' }, { status: 400 });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: recorded, error } = await supabase.rpc(
    'record_notification_provider_event',
    {
      p_provider_event_id: eventId,
      p_provider_event_type: event.type,
      p_provider_message_id: eventData.email_id,
      p_event_occurred_at: event.created_at,
      p_provider_event_data: {},
    }
  );

  if (error) {
    console.error('Resend webhook event could not be recorded:', error.message);
    return NextResponse.json({ error: 'Could not record email event' }, { status: 503 });
  }

  return NextResponse.json({
    received: true,
    duplicate: recorded === false,
  });
}

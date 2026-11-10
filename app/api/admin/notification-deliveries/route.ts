import { createServerClient } from '@supabase/ssr';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

const emailStatuses = ['queued', 'processing', 'accepted', 'delivered', 'failed'] as const;
type EmailStatus = (typeof emailStatuses)[number];

type DeliveryRow = {
  id: string;
  notification_id: string;
  recipient_profile_id: string;
  status: EmailStatus;
  attempt_count: number;
  created_at: string;
  next_attempt_at: string;
  last_error: string | null;
  provider_message_id: string | null;
  completed_at: string | null;
};

function respond(
  cookieResponse: NextResponse,
  body: unknown,
  status = 200
) {
  const response = NextResponse.json(body, { status });
  for (const cookie of cookieResponse.cookies.getAll()) response.cookies.set(cookie);
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}

function createSessionClient(request: NextRequest, cookieResponse: NextResponse) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new Error('Supabase session configuration is missing.');

  return createServerClient(url, anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet) => {
        cookiesToSet.forEach(({ name, value, options }) => {
          cookieResponse.cookies.set(name, value, options);
        });
      },
    },
  });
}

async function authorizeAdministrator(
  request: NextRequest,
  cookieResponse: NextResponse
) {
  const supabase = createSessionClient(request, cookieResponse);
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError) throw new Error(`Could not verify session: ${userError.message}`);
  if (!userData.user) return { supabase, user: null, responseStatus: 401 as const };

  const { data: grants, error: grantError } = await supabase
    .from('role_grants')
    .select('id')
    .eq('profile_id', userData.user.id)
    .eq('role', 'admin')
    .is('revoked_at', null)
    .limit(1);
  if (grantError) throw new Error(`Could not verify administrator access: ${grantError.message}`);
  if (!grants?.length) return { supabase, user: null, responseStatus: 403 as const };
  return { supabase, user: userData.user, responseStatus: null };
}

function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) throw new Error('Server-side Supabase service configuration is missing.');
  return createSupabaseClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function GET(request: NextRequest) {
  const cookieResponse = new NextResponse(null);
  try {
    const access = await authorizeAdministrator(request, cookieResponse);
    if (access.responseStatus) {
      return respond(cookieResponse, { error: 'Administrator access is required.' }, access.responseStatus);
    }

    const serviceClient = createServiceClient();
    const requestedStatus = request.nextUrl.searchParams.get('status');
    const attemptDeliveryId = request.nextUrl.searchParams.get('attempts');

    if (attemptDeliveryId) {
      const { data: delivery, error: deliveryError } = await serviceClient
        .from('notification_deliveries')
        .select('id')
        .eq('id', attemptDeliveryId)
        .eq('channel', 'email')
        .maybeSingle();
      if (deliveryError) throw new Error(`Could not verify email delivery: ${deliveryError.message}`);
      if (!delivery) return respond(cookieResponse, { error: 'Email delivery was not found.' }, 404);

      const { data: attempts, error: attemptError } = await serviceClient
        .from('notification_delivery_attempts')
        .select('id, outcome, attempted_at, safe_error_metadata')
        .eq('delivery_id', attemptDeliveryId)
        .order('attempted_at', { ascending: false })
        .limit(20);
      if (attemptError) throw new Error(`Could not load delivery attempts: ${attemptError.message}`);
      return respond(cookieResponse, { attempts: attempts ?? [] });
    }

    let deliveryQuery = serviceClient
      .from('notification_deliveries')
      .select('id, notification_id, recipient_profile_id, status, attempt_count, created_at, next_attempt_at, last_error, provider_message_id, completed_at')
      .eq('channel', 'email')
      .order('created_at', { ascending: false })
      .limit(50);
    if (emailStatuses.includes(requestedStatus as EmailStatus)) {
      deliveryQuery = deliveryQuery.eq('status', requestedStatus as EmailStatus);
    }
    const { data: deliveries, error: deliveriesError } = await deliveryQuery;
    if (deliveriesError) throw new Error(`Could not load email deliveries: ${deliveriesError.message}`);

    const counts = {} as Record<EmailStatus, number>;
    const countResults = await Promise.all(emailStatuses.map((status) =>
      serviceClient
        .from('notification_deliveries')
        .select('id', { count: 'exact', head: true })
        .eq('channel', 'email')
        .eq('status', status)
    ));
    countResults.forEach((result, index) => {
      if (result.error) throw new Error(`Could not count ${emailStatuses[index]} deliveries: ${result.error.message}`);
      counts[emailStatuses[index]] = result.count ?? 0;
    });
    const { count: pendingRetries, error: retriesError } = await serviceClient
      .from('notification_deliveries')
      .select('id', { count: 'exact', head: true })
      .eq('channel', 'email')
      .eq('status', 'queued')
      .gt('attempt_count', 0);
    if (retriesError) throw new Error(`Could not count pending retries: ${retriesError.message}`);

    const rows = (deliveries ?? []) as DeliveryRow[];
    const notificationIds = [...new Set(rows.map((delivery) => delivery.notification_id))];
    const { data: notifications, error: notificationError } = notificationIds.length
      ? await serviceClient
        .from('notifications')
        .select('id, title, submission_id')
        .in('id', notificationIds)
      : { data: [], error: null };
    if (notificationError) throw new Error(`Could not load notification details: ${notificationError.message}`);

    const submissionIds = [...new Set((notifications ?? []).map((notification) => notification.submission_id))];
    const { data: submissions, error: submissionError } = submissionIds.length
      ? await serviceClient
        .from('submissions')
        .select('id, tracking_number')
        .in('id', submissionIds)
      : { data: [], error: null };
    if (submissionError) throw new Error(`Could not load submission references: ${submissionError.message}`);

    const notificationById = new Map((notifications ?? []).map((notification) => [notification.id, notification]));
    const submissionById = new Map((submissions ?? []).map((submission) => [submission.id, submission]));
    const emailByProfile = new Map<string, string | null>();
    await Promise.all([...new Set(rows.map((delivery) => delivery.recipient_profile_id))].map(async (profileId) => {
      const { data, error } = await serviceClient.auth.admin.getUserById(profileId);
      if (error) throw new Error(`Could not load recipient account: ${error.message}`);
      emailByProfile.set(profileId, data.user.email ?? null);
    }));

    const records = rows.map((delivery) => {
      const notification = notificationById.get(delivery.notification_id);
      const submission = notification ? submissionById.get(notification.submission_id) : undefined;
      return {
        ...delivery,
        recipient_email: emailByProfile.get(delivery.recipient_profile_id) ?? null,
        title: notification?.title ?? 'Notification',
        tracking_number: submission?.tracking_number ?? null,
      };
    });

    return respond(cookieResponse, { records, counts, pendingRetries: pendingRetries ?? 0 });
  } catch (error) {
    console.error('Administrator email monitoring request failed:', error);
    return respond(cookieResponse, { error: 'Email monitoring data could not be loaded.' }, 500);
  }
}

export async function POST(request: NextRequest) {
  const cookieResponse = new NextResponse(null);
  try {
    if (request.headers.get('origin') !== request.nextUrl.origin) {
      return respond(cookieResponse, { error: 'Cross-origin requests are not allowed.' }, 403);
    }
    const access = await authorizeAdministrator(request, cookieResponse);
    if (access.responseStatus) {
      return respond(cookieResponse, { error: 'Administrator access is required.' }, access.responseStatus);
    }

    const payload: unknown = await request.json();
    if (
      typeof payload !== 'object'
      || payload === null
      || !('deliveryId' in payload)
      || typeof payload.deliveryId !== 'string'
    ) {
      return respond(cookieResponse, { error: 'A valid delivery ID is required.' }, 400);
    }

    const { data, error } = await access.supabase.rpc(
      'admin_retry_notification_email_delivery',
      { p_delivery_id: payload.deliveryId }
    );
    if (error) throw new Error(`Could not retry email delivery: ${error.message}`);
    return respond(cookieResponse, { queued: data === true });
  } catch (error) {
    console.error('Administrator email retry request failed:', error);
    return respond(cookieResponse, { error: 'Email retry request could not be completed.' }, 500);
  }
}

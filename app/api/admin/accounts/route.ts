import { createServerClient } from '@supabase/ssr';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

const workflowRoles = ['user', 'approver', 'external_approver', 'admin'] as const;
type WorkflowRole = (typeof workflowRoles)[number];

function respond(cookieResponse: NextResponse, body: unknown, status = 200) {
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
  if (!userData.user) return { supabase, user: null, status: 401 as const };

  const { data: grants, error: grantError } = await supabase
    .from('role_grants')
    .select('id')
    .eq('profile_id', userData.user.id)
    .eq('role', 'admin')
    .is('revoked_at', null)
    .limit(1);
  if (grantError) throw new Error(`Could not verify administrator access: ${grantError.message}`);
  if (!grants?.length) return { supabase, user: null, status: 403 as const };
  return { supabase, user: userData.user, status: null };
}

function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error('Server-side Supabase service configuration is missing.');
  }
  return createSupabaseClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function GET(request: NextRequest) {
  const cookieResponse = new NextResponse(null);
  try {
    const access = await authorizeAdministrator(request, cookieResponse);
    if (access.status) {
      return respond(cookieResponse, { error: 'Administrator access is required.' }, access.status);
    }

    const adminClient = createServiceClient();
    const [rolesResult, membershipsResult, officesResult] = await Promise.all([
      adminClient
        .from('role_grants')
        .select('id, profile_id, role, granted_at, revoked_at, revocation_reason')
        .order('granted_at', { ascending: false }),
      adminClient
        .from('office_memberships')
        .select('id, profile_id, office_id, started_at, ended_at, end_reason')
        .order('started_at', { ascending: false }),
      adminClient
        .from('offices')
        .select('id, code, name, is_active')
        .order('name'),
    ]);
    if (rolesResult.error) throw new Error(`Could not load workflow roles: ${rolesResult.error.message}`);
    if (membershipsResult.error) throw new Error(`Could not load office memberships: ${membershipsResult.error.message}`);
    if (officesResult.error) throw new Error(`Could not load offices: ${officesResult.error.message}`);

    const accounts = [];
    for (let page = 1; ; page += 1) {
      const { data, error } = await adminClient.auth.admin.listUsers({ page, perPage: 500 });
      if (error) throw new Error(`Could not load accounts: ${error.message}`);
      accounts.push(...data.users.map((account) => ({
        id: account.id,
        email: account.email ?? null,
        created_at: account.created_at,
        email_confirmed_at: account.email_confirmed_at ?? null,
      })));
      if (data.users.length < 500) break;
    }

    return respond(cookieResponse, {
      accounts,
      roleGrants: rolesResult.data ?? [],
      officeMemberships: membershipsResult.data ?? [],
      offices: officesResult.data ?? [],
    });
  } catch (error) {
    console.error('Administrator account directory request failed:', error);
    return respond(cookieResponse, { error: 'The account directory could not be loaded.' }, 500);
  }
}

export async function POST(request: NextRequest) {
  const cookieResponse = new NextResponse(null);
  try {
    if (request.headers.get('origin') !== request.nextUrl.origin) {
      return respond(cookieResponse, { error: 'Cross-origin requests are not allowed.' }, 403);
    }
    if (!request.headers.get('content-type')?.includes('application/json')) {
      return respond(cookieResponse, { error: 'Expected a JSON request body.' }, 415);
    }

    const access = await authorizeAdministrator(request, cookieResponse);
    if (access.status) {
      return respond(cookieResponse, { error: 'Administrator access is required.' }, access.status);
    }

    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return respond(cookieResponse, { error: 'Request body must be valid JSON.' }, 400);
    }
    if (typeof payload !== 'object' || payload === null || !('action' in payload) || typeof payload.action !== 'string') {
      return respond(cookieResponse, { error: 'A valid account action is required.' }, 400);
    }

    if (payload.action === 'invite') {
      if (
        !('email' in payload) || typeof payload.email !== 'string'
        || !('role' in payload) || typeof payload.role !== 'string'
        || !workflowRoles.includes(payload.role as WorkflowRole)
      ) {
        return respond(cookieResponse, { error: 'A valid email address and workflow role are required.' }, 400);
      }
      const email = payload.email.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
        return respond(cookieResponse, { error: 'Enter a valid email address.' }, 400);
      }

      const adminClient = createServiceClient();
      const appBaseUrl = process.env.APP_BASE_URL;
      const redirectTo = appBaseUrl
        ? new URL('/setup-password', appBaseUrl).toString()
        : undefined;
      const { data, error } = await adminClient.auth.admin.inviteUserByEmail(
        email,
        redirectTo ? { redirectTo } : undefined
      );
      if (error || !data.user) {
        return respond(cookieResponse, {
          error: error?.message ?? 'The invitation could not be created.',
        }, 400);
      }

      const { error: roleError } = await access.supabase.rpc('admin_grant_workflow_role', {
        p_profile_id: data.user.id,
        p_role: payload.role,
        p_reason: `Invited account assigned ${payload.role}.`,
      });
      if (roleError) {
        console.error('Account invitation succeeded but its role grant failed:', roleError.message);
        return respond(cookieResponse, {
          accountId: data.user.id,
          error: 'The invitation was sent, but the workflow role was not assigned. Assign the role from this page before the user signs in.',
        }, 502);
      }
      return respond(cookieResponse, { accountId: data.user.id, invited: true });
    }

    const { error } = await performAdminAction(access.supabase, payload as Record<string, unknown>);
    if (error) return respond(cookieResponse, { error }, 400);
    return respond(cookieResponse, { completed: true });
  } catch (error) {
    console.error('Administrator account action failed:', error);
    return respond(cookieResponse, { error: 'The account action could not be completed.' }, 500);
  }
}

async function performAdminAction(
  supabase: Awaited<ReturnType<typeof authorizeAdministrator>>['supabase'],
  payload: Record<string, unknown>
): Promise<{ error: string | null }> {
  const requiredString = (key: string) =>
    typeof payload[key] === 'string' ? payload[key].trim() : '';

  switch (payload.action) {
    case 'grant-role': {
      const profileId = requiredString('profileId');
      const role = requiredString('role');
      const reason = requiredString('reason');
      if (!profileId || !workflowRoles.includes(role as WorkflowRole) || !reason) {
        return { error: 'A target account, valid workflow role, and reason are required.' };
      }
      const { error } = await supabase.rpc('admin_grant_workflow_role', {
        p_profile_id: profileId,
        p_role: role,
        p_reason: reason,
      });
      return { error: error?.message ?? null };
    }
    case 'revoke-role': {
      const grantId = requiredString('grantId');
      const reason = requiredString('reason');
      if (!grantId || !reason) return { error: 'A role grant and reason are required.' };
      const { data, error } = await supabase.rpc('admin_revoke_workflow_role', {
        p_role_grant_id: grantId,
        p_reason: reason,
      });
      return { error: error?.message ?? (data === false ? 'The role grant is no longer active.' : null) };
    }
    case 'grant-office': {
      const profileId = requiredString('profileId');
      const officeId = requiredString('officeId');
      const reason = requiredString('reason');
      if (!profileId || !officeId || !reason) {
        return { error: 'An account, office, and reason are required.' };
      }
      const { error } = await supabase.rpc('admin_grant_office_membership', {
        p_profile_id: profileId,
        p_office_id: officeId,
        p_reason: reason,
      });
      return { error: error?.message ?? null };
    }
    case 'revoke-office': {
      const membershipId = requiredString('membershipId');
      const reason = requiredString('reason');
      if (!membershipId || !reason) return { error: 'A membership and reason are required.' };
      const { data, error } = await supabase.rpc('admin_revoke_office_membership', {
        p_membership_id: membershipId,
        p_reason: reason,
      });
      return { error: error?.message ?? (data === false ? 'The office membership is no longer active.' : null) };
    }
    case 'create-office': {
      const code = requiredString('code');
      const name = requiredString('name');
      if (!code || !name) return { error: 'An office code and name are required.' };
      const { error } = await supabase.rpc('admin_create_office', {
        p_code: code,
        p_name: name,
      });
      return { error: error?.message ?? null };
    }
    case 'set-office-active': {
      const officeId = requiredString('officeId');
      const reason = requiredString('reason');
      if (!officeId || typeof payload.isActive !== 'boolean' || !reason) {
        return { error: 'An office, status, and reason are required.' };
      }
      const { data, error } = await supabase.rpc('admin_set_office_active', {
        p_office_id: officeId,
        p_is_active: payload.isActive,
        p_reason: reason,
      });
      return { error: error?.message ?? (data === false ? 'The office was not found.' : null) };
    }
    default:
      return { error: 'Unsupported administrator action.' };
  }
}

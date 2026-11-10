import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  if (request.headers.get('origin') !== request.nextUrl.origin) {
    return NextResponse.json({ error: 'Invalid request origin' }, { status: 403 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    console.error('User deletion is missing Supabase server configuration.');
    return NextResponse.json(
      { error: 'User deletion is not configured correctly.' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  const response = NextResponse.json(
    { deleted: false },
    { headers: { 'Cache-Control': 'no-store' } }
  );
  const supabase = createServerClient(supabaseUrl, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json(
      { error: 'You must be signed in to delete a user.' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  const { data: actorProfile, error: actorProfileError } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();
  if (actorProfileError) {
    console.error('Could not verify user deletion permissions:', actorProfileError.message);
    return NextResponse.json(
      { error: 'Could not verify administrator permissions.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } }
    );
  }
  if (actorProfile?.role !== 'admin') {
    return NextResponse.json(
      { error: 'Only administrators can delete users.' },
      { status: 403, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  const { id: targetUserId } = await context.params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(targetUserId)) {
    return NextResponse.json(
      { error: 'A valid user ID is required.' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } }
    );
  }
  if (targetUserId === user.id) {
    return NextResponse.json(
      { error: 'You cannot delete your own administrator account.' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: targetProfile, error: targetProfileError } = await adminClient
    .from('profiles')
    .select('role, is_active')
    .eq('id', targetUserId)
    .maybeSingle();
  if (targetProfileError) {
    console.error('Could not look up user for deletion:', targetProfileError.message);
    return NextResponse.json(
      { error: 'Could not look up the user to delete.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } }
    );
  }
  if (!targetProfile) {
    return NextResponse.json(
      { error: 'This user no longer exists.' },
      { status: 404, headers: { 'Cache-Control': 'no-store' } }
    );
  }
  if (targetProfile.is_active && targetProfile.role === 'admin') {
    const { count, error: adminCountError } = await adminClient
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('role', 'admin')
      .eq('is_active', true);
    if (adminCountError) {
      console.error('Could not verify remaining administrators:', adminCountError.message);
      return NextResponse.json(
        { error: 'Could not verify whether another administrator remains.' },
        { status: 503, headers: { 'Cache-Control': 'no-store' } }
      );
    }
    if ((count ?? 0) <= 1) {
      return NextResponse.json(
        { error: 'The last administrator account cannot be deleted.' },
        { status: 409, headers: { 'Cache-Control': 'no-store' } }
      );
    }
  }

  const { data: authAccount, error: authLookupError } =
    await adminClient.auth.admin.getUserById(targetUserId);
  if (authLookupError || !authAccount.user) {
    console.error('Could not look up Auth account for removal:', authLookupError?.message);
    return NextResponse.json(
      { error: 'Could not find the authentication account to remove.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  const retiredEmail = `removed+${targetUserId}@account.invalid`;
  const { error: retireError } = await adminClient.auth.admin.updateUserById(targetUserId, {
    email: retiredEmail,
    email_confirm: true,
    ban_duration: '876000h',
    user_metadata: { account_status: 'removed' },
  });
  if (retireError) {
    console.error('Could not retire the Auth account:', retireError.message);
    return NextResponse.json(
      { error: 'Could not disable this account and release its email. Please try again.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  const { error: deactivateError } = await adminClient
    .from('profiles')
    .update({
      email: retiredEmail,
      full_name: 'Removed user',
      is_active: false,
    })
    .eq('id', targetUserId);
  if (deactivateError) {
    console.error('Auth account retired, but profile anonymization failed:', deactivateError.message);
    return NextResponse.json(
      {
        error: 'The old sign-in is disabled and its email is released, but request-history anonymization failed. Retry this action to complete it.',
      },
      { status: 503, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  const successResponse = NextResponse.json(
    { removed: true },
    { headers: { 'Cache-Control': 'no-store' } }
  );
  response.cookies.getAll().forEach((cookie) => successResponse.cookies.set(cookie));
  return successResponse;
}

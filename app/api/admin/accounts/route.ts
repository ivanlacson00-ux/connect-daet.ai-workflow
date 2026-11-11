import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

const OFFICIAL_ROLES = new Set([
  'tourism_officer',
  'municipal_treasurer',
  'mayor_office',
  'sangguniang_bayan',
]);

export async function GET(request: NextRequest) {
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) {
    return NextResponse.json({ error: 'Request origin is not allowed.' }, { status: 403 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) {
    console.error('Account verification status is unavailable: Supabase public configuration is missing.');
    return NextResponse.json({ error: 'Account verification status is not configured.' }, { status: 500 });
  }

  const authResponse = new NextResponse();
  const supabase = createServerClient(supabaseUrl, anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet) => {
        cookiesToSet.forEach(({ name, value, options }) => authResponse.cookies.set(name, value, options));
      },
    },
  });
  const withAuthCookies = (response: NextResponse) => {
    authResponse.cookies.getAll().forEach((cookie) => response.cookies.set(cookie));
    return response;
  };

  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) {
    return withAuthCookies(NextResponse.json({ error: 'Sign in as an administrator to view account verification status.' }, { status: 401 }));
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role, is_active')
    .eq('id', user.id)
    .maybeSingle();

  if (profileError) {
    console.error('Could not verify account status access:', profileError.message);
    return withAuthCookies(NextResponse.json({ error: 'Could not verify administrator access.' }, { status: 500 }));
  }
  if (profile?.role !== 'system_admin' || profile.is_active === false) {
    return withAuthCookies(NextResponse.json({ error: 'Only administrators can view account verification status.' }, { status: 403 }));
  }

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!serviceRoleKey || /^(replace-with|your[-_ ]|changeme|<)/i.test(serviceRoleKey)) {
    console.error('Account verification status is unavailable: SUPABASE_SERVICE_ROLE_KEY is missing or still has a placeholder value.');
    return withAuthCookies(NextResponse.json({
      error: 'Account verification status is not configured. Set SUPABASE_SERVICE_ROLE_KEY to your Supabase server-side secret key, then restart the app.',
    }, { status: 500 }));
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const verificationStatuses: Record<string, 'pending' | 'verified'> = {};
  const perPage = 1000;

  for (let page = 1; ; page += 1) {
    const { data, error } = await adminClient.auth.admin.listUsers({ page, perPage });
    if (error) {
      console.error('Could not load account verification statuses:', error.message);
      return withAuthCookies(NextResponse.json({ error: 'Could not load account verification statuses. Try again.' }, { status: 500 }));
    }

    data.users.forEach((authUser) => {
      verificationStatuses[authUser.id] = authUser.email_confirmed_at
        ? 'verified'
        : 'pending';
    });

    if (data.users.length < perPage) break;
  }

  return withAuthCookies(NextResponse.json({ verificationStatuses }, {
    headers: { 'Cache-Control': 'private, no-store' },
  }));
}

export async function POST(request: NextRequest) {
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) {
    return NextResponse.json({ error: 'Request origin is not allowed.' }, { status: 403 });
  }

  if (!request.headers.get('content-type')?.includes('application/json')) {
    return NextResponse.json({ error: 'Expected a JSON request body.' }, { status: 415 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) {
    console.error('Official account invitation is unavailable: Supabase public configuration is missing.');
    return NextResponse.json({ error: 'Account creation is not configured.' }, { status: 500 });
  }

  const authResponse = new NextResponse();
  const supabase = createServerClient(supabaseUrl, anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet) => {
        cookiesToSet.forEach(({ name, value, options }) => authResponse.cookies.set(name, value, options));
      },
    },
  });
  const withAuthCookies = (response: NextResponse) => {
    authResponse.cookies.getAll().forEach((cookie) => response.cookies.set(cookie));
    return response;
  };

  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) {
    return withAuthCookies(NextResponse.json({ error: 'Sign in as an administrator to create official accounts.' }, { status: 401 }));
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role, is_active')
    .eq('id', user.id)
    .maybeSingle();

  if (profileError) {
    console.error('Could not verify account creation permission:', profileError.message);
    return withAuthCookies(NextResponse.json({ error: 'Could not verify administrator access.' }, { status: 500 }));
  }
  if (profile?.role !== 'system_admin' || profile.is_active === false) {
    return withAuthCookies(NextResponse.json({ error: 'Only administrators can create official accounts.' }, { status: 403 }));
  }

  let body: {
    email?: unknown;
    firstName?: unknown;
    middleName?: unknown;
    lastName?: unknown;
    phoneNumber?: unknown;
    age?: unknown;
    sex?: unknown;
    address?: unknown;
    role?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return withAuthCookies(NextResponse.json({ error: 'Request body must be valid JSON.' }, { status: 400 }));
  }

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const firstName = typeof body.firstName === 'string' ? body.firstName.trim() : '';
  const middleName = typeof body.middleName === 'string' ? body.middleName.trim() : '';
  const lastName = typeof body.lastName === 'string' ? body.lastName.trim() : '';
  const phoneNumber = typeof body.phoneNumber === 'string' ? body.phoneNumber.trim() : '';
  const age = body.age;
  const sex = typeof body.sex === 'string' ? body.sex : '';
  const address = typeof body.address === 'string' ? body.address.trim() : '';
  const role = typeof body.role === 'string' ? body.role : '';
  const fullName = [firstName, middleName, lastName].filter(Boolean).join(' ');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return withAuthCookies(NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 }));
  }
  if (!firstName || firstName.length > 80 || !lastName || lastName.length > 80 || middleName.length > 80 || fullName.length > 240) {
    return withAuthCookies(NextResponse.json({ error: 'Enter a first and last name of up to 80 characters each. Middle name is optional.' }, { status: 400 }));
  }
  const phoneDigits = phoneNumber.replace(/\D/g, '');
  if (!/^\+?[\d\s().-]{7,24}$/.test(phoneNumber) || phoneDigits.length < 7 || phoneDigits.length > 15) {
    return withAuthCookies(NextResponse.json({ error: 'Enter a valid contact number with 7 to 15 digits.' }, { status: 400 }));
  }
  if (typeof age !== 'number' || !Number.isInteger(age) || age < 1 || age > 120) {
    return withAuthCookies(NextResponse.json({ error: 'Enter an age from 1 to 120.' }, { status: 400 }));
  }
  if (!['female', 'male', 'other', 'prefer_not_to_say'].includes(sex)) {
    return withAuthCookies(NextResponse.json({ error: 'Choose a valid sex option.' }, { status: 400 }));
  }
  if (!address || address.length > 500) {
    return withAuthCookies(NextResponse.json({ error: 'Enter an address of 1 to 500 characters.' }, { status: 400 }));
  }
  if (!OFFICIAL_ROLES.has(role)) {
    return withAuthCookies(NextResponse.json({ error: 'Choose an allowed official role.' }, { status: 400 }));
  }

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!serviceRoleKey || /^(replace-with|your[-_ ]|changeme|<)/i.test(serviceRoleKey)) {
    console.error('Official account invitation is unavailable: SUPABASE_SERVICE_ROLE_KEY is missing or still has a placeholder value.');
    return withAuthCookies(NextResponse.json({
      error: 'Account creation is not configured. Set SUPABASE_SERVICE_ROLE_KEY to your Supabase server-side secret key, then restart the app.',
    }, { status: 500 }));
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: invitation, error: inviteError } = await adminClient.auth.admin.generateLink({
    type: 'invite',
    email,
    options: {
      redirectTo: `${new URL(request.url).origin}/auth/confirm`,
      data: { full_name: fullName, role },
    },
  });

  if (inviteError || !invitation.user || invitation.properties.verification_type !== 'invite') {
    console.error('Official account invitation failed:', inviteError?.message || 'Supabase returned an invalid invitation.');
    const invalidApiKey = /invalid api key/i.test(inviteError?.message || '');
    return withAuthCookies(NextResponse.json({
      error: invalidApiKey
        ? 'Supabase rejected the server API key. Check that SUPABASE_SERVICE_ROLE_KEY is the secret/service-role key for this same Supabase project, then restart the app.'
        : inviteError?.message || 'Could not create the account invitation.',
    }, { status: invalidApiKey ? 500 : 400 }));
  }

  const { error: saveProfileError } = await adminClient
    .from('profiles')
    .upsert(
      {
        id: invitation.user.id,
        email,
        full_name: fullName,
        first_name: firstName,
        middle_name: middleName || null,
        last_name: lastName,
        phone_number: phoneNumber,
        age,
        sex,
        address,
        role,
      },
      { onConflict: 'id' }
    );

  if (saveProfileError) {
    console.error('Invited account profile creation failed:', saveProfileError.message);
    const { error: cleanupError } = await adminClient.auth.admin.deleteUser(invitation.user.id);
    if (cleanupError) {
      console.error('Could not roll back invited account after profile creation failed:', cleanupError.message);
    }
    return withAuthCookies(NextResponse.json({ error: 'Could not complete the official account setup. Please try again.' }, { status: 500 }));
  }

  const invitationUrl = new URL('/auth/confirm', request.url);
  invitationUrl.searchParams.set('token_hash', invitation.properties.hashed_token);
  invitationUrl.searchParams.set('type', 'invite');

  return withAuthCookies(NextResponse.json({
    message: `Account created for ${email}. Copy the invitation link and send it to the official.`,
    invitationUrl: invitationUrl.toString(),
  }, { status: 201 }));
}

export async function DELETE(request: NextRequest) {
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) {
    return NextResponse.json({ error: 'Request origin is not allowed.' }, { status: 403 });
  }

  if (!request.headers.get('content-type')?.includes('application/json')) {
    return NextResponse.json({ error: 'Expected a JSON request body.' }, { status: 415 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!supabaseUrl || !anonKey || !serviceRoleKey || /^(replace-with|your[-_ ]|changeme|<)/i.test(serviceRoleKey)) {
    console.error('Profile deletion is unavailable: Supabase configuration is missing or invalid.');
    return NextResponse.json({ error: 'Profile deletion is not configured.' }, { status: 500 });
  }

  const authResponse = new NextResponse();
  const supabase = createServerClient(supabaseUrl, anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet) => {
        cookiesToSet.forEach(({ name, value, options }) => authResponse.cookies.set(name, value, options));
      },
    },
  });
  const withAuthCookies = (response: NextResponse) => {
    authResponse.cookies.getAll().forEach((cookie) => response.cookies.set(cookie));
    return response;
  };

  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) {
    return withAuthCookies(NextResponse.json({ error: 'Sign in as an administrator to delete profiles.' }, { status: 401 }));
  }

  const { data: requesterProfile, error: requesterProfileError } = await supabase
    .from('profiles')
    .select('role, is_active')
    .eq('id', user.id)
    .maybeSingle();

  if (requesterProfileError) {
    console.error('Could not verify profile deletion permission:', requesterProfileError.message);
    return withAuthCookies(NextResponse.json({ error: 'Could not verify administrator access.' }, { status: 500 }));
  }
  if (requesterProfile?.role !== 'system_admin' || requesterProfile.is_active === false) {
    return withAuthCookies(NextResponse.json({ error: 'Only administrators can delete profiles.' }, { status: 403 }));
  }

  let body: { userId?: unknown };
  try {
    body = await request.json();
  } catch {
    return withAuthCookies(NextResponse.json({ error: 'Request body must be valid JSON.' }, { status: 400 }));
  }

  const targetUserId = typeof body.userId === 'string' ? body.userId.trim() : '';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(targetUserId)) {
    return withAuthCookies(NextResponse.json({ error: 'A valid account ID is required.' }, { status: 400 }));
  }
  if (targetUserId === user.id) {
    return withAuthCookies(NextResponse.json({ error: 'You cannot delete your own profile.' }, { status: 400 }));
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: targetProfile, error: targetProfileError } = await adminClient
    .from('profiles')
    .select('id, role')
    .eq('id', targetUserId)
    .maybeSingle();

  if (targetProfileError) {
    console.error('Could not look up profile for deletion:', targetProfileError.message);
    return withAuthCookies(NextResponse.json({ error: 'Could not load the profile to delete.' }, { status: 500 }));
  }
  if (!targetProfile) {
    return withAuthCookies(NextResponse.json({ error: 'The profile no longer exists.' }, { status: 404 }));
  }

  if (targetProfile.role === 'system_admin') {
    const { data: anotherAdmin, error: anotherAdminError } = await adminClient
      .from('profiles')
      .select('id')
      .eq('role', 'system_admin')
      .neq('id', targetUserId)
      .limit(1)
      .maybeSingle();

    if (anotherAdminError) {
      console.error('Could not check for another administrator before profile deletion:', anotherAdminError.message);
      return withAuthCookies(NextResponse.json({ error: 'Could not verify administrator availability.' }, { status: 500 }));
    }
    if (!anotherAdmin) {
      return withAuthCookies(NextResponse.json({ error: 'The last administrator profile cannot be deleted.' }, { status: 409 }));
    }
  }

  const { error: deleteError } = await adminClient
    .from('profiles')
    .delete()
    .eq('id', targetUserId);

  if (deleteError) {
    console.error('Profile deletion failed:', deleteError.message);
    return withAuthCookies(NextResponse.json({
      error: 'Could not delete this profile because other records may still depend on it.',
    }, { status: 409 }));
  }

  return withAuthCookies(NextResponse.json({ message: 'Profile deleted.' }));
}

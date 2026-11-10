import { createServerClient } from '@supabase/ssr';
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

interface RouteContext {
  params: Promise<{ id: string }>;
}

function preserveCookies(source: NextResponse, response: NextResponse) {
  for (const cookie of source.cookies.getAll()) response.cookies.set(cookie);
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}

export async function GET(request: NextRequest, context: RouteContext) {
  const cookieResponse = new NextResponse(null);
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) {
    return preserveCookies(cookieResponse, NextResponse.json({ error: 'Supabase is not configured.' }, { status: 500 }));
  }

  const supabase = createServerClient(supabaseUrl, anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet) => {
        cookiesToSet.forEach(({ name, value, options }) => {
          cookieResponse.cookies.set(name, value, options);
        });
      },
    },
  });

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    return preserveCookies(cookieResponse, NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));
  }

  const { id: submissionId } = await context.params;
  const { data: submission, error: submissionError } = await supabase
    .from('submissions')
    .select('id, current_version_id')
    .eq('id', submissionId)
    .single();
  if (submissionError || !submission) {
    return preserveCookies(cookieResponse, NextResponse.json({ error: 'File not found.' }, { status: 404 }));
  }

  const { data: versionLinks, error: linksError } = await supabase
    .from('submission_version_attachments')
    .select('attachment_id')
    .eq('submission_id', submission.id)
    .eq('submission_version_id', submission.current_version_id)
    .order('created_at', { ascending: true })
    .limit(1);
  if (linksError) {
    console.error('Current submission attachment could not be loaded:', linksError.message);
    return preserveCookies(cookieResponse, NextResponse.json({ error: 'File is unavailable.' }, { status: 404 }));
  }
  const attachmentId = versionLinks?.[0]?.attachment_id;
  if (!attachmentId) {
    return preserveCookies(cookieResponse, NextResponse.json({ error: 'File is unavailable.' }, { status: 404 }));
  }

  const { data: attachment, error: attachmentError } = await supabase
    .from('attachments')
    .select('id, original_filename, content_type')
    .eq('id', attachmentId)
    .single();
  if (attachmentError || !attachment) {
    return preserveCookies(cookieResponse, NextResponse.json({ error: 'File is unavailable.' }, { status: 404 }));
  }

  const { data: objectKey, error: keyError } = await supabase.rpc(
    'get_authorized_attachment_object_key',
    { p_attachment_id: attachment.id }
  );
  if (keyError || typeof objectKey !== 'string' || objectKey.length === 0) {
    return preserveCookies(cookieResponse, NextResponse.json({ error: 'File is unavailable.' }, { status: 403 }));
  }

  const { data: signedFile, error: signedUrlError } = await supabase.storage
    .from('connect-daet-submissions')
    .createSignedUrl(objectKey, 300);
  if (signedUrlError || !signedFile?.signedUrl) {
    console.error('Private document download could not be authorized:', signedUrlError?.message);
    return preserveCookies(cookieResponse, NextResponse.json({ error: 'File is unavailable.' }, { status: 403 }));
  }

  const fileResponse = await fetch(signedFile.signedUrl, { cache: 'no-store' });
  if (!fileResponse.ok || !fileResponse.body) {
    return preserveCookies(cookieResponse, NextResponse.json({ error: 'File could not be retrieved.' }, { status: 502 }));
  }

  const contentType = attachment.content_type
    || fileResponse.headers.get('content-type')
    || 'application/octet-stream';
  const headers = new Headers({
    'Content-Type': contentType,
    'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(attachment.original_filename)}`,
  });
  const response = new NextResponse(fileResponse.body, { status: 200, headers });
  return preserveCookies(cookieResponse, response);
}

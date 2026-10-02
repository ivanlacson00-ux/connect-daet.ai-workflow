import { createServerClient } from '@supabase/ssr';
import { NextRequest, NextResponse } from 'next/server';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, context: RouteContext) {
  const response = NextResponse.next();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
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
    }
  );

  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await context.params;
  const { data: submission, error: submissionError } = await supabase
    .from('workflow_submissions')
    .select('file_path, file_url, file_name')
    .eq('id', id)
    .single();

  if (submissionError || !submission) {
    return NextResponse.json({ error: 'File not found' }, { status: 404 });
  }

  const filePath = submission.file_path || extractLegacyFilePath(submission.file_url);
  if (!filePath) {
    return NextResponse.json({ error: 'File path is not available' }, { status: 404 });
  }

  const { data: signedFile, error: signedUrlError } = await supabase.storage
    .from('workflow_uploads')
    .createSignedUrl(filePath, 300);

  if (signedUrlError || !signedFile?.signedUrl) {
    return NextResponse.json({ error: signedUrlError?.message || 'Unable to authorize file' }, { status: 403 });
  }

  if (new URL(request.url).searchParams.get('redirect') === '1') {
    const fileResponse = await fetch(signedFile.signedUrl);
    if (!fileResponse.ok) {
      return NextResponse.json({ error: 'Unable to retrieve file' }, { status: 502 });
    }

    const headers = new Headers();
    const contentType = fileResponse.headers.get('content-type');
    const isCsv = submission.file_name.toLowerCase().endsWith('.csv');
    headers.set('Content-Type', isCsv ? 'text/plain; charset=utf-8' : contentType || 'application/octet-stream');
    headers.set('Content-Disposition', 'inline');
    headers.set('Cache-Control', 'private, no-store');

    return new NextResponse(fileResponse.body, {
      status: 200,
      headers,
    });
  }

  return NextResponse.json({ signedUrl: signedFile.signedUrl });
}

function extractLegacyFilePath(fileUrl: string | null) {
  if (!fileUrl) return null;
  const marker = '/storage/v1/object/public/workflow_uploads/';
  const markerIndex = fileUrl.indexOf(marker);
  return markerIndex === -1 ? null : decodeURIComponent(fileUrl.slice(markerIndex + marker.length));
}

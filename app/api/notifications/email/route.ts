import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import { createClient } from '@supabase/supabase-js';

const batchSize = 20;

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authorization = request.headers.get('authorization');

  if (!cronSecret || authorization !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const resendApiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.RESEND_FROM_EMAIL;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!resendApiKey || !fromEmail || !supabaseUrl || !serviceRoleKey) {
    return NextResponse.json(
      { error: 'Email delivery environment is not configured' },
      { status: 500 }
    );
  }

  const resend = new Resend(resendApiKey);
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: jobs, error: fetchError } = await supabase
    .from('workflow_email_outbox')
    .select('id, recipient_email, subject, body, attempts')
    .is('sent_at', null)
    .order('created_at', { ascending: true })
    .limit(batchSize);

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 500 });
  }

  let sent = 0;
  let failed = 0;

  for (const job of jobs || []) {
    const { error: sendError } = await resend.emails.send({
      from: fromEmail,
      to: job.recipient_email,
      subject: job.subject,
      text: job.body,
    });

    if (sendError) {
      failed += 1;
      await supabase
        .from('workflow_email_outbox')
        .update({
          attempts: job.attempts + 1,
          last_error: sendError.message,
        })
        .eq('id', job.id);
      continue;
    }

    sent += 1;
    await supabase
      .from('workflow_email_outbox')
      .update({
        sent_at: new Date().toISOString(),
        attempts: job.attempts + 1,
        last_error: null,
      })
      .eq('id', job.id);
  }

  return NextResponse.json({
    processed: jobs?.length || 0,
    sent,
    failed,
  });
}

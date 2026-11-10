This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.


## Setup Instructions for Collaborators

### 1. Clone the repository
```bash
git clone https://github.com/yourusername/your-repo.git
cd your-repo

# Copy the example env file
cp .env.example .env
```

## Five-stage document workflow

1. A submitter uploads a primary document, optional supporting files, the
   document type, request summary, and optional recipient.
   The system creates a tracking number and records the submission.
2. The approver proposes an ordered set of municipal offices based on the request.
   The Mayor's Office is optional and, when needed, is the final route step.
3. An administrator reviews, edits, and finalizes the route, or rejects and
   archives the request.
4. Finalized municipal offices review the request one at a time. The workflow
   advances only after each office approves its step. Any active office may
   return the request to the sender for additional information; after the sender
   responds, it resumes at the same office.
5. If the route includes the Mayor's Office, the Mayor makes the final office
   decision. Otherwise, that step is skipped. After all required offices approve,
   the request returns to the Administrator for completion; the sender is notified.
   A rejection is archived, and the sender must submit a new request.

The three office roles are Municipal Treasurer's Office, Mayor's Office, and
Sangguniang Bayan Office. Assign accounts from the Admin workspace's User
management page. Workflow decisions are recorded in the document history, and
sender milestone notifications are delivered in-app and by email.

Apply the migrations in `supabase/migrations/` in filename order to enable the
office roles, workflow transitions, attachment access, archive behavior, and
notifications. Apply `20261105230000_add_versioned_workflow_routing.sql` and
`20261106000000_enable_dynamic_workflow_routes.sql` after the existing workflow
migrations to enable versioned, sequential office routing and its decision flow.
Apply `20261106010000_notify_first_office_on_route_finalization.sql` afterward
so the first office is notified when an administrator finalizes a route.
Apply `20261106020000_notify_admin_of_proposed_route.sql` afterward so route
proposals are recorded with their ordered offices and administrators are notified.
Apply `20261106100000_restore_approver_submission_notifications.sql` afterward
to notify approvers when a new submission enters the queue.
Apply `20261106110000_allow_offices_to_request_requirements.sql` afterward to
allow every routed municipal office to request additional information.
Apply `20261106120000_restrict_workflow_upload_file_types.sql` afterward to
restrict uploads to PDF, DOC/DOCX, XLS/XLSX, CSV, PPT/PPTX, JPG/JPEG, and PNG.
ZIP files are accepted as supporting attachments only.
Apply `20261106130000_enforce_workflow_upload_file_types.sql` after that to
enforce matching file extensions and MIME types in the database, disallow ZIP
as a primary document, and reject unsupported extensions at the Storage policy.
The `20261110050000_add_active_profile_state.sql` migration enables admin
account removal by disabling sign-in and hiding the profile while retaining
workflow history.
After the preceding workflow migrations, apply
`20261108080000_add_document_messaging.sql` to enable private, real-time document
conversations, authorized message attachments, read receipts, and message
notifications. Message email notifications use the existing email outbox and
scheduled email processor.
Apply `20261108170000_harden_workflow_email_delivery.sql` afterward to enable
leased email-job claiming, bounded retries, attempt history, provider delivery
events, and administrator retry access. Apply
`20261110032000_switch_workflow_email_to_sendgrid.sql` afterward to match
SendGrid's event format and correlate events to queued jobs. Workflow emails
are processed by the Supabase Edge Function in
`supabase/functions/process-email-outbox/`; it sends through Twilio SendGrid
and preserves the leased queue, retry behavior, and delivery tracking. Deploy it to the test project with
`supabase functions deploy process-email-outbox --no-verify-jwt`; the function
validates the `x-cron-secret` header itself. Configure the Edge Function secrets
`SENDGRID_API_KEY`, `SENDGRID_FROM_EMAIL`, `APP_BASE_URL`, and `CRON_SECRET`.
The sender address must be verified in SendGrid. Configure a signed Event
Webhook in SendGrid for
`https://<your-app-domain>/api/webhooks/sendgrid`, enable delivered, bounce,
spam-report, and dropped events, and store its displayed verification key as
the app's server-only `SENDGRID_WEBHOOK_PUBLIC_KEY` environment variable.
Supabase provides `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to Edge
Functions. Enable Supabase Vault, then create the scheduler secrets using the
SQL Editor (replace the placeholders with the function URL and the exact same
random secret configured as `CRON_SECRET`):

```sql
select vault.create_secret(
  'https://<project-ref>.supabase.co/functions/v1/process-email-outbox',
  'workflow_email_function_url'
);
select vault.create_secret(
  '<same-value-as-CRON_SECRET>',
  'workflow_email_cron_secret'
);
```

Apply `20261108180000_add_workflow_email_templates.sql` before the scheduling
migration to add branded HTML/text notification emails, document references,
recipient greetings, and role-appropriate links. Existing workflow
notifications, including message notifications, are queued automatically;
email message notices link to the conversation without including private
message contents. Set `APP_BASE_URL` to the canonical application origin for
secure document links in notification emails. After deploying the function,
applying the email migrations (including
`20261110032000_switch_workflow_email_to_sendgrid.sql`) and creating both Vault secrets, apply
`20261110033000_schedule_workflow_email_edge_function.sql` to run the processor
every minute. If that migration reports missing Vault secrets, it has not
scheduled the processor; create the named secrets first, then rerun the
migration. Provider API acceptance is recorded as `accepted`; only a verified
webhook records delivery. Password-reset emails continue through Supabase Auth
and are unaffected by this workflow-email change.
Set `NEXT_PUBLIC_APP_URL` to the canonical application origin used to build
retrieval QR links. For local testing from a phone, use a LAN-reachable address
such as `http://<computer-lan-ip>:3000` and open the application through that
address on the phone; `localhost` always refers to the device opening the link.

For account verification, enable email confirmations in Supabase
Authentication settings, set the project Site URL to the production app origin,
and allow the callback URLs `http://localhost:3000/auth/callback`,
`http://<computer-lan-ip>:3000/auth/callback` when testing from another device,
and `https://<your-app-domain>/auth/callback` (plus any additional deployed
environments). Set `NEXT_PUBLIC_APP_URL` to the same origin used by the browser;
Supabase must allow its `/auth/callback` redirect. Registration and
resend-confirmation links use this callback.
Supabase Auth remains the source of truth for verification; the application
blocks unconfirmed accounts from workflow pages and the protected file API.
Password recovery uses the same `/auth/callback` allowlist and then returns to
`/reset-password`; configure Supabase's recovery email template to use its
standard secure recovery link. Recovery requests are issued through the
server-side `/api/auth/password/request` handler and callback exchange before
the password-change endpoint accepts an update.

Workflow completion emails are sent through the email outbox and scheduled
SendGrid processor. Email delivery runs automatically and is separate from the
admin workspace UI.

## Local checks

Run `npm test` (Node.js 22.6 or newer) for the unit tests covering password
validation and safe notification-email rendering. Run `npm run build` for the
production build and TypeScript check. Integration checks that contact Supabase
or SendGrid should use a dedicated test project and recipient.
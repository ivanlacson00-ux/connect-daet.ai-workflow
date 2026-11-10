import { redirect } from 'next/navigation';

export default function LegacyAdminSubmissionPage() {
  redirect('/workflow/admin');
}

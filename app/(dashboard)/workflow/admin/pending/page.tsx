import { redirect } from 'next/navigation';

export default function LegacyAdminPendingPage() {
  redirect('/workflow/admin');
}

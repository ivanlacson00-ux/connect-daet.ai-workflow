import { redirect } from 'next/navigation';

export default function LegacyAdminSubmissionsPage() {
  redirect('/workflow/admin');
}

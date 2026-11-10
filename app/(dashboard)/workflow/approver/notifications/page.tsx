import { redirect } from 'next/navigation';

export default function ApproverNotificationsRedirect() {
  redirect('/workflow/approver');
}

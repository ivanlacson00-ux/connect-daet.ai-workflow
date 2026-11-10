import { redirect } from "next/navigation";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ code?: string | string[] }>;
}) {
  const { code } = await searchParams;
  if (typeof code === 'string' && code.length > 0) {
    const callbackParams = new URLSearchParams({
      code,
      next: '/reset-password',
    });
    redirect(`/auth/callback?${callbackParams.toString()}`);
  }

  redirect('/login');
}

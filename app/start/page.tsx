// Where everyone lands after signing in: the role decides the home page, so nobody has to pick a login.
//   buyer       -> /buyer
//   staff       -> /merchant
//   owner/admin -> /merchant (they may also open /buyer)
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { landingFor } from '@/lib/auth/routes';
import { sessionUser } from '@/lib/auth/guard';

export const dynamic = 'force-dynamic';

export default async function Start({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const user = await sessionUser(await headers());
  if (!user) redirect('/login');
  const { next } = await searchParams;
  redirect(landingFor(user.role, next));
}

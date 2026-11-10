// OWNER: C. Buyer pages share a simple top bar. Store staff have their own home and are sent there; owners and admins
// may open both.
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { sessionUser } from '@/lib/auth/guard';
import { canOpen, homeFor } from '@/lib/auth/routes';
import { BuyerShell } from '../_ui/Shell';

export default async function BuyerLayout({ children }: { children: ReactNode }) {
  const user = await sessionUser(await headers());
  if (!user) redirect('/login');
  if (!canOpen(user.role, 'buyer')) redirect(homeFor(user.role));
  return <BuyerShell>{children}</BuyerShell>;
}

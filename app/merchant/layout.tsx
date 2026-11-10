// OWNER: C. Every merchant page shares the sidebar frame. Only the store team may open it: anyone else is sent to
// their own home without a word, so a buyer is never told a store area exists.
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { sessionUser } from '@/lib/auth/guard';
import { canOpen, homeFor } from '@/lib/auth/routes';
import { MerchantShell } from '../_ui/Shell';

export default async function MerchantLayout({ children }: { children: ReactNode }) {
  const user = await sessionUser(await headers());
  if (!user) redirect('/login');
  if (!canOpen(user.role, 'merchant')) redirect(homeFor(user.role));
  return <MerchantShell>{children}</MerchantShell>;
}

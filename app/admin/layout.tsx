// Admin pages use the store dashboard frame. Only admins open them; everyone else goes to their own home.
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { sessionUser } from '@/lib/auth/guard';
import { canOpen, homeFor } from '@/lib/auth/routes';
import { MerchantShell } from '../_ui/Shell';

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const user = await sessionUser(await headers());
  if (!user) redirect('/login');
  if (!canOpen(user.role, 'admin')) redirect(homeFor(user.role));
  return <MerchantShell>{children}</MerchantShell>;
}

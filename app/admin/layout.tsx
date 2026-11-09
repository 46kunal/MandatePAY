// Admin pages use the store dashboard frame. The proxy sends signed-out visitors to /merchant/login, and every admin
// API route checks the admin permissions on the server.
import type { ReactNode } from 'react';
import { MerchantShell } from '../_ui/Shell';

export default function AdminLayout({ children }: { children: ReactNode }) {
  return <MerchantShell>{children}</MerchantShell>;
}

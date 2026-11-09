// OWNER: C. Every merchant page shares the sidebar frame.
import type { ReactNode } from 'react';
import { MerchantShell } from '../_ui/Shell';

export default function MerchantLayout({ children }: { children: ReactNode }) {
  return <MerchantShell>{children}</MerchantShell>;
}

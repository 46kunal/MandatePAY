// OWNER: C. Buyer pages share a simple top bar.
import type { ReactNode } from 'react';
import { BuyerShell } from '../_ui/Shell';

export default function BuyerLayout({ children }: { children: ReactNode }) {
  return <BuyerShell>{children}</BuyerShell>;
}

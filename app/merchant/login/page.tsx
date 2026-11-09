// Store team sign-in (staff, owner, admin). There is no public sign-up for the store team.
import { Suspense } from 'react';
import { AuthForm } from '../../_ui/AuthForm';

export const metadata = { title: 'Store team sign-in · MandatePay' };

export default function MerchantLoginPage() {
  return (
    <Suspense>
      <AuthForm side="merchant" />
    </Suspense>
  );
}

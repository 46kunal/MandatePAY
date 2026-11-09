// Buyer sign-in and sign-up.
import { Suspense } from 'react';
import { AuthForm } from '../_ui/AuthForm';

export const metadata = { title: 'Sign in · MandatePay' };

export default function LoginPage() {
  return (
    <Suspense>
      <AuthForm side="buyer" />
    </Suspense>
  );
}

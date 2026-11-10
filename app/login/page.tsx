// One sign-in and sign-up for everyone. Where you land afterwards (/start) depends on your role.
import { Suspense } from 'react';
import { AuthForm } from '../_ui/AuthForm';

export const metadata = { title: 'Sign in · MandatePay' };

export default function LoginPage() {
  return (
    <Suspense>
      <AuthForm />
    </Suspense>
  );
}

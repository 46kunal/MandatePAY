/** Browser-side auth client (owner: orchestrator): sign in, sign up, sign out and the current session. */
import { createAuthClient } from 'better-auth/react';
import { inferAdditionalFields } from 'better-auth/client/plugins';

export const authClient = createAuthClient({
  plugins: [inferAdditionalFields({ user: { role: { type: 'string', required: false, input: false } } })],
});

export const { useSession, signIn, signUp, signOut } = authClient;

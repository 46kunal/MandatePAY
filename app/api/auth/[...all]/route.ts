import { toNextJsHandler } from 'better-auth/next-js';
import { auth } from '@/lib/auth/server';

export const runtime = 'nodejs';

// Better Auth endpoints: /api/auth/sign-up/email, /sign-in/email, /sign-out, /get-session, ...
export const { GET, POST } = toNextJsHandler(auth);

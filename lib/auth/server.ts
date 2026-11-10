/**
 * Better Auth server instance (owner: orchestrator). Email and password sign-in, plus "Log in with PayPal" (sandbox)
 * when the PayPal app credentials are set. Sessions and sign-in rate limits are stored in Postgres so they hold
 * across serverless instances.
 *
 * PayPal accounts are linked explicitly: a signed-in person clicks Connect PayPal (linkSocial). A PayPal sign-in is
 * never merged into an existing email account by matching addresses, because those emails are not verified here.
 *
 * Roles: every new sign-up is a buyer. The role field cannot be set from sign-up input (input: false); merchant
 * staff, owners and admins are created with `npm run auth:create-user`.
 *
 * Server-only: it imports the database client.
 */
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { nextCookies } from 'better-auth/next-js';
import { db, schema } from '../../db/client';
import { clearPayPalIdentity, paypalAuthorizeUrl, paypalProfileToUser, savePayPalIdentity } from './paypalIdentity';

const paypalClientId = process.env.PAYPAL_CLIENT_ID?.trim();
const paypalClientSecret = process.env.PAYPAL_CLIENT_SECRET?.trim();

/** Origins allowed to call the auth endpoints: the app's own URL plus the current Vercel deployment URLs. */
function trustedOrigins(): string[] {
  const out = new Set<string>();
  for (const v of [process.env.BETTER_AUTH_URL, process.env.APP_BASE_URL]) if (v?.trim()) out.add(v.trim().replace(/\/+$/, ''));
  for (const host of [process.env.VERCEL_URL, process.env.VERCEL_BRANCH_URL, process.env.VERCEL_PROJECT_PRODUCTION_URL]) {
    if (host?.trim()) out.add(`https://${host.trim()}`);
  }
  if (!out.size) out.add('http://localhost:3000');
  return [...out];
}

export const auth = betterAuth({
  appName: 'MandatePay',
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL?.trim() || process.env.APP_BASE_URL?.trim() || undefined,
  trustedOrigins: trustedOrigins(),
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: {
      user: schema.users,
      session: schema.sessions,
      account: schema.accounts,
      verification: schema.verifications,
      rateLimit: schema.rateLimits,
    },
  }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 10,
    maxPasswordLength: 128,
    autoSignIn: true,
  },
  socialProviders:
    paypalClientId && paypalClientSecret
      ? {
          paypal: {
            clientId: paypalClientId,
            clientSecret: paypalClientSecret,
            environment: 'sandbox',
            // Better Auth's PayPal provider sends no scope; ask for email, name and the PayPal account attributes
            // (payer id, verified) through the authorization address instead.
            authorizationEndpoint: paypalAuthorizeUrl(),
            // PayPal sends the address in an `emails` list; the provider only reads `email`.
            mapProfileToUser: (profile) => paypalProfileToUser(profile),
          },
        }
      : {},
  account: {
    accountLinking: {
      enabled: true,
      disableImplicitLinking: true,
      allowDifferentEmails: true, // only reachable while signed in (Connect PayPal)
    },
  },
  user: {
    additionalFields: {
      role: { type: 'string', required: false, defaultValue: 'buyer', input: false },
      disabledAt: { type: 'date', required: false, input: false },
      paypalPayerId: { type: 'string', required: false, input: false },
      paypalVerified: { type: 'boolean', required: false, input: false },
    },
  },
  databaseHooks: {
    account: {
      create: { after: async (account) => savePayPalIdentity(account) },
      update: { after: async (account) => savePayPalIdentity(account) },
      delete: { after: async (account) => clearPayPalIdentity(account) },
    },
    session: {
      create: {
        // A disabled account cannot sign in.
        async before(session) {
          const { eq } = await import('drizzle-orm');
          const [u] = await db
            .select({ disabledAt: schema.users.disabledAt })
            .from(schema.users)
            .where(eq(schema.users.id, session.userId))
            .limit(1);
          if (u?.disabledAt) return false;
        },
      },
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // refreshed at most once a day
  },
  rateLimit: {
    enabled: true,
    storage: 'database',
    window: 60,
    max: 100,
    customRules: {
      '/sign-in/email': { window: 60, max: 5 },
      '/sign-up/email': { window: 60, max: 3 },
    },
  },
  advanced: {
    database: { generateId: () => crypto.randomUUID() },
  },
  // Must be last: lets server actions set the session cookie.
  plugins: [nextCookies()],
});

export type AuthSession = typeof auth.$Infer.Session;

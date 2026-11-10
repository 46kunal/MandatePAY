export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET: is the service up and can it reach its database? 200 {ok:true} or 503 {ok:false}. No secrets, no details,
// so it is safe for an uptime monitor to call.
export async function GET() {
  try {
    const [{ db }, { sql }] = await Promise.all([import('@/db/client'), import('drizzle-orm')]);
    await Promise.race([db.execute(sql`select 1`), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 4000))]);
    return Response.json({ ok: true, service: 'mandatepay', database: 'up' });
  } catch {
    return Response.json({ ok: false, service: 'mandatepay', database: 'down' }, { status: 503 });
  }
}

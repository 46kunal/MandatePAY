/** Per-buyer signing keys. Run: npx tsx --test lib/mandate/buyerKeys.test.ts (no database: keys live in memory). */
import assert from 'node:assert/strict';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { importPKCS8, importSPKI } from 'jose';
import type { Cart, OpenMandatePayload } from '../../contracts/schemas';
import {
  buyerKid,
  decryptPrivateKey,
  encryptPrivateKey,
  isBuyerKid,
  parseMasterKey,
  type BuyerKeyResolver,
  type BuyerSigningKey,
} from './buyerKeys';
import { createClosedMandate, verifyClosedMandate } from './closed';
import { signOpenMandate, verifyOpenMandate } from './jws';
import { ALG } from './keys';

const keyDir = mkdtempSync(path.join(tmpdir(), 'mandatepay-buyerkeys-'));
after(() => rmSync(keyDir, { recursive: true, force: true }));

/** A buyer key in memory, plus a resolver that knows it, as the database would. */
async function makeBuyer(userId: string) {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const kid = buyerKid(publicPem);
  const signing: BuyerSigningKey = { kid, privateKey: await importPKCS8(privatePem, ALG) };
  return { userId, kid, privatePem, publicPem, signing, publicKey: await importSPKI(publicPem, ALG) };
}

function resolverFor(...buyers: Awaited<ReturnType<typeof makeBuyer>>[]): BuyerKeyResolver {
  return async (kid) => {
    const b = buyers.find((x) => x.kid === kid);
    return b && { kid, userId: b.userId, publicKey: b.publicKey };
  };
}

const NOW = Math.floor(Date.parse('2026-11-10T12:00:00Z') / 1000);
const mandate = (buyerRef: string): OpenMandatePayload => ({
  typ: 'checkout_mandate.open',
  mandate_id: 'mnd_test',
  buyer_ref: buyerRef,
  constraints: { max_total: { value: '20.00', currency: 'USD' }, request_text: 'socks under 20' },
  iat: NOW,
  exp: NOW + 3600,
});

describe('encryption at rest', () => {
  const master = randomBytes(32);

  it('round-trips the private key', () => {
    const pem = '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n';
    const blob = encryptPrivateKey(pem, master, 'user-1');
    assert.match(blob, /^v1\./);
    assert.ok(!blob.includes('BEGIN'));
    assert.equal(decryptPrivateKey(blob, master, 'user-1'), pem);
  });

  it('fails with the wrong master key or for a different user (row copied to someone else)', () => {
    const blob = encryptPrivateKey('secret pem', master, 'user-1');
    assert.throws(() => decryptPrivateKey(blob, randomBytes(32), 'user-1'));
    assert.throws(() => decryptPrivateKey(blob, master, 'user-2'));
  });

  it('accepts a 32-byte master key in base64 or base64url, nothing else', () => {
    const k = randomBytes(32);
    assert.equal(parseMasterKey(k.toString('base64')).length, 32);
    assert.equal(parseMasterKey(k.toString('base64url')).length, 32);
    assert.throws(() => parseMasterKey(randomBytes(16).toString('base64')), /32 random bytes/);
  });
});

describe('buyer key ids', () => {
  it('are derived from the public key and marked as buyer keys', async () => {
    const b = await makeBuyer('user-1');
    assert.equal(buyerKid(b.publicPem), b.kid);
    assert.ok(isBuyerKid(b.kid));
    assert.equal(isBuyerKid('buyer-1a2b3c'), false); // the shared key's kid
    assert.equal(isBuyerKid(undefined), false);
  });
});

describe('open mandates signed with the buyer’s own key', () => {
  it('verify, and say which buyer key signed', async () => {
    const alice = await makeBuyer('user-alice');
    const jws = await signOpenMandate(mandate('user-alice'), { buyerKey: alice.signing });
    const v = await verifyOpenMandate(jws, { now: NOW, resolveBuyerKey: resolverFor(alice) });
    assert.ok(v.ok);
    assert.deepEqual(v.ok && v.signer, { kind: 'buyer_key', kid: alice.kid, userId: 'user-alice' });
  });

  it('are refused when the key belongs to a different buyer than the mandate names', async () => {
    const alice = await makeBuyer('user-alice');
    const jws = await signOpenMandate(mandate('user-bob'), { buyerKey: alice.signing });
    const v = await verifyOpenMandate(jws, { now: NOW, resolveBuyerKey: resolverFor(alice) });
    assert.ok(!v.ok && v.reason === 'bad_signature' && /different buyer/.test(v.message));
  });

  it('are refused for an unknown key, or a key that does not match the signature', async () => {
    const alice = await makeBuyer('user-alice');
    const mallory = await makeBuyer('user-alice');
    const jws = await signOpenMandate(mandate('user-alice'), { buyerKey: alice.signing });
    const unknown = await verifyOpenMandate(jws, { now: NOW, resolveBuyerKey: resolverFor() });
    assert.ok(!unknown.ok && /unknown buyer key/.test(unknown.message));
    // Someone registers another key under the same kid: the signature does not verify with it.
    const swapped: BuyerKeyResolver = async (kid) => ({ kid, userId: 'user-alice', publicKey: mallory.publicKey });
    const bad = await verifyOpenMandate(jws, { now: NOW, resolveBuyerKey: swapped });
    assert.ok(!bad.ok && bad.reason === 'bad_signature');
  });

  it('are refused when the payload is changed after signing', async () => {
    const alice = await makeBuyer('user-alice');
    const jws = await signOpenMandate(mandate('user-alice'), { buyerKey: alice.signing });
    const [h, , s] = jws.split('.');
    const forged = Buffer.from(JSON.stringify({ ...mandate('user-alice'), constraints: { max_total: { value: '9999.00', currency: 'USD' } } })).toString('base64url');
    const v = await verifyOpenMandate(`${h}.${forged}.${s}`, { now: NOW, resolveBuyerKey: resolverFor(alice) });
    assert.ok(!v.ok && v.reason === 'bad_signature');
  });

  it('mandates signed with the shared key before per-buyer keys still verify, marked as such', async () => {
    const jws = await signOpenMandate(mandate('legacy-buyer'), { keyDir });
    const v = await verifyOpenMandate(jws, { now: NOW, keyDir });
    assert.ok(v.ok && v.signer.kind === 'shared_key');
  });
});

describe('closed mandates the buyer approves', () => {
  const cart: Cart = { currency: 'USD', items: [{ sku: 'S', name: 'Socks', quantity: 1, unit_price: '14.00' }] };

  it('are signed with the buyer’s key and must match the open mandate’s buyer', async () => {
    const alice = await makeBuyer('user-alice');
    const bob = await makeBuyer('user-bob');
    const open = await signOpenMandate(mandate('user-alice'), { buyerKey: alice.signing });
    const input = { mandateId: 'mnd_test', openMandateJws: open, cart, approvedBy: 'buyer' as const, now: NOW };

    const byAlice = await createClosedMandate(input, { buyerKey: alice.signing });
    const ok = await verifyClosedMandate(byAlice.jws, 'buyer', { openMandateJws: open, cart }, { resolveBuyerKey: resolverFor(alice, bob) });
    assert.ok(ok.ok);

    const byBob = await createClosedMandate(input, { buyerKey: bob.signing });
    const refused = await verifyClosedMandate(byBob.jws, 'buyer', { openMandateJws: open, cart }, { resolveBuyerKey: resolverFor(alice, bob) });
    assert.ok(!refused.ok && refused.reason === 'bad_signature');
  });
});

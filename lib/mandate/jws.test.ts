/**
 * B1 unit checks. Run: npx tsx --test lib/mandate/jws.test.ts
 * Uses a temp key directory, so it never touches your real .keys/.
 */
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import type { OpenMandatePayload } from '../../contracts/schemas';
import { getKeyPair, resetKeyCache } from './keys';
import { signJws, signOpenMandate, verifyJws, verifyOpenMandate } from './jws';

const NOW = 1_800_000_000; // fixed "current time" in unix seconds

function samplePayload(overrides: Partial<OpenMandatePayload> = {}): OpenMandatePayload {
  return {
    typ: 'checkout_mandate.open',
    mandate_id: 'mnd_test_1',
    buyer_ref: 'buyer_1',
    constraints: {
      max_total: { value: '110.00', currency: 'GBP' },
      categories: ['shoes'],
      required_attributes: { color: 'white', size: '10' },
      request_text: 'white trainers size 10 under 110 pounds',
    },
    iat: NOW,
    exp: NOW + 3600,
    ...overrides,
  };
}

const b64u = (value: string) => Buffer.from(value, 'utf8').toString('base64url');
const fromB64u = (value: string) => Buffer.from(value, 'base64url').toString('utf8');

describe('mandate signing (B1)', () => {
  let keyDir: string;
  before(async () => {
    keyDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mandatepay-keys-'));
  });
  after(async () => {
    await fs.rm(keyDir, { recursive: true, force: true });
  });

  it('signs and verifies an open mandate round trip', async () => {
    const jws = await signOpenMandate(samplePayload(), { keyDir });
    assert.equal(jws.split('.').length, 3, 'compact JWS has three parts');

    const result = await verifyOpenMandate(jws, { keyDir, now: NOW });
    assert.equal(result.ok, true);
    if (result.ok) assert.deepEqual(result.payload, samplePayload());
  });

  it('rejects a tampered payload (raised spending limit, original signature)', async () => {
    const jws = await signOpenMandate(samplePayload(), { keyDir });
    const [header, payload, signature] = jws.split('.');
    const forged = JSON.parse(fromB64u(payload));
    forged.constraints.max_total.value = '9999.00';
    const tampered = [header, b64u(JSON.stringify(forged)), signature].join('.');

    const result = await verifyOpenMandate(tampered, { keyDir, now: NOW });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, 'bad_signature');
  });

  it('rejects a tampered signature', async () => {
    const jws = await signOpenMandate(samplePayload(), { keyDir });
    const [header, payload, signature] = jws.split('.');
    const flipped = signature[10] === 'A' ? 'B' : 'A';
    const badSignature = signature.slice(0, 10) + flipped + signature.slice(11);

    const result = await verifyOpenMandate([header, payload, badSignature].join('.'), { keyDir, now: NOW });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, 'bad_signature');
  });

  it('rejects alg "none" tokens', async () => {
    const jws = await signOpenMandate(samplePayload(), { keyDir });
    const payload = jws.split('.')[1];
    const unsigned = `${b64u(JSON.stringify({ alg: 'none' }))}.${payload}.`;

    const result = await verifyOpenMandate(unsigned, { keyDir, now: NOW });
    assert.equal(result.ok, false);
  });

  it('rejects a token signed by the other role', async () => {
    const jws = await signJws(samplePayload(), 'agent', { keyDir });
    const result = await verifyJws(jws, 'buyer', { keyDir });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, 'bad_signature');
  });

  it('rejects malformed input without throwing', async () => {
    const result = await verifyOpenMandate('not-a-jws', { keyDir, now: NOW });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, 'malformed');
  });

  it('rejects a validly signed payload that does not match the contract', async () => {
    const jws = await signJws({ typ: 'something_else' }, 'buyer', { keyDir });
    const result = await verifyOpenMandate(jws, { keyDir, now: NOW });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, 'invalid_payload');
  });

  it('refuses to sign a payload that breaks the contract', async () => {
    const bad = samplePayload({ constraints: { max_total: { value: '110', currency: 'GBP' } } });
    await assert.rejects(() => signOpenMandate(bad, { keyDir }));
  });

  it('reports an expired mandate separately from a bad signature', async () => {
    const jws = await signOpenMandate(samplePayload({ exp: NOW - 10 }), { keyDir });
    const result = await verifyOpenMandate(jws, { keyDir, now: NOW });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, 'expired');
      if (result.reason === 'expired') assert.equal(result.payload.mandate_id, 'mnd_test_1');
    }
  });

  it('persists keys: same key id after the cache is cleared, tokens still verify', async () => {
    const jws = await signOpenMandate(samplePayload(), { keyDir });
    const before = await getKeyPair('buyer', keyDir);
    resetKeyCache();
    const reloaded = await getKeyPair('buyer', keyDir);

    assert.equal(reloaded.kid, before.kid);
    const result = await verifyOpenMandate(jws, { keyDir, now: NOW });
    assert.equal(result.ok, true);
  });

  it('gives each role its own key, and each directory its own keys', async () => {
    const buyer = await getKeyPair('buyer', keyDir);
    const agent = await getKeyPair('agent', keyDir);
    assert.notEqual(buyer.kid, agent.kid);

    const otherDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mandatepay-keys-'));
    try {
      const other = await getKeyPair('buyer', otherDir);
      assert.notEqual(other.kid, buyer.kid);
    } finally {
      await fs.rm(otherDir, { recursive: true, force: true });
    }
  });

  it('stores the private key as PEM readable only by the owner (POSIX)', async () => {
    await getKeyPair('buyer', keyDir);
    const file = path.join(keyDir, 'buyer.private.pem');
    const pem = await fs.readFile(file, 'utf8');
    assert.match(pem, /^-----BEGIN PRIVATE KEY-----/);
    if (process.platform !== 'win32') {
      const mode = (await fs.stat(file)).mode & 0o777;
      assert.equal(mode, 0o600);
    }
  });
});

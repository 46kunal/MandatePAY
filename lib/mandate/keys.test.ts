/** Key source checks. Run: npx tsx --test lib/mandate/keys.test.ts */
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { describe, it } from 'node:test';
import { envPrivateKey, keyEnvName } from './keys';

const pem = generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

describe('envPrivateKey', () => {
  it('names one variable per role', () => {
    assert.equal(keyEnvName('buyer'), 'MANDATE_BUYER_PRIVATE_KEY');
    assert.equal(keyEnvName('agent'), 'MANDATE_AGENT_PRIVATE_KEY');
  });

  it('accepts base64 of the PEM, a raw PEM, and a one-line PEM with \n escapes', () => {
    const b64 = Buffer.from(pem).toString('base64');
    assert.equal(envPrivateKey('agent', { MANDATE_AGENT_PRIVATE_KEY: b64 }), pem);
    assert.equal(envPrivateKey('agent', { MANDATE_AGENT_PRIVATE_KEY: pem }), pem.trim());
    const oneLine = pem.trim().replace(/\n/g, '\n');
    assert.equal(envPrivateKey('agent', { MANDATE_AGENT_PRIVATE_KEY: oneLine }), pem.trim());
  });

  it('falls back to files locally, but refuses to run on Vercel without the key', () => {
    assert.equal(envPrivateKey('buyer', {}), undefined);
    assert.throws(() => envPrivateKey('buyer', { VERCEL: '1' }), /MANDATE_BUYER_PRIVATE_KEY is not set/);
  });

  it('rejects something that is not a private key', () => {
    assert.throws(() => envPrivateKey('buyer', { MANDATE_BUYER_PRIVATE_KEY: 'bm90IGEga2V5' }), /not a PKCS#8/);
  });
});

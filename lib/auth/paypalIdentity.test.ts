/** PayPal identity checks. Run: npx tsx --test lib/auth/paypalIdentity.test.ts */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { payerFromOrder } from '../paypal/orders';
import { parsePayPalIdentity, payerCheck, paypalAuthorizeUrl, paypalProfileToUser, PAYPAL_SCOPES } from './paypalIdentity';

describe('parsePayPalIdentity', () => {
  it('reads the payer id and verified flag from PayPal userinfo', () => {
    assert.deepEqual(parsePayPalIdentity({ user_id: 'https://www.paypal.com/x', payer_id: ' QYR5Z8XDVJNXQ ', verified_account: true }), {
      payerId: 'QYR5Z8XDVJNXQ',
      verified: true,
    });
  });

  it('accepts "true"/"false" strings and treats anything missing as unknown', () => {
    assert.equal(parsePayPalIdentity({ payer_id: 'A', verified_account: 'false' }).verified, false);
    assert.deepEqual(parsePayPalIdentity({}), { payerId: null, verified: null });
    assert.deepEqual(parsePayPalIdentity(null), { payerId: null, verified: null });
    assert.equal(parsePayPalIdentity({ payer_id: '' }).payerId, null);
  });
});

describe('paypalAuthorizeUrl', () => {
  it('is the sandbox sign-in page and asks for email and the PayPal account attributes', () => {
    const url = new URL(paypalAuthorizeUrl());
    assert.equal(url.origin, 'https://www.sandbox.paypal.com');
    assert.equal(url.pathname, '/signin/authorize');
    assert.deepEqual(url.searchParams.get('scope')?.split(' '), PAYPAL_SCOPES);
    assert.ok(PAYPAL_SCOPES.includes('email') && PAYPAL_SCOPES.includes('https://uri.paypal.com/services/paypalattributes'));
  });
});

describe('payerCheck', () => {
  it('compares the paying PayPal payer with the buyer’s linked one', () => {
    assert.equal(payerCheck('P1', 'P1'), 'match');
    assert.equal(payerCheck('P1', 'P2'), 'different');
    assert.equal(payerCheck('P1', null), 'not_linked');
    assert.equal(payerCheck(null, 'P1'), 'unknown');
    assert.equal(payerCheck(undefined, undefined), 'unknown');
  });
});

describe('payerFromOrder', () => {
  it('reads payer id and payment source from a PayPal order', () => {
    assert.deepEqual(
      payerFromOrder({ payer: { payer_id: 'QYR5Z8XDVJNXQ' }, payment_source: { paypal: { account_status: 'VERIFIED' } } }),
      { payerId: 'QYR5Z8XDVJNXQ', paymentSource: 'paypal' },
    );
    assert.deepEqual(payerFromOrder({ payer: { payer_id: 'G1' }, payment_source: { card: {} } }), { payerId: 'G1', paymentSource: 'card' });
    assert.deepEqual(payerFromOrder({ id: 'X' }), { payerId: null, paymentSource: null });
  });
});

describe('paypalProfileToUser', () => {
  it('takes the email from the PayPal emails list (schema paypalv1.1), primary first', () => {
    const u = paypalProfileToUser({
      user_id: 'https://www.paypal.com/webapps/auth/identity/user/abc',
      name: 'Kunal Buyer',
      payer_id: 'QYR5Z8XDVJNXQ',
      verified_account: 'true',
      emails: [
        { value: 'old@example.com', primary: false, confirmed: true },
        { value: 'SB-Buyer@Personal.Example.com', primary: true, confirmed: true },
      ],
    });
    assert.deepEqual(u, { email: 'sb-buyer@personal.example.com', emailVerified: true, name: 'Kunal Buyer' });
  });

  it('still works when PayPal sends a single email field', () => {
    assert.deepEqual(paypalProfileToUser({ email: 'a@b.test', email_verified: true, given_name: 'A', family_name: 'B' }), {
      email: 'a@b.test',
      emailVerified: true,
      name: 'A B',
    });
  });

  it('an unconfirmed address is not marked verified', () => {
    const u = paypalProfileToUser({ emails: [{ value: 'x@y.test', primary: true, confirmed: false }], verified_account: false });
    assert.equal(u.email, 'x@y.test');
    assert.equal(u.emailVerified, false);
  });

  it('no email at all: returns nothing for email, so sign-in reports it', () => {
    assert.equal(paypalProfileToUser({ user_id: 'x', emails: [] }).email, undefined);
    assert.equal(paypalProfileToUser(null).email, undefined);
  });
});

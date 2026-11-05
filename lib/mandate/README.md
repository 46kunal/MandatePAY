# lib/mandate (owner: B)

Signed mandates: Ed25519 keys and compact JWS via [`jose`](https://github.com/panva/jose).

**Interoperability:** the mandate token is *AP2-shaped* (open checkout mandate, later closed) but it is **not
interoperable with the AP2 specification**. Claims, keys and verification are specific to MandatePay.

## Keys

- Two roles: `buyer` signs the open mandate when the buyer confirms; `agent` signs a closed mandate when no approval was needed.
- Stored in `KEY_DIR` (default `.keys/`, gitignored) as `<role>.private.pem`, created on first use, mode 0600.
  The public key is derived from the private key, so there is only one file per role.
- Sandbox/demo only. A real deployment keeps the buyer key on the buyer's device or in a KMS.
- Never commit `.keys/` or `*.pem`.

## API

```ts
import { signOpenMandate, verifyOpenMandate } from '@/lib/mandate';

const jws = await signOpenMandate(payload);          // validates against OpenMandatePayload, signs as "buyer"
const result = await verifyOpenMandate(jws);         // never throws on bad input
if (!result.ok) result.reason;                       // 'malformed' | 'bad_signature' | 'invalid_payload' | 'expired'
```

`verifyOpenMandate` checks signature first (algorithm pinned to EdDSA, so `alg: none` is rejected), then the
payload shape, then `exp`. Routes map `expired` to HTTP 410 and the other reasons to a rejection.

## Tests

```bash
npx tsx --test lib/mandate/jws.test.ts
```

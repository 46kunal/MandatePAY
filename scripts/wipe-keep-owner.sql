-- Fresh start for the demo. Run in the Neon SQL Editor (live database).
-- 1. Replace OWNER_EMAIL_HERE below with your owner login email (keep the quotes).
-- KEEPS: your owner account (sign-in, PayPal link, signing key) and the store settings.
-- DELETES (cannot be undone): every other account and its sessions, orders, carts, mandates, disputes, problem reports,
-- agent keys, signing keys, products, webhook/poll events and the audit log.
-- One transaction: if the owner email is not found, or anything fails, nothing is deleted. Read the counts at the end.

BEGIN;

DO $$
DECLARE owner_id text;
BEGIN
  SELECT id INTO owner_id FROM users WHERE lower(email) = lower('OWNER_EMAIL_HERE');
  IF owner_id IS NULL THEN
    RAISE EXCEPTION 'Owner email not found: nothing was deleted. Edit OWNER_EMAIL_HERE.';
  END IF;

  DELETE FROM problem_reports;
  DELETE FROM orders;
  DELETE FROM carts;
  DELETE FROM mandates;
  DELETE FROM cases;
  DELETE FROM events;
  DELETE FROM audit_log;
  DELETE FROM api_keys;
  DELETE FROM products;
  DELETE FROM rate_limits;
  DELETE FROM buyer_keys WHERE user_id <> owner_id;
  DELETE FROM sessions WHERE user_id <> owner_id;
  DELETE FROM accounts WHERE user_id <> owner_id;
  DELETE FROM verifications;
  DELETE FROM users WHERE id <> owner_id;
END $$;

SELECT
  (SELECT count(*) FROM users)    AS users_left_should_be_1,
  (SELECT count(*) FROM products) AS products,
  (SELECT count(*) FROM orders)   AS orders,
  (SELECT count(*) FROM cases)    AS cases,
  (SELECT count(*) FROM settings) AS settings_kept;

COMMIT;

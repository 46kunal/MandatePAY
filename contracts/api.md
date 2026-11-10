# API contract

Source of truth for request/response shapes is `contracts/schemas.ts` (Zod). This table says who builds each route.
Errors always use `ApiError` (`{ error, message?, details? }`). Amounts are strings with two decimals.

## Sign-in and access

Every route except `/api/health`, `/api/webhooks/paypal` (PayPal signature instead) and `/api/auth/*` needs a signed-in
session cookie. Signed out: **401 `unauthenticated`**. Signed in without the permission: **403 `forbidden`**
(`details.permission` names it). Roles and permissions live in `lib/auth/roles.ts`; routes call `requirePermission()`.

| Route | Permission (roles) |
|---|---|
| `/api/auth/*` | public: Better Auth sign-up (always a buyer), sign-in (email, or PayPal at `/sign-in/social` with `provider: "paypal"`), sign-out, get-session. Signed in: `/link-social` and `/unlink-account` connect or disconnect PayPal; PayPal is never linked to an existing account by matching email |
| POST `/api/mandates/draft`, POST `/api/mandates` | `shop` (everyone). The mandate is signed with the signed-in user's own key (kid `buyer-u-…` in the JWS header, created on first use); `buyer_ref` is their user id, and verification requires the key's owner to be that buyer. Mandates signed before per-buyer keys carry the shared key's kid and still verify |
| POST `/api/agent/shop`, POST `/api/carts/check`, POST `/api/orders` | `shop`, and the mandate must be the user's own (else 404) |
| POST `/api/orders/:id/capture` | `shop`, and the order must be the user's own (else 404) |
| GET `/api/orders` | signed in. Staff, owner, admin see all orders; a buyer sees only their own |
| GET `/api/products` | `products:read` (everyone) |
| POST `/api/products`, PATCH `/api/products/:id` | `products:write` (staff, owner, admin) |
| GET `/api/cases`, `/api/cases/:id`, `/api/cases/:id/evidence-pack` | `cases:read` (staff, owner, admin) |
| POST `/api/cases/:id/analyse` | `cases:analyse` (staff, owner, admin) |
| POST `/api/cases/:id/act` | `cases:act` (staff, owner, admin); with `human_approved` or `override` also `cases:approve` (owner, admin). The acting user is stored as `acted_by` |
| POST `/api/disputes/poll` | `disputes:poll` (staff, owner, admin) |
| GET `/api/settings`, GET `/api/status` | `settings:read` / `status:read` (staff, owner, admin) |
| PATCH `/api/settings` | `settings:write` (owner, admin) |
| GET `/api/team` | `settings:read` (staff, owner, admin) |
| POST `/api/team` | `team:manage` (owner, admin). Only an admin gives or takes `admin`; nobody changes their own role; the last owner cannot be removed |
| GET `/api/audit` | `audit:read` (owner, admin) |
| POST `/api/orders/:id/refund` | `orders:refund` (owner, admin) |
| GET `/api/export/orders`, `/api/export/disputes` | `orders:read:all` / `cases:read` (staff, owner, admin) |
| GET `/api/admin/users`, PATCH `/api/admin/users/:id` | `users:manage` (admin). Disabling ends the person's sessions |
| GET `/api/admin/health` | `system:read` (admin) |
| GET `/api/me/mandates`, POST `/api/me/mandates/:id/revoke`, GET `/api/me/export` | `shop`, own data only |

## Routes

| Route | Owner | Request | Response | Errors |
|---|---|---|---|---|
| GET `/api/health` | Orchestrator | none | `{ ok, service }` | none |
| POST `/api/mandates/draft` | B | `DraftMandateRequest` | `DraftMandateResponse` | 400 invalid, 502 LLM failed |
| POST `/api/mandates` | B | `CreateMandateRequest` (`buyer_ref` optional and ignored) | `CreateMandateResponse` | 400 invalid constraints |
| POST `/api/carts/check` | B | `CartCheckRequest` | `CartCheckResponse` (`GuardResult`) | 404 mandate, 410 expired |
| GET `/api/orders` | A | none | `ListOrdersResponse` (newest first, with any dispute id) | none. Each order carries `refunded` and `refund_pending` when money was refunded (snapshot from PayPal) |
| POST `/api/orders` | A | `PlaceOrderRequest` | `PlaceOrderResponse` (`created` or `needs_approval`) | 422 `guard_blocked`, 502 PayPal |
| POST `/api/orders/:id/capture` | A | none | `CaptureOrderResponse` | 404 order, 409 already captured, 502 PayPal |
| POST `/api/orders/:id/refund` | A | `RefundOrderRequest` (`amount` omitted = all still refundable; `idempotency_key` makes a repeated click one refund) | `RefundOrderResponse` | 404 order, 409 `not_captured` / `fully_refunded`, 422 `refund_exceeds_remaining`, 502 PayPal. Refunds made in the PayPal dashboard count (re-read first); a linked dispute is re-read afterwards. A refund does not close a dispute |
| POST `/api/webhooks/paypal` | A | PayPal event | `200` fast | 400 bad signature |
| GET `/api/settings` | A | none | `StoreSettings` (defaults from env until saved; `auto_analyse` defaults to true) | none |
| PATCH `/api/settings` | A | `UpdateStoreSettingsRequest` (any subset) | `StoreSettings` | 400 invalid body |
| GET `/api/team` | A | none | `ListTeamResponse` | none |
| POST `/api/team` | A | `SetTeamRoleRequest` | `AccountSummary` | 404 no account with that email, 409 `role_change_refused` |
| GET `/api/admin/users?q=` | A | none | `ListUsersResponse` (newest 200) | none |
| PATCH `/api/admin/users/:id` | A | `UpdateUserRequest` | `AccountSummary` | 404, 409 `role_change_refused` / `cannot_disable_self` |
| GET `/api/admin/health` | A | none | `SystemHealth` (never shows secret values; does not call the AI) | none |
| GET `/api/audit?limit=` | A | none | `ListAuditResponse` (newest first, max 1000) | none |
| GET `/api/export/orders`, `/api/export/disputes` | A | none | `text/csv` download (formulas defused) | none |
| GET `/api/me/mandates` | A | none | `ListMyMandatesResponse` | none |
| POST `/api/me/mandates/:id/revoke` | A | none | `MyMandate`. After this, cart checks, the agent and new orders on it answer 410 `mandate_revoked` | 404 not yours |
| GET `/api/me/export` | A | none | JSON download of the person's account, mandates, carts and orders | none |
| POST `/api/disputes/poll` | A | none, or `PollDisputesRequest` `{ dispute_id }` to fetch one dispute by id (PayPal's list lags for new disputes) | `PollDisputesResponse` | 400 invalid id, 404 unknown dispute, 502 PayPal. After answering, cases that are linked, not analysed yet and actionable are analysed automatically (max 3 per call) when the `auto_analyse` setting is on; the webhook does the same after a processed event |
| GET `/api/cases` | A | none | `CaseRecord[]` | none |
| GET `/api/cases/:id` | A | none | `CaseRecord` plus mandate, cart, order. `order.payment_source` is `paypal` or `card`; `order.payer_check` is `match`, `different`, `not_linked` or `unknown` (did the buyer's linked PayPal account pay) | 404. `order.refunds` lists PayPal's refunds on the payment and `order.refunded` sums them (`covers_dispute`: none, partial, full), re-read from PayPal when older than 2 minutes |
| POST `/api/cases/:id/analyse` | B | none | `Verdict` (saved on case). Input adds `payment` facts from the records: `payer_check` (did the buyer's linked PayPal account pay), `source`, `mandate_signed_with`. A `different` payer always needs a human | 404, 422 not linked, 502 LLM failed |
| GET `/api/cases/:id/evidence-pack` | A | none | `application/pdf` | 404 |
| POST `/api/cases/:id/act` | A | `ActOnCaseRequest` | updated `CaseRecord` | 400 invalid body, 403 needs human approval, 404 case, 409 already acted, 422 action or offer not allowed / no verdict, 502 PayPal. PROVIDE_EVIDENCE also uploads the evidence pack PDF (multipart, `file1`).. SEND_MESSAGE on a buyer-regret verdict sends the evidence from the records (not the AI's free text), attaching the evidence PDF when PayPal accepts it and otherwise sending the same text alone. NO_ACTION is only a recorded review: nothing is sent and the case stays open (`analysis_status` is never `acted` for it). After a real action the dispute is re-read from PayPal, so `status` in the response is PayPal's current one. MAKE_OFFER or ACCEPT_CLAIM on a payment that was already refunded (also outside MandatePay) answers 409 `already_refunded` with the refund in `details`, unless the request sends `confirm_refunded: true` |
| GET `/api/products` | A | `?active=1` optional | `Product[]` | none |
| POST `/api/products` | A | `ProductInput` | `Product` (201) | 400 invalid, 409 duplicate SKU |
| PATCH `/api/products/:id` | A | `UpdateProductRequest` | `Product` | 400, 404, 409 duplicate SKU |
| POST `/api/agent/shop` | A | `AgentShopRequest` | `AgentShopResponse` | 404 mandate, 410 expired, 422 empty catalog / nothing fits, 500 LLM not configured, 502 LLM failed |
| GET `/api/status` | A | none | connection status (no secrets) | none |

## Rules

- Change a shape only through a PR that edits `contracts/schemas.ts` and this file; the orchestrator reviews it.
- Routes that are not built yet return HTTP 501 via `notImplemented(owner, hint)`. The UI shows the error; there is no sample data.
- PayPal order: `custom_id` = mandate id, `invoice_id` = cart id.
- Sandbox only. `getConfig()` refuses to start against a live PayPal host.

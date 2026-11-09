# API contract

Source of truth for request/response shapes is `contracts/schemas.ts` (Zod). This table says who builds each route.
Errors always use `ApiError` (`{ error, message?, details? }`). Amounts are strings with two decimals.

## Sign-in and access

Every route except `/api/health`, `/api/webhooks/paypal` (PayPal signature instead) and `/api/auth/*` needs a signed-in
session cookie. Signed out: **401 `unauthenticated`**. Signed in without the permission: **403 `forbidden`**
(`details.permission` names it). Roles and permissions live in `lib/auth/roles.ts`; routes call `requirePermission()`.

| Route | Permission (roles) |
|---|---|
| `/api/auth/*` | public: Better Auth sign-up (always a buyer), sign-in, sign-out, get-session |
| POST `/api/mandates/draft`, POST `/api/mandates` | `shop` (everyone). The mandate is signed for the signed-in user; `buyer_ref` is their user id |
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

## Routes

| Route | Owner | Request | Response | Errors |
|---|---|---|---|---|
| GET `/api/health` | Orchestrator | none | `{ ok, service }` | none |
| POST `/api/mandates/draft` | B | `DraftMandateRequest` | `DraftMandateResponse` | 400 invalid, 502 LLM failed |
| POST `/api/mandates` | B | `CreateMandateRequest` (`buyer_ref` optional and ignored) | `CreateMandateResponse` | 400 invalid constraints |
| POST `/api/carts/check` | B | `CartCheckRequest` | `CartCheckResponse` (`GuardResult`) | 404 mandate, 410 expired |
| GET `/api/orders` | A | none | `ListOrdersResponse` (newest first, with any dispute id) | none |
| POST `/api/orders` | A | `PlaceOrderRequest` | `PlaceOrderResponse` (`created` or `needs_approval`) | 422 `guard_blocked`, 502 PayPal |
| POST `/api/orders/:id/capture` | A | none | `CaptureOrderResponse` | 404 order, 409 already captured, 502 PayPal |
| POST `/api/webhooks/paypal` | A | PayPal event | `200` fast | 400 bad signature |
| GET `/api/settings` | A | none | `StoreSettings` (defaults from env until saved) | none |
| PATCH `/api/settings` | A | `UpdateStoreSettingsRequest` (any subset) | `StoreSettings` | 400 invalid body |
| POST `/api/disputes/poll` | A | none, or `PollDisputesRequest` `{ dispute_id }` to fetch one dispute by id (PayPal's list lags for new disputes) | `PollDisputesResponse` | 400 invalid id, 404 unknown dispute, 502 PayPal |
| GET `/api/cases` | A | none | `CaseRecord[]` | none |
| GET `/api/cases/:id` | A | none | `CaseRecord` plus mandate, cart, order | 404 |
| POST `/api/cases/:id/analyse` | B | none | `Verdict` (saved on case) | 404, 502 LLM failed |
| GET `/api/cases/:id/evidence-pack` | A | none | `application/pdf` | 404 |
| POST `/api/cases/:id/act` | A | `ActOnCaseRequest` | updated `CaseRecord` | 400 invalid body, 403 needs human approval, 404 case, 409 already acted, 422 action or offer not allowed / no verdict, 502 PayPal. PROVIDE_EVIDENCE also uploads the evidence pack PDF (multipart, `file1`). |
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

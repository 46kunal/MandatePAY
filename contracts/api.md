# API contract

Source of truth for request/response shapes is `contracts/schemas.ts` (Zod). This table says who builds each route.
Errors always use `ApiError` (`{ error, message?, details? }`). Amounts are strings with two decimals.

| Route | Owner | Request | Response | Errors |
|---|---|---|---|---|
| GET `/api/health` | Orchestrator | none | `{ ok, service }` | none |
| POST `/api/mandates/draft` | B | `DraftMandateRequest` | `DraftMandateResponse` | 400 invalid, 502 LLM failed |
| POST `/api/mandates` | B | `CreateMandateRequest` | `CreateMandateResponse` | 400 invalid constraints |
| POST `/api/carts/check` | B | `CartCheckRequest` | `CartCheckResponse` (`GuardResult`) | 404 mandate, 410 expired |
| POST `/api/orders` | A | `PlaceOrderRequest` | `PlaceOrderResponse` (`created` or `needs_approval`) | 422 `guard_blocked`, 502 PayPal |
| POST `/api/orders/:id/capture` | A | none | `CaptureOrderResponse` | 404 order, 409 already captured, 502 PayPal |
| POST `/api/webhooks/paypal` | A | PayPal event | `200` fast | 400 bad signature |
| POST `/api/disputes/poll` | A | none | `PollDisputesResponse` | 502 PayPal |
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

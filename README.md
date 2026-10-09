# Aquageno production and inventory

Aquageno is a seafood plant system for purchases, production, warehouses, transfers, shipments, approvals, and stock. Money is INR. Quantities keep 3 decimal places.

## Prerequisites

- Docker with Compose v2
- Node.js 20 if you want to run the API or the UI outside Docker

The Compose file publishes Postgres on host port **5433** and the web app on **8090**, so it can sit next to another Postgres on 5432 or another site on 8080.

## Run the full app

From the repository root:

```bash
docker compose up --build
```

Then open [http://localhost:8090](http://localhost:8090).

The API is also on [http://localhost:4000](http://localhost:4000). The web container proxies `/api` to it, so the browser stays on one origin and the refresh cookie works.

The API container applies migrations and runs the seed on startup. The seed does not overwrite passwords, role permissions, or master records after the first boot. To start over:

```bash
docker compose down -v
docker compose up --build
```

## Local development

```bash
docker compose up -d postgres
cp .env.example backend/.env
npm install --prefix backend
npm install --prefix frontend
npm run db:migrate --prefix backend
npm run db:seed --prefix backend
npm run dev --prefix backend
npm run dev --prefix frontend
```

The UI dev server is [http://localhost:5173](http://localhost:5173) and proxies `/api` to port 4000.

## Environment

Copy `.env.example`. Docker Compose sets the same variables itself.

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Postgres connection string |
| `JWT_ACCESS_SECRET` | Signs 15-minute access tokens |
| `JWT_REFRESH_SECRET` | HMAC key for stored refresh-token hashes |
| `ACCESS_TTL` | Access token lifetime, default `15m` |
| `REFRESH_TTL_DAYS` | Refresh token lifetime, default `7` |
| `BCRYPT_ROUNDS` | bcrypt cost, default `12` |
| `PORT` | API port, default `4000` |
| `CORS_ORIGIN` | Comma-separated browser origins |
| `COOKIE_SECURE` | `true` only behind HTTPS |
| `APP_URL` | Public URL used in password-reset links |
| `BUSINESS_TZ` | Timezone for "today", default `Asia/Kolkata` |
| `LOG_LEVEL` | Pino level |

## Seeded accounts

| Role | Email | Password | First sign-in |
| --- | --- | --- | --- |
| Admin | admin@aquageno.local | `ChangeMe!2026` | Must set a new password |
| Manager | meera.nair@aquageno.local | `Harbour!2026` | Can approve documents |
| Storekeeper | rafi.khan@aquageno.local | `Harbour!2026` | Can draft documents, cannot approve |
| Viewer | leela.dsouza@aquageno.local | `Harbour!2026` | View only |

The seed also loads warehouses in Kochi, Veraval, and Mumbai, seafood and packing items, two BOMs, posted opening purchases, one posted production batch, a pending purchase, a pending shipment, a draft transfer, and a draft adjustment. Several packing items and black tiger prawns sit at or below their reorder levels.

## Tests

Postgres from Compose must be up.

```bash
npm test --prefix backend
```

That creates `aquageno_test` on port 5433, migrates it, and runs:

- auth: login, refresh rotation and reuse detection, forced password change, reset link through the stub mailer
- permissions: viewer blocked from creating a purchase, and a role edit takes effect on the next request
- stock: multi-line half-up totals, and a shipment that would go negative is rejected without changing the balance

## API

Base path: `/api/v1`

Every JSON response uses:

```json
{ "data": {}, "error": null, "meta": null }
```

Errors use `data: null` and `error: { code, message, details }`. List endpoints accept `page`, `pageSize` (max 100), and `search`, plus the filters named below. `meta` is `{ page, pageSize, total, totalPages }`.

Access tokens are sent as `Authorization: Bearer`. Refresh tokens are opaque secrets in the `ag_refresh` httpOnly cookie (path `/api/v1/auth`) and may also be posted as `{ "refreshToken" }` by a non-browser client. Permissions are loaded from the database on each request, so a role edit applies immediately.

| Area | Endpoints |
| --- | --- |
| Health | `GET /health` |
| Auth | `POST /auth/login`, `/logout`, `/refresh`, `/forgot-password`, `/reset-password`, `/change-password`, `GET /auth/me` |
| Reference | `GET /reference` |
| Dashboard | `GET /dashboard` |
| Users | `GET/POST /users`, `PATCH/DELETE /users/:id` |
| Roles | `GET/POST /roles`, `GET/PATCH/DELETE /roles/:id`, `PUT /roles/:id/permissions` |
| Master data | `/units`, `/categories`, `/warehouses`, `/suppliers`, `/customers`, `/items`, `/boms` with list, create, get, patch, delete |
| Documents | `/purchases`, `/production`, `/transfers`, `/shipments`, `/adjustments` with list, create, get, patch, delete, and `/:id/submit`, `/approve`, `/reject`, `/reopen`, `/reverse` |
| Stock | `GET /stock/balances`, `/stock/ledger`, `/stock/on-hand?warehouseId=` |
| Approvals | `GET /approvals`, `POST /approvals/:id/approve`, `POST /approvals/:id/reject` |
| Notifications | `GET /notifications`, `/notifications/unread-count`, `POST /notifications/:id/read`, `/notifications/read-all` |
| Audit | `GET /audit-logs` |
| Reports | `GET /reports/stock-summary`, `/stock-ledger`, `/purchases`, `/production`, `/shipments` |

Report and ledger routes accept `format=csv` and return a file instead of the JSON envelope. Useful filters: `from`, `to`, `warehouseId`, `itemId`, `supplierId`, `customerId`, `status`, `belowReorder=true`.

Document bodies are multi-line. A purchase example:

```json
{
  "supplierId": "...",
  "invoiceNo": "MMC-1001",
  "invoiceDate": "2026-09-27",
  "warehouseId": "...",
  "notes": "",
  "lines": [
    { "itemId": "...", "quantity": "10.500", "unitPrice": "415.00" }
  ]
}
```

Production lines are consumption quantities. Transfer and plain quantity lines use `{ itemId, quantity }`. Adjustment lines add `"direction": "IN"` or `"OUT"`. Shipment lines include a unit price so the sales report has a value.

## Assumptions

1. Amounts are pre-tax INR. GST is stored on suppliers and customers but not calculated.
2. Stock value uses each item's standard cost, not a moving average of purchase price.
3. Refresh tokens are random secrets, HMAC-SHA256 hashed at rest. Access tokens are JWTs. Reuse of a rotated refresh token revokes every refresh token for that user.
4. Business dates are calendar dates. "Today" on the dashboard uses `BUSINESS_TZ` (Asia/Kolkata).
5. A reorder level of `0` means the item is not watched. Otherwise low stock is total on-hand across warehouses, compared with the item reorder level.
6. A rejected document can be reopened into Draft by someone with Edit. Pending documents cannot be deleted. Posted documents are immutable.
7. Reversal creates a new draft that posts the opposite stock movement after approval. A reversal itself is not reversed; use an adjustment.
8. Self-approval is allowed. The audit log stores both people.
9. Approving a document requires that module's Approve permission and Approvals Approve.
10. The system Admin role cannot be deleted or renamed, and it always keeps Users and Roles permissions so the plant cannot be locked out.
11. In-app notifications are stored. The same events are passed to a `Mailer` interface. The default mailer logs the message and keeps it in memory. Password reset links are in that log until an SMTP mailer is plugged in.
12. Draft edits are last-write-wins. There is no optimistic lock.
13. An adjustment covers one warehouse.
14. Purchase lines may be any active item. Production consumption must be raw material or packing material, and cannot include the finished good being made.
15. A BOM quantity is per one unit of the finished good. "Load BOM" multiplies by the production quantity. Yield loss is a higher component quantity.
16. Line money is rounded half-up to paise, then summed. Quantities are stored to 3 decimal places.
17. The API never hard-deletes. Unreferenced master data is soft-deleted. Referenced master data is deactivated and kept for history.
18. Zod schemas are duplicated in the UI and the API. The API is authoritative.
19. Ledger balance in reports is recomputed in business-date order per item and warehouse, including the opening balance before the start date. The stored `balanceAfter` column is the on-hand figure immediately after posting.
20. Stock is checked inside the posting transaction with row locks. A document may be submitted while stock is short. Approval is what posts, and it fails if stock would go negative.
21. Each user has exactly one role.
22. The four seeded roles are created only when missing. Later permission edits are kept.

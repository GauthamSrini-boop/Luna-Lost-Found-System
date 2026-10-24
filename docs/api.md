# API guide

Full route list with access levels: `docs/api-routes.md` (generated from the route table).

## Conventions
- JSON in/out. Errors: `{"error":{"message":"…","fields":{"field":"msg"}}}` with status 400 (validation), 401 (not signed in), 403 (role), 404 (missing / not yours), 409 (state conflict), 429 (rate limit).
- Auth: HttpOnly cookie `luna_sid` set by login/register. Mutating requests require `X-Requested-With: LUNA`.
- Pagination: `GET /api/reports?page=1&page_size=12&type=all|lost|found&q=…&category_id=…&location_id=…&status=…&date_from=…&date_to=…&sort=…` → `{items,total,page,total_pages}`.
- Photo upload: `POST /api/{lost|found}/:id/photo`, multipart field `photo`; JPEG/PNG/WebP only (magic bytes checked), ≤ 2 MB.

## Typical flow
1. `POST /api/auth/register` → 201 + cookie
2. `POST /api/lost` (fields validated in `server/src/services/reports.js`; see `lostBody()` in `server/tests/helpers.js` for a working example)
3. Staff: `POST /api/found` …, then `PATCH /api/found/:id/status`
4. `GET /api/lost/:id/matches` (owner/staff) → scored matches with reasons
5. `POST /api/found/:id/claims` (body fields: see `createClaim` in `server/src/services/claims.js`)
6. Staff: `POST /api/claims/:id/action` `{action: start_review|request_info|approve|reject|respond|withdraw|handover, reason?, message?, recipient_name?, …}` (which actions are allowed depends on role and current status; the claim detail returns `allowed_actions`)

Check `docs/api-routes.md` and `server/src/services/*` for exact field names and validation rules; request/response schemas are not yet formally specified (no OpenAPI file).

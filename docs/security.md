# Security review

Reviewed by inspection and by automated tests where noted. This is not a penetration test.

| Control | Implementation | Verified by |
|---|---|---|
| Password storage | scrypt with per-user salt, constant-time compare | backend tests |
| Sessions | random token in HttpOnly SameSite=Lax cookie; DB stores HMAC-SHA256 of token; expiry; invalidated on password change/deactivation | backend tests |
| Brute force | per-account lockout (`login_attempts`); per-IP rate limits in Express | lockout: tests; **Express limiter: unverified** |
| Authorization | server-side `authorize()` per route; ownership checks in services; 404 for unrelated users | backend tests |
| CSRF | custom header required on mutations + SameSite | backend tests (dispatcher) |
| SQL injection | parameterised queries only; static audit of dynamic SQL: interpolations are whitelisted identifiers/constants | static audit + injection-string tests |
| XSS | React escapes output; CSP `default-src 'self'` via helmet | CSP **unverified** (helmet not run) |
| Uploads | magic-byte validation, random names, size cap, served with fixed content-type | backend tests |
| Data exposure | private details/explanations gated; no password hashes in responses | backend tests |
| Audit | admin and workflow actions recorded in `audit_logs` | backend tests |

## Not covered / residual risk
- No email verification or password reset; no MFA.
- In-memory rate limiter (single instance).
- Dependencies were not installed here, so `npm audit` was **not run**. Run it after `npm install`.
- Run behind HTTPS in production (cookies are `Secure` when `NODE_ENV=production`).

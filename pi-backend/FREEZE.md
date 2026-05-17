# FEATURE FREEZE IN EFFECT

**Start:** 2026-05-14  
**End:** 2026-05-28  
**Status:** ACTIVE

## Policy
Only the following commit types are permitted during the freeze window:
- `fix:` — bug fixes reducing measurable risk
- `security:` — security hardening (timing-safe comparisons, input validation, etc.)
- `hardening:` — reliability improvements (error handling, idempotency, savepoint coverage)
- `chore:` — dependency pinning, CI/CD, monitoring

## Exception Whitelist
The following were approved before/during freeze:
- `security: timing-safe admin key comparison + startup warnings` (2026-05-14, commit cc14003) — approved: timing oracle fix
- `fix: render.yaml test flags set to false` (2026-05-14, commit cc14003) — approved: production safety critical

## Rejected During Freeze
- New API routes not related to existing feature stability
- New Pi Network integration flows
- New NFT or payment flows
- Any schema migration not required for a security fix

## Freeze Owner
Any exception to this policy requires explicit approval and must be logged above.

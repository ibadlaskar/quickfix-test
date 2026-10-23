# QuickFix Barak — Deployment QA Report

## Automated checks run in this workspace

Run with `npm test` after dependencies are installed.

- Netlify publish directory, build command and function directory configuration.
- Compiled function entry point, customer routes and customer-cookie routing.
- Customer OTP integration fails closed when Twilio is not configured.
- Password hashing, secure cookie attributes and failed-login lockout markers.
- Customer booking uses the shared `bookings` table and `customer_web` source.
- Customer booking/history queries are scoped to the authenticated customer.
- Existing admin, technician, customer, booking, assignment, quote, payment, audit and category tables remain present in schema.
- Customer/admin/technician frontend assets and contact links.
- Environment secrets are documented server-side and not embedded in customer assets.

## Checks observed

- `node --check src/api.js`: passed.
- `node --check netlify/functions/api.js`: passed after synchronizing the customer Stage 4 routes and schema version.
- `node --check public/app.js`: passed.
- `node --check public/customer.js`: passed.
- `node --check public/tech.js`: passed.
- `node --test tests/*.test.js`: 10/10 static deployment checks passed.

## Not certified from this workspace

The package has not been tested against the live Supabase database or Twilio account. No production credentials are present, and the local npm install/build attempt timed out while contacting the npm registry. Netlify's configured build command (`npm install && npm run build`) must succeed in a Git-connected deploy before production release.

The supplied Stage 4 project does **not** contain the complete estimator/PDF and full-page, no-modal account experience described in the broader requirements. The customer frontend currently uses dialogs, and the schema has no approved itemized pricing configuration. Do not treat these requirements as passed or show an estimate total based on unapproved rates. They need to be implemented and tested before this can honestly be called the fully completed customer platform.

## Required staging acceptance tests

1. Apply schema migration on a non-production database and verify it completes without data loss.
2. Verify Twilio sends and validates a real OTP; test invalid, expired, resend and rate-limit behavior.
3. Register a new customer, log in, change password, reset password, and log out.
4. Submit a customer booking and confirm the same booking appears in the existing admin list with source `customer_web`.
5. Confirm manual admin booking, technician assignment, quotation acceptance/rejection, payments, refunds, settlements, and reports still work.
6. Verify customer A cannot read customer B's bookings, complaints, reviews or payments by changing request identifiers.
7. Test desktop and mobile layout, links, accessibility basics, and all error/empty states.
8. Complete estimator pricing administration, estimate calculations and genuine PDF generation before advertising those features.

## Production safeguards

- Test on a separate Netlify site and Supabase project first.
- Configure `DATABASE_URL`, a random `SESSION_SECRET` of at least 32 characters, and all three Twilio Verify variables in Netlify environment settings.
- Complete initial setup only when needed; remove `SETUP_TOKEN` after creating the owner account.
- Keep production database credentials and OTP secrets out of the repository.

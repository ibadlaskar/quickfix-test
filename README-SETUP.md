# QuickFix Barak Admin Panel: Stage 3

Stage 3 adds quotes, cash collection and commission, settlements, reports with CSV export, and an Analytics tab.

## Deployment (Stage 4 customer app + existing admin)

**Deploy from Git, not by dragging the folder into Netlify.** Connect the repository in Netlify and use the included `netlify.toml` build settings (`npm install && npm run build`). This rebuilds `netlify/functions/api.js` from `src/api.js` and embeds the current `src/schema.sql`.

For an existing Stage 3 installation, preserve the current environment variables and deploy to a separate staging site/database first. The first API request applies the idempotent schema upgrade. Review `DEPLOYMENT-QA.md` and complete the staging acceptance tests before production release. Do not run a first-time setup against a database containing existing production data without verifying its state.

## NEW INSTALL
Supabase pooler connection string, Netlify variables (DATABASE_URL, SESSION_SECRET, SETUP_TOKEN), open /setup.html, create tables, create the owner, then delete SETUP_TOKEN.

## How money works
1. **Quote.** On a booking, create a quote (labour, parts, travel, other). Mark it accepted or rejected by the customer before repair starts. Revising replaces the old one and needs fresh approval.
2. **Payment.** After work starts, the technician records what the customer paid in their portal (or you record it on the booking). Fields: labour, parts, discount, total collected, method. A receipt number (QFR-YYMM-00001) is created.
3. **Commission** is worked out from the technician's agreement:
   - *Labour only*: rate % of (labour minus discount).
   - *Labour and parts*: rate % of (labour plus parts minus discount).
   - *Fixed per job*: the rate field is a rupee amount.
   - *Custom rule*: the office enters the commission on the payment.
   You can override the commission when you record a payment yourself.
4. **Ledger.** Every commission, refund reversal and adjustment is a ledger line. Payments and refunds are never edited. Corrections are new lines.
5. **Refunds** (admin only, reason required) reduce the technician's commission in the same proportion.
6. **Settlement.** On a technician's profile or the Settlements page, press **Create settlement** to bundle all unsettled commission. The technician pays you by UPI, bank or cash and presses **I have sent the money** in the portal with the reference. Nothing closes until **you** press **Confirm money received** after seeing it in your account. Part payments are fine; the balance stays outstanding.
7. A technician can never verify their own settlement.

## Analytics tab
Pick Today, 7 / 30 / 90 days, this or last month, this year, or any dates. You get: orders received, completed, cancelled and open; completion rate; cash collected net of refunds; QuickFix commission; technician earnings; average order value; money owed by technicians; ratings and complaints; new and repeat customers; time to assign and complete; orders and money over time; orders by status, service, area, source and weekday; order funnel; technician leaderboard; and cash health.

## Reports (Reports page, with CSV download)
Cash collections, commission earned, outstanding settlements, settlements received, refunds and adjustments, technician performance and jobs completed, technician onboarding and verification, customer complaints, service category performance. Every CSV download is recorded in the activity log. CSVs can contain personal details: keep them private.

## Earlier stages (still included)
Bookings and matching, technician portal at /tech.html, technician onboarding and verification, service categories, audit log.

## Notes
- Times are shown in Indian Standard Time.
- Local checks: `npm test`; JavaScript syntax checks: `node --check src/api.js`, `node --check netlify/functions/api.js`, and the frontend JS files.
- Rebuild the function after source/schema changes: `npm install && npm run build`.
- Do not claim live SMS, database, or end-to-end booking tests passed until staging acceptance tests have actually succeeded.


## Customer web app (Stage 4 additions)
- Customer-facing web app: `/` and `/customer.html`. The existing admin interface is preserved at `/admin.html`; use that URL for administrator login.
- Customers register by verifying a mobile OTP, then set a password for future mobile + password login. Password recovery uses a fresh mobile OTP.
- Online customer orders are stored in the existing `bookings` table with source `customer_web`; they appear in the existing admin Bookings page and can be assigned through the existing workflow. Manual booking creation remains available. The admin booking list now includes a source filter/column.
- Customer authentication uses the existing `users`/`customers` model and secure password hashing. The customer area includes booking history/details, quotation response, payment history, complaints, review submission for completed jobs, and password changes. Schema version 4 adds customer password/lockout metadata to `users` and indexes; the existing automatic migration mechanism applies the idempotent schema upgrade on the next API request.
- Real SMS OTP requires configuring `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_VERIFY_SERVICE_SID` as Netlify environment variables. These are optional for the admin but required for customer signup and password recovery. Without them, OTP endpoints fail closed with a clear configuration message; no fake OTP is provided.
- Important: deploy through a Git-connected Netlify site using the configured build command so `npm install && npm run build` regenerates the serverless function from `src/api.js`. Do not use a static drag-and-drop deploy of this source folder because the checked-in compiled function must be rebuilt to include the new API routes. Test first on a development Netlify site/database. The supplied source changes do not themselves deploy the site or change the production database.

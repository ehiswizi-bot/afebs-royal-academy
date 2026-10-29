# AFEBS Royal Academy — School Management Starter

A responsive, mobile-first school portal using the supplied AFEBS Royal Academy logo, Royal Purple, Lilac, White and subtle Gold. This is a functional **starter/MVP**, not yet a production-ready implementation of every module in the original specification.

## Included and working
- Login with server-side session and role checks (Director, Teacher, Parent, Student, Administrator, Bursar).
- SQLite database and fictional demo data (24 student records, 8 class levels and demo user accounts).
- Role-sensitive dashboard and announcement feeds.
- Director/Administrator can create students and publish announcements.
- Director can archive announcements and suspend/reactivate non-Director accounts.
- Parents can only retrieve student records linked to their own account.
- Audit events for logins, logouts, student creation, announcement publishing/archive and account status changes.
- Rate-limited login endpoint, bcrypt password hashing, basic security headers, HTTP-only session cookie.

## Run locally
Requires Node.js 20+ and npm. From this folder:

```bash
npm install
```

Set a strong session secret before running, then start the app:

```bash
# macOS/Linux
SESSION_SECRET='replace-with-a-long-random-secret' npm start

# Windows PowerShell
$env:SESSION_SECRET='replace-with-a-long-random-secret'; npm start
```

Open `http://localhost:3000`.

## Demo sign-ins
All demo accounts use password `ChangeMe123!` (change it before deployment).

- Director: `director@afebs.demo`
- Teacher: `teacher@afebs.demo`
- Parent: `parent@afebs.demo`
- Student: `student@afebs.demo`
- Bursar: `bursar@afebs.demo`

The database is created as `afebs.db` the first time the server runs. To reset demo data, stop the server and delete that database file.

## Important before production
Do not expose this demo to the public internet as-is. The starter intentionally does **not** claim that all requested school workflows are finished. Production hardening and implementation still required:

1. Replace the default session secret; use HTTPS, secure cookies and a persistent session store. Add CSRF protection, stricter security headers/CSP, password-reset and verified email/phone flows, optional MFA, lockout policy and session revocation.
2. Implement tenant isolation (`school_id` on every relevant table and every query) before offering this as a multi-school SaaS. The current starter is single-school.
3. Add complete permission administration and least-privilege policy enforcement for custom roles.
4. Finish attendance marking/reporting, academic sessions/terms, timetables, assignment submissions, result entry/approval, fee ledger/payments/receipts, messaging, event calendar, push/email/SMS integrations, exports, file upload validation and offline retry handling.
5. Implement full login-session/device records, security alerts and suspicious-activity rules. The current audit feed is not a complete security-monitoring product.
6. Add automated tests, migrations, backups/restore testing, monitoring, error handling, accessibility review and deployment pipeline.
7. Complete privacy notice, lawful-basis/consent review, retention/deletion policy and a Nigerian data-protection compliance review before processing real children's information.
8. Integrate a payment gateway using its hosted/redirect checkout or tokenized flow; never store raw card details.

## Structure
- `server.js` — Express API, authentication, access control, SQLite schema and seed data.
- `public/index.html` — application shell and login.
- `public/styles.css` — responsive brand styling.
- `public/app.js` — dashboard and UI interactions.
- `public/assets/afebs-logo.png` — supplied school logo.

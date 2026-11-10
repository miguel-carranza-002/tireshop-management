# Tire Shop Management

[![CI](../../actions/workflows/ci.yml/badge.svg)](../../actions/workflows/ci.yml)

A shop management system for an independent tire shop, built for its service advisors. It covers the whole job, from the customer at the counter to the paid invoice: quotes, work orders, lift queues, inventory and special orders, deposits and payments, and printable PDFs.

It runs on the shop's own network. The prices, catalog and customers in this repository are examples.

## Features

- **Quotes → work orders → invoices.** A quote becomes a work order when the customer accepts it. Accepted prices are locked, and finished work is invoiced with gap-free invoice numbers.
- **Tire comparison.** Shows three options (cheap / medium / premium) for the vehicle's size from what's on the shelf, then tires to order in and alternate sizes within 3% of the original diameter. Alternate sizes are only offered when the drivetrain allows it. Out-the-door totals include mounting, disposal and tax. A customer view hides costs.
- **Typed requests.** The advisor types what the customer asked for ("4 215/55r16 road hazard warranty above 40k, under $150") and the comparison fills in the size, count and filters. Plain parsing rules, no external AI service. Any words it couldn't read are listed rather than guessed.
- **Filters**: brand, warranty, season, type, load range / ply rating, road hazard and max price. When nothing matches every filter, the closest tires are shown with what each one misses.
- **Inventory with reservations.** Stock is reserved for accepted work. Missing tires become special orders with deposits, are tracked through ordered → arrived → installed, and generate a customer call list when they arrive.
- **Shop floor.** Lift queues with wait estimates. A job only enters a queue once the car is checked in and every part is on hand.
- **Supplier catalog import** from CSV/TSV price lists, with a dry run before anything is written.
- **Pricing rules** (mount & balance, TPMS sensors, alignment, disposal, valve stems, tax, tire markup) are all Settings. Prices are copied onto each line, so changing Settings never re-prices an existing ticket.
- **Logins** with admin and advisor roles, scrypt password hashing, session cookies, lockout after repeated failures, and an audit trail of who created each ticket and recorded each payment.
- **PDF printouts** for quotes, work orders and invoices.

## Tech stack

| Layer | |
|---|---|
| Web | React 19, TypeScript, Vite |
| API | Node.js, Express 5, TypeScript |
| Database | PostgreSQL (plain SQL migrations; money math lives in SQL views) |
| PDFs | pdfkit |
| Tests | `node:test` integration tests over real HTTP against a real Postgres database |
| CI | GitHub Actions: typecheck, tests, demo data check, web lint and build |

## Design notes

- **Consistency checks.** Business invariants (reserved stock equals the sum of reservations, a job is in a lift queue only when it can be worked, paid invoices owe nothing…) are written as SQL checks in [`invariants.ts`](apps/api/src/invariants.ts). Every test scenario ends by running them, and `npm run check-db` runs them against any database.
- **Locking.** Every multi-statement write runs in a transaction and locks the ticket, work item or stock row first, so two advisors can't double-book the same tires.
- **Audit columns.** Audit columns default to the signed-in user. The request's user is carried through `AsyncLocalStorage` into a Postgres session setting.
- **Business rules.** The agreed rules are documented in [`docs/workflow.md`](docs/workflow.md), which serves as the specification the code is checked against.

## Project layout

```
apps/api      Express API (routes, pricing, allocation, PDFs, scripts)
apps/web      React app (screens in src/components/<area>, shared UI in src/ui)
db/migrations Numbered SQL migrations
db/           Backup / restore scripts (pg_dump, scheduled with launchd on macOS)
data/demo     Demo tire catalog (made-up brands)
docs          Business rules
```

## Getting started

Requirements: Node.js 24 and PostgreSQL 18.

1. Create a database login and two databases, one for development and one for tests:

   ```sh
   psql -U postgres -c "CREATE ROLE tireshop_app LOGIN PASSWORD 'choose-a-password'"
   psql -U postgres -c "CREATE DATABASE tireshop_dev OWNER tireshop_app"
   psql -U postgres -c "CREATE DATABASE tireshop_test OWNER tireshop_app"
   ```

2. Create `apps/api/.env` (it is git-ignored):

   ```
   DB_HOST=127.0.0.1
   DB_PORT=5432
   DB_NAME=tireshop_dev
   DB_USER=tireshop_app
   DB_PASSWORD=choose-a-password
   ```

   Optional: `PORT` (default 3000), `HOST` (default 127.0.0.1), `COOKIE_SECURE=true` behind HTTPS.

3. Install, build the schema and load the demo data:

   ```sh
   cd apps/api
   npm install
   npm run migrate
   npm run demo-data    # example prices, a small tire catalog, stock and customers
   npm run dev          # API on http://127.0.0.1:3000
   ```

4. In another terminal, start the web app:

   ```sh
   cd apps/web
   npm install
   npm run dev          # http://localhost:5173
   ```

   On the first visit you create the admin login.

A new database starts with every price at 0, so a real shop enters its own on the Settings screen. `demo-data` fills in example prices when they're all still 0.

## Tests

```sh
cd apps/api
npm test             # rebuilds tireshop_test from the migrations, then runs every test
npm run typecheck

cd ../web
npx tsc -b --noEmit && npx eslint src && npm run build
```

## Running it in a shop

`npm run build` in both apps, then `HOST=0.0.0.0 npm start` in `apps/api` serves the API and the built web app on one port for the shop's network. Create the admin login before opening it to the network. [`db/backup.sh`](db/backup.sh) and [`db/install-backup-schedule.sh`](db/install-backup-schedule.sh) set up nightly backups on macOS.

## License

All rights reserved. The code is published for viewing as a portfolio project; see [LICENSE](LICENSE).

# Tire shop management

Internal app for one tire shop's service advisors: quotes → work orders → invoices, inventory and special orders, lift queues, payments and accounts, PDF printouts. Username/password logins with two roles (admin, advisor).

**Business rules live in [docs/workflow.md](docs/workflow.md).** It is the agreed design and the source of truth for pricing, deposits, queues and invoicing. Read it before judging whether behaviour is a bug.

## Layout

- `apps/api`: Express 5 + `pg`, TypeScript (NodeNext: relative imports end in `.js`). Entry `src/server.ts` (listens); routes are wired up in `src/app.ts`.
  - `routes/tickets.ts`: quotes/work orders, work items, line items, accept, check-in, `loadTicketDetail` (the one payload the ticket screen uses)
  - `routes/shop.ts`: lift queues, readiness, wait estimates, Coming up, mark done / not performed
  - `routes/orders.ts`: pending orders, receiving, returns, customer call list
  - `routes/billing.ts`: deposits, refunds, invoicing, account payments
  - `invariants.ts`: the consistency checks; `scripts/`: migrate, check-db, reset test DB
  - `routes/products.ts`, `lowStock.ts`, `customers.ts`, `vehicles.ts`, `settings.ts`, `pdf.ts`
  - `allocation.ts`: reserving stock, creating orders, `syncQueue`
  - `pricing.ts`: tire size parsing and service prices; `balances.ts`: what's owed
  - `pdf/ticketPdf.ts`: pdfkit renderer for quote / work order / invoice
  - `auth.ts`: password hashing, session cookie (`ts_session`), `requireUser` (all of `/api` except `/health*` and `/api/auth/*`), `requireAdmin`; `routes/auth.ts` (me, first-run setup, login, logout, own password) and `routes/users.ts` (admin: manage logins)
  - `context.ts`: the signed-in user per request (AsyncLocalStorage). `withTransaction` copies it into the `app.user_id` setting, and audit columns (`tickets.created_by`, `payments.recorded_by`, …) default to `current_app_user()`. Writes that should record who did them must run in `withTransaction`.
  - `app.ts` also serves the built web app (`apps/web/dist`) when it exists
  - `catalogImport.ts`: supplier catalog files → tire lines and special-order sizes (`npm run import-tires`); header aliases and value mappings live there
- `apps/web`: React 19 + Vite. `/api` is proxied to `127.0.0.1:3000`. All API calls and shared types are in `src/api.ts`; screens in `src/components/<area>/`.
  - `src/router.ts`: one URL per screen in the hash (`#/tickets/1002`), page names and labels.
  - `src/ui/`: shared components (Button, Badge, Panel, PageHeader, Tabs, FormField, Modal, Table, Toolbar, EmptyState). New and migrated screens use these.
  - `src/styles/`: loaded once from `main.tsx`. `tokens.css` holds every color, size and radius as CSS variables; `components.css` holds two tiny helpers (`visually-hidden`, `num`); `ui.css` styles `src/ui`. Every page is built from `src/ui` plus its own stylesheet with a short class prefix (`ed-` quote editor, `od-` orders, `sf-` shop floor, `cu-` customers, `iv-` inventory, `pf-` product form, `cmp-` comparison…).
- `db/migrations/NNN_*.sql`: plain SQL, applied with `npm run migrate` (see below). Money math is in SQL views: `line_item_amounts`, `ticket_totals`, `ticket_balances`.

## Running and checking

- Postgres 18 on port 5433 (`/Library/PostgreSQL/18/bin`). Three databases, all owned by `tireshop_app`:
  - `tireshop`: real shop data. Never run tests or experiments against it.
  - `tireshop_dev`: what `apps/api/.env` points at for development.
  - `tireshop_test`: wiped and rebuilt from the migrations by every `npm test`.
- `apps/api/.env` is gitignored and must never be committed (there is deliberately no `.env.example`). It sets `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, and optionally `PORT` (default 3000) and `HOST` (default 127.0.0.1). Any of these can be overridden on the command line, e.g. `DB_NAME=tireshop npm run check-db`.
- In `apps/api`:
  - `npm run dev`: API on 127.0.0.1:3000. Web: `cd apps/web && npm run dev` (proxies `/api` there).
  - `npm test`: resets `tireshop_test`, then runs `test/*.test.ts` (node:test, real HTTP against the app in-process). Every scenario should end with `assertInvariants()`. Tests run signed in as the `test-admin` login that `helpers.ts` creates; `signIn(ADVISOR)` + `useCookie()` switch user, `useCookie('')` signs out.
  - `npm run typecheck`: API source and tests.
  - `npm run migrate` (`-- --status` to list): applies new `db/migrations/NNN_*.sql` files and records them in `schema_migrations`. Never edit an applied migration; add a new one. (`-- --accept-changed` records a deliberately edited one without re-running it; used once when the price defaults became 0.) Run it for each database (`DB_NAME=tireshop npm run migrate`).
  - `npm run check-db`: runs the invariant checks in `src/invariants.ts` against a database.
  - `npm run import-tires -- data/imports/<file>.csv [--apply]`: supplier tire catalog import; dry run unless `--apply`. Supplier files go in `data/imports/` (gitignored).
  - `npm run demo-data`: example prices (only when every price is still 0), a made-up tire catalog (`data/demo/demo-catalog.tsv`), shelf stock and three customers. `_demo`, `_dev` and `_test` databases only; safe to re-run.
  - `npm run sample-stock`: puts ~25 Celimo/Milestar catalog tires on the shelf with made-up costs (dev/test databases only; the list is in `scripts/sampleStock.ts`). Import the catalog first.
  - `npm run admin-password -- <username>`: when no admin can sign in. Asks for a new password, makes that login an active admin and signs it out (`DB_NAME=tireshop` for the real one).
- Web checks: `cd apps/web && npx tsc -b --noEmit && npx eslint src && npm run build`.
- Backups: `db/backup.sh` dumps `tireshop` to `~/Backups/tireshop` (30 days kept), scheduled nightly at 23:30 by launchd (`db/install-backup-schedule.sh`). Restore with `db/restore.sh <file> <database>`; restore into a scratch database first to inspect an old backup.

## Conventions

- Style: single quotes, no semicolons, ~100 columns. There is no Prettier config; don't run Prettier with its defaults.
- Every multi-statement write runs in `withTransaction` and locks first: `lockTicket` / `lockWorkItem` (tickets.ts), `lockStock` (allocation.ts), `SELECT … FOR UPDATE` elsewhere.
- Throw `ValidationError` / `NotFoundError` / `ConflictError` (validation.ts) → 400 / 404 / 409. Messages are shown to the advisor as-is, so write them in plain shop language.
- Web styles: use the tokens in `styles/tokens.css`, never raw hex values. Page CSS files hold only that page's layout; anything shared goes in `styles/`. Pages never import another page's CSS. Never use `window.prompt/confirm/alert`: use `Modal`, or `useDialogs()` for a quick confirm or one-field prompt.
- Web: the `react-hooks/set-state-in-effect` lint rule is on. Set state in promise callbacks, never synchronously in an effect.
- Commit messages end with a `Co-Authored-By` line; commit only when asked.

## Invariants worth checking in review

- `inventory_stock.reserved_qty` must equal the sum of `reservations.quantity` for the product. Every reserve/release path updates both.
- A new database starts every price Setting at 0 (the shop enters its own). Tests run with `scripts/examplePrices.ts`, applied by the test reset.
- Prices are copied onto line items when added; catalog and Settings changes never alter existing tickets (TPMS sensor lines carry their own single/2+ prices for `repriceTpms`). Invoiced tickets are locked.
- Invoice numbers are gap-free: taken from the single `invoice_counter` row inside the invoicing transaction.
- `syncQueue(client, ticketId)` must run after anything that changes a checked-in work order's orders or work items. A job is only in a lift queue when the car is checked in and nothing on the job is `needed`/`ordered`.
- Costs and margins are never shown to customers: not in the PDF, only behind the "Show costs" toggle.
- Not-performed work items stay on the ticket but are excluded from totals, the invoice and the PDF.
- Reservations exist only on pending work items of work orders. Finished work items (done / not performed) can't be changed: `lockWorkItem` refuses them.

## Known gaps (not bugs)

- The shop may be running a live API from this folder (`HOST=0.0.0.0 DB_NAME=tireshop`). Check what is on port 3000 before browser testing (`ps eww $(lsof -tiTCP:3000 -sTCP:LISTEN)`); if it's the real database, test on another port against `tireshop_dev`. If that live server runs `npm run dev`, every code edit reaches it immediately.
- The API binds to 127.0.0.1 unless `HOST=0.0.0.0` is set. Create the admin login before opening it to the network: while no login exists, whoever visits first becomes admin.
- Wrong-password lock-outs are kept in memory, so restarting the API clears them.
- No HTTPS: fine on the shop's own network. If it is ever exposed beyond that, put it behind HTTPS and set `COOKIE_SECURE=true`.
- No appointments beyond the optional `planned_for` date.

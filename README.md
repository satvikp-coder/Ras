# Robots of the Backstreet — RAS Control Center

A local competition operations system for **7 October 2026, 3:00–4:30 PM**. It manages teams, members, projects, Mentor Mitras, components, shop stock, team holdings, purchases, trades and **RAS Bolts**. SQLite ledgers explain every balance and inventory change. The application runs entirely on your computer after installation.

## Requirements

- **Node.js 24 LTS or later** (tested with 24.12.0), including npm (tested with 11.6.2).
- A current desktop browser. No Python, Docker, cloud account or API key is required.
- Internet access for the initial dependency installation only. Install and rehearse before arriving at the venue.

## Clean machine installation

Obtain this repository from the committee's shared repository URL or copy its source folder. If using Git:

```sh
git clone https://github.com/satvikp-coder/Ras.git
cd Ras
npm install
npm start
```

If you received a folder, open a terminal inside that folder and run the last two commands. For a repeatable installation with the supplied lockfile, use `npm ci` instead of `npm install`.

Open **http://127.0.0.1:3000**. On the first run, the terminal prints username **admin** and a randomly generated password **once**. Save that password securely. The database and schema initialize automatically; there is no separate migration or initialization command. Sign in, then use **Settings → Local operators** to change the admin password and create committee accounts. Updating your own account signs you out so you can verify the new credentials.

**Do not use sample prices, stock or allocations in the real event.** The real database starts empty, with an unconfirmed allocation of zero RAS Bolts and trading/refund rules disabled. In Settings, enter the actual allocation and rules and tick both confirmation boxes. Then enter the real teams, Mentor Mitras and components. Starting the timer is blocked until setup is confirmed.

## Commands

| Command                | Purpose                                                                       |
| ---------------------- | ----------------------------------------------------------------------------- |
| `npm start`            | Type-check, build and launch the complete production application on port 3000 |
| `npm run build`        | Type-check and build bundled assets into `dist/`                              |
| `npm run serve`        | Launch the server using an existing production build                          |
| `npm run dev`          | Start Express on 3000 and Vite on 5173; open http://127.0.0.1:5173            |
| `npm test`             | Business logic, HTTP authorization, concurrency, export and recovery tests    |
| `npm run lint`         | ESLint checks                                                                 |
| `npm run typecheck`    | Strict frontend TypeScript checks                                             |
| `npm run test:ui`      | Build and run browser acceptance tests (see testing below)                    |
| `npm run verify:clean` | Install and verify in a temporary clean copy; needs installation internet     |
| `npm run demo`         | Create a separate demo database and print its admin password                  |

To stop, press **Ctrl+C** in the server terminal. Restart with `npm start` or `npm run serve`. Do not close or shut down the server computer while operators are working.

## Features and architecture

- React 19 + strict TypeScript frontend, Vite, locally bundled assets and responsive dark CSS. No remote fonts or CDN scripts.
- Express 5 on one local process, Node's built-in SQLite driver, parameterized SQL, foreign keys, indexes, WAL, full synchronization and `BEGIN IMMEDIATE` mutations.
- Editable teams, members (one per line, optional contact after `|`), projects, notes, deactivation, Mentor Mitra records and reassignment. One Mentor Mitra can serve multiple teams; a team has one current Mentor Mitra.
- Configurable component prices, initial stock, purchase caps, active status and auditable shop/team inventory adjustments.
- Confirmed purchases and multi-item bilateral trades; item gifts and RAS Bolt gifts use the corresponding configured transfer rules.
- Initial allocations, purchases, transfers, bonuses, penalties, adjustments, refunds and reversals all create ledger transactions. There is no direct balance editor.
- Reason-required admin voids, linked replacement purchases/trades, optional partial purchase refunds and safe rejection of impossible reversals.
- Persisted start/pause/resume/end timer with server-enforced transaction locks and optional admin post-event access.
- Dashboard, profiles, global search, filtered/paginated histories, audit records, printable final report, Excel and CSV exports, native SQLite backup and validated restore.
- Keyboard shortcuts: **P** purchase, **T** trade, **D** dashboard, **L** ledger, **I** inventory, **E** Excel. **Space** pauses/resumes only for Admin. Shortcuts are suppressed in forms, dialogs and focused interactive controls.

ExcelJS generates formatted workbooks with frozen headers, filters and readable column widths. It replaces SheetJS here to support styling and avoid relying on an outdated npm `xlsx` release. Its UUID dependency is overridden to a patched compatible version; dependency auditing and workbook tests cover the installed tree.

The backend is readable native JavaScript modules with centralized validation and transaction logic in `server/store.mjs`. The frontend uses TypeScript interfaces; business decisions remain on the server. See [database design](docs/DATABASE.md).

## Database and configuration

The real database is **`data/competition.sqlite`** by default. SQLite also creates `-wal` and `-shm` files while running. Do not manually copy only the live `.sqlite` file: use Backup database. All `data/`, generated databases, backups, exports, dependencies, `.env` and build assets are ignored by Git.

`server/schema.sql` initializes schema version 1 idempotently. Incompatible backups are rejected. Future structural migrations must explicitly update the schema version and restore validator; there is no automatic conversion of unrelated or legacy databases.

Optional configuration: copy `.env.example` to `.env` and adjust these variables:

| Variable             | Default                   | Meaning                                                                       |
| -------------------- | ------------------------- | ----------------------------------------------------------------------------- |
| `HOST`               | `127.0.0.1`               | Server binding; local-only by default                                         |
| `PORT`               | `3000`                    | Backend/production port                                                       |
| `DB_PATH`            | `data/competition.sqlite` | SQLite location, relative to project folder or absolute                       |
| `BOOTSTRAP_PASSWORD` | Generated                 | Initial admin password, minimum 10 characters; used only on an empty database |
| `DEMO_MODE`          | `false`                   | Displays the demo banner; use only with the separate demo database            |

Event rules are set in the UI, not `.env`. Integer RAS Bolts are used throughout; fractional currency is deliberately unsupported. Default event date is 2026-10-07 and duration 90 minutes. Scheduled times are informational: Admin starts the actual competition clock. Never change the host computer's clock during the event. Initial allocation changes apply to newly created teams only; existing teams require reasoned ledger adjustments. Changing a price does not rewrite earlier purchases. Purchase caps count cumulative purchases minus completed refunds, so teams cannot bypass them by trading items away.

Negative balances and negative shop inventory default to forbidden. Even if negative shop inventory is enabled, team item ownership remains nonnegative. Post-event editing applies only to Admin and must be explicitly enabled. A paused or not-started event blocks normal financial operations. Admin inventory corrections and voids remain available for reconciliation.

## Roles

Before the timer starts, Admin can correct an existing team's initial allocation through **RAS Bolts adjustment → Initial allocation change**. Enter a signed difference and reason; it posts another INITIAL_BALANCE ledger entry and updates the initial allocation total. This is blocked once the timer starts or other financial history exists. Regular bonuses/penalties and adjustments follow the normal active/post-event transaction rules.

| Role           | Access                                                                                                             |
| -------------- | ------------------------------------------------------------------------------------------------------------------ |
| Admin          | All management, transactions, timer, settings, operators, adjustments, refunds, voids, exports, backup and restore |
| Shop Operator  | Purchases plus read-only team/inventory/history/report lookup and exports                                          |
| Trade Operator | Trades plus read-only team/inventory/history/report lookup and exports                                             |
| Viewer         | Read-only screens and exports                                                                                      |

Authorization is enforced on the server. Passwords use salted scrypt hashes. Sessions are HTTP-only, SameSite Strict cookies with a 12-hour lifetime and are stored as hashes in SQLite. Login attempts are rate-limited. Production defaults to loopback HTTP on a trusted computer. If you choose to expose it on a network, provide appropriate trusted-network access and HTTPS yourself; this project does not provision TLS or internet hosting.

## Competition-day workflow

1. Launch and sign in. Verify the event date, duration, actual allocation, trade/refund restrictions and operator accounts.
2. Verify teams, members, projects, Mentor Mitras, assignments, prices and stock. Check each initial ledger allocation.
3. Download a database backup and place an additional copy on a USB drive.
4. Start the timer at the actual competition start. Record purchases and trades through their review/confirm screens.
5. Periodically back up. Watch low stock and timer warnings. The server rejects overspending, overselling, unowned items and duplicate requests.
6. Correct mistakes via transaction details: void with a reason, then create a linked replacement if needed. Reverse later dependent trades/refunds first when requested.
7. End the competition (or let the timer reach zero). Confirm transactions are locked.
8. Open Reports, inspect final balances, export Excel and required CSV sheets, print/save the report, and create a final backup.

Keep [the competition-day quick guide](docs/COMPETITION_DAY_GUIDE.md) open during the event.

## Demo mode and safe reset

```sh
npm run demo
```

This creates **`data/demo.sqlite`**, prints a separate generated admin password, and inserts explicitly labelled DEMO teams, Mentor Mitras, 100 RAS Bolts allocations, sample components/prices and permissive sample trade rules. It never writes to the real competition database and refuses to overwrite an existing demo database.

PowerShell:

```powershell
$env:DB_PATH='data/demo.sqlite'
$env:DEMO_MODE='true'
npm start
```

macOS/Linux:

```sh
DB_PATH=data/demo.sqlite DEMO_MODE=true npm start
```

To reset the demo, stop its server, verify the exact filenames, and remove **only** `data/demo.sqlite` and its `data/demo.sqlite-wal` / `data/demo.sqlite-shm` files if present; run `npm run demo` again. There is no UI database-wipe button. For real use, start in a new terminal without demo environment variables, or clear them in PowerShell:

```powershell
Remove-Item Env:DB_PATH -ErrorAction SilentlyContinue
Remove-Item Env:DEMO_MODE -ErrorAction SilentlyContinue
npm start
```

## Backup

Admin: **Settings → Database backup & restoration → Backup database**. The downloaded, timestamped `.sqlite` file is a complete SQLite native backup, including ledgers, histories, timer, settings and hashed operator credentials. A server copy is kept under **`data/backups/`** (or `backups/` next to your configured database). The UI confirms timestamp and download completion. Keep another copy away from the server computer. Excel/CSV files are reports, not restorable database backups.

## Restore

1. Stop operator activity and ensure you have the credentials contained in the backup.
2. Sign in as Admin, open Settings, choose the backup and type **`RESTORE DATABASE`**.
3. The server checks SQLite integrity, exact schema/constraints/triggers, foreign keys, configuration, administrator availability, ledger running totals and reversal relationships **before replacing the live database**.
4. A native pre-restore backup is saved next to the live database in `backups/pre-restore-<timestamp>.sqlite`. Other API requests are blocked during maintenance.
5. The backup is staged and swapped, and a restoration audit entry is added. Sessions expire. Sign in again using the restored database's credentials.

An invalid/corrupt/incompatible file is rejected and the current data remains intact. If the server cannot start because the live database is damaged, stop it, retain the complete damaged database files, move them into a separately named recovery folder, launch a fresh database at the original path, then sign in with its first-run credentials and use the restore UI. Do not delete the only copy of the event data. See the quick guide for recovery steps.

## Exports and reports

**Export Excel** is available from every screen. It includes Teams, Purchases, Trades, RAS Bolt Ledger, Inventory, Team Inventory, Mitras, Audit Log, Event Summary, Inventory Movements, Refunds, Final Team Report and Configuration. Original and reversal records remain visible. Inventory quantities and final team balances are derived from ledgers. Reports are provisional until the competition ends.

Reports and Settings offer individual UTF-8 CSV downloads; select the dataset first. CSV spreadsheet-formula prefixes are escaped for safety. The final report supports the browser's Print / Save PDF command. Export totals exclude voided commercial transactions but ledger sheets retain their originals and reversals. Purchase spending is net of completed refunds; purchase counts and items sold are gross completed purchases.

## Verification

```sh
npm run lint
npm run typecheck
npm test
npm run build
```

Optional browser tests:

```sh
npm run test:ui
```

On Windows they use installed Microsoft Edge. On other systems run `npx playwright install chromium` once, then run the tests. Set `PLAYWRIGHT_CHANNEL=chrome` if you prefer installed Chrome (PowerShell: `$env:PLAYWRIGHT_CHANNEL='chrome'`). Browser binaries are only needed for these tests, never for application startup. Tests use temporary databases, not real event data. UI tests block every non-local request and verify purchases, trades, assignment, screens, export, backup, paused refresh and tablet overflow.

`npm run verify:clean` creates a temporary clean source copy, runs `npm ci`, lint, build and tests, starts a real production server, creates data through HTTP, verifies purchase/trade/export/backup, restarts the server and checks persistence. It removes only its own temporary folder. The dependency installation step needs internet or a populated npm cache.

See [implementation status](docs/IMPLEMENTATION_STATUS.md) for executed checks and limitations. Physical disconnection is still a sensible venue rehearsal; automated verification blocks external browser traffic rather than modifying the machine's network adapter.

## Troubleshooting

- **`node:sqlite` unavailable:** install Node 24 LTS or later, reopen your terminal and check `node --version`.
- **SQLite experimental warning:** Node 24 labels this built-in API experimental. The warning does not indicate a database error; the tested version is documented above.
- **Port in use (`EADDRINUSE`):** stop another instance or set `PORT` in `.env`. Development proxy assumes backend port 3000; for a custom development port update `vite.config.ts` as well.
- **Forgot admin password:** another Admin can reset it in Operators. `BOOTSTRAP_PASSWORD` never overwrites existing credentials. Retain credentials securely; there is no unauthenticated reset endpoint.
- **Blank app / missing production build:** run `npm run build` before `npm run serve`, or use `npm start`.
- **Transactions locked:** check timer state and rule confirmations. Paused/not-started events reject purchases, trades, refunds and RAS Bolt adjustments. After end, only explicitly enabled Admin post-event edits are allowed.
- **Unable to void:** the team may have traded the item or spent the receipt. Reverse dependent transactions first. A purchase with active refunds requires those refunds to be voided first.
- **Database locked:** stop accidental second server instances and keep the database on a local disk, not a synced/network drive. Never edit SQLite while the event server runs.
- **Restore rejected:** use a native backup from this schema version. An Excel workbook, renamed text file or unrelated SQLite file is not valid.
- **Dependency installation failure:** verify Node/npm versions and initial network access, then retry `npm ci`. Never commit `node_modules` or production credentials.
- **After restore, login fails:** use the credentials stored in the restored backup, not newly created credentials from the replaced database.

## Offline operation

After dependencies are installed, startup, authentication, teams, Mentor Mitras, inventory, ledger, purchases, trades, timer, search, reports, Excel/CSV export, backups and restoration require no internet. Keep the browser and local Node server running on the event computer. Refreshing works because the server serves bundled assets and persists data in SQLite. This is a local server application, not a browser-only app that can keep transacting after its server stops.

# Implementation status

Verified on **4 October 2026**, Windows, Node 24.12.0 / npm 11.6.2, Microsoft Edge headless browser tests.

## Implemented

- Teams, editable members/contacts, projects, notes, active/inactive status, profile statistics and history tabs.
- First-class Mentor Mitras, contact/notes/status management, reassignment/removal, multiple-team assignments and dashboard/detail views.
- Configurable components, integer prices, original stock snapshots, per-team cumulative purchase caps, team holdings, inventory adjustments and movement history.
- Atomic purchases, multi-item bilateral trades, pure RAS Bolt transfers, configured item transfers, explicit confirmation and duplicate request protection.
- Append-only RAS Bolt and inventory ledgers, initial allocations, bonuses, penalties, adjustments, full voids, linked replacement corrections and configurable partial refunds.
- Reason-required changes to existing initial allocations before timer start, recorded as additional INITIAL_BALANCE entries; later rewriting is blocked.
- Unique transaction/purchase/trade/audit references, timestamps, operator attribution and competition-time snapshots.
- Local Admin / Shop Operator / Trade Operator / Viewer accounts, scrypt password hashes, expiring sessions, server authorization, same-origin mutation protection and login throttling.
- Persistent 90-minute timer, start/pause/resume/end/reset controls, threshold warnings, expiry locks and explicit Admin post-event access.
- Dashboard, global and page searches, server-filtered/paginated histories, audit activity, printable final report and low-stock highlighting.
- Formatted Excel workbook with all required sheets plus inventory movements, refunds, final team report and configuration; individual CSV datasets with formula escaping.
- Native SQLite backups, bounded upload validation, automatic pre-restore backup, staged restore, invalid-file rejection, session invalidation and restoration audit.
- Separate demo creation with clearly labelled sample values and overwrite refusal. No live database reset endpoint.
- README, competition-day guide and database documentation.

## Architecture and launch

React + TypeScript / Vite frontend; Express backend with centralized business rules; Node built-in SQLite with relational constraints, foreign keys, indexes, WAL and FULL synchronization. ExcelJS produces styled workbooks. CSS and all browser assets are local. No cloud services, authentication providers, CDN dependencies or API keys.

```sh
npm install
npm start
```

Open **http://127.0.0.1:3000**. First-run username **admin** and the generated password appear in the terminal once. Database initializes automatically at **`data/competition.sqlite`**. `npm run serve` starts an already-built installation. Optional `.env` variables and every operation are documented in [README](../README.md).

Before competition use: confirm actual initial RAS Bolts and rules in Settings, enter actual components/prices/stock, verify teams/Mitras and create operator accounts. Unknown rules start disabled and actual allocation is unconfirmed. Scheduled times are informational; Admin controls actual timer start.

## Accounting and safety

Balances and holdings are ledger sums, never editable cached values. SQLite `BEGIN IMMEDIATE` serializes competing writes; operation records, all financial/item legs and audit commit together. UNIQUE request keys reject duplicates and mismatched retries. Completed reversal entries offset retained VOIDED originals; the running ledger deliberately includes both sides. See [DATABASE.md](DATABASE.md) for the exact accounting model.

Voids reject insufficient current items/funds and preserve history. Purchases with active refunds require refund reversal first. Linked replacements point to their original. Shop stock cannot go negative by default and team holdings never go negative. Timer checks and role checks run on the server.

Backups use SQLite's backup API. Restore checks schema definitions/protection triggers, integrity, foreign keys, settings, ledger running totals, reversal relationships and administrator presence before replacement. It preserves an automatic pre-restore backup and blocks API traffic during maintenance.

## Verification results

| Check                          | Result                                                                                                                                                                                                                                                                          |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dependency installation        | Passed, including `npm ci` in a temporary clean source copy                                                                                                                                                                                                                     |
| ESLint                         | Passed                                                                                                                                                                                                                                                                          |
| Strict TypeScript check        | Passed                                                                                                                                                                                                                                                                          |
| Automated business/API tests   | Passed: initial allocation, purchase/trade success and rejection, injected rollback, idempotency, ledger/inventory reconstruction, caps, role restrictions, simultaneous oversell, assignment, timer restart/lock, refunds, exports, backup/restore, malformed/tampered backups |
| Browser tests                  | Passed: desktop and tablet; purchase/trade/assignment/search, every navigation screen, Excel/backup downloads, paused refresh, login/logout and layout overflow                                                                                                                 |
| Production build               | Passed; no build warnings                                                                                                                                                                                                                                                       |
| Development startup            | Passed; Vite page, local login and authenticated API via development proxy checked                                                                                                                                                                                              |
| `npm start` production startup | Passed; built assets and local authenticated API checked                                                                                                                                                                                                                        |
| Clean-machine rehearsal        | Passed: install → lint/build/tests → initialize → production server → HTTP purchase/trade → Excel → backup → full server restart → persistence                                                                                                                                  |
| Dependency security audit      | `npm audit`: zero known vulnerabilities in installed tree                                                                                                                                                                                                                       |
| Offline browser operation      | Passed with all non-local network requests blocked; zero external requests observed                                                                                                                                                                                             |
| Visual review                  | Desktop dashboard and tablet teams screenshots inspected; labels, contrast, tables, timer and layout verified                                                                                                                                                                   |

The exact required acceptance scenario passed: initial teams 100/100 RAS Bolts and motor stock 10; Team A purchases two at 10 each → balance 80, shop 8, team quantity 2; trades one for 15 → balances 95/85 and quantities 1/1. Mentor M01 assignment appears in both directions. Trade and purchase reversals preserve original VOIDED records, restore balances/stock and create audit evidence. A linked replacement, required Excel sheets and persistence after restart were verified.

## Practical limitations / organizer notes

Final automated totals: **20 business/API tests and 2 browser acceptance tests passed**. Browser acceptance also restored a downloaded backup through the actual upload/confirmation UI, verified session invalidation/re-login, removal of post-backup data and retained accounting. Additional tests covered safe demo overwrite refusal, empty export headers, signed numeric CSV quantities, original stock snapshots and rejection of incompatible database initialization.

- Actual component lists/prices/stock, allocation, bonuses/penalties and competition restrictions must be supplied by organizers through configuration. Demo values are explicitly samples.
- Currency is integer RAS Bolts; fractional allocations/prices are unsupported. A team has one current Mentor Mitra; a Mitra supports multiple teams.
- Timer uses the server's wall clock; do not adjust it during the event. The active timer continues through downtime. Natural expiry is derived from persisted timestamps even if the stored raw state still says ACTIVE.
- Offline verification blocked external browser traffic; the machine's physical network adapter was not disconnected. Rehearse with the actual event computer disconnected before event day.
- Default deployment is trusted local loopback HTTP. Network/TLS deployment is not provisioned.
- Restore is schema-version-specific, not a general SQLite importer. Filesystem swaps cannot guarantee recovery from power loss at every rename boundary; pre-restore backups and retained recovery files support manual recovery. Restore only trusted backups.
- Purchase counts / items sold are gross completed purchases; purchase spending is net of completed refunds. Exported inventory separately identifies returned quantities.
- The Node 24 SQLite API emits its experimental warning. ExcelJS has deprecated transitive packages; the installed dependency audit reports no known vulnerabilities, and exports are tested.

All core workflows are implemented; no required screen is a placeholder. Test databases and generated artifacts are excluded from version control. Production data is initialized when the committee first starts the application.

Final reporting review added explicit team spending/trade totals and timestamps, original purchase/trade details, team inventory movement history, and completed traded quantities in inventory exports. Team-to-team item transfers do not reduce shop stock. Trade value measures RAS Bolts exchanged; it does not invent a valuation for bartered items. Operator edits retain prior non-secret fields in the audit log. Restore maintenance also blocks new logins while replacing the database.

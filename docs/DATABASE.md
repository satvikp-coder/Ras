# SQLite database and accounting

## Layout

`data/competition.sqlite` (configurable `DB_PATH`) stores the complete event. Node 24 built-in SQLite enables foreign keys, WAL journaling, FULL synchronization and a 5-second busy timeout. Schema version 1 is initialized through `server/schema.sql`; all state changes go through `server/store.mjs`. The server has no arbitrary SQL endpoint.

| Tables                                          | Purpose                                                                                                        |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `config`, `timer`, `schema_version`             | Event/rule configuration, persistent clock, compatibility                                                      |
| `operators`, `sessions`                         | Local role/password hashes and expiring hashed session identifiers                                             |
| `teams`, `members`                              | Team identity, members, project, notes and active status                                                       |
| `mitras`, `assignments`                         | Mentor Mitra identity; one current assignment per team, many teams per Mitra                                   |
| `components`                                    | Identity, unit price, status and optional per-team cumulative purchase cap                                     |
| `transactions`                                  | Unique reference, kind, status, idempotency payload/key, operator, timestamp, clock snapshot, reason and links |
| `purchases`, `trades`, `trade_items`, `refunds` | Immutable commercial details and purchased-price/name snapshots                                                |
| `bolt_ledger`                                   | Signed integer RAS Bolt movements and sequential before/after balances                                         |
| `inventory_movements`                           | Signed component movements and before/after quantities; NULL owner means shop                                  |
| `audit`                                         | Operator/action/entity/before/after/reason; protected from update/delete                                       |

IDs: configurable unique team/Mitra/component strings, integer database transaction keys plus `TXN-000001`, `PUR-000001`, `TR-000001`, `AUD-000001`. Adjustment/refund/reversal types use the common transaction reference. IDs are not timestamp-derived. Foreign keys preserve history; deactivation replaces destructive entity deletion.

## Ledger source of truth

Current RAS Bolts = `SUM(bolt_ledger.amount)` for a team. Inventory = `SUM(inventory_movements.quantity)` for each component/owner. No mutable balance or stock cache exists. Initial RAS Bolts and initial shop stock are transactions, including when zero allocations produce no nonzero movement. Every nonzero movement records before and after values under a write transaction.

**Void accounting:** original ledger rows remain posted immutable historical facts. Voiding changes the transaction's display status to VOIDED and posts equal/opposite entries in a new COMPLETED reversal. Both originals and reversals participate in the running ledger, so their net effect is zero. Do not filter original VOIDED rows out of a running balance while also including their reversals: that would reverse twice. This implementation commits financial postings only as COMPLETED; PENDING/CORRECTED statuses are reserved and cannot be introduced through the application. The backup validator rejects postings under those reserved statuses. Commercial totals exclude voided purchases/trades; purchase spending subtracts completed REFUND entries.

Example: INITIAL_BALANCE +100 → PURCHASE −20 → trade receipt +15 = 95 RAS Bolts. Void the trade: CORRECTION −15 = 80. Void the purchase: CORRECTION +20 = 100. Every step appears in the ledger with operator and timestamp.

Inventory follows the same reversal rule. Shop purchase creates −quantity for shop and +quantity for team. A trade posts −quantity for outgoing team and +quantity for incoming team. Admin corrections explicitly identify an owner and reason. Team quantities can never go negative. Shop negatives require an explicit rule switch.

## Atomic operations and duplicate protection

Before timer start, reason-required Admin initial-allocation changes post signed INITIAL_BALANCE entries. They are rejected after starting or when other financial history exists for the team. Updating the configured default never silently rewrites existing allocations.

All mutations use `BEGIN IMMEDIATE`; nested creation operations use savepoints. SQLite serializes competing writers. Purchase/trade reads and validations happen **inside** the write transaction, so requests cannot both validate against stale stock or balances. Success commits records, RAS Bolt entries, inventory entries and audit together. Failure rolls back every step.

Each financial mutation requires an idempotency key of at least 16 characters. A unique database constraint protects it. Repeating the same kind/body/operator returns the original transaction, even after the event ends. Reusing a key with different data or another operator is rejected. Keys remain in the confirmation state during retries; frontend buttons are disabled while committing. A separately created confirmation has a new key and is intentionally a new request.

Purchases re-read the actual price, check the confirmation's expected price, active team/component, integer quantity, global maximum, cumulative purchase cap (minus completed refunds), RAS Bolts and shop stock. Stored names and prices survive later entity edits.

Trades validate different active teams, rule combination, no duplicate item lines, outgoing funds and every outgoing item **before applying incoming legs**. This prevents borrowing unowned outgoing items from the same bilateral transfer. Multi-item and bilateral RAS Bolt legs commit together. Configuration independently controls item trading, item-for-item/gifts, item-for-RAS Bolts, mixed trades and pure RAS Bolt transfers.

## Voids, corrections and refunds

Only Admin can void, with a required reason. Reversal references have a UNIQUE `reversal_of` key and the original must be COMPLETED and unreversed. Reversal inventory and funds are checked against current holdings, so dependent trades may have to be reversed first. Reversals cannot themselves be voided. Original status, reversal postings and audit all commit together.

A linked replacement must reference a VOIDED original; only one replacement is accepted. Purchase/trade forms generate the new postings under normal event locks. The original remains VOIDED, the reversal remains COMPLETED, and the replacement's `correction_of` references the original. Other correction types can be recorded as reason-required adjustment transactions.

Partial purchase refunds are configurable and Admin-only. A refund references a COMPLETED purchase, cannot exceed its unrefunded quantity, moves items from team back to shop and credits the original unit price. A refund can be voided safely; a purchase with a still-completed refund cannot be voided until the refund is reversed. Team purchase-cap calculations subtract completed refunds. Refunds share the normal competition-state gate.

## Mentor Mitra and team administration

Team ID is stable; editing members replaces the current member list and records the new list in audit. Projects, notes and deactivation are audited. Assignment changes preserve before/after relationships in audit; the current assignment table is not historical storage. Historical assignment changes are available in the team's audit tab. Mitra lists display all currently assigned projects and balances.

## Timer

States: NOT_STARTED, ACTIVE, PAUSED, ENDED. Stored fields: first actual start, last resume, accumulated elapsed milliseconds and actual end. ACTIVE elapsed is accumulated elapsed plus wall-clock time since last resume. PAUSED uses only accumulated elapsed. Expiry derives an effective ENDED state and an exact expiration timestamp even when the server was stopped at zero. The raw row may still say ACTIVE after natural expiry; every API gate uses the derived state.

Start requires organizer confirmation. Pause persists elapsed time; resume stores a new timestamp. Ending records actual time; resetting is blocked after purchases or trades, preventing accidental event reuse. Duration cannot change after starting. The clock is based on the server computer; avoid clock adjustments during the event. Normal purchases/trades/refunds/RAS Bolt adjustments require ACTIVE. After ENDED, only Admin with postEventEditing may perform those operations. Admin reconciliation voids and inventory adjustments remain available and audited.

## Backup / restore

`node:sqlite` native backup creates a consistent SQLite snapshot including WAL state; no unsafe file-copy shortcut is used. Restores validate integrity, full schema definitions, indexes/protection triggers, foreign keys, settings, an active Admin, timer presence, ledger cumulative running totals and reversal relationships. Uploads are bounded to 100 MB and stored under randomized staging filenames, never caller-specified filesystem paths.

During restore the API blocks other requests, creates a native pre-restore backup, stages a complete SQLite copy, checkpoints and closes the live handle, renames files and opens the restored database. Runtime swap failures restore the previous file. Session rows are deleted and a restoration audit entry records who performed it and the pre-restore path. If that operator is absent in the backup, a disabled attribution-only Viewer record is added; no restored account is granted extra authority.

Native filesystem rename cannot guarantee recovery from a power loss at every point between the two renames. The automatic pre-restore backup and any `.previous` file permit manual recovery. Never restore during active operator work; keep power stable. This application validates structure and ledger consistency; it does not cryptographically authenticate the origin of a backup. Restore only trusted committee backups.

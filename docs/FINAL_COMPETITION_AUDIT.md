# Final competition audit — 7 October 2026

## 1. Full system audit

Inspected package scripts/lockfile, Vite/TypeScript/ESLint/Playwright configuration, frontend authentication/screens/forms/history/reports/styles, Express routes and authorization, SQLite schema/migration/session tables, transaction engine, ledger/inventory posting, purchases/trades/corrections/refunds, persisted timer, search/filters, Excel/CSV, backup/restore, demo/clean-install scripts and existing tests/docs. Searched TODO/FIXME/mock/placeholder/demo/remote assets and obsolete event terms. Form placeholders are normal UI hints; no core screen is a stub. Core runtime uses bundled assets and local SQLite/authentication.

Implemented free automatic starter allocations, canonical final event/project/market reference data, project-purchase enforcement with audited Admin approval and a Settings switch, project selection and required/owned/missing components, workshop exclusion from purchases/trades, correct market-only dashboard inventory, event details/setup reminder, stronger integrity/restore validation and LAN-compatible request keys. Fixed the team dashboard timer display. Existing real accounts and teams were preserved.

## 2. Configuration

ROBOTS OF THE BACKSTREET, IEEE Robotics & Automation Society — Ahmedabad University Student Branch. GICT 105, Ahmedabad University. 7 October 2026, 15:00–16:30, 90 minutes. Eight slots, 40 participants, five members/team. 1,000 RAS Bolts/team through the ledger. Negative balances/stock, refunds and post-event transactions OFF. All trade types ON. Project purchase rules ON with reason-required Admin strategic approval.

Free starter inventory per team: Arduino Uno ×1, Chassis / Frame ×1, Wheel ×2, Caster Wheel ×1. Allocated as an idempotent INVENTORY_ADJUSTMENT marked STARTER_ALLOCATION, without Bolt debit or central-stock movement. Existing real allocations of 100,000/1,000,000 were corrected with reasoned INITIAL_BALANCE entries to a net 1,000 each; genuine original ledger/audit history remains.

## 3. Purchases actually simulated

Four explicit TEST-T01 through TEST-T04 teams were created through the real API on a native copy of the configured live database. Each had five members and a 1,000-Bolt initial entry plus starters.

| Team     | Purchases                        | Cost | Balance after |
| -------- | -------------------------------- | ---: | ------------: |
| TEST-T01 | 2 motors                         |  200 |           800 |
| TEST-T02 | driver, 2 motors, battery        |  420 |           580 |
| TEST-T03 | 2 IR, driver, 2 motors, battery  |  540 |           460 |
| TEST-T04 | 2 LDR, driver, 2 motors, battery |  480 |           520 |

Checked purchase/transaction references, original prices, before/after balances, inventory legs, operator, timestamp and audit. Quantity-two purchases of one-stock Bluetooth/servo/sound items were rejected. Insufficient funds and quantities 0/−1/1.5 were rejected without postings. Concurrent first submissions with the same key created exactly one purchase; replay also posted nothing extra. Project-rule violation, unauthorized override and starter purchase were rejected.

## 4. Trading

- Item ↔ Item: **PASS** — IR/LDR swap; balances unchanged.
- Item ↔ RAS Bolts: **PASS** — one motor for negotiated 150 despite market price 100; balances became 950/430.
- Item + Bolts ↔ Item: **PASS** — motor for IR +50; all item/Bolt legs posted together.
- Pure RAS Bolt transfer: **PASS** — 30 transferred.
- Same-team, unowned/excess quantity, excessive payment, workshop-item and disabled mixed trade: rejected with zero state changes.
- Concurrent identical first trade submissions created one trade; replay created no additional records.
- Every successful trade left central market stock unchanged.

## 5. Atomicity

Compared complete transactions/purchases/trades/trade-items/ledgers/inventory/audit snapshots before and after failures. All rejected operations preserved the snapshots. Injected an exception after inventory movements began: all item, Bolt and record changes rolled back under the actual SQLite transaction. The deliberately logged exception is test evidence, not an unresolved runtime error.

## 6. Ledger

Independently reconstructed every simulation team's running balances and before/after chains from posted ledger entries, including originals/reversals. Compared against API team profiles and Excel. Final rehearsal balances after safe unwind, linked replacement and +25 adjustment were **800, 610, 460, 515**. No displayed balance was directly edited.

## 7. Inventory

Independently reconstructed every team/component holding from movement chains. Starter allocations, purchases, trades and reversals reconciled. Central stock reconciled from initial official quantities and commercial purchase/reversal movements; no trade posted a central movement. Dashboard totals matched the database, including 12 completed purchases, two completed trades, 1,640 purchase spending and 30 net completed trade Bolts at the checkpoint.

## 8. Void/correction

Reasoned +25 MANUAL_ADJUSTMENT passed. A safe battery purchase void restored funds/stock/ownership and retained the VOIDED original; its linked replacement passed. Mixed trade reversal restored both legs. Voiding an earlier trade after its received motors moved onward failed safely. Reversing the dependent trade first enabled the original reversal. All actions remained audited in the temporary rehearsal database.

## 9. Timer

NOT_STARTED → ACTIVE → PAUSED → resume → ENDED passed. Browser refresh preserved pause. A full separate Node server process restart preserved PAUSED state, exact remaining time and all transaction history. Backend purchases/trades rejected after end. Existing unit tests also verified controlled natural expiry. Final live timer is NOT_STARTED, 5,400,000 ms remaining, elapsed zero and all actual timestamps NULL.

## 10. Export

**Excel PASS:** generated an actual workbook; inspected required sheets and all four simulation balances programmatically. **CSV PASS:** generated six datasets and checked headers/records. Browser acceptance also exercised downloads, printable reports and every screen.

## 11. Backup/restore

Saved native PRE_FINAL_SIMULATION and PRE_FINAL_CONFIGURATION backups before live changes. In rehearsal, downloaded a real SQLite backup, validated its schema/chains, changed the event name, restored through the actual upload endpoint, verified previous balances/timer/configuration and session invalidation. Read and validated the automatic pre-restore backup. Corrupt upload was rejected without replacing the live state. Final COMPETITION_READY backup was created and validated. Backups/databases/passwords remain local and Git-ignored.

## 12. Build and application

23 backend/API tests PASS. Four browser acceptance tests PASS. ESLint PASS. Strict TypeScript PASS. Production build PASS. Clean installation with npm ci, lint/build/tests, fresh initialization, production HTTP purchase/trade/export/backup and process restart PASS; installed dependencies reported zero known vulnerabilities. Actual npm start launched the final live application on 0.0.0.0:3000. Network response and read-only browser inspection at http://10.1.44.18:3000 passed ten screens plus purchase/trade dialogs, exact nine market choices, clean timer and zero browser errors or external requests. Desktop screenshot inspected. Browser tests verified tablet overflow and no external runtime requests.

## 13. Cleanup

The isolated native rehearsal databases, simulation teams, members, Mitra, assignments, operators, purchases, trades, trade items, adjustments, corrections, ledgers, inventory movements, sessions, timer activity and simulation audit entries were physically deleted with their temporary directories after success. Browser/test/clean-install databases were likewise removed. No simulation rows were inserted into the live database. Final verification searched live teams/Mitras/operators/transactions/audit/members/accounts for simulation markers and confirmed none remained.

Real live state: **four genuine teams preserved**, four available slots, zero purchases/trades/refunds/manual adjustments, zero test holdings/history. Each real team has 1,000 Bolts and its genuine starter kit. Original real admin/configuration/ledger history is retained. Live inventory matches the official starting quantities; timer reset. Foreign keys/integrity, running ledger/movement chains, negative balances/inventory and duplicate active component names all passed.

## 14. Final live market

| Component                 | Database quantity | Official price |
| ------------------------- | ----------------: | -------------: |
| DC Geared Motor           |                16 |            100 |
| Motor Driver              |                 8 |            120 |
| Battery / Power Source    |                 8 |            100 |
| HC-SR04 Ultrasonic Sensor |                 3 |            100 |
| IR Line Sensor            |                 4 |             60 |
| LDR / Light Sensor        |                 2 |             30 |
| HC-05 Bluetooth Module    |                 1 |            150 |
| Sound / Microphone Sensor |                 1 |             80 |
| Servo Motor               |                 1 |            100 |

Jumpers are inactive Common resources and prohibited from Bolt-market purchase/trading. Two reported loose/spare casters are tracked under Starter inventory, outside the market; per-team starter kits are allocated separately. Old planning products are inactive Reference/Common entries. Obsolete robot descriptions are removed from current component records; genuine historical audit values are retained.

## 15. Final status

**COMPETITION READY — application configured, tested and clean for real team setup.** The four preserved teams (neev, henil, diyan, mahir) still need actual members, assigned robots and Mentor Mitras; add the remaining four teams. These organizer-supplied details were not invented. Verify physical availability of all eight starter kits before starting. The clock remains stopped for organizers to complete setup and start at the actual competition time.

Arithmetic discrepancies: Light Follower costs **480**, not 380, leaving **520**. Listed market quantities sum to **44**, not 43; official market value is **4,290**. The software uses actual prices/quantities without forcing incorrect subtotals.

Reproduce with `npm test`, `npm run test:ui`, `npm run verify:clean`, `node scripts/final-simulation.mjs`, `node scripts/verify-final-state.mjs`. Run simulations before competition; the live-copy rehearsal needs four available slots. The final-state verification intentionally fails after commercial operations begin, since it checks the pristine pre-event state.

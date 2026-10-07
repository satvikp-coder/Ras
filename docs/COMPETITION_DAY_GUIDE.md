# Competition-day quick guide

**ROBOTS OF THE BACKSTREET — 7 October 2026 — 3:00–4:30 PM — GICT 105, Ahmedabad University**

IEEE Robotics & Automation Society, Ahmedabad University Student Branch. **8 teams · 40 participants · 5 members/team · 1,000 RAS Bolts/team · 90 minutes.**

## Launch and team setup

1. Run `npm start` in the project folder. Open http://127.0.0.1:3000 and sign in. `npm run serve` starts an existing build faster. Save first-run credentials securely.
2. For network access, PowerShell: `$env:HOST='0.0.0.0'` then `npm run serve`. Use this computer's current IPv4 address and port 3000. Keep it awake and on reliable power.
3. For a fresh installation only, stop the server and run `node scripts/configure-final-event.mjs`. The existing live database is already configured. Setup backs up first and refuses to reset stock after commercial transactions.
4. Preserve real teams. Add remaining teams up to eight; enter five actual members, select the assigned robot and assign a Mentor Mitra.
5. Every new team gets **INITIAL_BALANCE +1,000** and a free **STARTER_ALLOCATION**: Arduino Uno ×1, Chassis / Frame ×1, Wheel ×2, Caster Wheel ×1. Check balance and holdings. No fake purchases are required. Eight teams need 8 Arduino, 8 chassis, 16 wheels and 8 casters. Verify physical availability; two spare casters are recorded separately.
6. Settings → Team logins: click a team ID, create credentials and share the `/#team` link. Teams see only their own records; operators record transactions.

Robot distribution: Obstacle Avoidance ×2, Line Follower ×2, Light Follower ×1, Bluetooth Controlled Car ×1, Clap Detector ×1, Radar Car ×1. Team Details lists required, owned and missing components.

## Official market

| Component                 | Starting stock | Bolts each |
| ------------------------- | -------------: | ---------: |
| DC Geared Motor           |             16 |        100 |
| Motor Driver              |              8 |        120 |
| Battery / Power Source    |              8 |        100 |
| HC-SR04 Ultrasonic Sensor |              3 |        100 |
| IR Line Sensor            |              4 |         60 |
| LDR / Light Sensor        |              2 |         30 |
| HC-05 Bluetooth Module    |              1 |        150 |
| Sound / Microphone Sensor |              1 |         80 |
| Servo Motor               |              1 |        100 |

Total: **44 items, 4,290 Bolts**. Starter kits and common supplies are separate. Jumper/connecting wires, breadboards, screws, nuts/bolts, ties, tape, cardboard, tools and mounting materials cost no individual Bolts and are excluded from paid purchases and trades.

## Before starting

- Check real database, eight teams, five members/team, robot assignments, Mitras, operator roles, starter holdings and 1,000-Bolt allocations.
- Check exact market stock/prices and both rule confirmations.
- All trade types and Bolt transfers are enabled. Negative balances/stock, refunds and Admin post-event transactions are disabled.
- Project purchase enforcement is ON. Admin can enter a strategic-acquisition approval reason; Shop Operators cannot override. Settings can disable the rule if organizers decide.
- Download a native backup and copy it to USB. Keep the server clock unchanged during competition.

## Timer

Admin: Dashboard → Start competition at actual start. Duration is 90 minutes; advertised times are informational. Pause/Resume or Space persists across refresh/restart. Paused transactions are blocked. An active timer continues during downtime. End or expiry locks purchases/trades on the backend.

## Purchases

P or New purchase → team/component/quantity → Review → verify total/balance/stock → Confirm. Market stock decreases, team holdings increase and Bolts decrease atomically. Invalid quantities, insufficient stock/funds and duplicate confirmation cannot create extra completed purchases. Reuse the same confirmation after uncertain submission and check history before a new request.

## Negotiated trades

T or New trade → two different teams → each side's outgoing owned items and optional Bolts → record agreed terms in Notes → Review → Confirm. Item ↔ item, item ↔ Bolts, mixed combinations and pure transfers work. A market motor at 100 can trade for an agreed 150 Bolts. Market stock remains unchanged. All legs commit together or none do.

Teams cannot trade unowned/excess items or unavailable Bolts. Keep unused Bolts: **BUILD SMART. SPEND SMART. TRADE SMART. BUILD FAST.**

## Corrections

Admin: open transaction details → Void → required reason. Original remains VOIDED; linked reversal restores effective balances/holdings. Reverse dependent transactions first if items moved onward or receipts were spent. A VOIDED commercial record can have one linked replacement. Never delete event transactions or directly edit balances.

Settings → RAS Bolts adjustment records bonuses, penalties and corrections. Inventory corrections require reasons. Existing initial allocation corrections use signed INITIAL_BALANCE entries before start and before other financial history.

## Export, backup and restore

Reports → verify final balances/holdings → Excel → required CSV datasets → Print/Save PDF → Settings → Backup database. Excel includes teams, purchases, trades, Bolt ledger, inventory, team inventory, Mitras, audit, timer summary and configuration. Reports are provisional until end. Keep a final native backup separately.

Restore: stop operators, choose native SQLite backup, type **RESTORE DATABASE**. Schema/integrity/ledger chains are validated before replacement; a pre-restore backup is automatic. Both operator/team sessions expire. Sign in with the backup's credentials. Corrupt files are rejected without replacing live data. See README for older backups and damaged-database recovery. Never overwrite running SQLite files.

## Arithmetic note

Project costs: Obstacle 520, Line 540, Light **480**, Bluetooth 570, Clap 500, Radar 620. Light uses 60 + 120 + 200 + 100 = **480**, leaving **520**. The planning subtotal 380 and market count 43 were incorrect; software uses actual prices and quantities.

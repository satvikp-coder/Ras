# Competition-day quick guide

**Robots of the Backstreet · 7 October · 3:00–4:30 PM · RAS Bolts · Mentor Mitra**

## Start the system

Open a terminal in the project folder: `npm start`. Open http://127.0.0.1:3000 and sign in. If already built, `npm run serve` starts faster. On a fresh database, the admin password appears once in the terminal. Save it securely.

## Pre-event checks

- Real database selected; no DEMO banner.
- Settings: actual duration, initial RAS Bolts, rules, confirmation boxes and negative-balance/stock settings verified.
- Teams/members/projects and Mentor Mitras/assignments verified.
- Actual component prices and quantities verified. Review team balances against initial ledger entries.
- Operator roles verified. Download a backup and copy it to USB.
- Computer on reliable power, automatic sleep disabled, clock correct. Keep clock unchanged during competition.

## Start / pause / resume timer

Admin: Dashboard → Start competition at actual start. Pause / Resume buttons or **Space** when focus is outside controls. Pausing blocks purchases and trades. Refresh or server restart preserves timer state; an active timer keeps counting during server downtime. Warnings appear at 30, 10, 5 and 1 minutes.

## Record a purchase

**P** or New purchase → search/select team → search/select component → quantity → Review purchase → verify team, item, price, total and projected balance → Confirm purchase. A completed transaction updates RAS Bolts, shop stock and team inventory together. An error saves nothing. Retry an uncertain submission in the same confirmation screen; do not create a new purchase until checking history.

## Record a trade

**T** or New trade → choose different teams → add each team's outgoing items and optional RAS Bolts → Review trade → check both projected balances and holdings → Confirm trade. Teams must own outgoing items. All legs commit together. Rule switches control permissible combinations.

## View balance / inventory

Dashboard team lookup or Teams → click Team ID. Profile contains current RAS Bolts, initial allocation, spending, Mentor Mitra, members, project and tabs for purchases/trades/ledger/holdings/audit. Global Search locates members, projects and transaction references.

## Correct a mistake

Admin: Purchases / Trades / Ledger → click reference → Void transaction → enter reason → Confirm void. Original remains marked VOIDED; reversal appears in the ledger. If an item has been traded onward or a receipt spent, reverse dependent transactions first. Reverse active refunds before voiding their purchase. For a replacement purchase/trade, open the VOIDED original and select Create linked replacement.

Optional refunds: enable Allow purchase refunds in Settings, then open a completed purchase → Refund items → returned quantity and reason. Team holdings must contain returned items. RAS Bolts are refunded at the original purchase price.

Bonuses/penalties or other corrections: Settings → RAS Bolts adjustment → signed amount and required reason. Never attempt direct balance editing. Inventory corrections use Inventory adjustment and a reason.

## End / export / backup

The timer's zero locks normal transactions. Admin may end early with an explicit END COMPETITION confirmation. Reports → inspect final results → Export Excel → select and export CSV datasets if needed → Print / Save PDF → Settings → Backup database → copy backup away from event computer.

Admin post-event transactions require explicit post-event editing in Settings. Disable that switch after reconciliation and take another final backup.

## Emergency restore

1. Stop operators; preserve current files. If server works: Admin → Settings → choose SQLite backup → type **RESTORE DATABASE** → Validate and restore.
2. A pre-restore backup is created automatically in `data/backups/`. Restore validates schema and ledgers before replacement.
3. Sign in again using credentials contained in the restored backup. Check teams, balances, holdings and timer. An active timer still follows its timestamps.
4. If server cannot open a damaged database: stop it; move **all** `competition.sqlite`, `competition.sqlite-wal` and `competition.sqlite-shm` files that exist into a separate, clearly named recovery folder. Keep them. Start a fresh database, save its printed admin password, sign in and use the restore UI with a valid backup. Do not manually overwrite a running database.

Never delete event data during a rushed recovery. Never use the demo reset for real data. Contact the committee's technical operator with [README troubleshooting](../README.md), not a dependency on the original developer.

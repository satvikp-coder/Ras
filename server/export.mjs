import ExcelJS from "exceljs";
import {
  teams,
  mitras,
  components,
  history,
  auditRows,
  summary,
} from "./queries.mjs";
const time = (value) => (value ? new Date(value).toISOString() : "");
export function exportData(store) {
  return store.atomic(() => {
    const teamRows = teams(store),
      items = components(store),
      stats = summary(store);
    const purchases = history(store, "purchases", {}, true).rows;
    const refunds = store.all(
      "SELECT r.*,p.team_id,p.component_id,p.component_name,t.ref,t.created_at,t.status,t.notes,o.name operator FROM refunds r JOIN purchases p ON p.id=r.purchase_id JOIN transactions t ON t.id=r.transaction_id JOIN operators o ON o.id=t.operator_id",
    );
    return {
      Teams: teamRows.map((t) => ({
        "Team ID": t.id,
        "Team Number": t.number,
        "Team Name": t.name,
        Members: t.members.map((m) => m.name).join("; "),
        Project: t.project,
        "Mentor Mitra": t.mitra ? `${t.mitra.id} — ${t.mitra.name}` : "",
        "Initial RAS Bolts": t.initial,
        "Current RAS Bolts": t.balance,
        "Total Spent": t.spent + t.trade_paid,
        "Total Received": t.received,
        "Total Trade Value (RAS Bolts)": t.total_trade_value,
        "Purchase Count": t.purchase_count,
        "Trade Count": t.trade_count,
        "Created At": t.created_at,
        "Updated At": t.updated_at,
        Status: t.status,
        Notes: t.notes,
      })),
      Purchases: purchases.map((p) => ({
        "Purchase ID": p.ref,
        "Transaction ID": p.transaction_ref,
        Timestamp: p.created_at,
        "Team ID": p.team_id,
        "Team Name": p.team_name,
        "Component ID": p.component_id,
        Component: p.component_name,
        Quantity: p.quantity,
        "Returned Quantity": p.refunded_quantity,
        "Quantity Kept": p.net_quantity,
        "Refunded RAS Bolts": p.refunded_total,
        "Net RAS Bolts": p.net_total,
        "Unit Price (RAS Bolts)": p.unit_price,
        "Total (RAS Bolts)": p.total,
        "Previous Balance": p.balance_before,
        "New Balance": p.balance_after,
        Operator: p.operator,
        Status: p.status,
        Notes: p.notes,
        "Competition Elapsed ms": p.elapsed_ms,
        "Competition Remaining ms": p.remaining_ms,
      })),
      Trades: history(store, "trades", {}, true).rows.map((t) => {
        const desc = (from) =>
          t.items
            .filter((i) => i.from_team === from)
            .map((i) => `${i.quantity} × ${i.component_name}`)
            .join("; ");
        return {
          "Trade ID": t.ref,
          "Transaction ID": t.transaction_ref,
          Timestamp: t.created_at,
          "Team A": t.team_a,
          "Team B": t.team_b,
          "Items Given by A": desc(t.team_a),
          "Items Received by A": desc(t.team_b),
          "RAS Bolts Given by A": t.bolts_a,
          "RAS Bolts Received by A": t.bolts_b,
          "Items Given by B": desc(t.team_b),
          "Items Received by B": desc(t.team_a),
          "RAS Bolts Given by B": t.bolts_b,
          "RAS Bolts Received by B": t.bolts_a,
          Operator: t.operator,
          Status: t.status,
          Notes: t.notes,
          "Competition Elapsed ms": t.elapsed_ms,
          "Competition Remaining ms": t.remaining_ms,
        };
      }),
      "RAS Bolt Ledger": history(store, "ledger", {}, true)
        .rows.sort((a, b) => a.id - b.id)
        .map((l) => ({
          "Ledger ID": l.id,
          "Transaction ID": l.transaction_ref,
          Timestamp: l.created_at,
          Team: l.team_id,
          "Transaction Type": l.type,
          Debit: Math.max(0, -l.amount),
          Credit: Math.max(0, l.amount),
          "Balance Before": l.balance_before,
          "Balance After": l.balance_after,
          Operator: l.operator,
          Reference: l.transaction_ref,
          Status: l.status,
          Notes: l.notes,
          "Reversal Of": l.reversal_of ?? "",
          "Correction Of": l.correction_of ?? "",
        })),
      Inventory: items.map((c) => {
        const purchased = purchases
          .filter((p) => p.component_id === c.id && p.status === "COMPLETED")
          .reduce((n, p) => n + p.quantity, 0);
        const returned = refunds
          .filter((r) => r.component_id === c.id && r.status === "COMPLETED")
          .reduce((n, r) => n + r.quantity, 0);
        return {
          "Component ID": c.id,
          Component: c.name,
          Category: c.category,
          "Initial Quantity": c.initial_quantity,
          "Purchased Quantity": purchased - returned,
          "Refunded Quantity": returned,
          "Traded Quantity": c.traded_quantity,
          Adjustments: c.stock - c.initial_quantity + purchased - returned,
          "Remaining Quantity": c.stock,
          "Unit Price (RAS Bolts)": c.price,
        };
      }),
      "Team Inventory": teamRows.flatMap((t) =>
        t.inventory.map((i) => ({
          Team: t.id,
          "Team Name": t.name,
          "Component ID": i.id,
          Component: i.name,
          Quantity: i.quantity,
        })),
      ),
      Refunds: refunds.map((r) => ({
        "Transaction ID": r.ref,
        "Purchase ID": r.purchase_id,
        Timestamp: r.created_at,
        Team: r.team_id,
        Component: r.component_name,
        Quantity: r.quantity,
        "Returned RAS Bolts": r.total,
        Operator: r.operator,
        Status: r.status,
        Reason: r.notes,
      })),
      Mitras: mitras(store).map((m) => ({
        "Mitra ID": m.id,
        "Mitra Name": m.name,
        "Assigned Teams": m.teams.map((t) => t.id).join("; "),
        Contact: m.contact,
        Status: m.status,
        Notes: m.notes,
      })),
      "Audit Log": auditRows(store, {}, true).rows.map((a) => ({
        "Audit ID": a.ref,
        Timestamp: a.created_at,
        Operator: a.operator,
        Action: a.action,
        Entity: a.entity_type,
        "Entity ID": a.entity_id,
        "Old Value": a.old_value ?? "",
        "New Value": a.new_value ?? "",
        Reason: a.reason,
      })),
      "Inventory Movements": history(store, "movements", {}, true)
        .rows.sort((a, b) => a.id - b.id)
        .map((m) => ({
          "Movement ID": m.id,
          "Transaction ID": m.transaction_ref,
          Timestamp: m.created_at,
          "Component ID": m.component_id,
          Component: m.component,
          Owner: m.team_id ?? "SHOP",
          Quantity: m.quantity,
          Before: m.quantity_before,
          After: m.quantity_after,
          Operator: m.operator,
          Status: m.status,
          Notes: m.notes,
        })),
      "Event Summary": [
        {
          Event: store.config().eventName,
          "Event Date": store.config().eventDate,
          "Export Timestamp": time(Date.now()),
          "Total Teams": stats.teams,
          "Total Mitras": stats.mitras,
          "Total Purchases": stats.purchases,
          "Total Trades": stats.trades,
          "Total RAS Bolts Held": stats.held,
          "Total RAS Bolts Spent": stats.spent,
          "Total RAS Bolts Transferred": stats.transferred,
          "Inventory Remaining": stats.inventory,
          "Competition Actual Start": time(stats.timer.started_at),
          "Competition Actual End": time(stats.timer.ended_at),
          "Timer State": stats.timer.state,
        },
      ],
      "Final Team Report": teamRows.map((t) => ({
        Team: t.id,
        "Team Name": t.name,
        "Mentor Mitra": t.mitra?.name ?? "",
        "Initial RAS Bolts": t.initial,
        "Purchase Spending": t.spent,
        "Trade Payments": t.trade_paid,
        "Trade Receipts": t.trade_received,
        "Net Adjustments":
          t.balance - t.initial + t.spent + t.trade_paid - t.trade_received,
        "Final Balance": t.balance,
      })),
      Configuration: Object.entries(store.config()).map(([key, value]) => ({
        Setting: key,
        Value: String(value),
      })),
    };
  });
}
const headers = {
  Teams: [
    "Team ID",
    "Team Number",
    "Team Name",
    "Members",
    "Project",
    "Mentor Mitra",
    "Initial RAS Bolts",
    "Current RAS Bolts",
    "Total Spent",
    "Total Received",
    "Total Trade Value (RAS Bolts)",
    "Purchase Count",
    "Trade Count",
    "Created At",
    "Updated At",
    "Status",
    "Notes",
  ],
  Purchases: [
    "Purchase ID",
    "Transaction ID",
    "Timestamp",
    "Team ID",
    "Team Name",
    "Component ID",
    "Component",
    "Quantity",
    "Returned Quantity",
    "Quantity Kept",
    "Refunded RAS Bolts",
    "Net RAS Bolts",
    "Unit Price (RAS Bolts)",
    "Total (RAS Bolts)",
    "Previous Balance",
    "New Balance",
    "Operator",
    "Status",
    "Notes",
    "Competition Elapsed ms",
    "Competition Remaining ms",
  ],
  Trades: [
    "Trade ID",
    "Transaction ID",
    "Timestamp",
    "Team A",
    "Team B",
    "Items Given by A",
    "Items Received by A",
    "RAS Bolts Given by A",
    "RAS Bolts Received by A",
    "Items Given by B",
    "Items Received by B",
    "RAS Bolts Given by B",
    "RAS Bolts Received by B",
    "Operator",
    "Status",
    "Notes",
    "Competition Elapsed ms",
    "Competition Remaining ms",
  ],
  "RAS Bolt Ledger": [
    "Ledger ID",
    "Transaction ID",
    "Timestamp",
    "Team",
    "Transaction Type",
    "Debit",
    "Credit",
    "Balance Before",
    "Balance After",
    "Operator",
    "Reference",
    "Status",
    "Notes",
    "Reversal Of",
    "Correction Of",
  ],
  Inventory: [
    "Component ID",
    "Component",
    "Category",
    "Initial Quantity",
    "Purchased Quantity",
    "Refunded Quantity",
    "Traded Quantity",
    "Adjustments",
    "Remaining Quantity",
    "Unit Price (RAS Bolts)",
  ],
  "Team Inventory": [
    "Team",
    "Team Name",
    "Component ID",
    "Component",
    "Quantity",
  ],
  Mitras: [
    "Mitra ID",
    "Mitra Name",
    "Assigned Teams",
    "Contact",
    "Status",
    "Notes",
  ],
  "Audit Log": [
    "Audit ID",
    "Timestamp",
    "Operator",
    "Action",
    "Entity",
    "Entity ID",
    "Old Value",
    "New Value",
    "Reason",
  ],
  "Inventory Movements": [
    "Movement ID",
    "Transaction ID",
    "Timestamp",
    "Component ID",
    "Component",
    "Owner",
    "Quantity",
    "Before",
    "After",
    "Operator",
    "Status",
    "Notes",
  ],
  "Final Team Report": [
    "Team",
    "Team Name",
    "Mentor Mitra",
    "Initial RAS Bolts",
    "Purchase Spending",
    "Trade Payments",
    "Trade Receipts",
    "Net Adjustments",
    "Final Balance",
  ],
  Refunds: [
    "Transaction ID",
    "Purchase ID",
    "Timestamp",
    "Team",
    "Component",
    "Quantity",
    "Returned RAS Bolts",
    "Operator",
    "Status",
    "Reason",
  ],
};
export async function workbook(store) {
  const data = exportData(store);
  const book = new ExcelJS.Workbook();
  book.creator = "RAS Control Center";
  book.created = new Date();
  for (const [name, rows] of Object.entries(data)) {
    const sheet = book.addWorksheet(name);
    const keys = rows.length
      ? Object.keys(rows[0])
      : (headers[name] ?? ["No records"]);
    sheet.columns = keys.map((key) => ({
      header: key,
      key,
      width: Math.min(48, Math.max(16, key.length + 3)),
    }));
    sheet.addRows(rows);
    sheet.views = [{ state: "frozen", ySplit: 1 }];
    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: Math.max(1, rows.length + 1), column: keys.length },
    };
    const header = sheet.getRow(1);
    header.font = { bold: true, color: { argb: "FFFFFFFF" } };
    header.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF173A4A" },
    };
    header.height = 26;
    sheet.eachRow((row) => {
      row.alignment = { vertical: "top", wrapText: true };
    });
  }
  return book.xlsx.writeBuffer();
}
function safeCell(value) {
  let text = String(value ?? "");
  if (
    typeof value === "string" &&
    (/^\s*[=+@\-]/.test(text) || /^[\t\r]/.test(text))
  )
    text = `'${text}`;
  return '"' + text.replaceAll('"', '""') + '"';
}
export function csv(store, sheet) {
  const data = exportData(store);
  if (!(sheet in data)) return null;
  const rows = data[sheet];
  const keys = rows.length
    ? Object.keys(rows[0])
    : (headers[sheet] ?? ["No records"]);
  return (
    "\uFEFF" +
    [
      keys.map(safeCell).join(","),
      ...rows.map((row) => keys.map((key) => safeCell(row[key])).join(",")),
    ].join("\r\n")
  );
}

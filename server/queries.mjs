import { AppError } from "./store.mjs";
function validateFilters(filters) {
  for (const [key, value] of Object.entries(filters))
    if (typeof value !== "string" || value.length > 1200)
      throw new AppError(`Invalid filter: ${key}`);
  for (const key of ["from", "to"])
    if (filters[key] && !Number.isFinite(Date.parse(filters[key])))
      throw new AppError(`Invalid ${key} date/time.`);
  for (const key of ["page", "operator"])
    if (
      filters[key] &&
      (!/^\d+$/.test(filters[key]) ||
        Number(filters[key]) < 1 ||
        Number(filters[key]) > 100000)
    )
      throw new AppError(`Invalid ${key}.`);
}
export function teams(store, search = "") {
  const term = `%${search}%`;
  return store
    .all(
      "SELECT DISTINCT t.id FROM teams t LEFT JOIN members m ON m.team_id=t.id LEFT JOIN assignments a ON a.team_id=t.id LEFT JOIN mitras r ON r.id=a.mitra_id WHERE t.id LIKE ? OR t.name LIKE ? OR t.project LIKE ? OR m.name LIKE ? OR r.name LIKE ? OR r.id LIKE ? ORDER BY t.id",
      term,
      term,
      term,
      term,
      term,
      term,
    )
    .map((r) => store.teamDetails(r.id));
}
export function mitras(store, search = "") {
  const term = `%${search}%`;
  return store
    .all(
      "SELECT * FROM mitras WHERE id LIKE ? OR name LIKE ? ORDER BY id",
      term,
      term,
    )
    .map((m) => ({
      ...m,
      teams: store
        .all(
          "SELECT t.id,t.name,t.project FROM teams t JOIN assignments a ON a.team_id=t.id WHERE a.mitra_id=? ORDER BY t.id",
          m.id,
        )
        .map((t) => ({ ...t, balance: store.balance(t.id) })),
    }));
}
export function components(store, search = "") {
  const term = `%${search}%`;
  return store
    .all(
      "SELECT * FROM components WHERE id LIKE ? OR name LIKE ? OR category LIKE ? ORDER BY name",
      term,
      term,
      term,
    )
    .map((c) => ({
      ...c,
      stock: store.stock(c.id),
      purchased_quantity: store.get(
        "SELECT COALESCE(SUM(p.quantity),0) n FROM purchases p JOIN transactions t ON t.id=p.transaction_id WHERE p.component_id=? AND t.status='COMPLETED'",
        c.id,
      ).n,
      refunded_quantity: store.get(
        "SELECT COALESCE(SUM(r.quantity),0) n FROM refunds r JOIN purchases p ON p.id=r.purchase_id JOIN transactions t ON t.id=r.transaction_id WHERE p.component_id=? AND t.status='COMPLETED'",
        c.id,
      ).n,
      traded_quantity: store.get(
        "SELECT COALESCE(SUM(i.quantity),0) n FROM trade_items i JOIN trades r ON r.id=i.trade_id JOIN transactions t ON t.id=r.transaction_id WHERE i.component_id=? AND t.status='COMPLETED'",
        c.id,
      ).n,
    }));
}
const sources = {
  purchases: {
    from: "purchases p JOIN transactions t ON t.id=p.transaction_id JOIN operators o ON o.id=t.operator_id",
    select:
      "p.*,t.ref transaction_ref,t.created_at,t.elapsed_ms,t.remaining_ms,t.status,t.notes,t.correction_of,o.name operator,o.id operator_id",
    search:
      "(p.ref LIKE ? OR t.ref LIKE ? OR p.team_name LIKE ? OR p.component_name LIKE ?)",
    team: "p.team_id=?",
    component: "p.component_id=?",
  },
  trades: {
    from: "trades r JOIN transactions t ON t.id=r.transaction_id JOIN operators o ON o.id=t.operator_id",
    select:
      "r.*,t.ref transaction_ref,t.created_at,t.elapsed_ms,t.remaining_ms,t.status,t.notes,t.correction_of,o.name operator,o.id operator_id",
    search:
      "(r.ref LIKE ? OR t.ref LIKE ? OR r.team_a LIKE ? OR r.team_b LIKE ?)",
    team: "(r.team_a=? OR r.team_b=?)",
    component:
      "EXISTS(SELECT 1 FROM trade_items i WHERE i.trade_id=r.id AND i.component_id=?)",
  },
  ledger: {
    from: "bolt_ledger l JOIN transactions t ON t.id=l.transaction_id JOIN operators o ON o.id=t.operator_id",
    select:
      "l.*,t.ref transaction_ref,t.created_at,t.status,t.notes,t.reversal_of,t.correction_of,o.name operator,o.id operator_id",
    search:
      "(t.ref LIKE ? OR l.team_id LIKE ? OR l.type LIKE ? OR t.notes LIKE ?)",
    team: "l.team_id=?",
    component:
      "EXISTS(SELECT 1 FROM inventory_movements m WHERE m.transaction_id=t.id AND m.component_id=?)",
  },
  movements: {
    from: "inventory_movements m JOIN transactions t ON t.id=m.transaction_id JOIN operators o ON o.id=t.operator_id JOIN components c ON c.id=m.component_id",
    select:
      "m.*,c.name component,t.ref transaction_ref,t.created_at,t.status,t.notes,o.name operator,o.id operator_id",
    search:
      "(t.ref LIKE ? OR m.team_id LIKE ? OR c.name LIKE ? OR t.notes LIKE ?)",
    team: "m.team_id=?",
    component: "m.component_id=?",
  },
  transactions: {
    from: "transactions t JOIN operators o ON o.id=t.operator_id",
    select: "t.*,o.name operator",
    search:
      "(t.ref LIKE ? OR t.kind LIKE ? OR t.notes LIKE ? OR o.name LIKE ?)",
    team: "(EXISTS(SELECT 1 FROM bolt_ledger l WHERE l.transaction_id=t.id AND l.team_id=?) OR EXISTS(SELECT 1 FROM inventory_movements m WHERE m.transaction_id=t.id AND m.team_id=?))",
    component:
      "EXISTS(SELECT 1 FROM inventory_movements m WHERE m.transaction_id=t.id AND m.component_id=?)",
  },
};
export function history(store, kind, filters = {}, unlimited = false) {
  validateFilters(filters);
  const spec = sources[kind];
  if (!spec) throw new Error("Unknown history type");
  const clauses = [],
    args = [];
  if (filters.search) {
    clauses.push(spec.search);
    for (let i = 0; i < 4; i++) args.push(`%${filters.search}%`);
  }
  if (filters.team) {
    clauses.push(spec.team);
    args.push(filters.team);
    if (kind === "trades" || kind === "transactions") args.push(filters.team);
  }
  if (filters.mitra) {
    clauses.push(
      "EXISTS(SELECT 1 FROM assignments a WHERE a.mitra_id=? AND " +
        (kind === "trades"
          ? "(a.team_id=r.team_a OR a.team_id=r.team_b)"
          : kind === "purchases"
            ? "a.team_id=p.team_id"
            : kind === "ledger"
              ? "a.team_id=l.team_id"
              : kind === "movements"
                ? "a.team_id=m.team_id"
                : "EXISTS(SELECT 1 FROM bolt_ledger l WHERE l.transaction_id=t.id AND l.team_id=a.team_id)") +
        ")",
    );
    args.push(filters.mitra);
  }
  if (filters.component) {
    clauses.push(spec.component);
    args.push(filters.component);
  }
  if (filters.status) {
    clauses.push("t.status=?");
    args.push(filters.status);
  }
  if (filters.operator) {
    clauses.push("t.operator_id=?");
    args.push(Number(filters.operator));
  }
  if (filters.type) {
    clauses.push(kind === "ledger" ? "l.type=?" : "t.kind=?");
    args.push(filters.type);
  }
  if (filters.from) {
    clauses.push("t.created_at>=?");
    args.push(new Date(filters.from).toISOString());
  }
  if (filters.to) {
    clauses.push("t.created_at<=?");
    args.push(new Date(filters.to).toISOString());
  }
  const where = clauses.length ? " WHERE " + clauses.join(" AND ") : "";
  const count = store.get(
    `SELECT COUNT(*) total FROM ${spec.from}${where}`,
    ...args,
  ).total;
  const page = Math.max(1, Math.min(100000, Number(filters.page) || 1));
  const limit = 100;
  const rows = store.all(
    `SELECT ${spec.select} FROM ${spec.from}${where} ORDER BY t.id DESC${kind === "ledger" ? ",l.id DESC" : kind === "movements" ? ",m.id DESC" : ""}${unlimited ? "" : " LIMIT ? OFFSET ?"}`,
    ...args,
    ...(unlimited ? [] : [limit, (page - 1) * limit]),
  );
  if (kind === "trades")
    for (const row of rows)
      row.items = store.all(
        "SELECT * FROM trade_items WHERE trade_id=?",
        row.id,
      );
  return { rows, total: count, page, pageSize: limit };
}
export function auditRows(store, filters = {}, unlimited = false) {
  validateFilters(filters);
  const args = [],
    where = [];
  if (filters.search) {
    where.push(
      "(a.ref LIKE ? OR a.entity_id LIKE ? OR a.action LIKE ? OR a.reason LIKE ?)",
    );
    for (let i = 0; i < 4; i++) args.push(`%${filters.search}%`);
  }
  if (filters.team) {
    where.push(
      "((a.entity_type='team' AND a.entity_id=?) OR (a.entity_type='transaction' AND EXISTS(SELECT 1 FROM transactions t WHERE t.ref=a.entity_id AND (EXISTS(SELECT 1 FROM bolt_ledger l WHERE l.transaction_id=t.id AND l.team_id=?) OR EXISTS(SELECT 1 FROM inventory_movements m WHERE m.transaction_id=t.id AND m.team_id=?)))))",
    );
    args.push(filters.team, filters.team, filters.team);
  }
  if (filters.operator) {
    where.push("a.operator_id=?");
    args.push(Number(filters.operator));
  }
  for (const key of ["from", "to"])
    if (filters[key]) {
      where.push(`a.created_at${key === "from" ? ">=" : "<="}?`);
      args.push(new Date(filters[key]).toISOString());
    }
  const condition = where.length ? " WHERE " + where.join(" AND ") : "";
  const total = store.get(
    `SELECT COUNT(*) total FROM audit a${condition}`,
    ...args,
  ).total;
  const page = Math.max(1, Number(filters.page) || 1);
  return {
    rows: store.all(
      `SELECT a.*,o.name operator FROM audit a JOIN operators o ON o.id=a.operator_id${condition} ORDER BY a.id DESC${unlimited ? "" : " LIMIT 100 OFFSET ?"}`,
      ...args,
      ...(unlimited ? [] : [(page - 1) * 100]),
    ),
    total,
    page,
    pageSize: 100,
  };
}
export function summary(store) {
  return {
    teams: store.get("SELECT COUNT(*) n FROM teams").n,
    activeTeams: store.get("SELECT COUNT(*) n FROM teams WHERE status='Active'")
      .n,
    mitras: store.get("SELECT COUNT(*) n FROM mitras").n,
    purchases: store.get(
      "SELECT COUNT(*) n FROM purchases p JOIN transactions t ON t.id=p.transaction_id WHERE t.status='COMPLETED'",
    ).n,
    trades: store.get(
      "SELECT COUNT(*) n FROM trades r JOIN transactions t ON t.id=r.transaction_id WHERE t.status='COMPLETED'",
    ).n,
    held: store.get("SELECT COALESCE(SUM(amount),0) n FROM bolt_ledger").n,
    spent: store.get(
      "SELECT COALESCE(SUM(-l.amount),0) n FROM bolt_ledger l JOIN transactions t ON t.id=l.transaction_id WHERE l.type IN ('PURCHASE','REFUND') AND t.status='COMPLETED'",
    ).n,
    transferred: store.get(
      "SELECT COALESCE(SUM(r.bolts_a+r.bolts_b),0) n FROM trades r JOIN transactions t ON t.id=r.transaction_id WHERE t.status='COMPLETED'",
    ).n,
    sold: store.get(
      "SELECT COALESCE(SUM(p.quantity),0) n FROM purchases p JOIN transactions t ON t.id=p.transaction_id WHERE t.status='COMPLETED'",
    ).n,
    inventory: store.get(
      "SELECT COALESCE(SUM(quantity),0) n FROM inventory_movements WHERE team_id IS NULL",
    ).n,
    timer: store.timer(),
    popular: store.all(
      "SELECT p.component_id,p.component_name,SUM(p.quantity) quantity FROM purchases p JOIN transactions t ON t.id=p.transaction_id WHERE t.status='COMPLETED' GROUP BY p.component_id ORDER BY quantity DESC LIMIT 10",
    ),
  };
}

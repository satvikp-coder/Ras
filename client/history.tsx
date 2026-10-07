import { useEffect, useState } from "react";
import { api, type Bootstrap, type History, type Row } from "./api";
import { Table, Badge, time, type Column } from "./ui";
const common: Column[] = [
  { key: "created_at", label: "Timestamp", render: (r) => time(r.created_at) },
  { key: "operator", label: "Operator" },
  {
    key: "status",
    label: "Status",
    render: (r) => <Badge value={String(r.status)} />,
  },
];
const columns: Record<string, Column[]> = {
  purchases: [
    { key: "ref", label: "Purchase" },
    { key: "transaction_ref", label: "Transaction" },
    { key: "team_id", label: "Team" },
    { key: "component_name", label: "Component" },
    { key: "net_quantity", label: "Qty kept" },
    { key: "quantity", label: "Originally bought" },
    { key: "refunded_quantity", label: "Returned" },
    { key: "refunded_total", label: "Credit refunded" },
    { key: "net_total", label: "Net RAS Bolts" },
    ...common,
  ],
  trades: [
    { key: "ref", label: "Trade" },
    { key: "transaction_ref", label: "Transaction" },
    { key: "team_a", label: "Team A" },
    { key: "team_b", label: "Team B" },
    {
      key: "items",
      label: "Items",
      render: (r) =>
        (r.items as Row[])
          .map(
            (i) =>
              `${i.from_team} → ${i.to_team}: ${i.quantity} × ${i.component_name}`,
          )
          .join("; "),
    },
    { key: "bolts_a", label: "A gives RAS Bolts" },
    { key: "bolts_b", label: "B gives RAS Bolts" },
    ...common,
  ],
  ledger: [
    { key: "transaction_ref", label: "Transaction" },
    { key: "team_id", label: "Team" },
    {
      key: "type",
      label: "Type",
      render: (r) => <Badge value={String(r.type)} />,
    },
    { key: "amount", label: "Change (RAS Bolts)" },
    { key: "balance_before", label: "Before" },
    { key: "balance_after", label: "After" },
    ...common,
  ],
  movements: [
    { key: "transaction_ref", label: "Transaction" },
    {
      key: "team_id",
      label: "Owner",
      render: (r) => String(r.team_id ?? "SHOP"),
    },
    { key: "component", label: "Component" },
    { key: "quantity", label: "Change" },
    { key: "quantity_before", label: "Before" },
    { key: "quantity_after", label: "After" },
    ...common,
  ],
  transactions: [
    { key: "ref", label: "Transaction" },
    {
      key: "kind",
      label: "Type",
      render: (r) => <Badge value={String(r.kind)} />,
    },
    { key: "notes", label: "Reason / notes" },
    ...common,
  ],
  audit: [
    { key: "ref", label: "Audit ID" },
    {
      key: "created_at",
      label: "Timestamp",
      render: (r) => time(r.created_at),
    },
    { key: "operator", label: "Operator" },
    { key: "action", label: "Action" },
    { key: "entity_type", label: "Entity" },
    { key: "entity_id", label: "Reference" },
    { key: "reason", label: "Reason" },
    { key: "old_value", label: "Before" },
    { key: "new_value", label: "After" },
  ],
};
export function HistoryView({
  kind,
  data,
  refresh,
  onTransaction,
  team = "",
  component = "",
}: {
  kind: string;
  data: Bootstrap;
  refresh: number;
  onTransaction: (id: number) => void;
  team?: string;
  component?: string;
}) {
  const [filters, setFilters] = useState<Record<string, string>>({
      team,
      component,
    }),
    [result, setResult] = useState<History | null>(null),
    [error, setError] = useState(""),
    [page, setPage] = useState(1),
    [loading, setLoading] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    const handle = setTimeout(() => {
      setLoading(true);
      setError("");
      api<History>(
        `/${kind}?${new URLSearchParams({ ...filters, page: String(page) })}`,
      )
        .then((value) => {
          if (!controller.signal.aborted) setResult(value);
        })
        .catch((e) => {
          if (!controller.signal.aborted) setError(e.message);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 200);
    return () => {
      controller.abort();
      clearTimeout(handle);
    };
  }, [kind, filters, page, refresh]);
  function filter(key: string, value: string) {
    setFilters({ ...filters, [key]: value });
    setPage(1);
  }
  return (
    <>
      <div className="filters">
        <label>
          Search
          <input
            value={filters.search ?? ""}
            placeholder="ID, name, reason…"
            onChange={(e) => filter("search", e.target.value)}
          />
        </label>
        {!team && (
          <label>
            Team
            <select
              value={filters.team ?? ""}
              onChange={(e) => filter("team", e.target.value)}
            >
              <option value="">All teams</option>
              {data.teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.id} — {t.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {kind !== "audit" && (
          <>
            <label>
              Status
              <select
                value={filters.status ?? ""}
                onChange={(e) => filter("status", e.target.value)}
              >
                <option value="">All statuses</option>
                {["COMPLETED", "VOIDED", "CORRECTED", "PENDING"].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
            <label>
              Mentor Mitra
              <select
                value={filters.mitra ?? ""}
                onChange={(e) => filter("mitra", e.target.value)}
              >
                <option value="">All Mitras</option>
                {data.mitras.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
            {!component && (
              <label>
                Component
                <select
                  value={filters.component ?? ""}
                  onChange={(e) => filter("component", e.target.value)}
                >
                  <option value="">All components</option>
                  {data.components.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {["ledger", "transactions"].includes(kind) && (
              <label>
                Type
                <select
                  value={filters.type ?? ""}
                  onChange={(e) => filter("type", e.target.value)}
                >
                  <option value="">All types</option>
                  {[
                    "INITIAL_BALANCE",
                    "PURCHASE",
                    "TRADE",
                    "TRADE_PAYMENT",
                    "TRADE_RECEIPT",
                    "BONUS",
                    "PENALTY",
                    "MANUAL_ADJUSTMENT",
                    "REFUND",
                    "CORRECTION",
                    "INVENTORY_ADJUSTMENT",
                  ].map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </label>
            )}
          </>
        )}
        <label>
          Operator
          <select
            value={filters.operator ?? ""}
            onChange={(e) => filter("operator", e.target.value)}
          >
            <option value="">All operators</option>
            {data.operators.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          From
          <input
            type="datetime-local"
            value={filters.from ?? ""}
            onChange={(e) => filter("from", e.target.value)}
          />
        </label>
        <label>
          Until
          <input
            type="datetime-local"
            value={filters.to ?? ""}
            onChange={(e) => filter("to", e.target.value)}
          />
        </label>
        <button
          className="secondary"
          onClick={() => {
            setFilters({ team, component });
            setPage(1);
          }}
        >
          Clear filters
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {loading && (
        <p className="subtle" role="status">
          Loading history…
        </p>
      )}
      {result && (
        <>
          <Table
            rows={result.rows}
            columns={columns[kind]}
            onRow={
              kind === "audit"
                ? undefined
                : (r) =>
                    onTransaction(
                      Number(kind === "transactions" ? r.id : r.transaction_id),
                    )
            }
          />
          <div className="pagination">
            <span>
              {result.total} records · page {page}
            </span>
            <button
              className="secondary"
              disabled={page === 1}
              onClick={() => setPage(page - 1)}
            >
              Previous
            </button>
            <button
              className="secondary"
              disabled={page * 100 >= result.total}
              onClick={() => setPage(page + 1)}
            >
              Next
            </button>
          </div>
        </>
      )}
    </>
  );
}

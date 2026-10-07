import type { Row } from "./api";
import { Table } from "./ui";

export function TransactionRecord({ record }: { record: Row }) {
  const purchase = record.purchase as Row | null;
  const trade = record.trade as Row | null;
  return (
    <>
      {purchase && (
        <section className="card">
          <h3>Purchase record — {String(purchase.ref)}</h3>
          <dl>
            <dt>Team</dt>
            <dd>
              {String(purchase.team_id)} — {String(purchase.team_name)}
            </dd>
            <dt>Component</dt>
            <dd>
              {String(purchase.component_id)} —{" "}
              {String(purchase.component_name)}
            </dd>
            <dt>Originally purchased quantity</dt>
            <dd>{String(purchase.quantity)}</dd>
            <dt>Returned quantity</dt>
            <dd>{String(purchase.refunded_quantity ?? 0)}</dd>
            <dt>Quantity kept after returns</dt>
            <dd>{String(purchase.net_quantity ?? purchase.quantity)}</dd>
            <dt>Refund credited</dt>
            <dd>{String(purchase.refunded_total ?? 0)} RAS Bolts</dd>
            <dt>Original unit price</dt>
            <dd>{String(purchase.unit_price)} RAS Bolts</dd>
            <dt>Original purchase total</dt>
            <dd>{String(purchase.total)} RAS Bolts</dd>
            <dt>Net purchase cost after returns</dt>
            <dd>{String(purchase.net_total ?? purchase.total)} RAS Bolts</dd>
            <dt>Original purchase balance before / after</dt>
            <dd>
              {String(purchase.balance_before)} /{" "}
              {String(purchase.balance_after)} RAS Bolts
            </dd>
            <dt>Current team balance</dt>
            <dd>{String(purchase.current_balance)} RAS Bolts</dd>
          </dl>
        </section>
      )}
      {trade && (
        <section className="card">
          <h3>Trade record — {String(trade.ref)}</h3>
          <div className="two-col">
            {["a", "b"].map((side) => {
              const other = side === "a" ? "b" : "a";
              const outgoing = (trade.items as Row[]).filter(
                (i) => i.from_team === trade[`team_${side}`],
              );
              const incoming = (trade.items as Row[]).filter(
                (i) => i.to_team === trade[`team_${side}`],
              );
              return (
                <section key={side}>
                  <h4>Team {String(trade[`team_${side}`])}</h4>
                  <p>Giving {String(trade[`bolts_${side}`])} RAS Bolts</p>
                  <Table
                    rows={outgoing}
                    columns={[
                      { key: "component_name", label: "Items given" },
                      { key: "quantity", label: "Quantity" },
                    ]}
                  />
                  <p>Receiving {String(trade[`bolts_${other}`])} RAS Bolts</p>
                  <Table
                    rows={incoming}
                    columns={[
                      { key: "component_name", label: "Items received" },
                      { key: "quantity", label: "Quantity" },
                    ]}
                  />
                </section>
              );
            })}
          </div>
        </section>
      )}
    </>
  );
}

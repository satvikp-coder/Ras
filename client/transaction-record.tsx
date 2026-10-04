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
            <dt>Quantity</dt>
            <dd>{String(purchase.quantity)}</dd>
            <dt>Original unit price</dt>
            <dd>{String(purchase.unit_price)} RAS Bolts</dd>
            <dt>Total</dt>
            <dd>{String(purchase.total)} RAS Bolts</dd>
            <dt>Balance before / after</dt>
            <dd>
              {String(purchase.balance_before)} /{" "}
              {String(purchase.balance_after)} RAS Bolts
            </dd>
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

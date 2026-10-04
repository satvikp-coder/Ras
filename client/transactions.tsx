import { useState, type FormEvent } from "react";
import { api, type Bootstrap, type Row } from "./api";
import { TeamSelect, Badge } from "./ui";
interface Item {
  componentId: string;
  quantity: number;
}
function TradeItems({
  items,
  setItems,
  owner,
  data,
}: {
  items: Item[];
  setItems: (items: Item[]) => void;
  owner: string;
  data: Bootstrap;
}) {
  const holdings = data.teams.find((t) => t.id === owner)?.inventory ?? [];
  return (
    <div className="item-lines">
      {items.map((item, index) => (
        <div className="item-line" key={index}>
          <select
            aria-label="Outgoing item"
            required
            value={item.componentId}
            onChange={(e) =>
              setItems(
                items.map((v, i) =>
                  i === index ? { ...v, componentId: e.target.value } : v,
                ),
              )
            }
          >
            <option value="">Choose owned item</option>
            {holdings.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name} · owns {h.quantity}
              </option>
            ))}
          </select>
          <input
            aria-label="Item quantity"
            type="number"
            min={1}
            step={1}
            value={item.quantity}
            onChange={(e) =>
              setItems(
                items.map((v, i) =>
                  i === index ? { ...v, quantity: Number(e.target.value) } : v,
                ),
              )
            }
          />
          <button
            className="quiet"
            type="button"
            aria-label="Remove item"
            onClick={() => setItems(items.filter((_, i) => i !== index))}
          >
            ×
          </button>
        </div>
      ))}
      <button
        className="secondary"
        type="button"
        disabled={!owner}
        onClick={() => setItems([...items, { componentId: "", quantity: 1 }])}
      >
        + Add outgoing item
      </button>
    </div>
  );
}
export function TransactionForm({
  kind,
  data,
  onDone,
  onCancel,
  correctionOf,
}: {
  kind: "purchase" | "trade";
  data: Bootstrap;
  onDone: (result: Row) => void;
  onCancel: () => void;
  correctionOf?: number;
}) {
  const [a, setA] = useState(""),
    [b, setB] = useState(""),
    [component, setComponent] = useState(""),
    [search, setSearch] = useState("");
  const [quantity, setQuantity] = useState(1),
    [boltsA, setBoltsA] = useState(0),
    [boltsB, setBoltsB] = useState(0);
  const [itemsA, setItemsA] = useState<Item[]>([]),
    [itemsB, setItemsB] = useState<Item[]>([]);
  const [notes, setNotes] = useState("");
  const [pending, setPending] = useState<Row | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const teamA = data.teams.find((t) => t.id === a),
    teamB = data.teams.find((t) => t.id === b),
    item = data.components.find((c) => c.id === component);
  const total = (item?.price ?? 0) * quantity;
  function review(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (kind === "trade" && a === b) {
      setError("Choose two different teams.");
      return;
    }
    setPending(
      kind === "purchase"
        ? {
            teamId: a,
            componentId: component,
            quantity,
            expectedPrice: item?.price,
            notes,
            requestKey: crypto.randomUUID(),
            ...(correctionOf ? { correctionOf } : {}),
          }
        : {
            teamA: a,
            teamB: b,
            boltsA,
            boltsB,
            itemsA,
            itemsB,
            notes,
            requestKey: crypto.randomUUID(),
            ...(correctionOf ? { correctionOf } : {}),
          },
    );
  }
  async function confirm() {
    if (!pending || busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await api<Row>(
        kind === "purchase" ? "/purchases" : "/trades",
        "POST",
        pending,
      );
      onDone(result);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const list = (items: Item[], amount: number) => (
    <ul>
      {items.map((i, index) => (
        <li key={index}>
          {i.quantity} ×{" "}
          {data.components.find((c) => c.id === i.componentId)?.name}
        </li>
      ))}
      {amount > 0 && <li>{amount} RAS Bolts</li>}
      {!items.length && !amount && <li>Nothing</li>}
    </ul>
  );
  return (
    <>
      {correctionOf && (
        <p className="notice">
          Replacement linked to original transaction #{correctionOf}. The
          original and reversal remain in history.
        </p>
      )}
      <Badge value={data.timer.state} />
      {pending ? (
        <div className="confirmation">
          <h3>Review before committing</h3>
          {kind === "purchase" ? (
            <>
              <dl>
                <dt>Team</dt>
                <dd>
                  {a} — {teamA?.name}
                </dd>
                <dt>Component</dt>
                <dd>{item?.name}</dd>
                <dt>Quantity × unit price</dt>
                <dd>
                  {quantity} × {item?.price} RAS Bolts
                </dd>
                <dt>Total</dt>
                <dd className="big">{total} RAS Bolts</dd>
                <dt>Current balance</dt>
                <dd>{teamA?.balance} RAS Bolts</dd>
                <dt>Balance after purchase</dt>
                <dd>{(teamA?.balance ?? 0) - total} RAS Bolts</dd>
                <dt>Shop inventory after</dt>
                <dd>{(item?.stock ?? 0) - quantity}</dd>
              </dl>
            </>
          ) : (
            <>
              <div className="two-col">
                {[
                  [teamA, itemsA, boltsA, itemsB, boltsB],
                  [teamB, itemsB, boltsB, itemsA, boltsA],
                ].map((entry, index) => {
                  const team = index === 0 ? teamA : teamB;
                  return (
                    <section key={index}>
                      <h3>
                        {team?.id} — {team?.name}
                      </h3>
                      <strong>Giving</strong>
                      {list(entry[1] as Item[], entry[2] as number)}
                      <strong>Receiving</strong>
                      {list(entry[3] as Item[], entry[4] as number)}
                      <p className="balance">
                        After:{" "}
                        {(team?.balance ?? 0) -
                          (entry[2] as number) +
                          (entry[4] as number)}{" "}
                        RAS Bolts
                      </p>
                      <h4>Projected inventory</h4>
                      {Array.from(
                        new Set([
                          ...(team?.inventory.map((i) => i.id) ?? []),
                          ...itemsA.map((i) => i.componentId),
                          ...itemsB.map((i) => i.componentId),
                        ]),
                      ).map((id) => {
                        const out = (index === 0 ? itemsA : itemsB)
                            .filter((i) => i.componentId === id)
                            .reduce((n, i) => n + i.quantity, 0),
                          incoming = (index === 0 ? itemsB : itemsA)
                            .filter((i) => i.componentId === id)
                            .reduce((n, i) => n + i.quantity, 0);
                        return (
                          <p key={id}>
                            {data.components.find((c) => c.id === id)?.name}:{" "}
                            {(team?.inventory.find((i) => i.id === id)
                              ?.quantity ?? 0) -
                              out +
                              incoming}
                          </p>
                        );
                      })}
                    </section>
                  );
                })}
              </div>
            </>
          )}
          {notes && <p>Notes: {notes}</p>}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <footer>
            <button
              className="secondary"
              disabled={busy}
              onClick={() => setPending(null)}
            >
              Back
            </button>
            <button disabled={busy} onClick={confirm}>
              {busy ? "Committing…" : `Confirm ${kind}`}
            </button>
          </footer>
          <small>
            The server revalidates balances, rules and inventory at commit time.
          </small>
        </div>
      ) : (
        <form onSubmit={review}>
          <div className="two-col">
            <section>
              <TeamSelect
                label={kind === "purchase" ? "Purchasing team" : "Team A"}
                teams={data.teams.filter((t) => t.status === "Active")}
                value={a}
                onChange={(id) => {
                  setA(id);
                  setItemsA([]);
                }}
              />
              {kind === "trade" && (
                <>
                  <h3>Team A gives</h3>
                  <TradeItems
                    items={itemsA}
                    setItems={setItemsA}
                    owner={a}
                    data={data}
                  />
                  <label>
                    RAS Bolts
                    <input
                      type="number"
                      min={0}
                      step={1}
                      value={boltsA}
                      onChange={(e) => setBoltsA(Number(e.target.value))}
                    />
                  </label>
                </>
              )}
            </section>
            <section>
              {kind === "purchase" ? (
                <>
                  <label>
                    Search component
                    <input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Name, ID or category"
                    />
                  </label>
                  <label>
                    Component
                    <select
                      aria-label="Component"
                      required
                      value={component}
                      onChange={(e) => setComponent(e.target.value)}
                    >
                      <option value="">Choose component</option>
                      {data.components
                        .filter(
                          (c) =>
                            c.status === "Active" &&
                            (c.id === component ||
                              `${c.name} ${c.id} ${c.category}`
                                .toLowerCase()
                                .includes(search.toLowerCase())),
                        )
                        .map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name} · {c.price} RAS Bolts · stock {c.stock}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label>
                    Quantity
                    <input
                      type="number"
                      min={1}
                      step={1}
                      required
                      value={quantity}
                      onChange={(e) => setQuantity(Number(e.target.value))}
                    />
                  </label>
                  <p className="balance">Total: {total} RAS Bolts</p>
                  {item?.max_per_team && (
                    <small>Team purchase cap: {item.max_per_team}</small>
                  )}
                </>
              ) : (
                <>
                  <TeamSelect
                    label="Team B"
                    teams={data.teams.filter(
                      (t) => t.status === "Active" && t.id !== a,
                    )}
                    value={b}
                    onChange={(id) => {
                      setB(id);
                      setItemsB([]);
                    }}
                  />
                  <h3>Team B gives</h3>
                  <TradeItems
                    items={itemsB}
                    setItems={setItemsB}
                    owner={b}
                    data={data}
                  />
                  <label>
                    RAS Bolts
                    <input
                      type="number"
                      min={0}
                      step={1}
                      value={boltsB}
                      onChange={(e) => setBoltsB(Number(e.target.value))}
                    />
                  </label>
                </>
              )}
            </section>
          </div>
          <label>
            Notes{correctionOf ? " / correction reason" : ""}
            <textarea
              required={!!correctionOf}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
            />
          </label>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <footer>
            <button className="secondary" type="button" onClick={onCancel}>
              Cancel
            </button>
            <button>Review {kind}</button>
          </footer>
        </form>
      )}
    </>
  );
}

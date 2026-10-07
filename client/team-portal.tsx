import { useEffect, useState } from "react";
import { api, type Row, type Timer } from "./api";
import { Table } from "./ui";

interface Portal {
  eventName: string;
  timer: Timer;
  team: {
    id: string;
    name: string;
    project: string;
    balance: number;
    members: { name: string }[];
    mitra: { name: string } | null;
    inventory: Row[];
  };
  ledger: Row[];
  movements: Row[];
}

export function TeamPortal({ onLogout }: { onLogout: () => void }) {
  const [data, setData] = useState<Portal | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const next = await api<Portal>("/team-portal");
        if (alive) {
          setData(next);
          setError("");
        }
      } catch (e) {
        if (alive) {
          setData(null);
          setError((e as Error).message);
        }
      }
    };
    void load();
    const timer = setInterval(load, 5000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);
  return (
    <main className="team-portal">
      <header className="section-heading">
        <div>
          <p className="eyebrow">TEAM DASHBOARD</p>
          <h1>{data?.team.name ?? "Your team"}</h1>
        </div>
        <button
          className="secondary"
          onClick={async () => {
            try {
              await api("/logout", "POST");
              onLogout();
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          Sign out
        </button>
      </header>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!data && !error && <p>Loading your team…</p>}
      {data && (
        <>
          <p>
            {data.eventName} · {data.team.id} ·{" "}
            {data.timer.state.replaceAll("_", " ")} ·{" "}
            {Math.floor(data.timer.remaining_ms / 60000)}:
            {String(Math.floor(data.timer.remaining_ms / 1000) % 60).padStart(
              2,
              "0",
            )}{" "}
            remaining
          </p>
          <section className="card">
            <h2>{data.team.balance} RAS Bolts</h2>
            <p>Project: {data.team.project || "Not assigned"}</p>
            <p>Mentor Mitra: {data.team.mitra?.name ?? "Not assigned"}</p>
            <p>
              Members:{" "}
              {data.team.members.map((m) => m.name).join(", ") || "Not added"}
            </p>
            <p className="subtle">
              Updates every five seconds. Contact the shop or trade operator to
              record transactions.
            </p>
          </section>
          <section className="card">
            <h2>Your inventory</h2>
            <Table
              rows={data.team.inventory}
              columns={[
                { key: "name", label: "Component" },
                { key: "quantity", label: "Quantity" },
              ]}
            />
          </section>
          <section className="card">
            <h2>Your RAS Bolt history</h2>
            <Table
              rows={data.ledger}
              columns={[
                { key: "ref", label: "Reference" },
                { key: "created_at", label: "Date" },
                { key: "type", label: "Type" },
                { key: "status", label: "Status" },
                { key: "amount", label: "Change" },
                { key: "balance_after", label: "Balance after" },
              ]}
            />
          </section>
          <section className="card">
            <h2>Your inventory history</h2>
            <Table
              rows={data.movements}
              columns={[
                { key: "ref", label: "Reference" },
                { key: "created_at", label: "Date" },
                { key: "name", label: "Component" },
                { key: "status", label: "Status" },
                { key: "quantity", label: "Change" },
                { key: "quantity_after", label: "Quantity after" },
              ]}
            />
          </section>
        </>
      )}
    </main>
  );
}

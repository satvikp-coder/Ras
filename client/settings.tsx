import { useState } from "react";
import { TeamAccounts } from "./team-accounts";
import { api, download, type Bootstrap, type Operator, type Row } from "./api";
import { EntityForm, Table, type Field } from "./ui";
export function CsvExport({ onError }: { onError: (error: string) => void }) {
  const [sheet, setSheet] = useState("Teams");
  return (
    <>
      <select
        aria-label="CSV dataset"
        value={sheet}
        onChange={(e) => setSheet(e.target.value)}
      >
        {[
          "Teams",
          "Purchases",
          "Trades",
          "RAS Bolt Ledger",
          "Inventory",
          "Team Inventory",
          "Mitras",
          "Audit Log",
          "Inventory Movements",
          "Event Summary",
          "Final Team Report",
          "Configuration",
          "Refunds",
        ].map((s) => (
          <option key={s}>{s}</option>
        ))}
      </select>
      <button
        className="secondary"
        onClick={() =>
          void download(`/export/csv?sheet=${encodeURIComponent(sheet)}`).catch(
            (e) => onError(e.message),
          )
        }
      >
        Export CSV
      </button>
    </>
  );
}
export function Settings({
  data,
  onSaved,
  onError,
  onOperator,
  onAdjustment,
  onReset,
}: {
  data: Bootstrap;
  onSaved: (message?: string) => Promise<void>;
  onError: (message: string) => void;
  onOperator: (operator?: Operator) => void;
  onAdjustment: () => void;
  onReset: () => void;
}) {
  const [backupMessage, setBackupMessage] = useState(""),
    [integrityMessage, setIntegrityMessage] = useState(""),
    [file, setFile] = useState<File | null>(null),
    [phrase, setPhrase] = useState(""),
    [restoring, setRestoring] = useState(false),
    [backupBusy, setBackupBusy] = useState(false);
  const configFields: Field[] = [
    { key: "organizer", label: "Organizer", required: true },
    { key: "venue", label: "Venue", required: true },
    { key: "participants", label: "Participants", type: "number", min: 1 },
    { key: "teamSize", label: "Members per team", type: "number", min: 1 },
    { key: "eventName", label: "Event name", required: true },
    { key: "eventDate", label: "Event date", type: "date", required: true },
    {
      key: "startTime",
      label: "Scheduled start time",
      type: "time",
      required: true,
    },
    {
      key: "endTime",
      label: "Scheduled end time",
      type: "time",
      required: true,
    },
    {
      key: "durationMinutes",
      label: "Duration (minutes)",
      type: "number",
      min: 1,
      required: true,
    },
    {
      key: "initialBolts",
      label: "Default initial RAS Bolts",
      type: "number",
      min: 0,
      required: true,
      help: "Applies to newly created teams. Existing allocations change only through ledger adjustments.",
    },
    {
      key: "teamLimit",
      label: "Team limit (blank = unlimited)",
      type: "number",
      min: 1,
    },
    {
      key: "maximumPurchaseQuantity",
      label: "Maximum quantity per purchase (blank = unlimited)",
      type: "number",
      min: 1,
    },
    ...(
      [
        [
          "allocationConfirmed",
          "Actual initial RAS Bolts allocation confirmed",
        ],
        ["rulesConfirmed", "Competition rules verified with organizers"],
        [
          "starterAllocationEnabled",
          "Automatically allocate free starter kit to each team",
        ],
        ["enforceProjectPurchases", "Enforce Project Component Purchase Rules"],
        ["allowBoltTransfer", "Allow team-to-team RAS Bolt transfer"],
        ["allowItemTrading", "Allow item trading"],
        ["allowItemForBolts", "Allow item-for-RAS Bolts"],
        ["allowItemForItem", "Allow item-for-item / item gifts"],
        ["allowMixedTrades", "Allow mixed bilateral trades"],
        ["allowRefunds", "Allow purchase refunds"],
        ["allowNegativeBalance", "Allow negative RAS Bolts balances"],
        ["allowNegativeStock", "Allow negative shop inventory"],
        ["postEventEditing", "Allow ADMIN transactions after event end"],
      ] as const
    ).map(([key, label]) => ({ key, label, type: "checkbox" }) as Field),
  ];
  return (
    <>
      <TeamAccounts teams={data.teams} />
      <section className="card">
        <h2>Event configuration & rules</h2>
        <p className="subtle">
          Currency is always RAS Bolts. Confirm unknown rules before starting.
          Scheduled times are informational; the timer begins when Admin presses
          Start.
        </p>
        <EntityForm
          key={JSON.stringify(data.config)}
          fields={configFields}
          initial={{ ...data.config }}
          onCancel={() => {}}
          onSave={async (v) => {
            await api("/event", "PUT", v);
            await onSaved("Event configuration saved.");
          }}
          label="Save configuration"
        />
      </section>
      <section className="card">
        <h2>Administration</h2>
        <div className="actions">
          <button className="secondary" onClick={onAdjustment}>
            RAS Bolts adjustment
          </button>
          <button className="danger" onClick={onReset}>
            Reset timer
          </button>
          <button
            className="secondary"
            onClick={async () => {
              try {
                const result = await api<Row>("/integrity");
                if (
                  result.integrity !== "ok" ||
                  [
                    "foreignKeys",
                    "ledgerErrors",
                    "inventoryErrors",
                    "negativeTeamInventory",
                    "negativeMarketInventory",
                    "negativeBalances",
                    "duplicateActiveComponents",
                  ].some((key) => (result[key] as unknown[]).length)
                )
                  throw new Error(
                    "Database integrity check reported an inconsistency. Stop transactions and inspect a backup.",
                  );
                setIntegrityMessage(
                  `Database integrity verified at ${new Date().toLocaleString()}.`,
                );
              } catch (e) {
                onError((e as Error).message);
              }
            }}
          >
            Check database integrity
          </button>
        </div>
        {integrityMessage && (
          <p className="success" role="status">
            {integrityMessage}
          </p>
        )}
        <p className="subtle">
          Voids are available through transaction details in Purchases, Trades
          or Ledger. Voiding a purchase returns all its items and RAS Bolts.
          Partial refunds can be recorded from a purchase transaction when
          enabled in rules.
        </p>
      </section>
      <section className="card">
        <div className="section-heading">
          <h2>Local operators</h2>
          <button onClick={() => onOperator()}>+ Add operator</button>
        </div>
        <Table
          rows={data.operators as unknown as Row[]}
          columns={[
            { key: "username", label: "Username" },
            { key: "name", label: "Name" },
            { key: "role", label: "Role" },
            {
              key: "active",
              label: "Active",
              render: (r) => (r.active ? "Yes" : "No"),
            },
          ]}
          onRow={(r) => onOperator(r as unknown as Operator)}
        />
      </section>
      <section className="card">
        <h2>Database backup & restoration</h2>
        <p>
          Create backups before the event, periodically during it, and after
          exporting. Backups contain operator password hashes and event data;
          keep them secure.
        </p>
        <button
          disabled={backupBusy}
          onClick={async () => {
            setBackupBusy(true);
            try {
              await download("/backup", "POST");
              setBackupMessage(
                `Backup created and downloaded at ${new Date().toLocaleString()}. A server copy is retained in the database directory's backups folder.`,
              );
            } catch (e) {
              onError((e as Error).message);
            } finally {
              setBackupBusy(false);
            }
          }}
        >
          {backupBusy ? "Creating backup…" : "Backup database"}
        </button>
        {backupMessage && <p className="success">{backupMessage}</p>}
        <hr />
        <h3>Restore a SQLite backup</h3>
        <p className="notice">
          Restoration replaces all current event data and operators with the
          backup. An automatic pre-restore backup is created first. All sessions
          expire; sign in with credentials from the restored backup.
        </p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!file || phrase !== "RESTORE DATABASE") return;
            setRestoring(true);
            const form = new FormData();
            form.append("backup", file);
            form.append("confirm", phrase);
            try {
              await api("/restore", "POST", form);
              window.location.reload();
            } catch (e) {
              onError((e as Error).message);
            } finally {
              setRestoring(false);
            }
          }}
        >
          <label>
            SQLite backup
            <input
              type="file"
              accept=".sqlite,.db"
              required
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </label>
          <label>
            Type RESTORE DATABASE
            <input
              required
              value={phrase}
              onChange={(e) => setPhrase(e.target.value)}
            />
          </label>
          <button
            className="danger"
            disabled={restoring || phrase !== "RESTORE DATABASE" || !file}
          >
            {restoring ? "Restoring…" : "Validate and restore database"}
          </button>
        </form>
      </section>
      <section className="card">
        <h2>Exports</h2>
        <div className="actions">
          <CsvExport onError={onError} />
        </div>
      </section>
    </>
  );
}

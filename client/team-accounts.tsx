import { useEffect, useState } from "react";
import { api, type Team, type Row } from "./api";
import { Dialog, EntityForm, Table } from "./ui";

export function TeamAccounts({ teams }: { teams: Team[] }) {
  const [accounts, setAccounts] = useState<Row[]>([]);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Team | null>(null);
  useEffect(() => {
    api<Row[]>("/team-accounts")
      .then(setAccounts)
      .catch((e) => setError(e.message));
  }, []);
  const account = accounts.find((a) => a.team_id === selected?.id);
  return (
    <section className="card">
      <h2>Team logins</h2>
      <p>
        Select a team to create a login, reset its password, or disable access.
        Share <a href="#team">the team login link</a> and credentials with that
        team. Teams see only their own records.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <Table
        rows={teams.map((team) => {
          const login = accounts.find((a) => a.team_id === team.id);
          return {
            id: team.id,
            name: team.name,
            username: login?.username ?? "Not created",
            access: login
              ? login.active
                ? "Enabled"
                : "Disabled"
              : "Not created",
          };
        })}
        columns={[
          { key: "id", label: "Team ID" },
          { key: "name", label: "Team" },
          { key: "username", label: "Username" },
          { key: "access", label: "Login" },
        ]}
        onRow={(r) => setSelected(teams.find((t) => t.id === r.id) ?? null)}
      />
      {!teams.length && <p>Add teams in Teams first.</p>}
      {selected && (
        <Dialog
          title={`Team login: ${selected.name}`}
          onClose={() => setSelected(null)}
        >
          <EntityForm
            fields={[
              { key: "username", label: "Team username", required: true },
              {
                key: "password",
                label: account
                  ? "New password (leave blank to keep)"
                  : "Password",
                type: "password",
                required: !account,
                help: "At least 10 characters. Share securely with the team.",
              },
              { key: "active", label: "Login enabled", type: "checkbox" },
            ]}
            initial={{
              username: account?.username ?? selected.id.toLowerCase(),
              active: account ? Boolean(account.active) : true,
            }}
            onCancel={() => setSelected(null)}
            onSave={async (values) => {
              setAccounts(
                await api<Row[]>(
                  `/team-accounts/${encodeURIComponent(selected.id)}`,
                  "PUT",
                  values,
                ),
              );
              setError("");
              setSelected(null);
            }}
            label="Save team login"
          />
        </Dialog>
      )}
    </section>
  );
}

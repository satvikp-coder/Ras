import { CsvExport, Settings } from "./settings";
import { TeamPortal } from "./team-portal";
import { TransactionRecord } from "./transaction-record";
import {
  StrictMode,
  useEffect,
  useState,
  type ReactNode,
  type FormEvent,
} from "react";
import { createRoot } from "react-dom/client";
import {
  api,
  requestKey as newRequestKey,
  download,
  type Bootstrap,
  type Operator,
  type Row,
  type Team,
  type Mitra,
  type Component,
} from "./api";
import { Dialog, EntityForm, Table, Badge, time, type Field } from "./ui";
import { TransactionForm } from "./transactions";
import { HistoryView } from "./history";
import "./style.css";

const routes = [
  "Dashboard",
  "Teams",
  "Mitras",
  "Shop",
  "Inventory",
  "Purchases",
  "Trades",
  "Ledger",
  "Audit Log",
  "Reports",
  "Settings",
];
const statuses = (mitra = false) =>
  ({
    key: "status",
    label: "Status",
    type: "select",
    options: (mitra
      ? ["Active", "Inactive", "Available", "Assigned"]
      : ["Active", "Inactive"]
    ).map((s) => ({ value: s, label: s })),
  }) as Field;
const baseFields: Field[] = [
  { key: "id", label: "ID", required: true },
  { key: "name", label: "Name", required: true },
];
const notes: Field = { key: "notes", label: "Notes", type: "textarea" };
function Login({ onLogin }: { onLogin: (user: Operator) => void }) {
  const [accountType, setAccountType] = useState(
    window.location.hash === "#team" ? "team" : "operator",
  );
  const [username, setUsername] = useState(
      window.location.hash === "#team" ? "" : "admin",
    ),
    [password, setPassword] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function login(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      onLogin(
        await api<Operator>("/login", "POST", {
          username,
          password,
          accountType,
        }),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="login">
      <div className="brand-mark">RAS</div>
      <p className="eyebrow">ROBOTS OF THE BACKSTREET</p>
      <h1>Competition Control Center</h1>
      <p className="subtle">Local operations · RAS Bolts · Mentor Mitra</p>
      <form onSubmit={login}>
        <label>
          Sign in as
          <select
            value={accountType}
            onChange={(e) => {
              setAccountType(e.target.value);
              setUsername("");
              setPassword("");
              setError("");
            }}
          >
            <option value="operator">Committee / Operator</option>
            <option value="team">Team</option>
          </select>
        </label>
        {accountType === "team" && (
          <p className="subtle">
            Use the team credentials provided by your organizer.
          </p>
        )}
        <label>
          Username
          <input
            autoFocus
            autoComplete="username"
            required
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </label>
        <label>
          Password
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
      </form>
      <small>
        First-run admin password appears in the server terminal. All competition
        data stays on this computer.
      </small>
    </main>
  );
}
function App() {
  const [user, setUser] = useState<Operator | null>(null),
    [authReady, setAuthReady] = useState(false),
    [data, setData] = useState<Bootstrap | null>(null),
    [page, setPage] = useState("Dashboard"),
    [search, setSearch] = useState(""),
    [modal, setModal] = useState<{ title: string; body: ReactNode } | null>(
      null,
    ),
    [transaction, setTransaction] = useState<{
      kind: "purchase" | "trade";
      correctionOf?: number;
    } | null>(null),
    [toast, setToast] = useState(""),
    [error, setError] = useState(""),
    [revision, setRevision] = useState(0),
    [nowMs, setNowMs] = useState(Date.now()),
    [timerReceived, setTimerReceived] = useState(Date.now()),
    [teamId, setTeamId] = useState<string | null>(null),
    [mitraId, setMitraId] = useState<string | null>(null),
    [componentId, setComponentId] = useState<string | null>(null),
    [tab, setTab] = useState("Overview");
  const admin = user?.role === "Admin";
  useEffect(() => {
    api<Operator>("/me")
      .then(setUser)
      .catch(() => {})
      .finally(() => setAuthReady(true));
  }, []);
  async function refresh() {
    try {
      const next = await api<Bootstrap>("/bootstrap");
      setData(next);
      setTimerReceived(Date.now());
      setError("");
      setRevision((r) => r + 1);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    if (!user || user.role === "Team") return;
    let alive = true;
    async function load() {
      try {
        const next = await api<Bootstrap>("/bootstrap");
        if (alive) {
          setData(next);
          setTimerReceived(Date.now());
          setError("");
          setRevision((r) => r + 1);
        }
      } catch (e) {
        if (alive) setError((e as Error).message);
      }
    }
    void load();
    const poll = setInterval(load, 5000);
    return () => {
      alive = false;
      clearInterval(poll);
    };
  }, [user]);
  useEffect(() => {
    const tick = setInterval(() => setNowMs(Date.now()), 250);
    return () => clearInterval(tick);
  }, []);
  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(""), 7000);
      return () => clearTimeout(t);
    }
  }, [toast]);
  const success = async (message = "Saved successfully.") => {
    setModal(null);
    setToast(message);
    await refresh();
  };
  async function exportExcel() {
    try {
      await download("/export/excel");
      setToast("Excel workbook downloaded.");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const navigate = (next: string) => {
    setPage(next);
    setSearch("");
    setTeamId(null);
    setMitraId(null);
    setComponentId(null);
  };
  async function timerAction(action: string) {
    try {
      await api("/timer/" + action, "POST");
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    function key(e: KeyboardEvent) {
      if (user?.role === "Team") return;
      const target = e.target as HTMLElement;
      if (
        modal ||
        transaction ||
        e.ctrlKey ||
        e.altKey ||
        e.metaKey ||
        target.closest("input,textarea,select,button,[contenteditable]")
      )
        return;
      const k = e.key.toLowerCase();
      if (k === "p" && ["Admin", "Shop Operator"].includes(user?.role ?? ""))
        setTransaction({ kind: "purchase" });
      else if (
        k === "t" &&
        ["Admin", "Trade Operator"].includes(user?.role ?? "")
      )
        setTransaction({ kind: "trade" });
      else if (k === "d") navigate("Dashboard");
      else if (k === "l") navigate("Ledger");
      else if (k === "i") navigate("Inventory");
      else if (k === "e") void exportExcel();
      else if (
        k === " " &&
        admin &&
        data &&
        ["ACTIVE", "PAUSED"].includes(data.timer.state)
      ) {
        e.preventDefault();
        void timerAction(data.timer.state === "ACTIVE" ? "pause" : "resume");
      }
    }
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
  function editEntity(
    kind: "team" | "mitra" | "component",
    entity?: Team | Mitra | Component,
  ) {
    if (!data) return;
    let fields: Field[], initial: Row;
    const id = entity?.id;
    if (kind === "team") {
      fields = [
        ...baseFields,
        { key: "number", label: "Team number" },
        ...(!id
          ? [
              {
                key: "initialBolts",
                label: "Initial RAS Bolts",
                type: "number",
                min: 0,
                required: true,
                disabled: data.config.starterAllocationEnabled,
                help: data.config.starterAllocationEnabled
                  ? "Official event allocation comes from Settings and is recorded in the ledger."
                  : undefined,
              } as Field,
            ]
          : []),
        {
          key: "membersText",
          label: "Members — one per line; optional contact after |",
          type: "textarea",
        },
        {
          key: "project",
          label: "Assigned robot",
          type: "select",
          options: [
            { value: "", label: "Assign later" },
            ...data.projects.map((p) => ({ value: p.name, label: p.name })),
            ...(entity &&
            (entity as Team).project &&
            !data.projects.some((p) => p.name === (entity as Team).project)
              ? [
                  {
                    value: (entity as Team).project,
                    label: (entity as Team).project,
                  },
                ]
              : []),
          ],
        },
        { key: "description", label: "Project description", type: "textarea" },
        statuses(),
        notes,
      ];
      const team = entity as Team | undefined;
      initial = team
        ? {
            ...team,
            membersText: team.members
              .map((m) => `${m.name}${m.contact ? " | " + m.contact : ""}`)
              .join("\n"),
          }
        : { status: "Active", initialBolts: data.config.initialBolts };
    } else if (kind === "mitra") {
      fields = [
        ...baseFields,
        { key: "contact", label: "Contact information" },
        statuses(true),
        notes,
      ];
      initial = entity ? { ...entity } : { status: "Active" };
    } else {
      fields = [
        ...baseFields,
        { key: "category", label: "Category" },
        { key: "description", label: "Description", type: "textarea" },
        {
          key: "price",
          label: "Unit price (RAS Bolts)",
          type: "number",
          min: 0,
          required: true,
        },
        ...(!id
          ? [
              {
                key: "initialQuantity",
                label: "Initial shop quantity",
                type: "number",
                min: 0,
                required: true,
              } as Field,
            ]
          : []),
        {
          key: "max_per_team",
          label: "Maximum purchased per team (blank = unlimited)",
          type: "number",
          min: 1,
        },
        statuses(),
        notes,
      ];
      initial = entity
        ? { ...entity }
        : { status: "Active", price: 0, initialQuantity: 0 };
    }
    if (id) fields = fields.filter((f) => f.key !== "id");
    setModal({
      title: `${id ? "Edit" : "Add"} ${kind === "mitra" ? "Mentor Mitra" : kind}`,
      body: (
        <EntityForm
          fields={fields}
          initial={initial}
          onCancel={() => setModal(null)}
          onSave={async (values) => {
            const payload =
              kind === "team"
                ? {
                    ...values,
                    members: String(values.membersText ?? "")
                      .split("\n")
                      .filter((v) => v.trim())
                      .map((v) => {
                        const [name, ...contact] = v.split("|");
                        return {
                          name: name.trim(),
                          contact: contact.join("|").trim(),
                        };
                      }),
                  }
                : values;
            await api(
              `/${kind === "team" ? "teams" : kind === "mitra" ? "mitras" : "components"}${id ? "/" + id : ""}`,
              id ? "PUT" : "POST",
              payload,
            );
            await success();
          }}
        />
      ),
    });
  }
  function assignment(team: Team) {
    if (!data) return;
    setModal({
      title: `Assign Mentor Mitra — ${team.id}`,
      body: (
        <EntityForm
          fields={[
            {
              key: "mitraId",
              label: "Mentor Mitra",
              type: "select",
              options: [
                { value: "", label: "No assignment" },
                ...data.mitras
                  .filter((m) => m.status !== "Inactive")
                  .map((m) => ({ value: m.id, label: `${m.id} — ${m.name}` })),
              ],
            },
          ]}
          initial={{ mitraId: team.mitra?.id ?? "" }}
          onCancel={() => setModal(null)}
          onSave={async (v) => {
            await api(`/teams/${team.id}/mitra`, "PUT", {
              mitraId: v.mitraId || null,
            });
            await success("Mentor Mitra assignment saved.");
          }}
        />
      ),
    });
  }
  function adjust(inventory = false, team?: Team, component?: Component) {
    if (!data) return;
    const fields: Field[] = inventory
      ? [
          {
            key: "componentId",
            label: "Component",
            type: "select",
            required: true,
            options: data.components.map((c) => ({
              value: c.id,
              label: c.name,
            })),
          },
          {
            key: "teamId",
            label: "Inventory owner",
            type: "select",
            options: [
              { value: "", label: "Shop inventory" },
              ...data.teams.map((t) => ({
                value: t.id,
                label: t.id + " — " + t.name,
              })),
            ],
          },
          {
            key: "quantity",
            label: "Signed quantity change (+ add / − remove)",
            type: "number",
            required: true,
          },
        ]
      : [
          {
            key: "teamId",
            label: "Team",
            type: "select",
            required: true,
            options: data.teams.map((t) => ({
              value: t.id,
              label: t.id + " — " + t.name,
            })),
          },
          {
            key: "type",
            label: "Adjustment type",
            type: "select",
            options: (data.timer.state === "NOT_STARTED"
              ? ["INITIAL_BALANCE"]
              : ["MANUAL_ADJUSTMENT", "BONUS", "PENALTY", "CORRECTION"]
            ).map((v) => ({
              value: v,
              label:
                v === "INITIAL_BALANCE"
                  ? "Initial allocation change"
                  : v.replaceAll("_", " "),
            })),
          },
          {
            key: "amount",
            label: "Signed RAS Bolts change (+ add / − deduct)",
            type: "number",
            required: true,
          },
        ];
    fields.push({
      key: "notes",
      label: "Required reason",
      type: "textarea",
      required: true,
    });
    const requestKey = newRequestKey();
    setModal({
      title: inventory
        ? "Auditable inventory adjustment"
        : "Auditable RAS Bolts adjustment",
      body: (
        <EntityForm
          fields={fields}
          initial={{
            teamId: team?.id ?? (inventory ? "" : (data.teams[0]?.id ?? "")),
            componentId: component?.id ?? data.components[0]?.id ?? "",
            type:
              data.timer.state === "NOT_STARTED"
                ? "INITIAL_BALANCE"
                : "MANUAL_ADJUSTMENT",
          }}
          label="Confirm adjustment"
          onCancel={() => setModal(null)}
          onSave={async (v) => {
            await api(
              inventory ? "/inventory-adjustments" : "/adjustments",
              "POST",
              { ...v, requestKey },
            );
            await success();
          }}
        />
      ),
    });
  }
  async function transactionDetails(id: number) {
    try {
      const row = await api<Row>(`/transactions/${id}`);
      setModal({
        title: String(row.ref),
        body: (
          <div>
            <dl>
              <dt>Type</dt>
              <dd>{String(row.kind)}</dd>
              <dt>Status</dt>
              <dd>
                <Badge value={String(row.status)} />
              </dd>
              <dt>Timestamp</dt>
              <dd>{time(row.created_at)}</dd>
              <dt>Operator</dt>
              <dd>{String(row.operator)}</dd>
              <dt>Reason / notes</dt>
              <dd>{String(row.notes) || "—"}</dd>
              <dt>Elapsed / remaining</dt>
              <dd>
                {Math.floor(Number(row.elapsed_ms) / 1000)} /{" "}
                {Math.floor(Number(row.remaining_ms) / 1000)} seconds
              </dd>
              {row.reversal_of ? (
                <>
                  <dt>Reversal of transaction</dt>
                  <dd>#{String(row.reversal_of)}</dd>
                </>
              ) : null}
              {row.correction_of ? (
                <>
                  <dt>Replacement for transaction</dt>
                  <dd>#{String(row.correction_of)}</dd>
                </>
              ) : null}
            </dl>
            <TransactionRecord record={row} />
            <h3>RAS Bolt ledger</h3>
            <Table
              rows={row.ledger as Row[]}
              columns={[
                { key: "team_id", label: "Team" },
                { key: "type", label: "Type" },
                { key: "amount", label: "RAS Bolts change" },
                { key: "balance_before", label: "Before" },
                { key: "balance_after", label: "After" },
              ]}
            />
            <h3>Inventory movements</h3>
            <Table
              rows={row.movements as Row[]}
              columns={[
                {
                  key: "team_id",
                  label: "Owner",
                  render: (r) => String(r.team_id ?? "SHOP"),
                },
                { key: "component", label: "Component" },
                { key: "quantity", label: "Change" },
                { key: "quantity_before", label: "Before" },
                { key: "quantity_after", label: "After" },
              ]}
            />
            {row.reversal ? (
              <p>
                Reversal:{" "}
                <button
                  className="link"
                  onClick={() =>
                    void transactionDetails(Number((row.reversal as Row).id))
                  }
                >
                  {String((row.reversal as Row).ref)}
                </button>
              </p>
            ) : null}
            {row.replacement ? (
              <p>
                Replacement:{" "}
                <button
                  className="link"
                  onClick={() =>
                    void transactionDetails(Number((row.replacement as Row).id))
                  }
                >
                  {String((row.replacement as Row).ref)}
                </button>
              </p>
            ) : null}
            <footer>
              {admin &&
                row.kind === "PURCHASE" &&
                row.status === "COMPLETED" &&
                data?.config.allowRefunds && (
                  <button
                    className="secondary"
                    onClick={() => refundDialog(id)}
                  >
                    Refund items
                  </button>
                )}
              {admin && row.status === "COMPLETED" && !row.reversal_of && (
                <button
                  className="danger"
                  onClick={() => voidDialog(id, String(row.ref))}
                >
                  Void transaction
                </button>
              )}
              {admin &&
                row.status === "VOIDED" &&
                !row.replacement &&
                ["PURCHASE", "TRADE"].includes(String(row.kind)) && (
                  <button
                    onClick={() => {
                      setModal(null);
                      setTransaction({
                        kind: row.kind === "PURCHASE" ? "purchase" : "trade",
                        correctionOf: id,
                      });
                    }}
                  >
                    Create linked replacement
                  </button>
                )}
              <button className="secondary" onClick={() => setModal(null)}>
                Close
              </button>
            </footer>
          </div>
        ),
      });
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function refundDialog(id: number) {
    try {
      const details = await api<Row>(`/transactions/${id}`);
      const purchaseRow = details.purchase as Row;
      const requestKey = newRequestKey();
      setModal({
        title: "Return items and refund RAS Bolts",
        body: (
          <EntityForm
            fields={[
              {
                key: "quantity",
                label: "Returned item quantity",
                type: "number",
                min: 1,
                required: true,
              },
              {
                key: "notes",
                label: "Required reason",
                type: "textarea",
                required: true,
              },
            ]}
            initial={{ quantity: 1 }}
            label="Confirm refund"
            onCancel={() => setModal(null)}
            onSave={async (v) => {
              await api("/refunds", "POST", {
                ...v,
                purchaseId: purchaseRow.id,
                requestKey,
              });
              await success("Items returned and RAS Bolts refunded.");
            }}
          />
        ),
      });
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function voidDialog(id: number, ref: string) {
    const requestKey = newRequestKey();
    setModal({
      title: `Void ${ref}`,
      body: (
        <>
          <p className="notice">
            This preserves the original and posts a linked reversal. If
            inventory has moved or the reversal would overspend a team, the
            server rejects it. Reverse dependent transactions first.
          </p>
          <EntityForm
            fields={[
              {
                key: "notes",
                label: "Required reason",
                type: "textarea",
                required: true,
              },
            ]}
            initial={{}}
            label="Confirm void"
            onCancel={() => setModal(null)}
            onSave={async (v) => {
              await api("/void", "POST", {
                transactionId: id,
                notes: v.notes,
                requestKey,
              });
              await success(`${ref} voided. Reversal recorded.`);
            }}
          />
        </>
      ),
    });
  }
  function operatorDialog(operator?: Operator) {
    const fields: Field[] = [
      { key: "username", label: "Username", required: true },
      { key: "name", label: "Display name", required: true },
      {
        key: "role",
        label: "Role",
        type: "select",
        options: ["Admin", "Shop Operator", "Trade Operator", "Viewer"].map(
          (v) => ({ value: v, label: v }),
        ),
      },
      {
        key: "password",
        label: operator
          ? "New password (blank = keep current)"
          : "Password (minimum 10 characters)",
        type: "password",
        required: !operator,
      },
      { key: "active", label: "Active", type: "checkbox" },
    ];
    setModal({
      title: operator ? "Edit operator" : "Add operator",
      body: (
        <EntityForm
          fields={fields}
          initial={
            operator
              ? { ...operator, active: !!operator.active }
              : { role: "Viewer", active: true }
          }
          onCancel={() => setModal(null)}
          onSave={async (v) => {
            await api(
              "/operators" + (operator ? "/" + operator.id : ""),
              operator ? "PUT" : "POST",
              v,
            );
            if (operator?.id === user?.id) {
              setModal(null);
              setUser(null);
              setData(null);
              setToast("Operator updated. Sign in again.");
            } else await success();
          }}
        />
      ),
    });
  }
  function globalSearchDialog() {
    setModal({
      title: "Search the control center",
      body: (
        <EntityForm
          fields={[
            {
              key: "q",
              label:
                "Team, member, project, Mentor Mitra, component or transaction reference",
              required: true,
            },
          ]}
          initial={{}}
          label="Search"
          onCancel={() => setModal(null)}
          onSave={async (v) => {
            const rows = await api<Row[]>(
              `/search?q=${encodeURIComponent(String(v.q))}`,
            );
            setModal({
              title: `Search results — ${String(v.q)}`,
              body: (
                <Table
                  rows={rows}
                  columns={[
                    { key: "label", label: "Result" },
                    { key: "description", label: "Details" },
                  ]}
                  onRow={(row) => {
                    setModal(null);
                    if (row.kind === "transaction") {
                      void transactionDetails(Number(row.id));
                      return;
                    }
                    if (row.kind === "team") {
                      navigate("Teams");
                      setTeamId(String(row.id));
                      setTab("Overview");
                    }
                    if (row.kind === "mitra") {
                      navigate("Mitras");
                      setMitraId(String(row.id));
                    }
                    if (row.kind === "component") {
                      navigate("Inventory");
                      setComponentId(String(row.id));
                    }
                  }}
                />
              ),
            });
          }}
        />
      ),
    });
  }
  if (!authReady) return <div className="empty">Checking local session…</div>;
  if (!user) return <Login onLogin={setUser} />;
  if (user.role === "Team")
    return (
      <TeamPortal
        onLogout={() => {
          setUser(null);
          setData(null);
        }}
      />
    );
  if (!data)
    return (
      <div className="empty">
        {error || "Loading control center…"}
        <button onClick={() => void refresh()}>Retry</button>
        <button onClick={() => setUser(null)}>Sign in</button>
      </div>
    );
  const remaining = Math.max(
    0,
    data.timer.remaining_ms -
      (data.timer.state === "ACTIVE" ? nowMs - timerReceived : 0),
  );
  const seconds = Math.ceil(remaining / 1000);
  const clock = [
    Math.floor(seconds / 3600),
    Math.floor(seconds / 60) % 60,
    seconds % 60,
  ]
    .map((v) => String(v).padStart(2, "0"))
    .join(":");
  const effectiveState =
    data.timer.state === "ACTIVE" && !remaining ? "ENDED" : data.timer.state;
  const warning =
    effectiveState === "ENDED"
      ? "COMPETITION ENDED — TRANSACTIONS LOCKED"
      : effectiveState === "ACTIVE"
        ? seconds <= 60
          ? "FINAL MINUTE"
          : seconds <= 300
            ? "FINAL 5 MINUTES"
            : seconds <= 600
              ? "FINAL 10 MINUTES"
              : seconds <= 1800
                ? "FINAL 30 MINUTES"
                : ""
        : effectiveState === "PAUSED"
          ? "COMPETITION PAUSED"
          : "";
  const filteredTeams = data.teams.filter((t) =>
    `${t.id} ${t.name} ${t.project} ${t.members.map((m) => m.name).join(" ")} ${t.mitra?.name ?? ""} ${t.mitra?.id ?? ""}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const filteredMitras = data.mitras.filter((m) =>
    `${m.id} ${m.name}`.toLowerCase().includes(search.toLowerCase()),
  );
  const filteredComponents = data.components.filter(
    (c) =>
      (page !== "Shop" ||
        (c.status === "Active" &&
          !["Starter", "Common", "Reference"].includes(c.category))) &&
      `${c.id} ${c.name} ${c.category}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const selectedTeam = data.teams.find((t) => t.id === teamId),
    selectedMitra = data.mitras.find((m) => m.id === mitraId),
    selectedComponent = data.components.find((c) => c.id === componentId);
  const teamTable = (
    <Table
      rows={filteredTeams as unknown as Row[]}
      columns={[
        { key: "id", label: "Team ID" },
        { key: "name", label: "Team" },
        { key: "project", label: "Project" },
        {
          key: "mitra",
          label: "Mentor Mitra",
          render: (r) => (r.mitra as Mitra | null)?.name ?? "Unassigned",
        },
        { key: "balance", label: "RAS Bolts" },
        {
          key: "status",
          label: "Status",
          render: (r) => <Badge value={String(r.status)} />,
        },
      ]}
      onRow={(r) => {
        setPage("Teams");
        setTeamId(String(r.id));
        setTab("Overview");
      }}
    />
  );
  const inventoryTable = (
    <Table
      rows={filteredComponents as unknown as Row[]}
      columns={[
        { key: "id", label: "Component ID" },
        { key: "name", label: "Component" },
        { key: "category", label: "Category" },
        { key: "price", label: "Unit price (RAS Bolts)" },
        { key: "initial_quantity", label: "Initial stock" },
        {
          key: "stock",
          label: "Available",
          render: (r) => (
            <span className={Number(r.stock) <= 3 ? "low-stock" : ""}>
              {String(r.stock)}
            </span>
          ),
        },
        { key: "max_per_team", label: "Team purchase cap" },
        {
          key: "status",
          label: "Status",
          render: (r) => <Badge value={String(r.status)} />,
        },
      ]}
      onRow={(r) => {
        setComponentId(String(r.id));
        setTab("Overview");
      }}
    />
  );
  let content: ReactNode;
  if (page === "Dashboard")
    content = (
      <>
        <section
          className={`timer-panel ${seconds <= 300 && effectiveState === "ACTIVE" ? "urgent" : ""}`}
        >
          <div>
            <p className="eyebrow">COMPETITION TIMER</p>
            <p>
              {data.config.eventName} · {data.config.venue}
            </p>
            <p>{data.config.organizer}</p>
            <p>
              {data.config.teamLimit ?? 8} team slots ·{" "}
              {data.config.initialBolts} RAS Bolts / team ·{" "}
              {data.config.teamSize} members / team
            </p>
            <p>BUILD SMART. SPEND SMART. TRADE SMART. BUILD FAST.</p>
            {data.teams.some(
              (t) =>
                t.members.length !== data.config.teamSize ||
                !data.projects.some((p) => p.name === t.project) ||
                !t.mitra,
            ) && (
              <p className="notice">
                Complete team setup before starting: enter{" "}
                {data.config.teamSize} members, assign a robot and Mentor Mitra
                for each team.
              </p>
            )}
            <p>
              Free starter kit:{" "}
              {data.starters
                .map((s) => `${s.quantity} × ${s.name}`)
                .join(" · ")}
            </p>
            <div className="clock" aria-label={`${clock} remaining`}>
              {clock}
            </div>
            <p className="subtle">
              REMAINING · {data.config.durationMinutes} MINUTE EVENT
            </p>
          </div>
          <div>
            <Badge value={effectiveState} />
            <p>
              {data.config.eventDate} · {data.config.startTime}–
              {data.config.endTime}
            </p>
            {admin && (
              <div className="actions">
                {effectiveState === "NOT_STARTED" && (
                  <button onClick={() => void timerAction("start")}>
                    Start competition
                  </button>
                )}
                {effectiveState === "ACTIVE" && (
                  <button
                    className="secondary"
                    onClick={() => void timerAction("pause")}
                  >
                    Pause [Space]
                  </button>
                )}
                {effectiveState === "PAUSED" && (
                  <button onClick={() => void timerAction("resume")}>
                    Resume [Space]
                  </button>
                )}
                {["ACTIVE", "PAUSED"].includes(effectiveState) && (
                  <button
                    className="danger"
                    onClick={() =>
                      setModal({
                        title: "End competition",
                        body: (
                          <EntityForm
                            fields={[
                              {
                                key: "confirm",
                                label: "Type END COMPETITION",
                                required: true,
                              },
                            ]}
                            initial={{}}
                            label="End competition"
                            onCancel={() => setModal(null)}
                            onSave={async (v) => {
                              if (v.confirm !== "END COMPETITION")
                                throw new Error(
                                  "Confirmation phrase does not match.",
                                );
                              await api("/timer/end", "POST");
                              await success(
                                "Competition ended. Normal transactions locked.",
                              );
                            }}
                          />
                        ),
                      })
                    }
                  >
                    End
                  </button>
                )}
              </div>
            )}
          </div>
        </section>
        {warning && <div className="warning">{warning}</div>}
        {(!data.config.rulesConfirmed || !data.config.allocationConfirmed) && (
          <p className="notice">
            Organizer setup required: confirm actual initial RAS Bolts and
            competition rules in Settings. No prices or allocations have been
            invented.
          </p>
        )}
        <div className="stats">
          {[
            [
              "Active teams",
              `${data.summary.activeTeams} / ${data.summary.teams}`,
            ],
            ["Mentor Mitras", data.summary.mitras],
            ["Purchases", data.summary.purchases],
            ["Trades", data.summary.trades],
            ["RAS Bolts held", data.summary.held],
            ["RAS Bolts spent", data.summary.spent],
            ["RAS Bolts transferred", data.summary.transferred],
            ["Shop items remaining", data.summary.inventory],
          ].map(([label, value]) => (
            <section key={label}>
              <small>{label}</small>
              <strong>{value}</strong>
              {label === "Shop items remaining" && (
                <small>{data.summary.sold} items sold</small>
              )}
            </section>
          ))}
        </div>
        <div className="section-heading">
          <h2>Team balance lookup</h2>
          <input
            aria-label="Search teams"
            value={search}
            placeholder="Team, member, project, Mitra…"
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {teamTable}
        <div className="actions secondary-actions">
          <button className="secondary" onClick={() => navigate("Teams")}>
            View teams
          </button>
          <button className="secondary" onClick={() => navigate("Mitras")}>
            View Mentor Mitras
          </button>
          {admin && (
            <>
              <button className="secondary" onClick={() => editEntity("team")}>
                + Add team
              </button>
              <button className="secondary" onClick={() => editEntity("mitra")}>
                + Add Mentor Mitra
              </button>
              <button
                className="secondary"
                onClick={() => editEntity("component")}
              >
                + Add component
              </button>
            </>
          )}
          <button className="secondary" onClick={() => navigate("Inventory")}>
            View inventory [I]
          </button>
          <button className="secondary" onClick={() => navigate("Ledger")}>
            View ledger [L]
          </button>
        </div>
      </>
    );
  else if (page === "Teams" && selectedTeam) {
    content = (
      <>
        <div className="section-heading">
          <div>
            <button className="link" onClick={() => setTeamId(null)}>
              ← All teams
            </button>
            <h2>
              {selectedTeam.id} — {selectedTeam.name}
            </h2>
          </div>
          {admin && (
            <div className="actions">
              <button
                className="secondary"
                onClick={() => editEntity("team", selectedTeam)}
              >
                Edit team
              </button>
              <button
                className="secondary"
                onClick={() => assignment(selectedTeam)}
              >
                Assign Mentor Mitra
              </button>
              <button
                className="secondary"
                onClick={() => adjust(false, selectedTeam)}
              >
                RAS Bolts adjustment
              </button>
            </div>
          )}
        </div>
        <div className="stats">
          <section>
            <small>Current RAS Bolts</small>
            <strong>{selectedTeam.balance}</strong>
          </section>
          <section>
            <small>Initial RAS Bolts</small>
            <strong>{selectedTeam.initial}</strong>
          </section>
          <section>
            <small>Purchase spending</small>
            <strong>{selectedTeam.spent}</strong>
          </section>
          <section>
            <small>Trade payments / receipts</small>
            <strong>
              {selectedTeam.trade_paid} / {selectedTeam.trade_received}
            </strong>
          </section>
        </div>
        <div className="tabs">
          {[
            "Overview",
            "Purchases",
            "Trades",
            "Ledger",
            "Inventory",
            "Audit",
          ].map((v) => (
            <button
              className={v === tab ? "selected" : ""}
              key={v}
              onClick={() => setTab(v)}
            >
              {v}
            </button>
          ))}
        </div>
        {tab === "Overview" ? (
          <div className="two-col">
            <section className="card">
              <h3>Project</h3>
              <h4>{selectedTeam.project || "No project entered"}</h4>
              {data.projects.find((p) => p.name === selectedTeam.project) && (
                <Table
                  rows={Object.entries(
                    data.projects.find((p) => p.name === selectedTeam.project)!
                      .requirements,
                  ).map(([id, required]) => {
                    const owned =
                      selectedTeam.inventory.find((i) => i.id === id)
                        ?.quantity ?? 0;
                    return {
                      id,
                      name:
                        data.components.find((c) => c.id === id)?.name ?? id,
                      required,
                      owned,
                      remaining: Math.max(0, required - owned),
                    };
                  })}
                  columns={[
                    { key: "name", label: "Required market component" },
                    { key: "required", label: "Required" },
                    { key: "owned", label: "Owned" },
                    { key: "remaining", label: "Still required" },
                  ]}
                />
              )}
              <p className="pre-wrap">{selectedTeam.description}</p>
              <h3>Members</h3>
              {selectedTeam.members.length ? (
                selectedTeam.members.map((m, i) => (
                  <p key={i}>
                    {m.name}
                    {m.contact ? " · " + m.contact : ""}
                  </p>
                ))
              ) : (
                <p>No members entered.</p>
              )}
              <h3>Notes</h3>
              <p className="pre-wrap">{selectedTeam.notes || "No notes"}</p>
            </section>
            <section className="card">
              <h3>Mentor Mitra</h3>
              {selectedTeam.mitra ? (
                <button
                  className="link"
                  onClick={() => {
                    navigate("Mitras");
                    setMitraId(selectedTeam.mitra!.id);
                  }}
                >
                  {selectedTeam.mitra.id} — {selectedTeam.mitra.name}
                </button>
              ) : (
                <p>Unassigned</p>
              )}
              <p>
                Purchases: {selectedTeam.purchase_count} · Trades:{" "}
                {selectedTeam.trade_count}
              </p>
              <p>
                Total received: {selectedTeam.received} RAS Bolts (including
                allocation and completed positive entries)
              </p>
              <Badge value={selectedTeam.status} />
              <dl>
                <dt>Team number</dt>
                <dd>{selectedTeam.number}</dd>
                <dt>Total spent</dt>
                <dd>{selectedTeam.total_spent} RAS Bolts</dd>
                <dt>Total trade value</dt>
                <dd>{selectedTeam.total_trade_value} RAS Bolts</dd>
                <dt>Created</dt>
                <dd>{time(selectedTeam.created_at)}</dd>
                <dt>Updated</dt>
                <dd>{time(selectedTeam.updated_at)}</dd>
              </dl>
            </section>
          </div>
        ) : tab === "Inventory" ? (
          <>
            <Table
              rows={selectedTeam.inventory as unknown as Row[]}
              columns={[
                { key: "id", label: "Component ID" },
                { key: "name", label: "Component" },
                { key: "quantity", label: "Owned quantity" },
              ]}
            />
            <h3>Team inventory movement history</h3>
            <HistoryView
              kind="movements"
              team={selectedTeam.id}
              data={data}
              refresh={revision}
              onTransaction={(id) => void transactionDetails(id)}
            />
          </>
        ) : (
          <HistoryView
            key={tab + selectedTeam.id}
            kind={tab.toLowerCase()}
            team={selectedTeam.id}
            data={data}
            refresh={revision}
            onTransaction={(id) => void transactionDetails(id)}
          />
        )}
      </>
    );
  } else if (page === "Teams")
    content = (
      <>
        <div className="section-heading">
          <input
            aria-label="Search teams"
            placeholder="Search team, member, project, Mitra"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {admin && (
            <button onClick={() => editEntity("team")}>+ Add team</button>
          )}
        </div>
        {teamTable}
      </>
    );
  else if (page === "Mitras" && selectedMitra)
    content = (
      <>
        <button className="link" onClick={() => setMitraId(null)}>
          ← All Mentor Mitras
        </button>
        <div className="section-heading">
          <h2>
            {selectedMitra.id} — {selectedMitra.name}
          </h2>
          {admin && (
            <button onClick={() => editEntity("mitra", selectedMitra)}>
              Edit Mentor Mitra
            </button>
          )}
        </div>
        <Badge value={selectedMitra.status} />
        <p>{selectedMitra.contact}</p>
        <p className="pre-wrap">{selectedMitra.notes}</p>
        <h3>Assigned teams & projects</h3>
        <Table
          rows={selectedMitra.teams as unknown as Row[]}
          columns={[
            { key: "id", label: "Team" },
            { key: "name", label: "Name" },
            { key: "project", label: "Project" },
            { key: "balance", label: "RAS Bolts" },
          ]}
          onRow={(r) => {
            navigate("Teams");
            setTeamId(String(r.id));
            setTab("Overview");
          }}
        />
      </>
    );
  else if (page === "Mitras")
    content = (
      <>
        <div className="section-heading">
          <input
            aria-label="Search Mentor Mitras"
            placeholder="Search Mentor Mitra"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {admin && (
            <button onClick={() => editEntity("mitra")}>
              + Add Mentor Mitra
            </button>
          )}
        </div>
        <Table
          rows={filteredMitras as unknown as Row[]}
          columns={[
            { key: "id", label: "Mitra ID" },
            { key: "name", label: "Mentor Mitra" },
            {
              key: "teams",
              label: "Assigned teams / project / RAS Bolts",
              render: (r) =>
                (r.teams as Mitra["teams"])
                  .map(
                    (t) =>
                      `${t.id} · ${t.project || "No project"} · ${t.balance} RAS Bolts`,
                  )
                  .join(" | ") || "Unassigned",
            },
            {
              key: "status",
              label: "Status",
              render: (r) => <Badge value={String(r.status)} />,
            },
          ]}
          onRow={(r) => setMitraId(String(r.id))}
        />
      </>
    );
  else if (["Shop", "Inventory"].includes(page) && selectedComponent)
    content = (
      <>
        <button className="link" onClick={() => setComponentId(null)}>
          ← All components
        </button>
        <div className="section-heading">
          <h2>
            {selectedComponent.id} — {selectedComponent.name}
          </h2>
          {admin && (
            <div className="actions">
              <button
                onClick={() => editEntity("component", selectedComponent)}
              >
                Edit component
              </button>
              <button
                className="secondary"
                onClick={() => adjust(true, undefined, selectedComponent)}
              >
                Inventory adjustment
              </button>
            </div>
          )}
        </div>
        <p>
          {selectedComponent.category} · {selectedComponent.price} RAS Bolts /
          unit · {selectedComponent.stock} available
        </p>
        <p>{selectedComponent.description}</p>
        <p>{selectedComponent.notes}</p>
        <dl>
          <dt>Initial shop quantity</dt>
          <dd>{selectedComponent.initial_quantity}</dd>
          <dt>Purchased (net) / returned</dt>
          <dd>
            {selectedComponent.purchased_quantity} /{" "}
            {selectedComponent.refunded_quantity}
          </dd>
          <dt>Team-to-team traded quantity</dt>
          <dd>{selectedComponent.traded_quantity}</dd>
          <dt>Remaining shop quantity</dt>
          <dd>{selectedComponent.stock}</dd>
        </dl>
        <p className="subtle">
          Team-to-team trading transfers ownership between teams and does not
          reduce shop stock again.
        </p>
        <h3>Auditable inventory history</h3>
        <HistoryView
          kind="movements"
          component={selectedComponent.id}
          data={data}
          refresh={revision}
          onTransaction={(id) => void transactionDetails(id)}
        />
      </>
    );
  else if (["Shop", "Inventory"].includes(page))
    content = (
      <>
        <div className="section-heading">
          <input
            aria-label="Search inventory"
            placeholder="Search component or category"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {admin && (
            <div className="actions">
              <button onClick={() => editEntity("component")}>
                + Add component
              </button>
              <button className="secondary" onClick={() => adjust(true)}>
                Inventory adjustment
              </button>
            </div>
          )}
        </div>
        {inventoryTable}
        {page === "Inventory" && (
          <>
            <h3>Team holdings</h3>
            <Table
              rows={data.teams.flatMap((t) =>
                t.inventory.map((i) => ({
                  id: `${t.id}-${i.id}`,
                  team: t.id,
                  component: i.name,
                  quantity: i.quantity,
                })),
              )}
              columns={[
                { key: "team", label: "Team" },
                { key: "component", label: "Component" },
                { key: "quantity", label: "Quantity" },
              ]}
            />
            <h3>All inventory movements</h3>
            <HistoryView
              kind="movements"
              data={data}
              refresh={revision}
              onTransaction={(id) => void transactionDetails(id)}
            />
          </>
        )}
      </>
    );
  else if (["Purchases", "Trades", "Ledger", "Audit Log"].includes(page))
    content = (
      <>
        <p className="subtle">
          Click a transaction reference to inspect its ledger and inventory
          movements.
        </p>
        <HistoryView
          key={page}
          kind={page === "Audit Log" ? "audit" : page.toLowerCase()}
          data={data}
          refresh={revision}
          onTransaction={(id) => void transactionDetails(id)}
        />
        {page === "Ledger" && (
          <>
            <h3>All transactions (including zero RAS Bolts transactions)</h3>
            <HistoryView
              kind="transactions"
              data={data}
              refresh={revision}
              onTransaction={(id) => void transactionDetails(id)}
            />
          </>
        )}
      </>
    );
  else if (page === "Reports")
    content = (
      <>
        <div className="section-heading">
          <div>
            <p className="eyebrow">ROBOTS OF THE BACKSTREET</p>
            <h2>FINAL EVENT REPORT</h2>
            <p>
              <Badge value={effectiveState} />{" "}
              {effectiveState !== "ENDED"
                ? "Provisional report — competition has not ended."
                : ""}
            </p>
          </div>
          <button className="secondary" onClick={() => window.print()}>
            Print / Save PDF
          </button>
        </div>
        <dl>
          <dt>Actual start</dt>
          <dd>{time(data.timer.started_at)}</dd>
          <dt>Actual end</dt>
          <dd>{time(data.timer.ended_at)}</dd>
          <dt>Teams / Mentor Mitras</dt>
          <dd>
            {data.summary.teams} / {data.summary.mitras}
          </dd>
          <dt>Purchases / trades</dt>
          <dd>
            {data.summary.purchases} / {data.summary.trades}
          </dd>
          <dt>RAS Bolts spent / transferred</dt>
          <dd>
            {data.summary.spent} / {data.summary.transferred}
          </dd>
          <dt>Shop inventory remaining</dt>
          <dd>{data.summary.inventory}</dd>
        </dl>
        <h3>Team results</h3>
        <Table
          rows={data.teams as unknown as Row[]}
          columns={[
            { key: "id", label: "Team" },
            { key: "name", label: "Name" },
            {
              key: "mitra",
              label: "Mentor Mitra",
              render: (r) => (r.mitra as Mitra | null)?.name ?? "—",
            },
            { key: "initial", label: "Initial RAS Bolts" },
            { key: "spent", label: "Purchase spending" },
            { key: "trade_paid", label: "Trade payments" },
            { key: "trade_received", label: "Trade receipts" },
            {
              key: "adjustments",
              label: "Net adjustments",
              render: (r) =>
                Number(r.balance) -
                Number(r.initial) +
                Number(r.spent) +
                Number(r.trade_paid) -
                Number(r.trade_received),
            },
            { key: "balance", label: "Final RAS Bolts" },
          ]}
        />
        <h3>Most purchased components</h3>
        <Table
          rows={data.summary.popular as unknown as Row[]}
          columns={[
            { key: "component_id", label: "Component ID" },
            { key: "component_name", label: "Component" },
            { key: "quantity", label: "Units purchased" },
          ]}
        />
        <h3>Remaining inventory</h3>
        {inventoryTable}
        <h3>Export all event records</h3>
        <div className="actions">
          <button onClick={() => void exportExcel()}>Export Excel [E]</button>
          <CsvExport onError={setError} />
        </div>
      </>
    );
  else if (page === "Settings")
    content = admin ? (
      <Settings
        data={data}
        onSaved={success}
        onError={setError}
        onOperator={operatorDialog}
        onAdjustment={() => adjust()}
        onReset={() =>
          setModal({
            title: "Reset competition timer",
            body: (
              <EntityForm
                fields={[
                  { key: "confirm", label: "Type RESET TIMER", required: true },
                ]}
                initial={{}}
                label="Reset timer"
                onCancel={() => setModal(null)}
                onSave={async (v) => {
                  await api("/timer/reset", "POST", v);
                  await success();
                }}
              />
            ),
          })
        }
      />
    ) : (
      <p className="notice">Admin permission required to manage settings.</p>
    );
  return (
    <div className="app">
      <aside>
        <div className="brand-mark">RAS</div>
        <div className="brand">
          ROBOTS OF THE
          <br />
          BACKSTREET<small>RAS CONTROL CENTER</small>
        </div>
        <nav aria-label="Main navigation">
          {routes.map((route) => (
            <button
              key={route}
              className={page === route ? "active" : ""}
              onClick={() => navigate(route)}
            >
              {route === "Mitras" ? "Mentor Mitras" : route}
            </button>
          ))}
        </nav>
        <div className="operator">
          <strong>{user.name}</strong>
          <small>{user.role}</small>
          <button
            className="quiet"
            onClick={async () => {
              await api("/logout", "POST");
              setUser(null);
              setData(null);
            }}
          >
            Sign out
          </button>
        </div>
      </aside>
      <main className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">
              {data.demo
                ? "DEMO — SAMPLE VALUES ONLY"
                : data.config.eventName.toUpperCase()}
            </p>
            <h1>{page === "Mitras" ? "Mentor Mitras" : page}</h1>
          </div>
          <div className="actions">
            {["Admin", "Shop Operator"].includes(user.role) && (
              <button onClick={() => setTransaction({ kind: "purchase" })}>
                + New purchase <kbd>P</kbd>
              </button>
            )}
            {["Admin", "Trade Operator"].includes(user.role) && (
              <button
                className="secondary"
                onClick={() => setTransaction({ kind: "trade" })}
              >
                + New trade <kbd>T</kbd>
              </button>
            )}
            <button className="secondary" onClick={() => void exportExcel()}>
              Export Excel
            </button>
            <button className="secondary" onClick={globalSearchDialog}>
              Search
            </button>
            <button
              className="quiet"
              aria-label="Refresh authoritative data"
              onClick={() => void refresh()}
            >
              ↻
            </button>
          </div>
        </header>
        {page !== "Dashboard" && (
          <div className="timer-strip">
            <span>{clock} remaining</span>
            <Badge value={effectiveState} />
            {warning && <strong>{warning}</strong>}
          </div>
        )}
        {toast && (
          <div className="success" role="status">
            {toast}
          </div>
        )}
        {error && (
          <div className="error" role="alert">
            {error}
            <button className="quiet" onClick={() => void refresh()}>
              Retry
            </button>
          </div>
        )}
        <div className="page-content">{content}</div>
        <footer className="app-footer">
          Local SQLite · Polls every 5 seconds · Currency: RAS Bolts · D
          Dashboard / L Ledger / I Inventory / E Export
        </footer>
      </main>
      {modal && (
        <Dialog title={modal.title} onClose={() => setModal(null)}>
          {modal.body}
        </Dialog>
      )}
      {transaction && (
        <Dialog
          title={
            transaction.kind === "purchase"
              ? "New purchase"
              : "New team-to-team trade"
          }
          onClose={() => setTransaction(null)}
        >
          <TransactionForm
            kind={transaction.kind}
            correctionOf={transaction.correctionOf}
            data={data}
            onCancel={() => setTransaction(null)}
            onDone={(result) => {
              setTransaction(null);
              setToast(
                `${result.ref} completed. Ledger and inventory updated.`,
              );
              void refresh();
            }}
          />
        </Dialog>
      )}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

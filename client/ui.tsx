import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type FormEvent,
} from "react";
import type { Row } from "./api";
export function Dialog({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.showModal();
    return () => previous?.focus();
  }, []);
  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <header>
        <h2>{title}</h2>
        <button
          className="quiet"
          type="button"
          aria-label="Close dialog"
          onClick={onClose}
        >
          ×
        </button>
      </header>
      {children}
    </dialog>
  );
}
export interface Field {
  key: string;
  label: string;
  type?:
    | "text"
    | "number"
    | "textarea"
    | "select"
    | "checkbox"
    | "password"
    | "date"
    | "time";
  required?: boolean;
  options?: { value: string; label: string }[];
  help?: string;
  min?: number;
  disabled?: boolean;
}
export function EntityForm({
  fields,
  initial,
  onSave,
  onCancel,
  label = "Save",
}: {
  fields: Field[];
  initial: Row;
  onSave: (values: Row) => Promise<unknown>;
  onCancel: () => void;
  label?: string;
}) {
  const [values, setValues] = useState<Row>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await onSave(values);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit}>
      <div className="form-grid">
        {fields.map((f) => (
          <label key={f.key} className={f.type === "textarea" ? "wide" : ""}>
            {f.type === "checkbox" ? (
              <span className="check">
                <input
                  type="checkbox"
                  checked={Boolean(values[f.key])}
                  onChange={(e) =>
                    setValues({ ...values, [f.key]: e.target.checked })
                  }
                />
                {f.label}
              </span>
            ) : (
              <>
                <span>
                  {f.label}
                  {f.required ? " *" : ""}
                </span>
                {f.type === "textarea" ? (
                  <textarea
                    rows={3}
                    value={String(values[f.key] ?? "")}
                    onChange={(e) =>
                      setValues({ ...values, [f.key]: e.target.value })
                    }
                  />
                ) : f.type === "select" ? (
                  <select
                    aria-label={f.label}
                    value={String(values[f.key] ?? "")}
                    required={f.required}
                    disabled={f.disabled}
                    onChange={(e) =>
                      setValues({ ...values, [f.key]: e.target.value })
                    }
                  >
                    {f.options?.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type={f.type ?? "text"}
                    value={String(values[f.key] ?? "")}
                    required={f.required}
                    disabled={f.disabled}
                    min={f.min}
                    step={f.type === "number" ? 1 : undefined}
                    autoComplete={
                      f.type === "password" ? "new-password" : undefined
                    }
                    onChange={(e) =>
                      setValues({
                        ...values,
                        [f.key]:
                          f.type === "number"
                            ? e.target.value === ""
                              ? null
                              : Number(e.target.value)
                            : e.target.value,
                      })
                    }
                  />
                )}
              </>
            )}
            {f.help && <small>{f.help}</small>}
          </label>
        ))}
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <footer>
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={() => {
            setValues(initial);
            setError("");
            onCancel();
          }}
        >
          Cancel
        </button>
        <button disabled={busy}>{busy ? "Saving…" : label}</button>
      </footer>
    </form>
  );
}
export interface Column {
  key: string;
  label: string;
  render?: (row: Row) => ReactNode;
}
export function Table({
  rows,
  columns,
  onRow,
}: {
  rows: Row[];
  columns: Column[];
  onRow?: (row: Row) => void;
}) {
  if (!rows.length)
    return (
      <div className="empty">
        No records match. Create a record or change the filters.
      </div>
    );
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={String(row.id ?? index)}>
              {columns.map((c, col) => (
                <td key={c.key}>
                  {col === 0 && onRow ? (
                    <button className="link" onClick={() => onRow(row)}>
                      {c.render ? c.render(row) : display(row[c.key])}
                    </button>
                  ) : c.render ? (
                    c.render(row)
                  ) : (
                    display(row[c.key])
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export const display = (value: unknown) =>
  value === null || value === undefined
    ? "—"
    : typeof value === "object"
      ? JSON.stringify(value)
      : String(value);
export const time = (value: unknown) =>
  value ? new Date(String(value)).toLocaleString() : "—";
export function Badge({ value }: { value: string }) {
  return (
    <span
      className={`badge type-${value.toLowerCase()} ${value === "VOIDED" || value === "Inactive" || value === "ENDED" ? "muted" : value === "ACTIVE" || value === "COMPLETED" || value === "Active" ? "good" : ""}`}
    >
      {value === "ACTIVE"
        ? "COMPETITION ACTIVE"
        : value === "ENDED"
          ? "COMPETITION ENDED"
          : value.replaceAll("_", " ")}
    </span>
  );
}
export function TeamSelect({
  teams,
  value,
  onChange,
  label,
}: {
  teams: { id: string; name: string; balance: number }[];
  value: string;
  onChange: (id: string) => void;
  label: string;
}) {
  const [search, setSearch] = useState("");
  return (
    <label className="team-select">
      <span>{label}</span>
      <input
        aria-label={`Search ${label}`}
        placeholder="Search ID or team name"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <select
        aria-label={label}
        required
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">Choose team</option>
        {teams
          .filter(
            (t) =>
              t.id === value ||
              `${t.id} ${t.name}`.toLowerCase().includes(search.toLowerCase()),
          )
          .map((t) => (
            <option key={t.id} value={t.id}>
              {t.id} — {t.name} · {t.balance} RAS Bolts
            </option>
          ))}
      </select>
    </label>
  );
}

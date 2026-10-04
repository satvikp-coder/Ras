import { DatabaseSync, backup } from "node:sqlite";
import {
  readFileSync,
  mkdirSync,
  existsSync,
  renameSync,
  rmSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import {
  randomBytes,
  scryptSync,
  timingSafeEqual,
  createHash,
} from "node:crypto";

export class AppError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
export const now = () => new Date().toISOString();
export function integer(value, label, min = 0, max = 1000000000) {
  if (!Number.isSafeInteger(value) || value < min || value > max)
    throw new AppError(
      `${label} must be an integer between ${min} and ${max}.`,
    );
  return value;
}
export function string(value, label, max = 2000, required = true) {
  if (
    typeof value !== "string" ||
    value.length > max ||
    (required && !value.trim())
  )
    throw new AppError(`${label} is required (maximum ${max} characters).`);
  return value.trim();
}
const idValue = (value) => {
  const result = string(value, "ID", 32);
  if (!/^[A-Za-z0-9_-]+$/.test(result))
    throw new AppError(
      "IDs may contain letters, numbers, underscores and hyphens.",
    );
  return result.toUpperCase();
};
export const hashPassword = (password) => {
  string(password, "Password", 128);
  if (password.length < 10)
    throw new AppError("Password must have at least 10 characters.");
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
};
export const checkPassword = (password, hash) => {
  try {
    const [salt, key] = hash.split(":");
    return timingSafeEqual(
      Buffer.from(key, "hex"),
      scryptSync(password, salt, 64),
    );
  } catch {
    return false;
  }
};
export const tokenHash = (token) =>
  createHash("sha256").update(token).digest("hex");
export const defaultConfig = {
  eventName: "Robots of the Backstreet",
  eventDate: "2026-10-07",
  startTime: "15:00",
  endTime: "16:30",
  durationMinutes: 90,
  currencyName: "RAS Bolts",
  initialBolts: 0,
  allocationConfirmed: false,
  rulesConfirmed: false,
  teamLimit: null,
  postEventEditing: false,
  allowBoltTransfer: false,
  allowItemTrading: false,
  allowItemForBolts: false,
  allowItemForItem: false,
  allowMixedTrades: false,
  allowRefunds: false,
  allowNegativeBalance: false,
  allowNegativeStock: false,
  maximumPurchaseQuantity: null,
};

export class Store {
  constructor(path, { bootstrapPassword, demo = false } = {}) {
    this.path = resolve(path);
    this.demo = demo;
    mkdirSync(dirname(this.path), { recursive: true });
    this.open();
    if (
      this.get(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' LIMIT 1",
      )
    ) {
      let versions;
      try {
        versions = this.all("SELECT version FROM schema_version");
      } catch {
        this.close();
        throw new Error(
          "Existing database has no compatible schema version. Choose a new DB_PATH or restore a valid backup.",
        );
      }
      if (versions.length !== 1 || versions[0].version !== 1) {
        this.close();
        throw new Error(
          "Unsupported database schema version. The existing database was not modified.",
        );
      }
    }
    this.db.exec(
      readFileSync(new URL("./schema.sql", import.meta.url), "utf8"),
    );
    const version = this.get("SELECT version FROM schema_version");
    if (version.version !== 1) throw new Error("Unsupported schema version");
    if (!this.get("SELECT id FROM config"))
      this.run("INSERT INTO config VALUES(1,?)", JSON.stringify(defaultConfig));
    if (!this.get("SELECT id FROM operators")) {
      const password =
        bootstrapPassword || randomBytes(12).toString("base64url");
      this.run(
        "INSERT INTO operators(username,name,password_hash,role,created_at) VALUES(?,?,?,?,?)",
        "admin",
        "Event Administrator",
        hashPassword(password),
        "Admin",
        now(),
      );
      this.bootstrapPassword = password;
    }
  }
  open() {
    this.db = new DatabaseSync(this.path);
    this.db.exec(
      "PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;",
    );
  }
  close() {
    this.db.close();
  }
  get(sql, ...args) {
    return this.db.prepare(sql).get(...args);
  }
  all(sql, ...args) {
    return this.db.prepare(sql).all(...args);
  }
  run(sql, ...args) {
    return this.db.prepare(sql).run(...args);
  }
  atomic(fn) {
    const nested = !!this.depth;
    const savepoint = `nested_${this.depth || 0}`;
    this.db.exec(nested ? `SAVEPOINT ${savepoint}` : "BEGIN IMMEDIATE");
    this.depth = (this.depth || 0) + 1;
    try {
      const result = fn();
      this.db.exec(nested ? `RELEASE ${savepoint}` : "COMMIT");
      return result;
    } catch (error) {
      this.db.exec(nested ? `ROLLBACK TO ${savepoint}` : "ROLLBACK");
      if (nested) this.db.exec(`RELEASE ${savepoint}`);
      throw error;
    } finally {
      this.depth--;
    }
  }
  config() {
    return JSON.parse(this.get("SELECT value FROM config WHERE id=1").value);
  }
  audit(
    operator,
    action,
    entity,
    id,
    oldValue = null,
    newValue = null,
    reason = "",
  ) {
    const next = this.get("SELECT COALESCE(MAX(id),0)+1 n FROM audit").n;
    this.run(
      "INSERT INTO audit(ref,created_at,operator_id,action,entity_type,entity_id,old_value,new_value,reason) VALUES(?,?,?,?,?,?,?,?,?)",
      `AUD-${String(next).padStart(6, "0")}`,
      now(),
      operator.id,
      action,
      entity,
      String(id),
      oldValue === null ? null : JSON.stringify(oldValue),
      newValue === null ? null : JSON.stringify(newValue),
      reason,
    );
  }
  requireAdmin(operator) {
    if (operator.role !== "Admin")
      throw new AppError("Admin permission required.", 403);
  }
  permit(operator, roles) {
    if (!roles.includes(operator.role))
      throw new AppError("Your role does not permit this operation.", 403);
  }
  balance(team) {
    return this.get(
      "SELECT COALESCE(SUM(amount),0) value FROM bolt_ledger WHERE team_id=?",
      team,
    ).value;
  }
  stock(component, team = null) {
    return this.get(
      "SELECT COALESCE(SUM(quantity),0) value FROM inventory_movements WHERE component_id=? AND team_id IS ?",
      component,
      team,
    ).value;
  }
  team(id, active = false) {
    const row = this.get("SELECT * FROM teams WHERE id=?", id);
    if (!row) throw new AppError("Team not found.", 404);
    if (active && row.status !== "Active")
      throw new AppError("Selected team is inactive.");
    return row;
  }
  component(id, active = false) {
    const row = this.get("SELECT * FROM components WHERE id=?", id);
    if (!row) throw new AppError("Component not found.", 404);
    if (active && row.status !== "Active")
      throw new AppError("Selected component is inactive.");
    return row;
  }
  timer(at = Date.now()) {
    const t = this.get("SELECT * FROM timer WHERE id=1");
    const duration = this.config().durationMinutes * 60000;
    const elapsed =
      t.elapsed_ms +
      (t.state === "ACTIVE" ? Math.max(0, at - Date.parse(t.resumed_at)) : 0);
    return {
      ...t,
      state: t.state === "ACTIVE" && elapsed >= duration ? "ENDED" : t.state,
      elapsed_ms: Math.min(duration, elapsed),
      remaining_ms: Math.max(0, duration - elapsed),
      ended_at:
        t.ended_at ||
        (t.state === "ACTIVE" && elapsed >= duration
          ? new Date(
              Date.parse(t.resumed_at) + Math.max(0, duration - t.elapsed_ms),
            ).toISOString()
          : null),
      server_time: now(),
    };
  }
  gate(operator) {
    const t = this.timer();
    if (
      t.state === "ENDED" &&
      this.config().postEventEditing &&
      operator.role === "Admin"
    )
      return;
    if (t.state !== "ACTIVE")
      throw new AppError(
        `Transactions locked: competition ${t.state.replaceAll("_", " ").toLowerCase()}.`,
      );
    if (!this.config().rulesConfirmed)
      throw new AppError("Admin must confirm competition rules in Settings.");
  }
  timerAction(operator, action) {
    this.requireAdmin(operator);
    return this.atomic(() => {
      const old = this.timer();
      const stamp = now();
      if (action === "start") {
        if (old.state !== "NOT_STARTED")
          throw new AppError("Timer has already started.");
        const c = this.config();
        if (!c.rulesConfirmed || !c.allocationConfirmed)
          throw new AppError(
            "Confirm rules and initial RAS Bolts allocation in Settings first.",
          );
        this.run(
          "UPDATE timer SET state='ACTIVE',started_at=?,resumed_at=?,ended_at=NULL,elapsed_ms=0",
          stamp,
          stamp,
        );
      } else if (action === "pause") {
        if (old.state !== "ACTIVE")
          throw new AppError("Only an active timer can be paused.");
        this.run(
          "UPDATE timer SET state='PAUSED',elapsed_ms=?,resumed_at=NULL",
          old.elapsed_ms,
        );
      } else if (action === "resume") {
        if (old.state !== "PAUSED")
          throw new AppError("Only a paused timer can be resumed.");
        this.run("UPDATE timer SET state='ACTIVE',resumed_at=?", stamp);
      } else if (action === "end") {
        if (old.state === "NOT_STARTED")
          throw new AppError("Start the competition before ending it.");
        if (old.state === "ENDED")
          throw new AppError("Competition already ended.");
        this.run(
          "UPDATE timer SET state='ENDED',elapsed_ms=?,ended_at=?,resumed_at=NULL",
          old.elapsed_ms,
          stamp,
        );
      } else if (action === "reset") {
        if (
          this.get(
            "SELECT id FROM transactions WHERE kind IN ('PURCHASE','TRADE') LIMIT 1",
          )
        )
          throw new AppError(
            "Timer reset is blocked after purchases or trades. Use a separate database for a new event.",
          );
        this.run(
          "UPDATE timer SET state='NOT_STARTED',started_at=NULL,resumed_at=NULL,ended_at=NULL,elapsed_ms=0",
        );
      } else throw new AppError("Unknown timer action.");
      this.audit(
        operator,
        `TIMER_${action.toUpperCase()}`,
        "timer",
        "1",
        old,
        this.timer(),
      );
      return this.timer();
    });
  }
  saveConfig(operator, input) {
    this.requireAdmin(operator);
    return this.atomic(() => {
      const old = this.config();
      const next = { ...old };
      for (const key of ["eventName", "eventDate", "startTime", "endTime"])
        if (key in input) next[key] = string(input[key], key, 120);
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(next.eventDate) ||
        !/^([01]\d|2[0-3]):[0-5]\d$/.test(next.startTime) ||
        !/^([01]\d|2[0-3]):[0-5]\d$/.test(next.endTime) ||
        !Number.isFinite(Date.parse(next.eventDate)) ||
        new Date(next.eventDate).toISOString().slice(0, 10) !== next.eventDate
      )
        throw new AppError("Use an ISO date and HH:MM times.");
      for (const key of ["durationMinutes", "initialBolts"])
        if (key in input)
          next[key] = integer(
            input[key],
            key,
            key === "durationMinutes" ? 1 : 0,
            key === "durationMinutes" ? 1440 : 1000000000,
          );
      for (const key of ["teamLimit", "maximumPurchaseQuantity"])
        if (key in input)
          next[key] = input[key] === null ? null : integer(input[key], key, 1);
      for (const key of Object.keys(old).filter(
        (k) => typeof old[k] === "boolean",
      ))
        if (key in input) {
          if (typeof input[key] !== "boolean")
            throw new AppError(`${key} must be true or false.`);
          next[key] = input[key];
        }
      next.currencyName = "RAS Bolts";
      if (
        this.timer().state !== "NOT_STARTED" &&
        next.durationMinutes !== old.durationMinutes
      )
        throw new AppError("Duration cannot change after timer start.");
      this.run("UPDATE config SET value=? WHERE id=1", JSON.stringify(next));
      this.audit(operator, "CONFIG_UPDATE", "config", "1", old, next);
      return next;
    });
  }
  transaction(operator, kind, input, fn, { gated = true } = {}) {
    return this.atomic(() => {
      const key = string(input.requestKey, "Request key", 100);
      if (key.length < 16)
        throw new AppError("Request key must have at least 16 characters.");
      const payload = JSON.stringify({ kind, input });
      const existing = this.get(
        "SELECT * FROM transactions WHERE request_key=?",
        key,
      );
      if (existing) {
        if (existing.request_payload !== payload)
          throw new AppError(
            "Request key was already used for different data.",
            409,
          );
        if (existing.operator_id !== operator.id)
          throw new AppError("Request belongs to another operator.", 409);
        return { ...existing, duplicate: true };
      }
      if (gated) this.gate(operator);
      const t = this.timer();
      const result = this.run(
        "INSERT INTO transactions(kind,request_key,request_payload,operator_id,created_at,elapsed_ms,remaining_ms,notes,correction_of) VALUES(?,?,?,?,?,?,?,?,?)",
        kind,
        key,
        payload,
        operator.id,
        now(),
        t.elapsed_ms,
        t.remaining_ms,
        string(input.notes ?? "", "Notes", 2000, false),
        input.correctionOf ?? null,
      );
      const id = Number(result.lastInsertRowid);
      this.run(
        "UPDATE transactions SET ref=? WHERE id=?",
        `TXN-${String(id).padStart(6, "0")}`,
        id,
      );
      const txn = this.get("SELECT * FROM transactions WHERE id=?", id);
      if (input.correctionOf) {
        this.requireAdmin(operator);
        const original = this.get(
          "SELECT * FROM transactions WHERE id=? AND status='VOIDED'",
          input.correctionOf,
        );
        if (!original)
          throw new AppError("Correction must reference a voided transaction.");
        if (
          this.get(
            "SELECT id FROM transactions WHERE correction_of=? AND id<>?",
            input.correctionOf,
            id,
          )
        )
          throw new AppError("A replacement already exists.");
      }
      fn(txn);
      this.audit(
        operator,
        kind,
        "transaction",
        txn.ref,
        null,
        txn,
        input.notes ?? "",
      );
      return this.get("SELECT * FROM transactions WHERE id=?", id);
    });
  }
  bolt(txn, team, amount, type) {
    integer(Math.abs(amount), "RAS Bolts amount");
    if (!amount) return;
    const before = this.balance(team);
    const after = before + amount;
    if (!Number.isSafeInteger(after))
      throw new AppError("RAS Bolts balance exceeds safe integer range.");
    if (after < 0 && !this.config().allowNegativeBalance)
      throw new AppError(
        `INSUFFICIENT RAS BOLTS — Team ${team}. Available: ${before}. Required: ${-amount}.`,
      );
    this.run(
      "INSERT INTO bolt_ledger(transaction_id,team_id,type,amount,balance_before,balance_after) VALUES(?,?,?,?,?,?)",
      txn.id,
      team,
      type,
      amount,
      before,
      after,
    );
  }
  movement(txn, component, team, quantity) {
    if (!quantity) return;
    const before = this.stock(component, team);
    const after = before + quantity;
    if (!Number.isSafeInteger(after))
      throw new AppError("Inventory exceeds safe integer range.");
    if (after < 0 && (team !== null || !this.config().allowNegativeStock))
      throw new AppError(
        `${team ? `Team ${team} does not own enough ${this.component(component).name}` : "OUT OF STOCK"}. Available: ${before}. Requested: ${-quantity}. Reverse subsequent transfers first if voiding.`,
      );
    this.run(
      "INSERT INTO inventory_movements(transaction_id,component_id,team_id,quantity,quantity_before,quantity_after) VALUES(?,?,?,?,?,?)",
      txn.id,
      component,
      team,
      quantity,
      before,
      after,
    );
  }
  saveTeam(operator, input, id = null) {
    this.requireAdmin(operator);
    return this.atomic(() => {
      const old = id ? this.teamDetails(id) : null;
      const teamId = id || idValue(input.id);
      const name = string(input.name, "Team name", 120);
      const status = input.status ?? "Active";
      if (!["Active", "Inactive"].includes(status))
        throw new AppError("Invalid team status.");
      const members = input.members ?? [];
      if (!Array.isArray(members) || members.length > 50)
        throw new AppError("Invalid team members.");
      const values = [
        string(input.number ?? teamId, "Team number", 30),
        name,
        string(input.project ?? "", "Project", 200, false),
        string(input.description ?? "", "Description", 4000, false),
        string(input.notes ?? "", "Notes", 4000, false),
        status,
        now(),
      ];
      if (old)
        this.run(
          "UPDATE teams SET number=?,name=?,project=?,description=?,notes=?,status=?,updated_at=? WHERE id=?",
          ...values,
          teamId,
        );
      else {
        const c = this.config();
        if (
          c.teamLimit &&
          this.get("SELECT COUNT(*) n FROM teams").n >= c.teamLimit
        )
          throw new AppError("Configured team limit reached.");
        this.run(
          "INSERT INTO teams(number,name,project,description,notes,status,updated_at,id,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
          ...values,
          teamId,
          now(),
        );
        const amount = integer(
          input.initialBolts ?? c.initialBolts,
          "Initial RAS Bolts",
        );
        if (!c.allocationConfirmed)
          throw new AppError(
            "Confirm the initial allocation in Settings before creating teams.",
          );
        this.transaction(
          operator,
          "INITIAL_BALANCE",
          {
            requestKey: `initial-team-${teamId}-${randomBytes(8).toString("hex")}`,
            notes: "Initial RAS Bolts allocation",
          },
          (txn) => this.bolt(txn, teamId, amount, "INITIAL_BALANCE"),
          { gated: false },
        );
      }
      this.run("DELETE FROM members WHERE team_id=?", teamId);
      for (const member of members)
        this.run(
          "INSERT INTO members(team_id,name,contact) VALUES(?,?,?)",
          teamId,
          string(
            typeof member === "string" ? member : member.name,
            "Member name",
            120,
          ),
          string(
            typeof member === "string" ? "" : (member.contact ?? ""),
            "Contact",
            150,
            false,
          ),
        );
      this.audit(
        operator,
        old ? "TEAM_UPDATE" : "TEAM_CREATE",
        "team",
        teamId,
        old,
        { ...input, id: teamId },
      );
      return this.teamDetails(teamId);
    });
  }
  saveMitra(operator, input, id = null) {
    this.requireAdmin(operator);
    return this.atomic(() => {
      const old = id ? this.get("SELECT * FROM mitras WHERE id=?", id) : null;
      if (id && !old) throw new AppError("Mitra not found.", 404);
      const key = id || idValue(input.id);
      const status = input.status ?? "Active";
      if (!["Active", "Inactive", "Available", "Assigned"].includes(status))
        throw new AppError("Invalid Mitra status.");
      const values = [
        string(input.name, "Mitra name", 120),
        string(input.contact ?? "", "Contact", 150, false),
        string(input.notes ?? "", "Notes", 4000, false),
        status,
        now(),
      ];
      if (old)
        this.run(
          "UPDATE mitras SET name=?,contact=?,notes=?,status=?,updated_at=? WHERE id=?",
          ...values,
          key,
        );
      else
        this.run(
          "INSERT INTO mitras(name,contact,notes,status,updated_at,id,created_at) VALUES(?,?,?,?,?,?,?)",
          ...values,
          key,
          now(),
        );
      this.audit(
        operator,
        old ? "MITRA_UPDATE" : "MITRA_CREATE",
        "mitra",
        key,
        old,
        input,
      );
      return this.get("SELECT * FROM mitras WHERE id=?", key);
    });
  }
  assign(operator, team, mitra) {
    this.requireAdmin(operator);
    return this.atomic(() => {
      this.team(team);
      const old =
        this.get("SELECT * FROM assignments WHERE team_id=?", team) ?? null;
      if (mitra) {
        const m = this.get("SELECT * FROM mitras WHERE id=?", mitra);
        if (!m || m.status === "Inactive")
          throw new AppError("Choose an active Mentor Mitra.");
        this.run(
          "INSERT INTO assignments VALUES(?,?,?) ON CONFLICT(team_id) DO UPDATE SET mitra_id=excluded.mitra_id,assigned_at=excluded.assigned_at",
          team,
          mitra,
          now(),
        );
      } else this.run("DELETE FROM assignments WHERE team_id=?", team);
      this.audit(operator, "MITRA_ASSIGNMENT", "team", team, old, { mitra });
      return this.teamDetails(team);
    });
  }
  saveComponent(operator, input, id = null) {
    this.requireAdmin(operator);
    return this.atomic(() => {
      const old = id ? this.component(id) : null;
      const key = id || idValue(input.id);
      const price = integer(input.price, "Unit price");
      const max =
        input.max_per_team == null
          ? null
          : integer(input.max_per_team, "Per-team limit", 1);
      const status = input.status ?? "Active";
      if (!["Active", "Inactive"].includes(status))
        throw new AppError("Invalid component status.");
      const values = [
        string(input.name, "Component name", 120),
        string(input.category ?? "", "Category", 100, false),
        string(input.description ?? "", "Description", 4000, false),
        price,
        max,
        string(input.notes ?? "", "Notes", 4000, false),
        status,
        now(),
      ];
      if (old)
        this.run(
          "UPDATE components SET name=?,category=?,description=?,price=?,max_per_team=?,notes=?,status=?,updated_at=? WHERE id=?",
          ...values,
          key,
        );
      else {
        this.run(
          "INSERT INTO components(name,category,description,price,max_per_team,notes,status,updated_at,id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
          ...values,
          key,
          now(),
        );
        const quantity = integer(
          input.initialQuantity ?? 0,
          "Initial quantity",
        );
        this.run(
          "UPDATE components SET initial_quantity=? WHERE id=?",
          quantity,
          key,
        );
        this.transaction(
          operator,
          "INVENTORY_ADJUSTMENT",
          {
            requestKey: `initial-stock-${key}-${randomBytes(8).toString("hex")}`,
            notes: "Initial shop inventory",
          },
          (txn) => this.movement(txn, key, null, quantity),
          { gated: false },
        );
      }
      this.audit(
        operator,
        old ? "COMPONENT_UPDATE" : "COMPONENT_CREATE",
        "component",
        key,
        old,
        input,
      );
      return { ...this.component(key), stock: this.stock(key) };
    });
  }
  purchase(operator, input) {
    this.permit(operator, ["Admin", "Shop Operator"]);
    return this.transaction(operator, "PURCHASE", input, (txn) => {
      const team = this.team(input.teamId, true);
      const item = this.component(input.componentId, true);
      const quantity = integer(input.quantity, "Quantity", 1);
      const c = this.config();
      if (c.maximumPurchaseQuantity && quantity > c.maximumPurchaseQuantity)
        throw new AppError("Maximum purchase quantity exceeded.");
      if (input.expectedPrice !== item.price)
        throw new AppError("Price changed. Review the purchase again.", 409);
      if (item.max_per_team) {
        const bought = this.get(
          "SELECT COALESCE(SUM(p.quantity),0) n FROM purchases p JOIN transactions t ON t.id=p.transaction_id WHERE p.team_id=? AND p.component_id=? AND t.status='COMPLETED'",
          team.id,
          item.id,
        ).n;
        const returned = this.get(
          "SELECT COALESCE(SUM(r.quantity),0) n FROM refunds r JOIN purchases p ON p.id=r.purchase_id JOIN transactions t ON t.id=r.transaction_id WHERE p.team_id=? AND p.component_id=? AND t.status='COMPLETED'",
          team.id,
          item.id,
        ).n;
        if (bought - returned + quantity > item.max_per_team)
          throw new AppError("Per-team purchase limit exceeded.");
      }
      const total = integer(quantity * item.price, "Total RAS Bolts");
      const before = this.balance(team.id);
      this.bolt(txn, team.id, -total, "PURCHASE");
      this.movement(txn, item.id, null, -quantity);
      this.movement(txn, item.id, team.id, quantity);
      const result = this.run(
        "INSERT INTO purchases(transaction_id,team_id,component_id,team_name,component_name,quantity,unit_price,total,balance_before,balance_after) VALUES(?,?,?,?,?,?,?,?,?,?)",
        txn.id,
        team.id,
        item.id,
        team.name,
        item.name,
        quantity,
        item.price,
        total,
        before,
        this.balance(team.id),
      );
      this.run(
        "UPDATE purchases SET ref=? WHERE id=?",
        `PUR-${String(result.lastInsertRowid).padStart(6, "0")}`,
        Number(result.lastInsertRowid),
      );
    });
  }
  trade(operator, input) {
    this.permit(operator, ["Admin", "Trade Operator"]);
    return this.transaction(operator, "TRADE", input, (txn) => {
      const a = this.team(input.teamA, true);
      const b = this.team(input.teamB, true);
      if (a.id === b.id) throw new AppError("A team cannot trade with itself.");
      const boltsA = integer(input.boltsA ?? 0, "Team A RAS Bolts");
      const boltsB = integer(input.boltsB ?? 0, "Team B RAS Bolts");
      const normalize = (items) => {
        if (!Array.isArray(items) || items.length > 50)
          throw new AppError("Invalid trade items.");
        const seen = new Set();
        return items.map((item) => {
          this.component(item.componentId);
          if (seen.has(item.componentId))
            throw new AppError("Combine duplicate components into one line.");
          seen.add(item.componentId);
          return {
            componentId: item.componentId,
            quantity: integer(item.quantity, "Quantity", 1),
          };
        });
      };
      const itemsA = normalize(input.itemsA ?? []),
        itemsB = normalize(input.itemsB ?? []);
      const hasItems = itemsA.length + itemsB.length > 0,
        hasBolts = boltsA + boltsB > 0;
      const c = this.config();
      if (!hasItems && !hasBolts)
        throw new AppError("Trade must transfer an item or RAS Bolts.");
      if (hasItems && !c.allowItemTrading)
        throw new AppError("Item trading is disabled.");
      if (!hasItems && hasBolts && !c.allowBoltTransfer)
        throw new AppError("Team-to-team RAS Bolt transfer is disabled.");
      if (hasItems && !hasBolts && !c.allowItemForItem)
        throw new AppError("Item-for-item transfers are disabled.");
      if (hasItems && hasBolts && !c.allowItemForBolts)
        throw new AppError("Item-for-RAS Bolts trading is disabled.");
      if (
        hasItems &&
        hasBolts &&
        ((itemsA.length && itemsB.length) || (boltsA && boltsB)) &&
        !c.allowMixedTrades
      )
        throw new AppError("Mixed bilateral trades are disabled.");
      for (const [team, amount] of [
        [a.id, boltsA],
        [b.id, boltsB],
      ])
        if (amount > this.balance(team) && !c.allowNegativeBalance)
          throw new AppError(
            `INSUFFICIENT RAS BOLTS — Team ${team}. Available: ${this.balance(team)}. Required: ${amount}.`,
          );
      for (const [team, items] of [
        [a.id, itemsA],
        [b.id, itemsB],
      ])
        for (const item of items)
          if (this.stock(item.componentId, team) < item.quantity)
            throw new AppError(
              `Team ${team} does not own ${item.quantity} ${this.component(item.componentId).name}.`,
            );
      const result = this.run(
        "INSERT INTO trades(transaction_id,team_a,team_b,bolts_a,bolts_b) VALUES(?,?,?,?,?)",
        txn.id,
        a.id,
        b.id,
        boltsA,
        boltsB,
      );
      const id = Number(result.lastInsertRowid);
      this.run(
        "UPDATE trades SET ref=? WHERE id=?",
        `TR-${String(id).padStart(6, "0")}`,
        id,
      );
      this.bolt(txn, a.id, -boltsA, "TRADE_PAYMENT");
      this.bolt(txn, b.id, boltsA, "TRADE_RECEIPT");
      this.bolt(txn, b.id, -boltsB, "TRADE_PAYMENT");
      this.bolt(txn, a.id, boltsB, "TRADE_RECEIPT");
      for (const [from, to, items] of [
        [a.id, b.id, itemsA],
        [b.id, a.id, itemsB],
      ])
        for (const item of items) {
          this.movement(txn, item.componentId, from, -item.quantity);
          this.movement(txn, item.componentId, to, item.quantity);
          this.run(
            "INSERT INTO trade_items(trade_id,from_team,to_team,component_id,component_name,quantity) VALUES(?,?,?,?,?,?)",
            id,
            from,
            to,
            item.componentId,
            this.component(item.componentId).name,
            item.quantity,
          );
        }
    });
  }
  adjustment(operator, input) {
    this.requireAdmin(operator);
    const type = input.type ?? "MANUAL_ADJUSTMENT";
    if (
      ![
        "INITIAL_BALANCE",
        "BONUS",
        "PENALTY",
        "MANUAL_ADJUSTMENT",
        "CORRECTION",
      ].includes(type)
    )
      throw new AppError("Invalid adjustment type.");
    string(input.notes, "Reason");
    return this.transaction(
      operator,
      type,
      input,
      (txn) => {
        this.team(input.teamId);
        if (type === "INITIAL_BALANCE") {
          if (this.timer().state !== "NOT_STARTED")
            throw new AppError(
              "Initial allocation changes are permitted only before timer start.",
            );
          if (
            this.get(
              "SELECT l.id FROM bolt_ledger l JOIN transactions t ON t.id=l.transaction_id WHERE l.team_id=? AND t.kind<>'INITIAL_BALANCE' LIMIT 1",
              input.teamId,
            )
          )
            throw new AppError(
              "This team has other financial history. Use a normal correction during permitted competition editing.",
            );
        }
        const amount = integer(Math.abs(input.amount), "Adjustment amount", 1);
        if (
          (type === "BONUS" && input.amount < 0) ||
          (type === "PENALTY" && input.amount > 0)
        )
          throw new AppError(
            "Bonus must be positive; penalty must be negative.",
          );
        this.bolt(txn, input.teamId, input.amount < 0 ? -amount : amount, type);
      },
      { gated: type !== "INITIAL_BALANCE" },
    );
  }
  adjustInventory(operator, input) {
    this.requireAdmin(operator);
    string(input.notes, "Reason");
    return this.transaction(
      operator,
      "INVENTORY_ADJUSTMENT",
      input,
      (txn) => {
        this.component(input.componentId);
        if (input.teamId) this.team(input.teamId);
        const qty = integer(Math.abs(input.quantity), "Quantity", 1);
        this.movement(
          txn,
          input.componentId,
          input.teamId || null,
          input.quantity < 0 ? -qty : qty,
        );
      },
      { gated: false },
    );
  }
  void(operator, input) {
    this.requireAdmin(operator);
    string(input.notes, "Void reason");
    return this.transaction(
      operator,
      "CORRECTION",
      input,
      (txn) => {
        const original = this.get(
          "SELECT * FROM transactions WHERE id=?",
          input.transactionId,
        );
        if (
          !original ||
          original.status !== "COMPLETED" ||
          original.reversal_of
        )
          throw new AppError(
            "Only an unreversed completed original transaction can be voided.",
          );
        this.run(
          "UPDATE transactions SET reversal_of=? WHERE id=?",
          original.id,
          txn.id,
        );
        if (
          original.kind === "PURCHASE" &&
          this.get(
            "SELECT r.id FROM refunds r JOIN transactions t ON t.id=r.transaction_id JOIN purchases p ON p.id=r.purchase_id WHERE p.transaction_id=? AND t.status='COMPLETED' LIMIT 1",
            original.id,
          )
        )
          throw new AppError("Void active refunds for this purchase first.");
        const bolts = this.all(
          "SELECT team_id,SUM(amount) amount FROM bolt_ledger WHERE transaction_id=? GROUP BY team_id",
          original.id,
        );
        const items = this.all(
          "SELECT component_id,team_id,SUM(quantity) quantity FROM inventory_movements WHERE transaction_id=? GROUP BY component_id,team_id",
          original.id,
        );
        for (const row of bolts)
          this.bolt(txn, row.team_id, -row.amount, "CORRECTION");
        for (const row of items)
          this.movement(txn, row.component_id, row.team_id, -row.quantity);
        this.run(
          "UPDATE transactions SET status='VOIDED' WHERE id=?",
          original.id,
        );
        this.audit(
          operator,
          "VOID_TRANSACTION",
          "transaction",
          original.ref,
          original,
          { status: "VOIDED", reversal: txn.ref },
          input.notes,
        );
      },
      { gated: false },
    );
  }
  teamDetails(id) {
    const team = this.team(id);
    const stats = this.get(
      "SELECT COALESCE(SUM(CASE WHEN l.type='INITIAL_BALANCE' THEN l.amount ELSE 0 END),0) initial,COALESCE(SUM(CASE WHEN l.type IN ('PURCHASE','REFUND') AND t.status='COMPLETED' THEN -l.amount ELSE 0 END),0) spent,COALESCE(SUM(CASE WHEN l.type='TRADE_PAYMENT' AND t.status='COMPLETED' THEN -l.amount ELSE 0 END),0) trade_paid,COALESCE(SUM(CASE WHEN l.type='TRADE_RECEIPT' AND t.status='COMPLETED' THEN l.amount ELSE 0 END),0) trade_received,COALESCE(SUM(CASE WHEN l.amount>0 AND t.status='COMPLETED' THEN l.amount ELSE 0 END),0) received FROM bolt_ledger l JOIN transactions t ON t.id=l.transaction_id WHERE l.team_id=?",
      id,
    );
    return {
      ...team,
      ...stats,
      total_spent: stats.spent + stats.trade_paid,
      total_trade_value: stats.trade_paid + stats.trade_received,
      balance: this.balance(id),
      members: this.all("SELECT * FROM members WHERE team_id=?", id),
      mitra:
        this.get(
          "SELECT m.* FROM mitras m JOIN assignments a ON a.mitra_id=m.id WHERE a.team_id=?",
          id,
        ) ?? null,
      inventory: this.all(
        "SELECT c.id,c.name,SUM(m.quantity) quantity FROM inventory_movements m JOIN components c ON c.id=m.component_id WHERE m.team_id=? GROUP BY c.id HAVING SUM(m.quantity)<>0",
        id,
      ),
      purchase_count: this.get(
        "SELECT COUNT(*) n FROM purchases p JOIN transactions t ON t.id=p.transaction_id WHERE p.team_id=? AND t.status='COMPLETED'",
        id,
      ).n,
      trade_count: this.get(
        "SELECT COUNT(*) n FROM trades r JOIN transactions t ON t.id=r.transaction_id WHERE (r.team_a=? OR r.team_b=?) AND t.status='COMPLETED'",
        id,
        id,
      ).n,
    };
  }
  operators() {
    return this.all(
      "SELECT id,username,name,role,active,created_at FROM operators",
    );
  }
  saveOperator(operator, input, id = null) {
    this.requireAdmin(operator);
    return this.atomic(() => {
      const old = id
        ? this.get(
            "SELECT id,username,name,role,active FROM operators WHERE id=?",
            id,
          )
        : null;
      const role = input.role;
      if (
        !["Admin", "Shop Operator", "Trade Operator", "Viewer"].includes(role)
      )
        throw new AppError("Invalid operator role.");
      const username = string(input.username, "Username", 80);
      if (!/^[a-zA-Z0-9._-]+$/.test(username))
        throw new AppError("Username contains invalid characters.");
      const name = string(input.name, "Name", 120);
      const active = input.active === false ? 0 : 1;
      if (id === operator.id && (role !== "Admin" || !active))
        throw new AppError("You cannot remove your own admin access.");
      if (id) {
        if (!this.get("SELECT id FROM operators WHERE id=?", id))
          throw new AppError("Operator not found.", 404);
        this.run(
          "UPDATE operators SET username=?,name=?,role=?,active=? WHERE id=?",
          username,
          name,
          role,
          active,
          id,
        );
        if (input.password)
          this.run(
            "UPDATE operators SET password_hash=? WHERE id=?",
            hashPassword(input.password),
            id,
          );
        this.run("DELETE FROM sessions WHERE operator_id=?", id);
      } else {
        const r = this.run(
          "INSERT INTO operators(username,name,role,active,password_hash,created_at) VALUES(?,?,?,?,?,?)",
          username,
          name,
          role,
          active,
          hashPassword(input.password),
          now(),
        );
        id = Number(r.lastInsertRowid);
      }
      this.audit(operator, "OPERATOR_SAVE", "operator", id, old, {
        username,
        name,
        role,
        active,
      });
      return this.operators();
    });
  }
  async backupTo(target) {
    mkdirSync(dirname(target), { recursive: true });
    await backup(this.db, target);
    return target;
  }
  validateBackup(path) {
    let candidate;
    try {
      candidate = new DatabaseSync(path, { readOnly: true });
      if (
        candidate.prepare("PRAGMA integrity_check").get().integrity_check !==
        "ok"
      )
        throw new Error("Integrity check failed");
      if (
        candidate.prepare("SELECT version FROM schema_version").get()
          ?.version !== 1
      )
        throw new Error("Incompatible schema");
      const objectsSql =
        "SELECT type,name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name";
      if (
        JSON.stringify(this.all(objectsSql)) !==
        JSON.stringify(candidate.prepare(objectsSql).all())
      )
        throw new Error(
          "Database schema or protection triggers differ from this application",
        );
      const expected = this.all(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
      ).map((r) => r.name);
      for (const name of expected) {
        const source = this.all(`PRAGMA table_info(${name})`).map(
          (r) => `${r.name}:${r.type}`,
        );
        const target = candidate
          .prepare(`PRAGMA table_info(${name})`)
          .all()
          .map((r) => `${r.name}:${r.type}`);
        if (JSON.stringify(source) !== JSON.stringify(target))
          throw new Error(`Schema mismatch: ${name}`);
      }
      if (candidate.prepare("PRAGMA foreign_key_check").all().length)
        throw new Error("Invalid foreign keys");
      const config = JSON.parse(
        candidate.prepare("SELECT value FROM config WHERE id=1").get().value,
      );
      if (
        config.currencyName !== "RAS Bolts" ||
        !Number.isInteger(config.durationMinutes) ||
        config.durationMinutes < 1
      )
        throw new Error("Invalid configuration");
      for (const [key, value] of Object.entries(defaultConfig)) {
        if (typeof value === "boolean" && typeof config[key] !== "boolean")
          throw new Error(`Invalid rule: ${key}`);
        if (typeof value === "string" && typeof config[key] !== "string")
          throw new Error(`Invalid setting: ${key}`);
      }
      integer(config.durationMinutes, "Duration", 1, 1440);
      integer(config.initialBolts, "Initial RAS Bolts");
      for (const key of ["teamLimit", "maximumPurchaseQuantity"])
        if (config[key] !== null) integer(config[key], key, 1);
      const boltChain = candidate
        .prepare(
          "SELECT * FROM (SELECT *,COALESCE(SUM(amount) OVER (PARTITION BY team_id ORDER BY id ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING),0) expected FROM bolt_ledger) WHERE balance_before<>expected",
        )
        .all();
      const itemChain = candidate
        .prepare(
          "SELECT * FROM (SELECT *,COALESCE(SUM(quantity) OVER (PARTITION BY component_id,team_id ORDER BY id ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING),0) expected FROM inventory_movements) WHERE quantity_before<>expected",
        )
        .all();
      if (boltChain.length || itemChain.length)
        throw new Error("Ledger running totals are inconsistent");
      if (
        candidate
          .prepare(
            "SELECT t.id FROM transactions t WHERE t.status IN ('PENDING','CORRECTED') AND (EXISTS(SELECT 1 FROM bolt_ledger l WHERE l.transaction_id=t.id) OR EXISTS(SELECT 1 FROM inventory_movements m WHERE m.transaction_id=t.id))",
          )
          .get()
      )
        throw new Error("Uncommitted transaction has posted ledger entries");
      if (
        candidate
          .prepare(
            "SELECT t.id FROM transactions t LEFT JOIN transactions r ON r.reversal_of=t.id WHERE (t.status='VOIDED' AND (r.id IS NULL OR r.status<>'COMPLETED')) OR (r.id IS NOT NULL AND t.status<>'VOIDED')",
          )
          .get()
      )
        throw new Error("Invalid reversal relationship");
      if (
        !candidate
          .prepare("SELECT id FROM operators WHERE active=1 AND role='Admin'")
          .get()
      )
        throw new Error("Backup has no active administrator");
      if (!candidate.prepare("SELECT id FROM timer WHERE id=1").get())
        throw new Error("Missing timer");
      const unexpected = candidate
        .prepare(
          "SELECT name FROM sqlite_master WHERE type IN ('view','trigger')",
        )
        .all()
        .map((r) => r.name);
      const allowed = this.all(
        "SELECT name FROM sqlite_master WHERE type IN ('view','trigger')",
      ).map((r) => r.name);
      if (unexpected.some((name) => !allowed.includes(name)))
        throw new Error("Unexpected database objects");
      return true;
    } catch (error) {
      throw new AppError(`Invalid backup: ${error.message}`);
    } finally {
      candidate?.close();
    }
  }
  async restoreFrom(path, operator) {
    this.requireAdmin(operator);
    this.validateBackup(path);
    const pre = resolve(
      dirname(this.path),
      "backups",
      `pre-restore-${Date.now()}.sqlite`,
    );
    await this.backupTo(pre);
    const staged = `${this.path}.restore`;
    const candidate = new DatabaseSync(path, { readOnly: true });
    try {
      await backup(candidate, staged);
    } finally {
      candidate.close();
    }
    this.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    this.close();
    try {
      renameSync(this.path, `${this.path}.previous`);
      renameSync(staged, this.path);
      for (const suffix of ["-wal", "-shm"])
        if (existsSync(this.path + suffix)) rmSync(this.path + suffix);
      this.open();
      this.atomic(() => {
        let restored = this.get(
          "SELECT id FROM operators WHERE username=?",
          operator.username,
        );
        if (!restored) {
          const r = this.run(
            "INSERT INTO operators(username,name,password_hash,role,active,created_at) VALUES(?,?,?,?,0,?)",
            `restore-${randomBytes(6).toString("hex")}`,
            operator.name,
            hashPassword(randomBytes(16).toString("hex")),
            "Viewer",
            now(),
          );
          restored = { id: Number(r.lastInsertRowid) };
        }
        this.run("DELETE FROM sessions");
        this.audit(
          restored,
          "DATABASE_RESTORE",
          "database",
          "1",
          null,
          { preRestoreBackup: pre, performedBy: operator.username },
          "Administrator confirmed RESTORE DATABASE",
        );
      });
      rmSync(`${this.path}.previous`);
      return { success: true, preRestoreBackup: pre };
    } catch (error) {
      try {
        this.close();
      } catch {
        /* Closed connection. */
      }
      if (existsSync(`${this.path}.previous`)) {
        if (existsSync(this.path)) rmSync(this.path);
        renameSync(`${this.path}.previous`, this.path);
      }
      this.open();
      throw error;
    }
  }
  refund(operator, input) {
    this.requireAdmin(operator);
    string(input.notes, "Refund reason");
    return this.transaction(operator, "REFUND", input, (txn) => {
      if (!this.config().allowRefunds)
        throw new AppError("Refunds are disabled in competition rules.");
      const p = this.get(
        "SELECT p.* FROM purchases p JOIN transactions t ON t.id=p.transaction_id WHERE p.id=? AND t.status='COMPLETED'",
        input.purchaseId,
      );
      if (!p) throw new AppError("Choose a completed purchase.");
      const quantity = integer(input.quantity, "Returned quantity", 1);
      const returned = this.get(
        "SELECT COALESCE(SUM(r.quantity),0) n FROM refunds r JOIN transactions t ON t.id=r.transaction_id WHERE r.purchase_id=? AND t.status='COMPLETED'",
        p.id,
      ).n;
      if (quantity > p.quantity - returned)
        throw new AppError(
          `Only ${p.quantity - returned} unrefunded items remain in this purchase.`,
        );
      this.movement(txn, p.component_id, p.team_id, -quantity);
      this.movement(txn, p.component_id, null, quantity);
      this.bolt(txn, p.team_id, quantity * p.unit_price, "REFUND");
      this.run(
        "INSERT INTO refunds(transaction_id,purchase_id,quantity,total) VALUES(?,?,?,?)",
        txn.id,
        p.id,
        quantity,
        quantity * p.unit_price,
      );
    });
  }
  integrity() {
    return {
      integrity: this.get("PRAGMA integrity_check").integrity_check,
      foreignKeys: this.all("PRAGMA foreign_key_check"),
      ledgerErrors: this.all(
        "SELECT * FROM (SELECT *,COALESCE(SUM(amount) OVER (PARTITION BY team_id ORDER BY id ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING),0) expected FROM bolt_ledger) WHERE balance_before<>expected OR balance_after<>balance_before+amount",
      ),
      inventoryErrors: this.all(
        "SELECT * FROM (SELECT *,COALESCE(SUM(quantity) OVER (PARTITION BY component_id,team_id ORDER BY id ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING),0) expected FROM inventory_movements) WHERE quantity_before<>expected OR quantity_after<>quantity_before+quantity",
      ),
    };
  }
}

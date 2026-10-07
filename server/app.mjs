import express from "express";
import { STARTERS, PROJECTS } from "./event-rules.mjs";
import multer from "multer";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import {
  AppError,
  checkPassword,
  tokenHash,
  integer,
  string,
} from "./store.mjs";
import {
  teams,
  mitras,
  components,
  history,
  auditRows,
  summary,
  purchaseSummary,
} from "./queries.mjs";
import { workbook, csv } from "./export.mjs";

export function createApp(store, { devOrigin = null } = {}) {
  const app = express();
  let maintenance = false;
  const attempts = new Map();
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    res.set("X-Content-Type-Options", "nosniff");
    res.set("Referrer-Policy", "same-origin");
    res.set("X-Frame-Options", "DENY");
    res.set(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
    );
    if (req.method !== "GET" && req.headers.origin) {
      try {
        if (
          new URL(req.headers.origin).host !== req.get("host") &&
          req.headers.origin !== devOrigin
        )
          return res
            .status(403)
            .json({ error: "Cross-origin requests are blocked." });
      } catch {
        return res.status(403).json({ error: "Invalid origin." });
      }
    }
    next();
  });
  app.use(express.json({ limit: "256kb" }));
  app.use("/api", (_req, res, next) => {
    if (maintenance)
      return res.status(503).json({
        error: "Database restoration in progress. Please retry shortly.",
      });
    next();
  });
  const route = (method, path, handler) =>
    app[method](path, async (req, res, next) => {
      try {
        await handler(req, res);
      } catch (error) {
        next(error);
      }
    });
  route("post", "/api/login", (req, res) => {
    const ip = req.ip;
    const previous = attempts.get(ip);
    if (previous && previous.count >= 10 && Date.now() - previous.at < 60000)
      throw new AppError("Too many login attempts. Wait one minute.", 429);
    const username = string(req.body.username, "Username", 80),
      password = string(req.body.password, "Password", 128);
    const teamLogin = req.body.accountType === "team";
    const user = store.get(
      teamLogin
        ? "SELECT a.*,t.name,a.team_id id,'Team' role FROM team_accounts a JOIN teams t ON t.id=a.team_id WHERE a.username=? AND a.active=1 AND t.status='Active'"
        : "SELECT * FROM operators WHERE username=? AND active=1",
      username,
    );
    if (!user || !checkPassword(password, user.password_hash)) {
      attempts.set(ip, {
        count:
          (previous && Date.now() - previous.at < 60000 ? previous.count : 0) +
          1,
        at: Date.now(),
      });
      throw new AppError("Incorrect username or password.", 401);
    }
    attempts.delete(ip);
    const token = randomBytes(32).toString("hex");
    store.atomic(() => {
      store.run("DELETE FROM sessions WHERE expires_at<?", Date.now());
      store.run("DELETE FROM team_sessions WHERE expires_at<?", Date.now());
      store.run(
        teamLogin
          ? "INSERT INTO team_sessions VALUES(?,?,?)"
          : "INSERT INTO sessions VALUES(?,?,?)",
        tokenHash(token),
        user.id,
        Date.now() + 12 * 60 * 60 * 1000,
      );
      if (!teamLogin) store.audit(user, "LOGIN", "operator", user.id);
    });
    res.cookie("ras_session", token, {
      httpOnly: true,
      sameSite: "strict",
      maxAge: 12 * 60 * 60 * 1000,
      path: "/",
    });
    res.json({
      id: user.id,
      name: user.name,
      username: user.username,
      role: user.role,
    });
  });
  app.use("/api", (req, res, next) => {
    if (maintenance)
      return res
        .status(503)
        .json({ error: "Database maintenance in progress. Please retry." });
    const raw = req.headers.cookie
      ?.split(";")
      .map((v) => v.trim())
      .find((v) => v.startsWith("ras_session="))
      ?.slice(12);
    if (!raw || !/^[a-f0-9]{64}$/.test(raw))
      return res.status(401).json({ error: "Please sign in." });
    const user =
      store.get(
        "SELECT o.* FROM sessions s JOIN operators o ON o.id=s.operator_id WHERE s.token_hash=? AND s.expires_at>? AND o.active=1",
        tokenHash(raw),
        Date.now(),
      ) ??
      store.get(
        "SELECT a.team_id id,a.username,t.name,'Team' role FROM team_sessions s JOIN team_accounts a ON a.team_id=s.team_id JOIN teams t ON t.id=a.team_id WHERE s.token_hash=? AND s.expires_at>? AND a.active=1 AND t.status='Active'",
        tokenHash(raw),
        Date.now(),
      );
    if (!user)
      return res
        .status(401)
        .json({ error: "Session expired. Please sign in." });
    req.operator = user;
    if (
      user.role === "Team" &&
      !(
        (req.method === "GET" && ["/me", "/team-portal"].includes(req.path)) ||
        (req.method === "POST" && req.path === "/logout")
      )
    )
      return res
        .status(403)
        .json({ error: "Team accounts can only access their own dashboard." });
    next();
  });
  route("get", "/api/me", (req, res) => {
    const { id, name, username, role } = req.operator;
    res.json({ id, name, username, role });
  });
  route("post", "/api/logout", (req, res) => {
    const raw = req.headers.cookie
      ?.split(";")
      .map((v) => v.trim())
      .find((v) => v.startsWith("ras_session="))
      ?.slice(12);
    if (raw) {
      store.run("DELETE FROM sessions WHERE token_hash=?", tokenHash(raw));
      store.run("DELETE FROM team_sessions WHERE token_hash=?", tokenHash(raw));
    }
    res.clearCookie("ras_session");
    res.json({ success: true });
  });
  route("get", "/api/team-portal", (req, res) => {
    if (req.operator.role !== "Team")
      throw new AppError("Team login required.", 403);
    res.json(store.teamPortal(req.operator.id));
  });
  route("get", "/api/team-accounts", (req, res) => {
    store.requireAdmin(req.operator);
    res.json(store.teamAccounts());
  });
  route("put", "/api/team-accounts/:id", (req, res) => {
    res.json(store.saveTeamAccount(req.operator, req.params.id, req.body));
  });
  route("get", "/api/bootstrap", (req, res) =>
    res.json({
      config: store.config(),
      timer: store.timer(),
      summary: summary(store),
      teams: teams(store),
      mitras: mitras(store),
      components: components(store),
      operators: store.operators(),
      demo: store.demo,
      starters: STARTERS,
      projects: PROJECTS,
    }),
  );
  route("get", "/api/teams", (req, res) =>
    res.json(teams(store, req.query.search ?? "")),
  );
  route("get", "/api/search", (req, res) => {
    const q = string(req.query.q, "Search", 120);
    const term = `%${q}%`;
    const matches = [];
    for (const t of teams(store, q).slice(0, 40))
      matches.push({
        kind: "team",
        id: t.id,
        label: `${t.id} — ${t.name}`,
        description: t.project,
      });
    for (const m of mitras(store, q).slice(0, 40))
      matches.push({
        kind: "mitra",
        id: m.id,
        label: `${m.id} — ${m.name}`,
        description: "Mentor Mitra",
      });
    for (const c of components(store, q).slice(0, 40))
      matches.push({
        kind: "component",
        id: c.id,
        label: `${c.id} — ${c.name}`,
        description: `${c.stock} available`,
      });
    const tx = store.all(
      "SELECT DISTINCT t.id,t.ref,t.kind,p.ref purchase_ref,r.ref trade_ref FROM transactions t LEFT JOIN purchases p ON p.transaction_id=t.id LEFT JOIN trades r ON r.transaction_id=t.id WHERE t.ref LIKE ? OR p.ref LIKE ? OR r.ref LIKE ? ORDER BY t.id DESC LIMIT 40",
      term,
      term,
      term,
    );
    for (const t of tx)
      matches.push({
        kind: "transaction",
        id: t.id,
        label: `${t.ref}${t.purchase_ref ? " / " + t.purchase_ref : ""}${t.trade_ref ? " / " + t.trade_ref : ""}`,
        description: t.kind,
      });
    res.json(matches);
  });
  route("get", "/api/teams/:id", (req, res) =>
    res.json(store.teamDetails(req.params.id)),
  );
  route("post", "/api/teams", (req, res) =>
    res.json(store.saveTeam(req.operator, req.body)),
  );
  route("put", "/api/teams/:id", (req, res) =>
    res.json(store.saveTeam(req.operator, req.body, req.params.id)),
  );
  route("put", "/api/teams/:id/mitra", (req, res) =>
    res.json(
      store.assign(req.operator, req.params.id, req.body.mitraId ?? null),
    ),
  );
  route("get", "/api/mitras", (req, res) =>
    res.json(mitras(store, req.query.search ?? "")),
  );
  route("post", "/api/mitras", (req, res) =>
    res.json(store.saveMitra(req.operator, req.body)),
  );
  route("put", "/api/mitras/:id", (req, res) =>
    res.json(store.saveMitra(req.operator, req.body, req.params.id)),
  );
  route("get", "/api/components", (req, res) =>
    res.json(components(store, req.query.search ?? "")),
  );
  route("post", "/api/components", (req, res) =>
    res.json(store.saveComponent(req.operator, req.body)),
  );
  route("put", "/api/components/:id", (req, res) =>
    res.json(store.saveComponent(req.operator, req.body, req.params.id)),
  );
  for (const kind of [
    "purchases",
    "trades",
    "ledger",
    "movements",
    "transactions",
  ])
    route("get", `/api/${kind}`, (req, res) =>
      res.json(history(store, kind, req.query)),
    );
  route("get", "/api/audit", (req, res) =>
    res.json(auditRows(store, req.query)),
  );
  route("get", "/api/transactions/:id", (req, res) => {
    const t = store.get(
      "SELECT t.*,o.name operator FROM transactions t JOIN operators o ON o.id=t.operator_id WHERE t.id=?",
      Number(req.params.id),
    );
    if (!t) throw new AppError("Transaction not found.", 404);
    const trade =
      store.get("SELECT * FROM trades WHERE transaction_id=?", t.id) ?? null;
    if (trade)
      trade.items = store.all(
        "SELECT * FROM trade_items WHERE trade_id=?",
        trade.id,
      );
    res.json({
      ...t,
      trade,
      purchase: purchaseSummary(
        store,
        store.get("SELECT * FROM purchases WHERE transaction_id=?", t.id),
      ),
      refund:
        store.get("SELECT * FROM refunds WHERE transaction_id=?", t.id) ?? null,
      ledger: store.all(
        "SELECT * FROM bolt_ledger WHERE transaction_id=?",
        t.id,
      ),
      movements: store.all(
        "SELECT m.*,c.name component FROM inventory_movements m JOIN components c ON c.id=m.component_id WHERE transaction_id=?",
        t.id,
      ),
      reversal:
        store.get(
          "SELECT id,ref FROM transactions WHERE reversal_of=?",
          t.id,
        ) ?? null,
      replacement:
        store.get(
          "SELECT id,ref FROM transactions WHERE correction_of=?",
          t.id,
        ) ?? null,
    });
  });
  route("post", "/api/purchases", (req, res) =>
    res.json(store.purchase(req.operator, req.body)),
  );
  route("post", "/api/trades", (req, res) =>
    res.json(store.trade(req.operator, req.body)),
  );
  route("post", "/api/adjustments", (req, res) =>
    res.json(store.adjustment(req.operator, req.body)),
  );
  route("post", "/api/refunds", (req, res) =>
    res.json(store.refund(req.operator, req.body)),
  );
  route("post", "/api/inventory-adjustments", (req, res) =>
    res.json(store.adjustInventory(req.operator, req.body)),
  );
  route("post", "/api/void", (req, res) =>
    res.json(store.void(req.operator, req.body)),
  );
  route("get", "/api/event", (req, res) => res.json(store.config()));
  route("put", "/api/event", (req, res) =>
    res.json(store.saveConfig(req.operator, req.body)),
  );
  route("get", "/api/timer", (req, res) => res.json(store.timer()));
  route("post", "/api/timer/:action", (req, res) => {
    if (req.params.action === "reset" && req.body.confirm !== "RESET TIMER")
      throw new AppError("Type RESET TIMER to confirm.");
    res.json(store.timerAction(req.operator, req.params.action));
  });
  route("get", "/api/report", (req, res) =>
    res.json({
      summary: summary(store),
      teams: teams(store),
      inventory: components(store),
    }),
  );
  route("get", "/api/operators", (req, res) => {
    store.requireAdmin(req.operator);
    res.json(store.operators());
  });
  route("post", "/api/operators", (req, res) =>
    res.json(store.saveOperator(req.operator, req.body)),
  );
  route("put", "/api/operators/:id", (req, res) =>
    res.json(
      store.saveOperator(
        req.operator,
        req.body,
        integer(Number(req.params.id), "Operator ID", 1),
      ),
    ),
  );
  route("get", "/api/export/excel", async (req, res) => {
    const buffer = await workbook(store);
    store.atomic(() =>
      store.audit(req.operator, "EXCEL_EXPORT", "export", "workbook"),
    );
    res.set(
      "Content-Disposition",
      `attachment; filename="Robots_of_the_Backstreet_Event_Data_${new Date().toISOString().replaceAll(":", "-")}.xlsx"`,
    );
    res
      .type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
      .send(Buffer.from(buffer));
  });
  route("get", "/api/export/csv", (req, res) => {
    const sheet = String(req.query.sheet ?? "Teams");
    const data = csv(store, sheet);
    if (data === null) throw new AppError("Unknown export sheet.");
    store.atomic(() =>
      store.audit(req.operator, "CSV_EXPORT", "export", sheet),
    );
    res.set(
      "Content-Disposition",
      `attachment; filename="${sheet.replaceAll(" ", "_")}_${Date.now()}.csv"`,
    );
    res.type("text/csv").send(data);
  });
  route("post", "/api/backup", async (req, res) => {
    store.requireAdmin(req.operator);
    const name = `Robots_Backup_${new Date().toISOString().replaceAll(":", "-")}.sqlite`;
    const path = resolve(store.path, "..", "backups", name);
    store.atomic(() =>
      store.audit(req.operator, "DATABASE_BACKUP", "database", "1", null, {
        name,
      }),
    );
    await store.backupTo(path);
    res.set("X-Backup-Created-At", new Date().toISOString());
    res.download(path, name);
  });
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 100 * 1024 * 1024, files: 1, fields: 1 },
  });
  app.post("/api/restore", (req, res, next) => {
    try {
      store.requireAdmin(req.operator);
      upload.single("backup")(req, res, next);
    } catch (e) {
      next(e);
    }
  });
  route("post", "/api/restore", async (req, res) => {
    if (req.body.confirm !== "RESTORE DATABASE")
      throw new AppError("Type RESTORE DATABASE to confirm restoration.");
    if (!req.file) throw new AppError("Choose a SQLite backup file.");
    const directory = resolve(store.path, "..", "restore-staging");
    mkdirSync(directory, { recursive: true });
    const path = resolve(
      directory,
      `${randomBytes(16).toString("hex")}.sqlite`,
    );
    writeFileSync(path, req.file.buffer);
    maintenance = true;
    try {
      res.json(await store.restoreFrom(path, req.operator));
    } finally {
      maintenance = false;
      rmSync(path, { force: true });
    }
  });
  route("get", "/api/integrity", (req, res) => {
    store.requireAdmin(req.operator);
    res.json(store.integrity());
  });
  app.use("/api", (_req, res) =>
    res.status(404).json({ error: "API endpoint not found." }),
  );
  if (existsSync(resolve("dist"))) {
    app.use(express.static(resolve("dist")));
    app.get("/{*path}", (req, res) => res.sendFile(resolve("dist/index.html")));
  }
  app.use((error, req, res, _next) => {
    let status = error.status ?? 400;
    let message = error.message;
    if (error.code?.includes("SQLITE")) {
      status = 409;
      message =
        "Database constraint rejected this operation. Check duplicate IDs and references.";
    } else if (
      !(error instanceof AppError) &&
      !error.status &&
      error.code !== "LIMIT_FILE_SIZE"
    ) {
      status = 500;
      message =
        "The operation could not be completed. No partial transaction was saved.";
      console.error("Operation failed:", error);
    }
    res.status(status).json({ error: message });
  });
  return app;
}

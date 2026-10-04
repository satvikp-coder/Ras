import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import ExcelJS from "exceljs";
import { Store } from "../server/store.mjs";
import { workbook, csv, exportData } from "../server/export.mjs";
import { history, summary, components } from "../server/queries.mjs";
import { createApp } from "../server/app.mjs";

function fixture(t, { active = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "ras-test-"));
  const path = join(dir, "event.sqlite");
  const store = new Store(path, { bootstrapPassword: "test-password-123" });
  const admin = store.get("SELECT * FROM operators WHERE username='admin'");
  store.saveConfig(admin, {
    initialBolts: 100,
    allocationConfirmed: true,
    rulesConfirmed: true,
    allowItemTrading: true,
    allowItemForBolts: true,
    allowBoltTransfer: true,
    allowItemForItem: true,
    allowMixedTrades: true,
  });
  store.saveTeam(admin, { id: "T01", name: "Team A", members: ["A"] });
  store.saveTeam(admin, { id: "T02", name: "Team B" });
  store.saveComponent(admin, {
    id: "MOTOR",
    name: "Motor",
    price: 10,
    initialQuantity: 10,
  });
  store.saveMitra(admin, { id: "M01", name: "Mentor One" });
  if (active) store.timerAction(admin, "start");
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return { store, admin, dir, path };
}
const purchase = (extra = {}) => ({
  teamId: "T01",
  componentId: "MOTOR",
  quantity: 2,
  expectedPrice: 10,
  requestKey: randomUUID(),
  ...extra,
});
const trade = (extra = {}) => ({
  teamA: "T01",
  teamB: "T02",
  boltsA: 0,
  boltsB: 15,
  itemsA: [{ componentId: "MOTOR", quantity: 1 }],
  itemsB: [],
  requestKey: randomUUID(),
  ...extra,
});
test("required acceptance: 100/100, purchase two motors, trade one for 15, Mitra, reversal, replacement, export, restart", async (t) => {
  const { store, admin, dir, path } = fixture(t);
  assert.equal(store.balance("T01"), 100);
  const p = store.purchase(admin, purchase());
  assert.equal(store.balance("T01"), 80);
  assert.equal(store.stock("MOTOR"), 8);
  assert.equal(store.stock("MOTOR", "T01"), 2);
  assert.equal(store.all("SELECT * FROM purchases").length, 1);
  assert.equal(
    store.all("SELECT * FROM bolt_ledger WHERE transaction_id=?", p.id).length,
    1,
  );
  assert.equal(
    store.all("SELECT * FROM inventory_movements WHERE transaction_id=?", p.id)
      .length,
    2,
  );
  assert.ok(store.get("SELECT * FROM audit WHERE entity_id=?", p.ref));
  const tr = store.trade(admin, trade());
  assert.equal(store.balance("T01"), 95);
  assert.equal(store.balance("T02"), 85);
  assert.equal(store.stock("MOTOR", "T01"), 1);
  assert.equal(store.stock("MOTOR", "T02"), 1);
  assert.equal(store.teamDetails("T01").total_trade_value, 15);
  assert.equal(store.teamDetails("T01").total_spent, 20);
  assert.equal(store.teamDetails("T02").total_spent, 15);
  assert.equal(components(store)[0].traded_quantity, 1);
  assert.equal(components(store)[0].purchased_quantity, 2);
  store.assign(admin, "T01", "M01");
  store.assign(admin, "T02", "M01");
  assert.equal(store.teamDetails("T01").mitra.id, "M01");
  assert.equal(
    store.all("SELECT * FROM assignments WHERE mitra_id=?", "M01").length,
    2,
  );
  store.void(admin, {
    transactionId: tr.id,
    notes: "Wrong trade",
    requestKey: randomUUID(),
  });
  assert.equal(store.balance("T01"), 80);
  assert.equal(store.balance("T02"), 100);
  assert.equal(store.stock("MOTOR", "T01"), 2);
  assert.equal(components(store)[0].traded_quantity, 0);
  store.void(admin, {
    transactionId: p.id,
    notes: "Wrong purchase",
    requestKey: randomUUID(),
  });
  assert.equal(store.balance("T01"), 100);
  assert.equal(store.stock("MOTOR"), 10);
  assert.equal(store.stock("MOTOR", "T01"), 0);
  const replacement = store.purchase(
    admin,
    purchase({ quantity: 1, correctionOf: p.id, notes: "Correct replacement" }),
  );
  assert.equal(replacement.correction_of, p.id);
  assert.equal(
    store.get("SELECT status FROM transactions WHERE id=?", p.id).status,
    "VOIDED",
  );
  assert.equal(store.balance("T01"), 90);
  const buffer = await workbook(store);
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(buffer);
  for (const sheet of [
    "Teams",
    "Purchases",
    "Trades",
    "RAS Bolt Ledger",
    "Inventory",
    "Team Inventory",
    "Mitras",
    "Audit Log",
    "Event Summary",
  ])
    assert.ok(book.getWorksheet(sheet), sheet);
  assert.equal(book.getWorksheet("Teams").getCell("H2").value, 90);
  assert.ok(csv(store, "Teams").includes("Team A"));
  const backup = join(dir, "backup.sqlite");
  await store.backupTo(backup);
  assert.ok(store.validateBackup(backup));
  store.close();
  store.open();
  assert.equal(store.balance("T01"), 90);
  assert.equal(store.teamDetails("T01").mitra.id, "M01");
  const second = new Store(path, { bootstrapPassword: "ignored-password" });
  assert.equal(second.balance("T01"), 90);
  second.close();
});
test("purchase rejects funds, stock, quantity, inactive team/item and changed price without partial commits", (t) => {
  const { store, admin } = fixture(t);
  const before = store.get("SELECT COUNT(*) n FROM transactions").n;
  for (const input of [
    purchase({ quantity: 11 }),
    purchase({ quantity: -1 }),
    purchase({ quantity: 1.5 }),
    purchase({ expectedPrice: 9 }),
  ])
    assert.throws(() => store.purchase(admin, input));
  assert.equal(store.get("SELECT COUNT(*) n FROM transactions").n, before);
  assert.equal(store.balance("T01"), 100);
  assert.equal(store.stock("MOTOR"), 10);
  store.adjustment(admin, {
    teamId: "T01",
    amount: -95,
    notes: "Funds test",
    requestKey: randomUUID(),
  });
  assert.throws(
    () => store.purchase(admin, purchase()),
    /INSUFFICIENT RAS BOLTS/,
  );
  assert.equal(store.stock("MOTOR"), 10);
  store.saveTeam(
    admin,
    { ...store.teamDetails("T02"), status: "Inactive" },
    "T02",
  );
  assert.throws(
    () => store.purchase(admin, purchase({ teamId: "T02" })),
    /inactive/,
  );
  store.saveComponent(
    admin,
    { ...store.component("MOTOR"), status: "Inactive" },
    "MOTOR",
  );
  assert.throws(() => store.purchase(admin, purchase()), /inactive/);
});
test("idempotency: duplicate purchase/trade/adjustment commits once; changed payload rejected", (t) => {
  const { store, admin } = fixture(t);
  const input = purchase();
  const first = store.purchase(admin, input);
  const second = store.purchase(admin, input);
  assert.equal(first.id, second.id);
  assert.ok(second.duplicate);
  assert.equal(store.balance("T01"), 80);
  assert.throws(
    () => store.purchase(admin, { ...input, quantity: 1 }),
    /different data/,
  );
  const ti = trade();
  store.trade(admin, ti);
  store.trade(admin, ti);
  assert.equal(store.balance("T01"), 95);
  const adjustment = {
    teamId: "T01",
    amount: 5,
    notes: "Bonus",
    requestKey: randomUUID(),
  };
  store.adjustment(admin, adjustment);
  store.adjustment(admin, adjustment);
  assert.equal(store.balance("T01"), 100);
});
test("trade item/item, RAS Bolts only, bilateral and invalid ownership/funds/self/rules", (t) => {
  const { store, admin } = fixture(t);
  store.purchase(admin, purchase());
  store.purchase(admin, purchase({ teamId: "T02" }));
  store.trade(
    admin,
    trade({
      boltsA: 5,
      boltsB: 10,
      itemsB: [{ componentId: "MOTOR", quantity: 1 }],
    }),
  );
  assert.equal(store.balance("T01"), 85);
  assert.equal(store.balance("T02"), 75);
  assert.equal(store.stock("MOTOR", "T01"), 2);
  store.trade(admin, trade({ boltsA: 1, boltsB: 0, itemsA: [] }));
  assert.equal(store.balance("T01"), 84);
  assert.equal(store.balance("T02"), 76);
  const before = exportData(store);
  for (const input of [
    trade({ teamB: "T01" }),
    trade({ itemsA: [{ componentId: "MOTOR", quantity: 9 }] }),
    trade({ boltsB: 1000 }),
    trade({ itemsA: [{ componentId: "MOTOR", quantity: -1 }] }),
    trade({ itemsA: [], boltsB: 0 }),
    trade({
      itemsA: [
        { componentId: "MOTOR", quantity: 1 },
        { componentId: "MOTOR", quantity: 1 },
      ],
    }),
  ])
    assert.throws(() => store.trade(admin, input));
  assert.deepEqual(exportData(store).Teams, before.Teams);
  assert.deepEqual(exportData(store).Inventory, before.Inventory);
  store.saveConfig(admin, { allowItemTrading: false });
  assert.throws(() => store.trade(admin, trade()), /disabled/);
});
test("injected mid-trade failure rolls back all balances, records, inventory and audit", (t) => {
  const { store, admin } = fixture(t);
  store.purchase(admin, purchase());
  const count = store.get("SELECT COUNT(*) n FROM transactions").n;
  const auditCount = store.get("SELECT COUNT(*) n FROM audit").n;
  const original = store.movement.bind(store);
  let calls = 0;
  store.movement = (...args) => {
    calls++;
    if (calls === 2) throw new Error("Simulated write failure");
    return original(...args);
  };
  assert.throws(() => store.trade(admin, trade()), /Simulated/);
  store.movement = original;
  assert.equal(store.balance("T01"), 80);
  assert.equal(store.balance("T02"), 100);
  assert.equal(store.stock("MOTOR", "T01"), 2);
  assert.equal(store.stock("MOTOR", "T02"), 0);
  assert.equal(store.all("SELECT * FROM trades").length, 0);
  assert.equal(store.get("SELECT COUNT(*) n FROM transactions").n, count);
  assert.equal(store.get("SELECT COUNT(*) n FROM audit").n, auditCount);
});
test("void rejects impossible inventory, preserves history and prevents second reversal", (t) => {
  const { store, admin } = fixture(t);
  const p = store.purchase(admin, purchase());
  const tr = store.trade(admin, trade());
  assert.throws(
    () =>
      store.void(admin, {
        transactionId: p.id,
        notes: "Wrong team",
        requestKey: randomUUID(),
      }),
    /does not own enough/,
  );
  assert.equal(
    store.get("SELECT status FROM transactions WHERE id=?", p.id).status,
    "COMPLETED",
  );
  assert.equal(store.balance("T01"), 95);
  store.void(admin, {
    transactionId: tr.id,
    notes: "Undo trade",
    requestKey: randomUUID(),
  });
  const v = {
    transactionId: p.id,
    notes: "Undo purchase",
    requestKey: randomUUID(),
  };
  const reversal = store.void(admin, v);
  assert.equal(reversal.reversal_of, p.id);
  assert.equal(store.void(admin, v).id, reversal.id);
  assert.throws(
    () => store.void(admin, { ...v, requestKey: randomUUID() }),
    /unreversed/,
  );
  assert.equal(store.balance("T01"), 100);
  assert.equal(store.stock("MOTOR"), 10);
  assert.throws(() => store.run("DELETE FROM bolt_ledger"), /immutable/);
  assert.throws(
    () => store.run("UPDATE inventory_movements SET quantity=0"),
    /immutable/,
  );
  assert.throws(() => store.run("DELETE FROM audit"), /immutable/);
});
test("ledger chronological running balances and inventory reconstruct exactly", (t) => {
  const { store, admin } = fixture(t);
  const p = store.purchase(admin, purchase());
  store.trade(admin, trade());
  store.adjustment(admin, {
    teamId: "T01",
    type: "BONUS",
    amount: 5,
    notes: "Organizer award",
    requestKey: randomUUID(),
  });
  store.adjustInventory(admin, {
    teamId: "T02",
    componentId: "MOTOR",
    quantity: 1,
    notes: "Inventory correction",
    requestKey: randomUUID(),
  });
  for (const team of ["T01", "T02"]) {
    let balance = 0;
    for (const l of store.all(
      "SELECT * FROM bolt_ledger WHERE team_id=? ORDER BY id",
      team,
    )) {
      assert.equal(l.balance_before, balance);
      balance += l.amount;
      assert.equal(l.balance_after, balance);
    }
    assert.equal(store.balance(team), balance);
  }
  for (const owner of [null, "T01", "T02"]) {
    let quantity = 0;
    for (const m of store.all(
      "SELECT * FROM inventory_movements WHERE component_id=? AND team_id IS ? ORDER BY id",
      "MOTOR",
      owner,
    )) {
      assert.equal(m.quantity_before, quantity);
      quantity += m.quantity;
      assert.equal(m.quantity_after, quantity);
    }
    assert.equal(store.stock("MOTOR", owner), quantity);
  }
  assert.equal(p.kind, "PURCHASE");
  assert.equal(store.integrity().integrity, "ok");
});
test("persistent timer start/pause/resume/restart/expiry and server transaction lock", (t) => {
  const { store, admin } = fixture(t, { active: false });
  assert.equal(store.timer().state, "NOT_STARTED");
  assert.throws(() => store.purchase(admin, purchase()), /locked/);
  store.timerAction(admin, "start");
  const started = store.timer();
  const future = store.timer(Date.parse(started.server_time) + 10000);
  assert.ok(future.remaining_ms < started.remaining_ms);
  store.run(
    "UPDATE timer SET resumed_at=?",
    new Date(Date.now() - 15000).toISOString(),
  );
  store.timerAction(admin, "pause");
  const paused = store.timer();
  assert.ok(paused.elapsed_ms >= 15000);
  store.close();
  store.open();
  assert.equal(store.timer().state, "PAUSED");
  assert.equal(
    store.timer(Date.now() + 600000).remaining_ms,
    paused.remaining_ms,
  );
  store.timerAction(admin, "resume");
  store.run(
    "UPDATE timer SET resumed_at=?",
    new Date(Date.now() - 91 * 60000).toISOString(),
  );
  assert.equal(store.timer().state, "ENDED");
  assert.throws(() => store.purchase(admin, purchase()), /locked/);
  store.saveConfig(admin, { postEventEditing: true });
  store.purchase(admin, purchase());
  assert.throws(() => store.timerAction(admin, "reset"), /blocked/);
});
test("per-team caps cannot be bypassed by trading away; global maximum enforced", (t) => {
  const { store, admin } = fixture(t);
  store.saveComponent(
    admin,
    { ...store.component("MOTOR"), max_per_team: 2 },
    "MOTOR",
  );
  store.purchase(admin, purchase());
  store.trade(admin, trade());
  assert.throws(
    () => store.purchase(admin, purchase({ quantity: 1 })),
    /Per-team/,
  );
  store.saveConfig(admin, { maximumPurchaseQuantity: 1 });
  assert.throws(
    () => store.purchase(admin, purchase({ teamId: "T02", quantity: 2 })),
    /Maximum/,
  );
});
test("safe backup/restore validates corruption and preserves automatic pre-restore copy", async (t) => {
  const { store, admin, dir } = fixture(t);
  const backup = join(dir, "valid.sqlite");
  await store.backupTo(backup);
  store.purchase(admin, purchase());
  const malformed = join(dir, "bad.sqlite");
  writeFileSync(malformed, "not sqlite");
  assert.throws(() => store.validateBackup(malformed), /Invalid backup/);
  assert.equal(store.balance("T01"), 80);
  const restored = await store.restoreFrom(backup, admin);
  assert.equal(store.balance("T01"), 100);
  assert.ok(store.validateBackup(restored.preRestoreBackup));
  assert.ok(store.get("SELECT * FROM audit WHERE action='DATABASE_RESTORE'"));
  assert.equal(store.get("SELECT COUNT(*) n FROM sessions").n, 0);
});
test("Mitra assignments and reassignment/removal are audited, members/project edit persist", (t) => {
  const { store, admin } = fixture(t);
  store.assign(admin, "T01", "M01");
  store.saveMitra(admin, { id: "M02", name: "Mentor Two" });
  store.assign(admin, "T01", "M02");
  assert.equal(store.teamDetails("T01").mitra.id, "M02");
  store.assign(admin, "T01", null);
  assert.equal(store.teamDetails("T01").mitra, null);
  store.saveTeam(
    admin,
    {
      ...store.teamDetails("T01"),
      members: [{ name: "Edited member", contact: "local" }],
      project: "Delivery Robot",
    },
    "T01",
  );
  assert.equal(store.teamDetails("T01").members[0].name, "Edited member");
  assert.equal(store.teamDetails("T01").project, "Delivery Robot");
  assert.equal(
    store.get("SELECT COUNT(*) n FROM audit WHERE action='MITRA_ASSIGNMENT'").n,
    3,
  );
});
test("filters, metrics and CSV formula protection", (t) => {
  const { store, admin } = fixture(t);
  store.purchase(admin, purchase());
  store.trade(admin, trade());
  assert.equal(history(store, "purchases", { team: "T01" }).total, 1);
  assert.equal(history(store, "ledger", { type: "TRADE_RECEIPT" }).total, 1);
  assert.equal(
    history(store, "movements", { component: "MOTOR", team: "T02" }).total,
    1,
  );
  assert.equal(summary(store).spent, 20);
  assert.equal(summary(store).held, 180);
  store.saveTeam(
    admin,
    { ...store.teamDetails("T01"), name: "=DANGEROUS()" },
    "T01",
  );
  assert.ok(csv(store, "Teams").includes("'=DANGEROUS()"));
});
test("HTTP sessions, server-side role restrictions, concurrent oversell, backup and malformed restore", async (t) => {
  const { store, admin } = fixture(t);
  store.saveOperator(admin, {
    username: "viewer",
    name: "Viewer",
    password: "viewer-password-123",
    role: "Viewer",
  });
  store.saveOperator(admin, {
    username: "shop",
    name: "Shop",
    password: "shop-password-123",
    role: "Shop Operator",
  });
  const server = createApp(store).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const login = async (username, password) => {
    const r = await fetch(base + "/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    assert.equal(r.status, 200);
    return r.headers.get("set-cookie").split(";")[0];
  };
  const viewer = await login("viewer", "viewer-password-123"),
    shop = await login("shop", "shop-password-123"),
    cookie = await login("admin", "test-password-123");
  const call = (path, body, auth = cookie) =>
    fetch(base + path, {
      method: body ? "POST" : "GET",
      headers: { "Content-Type": "application/json", Cookie: auth },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  assert.equal((await call("/me", null, viewer)).status, 200);
  assert.equal((await call("/purchases", purchase(), viewer)).status, 403);
  assert.equal(
    (
      await call(
        "/adjustments",
        { teamId: "T01", amount: 10, notes: "No", requestKey: randomUUID() },
        shop,
      )
    ).status,
    403,
  );
  assert.equal((await call("/timer/end", {}, shop)).status, 403);
  assert.equal((await call("/backup", {}, viewer)).status, 403);
  assert.equal((await fetch(base + "/bootstrap")).status, 401);
  const results = await Promise.all([
    call("/purchases", purchase({ quantity: 7 })),
    call("/purchases", purchase({ quantity: 7 })),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 400]);
  assert.equal(store.balance("T01"), 30);
  assert.equal(store.stock("MOTOR"), 3);
  assert.equal((await call("/export/excel")).status, 200);
  assert.equal((await call("/backup", {})).status, 200);
  const form = new FormData();
  form.append("confirm", "RESTORE DATABASE");
  form.append("backup", new Blob(["bad"]), "bad.sqlite");
  const restore = await fetch(base + "/restore", {
    method: "POST",
    headers: { Cookie: cookie },
    body: form,
  });
  assert.equal(restore.status, 400);
  assert.equal(store.balance("T01"), 30);
  const origin = await fetch(base + "/purchases", {
    method: "POST",
    headers: {
      Cookie: cookie,
      "Content-Type": "application/json",
      Origin: "http://evil.example",
    },
    body: JSON.stringify(purchase()),
  });
  assert.equal(origin.status, 403);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { Store } from "../server/store.mjs";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import ExcelJS from "exceljs";
import { workbook, csv } from "../server/export.mjs";
import { components } from "../server/queries.mjs";
test("initial allocation changes before start are ledger entries; normal adjustments and later allocation rewrites are blocked", (t) => {
  const { store, admin } = fixture(t);
  store.saveConfig(admin, {
    initialBolts: 100,
    allocationConfirmed: true,
    rulesConfirmed: true,
  });
  store.saveTeam(admin, { id: "T01", name: "A" });
  store.adjustment(admin, {
    teamId: "T01",
    type: "INITIAL_BALANCE",
    amount: 20,
    notes: "Organizer revised allocation",
    requestKey: randomUUID(),
  });
  assert.equal(store.balance("T01"), 120);
  assert.equal(store.teamDetails("T01").initial, 120);
  assert.throws(
    () =>
      store.adjustment(admin, {
        teamId: "T01",
        amount: 5,
        notes: "Regular bonus",
        requestKey: randomUUID(),
      }),
    /locked/,
  );
  store.timerAction(admin, "start");
  assert.throws(
    () =>
      store.adjustment(admin, {
        teamId: "T01",
        type: "INITIAL_BALANCE",
        amount: 10,
        notes: "Too late",
        requestKey: randomUUID(),
      }),
    /before timer start/,
  );
  assert.equal(store.balance("T01"), 120);
});
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "ras-edge-"));
  const store = new Store(join(dir, "event.sqlite"));
  const admin = store.get("SELECT * FROM operators WHERE username='admin'");
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return { store, admin, dir };
}
test("initial stock snapshot stays fixed when adjustment reason resembles initialization", (t) => {
  const { store, admin } = fixture(t);
  store.saveComponent(admin, {
    id: "MOTOR",
    name: "Motor",
    price: 10,
    initialQuantity: 10,
  });
  store.adjustInventory(admin, {
    componentId: "MOTOR",
    quantity: 3,
    notes: "Initial shop inventory",
    requestKey: randomUUID(),
  });
  const c = components(store)[0];
  assert.equal(c.initial_quantity, 10);
  assert.equal(c.stock, 13);
  assert.throws(
    () => store.saveConfig(admin, { eventDate: "2026-02-30" }),
    /ISO date/,
  );
  assert.throws(
    () => store.saveConfig(admin, { startTime: "29:00" }),
    /ISO date/,
  );
});
test("empty workbook retains required headers and CSV preserves signed numeric quantities", async (t) => {
  const { store, admin } = fixture(t);
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(await workbook(store));
  assert.ok(
    book
      .getWorksheet("Purchases")
      .getRow(1)
      .values.includes("Previous Balance"),
  );
  assert.ok(
    book
      .getWorksheet("Trades")
      .getRow(1)
      .values.includes("Items Received by B"),
  );
  assert.ok(book.getWorksheet("Refunds").getRow(1).values.includes("Quantity"));
  store.saveConfig(admin, {
    initialBolts: 100,
    allocationConfirmed: true,
    rulesConfirmed: true,
  });
  store.saveTeam(admin, { id: "T01", name: "A" });
  store.saveComponent(admin, {
    id: "C1",
    name: "Motor",
    price: 10,
    initialQuantity: 10,
  });
  store.timerAction(admin, "start");
  store.purchase(admin, {
    teamId: "T01",
    componentId: "C1",
    expectedPrice: 10,
    quantity: 1,
    requestKey: randomUUID(),
  });
  assert.ok(csv(store, "Inventory Movements").includes('"-1"'));
  assert.ok(!csv(store, "Inventory Movements").includes("'-1"));
});
test("separate demo creates samples, refuses overwrite and never creates a real competition database", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "ras-demo-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const result = spawnSync(process.execPath, [resolve("scripts/demo.mjs")], {
    cwd: dir,
    encoding: "utf8",
  });
  assert.equal(result.status, 0);
  assert.ok(!existsSync(join(dir, "data", "competition.sqlite")));
  const demo = new Store(join(dir, "data", "demo.sqlite"));
  assert.equal(demo.balance("T01"), 100);
  assert.equal(demo.stock("C01"), 10);
  assert.equal(
    demo.all("SELECT * FROM assignments WHERE mitra_id=?", "M01").length,
    2,
  );
  demo.close();
  const second = spawnSync(process.execPath, [resolve("scripts/demo.mjs")], {
    cwd: dir,
    encoding: "utf8",
  });
  assert.equal(second.status, 1);
  assert.ok(second.stderr.includes("already exists"));
});
test("incompatible existing database is rejected before schema mutation", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "ras-version-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "incompatible.sqlite");
  const db = new DatabaseSync(path);
  db.exec(
    "CREATE TABLE schema_version(version INTEGER); INSERT INTO schema_version VALUES(2)",
  );
  db.close();
  assert.throws(() => new Store(path), /Unsupported database schema version/);
  const check = new DatabaseSync(path);
  assert.equal(
    check.prepare("SELECT version FROM schema_version").get().version,
    2,
  );
  assert.equal(
    check
      .prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table'")
      .get().n,
    1,
  );
  check.close();
});

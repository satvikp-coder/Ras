import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { Store } from "../server/store.mjs";
import {
  summary,
  history,
  purchaseSummary,
  components,
} from "../server/queries.mjs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "ras-refund-"));
  const store = new Store(join(dir, "event.sqlite"));
  const admin = store.get("SELECT * FROM operators WHERE username='admin'");
  store.saveConfig(admin, {
    initialBolts: 100,
    allocationConfirmed: true,
    rulesConfirmed: true,
    allowRefunds: true,
  });
  store.saveTeam(admin, { id: "T01", name: "Team A" });
  store.saveComponent(admin, {
    id: "MOTOR",
    name: "Motor",
    price: 10,
    initialQuantity: 10,
  });
  store.timerAction(admin, "start");
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return { store, admin, dir };
}
test("partial refunds preserve original price, holdings and auditable reversal", (t) => {
  const { store, admin } = fixture(t);
  const p = store.purchase(admin, {
    teamId: "T01",
    componentId: "MOTOR",
    quantity: 2,
    expectedPrice: 10,
    requestKey: randomUUID(),
  });
  const purchaseRow = store.get(
    "SELECT * FROM purchases WHERE transaction_id=?",
    p.id,
  );
  store.saveComponent(
    admin,
    { ...store.component("MOTOR"), price: 99 },
    "MOTOR",
  );
  const input = {
    purchaseId: purchaseRow.id,
    quantity: 1,
    notes: "Return one motor",
    requestKey: randomUUID(),
  };
  const refund = store.refund(admin, input);
  assert.equal(store.balance("T01"), 90);
  assert.equal(store.stock("MOTOR"), 9);
  assert.equal(store.stock("MOTOR", "T01"), 1);
  assert.equal(store.teamDetails("T01").spent, 10);
  assert.equal(summary(store).spent, 10);
  const displayed = history(store, "purchases").rows.find(
    (row) => row.id === purchaseRow.id,
  );
  assert.equal(displayed.quantity, 2);
  assert.equal(displayed.refunded_quantity, 1);
  assert.equal(displayed.net_quantity, 1);
  assert.equal(displayed.refunded_total, 10);
  assert.equal(displayed.net_total, 10);
  assert.equal(displayed.current_balance, 90);
  assert.equal(
    components(store).find((component) => component.id === "MOTOR")
      .purchased_quantity,
    1,
  );
  assert.equal(purchaseSummary(store, purchaseRow).net_quantity, 1);
  assert.equal(store.refund(admin, input).id, refund.id);
  assert.throws(
    () =>
      store.refund(admin, { ...input, quantity: 2, requestKey: randomUUID() }),
    /unrefunded/,
  );
  assert.throws(
    () =>
      store.void(admin, {
        transactionId: p.id,
        notes: "Undo",
        requestKey: randomUUID(),
      }),
    /refunds/,
  );
  store.void(admin, {
    transactionId: refund.id,
    notes: "Undo return",
    requestKey: randomUUID(),
  });
  assert.equal(store.balance("T01"), 80);
  assert.equal(purchaseSummary(store, purchaseRow).net_quantity, 2);
  assert.equal(purchaseSummary(store, purchaseRow).refunded_total, 0);
  assert.equal(store.stock("MOTOR"), 8);
  store.void(admin, {
    transactionId: p.id,
    notes: "Undo purchase",
    requestKey: randomUUID(),
  });
  assert.equal(store.balance("T01"), 100);
  assert.equal(store.stock("MOTOR"), 10);
});
test("restore rejects malicious protection triggers and semantically inconsistent ledger", async (t) => {
  const { store, dir } = fixture(t);
  const backup = join(dir, "tampered.sqlite");
  await store.backupTo(backup);
  const bad = new DatabaseSync(backup);
  bad.exec(
    "DROP TRIGGER immutable_bolts_update; CREATE TRIGGER immutable_bolts_update BEFORE UPDATE ON bolt_ledger BEGIN SELECT 1; END;",
  );
  bad.close();
  assert.throws(() => store.validateBackup(backup), /schema or protection/);
  assert.equal(store.balance("T01"), 100);
  const other = join(dir, "inconsistent.sqlite");
  await store.backupTo(other);
  const db = new DatabaseSync(other);
  const trigger = db
    .prepare(
      "SELECT sql FROM sqlite_master WHERE name='immutable_bolts_update'",
    )
    .get().sql;
  db.exec("DROP TRIGGER immutable_bolts_update");
  db.exec("UPDATE bolt_ledger SET balance_before=5,balance_after=amount+5");
  db.exec(trigger);
  db.close();
  assert.throws(() => store.validateBackup(other), /running totals/);
  assert.equal(store.balance("T01"), 100);
});

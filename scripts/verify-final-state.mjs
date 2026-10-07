import "dotenv/config";
import assert from "node:assert/strict";
import { Store } from "../server/store.mjs";
import { FINAL_CONFIG, MARKET, STARTERS } from "../server/event-rules.mjs";
import { dirname, join } from "node:path";
import { writeFileSync } from "node:fs";

const store = new Store(process.env.DB_PATH ?? "data/competition.sqlite");
try {
  for (const [key, value] of Object.entries(FINAL_CONFIG))
    assert.equal(store.config()[key], value, key);
  const timer = store.timer();
  assert.equal(timer.state, "NOT_STARTED");
  assert.equal(timer.elapsed_ms, 0);
  assert.equal(timer.remaining_ms, 5400000);
  for (const key of ["started_at", "resumed_at", "ended_at"])
    assert.equal(timer[key], null);
  const market = MARKET.map((item) => {
    const actual = store.component(item.id);
    assert.equal(actual.name, item.name);
    assert.equal(actual.price, item.price);
    assert.equal(actual.status, "Active");
    assert.equal(actual.category, "Market");
    assert.equal(store.stock(item.id), item.quantity);
    return {
      name: actual.name,
      quantity: store.stock(item.id),
      price: actual.price,
    };
  });
  assert.equal(
    store.get(
      "SELECT COUNT(*) n FROM components WHERE category='Market' AND status='Active'",
    ).n,
    9,
  );
  const teams = store.all("SELECT id,name,project FROM teams").map((team) => {
    assert.ok(!team.id.startsWith("TEST-"));
    assert.equal(store.balance(team.id), 1000);
    assert.equal(store.teamDetails(team.id).initial, 1000);
    for (const item of STARTERS)
      assert.equal(store.stock(item.id, team.id), item.quantity);
    return {
      ...team,
      balance: store.balance(team.id),
      memberCount: store.get(
        "SELECT COUNT(*) n FROM members WHERE team_id=?",
        team.id,
      ).n,
    };
  });
  const counts = {};
  for (const table of ["purchases", "trades", "trade_items", "refunds"])
    assert.equal(
      (counts[table] = store.get(`SELECT COUNT(*) n FROM ${table}`).n),
      0,
    );
  assert.equal(
    store.get(
      "SELECT COUNT(*) n FROM transactions WHERE kind='MANUAL_ADJUSTMENT'",
    ).n,
    0,
  );
  for (const table of [
    "teams",
    "mitras",
    "operators",
    "transactions",
    "audit",
    "members",
    "team_accounts",
  ])
    assert.ok(
      !/TEST-T0[1-4]|Simulation Alpha|Simulation Beta|Simulation Gamma|Simulation Delta|Simulation Mentor|FINAL SIMULATION|TEST-ADMIN|TEST-SHOP|TEST-TRADE|TEST-VIEWER/.test(
        JSON.stringify(store.all(`SELECT * FROM ${table}`)),
      ),
      `Simulation record remains in ${table}`,
    );
  assert.equal(store.component("JUMPER").category, "Common");
  assert.equal(store.component("JUMPER").status, "Inactive");
  assert.equal(store.stock("BALL_CASTER"), 2);
  assert.equal(
    store.get(
      "SELECT COUNT(*) n FROM components WHERE status='Active' AND (name LIKE '%MPU6050%' OR description LIKE '%Self-Balancing%' OR description LIKE '%7 robots%')",
    ).n,
    0,
  );
  const integrity = store.integrity();
  assert.equal(integrity.integrity, "ok");
  for (const [key, value] of Object.entries(integrity))
    if (Array.isArray(value)) assert.deepEqual(value, [], key);
  const backup = join(
    dirname(store.path),
    "backups",
    `COMPETITION_READY_${Date.now()}.sqlite`,
  );
  await store.backupTo(backup);
  store.validateBackup(backup);
  const result = {
    config: store.config(),
    timer,
    market,
    totalMarketQuantity: market.reduce((n, c) => n + c.quantity, 0),
    totalMarketValue: market.reduce((n, c) => n + c.quantity * c.price, 0),
    teams,
    availableSlots: 8 - teams.length,
    counts,
    simulationRecords: 0,
    integrity,
    backup,
  };
  writeFileSync("data/final-live-state.json", JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  store.close();
}

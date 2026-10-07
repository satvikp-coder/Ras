import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DatabaseSync, backup } from "node:sqlite";
import { mkdtempSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import ExcelJS from "exceljs";
import { Store } from "../server/store.mjs";
import { createApp } from "../server/app.mjs";
import { configureFinalEvent } from "../server/configure-event.mjs";
import { MARKET, STARTERS, PROJECTS } from "../server/event-rules.mjs";

export async function runFinalSimulation(sourcePath = null) {
  const root = resolve(tmpdir());
  const dir = mkdtempSync(join(root, "ras-final-simulation-"));
  const path = join(dir, "competition.sqlite");
  let store, server, child;
  const report = { checks: [], purchases: [], robotCosts: {}, cleanup: false };
  const pass = (name) => {
    report.checks.push(name);
    console.log(`PASS: ${name}`);
  };
  try {
    if (sourcePath) {
      const source = new DatabaseSync(sourcePath, { readOnly: true });
      try {
        await backup(source, path);
      } finally {
        source.close();
      }
    }
    store = new Store(path, { bootstrapPassword: "simulation-admin-password" });
    const originalAdmin = store.get(
      "SELECT * FROM operators WHERE role='Admin' AND active=1 ORDER BY id LIMIT 1",
    );
    if (!sourcePath) configureFinalEvent(store, originalAdmin);
    const originalTeams = store.all("SELECT id FROM teams").map((t) => t.id);
    assert.ok(
      originalTeams.length <= 4,
      "Four simulation slots required; use a separate fresh rehearsal database if live teams exceed four.",
    );
    for (const [username, role] of [
      ["TEST-ADMIN", "Admin"],
      ["TEST-SHOP", "Shop Operator"],
      ["TEST-TRADE", "Trade Operator"],
      ["TEST-VIEWER", "Viewer"],
    ])
      store.saveOperator(originalAdmin, {
        username,
        name: username,
        role,
        password: "simulation-role-password",
      });
    server = createApp(store).listen(0, "127.0.0.1");
    await new Promise((r) => server.once("listening", r));
    const port = server.address().port;
    const base = `http://127.0.0.1:${port}/api`;
    let cookie;
    const call = (
      endpoint,
      body,
      method = body === undefined ? "GET" : "POST",
      auth = cookie,
    ) =>
      fetch(base + endpoint, {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(auth ? { Cookie: auth } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(15000),
      });
    const ok = async (...args) => {
      const response = await call(...args);
      assert.ok(
        response.ok,
        `${args[0]}: ${response.status} ${response.ok ? "" : await response.text()}`,
      );
      return response.json();
    };
    const login = async (username = "TEST-ADMIN") => {
      const response = await call("/login", {
        username,
        password: "simulation-role-password",
      });
      assert.equal(response.status, 200);
      return response.headers.get("set-cookie").split(";")[0];
    };
    cookie = await login();
    const snapshot = () =>
      JSON.stringify(
        Object.fromEntries(
          [
            "transactions",
            "bolt_ledger",
            "inventory_movements",
            "purchases",
            "trades",
            "trade_items",
            "audit",
          ].map((table) => [
            table,
            store.all(`SELECT * FROM ${table} ORDER BY id`),
          ]),
        ),
      );
    const rejected = async (
      endpoint,
      body,
      pattern,
      method = "POST",
      auth = cookie,
    ) => {
      const before = snapshot();
      const response = await call(endpoint, body, method, auth);
      assert.ok(!response.ok, `${endpoint} should reject`);
      assert.match((await response.json()).error, pattern);
      assert.equal(
        snapshot(),
        before,
        "Rejected operation changed database state",
      );
    };
    const market = () => MARKET.map((c) => store.stock(c.id));
    const ids = ["TEST-T01", "TEST-T02", "TEST-T03", "TEST-T04"];
    const names = [
      "Simulation Alpha",
      "Simulation Beta",
      "Simulation Gamma",
      "Simulation Delta",
    ];
    for (let i = 0; i < 4; i++) {
      const before = market();
      const team = await ok("/teams", {
        id: ids[i],
        name: names[i],
        project: PROJECTS[[0, 0, 1, 2][i]].name,
        members: Array.from(
          { length: 5 },
          (_, n) => `Simulation Member ${i}-${n}`,
        ),
      });
      assert.equal(team.balance, 1000);
      assert.equal(team.initial, 1000);
      assert.deepEqual(market(), before);
      for (const item of STARTERS)
        assert.equal(store.stock(item.id, ids[i]), item.quantity);
      const allocation = store.get(
        "SELECT id FROM transactions WHERE request_key=?",
        `starter-allocation-${ids[i]}`,
      );
      assert.equal(
        store.get(
          "SELECT COUNT(*) n FROM bolt_ledger WHERE transaction_id=?",
          allocation.id,
        ).n,
        0,
      );
      assert.equal(
        store.get(
          "SELECT COUNT(*) n FROM inventory_movements WHERE transaction_id=?",
          allocation.id,
        ).n,
        4,
      );
    }
    await ok(
      "/teams/TEST-T01",
      { ...store.teamDetails("TEST-T01"), name: names[0] },
      "PUT",
    );
    assert.equal(store.stock("ARDUINO_UNO", "TEST-T01"), 1);
    await ok("/mitras", { id: "TEST-M01", name: "Simulation Mentor" });
    await ok("/teams/TEST-T01/mitra", { mitraId: "TEST-M01" }, "PUT");
    pass(
      "Four teams: 1000 INITIAL_BALANCE each, five members, free idempotent starter allocation, no market debit",
    );
    await rejected(
      "/purchases",
      {
        teamId: ids[0],
        componentId: "DC_GEARED_MOTOR",
        quantity: 1,
        expectedPrice: 100,
        requestKey: randomUUID(),
      },
      /locked/,
    );
    await ok("/timer/start", {});
    const purchase = async (
      teamId,
      componentId,
      quantity,
      extra = {},
      auth = cookie,
    ) => {
      const input = {
        teamId,
        componentId,
        quantity,
        expectedPrice: store.component(componentId).price,
        requestKey: randomUUID(),
        ...extra,
      };
      const result = await ok("/purchases", input, "POST", auth);
      const row = store.get(
        "SELECT * FROM purchases WHERE transaction_id=?",
        result.id,
      );
      assert.equal(row.total, quantity * input.expectedPrice);
      assert.equal(row.balance_after, row.balance_before - row.total);
      assert.ok(
        row.ref && result.ref && result.operator_id && result.created_at,
      );
      assert.ok(
        store.get(
          "SELECT id FROM audit WHERE entity_id=? AND action='PURCHASE'",
          result.ref,
        ),
      );
      report.purchases.push({
        team: teamId,
        component: componentId,
        quantity,
        total: row.total,
        before: row.balance_before,
        after: row.balance_after,
      });
      return { input, result, row };
    };
    const p1 = await purchase(ids[0], "DC_GEARED_MOTOR", 2);
    assert.equal(store.balance(ids[0]), 800);
    assert.equal(store.stock("DC_GEARED_MOTOR"), 14);
    const shop = await login("TEST-SHOP"),
      trader = await login("TEST-TRADE"),
      viewer = await login("TEST-VIEWER");
    await purchase(ids[1], "L298D_DRIVER", 1, {}, shop);
    await purchase(ids[1], "DC_GEARED_MOTOR", 2, {}, shop);
    const safePurchase = await purchase(ids[1], "BATTERY", 1, {}, shop);
    for (const [id, qty] of [
      ["IR_SENSOR", 2],
      ["L298D_DRIVER", 1],
      ["DC_GEARED_MOTOR", 2],
      ["BATTERY", 1],
    ])
      await purchase(ids[2], id, qty);
    for (const [id, qty] of [
      ["LDR", 2],
      ["L298D_DRIVER", 1],
      ["DC_GEARED_MOTOR", 2],
      ["BATTERY", 1],
    ])
      await purchase(ids[3], id, qty);
    assert.deepEqual(
      ids.map((id) => store.balance(id)),
      [800, 580, 460, 520],
    );
    report.purchaseBalances = [800, 580, 460, 520];
    for (const project of PROJECTS)
      report.robotCosts[project.name] = Object.entries(
        project.requirements,
      ).reduce((sum, [id, qty]) => sum + store.component(id).price * qty, 0);
    assert.deepEqual(
      Object.values(report.robotCosts),
      [520, 540, 480, 570, 500, 620],
    );
    pass(
      "Official purchases: balances 800 / 580 / 460 / 520; computed robot costs 520 / 540 / 480 / 570 / 500 / 620",
    );
    const beforeDup = snapshot();
    const duplicates = await Promise.all([
      ok("/purchases", p1.input),
      ok("/purchases", p1.input),
    ]);
    assert.ok(duplicates.every((r) => r.duplicate));
    assert.equal(snapshot(), beforeDup);
    const burstPurchase = {
      teamId: ids[0],
      componentId: "BATTERY",
      quantity: 1,
      expectedPrice: 100,
      requestKey: randomUUID(),
    };
    const burstPurchases = await Promise.all([
      ok("/purchases", burstPurchase),
      ok("/purchases", burstPurchase),
    ]);
    assert.equal(burstPurchases[0].id, burstPurchases[1].id);
    assert.equal(
      store.get(
        "SELECT COUNT(*) n FROM purchases WHERE transaction_id=?",
        burstPurchases[0].id,
      ).n,
      1,
    );
    assert.equal(store.balance(ids[0]), 700);
    await ok("/void", {
      transactionId: burstPurchases[0].id,
      notes: "FINAL SIMULATION concurrent purchase cleanup",
      requestKey: randomUUID(),
    });
    assert.equal(store.balance(ids[0]), 800);
    for (const id of ["HC05", "SERVO_MOTOR", "SOUND_SENSOR"])
      await rejected(
        "/purchases",
        {
          teamId: ids[0],
          componentId: id,
          quantity: 2,
          expectedPrice: store.component(id).price,
          approvalReason: "Simulation strategic acquisition",
          requestKey: randomUUID(),
        },
        /OUT OF STOCK/,
      );
    for (const quantity of [0, -1, 1.5])
      await rejected(
        "/purchases",
        {
          teamId: ids[0],
          componentId: "DC_GEARED_MOTOR",
          quantity,
          expectedPrice: 100,
          requestKey: randomUUID(),
        },
        /integer/,
      );
    await rejected(
      "/purchases",
      {
        teamId: ids[3],
        componentId: "DC_GEARED_MOTOR",
        quantity: 6,
        expectedPrice: 100,
        approvalReason: "Simulation overspend",
        requestKey: randomUUID(),
      },
      /INSUFFICIENT RAS BOLTS/,
    );
    await rejected(
      "/purchases",
      {
        teamId: ids[0],
        componentId: "IR_SENSOR",
        quantity: 1,
        expectedPrice: 60,
        requestKey: randomUUID(),
      },
      /Project purchase rule/,
    );
    await rejected(
      "/purchases",
      {
        teamId: ids[0],
        componentId: "IR_SENSOR",
        quantity: 1,
        expectedPrice: 60,
        approvalReason: "Unauthorized override",
        requestKey: randomUUID(),
      },
      /Admin/,
      "POST",
      shop,
    );
    await rejected(
      "/purchases",
      {
        teamId: ids[0],
        componentId: "ARDUINO_UNO",
        quantity: 1,
        expectedPrice: 0,
        requestKey: randomUUID(),
      },
      /starter or workshop/,
    );
    const approved = await purchase(ids[0], "IR_SENSOR", 1, {
      approvalReason: "Organizer approved negotiated strategic acquisition",
    });
    assert.ok(
      store.get(
        "SELECT id FROM audit WHERE action='STRATEGIC_PURCHASE_APPROVAL' AND entity_id=?",
        approved.result.ref,
      ),
    );
    await ok("/void", {
      transactionId: approved.result.id,
      notes: "FINAL SIMULATION strategic approval cleanup",
      requestKey: randomUUID(),
    });
    await ok("/event", { enforceProjectPurchases: false }, "PUT");
    const unrestricted = await purchase(ids[3], "ULTRASONIC", 1);
    await ok("/void", {
      transactionId: unrestricted.result.id,
      notes: "FINAL SIMULATION enforcement switch cleanup",
      requestKey: randomUUID(),
    });
    await ok("/event", { enforceProjectPurchases: true }, "PUT");
    pass(
      "Purchase failures and duplicate confirmations save zero partial data; Admin approval succeeds and enforcement switch works",
    );
    const trade = async (input, auth = cookie) => {
      const before = market();
      const payload = {
        teamA: ids[0],
        teamB: ids[1],
        itemsA: [],
        itemsB: [],
        boltsA: 0,
        boltsB: 0,
        notes: "FINAL SIMULATION agreed terms",
        requestKey: randomUUID(),
        ...input,
      };
      const result = await ok("/trades", payload, "POST", auth);
      assert.deepEqual(market(), before, "Trade changed central stock");
      const details = await ok(`/transactions/${result.id}`);
      assert.ok(
        details.trade.ref &&
          details.operator &&
          details.created_at &&
          details.notes &&
          details.status === "COMPLETED",
      );
      return { result, payload, details };
    };
    const negotiated = await trade(
      {
        itemsA: [{ componentId: "DC_GEARED_MOTOR", quantity: 1 }],
        boltsB: 150,
      },
      trader,
    );
    assert.deepEqual(
      [store.balance(ids[0]), store.balance(ids[1])],
      [950, 430],
    );
    assert.deepEqual(
      negotiated.details.ledger
        .map((l) => [l.team_id, l.type, l.amount])
        .sort(),
      [
        [ids[0], "TRADE_RECEIPT", 150],
        [ids[1], "TRADE_PAYMENT", -150],
      ],
    );
    const itemSwap = await trade({
      teamA: ids[2],
      teamB: ids[3],
      itemsA: [{ componentId: "IR_SENSOR", quantity: 1 }],
      itemsB: [{ componentId: "LDR", quantity: 1 }],
    });
    assert.deepEqual(
      [store.balance(ids[2]), store.balance(ids[3])],
      [460, 520],
    );
    assert.equal(store.stock("LDR", ids[2]), 1);
    assert.equal(store.stock("IR_SENSOR", ids[3]), 1);
    const mixed = await trade({
      teamA: ids[0],
      teamB: ids[2],
      itemsA: [{ componentId: "DC_GEARED_MOTOR", quantity: 1 }],
      itemsB: [{ componentId: "IR_SENSOR", quantity: 1 }],
      boltsB: 50,
    });
    assert.equal(store.balance(ids[0]), 1000);
    assert.equal(store.balance(ids[2]), 410);
    await trade({ teamA: ids[3], teamB: ids[1], boltsA: 30 });
    assert.equal(store.balance(ids[3]), 490);
    assert.equal(store.balance(ids[1]), 460);
    pass(
      "Item↔item, item↔150 negotiated Bolts, mixed item+50 Bolts↔item and pure 30 Bolt transfer; market unchanged",
    );
    const dedup = snapshot();
    await Promise.all([
      ok("/trades", negotiated.payload, "POST", trader),
      ok("/trades", negotiated.payload, "POST", trader),
    ]);
    assert.equal(snapshot(), dedup);
    const burstTrade = {
      teamA: ids[0],
      teamB: ids[1],
      boltsA: 1,
      requestKey: randomUUID(),
    };
    const burstTrades = await Promise.all([
      ok("/trades", burstTrade),
      ok("/trades", burstTrade),
    ]);
    assert.equal(burstTrades[0].id, burstTrades[1].id);
    assert.equal(
      store.get(
        "SELECT COUNT(*) n FROM trades WHERE transaction_id=?",
        burstTrades[0].id,
      ).n,
      1,
    );
    await ok("/void", {
      transactionId: burstTrades[0].id,
      notes: "FINAL SIMULATION concurrent trade cleanup",
      requestKey: randomUUID(),
    });
    for (const input of [
      { teamA: ids[0], teamB: ids[0], boltsA: 1 },
      {
        teamA: ids[0],
        teamB: ids[1],
        itemsA: [{ componentId: "HC05", quantity: 1 }],
      },
      {
        teamA: ids[1],
        teamB: ids[0],
        itemsA: [{ componentId: "DC_GEARED_MOTOR", quantity: 4 }],
      },
      {
        teamA: ids[2],
        teamB: ids[1],
        itemsA: [{ componentId: "LDR", quantity: 1 }],
        boltsB: 99999,
      },
    ])
      await rejected(
        "/trades",
        { requestKey: randomUUID(), ...input },
        /itself|does not own|INSUFFICIENT/,
      );
    await ok("/event", { allowMixedTrades: false }, "PUT");
    await rejected(
      "/trades",
      {
        ...mixed.payload,
        requestKey: randomUUID(),
        teamA: ids[1],
        teamB: ids[3],
        itemsA: [{ componentId: "DC_GEARED_MOTOR", quantity: 1 }],
        itemsB: [{ componentId: "LDR", quantity: 1 }],
        boltsB: 1,
      },
      /Mixed/,
    );
    await ok("/event", { allowMixedTrades: true }, "PUT");
    const move = store.movement.bind(store);
    let calls = 0;
    store.movement = (...args) => {
      move(...args);
      if (++calls === 2)
        throw new Error("Injected simulation failure after posted movements");
    };
    await rejected(
      "/trades",
      {
        teamA: ids[1],
        teamB: ids[3],
        itemsA: [{ componentId: "DC_GEARED_MOTOR", quantity: 1 }],
        boltsB: 10,
        requestKey: randomUUID(),
      },
      /No partial transaction/,
    );
    store.movement = move;
    await rejected(
      "/trades",
      {
        teamA: ids[0],
        teamB: ids[1],
        itemsA: [{ componentId: "JUMPER", quantity: 1 }],
        requestKey: randomUUID(),
      },
      /cannot be traded/,
    );
    pass(
      "Invalid, overspending, unowned, excess, same-team, disabled mixed and injected mid-commit trades roll back all records",
    );
    await ok("/adjustments", {
      teamId: ids[3],
      amount: 25,
      type: "MANUAL_ADJUSTMENT",
      notes: "FINAL SIMULATION TEST",
      requestKey: randomUUID(),
    });
    assert.equal(store.balance(ids[3]), 515);
    const voidInput = (id) => ({
      transactionId: id,
      notes: "FINAL SIMULATION safe void",
      requestKey: randomUUID(),
    });
    await ok("/void", voidInput(safePurchase.result.id));
    assert.equal(
      store.get(
        "SELECT status FROM transactions WHERE id=?",
        safePurchase.result.id,
      ).status,
      "VOIDED",
    );
    assert.equal(store.stock("BATTERY", ids[1]), 0);
    assert.equal(store.balance(ids[1]), 560);
    await purchase(
      ids[1],
      "BATTERY",
      1,
      { correctionOf: safePurchase.result.id },
      cookie,
    );
    await ok("/void", voidInput(mixed.result.id));
    assert.equal(store.balance(ids[0]), 950);
    assert.equal(store.balance(ids[2]), 460);
    const onward = await trade({
      teamA: ids[1],
      teamB: ids[3],
      itemsA: [{ componentId: "DC_GEARED_MOTOR", quantity: 3 }],
    });
    await rejected(
      "/void",
      voidInput(negotiated.result.id),
      /does not own enough/,
    );
    await ok("/void", voidInput(onward.result.id));
    await ok("/void", voidInput(negotiated.result.id));
    assert.equal(store.balance(ids[0]), 800);
    assert.equal(store.balance(ids[1]), 610);
    assert.equal(store.stock("DC_GEARED_MOTOR", ids[0]), 2);
    assert.ok(itemSwap.result.id);
    pass(
      "Reasoned +25 adjustment, purchase void + linked replacement, trade void, dependent reversal rejection and safe unwind",
    );
    for (const auth of [shop, trader, viewer]) {
      for (const endpoint of [
        "/adjustments",
        "/backup",
        "/restore",
        "/timer/pause",
      ])
        await rejected(
          endpoint,
          {
            teamId: ids[0],
            amount: 1,
            notes: "Forbidden",
            requestKey: randomUUID(),
          },
          /Admin/,
          "POST",
          auth,
        );
    }
    await rejected(
      "/trades",
      { ...negotiated.payload, requestKey: randomUUID() },
      /role/,
      "POST",
      shop,
    );
    await rejected(
      "/purchases",
      { ...p1.input, requestKey: randomUUID() },
      /role/,
      "POST",
      trader,
    );
    await rejected(
      "/purchases",
      { ...p1.input, requestKey: randomUUID() },
      /role/,
      "POST",
      viewer,
    );
    assert.equal(
      (await call("/bootstrap", undefined, "GET", viewer)).status,
      200,
    );
    pass(
      "Admin, Shop Operator, Trade Operator and Viewer server authorization",
    );
    for (const query of [
      ids[0],
      names[0],
      "Simulation Member 0-0",
      "Obstacle Avoidance",
      "Simulation Mentor",
      "DC Geared Motor",
      p1.row.ref,
      negotiated.details.trade.ref,
      p1.result.ref,
    ]) {
      const results = await ok(`/search?q=${encodeURIComponent(query)}`);
      assert.ok(results.length, `Search failed: ${query}`);
    }
    for (const query of [
      "team=TEST-T01",
      "type=PURCHASE",
      "component=DC_GEARED_MOTOR",
      `operator=${p1.result.operator_id}`,
      "status=COMPLETED",
      "status=VOIDED",
      "type=TRADE",
      `from=${encodeURIComponent(new Date(Date.now() - 600000).toISOString())}`,
    ]) {
      const result = await ok(`/transactions?${query}`);
      assert.ok(result.total > 0, query);
    }
    pass(
      "Search: IDs/names/member/project/Mitra/component/Purchase/Trade/Transaction; team/type/component/operator/status/time filters",
    );
    const reconciled = {};
    for (const id of ids) {
      const ledger = store.all(
        "SELECT * FROM bolt_ledger WHERE team_id=? ORDER BY id",
        id,
      );
      let running = 0;
      for (const row of ledger) {
        assert.equal(row.balance_before, running);
        running += row.amount;
        assert.equal(row.balance_after, running);
      }
      assert.equal(running, (await ok(`/teams/${id}`)).balance);
      for (const c of [...MARKET, ...STARTERS]) {
        const movements = store.all(
          "SELECT * FROM inventory_movements WHERE team_id=? AND component_id=? ORDER BY id",
          id,
          c.id,
        );
        let count = 0;
        for (const row of movements) {
          assert.equal(row.quantity_before, count);
          count += row.quantity;
          assert.equal(row.quantity_after, count);
        }
        assert.equal(count, store.stock(c.id, id));
        assert.ok(count >= 0);
      }
      reconciled[id] = running;
    }
    for (const component of MARKET) {
      const commercial = store.get(
        "SELECT COALESCE(SUM(m.quantity),0) n FROM inventory_movements m JOIN transactions t ON t.id=m.transaction_id WHERE m.component_id=? AND m.team_id IS NULL AND (t.kind='PURCHASE' OR t.reversal_of IN (SELECT id FROM transactions WHERE kind='PURCHASE'))",
        component.id,
      ).n;
      assert.equal(store.stock(component.id), component.quantity + commercial);
      assert.equal(
        store.get(
          "SELECT COUNT(*) n FROM inventory_movements m JOIN transactions t ON t.id=m.transaction_id WHERE m.team_id IS NULL AND t.kind='TRADE'",
        ).n,
        0,
      );
    }
    const stats = (await ok("/bootstrap")).summary;
    assert.equal(stats.teams, originalTeams.length + 4);
    assert.equal(stats.mitras, 1);
    assert.equal(stats.purchases, 12);
    assert.equal(stats.trades, 2);
    assert.equal(stats.spent, 1640);
    assert.equal(stats.transferred, 30);
    assert.equal(
      stats.inventory,
      market().reduce((a, b) => a + b, 0),
    );
    report.reconciledBalances = reconciled;
    pass(
      "All four balances and all holdings reconcile; exact central-stock arithmetic; dashboard agrees with database",
    );
    const excel = await call("/export/excel");
    assert.equal(excel.status, 200);
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(Buffer.from(await excel.arrayBuffer()));
    for (const name of [
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
      assert.ok(book.getWorksheet(name), name);
    const teamSheet = book.getWorksheet("Teams");
    const headers = teamSheet.getRow(1).values;
    for (const [id, balance] of Object.entries(reconciled)) {
      let found;
      teamSheet.eachRow((row, index) => {
        if (index > 1 && row.getCell(headers.indexOf("Team ID")).value === id)
          found = row;
      });
      assert.equal(
        found.getCell(headers.indexOf("Current RAS Bolts")).value,
        balance,
      );
    }
    for (const sheet of [
      "Teams",
      "Purchases",
      "Trades",
      "RAS Bolt Ledger",
      "Inventory",
      "Team Inventory",
    ]) {
      const response = await call(
        `/export/csv?sheet=${encodeURIComponent(sheet)}`,
      );
      assert.equal(response.status, 200);
      assert.ok((await response.text()).split("\n").length > 1);
    }
    pass(
      "Actual Excel workbook sheets and balances inspected; six CSV exports contain headers and records",
    );
    await ok("/timer/pause", {});
    const paused = await ok("/timer");
    assert.equal(paused.state, "PAUSED");
    const downloaded = await call("/backup", {});
    assert.equal(downloaded.status, 200);
    const backupFile = join(dir, "simulation-backup.sqlite");
    const bytes = Buffer.from(await downloaded.arrayBuffer());
    writeFileSync(backupFile, bytes);
    store.validateBackup(backupFile);
    await ok(
      "/event",
      { eventName: "Harmless simulation restore change" },
      "PUT",
    );
    const invalid = new FormData();
    invalid.set("confirm", "RESTORE DATABASE");
    invalid.set("backup", new Blob(["not sqlite"]), "bad.sqlite");
    const corruptResponse = await fetch(base + "/restore", {
      method: "POST",
      headers: { Cookie: cookie },
      body: invalid,
    });
    assert.equal(corruptResponse.status, 400);
    assert.equal(
      store.config().eventName,
      "Harmless simulation restore change",
    );
    const form = new FormData();
    form.set("confirm", "RESTORE DATABASE");
    form.set("backup", new Blob([bytes]), "simulation.sqlite");
    const restoredResponse = await fetch(base + "/restore", {
      method: "POST",
      headers: { Cookie: cookie },
      body: form,
    });
    assert.equal(restoredResponse.status, 200);
    const restored = await restoredResponse.json();
    assert.ok(existsSync(restored.preRestoreBackup));
    store.validateBackup(restored.preRestoreBackup);
    assert.equal((await call("/me")).status, 401);
    cookie = await login();
    assert.equal(store.config().eventName, "ROBOTS OF THE BACKSTREET");
    assert.equal(store.timer().remaining_ms, paused.remaining_ms);
    for (const [id, balance] of Object.entries(reconciled))
      assert.equal(store.balance(id), balance);
    pass(
      "SQLite backup validated and restored after mutation; corrupt upload rejected; pre-restore backup readable; sessions expired",
    );
    const beforeRestart = snapshot();
    await new Promise((r) => server.close(r));
    server = null;
    store.close();
    store = null;
    child = spawn(process.execPath, ["server/index.mjs"], {
      cwd: resolve("."),
      env: {
        ...process.env,
        PORT: String(port),
        HOST: "127.0.0.1",
        DB_PATH: path,
        DEMO_MODE: "false",
      },
      stdio: "ignore",
    });
    const deadline = Date.now() + 15000;
    while (true) {
      try {
        const response = await call("/me");
        if (response.status === 200) break;
      } catch {
        /* starting */
      }
      if (Date.now() >= deadline || child.exitCode !== null)
        throw new Error("Real process restart failed");
      await new Promise((r) => setTimeout(r, 100));
    }
    store = new Store(path);
    assert.equal(snapshot(), beforeRestart);
    assert.equal((await ok("/timer")).state, "PAUSED");
    assert.equal((await ok("/timer")).remaining_ms, paused.remaining_ms);
    await ok("/timer/resume", {});
    assert.equal((await ok("/timer")).state, "ACTIVE");
    await ok("/timer/end", {});
    assert.equal((await ok("/timer")).state, "ENDED");
    await rejected(
      "/purchases",
      { ...p1.input, requestKey: randomUUID() },
      /locked.*ended/,
    );
    await rejected(
      "/trades",
      { ...itemSwap.payload, requestKey: randomUUID() },
      /locked.*ended/,
    );
    pass(
      "Full Node server process restart persists transactions and PAUSED timer; resume/end; backend end-lock",
    );
    const health = store.integrity();
    assert.equal(health.integrity, "ok");
    for (const [key, value] of Object.entries(health))
      if (Array.isArray(value)) assert.deepEqual(value, [], key);
    report.status = "PASS";
  } finally {
    if (server) await new Promise((r) => server.close(r));
    if (child && child.exitCode === null) {
      const stopped = new Promise((r) => child.once("exit", r));
      child.kill();
      await stopped;
    }
    store?.close();
    if (!dir.startsWith(root + sep) || dir === root)
      throw new Error("Unsafe simulation cleanup path");
    rmSync(dir, { recursive: true, force: true });
    report.cleanup = !existsSync(dir);
  }
  return report;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const result = await runFinalSimulation(
    process.argv[2] ?? "data/competition.sqlite",
  );
  writeFileSync(
    "data/final-simulation-results.json",
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result, null, 2));
}

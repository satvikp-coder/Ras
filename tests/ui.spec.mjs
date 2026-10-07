import { test, expect } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/store.mjs";
import { createApp } from "../server/app.mjs";
import { configureFinalEvent } from "../server/configure-event.mjs";

test("official event browser: eight team slots, free kit, robot selection, LAN request keys, purchase and trade", async ({
  page,
}) => {
  const admin = store.get("SELECT * FROM operators WHERE username='admin'");
  configureFinalEvent(store, admin);
  store.saveTeam(
    admin,
    { ...store.teamDetails("T01"), project: "Obstacle Avoidance Robot" },
    "T01",
  );
  store.saveTeam(
    admin,
    { ...store.teamDetails("T02"), project: "Line Follower Robot" },
    "T02",
  );
  const errors = [],
    external = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/*", (route) => {
    if (new URL(route.request().url()).hostname !== "127.0.0.1") {
      external.push(route.request().url());
      return route.abort();
    }
    return route.continue();
  });
  await page.addInitScript(() =>
    Object.defineProperty(crypto, "randomUUID", { value: undefined }),
  );
  await page.goto(url);
  await page
    .getByLabel("Password", { exact: true })
    .fill("browser-password-123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByText(/8 team slots/)).toBeVisible();
  await expect(page.getByText(/1000 RAS Bolts \/ team/)).toBeVisible();
  await page.getByRole("button", { name: "Teams", exact: true }).click();
  for (let i = 3; i <= 8; i++) {
    await page.getByRole("button", { name: "+ Add team", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("ID *", { exact: true }).fill(`B${i}`);
    await dialog
      .getByLabel("Name *", { exact: true })
      .fill(`Browser Team ${i}`);
    await dialog.getByLabel(/^Members/).fill("One\nTwo\nThree\nFour\nFive");
    await dialog
      .getByLabel("Assigned robot", { exact: true })
      .selectOption(
        [
          "Obstacle Avoidance Robot",
          "Line Follower Robot",
          "Light Follower Robot",
          "Bluetooth Controlled Car",
          "Clap Detector Robot",
          "Radar Car",
        ][i - 3],
      );
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(store.balance(`B${i}`)).toBe(1000);
    expect(store.stock("ARDUINO_UNO", `B${i}`)).toBe(1);
    expect(store.stock("WHEELS_TYRES", `B${i}`)).toBe(2);
  }
  expect(store.get("SELECT COUNT(*) n FROM teams").n).toBe(8);
  await page.getByRole("button", { name: "T02", exact: true }).click();
  await expect(
    page.getByRole("columnheader", { name: "Still required" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Assign Mentor Mitra", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByLabel("Mentor Mitra", { exact: true })
    .selectOption("M01");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Save", exact: true })
    .click();
  await page.getByRole("button", { name: "Dashboard", exact: true }).click();
  await page
    .getByRole("button", { name: "Start competition", exact: true })
    .click();
  await page.getByRole("button", { name: "+ New purchase" }).click();
  let dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Purchasing team", { exact: true })
    .selectOption("T01");
  await dialog
    .getByLabel("Component", { exact: true })
    .selectOption("DC_GEARED_MOTOR");
  expect(
    await dialog
      .getByLabel("Component", { exact: true })
      .locator("option")
      .allTextContents(),
  ).not.toContain("Jumper wires");
  await dialog.getByLabel("Quantity", { exact: true }).fill("2");
  await dialog
    .getByRole("button", { name: "Review purchase", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Confirm purchase", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  expect(store.balance("T01")).toBe(800);
  await page.getByRole("button", { name: "+ New trade" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Team A", { exact: true }).selectOption("T01");
  await dialog.getByLabel("Team B", { exact: true }).selectOption("T02");
  await dialog
    .getByRole("button", { name: "+ Add outgoing item" })
    .first()
    .click();
  await dialog
    .getByLabel("Outgoing item", { exact: true })
    .selectOption("DC_GEARED_MOTOR");
  await dialog.getByLabel("RAS Bolts", { exact: true }).nth(1).fill("150");
  await dialog
    .getByRole("button", { name: "Review trade", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Confirm trade", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  expect(store.balance("T01")).toBe(950);
  expect(store.balance("T02")).toBe(850);
  expect(store.stock("DC_GEARED_MOTOR")).toBe(14);
  await page
    .getByRole("button", { name: "Pause [Space]", exact: true })
    .click();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Resume [Space]", exact: true }),
  ).toBeVisible();
  for (const name of [
    "Teams",
    "Mentor Mitras",
    "Shop",
    "Inventory",
    "Purchases",
    "Trades",
    "Ledger",
    "Audit Log",
    "Reports",
    "Settings",
  ]) {
    await page
      .getByRole("navigation")
      .getByRole("button", { name, exact: true })
      .click();
    await expect(page.locator("h1")).toBeVisible();
  }
  expect(errors).toEqual([]);
  expect(external).toEqual([]);
});

let store, server, dir, url;
test("partial refund automatically refreshes purchase quantities, credit and current balance", async ({
  page,
}) => {
  const admin = store.get("SELECT * FROM operators WHERE username='admin'");
  store.saveConfig(admin, { allowRefunds: true });
  store.timerAction(admin, "start");
  const purchase = store.purchase(admin, {
    teamId: "T01",
    componentId: "C01",
    quantity: 2,
    expectedPrice: 10,
    requestKey: "browser-purchase-refund-display-001",
  });
  const original = store.get(
    "SELECT * FROM purchases WHERE transaction_id=?",
    purchase.id,
  );
  await page.goto(url);
  await page
    .getByLabel("Password", { exact: true })
    .fill("browser-password-123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Purchases", exact: true })
    .click();
  const row = page.getByRole("row").filter({ hasText: original.ref });
  await expect(row.getByRole("cell").nth(4)).toHaveText("2");
  store.refund(admin, {
    purchaseId: original.id,
    quantity: 1,
    notes: "One returned motor",
    requestKey: "browser-one-motor-refund-display-001",
  });
  await expect(row.getByRole("cell").nth(4)).toHaveText("1", {
    timeout: 15000,
  });
  await expect(row.getByRole("cell").nth(5)).toHaveText("2");
  await expect(row.getByRole("cell").nth(6)).toHaveText("1");
  await expect(row.getByRole("cell").nth(7)).toHaveText("10");
  await expect(row.getByRole("cell").nth(8)).toHaveText("10");
  await page.getByRole("button", { name: original.ref, exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("90 RAS Bolts", { exact: true })).toBeVisible();
  await expect(
    dialog.getByText("Quantity kept after returns", { exact: true }),
  ).toBeVisible();
  expect(store.balance("T01")).toBe(90);
  expect(store.stock("C01", "T01")).toBe(1);
});
test("admin creates a team login and the team signs in to its own dashboard", async ({
  page,
}) => {
  await page.goto(url);
  await page
    .getByLabel("Password", { exact: true })
    .fill("browser-password-123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "T01", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByLabel(/^Team username/)
    .fill("rebels");
  await page
    .getByRole("dialog")
    .getByLabel(/^Password/)
    .fill("team-password-123");
  await page.getByRole("button", { name: "Save team login" }).click();
  await expect(
    page.getByRole("cell", { name: "rebels", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Sign out/i }).click();
  await page.getByLabel("Sign in as").selectOption("team");
  await page.getByLabel("Username", { exact: true }).fill("rebels");
  await page.getByLabel("Password", { exact: true }).fill("team-password-123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Robo Rebels" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "100 RAS Bolts" }),
  ).toBeVisible();
  await expect(page.getByText("Circuit Breakers")).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Your inventory", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(
    page.getByRole("button", { name: "Sign in", exact: true }),
  ).toBeVisible();
});
test.beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "ras-ui-"));
  store = new Store(join(dir, "event.sqlite"), {
    bootstrapPassword: "browser-password-123",
  });
  const admin = store.get("SELECT * FROM operators WHERE username='admin'");
  store.saveConfig(admin, {
    initialBolts: 100,
    allocationConfirmed: true,
    rulesConfirmed: true,
    allowItemTrading: true,
    allowItemForBolts: true,
    allowItemForItem: true,
    allowBoltTransfer: true,
  });
  store.saveTeam(admin, {
    id: "T01",
    name: "Robo Rebels",
    members: ["Member A"],
    project: "Delivery Robot",
  });
  store.saveTeam(admin, { id: "T02", name: "Circuit Breakers" });
  store.saveComponent(admin, {
    id: "C01",
    name: "DC Motor",
    price: 10,
    initialQuantity: 10,
  });
  store.saveMitra(admin, { id: "M01", name: "Mentor One" });
  // Windows may allocate browser-blocked low ports (for example 6668).
  for (let port = 31000; port < 31100; port++) {
    server = createApp(store).listen(port, "127.0.0.1");
    try {
      await new Promise((resolve, reject) => {
        server.once("listening", resolve);
        server.once("error", reject);
      });
      break;
    } catch (error) {
      if (error.code !== "EADDRINUSE" || port === 31099) throw error;
    }
  }
  url = `http://127.0.0.1:${server.address().port}`;
});
test.afterEach(async () => {
  await new Promise((r) => server.close(r));
  store.close();
  rmSync(dir, { recursive: true, force: true });
});
test("offline desktop: purchase, trade, Mitra, histories, search, Excel, backup, timer, all screens", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const external = [];
  await page.route("**/*", (route) => {
    const requested = new URL(route.request().url());
    if (requested.hostname !== "127.0.0.1") {
      external.push(requested.href);
      return route.abort();
    }
    return route.continue();
  });
  await page.goto(url);
  await page
    .getByLabel("Password", { exact: true })
    .fill("browser-password-123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Start competition", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Start competition", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Pause [Space]", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "+ New purchase" }).click();
  let dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Purchasing team", { exact: true })
    .selectOption("T01");
  await dialog.getByLabel("Component", { exact: true }).selectOption("C01");
  await dialog.getByLabel("Quantity", { exact: true }).fill("2");
  await dialog
    .getByRole("button", { name: "Review purchase", exact: true })
    .click();
  await expect(dialog.getByText("20 RAS Bolts", { exact: true })).toBeVisible();
  await dialog
    .getByRole("button", { name: "Confirm purchase", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(store.balance("T01")).toBe(80);
  await page.getByRole("button", { name: "+ New trade" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Team A", { exact: true }).selectOption("T01");
  await dialog.getByLabel("Team B", { exact: true }).selectOption("T02");
  await dialog
    .getByRole("button", { name: "+ Add outgoing item" })
    .first()
    .click();
  await dialog.getByLabel("Outgoing item", { exact: true }).selectOption("C01");
  await dialog.getByLabel("RAS Bolts", { exact: true }).nth(1).fill("15");
  await dialog
    .getByRole("button", { name: "Review trade", exact: true })
    .click();
  await expect(
    dialog.getByText("After: 95 RAS Bolts", { exact: true }),
  ).toBeVisible();
  await dialog
    .getByRole("button", { name: "Confirm trade", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(store.balance("T01")).toBe(95);
  expect(store.balance("T02")).toBe(85);
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Teams", exact: true })
    .click();
  await page.getByRole("button", { name: "T01", exact: true }).click();
  await page
    .getByRole("button", { name: "Assign Mentor Mitra", exact: true })
    .click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Mentor Mitra", { exact: true }).selectOption("M01");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "M01 — Mentor One", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Search", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox").fill("PUR-");
  await dialog.getByRole("button", { name: "Search", exact: true }).click();
  await expect(
    page.getByRole("dialog").getByRole("button", { name: /TXN-.*PUR-/ }),
  ).toBeVisible();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /TXN-.*PUR-/ })
    .click();
  await expect(
    page.getByRole("dialog").getByText("RAS Bolt ledger", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Close", exact: true })
    .click();
  for (const name of [
    "Dashboard",
    "Teams",
    "Mentor Mitras",
    "Shop",
    "Inventory",
    "Purchases",
    "Trades",
    "Ledger",
    "Audit Log",
    "Reports",
    "Settings",
  ]) {
    await page
      .getByRole("navigation")
      .getByRole("button", { name, exact: true })
      .click();
    await expect(page.locator("h1")).toHaveText(name);
    await expect(page.getByRole("alert")).toHaveCount(0);
  }
  const excelPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export Excel", exact: true }).click();
  expect((await excelPromise).suggestedFilename()).toMatch(/\.xlsx$/);
  const backupPromise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Backup database", exact: true })
    .click();
  const backupDownload = await backupPromise;
  expect(backupDownload.suggestedFilename()).toMatch(/\.sqlite$/);
  const backupPath = await backupDownload.path();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Dashboard", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Pause [Space]", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Resume [Space]", exact: true }),
  ).toBeVisible();
  const paused = store.timer().remaining_ms;
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Resume [Space]", exact: true }),
  ).toBeVisible();
  expect(store.timer().remaining_ms).toBe(paused);
  await page.screenshot({ path: "test-results/desktop.png", fullPage: true });
  const admin = store.get("SELECT * FROM operators WHERE username='admin'");
  store.saveTeam(admin, { id: "T99", name: "Temporary post-backup team" });
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Settings", exact: true })
    .click();
  await page
    .getByLabel("SQLite backup", { exact: true })
    .setInputFiles(backupPath);
  await page
    .getByLabel("Type RESTORE DATABASE", { exact: true })
    .fill("RESTORE DATABASE");
  await page
    .getByRole("button", { name: "Validate and restore database", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Sign in", exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Password", { exact: true })
    .fill("browser-password-123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator("h1")).toHaveText("Dashboard");
  expect(store.get("SELECT id FROM teams WHERE id=?", "T99")).toBeUndefined();
  expect(store.balance("T01")).toBe(95);
  expect(
    store.get("SELECT id FROM audit WHERE action='DATABASE_RESTORE'"),
  ).toBeTruthy();
  expect(errors).toEqual([]);
  expect(external).toEqual([]);
});
test("tablet layout and unauthenticated/session flow", async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 1180 });
  await page.goto(url);
  await page
    .getByLabel("Password", { exact: true })
    .fill("browser-password-123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator("h1")).toHaveText("Dashboard");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Teams", exact: true })
    .click();
  await page.getByRole("button", { name: "+ Add team", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("ID *", { exact: true }).fill("T03");
  await dialog.getByLabel("Name *", { exact: true }).fill("Tablet Team");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "T03", exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: "test-results/tablet.png", fullPage: true });
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Sign in", exact: true }),
  ).toBeVisible();
});

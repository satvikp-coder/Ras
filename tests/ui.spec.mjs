import { test, expect } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/store.mjs";
import { createApp } from "../server/app.mjs";

let store, server, dir, url;
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
  server = createApp(store).listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
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

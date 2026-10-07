import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { chromium } from "@playwright/test";
import { Store, tokenHash } from "../server/store.mjs";
import { MARKET } from "../server/event-rules.mjs";

const url = process.argv[2] ?? "http://127.0.0.1:3000";
const store = new Store(process.env.DB_PATH ?? "data/competition.sqlite");
const token = randomBytes(32).toString("hex");
const admin = store.get(
  "SELECT id FROM operators WHERE role='Admin' AND active=1 ORDER BY id LIMIT 1",
);
let browser;
try {
  // Short-lived local inspection session; no passwords or operators are changed.
  store.run(
    "INSERT INTO sessions VALUES(?,?,?)",
    tokenHash(token),
    admin.id,
    Date.now() + 300000,
  );
  browser = await chromium.launch({
    channel:
      process.env.PLAYWRIGHT_CHANNEL ??
      (process.platform === "win32" ? "msedge" : undefined),
    headless: true,
  });
  const context = await browser.newContext();
  await context.addCookies([
    {
      name: "ras_session",
      value: token,
      url,
      httpOnly: true,
      sameSite: "Strict",
    },
  ]);
  const page = await context.newPage();
  const errors = [],
    external = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/*", (route) => {
    if (new URL(route.request().url()).origin !== new URL(url).origin) {
      external.push(route.request().url());
      return route.abort();
    }
    return route.continue();
  });
  await page.goto(url);
  await page
    .getByRole("button", { name: "Start competition", exact: true })
    .waitFor();
  assert.match(
    await page.locator("body").innerText(),
    /1000 RAS Bolts \/ team/,
  );
  assert.match(await page.locator("body").innerText(), /01:30:00/);
  await page.screenshot({
    path: "data/final-ready-dashboard.png",
    fullPage: true,
  });
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
    await page.locator("h1").waitFor();
    assert.ok(
      !/TEST-T0[1-4]|Simulation Alpha|Simulation Beta|Simulation Gamma|Simulation Delta/.test(
        await page.locator("body").innerText(),
      ),
      name,
    );
  }
  await page.getByRole("button", { name: "+ New purchase" }).click();
  const dialog = page.getByRole("dialog");
  const values = await dialog
    .getByLabel("Component", { exact: true })
    .locator("option")
    .evaluateAll((options) => options.map((o) => o.value).filter(Boolean));
  assert.deepEqual(values.sort(), MARKET.map((c) => c.id).sort());
  await dialog.getByRole("button", { name: "Close dialog" }).click();
  await page.getByRole("button", { name: "+ New trade" }).click();
  await page
    .getByRole("dialog")
    .getByLabel("Team A", { exact: true })
    .waitFor();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Close dialog" })
    .click();
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  console.log(
    `LIVE UI PASS: ${url}; ten screens, purchase/trade dialogs, exact nine market choices, clean timer, zero browser errors/external requests.`,
  );
} finally {
  await browser?.close();
  store.run("DELETE FROM sessions WHERE token_hash=?", tokenHash(token));
  store.close();
}

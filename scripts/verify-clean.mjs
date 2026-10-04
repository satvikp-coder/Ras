import { cpSync, mkdtempSync, rmSync, existsSync } from "node:fs";
import { resolve, join, sep } from "node:path";
import { tmpdir } from "node:os";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
const root = resolve(tmpdir());
const clean = mkdtempSync(join(root, "ras-clean-install-"));
if (!clean.startsWith(root + sep))
  throw new Error("Temporary workspace escaped its intended directory");
const source = resolve(".");
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("Run with npm run verify:clean");
let child;
function run(args) {
  const result = spawnSync(process.execPath, [npmCli, ...args], {
    cwd: clean,
    stdio: "inherit",
  });
  if (result.status !== 0) throw new Error(`npm ${args.join(" ")} failed`);
}
async function start() {
  child = spawn(process.execPath, ["server/index.mjs"], {
    cwd: clean,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: "3099",
      DB_PATH: "data/competition.sqlite",
      BOOTSTRAP_PASSWORD: "clean-test-password-123",
      DEMO_MODE: "false",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let logs = "";
  child.stdout.on("data", (v) => {
    logs += v;
  });
  child.stderr.on("data", (v) => {
    logs += v;
  });
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    try {
      const r = await fetch("http://127.0.0.1:3099/api/me", {
        signal: AbortSignal.timeout(2000),
      });
      if (r.status === 401) return;
    } catch {
      /* Server is still starting. */
    }
    if (child.exitCode !== null) throw new Error(logs);
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("Server startup timed out: " + logs);
}
async function stop() {
  if (!child || child.exitCode !== null) return;
  const stopped = new Promise((r) => child.once("exit", r));
  child.kill();
  await stopped;
  child = null;
}
const base = "http://127.0.0.1:3099/api";
let cookie;
async function call(path, body, method = body ? "POST" : "GET") {
  const r = await fetch(base + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!r.ok) throw new Error(`${path}: ${r.status} ${await r.text()}`);
  return r;
}
async function login() {
  const r = await call("/login", {
    username: "admin",
    password: "clean-test-password-123",
  });
  cookie = r.headers.get("set-cookie").split(";")[0];
}
try {
  for (const name of [
    "package.json",
    "package-lock.json",
    "index.html",
    "tsconfig.json",
    "vite.config.ts",
    "eslint.config.mjs",
    "playwright.config.mjs",
    ".env.example",
    "README.md",
    "client",
    "server",
    "scripts",
    "tests",
    "docs",
  ])
    if (existsSync(join(source, name)))
      cpSync(join(source, name), join(clean, name), { recursive: true });
  console.log("Clean workspace:", clean);
  run(["ci"]);
  run(["run", "lint"]);
  run(["run", "build"]);
  run(["test"]);
  await start();
  await login();
  await call(
    "/event",
    {
      initialBolts: 100,
      allocationConfirmed: true,
      rulesConfirmed: true,
      allowItemTrading: true,
      allowItemForBolts: true,
    },
    "PUT",
  );
  await call("/teams", { id: "T01", name: "Team A" });
  await call("/teams", { id: "T02", name: "Team B" });
  await call("/components", {
    id: "MOTOR",
    name: "Motor",
    price: 10,
    initialQuantity: 10,
  });
  await call("/timer/start", {});
  await call("/purchases", {
    teamId: "T01",
    componentId: "MOTOR",
    expectedPrice: 10,
    quantity: 2,
    requestKey: randomUUID(),
  });
  await call("/trades", {
    teamA: "T01",
    teamB: "T02",
    boltsB: 15,
    itemsA: [{ componentId: "MOTOR", quantity: 1 }],
    requestKey: randomUUID(),
  });
  const team = await (await call("/teams/T01")).json();
  assert.equal(team.balance, 95);
  assert.equal(team.inventory[0].quantity, 1);
  const excel = await call("/export/excel");
  assert.ok((await excel.arrayBuffer()).byteLength > 1000);
  const backup = await call("/backup", {});
  assert.ok((await backup.arrayBuffer()).byteLength > 1000);
  await stop();
  await start();
  await login();
  assert.equal((await (await call("/teams/T01")).json()).balance, 95);
  const page = await fetch("http://127.0.0.1:3099");
  assert.equal(page.status, 200);
  assert.ok((await page.text()).includes("RAS Control Center"));
  console.log(
    "CLEAN INSTALL PASSED: installation, lint, tests, build, fresh initialization, production startup, HTTP purchase/trade, Excel, backup and server restart.",
  );
} finally {
  await stop();
  if (clean.startsWith(root + sep) && clean !== root)
    rmSync(clean, { recursive: true, force: true });
}

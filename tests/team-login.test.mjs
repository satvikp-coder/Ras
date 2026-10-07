import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/store.mjs";
import { createApp } from "../server/app.mjs";

test("team authentication isolates data and rejects every operator endpoint; reset, disable, expiry and logout revoke access", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "ras-team-"));
  const store = new Store(join(dir, "event.sqlite"), {
    bootstrapPassword: "admin-password-123",
  });
  const admin = store.get("SELECT * FROM operators WHERE username='admin'");
  store.saveConfig(admin, {
    initialBolts: 100,
    allocationConfirmed: true,
    rulesConfirmed: true,
  });
  store.saveTeam(admin, {
    id: "T01",
    name: "First",
    notes: "Private organizer note",
  });
  store.saveTeam(admin, { id: "T02", name: "Secret second team" });
  const credentials = {
    username: "first",
    password: "team-password-123",
    active: true,
  };
  store.saveTeamAccount(admin, "T01", credentials);
  assert.throws(
    () => store.saveTeamAccount({ role: "Viewer" }, "T02", credentials),
    /Admin|admin|permission/i,
  );
  const server = createApp(store).listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  t.after(async () => {
    await new Promise((r) => server.close(r));
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const call = (path, cookie, method = "GET", body) =>
    fetch(base + path, {
      method,
      headers: { Cookie: cookie ?? "", "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
  const login = (overrides = {}) =>
    call("/login", "", "POST", {
      ...credentials,
      accountType: "team",
      ...overrides,
    });
  assert.equal((await login({ password: "wrong-password" })).status, 401);
  assert.equal((await login({ accountType: "operator" })).status, 401);
  const response = await login();
  assert.equal(response.status, 200);
  assert.equal((await response.json()).role, "Team");
  const cookie = response.headers.get("set-cookie").split(";")[0];
  assert.equal((await call("/me", cookie)).status, 200);
  const portal = await (await call("/team-portal?teamId=T02", cookie)).json();
  assert.equal(portal.team.id, "T01");
  assert.equal(portal.team.balance, 100);
  assert.equal(portal.ledger.length, 1);
  assert.ok(!JSON.stringify(portal).includes("Secret second team"));
  assert.ok(!JSON.stringify(portal).includes("Private organizer note"));
  for (const path of [
    "/bootstrap",
    "/teams",
    "/teams/T02",
    "/search?q=T02",
    "/export/excel",
    "/history/ledger",
    "/transactions/1",
    "/team-accounts",
    "/integrity",
  ])
    assert.equal((await call(path, cookie)).status, 403, path);
  for (const path of [
    "/purchases",
    "/trades",
    "/backup",
    "/timer/start",
    "/operators",
    "/restore",
  ])
    assert.equal((await call(path, cookie, "POST", {})).status, 403, path);
  assert.equal(
    (await call("/team-accounts/T02", cookie, "PUT", credentials)).status,
    403,
  );
  store.saveTeamAccount(admin, "T01", {
    ...credentials,
    password: "replacement-password",
  });
  assert.equal((await call("/team-portal", cookie)).status, 401);
  assert.equal((await login()).status, 401);
  const newLogin = await login({ password: "replacement-password" });
  const newCookie = newLogin.headers.get("set-cookie").split(";")[0];
  store.run("UPDATE teams SET status='Inactive' WHERE id='T01'");
  assert.equal((await call("/team-portal", newCookie)).status, 401);
  store.run("UPDATE teams SET status='Active' WHERE id='T01'");
  store.run("UPDATE team_sessions SET expires_at=0");
  assert.equal((await call("/team-portal", newCookie)).status, 401);
  const lastLogin = await login({ password: "replacement-password" });
  const lastCookie = lastLogin.headers.get("set-cookie").split(";")[0];
  assert.equal((await call("/logout", lastCookie, "POST")).status, 200);
  assert.equal((await call("/team-portal", lastCookie)).status, 401);
  store.saveTeamAccount(admin, "T01", { ...credentials, active: false });
  assert.equal((await login()).status, 401);
  const backup = join(dir, "backup.sqlite");
  await store.backupTo(backup);
  store.validateBackup(backup);
});

test("version 1 databases migrate with existing records and credentials intact", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "ras-migration-"));
  const path = join(dir, "event.sqlite");
  let store = new Store(path, { bootstrapPassword: "admin-password-123" });
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const admin = store.get("SELECT * FROM operators WHERE username='admin'");
  store.saveConfig(admin, {
    initialBolts: 100,
    allocationConfirmed: true,
    rulesConfirmed: true,
  });
  store.saveTeam(admin, { id: "T01", name: "Preserved" });
  store.db.exec(
    "DROP TABLE team_sessions; DROP TABLE team_accounts; DROP TABLE schema_version; CREATE TABLE schema_version(version INTEGER PRIMARY KEY CHECK(version=1)); INSERT INTO schema_version VALUES(1)",
  );
  store.close();
  store = new Store(path);
  assert.equal(store.get("SELECT version FROM schema_version").version, 2);
  assert.equal(store.teamDetails("T01").name, "Preserved");
  assert.equal(
    store.get("SELECT password_hash FROM operators WHERE id=?", admin.id)
      .password_hash,
    admin.password_hash,
  );
  store.saveTeamAccount(admin, "T01", {
    username: "first",
    password: "team-password-123",
  });
  assert.equal(store.teamAccounts().length, 1);
});

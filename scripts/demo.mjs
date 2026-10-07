import { Store } from "../server/store.mjs";
import { existsSync } from "node:fs";
const path = "data/demo.sqlite";
if (existsSync(path)) {
  console.error(
    "Demo database already exists. To reset, stop the demo server and delete only data/demo.sqlite (and its -wal/-shm files), then run npm run demo. The real competition database is never reset by this script.",
  );
  process.exit(1);
}
const store = new Store(path, { demo: true });
const admin = store.get("SELECT * FROM operators WHERE username='admin'");
store.saveConfig(admin, {
  initialBolts: 1000,
  allocationConfirmed: true,
  rulesConfirmed: true,
  allowItemTrading: true,
  allowBoltTransfer: true,
  allowItemForBolts: true,
  allowItemForItem: true,
  allowMixedTrades: true,
  eventName: "Robots of the Backstreet — DEMO",
});
for (let i = 1; i <= 3; i++)
  store.saveTeam(admin, {
    id: `T0${i}`,
    name: `DEMO Team ${i}`,
    members: [`DEMO Member ${i}`],
    project: "DEMO Robot",
    notes: "Sample data only",
  });
for (let i = 1; i <= 2; i++)
  store.saveMitra(admin, {
    id: `M0${i}`,
    name: `DEMO Mentor ${i}`,
    notes: "Sample data only",
  });
store.assign(admin, "T01", "M01");
store.assign(admin, "T02", "M01");
for (const [id, name, price, quantity] of [
  ["C01", "DEMO DC Motor", 10, 10],
  ["C02", "DEMO Sensor", 5, 20],
  ["C03", "DEMO Wheel", 2, 30],
])
  store.saveComponent(admin, {
    id,
    name,
    price,
    initialQuantity: quantity,
    notes: "DEMO price and stock — not competition rules",
  });
console.log(
  `Demo initialized: ${store.path}\nUsername: admin\nPassword: ${store.bootstrapPassword}\nPowerShell: $env:DB_PATH='data/demo.sqlite'; $env:DEMO_MODE='true'; npm start\nUse a separate terminal for the real event, or clear these environment variables.`,
);
store.close();

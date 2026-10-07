import "dotenv/config";
import { Store } from "../server/store.mjs";
import { configureFinalEvent } from "../server/configure-event.mjs";
import { dirname, join } from "node:path";
const store = new Store(process.env.DB_PATH ?? "data/competition.sqlite");
try {
  const backup = join(
    dirname(store.path),
    "backups",
    `PRE_FINAL_CONFIGURATION_${Date.now()}.sqlite`,
  );
  await store.backupTo(backup);
  const admin = store.get(
    "SELECT * FROM operators WHERE role='Admin' AND active=1 ORDER BY id LIMIT 1",
  );
  console.log(
    JSON.stringify(
      {
        backup,
        ...configureFinalEvent(store, admin),
        integrity: store.integrity(),
      },
      null,
      2,
    ),
  );
} finally {
  store.close();
}

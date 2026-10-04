import "dotenv/config";
import { Store } from "./store.mjs";
import { createApp } from "./app.mjs";
const store = new Store(process.env.DB_PATH ?? "data/competition.sqlite", {
  bootstrapPassword: process.env.BOOTSTRAP_PASSWORD,
  demo: process.env.DEMO_MODE === "true",
});
if (store.bootstrapPassword)
  console.log(
    `FIRST RUN — username: admin | password: ${store.bootstrapPassword}\nSave this password securely. It is shown only once. Change it in Settings > Operators.`,
  );
const host = process.env.HOST ?? "127.0.0.1",
  port = Number(process.env.PORT ?? 3000);
const server = createApp(store, {
  devOrigin: process.argv.includes("--dev") ? "http://127.0.0.1:5173" : null,
}).listen(port, host, () =>
  console.log(
    `RAS Control Center: http://${host}:${port} | database: ${store.path}`,
  ),
);
server.on("error", (error) => {
  console.error(`Startup failed: ${error.message}`);
  store.close();
  process.exit(1);
});
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () =>
    server.close(() => {
      store.close();
      process.exit(0);
    }),
  );

import { spawn } from "node:child_process";
const children = [
  spawn(process.execPath, ["server/index.mjs", "--dev"], { stdio: "inherit" }),
  spawn(process.execPath, ["node_modules/vite/bin/vite.js"], {
    stdio: "inherit",
  }),
];
for (const child of children)
  child.on("exit", (code) => {
    for (const other of children) other.kill();
    process.exit(code ?? 0);
  });
process.on("SIGINT", () => {
  for (const child of children) child.kill();
});

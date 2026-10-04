import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests",
  testMatch: "*.spec.mjs",
  workers: 1,
  timeout: 60000,
  use: {
    browserName: "chromium",
    channel:
      process.env.PLAYWRIGHT_CHANNEL ||
      (process.platform === "win32" ? "msedge" : undefined),
    headless: true,
  },
  reporter: "list",
});

import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3100",
    viewport: { width: 1440, height: 900 },
    // Use a preinstalled Chromium if provided (CI sandboxes); otherwise `npx playwright install chromium`.
    launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
  },
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : { command: "npm run build && npx next start -p 3100", url: "http://localhost:3100/api/health", reuseExistingServer: true, timeout: 180_000 },
});

import { test as base, expect } from "@playwright/test";

/**
 * Each test is a different student. The server rate-limits /api/turn per client address
 * (60 turns a minute), and the whole suite runs from one machine, so each test context gets
 * its own address. The limit itself is unchanged and is covered by tests/server.test.ts.
 *
 * Every test starts signed in (through the real sign-in endpoint), unless it sets `test.use({ signedIn: false })`.
 * The credentials come from E2E_USERNAME / E2E_PASSWORD: run the server under test with a throwaway password's
 * hash (see docs/SECURITY.md), never the production one.
 */
let n = 0;
export const E2E_USERNAME = process.env.E2E_USERNAME ?? "";
export const E2E_PASSWORD = process.env.E2E_PASSWORD ?? "";

export async function signInVia(context: import("@playwright/test").BrowserContext, baseURL: string, username = E2E_USERNAME, password = E2E_PASSWORD) {
  return context.request.post("/api/auth/login", { data: { username, password }, headers: { origin: new URL(baseURL).origin } });
}

export const test = base.extend<{ isolateClient: void; signedIn: boolean }>({
  signedIn: [true, { option: true }],
  isolateClient: [
    async ({ context, signedIn, baseURL }, use, info) => {
      n += 1;
      await context.setExtraHTTPHeaders({ "x-forwarded-for": `10.${info.workerIndex % 250}.${Math.floor(n / 250) % 250}.${n % 250}` });
      if (signedIn) {
        if (!E2E_USERNAME || !E2E_PASSWORD) throw new Error("Set E2E_USERNAME and E2E_PASSWORD for the server under test (see docs/SECURITY.md).");
        const res = await signInVia(context, baseURL!);
        if (res.status() !== 200) throw new Error(`Sign-in for the test failed: HTTP ${res.status()}`);
      }
      await use();
    },
    { auto: true },
  ],
});
export { expect };

/** Transcript, My progress, Restart and the voice toggles live in the top bar's Menu. */
export async function openMenu(page: import("@playwright/test").Page) {
  const b = page.getByRole("button", { name: "Menu" });
  if ((await b.getAttribute("aria-expanded")) !== "true") await b.click();
  await expect(page.getByRole("group", { name: "Lesson menu" })).toBeVisible();
}
export async function closeMenu(page: import("@playwright/test").Page) {
  const b = page.getByRole("button", { name: "Menu" });
  if ((await b.getAttribute("aria-expanded")) === "true") await b.click();
}
/** Turn read-aloud off (menu), then close the menu. */
export async function readAloudOff(page: import("@playwright/test").Page) {
  await openMenu(page);
  const r = page.getByLabel("Read aloud");
  if (await r.isEnabled()) await r.uncheck();
  await closeMenu(page);
}

/** The welcome state: switch "Sound on" to off, then Start Lesson. */
export async function startWithoutSound(page: import("@playwright/test").Page) {
  await page.waitForLoadState("networkidle"); // a remembered sound choice is applied after hydration
  const toggle = page.getByRole("button", { name: "Sound on" });
  if (await toggle.count()) await toggle.click();
  await page.getByRole("button", { name: "Start Lesson" }).click();
}

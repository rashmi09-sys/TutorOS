import { test as base, expect } from "@playwright/test";

/**
 * Each test is a different student. The server rate-limits /api/turn per client address
 * (60 turns a minute), and the whole suite runs from one machine, so each test context gets
 * its own address. The limit itself is unchanged and is covered by tests/server.test.ts.
 */
let n = 0;
export const test = base.extend<{ isolateClient: void }>({
  isolateClient: [
    async ({ context }, use, info) => {
      n += 1;
      await context.setExtraHTTPHeaders({ "x-forwarded-for": `10.${info.workerIndex % 250}.${Math.floor(n / 250) % 250}.${n % 250}` });
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

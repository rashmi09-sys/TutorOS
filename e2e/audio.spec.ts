import type { Page } from "@playwright/test";
import { expect, openMenu, closeMenu, test, startWithoutSound } from "./fixtures";
import { mockSpeech, recCount, speechLog, spokenTexts } from "./speech-mock";

/**
 * The student decides when anything makes a sound. Speech APIs are mocked (see speech-mock.ts):
 * the mock is a real queue, so these tests see exactly what the app asked the browser to say, in order.
 */
const KEY = "tutoros.session.v2";
const turnNow = (page: Page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? "null")?.state?.turn ?? 0, KEY);
/** The first spoken sentence of the latest tutor message, as the voice receives it. */
const firstSentence = (page: Page) =>
  page.evaluate((k) => {
    const s = JSON.parse(localStorage.getItem(k)!).state;
    const t = [...s.transcript].reverse().find((m: { role: string }) => m.role === "tutor").text as string;
    return t.split(/(?<=[.?!])\s+/)[0];
  }, KEY);
const said = (t: string) => t.replace(/(\d)x\b/g, "$1 x").replace(/ \+ /g, " plus ").replace(/ = /g, " equals ");

async function fresh(page: Page, opts: Parameters<typeof mockSpeech>[1] = {}) {
  await mockSpeech(page, opts);
  await page.goto("/learn/algebra");
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.goto("/learn/algebra");
}

test("page load: no speech, no microphone; a clear start screen", async ({ page }) => {
  await fresh(page);
  await expect(page.getByRole("heading", { name: "Ready to figure this out?" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start Lesson" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sound on" })).toHaveAttribute("aria-pressed", "true");
  await page.waitForTimeout(1500);
  expect(await spokenTexts(page)).toEqual([]);
  expect(await recCount(page)).toBe(0);
  expect((await speechLog(page)).filter((e) => e.startsWith("speak:") || e === "mic:request")).toEqual([]);
});

test("Start the lesson: the introduction is spoken exactly once, with one voice, and nothing follows on its own", async ({ page }) => {
  await page.clock.install();
  await fresh(page);
  await page.getByRole("button", { name: "Start Lesson" }).click();
  await expect(page.locator(".note.active")).toContainText("3x + 5 = 20");
  await page.clock.runFor(5000); // the whole intro plays
  const spoken = await spokenTexts(page);
  const first = said(await firstSentence(page));
  expect(spoken.filter((t) => t.trim() === first)).toHaveLength(1);
  expect(spoken.join(" ")).toMatch(/start\?/);
  // Every sentence was handed to the browser at once, in the same voice (no mid-turn voice switch).
  const speaks = (await speechLog(page)).filter((e) => e.startsWith("speak:"));
  expect(new Set(speaks.map((e) => e.split("|")[1]))).toEqual(new Set(["Daniel"])); // the on-device voice
  // A minute of silence: no idle prompt, no new tutor turn, no microphone.
  const before = await turnNow(page);
  const n = spoken.length;
  await page.clock.runFor(60_000);
  expect(await turnNow(page)).toBe(before);
  expect((await spokenTexts(page)).length).toBe(n);
  expect(await recCount(page)).toBe(0);
});

test("voices that load late are awaited: the first sentence already uses the chosen voice", async ({ page }) => {
  await fresh(page, { voicesDelayMs: 600 });
  await page.getByRole("button", { name: "Start Lesson" }).click();
  await expect.poll(async () => (await speechLog(page)).filter((e) => e.startsWith("speak:")).length, { timeout: 5000 }).toBeGreaterThan(0);
  const speaks = (await speechLog(page)).filter((e) => e.startsWith("speak:"));
  expect(speaks.every((e) => e.endsWith("|Daniel"))).toBe(true);
});

test("Read without sound: nothing is ever spoken, the choice survives a reload, and sound can be turned on in the menu", async ({ page }) => {
  await fresh(page);
  await startWithoutSound(page);
  await expect(page.locator(".note.active")).toContainText("3x + 5 = 20");
  await page.getByLabel("Your answer or message").fill("x = 8");
  await page.getByLabel("Your answer or message").press("Enter");
  await expect(page.locator(".note.active")).toContainText("how you got");
  await page.waitForTimeout(800);
  expect(await spokenTexts(page)).toEqual([]);
  await page.reload();
  await expect(page.getByText("Welcome back")).toBeVisible();
  await page.waitForTimeout(800);
  expect(await spokenTexts(page)).toEqual([]);
  await openMenu(page);
  await expect(page.getByLabel("Read aloud")).not.toBeChecked();
  await page.getByLabel("Read aloud").check();
  await closeMenu(page);
  await page.waitForTimeout(500);
  expect(await spokenTexts(page)).toEqual([]); // turning sound on doesn't replay an old turn by itself
  await page.getByRole("button", { name: "Replay this message" }).click(); // … but Replay does
  await expect.poll(async () => (await spokenTexts(page)).length).toBeGreaterThan(0);
  expect((await spokenTexts(page))[0]).toContain("8");
});

test("reload and navigation never restart the introduction", async ({ page }) => {
  await fresh(page);
  await page.getByRole("button", { name: "Start Lesson" }).click();
  await expect(page.locator(".note.active")).toBeVisible();
  await page.reload();
  await expect(page.getByText("Welcome back")).toBeVisible();
  await page.waitForTimeout(1200);
  expect(await spokenTexts(page)).toEqual([]); // a fresh page after reload: nothing queued
  await page.goto("/");
  await page.goBack();
  await expect(page.locator(".note.active")).toBeVisible();
  await page.waitForTimeout(1200);
  expect(await spokenTexts(page)).toEqual([]);
});

test("Stop speaking stops at once and stays stopped; Replay plays the latest message once", async ({ page }) => {
  await fresh(page, { utterMs: 1500 });
  await page.getByRole("button", { name: "Start Lesson" }).click();
  await expect(page.getByRole("button", { name: "Stop speaking" })).toBeVisible();
  await page.getByRole("button", { name: "Stop speaking" }).click();
  await expect(page.getByRole("button", { name: "Replay this message" })).toBeVisible();
  const after = (await spokenTexts(page)).length;
  await page.waitForTimeout(2500);
  expect((await spokenTexts(page)).length).toBe(after); // the rest of the turn never plays
  expect((await speechLog(page)).includes("cancel")).toBe(true);
  // Replay: the whole message again, once.
  await page.getByRole("button", { name: "Replay this message" }).click();
  await expect(page.getByRole("button", { name: "Stop speaking" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Replay this message" })).toBeVisible({ timeout: 8000 });
  const spoken = await spokenTexts(page);
  const first = said(await firstSentence(page));
  expect(spoken.filter((t) => t.trim() === first)).toHaveLength(2); // original start + one replay
});

test("repeated clicks don't stack audio: many Replays leave one turn playing", async ({ page }) => {
  await fresh(page, { utterMs: 800 });
  await startWithoutSound(page);
  await expect(page.locator(".note.active")).toBeVisible();
  for (let i = 0; i < 4; i++) {
    const replay = page.getByRole("button", { name: "Replay this message" });
    const stop = page.getByRole("button", { name: "Stop speaking" });
    if (await replay.count()) await replay.click();
    else await stop.click();
  }
  await page.waitForTimeout(3000);
  // Each new play cancelled the previous one before queuing; at no point were two turns queued.
  const log = await speechLog(page);
  const first = said(await firstSentence(page));
  let queuedTurns = 0;
  for (const e of log) {
    if (e === "cancel") queuedTurns = 0;
    if (e.startsWith(`speak:${first}`)) queuedTurns++;
    expect(queuedTurns).toBeLessThanOrEqual(1);
  }
});

test("the microphone stops the tutor first; Cancel discards; Done sends once; it never reopens by itself", async ({ page }) => {
  await fresh(page, { utterMs: 1500 });
  await page.getByRole("button", { name: "Start Lesson" }).click();
  await expect(page.locator(".nextline")).toHaveClass(/p-speaking/);
  await page.getByRole("button", { name: "Speak your line" }).click();
  await expect(page.locator(".nextline")).toHaveClass(/p-listening/);
  let log = await speechLog(page);
  expect(log.lastIndexOf("cancel")).toBeLessThan(log.indexOf("rec:start"));
  // Cancel discards.
  const t0 = await turnNow(page);
  await page.evaluate(() => (window as unknown as { __say: (x: [string, boolean][]) => void }).__say([["x equals", false]]));
  await page.getByRole("button", { name: "Cancel — discard what I said" }).click();
  await page.waitForTimeout(400);
  expect(await turnNow(page)).toBe(t0);
  // Done sends once.
  await page.getByRole("button", { name: "Speak your line" }).click();
  await expect(page.locator(".nextline")).toHaveClass(/p-listening/);
  await page.evaluate(() => (window as unknown as { __say: (x: [string, boolean][]) => void }).__say([["x equals 8", true]]));
  await page.getByRole("button", { name: "Done — send what I said" }).click();
  await expect(page.locator(".note.active")).toContainText("how you got");
  expect(await turnNow(page)).toBe(t0 + 1);
  await page.waitForTimeout(4000); // the reply plays out
  expect(await recCount(page)).toBe(2); // only the two the student opened
  log = await speechLog(page);
  expect(log.filter((e) => e === "rec:start")).toHaveLength(2);
});

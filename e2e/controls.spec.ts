import type { Page } from "@playwright/test";
import { expect, openMenu, test, signInVia } from "./fixtures";

/**
 * Release audit: the complete student journey and every visible control, in a real browser,
 * against the real server. Voice input cannot be exercised headlessly (no microphone); the test
 * checks that its control degrades honestly instead.
 */
const KEY = "tutoros.session.v3";
const turnNow = (page: Page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? "null")?.view?.turn ?? 0, KEY);

async function say(page: Page, text: string) {
  const before = await turnNow(page);
  await page.getByLabel("Your answer or message").fill(text);
  await page.getByLabel("Your answer or message").press("Enter"); // keyboard submit
  await page.waitForFunction(([k, b]) => (JSON.parse(localStorage.getItem(k as string) ?? "null")?.view?.turn ?? 0) > (b as number), [KEY, before]);
  return page.locator(".note.active");
}

async function solveCurrent(page: Page) {
  const eq = (await page.locator(".nb-section.current .nb-row.given .mathline").getAttribute("aria-label"))!;
  const m = eq.match(/(?:(\d+)\s*\+\s*)?(\d+)x\s*([+-])?\s*(\d+)?\s*=\s*(-?\d+)/)!;
  const a = Number(m[2]);
  const b = m[1] ? Number(m[1]) : m[3] === "-" ? -Number(m[4]) : Number(m[4] ?? 0);
  return say(page, `x = ${(Number(m[5]) - b) / a}`);
}

test("complete student journey and every visible control", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("pageerror", (e) => consoleErrors.push(e.message));

  // Start
  await page.goto("/learn/algebra");
  await page.evaluate(() => localStorage.clear());
  await page.goto("/learn/algebra");
  await expect(page.locator(".welcome").getByRole("link", { name: "All lessons" })).toBeVisible();
  await page.getByRole("button", { name: "Start Lesson" }).click();
  await expect(page.locator(".note.active")).toContainText("3x + 5 = 20");
  await expect(page.getByLabel("Your answer or message")).toBeFocused(); // the next action is ready

  // Read-aloud and hands-free toggles
  await openMenu(page);
  // The engine status lives here, and is accurate: no key in the test environment → deterministic.
  await expect(page.getByText(/Running without a language model/)).toBeVisible();
  const readAloud = page.getByLabel("Read aloud");
  if (await readAloud.isEnabled()) {
    await readAloud.uncheck();
    await expect(readAloud).not.toBeChecked();
  }
  // Voice: the mic control follows real browser support; no microphone exists in CI, so only its state is checked.
  const sttExists = await page.evaluate(() => "SpeechRecognition" in window || "webkitSpeechRecognition" in window);
  const mic = page.getByRole("button", { name: "Speak your line" });
  if (sttExists) {
    await expect(mic).toBeEnabled();
    await expect(page.getByLabel("Hands-free")).toHaveCount(0); // removed: the mic only opens from a tap
  } else {
    await expect(mic).toBeDisabled();
    await expect(mic).toHaveAttribute("title", /typing works/);
  }
  await page.keyboard.press("Escape"); // closes the menu
  await expect(page.getByRole("group", { name: "Lesson menu" })).toHaveCount(0);

  // Incorrect answer → explanation → hint
  await expect(await say(page, "x = 8")).toContainText("how you got");
  await expect(await say(page, "I added the 3 and the 5")).toContainText("different kinds");
  await expect(await say(page, "3x = 25")).toContainText("subtract 5 from both sides");
  await page.mouse.move(0, 0); // hovering an earlier message highlights that message's terms instead
  await expect(page.locator(".nb-row.given .term.focus")).toHaveCount(2);

  // Quick replies
  const beforeStuck = await turnNow(page);
  await page.getByRole("button", { name: "I'm stuck" }).click();
  await page.waitForFunction(([k, b]) => (JSON.parse(localStorage.getItem(k as string) ?? "null")?.view?.turn ?? 0) > (b as number), [KEY, beforeStuck]);
  await expect(page.locator(".note.active")).toContainText("we get 3x = 15");

  // Challenge the tutor's explanation → computed re-check of what was shown
  await expect(await say(page, "I think your answer is wrong")).toContainText("20 − 5 = 15");

  // Folded note expands on click and folds back
  // Every message stays in the conversation in full — nothing is cut off or folded away.
  const earlier = page.locator(".msg.tutor.earlier");
  expect(await earlier.count()).toBeGreaterThanOrEqual(3);
  for (const t of await earlier.allInnerTexts()) expect(t.trim()).not.toMatch(/…$/);
  await expect(page.locator(".msg.student").filter({ hasText: "I added the 3 and the 5" })).toBeVisible();

  // Correct the equation, complete the guided problem
  await expect(await say(page, "3x = 15")).toContainText(/balanced|both sides/);
  await expect(await say(page, "x = 5")).toContainText("try it yourself");
  await expect(page.locator(".nb-section.past")).toContainText("with help");

  // Past problem expands and hides
  await page.locator(".past-summary").click();
  await expect(page.locator(".nb-section.reopened")).toBeVisible();
  await page.getByRole("button", { name: "hide working" }).click();
  await expect(page.locator(".nb-section.past")).toBeVisible();

  // Scratch pad: toggle, draw, clear, toggle off
  await page.getByRole("button", { name: "✎ Scratch pad" }).click();
  const canvas = page.locator("canvas.scratch");
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + 300, box.y + 300);
  await page.mouse.down();
  await page.mouse.move(box.x + 380, box.y + 320);
  await page.mouse.up();
  await page.getByRole("button", { name: "Clear scratch" }).click();
  await page.getByRole("button", { name: "✎ Scratch pad" }).click();
  await expect(page.getByRole("button", { name: "Clear scratch" })).toHaveCount(0);

  // Reload and resume mid-lesson
  await page.reload();
  await expect(page.getByText("Welcome back")).toBeVisible();
  await expect(page.locator(".nb-section.current .nb-kicker")).toContainText("Try It Yourself");

  // Two independent mastery checks
  await solveCurrent(page);
  await solveCurrent(page);
  await expect(page.locator(".result")).toContainText("on your own");
  await expect(page.locator(".rail .pip.yes")).toHaveCount(2);
  await expect(page.locator(".rail .stop.done")).toHaveCount(3);

  // Transcript drawer (close button and Escape)
  await openMenu(page);
  await page.getByRole("button", { name: "Transcript" }).click();
  await expect(page.getByRole("dialog", { name: "Everything we said" })).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // Progress drawer
  await openMenu(page);
  await page.getByRole("button", { name: "My progress" }).click();
  const prof = page.getByRole("dialog", { name: "Your learning profile" });
  await expect(prof).toContainText("got it");
  await expect(prof).toContainText("guesses from your working");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // Restart
  await openMenu(page);
  await page.getByRole("button", { name: "Restart" }).click();
  await expect(page.locator(".note.active")).toContainText("3x + 5 = 20");
  await expect(page.locator(".nb-row.invalid, .nb-row.valid, .nb-section.past")).toHaveCount(0);
  await expect(page.locator(".rail .pip.yes")).toHaveCount(0);

  // Delete my data from the progress drawer restarts cleanly
  await say(page, "x = 8");
  await openMenu(page);
  await page.getByRole("button", { name: "My progress" }).click();
  await page.getByRole("button", { name: "Delete my data" }).click();
  await expect(page.locator(".nb-row.invalid")).toHaveCount(0);

  expect(consoleErrors).toEqual([]);
});

test("cancel a turn while it is being checked: nothing is applied and the line stays", async ({ page }) => {
  await page.goto("/learn/algebra");
  await page.evaluate(() => localStorage.clear());
  await page.goto("/learn/algebra");
  await page.getByRole("button", { name: "Start Lesson" }).click();
  await expect(page.locator(".note.active")).toBeVisible();
  const before = await turnNow(page);
  await page.route("**/api/turn", async (route) => {
    await new Promise((r) => setTimeout(r, 1500));
    await route.continue().catch(() => {});
  });
  await page.getByLabel("Your answer or message").fill("x = 8");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Checking" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByLabel("Your answer or message")).toHaveValue("x = 8");
  await page.waitForTimeout(1800);
  expect(await turnNow(page)).toBe(before);
});

test("reduced motion: animations are disabled", async ({ browser, baseURL }) => {
  const ctx = await browser.newContext({ reducedMotion: "reduce" });
  await signInVia(ctx, baseURL!);
  const page = await ctx.newPage();
  await page.goto("/learn/algebra");
  await page.evaluate(() => localStorage.clear());
  await page.goto("/learn/algebra");
  await page.getByRole("button", { name: "Start Lesson" }).click();
  const anim = await page.locator(".note.active").evaluate((el) => getComputedStyle(el).animationName);
  expect(anim).toBe("none");
  await ctx.close();
});

test("keyboard only: start, answer, reach the menu and a drawer", async ({ page }) => {
  await page.goto("/learn/algebra");
  await page.evaluate(() => localStorage.clear());
  await page.goto("/learn/algebra");
  await page.getByRole("button", { name: "Start Lesson" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Your answer or message")).toBeFocused();
  await page.keyboard.type("x = 8");
  await page.keyboard.press("Enter");
  await expect(page.locator(".note.active")).toContainText("how you got");
  await expect(page.getByLabel("Your answer or message")).toBeFocused();
  // The menu opens from the keyboard, its items are reachable with Tab, and Escape closes the drawer.
  await page.getByRole("button", { name: "Menu" }).focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Transcript" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "Everything we said" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  // Earlier tutor messages are reachable by keyboard (focusing one highlights the line it was about, when it has one).
  await page.locator(".msg.tutor.earlier").first().focus();
  await expect(page.locator(".msg.tutor.earlier").first()).toBeFocused();
});

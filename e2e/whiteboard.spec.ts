import type { Page } from "@playwright/test";
import { expect, readAloudOff, startWithoutSound, test } from "./fixtures";

/**
 * The interactive whiteboard (v6), in a real browser against the real server: what's drawn follows the
 * verified lesson state, and taps send words through the same pipeline as typing.
 */
async function open(page: Page, lesson: string) {
  await page.goto(`/learn/${lesson}`);
  await page.evaluate(() => localStorage.clear());
  await page.goto(`/learn/${lesson}`);
  if (lesson === "algebra") await page.getByRole("button", { name: "Start Lesson" }).click();
  else await startWithoutSound(page);
  await expect(page.locator(".note.active")).toBeVisible();
  await readAloudOff(page);
}
async function say(page: Page, text: string) {
  const before = await page.locator(".msg.tutor").count();
  await page.getByLabel("Your answer or message").fill(text);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.locator(".msg.tutor")).toHaveCount(before + 1);
  return page.locator(".note.active");
}

test("physics: still stuck → tap the stronger arrow → finish the problem yourself", async ({ page }) => {
  await open(page, "physics");
  await expect(await say(page, "I don't know")).toContainText("tug-of-war");
  await expect(await say(page, "Still don't know")).toContainText("Tap the stronger force");
  await expect(page.getByText("Tap the stronger push.")).toBeVisible();
  const before = await page.locator(".msg.tutor").count();
  await page.getByRole("button", { name: "The 12 newton push to the right" }).click();
  await expect(page.locator(".msg.tutor")).toHaveCount(before + 1);
  await expect(page.locator(".msg.student").last()).toContainText("the push to the right");
  await expect(page.locator(".note.active")).toContainText("The rightward force is stronger");
  // The arrows stop being buttons once the small question is answered.
  await expect(page.getByRole("button", { name: "The 12 newton push to the right" })).toHaveCount(0);
  await expect(await say(page, "4")).toContainText("12 N − 8 N = 4 N");
  await expect(page.locator(".sp-step")).toContainText("Question 2 of 3");
});

test("algebra: the balance appears on the third 'I don't know', move choices are checked like typed words, and the picture goes when the line changes", async ({ page }) => {
  await open(page, "algebra");
  await say(page, "I don't know");
  await expect(page.getByRole("group", { name: "Pick a move" })).toBeVisible();
  await say(page, "I don't know");
  await expect(page.locator(".board-balance")).toHaveCount(0);
  await expect(await say(page, "I don't know")).toContainText("picture");
  await expect(page.locator(".board-balance")).toBeVisible();
  await expect(page.locator(".board-balance svg title")).toContainText("3 bags of x and 5 blocks on the left, 20 blocks on the right");
  // A wrong move chosen from the board gets the same computed answer as typing it.
  const before = await page.locator(".msg.tutor").count();
  await page.getByRole("button", { name: "Add 5 to both sides" }).click();
  await expect(page.locator(".msg.tutor")).toHaveCount(before + 1);
  await expect(page.locator(".note.active")).toContainText("3x + 10 = 25");
  await say(page, "3x = 15");
  await expect(page.locator(".board-balance")).toHaveCount(0);
});

test("geometry: the picture turn lights up the known angles and shows the 180° strip; angles can be tapped", async ({ page }) => {
  await open(page, "geometry");
  for (const t of ["I don't know", "I don't know"]) await say(page, t);
  await expect(page.locator(".sum-strip")).toHaveCount(0);
  await expect(await say(page, "I don't know")).toContainText("lit up");
  await expect(page.locator(".sum-strip")).toBeVisible();
  await expect(page.locator(".fig-corner.lit")).toHaveCount(2);
  const missing = page.getByRole("button", { name: /The missing angle/ });
  await missing.click();
  await expect(missing).toHaveAttribute("aria-pressed", "true");
});

test("'let me think': the tutor waits — no question, no help buttons", async ({ page }) => {
  await open(page, "algebra");
  await expect(await say(page, "let me think")).toContainText("Take your time");
  await expect(page.getByRole("group", { name: "Ask for help" })).toHaveCount(0);
});

test("welcome → Start Lesson: the first problem appears, the whiteboard is highlighted, and the three stages are named", async ({ page }) => {
  await page.goto("/learn/algebra");
  await page.evaluate(() => localStorage.clear());
  await page.goto("/learn/algebra");
  await expect(page.getByRole("heading", { name: "Ready to figure this out?" })).toBeVisible();
  await expect(page.getByText("We'll work through one problem together. Then you'll get a chance to try it yourself.")).toBeVisible();
  const sound = page.getByRole("button", { name: "Sound on" });
  await sound.click();
  await expect(page.getByRole("button", { name: "Sound off" })).toHaveAttribute("aria-pressed", "false");
  await page.getByRole("button", { name: "Start Lesson" }).click();
  await expect(page.locator(".note.active")).toContainText("3x + 5 = 20");
  await expect(page.locator(".work-panel.attention")).toBeVisible();
  for (const [label, sub] of [["Learn Together", "Let's work it out"], ["Try It Yourself", "A new problem"], ["Challenge Yourself", "A different twist"]]) {
    await expect(page.locator(".rail")).toContainText(label);
    await expect(page.locator(".rail")).toContainText(sub);
  }
  await expect(page.locator(".nb-section.current .nb-kicker")).toContainText("Learn Together");
  // The sound choice made on the welcome screen holds in the menu.
  await page.getByRole("button", { name: "Menu" }).click();
  await expect(page.getByLabel("Read aloud")).not.toBeChecked();
});

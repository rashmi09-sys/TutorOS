import type { Page } from "@playwright/test";
import { expect, test, startWithoutSound } from "./fixtures";

/**
 * Navigation and progress persistence across the home page and the three lessons:
 * the "All lessons" button, the logo, browser back/forward, Continue learning, reload, and Start again.
 */

const KEY: Record<string, string> = { algebra: "tutoros.session.v2", physics: "tutoros.session.physics.v1", geometry: "tutoros.session.geometry.v1" };
const stateOf = (page: Page, lesson: string) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? "null")?.state ?? null, KEY[lesson]);
const card = (page: Page, title: string) => page.locator(".lesson-card", { hasText: title });

async function fresh(page: Page) {
  await page.goto("/");
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.goto("/");
  await expect(page.locator(".lesson-card")).toHaveCount(3);
}

async function say(page: Page, text: string) {
  const before = await page.locator(".msg.tutor").count();
  await page.getByLabel("Your answer or message").fill(text);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.locator(".msg.tutor")).toHaveCount(before + 1);
  return page.locator(".note.active");
}

async function startFromHome(page: Page, title: string, path: string) {
  await card(page, title).getByRole("link", { name: `Start lesson: ${title}` }).click();
  await expect(page).toHaveURL(new RegExp(`${path}$`));
  await startWithoutSound(page);
  await expect(page.locator(".note.active")).toBeVisible();
}

const allLessons = (page: Page) => page.locator(".rail").getByRole("link", { name: "All lessons" });

test("full journey: algebra → wrong answer → hint → home → resume → complete → home", async ({ page }) => {
  await fresh(page);
  await startFromHome(page, "Two-step equations", "/learn/algebra");
  await expect(allLessons(page)).toBeVisible();
  await expect(await say(page, "x = 8")).toContainText("how you got");
  await say(page, "I'm stuck"); // after a wrong answer, help starts one stage up: a guiding question
  await expect(page.locator(".note.active .note-kind")).toHaveText("Think");
  const before = await stateOf(page, "algebra");
  expect(before.turn).toBe(3);

  // Home, then Continue: nothing lost.
  await allLessons(page).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(card(page, "Two-step equations").getByText("In progress: solving together")).toBeVisible();
  await card(page, "Two-step equations").getByRole("link", { name: "Continue learning" }).click();
  await expect(page).toHaveURL(/\/learn\/algebra$/);
  await expect(page.getByText("Welcome back")).toBeVisible();
  await expect(page.locator(".msg.student", { hasText: "x = 8" })).toBeVisible();
  expect((await stateOf(page, "algebra")).turn).toBe(before.turn);

  // Complete the lesson (the student writes every line; the checks are fresh problems read from the page).
  await say(page, "3x = 15");
  await say(page, "x = 5");
  for (let i = 0; i < 2; i++) {
    const s = await stateOf(page, "algebra");
    await say(page, `x = ${s.problems[s.current].answer}`);
  }
  await expect(page.locator(".result")).toBeVisible();
  expect((await stateOf(page, "algebra")).phase).toBe("COMPLETE");

  // Home: the card says it's finished, and offers Review.
  await allLessons(page).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(card(page, "Two-step equations").getByText(/^Finished/)).toBeVisible();
  await expect(card(page, "Two-step equations").getByRole("link", { name: "Review" })).toBeVisible();
});

test("browser back and forward between home and a lesson keep progress", async ({ page }) => {
  await fresh(page);
  await startFromHome(page, "Angles in a triangle", "/learn/geometry");
  await say(page, "105");
  await page.goBack(); // the lesson was opened from home, so Back returns there
  await expect(page).toHaveURL(/\/$/);
  await expect(card(page, "Angles in a triangle").getByText("In progress: question 1 of 3")).toBeVisible();
  await page.goForward();
  await expect(page).toHaveURL(/\/learn\/geometry$/);
  await expect(page.locator(".msg.student", { hasText: "105" })).toBeVisible();
  await expect(await say(page, "I'm stuck")).toContainText("180");
  await page.reload();
  await expect(page.locator(".msg.student", { hasText: "I'm stuck" })).toBeVisible();
});

for (const [title, path, answer] of [
  ["Forces and balance", "/learn/physics", "20 N"],
  ["Angles in a triangle", "/learn/geometry", "105"],
  ["Two-step equations", "/learn/algebra", "x = 8"],
] as const) {
  test(`${title}: the logo and "All lessons" both go home, and Continue resumes`, async ({ page }) => {
    await fresh(page);
    // The button is there on the start screen too.
    await card(page, title).getByRole("link", { name: `Start lesson: ${title}` }).click();
    await expect(allLessons(page)).toBeVisible();
    await startWithoutSound(page);
    await expect(page.locator(".note.active")).toBeVisible();
    await say(page, answer);
    await page.locator(".rail").getByRole("link", { name: "TutorOS home" }).click();
    await expect(page).toHaveURL(/\/$/);
    await card(page, title).getByRole("link", { name: "Continue learning" }).click();
    await expect(page).toHaveURL(new RegExp(`${path}$`));
    await expect(page.locator(".msg.student", { hasText: answer })).toBeVisible();
    await allLessons(page).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(card(page, title).getByRole("link", { name: "Continue learning" })).toBeVisible();
  });
}

test("progress is kept per lesson, and Start again resets only that lesson", async ({ page }) => {
  await fresh(page);
  await startFromHome(page, "Forces and balance", "/learn/physics");
  await say(page, "4 N to the right"); // solves question 1
  await allLessons(page).click();
  await startFromHome(page, "Angles in a triangle", "/learn/geometry");
  await say(page, "105");
  await allLessons(page).click();
  await expect(card(page, "Forces and balance").getByText("In progress: question 2 of 3")).toBeVisible();
  await expect(card(page, "Angles in a triangle").getByText("In progress: question 1 of 3")).toBeVisible();
  await expect(card(page, "Two-step equations").getByRole("link", { name: "Start lesson: Two-step equations" })).toBeVisible();
  await card(page, "Forces and balance").getByRole("button", { name: "Start again" }).click();
  await expect(page).toHaveURL(/\/learn\/physics$/);
  await expect(page.getByRole("button", { name: "Start Lesson" })).toBeVisible(); // a clean start
  expect(await stateOf(page, "physics")).toBeNull();
  expect((await stateOf(page, "geometry")).turn).toBe(2); // untouched
});

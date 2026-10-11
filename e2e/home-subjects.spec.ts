import type { Page } from "@playwright/test";
import { expect, openMenu, readAloudOff, test, startWithoutSound } from "./fixtures";
import { mockSpeech } from "./speech-mock";

/**
 * The home screen and the geometry and physics lessons in a real browser against the real server. Answers to random check problems are read from the signed state the page holds,
 * exactly as a student who knows the answer would type them.
 */

const key = (lesson: string) => `tutoros.session.${lesson}.v1`;
const stateOf = (page: Page, lesson: string) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? "null")?.state, key(lesson));

async function say(page: Page, text: string) {
  const before = (await page.locator(".msg.tutor").count()) as number;
  await page.getByLabel("Your answer or message").fill(text);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.locator(".msg.tutor")).toHaveCount(before + 1);
  return page.locator(".note.active");
}

async function open(page: Page, lesson: string) {
  await page.goto(`/learn/${lesson}`);
  await page.evaluate(() => localStorage.clear());
  await page.goto(`/learn/${lesson}`);
  await startWithoutSound(page);
  await expect(page.locator(".note.active")).toBeVisible();
}

test("home: three lessons, honest capability note, and Continue after leaving a lesson", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "What would you like to work on?" })).toBeVisible();
  await expect(page.locator(".lesson-card")).toHaveCount(3);
  for (const t of ["Two-step equations", "Forces and balance", "Angles in a triangle"]) await expect(page.getByRole("heading", { name: t })).toBeVisible();
  await expect(page.getByText(/I.m in basic mode right now/)).toBeVisible();
  await page.getByRole("link", { name: "Start lesson: Angles in a triangle" }).click();
  await expect(page).toHaveURL(/\/learn\/geometry$/);
  await startWithoutSound(page);
  await expect(page.locator(".note.active")).toBeVisible();
  await say(page, "105");
  await page.locator(".rail").getByRole("link", { name: "All lessons" }).click();
  const card = page.locator(".lesson-card", { hasText: "Angles in a triangle" });
  await expect(card.getByText("In progress: question 1 of 3")).toBeVisible();
  await card.getByRole("link", { name: "Continue learning" }).click();
  await expect(page.locator(".msg.student", { hasText: "105" })).toBeVisible(); // nothing lost
});

test("geometry: misconception, help ladder, correct answer, next question, explorer", async ({ page }) => {
  await open(page, "geometry");
  await expect(page.locator(".sp-prompt")).toContainText("65° and 40°");
  // Stuck: a smaller question first ("what do the two known angles add up to?").
  await expect(await say(page, "I'm stuck")).toContainText("What do those two add up to");
  await expect(page.locator(".note.active .note-kind")).toContainText("Notice");
  // 105 would be a mistake as a final answer, but here it answers the tutor's smaller question.
  await expect(await say(page, "105")).toContainText("used up");
  const st0 = await stateOf(page, "geometry");
  expect(st0.attempts).toBe(0);
  // The answer never appears before it is earned.
  for (const m of await page.locator(".msg.tutor").allTextContents()) expect(m).not.toMatch(/\b75\b/);
  await expect(await say(page, "180 - 65 - 40 = 75")).toContainText("Yes — 75°");
  await expect(page.locator(".sp-step")).toContainText("Question 2 of 3");
  // A check problem: answered from the state, as a student who knows it would.
  const st = await stateOf(page, "geometry");
  await say(page, String(st.problems[1].answer.value));
  await expect(page.locator(".sp-step")).toContainText("Question 3 of 3");
  await expect(page.locator(".rail .pip.yes")).toHaveCount(1);
  // Explorer: the angles change, the total doesn't.
  await page.getByText("Explore the 180° rule").click();
  const sum = page.locator(".explore-sum");
  const before = await sum.textContent();
  await page.getByRole("slider", { name: /Top corner/ }).focus();
  for (let i = 0; i < 6; i++) await page.keyboard.press("ArrowRight");
  await expect(sum).not.toHaveText(before!);
  await expect(sum).toContainText("= 180°");
});

test("physics: added forces, size without direction, spoken answer, closed outcome list", async ({ page }) => {
  await mockSpeech(page);
  await open(page, "physics");
  await readAloudOff(page);
  await expect(await say(page, "20 N")).toContainText("opposite directions");
  await expect(await say(page, "4")).toContainText("Which way");
  // The direction, spoken through the microphone, completes the answer.
  await page.getByRole("button", { name: "Speak your line" }).click();
  await expect(page.locator(".nextline")).toHaveClass(/p-listening/);
  await page.evaluate(() => (window as unknown as { __say: (x: [string, boolean][]) => void }).__say([["to the right", true]]));
  await page.getByRole("button", { name: "Done — send what I said" }).click();
  await expect(page.locator(".note.active")).toContainText("Yes. 12 N − 8 N = 4 N");
  await expect(page.locator(".sp-past")).toHaveCount(1);
  // Jump to the last question by answering the check from the state.
  const st = await stateOf(page, "physics");
  const p1 = st.problems[1];
  await say(page, `${p1.answer.value} N to the ${p1.answer.direction}`);
  const p2 = (await stateOf(page, "physics")).problems[2];
  if (p2.kind === "balanced-moving") {
    await expect(await say(page, "it turns into a rocket")).toContainText("I can check");
    await expect(await say(page, "it slows down")).toContainText("friction");
  } else if (p2.kind === "unbalanced-rest") {
    await expect(await say(page, "it stays still")).toContainText("aren't equal");
  } else {
    // balance-missing (the transfer question can be any of three kinds): giving one of the forces.
    await expect(await say(page, `${p2.data.left} N`)).toContainText("one of the forces");
  }
  for (const m of await page.locator(".msg.tutor").allTextContents()) expect(m).not.toMatch(/keeps rolling at 2 m\/s|starts? (to )?mov\w* (to the )?(left|right)/);
});

test("the engineering console is gone: no links to it, and its routes are not served", async ({ page, request }) => {
  await page.goto("/");
  await expect(page.getByText(/Engineer view/i)).toHaveCount(0);
  await open(page, "geometry");
  await openMenu(page);
  await expect(page.getByRole("group", { name: "Lesson menu" }).getByText(/Engineer/i)).toHaveCount(0);
  for (const path of ["/console", "/console?lesson=algebra"]) expect((await request.get(path)).status(), path).toBe(404);
  expect((await request.post("/api/eval", { data: { suites: ["B"] } })).status()).toBe(404);
});

test("phone width: home and lessons don't scroll sideways", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 360, height: 760 } });
  const page = await ctx.newPage();
  for (const path of ["/", "/learn/algebra", "/learn/geometry", "/learn/physics"]) {
    await page.goto(path);
    await page.waitForTimeout(200);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(over, path).toBeLessThanOrEqual(0);
  }
  await ctx.close();
});

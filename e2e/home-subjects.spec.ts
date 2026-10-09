import type { Page } from "@playwright/test";
import { expect, readAloudOff, test } from "./fixtures";
import { mockSpeech } from "./speech-mock";

/**
 * The home screen, the geometry and physics lessons in a real browser against the real server, and their
 * Engineer View traces. Answers to random check problems are read from the signed state the page holds,
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
  await page.getByRole("button", { name: "Read without sound" }).click();
  await expect(page.locator(".note.active")).toBeVisible();
}

test("home: three lessons, honest capability note, and Continue after leaving a lesson", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "What would you like to work on?" })).toBeVisible();
  await expect(page.locator(".lesson-card")).toHaveCount(3);
  for (const t of ["Two-step equations", "Forces and balance", "Angles in a triangle"]) await expect(page.getByRole("heading", { name: t })).toBeVisible();
  await expect(page.getByText(/No language model is connected right now/)).toBeVisible();
  await page.getByRole("link", { name: "Start lesson: Angles in a triangle" }).click();
  await expect(page).toHaveURL(/\/learn\/geometry$/);
  await page.getByRole("button", { name: "Read without sound" }).click();
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
  await expect(await say(page, "I'm stuck")).toContainText("What do the three angles");
  await expect(page.locator(".note.active .note-kind")).toContainText("Notice");
  await expect(await say(page, "105")).toContainText("add up to");
  const st0 = await stateOf(page, "geometry");
  expect(st0.attempts).toBe(1);
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
  } else {
    await expect(await say(page, "it stays still")).toContainText("aren't equal");
  }
  for (const m of await page.locator(".msg.tutor").allTextContents()) expect(m).not.toMatch(/keeps rolling at 2 m\/s|starts? (to )?mov\w* (to the )?(left|right)/);
});

test("Engineer View shows a geometry session: understood, checked, decided", async ({ page, context }) => {
  await open(page, "geometry");
  await say(page, "105");
  const c = await context.newPage();
  await c.goto("/console?lesson=geometry");
  await expect(c.locator(".ov-lesson h1")).toHaveText("Angles in a triangle");
  await expect(c.getByText("Angle-sum rule (180°) computed exactly").first()).toBeVisible();
  await c.getByRole("tab", { name: "Decision timeline" }).click();
  const card = c.locator(".tl-list .tl-item", { hasText: "105" });
  await expect(card).toContainText("An answer: 105°");
  await expect(card.locator(".tl-check")).toContainText("Not correct");
  await expect(card.locator(".tl-check")).toContainText("added the known angles");
  await card.getByRole("button", { name: "Technical details" }).click();
  await expect(card.locator(".stage").filter({ has: c.locator(".stage-k", { hasText: /^Subject check$/ }) })).toContainText("incorrect");
  await expect(card.getByText("No model calls this turn — deterministic.")).toBeVisible();
});

test("phone width: home and lessons don't scroll sideways", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 360, height: 760 } });
  const page = await ctx.newPage();
  for (const path of ["/", "/learn/geometry", "/learn/physics", "/console"]) {
    await page.goto(path);
    await page.waitForTimeout(200);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(over, path).toBeLessThanOrEqual(0);
  }
  await ctx.close();
});

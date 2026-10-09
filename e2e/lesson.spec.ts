import type { Page } from "@playwright/test";
import { expect, openMenu, readAloudOff, test } from "./fixtures";

const turnNow = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem("tutoros.session.v2") ?? "null")?.state?.turn ?? 0);

async function say(page: Page, text: string) {
  const before = await turnNow(page);
  await page.getByLabel("Your answer or message").fill(text);
  await page.getByRole("button", { name: "Send" }).click();
  await page.waitForFunction((b) => (JSON.parse(localStorage.getItem("tutoros.session.v2") ?? "null")?.state?.turn ?? 0) > b, before);
  return page.locator(".note.active");
}

async function start(page: Page) {
  await page.goto("/learn/algebra");
  await page.evaluate(() => localStorage.clear());
  await page.goto("/learn/algebra");
  await page.getByRole("button", { name: "Start the lesson" }).click();
  await expect(page.locator(".note.active")).toContainText("3x + 5 = 20");
  await readAloudOff(page);
}

async function solveCurrent(page: Page) {
  const eq = (await page.locator(".nb-section.current .nb-row.given .mathline").getAttribute("aria-label"))!;
  const m = eq.match(/(?:(\d+)\s*\+\s*)?(\d+)x\s*([+-])?\s*(\d+)?\s*=\s*(-?\d+)/)!;
  const a = Number(m[2]);
  const b = m[1] ? Number(m[1]) : m[3] === "-" ? -Number(m[4]) : Number(m[4] ?? 0);
  return say(page, `x = ${(Number(m[5]) - b) / a}`);
}

test("lesson on the notebook: probe → hint points at + 5 and 20 → observed operation → check → solve → two fresh problems → mastery", async ({ page, context }) => {
  await start(page);
  // The student view doesn't advertise the engine; the menu states it accurately.
  await expect(page.getByText("Deterministic · no LLM")).toHaveCount(0);
  await expect(await say(page, "x = 8")).toContainText("how you got");
  await expect(await say(page, "I added the 3 and the 5")).toContainText("different kinds");
  await expect(await say(page, "3x = 25")).toContainText("subtract 5 from both sides");
  // The tutor's note sits beside the original line and highlights exactly "+ 5" and "20".
  await expect(page.locator(".nb-row.given .term.focus")).toHaveCount(2);
  await expect(page.locator(".nb-row.given.is-active")).toHaveCount(1);
  // What the student did is shown as an observation between the lines.
  await expect(page.locator(".nb-connector.bad").last()).toContainText("left − 5");
  await expect(page.locator(".nb-connector.bad").last()).toContainText("right + 5");
  await expect(await say(page, "I'm sure 3x = 25 is right")).toContainText("25 + 5 = 30, not 20");
  await expect(page.locator(".nb-row.annotation").first()).toContainText("Tutor’s check");
  await say(page, "3x = 15");
  await expect(page.locator(".nb-row.valid")).toHaveCount(1);
  await expect(page.locator(".nb-connector.ok")).toContainText("− 5 on both sides");
  await expect(await say(page, "x = 5")).toContainText("fresh one");
  await expect(page.locator(".nb-section.past")).toContainText("with help");
  await expect(page.locator(".nb-section.current .nb-kicker")).toContainText("on your own");
  await solveCurrent(page);
  await solveCurrent(page);
  await expect(page.locator(".result")).toContainText("on your own");
  await expect(page.locator(".rail .pip.yes")).toHaveCount(2);

  const c = await context.newPage();
  await c.goto("/console?lesson=algebra");
  const turns = await turnNow(page);
  // Overview: the session figures say no model was called.
  await expect(c.locator(".ov-figure", { hasText: "Model calls" })).toContainText("0");
  await c.getByRole("tab", { name: "Decision timeline" }).click();
  await expect(c.locator(".tl-list .tl-item")).toHaveCount(turns);
  const card = c.locator(".tl-list .tl-item", { hasText: "3x = 25" }).first();
  await expect(card.locator(".tl-check")).toContainText("Not equivalent");
  await card.getByRole("button", { name: "Technical details" }).click();
  await expect(card.locator(".stage").filter({ has: c.locator(".stage-k", { hasText: /^Observed$/ }) })).toContainText("left: − 5 · right: + 5");
  await expect(card.locator(".stage").filter({ has: c.locator(".stage-k", { hasText: /^Hypothesis$/ }) })).toContainText("Possibly:");
  await expect(card.locator(".stage").filter({ has: c.locator(".stage-k", { hasText: /^Hypothesis$/ }) })).toContainText("Not confirmed");
  await expect(card.locator(".cand.chosen")).toBeVisible();
  const sure = c.locator(".tl-list .tl-item", { hasText: "I'm sure 3x = 25" });
  await sure.getByRole("button", { name: "Technical details" }).click();
  await expect(sure.getByText("R4_RESPECTFUL_CHALLENGE").first()).toBeVisible();
  await sure.getByRole("tab", { name: /model/ }).click();
  await expect(sure.getByText("template (no model)").first()).toBeVisible();
});

test("the tutor responds to what the student actually says", async ({ page }) => {
  await start(page);
  await expect(await say(page, "I'm confused")).toContainText("Which one would you undo first?");
  await expect(page.locator(".nb-row.given .term.focus")).toHaveCount(2); // the x-term and the constant
  await expect(await say(page, "Can we divide first?")).toContainText("Yes, you can");
  await expect(await say(page, "What's the capital of France?")).not.toContainText("Paris");
  await expect(await say(page, "3x + = 20")).toContainText("couldn't read");
  await expect(await say(page, "what is 20 minus 5?")).not.toContainText("15");
  // Help options are real engine requests, chosen for the moment (2–3 at a time).
  const opts = page.getByRole("group", { name: "Ask for help" }).getByRole("button");
  expect(await opts.count()).toBeGreaterThanOrEqual(2);
  expect(await opts.count()).toBeLessThanOrEqual(3);
  const before = await turnNow(page);
  await page.getByRole("button", { name: "Small hint" }).click();
  await page.waitForFunction((b) => JSON.parse(localStorage.getItem("tutoros.session.v2")!).state.turn > b, before);
  const last = await page.evaluate(() => JSON.parse(localStorage.getItem("tutoros.session.v2")!).traces.at(-1));
  expect(last.intent.phraseRule).toBe("P_HINT");
  expect(last.event.source).toBe("help-option");
  await expect(page.getByRole("button", { name: "Explain differently" })).toBeVisible();
  // The full transcript is still one click away.
  await openMenu(page);
  await page.getByRole("button", { name: "Transcript" }).click();
  const n = await page.evaluate(() => JSON.parse(localStorage.getItem("tutoros.session.v2")!).state.transcript.length);
  await expect(page.locator(".transcript li")).toHaveCount(n);
});

test("session resumes after reload, and a tampered session is refused", async ({ page }) => {
  await start(page);
  await say(page, "x = 8");
  await page.reload();
  await expect(page.locator(".nb-row.invalid")).toHaveCount(1);
  await expect(page.getByText("Welcome back")).toBeVisible();
  await expect(await say(page, "3x = 15")).toContainText(/balanced|both sides equal/);

  await page.evaluate(() => {
    const k = "tutoros.session.v2";
    const s = JSON.parse(localStorage.getItem(k)!);
    s.state.mastery.pKnown = 0.99;
    localStorage.setItem(k, JSON.stringify(s));
  });
  await page.reload();
  await page.getByLabel("Your answer or message").fill("x = 5");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.locator(".error")).toContainText("can't be verified");
  await page.getByRole("button", { name: "Start a new lesson" }).click();
  await expect(page.locator(".note.active")).toContainText("3x + 5 = 20");
  await expect(page.locator(".nb-row.invalid, .nb-row.valid")).toHaveCount(0);
});

test("eval lab compares policies live; failures are inspectable; C is reported as not run", async ({ page }) => {
  await page.goto("/console");
  await page.getByRole("tab", { name: "Evaluation lab" }).click();
  await page.getByRole("button", { name: /Run comparison/ }).click();
  await expect(page.locator(".cell.fail").first()).toBeVisible();
  const bAllPass = await page.locator(".mx-algebra .mx-row:not(.head)").evaluateAll((rows) => rows.every((r) => r.querySelectorAll(".cell")[1]?.classList.contains("pass")));
  expect(bAllPass).toBe(true);
  await expect(page.getByText(/Not tested — No LLM provider configured/)).toBeVisible();
  await page.locator(".cell.fail").first().click();
  await expect(page.locator(".inspector .asr.fail").first()).toBeVisible();
  await expect(page.locator(".inspector .tturn.hot").first()).toBeVisible();
});

test("mobile: the margin moves under its line and nothing scrolls sideways", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await start(page);
  await say(page, "3x = 25");
  await expect(page.locator(".note.active")).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await ctx.close();
});

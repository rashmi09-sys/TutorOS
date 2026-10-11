import type { Page } from "@playwright/test";
import { expect, readAloudOff, test, signInVia } from "./fixtures";
import { mockSpeech, recCount, spokenTexts, speechLog, type MockOpts } from "./speech-mock";

/**
 * Voice interaction in a real browser against the real server, with the browser's speech APIs replaced
 * by a controlled mock (headless Chromium has no microphone). The mock lets the test fire exactly the
 * events a browser fires — results, duplicates, errors, unexpected ends — so the UI's state machine is
 * exercised end to end. What this cannot prove: real recognition accuracy, real microphones, real
 * permission prompts, or real voices. Those need the manual device checks in docs/LIMITATIONS.md.
 */
const KEY = "tutoros.session.v3";

const turnNow = (page: Page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? "null")?.view?.turn ?? 0, KEY);

async function start(page: Page, o?: MockOpts) {
  await mockSpeech(page, o);
  await page.goto("/learn/algebra");
  await page.evaluate(() => localStorage.clear());
  await page.goto("/learn/algebra");
  await page.getByRole("button", { name: "Start Lesson" }).click();
  await expect(page.locator(".note.active")).toContainText("3x + 5 = 20");
  await readAloudOff(page); // isolate voice input from tutor speech unless a test turns it on
}

const mic = (page: Page) => page.getByRole("button", { name: "Speak your line" });
const cancelBtn = (page: Page) => page.getByRole("button", { name: "Cancel — discard what I said" });
const doneBtn = (page: Page) => page.getByRole("button", { name: "Done — send what I said" });
const status = (page: Page) => page.locator(".nl-status");

async function listening(page: Page) {
  await mic(page).click();
  await expect(status(page)).toContainText("Listening");
  await expect(page.locator(".nextline")).toHaveClass(/p-listening/);
}

test("start listening → partial transcript → Done submits the finalized words exactly once", async ({ page }) => {
  await start(page);
  const before = await turnNow(page);
  await listening(page);
  await expect(cancelBtn(page)).toBeVisible();
  await expect(doneBtn(page)).toBeDisabled(); // nothing heard yet
  await page.evaluate(() => (window as unknown as { __say: (x: [string, boolean][]) => void }).__say([["three x", false]]));
  await expect(page.locator(".nl-live .interim")).toHaveText("three x");
  await page.evaluate(() => (window as unknown as { __say: (x: [string, boolean][]) => void }).__say([["three x", true], ["equals fif", false]]));
  await expect(page.locator(".nl-live .final")).toHaveText("three x");
  await expect(page.locator(".nl-live .interim")).toHaveText("equals fif");
  await page.waitForTimeout(1500); // a normal pause must not submit anything
  expect(await turnNow(page)).toBe(before);
  await page.evaluate(() => (window as unknown as { __say: (x: [string, boolean][]) => void }).__say([["three x", true], ["equals fifteen", false]]));
  const sent = page.waitForRequest((r) => r.url().endsWith("/api/turn") && r.method() === "POST");
  await doneBtn(page).click();
  const sentEvent = (await sent).postDataJSON().event;
  await page.waitForFunction(([k, b]) => JSON.parse(localStorage.getItem(k as string)!).view.turn > (b as number), [KEY, before]);
  const s = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)!), KEY);
  const student = s.view.transcript.filter((m: { role: string }) => m.role === "student").at(-1);
  expect(student).toMatchObject({ text: "three x equals fifteen", via: "voice" });
  expect(sentEvent.voice).toMatchObject({ endedBy: "done" });
  expect(s.view.turn).toBe(before + 1); // exactly one submission
  await expect(page.locator(".note.active")).toContainText("balanced");
});

test("X cancels: nothing is submitted, even with words already heard; Escape also cancels", async ({ page }) => {
  await start(page);
  await page.getByLabel("Your answer or message").fill("my draft");
  const before = await turnNow(page);
  await listening(page);
  await page.evaluate(() => (window as unknown as { __say: (x: [string, boolean][]) => void }).__say([["x equals five", true]]));
  await cancelBtn(page).click();
  await expect(status(page)).toContainText("Cancelled — nothing was sent");
  await page.evaluate(() => (window as unknown as { __end: () => void }).__end()); // a late browser event changes nothing
  await page.waitForTimeout(500);
  expect(await turnNow(page)).toBe(before);
  await expect(page.getByLabel("Your answer or message")).toHaveValue("my draft"); // back to where they were
  await listening(page);
  await page.keyboard.press("Escape");
  await expect(mic(page)).toBeVisible();
  expect(await turnNow(page)).toBe(before);
});

test("permission denied: honest message, no recognizer, no retry loop, typing still works", async ({ page }) => {
  await start(page, { mic: "deny" });
  await mic(page).click();
  await expect(status(page)).toContainText("Microphone permission is blocked");
  await page.waitForTimeout(1000);
  expect(await recCount(page)).toBe(0);
  expect(await page.evaluate(() => (window as unknown as { __micRequests: number }).__micRequests)).toBe(1);
  await page.getByLabel("Your answer or message").fill("x = 8");
  await page.getByLabel("Your answer or message").press("Enter");
  await expect(page.locator(".note.active")).toContainText("how you got");
});

test("no microphone: says so", async ({ page }) => {
  await start(page, { mic: "none" });
  await mic(page).click();
  await expect(status(page)).toContainText("No microphone was found");
});

test("unsupported browser: mic disabled with an explanation; typing works", async ({ page }) => {
  await start(page, { recognition: false });
  await expect(mic(page)).toBeDisabled();
  await expect(mic(page)).toHaveAttribute("title", /needs Chrome or Edge/);
});

test("the browser stops listening on its own: silent resume (capped), then an honest recovery state", async ({ page }) => {
  await start(page);
  const before = await turnNow(page);
  await listening(page);
  await page.waitForTimeout(400);
  await page.evaluate(() => (window as unknown as { __say: (x: [string, boolean][]) => void }).__say([["three x", true]]));
  for (let i = 0; i < 2; i++) {
    await page.evaluate(() => (window as unknown as { __end: () => void }).__end());
    await page.waitForTimeout(400);
    await expect(page.locator(".nextline")).toHaveClass(/p-listening/); // no flicker to another state
  }
  expect(await recCount(page)).toBe(3);
  await page.evaluate(() => (window as unknown as { __end: () => void }).__end());
  await expect(status(page)).toContainText("Listening stopped");
  await page.waitForTimeout(800);
  expect(await recCount(page)).toBe(3); // no endless restarts
  expect(await turnNow(page)).toBe(before); // nothing auto-submitted
  await expect(page.locator(".nl-live .final")).toHaveText("three x");
  // One tap to keep talking, keeping what was heard.
  await page.getByRole("button", { name: "Keep talking" }).click();
  await expect(page.locator(".nextline")).toHaveClass(/p-listening/);
  await page.evaluate(() => (window as unknown as { __say: (x: [string, boolean][]) => void }).__say([["equals fifteen", true]]));
  await doneBtn(page).click();
  await page.waitForFunction(([k, b]) => JSON.parse(localStorage.getItem(k as string)!).view.turn > (b as number), [KEY, before]);
  const last = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)!).view.transcript.filter((m: { role: string }) => m.role === "student").at(-1).text, KEY);
  expect(last).toBe("three x equals fifteen");
});

test("duplicate recognition events are applied once", async ({ page }) => {
  await start(page);
  await listening(page);
  await page.evaluate(() => {
    const w = window as unknown as { __say: (x: [string, boolean][]) => void; __resend: () => void };
    w.__say([["x equals 8", true]]);
    w.__resend();
    w.__resend();
  });
  await expect(page.locator(".nl-live .final")).toHaveText("x equals 8");
  const before = await turnNow(page);
  const sent = page.waitForRequest((r) => r.url().endsWith("/api/turn") && r.method() === "POST");
  await doneBtn(page).click();
  const sentEvent = (await sent).postDataJSON().event;
  await page.waitForFunction(([k, b]) => JSON.parse(localStorage.getItem(k as string)!).view.turn > (b as number), [KEY, before]);
  const s = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)!), KEY);
  expect(s.view.transcript.filter((m: { role: string }) => m.role === "student").at(-1).text).toBe("x equals 8");
  expect(sentEvent.voice.duplicateEventsIgnored).toBeGreaterThanOrEqual(2);
});

test("rapid start/cancel: one live recognizer at a time, nothing submitted", async ({ page }) => {
  await start(page);
  const before = await turnNow(page);
  for (let i = 0; i < 4; i++) {
    await mic(page).click();
    await cancelBtn(page).click();
  }
  await listening(page);
  const live = await page.evaluate(() => (window as unknown as { __recs: { aborted: boolean; onresult: unknown }[] }).__recs.filter((r) => !r.aborted && r.onresult).length);
  expect(live).toBe(1);
  await cancelBtn(page).click();
  await page.waitForTimeout(400);
  expect(await turnNow(page)).toBe(before);
});

test("spoken help requests: 'I'm stuck', 'explain it another way', challenging the tutor, 'why?'", async ({ page }) => {
  await start(page);
  const speak = async (text: string) => {
    const before = await turnNow(page);
    await listening(page);
    await page.evaluate((t) => (window as unknown as { __say: (x: [string, boolean][]) => void }).__say([[t, true]]), text);
    await doneBtn(page).click();
    await page.waitForFunction(([k, b]) => JSON.parse(localStorage.getItem(k as string)!).view.turn > (b as number), [KEY, before]);
    // The tutor's reply, as the page has it (text and teaching stage — no internal rule names).
    return page.evaluate((k) => JSON.parse(localStorage.getItem(k)!).view.transcript.at(-1), KEY);
  };
  let t = await speak("I'm stuck");
  expect(t.stage).toBe("NOTICE");
  await expect(page.locator(".note.active .note-kind")).toContainText("Notice");
  t = await speak("explain it another way");
  expect(t.text).toContain("Let's look at one piece only");
  t = await speak("I think your answer is wrong");
  expect(t.text).toContain("I haven't given an answer yet");
  t = await speak("I need more help");
  t = await speak("I need more help");
  expect(t.stage).toBe("TRY");
  t = await speak("why");
  expect(t.text).toMatch(/^Because x has 5 added to it/);
  expect(t.cue).toBe("idea");
  // No early leaks anywhere in that exchange.
  const s = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)!), KEY);
  for (const m of s.view.transcript.filter((x: { role: string }) => x.role === "tutor")) expect(m.text).not.toMatch(/x = 5\b|3x = 15/);
});

test("tutor speech is never recorded, and the mic never opens by itself", async ({ page }) => {
  await mockSpeech(page, { utterMs: 1200 });
  await page.goto("/learn/algebra");
  await page.evaluate(() => localStorage.clear());
  await page.goto("/learn/algebra");
  await page.getByRole("button", { name: "Start Lesson" }).click();
  await expect(page.locator(".note.active")).toBeVisible();
  // The intro is playing. Tapping the mic stops the tutor first, then opens the mic.
  await expect(page.locator(".nextline")).toHaveClass(/p-speaking/);
  await mic(page).click();
  await expect(page.locator(".nextline")).toHaveClass(/p-listening/);
  const log = await speechLog(page);
  expect(log.lastIndexOf("cancel")).toBeLessThan(log.indexOf("rec:start"));
  expect(log.slice(log.indexOf("rec:start")).some((e) => e.startsWith("start:"))).toBe(false); // no speech while listening
  // Done sends; the reply is spoken; the mic does NOT reopen afterwards.
  await page.evaluate(() => (window as unknown as { __say: (x: [string, boolean][]) => void }).__say([["x equals 8", true]]));
  await doneBtn(page).click();
  await expect(page.locator(".note.active")).toContainText("how you got");
  await page.waitForTimeout(3500); // reply spoken (mock: 1.2 s per sentence) and some idle time
  expect(await recCount(page)).toBe(1);
  await expect(page.locator(".nextline")).not.toHaveClass(/p-listening/);
  // Maths is read as words; no symbols reach the voice.
  const spoken = await spokenTexts(page);
  expect(spoken.join(" ")).toMatch(/3 x plus 5 equals 20/);
  expect(spoken.some((x) => /[=+“”]/.test(x))).toBe(false);
});

test("keyboard only: Tab to the mic, Enter to listen, Enter on Done to send; mobile layout holds while listening", async ({ page, browser, baseURL }) => {
  await start(page);
  await mic(page).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".nextline")).toHaveClass(/p-listening/);
  await page.evaluate(() => (window as unknown as { __say: (x: [string, boolean][]) => void }).__say([["x equals 8", true]]));
  await expect(doneBtn(page)).toBeFocused(); // focus moves to Done as soon as there is something to send
  const before = await turnNow(page);
  await page.keyboard.press("Enter");
  await page.waitForFunction(([k, b]) => JSON.parse(localStorage.getItem(k as string)!).view.turn > (b as number), [KEY, before]);
  await expect(page.locator(".note.active")).toContainText("how you got");

  const ctx = await browser.newContext({ viewport: { width: 375, height: 740 } });
  await signInVia(ctx, baseURL!);
  const m = await ctx.newPage();
  await start(m);
  await mic(m).click();
  await expect(m.locator(".nextline")).toHaveClass(/p-listening/);
  await m.evaluate(() => (window as unknown as { __say: (x: [string, boolean][]) => void }).__say([["three x equals fifteen and some more words to wrap", false]]));
  expect(await m.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
  const box = await m.getByRole("button", { name: "Done — send what I said" }).boundingBox();
  expect(box!.width).toBeGreaterThanOrEqual(40); // comfortable touch target
  await m.getByRole("button", { name: "Cancel — discard what I said" }).click();
  await expect(m.getByRole("button", { name: "Speak your line" })).toBeVisible();
  await ctx.close();
});

test("Edit moves what was heard into the text box unsent; the student fixes it and sends once", async ({ page }) => {
  await start(page);
  const before = await turnNow(page);
  await listening(page);
  await page.evaluate(() => (window as unknown as { __say: (x: [string, boolean][]) => void }).__say([["I will do bod mass multiplication", true]]));
  await page.getByRole("button", { name: /^Edit/ }).click();
  await expect(status(page)).toContainText("Moved to the text box");
  const box = page.getByLabel("Your answer or message");
  await expect(box).toHaveValue("I will do bod mass multiplication");
  await expect(box).toBeFocused();
  await page.waitForTimeout(400);
  expect(await turnNow(page)).toBe(before); // nothing sent by Edit
  await box.fill("I will do BODMAS multiplication.");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await page.waitForFunction(([k, b]) => JSON.parse(localStorage.getItem(k as string)!).view.turn > (b as number), [KEY, before]);
  const s = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)!), KEY);
  expect(s.view.turn).toBe(before + 1);
  expect(s.view.transcript.at(-1).text).toContain("BODMAS is the order for working out an expression");
});

test("spoken: the reported BODMAS conversation is understood and repaired", async ({ page }) => {
  await start(page);
  const speak = async (text: string) => {
    const before = await turnNow(page);
    await listening(page);
    await page.evaluate((t) => (window as unknown as { __say: (x: [string, boolean][]) => void }).__say([[t, true]]), text);
    await doneBtn(page).click();
    await page.waitForFunction(([k, b]) => JSON.parse(localStorage.getItem(k as string)!).view.turn > (b as number), [KEY, before]);
    return page.evaluate((k) => JSON.parse(localStorage.getItem(k)!).view.transcript.at(-1), KEY);
  };
  await speak("I'm stuck");
  let t = await speak("I will do BODMAS multiplication.");
  expect(t.text).toContain("BODMAS is the order for working out an expression");
  await expect(page.locator(".note.active")).toContainText("+ 5");
  t = await speak("I said will do multiplication.");
  expect(t.text).toContain("I heard you say multiplication");
  await expect(page.locator(".note.active")).toContainText("heard you say multiplication");
  await expect(page.locator(".note.active")).not.toContainText("park that");
  t = await speak("subtract five from both sides");
  expect(t.text).toMatch(/^Yes\. Subtracting 5 undoes the \+ 5/);
  expect(t.stage).toBe("TRY");
  // (Which rule fired, the operation check and the model-call count are verified server-side in
  // tests/understand.test.ts and tests/language.test.ts; the browser no longer receives traces.)
});

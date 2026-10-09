/**
 * Visual audit: renders every student and console screen at 320 / 375 / 768 / 1024 / 1440 px (and 200% zoom),
 * saves screenshots, and reports layout defects found in the real DOM:
 *   - horizontal page overflow
 *   - clipped text (an element whose text overflows its box while overflow is hidden / ellipsised)
 *   - controls that overlap each other, or sit outside the viewport
 *
 *   BASE=http://localhost:3100 OUT=docs/screenshots/ui npx tsx scripts/ui-audit.ts
 */
import { chromium, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3100";
const OUT = process.env.OUT ?? "docs/screenshots/ui";
const WIDTHS = (process.env.WIDTHS ?? "320,375,768,1024,1440").split(",").map(Number);
mkdirSync(OUT, { recursive: true });

const MOCK = () => {
  const w = window as unknown as Record<string, unknown>;
  const recs: Record<string, unknown>[] = [];
  w.__recs = recs;
  class R {
    onstart: null | (() => void) = null;
    onresult: null | ((e: unknown) => void) = null;
    onerror = null;
    onend = null;
    lang = "";
    continuous = false;
    interimResults = false;
    constructor() {
      recs.push(this as unknown as Record<string, unknown>);
    }
    start() {
      setTimeout(() => this.onstart?.(), 10);
    }
    stop() {}
    abort() {}
  }
  w.SpeechRecognition = R;
  w.webkitSpeechRecognition = R;
  w.__say = (items: [string, boolean][]) => {
    const r = recs[recs.length - 1] as unknown as R;
    r.onresult?.({ resultIndex: 0, results: items.map(([t, f]) => Object.assign({ 0: { transcript: t }, length: 1 }, { isFinal: f })) });
  };
  const md = navigator.mediaDevices as unknown as Record<string, unknown>;
  if (md) md.getUserMedia = async () => ({ getTracks: () => [{ stop() {} }] });
  Object.defineProperty(window, "speechSynthesis", { value: { speaking: false, pending: false, cancel() {}, resume() {}, getVoices: () => [], speak() {} }, configurable: true });
};

async function defects(page: Page, label: string) {
  const r = await page.evaluate(() => {
    const out: string[] = [];
    const vw = document.documentElement.clientWidth;
    if (document.documentElement.scrollWidth > vw + 1) out.push(`page overflows horizontally by ${document.documentElement.scrollWidth - vw}px`);
    const visible = (el: Element) => {
      const s = getComputedStyle(el);
      const b = el.getBoundingClientRect();
      return s.visibility !== "hidden" && s.display !== "none" && b.width > 0 && b.height > 0;
    };
    for (const el of Array.from(document.querySelectorAll("body *"))) {
      if (!visible(el) || el.closest(".katex") || el.closest("[data-audit-ignore]")) continue;
      if (el.getBoundingClientRect().width <= 1) continue; // visually hidden on purpose (screen-reader text)
      const s = getComputedStyle(el);
      const hasText = Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent!.trim().length > 0);
      if (!hasText) continue;
      const clipsX = (s.overflowX === "hidden" || s.textOverflow === "ellipsis") && el.scrollWidth > el.clientWidth + 1;
      const clipsY = s.overflowY === "hidden" && el.scrollHeight > el.clientHeight + 2;
      if (clipsX || clipsY) out.push(`clipped text: <${el.tagName.toLowerCase()} class="${(el as HTMLElement).className}"> "${el.textContent!.trim().slice(0, 50)}"`);
      const b = el.getBoundingClientRect();
      let scroller: Element | null = el.parentElement;
      while (scroller && !["auto", "scroll"].includes(getComputedStyle(scroller).overflowX)) scroller = scroller.parentElement;
      if (b.right > vw + 1 && s.position !== "fixed" && !scroller) out.push(`text outside viewport: "${el.textContent!.trim().slice(0, 40)}"`);
    }
    const modal = document.querySelector("[aria-modal=true]");
    // Controls scrolled out of view inside their own scroll box, or passing under the sticky header, aren't overlaps.
    const inView = (el: Element) => {
      const b = el.getBoundingClientRect();
      for (let p = el.parentElement; p; p = p.parentElement) {
        const ps = getComputedStyle(p);
        if (["auto", "scroll", "hidden"].includes(ps.overflowY)) {
          const r = p.getBoundingClientRect();
          if (b.bottom <= r.top + 1 || b.top >= r.bottom - 1) return false;
        }
      }
      return true;
    };
    const stuck = (el: Element) => !!el.closest(".rail, .cbar") && getComputedStyle(el.closest(".rail, .cbar")!).position !== "static";
    const ctrls = Array.from((modal ?? document).querySelectorAll("button, a, input, [role=tab]")).filter((c) => visible(c) && inView(c));
    for (let i = 0; i < ctrls.length; i++)
      for (let j = i + 1; j < ctrls.length; j++) {
        if (ctrls[i].contains(ctrls[j]) || ctrls[j].contains(ctrls[i])) continue;
        if (stuck(ctrls[i]) !== stuck(ctrls[j])) continue;
        const a = ctrls[i].getBoundingClientRect();
        const c = ctrls[j].getBoundingClientRect();
        const ox = Math.min(a.right, c.right) - Math.max(a.left, c.left);
        const oy = Math.min(a.bottom, c.bottom) - Math.max(a.top, c.top);
        if (ox > 2 && oy > 2) out.push(`overlapping controls: "${(ctrls[i] as HTMLElement).innerText?.slice(0, 20) || ctrls[i].getAttribute("aria-label")}" × "${(ctrls[j] as HTMLElement).innerText?.slice(0, 20) || ctrls[j].getAttribute("aria-label")}"`);
      }
    return Array.from(new Set(out));
  });
  for (const d of r) console.log(`  ✗ [${label}] ${d}`);
  return r.length;
}

async function waitTurn(page: Page, before: number, key = "tutoros.session.v2") {
  await page.waitForFunction(([b, k]) => (JSON.parse(localStorage.getItem(k as string) ?? "null")?.state?.turn ?? 0) > (b as number), [before, key]);
  await page.waitForTimeout(250);
}
const turn = (page: Page, key = "tutoros.session.v2") => page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? "null")?.state?.turn ?? 0, key);
async function say(page: Page, text: string, key = "tutoros.session.v2") {
  const b = await turn(page, key);
  const input = page.getByLabel("Your answer or message");
  await input.fill(text);
  await input.press("Enter");
  await waitTurn(page, b, key);
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  let total = 0;
  for (const width of WIDTHS) {
    const ctx = await browser.newContext({ viewport: { width, height: width < 700 ? 800 : 900 }, extraHTTPHeaders: { "x-forwarded-for": `10.77.0.${width % 250}` } });
    await ctx.addInitScript("window.__name = (f) => f;"); // tsx keeps function names; the page needs the helper
    const page = await ctx.newPage();
    await page.addInitScript(MOCK);
    await page.goto(BASE);
    await page.evaluate(() => localStorage.clear());
    await page.goto(BASE);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/${width}-0-home.png`, fullPage: true });
    total += await defects(page, `${width} home`);
    // Geometry and physics lessons
    for (const [lesson, lines] of [["geometry", ["105", "I'm stuck", "75"]], ["physics", ["20 N", "4", "to the right"]]] as const) {
      await page.goto(`${BASE}/learn/${lesson}`);
      await page.getByRole("button", { name: "Read without sound" }).click();
      await page.waitForFunction((k) => !!localStorage.getItem(k), `tutoros.session.${lesson}.v1`);
      for (const t of lines) await say(page, t, `tutoros.session.${lesson}.v1`);
      await page.locator(".sp-explore summary").click();
      await page.waitForTimeout(200);
      await page.screenshot({ path: `${OUT}/${width}-0-${lesson}.png`, fullPage: true });
      total += await defects(page, `${width} ${lesson}`);
    }
    await page.goto(`${BASE}/learn/algebra`);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/${width}-0-welcome.png`, fullPage: true });
    total += await defects(page, `${width} welcome`);
    await page.getByRole("button", { name: "Start the lesson" }).click();
    await page.waitForFunction(() => !!localStorage.getItem("tutoros.session.v2"));
    await page.waitForTimeout(300);
    for (const t of ["x = 8", "I added the 3 and the 5", "3x = 25", "I'm sure 3x = 25 is right", "I'm stuck"]) await say(page, t);
    await page.screenshot({ path: `${OUT}/${width}-1-lesson.png`, fullPage: true });
    total += await defects(page, `${width} lesson`);
    await page.getByRole("button", { name: "Speak your line" }).click();
    await page.locator(".nextline.p-listening").waitFor(); // the mic opens after tutor speech has stopped
    await page.evaluate(() => (window as unknown as { __say: (x: [string, boolean][]) => void }).__say([["three x equals", true], ["fifteen", false]]));
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${OUT}/${width}-2-listening.png` });
    total += await defects(page, `${width} listening`);
    await page.getByRole("button", { name: "Cancel — discard what I said" }).click();
    await say(page, "3x = 15");
    await say(page, "x = 5");
    await page.screenshot({ path: `${OUT}/${width}-3-transfer.png`, fullPage: true });
    total += await defects(page, `${width} transfer`);
    // drawers
    for (const [name, open] of [["transcript", "Transcript"], ["progress", "My progress"]] as const) {
      const menu = page.getByRole("button", { name: /^(Menu|More)/ });
      if (await menu.count()) await menu.first().click();
      await page.getByRole(await page.getByRole("menuitem", { name: open }).count() ? "menuitem" : "button", { name: open }).first().click();
      await page.waitForTimeout(250);
      await page.screenshot({ path: `${OUT}/${width}-4-${name}.png` });
      total += await defects(page, `${width} ${name}`);
      await page.keyboard.press("Escape");
      await page.waitForTimeout(150);
    }
    // finish the lesson
    for (let i = 0; i < 2; i++) {
      const eq = await page.evaluate(() => {
        const s = JSON.parse(localStorage.getItem("tutoros.session.v2")!).state;
        return s.problems[s.current].answer as string;
      });
      await say(page, `x = ${eq}`);
    }
    await page.screenshot({ path: `${OUT}/${width}-5-complete.png`, fullPage: true });
    total += await defects(page, `${width} complete`);
    // scratch pad (only before completion it shows; reopen a fresh view not needed)
    // console
    const c = await ctx.newPage();
    await c.goto(`${BASE}/console?lesson=algebra`);
    await c.waitForTimeout(400);
    await c.screenshot({ path: `${OUT}/${width}-6-overview.png`, fullPage: width < 1024 });
    total += await defects(c, `${width} overview`);
    await c.getByRole("tab", { name: "Decision timeline" }).click();
    await c.locator(".tl-list .tl-item").nth(3).getByRole("button", { name: "Technical details" }).click().catch(() => {});
    await c.waitForTimeout(200);
    await c.screenshot({ path: `${OUT}/${width}-6-console.png`, fullPage: width < 1024 });
    total += await defects(c, `${width} console`);
    await c.getByRole("tab", { name: "Evaluation lab" }).click();
    await c.getByRole("button", { name: /Run comparison/ }).click();
    await c.waitForTimeout(1500);
    await c.locator(".cell.fail").first().click().catch(() => {});
    await c.waitForTimeout(200);
    await c.screenshot({ path: `${OUT}/${width}-7-eval.png`, fullPage: width < 1024 });
    total += await defects(c, `${width} eval`);
    await c.getByRole("tab", { name: "Architecture & safety" }).click();
    await c.waitForTimeout(200);
    await c.screenshot({ path: `${OUT}/${width}-8-architecture.png`, fullPage: width < 1024 });
    total += await defects(c, `${width} architecture`);
    await ctx.close();
  }
  // 200% zoom ≈ a 720px-wide viewport at device scale 2
  const z = await browser.newContext({ viewport: { width: 720, height: 450 }, deviceScaleFactor: 2, extraHTTPHeaders: { "x-forwarded-for": "10.77.1.1" } });
  await z.addInitScript("window.__name = (f) => f;");
  const zp = await z.newPage();
  await zp.addInitScript(MOCK);
  await zp.goto(`${BASE}/learn/algebra`);
  await zp.evaluate(() => localStorage.clear());
  await zp.goto(`${BASE}/learn/algebra`);
  await zp.getByRole("button", { name: "Start the lesson" }).click();
  await zp.waitForFunction(() => !!localStorage.getItem("tutoros.session.v2"));
  await say(zp, "x = 8");
  await say(zp, "I'm stuck");
  await zp.screenshot({ path: `${OUT}/zoom200-lesson.png`, fullPage: true });
  total += await defects(zp, "200% zoom");
  await z.close();
  await browser.close();
  console.log(total === 0 ? "No layout defects found." : `${total} defect(s) found.`);
})();

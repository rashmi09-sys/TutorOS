import { E2E_PASSWORD, E2E_USERNAME, expect, signInVia, startWithoutSound, test } from "./fixtures";

/**
 * The sign-in gate, in a real browser against the real server. These tests start signed out.
 * (Expiry at the exact second is covered in tests/auth.test.ts with a controlled clock; here an expired or
 * forged cookie is the same thing from the server's point of view: it doesn't verify.)
 */
test.use({ signedIn: false });

const origin = (baseURL?: string) => new URL(baseURL!).origin;

test("signed out: every page leads to the sign-in page, and nothing of the app is rendered", async ({ page }) => {
  for (const path of ["/", "/learn/algebra", "/learn/physics", "/learn/geometry", "/console", "/anything"]) {
    const res = await page.goto(path);
    expect(res!.status()).toBe(200);
    await expect(page).toHaveURL(/\/signin(\?|$)/);
    await expect(page.getByRole("heading", { name: "TutorOS" })).toBeVisible();
    await expect(page.getByText("A more thoughtful way to learn.")).toBeVisible();
    const html = await page.content();
    for (const s of ["Start Lesson", "What would you like to work on?", "3x + 5 = 20"]) expect(html).not.toContain(s);
  }
  const res = await page.goto("/learn/physics");
  expect(new URL(page.url()).searchParams.get("next")).toBe("/learn/physics");
  // Security headers on the page
  const h = res!.headers();
  expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(h["x-frame-options"]).toBe("DENY");
  expect(h["x-content-type-options"]).toBe("nosniff");
  expect(h["x-powered-by"]).toBeUndefined();
});

test("signed out: the APIs refuse, whatever the request looks like", async ({ request, baseURL }) => {
  const headers = { origin: origin(baseURL) };
  expect((await request.post("/api/turn", { data: { sealed: null, event: { type: "start" } }, headers })).status()).toBe(401);
  expect((await request.post("/api/tts", { data: { text: "Hello" }, headers })).status()).toBe(401);
  expect((await request.get("/api/health")).status()).toBe(401);
  expect((await request.post("/api/turn", { data: {}, headers: { origin: "https://evil.example" } })).status()).toBe(403);
  // A made-up session cookie doesn't help
  const forged = await request.post("/api/turn", { data: { sealed: null, event: { type: "start" } }, headers: { ...headers, cookie: "tutoros_auth=eyJ2IjoxLCJ1IjoiVGVhY2hlciJ9.AAAA" } });
  expect(forged.status()).toBe(401);
});

test("signed out: browser storage can't get you in", async ({ page }) => {
  await page.goto("/signin");
  await page.evaluate(() => {
    localStorage.setItem("tutoros.session.v3", JSON.stringify({ view: { turn: 3 }, sealed: "s1.x", teacher: null, updatedAt: "" }));
    localStorage.setItem("authenticated", "true");
    document.cookie = "tutoros_auth=forged; path=/";
  });
  await page.goto("/learn/algebra");
  await expect(page).toHaveURL(/\/signin/);
});

test("wrong credentials: one generic message, no session, still on the sign-in page", async ({ page, context }) => {
  await page.goto("/signin");
  for (const [u, p] of [
    [E2E_USERNAME, "not-the-password"],
    ["someone-else", E2E_PASSWORD],
  ]) {
    await page.getByLabel("Username").fill(u);
    await page.getByLabel("Password", { exact: true }).fill(p);
    await page.getByRole("button", { name: "Sign In" }).click();
    await expect(page.locator("#signin-error")).toHaveText("That username and password didn't match.");
    await expect(page).toHaveURL(/\/signin/);
    await expect(page.getByLabel("Password", { exact: true })).toHaveValue(""); // cleared for another try
  }
  expect((await context.cookies()).find((c) => c.name === "tutoros_auth")).toBeUndefined();
  // Empty fields are caught before anything is sent
  await page.getByLabel("Username").fill("");
  await page.getByRole("button", { name: "Sign In" }).click();
  await expect(page.locator("#signin-error")).toHaveText("Enter your username and password.");
});

test("valid sign-in: show/hide password, loading state, back to the page asked for, a secure cookie", async ({ page, context }) => {
  await page.goto("/learn/geometry");
  await expect(page).toHaveURL(/\/signin\?next=%2Flearn%2Fgeometry/);
  await page.getByLabel("Username").fill(E2E_USERNAME);
  const pw = page.getByLabel("Password", { exact: true });
  await pw.fill(E2E_PASSWORD);
  await expect(pw).toHaveAttribute("type", "password");
  await page.getByRole("button", { name: "Show password" }).click();
  await expect(pw).toHaveAttribute("type", "text");
  await page.getByRole("button", { name: "Hide password" }).click();
  await expect(pw).toHaveAttribute("type", "password");
  // Hold the response briefly to see the loading state
  await page.route("**/api/auth/login", async (route) => {
    await new Promise((r) => setTimeout(r, 400));
    await route.continue();
  });
  await page.getByRole("button", { name: "Sign In" }).click();
  await expect(page.getByRole("button", { name: /Signing in/ })).toBeDisabled();
  await expect(page).toHaveURL(/\/learn\/geometry$/);
  await expect(page.getByRole("button", { name: "Start Lesson" })).toBeVisible();
  const c = (await context.cookies()).find((x) => x.name === "tutoros_auth")!;
  expect(c.httpOnly).toBe(true);
  expect(c.sameSite).toBe("Lax");
  expect(c.path).toBe("/");
  const hours = (c.expires - Date.now() / 1000) / 3600;
  expect(hours).toBeGreaterThan(0);
  expect(hours).toBeLessThanOrEqual(8.01);
  // The cookie isn't visible to page scripts
  expect(await page.evaluate(() => document.cookie)).not.toContain("tutoros_auth");
  // Signed in, /signin sends you back into the app
  await page.goto("/signin");
  await expect(page).toHaveURL(/\/$/);
});

test("the sign-in page carries no credentials: no hash, no password, nothing secret in its HTML or scripts", async ({ page }) => {
  const bodies: string[] = [];
  page.on("response", async (r) => {
    if (/\.(js|css)$|\/signin/.test(new URL(r.url()).pathname)) bodies.push(await r.text().catch(() => ""));
  });
  await page.goto("/signin");
  await page.waitForLoadState("networkidle");
  const all = bodies.join("\n");
  expect(all.length).toBeGreaterThan(1000);
  for (const s of ["scrypt:", "AUTH_PASSWORD_HASH", "AUTH_SECRET", "SESSION_SECRET", E2E_PASSWORD]) expect(all).not.toContain(s);
});

test("sign out ends the session: back to sign-in, pages and APIs closed again, lessons forgotten", async ({ page, context, baseURL }) => {
  await signInVia(context, baseURL!);
  await page.goto("/learn/algebra");
  await page.getByRole("button", { name: "Sound on" }).click();
  await page.getByRole("button", { name: "Start Lesson" }).click();
  await expect(page.locator(".note.active")).toContainText("3x + 5 = 20");
  await page.goto("/");
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/signin$/);
  expect((await context.cookies()).find((c) => c.name === "tutoros_auth")).toBeUndefined();
  expect(await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("tutoros.")))).toEqual([]);
  await page.goto("/learn/algebra");
  await expect(page).toHaveURL(/\/signin/);
  expect((await page.request.get("/api/health")).status()).toBe(401);
});

test("sign out from the lesson menu", async ({ page, context, baseURL }) => {
  await signInVia(context, baseURL!);
  await page.goto("/learn/physics");
  await startWithoutSound(page);
  await page.getByRole("button", { name: "Menu" }).click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/signin$/);
});

test("a session that ends mid-lesson sends the student to sign in, and back to the lesson afterwards", async ({ page, context, baseURL }) => {
  await signInVia(context, baseURL!);
  await page.goto("/learn/algebra");
  await page.getByRole("button", { name: "Sound on" }).click();
  await page.getByRole("button", { name: "Start Lesson" }).click();
  await expect(page.locator(".note.active")).toContainText("3x + 5 = 20");
  // The session expires (here: the cookie stops verifying, exactly what an expired token does)
  const url = new URL(baseURL!);
  await context.clearCookies();
  await context.addCookies([{ name: "tutoros_auth", value: "expired.token", domain: url.hostname, path: "/" }]);
  await page.getByLabel("Your answer or message").fill("x = 5");
  await page.getByLabel("Your answer or message").press("Enter");
  await expect(page).toHaveURL(/\/signin\?next=%2Flearn%2Falgebra/);
  await page.getByLabel("Username").fill(E2E_USERNAME);
  await page.getByLabel("Password", { exact: true }).fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Sign In" }).click();
  await expect(page).toHaveURL(/\/learn\/algebra$/);
  await expect(page.getByText("Welcome back")).toBeVisible(); // the lesson resumes where it was
});

test("phone width: the sign-in card fits without sideways scrolling", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 360, height: 740 } });
  const page = await ctx.newPage();
  await page.goto("/signin");
  await expect(page.getByRole("button", { name: "Sign In" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await ctx.close();
});

# Security: sign-in, sessions and what the browser can see

TutorOS is closed to the public. Anyone who isn't signed in sees only the sign-in page. The server enforces this on every request; the React pages never decide it.

## How sign-in works

```
Browser ──POST /api/auth/login {username, password}──►  Node route
                                                        • rate limits: 10 attempts/15 min per client address,
                                                          20 failures/15 min per username
                                                        • username vs AUTH_USERNAME (constant-time)
                                                        • password vs AUTH_PASSWORD_HASH (scrypt, constant-time;
                                                          always hashed, even for an unknown username)
                                                        • same message for every failure, after a short delay
        ◄── Set-Cookie: tutoros_auth=<signed token>; HttpOnly; SameSite=Lax; Secure (production); Path=/; Max-Age=8h

Every later request ──►  middleware (src/middleware.ts), before any page or API runs
                         • state-changing /api calls must carry this site's Origin (CSRF) → otherwise 403
                         • verifies the token (HMAC-SHA256 with AUTH_SECRET, expiry)
                         • no valid token: pages → 307 /signin?next=…, APIs → 401 {"error":"unauthorized"}
                         • public: /signin, /api/auth/login, /api/auth/logout, and hashed build assets
                         • sets a per-request Content-Security-Policy nonce on pages
                     ──►  app layout (src/app/(app)/layout.tsx) checks the session again before rendering
                     ──►  /api/turn, /api/tts, /api/health check it again too (defence in depth)
```

- **Token**: `base64url(payload).base64url(HMAC-SHA256(payload, AUTH_SECRET))`, where the payload is `{v, u, sid, iat, exp}`. It contains nothing secret. Every sign-in gets a new random `sid`, so a cookie planted before sign-in is never upgraded (no session fixation).
- **Expiry**: `AUTH_SESSION_TTL_HOURS`, 8 hours by default. Both the cookie's `Max-Age` and the token's `exp` enforce it. An expired token is treated exactly like no token. If a session expires mid-lesson, the next turn returns 401 and the page sends the student to `/signin?next=<the lesson>`. After signing in again the lesson resumes.
- **Sign out**: `POST /api/auth/logout` clears the cookie. The page also deletes this browser's saved lessons, then goes to `/signin`. "Sign out" appears in the home header and in the lesson menu.
- **Fail closed**: sign-in answers 503 and nobody can get in if any of these is missing:
  - `AUTH_USERNAME`
  - `AUTH_PASSWORD_HASH`
  - `AUTH_SECRET` (it must also be 32 characters or more)

## What the browser receives

The browser receives only what the page needs to draw itself.

- **Lesson state is sealed.** It used to be held as readable JSON with an HMAC; it is now an opaque blob encrypted with AES-256-GCM (`src/lib/server/sealed-state.ts`).
  - The key comes from `SESSION_SECRET`, or from `AUTH_SECRET` if that is unset.
  - The blob is bound to the lesson and the signed-in username.
  - The server only ever continues from this blob. Editing it, or moving it to another lesson or user, gets a 409.
- **The page draws from a redacted view** (`src/lib/server/view.ts`). It is built from a whitelist. These are left out:
  - the answer and the worked answer to any problem not reached yet, and the missing angle of an unsolved triangle;
  - the problem generator's seed;
  - policy rule names (they become a small set of display cues);
  - the dialogue and diagnosis internals;
  - the teaching memory beyond what the board shows;
  - model-call counters and event ids.
- **No traces.** The per-turn trace (decision, rule, candidates, prompts, model calls) stays on the server. `/api/turn` returns only `{view, sealed, utterance, turnId, duplicate, teacher, requestId}`.
- **No policy or templates in the bundle.** The browser bundle doesn't include the policy, the reply templates, the misconception probes, the evaluation suites or any prompt. The progress page gets a labels-only module (`misconception-labels.ts`; a unit test keeps it identical to the catalogue).
- **`/api/health` requires a session** and returns only which teacher and which voice are active. It no longer reports versions, limits, signing modes or provider details.
- **Errors are generic.** There are no validation details, stack traces or upstream messages. Production pages show only an error reference.

The client-side code of the app (React components) is still public by nature: hashed build assets are served without a session so the sign-in page can load. They contain UI code only; see the bundle scan below.

## Production environment variables (Vercel)

Set these in Vercel → Project → Settings → Environment Variables, for **Production** (and Preview if you use it). Mark the secret ones **Sensitive**. None of them starts with `NEXT_PUBLIC_`, so none is ever sent to the browser.

| Variable | Secret? | Value |
|---|---|---|
| `AUTH_USERNAME` | no | The account's username |
| `AUTH_PASSWORD_HASH` | **yes** | Output of `npm run --silent auth:hash` (format `scrypt:N:r:p:salt:key`) |
| `AUTH_SECRET` | **yes** | 32+ random characters: `npm run --silent auth:secret`. Rotating it signs everyone out |
| `SESSION_SECRET` | **yes** | 32+ random characters, a different value from `AUTH_SECRET`. Rotating it makes saved lessons start over |
| `AUTH_SESSION_TTL_HOURS` | no | Optional; default `8` |
| `GOOGLE_TTS_ENABLED`, `GOOGLE_CLOUD_PROJECT`, `GCP_*` | no | Unchanged; see [VOICE.md](VOICE.md) |

To create the hash without the password ever appearing in a file, shell history or a log, run this on your own machine:

```bash
npm run --silent auth:hash           # type the password at the hidden prompt; only the hash is printed
npm run --silent auth:secret         # run twice: one value for AUTH_SECRET, another for SESSION_SECRET
```

Then add each value in the Vercel dashboard, or with `vercel env add AUTH_PASSWORD_HASH production` and paste it at the prompt. Don't put the password or the hash in Git, in `.env.example`, in a ticket or in chat. To change the password later, generate a new hash, replace `AUTH_PASSWORD_HASH` and redeploy.

For local use, put the same names in `.env.local`, which is git-ignored.

## Verifying a deployment

Replace `$APP` with the deployment URL.

```bash
curl -sI $APP/ | grep -i -E '^(HTTP|location)'          # 307 → /signin
curl -s  $APP/api/health                                 # {"error":"unauthorized"}  (401)
curl -s  -X POST $APP/api/tts -H "origin: $APP" -H 'content-type: application/json' -d '{"text":"hi"}'   # 401
curl -s  -X POST $APP/api/turn -H "origin: $APP" -H 'content-type: application/json' -d '{"sealed":null,"event":{"type":"start"}}'  # 401
curl -sI $APP/signin | grep -i -E 'content-security-policy|x-frame-options|strict-transport'
```

Then, in a browser:

1. Open `$APP`. You land on the sign-in page.
2. A wrong password shows "That username and password didn't match."
3. Sign in. You land on the home page.
4. Open Algebra with **Sound on** and press **Start Lesson**. If the Google voice is configured, the tutor speaks in Sulafat; in DevTools → Network, `/api/tts` returns `200 audio/mpeg`.
5. Press **Sign out**. You return to `/signin`, and opening `$APP/learn/algebra` sends you back to sign in.

If sign-in always fails on Vercel, check that the three `AUTH_*` variables are set for the environment you're testing and that you redeployed after setting them. The function log shows `route: "login", result: "not_configured"` when one is missing.

## Security review (11 Oct 2026)

| Area | Finding | Status |
|---|---|---|
| Authentication bypass | The app had no authentication. Every page and API (including the billable `/api/tts`) was public | **Fixed**: middleware gate, app-layout check, in-route checks. Tests cover direct navigation, API calls, refreshes, forged/expired cookies and planted localStorage |
| Exposed endpoints | `/api/health` disclosed provider, model, limits, signing mode and the daily TTS usage. `/console` and `/api/eval` had already been removed in v7 | **Fixed**: health requires a session and is minimal. An authenticated request to `/console` or `/api/eval` gets 404 |
| Internal traces | `/api/turn` returned the full trace (decision, rule, candidates, prompts, model calls), and the browser stored it in localStorage | **Fixed**: the trace stays on the server; old localStorage saves are deleted on load |
| Answers and internals in client state | The browser held the full state: answers to unreached problems, generator seed, dialogue, diagnosis, teaching memory | **Fixed**: sealed state plus a whitelisted view |
| Teaching policy and templates in the bundle | Client components imported the misconception catalogue (probes and teaching focus) | **Fixed**: a labels-only module. The scan below finds no rule names, templates, probes, prompts or env-var names in `.next/static` |
| Secrets in bundles or Git | None found. `.env.local` is git-ignored; the password and hash are in no tracked file and nowhere in Git history; no source maps are shipped | Verified by grep (below) |
| Session fixation / cookies | — | New random session id at every sign-in; HttpOnly, SameSite=Lax, Secure in production, Path=/, Max-Age = TTL; invalid cookies are cleared |
| Brute force | — | Per-address (10/15 min, all attempts) and per-username (20 failures/15 min) limits; scrypt (N = 2¹⁵); 250–500 ms delay on failure; generic messages |
| XSS | `Math.tsx` returned the raw TeX as HTML if KaTeX threw | **Fixed**: `renderTex` escapes on failure, uses `trust: false` and bounds expansion; `tests/xss.test.ts`. React escapes everything else; this is the only `dangerouslySetInnerHTML` |
| CSRF | — | SameSite=Lax cookie plus an Origin check on every state-changing API call (403 for another site or a missing Origin), including sign-in |
| Security headers | None were set | **Fixed**: CSP with a per-request nonce, `frame-ancestors 'none'`, `object-src 'none'`, `connect-src 'self'`; X-Frame-Options DENY; nosniff; Referrer-Policy; Permissions-Policy (microphone for this site only); COOP/CORP; HSTS in production; `X-Powered-By` removed |
| Error messages | `/api/turn` returned zod issue paths on 400 | **Fixed**: generic `Invalid request`. Production pages show only an error reference |
| TTS abuse | Anyone could call `/api/tts` | **Fixed**: session required, on top of the existing limits (30 req/min per client, 1,000 chars/request, 100k chars/day per instance, 8 s timeout) |
| Dependencies | `npm audit`: next 15.5.4 had **critical** advisories (RCE in the React flight protocol, Server Actions source exposure, DoS); postcss, sharp and KaTeX had advisories; vitest/tinypool (dev) was critical | **Fixed**: next 15.5.27, KaTeX 0.18.11, vitest 4.1.11, overrides postcss ^8.5.29 and sharp ^0.35.5. **Remaining**: 4 high advisories in `braces` via `@next/eslint-plugin-next` → fast-glob → micromatch. This chain is dev-only (lint), not shipped, and has no fixed version |

Scans that were run:

- **Client bundle**: `.next/static` was searched for:
  - rule names (`R31_…`, `S0_PRESENT`, `G_CORRECT`);
  - template and probe text;
  - `candidate_id`;
  - env-var names (`AUTH_`, `SESSION_SECRET`, `GOOGLE_TTS`, `ANTHROPIC`);
  - `scrypt`, the project id and the password.

  There were 0 hits, and there are 0 `.map` files.
- **Git and the build output**: the real `AUTH_SECRET`, `SESSION_SECRET`, the hash and the password were searched for in tracked and untracked files, `git log -p` and `.next/`. There were 0 hits.

## Tests

- `tests/auth.test.ts` (22 tests) covers:
  - password hashing: format, wrong and malformed input, the length cap;
  - tokens: tampering, another key, expiry, the size cap;
  - the TTL and secret rules, and safe redirects;
  - login: valid, all invalid combinations with one message, malformed bodies, Secure in production, the per-address and per-username limits, not configured;
  - logout;
  - the middleware: redirects and 401s, forged, expired and garbage cookies, expiry with a controlled clock, CSP nonce, public routes, CSRF;
  - the view redaction and the label module.
- `tests/server.test.ts` covers:
  - sealed state: round trip, edits, another lesson, another user;
  - `/api/turn` without, with a forged and with an expired session;
  - no internals in responses;
  - tamper → 409, and generic 400s;
  - health requires a session.
- `tests/tts.test.ts` checks that `/api/tts` and `/api/health` require a session and never call Google without one.
- `tests/xss.test.ts` sends seven injection payloads through the maths renderer.
- `e2e/auth.spec.ts` (10 tests, real browser against the production build) covers:
  - signed-out pages, APIs and planted storage;
  - wrong credentials;
  - valid sign-in with show/hide and the loading state;
  - the cookie flags;
  - no secrets in the sign-in page's HTML or scripts;
  - sign out from home and from the lesson menu;
  - a session ending mid-lesson and resuming after sign-in;
  - phone width.

The browser tests sign in with a **throwaway** username and password created for each run: the server under test is started with that password's hash in its environment, and the test reads the password from `E2E_PASSWORD`. The real password is never used in tests.

```bash
PW=$(node -e "process.stdout.write(require('crypto').randomBytes(15).toString('base64url'))")
HASH=$(printf '%s' "$PW" | npm run --silent auth:hash)
npm run build
AUTH_USERNAME=e2e-teacher AUTH_PASSWORD_HASH="$HASH" npx next start -p 3100 &
E2E_USERNAME=e2e-teacher E2E_PASSWORD="$PW" E2E_BASE_URL=http://localhost:3100 npx playwright test
```

## Remaining limitations and risks

- **One shared account.** There are no per-person accounts, roles or audit trail of who did what, and everyone who knows the password is the same user.
- **Sessions can't be revoked one at a time.** Tokens are stateless; signing out clears the cookie in that browser. To end every session at once, rotate `AUTH_SECRET`. Revoking a single session would need a server-side session store.
- **Rate limits are in memory, per server instance.** On Vercel, several instances each keep their own counts, so the effective limit is higher. For a hard limit, add Vercel Firewall rate limiting on `/api/auth/login` or a shared store (e.g. Upstash Redis).
- **The per-username limit can be used to lock the account out for 15 minutes.** It is the trade-off for slowing a distributed guesser. The per-address limit relies on Vercel's `x-forwarded-for`; on other hosts make sure the proxy sets it.
- **Client UI code is downloadable without signing in** (hashed static assets). It contains no secrets, policy, templates or answers, but it does reveal the app's UI structure.
- **The answers can still be worked out.** They are derivable from what is shown (that's what a maths problem is), and triangles are drawn to scale. Only the verbatim answers are withheld.
- **`/api/tts` will synthesise any text up to 1,000 characters for a signed-in user.** The daily character cap and a Google Cloud quota or budget ([VOICE.md](VOICE.md)) are the cost ceiling.
- **The CSP allows inline style attributes** (KaTeX needs them). Scripts are nonce-only.
- **Dev-only advisories remain** in the ESLint plugin's dependency chain.

"use client";

import { useRef, useState } from "react";

/**
 * The sign-in card. It only sends what was typed to the server and shows the server's (generic) answer;
 * no credential, hash or check of any kind lives in this file.
 */
export function SignInForm({ next }: { next: string }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(0);
  const passRef = useRef<HTMLInputElement>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!username.trim() || !password) {
      setError("Enter your username and password.");
      setShake((n) => n + 1);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, password, next }),
        credentials: "same-origin",
        cache: "no-store",
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; next?: string; error?: string };
      if (res.ok && data.ok) {
        setPassword("");
        // A full navigation, so the server renders the app with the new session cookie.
        window.location.assign(data.next && data.next.startsWith("/") && !data.next.startsWith("//") ? data.next : "/");
        return;
      }
      setError(data.error ?? "That username and password didn't match.");
      setShake((n) => n + 1);
      setPassword("");
      setTimeout(() => passRef.current?.focus(), 0);
    } catch {
      setError("Couldn't reach TutorOS. Check your connection and try again.");
    }
    setBusy(false);
  }

  return (
    <section className="signin-card" data-shake={shake > 0 ? (shake % 2 ? "a" : "b") : undefined} aria-labelledby="signin-title">
      <header className="signin-head">
        <span className="signin-mark" aria-hidden>
          <svg viewBox="0 0 40 40" width="40" height="40">
            <rect x="1" y="1" width="38" height="38" rx="11" fill="var(--blue)" />
            <path d="M12 14h16M20 14v14" stroke="#fff" strokeWidth="3.2" strokeLinecap="round" />
            <circle cx="29" cy="27" r="3" fill="var(--amber-mid)" />
          </svg>
        </span>
        <h1 id="signin-title">TutorOS</h1>
        <p className="signin-tag">A more thoughtful way to learn.</p>
      </header>

      <form className="signin-form" onSubmit={submit} noValidate>
        <label className="signin-field">
          <span>Username</span>
          <input
            name="username"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            disabled={busy}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "signin-error" : undefined}
            maxLength={100}
            autoFocus
          />
        </label>
        <label className="signin-field">
          <span>Password</span>
          <span className="signin-pass">
            <input
              ref={passRef}
              name="password"
              type={show ? "text" : "password"}
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={busy}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "signin-error" : undefined}
              maxLength={256}
            />
            <button type="button" className="signin-eye" onClick={() => setShow((v) => !v)} aria-label={show ? "Hide password" : "Show password"} aria-pressed={show} disabled={busy}>
              {show ? <EyeOff /> : <Eye />}
            </button>
          </span>
        </label>

        <p id="signin-error" className="signin-error" role="alert" aria-live="assertive">
          {error}
        </p>

        <button type="submit" className="btn primary big signin-submit" disabled={busy} aria-busy={busy}>
          {busy ? (
            <>
              <span className="signin-spinner" aria-hidden /> Signing in…
            </>
          ) : (
            "Sign In"
          )}
        </button>
      </form>
      <p className="signin-foot">For invited tutors and students. Sessions end automatically after a few hours.</p>
    </section>
  );
}

function Eye() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOff() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 3l18 18" />
      <path d="M10.6 5.1A10.8 10.8 0 0 1 12 5c6.4 0 10 7 10 7a17.6 17.6 0 0 1-3.2 4.1M6.6 6.6C3.8 8.4 2 12 2 12s3.6 7 10 7c1.8 0 3.4-.5 4.8-1.3" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </svg>
  );
}

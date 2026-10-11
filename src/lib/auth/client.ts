"use client";

/**
 * Browser-side helpers for the session. They hold no secrets and make no security decisions — the server
 * does. They only react to what the server says (401 → back to sign in) and ask it to end the session.
 */

/** Send the visitor to the sign-in page, coming back here afterwards. */
export function toSignIn() {
  if (typeof window === "undefined") return;
  const here = window.location.pathname + window.location.search;
  window.location.assign(here && here !== "/" ? `/signin?next=${encodeURIComponent(here)}` : "/signin");
}

/** True (and redirects) if a response says the session is missing or expired. */
export function handleUnauthorized(res: Response): boolean {
  if (res.status !== 401) return false;
  toSignIn();
  return true;
}

/** End the session on the server, forget this browser's lessons, and go to the sign-in page. */
export async function signOut() {
  try {
    await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin", cache: "no-store" });
  } catch {
    /* the cookie expires anyway; still leave the app */
  }
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith("tutoros.")) localStorage.removeItem(k);
  } catch {}
  window.location.assign("/signin");
}

import type { Metadata } from "next";
import { SignInForm } from "@/components/auth/SignInForm";
import { safeNext } from "@/lib/auth/token";

export const metadata: Metadata = { title: "Sign in — TutorOS", robots: { index: false, follow: false } };

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const sp = await searchParams;
  const next = safeNext(Array.isArray(sp.next) ? sp.next[0] : sp.next);
  return (
    <main className="signin">
      <div className="signin-grid" aria-hidden />
      <SignInForm next={next} />
    </main>
  );
}

"use client";

/** Route-level error boundary: a render error shows a calm recovery screen instead of a blank page. */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="welcome" role="alert">
      <h1>Something went wrong on our side.</h1>
      <p>Your progress is saved in this browser. You can try again, or start a fresh lesson.</p>
      <p style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 20 }}>
        <button className="btn primary" onClick={reset}>Try again</button>
        <button
          className="btn"
          onClick={() => {
            try {
              localStorage.removeItem("tutoros.session.v2");
            } catch {}
            window.location.href = "/";
          }}
        >
          Start a new lesson
        </button>
      </p>
      {error.digest && <p className="mono" style={{ fontSize: 12, color: "var(--ink-3)" }}>ref {error.digest}</p>}
    </main>
  );
}

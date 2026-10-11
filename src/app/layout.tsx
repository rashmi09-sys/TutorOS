import type { Metadata, Viewport } from "next";
// Fonts are bundled with the app (no runtime request to a font CDN, so it looks the same offline):
//  - Lexend — body text. Designed for reading fluency (wider letter spacing, open shapes), with a plain zero,
//    which matters for a 12-year-old reading maths.
//  - Bricolage Grotesque — headings only: a little character so the product doesn't look like every dashboard.
//  - KaTeX's own serif — reserved for mathematical notation.
import "@fontsource-variable/lexend/wght.css";
import "@fontsource-variable/bricolage-grotesque/index.css";
import "katex/dist/katex.min.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "TutorOS",
  description: "Short tutoring lessons in algebra, physics and geometry. Every answer is checked exactly; hints come one step at a time.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

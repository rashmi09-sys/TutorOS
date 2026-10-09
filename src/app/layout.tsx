import type { Metadata, Viewport } from "next";
// Fonts are bundled with the app (no runtime request to a font CDN, so it looks the same offline):
//  - Inter — one highly legible sans for everything readable. Chosen over Atkinson Hyperlegible because its zero is
//    plain: a slashed zero reads as "2Ø" to a 12-year-old doing maths.
//  - KaTeX's own serif — reserved for mathematical notation.
import "@fontsource-variable/inter/wght.css";
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

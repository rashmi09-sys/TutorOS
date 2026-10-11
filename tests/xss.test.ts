/** What a student types can reach the maths renderer: it must never become live HTML or a link. */
import { describe, expect, it } from "vitest";
import { renderTex } from "@/lib/tex";
import { rawToLatex } from "@/engine/algebra";

const payloads = [
  "<img src=x onerror=alert(1)>",
  "\\href{javascript:alert(1)}{x}",
  "\\url{javascript:alert(1)}",
  "\\htmlClass{x}{y}",
  "\\includegraphics{https://evil.example/x.png}",
  '"><script>alert(1)</script>',
  "\\def\\a{\\a\\a}\\a",
];

describe("maths rendering is safe", () => {
  for (const p of payloads) {
    it(`renders ${JSON.stringify(p)} without markup or links`, () => {
      for (const tex of [p, rawToLatex(p)]) {
        const html = renderTex(tex);
        // Only the tags themselves (text between tags is escaped and inert, e.g. the TeX source annotation).
        const tags = html.match(/<[^>]*>/g) ?? [];
        for (const t of tags) {
          expect(t).not.toMatch(/^<\/?(script|img|a|iframe|object|embed|svg|style)\b/i);
          expect(t).not.toMatch(/\s(on\w+|href|src|xlink:href)\s*=/i);
          expect(t).not.toMatch(/javascript:/i);
        }
        expect(html).not.toMatch(/<(?![a-z/!])/i); // no stray, unescaped "<"
      }
    });
  }
});

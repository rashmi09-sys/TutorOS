import katex from "katex";

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/**
 * Maths to HTML. Some of the text comes from what the student typed, so: KaTeX with `trust: false` (no
 * \href, \url, \includegraphics, \htmlClass…), bounded macro expansion and size, and if KaTeX fails for
 * any reason the text is shown escaped, never as HTML.
 */
export function renderTex(tex: string): string {
  try {
    return katex.renderToString(String(tex).slice(0, 2000), { throwOnError: false, output: "htmlAndMathml", trust: false, strict: "ignore", maxExpand: 100, maxSize: 20 });
  } catch {
    return escapeHtml(String(tex));
  }
}

"use client";
import katex from "katex";
import { useMemo } from "react";

export function Tex({ tex, label }: { tex: string; label?: string }) {
  const html = useMemo(() => {
    try {
      return katex.renderToString(tex, { throwOnError: false, output: "htmlAndMathml" });
    } catch {
      return tex;
    }
  }, [tex]);
  // MathML output gives screen readers the real expression.
  return <span className="math" aria-label={label} dangerouslySetInnerHTML={{ __html: html }} />;
}

"use client";
import { useEffect, useRef } from "react";

/** Freehand scratch layer over the board — the student's own space to think. Not sent to the server. */
export function ScratchCanvas({ active, tool, clearSignal }: { active: boolean; tool: "pen" | "eraser"; clearSignal: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const resize = () => {
      const r = c.parentElement!.getBoundingClientRect();
      const data = c.width ? c.getContext("2d")!.getImageData(0, 0, c.width, c.height) : null;
      const dpr = window.devicePixelRatio || 1;
      c.width = Math.max(1, r.width * dpr);
      c.height = Math.max(1, Math.max(r.height, c.parentElement!.scrollHeight) * dpr);
      c.style.height = `${c.height / dpr}px`;
      const ctx = c.getContext("2d")!;
      ctx.scale(dpr, dpr);
      if (data) ctx.putImageData(data, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(c.parentElement!);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const c = ref.current;
    if (c) c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
  }, [clearSignal]);

  const pos = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  return (
    <canvas
      ref={ref}
      className="scratch"
      aria-label="Scratch area for your own working"
      style={{ pointerEvents: active ? "auto" : "none", cursor: active ? "crosshair" : "default" }}
      onPointerDown={(e) => {
        drawing.current = true;
        last.current = pos(e);
        (e.target as Element).setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (!drawing.current || !last.current) return;
        const ctx = ref.current!.getContext("2d")!;
        const p = pos(e);
        ctx.globalCompositeOperation = tool === "eraser" ? "destination-out" : "source-over";
        ctx.strokeStyle = "#6a3dc2";
        ctx.lineWidth = tool === "eraser" ? 22 : 2.6;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.beginPath();
        ctx.moveTo(last.current.x, last.current.y);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
        last.current = p;
      }}
      onPointerUp={() => {
        drawing.current = false;
        last.current = null;
      }}
    />
  );
}

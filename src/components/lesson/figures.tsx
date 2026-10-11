"use client";

import { useId, useRef, useState } from "react";

/* =====================================================================
   Lesson figures: drawn to scale from the problem's own numbers.
   Ink blue lines on the page, amber for what the student is looking for.
   ===================================================================== */

const rad = (d: number) => (d * Math.PI) / 180;

/** Triangle from its two base angles, base from (0,0) to (1,0), apex above. */
function triangle(A: number, B: number) {
  const C = 180 - A - B;
  const ac = Math.sin(rad(B)) / Math.sin(rad(C));
  return { a: { x: 0, y: 0 }, b: { x: 1, y: 0 }, c: { x: ac * Math.cos(rad(A)), y: ac * Math.sin(rad(A)) } };
}

type Pt = { x: number; y: number };

function arcPath(v: Pt, p1: Pt, p2: Pt, r: number) {
  const a1 = Math.atan2(p1.y - v.y, p1.x - v.x);
  const a2 = Math.atan2(p2.y - v.y, p2.x - v.x);
  let d = a2 - a1;
  while (d <= -Math.PI) d += 2 * Math.PI;
  while (d > Math.PI) d -= 2 * Math.PI;
  const s = { x: v.x + r * Math.cos(a1), y: v.y + r * Math.sin(a1) };
  const e = { x: v.x + r * Math.cos(a1 + d), y: v.y + r * Math.sin(a1 + d) };
  return `M ${s.x} ${s.y} A ${r} ${r} 0 0 ${d > 0 ? 1 : 0} ${e.x} ${e.y}`;
}
function bisector(v: Pt, p1: Pt, p2: Pt, r: number): Pt {
  const u1 = norm({ x: p1.x - v.x, y: p1.y - v.y });
  const u2 = norm({ x: p2.x - v.x, y: p2.y - v.y });
  const b = norm({ x: u1.x + u2.x, y: u1.y + u2.y });
  return { x: v.x + b.x * r, y: v.y + b.y * r };
}
function norm(p: Pt): Pt {
  const l = Math.hypot(p.x, p.y) || 1;
  return { x: p.x / l, y: p.y / l };
}

export interface TriangleSpec {
  A: number;
  B: number;
  /** Labels per vertex: a number shows "N°", "?" shows the unknown. */
  labels: { A: string; B: string; C: string };
  right?: "A";
  /** Tick marks showing the two base angles are equal. */
  equal?: boolean;
}

/** A triangle drawn to scale in screen coordinates, with angle arcs and labels. */
type Corner = "A" | "B" | "C";

function TriangleSvg({ spec, width = 360, height = 230, onApexDrag, title, lit = {}, onTapCorner }: { spec: TriangleSpec; width?: number; height?: number; onApexDrag?: (p: Pt) => void; title: string; lit?: Partial<Record<Corner, boolean>>; onTapCorner?: (k: Corner) => void }) {
  const t = triangle(spec.A, spec.B);
  const pad = 34;
  // A draggable triangle keeps a fixed frame, so the corner stays under the pointer.
  const minX = onApexDrag ? -0.6 : Math.min(0, t.c.x), maxX = onApexDrag ? 1.6 : Math.max(1, t.c.x);
  const scale = Math.min((width - 2 * pad) / (maxX - minX), (height - 2 * pad) / (onApexDrag ? 1.3 : Math.max(t.c.y, 0.2)));
  const ox = pad - minX * scale + ((width - 2 * pad) - (maxX - minX) * scale) / 2;
  const oy = height - pad;
  const P = (p: Pt): Pt => ({ x: ox + p.x * scale, y: oy - p.y * scale });
  const a = P(t.a), b = P(t.b), c = P(t.c);
  const r = Math.max(16, Math.min(30, scale * 0.12));
  const svgRef = useRef<SVGSVGElement>(null);
  const dragging = useRef(false);
  const id = useId();

  const toModel = (e: React.PointerEvent) => {
    const box = svgRef.current!.getBoundingClientRect();
    const sx = ((e.clientX - box.left) / box.width) * width;
    const sy = ((e.clientY - box.top) / box.height) * height;
    return { x: (sx - ox) / scale, y: (oy - sy) / scale };
  };

  const corner = (v: Pt, p1: Pt, p2: Pt, label: string, isRight: boolean, key: Corner) => {
    const unknown = label === "?";
    const lab = bisector(v, p1, p2, r + 17);
    const tap = onTapCorner
      ? {
          role: "button",
          tabIndex: 0,
          "aria-pressed": !!lit[key],
          "aria-label": `${unknown ? "The missing angle" : `The ${label || "90°"} angle`} — tap to highlight`,
          onClick: () => onTapCorner(key),
          onKeyDown: (e: React.KeyboardEvent) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onTapCorner(key);
            }
          },
        }
      : {};
    return (
      <g key={key} className={`fig-corner ${lit[key] ? "lit" : ""} ${onTapCorner ? "tappable" : ""}`} {...tap}>
        {lit[key] && <path d={`M ${v.x} ${v.y} L ${arcPath(v, p1, p2, r + 4).slice(2)} Z`} className="fig-wedge" />}
        {isRight ? (
          (() => {
            const u1 = norm({ x: p1.x - v.x, y: p1.y - v.y });
            const u2 = norm({ x: p2.x - v.x, y: p2.y - v.y });
            const s = 13;
            return <path d={`M ${v.x + u1.x * s} ${v.y + u1.y * s} L ${v.x + (u1.x + u2.x) * s} ${v.y + (u1.y + u2.y) * s} L ${v.x + u2.x * s} ${v.y + u2.y * s}`} className="fig-arc" fill="none" />;
          })()
        ) : (
          <path d={arcPath(v, p1, p2, r)} className={unknown ? "fig-arc unknown" : "fig-arc"} fill="none" />
        )}
        <text x={lab.x} y={lab.y} className={unknown ? "fig-label unknown" : "fig-label"} textAnchor="middle" dominantBaseline="central">
          {label}
        </text>
      </g>
    );
  };

  const tick = (v: Pt, p1: Pt, p2: Pt) => {
    const m = bisector(v, p1, p2, r);
    const n2 = norm({ x: m.x - v.x, y: m.y - v.y });
    return <line x1={m.x - n2.x * 5} y1={m.y - n2.y * 5} x2={m.x + n2.x * 5} y2={m.y + n2.y * 5} className="fig-tick" />;
  };

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${width} ${height}`}
      className="fig"
      role="img"
      aria-labelledby={`${id}-t`}
      onPointerMove={(e) => {
        if (dragging.current && onApexDrag) onApexDrag(toModel(e));
      }}
      onPointerUp={() => (dragging.current = false)}
      onPointerLeave={() => (dragging.current = false)}
    >
      <title id={`${id}-t`}>{title}</title>
      <polygon points={`${a.x},${a.y} ${b.x},${b.y} ${c.x},${c.y}`} className="fig-shape" />
      {corner(a, b, c, spec.labels.A, spec.right === "A", "A")}
      {corner(b, c, a, spec.labels.B, false, "B")}
      {corner(c, a, b, spec.labels.C, false, "C")}
      {spec.equal && (
        <>
          {tick(a, b, c)}
          {tick(b, c, a)}
        </>
      )}
      {onApexDrag && (
        <circle
          cx={c.x}
          cy={c.y}
          r={11}
          className="fig-handle"
          tabIndex={0}
          role="slider"
          aria-label="Top corner — drag, or use the arrow keys"
          aria-valuetext={`angles ${spec.labels.A}, ${spec.labels.B}, ${spec.labels.C}`}
          onPointerDown={(e) => {
            dragging.current = true;
            (e.target as Element).setPointerCapture?.(e.pointerId);
          }}
          onKeyDown={(e) => {
            const step = 0.03;
            const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[e.key];
            if (d) {
              e.preventDefault();
              onApexDrag({ x: t.c.x + d[0], y: t.c.y + d[1] });
            }
          }}
        />
      )}
    </svg>
  );
}

/**
 * The problem's triangle: givens labelled, the unknown marked "?" until it's solved. Interactive: tap an
 * angle to light it up. `litKnown` lights the known angles (the tutor's "picture" turn), and `sumStrip`
 * shows the 180° the three angles share, with the known part filled — no number for the unknown.
 */
export function TriangleFigure({ data, solved, interactive, litKnown, sumStrip }: { data: Record<string, number | string>; solved?: boolean; interactive?: boolean; litKnown?: boolean; sumStrip?: boolean }) {
  const A = Number(data.A), B = Number(data.B), C = Number(data.C);
  const unknown = String(data.unknown ?? "C");
  const [tapped, setTapped] = useState<Partial<Record<Corner, boolean>>>({});
  const show = (k: Corner, v: number) => (unknown.includes(k) && !solved ? "?" : `${v}°`);
  const spec: TriangleSpec = { A, B, labels: { A: data.right === "A" ? "" : show("A", A), B: show("B", B), C: show("C", C) }, right: data.right === "A" ? "A" : undefined, equal: data.equal === "AB" };
  const desc = `Triangle with angles ${spec.labels.A || "90° (right angle)"}, ${spec.labels.B} and ${spec.labels.C}`.replace(/\?/g, "unknown");
  const known = (["A", "B", "C"] as Corner[]).filter((k) => !unknown.includes(k));
  const lit: Partial<Record<Corner, boolean>> = { ...tapped };
  if (litKnown) for (const k of known) lit[k] = true;
  const knownSum = known.reduce((t, k) => t + (k === "A" ? A : k === "B" ? B : C), 0);
  return (
    <>
      <TriangleSvg spec={spec} title={desc} lit={lit} onTapCorner={interactive ? (k) => setTapped((t) => ({ ...t, [k]: !t[k] })) : undefined} />
      {sumStrip && !solved && <AngleSumStrip parts={known.map((k) => (k === "A" ? A : k === "B" ? B : C))} known={knownSum} />}
    </>
  );
}

/** 180° as a strip shared by the three angles: the known ones filled in, the rest left as "?". */
export function AngleSumStrip({ parts, known }: { parts: number[]; known: number }) {
  let x = 0;
  return (
    <div className="sum-strip" role="img" aria-label={`The three angles share 180°. The known angles, ${parts.map((p) => `${p}°`).join(" and ")}, fill part of it; the rest is the missing angle.`}>
      <div className="sum-bar">
        {parts.map((p, i) => {
          const el = <span key={i} className={`sum-part k${i}`} style={{ left: `${(x / 180) * 100}%`, width: `${(p / 180) * 100}%` }}>{p}°</span>;
          x += p;
          return el;
        })}
        <span className="sum-part rest" style={{ left: `${(known / 180) * 100}%`, width: `${((180 - known) / 180) * 100}%` }}>?</span>
      </div>
      <span className="sum-total">180°</span>
    </div>
  );
}

/** Whole-degree angles that always sum to exactly 180 (largest-remainder rounding of the true angles). */
function wholeAngles(a: number, b: number, c: number): [number, number, number] {
  const raw = [a, b, c];
  const floors = raw.map(Math.floor);
  let rest = 180 - floors.reduce((s, x) => s + x, 0);
  const order = raw.map((x, i) => ({ i, f: x - Math.floor(x) })).sort((p, q) => q.f - p.f);
  for (const { i } of order) if (rest-- > 0) floors[i] += 1;
  return floors as [number, number, number];
}

/** Drag the top corner: the angles change, their total doesn't. */
export function TriangleExplorer() {
  const [apex, setApex] = useState<Pt>({ x: 0.35, y: 0.62 });
  const ang = (p: Pt, q: Pt, r: Pt) => {
    const u = { x: q.x - p.x, y: q.y - p.y }, v = { x: r.x - p.x, y: r.y - p.y };
    return (Math.acos((u.x * v.x + u.y * v.y) / (Math.hypot(u.x, u.y) * Math.hypot(v.x, v.y))) * 180) / Math.PI;
  };
  const A0 = ang({ x: 0, y: 0 }, { x: 1, y: 0 }, apex);
  const B0 = ang({ x: 1, y: 0 }, apex, { x: 0, y: 0 });
  const [A, B, C] = wholeAngles(A0, B0, 180 - A0 - B0);
  return (
    <div className="explore">
      <TriangleSvg
        spec={{ A: A0, B: B0, labels: { A: `${A}°`, B: `${B}°`, C: `${C}°` } }}
        width={320}
        height={200}
        title={`A triangle you can reshape: angles ${A}°, ${B}° and ${C}°`}
        onApexDrag={(p) => setApex({ x: Math.max(-0.6, Math.min(1.6, p.x)), y: Math.max(0.12, Math.min(1.3, p.y)) })}
      />
      <p className="explore-sum" aria-live="polite">
        <span className="serif">{A}° + {B}° + {C}° = 180°</span>
      </p>
    </div>
  );
}

/* ---------------- Forces ---------------- */

export interface ForceSpec {
  right: number;
  left: number;
  /** Which force is the unknown ("right" = an extra push to the right, shown dashed with "?"). */
  missing?: "right";
  /** Already moving to the right at this speed (m/s). */
  moving?: number;
}

/**
 * A box on the floor with force arrows drawn to scale. With `onTap`, each push is a button (the tutor asked
 * "tap the stronger force"). With `showNet`, the net force is drawn under the box and the box drifts that
 * way — the size of the drift follows the net force (reduced-motion: no drift).
 */
export function ForceFigure({ spec, title, compact, onTap, glow, showNet }: { spec: ForceSpec; title?: string; compact?: boolean; onTap?: (dir: "right" | "left") => void; glow?: "right" | "left"; showNet?: boolean }) {
  const W = compact ? 300 : 380, H = compact ? 150 : 180;
  const id = useId();
  const max = Math.max(spec.right, spec.left, 1);
  const len = (f: number) => 22 + (f / max) * (compact ? 78 : 100);
  const boxW = 64, boxH = 50;
  const cx = W / 2, floor = H - 34;
  const by = floor - boxH;
  const ay = by + boxH / 2;
  const rx = cx + boxW / 2, lx = cx - boxW / 2;
  const missingLen = spec.missing ? len(Math.max(spec.left - spec.right, 1)) : 0;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="fig" role="img" aria-labelledby={`${id}-t`}>
      <title id={`${id}-t`}>{title ?? `A box with ${spec.right} N pushing right and ${spec.left} N pushing left${spec.missing ? ", and an unknown extra push to the right" : ""}${spec.moving ? `, already moving right at ${spec.moving} m/s` : ""}`}</title>
      <defs>
        <marker id={`${id}-h`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" className="fig-head" />
        </marker>
        <marker id={`${id}-hu`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" className="fig-head unknown" />
        </marker>
      </defs>
      <line x1={16} y1={floor} x2={W - 16} y2={floor} className="fig-floor" />
      <g className="fig-box" style={showNet ? { transform: `translateX(${Math.max(-48, Math.min(48, (spec.right - spec.left) * 3))}px)` } : undefined}>
        <rect x={lx} y={by} width={boxW} height={boxH} rx={3} className="fig-shape" />
      </g>
      {showNet && spec.right !== spec.left && (
        <g className="fig-net">
          <line x1={cx} y1={floor + 16} x2={cx + Math.sign(spec.right - spec.left) * len(Math.abs(spec.right - spec.left))} y2={floor + 16} markerEnd={`url(#${id}-hu)`} />
          <text x={cx + Math.sign(spec.right - spec.left) * (len(Math.abs(spec.right - spec.left)) + 26)} y={floor + 16} dominantBaseline="central" textAnchor="middle" className="fig-label unknown">net</text>
        </g>
      )}
      {spec.moving ? (
        <g className="fig-motion">
          <line x1={cx - 22} y1={by - 16} x2={cx + 22} y2={by - 16} markerEnd={`url(#${id}-h)`} />
          <text x={cx} y={by - 28} textAnchor="middle" className="fig-note">{spec.moving} m/s</text>
        </g>
      ) : null}
      {/* right push: drawn from the right face outwards → arrow points right */}
      <Push dir="right" x1={rx} x2={rx + len(spec.right)} y={ay} n={spec.right} head={`url(#${id}-h)`} onTap={onTap} glow={glow === "right"} />
      <Push dir="left" x1={lx} x2={lx - len(spec.left)} y={ay} n={spec.left} head={`url(#${id}-h)`} onTap={onTap} glow={glow === "left"} />
      {spec.missing && (
        <>
          <line x1={rx} y1={ay + 16} x2={rx + missingLen} y2={ay + 16} className="fig-force unknown" markerEnd={`url(#${id}-hu)`} />
          <text x={rx + missingLen + 14} y={ay + 16} dominantBaseline="central" className="fig-label unknown">?</text>
        </>
      )}
    </svg>
  );
}

function Push({ dir, x1, x2, y, n, head, onTap, glow }: { dir: "right" | "left"; x1: number; x2: number; y: number; n: number; head: string; onTap?: (d: "right" | "left") => void; glow?: boolean }) {
  const lo = Math.min(x1, x2), w = Math.abs(x2 - x1);
  const tap = onTap
    ? {
        role: "button",
        tabIndex: 0,
        "aria-label": `The ${n} newton push to the ${dir}`,
        onClick: () => onTap(dir),
        onKeyDown: (e: React.KeyboardEvent) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onTap(dir);
          }
        },
      }
    : {};
  return (
    <g className={`fig-push ${onTap ? "tappable" : ""} ${glow ? "glow" : ""}`} {...tap}>
      {onTap && <rect x={lo - 6} y={y - 30} width={w + 16} height={46} rx={8} className="fig-hit" />}
      <line x1={x1} y1={y} x2={x2} y2={y} className="fig-force" markerEnd={head} />
      <text x={(x1 + x2) / 2} y={y - 12} textAnchor="middle" className="fig-label">{n} N</text>
    </g>
  );
}

/**
 * A two-pan balance drawn from the current equation a·x + b = c (whole numbers, b ≥ 0): a bags of x and
 * b blocks on the left, c blocks on the right. `highlight` marks the b blocks on BOTH pans — what the tutor
 * suggests taking off each side. Nothing here is computed beyond what the equation already says.
 */
export function BalanceFigure({ a, b, c, highlight = true }: { a: number; b: number; c: number; highlight?: boolean }) {
  const id = useId();
  const W = 420, H = 210;
  const beamY = 70, cx = W / 2, panW = 170;
  const lPan = cx - 110, rPan = cx + 110;
  const blk = 13, gap = 3, perRow = 8;
  const blocks = (n: number, x0: number, yBase: number, marked: number, key: string) =>
    Array.from({ length: n }, (_, i) => {
      const row = Math.floor(i / perRow), col = i % perRow;
      return <rect key={`${key}${i}`} x={x0 + col * (blk + gap)} y={yBase - (row + 1) * (blk + gap)} width={blk} height={blk} rx={2} className={`bal-block ${i < marked ? "marked" : ""}`} />;
    });
  const bagW = 30;
  const bags = Array.from({ length: a }, (_, i) => (
    <g key={`bag${i}`} className="bal-bag">
      <rect x={lPan - panW / 2 + 8 + i * (bagW + 4)} y={beamY + 92 - 34} width={bagW} height={32} rx={9} />
      <text x={lPan - panW / 2 + 8 + i * (bagW + 4) + bagW / 2} y={beamY + 92 - 16} textAnchor="middle" dominantBaseline="central">x</text>
    </g>
  ));
  const leftBlocksX = lPan - panW / 2 + 8 + a * (bagW + 4) + 4;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="fig balance" role="img" aria-labelledby={`${id}-t`}>
      <title id={`${id}-t`}>{`A level balance: ${a} bag${a === 1 ? "" : "s"} of x and ${b} block${b === 1 ? "" : "s"} on the left, ${c} blocks on the right.${highlight && b ? ` The ${b} blocks on each side are marked.` : ""}`}</title>
      <polygon points={`${cx - 16},${H - 14} ${cx + 16},${H - 14} ${cx},${beamY + 6}`} className="bal-stand" />
      <line x1={lPan} y1={beamY} x2={rPan} y2={beamY} className="bal-beam" />
      <circle cx={cx} cy={beamY} r={5} className="bal-pivot" />
      {[lPan, rPan].map((x, i) => (
        <g key={i}>
          <line x1={x} y1={beamY} x2={x - panW / 2 + 10} y2={beamY + 92} className="bal-string" />
          <line x1={x} y1={beamY} x2={x + panW / 2 - 10} y2={beamY + 92} className="bal-string" />
          <line x1={x - panW / 2} y1={beamY + 92} x2={x + panW / 2} y2={beamY + 92} className="bal-pan" />
        </g>
      ))}
      {bags}
      {blocks(b, leftBlocksX, beamY + 92, highlight ? b : 0, "l")}
      {blocks(c, rPan - panW / 2 + 12, beamY + 92, highlight ? b : 0, "r")}
      <text x={lPan} y={beamY + 112} textAnchor="middle" className="fig-note">{`${a === 1 ? "x" : `${a}x`}${b ? ` + ${b}` : ""}`}</text>
      <text x={rPan} y={beamY + 112} textAnchor="middle" className="fig-note">{c}</text>
    </svg>
  );
}

/** Set two pushes and see the net force and what it does. */
export function ForceExplorer() {
  const [right, setRight] = useState(10);
  const [left, setLeft] = useState(6);
  const net = right - left;
  const verdict = net === 0 ? "Balanced: the net force is 0 N, so the motion doesn't change — still stays still, moving keeps moving at the same speed." : `Unbalanced: the net force is ${Math.abs(net)} N to the ${net > 0 ? "right" : "left"}, so the motion changes in that direction.`;
  return (
    <div className="explore">
      <ForceFigure spec={{ right, left }} compact showNet />
      <div className="explore-sliders">
        <label>
          <span>Push left</span>
          <input type="range" min={0} max={20} value={left} onChange={(e) => setLeft(Number(e.target.value))} aria-valuetext={`${left} newtons`} />
          <output>{left} N</output>
        </label>
        <label>
          <span>Push right</span>
          <input type="range" min={0} max={20} value={right} onChange={(e) => setRight(Number(e.target.value))} aria-valuetext={`${right} newtons`} />
          <output>{right} N</output>
        </label>
      </div>
      <p className="explore-sum" aria-live="polite">{verdict}</p>
    </div>
  );
}

// Single-series bar chart: thin bars, rounded data ends, recessive axis, tap/hover for exact values.
import { useState } from 'react';

export interface Bar {
  label: string; // axis label (shown sparsely)
  value: number;
  tip: string; // full tooltip text
}

export function BarChart({ bars, ariaLabel, every = 7 }: { bars: Bar[]; ariaLabel: string; every?: number }) {
  const [active, setActive] = useState<number | null>(null);
  const W = 640, H = 170, top = 22, bottom = 22;
  const max = Math.max(1, ...bars.map((b) => b.value));
  const slot = W / bars.length;
  const bw = Math.max(3, Math.min(18, slot - 3));
  const y = (v: number) => top + (H - top - bottom) * (1 - v / max);
  const base = H - bottom;
  const shown = active ?? null;
  return (
    <div className="chart" onMouseLeave={() => setActive(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={ariaLabel}>
        <line className="axis" x1={0} x2={W} y1={base + 0.5} y2={base + 0.5} />
        <text x={0} y={12}>{max.toLocaleString()}</text>
        <line className="axis" x1={0} x2={W} y1={top + 0.5} y2={top + 0.5} strokeDasharray="2 4" />
        {bars.map((b, i) => {
          const x = i * slot + (slot - bw) / 2;
          const h = Math.max(0, base - y(b.value));
          const r = Math.min(4, bw / 2, h);
          return (
            <g key={i}>
              {b.value > 0 && (
                <path
                  className={'bar' + (shown !== null && shown !== i ? ' dim' : '')}
                  d={`M${x},${base} V${base - h + r} Q${x},${base - h} ${x + r},${base - h} H${x + bw - r} Q${x + bw},${base - h} ${x + bw},${base - h + r} V${base} Z`}
                />
              )}
              {i % every === 0 && (
                <text x={i * slot + slot / 2} y={H - 6} textAnchor="middle">
                  {b.label}
                </text>
              )}
              <rect x={i * slot} y={0} width={slot} height={H} fill="transparent" onMouseEnter={() => setActive(i)} onClick={() => setActive(active === i ? null : i)}>
                <title>{b.tip}</title>
              </rect>
            </g>
          );
        })}
        {shown !== null && (
          <text className="tip" x={Math.min(W - 4, Math.max(4, shown * slot + slot / 2))} y={Math.max(12, y(bars[shown].value) - 6)} textAnchor={shown < 3 ? 'start' : shown > bars.length - 4 ? 'end' : 'middle'}>
            {bars[shown].tip}
          </text>
        )}
      </svg>
    </div>
  );
}

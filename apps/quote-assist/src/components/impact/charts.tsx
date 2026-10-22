"use client";

import { useEffect, useId, useRef, useState } from "react";
import { formatKpiValue, type ValueKind } from "@/lib/impact/definitions";
import { formatNumber } from "@/lib/format";

// 効果測定のグラフ。形の選び方・色・マークの太さ・ホバーは dataviz の手順に従う。
//  - 推移は折れ線(線2px・点は直径8px以上で2pxの面色の縁取り)。系列は導入後の1本+導入前の基準線(破線・直接ラベル)
//  - 件数が少ない(参考値)の点は、中を抜いた○で描く(色だけに頼らない)
//  - 項目別の採用率は横棒(名義カテゴリなので1色、太さ12px、先端4px丸め、値は棒の先に)
//  - どのグラフも「表で見る」の表を持つ。ホバーの内容はキーボード(左右の矢印)でも同じに出る

export type TrendPoint = {
  key: string;
  label: string;
  longLabel: string;
  value: number | null;
  n: number;
  reference: boolean;
};

const HEIGHT = 200;
const MARGIN = { top: 12, right: 12, bottom: 26, left: 44 };
const NICE_STEPS = [0.1, 0.2, 0.25, 0.5, 1, 2, 2.5, 5, 10];

/** データの最大値を4等分したときに、目盛りがきれいな数になる上限 */
function niceDomain(max: number): { max: number; step: number } {
  const target = Math.max(max, 1e-9) * 1.05;
  const raw = target / 4;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = (NICE_STEPS.find((s) => s * pow >= raw) ?? 10) * pow;
  return { max: step * 4, step };
}

function tickLabel(kind: ValueKind, v: number): string {
  if (kind === "percent") return `${Math.round(v * 100)}%`;
  if (kind === "days") return formatNumber(v, 1);
  if (kind === "count") return formatNumber(v, 2);
  return formatNumber(v, 0);
}

function useWidth(initial: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(initial);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setWidth(Math.max(240, Math.floor(el.clientWidth)));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, width };
}

function Tooltip({ children, style }: { children: React.ReactNode; style: React.CSSProperties }) {
  return (
    <div
      aria-hidden="true"
      className="no-print pointer-events-none absolute z-10 w-max max-w-[15rem] rounded-lg border border-line-strong bg-surface px-3 py-2 text-xs shadow-md"
      style={style}
    >
      {children}
    </div>
  );
}

export function TrendChart({
  title,
  subtitle,
  kind,
  points,
  baseline,
  testId,
}: {
  title: string;
  subtitle?: string;
  kind: ValueKind;
  points: TrendPoint[];
  /** 導入前の値(基準線)。なければ線を引かない */
  baseline: { value: number | null; n: number } | null;
  testId?: string;
}) {
  const { ref, width } = useWidth(480);
  const [active, setActive] = useState<number | null>(null);
  const descId = useId();

  const plotW = width - MARGIN.left - MARGIN.right;
  const plotH = HEIGHT - MARGIN.top - MARGIN.bottom;
  const n = points.length;
  const values = points.map((p) => p.value).filter((v): v is number => v !== null);
  const baseValue = baseline?.value ?? null;
  const dataMax = Math.max(0, ...values, baseValue ?? 0);
  let { max: yMax, step } = niceDomain(dataMax);
  if (kind === "percent" && yMax > 1) {
    yMax = 1;
    step = 0.25;
  }
  const y = (v: number) => MARGIN.top + plotH - (Math.min(v, yMax) / yMax) * plotH;
  const x = (i: number) => MARGIN.left + (n === 0 ? 0 : ((i + 0.5) * plotW) / n);
  const ticks = [0, 1, 2, 3, 4].map((i) => i * step);

  // 値のある連続した区間ごとに線を引く(値のない期間では途切れる)
  const segments: number[][] = [];
  points.forEach((p, i) => {
    if (p.value === null) return;
    const last = segments[segments.length - 1];
    if (last && last[last.length - 1] === i - 1) last.push(i);
    else segments.push([i]);
  });

  const maxLabels = Math.max(2, Math.floor(plotW / 44));
  const labelEvery = Math.ceil(n / maxLabels);

  const onPointerMove = (e: React.PointerEvent<SVGRectElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const i = Math.min(n - 1, Math.max(0, Math.floor(((e.clientX - rect.left) / rect.width) * n)));
    setActive(i);
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (n === 0) return;
    const move = (to: number) => {
      e.preventDefault();
      setActive(Math.min(n - 1, Math.max(0, to)));
    };
    if (e.key === "ArrowRight") move((active ?? -1) + 1);
    else if (e.key === "ArrowLeft") move((active ?? n) - 1);
    else if (e.key === "Home") move(0);
    else if (e.key === "End") move(n - 1);
    else if (e.key === "Escape") setActive(null);
  };

  const p = active !== null ? points[active] : null;
  const flip = active !== null && x(active) > width * 0.55;

  return (
    <figure className="min-w-0 space-y-2" data-testid={testId}>
      <figcaption className="space-y-0.5">
        <h3 className="font-semibold">{title}</h3>
        {subtitle && <p className="text-xs text-muted">{subtitle}</p>}
      </figcaption>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2" aria-label="凡例">
        <li className="flex items-center gap-1.5">
          <svg width="20" height="10" aria-hidden="true">
            <line x1="0" y1="5" x2="20" y2="5" className="stroke-series-1" strokeWidth="2" strokeLinecap="round" />
            <circle cx="10" cy="5" r="3.5" className="fill-series-1 stroke-surface" strokeWidth="1.5" />
          </svg>
          導入後(試験導入)
        </li>
        {baseline && (
          <li className="flex items-center gap-1.5">
            <svg width="20" height="10" aria-hidden="true">
              <line x1="0" y1="5" x2="20" y2="5" className="stroke-muted" strokeWidth="1.5" strokeDasharray="4 3" />
            </svg>
            導入前(ベースライン)
          </li>
        )}
        <li className="flex items-center gap-1.5">
          <svg width="12" height="10" aria-hidden="true">
            <circle cx="6" cy="5" r="3.5" className="fill-surface stroke-series-1" strokeWidth="2" />
          </svg>
          参考値(件数が少ない)
        </li>
      </ul>

      <div
        ref={ref}
        className="relative rounded-md focus-visible:outline-2 focus-visible:outline-accent"
        tabIndex={0}
        role="group"
        aria-label={`${title}のグラフ。左右の矢印キーで期間を選ぶと、値を読み上げます`}
        aria-describedby={descId}
        onKeyDown={onKeyDown}
        onFocus={() => n > 0 && setActive((a) => a ?? n - 1)}
        onBlur={() => setActive(null)}
        onPointerLeave={(e) => e.pointerType === "mouse" && setActive(null)}
      >
        <svg width={width} height={HEIGHT} role="presentation" className="block select-none">
          {/* 目盛りの横線(1pxの実線・控えめ) */}
          {ticks.map((t) => (
            <g key={t}>
              <line x1={MARGIN.left} x2={width - MARGIN.right} y1={y(t)} y2={y(t)} className={t === 0 ? "stroke-line-strong" : "stroke-grid"} strokeWidth="1" />
              <text x={MARGIN.left - 6} y={y(t) + 4} textAnchor="end" className="fill-muted text-[11px] tabular-nums">
                {tickLabel(kind, t)}
              </text>
            </g>
          ))}
          {points.map((pt, i) =>
            i % labelEvery === 0 ? (
              <text key={pt.key} x={x(i)} y={HEIGHT - 8} textAnchor="middle" className="fill-muted text-[11px]">
                {pt.label}
              </text>
            ) : null,
          )}

          {baseValue !== null && (
            <g>
              <line x1={MARGIN.left} x2={width - MARGIN.right} y1={y(baseValue)} y2={y(baseValue)} className="stroke-muted" strokeWidth="1.5" strokeDasharray="4 3" />
              <text
                x={width - MARGIN.right - 4}
                y={y(baseValue) - 5}
                textAnchor="end"
                className="fill-ink-2 stroke-surface text-[11px]"
                strokeWidth="3"
                paintOrder="stroke"
              >
                導入前 {formatKpiValue(kind, baseValue)}
              </text>
            </g>
          )}

          {active !== null && <line x1={x(active)} x2={x(active)} y1={MARGIN.top} y2={MARGIN.top + plotH} className="stroke-line-strong" strokeWidth="1" />}

          {segments.map((seg) =>
            seg.length > 1 ? (
              <polyline
                key={seg[0]}
                points={seg.map((i) => `${x(i)},${y(points[i].value!)}`).join(" ")}
                fill="none"
                className="stroke-series-1"
                strokeWidth="2"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            ) : null,
          )}
          {points.map((pt, i) =>
            pt.value === null ? null : pt.reference ? (
              <circle key={pt.key} cx={x(i)} cy={y(pt.value)} r={active === i ? 5.5 : 4.5} className="fill-surface stroke-series-1" strokeWidth="2" />
            ) : (
              <circle key={pt.key} cx={x(i)} cy={y(pt.value)} r={active === i ? 5.5 : 4.5} className="fill-series-1 stroke-surface" strokeWidth="2" />
            ),
          )}

          {/* ポインタを受ける面。点より大きく、期間の幅いっぱいを当たり判定にする */}
          <rect x={MARGIN.left} y={MARGIN.top} width={plotW} height={plotH} fill="transparent" onPointerMove={onPointerMove} onPointerDown={onPointerMove} />
        </svg>

        {p && (
          <Tooltip style={{ top: 8, ...(flip ? { right: width - x(active!) + 12 } : { left: x(active!) + 12 }) }}>
            <p className="text-ink-2">{p.longLabel}</p>
            <p className="mt-0.5 text-base font-bold tabular-nums">
              {p.value === null ? "対象なし" : formatKpiValue(kind, p.value)}
              {p.reference && <span className="ml-2 rounded border border-line-strong px-1 text-xs font-medium text-ink-2">参考値</span>}
            </p>
            {baseValue !== null && (
              <p className="mt-0.5 flex items-center gap-1.5 text-ink-2">
                <svg width="14" height="8" aria-hidden="true">
                  <line x1="0" y1="4" x2="14" y2="4" className="stroke-muted" strokeWidth="1.5" strokeDasharray="3 2" />
                </svg>
                導入前 {formatKpiValue(kind, baseValue)}
              </p>
            )}
            <p className="text-ink-2">値に使えた件数 {p.n}件</p>
          </Tooltip>
        )}
      </div>
      <p id={descId} className="sr-only" aria-live="polite">
        {p ? `${p.longLabel}:${p.value === null ? "対象なし" : formatKpiValue(kind, p.value)}、件数${p.n}件${p.reference ? "、参考値" : ""}` : ""}
      </p>

      <details className="no-print text-sm">
        <summary className="cursor-pointer text-accent-ink hover:underline">表で見る</summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[320px] text-xs" aria-label={`${title}の表`}>
            <thead className="text-left text-ink-2">
              <tr className="border-b border-line">
                <th className="py-1 pr-3 font-medium">期間</th>
                <th className="py-1 pr-3 text-right font-medium">値</th>
                <th className="py-1 pr-3 text-right font-medium">件数</th>
                <th className="py-1 font-medium">備考</th>
              </tr>
            </thead>
            <tbody>
              {points.map((pt) => (
                <tr key={pt.key} className="border-b border-line last:border-0">
                  <td className="py-1 pr-3">{pt.longLabel}</td>
                  <td className="py-1 pr-3 text-right tabular-nums">{pt.value === null ? "—" : formatKpiValue(kind, pt.value)}</td>
                  <td className="py-1 pr-3 text-right tabular-nums">{pt.n}</td>
                  <td className="py-1">{pt.value === null ? "対象なし" : pt.reference ? "参考値" : ""}</td>
                </tr>
              ))}
              {baseValue !== null && (
                <tr className="border-t border-line-strong">
                  <td className="py-1 pr-3">導入前(ベースライン)</td>
                  <td className="py-1 pr-3 text-right tabular-nums">{formatKpiValue(kind, baseValue)}</td>
                  <td className="py-1 pr-3 text-right tabular-nums">{baseline?.n}</td>
                  <td className="py-1" />
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}

// ---- 項目別の採用率(横棒) ----

export type AdoptionBarRow = {
  item: string;
  label: string;
  group: "extraction" | "quote";
  evaluated: number;
  modified: number;
  adoptedRate: number | null;
};

export function AdoptionBars({ rows, groupLabels }: { rows: AdoptionBarRow[]; groupLabels: Record<"extraction" | "quote", string> }) {
  const [active, setActive] = useState<string | null>(null);

  return (
    <div className="space-y-5" data-testid="adoption-bars">
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2" aria-label="凡例">
        <li className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-4 rounded-sm bg-series-1" aria-hidden="true" />
          人が変えずに採用した割合(採用率)
        </li>
        <li className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-4 rounded-sm bg-surface-2 ring-1 ring-line-strong" aria-hidden="true" />
          人が修正した割合(修正率)
        </li>
      </ul>
      {(["extraction", "quote"] as const).map((g) => {
        const list = rows.filter((r) => r.group === g).sort((a, b) => (a.adoptedRate ?? 2) - (b.adoptedRate ?? 2));
        if (list.length === 0) return null;
        return (
          <div key={g} className="space-y-1.5">
            <h4 className="text-sm font-semibold">{groupLabels[g]}</h4>
            <ul>
              {list.map((r) => {
                const pct = r.adoptedRate === null ? 0 : r.adoptedRate * 100;
                const on = active === r.item;
                return (
                  <li
                    key={r.item}
                    className="relative grid grid-cols-[minmax(6.5rem,11rem)_1fr_3rem] items-center gap-x-3 rounded-md py-1 focus-visible:outline-2 focus-visible:outline-accent sm:grid-cols-[13rem_1fr_3.5rem]"
                    tabIndex={0}
                    aria-label={`${r.label}:採用率${r.adoptedRate === null ? "対象なし" : `${Math.round(pct)}%`}、評価${r.evaluated}件のうち修正${r.modified}件`}
                    onPointerEnter={() => setActive(r.item)}
                    onPointerLeave={() => setActive(null)}
                    onFocus={() => setActive(r.item)}
                    onBlur={() => setActive(null)}
                  >
                    <span className="text-sm text-ink-2">{r.label}</span>
                    {/* 棒は12px。右端だけ4px丸め、左(基準線)は直角。未充填部は修正率 */}
                    <span className="block h-3 w-full rounded-r bg-surface-2" aria-hidden="true">
                      <span
                        className={`block h-3 rounded-r-[4px] ${on ? "bg-series-1-hover" : "bg-series-1"}`}
                        style={{ width: `${Math.max(pct, r.adoptedRate === null ? 0 : 1)}%` }}
                      />
                    </span>
                    <span className="text-right text-sm font-semibold tabular-nums">{r.adoptedRate === null ? "—" : `${Math.round(pct)}%`}</span>
                    {on && (
                      <Tooltip style={{ top: "100%", left: "13rem" }}>
                        <p className="font-semibold">{r.label}</p>
                        <p className="text-base font-bold tabular-nums">採用率 {r.adoptedRate === null ? "—" : `${Math.round(pct)}%`}</p>
                        <p className="text-ink-2">修正率 {r.adoptedRate === null ? "—" : `${Math.round(100 - pct)}%`}</p>
                        <p className="text-ink-2">
                          評価 {r.evaluated}件・修正 {r.modified}件
                        </p>
                      </Tooltip>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
      <details className="no-print text-sm">
        <summary className="cursor-pointer text-accent-ink hover:underline">表で見る</summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[420px] text-xs" aria-label="項目別の採用率・修正率の表">
            <thead className="text-left text-ink-2">
              <tr className="border-b border-line">
                <th className="py-1 pr-3 font-medium">項目</th>
                <th className="py-1 pr-3 text-right font-medium">評価した数</th>
                <th className="py-1 pr-3 text-right font-medium">修正した数</th>
                <th className="py-1 pr-3 text-right font-medium">採用率</th>
                <th className="py-1 text-right font-medium">修正率</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.item} className="border-b border-line last:border-0">
                  <td className="py-1 pr-3">{r.label}</td>
                  <td className="py-1 pr-3 text-right tabular-nums">{r.evaluated}</td>
                  <td className="py-1 pr-3 text-right tabular-nums">{r.modified}</td>
                  <td className="py-1 pr-3 text-right tabular-nums">{r.adoptedRate === null ? "—" : `${Math.round(r.adoptedRate * 100)}%`}</td>
                  <td className="py-1 text-right tabular-nums">{r.adoptedRate === null ? "—" : `${Math.round((1 - r.adoptedRate) * 100)}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

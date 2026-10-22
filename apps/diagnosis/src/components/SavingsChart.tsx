"use client";

import { useState } from "react";
import type { TaskResult } from "@/lib/diagnosis/calculate";
import { formatHours, formatYen } from "@/lib/format";

type Props = {
  tasks: TaskResult[];
  topIds: Set<string>;
};

// 業務別の年間削減見込み額。単一系列なので凡例は置かず、見出しで内容を示す。
export function SavingsChart({ tasks, topIds }: Props) {
  // ホバーとフォーカスは別に持つ。スクロールでポインターが棒から外れても、
  // キーボードでフォーカスした棒のツールチップは消さない
  const [hovered, setHovered] = useState<string | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const active = hovered ?? focused;
  const max = Math.max(...tasks.map((t) => t.annualSavedAmount), 1);
  const sorted = [...tasks].sort(
    (a, b) => b.annualSavedAmount - a.annualSavedAmount,
  );

  return (
    <ul className="space-y-3" aria-label="業務別の年間削減見込み額">
      {sorted.map((t) => {
        const ratio = t.annualSavedAmount / max;
        const barEnd = `calc((100% - 5.5rem) * ${ratio})`;
        const isActive = active === t.taskId;
        return (
          <li
            key={t.taskId}
            className="relative grid grid-cols-[minmax(0,9rem)_1fr] items-center gap-3 sm:grid-cols-[minmax(0,13rem)_1fr]"
          >
            <span className="truncate text-sm text-ink-2" title={t.name}>
              {topIds.has(t.taskId) && (
                <span className="mr-1 rounded bg-accent-soft px-1.5 py-0.5 text-xs font-medium text-ink">
                  優先
                </span>
              )}
              {t.name}
            </span>
            <div
              tabIndex={0}
              role="img"
              aria-label={`${t.name}: 年間${formatYen(t.annualSavedAmount)}、月${formatHours(t.monthlySavedHours)}の削減見込み`}
              className="group flex h-7 cursor-default items-center gap-2 outline-none"
              onPointerEnter={() => setHovered(t.taskId)}
              onPointerLeave={() => setHovered(null)}
              onFocus={() => setFocused(t.taskId)}
              onBlur={() => setFocused(null)}
            >
              <div
                className={`h-5 rounded-r-[4px] transition-colors ${
                  isActive ? "bg-series-1-hover" : "bg-series-1"
                } group-focus-visible:outline-2 group-focus-visible:outline-offset-2 group-focus-visible:outline-accent`}
                // 右側に金額ラベルの幅(5.5rem)を残して比例させる
                style={{ width: `max(2px, ${barEnd})` }}
              />
              <span className="shrink-0 text-sm font-medium tabular-nums text-ink">
                {formatYen(t.annualSavedAmount)}
              </span>
            </div>
            {isActive && (
              <div className="pointer-events-none absolute inset-x-0 top-full z-10 grid grid-cols-[minmax(0,9rem)_1fr] gap-3 sm:grid-cols-[minmax(0,13rem)_1fr]">
                <div />
                <div
                  role="tooltip"
                  // 幅を16rem(と表示枠)までに抑え、フォントの字幅で長くなっても折り返してはみ出さないようにする
                  className="w-fit max-w-[min(16rem,100%)] rounded-md border border-line bg-surface px-3 py-2 text-sm shadow-md"
                  style={{ marginLeft: `max(0px, min(${barEnd}, calc(100% - 16rem)))` }}
                >
                  <span className="font-semibold text-ink">
                    月 {formatHours(t.monthlySavedHours)}
                  </span>
                  <span className="text-ink-2">
                    {" "}の削減(現在 月{formatHours(t.monthlyHours)})
                  </span>
                </div>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

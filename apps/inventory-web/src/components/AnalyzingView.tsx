"use client";

import { useEffect, useState } from "react";
import type { Phase } from "@/worker/protocol";
import { PrivacyBadge } from "./PrivacyBadge";
import { buttonSecondary, Card } from "./ui";

const STEPS: { phase: Phase; label: string }[] = [
  { phase: "reading", label: "読み込み" },
  { phase: "analyzing", label: "解析" },
  { phase: "rendering", label: "仕様書の作成" },
];

export function AnalyzingView({
  fileName,
  phase,
  startedAt,
  index,
  total,
  onCancel,
}: {
  fileName: string;
  phase: Phase | "waiting";
  startedAt: number;
  /** 何件目か(複数ファイルのとき) */
  index: number;
  total: number;
  onCancel: () => void;
}) {
  const [now, setNow] = useState(startedAt);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const current = STEPS.findIndex((s) => s.phase === phase);
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  return (
    <Card className="mt-2">
      <div role="status" aria-live="polite">
        <h2 className="text-lg font-bold">
          <span className="break-all">{fileName}</span> を解析しています{total > 1 ? `(${index}/${total} 件目)` : ""}
        </h2>
        <ol className="mt-4 flex flex-wrap gap-2 text-sm" aria-label="解析の段階">
          {STEPS.map((s, i) => (
            <li
              key={s.phase}
              aria-current={i === current ? "step" : undefined}
              className={`rounded-full border px-3 py-1 ${
                i < current ? "border-good bg-good-soft text-good" : i === current ? "border-accent bg-accent-soft font-semibold text-accent-ink" : "border-line text-muted"
              }`}
            >
              {i + 1}. {s.label}
              {i < current ? "(完了)" : ""}
            </li>
          ))}
        </ol>
        <p className="mt-3 text-sm text-ink-2">
          経過 {seconds} 秒。ファイルの大きさによっては、最大60秒ほどかかることがあります。
        </p>
        {total > 1 && <p className="mt-1 text-sm text-ink-2">複数のファイルは1件ずつ順番に解析します。途中で中止しても、終わった分の結果は残ります。1件が解析できなくても、残りは続けます。</p>}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="button" className={buttonSecondary} onClick={onCancel}>
          中止
        </button>
        <PrivacyBadge />
      </div>
    </Card>
  );
}

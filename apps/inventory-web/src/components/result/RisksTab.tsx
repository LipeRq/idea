"use client";

import { useState } from "react";
import type { FindingView } from "@/worker/protocol";
import { ShowMore } from "../ShowMore";
import { SeverityBadge } from "../ui";

function Locations({ locations }: { locations: string[] }) {
  const [open, setOpen] = useState(false);
  if (locations.length === 0) return null;
  const head = locations.slice(0, 5);
  return (
    <div className="mt-2 text-sm">
      <p className="text-ink-2">場所:</p>
      {open ? (
        <ShowMore items={locations} label="場所" className="mt-1 list-disc space-y-0.5 pl-5" render={(l, i) => <li key={i} className="break-all">{l}</li>} />
      ) : (
        <>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {head.map((l, i) => (
              <li key={i} className="break-all">
                {l}
              </li>
            ))}
          </ul>
          {locations.length > head.length && (
            <button type="button" className="mt-1 text-accent-ink underline underline-offset-2" onClick={() => setOpen(true)}>
              ほか {locations.length - head.length} 件を表示
            </button>
          )}
        </>
      )}
    </div>
  );
}

export function RisksTab({ findings }: { findings: FindingView[] }) {
  if (findings.length === 0) return <p>機械的なルールで検出したリスクはありません。</p>;
  return (
    <div>
      <p className="text-sm text-ink-2">
        解析結果から機械的なルールで見つけた、保守・移行で問題になりやすい点です。重要度「高」は、止まったときの影響が大きい・環境の変化で動かなくなるおそれがあるものです。
      </p>
      <ShowMore
        items={findings}
        label="リスク"
        className="mt-4 space-y-3"
        render={(f) => (
          <li key={f.ruleId} className="rounded-xl border border-line bg-surface p-4">
            <div className="flex flex-wrap items-center gap-2">
              <SeverityBadge severity={f.severity} label={f.severityLabel} />
              <h3 className="font-semibold">{f.title}</h3>
              <span className="text-sm text-ink-2">{f.count} 件</span>
            </div>
            <p className="mt-2 text-sm">{f.detail}</p>
            <Locations locations={f.locations} />
            <p className="mt-2 text-xs text-muted">ルール: {f.ruleId}</p>
          </li>
        )}
      />
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { renderDiagram } from "@/lib/mermaid-render";

export const DIAGRAM_FAILED_NOTE = "図を表示できませんでした(仕様書の Markdown には図のコードが入っています)。";

type State = { status: "loading" } | { status: "done"; svg: string } | { status: "failed" };

/** Mermaid の図。描けないときはコードを表示する。図の内容は下の一覧(代替テキスト)でも読める */
export function MermaidDiagram({ code, purpose, title, note }: { code: string; purpose: string; title: string; note?: string }) {
  const [state, setState] = useState<{ code: string; value: State }>({ code, value: { status: "loading" } });
  useEffect(() => {
    let alive = true;
    renderDiagram(code, purpose).then((svg) => {
      if (alive) setState({ code, value: svg ? { status: "done", svg } : { status: "failed" } });
    });
    return () => {
      alive = false;
    };
  }, [code, purpose]);
  const value = state.code === code ? state.value : { status: "loading" as const };

  return (
    <figure className="mt-3" data-diagram-status={value.status}>
      <figcaption className="mb-2 text-sm text-ink-2">
        {title}
        {note && <span className="ml-1">({note})</span>}
      </figcaption>
      {value.status === "done" && <div className="diagram-frame" role="img" aria-label={title} dangerouslySetInnerHTML={{ __html: value.svg }} />}
      {value.status === "loading" && <div className="diagram-frame text-sm">図を描いています…</div>}
      {value.status === "failed" && (
        <div className="diagram-frame text-sm">
          <p>{DIAGRAM_FAILED_NOTE}</p>
          <pre className="mt-2 max-h-64 overflow-auto rounded bg-[#f3f2ee] p-2 text-xs">{code}</pre>
          <button
            type="button"
            className="mt-2 rounded border border-[#8a8880] px-3 py-1 text-sm"
            onClick={() => void navigator.clipboard?.writeText(code).catch(() => undefined)}
          >
            コードをコピー
          </button>
        </div>
      )}
    </figure>
  );
}

"use client";

import { useState, type ReactNode } from "react";
import { ShowMore } from "../ShowMore";

/** 横に長い表を、ページ全体を広げずに枠の中でスクロールさせる */
export function TableFrame({ children, minWidth = "36rem", label }: { children: ReactNode; minWidth?: string; label: string }) {
  return (
    <div className="overflow-x-auto" role="region" aria-label={label} tabIndex={0}>
      <table className="w-full border-collapse text-sm" style={{ minWidth }}>
        {children}
      </table>
    </div>
  );
}

export function Th({ children, right = false }: { children: ReactNode; right?: boolean }) {
  return <th scope="col" className={`px-2 py-1 font-semibold ${right ? "text-right" : "text-left"}`}>{children}</th>;
}

export function Td({ children, right = false, nowrap = false, className = "" }: { children: ReactNode; right?: boolean; nowrap?: boolean; className?: string }) {
  return <td className={`px-2 py-1 align-top ${right ? "text-right tabular-nums" : ""} ${nowrap ? "whitespace-nowrap" : "break-all"} ${className}`}>{children}</td>;
}

/** 名前の一覧。最初の数個だけ見せ、残りは開閉で見せる(呼び出し元・呼び出し先など) */
export function NameList({ names, head = 3, empty = "なし" }: { names: readonly string[]; head?: number; empty?: string }) {
  if (names.length === 0) return <span className="text-muted">{empty}</span>;
  const shown = names.slice(0, head);
  const rest = names.slice(head);
  return (
    <>
      <ul className="space-y-0.5">
        {shown.map((n, i) => (
          <li key={i} className="break-all">
            {n}
          </li>
        ))}
      </ul>
      {rest.length > 0 && (
        <details className="mt-0.5">
          <summary className="cursor-pointer text-accent-ink">ほか {rest.length.toLocaleString("ja-JP")} 件</summary>
          <ShowMore items={rest} label="名前" className="mt-1 space-y-0.5" render={(n, i) => <li key={i} className="break-all">{n}</li>} />
        </details>
      )}
    </>
  );
}

export function SectionHeading({ id, children, count }: { id: string; children: ReactNode; count?: number }) {
  return (
    <h2 id={id} className="text-lg font-bold">
      {children}
      {count !== undefined && <span className="ml-2 text-sm font-normal text-ink-2">{count.toLocaleString("ja-JP")} 件</span>}
    </h2>
  );
}

/** 子を、開いたときに初めて描く(大きな結果で最初の表示を重くしない) */
export function LazyDetails({ summary, children, className = "" }: { summary: ReactNode; children: () => ReactNode; className?: string }) {
  return <LazyDetailsInner summary={summary} render={children} className={className} />;
}


function LazyDetailsInner({ summary, render, className }: { summary: ReactNode; render: () => ReactNode; className: string }) {
  const [open, setOpen] = useState(false);
  return (
    <details className={className} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary className="cursor-pointer text-accent-ink">{summary}</summary>
      {open && render()}
    </details>
  );
}

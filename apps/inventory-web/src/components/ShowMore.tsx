"use client";

import { useState, type ReactNode } from "react";

export const PAGE_SIZE = 200;

/** 長い一覧を少しずつ表示する(大きな結果で画面が固まらないように。すべての一覧で使う) */
export function ShowMore<T>({
  items,
  render,
  pageSize = PAGE_SIZE,
  as = "ul",
  className = "",
  label,
}: {
  items: readonly T[];
  render: (item: T, index: number) => ReactNode;
  pageSize?: number;
  as?: "ul" | "ol" | "tbody";
  className?: string;
  /** ボタンの読み上げ用(何の一覧か) */
  label: string;
}) {
  const [shown, setShown] = useState(pageSize);
  const visible = items.slice(0, shown);
  const rest = items.length - visible.length;
  const List = as;
  const more =
    rest > 0 ? (
      <button type="button" className="mt-2 text-sm text-accent-ink underline underline-offset-2" onClick={() => setShown((n) => n + pageSize)} aria-label={`${label}をさらに表示(残り${rest}件)`}>
        さらに表示(残り {rest.toLocaleString("ja-JP")} 件)
      </button>
    ) : null;
  if (as === "tbody") {
    return (
      <>
        <List className={className}>{visible.map(render)}</List>
        {more && (
          <tbody>
            <tr>
              <td colSpan={99} className="px-2 py-2">
                {more}
              </td>
            </tr>
          </tbody>
        )}
      </>
    );
  }
  return (
    <>
      <List className={className}>{visible.map(render)}</List>
      {more}
    </>
  );
}

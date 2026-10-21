"use client";

import { useRef, type KeyboardEvent, type ReactNode } from "react";

export interface TabDef {
  id: string;
  label: string;
  content: ReactNode;
  /** 選ばれていないときも描いておく(印刷に使う仕様書など) */
  keepMounted?: boolean;
  /** 印刷用 CSS で、隠れていても印刷に出す */
  printArea?: boolean;
}

/** WAI-ARIA のタブ。矢印キー・Home・End で切り替える。スマホではタブ列だけ横にスクロールする */
export function Tabs({ tabs, selected, onSelect, label }: { tabs: TabDef[]; selected: string; onSelect: (id: string) => void; label: string }) {
  const refs = useRef(new Map<string, HTMLButtonElement>());
  const index = Math.max(0, tabs.findIndex((t) => t.id === selected));
  const move = (e: KeyboardEvent) => {
    const next =
      e.key === "ArrowRight" ? (index + 1) % tabs.length : e.key === "ArrowLeft" ? (index - 1 + tabs.length) % tabs.length : e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : -1;
    if (next < 0) return;
    e.preventDefault();
    onSelect(tabs[next].id);
    refs.current.get(tabs[next].id)?.focus();
  };
  return (
    <div className="mt-6">
      <div className="no-print overflow-x-auto border-b border-line">
        <div role="tablist" aria-label={label} className="flex min-w-max gap-1" onKeyDown={move}>
          {tabs.map((t) => {
            const active = t.id === tabs[index].id;
            return (
              <button
                key={t.id}
                ref={(el) => {
                  if (el) refs.current.set(t.id, el);
                  else refs.current.delete(t.id);
                }}
                type="button"
                role="tab"
                id={`tab-${t.id}`}
                aria-selected={active}
                aria-controls={`panel-${t.id}`}
                tabIndex={active ? 0 : -1}
                onClick={() => onSelect(t.id)}
                className={`whitespace-nowrap border-b-2 px-4 py-2 text-sm font-medium ${active ? "border-accent text-accent-ink" : "border-transparent text-ink-2 hover:text-ink"}`}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      </div>
      {tabs.map((t) => {
        const active = t.id === tabs[index].id;
        if (!active && !t.keepMounted) return null;
        return (
          <div
            key={t.id}
            role="tabpanel"
            id={`panel-${t.id}`}
            aria-labelledby={`tab-${t.id}`}
            hidden={!active}
            tabIndex={0}
            className={`pt-5 focus:outline-none ${t.printArea ? "print-area" : ""}`}
          >
            {t.content}
          </div>
        );
      })}
    </div>
  );
}

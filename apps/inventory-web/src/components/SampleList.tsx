"use client";

import type { SampleEntry } from "@/lib/samples";
import { buttonSecondary } from "./ui";

/** 「サンプルで試す」。カードは静的に描き、押したときだけサンプルのファイルを自社サーバーから取得する */
export function SampleList({ samples, onSelect, disabled }: { samples: SampleEntry[]; onSelect: (sample: SampleEntry) => void; disabled?: boolean }) {
  if (samples.length === 0) return null;
  return (
    <section aria-labelledby="samples-heading" className="mt-10">
      <h2 id="samples-heading" className="text-lg font-bold">
        サンプルで試す
      </h2>
      <p className="mt-1 text-sm text-ink-2">架空の会社のマクロ付きブックです。自社のファイルを入れる前に、何が分かるかをご覧ください。</p>
      <ul className="mt-4 grid gap-4 md:grid-cols-2">
        {samples.map((s) => (
          <li key={s.file} className="flex flex-col rounded-xl border border-line bg-surface p-4">
            <h3 className="font-semibold">{s.title}</h3>
            <p className="mt-1 text-sm text-ink-2">{s.description}</p>
            {s.highlights.length > 0 && (
              <>
                <p className="mt-3 text-xs font-semibold text-muted">見つかるはずの問題</p>
                <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
                  {s.highlights.map((h) => (
                    <li key={h}>{h}</li>
                  ))}
                </ul>
              </>
            )}
            <div className="mt-4 flex flex-1 items-end">
              <button type="button" className={buttonSecondary} disabled={disabled} onClick={() => onSelect(s)} aria-label={`サンプル「${s.title}」で試す`}>
                このサンプルで試す
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

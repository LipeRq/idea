"use client";

import { track } from "@/lib/analytics";
import type { RelatedToolRecommendation, RelatedToolUrls } from "@/lib/diagnosis/related-tools";

type Props = {
  recommendations: RelatedToolRecommendation[];
  urls: RelatedToolUrls;
  /** 相談フォームへ移り、テーマを「相談したい内容」に入れる */
  onRequestLead: (topic: string) => void;
};

// 診断の入力から決まったルールで選んだ関連ツールの案内(src/lib/diagnosis/related-tools.ts)。
// リンク先が未設定の案内は「無料相談でご案内します」として相談フォームへ誘導する。
export function RelatedTools({ recommendations, urls, onRequestLead }: Props) {
  if (recommendations.length === 0) return null;

  return (
    <section aria-labelledby="related-tools-heading" className="space-y-4">
      <div className="space-y-1">
        <h3 id="related-tools-heading" className="text-lg font-bold">
          あわせて使えるツール
        </h3>
        <p className="text-sm text-muted">
          回答内容から決まったルールで選んだ参考情報です(AIによる判断ではありません)。効果を保証するものではありません。
        </p>
      </div>
      <ul className="grid gap-4 md:grid-cols-2">
        {recommendations.map((rec) => {
          const url = urls[rec.id];
          const showLead = !url || rec.alwaysOfferLead;
          return (
            <li
              key={rec.id}
              data-related-tool={rec.id}
              className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-5"
            >
              <h4 className="font-bold">{rec.title}</h4>
              <p className="text-sm leading-relaxed text-ink-2">{rec.description}</p>
              <div className="text-sm">
                <p className="font-semibold">ご案内の理由</p>
                <ul className="list-disc space-y-1 pl-5 text-ink-2">
                  {rec.reasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              </div>
              {!url && <p className="text-sm font-medium">無料相談でご案内します。</p>}
              <div className="no-print mt-auto flex flex-wrap gap-3">
                {url && (
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => track({ name: "related_tool_click", tool: rec.id, destination: "link" })}
                    className="rounded-md border border-line px-4 py-2 font-medium text-accent-ink underline-offset-2 hover:bg-surface-2 hover:underline"
                  >
                    {rec.linkLabel}(別タブで開きます)
                  </a>
                )}
                {showLead && (
                  <button
                    type="button"
                    onClick={() => {
                      track({ name: "related_tool_click", tool: rec.id, destination: "lead_form" });
                      onRequestLead(rec.leadTopic);
                    }}
                    className="rounded-md bg-accent-strong px-4 py-2 font-semibold text-white hover:opacity-90"
                  >
                    {rec.leadButtonLabel}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

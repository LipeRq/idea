import { MermaidDiagram } from "../MermaidDiagram";
import { Notice } from "../ui";
import type { AiResult } from "./types";

const LEVEL_CLASS: Record<string, string> = {
  高: "bg-critical-soft text-critical-ink",
  中: "bg-warning-soft text-warning",
  低: "bg-surface-2 text-ink-2",
};

export function AiTab({ ai, actions }: { ai: AiResult; actions: React.ReactNode }) {
  const o = ai.json.overall;
  return (
    <div className="space-y-6">
      <Notice level="info">
        この解説は AI(Claude)による推定を含みます。件数・行数・依存関係は解析結果からの機械的な集計です。現場への確認を前提にご覧ください。
        {ai.mock && <strong className="mt-1 block">デモ用の固定文章で動作しています(実際の AI は呼んでいません)。</strong>}
      </Notice>
      {actions}
      <section aria-labelledby="ai-overview">
        <h2 id="ai-overview" className="text-lg font-bold">
          概要
        </h2>
        <p className="mt-2 whitespace-pre-wrap">{o.overview}</p>
      </section>
      {o.businessFlow.steps.length > 0 && (
        <section aria-labelledby="ai-flow">
          <h2 id="ai-flow" className="text-lg font-bold">
            業務の流れ(AI による推定)
          </h2>
          <p className="mt-2 whitespace-pre-wrap">{o.businessFlow.summary}</p>
          {ai.businessFlow && <MermaidDiagram code={ai.businessFlow} purpose="aiflow" title="業務フロー(丸い枠は利用者の作業、四角はマクロの処理、円柱は外部システム)" />}
          <ol className="mt-3 list-decimal space-y-0.5 pl-5 text-sm">
            {o.businessFlow.steps.map((s) => (
              <li key={s.id}>
                {s.label}({s.actor})
              </li>
            ))}
          </ol>
        </section>
      )}
      {o.risks.length > 0 && (
        <section aria-labelledby="ai-risks">
          <h2 id="ai-risks" className="text-lg font-bold">
            リスクの評価
          </h2>
          <ul className="mt-2 space-y-3">
            {o.risks.map((r, i) => (
              <li key={i} className="rounded-xl border border-line bg-surface p-4">
                <p className="flex flex-wrap items-center gap-2">
                  <span className={`rounded px-2 py-0.5 text-xs font-semibold ${LEVEL_CLASS[r.severity]}`}>重要度 {r.severity}</span>
                  <span className="font-semibold">{r.title}</span>
                </p>
                <p className="mt-2 text-sm whitespace-pre-wrap">{r.detail}</p>
                <p className="mt-1 text-sm">
                  <span className="font-semibold">対策: </span>
                  {r.recommendation}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}
      {o.migrations.length > 0 && (
        <section aria-labelledby="ai-migrations">
          <h2 id="ai-migrations" className="text-lg font-bold">
            移行先の候補
          </h2>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[40rem] border-collapse text-sm">
              <thead>
                <tr className="border-b border-line-strong text-left">
                  <th className="px-2 py-1">移行先</th>
                  <th className="px-2 py-1">合う度合い</th>
                  <th className="px-2 py-1">難しさ</th>
                  <th className="px-2 py-1">理由・進め方・注意点</th>
                </tr>
              </thead>
              <tbody>
                {o.migrations.map((m, i) => (
                  <tr key={i} className="border-b border-line align-top">
                    <td className="px-2 py-1">{m.target}</td>
                    <td className="px-2 py-1">{m.fit}</td>
                    <td className="px-2 py-1">{m.difficulty}</td>
                    <td className="px-2 py-1">
                      {m.reason}
                      <br />
                      {m.approach}
                      <br />
                      <span className="text-ink-2">注意: {m.concerns}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3">
            <span className="font-semibold">おすすめの進め方: </span>
            {o.recommendation}
          </p>
        </section>
      )}
      {o.hearingItems.length > 0 && (
        <section aria-labelledby="ai-hearing">
          <h2 id="ai-hearing" className="text-lg font-bold">
            現場に確認すること
          </h2>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {o.hearingItems.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ul>
        </section>
      )}
      {ai.json.notes.length > 0 && (
        <section aria-labelledby="ai-notes">
          <h2 id="ai-notes" className="text-lg font-bold">
            AI への入力について
          </h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink-2">
            {ai.json.notes.map((note, i) => (
              <li key={i}>{note}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

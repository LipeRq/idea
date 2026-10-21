import type { AnalysisResult } from "@/worker/protocol";
import { MermaidDiagram } from "../MermaidDiagram";
import { ShowMore } from "../ShowMore";

export function FlowTab({ result }: { result: AnalysisResult }) {
  const d = result.derived;
  const { callFlow, queries, relationships } = d.diagrams;
  const hasAnything = d.entryPoints.length > 0 || callFlow || queries || relationships;
  if (!hasAnything) return <p>処理の流れ(マクロの起動のきっかけ・呼び出し関係・クエリ)は見つかりませんでした。</p>;
  return (
    <div className="space-y-8">
      <section aria-labelledby="flow-entry">
        <h2 id="flow-entry" className="text-lg font-bold">
          マクロが動き出すきっかけ
        </h2>
        {d.entryPoints.length === 0 ? (
          <p className="mt-2 text-sm">起動のきっかけ(イベント・ボタンなど)は見つかりませんでした。</p>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[32rem] border-collapse text-sm">
              <thead>
                <tr className="border-b border-line-strong text-left">
                  <th className="px-2 py-1">種類</th>
                  <th className="px-2 py-1">きっかけ</th>
                  <th className="px-2 py-1">実行される処理</th>
                </tr>
              </thead>
              <ShowMore
                as="tbody"
                items={d.entryPoints}
                label="起動のきっかけ"
                render={(e, i) => (
                  <tr key={i} className="border-b border-line align-top">
                    <td className="px-2 py-1 whitespace-nowrap">{e.kindLabel}</td>
                    <td className="px-2 py-1">{e.trigger}</td>
                    <td className="px-2 py-1 break-all">{e.procedure}</td>
                  </tr>
                )}
              />
            </table>
          </div>
        )}
      </section>

      {callFlow && (
        <section aria-labelledby="flow-call">
          <h2 id="flow-call" className="text-lg font-bold">
            呼び出し関係図
          </h2>
          <MermaidDiagram
            code={callFlow.code}
            purpose="flow"
            title="起動のきっかけ → 処理 → 呼び出し先"
            note={callFlow.omitted > 0 ? `起動のきっかけに近い ${d.maxGraphNodes} 個を表示。ほか ${callFlow.omitted} 個は省略` : undefined}
          />
          <details className="mt-3 text-sm">
            <summary className="cursor-pointer text-accent-ink">呼び出し関係の一覧(図と同じ内容を文字で、{d.callEdges.length} 件)</summary>
            <ShowMore
              items={d.callEdges}
              label="呼び出し関係"
              className="mt-2 list-disc space-y-0.5 pl-5"
              render={(e, i) => (
                <li key={i} className="break-all">
                  {e.from} → {e.to}({e.kindLabel})
                </li>
              )}
            />
          </details>
        </section>
      )}

      {queries && (
        <section aria-labelledby="flow-queries">
          <h2 id="flow-queries" className="text-lg font-bold">
            クエリとテーブルの関係図
          </h2>
          <MermaidDiagram
            code={queries.code}
            purpose="queries"
            title="どのテーブルを読んで、どこへ書き込むか(四角はクエリ、円柱はテーブル)"
            note={queries.omitted > 0 ? `${queries.omitted} 件のクエリは省略` : undefined}
          />
        </section>
      )}

      {relationships && (
        <section aria-labelledby="flow-relationships">
          <h2 id="flow-relationships" className="text-lg font-bold">
            テーブルのつながり(リレーションシップ)
          </h2>
          <MermaidDiagram code={relationships} purpose="relationships" title="テーブル同士の関連" />
        </section>
      )}
    </div>
  );
}

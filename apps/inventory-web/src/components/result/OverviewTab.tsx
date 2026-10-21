import type { AnalysisResult } from "@/worker/protocol";
import { formatFileSize } from "@/lib/browser-limits";
import { SeverityBadge, StatTile } from "../ui";
import { formatDateTime, n } from "./format";

export function OverviewTab({ result, onShowRisks }: { result: AnalysisResult; onShowRisks: () => void }) {
  const { report: r, derived: d } = result;
  const s = r.stats;
  const p = r.properties;
  const isAccess = r.file.kind === "access";
  return (
    <div className="space-y-6">
      <section aria-labelledby="ov-summary">
        <h2 id="ov-summary" className="text-lg font-bold">
          概要
        </h2>
        <p className="mt-2">
          このファイルは{d.formatLabel}です。
          {s.moduleCount > 0
            ? `マクロ(VBA)は ${n(s.moduleCount)} 個のまとまり(モジュール)に、${n(s.procedureCount)} 個の処理(プロシージャ)、合計 ${n(s.codeLineCount)} 行のコードがあります。`
            : "マクロ(VBA)は見つかりませんでした。"}
          {isAccess && `テーブルが ${n(s.tableCount)} 個、保存済みのクエリが ${n(s.queryCount)} 個あります。`}
        </p>
        <dl className="mt-4 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[max-content_1fr]">
          <dt className="text-ink-2">ファイル名</dt>
          <dd className="break-all">{r.file.name}</dd>
          <dt className="text-ink-2">形式・サイズ</dt>
          <dd>
            {d.formatLabel}・{formatFileSize(r.file.sizeBytes)}
          </dd>
          <dt className="text-ink-2">作成日時 / 最終更新日時</dt>
          <dd>
            {formatDateTime(p.created)} / {formatDateTime(p.modified)}
          </dd>
          <dt className="text-ink-2">作成者 / 最終更新者</dt>
          <dd className="break-all">
            {p.creator ?? "不明"} / {p.lastModifiedBy ?? "不明"}
          </dd>
          {(p.application || p.appVersion) && (
            <>
              <dt className="text-ink-2">作成したアプリ</dt>
              <dd>{[p.application, p.appVersion].filter(Boolean).join(" ")}</dd>
            </>
          )}
        </dl>
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer text-accent-ink">詳細(技術者向け)</summary>
          <dl className="mt-2 grid gap-x-6 gap-y-2 sm:grid-cols-[max-content_1fr]">
            <dt className="text-ink-2">SHA-256(ファイルの指紋)</dt>
            <dd className="break-all font-mono text-xs">{r.file.sha256}</dd>
            {r.vba && (
              <>
                <dt className="text-ink-2">VBA プロジェクト</dt>
                <dd className="break-all">
                  {r.vba.name}(文字コード {r.vba.encoding}
                  {r.vba.lockedForViewing ? "・表示用にロックされています。解析はできます" : ""})
                </dd>
              </>
            )}
            {r.access && (
              <>
                <dt className="text-ink-2">データベースエンジン</dt>
                <dd>{r.access.engine}</dd>
              </>
            )}
          </dl>
        </details>
      </section>

      <section aria-labelledby="ov-size">
        <h2 id="ov-size" className="text-lg font-bold">
          規模
        </h2>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {!isAccess && <StatTile label="シート" value={n(s.sheetCount)} />}
          {!isAccess && <StatTile label="数式" value={n(s.formulaCount)} />}
          {isAccess && <StatTile label="テーブル" value={n(s.tableCount)} />}
          {isAccess && <StatTile label="クエリ" value={n(s.queryCount)} />}
          <StatTile label="モジュール" value={n(s.moduleCount)} note="マクロのまとまり" />
          <StatTile label="プロシージャ" value={n(s.procedureCount)} note="マクロの処理の単位" />
          <StatTile label="コード行" value={n(s.codeLineCount)} note={`空行・コメントを含めると ${n(s.totalLineCount)} 行`} />
          <StatTile label="外部とのつながり" value={n(s.dependencyCount)} note="ファイル・DB・他のアプリなど" />
        </div>
      </section>

      <section aria-labelledby="ov-difficulty" className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-line bg-surface p-4">
          <h2 id="ov-difficulty" className="font-bold">
            移行の難しさの目安: <span className="text-xl">{d.complexity.level}</span>
          </h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
            {d.complexity.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted">解析結果から機械的に決めた目安です(規模・外部とのつながり・入力画面・環境への依存)。</p>
        </div>
        <div className="rounded-xl border border-line bg-surface p-4">
          <h2 className="font-bold">見つかったリスク</h2>
          <p className="mt-2 flex flex-wrap gap-2">
            <SeverityBadge severity="high" label={`高 ${d.findingCounts.high} 件`} />
            <SeverityBadge severity="medium" label={`中 ${d.findingCounts.medium} 件`} />
            <SeverityBadge severity="low" label={`低 ${d.findingCounts.low} 件`} />
          </p>
          <button type="button" className="mt-3 text-sm text-accent-ink underline underline-offset-2" onClick={onShowRisks}>
            リスクの内容を見る
          </button>
        </div>
      </section>

      {d.entryPoints.length > 0 && (
        <section aria-labelledby="ov-entry">
          <h2 id="ov-entry" className="text-lg font-bold">
            マクロが動き出すきっかけ(主なもの)
          </h2>
          <ul className="mt-2 space-y-1 text-sm">
            {d.entryPoints.slice(0, 5).map((e, i) => (
              <li key={i}>
                <span className="mr-2 rounded bg-surface-2 px-2 py-0.5 text-xs">{e.kindLabel}</span>
                {e.trigger} → <span className="break-all">{e.procedure}</span>
              </li>
            ))}
          </ul>
          {d.entryPoints.length > 5 && <p className="mt-1 text-sm text-ink-2">ほか {d.entryPoints.length - 5} 件(「処理の流れ」に一覧があります)</p>}
        </section>
      )}

      <section aria-labelledby="ov-warnings">
        <h2 id="ov-warnings" className="text-lg font-bold">
          解析の制約
        </h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink-2">
          {r.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
          <li>シートのセルの値(データ本体)は読み取っていません。数式・構造・コードだけを対象にしています。</li>
          <li>呼び出し関係は静的な解析です。文字列を組み立てて実行するマクロなどは検出できないことがあります。</li>
        </ul>
      </section>
    </div>
  );
}

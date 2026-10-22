"use client";

import { useMemo } from "react";
import { MermaidDiagram } from "../MermaidDiagram";
import { PrivacyBadge } from "../PrivacyBadge";
import { ShowMore } from "../ShowMore";
import { buttonSecondary, StatTile } from "../ui";
import { graphOf, summarize, toRows, type InventoryItem, type InventoryRow } from "@/lib/inventory-list";
import { InventoryExportActions } from "./InventoryExportActions";
import { NextStepLinks } from "./NextStepLinks";
import { n } from "./format";
import { NameList, TableFrame, Td, Th } from "./parts";

const DIFFICULTY_CLASS: Record<string, string> = {
  高: "border-critical bg-critical-soft text-critical-ink",
  中: "border-warning bg-warning-soft text-warning",
  低: "border-line-strong bg-surface-2 text-ink-2",
};

function RiskCounts({ row }: { row: InventoryRow }) {
  return (
    <span className="whitespace-nowrap">
      <span className={row.high ? "font-bold text-critical-ink" : ""}>高 {n(row.high ?? 0)}</span>
      <span className="mx-1 text-muted">/</span>
      <span>中 {n(row.medium ?? 0)}</span>
      <span className="mx-1 text-muted">/</span>
      <span>低 {n(row.low ?? 0)}</span>
    </span>
  );
}

function Row({ row, onSelect }: { row: InventoryRow; onSelect: () => void }) {
  if (row.status !== "解析済み") {
    return (
      <tr className="border-b border-line" data-row-status={row.status}>
        <Td>
          <span className="font-medium">{row.fileName}</span>
        </Td>
        <td colSpan={7} className="px-2 py-1 align-top">
          <p className={row.status === "エラー" ? "text-critical-ink" : "text-ink-2"}>
            <span className="mr-2 inline-block rounded border border-line-strong px-2 py-0.5 text-xs font-semibold">{row.status}</span>
            {row.note}
          </p>
        </td>
        <Td nowrap>—</Td>
      </tr>
    );
  }
  return (
    <tr className="border-b border-line" data-row-status={row.status}>
      <Td>
        <span className="font-medium">{row.fileName}</span>
        <span className="block text-xs text-ink-2">{row.formatLabel}</span>
      </Td>
      <Td nowrap>
        {row.size}
        <span className="block text-xs text-ink-2">コード {n(row.codeLines ?? 0)} 行</span>
      </Td>
      <Td right>{n(row.modules ?? 0)}</Td>
      <Td nowrap>
        {row.tables !== null ? (
          <>
            テーブル {n(row.tables)}
            <span className="block text-xs text-ink-2">クエリ {n(row.queries ?? 0)}</span>
          </>
        ) : (
          <>
            シート {n(row.sheets ?? 0)}
            <span className="block text-xs text-ink-2">数式 {n(row.formulas ?? 0)}</span>
          </>
        )}
      </Td>
      <Td nowrap>
        <RiskCounts row={row} />
      </Td>
      <Td nowrap>
        <span className={`inline-block rounded border px-2 py-0.5 text-xs font-semibold ${DIFFICULTY_CLASS[row.difficulty] ?? ""}`}>{row.difficulty}</span>
      </Td>
      <Td>
        {row.externalCount === 0 ? (
          <span className="text-muted">なし</span>
        ) : (
          <>
            {row.externalSummary}
            <details className="mt-0.5 text-sm">
              <summary className="cursor-pointer text-accent-ink">参照先を見る</summary>
              <NameList names={row.externalList} head={50} />
            </details>
          </>
        )}
      </Td>
      <Td nowrap>
        <button type="button" className="text-accent-ink underline underline-offset-2" onClick={onSelect} aria-label={`${row.fileName}の詳細を見る`}>
          詳しく見る
        </button>
      </Td>
    </tr>
  );
}

/** 複数ファイルを解析した結果の「棚卸し一覧」。ファイルごとの規模・リスク・移行難易度・外部依存を比べ、ファイル間のつながりを図で見る */
export function InventoryListView({
  items,
  onSelect,
  onAnalyzeAnother,
  contactUrl,
  diagnosisUrl,
}: {
  items: InventoryItem[];
  onSelect: (id: string) => void;
  onAnalyzeAnother: () => void;
  contactUrl: string | null;
  diagnosisUrl: string | null;
}) {
  const rows = useMemo(() => toRows(items), [items]);
  const graph = useMemo(() => graphOf(items), [items]);
  const s = summarize(rows);
  return (
    <div className="screen-only">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold sm:text-2xl">棚卸し一覧({n(s.total)} ファイル)</h1>
          <p className="mt-1 text-sm text-ink-2">結果はこのタブの中だけにあり、タブを閉じると消えます。必要なら保存してください。</p>
        </div>
        <button type="button" className={buttonSecondary} onClick={onAnalyzeAnother}>
          別のファイルを解析(結果を消去)
        </button>
      </div>
      <div className="mt-3">
        <PrivacyBadge />
      </div>
      <div className="mt-4 rounded-xl border border-line bg-surface p-4">
        <InventoryExportActions rows={rows} graph={graph} />
      </div>

      <section aria-labelledby="list-summary" className="mt-6">
        <h2 id="list-summary" className="sr-only">
          全体のまとめ
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile label="解析できたファイル" value={`${n(s.done)} / ${n(s.total)}`} note={s.failed + s.skipped > 0 ? `エラー ${s.failed}・対象外 ${s.skipped}` : undefined} />
          <StatTile label="リスク(高)の合計" value={n(s.highRisk)} note="件" />
          <StatTile label="移行が難しいファイル" value={n(s.highDifficulty)} note="移行難易度が「高」" />
          <StatTile label="外部への参照があるファイル" value={n(rows.filter((r) => (r.externalCount ?? 0) > 0).length)} note="他のブック・Access・DB" />
        </div>
      </section>

      <section aria-labelledby="list-table" className="mt-8">
        <h2 id="list-table" className="text-lg font-bold">
          ファイルの比較
        </h2>
        <p className="mt-1 text-sm text-ink-2">
          「詳しく見る」を押すと、そのファイルのリスク・処理の流れ・モジュール・依存関係などを見られます。AI で詳しい仕様書を作る場合も、ファイルごとに開いてから行います。
        </p>
        <div className="mt-3">
          <TableFrame label="棚卸し一覧" minWidth="62rem">
            <thead>
              <tr className="border-b border-line-strong">
                <Th>ファイル</Th>
                <Th>規模</Th>
                <Th right>モジュール</Th>
                <Th>シート / テーブル</Th>
                <Th>リスク</Th>
                <Th>移行難易度</Th>
                <Th>外部依存</Th>
                <Th>操作</Th>
              </tr>
            </thead>
            <ShowMore as="tbody" items={rows} label="ファイル" render={(row) => <Row key={row.id} row={row} onSelect={() => onSelect(row.id)} />} />
          </TableFrame>
        </div>
        <p className="mt-2 text-xs text-muted">
          規模は S(小)・M・L・XL(大)。移行難易度は、規模・外部とのつながり・入力画面・環境への依存から機械的に決めた目安です。
        </p>
      </section>

      <section aria-labelledby="list-graph" className="mt-8">
        <h2 id="list-graph" className="text-lg font-bold">
          ファイル間のつながり
        </h2>
        {graph ? (
          <>
            <p className="mt-1 text-sm text-ink-2">
              矢印は「参照している」向きです(ブックがほかのブックを開く・数式でリンクする、Access のデータベースにつなぐ、など)。丸みのある四角は参照されているだけで解析していないファイル、円柱は Access・DB です。
            </p>
            <MermaidDiagram
              code={graph.code}
              purpose="inventory"
              title="ファイルどうしの参照関係"
              note={graph.omitted > 0 ? `参照先が多いため ${graph.omitted} 件は省略` : undefined}
            />
            <details className="mt-3 text-sm">
              <summary className="cursor-pointer text-accent-ink">参照関係の一覧(図と同じ内容を文字で、{graph.edges.length} 件)</summary>
              <ShowMore
                items={graph.edges}
                label="参照関係"
                className="mt-2 list-disc space-y-0.5 pl-5"
                render={(e, i) => {
                  const label = (id: string) => graph.nodes.find((node) => node.id === id)?.label ?? id;
                  return (
                    <li key={i} className="break-all">
                      {label(e.from)} → {label(e.to)}({e.via.join("・")})
                    </li>
                  );
                }}
              />
            </details>
          </>
        ) : (
          <p className="mt-2 text-sm">ファイルどうしの参照(他のブックや Access ファイルへの参照)は見つかりませんでした。</p>
        )}
      </section>
      <NextStepLinks contactUrl={contactUrl} diagnosisUrl={diagnosisUrl} />
    </div>
  );
}

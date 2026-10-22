"use client";

import { useState } from "react";
import type { Procedure, VbaModule } from "@engine/browser";
import type { AnalysisResult } from "@/worker/protocol";
import { ShowMore } from "../ShowMore";
import { LazyDetails, NameList, SectionHeading, TableFrame, Td, Th } from "./parts";
import { n } from "./format";

const ERROR_HANDLING_LABEL: Record<Procedure["errorHandling"], string> = {
  handler: "あり(エラー時の処理を書いている)",
  resumeNext: "エラーを無視して続行(On Error Resume Next)",
  none: "なし",
};

const SCOPE_LABEL: Record<Procedure["scope"], string> = { public: "公開", private: "非公開", friend: "同じプロジェクト内" };

function paramText(p: Procedure["params"][number]): string {
  return `${p.optional ? "省略可 " : ""}${p.paramArray ? "可変長 " : ""}${p.byVal ? "値渡し " : ""}${p.name}${p.isArray ? "()" : ""}${p.type ? `: ${p.type}` : ""}`;
}

/** ソースコード。大きなモジュールでも固まらないよう、2,000行ずつ表示する */
const SOURCE_STEP = 2000;
function Source({ source }: { source: string }) {
  const [lines, setLines] = useState(SOURCE_STEP);
  const all = source.split("\n");
  return (
    <div className="mt-2">
      <pre className="max-h-96 overflow-auto rounded bg-surface-2 p-2 text-xs" tabIndex={0}>
        {all.slice(0, lines).join("\n")}
      </pre>
      {all.length > lines && (
        <button type="button" className="mt-1 text-sm text-accent-ink underline underline-offset-2" onClick={() => setLines((v) => v + SOURCE_STEP)}>
          さらに表示(残り {n(all.length - lines)} 行)
        </button>
      )}
    </div>
  );
}

function ProcedureTable({ procedures, kindLabel }: { procedures: Procedure[]; kindLabel: Record<string, string> }) {
  if (procedures.length === 0) return <p className="mt-2 text-sm text-ink-2">処理(プロシージャ)はありません。</p>;
  return (
    <div className="mt-2">
      <TableFrame label="処理(プロシージャ)の一覧" minWidth="52rem">
        <thead>
          <tr className="border-b border-line-strong">
            <Th>処理の名前</Th>
            <Th right>行数</Th>
            <Th>引数</Th>
            <Th>エラー処理</Th>
            <Th>呼び出し先</Th>
            <Th>呼び出し元</Th>
          </tr>
        </thead>
        <ShowMore
          as="tbody"
          items={procedures}
          label="処理"
          render={(p) => (
            <tr key={p.id} className="border-b border-line">
              <Td>
                <span className="font-medium">{p.name}</span>
                <span className="block text-xs text-ink-2">
                  {kindLabel[p.kind] ?? p.kind}・{SCOPE_LABEL[p.scope]}
                  {p.eventLabel ? `・イベント: ${p.eventLabel}` : p.isEvent ? "・イベント" : ""}
                  ・{p.startLine}〜{p.endLine}行目
                </span>
              </Td>
              <Td right>{n(p.lineCount)}</Td>
              <Td>
                <NameList names={p.params.map(paramText)} empty="なし" />
                {p.returnType && <span className="block text-xs text-ink-2">戻り値: {p.returnType}</span>}
              </Td>
              <Td className={p.errorHandling === "none" ? "text-ink-2" : ""}>{ERROR_HANDLING_LABEL[p.errorHandling]}</Td>
              <Td>
                <NameList names={p.calls} />
              </Td>
              <Td>
                <NameList names={p.calledBy} />
              </Td>
            </tr>
          )}
        />
      </TableFrame>
    </div>
  );
}

function ModuleDetails({ module: m, labels }: { module: VbaModule; labels: AnalysisResult["derived"]["labels"] }) {
  return (
    <>
      <p className="mt-2 text-sm text-ink-2">
        {labels.moduleType[m.type] ?? m.type}・全 {n(m.lineCount)} 行(コード {n(m.codeLineCount)} 行・コメント {n(m.commentLineCount)} 行)・
        {m.hasOptionExplicit ? "変数の宣言を必須にしています(Option Explicit)" : "変数の宣言を必須にしていません(Option Explicit なし)"}
      </p>
      <ProcedureTable procedures={m.procedures} kindLabel={labels.procedureKind} />
      {m.declares.length > 0 && (
        <div className="mt-3">
          <h4 className="text-sm font-semibold">Windows の機能の呼び出し(Declare)</h4>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm">
            {m.declares.map((d, i) => (
              <li key={i} className="break-all">
                {d.name}(<span className="font-mono text-xs">{d.lib}</span>){d.ptrSafe ? "" : "・64ビット版の Office に未対応の書き方(PtrSafe なし)"}
              </li>
            ))}
          </ul>
        </div>
      )}
      {m.source !== null && (
        <LazyDetails summary="ソースコードを表示(パスワードは伏せ字にしてあります)" className="mt-3 text-sm">
          {() => <Source source={m.source ?? ""} />}
        </LazyDetails>
      )}
    </>
  );
}

export function ModulesTab({ result }: { result: AnalysisResult }) {
  const { report, derived } = result;
  const modules = report.vba?.modules ?? [];
  if (modules.length === 0) return <p>マクロ(VBA)のモジュールは見つかりませんでした。</p>;
  const procs = modules.reduce((sum, m) => sum + m.procedures.length, 0);
  const noHandler = modules.reduce((sum, m) => sum + m.procedures.filter((p) => p.errorHandling === "none").length, 0);
  return (
    <div className="space-y-4">
      <SectionHeading id="mod-heading" count={modules.length}>
        モジュール(マクロのまとまり)
      </SectionHeading>
      <p className="text-sm text-ink-2">
        処理(プロシージャ)は全部で {n(procs)} 個、そのうちエラー処理の無いものが {n(noHandler)} 個あります。モジュールの名前を押すと、中の処理の一覧(行数・引数・エラー処理・呼び出し関係)を見られます。
      </p>
      <ShowMore
        items={modules}
        label="モジュール"
        className="space-y-2"
        render={(m) => (
          <li key={m.streamName || m.name} className="rounded-xl border border-line bg-surface p-3">
            <LazyDetails
              summary={
                <>
                  <span className="font-semibold break-all">{m.name}</span>
                  <span className="ml-2 text-ink-2">
                    {derived.labels.moduleType[m.type] ?? m.type}・{n(m.lineCount)} 行・処理 {n(m.procedures.length)} 個
                  </span>
                </>
              }
            >
              {() => <ModuleDetails module={m} labels={derived.labels} />}
            </LazyDetails>
          </li>
        )}
      />
    </div>
  );
}

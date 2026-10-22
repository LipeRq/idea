"use client";

import type { AnalysisResult } from "@/worker/protocol";
import { ShowMore } from "../ShowMore";
import { n } from "./format";
import { NameList, SectionHeading, TableFrame, Td, Th } from "./parts";

const REFERENCE_KIND_LABEL = { registered: "登録済みのライブラリ", project: "プロジェクト", control: "コントロール", original: "その他" } as const;

export function DependenciesTab({ result }: { result: AnalysisResult }) {
  const { report, derived } = result;
  // 参照設定は、下の「参照設定ライブラリ」の表で詳しく示す
  const groups = derived.dependencyGroups.filter((g) => g.kind !== "reference");
  const references = report.vba?.references ?? [];
  if (groups.length === 0 && references.length === 0) return <p>外部とのつながり(ファイル・DB・他のアプリなど)は見つかりませんでした。</p>;
  return (
    <div className="space-y-8">
      <p className="text-sm text-ink-2">
        マクロや数式が、ファイル・データベース・他のアプリなど、このファイルの外とどうつながっているかの一覧です。移行や引っ越しのときに、同じ場所・同じ環境が必要になるものです。
      </p>
      {groups.map((g, gi) => (
        <section key={g.kind} aria-labelledby={`dep-${gi}`}>
          <SectionHeading id={`dep-${gi}`} count={g.items.length}>
            {g.label}
          </SectionHeading>
          <div className="mt-2">
            <TableFrame label={`${g.label}の一覧`} minWidth="40rem">
              <thead>
                <tr className="border-b border-line-strong">
                  <Th>対象</Th>
                  <Th>分類</Th>
                  <Th right>件数</Th>
                  <Th>場所</Th>
                </tr>
              </thead>
              <ShowMore
                as="tbody"
                items={g.items}
                label={g.label}
                render={(item, i) => (
                  <tr key={i} className="border-b border-line">
                    <Td>{item.target || "(不明)"}</Td>
                    <Td>{item.category ?? "—"}</Td>
                    <Td right>{n(item.count)}</Td>
                    <Td>
                      <NameList names={item.locations} head={2} empty="—" />
                    </Td>
                  </tr>
                )}
              />
            </TableFrame>
          </div>
        </section>
      ))}
      {references.length > 0 && (
        <section aria-labelledby="dep-references">
          <SectionHeading id="dep-references" count={references.length}>
            参照設定ライブラリ
          </SectionHeading>
          <p className="mt-1 text-sm text-ink-2">マクロが使っている部品(ライブラリ)です。移行先の環境に同じものが必要になることがあります。</p>
          <div className="mt-2">
            <TableFrame label="参照設定ライブラリの一覧" minWidth="36rem">
              <thead>
                <tr className="border-b border-line-strong">
                  <Th>名前</Th>
                  <Th>種類</Th>
                  <Th>説明・場所</Th>
                </tr>
              </thead>
              <ShowMore
                as="tbody"
                items={references}
                label="参照設定"
                render={(r, i) => (
                  <tr key={i} className="border-b border-line">
                    <Td>{r.name}</Td>
                    <Td nowrap>{REFERENCE_KIND_LABEL[r.kind]}</Td>
                    <Td>
                      {r.description ?? ""}
                      {r.path && <span className="block text-xs text-ink-2">{r.path}</span>}
                    </Td>
                  </tr>
                )}
              />
            </TableFrame>
          </div>
        </section>
      )}
    </div>
  );
}

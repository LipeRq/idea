"use client";

import type { AccessInfo } from "@engine/browser";
import type { AnalysisResult } from "@/worker/protocol";
import { ShowMore } from "../ShowMore";
import { n } from "./format";
import { LazyDetails, NameList, SectionHeading, TableFrame, Td, Th } from "./parts";

const LINK_KIND_LABEL: Record<AccessInfo["linkedTables"][number]["kind"], string> = {
  access: "別の Access",
  odbc: "ODBC(データベース)",
  excel: "Excel",
  text: "テキスト・CSV",
  sharepoint: "SharePoint",
  other: "その他",
};

const VBA_STATUS_LABEL: Record<AccessInfo["vbaStatus"], string> = {
  extracted: "VBA のコードを取り出せました(「モジュール・処理」タブで見られます)",
  none: "VBA のコードはありません",
  failed: "VBA のコードを取り出せませんでした",
};

function NameSection({ id, title, names, note }: { id: string; title: string; names: string[]; note?: string }) {
  if (names.length === 0) return null;
  return (
    <section aria-labelledby={id}>
      <SectionHeading id={id} count={names.length}>
        {title}
      </SectionHeading>
      {note && <p className="mt-1 text-sm text-ink-2">{note}</p>}
      <ShowMore items={names} label={title} className="mt-2 list-disc space-y-0.5 pl-5 text-sm" render={(name, i) => <li key={i} className="break-all">{name}</li>} />
    </section>
  );
}

export function AccessTab({ result }: { result: AnalysisResult }) {
  const access = result.report.access;
  if (!access) return <p>Access の情報はありません(Access ファイルではありません)。</p>;
  const queries = access.queries.filter((q) => !q.hidden);
  const hiddenQueries = access.queries.length - queries.length;
  const labels = result.derived.labels;
  return (
    <div className="space-y-8">
      <p className="text-sm text-ink-2">
        データベースエンジン: {access.engine}。{VBA_STATUS_LABEL[access.vbaStatus]}。フォーム・レポート・マクロは名前だけを取り出しています(中身は解析していません)。
      </p>

      <section aria-labelledby="acc-tables">
        <SectionHeading id="acc-tables" count={access.tables.length}>
          テーブル
        </SectionHeading>
        {access.tables.length === 0 ? (
          <p className="mt-2 text-sm">テーブルは見つかりませんでした。</p>
        ) : (
          <div className="mt-2">
            <TableFrame label="テーブルの一覧" minWidth="32rem">
              <thead>
                <tr className="border-b border-line-strong">
                  <Th>テーブル名</Th>
                  <Th right>データの件数</Th>
                  <Th>列</Th>
                </tr>
              </thead>
              <ShowMore
                as="tbody"
                items={access.tables}
                label="テーブル"
                render={(t) => (
                  <tr key={t.name} className="border-b border-line">
                    <Td>{t.name}</Td>
                    <Td right>{n(t.rowCount)}</Td>
                    <Td>
                      <LazyDetails summary={`列 ${n(t.columns.length)} 個を表示`} className="text-sm">
                        {() => (
                          <ShowMore
                            items={t.columns}
                            label="列"
                            className="mt-1 space-y-0.5"
                            render={(c, i) => (
                              <li key={i} className="break-all">
                                {c.name}({c.type}
                                {c.size > 0 ? `・${c.size}` : ""}
                                {c.autoNumber ? "・連番" : ""}
                                {c.nullable ? "" : "・必須"})
                              </li>
                            )}
                          />
                        )}
                      </LazyDetails>
                    </Td>
                  </tr>
                )}
              />
            </TableFrame>
          </div>
        )}
      </section>

      {access.linkedTables.length > 0 && (
        <section aria-labelledby="acc-linked">
          <SectionHeading id="acc-linked" count={access.linkedTables.length}>
            リンクテーブル(他のファイル・DB にあるテーブル)
          </SectionHeading>
          <div className="mt-2">
            <TableFrame label="リンクテーブルの一覧" minWidth="40rem">
              <thead>
                <tr className="border-b border-line-strong">
                  <Th>名前</Th>
                  <Th>種類</Th>
                  <Th>リンク先</Th>
                </tr>
              </thead>
              <ShowMore
                as="tbody"
                items={access.linkedTables}
                label="リンクテーブル"
                render={(l, i) => (
                  <tr key={i} className="border-b border-line">
                    <Td>{l.name}</Td>
                    <Td nowrap>{LINK_KIND_LABEL[l.kind]}</Td>
                    <Td>
                      {l.database ?? l.connect ?? "—"}
                      {l.sourceTable && <span className="block text-xs text-ink-2">元のテーブル: {l.sourceTable}</span>}
                    </Td>
                  </tr>
                )}
              />
            </TableFrame>
          </div>
        </section>
      )}

      <section aria-labelledby="acc-queries">
        <SectionHeading id="acc-queries" count={queries.length}>
          クエリ
        </SectionHeading>
        {hiddenQueries > 0 && <p className="mt-1 text-sm text-ink-2">フォーム・レポートが内部で使うクエリ {n(hiddenQueries)} 件は、この一覧に含めていません。</p>}
        {queries.length === 0 ? (
          <p className="mt-2 text-sm">保存済みのクエリは見つかりませんでした。</p>
        ) : (
          <div className="mt-2">
            <TableFrame label="クエリの一覧" minWidth="44rem">
              <thead>
                <tr className="border-b border-line-strong">
                  <Th>クエリ名</Th>
                  <Th>種類</Th>
                  <Th>参照しているテーブル・クエリ</Th>
                  <Th>書き込み先</Th>
                  <Th>SQL</Th>
                </tr>
              </thead>
              <ShowMore
                as="tbody"
                items={queries}
                label="クエリ"
                render={(q) => (
                  <tr key={q.name} className="border-b border-line">
                    <Td>{q.name}</Td>
                    <Td nowrap>{labels.queryType[q.type] ?? q.type}</Td>
                    <Td>
                      <NameList names={q.tables} />
                    </Td>
                    <Td>{q.target ?? "—"}</Td>
                    <Td>
                      {q.sql === null ? (
                        <span className="text-ink-2">取り出せませんでした</span>
                      ) : (
                        <LazyDetails summary="SQL を表示" className="text-sm">
                          {() => (
                            <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap rounded bg-surface-2 p-2 text-xs" tabIndex={0}>
                              {q.sql}
                            </pre>
                          )}
                        </LazyDetails>
                      )}
                    </Td>
                  </tr>
                )}
              />
            </TableFrame>
          </div>
        )}
      </section>

      <section aria-labelledby="acc-rels">
        <SectionHeading id="acc-rels" count={access.relationships.length}>
          リレーションシップ(テーブルどうしのつながり)
        </SectionHeading>
        {access.relationships.length === 0 ? (
          <p className="mt-2 text-sm">リレーションシップは設定されていません。</p>
        ) : (
          <div className="mt-2">
            <TableFrame label="リレーションシップの一覧" minWidth="44rem">
              <thead>
                <tr className="border-b border-line-strong">
                  <Th>元のテーブル(列)</Th>
                  <Th>つながる先(列)</Th>
                  <Th>関係</Th>
                  <Th>ルール</Th>
                </tr>
              </thead>
              <ShowMore
                as="tbody"
                items={access.relationships}
                label="リレーションシップ"
                render={(r, i) => (
                  <tr key={i} className="border-b border-line">
                    <Td>
                      {r.primaryTable}({r.primaryColumns.join(", ")})
                    </Td>
                    <Td>
                      {r.foreignTable}({r.foreignColumns.join(", ")})
                    </Td>
                    <Td nowrap>{r.oneToOne ? "1 対 1" : "1 対 多"}</Td>
                    <Td>
                      {[r.enforced ? "整合性を保つ" : "整合性の設定なし", r.cascadeUpdate ? "更新を連鎖" : "", r.cascadeDelete ? "削除を連鎖" : ""].filter(Boolean).join("・")}
                    </Td>
                  </tr>
                )}
              />
            </TableFrame>
          </div>
        )}
        <p className="mt-2 text-sm text-ink-2">図は「処理の流れ」タブにあります。</p>
      </section>

      <NameSection id="acc-forms" title="フォーム(入力画面)" names={access.forms} />
      <NameSection id="acc-reports" title="レポート(帳票)" names={access.reports} />
      <NameSection id="acc-macros" title="マクロ" names={access.macros} />
      <NameSection id="acc-modules" title="モジュール" names={access.modules} />
    </div>
  );
}

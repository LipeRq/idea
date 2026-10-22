"use client";

import type { Sheet } from "@engine/browser";
import type { AnalysisResult } from "@/worker/protocol";
import { ShowMore } from "../ShowMore";
import { n } from "./format";
import { NameList, SectionHeading, TableFrame, Td, Th } from "./parts";

const KIND_LABEL: Record<Sheet["kind"], string> = { worksheet: "ワークシート", chartsheet: "グラフシート", dialogsheet: "ダイアログシート", macrosheet: "Excel 4.0 マクロシート" };
const STATE_LABEL: Record<Sheet["state"], string> = { visible: "表示", hidden: "非表示", veryHidden: "非表示(Excel の画面から再表示できない)" };
const LINK_TYPE_LABEL = { workbook: "他のブック", dde: "DDE(他のアプリとの連携)", ole: "OLE(埋め込み・リンク)", unknown: "不明" } as const;

export function SheetsTab({ result }: { result: AnalysisResult }) {
  const excel = result.report.excel;
  if (!excel) return <p>シートの情報はありません(Excel ファイルではありません)。</p>;
  const broken = excel.sheets.reduce((sum, s) => sum + s.brokenRefCount, 0);
  return (
    <div className="space-y-8">
      <section aria-labelledby="sheets-heading">
        <SectionHeading id="sheets-heading" count={excel.sheets.length}>
          シート
        </SectionHeading>
        <p className="mt-1 text-sm text-ink-2">
          数式は合計 {n(excel.formulaCount)} 件
          {excel.formulaTextAvailable ? "" : "(この形式では、数式の中身は読み取れず件数だけです)"}。
          {broken > 0 ? `参照が切れている数式(#REF!)が ${n(broken)} 件あります。` : ""}セルの値(データ本体)は読み取っていません。
        </p>
        <div className="mt-2">
          <TableFrame label="シートの一覧" minWidth="48rem">
            <thead>
              <tr className="border-b border-line-strong">
                <Th>シート名</Th>
                <Th>VBA から見た名前</Th>
                <Th>種類</Th>
                <Th>表示</Th>
                <Th>使用範囲</Th>
                <Th right>数式</Th>
                <Th right>他ブック参照</Th>
                <Th right>#REF!</Th>
              </tr>
            </thead>
            <ShowMore
              as="tbody"
              items={excel.sheets}
              label="シート"
              render={(s) => (
                <tr key={s.index} className="border-b border-line">
                  <Td>{s.name}</Td>
                  <Td>{s.codeName ?? "—"}</Td>
                  <Td>{KIND_LABEL[s.kind]}</Td>
                  <Td className={s.state === "visible" ? "" : "text-warning"}>{STATE_LABEL[s.state]}</Td>
                  <Td nowrap>{s.usedRange ?? "—"}</Td>
                  <Td right>{n(s.formulaCount)}</Td>
                  <Td right>{n(s.externalRefCount)}</Td>
                  <Td right>{n(s.brokenRefCount)}</Td>
                </tr>
              )}
            />
          </TableFrame>
        </div>
      </section>

      {excel.definedNames.length > 0 && (
        <section aria-labelledby="names-heading">
          <SectionHeading id="names-heading" count={excel.definedNames.length}>
            名前定義
          </SectionHeading>
          <p className="mt-1 text-sm text-ink-2">セルの範囲などに付けた名前です。数式やマクロから使われていることがあります。</p>
          <div className="mt-2">
            <TableFrame label="名前定義の一覧" minWidth="36rem">
              <thead>
                <tr className="border-b border-line-strong">
                  <Th>名前</Th>
                  <Th>範囲</Th>
                  <Th>参照先</Th>
                  <Th>備考</Th>
                </tr>
              </thead>
              <ShowMore
                as="tbody"
                items={excel.definedNames}
                label="名前定義"
                render={(d, i) => (
                  <tr key={i} className="border-b border-line">
                    <Td>{d.name}</Td>
                    <Td>{d.scope ?? "ブック全体"}</Td>
                    <Td>{d.refersTo ?? "—"}</Td>
                    <Td>{[d.hidden ? "非表示" : "", d.builtIn ? "Excel が自動で付けた名前" : ""].filter(Boolean).join("・") || "—"}</Td>
                  </tr>
                )}
              />
            </TableFrame>
          </div>
        </section>
      )}

      <section aria-labelledby="links-heading">
        <SectionHeading id="links-heading" count={excel.externalLinks.length}>
          外部リンク(他のブックへの参照)
        </SectionHeading>
        {excel.externalLinks.length === 0 ? (
          <p className="mt-2 text-sm">他のブックを参照する数式は見つかりませんでした。</p>
        ) : (
          <div className="mt-2">
            <TableFrame label="外部リンクの一覧" minWidth="36rem">
              <thead>
                <tr className="border-b border-line-strong">
                  <Th>リンク先</Th>
                  <Th>種類</Th>
                  <Th>使っているシート</Th>
                </tr>
              </thead>
              <ShowMore
                as="tbody"
                items={excel.externalLinks}
                label="外部リンク"
                render={(l) => (
                  <tr key={l.index} className="border-b border-line">
                    <Td>{l.target}</Td>
                    <Td nowrap>{LINK_TYPE_LABEL[l.type]}</Td>
                    <Td>
                      <NameList names={l.sheetNames} head={3} empty="—" />
                    </Td>
                  </tr>
                )}
              />
            </TableFrame>
          </div>
        )}
      </section>

      {excel.connections.length > 0 && (
        <section aria-labelledby="conn-heading">
          <SectionHeading id="conn-heading" count={excel.connections.length}>
            データ接続
          </SectionHeading>
          <p className="mt-1 text-sm text-ink-2">パスワードは伏せ字にしてあります。</p>
          <div className="mt-2">
            <TableFrame label="データ接続の一覧" minWidth="40rem">
              <thead>
                <tr className="border-b border-line-strong">
                  <Th>名前</Th>
                  <Th>種類</Th>
                  <Th>接続先・コマンド</Th>
                </tr>
              </thead>
              <ShowMore
                as="tbody"
                items={excel.connections}
                label="データ接続"
                render={(c, i) => (
                  <tr key={i} className="border-b border-line">
                    <Td>{c.name}</Td>
                    <Td>{c.type}</Td>
                    <Td>
                      {c.connectionString ?? "—"}
                      {c.command && <span className="block text-xs text-ink-2">{c.command}</span>}
                    </Td>
                  </tr>
                )}
              />
            </TableFrame>
          </div>
        </section>
      )}

      {excel.controlMacros.length > 0 && (
        <section aria-labelledby="ctl-heading">
          <SectionHeading id="ctl-heading" count={excel.controlMacros.length}>
            ボタンなどに登録されたマクロ
          </SectionHeading>
          <div className="mt-2">
            <TableFrame label="ボタンに登録されたマクロの一覧" minWidth="36rem">
              <thead>
                <tr className="border-b border-line-strong">
                  <Th>シート</Th>
                  <Th>ボタン・図形</Th>
                  <Th>表示されている文字</Th>
                  <Th>実行されるマクロ</Th>
                </tr>
              </thead>
              <ShowMore
                as="tbody"
                items={excel.controlMacros}
                label="ボタンのマクロ"
                render={(c, i) => (
                  <tr key={i} className="border-b border-line">
                    <Td>{c.sheet}</Td>
                    <Td>{c.control}</Td>
                    <Td>{c.text ?? "—"}</Td>
                    <Td>{c.macro}</Td>
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

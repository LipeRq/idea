// InventoryReport(と、あれば AI の文章)から Markdown の仕様書を組み立てる。
// 件数・行数・依存の有無はすべて抽出結果から書き、AI には解説文だけを任せる。
import {
  ENTRY_POINT_KIND_LABEL,
  MODULE_TYPE_LABEL,
  PROCEDURE_KIND_LABEL,
  QUERY_TYPE_LABEL,
  SEVERITY_LABEL,
  type InventoryReport,
  type Location,
  type Procedure,
} from "../schema";
import type { AiDocument } from "./aiSchema";
import { MODEL } from "./ai";
import { estimateComplexity, FORMAT_LABEL, formatLocation, groupDependencies } from "./facts";
import { businessFlowDiagram, callFlowDiagram, MAX_GRAPH_NODES, queryDiagram, relationshipDiagram } from "./mermaid";
import { ruleBasedHearingItems, ruleBasedMigrations } from "./migration";

export interface RenderOptions {
  ai?: AiDocument | null;
  /** AI を使おうとして失敗した場合の理由 */
  aiError?: string | null;
}

export const DATA_NOTICE =
  "AIを使う場合、VBAのソースコード・クエリのSQL・シート名などの解析内容が Anthropic 社の API(Claude)に送信されます。セルの値(データ本体)と作成者名は送信しません。接続文字列のパスワードは伏せ字にしてから送信します。";

const cell = (v: unknown) =>
  String(v ?? "")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, "<br>");
const code = (v: string) => (v ? `\`${v.replace(/`/g, "'")}\`` : "");

function table(headers: string[], rows: unknown[][]): string {
  return [`| ${headers.join(" | ")} |`, `| ${headers.map(() => "---").join(" | ")} |`, ...rows.map((r) => `| ${r.map(cell).join(" | ")} |`)].join("\n");
}

function locations(list: Location[], max = 5): string {
  const shown = list.slice(0, max).map(formatLocation).filter(Boolean);
  return shown.join("、") + (list.length > max ? ` ほか${list.length - max}件` : "");
}

export function renderMarkdown(r: InventoryReport, options: RenderOptions = {}): string {
  const ai = options.ai ?? null;
  const out: string[] = [];
  const push = (...lines: string[]) => out.push(...lines);
  let n = 0;
  const section = (title: string) => push(`## ${++n}. ${title}`, "");

  push(`# 棚卸しレポート: ${r.file.name}`, "");
  push(
    `> 生成日時: ${r.generatedAt} / ${r.tool.name} ${r.tool.version}`,
    ai
      ? `> 件数・行数・依存関係は解析結果からの機械的な集計です。概要・業務フロー・リスク評価・移行提案などの文章は AI(${MODEL})による推定を含むため、現場への確認を前提にご覧ください。`
      : `> AIを使わず、解析結果だけで作成した標準レポートです。${options.aiError ? `(AIによる文章生成に失敗したため: ${options.aiError})` : ""}`,
    "",
  );

  // 1. 概要
  const complexity = estimateComplexity(r);
  section("概要");
  push(ai ? ai.overall.overview : standardOverview(r), "");
  push(
    table(
      ["項目", "内容"],
      [
        ["ファイル名", r.file.name],
        ["形式", FORMAT_LABEL[r.file.format]],
        ["サイズ", `${(r.file.sizeBytes / 1024).toFixed(1)} KB`],
        ["SHA-256", code(r.file.sha256)],
        ["作成者 / 最終更新者", `${r.properties.creator ?? "不明"} / ${r.properties.lastModifiedBy ?? "不明"}`],
        ["作成日時 / 最終更新日時", `${r.properties.created ?? "不明"} / ${r.properties.modified ?? "不明"}`],
        ["アプリケーション", [r.properties.application, r.properties.appVersion].filter(Boolean).join(" ") || "不明"],
        ...(r.properties.company ? [["会社名(文書プロパティ)", r.properties.company]] : []),
      ],
    ),
    "",
  );
  push("### 規模", "");
  push(
    table(
      ["シート", "数式", "VBAモジュール", "プロシージャ", "コード行(全行)", "テーブル", "クエリ", "外部依存"],
      [[r.stats.sheetCount, r.stats.formulaCount, r.stats.moduleCount, r.stats.procedureCount, `${r.stats.codeLineCount}(${r.stats.totalLineCount})`, r.stats.tableCount, r.stats.queryCount, r.stats.dependencyCount]],
    ),
    "",
    `移行難易度の機械的な目安: **${complexity.level}**(${complexity.reasons.join(" / ")})`,
    "",
  );

  // 2. 処理の流れ
  section("処理の流れ");
  if (ai && ai.overall.businessFlow.steps.length > 0) {
    push("### 業務フロー(AIによる推定)", "", ai.overall.businessFlow.summary, "", "```mermaid", businessFlowDiagram(ai.overall.businessFlow.steps), "```", "");
  }
  push("### 起動のきっかけ", "");
  if (r.entryPoints.length === 0) push("起動のきっかけ(イベント・ボタン等)は見つかりませんでした。", "");
  else {
    push(
      table(
        ["種類", "きっかけ", "実行されるプロシージャ"],
        r.entryPoints.map((e) => [ENTRY_POINT_KIND_LABEL[e.kind], e.trigger, e.procedure ?? `${e.target}(見つかりません)`]),
      ),
      "",
    );
  }
  const flow = callFlowDiagram(r);
  if (flow) {
    push("### 呼び出し関係図", "", "```mermaid", flow.code, "```", "");
    if (flow.omitted > 0) {
      push(`> 図が大きくなりすぎるため、起動のきっかけに近い ${MAX_GRAPH_NODES} 個のプロシージャだけを描いています(${flow.omitted} 個は省略)。すべての呼び出し関係は「VBAモジュール」のプロシージャ一覧とJSONを参照してください。`, "");
    }
  }

  const queries = queryDiagram(r);
  if (queries) {
    push("### クエリとテーブルの関係図", "", "```mermaid", queries.code, "```", "");
    if (queries.omitted > 0) push(`> 図が大きくなりすぎるため、${queries.omitted} 件のクエリを省略しています。全件は「Access」の一覧を参照してください。`, "");
  }

  if (r.excel) renderExcel(r, push, section);
  if (r.vba && r.vba.modules.length > 0) renderVba(r, ai, push, section);
  if (r.access) renderAccess(r, ai, push, section);

  section("外部依存");
  const groups = groupDependencies(r.dependencies);
  if (groups.length === 0) push("外部への依存は見つかりませんでした。", "");
  for (const g of groups) {
    push(`### ${g.label}(${g.items.reduce((s, i) => s + i.count, 0)}件)`, "");
    push(table(["対象", "区分", "箇所"], g.items.map((i) => [code(i.target), i.category ?? "", locations(i.locations)])), "");
  }

  section("リスク");
  push("### 機械的に検出したリスク", "");
  if (r.findings.length === 0) push("機械的なルールで検出したリスクはありません。", "");
  else {
    push(
      table(
        ["重要度", "内容", "件数", "主な該当箇所", "説明"],
        r.findings.map((f) => [SEVERITY_LABEL[f.severity], `${f.title}(${f.ruleId})`, f.count, locations(f.locations), f.detail]),
      ),
      "",
    );
  }
  if (ai && ai.overall.risks.length > 0) {
    push("### AIによるリスク評価", "");
    push(table(["重要度", "リスク", "内容", "対策", "関連"], ai.overall.risks.map((x) => [x.severity, x.title, x.detail, x.recommendation, x.ruleIds.join(", ")])), "");
  }

  section("移行先候補");
  const migrations = ai ? ai.overall.migrations : ruleBasedMigrations(r);
  if (!ai) push("> AIを使わない場合は、抽出結果の特徴からルールで選んだ目安を示します。", "");
  push(table(["移行先", "適合度", "難易度", "理由", "進め方", "注意点"], migrations.map((m) => [m.target, m.fit, m.difficulty, m.reason, m.approach, m.concerns])), "");
  if (ai) push(`**おすすめの進め方**: ${ai.overall.recommendation}`, "");

  section("現場に確認すること");
  push(...(ai ? ai.overall.hearingItems : ruleBasedHearingItems(r)).map((q) => `- ${q}`), "");

  // 付録
  push("## 付録", "", "### 解析の制約・警告", "");
  const constraints = [
    ...r.warnings,
    "シートのセルの値(データ本体)は読み取っていません。数式・構造・コードのみを対象にしています。",
    "呼び出し関係は静的な解析です。文字列を組み立てて実行するマクロ名や、オブジェクト変数経由のクラスメソッド呼び出しは検出できないことがあります。",
  ];
  push(...constraints.map((w) => `- ${w}`), "");
  if (ai) {
    push("### AIへの入力について", "", `- ${DATA_NOTICE}`, ...ai.notes.map((n) => `- ${n}`), "");
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

function standardOverview(r: InventoryReport): string {
  const parts: string[] = [`このファイルは${FORMAT_LABEL[r.file.format]}です。`];
  if (r.excel) parts.push(`シート ${r.stats.sheetCount} 枚、数式 ${r.stats.formulaCount} 個を含みます。`);
  if (r.stats.moduleCount > 0) {
    parts.push(`VBAはモジュール ${r.stats.moduleCount} 個、プロシージャ ${r.stats.procedureCount} 個(コード ${r.stats.codeLineCount} 行)です。`);
  }
  if (r.access) parts.push(`Accessのテーブル ${r.stats.tableCount} 個、保存済みクエリ ${r.stats.queryCount} 個を含みます。`);
  const sev = (s: string) => r.findings.filter((f) => f.severity === s).length;
  parts.push(
    `起動のきっかけは ${r.entryPoints.length} 件、外部依存は ${r.stats.dependencyCount} 件、機械的に検出したリスクは 高 ${sev("high")}・中 ${sev("medium")}・低 ${sev("low")} 件です。`,
  );
  return parts.join("");
}

type Push = (...lines: string[]) => void;
type Section = (title: string) => void;

function renderExcel(r: InventoryReport, push: Push, section: Section) {
  const x = r.excel!;
  section("シート構成");
  const stateLabel = { visible: "表示", hidden: "非表示", veryHidden: "完全に非表示" };
  const kindLabel = { worksheet: "ワークシート", chartsheet: "グラフ", dialogsheet: "ダイアログ", macrosheet: "マクロシート(XLM)" };
  push(
    table(
      ["#", "シート名", "コード名", "種類", "表示", "使用範囲", "数式", "代表的な数式"],
      x.sheets.map((s) => [
        s.index + 1,
        s.name,
        s.codeName ?? "",
        kindLabel[s.kind],
        stateLabel[s.state],
        s.usedRange ?? "",
        s.formulaCount,
        s.formulaSamples.map((f) => `${f.cell ? `${f.cell}: ` : ""}${code(f.formula)}`).join("<br>"),
      ]),
    ),
    "",
  );
  if (!x.formulaTextAvailable) push("> この形式では数式の件数のみを数えています(式の内容は取り出していません)。", "");

  const names = x.definedNames.filter((n) => !n.builtIn);
  const builtIn = x.definedNames.length - names.length;
  push("### 名前定義", "");
  if (names.length === 0) push(`ユーザー定義の名前はありません${builtIn > 0 ? `(印刷範囲などの組み込みの名前 ${builtIn} 件)` : ""}。`, "");
  else {
    push(table(["名前", "範囲", "参照先", "非表示"], names.map((n) => [n.name, n.scope ?? "ブック", code(n.refersTo ?? ""), n.hidden ? "はい" : ""])), "");
    if (builtIn > 0) push(`このほか、印刷範囲などの組み込みの名前が ${builtIn} 件あります。`, "");
  }
  if (x.externalLinks.length > 0) {
    push("### 外部リンク(他ブックの参照)", "", table(["#", "種類", "参照先", "シート"], x.externalLinks.map((l) => [l.index, l.type, code(l.target), l.sheetNames.join("、")])), "");
  }
  if (x.connections.length > 0) {
    push("### データ接続", "", table(["名前", "種類", "接続文字列(パスワードは伏せ字)", "コマンド"], x.connections.map((c) => [c.name, c.type, code(c.connectionString ?? ""), code(c.command ?? "")])), "");
  }
  if (x.controlMacros.length > 0) {
    push("### ボタン・図形に登録されたマクロ", "", table(["シート", "コントロール", "表示文字", "マクロ"], x.controlMacros.map((c) => [c.sheet, c.control, c.text ?? "", c.macro])), "");
  }
}

function renderVba(r: InventoryReport, ai: AiDocument | null, push: Push, section: Section) {
  const v = r.vba!;
  section("VBAモジュール");
  push(
    `VBAプロジェクト「${v.name}」/ 文字コード ${v.encoding}(コードページ ${v.codePage})${v.lockedForViewing ? " / 表示用にロックされています(解析は可能)" : ""}`,
    "",
  );
  push(
    table(
      ["モジュール", "種別", "行数", "プロシージャ", "Option Explicit", "概要"],
      v.modules.map((m) => [m.name, MODULE_TYPE_LABEL[m.type], m.lineCount, m.procedures.length, m.hasOptionExplicit ? "あり" : "なし", ai?.modules.get(m.name)?.purpose ?? ""]),
    ),
    "",
  );
  if (v.references.length > 0) {
    push("### 参照設定", "", table(["名前", "ライブラリ", "パス"], v.references.map((x) => [x.name, x.description ?? "", code(x.path ?? x.libid)])), "");
  }
  push("### プロシージャ一覧", "");
  for (const m of v.modules) {
    if (m.procedures.length === 0) continue;
    const narrative = ai?.modules.get(m.name);
    push(`#### ${m.name}(${MODULE_TYPE_LABEL[m.type]})`, "");
    if (narrative?.purpose) push(narrative.purpose, "");
    if (narrative && narrative.concerns.length > 0) push(...narrative.concerns.map((c) => `- 気になる点: ${c}`), "");
    push(
      table(
        ["プロシージャ", "種類", "スコープ", "行", "引数", "エラー処理", "呼び出し先", "呼び出し元", ...(ai ? ["概要"] : [])],
        m.procedures.map((p) => [
          p.isEvent ? `${p.name}(イベント: ${p.eventLabel})` : p.name,
          PROCEDURE_KIND_LABEL[p.kind] + (p.returnType ? ` → ${p.returnType}` : ""),
          p.scope === "private" ? "Private" : p.scope === "friend" ? "Friend" : "Public",
          `${p.startLine}〜${p.endLine}`,
          paramsText(p),
          { handler: "あり", resumeNext: "Resume Next", none: "なし" }[p.errorHandling],
          p.calls.join("<br>"),
          p.calledBy.join("<br>"),
          ...(ai ? [narrative?.procedures.get(p.name) ?? ""] : []),
        ]),
      ),
      "",
    );
  }
}

function paramsText(p: Procedure): string {
  return p.params
    .map((x) => `${x.optional ? "Optional " : ""}${x.paramArray ? "ParamArray " : ""}${x.name}${x.isArray ? "()" : ""}${x.type ? ` As ${x.type}` : ""}`)
    .join(", ");
}

function renderAccess(r: InventoryReport, ai: AiDocument | null, push: Push, section: Section) {
  const a = r.access!;
  section("Access");
  push(`データベースエンジン: ${a.engine}`, "");
  push("### テーブル", "");
  if (a.tables.length === 0) push("ローカルのテーブルはありません。", "");
  else {
    push(table(["テーブル", "件数", "列数", "列(型)"], a.tables.map((t) => [t.name, t.rowCount, t.columns.length, t.columns.map((c) => `${c.name}: ${c.type}${c.autoNumber ? "(自動採番)" : ""}`).join("<br>")])), "");
  }
  if (a.linkedTables.length > 0) {
    push("### リンクテーブル", "", table(["名前", "種類", "参照先テーブル", "参照先", "接続文字列(パスワードは伏せ字)"], a.linkedTables.map((t) => [t.name, t.kind, t.sourceTable ?? "", code(t.database ?? ""), code(t.connect ?? "")])), "");
  }
  if (a.relationships.length > 0) {
    push(
      "### リレーションシップ",
      "",
      table(
        ["名前", "主テーブル", "関連テーブル", "参照整合性", "連鎖更新", "連鎖削除"],
        a.relationships.map((x) => [x.name, `${x.primaryTable}(${x.primaryColumns.join(", ")})`, `${x.foreignTable}(${x.foreignColumns.join(", ")})`, x.enforced ? "あり" : "なし", x.cascadeUpdate ? "あり" : "", x.cascadeDelete ? "あり" : ""]),
      ),
      "",
    );
    const diagram = relationshipDiagram(r);
    if (diagram) push("```mermaid", diagram, "```", "");
  }
  const visible = a.queries.filter((q) => !q.hidden);
  push("### 保存済みクエリ", "");
  if (visible.length === 0) push("保存済みクエリはありません。", "");
  else {
    const summaries = ai?.modules.get("保存済みクエリ")?.procedures;
    push(table(["クエリ", "種類", "参照", ...(summaries ? ["概要"] : [])], visible.map((q) => [q.name, QUERY_TYPE_LABEL[q.type], q.tables.join("、"), ...(summaries ? [summaries.get(q.name) ?? ""] : [])])), "");
    for (const q of visible) {
      push(`<details><summary>${q.name} の SQL</summary>`, "", "```sql", q.sql ?? "-- SQLを復元できませんでした", "```", "", "</details>", "");
    }
  }
  const hidden = a.queries.length - visible.length;
  if (hidden > 0) push(`このほか、フォーム・レポートが内部で使うクエリが ${hidden} 件あります。`, "");
  push(
    "### フォーム・レポート・マクロ・モジュール",
    "",
    table(
      ["種類", "件数", "名前"],
      [
        ["フォーム", a.forms.length, a.forms.join("、")],
        ["レポート", a.reports.length, a.reports.join("、")],
        ["マクロ", a.macros.length, a.macros.join("、")],
        ["モジュール", a.modules.length, a.modules.join("、")],
      ],
    ),
    "",
    `VBA: ${{ extracted: "抽出済み(「VBAモジュール」を参照)", none: "なし", failed: "読み取りに失敗しました" }[a.vbaStatus]}`,
    "",
  );
}

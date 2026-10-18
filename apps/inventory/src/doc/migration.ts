// AI を使わないときの移行先候補とヒアリング項目。抽出結果の特徴からルールで決める。
import type { InventoryReport } from "../schema";
import { estimateComplexity, type Level } from "./facts";

export interface MigrationSuggestion {
  target: string;
  fit: Level;
  difficulty: Level;
  reason: string;
  approach: string;
  concerns: string;
}

const FIT_ORDER: Record<Level, number> = { 高: 0, 中: 1, 低: 2 };

export function ruleBasedMigrations(r: InventoryReport): MigrationSuggestion[] {
  const base = estimateComplexity(r).level;
  const has = (pred: (d: InventoryReport["dependencies"][number]) => boolean) => r.dependencies.some(pred);
  const tables = r.access?.tables.length ?? 0;
  const forms = (r.access?.forms.length ?? 0) + (r.vba?.modules.filter((m) => m.type === "form").length ?? 0);
  const mail = has((d) => d.category === "メール送信");
  const files = has((d) => ["fileIo", "workbook", "filePath", "externalLink"].includes(d.kind));
  const db = has((d) => ["connectionString", "dataConnection", "linkedTable"].includes(d.kind) || d.category === "データベース接続");
  const screen = has((d) => d.kind === "sendKeys" || d.category?.startsWith("Internet Explorer") === true);
  const lines = r.stats.codeLineCount;
  const list: MigrationSuggestion[] = [];

  if (tables > 0 || forms > 0) {
    const parts = [tables > 0 ? `テーブル ${tables} 個` : "", forms > 0 ? `入力画面 ${forms} 個` : ""].filter(Boolean).join("と");
    list.push({
      target: "ノーコード業務アプリ(kintone 等)",
      fit: tables > 0 && forms > 0 ? "高" : "中",
      difficulty: base,
      reason: `${parts}があり、データの登録・一覧・検索が中心であれば、ノーコードの業務アプリに置き換えやすい構成です。`,
      approach: "テーブルごとにアプリを作り、既存データをCSVで移します。集計・帳票は標準機能かプラグインで代替できるか確認します。",
      concerns: "複雑な計算やバッチ処理は、別の仕組み(連携サービスやスクリプト)が必要になることがあります。",
    });
  }
  if (mail || files || screen) {
    const features = [files ? "ファイルの読み書き・受け渡し" : "", mail ? "メール送信" : "", screen ? "画面操作" : ""].filter(Boolean).join("・");
    list.push({
      target: "Power Automate(クラウドフロー / デスクトップフロー)",
      fit: mail || screen ? "高" : "中",
      difficulty: screen ? "中" : base === "高" ? "中" : "低",
      reason: `${features}など、決まった手順の繰り返しを自動化している部分があります。`,
      approach: "手順を一つずつ書き出し、ファイル操作とメール送信はクラウドフロー、画面操作が必要な部分はデスクトップフローに移します。",
      concerns: "共有フォルダのパスや、操作対象のシステムの画面が変わると止まるため、保存場所を整理してから移すのが安全です。",
    });
  }
  if (lines >= 300 || db) {
    list.push({
      target: "Python(pandas 等によるデータ処理)",
      fit: lines >= 2_000 || db ? "高" : "中",
      difficulty: base,
      reason: "集計・データ加工のロジックがコードとしてまとまっており、テストしやすい形で書き直せます。",
      approach: "まず入出力のファイルとDBを確定し、処理ごとに関数へ分けて移植します。既存の出力と突き合わせて結果を確認します。",
      concerns: "利用者がボタンで実行していた操作の代わり(画面・実行スケジュール)を別途用意する必要があります。",
    });
  }
  if (r.stats.formulaCount >= 100 && lines < 300) {
    list.push({
      target: "Excel のまま整理(テーブル・関数・Office スクリプト)",
      fit: "高",
      difficulty: "低",
      reason: "処理の中心が数式で、マクロは補助的です。作り直すより整理する方が費用対効果が高い可能性があります。",
      approach: "数式をテーブル機能と名前付き範囲で読みやすくし、マクロの処理は関数や Office スクリプトに置き換えます。",
      concerns: "ファイルの置き場所と編集できる人を決めないと、再び属人化します。",
    });
  }
  list.push({
    target: "業務SaaS(販売管理・会計・勤怠など)",
    fit: "中",
    difficulty: "中",
    reason: "業務が一般的な販売・会計・勤怠などに当てはまるなら、作り直すより既製のサービスに合わせる方が保守の負担が減ります。",
    approach: "現在の業務フローと帳票を書き出し、候補のサービスで代替できる範囲と、運用を変える部分を整理します。",
    concerns: "自社独自のルールが多い場合は、カスタマイズ費用や運用変更の負担を見積もってください。",
  });
  return list.sort((a, b) => FIT_ORDER[a.fit] - FIT_ORDER[b.fit]).slice(0, 4);
}

export function ruleBasedHearingItems(r: InventoryReport): string[] {
  const items: string[] = ["このファイルを使っている部署・人数と、止まった場合に困る業務は何ですか?"];
  const paths = [...new Set(r.dependencies.filter((d) => d.kind === "filePath" && d.category !== "ファイル名").map((d) => d.target))];
  for (const p of paths.slice(0, 5)) items.push(`コードに書かれているパス「${p}」は今も使われていますか?移行後はどこに置きますか?`);
  if (paths.length > 5) items.push(`ほかにもハードコードされたパスが ${paths.length - 5} 件あります。それぞれ現在も有効か確認が必要です。`);
  for (const l of r.excel?.externalLinks ?? []) items.push(`参照先のブック「${l.target}」は誰が管理していますか?`);
  for (const c of r.excel?.connections ?? []) items.push(`データ接続「${c.name}」の接続先と、認証情報の管理者は誰ですか?`);
  for (const t of r.access?.linkedTables ?? []) items.push(`リンクテーブル「${t.name}」の参照先(${t.database ?? t.connect ?? "不明"})は誰が管理していますか?`);
  for (const e of r.entryPoints.filter((x) => x.kind === "button").slice(0, 5)) items.push(`ボタン操作(${e.trigger})は、誰が・どのくらいの頻度で行っていますか?`);
  const manual = r.entryPoints.filter((x) => x.kind === "macro");
  if (manual.length > 0) {
    items.push(`手動実行と思われるマクロ(${manual.slice(0, 5).map((e) => e.target).join("、")}${manual.length > 5 ? " ほか" : ""})は、今も使っていますか?`);
  }
  if (r.vba?.lockedForViewing) items.push("VBAプロジェクトのパスワードを知っている人はいますか?");
  items.push("最後にこのファイルを修正したのは誰で、いつ頃ですか?");
  return items;
}

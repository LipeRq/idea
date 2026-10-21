// AI 版で送信する前に、抽出結果から送らない項目を外す(Worker で作る送信内容と、サーバーでの再適用の両方で使う)。
// ここで外すのは「構造として分かっている項目」だけ。コード・コメント・数式・パスの中に書かれた氏名・メールアドレス・
// APIキーなどは外せない(そのまま送られる)ので、同意画面で sensitive-scan の結果と合わせて利用者に示す。
import type { InventoryReport } from "@engine/browser";

export const AI_FILE_BASENAME = "対象ファイル";

export function redactForAi(report: InventoryReport, includeSource: boolean): InventoryReport {
  return {
    ...report,
    file: { ...report.file, name: `${AI_FILE_BASENAME}.${report.file.format}`, sha256: "" },
    properties: { ...report.properties, title: null, creator: null, lastModifiedBy: null, company: null },
    vba:
      report.vba && !includeSource
        ? { ...report.vba, modules: report.vba.modules.map((m) => ({ ...m, source: null })) }
        : report.vba,
    access:
      report.access && !includeSource
        ? { ...report.access, queries: report.access.queries.map((q) => ({ ...q, sql: null })) }
        : report.access,
    warnings: [],
  };
}

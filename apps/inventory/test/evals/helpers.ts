import type { AiDocument, ModuleNarrative } from "../../src/doc/aiSchema";
import { buildUnits } from "../../src/doc/chunk";
import type { InventoryReport } from "../../src/schema";

/**
 * 抽出結果から作る「事実だけを書いた」AIの文章(評価の動作確認用のオラクル)。
 * 名前・数値は書かず、機械検出リスクはすべて ruleIds に挙げ、プロシージャはすべて要約する。
 */
export function oracleDocument(report: InventoryReport): AiDocument {
  const modules = new Map<string, ModuleNarrative>();
  for (const u of buildUnits(report)) {
    const m = modules.get(u.name) ?? { purpose: "業務の処理をまとめたものと思われます。", concerns: [], procedures: new Map<string, string>() };
    for (const p of u.procedures) m.procedures.set(p, "入力を確認して処理するものと思われます。");
    modules.set(u.name, m);
  }
  return {
    modules,
    notes: [],
    overall: {
      overview: "営業や経理の担当者が、日々の入力と集計に使う仕組みと思われます。",
      businessFlow: {
        summary: "利用者が入力し、マクロが処理を行う流れと推定されます。",
        steps: [
          { id: "s1", label: "利用者が入力する", actor: "利用者", next: ["s2"] },
          { id: "s2", label: "マクロが処理する", actor: "マクロ", next: ["s3"] },
          { id: "s3", label: "結果を保存する", actor: "外部システム", next: [] },
        ],
      },
      risks: [
        ...report.findings.map((f) => ({ title: "リスク", severity: "高" as const, detail: "担当者が替わると保守できなくなるおそれがあります。", ruleIds: [f.ruleId], recommendation: "対策を検討してください。" })),
        ...[1, 2, 3].map(() => ({ title: "属人化", severity: "中" as const, detail: "作った人以外が中身を知りません。", ruleIds: [], recommendation: "手順を文書にしてください。" })),
      ].slice(0, 8),
      migrations: [1, 2].map(() => ({ target: "ノーコード業務アプリ(例)", fit: "高" as const, difficulty: "中" as const, reason: "入力と一覧が中心のため。", approach: "段階的に置き換えます。", concerns: "帳票の再現に手間がかかります。" })),
      recommendation: "現状の手順を記録してから、段階的に置き換えることをおすすめします。",
      hearingItems: ["いつから使っていますか。", "止まったときは誰が対応しますか。", "月末の運用手順はありますか。"],
    },
  };
}

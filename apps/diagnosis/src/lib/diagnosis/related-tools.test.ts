import { describe, expect, it } from "vitest";
import {
  INVENTORY_DATA_WORK_HOURS,
  QUOTE_DOCUMENT_HOURS,
  RELATED_TOOL_REASONS,
  recommendRelatedTools,
} from "./related-tools";
import type { DiagnosisInput } from "./schema";

// どのルールにも当てはまらない入力(製造業以外・議事録だけ・準備度すべて最高・自由記述なし)
const base: DiagnosisInput = {
  industry: "卸売・小売業",
  employees: "31〜100名",
  hourlyCost: 3_000,
  taskHours: { minutes: 100 },
  readiness: { dataLocation: 3, manuals: 3, aiUsage: 3, itStaff: 3, rules: 3, leadership: 3 },
  goals: [],
};

function input(overrides: Partial<DiagnosisInput>): DiagnosisInput {
  return { ...base, ...overrides };
}

const ids = (i: DiagnosisInput) => recommendRelatedTools(i).map((r) => r.id);
const reasonIds = (i: DiagnosisInput) =>
  Object.fromEntries(recommendRelatedTools(i).map((r) => [r.id, r.reasonIds]));

describe("recommendRelatedTools", () => {
  it("どのルールにも当てはまらなければ案内しない", () => {
    expect(recommendRelatedTools(base)).toEqual([]);
    // 製造業でも、見積の工数が少なく記述もなければ案内しない
    expect(recommendRelatedTools(input({ industry: "製造業", taskHours: { documents: QUOTE_DOCUMENT_HOURS - 1 } }))).toEqual([]);
  });

  describe("棚卸しツール(Excelマクロ・Access)", () => {
    it.each([
      "Excelのマクロが動かなくなった",
      "エクセルで管理している",
      "VBAを書いた人が退職した",
      "Accessの顧客台帳",
      "受注管理が属人化している",
      "担当者の引き継ぎができない",
      "引継ぎ資料がない",
      // 全角の英字も同じに扱う
      "EXCELとＶＢＡ",
      "請求書.xlsmの中身が分からない",
    ])("「いま困っていること」に兆候がある:%s", (challenges) => {
      expect(reasonIds(input({ challenges }))).toEqual({ inventoryTool: ["inventoryKeyword"] });
    });

    it("関係のない記述では案内しない", () => {
      expect(ids(input({ challenges: "問い合わせの返信に時間がかかる" }))).toEqual([]);
    });

    it("データ入力・集計の工数が大きく、業務データの保存場所が低い(紙・個人PCのExcel)ときに案内する", () => {
      const half = INVENTORY_DATA_WORK_HOURS / 2;
      const heavy = { dataEntry: half, reporting: half };
      for (const dataLocation of [0, 1]) {
        expect(
          reasonIds(input({ taskHours: heavy, readiness: { ...base.readiness, dataLocation } })),
        ).toEqual({ inventoryTool: ["inventoryDataWork"] });
      }
      // 保存場所が共有フォルダ以上なら案内しない
      expect(ids(input({ taskHours: heavy, readiness: { ...base.readiness, dataLocation: 2 } }))).toEqual([]);
      // 工数がしきい値に届かなければ案内しない
      expect(
        ids(
          input({
            taskHours: { dataEntry: half, reporting: half - 1 },
            readiness: { ...base.readiness, dataLocation: 0 },
          }),
        ),
      ).toEqual([]);
    });

    it("「属人化の解消」を優先し、業務データが個人PCのExcel・Wordが中心のときに案内する", () => {
      expect(
        reasonIds(input({ goals: ["属人化の解消"], readiness: { ...base.readiness, dataLocation: 1 } })),
      ).toEqual({ inventoryTool: ["inventoryGoal"] });
      // 紙が中心・共有フォルダ以上なら、この理由では案内しない
      for (const dataLocation of [0, 2, 3]) {
        expect(ids(input({ goals: ["属人化の解消"], readiness: { ...base.readiness, dataLocation } }))).toEqual([]);
      }
    });
  });

  describe("見積アシストのデモ", () => {
    it("製造業で、見積書・提案書の作成の工数がしきい値以上なら案内する", () => {
      expect(
        reasonIds(input({ industry: "製造業", taskHours: { documents: QUOTE_DOCUMENT_HOURS } })),
      ).toEqual({ quoteAssistDemo: ["quoteDocumentHours"] });
    });

    it("製造業で、「いま困っていること」に見積の記述があれば案内する", () => {
      for (const challenges of ["見積書の作成に時間がかかる", "見積もりの回答が遅い", "原価の積算が属人的"]) {
        expect(ids(input({ industry: "製造業", challenges }))).toContain("quoteAssistDemo");
      }
    });

    it("製造業以外では、見積の工数や記述があっても案内しない", () => {
      expect(
        ids(input({ industry: "建設業", taskHours: { documents: 100 }, challenges: "見積が大変" })),
      ).toEqual([]);
    });
  });

  it("複数のルールに当てはまれば、理由をすべて並べる。順番は棚卸しツール → 見積アシスト", () => {
    const recs = recommendRelatedTools(
      input({
        industry: "製造業",
        taskHours: { documents: 30, dataEntry: 30, reporting: 20 },
        readiness: { ...base.readiness, dataLocation: 1 },
        goals: ["属人化の解消"],
        challenges: "Excelマクロで作った見積の仕組みが属人化している",
      }),
    );
    expect(recs.map((r) => [r.id, r.reasonIds])).toEqual([
      ["inventoryTool", ["inventoryKeyword", "inventoryDataWork", "inventoryGoal"]],
      ["quoteAssistDemo", ["quoteDocumentHours", "quoteKeyword"]],
    ]);
    expect(recs[0].reasons).toEqual([
      RELATED_TOOL_REASONS.inventoryKeyword,
      RELATED_TOOL_REASONS.inventoryDataWork,
      RELATED_TOOL_REASONS.inventoryGoal,
    ]);
    expect(recs[1].leadTopic).toBe("見積アシストのデモ希望");
  });

  it("理由の文言に、入力した文章を引用しない", () => {
    const challenges = "株式会社秘密のExcelマクロと見積";
    const recs = recommendRelatedTools(input({ industry: "製造業", challenges }));
    expect(recs).toHaveLength(2);
    expect(JSON.stringify(recs)).not.toContain("秘密");
  });
});

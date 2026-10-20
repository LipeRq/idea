import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  BacklogItemSchema,
  CompanySchema,
  CustomerSchema,
  DefectSchema,
  PastCaseSchema,
  RateTableSchema,
  type BacklogItem,
  type Company,
  type Customer,
  type Defect,
  type PastCase,
  type RateTable,
} from "../domain/reference";

// 参照データ(単価表・顧客・過去案件など)の読み込み。JSONファイルを差し替えれば計算・検索の結果が変わる。
// 次段階では同じ形を返す実装(顧客のDB、Salesforceの取引先など)に置き換える。

export type ReferenceData = {
  rates: RateTable;
  customers: Customer[];
  cases: PastCase[];
  defects: Defect[];
  company: Company;
  backlog: BacklogItem[];
};

const FILES = {
  rates: ["rate-table.json", RateTableSchema],
  customers: ["customers.json", z.array(CustomerSchema)],
  cases: ["past-cases.json", z.array(PastCaseSchema)],
  defects: ["defects.json", z.array(DefectSchema)],
  company: ["company.json", CompanySchema],
  backlog: ["backlog.json", z.array(BacklogItemSchema)],
} as const;

// 読み込み先は実行時の環境変数で決まるため、ビルド時のファイルトレースからは外す(turbopackIgnore)
export function referenceDir(): string {
  return process.env.QUOTE_ASSIST_REFERENCE_DIR || path.join(process.cwd(), "data");
}

let cached: { key: string; data: ReferenceData } | null = null;

export async function loadReferenceData(dir = referenceDir()): Promise<ReferenceData> {
  // ファイルの更新時刻が変わったときだけ読み直す
  const entries = Object.entries(FILES) as [keyof ReferenceData, (typeof FILES)[keyof ReferenceData]][];
  const mtimes = await Promise.all(entries.map(([, [file]]) => stat(/*turbopackIgnore: true*/ path.join(/*turbopackIgnore: true*/ dir, file)).then((s) => s.mtimeMs)));
  const key = `${dir}:${mtimes.join(",")}`;
  if (cached?.key === key) return cached.data;

  const loaded = await Promise.all(
    entries.map(async ([name, [file, schema]]) => {
      const text = await readFile(/*turbopackIgnore: true*/ path.join(/*turbopackIgnore: true*/ dir, file), "utf8");
      const result = schema.safeParse(JSON.parse(text));
      if (!result.success) {
        throw new Error(`参照データ ${file} の形式が正しくありません: ${result.error.issues[0]?.message}`);
      }
      return [name, result.data] as const;
    }),
  );
  const data = Object.fromEntries(loaded) as ReferenceData;
  checkReferences(data);
  cached = { key, data };
  return data;
}

/**
 * 単価表のidの重複と、過去案件が単価表にない材質・工程を参照していないか(差し替え時の取り違えを早めに見つける)。
 * 重複があると、計算は先に書かれた行だけを使うため、画面の単価表と金額が食い違う。
 */
export function checkReferences(data: ReferenceData): void {
  const { rates } = data;
  const duplicate = (ids: (string | number)[]) => ids.find((id, i) => ids.indexOf(id) !== i);
  for (const [label, ids] of [
    ["材料", rates.materials.map((m) => m.id)],
    ["工程", rates.processes.map((p) => p.id)],
    ["表面処理・熱処理", rates.treatments.map((t) => t.id)],
    ["数量係数の下限数量", rates.rules.quantityBreaks.map((b) => b.minQty)],
  ] as const) {
    const dup = duplicate([...ids]);
    if (dup !== undefined) throw new Error(`単価表(${label})のid「${dup}」が重複しています`);
  }
  const materials = new Set(data.rates.materials.map((m) => m.id));
  const processes = new Set(data.rates.processes.map((p) => p.id));
  const treatments = new Set(data.rates.treatments.map((t) => t.id));
  for (const c of data.cases) {
    const bad =
      !materials.has(c.materialId) ||
      c.estimatedProcesses.some((p) => !processes.has(p.processId)) ||
      [c.surfaceTreatmentId, c.heatTreatmentId].some((t) => t !== null && !treatments.has(t));
    if (bad) throw new Error(`過去案件 ${c.id} が単価表にない材質・工程・処理を参照しています`);
  }
}

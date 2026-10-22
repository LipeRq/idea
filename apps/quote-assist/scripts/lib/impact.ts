import { addBusinessDays, addDays } from "../../src/lib/dates";
import type { BaselineRow, CaseRecord } from "../../src/lib/domain/impact";
import { FIELD_KEYS } from "../../src/lib/domain/inquiry";
import { customers } from "./masters";
import { createRandom, type Random } from "./random";

// 効果測定ダッシュボードのデモ用の合成データ(すべて架空)。
//   導入前:記録シート(PoC計画書 5章)に4週間記録した、という設定の40件ほど
//   導入後:試験導入の6週間に、見積アシストが残した記録、という設定の60件
// 数字は「ダッシュボードの見え方を確かめる」ためのもので、実在の会社・調査の数字ではない。
// 導入後は、週を追うごとに少しずつ慣れて数字が良くなる、という筋にしている(実際の効果を示すものではない)。

const PART_NAMES = [
  "ストッパブロック",
  "位置決めピン",
  "センサブラケット",
  "ガイドプレート",
  "スペーサ",
  "カバープレート",
  "シャフト",
  "フランジ",
  "ブッシュ",
  "取付ベース",
  "クランプ金具",
  "ハウジング",
];

const ESTIMATOR_NAMES = ["代表取締役 白石", "工場長 森"] as const;
const NON_ESTIMATOR_NAMES = [
  ["営業部 青木", 7],
  ["技術課 田村", 3],
] as const;

export const BASELINE_START = "2026-07-06"; // 月曜
export const PILOT_START = "2026-09-07"; // 月曜
/** 導入後の記録の「いま」。結果・実績の記録が入っているかを、この日からの経過日数で決める */
const PILOT_AS_OF = "2026-10-19";

type Kind = "new" | "repeat" | "revision";

const clampInt = (v: number, min: number, max: number) => Math.min(max, Math.max(min, Math.round(v)));
const roundStep = (v: number, step: number) => Math.round(v / step) * step;

function weekdayOfWeek(rand: Random, weekStart: string): string {
  // 月曜と火曜が多い
  const offset = rand.weighted([
    [0, 26],
    [1, 24],
    [2, 18],
    [3, 17],
    [4, 15],
  ] as const);
  return addDays(weekStart, offset);
}

function daysSince(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

// ---- 導入前の記録シート ----

export function generateBaseline(seed = 20260724): { estimators: string[]; note: string; rows: BaselineRow[] } {
  const rand = createRandom(seed);
  const weekCounts = [9, 11, 10, 10]; // 4週間・40件
  const rows: BaselineRow[] = [];
  weekCounts.forEach((count, w) => {
    const weekStart = addDays(BASELINE_START, w * 7);
    for (let i = 0; i < count; i++) {
      const receivedAt = weekdayOfWeek(rand, weekStart);
      const kind: Kind = rand.weighted([["new", 35], ["repeat", 45], ["revision", 20]] as const);
      const estimator = rand.chance(0.17) ? rand.weighted(NON_ESTIMATOR_NAMES.map(([n, wt]) => [n, wt] as const)) : rand.pick(ESTIMATOR_NAMES);
      const inquiry = rand.chance(0.35);
      const estimatorMinutes = Math.max(15, roundStep(rand.normal({ new: 95, repeat: 42, revision: 62 }[kind], 20), 5));
      const salesMinutes = Math.max(5, roundStep(rand.normal(18, 6), 5));
      const days = clampInt(rand.normal(4.2, 1.5) + { new: 1, repeat: -1, revision: 0 }[kind] + (inquiry ? 1 : 0), 1, 12);
      // 最後の週の2件は、回答しないまま取り下げられた
      const withdrawn = w === 3 && i >= count - 2;
      const answeredAt = withdrawn ? null : addBusinessDays(receivedAt, days);
      const result: BaselineRow["result"] = withdrawn ? null : rand.chance(0.41) ? "won" : "lost";
      const row: BaselineRow = {
        receivedAt,
        customer: rand.pick(customers).name,
        partName: `${rand.pick(PART_NAMES)} ${rand.pick(["MS", "KM", "SK", "TY"])}-${rand.int(1000, 9999)}`,
        kind,
        drawingCount: rand.weighted([[1, 50], [2, 35], [3, 15]] as const),
        estimator,
        salesMinutes,
        estimatorMinutes,
        answeredAt,
        customerInquiry: inquiry,
        result,
        memo: withdrawn ? "回答前に取り下げ" : rand.chance(0.15) ? "営業の時間は推定" : "",
        orderAmount: null,
        quotedCost: null,
        actualCost: null,
        reworkCount: null,
      };
      if (result === "won") {
        const orderAmount = roundStep(Math.exp(rand.normal(Math.log(420_000), 0.7)), 1000);
        const quotedCost = roundStep(orderAmount * rand.between(0.78, 0.84), 1000);
        // 見積原価に対する実績原価:平均で約10%の超過(約2割が赤字になる)
        const actualCost = roundStep(quotedCost * (1 + rand.normal(0.10, 0.13)), 1000);
        row.orderAmount = Math.max(50_000, orderAmount);
        row.quotedCost = Math.max(40_000, quotedCost);
        row.actualCost = Math.max(40_000, actualCost);
        row.reworkCount = rand.weighted([[0, 68], [1, 22], [2, 10]] as const);
      }
      rows.push(row);
    }
  });
  rows.sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));
  return {
    estimators: [...ESTIMATOR_NAMES],
    note: "架空のベースライン。しらかば精工が2026年7月に4週間、記録シートへ記入した、という設定のデモ用データです。",
    rows,
  };
}

// ---- 導入後(見積アシストの記録) ----

/** 抽出項目の手修正の起こりやすさ(読み取りにくい項目ほど高い。架空) */
const FIELD_EDIT_RATE: Record<(typeof FIELD_KEYS)[number], number> = {
  customerName: 0.02,
  partName: 0.05,
  drawingNumber: 0.04,
  revision: 0.06,
  material: 0.08,
  quantity: 0.03,
  dimensions: 0.18,
  tolerance: 0.22,
  surfaceTreatment: 0.15,
  heatTreatment: 0.28,
  dueDate: 0.06,
  inspection: 0.25,
  processType: 0.04,
};

const QUOTE_EDIT_RATE = {
  "quote:material": 0.07,
  "quote:quantity": 0.03,
  "quote:treatments": 0.12,
  "quote:profitRate": 0.25,
  "quote:expedite": 0.06,
} as const;

export function generatePilot(seed = 20260941): { note: string; records: CaseRecord[] } {
  const rand = createRandom(seed);
  const weekCounts = [8, 10, 12, 9, 11, 10]; // 6週間・60件
  const records: CaseRecord[] = [];
  let seq = 0;
  weekCounts.forEach((count, w) => {
    const progress = w / (weekCounts.length - 1); // 0〜1。慣れて数字が少しずつ良くなる
    const weekStart = addDays(PILOT_START, w * 7);
    for (let i = 0; i < count; i++) {
      seq++;
      const receivedAt = weekdayOfWeek(rand, weekStart);
      const kind: Kind = rand.weighted([["new", 35], ["repeat", 45], ["revision", 20]] as const);
      const nonEstimator = rand.chance(0.26 + 0.2 * progress);
      const operator = nonEstimator ? rand.weighted(NON_ESTIMATOR_NAMES.map(([n, wt]) => [n, wt] as const)) : rand.pick(ESTIMATOR_NAMES);
      const inquiry = rand.chance(0.3);

      // 最後の週の後半に受け付けた分は、まだ回答(承認)していない
      const open = w === 5 && receivedAt > addDays(PILOT_START, 5 * 7 + 1);
      const days = clampInt(rand.normal(2.7 - 0.5 * progress, 1.0) + { new: 0.8, repeat: -0.5, revision: 0 }[kind] + (inquiry ? 0.7 : 0), 0, 9);
      const answeredAt = open ? null : addBusinessDays(receivedAt, days);
      const workMinutes = open
        ? null
        : Math.max(8, Math.round(rand.normal({ new: 62, repeat: 28, revision: 40 }[kind] * (1 - 0.12 * progress), 9)));

      const aiCostJpy = clampInt(rand.normal(135, 28), 70, 260);
      const aiTokens = Math.round(aiCostJpy * rand.between(205, 235));
      const record: CaseRecord = {
        id: `pilot-${String(seq).padStart(3, "0")}`,
        receivedAt,
        answeredAt,
        operator,
        workMinutes,
        aiUsed: true,
        aiCostJpy,
        aiProcessingMs: clampInt(rand.normal(48_000, 11_000), 20_000, 90_000),
        aiTokens,
        adoption: [],
        hourChangeRates: [],
        result: null,
        orderAmount: null,
        quotedCost: null,
        actualCost: null,
        reworkCount: null,
      };

      if (answeredAt) {
        // AI案の採用:承認した見積だけが対象
        const damp = 1 - 0.25 * progress;
        for (const key of FIELD_KEYS) {
          record.adoption.push({ item: `field:${key}`, evaluated: 1, modified: rand.chance(FIELD_EDIT_RATE[key] * damp) ? 1 : 0 });
        }
        for (const [item, p] of Object.entries(QUOTE_EDIT_RATE)) {
          record.adoption.push({ item, evaluated: 1, modified: rand.chance(p * damp) ? 1 : 0 });
        }
        const processes = rand.int(3, 5);
        let modified = 0;
        for (let p = 0; p < processes; p++) {
          if (rand.chance(0.36 * damp)) {
            modified++;
            record.hourChangeRates.push(Math.round(clampInt(Math.abs(rand.normal(0.16, 0.09)) * 100, 3, 50)) / 100);
          }
        }
        record.adoption.push({ item: "quote:hours", evaluated: processes, modified });

        // 結果と実績:時間がたったものから入る(直近の案件は、まだ入っていない)
        const age = daysSince(answeredAt, PILOT_AS_OF);
        const decided = rand.chance(age >= 14 ? 1 : age >= 7 ? 0.6 : 0.2);
        if (decided) {
          record.result = rand.chance(0.42) ? "won" : "lost";
          if (record.result === "won") {
            const orderAmount = Math.max(50_000, roundStep(Math.exp(rand.normal(Math.log(420_000), 0.7)), 1000));
            const quotedCost = Math.max(40_000, roundStep(orderAmount * rand.between(0.78, 0.84), 1000));
            record.orderAmount = orderAmount;
            record.quotedCost = quotedCost;
            if (age >= 21) {
              record.actualCost = Math.max(40_000, roundStep(quotedCost * (1 + rand.normal(0.07, 0.13)), 1000));
            }
            if (age >= 14) record.reworkCount = rand.weighted([[0, 78], [1, 17], [2, 5]] as const);
          }
        }
      }
      records.push(record);
    }
  });
  records.sort((a, b) => a.receivedAt.localeCompare(b.receivedAt) || a.id.localeCompare(b.id));
  return {
    note: "架空の記録。しらかば精工が2026年9月から6週間、試験導入した、という設定のデモ用データです。実在の会社・調査の数字ではありません。",
    records,
  };
}

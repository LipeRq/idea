import { addDays, findDateInText, formatJpDate } from "../dates";
import type { ExtractionOutput } from "../extraction/schema";
import type { Dimensions } from "../domain/reference";

// デモ用の引き合い3件(use-cases.md 5.6)。社名・人名はすべて架空。
// ここから図面PDF(scripts/generate-data.ts)と、デモモードの抽出結果(extraction/demo.ts)を作る。
// 希望納期はデモの日付に合わせて「今日」から相対的に決める(図面には納期を書かない)。

export type PlateView = {
  kind: "plate";
  lengthMm: number;
  widthMm: number;
  thicknessMm: number;
  labels: { length: string; width: string; thickness: string };
  holes: { xMm: number; yMm: number; diameterMm: number }[];
  holeLabel: string;
  pitchLabel?: string;
  taps: { xMm: number; yMm: number }[];
  tapLabel: string;
  pocket?: { xMm: number; yMm: number; wMm: number; hMm: number; label: string };
};

export type ShaftView = {
  kind: "shaft";
  steps: { lengthMm: number; diameterMm: number; label: string }[];
  lengthLabel: string;
  keyway: { fromMm: number; lengthMm: number; label: string };
};

export type DetailView = { kind: "detail"; title: string; lines: string[] };

export type DrawingSpec = {
  fileName: string;
  sheet: { index: number; total: number };
  title: {
    drawingNumber: string;
    revision: string;
    partName: string;
    material: string;
    quantity: string;
    surface: string;
    heat: string;
    scale: string;
    customer: string;
    drawnAt: string;
    designer: string;
    checker: string;
    approver: string;
  };
  view: PlateView | ShaftView | DetailView;
  notes: string[];
  revisions: { rev: string; date: string; description: string }[];
};

/** 評価用の正解ラベル(正規化後の値) */
export type GroundTruth = {
  partName: string;
  drawingNumber: string;
  revision: string;
  materialId: string | null;
  quantity: number | null;
  dimensions: Dimensions;
  toleranceMm: number | null;
  surfaceTreatmentId: string | null;
  heatTreatmentId: string | null;
  /** 確認事項として挙がるべき項目 */
  expectedQuestions: string[];
};

export type DemoScenario = {
  id: "revision" | "missing-info" | "short-lead";
  label: string;
  description: string;
  drawings: DrawingSpec[];
  buildEmail: (today: string) => { from: string; subject: string; body: string };
  buildExtraction: (ctx: { emailBody: string; today: string }) => ExtractionOutput;
  truth: GroundTruth;
};

const MAIL = "メール本文";

type Meta = Omit<ExtractionOutput["partName"], "value">;
const src = (document: string, page: number | null, location: string, quote: string) => ({
  document,
  page,
  location,
  quote,
});
const high = (sources: Meta["sources"], raw: string | null, note: string | null = null): Meta => ({
  raw,
  confidence: "high",
  sources,
  note,
});

function dueDateField(emailBody: string, today: string, quoteLine: string): ExtractionOutput["dueDate"] {
  const due = findDateInText(quoteLine, today);
  if (!due || !emailBody.includes(quoteLine)) {
    return { value: null, raw: null, confidence: "low", sources: [], note: "希望納期の記載が見つからない" };
  }
  return {
    value: due,
    raw: quoteLine.trim(),
    confidence: "high",
    sources: [src(MAIL, null, "希望納期の記載", quoteLine.trim())],
    note: null,
  };
}

// ---- 1. 改訂品(リピート):ミナモト装置工業 センサブラケット MS-24017 Rev.C ----

const S1_SHEET1 = "MS-24017_C_1.pdf";
const S1_SHEET2 = "MS-24017_C_2.pdf";
const s1Title = {
  drawingNumber: "MS-24017",
  revision: "C",
  partName: "センサブラケット",
  material: "SUS304",
  quantity: "50",
  surface: "無電解ニッケルめっき 5μm",
  heat: "",
  scale: "1:1",
  customer: "ミナモト装置工業株式会社",
  drawnAt: "2026-10-10",
  designer: "設計 西田",
  checker: "検図 大野",
  approver: "承認 岡本",
};
const s1Revisions = [
  { rev: "C", date: "2026-10-10", description: "φ8H7穴ピッチ変更(85→90)" },
  { rev: "B", date: "2025-05-20", description: "M5タップ追加" },
];
const s1Notes = [
  "1. 指示なき角部はC0.5とする",
  "2. 普通公差はJIS B 0405 m級",
  "3. 表面処理:無電解ニッケルめっき 膜厚5μm(φ8H7はめっき後寸法)",
  "4. 熱処理:要否は別途指示",
  "5. バリ・カエリなきこと",
];

const revision: DemoScenario = {
  id: "revision",
  label: "サンプル1:改訂品(リピート)",
  description: "ミナモト装置工業のセンサブラケット。過去品(Rev.B)の改訂版、SUS304・50個・無電解ニッケルめっき",
  drawings: [
    {
      fileName: S1_SHEET1,
      sheet: { index: 1, total: 2 },
      title: s1Title,
      view: {
        kind: "plate",
        lengthMm: 120,
        widthMm: 60,
        thicknessMm: 25,
        labels: { length: "120±0.1", width: "60±0.05", thickness: "25±0.05" },
        holes: [
          { xMm: 15, yMm: 30, diameterMm: 8 },
          { xMm: 105, yMm: 30, diameterMm: 8 },
        ],
        holeLabel: "2-φ8H7 通し",
        pitchLabel: "90±0.01",
        taps: [
          { xMm: 40, yMm: 10 },
          { xMm: 80, yMm: 10 },
          { xMm: 40, yMm: 50 },
          { xMm: 80, yMm: 50 },
        ],
        tapLabel: "4-M5 深さ10",
        pocket: { xMm: 45, yMm: 20, wMm: 30, hMm: 20, label: "ポケット 30×20 深さ10(詳細図A)" },
      },
      notes: ["注記はシート2/2を参照"],
      revisions: s1Revisions,
    },
    {
      fileName: S1_SHEET2,
      sheet: { index: 2, total: 2 },
      title: s1Title,
      view: {
        kind: "detail",
        title: "詳細図A(ポケット部) 尺度2:1",
        lines: ["ポケット 30×20 深さ10±0.05", "隅R3", "底面 Ra3.2"],
      },
      notes: s1Notes,
      revisions: s1Revisions,
    },
  ],
  buildEmail: (today) => ({
    from: "kitagawa@minamoto-sochi.example",
    subject: "【見積依頼】センサブラケット MS-24017 Rev.C 50個",
    body: `株式会社しらかば精工 営業部 青木様

いつもお世話になっております。
ミナモト装置工業 購買部の北川です。

下記部品のお見積りをお願いいたします。
図面2枚(${S1_SHEET1}、${S1_SHEET2})を添付します。

・品名:センサブラケット
・図番:MS-24017 Rev.C(前回のRev.Bから穴位置を変更しています)
・数量:50個
・希望納期:${formatJpDate(addDays(today, 40))} 当社着
・表面処理:無電解ニッケルめっき(図面注記のとおり)

急ぎではありませんが、今週中にご回答いただけると助かります。
よろしくお願いいたします。

ミナモト装置工業株式会社 購買部 北川`,
  }),
  buildExtraction: ({ emailBody, today }) => ({
    summary: "ミナモト装置工業から、センサブラケット(MS-24017 Rev.C、SUS304)50個の見積依頼。前回Rev.Bからの穴位置変更品。",
    customerName: {
      value: "ミナモト装置工業株式会社",
      ...high(
        [src(MAIL, null, "署名", "ミナモト装置工業株式会社 購買部 北川"), src(S1_SHEET1, 1, "表題欄の顧客欄", "ミナモト装置工業株式会社")],
        "ミナモト装置工業株式会社",
      ),
    },
    contactName: { value: "購買部 北川", ...high([src(MAIL, null, "署名", "購買部 北川")], "購買部 北川") },
    partName: {
      value: "センサブラケット",
      ...high([src(S1_SHEET1, 1, "表題欄の品名欄", "センサブラケット"), src(MAIL, null, "箇条書き", "品名:センサブラケット")], "センサブラケット"),
    },
    drawingNumber: {
      value: "MS-24017",
      ...high([src(S1_SHEET1, 1, "表題欄の図番欄", "MS-24017"), src(MAIL, null, "箇条書き", "図番:MS-24017 Rev.C")], "MS-24017"),
    },
    revision: {
      value: "C",
      ...high(
        [src(S1_SHEET1, 1, "表題欄の版欄・版歴", "C 2026-10-10 φ8H7穴ピッチ変更(85→90)"), src(MAIL, null, "箇条書き", "前回のRev.Bから穴位置を変更しています")],
        "C",
        "前回Rev.Bからφ8H7穴ピッチを85→90に変更",
      ),
    },
    material: { value: "SUS304", ...high([src(S1_SHEET1, 1, "表題欄の材質欄", "SUS304")], "SUS304") },
    quantity: {
      value: 50,
      ...high([src(S1_SHEET1, 1, "表題欄の数量欄", "50"), src(MAIL, null, "箇条書き", "数量:50個")], "50個"),
    },
    dimensions: {
      value: { shape: "block", lengthMm: 120, widthMm: 60, heightMm: 25, diameterMm: null },
      ...high(
        [src(S1_SHEET1, 1, "正面図の外形寸法", "120±0.1 / 60±0.05"), src(S1_SHEET1, 1, "側面図の厚さ寸法", "25±0.05")],
        "120×60×25",
      ),
    },
    tolerance: {
      value: 0.01,
      ...high([src(S1_SHEET1, 1, "正面図の穴ピッチ寸法", "90±0.01")], "±0.01", "φ8H7(+0.015/0)はめっき後寸法の指定"),
    },
    surfaceTreatment: {
      value: "無電解ニッケルめっき 5μm",
      ...high(
        [
          src(S1_SHEET1, 1, "表題欄の表面処理欄", "無電解ニッケルめっき 5μm"),
          src(S1_SHEET2, 1, "注記3", "表面処理:無電解ニッケルめっき 膜厚5μm"),
          src(MAIL, null, "箇条書き", "表面処理:無電解ニッケルめっき"),
        ],
        "無電解ニッケルめっき 膜厚5μm",
      ),
    },
    heatTreatment: {
      value: null,
      raw: "要否は別途指示",
      confidence: "low",
      sources: [src(S1_SHEET2, 1, "注記4", "熱処理:要否は別途指示")],
      note: "注記4で要否が保留されており、表題欄の熱処理欄も空欄",
    },
    dueDate: dueDateField(emailBody, today, `希望納期:${formatJpDate(addDays(today, 40))}`),
    inspection: {
      value: null,
      raw: null,
      confidence: "low",
      sources: [],
      note: "図面・メールに検査成績書の記載がない",
    },
    processType: {
      value: "milling",
      raw: null,
      confidence: "medium",
      sources: [src(S1_SHEET1, 1, "正面図", "2-φ8H7 通し / 4-M5 深さ10 / ポケット")],
      note: "角物でリーマ穴・タップ・ポケットがあるためマシニング加工と推定",
    },
    features: ["φ8H7リーマ穴×2(ピッチ90±0.01)", "M5タップ×4 深さ10", "ポケット30×20 深さ10", "指示なき角部C0.5"],
    notes: s1Notes,
    questions: [
      {
        field: "heatTreatment",
        issue: "図面の注記4が「熱処理:要否は別途指示」となっており、要否が決まっていません。",
        question: "図面注記4に「熱処理:要否は別途指示」とありますが、熱処理は必要でしょうか。必要な場合は処理の種類と硬さのご指定をお知らせください。",
      },
      {
        field: "inspection",
        issue: "検査成績書の要否が図面・メールのどちらにも書かれていません。",
        question: "検査成績書(寸法測定結果)の提出は必要でしょうか。必要な場合は測定箇所のご指定もお知らせください。",
      },
    ],
  }),
  truth: {
    partName: "センサブラケット",
    drawingNumber: "MS-24017",
    revision: "C",
    materialId: "SUS304",
    quantity: 50,
    dimensions: { shape: "block", lengthMm: 120, widthMm: 60, heightMm: 25, diameterMm: null },
    toleranceMm: 0.01,
    surfaceTreatmentId: "electroless_ni",
    heatTreatmentId: null,
    expectedQuestions: ["heatTreatment", "inspection"],
  },
};

// ---- 2. 情報不足:こもれび機工(新規)ベースプレート KM-3305 Rev.A ----

const S2_FILE = "KM-3305_A.pdf";
const s2Notes = [
  "1. 普通公差はJIS B 0405 m級",
  "2. 指示なき角部はC0.3とする",
  "3. 表面処理:アルマイト",
  "4. 平面度 0.05",
];

const missingInfo: DemoScenario = {
  id: "missing-info",
  label: "サンプル2:情報不足(新規)",
  description: "初めての顧客から、材質が「アルミ」、数量が「数個」、納期の記載なしのベースプレート",
  drawings: [
    {
      fileName: S2_FILE,
      sheet: { index: 1, total: 1 },
      title: {
        drawingNumber: "KM-3305",
        revision: "A",
        partName: "ベースプレート",
        material: "アルミ",
        quantity: "",
        surface: "アルマイト",
        heat: "—",
        scale: "1:2",
        customer: "株式会社こもれび機工",
        drawnAt: "2026-10-05",
        designer: "設計 南",
        checker: "",
        approver: "",
      },
      view: {
        kind: "plate",
        lengthMm: 200,
        widthMm: 150,
        thicknessMm: 12,
        labels: { length: "200", width: "150", thickness: "12" },
        holes: [
          { xMm: 15, yMm: 15, diameterMm: 9 },
          { xMm: 185, yMm: 15, diameterMm: 9 },
          { xMm: 15, yMm: 135, diameterMm: 9 },
          { xMm: 185, yMm: 135, diameterMm: 9 },
        ],
        holeLabel: "4-φ9キリ",
        taps: [
          { xMm: 60, yMm: 50 },
          { xMm: 100, yMm: 50 },
          { xMm: 140, yMm: 50 },
          { xMm: 60, yMm: 100 },
          { xMm: 100, yMm: 100 },
          { xMm: 140, yMm: 100 },
        ],
        tapLabel: "6-M6 通し",
      },
      notes: s2Notes,
      revisions: [{ rev: "A", date: "2026-10-05", description: "新規作成" }],
    },
  ],
  buildEmail: () => ({
    from: "minami@komorebi-kiko.example",
    subject: "見積のお願い(ベースプレート)",
    body: `株式会社しらかば精工 御中

株式会社こもれび機工 設計部の南と申します。初めてご連絡いたします。
添付図面(${S2_FILE})のベースプレートについて、お見積りをお願いできますでしょうか。

材質はアルミでお願いします。数は試作なので数個です。
表面はアルマイトで考えています。

よろしくお願いいたします。

株式会社こもれび機工 設計部 南`,
  }),
  buildExtraction: () => ({
    summary: "新規顧客のこもれび機工から、ベースプレート(KM-3305 Rev.A)試作数個の見積依頼。材質・数量・表面処理の種類・納期が未確定。",
    customerName: {
      value: "株式会社こもれび機工",
      ...high([src(MAIL, null, "署名", "株式会社こもれび機工 設計部 南"), src(S2_FILE, 1, "表題欄の顧客欄", "株式会社こもれび機工")], "株式会社こもれび機工"),
    },
    contactName: { value: "設計部 南", ...high([src(MAIL, null, "署名", "設計部 南")], "設計部 南") },
    partName: { value: "ベースプレート", ...high([src(S2_FILE, 1, "表題欄の品名欄", "ベースプレート")], "ベースプレート") },
    drawingNumber: { value: "KM-3305", ...high([src(S2_FILE, 1, "表題欄の図番欄", "KM-3305")], "KM-3305") },
    revision: { value: "A", ...high([src(S2_FILE, 1, "表題欄の版欄", "A")], "A") },
    material: {
      value: "アルミ",
      raw: "アルミ",
      confidence: "medium",
      sources: [src(S2_FILE, 1, "表題欄の材質欄", "アルミ"), src(MAIL, null, "本文", "材質はアルミでお願いします")],
      note: "合金番号(A5052、A6061など)の指定がない",
    },
    quantity: {
      value: null,
      raw: "数個",
      confidence: "low",
      sources: [src(MAIL, null, "本文", "数は試作なので数個です")],
      note: "数量が確定していない。表題欄の数量欄も空欄",
    },
    dimensions: {
      value: { shape: "block", lengthMm: 200, widthMm: 150, heightMm: 12, diameterMm: null },
      ...high([src(S2_FILE, 1, "正面図・側面図の外形寸法", "200 / 150 / 12")], "200×150×12"),
    },
    tolerance: {
      value: null,
      raw: null,
      confidence: "medium",
      sources: [src(S2_FILE, 1, "注記1", "普通公差はJIS B 0405 m級"), src(S2_FILE, 1, "注記4", "平面度 0.05")],
      note: "個別の寸法公差はなく普通公差m級。平面度0.05の指示がある",
    },
    surfaceTreatment: {
      value: "アルマイト",
      raw: "アルマイト",
      confidence: "medium",
      sources: [src(S2_FILE, 1, "表題欄の表面処理欄", "アルマイト"), src(MAIL, null, "本文", "表面はアルマイトで考えています")],
      note: "白・黒・硬質などの種類と膜厚の指定がない",
    },
    heatTreatment: {
      value: "なし",
      raw: "—",
      confidence: "medium",
      sources: [src(S2_FILE, 1, "表題欄の熱処理欄", "—")],
      note: "表題欄の熱処理欄が「—」のため不要と判断",
    },
    dueDate: { value: null, raw: null, confidence: "low", sources: [], note: "希望納期の記載がない" },
    inspection: { value: null, raw: null, confidence: "low", sources: [], note: "検査書類の記載がない" },
    processType: {
      value: "milling",
      raw: null,
      confidence: "high",
      sources: [src(S2_FILE, 1, "正面図", "4-φ9キリ / 6-M6 通し")],
      note: null,
    },
    features: ["φ9キリ穴×4", "M6タップ×6 通し", "平面度0.05"],
    notes: s2Notes,
    questions: [
      {
        field: "material",
        issue: "材質が「アルミ」とだけ書かれており、合金の種類が分かりません。",
        question: "材質はアルミとのことですが、A5052・A6061など合金番号のご指定はございますか。",
      },
      {
        field: "quantity",
        issue: "数量が「数個」となっており確定していません。",
        question: "ご依頼数量をお知らせいただけますでしょうか。1個・3個・5個など複数の数量でのお見積りも可能です。",
      },
      {
        field: "surfaceTreatment",
        issue: "アルマイトの種類と膜厚の指定がありません。",
        question: "アルマイトの種類(白・黒・硬質など)と膜厚のご指定をお知らせください。",
      },
      {
        field: "dueDate",
        issue: "希望納期が書かれていません。",
        question: "ご希望の納期をお知らせいただけますでしょうか。",
      },
    ],
  }),
  truth: {
    partName: "ベースプレート",
    drawingNumber: "KM-3305",
    revision: "A",
    materialId: null,
    quantity: null,
    dimensions: { shape: "block", lengthMm: 200, widthMm: 150, heightMm: 12, diameterMm: null },
    toleranceMm: null,
    surfaceTreatmentId: null,
    heatTreatmentId: "none",
    expectedQuestions: ["material", "quantity", "surfaceTreatment", "dueDate", "inspection"],
  },
};

// ---- 3. 短納期:すずかけ搬送システム 駆動シャフト SK-5521 Rev.B ----

const S3_FILE = "SK-5521_B.pdf";
const s3Notes = [
  "1. 熱処理:高周波焼入れ HRC50〜55 有効硬化層深さ1.5〜2.0(軸受部のみ)",
  "2. 表面処理:黒染め",
  "3. 指示なき角部はC0.5とする",
  "4. 普通公差はJIS B 0405 m級",
  "5. 検査成績書提出のこと(硬さ測定結果を含む)",
];

const shortLead: DemoScenario = {
  id: "short-lead",
  label: "サンプル3:短納期",
  description: "すずかけ搬送システムの駆動シャフト。S45C・10本・高周波焼入れ、約1週間後の納期",
  drawings: [
    {
      fileName: S3_FILE,
      sheet: { index: 1, total: 1 },
      title: {
        drawingNumber: "SK-5521",
        revision: "B",
        partName: "駆動シャフト",
        material: "S45C",
        quantity: "10",
        surface: "黒染め",
        heat: "高周波焼入れ HRC50〜55",
        scale: "1:1",
        customer: "すずかけ搬送システム株式会社",
        drawnAt: "2026-09-28",
        designer: "設計 原",
        checker: "検図 松田",
        approver: "承認 坂本",
      },
      view: {
        kind: "shaft",
        steps: [
          { lengthMm: 30, diameterMm: 20, label: "φ20±0.005" },
          { lengthMm: 120, diameterMm: 18, label: "φ18" },
          { lengthMm: 30, diameterMm: 20, label: "φ20±0.005" },
        ],
        lengthLabel: "180±0.1",
        keyway: { fromMm: 75, lengthMm: 30, label: "キー溝 6×3.5×30" },
      },
      notes: s3Notes,
      revisions: [
        { rev: "B", date: "2026-09-28", description: "キー溝長さ変更(25→30)" },
        { rev: "A", date: "2025-02-14", description: "新規作成" },
      ],
    },
  ],
  buildEmail: (today) => {
    const due = addDays(today, 8);
    return {
      from: "azuma@suzukake-hanso.example",
      subject: "【至急】駆動シャフト 10本 見積依頼",
      body: `株式会社しらかば精工 青木様

すずかけ搬送システムの東です。いつもありがとうございます。
設備トラブルで急ぎ必要になりました。添付図面の駆動シャフトを10本、
${formatJpDate(due, true)}までに納入いただけないでしょうか。
可能であれば本日中に概算をいただけると助かります。

図面:SK-5521 Rev.B(${S3_FILE})
材質:S45C
熱処理:高周波焼入れ(図面指示のとおり)

すずかけ搬送システム株式会社 調達課 東`,
    };
  },
  buildExtraction: ({ emailBody, today }) => {
    const line = emailBody.split("\n").find((l) => l.includes("までに納入")) ?? "";
    return {
      summary: "すずかけ搬送システムから、駆動シャフト(SK-5521 Rev.B、S45C)10本の至急の見積依頼。高周波焼入れと黒染めあり。",
      customerName: {
        value: "すずかけ搬送システム株式会社",
        ...high([src(MAIL, null, "署名", "すずかけ搬送システム株式会社 調達課 東"), src(S3_FILE, 1, "表題欄の顧客欄", "すずかけ搬送システム株式会社")], "すずかけ搬送システム株式会社"),
      },
      contactName: { value: "調達課 東", ...high([src(MAIL, null, "署名", "調達課 東")], "調達課 東") },
      partName: { value: "駆動シャフト", ...high([src(S3_FILE, 1, "表題欄の品名欄", "駆動シャフト")], "駆動シャフト") },
      drawingNumber: {
        value: "SK-5521",
        ...high([src(S3_FILE, 1, "表題欄の図番欄", "SK-5521"), src(MAIL, null, "本文", "図面:SK-5521 Rev.B")], "SK-5521"),
      },
      revision: { value: "B", ...high([src(S3_FILE, 1, "表題欄の版欄", "B")], "B") },
      material: {
        value: "S45C",
        ...high([src(S3_FILE, 1, "表題欄の材質欄", "S45C"), src(MAIL, null, "本文", "材質:S45C")], "S45C"),
      },
      quantity: {
        value: 10,
        ...high([src(S3_FILE, 1, "表題欄の数量欄", "10"), src(MAIL, null, "本文", "駆動シャフトを10本")], "10本"),
      },
      dimensions: {
        value: { shape: "round", lengthMm: 180, widthMm: null, heightMm: null, diameterMm: 20 },
        ...high([src(S3_FILE, 1, "正面図の全長・軸径", "180±0.1 / φ20±0.005")], "φ20×180"),
      },
      tolerance: {
        value: 0.005,
        ...high([src(S3_FILE, 1, "正面図の軸受部径", "φ20±0.005")], "±0.005", "軸受部2か所。研削仕上げが必要と考えられる"),
      },
      surfaceTreatment: {
        value: "黒染め",
        ...high([src(S3_FILE, 1, "表題欄の表面処理欄", "黒染め"), src(S3_FILE, 1, "注記2", "表面処理:黒染め")], "黒染め"),
      },
      heatTreatment: {
        value: "高周波焼入れ HRC50〜55(軸受部)",
        ...high(
          [src(S3_FILE, 1, "注記1", "高周波焼入れ HRC50〜55 有効硬化層深さ1.5〜2.0"), src(MAIL, null, "本文", "熱処理:高周波焼入れ")],
          "高周波焼入れ HRC50〜55",
        ),
      },
      dueDate: dueDateField(emailBody, today, line),
      inspection: {
        value: "検査成績書(硬さ測定結果を含む)",
        ...high([src(S3_FILE, 1, "注記5", "検査成績書提出のこと(硬さ測定結果を含む)")], "検査成績書提出のこと"),
      },
      processType: {
        value: "turning",
        raw: null,
        confidence: "high",
        sources: [src(S3_FILE, 1, "正面図", "段付き軸 φ20 / φ18")],
        note: null,
      },
      features: ["φ20±0.005 軸受部×2", "キー溝 6×3.5×30", "段付き φ18"],
      notes: s3Notes,
      questions: [],
    };
  },
  truth: {
    partName: "駆動シャフト",
    drawingNumber: "SK-5521",
    revision: "B",
    materialId: "S45C",
    quantity: 10,
    dimensions: { shape: "round", lengthMm: 180, widthMm: null, heightMm: null, diameterMm: 20 },
    toleranceMm: 0.005,
    surfaceTreatmentId: "black_oxide",
    heatTreatmentId: "induction_hardening",
    expectedQuestions: [],
  },
};

export const DEMO_SCENARIOS: DemoScenario[] = [revision, missingInfo, shortLead];

/** アップロードされたファイル名か、メールに書かれた図番からデモ用の引き合いを探す */
export function findScenario(fileNames: string[], emailText: string): DemoScenario | null {
  const names = fileNames.map((n) => n.toLowerCase());
  return (
    DEMO_SCENARIOS.find((s) => s.drawings.some((d) => names.includes(d.fileName.toLowerCase()))) ??
    DEMO_SCENARIOS.find((s) => s.drawings.some((d) => emailText.includes(d.title.drawingNumber))) ??
    null
  );
}

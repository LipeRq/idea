import type {
  BacklogItem,
  Company,
  Customer,
  RateTable,
} from "../../src/lib/domain/reference";

// 架空の加工会社「株式会社しらかば精工」のマスタ。社名・人名・住所はすべて架空。

export const company: Company = {
  name: "株式会社しらかば精工",
  description:
    "マシニングセンタとNC旋盤による金属部品加工(小物の板金を含む)。表面処理と熱処理は外注。見積は社長と工場長の2名が担当。",
  employees: 45,
  quoteStaff: ["代表取締役 白石", "工場長 森"],
  salesContact: "営業部 青木",
  address: "〒000-0000 架空県しらかば市工業団地1-2-3",
  phone: "000-000-0000",
  equipment: [
    { id: "vmc", name: "立形マシニングセンタ", processId: "mc", count: 3, maxLengthMm: 600, maxWidthMm: 400, maxHeightMm: 450, maxDiameterMm: null },
    { id: "hmc", name: "横形マシニングセンタ", processId: "mc", count: 1, maxLengthMm: 800, maxWidthMm: 700, maxHeightMm: 700, maxDiameterMm: null },
    { id: "nc_lathe", name: "NC旋盤", processId: "lathe", count: 3, maxLengthMm: 500, maxWidthMm: null, maxHeightMm: null, maxDiameterMm: 300 },
    { id: "multitask", name: "複合加工機", processId: "lathe", count: 1, maxLengthMm: 600, maxWidthMm: null, maxHeightMm: null, maxDiameterMm: 250 },
    { id: "surface_grinder", name: "平面研削盤", processId: "grinding", count: 1, maxLengthMm: 600, maxWidthMm: 300, maxHeightMm: 300, maxDiameterMm: null },
    { id: "cyl_grinder", name: "円筒研削盤", processId: "cyl_grinding", count: 1, maxLengthMm: 500, maxWidthMm: null, maxHeightMm: null, maxDiameterMm: 200 },
    { id: "wire_edm", name: "ワイヤー放電加工機", processId: "wire", count: 1, maxLengthMm: 400, maxWidthMm: 300, maxHeightMm: 200, maxDiameterMm: null },
    { id: "fiber_laser", name: "ファイバーレーザー加工機", processId: "laser", count: 1, maxLengthMm: 3000, maxWidthMm: 1500, maxHeightMm: 12, maxDiameterMm: null },
    { id: "press_brake", name: "ベンディングマシン", processId: "bending", count: 1, maxLengthMm: 2500, maxWidthMm: 1000, maxHeightMm: 6, maxDiameterMm: null },
    { id: "cmm", name: "三次元測定機", processId: "inspection", count: 1, maxLengthMm: 700, maxWidthMm: 700, maxHeightMm: 600, maxDiameterMm: null },
  ],
};

const ALL_GROUPS = ["steel", "stainless", "aluminum", "copper"] as const;

export const rateTable: RateTable = {
  id: "RT-2026-09",
  name: "しらかば精工 単価表 2026年9月版",
  updatedAt: "2026-09-01",
  processes: [
    { id: "mc", name: "マシニング加工", chargePerHour: 8000, setupChargePerHour: 6000, types: ["milling", "turning"] },
    { id: "lathe", name: "NC旋盤加工", chargePerHour: 6500, setupChargePerHour: 5000, types: ["turning"] },
    { id: "grinding", name: "平面研削", chargePerHour: 7000, setupChargePerHour: 5500, types: ["milling"] },
    { id: "cyl_grinding", name: "円筒研削", chargePerHour: 7500, setupChargePerHour: 5500, types: ["turning"] },
    { id: "wire", name: "ワイヤーカット", chargePerHour: 6000, setupChargePerHour: 4000, types: ["milling"] },
    { id: "laser", name: "レーザー切断", chargePerHour: 9000, setupChargePerHour: 5000, types: ["sheet"] },
    { id: "bending", name: "曲げ加工", chargePerHour: 6000, setupChargePerHour: 5000, types: ["sheet"] },
    { id: "deburr", name: "バリ取り・仕上げ", chargePerHour: 4000, setupChargePerHour: 4000, types: ["milling", "turning", "sheet"] },
    {
      id: "inspection",
      name: "検査",
      chargePerHour: 6000,
      setupChargePerHour: 5000,
      types: ["milling", "turning", "sheet"],
      note: "±0.01以下の公差は三次元測定機で測定",
    },
  ],
  materials: [
    { id: "SS400", name: "SS400", group: "steel", aliases: ["SS41", "一般構造用圧延鋼材"], densityGPerCm3: 7.85, pricePerKg: 180, minChargePerLot: 1500 },
    { id: "S45C", name: "S45C", group: "steel", aliases: ["S45C-D", "機械構造用炭素鋼"], densityGPerCm3: 7.85, pricePerKg: 260, minChargePerLot: 1500 },
    { id: "SCM435", name: "SCM435", group: "steel", aliases: ["SCM435H", "クロモリ"], densityGPerCm3: 7.85, pricePerKg: 380, minChargePerLot: 2000 },
    { id: "SPCC", name: "SPCC", group: "steel", aliases: ["SPCC-SD", "冷間圧延鋼板"], densityGPerCm3: 7.85, pricePerKg: 200, minChargePerLot: 1000 },
    { id: "SUS304", name: "SUS304", group: "stainless", aliases: ["ステンレス304", "SUS304-2B"], densityGPerCm3: 7.93, pricePerKg: 750, minChargePerLot: 2000 },
    { id: "SUS303", name: "SUS303", group: "stainless", aliases: ["ステンレス303"], densityGPerCm3: 7.93, pricePerKg: 800, minChargePerLot: 2000 },
    { id: "A5052", name: "A5052", group: "aluminum", aliases: ["A5052P", "A5052-H34"], densityGPerCm3: 2.68, pricePerKg: 1100, minChargePerLot: 1500 },
    { id: "A6061", name: "A6061", group: "aluminum", aliases: ["A6061-T6"], densityGPerCm3: 2.7, pricePerKg: 1000, minChargePerLot: 1500 },
    { id: "A7075", name: "A7075", group: "aluminum", aliases: ["A7075-T6", "超々ジュラルミン"], densityGPerCm3: 2.8, pricePerKg: 1800, minChargePerLot: 2000 },
    { id: "C3604", name: "C3604", group: "copper", aliases: ["C3604BD", "快削黄銅", "黄銅", "真鍮"], densityGPerCm3: 8.5, pricePerKg: 1500, minChargePerLot: 1500 },
  ],
  treatments: [
    { id: "electroless_ni", name: "無電解ニッケルめっき", kind: "surface", aliases: ["無電解ニッケル", "無電解NI", "無電解ニッケルメッキ"], pricing: "per_kg", unitPrice: 3000, minLotCharge: 12000, leadDays: 5, materialGroups: [...ALL_GROUPS] },
    { id: "hard_anodize", name: "硬質アルマイト", kind: "surface", aliases: ["硬質陽極酸化"], pricing: "per_piece", unitPrice: 350, minLotCharge: 12000, leadDays: 5, materialGroups: ["aluminum"] },
    { id: "white_anodize", name: "白アルマイト", kind: "surface", aliases: ["アルマイト(白)", "クリアアルマイト"], pricing: "per_piece", unitPrice: 150, minLotCharge: 8000, leadDays: 4, materialGroups: ["aluminum"] },
    { id: "black_anodize", name: "黒アルマイト", kind: "surface", aliases: ["アルマイト(黒)"], pricing: "per_piece", unitPrice: 180, minLotCharge: 8000, leadDays: 4, materialGroups: ["aluminum"] },
    { id: "black_oxide", name: "黒染め", kind: "surface", aliases: ["四三酸化鉄皮膜"], pricing: "per_kg", unitPrice: 600, minLotCharge: 5000, leadDays: 3, materialGroups: ["steel"] },
    { id: "trivalent_chromate", name: "三価クロメート", kind: "surface", aliases: ["亜鉛めっき", "電気亜鉛めっき"], pricing: "per_kg", unitPrice: 800, minLotCharge: 6000, leadDays: 4, materialGroups: ["steel"] },
    { id: "quench_temper", name: "焼入れ焼戻し", kind: "heat", aliases: ["焼入焼戻", "調質", "ズブ焼入れ"], pricing: "per_kg", unitPrice: 800, minLotCharge: 8000, leadDays: 4, materialGroups: ["steel"] },
    { id: "induction_hardening", name: "高周波焼入れ", kind: "heat", aliases: ["高周波焼入", "高周波"], pricing: "per_piece", unitPrice: 500, minLotCharge: 15000, leadDays: 5, materialGroups: ["steel"] },
  ],
  rules: {
    overheadRate: 0.12,
    defaultProfitRate: 0.15,
    blankAllowanceMm: {
      block: { lengthMm: 5, widthMm: 5, heightMm: 3, diameterMm: 0 },
      round: { lengthMm: 5, widthMm: 0, heightMm: 0, diameterMm: 3 },
      sheet: { lengthMm: 10, widthMm: 10, heightMm: 0, diameterMm: 0 },
    },
    quantityBreaks: [
      { minQty: 1, factor: 1 },
      { minQty: 10, factor: 0.95 },
      { minQty: 30, factor: 0.9 },
      { minQty: 100, factor: 0.85 },
    ],
    quantityTiers: [1, 10, 30, 50, 100],
    leadTime: { baseDays: 5, extraDaysPer50Pieces: 1 },
    expedite: { surchargeRate: 0.25 },
    rounding: { unitStepYen: 10 },
    taxRate: 0.1,
    quoteValidityDays: 30,
    priceDeviationWarnRate: 0.4,
    staleAfterDays: 180,
  },
};

type CustomerSeed = [id: string, name: string, shortName: string, industry: string, years: number, terms: string, domain: string, prefix: string, sf: boolean];

const TERMS = ["月末締め翌月末払い", "月末締め翌々月10日払い", "20日締め翌月末払い"];

const seeds: CustomerSeed[] = [
  ["C01", "ミナモト装置工業株式会社", "ミナモト装置工業", "省力化装置", 12, TERMS[0], "minamoto-sochi.example", "MS", true],
  ["C02", "みずなら電装株式会社", "みずなら電装", "制御盤・電装", 8, TERMS[1], "mizunara-denso.example", "MZ", true],
  ["C03", "株式会社せせらぎ化工機", "せせらぎ化工機", "化学プラント機器", 15, TERMS[0], "seseragi-kakoki.example", "SG", false],
  ["C04", "株式会社ゆきやなぎ製作所", "ゆきやなぎ製作所", "半導体製造装置部品", 6, TERMS[2], "yukiyanagi-ss.example", "YK", true],
  ["C05", "すずかけ搬送システム株式会社", "すずかけ搬送システム", "搬送装置", 9, TERMS[0], "suzukake-hanso.example", "SK", true],
  ["C06", "はなみずき医療機器株式会社", "はなみずき医療機器", "医療機器", 4, TERMS[1], "hanamizuki-med.example", "HM", false],
  ["C07", "株式会社つゆくさロボティクス", "つゆくさロボティクス", "産業用ロボット", 3, TERMS[0], "tsuyukusa-robotics.example", "TR", true],
  ["C08", "くすのき食品機械株式会社", "くすのき食品機械", "食品機械", 20, TERMS[1], "kusunoki-foodmc.example", "KS", false],
  ["C09", "株式会社かえで計測", "かえで計測", "計測機器", 7, TERMS[0], "kaede-keisoku.example", "KD", false],
  ["C10", "しののめ精機株式会社", "しののめ精機", "精密機器", 11, TERMS[2], "shinonome-seiki.example", "SN", true],
  ["C11", "株式会社あさぎり工機", "あさぎり工機", "工作機械周辺機器", 5, TERMS[0], "asagiri-koki.example", "AG", false],
  ["C12", "ひいらぎ環境設備株式会社", "ひいらぎ環境設備", "環境設備", 2, TERMS[1], "hiiragi-env.example", "HR", false],
  ["C13", "株式会社もえぎ光学", "もえぎ光学", "光学機器", 6, TERMS[0], "moegi-kogaku.example", "MG", false],
  ["C14", "ささなみオートメーション株式会社", "ささなみオートメーション", "自動化設備", 4, TERMS[0], "sasanami-auto.example", "SZ", true],
  ["C15", "株式会社なないろ試験機", "なないろ試験機", "試験機", 10, TERMS[2], "nanairo-shikenki.example", "NN", false],
  ["C16", "こはく産機株式会社", "こはく産機", "産業機械", 14, TERMS[0], "kohaku-sanki.example", "KH", false],
  ["C17", "株式会社うすずみ印刷機械", "うすずみ印刷機械", "印刷機械", 18, TERMS[1], "usuzumi-print.example", "US", false],
  ["C18", "たまゆら電子工業株式会社", "たまゆら電子工業", "電子機器", 3, TERMS[0], "tamayura-denshi.example", "TY", false],
  ["C19", "株式会社ほたるび農機", "ほたるび農機", "農業機械", 9, TERMS[2], "hotarubi-noki.example", "HT", false],
  ["C20", "みなづき包装機株式会社", "みなづき包装機", "包装機械", 5, TERMS[0], "minazuki-hoso.example", "MN", false],
];

export const customers: Customer[] = seeds.map(
  ([id, name, shortName, industry, yearsOfBusiness, paymentTerms, domain, drawingPrefix, sf]) => ({
    id,
    name,
    shortName,
    industry,
    yearsOfBusiness,
    paymentTerms,
    emailDomains: [domain],
    drawingPrefix,
    // デモのSalesforceに取引先が登録済みの顧客だけ、Account Id(モック)を持つ
    salesforceAccountId: sf ? `001MK00000000000${id}` : null,
  }),
);

/** 引き合いの発生しやすさ(主要顧客ほど多い) */
export const CUSTOMER_WEIGHTS: Record<string, number> = {
  C01: 25, C02: 8, C03: 5, C04: 6, C05: 12, C06: 4, C07: 5, C08: 4, C09: 3, C10: 5,
  C11: 3, C12: 2, C13: 3, C14: 4, C15: 3, C16: 4, C17: 3, C18: 2, C19: 3, C20: 3,
};

// 見積待ち一覧(デモの0:00〜0:30)。12件のうち8件が社長の確認待ち
export const backlog: BacklogItem[] = [
  { id: "B-01", receivedAt: "2026-10-09", customerName: "ミナモト装置工業", partName: "ストッパブロック", quantity: 20, status: "president_review", assignee: "代表取締役 白石" },
  { id: "B-02", receivedAt: "2026-10-09", customerName: "しののめ精機", partName: "位置決めピン", quantity: 100, status: "president_review", assignee: "代表取締役 白石" },
  { id: "B-03", receivedAt: "2026-10-13", customerName: "つゆくさロボティクス", partName: "アームブラケット", quantity: 5, status: "president_review", assignee: "代表取締役 白石" },
  { id: "B-04", receivedAt: "2026-10-13", customerName: "ゆきやなぎ製作所", partName: "ガイドブロック", quantity: 10, status: "president_review", assignee: "代表取締役 白石" },
  { id: "B-05", receivedAt: "2026-10-14", customerName: "くすのき食品機械", partName: "ローラシャフト", quantity: 8, status: "president_review", assignee: "工場長 森" },
  { id: "B-06", receivedAt: "2026-10-14", customerName: "ミナモト装置工業", partName: "取付プレート", quantity: 30, status: "president_review", assignee: "代表取締役 白石" },
  { id: "B-07", receivedAt: "2026-10-15", customerName: "ささなみオートメーション", partName: "安全カバー", quantity: 4, status: "president_review", assignee: "代表取締役 白石" },
  { id: "B-08", receivedAt: "2026-10-16", customerName: "すずかけ搬送システム", partName: "従動シャフト", quantity: 12, status: "president_review", assignee: "工場長 森" },
  { id: "B-09", receivedAt: "2026-10-08", customerName: "みずなら電装", partName: "配線カバー", quantity: 50, status: "waiting_customer", assignee: "営業部 青木" },
  { id: "B-10", receivedAt: "2026-10-12", customerName: "かえで計測", partName: "センサホルダ", quantity: 3, status: "waiting_customer", assignee: "営業部 青木" },
  { id: "B-11", receivedAt: "2026-10-07", customerName: "こはく産機", partName: "フランジ", quantity: 15, status: "answered", assignee: "工場長 森" },
  { id: "B-12", receivedAt: "2026-10-10", customerName: "もえぎ光学", partName: "レンズホルダ", quantity: 6, status: "answered", assignee: "代表取締役 白石" },
];

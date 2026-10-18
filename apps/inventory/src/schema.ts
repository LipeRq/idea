import { z } from "zod";

export const SCHEMA_VERSION = "1";

export const FILE_FORMATS = ["xlsm", "xlam", "xlsx", "xltm", "xlsb", "xls", "accdb", "mdb"] as const;
export type FileFormat = (typeof FILE_FORMATS)[number];

export const MODULE_TYPES = ["standard", "class", "document", "form", "report", "unknown"] as const;
export type ModuleType = (typeof MODULE_TYPES)[number];

export const MODULE_TYPE_LABEL: Record<ModuleType, string> = {
  standard: "標準モジュール",
  class: "クラスモジュール",
  document: "ドキュメント(ブック/シート)",
  form: "フォーム",
  report: "レポート",
  unknown: "不明",
};

export const PROCEDURE_KINDS = ["sub", "function", "propertyGet", "propertyLet", "propertySet"] as const;
export type ProcedureKind = (typeof PROCEDURE_KINDS)[number];

export const PROCEDURE_KIND_LABEL: Record<ProcedureKind, string> = {
  sub: "Sub",
  function: "Function",
  propertyGet: "Property Get",
  propertyLet: "Property Let",
  propertySet: "Property Set",
};

export const DEPENDENCY_KINDS = [
  "filePath",
  "workbook",
  "externalLink",
  "connectionString",
  "dataConnection",
  "linkedTable",
  "sql",
  "url",
  "createObject",
  "shell",
  "sendKeys",
  "winApi",
  "reference",
  "fileIo",
  "environment",
  "print",
] as const;
export type DependencyKind = (typeof DEPENDENCY_KINDS)[number];

export const DEPENDENCY_KIND_LABEL: Record<DependencyKind, string> = {
  filePath: "ファイルパス(ハードコード)",
  workbook: "他ブックの操作",
  externalLink: "外部ブック参照(数式リンク)",
  connectionString: "DB接続文字列",
  dataConnection: "外部データ接続",
  linkedTable: "リンクテーブル",
  sql: "SQL文",
  url: "URL",
  createObject: "COMオブジェクト(CreateObject等)",
  shell: "外部プログラム実行(Shell)",
  sendKeys: "キー送信(SendKeys)",
  winApi: "Windows API(Declare)",
  reference: "参照設定ライブラリ",
  fileIo: "ファイル入出力",
  environment: "環境変数",
  print: "印刷",
};

export const SEVERITIES = ["high", "medium", "low"] as const;
export type Severity = (typeof SEVERITIES)[number];
export const SEVERITY_LABEL: Record<Severity, string> = { high: "高", medium: "中", low: "低" };

export const LocationSchema = z.object({
  module: z.string().optional(),
  procedure: z.string().optional(),
  line: z.number().int().optional(),
  part: z.string().optional().describe("ファイル内の部品(例: xl/connections.xml、MSysObjects)"),
});
export type Location = z.infer<typeof LocationSchema>;

export const ParameterSchema = z.object({
  name: z.string(),
  type: z.string().nullable(),
  byVal: z.boolean(),
  optional: z.boolean(),
  paramArray: z.boolean(),
  isArray: z.boolean(),
  defaultValue: z.string().nullable(),
});
export type Parameter = z.infer<typeof ParameterSchema>;

export const ProcedureSchema = z.object({
  id: z.string().describe("モジュール名.プロシージャ名"),
  name: z.string(),
  kind: z.enum(PROCEDURE_KINDS),
  scope: z.enum(["public", "private", "friend"]),
  isStatic: z.boolean(),
  startLine: z.number().int(),
  endLine: z.number().int(),
  lineCount: z.number().int(),
  params: z.array(ParameterSchema),
  returnType: z.string().nullable(),
  errorHandling: z.enum(["handler", "resumeNext", "none"]),
  isEvent: z.boolean(),
  eventLabel: z.string().nullable(),
  calls: z.array(z.string()),
  calledBy: z.array(z.string()),
});
export type Procedure = z.infer<typeof ProcedureSchema>;

export const DeclareSchema = z.object({
  name: z.string(),
  lib: z.string(),
  alias: z.string().nullable(),
  ptrSafe: z.boolean(),
  line: z.number().int(),
  legacyBranch: z
    .boolean()
    .default(false)
    .describe("#If VBA7 / Win64 の #Else 側など、64ビット版の Office ではコンパイルされない分岐にあるか"),
});
export type Declare = z.infer<typeof DeclareSchema>;

export const VbaModuleSchema = z.object({
  name: z.string(),
  streamName: z.string(),
  type: z.enum(MODULE_TYPES),
  lineCount: z.number().int(),
  codeLineCount: z.number().int(),
  commentLineCount: z.number().int(),
  hasOptionExplicit: z.boolean(),
  procedures: z.array(ProcedureSchema),
  declares: z.array(DeclareSchema),
  source: z.string().nullable().describe("ソースコード(Attribute 行は除く)。--no-source 指定時は null"),
});
export type VbaModule = z.infer<typeof VbaModuleSchema>;

export const VbaReferenceSchema = z.object({
  name: z.string(),
  kind: z.enum(["registered", "project", "control", "original"]),
  libid: z.string(),
  description: z.string().nullable(),
  path: z.string().nullable(),
});
export type VbaReference = z.infer<typeof VbaReferenceSchema>;

export const VbaProjectSchema = z.object({
  name: z.string(),
  codePage: z.number().int(),
  encoding: z.string(),
  lockedForViewing: z.boolean().nullable(),
  hasPassword: z.boolean().nullable(),
  references: z.array(VbaReferenceSchema),
  modules: z.array(VbaModuleSchema),
});
export type VbaProject = z.infer<typeof VbaProjectSchema>;

export const SheetSchema = z.object({
  name: z.string(),
  codeName: z.string().nullable().describe("VBAから見たシートのオブジェクト名(Sheet1 など)"),
  index: z.number().int(),
  kind: z.enum(["worksheet", "chartsheet", "dialogsheet", "macrosheet"]),
  state: z.enum(["visible", "hidden", "veryHidden"]),
  usedRange: z.string().nullable(),
  formulaCount: z.number().int(),
  formulaSamples: z.array(z.object({ cell: z.string().nullable(), formula: z.string() })),
  externalRefCount: z.number().int(),
  brokenRefCount: z.number().int().describe("#REF! を含む数式の数"),
});
export type Sheet = z.infer<typeof SheetSchema>;

export const DefinedNameSchema = z.object({
  name: z.string(),
  scope: z.string().nullable().describe("シート名。ブック全体なら null"),
  refersTo: z.string().nullable(),
  hidden: z.boolean(),
  builtIn: z.boolean(),
});
export type DefinedName = z.infer<typeof DefinedNameSchema>;

export const ExternalLinkSchema = z.object({
  index: z.number().int(),
  type: z.enum(["workbook", "dde", "ole", "unknown"]),
  target: z.string(),
  sheetNames: z.array(z.string()),
});
export type ExternalLink = z.infer<typeof ExternalLinkSchema>;

export const ConnectionSchema = z.object({
  name: z.string(),
  type: z.string(),
  connectionString: z.string().nullable().describe("パスワードはマスク済み"),
  command: z.string().nullable(),
  description: z.string().nullable(),
});
export type Connection = z.infer<typeof ConnectionSchema>;

export const ControlMacroSchema = z.object({
  sheet: z.string(),
  control: z.string(),
  text: z.string().nullable(),
  macro: z.string(),
});
export type ControlMacro = z.infer<typeof ControlMacroSchema>;

export const ExcelInfoSchema = z.object({
  sheets: z.array(SheetSchema),
  definedNames: z.array(DefinedNameSchema),
  externalLinks: z.array(ExternalLinkSchema),
  connections: z.array(ConnectionSchema),
  controlMacros: z.array(ControlMacroSchema).describe("シート上のボタン等に登録されたマクロ"),
  formulaCount: z.number().int(),
  formulaTextAvailable: z.boolean().describe("数式の式テキストを取得できたか(.xls/.xlsb では件数のみ)"),
});
export type ExcelInfo = z.infer<typeof ExcelInfoSchema>;

export const AccessColumnSchema = z.object({
  name: z.string(),
  type: z.string(),
  size: z.number().int(),
  nullable: z.boolean(),
  autoNumber: z.boolean(),
});

export const AccessTableSchema = z.object({
  name: z.string(),
  rowCount: z.number().int(),
  columns: z.array(AccessColumnSchema),
});
export type AccessTable = z.infer<typeof AccessTableSchema>;

export const LinkedTableSchema = z.object({
  name: z.string(),
  kind: z.enum(["access", "odbc", "excel", "text", "sharepoint", "other"]),
  sourceTable: z.string().nullable(),
  database: z.string().nullable(),
  connect: z.string().nullable().describe("パスワードはマスク済み"),
});
export type LinkedTable = z.infer<typeof LinkedTableSchema>;

export const QUERY_TYPES = [
  "select",
  "crosstab",
  "delete",
  "update",
  "append",
  "makeTable",
  "dataDefinition",
  "passThrough",
  "union",
  "unknown",
] as const;
export type QueryType = (typeof QUERY_TYPES)[number];
export const QUERY_TYPE_LABEL: Record<QueryType, string> = {
  select: "選択",
  crosstab: "クロス集計",
  delete: "削除",
  update: "更新",
  append: "追加",
  makeTable: "テーブル作成",
  dataDefinition: "データ定義",
  passThrough: "パススルー",
  union: "ユニオン",
  unknown: "不明",
};

export const AccessQuerySchema = z.object({
  name: z.string(),
  type: z.enum(QUERY_TYPES),
  hidden: z.boolean().describe("フォーム・レポートが内部で使う ~sq_ クエリなど"),
  sql: z.string().nullable(),
  tables: z.array(z.string()).describe("参照しているテーブル・クエリ"),
  target: z.string().nullable().describe("追加・テーブル作成クエリの書き込み先テーブル"),
  connect: z.string().nullable().describe("パススルークエリの接続文字列(パスワードはマスク済み)"),
});
export type AccessQuery = z.infer<typeof AccessQuerySchema>;

export const RelationshipSchema = z.object({
  name: z.string(),
  primaryTable: z.string(),
  primaryColumns: z.array(z.string()),
  foreignTable: z.string(),
  foreignColumns: z.array(z.string()),
  oneToOne: z.boolean(),
  enforced: z.boolean(),
  cascadeUpdate: z.boolean(),
  cascadeDelete: z.boolean(),
});
export type Relationship = z.infer<typeof RelationshipSchema>;

export const AccessInfoSchema = z.object({
  engine: z.string().describe("Jet3 / Jet4 / ACE12 など"),
  tables: z.array(AccessTableSchema),
  linkedTables: z.array(LinkedTableSchema),
  queries: z.array(AccessQuerySchema),
  relationships: z.array(RelationshipSchema),
  forms: z.array(z.string()),
  reports: z.array(z.string()),
  macros: z.array(z.string()),
  modules: z.array(z.string()),
  vbaStatus: z.enum(["extracted", "none", "failed"]),
});
export type AccessInfo = z.infer<typeof AccessInfoSchema>;

export const DependencySchema = z.object({
  kind: z.enum(DEPENDENCY_KINDS),
  target: z.string(),
  category: z.string().nullable(),
  location: LocationSchema,
});
export type Dependency = z.infer<typeof DependencySchema>;

export const ENTRY_POINT_KINDS = ["event", "autoMacro", "button", "schedule", "shortcut", "accessMacro", "macro"] as const;
export type EntryPointKind = (typeof ENTRY_POINT_KINDS)[number];
export const ENTRY_POINT_KIND_LABEL: Record<EntryPointKind, string> = {
  event: "イベント",
  autoMacro: "自動実行マクロ",
  button: "ボタン・図形",
  schedule: "時刻指定(OnTime)",
  shortcut: "ショートカットキー(OnKey)",
  accessMacro: "Accessマクロ",
  macro: "手動実行の候補",
};

export const EntryPointSchema = z.object({
  kind: z.enum(ENTRY_POINT_KINDS),
  trigger: z.string().describe("起動のきっかけ(日本語)"),
  procedure: z.string().nullable().describe("プロシージャID。解決できなければ null"),
  target: z.string().describe("登録されているマクロ名などの元の表記"),
  location: LocationSchema,
});
export type EntryPoint = z.infer<typeof EntryPointSchema>;

export const CallEdgeSchema = z.object({
  from: z.string(),
  to: z.string(),
  kind: z.enum(["call", "run", "formShow"]),
  line: z.number().int(),
});
export type CallEdge = z.infer<typeof CallEdgeSchema>;

export const FindingSchema = z.object({
  ruleId: z.string(),
  severity: z.enum(SEVERITIES),
  title: z.string(),
  detail: z.string(),
  count: z.number().int(),
  locations: z.array(LocationSchema),
});
export type Finding = z.infer<typeof FindingSchema>;

export const PropertiesSchema = z.object({
  title: z.string().nullable(),
  creator: z.string().nullable(),
  lastModifiedBy: z.string().nullable(),
  created: z.string().nullable(),
  modified: z.string().nullable(),
  application: z.string().nullable(),
  appVersion: z.string().nullable(),
  company: z.string().nullable(),
});
export type Properties = z.infer<typeof PropertiesSchema>;

export const StatsSchema = z.object({
  sheetCount: z.number().int(),
  formulaCount: z.number().int(),
  moduleCount: z.number().int(),
  procedureCount: z.number().int(),
  codeLineCount: z.number().int(),
  totalLineCount: z.number().int(),
  dependencyCount: z.number().int(),
  tableCount: z.number().int(),
  queryCount: z.number().int(),
});
export type Stats = z.infer<typeof StatsSchema>;

export const InventoryReportSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  generatedAt: z.string(),
  tool: z.object({ name: z.string(), version: z.string() }),
  file: z.object({
    name: z.string(),
    format: z.enum(FILE_FORMATS),
    kind: z.enum(["excel", "access"]),
    sizeBytes: z.number().int(),
    sha256: z.string(),
  }),
  properties: PropertiesSchema,
  excel: ExcelInfoSchema.nullable(),
  access: AccessInfoSchema.nullable(),
  vba: VbaProjectSchema.nullable(),
  entryPoints: z.array(EntryPointSchema),
  callGraph: z.array(CallEdgeSchema),
  dependencies: z.array(DependencySchema),
  findings: z.array(FindingSchema),
  stats: StatsSchema,
  warnings: z.array(z.string()).describe("解析できなかった部分や制約"),
});
export type InventoryReport = z.infer<typeof InventoryReportSchema>;

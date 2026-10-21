// 画面(メインスレッド)と解析 Worker のやり取りの型。
// 画面はエンジンを型としてだけ参照し、実行コード(zod を含む約700KB)は Worker のバンドルにだけ入れる。
import type { AnalysisLimits, InventoryReport, LimitKind, Severity } from "@engine/browser";
import type { Complexity } from "@engine/doc/facts";
import type { Diagram } from "@engine/doc/mermaid";
import type { AiDocumentJson } from "@/lib/ai-json";
import type { SensitiveHit } from "@/shared/sensitive-scan";

/**
 * 失敗の種類。エンジンのエラー名(クラス名)は minify で変わりうるため、Worker の中で instanceof で判定して
 * この固定のコードにしてから画面に返す(画面はコードで文言を選ぶ)。
 */
export type WorkerErrorCode =
  | "unsupported"
  | "encryptedAccess"
  | "password"
  | "corrupt"
  | "limit"
  | "readFailed"
  | "internal";

export interface WorkerError {
  code: WorkerErrorCode;
  /** エンジンの日本語メッセージ(internal のときは空) */
  message: string;
  kind?: LimitKind;
}

export type Phase = "reading" | "analyzing" | "rendering";

export type WorkerRequest =
  | { type: "analyze"; id: number; file: File; limits: Partial<AnalysisLimits> }
  | { type: "render"; id: number; report: InventoryReport; ai: AiDocumentJson }
  | { type: "aiPayload"; id: number; report: InventoryReport; includeSource: boolean; consentVersion: string };

export type WorkerResponse =
  | { type: "ready"; engineVersion: string }
  | { type: "phase"; id: number; phase: Phase }
  | { type: "analyzed"; id: number; result: AnalysisResult }
  | { type: "rendered"; id: number; document: RenderedDocument; businessFlow: string | null }
  | { type: "aiPayload"; id: number; payload: AiPayload }
  | { type: "error"; id: number; error: WorkerError }
  /** Worker の中で CSP の違反が起きた(自己点検用。画面が件数を data 属性に出す) */
  | { type: "csp"; directive: string };

/** 仕様書(Markdown)と、それを HTML にしたもの(画面で DOMPurify にかけてから表示する) */
export interface RenderedDocument {
  markdown: string;
  /** markdown-it の出力(画面で DOMPurify にかけてから使う) */
  html: string;
  /** 画面にプレビューしてよい大きさか(大きすぎるときはプレビューを省略し、保存だけにする) */
  previewable: boolean;
  /** html の中の <div class="mermaid-src" data-mermaid-index="i"> に入れる図のコード */
  diagrams: string[];
  markdownBytes: number;
}

export interface FindingView {
  ruleId: string;
  severity: Severity;
  severityLabel: string;
  title: string;
  detail: string;
  count: number;
  locations: string[];
}

export interface EntryPointView {
  kindLabel: string;
  trigger: string;
  procedure: string;
}

export interface CallEdgeView {
  from: string;
  to: string;
  kindLabel: string;
}

/** 画面に必要な、エンジンの関数で計算した値(画面はエンジンの実行コードを持たないため) */
export interface Derived {
  formatLabel: string;
  complexity: Complexity;
  findingCounts: Record<Severity, number>;
  findings: FindingView[];
  entryPoints: EntryPointView[];
  callEdges: CallEdgeView[];
  diagrams: {
    callFlow: Diagram | null;
    queries: Diagram | null;
    relationships: string | null;
  };
  maxGraphNodes: number;
  /** 伏せ字にしたパスワードの箇所数(CRED-HARDCODED の件数) */
  maskedCredentials: number;
}

export interface AnalysisResult {
  report: InventoryReport;
  derived: Derived;
  document: RenderedDocument;
}

export interface AiPayloadSummary {
  modules: number;
  modulesWithSource: number;
  codeLines: number;
  queries: number;
  queriesWithSql: number;
  sheets: number;
  tables: number;
  dependencies: number;
  maskedCredentials: number;
}

/** AI 版の送信内容。プレビュー・保存・送信はすべて同じ文字列 body を使う */
export interface AiPayload {
  body: string;
  bodyBytes: number;
  estimate: { inputTokens: number; batches: number };
  summary: AiPayloadSummary;
  /** 送信内容に含まれる、注意が必要な文字列(メールアドレス・トークンなど) */
  sensitive: { total: number; hits: SensitiveHit[] };
}

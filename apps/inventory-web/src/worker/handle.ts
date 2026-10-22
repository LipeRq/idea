// Worker の処理の中身。engine.worker.ts は onmessage の配線だけで、ここは単体テストで Node.js から直接呼べる。
import {
  analyzeBuffer,
  CorruptFileError,
  ENTRY_POINT_KIND_LABEL,
  InventoryError,
  LimitExceededError,
  MODULE_TYPE_LABEL,
  PROCEDURE_KIND_LABEL,
  QUERY_TYPE_LABEL,
  PasswordError,
  renderMarkdown,
  SEVERITY_LABEL,
  TOOL_VERSION,
  UnsupportedFileError,
  type AnalysisLimits,
  type InventoryReport,
} from "@engine/browser";
import { estimateComplexity, FORMAT_LABEL, formatLocation, groupDependencies } from "@engine/doc/facts";
import { businessFlowDiagram, callFlowDiagram, MAX_GRAPH_NODES, queryDiagram, relationshipDiagram } from "@engine/doc/mermaid";
import { extractExternalRefs } from "@/lib/external-refs";
import { jsonToAiDocument, type AiDocumentJson } from "@/lib/ai-json";
import { estimateAiRequest } from "@/shared/ai-estimate";
import { redactForAi } from "@/shared/ai-redact";
import { scanSensitive } from "@/shared/sensitive-scan";
import { markdownToHtml, PREVIEW_MAX_MARKDOWN_BYTES } from "./markdown";
import type { AiPayload, AnalysisResult, Derived, Phase, RenderedDocument, WorkerError, WorkerRequest, WorkerResponse } from "./protocol";

export const ENGINE_VERSION = TOOL_VERSION;

/** エンジンが暗号化 .accdb で投げる UnsupportedFileError の文言の先頭(src/browser/mdbEnvironment.ts。単体テストで固定) */
export const ENCRYPTED_ACCESS_PREFIX = "パスワードで暗号化された Access";

/**
 * 例外を画面に返す形にする。クラス名ではなく instanceof で判定する(minify でクラス名が変わっても壊れない)。
 * 想定外の例外はメッセージを返さない(入力の一部やスタックを画面・ログに出さない)。
 */
export function toWorkerError(e: unknown): WorkerError {
  if (e instanceof LimitExceededError) return { code: "limit", message: e.message, kind: e.kind };
  if (e instanceof PasswordError) return { code: "password", message: e.message };
  if (e instanceof UnsupportedFileError) {
    return { code: e.message.startsWith(ENCRYPTED_ACCESS_PREFIX) ? "encryptedAccess" : "unsupported", message: e.message };
  }
  if (e instanceof CorruptFileError) return { code: "corrupt", message: e.message };
  if (e instanceof InventoryError) return { code: "corrupt", message: e.message };
  return { code: "internal", message: "" };
}

export class ReadFailedError extends Error {}

const textBytes = (s: string) => new TextEncoder().encode(s).length;

export function renderDocument(markdown: string): RenderedDocument {
  const markdownBytes = textBytes(markdown);
  const { html, diagrams } = markdownToHtml(markdown);
  return { markdown, html, diagrams, previewable: markdownBytes <= PREVIEW_MAX_MARKDOWN_BYTES, markdownBytes };
}

const EDGE_KIND_LABEL = { call: "呼び出し", run: "Run / OnTime で実行", formShow: "画面を表示" } as const;

export function derive(r: InventoryReport): Derived {
  const counts = { high: 0, medium: 0, low: 0 };
  for (const f of r.findings) counts[f.severity]++;
  const relationships = relationshipDiagram(r);
  return {
    formatLabel: FORMAT_LABEL[r.file.format],
    complexity: estimateComplexity(r),
    findingCounts: counts,
    findings: r.findings.map((f) => ({
      ruleId: f.ruleId,
      severity: f.severity,
      severityLabel: SEVERITY_LABEL[f.severity],
      title: f.title,
      detail: f.detail,
      count: f.count,
      locations: f.locations.map(formatLocation).filter(Boolean),
    })),
    entryPoints: r.entryPoints.map((e) => ({
      kindLabel: ENTRY_POINT_KIND_LABEL[e.kind],
      trigger: e.trigger,
      procedure: e.procedure ?? `${e.target}(見つかりません)`,
    })),
    callEdges: r.callGraph.map((e) => ({ from: e.from, to: e.to, kindLabel: EDGE_KIND_LABEL[e.kind] })),
    diagrams: { callFlow: callFlowDiagram(r), queries: queryDiagram(r), relationships },
    maxGraphNodes: MAX_GRAPH_NODES,
    dependencyGroups: groupDependencies(r.dependencies).map((g) => ({
      kind: g.kind,
      label: g.label,
      items: g.items.map((i) => ({ target: i.target, category: i.category, count: i.count, locations: i.locations.map(formatLocation).filter(Boolean) })),
    })),
    externalRefs: extractExternalRefs(r.dependencies),
    labels: { moduleType: MODULE_TYPE_LABEL, procedureKind: PROCEDURE_KIND_LABEL, queryType: QUERY_TYPE_LABEL },
    maskedCredentials: r.findings.find((f) => f.ruleId === "CRED-HARDCODED")?.count ?? 0,
  };
}

/** Web Crypto で SHA-256 を計算する(エンジンの自前の実装より速い)。使えない環境(secure context でない等)では null */
export async function subtleSha256(bytes: Uint8Array): Promise<string | null> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return null;
  try {
    const digest = new Uint8Array(await subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>));
    return Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return null;
  }
}

async function readFile(file: Blob): Promise<Uint8Array> {
  try {
    return new Uint8Array(await file.arrayBuffer());
  } catch (e) {
    throw new ReadFailedError("ファイルを読み込めませんでした", { cause: e });
  }
}

export async function analyzeFile(
  file: File,
  limits: Partial<AnalysisLimits>,
  onPhase: (phase: Phase) => void,
  now?: Date,
): Promise<AnalysisResult> {
  onPhase("reading");
  const bytes = await readFile(file);
  const hash = await subtleSha256(bytes);
  onPhase("analyzing");
  const report = analyzeBuffer(bytes, file.name, { limits, now, ...(hash ? { sha256: () => hash } : {}) });
  onPhase("rendering");
  const document = renderDocument(renderMarkdown(report));
  return { report, derived: derive(report), document };
}

export function renderAiDocument(report: InventoryReport, ai: AiDocumentJson): { document: RenderedDocument; businessFlow: string | null } {
  const doc = jsonToAiDocument(ai);
  const steps = doc.overall.businessFlow.steps;
  return {
    document: renderDocument(renderMarkdown(report, { ai: doc })),
    businessFlow: steps.length > 0 ? businessFlowDiagram(steps) : null,
  };
}

export function buildAiPayload(report: InventoryReport, includeSource: boolean, consentVersion: string): AiPayload {
  const redacted = redactForAi(report, includeSource);
  const body = JSON.stringify({ consentVersion, report: redacted });
  const modules = redacted.vba?.modules ?? [];
  // 送るクエリはすべて数える(フォーム・レポートの内部のクエリ ~sq_ も SQL ごと送られるため、別に数えて示す)
  const allQueries = redacted.access?.queries ?? [];
  const queries = allQueries.filter((q) => !q.hidden);
  return {
    body,
    bodyBytes: textBytes(body),
    estimate: estimateAiRequest(redacted),
    summary: {
      modules: modules.length,
      modulesWithSource: modules.filter((m) => m.source !== null).length,
      codeLines: modules.filter((m) => m.source !== null).reduce((s, m) => s + m.lineCount, 0),
      queries: queries.length,
      hiddenQueries: allQueries.length - queries.length,
      queriesWithSql: allQueries.filter((q) => q.sql !== null).length,
      sheets: redacted.excel?.sheets.length ?? 0,
      tables: redacted.access?.tables.length ?? 0,
      dependencies: redacted.dependencies.length,
      maskedCredentials: redacted.findings.find((f) => f.ruleId === "CRED-HARDCODED")?.count ?? 0,
    },
    sensitive: scanSensitive(redacted),
  };
}

/** 1件の依頼を処理し、結果(またはエラー)を post で返す。例外は外に出さない */
export async function handleRequest(req: WorkerRequest, post: (res: WorkerResponse) => void): Promise<void> {
  try {
    switch (req.type) {
      case "analyze": {
        const result = await analyzeFile(req.file, req.limits, (phase) => post({ type: "phase", id: req.id, phase }));
        post({ type: "analyzed", id: req.id, result });
        return;
      }
      case "render": {
        const { document, businessFlow } = renderAiDocument(req.report, req.ai);
        post({ type: "rendered", id: req.id, document, businessFlow });
        return;
      }
      case "aiPayload":
        post({ type: "aiPayload", id: req.id, payload: buildAiPayload(req.report, req.includeSource, req.consentVersion) });
        return;
    }
  } catch (e) {
    post({ type: "error", id: req.id, error: e instanceof ReadFailedError ? { code: "readFailed", message: "" } : toWorkerError(e) });
  }
}

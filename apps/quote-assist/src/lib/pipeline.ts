import { createHash, randomUUID } from "node:crypto";
import {
  type Inquiry,
  type ReviewLogEntry,
  type StepMetric,
  type StepName,
  type Usage,
} from "./domain/inquiry";
import { estimateCostUsd } from "./ai/client";
import { todayJst } from "./dates";
import { buildSalesforcePayload } from "./crm/salesforce-payload";
import { salesforceOptionsFromEnv } from "./crm";
import { CrmError } from "./crm/types";
import type { Deps } from "./deps";
import { estimateWithClaude } from "./estimate/claude";
import { fallbackProposals, type ProcessProposal } from "./estimate/fallback";
import { extractWithClaude } from "./extraction/claude";
import { demoExtraction, emptyExtraction } from "./extraction/demo";
import { applyExtractionEdits, EditError, type ExtractionEdits } from "./extraction/edit";
import { normalizeExtraction } from "./extraction/normalize";
import { applyRules, unconfirmedFields } from "./extraction/rules";
import type { ExtractionOutput } from "./extraction/schema";
import { formatYen } from "./format";
import { logError, logEvent } from "./log";
import { buildQuoteInput } from "./quote/build";
import { calculateQuote, QuoteInputError } from "./quote/calculate";
import type { QuoteInput } from "./quote/types";
import { buildCaseQuery, searchSimilarCases } from "./similar/search";

// 引き合い1件の処理の流れ。AIの呼び出し・保存・CRMは deps から受け取り、テストで差し替えられるようにする。

export class PipelineError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export const LIMITS = {
  maxFiles: 3,
  maxFileBytes: 10 * 1024 * 1024,
  maxTotalBytes: 20 * 1024 * 1024,
  maxBodyChars: 20_000,
};

export type UploadedFile = { name: string; data: Uint8Array };

/**
 * 引き合い1件ごとに、変更する処理を順番に実行する(同じ引き合いへの同時の要求で、
 * 承認前のCRM登録の判定をすり抜けたり、二重登録・更新の取りこぼしが起きたりしないように)。
 * 1台のサーバー(1プロセス)で動かす前提。複数台にするときはDBの行ロックか条件付き更新に置き換える。
 */
const locks = new Map<string, Promise<unknown>>();

export async function withInquiryLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const previous = locks.get(id) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(fn);
  const tail = run.catch(() => undefined);
  locks.set(id, tail);
  try {
    return await run;
  } finally {
    if (locks.get(id) === tail) locks.delete(id);
  }
}

/**
 * 図面のファイル名を画面とAIへの入力に使える形にする。制御文字・書式文字(右から左への上書きなど)と
 * パス区切りを除き、120文字までにする。保存先のパスにはファイル名を使わない(引き合いidと連番)。
 */
export function sanitizeFileName(name: string): string {
  const cleaned = name
    .normalize("NFC")
    .replace(/\s+/g, " ")
    .replace(/[\p{Cc}\p{Cf}]/gu, "")
    .replace(/[\\/]/g, "_")
    .trim()
    .slice(0, 120);
  return cleaned === "" || /^\.+$/.test(cleaned) ? "drawing.pdf" : cleaned;
}

function metric(
  step: StepName,
  mode: StepMetric["mode"],
  durationMs: number,
  now: Date,
  ai?: { usage: Usage; model: string },
): StepMetric {
  return {
    step,
    mode,
    durationMs: Math.round(durationMs),
    model: ai?.model ?? null,
    usage: ai?.usage ?? null,
    costUsd: ai ? estimateCostUsd(ai.usage, ai.model) : null,
    at: now.toISOString(),
  };
}

/** 同じ手順の計測は最新の1回だけ残す(再検索・再計算したとき) */
function withMetrics(inquiry: Inquiry, ...metrics: StepMetric[]): StepMetric[] {
  const steps = new Set(metrics.map((m) => m.step));
  return [...inquiry.metrics.filter((m) => !steps.has(m.step)), ...metrics];
}

const elapsed = (start: number) => performance.now() - start;

export function validateUpload(files: UploadedFile[], body: string) {
  if (body.length > LIMITS.maxBodyChars) throw new PipelineError("メール本文が長すぎます(2万文字まで)", 413);
  if (files.length > LIMITS.maxFiles) throw new PipelineError("図面は3ファイルまでです", 400);
  let total = 0;
  for (const f of files) {
    total += f.data.byteLength;
    if (f.data.byteLength > LIMITS.maxFileBytes) throw new PipelineError("図面は1ファイル10MBまでです", 413);
    const head = new TextDecoder().decode(f.data.subarray(0, 5));
    if (head !== "%PDF-") throw new PipelineError(`PDFではないファイルがあります(${sanitizeFileName(f.name).slice(0, 60)})`, 400);
  }
  if (total > LIMITS.maxTotalBytes) throw new PipelineError("図面は合計20MBまでです", 413);
  if (files.length === 0 && body.trim() === "") throw new PipelineError("メール本文か図面のどちらかを入力してください", 400);
}

const AI_DAILY_LIMIT_MESSAGE = "本日のAIの利用上限に達したため、AIによる読み取りをしていません。各項目を手入力するか、明日以降に登録し直してください。";

/** AI の1日の上限から1回分を確保する。上限に達していたら記録して false */
function reserveAi(deps: Deps, step: "extract" | "estimate", now: Date): boolean {
  if (deps.aiQuota.reserve(now)) return true;
  logEvent("ai.daily_limit", { step, limit: deps.aiQuota.limit });
  return false;
}

export async function registerInquiry(
  deps: Deps,
  input: { email: { from: string; subject: string; body: string }; files: UploadedFile[] },
): Promise<Inquiry> {
  const email = {
    from: input.email.from.trim().slice(0, 200),
    subject: input.email.subject.trim().slice(0, 200),
    body: input.email.body,
  };
  validateUpload(input.files, email.body);
  const ref = await deps.reference();
  const now = deps.now();
  const today = todayJst(now);
  const id = randomUUID();

  const drawings = await Promise.all(
    input.files.map(async (f, i) => {
      const blobKey = `${id}-${i + 1}`;
      await deps.storage.blobs.put(blobKey, f.data);
      return {
        id: String(i + 1),
        fileName: sanitizeFileName(f.name),
        sizeBytes: f.data.byteLength,
        sha256: createHash("sha256").update(f.data).digest("hex"),
        blobKey,
      };
    }),
  );

  // 1. 図面・メールの読み取り(AI)
  let output: ExtractionOutput;
  let mode: Inquiry["extraction"]["mode"];
  let error: string | null = null;
  let start = performance.now();
  let extractMetric: StepMetric;
  if (deps.aiMode === "anthropic" && !reserveAi(deps, "extract", now)) {
    output = emptyExtraction("本日のAIの利用上限に達したため、AIによる読み取りをしていません。各項目を手入力してください。");
    mode = "failed";
    error = AI_DAILY_LIMIT_MESSAGE;
    extractMetric = metric("extract", "ai", elapsed(start), now);
  } else if (deps.aiMode === "anthropic") {
    try {
      const r = await extractWithClaude({
        drawings: input.files.map((f, i) => ({ fileName: drawings[i].fileName, data: f.data })),
        email,
        receivedAt: today,
        rates: ref.rates,
      });
      output = r.output;
      mode = "ai";
      extractMetric = metric("extract", "ai", elapsed(start), now, r);
    } catch (e) {
      logError("extract.failed", e, { inquiryId: id });
      output = emptyExtraction("AIによる読み取りに失敗しました。各項目を手入力してください。");
      mode = "failed";
      error = "AIによる読み取りに失敗しました。各項目を手入力するか、時間をおいて登録し直してください。";
      extractMetric = metric("extract", "ai", elapsed(start), now);
    }
  } else {
    output = demoExtraction({ fileNames: drawings.map((d) => d.fileName), email, today }).output;
    mode = "demo";
    extractMetric = metric("extract", "demo", elapsed(start), now);
  }

  // 2. 正規化・必須項目チェック(ルール)
  start = performance.now();
  const normalized = normalizeExtraction(output, { rates: ref.rates, customers: ref.customers, from: email.from });
  const { fields, questions } = applyRules(normalized.spec, normalized.fields, normalized.aiQuestions, {
    rates: ref.rates,
    today,
  });
  const rulesMetric = metric("rules", "rule", elapsed(start), now);

  const inquiry: Inquiry = {
    id,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    status: "extracted",
    email,
    drawings,
    extraction: {
      mode,
      summary: normalized.summary,
      spec: normalized.spec,
      fields,
      aiQuestions: normalized.aiQuestions,
      questions,
      error,
    },
    similar: null,
    estimate: null,
    quote: null,
    approved: null,
    reviewLog: [],
    metrics: [extractMetric, rulesMetric],
    crm: null,
  };
  await deps.storage.inquiries.save(inquiry);
  logEvent("inquiry.registered", {
    inquiryId: id,
    files: drawings.length,
    mode,
    extractMs: extractMetric.durationMs,
    inputTokens: extractMetric.usage?.inputTokens ?? 0,
    outputTokens: extractMetric.usage?.outputTokens ?? 0,
  });
  return inquiry;
}

async function load(deps: Deps, id: string): Promise<Inquiry> {
  const inquiry = await deps.storage.inquiries.get(id);
  if (!inquiry) throw new PipelineError("引き合いが見つかりません", 404);
  return inquiry;
}

function ensureEditable(inquiry: Inquiry) {
  if (inquiry.status === "approved" || inquiry.status === "registered") {
    throw new PipelineError("承認済みの見積は変更できません。承認を取り消してから修正してください", 409);
  }
}

export function updateExtraction(deps: Deps, id: string, edits: ExtractionEdits): Promise<Inquiry> {
  return withInquiryLock(id, () => updateExtractionNow(deps, id, edits));
}

async function updateExtractionNow(deps: Deps, id: string, edits: ExtractionEdits): Promise<Inquiry> {
  const inquiry = await load(deps, id);
  ensureEditable(inquiry);
  const ref = await deps.reference();
  const now = deps.now();
  let result;
  try {
    result = applyExtractionEdits(inquiry, edits, {
      rates: ref.rates,
      customers: ref.customers,
      today: todayJst(new Date(inquiry.createdAt)),
      now: now.toISOString(),
    });
  } catch (e) {
    if (e instanceof EditError) throw new PipelineError(e.message, 400);
    throw e;
  }
  const changed = result.log.length > 0;
  const updated: Inquiry = {
    ...inquiry,
    extraction: result.extraction,
    reviewLog: [...inquiry.reviewLog, ...result.log],
    updatedAt: now.toISOString(),
    // 仕様が変わったら、類似検索と見積は作り直す
    ...(changed ? { status: "extracted" as const, similar: null, estimate: null, quote: null } : {}),
  };
  await deps.storage.inquiries.save(updated);
  return updated;
}

/** 類似案件の検索、工数案(AIまたは類似実績からの計算)、見積計算 */
export function runEstimate(deps: Deps, id: string): Promise<Inquiry> {
  return withInquiryLock(id, () => runEstimateNow(deps, id));
}

/** 単価表から材質・工程・処理が消えたなど、今の単価表では計算できないとき */
function quoteInputConflict(e: unknown): never {
  if (e instanceof QuoteInputError) {
    throw new PipelineError(`今の単価表では計算できません(${e.message})。単価表か見積の内容を確認してください`, 409);
  }
  throw e;
}

async function runEstimateNow(deps: Deps, id: string): Promise<Inquiry> {
  const inquiry = await load(deps, id);
  ensureEditable(inquiry);
  const ref = await deps.reference();
  const now = deps.now();
  const today = todayJst(new Date(inquiry.createdAt));
  const spec = inquiry.extraction.spec;

  let start = performance.now();
  const candidates = searchSimilarCases(buildCaseQuery(spec, ref.rates), ref.cases, ref.rates, ref.defects);
  const searchMetric = metric("search", "rule", elapsed(start), now);

  start = performance.now();
  const fallback = fallbackProposals(spec, candidates, ref.cases, ref.rates);
  let proposals: ProcessProposal[] = fallback;
  let estimateMode: "ai" | "fallback" = "fallback";
  let ranking: { caseId: string; reason: string }[] = [];
  let risks: string[] = [];
  let memo = "類似案件の実績工数を類似度で加重平均した工数案です(AIは使っていません)。";
  let estimateMetric = metric("estimate", "fallback", 0, now);
  if (deps.aiMode === "anthropic" && candidates.length > 0 && !reserveAi(deps, "estimate", now)) {
    memo = "本日のAIの利用上限に達したため、類似案件の実績工数を類似度で加重平均した工数案にしています(AIは使っていません)。";
    estimateMetric = metric("estimate", "fallback", elapsed(start), now);
  } else if (deps.aiMode === "anthropic" && candidates.length > 0) {
    try {
      const r = await estimateWithClaude({ spec, candidates, cases: ref.cases, defects: ref.defects, rates: ref.rates, fallback });
      if (r.result.processes.length > 0) {
        proposals = r.result.processes;
        estimateMode = "ai";
      }
      ranking = r.result.ranking;
      risks = r.result.risks;
      memo = r.result.memo || memo;
      estimateMetric = metric("estimate", "ai", elapsed(start), now, r);
      logEvent("estimate.ai", { inquiryId: id, rejected: r.result.rejected, processes: r.result.processes.length });
    } catch (e) {
      logError("estimate.failed", e, { inquiryId: id });
      estimateMetric = metric("estimate", "fallback", elapsed(start), now);
    }
  } else {
    estimateMetric = metric("estimate", "fallback", elapsed(start), now);
  }

  // AIの並べ替えを優先し、残りはスコア順。表示は上位5件
  const rankIndex = new Map(ranking.map((r, i) => [r.caseId, i]));
  const similar = [...candidates]
    .sort((a, b) => (rankIndex.get(a.caseId) ?? 99) - (rankIndex.get(b.caseId) ?? 99))
    .slice(0, 5)
    .map((s) => ({ ...s, aiReason: ranking.find((r) => r.caseId === s.caseId)?.reason ?? null }));

  start = performance.now();
  let built: ReturnType<typeof buildQuoteInput>;
  try {
    built = buildQuoteInput(spec, proposals.map((p) => p.input), { rates: ref.rates, similar, cases: ref.cases, today });
    calculateQuote(built.input, ref.rates);
  } catch (e) {
    quoteInputConflict(e);
  }
  const { input, assumptions } = built;
  const calcMetric = metric("calculate", "rule", elapsed(start), now);

  const updated: Inquiry = {
    ...inquiry,
    status: "estimated",
    updatedAt: now.toISOString(),
    similar: { mode: ranking.length > 0 ? "ai" : "rule", cases: similar },
    estimate: {
      mode: estimateMode,
      proposal: input,
      rationales: proposals.map((p) => ({ processId: p.input.processId, rationale: p.rationale })),
      risks,
      memo,
      assumptions,
    },
    quote: { input, updatedAt: now.toISOString() },
    metrics: withMetrics(inquiry, searchMetric, estimateMetric, calcMetric),
  };
  await deps.storage.inquiries.save(updated);
  return updated;
}

const fmt = (v: number) => String(Math.round(v * 1000) / 1000);

/** AIの案(または前回保存した値)と人の入力の差を記録する */
export function diffQuote(before: QuoteInput, after: QuoteInput, names: Map<string, string>, at: string): ReviewLogEntry[] {
  const log: ReviewLogEntry[] = [];
  const add = (key: string, label: string, b: string, a: string) => {
    if (b !== a) log.push({ at, kind: "quote", key, label, before: b, after: a });
  };
  add("quantity", "数量", fmt(before.quantity), fmt(after.quantity));
  add("profitRate", "利益率", fmt(before.profitRate), fmt(after.profitRate));
  add("expedite", "特急料金", before.expedite ? "あり" : "なし", after.expedite ? "あり" : "なし");
  add("material", "材質", before.material.materialId, after.material.materialId);
  add(
    "materialPrice",
    "材料単価",
    before.material.pricePerKgOverride === null ? "単価表" : fmt(before.material.pricePerKgOverride),
    after.material.pricePerKgOverride === null ? "単価表" : fmt(after.material.pricePerKgOverride),
  );
  const ids = new Set([...before.processes, ...after.processes].map((p) => p.processId));
  for (const pid of ids) {
    const b = before.processes.find((p) => p.processId === pid);
    const a = after.processes.find((p) => p.processId === pid);
    const name = names.get(pid) ?? pid;
    if (!b || !a) {
      add(`process:${pid}`, `${name}`, b ? "あり" : "なし", a ? "あり" : "なし");
      continue;
    }
    add(`process:${pid}:setup`, `${name}の段取り時間`, fmt(b.setupHours), fmt(a.setupHours));
    add(`process:${pid}:cycle`, `${name}の1個あたり時間`, fmt(b.cycleHoursPerPiece), fmt(a.cycleHoursPerPiece));
    add(
      `process:${pid}:charge`,
      `${name}のチャージ`,
      b.chargeOverride === null ? "単価表" : fmt(b.chargeOverride),
      a.chargeOverride === null ? "単価表" : fmt(a.chargeOverride),
    );
  }
  const tb = before.treatments.map((t) => t.treatmentId).sort().join(",") || "なし";
  const ta = after.treatments.map((t) => t.treatmentId).sort().join(",") || "なし";
  add("treatments", "表面処理・熱処理", tb, ta);
  return log;
}

/** 人の修正を保存する。AI案から値を変えた工程は出典を「人」にする */
export function saveQuote(deps: Deps, id: string, input: QuoteInput): Promise<Inquiry> {
  return withInquiryLock(id, () => saveQuoteNow(deps, id, input));
}

async function saveQuoteNow(deps: Deps, id: string, input: QuoteInput): Promise<Inquiry> {
  const inquiry = await load(deps, id);
  ensureEditable(inquiry);
  if (!inquiry.quote || !inquiry.estimate) throw new PipelineError("先に類似案件の検索と工数案の作成を行ってください", 409);
  const ref = await deps.reference();
  const now = deps.now();
  const proposal = inquiry.estimate.proposal;
  const normalized: QuoteInput = {
    ...input,
    processes: input.processes.map((p) => {
      const ai = proposal.processes.find((x) => x.processId === p.processId);
      const same = ai && ai.setupHours === p.setupHours && ai.cycleHoursPerPiece === p.cycleHoursPerPiece && p.chargeOverride === null;
      if (same) return { ...p, source: ai.source };
      return {
        ...p,
        source: {
          kind: "human" as const,
          caseIds: ai?.source.caseIds ?? [],
          note: ai ? `案:段取り${ai.setupHours}h・1個${ai.cycleHoursPerPiece}hから修正` : "人が追加した工程",
        },
      };
    }),
  };
  try {
    calculateQuote(normalized, ref.rates);
  } catch (e) {
    if (e instanceof QuoteInputError) throw new PipelineError(e.message, 400);
    throw e;
  }
  const names = new Map(ref.rates.processes.map((p) => [p.id, p.name]));
  const log = diffQuote(inquiry.quote.input, normalized, names, now.toISOString());
  const updated: Inquiry = {
    ...inquiry,
    quote: { input: normalized, updatedAt: now.toISOString() },
    reviewLog: [...inquiry.reviewLog, ...log],
    updatedAt: now.toISOString(),
  };
  await deps.storage.inquiries.save(updated);
  return updated;
}

export type ApproveOptions = {
  /** 承認者が画面で見た合計金額(税抜)。計算結果と違えば承認しない(単価表の差し替えなどで金額が変わったとき) */
  expectedTotal?: number;
  /** 抽出結果の要確認・不足の項目を承認者が確認したか */
  acknowledgeUnconfirmed?: boolean;
};

export function approveQuote(deps: Deps, id: string, approver = "見積担当者", options: ApproveOptions = {}): Promise<Inquiry> {
  return withInquiryLock(id, () => approveQuoteNow(deps, id, approver, options));
}

async function approveQuoteNow(deps: Deps, id: string, approver: string, options: ApproveOptions): Promise<Inquiry> {
  const inquiry = await load(deps, id);
  ensureEditable(inquiry);
  if (!inquiry.quote) throw new PipelineError("見積がまだありません", 409);
  // 確信度が低い・根拠がない・不足している抽出項目を、確認しないまま承認しない
  const unconfirmed = unconfirmedFields(inquiry.extraction.fields);
  if (unconfirmed.length > 0 && !options.acknowledgeUnconfirmed) {
    throw new PipelineError(
      `抽出結果に未確認の項目があります(${unconfirmed.map((f) => f.label).join("・")})。内容を確認したうえで承認してください`,
      409,
    );
  }
  const ref = await deps.reference();
  const now = deps.now();
  let result: ReturnType<typeof calculateQuote>;
  try {
    result = calculateQuote(inquiry.quote.input, ref.rates);
  } catch (e) {
    quoteInputConflict(e);
  }
  if (options.expectedTotal !== undefined && options.expectedTotal !== result.total) {
    throw new PipelineError(
      `画面の金額(${formatYen(options.expectedTotal)})と今の単価表での計算結果(${formatYen(result.total)})が違います。単価表が更新された可能性があるため、画面を読み込み直して確認してください`,
      409,
    );
  }
  const date = todayJst(now).replaceAll("-", "");
  const updated: Inquiry = {
    ...inquiry,
    status: "approved",
    updatedAt: now.toISOString(),
    approved: {
      at: now.toISOString(),
      quoteNumber: `QA-${date}-${id.slice(0, 4).toUpperCase()}`,
      rateTableId: ref.rates.id,
      input: inquiry.quote.input,
      unitPrice: result.unitPrice,
      total: result.total,
      standardLeadDays: result.standardLeadDays,
      weightKgPerPiece: result.weightKgPerPiece,
      lines: result.lines.map((l) => ({ kind: l.kind, label: l.label, basis: l.basis, amount: l.amount })),
      tiers: result.tiers,
    },
    reviewLog: [
      ...inquiry.reviewLog,
      ...(unconfirmed.length > 0
        ? [
            {
              at: now.toISOString(),
              kind: "field" as const,
              key: "unconfirmed",
              label: "未確認のまま進めた抽出項目",
              before: "",
              after: unconfirmed.map((f) => `${f.label}(${f.reason})`).join("、"),
            },
          ]
        : []),
      { at: now.toISOString(), kind: "quote", key: "approve", label: "承認", before: "未承認", after: approver },
    ],
  };
  await deps.storage.inquiries.save(updated);
  logEvent("quote.approved", { inquiryId: id, unconfirmed: unconfirmed.length });
  return updated;
}

export function unapproveQuote(deps: Deps, id: string): Promise<Inquiry> {
  return withInquiryLock(id, () => unapproveQuoteNow(deps, id));
}

async function unapproveQuoteNow(deps: Deps, id: string): Promise<Inquiry> {
  const inquiry = await load(deps, id);
  if (inquiry.status === "registered") throw new PipelineError("CRMに登録済みのため取り消せません", 409);
  if (inquiry.status !== "approved") return inquiry;
  const now = deps.now();
  const updated: Inquiry = {
    ...inquiry,
    status: "estimated",
    approved: null,
    updatedAt: now.toISOString(),
    reviewLog: [
      ...inquiry.reviewLog,
      { at: now.toISOString(), kind: "quote", key: "approve", label: "承認", before: "承認済み", after: "取り消し" },
    ],
  };
  await deps.storage.inquiries.save(updated);
  return updated;
}

/** 承認済みの見積だけを、Salesforceの商談+見積として登録する(一方向) */
export function registerToCrm(deps: Deps, id: string): Promise<Inquiry> {
  // 同時に2回押されても、2回目は1回目の保存を待ってから「登録済み」で断る
  return withInquiryLock(id, () => registerToCrmNow(deps, id));
}

async function registerToCrmNow(deps: Deps, id: string): Promise<Inquiry> {
  const inquiry = await load(deps, id);
  if (inquiry.crm) throw new PipelineError("すでにCRMに登録済みです", 409);
  if (inquiry.status !== "approved" || !inquiry.approved) {
    throw new PipelineError("見積が承認されていません。承認してから登録してください", 409);
  }
  const ref = await deps.reference();
  const now = deps.now();
  const customer = ref.customers.find((c) => c.id === inquiry.extraction.spec.customerId) ?? null;
  const payload = buildSalesforcePayload({
    inquiry,
    customer,
    company: ref.company,
    rates: ref.rates,
    options: salesforceOptionsFromEnv(),
  });
  let result;
  try {
    result = await deps.crm.register(payload, { inquiryId: id, now });
  } catch (e) {
    // Salesforce のエラーコード(INVALID_FIELD など。項目の値は含まない)だけを残す
    const codes = e instanceof CrmError ? e.codes.join(",").slice(0, 64) : null;
    logError("crm.failed", e, { inquiryId: id, provider: deps.crm.provider, codes });
    if (e instanceof CrmError) throw new PipelineError(e.message, 502);
    throw new PipelineError("CRMへの登録に失敗しました。時間をおいてもう一度お試しください", 502);
  }
  const updated: Inquiry = {
    ...inquiry,
    status: "registered",
    updatedAt: now.toISOString(),
    crm: { provider: deps.crm.provider, ...result, registeredAt: now.toISOString() },
  };
  await deps.storage.inquiries.save(updated);
  logEvent("crm.registered", { inquiryId: id, provider: deps.crm.provider });
  return updated;
}

export function deleteInquiry(deps: Deps, id: string): Promise<void> {
  return withInquiryLock(id, () => deleteInquiryNow(deps, id));
}

async function deleteInquiryNow(deps: Deps, id: string): Promise<void> {
  const inquiry = await load(deps, id);
  await Promise.all(inquiry.drawings.map((d) => deps.storage.blobs.delete(d.blobKey)));
  await deps.storage.inquiries.delete(id);
  logEvent("inquiry.deleted", { inquiryId: id });
}

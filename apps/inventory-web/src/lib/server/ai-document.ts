// AI 版の受付(POST /api/ai-document の中身)。route.ts は配線だけで、ここを単体テストで直接呼ぶ。
// 受け付ける順番: 有効か → アクセスコード → 送信元ごとの回数 → Content-Type → 本文の大きさ → 形式と同意の版 →
// 送らない項目をサーバーでも外す → 依頼の大きさ → 1日の上限 → 生成(NDJSON で進捗を返す)。
// データはリクエストの処理中のメモリだけに置き、保存しない。ログは log.ts の方針(件数だけ)に従う。
import { AiGenerationError, createClaudeClient, generateAiDocument, type StructuredClient } from "@engine/doc/ai";
import { aiDocumentToJson, describeAiError } from "@engine/doc/document";
import { InventoryReportSchema, type InventoryReport } from "@engine/schema";
import { z } from "zod";
import { CONSENT_VERSION } from "@/lib/ai-consent";
import { estimateAiRequest } from "@/shared/ai-estimate";
import { redactForAi } from "@/shared/ai-redact";
import { accessCodeMatches, readAccessCode } from "./access-code";
import { accessCodeLocked, recordAccessCodeFailure } from "./access-guard";
import { aiConfigFromEnv, type AiServerConfig } from "./ai-config";
import { reserveDailyAi } from "./ai-quota";
import { clientKey, errorResponse, NO_STORE, parseJson, readBodyText } from "./http";
import { errorClassOf, logAiRequest, type AiLogEntry } from "./log";
import { createMockClient } from "./mock-client";
import { checkHourlyLimit } from "./rate-limit";

export const HEARTBEAT_MS = 15_000;
/** 生成全体の時間の上限。route.ts の maxDuration(300秒)より前に打ち切って、理由を画面に返せるようにする */
export const AI_DEADLINE_MS = 280_000;
/** 1回の依頼(SDK の再試行を含む)の時間の上限。SDK の既定(10分×再試行)は関数の上限より長い */
export const AI_REQUEST_TIMEOUT_MS = 240_000;

export interface AiRouteDeps {
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
  createClient?: (config: AiServerConfig, signal: AbortSignal) => StructuredClient;
  heartbeatMs?: number;
  /** 外側からの中止。route.ts がリクエストの中止と全体の時間上限(AI_DEADLINE_MS)をまとめて渡す。省略時は request.signal */
  signal?: AbortSignal;
}

/** 外側の形だけを画面アプリの zod で確かめる(report はエンジンの zod のスキーマで別に確かめる。2つを1つのスキーマに混ぜない) */
const EnvelopeSchema = z.object({ consentVersion: z.string().max(40), report: z.unknown() });

export class AbortedError extends Error {
  constructor() {
    super("aborted");
  }
}

/** 中止されたら新しい依頼を出さないようにする(実行中の1件は終わるまで走る) */
export function abortableClient(client: StructuredClient, signal: AbortSignal): StructuredClient {
  return {
    generate(req) {
      if (signal.aborted) return Promise.reject(new AbortedError());
      return client.generate(req);
    },
  };
}

function defaultClient(config: AiServerConfig, signal: AbortSignal): StructuredClient {
  return config.mode === "mock"
    ? createMockClient(config.mockDelayMs, signal)
    : createClaudeClient(undefined, { signal, requestTimeoutMs: AI_REQUEST_TIMEOUT_MS });
}

const TIMEOUT_MESSAGE = "AIによる文章の作成が時間内に終わりませんでした。標準の仕様書をお使いいただくか、時間をおいてお試しください。";

/** 画面に返す失敗の理由。想定外の例外のメッセージ(入力の一部を含みうる)は返さない */
export function safeAiErrorMessage(e: unknown): string {
  if (e instanceof AiGenerationError) return e.message;
  const described = describeAiError(e);
  if (e instanceof Error && described === e.message) return "AIによる文章の作成に失敗しました。時間をおいてお試しください。";
  return described;
}

export async function handleAiDocumentPost(request: Request, deps: AiRouteDeps = {}): Promise<Response> {
  const started = Date.now();
  const config = aiConfigFromEnv(deps.env ?? process.env);
  const log: Omit<AiLogEntry, "durationMs"> = { outcome: "internal", mode: config.mode };
  const finish = (response: Response, outcome: AiLogEntry["outcome"]) => {
    logAiRequest({ ...log, outcome, durationMs: Date.now() - started });
    return response;
  };

  try {
    if (!config.available) {
      return finish(errorResponse(503, "disabled", "この環境ではAI版は利用できません。"), "disabled");
    }
    const env = deps.env ?? process.env;
    const source = clientKey(request, env);
    if (config.accessCode !== null) {
      // 総当たり対策: 誤ったコードの試行が続いた送信元(とサイト全体)は、正しいコードでもしばらく受け付けない
      const lock = await accessCodeLocked(source, { perSource: config.accessFailuresPerSource, site: config.accessFailuresSite }, Date.now(), env);
      if (lock === "unavailable") {
        return finish(errorResponse(503, "unavailable", "現在AI版を受け付けられません。時間をおいてお試しください。"), "store_unavailable");
      }
      if (lock === "limited") {
        return finish(
          errorResponse(429, "access_locked", "アクセスコードの誤りが続いたため、しばらく受け付けません。1時間ほどおいてお試しください。"),
          "access_locked",
        );
      }
      if (!accessCodeMatches(readAccessCode(request), config.accessCode)) {
        await recordAccessCodeFailure(source, Date.now(), env);
        return finish(errorResponse(403, "forbidden", "アクセスコードが違います。"), "forbidden");
      }
    }
    const hourly = await checkHourlyLimit(source, config.perHour, Date.now(), env);
    if (hourly === "unavailable") {
      return finish(errorResponse(503, "unavailable", "現在AI版を受け付けられません。時間をおいてお試しください。"), "store_unavailable");
    }
    if (hourly === "limited") {
      return finish(errorResponse(429, "rate_limited", "AI版の利用回数の上限に達しました。1時間ほどおいてお試しください。"), "rate_limited");
    }
    if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
      return finish(errorResponse(415, "unsupported_media_type", "送信内容の形式が正しくありません。"), "unsupported_media_type");
    }
    const text = await readBodyText(request, config.maxBodyBytes);
    if (text === null) {
      return finish(errorResponse(413, "too_large", "送信内容が大きすぎるため、AI版は作れません。標準の仕様書をお使いいただくか、ご相談ください。"), "too_large");
    }
    log.bodyBytes = Buffer.byteLength(text);
    const envelope = EnvelopeSchema.safeParse(parseJson(text));
    if (!envelope.success) {
      return finish(errorResponse(400, "invalid", "送信内容の形式が正しくありません。"), "invalid");
    }
    if (envelope.data.consentVersion !== CONSENT_VERSION) {
      return finish(errorResponse(409, "consent_outdated", "画面が古いため受け付けられませんでした。ページを再読み込みしてください。"), "consent_outdated");
    }
    const parsed = InventoryReportSchema.safeParse(envelope.data.report);
    if (!parsed.success) {
      return finish(errorResponse(400, "invalid", "送信内容の形式が正しくありません。"), "invalid");
    }
    // 画面で外した項目を、サーバーでも外し直す(ソースを送らない選択は、画面で null にしたものがそのまま残る)
    const report: InventoryReport = redactForAi(parsed.data, true);
    const modules = report.vba?.modules ?? [];
    log.modules = modules.length;
    log.procedures = modules.reduce((s, m) => s + m.procedures.length, 0);

    const estimate = estimateAiRequest(report);
    log.estimatedTokens = estimate.inputTokens;
    log.batches = estimate.batches;
    if (estimate.inputTokens > config.maxInputTokens || estimate.batches > config.maxBatches) {
      return finish(errorResponse(413, "too_large", "ファイルが大きすぎるため、AI版は作れません。標準の仕様書をお使いいただくか、ご相談ください。"), "too_large");
    }

    const daily = await reserveDailyAi(estimate.inputTokens, config, (deps.now ?? (() => new Date()))(), deps.env ?? process.env);
    if (daily === "unavailable") {
      return finish(errorResponse(503, "unavailable", "現在AI版を受け付けられません。時間をおいてお試しください。"), "store_unavailable");
    }
    if (daily === "limited") {
      return finish(errorResponse(429, "daily_limit", "本日のAI版の受付は終了しました。明日以降にお試しいただくか、ご相談ください。"), "daily_limit");
    }

    return streamGeneration(request, report, config, estimate.batches, deps, (outcome, extra) =>
      logAiRequest({ ...log, ...extra, outcome, durationMs: Date.now() - started }),
    );
  } catch {
    // 想定外の例外は外に出さない(Next.js がスタックと一緒に標準エラーに出すのを避ける)
    return finish(errorResponse(500, "internal", "サーバーでエラーが起きました。時間をおいてお試しください。"), "internal");
  }
}

function streamGeneration(
  request: Request,
  report: InventoryReport,
  config: AiServerConfig,
  batches: number,
  deps: AiRouteDeps,
  done: (outcome: AiLogEntry["outcome"], extra?: Partial<AiLogEntry>) => void,
): Response {
  const abort = new AbortController();
  const outer = deps.signal ?? request.signal;
  const onAbort = () => abort.abort(outer?.reason);
  if (outer?.aborted) onAbort();
  else outer?.addEventListener("abort", onAbort);
  // 全体の時間上限で止まったか(利用者が中止したときは画面に何も返さない)
  const timedOut = () => (abort.signal.reason as { name?: unknown } | undefined)?.name === "TimeoutError";
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const send = (event: object) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          open = false;
        }
      };
      // 統合の依頼は数分間イベントが出ないことがあるため、無通信で接続を切られないよう定期的に送る
      const heartbeat = setInterval(() => send({ type: "heartbeat" }), deps.heartbeatMs ?? HEARTBEAT_MS);
      try {
        send({ type: "accepted", batches });
        const client = abortableClient((deps.createClient ?? defaultClient)(config, abort.signal), abort.signal);
        const ai = await generateAiDocument(report, client, { concurrency: 3, onProgress: (message) => send({ type: "progress", message }) });
        if (abort.signal.aborted && timedOut()) {
          send({ type: "error", message: TIMEOUT_MESSAGE });
          done("ai_error", { errorClass: "TimeoutError" });
        } else if (abort.signal.aborted) {
          done("aborted");
        } else {
          send({ type: "done", ai: aiDocumentToJson(ai) });
          done("ok");
        }
      } catch (e) {
        if (abort.signal.aborted && timedOut()) {
          send({ type: "error", message: TIMEOUT_MESSAGE });
          done("ai_error", { errorClass: "TimeoutError" });
        } else if (abort.signal.aborted || e instanceof AbortedError) {
          done("aborted");
        } else {
          send({ type: "error", message: safeAiErrorMessage(e) });
          done("ai_error", errorClassOf(e));
        }
      } finally {
        clearInterval(heartbeat);
        outer?.removeEventListener("abort", onAbort);
        open = false;
        try {
          controller.close();
        } catch {
          // 既に閉じている(接続が切れた)
        }
      }
    },
    cancel() {
      abort.abort();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", ...NO_STORE, "X-Content-Type-Options": "nosniff" },
  });
}

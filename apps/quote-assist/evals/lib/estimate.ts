import type Anthropic from "@anthropic-ai/sdk";
import { mapLimit } from "./concurrency";
import { priceFor, usdJpy } from "./prices";
import { usd } from "./stats";

// 実行前の費用見積もり。実際に送る依頼(system・messages・出力形式)をそのまま取り出し、
// count_tokens(無料・推論なし)で入力トークンを数えて、概算費用を出す。出力トークンは想定値(実測は --limit 1 で確かめる)。

export type CapturedParams = {
  model: string;
  max_tokens: number;
  system?: unknown;
  messages: unknown;
  output_config?: unknown;
};

export class CapturedRequest extends Error {
  constructor(readonly params: CapturedParams) {
    super("(依頼の内容を取り出すための中断。エラーではありません)");
  }
}

/** stream() の最終メッセージを待つと、依頼の内容つきで CapturedRequest を投げるクライアント(API は呼ばない) */
export function captureClient(): Anthropic {
  const stream = (params: CapturedParams) => ({ finalMessage: () => Promise.reject(new CapturedRequest(params)) });
  return { beta: { messages: { stream } } } as unknown as Anthropic;
}

/** アプリの本物の関数に captureClient を渡して実行し、アプリが送ろうとした依頼を取り出す */
export async function captureRequest(run: (client: Anthropic) => Promise<unknown>): Promise<CapturedParams> {
  try {
    await run(captureClient());
  } catch (e) {
    if (e instanceof CapturedRequest) return e.params;
    throw e;
  }
  throw new Error("API の呼び出しが行われなかったので、依頼の内容を取り出せませんでした");
}

export type PlannedCall = {
  /** 案件・サンプルの id */
  caseId: string;
  /** 呼び出しの種類(例: レポート生成 / 採点 / モジュール要約) */
  step: string;
  params: CapturedParams;
  /** 実行する回数(reps や、同じ形の呼び出しの数) */
  times: number;
  /** 出力トークンの想定(思考トークンを含む。上限は params.max_tokens) */
  assumedOutputTokens: number;
  /** 実行してみないと分からない入力(例: 採点者に渡す生成結果)の想定トークン。実測の入力に足す */
  extraInputTokens?: number;
};

export type EstimateRow = {
  caseId: string;
  step: string;
  model: string;
  times: number;
  inputTokens: number;
  assumedOutputTokens: number;
  maxOutputTokens: number;
  expectedCostUsd: number;
  maxCostUsd: number;
};

export type Estimate = {
  rows: EstimateRow[];
  totals: { calls: number; inputTokens: number; expectedOutputTokens: number; expectedCostUsd: number; maxCostUsd: number };
};

export async function countInputTokens(client: Anthropic, p: CapturedParams): Promise<number> {
  const base = { model: p.model, system: p.system as never, messages: p.messages as never };
  try {
    return (await client.beta.messages.countTokens({ ...base, output_config: p.output_config as never })).input_tokens;
  } catch (e) {
    // 出力形式(JSON スキーマ)つきの計測を受け付けないときは、スキーマを除いて数える(スキーマ分だけ少なめになる)
    if (!(e instanceof Error) || !/400|invalid_request/i.test(`${(e as { status?: number }).status ?? ""} ${e.message}`)) throw e;
    return (await client.beta.messages.countTokens(base)).input_tokens;
  }
}

/** count_tokens は同時に多く投げすぎないよう、4件ずつ数える */
export async function buildEstimate(client: Anthropic, planned: PlannedCall[]): Promise<Estimate> {
  const rows = await mapLimit(planned, 4, async (c): Promise<EstimateRow> => {
    const inputTokens = (await countInputTokens(client, c.params)) + (c.extraInputTokens ?? 0);
    const { price } = priceFor(c.params.model);
    const cost = (out: number) => ((inputTokens * price.input + out * price.output) / 1_000_000) * c.times;
    return {
      caseId: c.caseId,
      step: c.step,
      model: c.params.model,
      times: c.times,
      inputTokens,
      assumedOutputTokens: c.assumedOutputTokens,
      maxOutputTokens: c.params.max_tokens,
      expectedCostUsd: cost(c.assumedOutputTokens),
      maxCostUsd: cost(c.params.max_tokens),
    };
  });
  const sum = (f: (r: EstimateRow) => number) => rows.reduce((s, r) => s + f(r), 0);
  return {
    rows,
    totals: {
      calls: sum((r) => r.times),
      inputTokens: sum((r) => r.inputTokens * r.times),
      expectedOutputTokens: sum((r) => r.assumedOutputTokens * r.times),
      expectedCostUsd: sum((r) => r.expectedCostUsd),
      maxCostUsd: sum((r) => r.maxCostUsd),
    },
  };
}

export function formatEstimate(est: Estimate, opts: { note?: string } = {}): string {
  const jpy = usdJpy();
  const lines = [
    "【実行前の費用見積もり】(API は呼んでいません。入力は count_tokens で計測)",
    "",
    "| 対象 | 呼び出し | 回数 | 入力(実測) | 出力(想定) | 概算費用 |",
    "|---|---|---|---|---|---|",
    ...est.rows.map(
      (r) =>
        `| ${r.caseId} | ${r.step} | ${r.times} | ${r.inputTokens.toLocaleString("ja-JP")} | ${r.assumedOutputTokens.toLocaleString("ja-JP")} | ${usd(r.expectedCostUsd)} |`,
    ),
    "",
    `合計: API 呼び出し ${est.totals.calls} 回 / 入力 ${est.totals.inputTokens.toLocaleString("ja-JP")} トークン / 出力(想定) ${est.totals.expectedOutputTokens.toLocaleString("ja-JP")} トークン`,
    `概算費用: ${usd(est.totals.expectedCostUsd, 2)}(約 ${Math.round(est.totals.expectedCostUsd * jpy).toLocaleString("ja-JP")} 円、${jpy} 円/ドル)`,
    `上限の目安: ${usd(est.totals.maxCostUsd, 2)}(すべての呼び出しが max_tokens いっぱいまで出力した場合)`,
    "",
    "注意: 出力トークンは想定値です(思考トークンを含み、実際は上下します)。キャッシュの割引・書き込み、再試行、フォールバックは含めていません。",
    "まず --limit 1 で1件だけ実行し、実測の usage から見積もりを確かめてください。",
  ];
  if (opts.note) lines.push(opts.note);
  return lines.join("\n");
}


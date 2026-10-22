import { parseArgs } from "node:util";

// 評価スクリプト共通のコマンドライン。実 API を呼ぶ前に、必ずキーの有無と確認(--yes)を見る。

export function hasApiKey(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

export const NO_KEY_MESSAGE = `ANTHROPIC_API_KEY(または ANTHROPIC_AUTH_TOKEN)が設定されていないので、評価を実行しません。
この評価は実際の Claude API を呼びます(費用がかかります)。キーを設定してから、もう一度実行してください。
  1. export ANTHROPIC_API_KEY=sk-ant-...
  2. 先に --yes なしで実行すると、API を呼ばずに概算の費用だけを表示します(トークン数の計測 count_tokens は無料)
  3. 費用に納得したら --yes を付けて実行します
CI では実行しません(評価は手元で、キーのある環境でだけ実行します)。`;

export type CommonOptions = {
  yes: boolean;
  help: boolean;
  limit: number | null;
  only: string[] | null;
  reps: number;
  concurrency: number;
  noJudge: boolean;
  judgeModel: string | null;
  judgeSelftest: boolean;
  out: string | null;
};

const OPTIONS = {
  yes: { type: "boolean", short: "y" },
  help: { type: "boolean", short: "h" },
  limit: { type: "string" },
  only: { type: "string" },
  reps: { type: "string" },
  concurrency: { type: "string" },
  "no-judge": { type: "boolean" },
  "judge-model": { type: "string" },
  "judge-selftest": { type: "boolean" },
  out: { type: "string" },
} as const;

function positiveInt(name: string, value: string | undefined, fallback: number | null): number | null {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new Error(`--${name} には1以上の整数を指定してください(指定: ${value})`);
  return n;
}

export function parseCommonOptions(argv: string[]): CommonOptions {
  const { values } = parseArgs({ args: argv, options: OPTIONS, strict: true, allowPositionals: false });
  return {
    yes: values.yes ?? false,
    help: values.help ?? false,
    limit: positiveInt("limit", values.limit, null),
    only: values.only ? values.only.split(",").map((s) => s.trim()).filter(Boolean) : null,
    reps: positiveInt("reps", values.reps, 1) ?? 1,
    // 1本の中で map を3並列にするので、サンプル間の並列は既定 1
    concurrency: positiveInt("concurrency", values.concurrency, 1) ?? 1,
    noJudge: values["no-judge"] ?? false,
    judgeModel: values["judge-model"] ?? null,
    judgeSelftest: values["judge-selftest"] ?? false,
    out: values.out ?? null,
  };
}

/** --only と --limit で件を絞る(id の順は元のまま) */
export function selectCases<T extends { id: string }>(cases: T[], o: Pick<CommonOptions, "only" | "limit">): T[] {
  let selected = cases;
  if (o.only) {
    const unknown = o.only.filter((id) => !cases.some((c) => c.id === id));
    if (unknown.length > 0) throw new Error(`--only に存在しない id があります: ${unknown.join(", ")}(使える id: ${cases.map((c) => c.id).join(", ")})`);
    selected = cases.filter((c) => o.only!.includes(c.id));
  }
  return o.limit ? selected.slice(0, o.limit) : selected;
}

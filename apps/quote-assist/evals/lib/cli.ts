import { parseArgs } from "node:util";

// 評価スクリプトのコマンドライン。実 API を呼ぶ前に、必ずキーの有無と確認(--yes)を見る。

export function hasApiKey(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

export const NO_KEY_MESSAGE = `ANTHROPIC_API_KEY(または ANTHROPIC_AUTH_TOKEN)が設定されていないので、評価を実行しません。
この評価は実際の Claude API を呼びます(費用がかかります)。キーを設定してから、もう一度実行してください。
  1. export ANTHROPIC_API_KEY=sk-ant-...
  2. 先に --yes なしで実行すると、API を呼ばずに概算の費用だけを表示します(トークン数の計測 count_tokens は無料)
  3. 費用に納得したら --yes を付けて実行します
APIキーなしで評価の仕組みだけを確かめるときは --demo(デモ用の固定結果。精度は100%になる)。
CI では実行しません(評価は手元で、キーのある環境でだけ実行します)。`;

export type QuoteOptions = {
  yes: boolean;
  help: boolean;
  demo: boolean;
  data: string | null;
  exportDemo: string | null;
  withEstimate: boolean;
  limit: number | null;
  only: string[] | null;
  concurrency: number;
  out: string | null;
};

const OPTIONS = {
  yes: { type: "boolean", short: "y" },
  help: { type: "boolean", short: "h" },
  demo: { type: "boolean" },
  data: { type: "string" },
  "export-demo": { type: "string" },
  "with-estimate": { type: "boolean" },
  limit: { type: "string" },
  only: { type: "string" },
  concurrency: { type: "string" },
  out: { type: "string" },
} as const;

function positiveInt(name: string, value: string | undefined, fallback: number | null): number | null {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new Error(`--${name} には1以上の整数を指定してください(指定: ${value})`);
  return n;
}

export function parseQuoteOptions(argv: string[]): QuoteOptions {
  const { values } = parseArgs({ args: argv, options: OPTIONS, strict: true, allowPositionals: false });
  return {
    yes: values.yes ?? false,
    help: values.help ?? false,
    demo: values.demo ?? false,
    data: values.data ?? null,
    exportDemo: values["export-demo"] ?? null,
    withEstimate: values["with-estimate"] ?? false,
    limit: positiveInt("limit", values.limit, null),
    only: values.only ? values.only.split(",").map((s) => s.trim()).filter(Boolean) : null,
    concurrency: positiveInt("concurrency", values.concurrency, 3) ?? 3,
    out: values.out ?? null,
  };
}

/** --only と --limit で件を絞る(id の順は元のまま) */
export function selectCases<T extends { id: string }>(cases: T[], o: Pick<QuoteOptions, "only" | "limit">): T[] {
  let selected = cases;
  if (o.only) {
    const unknown = o.only.filter((id) => !cases.some((c) => c.id === id));
    if (unknown.length > 0) throw new Error(`--only に存在しない id があります: ${unknown.join(", ")}(使える id: ${cases.map((c) => c.id).join(", ")})`);
    selected = cases.filter((c) => o.only!.includes(c.id));
  }
  return o.limit ? selected.slice(0, o.limit) : selected;
}

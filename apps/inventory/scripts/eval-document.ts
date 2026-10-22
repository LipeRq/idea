// 仕様書(Excel/VBA・Access の棚卸し)の評価: npm run eval:document
// 実際の Claude API で、samples/ の架空のマクロ付きブック(と、AIへの指示を書き込んだ1本)の仕様書の文章を生成し、
// 検証成功率・規則による採点・LLM採点・API 呼び出し回数・費用と時間を測る。
//   npm run eval:document                    # 費用の見積もりだけ(API は呼ばない。キーが必要)
//   npm run eval:document -- --yes           # 実行する(費用がかかる)
//   npm run eval:document -- --yes --limit 1 # まず1本だけ
// 詳しくは docs/evals.md。CI では実行しない。
import Anthropic from "@anthropic-ai/sdk";
import { hasApiKey, NO_KEY_MESSAGE, parseCommonOptions } from "../evals/lib/cli";
import { runInventoryEval, runJudgeSelftest } from "../evals/run";

const HELP = `使い方: npm run eval:document -- [オプション]
  --yes            確認なしで実 API を呼ぶ(付けないと、概算費用を表示して終了)
  --limit N        先頭から N 本だけ
  --only a,b       id を指定した本だけ(juchu, getsuji, zaiko, mitsumori, juchu-injection)
  --reps N         同じ入力を N 回ずつ(既定 1。ばらつきを見るとき)
  --concurrency N  同時に動かすサンプル数(既定 1。1本の中で map を3並列で動かすため)
  --no-judge       LLM 採点をしない(規則による採点だけ)
  --judge-model M  採点モデル(既定 claude-opus-5-5)
  --judge-selftest 採点者の自己点検(空・的外れな文章に pass を付けないか)だけを行う
  --out DIR        結果の保存先(既定 evals/results)`;

async function main() {
  const options = parseCommonOptions(process.argv.slice(2));
  if (options.help) return console.log(HELP);
  if (!hasApiKey()) return console.log(NO_KEY_MESSAGE);
  const env = { options, client: new Anthropic(), log: (line: string) => console.log(line) };
  if (options.judgeSelftest) {
    const { ok } = await runJudgeSelftest(env);
    if (!ok) process.exitCode = 1;
    return;
  }
  await runInventoryEval(env);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

// 診断レポート(AI の文章)の評価: npm run eval:report
// 実際の Claude API で、代表的な入力(evals/cases.ts)のレポートを生成し、構造化出力の検証・規則による採点・LLM採点・費用と時間を測る。
//   npm run eval:report                    # 費用の見積もりだけ(API は呼ばない。キーが必要)
//   npm run eval:report -- --yes           # 実行する(費用がかかる)
//   npm run eval:report -- --yes --limit 1 # まず1件だけ
// 詳しくは docs/evals.md。CI では実行しない。
import Anthropic from "@anthropic-ai/sdk";
import { hasApiKey, NO_KEY_MESSAGE, parseCommonOptions } from "../evals/lib/cli";
import { runDiagnosisEval, runJudgeSelftest } from "../evals/run";

const HELP = `使い方: npm run eval:report -- [オプション]
  --yes            確認なしで実 API を呼ぶ(付けないと、概算費用を表示して終了)
  --limit N        先頭から N 件だけ
  --only a,b       id を指定した件だけ(evals/cases.ts)
  --reps N         同じ入力を N 回ずつ(既定 1。ばらつきを見るとき)
  --concurrency N  同時に動かす件数(既定 3)
  --no-judge       LLM 採点をしない(規則による採点だけ。費用が約3割減る)
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
  await runDiagnosisEval(env);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

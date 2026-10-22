// 抽出精度・確認事項・類似検索・処理時間・API費用の評価: npm run eval
// 実際の Claude API で、引き合い(図面PDF+メール)を読み取り、正解ラベルと照合する。
//   npm run eval                                    # デモ用の3件。費用の見積もりだけ(API は呼ばない。キーが必要)
//   npm run eval -- --yes                           # 実行する(費用がかかる)
//   npm run eval -- --data ./poc-data --yes         # PoC: お客様のデータ(cases.csv + drawings/ + emails/)を評価する
//   npm run eval -- --demo                          # デモ用の固定結果で、評価の仕組みだけを確かめる(API を呼ばない。精度は100%)
//   npm run eval -- --export-demo ./poc-sample      # デモ用の3件を、PoC のデータの形式で書き出す(形式の見本)
// 詳しくは docs/evals.md と README の「評価」。CI では実行しない。
import Anthropic from "@anthropic-ai/sdk";
import { hasApiKey, NO_KEY_MESSAGE, parseQuoteOptions } from "../evals/lib/cli";
import { PocDataError } from "../evals/poc-data";
import { runQuoteEval } from "../evals/run";

const HELP = `使い方: npm run eval -- [オプション]
  --yes             確認なしで実 API を呼ぶ(付けないと、概算費用を表示して終了)
  --data DIR        PoC のデータ(DIR/cases.csv、DIR/drawings/*.pdf、DIR/emails/*.txt)を評価する。省略時はデモ用の3件
  --with-estimate   工数案(類似案件のAIによる並べ替え)も実行し、画面に出る上位5件で類似検索を評価する(費用が増える)
  --limit N         先頭から N 件だけ
  --only a,b        id を指定した件だけ
  --concurrency N   同時に動かす件数(既定 3)
  --demo            API を呼ばず、デモ用の固定結果で評価の仕組みを確かめる(精度は100%になる)
  --export-demo DIR デモ用の3件を PoC のデータの形式で DIR に書き出す
  --out DIR         結果の保存先(既定 evals/results)`;

async function main() {
  const options = parseQuoteOptions(process.argv.slice(2));
  if (options.help) return console.log(HELP);
  // 書き出しと --demo は API を使わない。それ以外はキーが無ければ案内して終了する
  if (!options.demo && !options.exportDemo && !hasApiKey()) return console.log(NO_KEY_MESSAGE);
  await runQuoteEval({ options, client: options.demo || options.exportDemo ? null : new Anthropic(), log: (line) => console.log(line) });
}

main().catch((error) => {
  console.error(error instanceof PocDataError ? `データの読み込みに失敗しました。\n${error.message}` : error instanceof Error ? error.message : error);
  process.exit(1);
});

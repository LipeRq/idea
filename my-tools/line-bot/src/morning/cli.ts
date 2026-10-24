// 毎朝の情報まとめを実行するコマンド。GitHub Actions の定期実行から呼ぶ。
//
//   npm run morning                 集めて、要約して、LINE に送る
//   npm run morning -- --dry-run    送らずに、送る内容を表示する(LINE の設定がなくても動く)
//
// 環境変数:DEEPSEEK_API_KEY(なければ見出しだけ)、LINE_CHANNEL_ACCESS_TOKEN・LINE_USER_ID(送るとき)
//   npm run morning -- --hours 48   何時間前までの記事を使うか(既定 24)
//   npm run sources:check           情報源ごとに取得できるかを確認する(取得できないものがあれば終了コード 1)
import { createDeepSeekClient } from "../ai";
import { createLineApi, pushWithRetry } from "../line/api";
import { formatJstDateTime } from "../time";
import { fetchFeed } from "./feed";
import { runMorningDigest } from "./run";
import { CATEGORIES, SOURCES } from "./sources";

interface Args {
  dryRun: boolean;
  checkSources: boolean;
  hours: number;
}

function parseArgs(argv: readonly string[]): Args {
  const args: Args = { dryRun: false, checkSources: false, hours: 24 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") args.dryRun = true;
    else if (a === "--check-sources") args.checkSources = true;
    else if (a === "--hours") {
      const n = Number(argv[++i]);
      if (!Number.isInteger(n) || n < 1 || n > 168) throw new Error("--hours は 1〜168 の整数で指定してください");
      args.hours = n;
    } else throw new Error(`知らないオプションです:${a}`);
  }
  return args;
}

async function checkSources(): Promise<number> {
  let failures = 0;
  for (const source of SOURCES) {
    try {
      const feed = await fetchFeed(source.url);
      const dated = feed.items.filter((i) => i.publishedAt !== null);
      const newest = dated.reduce<Date | null>((max, i) => (max && max > i.publishedAt! ? max : i.publishedAt), null);
      const described = feed.items.filter((i) => i.description.length > 0).length;
      console.log(
        `OK  ${source.name}:${feed.items.length}件(日付あり ${dated.length}・概要あり ${described})` +
          ` 最新 ${newest ? formatJstDateTime(newest) : "なし"}「${feed.title ?? "題名なし"}」`,
      );
      if (dated.length === 0) console.log("    注意:日付のある記事がないので、まとめには使われません");
    } catch (e) {
      failures++;
      console.log(`NG  ${source.name}:${e instanceof Error ? e.message : "取得できませんでした"}(${source.url})`);
    }
  }
  console.log(`\n${SOURCES.length - failures}/${SOURCES.length} 件の情報源を取得できました`);
  return failures === 0 ? 0 : 1;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (args.checkSources) return checkSources();

  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const userId = process.env.LINE_USER_ID;
  if (!args.dryRun && (!token || !userId)) {
    console.error("LINE_CHANNEL_ACCESS_TOKEN と LINE_USER_ID を設定してください(送らずに試すなら --dry-run)");
    return 2;
  }

  const apiKey = process.env.DEEPSEEK_API_KEY;
  const ai = apiKey
    ? createDeepSeekClient(apiKey, {
        onUsage: (u) => console.log(`AI の使用量:入力 ${u.inputTokens} トークン・出力 ${u.outputTokens} トークン`),
      })
    : null;
  const line = token ? createLineApi(token) : null;

  const result = await runMorningDigest(
    {
      sources: SOURCES,
      categories: CATEGORIES,
      fetchFeed: (url) => fetchFeed(url),
      ai,
      aiUnavailableReason: "DeepSeek API のキーが未設定です",
      send: args.dryRun || !line || !userId ? null : (messages) => pushWithRetry(line, userId, messages),
      now: () => new Date(),
      log: (m) => console.log(m),
    },
    args.hours,
  );

  if (args.dryRun) {
    // 試し実行のときだけ、送る内容を表示する(ニュースの見出しと要約なので、ログに出してよい)
    console.log("\n--- 送る内容(試し実行のため送っていません) ---");
    result.messages.forEach((m, i) => console.log(`\n[吹き出し ${i + 1}]\n${m.text}`));
  }
  return 0;
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  },
);

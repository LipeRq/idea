// コマンドライン: npx tsx src/cli.ts analyze <file> --out report.json
import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { analyzeFile } from "./analyzeFile";
import { InventoryError } from "./errors";
import { createClaudeClient, hasAnthropicCredentials, MODEL } from "./doc/ai";
import { aiDocumentToJson, generateDocument } from "./doc/document";
import { InventoryReportSchema, SEVERITY_LABEL, type InventoryReport } from "./schema";

/** AI による文章生成全体の時間の上限(CLI)。超えたら標準レポートに切り替える */
const CLI_AI_TIMEOUT_MS = 30 * 60_000;

const HELP = `Excel/VBA・Access の棚卸しツール

使い方:
  npx tsx src/cli.ts analyze <ファイル> [--out report.json] [--no-source] [--password <パスワード>]
      ファイルを解析して、抽出結果(InventoryReport)を JSON で出力します。AI は使いません。

  npx tsx src/cli.ts document <ファイル または report.json> [--out spec.md] [--json report.json]
                              [--ai-json ai.json] [--no-ai] [--password <パスワード>]
      仕様書(Markdown)を出力します。

オプション:
  --out <パス>       出力先(省略時は標準出力)
  --no-source        JSON にソースコードを含めない
  --password <値>    Access データベースのパスワード
  --json <パス>      document で、抽出結果の JSON も保存する
  --ai-json <パス>   document で、AI が書いた文章を JSON でも保存する
  --no-ai            AI を使わず、抽出結果だけで標準レポートを作る
  -h, --help         このヘルプを表示する

対応形式: .xlsm .xlam .xlsx .xltm .xlsb .xls .accdb .mdb

AI と機密情報について:
  document は環境変数 ANTHROPIC_API_KEY(または ANTHROPIC_AUTH_TOKEN)があると、
  Claude(${MODEL})で概要・業務フロー・リスク評価・移行提案の文章を生成します。
  その際、VBA のソースコード・クエリの SQL・シート名・数式の例などが Anthropic 社の API に送信されます。
  セルの値(データ本体)と作成者名は送信しません。接続文字列やコードに書かれたパスワードは伏せ字にしてから送信します。
  顧客の許可を得たファイルでのみ使ってください。送信したくない場合は --no-ai を指定してください。
  API キーが無い場合は、自動的に AI なしの標準レポートになります。
`;

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      out: { type: "string" },
      json: { type: "string" },
      "ai-json": { type: "string" },
      password: { type: "string" },
      "no-source": { type: "boolean", default: false },
      "no-ai": { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  const [command, input] = positionals;
  if (values.help || !command) {
    process.stdout.write(HELP);
    return values.help ? 0 : 2;
  }
  if (!input || (command !== "analyze" && command !== "document")) {
    process.stderr.write(`引数が正しくありません。\n\n${HELP}`);
    return 2;
  }

  const log = (msg: string) => process.stderr.write(`${msg}\n`);
  const write = async (path: string | undefined, content: string) => {
    if (path) await writeFile(path, content, "utf8");
    else process.stdout.write(content);
  };

  let report: InventoryReport;
  if (command === "document" && input.toLowerCase().endsWith(".json")) {
    report = InventoryReportSchema.parse(JSON.parse(await readFile(input, "utf8")));
  } else {
    log(`解析中: ${input}`);
    report = await analyzeFile(input, { includeSource: !values["no-source"], password: values.password });
    log(summary(report));
  }

  if (command === "analyze") {
    await write(values.out, `${JSON.stringify(report, null, 2)}\n`);
    if (values.out) log(`抽出結果を保存しました: ${values.out}`);
    return 0;
  }

  if (values.json) {
    await writeFile(values.json, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    log(`抽出結果を保存しました: ${values.json}`);
  }
  const useAi = !values["no-ai"] && hasAnthropicCredentials();
  if (useAi) {
    log(`注意: 解析内容(VBAのソースコード・SQL等)を Anthropic の API(${MODEL})に送信して文章を生成します。送信しない場合は --no-ai を指定してください。`);
  } else if (!values["no-ai"]) {
    log("ANTHROPIC_API_KEY が設定されていないため、AIを使わない標準レポートを作成します。");
  }
  // 全体の上限。1回の依頼の上限(DEFAULT_REQUEST_TIMEOUT_MS)とは別に、大きいファイルで依頼が続いても止まるようにする
  const client = useAi ? createClaudeClient(undefined, { signal: AbortSignal.timeout(CLI_AI_TIMEOUT_MS) }) : null;
  const result = await generateDocument(report, client, { onProgress: log });
  if (result.aiError) log(`AIによる文章生成に失敗したため、標準レポートを出力します: ${result.aiError}`);
  await write(values.out, result.markdown);
  if (values.out) log(`仕様書を保存しました: ${values.out}`);
  if (values["ai-json"] && result.ai) {
    await writeFile(values["ai-json"], `${JSON.stringify(aiDocumentToJson(result.ai), null, 2)}\n`, "utf8");
  }
  return 0;
}

function summary(r: InventoryReport): string {
  const s = r.stats;
  const sev = (k: keyof typeof SEVERITY_LABEL) => r.findings.filter((f) => f.severity === k).length;
  return [
    `形式: ${r.file.format} / シート ${s.sheetCount} / 数式 ${s.formulaCount} / モジュール ${s.moduleCount} / プロシージャ ${s.procedureCount} / コード ${s.codeLineCount}行`,
    `テーブル ${s.tableCount} / クエリ ${s.queryCount} / 外部依存 ${s.dependencyCount} / リスク 高${sev("high")}・中${sev("medium")}・低${sev("low")}`,
    ...r.warnings.map((w) => `警告: ${w}`),
  ].join("\n");
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (e) => {
    if (e instanceof InventoryError) process.stderr.write(`${e.message}\n`);
    else if (e instanceof Error && "code" in e && e.code === "ENOENT") process.stderr.write(`ファイルが見つかりません: ${(e as NodeJS.ErrnoException).path}\n`);
    else process.stderr.write(`エラー: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
  },
);

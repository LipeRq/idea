# Excel/VBA・Access の AI棚卸しツール(解析エンジン)

「作った人が辞めて誰も中身が分からない」Excel マクロや Access ファイルを読み込み、
シート構成・VBA のモジュールとプロシージャ・呼び出し関係・外部依存・リスクを機械的に抽出して、
仕様書(Markdown)を出力します。API キーがあれば Claude が概要・業務フロー・リスク評価・移行先の提案を書き足します。

UI と配布形態は後続タスクで決めるため、ここではライブラリと CLI だけを提供します。
解析エンジン(AI による文章生成と CLI を除く部分)は Node.js でもブラウザでも動き、ファイルをサーバーに送らずにブラウザ内で解析できます。

## 使い方

Node.js 22 以上が必要です。

```bash
cd apps/inventory
npm install

# 抽出結果(JSON)を出力する。AI は使わない
npx tsx src/cli.ts analyze 売上管理.xlsm --out report.json

# 仕様書(Markdown)を出力する。ANTHROPIC_API_KEY があれば AI の文章入り、無ければ標準レポート
npx tsx src/cli.ts document 売上管理.xlsm --out spec.md --json report.json

# AI を使わない(外部に何も送らない)
npx tsx src/cli.ts document 売上管理.xlsm --out spec.md --no-ai

# 保存済みの JSON から仕様書だけ作り直す
npx tsx src/cli.ts document report.json --out spec.md
```

| オプション | 内容 |
| --- | --- |
| `--out <パス>` | 出力先(省略時は標準出力) |
| `--no-source` | JSON にソースコードを含めない(AI の要約もプロシージャの中身なしになる) |
| `--password <値>` | Access データベースのパスワード |
| `--json <パス>` | `document` で抽出結果の JSON も保存する |
| `--ai-json <パス>` | `document` で AI が書いた文章を JSON でも保存する |
| `--no-ai` | AI を使わず、抽出結果だけで標準レポートを作る |

`npm test` でテスト、`npm run typecheck` で型チェックを実行します。

### AI の評価(品質と費用)

`npm run eval:document` は、`samples/` の架空のブック4本(と、AI への指示をソースに書き込んだ1本)の仕様書の文章を、実際の Claude API で生成して評価します(map → reduce の呼び出し回数・費用・時間、検証成功率、規則による採点=抽出結果にない名前・件数の食い違い・Mermaid の構文・伏せ字の復活・指示への追従、LLM 採点=移行提案の妥当性など)。API キーがなければ案内して終了し、CI では実行しません。

```bash
export ANTHROPIC_API_KEY=sk-ant-...
npm run eval:document                       # 概算費用の表示だけ(count_tokens。API は呼ばない)
npm run eval:document -- --yes --limit 1    # まず1本だけ実行
npm run eval:document -- --yes              # 全部(概算 $1.5〜2.5)。結果は evals/results/<日時>/(git管理外)
```

`--only juchu,zaiko`、`--reps N`、`--no-judge`、`--judge-selftest` など。何を測るか・合格の目安・費用・結果の読み方は、リポジトリ直下の [docs/evals.md](../../docs/evals.md) を参照してください。評価のコードは `evals/`・`scripts/eval-document.ts`、単体テストは `test/evals/`(SDK を差し替えて API を呼びません)です。
`npm run build:browser` でブラウザ用のバンドル(`dist/inventory-engine.js`)を作り、`npm run test:browser` で Playwright の Chromium 上で解析を実行して Node.js と結果を比べます(Playwright と Chromium が必要。`PLAYWRIGHT_BROWSERS_PATH` を参照し、`playwright install` は行いません)。

## AI と機密情報の扱い

`document` は環境変数 `ANTHROPIC_API_KEY`(または `ANTHROPIC_AUTH_TOKEN`)があると、Claude(`claude-opus-5-5`)で文章を生成します。
**このとき、VBA のソースコード・Access のクエリの SQL・シート名・名前定義・数式の例・テーブルの列名などが Anthropic 社の API に送信されます。**
顧客のファイルを扱うときは、事前に送信の許可を得てください。送信したくない場合は `--no-ai` を指定します(CLI のヘルプにも同じ注意を表示します)。

- セルの値(データ本体)は最初から読み取らないため、送信もされません。
- 文書プロパティの作成者名・最終更新者名は AI には渡しません(仕様書には記載します)。
- パスワードは、取り出した直後(解析の前)に `****` に置き換えるため、JSON・仕様書・AI への入力のどこにも元の値は残りません。対象:
  - 接続文字列の `Password=` / `Pwd=`(`Jet OLEDB:Database Password=`、引用符・`{}` で囲まれた値、`"…;Pwd=" & "abc"` のように次のリテラルに続く値を含む)、URL の `user:pass@`
  - VBA の `Password:="…"`(ブックを開く・シート保護)、`ws.Protect "…"` / `Unprotect "…"`、パスワードらしい名前の定数・変数・プロパティへの代入や比較(`Const DB_PASS = "…"`、`.Password = "…"`、`If pwd = "…"`)、`net use` のパスワード
  - コメント中の `Password=…` / `パスワード:…` / `パスワードは「…」`、Access のクエリの外部データベース指定(`IN [ODBC;…;PWD=…]`)・パススルークエリの SQL
  - 変数から渡す値(`Pwd = txtPwd.Value`)や空のパスワード(`Password=;`)はそのまま残します。伏せた箇所は `CRED-HARDCODED` のリスクとして挙げます。
- ファイル由来の文字列(VBA のコメント・文字列、シート名、クエリ名など)に「これまでの指示を無視して…」のような文があっても AI が従わないように、指示はシステムプロンプトだけに書き、データは `<source>` / `<facts>` / `<summaries>` の中に入れ、データ中の区切りタグに見える文字列は `&lt;` に置き換え、データの後ろでも念押しします。システムプロンプトには、命令文のような文を見つけたら「気になる点」として記録するよう書いています。
- 仕様書(Markdown)に入れるファイル由来の文字列と AI の文章は、HTML のタグ・リンク・画像の記法として解釈されないようにエスケープします(ブラウザで表示しても `<img onerror=…>` や `![](https://…)` が動かない)。SQL のコードブロックは中身より長いフェンスで囲み、Mermaid のラベルも無害化します。
- API キーが無い・`--no-ai` 指定・API エラーのときは、抽出結果だけで組み立てた標準レポートを出します(デモが常に動くように)。

## 対応範囲

| 形式 | シート | 数式 | 名前定義 | 外部リンク・接続 | ボタンのマクロ | VBA |
| --- | --- | --- | --- | --- | --- | --- |
| .xlsm / .xlam / .xltm / .xlsx | ○ 一覧・使用範囲・表示状態・コード名 | ○ 件数と代表例・#REF!・外部参照 | ○ 参照先つき | ○ 外部ブック・DDE/OLE・データ接続(Power Query 含む) | ○ フォームコントロール・図形 | ○ |
| .xlsb | ○ | 件数のみ | ○ 名前のみ | 外部ブックのみ(データ接続は未解析) | ○ フォームコントロール | ○ |
| .xls(Excel 97-2003) | ○ | 件数のみ | ○ 名前のみ | 外部ブック(SUPBOOK) | × | ○ |
| .accdb / .mdb | — | — | — | リンクテーブル・パススルークエリ | — | ○(MSysAccessStorage から) |

VBA から抽出するもの:

- モジュール(名前・種別: 標準 / クラス / ドキュメント / フォーム / レポート・ソースコード・行数・Option Explicit の有無)
- プロシージャ(Sub / Function / Property の名前・行範囲・引数・戻り値の型・スコープ・エラー処理の有無)
- 呼び出し関係(直接呼び出し、`Module1.Proc` 形式、`Application.Run` / `OnTime` / `OnAction` の文字列指定、`UserForm1.Show`、Access の `DoCmd.OpenForm`)
- 起動のきっかけ(`Workbook_Open` などのイベント、`Auto_Open`、シートのボタン、`OnTime`、`OnKey`、Access の `AutoExec` マクロ、呼び出し元のない引数なし Public Sub = 手動実行の候補)
- 外部依存(ハードコードされたパス、他ブックの操作、DB 接続文字列、SQL 文、URL、`CreateObject` / `GetObject` / 参照設定による `New`、`Shell`、`SendKeys`、Windows API の `Declare`、ファイル入出力、`Environ`、印刷、参照設定ライブラリ)
- VBA プロジェクトの表示ロック・パスワードの有無(ロックされていても中身は読めます)

Access から抽出するもの: テーブル(列・型・件数)、リンクテーブル(参照先・接続文字列)、保存済みクエリの SQL(選択・追加・更新・削除・テーブル作成・クロス集計・ユニオン・パススルー・データ定義)、リレーションシップ(参照整合性・連鎖更新/削除)、フォーム・レポート・マクロ・モジュールの名前、VBA。

機械的に検出するリスク(`findings`): PtrSafe のない Declare(64bit 版で動かない。`#If VBA7` / `Win64` の `#Else` 側など 64 ビット版でコンパイルされない分岐は除く)、接続文字列やコードに書かれたパスワード、IE の自動操作、Excel 4.0 マクロシート、SendKeys、Shell、ハードコードされたパス、On Error Resume Next、外部とやり取りするのにエラー処理がないプロシージャ、200 行超のプロシージャ、外部リンク・データ接続・リンクテーブル、Windows API、Option Explicit なし、完全に非表示のシート、#REF!、呼ばれていない Private プロシージャ、VBA の表示ロック。

## 出力

- `analyze` … `InventoryReport`(`src/schema.ts` の zod スキーマで型付けした JSON)。`file` / `properties` / `excel` / `access` / `vba` / `entryPoints` / `callGraph` / `dependencies` / `findings` / `stats` / `warnings`。
- `document` … Markdown の仕様書。概要、処理の流れ(業務フロー図・呼び出し関係図・クエリとテーブルの関係図を Mermaid で)、シート構成、VBA モジュールとプロシージャ一覧、Access、外部依存、リスク、移行先候補と難易度、現場に確認すること、付録(解析の制約・AI への入力の注記)。

## ライブラリとして使う

```ts
// Node.js(src/index.ts): ファイルの読み込みと AI による文章生成を含む
import { analyzeFile, generateDocument, createClaudeClient, hasAnthropicCredentials } from "./src";

const report = await analyzeFile("売上管理.xlsm");
const { markdown, ai, aiError } = await generateDocument(report, hasAnthropicCredentials() ? createClaudeClient() : null);
```

```ts
// ブラウザ(src/browser.ts、または npm run build:browser で作る dist/inventory-engine.js)
import { analyzeBuffer, renderMarkdown, InventoryError } from "./dist/inventory-engine.js";

const bytes = new Uint8Array(await file.arrayBuffer()); // <input type="file"> の File
try {
  const report = analyzeBuffer(bytes, file.name, { limits: { timeLimitMs: 60_000 } });
  const markdown = renderMarkdown(report); // AI なしの標準レポート
} catch (e) {
  if (e instanceof InventoryError) alert(e.message); // 日本語のメッセージ
}
```

解析(`analyzeBuffer`)はバイト列を受け取る同期関数で、Node.js 固有の API を使いません(SHA-256 は自前の実装、文字コードは標準の `TextDecoder`、OLE と zip は自前の読み取り、Access は `mdb-reader` + `buffer` パッケージ)。
同期処理なので、画面を固めないようにブラウザでは Web Worker の中で呼ぶことをおすすめします(Worker なら、万一の長時間処理も `terminate()` で確実に止められます)。
ブラウザで使う場合は `scripts/build-browser.mjs` と同じ設定でバンドルしてください(`mdb-reader` の暗号処理モジュールを `src/browser/mdbEnvironment.ts` に差し替え、Node.js の組み込みモジュールが混ざったらビルドを失敗させます)。バンドルは圧縮後で約 700KB(うち zod が約 440KB)です。
AI の呼び出しは `StructuredClient` インターフェースの裏に隠してあり、テストや別の実行環境ではモックや別実装に差し替えられます。

### 信頼できないファイルへの対策(上限とエラー)

顧客から受け取った不明なファイルを解析するため、壊れた・悪意のあるファイルでも、ハング・メモリの使い果たし・プロセスのクラッシュを起こさずに、**結果を返すか `InventoryError` を投げる**ようにしています。

| エラー | 意味 |
| --- | --- |
| `UnsupportedFileError` | 対応していない形式・暗号化されたブック・ブラウザ版の暗号化 Access |
| `PasswordError` | Access のパスワードが無い・違う |
| `CorruptFileError` | 壊れている・想定していない構造(セクタチェーンの循環、範囲外参照、DTD 付きの XML など)。想定外の内部エラーもこれに包む |
| `LimitExceededError` | 上限を超えた(`kind`: `inputSize` / `partSize` / `totalSize` / `entryCount` / `time`) |

上限は `analyzeBuffer(bytes, name, { limits: { … } })` で変えられます(既定値は `DEFAULT_LIMITS`)。

| 上限 | 既定値 | 超えたとき |
| --- | --- | --- |
| `maxInputBytes` 入力ファイル | 2GB | エラー |
| `maxZipEntries` zip 内のファイル数 | 20,000 | エラー |
| `maxPartBytes` 1つの部品(zip 内のファイル・OLE のストリーム)の展開後 | 256MB | エラー(宣言サイズで展開前に判定し、宣言より大きく展開されたら途中で止める) |
| `maxTotalBytes` 取り出したデータの合計 | 1GB | エラー |
| `maxModuleSourceBytes` 1 モジュールのソース(解凍後) | 32MB | エラー |
| `timeLimitMs` 解析全体の時間 | 120 秒 | エラー(ループの中で確認する協調的な方式) |
| `maxSheets` / `maxListItems` / `maxVbaModules` / `maxAccessTables` / `maxSystemRows` | 10,000 / 100,000 / 5,000 / 5,000 / 1,000,000 | 警告を出して先頭だけ解析 |

## 仕組み

### VBA の取り出し([MS-OVBA] に沿った実装)

1. 入れ物を開く: .xlsm 等は zip 内の `xl/vbaProject.bin`、.xls は OLE 複合ファイルの `_VBA_PROJECT_CUR` ストレージ、Access は `MSysAccessStorage` テーブルのツリー(ROOT → VBA → VBAProject)。OLE は自前の [MS-CFB] 読み取り(`src/ole/compoundFile.ts`。FAT・DIFAT・ミニ FAT のチェーンの循環と範囲外参照、ディレクトリツリーの循環を検出し、ストリームは必要になったときだけ取り出す)、Access は `mdb-reader` で読み、どれも同じ `VbaStorage` インターフェースに揃えます(`src/vba/project.ts`)。
2. `VBA/dir` ストリームを 2.4.1 の圧縮コンテナとして解凍し(`src/vba/decompress.ts`。解凍後のサイズに上限あり)、2.3.4.2 のレコード列を読みます(`src/vba/dir.ts`)。`PROJECTCODEPAGE`・参照設定・`MODULENAME` / `MODULESTREAMNAME` / `MODULEOFFSET` / `MODULETYPE` を取り出します。
3. 各モジュールのストリームの `MODULEOFFSET` 以降を解凍し、**`PROJECTCODEPAGE` に従って標準の `TextDecoder` でデコード**します(`src/vba/codepage.ts`)。日本語の VBA はほぼ cp932(Shift_JIS)で、以前使っていた iconv-lite の cp932 と全文字で一致することを Node.js とブラウザ(Chromium)の両方で確認しています。Node.js の ICU の癖(windows-1252 の 0x80〜0x9F が制御文字になる、shift_jis の一部の制御文字が入れ替わる)は補正しています。
4. `PROJECT` ストリーム(テキスト)からモジュールの種別を、`GC` / `DPB` を 2.4.3 の手順で復号して表示ロックとパスワードの有無を判定します(`src/vba/projectStream.ts`)。
5. `Attribute` 行を除いたソース(VBE で見える行番号と一致)のパスワードを伏せてから(`src/secrets.ts`)、字句解析し、行継続・コメント・文字列・条件付きコンパイル(`#If`)を考慮してプロシージャ・Declare・依存を抽出します(`src/vba/parse.ts`、`src/vba/analyze.ts`)。呼び出し関係では、手続き内・モジュールの変数、`For` の変数、名前付き引数(`Foo:=1`)を、同名のプロシージャの呼び出しとみなしません。

### Excel のその他の部分

- zip は中央ディレクトリだけを先に読み、必要な部品だけを `fflate` で少しずつ展開します(`src/excel/zip.ts`)。`workbook.xml`・リレーションシップ・接続などは `fast-xml-parser`(DTD を含む XML は拒否)、大きくなりうるシート・描画・VML の XML は、閉じタグが無い壊れた入力でも線形時間で終わるスキャナで走査します(`src/excel/xmlScan.ts`。セルの値は読みません)。
- .xlsb は BIFF12 レコード(`BrtBundleSh` / `BrtWsDim` / `BrtFmla*` / `BrtName` など)、.xls は BIFF8 レコード(`BOUNDSHEET` / `DIMENSIONS` / `FORMULA` / `NAME` / `SUPBOOK` / `CODENAME`)を直接読みます。npm の `xlsx`(SheetJS)は使っていません。

### Access

`mdb-reader` でテーブル定義とシステムテーブル(`MSysObjects` / `MSysQueries` / `MSysRelationships` / `MSysAccessStorage`)を読みます。
壊れたファイルでページのつながりが循環していると `mdb-reader` が止まらなくなる(テーブル定義のページが自分自身を指すとメモリを使いながら無限ループする)ため、ページを読むたびに制限時間を確認するバッファを渡しています。暗号化の鍵導出の繰り返し回数(spinCount)が異常に大きいファイルは計算を始める前に止めます。
クエリの SQL は `MSysQueries` の行(属性ごとの列・結合・条件など)から組み立て直しています(Jackcess の解析結果を参考にした独自実装で、Jackcess のテストと同じ期待値で検証しています)。

### AI による文章生成(`src/doc/`)

- **事実は機械的に、文章は AI に**: 件数・行数・依存の有無・リスクの検出・表・図の構文はすべて抽出結果から作ります。AI(構造化出力)には概要、業務フロー(ステップの一覧として返させ、Mermaid はこちらで組み立てる)、リスク評価、移行先候補と難易度、ヒアリング事項、モジュール・プロシージャの要約だけを書かせます。
- **map → reduce**: まずモジュール単位でソースを要約し(大きいモジュールはプロシージャ境界で分割、1 つのプロシージャが大きすぎるときだけ行で分割して要約を連結)、次に要約と抽出結果の要点を統合して全体の文章を作ります。入力が大きいときは、全体統合でプロシージャ単位の要約や一覧の一部を省いたことを仕様書の付録に明記します(黙って切り捨てない)。
- ファイル由来のデータはシステムプロンプトに入れず、区切りタグを無害化してからユーザーメッセージに入れます(「AI と機密情報の扱い」を参照)。
- API 呼び出しは `client.beta.messages.stream` で、`output_config.effort` を明示(要約は medium、統合は high)、`server-side-fallback-2026-07-01` のフォールバックを有効にしています。thinking パラメータは送りません。
- 構造化出力は `output_config.format` に JSON スキーマだけを渡し(`betaZodOutputFormat` の parse つきの形式や `parsed_output` は使わない)、先に `stop_reason`(refusal / max_tokens)を確認してから、本文を zod で検証します(`parseStructuredOutput`。中身はリポジトリ直下の `packages/shared` の `structured-output.ts` で、apps/diagnosis・apps/quote-assist と共通)。生成の途中でサーバー側フォールバックが起きた応答は `[途中までの text, fallback, 切り替え後の text]` になり、SDK の自動解析では途中までの文で例外になって切り替え後の正しい出力まで失われるためです。最後の `fallback` より後の text を優先し、だめなら1つ前の `fallback` の後から、…最後は全体をつなげて解析します。
- 時間の上限: 1回の依頼(SDK の再試行を含む)は既定 8 分(`createClaudeClient(anthropic, { requestTimeoutMs, signal })` で変更・外からの中止が可能)。CLI は全体で 30 分を超えたら標準レポートに切り替えます。Web 版(`apps/inventory-web`)は関数の実行時間の上限に合わせて全体を約 280 秒で打ち切ります。

## 制約・未対応

- **Access のフォーム・レポートは名前の一覧のみ**です。画面のレイアウト、コントロールの設定、レコードソースなどの UI 定義は解析していません(独自のバイナリ形式のため)。フォーム・レポートのモジュール(`Form_xxx`)の VBA は取り出せます。
- **Access のマクロ(マクロオブジェクト)は名前の一覧のみ**で、中身(アクション)は解析していません。`AutoExec` は起動のきっかけとして挙げます。
- Access の VBA 抽出は、MSysAccessStorage のツリーを実データ(Office で作成された .accdb)で確認したうえで、モジュールを含むツリーは合成データでテストしています。モジュールを含む実ファイルでの確認はできていません(ライセンス上問題のない公開サンプルが見つからなかったため)。
- .xls / .xlsb は数式の件数のみで、式のテキストは復元しません。.xls のボタンへのマクロ登録、.xlsb のデータ接続は未解析です。
- Excel 95 以前(BIFF5)の .xls はシート情報を解析しません(VBA は解析します)。
- 読み取りパスワードで暗号化されたブックは解析できません(パスワードを外してから読み込んでください)。
- **ブラウザ版では、パスワードで暗号化された .accdb は解析できません**(AES・SHA の同期実装を含めていないため。CLI では `--password` で読めます)。Jet4 の簡易暗号化された .mdb はブラウザでも読めます。
- 制限時間は協調的な確認のため、1回の正規表現・展開の途中では止まりません(既知の2乗時間のパターンは線形時間の処理に置き換えています)。ブラウザでは Web Worker で動かし、必要なら外から `terminate()` してください。
- Node.js の TextDecoder は euc-kr(cp949)を UHC として扱わないため、韓国語の VBA は Node.js では一部文字化けする可能性があります(ブラウザは問題ありません)。ICU を小さくしてビルドした Node.js では cp932 などを読めず、cp1252 として読みます(警告を出します)。
- パスワードの伏せ字はパターンによる検出です。変数を組み立てて作る接続文字列や、自然文で書かれたパスワード(`MsgBox "パスワードは 1234 です"` など)は伏せられないことがあります。
- .mdb(Jet4)のデータベースパスワードは読み取り時に検証されません(パスワードなしでも読めます)。暗号化された .accdb は `--password` が必要です。
- 呼び出し関係・依存は静的解析です。文字列を組み立てて実行するマクロ名、オブジェクト変数経由のクラスメソッド呼び出し、Evaluate 等は検出できないことがあります。
- p-code だけが書き換えられた VBA(いわゆる VBA stomping)は検出しません。ソースコード部分だけを解析します。
- Access 97(Jet3)形式の .mdb は、テーブル・クエリ等は読めますが VBA モジュールは解析しません(保存方式が異なるため)。
- Word / PowerPoint のマクロは対象外です。

## テスト

実在の顧客ファイルは使えないため、テスト用のファイルはコードで生成しています(`test/helpers/`)。

- `ovba.ts`: [MS-OVBA] の圧縮(2.4.1.3.7)と暗号化(2.4.3.2)を実装し、dir / PROJECT / モジュールストリームを組み立てて `cfb` で vbaProject.bin にします(`cfb` と `iconv-lite` はテストの組み立てにだけ使う devDependencies で、エンジンは使いません)。
- `sampleVba.ts`: 日本語(cp932)のコメント・モジュール名・プロシージャ名を含む「よくある中小企業のマクロ」。
- `workbooks.ts`: 上記を入れた .xlsm(zip)・.xlsb(BIFF12)・.xls(BIFF8 + OLE)を組み立てます。
- 解凍は仕様書の例(3.2.1〜3.2.3)のバイト列でも検証しています。
- `fuzz.test.ts`: 上記の合成ブックと Access のテストデータを、決定的な乱数(シード固定)でバイト反転・切り詰め・0 埋め・挿入・長さ欄の極端な値などで壊し、どの入力でも結果を返すか `InventoryError` で止まり、時間内に終わることを確かめます(`FUZZ_ITERATIONS=1500 npx vitest run test/fuzz.test.ts` で回数を増やせます)。
- `limits.test.ts`: zip 爆弾(宣言サイズの超過・嘘の宣言)、エントリ数、DTD、深い入れ子、OLE のセクタチェーン・DIFAT・ディレクトリの循環、MS-OVBA の解凍上限と不正な CopyToken、dir のレコード長、BIFF のシート位置の重なり、2乗時間になる XML・VBA、Access のページの循環など、狙った入力での上限・エラーを確かめます。
- `security.test.ts`: パスワードの伏せ字(JSON・Markdown・AI への入力)、AI への入力の区切りの無害化、Markdown のエスケープ。`codec.test.ts`: TextDecoder と iconv-lite、自前の SHA-256 と node:crypto の一致。
- Access は `test/fixtures/access/` の公開テストデータ(Jackcess: Apache License 2.0、mdb-reader: MIT License)を使っています。出典は同ディレクトリの README を参照してください。

## ディレクトリ構成

```
src/
  index.ts          Node.js 向けの入口(analyzeFile・AI を含む)
  browser.ts        ブラウザ向けの入口(analyzeBuffer・renderMarkdown・スキーマ・エラー)
  analyze.ts        形式判定と InventoryReport の組み立て(Node.js 固有の API を使わない)
  analyzeFile.ts    ファイルパスから読む(Node.js 専用)
  errors.ts         エラーの種類
  limits.ts         上限(展開サイズ・件数・制限時間)と Budget
  sha256.ts         SHA-256(同期・自前の実装)
  schema.ts         InventoryReport の zod スキーマ
  findings.ts       機械的なリスク検出
  secrets.ts        パスワードの検出と伏せ字
  cli.ts            CLI
  ole/              OLE 複合ファイル([MS-CFB])の読み取り
  vba/              MS-OVBA(解凍・dir・PROJECT)、コードページ、ソース解析、呼び出し関係・依存・イベント
  excel/            zip の読み取り、線形時間の XML スキャナ、SpreadsheetML / BIFF12(.xlsb)/ BIFF8(.xls)
  access/           mdb-reader による読み取り、クエリ SQL の復元、MSysAccessStorage
  browser/          ブラウザ用バンドルで mdb-reader の暗号処理を差し替えるモジュール
  doc/              仕様書の生成(Markdown・Mermaid・チャンク分割・Claude 呼び出し・ルールベースの代替)。
                    構造化出力の検証は ../../packages/shared(相対パスで取り込む。esbuild・tsx・vitest でそのまま解決できる)
scripts/            ブラウザ用のバンドル作成と、Chromium での動作確認
test/               vitest のテストと、合成フィクスチャ・ファジングの生成ヘルパー
```

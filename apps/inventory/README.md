# Excel/VBA・Access の AI棚卸しツール(解析エンジン)

「作った人が辞めて誰も中身が分からない」Excel マクロや Access ファイルを読み込み、
シート構成・VBA のモジュールとプロシージャ・呼び出し関係・外部依存・リスクを機械的に抽出して、
仕様書(Markdown)を出力します。API キーがあれば Claude が概要・業務フロー・リスク評価・移行先の提案を書き足します。

UI と配布形態は後続タスクで決めるため、ここではライブラリと CLI だけを提供します。

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

## AI と機密情報の扱い

`document` は環境変数 `ANTHROPIC_API_KEY`(または `ANTHROPIC_AUTH_TOKEN`)があると、Claude(`claude-opus-5-5`)で文章を生成します。
**このとき、VBA のソースコード・Access のクエリの SQL・シート名・名前定義・数式の例・テーブルの列名などが Anthropic 社の API に送信されます。**
顧客のファイルを扱うときは、事前に送信の許可を得てください。送信したくない場合は `--no-ai` を指定します(CLI のヘルプにも同じ注意を表示します)。

- セルの値(データ本体)は最初から読み取らないため、送信もされません。
- 文書プロパティの作成者名・最終更新者名は AI には渡しません(仕様書には記載します)。
- 接続文字列の `Password=` / `Pwd=` の値は、JSON・仕様書・AI への入力のすべてで `****` に置き換えます。ソースコード中の接続文字列リテラルも同様です。
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

機械的に検出するリスク(`findings`): PtrSafe のない Declare(64bit 版で動かない)、接続文字列のパスワード、IE の自動操作、Excel 4.0 マクロシート、SendKeys、Shell、ハードコードされたパス、On Error Resume Next、外部とやり取りするのにエラー処理がないプロシージャ、200 行超のプロシージャ、外部リンク・データ接続・リンクテーブル、Windows API、Option Explicit なし、完全に非表示のシート、#REF!、呼ばれていない Private プロシージャ、VBA の表示ロック。

## 出力

- `analyze` … `InventoryReport`(`src/schema.ts` の zod スキーマで型付けした JSON)。`file` / `properties` / `excel` / `access` / `vba` / `entryPoints` / `callGraph` / `dependencies` / `findings` / `stats` / `warnings`。
- `document` … Markdown の仕様書。概要、処理の流れ(業務フロー図・呼び出し関係図・クエリとテーブルの関係図を Mermaid で)、シート構成、VBA モジュールとプロシージャ一覧、Access、外部依存、リスク、移行先候補と難易度、現場に確認すること、付録(解析の制約・AI への入力の注記)。

## ライブラリとして使う

```ts
import { analyzeFile, generateDocument, createClaudeClient, hasAnthropicCredentials } from "./src";

const report = await analyzeFile("売上管理.xlsm"); // ブラウザ等では analyzeBuffer(bytes, fileName)
const { markdown, ai, aiError } = await generateDocument(report, hasAnthropicCredentials() ? createClaudeClient() : null);
```

解析(`analyzeBuffer`)はバイト列を受け取る同期関数です。現状は Node.js での実行を前提にしています(SHA-256 の計算に `node:crypto`、Access の読み込みに `Buffer` を使用)。ブラウザで動かす場合はこの2点の差し替えが必要です。
AI の呼び出しは `StructuredClient` インターフェースの裏に隠してあり、テストや別の実行環境ではモックや別実装に差し替えられます。

## 仕組み

### VBA の取り出し([MS-OVBA] に沿った実装)

1. 入れ物を開く: .xlsm 等は zip 内の `xl/vbaProject.bin`、.xls は OLE 複合ファイルの `_VBA_PROJECT_CUR` ストレージ、Access は `MSysAccessStorage` テーブルのツリー(ROOT → VBA → VBAProject)。OLE は `cfb`、Access は `mdb-reader` で読み、どれも同じ `VbaStorage` インターフェースに揃えます(`src/vba/project.ts`)。
2. `VBA/dir` ストリームを 2.4.1 の圧縮コンテナとして解凍し(`src/vba/decompress.ts`)、2.3.4.2 のレコード列を読みます(`src/vba/dir.ts`)。`PROJECTCODEPAGE`・参照設定・`MODULENAME` / `MODULESTREAMNAME` / `MODULEOFFSET` / `MODULETYPE` を取り出します。
3. 各モジュールのストリームの `MODULEOFFSET` 以降を解凍し、**`PROJECTCODEPAGE` に従って `iconv-lite` でデコード**します。日本語の VBA はほぼ cp932(Shift_JIS)です。
4. `PROJECT` ストリーム(テキスト)からモジュールの種別を、`GC` / `DPB` を 2.4.3 の手順で復号して表示ロックとパスワードの有無を判定します(`src/vba/projectStream.ts`)。
5. `Attribute` 行を除いたソース(VBE で見える行番号と一致)を字句解析し、行継続・コメント・文字列を考慮してプロシージャ・Declare・依存を抽出します(`src/vba/parse.ts`、`src/vba/analyze.ts`)。

### Excel のその他の部分

- SpreadsheetML(XML)は `fflate` で展開し、`workbook.xml`・リレーションシップ・接続などは `fast-xml-parser`、大きくなりうるシート XML は正規表現で走査します(セルの値は読みません)。
- .xlsb は BIFF12 レコード(`BrtBundleSh` / `BrtWsDim` / `BrtFmla*` / `BrtName` など)、.xls は BIFF8 レコード(`BOUNDSHEET` / `DIMENSIONS` / `FORMULA` / `NAME` / `SUPBOOK` / `CODENAME`)を直接読みます。npm の `xlsx`(SheetJS)は使っていません。

### Access

`mdb-reader` でテーブル定義とシステムテーブル(`MSysObjects` / `MSysQueries` / `MSysRelationships` / `MSysAccessStorage`)を読みます。
クエリの SQL は `MSysQueries` の行(属性ごとの列・結合・条件など)から組み立て直しています(Jackcess の解析結果を参考にした独自実装で、Jackcess のテストと同じ期待値で検証しています)。

### AI による文章生成(`src/doc/`)

- **事実は機械的に、文章は AI に**: 件数・行数・依存の有無・リスクの検出・表・図の構文はすべて抽出結果から作ります。AI(構造化出力)には概要、業務フロー(ステップの一覧として返させ、Mermaid はこちらで組み立てる)、リスク評価、移行先候補と難易度、ヒアリング事項、モジュール・プロシージャの要約だけを書かせます。
- **map → reduce**: まずモジュール単位でソースを要約し(大きいモジュールはプロシージャ境界で分割、1 つのプロシージャが大きすぎるときだけ行で分割して要約を連結)、次に要約と抽出結果の要点を統合して全体の文章を作ります。入力が大きいときは、全体統合でプロシージャ単位の要約や一覧の一部を省いたことを仕様書の付録に明記します(黙って切り捨てない)。
- API 呼び出しは `client.beta.messages.stream` + `betaZodOutputFormat` で、`output_config.effort` を明示(要約は medium、統合は high)、`server-side-fallback-2026-07-01` のフォールバックを有効にし、`stop_reason`(refusal / max_tokens)と `parsed_output` を確認します。thinking パラメータは送りません。

## 制約・未対応

- **Access のフォーム・レポートは名前の一覧のみ**です。画面のレイアウト、コントロールの設定、レコードソースなどの UI 定義は解析していません(独自のバイナリ形式のため)。フォーム・レポートのモジュール(`Form_xxx`)の VBA は取り出せます。
- **Access のマクロ(マクロオブジェクト)は名前の一覧のみ**で、中身(アクション)は解析していません。`AutoExec` は起動のきっかけとして挙げます。
- Access の VBA 抽出は、MSysAccessStorage のツリーを実データ(Office で作成された .accdb)で確認したうえで、モジュールを含むツリーは合成データでテストしています。モジュールを含む実ファイルでの確認はできていません(ライセンス上問題のない公開サンプルが見つからなかったため)。
- .xls / .xlsb は数式の件数のみで、式のテキストは復元しません。.xls のボタンへのマクロ登録、.xlsb のデータ接続は未解析です。
- Excel 95 以前(BIFF5)の .xls はシート情報を解析しません(VBA は解析します)。
- 読み取りパスワードで暗号化されたブックは解析できません(パスワードを外してから読み込んでください)。
- .mdb(Jet4)のデータベースパスワードは読み取り時に検証されません(パスワードなしでも読めます)。暗号化された .accdb は `--password` が必要です。
- 呼び出し関係・依存は静的解析です。文字列を組み立てて実行するマクロ名、オブジェクト変数経由のクラスメソッド呼び出し、Evaluate 等は検出できないことがあります。
- p-code だけが書き換えられた VBA(いわゆる VBA stomping)は検出しません。ソースコード部分だけを解析します。
- Access 97(Jet3)形式の .mdb は、テーブル・クエリ等は読めますが VBA モジュールは解析しません(保存方式が異なるため)。
- Word / PowerPoint のマクロは対象外です。

## テスト

実在の顧客ファイルは使えないため、テスト用のファイルはコードで生成しています(`test/helpers/`)。

- `ovba.ts`: [MS-OVBA] の圧縮(2.4.1.3.7)と暗号化(2.4.3.2)を実装し、dir / PROJECT / モジュールストリームを組み立てて `cfb` で vbaProject.bin にします。
- `sampleVba.ts`: 日本語(cp932)のコメント・モジュール名・プロシージャ名を含む「よくある中小企業のマクロ」。
- `workbooks.ts`: 上記を入れた .xlsm(zip)・.xlsb(BIFF12)・.xls(BIFF8 + OLE)を組み立てます。
- 解凍は仕様書の例(3.2.1〜3.2.3)のバイト列でも検証しています。
- Access は `test/fixtures/access/` の公開テストデータ(Jackcess: Apache License 2.0、mdb-reader: MIT License)を使っています。出典は同ディレクトリの README を参照してください。

## ディレクトリ構成

```
src/
  analyze.ts        形式判定と InventoryReport の組み立て(入口)
  schema.ts         InventoryReport の zod スキーマ
  findings.ts       機械的なリスク検出
  secrets.ts        パスワードの検出と伏せ字
  cli.ts            CLI
  vba/              MS-OVBA(解凍・dir・PROJECT)、ソース解析、呼び出し関係・依存・イベント
  excel/            SpreadsheetML / BIFF12(.xlsb)/ BIFF8(.xls)
  access/           mdb-reader による読み取り、クエリ SQL の復元、MSysAccessStorage
  doc/              仕様書の生成(Markdown・Mermaid・チャンク分割・Claude 呼び出し・ルールベースの代替)
test/               vitest のテストと、合成フィクスチャの生成ヘルパー
```

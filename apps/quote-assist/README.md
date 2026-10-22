# 見積アシスト(製造業向け 引き合い対応・見積作成エージェント)MVP

> **認証なしのMVPです。社外(インターネット)に公開しないでください。** 公開する場合は Basic 認証(`QUOTE_ASSIST_BASIC_AUTH_USER` / `QUOTE_ASSIST_BASIC_AUTH_PASSWORD`)の設定が必須です。本番ビルド(`next start`・`NODE_ENV=production`)は、その設定がないとすべてのリクエストを 401 にします(`src/proxy.ts`)。

部品加工(切削・板金)の単品〜小ロット見積を対象に、引き合いメールと2D図面PDFから要件と確認事項を整理し、過去の類似案件と単価表をもとに見積根拠・見積書案・回答メール案を作り、承認後にSalesforceへ商談と見積を登録します。

- **読み取りと文章はAI(Claude)、計算と判定はプログラム、最終決定と送信は人。** 金額はAIに決めさせず、単価表と工数から TypeScript で計算します。
- 企画・業務設計:[docs/manufacturing/use-cases.md](../../docs/manufacturing/use-cases.md)(5章)
- 技術設計:[docs/manufacturing/quote-assist-design.md](../../docs/manufacturing/quote-assist-design.md)(画面・データモデル・計算式・類似検索・連携・機密情報)
- データはすべて架空の加工会社「株式会社しらかば精工」の合成データです。社名・人名・図面は実在しません。

## 使い方

```bash
cd apps/quote-assist
npm install
cp .env.example .env.local   # ANTHROPIC_API_KEY を設定(未設定でもデモモードで全画面が動く)
npm run dev                  # http://localhost:3300
```

| コマンド | 内容 |
|---|---|
| `npm test` | 単体テスト(vitest。Claude API は SDK をモックし、実際には呼ばない) |
| `npm run test:e2e` | 操作テスト(Playwright。本番ビルドを3310番ポートで、E2E用の Basic 認証をつけて起動し、デモモード・モックのSalesforceで確認) |
| `npm run typecheck` / `npm run lint` / `npm run build` | 型チェック / ESLint / 本番ビルド |
| `npm run generate-data` | 合成データ(`data/*.json`。効果測定のデモ用の架空の記録 `impact-baseline.json`・`impact-pilot.json` を含む)とデモ用図面PDF(`public/samples/`)を作り直す(乱数の種は固定) |
| `npm run eval` | 実際の Claude API での評価(キーがなければ案内して終了。`--yes` なしでは概算費用の表示だけ)。デモ3件、または PoC のお客様データ(`--data`)を、正解ラベルと照合する。下の「評価」 |
| `npm run demo:record` | 5分デモの台本([docs/manufacturing/demo/demo-script.md](../../docs/manufacturing/demo/demo-script.md))どおりに画面を自動操作し、スクリーンショット(`docs/manufacturing/demo/screens/`)と録画(`demo-output/`、git管理外)を作る。デモモード・一時ディレクトリの保存先で3530番ポートに起動する(`--no-build` `--only=screens|video` `--pace=1.5` `--port=35xx`) |

E2E には Playwright の Chromium が必要です(初回は `npx playwright install chromium`。ブラウザを別の場所に入れてある環境では `PLAYWRIGHT_BROWSERS_PATH=<ブラウザのディレクトリ> npm run test:e2e`)。

## 評価(`npm run eval`。精度・確認事項・類似検索・費用)

引き合い(図面PDF+メール)を本番と同じ入口で読み取り、正解データと照合します。`docs/manufacturing/sales/README.md` の 5.4・`poc-plan.md` 4章の指標に対応し、**お客様のデータ(CSV+図面PDF+メール本文)を読み込めます**。CI では実行しません。

```bash
export ANTHROPIC_API_KEY=sk-ant-...
npm run eval                                 # デモ3件。概算費用の表示だけ(count_tokens。API は呼ばない)
npm run eval -- --yes                        # 実行(概算 $0.4)
npm run eval -- --data ./poc-data --yes      # PoC: cases.csv + drawings/*.pdf + emails/*.txt
npm run eval -- --data ./poc-data --with-estimate --yes   # 画面に出る上位5件(AIの並べ替え後)でも類似検索を評価
npm run eval -- --demo                       # API を呼ばず、デモの固定結果で仕組みを確かめる(精度100%)
npm run eval -- --export-demo ./poc-sample   # PoC のデータの形式の見本(デモ3件)を書き出す
```

出力は、(1) 項目別の正解率 (2) **確からしさ別の誤り(「高」なのに誤り=自信のある誤り)** (3) 確認事項の検出率・漏れ・**不要な確認事項** (4) 類似検索の的中率(参考案件が上位5件に入った割合。その案件自身は検索先から除く) (5) 処理時間・トークン・費用。結果は `evals/results/<日時>/` に JSON と Markdown で保存されます(git管理外。**PoC の結果にはお客様のデータの値が含まれる**ので共有しないでください)。cases.csv の列・指標の定義・費用の見積もり・合格の目安は [docs/evals.md](../../docs/evals.md) を参照してください。評価のコードは `evals/`・`scripts/eval-extraction.ts`、単体テスト(`evals/**/*.test.ts`)は SDK を差し替えて API を呼びません。

## デモの流れ(5分、use-cases.md 5.6)

1. **見積待ち一覧**(`/`):12件中8件が社長・工場長の確認待ち、平均回答日数・受注率・実績が見積を超えた案件の割合(過去案件200件から計算)。
2. **引き合い登録**:「サンプル1:改訂品(リピート)を読み込む」を押す(メール本文と図面PDF2枚が入る)→「登録して読み取る」。自分の図面PDFをドラッグ&ドロップしてもよい(デモモードではサンプル以外は「読み取れない」として手入力になる)。
3. **抽出結果・確認事項**:材質SUS304・数量50・無電解ニッケルめっき・最小公差±0.01などを、確信度と根拠(図面のファイル名・ページ・位置・原文の引用、メールのどの文か)つきで表示。「熱処理の要否」「検査成績書の要否」が確認事項になり、確認メール案が出る。値は「抽出内容を修正する」で直せる。
4. **類似案件**:同じ図番の旧版(Rev.B)が1位で「見積工数1.2時間に対し実績1.6時間。赤字の可能性」「めっき後の寸法不良」を警告。同材質・同サイズ帯の案件が続く。
5. **見積根拠・修正**:材料費・工程別の加工費と段取り費・外注費・管理費・利益・端数調整を、計算式と出典(単価表・過去案件)のリンクつきで表示。マシニングの1個あたり時間を旧版の実績に合わせて1.35時間(合計1.55時間)に直すと即座に再計算され(800,000円 → 892,500円)、出典が「人が修正」になる。数量段階別の単価、確認ポイント(前提条件・赤字履歴・特急・単価の乖離・設備の加工範囲)も表示。抽出結果に要確認・不足の項目(このサンプルでは熱処理・検査書類)が残っているので、「未確認の項目を確認したうえで承認する」にチェックを入れ、承認者を選んで承認。
6. **見積書・回答メール**:見積書プレビュー(印刷・PDF保存)と回答メール案(確認事項つき)。
7. **Salesforce登録**:送る商談・見積の内容を確認して登録(モック)。処理時間・トークン数・概算費用・修正の記録を表示。「Salesforce(モック)」画面で登録結果を確認できる。
8. **効果測定ダッシュボード**(`/dashboard`、上のメニューの「効果測定」):試験導入(PoC)の期間の実測値を、導入前(ベースライン)と比べる。下の「効果測定ダッシュボード」を参照。

ほかに「サンプル2:情報不足(新規)」(材質が「アルミ」、数量「数個」、納期なし、顧客マスタにない会社)と「サンプル3:短納期」(約1週間後の納期で特急料金、高周波焼入れ+黒染め、±0.005で円筒研削)があります。

## 効果測定ダッシュボード

PoC(試験導入)の効果を数字で示し、導入判断につなげる画面です(`/dashboard`)。KPI の区分と定義は [use-cases.md 5.8](../../docs/manufacturing/use-cases.md)、導入前の測り方は [poc-plan.md 4〜5章](../../docs/manufacturing/sales/poc-plan.md) に対応します。**導入後の値は、見積アシストが残した記録から決まった計算式で出します(AIには数字を作らせません)。** 数字は「試験導入期間の実測値」で、導入前後で案件の種類・件数・担当者が同じとは限らないため、差のすべてを見積アシストの効果とは断定しません。

### 画面

| 画面 | パス | 内容 |
|---|---|---|
| ダッシュボード | `/dashboard` | 指標のタイル(導入後の値・導入前との差・良い/悪い方向)、導入前後の比較表、推移の折れ線(週ごと/月ごと。導入前を破線で重ねる)、AI案の採用率・修正率(項目別の横棒)、補助の値、書き出し、指標の定義と計算式。絞り込み(推移の単位、導入後のデータ)は1行にまとめ、すべてに効く。グラフはホバー(キーボードの左右矢印も可)で値・件数・導入前を表示し、「表で見る」で表にもなる |
| ベースライン | `/dashboard/baseline` | 導入前の記録シート(PoC計画書 5章)の入力。見積担当者の名簿、CSVの取り込み(Excelからの貼り付け=タブ区切り、UTF-8/Shift_JIS)、1件ずつの入力、保存。入力中の内容での導入前の値をその場で表示 |
| 報告書 | `/dashboard/report` | 報告会にそのまま使える印刷向けの表示(ブラウザの印刷でPDF保存。印刷時は白地・A4)。Markdown・CSVの書き出しもある |
| 結果の記録 | `/inquiries/[id]/crm`(下部) | 承認した見積に、受注・失注、実績原価、受注後の手戻り件数を記録する(受注率・見積と実績の差・手戻りに使う。正本はSalesforceなどで、ここは効果測定のための控え) |

### 使い方

1. **ベースラインを入れる**:`/dashboard/baseline` で、導入前の2〜4週間に記録シートへ記入した値を、CSVの取り込みか1件ずつの入力で入れて「保存」(保存先は `QUOTE_ASSIST_DATA_DIR` の `impact-baseline.json`)。実測できず推定した行は、メモに「推定」と書くと、報告書に件数が出ます。受注額・見積原価・実績原価・手戻り件数の列(任意)を入れると、見積と実績の差・手戻りも導入前と比べられます。
2. **導入後の記録をためる**:引き合い登録で「この見積を作る人」を選び(任意。見積担当者以外の割合に使う)、いつもどおり承認します。受注・失注や実績原価が分かったら、Salesforce登録画面の下の「結果の記録」に入れます。
3. **見る・報告する**:`/dashboard` で比べ、`/dashboard/report` を印刷(PDF)するか、Markdown・CSVで書き出します。

### デモ用の架空データ

`npm run generate-data` が、導入前(40件・4週間)と導入後(60件・6週間)の**架空の**記録を `data/impact-baseline.json`・`data/impact-pilot.json` に作ります(種は固定。実在の会社・調査の数字ではなく、実際の効果を示すものでもありません)。`/dashboard` の「導入後のデータ」で「デモ用の架空の記録」(既定)と「このアプリの実際の記録」を切り替えます。参照データのフォルダにこの2ファイルがなければ、切り替えは出ず、実際の記録だけを集計します。

### KPIの定義と計算式

「件数」は、その値の計算に使えた記録の数です。**件数が10件(`MIN_RELIABLE_N`)に満たない値は「参考値」と表示し、良し悪しの判定をしません**(グラフでは中を抜いた○)。分母が0のときは0%ではなく「対象なし」と表示します。欠損(必要な値がない記録)は計算から除き、除いた件数を画面に出します。

| KPI | 定義・計算式 | 導入前のデータ | 導入後のデータ |
|---|---|---|---|
| 見積回答リードタイム | 中央値(受付日から回答日までの営業日数)。土日を除き、祝日は考慮しない。回答日のない記録は除く | 記録シートの受付日時・回答日時 | 登録日と承認日(回答の送信は人が行うため、承認日を回答日とみなす) |
| 見積1件あたりの作業時間 | 平均(作業時間・分)。導入前は「営業・事務」+「見積担当」(空欄は0分) | 記録シートの作業時間2列 | 登録から承認までの経過分(待ち時間を含む上限値。導入前は手を動かした時間の自己記録なので、短縮は控えめに出る) |
| 見積担当者以外が作成した割合 | 見積担当者の名簿にいない人が作成した件数 ÷ 作成者が分かる件数。名簿とは部分一致で照合 | 記録シートの見積担当 | 引き合い登録時に選んだ「この見積を作る人」 |
| AI案の採用率・修正率 | 採用率 = (評価した項目数 − 修正した項目数) ÷ 評価した項目数。修正率 = 1 − 採用率。抽出13項目と見積の6項目(工数は工程ごと)。承認した見積だけが対象。修正した工程の工数の修正幅(中央値)も出す | なし | 抽出項目の手修正、AI案(`estimate.proposal`)と承認した見積の違い |
| 見積と実績の差 | 赤字案件の割合 = 実績原価 > 受注額(税抜)の受注件数 ÷ 実績原価と受注額がある受注件数。原価差率 = (実績 − 見積原価) ÷ 見積原価の中央値。見積原価は利益と端数処理を除いた明細の合計 | 記録シートの任意の列 | 承認時の明細と、画面で記録した実績原価 |
| 見積受注率 | 受注 ÷ (受注 + 失注)。回答済みで結果が未定の記録は除く。価格・納期・市況にも左右されるため、効果とは断定しない | 記録シートの受注/失注 | 画面で記録した受注・失注 |
| 1件あたりのAI費用 | 平均(処理ごとの概算費用)。AIを使った記録だけ(デモモードの記録は含めず「対象なし」)。処理時間・トークン数も出す | なし | 処理ごとの記録(トークン数と料金表) |
| 受注後の手戻り | 手戻り件数の合計 ÷ 手戻り件数が記録された受注件数 | 記録シートの任意の列 | 画面で記録した手戻り件数 |

推移は受付日で期間(週は月曜始まり、月は暦月)に分けて集計します。記録のない期間も件数0で並べ、直近の期間は回答・結果・実績の記録が少なく出ます。計算は `src/lib/impact/kpi.ts`(純粋関数。`kpi.test.ts` に手計算で検算できるテスト)、定義の文言は `src/lib/impact/definitions.ts` に1か所にまとめ、画面・報告書・書き出しに同じ文を出します。

### 書き出し

`GET /api/impact/export`(画面の条件 `g=week|month`、`source=demo|app` をそのまま使える):`format=md`(報告書のMarkdown)、`format=csv&part=summary|trend|adoption|baseline|template`(BOM付きUTF-8。式として実行されうる先頭文字は無害にする)。

## 営業の流れでの位置づけ

このアプリは社外に公開しません。見込み客には、録画・スクリーンショット・面談での実演(上の「デモの流れ」)で見せます。

1. **入口(AI導入診断 `apps/diagnosis`)**:業種が製造業で、見積書・提案書の作成が月20時間以上、または「いま困っていること」に見積の記述がある回答者に、結果画面とPDFで「製造業向け見積アシストのデモ(面談で実演)」を案内します(決まったルール。`apps/diagnosis/src/lib/diagnosis/related-tools.ts`)。案内から無料相談の申し込みフォームへ移ると、「相談したい内容」に「見積アシストのデモ希望」が入ります。
2. **デモの紹介ページ(任意)**:録画などの紹介ページを用意したら、診断側の `NEXT_PUBLIC_QUOTE_ASSIST_DEMO_URL` に設定します(このアプリ自体のURLは入れない)。未設定なら診断の画面は「無料相談でご案内します」と表示します。
3. **面談**:「デモの流れ」に沿って実演します。使うのは架空の合成データだけで、見込み客の図面・見積を入れません。効果は個別の業務で検証してから示し、デモの数値を約束しません。
4. **導入の検討**:業務設計と進め方は [docs/manufacturing/use-cases.md](../../docs/manufacturing/use-cases.md)。

## 設定(環境変数)

`.env.example` を参照してください。

| 変数 | 内容 | 既定 |
|---|---|---|
| `ANTHROPIC_API_KEY` | Claude APIキー。未設定ならデモモード | なし |
| `AI_PROVIDER` | `demo` でAIを使わない | APIキーがあれば Claude |
| `USD_JPY` | 概算費用の円換算 | 150 |
| `STORAGE_DRIVER` | `file` / `memory` | `file` |
| `QUOTE_ASSIST_DATA_DIR` | 引き合い・図面PDF・モックCRMの保存先 | `.data/` |
| `TENANT_ID` | 共用環境で会社ごとに保存先を分ける | なし |
| `QUOTE_ASSIST_REFERENCE_DIR` | 単価表・顧客・過去案件などのディレクトリ | `data/` |
| `CRM_PROVIDER` | `mock` で常にモック | 自動 |
| `SF_INSTANCE_URL` / `SF_CLIENT_ID` / `SF_CLIENT_SECRET` | 3つそろったときだけ本番の Salesforce REST API を使う | なし(モック) |
| `QUOTE_ASSIST_BASIC_AUTH_USER` / `QUOTE_ASSIST_BASIC_AUTH_PASSWORD` | 両方そろえば全ページ・APIに Basic 認証を求める。**本番ビルドではどちらかが欠けると全リクエストが 401** | なし |
| `QUOTE_ASSIST_ALLOW_NO_AUTH` | `true` で、本番ビルドでも認証なしで動かす(社内ネットワークだけ・前段の別の認証で守るとき・デモ録画。社外公開では使わない) | なし |
| `QUOTE_ASSIST_AI_DAILY_LIMIT` | Claude API の呼び出しの1日(日本時間)の上限回数。読み取りと工数案をそれぞれ1回と数える。超えたら読み取りは手入力、工数案は類似実績からの計算になる。`0` で AI を使わない(読み取れない値も `0` 扱い)。プロセスのメモリで数えるので再起動で数え直す | 200 |
| `SF_API_VERSION` / `SF_OPPORTUNITY_STAGE` | API版、作成する商談のフェーズ | `v62.0` / `Proposal/Price Quote` |

Salesforce の本番接続を使うには、接続アプリケーションでクライアントクレデンシャルフローを有効にして実行ユーザーを設定し、組織で見積(Quote)を有効にしておきます。顧客マスタの `salesforceAccountId` に取引先のIDを入れると商談に紐づきます。

## しくみ

| 処理 | 担当 | 場所 |
|---|---|---|
| 図面PDF・メールからの項目抽出(確信度・根拠・確認事項の文案) | AI(構造化出力) | `src/lib/extraction/claude.ts`(デモ:`extraction/demo.ts`) |
| 材質・処理名の単価表への対応づけ、顧客照合、値の検証 | プログラム | `src/lib/extraction/normalize.ts` |
| 必須項目・矛盾のチェック、確認事項・確認メール案 | プログラム | `src/lib/extraction/rules.ts` |
| 類似案件の検索(属性スコア+文字2-gram) | プログラム | `src/lib/similar/search.ts` |
| 類似案件の並べ替え・理由、工程別工数案(根拠の過去案件が必須) | AI | `src/lib/estimate/claude.ts`(AIなし・失敗時:`estimate/fallback.ts` が類似案件の実績を加重平均) |
| 見積計算・数量段階・標準リードタイム・特急判定 | プログラム | `src/lib/quote/calculate.ts`、`quote/build.ts` |
| 確認ポイント(前提・赤字履歴・単価の乖離・設備の範囲・研削の要否) | プログラム | `src/lib/quote/warnings.ts` |
| Salesforce の商談+見積(Composite API) | プログラム | `src/lib/crm/`(ペイロード・モック・REST) |
| 処理全体と計測 | プログラム | `src/lib/pipeline.ts` |

- Claude は `claude-opus-5-5` を `client.beta.messages.stream`(server-side fallback、`output_config.effort: "medium"`、zod の構造化出力)で呼びます。PDF はリクエスト本文に base64 で入れ、Files API は使いません。
- 図面・メールの中の指示には従わないようシステムプロンプトで指示し、メール本文と添付ファイル名はタグの山かっこを全角にしてから渡します。AIの出力はすべて検証してから使います(構造化出力の解析はSDKに任せず、生成途中のフォールバックでも切り替え後の出力を検証して使う)。
- 確信度が低い・根拠のない・不足している抽出項目は、見積の画面に一覧で出し、承認時に確認を求めます。金額の掛け算は10進で行い、明細の計算式どおりに手計算で検算できます。
- 保存先・参照データ・AI・CRM は差し替え可能です(`src/lib/deps.ts`)。ログには引き合いid・処理時間・トークン数・エラーの種類だけを出します(`src/lib/log.ts`)。

ほかのアプリと共通の部品(セキュリティヘッダー・本文の上限つきの読み取り・例外の種類の取り出し・Claude の構造化出力の検証 `parseStructuredOutput`)は、リポジトリ直下の `packages/shared` を `tsconfig.json` の別名 `@idea/shared/*` で取り込んでいます(ビルド不要。`next.config.ts` だけは相対パス)。そのため `next.config.ts` で Turbopack とファイルトレースのルートをリポジトリのルートにしています。Vercel などに置くときは、ルートディレクトリ(`apps/quote-assist`)の外のファイルもビルドに含めてください。共通の部品自体のテストは `packages/shared` で `npm test`。

## データ

| ファイル | 内容 |
|---|---|
| `data/rate-table.json` | 単価表(工程チャージ9・材料10・外注8・見積ルール)。差し替えると計算が変わる |
| `data/customers.json` | 顧客マスタ(架空20社) |
| `data/past-cases.json` | 過去案件200件(工程別の見積工数と実績工数、受注・失注、回答日数) |
| `data/defects.json` | 不具合履歴10件 |
| `data/company.json` | 会社プロフィールと設備10種 |
| `data/backlog.json` | 見積待ち一覧のデモ用12件 |
| `data/impact-baseline.json` | 効果測定のデモ用:導入前の記録シート40件(架空。保存したベースラインがなければ、これを表示) |
| `data/impact-pilot.json` | 効果測定のデモ用:導入後の記録60件(架空) |
| `public/samples/*.pdf` | デモ用の引き合い図面(改訂品2枚・情報不足1枚・短納期1枚) |
| `src/lib/demo/scenarios.ts` | デモ用引き合いのメール・図面の内容・デモモードの読み取り結果・評価用の正解ラベル |

### 図面用フォント(ライセンス)

図面PDFの日本語には **Noto Sans JP**(SIL Open Font License 1.1、ライセンス文は [scripts/fonts/OFL.txt](scripts/fonts/OFL.txt))を、図面で使う文字だけにサブセットして埋め込んでいます(`scripts/fonts/NotoSansJP-Drawing.ttf`)。pdf-lib 側のサブセット処理では日本語の字形が欠けるため、fonttools で事前にサブセットしています。図面の文言を変えて足りない文字が出たら、次の手順で作り直します。

```bash
npx tsx scripts/generate-data.ts --chars-only        # scripts/fonts/chars.txt を更新
pip install fonttools
mkdir -p .cache/fonts
curl -L -o .cache/fonts/NotoSansJP-VF.ttf "https://raw.githubusercontent.com/google/fonts/main/ofl/notosansjp/NotoSansJP%5Bwght%5D.ttf"
python3 -m fontTools.varLib.instancer .cache/fonts/NotoSansJP-VF.ttf wght=400 -o .cache/fonts/NotoSansJP-Regular.ttf
# レイアウト機能(GSUB)を外す:数字が別の字形に置き換わり、幅がずれるのを防ぐ
python3 -m fontTools.subset .cache/fonts/NotoSansJP-Regular.ttf --text-file=scripts/fonts/chars.txt \
  --output-file=scripts/fonts/NotoSansJP-Drawing.ttf --layout-features='' --name-IDs='*' --notdef-outline
npm run generate-data
```

## 制約・未実装

- **利用者ごとの認証・権限管理はありません。** 手元やデモ・社内での利用を前提にしています。社外に公開しないでください。公開する場合は Basic 認証(上の環境変数)が必須で、できれば前段に SSO を置いてください。誤公開の歯止めとして、本番ビルドは Basic 認証の設定がないと全リクエストを 401 にし(`QUOTE_ASSIST_ALLOW_NO_AUTH=true` で明示的に解除)、AI の呼び出しには1日の上限があります。ページには CSP などのセキュリティヘッダーを付けています(`next.config.ts`。中身はリポジトリ直下の `packages/shared` の `security-headers.ts` の既定のまま。図面PDFの表示は CSP の対象外)。
- デモモードの読み取り結果は、サンプル図面(ファイル名かメール中の図番で判定)に対する固定結果です。それ以外の図面は全項目が「不足」になり、手入力で進めます。
- 実際の Claude API での抽出精度・処理時間・費用は、この環境(APIキーなし)では未計測です。`npm run eval` で計測できます(評価の仕組みは単体テストと `--demo` で確認済みで、実 API での実行は未実施)。
- Salesforce の本番実装(REST・Composite API)は、fetch をモックした単体テストのみで、実際の組織への接続は未検証です。見積品目(QuoteLineItem)は作らず、明細は見積の説明欄に入れています。
- 見積書はHTMLのプレビューです(ブラウザの印刷でPDF保存)。Excel出力、仕様書PDFの要求事項抽出(citations)、過去図面の一括取込、保存期間の設定は未実装です。受注・失注・実績原価・手戻りは、Salesforceなどから自動で取り込まず、画面で人が記録します(効果測定用)。導入後の作業時間は、画面の操作時間ではなく登録から承認までの経過時間です。
- 図面上の根拠は「ページ・位置の説明・原文の引用」で示し、図面上の座標の強調表示はしません。
- 標準リードタイムは土日だけを除いた営業日で、祝日と生産負荷は考慮しません。
- ファイル保存は1台のサーバーで動かす前提です(複数台にするときはRDB・オブジェクトストレージの実装に置き換える)。参照データと保存先は実行時の環境変数で決まるため、ビルドのファイルトレース対象から外しています。`next start` 以外(standalone 出力など)で配布する場合は `data/` を一緒に置くか `QUOTE_ASSIST_REFERENCE_DIR` を設定してください。

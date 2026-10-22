# マクロ棚卸し(Excel/VBA・Access 棚卸しツールの画面アプリ)

「作った人が辞めて誰も中身が分からない」Excel マクロ・Access ファイルを読み込み、
マクロの一覧・処理の流れ図・外部とのつながり・リスク・移行の難しさの目安をまとめた仕様書を作る Web アプリです。
解析エンジン(`apps/inventory`)を**ブラウザの中で**動かすので、**ファイルはブラウザの外に出ません**。

- 標準の仕様書(AI なし)は、ブラウザの中だけで完結します(サーバーにファイルも解析結果も送りません)。
- AI で詳しい仕様書を作る機能(AI 版)は、利用者が送信内容を確認して同意したときだけ、抽出済み・伏せ字済みのデータを運営者のサーバー経由で Claude に送ります。サーバーの環境変数がそろったときだけ有効です。

設計と、設計レビューの指摘への対応は [docs/design.md](docs/design.md) にあります。

## 使い方(利用する人向け)

1. ページを開く。まず「サンプルで試す」で、架空の会社のマクロ付きブックを解析して、何が分かるかを見られます。
2. 自分のファイル(.xlsm / .xlsb / .xls / .xlsx / .xlam / .xltm / .accdb / .mdb)を画面にドラッグ&ドロップするか、「ファイルを選ぶ」で選ぶ。1ファイル 200MB まで、**一度に10ファイル(合計 500MB)まで**選べます。複数のファイルは1件ずつ順番に解析し、1件が失敗しても残りは続けます(対応外の形式・空・大きすぎるファイルは、そのファイルだけ「対象外」にします)。
3. 数秒で結果が出ます。
   - **1ファイル**: タブは「概要」「リスク」「処理の流れ」(呼び出し関係図・クエリとテーブルの関係図)「モジュール・処理」「依存関係」「シート」(Excel)「Access」(Access)「仕様書(全文)」。
   - **複数ファイル**: まず「棚卸し一覧」が出ます。ファイルごとの規模・モジュール・シート/テーブル・リスクの件数(高/中/低)・移行難易度の目安・外部依存(他のブック・Access・DB への参照)を表で比べられ、ファイルどうしの参照(ブック A がブック B や Access を参照する)は関係図で見られます。「詳しく見る」でそのファイルの詳細(上のタブ)に切り替わり、「棚卸し一覧に戻る」で一覧に戻れます。一覧は HTML・CSV(表計算ソフト用)・Markdown で保存できます。
4. 「レポートを保存(HTML)」でブラウザで開ける1ファイルの報告書を保存(一覧は「一覧を保存(HTML)」)、「印刷・PDF」で印刷(PDF はブラウザの「PDF に保存」)。技術者向けに Markdown(図は Mermaid)と抽出結果(JSON。CLI で再利用できる)も保存できます。
5. 結果はこのタブのメモリにしかありません。タブを閉じる・再読み込みすると消えます(確認のダイアログを出します)。

解析できないもの: パスワード付きの Access(.accdb)・開くときにパスワードが必要なブック(パスワードを外して保存し直せば解析できます)、Word / PowerPoint のマクロ。

## 起動方法(開発する人向け)

Node.js 22 以上。解析エンジンの依存も使います(`npm run dev` / `npm run build` の前処理で、無ければ `apps/inventory` で `npm ci` します)。

```bash
cd apps/inventory-web
npm install
npm run dev          # 開発サーバー http://localhost:3400
npm run build        # 本番ビルド(前処理で Worker のバンドルとサンプルの取り込みを行う)
npm start            # 手元で本番起動 http://localhost:3401
```

| コマンド | 内容 |
| --- | --- |
| `npm test` | 単体テスト(vitest)。ビルド済み Worker バンドルの動作確認を含む |
| `npm run test:e2e` | E2E(Playwright・Chromium)。本番ビルドを作り、ポート 3410〜3412 で3台起動して確かめる。`PLAYWRIGHT_BROWSERS_PATH` のブラウザを使う(`playwright install` は不要な環境向け) |
| `npm run typecheck` / `npm run lint` | 型チェック / ESLint |
| `npm run build:worker` | 解析 Worker のバンドルだけを作る(`public/engine/inventory-worker-<ハッシュ>.js`) |
| `npm run dev:worker` | エンジンを直しながら開発するとき。Worker を監視ビルドする(ファイル名は固定) |

前処理(`scripts/prepare.mjs`)が作るもの(いずれも git に入れない): `public/engine/`(解析 Worker)、`public/samples/` と `src/generated/samples.json`(`apps/inventory/samples/` の取り込み。manifest が契約に合わなければビルドを止める)、`src/generated/engine-asset.json`。

## 機密性の仕組み

「送らない」を、説明だけでなく仕組みとテストで担保しています。

1. **ファイルを読むのは Web Worker だけ**。画面(メインスレッド)は `File` を Worker に渡すだけで中身を読みません。解析エンジンの実行コードは Worker のバンドルにだけ入れ、画面はエンジンを型としてだけ参照します。
2. **解析 Worker からは、同じサーバーも含めて一切通信できない**(三重の守り):
   - **ブラウザが止める**: 解析 Worker のスクリプト(`/engine/*`)の応答に `default-src 'none'; connect-src 'none'; script-src 'none'; worker-src 'none'` の CSP を付けています。Worker はこの CSP に従うので、`fetch`・`XMLHttpRequest`・`WebSocket`・`EventSource`・Cache API・`importScripts`・`import()`・入れ子の Worker の作成・eval は、送り先が自社サーバーでもブラウザが止めます。
   - **API を消す**: Worker の入口(`src/worker/lockdown.ts`)で、通信・スクリプトの読み込み・保存に使える API を、グローバルだけでなくプロトタイプのすべての段で「呼ぶと失敗する」ものに置き換えます(`fetch`・`XMLHttpRequest`・`WebSocket`・`EventSource`・`WebTransport`・`importScripts`・`Worker`・`SharedWorker`・`caches`・`indexedDB`・`BroadcastChannel` など)。
   - **ビルド時に確かめる**: バンドルに通信の呼び出し・`import(`・`new Worker`・`caches.`・`.prototype.fetch`・`fetch.call` などの書き方が無いことを確かめます(あればビルド失敗。zod が使う `Reflect.apply` だけを理由付きで許可)。
   - E2E で、プロトタイプの `fetch` の呼び出し・入れ子の Worker・`import()`・Cache API・`importScripts` のどれを使ってもサーバーに届かないことを確かめています。
3. **画面側で通信を書ける場所を2つに限定**(ESLint でそれ以外をエラーにする): サンプルの取得(`src/lib/samples.ts`)と、同意後の AI 送信(`src/lib/ai-client.ts`)。計測・エラー監視のライブラリも ESLint で禁止しています。
4. **画面の CSP**: 全ページに `default-src 'self'; connect-src 'self'; worker-src 'self'` などを付け、外部のオリジンを1つも許可しません。画面の fetch などで第三者のサーバーに送ろうとしても、ブラウザが止めます(画面から同一オリジンへの通信はできるため、画面のコードは ESLint で通信の場所を限定しています)。計測タグ・外部フォント・CDN は使いません。外部へのリンクは相談ページ・AI導入診断・プライバシーポリシー・利用規約だけです(通常のリンクで新しいタブで開き、参照元も解析結果も送らない)。
5. **保存しない**: 解析結果は React の状態(メモリ)だけに持ち、URL・localStorage・IndexedDB・Cookie に入れません。
6. **オフラインで動く**: 解析プログラムはファイル名に内容のハッシュを入れて長期キャッシュし(ネットワークを切ってもブラウザのキャッシュから起動できる)、ページを開いた後のアイドル時に予備の Worker を起動しておきます。図の描画に必要な部品も先に読み込みます。ページを開いた後は機内モードでも解析・図・保存まで動きます(顧客先で「本当に送っていないのか」と聞かれたときの実演に使えます)。
7. **E2E で毎回確かめる**: 解析〜保存の間のリクエストが同一オリジンの GET だけで本文が無く、解析を始めた後には「解析の前に読み込んだものと同じ URL」以外の要求(クエリ付きの要求を含む)が1件も無いこと、通常の操作で CSP 違反が画面・Worker とも0件であること、オフラインで解析できること。

CSP で止まらないもの(正直に書いておく): ブラウザの拡張機能はページの内容を読める場合があります。開発者ツールの「キャッシュを無効にする」をオンにしたままネットワークを切ると、2件目以降の解析で解析プログラムを起動できないことがあります(ページを再読み込みしてください)。機密性の高いファイルは、拡張機能を無効にしたウィンドウで使うよう画面でも案内しています。

## AI 版(詳しい仕様書)

### 同意画面で利用者に示すこと

「AIで詳しい仕様書を作る」を押すと、送信内容を Worker で作ってから同意画面を出します。**プレビュー・「送信内容を保存」・実際の送信は同じ文字列**です。

| 区分 | 内容 |
| --- | --- |
| 送らないもの | ファイル本体・セルの値(最初から読んでいない)、元のファイル名(`対象ファイル.xlsm` に置き換え)、ファイルの指紋(SHA-256)・大きさ、文書プロパティの作成者・最終更新者・会社名・タイトル・作成したアプリの名前と版、作成・更新の月日と時刻(年だけ送る)、解析の警告 |
| 伏せ字にして送るもの | エンジンが検出できたパスワード(接続文字列の `Password=`、パスワードらしい名前の変数・定数への代入など)→ `****` |
| そのまま送るもの | VBA のソースコード(コメント・文字列を含む)、Access のクエリの SQL(フォーム・レポートの内部のクエリも含み、件数を別に表示)、シート名・数式の例・名前定義、テーブル名・列名・行数、Access のフォーム・レポート・マクロの名前、リンクテーブルの参照先、シートのボタンの文字、VBA プロジェクト名と参照設定のパス、作成・更新の年、コードから取り出した SQL 文・接続文字列・パス・URL、呼び出し関係、機械検出したリスク。**コード・コメント・数式・パスの中に書かれた氏名・メールアドレス・電話番号・会社名・ファイル名・APIキー・トークン・Webhook の URL** |

- **伏せ字の限界**: 伏せ字はパスワードのパターン検出だけです。API キー・トークン・Bearer・Webhook の URL・`.Item(cdoSendPassword)` 形式のメールのパスワード・コード中の氏名やメールアドレスは伏せられません。そのため、送信内容から、メールアドレス・電話番号・Webhook の URL・キーを含む URL・よく知られたキーの形(`AKIA`・`AIza`・`xox?-`・`ghp_`・`glpat-`・`sk-ant-`・`sk-`)・名前が `…_KEY` / `…Key` / `…Secret` / `…Token` の変数への文字列の代入・`cdoSendPassword` などの語のある行・長いランダムな文字列・個人フォルダのパスを探し、**場所付きで同意画面に一覧表示**します(検出も完全ではないことを明記)。
- 「ソースコード本文とクエリの SQL を送らない」を選べます。ただし、コードから取り出した SQL 文・URL・パスなどの抽出結果は送られます(画面にもそう書いています)。
- 同意のチェックは2つ: 「運営者のサーバーを経由して Anthropic 社(米国)の API に送信することに同意」「このファイルの持ち主(自社または顧客)から外部 AI サービスへの送信の了承を得ている」。送信先の国と、Anthropic 社側で規約に従い保持される場合があることも表示します。運営者名(`NEXT_PUBLIC_OPERATOR_NAME`)、プライバシーポリシー(`NEXT_PUBLIC_PRIVACY_POLICY_URL`)・利用規約(`NEXT_PUBLIC_TERMS_URL`)へのリンクも、設定があれば同意画面に出します。
- 「米国」は送信先の会社(Anthropic, PBC)の所在国です。Claude API の推論の地域は、既定(`default_inference_geo` が `"global"`)では米国外になることもあります。処理を米国内に限るには、Claude Console のワークスペースの設定で `default_inference_geo` を `"us"` にしてください(コードの変更は不要)。設定しない場合は、プライバシーポリシーの記載をそれに合わせます(`docs/legal/README.md`)。
- 大きさ(本文のバイト数・推定入力トークン・要約の依頼回数)はサーバーと同じ計算で同意前に判定し、超えていれば送信できないようにします。

### サーバー側(`/api/ai-document`)

- `GET`: 利用可否(`available` / `mode` / `requiresAccessCode` / 上限 / 同意の版)。秘密を含みません。リクエストごとに環境変数を読みます(再ビルド不要で止められる)。使わない理由(`no_credentials`・`no_privacy_policy` など)は、理由ごとに1回だけサーバーログに警告で出します(`src/lib/server/ai-config.ts`)。
- `POST` の受付順: 有効か(503)→ アクセスコード(403。誤ったコードの試行が送信元ごとに1時間5回・サイト全体で50回に達すると、正しいコードでもしばらく 429)→ 送信元ごとの回数(429)→ Content-Type(415)→ 本文の大きさ(413)→ 形式と同意の版(400 / 409)→ サーバーでも送らない項目を外し直す → 依頼の大きさ(413)→ 1日の回数と推定入力トークン(429)→ 生成。
- 生成はエンジンの `generateAiDocument` と `createClaudeClient`(`claude-opus-5-5`、thinking パラメータは送らず `output_config.effort` を明示、`beta.messages.stream` + `server-side-fallback-2026-07-01`、`stop_reason` と出力の検証)をそのまま使います。応答は NDJSON(`accepted` / `progress` / `heartbeat`(15秒ごと)/ `done` / `error`)。AI 版の仕様書の Markdown は画面の Worker で作ります。
- ログは1リクエスト1行の JSON(結果・件数・処理時間・推定トークン・エラーのクラス名・無効のときの理由)だけ。Claude SDK の例外は、エンジンが公開する SDK(`@engine/doc/ai` の `ClaudeSdk`)を `packages/shared` の `errorClassOf` に渡してクラスで照合します(本番ビルドでクラス名が潰れても `RateLimitError` などで記録される。サーバー専用で、画面のバンドルには入りません)。本文・ファイル名・モジュール名・SQL・AI の出力・IP アドレス・アクセスコードは出しません。データは処理中のメモリだけに置き、保存しません。

### 費用の目安と歯止め

`claude-opus-5-5` は入力 $4・出力 $20(100万トークンあたり)。小さなマクロ(数百行)なら1回あたり数十円程度ですが、上限いっぱい(推定入力 20万トークン・要約8回+統合1回、各最大 32k トークン出力)だと**1回あたり最大で約 7 ドル**になりえます。歯止め:

- claude モードは**アクセスコードが既定で必須**(コンサルタント専用)。アクセスコードは **16文字以上**(短いと AI 版を使いません)。誤ったコードの試行は数えて上限で止めます。匿名で公開するときだけ `INVENTORY_AI_ALLOW_ANONYMOUS=true`。
- 送信元の判定: Vercel 上では Vercel が付ける `x-vercel-forwarded-for` を使います。それ以外は、手前に信頼できるリバースプロキシが1段あるときだけ `INVENTORY_TRUST_PROXY=true` にしてください(`x-forwarded-for` の末尾を使う)。設定しないと、利用者が偽装できる転送元のヘッダーは使わず、全員で1つの枠を共有します(`next start` を直接公開すると、送信元ごとの1時間の回数がサイト全体の回数になります)。
- 送信元ごとの1時間の回数、サイト全体の1日の回数と推定入力トークンの上限。読み取れない設定値は「AI を使わない」側に倒します。
- Vercel 上では共有ストア(Upstash)が無いと claude モードを使いません(インスタンスごとのメモリでは上限にならないため)。共有ストアに接続できないときも受け付けません(フェイルクローズ)。
- 共有ストアのキーに置く送信元(IPアドレス)は、`INVENTORY_RATE_LIMIT_HASH_SECRET` を鍵にした HMAC-SHA256 にします(未設定なら鍵なしの SHA-256 で、本番では警告)。**鍵を設定・変更すると Upstash のキー(`ai-inventory:rl:ai-document:<ハッシュ>`・`ai-inventory:ai-access-fail:src:<ハッシュ>`)が変わり**、その時点で送信元ごとの1時間の回数と誤ったアクセスコードの試行回数は数え直しになります(古いキーは1時間で消える。サイト全体の回数・1日の上限のキーは変わらない)。
- **最後の歯止めとして、Anthropic Console で月の利用上限を必ず設定してください。**

## 環境変数

すべて省略可能です(何も設定しなければ AI 版は出ず、標準の仕様書だけが動きます)。例は [.env.example](.env.example)。

| 環境変数 | 既定 | 内容 |
| --- | --- | --- |
| `NEXT_PUBLIC_CONTACT_URL` | — | 相談ページ(未設定なら出さない)。フッターと、結果画面の下の「次の一歩」(「移行や改善を相談する」)に出す。**ビルド時**に埋め込まれる |
| `NEXT_PUBLIC_DIAGNOSIS_URL` | — | AI導入診断(`apps/diagnosis`)のページ。結果画面の下の「次の一歩」(「自社のAI活用の余地を無料診断する」)に出す(未設定なら出さない)。**ビルド時**に埋め込まれる |
| `NEXT_PUBLIC_PRIVACY_POLICY_URL` | — | プライバシーポリシー。フッター・同意画面・「仕組みとデータの扱い」に出す。**ビルド時**に埋め込まれる。**`claude` モードでは必須**(未設定ならAI版を使わず、理由をログに出す。判定もビルド時の値で行うので、設定したらビルドし直す) |
| `NEXT_PUBLIC_TERMS_URL` | — | 利用規約。フッターと同意画面に出す(未設定なら出さない)。**ビルド時**に埋め込まれる |
| `NEXT_PUBLIC_OPERATOR_NAME` | — | 運営者名(例:`株式会社〇〇`)。フッターと同意画面に出す(未設定なら出さない)。**ビルド時**に埋め込まれる |
| `INVENTORY_AI_MODE` | `off` | `off` / `mock`(デモ用の固定文章)/ `claude` |
| `ANTHROPIC_API_KEY`(または `ANTHROPIC_AUTH_TOKEN`) | — | `claude` のとき必須 |
| `INVENTORY_AI_ACCESS_CODE` | — | `claude` のときは既定で必須。**16文字以上**(短いと AI 版を使わない)。設定すると mock でも必要 |
| `INVENTORY_AI_ACCESS_FAILURES_PER_HOUR` / `INVENTORY_AI_ACCESS_FAILURES_SITE_PER_HOUR` | 5 / 50 | 誤ったアクセスコードの試行の上限(送信元ごと / サイト全体、1時間) |
| `INVENTORY_TRUST_PROXY` | `false` | 手前に信頼できるリバースプロキシがあるとき `true`(送信元の判定に `x-forwarded-for` の末尾を使う。Vercel では不要) |
| `INVENTORY_AI_ALLOW_ANONYMOUS` | `false` | `true` でアクセスコードなしの `claude` を許す |
| `INVENTORY_AI_PER_HOUR` | 3 | 送信元ごとの1時間の回数 |
| `INVENTORY_AI_DAILY_LIMIT` | 20 | サイト全体の1日の回数(日本時間。失敗も数える)。0 で停止 |
| `INVENTORY_AI_DAILY_INPUT_TOKENS` | 2,000,000 | サイト全体の1日の推定入力トークン |
| `INVENTORY_AI_MAX_INPUT_TOKENS` | 200,000 | 1回の推定入力トークンの上限 |
| `INVENTORY_AI_MAX_BATCHES` | 8 | 1回のモジュール要約の回数の上限 |
| `INVENTORY_AI_MAX_BODY_BYTES` | 4,000,000 | 本文の上限(Vercel の 4.5MB より小さく) |
| `INVENTORY_AI_MOCK_DELAY_MS` | 300 | mock の応答の待ち時間 |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`(`KV_REST_API_URL` / `_TOKEN`) | — | 回数を共有ストアで数える(サーバーレスでは必須) |
| `INVENTORY_AI_REQUIRE_SHARED_STORE` | `false` | Vercel 以外でも共有ストアを必須にする |
| `INVENTORY_RATE_LIMIT_HASH_SECRET` | — | 共有ストアのキーに置く送信元(IPアドレス)の HMAC-SHA256 の鍵。**本番では設定**(例:`openssl rand -hex 32`)。専用の値にする(アクセスコードなどを流用しない)。未設定なら鍵なしの SHA-256(本番では警告)。変えると回数が数え直しになる |
| `INVENTORY_SAMPLES_DIR` | `../inventory/samples` | 「サンプルで試す」の取り込み元 |

## 制約・未実装

設計レビューの段階分けに沿って、まず「公開できる最小」(段階1)を実装しました。

**段階1(実装済み)**: 1ファイルずつの解析、タブ4つ(概要・リスク・処理の流れ・仕様書の全文)、保存(HTML・印刷・Markdown・JSON)、Web Worker(1依頼1Worker・予備1つ・監視タイマー・中止)、オフライン動作、図(自前配信の mermaid・strict・常にライトの配色で白い枠に描く)、CSP と通信箇所の限定、AI 版(同意画面・送信内容の保存・要注意文字列の一覧・ソースを送らない選択、`off` / `mock` / `claude`、アクセスコード、回数制限、1日の上限、NDJSON の進捗、ログ方針)。

**段階2(実装済み)**:

- 複数ファイルの解析(一度に10ファイル・合計 500MB まで。1件ずつ順番に。1件が失敗しても他は続ける。中止すると、終わった分は残す)と「棚卸し一覧」(規模・モジュール・シート/テーブル・リスクの件数・移行難易度の目安・外部依存)
- ファイル間の関係図(ブック → 他のブック・Access・DB。解析したファイルの名前と一致する参照は解析済みのファイルにつなぎ、一致しないものは「未解析」として示す。既存の mermaid の描画を使う)
- 棚卸し一覧の保存(HTML・CSV・Markdown。CSV は Excel で文字化けしない BOM 付き UTF-8 で、式として実行されうる先頭の文字には `'` を付ける)
- 詳細タブ: モジュール・処理(行数・引数・エラー処理・呼び出し元/先・Declare・ソースコード)/ 依存関係(種類ごと・参照設定ライブラリ)/ シート(数式の件数・名前定義・外部リンク・データ接続・ボタンのマクロ)/ Access(テーブル・リンクテーブル・クエリ・リレーションシップ・フォーム等の名前)。大きな結果でも固まらないよう、すべての一覧を「さらに表示」(200件ずつ)にし、モジュールの中身・ソース・SQL・列は開いたときに初めて描く
- AI 版は、段階1どおり1ファイル単位です(一覧からファイルを選んで詳細を開き、そこから AI 版を作ります)

**未実装**:

- 複数ファイルをまとめて AI 版にかけること(AI 版は1ファイルずつ)。一覧に後からファイルを追加すること(解析し直しになります)、複数ファイルの ZIP 一括保存、フォルダごとの投入
- 同意画面での送信内容の全文のタブ表示(今は「送信内容を保存(JSON)」と、要注意文字列の一覧)
- ダークモードでの図の描き直し(図は常にライトの配色で白い枠に描きます)
- 図の「拡大して見る」ダイアログ
- 大きなファイル(展開後 100MB 超のデータシート付きブック、150MB 級の .accdb)での時間・メモリの計測と、それに基づく上限の見直し(今はエンジンの既定の上限+ブラウザでの 200MB・60秒。10ファイルを続けて解析したときのメモリの計測も未実施)。データの多いシートを警告にして VBA だけ解析するモードはエンジン側の今後の課題
- PWA / Service Worker、PDF の直接生成、Word 出力、相談フォーム、アカウント・履歴・共有、ボット対策(Turnstile)、計測
- 確認できているブラウザは Chromium(E2E)だけです。Safari・Firefox・Edge は手動で確認してください(下の「公開前チェック」)

エンジン側の制約(Access のフォーム・レポート・マクロは名前のみ、.xls/.xlsb の数式は件数のみ、静的解析の限界など)は [apps/inventory/README.md](../inventory/README.md) の「制約・未対応」を参照してください。

## 公開方法

### Vercel

1. プロジェクトのルートディレクトリを `apps/inventory-web` にし、「ルートディレクトリ外のファイルをビルドに含める」を有効にする(解析エンジン `apps/inventory` と共通の部品 `packages/shared` を使うため。`next.config.ts` で Turbopack とファイルトレースのルートをリポジトリのルートにしています)。
2. インストールコマンド: `npm ci && npm ci --prefix ../inventory`。ビルドコマンドは既定(`npm run build`。前処理で Worker のバンドルとサンプルを用意)。
3. 環境変数を設定する(上の表)。AI 版を使うなら `INVENTORY_AI_MODE=claude`・`ANTHROPIC_API_KEY`・`INVENTORY_AI_ACCESS_CODE`・Upstash・`INVENTORY_RATE_LIMIT_HASH_SECRET`・`NEXT_PUBLIC_PRIVACY_POLICY_URL` を設定(`NEXT_PUBLIC_TERMS_URL`・`NEXT_PUBLIC_OPERATOR_NAME` も推奨)。`NEXT_PUBLIC_*` を変えたらビルドし直す。
4. `maxDuration` は 300 秒にしています(`src/app/api/ai-document/route.ts`)。生成全体はその手前の 280 秒(`AI_DEADLINE_MS`)、1回の依頼は 240 秒(`AI_REQUEST_TIMEOUT_MS`)で打ち切り、画面に理由を返します(`src/lib/server/ai-document.ts`)。大きなファイルで統合に時間がかかる場合は、プランの上限に合わせて3つをそろえて調整する。

### 公開前チェック

- [ ] **Vercel Toolbar をプロジェクト設定で無効にする**(プレビュー環境に外部のスクリプトが注入され、CSP 違反と「外部を読み込まない」の説明との矛盾になる)
- [ ] Anthropic Console で月の利用上限を設定する(AI 版を使う場合)
- [ ] Upstash(共有ストア)を設定する(AI 版を使う場合。Vercel 上では未設定だと claude モードは無効になる)
- [ ] Claude Console で `default_inference_geo` を決める(`"us"` にすると推論を米国内に限れる。同意画面の「Anthropic 社(米国)」の表記・プライバシーポリシーと合わせる)
- [ ] `NEXT_PUBLIC_PRIVACY_POLICY_URL` を設定してビルドする(AI 版を使う場合。未設定だと claude モードは無効になる)
- [ ] プライバシーポリシーに AI 版の送信(運営者のサーバー経由で Anthropic 社(米国)へ)と保持の扱いを書く。コードやコメントに個人情報が含まれうるため、**個人情報保護法の「外国にある第三者への提供」に当たるかを法務に確認する**
- [ ] Safari・Edge で、サンプルの解析・図・HTML 保存・印刷・オフラインでの解析を手動で確認する
- [ ] `npm test`・`npm run test:e2e`・`npm run lint`・`npm run typecheck`・`npm run build` が通ること

手元のサーバーで動かす場合は `npm run build && npm start`(ポート 3401)。サーバーレスでなければ回数はプロセスのメモリで数えます。

## テスト

- 単体テスト(`src/**/*.test.ts`・`scripts/**/*.test.ts`): Worker の処理(解析・エラーのコード・送信内容・詳細と一覧に使う値)、複数ファイルの事前チェック・外部参照の抽出・関係図・一覧の保存形式(CSV・Markdown・HTML)、**ビルド済み・minify 済みの Worker バンドルそのもの**(エラーのコードが正しいこと、zod が `new Function` を試さないこと、通信の API が使えないこと)、Worker の管理(偽の Worker で予備・中止・監視タイマー・起動失敗)、AI ルート(受付順の各エラー・mock の進捗・中止・サーバーでの伏せ直し・**ログに目印の文字列が出ないこと**)、AI の応答の読み取り(分割された NDJSON・JSON でない 413/504)、Markdown → HTML の無害化、保存ファイル名・単体 HTML、CSP、サンプルの manifest の契約。
- E2E(`e2e/`。テスト用ファイルは `e2e/global-setup.ts` がエンジンのテスト用ヘルパーで作る): サンプル解析 → 結果 → 保存・印刷、全サンプル、Access、**複数ファイル(5件: 解析済み・エラー・対象外が混在)の棚卸し一覧・ファイル間の関係図・HTML/CSV/Markdown の保存・詳細タブ(モジュール・依存関係・シート・Access)・11件の拒否・大きな結果(モジュール300・処理4,500)で「さらに表示」と応答性**、ドラッグ&ドロップ(ドロップゾーンの外も)、キーボード、**解析中にファイル内容が送られないこと(全リクエストを監視。複数ファイル・一覧・詳細・保存・オフラインでも)**、**CSP 違反0件(画面・Worker)**、外部への fetch が止まること、オフライン、壊れたファイル・でたらめなファイル・非対応形式・パスワード付き .accdb のエラー表示、スマホ幅(390px)で横スクロールなし(一覧・詳細タブを含む)、ダーク/ライトのコントラスト(一覧・詳細タブを含む)、AI 同意画面(「そのまま送るもの」・要注意文字列の表示、同意前は送信しない、送信本文にパスワード・作成者・ファイル名・指紋が無い、ソースを送らない選択、アクセスコード違い、中止)、接続できないときのエラーと1日の上限、サーバーログに目印が出ないこと。

## ディレクトリ構成

```
docs/design.md              設計書(末尾に設計レビューへの対応)
docs/design-critique.json   設計レビューの指摘
scripts/
  prepare.mjs               前処理(エンジンの依存・Worker のバンドル・サンプルの取り込み)
  build-worker.mjs          解析 Worker のバンドル(esbuild。通信の API の混入でビルド失敗)
  engine-plugin.mjs         エンジンをブラウザ用にバンドルする esbuild プラグイン(エンジンの build-browser.mjs と同じ処理)
  samples-manifest.mjs / sync-samples.mjs   サンプルの manifest の検証と取り込み
src/
  app/                      / (ツール本体)・/how-it-works(仕組みとデータの扱い)・/api/ai-document
  components/               画面(InventoryApp が状態を持つ)・result/(結果のタブ・棚卸し一覧 InventoryListView・詳細タブ)・AiConsentDialog
  worker/                   解析 Worker(engine.worker.ts は配線だけ、処理は handle.ts。lockdown.ts が通信の API を消す)
  lib/                      Worker の管理・上限・エラーの文言・保存・Markdown の無害化・図・AI の送信と応答の読み取り・外部参照とファイル間の関係図(external-refs)・棚卸し一覧の行と保存形式(inventory-list)
  lib/server/               AI ルートの中身(設定・回数制限・1日の上限・mock・ログ。共通の部品を使うところは、このアプリ用の設定だけを置く)
  shared/                   Worker とサーバーで共有する処理(送らない項目の除外・大きさの見積もり・要注意文字列の検出)
e2e/                        Playwright のテスト
```

ほかのアプリと共通の部品(セキュリティヘッダー・送信元の判定と本文の読み取り・回数制限・1日の上限の数え方・Upstash・例外の種類の取り出し)は、リポジトリ直下の `packages/shared` を `tsconfig.json` の別名 `@idea/shared/*` で取り込んでいます(ビルド不要)。アプリごとの値(`INVENTORY_TRUST_PROXY`・Upstash のキーの接頭辞 `ai-inventory:`(`src/lib/server/kv.ts`)・共有ストアに接続できないときに受け付けないこと・CSP の `worker-src 'self'` と Worker 用の CSP)はこのアプリに置いています。画面側のコードからは `@idea/shared/security-headers` 以外を import できません(ESLint)。共通の部品自体のテストは `packages/shared` で `npm test`。

# 公開手順書(Vercel)

AI導入診断を Vercel で公開するまでの手順です。上から順に進めれば、アカウント作成から独自ドメインでの公開、公開後の確認まで終わります。

- 画面の名前や場所は変わることがあります。見当たらないときは各サービスの公式ドキュメントで同じ名前の設定を探してください。
- 料金・無料枠・上限の数値は変わるので、この手順書には書いていません。申し込む前に各サービスの料金ページで確かめてください。

## 0. 全体像

| 用意するもの | 用途 | 必要度 |
|---|---|---|
| GitHub(リポジトリ `LipeRq/idea`) | ソースコード。Vercel が main への push で自動デプロイする | 必須(用意済み) |
| Vercel(**Pro プラン**) | ホスティング。商用サイトは無料の Hobby プランでは利用規約上使えない | 必須 |
| Anthropic Console | Claude の APIキー。なければ標準レポートで動く | AIを使うなら必須 |
| Upstash(Redis) | 回数制限とAIの1日の上限を、サーバーのインスタンスをまたいで数える | 必須(Vercel では) |
| Cloudflare(Turnstile) | ボット対策。診断と申し込みの送信時に人による操作かを確かめる | 強く推奨 |
| 独自ドメイン(お名前.com など) | `shindan.example.co.jp` のような公開URL | 推奨 |
| Google アナリティクス 4 または Vercel Web Analytics | 開始→完了→申し込みのファネルの計測 | 推奨 |
| Salesforce または Slack | 無料相談の申し込みの送信先(README 参照) | どちらか必須 |

### 費用が膨らまない仕組み

公開フォームから有料の Claude API が呼ばれるので、次の4段で止めます。

1. **ボット対策(Turnstile)**:人による操作と確認できない送信は、AIを呼ぶ前に 403 で断る
2. **送信元ごとの回数制限**:1時間に診断5回・PDF30回・申し込み5回(Upstash で全インスタンス共通に数える)
3. **AIの1日の上限(サイト全体)**:`AI_DAILY_LIMIT` 回を超えたら、AIを呼ばずに標準レポートで返す(数値は同じ。画面に理由を表示する)
4. **Anthropic Console の利用上限**:最後の歯止め。APIキーのあるワークスペースに月の上限を設定する

## 1. アカウントを用意する

### 1-1. Vercel

1. https://vercel.com/signup を開き、「Continue with GitHub」で GitHub アカウントでサインアップする(`LipeRq/idea` にアクセスできるアカウント)
2. チーム(Team)を作り、プランは **Pro** を選ぶ。Hobby は個人の非商用利用に限られるため、自社の集客に使うこのサイトでは Pro にする
3. 「Settings → Billing」で支払い方法を登録する

### 1-2. Anthropic(Claude API)

1. https://console.anthropic.com にログインし、「Settings → Billing」でクレジットを購入する(前払い)
2. 「API Keys → Create Key」で本番用のキーを作る(名前の例:`ai-diagnosis-production`)。表示されたキーは一度しか見られないので、そのまま Vercel に登録する(手順 5)
3. 「Settings → Limits」で、このキーのワークスペースの月の利用上限を設定する。想定を超えた請求を防ぐ最後の歯止めになる

### 1-3. Upstash(Redis)

1. https://console.upstash.com に GitHub か Google でサインアップする
2. 「Redis → Create Database」を押し、次のように作る
   - Name:`ai-diagnosis`(自由)
   - Primary Region:**ap-northeast-1(Tokyo)**(Vercel の関数と同じ地域にする。手順 3)
   - Plan:Free(このサイトの使い方なら無料枠で足りる見込み。1回の診断から申し込みまでで、数十コマンド程度)
3. できたデータベースの画面の「REST API」の欄から `UPSTASH_REDIS_REST_URL` と `UPSTASH_REDIS_REST_TOKEN` をコピーする

> Vercel の「Storage → Marketplace」から Upstash を追加してプロジェクトに接続してもかまいません。その場合は `KV_REST_API_URL` と `KV_REST_API_TOKEN` が自動で登録され、このアプリはそれも読みます。

### 1-4. Cloudflare Turnstile

ドメインのDNSを Cloudflare に移す必要はありません。

1. https://dash.cloudflare.com/sign-up でアカウントを作る
2. 左のメニューの「Turnstile → Add widget(ウィジェットを追加)」を開き、次のように作る
   - Widget name:`ai-diagnosis`
   - Hostname:公開するドメイン(例:`shindan.example.co.jp`)と、Vercel のドメイン(例:`ai-diagnosis.vercel.app`)
   - Widget Mode:**Managed**
   - Pre-clearance:No
3. 表示された **Site Key**(`NEXT_PUBLIC_TURNSTILE_SITE_KEY`)と **Secret Key**(`TURNSTILE_SECRET_KEY`)を控える

手元やプレビュー環境では、Cloudflare が用意しているテスト用のキーを使えます(実際の確認は行われません)。

| 用途 | サイトキー | シークレット |
|---|---|---|
| 常に成功する | `1x00000000000000000000AA` | `1x0000000000000000000000000000000AA` |
| 常に失敗する(断られる画面の確認) | `2x00000000000000000000AB` | `2x0000000000000000000000000000000AA` |

### 1-5. 計測(どちらか1つ)

- **Google アナリティクス 4(GA4)**(無料。ファネルの画面がある)
  1. https://analytics.google.com で「管理 → 作成 → プロパティ」。タイムゾーンは日本、通貨は日本円
  2. 「データストリーム → ウェブ」で公開URLを登録し、**測定ID**(`G-` で始まる)を控える
  3. プライバシーポリシーに、Google アナリティクスを使っていること(Cookie と外部への送信)を書く
- **Vercel Web Analytics**(Cookie を使わない。Pro ならカスタムイベントも見られる。ファネルの画面はない)
  1. Vercel のプロジェクトの「Analytics」タブで「Enable」を押す(プロジェクトを作った後。手順 2)

## 2. Vercel にプロジェクトを作る

1. Vercel のダッシュボードで「Add New… → Project」を押し、GitHub の `LipeRq/idea` を「Import」する(一覧にないときは「Adjust GitHub App Permissions」でこのリポジトリへのアクセスを許可する)
2. 「Configure Project」で次のように設定する
   - Project Name:`ai-diagnosis`(`ai-diagnosis.vercel.app` のURLになる)
   - Framework Preset:**Next.js**(自動で選ばれる)
   - Root Directory:「Edit」を押して **`apps/diagnosis`** を選ぶ(このリポジトリには他のアプリもあるため)
   - Build and Output Settings:変えない(`npm install` → `next build`)
   - Environment Variables:ここでは入れなくてよい(手順 5 でまとめて登録する)
3. 「Deploy」を押す。数分で `https://ai-diagnosis.vercel.app` が表示される(この時点では環境変数がないので、標準レポートで動き、申し込みは受け付けない状態)

### Node.js のバージョン

`apps/diagnosis/package.json` の `engines.node`(`22.x`)が使われます(プロジェクトの設定より優先)。GitHub Actions の CI も同じ値を読みます。上げるときは `package.json` を変えてください。

### 他のアプリだけを変えたときにデプロイしない(任意)

「Settings → Git(または Build and Deployment)→ Ignored Build Step」で「Custom」を選び、次のコマンドを入れると、`apps/diagnosis` が変わっていない push ではビルドを省きます(終了コード0で省略)。

```bash
git diff --quiet ${VERCEL_GIT_PREVIOUS_SHA:-HEAD^} HEAD -- .
```

## 3. 関数(サーバー側の処理)の設定

| 項目 | 設定 | 理由 |
|---|---|---|
| Fluid Compute | 有効のまま(新しいプロジェクトでは既定で有効) | 診断は最長120秒かかる(`src/app/api/diagnose/route.ts` の `maxDuration = 120`)。無効にすると関数の実行時間の上限が短くなり、AIの応答を待ちきれないことがある |
| Function Region | 「Settings → Functions → Function Region」で **Tokyo(hnd1)** | 利用者と Upstash(Tokyo)に近くする |
| 最長の実行時間 | コードで指定済み(診断120秒、PDF・申し込み30秒) | AIは100秒で打ち切り、標準レポートで返す |

- **フォントの同梱**:PDFの日本語フォント(`assets/fonts/*.ttf`)は `next.config.ts` の `outputFileTracingIncludes` でサーバーの成果物に含めています。OGP画像はビルド時に作られます。追加の設定は要りません(公開後の確認 8-3 でPDFが作れることを確かめます)。
- **送信元IP**:回数制限の送信元は、Vercel 上では Vercel が付ける `x-vercel-forwarded-for` で数えます(利用者が送った値は Vercel が上書きするので偽装できません。設定は不要です)。Vercel 以外で動かすときは、信頼できるリバースプロキシを1段だけ手前に置いて `DIAGNOSIS_TRUST_PROXY=true` にすると、`x-forwarded-for` の末尾(そのプロキシが付けた値)で数えます。どちらでもないとき(`next start` を直接公開しているなど)は、偽装できるヘッダーは使わず全員で1つの枠を共有します(回数制限が全体の上限として効きます)。
- **費用の上限(Vercel)**:「Settings → Billing → Spend Management」で月の上限と通知を設定しておくと、アクセスが急増したときの請求を抑えられます。

## 4. AIの1日の上限を決める

`AI_DAILY_LIMIT` は「サイト全体で1日(日本時間)に Claude を呼ぶ回数」です。失敗した呼び出しも数えます。

1. まず仮に `50` などで公開し、自分で数回診断する
2. Anthropic Console の「Usage」で1回あたりの費用を確かめる
3. 「1日に使ってよい金額 ÷ 1回の費用」を上限にする。超えた分は標準レポート(数値は同じ)になり、画面に「本日はAIによる分析の受付数が上限に達したため…」と表示される

上限に達すると、Vercel のログに `本日(YYYY-MM-DD)のAIの呼び出しが上限(N回)に達しました` と1回出ます。AIを止めたいときは `0` にして再デプロイします。

## 5. 環境変数を登録する

Vercel の「Settings → Environment Variables」で登録します。秘密の値は「Sensitive」をオンにします。**値を変えたら「Deployments」で最新のデプロイの「…→ Redeploy」を押して反映**します(`NEXT_PUBLIC_` の値・メタデータ・OGP画像はビルド時に埋め込まれるため)。

### 本番(Production)

| 変数 | 必要度 | 値の例・入れ方 |
|---|---|---|
| `NEXT_PUBLIC_SITE_URL` | 必須 | `https://shindan.example.co.jp`(独自ドメインを付けるまでは `https://ai-diagnosis.vercel.app`)。OGP・canonical・robots・sitemap に使う |
| `REPORT_SIGNING_SECRET` | 必須 | 手元で `openssl rand -hex 32` を実行して出た値(Sensitive) |
| `NEXT_PUBLIC_PRIVACY_POLICY_URL` | 必須 | 自社のプライバシーポリシーのURL |
| `SALESFORCE_ORG_ID` または `LEAD_WEBHOOK_URL` | どちらか必須 | 申し込みの送信先(README の「無料相談の申し込みの送信先」) |
| `ANTHROPIC_API_KEY` | AIを使うなら必須 | 手順 1-2 のキー(Sensitive) |
| `AI_DAILY_LIMIT` | AIを使うなら必須 | 手順 4 で決めた回数(例:`50`)。未設定だと上限なし |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | 必須 | 手順 1-3 の値(トークンは Sensitive)。ないと回数制限とAIの上限がインスタンスごとになり、ほとんど効かない |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY` | 強く推奨 | 手順 1-4 の値(シークレットは Sensitive)。**両方**入れたときだけ有効になる |
| `REPORT_BRAND_NAME` | 推奨 | 運営者名(例:`株式会社〇〇`)。ページのタイトル・フッター・OGP画像・PDFの発行元に出る |
| `NEXT_PUBLIC_ANALYTICS_PROVIDER` | 推奨 | `ga4` または `vercel` |
| `NEXT_PUBLIC_GA_MEASUREMENT_ID` | GA4 なら必須 | `G-XXXXXXXXXX` |
| `NEXT_PUBLIC_CONTACT_URL` | 任意 | 外部の問い合わせ窓口のURL |
| `RATE_LIMIT_DIAGNOSE_PER_HOUR` ほか | 任意 | 回数制限を変えるとき(既定:診断5・PDF30・申し込み5) |
| `DIAGNOSIS_TRUST_PROXY` | Vercel では不要 | Vercel 以外で、信頼できるリバースプロキシの後ろに置くときだけ `true`(`x-forwarded-for` の末尾を送信元にする) |

`LEAD_LOG_ONLY` は本番には入れません(入れると申し込みがログに出るだけで、どこにも届きません)。

### プレビュー(Preview。プルリクエストごとのURL)

プレビューは既定で Vercel のログインが必要な状態で公開され、検索エンジンにも載りません(`VERCEL_ENV=preview` のとき robots で拒否し、`noindex` を付けます)。本番の申し込み先やAIの上限を消費しないよう、本番とは別の値にします。

| 変数 | 値 |
|---|---|
| `REPORT_SIGNING_SECRET` | 本番とは別の乱数 |
| `NEXT_PUBLIC_PRIVACY_POLICY_URL` | 本番と同じ |
| `LEAD_LOG_ONLY` | `true`(申し込みは伏せた内容をログに出すだけ) |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY` | 手順 1-4 の「常に成功する」テスト用のキー |
| `ANTHROPIC_API_KEY` | 入れない(標準レポートで確認する)。AIの文面を確かめたいときだけ入れ、`AI_DAILY_LIMIT` を `5` などにする |
| Upstash | 入れない(本番と同じデータベースを使うと、AIの1日の上限を本番と分け合ってしまう) |

`NEXT_PUBLIC_SITE_URL` は入れなくてかまいません(本番のドメインが自動で使われます)。

## 6. 独自ドメインを付ける

1. Vercel の「Settings → Domains」で「Add」を押し、`shindan.example.co.jp` を入力する
2. 画面に表示されるDNSレコードを、ドメインを管理しているサービス(お名前.com、ムームードメイン、Route 53 など)で登録する
   - サブドメイン(`shindan.example.co.jp`)なら **CNAME**:名前 `shindan`、値は Vercel の画面に表示されたもの(例:`cname.vercel-dns.com`)
   - ドメインそのもの(`example.co.jp`)なら **A**:値は Vercel の画面に表示されたIPアドレス
3. 数分〜数時間で Vercel の画面が「Valid Configuration」になり、HTTPSの証明書も自動で発行される
4. 環境変数 `NEXT_PUBLIC_SITE_URL` を `https://shindan.example.co.jp` に変えて再デプロイする
5. Turnstile のウィジェットの Hostname にこのドメインが入っているか確かめる(手順 1-4)
6. `ai-diagnosis.vercel.app` から独自ドメインへ転送したいときは、「Domains」で `ai-diagnosis.vercel.app` を「Redirect to」独自ドメインにする(任意)

## 7. 計測を設定する

`NEXT_PUBLIC_ANALYTICS_PROVIDER` を設定して再デプロイすると、次のイベントが送られます。未設定なら何も送りません。

| イベント | いつ | 付加情報 |
|---|---|---|
| `diagnosis_start` | フォームに最初に入力したとき(ページを開くたびに1回) | なし |
| `diagnosis_step` | ステップ2(業務にかかる時間)・3(IT環境)に初めて進んだとき | `step`(2・3)、`step_name` |
| `diagnosis_complete` | 結果が表示されたとき(再診断のたびに送る) | `ai_generated`(AIの個別レポートか) |
| `report_download` | PDFをダウンロードしたとき | `report_source`(`ai` / `standard`) |
| `lead_submit` | 無料相談の申し込みが完了したとき | なし |

**個人情報は送りません**。会社名・氏名・連絡先・相談内容・入力した業務時間や人件費は、どのイベントにも含めていません(E2Eテストで確かめています)。ページのURLにも入力内容は入りません。

### GA4 の場合

1. 「管理 → データの表示 → カスタム定義 → カスタムディメンションを作成」で、範囲を「イベント」にして `step`・`step_name`・`ai_generated`・`report_source` を登録する(登録しないとレポートで付加情報を選べない)
2. 公開後に一度申し込みまで進め、「管理 → データの表示 → イベント」に `lead_submit` が出たら「キーイベントとしてマーク」をオンにする(広告やレポートで成果として数えられる)
3. 動作の確認は「レポート → リアルタイム」で行う(反映は数十秒)

### Vercel Web Analytics の場合

プロジェクトの「Analytics」タブの「Events」に、イベントごとの件数が出ます(カスタムイベントは Pro プランの機能)。ファネルの画面はないので、下の式で割合を計算します。

## 8. 公開後の確認チェックリスト

`https://shindan.example.co.jp` を自分のドメインに読み替えてください。

### 8-1. ページ

- [ ] トップページが表示され、ブラウザのタブにアイコン(青地に白い3本の棒)とタイトルが出る
- [ ] スマホでも横にはみ出さずに表示される
- [ ] フッターに運営者名・プライバシーポリシーのリンクが出る
- [ ] 存在しないURL(例:`/abc`)で「ページが見つかりません」が表示され、診断ページへ戻れる
- [ ] Turnstile を設定した場合、ステップ3(IT環境)と申し込みフォームに確認のウィジェットが表示され、成功の表示になる

### 8-2. 診断

- [ ] 最後まで入力して「診断する」を押すと、30秒〜1分で結果が出る
- [ ] APIキーを設定した場合、結果の上に「AIが回答内容をもとに個別に分析したレポートです」と出る(「標準レポートです」なら、Vercel の「Logs」で原因を確かめる)

### 8-3. PDFと申し込み

- [ ] 「PDFをダウンロード」でPDFが保存され、日本語が文字化けせずに開ける。AIのレポートなら総評がAIの文面になっている
- [ ] 申し込むと「お申し込みを受け付けました」と出て、Salesforce にリードができる/Slack に通知が届く

### 8-4. ボット対策・回数制限(Turnstile と Upstash を設定した場合)

- [ ] トークンなしで直接送ると 403 になる(このコマンドも診断1回として数えられる)

  ```bash
  curl -s -o /dev/null -w "%{http_code}\n" -X POST https://shindan.example.co.jp/api/diagnose \
    -H 'content-type: application/json' \
    -d '{"industry":"製造業","employees":"31〜100名","hourlyCost":3000,"taskHours":{"minutes":100},"readiness":{"dataLocation":3,"manuals":3,"aiUsage":3,"itStaff":3,"rules":3,"leadership":3},"goals":[]}'
  # → 403
  ```

- [ ] Upstash の「Data Browser」に `ai-diagnosis:rl:…`(回数制限)と `ai-diagnosis:ai-daily:YYYY-MM-DD`(AIの1日の回数)のキーができている

### 8-5. 検索・SNS向け

- [ ] `https://shindan.example.co.jp/robots.txt` に `Sitemap: https://shindan.example.co.jp/sitemap.xml` がある
- [ ] `https://shindan.example.co.jp/sitemap.xml` に `<loc>https://shindan.example.co.jp/</loc>` がある
- [ ] `https://shindan.example.co.jp/opengraph-image` で共有用の画像(1200×630)が表示される
- [ ] Facebook のシェアデバッガー(https://developers.facebook.com/tools/debug/)にURLを入れると、タイトル・説明・画像が出る。Slack や LINE で自分あてにURLを送っても確かめられる
- [ ] Google Search Console(https://search.google.com/search-console)でドメインを登録し、「サイトマップ」に `sitemap.xml` を送信する(任意)

### 8-6. セキュリティヘッダー

- [ ] 次のコマンドで `content-security-policy`・`x-frame-options: DENY`・`strict-transport-security` などが出る

  ```bash
  curl -sI https://shindan.example.co.jp/ | grep -iE "content-security-policy|x-frame-options|x-content-type-options|referrer-policy|strict-transport-security"
  ```

- [ ] ブラウザの開発者ツールの「Console」に `Content Security Policy` のエラーが出ていない(PDFのダウンロード、Turnstile、計測の各操作の後)

### 8-7. 計測・ログ

- [ ] GA4 の「リアルタイム」(または Vercel の「Analytics → Events」)に、自分の操作のイベントが出る
- [ ] Vercel の「Logs」に `REPORT_SIGNING_SECRET が未設定です`、`AI_DAILY_LIMIT の値…を読み取れない`、`Turnstile は … 両方を設定したときだけ有効` のような設定の警告が出ていない

## 9. ファネルの見方

診断は「開始 → ステップ2 → ステップ3 → 完了 → 申し込み」の順に進みます。見る数字は次の3つです。

| 指標 | 計算 | 低いときに疑うこと |
|---|---|---|
| 開始率 | `diagnosis_start` ÷ ページを見た人数 | ページ上部の説明がわかりにくい、広告や記事と内容が合っていない |
| 完了率 | `diagnosis_complete` ÷ `diagnosis_start` | 入力が多い・難しい。`diagnosis_step` の step 2・3 のどこで減るかを見る(ステップ2の業務時間が多い) |
| 申し込み率 | `lead_submit` ÷ `diagnosis_complete` | 結果の説得力、申し込みフォームの項目、Turnstile の失敗 |

あわせて `report_download` ÷ `diagnosis_complete`(PDFの取得率)と、`diagnosis_complete` の `ai_generated` が `false` の割合(AIの失敗や1日の上限に当たっていないか)も見ます。

- **GA4**:「探索 → ファネルデータ探索」を開き、ステップを次のように作る。「オープンファネル」はオフ、指標は「ユーザー」にする
  1. 開始:イベント名 = `diagnosis_start`
  2. ステップ2:イベント名 = `diagnosis_step` かつ `step` = 2
  3. ステップ3:イベント名 = `diagnosis_step` かつ `step` = 3
  4. 完了:イベント名 = `diagnosis_complete`
  5. 申し込み:イベント名 = `lead_submit`

  「内訳」に `ai_generated` を入れると、AIの個別レポートと標準レポートで申し込み率を比べられる。流入元ごとに見たいときは「内訳」に「セッションの参照元/メディア」を入れる。
- **Vercel Web Analytics**:「Analytics → Events」で期間をそろえてイベントごとの件数を読み、上の表の式で割る。開始・ステップはページを開くたびに1回、完了は再診断のたびに数えるので、完了が開始より多くなることがある(その場合は申し込み率を中心に見る)。

## 10. 運用メモ

- **デプロイ**:`main` に push すると本番、プルリクエストを作るとプレビューが自動でデプロイされます。GitHub Actions(`.github/workflows/diagnosis.yml`)が型チェック・リント・単体テスト・ビルド・E2Eを実行するので、プルリクエストでは緑になってからマージします。
- **ロールバック**:Vercel の「Deployments」で前のデプロイの「…→ Promote to Production」を押すと、すぐに戻せます。
- **AIを止めたい**:`AI_DAILY_LIMIT` を `0` にして再デプロイ(数値は同じ標準レポートで動き続けます)。
- **回数制限を変えたい**:`RATE_LIMIT_DIAGNOSE_PER_HOUR` などを変えて再デプロイ。
- **Upstash や Cloudflare が止まったとき**:回数制限はインスタンス内のメモリでの数え方に、Turnstile は確認を省いて通す動きに切り替わり、サイトは動き続けます。AIの1日の上限だけは、数えられないあいだAIを呼ばずに標準レポートにします(費用を優先)。いずれもログに出ます。
- **CSP**:ページは静的に生成しているため、CSP は `next.config.ts` で固定の値を付けています(Next.js がページに埋め込むスクリプトのため `script-src 'unsafe-inline'` が必要)。Turnstile・GA4 の送信先は、その設定があるときだけ許可します。外部のスクリプトを追加するときは `src/lib/security-headers.ts` に送信先を足してください。

## 11. うまくいかないとき

| 症状 | 確かめること |
|---|---|
| いつも「標準レポートです」になる | `ANTHROPIC_API_KEY` が Production に入っているか。Logs に「AIレポートの生成に失敗しました」があればその内容。画面に「本日は…上限に達した」と出ていれば `AI_DAILY_LIMIT` |
| PDFのAIの文面が標準文面になる | `REPORT_SIGNING_SECRET` が入っているか |
| 申し込みで「現在、フォームからのお申し込みを受け付けられません」 | `SALESFORCE_ORG_ID` か `LEAD_WEBHOOK_URL` が入っているか |
| 「セキュリティ確認が完了していないか、期限が切れています」が出る | Turnstile の Hostname に公開ドメインがあるか。シークレットとサイトキーの組み合わせが正しいか(Logs に `TURNSTILE_SECRET_KEY が正しくない` が出ていないか) |
| ウィジェットが表示されない | `NEXT_PUBLIC_TURNSTILE_SITE_KEY` を入れた後に再デプロイしたか。広告ブロッカーで `challenges.cloudflare.com` が止められていないか |
| SNSで画像やタイトルが古い | `NEXT_PUBLIC_SITE_URL` を変えたら再デプロイしたか。シェアデバッガーで「再取得」する |
| 診断が途中で「通信エラー」になる | Fluid Compute が有効か(関数の実行時間の上限)。Logs のタイムアウトの記録 |

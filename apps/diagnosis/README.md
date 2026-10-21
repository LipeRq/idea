# AI導入診断

業務にかかっている時間とIT環境を入力すると、AIで削減できる業務・削減見込み額・優先施策・3ヶ月のロードマップがわかる無料診断です。結果はPDFでダウンロードでき、そのまま無料相談を申し込めます。

- 数値は決まった計算式で出し、文章だけをClaudeが書きます(`docs/diagnosis-logic.md`)
- PDFレポートと申し込みの設計は `docs/lead-and-report.md`
- 公開(Vercel)の手順、環境変数の登録、公開後の確認、計測のファネルの見方は `docs/deploy.md`

## 動かし方

```bash
npm install
cp .env.example .env.local   # 必要な値を設定(すべて空でも動く)
npm run dev                  # http://localhost:3000
```

| コマンド | 内容 |
|---|---|
| `npm run dev` | 開発サーバー |
| `npm run build` / `npm run start` | 本番ビルドと起動 |
| `npm test` | 単体テスト(vitest。外部への送信はすべてモック) |
| `npm run test:e2e` | E2Eテスト(Playwright。本番ビルドを3200番ポートで起動し、同じビルドをAIの1日の上限に達する設定で3201番でも起動する。`E2E_PORT` で変更可) |
| `npx tsc --noEmit` / `npx eslint src e2e` | 型チェック / リント |

E2Eを初めて動かすときは `npx playwright install chromium` が必要です。E2E は外部のサービスに接続しません(AI・申し込みの送信先・Upstash・Turnstile・計測はすべて無効か、手元で完結する設定)。

GitHub Actions(リポジトリの `.github/workflows/diagnosis.yml`)が、`apps/diagnosis` 配下の変更のたびに `npm ci` → 型チェック → リント → 単体テスト → ビルド → E2E を実行します。

## 環境変数

`.env.example` に一覧があります。`NEXT_PUBLIC_` で始まるものと、メタデータ・OGP画像に使うもの(`NEXT_PUBLIC_SITE_URL`、`REPORT_BRAND_NAME`)はビルド時に埋め込まれるので、変えたらビルドし直してください。本番で必須・任意の区別と Vercel への登録方法は `docs/deploy.md` にあります。

| 変数 | 用途 | 未設定のとき |
|---|---|---|
| `ANTHROPIC_API_KEY` | Claudeで個別のレポート文章を作る | 標準レポート(数値は同じ) |
| `AI_DAILY_LIMIT` | Claude を呼ぶ回数の上限(サイト全体・日本時間の1日)。超えたらAIを呼ばずに標準レポートにし、画面で理由を案内する。`0` ならAIを使わない。**本番では設定** | 上限なし |
| `REPORT_SIGNING_SECRET` | AIの文章の署名。PDFに使う文章が改ざんされていないかを確かめる。**本番では設定**(例:`openssl rand -hex 32`) | プロセスごとの乱数。複数インスタンスや再起動後はPDFのAI文章が標準文面になる |
| `REPORT_BRAND_NAME` | 運営者名。PDFの発行元、ページのタイトル・フッター、OGP画像に出す | PDFは「AI導入診断」、ページには出さない |
| `NEXT_PUBLIC_SITE_URL` | 公開URL(例:`https://shindan.example.co.jp`)。OGP・canonical・robots.txt・sitemap.xml の絶対URLに使う | Vercel の本番ドメイン(`VERCEL_PROJECT_PRODUCTION_URL`)、それもなければ `http://localhost:3000` |
| `NEXT_PUBLIC_PRIVACY_POLICY_URL` | 申し込みフォームの同意欄からリンクするプライバシーポリシー。**本番では設定** | リンクなしの文言 |
| `NEXT_PUBLIC_CONTACT_URL` | 外部の問い合わせ窓口。PDFの申し込み先と、フォームを送れなかったときの案内に使う | PDFには「診断結果画面のフォームから」と書く |
| `SALESFORCE_ORG_ID` ほか | 申し込みを Salesforce に送る(下記) | 使わない |
| `LEAD_WEBHOOK_URL` ほか | 申し込みを Slack などに送る(下記) | 使わない |
| `LEAD_LOG_ONLY` | `true` にすると、本番でも申し込みを(個人情報を伏せて)サーバーログに出すだけにする。検証環境やE2E用 | 本番で送信先がなければ申し込みを受け付けない(503) |
| `RATE_LIMIT_DIAGNOSE_PER_HOUR` | 診断の回数制限(送信元ごと・1時間) | 5 |
| `RATE_LIMIT_REPORT_PER_HOUR` | PDF作成の回数制限 | 30 |
| `RATE_LIMIT_LEAD_PER_HOUR` | 申し込みの回数制限 | 5 |
| `DIAGNOSIS_TRUST_PROXY` | `true` で `x-forwarded-for` の末尾を送信元にする(Vercel 以外で、信頼できるリバースプロキシの後ろに置くときだけ) | 使わない(Vercel 上は `x-vercel-forwarded-for`) |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | 回数制限とAIの1日の上限を Upstash Redis で数える(インスタンスをまたいで効く)。Vercel の Marketplace 経由の `KV_REST_API_URL` / `KV_REST_API_TOKEN` でもよい。**Vercel では設定** | インスタンス内のメモリで数える(サーバーレスではほとんど効かない) |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY` | Cloudflare Turnstile のボット対策。**両方**あるときだけ、診断と申し込みの送信時に確認する | 確認しない(今までどおり) |
| `NEXT_PUBLIC_ANALYTICS_PROVIDER` | 計測の送り先。`ga4` / `vercel` / `debug`(ページの変数とコンソールに出すだけ。手元とE2Eの確認用) | 計測しない |
| `NEXT_PUBLIC_GA_MEASUREMENT_ID` | GA4 の測定ID(`G-` で始まる) | GA4 を使わない |

送信元は、Vercel 上では `x-vercel-forwarded-for`、`DIAGNOSIS_TRUST_PROXY=true`(信頼できるリバースプロキシを1段手前に置いたとき)では `x-forwarded-for` の末尾で判断します。どちらでもないときは、偽装できるヘッダーを使わず全員で1つの枠を共有します(`src/lib/http.ts` の `clientKey`)。

## 無料相談の申し込みの送信先

`SALESFORCE_ORG_ID` と `LEAD_WEBHOOK_URL` は両方設定でき、そのときは両方に送ります(1つでも届けば利用者には完了と表示し、失敗はサーバーログに残します)。どちらもなければ、開発時はサーバーログに個人情報を伏せて出すだけ、本番では申し込みを受け付けません。

### Salesforce(Web-to-Lead)

Salesforce の「Web-to-リード」を有効にし、組織IDを `SALESFORCE_ORG_ID` に設定します。サーバーから送るので、Web-to-リードの設定で reCAPTCHA を必須にしないでください。

送る項目:

| Web-to-Lead の項目 | 内容 |
|---|---|
| `oid` | `SALESFORCE_ORG_ID` |
| `last_name`(姓) | 氏名(フォームは1欄なので、姓と名をまとめて入れる) |
| `company` | 会社名 |
| `email` | メールアドレス |
| `phone` | 電話番号(入力があるときだけ) |
| `description`(説明) | 相談したい内容+診断結果の要約(業種、従業員規模、年間削減見込み額と時間、準備度、優先施策の上位3件) |
| `lead_source` | `SALESFORCE_LEAD_SOURCE`(設定したときだけ) |

診断の値をカスタム項目にも入れたいときは、`SALESFORCE_FIELD_MAP` にJSONで対応付けます。値は Web-to-Lead のフォームで使う項目名(カスタム項目はID。Salesforce が生成するHTMLの `name`)です。

```bash
SALESFORCE_FIELD_MAP='{"industry":"00N5g00000AbCdE","employees":"00N5g00000AbCdF","annualSavedAmount":"00N5g00000AbCdG","readinessScore":"00N5g00000AbCdH","topTasks":"00N5g00000AbCdI"}'
```

| キー | 値 | 例 |
|---|---|---|
| `industry` | 業種 | 製造業 |
| `employees` | 従業員規模 | 31〜100名 |
| `annualSavedAmount` | 年間削減見込み額(円・整数) | 2160000 |
| `annualSavedHours` | 年間削減見込み時間(整数) | 720 |
| `readinessScore` | 準備度(0〜100) | 72 |
| `readinessLevel` | 準備度の段階 | 推進段階 |
| `topTasks` | 優先施策の上位3件 | 1. 議事録・報告書の作成(年216万円) / 2. … |
| `message` | 相談したい内容(説明欄とは別の項目にも入れたいとき) | |

そのほか:`SALESFORCE_WEB_TO_LEAD_URL`(送信先URL。既定は `https://webto.salesforce.com/servlet/servlet.WebToLead`、`encoding=UTF-8` は自動で付く)、`SALESFORCE_DEBUG_EMAIL`(設定すると Salesforce から受信内容のメールが届く。設定の確認用)。

Web-to-Lead は取り込みに失敗しても HTTP 200 を返すことがあります。設定後は一度申し込んで、Salesforce にリードができることを確かめてください。1日に受け付けられる件数にも上限(既定500件)があります。

### Webhook(Slack など)

`LEAD_WEBHOOK_URL` に送信先を設定します。

- Slack の Incoming Webhook(`hooks.slack.com`)なら、申し込み内容と診断結果の要約を本文(`text`)にして送ります。入力に含まれる `<!channel>` などは無効にします。
- それ以外のURLには、次のJSONを送ります。`LEAD_WEBHOOK_FORMAT` に `slack` / `json` を設定すると形式を固定できます。

```json
{
  "type": "lead.created",
  "source": "ai-diagnosis",
  "submittedAt": "2026-10-18T01:00:00.000Z",
  "contact": { "companyName": "…", "name": "…", "email": "…", "phone": "…", "message": "…" },
  "diagnosis": {
    "industry": "製造業", "employees": "31〜100名",
    "annualSavedAmount": 2160000, "annualSavedHours": 720,
    "readinessScore": 100, "readinessLevel": "推進段階",
    "topTasks": [{ "name": "議事録・報告書の作成", "annualSavedAmount": 2160000 }]
  }
}
```

`LEAD_WEBHOOK_SECRET` を設定すると、本文の HMAC-SHA256 を `X-Lead-Signature: sha256=<16進>` ヘッダーに付けます。受け側で同じ鍵で計算して比べてください。

## スパム・乱用・費用対策

公開フォームから有料の Claude API が呼ばれるので、次の順に止めます。どれも環境変数がなければ今までどおりの動き(メモリでの回数制限のみ)です。

- ハニーポット(画面外の欄。入力があれば送ったふりをして破棄)
- 本文の大きさの上限と、各欄の文字数の上限(サーバー側で zod により検証)
- 送信元ごとの回数制限(上記の環境変数で変更可)。Upstash があれば全インスタンス共通に数える(`src/lib/rate-limit.ts`)。キーにはIPアドレスをそのまま置かず、ハッシュにする。Upstash に接続できないときはメモリで数える
- ボット対策(Cloudflare Turnstile、`src/lib/turnstile.ts`)。トークンは `X-Turnstile-Token` ヘッダーで送り、入力の検証のあと・AIを呼ぶ前に確かめる。確認できなければ 403。Cloudflare に接続できないとき(通信エラー・5xx)は利用者を締め出さないよう通す
- AIの1日の呼び出し上限(`AI_DAILY_LIMIT`、`src/lib/ai-quota.ts`)。呼ぶ前に数え(失敗した呼び出しも数える)、超えたら標準レポートで返す(応答に `fallbackReason: "daily_limit"`)。回数を数えられないときは費用を優先してAIを呼ばない

外部への接続は単体テストですべて fetch をモックして確かめています。

## 公開ページとしての設定

- メタデータ(タイトル・説明・OGP・Twitterカード・canonical)は `src/app/layout.tsx`。サイト名・URL・運営者名は `src/lib/site.ts` で環境変数から作る
- OGP画像(1200×630)は `src/app/opengraph-image.tsx` と `twitter-image.tsx`。PDFと同じ Noto Sans JP でビルド時に作る(`src/lib/og-image.tsx`)
- `robots.txt`・`sitemap.xml` は `src/app/robots.ts`・`sitemap.ts`。Vercel のプレビュー環境(`VERCEL_ENV=preview`)では検索エンジンに載せない
- アイコンは `src/app/favicon.ico`・`icon.svg`・`apple-icon.tsx`、404ページは `src/app/not-found.tsx`
- セキュリティヘッダー(CSP、`X-Frame-Options`、`X-Content-Type-Options`、`Referrer-Policy`、`Permissions-Policy`、HSTS)は `next.config.ts` から付ける(`src/lib/security-headers.ts`)。ページを静的に生成しているので nonce は使わず、`script-src` に `'unsafe-inline'` を許可している。Turnstile と GA4 の送信先は、その設定でビルドしたときだけ許可する。zod は eval を試すとCSPの違反が報告されるので、eval を使わない設定にしている(`src/lib/zod-setup.ts`)

## 計測

`src/lib/analytics.ts` の `track()` で、診断の開始・ステップ2と3への到達・完了・PDFのダウンロード・相談の申し込みを送ります(イベント名と付加情報は `docs/deploy.md` の「計測を設定する」)。個人情報(会社名・氏名・連絡先・相談内容・入力した数値)は送りません。送り先は `NEXT_PUBLIC_ANALYTICS_PROVIDER` で選び、Vercel Web Analytics は公式パッケージ(`@vercel/analytics`)、GA4 は gtag.js を使います。

## フォントのライセンス

PDFには Noto Sans JP(`assets/fonts/`)を埋め込んでいます。SIL Open Font License 1.1 で配布されているフォントで、ライセンス全文は `assets/fonts/OFL.txt` にあります。

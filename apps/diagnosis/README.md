# AI導入診断

業務にかかっている時間とIT環境を入力すると、AIで削減できる業務・削減見込み額・優先施策・3ヶ月のロードマップがわかる無料診断です。結果はPDFでダウンロードでき、そのまま無料相談を申し込めます。

- 数値は決まった計算式で出し、文章だけをClaudeが書きます(`docs/diagnosis-logic.md`)
- PDFレポートと申し込みの設計は `docs/lead-and-report.md`

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
| `npm run test:e2e` | E2Eテスト(Playwright。本番ビルドを3200番ポートで起動。`E2E_PORT` で変更可) |
| `npx tsc --noEmit` / `npx eslint src e2e` | 型チェック / リント |

E2Eを初めて動かすときは `npx playwright install chromium` が必要です。

## 環境変数

`.env.example` に一覧があります。`NEXT_PUBLIC_` で始まるものはビルド時に埋め込まれるので、変えたらビルドし直してください。

| 変数 | 用途 | 未設定のとき |
|---|---|---|
| `ANTHROPIC_API_KEY` | Claudeで個別のレポート文章を作る | 標準レポート(数値は同じ) |
| `REPORT_SIGNING_SECRET` | AIの文章の署名。PDFに使う文章が改ざんされていないかを確かめる。**本番では設定**(例:`openssl rand -hex 32`) | プロセスごとの乱数。複数インスタンスや再起動後はPDFのAI文章が標準文面になる |
| `REPORT_BRAND_NAME` | PDFのヘッダー・フッターに出す発行元の名前 | 「AI導入診断」 |
| `NEXT_PUBLIC_PRIVACY_POLICY_URL` | 申し込みフォームの同意欄からリンクするプライバシーポリシー。**本番では設定** | リンクなしの文言 |
| `NEXT_PUBLIC_CONTACT_URL` | 外部の問い合わせ窓口。PDFの申し込み先と、フォームを送れなかったときの案内に使う | PDFには「診断結果画面のフォームから」と書く |
| `SALESFORCE_ORG_ID` ほか | 申し込みを Salesforce に送る(下記) | 使わない |
| `LEAD_WEBHOOK_URL` ほか | 申し込みを Slack などに送る(下記) | 使わない |
| `LEAD_LOG_ONLY` | `true` にすると、本番でも申し込みを(個人情報を伏せて)サーバーログに出すだけにする。検証環境やE2E用 | 本番で送信先がなければ申し込みを受け付けない(503) |
| `RATE_LIMIT_DIAGNOSE_PER_HOUR` | 診断の回数制限(送信元ごと・1時間) | 5 |
| `RATE_LIMIT_REPORT_PER_HOUR` | PDF作成の回数制限 | 30 |
| `RATE_LIMIT_LEAD_PER_HOUR` | 申し込みの回数制限 | 5 |

回数制限はサーバーのメモリで数える簡易版です。複数インスタンスで動かす場合は Redis などに置き換えてください。送信元は `x-forwarded-for` の先頭で判断するので、この値を付け直すリバースプロキシ(Vercel など)の後ろで動かす前提です。

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

## スパム・乱用対策

- ハニーポット(画面外の欄。入力があれば送ったふりをして破棄)
- 本文の大きさの上限と、各欄の文字数の上限(サーバー側で zod により検証)
- 送信元ごとの回数制限(上記の環境変数で変更可)

## フォントのライセンス

PDFには Noto Sans JP(`assets/fonts/`)を埋め込んでいます。SIL Open Font License 1.1 で配布されているフォントで、ライセンス全文は `assets/fonts/OFL.txt` にあります。

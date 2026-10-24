# 自分専用 LINE ボット

自分だけが友だちの LINE ボットです。毎朝ニュースのまとめが届き、打ち合わせのメモを送ると議事録にして返します。
AI は DeepSeek、メモの受け口は Cloudflare Workers(無料プラン)、毎朝のまとめは GitHub Actions で動きます。
仕組みは [docs/design.md](docs/design.md) にあります。

## できること

| 機能 | 内容 |
|---|---|
| 毎朝の情報まとめ | 毎朝7時ごろ、テクノロジー・株式投資・大きいニュース・ヘルスケアの新着を要約して届ける |
| 打ち合わせメモの整理 | テキストか写真1枚を送ると、議事録・宿題・お礼メールの下書きを返す |

## 費用

| 項目 | 費用 |
|---|---|
| LINE・Cloudflare・GitHub Actions | 0円(無料の範囲) |
| DeepSeek | 毎朝のまとめで月30円ほど。メモは1回1円未満(前払いでチャージする) |

## 準備

### 1. LINE

1. [LINE Official Account Manager](https://manager.line.biz/) でアカウントを作る(無料プラン)
2. 「設定」→「Messaging API」を使う設定にする
3. 「設定」→「応答設定」で、応答メッセージをオフ、Webhook をオンにする
4. [LINE Developers](https://developers.line.biz/console/) でチャネルを開き、次を控える
   - チャネル基本設定:**チャネルシークレット**、**あなたのユーザーID**(U で始まる)
   - Messaging API設定:**チャネルアクセストークン(長期)** を発行
5. Messaging API設定の QR コードで、自分の LINE に友だち追加する

### 2. DeepSeek

[DeepSeek Platform](https://platform.deepseek.com/) で API キーを作り、少額をチャージします。

### 3. 毎朝の情報まとめ(GitHub)

1. リポジトリの Settings → Secrets and variables → Actions に登録する
   - `DEEPSEEK_API_KEY`
   - `LINE_CHANNEL_ACCESS_TOKEN`
   - `LINE_USER_ID`
2. Actions → morning-digest → Run workflow を、次の順に実行する
   - `check-sources`:ニュースサイトを読めるか
   - `dry-run`:送らずに、内容をログで見る
   - `send`:自分の LINE に届くか

毎朝の自動実行は、このファイルが **main ブランチ** に入ってから動きます。

### 4. 打ち合わせメモ(Cloudflare)

1. [Cloudflare](https://dash.cloudflare.com/) に無料で登録する
2. Storage & databases → Queues で、`line-bot-memos` という名前のキューを作る
3. Workers & Pages → Create → Import a repository で、このリポジトリを選ぶ
   - Root directory:`my-tools/line-bot`
   - Deploy command:`npx wrangler deploy`(既定のまま)
4. できた Worker の Settings → Variables and Secrets に、**Secret** として登録する
   - `LINE_CHANNEL_SECRET`、`LINE_CHANNEL_ACCESS_TOKEN`、`LINE_USER_ID`、`DEEPSEEK_API_KEY`
5. LINE Developers の Messaging API設定で
   - Webhook URL に `https://line-bot.<あなたのサブドメイン>.workers.dev/webhook` を入れて「検証」する
   - 「Webhookの利用」をオンにする
6. ボットに「使い方」と送り、案内が返れば完了です

## 使い方

- 打ち合わせのあと、メモを送る(スマホの音声入力が早い)
- 手書きメモは写真1枚で送れる(同時に複数枚はまだ読めない)
- 返事は3つ:議事録 / 宿題と確認事項 / お礼メール(長押しでコピー)

情報源や分野を変えるときは `src/morning/sources.ts` を書き換えます。

## 開発

```bash
cd my-tools/line-bot
npm install
npm test                         # テスト(LINE・DeepSeek・RSS は偽物を使う)
npm run typecheck                # 型チェック
npm run build                    # Worker をまとめる(Cloudflare には送らない)
npm run dev                      # Worker を手元で動かす(値は .dev.vars に書く)
npm run sources:check            # ニュースサイトを読めるか確かめる
npm run morning -- --dry-run     # 毎朝のまとめを、送らずに表示する
```

| ファイル | 内容 |
|---|---|
| `src/morning/` | 毎朝の情報まとめ(情報源 `sources.ts`、実行 `cli.ts`) |
| `src/meeting/` | 打ち合わせメモの整理 |
| `src/webhook/handler.ts` | LINE からの受信(署名の確認、自分だけ、返信) |
| `src/worker.ts` | Cloudflare Workers の入口(受信とキューの処理) |
| `src/ai.ts` | DeepSeek の呼び出し |
| `src/line/` | LINE への送信 |
| `wrangler.jsonc` | Cloudflare の設定 |

# 自分専用 LINE ボット

自分だけが友だちの LINE 公式アカウントで、次の2つを行います。設計は [docs/design.md](docs/design.md) を参照してください。

| 機能 | 内容 | 動かす場所 |
|---|---|---|
| 毎朝の情報まとめ | 毎朝7時ごろ、テクノロジー・株式投資・大きいニュース・ヘルスケアの新着を Claude が選んで要約し、LINE に届ける | GitHub Actions(`.github/workflows/morning-digest.yml`) |
| 打ち合わせメモの整理 | LINE にメモ(テキストか手書きメモの写真1枚)を送ると、議事録・宿題・お礼メールの下書きを返す | Vercel(Next.js のルートハンドラー `src/app/api/webhook/route.ts`。画面はなし) |

## 外部に送るもの

| 送り先 | 送るもの |
|---|---|
| ニュースサイト(RSS) | 取得の依頼だけ(公開の RSS を読む) |
| Claude API | 記事の見出しと概要 / 打ち合わせのメモ(テキスト・写真) |
| LINE | 自分に届けるメッセージ。LINE から届くメモ |

ログには件数と処理の種類だけを書き、メモの中身は書きません。

## 準備

上から順に進めます。1〜3は2つの機能で共通です。

### 1. LINE 公式アカウントを作る

1. [LINE Official Account Manager](https://manager.line.biz/) でアカウントを作る(無料のコミュニケーションプラン)
2. 「設定」→「Messaging API」で Messaging API を使う設定にする(プロバイダーは新しく作ってよい)
3. 「設定」→「応答設定」で、**応答メッセージをオフ**、**Webhook をオン**にする(自動応答がボットの返事と混ざらないように)
4. [LINE Developers コンソール](https://developers.line.biz/console/) で、作られたチャネルを開き、次の値を控える
   - 「チャネル基本設定」の **チャネルシークレット** と、いちばん下の **あなたのユーザーID**(U で始まる)
   - 「Messaging API設定」で発行する **チャネルアクセストークン(長期)**
5. 「Messaging API設定」の QR コードを自分の LINE で読み、友だちに追加する

### 2. Claude API のキーを用意する

[Anthropic のコンソール](https://console.anthropic.com/) でキーを作ります。月の利用上限も設定しておくと安心です(費用の目安は `docs/design.md` の 4.2)。

### 3. 毎朝の情報まとめ(GitHub Actions)

1. GitHub のリポジトリの Settings → Secrets and variables → Actions に、次の3つを登録する
   - `ANTHROPIC_API_KEY`
   - `LINE_CHANNEL_ACCESS_TOKEN`
   - `LINE_USER_ID`
2. Actions → morning-digest → Run workflow で、次の順に手動実行して確かめる
   - `check-sources`:情報源を取得できるか(NG のものは `src/morning/sources.ts` で直すか消す)
   - `dry-run`:送らずに、送る内容をログに出す
   - `send`:自分の LINE に届くか
3. あとは毎朝 6:40(日本時間)に動きます。混雑で遅れることがあるので、届くのは7時ごろです

定期実行は、ワークフローのファイルが **main ブランチ** にあるときだけ動きます。

### 4. 打ち合わせメモの整理(Vercel)

1. Vercel で新しいプロジェクトを作り、このリポジトリを読み込む
   - Root Directory:`my-tools/line-bot`
   - Framework Preset:Next.js(ビルドの設定は既定のまま)
   - 「ルートディレクトリの外のソースファイルを含める」を有効のままにする(`packages/shared` を使うため。既定で有効)
2. 環境変数(Production)に、次の4つを登録してデプロイする
   - `LINE_CHANNEL_SECRET`
   - `LINE_CHANNEL_ACCESS_TOKEN`
   - `LINE_USER_ID`
   - `ANTHROPIC_API_KEY`
3. LINE Developers コンソールの「Messaging API設定」で
   - Webhook URL に `https://<プロジェクト名>.vercel.app/api/webhook`(本番の URL)を入れ、「検証」で成功を確かめる
   - 「Webhookの利用」をオンにする
4. 自分の LINE からボットに「使い方」と送り、案内が返ってくれば完了です

Vercel の Hobby プランは個人の非商用に限られます。仕事に使うツールなので、Pro のチーム(診断ツールを置くチームなど)に置いてください。

## 使い方

### 打ち合わせメモ

- 打ち合わせのあと、ボットにメモを送ります。スマホの音声入力で話すのがいちばん早いです
- 手書きのメモやホワイトボードは、写真1枚で送れます(同時に複数枚はまだ読めません)
- 返事は吹き出し3つです:議事録 / 宿題と確認事項 / お礼メール(長押しでコピーしてメールに貼る)
- 20文字より短いテキストや「使い方」には、使い方の案内を返します

### 情報源・分野を変える

`src/morning/sources.ts` を書き換えます。

- 情報源:`SOURCES` に名前・RSS の URL・分野・言語を足す(英語の記事は日本語で要約されます)
- 分野ごとの件数:`CATEGORIES` の `maxItems`
- 選ぶ基準:`READER_PROFILE`(読み手の関心)

変えたら `npm run sources:check` と `npm run morning -- --dry-run` で確かめます。

## 開発

Node.js 22 以上が必要です。

```bash
cd my-tools/line-bot
npm install
npm test                         # 単体テスト(LINE・Claude・RSS は偽物を使う)
npm run typecheck                # 型チェック
npm run sources:check            # 情報源ごとに取得できるかを確認する
npm run morning -- --dry-run     # 送らずに、送る内容を表示する(ANTHROPIC_API_KEY があれば AI で要約)
npm run morning -- --hours 48    # 何時間前までの記事を使うか(既定 24)
npm run build                    # 受け口(Next.js)のビルド
npm run dev                      # 受け口を http://localhost:3500/api/webhook で動かす(LINE から届けるには公開の URL が要る)
```

| ファイル | 内容 |
|---|---|
| `src/morning/` | 毎朝の情報まとめ(情報源 `sources.ts`、RSS の読み取り `feed.ts`、しぼり込み `collect.ts`、Claude `digest.ts`、文面 `format.ts`、流れ `run.ts`、コマンド `cli.ts`) |
| `src/meeting/` | 打ち合わせメモの整理(Claude `notes.ts`、文面 `format.ts`) |
| `src/webhook/handler.ts` | LINE からの受信の処理(署名の検証、自分だけの確認、振り分け、返信とプッシュ) |
| `src/line/` | LINE の送信・返信・読み込み中の表示・画像の取得、吹き出しの組み立て |
| `src/claude.ts` | Claude の呼び出し(構造化出力。出力の検証は `packages/shared`) |
| `src/app/api/webhook/route.ts` | 受け口(Next.js のルートハンドラー)。環境変数を読み、本物の LINE・Claude をつなぐ |

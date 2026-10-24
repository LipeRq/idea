# AIコンサルティング ポートフォリオ

中小企業のAI導入を支援するためのツール群です。
社外に見せるポートフォリオ(公開してよい内容だけで構成)は [portfolio/](portfolio/README.md) を参照してください。

| ディレクトリ | 内容 | 状態 |
|---|---|---|
| `apps/diagnosis` | AI導入診断ツール(集客の入口)。業務時間とIT環境から、削減額・優先施策・3ヶ月ロードマップを出す | MVP実装済み |
| `apps/inventory` | Excel/VBA・Accessの棚卸しツール。マクロや古いDBから仕様書・依存関係・移行提案を作る | 解析エンジン・CLI・デモ用サンプル実装済み |
| `apps/inventory-web` | 棚卸しツールの画面。ファイルをブラウザの外に出さず、ブラウザ内で解析して仕様書を作る(AI版は同意のうえで送信) | 段階1(公開できる最小)実装済み |
| `apps/quote-assist` | 製造業向け「見積アシスト」。引き合いメールと図面PDFから要件・確認事項・類似案件・見積根拠・見積書を作り、Salesforceに登録する。**認証なし・社外公開禁止**(公開するなら Basic 認証必須。本番ビルドは設定がないと 401) | MVP実装済み(デモモード) |
| `packages/shared` | 各アプリが共通で使う部品(セキュリティヘッダー・送信元の判定と本文の読み取り・回数制限・1日の上限の数え方・Upstash・例外の種類の取り出し・Claude の構造化出力の検証) | 各アプリが取り込み済み |
| `docs/manufacturing` | 製造業向けAIエージェントパッケージの業務設計・技術設計 | 設計済み |
| `my-tools` | 自分専用の自動化ツール(日常の面倒な作業を減らす。**社外公開しない**) | アイデア出し中([ideas.md](my-tools/ideas.md)) |

## 共通の部品(packages/shared)

複数のアプリにコピーされていた部品を1か所にまとめたものです。ビルドはせず、TypeScript のソースのまま各アプリが取り込みます。
ワークスペースは使わず、各アプリは今までどおり独立した `package.json` と lockfile を持ちます。

- 取り込み方: Next.js の3アプリは `tsconfig.json` の別名 `"@idea/shared/*": ["../../packages/shared/src/*"]` で import する
  (`next.config.ts` から読み込むファイルだけは相対パス)。解析エンジン(`apps/inventory`)は相対パスで import する
- 共通の部品は実行時の依存(npm パッケージ)を持たない。Claude SDK・zod が要る部分は、アプリが自分の SDK・スキーマを引数で渡す
  (別の実体になると `instanceof` や zod の設定が合わないため)
- アプリごとに違う値(環境変数名・Upstash のキーの接頭辞・CSP に足す送信先・共有ストアに接続できないときの扱いなど)は引数で渡し、
  各アプリの `src/lib`(inventory-web は `src/lib/server`)に置く
- Next.js の3アプリは `turbopack.root` と `outputFileTracingRoot` をリポジトリのルートにしている(ルートの外のファイルは解決されない)。
  **Vercel ではルートディレクトリを `apps/<アプリ>` にしたまま、「ルートディレクトリの外のソースファイルを含める」設定を有効にしておく**
  (既定で有効)
- パッケージ自体のテスト: `npm run test:shared`(初回は `cd packages/shared && npm install`)。
  packages/shared を変えると、各アプリの CI(`.github/workflows/*.yml`)も動く

## 技術スタック

- TypeScript / Node.js 22
- Next.js 16(App Router)、Tailwind CSS v4
- Claude API(`@anthropic-ai/sdk`、モデル `claude-opus-5-5`)

## 診断ツールを動かす

```bash
cd apps/diagnosis
npm install
cp .env.example .env.local   # ANTHROPIC_API_KEY を設定(未設定でも標準レポートで動作)
npm run dev                  # http://localhost:3000
npm test                     # 試算ロジックのテスト
```

試算ロジックの設計は [apps/diagnosis/docs/diagnosis-logic.md](apps/diagnosis/docs/diagnosis-logic.md) を参照。

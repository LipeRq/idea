# AIコンサルティング ポートフォリオ

中小企業のAI導入を支援するためのツール群です。

| ディレクトリ | 内容 | 状態 |
|---|---|---|
| `apps/diagnosis` | AI導入診断ツール(集客の入口)。業務時間とIT環境から、削減額・優先施策・3ヶ月ロードマップを出す | MVP実装済み |
| `apps/inventory` | Excel/VBA・Accessの棚卸しツール。マクロや古いDBから仕様書・依存関係・移行提案を作る | 解析エンジン・CLI・デモ用サンプル実装済み |
| `apps/inventory-web` | 棚卸しツールの画面。ファイルをブラウザの外に出さず、ブラウザ内で解析して仕様書を作る(AI版は同意のうえで送信) | 段階1(公開できる最小)実装済み |
| `apps/quote-assist` | 製造業向け「見積アシスト」。引き合いメールと図面PDFから要件・確認事項・類似案件・見積根拠・見積書を作り、Salesforceに登録する | MVP実装済み(デモモード) |
| `docs/manufacturing` | 製造業向けAIエージェントパッケージの業務設計・技術設計 | 設計済み |

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

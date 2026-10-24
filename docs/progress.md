# 進捗と再開メモ

最終更新:2026-10-24

## main に保存済み(テスト済み)

| 対象 | 内容 |
|---|---|
| `apps/diagnosis` | AI導入診断ツール。PDFレポート、相談申し込み(Salesforce Web-to-Lead / Webhook)、乱用・費用対策、OGP・計測、CI、公開手順書(`docs/deploy.md`)まで完了。公開はアカウント準備待ち |
| `apps/inventory` | 棚卸しツールの解析エンジンとCLI。堅牢化(ファジング)、パスワードの伏せ字、ブラウザ対応まで完了 |
| `apps/quote-assist` | 製造業向け見積アシストのMVP。金額計算の精度、承認ゲート、AI抽出の堅牢化まで検証済み |
| `docs/manufacturing` | 業務設計(`use-cases.md`)と技術設計(`quote-assist-design.md`) |
| `apps/inventory-web`、`apps/inventory/samples` | 棚卸しツールの画面(ブラウザ内解析、複数ファイルの一覧と詳細タブ、標準の仕様書、AI版は同意制)とデモ用サンプル4本 |
| `apps/quote-assist` の効果測定ダッシュボード、`docs/evals.md` と各アプリの評価スクリプト、`portfolio/`、`docs/legal/`、`packages/shared`、ツール間の導線 | いずれも実装・検証済み(詳細は各README) |
| `docs/manufacturing/demo`、`docs/manufacturing/sales` | 見積アシストのデモ台本・スクリーンショット・録画スクリプト(`npm run demo:record`)と営業資料8点。批判レビューの指摘を反映済み |

## 作業途中

- `my-tools/`(自分専用の自動化ツール):アイデア出しの段階。`my-tools/ideas.md` の「面倒な作業の書き出し」をユーザーが埋めて、1本目を選ぶ(推奨は「毎朝の情報まとめ」)

## 最後に残っているもの

- **リポジトリを非公開にする**(ユーザーが GitHub の Settings → Danger Zone で実施)。その後、`portfolio/` を別の公開リポジトリに置く(手順は `portfolio/PUBLISHING.md`。【】の差し込み欄11か所を埋める)
- 診断ツール・棚卸しツールの画面の公開(Vercel・Anthropic・Upstash・Turnstile のアカウントと環境変数。手順は `apps/diagnosis/docs/deploy.md`)
- プライバシーポリシー・利用規約の弁護士確認(`docs/legal/README.md`)
- **実際の Claude API での評価**:APIキーを用意し、`docs/evals.md` の手順で3つのAI部分の品質と費用を測る(出力量の想定・合格の目安・LLM採点と人の採点の一致は、最初の実測で確定する)
- 営業資料の「PoC開始前に必要な実装」(`docs/manufacturing/sales/README.md` 5.4、`poc-plan.md`)を、評価の仕組みの拡張後の内容に更新
- 棚卸しツールの画面の未実装:複数ファイルをまとめたAI版、ZIP/フォルダ投入、大きなファイルの計測、Chromium以外の確認

## ユーザーの判断待ち

- 見積アシスト:提供形態(SaaS/専用環境)、価格の仮説を顧客に出すか、国内でのAI処理、Salesforce側の決め事、認証方式、承認時の確認を必須のままにするか
- 営業資料:`docs/manufacturing/sales/README.md` の「判断が必要なこと」

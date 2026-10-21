# 進捗と再開メモ

最終更新:2026-10-21

## main に保存済み(テスト済み)

| 対象 | 内容 |
|---|---|
| `apps/diagnosis` | AI導入診断ツール。PDFレポート、相談申し込み(Salesforce Web-to-Lead / Webhook)、乱用・費用対策、OGP・計測、CI、公開手順書(`docs/deploy.md`)まで完了。公開はアカウント準備待ち |
| `apps/inventory` | 棚卸しツールの解析エンジンとCLI。堅牢化(ファジング)、パスワードの伏せ字、ブラウザ対応まで完了 |
| `apps/quote-assist` | 製造業向け見積アシストのMVP。金額計算の精度、承認ゲート、AI抽出の堅牢化まで検証済み |
| `docs/manufacturing` | 業務設計(`use-cases.md`)と技術設計(`quote-assist-design.md`) |
| `apps/inventory-web`、`apps/inventory/samples` | 棚卸しツールの画面(段階1:ブラウザ内解析、標準の仕様書、AI版は同意制)とデモ用サンプル4本。段階2(複数ファイル、詳細タブなど)は未実装 |
| `docs/manufacturing/demo`、`docs/manufacturing/sales` | 見積アシストのデモ台本・スクリーンショット・録画スクリプト(`npm run demo:record`)と営業資料8点。批判レビューの指摘を反映済み |

## 作業途中

なし(棚卸しツールの画面は独立検証と修正まで完了)

## 最後に残っているもの

- 3つのツール全体の最終レビューは完了(Claude API の呼び出し方の統一、タイムアウト、見積アシストの誤公開対策(Basic認証必須・セキュリティヘッダー・AIの1日上限)、全アプリのCI、送信元判定とログの統一)
- リポジトリを非公開にする(ユーザーが GitHub の設定で実施)。ポートフォリオとして見せる用には、公開してよい内容だけの別リポジトリを用意する(ルートREADMEの拡充、スクリーンショット、技術的な工夫の説明)
- 診断ツール・棚卸しツールの画面の公開(Vercel・Anthropic・Upstash・Turnstile のアカウントと環境変数の準備後)
- 実際の Claude API での動作確認と精度・費用の計測(APIキーの準備後)

## ユーザーの判断待ち

- 見積アシスト:提供形態(SaaS/専用環境)、価格の仮説を顧客に出すか、国内でのAI処理、Salesforce側の決め事、認証方式、承認時の確認を必須のままにするか
- 営業資料:`docs/manufacturing/sales/README.md` の「判断が必要なこと」

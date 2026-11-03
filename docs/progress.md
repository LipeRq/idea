# 進捗と再開メモ

最終更新:2026-11-03

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

| 対象 | 状態 |
|---|---|
| `salesforce`(転職用の Salesforce ポートフォリオ) | 設計書・コード・架空データまで作成済み(ブランチ `salesforce-portfolio`、main には未取り込み)。残りは下の「Salesforce ポートフォリオのやること」 |

棚卸しツールの画面は独立検証と修正まで完了

## Salesforce ポートフォリオのやること

上から順に進める。「担当」は誰が手を動かすか(Claude は次の会話でこの表を読んで再開する)。

| # | やること | 担当 | 状態 |
|---:|---|---|---|
| 1 | 設計書(`salesforce/docs/`)を通して読み、3 年間の実務と食い違う所を直す(面接で自分の言葉で説明できるように) | ユーザー | 未 |
| 2 | 実環境で要確認の 3 点:Data 360 のインサイトの SQL の DMO 項目名(`docs/02-data360.md` の 4)、サイトマップで EC会員ID を送る形(`personalization/sitemap.js`)、配信設定ページの SSJS の関数(`mce/cloudpages/preference-center.html`) | ユーザー | 未 |
| 3 | `salesforce/README.md` の【】を埋める:氏名、製品ごとの実務の経験(業種・規模・役割)、連絡先 | ユーザー | 未 |
| 4 | Developer Edition(Agentforce・Data 360 つき)を作り、メタデータをデプロイして Apex の単体テストを実行する(`docs/08-build-guide.md` の 2)。失敗したら結果を Claude に渡して直す | ユーザー → Claude | 未 |
| 5 | Data 360 の CSV を Ingestion API(バルク)で入れるスクリプトを作る(画面での取り込みが難しければ) | Claude | 未(必要か判断待ち) |
| 6 | Data 360 を構築し、統合プロファイルの数を期待値 1,462 人と、セグメントの人数を `salesforce/data/README.md` と照合する | ユーザー(つまずいたら Claude) | 未 |
| 7 | Sales Cloud のフロー F1〜F3、レポート・ダッシュボードを作る(`docs/03-sales-cloud.md` の 4・6) | ユーザー(作り方は Claude が手順にする) | 未 |
| 8 | Agentforce のエージェントを構築し、テストセンターで 20 件を実行する(`docs/07-agentforce.md`) | ユーザー → Claude | 未 |
| 9 | スクリーンショット 10 枚(`docs/08-build-guide.md` の 6)と、3〜5 分のデモ動画を撮る | ユーザー | 未 |
| 10 | 見せ方を決める(GitHub のみ/GitHub+1 ページのサイト/名前を出すか)。下の「ユーザーの判断待ち」 | ユーザー | 判断待ち |
| 11 | 公開前チェック(`docs/08-build-guide.md` の 7)を通し、別の公開リポジトリに置く | ユーザー+Claude | 未 |
| 12 | ブランチ `salesforce-portfolio` を main に取り込む(PR) | Claude(依頼があれば) | 未 |

## 最後に残っているもの

- **リポジトリを非公開にする**(ユーザーが GitHub の Settings → Danger Zone で実施)。その後、`portfolio/` を別の公開リポジトリに置く(手順は `portfolio/PUBLISHING.md`。【】の差し込み欄11か所を埋める)
- 診断ツール・棚卸しツールの画面の公開(Vercel・Anthropic・Upstash・Turnstile のアカウントと環境変数。手順は `apps/diagnosis/docs/deploy.md`)
- プライバシーポリシー・利用規約の弁護士確認(`docs/legal/README.md`)
- **実際の Claude API での評価**:APIキーを用意し、`docs/evals.md` の手順で3つのAI部分の品質と費用を測る(出力量の想定・合格の目安・LLM採点と人の採点の一致は、最初の実測で確定する)
- 営業資料の「PoC開始前に必要な実装」(`docs/manufacturing/sales/README.md` 5.4、`poc-plan.md`)を、評価の仕組みの拡張後の内容に更新
- 棚卸しツールの画面の未実装:複数ファイルをまとめたAI版、ZIP/フォルダ投入、大きなファイルの計測、Chromium以外の確認

## ユーザーの判断待ち

- Salesforce ポートフォリオの見せ方:GitHub の README だけにするか、同じ Markdown から 1 ページのサイト(GitHub Pages)も作るか。在職中に実名で公開するか(検索に出さない・応募先にだけ URL を渡す、などの選択肢)

- 見積アシスト:提供形態(SaaS/専用環境)、価格の仮説を顧客に出すか、国内でのAI処理、Salesforce側の決め事、認証方式、承認時の確認を必須のままにするか
- 営業資料:`docs/manufacturing/sales/README.md` の「判断が必要なこと」

# 08. 再現の手順と、公開前の確認

自分の無料の組織(Developer Edition)で、このポートフォリオを動く形にする手順です。
**勤務先や顧客の組織・データは使いません。** スクリーンショットにも、架空のデータ以外が写らないようにします。

## 1. 用意するもの

| もの | 備考 |
|---|---|
| Salesforce の Developer Edition(Agentforce と Data 360 が使えるもの) | [Salesforce Developers](https://developer.salesforce.com/signup) から無料で作れる。使える機能と量の上限は、作るときの案内で確認する |
| Salesforce CLI(`sf`) | |
| Node.js 22 以上 | 架空データの生成と Apex の整形の確認に使う |

MCE と Salesforce Personalization は、個人で使える無料の環境がないため、このポートフォリオでは**コードと設計書**で示しています(動く画面はありません)。

## 2. Sales Cloud と Apex

```bash
cd salesforce
npm install
npm run check-data            # 架空データが生成スクリプトと一致しているか
npm run lint:apex             # Apex の構文と書式

sf org login web --alias shizuku
sf project deploy start --source-dir force-app --target-org shizuku
sf apex run test --class-names GiftRecommendationActionTest --class-names CorporateGiftLeadActionTest \
  --code-coverage --result-format human --wait 10 --target-org shizuku

sf org assign permset --name CorporateGiftSales --target-org shizuku
sf apex run --file scripts/apex/seed-products.apex --target-org shizuku   # 商品 29 件と標準価格
sf data import tree --plan data/crm/plan.json --target-org shizuku        # 取引先・取引先責任者・商談・リード
```

画面で行うこと:

1. 商談のフェーズの表示ラベルを変える(API 名はそのまま。[03-sales-cloud.md](03-sales-cloud.md) の 2)
2. リードの項目の対応付け(ギフトの用途・個数・希望のお届け日 → 商談の項目)
3. リードの割り当てルール(個数 100 件以上/未満)
4. フロー F1〜F3([03-sales-cloud.md](03-sales-cloud.md) の 4)を作り、表のテストの観点で確かめる
5. レポートとダッシュボード([03-sales-cloud.md](03-sales-cloud.md) の 6)

## 3. Data 360

1. Data 360 を有効にする
2. Ingestion API のコネクタを作り、[`data360/ingestion-api-schema.yaml`](../data360/ingestion-api-schema.yaml) をアップロードする
3. オブジェクトごとにデータストリームを作る(区分・主キー・発生日時の列は [02-data360.md](02-data360.md) の 1)
4. 数式項目(氏名の異体字・電話番号・共有アドレス)を作る
5. DMO に対応付ける(同 2)
6. CSV を Ingestion API のバルク取り込みで入れる(ジョブを作る → CSV をアップロード → 完了にする)。認証には外部クライアントアプリ(接続アプリケーション)を使う
7. CRM コネクタで Sales Cloud のデータを入れる
8. ID 解決のルールセットを作って実行し、統合プロファイルの数を [`data/README.md`](../data/README.md) の期待値(**1,462 人**)と比べる
9. 計算済みインサイト・セグメントを作り、人数を期待値と比べる

セグメントの期待値は**基準日(2026年10月31日)時点**の人数です。組織で作る日が基準日と違うと「直近 30 日」などの相対的な条件の人数が変わるので、
検算のときは条件を基準日からの日付(例:初回購入日が 2026年10月1日以降)にして確かめ、確かめた後で相対的な条件に戻します。
統合プロファイルの数は日付に関係なく一致するはずです。

## 4. Agentforce

1. Einstein と Agentforce を有効にする
2. エージェントを作り、[07-agentforce.md](07-agentforce.md) の 2 のとおりにトピック(分類の説明・範囲・指示)を作る
3. アクションに Apex の 2 つ(`ギフト商品の候補を探す`・`法人・大口ギフトの相談を登録する`)と、プロンプトテンプレート `Gift_Message_Draft` を加える
4. エージェントのユーザーに権限セット `GiftConcierge_Agent` を割り当てる
5. エージェントビルダーの会話のプレビューで動きを確かめる
6. テストセンターで [`agentforce/tests/gift-concierge-tests.csv`](../agentforce/tests/gift-concierge-tests.csv) を実行する(列名とトピック・アクションの API 名は、組織のテンプレートと作った名前に合わせる)

## 5. うまくいかないとき

| 症状 | 原因と対処 |
|---|---|
| Apex のテストで `LICENSE_LIMIT_EXCEEDED` | テストはユーザーを 1 人作って権限セットを割り当てる。Salesforce のライセンスに空きが 1 つ要るので、使っていないユーザーを無効にする |
| `sf data import tree` で商談のフェーズの値のエラー | 架空データは標準のフェーズの API 名(`Prospecting`・`Closed Won` など)を使っている。組織の商談フェーズの API 名を確認し、違えば合わせる |
| 統合プロファイルの数が期待値と違う | `data/README.md` の内訳の表と、どの種類のケースがずれているかを突き合わせる(異体字の数式項目・共有アドレスの除外・一致ルールの順番) |
| エージェントが Apex のアクションを呼べない | エージェントのユーザーに権限セット `GiftConcierge_Agent` があるか(Apex クラスへのアクセスと項目の権限を含む) |

## 6. スクリーンショット

`screenshots/` に置き、README の「画面」の表に差し込みます。

| ファイル名 | 写すもの |
|---|---|
| `data360-01-identity-resolution.png` | ID 解決の結果(統合前後の件数・一致ルール) |
| `data360-02-unified-profile.png` | EC・店舗・法人の 3 つがまとまった 1 人のプロファイル |
| `data360-03-segment.png` | セグメント(S2 など)の条件と人数 |
| `sales-01-pipeline.png` | 用途・年ごとのパイプラインのダッシュボード |
| `sales-02-lead-from-agent.png` | エージェントが作ったリード(相談の経路・要約) |
| `agent-01-gift-selection.png` | ギフト選びの会話(候補 3 件) |
| `agent-02-corporate.png` | 法人の相談 → 復唱 → 登録の会話 |
| `agent-03-guardrail.png` | 健康効果を聞かれて断る/指示の無視を断る会話 |
| `agent-04-testing-center.png` | テストセンターの結果 |
| `apex-01-test-result.png` | Apex のテストの結果とカバー率 |

写す前に確かめること:ブラウザのタブ・ブックマーク・通知に私的な情報がないこと、組織の ID・ユーザー名・メールアドレスが写っていないこと。

## 7. 公開前の確認

このフォルダ(`salesforce/`)は、そのまま別の公開リポジトリに置けるように作っています。

```bash
cd salesforce
grep -rn "【" README.md docs/                      # 差し込み欄が残っていないこと
grep -rnE "00D[0-9A-Za-z]{12}|sk-ant-" . --exclude-dir=node_modules || echo "なし"   # 組織 ID・API キーがないこと
grep -rni "<勤務先のメールのドメイン>" . --exclude-dir=node_modules || echo "なし"     # 勤務先・顧客の名前やドメインでも検索する
npm run check-data && npm run lint:apex
```

- [ ] 差し込み欄(【】)をすべて埋めた。書けない経験は、行ごと消すか一般的な書き方にした
- [ ] 実在の会社名・顧客名・案件の数字が入っていない(勤務先・顧客の守秘義務)
- [ ] KPI の数字を「実績」のように書いていない(目標・架空データの値と明記)
- [ ] スクリーンショットに架空のデータ以外が写っていない
- [ ] GitHub に置いた後、README の図(Mermaid)とリンクが表示されることを確かめた

公開のしかた:

```bash
# 元のリポジトリの外で、このフォルダの中身だけを新しいリポジトリにする(元のリポジトリの履歴を持ち込まない)
cp -r salesforce ~/salesforce-portfolio
cd ~/salesforce-portfolio
rm -rf node_modules
git init && git add . && git commit -m "Salesforce ポートフォリオ"
git remote add origin https://github.com/<アカウント>/<リポジトリ名>.git
git push -u origin main
```

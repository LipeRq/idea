# 公開の手順

このディレクトリ(`portfolio/`)は、中身をそのまま別の公開リポジトリに置けるように作っています。
ほかのディレクトリへのリンクはなく、画像もすべて `screenshots/` に入っています。
この手順書(PUBLISHING.md)は公開しても差し支えない内容にしてありますが、載せたくない場合はコピーするときに除いてください。

## 1. 公開前チェックリスト

公開する前に、元のリポジトリの `portfolio/` で次を確認します。

### 差し込み欄

- [ ] 差し込み欄(【 】で囲んだ箇所)をすべて埋めた(下のコマンドで残りがないことを確認)
  - README.md:氏名、会社名、メールアドレス、Web サイト URL、問い合わせフォーム URL、デモ URL(公開しない場合は行ごと消す)、
    著作権者、発行年、ライセンス、ソースコードの閲覧の相談先
- [ ] 公開しないデモの行(オンラインで試す)は、URL の欄を残さず消した

```bash
cd portfolio
grep -n "【" README.md architecture.md   # 何も出なければよい
```

### 社内資料が混ざっていないか

- [ ] 営業資料・提案書のひな形・進捗メモ・法務の確認メモの文章や数字を写していない(README には「営業資料一式あり(非公開)」とだけ書く)
- [ ] 提供条件・費用の見込み・採算に関する数字が入っていない
- [ ] 次のコマンドで何も出ない(社内向けの言葉が入っていないかの確認)

```bash
cd portfolio
grep -rnE "価[格]|原[価]|損益分[岐]|社内メ[モ]|粗[利]|仮[説]|想定問[答]" . --include=*.md
```

- [ ] ソースコード・`.env` ファイル・API キー・トークン・Salesforce の組織 ID が入っていない

```bash
cd portfolio
ls -R                                                 # README.md・architecture.md・PUBLISHING.md と screenshots/*.png 以外がないこと
grep -rnE "sk-ant-|ANTHROPIC_API_KEY=.+|00D[0-9A-Za-z]{12}" . || echo "なし"
```

### スクリーンショット

- [ ] すべての画像に、架空のデモデータ以外が写っていない(実在の会社名・人名・顧客のファイル・メールアドレス・自分の PC の通知やブラウザのタブなど)
  - AI導入診断:架空の「サンプル工業(架空)」の入力
  - マクロ棚卸し:同梱の架空のサンプル(在庫引当マクロ)。画面のメールアドレスは `example` ドメインの架空のもの
  - 見積アシスト:架空の加工会社「株式会社しらかば精工」のデモデータ
- [ ] 画面の数字(削減見込み額・見積金額など)が架空のデータによる試算であることを、README の冒頭と各画面の注記で書いている
- [ ] 画像を差し替えた場合は、README の画像のリンクと説明文(代替テキスト)を合わせた

### 表現

- [ ] 導入実績や効果を、事実のように書いていない(効果は「試算」「想定」と書く)
- [ ] 「必ず」「完全自動」「100%」のような言い方をしていない

### リンク

- [ ] README・architecture.md の相対リンクと画像がすべて開ける(GitHub に push した後、ブラウザで README を開いて確認する。Mermaid の図が表示されることも確認)

## 2. 公開の手順(GitHub)

### 2.1 新しいリポジトリを作る

1. GitHub で「New repository」を開く
2. リポジトリ名を決める(例:`ai-tools-portfolio`)。公開範囲は **Public**
3. 「Add a README file」「.gitignore」「license」は**付けない**(このフォルダの README と衝突しないように、空のリポジトリにする)
4. 「Create repository」を押し、表示される URL(`https://github.com/<アカウント>/<リポジトリ名>.git`)を控える

GitHub CLI を使う場合は、次のコマンドでも作れます。

```bash
gh repo create <アカウント>/<リポジトリ名> --public
```

### 2.2 このフォルダの中身をコピーする

元のリポジトリの履歴を持ち込まないよう、**フォルダの中身だけ**を新しい場所にコピーし、そこで新しく git を始めます。

```bash
# 元のリポジトリの外に作業用のフォルダを作る
mkdir ~/ai-tools-portfolio
cp -R <元のリポジトリ>/portfolio/. ~/ai-tools-portfolio/

# この手順書を載せない場合
# rm ~/ai-tools-portfolio/PUBLISHING.md

cd ~/ai-tools-portfolio
ls -R    # README.md・architecture.md・(PUBLISHING.md)・screenshots/ だけであることを確認
```

### 2.3 push する

```bash
cd ~/ai-tools-portfolio
git init
git add .
git status                       # 追加されるファイルを目で確認する
git commit -m "ポートフォリオを公開"
git branch -M main
git remote add origin https://github.com/<アカウント>/<リポジトリ名>.git
git push -u origin main
```

### 2.4 公開後に確認する

- [ ] GitHub のリポジトリのページで README が表示され、画像と Mermaid の図が出ている
- [ ] 目次のリンク(3つのツールの表)で各節に移動できる
- [ ] リポジトリの「About」に説明文と Web サイトの URL を入れた(任意)
- [ ] 元のリポジトリは非公開のままになっている

## 3. 内容を更新するとき

元のリポジトリの `portfolio/` を直してから、上のチェックリストをもう一度確認し、公開リポジトリにコピーして push します。

```bash
cp -R <元のリポジトリ>/portfolio/. ~/ai-tools-portfolio/
cd ~/ai-tools-portfolio
git add .
git status
git commit -m "ポートフォリオを更新"
git push
```

スクリーンショットを撮り直すときは、各アプリを API キーなしのデモモードで起動し(README の「手元で動かす」)、ライトモード・幅 1280px で撮ります。1 枚 300KB 程度に収めます。

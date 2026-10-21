import type { Metadata } from "next";
import Link from "next/link";
import { ExternalLink } from "@/components/ExternalLink";
import { ANTHROPIC_PRIVACY_URL, DESTINATION_TEXT, RETENTION_TEXT } from "@/lib/ai-consent";
import { privacyPolicyUrl } from "@/lib/site";

export const metadata: Metadata = {
  title: "仕組みとデータの扱い",
  description: "ファイルをブラウザの中だけで解析する仕組みと、送信しないもの・AI版を使うときに送るもの、自分で確かめる方法を説明します。",
};

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="rounded-xl border border-line bg-surface p-4 sm:p-6">
      <h2 id={id} className="text-lg font-bold">
        {title}
      </h2>
      <div className="mt-3 space-y-2">{children}</div>
    </section>
  );
}

export default function HowItWorks() {
  const privacy = privacyPolicyUrl();
  return (
    <main className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">仕組みとデータの扱い</h1>
        <p className="mt-2 text-ink-2">
          このツールは、解析のプログラムをお使いのブラウザに読み込み、ファイルの解析をすべてブラウザの中で行います。ファイルはサーバーに送信しません。
        </p>
      </div>

      <Section id="hw-how" title="1. 仕組み">
        <figure>
          <svg viewBox="0 0 640 220" role="img" aria-labelledby="hw-figure-title" className="h-auto w-full max-w-2xl">
            <title id="hw-figure-title">サーバーは画面と解析プログラムを配るだけで、ファイルはパソコンのブラウザの中で解析される図</title>
            <rect x="8" y="8" width="420" height="204" rx="12" fill="none" stroke="currentColor" strokeWidth="2" />
            <text x="24" y="36" fontSize="16" fill="currentColor">
              あなたのパソコン(ブラウザ)
            </text>
            <rect x="28" y="60" width="150" height="56" rx="8" fill="none" stroke="currentColor" />
            <text x="44" y="94" fontSize="14" fill="currentColor">
              Excel / Access
            </text>
            <rect x="250" y="60" width="160" height="56" rx="8" fill="none" stroke="currentColor" />
            <text x="262" y="84" fontSize="14" fill="currentColor">
              解析プログラム
            </text>
            <text x="262" y="104" fontSize="12" fill="currentColor">
              (ブラウザの中で実行)
            </text>
            <line x1="178" y1="88" x2="246" y2="88" stroke="currentColor" strokeWidth="2" markerEnd="url(#arrow)" />
            <text x="40" y="160" fontSize="13" fill="currentColor">
              結果(仕様書・図)はこの画面に表示し、
            </text>
            <text x="40" y="180" fontSize="13" fill="currentColor">
              保存するとパソコンに書き出します
            </text>
            <rect x="480" y="60" width="150" height="56" rx="8" fill="none" stroke="currentColor" />
            <text x="492" y="84" fontSize="14" fill="currentColor">
              運営者のサーバー
            </text>
            <text x="492" y="104" fontSize="12" fill="currentColor">
              画面とプログラムを配る
            </text>
            <line x1="478" y1="100" x2="414" y2="100" stroke="currentColor" strokeWidth="2" markerEnd="url(#arrow)" />
            <defs>
              <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto">
                <path d="M0,0 L10,5 L0,10 z" fill="currentColor" />
              </marker>
            </defs>
          </svg>
        </figure>
        <p>ページを開いたときに、画面と解析プログラムを運営者のサーバーから受け取ります。その後の解析・図の作成・保存は、すべてブラウザの中で行います。</p>
      </Section>

      <Section id="hw-not-sent" title="2. 送信しないもの">
        <ul className="list-disc space-y-1 pl-5">
          <li>ファイル本体</li>
          <li>シートのセルの値(データ本体。そもそも読み取りません)</li>
          <li>解析結果・仕様書(AI版を使わない限り、どこにも送りません)</li>
        </ul>
        <p>解析結果はこのタブのメモリの中だけにあり、タブを閉じると消えます。ブラウザの保存領域(localStorage など)・Cookie・URL にも残しません。計測タグ・外部のフォント・外部のスクリプトは使っていません。</p>
        <p>
          ページには、外部のサーバーへの通信(fetch など)をブラウザに止めさせる設定(Content-Security-Policy)を付けています。外部へのリンクは、相談ページとプライバシーポリシーだけです。
        </p>
      </Section>

      <Section id="hw-verify" title="3. 自分で確かめる方法">
        <ol className="list-decimal space-y-1 pl-5">
          <li>このツールのページを開き、少し待ちます(解析プログラムと図の部品を読み込みます)。</li>
          <li>パソコンを機内モードにする、または Wi-Fi を切ります。</li>
          <li>ファイルを選んで解析します。ネットワークが無くても、解析・図の表示・保存まで動きます(AI版とサンプルの読み込みは除きます)。</li>
        </ol>
        <p>または、ブラウザの開発者ツール(F12 キー)の「ネットワーク」タブを開いたまま解析し、ファイルの中身が送られていないことを確認できます。解析プログラムは、ブラウザの機能で一切の通信を禁止した状態で動きます。解析中に表示されるのは、解析プログラム自体の読み込み(「/engine/」で始まる行。ブラウザに保存済みのものを使います)だけで、ファイルの中身を含む通信はありません。</p>
      </Section>

      <Section id="hw-ai" title="4. AI版を使うときに送るもの">
        <p>
          AI で詳しい仕様書を作る機能(AI版)を使うときだけ、確認画面で示した内容を送信します。送信は、利用者が内容を確認して同意したときだけです。
        </p>
        <h3 className="pt-2 font-semibold">送らないもの</h3>
        <ul className="list-disc space-y-1 pl-5">
          <li>ファイル本体・セルの値</li>
          <li>元のファイル名(「対象ファイル.xlsm」のように置き換えます)・ファイルの指紋(SHA-256)・ファイルの大きさ</li>
          <li>文書の情報に記録された作成者・最終更新者・会社名・タイトル・作成したアプリの名前と版、作成・更新の月日と時刻(年だけ送ります)</li>
        </ul>
        <h3 className="pt-2 font-semibold">伏せ字にして送るもの</h3>
        <ul className="list-disc space-y-1 pl-5">
          <li>検出できたパスワード(接続文字列の Password= や、パスワードらしい名前の変数への代入など)を「****」にします</li>
        </ul>
        <h3 className="pt-2 font-semibold">そのまま送るもの</h3>
        <ul className="list-disc space-y-1 pl-5">
          <li>マクロ(VBA)のソースコード(コメント・文字列を含む)・Access のクエリの SQL(送らない選択もできます)</li>
          <li>シート名・数式の例・名前定義・テーブル名・列名・行数・接続文字列・ファイルのパス・URL</li>
          <li>Access のフォーム・レポート・マクロの名前とその内部のクエリ、リンクテーブルの参照先、シートのボタンに表示された文字、VBA プロジェクトの名前と参照設定のパス、作成・更新の年</li>
          <li>
            コード・コメント・数式・パスの中に書かれた氏名・メールアドレス・電話番号・会社名・ファイル名・APIキー・トークン・Webhook の URL(伏せ字の対象外です。確認画面に、見つかったものを場所付きで表示します)
          </li>
        </ul>
        <p className="pt-2">{DESTINATION_TEXT}</p>
        <p>
          {RETENTION_TEXT}
          <ExternalLink href={ANTHROPIC_PRIVACY_URL} className="ml-1 text-accent-ink underline underline-offset-2">
            Anthropic 社の規約
          </ExternalLink>
        </p>
        <p className="font-semibold">個人情報を含むコードは送らないでください。顧客から預かったファイルは、外部の AI サービスへの送信について了承を得てからお使いください。</p>
        {privacy && (
          <p>
            <ExternalLink href={privacy} className="text-accent-ink underline underline-offset-2">
              プライバシーポリシー
            </ExternalLink>
          </p>
        )}
      </Section>

      <Section id="hw-notes" title="5. ご注意">
        <ul className="list-disc space-y-1 pl-5">
          <li>ブラウザの拡張機能は、ページの内容を読める場合があります。機密性の高いファイルは、拡張機能を無効にしたウィンドウ(シークレットウィンドウなど)でお使いください。</li>
          <li>パスワードの伏せ字はパターンによる検出です。変数を組み立てて作る接続文字列や、文章で書かれたパスワードは伏せられないことがあります。</li>
        </ul>
      </Section>

      <Section id="hw-limits" title="6. 解析できないもの・制約">
        <ul className="list-disc space-y-1 pl-5">
          <li>パスワード付きの Access ファイル(.accdb)と、開くときにパスワードが必要なブックは解析できません。パスワードを外して保存し直してからお使いください。</li>
          <li>Access のフォーム・レポート・マクロは名前の一覧だけです(画面のレイアウトやマクロの中身は解析しません)。フォーム・レポートの VBA は解析します。</li>
          <li>.xls / .xlsb は数式の件数だけを数えます(式の内容は取り出しません)。</li>
          <li>呼び出し関係は静的な解析です。文字列を組み立てて実行するマクロ名などは検出できないことがあります。</li>
          <li>Word / PowerPoint のマクロは対象外です。</li>
        </ul>
      </Section>

      <p>
        <Link href="/" className="text-accent-ink underline underline-offset-2">
          ツールに戻る
        </Link>
      </p>
    </main>
  );
}

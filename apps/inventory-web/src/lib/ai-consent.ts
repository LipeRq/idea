// AI 版の同意の版と文言(画面とサーバーで共有する)。文言を変えたら CONSENT_VERSION も変える。
// サーバーは送られてきた consentVersion が現行と違えば受け付けない(古いタブの画面で同意した内容で送らないため)。

export const CONSENT_VERSION = "2026-10-20";

export const CONSENT_SEND_LABEL = "上に示した内容を、運営者のサーバーを経由して Anthropic 社(米国)の API に送信することに同意します";
export const CONSENT_OWNER_LABEL =
  "このファイルの持ち主(自社または顧客)から、外部の AI サービスへの送信について了承を得ています";

export const DESTINATION_TEXT =
  "送信先: 運営者のサーバー(Vercel のサーバー。リージョンは運営者の設定による)を経由して、Anthropic 社(米国)の API(Claude)に送ります。";
export const RETENTION_TEXT =
  "運営者のサーバーには保存しません(処理中のメモリだけで扱い、ログにも内容を残しません)。Anthropic 社では、同社の規約に従って一定期間保持される場合があります。";
export const ANTHROPIC_PRIVACY_URL = "https://www.anthropic.com/legal/commercial-terms";

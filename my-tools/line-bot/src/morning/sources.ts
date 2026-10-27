// 毎朝の情報まとめの分野・情報源・読み手の関心。足し引きはこのファイルを書き換えるだけでよい。
//
// URL は 2026-10 に検索で確かめたもの。開発環境からは取得できなかったので、
// 最初に `npm run sources:check`(GitHub Actions なら手動実行の「情報源の確認」)で取得できるかを確認する。
// 取得できない情報源は飛ばして、まとめの最後に名前を出す(ほかの情報源には影響しない)。

// 分野を足すときは、CategoryKey と CATEGORIES の両方に書く(吹き出しは要点 + 分野で5つまで。超えた分は最後の吹き出しにつなげる)
export type CategoryKey = "tech" | "markets" | "major" | "health";

export interface Category {
  key: CategoryKey;
  label: string;
  /** この分野から選ぶ記事の上限 */
  maxItems: number;
}

export const CATEGORIES: readonly Category[] = [
  { key: "tech", label: "テクノロジー", maxItems: 4 },
  { key: "markets", label: "株式投資", maxItems: 4 },
  { key: "major", label: "大きいニュース", maxItems: 4 },
  { key: "health", label: "ヘルスケア", maxItems: 4 },
];

export interface Source {
  name: string;
  url: string;
  category: CategoryKey;
  /** 英語の記事は AI が日本語で要約する */
  language: "ja" | "en";
}

export const SOURCES: readonly Source[] = [
  // テクノロジー
  { name: "Yahoo!ニュース IT", url: "https://news.yahoo.co.jp/rss/topics/it.xml", category: "tech", language: "ja" },
  { name: "ITmedia NEWS", url: "https://rss.itmedia.co.jp/rss/2.0/news_bursts.xml", category: "tech", language: "ja" },
  { name: "Publickey", url: "https://www.publickey1.jp/atom.xml", category: "tech", language: "ja" },
  { name: "Hacker News", url: "https://news.ycombinator.com/rss", category: "tech", language: "en" },

  // 株式投資
  { name: "Yahoo!ニュース 経済", url: "https://news.yahoo.co.jp/rss/topics/business.xml", category: "markets", language: "ja" },
  { name: "NHK 経済", url: "https://www.nhk.or.jp/rss/news/cat5.xml", category: "markets", language: "ja" },
  { name: "東洋経済オンライン", url: "https://toyokeizai.net/list/feed/rss", category: "markets", language: "ja" },
  { name: "CNBC", url: "https://www.cnbc.com/id/100003114/device/rss/rss.html", category: "markets", language: "en" },

  // 大きいニュース
  { name: "NHK 主要ニュース", url: "https://www.nhk.or.jp/rss/news/cat0.xml", category: "major", language: "ja" },
  { name: "Yahoo!ニュース 主要", url: "https://news.yahoo.co.jp/rss/topics/top-picks.xml", category: "major", language: "ja" },
  { name: "NHK 国際", url: "https://www.nhk.or.jp/rss/news/cat6.xml", category: "major", language: "ja" },

  // ヘルスケア
  { name: "NHK 科学・医療", url: "https://www.nhk.or.jp/rss/news/cat3.xml", category: "health", language: "ja" },
  { name: "Yahoo!ニュース 科学", url: "https://news.yahoo.co.jp/rss/topics/science.xml", category: "health", language: "ja" },
  { name: "厚生労働省 新着情報", url: "https://www.mhlw.go.jp/stf/news.rdf", category: "health", language: "ja" },
  { name: "STAT", url: "https://www.statnews.com/feed/", category: "health", language: "en" },
];

/** 記事を選ぶときの基準にする、読み手の関心 */
export const READER_PROFILE = `読み手は、中小企業のAI導入を支援するITコンサルタントです。
- テクノロジー:生成AI・クラウド・業務システム・セキュリティなど、仕事や顧客への提案に関係する動き
- 株式投資:個人で株式投資をしている。日本株・米国株の相場、金利・為替、決算や業績、主要企業の大きな動き
- 大きいニュース:国内外の、多くの人の生活や経済に影響する出来事
- ヘルスケア:医療・健康・制度の変更など、生活や健康管理に関係するもの、ヘルスケア関連の産業の動き`;

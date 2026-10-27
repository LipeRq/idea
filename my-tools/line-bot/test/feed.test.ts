import { describe, expect, it } from "vitest";
import { decodeFeed, fetchFeed, FeedError, parseFeed, stripHtml } from "../src/morning/feed";

const RSS2 = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/">
<channel>
  <title>テストの RSS</title>
  <item>
    <title>新しい AI モデルを発表</title>
    <link>https://example.com/news/1?utm_source=rss</link>
    <description><![CDATA[<p>ある会社が新しい<b>AIモデル</b>を発表した。性能は前の版より高い&amp;安い。</p>]]></description>
    <pubDate>Sat, 24 Oct 2026 21:00:00 +0900</pubDate>
  </item>
  <item>
    <title>Show HN: something</title>
    <link>https://example.org/hn</link>
    <description><![CDATA[<a href="https://news.ycombinator.com/item?id=1">Comments</a>]]></description>
    <dc:date>2026-10-24T10:00:00Z</dc:date>
  </item>
  <item>
    <title>日付のない記事</title>
    <link>https://example.com/news/3</link>
  </item>
  <item>
    <title>リンクのない記事</title>
  </item>
</channel>
</rss>`;

const RDF = `<?xml version="1.0" encoding="UTF-8"?>
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel rdf:about="https://example.go.jp/"><title>新着情報</title></channel>
  <item rdf:about="https://example.go.jp/a"><title>制度の改正について</title><link>https://example.go.jp/a</link><dc:date>2026-10-24T15:00:00+09:00</dc:date></item>
</rdf:RDF>`;

const ATOM = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title type="text">Atom のブログ</title>
  <entry>
    <title type="html">クラウドの新機能</title>
    <link rel="replies" href="https://example.net/a#comments"/>
    <link rel="alternate" type="text/html" href="https://example.net/a"/>
    <summary>クラウドに新しい機能が追加された。料金は変わらない。</summary>
    <updated>2026-10-24T08:00:00Z</updated>
  </entry>
</feed>`;

describe("parseFeed", () => {
  it("RSS 2.0 の見出し・リンク・概要(HTML を除く)・日付を読む", () => {
    const feed = parseFeed(RSS2);
    expect(feed.title).toBe("テストの RSS");
    expect(feed.items).toHaveLength(3); // リンクのない記事は除く
    expect(feed.items[0]).toEqual({
      title: "新しい AI モデルを発表",
      link: "https://example.com/news/1?utm_source=rss",
      description: "ある会社が新しい AIモデル を発表した。性能は前の版より高い&安い。",
      publishedAt: new Date("2026-10-24T12:00:00Z"),
    });
    // 「Comments」だけの概要は使わない。dc:date も日付として読む
    expect(feed.items[1].description).toBe("");
    expect(feed.items[1].publishedAt).toEqual(new Date("2026-10-24T10:00:00Z"));
    expect(feed.items[2].publishedAt).toBeNull();
  });

  it("RSS 1.0(RDF)を読む", () => {
    const feed = parseFeed(RDF);
    expect(feed.title).toBe("新着情報");
    expect(feed.items).toEqual([
      { title: "制度の改正について", link: "https://example.go.jp/a", description: "", publishedAt: new Date("2026-10-24T06:00:00Z") },
    ]);
  });

  it("Atom は rel=alternate のリンクを使う", () => {
    const feed = parseFeed(ATOM);
    expect(feed.title).toBe("Atom のブログ");
    expect(feed.items[0].link).toBe("https://example.net/a");
    expect(feed.items[0].description).toBe("クラウドに新しい機能が追加された。料金は変わらない。");
  });

  it("フィードでなければ FeedError", () => {
    expect(() => parseFeed("<html><body>not a feed</body></html>")).toThrow(FeedError);
  });
});

describe("stripHtml", () => {
  it("タグ・script を除き、文字参照を戻す", () => {
    expect(stripHtml("<script>alert(1)</script><p>A&nbsp;&lt;B&gt; &#12354;&#x3044;</p>")).toBe("A <B> あい");
  });
});

describe("decodeFeed", () => {
  it("XML 宣言の文字コード(Shift_JIS)で読む", () => {
    // 「日本」の Shift_JIS
    const head = new TextEncoder().encode('<?xml version="1.0" encoding="Shift_JIS"?><t>');
    const bytes = new Uint8Array([...head, 0x93, 0xfa, 0x96, 0x7b, ...new TextEncoder().encode("</t>")]);
    expect(decodeFeed(bytes, null)).toContain("<t>日本</t>");
  });
});

describe("fetchFeed", () => {
  it("HTTP のエラーは FeedError", async () => {
    await expect(fetchFeed("https://example.com/feed", async () => new Response("no", { status: 404 }))).rejects.toThrow("HTTP 404");
  });

  it("接続の失敗は FeedError", async () => {
    await expect(
      fetchFeed("https://example.com/feed", async () => {
        throw new TypeError("fetch failed");
      }),
    ).rejects.toThrow("接続できませんでした");
  });

  it("取得して読み取る", async () => {
    const feed = await fetchFeed("https://example.com/feed", async (_url, init) => {
      expect(new Headers(init.headers).get("user-agent")).toContain("line-bot");
      return new Response(ATOM, { status: 200, headers: { "content-type": "application/atom+xml" } });
    });
    expect(feed.items).toHaveLength(1);
  });
});

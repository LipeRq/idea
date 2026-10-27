// RSS 2.0・RSS 1.0(RDF)・Atom の取得と読み取り。
import { XMLParser } from "fast-xml-parser";

export interface FeedItem {
  title: string;
  link: string;
  /** 概要(HTML を取り除いたもの)。ない・意味のない短さなら空文字 */
  description: string;
  publishedAt: Date | null;
}

export interface ParsedFeed {
  title: string | null;
  items: FeedItem[];
}

export class FeedError extends Error {}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  isArray: (name) => name === "item" || name === "entry" || name === "link",
  processEntities: true,
  htmlEntities: true,
});

type Node = Record<string, unknown>;

function isNode(value: unknown): value is Node {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 文字列か、{ "#text": ... } の形(属性つきの要素)から文字列を取り出す */
function text(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) return text(value[0]);
  if (isNode(value)) return text(value["#text"]);
  return "";
}

function first(...values: unknown[]): string {
  for (const v of values) {
    const t = text(v).trim();
    if (t) return t;
  }
  return "";
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** 概要の HTML からタグを取り除き、空白をまとめる */
export function stripHtml(html: string): string {
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code: string) => {
      if (code[0] === "#") {
        const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
        return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : " ";
      }
      return ENTITIES[code.toLowerCase()] ?? m;
    })
    .replace(/\s+/g, " ")
    .trim();
}

function parseDate(value: string): Date | null {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : new Date(t);
}

/** Atom の link は複数あることがある。rel が alternate(または rel なし)のものを優先する */
function atomLink(links: unknown): string {
  const list = Array.isArray(links) ? links : links === undefined ? [] : [links];
  const hrefs = list.flatMap((l) => {
    if (typeof l === "string") return [{ rel: "alternate", href: l }];
    if (isNode(l) && typeof l["@_href"] === "string") return [{ rel: typeof l["@_rel"] === "string" ? l["@_rel"] : "alternate", href: l["@_href"] }];
    return [];
  });
  return (hrefs.find((h) => h.rel === "alternate") ?? hrefs[0])?.href ?? "";
}

function cleanDescription(raw: string, title: string): string {
  const d = stripHtml(raw);
  // Hacker News の「Comments」のような、意味のない短い概要や見出しと同じ概要は使わない
  if (d.length < 15 || d === title) return "";
  return d;
}

function toItem(node: Node, kind: "rss" | "atom"): FeedItem | null {
  const title = stripHtml(first(node.title));
  const link = kind === "atom" ? atomLink(node.link) : first(node.link, node.guid);
  if (!title || !/^https?:\/\//i.test(link)) return null;
  const description = cleanDescription(first(node.description, node.summary, node.content, node.encoded), title);
  const publishedAt = parseDate(first(node.pubDate, node.published, node.updated, node.date, node.issued, node.modified));
  return { title, link, description, publishedAt };
}

/** フィードの XML を読み取る。形式が分からなければ FeedError */
export function parseFeed(xml: string): ParsedFeed {
  let doc: unknown;
  try {
    doc = parser.parse(xml);
  } catch (e) {
    throw new FeedError(`XML として読めませんでした(${e instanceof Error ? e.message.split("\n")[0] : "不明"})`);
  }
  if (!isNode(doc)) throw new FeedError("フィードの形式が分かりませんでした");

  const rss = doc.rss;
  if (isNode(rss) && isNode(rss.channel)) {
    const channel = rss.channel;
    return { title: first(channel.title) || null, items: nodes(channel.item).flatMap((n) => toItem(n, "rss") ?? []) };
  }
  const rdf = doc.RDF;
  if (isNode(rdf)) {
    const channel = isNode(rdf.channel) ? rdf.channel : {};
    return { title: first(channel.title) || null, items: nodes(rdf.item).flatMap((n) => toItem(n, "rss") ?? []) };
  }
  const feed = doc.feed;
  if (isNode(feed)) {
    return { title: stripHtml(first(feed.title)) || null, items: nodes(feed.entry).flatMap((n) => toItem(n, "atom") ?? []) };
  }
  throw new FeedError("RSS・Atom のフィードではありませんでした");
}

function nodes(value: unknown): Node[] {
  return (Array.isArray(value) ? value : value === undefined ? [] : [value]).filter(isNode);
}

const MAX_FEED_BYTES = 5 * 1024 * 1024;
const USER_AGENT = "line-bot-morning-digest/0.1 (personal use)";

/** XML 宣言か Content-Type の charset から文字コードを決めて文字列にする(Shift_JIS・EUC-JP のフィードもある) */
export function decodeFeed(bytes: Uint8Array, contentType: string | null): string {
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 200));
  const declared = /encoding=["']([\w-]+)["']/i.exec(head)?.[1] ?? /charset=([\w-]+)/i.exec(contentType ?? "")?.[1] ?? "utf-8";
  try {
    return new TextDecoder(declared.toLowerCase()).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/** フィードを取得して読み取る。失敗は FeedError(理由は短い日本語) */
export async function fetchFeed(url: string, fetchImpl: FetchLike = fetch, timeoutMs = 10_000): Promise<ParsedFeed> {
  let res: Response;
  try {
    res = await fetchImpl(url, {
      headers: { "user-agent": USER_AGENT, accept: "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.1" },
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    throw new FeedError(timedOut ? `${Math.round(timeoutMs / 1000)}秒以内に応答がありませんでした` : "接続できませんでした");
  }
  if (!res.ok) throw new FeedError(`HTTP ${res.status}`);
  const length = Number(res.headers.get("content-length") ?? "0");
  if (length > MAX_FEED_BYTES) throw new FeedError("フィードが大きすぎます");
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length > MAX_FEED_BYTES) throw new FeedError("フィードが大きすぎます");
  return parseFeed(decodeFeed(bytes, res.headers.get("content-type")));
}

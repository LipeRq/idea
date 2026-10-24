// 情報源から記事を集め、期間・重複・件数でしぼる。
import type { ParsedFeed } from "./feed";
import type { CategoryKey, Source } from "./sources";

export interface Article {
  /** Claude に渡す短い ID(a1, a2, ...)。Claude にはこの ID だけを返させ、URL はここから付ける */
  id: string;
  category: CategoryKey;
  source: string;
  language: Source["language"];
  title: string;
  link: string;
  description: string;
  publishedAt: Date;
}

export interface FailedSource {
  name: string;
  reason: string;
}

export interface CollectResult {
  articles: Article[];
  failed: FailedSource[];
}

export interface CollectOptions {
  fetchFeed: (url: string) => Promise<ParsedFeed>;
  now: Date;
  /** 何時間前までの記事を使うか */
  windowHours: number;
  /** 1つの情報源から使う記事の上限(新しい順) */
  perSourceLimit: number;
  /** 概要の長さの上限(Claude に渡す量を抑える) */
  maxDescriptionLength: number;
}

export const DEFAULT_COLLECT = { windowHours: 24, perSourceLimit: 20, maxDescriptionLength: 200 } as const;

/** 同じ記事の判定に使う URL(追跡用のパラメータ・# 以降・末尾の / を除く) */
export function normalizeLink(link: string): string {
  try {
    const url = new URL(link);
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid$|gclid$|ref$|source$)/i.test(key)) url.searchParams.delete(key);
    }
    return `${url.host.replace(/^www\./, "")}${url.pathname.replace(/\/+$/, "")}${url.search}`.toLowerCase();
  } catch {
    return link;
  }
}

function normalizeTitle(title: string): string {
  return title.replace(/[\s「」『』"'“”‘’()\uFF08\uFF09【】[\]]/g, "").toLowerCase();
}

function errorReason(e: unknown): string {
  return e instanceof Error && e.message ? e.message : "取得できませんでした";
}

export async function collectArticles(sources: readonly Source[], options: CollectOptions): Promise<CollectResult> {
  const since = options.now.getTime() - options.windowHours * 3_600_000;
  // 少し先の日時の記事(時計のずれ)は使うが、明らかに未来のものは日付の誤りとして除く
  const until = options.now.getTime() + 3_600_000;

  const results = await Promise.all(
    sources.map(async (source) => {
      try {
        return { source, feed: await options.fetchFeed(source.url) };
      } catch (e) {
        return { source, error: errorReason(e) };
      }
    }),
  );

  const failed: FailedSource[] = [];
  const seenLinks = new Set<string>();
  const seenTitles = new Set<string>();
  const articles: Article[] = [];

  // 情報源の並び順を優先順位にする(同じ記事は先の情報源のものを残す)
  for (const r of results) {
    if (!("feed" in r) || r.feed === undefined) {
      failed.push({ name: r.source.name, reason: r.error ?? "取得できませんでした" });
      continue;
    }
    const recent = r.feed.items
      .filter((item): item is typeof item & { publishedAt: Date } => item.publishedAt !== null)
      .filter((item) => item.publishedAt.getTime() >= since && item.publishedAt.getTime() <= until)
      .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());
    let count = 0;
    for (const item of recent) {
      if (count >= options.perSourceLimit) break;
      const link = normalizeLink(item.link);
      const title = normalizeTitle(item.title);
      if (seenLinks.has(link) || seenTitles.has(title)) continue;
      seenLinks.add(link);
      seenTitles.add(title);
      count++;
      articles.push({
        id: "",
        category: r.source.category,
        source: r.source.name,
        language: r.source.language,
        title: item.title,
        link: item.link,
        description: item.description.length > options.maxDescriptionLength ? `${item.description.slice(0, options.maxDescriptionLength)}…` : item.description,
        publishedAt: item.publishedAt,
      });
    }
  }
  articles.forEach((a, i) => (a.id = `a${i + 1}`));
  return { articles, failed };
}

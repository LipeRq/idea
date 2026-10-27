// 毎朝の情報まとめの全体の流れ:集める → 選んで要約する(AI が使えなければ見出しだけ) → LINE の吹き出しにする → 送る
import type { messagingApi } from "@line/bot-sdk";
import { describeAiError, type StructuredClient } from "../ai";
import { collectArticles, DEFAULT_COLLECT, type FailedSource } from "./collect";
import { generateDigest, headlinesDigest, type Digest } from "./digest";
import type { ParsedFeed } from "./feed";
import { formatDigest } from "./format";
import type { Category, Source } from "./sources";

export interface MorningDeps {
  sources: readonly Source[];
  categories: readonly Category[];
  fetchFeed: (url: string) => Promise<ParsedFeed>;
  /** null なら AI を使わない(理由は aiUnavailableReason) */
  ai: StructuredClient | null;
  aiUnavailableReason?: string;
  /** null なら送らない(試し実行) */
  send: ((messages: messagingApi.TextMessage[]) => Promise<void>) | null;
  now: () => Date;
  log: (message: string) => void;
}

export interface MorningResult {
  digest: Digest;
  messages: messagingApi.TextMessage[];
  failed: FailedSource[];
  articleCount: number;
  sent: boolean;
}

export async function runMorningDigest(deps: MorningDeps, windowHours: number = DEFAULT_COLLECT.windowHours): Promise<MorningResult> {
  const now = deps.now();
  const { articles, failed } = await collectArticles(deps.sources, {
    fetchFeed: deps.fetchFeed,
    now,
    windowHours,
    perSourceLimit: DEFAULT_COLLECT.perSourceLimit,
    maxDescriptionLength: DEFAULT_COLLECT.maxDescriptionLength,
  });
  deps.log(`記事 ${articles.length} 件(情報源 ${deps.sources.length - failed.length}/${deps.sources.length} 件から)`);
  for (const f of failed) deps.log(`取得できなかった情報源:${f.name}(${f.reason})`);

  let digest: Digest;
  if (articles.length === 0) {
    digest = headlinesDigest(articles, deps.categories, "新しい記事がありませんでした");
  } else if (!deps.ai) {
    digest = headlinesDigest(articles, deps.categories, deps.aiUnavailableReason ?? "AIを使わない設定です");
  } else {
    try {
      digest = await generateDigest(articles, deps.categories, deps.ai);
      if (digest.sections.every((s) => s.items.length === 0)) {
        digest = headlinesDigest(articles, deps.categories, "AIが記事を選べませんでした");
      }
    } catch (e) {
      const reason = describeAiError(e);
      deps.log(`AIの要約に失敗:${reason}`);
      digest = headlinesDigest(articles, deps.categories, reason);
    }
  }

  const messages = formatDigest(digest, now, failed);
  if (deps.send) {
    await deps.send(messages);
    deps.log(`LINE に送信しました(吹き出し ${messages.length} 個)`);
  }
  return { digest, messages, failed, articleCount: articles.length, sent: deps.send !== null };
}

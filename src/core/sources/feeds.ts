import type { SourceAdapter } from "../research.js";
import type { NewsItem, SourceError } from "../types.js";
import { safeGet } from "../util/http.js";
import { parseFeed, type FeedItem } from "../util/rss.js";

export const FEEDS_SOURCE = "rss";

/** Words of 3+ characters from the topic, lowercased. */
export function topicTerms(topic: string): string[] {
  return topic
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 3);
}

/** An item matches when its title or summary contains any topic term (or the whole topic, for short topics). */
export function matchesTopic(item: FeedItem, topic: string): boolean {
  const hay = `${item.title} ${item.summary ?? ""}`.toLowerCase();
  const terms = topicTerms(topic);
  return terms.length === 0 ? hay.includes(topic.toLowerCase()) : terms.some((t) => hay.includes(t));
}

/**
 * User-supplied RSS/Atom feeds. Only items that mention the topic are kept.
 * One bad feed is reported in `errors` and does not stop the others.
 */
export const feedsSource: SourceAdapter = {
  name: FEEDS_SOURCE,
  enabled: (input) => input.rssFeeds.length > 0,
  async run(input, deps) {
    const news: NewsItem[] = [];
    const errors: SourceError[] = [];

    const results = await Promise.allSettled(
      input.rssFeeds.map(async (feedUrl) => {
        const res = await safeGet(feedUrl, {}, deps);
        return { feedUrl, feed: parseFeed(res.text) };
      }),
    );

    results.forEach((r, i) => {
      if (r.status === "rejected") {
        errors.push({
          source: `${FEEDS_SOURCE}:${input.rssFeeds[i]}`,
          message: r.reason instanceof Error ? r.reason.message : String(r.reason),
        });
        return;
      }
      const { feedUrl, feed } = r.value;
      const label = feed.title ?? new URL(feedUrl).hostname;
      for (const item of feed.items) {
        if (!matchesTopic(item, input.topic)) continue;
        news.push({
          title: item.title,
          url: item.url,
          source: label,
          ...(item.publishedAt && { publishedAt: item.publishedAt }),
        });
      }
    });

    news.sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""));
    return { source: FEEDS_SOURCE, news: news.slice(0, input.maxNews), errors };
  },
};

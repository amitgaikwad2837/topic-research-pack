import { z } from "zod";
import type { ParsedInput, SourceAdapter } from "../research.js";
import type { NewsItem } from "../types.js";
import { safeGet } from "../util/http.js";

export const HN_SOURCE = "hackernews";
const ENDPOINT = "https://hn.algolia.com/api/v1/search";
const WINDOW_DAYS = 30;

/** Only the fields we use. Verified against a live response (test/fixtures/hn-search*.json). */
const HnResponseSchema = z.object({
  hits: z.array(
    z.object({
      objectID: z.string(),
      title: z.string().nullish(),
      /** Absent for Ask HN and other text-only posts. */
      url: z.string().nullish(),
      created_at: z.string().nullish(),
    }),
  ),
});

export function buildHnUrl(input: Pick<ParsedInput, "topic" | "maxNews">, nowMs: number): string {
  const since = Math.floor(nowMs / 1000) - WINDOW_DAYS * 86_400;
  const params = new URLSearchParams({
    query: input.topic,
    tags: "story",
    hitsPerPage: String(input.maxNews),
    numericFilters: `created_at_i>${since}`,
  });
  return `${ENDPOINT}?${params.toString()}`;
}

export function parseHnResponse(json: unknown): NewsItem[] {
  const { hits } = HnResponseSchema.parse(json);
  const items: NewsItem[] = [];
  for (const hit of hits) {
    const title = hit.title?.trim();
    if (!title) continue;
    items.push({
      title,
      url: hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`,
      source: HN_SOURCE,
      ...(hit.created_at ? { publishedAt: hit.created_at } : {}),
    });
  }
  return items;
}

export const hackerNewsSource: SourceAdapter = {
  name: HN_SOURCE,
  async run(input, deps) {
    const res = await safeGet(buildHnUrl(input, Date.now()), {}, deps);
    let json: unknown;
    try {
      json = JSON.parse(res.text);
    } catch {
      throw new Error("Hacker News returned invalid JSON");
    }
    return { source: HN_SOURCE, news: parseHnResponse(json) };
  },
};

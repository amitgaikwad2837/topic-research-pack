import { z } from "zod";
import type { SourceAdapter } from "../research.js";
import type { KeywordIdea, NewsItem, TrendSignal } from "../types.js";
import { safeGet } from "../util/http.js";
import { asArray, parseFeed, parseXml, text } from "../util/rss.js";
import { matchesTopic } from "./feeds.js";

/**
 * Google sources. OFF by default and only used when `enableGoogleSources` is true.
 * These are unofficial feed endpoints. The Google News feed states it is for personal,
 * non-commercial use, so the operator who turns these on is responsible for complying with
 * Google's terms. See README.
 */
const GOOGLE_ENABLED = (input: { enableGoogleSources: boolean }) => input.enableGoogleSources;

async function getText(url: string, deps: Parameters<typeof safeGet>[2]): Promise<string> {
  return (await safeGet(url, {}, deps)).text;
}

// ---- Google News RSS ----

export const GOOGLE_NEWS_SOURCE = "google-news";

export function buildGoogleNewsUrl(topic: string): string {
  const params = new URLSearchParams({
    q: `${topic} when:7d`,
    hl: "en-US",
    gl: "US",
    ceid: "US:en",
  });
  return `https://news.google.com/rss/search?${params.toString()}`;
}

/** Titles look like "Headline - Publisher"; drop the publisher suffix once we know the publisher. */
export function cleanGoogleNewsTitle(title: string, publisher?: string): string {
  if (publisher && title.endsWith(` - ${publisher}`)) return title.slice(0, -(publisher.length + 3));
  return title;
}

export function parseGoogleNews(xml: string, max: number): NewsItem[] {
  return parseFeed(xml)
    .items.slice(0, max)
    .map((it) => ({
      title: cleanGoogleNewsTitle(it.title, it.sourceName),
      // Google redirect link. It cannot be fetched for article text, so page fetching skips this host.
      url: it.url,
      source: it.sourceName ?? "Google News",
      ...(it.publishedAt && { publishedAt: it.publishedAt }),
    }));
}

export const googleNewsSource: SourceAdapter = {
  name: GOOGLE_NEWS_SOURCE,
  enabled: GOOGLE_ENABLED,
  async run(input, deps) {
    const xml = await getText(buildGoogleNewsUrl(input.topic), deps);
    return { source: GOOGLE_NEWS_SOURCE, news: parseGoogleNews(xml, input.maxNews) };
  },
};

// ---- Google Trends daily trending RSS ----

export const GOOGLE_TRENDS_SOURCE = "google-trends";
const TRENDS_URL = "https://trends.google.com/trending/rss?geo=US";

/** "1000+" -> 1000, "2K+" -> 2000, "1M+" -> 1000000. */
export function parseTraffic(raw: string | undefined): number | undefined {
  const m = /^\s*([\d,.]+)\s*([KkMm])?\s*\+?\s*$/.exec(raw ?? "");
  if (!m) return undefined;
  const n = Number((m[1] ?? "").replaceAll(",", ""));
  if (!Number.isFinite(n)) return undefined;
  const mult = m[2]?.toLowerCase() === "k" ? 1_000 : m[2]?.toLowerCase() === "m" ? 1_000_000 : 1;
  return n * mult;
}

/**
 * The feed lists what is trending now in the US overall, not results for a query.
 * We keep only entries (or their related headlines) that mention the topic.
 */
export function parseGoogleTrends(xml: string, topic: string): TrendSignal[] {
  const doc = parseXml(xml) as { rss?: { channel?: { item?: unknown } } };
  const signals: TrendSignal[] = [];
  for (const raw of asArray(doc.rss?.channel?.item) as Array<Record<string, unknown>>) {
    const title = text(raw.title);
    if (!title) continue;
    const headlines = asArray(raw["ht:news_item"] as Array<Record<string, unknown>> | undefined)
      .map((n) => text(n["ht:news_item_title"]) ?? "")
      .join(" ");
    if (!matchesTopic({ title, url: "", summary: headlines }, topic)) continue;
    const traffic = parseTraffic(text(raw["ht:approx_traffic"]));
    if (traffic === undefined) continue;
    signals.push({
      label: `Google Trends (US) trending now, approx. searches: ${title}`,
      value: traffic,
      source: GOOGLE_TRENDS_SOURCE,
    });
  }
  return signals;
}

export const googleTrendsSource: SourceAdapter = {
  name: GOOGLE_TRENDS_SOURCE,
  enabled: GOOGLE_ENABLED,
  async run(input, deps) {
    const xml = await getText(TRENDS_URL, deps);
    return { source: GOOGLE_TRENDS_SOURCE, trends: parseGoogleTrends(xml, input.topic) };
  },
};

// ---- Google Suggest ----

export const GOOGLE_SUGGEST_SOURCE = "google-suggest";
const SuggestSchema = z.tuple([z.string(), z.array(z.string())]).rest(z.unknown());

export function buildGoogleSuggestUrl(topic: string): string {
  return `https://suggestqueries.google.com/complete/search?${new URLSearchParams({ client: "firefox", q: topic }).toString()}`;
}

export function parseGoogleSuggest(json: unknown, topic: string, max: number): KeywordIdea[] {
  const [, suggestions] = SuggestSchema.parse(json);
  const seen = new Set<string>([topic.trim().toLowerCase()]);
  const out: KeywordIdea[] = [];
  for (const s of suggestions) {
    const keyword = s.trim();
    const key = keyword.toLowerCase();
    if (!keyword || seen.has(key)) continue;
    seen.add(key);
    out.push({ keyword, source: GOOGLE_SUGGEST_SOURCE });
    if (out.length >= max) break;
  }
  return out;
}

export const googleSuggestSource: SourceAdapter = {
  name: GOOGLE_SUGGEST_SOURCE,
  enabled: GOOGLE_ENABLED,
  async run(input, deps) {
    const body = await getText(buildGoogleSuggestUrl(input.topic), deps);
    let json: unknown;
    try {
      json = JSON.parse(body);
    } catch {
      throw new Error("Google Suggest returned invalid JSON");
    }
    return {
      source: GOOGLE_SUGGEST_SOURCE,
      keywords: parseGoogleSuggest(json, input.topic, input.maxKeywords),
    };
  },
};

// ---- Search results via the apify/google-search-scraper Actor ----

export const GOOGLE_SEARCH_SOURCE = "google-search-actor";
export const GOOGLE_SEARCH_ACTOR = "apify/google-search-scraper";

/**
 * Field names come from the Actor's published docs (one dataset item per SERP page, with
 * `organicResults[]` of {title, url, description}); they were not captured from a live run.
 */
const SerpItemSchema = z.object({
  organicResults: z
    .array(z.object({ title: z.string().nullish(), url: z.string().nullish(), description: z.string().nullish() }))
    .optional(),
});

export function parseGoogleSearchItems(items: unknown[], max: number): NewsItem[] {
  const out: NewsItem[] = [];
  const seen = new Set<string>();
  for (const raw of items) {
    const parsed = SerpItemSchema.safeParse(raw);
    if (!parsed.success) continue;
    for (const r of parsed.data.organicResults ?? []) {
      const title = r.title?.trim();
      const url = r.url?.trim();
      if (!title || !url || seen.has(url)) continue;
      seen.add(url);
      // Web search results are not dated news. They are tagged by source so callers can tell them apart.
      out.push({ title, url, source: GOOGLE_SEARCH_SOURCE });
      if (out.length >= max) return out;
    }
  }
  return out;
}

export const googleSearchSource: SourceAdapter = {
  name: GOOGLE_SEARCH_SOURCE,
  enabled: (input, deps) => input.enableGoogleSources && input.useGoogleSearchActor && !!deps.callActor,
  async run(input, deps) {
    if (!deps.callActor) throw new Error("Calling another Actor is only possible on the Apify platform");
    // One result page keeps the cost of the called Actor (billed to the caller) to a minimum.
    const items = await deps.callActor(GOOGLE_SEARCH_ACTOR, {
      queries: input.topic,
      maxPagesPerQuery: 1,
    });
    return { source: GOOGLE_SEARCH_SOURCE, news: parseGoogleSearchItems(items, input.maxNews) };
  },
};

export const googleAdapters: SourceAdapter[] = [
  googleNewsSource,
  googleTrendsSource,
  googleSuggestSource,
  googleSearchSource,
];

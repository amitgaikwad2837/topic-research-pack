import { z } from "zod";
import type { SourceAdapter } from "../research.js";
import type { KeywordIdea, SourceError, TrendSignal } from "../types.js";
import { safeGet } from "../util/http.js";

export const WIKI_SOURCE = "wikipedia";
const SEARCH_ENDPOINT = "https://en.wikipedia.org/w/api.php";
const PAGEVIEWS_ENDPOINT =
  "https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user";
const DAYS = 14;

/** Shapes verified live (test/fixtures/wiki-search.json, wiki-pageviews.json). */
const SearchSchema = z.object({
  query: z.object({ search: z.array(z.object({ title: z.string() })) }),
});
const PageviewsSchema = z.object({
  items: z.array(z.object({ timestamp: z.string(), views: z.number() })),
});

export function buildSearchUrl(topic: string, limit: number): string {
  return `${SEARCH_ENDPOINT}?${new URLSearchParams({
    action: "query",
    list: "search",
    srsearch: topic,
    srlimit: String(limit),
    format: "json",
  }).toString()}`;
}

const ymd = (d: Date) => d.toISOString().slice(0, 10).replaceAll("-", "");

export function buildPageviewsUrl(title: string, nowMs: number): string {
  const end = new Date(nowMs - 86_400_000); // yesterday: today's data is incomplete
  const start = new Date(end.getTime() - (DAYS - 1) * 86_400_000);
  const article = encodeURIComponent(title.replaceAll(" ", "_"));
  return `${PAGEVIEWS_ENDPOINT}/${article}/daily/${ymd(start)}/${ymd(end)}`;
}

export function parseSearchTitles(json: unknown): string[] {
  return SearchSchema.parse(json).query.search.map((s) => s.title);
}

/** Views in the latest 7 days, views in the 7 days before, and the percentage change. */
export function pageviewSignals(json: unknown, title: string): TrendSignal[] {
  const days = PageviewsSchema.parse(json).items.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  if (days.length < 2) return [];
  const half = Math.min(7, Math.floor(days.length / 2));
  const recent = days.slice(-half).reduce((n, d) => n + d.views, 0);
  const prior = days.slice(-half * 2, -half).reduce((n, d) => n + d.views, 0);
  const signals: TrendSignal[] = [
    { label: `Wikipedia pageviews, last ${half} days: ${title}`, value: recent, source: WIKI_SOURCE },
  ];
  if (prior > 0) {
    signals.push({
      label: `Wikipedia pageviews change vs previous ${half} days (%): ${title}`,
      value: Math.round(((recent - prior) / prior) * 1000) / 10,
      source: WIKI_SOURCE,
    });
  }
  return signals;
}

async function getJson(url: string, deps: Parameters<typeof safeGet>[2]): Promise<unknown> {
  const res = await safeGet(url, {}, deps);
  try {
    return JSON.parse(res.text);
  } catch {
    throw new Error("Wikimedia returned invalid JSON");
  }
}

export const wikipediaSource: SourceAdapter = {
  name: WIKI_SOURCE,
  async run(input, deps) {
    const titles = parseSearchTitles(await getJson(buildSearchUrl(input.topic, input.maxKeywords), deps));
    const keywords: KeywordIdea[] = titles.map((keyword) => ({ keyword, source: WIKI_SOURCE }));
    const errors: SourceError[] = [];
    let trends: TrendSignal[] = [];

    const top = titles[0];
    if (top) {
      try {
        const json = await getJson(buildPageviewsUrl(top, Date.now()), deps);
        trends = pageviewSignals(json, top);
      } catch (err) {
        // Search still succeeded, so keep it and report only the pageviews failure.
        errors.push({ source: `${WIKI_SOURCE}-pageviews`, message: (err as Error).message });
      }
    }
    return { source: WIKI_SOURCE, keywords, trends, errors };
  },
};

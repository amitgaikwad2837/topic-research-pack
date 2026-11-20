import { z } from "zod";
import type { SourceAdapter } from "../research.js";
import type { NewsItem } from "../types.js";
import { getJson } from "../util/text.js";
import { matchesTopic } from "./feeds.js";

/**
 * Sources that list what is trending right now, across all subjects. Like Google Trends they
 * are not queryable by topic, so we keep only the entries that mention the topic. For many
 * topics that is nothing, which is a valid, empty result.
 */

// ---- Mastodon trending links (mastodon.social) ----

export const MASTODON_SOURCE = "mastodon-trends";

/** Verified against a live response (test/fixtures/mastodon-trends.json). */
const MastodonSchema = z.array(
  z.object({
    url: z.string(),
    title: z.string(),
    description: z.string().nullish(),
    provider_name: z.string().nullish(),
    published_at: z.string().nullish(),
  }),
);

export function parseMastodonTrends(json: unknown, topic: string): NewsItem[] {
  const out: NewsItem[] = [];
  for (const l of MastodonSchema.parse(json)) {
    const title = l.title.trim();
    if (!title) continue;
    if (!matchesTopic({ title, url: l.url, ...(l.description && { summary: l.description }) }, topic)) continue;
    out.push({
      title,
      url: l.url,
      source: l.provider_name?.trim() || "Mastodon trending links",
      ...(l.published_at && { publishedAt: l.published_at }),
    });
  }
  return out;
}

export const mastodonTrendsSource: SourceAdapter = {
  name: MASTODON_SOURCE,
  async run(input, deps) {
    const json = await getJson("https://mastodon.social/api/v1/trends/links?limit=20", deps, "Mastodon");
    return { source: MASTODON_SOURCE, news: parseMastodonTrends(json, input.topic).slice(0, input.maxNews) };
  },
};

// ---- Lobsters hottest stories ----

export const LOBSTERS_SOURCE = "lobsters";

/** Verified against a live response (test/fixtures/lobsters.json). */
const LobstersSchema = z.array(
  z.object({
    title: z.string(),
    url: z.string().nullish(),
    comments_url: z.string().nullish(),
    created_at: z.string().nullish(),
    description_plain: z.string().nullish(),
    tags: z.array(z.string()).nullish(),
  }),
);

export function parseLobsters(json: unknown, topic: string): NewsItem[] {
  const out: NewsItem[] = [];
  for (const s of LobstersSchema.parse(json)) {
    const url = s.url || s.comments_url;
    const title = s.title.trim();
    if (!url || !title) continue;
    const summary = `${s.description_plain ?? ""} ${(s.tags ?? []).join(" ")}`.trim();
    if (!matchesTopic({ title, url, ...(summary && { summary }) }, topic)) continue;
    const t = s.created_at ? Date.parse(s.created_at) : Number.NaN;
    out.push({
      title,
      url,
      source: LOBSTERS_SOURCE,
      ...(Number.isNaN(t) ? {} : { publishedAt: new Date(t).toISOString() }),
    });
  }
  return out;
}

export const lobstersSource: SourceAdapter = {
  name: LOBSTERS_SOURCE,
  async run(input, deps) {
    const json = await getJson("https://lobste.rs/hottest.json", deps, "Lobsters");
    return { source: LOBSTERS_SOURCE, news: parseLobsters(json, input.topic).slice(0, input.maxNews) };
  },
};

export const trendingAdapters: SourceAdapter[] = [mastodonTrendsSource, lobstersSource];

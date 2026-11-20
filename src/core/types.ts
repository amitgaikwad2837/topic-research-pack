import { z } from "zod";
import type { Lookup } from "./util/ssrf.js";

/** Injected so tests never touch the network. */
export type FetchLike = typeof fetch;

export const ResearchInputSchema = z.object({
  topic: z.string().trim().min(1).max(200),
  maxNews: z.number().int().min(1).max(50).default(10),
  maxKeywords: z.number().int().min(1).max(100).default(20),
  /** How many pages to fetch and convert to markdown. 0 turns page fetching off. */
  maxPages: z.number().int().min(0).max(10).default(3),
  maxCharsPerPage: z.number().int().min(500).max(50_000).default(8_000),
  rssFeeds: z.array(z.string().url()).max(10).default([]),
  respectRobotsTxt: z.boolean().default(true),
  /** Google sources are opt-in. Scraping Google's pages is against Google's terms. */
  enableGoogleSources: z.boolean().default(false),
  /**
   * Also call the `apify/google-search-scraper` Actor for search results. Only works on the Apify
   * platform, needs enableGoogleSources, and is billed to the caller's Apify account by that Actor.
   */
  useGoogleSearchActor: z.boolean().default(false),
  /** Papers, code repositories and Q&A threads about the topic. 0 turns the list off. */
  maxReferences: z.number().int().min(0).max(50).default(10),
  /** Source names (as listed in `sourcesUsed`) to skip, for example ["github", "stackexchange"]. */
  excludeSources: z.array(z.string().trim().min(1).max(60)).max(30).default([]),
  /** GDELT news search. Experimental: its response format was not verified against a live response. */
  enableGdelt: z.boolean().default(false),
});

export type ResearchInput = z.infer<typeof ResearchInputSchema>;
/** Input after defaults are applied. */
export type ParsedInput = ResearchInput;

export const NewsItemSchema = z.object({
  title: z.string(),
  url: z.string(),
  source: z.string(),
  publishedAt: z.string().optional(),
});
export const TrendSignalSchema = z.object({
  label: z.string(),
  value: z.number(),
  source: z.string(),
});
export const KeywordIdeaSchema = z.object({
  keyword: z.string(),
  source: z.string(),
});
/** A short, neutral description of the topic itself (Wikipedia's summary of the best-matching article). */
export const OverviewSchema = z.object({
  title: z.string(),
  summary: z.string(),
  url: z.string(),
  description: z.string().optional(),
  source: z.string(),
});

/** Something to read about the topic that is not news: a paper, a code repository or a Q&A thread. */
export const ReferenceItemSchema = z.object({
  title: z.string(),
  url: z.string(),
  source: z.string(),
  kind: z.enum(["paper", "repo", "question"]),
  publishedAt: z.string().optional(),
  summary: z.string().optional(),
});
export const PageContentSchema = z.object({
  url: z.string(),
  title: z.string().optional(),
  markdown: z.string(),
});
export const SourceErrorSchema = z.object({
  source: z.string(),
  message: z.string(),
});

/** The single JSON object every interface (Actor, MCP, CLI) returns. */
export const ResearchPackSchema = z.object({
  topic: z.string(),
  /** When the pack was assembled (ISO 8601). Citations use it as the retrieval date. */
  generatedAt: z.string(),
  /** Absent when no source could describe the topic. */
  overview: OverviewSchema.optional(),
  news: z.array(NewsItemSchema),
  trends: z.array(TrendSignalSchema),
  keywords: z.array(KeywordIdeaSchema),
  references: z.array(ReferenceItemSchema),
  pages: z.array(PageContentSchema),
  sourcesUsed: z.array(z.string()),
  errors: z.array(SourceErrorSchema),
});

export type NewsItem = z.infer<typeof NewsItemSchema>;
export type TrendSignal = z.infer<typeof TrendSignalSchema>;
export type KeywordIdea = z.infer<typeof KeywordIdeaSchema>;
export type Overview = z.infer<typeof OverviewSchema>;
export type ReferenceItem = z.infer<typeof ReferenceItemSchema>;
export type PageContent = z.infer<typeof PageContentSchema>;
export type SourceError = z.infer<typeof SourceErrorSchema>;
export type ResearchPack = z.infer<typeof ResearchPackSchema>;

export interface Deps {
  fetch: FetchLike;
  /** DNS lookup override, for tests. */
  lookup?: Lookup;
  /** Runs another Apify Actor and returns its dataset items. Only available on the Apify platform. */
  callActor?: (actorId: string, input: unknown) => Promise<unknown[]>;
  /** Clock override, for tests. */
  now?: () => Date;
}

/** Every source adapter returns this shape and fails soft. */
export interface SourceResult {
  source: string;
  news?: NewsItem[];
  trends?: TrendSignal[];
  keywords?: KeywordIdea[];
  references?: ReferenceItem[];
  overview?: Overview;
  /** Partial failures inside an adapter (for example one bad feed out of three). */
  errors?: SourceError[];
}

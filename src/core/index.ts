import { duckDuckGoSuggestSource } from "./sources/ddg.js";
import { feedsSource } from "./sources/feeds.js";
import { gdeltSource } from "./sources/gdelt.js";
import { googleAdapters } from "./sources/google.js";
import { hackerNewsSource } from "./sources/hackernews.js";
import { referenceAdapters } from "./sources/references.js";
import { trendingAdapters } from "./sources/trending.js";
import { wikipediaSource } from "./sources/wikipedia.js";
import { runResearch, type SourceAdapter } from "./research.js";
import type { Deps, ResearchPack } from "./types.js";

export * from "./types.js";
export { runResearch, type SourceAdapter } from "./research.js";
export { fetchPageMarkdown } from "./content/extract.js";

/**
 * Public sources run by default. The Google adapters are in the list but each one switches
 * itself off unless the caller sets `enableGoogleSources` (the search Actor also needs
 * `useGoogleSearchActor` and a platform that can call Actors).
 */
export const defaultAdapters: SourceAdapter[] = [
  hackerNewsSource,
  wikipediaSource,
  duckDuckGoSuggestSource,
  feedsSource,
  ...trendingAdapters,
  ...referenceAdapters,
  gdeltSource,
  ...googleAdapters,
];

/** The one entry point the Actor, MCP server and CLI call. */
export function research(input: unknown, deps: Deps): Promise<ResearchPack> {
  return runResearch(input, deps, defaultAdapters);
}

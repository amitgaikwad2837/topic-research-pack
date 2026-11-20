import { collectPages, normalizeUrl } from "./content/pages.js";
import {
  ResearchInputSchema,
  type Deps,
  type KeywordIdea,
  type NewsItem,
  type ParsedInput,
  type ReferenceItem,
  type ResearchPack,
  type SourceResult,
} from "./types.js";

export type { ParsedInput };

export interface SourceAdapter {
  /** Stable id used in `sourcesUsed`, `errors` and `excludeSources`. */
  name: string;
  /** Return false to skip this adapter for the given input (it then appears nowhere in the output). */
  enabled?(input: ParsedInput, deps: Deps): boolean;
  run(input: ParsedInput, deps: Deps): Promise<SourceResult>;
}

interface Dated {
  url: string;
  publishedAt?: string | undefined;
}

/** Newest first; items without a date go after dated ones. Stable. */
function byNewest(a: Dated, b: Dated): number {
  return (b.publishedAt ?? "").localeCompare(a.publishedAt ?? "");
}

/**
 * Merges lists of dated items, one list per source adapter. Duplicates (same normalized URL) are
 * dropped. When there are more items than `max`, each adapter gets a fair share (round-robin,
 * newest first within each), so a source with undated items is not crowded out by one with many
 * dated ones. The kept items are then sorted newest first.
 */
export function mergeDated<T extends Dated>(lists: T[][], max: number): T[] {
  const seen = new Set<string>();
  const queues = lists.map((list) => {
    const unique: T[] = [];
    for (const item of list) {
      const key = normalizeUrl(item.url) ?? item.url;
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(item);
    }
    return unique.sort(byNewest);
  });

  const picked: T[] = [];
  for (let round = 0; picked.length < max; round++) {
    let tookAny = false;
    for (const q of queues) {
      const item = q[round];
      if (!item) continue;
      picked.push(item);
      tookAny = true;
      if (picked.length >= max) break;
    }
    if (!tookAny) break;
  }
  return picked.sort(byNewest);
}

export const mergeNews = (lists: NewsItem[][], max: number): NewsItem[] => mergeDated(lists, max);
export const mergeReferences = (lists: ReferenceItem[][], max: number): ReferenceItem[] =>
  mergeDated(lists, max);

/**
 * Merges keyword lists, one per source adapter, taking turns between sources so each is
 * represented when the cap cuts the list. Case-insensitive de-duplication; the topic itself is dropped.
 */
export function mergeKeywords(lists: KeywordIdea[][], topic: string, max: number): KeywordIdea[] {
  const seen = new Set<string>([topic.trim().toLowerCase()]);
  const queues = lists.map((list) => {
    const unique: KeywordIdea[] = [];
    for (const item of list) {
      const key = item.keyword.trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      unique.push(item);
    }
    return unique;
  });

  const out: KeywordIdea[] = [];
  for (let round = 0; out.length < max; round++) {
    let tookAny = false;
    for (const q of queues) {
      const item = q[round];
      if (!item) continue;
      out.push(item);
      tookAny = true;
      if (out.length >= max) break;
    }
    if (!tookAny) break;
  }
  return out;
}

/**
 * Orchestrator. Runs every adapter in parallel and never lets one failure fail the run,
 * then merges, de-duplicates and caps the results and fetches a few pages as markdown.
 * Throws only for invalid input.
 */
export async function runResearch(
  rawInput: unknown,
  deps: Deps,
  adapters: SourceAdapter[] = [],
): Promise<ResearchPack> {
  const input = ResearchInputSchema.parse(rawInput);

  const excluded = new Set(input.excludeSources.map((s) => s.toLowerCase()));
  const active = adapters.filter(
    (a) => !excluded.has(a.name.toLowerCase()) && (a.enabled?.(input, deps) ?? true),
  );
  const settled = await Promise.allSettled(active.map((a) => a.run(input, deps)));

  const newsLists: NewsItem[][] = [];
  const keywordLists: KeywordIdea[][] = [];
  const referenceLists: ReferenceItem[][] = [];
  const pack: ResearchPack = {
    topic: input.topic,
    news: [],
    trends: [],
    keywords: [],
    references: [],
    pages: [],
    sourcesUsed: [],
    errors: [],
  };

  settled.forEach((res, i) => {
    const name = active[i]?.name ?? `adapter-${i}`;
    if (res.status === "fulfilled") {
      pack.sourcesUsed.push(name);
      newsLists.push(res.value.news ?? []);
      pack.trends.push(...(res.value.trends ?? []));
      keywordLists.push(res.value.keywords ?? []);
      referenceLists.push(res.value.references ?? []);
      pack.errors.push(...(res.value.errors ?? []));
    } else {
      const message = res.reason instanceof Error ? res.reason.message : String(res.reason);
      pack.errors.push({ source: name, message });
    }
  });

  pack.news = mergeNews(newsLists, input.maxNews);
  pack.keywords = mergeKeywords(keywordLists, input.topic, input.maxKeywords);
  pack.references = mergeReferences(referenceLists, input.maxReferences);

  const { pages, errors } = await collectPages(pack.news, input, deps);
  pack.pages = pages;
  pack.errors.push(...errors);

  return pack;
}

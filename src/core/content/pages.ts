import type { Deps, NewsItem, PageContent, ParsedInput, SourceError } from "../types.js";
import { RobotsChecker } from "../util/robots.js";
import { fetchPageMarkdown } from "./extract.js";

const BATCH_SIZE = 3;
/** Try at most this many candidates per wanted page, since some will be blocked or not HTML. */
const CANDIDATE_FACTOR = 3;

/**
 * Hosts whose links are not the article itself: Hacker News discussion pages, and Google News
 * redirect links (they need JavaScript and consent screens, so they never yield article text).
 */
const SKIP_HOSTS = new Set(["news.ycombinator.com", "news.google.com"]);

/** Drops fragments, tracking params and a trailing slash, so the same article is not fetched twice. */
export function normalizeUrl(raw: string): string | undefined {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return undefined;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (/^utm_/i.test(key) || key === "fbclid" || key === "gclid") url.searchParams.delete(key);
  }
  if (url.pathname.length > 1 && url.pathname.endsWith("/")) url.pathname = url.pathname.slice(0, -1);
  return url.toString();
}

/** Distinct article URLs from the news list, in the order given. */
export function pageCandidates(news: NewsItem[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of news) {
    const url = normalizeUrl(item.url);
    if (!url || seen.has(url)) continue;
    if (SKIP_HOSTS.has(new URL(url).hostname)) continue;
    seen.add(url);
    out.push(url);
  }
  return out;
}

/**
 * Fetches up to `maxPages` pages from the news list as markdown.
 * Blocked or failing pages are reported in `errors` and the next candidate is tried.
 */
export async function collectPages(
  news: NewsItem[],
  input: Pick<ParsedInput, "maxPages" | "maxCharsPerPage" | "respectRobotsTxt">,
  deps: Deps,
): Promise<{ pages: PageContent[]; errors: SourceError[] }> {
  const pages: PageContent[] = [];
  const errors: SourceError[] = [];
  if (input.maxPages <= 0) return { pages, errors };

  const candidates = pageCandidates(news).slice(0, input.maxPages * CANDIDATE_FACTOR);
  const robots = new RobotsChecker(deps);

  for (let i = 0; i < candidates.length && pages.length < input.maxPages; i += BATCH_SIZE) {
    const batch = candidates.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map((url) =>
        fetchPageMarkdown(
          url,
          { respectRobotsTxt: input.respectRobotsTxt, maxChars: input.maxCharsPerPage, robots },
          deps,
        ),
      ),
    );
    results.forEach((r, j) => {
      if (r.status === "fulfilled") {
        if (pages.length < input.maxPages && r.value.markdown) pages.push(r.value);
      } else {
        errors.push({
          source: `page:${batch[j]}`,
          message: r.reason instanceof Error ? r.reason.message : String(r.reason),
        });
      }
    });
  }
  return { pages, errors };
}

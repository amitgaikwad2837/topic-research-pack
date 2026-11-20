import { z } from "zod";
import type { SourceAdapter } from "../research.js";
import type { ReferenceItem, TrendSignal } from "../types.js";
import { safeGet } from "../util/http.js";
import { parseFeed, parseXml, text } from "../util/rss.js";
import { collapseWhitespace, decodeEntities, getJson, isoFromUnix, truncate } from "../util/text.js";

/**
 * Sources of references (papers, code repositories, Q&A threads) about a topic. All are public,
 * keyless JSON/Atom endpoints. Each makes one request per run and fails soft.
 */

const SUMMARY_MAX = 280;

// ---- arXiv (research papers) ----

export const ARXIV_SOURCE = "arxiv";

export function buildArxivUrl(topic: string, max: number): string {
  // Quotes make it a phrase search. Strip any the caller typed so they cannot break the query.
  const phrase = topic.replaceAll('"', " ").trim();
  const params = new URLSearchParams({
    search_query: `all:"${phrase}"`,
    sortBy: "submittedDate",
    sortOrder: "descending",
    max_results: String(max),
  });
  return `https://export.arxiv.org/api/query?${params.toString()}`;
}

export function parseArxiv(xml: string): { papers: ReferenceItem[]; total?: number } {
  const feed = parseFeed(xml);
  const papers = feed.items.map<ReferenceItem>((it) => ({
    title: collapseWhitespace(it.title),
    url: it.url,
    source: ARXIV_SOURCE,
    kind: "paper",
    ...(it.publishedAt && { publishedAt: it.publishedAt }),
    ...(it.summary && { summary: truncate(collapseWhitespace(it.summary), SUMMARY_MAX) }),
  }));
  const doc = parseXml(xml) as { feed?: Record<string, unknown> };
  const totalRaw = Number(text(doc.feed?.["opensearch:totalResults"]));
  return { papers, ...(Number.isFinite(totalRaw) && { total: totalRaw }) };
}

export const arxivSource: SourceAdapter = {
  name: ARXIV_SOURCE,
  enabled: (input) => input.maxReferences > 0,
  async run(input, deps) {
    const res = await safeGet(buildArxivUrl(input.topic, Math.min(input.maxReferences, 30)), {}, deps);
    const { papers, total } = parseArxiv(res.text);
    const trends: TrendSignal[] =
      total === undefined
        ? []
        : [{ label: "arXiv papers matching the topic (all time)", value: total, source: ARXIV_SOURCE }];
    return { source: ARXIV_SOURCE, references: papers, trends };
  },
};

// ---- Stack Exchange (Stack Overflow questions) ----

export const STACKEXCHANGE_SOURCE = "stackexchange";

/** Verified against a live response (test/fixtures/stackexchange.json). */
const StackSchema = z.object({
  items: z.array(
    z.object({
      title: z.string(),
      link: z.string(),
      creation_date: z.number().optional(),
    }),
  ),
});

export function buildStackExchangeUrl(topic: string, max: number): string {
  const params = new URLSearchParams({
    q: topic,
    site: "stackoverflow",
    sort: "relevance",
    order: "desc",
    pagesize: String(max),
  });
  return `https://api.stackexchange.com/2.3/search/advanced?${params.toString()}`;
}

export function parseStackExchange(json: unknown): ReferenceItem[] {
  return StackSchema.parse(json).items.map<ReferenceItem>((q) => ({
    // Titles come back HTML-escaped (&#39;), so decode them.
    title: decodeEntities(q.title),
    url: q.link,
    source: STACKEXCHANGE_SOURCE,
    kind: "question",
    ...(q.creation_date !== undefined && { publishedAt: isoFromUnix(q.creation_date) }),
  }));
}

export const stackExchangeSource: SourceAdapter = {
  name: STACKEXCHANGE_SOURCE,
  enabled: (input) => input.maxReferences > 0,
  async run(input, deps) {
    const json = await getJson(buildStackExchangeUrl(input.topic, Math.min(input.maxReferences, 30)), deps, "Stack Exchange");
    return { source: STACKEXCHANGE_SOURCE, references: parseStackExchange(json) };
  },
};

// ---- GitHub (code repositories) ----

export const GITHUB_SOURCE = "github";

/** Verified against a live response (test/fixtures/github-repos.json). */
const GithubSchema = z.object({
  total_count: z.number().optional(),
  items: z.array(
    z.object({
      full_name: z.string(),
      html_url: z.string(),
      description: z.string().nullish(),
      pushed_at: z.string().nullish(),
    }),
  ),
});

export function buildGithubUrl(topic: string, max: number): string {
  return `https://api.github.com/search/repositories?${new URLSearchParams({ q: topic, per_page: String(max) }).toString()}`;
}

export function parseGithub(json: unknown): { repos: ReferenceItem[]; total?: number } {
  const parsed = GithubSchema.parse(json);
  const repos = parsed.items.map<ReferenceItem>((r) => ({
    title: r.full_name,
    url: r.html_url,
    source: GITHUB_SOURCE,
    kind: "repo",
    ...(r.pushed_at && { publishedAt: r.pushed_at }),
    ...(r.description && { summary: truncate(collapseWhitespace(r.description), SUMMARY_MAX) }),
  }));
  return { repos, ...(parsed.total_count !== undefined && { total: parsed.total_count }) };
}

export const githubSource: SourceAdapter = {
  name: GITHUB_SOURCE,
  enabled: (input) => input.maxReferences > 0,
  async run(input, deps) {
    // The unauthenticated GitHub API allows few requests per hour per IP; a 403/429 is reported as a soft error.
    const res = await safeGet(
      buildGithubUrl(input.topic, Math.min(input.maxReferences, 30)),
      { headers: { accept: "application/vnd.github+json" } },
      deps,
    );
    let json: unknown;
    try {
      json = JSON.parse(res.text);
    } catch {
      throw new Error("GitHub returned invalid JSON");
    }
    const { repos, total } = parseGithub(json);
    const trends: TrendSignal[] =
      total === undefined
        ? []
        : [{ label: "GitHub repositories matching the topic", value: total, source: GITHUB_SOURCE }];
    return { source: GITHUB_SOURCE, references: repos, trends };
  },
};

export const referenceAdapters: SourceAdapter[] = [arxivSource, stackExchangeSource, githubSource];

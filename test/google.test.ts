import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { research } from "../src/core/index.js";
import { pageCandidates } from "../src/core/content/pages.js";
import {
  buildGoogleNewsUrl,
  buildGoogleSuggestUrl,
  cleanGoogleNewsTitle,
  GOOGLE_SEARCH_ACTOR,
  parseGoogleNews,
  parseGoogleSearchItems,
  parseGoogleSuggest,
  parseGoogleTrends,
  parseTraffic,
} from "../src/core/sources/google.js";
import type { Deps } from "../src/core/types.js";

const raw = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const lookup = async () => ["93.184.216.34"];
const html = (body: string) => new Response(body, { headers: { "content-type": "text/html; charset=utf-8" } });
const article = `<html><head><title>An article</title></head><body><article><h1>An article</h1><p>${"Interesting readable sentence number one. ".repeat(12)}</p></article></body></html>`;

function fakeDeps(extra: Partial<Deps> = {}) {
  const routes: Array<[string, () => Response]> = [
    ["https://hn.algolia.com/", () => new Response(raw("hn-search.json"))],
    ["https://en.wikipedia.org/w/api.php", () => new Response(raw("wiki-search.json"))],
    ["https://wikimedia.org/", () => new Response(raw("wiki-pageviews.json"))],
    ["https://duckduckgo.com/ac/", () => new Response(raw("ddg-ac.json"))],
    ["https://news.google.com/rss/search", () => new Response(raw("google-news.xml"))],
    ["https://trends.google.com/trending/rss", () => new Response(raw("google-trends.xml"))],
    ["https://suggestqueries.google.com/", () => new Response(raw("google-suggest.json"))],
    ["https://", () => html(article)],
  ];
  const calls: string[] = [];
  const fn = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    const hit = routes.find(([p]) => url.startsWith(p));
    return hit ? hit[1]() : new Response("nope", { status: 404 });
  }) as unknown as typeof fetch;
  return { deps: { fetch: fn, lookup, ...extra } as Deps, calls };
}

const isGoogle = (u: string) => /google\.com/.test(u);

// ---- parsers against live fixtures ----

test("google news: parses the feed format, strips the publisher suffix, keeps the publisher as source", () => {
  const items = parseGoogleNews(raw("google-news.xml"), 10);
  assert.equal(items.length, 10);
  const first = items[0]!;
  assert.equal(first.title, "Example Corp and Sample Inc announce a new AI agent platform");
  assert.equal(first.source, "Sample Source");
  assert.match(first.url, /^https:\/\/news\.google\.com\/rss\/articles\//);
  assert.match(first.publishedAt ?? "", /^2026-11-10T13:09:26/);
});

test("google news: title cleaning and url building", () => {
  assert.equal(cleanGoogleNewsTitle("Story - Reuters", "Reuters"), "Story");
  assert.equal(cleanGoogleNewsTitle("Story - Other", "Reuters"), "Story - Other");
  assert.equal(cleanGoogleNewsTitle("Story", undefined), "Story");
  const url = new URL(buildGoogleNewsUrl("c++ & rust"));
  assert.equal(url.searchParams.get("q"), "c++ & rust when:7d");
});

test("google trends: traffic parsing", () => {
  assert.equal(parseTraffic("1000+"), 1000);
  assert.equal(parseTraffic("2K+"), 2000);
  assert.equal(parseTraffic("1M+"), 1_000_000);
  assert.equal(parseTraffic("1,500+"), 1500);
  assert.equal(parseTraffic("lots"), undefined);
  assert.equal(parseTraffic(undefined), undefined);
});

test("google trends: keeps only entries that mention the topic, with their traffic", () => {
  const hit = parseGoogleTrends(raw("google-trends.xml"), "zorblax");
  assert.equal(hit.length, 1);
  assert.equal(hit[0]?.value, 1000);
  assert.match(hit[0]?.label ?? "", /zorblax conference/);
  assert.equal(hit[0]?.source, "google-trends");
  assert.deepEqual(parseGoogleTrends(raw("google-trends.xml"), "zzzz nothing matches"), []);
});

test("google suggest: parses the live firefox-format response and drops the query itself", () => {
  const out = parseGoogleSuggest(JSON.parse(raw("google-suggest.json")), "ai agents", 20);
  assert.ok(out.length >= 5);
  assert.ok(!out.some((k) => k.keyword === "ai agents"));
  assert.equal(out[0]?.keyword, "ai agents course");
  assert.equal(parseGoogleSuggest(JSON.parse(raw("google-suggest.json")), "ai agents", 2).length, 2);
  assert.ok(buildGoogleSuggestUrl("a b").includes("client=firefox"));
  assert.throws(() => parseGoogleSuggest({ nope: 1 }, "x", 5));
});

// Docs-derived sample (NOT a captured live response): one dataset item per SERP page.
const serpItems = [
  {
    searchQuery: { term: "ai agents" },
    organicResults: [
      { title: "What are AI agents?", url: "https://a.example/ai-agents", description: "d", position: 1, type: "organic" },
      { title: "Second", url: "https://b.example/x", position: 2 },
      { title: "", url: "https://c.example/no-title" },
      { title: "No url" },
    ],
    paidResults: [{ title: "Ad", url: "https://ad.example" }],
  },
  { organicResults: [{ title: "Dupe", url: "https://a.example/ai-agents" }] },
  { somethingElse: true },
];

test("google search actor: reads organic results, skips ads, blanks and duplicates", () => {
  const out = parseGoogleSearchItems(serpItems, 10);
  assert.deepEqual(out.map((n) => n.url), ["https://a.example/ai-agents", "https://b.example/x"]);
  assert.ok(out.every((n) => n.source === "google-search-actor"));
  assert.equal(parseGoogleSearchItems(serpItems, 1).length, 1);
});

// ---- opt-in behaviour through the real entry point ----

test("off by default: no Google URL is requested", async () => {
  const { deps, calls } = fakeDeps();
  const pack = await research({ topic: "ai agents", maxPages: 0 }, deps);
  assert.equal(calls.filter(isGoogle).length, 0);
  assert.ok(!pack.sourcesUsed.some((s) => s.startsWith("google")));
});

test("enableGoogleSources adds news, trends and suggestions, and nothing else changes", async () => {
  const { deps, calls } = fakeDeps();
  const pack = await research({ topic: "ai agents zorblax", maxPages: 0, enableGoogleSources: true, maxNews: 50 }, deps);
  assert.ok(pack.sourcesUsed.includes("google-news"));
  assert.ok(pack.sourcesUsed.includes("google-trends"));
  assert.ok(pack.sourcesUsed.includes("google-suggest"));
  assert.ok(!pack.sourcesUsed.includes("google-search-actor"));
  assert.ok(calls.filter(isGoogle).length >= 3);
  assert.ok(pack.news.some((n) => n.source === "Sample Source"));
  assert.ok(pack.keywords.some((k) => k.source === "google-suggest"));
});

test("Google News redirect links are never used as pages to fetch", async () => {
  const { deps, calls } = fakeDeps();
  const pack = await research({ topic: "ai agents", maxPages: 3, enableGoogleSources: true, maxNews: 50 }, deps);
  assert.ok(pack.news.some((n) => n.url.startsWith("https://news.google.com/")));
  assert.ok(!calls.some((c) => c.startsWith("https://news.google.com/rss/articles/")));
  assert.deepEqual(pageCandidates([{ title: "t", url: "https://news.google.com/rss/articles/abc", source: "s" }]), []);
});

test("a failing Google source is reported and does not fail the run", async () => {
  const { deps } = fakeDeps();
  const failing: Deps = {
    ...deps,
    fetch: (async (input: string | URL | Request) =>
      String(input).startsWith("https://news.google.com/")
        ? new Response("blocked", { status: 429 })
        : deps.fetch(input)) as unknown as typeof fetch,
  };
  const pack = await research({ topic: "ai agents", maxPages: 0, enableGoogleSources: true }, failing);
  assert.ok(pack.errors.some((e) => e.source === "google-news"));
  assert.ok(pack.sourcesUsed.includes("hackernews"));
});

// ---- the search Actor ----

test("search actor: needs the Google flag, its own flag and a platform that can call Actors", async () => {
  const seen: Array<[string, unknown]> = [];
  const callActor = async (id: string, input: unknown) => {
    seen.push([id, input]);
    return serpItems;
  };

  const a = fakeDeps({ callActor });
  await research({ topic: "ai agents", maxPages: 0, useGoogleSearchActor: true }, a.deps);
  assert.equal(seen.length, 0, "needs enableGoogleSources");

  const b = fakeDeps({ callActor });
  await research({ topic: "ai agents", maxPages: 0, enableGoogleSources: true }, b.deps);
  assert.equal(seen.length, 0, "needs useGoogleSearchActor");

  const c = fakeDeps();
  const noPlatform = await research({ topic: "ai agents", maxPages: 0, enableGoogleSources: true, useGoogleSearchActor: true }, c.deps);
  assert.ok(!noPlatform.sourcesUsed.includes("google-search-actor"), "needs callActor");
  assert.ok(!noPlatform.errors.some((e) => e.source === "google-search-actor"));

  const d = fakeDeps({ callActor });
  const pack = await research(
    { topic: "ai agents", maxPages: 0, enableGoogleSources: true, useGoogleSearchActor: true },
    d.deps,
  );
  assert.deepEqual(seen, [[GOOGLE_SEARCH_ACTOR, { queries: "ai agents", maxPagesPerQuery: 1 }]]);
  assert.ok(pack.sourcesUsed.includes("google-search-actor"));
  assert.ok(pack.news.some((n) => n.url === "https://a.example/ai-agents"));
});

test("search actor: a failing call is reported, not thrown", async () => {
  const { deps } = fakeDeps({
    callActor: async () => {
      throw new Error("apify/google-search-scraper ended with status FAILED");
    },
  });
  const pack = await research(
    { topic: "ai agents", maxPages: 0, enableGoogleSources: true, useGoogleSearchActor: true },
    deps,
  );
  assert.ok(pack.errors.some((e) => e.source === "google-search-actor" && /FAILED/.test(e.message)));
});

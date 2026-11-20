import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runResearch } from "../src/core/research.js";
import { buildDdgUrl, duckDuckGoSuggestSource, parseDdgResponse } from "../src/core/sources/ddg.js";
import {
  buildPageviewsUrl,
  buildSearchUrl,
  pageviewSignals,
  parseSearchTitles,
  wikipediaSource,
} from "../src/core/sources/wikipedia.js";
import { feedsSource, matchesTopic, topicTerms } from "../src/core/sources/feeds.js";
import { parseFeed } from "../src/core/util/rss.js";

const raw = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const json = (name: string): unknown => JSON.parse(raw(name));
const lookup = async () => ["93.184.216.34"];

/** Fake fetch that answers by URL prefix. */
function router(routes: Record<string, () => Response>) {
  const calls: string[] = [];
  const fn = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    const key = Object.keys(routes).find((k) => url.startsWith(k));
    return key ? routes[key]!() : new Response("not found", { status: 404 });
  }) as unknown as typeof fetch;
  return { fetch: fn, calls };
}

// ---- DuckDuckGo suggest ----

test("ddg: parses live fixture, drops the query itself", () => {
  const out = parseDdgResponse(json("ddg-ac.json"), "ai agents", 20);
  assert.ok(out.length >= 5);
  assert.ok(!out.some((k) => k.keyword === "ai agents"));
  assert.ok(out.every((k) => k.source === "duckduckgo-suggest"));
  assert.equal(out[0]?.keyword, "ai agents examples");
});

test("ddg: respects the max and de-duplicates case-insensitively", () => {
  const out = parseDdgResponse(["q", ["Q a", "q A", "q b", "q c"]], "q", 2);
  assert.deepEqual(out.map((k) => k.keyword), ["Q a", "q b"]);
});

test("ddg: rejects an unexpected shape and builds an encoded url", () => {
  assert.throws(() => parseDdgResponse({ phrase: "x" }, "x", 5));
  const url = new URL(buildDdgUrl("c++ tips"));
  assert.equal(url.searchParams.get("q"), "c++ tips");
  assert.equal(url.searchParams.get("type"), "list");
});

test("ddg: adapter end to end", async () => {
  const f = router({ "https://duckduckgo.com/ac/": () => new Response(raw("ddg-ac.json")) });
  const pack = await runResearch({ topic: "ai agents" }, { fetch: f.fetch, lookup }, [duckDuckGoSuggestSource]);
  assert.deepEqual(pack.sourcesUsed, ["duckduckgo-suggest"]);
  assert.ok(pack.keywords.length >= 5);
});

// ---- Wikipedia ----

test("wikipedia: parses search titles from the live fixture", () => {
  const titles = parseSearchTitles(json("wiki-search.json"));
  assert.equal(titles[0], "AI agent");
  assert.equal(titles.length, 5);
});

test("wikipedia: pageview signals from the live fixture", () => {
  const signals = pageviewSignals(json("wiki-pageviews.json"), "Intelligent agent");
  assert.equal(signals.length, 2);
  const items = (json("wiki-pageviews.json") as { items: { views: number }[] }).items;
  assert.equal(signals[0]?.value, items.slice(-7).reduce((n, d) => n + d.views, 0));
  assert.match(signals[1]?.label ?? "", /change/);
});

test("wikipedia: urls use underscores, a 14 day window ending yesterday", () => {
  const now = Date.UTC(2026, 10, 16, 12);
  const url = buildPageviewsUrl("AI agent", now);
  assert.ok(url.endsWith("/AI_agent/daily/20261102/20261115"), url);
  assert.equal(new URL(buildSearchUrl("a & b", 3)).searchParams.get("srsearch"), "a & b");
});

test("wikipedia: adapter returns keywords and trends", async () => {
  const f = router({
    "https://en.wikipedia.org/w/api.php": () => new Response(raw("wiki-search.json")),
    "https://wikimedia.org/api/rest_v1/metrics/pageviews/": () => new Response(raw("wiki-pageviews.json")),
  });
  const pack = await runResearch({ topic: "ai agents" }, { fetch: f.fetch, lookup }, [wikipediaSource]);
  assert.equal(pack.keywords[0]?.keyword, "AI agent");
  assert.equal(pack.trends.length, 2);
  assert.deepEqual(pack.errors, []);
});

test("wikipedia: pageviews failure keeps the search results and reports the error", async () => {
  const f = router({
    "https://en.wikipedia.org/w/api.php": () => new Response(raw("wiki-search.json")),
    "https://wikimedia.org/": () => new Response("nope", { status: 404 }),
  });
  const pack = await runResearch({ topic: "ai agents" }, { fetch: f.fetch, lookup }, [wikipediaSource]);
  assert.deepEqual(pack.sourcesUsed, ["wikipedia"]);
  assert.equal(pack.keywords.length, 5);
  assert.deepEqual(pack.trends, []);
  assert.equal(pack.errors[0]?.source, "wikipedia-pageviews");
});

// ---- RSS / Atom ----

test("rss: parses an RSS 2.0 feed with CDATA titles and namespaces", () => {
  const feed = parseFeed(raw("feed-rss.xml"));
  assert.equal(feed.title, "Example Tech News");
  assert.equal(feed.items.length, 21);
  const first = feed.items[0]!;
  assert.match(first.title, /Nvidia/);
  assert.ok(first.url.startsWith("https://news.example.com/articles/"));
  assert.ok(first.url.includes("at_medium=RSS&at_campaign=rss"), "entities in links are decoded");
  assert.match(first.publishedAt ?? "", /^2026-11-15T14:56:21/);
});

test("atom: parses an Atom feed, using the alternate link and the updated date", () => {
  const feed = parseFeed(raw("feed-atom.xml"));
  assert.equal(feed.title, "Example Comics");
  assert.equal(feed.items[0]?.title, "Synthetic Comic One");
  assert.equal(feed.items[0]?.url, "https://comics.example.com/3324/");
  assert.equal(feed.items[0]?.publishedAt, "2026-11-13T00:00:00.000Z");
});

test("rss: rejects documents that are not feeds", () => {
  assert.throws(() => parseFeed("<html><body>hi</body></html>"), /Not an RSS or Atom feed/);
});

test("rss: a single item (not an array) and a missing date are handled", () => {
  const xml = `<rss version="2.0"><channel><title>T</title><item><title>One &amp; two</title><link>https://x.example/1</link></item></channel></rss>`;
  const feed = parseFeed(xml);
  assert.deepEqual(feed.items, [{ title: "One & two", url: "https://x.example/1" }]);
});

test("feeds: topic matching uses terms of 3+ characters", () => {
  assert.deepEqual(topicTerms("AI and Nvidia chips"), ["and", "nvidia", "chips"]);
  assert.equal(matchesTopic({ title: "Nvidia earnings", url: "u" }, "nvidia chips"), true);
  assert.equal(matchesTopic({ title: "Weather today", url: "u" }, "nvidia chips"), false);
  // Short topic with no 3+ char terms falls back to a substring match.
  assert.equal(matchesTopic({ title: "Using AI daily", url: "u" }, "AI"), true);
});

test("feeds: adapter is skipped when no feeds are given", async () => {
  const f = router({});
  const pack = await runResearch({ topic: "nvidia" }, { fetch: f.fetch, lookup }, [feedsSource]);
  assert.deepEqual(pack.sourcesUsed, []);
  assert.equal(f.calls.length, 0);
});

test("feeds: filters by topic, merges feeds, and reports a bad feed without failing", async () => {
  const f = router({
    "https://feeds.example.com/bbc": () => new Response(raw("feed-rss.xml")),
    "https://feeds.example.com/xkcd": () => new Response(raw("feed-atom.xml")),
    "https://feeds.example.com/broken": () => new Response("<html>oops</html>"),
  });
  const pack = await runResearch(
    {
      topic: "nvidia",
      maxPages: 0,
      rssFeeds: [
        "https://feeds.example.com/bbc",
        "https://feeds.example.com/xkcd",
        "https://feeds.example.com/broken",
      ],
    },
    { fetch: f.fetch, lookup },
    [feedsSource],
  );
  assert.deepEqual(pack.sourcesUsed, ["rss"]);
  assert.ok(pack.news.length >= 1);
  assert.ok(pack.news.every((n) => n.source === "Example Tech News"));
  assert.ok(pack.news.every((n) => /nvidia/i.test(n.title)), "only items that mention the topic are kept");
  assert.equal(pack.news.length, 2);
  assert.equal(pack.errors.length, 1);
  assert.match(pack.errors[0]?.source ?? "", /broken/);
});

test("feeds: a feed on a private address is blocked", async () => {
  const f = router({});
  const pack = await runResearch(
    { topic: "x", rssFeeds: ["http://169.254.169.254/feed"] },
    { fetch: f.fetch, lookup },
    [feedsSource],
  );
  assert.equal(f.calls.length, 0);
  assert.match(pack.errors[0]?.message ?? "", /Blocked/);
});

test("orchestrator skips a disabled adapter and merges adapter-level errors", async () => {
  const f = router({});
  const pack = await runResearch({ topic: "x" }, { fetch: f.fetch, lookup }, [
    { name: "off", enabled: () => false, run: async () => ({ source: "off" }) },
    { name: "on", run: async () => ({ source: "on", errors: [{ source: "on:part", message: "partial" }] }) },
  ]);
  assert.deepEqual(pack.sourcesUsed, ["on"]);
  assert.equal(pack.errors[0]?.message, "partial");
});

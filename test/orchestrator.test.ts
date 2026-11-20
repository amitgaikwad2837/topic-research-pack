import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mergeKeywords, mergeNews, runResearch, type SourceAdapter } from "../src/core/research.js";
import { collectPages, normalizeUrl, pageCandidates } from "../src/core/content/pages.js";
import { research } from "../src/core/index.js";
import { ResearchPackSchema, type NewsItem } from "../src/core/types.js";

const raw = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const lookup = async () => ["93.184.216.34"];
const html = (body: string) => new Response(body, { headers: { "content-type": "text/html; charset=utf-8" } });
const article = `<html><head><title>An article</title></head><body><article><h1>An article</h1><p>${"Interesting readable sentence number one. ".repeat(12)}</p></article></body></html>`;

function router(routes: Array<[string, () => Response]>) {
  const calls: string[] = [];
  const fn = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    const hit = routes.find(([prefix]) => url.startsWith(prefix));
    return hit ? hit[1]() : new Response("not found", { status: 404 });
  }) as unknown as typeof fetch;
  return { fetch: fn, calls };
}

const item = (title: string, url: string, publishedAt?: string): NewsItem => ({
  title,
  url,
  source: "s",
  ...(publishedAt && { publishedAt }),
});

// ---- merging ----

test("mergeNews: de-duplicates by normalized url, sorts newest first, caps", () => {
  const out = mergeNews(
    [
      [
        item("old", "https://a.example/x", "2026-11-01T00:00:00Z"),
        item("dupe", "https://a.example/x/?utm_source=tw#frag", "2026-11-09T00:00:00Z"),
        item("new", "https://b.example/y", "2026-11-10T00:00:00Z"),
        item("undated", "https://c.example/z"),
      ],
    ],
    3,
  );
  assert.deepEqual(out.map((n) => n.title), ["new", "old", "undated"]);
});

test("mergeNews: each source keeps a fair share, so undated items are not crowded out", () => {
  const dated = [1, 2, 3, 4, 5, 6].map((n) => item(`d${n}`, `https://d.example/${n}`, `2026-11-0${n}T00:00:00Z`));
  const undated = [item("u1", "https://u.example/1"), item("u2", "https://u.example/2")];
  const out = mergeNews([dated, undated], 4);
  assert.equal(out.length, 4);
  assert.deepEqual(out.map((n) => n.title).filter((t) => t.startsWith("u")).sort(), ["u1", "u2"]);
  // Dated ones come first, newest first; undated last.
  assert.deepEqual(out.map((n) => n.title), ["d6", "d5", "u1", "u2"]);
  // A duplicate in a later source is dropped, and an empty source is harmless.
  const dup = mergeNews([[item("a", "https://x.example/1")], [item("a2", "https://x.example/1/")], []], 5);
  assert.equal(dup.length, 1);
});

test("mergeKeywords: case-insensitive de-dupe, drops the topic itself, caps", () => {
  const k = (keyword: string) => ({ keyword, source: "s" });
  const out = mergeKeywords([[k("AI Agent"), k("ai agents tools"), k("AI AGENTS TOOLS"), k("b"), k("c")]], "ai agent", 2);
  assert.deepEqual(out.map((x) => x.keyword), ["ai agents tools", "b"]);
});

test("mergeKeywords: sources take turns so a later source is still represented under the cap", () => {
  const k = (keyword: string, source: string) => ({ keyword, source });
  const first = ["a1", "a2", "a3", "a4", "a5"].map((w) => k(w, "one"));
  const second = ["b1", "b2", "a1"].map((w) => k(w, "two")); // a1 is a duplicate of the first source
  const out = mergeKeywords([first, second], "topic", 4);
  assert.deepEqual(out.map((x) => x.keyword), ["a1", "b1", "a2", "b2"]);
  assert.deepEqual(out.map((x) => x.source), ["one", "two", "one", "two"]);
});

// ---- page candidates and collection ----

test("normalizeUrl: strips tracking and fragments, rejects non-http", () => {
  assert.equal(normalizeUrl("https://x.example/p/?utm_medium=a&id=2#top"), "https://x.example/p?id=2");
  assert.equal(normalizeUrl("https://x.example/"), "https://x.example/");
  assert.equal(normalizeUrl("javascript:alert(1)"), undefined);
  assert.equal(normalizeUrl("not a url"), undefined);
});

test("pageCandidates: skips Hacker News discussion pages and repeats", () => {
  const out = pageCandidates([
    item("ask", "https://news.ycombinator.com/item?id=1"),
    item("a", "https://a.example/1"),
    item("a again", "https://a.example/1/"),
    item("b", "https://b.example/2"),
  ]);
  assert.deepEqual(out, ["https://a.example/1", "https://b.example/2"]);
});

test("collectPages: maxPages 0 fetches nothing", async () => {
  const f = router([]);
  const r = await collectPages([item("a", "https://a.example/1")], { maxPages: 0, maxCharsPerPage: 8000, respectRobotsTxt: true }, { fetch: f.fetch, lookup });
  assert.deepEqual(r.pages, []);
  assert.equal(f.calls.length, 0);
});

test("collectPages: a robots-blocked page is reported and the next candidate is used", async () => {
  const f = router([
    ["https://blocked.example/robots.txt", () => new Response("User-agent: *\nDisallow: /")],
    ["https://ok.example/robots.txt", () => new Response("", { status: 404 })],
    ["https://ok.example/", () => html(article)],
  ]);
  const r = await collectPages(
    [item("b", "https://blocked.example/a"), item("o", "https://ok.example/a")],
    { maxPages: 1, maxCharsPerPage: 8000, respectRobotsTxt: true },
    { fetch: f.fetch, lookup },
  );
  assert.equal(r.pages.length, 1);
  assert.equal(r.pages[0]?.url, "https://ok.example/a");
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0]?.source ?? "", /blocked\.example/);
  assert.match(r.errors[0]?.message ?? "", /robots\.txt/);
  assert.ok(!f.calls.includes("https://blocked.example/a"));
});

test("collectPages: respectRobotsTxt false fetches without asking robots.txt", async () => {
  const f = router([["https://x.example/", () => html(article)]]);
  const r = await collectPages([item("x", "https://x.example/a")], { maxPages: 1, maxCharsPerPage: 8000, respectRobotsTxt: false }, { fetch: f.fetch, lookup });
  assert.equal(r.pages.length, 1);
  assert.deepEqual(f.calls, ["https://x.example/a"]);
});

test("collectPages: stops once enough pages are collected and respects the char cap", async () => {
  const f = router([
    ["https://x.example/robots.txt", () => new Response("", { status: 404 })],
    ["https://x.example/", () => html(article)],
  ]);
  const news = [1, 2, 3, 4, 5, 6].map((n) => item(`n${n}`, `https://x.example/${n}`));
  const r = await collectPages(news, { maxPages: 2, maxCharsPerPage: 500, respectRobotsTxt: true }, { fetch: f.fetch, lookup });
  assert.equal(r.pages.length, 2);
  assert.ok(r.pages.every((p) => p.markdown.length <= 530));
  assert.ok(f.calls.filter((c) => !c.endsWith("robots.txt")).length <= 3);
});

// ---- whole pipeline ----

test("research(): end to end from fixtures, validates against the output schema", async () => {
  const f = router([
    ["https://hn.algolia.com/", () => new Response(raw("hn-search.json"))],
    ["https://en.wikipedia.org/w/api.php", () => new Response(raw("wiki-search.json"))],
    ["https://wikimedia.org/", () => new Response(raw("wiki-pageviews.json"))],
    ["https://duckduckgo.com/ac/", () => new Response(raw("ddg-ac.json"))],
    ["https://feeds.example.com/", () => new Response(raw("feed-rss.xml"))],
    // Every other host (articles and their robots.txt) gets the same HTML page.
    // As robots.txt that parses to an empty rule set, which allows everything.
    ["https://", () => html(article)],
  ]);
  const pack = await research(
    { topic: "ai agents", maxNews: 6, maxPages: 2, rssFeeds: ["https://feeds.example.com/bbc"] },
    { fetch: f.fetch, lookup },
  );

  assert.deepEqual(ResearchPackSchema.safeParse(pack).success, true);
  assert.deepEqual(pack.sourcesUsed.sort(), ["duckduckgo-suggest", "hackernews", "rss", "wikipedia"]);
  assert.ok(pack.news.length > 0 && pack.news.length <= 6);
  assert.ok(pack.keywords.length > 0);
  assert.equal(pack.trends.length, 2);
  assert.equal(pack.pages.length, 2);
  assert.ok(pack.pages.every((p) => p.markdown.includes("Interesting readable sentence")));
  const dates = pack.news.map((n) => n.publishedAt ?? "");
  assert.deepEqual(dates, [...dates].sort().reverse());
});

test("research(): one dead source does not fail the run", async () => {
  const f = router([
    ["https://hn.algolia.com/", () => new Response("down", { status: 500 })],
    ["https://duckduckgo.com/ac/", () => new Response(raw("ddg-ac.json"))],
    ["https://en.wikipedia.org/w/api.php", () => new Response("down", { status: 404 })],
  ]);
  // The other default sources are switched off so this test is only about hackernews and wikipedia.
  const pack = await research(
    {
      topic: "ai agents",
      maxPages: 0,
      excludeSources: ["mastodon-trends", "lobsters", "arxiv", "stackexchange", "github"],
    },
    { fetch: f.fetch, lookup: lookup },
  );
  assert.deepEqual(pack.sourcesUsed, ["duckduckgo-suggest"]);
  assert.deepEqual(pack.errors.map((e) => e.source).sort(), ["hackernews", "wikipedia"]);
  assert.ok(ResearchPackSchema.safeParse(pack).success);
});

test("research(): invalid input throws", async () => {
  await assert.rejects(() => research({ topic: "" }, { fetch }));
  await assert.rejects(() => research({ topic: "x", maxPages: 99 }, { fetch }));
});

test("runResearch: adapters run in parallel and results keep a stable order", async () => {
  const slow: SourceAdapter = {
    name: "slow",
    run: async () => {
      await new Promise((r) => setTimeout(r, 30));
      return { source: "slow" };
    },
  };
  const fast: SourceAdapter = { name: "fast", run: async () => ({ source: "fast" }) };
  const start = Date.now();
  const pack = await runResearch({ topic: "x", maxPages: 0 }, { fetch, lookup }, [slow, fast, slow]);
  assert.ok(Date.now() - start < 80);
  assert.deepEqual(pack.sourcesUsed, ["slow", "fast", "slow"]);
});

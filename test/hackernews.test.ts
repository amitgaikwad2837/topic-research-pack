import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildHnUrl, hackerNewsSource, parseHnResponse } from "../src/core/sources/hackernews.js";
import { runResearch } from "../src/core/research.js";

const load = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));

const lookup = async () => ["93.184.216.34"];

test("parses the live relevance fixture", () => {
  const items = parseHnResponse(load("hn-search.json"));
  assert.equal(items.length, 5);
  assert.equal(items[0]?.title, "An AI agent published a hit piece on me");
  assert.equal(items[0]?.url, "https://theshamblog.com/an-ai-agent-published-a-hit-piece-on-me/");
  assert.equal(items[0]?.source, "hackernews");
  assert.equal(items[0]?.publishedAt, "2026-02-12T16:23:24Z");
});

test("falls back to the HN item page when a post has no url (Ask HN)", () => {
  const items = parseHnResponse(load("hn-search-by-date.json"));
  const ask = items.find((i) => i.title.startsWith("Ask HN: What are you reading"));
  assert.ok(ask);
  assert.equal(ask.url, "https://news.ycombinator.com/item?id=50509333");
  assert.ok(items.every((i) => i.url.startsWith("http")));
});

test("skips hits without a title and tolerates null url", () => {
  const items = parseHnResponse({
    hits: [
      { objectID: "1", title: null, url: "https://a.example/" },
      { objectID: "2", title: "  ", url: "https://b.example/" },
      { objectID: "3", title: "Real", url: null },
    ],
  });
  assert.deepEqual(items, [
    { title: "Real", url: "https://news.ycombinator.com/item?id=3", source: "hackernews" },
  ]);
});

test("rejects a response with an unexpected shape", () => {
  assert.throws(() => parseHnResponse({ nope: true }));
});

test("builds a query url with an encoded topic, story filter and 30-day window", () => {
  const now = Date.UTC(2026, 10, 16);
  const url = new URL(buildHnUrl({ topic: "c++ & rust", maxNews: 7 }, now));
  assert.equal(url.origin + url.pathname, "https://hn.algolia.com/api/v1/search");
  assert.equal(url.searchParams.get("query"), "c++ & rust");
  assert.equal(url.searchParams.get("tags"), "story");
  assert.equal(url.searchParams.get("hitsPerPage"), "7");
  assert.equal(url.searchParams.get("numericFilters"), `created_at_i>${now / 1000 - 30 * 86_400}`);
});

test("adapter fetches through the guarded client and returns news", async () => {
  const body = JSON.stringify(load("hn-search.json"));
  let requested = "";
  const fakeFetch = (async (input: string | URL | Request) => {
    requested = String(input);
    return new Response(body, { headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;

  const pack = await runResearch({ topic: "ai agents", maxNews: 5, maxPages: 0 }, { fetch: fakeFetch, lookup }, [
    hackerNewsSource,
  ]);
  assert.ok(requested.startsWith("https://hn.algolia.com/api/v1/search?"));
  assert.deepEqual(pack.sourcesUsed, ["hackernews"]);
  assert.equal(pack.news.length, 5);
  assert.deepEqual(pack.errors, []);
});

test("a failing Hacker News call is recorded, not thrown", async () => {
  const fakeFetch = (async () => new Response("down", { status: 404 })) as unknown as typeof fetch;
  const pack = await runResearch({ topic: "x" }, { fetch: fakeFetch, lookup }, [hackerNewsSource]);
  assert.deepEqual(pack.sourcesUsed, []);
  assert.equal(pack.errors[0]?.source, "hackernews");
});

test("invalid JSON is reported as an error", async () => {
  const fakeFetch = (async () => new Response("<html>")) as unknown as typeof fetch;
  const pack = await runResearch({ topic: "x" }, { fetch: fakeFetch, lookup }, [hackerNewsSource]);
  assert.match(pack.errors[0]?.message ?? "", /invalid JSON/);
});

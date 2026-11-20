import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { renderReport } from "../src/core/report.js";
import { research } from "../src/core/index.js";
import { matchesTopic } from "../src/core/sources/feeds.js";
import { parseLobsters, parseMastodonTrends } from "../src/core/sources/trending.js";
import { buildSummaryUrl, parseSummary } from "../src/core/sources/wikipedia.js";
import { ResearchPackSchema, type Deps, type ResearchPack } from "../src/core/types.js";

const raw = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const json = (name: string): unknown => JSON.parse(raw(name));
const lookup = async () => ["93.184.216.34"];
const FIXED = new Date("2026-11-20T10:00:00.000Z");

function fakeDeps(extra: Array<[string, () => Response]> = []): { deps: Deps; calls: string[] } {
  const routes: Array<[string, () => Response]> = [
    ...extra,
    ["https://hn.algolia.com/", () => new Response(raw("hn-search.json"))],
    ["https://en.wikipedia.org/w/api.php", () => new Response(raw("wiki-search.json"))],
    ["https://wikimedia.org/", () => new Response(raw("wiki-pageviews.json"))],
    ["https://en.wikipedia.org/api/rest_v1/", () => new Response(raw("wiki-summary.json"))],
    ["https://duckduckgo.com/ac/", () => new Response(raw("ddg-ac.json"))],
    ["https://export.arxiv.org/", () => new Response(raw("arxiv.xml"))],
    ["https://api.stackexchange.com/", () => new Response(raw("stackexchange.json"))],
    ["https://api.github.com/", () => new Response(raw("github-repos.json"))],
    ["https://mastodon.social/", () => new Response(raw("mastodon-trends.json"))],
    ["https://lobste.rs/", () => new Response(raw("lobsters.json"))],
  ];
  const calls: string[] = [];
  const fn = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    const hit = routes.find(([p]) => url.startsWith(p));
    return hit ? hit[1]() : new Response("nope", { status: 404 });
  }) as unknown as typeof fetch;
  return { deps: { fetch: fn, lookup, now: () => FIXED }, calls };
}

const emptyPack = (over: Partial<ResearchPack> = {}): ResearchPack => ({
  topic: "t",
  generatedAt: "2026-11-20T10:00:00.000Z",
  news: [],
  trends: [],
  keywords: [],
  references: [],
  pages: [],
  sourcesUsed: [],
  errors: [],
  ...over,
});

// ---- overview ----

test("overview: parses the live Wikipedia summary", () => {
  const o = parseSummary(json("wiki-summary.json"));
  assert.equal(o?.title, "AI agent");
  assert.equal(o?.url, "https://en.wikipedia.org/wiki/AI_agent");
  assert.equal(o?.description, "Autonomous artificial intelligence agent");
  assert.equal(o?.source, "wikipedia");
  assert.match(o?.summary ?? "", /^An AI agent is an artificial intelligence program/);
});

test("overview: disambiguation pages and empty extracts give no overview; the url has a fallback", () => {
  assert.equal(parseSummary({ type: "disambiguation", title: "Mercury", extract: "Mercury may refer to:" }), undefined);
  assert.equal(parseSummary({ type: "standard", title: "X", extract: "   " }), undefined);
  assert.equal(parseSummary({ type: "standard", title: "No url page", extract: "Text." })?.url, "https://en.wikipedia.org/wiki/No_url_page");
  assert.throws(() => parseSummary({ nope: 1 }));
  assert.equal(buildSummaryUrl("AI agent"), "https://en.wikipedia.org/api/rest_v1/page/summary/AI_agent");
  assert.equal(buildSummaryUrl("C++ (language)"), "https://en.wikipedia.org/api/rest_v1/page/summary/C%2B%2B_(language)");
});

test("overview and generatedAt arrive in the pack, using the injected clock", async () => {
  const { deps } = fakeDeps();
  const pack = await research({ topic: "ai agents", maxPages: 0 }, deps);
  assert.equal(pack.generatedAt, "2026-11-20T10:00:00.000Z");
  assert.equal(pack.overview?.title, "AI agent");
  assert.ok(ResearchPackSchema.safeParse(pack).success);
});

test("a failing summary is a soft error: search results and trends survive, no overview", async () => {
  const { deps } = fakeDeps([["https://en.wikipedia.org/api/rest_v1/", () => new Response("gone", { status: 404 })]]);
  const pack = await research({ topic: "ai agents", maxPages: 0 }, deps);
  assert.equal(pack.overview, undefined);
  assert.ok(pack.errors.some((e) => e.source === "wikipedia-summary"));
  assert.ok(pack.keywords.some((k) => k.source === "wikipedia"));
  assert.equal(pack.trends.filter((t) => t.source === "wikipedia").length, 2);
});

// ---- stricter matching for global lists ----

test("matchesTopic: 'any' stays loose, 'all' needs every word and ignores a plural s", () => {
  const item = { title: "Postgres ledger UI", url: "u", summary: "a vector extension" };
  assert.equal(matchesTopic(item, "vector databases"), true, "any: one word is enough");
  assert.equal(matchesTopic(item, "vector databases", "all"), false, "all: 'database' is missing");
  assert.equal(matchesTopic({ title: "A new vector database", url: "u" }, "vector databases", "all"), true, "plural-insensitive");
  assert.equal(matchesTopic({ title: "Using AI daily", url: "u" }, "AI", "all"), true, "short topics use a substring");
});

test("trending lists use the strict match, so loosely related entries are dropped", () => {
  const lobsters = [
    { title: "Visualizing a ledger", url: "https://a.example/1", description_plain: "built on a vector extension", created_at: "2026-11-19T07:00:00.000-06:00" },
    { title: "A new vector database released", url: "https://a.example/2", created_at: "2026-11-19T08:00:00.000-06:00" },
  ];
  assert.deepEqual(parseLobsters(lobsters, "vector databases").map((n) => n.url), ["https://a.example/2"]);
  const mastodon = [
    { url: "https://b.example/1", title: "Chip prices rise", description: "vector units" },
    { url: "https://b.example/2", title: "Vector databases explained", description: "" },
  ];
  assert.deepEqual(parseMastodonTrends(mastodon, "vector databases").map((n) => n.url), ["https://b.example/2"]);
});

// ---- the report ----

test("report: a real pack renders every section, with citations that match the Sources list", async () => {
  const { deps } = fakeDeps();
  const pack = await research({ topic: "ai agents", maxPages: 0, maxNews: 6, maxReferences: 6 }, deps);
  const md = renderReport(pack);
  assert.match(md, /^# Research brief: ai agents\n/);
  assert.match(md, /Generated 2026-11-20T10:00:00.000Z\. Sources used: /);
  for (const h of ["## Overview", "## Signals", "## News", "## Papers, code and questions", "### Papers", "### Code repositories", "### Questions and answers", "## Keyword ideas", "## Sources"]) {
    assert.ok(md.includes(h), `has ${h}`);
  }
  assert.ok(!md.includes("## Limitations"), "no errors, so no Limitations section");

  // Every [n] used in the body has a numbered entry in Sources, and every entry is used.
  const [body, sources] = md.split("## Sources\n");
  const used = new Set([...body!.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1])));
  const listed = [...sources!.matchAll(/^(\d+)\. /gm)].map((m) => Number(m[1]));
  assert.deepEqual([...used].sort((a, b) => a - b), listed);
  assert.match(sources!, /Retrieved 2026-11-20\./);
});

test("report: deterministic, and numbers a URL only once even when it appears twice", () => {
  const dup = { title: "Same", url: "https://x.example/a?utm_source=tw", source: "s" };
  const pack = emptyPack({
    news: [dup, { ...dup, url: "https://x.example/a/" }],
    pages: [{ url: "https://x.example/a", title: "Same", markdown: "Body text of the page." }],
    sourcesUsed: ["s"],
  });
  const md = renderReport(pack);
  assert.equal(md, renderReport(pack));
  assert.equal((md.match(/^\d+\. /gm) ?? []).length, 1, "one source entry for the one distinct page");
  assert.ok(!md.includes("[2]"));
});

test("report: titles with newlines and markdown characters stay on one line", () => {
  const md = renderReport(
    emptyPack({
      topic: "c++ [draft]\nline two",
      news: [{ title: "Broken *title*\nwith [brackets] and `ticks`", url: "https://x.example/1", source: "s_source" }],
      trends: [{ label: "Big number", value: 1234567, source: "s" }],
    }),
  );
  assert.match(md, /^# Research brief: c\+\+ \\\[draft\\\] line two$/m);
  assert.match(md, /- Broken \\\*title\\\* with \\\[brackets\\\] and \\`ticks\\` \(s\\_source\) \[1\]/);
  assert.match(md, /Big number: 1,234,567 \(s\)/);
});

test("report: an empty pack says so, errors become a Limitations section, excerpts are cut", () => {
  const empty = renderReport(emptyPack());
  assert.match(empty, /No results were found for this topic\./);
  assert.ok(!empty.includes("## Sources"));

  const withErrors = renderReport(emptyPack({ errors: [{ source: "github", message: "HTTP 403" }] }));
  assert.match(withErrors, /## Limitations[\s\S]*- github: HTTP 403/);

  const long = renderReport(
    emptyPack({ pages: [{ url: "https://x.example/p", title: "P", markdown: "word ".repeat(500) }] }),
    { excerptChars: 100 },
  );
  const excerpt = long.split("\n").find((l) => l.startsWith("> "))!;
  assert.ok(excerpt.length <= 104 && excerpt.endsWith("…"));
});

test("cli: rejects an unknown --format without touching the network", () => {
  const r = spawnSync(process.execPath, ["--import", "tsx", "src/cli.ts", "ai", "--format", "xml"], {
    cwd: new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"),
    encoding: "utf8",
  });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--format must be json or markdown/);
});
